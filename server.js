// ==============================
// SERVIDOR DE PRODUCCIÓN — server.js
// ==============================
// Sirve el sitio completo (archivos estáticos) y rutea TODAS las
// rutas /api/* contra los mismos handlers que corrían en Vercel,
// usando la base de datos real (el Postgres del VPS, vía DATABASE_URL).
//
// Uso:  node server.js   (en el VPS lo maneja systemd, ver docs)

const http = require("http");
const fs = require("fs");
const path = require("path");

// Carga el archivo .env (DATABASE_URL, SESSION_SECRET, PUSHER_*) antes
// que cualquier otro require, porque los handlers de api/ resuelven su
// conexión a la base en el momento de importarse.
//
// Se hace a mano en vez de con dotenv para no sumar una dependencia
// por diez líneas. Formato: CLAVE=valor, una por línea, # para
// comentarios. No se sobrescribe lo que ya venga del entorno, así
// systemd o una variable puntual siempre mandan sobre el archivo.
function cargarEnv() {
  const archivo = path.join(__dirname, ".env");
  if (!fs.existsSync(archivo)) return;

  for (const linea of fs.readFileSync(archivo, "utf8").split("\n")) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith("#")) continue;

    const corte = limpia.indexOf("=");
    if (corte === -1) continue;

    const clave = limpia.slice(0, corte).trim();
    let valor = limpia.slice(corte + 1).trim();

    // Quitar comillas envolventes si las hay.
    if (valor.length > 1 &&
        ((valor.startsWith('"') && valor.endsWith('"')) ||
         (valor.startsWith("'") && valor.endsWith("'")))) {
      valor = valor.slice(1, -1);
    }

    if (!(clave in process.env)) process.env[clave] = valor;
  }
}

cargarEnv();

const PUERTO = Number(process.env.PORT) || 3000;
const RAIZ = __dirname;

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json"
};

// La raiz del sitio es la raiz del proyecto, asi que sin este filtro se sirve
// por HTTP cualquier archivo que haya aqui: el `.env` con las contrasenas, la
// carpeta `.git` entera, el codigo de `api/`, los respaldos de la base. Estaba
// pasando de verdad — `GET /.env` devolvia 200 con el contenido completo.
//
// Se decide por lista blanca: solo salen los tipos que un navegador necesita
// para pintar la pagina. Una lista negra de rutas prohibidas siempre se queda
// corta, porque cada archivo nuevo que se anada al proyecto es publico hasta
// que alguien se acuerde de anadirlo a la lista.
const EXTENSIONES_PUBLICAS = new Set(Object.keys(TIPOS));

// De estas carpetas no sale nada, ni siquiera con una extension permitida:
// `api/` y `scripts/` son .js, y `docs/` y `migrations/` no pintan nada.
const CARPETAS_PRIVADAS = [
  "api", "scripts", "tests", "migrations", "docs", "infra",
  "node_modules", "respaldos"
];

function esPublico(rutaRelativa) {
  const partes = rutaRelativa.split("/").filter(Boolean);

  // Nada que empiece por punto: .env, .git, .vscode, .DS_Store...
  if (partes.some((parte) => parte.startsWith("."))) return false;

  if (CARPETAS_PRIVADAS.includes(partes[0])) return false;

  // server.js y cluster.js son .js, que es una extension publica, pero son el
  // servidor, no el codigo del navegador (ese vive en js/).
  if (partes.length === 1 && (partes[0] === "server.js" || partes[0] === "cluster.js")) {
    return false;
  }

  // package.json revela las dependencias y sus versiones exactas, que es el
  // primer sitio donde mira quien busca una vulnerabilidad conocida.
  if (partes.length === 1 && partes[0].startsWith("package")) return false;

  return EXTENSIONES_PUBLICAS.has(path.extname(rutaRelativa).toLowerCase());
}

function responder(res, codigo, obj) {
  if (res.writableEnded) return;
  res.writeHead(codigo, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(obj));
}

// Todos los módulos de la API que existen en api/ (menos los que
// empiezan con "_", que son helpers internos, no rutas).
const HANDLERS = {
  "/api/auth": require("./api/auth"),
  "/api/users": require("./api/users"),
  "/api/content": require("./api/content"),
  "/api/social": require("./api/social"),
  "/api/system": require("./api/system"),
  "/api/originales-ranking": require("./api/originales-ranking"),
  "/api/progreso": require("./api/progreso")
};

async function main() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");

    // ----- API -----
    if (url.pathname.startsWith("/api/")) {
      const handler = HANDLERS[url.pathname];

      if (!handler) {
        return responder(res, 404, { success: false, error: "Ruta de API no encontrada" });
      }

      let cuerpo = {};
      try {
        const trozos = [];
        for await (const chunk of req) trozos.push(chunk);
        const texto = Buffer.concat(trozos).toString("utf8");
        if (texto) cuerpo = JSON.parse(texto);
      } catch (error) {
        return responder(res, 400, { success: false, error: "Body inválido" });
      }

      const query = Object.fromEntries(url.searchParams.entries());
      const reqSim = { method: req.method, query, body: cuerpo, headers: req.headers };
      const resSim = {
        statusCode: 200,
        setHeader(nombre, valor) { res.setHeader(nombre, valor); },
        status(codigo) { this.statusCode = codigo; return this; },
        json(obj) {
          if (res.writableEnded) return;
          // Sin pisar las cabeceras que el handler ya haya puesto con
          // setHeader (antes se pasaban en writeHead y las borraba).
          if (!res.getHeader("Content-Type")) {
            res.setHeader("Content-Type", "application/json; charset=utf-8");
          }
          res.writeHead(this.statusCode || 200);
          res.end(JSON.stringify(obj));
        },
        // end(cuerpo) tiene que escribir ese cuerpo: es como un handler
        // devuelve algo que no es JSON, por ejemplo una imagen. Antes se
        // ignoraba el argumento y la respuesta salía con las cabeceras
        // correctas pero vacía, lo que deja al navegador esperando bytes
        // que nunca llegan.
        end(cuerpo) {
          if (res.writableEnded) return;
          res.writeHead(this.statusCode || 200);
          res.end(cuerpo);
        }
      };

      try {
        await handler(reqSim, resSim);
      } catch (error) {
        console.error(`Error en ${url.pathname}:`, error);
        if (!res.writableEnded) responder(res, 500, { success: false, error: "Error interno del servidor" });
      }
      return;
    }

    // ----- Archivos estáticos -----
    const rutaRelativa = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    const archivo = path.join(RAIZ, rutaRelativa);

    if (!archivo.startsWith(RAIZ)) {
      res.writeHead(403);
      return res.end("Prohibido");
    }

    if (!esPublico(rutaRelativa)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("No encontrado: " + rutaRelativa);
    }

    fs.readFile(archivo, (err, datos) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("No encontrado: " + rutaRelativa);
      }
      res.writeHead(200, { "Content-Type": TIPOS[path.extname(archivo)] || "application/octet-stream" });
      res.end(datos);
    });
  });

  server.listen(PUERTO, () => {
    console.log(`Servidor de producción escuchando en el puerto ${PUERTO}`);
  });
}

main().catch((error) => {
  console.error("No se pudo arrancar el servidor:", error);
  process.exit(1);
});

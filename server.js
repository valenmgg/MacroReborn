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

// Carga el archivo .env (DATABASE_URL, SESSION_SECRET, CRON_SECRET) antes
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
// Tope de lo que se acepta en el cuerpo de una peticion.
//
// 12 MB da margen para subir una tanda de prendas de avatar desde el
// panel del equipo de arte (la mas pesada del catalogo actual son 69 kB,
// y base64 engorda un tercio) sin dejar la puerta abierta de par en par.
// nginx tiene su propio limite por delante; este es el que protege al
// proceso aunque alguien llegue por otra via.
const LIMITE_CUERPO = 12 * 1024 * 1024;

// Para poder servir las prendas de avatar que viven en la base.
const { obtenerSql } = require("./api/_db");

// Avisos en vivo. No entra en HANDLERS a proposito: su ruta no pasa
// por el despacho de /api/, por el motivo que explica mas abajo.
const avisosSSE = require("./api/_avisos-sse");
const avisos = require("./api/_avisos");

const HANDLERS = {
  "/api/auth": require("./api/auth"),
  "/api/users": require("./api/users"),
  "/api/content": require("./api/content"),
  "/api/social": require("./api/social"),
  "/api/system": require("./api/system"),
  "/api/originales-ranking": require("./api/originales-ranking"),
  "/api/progreso": require("./api/progreso")
};

// ==============================
// LA RUTA VIEJA DE LAS PRENDAS DEJA DE SERVIR ARTE
// ==============================
// El arte de los avatares vive en la base desde la migración 018, y su
// URL buena es /prendas/<huella sha256>.png: el nombre ES el contenido,
// así que se cachea un año sin poder quedarse vieja.
//
// Durante la mudanza quedó abierta la ruta de antes,
// imagenes/<modelo>/<prenda>.png, sirviendo el mismo dibujo desde el
// disco o, si el fichero no estaba, desde la base. Era compatibilidad
// hacia atrás y tenía sentido mientras el frontend armara esa ruta a
// mano.
//
// El problema es que ese nombre SE ADIVINA. "tora_pelo3" es
// imagenes/tora/pelo3.png, y el nombrado es sistemático: modelo, capa y
// un número. Cualquiera enumera pelo1, pelo2, pelo3... por cada capa y
// por cada modelo, y se lleva el catálogo entero sin necesitar índice
// ninguno. Cerrar el índice del catálogo —que es lo que se hizo en la
// acción avatar-catalogo— no sirve de nada mientras esta puerta siga
// abierta, porque es la misma puerta.
//
// Así que ahora estas rutas devuelven 404 cuando corresponden a una
// prenda de verdad, esté el fichero en el disco o no. El arte solo sale
// por /prendas/<huella>.png, que es una dirección que hay que conocer y
// no se puede adivinar.
//
// Lo que NO se toca: imagenes/logo.png, imagenes/og-image.png,
// imagenes/juegos/... y compañía. No son prendas, no están en
// avatar_prendas, y se siguen sirviendo como siempre. Por eso el corte
// se decide consultando la base y no con una lista escrita a mano: una
// lista se queda vieja en cuanto el equipo de arte sube un modelo nuevo.

// Solo se mira si la ruta tiene forma de prenda. Sin este filtro,
// cualquier escáner pidiendo imágenes al azar acabaría consultando la
// base en cada 404.
const RUTA_DE_PRENDA = /^\/imagenes\/([a-z0-9]+)(?:\/([a-z0-9]+))?\.png$/;

// La URL canónica de una prenda: /prendas/<huella sha256>.png.
//
// Hasta ahora esa ruta solo existía como `rewrite` en la configuración de
// nginx, que la traduce a /api/content?action=avatar-prenda. Eso deja el
// sitio dependiendo de nginx para algo que no es infraestructura sino
// parte de la aplicación: con `node server.js` a pelo —que es el flujo
// que documenta el README para trabajar en local— todas esas imágenes
// daban 404, y el editor de avatares salía en blanco.
//
// Aquí se hace la misma traducción, así que la ruta funciona con nginx
// delante o sin él. nginx sigue teniendo la suya, que además cachea.
const RUTA_POR_HUELLA = /^\/prendas\/([a-f0-9]{64})\.png$/;

// Traduce la URL en su sitio y avisa si lo hizo. No sirve la imagen ni
// duplica la consulta: deja la petición hecha una llamada de API normal,
// que ya valida la huella, responde 404 si no existe y marca la
// respuesta como immutable durante un año. Es correcto marcarla así
// porque en esta URL el nombre ES el contenido.
function traducirRutaCanonica(url) {
  const m = RUTA_POR_HUELLA.exec(url.pathname);
  if (!m) return false;

  url.pathname = "/api/content";
  url.searchParams.set("action", "avatar-prenda");
  url.searchParams.set("v", m[1]);
  return true;
}

function valorDePrenda(rutaRelativa) {
  const m = RUTA_DE_PRENDA.exec(rutaRelativa);
  if (!m) return null;
  // imagenes/tora.png -> "tora"   |   imagenes/tora/pelo3.png -> "tora_pelo3"
  return m[2] ? m[1] + "_" + m[2] : m[1];
}

// El conjunto de valores que SON una prenda, cacheado.
//
// Se cachea por la misma razón que el catálogo en api/content.js: esto
// se consulta en cada imagen que alguien pida con forma de prenda, y un
// escáner insistente no puede convertirse en una consulta por petición.
//
// La versión del catálogo manda, igual que en el resto del proyecto:
// avatar_catalogo_version es una fila por clave primaria, así que
// comprobarla es barato y los dos procesos del cluster se enteran solos
// cuando el equipo de arte publica algo, sin hablar entre ellos.
//
// Entran las retiradas también (no se filtra por `publicada`): una
// prenda retirada sigue siendo arte del equipo, y su dibujo tampoco
// tiene por qué salir por la ruta adivinable.
let _valoresDePrenda = null;   // { version, conjunto }

async function conjuntoDeValores(sql) {
  let version = null;
  try {
    const filas = await sql`SELECT version FROM avatar_catalogo_version WHERE id = 1;`;
    version = filas.length ? Number(filas[0].version) : null;
  } catch (error) {
    // Si no se puede leer la versión, se sirve lo que haya en memoria
    // antes que dejar pasar una prenda por la ruta vieja.
    console.error("valores de prenda: no se pudo leer la versión", error.message);
    if (_valoresDePrenda) return _valoresDePrenda.conjunto;
    throw error;
  }

  if (_valoresDePrenda && _valoresDePrenda.version === version) {
    return _valoresDePrenda.conjunto;
  }

  const filas = await sql`SELECT valor FROM avatar_prendas;`;
  const conjunto = new Set(filas.map(f => f.valor));
  _valoresDePrenda = { version, conjunto };
  return conjunto;
}

// ¿Esta ruta de imagenes/ corresponde a una prenda de avatar?
//
// Ante la duda se contesta que SÍ, y por eso el catch devuelve true: si
// la base no responde, preferimos un logo que no carga durante un rato
// antes que abrir la puerta por la que se fue el catálogo. El arte no
// deja de verse por esto —sale por /prendas/<huella>.png, que no pasa
// por aquí—, así que el coste de equivocarse por este lado es bajo.
async function esPrendaDeAvatar(rutaRelativa) {
  const valor = valorDePrenda(rutaRelativa);
  if (!valor) return false;

  try {
    const conjunto = await conjuntoDeValores(obtenerSql());
    return conjunto.has(valor);
  } catch (error) {
    console.error("prenda por la ruta vieja:", error.message);
    return true;
  }
}

async function main() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");

    // ----- La URL canónica de las prendas -----
    traducirRutaCanonica(url);

    // ----- Avisos en vivo -----
    // Va ANTES del despacho de /api/ y fuera de HANDLERS porque ese
    // despacho junta el cuerpo entero de la peticion y luego contesta de
    // una sola vez con un `res` de mentira. Una conexion que no se cierra
    // necesita justo lo contrario: el `res` de verdad, y no cerrarlo.
    if (url.pathname === "/api/avisos") {
      return avisosSSE.atender(req, res, url);
    }

    // ----- API -----
    if (url.pathname.startsWith("/api/")) {
      const handler = HANDLERS[url.pathname];

      if (!handler) {
        return responder(res, 404, { success: false, error: "Ruta de API no encontrada" });
      }

      let cuerpo = {};
      try {
        const trozos = [];
        let recibido = 0;

        for await (const chunk of req) {
          recibido += chunk.length;

          // Sin este tope, el cuerpo de una peticion se acumula entero en
          // memoria sin limite. En una maquina de 950 MB eso es una forma
          // barata de tumbar el sitio: basta con enviar un POST enorme.
          // Hasta ahora lo unico que lo frenaba era el limite de nginx, y
          // eso deja el proceso desprotegido ante cualquier cosa que no
          // pase por nginx.
          if (recibido > LIMITE_CUERPO) {
            req.destroy();
            return responder(res, 413, {
              success: false,
              error: "El contenido enviado es demasiado grande"
            });
          }

          trozos.push(chunk);
        }

        const texto = Buffer.concat(trozos).toString("utf8");
        if (texto) cuerpo = JSON.parse(texto);
      } catch (error) {
        if (res.writableEnded) return;
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

    // El arte de los avatares no sale por su nombre adivinable, ni
    // aunque el fichero siga en el disco. Solo por /prendas/<huella>.png.
    // Ver el bloque "LA RUTA VIEJA DE LAS PRENDAS DEJA DE SERVIR ARTE".
    if (await esPrendaDeAvatar(rutaRelativa)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("No encontrado: " + rutaRelativa);
    }

    // ----- ETag y respuestas 304 -----
    // Hasta ahora esto solo ponía Content-Type. Sin ETag ni
    // Last-Modified, un navegador no tiene forma de preguntar "¿esto
    // cambió?": o se fía de la caché o se baja el archivo entero.
    //
    // Por eso nginx servía los .js con `immutable` durante 30 días, y
    // eso trae un problema real: un cambio en el código tardaba hasta un
    // mes en llegar a quien ya había visitado el sitio. Peor aún, el
    // HTML NO está cacheado y el JS sí, así que alguien podía recibir un
    // HTML nuevo con el JavaScript viejo — que es exactamente la forma
    // de romperle la página a la mitad de la gente y a la otra mitad no.
    //
    // Con un ETag barato (tamaño + fecha de modificación, sin leer ni
    // hashear el archivo) la revalidación cuesta una respuesta vacía de
    // 304 en vez de una descarga. Eso es lo que permite que nginx pueda
    // dejar de decir `immutable` en los scripts.
    fs.stat(archivo, async (errStat, datosArchivo) => {
      if (errStat || !datosArchivo.isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("No encontrado: " + rutaRelativa);
      }

      const etag = '"' + datosArchivo.size.toString(16) + "-" +
                   Math.floor(datosArchivo.mtimeMs).toString(16) + '"';

      res.setHeader("ETag", etag);
      res.setHeader("Last-Modified", datosArchivo.mtime.toUTCString());

      // Si el navegador ya tiene esta versión, no hace falta leer el
      // archivo del disco siquiera.
      if (req.headers["if-none-match"] === etag) {
        res.writeHead(304);
        return res.end();
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
  });

  // El puente que lleva un aviso de un proceso del cluster al otro. Si no
  // levanta -sin DATABASE_URL, o apuntando a Neon- el sitio funciona igual:
  // los avisos se entregan dentro del proceso que los genera, que es lo
  // correcto cuando solo hay uno.
  const conPuente = await avisos.arrancarBus().catch((error) => {
    console.warn("Avisos: sin puente entre procesos.", error.message);
    return false;
  });

  server.listen(PUERTO, () => {
    console.log(`Servidor de producción escuchando en el puerto ${PUERTO}`);
    console.log(`[avisos] ${conPuente ? "con" : "sin"} puente entre procesos`);
  });
}

main().catch((error) => {
  console.error("No se pudo arrancar el servidor:", error);
  process.exit(1);
});

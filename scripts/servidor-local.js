// ==============================
// SERVIDOR LOCAL — scripts/servidor-local.js
// ==============================
// Mini servidor para probar el sitio EN EL NAVEGADOR, todo dentro de
// esta computadora, sin tocar el servidor real del proyecto original.
//
//   - Sirve los archivos estáticos del sitio (HTML, CSS, JS, imágenes).
//   - Rutea /api/auth, /api/users y /api/content contra la base local
//   - Y /api/avisos, la conexion abierta de los avisos en vivo
//     (PGlite), usando los MISMOS handlers que corren en produccion.
//
// Uso:  npm run db:local     (o: node scripts/servidor-local.js)
// Abrí http://localhost:3001
//
// Usuario de prueba ya creado:
//   usuario: demo   contraseña: demo1234
//   (está guardada en TEXTO PLANO a propósito: cuando entres, vas a
//   poder ver cómo se migra sola a hash — mirá la consola del servidor.)
//
// Nota: el resto de los endpoints devuelve un aviso.

const http = require("http");
const fs = require("fs");
const path = require("path");

// El servidor local necesita firmar tokens para que el flujo de login y XP
// sea reproducible. Vercel/Neon siempre proporcionan su propio secreto; este
// valor predeterminado solo aplica a este proceso local.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "local-development-session-secret";

const { crearBaseLocal, crearSqlPGlite } = require("./pglite");
const { sembrarArte } = require("./sembrar-arte");
const { abrirBaseReal } = require("./base-real");

// Dos modos:
//   npm run db:local   base de mentira, armada desde las migraciones
//   npm run db:real    la copia de produccion que dejo scripts/traer-base.js
//
// La de mentira arranca en segundos y no tiene datos de nadie, asi que es
// la de todos los dias. La real es para lo que de verdad rompe: el
// usuario con doscientas prendas guardadas, la prenda descuadrada que
// alguien lleva puesta desde hace un ano, el avatar PNG de 984 kB.
const MODO_REAL = process.argv.includes("--real") || process.env.MR_BASE === "real";
const PGDATA = path.join(__dirname, "..", "datos-locales", "pgdata");
const { usarSqlLocal } = require("../api/_db");

// Las mismas rutas de prenda que server.js, del mismo modulo y no
// copiadas: este servidor es OTRO, y mientras el cierre de la ruta
// adivinable vivio dentro de server.js, aqui no se aplicaba.
const { traducirRutaCanonica, esPrendaDeAvatar } = require("../api/_prendas-ruta");
const avisosSSE = require("../api/_avisos-sse");

const PUERTO = Number(process.env.PORT) || 3001;
const RAIZ = path.join(__dirname, "..");

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
  ".txt": "text/plain; charset=utf-8"
};

function responder(res, codigo, obj) {
  if (res.writableEnded) return;
  res.writeHead(codigo, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(obj));
}

async function main() {
  let db;
  let arte = null;

  if (MODO_REAL) {
    db = await abrirBaseReal(PGDATA);
    if (!db) {
      console.error("\nNo hay copia de produccion en datos-locales/pgdata.");
      console.error("Traela con:  npm run db:traer\n");
      process.exit(1);
    }
    console.log("Abriendo la copia de produccion...");
    usarSqlLocal(crearSqlPGlite(db));
  } else {
    console.log("Armando la base local (PGlite) y aplicando las migraciones...");
    db = await crearBaseLocal();
    usarSqlLocal(crearSqlPGlite(db));
  }

  // Lo de abajo es siembra de mentira: en la copia real no se toca NADA,
  // que para eso es una copia.
  if (!MODO_REAL) {
    // Usuario de prueba "legacy" (contraseña en texto plano) para que se
    // pueda ver la migración perezosa en vivo.
    await db.query(
      `INSERT INTO users (username, password, level, xp, status, created_at, last_login)
       VALUES ($1, $2, 3, 120, 'active', now(), now())
       ON CONFLICT (username) DO NOTHING`,
      ["demo", "demo1234"]
    );
  }

  // Un catalogo de arte de mentira, para poder probar el panel de arte y
  // el vestidor sin tocar produccion. Trae las medidas raras del catalogo
  // real a proposito: si algo las pinta mal, se ve aca.
  if (!MODO_REAL) arte = await sembrarArte(db, "demo");

  // Los handlers se piden DESPUES de usarSqlLocal: api/content.js llama a
  // obtenerSql() al cargarse, y sin eso pediria DATABASE_URL.
  const authHandler = require("../api/auth");
  const usersHandler = require("../api/users");
  const contentHandler = require("../api/content");

  const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");

    // ----- Avisos en vivo -----
    // Aqui SI funcionan, y sin puente: el servidor local es un solo
    // proceso, asi que el reparto dentro del proceso es el reparto entero.
    // Va antes del bloque de /api/ por el mismo motivo que en server.js:
    // ese bloque junta el cuerpo y contesta de una vez.
    if (url.pathname === "/api/avisos") {
      return avisosSSE.atender(req, res, url);
    }

    // ----- API local -----
    if (url.pathname.startsWith("/api/")) {
      let cuerpo = {};
      try {
        const trozos = [];
        for await (const chunk of req) trozos.push(chunk);
        const texto = Buffer.concat(trozos).toString("utf8");
        if (texto) cuerpo = JSON.parse(texto);
      } catch (error) {
        return responder(res, 400, { success: false, error: "Body inválido" });
      }

      const handler =
        url.pathname === "/api/auth" ? authHandler :
        url.pathname === "/api/users" ? usersHandler :
        url.pathname === "/api/content" ? contentHandler :
        null;

      if (!handler) {
        return responder(res, 404, {
          success: false,
          error: "Este endpoint no está disponible en el modo local (solo /api/auth, /api/users y /api/content)."
        });
      }

      const query = Object.fromEntries(url.searchParams.entries());
      const reqSim = { method: req.method, query, body: cuerpo, headers: req.headers };
      // Las cabeceras se guardan y el end() escribe el cuerpo, porque no
      // todo lo que sirve la API es JSON: avatar-prenda devuelve el PNG
      // en bytes con su Content-Type. Sin esto, las prendas llegaban con
      // 200 y cero bytes y el maniquí salia en blanco.
      const cabeceras = {};
      const resSim = {
        statusCode: 200,
        setHeader(nombre, valor) { cabeceras[nombre] = valor; },
        status(codigo) { this.statusCode = codigo; return this; },
        json(obj) { this.ultimaRespuesta = obj; responder(res, this.statusCode || 200, obj); },
        end(cuerpoBinario) {
          if (res.writableEnded) return;
          res.writeHead(this.statusCode || 200, cabeceras);
          res.end(cuerpoBinario);
        }
      };

      // Antes de ejecutar el login, miramos cómo estaba guardada la
      // contraseña del usuario en la base local. Si tenía TEXTO PLANO
      // (usuario viejo) y el login tiene éxito, imprimimos el aviso de
      // migración. Los usuarios que ya tenían hash desde el registro
      // no imprimen nada: no hay nada que migrar.
      const esLogin = url.pathname === "/api/auth" && query.action === "login";
      let estadoPrevioLogin = null;
      if (esLogin && cuerpo && cuerpo.username) {
        const filasAntes = await db.query(
          "SELECT password, password_hash FROM users WHERE username = $1",
          [cuerpo.username]
        );
        if (filasAntes.rows[0]) {
          estadoPrevioLogin = { teniaTextoPlano: filasAntes.rows[0].password !== null };
        }
      }

      try {
        await handler(reqSim, resSim);
        if (esLogin && resSim.ultimaRespuesta && resSim.ultimaRespuesta.success &&
            estadoPrevioLogin && estadoPrevioLogin.teniaTextoPlano && cuerpo && cuerpo.username) {
          console.log(`\n"${cuerpo.username}" entró: su contraseña en texto plano fue migrada a hash.`);
        }
      } catch (error) {
        console.error("Error en el handler local:", error);
        if (!res.writableEnded) responder(res, 500, { success: false, error: error.message });
      }
      return;
    }

    // ----- /prendas/<huella>.png -----
    // La misma traducción que hace server.js, y del mismo módulo: la URL
    // con la huella del contenido es lo que permite cachear las prendas
    // un año, y el editor tiene que pedir aquí exactamente las mismas
    // direcciones que en el sitio de verdad.
    //
    // Antes esto era una copia de la expresión regular. Las copias se
    // quedan viejas: ver el comentario de api/_prendas-ruta.js.
    if (traducirRutaCanonica(url)) {
      req.url = url.pathname + url.search;
      return servidor.emit("request", req, res);
    }

    // ----- Archivos estáticos -----
    const rutaRelativa = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    const archivo = path.join(RAIZ, rutaRelativa);

    if (!archivo.startsWith(RAIZ)) {
      res.writeHead(403);
      return res.end("Prohibido");
    }

    // El arte de los avatares no sale por su nombre adivinable, igual que
    // en producción. Esto faltaba, y hacía que probar el cierre en local
    // dijera que no funcionaba cuando en el sitio de verdad sí: el
    // fichero está en el disco y este servidor lo servía tal cual.
    if (await esPrendaDeAvatar(rutaRelativa)) {
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

  servidor.listen(PUERTO, () => {
    console.log("\n==========================================");
    console.log(`  Sitio local: http://localhost:${PUERTO}`);
    if (MODO_REAL) {
      console.log("  Base:              COPIA DE PRODUCCION (datos-locales/pgdata)");
      console.log("  Usuarios reales, con la clave que puso npm run db:traer");
    } else {
      console.log("  Usuario de prueba: demo / demo1234");
      console.log("  Catálogo local:    " + (arte.sembradas || arte.yaEstaba) + " prendas, demo es artista y admin");
    }
    console.log("  Panel de arte:     http://localhost:" + PUERTO + "/arte.html");
    if (!MODO_REAL) console.log("  (entrá con él y mirá la consola: se migra a hash)");
    console.log("==========================================\n");
  });
}

main().catch((error) => {
  console.error("No se pudo arrancar el servidor local:", error);
  process.exit(1);
});

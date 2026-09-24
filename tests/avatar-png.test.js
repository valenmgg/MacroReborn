// ==============================
// TESTS DEL AVATAR PNG EN LAS LISTAS — tests/avatar-png.test.js
// ==============================
// Los avatares PNG del administrador guardan la imagen entera en base64
// dentro de users.avatar. Como esa columna viaja en TODAS las listas de
// usuarios, un solo avatar PNG hacía que /api/users pesara 1,35 MB, de
// los cuales 1,31 MB era una sola cuenta: los otros 41 avatares juntos
// ocupaban 14 kB.
//
// Lo que se prueba acá:
//   - En las listas el base64 NO viaja: va un puntero.
//   - El puntero cambia si el PNG cambia (para poder cachear un año).
//   - La lectura de un usuario puntual SÍ trae el base64 completo, que
//     es lo que el editor del perfil necesita para restaurar.
//   - Los avatares normales (recetas de capas) pasan intactos.
//   - El endpoint devuelve un PNG de verdad, con su firma.
//
// Correr:  npm test

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret";

require("./_aislar-datos");   // antes de api/: ver ese archivo

const { test, before } = require("node:test");
const assert = require("node:assert");

const { crearBaseLocal, crearSqlPGlite } = require("../scripts/pglite");
const { usarSqlLocal } = require("../api/_db");

let db;
let sql;
let usersHandler;

// Un PNG real de 1x1 px: empieza con la firma que el endpoint comprueba.
const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_OTRO =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const DATA_PNG = "data:image/png;base64," + PNG_1PX;

before(async () => {
  db = await crearBaseLocal();
  sql = crearSqlPGlite(db);
  usarSqlLocal(sql);

  usersHandler = require("../api/users");
});

// Imita el adaptador real de server.js, incluyendo el detalle que
// importa: end(cuerpo) tiene que ESCRIBIR ese cuerpo. Una maqueta más
// permisiva que el servidor real deja pasar fallos que solo aparecen en
// producción; de hecho pasó: estos tests daban verde mientras el
// servidor devolvía la imagen vacía, porque su end() ignoraba el
// argumento.
function llamar(metodo, query) {
  return new Promise((resolve) => {
    const req = { method: metodo, query: query || {}, body: {}, headers: {} };
    const cabeceras = {};
    const res = {
      statusCode: 200,
      status(codigo) { this.statusCode = codigo; return this; },
      setHeader(k, v) { cabeceras[k] = v; },
      json(obj) { resolve({ codigo: this.statusCode, cuerpo: obj, cabeceras }); },
      end(cuerpo) { resolve({ codigo: this.statusCode, cuerpo, cabeceras }); }
    };
    usersHandler(req, res);
  });
}

// Y esta es la prueba de que el adaptador de verdad escribe el cuerpo:
// se le pasa el mismo objeto que arma server.js sobre una respuesta HTTP
// simulada, en vez de una maqueta escrita a mano.
function llamarComoServidor(metodo, query) {
  return new Promise((resolve) => {
    const trozos = [];
    const cabeceras = {};
    let terminado = false;

    const respuestaHTTP = {
      get writableEnded() { return terminado; },
      getHeader(nombre) { return cabeceras[nombre]; },
      setHeader(nombre, valor) { cabeceras[nombre] = valor; },
      writeHead(codigo, extra) {
        respuestaHTTP.statusCode = codigo;
        if (extra) Object.assign(cabeceras, extra);
      },
      end(cuerpo) {
        terminado = true;
        if (cuerpo) trozos.push(Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.from(String(cuerpo)));
        resolve({
          codigo: respuestaHTTP.statusCode || 200,
          cuerpo: Buffer.concat(trozos),
          cabeceras
        });
      },
      statusCode: 200
    };

    const resSim = {
      statusCode: 200,
      setHeader(nombre, valor) { respuestaHTTP.setHeader(nombre, valor); },
      status(codigo) { this.statusCode = codigo; return this; },
      json(obj) {
        if (respuestaHTTP.writableEnded) return;
        if (!respuestaHTTP.getHeader("Content-Type")) {
          respuestaHTTP.setHeader("Content-Type", "application/json; charset=utf-8");
        }
        respuestaHTTP.writeHead(this.statusCode || 200);
        respuestaHTTP.end(JSON.stringify(obj));
      },
      end(cuerpo) {
        if (respuestaHTTP.writableEnded) return;
        respuestaHTTP.writeHead(this.statusCode || 200);
        respuestaHTTP.end(cuerpo);
      }
    };

    usersHandler({ method: metodo, query: query || {}, body: {}, headers: {} }, resSim);
  });
}

async function crearUsuario(username, avatar) {
  await db.query(
    `INSERT INTO users (username, password_hash, level, xp, status, created_at, last_login, avatar)
     VALUES ($1, 'hash-de-prueba', 1, 0, 'active', now(), now(), $2)`,
    [username, avatar === undefined ? null : JSON.stringify(avatar)]
  );
}

function buscarEnLista(lista, username) {
  return lista.find(u => u.username === username);
}

// ==============================

test("en la lista, un avatar PNG viaja como puntero y no como base64", async () => {
  await crearUsuario("admin_png", {
    tipo: "png",
    src: DATA_PNG,
    restaurar: { modelo: "tora", remera: "tora_remera1" }
  });

  const r = await llamar("GET", { limit: "500" });
  const usuario = buscarEnLista(r.cuerpo.users, "admin_png");

  assert.equal(usuario.avatar.tipo, "png");
  assert.equal(usuario.avatar.src, undefined, "el base64 no debe viajar en la lista");
  assert.ok(
    usuario.avatar.url.startsWith("/api/users?action=avatar-png"),
    "debe venir un puntero a la imagen: " + usuario.avatar.url
  );
  assert.match(usuario.avatar.url, /username=admin_png/);

  // El peso es el punto de todo esto.
  assert.ok(
    JSON.stringify(usuario).length < 600,
    "el usuario con PNG debe pesar poco: pesó " + JSON.stringify(usuario).length
  );
});

test("la receta a restaurar sí viaja: el perfil la necesita", async () => {
  const r = await llamar("GET", { limit: "500" });
  const usuario = buscarEnLista(r.cuerpo.users, "admin_png");

  assert.deepEqual(usuario.avatar.restaurar, { modelo: "tora", remera: "tora_remera1" });
});

test("el puntero cambia cuando cambia el PNG", async () => {
  // Es lo que permite cachear la imagen un año sin quedarse nunca con
  // la vieja: la URL lleva la huella del contenido.
  const antes = buscarEnLista((await llamar("GET", {})).cuerpo.users, "admin_png").avatar.url;

  await db.query(
    `UPDATE users SET avatar = $1 WHERE username = 'admin_png'`,
    [JSON.stringify({ tipo: "png", src: "data:image/png;base64," + PNG_OTRO, restaurar: null })]
  );

  const despues = buscarEnLista((await llamar("GET", {})).cuerpo.users, "admin_png").avatar.url;

  assert.notEqual(antes, despues, "si el PNG cambia, la URL tiene que cambiar");
});

test("un avatar normal de capas pasa intacto", async () => {
  const receta = { modelo: "tora", remera: "tora_remera3", pelo: "ninguno" };
  await crearUsuario("persona_normal", receta);

  const r = await llamar("GET", {});
  const usuario = buscarEnLista(r.cuerpo.users, "persona_normal");

  assert.deepEqual(usuario.avatar, receta, "las recetas de capas no se tocan");
});

test("un usuario sin avatar sigue sin avatar", async () => {
  await crearUsuario("sin_avatar", undefined);

  const r = await llamar("GET", {});
  const usuario = buscarEnLista(r.cuerpo.users, "sin_avatar");

  assert.equal(usuario.avatar, null);
});

test("la búsqueda por nombre también aligera el PNG", async () => {
  // El buscador usa ?q= y dibuja el avatar de cada resultado: si esta
  // rama no se aligerara, el agujero seguiría abierto por ahí.
  const r = await llamar("GET", { q: "admin_png" });
  const usuario = buscarEnLista(r.cuerpo.users, "admin_png");

  assert.equal(usuario.avatar.src, undefined);
  assert.ok(usuario.avatar.url.startsWith("/api/users?action=avatar-png"));
});

test("la lectura de UN usuario sí trae el base64 completo", async () => {
  // Acá el avatar es justamente lo que se fue a buscar, y el editor del
  // perfil necesita la imagen entera para poder restaurarla.
  const r = await llamar("GET", { username: "admin_png" });

  assert.equal(r.cuerpo.success, true);
  assert.ok(
    r.cuerpo.user.avatar.src.startsWith("data:image/png;base64,"),
    "el perfil propio necesita el PNG completo"
  );
});

test("el endpoint devuelve un PNG de verdad", async () => {
  await db.query(
    `UPDATE users SET avatar = $1 WHERE username = 'admin_png'`,
    [JSON.stringify({ tipo: "png", src: DATA_PNG, restaurar: null })]
  );

  const r = await llamar("GET", { action: "avatar-png", username: "admin_png" });

  assert.equal(r.codigo, 200);
  assert.equal(r.cabeceras["Content-Type"], "image/png");
  assert.ok(Buffer.isBuffer(r.cuerpo), "debe devolver bytes, no JSON");

  // Firma de un archivo PNG: los 8 bytes con los que empieza siempre.
  assert.deepEqual(
    [...r.cuerpo.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
    "no es un PNG válido"
  );
});

test("el PNG se cachea, porque la URL lleva la huella", async () => {
  const r = await llamar("GET", { action: "avatar-png", username: "admin_png" });

  assert.match(r.cabeceras["Cache-Control"], /max-age=31536000/);
  assert.match(r.cabeceras["Cache-Control"], /immutable/);
});

test("pedir el PNG de alguien que no tiene da 404", async () => {
  const r = await llamar("GET", { action: "avatar-png", username: "persona_normal" });

  assert.equal(r.codigo, 404);
  assert.equal(r.cuerpo.success, false);
});

test("pedir el PNG de un usuario inexistente da 404 y no revienta", async () => {
  const r = await llamar("GET", { action: "avatar-png", username: "no_existe_nadie_asi" });

  assert.equal(r.codigo, 404);
});

test("pedir el PNG sin decir de quién da 400", async () => {
  const r = await llamar("GET", { action: "avatar-png" });

  assert.equal(r.codigo, 400);
});

test("los bytes llegan de verdad por el camino del servidor", async () => {
  // El test de más arriba comprueba qué le pasa el handler a res.end().
  // Este comprueba que el adaptador de server.js efectivamente lo
  // escriba. Es la diferencia que dejó pasar un fallo real: la respuesta
  // salía con Content-Type: image/png y Content-Length correcto, pero
  // con cero bytes de cuerpo, porque aquel end() ignoraba su argumento.
  const r = await llamarComoServidor("GET", { action: "avatar-png", username: "admin_png" });

  assert.equal(r.codigo, 200);
  assert.equal(r.cabeceras["Content-Type"], "image/png");
  assert.ok(r.cuerpo.length > 0, "la respuesta no puede salir vacía");
  assert.deepEqual(
    [...r.cuerpo.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
    "los bytes que llegan no son un PNG"
  );
});

test("y el JSON sigue saliendo como JSON por ese mismo camino", async () => {
  // El arreglo tocó json() además de end(): hay que ver que no se haya
  // roto lo que ya funcionaba.
  const r = await llamarComoServidor("GET", { limit: "500" });

  assert.equal(r.codigo, 200);
  assert.match(r.cabeceras["Content-Type"], /application\/json/);

  const datos = JSON.parse(r.cuerpo.toString("utf8"));
  assert.equal(datos.success, true);
  assert.ok(Array.isArray(datos.users));
});

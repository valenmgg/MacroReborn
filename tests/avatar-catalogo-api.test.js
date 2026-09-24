// ==============================
// TESTS DEL ENDPOINT DE CATÁLOGO — tests/avatar-catalogo-api.test.js
// ==============================
// El catálogo de prendas se sirve desde la base, y desde este cambio se
// sirve PARTIDO EN DOS, porque son dos trabajos distintos con dos
// públicos distintos:
//
//   avatar-catalogo            público, sin sesión. Solo valor -> URL, y
//                              solo de las prendas que alguien LLEVA
//                              PUESTAS. Es lo justo para DIBUJAR.
//
//   avatar-catalogo-completo   pide sesión. Nombres, ranuras, precios,
//                              retiradas: el catálogo entero. Es lo que
//                              necesita el editor para VESTIR.
//
// Antes esto era una sola acción pública que entregaba las 630 prendas
// con su URL a quien preguntara. Una petición daba el mapa completo y
// 630 descargas daban el arte: 6,6 MB. Esa es la razón de ser de este
// archivo.
//
// (No confundir con tests/avatar-catalogo.test.js, que prueba el módulo
// api/_avatar-catalogo.js, el que valida avatares.)
//
// Correr:  npm test

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret";

require("./_aislar-datos");   // antes de api/: ver ese archivo

const { test, before } = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");

const { crearBaseLocal, crearSqlPGlite } = require("../scripts/pglite");
const { usarSqlLocal } = require("../api/_db");
const { crearToken } = require("../api/_auth");

let db;
let contentHandler;
let sesion;

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

async function meterArchivo(semilla) {
  // Un contenido distinto por semilla, para que cada prenda tenga su
  // propia huella.
  const datos = Buffer.concat([PNG, Buffer.from(String(semilla))]);
  const sha = crypto.createHash("sha256").update(datos).digest("hex");
  const res = await db.query(
    `INSERT INTO avatar_archivos (sha256, datos, ancho, alto, peso)
     VALUES ($1, $2, 1, 1, $3) RETURNING id`,
    [sha, datos, datos.length]
  );
  return { id: res.rows[0].id, sha };
}

async function meterPrenda(valor, modelo, capa, nombre, publicada, semilla) {
  const archivo = await meterArchivo(semilla);
  await db.query(
    `INSERT INTO avatar_prendas (valor, modelo, capa, nombre, archivo_id, publicada)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [valor, modelo, capa, nombre, archivo.id, publicada]
  );
  return archivo.sha;
}

async function meterUsuario(username, avatar) {
  const res = await db.query(
    `INSERT INTO users (username, password_hash, level, xp, status, created_at, last_login, avatar)
     VALUES ($1, 'hash-de-prueba', 1, 0, 'active', now(), now(), $2) RETURNING id`,
    [username, avatar === undefined || avatar === null ? null : JSON.stringify(avatar)]
  );
  return res.rows[0].id;
}

let shaBotas;
let shaRetirada;

before(async () => {
  db = await crearBaseLocal();
  usarSqlLocal(crearSqlPGlite(db));
  contentHandler = require("../api/content");

  // Se usa un modelo inventado, "prueba", y no uno real: la migración
  // 012 ya siembra la tienda con prendas de tora y cereza, y chocaría.
  await meterPrenda("prueba", "prueba", "modelo", "Prueba", true, "m1");
  shaBotas = await meterPrenda("prueba_botas1", "prueba", "botas", "Botas de combate", true, "p1");
  await meterPrenda("prueba_remera1", "prueba", "remera", "Remera 1", true, "p2");

  // Publicada y que NO lleva nadie. Es la que prueba que el índice
  // público no enumera el catálogo: existe, se puede comprar, y aun así
  // no tiene por qué salir en una respuesta anónima.
  await meterPrenda("prueba_guantes1", "prueba", "guantes", "Guantes 1", true, "p4");

  // Apagada: es arte recuperado que todavía no se miró.
  await meterPrenda("prueba_boca9", "prueba", "boca", "Boca 9", false, "p3");

  // Retirada PERO puesta: quien ya la llevaba tiene que seguir viéndola.
  shaRetirada = await meterPrenda("prueba_pelo9", "prueba", "pelo", "Pelo 9", false, "p5");

  // Y una de pago, para comprobar que el precio llega.
  await db.query(
    `INSERT INTO avatar_shop_items (categoria, modelo, valor_capa, nombre, precio)
     VALUES ('botas', 'prueba', 'prueba_botas1', 'Botas de combate', 140)`
  );

  // Alguien que lleva puestas las botas y la retirada.
  const id = await meterUsuario("vestida", {
    modelo: "prueba",
    botas: "prueba_botas1",
    pelo: "prueba_pelo9",
    remera: "ninguno"
  });
  sesion = crearToken({ id, username: "vestida" });

  // Y una segunda cuenta que solo tiene la remera GUARDADA en su
  // galería, sin llevarla puesta. Cuenta igual: saved_avatars es la otra
  // tabla donde vive un avatar.
  const id2 = await meterUsuario("guardadora", null);
  await db.query(
    `INSERT INTO saved_avatars (user_id, slot, avatar) VALUES ($1, 1, $2)`,
    [id2, JSON.stringify({ modelo: "prueba", remera: "prueba_remera1" })]
  );

  // Una tercera con un PNG subido a mano: no tiene capas y no debe
  // aportar nada al índice ni reventar el recorrido.
  await meterUsuario("pngera", { tipo: "png", src: "data:image/png;base64,AAAA" });
});

function llamar(accion, query, headers) {
  return new Promise((resolve) => {
    const cabeceras = {};
    const req = {
      method: "GET",
      query: Object.assign({ action: accion }, query || {}),
      body: {},
      headers: headers || {}
    };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      setHeader(k, v) { cabeceras[k] = v; },
      json(obj) { resolve({ codigo: this.statusCode, cuerpo: obj, cabeceras }); },
      end(cuerpo) { resolve({ codigo: this.statusCode, cuerpo, cabeceras }); }
    };
    contentHandler(req, res);
  });
}

// El índice público vive un minuto en memoria. En un test eso significa
// que un cambio hecho a mitad no se vería, así que se tira la caché
// antes de cada llamada. Ver invalidarIndicePublico() en api/content.js.
const publico = (query, headers) => {
  contentHandler.invalidarIndicePublico();
  return llamar("avatar-catalogo", query, headers);
};

const conSesion = (query, headers) =>
  llamar("avatar-catalogo-completo", query,
    Object.assign({ authorization: "Bearer " + sesion }, headers || {}));


// ==============================
// EL ÍNDICE PÚBLICO
// ==============================

test("el índice público no pide sesión", async () => {
  const r = await publico();

  assert.equal(r.codigo, 200);
  assert.equal(r.cuerpo.success, true);
  assert.ok(r.cuerpo.rutas, "debería traer el mapa de rutas");
});

test("trae lo que alguien lleva puesto, con su URL con huella", async () => {
  const r = await publico();

  assert.equal(r.cuerpo.rutas["prueba_botas1"], "/prendas/" + shaBotas + ".png");
});

test("NO trae una prenda publicada que no lleva nadie", async () => {
  const r = await publico();

  assert.ok(
    !("prueba_guantes1" in r.cuerpo.rutas),
    "el índice público no debe enumerar el catálogo: solo lo que está puesto"
  );
});

test("sí trae una retirada, si alguien la lleva puesta", async () => {
  const r = await publico();

  // Retirar una prenda la saca del editor, no del avatar de quien ya la
  // llevaba. Si no saliera acá, esa persona se vería sin pelo.
  assert.equal(r.cuerpo.rutas["prueba_pelo9"], "/prendas/" + shaRetirada + ".png");
});

test("también mira la galería, no solo el avatar puesto", async () => {
  const r = await publico();

  assert.equal(
    typeof r.cuerpo.rutas["prueba_remera1"], "string",
    "una prenda guardada en saved_avatars también hay que poder dibujarla"
  );
});

test("no se cuela 'ninguno' ni las claves de un avatar PNG", async () => {
  const r = await publico();

  assert.ok(!("ninguno" in r.cuerpo.rutas));
  assert.ok(!("tipo" in r.cuerpo.rutas), "un avatar PNG no aporta prendas");
  assert.ok(!("src" in r.cuerpo.rutas));
});

test("el índice público NO lleva nombres, precios ni ranuras", async () => {
  const r = await publico();
  const texto = JSON.stringify(r.cuerpo);

  assert.ok(!("prendas" in r.cuerpo), "eso es del catálogo completo");
  assert.ok(!("modelos" in r.cuerpo));
  assert.ok(!("capas" in r.cuerpo));
  assert.ok(!texto.includes("Botas de combate"), "ni un nombre de prenda");
  assert.ok(!texto.includes("140"), "ni un precio");
});

test("el índice público contesta 304 con el mismo ETag", async () => {
  const primera = await publico();
  const etag = primera.cabeceras["ETag"];

  assert.ok(etag, "debería mandar ETag");

  const segunda = await publico({}, { "if-none-match": etag });
  assert.equal(segunda.codigo, 304);
  assert.ok(!segunda.cuerpo, "un 304 no lleva cuerpo");
});

test("si alguien se pone una prenda nueva, el índice se entera", async () => {
  const antes = await publico();
  assert.ok(!("prueba_guantes1" in antes.cuerpo.rutas));

  await db.query(
    `UPDATE users SET avatar = $1 WHERE username = 'vestida'`,
    [JSON.stringify({ modelo: "prueba", botas: "prueba_botas1", guantes: "prueba_guantes1" })]
  );

  const despues = await publico();
  assert.ok(
    "prueba_guantes1" in despues.cuerpo.rutas,
    "al vestirla, la prenda tiene que poder dibujarse"
  );
  assert.notEqual(despues.cabeceras["ETag"], antes.cabeceras["ETag"]);
});


// ==============================
// EL CATÁLOGO COMPLETO
// ==============================

test("el catálogo completo sin sesión da 401", async () => {
  const r = await llamar("avatar-catalogo-completo");

  assert.equal(r.codigo, 401);
  assert.equal(r.cuerpo.success, false);
});

test("con sesión, separa los modelos base de las prendas", async () => {
  const r = await conSesion();

  assert.equal(r.codigo, 200);
  assert.equal(r.cuerpo.success, true);
  assert.deepEqual(r.cuerpo.modelos.map(m => m.valor), ["prueba"]);
  assert.ok(r.cuerpo.prendas.every(p => p.capa !== "modelo"));
});

test("solo salen las prendas publicadas", async () => {
  const r = await conSesion();
  const valores = r.cuerpo.prendas.map(p => p.valor);

  assert.ok(valores.includes("prueba_botas1"));
  assert.ok(valores.includes("prueba_remera1"));
  assert.ok(!valores.includes("prueba_boca9"), "lo apagado no debe ofrecerse");
});

test("el precio viene de la tienda, y null es gratis", async () => {
  const r = await conSesion();

  const botas = r.cuerpo.prendas.find(p => p.valor === "prueba_botas1");
  const remera = r.cuerpo.prendas.find(p => p.valor === "prueba_remera1");

  assert.equal(botas.precio, 140);
  assert.equal(remera.precio, null, "sin fila en la tienda = gratis");
});

test("cada prenda trae la URL con la huella de su dibujo", async () => {
  const r = await conSesion();
  const botas = r.cuerpo.prendas.find(p => p.valor === "prueba_botas1");

  assert.equal(botas.url, "/prendas/" + shaBotas + ".png");
});

test("y la de su previsualización cuando la tiene, o null si todavía no", async () => {
  // Es la miniatura del editor. Sin ella, el editor usa el dibujo suelto.
  await db.query("UPDATE avatar_prendas SET previsualizacion = $1 WHERE valor = 'prueba_botas1'", ["f".repeat(64)]);
  await db.query("UPDATE avatar_catalogo_version SET version = version + 1 WHERE id = 1");
  const id = (await db.query("SELECT id FROM avatar_prendas WHERE valor = 'prueba_botas1'")).rows[0].id;

  const r = await conSesion();
  const botas = r.cuerpo.prendas.find(p => p.valor === "prueba_botas1");
  assert.equal(botas.previsualizacion, "/previsualizaciones/" + id + ".jpg?v=ffffffffffff");
  const otras = r.cuerpo.prendas.filter(p => p.valor !== "prueba_botas1");
  assert.ok(otras.length > 0 && otras.every(p => p.previsualizacion === null));
});

test("manda las 15 capas en su orden de dibujo", async () => {
  const r = await conSesion();

  assert.equal(r.cuerpo.capas.length, 15);
  assert.equal(r.cuerpo.capas[0], "fondo");
  assert.equal(r.cuerpo.capas[r.cuerpo.capas.length - 1], "borde");
  // Las botas van ANTES que el pantalón: se dibujan debajo.
  assert.ok(
    r.cuerpo.capas.indexOf("botas") < r.cuerpo.capas.indexOf("pantalon"),
    "las botas deben dibujarse bajo el pantalón"
  );
});

test("el catálogo completo se cachea en privado, nunca compartido", async () => {
  const r = await conSesion();

  // Va detrás de una sesión y lleva el catálogo entero: si una caché
  // compartida se quedara con esta respuesta, la alcanzaría alguien sin
  // cuenta y este cambio no habría servido de nada.
  assert.match(r.cabeceras["Cache-Control"], /private/);
});

test("con el mismo ETag contesta 304 y no reenvía el catálogo", async () => {
  const primera = await conSesion();
  const etag = primera.cabeceras["ETag"];

  assert.ok(etag, "debería mandar ETag");

  const segunda = await conSesion({}, { "if-none-match": etag });
  assert.equal(segunda.codigo, 304);
  assert.ok(!segunda.cuerpo, "un 304 no lleva cuerpo");
});

test("al subir la versión, la caché en memoria se entera", async () => {
  // Este es el que cubre el fallo del cluster. El sitio corre dos
  // procesos y cada uno cachea el catálogo por su cuenta; si la caché no
  // mirara la versión, una prenda recién publicada aparecería y
  // desaparecería al recargar según quién contestara.
  const antes = await conSesion();
  assert.ok(!antes.cuerpo.prendas.some(p => p.valor === "prueba_pelo1"));

  await meterPrenda("prueba_pelo1", "prueba", "pelo", "Pelo 1", true, "p9");

  // Sin tocar la versión, la caché puede seguir sirviendo lo viejo.
  // Al subirla, tiene que reconstruir.
  await db.query("UPDATE avatar_catalogo_version SET version = version + 1 WHERE id = 1");

  const despues = await conSesion();
  assert.ok(
    despues.cuerpo.prendas.some(p => p.valor === "prueba_pelo1"),
    "la prenda nueva debería aparecer tras subir la versión"
  );
  assert.notEqual(despues.cuerpo.version, antes.cuerpo.version);
  assert.notEqual(despues.cabeceras["ETag"], antes.cabeceras["ETag"]);
});

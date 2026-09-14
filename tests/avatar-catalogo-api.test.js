// ==============================
// TESTS DEL ENDPOINT DE CATÁLOGO — tests/avatar-catalogo-api.test.js
// ==============================
// El catálogo de prendas deja de estar escrito a mano en perfil.html y
// pasa a servirse desde la base. Esto prueba el endpoint que lo entrega.
//
// (No confundir con tests/avatar-catalogo.test.js, que prueba el módulo
// api/_avatar-catalogo.js, el que valida avatares contra el disco.)
//
// Lo que se prueba acá:
//   - Separa los modelos base de las prendas.
//   - Solo salen las publicadas. Lo apagado no se ofrece.
//   - El precio sale de la tienda, y null significa gratis.
//   - Cada prenda trae su URL con la huella del dibujo.
//   - Manda las 15 capas en su orden de dibujo, para que el editor no
//     tenga que llevar su propia copia de esa lista.
//   - ETag y 304, para no rebajar ~90 kB en cada visita.
//   - Y el importante: al subir la versión, la caché en memoria se
//     entera. Es lo que evita que una prenda recién publicada aparezca
//     y desaparezca al recargar según cuál de los dos procesos del
//     cluster conteste.
//
// Correr:  npm test

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret";

const { test, before } = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");

const { crearBaseLocal, crearSqlPGlite } = require("../scripts/pglite");
const { usarSqlLocal } = require("../api/_db");

let db;
let contentHandler;

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

let shaBotas;

before(async () => {
  db = await crearBaseLocal();
  usarSqlLocal(crearSqlPGlite(db));
  contentHandler = require("../api/content");

  // Se usa un modelo inventado, "prueba", y no uno real: la migración
  // 012 ya siembra la tienda con prendas de tora y cereza, y chocaría.
  await meterPrenda("prueba", "prueba", "modelo", "Prueba", true, "m1");
  shaBotas = await meterPrenda("prueba_botas1", "prueba", "botas", "Botas de combate", true, "p1");
  await meterPrenda("prueba_remera1", "prueba", "remera", "Remera 1", true, "p2");

  // Apagada: es arte recuperado que todavía no se miró.
  await meterPrenda("prueba_boca9", "prueba", "boca", "Boca 9", false, "p3");

  // Y una de pago, para comprobar que el precio llega.
  await db.query(
    `INSERT INTO avatar_shop_items (categoria, modelo, valor_capa, nombre, precio)
     VALUES ('botas', 'prueba', 'prueba_botas1', 'Botas de combate', 140)`
  );
});

function llamar(query, headers) {
  return new Promise((resolve) => {
    const cabeceras = {};
    const req = {
      method: "GET",
      query: Object.assign({ action: "avatar-catalogo" }, query || {}),
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

// ==============================

test("separa los modelos base de las prendas", async () => {
  const r = await llamar();

  assert.equal(r.codigo, 200);
  assert.equal(r.cuerpo.success, true);
  assert.deepEqual(r.cuerpo.modelos.map(m => m.valor), ["prueba"]);
  assert.ok(r.cuerpo.prendas.every(p => p.capa !== "modelo"));
});

test("solo salen las prendas publicadas", async () => {
  const r = await llamar();
  const valores = r.cuerpo.prendas.map(p => p.valor);

  assert.ok(valores.includes("prueba_botas1"));
  assert.ok(valores.includes("prueba_remera1"));
  assert.ok(!valores.includes("prueba_boca9"), "lo apagado no debe ofrecerse");
});

test("el precio viene de la tienda, y null es gratis", async () => {
  const r = await llamar();

  const botas = r.cuerpo.prendas.find(p => p.valor === "prueba_botas1");
  const remera = r.cuerpo.prendas.find(p => p.valor === "prueba_remera1");

  assert.equal(botas.precio, 140);
  assert.equal(remera.precio, null, "sin fila en la tienda = gratis");
});

test("cada prenda trae la URL con la huella de su dibujo", async () => {
  const r = await llamar();
  const botas = r.cuerpo.prendas.find(p => p.valor === "prueba_botas1");

  assert.equal(botas.url, "/prendas/" + shaBotas + ".png");
});

test("manda las 15 capas en su orden de dibujo", async () => {
  const r = await llamar();

  assert.equal(r.cuerpo.capas.length, 15);
  assert.equal(r.cuerpo.capas[0], "fondo");
  assert.equal(r.cuerpo.capas[r.cuerpo.capas.length - 1], "borde");
  // Las botas van ANTES que el pantalón: se dibujan debajo.
  assert.ok(
    r.cuerpo.capas.indexOf("botas") < r.cuerpo.capas.indexOf("pantalon"),
    "las botas deben dibujarse bajo el pantalón"
  );
});

test("con el mismo ETag contesta 304 y no reenvía el catálogo", async () => {
  const primera = await llamar();
  const etag = primera.cabeceras["ETag"];

  assert.ok(etag, "debería mandar ETag");

  const segunda = await llamar({}, { "if-none-match": etag });
  assert.equal(segunda.codigo, 304);
  assert.ok(!segunda.cuerpo, "un 304 no lleva cuerpo");
});

test("al subir la versión, la caché en memoria se entera", async () => {
  // Este es el que cubre el fallo del cluster. El sitio corre dos
  // procesos y cada uno cachea el catálogo por su cuenta; si la caché no
  // mirara la versión, una prenda recién publicada aparecería y
  // desaparecería al recargar según quién contestara.
  const antes = await llamar();
  assert.ok(!antes.cuerpo.prendas.some(p => p.valor === "prueba_pelo1"));

  await meterPrenda("prueba_pelo1", "prueba", "pelo", "Pelo 1", true, "p9");

  // Sin tocar la versión, la caché puede seguir sirviendo lo viejo.
  // Al subirla, tiene que reconstruir.
  await db.query("UPDATE avatar_catalogo_version SET version = version + 1 WHERE id = 1");

  const despues = await llamar();
  assert.ok(
    despues.cuerpo.prendas.some(p => p.valor === "prueba_pelo1"),
    "la prenda nueva debería aparecer tras subir la versión"
  );
  assert.notEqual(despues.cuerpo.version, antes.cuerpo.version);
  assert.notEqual(despues.cabeceras["ETag"], antes.cabeceras["ETag"]);
});

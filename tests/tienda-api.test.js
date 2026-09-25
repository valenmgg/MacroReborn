// ==============================
// LA API DE LA TIENDA — tests/tienda-api.test.js
// ==============================
// GET /api/content?action=avatar-shop, el catálogo: qué se vende, cuánto
// se ha vendido cada cosa y a quién se le enseña el saldo. Contra el
// handler de verdad y una base PGlite local.
//
// Correr:  npm test

// Los handlers exigen una sesión firmada. Este secreto solo vive en el
// proceso de pruebas y nunca se usa en producción.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret";

require("./_aislar-datos");   // antes de api/: ver ese archivo

const { test, before, describe } = require("node:test");
const assert = require("node:assert");

const { crearBaseLocal, crearSqlPGlite } = require("../scripts/pglite");
const { usarSqlLocal } = require("../api/_db");
const { crearToken } = require("../api/_auth");

let db;
let handler;

before(async () => {
  db = await crearBaseLocal();
  usarSqlLocal(crearSqlPGlite(db));
  // Después de inyectar la base: los handlers la resuelven al cargarse.
  handler = require("../api/content");
});

function llamar(metodo, query, body, headers) {
  return new Promise((resolve) => {
    const cabeceras = {};
    const req = { method: metodo, query: query || {}, body: body || {}, headers: headers || {} };
    const res = {
      status(codigo) { this.statusCode = codigo; return this; },
      json(obj) { resolve({ codigo: this.statusCode, cuerpo: obj, cabeceras }); },
      end() { resolve({ codigo: this.statusCode, cuerpo: null, cabeceras }); },
      setHeader(nombre, valor) { cabeceras[nombre.toLowerCase()] = valor; }
    };
    handler(req, res);
  });
}

const catalogo = (headers, query) => llamar("GET", { action: "avatar-shop", ...(query || {}) }, null, headers);

async function persona(nombre, monedas) {
  const r = await db.query(
    `INSERT INTO users (username, password_hash, level, xp, status, created_at, last_login, monedas)
     VALUES ($1, 'hash', 1, 0, 'active', now(), now(), $2) RETURNING id`,
    [nombre, monedas == null ? 500 : monedas]);
  return r.rows[0].id;
}

const sesion = (id, username) => ({ authorization: "Bearer " + crearToken({ id, username }) });

// Una prenda en la tienda. Sin `prenda: false`, con su dibujo en el
// catálogo, publicado o no.
let semilla = 0;
async function enVenta(valor, opciones) {
  const { publicada = true, prenda = true, precio = 100 } = opciones || {};
  semilla++;
  if (prenda) {
    const arch = await db.query(
      `INSERT INTO avatar_archivos (sha256, datos, ancho, alto, peso) VALUES ($1, $2, 1, 1, 1) RETURNING id`,
      [String(semilla).padStart(64, "0"), Buffer.from([semilla % 256])]);
    await db.query(
      `INSERT INTO avatar_prendas (valor, modelo, capa, nombre, archivo_id, publicada)
       VALUES ($1, 'tora', 'pelo', $2, $3, $4)`,
      [valor, "Prenda " + valor, arch.rows[0].id, publicada]);
  }
  const r = await db.query(
    `INSERT INTO avatar_shop_items (categoria, modelo, valor_capa, nombre, precio)
     VALUES ('pelo', 'tora', $1, $2, $3) RETURNING id`,
    [valor, "Prenda " + valor, precio]);
  return r.rows[0].id;
}

async function apuntarCompra(userId, itemId, precioPagado) {
  await db.query(
    `INSERT INTO avatar_shop_purchases (user_id, item_id, precio_pagado) VALUES ($1, $2, $3)`,
    [userId, itemId, precioPagado]);
}

describe("el catálogo", () => {

  test("solo vende lo que se puede llevar", async () => {
    const publicada = await enVenta("tora_pelo900");
    const retirada = await enVenta("tora_pelo901", { publicada: false });
    const sinDibujo = await enVenta("tora_pelo902", { prenda: false });

    const { cuerpo } = await catalogo();
    const ids = cuerpo.items.map(i => i.id);
    assert.ok(ids.includes(publicada));
    assert.ok(!ids.includes(retirada), "se vende una prenda retirada");
    assert.ok(!ids.includes(sinDibujo), "se vende algo que no tiene dibujo");
  });

  test("cuenta las ventas pagadas, no las regaladas", async () => {
    const item = await enVenta("tora_pelo910");
    await apuntarCompra(await persona("antigua", 0), item, null);   // de antes de la 022
    await apuntarCompra(await persona("pagada", 0), item, 100);
    await apuntarCompra(await persona("regalada", 0), item, 0);      // la migración 022
    const nadie = await enVenta("tora_pelo911");

    const { cuerpo } = await catalogo();
    assert.equal(cuerpo.items.find(i => i.id === item).vendidas, 2);
    assert.equal(cuerpo.items.find(i => i.id === nadie).vendidas, 0);
  });

  test("sin sesión no enseña nada privado", async () => {
    const { cuerpo } = await catalogo(null, { username: "antigua" });
    assert.equal(cuerpo.success, true);
    assert.equal(cuerpo.monedas, null);
    assert.deepStrictEqual(cuerpo.comprados, []);
  });

  test("con sesión, el saldo y las compras de quien la tiene", async () => {
    const id = await persona("con_sesion", 730);
    const item = await enVenta("tora_pelo920");
    await apuntarCompra(id, item, 100);

    const { cuerpo, cabeceras } = await catalogo(sesion(id, "con_sesion"));
    assert.equal(cuerpo.monedas, 730);
    assert.deepStrictEqual(cuerpo.comprados, [item]);
    assert.equal(cabeceras["cache-control"], "private, no-store");
  });

  test("con la sesión de uno y el nombre de otro, nada privado", async () => {
    const curiosa = await persona("curiosa", 10);
    await persona("mirada", 999);
    const { cuerpo } = await catalogo(sesion(curiosa, "curiosa"), { username: "mirada" });
    assert.equal(cuerpo.monedas, null);
    assert.deepStrictEqual(cuerpo.comprados, []);
  });

  test("dos cuentas que solo cambian en mayúsculas: manda la sesión", async () => {
    // En producción hay parejas así. Antes se buscaba por nombre, sin
    // mayúsculas, y salía la que Postgres encontrara primero.
    await persona("jader", 111);
    const mayuscula = await persona("Jader", 222);
    const { cuerpo } = await catalogo(sesion(mayuscula, "Jader"), { username: "jader" });
    assert.equal(cuerpo.monedas, 222);
  });

});

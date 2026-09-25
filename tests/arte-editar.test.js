// ==============================
// EDITAR UNA PRENDA YA SUBIDA — tests/arte-editar.test.js
// ==============================
// POST /api/content?action=avatar-editar-prenda { id, nombre?, precio? }.
// Decidido el 24/09/2026:
//   - el precio lo cambia cualquiera del equipo de arte, en cualquier
//     prenda;
//   - el nombre, quien subió la prenda o un administrador.
// Lo demás que se prueba: que el nombre cambie a la vez en el editor y
// en la tienda, que una prenda sin precio lo estrene, que lo ya pagado
// no se toque, que se suba la versión del catálogo y que quede en el
// registro quién cambió qué.
//
// Correr:  npm test

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret";

require("./_aislar-datos");   // antes de api/: ver ese archivo

const { test, before, describe } = require("node:test");
const assert = require("node:assert");

const { crearBaseLocal, crearSqlPGlite } = require("../scripts/pglite");
const { usarSqlLocal } = require("../api/_db");
const { crearToken } = require("../api/_auth");

let db;
let handler;
const ids = {};

async function persona(username, badge) {
  const r = await db.query(
    `INSERT INTO users (username, password_hash, level, xp, status, created_at, last_login)
     VALUES ($1, 'hash', 1, 0, 'active', now(), now()) RETURNING id`, [username]);
  if (badge) await db.query(`INSERT INTO badges (user_id, badge_id) VALUES ($1, $2)`, [r.rows[0].id, badge]);
  return r.rows[0].id;
}

// Una prenda, con o sin fila en la tienda. Devuelve su id.
async function prenda(valor, capa, opciones) {
  const { autor = null, precio = null, publicada = true, nombre = "Prenda " + valor } = opciones || {};
  const modelo = valor.split("_")[0];
  const r = await db.query(
    `INSERT INTO avatar_prendas (valor, modelo, capa, nombre, archivo_id, autor_id, publicada)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [valor, modelo, capa, nombre, ids.archivo, autor, publicada]);
  if (precio !== null) {
    await db.query(
      `INSERT INTO avatar_shop_items (categoria, modelo, valor_capa, nombre, precio) VALUES ($1, $2, $3, $4, $5)`,
      [capa, modelo, valor, nombre, precio]);
  }
  return Number(r.rows[0].id);
}

const sesion = (id, username) => ({ authorization: "Bearer " + crearToken({ id, username }) });
const DIBUJANTE = () => sesion(ids.dibujante, "dibujante");
const OTRO = () => sesion(ids.otro, "otro_dibujante");
const JEFA = () => sesion(ids.jefa, "jefa");

// Llama a la ruta y se queda con lo que escriba en el registro, que en
// las pruebas no se enseña.
function editar(cuerpo, headers) {
  return new Promise((resolve) => {
    const registro = [];
    const original = console.log;
    console.log = (...partes) => registro.push(partes.join(" "));
    const req = { method: "POST", query: { action: "avatar-editar-prenda" }, body: cuerpo, headers: headers || {} };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      setHeader() {},
      json(obj) { console.log = original; resolve({ codigo: this.statusCode, cuerpo: obj, registro }); },
      end() { console.log = original; resolve({ codigo: this.statusCode, cuerpo: null, registro }); }
    };
    handler(req, res);
  });
}

const enLaTienda = async (valor) => (await db.query(
  "SELECT categoria, modelo, nombre, precio FROM avatar_shop_items WHERE valor_capa = $1", [valor])).rows[0] || null;
const nombreEnElEditor = async (id) => (await db.query("SELECT nombre FROM avatar_prendas WHERE id = $1", [id])).rows[0].nombre;
const version = async () => Number((await db.query("SELECT version FROM avatar_catalogo_version WHERE id = 1")).rows[0].version);

before(async () => {
  db = await crearBaseLocal();
  usarSqlLocal(crearSqlPGlite(db));
  handler = require("../api/content");

  ids.dibujante = await persona("dibujante", "artista");
  ids.otro = await persona("otro_dibujante", "artista");
  ids.jefa = await persona("jefa", "administrador");
  ids.cualquiera = await persona("cualquiera", null);

  const a = await db.query(
    `INSERT INTO avatar_archivos (sha256, datos, ancho, alto, peso) VALUES ($1, $2, 1, 1, 1) RETURNING id`,
    ["e".repeat(64), Buffer.from([1])]);
  ids.archivo = a.rows[0].id;
  ids.tora = await prenda("tora", "modelo");
});

describe("quién puede", () => {

  test("sin sesión, 401; sin el rol de arte, 403", async () => {
    const id = await prenda("tora_pelo901", "pelo", { autor: ids.dibujante, precio: 120 });
    assert.equal((await editar({ id, precio: 300 })).codigo, 401);
    assert.equal((await editar({ id, precio: 300 }, sesion(ids.cualquiera, "cualquiera"))).codigo, 403);
    assert.equal(Number((await enLaTienda("tora_pelo901")).precio), 120);
  });

  test("el precio, cualquiera del equipo y de cualquier prenda", async () => {
    // tora_pelo901 es de "dibujante"; la cambia otro artista.
    const id = Number((await db.query("SELECT id FROM avatar_prendas WHERE valor = 'tora_pelo901'")).rows[0].id);
    const r = await editar({ id, precio: 300 }, OTRO());
    assert.equal(r.codigo, 200);
    assert.deepStrictEqual(r.cuerpo.prenda, { id, nombre: "Prenda tora_pelo901", precio: 300 });
    assert.equal(Number((await enLaTienda("tora_pelo901")).precio), 300);

    // Y una del catálogo original, que no tiene autor.
    const original = await prenda("tora_pelo902", "pelo", { precio: 120 });
    assert.equal((await editar({ id: original, precio: 90 }, OTRO())).codigo, 200);
    assert.equal(Number((await enLaTienda("tora_pelo902")).precio), 90);
  });

  test("el nombre, solo quien la subió o un administrador", async () => {
    const mia = await prenda("tora_remera901", "remera", { autor: ids.dibujante, precio: 100 });
    const original = await prenda("tora_remera902", "remera", { precio: 100 });

    const ajeno = await editar({ id: mia, nombre: "Me la quedo" }, OTRO());
    assert.equal(ajeno.codigo, 403);
    assert.match(ajeno.cuerpo.error, /nombre/i);
    assert.equal((await editar({ id: original, nombre: "Tampoco" }, DIBUJANTE())).codigo, 403);

    assert.equal((await editar({ id: mia, nombre: "Remera de rayas" }, DIBUJANTE())).codigo, 200);
    assert.equal((await editar({ id: original, nombre: "Remera clásica" }, JEFA())).codigo, 200);
    assert.equal(await nombreEnElEditor(mia), "Remera de rayas");
    assert.equal(await nombreEnElEditor(original), "Remera clásica");
  });

  test("si el nombre no le toca, no cambia nada, tampoco el precio", async () => {
    // Todo o nada: un 403 por el nombre no deja cambiado el precio.
    const mia = await prenda("tora_remera903", "remera", { autor: ids.dibujante, precio: 100 });
    const r = await editar({ id: mia, nombre: "Otro", precio: 500 }, OTRO());
    assert.equal(r.codigo, 403);
    assert.equal(Number((await enLaTienda("tora_remera903")).precio), 100);
  });

});

describe("qué cambia", () => {

  test("el nombre, a la vez en el editor y en la tienda", async () => {
    const id = await prenda("tora_botas901", "botas", { autor: ids.dibujante, precio: 90 });
    await editar({ id, nombre: "  Botas altas  " }, DIBUJANTE());
    assert.equal(await nombreEnElEditor(id), "Botas altas");
    assert.equal((await enLaTienda("tora_botas901")).nombre, "Botas altas");
  });

  test("una prenda sin precio lo estrena con su fila de la tienda", async () => {
    const id = await prenda("tora_boca903", "boca", { autor: ids.dibujante, publicada: false, nombre: "Boca borrador" });
    assert.equal(await enLaTienda("tora_boca903"), null);
    const r = await editar({ id, precio: 75 }, OTRO());
    assert.equal(r.codigo, 200);
    assert.deepStrictEqual(await enLaTienda("tora_boca903"), { categoria: "boca", modelo: "tora", nombre: "Boca borrador", precio: 75 });
  });

  test("lo que ya se pagó no se toca", async () => {
    const id = await prenda("tora_guantes901", "guantes", { precio: 70 });
    const item = (await db.query("SELECT id FROM avatar_shop_items WHERE valor_capa = 'tora_guantes901'")).rows[0].id;
    await db.query("INSERT INTO avatar_shop_purchases (user_id, item_id, precio_pagado) VALUES ($1, $2, 70)", [ids.cualquiera, item]);

    await editar({ id, precio: 700 }, OTRO());
    const compra = await db.query("SELECT precio_pagado FROM avatar_shop_purchases WHERE item_id = $1", [item]);
    assert.equal(compra.rows[0].precio_pagado, 70);
  });

  test("sube la versión del catálogo, para que el editor se entere", async () => {
    const id = await prenda("tora_ojos901", "ojos", { precio: 80 });
    const antes = await version();
    await editar({ id, precio: 85 }, OTRO());
    assert.ok(await version() > antes);
  });

  test("queda en el registro quién cambió qué, y nada si no cambió nada", async () => {
    const id = await prenda("tora_cara901", "cara", { autor: ids.dibujante, precio: 50, nombre: "Cara 1" });
    const r = await editar({ id, nombre: "Cara seria", precio: 65 }, DIBUJANTE());
    assert.deepStrictEqual(r.registro, ['[arte] dibujante cambió tora_cara901: nombre "Cara 1" -> "Cara seria", precio 50 -> 65']);

    const igual = await editar({ id, precio: 65 }, DIBUJANTE());
    assert.equal(igual.codigo, 200);
    assert.deepStrictEqual(igual.registro, []);
  });

});

describe("qué se rechaza", () => {

  test("precios fuera de 1 a 100.000", async () => {
    const id = await prenda("tora_fondo901", "fondo", { precio: 130 });
    for (const precio of [0, -1, 1.5, 100001, "abc", null]) {
      const r = await editar({ id, precio }, OTRO());
      assert.equal(r.codigo, 400, "precio " + precio);
      assert.match(r.cuerpo.error, /precio/i);
    }
    assert.equal(Number((await enLaTienda("tora_fondo901")).precio), 130);
  });

  test("nombres vacíos o de más de 60", async () => {
    const id = await prenda("tora_fondo902", "fondo", { precio: 130 });
    for (const nombre of ["", "   ", "x".repeat(61)]) {
      const r = await editar({ id, nombre }, JEFA());
      assert.equal(r.codigo, 400, JSON.stringify(nombre));
      assert.match(r.cuerpo.error, /nombre/i);
    }
  });

  test("sin prenda, sin nada que cambiar, una que no existe o un personaje", async () => {
    const id = await prenda("tora_fondo903", "fondo", { precio: 130 });
    assert.equal((await editar({ precio: 100 }, JEFA())).codigo, 400);
    assert.equal((await editar({ id }, JEFA())).codigo, 400);
    assert.equal((await editar({ id: 999999, precio: 100 }, JEFA())).codigo, 404);
    const modelo = await editar({ id: ids.tora, precio: 100 }, JEFA());
    assert.equal(modelo.codigo, 400);
    assert.match(modelo.cuerpo.error, /personajes/i);
  });

});

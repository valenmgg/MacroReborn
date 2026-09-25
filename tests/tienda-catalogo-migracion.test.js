// ==============================
// LA TIENDA ENTERA — tests/tienda-catalogo-migracion.test.js
// ==============================
// La migración 022 pone a la venta, con un precio por tipo, todas las
// prendas publicadas que no lo tenían; regala las que alguien ya llevaba
// puestas o guardadas; y añade precio_pagado a las compras. Decidido el
// 24/09/2026. Ver la cabecera de migrations/022_tienda_catalogo_entero.sql.
//
// La base de las pruebas se crea con todas las migraciones, pero sin
// prendas: aquí se siembran después y se vuelve a aplicar la 022, que
// tiene que poder aplicarse más de una vez.
//
// Correr:  npm test

require("./_aislar-datos");   // antes de api/: ver ese archivo

const { test, before, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { crearBaseLocal } = require("../scripts/pglite");

const MIGRACION = fs.readFileSync(path.join(__dirname, "..", "migrations", "022_tienda_catalogo_entero.sql"), "utf8");

let db;
const ids = {};

let semilla = 0;
async function prenda(valor, capa, publicada, creada) {
  semilla++;
  const arch = await db.query(
    `INSERT INTO avatar_archivos (sha256, datos, ancho, alto, peso) VALUES ($1, $2, 1, 1, 1) RETURNING id`,
    [String(semilla).padStart(64, "0"), Buffer.from([semilla])]);
  await db.query(
    `INSERT INTO avatar_prendas (valor, modelo, capa, nombre, archivo_id, publicada, created_at)
     VALUES ($1, 'tora', $2, $3, $4, $5, COALESCE($6::timestamp, now()))`,
    [valor, capa, "Nombre de " + valor, arch.rows[0].id, publicada, creada || null]);
}

async function persona(nombre, avatar) {
  const r = await db.query(
    `INSERT INTO users (username, password_hash, level, xp, status, created_at, last_login, avatar)
     VALUES ($1, 'hash', 1, 0, 'active', now(), now(), $2) RETURNING id`,
    [nombre, avatar ? JSON.stringify(avatar) : null]);
  return Number(r.rows[0].id);
}

const precioDe = async (valor) => {
  const r = await db.query("SELECT precio FROM avatar_shop_items WHERE valor_capa = $1", [valor]);
  return r.rows.length ? r.rows[0].precio : null;
};
const compras = async (userId) => (await db.query(
  `SELECT s.valor_capa, c.precio_pagado FROM avatar_shop_purchases c
   JOIN avatar_shop_items s ON s.id = c.item_id WHERE c.user_id = $1 ORDER BY 1`, [userId])).rows;

before(async () => {
  db = await crearBaseLocal();

  await prenda("tora", "modelo", true);
  await prenda("tora_pelo50", "pelo", true, "2026-07-01 12:00:00");
  await prenda("tora_fondo50", "fondo", true);
  await prenda("tora_boca50", "boca", true);
  await prenda("tora_mascota50", "mascota", true);
  await prenda("tora_espalda50", "espalda", true);
  await prenda("tora_piel50", "piel", true);
  await prenda("tora_remera50", "remera", true);   // esta ya la vende el equipo de arte
  await prenda("tora_pelo51", "pelo", false);      // sin publicar

  await db.query(
    `INSERT INTO avatar_shop_items (categoria, modelo, valor_capa, nombre, precio)
     VALUES ('remera', 'tora', 'tora_remera50', 'Remera del equipo', 7300)`);

  ids.ana = await persona("ana", { modelo: "tora", pelo: "tora_pelo50", remera: "tora_remera50" });
  ids.beto = await persona("beto", { modelo: "tora" });
  await db.query(`INSERT INTO saved_avatars (user_id, slot, avatar) VALUES ($1, 1, $2)`,
    [ids.beto, JSON.stringify({ modelo: "tora", fondo: "tora_fondo50" })]);
  ids.carla = await persona("carla", null);
  ids.jefa = await persona("jefa", { tipo: "png", src: "data:image/png;base64,AAAA", restaurar: { pelo: "tora_boca50" } });

  await db.exec(MIGRACION);
});

describe("la migración 022", () => {

  test("añade precio_pagado a las compras", async () => {
    const r = await db.query(`SELECT data_type FROM information_schema.columns
      WHERE table_name = 'avatar_shop_purchases' AND column_name = 'precio_pagado'`);
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].data_type, "integer");
  });

  test("pone precio por tipo a lo publicado que no lo tenía", async () => {
    assert.equal(await precioDe("tora_boca50"), 50);
    assert.equal(await precioDe("tora_piel50"), 80);
    assert.equal(await precioDe("tora_pelo50"), 120);
    assert.equal(await precioDe("tora_fondo50"), 130);
    assert.equal(await precioDe("tora_espalda50"), 150);
    assert.equal(await precioDe("tora_mascota50"), 220);
  });

  test("y no toca el precio que puso el equipo de arte", async () => {
    const r = await db.query("SELECT nombre, precio FROM avatar_shop_items WHERE valor_capa = 'tora_remera50'");
    assert.deepStrictEqual(r.rows[0], { nombre: "Remera del equipo", precio: 7300 });
  });

  test("ni vende el personaje base, ni lo que no está publicado", async () => {
    assert.equal(await precioDe("tora"), null);
    assert.equal(await precioDe("tora_pelo51"), null);
  });

  test("lleva la fecha de la prenda, para que no salgan como novedades", async () => {
    const r = await db.query("SELECT created_at::text AS f FROM avatar_shop_items WHERE valor_capa = 'tora_pelo50'");
    assert.match(r.rows[0].f, /^2026-07-01 12:00:00/);
  });

  test("regala a 0 lo que alguien ya llevaba puesto o guardado", async () => {
    // ana lleva el pelo; beto tiene el fondo en una ranura guardada.
    assert.deepStrictEqual(await compras(ids.ana), [{ valor_capa: "tora_pelo50", precio_pagado: 0 }]);
    assert.deepStrictEqual(await compras(ids.beto), [{ valor_capa: "tora_fondo50", precio_pagado: 0 }]);
  });

  test("pero no lo que ya estaba en la tienda, ni nada a quien no lleva nada", async () => {
    // La remera ya se vendía: ana la lleva sin haberla comprado y la
    // conserva como siempre, pero esta migración no se la regala.
    const deAna = (await compras(ids.ana)).map(c => c.valor_capa);
    assert.ok(!deAna.includes("tora_remera50"));
    assert.deepStrictEqual(await compras(ids.carla), []);
    // Un avatar PNG no tiene prendas puestas.
    assert.deepStrictEqual(await compras(ids.jefa), []);
  });

  test("se puede aplicar otra vez sin cambiar nada", async () => {
    const contar = async () => {
      const r = await db.query(`SELECT (SELECT count(*) FROM avatar_shop_items)::int AS items,
                                       (SELECT count(*) FROM avatar_shop_purchases)::int AS compras`);
      return r.rows[0];
    };
    const antes = await contar();
    await db.exec(MIGRACION);
    assert.deepStrictEqual(await contar(), antes);
  });

});

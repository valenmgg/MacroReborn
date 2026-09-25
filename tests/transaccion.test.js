// ==============================
// sql.transaccion — tests/transaccion.test.js
// ==============================
// Cada sql`...` suelto va a la conexión del Pool que esté libre, así que
// hasta ahora no había forma de hacer dos cosas "juntas o ninguna". La
// tienda lo necesita: cobrar y apuntar la compra (avatarShopBuy en
// api/content.js). sql.transaccion(fn) reserva una conexión, abre la
// transacción y la cierra con COMMIT si fn termina o con ROLLBACK si
// lanza.
//
// Se prueban los dos adaptadores: el de producción (api/_pg.js), con un
// Pool de mentira que apunta lo que recibe, y el de las pruebas y el
// servidor local (scripts/pglite.js), con una base de verdad.
//
// Correr:  npm test

require("./_aislar-datos");   // antes de api/: ver ese archivo

const { test, describe } = require("node:test");
const assert = require("node:assert");

const { crearSqlPg } = require("../api/_pg");
const { crearBaseLocal, crearSqlPGlite } = require("../scripts/pglite");

// Un Pool de mentira: apunta cada consulta y de qué conexión vino.
function poolDeMentira() {
  const registro = [];
  let liberadas = 0;
  const cliente = {
    query: async (texto) => { registro.push("cliente: " + texto.trim()); return { rows: [{ ok: 1 }] }; },
    release: () => { liberadas++; }
  };
  return {
    registro,
    liberadas: () => liberadas,
    query: async (texto) => { registro.push("pool: " + texto.trim()); return { rows: [] }; },
    connect: async () => cliente
  };
}

describe("sql.transaccion en producción (api/_pg.js)", () => {

  test("abre, hace lo suyo en UNA conexión, confirma y la devuelve", async () => {
    const pool = poolDeMentira();
    const sql = crearSqlPg(pool);

    const r = await sql.transaccion(async (tx) => {
      await tx`UPDATE users SET monedas = monedas - ${10} WHERE id = ${1}`;
      return "hecho";
    });

    assert.equal(r, "hecho");
    assert.deepStrictEqual(pool.registro, [
      "cliente: BEGIN",
      "cliente: UPDATE users SET monedas = monedas - $1 WHERE id = $2",
      "cliente: COMMIT"
    ]);
    assert.equal(pool.liberadas(), 1);
  });

  test("si algo lanza, deshace, devuelve la conexión y relanza el mismo error", async () => {
    const pool = poolDeMentira();
    const sql = crearSqlPg(pool);
    const error = new Error("no te alcanza");

    await assert.rejects(() => sql.transaccion(async (tx) => {
      await tx`INSERT INTO avatar_shop_purchases (user_id, item_id) VALUES (${1}, ${2})`;
      throw error;
    }), (e) => e === error);

    assert.equal(pool.registro[0], "cliente: BEGIN");
    assert.equal(pool.registro[pool.registro.length - 1], "cliente: ROLLBACK");
    assert.ok(!pool.registro.includes("cliente: COMMIT"));
    assert.equal(pool.liberadas(), 1);
  });

  test("y las consultas sueltas siguen yendo al Pool, como siempre", async () => {
    const pool = poolDeMentira();
    const sql = crearSqlPg(pool);
    await sql`SELECT 1`;
    assert.deepStrictEqual(pool.registro, ["pool: SELECT 1"]);
  });

});

describe("sql.transaccion en las pruebas y en local (scripts/pglite.js)", () => {

  async function base() {
    const db = await crearBaseLocal();
    const sql = crearSqlPGlite(db);
    await sql`CREATE TABLE cosas (id SERIAL PRIMARY KEY, nombre TEXT UNIQUE)`;
    return sql;
  }

  test("lo que termina bien se queda", async () => {
    const sql = await base();
    await sql.transaccion(async (tx) => { await tx`INSERT INTO cosas (nombre) VALUES (${"a"})`; });
    assert.equal((await sql`SELECT count(*)::int AS n FROM cosas`)[0].n, 1);
  });

  test("lo que lanza se deshace entero", async () => {
    const sql = await base();
    await assert.rejects(() => sql.transaccion(async (tx) => {
      await tx`INSERT INTO cosas (nombre) VALUES (${"a"})`;
      await tx`INSERT INTO cosas (nombre) VALUES (${"b"})`;
      throw new Error("a mitad");
    }), /a mitad/);
    assert.equal((await sql`SELECT count(*)::int AS n FROM cosas`)[0].n, 0);
  });

  test("dos a la vez sobre la misma clave única: una entra y la otra ve que ya está", async () => {
    // Es el caso de la tienda: dos compras iguales disparadas a la vez.
    const sql = await base();
    const intentar = () => sql.transaccion(async (tx) => {
      const r = await tx`INSERT INTO cosas (nombre) VALUES (${"x"}) ON CONFLICT (nombre) DO NOTHING RETURNING id`;
      return r.length;
    });
    const [a, b] = await Promise.all([intentar(), intentar()]);
    assert.equal(a + b, 1, "entraron las dos");
    assert.equal((await sql`SELECT count(*)::int AS n FROM cosas`)[0].n, 1);
  });

});

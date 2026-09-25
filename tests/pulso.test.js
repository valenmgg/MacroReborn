// ==============================
// UN MINUTO POR MINUTO — tests/pulso.test.js
// ==============================
// Reporte del 25/09/2026: "cuando alguien abre varias pestañas se
// multiplica el contador: 2 ventanas, x2; 3, x3". Cada pestaña del juego
// manda su pulso por minuto (js/motor/xp.js), y el servidor contaba cada
// pulso que le llegara: 10 de XP y un minuto de juego. En los registros
// había conexiones con 536 pulsos en un minuto.
//
// Ahora (api/users.js, sumarXp; migración 024):
//   - un minuto de juego solo cuenta si han pasado 55 segundos desde el
//     último contado, sea de la pestaña, el navegador o el dispositivo
//     que sea;
//   - vale siempre 10 de XP, diga lo que diga el navegador;
//   - cualquier otra recompensa (Macro Snake) tiene un tope de 40.
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

before(async () => {
  db = await crearBaseLocal();
  usarSqlLocal(crearSqlPGlite(db));
  handler = require("../api/users");
});

function llamar(body, headers) {
  return new Promise((resolve) => {
    const req = { method: "POST", query: { action: "xp" }, body, headers: headers || {} };
    const res = {
      status(codigo) { this.statusCode = codigo; return this; },
      json(obj) { resolve(obj); },
      end() { resolve(null); },
      setHeader() {}
    };
    handler(req, res);
  });
}

async function persona(username) {
  const r = await db.query(
    `INSERT INTO users (username, password_hash, level, xp, status, created_at, last_login)
     VALUES ($1, 'hash', 5, 0, 'active', now(), now()) RETURNING id`, [username]);
  const id = Number(r.rows[0].id);
  return { id, username, headers: { authorization: "Bearer " + crearToken({ id, username }) } };
}

const minuto = (p, extra) => llamar({ username: p.username, cantidad: 10, gameId: "juego-1", ...(extra || {}) }, p.headers);
const recompensa = (p, cantidad) => llamar({ username: p.username, cantidad }, p.headers);

// Que pase el tiempo: se mueve hacia atrás la hora del último minuto contado.
const hace = (p, segundos) => db.query(
  "UPDATE users SET ultimo_minuto_jugado = now() - ($2 * interval '1 second') WHERE id = $1", [p.id, segundos]);

async function cuenta(p) {
  const u = (await db.query("SELECT xp FROM users WHERE id = $1", [p.id])).rows[0];
  const s = (await db.query(`SELECT COALESCE(sum(minutos_jugados), 0)::int AS m FROM ranking_actividad_semanal WHERE user_id = $1`, [p.id])).rows[0];
  const d = (await db.query(`SELECT COALESCE(sum(minutos), 0)::int AS m FROM actividad_diaria WHERE user_id = $1`, [p.id])).rows[0];
  return { xp: Number(u.xp), semana: s.m, hoy: d.m };
}

describe("un minuto por minuto", () => {

  test("el primer pulso cuenta; el segundo, enseguida, no", async () => {
    const p = await persona("una_pestana");
    const a = await minuto(p);
    assert.equal(a.success, true);
    const b = await minuto(p);
    assert.equal(b.success, false);
    assert.equal(b.contado, false);
    assert.deepStrictEqual(await cuenta(p), { xp: 10, semana: 1, hoy: 1 });
  });

  test("tres pestañas a la vez: cuenta una", async () => {
    // Es el reporte: con tres ventanas, x3.
    const p = await persona("tres_pestanas");
    const respuestas = await Promise.all([minuto(p), minuto(p), minuto(p)]);
    assert.equal(respuestas.filter(r => r.success).length, 1);
    assert.deepStrictEqual(await cuenta(p), { xp: 10, semana: 1, hoy: 1 });
  });

  test("pasados 55 segundos vuelve a contar; a los 50, no", async () => {
    const p = await persona("reloj");
    await minuto(p);
    await hace(p, 50);
    assert.equal((await minuto(p)).success, false);
    await hace(p, 56);
    assert.equal((await minuto(p)).success, true);
    assert.deepStrictEqual(await cuenta(p), { xp: 20, semana: 2, hoy: 2 });
  });

  test("el minuto vale 10 de XP, pida lo que pida el navegador", async () => {
    const p = await persona("pedigona");
    await minuto(p, { cantidad: 1000000 });
    assert.equal((await cuenta(p)).xp, 10);
  });

});

describe("las demás recompensas (Macro Snake)", () => {

  test("tienen un tope de 40", async () => {
    const p = await persona("serpiente");
    await recompensa(p, 1000000);
    assert.equal((await cuenta(p)).xp, 40);
    await recompensa(p, 25);
    assert.equal((await cuenta(p)).xp, 65);
  });

  test("no cuentan minutos, ni las frena el de los minutos", async () => {
    // Una partida de Macro Snake paga al acabar, sin juego en el pulso.
    // Que pague por partida es el punto 19 de docs/AUDITORIA.md.
    const p = await persona("serpiente_rapida");
    await minuto(p);
    assert.equal((await recompensa(p, 20)).success, true);
    assert.deepStrictEqual(await cuenta(p), { xp: 30, semana: 1, hoy: 1 });
  });

});

test("la cuenta es la de la sesión, no la del nombre del cuerpo", async () => {
  // Con dos cuentas que solo cambian en mayúsculas, el pulso de una no
  // puede ir a parar a la otra.
  const minuscula = await persona("rafa");
  const mayuscula = await persona("Rafa");
  await llamar({ username: "rafa", cantidad: 10, gameId: "juego-1" }, mayuscula.headers);
  assert.equal((await cuenta(mayuscula)).xp, 10);
  assert.equal((await cuenta(minuscula)).xp, 0);
});

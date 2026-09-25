// ==============================
// LA RACHA Y LAS MISIONES — tests/progreso.test.js
// ==============================
// Reporte de la comunidad del 25/09/2026: "la racha no rachea y las
// misiones diarias, aunque las cumplas, no se validan". Eran tres cosas:
//
//   - La racha nunca pasaba de 1: el servidor pasaba a texto una fecha
//     que la base devuelve como Date ("Thu Sep 24" frente a
//     "2026-09-24"), así que nunca era "ayer". Desde ese día se cuenta
//     sola al jugar (api/_racha.js), y las fechas se comparan en la base.
//   - Las misiones de "Jugá N minutos hoy" medían minutes_today, que el
//     servidor no calculaba: valían siempre 0. Ahora sale de
//     actividad_diaria (migración 023).
//   - Cobrar apuntaba y pagaba en dos pasos sueltos; ahora van juntos.
//
// Contra los handlers de verdad (api/users.js para el pulso de cada
// minuto de juego, api/progreso.js para el resto) y una base PGlite.
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
let usersHandler;
let progresoHandler;
let internas;
let hoy;

before(async () => {
  db = await crearBaseLocal();
  // En UTC, como la base de producción. PGlite toma la zona de la
  // máquina, y con otra el fallo de la ventana de "hoy" no se ve.
  await db.query("SET TIME ZONE 'UTC'");
  usarSqlLocal(crearSqlPGlite(db));
  usersHandler = require("../api/users");
  progresoHandler = require("../api/progreso");
  internas = progresoHandler.paraPruebas;
  hoy = internas.fechaLocalAR();
});

function llamar(handler, metodo, query, body, headers) {
  return new Promise((resolve) => {
    const req = { method: metodo, query: query || {}, body: body || {}, headers: headers || {} };
    const res = {
      status(codigo) { this.statusCode = codigo; return this; },
      json(obj) { resolve({ codigo: this.statusCode || 200, cuerpo: obj }); },
      end() { resolve({ codigo: this.statusCode || 200, cuerpo: null }); },
      setHeader() {}
    };
    handler(req, res);
  });
}

async function persona(username) {
  const r = await db.query(
    `INSERT INTO users (username, password_hash, level, xp, status, created_at, last_login)
     VALUES ($1, 'hash', 1, 0, 'active', now(), now()) RETURNING id`, [username]);
  const id = Number(r.rows[0].id);
  return { id, username, headers: { authorization: "Bearer " + crearToken({ id, username }) } };
}

// Un minuto de juego: el pulso que manda jugar.html cada 60 segundos.
const pulso = (p, gameId) => llamar(usersHandler, "POST", { action: "xp" },
  { username: p.username, cantidad: 10, gameId: gameId === undefined ? "juego-1" : gameId }, p.headers);

const estado = async (p) => (await llamar(progresoHandler, "GET", { action: "status" }, null, p.headers)).cuerpo;

// La racha guardada, como si el último día jugado fuera hace "dias" días.
async function rachaGuardada(p, actual, mejor, dias) {
  await db.query(
    `INSERT INTO player_streaks (user_id, current_streak, best_streak, last_checkin_date)
     VALUES ($1, $2, $3, $4::date - $5::int)`,
    [p.id, actual, mejor, hoy, dias]);
}

describe("la racha se cuenta sola al jugar", () => {

  test("el primer minuto del día la empieza", async () => {
    const p = await persona("nueva");
    await pulso(p);
    const { streak } = await estado(p);
    assert.deepStrictEqual(streak, { current_streak: 1, best_streak: 1, last_checkin_date: hoy, hoy_cuenta: true });
  });

  test("más minutos el mismo día no la suben", async () => {
    const p = await persona("insistente");
    await pulso(p);
    await pulso(p);
    await pulso(p);
    assert.equal((await estado(p)).streak.current_streak, 1);
  });

  test("si ayer jugó, hoy suma uno, y la mejor lo sigue", async () => {
    // Es el fallo del reporte: con el código de antes esto daba 1.
    const p = await persona("constante");
    await rachaGuardada(p, 4, 4, 1);
    await pulso(p);
    const { streak } = await estado(p);
    assert.equal(streak.current_streak, 5);
    assert.equal(streak.best_streak, 5);
  });

  test("si faltó un día, vuelve a empezar en 1, y la mejor se queda", async () => {
    const p = await persona("despistada");
    await rachaGuardada(p, 7, 9, 3);
    await pulso(p);
    const { streak } = await estado(p);
    assert.equal(streak.current_streak, 1);
    assert.equal(streak.best_streak, 9);
  });

  test("rota se ve como 0 hasta volver a jugar; viva, con su cifra", async () => {
    const rota = await persona("rota");
    await rachaGuardada(rota, 3, 3, 2);
    const a = (await estado(rota)).streak;
    assert.equal(a.current_streak, 0);
    assert.equal(a.best_streak, 3);
    assert.equal(a.hoy_cuenta, false);

    // Jugó ayer y hoy todavía no: la racha sigue viva.
    const viva = await persona("viva");
    await rachaGuardada(viva, 3, 3, 1);
    const b = (await estado(viva)).streak;
    assert.equal(b.current_streak, 3);
    assert.equal(b.hoy_cuenta, false);
  });

  test("la fecha sale como texto, no como Date", async () => {
    const p = await persona("fechada");
    await pulso(p);
    assert.match((await estado(p)).streak.last_checkin_date, /^\d{4}-\d{2}-\d{2}$/);
  });

  test("un pulso sin juego no cuenta: abrir el sitio no suma racha", async () => {
    const p = await persona("mirona");
    await pulso(p, null);
    const r = await db.query("SELECT count(*)::int AS n FROM player_streaks WHERE user_id = $1", [p.id]);
    assert.equal(r.rows[0].n, 0);
    assert.equal((await estado(p)).streak.current_streak, 0);
  });

  test("el botón de registrar el día ya no existe", async () => {
    const p = await persona("botonera");
    const r = await llamar(progresoHandler, "POST", { action: "checkin" }, {}, p.headers);
    assert.equal(r.codigo, 400);
  });

});

describe("las misiones", () => {

  test("toda misión mide algo que el servidor calcula", async () => {
    // La causa del fallo: tres diarias pedían minutes_today y no estaba.
    const p = await persona("medida");
    const metricas = await internas.obtenerMetricas(p.id);
    for (const m of [...internas.MISIONES_DIARIAS, ...internas.MISIONES_SEMANALES]) {
      assert.equal(typeof metricas[m.metric], "number", m.key + " mide " + m.metric + ", que no existe");
    }
  });

  test("los juegos de hoy van de medianoche a medianoche de Argentina", async () => {
    // Con el fallo, "hoy" iba de 21:00 a 21:00 UTC: lo jugado desde las
    // 18:00 de Argentina, la hora punta, no contaba.
    const p = await persona("nocturna");
    const jugado = (juego, horasDesdeMedianoche) => db.query(
      `INSERT INTO game_history (user_id, game_id, played_at)
       VALUES ($1, $2, (($3::timestamp + $4 * interval '1 hour') AT TIME ZONE 'America/Argentina/Buenos_Aires'))`,
      [p.id, juego, hoy, horasDesdeMedianoche]);

    await jugado("madrugada", 0.5);    // 00:30 de hoy
    await jugado("noche", 20);         // 20:00 de hoy
    await jugado("casi-manana", 23.9); // 23:54 de hoy
    await jugado("anoche", -0.5);      // 23:30 de ayer: no cuenta

    assert.equal((await internas.obtenerMetricas(p.id)).games_today, 3);
  });

  test("los minutos de hoy los suman los pulsos de juego", async () => {
    const p = await persona("minutera");
    for (let i = 0; i < 4; i++) await pulso(p);
    assert.equal((await internas.obtenerMetricas(p.id)).minutes_today, 4);
  });

  test("las de minutos se cumplen: 14 días de cada 31 dejaban de ser imposibles", () => {
    const deMinutos = [];
    for (let dia = 1; dia <= 31; dia++) {
      const m = internas.pickDaily("2026-10-" + String(dia).padStart(2, "0"));
      if (m.metric === "minutes_today") deMinutos.push(dia);
    }
    assert.equal(deMinutos.length, 14);
  });

  test("la misión de hoy, cumplida, se cobra una sola vez", async () => {
    const p = await persona("cobradora");
    const m = internas.pickDaily(hoy);

    // Se cumple la de hoy, sea de juegos o de minutos.
    if (m.metric === "games_today") {
      for (let i = 0; i < m.target; i++) {
        await db.query("INSERT INTO game_history (user_id, game_id, played_at) VALUES ($1, $2, now())", [p.id, "g" + i]);
      }
    } else {
      await db.query("INSERT INTO actividad_diaria (user_id, dia, minutos) VALUES ($1, $2::date, $3)", [p.id, hoy, m.target]);
    }

    const antes = (await estado(p)).today.mission;
    assert.equal(antes.completed, true);
    assert.equal(antes.claimed, false);

    const saldo = async () => Number((await db.query("SELECT monedas FROM users WHERE id = $1", [p.id])).rows[0].monedas);
    const monedasAntes = await saldo();

    const cobro = await llamar(progresoHandler, "POST", { action: "claim" },
      { missionKey: m.key, periodKey: hoy, tipo: "daily" }, p.headers);
    assert.equal(cobro.cuerpo.success, true);
    assert.equal(cobro.cuerpo.alreadyClaimed, false);
    assert.deepStrictEqual(cobro.cuerpo.reward, { xp: m.xp, coins: m.coins });
    assert.equal(await saldo(), monedasAntes + m.coins);

    const otra = await llamar(progresoHandler, "POST", { action: "claim" },
      { missionKey: m.key, periodKey: hoy, tipo: "daily" }, p.headers);
    assert.equal(otra.cuerpo.alreadyClaimed, true);
    assert.equal(await saldo(), monedasAntes + m.coins, "se pagó dos veces");
    assert.equal((await estado(p)).today.mission.claimed, true);
  });

  test("sin cumplirla no se cobra", async () => {
    const p = await persona("apurada");
    const m = internas.pickDaily(hoy);
    const r = await llamar(progresoHandler, "POST", { action: "claim" },
      { missionKey: m.key, periodKey: hoy, tipo: "daily" }, p.headers);
    assert.equal(r.codigo, 400);
    assert.match(r.cuerpo.error, /completaste/);
  });

});

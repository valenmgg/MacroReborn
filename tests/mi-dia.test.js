// ==============================
// LA PÁGINA "MI DÍA" — tests/mi-dia.test.js
// ==============================
// Del reporte del 25/09/2026 ("la racha no rachea y las misiones, aunque
// las cumplas, no se validan"), lo que tocaba a esta página:
//
//   - Enseñaba la misión cumplida sin forma de cobrarla: solo se podía en
//     Progreso. Ahora tiene su botón, en la diaria y en la semanal.
//   - La racha se cuenta sola al jugar: el botón "Registrar mi día" se
//     fue, y la página dice cómo va la racha.
//
// mi-dia.html y js/mi-dia.js de verdad, en jsdom; la red y la sesión
// son de mentira.
//
// Correr:  npm test

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");

const RAIZ = path.join(__dirname, "..");
const HTML = fs.readFileSync(path.join(RAIZ, "mi-dia.html"), "utf8");
const SCRIPT = fs.readFileSync(path.join(RAIZ, "js", "mi-dia.js"), "utf8");

const mision = (extra) => Object.assign({
  key: "daily_5_games", title: "Coleccionista", description: "Probá 5 juegos distintos hoy.",
  metric: "games_today", target: 5, xp: 70, coins: 55, periodKey: "2026-09-25",
  value: 5, completed: true, claimed: false
}, extra || {});

function estadoDePrueba(extra) {
  return Object.assign({
    success: true,
    today: { date: "2026-09-25", mission: mision() },
    week: { start: "2026-09-22", mission: mision({ key: "weekly_6_games", title: "Descubridor", target: 6, value: 2, completed: false, periodKey: "2026-09-22" }) },
    streak: { current_streak: 3, best_streak: 5, last_checkin_date: "2026-09-25", hoy_cuenta: true },
    global: { key: "g", value: 10, target: 10000, rewardXp: 500, rewardCoins: 250, endsAt: null },
    user: null
  }, extra || {});
}

async function montar(opciones) {
  const o = opciones || {};
  const consola = new VirtualConsole();
  consola.on("jsdomError", (e) => { if (!/navigation/i.test(String(e.message))) console.error(e); });
  const dom = new JSDOM(HTML, { url: "https://www.macroreborn.com/mi-dia.html", runScripts: "outside-only", virtualConsole: consola });
  const w = dom.window;
  const pedidas = [];
  const sesion = { nombre: "ana", monedas: 100 };

  const barra = w.document.createElement("span");
  barra.id = "navMonedas";
  w.document.body.appendChild(barra);

  w.MRSession = { get: () => sesion, getToken: () => "token", update: (c) => Object.assign(sesion, c) };
  let estado = o.estado || estadoDePrueba();
  w.fetch = async (url, init) => {
    pedidas.push({ url, init });
    let cuerpo = { success: true };
    if (url.includes("action=status")) cuerpo = estado;
    if (url.includes("action=claim")) {
      cuerpo = o.cobro || { success: true, alreadyClaimed: false, reward: { xp: 70, coins: 55 }, user: { monedas: 155 } };
      if (cuerpo.success) estado = estadoDePrueba({ today: { date: "2026-09-25", mission: mision({ claimed: true }) } });
    }
    if (url.includes("action=notifications")) cuerpo = { success: true, notificaciones: [] };
    if (url.includes("action=friends")) cuerpo = { success: true, amigos: [] };
    return { ok: cuerpo.success !== false, status: cuerpo.success === false ? 400 : 200, json: async () => cuerpo };
  };

  w.eval(SCRIPT);
  const esperar = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0)); };
  await esperar();

  const $ = (id) => w.document.getElementById(id);
  return { w, $, pedidas, sesion, barra, esperar, cerrar: () => w.close() };
}

describe("la racha", () => {

  test("ya no hay botón de registrar el día, y se explica cómo se suma", async () => {
    const p = await montar();
    assert.equal(p.$("checkinBtn"), null);
    assert.match(p.w.document.querySelector(".md-streak").textContent, /jugás al menos un minuto/);
    p.cerrar();
  });

  test("dice cómo va: contada hoy, en peligro o por empezar", async () => {
    const casos = [
      [{ current_streak: 3, best_streak: 5, hoy_cuenta: true }, "3 días", /Hoy ya cuenta/],
      [{ current_streak: 3, best_streak: 5, hoy_cuenta: false }, "3 días", /Jugá hoy para no perderla/],
      [{ current_streak: 0, best_streak: 5, hoy_cuenta: false }, "0 días", /Jugá un minuto para empezarla/]
    ];
    for (const [streak, cifra, frase] of casos) {
      const p = await montar({ estado: estadoDePrueba({ streak }) });
      assert.equal(p.$("streakCurrent").textContent, cifra);
      assert.match(p.$("checkinState").textContent, frase);
      assert.equal(p.$("streakBest").textContent, "Mejor racha: 5");
      p.cerrar();
    }
  });

});

describe("las misiones se cobran desde aquí", () => {

  test("cada botón dice si se puede cobrar", async () => {
    const p = await montar();
    assert.equal(p.$("dailyClaim").disabled, false);
    assert.equal(p.$("dailyClaim").textContent, "Reclamar recompensa");
    // La semanal va 2/6: todavía no.
    assert.equal(p.$("weeklyClaim").disabled, true);
    assert.equal(p.$("weeklyClaim").textContent, "Completá la misión");
    assert.match(p.w.document.body.textContent, /Se renueva a las 00:00, hora de Argentina/);
    p.cerrar();
  });

  test("cobrar manda la misión y el período, y enseña el saldo nuevo", async () => {
    const p = await montar();
    p.$("dailyClaim").click();
    await p.esperar();

    const cobro = p.pedidas.find(x => x.url.includes("action=claim"));
    assert.ok(cobro, "no se pidió el cobro");
    assert.equal(cobro.init.method, "POST");
    assert.deepStrictEqual(JSON.parse(cobro.init.body), { missionKey: "daily_5_games", periodKey: "2026-09-25", tipo: "daily" });

    assert.match(p.$("status").textContent, /\+70 XP/);
    assert.equal(p.barra.textContent, "🪙 155");
    assert.equal(p.sesion.monedas, 155);
    assert.equal(p.$("dailyClaim").textContent, "Reclamada ✓");
    assert.equal(p.$("dailyClaim").disabled, true);
    p.cerrar();
  });

  test("si el servidor dice que no, lo cuenta y deja volver a intentarlo", async () => {
    const p = await montar({ cobro: { success: false, error: "Todavía no completaste la misión" } });
    p.$("dailyClaim").click();
    await p.esperar();
    assert.match(p.$("status").textContent, /Todavía no completaste/);
    assert.equal(p.$("dailyClaim").disabled, false);
    p.cerrar();
  });

});

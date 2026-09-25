// ==============================
// LA PÁGINA "PROGRESO" — tests/progreso-pagina.test.js
// ==============================
// Desde el 25/09/2026 la racha se cuenta sola al jugar: el botón
// "Registrar hoy" se fue, y la tarjeta dice cómo va la racha. Cobrar las
// misiones sigue igual que antes.
//
// progreso.html y js/macro-progreso.js de verdad, en jsdom; la red es de
// mentira.
//
// Correr:  npm test

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const RAIZ = path.join(__dirname, "..");
const HTML = fs.readFileSync(path.join(RAIZ, "progreso.html"), "utf8");
const SCRIPT = fs.readFileSync(path.join(RAIZ, "js", "macro-progreso.js"), "utf8");

const mision = (extra) => Object.assign({
  key: "daily_2_games", title: "Entrá en calor", description: "Jugá 2 juegos distintos hoy.",
  metric: "games_today", target: 2, xp: 30, coins: 25, periodKey: "2026-09-25",
  value: 2, completed: true, claimed: false
}, extra || {});

async function montar(streak) {
  const dom = new JSDOM(HTML, { url: "https://www.macroreborn.com/progreso.html", runScripts: "outside-only" });
  const w = dom.window;
  w.localStorage.setItem("macroSessionToken", "token");
  const pedidas = [];
  w.fetch = async (url, init) => {
    pedidas.push({ url, init });
    const cuerpo = url.includes("action=claim")
      ? { success: true, alreadyClaimed: false, reward: { xp: 30, coins: 25 } }
      : {
          success: true,
          today: { mission: mision() },
          week: { mission: mision({ key: "weekly_6_games", completed: false, value: 1, target: 6, periodKey: "2026-09-22" }) },
          streak,
          global: { value: 0, target: 10000, rewardXp: 500, rewardCoins: 250 },
          user: { level: 3, xp: 40, monedas: 500 }
        };
    return { ok: true, status: 200, json: async () => cuerpo };
  };
  w.eval(SCRIPT);
  for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0));
  return { w, $: (id) => w.document.getElementById(id), pedidas };
}

test("ya no hay botón de registrar el día; la racha dice cómo va", async () => {
  const hoy = await montar({ current_streak: 4, best_streak: 6, hoy_cuenta: true });
  assert.equal(hoy.$("btnCheckin"), null);
  assert.equal(hoy.$("streakCurrent").textContent, "4 días");
  assert.match(hoy.$("checkinState").textContent, /Hoy ya cuenta/);
  hoy.w.close();

  const pendiente = await montar({ current_streak: 4, best_streak: 6, hoy_cuenta: false });
  assert.match(pendiente.$("checkinState").textContent, /Jugá hoy para no perderla/);
  pendiente.w.close();

  const nueva = await montar({ current_streak: 0, best_streak: 0, hoy_cuenta: false });
  assert.match(nueva.$("checkinState").textContent, /Jugá un minuto para empezarla/);
  nueva.w.close();
});

test("cobrar una misión sigue funcionando", async () => {
  const p = await montar({ current_streak: 1, best_streak: 1, hoy_cuenta: true });
  assert.equal(p.$("dailyClaim").disabled, false);
  p.$("dailyClaim").click();
  for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0));
  const cobro = p.pedidas.find(x => x.url.includes("action=claim"));
  assert.deepStrictEqual(JSON.parse(cobro.init.body), { missionKey: "daily_2_games", periodKey: "2026-09-25", tipo: "daily" });
  // Sin copia propia del pase: lo pone js/core.js, el vigente.
  assert.ok(p.pedidas.every(x => !("Authorization" in (x.init.headers || {}))), "la página manda su propia copia del pase");
  assert.match(p.$("progressError").textContent, /\+30 XP/);
  p.w.close();
});

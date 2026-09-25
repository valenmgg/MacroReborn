// ==============================
// EL PULSO DEL NAVEGADOR — tests/xp-pulso.test.js
// ==============================
// js/motor/xp.js manda, mientras se juega, un pulso por minuto. Dos cosas
// del 25/09/2026:
//
//   - Con la pestaña oculta (minimizada o en segundo plano) no se manda:
//     dejar el juego abierto toda la noche no es jugar.
//   - Si el reparto de monedas falla, el servidor manda saldoNuevo: null,
//     y Number(null) es 0: la barra enseñaba 0 monedas hasta recargar.
//
// Se evalúa el archivo de verdad con relojes, red y sesión de mentira.
//
// Correr:  npm test

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const XP = fs.readFileSync(path.join(__dirname, "..", "js", "motor", "xp.js"), "utf8");

function montar(respuesta) {
  const relojes = [];
  const pedidas = [];
  const sesion = { nombre: "ana", nivel: 3, xp: 40, monedas: 120 };
  const contexto = {
    console: { warn() {}, log() {} },
    document: { visibilityState: "visible" },
    setInterval: (fn) => { relojes.push(fn); return relojes.length; },
    clearInterval: () => {},
    MRSession: { get: () => sesion, update: (c) => Object.assign(sesion, c) },
    fetch: async (url, init) => {
      pedidas.push({ url, cuerpo: JSON.parse(init.body) });
      return { json: async () => respuesta };
    }
  };
  contexto.window = contexto;
  vm.createContext(contexto);
  vm.runInContext(XP, contexto);
  vm.runInContext("iniciarXP('juego-7')", contexto);
  return {
    contexto, pedidas, sesion,
    // Pasa un minuto: corre el reloj del pulso y deja contestar a la red.
    minuto: async () => { relojes[relojes.length - 1](); for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); }
  };
}

const bien = { success: true, user: { level: 3, xp: 50 }, subioNivel: false, monedas: { otorgado: false, monto: 0, saldoNuevo: 120 } };

test("con la pestaña a la vista, un pulso por minuto con su juego", async () => {
  const p = montar(bien);
  await p.minuto();
  assert.equal(p.pedidas.length, 1);
  assert.equal(p.pedidas[0].url, "/api/users?action=xp");
  assert.deepStrictEqual(p.pedidas[0].cuerpo, { username: "ana", cantidad: 10, gameId: "juego-7" });
});

test("con la pestaña oculta no se manda nada, y al volver sí", async () => {
  const p = montar(bien);
  p.contexto.document.visibilityState = "hidden";
  await p.minuto();
  await p.minuto();
  assert.equal(p.pedidas.length, 0);

  p.contexto.document.visibilityState = "visible";
  await p.minuto();
  assert.equal(p.pedidas.length, 1);
});

test("un minuto que el servidor no cuenta no cambia nada", async () => {
  // Otra pestaña ya lo contó: el servidor contesta sin éxito.
  const p = montar({ success: false, contado: false, error: "Este minuto ya se contó" });
  await p.minuto();
  assert.deepStrictEqual(p.sesion, { nombre: "ana", nivel: 3, xp: 40, monedas: 120 });
});

test("si el reparto de monedas falla, el saldo no se vuelve 0", async () => {
  const p = montar({ ...bien, monedas: { otorgado: false, monto: 0, saldoNuevo: null, razon: "error-al-otorgar" } });
  await p.minuto();
  assert.equal(p.sesion.monedas, 120);
  assert.equal(p.sesion.xp, 50, "el XP sí se actualiza");
});

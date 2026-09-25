// ==============================
// EL ESCAPARATE DE COMUNIDAD — tests/comunidad-tienda.test.js
// ==============================
// comunidad-ranking.html enseña las doce últimas prendas de la tienda y
// el saldo. Ya no compra: "Comprar" lleva a tienda.html?prenda=<valor>,
// que pregunta antes de cobrar. Antes compraba desde aquí de un clic.
//
// Se evalúa crCargarTienda() de verdad (js/comunidad-ranking.js) con el
// escape de verdad (MRTexto, de js/core.js) y una red de mentira.
//
// Correr:  npm test

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const RAIZ = path.join(__dirname, "..");
// Sin los CR: en Windows la copia de trabajo está en CRLF.
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8").replace(/\r\n/g, "\n");
const FUENTE = leer("js", "comunidad-ranking.js");
const CORE = leer("js", "core.js");
const HTML = leer("comunidad-ranking.html");

const BLOQUE = FUENTE.slice(FUENTE.indexOf("async function crCargarTienda() {"),
  FUENTE.indexOf("// \"¿QUÉ ESTÁ OCURRIENDO AHORA?\""));
const MRTEXTO = CORE.slice(CORE.indexOf("const MRTexto = {"),
  CORE.indexOf("if (typeof window !== \"undefined\") window.MRTexto = MRTexto;"));

const items = Array.from({ length: 14 }, (_, i) => ({
  id: i + 1, valorCapa: "tora_pelo" + (i + 1), nombre: "Pelo " + (i + 1), precio: 1500,
  previsualizacion: "/previsualizaciones/" + (i + 1) + ".jpg?v=aaaaaaaaaaaa"
}));

async function montar(usuario, respuesta) {
  assert.ok(BLOQUE.startsWith("async function crCargarTienda"), "no está crCargarTienda en js/comunidad-ranking.js");
  const dom = new JSDOM('<div id="crMonedasUsuario"></div><div id="crGridTienda"></div>');
  const d = dom.window.document;
  const pedidas = [];
  const contexto = {
    document: d,
    console: { warn() {} },
    activoComRk: usuario,
    crGridTienda: d.getElementById("crGridTienda"),
    crMonedasUsuario: d.getElementById("crMonedasUsuario"),
    fetch: async (url) => { pedidas.push(url); return { json: async () => respuesta }; }
  };
  vm.createContext(contexto);
  vm.runInContext(MRTEXTO + "\n" + BLOQUE + "\n;crCargarTienda()", contexto);
  await new Promise(r => setTimeout(r, 10));
  return {
    pedidas,
    saldo: d.getElementById("crMonedasUsuario"),
    botones: () => [...d.querySelectorAll(".cr-item-tienda-boton")]
  };
}

test("con sesión: el saldo, doce prendas, y Comprar lleva a la tienda", async () => {
  const e = await montar({ nombre: "ana" }, { success: true, items, comprados: [2], monedas: 12500 });
  assert.deepStrictEqual(e.pedidas, ["/api/content?action=avatar-shop"]);
  assert.equal(e.saldo.textContent, "🪙 " + (12500).toLocaleString("es-ES") + " monedas");
  const botones = e.botones();
  assert.equal(botones.length, 12);
  assert.equal(botones[0].tagName, "A");
  assert.equal(botones[0].getAttribute("href"), "tienda.html?prenda=tora_pelo1");
  assert.equal(botones[0].textContent, "Comprar");
  assert.ok(botones[1].disabled, "la que ya tiene no se puede comprar");
  assert.equal(botones[1].textContent, "✅ La tenés");
});

test("si el servidor no reconoce la sesión, no enseña un saldo de 0", async () => {
  const e = await montar({ nombre: "ana" }, { success: true, items, comprados: [], monedas: null });
  assert.equal(e.saldo.style.display, "none");
});

test("sin sesión, cada prenda invita a iniciarla", async () => {
  const e = await montar(null, { success: true, items, comprados: [], monedas: null });
  assert.equal(e.saldo.style.display, "none");
  assert.ok(e.botones().every(b => b.getAttribute("href") === "login.html"));
});

test("la página enlaza la tienda desde los dos paneles", () => {
  const centro = HTML.slice(HTML.indexOf('class="cr-panel cr-centro-avatares"'), HTML.indexOf('class="cr-panel cr-necesitas-ayuda"'));
  assert.equal((centro.match(/href="tienda\.html"/g) || []).length, 2);
  assert.match(centro, /Ver toda la tienda/);
});

// ==============================
// EL SALDO DE LA BARRA — tests/navbar-monedas.test.js
// ==============================
// La barra de navegación enseña las monedas en cada página. Pedía el
// catálogo entero de la tienda para leer ese número; ahora pide
// ?action=mis-monedas, que devuelve solo el saldo. Y si el servidor no
// contesta bien, deja el que había en vez de poner un 0.
//
// Se evalúa la función de verdad de js/navbar.js, con red de mentira.
//
// Correr:  npm test

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const NAVBAR = fs.readFileSync(path.join(__dirname, "..", "js", "navbar.js"), "utf8");

function montar(respuesta) {
  const i = NAVBAR.indexOf("function cargarMonedasNavbar(nombre){");
  const j = NAVBAR.indexOf("cargarMonedasNavbar(usuarioNav.nombre);", i);
  assert.ok(i !== -1 && j > i, "no está cargarMonedasNavbar en js/navbar.js");

  const dom = new JSDOM('<span id="navMonedas"></span>');
  const pedidas = [];
  const sesion = { nombre: "ana", monedas: 300 };
  const contexto = {
    document: dom.window.document,
    console: { warn() {} },
    usuarioNav: sesion,
    fetch: (url) => {
      pedidas.push(url);
      return Promise.resolve({ json: () => Promise.resolve(respuesta) });
    }
  };
  contexto.window = contexto;
  contexto.MRSession = {
    get: () => sesion,
    update: (cambios) => Object.assign(sesion, cambios)
  };
  vm.createContext(contexto);
  const cargar = vm.runInContext(NAVBAR.slice(i, j) + "\n;cargarMonedasNavbar", contexto);

  return {
    pedidas,
    sesion,
    cargar: async () => { cargar("ana"); await new Promise(r => setImmediate(r)); },
    texto: () => dom.window.document.getElementById("navMonedas").textContent
  };
}

test("pide solo el saldo, lo enseña y lo guarda en la sesión", async () => {
  const barra = montar({ success: true, monedas: 1250 });
  await barra.cargar();
  assert.deepStrictEqual(barra.pedidas, ["/api/content?action=mis-monedas"]);
  assert.equal(barra.texto(), "🪙 " + (1250).toLocaleString("es-ES"));
  assert.equal(barra.sesion.monedas, 1250);
});

test("si el servidor no contesta bien, se queda el saldo de la sesión", async () => {
  for (const respuesta of [{ success: false, error: "Sesión no válida o expirada" }, { success: true, monedas: null }]) {
    const barra = montar(respuesta);
    await barra.cargar();
    assert.equal(barra.texto(), "🪙 300", JSON.stringify(respuesta));
    assert.equal(barra.sesion.monedas, 300);
  }
});

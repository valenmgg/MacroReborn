// ==============================
// EL DIÁLOGO GLOBAL — tests/modal.test.js
// ==============================
// js/modal.js es el diálogo de todo el sitio (window.MRModal). Tenía un
// solo botón, "Entendido"; la tienda necesita preguntar ("Cancelar" o
// "Comprar") y enseñar la prenda. Se prueba que lo nuevo funciona y que
// lo de siempre sigue igual para las once páginas que ya lo usan.
//
// Correr:  npm test

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const MODAL = fs.readFileSync(path.join(__dirname, "..", "js", "modal.js"), "utf8");

function pagina() {
  const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" });
  dom.window.eval(MODAL);
  const doc = dom.window.document;
  return {
    MRModal: dom.window.MRModal,
    doc,
    abierto: () => doc.getElementById("mrModalRoot"),
    botones: () => [...doc.querySelectorAll("#mrModalRoot .mr-modal-action")].map(b => b.textContent)
  };
}

test("sin acciones, el único botón de siempre, que cierra", () => {
  const p = pagina();
  p.MRModal.show({ title: "Aviso", message: "Hola", buttonText: "Vale" });
  assert.deepStrictEqual(p.botones(), ["Vale"]);
  assert.ok(p.doc.querySelector(".mr-modal-icon"), "desapareció el icono");
  p.doc.querySelector(".mr-modal-action").click();
  assert.equal(p.abierto(), null);
  assert.ok(!p.doc.documentElement.classList.contains("mr-modal-open"));
});

test("con acciones, un botón por acción y el principal marcado", () => {
  const p = pagina();
  p.MRModal.show({ title: "¿Comprar?", actions: [{ text: "Cancelar" }, { text: "Comprar", primary: true }] });
  assert.deepStrictEqual(p.botones(), ["Cancelar", "Comprar"]);
  const [cancelar, comprar] = p.doc.querySelectorAll(".mr-modal-action");
  assert.ok(cancelar.classList.contains("mr-modal-action--secondary"));
  assert.ok(!comprar.classList.contains("mr-modal-action--secondary"));
});

test("una acción cierra y después llama a lo suyo, que puede abrir otro diálogo", () => {
  const p = pagina();
  let llamadas = 0;
  p.MRModal.show({
    title: "¿Comprar?",
    actions: [{ text: "Cancelar" }, {
      text: "Comprar", primary: true,
      onClick: () => { llamadas++; p.MRModal.show({ title: "¡Es tuya!" }); }
    }]
  });
  p.doc.querySelectorAll(".mr-modal-action")[1].click();
  assert.equal(llamadas, 1);
  assert.equal(p.doc.getElementById("mrModalTitle").textContent, "¡Es tuya!");
  assert.ok(p.doc.documentElement.classList.contains("mr-modal-open"),
    "el cierre del primero le quitó el bloqueo del scroll al segundo");
});

test("la acción sin onClick solo cierra", () => {
  const p = pagina();
  p.MRModal.show({ title: "¿Comprar?", actions: [{ text: "Cancelar" }, { text: "Comprar", primary: true }] });
  p.doc.querySelectorAll(".mr-modal-action")[0].click();
  assert.equal(p.abierto(), null);
});

test("la imagen sustituye al icono, y todo lo que llega se escapa", () => {
  const p = pagina();
  p.MRModal.show({
    title: "<b>x</b>",
    image: '/previsualizaciones/1.jpg?v=a"onerror="alert(1)',
    actions: [{ text: "<img src=x onerror=alert(1)>", primary: true }]
  });
  const img = p.doc.querySelector(".mr-modal-image");
  assert.equal(img.getAttribute("src"), '/previsualizaciones/1.jpg?v=a"onerror="alert(1)');
  assert.equal(img.getAttribute("onerror"), null);
  assert.equal(p.doc.querySelector(".mr-modal-icon"), null);
  assert.equal(p.doc.getElementById("mrModalTitle").textContent, "<b>x</b>");
  assert.equal(p.doc.querySelector(".mr-modal-action img"), null);
});

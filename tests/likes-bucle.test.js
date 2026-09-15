// ==============================
// TESTS DEL BUCLE DE LIKES — tests/likes-bucle.test.js
// ==============================
// js/motor/likes.js vigila el body con un MutationObserver para
// enterarse de cuándo aparecen botones de "me gusta" nuevos y pedir sus
// contadores.
//
// Durante semanas ese observador se disparó con CUALQUIER cambio del
// DOM, incluidos los que hacía la propia función al escribir el contador
// en cada botón. Cada vuelta era un pedido al servidor, cada 80 ms,
// mientras la pestaña estuviera abierta:
//
//   observer -> refrescar -> innerHTML -> mutación -> observer -> ...
//
// El 12 de septiembre fueron 548.726 pedidos a action=likes en un solo
// día. La página del perfil tardaba en cargar por eso.
//
// Estos tests cuentan los pedidos. Lo que prueban no es que el contador
// salga bien -eso ya se veía-, es que la cuenta PARE.
//
// Se comprobó que sirven: con el likes.js anterior estos tests fallan, y
// el proceso ni siquiera termina, porque el bucle sigue programando
// temporizadores para siempre. Por eso la ventana se cierra al acabar
// cada prueba.
//
// Correr:  npm test

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const FUENTE = fs.readFileSync(
  path.join(__dirname, "..", "js", "motor", "likes.js"), "utf8"
);

const espera = ms => new Promise(r => setTimeout(r, ms));

// El debounce del observador son 80 ms. Se espera bastante más para que
// un bucle, si lo hubiera, tuviera tiempo de dar varias vueltas.
const MARGEN = 500;

function botones(...ids) {
  return ids.map(id =>
    '<button class="boton-like" data-clave="comment" data-item="' + id + '">' +
      '<span class="like-icono">🤍</span><span class="like-contador">0</span>' +
    '</button>'
  ).join("");
}

// t es el contexto de node:test, para cerrar la ventana al terminar.
function montar(t, html) {
  const dom = new JSDOM("<body>" + html + "</body>", { url: "https://macroreborn.com/" });
  t.after(() => dom.window.close());

  const pedidos = [];

  const contexto = {
    document: dom.window.document,
    window: dom.window,
    MutationObserver: dom.window.MutationObserver,
    localStorage: dom.window.localStorage,
    // Los temporizadores son los de la ventana, no los de Node: así
    // cerrarla corta lo que quede pendiente. Con los de Node, un
    // likes.js con el bucle abierto deja el proceso vivo para siempre y
    // `node --test` no termina nunca.
    setTimeout: dom.window.setTimeout.bind(dom.window),
    clearTimeout: dom.window.clearTimeout.bind(dom.window),
    URLSearchParams,
    console: { warn() {}, error() {}, log() {} },
    leerJSON: texto => { try { return JSON.parse(texto); } catch (_) { return null; } },
    fetch(url) {
      pedidos.push(String(url));
      const ids = (String(url).match(/targetIds=([^&]*)/) || [, ""])[1].split(",");
      const counts = {};
      ids.forEach(id => { counts[id] = 3; });
      return Promise.resolve({
        json: () => Promise.resolve({ success: true, counts, likedByMe: [] })
      });
    }
  };

  vm.createContext(contexto);
  vm.runInContext(FUENTE, contexto);

  return { doc: dom.window.document, pedidos };
}

// ==============================

describe("la cuenta de likes para sola", () => {
  test("dos botones se resuelven con un solo pedido", async t => {
    const { pedidos } = montar(t, botones("1", "2"));
    await espera(MARGEN);

    assert.equal(pedidos.length, 1, "un pedido por tipo, no uno por botón");
    assert.ok(pedidos[0].includes("targetIds="), "debería pedir los ids juntos");
  });

  test("y NO sigue pidiendo después de escribir los contadores", async t => {
    const { pedidos } = montar(t, botones("1", "2"));
    await espera(MARGEN);
    const trasLaPrimera = pedidos.length;

    await espera(MARGEN);

    assert.equal(pedidos.length, trasLaPrimera,
      "escribir el contador es una mutación: no puede volver a disparar el pedido");
  });

  test("un cambio del DOM que no trae botones nuevos no pide nada", async t => {
    const { doc, pedidos } = montar(t, botones("1"));
    await espera(MARGEN);
    const antes = pedidos.length;

    const p = doc.createElement("p");
    p.textContent = "un comentario cualquiera";
    doc.body.appendChild(p);
    await espera(MARGEN);

    assert.equal(pedidos.length, antes);
  });
});

describe("pero sigue enterándose de los botones nuevos", () => {
  test("un botón que aparece después sí se pide", async t => {
    const { doc, pedidos } = montar(t, botones("1"));
    await espera(MARGEN);
    const antes = pedidos.length;

    doc.body.insertAdjacentHTML("beforeend", botones("99"));
    await espera(MARGEN);

    assert.equal(pedidos.length, antes + 1);
    assert.ok(pedidos[pedidos.length - 1].includes("99"));
  });

  test("y solo se pregunta por el nuevo, no por los que ya se saben", async t => {
    const { doc, pedidos } = montar(t, botones("1", "2"));
    await espera(MARGEN);

    doc.body.insertAdjacentHTML("beforeend", botones("99"));
    await espera(MARGEN);

    const ultimo = pedidos[pedidos.length - 1];
    const ids = (ultimo.match(/targetIds=([^&]*)/) || [, ""])[1];
    assert.equal(ids, "99");
  });

  test("el contador que llega del servidor se escribe en el botón", async t => {
    const { doc } = montar(t, botones("1"));
    await espera(MARGEN);

    const texto = doc.querySelector(".boton-like .like-contador").textContent.trim();
    assert.equal(texto, "3");
  });
});

describe("sin botones no se molesta al servidor", () => {
  test("una página sin likes no pide nada", async t => {
    const { pedidos } = montar(t, "<p>una página cualquiera</p>");
    await espera(MARGEN);

    assert.equal(pedidos.length, 0);
  });
});

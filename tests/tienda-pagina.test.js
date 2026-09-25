// ==============================
// LA PÁGINA DE LA TIENDA — tests/tienda-pagina.test.js
// ==============================
// tienda.html con su js/tienda.js de verdad, el diálogo de verdad
// (js/modal.js) y el escape de verdad (MRTexto, de js/core.js). La red
// y la sesión son de mentira.
//
// Qué se prueba: lo que ve quien no tiene sesión y quien sí; que abra en
// el personaje de cada cual; los filtros; que todo lo que llega se
// escape; el camino de una compra, la buena y las que fallan; el enlace
// a una prenda (tienda.html?prenda=...), y el "Ver más".
//
// Correr:  npm test

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");

const raiz = path.join(__dirname, "..");
const HTML = fs.readFileSync(path.join(raiz, "tienda.html"), "utf8");
const TIENDA = fs.readFileSync(path.join(raiz, "js", "tienda.js"), "utf8");
const MODAL = fs.readFileSync(path.join(raiz, "js", "modal.js"), "utf8");
const CORE = fs.readFileSync(path.join(raiz, "js", "core.js"), "utf8");
const MRTEXTO = CORE.slice(CORE.indexOf("const MRTexto = {"),
  CORE.indexOf("if (typeof window !== \"undefined\") window.MRTexto = MRTexto;"));

const DIA = 24 * 60 * 60 * 1000;
const hace = (dias) => new Date(Date.now() - dias * DIA).toISOString();
const cifra = (n) => n.toLocaleString("es-ES");

// Del servidor llegan de lo más nuevo a lo más viejo.
const CATALOGO = [
  { id: 1, categoria: "pelo", modelo: "tora", valorCapa: "tora_pelo1", nombre: "Melena <b>larga</b>",
    precio: 120, creadoEl: hace(2), previsualizacion: "/previsualizaciones/1.jpg?v=aaaaaaaaaaaa", vendidas: 3 },
  { id: 2, categoria: "remera", modelo: "tora", valorCapa: "tora_remera2", nombre: "Remera azul",
    precio: 100, creadoEl: hace(20), previsualizacion: "/previsualizaciones/2.jpg?v=bbbbbbbbbbbb", vendidas: 10 },
  { id: 3, categoria: "mascota", modelo: "tora", valorCapa: "tora_mascota3", nombre: "Dragón",
    precio: 900, creadoEl: hace(30), previsualizacion: null, vendidas: 0 },
  { id: 4, categoria: "pelo", modelo: "cereza", valorCapa: "cereza_pelo4", nombre: "Coletas",
    precio: 150, creadoEl: hace(40), previsualizacion: "/previsualizaciones/4.jpg?v=cccccccccccc", vendidas: 1 }
];

const esperar = (ms) => new Promise(r => setTimeout(r, ms || 5));

// Los avisos que la página escribe a propósito (el catálogo que no
// llega) no ensucian la salida; los fallos de jsdom sí se ven.
function consolaCallada() {
  const consola = new VirtualConsole();
  consola.on("jsdomError", (error) => console.error(error));
  return consola;
}

// opciones: url, sesion (el usuario de MRSession, o null), monedas y
// comprados (lo que contesta el servidor), items, compra ({ status,
// cuerpo }) y sinRed (el catálogo no llega).
async function montar(opciones) {
  const o = opciones || {};
  const dom = new JSDOM(HTML, {
    url: o.url || "https://www.macroreborn.com/tienda.html",
    runScripts: "outside-only",
    virtualConsole: consolaCallada()
  });
  const w = dom.window;
  const pedidas = [];
  const sesion = o.sesion === undefined ? null : o.sesion;

  // La barra de navegación la pone js/navbar.js; aquí basta su saldo.
  const barra = w.document.createElement("span");
  barra.id = "navMonedas";
  w.document.body.appendChild(barra);

  w.eval(MRTEXTO + "\nwindow.MRTexto = MRTexto;");
  w.eval(MODAL);
  w.MRSession = {
    get: () => sesion,
    isLogged: () => !!sesion,
    update: (cambios) => Object.assign(sesion, cambios)
  };
  w.fetch = async (url, init) => {
    pedidas.push({ url, init });
    if (url.includes("action=avatar-shop-buy")) {
      const r = o.compra || { status: 200, cuerpo: { success: false, error: "sin respuesta preparada" } };
      return { status: r.status || 200, json: async () => r.cuerpo };
    }
    if (o.sinRed) throw new Error("sin red");
    return {
      status: 200,
      json: async () => ({
        success: true,
        items: o.items || CATALOGO,
        comprados: o.comprados || [],
        monedas: o.monedas === undefined ? null : o.monedas
      })
    };
  };

  w.eval(TIENDA);
  await esperar();

  const d = w.document;
  const $ = (sel) => d.querySelector(sel);
  return {
    w, d, $, pedidas, sesion, barra,
    ids: () => [...d.querySelectorAll(".tienda-item")].map(t => Number(t.dataset.id)),
    tarjeta: (id) => $(`.tienda-item[data-id="${id}"]`),
    accion: (id) => $(`.tienda-item[data-id="${id}"] .tienda-boton`),
    chips: () => [...d.querySelectorAll(".tienda-chip")].map(c => c.textContent.replace(/\s+/g, " ").trim()),
    pulsado: () => $('.tienda-chip[aria-pressed="true"]').dataset.personaje,
    modal: () => $("#mrModalRoot"),
    botonesModal: () => [...d.querySelectorAll("#mrModalRoot .mr-modal-action")],
    elegir: async (id, valor) => {
      const control = d.getElementById(id);
      if (control.type === "checkbox") control.checked = valor; else control.value = valor;
      control.dispatchEvent(new w.Event(control.type === "search" ? "input" : "change", { bubbles: true }));
      await esperar(control.type === "search" ? 200 : 5);
    }
  };
}

describe("sin sesión", () => {

  test("se ve todo el catálogo, sin saldo, y cada prenda invita a iniciar sesión", async () => {
    const t = await montar();
    assert.deepStrictEqual(t.pedidas.map(p => p.url), ["/api/content?action=avatar-shop"]);
    assert.deepStrictEqual(t.ids(), [1, 2, 3, 4]);
    assert.deepStrictEqual(t.chips(), ["Todos 4", "Tora 3", "Cereza 1"]);
    assert.equal(t.pulsado(), "");
    assert.ok(t.$("#tiendaSaldo").hidden);
    assert.ok(!t.$("#tiendaInvitado").hidden);
    assert.ok(t.$("#tiendaPuedoCaja").hidden && t.$("#tiendaOcultarCaja").hidden);
    for (const id of [1, 2, 3, 4]) assert.equal(t.accion(id).getAttribute("href"), "login.html");
    assert.equal(t.$("#tiendaResumen").textContent, "4 prendas");
  });

  test("si hay sesión en el navegador pero el servidor no la reconoce, avisa de que caducó", async () => {
    const t = await montar({ sesion: { nombre: "ana" }, monedas: null });
    assert.match(t.$("#tiendaInvitadoTexto").textContent, /caducó/);
  });

  test("si el catálogo no llega, lo dice", async () => {
    const t = await montar({ sinRed: true });
    assert.match(t.$("#tiendaGrid").textContent, /No se pudo cargar la tienda/);
  });

});

describe("con sesión", () => {

  const conAna = (extra) => montar({ sesion: { nombre: "ana", avatar: { modelo: "tora" } }, monedas: 130, comprados: [2], ...extra });

  test("abre en su personaje y cada prenda dice qué se puede hacer", async () => {
    const t = await conAna();
    assert.equal(t.pulsado(), "tora");
    assert.deepStrictEqual(t.ids(), [1, 2, 3]);
    assert.equal(t.$("#tiendaMonedas").textContent, "🪙 130");

    assert.equal(t.accion(1).textContent, "Comprar");
    assert.equal(t.accion(2).textContent, "Ponértela");
    assert.equal(t.accion(2).getAttribute("href"), "perfil.html?ponerse=tora_remera2");
    assert.ok(t.tarjeta(2).classList.contains("tienda-item--mia"));
    assert.ok(t.accion(3).disabled);
    assert.equal(t.accion(3).textContent, "Te faltan 🪙 " + cifra(770));
  });

  test("con un avatar PNG, abre en el personaje de su receta normal", async () => {
    const t = await montar({
      sesion: { nombre: "jefa", avatar: { tipo: "png", src: "x", restaurar: { modelo: "cereza" } } },
      monedas: 5
    });
    assert.equal(t.pulsado(), "cereza");
    assert.deepStrictEqual(t.ids(), [4]);
  });

  test("marca como nueva solo lo de la última semana", async () => {
    const t = await conAna();
    assert.ok(t.tarjeta(1).querySelector(".tienda-etiqueta:not(.tienda-etiqueta--mia)"));
    assert.equal(t.tarjeta(3).querySelector(".tienda-etiqueta"), null);
  });

  test("todo lo que llega del servidor se escapa", async () => {
    const t = await conAna();
    const nombre = t.tarjeta(1).querySelector(".tienda-item-nombre");
    assert.equal(nombre.textContent, "Melena <b>larga</b>");
    assert.equal(nombre.querySelector("b"), null);
    assert.equal(t.tarjeta(1).querySelector("img").getAttribute("data-src"), "/previsualizaciones/1.jpg?v=aaaaaaaaaaaa");
  });

  test("filtra por personaje, tipo, texto sin acentos y lo que se puede comprar", async () => {
    const t = await conAna();
    t.$('.tienda-chip[data-personaje=""]').click();
    assert.deepStrictEqual(t.ids(), [1, 2, 3, 4]);

    await t.elegir("tiendaTipo", "pelo");
    assert.deepStrictEqual(t.ids(), [1, 4]);
    await t.elegir("tiendaTipo", "");

    await t.elegir("tiendaBuscar", "dragon");
    assert.deepStrictEqual(t.ids(), [3]);
    await t.elegir("tiendaBuscar", "cereza");     // también por personaje
    assert.deepStrictEqual(t.ids(), [4]);
    await t.elegir("tiendaBuscar", "");

    await t.elegir("tiendaPuedo", true);          // 130 monedas, la 2 ya es suya
    assert.deepStrictEqual(t.ids(), [1]);
    await t.elegir("tiendaPuedo", false);

    await t.elegir("tiendaOcultar", true);
    assert.deepStrictEqual(t.ids(), [1, 3, 4]);
  });

  test("ordena por precio y por ventas", async () => {
    const t = await conAna();
    t.$('.tienda-chip[data-personaje=""]').click();
    await t.elegir("tiendaOrden", "baratas");
    assert.deepStrictEqual(t.ids(), [2, 1, 4, 3]);
    await t.elegir("tiendaOrden", "caras");
    assert.deepStrictEqual(t.ids(), [3, 4, 1, 2]);
    await t.elegir("tiendaOrden", "vendidas");
    assert.deepStrictEqual(t.ids(), [2, 1, 4, 3]);
  });

  test("dice cuántas le alcanzan y ofrece ver solo esas", async () => {
    // Lo más nuevo es lo caro: sin esto, quien llega con 500 monedas no
    // ve nada que pueda comprar.
    const t = await conAna();
    t.$('.tienda-chip[data-personaje=""]').click();
    // 130 monedas: le alcanza la 1 (120); la 2 ya es suya; la 3 y la 4, no.
    assert.match(t.$("#tiendaResumen").textContent, /^4 prendas · con tu saldo te alcanza para 1\s+Ver solo esas$/);
    t.$("[data-solo-alcanza]").click();
    assert.deepStrictEqual(t.ids(), [1]);
    assert.ok(t.$("#tiendaPuedo").checked);
    assert.equal(t.$("[data-solo-alcanza]"), null, "sigue ofreciendo lo que ya se ve");
  });

  test("sin resultados, ofrece quitar los filtros", async () => {
    const t = await conAna();
    await t.elegir("tiendaBuscar", "no existe nada así");
    assert.deepStrictEqual(t.ids(), []);
    t.$("[data-quitar-filtros]").click();
    assert.deepStrictEqual(t.ids(), [1, 2, 3, 4]);
    assert.equal(t.pulsado(), "");
    assert.equal(t.$("#tiendaBuscar").value, "");
  });

});

describe("comprar", () => {

  const conAna = (compra) => montar({
    sesion: { nombre: "ana", avatar: { modelo: "tora" }, monedas: 130 }, monedas: 130, comprados: [2], compra
  });

  test("pregunta, compra mandando solo la prenda y ofrece ponérsela", async () => {
    const t = await conAna({ status: 200, cuerpo: {
      success: true, itemComprado: "Melena", monedas: 10,
      prenda: { id: 1, valorCapa: "tora_pelo1", modelo: "tora", categoria: "pelo" }
    } });

    t.accion(1).click();
    assert.equal(t.$("#mrModalTitle").textContent, "¿Comprar «Melena <b>larga</b>»?");
    assert.equal(t.$(".mr-modal-image").getAttribute("src"), "/previsualizaciones/1.jpg?v=aaaaaaaaaaaa");
    assert.deepStrictEqual(t.botonesModal().map(b => b.textContent), ["Cancelar", "Comprar por 🪙 120"]);
    assert.match(t.$(".mr-modal-message").textContent, /Te quedarán 10/);

    t.botonesModal()[1].click();
    await esperar();

    const compra = t.pedidas.find(p => p.url.includes("avatar-shop-buy"));
    assert.equal(compra.init.method, "POST");
    assert.deepStrictEqual(JSON.parse(compra.init.body), { itemId: 1 });

    assert.equal(t.$("#tiendaMonedas").textContent, "🪙 10");
    assert.equal(t.barra.textContent, "🪙 10");
    assert.equal(t.sesion.monedas, 10);
    assert.equal(t.accion(1).textContent, "Ponértela");
    assert.equal(t.$("#mrModalTitle").textContent, "¡Es tuya!");
    assert.deepStrictEqual(t.botonesModal().map(b => b.textContent), ["Seguir mirando", "Ponérmela ahora"]);
  });

  test("cancelar no compra nada", async () => {
    const t = await conAna();
    t.accion(1).click();
    t.botonesModal()[0].click();
    await esperar();
    assert.equal(t.modal(), null);
    assert.ok(!t.pedidas.some(p => p.url.includes("avatar-shop-buy")));
  });

  test("si el servidor dice que no, lo cuenta y no toca el saldo", async () => {
    const t = await conAna({ status: 200, cuerpo: { success: false, error: "No te alcanzan las monedas" } });
    t.accion(1).click();
    t.botonesModal()[1].click();
    await esperar();
    assert.equal(t.$("#mrModalTitle").textContent, "No se pudo comprar");
    assert.equal(t.$(".mr-modal-message").textContent, "No te alcanzan las monedas");
    assert.equal(t.$("#tiendaMonedas").textContent, "🪙 130");
    assert.equal(t.accion(1).textContent, "Comprar");
    assert.ok(!t.accion(1).disabled);
  });

  test("con la sesión caducada, pide volver a iniciarla", async () => {
    const t = await conAna({ status: 401, cuerpo: { success: false, error: "Sesión no válida o expirada" } });
    t.accion(1).click();
    t.botonesModal()[1].click();
    await esperar();
    assert.match(t.$(".mr-modal-message").textContent, /caducó/);
  });

  test("si ya la tenía (otra pestaña), la marca como suya", async () => {
    const t = await conAna({ status: 200, cuerpo: { success: false, error: "Ya tenés esta prenda" } });
    t.accion(1).click();
    t.botonesModal()[1].click();
    await esperar();
    assert.equal(t.accion(1).textContent, "Ponértela");
  });

});

describe("una prenda enlazada (tienda.html?prenda=...)", () => {

  test("se enseña, se destaca y se pregunta si comprarla", async () => {
    const t = await montar({
      url: "https://www.macroreborn.com/tienda.html?prenda=cereza_pelo4",
      sesion: { nombre: "ana", avatar: { modelo: "tora" } }, monedas: 500
    });
    assert.equal(t.pulsado(), "cereza");
    assert.equal(t.$("#tiendaTipo").value, "pelo");
    assert.ok(t.tarjeta(4).classList.contains("tienda-item--destacada"));
    assert.equal(t.$("#mrModalTitle").textContent, "¿Comprar «Coletas»?");
    assert.equal(t.w.location.search, "", "recargar volvería a preguntar");
  });

  test("sin sesión, se enseña pero no se pregunta", async () => {
    const t = await montar({ url: "https://www.macroreborn.com/tienda.html?prenda=cereza_pelo4" });
    assert.ok(t.tarjeta(4).classList.contains("tienda-item--destacada"));
    assert.equal(t.modal(), null);
  });

  test("si ya no está a la venta, lo dice", async () => {
    const t = await montar({ url: "https://www.macroreborn.com/tienda.html?prenda=tora_pelo999" });
    assert.equal(t.$("#mrModalTitle").textContent, "Esa prenda no está a la venta");
  });

  test("aunque esté más allá de la primera página", async () => {
    const muchas = Array.from({ length: 60 }, (_, i) => ({
      id: 100 + i, categoria: "pelo", modelo: "tora", valorCapa: "tora_pelo" + (100 + i),
      nombre: "Pelo " + i, precio: 50, creadoEl: hace(30), previsualizacion: null, vendidas: 0
    }));
    const t = await montar({ url: "https://www.macroreborn.com/tienda.html?prenda=tora_pelo159", items: muchas });
    assert.ok(t.tarjeta(159), "no se pintó la prenda enlazada");
    assert.ok(t.tarjeta(159).classList.contains("tienda-item--destacada"));
  });

});

test("se pinta de 48 en 48, y Ver más añade las siguientes", async () => {
  const muchas = Array.from({ length: 60 }, (_, i) => ({
    id: 100 + i, categoria: "pelo", modelo: "tora", valorCapa: "tora_pelo" + (100 + i),
    nombre: "Pelo " + i, precio: 50, creadoEl: hace(30), previsualizacion: null, vendidas: 0
  }));
  const t = await montar({ items: muchas });
  assert.equal(t.ids().length, 48);
  const verMas = t.$("#tiendaVerMas");
  assert.ok(!verMas.hidden);
  assert.equal(verMas.textContent, "Ver más (12)");
  const primera = t.tarjeta(100);
  verMas.click();
  assert.equal(t.ids().length, 60);
  assert.ok(verMas.hidden);
  assert.equal(t.tarjeta(100), primera, "se volvieron a pintar las que ya estaban");
});

test("la tienda nunca pide el dibujo suelto de una prenda", () => {
  // Solo la previsualización: la prenda suelta es el arte del equipo, y
  // /prendas/ está cerrado a todo el que no lo sea (fase 5 de
  // docs/AVATARES-SERVIDOR.md).
  assert.ok(!/["'`]\/prendas\//.test(TIENDA), "js/tienda.js pide /prendas/");
  assert.ok(!/rutaCapaAvatar|ORDEN_CAPAS_AVATAR/.test(TIENDA), "js/tienda.js dibuja por capas");
});

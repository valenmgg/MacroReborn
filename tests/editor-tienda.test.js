// ==============================
// EL EDITOR Y LA TIENDA — tests/editor-tienda.test.js
// ==============================
// Los dos caminos entre el editor del perfil y la tienda (tienda.html):
//
//   - Una prenda con candado ofrece ir a comprarla, y lleva a
//     tienda.html?prenda=<valor>, que la enseña y pregunta.
//   - Tras comprar, perfil.html?ponerse=<valor> abre el editor con la
//     prenda puesta; si es de otro personaje, cambia de personaje y lo
//     avisa; si no es suya, sale el candado.
//
// Se evalúan los trozos de verdad de js/perfil.js sobre el perfil.html
// de verdad, con el diálogo de verdad (js/modal.js). La red, la
// dirección y la vista previa son de mentira.
//
// Correr:  npm test

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const RAIZ = path.join(__dirname, "..");
// Sin los CR: en Windows la copia de trabajo está en CRLF.
const FUENTE = fs.readFileSync(path.join(RAIZ, "js", "perfil.js"), "utf8").replace(/\r\n/g, "\n");
const HTML = fs.readFileSync(path.join(RAIZ, "perfil.html"), "utf8");
const MODAL = fs.readFileSync(path.join(RAIZ, "js", "modal.js"), "utf8");

function trozo(desde, hasta) {
  const i = FUENTE.indexOf(desde);
  const j = FUENTE.indexOf(hasta, i);
  assert.ok(i !== -1 && j > i, "no está el trozo que empieza por " + desde);
  return FUENTE.slice(i, j);
}

// En el orden del archivo: catálogo y estado del editor; tienda;
// pestañas y abrir el editor; clic en una prenda, ponerse lo comprado y
// el arranque.
const TROZOS = [
  trozo("let CATALOGO = null;", "// ---------- AVATAR (Neon: users.avatar) ----------"),
  trozo("// ---------- CENTRO DE AVATARES (tienda) ----------", "// ---------- PREVIEW EDITOR ----------"),
  trozo("// ---------- FILTRAR OPCIONES SEGÚN EL MODELO ELEGIDO ----------", "// ---------- GUARDAR AVATAR ----------"),
  trozo("// ---------- OPCIONES EDITOR (con toggle para deseleccionar) ----------", "// ---------- INICIO ----------")
];

const ORDEN = ["fondo", "espalda", "modelo", "piel", "ojos", "boca", "botas", "pantalon",
               "remera", "guantes", "accesorio", "cara", "pelo", "mascota", "borde"];

const prenda = (valor, modelo, capa) => ({
  valor, modelo, capa, nombre: valor, precio: null,
  previsualizacion: "/previsualizaciones/" + valor + ".jpg?v=aaaaaaaaaaaa"
});

const CATALOGO = {
  success: true,
  version: 1,
  capas: ORDEN,
  modelos: [prenda("tora", "tora", "modelo"), prenda("cereza", "cereza", "modelo")],
  prendas: [
    prenda("tora_pelo1", "tora", "pelo"),
    prenda("tora_pelo2", "tora", "pelo"),
    prenda("cereza_pelo1", "cereza", "pelo"),
    prenda("tora_botas1", "tora", "botas")
  ]
};

// Desde la migración 022 todo tiene precio. Son suyas la 1 y la 3.
const TIENDA = {
  success: true,
  items: CATALOGO.prendas.map((p, i) => ({ id: i + 1, valorCapa: p.valor, modelo: p.modelo, categoria: p.capa, precio: 120 })),
  comprados: [1, 3],
  monedas: 500
};

async function montar(opciones) {
  const o = opciones || {};
  const dom = new JSDOM(HTML, { url: "https://www.macroreborn.com/perfil.html", runScripts: "outside-only" });
  dom.window.eval(MODAL);

  const direccion = {
    search: o.search || "",
    pathname: "/perfil.html",
    hash: "",
    href: "https://www.macroreborn.com/perfil.html" + (o.search || "")
  };
  const reemplazos = [];
  const previas = [];
  const guardado = { modelo: "tora", botas: "tora_botas1" };

  const contexto = {
    document: dom.window.document,
    window: { location: direccion, MRModal: dom.window.MRModal },
    MRModal: dom.window.MRModal,
    history: { replaceState: (_estado, _titulo, url) => reemplazos.push(url) },
    URLSearchParams,
    console: { warn() {}, error() {}, log() {} },
    confirm: () => { throw new Error("no debería usarse confirm(): está MRModal"); },
    fetch: async (url) => ({
      ok: true,
      status: 200,
      json: async () => url.includes("avatar-catalogo-completo") ? CATALOGO : (o.tienda || TIENDA)
    }),
    ORDEN_CAPAS_AVATAR: ORDEN,
    cargarAvatar: () => ({ ...guardado }),
    avatarEsPNG: () => false,
    actualizarPreview: () => previas.push(1),
    actualizarAvatarPrincipal: () => {}
  };
  vm.createContext(contexto);
  for (const t of TROZOS) vm.runInContext(t, contexto);
  await new Promise(r => setTimeout(r, 20));

  const d = dom.window.document;
  return {
    d,
    direccion,
    reemplazos,
    capas: () => vm.runInContext("({ ...editorCapas })", contexto),
    editorAbierto: () => d.getElementById("editorAvatar").style.display === "block",
    opcion: (valor) => d.querySelector(`.opcion-item[data-valor="${valor}"]`),
    pestana: () => d.querySelector(".cat-btn.activa-cat").dataset.cat,
    tituloModal: () => (d.getElementById("mrModalTitle") || {}).textContent || null,
    botonesModal: () => [...d.querySelectorAll("#mrModalRoot .mr-modal-action")]
  };
}

describe("perfil.html?ponerse=<valor>", () => {

  test("una prenda suya de su personaje: abre el editor con ella puesta, en su pestaña", async () => {
    const p = await montar({ search: "?ponerse=tora_pelo1" });
    assert.ok(p.editorAbierto());
    assert.equal(p.capas().pelo, "tora_pelo1");
    assert.equal(p.capas().botas, "tora_botas1", "se quitó lo que llevaba puesto");
    assert.equal(p.pestana(), "pelo");
    assert.ok(p.opcion("tora_pelo1").classList.contains("seleccionada"));
    assert.equal(p.tituloModal(), null);
    assert.deepStrictEqual(p.reemplazos, ["/perfil.html"], "recargar volvería a hacerlo");
  });

  test("de otro personaje: cambia de personaje, quita lo demás y lo avisa", async () => {
    const p = await montar({ search: "?ponerse=cereza_pelo1" });
    const capas = p.capas();
    assert.equal(capas.modelo, "cereza");
    assert.equal(capas.pelo, "cereza_pelo1");
    assert.equal(capas.botas, "ninguno");
    assert.equal(p.tituloModal(), "Es de Cereza");
  });

  test("una que no es suya: no se la pone, sale el candado y lleva a la tienda", async () => {
    const p = await montar({ search: "?ponerse=tora_pelo2" });
    assert.notEqual(p.capas().pelo, "tora_pelo2");
    assert.equal(p.tituloModal(), "Todavía no es tuya");
    p.botonesModal()[1].click();
    assert.equal(p.direccion.href, "tienda.html?prenda=tora_pelo2");
  });

  test("sin ?ponerse no abre nada", async () => {
    const p = await montar();
    assert.ok(!p.editorAbierto());
    assert.deepStrictEqual(p.reemplazos, []);
  });

  test("una que no existe no hace nada, pero limpia la dirección", async () => {
    const p = await montar({ search: "?ponerse=tora_pelo999" });
    assert.ok(!p.editorAbierto());
    assert.deepStrictEqual(p.reemplazos, ["/perfil.html"]);
  });

});

describe("el candado del editor", () => {

  test("ofrece verla en la tienda, con la prenda en la dirección", async () => {
    const p = await montar();
    p.d.getElementById("botonCrearAvatar").click();
    assert.ok(p.opcion("tora_pelo2").classList.contains("cr-bloqueada"));
    assert.ok(!p.opcion("tora_pelo1").classList.contains("cr-bloqueada"));

    p.opcion("tora_pelo2").click();
    assert.equal(p.tituloModal(), "Todavía no es tuya");
    assert.deepStrictEqual(p.botonesModal().map(b => b.textContent), ["Ahora no", "Verla en la tienda"]);
    assert.notEqual(p.capas().pelo, "tora_pelo2");

    p.botonesModal()[1].click();
    assert.equal(p.direccion.href, "tienda.html?prenda=tora_pelo2");
  });

  test("\"Ahora no\" se queda en el editor", async () => {
    const p = await montar();
    p.d.getElementById("botonCrearAvatar").click();
    p.opcion("tora_pelo2").click();
    p.botonesModal()[0].click();
    assert.equal(p.tituloModal(), null);
    assert.equal(p.direccion.href, "https://www.macroreborn.com/perfil.html");
  });

  test("si el servidor no reconoce la sesión, no bloquea nada", async () => {
    const p = await montar({ tienda: { ...TIENDA, comprados: [], monedas: null } });
    assert.equal(p.d.querySelectorAll(".cr-bloqueada").length, 0);
  });

});

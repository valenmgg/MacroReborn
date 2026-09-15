// ==============================
// TESTS DEL EDITOR DE AVATARES — tests/editor-avatar.test.js
// ==============================
// Son los primeros tests que cargan el editor. Hasta ahora no había
// ninguno: el editor era HTML fijo con 622 divs escritos a mano, y todo
// lo que hacía js/perfil.js con ellos se comprobaba a ojo.
//
// Eso dejó de ser aceptable cuando esos divs pasaron a generarse desde
// el catálogo: si la construcción falla, la gente se queda sin poder
// cambiarse el avatar y nadie se entera hasta que alguien lo reporta.
//
// No se prueba una copia del código: se lee js/perfil.js del disco y se
// evalúa su bloque de catálogo tal cual, sobre el perfil.html de verdad
// cargado en jsdom. Si alguien renombra un contenedor en el HTML o
// cambia la forma de una prenda, esto tiene que romperse.
//
// Correr:  npm test

const { test, before, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const RAIZ = path.join(__dirname, "..");
const FUENTE = fs.readFileSync(path.join(RAIZ, "js", "perfil.js"), "utf8");
const HTML = fs.readFileSync(path.join(RAIZ, "perfil.html"), "utf8");

// El trozo de js/perfil.js que maneja el catálogo. Se corta entre dos
// marcas estables del propio archivo.
const INICIO = "let CATALOGO = null;";
const FINAL = "let editorCapas={";

function bloqueDelCatalogo() {
  const i = FUENTE.indexOf(INICIO);
  const j = FUENTE.indexOf(FINAL, i);
  assert.ok(i !== -1, "no se encontró el inicio del bloque de catálogo en js/perfil.js");
  assert.ok(j !== -1, "no se encontró el final del bloque de catálogo en js/perfil.js");
  return FUENTE.slice(i, j);
}

// Un catálogo de mentira con la misma forma que el que manda el
// servidor.
function catalogoDePrueba(extra) {
  return Object.assign({
    success: true,
    version: 7,
    capas: ["fondo", "espalda", "modelo", "piel", "ojos", "boca",
            "botas", "pantalon", "remera", "guantes", "accesorio",
            "cara", "pelo", "mascota", "borde"],
    modelos: [
      { valor: "tora", modelo: "tora", capa: "modelo", nombre: "Tora", url: "/prendas/aaa.png", precio: null },
      { valor: "cereza", modelo: "cereza", capa: "modelo", nombre: "Cereza", url: "/prendas/bbb.png", precio: null }
    ],
    prendas: [
      { valor: "tora_botas1", modelo: "tora", capa: "botas", nombre: "Botas de combate", url: "/prendas/ccc.png", precio: 140 },
      { valor: "tora_botas2", modelo: "tora", capa: "botas", nombre: "Botas 2", url: "/prendas/ddd.png", precio: null },
      { valor: "cereza_botas1", modelo: "cereza", capa: "botas", nombre: "Botas urbanas", url: "/prendas/eee.png", precio: null },
      { valor: "tora_pelo1", modelo: "tora", capa: "pelo", nombre: "Pelo 1", url: "/prendas/fff.png", precio: null }
    ]
  }, extra || {});
}

// Monta el editor: perfil.html de verdad + el bloque real de perfil.js.
function montar(respuesta) {
  const dom = new JSDOM(HTML, { url: "https://macroreborn.com/perfil.html" });

  const contexto = {
    document: dom.window.document,
    window: dom.window,
    console: { warn() {}, error() {}, log() {} },
    // Lo que usa el camino de respaldo cuando no hay catálogo.
    rutaCapaAvatar(valor) {
      if (!valor || valor === "ninguno") return null;
      const i = valor.indexOf("_");
      if (i === -1) return "imagenes/" + valor + ".png";
      return "imagenes/" + valor.slice(0, i) + "/" + valor.slice(i + 1) + ".png";
    },
    fetch: respuesta
  };

  vm.createContext(contexto);
  const api = vm.runInContext(
    bloqueDelCatalogo() +
    "\n;({ cargarCatalogo, construirOpcionesDelEditor, rutaDePrenda, valoresDelCatalogo, avisarCatalogoCaido })",
    contexto
  );

  return { dom, doc: dom.window.document, api };
}

function respuestaOk(datos) {
  return () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(datos) });
}

// ==============================

describe("el HTML trae los contenedores que el editor necesita", () => {
  test("los 15 botones de categoría y los 15 grupos siguen en perfil.html", () => {
    const { doc } = montar(respuestaOk(catalogoDePrueba()));

    assert.equal(doc.querySelectorAll(".cat-btn").length, 15);
    assert.equal(doc.querySelectorAll(".grupo-opcion").length, 15);
    assert.equal(doc.querySelectorAll(".grupo-opcion .fila-opciones").length, 15);
  });

  test("y ya NO trae prendas escritas a mano", () => {
    const { doc } = montar(respuestaOk(catalogoDePrueba()));

    assert.equal(
      doc.querySelectorAll(".opcion-item").length, 0,
      "perfil.html no debería traer ninguna prenda: las pone el catálogo"
    );
  });
});

describe("construir las opciones desde el catálogo", () => {
  test("cada prenda va a la fila de su ranura", async () => {
    const { doc, api } = montar(respuestaOk(catalogoDePrueba()));

    await api.cargarCatalogo();
    assert.equal(api.construirOpcionesDelEditor(), true);

    const botas = doc.querySelector('.grupo-opcion[data-grupo="botas"]');
    const pelo = doc.querySelector('.grupo-opcion[data-grupo="pelo"]');
    const modelo = doc.querySelector('.grupo-opcion[data-grupo="modelo"]');

    assert.equal(botas.querySelectorAll(".opcion-item").length, 3);
    assert.equal(pelo.querySelectorAll(".opcion-item").length, 1);
    assert.equal(modelo.querySelectorAll(".opcion-item").length, 2);
  });

  test("cada opción lleva los datos que el editor lee", async () => {
    const { doc, api } = montar(respuestaOk(catalogoDePrueba()));

    await api.cargarCatalogo();
    api.construirOpcionesDelEditor();

    const item = doc.querySelector('.opcion-item[data-valor="tora_botas1"]');
    assert.ok(item, "debería existir la opción");
    assert.equal(item.dataset.capa, "botas");
    assert.equal(item.dataset.modelo, "tora");
    assert.equal(item.querySelector("img").getAttribute("src"), "/prendas/ccc.png");
    assert.equal(item.querySelector("img").getAttribute("loading"), "lazy");
    assert.match(item.textContent, /Botas de combate/);
  });

  test("el selector de personaje NO lleva data-modelo", async () => {
    // filtrarOpcionesPorModelo() oculta lo que tenga un data-modelo
    // distinto al elegido. Los personajes tienen que verse siempre, así
    // que no deben llevarlo: si lo llevaran, al elegir uno desaparecerían
    // los demás y no habría forma de cambiar de personaje.
    const { doc, api } = montar(respuestaOk(catalogoDePrueba()));

    await api.cargarCatalogo();
    api.construirOpcionesDelEditor();

    const modelos = doc.querySelectorAll('.grupo-opcion[data-grupo="modelo"] .opcion-item');
    assert.equal(modelos.length, 2);
    modelos.forEach(m => assert.equal(m.dataset.modelo, undefined));
  });

  test("construir dos veces no duplica las opciones", async () => {
    const { doc, api } = montar(respuestaOk(catalogoDePrueba()));

    await api.cargarCatalogo();
    api.construirOpcionesDelEditor();
    api.construirOpcionesDelEditor();

    assert.equal(
      doc.querySelectorAll('.grupo-opcion[data-grupo="botas"] .opcion-item').length, 3
    );
  });

  test("el nombre de una prenda se inserta como texto, no como HTML", async () => {
    // En cuanto el equipo de arte pueda subir prendas, este nombre lo
    // habrá escrito una persona. Pegarlo como HTML sería un agujero de
    // scripting en la página que más usa la gente.
    const malicioso = catalogoDePrueba({
      prendas: [{
        valor: "tora_botas9", modelo: "tora", capa: "botas",
        nombre: '<img src=x onerror="robar()">Botas',
        url: "/prendas/ggg.png", precio: null
      }]
    });

    const { doc, api } = montar(respuestaOk(malicioso));
    await api.cargarCatalogo();
    api.construirOpcionesDelEditor();

    const item = doc.querySelector('.opcion-item[data-valor="tora_botas9"]');
    // Una sola imagen: la de la prenda. La del nombre no debe existir.
    assert.equal(item.querySelectorAll("img").length, 1);
    assert.equal(item.querySelector("img").getAttribute("src"), "/prendas/ggg.png");
    assert.match(item.textContent, /onerror/, "el texto debe verse tal cual, escapado");
  });
});

describe("resolver la ruta de una prenda", () => {
  test("sin catálogo cargado, cae en la ruta de siempre", () => {
    const { api } = montar(respuestaOk(catalogoDePrueba()));

    // Todavía no se llamó a cargarCatalogo().
    assert.equal(api.rutaDePrenda("tora_pelo3"), "imagenes/tora/pelo3.png");
    assert.equal(api.rutaDePrenda("tora"), "imagenes/tora.png");
  });

  test("con catálogo cargado, manda el catálogo", async () => {
    const { api } = montar(respuestaOk(catalogoDePrueba()));
    await api.cargarCatalogo();

    assert.equal(api.rutaDePrenda("tora_botas1"), "/prendas/ccc.png");
    assert.equal(api.rutaDePrenda("tora"), "/prendas/aaa.png");
  });

  test("un valor que ya no existe deja de pedirse", async () => {
    // "tora_piel7" lo tienen tres cuentas guardado y su fichero se borró
    // hace tiempo: hoy da un 404 en la consola de esas personas.
    const { api } = montar(respuestaOk(catalogoDePrueba()));
    await api.cargarCatalogo();

    assert.equal(api.rutaDePrenda("tora_piel7"), null);
  });

  test("ninguno y vacío no dibujan nada", async () => {
    const { api } = montar(respuestaOk(catalogoDePrueba()));
    await api.cargarCatalogo();

    assert.equal(api.rutaDePrenda("ninguno"), null);
    assert.equal(api.rutaDePrenda(""), null);
    assert.equal(api.rutaDePrenda(null), null);
  });
});

describe("cuando el catálogo no llega", () => {
  test("no revienta y avisa en cada grupo", async () => {
    const { doc, api } = montar(() => Promise.reject(new Error("sin red")));

    const datos = await api.cargarCatalogo();
    assert.equal(datos, null);
    assert.equal(api.construirOpcionesDelEditor(), false);

    api.avisarCatalogoCaido();
    const avisos = doc.querySelectorAll(".sin-opciones");
    assert.equal(avisos.length, 15, "debería avisar en los 15 grupos");
    assert.match(avisos[0].textContent, /recargar/i);
  });

  test("un 500 del servidor se trata igual que quedarse sin red", async () => {
    const { api } = montar(() => Promise.resolve({ ok: false, status: 500 }));

    assert.equal(await api.cargarCatalogo(), null);
    assert.equal(api.construirOpcionesDelEditor(), false);
    // Y los avatares se siguen dibujando con la ruta de siempre.
    assert.equal(api.rutaDePrenda("tora_pelo3"), "imagenes/tora/pelo3.png");
  });

  test("solo se pide el catálogo una vez aunque se llame varias", async () => {
    let llamadas = 0;
    const { api } = montar(() => {
      llamadas++;
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(catalogoDePrueba()) });
    });

    await Promise.all([api.cargarCatalogo(), api.cargarCatalogo(), api.cargarCatalogo()]);
    assert.equal(llamadas, 1);
  });
});

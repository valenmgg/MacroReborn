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
const FUENTE_CORE = fs.readFileSync(path.join(RAIZ, "js", "core.js"), "utf8");
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
      { valor: "tora", modelo: "tora", capa: "modelo", nombre: "Tora", url: "/prendas/aaa.png", precio: null,
        previsualizacion: "/previsualizaciones/1.jpg?v=aaaaaaaaaaaa" },
      { valor: "cereza", modelo: "cereza", capa: "modelo", nombre: "Cereza", url: "/prendas/bbb.png", precio: null,
        previsualizacion: "/previsualizaciones/2.jpg?v=bbbbbbbbbbbb" }
    ],
    prendas: [
      { valor: "tora_botas1", modelo: "tora", capa: "botas", nombre: "Botas de combate", url: "/prendas/ccc.png", precio: 140,
        previsualizacion: "/previsualizaciones/3.jpg?v=cccccccccccc" },
      { valor: "tora_botas2", modelo: "tora", capa: "botas", nombre: "Botas 2", url: "/prendas/ddd.png", precio: null,
        previsualizacion: "/previsualizaciones/4.jpg?v=dddddddddddd" },
      { valor: "cereza_botas1", modelo: "cereza", capa: "botas", nombre: "Botas urbanas", url: "/prendas/eee.png", precio: null,
        previsualizacion: "/previsualizaciones/5.jpg?v=eeeeeeeeeeee" },
      { valor: "tora_pelo1", modelo: "tora", capa: "pelo", nombre: "Pelo 1", url: "/prendas/fff.png", precio: null,
        previsualizacion: "/previsualizaciones/6.jpg?v=ffffffffffff" }
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
    fetch: respuesta
  };

  vm.createContext(contexto);

  const api = vm.runInContext(
    bloqueDelCatalogo() +
    "\n;({ cargarCatalogo, construirOpcionesDelEditor, valoresDelCatalogo, avisarCatalogoCaido, mostrarImagenesVisibles })",
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
    // El src no se asigna al construir: la URL espera en data-src
    // hasta que la miniatura se ve. Ver mostrarImagenesVisibles().
    assert.equal(item.querySelector("img").dataset.src, "/previsualizaciones/3.jpg?v=cccccccccccc");
    assert.equal(item.querySelector("img").getAttribute("src"), null);
    assert.equal(item.querySelector("img").getAttribute("loading"), "lazy");
    assert.match(item.textContent, /Botas de combate/);
  });

  test("con previsualizacion, la miniatura es la previsualizacion", async () => {
    // La prenda puesta en su maniqui, un JPG cuadrado.
    const { doc, api } = montar(respuestaOk(catalogoDePrueba()));

    await api.cargarCatalogo();
    api.construirOpcionesDelEditor();

    const img = doc.querySelector('.opcion-item[data-valor="tora_botas1"] img');
    assert.equal(img.dataset.src, "/previsualizaciones/3.jpg?v=cccccccccccc");
    assert.ok(img.classList.contains("previsualizacion"), "sin la clase se veria estirada en la caja alta");
  });

  test("y sin ella NO se cae al dibujo suelto de la prenda", async () => {
    // Fase 5: ese dibujo es justo lo que no tiene que salir del equipo de
    // arte. La caja se queda con su nombre y sin imagen.
    const catalogo = catalogoDePrueba();
    delete catalogo.prendas[1].previsualizacion;
    const { doc, api } = montar(respuestaOk(catalogo));

    await api.cargarCatalogo();
    api.construirOpcionesDelEditor();

    const sin = doc.querySelector('.opcion-item[data-valor="tora_botas2"]');
    assert.equal(sin.querySelector("img").dataset.src, undefined);
    assert.equal(sin.querySelector("img").getAttribute("src"), null);
    assert.match(sin.textContent, /Botas 2/);
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
        url: "/prendas/ggg.png", precio: null,
        previsualizacion: "/previsualizaciones/9.jpg?v=999999999999"
      }]
    });

    const { doc, api } = montar(respuestaOk(malicioso));
    await api.cargarCatalogo();
    api.construirOpcionesDelEditor();

    const item = doc.querySelector('.opcion-item[data-valor="tora_botas9"]');
    // Una sola imagen: la de la prenda. La del nombre no debe existir.
    assert.equal(item.querySelectorAll("img").length, 1);
    // El src no se asigna al construir: la URL espera en data-src
    // hasta que la miniatura se ve. Ver mostrarImagenesVisibles().
    assert.equal(item.querySelector("img").dataset.src, "/previsualizaciones/9.jpg?v=999999999999");
    assert.equal(item.querySelector("img").getAttribute("src"), null);
    assert.match(item.textContent, /onerror/, "el texto debe verse tal cual, escapado");
  });
});

describe("el editor no guarda ni pide prendas sueltas", () => {
  // Fase 5 de docs/AVATARES-SERVIDOR.md. Aquí vivía rutaDePrenda(), que
  // traducía cada valor a la dirección de su dibujo para apilar las
  // capas. Ya no se apila nada: la vista previa la dibuja el servidor.
  test("ninguna miniatura ni ningún dato apunta a /prendas/", async () => {
    const { doc, api } = montar(respuestaOk(catalogoDePrueba()));
    await api.cargarCatalogo();
    api.construirOpcionesDelEditor();

    const html = doc.getElementById("editorAvatar").outerHTML;
    assert.ok(!html.includes("/prendas/"), "el editor lleva direcciones de prendas sueltas");
  });

  test("y lo que ofrece sale del catálogo, sin sus direcciones", async () => {
    const { api } = montar(respuestaOk(catalogoDePrueba()));
    await api.cargarCatalogo();

    assert.deepStrictEqual([...api.valoresDelCatalogo()].sort(),
      ["cereza", "cereza_botas1", "tora", "tora_botas1", "tora_botas2", "tora_pelo1"]);
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
    assert.deepStrictEqual([...api.valoresDelCatalogo()], []);
  });

  test("solo se pide el catálogo una vez aunque se llame varias", async () => {
    // Se cuentan SOLO las llamadas al catálogo completo, que es lo que
    // pide esta página. La otra que sale de aquí es el índice público,
    // que dispara js/core.js solo al cargarse para poder dibujar los
    // avatares de los comentarios y de quien pasa por el perfil. Son dos
    // peticiones distintas a propósito desde que el catálogo se partió
    // en dos: una pública para dibujar y una con sesión para vestir.
    let llamadas = 0;
    const { api } = montar((url) => {
      if (String(url).includes("avatar-catalogo-completo")) llamadas++;
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(catalogoDePrueba()) });
    });

    await Promise.all([api.cargarCatalogo(), api.cargarCatalogo(), api.cargarCatalogo()]);
    assert.equal(llamadas, 1);
  });
});

// ==============================
// UNA PRENDA RETIRADA NO SE OFRECE
// ==============================
// Retirar una prenda la saca del editor, no del avatar de quien ya la
// llevaba. Lo segundo ya no es cosa del editor: el avatar lo dibuja el
// servidor, y su receta incluye lo retirado (ver recetaDe en
// api/_avatar-compuesto.js). Lo primero sí.

const CON_RETIRADAS = () => catalogoDePrueba({
  retiradas: [
    { valor: "cereza_fondo40", url: "/prendas/ret1.png" },
    { valor: "cereza_piel4", url: "/prendas/ret2.png" }
  ]
});

describe("una prenda retirada", () => {
  test("NO aparece como opción del editor", async () => {
    const { api } = montar(respuestaOk(CON_RETIRADAS()));
    await api.cargarCatalogo();

    const valores = api.valoresDelCatalogo();
    assert.ok(!valores.includes("cereza_fondo40"), "retirada: no se puede elegir");
    assert.ok(!valores.includes("cereza_piel4"), "retirada: no se puede elegir");
    assert.ok(valores.includes("tora_botas1"), "publicada: sí se puede elegir");
  });

  test("un catálogo sin el campo retiradas no rompe nada", async () => {
    // Por si el servidor es más viejo que el frontend.
    const { api } = montar(respuestaOk(catalogoDePrueba()));
    assert.ok(await api.cargarCatalogo());
    assert.ok(api.valoresDelCatalogo().includes("tora_botas1"));
  });
});

// ==============================
// LAS MINIATURAS NO SE PIDEN HASTA QUE SE VEN
// ==============================
// El editor tiene 638 miniaturas dentro de un #editorAvatar con
// display:none. Ninguna debe descargarse al cargar el perfil.
//
// Se intentó tres veces con loading="lazy" y no funciona: medido con HAR
// de cargas reales salieron 25 miniaturas, luego 3, luego 160, sin tocar
// ese código en medio. Un navegador no aplaza imágenes que no tienen
// caja de dibujo.
//
// El contrato ahora es del DOM y no del navegador: al construir NO se
// asigna src; la URL vive en data-src y pasa a src cuando la miniatura
// está realmente dibujándose. Eso sí se puede comprobar.

describe("construir el editor no pide ninguna imagen", () => {
  function espiar(dom) {
    const puestos = [];
    const win = dom.window;
    const desc = Object.getOwnPropertyDescriptor(win.HTMLImageElement.prototype, "src");
    Object.defineProperty(win.HTMLImageElement.prototype, "src", {
      configurable: true,
      get() { return desc.get.call(this); },
      set(v) { puestos.push(v); desc.set.call(this, v); }
    });
    return puestos;
  }

  test("ni un solo src al construir las opciones", async () => {
    const { dom, api } = montar(respuestaOk(catalogoDePrueba()));
    const puestos = espiar(dom);

    await api.cargarCatalogo();
    api.construirOpcionesDelEditor();

    assert.equal(puestos.length, 0,
      "se asignaron " + puestos.length + " src al construir: eso son descargas");
  });

  test("pero la URL queda guardada en data-src", async () => {
    const { doc, api } = montar(respuestaOk(catalogoDePrueba()));
    await api.cargarCatalogo();
    api.construirOpcionesDelEditor();

    const imgs = doc.querySelectorAll("#editorAvatar .opcion-item img");
    assert.ok(imgs.length > 0, "debería haber miniaturas");
    const sinDato = [...imgs].filter(i => !i.dataset.src);
    assert.equal(sinDato.length, 0, "toda miniatura necesita su data-src");
    assert.ok([...imgs].every(i => !i.getAttribute("src")), "ninguna con src todavía");
  });

  test("y el editor sigue oculto", () => {
    const { doc } = montar(respuestaOk(catalogoDePrueba()));
    const editor = doc.getElementById("editorAvatar");
    assert.match(editor.getAttribute("style") || "", /display\s*:\s*none/);
  });
});

describe("cuando la miniatura se ve, entonces sí se pide", () => {
  test("mostrarImagenesVisibles pasa data-src a src solo en las visibles", async () => {
    const { doc, api } = montar(respuestaOk(catalogoDePrueba()));
    await api.cargarCatalogo();
    api.construirOpcionesDelEditor();

    const imgs = [...doc.querySelectorAll("#editorAvatar .opcion-item img")];
    assert.ok(imgs.length >= 2);

    // jsdom no hace maquetación, así que offsetParent es siempre null:
    // se simula que la primera está dibujándose y el resto no.
    Object.defineProperty(imgs[0], "offsetParent", { value: {}, configurable: true });

    api.mostrarImagenesVisibles();

    assert.ok(imgs[0].getAttribute("src"), "la visible debería haber pedido su dibujo");
    assert.equal(imgs[0].dataset.src, undefined, "y soltar su data-src");

    const otras = imgs.slice(1).filter(i => i.getAttribute("src"));
    assert.equal(otras.length, 0, "las que siguen ocultas, ni tocarlas");
  });

  test("llamarla dos veces no vuelve a asignar nada", async () => {
    const { doc, api } = montar(respuestaOk(catalogoDePrueba()));
    await api.cargarCatalogo();
    api.construirOpcionesDelEditor();

    const img = doc.querySelector("#editorAvatar .opcion-item img");
    Object.defineProperty(img, "offsetParent", { value: {}, configurable: true });

    api.mostrarImagenesVisibles();
    const primera = img.getAttribute("src");
    api.mostrarImagenesVisibles();

    assert.equal(img.getAttribute("src"), primera);
  });
});

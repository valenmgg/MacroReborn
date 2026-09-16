// ==============================
// EL TALLER — tests/taller.test.js
// ==============================
// Los seis pasos, con arte.html de verdad en jsdom y los tres archivos
// tal cual están en el disco.
//
// Se prueba sobre todo LA PUERTA, que es lo que el taller aporta: que no
// se pueda llegar a publicar sin haber resuelto la medida, el nombre y el
// destino de cada prenda. Esos son los tres modos de fallo que dejaron
// cinco de cinco prendas retiradas.
//
// El caso que se usa una y otra vez es el real: una captura de pantalla
// de 1919x1079 llamada "Captura de pantalla 2026 09 15 113043.png". En
// producción hay una prenda publicada con ese nombre.
//
// Correr:  npm test

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");

const RAIZ = path.join(__dirname, "..");
const HTML = fs.readFileSync(path.join(RAIZ, "arte.html"), "utf8");
const VESTIDOR = fs.readFileSync(path.join(RAIZ, "js", "arte-vestidor.js"), "utf8");
const TALLER = fs.readFileSync(path.join(RAIZ, "js", "arte-taller.js"), "utf8");
const ARTE = fs.readFileSync(path.join(RAIZ, "js", "arte.js"), "utf8");

// De js/core.js sólo hacen falta dos cosas; evaluarlo entero pediría el
// catálogo por red y montaría dos observadores sobre todo el documento.
const DE_CORE = `
var ORDEN_CAPAS_AVATAR = ["fondo","espalda","modelo","piel","ojos","boca",
  "botas","pantalon","remera","guantes","accesorio","cara","pelo","mascota","borde"];
function activarImagenesPerezosas() {}
`;

function panelDePrueba() {
  return {
    success: true,
    capas: ["fondo", "espalda", "piel", "ojos", "boca", "botas", "pantalon",
            "remera", "guantes", "accesorio", "cara", "pelo", "mascota", "borde"],
    modelos: [
      { id: 1, valor: "tora", modelo: "tora", capa: "modelo", nombre: "Tora", url: "/p/a.png", medidas: "327x504", peso: 1, publicada: true, autor: null, precio: null },
      { id: 2, valor: "cereza", modelo: "cereza", capa: "modelo", nombre: "Cereza", url: "/p/b.png", medidas: "326x503", peso: 1, publicada: true, autor: null, precio: null }
    ],
    prendas: [
      { id: 10, valor: "tora_pelo1", modelo: "tora", capa: "pelo", nombre: "Pelo 1", url: "/p/c.png", medidas: "327x504", peso: 1, publicada: true, autor: null, precio: null },
      { id: 11, valor: "tora_accesorio1", modelo: "tora", capa: "accesorio", nombre: "Accesorio 1", url: "/p/d.png", medidas: "327x504", peso: 1, publicada: true, autor: null, precio: null }
    ],
    esAdmin: true,
    yo: "soydegurime"
  };
}

async function montar(respuestas) {
  const consola = new VirtualConsole();
  const rotos = [];
  consola.on("jsdomError", e => rotos.push(String(e.message).slice(0, 160)));

  const dom = new JSDOM(HTML, {
    url: "https://macroreborn.com/arte.html",
    runScripts: "outside-only",
    virtualConsole: consola
  });

  const win = dom.window;
  win.Element.prototype.scrollIntoView = function () {};
  win.alert = () => {};
  win.confirm = () => true;
  win.prompt = () => null;

  const llamadas = [];
  win.fetch = (url, opciones) => {
    llamadas.push({ url: String(url), opciones: opciones || {} });
    const propia = respuestas && respuestas(String(url), opciones || {});
    if (propia) return Promise.resolve(propia);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(panelDePrueba()) });
  };

  win.eval(DE_CORE);
  win.eval(VESTIDOR);
  win.eval(TALLER);
  win.eval(ARTE);

  for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0));

  return { dom, win, doc: win.document, llamadas, rotos };
}

const $ = (doc, id) => doc.getElementById(id);

function pasoActual(doc) {
  const a = doc.querySelector(".taller-hito[aria-current=step]");
  if (!a) return 0;
  return Number(a.querySelector(".taller-bolita").textContent) || 0;
}

// Mete un PNG por el mismo camino que usa el artista.
async function traer(win, doc, nombre, ancho, alto) {
  win.Image = class {
    set src(_) {
      this.naturalWidth = ancho;
      this.naturalHeight = alto;
      setTimeout(() => { if (this.onload) this.onload(); }, 0);
    }
  };
  const input = $(doc, "arteArchivos");
  Object.defineProperty(input, "files", {
    value: [new win.File([Buffer.from("x")], nombre, { type: "image/png" })],
    configurable: true
  });
  input.dispatchEvent(new win.Event("change"));
  for (let i = 0; i < 16; i++) await new Promise(r => setTimeout(r, 0));
}

async function abrir(doc) {
  $(doc, "vestAbrir").click();
  for (let i = 0; i < 4; i++) await new Promise(r => setTimeout(r, 0));
}

const CAPTURA = "Captura de pantalla 2026 09 15 113043.png";

// ==============================

describe("el taller se abre en el paso del personaje", () => {
  test("el carril trae los seis pasos y el primero es el activo", async () => {
    const { doc } = await montar();
    await abrir(doc);

    assert.strictEqual(doc.querySelectorAll(".taller-hito").length, 6);
    assert.strictEqual(pasoActual(doc), 1);
  });

  // El fallo que esto evita está escrito en js/arte.js: el desplegable
  // venía con el primer personaje por orden alfabético, así que quien
  // subía una prenda de Tora sin fijarse la archivaba en Cereza.
  test("los personajes se eligen con su nombre y su recuento", async () => {
    const { doc } = await montar();
    await abrir(doc);

    const tarjetas = [...doc.querySelectorAll(".taller-personaje")];
    assert.strictEqual(tarjetas.length, 2);
    assert.match(tarjetas[0].textContent, /Tora/);
    assert.match(tarjetas[0].textContent, /prendas/);
    assert.strictEqual(tarjetas[0].getAttribute("aria-pressed"), "true");
  });

  test("y la plantilla lleva la medida y el personaje en el nombre", async () => {
    const { doc } = await montar();
    await abrir(doc);

    assert.match($(doc, "tallerPlantillaLienzo").textContent, /lienzo-tora-327x504\.png/);
    assert.match($(doc, "tallerPlantillaGuia").textContent, /guia-tora\.png/);
  });

  test("el maniquí ya está montado desde el primer paso", async () => {
    const { doc } = await montar();
    await abrir(doc);
    assert.strictEqual(doc.querySelectorAll(".vest-capa").length, 15);
  });
});

describe("la puerta de cada paso", () => {
  test("sin traer nada no se puede pasar del paso 2", async () => {
    const { doc } = await montar();
    await abrir(doc);

    $(doc, "tallerSeguir").click();
    assert.strictEqual(pasoActual(doc), 2);
    assert.strictEqual($(doc, "tallerSeguir").disabled, true);
    assert.match($(doc, "tallerFalta").textContent, /al menos un PNG/);
  });

  test("con un PNG dentro, ya se puede", async () => {
    const { win, doc } = await montar();
    await abrir(doc);
    $(doc, "tallerSeguir").click();

    await traer(win, doc, "gorro_rojo.png", 327, 504);

    assert.strictEqual($(doc, "tallerSeguir").disabled, false);
  });

  // LA PUERTA QUE IMPORTA. Cinco de cinco prendas publicadas por el panel
  // llegaron con el lienzo equivocado; el paso 4 no deja pasar hasta
  // haber decidido qué hacer con cada una.
  test("una prenda descuadrada no deja pasar del paso 4", async () => {
    const { win, doc } = await montar();
    await abrir(doc);
    $(doc, "tallerSeguir").click();
    await traer(win, doc, CAPTURA, 1919, 1079);

    $(doc, "tallerSeguir").click();   // a fichar
    doc.querySelector(".taller-ficha").click();
    $(doc, "tallerSeguir").click();   // a colocar

    assert.strictEqual(pasoActual(doc), 4);
    assert.strictEqual($(doc, "tallerSeguir").disabled, true);
    assert.match($(doc, "tallerFalta").textContent, /sin decidir/);
  });

  test("y la abre llevarla al lienzo", async () => {
    const { win, doc } = await montar();
    await abrir(doc);
    $(doc, "tallerSeguir").click();
    await traer(win, doc, CAPTURA, 1919, 1079);
    $(doc, "tallerSeguir").click();
    doc.querySelector(".taller-ficha").click();
    $(doc, "tallerSeguir").click();

    assert.strictEqual($(doc, "vestAlLienzo").hidden, false);
    $(doc, "vestAlLienzo").click();

    assert.strictEqual($(doc, "tallerFalta").textContent, "");
    assert.strictEqual($(doc, "tallerSeguir").disabled, false);
  });

  // Se avisa, no se bloquea: subir una prenda descuadrada es una decisión
  // de producto que ya estaba tomada. Pero "tal cual" es un enlace
  // pequeño y "Llevar al lienzo" es el botón: la idea es que se use el
  // lienzo.
  test("también la abre decir tal cual, que es la salida pequeña", async () => {
    const { win, doc } = await montar();
    await abrir(doc);
    $(doc, "tallerSeguir").click();
    await traer(win, doc, CAPTURA, 1919, 1079);
    $(doc, "tallerSeguir").click();
    doc.querySelector(".taller-ficha").click();
    $(doc, "tallerSeguir").click();

    assert.strictEqual($(doc, "tallerTalCual").hidden, false);
    assert.ok($(doc, "tallerTalCual").classList.contains("taller-secundario"),
      "tal cual tiene que ser el secundario, no un botón igual de grande");
    assert.ok($(doc, "vestAlLienzo").classList.contains("taller-primario"));

    $(doc, "tallerTalCual").click();
    assert.strictEqual($(doc, "tallerSeguir").disabled, false);
  });

  test("no se puede saltar a un paso al que todavía no se llegó", async () => {
    const { doc } = await montar();
    await abrir(doc);

    const hitos = [...doc.querySelectorAll(".taller-hito")];
    assert.strictEqual(hitos[0].disabled, false);
    assert.strictEqual(hitos[5].disabled, true, "publicar no puede estar a un clic");
  });
});

describe("el nombre lo propone la herramienta, pero sólo cuando hace falta", () => {
  // "gorro_rojo.png" ya da "Gorro rojo", que es bueno: no se toca.
  test("un nombre de archivo que ya sirve se respeta", async () => {
    const { win, doc } = await montar();
    await abrir(doc);
    $(doc, "tallerSeguir").click();
    await traer(win, doc, "gorro_rojo.png", 327, 504);
    $(doc, "tallerSeguir").click();
    doc.querySelector(".taller-ficha").click();

    const nombre = doc.querySelector("#tallerFichas input[type=text]");
    assert.strictEqual(nombre.value, "Gorro rojo");
  });

  // Y "Captura de pantalla 2026 09 15 113043" no. Está publicado así en
  // producción: es lo que ve la gente en el editor de avatares.
  test("uno que no sirve se sustituye por el primero libre de su ranura", async () => {
    const { win, doc } = await montar();
    await abrir(doc);
    $(doc, "tallerSeguir").click();
    await traer(win, doc, CAPTURA, 1919, 1079);
    $(doc, "tallerSeguir").click();
    doc.querySelector(".taller-ficha").click();

    const nombre = doc.querySelector("#tallerFichas input[type=text]");
    assert.doesNotMatch(nombre.value, /Captura/);
    assert.match(nombre.value, /^\w+ \d+$/, "esperaba algo como «Fondo 1», llegó: " + nombre.value);
  });

  test("y sin nombre propio no se pasa de fichar", async () => {
    const { win, doc } = await montar();
    await abrir(doc);
    $(doc, "tallerSeguir").click();
    await traer(win, doc, "gorro_rojo.png", 327, 504);
    $(doc, "tallerSeguir").click();
    doc.querySelector(".taller-ficha").click();

    const nombre = doc.querySelector("#tallerFichas input[type=text]");
    nombre.value = "IMG_20260915";
    nombre.dispatchEvent(new win.Event("input", { bubbles: true }));

    assert.strictEqual($(doc, "tallerSeguir").disabled, true);
    assert.match($(doc, "tallerFalta").textContent, /sin fichar/);
  });
});

describe("el paso de traer enseña la medida antes que nada", () => {
  test("cuenta cuántas miden el lienzo y cuántas no", async () => {
    const { win, doc } = await montar();
    await abrir(doc);
    $(doc, "tallerSeguir").click();

    await traer(win, doc, "gorro_rojo.png", 327, 504);
    await traer(win, doc, CAPTURA, 1919, 1079);

    assert.match($(doc, "tallerMedidas").textContent, /2 archivo/);
    assert.match($(doc, "tallerMedidas").textContent, /1 miden el lienzo/);
  });

  // Un número en una línea no evitó cinco de cinco. Un rectángulo cinco
  // veces más ancho, dibujado a escala, sí se entiende.
  test("y dibuja el archivo contra el lienzo, a escala", async () => {
    const { win, doc } = await montar();
    await abrir(doc);
    $(doc, "tallerSeguir").click();
    await traer(win, doc, CAPTURA, 1919, 1079);

    const cajas = doc.querySelectorAll("#tallerComparar .taller-caja");
    assert.strictEqual(cajas.length, 2);

    const lienzo = cajas[0], archivo = cajas[1];
    assert.ok(parseFloat(archivo.style.width) > parseFloat(lienzo.style.width),
      "el archivo tiene que verse más ancho que el lienzo");
    assert.match($(doc, "tallerComparar").textContent, /veces más ancho/);
  });

  test("con todo bien no se dibuja ninguna comparación", async () => {
    const { win, doc } = await montar();
    await abrir(doc);
    $(doc, "tallerSeguir").click();
    await traer(win, doc, "gorro_rojo.png", 327, 504);

    assert.strictEqual(doc.querySelectorAll("#tallerComparar .taller-caja").length, 0);
  });
});

describe("los pasos de probar y publicar", () => {
  async function hastaElFinal(win, doc) {
    await abrir(doc);
    $(doc, "tallerSeguir").click();
    await traer(win, doc, "gorro_rojo.png", 327, 504);
    $(doc, "tallerSeguir").click();
    doc.querySelector(".taller-ficha").click();
    $(doc, "tallerSeguir").click();
    $(doc, "tallerSeguir").click();
  }

  test("probar pinta seis conjuntos con la prenda nueva puesta", async () => {
    const { win, doc } = await montar();
    await hastaElFinal(win, doc);

    assert.strictEqual(pasoActual(doc), 5);
    assert.strictEqual(doc.querySelectorAll(".taller-conjunto").length, 6);
  });

  test("y publicar resume qué nombre tendrá y cómo sube", async () => {
    const { win, doc } = await montar();
    await hastaElFinal(win, doc);
    $(doc, "tallerSeguir").click();

    assert.strictEqual(pasoActual(doc), 6);
    const linea = doc.querySelector(".taller-linea");
    assert.ok(linea, "tenía que haber una línea de resumen");
    assert.match(linea.textContent, /Gorro rojo/);
    assert.match(linea.textContent, /tal cual/, "un 327x504 sin tocar sube byte a byte");
  });

  test("una descuadrada llevada al lienzo se anuncia como horneada", async () => {
    const { win, doc } = await montar();
    await abrir(doc);
    $(doc, "tallerSeguir").click();
    await traer(win, doc, CAPTURA, 1919, 1079);
    $(doc, "tallerSeguir").click();
    doc.querySelector(".taller-ficha").click();
    $(doc, "tallerSeguir").click();
    $(doc, "vestAlLienzo").click();
    $(doc, "tallerSeguir").click();
    $(doc, "tallerSeguir").click();

    assert.match(doc.querySelector(".taller-linea").textContent, /horneada/);
  });
});

describe("el modo libre y el panel de siempre", () => {
  test("sólo vestir esconde el carril y la barra de pasos", async () => {
    const { doc } = await montar();
    $(doc, "tallerLibre").click();
    await new Promise(r => setTimeout(r, 0));

    assert.strictEqual($(doc, "tallerCarril").hidden, true);
    assert.strictEqual($(doc, "tallerNav").hidden, true);
    assert.strictEqual($(doc, "vestGuardarropa").hidden, false,
      "en modo libre el guardarropa tiene que estar a la vista");
  });

  test("y el formulario de siempre sigue en pie", async () => {
    const { doc } = await montar();
    assert.strictEqual($(doc, "arteSubir").hidden, false);
    assert.strictEqual($(doc, "arteCatalogo").hidden, false);
    assert.ok(doc.querySelectorAll("#arteGrid .arte-tarjeta").length >= 2);
  });

  test("nada de esto tira un error en la página", async () => {
    const { win, doc, rotos } = await montar();
    await abrir(doc);
    $(doc, "tallerSeguir").click();
    await traer(win, doc, CAPTURA, 1919, 1079);
    $(doc, "tallerSeguir").click();
    doc.querySelector(".taller-ficha").click();
    $(doc, "tallerSeguir").click();
    $(doc, "vestAlLienzo").click();
    $(doc, "tallerSeguir").click();
    $(doc, "tallerSeguir").click();

    assert.deepStrictEqual(rotos, []);
  });
});

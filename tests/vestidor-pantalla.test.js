// ==============================
// LA PANTALLA DEL VESTIDOR — tests/vestidor-pantalla.test.js
// ==============================
// Se carga arte.html de verdad en jsdom y se ejecutan los dos archivos
// tal cual están en el disco, en el mismo orden que los pide la página:
// primero js/arte-vestidor.js, después js/arte.js.
//
// Se prueba acá lo que no se puede probar en la aritmética: que el
// maniquí se arma una sola vez, que el guardarropa no se descarga entero,
// que una prenda publicada se pinta como la pinta el sitio, y que la
// sección se destapa y se cierra sin dejar el panel roto.
//
// js/core.js NO se evalúa: hace peticiones y monta dos observadores
// globales. De él solo se necesitan dos cosas, y se inyectan a mano.
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
const ARTE = fs.readFileSync(path.join(RAIZ, "js", "arte.js"), "utf8");

// Las 15 capas y el activador de imágenes perezosas viven en js/core.js.
// Se inyectan en vez de evaluar core.js entero, que pide el catálogo por
// red y monta un MutationObserver sobre todo el documento.
const DE_CORE = `
var ORDEN_CAPAS_AVATAR = ["fondo","espalda","modelo","piel","ojos","boca",
  "botas","pantalon","remera","guantes","accesorio","cara","pelo","mascota","borde"];
var _perezosasLlamadas = [];
function activarImagenesPerezosas(raiz) {
  _perezosasLlamadas.push(raiz);
  // El de verdad solo mueve data-src a src cuando la imagen se acerca a
  // la pantalla. Acá NO se mueve nada: así, si el vestidor emitiera src
  // directo, se vería en el espía.
}
`;

function panelDePrueba() {
  return {
    success: true,
    capas: ["fondo", "espalda", "piel", "ojos", "boca", "botas", "pantalon",
            "remera", "guantes", "accesorio", "cara", "pelo", "mascota", "borde"],
    modelos: [
      { id: 1, valor: "tora", modelo: "tora", capa: "modelo", nombre: "Tora", url: "/prendas/aaa.png", medidas: "327x504", peso: 1200, publicada: true, autor: null, precio: null },
      { id: 2, valor: "cereza", modelo: "cereza", capa: "modelo", nombre: "Cereza", url: "/prendas/bbb.png", medidas: "326x503", peso: 1200, publicada: true, autor: null, precio: null }
    ],
    prendas: [
      { id: 10, valor: "tora_botas1", modelo: "tora", capa: "botas", nombre: "Botas de combate", url: "/prendas/ccc.png", medidas: "327x504", peso: 8000, publicada: true, autor: "dibujante", precio: 140 },
      { id: 11, valor: "tora_pelo1", modelo: "tora", capa: "pelo", nombre: "Pelo largo", url: "/prendas/ddd.png", medidas: "327x504", peso: 9000, publicada: true, autor: "otra", precio: null },
      { id: 13, valor: "tora_pelo2", modelo: "tora", capa: "pelo", nombre: "<b>Pelo corto</b>", url: "/prendas/fff.png", medidas: "327x504", peso: 9000, publicada: true, autor: "otra", precio: null },
      // La descuadrada: se sube tal cual y el sitio la ENCAJA.
      { id: 12, valor: "cereza_boca9", modelo: "cereza", capa: "boca", nombre: "Boca recuperada", url: "/prendas/eee.png", medidas: "332x512", peso: 4000, publicada: false, autor: null, precio: null }
    ],
    esAdmin: true,
    yo: "dibujante"
  };
}

async function montar() {
  const consola = new VirtualConsole();
  consola.on("jsdomError", () => {});

  const dom = new JSDOM(HTML, {
    url: "https://macroreborn.com/arte.html",
    runScripts: "outside-only",
    virtualConsole: consola
  });

  const win = dom.window;

  // jsdom no maqueta, así que no tiene scrollIntoView.
  win.Element.prototype.scrollIntoView = function () {};
  win.alert = () => {};
  win.confirm = () => true;

  // El espía del setter de src. Es la red de verdad contra el fallo que
  // costó una sesión entera: una lista larga que emite src y se descarga
  // aunque no se vea. El invariante de texto de
  // tests/imagenes-perezosas.test.js no alcanza acá, porque el vestidor se
  // arma con createElement y no con plantillas.
  const puestos = [];
  const desc = Object.getOwnPropertyDescriptor(win.HTMLImageElement.prototype, "src");
  Object.defineProperty(win.HTMLImageElement.prototype, "src", {
    configurable: true,
    get() { return desc.get.call(this); },
    set(v) { puestos.push(v); desc.set.call(this, v); }
  });

  const llamadas = [];
  win.fetch = (url, opciones) => {
    llamadas.push({ url: String(url), opciones: opciones || {} });
    return Promise.resolve({
      ok: true, status: 200, json: () => Promise.resolve(panelDePrueba())
    });
  };

  win.eval(DE_CORE);
  win.eval(VESTIDOR);
  win.eval(ARTE);

  for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0));

  return { dom, win, doc: win.document, puestos, llamadas };
}

const $ = (doc, id) => doc.getElementById(id);

// ==============================

describe("la sección aparece con el rol, y nace cerrada", () => {
  test("se destapa junto a sus hermanas", async () => {
    const { doc } = await montar();
    assert.strictEqual($(doc, "arteVestidor").hidden, false);
  });

  test("pero el panel empieza cerrado: solo se ve el botón", async () => {
    const { doc } = await montar();
    assert.strictEqual($(doc, "vestPanel").hidden, true);
    assert.strictEqual($(doc, "vestAbrir").hidden, false);
  });

  test("y no se ha dibujado ni una capa todavía", async () => {
    const { doc } = await montar();
    assert.strictEqual(doc.querySelectorAll(".vest-capa").length, 0);
  });
});

describe("abrir y cerrar", () => {
  test("abrir esconde las hermanas y enseña el panel", async () => {
    const { doc } = await montar();

    $(doc, "vestAbrir").click();

    assert.strictEqual($(doc, "vestPanel").hidden, false);
    assert.strictEqual($(doc, "arteSubir").hidden, true);
    assert.strictEqual($(doc, "arteCatalogo").hidden, true);
  });

  // Esconder las hermanas no es cosmético: pintarLista() vacía y
  // reconstruye la lista de subida entera en cada cambio, y no queremos
  // que eso ocurra debajo del artista mientras coloca una prenda.
  test("cerrar las devuelve, y el panel vuelve a su sitio", async () => {
    const { doc } = await montar();

    $(doc, "vestAbrir").click();
    $(doc, "vestCerrar").click();

    assert.strictEqual($(doc, "vestPanel").hidden, true);
    assert.strictEqual($(doc, "arteSubir").hidden, false);
    assert.strictEqual($(doc, "arteCatalogo").hidden, false);
    assert.strictEqual($(doc, "vestAbrir").hidden, false);
  });

  test("y abrir dos veces no duplica las capas", async () => {
    const { doc } = await montar();

    $(doc, "vestAbrir").click();
    $(doc, "vestCerrar").click();
    $(doc, "vestAbrir").click();

    assert.strictEqual(doc.querySelectorAll(".vest-capa").length, 15);
  });
});

describe("el maniquí", () => {
  test("son las 15 capas de core.js, en su orden de dibujo", async () => {
    const { doc, win } = await montar();
    $(doc, "vestAbrir").click();

    const ranuras = [...doc.querySelectorAll("#vestLienzo .vest-capa")]
      .map(i => i.dataset.ranura);

    assert.deepStrictEqual(ranuras, [...win.ORDEN_CAPAS_AVATAR]);
  });

  // Si el lienzo llevara class="avatar-compuesto" o data-capas, el
  // MutationObserver de js/core.js lo detectaría, le vaciaría el innerHTML
  // y sustituiría las 15 capas por una foto plana -y cacheada- en el
  // primer frame. El artista vería su trabajo desaparecer.
  test("y NO se disfraza de avatar compuesto", async () => {
    const { doc } = await montar();
    $(doc, "vestAbrir").click();

    const lienzo = $(doc, "vestLienzo");
    assert.ok(!lienzo.classList.contains("avatar-compuesto"));
    assert.strictEqual(lienzo.getAttribute("data-capas"), null);
    assert.strictEqual(doc.querySelectorAll("#vestLienzo [data-capas]").length, 0);
  });

  test("el personaje se pinta solo, el resto empieza vacío", async () => {
    const { doc } = await montar();
    $(doc, "vestAbrir").click();

    const modelo = doc.querySelector('.vest-capa[data-ranura="modelo"]');
    assert.strictEqual(modelo.hidden, false);
    assert.match(modelo.getAttribute("src"), /aaa\.png$/);

    const botas = doc.querySelector('.vest-capa[data-ranura="botas"]');
    assert.strictEqual(botas.hidden, true);
  });

  test("y las capas se colocan con píxeles, no con porcentajes", async () => {
    const { doc } = await montar();
    $(doc, "vestAbrir").click();

    const modelo = doc.querySelector('.vest-capa[data-ranura="modelo"]');
    assert.strictEqual(modelo.style.left, "0px");
    assert.strictEqual(modelo.style.top, "0px");
    assert.strictEqual(modelo.style.width, "327px");
    assert.strictEqual(modelo.style.height, "504px");
  });
});

describe("el guardarropa", () => {
  test("no se pinta nada hasta que se abre una ranura", async () => {
    const { doc } = await montar();
    $(doc, "vestAbrir").click();

    assert.strictEqual(doc.querySelectorAll(".vest-opcion").length, 0);
    assert.strictEqual($(doc, "vestBuscar").hidden, true);
  });

  // EL FALLO QUE COSTÓ UNA SESIÓN ENTERA. El catálogo tiene 621 prendas;
  // pintarlas con src las descarga todas aunque no se vean.
  test("al abrir una ranura, ninguna miniatura pide su dibujo", async () => {
    const { doc, puestos } = await montar();
    $(doc, "vestAbrir").click();

    const antes = puestos.length;
    [...doc.querySelectorAll(".vest-ranura")].find(b => b.textContent === "Pelo").click();

    const opciones = [...doc.querySelectorAll(".vest-opcion img")];
    assert.ok(opciones.length >= 2, "debería haber pintado las dos de pelo");

    assert.strictEqual(puestos.length, antes,
      "alguna miniatura pidió su dibujo: " + puestos.slice(antes).join(", "));
    assert.strictEqual(opciones.filter(i => i.getAttribute("src")).length, 0);
    assert.strictEqual(opciones.filter(i => i.dataset.src).length, opciones.length);
  });

  test("y se le pide a mano a core.js que las vigile", async () => {
    const { doc, win } = await montar();
    $(doc, "vestAbrir").click();
    [...doc.querySelectorAll(".vest-ranura")].find(b => b.textContent === "Pelo").click();

    // A mano y no esperando al MutationObserver: su return sale de TODO el
    // lote de mutaciones, así que un .avatar-compuesto que entrara antes
    // en el mismo lote dejaría estas miniaturas en blanco para siempre.
    assert.strictEqual(win._perezosasLlamadas.length, 1);
    assert.strictEqual(win._perezosasLlamadas[0], $(doc, "vestRejilla"));
  });

  test("los nombres se pintan como texto, nunca como HTML", async () => {
    const { doc } = await montar();
    $(doc, "vestAbrir").click();
    [...doc.querySelectorAll(".vest-ranura")].find(b => b.textContent === "Pelo").click();

    const rejilla = $(doc, "vestRejilla");
    assert.ok(/&lt;b&gt;Pelo corto&lt;\/b&gt;/.test(rejilla.innerHTML),
      "el nombre tendría que estar escapado");
    assert.strictEqual(rejilla.querySelectorAll("b").length, 0);
  });

  test("elegir una prenda la pone en su capa", async () => {
    const { doc } = await montar();
    $(doc, "vestAbrir").click();
    [...doc.querySelectorAll(".vest-ranura")].find(b => b.textContent === "Pelo").click();

    doc.querySelector('.vest-opcion[data-valor="tora_pelo1"]').click();

    const pelo = doc.querySelector('.vest-capa[data-ranura="pelo"]');
    assert.strictEqual(pelo.hidden, false);
    assert.match(pelo.getAttribute("src"), /ddd\.png$/);
  });

  test("y la ranura del personaje se ve pero no se abre", async () => {
    const { doc } = await montar();
    $(doc, "vestAbrir").click();

    const modelo = [...doc.querySelectorAll(".vest-ranura")]
      .find(b => b.textContent === "Modelo");

    assert.ok(modelo, "la ranura del personaje tiene que verse");
    assert.strictEqual(modelo.disabled, true);
  });
});

describe("lo publicado se pinta como lo pinta el sitio", () => {
  // Requisito del encargo: el vestidor sirve para ver cómo convive lo
  // nuevo con lo que ya hay, así que el fondo de comparación tiene que
  // estar bien pintado. El editor de verdad usa object-fit: contain, y una
  // prenda publicada de 332x512 se ve ENCAJADA, no a tamaño real.
  test("una prenda publicada descuadrada se encaja, no se pega", async () => {
    const { doc } = await montar();
    $(doc, "vestAbrir").click();

    // Cereza, que es quien tiene la boca de 332x512, y retiradas incluidas.
    $(doc, "vestPersonaje").value = "cereza";
    $(doc, "vestPersonaje").dispatchEvent(new doc.defaultView.Event("change"));
    $(doc, "vestRetiradas").checked = true;
    $(doc, "vestRetiradas").dispatchEvent(new doc.defaultView.Event("change"));

    [...doc.querySelectorAll(".vest-ranura")].find(b => b.textContent === "Boca").click();
    doc.querySelector('.vest-opcion[data-valor="cereza_boca9"]').click();

    const boca = doc.querySelector('.vest-capa[data-ranura="boca"]');

    // contain de 332x512 en 327x504: k = 504/512 = 0,984375
    // ancho = 326,8125  alto = 504  x = 0,09375  y = 0
    assert.strictEqual(boca.style.height, "504px");
    assert.strictEqual(boca.style.width, "326.8125px");
    assert.strictEqual(boca.style.top, "0px");
    assert.strictEqual(boca.style.left, "0.09375px");
  });
});

describe("cambiar de personaje", () => {
  test("desnuda el maniquí, porque el guardarropa no se hereda", async () => {
    const { doc } = await montar();
    $(doc, "vestAbrir").click();
    [...doc.querySelectorAll(".vest-ranura")].find(b => b.textContent === "Pelo").click();
    doc.querySelector('.vest-opcion[data-valor="tora_pelo1"]').click();

    assert.strictEqual(doc.querySelector('.vest-capa[data-ranura="pelo"]').hidden, false);

    $(doc, "vestPersonaje").value = "cereza";
    $(doc, "vestPersonaje").dispatchEvent(new doc.defaultView.Event("change"));

    assert.strictEqual(doc.querySelector('.vest-capa[data-ranura="pelo"]').hidden, true);
    const modelo = doc.querySelector('.vest-capa[data-ranura="modelo"]');
    assert.match(modelo.getAttribute("src"), /bbb\.png$/);
  });

  test("y el personaje base de cereza también se encaja, que mide 326x503", async () => {
    const { doc } = await montar();
    $(doc, "vestAbrir").click();
    $(doc, "vestPersonaje").value = "cereza";
    $(doc, "vestPersonaje").dispatchEvent(new doc.defaultView.Event("change"));

    // contain de 326x503 en 327x504: manda el ALTO, no el ancho, porque
    // 504/503 = 1,001988 es menor que 327/326 = 1,003067. Así que el
    // dibujo llega justo arriba y abajo y le sobra un pelo a los lados.
    // Es el 0,2 % del que habla docs/DESARROLLO.md.
    //
    // Se compara con tolerancia y no con igualdad: 503 * (504/503) da
    // 503,99999999999994 en coma flotante. Da igual para un navegador,
    // pero pedir "504px" exacto convertiría esta prueba en un aviso sobre
    // aritmética de dobles en vez de sobre el encuadre.
    const modelo = doc.querySelector('.vest-capa[data-ranura="modelo"]');
    const px = v => parseFloat(v);

    assert.ok(Math.abs(px(modelo.style.height) - 504) < 1e-9, modelo.style.height);
    assert.ok(Math.abs(px(modelo.style.top)) < 1e-9, modelo.style.top);
    assert.ok(Math.abs(px(modelo.style.width) - 326 * 504 / 503) < 1e-9, modelo.style.width);
    assert.ok(Math.abs(px(modelo.style.left) - (327 - 326 * 504 / 503) / 2) < 1e-9,
      modelo.style.left);
  });
});

describe("vestir de una", () => {
  test("Lo básico pone piel, ojos, boca y pelo si las hay", async () => {
    const { doc } = await montar();
    $(doc, "vestAbrir").click();

    $(doc, "vestBasico").click();

    // En el catálogo de prueba tora solo tiene pelo, así que solo esa.
    assert.strictEqual(doc.querySelector('.vest-capa[data-ranura="pelo"]').hidden, false);
    assert.strictEqual(doc.querySelector('.vest-capa[data-ranura="botas"]').hidden, true);
  });

  test("Desnudar lo quita todo menos el personaje", async () => {
    const { doc } = await montar();
    $(doc, "vestAbrir").click();
    $(doc, "vestBasico").click();

    $(doc, "vestDesnudar").click();

    assert.strictEqual(doc.querySelector('.vest-capa[data-ranura="pelo"]').hidden, true);
    assert.strictEqual(doc.querySelector('.vest-capa[data-ranura="modelo"]').hidden, false);
  });
});

describe("el panel de siempre sigue funcionando", () => {
  test("subir y catálogo siguen destapados al cargar", async () => {
    const { doc } = await montar();
    assert.strictEqual($(doc, "arteSubir").hidden, false);
    assert.strictEqual($(doc, "arteCatalogo").hidden, false);
  });

  test("y el catálogo se pintó con sus tarjetas", async () => {
    const { doc } = await montar();
    assert.ok(doc.querySelectorAll("#arteGrid .arte-tarjeta").length >= 3);
  });
});

// ==============================
// EL AJUSTE
// ==============================
// Para probarlo hace falta una prenda LOCAL en la lista de subida, así que
// se entra por el mismo camino que usa el artista: el <input type=file> de
// "Subir prendas". jsdom trae FileReader y File, pero no decodifica
// imágenes, así que new Image() nunca dispararía onload; se sustituye por
// uno que contesta enseguida, igual que tests/arte-pagina.test.js.

function prepararEleccion(win, ancho, alto) {
  win.Image = class {
    set src(_) {
      this.naturalWidth = ancho;
      this.naturalHeight = alto;
      setTimeout(() => { if (this.onload) this.onload(); }, 0);
    }
  };
}

async function elegir(win, doc, nombres) {
  const input = $(doc, "arteArchivos");
  const archivos = nombres.map(n =>
    new win.File([Buffer.from("png-de-mentira")], n, { type: "image/png" }));

  Object.defineProperty(input, "files", { value: archivos, configurable: true });
  input.dispatchEvent(new win.Event("change"));

  for (let i = 0; i < 14; i++) await new Promise(r => setTimeout(r, 0));
}

// Monta la página, mete un PNG de la medida pedida, abre el vestidor y deja
// esa prenda elegida y puesta en el maniquí.
async function conPrenda(ancho, alto, nombre) {
  const m = await montar();
  prepararEleccion(m.win, ancho, alto);
  await elegir(m.win, m.doc, [nombre || "tora_accesorio.png"]);

  $(m.doc, "vestAbrir").click();
  m.doc.querySelector(".vest-prueba").click();

  return m;
}

function tecla(win, doc, key, extra) {
  doc.dispatchEvent(new win.KeyboardEvent("keydown",
    Object.assign({ key: key, bubbles: true }, extra || {})));
}

function puntero(win, lienzo, tipo, x, y) {
  const e = new win.PointerEvent(tipo, { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(e, "pointerId", { value: 7 });
  lienzo.dispatchEvent(e);
}

const CAPA = ".vest-capa[data-ranura=accesorio]";

// ==============================

describe("elegir una prenda para ajustarla", () => {
  test("el PNG elegido arriba aparece en el rail del vestidor", async () => {
    const { doc } = await conPrenda(327, 504);
    assert.strictEqual(doc.querySelectorAll(".vest-prueba").length, 1);
  });

  test("y al tocarla se enseñan sus números", async () => {
    const { doc } = await conPrenda(327, 504);

    assert.strictEqual($(doc, "vestAjusteCaja").hidden, false);
    assert.strictEqual($(doc, "vestDx").value, "0");
    assert.strictEqual($(doc, "vestEscala").value, "100");
    assert.match($(doc, "vestResumenAjuste").textContent, /sin ajuste/);
  });

  test("se pone sola en el maniquí: ajustar algo que no se ve no sirve", async () => {
    const { doc } = await conPrenda(327, 504);

    const capa = doc.querySelector(CAPA);
    assert.ok(capa, "el nombre del archivo la manda a accesorio");
    assert.strictEqual(capa.hidden, false);
  });
});

describe("mover con el teclado", () => {
  test("las flechas mueven de a un píxel", async () => {
    const { win, doc } = await conPrenda(327, 504);

    tecla(win, doc, "ArrowRight");
    tecla(win, doc, "ArrowRight");
    tecla(win, doc, "ArrowUp");

    assert.strictEqual($(doc, "vestDx").value, "2");
    assert.strictEqual($(doc, "vestDy").value, "-1");
  });

  test("y con mayúsculas, de a diez", async () => {
    const { win, doc } = await conPrenda(327, 504);

    tecla(win, doc, "ArrowRight", { shiftKey: true });

    assert.strictEqual($(doc, "vestDx").value, "10");
  });

  test("el movimiento llega al maniquí, en píxeles del lienzo", async () => {
    const { win, doc } = await conPrenda(327, 504);

    tecla(win, doc, "ArrowRight", { shiftKey: true });

    const capa = doc.querySelector(CAPA);
    assert.strictEqual(capa.style.left, "10px");
    assert.strictEqual(capa.style.width, "327px", "mover no cambia el tamaño");
  });

  test("la tecla E espeja", async () => {
    const { win, doc } = await conPrenda(327, 504);

    tecla(win, doc, "e");

    assert.strictEqual($(doc, "vestEspejo").checked, true);
    assert.strictEqual(doc.querySelector(CAPA).style.transform, "scaleX(-1)");
  });

  test("pero si se está escribiendo en un campo, el teclado es del campo", async () => {
    const { win, doc } = await conPrenda(327, 504);

    const campo = $(doc, "vestDx");
    campo.dispatchEvent(new win.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    assert.strictEqual($(doc, "vestDx").value, "0");
  });
});

describe("arrastrar", () => {
  test("mueve la prenda, y el número lo dice", async () => {
    const { win, doc } = await conPrenda(327, 504);
    const lienzo = $(doc, "vestLienzo");

    puntero(win, lienzo, "pointerdown", 100, 100);
    puntero(win, lienzo, "pointermove", 130, 88);
    puntero(win, lienzo, "pointerup", 130, 88);

    assert.strictEqual($(doc, "vestDx").value, "30");
    assert.strictEqual($(doc, "vestDy").value, "-12");
  });

  // Acumulando deltas redondeados en cada evento, un arrastre largo
  // deriva: veinte pasos de medio píxel se convierten en veinte píxeles en
  // vez de diez. Redondeando el delta TOTAL desde el pointerdown, no.
  test("y no deriva: se redondea el total, no cada paso", async () => {
    const { win, doc } = await conPrenda(327, 504);
    const lienzo = $(doc, "vestLienzo");

    puntero(win, lienzo, "pointerdown", 0, 0);
    for (let i = 1; i <= 20; i++) puntero(win, lienzo, "pointermove", i * 0.5, 0);
    puntero(win, lienzo, "pointerup", 10, 0);

    assert.strictEqual($(doc, "vestDx").value, "10");
  });

  test("un arrastre entero es UN solo paso de deshacer", async () => {
    const { win, doc } = await conPrenda(327, 504);
    const lienzo = $(doc, "vestLienzo");

    puntero(win, lienzo, "pointerdown", 0, 0);
    for (let i = 1; i <= 20; i++) puntero(win, lienzo, "pointermove", i, 0);
    puntero(win, lienzo, "pointerup", 20, 0);

    win.MacroVestidor.deshacer();

    assert.strictEqual($(doc, "vestDx").value, "0");
  });
});

describe("escalar", () => {
  test("no mueve el centro de la prenda", async () => {
    const { doc, win } = await conPrenda(327, 504);
    const capa = doc.querySelector(CAPA);

    const antes = parseFloat(capa.style.left) + parseFloat(capa.style.width) / 2;

    $(doc, "vestEscala").value = "150";
    $(doc, "vestEscala").dispatchEvent(new win.Event("input"));

    const despues = parseFloat(capa.style.left) + parseFloat(capa.style.width) / 2;

    assert.ok(Math.abs(antes - despues) < 1e-9,
      "el centro se movió de " + antes + " a " + despues);
    assert.strictEqual(capa.style.width, (327 * 1.5) + "px");
  });
});

describe("volver atrás", () => {
  test("volver a cero deja la prenda sin ajuste: se sube tal cual", async () => {
    const { win, doc } = await conPrenda(327, 504);

    tecla(win, doc, "ArrowRight");
    assert.match($(doc, "vestResumenAjuste").textContent, /1 px/);

    tecla(win, doc, "ArrowLeft");

    assert.match($(doc, "vestResumenAjuste").textContent, /sin ajuste/);
    assert.match($(doc, "vestInstruccion").textContent, /tal cual/);
  });

  test("deshacer y rehacer", async () => {
    const { win, doc } = await conPrenda(327, 504);

    tecla(win, doc, "ArrowRight", { shiftKey: true });
    tecla(win, doc, "ArrowDown", { shiftKey: true });
    assert.strictEqual($(doc, "vestDy").value, "10");

    win.MacroVestidor.deshacer();
    assert.strictEqual($(doc, "vestDy").value, "0");
    assert.strictEqual($(doc, "vestDx").value, "10");

    win.MacroVestidor.rehacer();
    assert.strictEqual($(doc, "vestDy").value, "10");
  });

  test("y Volver al original solo se ofrece cuando hay algo que volver", async () => {
    const { win, doc } = await conPrenda(327, 504);

    assert.strictEqual($(doc, "vestOriginal").hidden, true);
    tecla(win, doc, "ArrowRight");
    assert.strictEqual($(doc, "vestOriginal").hidden, false);
  });
});

describe("lo que se está ajustando se pinta PEGADO, no encajado", () => {
  // Las del catálogo se encajan, porque así las muestra el sitio. La que
  // se está ajustando se pega 1:1, porque así es como va a salir del
  // horno. Es la puerta única de vestEncuadreDeCapa, vista desde el DOM.
  test("un 327x505 sin tocar se encaja, y en cuanto se toca se pega", async () => {
    const { win, doc } = await conPrenda(327, 505);
    const capa = doc.querySelector(CAPA);

    // Sin ajuste: encajado. k = 504/505, así que no llena el ancho.
    assert.ok(Math.abs(parseFloat(capa.style.height) - 504) < 1e-9, capa.style.height);
    assert.ok(parseFloat(capa.style.width) < 327, capa.style.width);

    // Con ajuste: pegado. Su alto de verdad, 505, y el ancho entero.
    tecla(win, doc, "ArrowRight");

    assert.strictEqual(capa.style.width, "327px");
    assert.strictEqual(capa.style.height, "505px");
    assert.strictEqual(capa.style.left, "1px");
    assert.strictEqual(capa.style.top, "0px");
  });
});

describe("la línea que dice a dónde va a parar el dibujo", () => {
  test("aparece con el PRIMER ajuste, no al publicar", async () => {
    const { win, doc } = await conPrenda(327, 505);

    assert.match($(doc, "vestDestino").textContent, /se sube tal cual/);

    tecla(win, doc, "ArrowRight");

    const dice = $(doc, "vestDestino").textContent;
    assert.match(dice, /327×505/);
    assert.match(dice, /327×504/);
    assert.match(dice, /recorta 1 px por abajo/);
  });

  test("y para un 326x503 dice que rellena, no que recorta", async () => {
    const { win, doc } = await conPrenda(326, 503);

    tecla(win, doc, "ArrowRight");

    const dice = $(doc, "vestDestino").textContent;
    assert.match(dice, /rellena/);
    assert.doesNotMatch(dice, /recorta/);
  });
});

describe("los dos presets", () => {
  test("Llevar al lienzo no se ofrece si el PNG ya mide el lienzo", async () => {
    const { doc } = await conPrenda(327, 504);
    assert.strictEqual($(doc, "vestAlLienzo").hidden, true);
  });

  test("pero sí si no lo mide, y deja el ajuste en alLienzo sin mover nada", async () => {
    const { doc } = await conPrenda(327, 505);

    const boton = $(doc, "vestAlLienzo");
    assert.strictEqual(boton.hidden, false);

    boton.click();

    assert.strictEqual($(doc, "vestDx").value, "0");
    assert.strictEqual($(doc, "vestEscala").value, "100");
    assert.match($(doc, "vestResumenAjuste").textContent, /al lienzo/);
  });

  // 61 de los 64 dibujos descuadrados del catálogo se arreglan recortando o
  // rellenando una fila, que es exacto. Ofrecer "Encajar" ahí sería
  // ofrecer emborronar el dibujo para nada.
  test("Encajar NO se ofrece cuando encajar sería el 100 %", async () => {
    const { doc } = await conPrenda(327, 505);
    assert.strictEqual($(doc, "vestEncajar").hidden, true);
  });

  test("y sí para los bichos raros, diciendo que remuestrea", async () => {
    const { doc } = await conPrenda(654, 1010);

    const boton = $(doc, "vestEncajar");
    assert.strictEqual(boton.hidden, false);
    assert.match(boton.textContent, /50 %/);
    assert.match(boton.textContent, /remuestrea/);
  });
});

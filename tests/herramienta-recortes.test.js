// ==============================
// LA HERRAMIENTA DE RECORTES — tests/herramienta-recortes.test.js
// ==============================
// La pagina donde se revisa el cuadro automatico de cada previsualizacion
// y, si hace falta, se fuerza uno para toda una capa. Se carga la de
// verdad en jsdom, con el lienzo, las imagenes y el servidor de mentira,
// y se la maneja como lo haria alguien con el raton.
//
// Lo que hay que sujetar:
//
//   SIN FORZAR, CADA PRENDA ENSEÑA SU PROPIO CUADRO AUTOMATICO, el que
//   manda el servidor, y cambia al pasar de prenda.
//
//   AGRANDAR DESDE UNA ESQUINA DEJA FIJA LA CONTRARIA Y SIGUE CUADRADO.
//   Es la cuenta mas facil de equivocar: cuatro esquinas, cada una con su
//   signo. Un fallo aqui no se ve hasta que alguien arrastra justo esa.
//
//   EL CUADRO NUNCA SALE DEL LIENZO, arrastre lo que se arrastre.
//
//   LO QUE SE GUARDA ES SOLO LO FORZADO. Una capa que solo se miro, con
//   el automatico puesto, no puede colarse en el archivo como si alguien
//   lo hubiera elegido.
//
//   Y LA HERRAMIENTA NO EXISTE EN PRODUCCION. Tiene una ruta que escribe
//   un archivo del repositorio.
//
// Correr:  npm test

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { JSDOM } = require("jsdom");

// Una carpeta de referencias de mentira, para no depender de lo que haya
// en datos-locales/: esta fuera de git y se borra en cuanto se decidan
// los cuadros. Tiene que estar puesta ANTES de cargar servidor.js.
const REFERENCIAS_DE_PRUEBA = fs.mkdtempSync(path.join(os.tmpdir(), "mr-referencias-"));
process.env.MR_REFERENCIAS_MACROJUEGOS = REFERENCIAS_DE_PRUEBA;

const raiz = (...p) => path.join(__dirname, "..", ...p);
const HTML = fs.readFileSync(raiz("scripts", "herramientas", "recortes", "index.html"), "utf8");
const APP = fs.readFileSync(raiz("scripts", "herramientas", "recortes", "app.js"), "utf8");

const CAPAS = ["fondo", "espalda", "modelo", "piel", "ojos", "boca", "botas", "pantalon",
  "remera", "guantes", "accesorio", "cara", "pelo", "mascota", "borde"];

// `auto` es el cuadro automatico que mandaria el servidor. Aqui va fijo a
// mano, para que las cuentas de los arrastres se lean solas; la regla de
// verdad se prueba en tests/recortes.test.js.
const prenda = (valor, x, y, ancho, alto, auto) =>
  ({ valor, nombre: valor, url: "/p/" + valor + ".png", caja: { x, y, ancho, alto }, auto });

function datosDePrueba(config) {
  return {
    capas: CAPAS,
    modelos: ["cereza", "tora"],
    lienzo: { ancho: 327, alto: 504 },
    ladoMaximo: 327,
    ladoMinimo: 12,
    colorManiqui: { r: 172, g: 180, b: 204 },
    capasSolas: ["modelo", "fondo"],
    config: config || { ladoSalida: 96, maniqui: "plano", cuadros: {} },
    prendas: {
      cereza: { boca: [prenda("cereza_boca1", 150, 100, 30, 20, { x: 140, y: 90, lado: 50 })] },
      tora: {
        boca: [prenda("tora_boca1", 130, 120, 40, 20, { x: 110, y: 100, lado: 60 }),
               prenda("tora_boca2", 120, 110, 80, 60, { x: 100, y: 100, lado: 100 })],
        pelo: [prenda("tora_pelo1", 60, 10, 200, 150, { x: 50, y: 0, lado: 220 })]
      }
    },
    bases: { cereza: { valor: "cereza", url: "/p/cereza.png" }, tora: { valor: "tora", url: "/p/tora.png" } },
    referencias: { porCapa: {} }
  };
}

// Un contexto 2D que acepta cualquier llamada. jsdom no dibuja, y aqui
// no se prueba el dibujo sino las cuentas.
// Apunta en el propio lienzo cada llamada que recibe, para poder mirar
// despues QUE se dibujo: la prueba de la carrera lo necesita.
function contextoFalso(canvas) {
  canvas._llamadas = canvas._llamadas || [];
  return new Proxy({}, {
    get: (obj, k) => (k in obj ? obj[k] : (...args) => { canvas._llamadas.push([k, args]); }),
    set: (obj, k, v) => { obj[k] = v; return true; }
  });
}

// Monta la pagina. `innerHeight` 694 deja la escala exactamente en 1: un
// pixel de pantalla es un pixel del lienzo, y las cuentas se leen solas.
// `ajustar`, si viene, retoca los datos de prueba antes de servirlos.
async function montar(config, ajustar) {
  const guardados = [];
  const dom = new JSDOM(HTML, { runScripts: "outside-only", pretendToBeVisual: true, url: "http://127.0.0.1:3001/herramientas/recortes/" });
  const w = dom.window;
  Object.defineProperty(w, "innerHeight", { value: 694, configurable: true });
  w.devicePixelRatio = 1;
  w.HTMLCanvasElement.prototype.getContext = function () { return contextoFalso(this); };
  w.HTMLCanvasElement.prototype.setPointerCapture = () => {};
  w.HTMLCanvasElement.prototype.releasePointerCapture = () => {};
  w.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 327, height: 504 });
  // Las imagenes cargan al instante, salvo las que se retrasen a
  // proposito: no hay red en jsdom.
  const retrasos = {};
  w.Image = class {
    set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), retrasos[v] || 0); }
    get src() { return this._src; }
  };
  w.fetch = async (url, opciones) => {
    if (String(url).endsWith("/api/datos")) {
      const datos = datosDePrueba(config);
      if (ajustar) ajustar(datos);
      return { ok: true, status: 200, json: async () => datos };
    }
    if (String(url).endsWith("/api/guardar")) {
      guardados.push(JSON.parse(opciones.body));
      return { ok: true, status: 200, json: async () => ({ ok: true, archivo: "api/recortes-previsualizacion.json" }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  w.eval(APP);
  await esperarA(w, () => w.document.body.dataset.lista === "si", "que la pagina arranque");
  await quieta(w);
  return { w, doc: w.document, guardados, retrasos };
}

// Esperar a que PASE algo, no un tiempo fijo. Con un tiempo fijo estas
// pruebas fallaban una de cada dos veces con la suite entera corriendo
// en paralelo: la pagina no terminaba de arrancar en 30 ms.
async function esperarA(w, condicion, que) {
  const limite = Date.now() + 5000;
  while (!condicion()) {
    if (Date.now() > limite) throw new Error("No llego a pasar: " + que);
    await new Promise(r => w.setTimeout(r, 5));
  }
}

const esperar = w => new Promise(r => w.setTimeout(r, 5));

// Esperar a que la pagina termine lo que este cargando. La propia pagina
// lo publica en data-ocupada.
const quieta = w => esperarA(w, () => w.document.body.dataset.ocupada !== "si", "que la pagina termine de cargar");

function cuadro(doc) {
  return {
    x: Number(doc.getElementById("numX").value),
    y: Number(doc.getElementById("numY").value),
    lado: Number(doc.getElementById("numLado").value)
  };
}

// Un arrastre con el raton, de un punto a otro, sobre el lienzo.
async function arrastrar(w, desde, hasta) {
  const lienzo = w.document.getElementById("lienzo");
  const ev = (tipo, [x, y]) => new w.MouseEvent(tipo, { clientX: x, clientY: y, bubbles: true });
  lienzo.dispatchEvent(ev("pointerdown", desde));
  lienzo.dispatchEvent(ev("pointermove", hasta));
  lienzo.dispatchEvent(ev("pointerup", hasta));
  await esperar(w);
}

async function elegirCapa(w, nombre) {
  const boton = () => [...w.document.querySelectorAll("#listaCapas button")].find(x => x.textContent.includes(nombre));
  await esperarA(w, () => boton() && !boton().disabled, "el boton de la capa " + nombre);
  boton().click();
  await quieta(w);
  assert.ok(w.document.getElementById("tituloLienzo").textContent.endsWith(nombre), "no se abrio la capa " + nombre);
}

async function elegirModelo(w, nombre) {
  const boton = () => [...w.document.querySelectorAll("#modelos button")].find(x => x.textContent.startsWith(nombre));
  await esperarA(w, () => boton(), "el boton del modelo " + nombre);
  boton().click();
  await quieta(w);
  assert.ok(w.document.getElementById("tituloLienzo").textContent.startsWith(nombre), "no se abrio el modelo " + nombre);
}

async function pulsarGuardar(w, guardados) {
  const antes = guardados.length;
  w.document.getElementById("botonGuardar").click();
  await esperarA(w, () => guardados.length > antes, "que llegue el guardado");
}

describe("al abrir", () => {

  test("arranca en el primer modelo, en su primera capa, con el automatico de su primera prenda", async () => {
    const { doc } = await montar();
    assert.match(doc.getElementById("tituloLienzo").textContent, /cereza · boca/);
    assert.deepStrictEqual(cuadro(doc), { x: 140, y: 90, lado: 50 });
    assert.equal(doc.getElementById("avisoAutomatico").hidden, false,
      "no avisa de que lo que se ve es el automatico");
  });

  test("lo que ya estaba guardado vuelve como forzado", async () => {
    const { w, doc } = await montar({ ladoSalida: 96, maniqui: "plano",
      cuadros: { tora: { boca: { x: 11, y: 22, lado: 88 } } } });
    await elegirModelo(w, "tora");
    await elegirCapa(w, "boca");
    assert.deepStrictEqual(cuadro(doc), { x: 11, y: 22, lado: 88 });
    assert.equal(doc.getElementById("avisoAutomatico").hidden, true);
  });

});

describe("el automatico, prenda por prenda", () => {

  test("sin forzar, cada prenda enseña su propio cuadro", async () => {
    const { w, doc } = await montar();
    await elegirModelo(w, "tora");                          // tora · boca, en tora_boca1
    assert.deepStrictEqual(cuadro(doc), { x: 110, y: 100, lado: 60 });
    doc.getElementById("botonSiguiente").click();
    await quieta(w);
    assert.deepStrictEqual(cuadro(doc), { x: 100, y: 100, lado: 100 },
      "al pasar de prenda no cambio al cuadro de la nueva");
    assert.match(doc.getElementById("seSalen").textContent, /Automático/);
  });

  test("forzado para la capa, el cuadro ya no cambia al pasar de prenda", async () => {
    const { w, doc } = await montar();
    await elegirModelo(w, "tora");
    await arrastrar(w, [140, 130], [150, 140]);            // mueve el de tora_boca1 y lo fuerza
    assert.deepStrictEqual(cuadro(doc), { x: 120, y: 110, lado: 60 });
    doc.getElementById("botonSiguiente").click();
    await quieta(w);
    assert.deepStrictEqual(cuadro(doc), { x: 120, y: 110, lado: 60 },
      "lo forzado para la capa no le sirvio a la siguiente prenda");
    assert.equal(doc.getElementById("avisoAutomatico").hidden, true);
  });

  test("Volver al automatico quita lo forzado y no queda nada que guardar", async () => {
    const { w, doc } = await montar();
    await arrastrar(w, [160, 110], [170, 120]);            // fuerza cereza · boca
    assert.equal(doc.getElementById("botonGuardar").disabled, false);
    doc.getElementById("botonQuitar").click();
    await esperar(w);
    assert.deepStrictEqual(cuadro(doc), { x: 140, y: 90, lado: 50 });
    assert.equal(doc.getElementById("avisoAutomatico").hidden, false);
    assert.equal(doc.getElementById("botonGuardar").disabled, true,
      "tras volver al automatico sigue habiendo algo que guardar");
  });

});

describe("mover y agrandar", () => {

  test("arrastrar desde dentro lo mueve sin cambiar el tamaño", async () => {
    const { w, doc } = await montar();
    await arrastrar(w, [160, 110], [180, 140]);          // cereza/boca empieza en 140,90 lado 50
    assert.deepStrictEqual(cuadro(doc), { x: 160, y: 120, lado: 50 });
  });

  test("desde la esquina de abajo a la derecha: la de arriba a la izquierda no se mueve", async () => {
    const { w, doc } = await montar();
    await arrastrar(w, [190, 140], [230, 150]);          // esquina se: 140+50, 90+50
    const c = cuadro(doc);
    assert.equal(c.x, 140); assert.equal(c.y, 90);
    assert.equal(c.lado, 90, "manda el mayor desplazamiento y sale cuadrado");
  });

  test("desde la de arriba a la izquierda: la de abajo a la derecha no se mueve", async () => {
    const { w, doc } = await montar();
    await arrastrar(w, [140, 90], [120, 80]);             // esquina nw
    const c = cuadro(doc);
    assert.equal(c.x + c.lado, 190, "se movio la esquina que tenia que quedarse");
    assert.equal(c.y + c.lado, 140);
    assert.equal(c.lado, 70);
  });

  test("desde la de arriba a la derecha: la de abajo a la izquierda no se mueve", async () => {
    const { w, doc } = await montar();
    await arrastrar(w, [190, 90], [210, 70]);             // esquina ne
    const c = cuadro(doc);
    assert.equal(c.x, 140);
    assert.equal(c.y + c.lado, 140);
    assert.equal(c.lado, 70);
  });

  test("desde la de abajo a la izquierda: la de arriba a la derecha no se mueve", async () => {
    const { w, doc } = await montar();
    await arrastrar(w, [140, 140], [110, 150]);           // esquina sw
    const c = cuadro(doc);
    assert.equal(c.x + c.lado, 190);
    assert.equal(c.y, 90);
    assert.equal(c.lado, 80);
  });

  test("nunca sale del lienzo, ni moviendo ni agrandando", async () => {
    const { w, doc } = await montar();
    await arrastrar(w, [160, 110], [900, 900]);            // lo tira fuera por abajo a la derecha
    let c = cuadro(doc);
    assert.ok(c.x + c.lado <= 327 && c.y + c.lado <= 504, "se salio moviendo: " + JSON.stringify(c));

    await arrastrar(w, [c.x, c.y], [-500, -500]);           // agranda desde nw hacia fuera
    c = cuadro(doc);
    assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.lado <= 327 && c.y + c.lado <= 504,
      "se salio agrandando: " + JSON.stringify(c));
    assert.ok(c.lado <= 327, "mas grande que el lienzo");
  });

  test("ni se encoge por debajo del minimo", async () => {
    const { w, doc } = await montar();
    await arrastrar(w, [190, 140], [140, 90]);             // aplasta la esquina se contra la nw
    assert.ok(cuadro(doc).lado >= 12);
  });

  test("las flechas mueven un pixel, y con mayusculas diez", async () => {
    const { w, doc } = await montar();
    const lienzo = doc.getElementById("lienzo");
    lienzo.dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    lienzo.dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: true, bubbles: true }));
    await esperar(w);
    assert.deepStrictEqual(cuadro(doc), { x: 141, y: 100, lado: 50 });
  });

});

describe("guardar", () => {

  test("sin tocar nada, no hay nada que guardar", async () => {
    const { doc } = await montar();
    assert.equal(doc.getElementById("botonGuardar").disabled, true);
  });

  test("una capa que solo se miro NO se guarda como forzada", async () => {
    // Lo que no esta en el archivo es automatico. Si el automatico se
    // colara en el archivo, pareceria que alguien lo eligio, y dejaria de
    // seguir a la prenda si su dibujo cambia.
    const { w, doc, guardados } = await montar();
    await arrastrar(w, [160, 110], [170, 120]);             // fuerza cereza/boca
    await elegirModelo(w, "tora");                           // mira tora/boca sin tocarla
    await pulsarGuardar(w, guardados);

    assert.equal(guardados.length, 1);
    assert.deepStrictEqual(Object.keys(guardados[0].cuadros), ["cereza"],
      "se colo una capa que nadie forzo");
    assert.deepStrictEqual(guardados[0].cuadros.cereza.boca, { x: 150, y: 100, lado: 50 });
  });

  test("Usar para toda la capa fuerza el cuadro que se ve", async () => {
    const { w, doc, guardados } = await montar();
    doc.getElementById("botonAceptar").click();
    await esperar(w);
    await pulsarGuardar(w, guardados);
    assert.deepStrictEqual(guardados[0].cuadros.cereza.boca, { x: 140, y: 90, lado: 50 });
  });

  test("lleva el maniqui elegido", async () => {
    const { w, doc, guardados } = await montar();
    doc.querySelector('[data-maniqui="color"]').click();
    await quieta(w);
    await pulsarGuardar(w, guardados);
    assert.equal(guardados[0].maniqui, "color");
  });

  test("copiar a los demas modelos solo llega a los que tienen esa capa", async () => {
    const { w, doc, guardados } = await montar();
    await elegirModelo(w, "tora");
    await elegirCapa(w, "pelo");                              // cereza no tiene pelo
    doc.getElementById("botonCopiar").click();
    await esperar(w);
    await pulsarGuardar(w, guardados);
    assert.ok(guardados[0].cuadros.tora.pelo, "no guardo la del propio modelo");
    assert.ok(!(guardados[0].cuadros.cereza && guardados[0].cuadros.cereza.pelo),
      "copio a un modelo que no tiene esa capa");
  });

  test("despues de guardar, el boton vuelve a apagarse", async () => {
    const { w, doc, guardados } = await montar();
    await arrastrar(w, [160, 110], [170, 120]);
    assert.equal(doc.getElementById("botonGuardar").disabled, false);
    await pulsarGuardar(w, guardados);
    // Se apaga cuando la pagina termina de procesar la respuesta, que es
    // un poco despues de que el guardado llegue: se espera a eso.
    await esperarA(w, () => /Guardado a las/.test(doc.getElementById("estadoGuardado").textContent),
      "que termine de guardar");
    assert.equal(doc.getElementById("botonGuardar").disabled, true);
  });

});

describe("cambiar deprisa", () => {

  // La prenda puesta que se dibujo por ultima vez en el lienzo grande,
  // leida de lo que apunto el contexto falso: el ultimo drawImage de un
  // lienzo intermedio, y dentro de ese, las imagenes que se pintaron.
  function prendasDibujadas(doc) {
    const principal = doc.getElementById("lienzo");
    const dibujos = (principal._llamadas || []).filter(([k, a]) => k === "drawImage" && a[0] && a[0]._llamadas);
    const ultimo = dibujos[dibujos.length - 1];
    if (!ultimo) return [];
    return ultimo[1][0]._llamadas
      .filter(([k, a]) => k === "drawImage" && a[0] && a[0]._src)
      .map(([, a]) => a[0]._src);
  }

  test("si una prenda tarda en cargar, no pisa a la que se eligio despues", async () => {
    // El caso: se pasa a la siguiente prenda, que tarda, y enseguida se
    // vuelve a la anterior, que ya estaba cargada. La lenta termina la
    // ultima. Sin el turno de api/app.js, pisaba a la buena y se veia la
    // prenda equivocada con el contador diciendo otra cosa.
    const { w, doc, retrasos } = await montar();
    await elegirModelo(w, "tora");                        // abre tora/boca con tora_boca1
    retrasos["/p/tora_boca2.png"] = 120;

    doc.getElementById("botonSiguiente").click();          // a tora_boca2, la lenta
    doc.getElementById("botonAnterior").click();           // y de vuelta a tora_boca1

    await new Promise(r => w.setTimeout(r, 250));          // que termine tambien la lenta
    assert.equal(doc.getElementById("contadorPrenda").textContent, "1 de 2");
    const pintadas = prendasDibujadas(doc);
    assert.ok(pintadas.includes("/p/tora_boca1.png"),
      "no se ve la prenda elegida: " + JSON.stringify(pintadas));
    assert.ok(!pintadas.includes("/p/tora_boca2.png"),
      "la prenda que llego tarde piso a la elegida");
  });

});

describe("lo que se pinta debajo de la prenda", () => {

  // Lo que se dibujo en la ultima prenda puesta: las imagenes por su
  // direccion, y la silueta del maniqui, que es un lienzo, como "silueta".
  function loDibujado(doc) {
    const principal = doc.getElementById("lienzo");
    const puestas = (principal._llamadas || []).filter(([k, a]) => k === "drawImage" && a[0] && a[0]._llamadas);
    const ultima = puestas[puestas.length - 1];
    if (!ultima) return [];
    return ultima[1][0]._llamadas
      .filter(([k]) => k === "drawImage")
      .map(([, a]) => a[0]._src || "silueta");
  }

  const conFondo = d => { d.prendas.cereza.fondo = [prenda("cereza_fondo1", 0, 0, 327, 504)]; };

  test("el fondo se ve solo, sin el cuerpo, con cualquier maniqui", async () => {
    // Decidido el 23/09/2026. Y tiene que coincidir con "la de verdad",
    // que lo dibuja api/_previsualizacion.js con la misma lista.
    const { w, doc } = await montar(null, conFondo);
    await elegirCapa(w, "fondo");
    assert.deepStrictEqual(loDibujado(doc), ["/p/cereza_fondo1.png"], "se dibujo el cuerpo con el fondo");
    doc.querySelector('[data-maniqui="color"]').click();
    await quieta(w);
    assert.deepStrictEqual(loDibujado(doc), ["/p/cereza_fondo1.png"], "con el maniqui a color volvio el cuerpo");
  });

  test("y cualquier otra prenda, puesta sobre el maniqui", async () => {
    const { w, doc } = await montar(null, conFondo);
    await elegirCapa(w, "boca");
    assert.deepStrictEqual(loDibujado(doc), ["silueta", "/p/cereza_boca1.png"]);
  });

});

describe("el aviso de las que no caben", () => {

  test("en automatico dice que cada una tiene el suyo; forzado, cuantas asoman", async () => {
    const { w, doc } = await montar();
    await elegirModelo(w, "tora");
    await elegirCapa(w, "boca");
    // Las dos bocas caben enteras en su propio cuadro automatico.
    assert.match(doc.getElementById("seSalen").textContent, /cada prenda tiene su propio cuadro$/);
    const lienzo = doc.getElementById("lienzo");
    for (let i = 0; i < 30; i++) {                           // encogerlo lo fuerza para la capa
      lienzo.dispatchEvent(new w.KeyboardEvent("keydown", { key: "-", bubbles: true }));
    }
    await esperar(w);
    assert.match(doc.getElementById("seSalen").textContent, /2 de 2 prendas asoman fuera/);
  });

  test("en automatico cuenta las que no caben enteras ni en el suyo", async () => {
    // Un pelo mas alto que el lienzo: su cuadro automatico enseña la parte
    // de arriba, y el aviso lo dice.
    const { w, doc } = await montar(null, d => {
      d.prendas.tora.pelo.push(prenda("tora_melena", 40, 10, 240, 480, { x: 0, y: 0, lado: 327 }));
    });
    await elegirModelo(w, "tora");
    await elegirCapa(w, "pelo");
    assert.match(doc.getElementById("seSalen").textContent, /1 no caben enteras y se ven desde arriba/);
  });

});

describe("las referencias de macrojuegos, en la pagina", () => {

  const srcs = doc => [...doc.querySelectorAll("#referencias img")].map(i => i.getAttribute("src"));
  const nota = doc => doc.getElementById("notaReferencias").textContent;

  test("salen junto a la nuestra y a su mismo tamaño, sin tener que bajar", async () => {
    const { doc } = await montar(null, d => {
      d.referencias = { porCapa: { boca: ["/r/boca1.jpg", "/r/boca2.jpg"] } };
    });
    assert.deepStrictEqual(srcs(doc), ["/r/boca1.jpg", "/r/boca2.jpg"]);
    for (const img of doc.querySelectorAll("#referencias img")) {
      assert.equal(img.getAttribute("width"), "96", "no salen al tamaño de la nuestra");
      assert.equal(img.getAttribute("height"), "96");
    }
    assert.ok(doc.getElementById("vistaReal").closest("section").contains(doc.getElementById("referencias")),
      "no estan junto a la vista previa");
    assert.match(nota(doc), /macrojuegos \(2\)/);
  });

  test("en una capa sin las suyas, una de cada tipo y con su nombre", async () => {
    const { w, doc } = await montar(null, d => {
      d.referencias = {
        porCapa: { boca: ["/r/boca1.jpg"] },
        muestras: [
          { capa: "remera", nombre: "Camisa", url: "/r/camisa.jpg" },
          { capa: "piel", nombre: "Piel", url: "/r/piel.jpg" }
        ]
      };
    });
    await elegirModelo(w, "tora");
    await elegirCapa(w, "pelo");                        // del pelo no hay ninguna
    assert.deepStrictEqual(srcs(doc), ["/r/camisa.jpg", "/r/piel.jpg"]);
    assert.deepStrictEqual([...doc.querySelectorAll("#referencias figcaption")].map(c => c.textContent),
      ["Camisa", "Piel"], "no dice de que tipo es cada una");
    assert.match(nota(doc), /no quedó ninguna/);
  });

  test("en la capa modelo, las cabezas de sus modelos, la del abierto primero", async () => {
    const { w, doc } = await montar(null, d => {
      d.prendas.tora.modelo = [prenda("tora", 20, 20, 280, 480)];
      d.referencias = {
        porCapa: { modelo: ["/r/modelos/cereza.jpg", "/r/modelos/tora.jpg"] },
        muestras: [{ capa: "remera", nombre: "Camisa", url: "/r/camisa.jpg" }]
      };
    });
    await elegirModelo(w, "tora");
    await elegirCapa(w, "modelo");
    assert.deepStrictEqual(srcs(doc), ["/r/modelos/tora.jpg", "/r/modelos/cereza.jpg"],
      "la cabeza del modelo abierto no sale la primera");
    assert.deepStrictEqual([...doc.querySelectorAll("#referencias figcaption")].map(c => c.textContent),
      ["tora", "cereza"]);
    assert.match(nota(doc), /solo la cabeza/);
  });

  test("sin ninguna referencia en el equipo, lo dice y no se rompe", async () => {
    const { doc } = await montar();                     // referencias vacias
    assert.deepStrictEqual(srcs(doc), []);
    assert.match(nota(doc), /No hay referencias/);
  });

});

describe("las referencias de macrojuegos, en el servidor", () => {

  const servidor = () => require("../scripts/herramientas/recortes/servidor");
  const P = "/herramientas/recortes/referencia/";

  function carpetaDeReferencias(archivos) {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), "mr-referencias-"));
    for (const ruta of archivos) {
      fs.mkdirSync(path.dirname(path.join(r, ruta)), { recursive: true });
      fs.writeFileSync(path.join(r, ruta), "jpg");
    }
    return r;
  }

  // Pedirle una ruta a la herramienta, como lo haria el navegador.
  async function pedir(ruta, ip = "127.0.0.1") {
    const res = {
      codigo: 0, cabeceras: {}, cuerpo: null,
      writeHead(c, h) { this.codigo = c; this.cabeceras = h || {}; },
      end(d) { this.cuerpo = d == null ? null : d; }
    };
    await servidor().atender({ method: "GET", socket: { remoteAddress: ip } }, res,
      new URL("http://127.0.0.1:3001" + ruta), null);
    return res;
  }

  test("se agrupan por nuestra capa, de las dos carpetas", () => {
    const r = carpetaDeReferencias([
      "prendas/12_120500060076.jpg",        // 05: una camisa
      "prendas/12_120900080009.jpg",        // 09: la barba, que vale para cara y boca
      "prendas/5_50800030297.jpg",          // 08: un pelo, de otro modelo
      "prendas-por-id/remera_10413.jpg",    // sin tipo en el numero: la capa, delante
      "prendas-por-id/piel_10879.jpg",
      "prendas-por-id/inventada_1.jpg",     // una capa que no existe: fuera
      "prendas/notas.txt",                  // no es una referencia: fuera
      "modelos/tora.jpg",                   // las cabezas van a la capa modelo
      "modelos/fengchao.jpg",
      "modelos/Tora.jpg"                    // nombre que no cumple el patron: fuera
    ]);
    const { porCapa, muestras } = servidor().referencias(r);
    assert.deepStrictEqual(porCapa, {
      remera: [P + "prendas/12_120500060076.jpg", P + "prendas-por-id/remera_10413.jpg"],
      cara: [P + "prendas/12_120900080009.jpg"],
      boca: [P + "prendas/12_120900080009.jpg"],
      pelo: [P + "prendas/5_50800030297.jpg"],
      piel: [P + "prendas-por-id/piel_10879.jpg"],
      modelo: [P + "modelos/fengchao.jpg", P + "modelos/tora.jpg"]
    });
    // Una por tipo, en orden fijo, y solo de los tipos que hay: aqui no hay
    // pantalones ni zapatos.
    assert.deepStrictEqual(muestras, [
      { capa: "remera", nombre: "Camisa", url: P + "prendas/12_120500060076.jpg" },
      { capa: "pelo", nombre: "Pelo", url: P + "prendas/5_50800030297.jpg" },
      { capa: "cara", nombre: "Barba", url: P + "prendas/12_120900080009.jpg" },
      { capa: "piel", nombre: "Piel", url: P + "prendas-por-id/piel_10879.jpg" }
    ]);
  });

  test("sin la carpeta no hay ninguna, y no se rompe", () => {
    const noEsta = path.join(os.tmpdir(), "mr-no-existe-" + process.pid + "-" + Date.now());
    assert.deepStrictEqual(servidor().referencias(noEsta), { porCapa: {}, muestras: [] });
  });

  test("sirve la imagen que existe", async () => {
    fs.mkdirSync(path.join(REFERENCIAS_DE_PRUEBA, "prendas"), { recursive: true });
    fs.writeFileSync(path.join(REFERENCIAS_DE_PRUEBA, "prendas", "12_120500060076.jpg"), "bytes-de-prueba");
    const r = await pedir(P + "prendas/12_120500060076.jpg");
    assert.equal(r.codigo, 200);
    assert.equal(r.cabeceras["Content-Type"], "image/jpeg");
    assert.equal(String(r.cuerpo), "bytes-de-prueba");
  });

  test("y nada fuera de sus carpetas ni de sus nombres", async () => {
    // El nombre llega en la URL: cualquier cosa que no sea exactamente un
    // nombre de referencia no llega a tocar el disco. Estos dos EXISTEN, y
    // aun asi no se sirven: si alguien quita la comprobacion, se nota.
    fs.mkdirSync(path.join(REFERENCIAS_DE_PRUEBA, "prendas-por-id"), { recursive: true });
    fs.mkdirSync(path.join(REFERENCIAS_DE_PRUEBA, "modelos"), { recursive: true });
    fs.writeFileSync(path.join(REFERENCIAS_DE_PRUEBA, "prendas", "secreto.jpg"), "no");
    fs.writeFileSync(path.join(REFERENCIAS_DE_PRUEBA, "prendas-por-id", "REMERA_1.jpg"), "no");
    fs.writeFileSync(path.join(REFERENCIAS_DE_PRUEBA, "modelos", "Tora.jpg"), "no");
    for (const ruta of [
      P + "prendas/secreto.jpg",
      P + "modelos/Tora.jpg",
      P + "prendas/..%2F..%2F..%2Fserver.js",
      P + "prendas/..%5C..%5Cserver.js",
      P + "prendas-por-id/REMERA_1.jpg",
      P + "constructor/12_1.jpg",
      P + "secretos/12_1.jpg",
      P + "prendas/99_990500000000.jpg"     // bien formado, pero no existe
    ]) {
      assert.equal((await pedir(ruta)).codigo, 404, ruta);
    }
  });

  test("y tampoco responde fuera de la propia maquina", async () => {
    assert.equal((await pedir(P + "prendas/12_120500060076.jpg", "192.168.1.20")).codigo, 403);
  });

});

describe("solo en local", () => {

  test("server.js no carga la herramienta", () => {
    // Hay una ruta que escribe un archivo del repositorio. En produccion,
    // eso seria un agujero.
    const servidor = fs.readFileSync(raiz("server.js"), "utf8");
    assert.ok(!/herramientas/.test(servidor), "server.js menciona la herramienta");
  });

  test("y la carpeta scripts/ esta cerrada en produccion", () => {
    const servidor = fs.readFileSync(raiz("server.js"), "utf8");
    assert.match(servidor, /"scripts"/, "server.js dejo de cerrar scripts/");
    const nginx = fs.readFileSync(raiz("infra", "nginx", "macroreborn.conf"), "utf8");
    assert.match(nginx, /\(migrations\|scripts\|tests/, "nginx dejo de cerrar scripts/");
  });

  test("y solo responde desde la propia maquina", () => {
    const { esLocal } = require("../scripts/herramientas/recortes/servidor");
    for (const ip of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      assert.equal(esLocal({ socket: { remoteAddress: ip } }), true, ip);
    }
    for (const ip of ["192.168.1.20", "10.0.0.5", "::ffff:192.168.1.20", "", undefined]) {
      assert.equal(esLocal({ socket: { remoteAddress: ip } }), false, "dejo pasar " + ip);
    }
  });

});

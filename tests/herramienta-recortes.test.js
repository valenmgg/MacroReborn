// ==============================
// LA HERRAMIENTA DE RECORTES — tests/herramienta-recortes.test.js
// ==============================
// La pagina donde una persona elige a mano el cuadro de cada
// previsualizacion. Se carga la de verdad en jsdom, con el lienzo, las
// imagenes y el servidor de mentira, y se la maneja como lo haria alguien
// con el raton.
//
// Lo que hay que sujetar:
//
//   AGRANDAR DESDE UNA ESQUINA DEJA FIJA LA CONTRARIA Y SIGUE CUADRADO.
//   Es la cuenta mas facil de equivocar: cuatro esquinas, cada una con su
//   signo. Un fallo aqui no se ve hasta que alguien arrastra justo esa.
//
//   EL CUADRO NUNCA SALE DEL LIENZO, arrastre lo que se arrastre.
//
//   LO QUE SE GUARDA ES SOLO LO DECIDIDO. Una capa que solo se miro, con
//   la sugerencia puesta, no puede colarse en el archivo como si alguien
//   la hubiera elegido.
//
//   Y LA HERRAMIENTA NO EXISTE EN PRODUCCION. Tiene una ruta que escribe
//   un archivo del repositorio.
//
// Correr:  npm test

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const raiz = (...p) => path.join(__dirname, "..", ...p);
const HTML = fs.readFileSync(raiz("scripts", "herramientas", "recortes", "index.html"), "utf8");
const APP = fs.readFileSync(raiz("scripts", "herramientas", "recortes", "app.js"), "utf8");

const CAPAS = ["fondo", "espalda", "modelo", "piel", "ojos", "boca", "botas", "pantalon",
  "remera", "guantes", "accesorio", "cara", "pelo", "mascota", "borde"];

const prenda = (valor, x, y, ancho, alto) =>
  ({ valor, nombre: valor, url: "/p/" + valor + ".png", caja: { x, y, ancho, alto } });

function datosDePrueba(config) {
  return {
    capas: CAPAS,
    modelos: ["cereza", "tora"],
    lienzo: { ancho: 327, alto: 504 },
    ladoMaximo: 327,
    ladoMinimo: 12,
    colorManiqui: { r: 172, g: 180, b: 204 },
    config: config || { ladoSalida: 96, maniqui: "plano", cuadros: {} },
    prendas: {
      cereza: { boca: [prenda("cereza_boca1", 150, 100, 30, 20)] },
      tora: {
        boca: [prenda("tora_boca1", 130, 120, 40, 20), prenda("tora_boca2", 120, 110, 80, 60)],
        pelo: [prenda("tora_pelo1", 60, 10, 200, 150)]
      }
    },
    bases: { cereza: { valor: "cereza", url: "/p/cereza.png" }, tora: { valor: "tora", url: "/p/tora.png" } },
    sugerencias: {
      cereza: { boca: { x: 140, y: 90, lado: 50 } },
      tora: { boca: { x: 100, y: 100, lado: 100 }, pelo: { x: 50, y: 0, lado: 220 } }
    },
    referencias: {}
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
async function montar(config) {
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
      return { ok: true, status: 200, json: async () => datosDePrueba(config) };
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

  test("arranca en el primer modelo, en su primera capa con prendas, con la sugerencia", async () => {
    const { doc } = await montar();
    assert.match(doc.getElementById("tituloLienzo").textContent, /cereza · boca/);
    assert.deepStrictEqual(cuadro(doc), { x: 140, y: 90, lado: 50 });
    assert.equal(doc.getElementById("avisoSugerencia").hidden, false,
      "no avisa de que lo que se ve es una sugerencia");
  });

  test("lo que ya estaba guardado vuelve como decidido", async () => {
    const { w, doc } = await montar({ ladoSalida: 96, maniqui: "plano",
      cuadros: { tora: { boca: { x: 11, y: 22, lado: 88 } } } });
    await elegirModelo(w, "tora");
    await elegirCapa(w, "boca");
    assert.deepStrictEqual(cuadro(doc), { x: 11, y: 22, lado: 88 });
    assert.equal(doc.getElementById("avisoSugerencia").hidden, true);
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

  test("una capa que solo se miro NO se guarda como decidida", async () => {
    // La sugerencia es un punto de partida. Si se colara en el archivo,
    // parecería que alguien eligio ese cuadro.
    const { w, doc, guardados } = await montar();
    await arrastrar(w, [160, 110], [170, 120]);             // decide cereza/boca
    await elegirModelo(w, "tora");                           // mira tora/boca sin tocarla
    await pulsarGuardar(w, guardados);

    assert.equal(guardados.length, 1);
    assert.deepStrictEqual(Object.keys(guardados[0].cuadros), ["cereza"],
      "se colo una capa que nadie decidio");
    assert.deepStrictEqual(guardados[0].cuadros.cereza.boca, { x: 150, y: 100, lado: 50 });
  });

  test("Aceptar convierte la sugerencia en decision", async () => {
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

describe("el aviso de las que se salen", () => {

  test("dice cuantas asoman fuera del cuadro", async () => {
    const { w, doc } = await montar();
    await elegirModelo(w, "tora");
    await elegirCapa(w, "boca");
    // La sugerencia de tora/boca es 100,100 lado 100: tora_boca2 (120,110 de 80x60) cabe.
    assert.match(doc.getElementById("seSalen").textContent, /caben enteras/);
    const lienzo = doc.getElementById("lienzo");
    for (let i = 0; i < 30; i++) {
      lienzo.dispatchEvent(new w.KeyboardEvent("keydown", { key: "-", bubbles: true }));
    }
    await esperar(w);
    assert.match(doc.getElementById("seSalen").textContent, /asoman fuera/);
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

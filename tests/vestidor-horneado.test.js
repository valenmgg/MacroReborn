// ==============================
// EL HORNO DEL VESTIDOR — tests/vestidor-horneado.test.js
// ==============================
// Cuando el artista mueve o escala una prenda, ese ajuste se dibuja
// DENTRO del PNG antes de subirlo. Acá se comprueban las órdenes que
// recibe el pincel, que es lo único que decide si el dibujo sale intacto
// o interpolado.
//
// jsdom no tiene canvas: getContext("2d") devuelve null sin lanzar. En
// vez de instalar node-canvas -una dependencia nativa de decenas de MB en
// un proyecto que tiene cuatro, y contra la regla de la casa de no tener
// librerías de imagen- se sustituye el contexto por uno que ANOTA lo que
// le piden. Lo que puede salir mal del horneado son los números que
// llegan a drawImage, y eso se ve mejor así que con un PNG de verdad.
//
// Tampoco decodifica imágenes, así que un new Image() con un data URL no
// dispararía onload nunca. Se sustituye por el mismo falso que usa
// tests/arte-pagina.test.js:292.
//
// Correr:  npm test

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { JSDOM } = require("jsdom");

const FUENTE = fs.readFileSync(path.join(__dirname, "..", "js", "arte-vestidor.js"), "utf8");

const PNG_FALSO = "data:image/png;base64," + "A".repeat(40);
const HORNEADO = "data:image/png;base64,HORNEADO";

// ==============================

function montarHorno(opciones) {
  const conf = opciones || {};
  const dom = new JSDOM("<body></body>", { runScripts: "outside-only" });
  const win = dom.window;

  // Una imagen que contesta enseguida, o que falla si se pide.
  win.Image = class {
    set src(_) {
      this.naturalWidth = conf.ancho === undefined ? 327 : conf.ancho;
      this.naturalHeight = conf.alto === undefined ? 504 : conf.alto;
      setTimeout(() => {
        if (conf.imagenRota) { if (this.onerror) this.onerror(); }
        else if (this.onload) this.onload();
      }, 0);
    }
  };

  // El contexto de mentira: anota cada orden en el orden en que llega.
  const ordenes = [];
  const ctx = {
    clearRect: (...a) => ordenes.push(["clearRect", ...a]),
    drawImage: (img, ...a) => ordenes.push(["drawImage", ...a]),
    setTransform: (...a) => ordenes.push(["setTransform", ...a]),
    translate: (...a) => ordenes.push(["translate", ...a]),
    scale: (...a) => ordenes.push(["scale", ...a]),
    save: () => ordenes.push(["save"]),
    restore: () => ordenes.push(["restore"]),
    set imageSmoothingEnabled(v) { ordenes.push(["smoothing", v]); },
    set imageSmoothingQuality(v) { ordenes.push(["calidad", v]); }
  };

  // Y el lienzo. Se guarda el que se cree para poder mirarle las medidas.
  const lienzos = [];
  const creados = [];
  const crearOriginal = win.document.createElement.bind(win.document);
  win.document.createElement = function (etiqueta) {
    creados.push(String(etiqueta).toLowerCase());
    const nodo = crearOriginal(etiqueta);
    if (String(etiqueta).toLowerCase() === "canvas") {
      nodo.getContext = () => (conf.sinCanvas ? null : ctx);
      nodo.toDataURL = () => (conf.salidaRara ? "vaya" : (conf.salida || HORNEADO));
      lienzos.push(nodo);
    }
    return nodo;
  };

  win.eval(FUENTE);

  return { dom, win, api: win.MacroVestidor, ordenes, lienzos, creados };
}

function ordenesDe(ordenes, nombre) {
  return ordenes.filter(o => o[0] === nombre);
}

function item(ancho, alto, ajuste, dataUrl) {
  return { ancho, alto, ajuste: ajuste === undefined ? null : ajuste, dataUrl: dataUrl || PNG_FALSO };
}

const NEUTRO = { dx: 0, dy: 0, escala: 100, espejo: false, alLienzo: false };

// ==============================

describe("el horno dibuja un calco, no un remuestreo", () => {
  // H1. Coordenadas enteras y tamaño de destino IGUAL al de origen es,
  // literalmente, copiar píxeles. Y el lienzo sigue siendo 327x504
  // aunque el archivo mida 505 de alto: las dos mitades del diseño -el
  // lienzo fijo y el anclaje entero- tienen que convivir.
  test("un 327x505 movido 12 y -4 se dibuja en 12, -4, 327, 505", async () => {
    // La salida se marca distinta del HORNEADO genérico para que no pueda
    // confundirse con la de ninguna otra prueba.
    const SALIDA = "data:image/png;base64,HORNEADOUNO";
    const h = montarHorno({ ancho: 327, alto: 505, salida: SALIDA });

    const salida = await h.api.pngDeSubida(
      item(327, 505, { dx: 12, dy: -4, escala: 100 }));

    assert.strictEqual(salida.horneado, true);
    assert.strictEqual(salida.exacto, true, "debería ser un calco");
    assert.deepStrictEqual(ordenesDe(h.ordenes, "drawImage"),
      [["drawImage", 12, -4, 327, 505]]);

    assert.strictEqual(h.lienzos[0].width, 327);
    assert.strictEqual(h.lienzos[0].height, 504);

    // LO QUE DE VERDAD SE SUBE. Sin esta línea, un horno que dibujara
    // perfectamente en el canvas y luego devolviera item.dataUrl -o sea,
    // el PNG SIN ajustar- pasaría esta prueba y todas las demás. Se
    // comprobó rompiéndolo a propósito: 16 de 16 en verde. Es justo el
    // fallo que este archivo entero existe para impedir.
    assert.strictEqual(salida.texto, SALIDA);
    assert.notStrictEqual(salida.texto, PNG_FALSO);
  });

  // H2. Llevar al lienzo un 327x505 es tirar una fila. Ni un scale, ni un
  // rotate, ni una transformación de ningún tipo.
  test("llevar al lienzo un 327x505 tira una fila y no toca ninguna otra", async () => {
    const h = montarHorno({ ancho: 327, alto: 505 });

    const salida = await h.api.pngDeSubida(
      item(327, 505, Object.assign({}, NEUTRO, { alLienzo: true })));

    assert.strictEqual(salida.horneado, true);
    assert.strictEqual(salida.exacto, true);
    assert.strictEqual(salida.texto, HORNEADO);
    assert.notStrictEqual(salida.texto, PNG_FALSO);
    assert.deepStrictEqual(ordenesDe(h.ordenes, "drawImage"),
      [["drawImage", 0, 0, 327, 505]]);
    assert.strictEqual(ordenesDe(h.ordenes, "scale").length, 0, "no debería escalar nada");
  });

  // H3. Y un 326x503 se RELLENA, no se estira. Con el encaje como base
  // este archivo se agrandaba un 0,2 % (su factor es 1,001988 > 1), y
  // agrandar un dibujo de línea limpia es peor que achicarlo. Ni la
  // primera versión ni la corrección que se propuso después miraron este
  // caso, porque las dos solo probaban factores menores que 1.
  test("y llevar al lienzo un 326x503 rellena, no estira", async () => {
    const h = montarHorno({ ancho: 326, alto: 503 });

    const salida = await h.api.pngDeSubida(
      item(326, 503, Object.assign({}, NEUTRO, { alLienzo: true })));

    assert.strictEqual(salida.texto, HORNEADO);
    assert.deepStrictEqual(ordenesDe(h.ordenes, "drawImage"),
      [["drawImage", 1, 1, 326, 503]]);

    // El clearRect es lo que deja transparentes la columna 0 y la fila 0,
    // en vez de dejar ahí lo que hubiera antes.
    assert.deepStrictEqual(ordenesDe(h.ordenes, "clearRect"),
      [["clearRect", 0, 0, 327, 504]]);
  });

  test("el espejo refleja sobre el centro del rectángulo, no del lienzo", async () => {
    const h = montarHorno({ ancho: 327, alto: 504 });

    await h.api.pngDeSubida(item(327, 504, { dx: 20, espejo: true }));

    // LA SECUENCIA ENTERA, no las órdenes filtradas por nombre.
    //
    // Filtrando por nombre, el drawImage podía estar FUERA del
    // save/restore -o sea, sin la reflexión aplicada- y la prueba pasaba
    // igual, porque el translate, el scale, el save y el restore seguían
    // ahí y en la cantidad esperada. Se comprobó moviendo el drawImage
    // detrás del restore: 16 de 16 en verde, con el espejo sin aplicar.
    //
    // Lo que importa del espejo no es que las órdenes existan: es que el
    // dibujo caiga DENTRO de ellas. Eso solo se ve en el orden.
    //
    // cx = x + ancho/2 = 20 + 163,5
    assert.deepStrictEqual(h.ordenes, [
      ["clearRect", 0, 0, 327, 504],
      ["smoothing", true],
      ["calidad", "high"],
      ["setTransform", 1, 0, 0, 1, 0, 0],
      ["save"],
      ["translate", 183.5, 0],
      ["scale", -1, 1],
      ["translate", -183.5, 0],
      ["drawImage", 20, 0, 327, 504],
      ["restore"],
      ["setTransform", 1, 0, 0, 1, 0, 0]
    ]);
  });

  test("y sin espejo no se toca la matriz para nada", async () => {
    const h = montarHorno({ ancho: 327, alto: 505 });

    await h.api.pngDeSubida(item(327, 505, { dx: 12 }));

    assert.deepStrictEqual(h.ordenes, [
      ["clearRect", 0, 0, 327, 504],
      ["smoothing", true],
      ["calidad", "high"],
      ["setTransform", 1, 0, 0, 1, 0, 0],
      ["drawImage", 12, 0, 327, 505],
      ["setTransform", 1, 0, 0, 1, 0, 0]
    ]);
  });

  test("y nunca se rota nada", async () => {
    const h = montarHorno({ ancho: 327, alto: 505 });
    await h.api.pngDeSubida(item(327, 505, { dx: 12, espejo: true, escala: 103 }));
    assert.strictEqual(ordenesDe(h.ordenes, "rotate").length, 0);
  });
});

describe("lo que no se tocó viaja intacto", () => {
  // H4. La deduplicación por sha256 del servidor solo reusa la fila si
  // los bytes coinciden EXACTAMENTE. Pasar por toDataURL vuelve a
  // comprimir el PNG y cambia sus bytes aunque los píxeles sean idénticos.
  test("sin ajuste no se crea ningún canvas y salen los bytes originales", async () => {
    const h = montarHorno({ ancho: 327, alto: 504 });

    const salida = await h.api.pngDeSubida(item(327, 504, null));

    assert.strictEqual(salida.horneado, false);
    assert.strictEqual(salida.texto, PNG_FALSO);
    assert.ok(!h.creados.includes("canvas"), "no debería haber creado un canvas");

    const antes = crypto.createHash("sha256").update(PNG_FALSO.split(",")[1]).digest("hex");
    const despues = crypto.createHash("sha256").update(salida.texto.split(",")[1]).digest("hex");
    assert.strictEqual(antes, despues, "el sha256 tiene que ser el mismo");
  });

  test("un PNG descuadrado sin tocar también se sube tal cual", async () => {
    const h = montarHorno({ ancho: 327, alto: 505 });

    const salida = await h.api.pngDeSubida(item(327, 505, null));

    assert.strictEqual(salida.horneado, false);
    assert.strictEqual(salida.texto, PNG_FALSO);
    assert.ok(!h.creados.includes("canvas"));
  });

  // Cierra la duplicación de filas que abre "aplicar este ajuste a todas
  // las de esta ranura" cuando alguna de las hermanas ya estaba bien.
  test("y un 327x504 con alLienzo no pasa por el canvas: hornearlo sería la identidad", async () => {
    const h = montarHorno({ ancho: 327, alto: 504 });

    const salida = await h.api.pngDeSubida(
      item(327, 504, Object.assign({}, NEUTRO, { alLienzo: true })));

    assert.strictEqual(salida.horneado, false);
    assert.strictEqual(salida.texto, PNG_FALSO);
    assert.ok(!h.creados.includes("canvas"));
  });

  test("mover y volver a cero deja el archivo como estaba", async () => {
    const h = montarHorno({ ancho: 327, alto: 505 });
    const salida = await h.api.pngDeSubida(item(327, 505, NEUTRO));
    assert.strictEqual(salida.horneado, false);
    assert.ok(!h.creados.includes("canvas"));
  });
});

describe("cuando no se puede hornear, no se publica otra cosa", () => {
  // Lo importante de este bloque entero: en NINGÚN caso se devuelve
  // item.dataUrl. El artista colocó la prenda, vio sus números y pulsó
  // Publicar; devolverle el PNG sin ajustar con un tick verde le gasta el
  // identificador en un dibujo que no aprobó, y corregirlo después no se
  // puede.
  test("sin medidas se avisa, no se sube el original", async () => {
    const h = montarHorno({ ancho: 0, alto: 0 });

    const salida = await h.api.pngDeSubida(item(0, 0, { dx: 12 }));

    assert.ok(salida.error, "tenía que devolver un error");
    assert.strictEqual(salida.texto, undefined);
  });

  test("con el canvas bloqueado se avisa, no se sube el original", async () => {
    const h = montarHorno({ ancho: 327, alto: 505, sinCanvas: true });

    const salida = await h.api.pngDeSubida(item(327, 505, { dx: 12 }));

    assert.match(salida.error, /canvas/);
    assert.strictEqual(salida.texto, undefined);
  });

  test("si el PNG no se deja leer, tampoco", async () => {
    const h = montarHorno({ ancho: 327, alto: 505, imagenRota: true });

    const salida = await h.api.pngDeSubida(item(327, 505, { dx: 12 }));

    assert.ok(salida.error);
    assert.strictEqual(salida.texto, undefined);
  });

  test("y si el navegador devuelve algo que no es un PNG, tampoco", async () => {
    const h = montarHorno({ ancho: 327, alto: 505, salidaRara: true });

    const salida = await h.api.pngDeSubida(item(327, 505, { dx: 12 }));

    assert.match(salida.error, /PNG válido/);
    assert.strictEqual(salida.texto, undefined);
  });

  // El canvas reencoda sin las optimizaciones del exportador del artista,
  // así que el horneado puede pesar más que el original y pasarse del
  // tope del servidor. Mejor enterarse antes de salir a la red.
  test("y si el horneado se pasa de 1 MB se dice el peso, en kB", async () => {
    const gordo = "data:image/png;base64," + "A".repeat(2 * 1024 * 1024);
    const h = montarHorno({ ancho: 327, alto: 505, salida: gordo });

    const salida = await h.api.pngDeSubida(item(327, 505, { dx: 12 }));

    assert.match(salida.error, /kB/);
    assert.match(salida.error, /1 MB/);
    assert.strictEqual(salida.texto, undefined);
  });
});

describe("el horno sabe cuándo está interpolando", () => {
  // H6. El único sitio del vestidor donde se remuestrea por defecto, y es
  // un botón que alguien pulsa: el preset "Encajar", que solo aparece en
  // los tres dibujos sueltos del catálogo que de verdad lo necesitan.
  test("encajar un 654x1010 al 50 % cae en medios píxeles, y lo dice", async () => {
    const h = montarHorno({ ancho: 654, alto: 1010 });

    const salida = await h.api.pngDeSubida(
      item(654, 1010, { dx: 0, dy: 0, escala: 50, alLienzo: true }));

    assert.strictEqual(salida.horneado, true);
    assert.strictEqual(salida.exacto, false, "esto sí interpola, y hay que saberlo");
    assert.strictEqual(salida.texto, HORNEADO);
    assert.deepStrictEqual(ordenesDe(h.ordenes, "drawImage"),
      [["drawImage", 0.5, -0.5, 327, 505]]);

    // EL LIENZO ES FIJO, Y ESTA ES LA ÚNICA PRUEBA QUE PUEDE DEMOSTRARLO.
    //
    // En todas las demás el archivo mide 327 de ancho, así que
    // "canvas.width = img.naturalWidth" daría 327 igual y la comprobación
    // pasaría sin comprobar nada. Se vio rompiéndolo a propósito: la
    // mutación pasaba 17 de 17. Acá el archivo mide 654, de modo que si
    // alguien hace que el lienzo siga al archivo, salta.
    assert.strictEqual(h.lienzos[0].width, 327, "el lienzo siguió al archivo");
    assert.strictEqual(h.lienzos[0].height, 504, "el lienzo siguió al archivo");
  });

  // Los tres términos de "exacto" (x entera, y entera, tamaño igual) caían
  // a la vez en el único caso que había. Acá se separan: este interpola
  // solo por el tamaño, con las coordenadas perfectamente enteras.
  test("y se interpola aunque las coordenadas sean enteras, si cambia el tamaño", async () => {
    const h = montarHorno({ ancho: 400, alto: 504 });

    const salida = await h.api.pngDeSubida(item(400, 504, { escala: 50 }));

    assert.deepStrictEqual(ordenesDe(h.ordenes, "drawImage"),
      [["drawImage", 64, 126, 200, 252]]);
    assert.strictEqual(salida.exacto, false, "cambiar el tamaño ya es remuestrear");
  });

  test("pero a escala 100 nunca interpola, en ninguna medida real", async () => {
    for (const [w, h] of [[327, 504], [327, 505], [326, 503], [326, 504]]) {
      const horno = montarHorno({ ancho: w, alto: h });
      const salida = await horno.api.pngDeSubida(item(w, h, { dx: 7, dy: -3, escala: 100 }));
      assert.strictEqual(salida.exacto, true, w + "x" + h + " salió interpolado");
    }
  });
});

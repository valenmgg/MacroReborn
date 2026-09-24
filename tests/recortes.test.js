// ==============================
// LOS CUADROS DE LAS PREVISUALIZACIONES — tests/recortes.test.js
// ==============================
// api/_recortes.js calcula el cuadro automatico de cada prenda, y guarda
// y valida los que alguien fuerza con la herramienta;
// api/_previsualizacion.js dibuja con ellos.
//
// Lo que hay que sujetar:
//
//   EL AUTOMATICO CONTIENE LA PRENDA, sin ampliarla por encima de su
//   tamaño real y sin salirse del lienzo. Y si no cabe, se ve su parte de
//   arriba: de un pelo largo, la cabeza.
//
//   UN CUADRO MALO NO LLEGA AL ARCHIVO. Si la herramienta manda uno que
//   se sale del lienzo, el recorte revienta despues, al generar 768
//   imagenes, lejos de quien se equivoco. Se para aqui, con el motivo.
//
//   LO QUE SE FUERZA MANDA SOBRE EL AUTOMATICO, y solo en su capa y su
//   modelo.
//
//   EL ORDEN DE LAS CAPAS SE RESPETA AL PONER LA PRENDA. El fondo va
//   detras del cuerpo y la camisa delante. Al reves, un fondo taparia
//   el maniqui entero, y en una comparacion de objetos no se nota.
//
//   EL MANIQUI PLANO CONSERVA LA FORMA. Se pinta de un color, pero el
//   alfa no se toca: los bordes suaves siguen suaves.
//
// Correr:  npm test

require("./_aislar-datos");   // antes de api/: ver ese archivo

const { test, describe, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const R = require("../api/_recortes");
const P = require("../api/_previsualizacion");
const C = require("../api/_compositor");
const lienzo = require("../api/_lienzo");

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "mr-recortes-"));
after(() => fs.rmSync(TEMP, { recursive: true, force: true }));
const archivo = n => path.join(TEMP, n + ".json");

// Un PNG del lienzo con un rectangulo de color, y transparente el resto.
function png(r, g, b, x0, y0, ancho, alto) {
  const rgba = Buffer.alloc(327 * 504 * 4);
  for (let y = y0; y < y0 + alto; y++) for (let x = x0; x < x0 + ancho; x++) {
    const i = (y * 327 + x) * 4;
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
  }
  return lienzo.escribirRGBA8({ rgba, ancho: 327, alto: 504 });
}

const pixel = (img, x, y) => {
  const i = (y * img.ancho + x) * 4;
  return [img.rgba[i], img.rgba[i + 1], img.rgba[i + 2], img.rgba[i + 3]];
};

describe("un cuadro", () => {

  test("uno bien puesto vale", () => {
    assert.equal(R.problemaDeCuadro({ x: 10, y: 20, lado: 100 }), null);
    assert.equal(R.problemaDeCuadro({ x: 0, y: 0, lado: 327 }), null);
    assert.equal(R.problemaDeCuadro({ x: 0, y: 177, lado: 327 }), null);
  });

  test("uno que se sale del lienzo no vale, y dice por donde", () => {
    assert.match(R.problemaDeCuadro({ x: 300, y: 0, lado: 50 }), /derecha/);
    assert.match(R.problemaDeCuadro({ x: 0, y: 480, lado: 50 }), /abajo/);
    assert.match(R.problemaDeCuadro({ x: -1, y: 0, lado: 50 }), /izquierda/);
  });

  test("siempre es cuadrado: no cabe uno mas alto que el lienzo es ancho", () => {
    // El lienzo mide 327x504, asi que el mayor cuadrado es de 327. Uno de
    // 400 no cabe de ancho aunque si cabria de alto.
    assert.match(R.problemaDeCuadro({ x: 0, y: 0, lado: 400 }), /mas grande/);
  });

  test("ni uno diminuto, ni con decimales, ni con basura", () => {
    assert.match(R.problemaDeCuadro({ x: 0, y: 0, lado: 3 }), /pequeño/);
    assert.match(R.problemaDeCuadro({ x: 1.5, y: 0, lado: 50 }), /entero/);
    for (const malo of [null, undefined, {}, "cuadro", { x: "1", y: 2, lado: 50 }]) {
      assert.ok(R.problemaDeCuadro(malo), "acepto " + JSON.stringify(malo));
    }
  });

});

describe("el archivo", () => {

  test("si no existe, se empieza de cero sin romper", () => {
    const c = R.leer(archivo("no-existe"));
    assert.deepStrictEqual(c.cuadros, {});
    assert.equal(c.ladoSalida, 96);
    assert.equal(c.maniqui, "plano");
  });

  test("se guarda y se vuelve a leer igual", () => {
    const f = archivo("ida-y-vuelta");
    const config = R.vacio();
    config.cuadros = { tora: { boca: { x: 120, y: 60, lado: 110 } } };
    R.escribir(config, f);
    assert.deepStrictEqual(R.leer(f).cuadros, config.cuadros);
  });

  test("un cuadro malo no llega al archivo, y el error dice cual y por que", () => {
    const f = archivo("malo");
    const config = R.vacio();
    config.cuadros = { tora: { boca: { x: 300, y: 0, lado: 80 } } };
    assert.throws(() => R.escribir(config, f), err => {
      assert.ok(err.problemas.some(p => p.includes("tora/boca") && p.includes("derecha")));
      return true;
    });
    assert.equal(fs.existsSync(f), false, "escribio un archivo con un cuadro malo");
  });

  test("una capa que no existe tampoco", () => {
    const config = R.vacio();
    config.cuadros = { tora: { sombrero: { x: 0, y: 0, lado: 50 } } };
    assert.throws(() => R.escribir(config, archivo("capa")), /capa desconocida/);
  });

  test("sale ordenado, para que un cambio se lea como una linea en git", () => {
    const f = archivo("orden");
    const config = R.vacio();
    config.cuadros = {
      tora: { pelo: { x: 1, y: 1, lado: 50 }, boca: { x: 2, y: 2, lado: 50 } },
      cereza: { ojos: { x: 3, y: 3, lado: 50 } }
    };
    R.escribir(config, f);
    const leido = JSON.parse(fs.readFileSync(f, "utf8"));
    assert.deepStrictEqual(Object.keys(leido.cuadros), ["cereza", "tora"]);
    // Las capas en el orden de dibujo, no en el que llegaron.
    assert.deepStrictEqual(Object.keys(leido.cuadros.tora), ["boca", "pelo"]);
  });

  test("no deja temporales a medias", () => {
    const f = archivo("temporales");
    R.escribir(R.vacio(), f);
    assert.deepStrictEqual(fs.readdirSync(TEMP).filter(n => n.endsWith(".tmp")), []);
  });

  test("cuadroDe devuelve el de ese modelo y esa capa, o nada", () => {
    const config = R.vacio();
    config.cuadros = { tora: { boca: { x: 1, y: 2, lado: 50 } } };
    assert.deepStrictEqual(R.cuadroDe(config, "tora", "boca"), { x: 1, y: 2, lado: 50 });
    assert.equal(R.cuadroDe(config, "cereza", "boca"), null, "le presto el cuadro de otro modelo");
    assert.equal(R.cuadroDe(config, "tora", "pelo"), null);
  });

});

describe("la caja con la que se calcula", () => {

  // Un lienzo a mano, con los pixeles de alfa que se pidan.
  function lienzoCon(rectangulos) {
    const img = { rgba: Buffer.alloc(327 * 504 * 4), ancho: 327, alto: 504 };
    for (const [x0, y0, an, al, a] of rectangulos) {
      for (let y = y0; y < y0 + al; y++) for (let x = x0; x < x0 + an; x++) img.rgba[(y * 327 + x) * 4 + 3] = a;
    }
    return img;
  }

  test("ignora los restos casi invisibles lejos del dibujo", () => {
    // Asi venian dos pelos de Naruto: el pelo, y restos de alfa baja por
    // todo el lienzo. Con ellos, el pelo salia diminuto.
    const img = lienzoCon([[100, 30, 110, 110, 255], [0, 0, 327, 2, 12], [0, 500, 327, 4, 12]]);
    assert.deepStrictEqual(R.cajaParaCuadro(img), { x: 100, y: 30, ancho: 110, alto: 110 });
  });

  test("si todo es casi invisible, cuenta todo en vez de quedarse sin caja", () => {
    const img = lienzoCon([[50, 60, 40, 30, 20]]);
    assert.deepStrictEqual(R.cajaParaCuadro(img), { x: 50, y: 60, ancho: 40, alto: 30 });
  });

});

describe("el cuadro automatico", () => {

  test("contiene la prenda, con margen, y es cuadrado", () => {
    const caja = { x: 100, y: 150, ancho: 120, alto: 80 };
    const q = R.cuadroAutomatico(caja);
    assert.equal(R.problemaDeCuadro(q), null);
    assert.equal(R.cuantasSeSalen([caja], q), 0, "deja la prenda fuera");
    assert.equal(q.lado, 140, "no es el menor cuadrado con margen");
  });

  test("una prenda diminuta no se amplia por encima de su tamaño real", () => {
    // Un pendiente de 30x20: ampliado a 96 se veria borroso. El cuadro no
    // baja de lo que mide la previsualizacion.
    const caja = { x: 150, y: 100, ancho: 30, alto: 20 };
    const q = R.cuadroAutomatico(caja);
    assert.equal(q.lado, R.LADO_SALIDA);
    assert.equal(R.cuantasSeSalen([caja], q), 0);
  });

  test("nunca se sale del lienzo, aunque la prenda este en un borde", () => {
    const caja = { x: 300, y: 480, ancho: 27, alto: 24 };
    const q = R.cuadroAutomatico(caja);
    assert.equal(R.problemaDeCuadro(q), null, JSON.stringify(q));
    assert.equal(R.cuantasSeSalen([caja], q), 0);
  });

  test("si no cabe entera, se ve su parte de arriba", () => {
    // Una melena hasta los pies: se ve la cabeza con el pelo, no las puntas.
    const melena = { x: 60, y: 20, ancho: 200, alto: 450 };
    const q = R.cuadroAutomatico(melena);
    assert.equal(q.lado, 327);
    assert.ok(q.y <= melena.y && q.y + q.lado > melena.y, "no se ve la parte de arriba: " + JSON.stringify(q));
    // Un fondo, que ocupa todo el lienzo.
    assert.deepStrictEqual(R.cuadroAutomatico({ x: 0, y: 0, ancho: 327, alto: 504 }), { x: 0, y: 0, lado: 327 });
  });

  test("sin dibujo da algo valido en vez de reventar", () => {
    assert.equal(R.problemaDeCuadro(R.cuadroAutomatico(null)), null);
  });

  test("lo que se fuerza para una capa manda, y solo en su capa y su modelo", () => {
    const caja = { x: 150, y: 100, ancho: 30, alto: 20 };
    const config = R.vacio();
    config.cuadros = { tora: { boca: { x: 1, y: 2, lado: 50 } } };
    assert.deepStrictEqual(R.cuadroParaPrenda(config, { modelo: "tora", capa: "boca", caja }), { x: 1, y: 2, lado: 50 });
    assert.deepStrictEqual(R.cuadroParaPrenda(config, { modelo: "cereza", capa: "boca", caja }),
      R.cuadroAutomatico(caja), "le presto a cereza el cuadro de tora");
    assert.deepStrictEqual(R.cuadroParaPrenda(config, { modelo: "tora", capa: "pelo", caja }),
      R.cuadroAutomatico(caja));
    assert.deepStrictEqual(R.cuadroParaPrenda(R.vacio(), { modelo: "tora", capa: "boca", caja }),
      R.cuadroAutomatico(caja), "sin nada forzado no es automatico");
  });

});

describe("se salen del cuadro", () => {

  test("cuenta las que asoman por cualquier lado", () => {
    const cuadro = { x: 100, y: 100, lado: 100 };
    const cajas = [
      { x: 120, y: 120, ancho: 20, alto: 20 },   // dentro
      { x: 90, y: 120, ancho: 20, alto: 20 },    // asoma por la izquierda
      { x: 150, y: 150, ancho: 60, alto: 20 },   // asoma por la derecha
      { x: 120, y: 190, ancho: 20, alto: 20 }    // asoma por abajo
    ];
    assert.equal(R.cuantasSeSalen(cajas, cuadro), 3);
  });

});

describe("la previsualizacion", () => {

  // Un modelo que ocupa el centro y una camisa encima de el.
  const modelo = png(250, 250, 250, 100, 100, 127, 300);
  const camisa = png(200, 30, 30, 110, 180, 107, 60);
  const fondo = png(20, 60, 140, 0, 0, 327, 504);

  test("sale un JPG del tamaño pedido", () => {
    const jpg = P.renderizar({ base: modelo, prenda: camisa, capa: "remera",
      cuadro: { x: 80, y: 150, lado: 160 } });
    assert.equal(jpg[0], 0xFF);
    assert.equal(jpg[1], 0xD8);
  });

  test("el maniqui plano conserva la forma y cambia el color", () => {
    const cuerpo = C.componer([modelo]);
    const plano = P.silueta(cuerpo);
    // Dentro del cuerpo: el color del maniqui.
    assert.deepStrictEqual(pixel(plano, 150, 150).slice(0, 3),
      [R.COLOR_MANIQUI.r, R.COLOR_MANIQUI.g, R.COLOR_MANIQUI.b]);
    // Fuera: sigue transparente, que es lo que quiere decir "la forma".
    assert.equal(pixel(plano, 10, 10)[3], 0);
  });

  test("la camisa va DELANTE del cuerpo", () => {
    const img = P.puesta({ base: modelo, prenda: camisa, capa: "remera", maniqui: "plano" });
    assert.deepStrictEqual(pixel(img, 150, 200).slice(0, 3), [200, 30, 30],
      "la camisa quedo tapada por el maniqui");
  });

  test("y la espalda va DETRAS, que es donde falla si el orden se invierte", () => {
    // Unas alas que ocupan todo el lienzo: por donde esta el cuerpo, el
    // cuerpo tiene que taparlas.
    const alas = png(20, 60, 140, 0, 0, 327, 504);
    const img = P.puesta({ base: modelo, prenda: alas, capa: "espalda", maniqui: "plano" });
    assert.deepStrictEqual(pixel(img, 150, 150).slice(0, 3),
      [R.COLOR_MANIQUI.r, R.COLOR_MANIQUI.g, R.COLOR_MANIQUI.b],
      "la espalda tapo al maniqui");
    assert.deepStrictEqual(pixel(img, 10, 10).slice(0, 3), [20, 60, 140]);
  });

  test("el fondo sale solo, sin el cuerpo delante, con cualquier maniqui", () => {
    // Decidido el 23/09/2026: en la previsualizacion del fondo solo se ve
    // el fondo. Donde estaria el cuerpo tiene que verse el fondo.
    for (const maniqui of ["plano", "color"]) {
      const img = P.puesta({ base: modelo, prenda: fondo, capa: "fondo", maniqui });
      assert.deepStrictEqual(pixel(img, 150, 150).slice(0, 3), [20, 60, 140],
        "el cuerpo tapa el fondo con el maniqui " + maniqui);
    }
  });

  test("con el maniqui a color, el cuerpo se queda como es", () => {
    const img = P.puesta({ base: modelo, prenda: camisa, capa: "remera", maniqui: "color" });
    assert.deepStrictEqual(pixel(img, 150, 150).slice(0, 3), [250, 250, 250]);
  });

  test("la previsualizacion del propio modelo no se vuelve silueta", () => {
    // Si se aplanara, los seis modelos saldrian como seis manchas iguales.
    const img = P.puesta({ base: modelo, prenda: modelo, capa: "modelo", maniqui: "plano" });
    assert.deepStrictEqual(pixel(img, 150, 150).slice(0, 3), [250, 250, 250]);
  });

  test("un cuadro malo se rechaza antes de dibujar", () => {
    assert.throws(() => P.renderizar({ base: modelo, prenda: camisa, capa: "remera",
      cuadro: { x: 300, y: 0, lado: 100 } }), RangeError);
  });

});

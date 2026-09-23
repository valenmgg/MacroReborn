// ==============================
// LOS CUADROS DE LAS PREVISUALIZACIONES — tests/recortes.test.js
// ==============================
// api/_recortes.js guarda y valida los cuadros que una persona elige en
// la herramienta, y api/_previsualizacion.js dibuja con ellos.
//
// Lo que hay que sujetar:
//
//   UN CUADRO MALO NO LLEGA AL ARCHIVO. Si la herramienta manda uno que
//   se sale del lienzo, el recorte revienta despues, al generar 768
//   imagenes, lejos de quien se equivoco. Se para aqui, con el motivo.
//
//   LO QUE ESTA EN EL ARCHIVO ES LO QUE ALGUIEN DECIDIO. La sugerencia
//   es un punto de partida y no se guarda sola.
//
//   EL ORDEN DE LAS CAPAS SE RESPETA AL PONER LA PRENDA. El fondo va
//   detras del cuerpo y la camisa delante. Al reves, un fondo taparia
//   el maniqui entero, y en una comparacion de objetos no se nota.
//
//   EL MANIQUI PLANO CONSERVA LA FORMA. Se pinta de un color, pero el
//   alfa no se toca: los bordes suaves siguen suaves.
//
// Correr:  npm test

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

describe("la sugerencia", () => {

  test("cubre el dibujo de todas las prendas, con margen, y es cuadrada", () => {
    const cajas = [{ x: 100, y: 80, ancho: 40, alto: 30 }, { x: 110, y: 90, ancho: 60, alto: 20 }];
    const s = R.sugerir(cajas, 10);
    assert.equal(R.problemaDeCuadro(s), null);
    assert.equal(R.cuantasSeSalen(cajas, s), 0, "la sugerencia deja prendas fuera");
  });

  test("nunca se sale del lienzo, aunque el dibujo este en un borde", () => {
    const s = R.sugerir([{ x: 300, y: 480, ancho: 27, alto: 24 }], 20);
    assert.equal(R.problemaDeCuadro(s), null, JSON.stringify(s));
  });

  test("con dibujo de cuerpo entero da el mayor cuadrado posible", () => {
    const s = R.sugerir([{ x: 0, y: 0, ancho: 327, alto: 504 }]);
    assert.equal(s.lado, 327);
  });

  test("sin prendas da algo valido en vez de reventar", () => {
    assert.equal(R.problemaDeCuadro(R.sugerir([])), null);
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

  test("y el fondo va DETRAS, que es donde falla si el orden se invierte", () => {
    const img = P.puesta({ base: modelo, prenda: fondo, capa: "fondo", maniqui: "plano" });
    // Donde esta el cuerpo se ve el cuerpo, no el fondo.
    assert.deepStrictEqual(pixel(img, 150, 150).slice(0, 3),
      [R.COLOR_MANIQUI.r, R.COLOR_MANIQUI.g, R.COLOR_MANIQUI.b],
      "el fondo tapo al maniqui");
    // Y fuera del cuerpo se ve el fondo.
    assert.deepStrictEqual(pixel(img, 10, 10).slice(0, 3), [20, 60, 140]);
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

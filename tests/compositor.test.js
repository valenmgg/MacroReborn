// ==============================
// COMPONER UN AVATAR — tests/compositor.test.js
// ==============================
// api/_compositor.js apila las prendas en el servidor y devuelve una
// sola imagen, para que el archivo del artista deje de salir entero por
// la pestaña de Red. El porqué está en docs/AVATARES-SERVIDOR.md.
//
// Lo que hay que sujetar aquí son cuatro cosas, y ninguna es obvia:
//
//   1. EL ORDEN. Una capa tapa a la anterior. Si esto se invirtiera, el
//      pelo saldría debajo de la cabeza y nadie lo vería en un test de
//      igualdad de objetos.
//   2. EL ALFA. La mezcla tiene que dar lo mismo que hace el navegador
//      hoy apilando quince <img>, o el día del cambio los avatares de
//      181 personas cambiarían de aspecto. Eso sería un cambio de
//      producto disfrazado de cambio técnico.
//   3. EL FONDO CUANDO NO LO HAY. JPG no tiene alfa, asi que un avatar
//      sin capa de fondo se aplana sobre blanco. Si no se aplanara,
//      esos pixeles saldrian negros, que es lo que hay en memoria.
//   4. LA MISMA RECETA, LOS MISMOS BYTES. La URL va a llevar la huella
//      del contenido y se va a cachear un año. Si componer dos veces
//      diera dos resultados, esa caché serviría basura.
//
// Las imágenes de prueba se fabrican aquí con api/_lienzo.js en vez de
// guardar PNG de muestra en el repo: así la prueba no depende de un
// archivo que alguien pueda tocar, y de paso ejercita el mismo lector
// que usa producción.
//
// Correr:  npm test

const { test, describe } = require("node:test");
const assert = require("node:assert");

const C = require("../api/_compositor");
const lienzo = require("../api/_lienzo");

const A = C.ANCHO, H = C.ALTO;

// Un PNG liso del tamaño del lienzo, del color y el alfa que se pidan.
function pngLiso(r, g, b, a, ancho, alto) {
  const an = ancho || A, al = alto || H;
  const rgba = Buffer.alloc(an * al * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a;
  }
  return lienzo.escribirRGBA8({ rgba, ancho: an, alto: al });
}

// Un PNG transparente con un rectángulo opaco dentro, para las cajas.
function pngConCaja(r, g, b, x0, y0, ancho, alto) {
  const rgba = Buffer.alloc(A * H * 4);
  for (let y = y0; y < y0 + alto; y++) {
    for (let x = x0; x < x0 + ancho; x++) {
      const i = (y * A + x) * 4;
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
    }
  }
  return lienzo.escribirRGBA8({ rgba, ancho: A, alto: H });
}

const pixel = (img, x, y) => {
  const i = (y * img.ancho + x) * 4;
  return [img.rgba[i], img.rgba[i + 1], img.rgba[i + 2], img.rgba[i + 3]];
};

describe("apilar las capas", () => {

  test("el lienzo vacío es transparente y mide 327x504", () => {
    const img = C.componer([]);
    assert.equal(img.ancho, 327);
    assert.equal(img.alto, 504);
    assert.deepStrictEqual(pixel(img, 0, 0), [0, 0, 0, 0]);
  });

  test("la última capa opaca tapa a las de antes", () => {
    const img = C.componer([
      pngLiso(255, 0, 0, 255),
      pngLiso(0, 255, 0, 255)
    ]);
    assert.deepStrictEqual(pixel(img, 10, 10), [0, 255, 0, 255]);
  });

  test("y al revés da lo contrario, que es la prueba de que el orden importa", () => {
    const img = C.componer([
      pngLiso(0, 255, 0, 255),
      pngLiso(255, 0, 0, 255)
    ]);
    assert.deepStrictEqual(pixel(img, 10, 10), [255, 0, 0, 255]);
  });

  test("una capa transparente del todo no cambia nada", () => {
    const solo = C.componer([pngLiso(255, 0, 0, 255)]);
    const conVacia = C.componer([pngLiso(255, 0, 0, 255), pngLiso(9, 9, 9, 0)]);
    assert.deepStrictEqual(conVacia.rgba, solo.rgba);
  });

  test("una capa a medias se mezcla, no se pisa", () => {
    // Blanco al 50 % sobre negro opaco da gris medio. Si en vez de
    // mezclar se pisara, saldria blanco.
    const img = C.componer([
      pngLiso(0, 0, 0, 255),
      pngLiso(255, 255, 255, 128)
    ]);
    const [r, , , a] = pixel(img, 10, 10);
    assert.equal(a, 255);
    assert.ok(r > 120 && r < 136, "salió " + r + ", se esperaba gris medio");
  });

  test("cada capa aporta solo donde tiene dibujo", () => {
    const img = C.componer([
      pngConCaja(255, 0, 0, 0, 0, 100, 100),
      pngConCaja(0, 0, 255, 200, 300, 50, 50)
    ]);
    assert.deepStrictEqual(pixel(img, 10, 10), [255, 0, 0, 255]);
    assert.deepStrictEqual(pixel(img, 210, 310), [0, 0, 255, 255]);
    assert.deepStrictEqual(pixel(img, 160, 200), [0, 0, 0, 0]);
  });

  test("una capa que no mide el lienzo se lleva a él sin reventar", () => {
    // El catálogo entero mide 327x504 desde que encajar-lienzo.js lo
    // normalizó, pero que no pase nunca no es razón para reventar si
    // pasa: esto dibuja el avatar de alguien.
    for (const [an, al] of [[327, 505], [326, 503], [654, 1010]]) {
      const img = C.componer([pngLiso(10, 20, 30, 255, an, al)]);
      assert.equal(img.ancho, A);
      assert.equal(img.alto, H);
    }
  });

  test("y las capas vacías o nulas se saltan en vez de romper", () => {
    const img = C.componer([null, undefined, Buffer.alloc(0), pngLiso(1, 2, 3, 255)]);
    assert.deepStrictEqual(pixel(img, 5, 5), [1, 2, 3, 255]);
  });

});

describe("la salida", () => {

  test("con fondo opaco sale JPG", () => {
    const r = C.renderizar([pngLiso(40, 60, 80, 255)], [[62, 96]]);
    assert.equal(r.formato, "jpg");
    assert.equal(r.transparente, false);
    // Marca de JPEG: SOI al principio, EOI al final.
    const jpg = r.salidas["62x96"];
    assert.equal(jpg[0], 0xFF);
    assert.equal(jpg[1], 0xD8);
    assert.equal(jpg[jpg.length - 2], 0xFF);
    assert.equal(jpg[jpg.length - 1], 0xD9);
  });

  test("sin fondo TAMBIEN sale JPG, aplanado sobre blanco", () => {
    // Decidido el 21/09/2026: un solo formato, sin una rama aparte que
    // mantener. Son 6 de 117 avatares, y veran un rectangulo blanco
    // donde antes se veia la pagina.
    const r = C.renderizar([pngConCaja(200, 50, 50, 100, 100, 50, 50)], [[62, 96]]);
    assert.equal(r.formato, "jpg");
    assert.equal(r.transparente, true, "el aviso de que llevaba alfa se perdio");
    assert.equal(r.salidas["62x96"][0], 0xFF);
  });

  test("y el hueco queda blanco, no negro", () => {
    // Sin aplanar, jpeg-js ignora el alfa y escribe lo que haya en
    // memoria detras, que es cero: negro. Es el fallo que no se ve en
    // una comparacion de objetos y si en la cara de un avatar.
    const plano = C.aplanar(C.componer([pngConCaja(200, 50, 50, 10, 10, 20, 20)]));
    assert.deepStrictEqual(pixel(plano, 300, 480), [255, 255, 255, 255]);
  });

  test("se puede pedir PNG a proposito, y entonces conserva el alfa", () => {
    const r = C.renderizar([pngConCaja(200, 50, 50, 100, 100, 50, 50)], [[62, 96]], { formato: "png" });
    assert.equal(r.formato, "png");
    assert.ok(lienzo.leerPixeles(r.salidas["62x96"]), "no es un PNG legible");
  });

  test("aplanar deja todo opaco y respeta el color de relleno", () => {
    const img = C.componer([]);
    const plano = C.aplanar(img, { r: 17, g: 24, b: 39 });
    assert.deepStrictEqual(pixel(plano, 0, 0), [17, 24, 39, 255]);
    assert.equal(C.tieneTransparencia(plano), false);
  });

});

describe("los tamaños", () => {

  test("se entrega cada uno de los pedidos, con su nombre", () => {
    const r = C.renderizar([pngLiso(30, 30, 30, 255)], [[327, 504], [62, 96]]);
    assert.deepStrictEqual(Object.keys(r.salidas).sort(), ["327x504", "62x96"]);
  });

  test("la miniatura pesa mucho menos que la grande", () => {
    const r = C.renderizar([pngLiso(30, 90, 150, 255)], [[327, 504], [62, 96]]);
    assert.ok(r.salidas["62x96"].length < r.salidas["327x504"].length);
  });

  test("reducir conserva el color de una zona lisa", () => {
    const chico = C.reducir(C.componer([pngLiso(120, 60, 200, 255)]), 62, 96);
    assert.equal(chico.ancho, 62);
    assert.equal(chico.alto, 96);
    const [r, g, b] = pixel(chico, 30, 40);
    assert.ok(Math.abs(r - 120) <= 1 && Math.abs(g - 60) <= 1 && Math.abs(b - 200) <= 1,
      "salió " + [r, g, b].join(","));
  });

});

describe("la misma receta, los mismos bytes", () => {

  test("componer dos veces da bytes idénticos", () => {
    // La URL va a llevar la huella del contenido y se va a cachear un
    // año. Si esto no fuera determinista, la caché serviría basura.
    const capas = [pngLiso(10, 20, 30, 255), pngConCaja(200, 100, 0, 50, 50, 80, 80)];
    const a = C.renderizar(capas, [[327, 504], [62, 96]]);
    const b = C.renderizar(capas, [[327, 504], [62, 96]]);
    assert.deepStrictEqual(a.salidas["327x504"], b.salidas["327x504"]);
    assert.deepStrictEqual(a.salidas["62x96"], b.salidas["62x96"]);
  });

});

describe("recortar, para las previsualizaciones", () => {

  test("saca el trozo pedido y nada más", () => {
    const img = C.componer([pngConCaja(255, 0, 0, 100, 100, 40, 40)]);
    const trozo = C.recortar(img, 100, 100, 40, 40);
    assert.equal(trozo.ancho, 40);
    assert.equal(trozo.alto, 40);
    assert.deepStrictEqual(pixel(trozo, 0, 0), [255, 0, 0, 255]);
    assert.deepStrictEqual(pixel(trozo, 39, 39), [255, 0, 0, 255]);
  });

  test("un recorte no remuestrea: los píxeles son los de origen", () => {
    const img = C.componer([pngConCaja(7, 113, 211, 10, 20, 30, 30)]);
    const trozo = C.recortar(img, 10, 20, 30, 30);
    assert.deepStrictEqual(pixel(trozo, 15, 15), [7, 113, 211, 255]);
  });

  test("y uno que se sale avisa en vez de devolver basura", () => {
    const img = C.componer([]);
    assert.throws(() => C.recortar(img, 300, 10, 100, 10), RangeError);
    assert.throws(() => C.recortar(img, -1, 0, 10, 10), RangeError);
  });

  test("la caja del dibujo se calcula del arte, no a ojo", () => {
    // Así saldrán los quince recortes de las previsualizaciones: de
    // dónde está el dibujo de verdad, no de un rectángulo escrito a
    // mano que envejece en cuanto suba un modelo nuevo.
    const img = C.componer([pngConCaja(1, 2, 3, 40, 70, 25, 60)]);
    assert.deepStrictEqual(C.cajaDibujada(img), { x: 40, y: 70, ancho: 25, alto: 60 });
  });

  test("y de un lienzo vacío no hay caja", () => {
    assert.equal(C.cajaDibujada(C.componer([])), null);
  });

  // Un lienzo a mano: un rectangulo opaco, y lo que se le añada.
  function lienzoCon(puntos) {
    const img = { rgba: Buffer.alloc(327 * 504 * 4), ancho: 327, alto: 504 };
    const poner = (x, y, a) => { img.rgba[(y * 327 + x) * 4 + 3] = a; };
    for (let y = 100; y < 160; y++) for (let x = 120; x < 200; x++) poner(x, y, 255);
    for (const [x, y, a] of puntos) poner(x, y, a);
    return img;
  }

  test("con alfaMinimo, los restos casi invisibles no cuentan", () => {
    // Dos pelos del catalogo traian restos de alfa baja por todo el lienzo,
    // y su caja era el lienzo entero.
    const img = lienzoCon([[5, 5, 10], [320, 500, 10]]);
    assert.deepStrictEqual(C.cajaDibujada(img), { x: 5, y: 5, ancho: 316, alto: 496 });
    assert.deepStrictEqual(C.cajaDibujada(img, { alfaMinimo: 64 }), { x: 120, y: 100, ancho: 80, alto: 60 });
  });

  test("con recorte, un punto suelto lejos del dibujo tampoco", () => {
    const img = lienzoCon([[10, 490, 255]]);
    assert.deepStrictEqual(C.cajaDibujada(img, { recorte: 0.005 }), { x: 120, y: 100, ancho: 80, alto: 60 });
    // Y el recorte no se come el dibujo: 4800 pixeles, se ignoran 24 por
    // extremo, menos que una fila o una columna del rectangulo.
    assert.deepStrictEqual(C.cajaDibujada(lienzoCon([]), { recorte: 0.005 }), { x: 120, y: 100, ancho: 80, alto: 60 });
  });

});

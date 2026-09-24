// ==============================
// TESTS DE LLEVAR UN PNG AL LIENZO — tests/lienzo.test.js
// ==============================
// api/_lienzo.js descomprime un PNG, lo pone en el lienzo de 327x504 y
// lo vuelve a comprimir, sin librerías de imagen.
//
// Lo delicado no es que el resultado mida 327x504 —eso es una resta—,
// sino QUÉ se hace con los píxeles, porque se está tocando el trabajo
// del equipo de dibujo:
//
//   - El CALCO tiene que ser un calco. Si cambia un solo píxel de los
//     que sobreviven, ya no es "rellenar una fila": es remuestrear a
//     escondidas.
//   - Lo que se recorta tiene que estar VACÍO. Recortar una fila con
//     dibujo se come la punta de los pies y no se entera nadie.
//   - Al remuestrear, el alfa va premultiplicado. Sin eso aparece un
//     borde oscuro alrededor de cada prenda, y es el fallo clásico.
//   - Y guardar en paleta cuando se puede no es un capricho: un fondo en
//     color completo pesa el triple y se lo baja cada avatar que lo
//     lleve puesto.
//
// Correr:  npm test

require("./_aislar-datos");   // antes de api/: ver ese archivo

const { test, describe } = require("node:test");
const assert = require("node:assert");
const zlib = require("node:zlib");

const lienzo = require("../api/_lienzo");
const png = require("../api/_png");


// ------------------------------------------------------------------
// Fábricas de PNG, para no depender de ficheros del disco.
// ------------------------------------------------------------------

// Gris de 8 bits, un tono plano.
function pngGris(ancho, alto, tono) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8; ihdr[9] = 0;

  const fila = Buffer.concat([Buffer.from([0]), Buffer.alloc(ancho, tono)]);
  const crudo = Buffer.concat(Array.from({ length: alto }, () => fila));

  return png.escribirBloques([
    { tipo: "IHDR", datos: ihdr },
    { tipo: "IDAT", datos: zlib.deflateSync(crudo) },
    { tipo: "IEND", datos: Buffer.alloc(0) }
  ]);
}

// RGBA de 8 bits a partir de una función (x, y) -> [r, g, b, a].
function pngRGBA(ancho, alto, pintar) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8; ihdr[9] = 6;

  const filas = [];
  for (let y = 0; y < alto; y++) {
    const fila = Buffer.alloc(1 + ancho * 4);
    for (let x = 0; x < ancho; x++) {
      const [r, g, b, a] = pintar(x, y);
      fila[1 + x * 4] = r; fila[2 + x * 4] = g; fila[3 + x * 4] = b; fila[4 + x * 4] = a;
    }
    filas.push(fila);
  }

  return png.escribirBloques([
    { tipo: "IHDR", datos: ihdr },
    { tipo: "IDAT", datos: zlib.deflateSync(Buffer.concat(filas)) },
    { tipo: "IEND", datos: Buffer.alloc(0) }
  ]);
}

// De paleta, con los índices que se le den y un color transparente.
function pngPaleta(ancho, alto, indices, paleta, alfas, profundidad) {
  const prof = profundidad || 8;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = prof; ihdr[9] = 3;

  const porByte = 8 / prof;
  const bytesFila = Math.ceil(ancho / porByte);
  const filas = [];

  for (let y = 0; y < alto; y++) {
    const fila = Buffer.alloc(1 + bytesFila);
    for (let x = 0; x < ancho; x++) {
      const idx = indices[y * ancho + x];
      if (prof === 8) fila[1 + x] = idx;
      else {
        const pos = 1 + Math.floor(x / porByte);
        fila[pos] |= (idx & ((1 << prof) - 1)) << (8 - prof * ((x % porByte) + 1));
      }
    }
    filas.push(fila);
  }

  const bloques = [
    { tipo: "IHDR", datos: ihdr },
    { tipo: "PLTE", datos: paleta }
  ];
  if (alfas) bloques.push({ tipo: "tRNS", datos: alfas });
  bloques.push({ tipo: "IDAT", datos: zlib.deflateSync(Buffer.concat(filas)) });
  bloques.push({ tipo: "IEND", datos: Buffer.alloc(0) });

  return png.escribirBloques(bloques);
}

const alfaEn = (img, x, y) => img.rgba[(y * img.ancho + x) * 4 + 3];
const colorEn = (img, x, y) => Array.from(img.rgba.subarray((y * img.ancho + x) * 4, (y * img.ancho + x) * 4 + 4));


// ==============================

describe("leer los píxeles", () => {
  test("un gris plano se lee entero", () => {
    const img = lienzo.leerPixeles(pngGris(4, 3, 120));

    assert.equal(img.ancho, 4);
    assert.equal(img.alto, 3);
    assert.deepEqual(colorEn(img, 2, 1), [120, 120, 120, 255]);
  });

  test("un RGBA conserva el alfa", () => {
    const img = lienzo.leerPixeles(pngRGBA(2, 2, (x) => [10, 20, 30, x === 0 ? 0 : 255]));

    assert.equal(alfaEn(img, 0, 0), 0);
    assert.equal(alfaEn(img, 1, 0), 255);
  });

  test("uno de paleta sale como índices, no como color", () => {
    const paleta = Buffer.from([255, 0, 0, 0, 255, 0]);
    const img = lienzo.leerPixeles(pngPaleta(2, 1, [0, 1], paleta, Buffer.from([0, 255])));

    assert.ok(img.indices, "debería traer índices");
    assert.equal(img.indices[0], 0);
    assert.equal(img.indices[1], 1);
    assert.equal(img.alfas[0], 0, "el color 0 es el transparente");
  });

  test("una paleta de 4 bits se desempaqueta sola", () => {
    // Ocho archivos del catálogo venían así. Que se lean igual que los
    // de 8 bits es lo que hace que no haya que tratarlos aparte.
    const paleta = Buffer.from([0, 0, 0, 255, 255, 255, 9, 9, 9]);
    const img = lienzo.leerPixeles(pngPaleta(3, 1, [2, 1, 0], paleta, null, 4));

    assert.deepEqual(Array.from(img.indices), [2, 1, 0]);
  });

  test("lo que no se sabe leer se dice, no se adivina", () => {
    const entrelazado = (() => {
      const b = pngGris(2, 2, 10);
      const bloques = png.leerBloques(b);
      bloques[0].datos[12] = 1;   // Adam7
      return png.escribirBloques(bloques);
    })();

    assert.throws(() => lienzo.leerPixeles(entrelazado), /entrelazado/i);
  });
});


describe("el calco es un calco", () => {
  test("rellenar deja los píxeles de origen INTACTOS", () => {
    // Este es el test que sujeta toda la operación. Si el calco tocara
    // un solo píxel, dejaría de ser "rellenar una fila" y pasaría a ser
    // remuestrear a escondidas el trabajo de otra persona.
    const original = pngRGBA(4, 3, (x, y) => [x * 40, y * 60, 7, 255]);
    const img = lienzo.leerPixeles(original);
    const puesto = lienzo.pegar1a1(img, 5, 4);

    assert.equal(puesto.ancho, 5);
    assert.equal(puesto.alto, 4);

    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 4; x++) {
        assert.deepEqual(colorEn(puesto, x, y), colorEn(img, x, y),
          "el píxel " + x + "," + y + " cambió");
      }
    }
  });

  test("lo que se rellena queda transparente", () => {
    const img = lienzo.leerPixeles(pngRGBA(2, 2, () => [9, 9, 9, 255]));
    const puesto = lienzo.pegar1a1(img, 3, 3);

    assert.equal(alfaEn(puesto, 2, 0), 0, "la columna nueva");
    assert.equal(alfaEn(puesto, 0, 2), 0, "la fila nueva");
  });

  test("recortar se queda con la esquina de arriba a la izquierda", () => {
    const img = lienzo.leerPixeles(pngRGBA(4, 4, (x, y) => [x, y, 0, 255]));
    const puesto = lienzo.pegar1a1(img, 3, 3);

    assert.equal(puesto.ancho, 3);
    assert.deepEqual(colorEn(puesto, 2, 2), [2, 2, 0, 255]);
  });

  test("con paleta, se conserva la paleta", () => {
    // Que no se conserve significa salir en color completo, y eso
    // multiplica por cuatro el peso de casi todo el catálogo.
    const paleta = Buffer.from([255, 0, 0, 0, 0, 255]);
    const img = lienzo.leerPixeles(pngPaleta(2, 2, [0, 1, 1, 0], paleta, Buffer.from([0, 255])));
    const puesto = lienzo.pegar1a1(img, 3, 3);

    assert.ok(puesto.indices, "debería seguir siendo de paleta");
    assert.equal(puesto.indices[0], 0);
  });

  test("si no hay color transparente y hay que rellenar, se añade uno", () => {
    const paleta = Buffer.from([1, 2, 3, 4, 5, 6]);      // los dos opacos
    const img = lienzo.leerPixeles(pngPaleta(2, 2, [0, 1, 1, 0], paleta, null));
    const puesto = lienzo.pegar1a1(img, 3, 3);

    assert.equal(puesto.paleta.length, 9, "un color más en la paleta");
    assert.equal(puesto.alfas[2], 0, "y ese es el transparente");
    assert.equal(puesto.indices[2], 2, "el relleno usa ese índice");
  });
});


describe("qué se puede recortar sin perder nada", () => {
  test("una fila transparente sí", () => {
    const img = lienzo.leerPixeles(pngRGBA(3, 3, (x, y) => [9, 9, 9, y === 2 ? 0 : 255]));

    assert.equal(lienzo.recorteVacio(img, 3, 2), true);
  });

  test("una fila con dibujo NO, aunque sea de un solo color", () => {
    // El matiz que importa: "toda la fila igual" no es lo mismo que
    // "vacía". Una línea de color plano y opaco es dibujo.
    const img = lienzo.leerPixeles(pngRGBA(3, 3, () => [9, 9, 9, 255]));

    assert.equal(lienzo.recorteVacio(img, 3, 2), false);
  });

  test("si no se recorta nada, la respuesta es que sí", () => {
    const img = lienzo.leerPixeles(pngRGBA(2, 2, () => [1, 2, 3, 255]));

    assert.equal(lienzo.recorteVacio(img, 5, 5), true);
  });

  test("también mira las columnas de la derecha", () => {
    const img = lienzo.leerPixeles(pngRGBA(3, 3, (x) => [9, 9, 9, x === 2 ? 255 : 0]));

    assert.equal(lienzo.recorteVacio(img, 2, 3), false);
  });
});


describe("remuestrear", () => {
  test("sale del tamaño pedido", () => {
    const img = lienzo.leerPixeles(pngRGBA(10, 10, () => [100, 100, 100, 255]));
    const chico = lienzo.remuestrearPorArea(img, 3, 4);

    assert.equal(chico.ancho, 3);
    assert.equal(chico.alto, 4);
  });

  test("un color plano sigue siendo el mismo color plano", () => {
    const img = lienzo.leerPixeles(pngRGBA(9, 9, () => [80, 140, 200, 255]));
    const chico = lienzo.remuestrearPorArea(img, 3, 3);

    assert.deepEqual(colorEn(chico, 1, 1), [80, 140, 200, 255]);
  });

  test("el alfa va premultiplicado: nada de bordes oscuros", () => {
    // El fallo clásico. Media imagen blanca opaca y media transparente
    // con RGB negro: si se promedia sin premultiplicar, el negro
    // invisible tiñe el blanco y aparece un borde gris sucio alrededor
    // de cada prenda.
    const img = lienzo.leerPixeles(
      pngRGBA(4, 1, (x) => x < 2 ? [255, 255, 255, 255] : [0, 0, 0, 0])
    );

    // De 4 a 3 y no de 4 a 2: con 4 a 2 cada píxel de destino cae limpio
    // a un lado y no hay frontera que mirar. Con 4 a 3, el de en medio
    // cubre 1,33 a 2,67 y mezcla blanco opaco con transparente, que es
    // justo el caso que se quiere probar.
    const chico = lienzo.remuestrearPorArea(img, 3, 1);

    // El COLOR tiene que seguir siendo blanco y bajar solo el alfa.
    const [r, g, b, a] = colorEn(chico, 1, 0);
    assert.equal(r, 255, "el color no debe ensuciarse");
    assert.equal(g, 255);
    assert.equal(b, 255);
    assert.ok(a < 255 && a > 0, "lo que baja es el alfa, no el color");
  });

  test("lo totalmente transparente se queda transparente", () => {
    const img = lienzo.leerPixeles(pngRGBA(4, 4, () => [0, 0, 0, 0]));
    const chico = lienzo.remuestrearPorArea(img, 2, 2);

    assert.equal(alfaEn(chico, 0, 0), 0);
  });
});


describe("el encaje, igual que el taller", () => {
  test("el factor es el mismo que vestFactorContain", () => {
    // min(327/ancho, 504/alto). Si esto se separa de
    // js/arte-vestidor.js, el catálogo y el taller dejan de encuadrar
    // igual y nadie se entera hasta que una prenda baila.
    assert.equal(lienzo.factorContain(654, 1008), Math.min(327 / 654, 504 / 1008));
    assert.equal(lienzo.factorContain(1919, 1079), Math.min(327 / 1919, 504 / 1079));
  });

  test("lo apaisado queda centrado y con margen arriba y abajo", () => {
    const img = lienzo.leerPixeles(pngRGBA(100, 10, () => [200, 50, 50, 255]));
    const puesto = lienzo.encajarContain(img, 327, 504);

    assert.equal(puesto.ancho, 327);
    assert.equal(puesto.alto, 504);
    assert.equal(alfaEn(puesto, 160, 0), 0, "arriba tiene que sobrar");
    assert.equal(alfaEn(puesto, 160, 503), 0, "y abajo también");
    assert.ok(alfaEn(puesto, 160, 252) > 0, "y el dibujo va en medio");
  });

  test("no se deforma: se conserva la proporción", () => {
    const img = lienzo.leerPixeles(pngRGBA(200, 100, () => [1, 2, 3, 255]));
    const puesto = lienzo.encajarContain(img, 327, 504);

    // 200x100 con k = 327/200 da 327x163,5 -> el dibujo ocupa el ancho
    // entero y deja margen vertical, no al revés.
    assert.ok(alfaEn(puesto, 0, 252) > 0 || alfaEn(puesto, 1, 252) > 0);
    assert.equal(alfaEn(puesto, 163, 10), 0);
  });
});


describe("guardar de la forma que menos pese", () => {
  test("pocos colores salen en paleta, y el dibujo es el mismo", () => {
    const original = pngRGBA(20, 20, (x) => x < 10 ? [255, 0, 0, 255] : [0, 0, 255, 128]);
    const img = lienzo.leerPixeles(original);
    const guardado = lienzo.escribirAjustado(img);

    assert.equal(png.leerCabecera(guardado).tipoColor, 3, "debería ser de paleta");

    const vuelta = lienzo.aRGBA(lienzo.leerPixeles(guardado));
    assert.deepEqual(colorEn(vuelta, 2, 2), [255, 0, 0, 255]);
    assert.deepEqual(colorEn(vuelta, 15, 2), [0, 0, 255, 128]);
  });

  test("muchos colores salen en color completo", () => {
    // Un degradado de verdad no cabe en 256, y forzarlo sería inventarse
    // colores. Mejor pesar más que mentir.
    const img = lienzo.leerPixeles(
      pngRGBA(40, 40, (x, y) => [x * 6, y * 6, (x * y) % 256, 255])
    );
    const guardado = lienzo.escribirAjustado(img);

    assert.equal(png.leerCabecera(guardado).tipoColor, 6);
  });

  test("los transparentes de distinto color cuentan como uno", () => {
    // Hay dibujos con varios negros invisibles. Sin juntarlos llenan la
    // paleta para nada.
    const img = lienzo.leerPixeles(
      pngRGBA(30, 30, (x, y) => [(x * 7) % 256, (y * 7) % 256, 0, 0])
    );
    const guardado = lienzo.escribirAjustado(img);

    assert.equal(png.leerCabecera(guardado).tipoColor, 3);
  });
});


describe("llevarAlLienzo elige solo", () => {
  test("lo que ya mide 327x504 no se toca", () => {
    const original = pngGris(327, 504, 40);
    const res = lienzo.llevarAlLienzo(original);

    assert.equal(res.metodo, "ya-estaba");
    assert.ok(res.binario.equals(original), "ni un byte");
  });

  test("a un píxel y con el borde vacío: calco", () => {
    const original = pngRGBA(327, 505, (x, y) => [1, 2, 3, y === 504 ? 0 : 255]);
    const res = lienzo.llevarAlLienzo(original);

    assert.equal(res.metodo, "calco");
    assert.equal(res.exacto, true);
    assert.equal(png.leerCabecera(res.binario).alto, 504);
  });

  test("a un píxel pero con dibujo en la fila: estirado", () => {
    // Los doce fondos del catálogo. Se estira en vez de encajar para no
    // dejar una franja transparente en el borde del avatar.
    const original = pngRGBA(327, 505, () => [1, 2, 3, 255]);
    const res = lienzo.llevarAlLienzo(original);

    assert.equal(res.metodo, "estirado");
    const cab = png.leerCabecera(res.binario);
    assert.equal(cab.ancho, 327);
    assert.equal(cab.alto, 504);

    // Y sin franja: el borde de al lado sigue pintado.
    const puesto = lienzo.aRGBA(lienzo.leerPixeles(res.binario));
    assert.ok(alfaEn(puesto, 0, 250) > 0, "no puede quedar una columna vacía");
    assert.ok(alfaEn(puesto, 326, 250) > 0);
  });

  test("con otra proporción: encaje", () => {
    const res = lienzo.llevarAlLienzo(pngRGBA(500, 500, () => [5, 5, 5, 255]));

    assert.equal(res.metodo, "encaje");
    assert.equal(res.exacto, false);
    assert.ok(res.factor < 1);
  });

  test("siempre sale 327x504, venga de donde venga", () => {
    for (const [w, h] of [[326, 503], [327, 505], [654, 1010], [1919, 1079], [478, 158], [332, 512]]) {
      const res = lienzo.llevarAlLienzo(pngRGBA(w, h, () => [7, 7, 7, 255]));
      const cab = png.leerCabecera(res.binario);

      assert.equal(cab.ancho, 327, w + "x" + h);
      assert.equal(cab.alto, 504, w + "x" + h);
    }
  });

  test("lo que sale se puede volver a leer", () => {
    // Obvio hasta que no lo es: si el PNG que se escribe no se puede
    // decodificar, el navegador enseña un hueco y la base ya guardó la
    // versión rota.
    const res = lienzo.llevarAlLienzo(pngRGBA(326, 503, (x, y) => [x % 256, y % 256, 0, 255]));
    const vuelta = lienzo.leerPixeles(res.binario);

    assert.equal(vuelta.ancho, 327);
    assert.equal(vuelta.alto, 504);
  });
});

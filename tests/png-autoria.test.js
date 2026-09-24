// ==============================
// TESTS DEL PNG A MANO — tests/png-autoria.test.js
// ==============================
// api/_png.js lee y escribe los bloques de un PNG sin instalar nada.
// Es la regla de la casa: cuatro dependencias y ninguna de imagen. Lo
// mismo que ya obligó a sustituir el canvas por un falso en
// tests/vestidor-horneado.test.js antes que traerse node-canvas.
//
// Lo que se prueba acá, y por qué importa cada cosa:
//
//   - Ida y vuelta EXACTA. Si leer y reescribir un PNG no devuelve los
//     mismos bytes, el módulo no sirve para tocar las 630 prendas: cada
//     pasada cambiaría la huella, y la huella es la URL.
//
//   - La autoría se puede volver a leer. De nada sirve meterla si
//     después no hay forma de demostrar que está.
//
//   - Es idempotente. El horno se va a correr más de una vez; si cada
//     pasada añadiera otro bloque Author, el fichero engordaría sin
//     parar y la huella cambiaría cada vez.
//
//   - No se traga un fichero cortado. Esto va a comer PNG subidos por
//     gente desde arte.html.
//
// Correr:  npm test

require("./_aislar-datos");   // antes de api/: ver ese archivo

const { test, describe } = require("node:test");
const assert = require("node:assert");
const zlib = require("node:zlib");

const png = require("../api/_png");

// Un PNG de un píxel, de verdad, generado a mano. Sirve de base para
// todo lo demás y no depende de que haya ficheros en el disco.
const UNO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const AUTORIA = {
  Author: "Equipo de arte de MacroReborn",
  Copyright: "(c) MacroReborn",
  Source: "https://www.macroreborn.com/"
};


describe("leer los bloques", () => {
  test("un PNG de verdad se parte en sus bloques", () => {
    const bloques = png.leerBloques(UNO);

    assert.equal(bloques[0].tipo, "IHDR");
    assert.equal(bloques[bloques.length - 1].tipo, "IEND");
    assert.ok(bloques.some(b => b.tipo === "IDAT"), "debería tener píxeles");
  });

  test("las medidas y el formato salen del IHDR", () => {
    const c = png.leerCabecera(UNO);

    assert.equal(c.ancho, 1);
    assert.equal(c.alto, 1);
    assert.equal(c.profundidad, 8);
    assert.equal(c.entrelazado, 0);
  });

  test("lo que no es un PNG se rechaza por la firma, no por el nombre", () => {
    assert.equal(png.esPNG(Buffer.from("GIF89a y lo que sea")), false);
    assert.throws(() => png.leerBloques(Buffer.from("no soy un png")), /firma/i);
  });

  test("un PNG cortado no tumba el proceso", () => {
    // Pasa de verdad con una subida a medias desde arte.html.
    assert.throws(() => png.leerBloques(UNO.subarray(0, 30)), /cortado|IHDR/i);
  });
});


describe("ida y vuelta", () => {
  test("leer y reescribir devuelve los MISMOS bytes", () => {
    // Este es el test que sujeta todo lo demás. Si esto falla, cada
    // pasada del horno cambiaría la huella de las 630 prendas, y la
    // huella es la URL: todo el mundo redescargando el catálogo por
    // nada.
    const vuelta = png.escribirBloques(png.leerBloques(UNO));

    assert.ok(vuelta.equals(UNO), "la ida y vuelta debe ser exacta");
  });

  test("el CRC que se escribe es el que el PNG lleva dentro", () => {
    // Si el CRC se calculara mal, un visor estricto daría el fichero por
    // corrupto. Se compara con el que ya traía el IHDR original.
    const crcOriginal = UNO.readUInt32BE(8 + 4 + 4 + 13);
    const ihdr = png.leerBloques(UNO)[0];
    const calculado = png.crc32(Buffer.concat([Buffer.from("IHDR", "latin1"), ihdr.datos]));

    assert.equal(calculado, crcOriginal);
  });
});


describe("la autoría", () => {
  test("se mete y se vuelve a leer", () => {
    const firmado = png.ponerAutoria(UNO, AUTORIA);
    const leida = png.leerAutoria(firmado);

    assert.equal(leida.Author, AUTORIA.Author);
    assert.equal(leida.Copyright, AUTORIA.Copyright);
    assert.equal(leida.Source, AUTORIA.Source);
  });

  test("el PNG sigue siendo válido y los píxeles no se tocan", () => {
    const firmado = png.ponerAutoria(UNO, AUTORIA);

    const antes = png.leerBloques(UNO).filter(b => b.tipo === "IDAT");
    const despues = png.leerBloques(firmado).filter(b => b.tipo === "IDAT");

    assert.equal(despues.length, antes.length);
    assert.ok(despues[0].datos.equals(antes[0].datos), "los píxeles son los mismos");
    assert.equal(png.leerBloques(firmado)[0].tipo, "IHDR", "IHDR sigue primero");
  });

  test("va después del IHDR, no al final", () => {
    const bloques = png.leerBloques(png.ponerAutoria(UNO, AUTORIA));

    assert.equal(bloques[1].tipo, "tEXt");
  });

  test("dos pasadas dejan el mismo fichero", () => {
    // El horno se va a correr más de una vez. Sin esto, cada pasada
    // añadiría otro Author y la huella cambiaría para siempre.
    const una = png.ponerAutoria(UNO, AUTORIA);
    const dos = png.ponerAutoria(una, AUTORIA);

    assert.ok(dos.equals(una));
  });

  test("cambiar la autoría reemplaza, no acumula", () => {
    const una = png.ponerAutoria(UNO, AUTORIA);
    const otra = png.ponerAutoria(una, { ...AUTORIA, Author: "Otra persona" });

    assert.equal(png.leerAutoria(otra).Author, "Otra persona");
    const autores = png.leerBloques(otra).filter(b => {
      const fin = b.datos.indexOf(0);
      return (b.tipo === "tEXt" || b.tipo === "iTXt") &&
             b.datos.toString("latin1", 0, fin) === "Author";
    });
    assert.equal(autores.length, 1, "no puede haber dos Author");
  });

  test("los acentos y las eñes sobreviven", () => {
    // tEXt es latin1 y se comería un acento. Para eso está iTXt, que es
    // UTF-8, y el módulo lo elige solo cuando hace falta.
    const conEnies = { Author: "Diseño y dibujo: el equipo de años atrás ✎" };
    const leida = png.leerAutoria(png.ponerAutoria(UNO, conEnies));

    assert.equal(leida.Author, conEnies.Author);
  });

  test("un campo vacío no deja un bloque vacío dentro", () => {
    const leida = png.leerAutoria(png.ponerAutoria(UNO, { Author: "Alguien", Copyright: "" }));

    assert.equal(leida.Author, "Alguien");
    assert.ok(!("Copyright" in leida));
  });
});


describe("lo que un visor de verdad va a encontrarse", () => {
  test("el fichero firmado se puede descomprimir igual que el original", () => {
    // La prueba de que no se rompió nada por dentro: los IDAT del
    // firmado se inflan sin error y dan los mismos bytes.
    const firmado = png.ponerAutoria(UNO, AUTORIA);

    const juntar = (b) => Buffer.concat(
      png.leerBloques(b).filter(x => x.tipo === "IDAT").map(x => x.datos)
    );

    const crudoAntes = zlib.inflateSync(juntar(UNO));
    const crudoDespues = zlib.inflateSync(juntar(firmado));

    assert.ok(crudoDespues.equals(crudoAntes));
  });
});

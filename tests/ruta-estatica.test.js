// ==============================
// RESOLUCIÓN DE LA RUTA ESTÁTICA — tests/ruta-estatica.test.js
// ==============================
// Dos agujeros reales, los dos por la misma causa: la ruta con la que
// server.js decidía no era la misma con la que abría el archivo.
//
// 1. Una barra de más sacaba el arte de los avatares. Medido contra
//    producción el 18/09/2026: /imagenes/tora/pelo3.png daba 404 y
//    /imagenes//tora/pelo3.png daba 200 con el mismo sha256 que el
//    fichero del repositorio. `esPrendaDeAvatar()` no reconocía la
//    barra doble; `path.join` sí la colapsaba.
//
// 2. Una URL con una secuencia percent válida en sintaxis pero inválida
//    en UTF-8 (%C0%80) mataba el proceso. Reproducido: el servidor
//    terminaba con código 1 y dejaba de atender. Con dos procesos en
//    cluster y `Restart=always`, un GET en bucle era el sitio caído.
//
// Se prueba la función real importada, no un trozo de server.js leído y
// evaluado: requerir server.js arrancaría un servidor. Es la misma razón
// por la que traducirRutaCanonica vive en su propio módulo (ver el
// comentario de tests/ruta-canonica.test.js).
//
// Correr:  npm test

require("./_aislar-datos");   // antes de api/: ver ese archivo

const { test, describe } = require("node:test");
const assert = require("node:assert");

const { resolverRutaEstatica } = require("../api/_ruta-estatica");

describe("resolverRutaEstatica: rutas normales", () => {
  test("la raíz se traduce a index.html", () => {
    assert.deepEqual(resolverRutaEstatica("/"), { ok: true, ruta: "/index.html" });
  });

  test("una página se deja como está", () => {
    assert.deepEqual(resolverRutaEstatica("/perfil.html"), { ok: true, ruta: "/perfil.html" });
  });

  test("un script se deja como está", () => {
    assert.deepEqual(resolverRutaEstatica("/js/core.js"), { ok: true, ruta: "/js/core.js" });
  });

  test("los porcentajes válidos se decodifican", () => {
    assert.deepEqual(
      resolverRutaEstatica("/imagenes/juegos/mario%20kart.jpg"),
      { ok: true, ruta: "/imagenes/juegos/mario kart.jpg" }
    );
  });
});

describe("resolverRutaEstatica: la barra de más", () => {
  // Esto es lo que sacaba el arte. Si alguna de estas tres deja de dar
  // la ruta colapsada, el agujero está reabierto.
  test("la barra doble al principio del segmento se colapsa", () => {
    assert.equal(
      resolverRutaEstatica("/imagenes//tora/pelo3.png").ruta,
      "/imagenes/tora/pelo3.png"
    );
  });

  test("la barra doble en medio se colapsa", () => {
    assert.equal(
      resolverRutaEstatica("/imagenes/tora//pelo3.png").ruta,
      "/imagenes/tora/pelo3.png"
    );
  });

  test("varias barras seguidas también", () => {
    assert.equal(
      resolverRutaEstatica("/imagenes////tora///pelo3.png").ruta,
      "/imagenes/tora/pelo3.png"
    );
  });

  test("el punto de en medio se colapsa", () => {
    assert.equal(
      resolverRutaEstatica("/imagenes/./tora/pelo3.png").ruta,
      "/imagenes/tora/pelo3.png"
    );
  });

  test("el dos puntos se resuelve antes de decidir", () => {
    assert.equal(
      resolverRutaEstatica("/imagenes/cereza/../tora/pelo3.png").ruta,
      "/imagenes/tora/pelo3.png"
    );
  });

  test("subir por encima de la raíz no deja una ruta relativa suelta", () => {
    // Importante para la comprobación startsWith(RAIZ) de server.js: lo
    // que salga de aquí tiene que seguir siendo absoluto.
    const ruta = resolverRutaEstatica("/../../etc/passwd").ruta;
    assert.equal(ruta, "/etc/passwd");
    assert.ok(ruta.startsWith("/"), "la ruta resuelta tiene que seguir siendo absoluta");
  });
});

describe("resolverRutaEstatica: URLs que no se pueden decodificar", () => {
  // Cada una de estas mataba el proceso. Ahora quien llama responde 400.
  const malas = [
    ["%C0%80", "codificación sobrelarga del nulo"],
    ["%E0%80%AF", "codificación sobrelarga de la barra"],
    ["%ED%A0%80", "mitad alta de un par suplente UTF-16"],
    ["%FF", "byte que no empieza ninguna secuencia válida"],
    ["%", "porcentaje suelto al final"],
    ["%zz", "porcentaje sin hexadecimal detrás"]
  ];

  for (const [secuencia, nota] of malas) {
    test(`/${secuencia} no lanza y se rechaza (${nota})`, () => {
      let resultado;

      assert.doesNotThrow(() => {
        resultado = resolverRutaEstatica("/" + secuencia);
      }, `/${secuencia} volvió a lanzar: eso tumba el proceso`);

      assert.equal(resultado.ok, false);
      assert.equal(resultado.ruta, undefined);
    });
  }

  test("una ruta mal formada en medio de una buena también se rechaza", () => {
    assert.equal(resolverRutaEstatica("/js/%C0%80/core.js").ok, false);
  });
});

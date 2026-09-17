// ==============================
// TESTS DE LA RUTA CANÓNICA DE PRENDAS — tests/ruta-canonica.test.js
// ==============================
// /prendas/<huella sha256>.png es la URL buena de una prenda: lleva la
// huella del contenido, así que puede cachearse un año de verdad.
//
// Durante un tiempo esa ruta solo existió como `rewrite` en la
// configuración de nginx. Eso dejaba el sitio dependiendo de nginx para
// algo que es parte de la aplicación: con `node server.js` a pelo —el
// flujo que documenta el README para trabajar en local— todas esas
// imágenes daban 404.
//
// Ahora la traduce server.js. Esto lo prueba leyendo la función real del
// disco, no una copia, así que si alguien la cambia estos tests se
// enteran.
//
// Correr:  npm test

const { test, describe } = require("node:test");
const assert = require("node:assert");

// Se usa la función real, importada.
//
// Antes esto se sacaba de server.js leyendo el archivo y evaluando un
// trozo en una vm. Dejó de funcionar el día que la función se mudó a su
// propio módulo —que es lo que hubo que hacer para que el servidor de
// desarrollo la compartiera— y el test se rompió sin que nada estuviera
// mal. Un require no tiene ese problema.
const { traducirRutaCanonica: traducir } = require("../api/_prendas-ruta");

const HUELLA = "a".repeat(64);
const OTRA_HUELLA = "0123456789abcdef".repeat(4);

const url = ruta => new URL(ruta, "http://localhost");

describe("traducir /prendas/<huella>.png", () => {
  test("una huella válida se convierte en la llamada de API", () => {
    const u = url("/prendas/" + HUELLA + ".png");

    assert.equal(traducir(u), true);
    assert.equal(u.pathname, "/api/content");
    assert.equal(u.searchParams.get("action"), "avatar-prenda");
    assert.equal(u.searchParams.get("v"), HUELLA);
  });

  test("una huella con dígitos y letras también", () => {
    const u = url("/prendas/" + OTRA_HUELLA + ".png");

    assert.equal(traducir(u), true);
    assert.equal(u.searchParams.get("v"), OTRA_HUELLA);
  });

  test("la ruta de siempre no se toca: la sirve el otro camino", () => {
    const u = url("/imagenes/cereza/fondo40.png");

    assert.equal(traducir(u), false);
    assert.equal(u.pathname, "/imagenes/cereza/fondo40.png");
  });

  test("una página normal no se toca", () => {
    const u = url("/perfil.html");

    assert.equal(traducir(u), false);
    assert.equal(u.pathname, "/perfil.html");
  });
});

describe("lo que NO es una huella se queda fuera", () => {
  // Sin este filtro, /prendas/ se convertiría en una vía para mandarle
  // texto arbitrario a la consulta de la base.
  test("demasiado corta", () => {
    assert.equal(traducir(url("/prendas/abc.png")), false);
  });

  test("63 caracteres, uno menos de la cuenta", () => {
    assert.equal(traducir(url("/prendas/" + "a".repeat(63) + ".png")), false);
  });

  test("65 caracteres, uno más", () => {
    assert.equal(traducir(url("/prendas/" + "a".repeat(65) + ".png")), false);
  });

  test("en mayúsculas no vale: las huellas se guardan en minúscula", () => {
    assert.equal(traducir(url("/prendas/" + "A".repeat(64) + ".png")), false);
  });

  test("con caracteres que no son hexadecimales", () => {
    assert.equal(traducir(url("/prendas/" + "z".repeat(64) + ".png")), false);
  });

  test("sin la extensión .png", () => {
    assert.equal(traducir(url("/prendas/" + HUELLA)), false);
  });

  test("con una carpeta por medio", () => {
    assert.equal(traducir(url("/prendas/otra/" + HUELLA + ".png")), false);
  });
});

describe("no se puede colar otra acción por la query", () => {
  // La ruta la fija el servidor, no quien pide. Si alguien manda
  // ?action=borrar-todo, se le pisa.
  test("un action que venga en la URL se pisa", () => {
    const u = url("/prendas/" + HUELLA + ".png?action=avatar-panel");

    assert.equal(traducir(u), true);
    assert.equal(u.searchParams.get("action"), "avatar-prenda");
  });

  test("una v que venga en la URL se pisa con la de la ruta", () => {
    const u = url("/prendas/" + HUELLA + ".png?v=" + OTRA_HUELLA);

    assert.equal(traducir(u), true);
    assert.equal(u.searchParams.get("v"), HUELLA);
  });
});

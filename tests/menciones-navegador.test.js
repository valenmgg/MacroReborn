// ==============================
// EL NAVEGADOR YA NO NOTIFICA MENCIONES DE COMENTARIOS — tests/menciones-navegador.test.js
// ==============================
// La notificación de una mención en un comentario de perfil la crea el
// servidor al guardar el comentario (notificarMencionesServidor, en
// api/content.js) desde el 19/08/2026. js/perfil.js la creaba también,
// desde el navegador, y cada mención llegaba dos veces.
//
// Esto sujeta que no vuelva: si alguien recupera la llamada en
// js/perfil.js, esta prueba se entera. Chat y reseñas siguen creando la
// suya desde el navegador a propósito, porque el servidor todavía no lo
// hace por ellos; el día que lo haga, hay que sumarlos aquí.
//
// Correr:  npm test

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const leer = (ruta) => fs.readFileSync(path.join(__dirname, "..", ruta), "utf8");

describe("quién crea la notificación de una mención", () => {

  test("los comentarios de perfil no la crean desde el navegador", () => {
    const fuente = leer("js/perfil.js");
    const llamadas = (fuente.match(/notificarMenciones\s*\(/g) || []).length;
    assert.equal(llamadas, 0, "js/perfil.js vuelve a llamar a notificarMenciones(): la mención llegaría dos veces");
  });

  test("el servidor sí, al guardar el comentario", () => {
    const fuente = leer("api/content.js");
    assert.match(fuente, /notificarMencionesServidor\(/);
  });

  test("y el chat y las reseñas siguen creándola desde el navegador, de momento", () => {
    // No es lo ideal, pero es lo que hay: sin esto, nadie se enteraría
    // de una mención en el chat. Cuando el servidor lo cubra, esta
    // prueba tiene que darse la vuelta.
    assert.match(leer("js/chat.js"), /notificarMenciones\s*\(/);
    assert.match(leer("js/resenas.js"), /notificarMenciones\s*\(/);
  });

});

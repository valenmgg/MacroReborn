// ==============================
// LAS PÁGINAS MIGRADAS NO DIBUJAN POR CAPAS — tests/paginas-sin-capas.test.js
// ==============================
// Fase 3 de docs/AVATARES-SERVIDOR.md. Cada página que pinta avatares
// de otras personas pasa, una por una, a pedir una sola imagen por
// persona con imagenDeAvatar() de js/core.js: su PNG de administrador,
// su compuesto o la silueta.
//
// Una página migrada no puede volver a pedir prendas sueltas sin que
// esto lo diga: es justo lo que la fase 5 va a cerrar, y lo que no
// tiene que salir del equipo de arte. La lista crece con cada página.
//
// Correr:  npm test

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const leer = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

// Archivo -> desde cuándo.
const MIGRADOS = {
  "js/comunidad-ranking.js": "2026-09-24",
  "js/usuario.js": "2026-09-24",
  "js/usuario-actividad.js": "2026-09-24"
};

// Lo que delata que se está dibujando prenda por prenda. La ruta de
// las prendas cuenta solo dentro de una cadena: en un comentario que
// explica lo que se hacía antes no pide nada.
const RASTROS = [/ORDEN_CAPAS_AVATAR/, /rutaCapaAvatar/, /rutaImagenCapa/, /data-capas/, /RK_ORDEN_CAPAS/,
                 /["'`]\/prendas\//];

describe("las páginas migradas", () => {

  for (const archivo of Object.keys(MIGRADOS)) {
    test(archivo + " no dibuja por capas", () => {
      const texto = leer(archivo);
      for (const rastro of RASTROS) {
        assert.ok(!rastro.test(texto), archivo + " todavía usa " + rastro);
      }
    });

    test(archivo + " pide la imagen con imagenDeAvatar", () => {
      assert.match(leer(archivo), /imagenDeAvatar\(|imagenAvatarPerfil\(/);
    });
  }

});

describe("el perfil público", () => {

  test("los comentarios y la actividad le pasan la persona de la memoria", () => {
    // Sin ella imagenDeAvatar no sabe de quién es, y sale la silueta
    // aunque lleve ropa.
    const usuario = leer("js", "usuario.js");
    const actividad = leer("js", "usuario-actividad.js");
    assert.match(usuario, /imagenAvatarPerfil\(obtenerAvatarCacheado\(nombre\), obtenerPersonaCacheada\(nombre\)/);
    assert.match(actividad, /imagenAvatarPerfil\(obtenerAvatarCacheado\(nombre\), obtenerPersonaCacheada\(nombre\)/);
  });

  test("el avatar grande pide el tamaño grande, y los amigos el pequeño", () => {
    const usuario = leer("js", "usuario.js");
    assert.match(usuario, /imagenAvatarPerfil\(usuario\.avatar, usuario, 327, 504\)/);
    assert.match(usuario, /imagenAvatarPerfil\(amigo\.avatar, amigo, 62, 96\)/);
  });

  test("y usuario.js se carga antes que la actividad, que usa su ayudante", () => {
    const html = leer("usuario.html");
    const i = html.indexOf('src="js/usuario.js');
    const j = html.indexOf('src="js/usuario-actividad.js');
    assert.ok(i !== -1 && j > i, "usuario-actividad.js tiene que ir después de usuario.js");
  });

});

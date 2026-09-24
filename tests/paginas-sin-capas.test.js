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
  "js/usuario-actividad.js": "2026-09-24",
  "js/usuario-avatares-galeria.js": "2026-09-24",
  "js/actividad-comunidad.js": "2026-09-24",
  "js/resenas.js": "2026-09-24",
  "js/buscador.js": "2026-09-24",
  "js/explorar.js": "2026-09-24",
  "js/amigos.js": "2026-09-24",
  "js/chat.js": "2026-09-24",
  "js/home-portal.js": "2026-09-24",
  "index.html": "2026-09-24",
  "js/perfil-actividad.js": "2026-09-24"
};

// Lo que delata que se está dibujando prenda por prenda. La ruta de
// las prendas cuenta solo dentro de una cadena: en un comentario que
// explica lo que se hacía antes no pide nada.
//
// avatarMiniaturaHTML() de js/core.js con un solo argumento también:
// sin la persona no sabe de quién es, y dibuja por capas.
const RASTROS = [/ORDEN_CAPAS_AVATAR/, /rutaCapaAvatar/, /rutaImagenCapa/, /data-capas/, /RK_ORDEN_CAPAS/,
                 /["'`]\/prendas\//, /avatarMiniaturaHTML\([^,()]+\)/];

describe("las páginas migradas", () => {

  for (const archivo of Object.keys(MIGRADOS)) {
    test(archivo + " no dibuja por capas", () => {
      const texto = leer(archivo);
      for (const rastro of RASTROS) {
        assert.ok(!rastro.test(texto), archivo + " todavía usa " + rastro);
      }
    });

    test(archivo + " pide la imagen con imagenDeAvatar", () => {
      // O con avatarMiniaturaHTML y la persona, que la usa por dentro.
      assert.match(leer(archivo), /imagenDeAvatar\(|imagenAvatarPerfil\(|avatarMiniaturaHTML\([^,()]+,\s*\w+\)/);
    });
  }

});

describe("la actividad de la comunidad", () => {

  test("pasa usuario_id, que es el id de la persona en una actividad", () => {
    const js = leer("js", "actividad-comunidad.js");
    assert.match(js, /\{ id: item\.usuario_id, avatar_compuesto: item\.avatar_compuesto \}/);
    // Y ya no pinta con avatarMiniaturaHTML sin persona, que dibuja por capas.
    assert.ok(!/avatarMiniaturaHTML\(avatar\)/.test(js));
  });

});

describe("el perfil propio", () => {

  // js/perfil.js no entra en la lista de arriba: el editor sigue
  // dibujando por capas hasta la fase 5. Lo que ya no lo hace son sus
  // tres funciones que pintan avatares fuera del editor.
  const PERFIL = leer("js", "perfil.js");
  const cuerpo = nombre => {
    const i = PERFIL.search(new RegExp("(async )?function " + nombre + "\\("));
    assert.ok(i !== -1, "no está " + nombre);
    return PERFIL.slice(i, i + PERFIL.slice(i).search(/\r?\n}\r?\n/));
  };

  for (const nombre of ["actualizarAvatarPrincipal", "renderAmigosPerfil", "obtenerAvatarComentario"]) {
    test(nombre + " pide una sola imagen, sin capas", () => {
      const texto = cuerpo(nombre);
      assert.match(texto, /imagenDeAvatar\(/);
      for (const rastro of ["rutaDePrenda", "ORDEN_CAPAS", "data-capas", "avatar-compuesto"]) {
        assert.ok(!texto.includes(rastro), nombre + " todavía usa " + rastro);
      }
    });
  }

  test("el avatar grande es el guardado, en el tamaño grande", () => {
    assert.match(cuerpo("actualizarAvatarPrincipal"),
      /imagenDeAvatar\(datosUsuario\.avatar, datosUsuario, 327, 504\)/);
  });

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

  test("la galería pide el compuesto de cada ranura, con el id del dueño", () => {
    const galeria = leer("js", "usuario-avatares-galeria.js");
    assert.match(galeria, /\{ id: idDelDueno, ranura: fila\.slot, avatar_compuesto: fila\.avatar_compuesto \}/);
    assert.match(galeria, /idDelDueno = datos\.usuario_id/);
    assert.match(galeria, /imagenDeAvatar\(fila\.avatar, ranura, 327, 504\)/);
  });

  test("y usuario.js se carga antes que la actividad, que usa su ayudante", () => {
    const html = leer("usuario.html");
    const i = html.indexOf('src="js/usuario.js');
    const j = html.indexOf('src="js/usuario-actividad.js');
    assert.ok(i !== -1 && j > i, "usuario-actividad.js tiene que ir después de usuario.js");
  });

});

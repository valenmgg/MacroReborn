// ==============================
// AVATARES PNG SIN SU BASE64 — tests/avatar-ligero.test.js
// ==============================
// Un avatar subido como PNG guarda la imagen entera en base64 dentro de
// users.avatar, y esa columna viaja en cualquier consulta que la
// seleccione. Una sola cuenta puede convertir una lista en un megabyte.
//
// Pasó dos veces con el mismo tamaño:
//
//   /api/users            1,35 MB, 1,31 MB era una cuenta   (arreglado en ca518e6)
//   /api/social?friends   1,35 MB, 1,31 MB era una cuenta   (se quedó sin arreglar)
//
// El recorte son DOS piezas y hacen falta las dos:
//
//   1. fragmentoAvatarLigero(sql) deja una "huella" en vez del base64.
//   2. aligerarAvatarPNG() convierte esa huella en la URL del puntero.
//
// Hacer solo la 1 cambia un problema de peso por uno de que no se ve
// nada: el frontend recibe {tipo:"png", huella:"..."} y avatarPNGData()
// devuelve null. No es hipotético, se soltó así en producción al añadir
// ?ligero=1 a la lectura de un usuario suelto.
//
// Correr:  npm test

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { fragmentoAvatarLigero, aligerarAvatarPNG } = require("../api/_avatar-ligero");

const RAIZ = path.join(__dirname, "..");

// ==============================

describe("la huella se convierte en la URL del puntero", () => {
  test("un avatar PNG con huella sale como url", () => {
    const r = aligerarAvatarPNG({
      username: "Samuel488",
      avatar: { tipo: "png", huella: "de31f2fad436", restaurar: { pelo: "max_pelo1" } }
    });

    assert.equal(r.avatar.tipo, "png");
    assert.equal(r.avatar.url,
      "/api/users?action=avatar-png&username=Samuel488&v=de31f2fad436");
    assert.equal(r.avatar.src, undefined, "el base64 no debe seguir ahí");
  });

  test("la receta para volver al avatar normal se conserva", () => {
    const restaurar = { modelo: "max", pelo: "max_pelo1" };
    const r = aligerarAvatarPNG({ username: "x", avatar: { tipo: "png", huella: "abc", restaurar } });

    assert.deepEqual(r.avatar.restaurar, restaurar);
  });

  test("un nombre con caracteres raros va codificado", () => {
    const r = aligerarAvatarPNG({ username: "Bianca♡", avatar: { tipo: "png", huella: "abc" } });

    assert.ok(r.avatar.url.includes(encodeURIComponent("Bianca♡")));
    assert.ok(!r.avatar.url.includes("♡"), "sin codificar rompería la URL");
  });

  test("sirve igual si el campo se llama nombre en vez de username", () => {
    const r = aligerarAvatarPNG({ nombre: "Lucass", avatar: { tipo: "png", huella: "abc" } });

    assert.ok(r.avatar.url.includes("username=Lucass"));
  });

  test("un jsonb que llega como texto también se entiende", () => {
    const r = aligerarAvatarPNG({
      username: "x",
      avatar: JSON.stringify({ tipo: "png", huella: "abc" })
    });

    assert.equal(r.avatar.url, "/api/users?action=avatar-png&username=x&v=abc");
  });
});

describe("lo que no hay que tocar, no se toca", () => {
  test("un avatar por capas pasa intacto", () => {
    const avatar = { modelo: "tora", piel: "tora_piel1", fondo: "ninguno" };
    const r = aligerarAvatarPNG({ username: "x", avatar });

    assert.deepEqual(r.avatar, avatar);
  });

  test("un PNG SIN huella se deja como está, no se rompe", () => {
    // La consulta no pasó por fragmentoAvatarLigero: devolver un puntero
    // a una huella que no existe sería peor que no tocar nada.
    const avatar = { tipo: "png", src: "data:image/png;base64,AAAA" };
    const r = aligerarAvatarPNG({ username: "x", avatar });

    assert.deepEqual(r.avatar, avatar);
  });

  test("sin avatar no revienta", () => {
    assert.doesNotThrow(() => aligerarAvatarPNG({ username: "x", avatar: null }));
    assert.doesNotThrow(() => aligerarAvatarPNG({ username: "x" }));
    assert.doesNotThrow(() => aligerarAvatarPNG(null));
  });

  test("un jsonb roto no tumba la respuesta", () => {
    const r = aligerarAvatarPNG({ username: "x", avatar: "{esto no es json" });

    assert.equal(r.avatar, "{esto no es json");
  });

  test("sin nombre no se puede armar el puntero: se deja el avatar", () => {
    const avatar = { tipo: "png", huella: "abc" };
    const r = aligerarAvatarPNG({ avatar });

    assert.deepEqual(r.avatar, avatar);
  });
});

describe("el fragmento SQL recorta en la consulta", () => {
  test("usa la huella md5 y conserva la receta", () => {
    // Se le pasa un tag de mentira que devuelve el texto tal cual.
    const sqlFalso = (trozos, ...valores) => trozos.join("?");
    const frag = fragmentoAvatarLigero(sqlFalso);

    assert.match(frag, /md5\(u\.avatar->>'src'\)/, "la huella sale del contenido");
    assert.match(frag, /'restaurar', u\.avatar->'restaurar'/);
    assert.match(frag, /ELSE u\.avatar/, "los avatares por capas pasan enteros");
    assert.match(frag, /AS avatar/);
  });
});

// ==============================
// RECORTAR SIN CONVERTIR ES PEOR QUE NO RECORTAR
// ==============================
// Este es el error que se cometió: se añadió el recorte en la consulta y
// se olvidó la conversión en la respuesta. La página pesó menos y los
// avatares dejaron de verse.
//
// Se comprueba sobre el código fuente porque es una propiedad de cómo
// están escritos los endpoints, no de lo que devuelve una función.

describe("todo endpoint que recorta, convierte", () => {
  const fuentes = ["api/users.js", "api/social.js"];

  for (const archivo of fuentes) {
    test(archivo + " usa las dos piezas, no solo una", () => {
      const codigo = fs.readFileSync(path.join(RAIZ, archivo), "utf8");

      const recorta = codigo.includes("fragmentoAvatarLigero");
      const convierte = codigo.includes("aligerarAvatarPNG");

      if (!recorta) return; // este archivo no trae avatares: nada que comprobar

      assert.ok(convierte,
        archivo + " recorta el avatar en la consulta pero nunca llama a " +
        "aligerarAvatarPNG: el avatar llegaría sin url y no se dibujaría");
    });
  }
});

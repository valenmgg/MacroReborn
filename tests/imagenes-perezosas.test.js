// ==============================
// IMÁGENES QUE ESPERAN A VERSE — tests/imagenes-perezosas.test.js
// ==============================
// loading="lazy" no sirve para lo que este sitio necesita. Un navegador
// solo aplaza una imagen si tiene caja de dibujo y puede medir su
// distancia a la pantalla; dentro de algo con display:none no hay caja,
// así que la descarga igual.
//
// Y el sitio esconde mucho con display:none: las pestañas del perfil y
// de usuario.html son .contenido-tab, que en css/perfil.css es
// display:none salvo la activa. Ahí viven la lista de amigos, la galería
// de avatares guardados y la actividad.
//
// Medido con un HAR de usuario.html: 123 imágenes de avatares de gente
// que no se veía, 914 kB, en tres listas dentro de pestañas cerradas.
//
// Ahora las capas se emiten con data-src y core.js las registra en un
// IntersectionObserver. Se prueba con un observador de mentira, porque
// jsdom no maqueta y nunca dispararía uno de verdad.
//
// Correr:  npm test

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const FUENTE = fs.readFileSync(path.join(__dirname, "..", "js", "core.js"), "utf8");

// El trozo de core.js que gestiona las imágenes perezosas.
function bloque() {
  const i = FUENTE.indexOf("const _observadorPerezosas");
  const j = FUENTE.indexOf("// AVATAR — COMPOSICIÓN EN UNA SOLA IMAGEN");
  assert.ok(i !== -1 && j !== -1, "no se encontró el bloque en js/core.js");
  return FUENTE.slice(i, j);
}

// Un IntersectionObserver de mentira que deja disparar a mano.
function observadorFalso() {
  const vigiladas = [];
  function IO(callback) {
    this.callback = callback;
    this.observe = el => vigiladas.push(el);
    this.unobserve = el => {
      const i = vigiladas.indexOf(el);
      if (i !== -1) vigiladas.splice(i, 1);
    };
    IO.ultimo = this;
  }
  IO.vigiladas = vigiladas;
  IO.mostrar = el => IO.ultimo.callback([{ isIntersecting: true, target: el }]);
  return IO;
}

function montar(html, conObservador) {
  const dom = new JSDOM("<body>" + html + "</body>");
  const IO = conObservador ? observadorFalso() : undefined;

  const contexto = {
    document: dom.window.document,
    window: dom.window,
    console: { warn() {}, error() {}, log() {} }
  };
  if (IO) contexto.IntersectionObserver = IO;

  vm.createContext(contexto);
  const api = vm.runInContext(bloque() + "\n;({ activar: activarImagenesPerezosas })", contexto);

  return { doc: dom.window.document, api, IO };
}

const CAPAS =
  '<div class="avatar-mini">' +
  '<img class="capa-comentario" data-src="/prendas/aaa.png" alt="" loading="lazy">' +
  '<img class="capa-comentario" data-src="/prendas/bbb.png" alt="" loading="lazy">' +
  "</div>";

// ==============================

describe("mientras no se vea, no se pide", () => {
  test("registrarlas no les pone src", () => {
    const { doc, api } = montar(CAPAS, true);

    api.activar(doc);

    const imgs = [...doc.querySelectorAll("img")];
    assert.equal(imgs.filter(i => i.getAttribute("src")).length, 0,
      "ninguna debería haber pedido su dibujo todavía");
    assert.equal(imgs.filter(i => i.dataset.src).length, 2, "las dos siguen esperando");
  });

  test("pero quedan vigiladas, no olvidadas", () => {
    const { doc, api, IO } = montar(CAPAS, true);

    api.activar(doc);

    assert.equal(IO.vigiladas.length, 2);
  });
});

describe("cuando se ve, se pide", () => {
  test("al cruzarse con la pantalla, data-src pasa a src", () => {
    const { doc, api, IO } = montar(CAPAS, true);
    api.activar(doc);

    const primera = doc.querySelector("img");
    IO.mostrar(primera);

    assert.equal(primera.getAttribute("src"), "/prendas/aaa.png");
    assert.equal(primera.dataset.src, undefined, "ya no espera");
  });

  test("y solo esa: la otra sigue esperando", () => {
    const { doc, api, IO } = montar(CAPAS, true);
    api.activar(doc);

    const imgs = [...doc.querySelectorAll("img")];
    IO.mostrar(imgs[0]);

    assert.equal(imgs[1].getAttribute("src"), null);
    assert.equal(imgs[1].dataset.src, "/prendas/bbb.png");
  });

  test("se deja de vigilar lo que ya se pidió", () => {
    const { doc, api, IO } = montar(CAPAS, true);
    api.activar(doc);

    IO.mostrar(doc.querySelector("img"));

    assert.equal(IO.vigiladas.length, 1);
  });
});

describe("sin IntersectionObserver nadie se queda sin avatar", () => {
  // Navegador viejo: peor para la red, pero se ve todo.
  test("se cargan todas de una", () => {
    const { doc, api } = montar(CAPAS, false);

    api.activar(doc);

    const imgs = [...doc.querySelectorAll("img")];
    assert.equal(imgs.filter(i => i.getAttribute("src")).length, 2);
    assert.equal(imgs.filter(i => i.dataset.src).length, 0);
  });
});

describe("lo que no lleva data-src no se toca", () => {
  test("una imagen normal se queda como está", () => {
    const { doc, api, IO } = montar('<img src="imagenes/logo.png" alt="">', true);

    api.activar(doc);

    assert.equal(IO.vigiladas.length, 0);
    assert.equal(doc.querySelector("img").getAttribute("src"), "imagenes/logo.png");
  });

  test("una página sin imágenes no revienta", () => {
    const { doc, api } = montar("<p>nada</p>", true);

    assert.doesNotThrow(() => api.activar(doc));
  });
});

describe("el sitio emite las capas con data-src, no con src", () => {
  // Si alguien vuelve a escribir src="${ruta}" en una capa de avatar,
  // esa lista entera se descarga aunque esté dentro de una pestaña
  // cerrada. Es lo que pasaba en las tres listas de usuario.html.
  const archivos = [
    "js/core.js", "js/usuario.js", "js/usuario-actividad.js",
    "js/usuario-avatares-galeria.js", "js/perfil.js", "js/perfil-actividad.js",
    "js/perfil-avatares-galeria.js", "js/chat.js", "js/ranking.js",
    "js/comunidad-ranking.js", "js/resenas.js", "js/actividad-comunidad.js"
  ];

  for (const archivo of archivos) {
    test(archivo, () => {
      const codigo = fs.readFileSync(path.join(__dirname, "..", archivo), "utf8");

      // Capas de avatar: las que se arman con la ruta ya resuelta.
      //
      // El (?<!-) es imprescindible: el guion cuenta como límite de
      // palabra, así que un \b suelto encaja también dentro de
      // "data-src" y el test pasaría siempre, sin mirar nada.
      const conSrc = codigo.match(/<img[^>]*(?<!-)\bsrc="\$\{ruta\}"/g) || [];

      assert.deepEqual(conSrc, [],
        archivo + " emite una capa de avatar con src en vez de data-src: " +
        "se descargaría aunque no se vea");

      // Y los avatares PNG, que es donde más duele: uno solo puede pesar
      // casi un mega. En un HAR de usuario.html había 984 kB de un PNG
      // de alguien que había comentado, descargado desde una pestaña
      // cerrada, porque la conversión a data-src se hizo solo en las
      // capas y esta rama se quedó fuera.
      //
      // La excepción es el avatar grande del perfil visitado: está
      // arriba del todo y se quiere cuanto antes. Se reconoce por su
      // alt.
      const pngEager = (codigo.match(/<img[^>]*(?<!-)\bsrc="\$\{avatarPNGData[^>]*>/g) || [])
        .filter(et => !et.includes('alt="Avatar PNG"'));

      assert.deepEqual(pngEager, [],
        archivo + " emite un avatar PNG con src en vez de data-src: " +
        "puede ser casi un mega y se descargaría aunque no se vea");
    });
  }
});

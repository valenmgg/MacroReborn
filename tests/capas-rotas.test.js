// ==============================
// CAPAS ROTAS — tests/capas-rotas.test.js
// ==============================
// Cuando el dibujo de una capa no está, el navegador no deja el hueco
// vacío: pinta su marca de "imagen no encontrada" -un recuadro de borde
// fino con el icono roto arriba a la izquierda- del tamaño que el CSS le
// haya dado a la <img>. Encima de un avatar eso no se lee como un error
// de red, se lee como una prenda rota que la persona lleva puesta.
//
// rutaCapaAvatar() (ver tests/catalogo-en-core.test.js) tapa el caso que
// se puede saber de antemano, pero solo ese y solo DESPUÉS de que el
// catálogo llegue. Quedan tres que no dependen de nosotros:
//
//   - El avatar se dibuja antes de que el catálogo cargue, que es lo
//     normal: ahí todavía se adivina la ruta de siempre.
//   - Un 404 que nginx marcó como immutable y el navegador se guardó
//     treinta días. Pasó de verdad, está contado en api/content.js.
//   - Un fichero que desaparece con la fila todavía puesta.
//
// Por eso core.js escucha "error" UNA vez en el documento, en fase de
// captura -los "error" de una <img> no burbujean, pero sí bajan- y
// esconde la capa que no cargó. Lo que se prueba acá es justo eso: que
// entra cualquier capa, venga de donde venga, y que NO entra nada más.
//
// Correr:  npm test

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const FUENTE = fs.readFileSync(path.join(__dirname, "..", "js", "core.js"), "utf8");

// El trozo de core.js que esconde las capas rotas. Se lee el de verdad,
// no una copia: si alguien lo mueve o lo borra, esto deja de montar.
function bloque() {
  const i = FUENTE.indexOf("// UNA CAPA QUE NO CARGA NO DEJA MARCA");
  const j = FUENTE.indexOf("function avatarMiniaturaHTML");
  assert.ok(i !== -1 && j !== -1, "no se encontró el bloque en js/core.js");
  return FUENTE.slice(i, j);
}

// Un documento con el oyente ya puesto, como en una página de verdad.
function montar() {
  // runScripts hace falta para que window.eval corra DENTRO de la
  // ventana. Sin eso el bloque se evalúa en el realm de node, donde no
  // hay document, y el oyente no se llega a poner: los tests pasaban en
  // verde sin haber probado nada.
  const dom = new JSDOM("<!doctype html><body></body>", {
    url: "https://macroreborn.com/",
    runScripts: "outside-only"
  });
  const avisos = [];
  dom.window.console.warn = (...a) => avisos.push(a.join(" "));
  dom.window.eval(bloque());
  return { dom, d: dom.window.document, w: dom.window, avisos };
}

// Pone una <img> en la página y le hace fallar la carga, que es lo único
// que jsdom no hace solo: no descarga imágenes, así que nunca dispara un
// "error" por su cuenta.
function romper(w, d, img) {
  d.body.appendChild(img);
  img.dispatchEvent(new w.Event("error"));
  return img;
}

function capa(d, clase, src) {
  const img = d.createElement("img");
  if (clase) img.className = clase;
  img.src = src || "imagenes/tora/piel7.png";
  return img;
}

// ------------------------------------------------------------------

describe("una capa que no carga se esconde", () => {
  // Las siete clases con las que el sitio dibuja capas hoy, más la del
  // maniquí del taller. Están repartidas en ocho ficheros distintos:
  // acordarse de poner onerror en los ocho es justo lo que ya se olvidó
  // una vez, y por eso esto se escucha en un solo sitio.
  const CLASES = [
    "capa", "capa-amigo", "capa-chat", "capa-comentario",
    "capa-ranking", "capa-resena", "capa-tarjeta", "vest-capa"
  ];

  for (const clase of CLASES) {
    test(clase, () => {
      const { d, w } = montar();
      const img = romper(w, d, capa(d, clase));

      assert.equal(img.style.display, "none");
    });
  }

  test("y también una capa sin clase, si está dentro de un avatar compuesto", () => {
    // perfil.js y usuario.js las dibujan así: con estilo en línea y sin
    // clase ninguna.
    const { d, w } = montar();
    const caja = d.createElement("div");
    caja.className = "avatar-compuesto";
    d.body.appendChild(caja);

    const img = capa(d, null);
    caja.appendChild(img);
    img.dispatchEvent(new w.Event("error"));

    assert.equal(img.style.display, "none");
  });

  test("se esconde con estilo en línea, no con el atributo hidden", () => {
    // El atributo hidden lo tumba cualquier regla de CSS que ponga un
    // display, y estas capas llevan reglas propias en cinco hojas.
    const { d, w } = montar();
    const img = romper(w, d, capa(d, "capa"));

    assert.equal(img.hasAttribute("hidden"), false);
    assert.equal(img.getAttribute("style"), "display: none;");
  });

  test("queda marcada, para poder mirarla desde la consola", () => {
    const { d, w } = montar();
    const img = romper(w, d, capa(d, "capa"));

    assert.equal(img.dataset.capaRota, "1");
  });
});

describe("no toca nada que no sea una capa de avatar", () => {
  test("la portada de un juego se queda como está", () => {
    const { d, w } = montar();
    const img = d.createElement("img");
    img.className = "juego-portada";
    img.src = "imagenes/juegos/mario.png";
    romper(w, d, img);

    assert.equal(img.style.display, "");
  });

  test("una imagen suelta, sin clase y sin avatar alrededor, tampoco", () => {
    const { d, w } = montar();
    const img = romper(w, d, d.createElement("img"));

    assert.equal(img.style.display, "");
  });

  test("y una clase que solo EMPIEZA parecido no cuela", () => {
    const { d, w } = montar();
    const img = romper(w, d, capa(d, "capataz"));

    assert.equal(img.style.display, "");
  });
});

describe("el avatar que es un PNG entero no se esconde, cae al de siempre", () => {
  // Acá no hay capas debajo: esconderlo dejaría un círculo vacío.
  test("pasa a imagenes/avatar.png", () => {
    const { d, w } = montar();
    const img = capa(d, "avatar-png-personalizado", "data:image/png;base64,rota");
    romper(w, d, img);

    assert.equal(img.getAttribute("src"), "imagenes/avatar.png");
    assert.equal(img.style.display, "");
  });

  test("y si hasta ese falla no se queda dando vueltas", () => {
    const { d, w } = montar();
    const img = capa(d, "avatar-png-personalizado", "data:image/png;base64,rota");
    romper(w, d, img);

    // El segundo error es el del avatar por defecto.
    img.dispatchEvent(new w.Event("error"));

    assert.equal(img.getAttribute("src"), "imagenes/avatar.png");
  });
});

describe("el aviso en consola", () => {
  test("dice qué dibujo falta", () => {
    const { d, w, avisos } = montar();
    romper(w, d, capa(d, "capa", "imagenes/tora/piel7.png"));

    assert.equal(avisos.length, 1);
    assert.match(avisos[0], /imagenes\/tora\/piel7\.png/);
  });

  test("uno por dibujo, no uno por avatar", () => {
    // La misma prenda rota puede estar puesta en veinte tarjetas de la
    // misma página: veinte avisos iguales no ayudan a nadie.
    const { d, w, avisos } = montar();
    for (let i = 0; i < 20; i++) romper(w, d, capa(d, "capa-tarjeta"));

    assert.equal(avisos.length, 1);
  });

  test("pero dos dibujos distintos avisan dos veces", () => {
    const { d, w, avisos } = montar();
    romper(w, d, capa(d, "capa", "imagenes/tora/piel7.png"));
    romper(w, d, capa(d, "capa", "imagenes/max/pelo9.png"));

    assert.equal(avisos.length, 2);
  });
});

describe("vale para las capas que todavía no existen", () => {
  // Es la razón de escuchar en el documento y no en cada <img>: las
  // capas se dibujan mucho después de que core.js se cargue, y algunas
  // se escriben con innerHTML, donde no hay dónde colgar un onerror.
  test("una capa escrita con innerHTML mucho después", () => {
    const { d, w } = montar();
    d.body.innerHTML = '<div class="tarjeta"><img class="capa-resena" src="imagenes/tora/piel7.png" alt=""></div>';
    const img = d.querySelector(".capa-resena");
    img.dispatchEvent(new w.Event("error"));

    assert.equal(img.style.display, "none");
  });
});

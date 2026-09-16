// ==============================
// IMÁGENES QUE SE ESCONDEN DE VERDAD — tests/imagenes-escondidas.test.js
// ==============================
// El atributo hidden de HTML no se esconde solo: lo esconde una regla de
// la hoja del navegador, [hidden] { display: none }. Y esa hoja es la de
// usuario-agente, la que pierde contra CUALQUIER regla de autor por poca
// especificidad que tenga. No es una cuestión de especificidad, es el
// orden de los orígenes del cascade.
//
// Así que el día que css/inicio.css escribió
//
//     .mr-root img { max-width: 100%; display: block; }
//
// dejó de funcionar img.hidden = true en TODO el sitio, y nadie se
// enteró: la imagen se quedaba en su sitio, sin src, con el ancho y el
// alto que tuviera puestos a mano, y el navegador le pintaba dentro su
// icono de "imagen rota" -el recuadro de borde fino con la esquina
// superior izquierda marcada.
//
// Se vio en el maniquí del taller: al volver a Desnudo o tirar de Azar,
// la prenda se iba y dejaba el recuadro. Las cuatro reglas [hidden] con
// !important que andan sueltas por inicio.css, juego.css y jugar.css son
// esta misma trampa pisada antes y parcheada a mano cada vez.
//
// Esto no se puede probar en jsdom. Su hoja por defecto dice en un
// comentario que no modela especificidad, y por eso pone [hidden] al
// final: en jsdom hidden esconde aunque en Chrome no lo hiciera. O sea
// que un test de getComputedStyle daría verde con el fallo puesto. Lo
// que queda es leer las hojas y comprobar que nadie le puede ganar a la
// guarda.
//
// Correr:  npm test

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const CSS = path.join(__dirname, "..", "css");

// Un lector de reglas del pobre: quita comentarios y saca los pares
// selector/cuerpo. No entiende anidamiento, y da igual: un bloque con
// llaves dentro (@media) no casa, así que las envolturas se saltan solas
// y las reglas de dentro casan una a una, que es justo lo que hace falta.
function reglas() {
  const salida = [];
  for (const archivo of fs.readdirSync(CSS)) {
    if (!archivo.endsWith(".css")) continue;
    const texto = fs.readFileSync(path.join(CSS, archivo), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(texto))) {
      salida.push({
        archivo,
        selector: m[1].trim().replace(/\s+/g, " "),
        cuerpo: m[2]
      });
    }
  }
  return salida;
}

// ¿El selector puede alcanzar a un <img> pelado?
function apuntaAImagen(selector) {
  return /(^|[\s,>+~])img(\s*[:[.]|\s*,|\s*$)/.test(" " + selector);
}

function display(cuerpo) {
  const m = cuerpo.match(/(?:^|;|\s)display\s*:([^;]*)/);
  return m ? m[1].trim() : null;
}

// ==============================

describe("el atributo hidden vuelve a esconder imágenes", () => {
  test("hay una guarda en css/inicio.css que reesconde img[hidden]", () => {
    const guardas = reglas().filter(r =>
      /img\[hidden\]/.test(r.selector) && /none/.test(display(r.cuerpo) || ""));

    assert.ok(guardas.length >= 1,
      "sin una regla img[hidden]{display:none} el hidden de .vest-capa no esconde nada");
    assert.ok(guardas.some(g => g.archivo === "inicio.css"),
      "la guarda va donde está el display:block que la hace falta");
  });

  test("y va con !important, que es lo único que no se puede desempatar", () => {
    const guarda = reglas().find(r =>
      r.archivo === "inicio.css" && /img\[hidden\]/.test(r.selector));
    assert.ok(/!important/.test(display(guarda.cuerpo)),
      "sin !important, la próxima regla .a .b img empata en especificidad y gana por orden");
  });

  // La que de verdad vigila: el sitio tiene ocho reglas más que le dan un
  // display a las imágenes. Ninguna puede llevar !important salvo para
  // esconder, porque entonces le ganaría a la guarda y volvería el
  // recuadro roto.
  test("ninguna otra regla del sitio le puede ganar", () => {
    const rivales = reglas().filter(r => {
      if (/\[hidden\]/.test(r.selector)) return false;
      if (!apuntaAImagen(r.selector)) return false;
      const d = display(r.cuerpo);
      if (!d) return false;
      if (/^none\b/.test(d)) return false;   // esconder de más nunca destapa
      return /!important/.test(d);
    });

    assert.deepStrictEqual(
      rivales.map(r => r.archivo + ": " + r.selector), [],
      "estas reglas le ganan a la guarda y dejan visible lo que se marcó como hidden");
  });
});

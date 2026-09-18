// ==============================
// ESCAPADO DE TEXTO EN HTML — tests/escapado-html.test.js
// ==============================
// Tres XSS almacenados reales, los tres por meter en innerHTML texto que
// escribe otra persona:
//
//   - la biografía, en la lista de comunidad. `updateBio` la guarda sin
//     validar nada y `/api/users` la devuelve a cualquiera sin sesión,
//     así que se ejecutaba en el navegador de todo el que abriera la
//     página social principal.
//   - el título y el mensaje de una notificación. El endpoint deja
//     mandárselos a una persona concreta declarando `origenNombre`, o
//     sea que es un XSS dirigido: se entrega al buzón de la víctima.
//   - el texto y el motivo de un reporte, dentro del panel de
//     administración. Ese es el peor: `contentTexto` es texto libre de
//     cualquiera de las 144 cuentas y se ejecuta en el navegador de un
//     administrador. Con el token de sesión en localStorage y sin CSP,
//     eso es la cuenta entera.
//
// Este archivo cubre dos cosas distintas:
//
//   1. Que MRTexto.escapar haga su trabajo, incluidas las COMILLAS. La
//      variante más repetida del proyecto (19 copias) usa el truco de
//      div.textContent + div.innerHTML, que por especificación escapa
//      & < > pero NUNCA las comillas, porque en un nodo de texto no
//      hacen falta. El problema es que varios de esos resultados se
//      meten dentro de atributos (data-usuario="...", alt="..."), y ahí
//      una comilla se sale del atributo sin necesidad de un solo "<".
//
//   2. Que los tres archivos que pintan ese contenido NO vuelvan a
//      interpolarlo en crudo. Es una guarda de texto, no de
//      comportamiento: si alguien vuelve a escribir ${noti.titulo} sin
//      escapar, esto falla. Es tosco a propósito — sin empaquetador ni
//      módulos, no hay forma de comprobarlo de otra manera, y la
//      alternativa es que el agujero vuelva sin que nadie se entere.
//
// Correr:  npm test

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const JS = path.join(__dirname, "..", "js");
const FUENTE_CORE = fs.readFileSync(path.join(JS, "core.js"), "utf8");

// Se evalúa el bloque real de core.js, no una copia escrita aquí: una
// copia se queda vieja y el test pasaría con el fallo puesto.
function cargarMRTexto() {
  const i = FUENTE_CORE.indexOf("const MRTexto = {");
  assert.ok(i !== -1, "no se encontró MRTexto en js/core.js");

  const marca = "window.MRTexto = MRTexto;";
  const j = FUENTE_CORE.indexOf(marca);
  assert.ok(j !== -1, "no se encontró la exposición de MRTexto en js/core.js");

  const contexto = { window: {} };
  vm.createContext(contexto);
  vm.runInContext(FUENTE_CORE.slice(i, j + marca.length), contexto);

  return contexto.window.MRTexto;
}

const MRTexto = cargarMRTexto();

describe("MRTexto.escapar", () => {
  test("neutraliza una etiqueta", () => {
    assert.equal(
      MRTexto.escapar("<img src=x onerror=alert(1)>"),
      "&lt;img src=x onerror=alert(1)&gt;"
    );
  });

  test("escapa las comillas dobles, que es lo que rompe un atributo", () => {
    // El caso real: data-usuario="${...}" en el panel de administración.
    assert.equal(
      MRTexto.escapar('" onmouseover="alert(1)'),
      "&quot; onmouseover=&quot;alert(1)"
    );
  });

  test("escapa las comillas simples", () => {
    assert.equal(MRTexto.escapar("' onerror='x"), "&#39; onerror=&#39;x");
  });

  test("escapa el ampersand primero, sin doble escapado", () => {
    // Si & se escapara al final, "&lt;" acabaría como "&amp;lt;".
    assert.equal(MRTexto.escapar("<"), "&lt;");
    assert.equal(MRTexto.escapar("&lt;"), "&amp;lt;");
  });

  test("el texto normal no se toca", () => {
    assert.equal(MRTexto.escapar("Bianca jugó Macro Snake"), "Bianca jugó Macro Snake");
  });

  test("null, undefined y números no rompen", () => {
    assert.equal(MRTexto.escapar(null), "");
    assert.equal(MRTexto.escapar(undefined), "");
    assert.equal(MRTexto.escapar(0), "0");
    assert.equal(MRTexto.escapar(false), "false");
  });

  test("después de escapar no queda ningún carácter que abra marcado", () => {
    const sucio = `<script>alert("x")</script>' & <b>`;
    const limpio = MRTexto.escapar(sucio);
    for (const caracter of ["<", ">", '"', "'"]) {
      assert.ok(
        !limpio.includes(caracter),
        `quedó un ${caracter} sin escapar en: ${limpio}`
      );
    }
  });
});

describe("los renders no interpolan en crudo lo que escribe otra persona", () => {
  // archivo -> trozos de HTML que NO pueden aparecer sin escapar.
  //
  // Se comprueba el trozo de marcado, no el nombre del campo a secas: el
  // mismo campo se usa también para cosas que NO son HTML. `reporte.motivo`,
  // por ejemplo, entra además en el texto que se guarda en el registro de
  // moderación, y ahí escaparlo sería el error contrario: dejaría entidades
  // HTML guardadas en la base.
  const prohibido = {
    "notificaciones.js": [
      "<h4>${noti.titulo}</h4>",
      "<h3>${noti.titulo}</h3>",
      "<p>${noti.mensaje}</p>"
    ],
    "admin.js": [
      '"${reporte.texto}"',
      "<b>Motivo:</b> ${reporte.motivo}",
      "<b>Reportado por:</b> ${reporte.reportadoPor}",
      "Perfil de ${reporte.origen}",
      "<b>Motivo:</b> ${entrada.motivo}",
      "<b>Hecho por:</b> ${entrada.usuario}",
      "<b>Usuario afectado:</b> ${entrada.usuarioAfectado}",
      "<h3>${usuario.username}</h3>",
      'data-usuario="${usuario.username}"',
      'data-usuario="${reporte.usuario}"'
    ],
    "comunidad-ranking.js": [
      '<p class="usuario-bio">${usuario.bio}</p>',
      '<h3 class="usuario-nombre">${usuario.nombre}</h3>',
      '<p class="rk-podio-nombre">${usuario.nombre}</p>',
      '<p class="rk-mini-nombre">${usuario.nombre}</p>',
      '<p class="cr-staff-nombre">${s.username}</p>',
      // Los title= son el caso que justifica escapar las comillas.
      'title="${u.username}"',
      'title="${s.username}"',
      'title="${u.nombre}"',
      'title="${item.username}"',
      "<p>${texto}</p>"
    ]
  };

  for (const [archivo, expresiones] of Object.entries(prohibido)) {
    const fuente = fs.readFileSync(path.join(JS, archivo), "utf8");

    for (const expresion of expresiones) {
      test(`${archivo} no tiene ${expresion} sin escapar`, () => {
        assert.ok(
          !fuente.includes(expresion),
          `js/${archivo} volvió a interpolar ${expresion} en crudo. ` +
          "Eso es un XSS almacenado: usar MRTexto.escapar()."
        );
      });
    }
  }

  test("core.js expone MRTexto para que los tres puedan usarlo", () => {
    assert.ok(
      FUENTE_CORE.includes("window.MRTexto = MRTexto;"),
      "core.js dejó de exponer MRTexto y los renders se quedan sin escapado"
    );
  });
});

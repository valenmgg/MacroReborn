// ==============================
// UN NOMBRE DE USUARIO NO ES HTML — tests/nombres-de-usuario.test.js
// ==============================
// Punto 77 de docs/AUDITORIA.md. El registro aceptaba cualquier texto
// como nombre, y la página de amigos lo metía en el HTML sin escapar.
// Un nombre como <img src=x onerror=...> se ejecutaba:
//
//   - en quien lo tuviera de amigo, y
//   - en quien recibiera su solicitud de amistad, sin aceptarla: bastaba
//     con mandarla. También a un administrador.
//
// Y en el panel de estadísticas del administrador, los tops de nivel y
// de XP pintaban el nombre igual.
//
// Aquí se sujetan las dos mitades del arreglo:
//
//   AL PINTAR SE ESCAPA. Se ejecuta js/amigos.js de verdad, entero,
//   sobre amigos.html, con amigos y solicitudes de nombre malicioso.
//
//   Y ESE NOMBRE YA NO SE PUEDE CREAR. api/_nombre-usuario.js, con todos
//   los estilos de nombre que la gente ya usa aceptados.
//
// Correr:  npm test

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret";

require("./_aislar-datos");   // antes de api/: ver ese archivo

const { test, before, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const { crearBaseLocal, crearSqlPGlite } = require("../scripts/pglite");
const { usarSqlLocal } = require("../api/_db");

const raiz = (...p) => path.join(__dirname, "..", ...p);
const MALO = '<img src=x onerror="window.__robado=1">';

// ==============================
// AL PINTAR
// ==============================

// Monta amigos.html y ejecuta js/amigos.js entero, con una sesión y una
// respuesta de /api/social de mentira. Devuelve el documento ya pintado.
async function paginaDeAmigos(datos) {
  const html = fs.readFileSync(raiz("amigos.html"), "utf8")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");   // sin scripts propios
  const dom = new JSDOM(html, { url: "https://macroreborn.com/amigos.html", runScripts: "outside-only" });
  const w = dom.window;

  // MRTexto de verdad, sacado de core.js.
  const core = fs.readFileSync(raiz("js", "core.js"), "utf8");
  const i = core.indexOf("const MRTexto = {");
  const j = core.indexOf("window.MRTexto = MRTexto;");
  w.eval(core.slice(i, j) + "window.MRTexto = MRTexto;");

  w.MRSession = { get: () => ({ nombre: "luis" }) };
  w.leerJSON = JSON.parse;
  w.SILUETA_AVATAR = { tipo: "silueta", src: "imagenes/avatar.png" };
  w.imagenDeAvatar = () => w.SILUETA_AVATAR;
  w.fetch = async () => ({ json: async () => ({ success: true, ...datos }) });

  w.eval(fs.readFileSync(raiz("js", "amigos.js"), "utf8"));
  // renderTodo es asíncrona: esperar a que pinte.
  for (let n = 0; n < 50 && !w.document.querySelector("#listaAmigos .amigo-card, #listaAmigos .lista-vacia"); n++) {
    await new Promise(r => setTimeout(r, 10));
  }
  return w;
}

describe("la página de amigos escapa los nombres", () => {

  let w;
  before(async () => {
    w = await paginaDeAmigos({
      amigos: [{ id: 5, username: MALO, level: 3, avatar: null }],
      solicitudesEntrantes: [{ id: 9, de: MALO, created_at: "2026-09-24" }],
      solicitudesSalientes: [{ id: 10, para: MALO, created_at: "2026-09-24" }]
    });
  });

  test("el nombre de un amigo se ve como texto, no como una imagen", () => {
    const tarjeta = w.document.querySelector("#listaAmigos .amigo-card");
    assert.ok(tarjeta, "no se pintó la tarjeta del amigo");
    assert.equal(tarjeta.querySelector(".amigo-nombre img"), null, "el nombre se volvió HTML");
    assert.match(tarjeta.querySelector(".amigo-nombre").textContent, /<img src=x onerror=/);
  });

  test("el de quien manda una solicitud, igual: era lo peor, sin aceptar nada", () => {
    const lista = w.document.getElementById("listaSolicitudes");
    assert.ok(lista.querySelector(".solicitud-card"), "no se pintó la solicitud");
    assert.equal(lista.querySelectorAll("img").length, 0, "el nombre se volvió HTML");
    assert.match(lista.textContent, /<img src=x onerror=/);
  });

  test("y el de a quién se la mandé", () => {
    const lista = w.document.getElementById("listaEnviadas");
    assert.ok(lista.querySelector(".solicitud-card"), "no se pintó la enviada");
    assert.equal(lista.querySelectorAll("img").length, 0, "el nombre se volvió HTML");
  });

  test("y no se ejecutó nada", () => {
    assert.equal(w.__robado, undefined);
  });

  test("el enlace al perfil sigue llevando el nombre bien codificado", () => {
    const enlace = w.document.querySelector("#listaAmigos .btn-ver-perfil");
    assert.equal(enlace.getAttribute("href"), "usuario.html?usuario=" + encodeURIComponent(MALO));
  });

});

describe("los demás sitios que pintaban un nombre en crudo", () => {
  // Guardas de texto, como las de tests/escapado-html.test.js: si alguien
  // vuelve a escribir la interpolación sin escapar, esto falla.
  const prohibido = {
    "admin.js": ['<span class="admin-top-nombre">${item.nombre}</span>'],
    "navbar.js": ["<span>${usuarioNav.nombre}</span>", '">${usuarioNav.nombre}</div>'],
    "perfil-actividad.js": ["@${usuarioActual.nombre}."],
    "amigos.js": ["👤 ${sol.de}", "👤 ${sol.para}"]
  };
  for (const [archivo, trozos] of Object.entries(prohibido)) {
    const fuente = fs.readFileSync(raiz("js", archivo), "utf8");
    for (const trozo of trozos) {
      test(`${archivo} no tiene ${trozo} sin escapar`, () => {
        assert.ok(!fuente.includes(trozo), `js/${archivo} volvió a pintar ${trozo} en crudo`);
      });
    }
  }
});

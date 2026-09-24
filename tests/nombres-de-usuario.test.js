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

const { validarNombreUsuario } = require("../api/_nombre-usuario");
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

// ==============================
// AL REGISTRARSE
// ==============================

describe("qué nombre se puede registrar", () => {

  test("los estilos que la gente ya usa siguen valiendo", () => {
    // Sacados de los nombres de producción del 24/09/2026.
    for (const nombre of ["soydegurime", "Kylen.", "𝕊𝔼𝔼𝕀ℕ𝔾", "ᛝ 𝐙 𝐀 𝐑 𝐀 𝐓 𝐇 𝐔 𝐒 𝐓 𝐑 𝐀 ᛝ", "Bianca♡",
                          "piñato", "Bardero UY", "𝐿𝒶𝒹𝓎_𝒥𝒶𝓃𝑒𝓉𓆩♡𓆪", "L.Lunita", "☦    𝐑𝐞𝐦𝐨𝐯𝐞𝐫    ☦",
                          "King Pazuzu!", "Fredd_Dark", "1234478", "ana"]) {
      assert.deepStrictEqual(validarNombreUsuario(nombre), { ok: true, nombre }, nombre);
    }
  });

  test("lo que rompe el HTML, un atributo o una ruta, no", () => {
    for (const nombre of [MALO, "a<b", "a>b", 'a"b', "a'b", "a`b", "a&b", "a/b", "a\\b"]) {
      assert.equal(validarNombreUsuario(nombre).ok, false, nombre);
    }
  });

  test("ni lo invisible: controles, marcas de dirección, espacios de ancho cero", () => {
    for (const nombre of ["ana\nluis", "ana\tluis", "ana‮luis", "ana​luis", "ana﻿luis",
                          "ana luis", "ana\u0000luis"]) {
      assert.equal(validarNombreUsuario(nombre).ok, false, JSON.stringify(nombre));
    }
  });

  test("ni espacios en los bordes, ni largos fuera de 3 a 25", () => {
    for (const nombre of [" ana", "ana ", "an", "a".repeat(26), ""]) {
      assert.equal(validarNombreUsuario(nombre).ok, false, JSON.stringify(nombre));
    }
    assert.equal(validarNombreUsuario("a".repeat(25)).ok, true);
    // Una letra decorativa es un carácter, aunque ocupe dos en JavaScript.
    assert.equal(validarNombreUsuario("𝕊".repeat(25)).ok, true);
  });

  test("y lo que no es texto, tampoco", () => {
    for (const nombre of [undefined, null, 123, {}, ["ana"]]) {
      assert.equal(validarNombreUsuario(nombre).ok, false, JSON.stringify(nombre));
    }
  });

  test("el error se puede enseñar tal cual en el formulario", () => {
    assert.match(validarNombreUsuario("a<b").error, /no puede llevar/);
  });

});

describe("el registro de verdad lo comprueba", () => {

  let db, auth;
  before(async () => {
    db = await crearBaseLocal();
    usarSqlLocal(crearSqlPGlite(db));
    auth = require("../api/auth");
  });

  function registrar(username) {
    return new Promise((resolve) => {
      const req = { method: "POST", query: { action: "register" }, body: { username, password: "clave-de-prueba-1" }, headers: {} };
      const res = {
        statusCode: 200,
        status(c) { this.statusCode = c; return this; },
        setHeader() {},
        json(obj) { resolve({ codigo: this.statusCode, cuerpo: obj }); },
        end(c) { resolve({ codigo: this.statusCode, cuerpo: c }); }
      };
      auth(req, res);
    });
  }

  test("un nombre con HTML no se registra, y no queda nada en la base", async () => {
    for (const nombre of [MALO, "<b>ana</b>"]) {
      const r = await registrar(nombre);
      assert.equal(r.cuerpo.success, false, nombre);
      const filas = await db.query("SELECT count(*)::int AS n FROM users WHERE username = $1", [nombre]);
      assert.equal(filas.rows[0].n, 0, nombre);
    }
    assert.match((await registrar("<b>ana</b>")).cuerpo.error, /no puede llevar/);
  });

  test("uno con estilo, sí", async () => {
    const r = await registrar("Bianca♡ 2");
    assert.equal(r.cuerpo.success, true, JSON.stringify(r.cuerpo));
    assert.equal(r.cuerpo.user.username, "Bianca♡ 2");
  });

});

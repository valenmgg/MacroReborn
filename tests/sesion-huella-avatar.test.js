// ==============================
// LA SESIÓN SE QUEDA CON LA HUELLA NUEVA — tests/sesion-huella-avatar.test.js
// ==============================
// La portada pinta el avatar propio desde la sesión del navegador, con
// imagenDeAvatar(): con la huella pide /avatares/<id>/62x96.jpg?v=<huella>,
// que el navegador guarda un año.
//
// Al cambiarse de ropa, js/perfil.js guardaba en la sesión solo el
// avatar nuevo y dejaba la huella de antes. La portada habría seguido
// pidiendo esa dirección, y el navegador la tenía guardada: se vería la
// ropa de ayer durante un año. Lo mismo al ponerse un PNG, que en el
// servidor borra la huella.
//
// Aquí se ejecutan las dos funciones de verdad, con la API de mentira.
//
// Correr:  npm test

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PERFIL = fs.readFileSync(path.join(__dirname, "..", "js", "perfil.js"), "utf8");

function funcion(nombre) {
  const i = PERFIL.indexOf("async function " + nombre + "(");
  assert.ok(i !== -1, "no está " + nombre + " en js/perfil.js");
  const fin = PERFIL.slice(i).search(/\r?\n}\r?\n/);
  return PERFIL.slice(i, i + fin) + "\n}\n";
}

// Monta una función de perfil.js con una sesión y una API de mentira.
function montar(nombre, respuesta) {
  const sesion = { avatar: { modelo: "tora" }, avatar_compuesto: "huella-de-ayer" };
  const MRSession = { update(parcial) { Object.assign(sesion, parcial); } };
  const contexto = {
    console: { warn() {}, error() {}, log() {} },
    datosUsuario: { nombre: "luis", avatar: { modelo: "tora" }, avatar_compuesto: "huella-de-ayer" },
    fetch: async () => ({ ok: true, json: async () => respuesta }),
    MRSession,
    window: { MRSession },
    localStorage: { setItem() {} },
    avatarEsPNG: () => false,
    actualizarAvatarPrincipal() {}
  };
  vm.createContext(contexto);
  const fn = vm.runInContext(funcion(nombre) + "\n;" + nombre, contexto);
  return { fn, sesion, datos: contexto.datosUsuario };
}

describe("la huella en la sesión", () => {

  test("cambiarse de ropa deja en la sesión la huella nueva", async () => {
    const { fn, sesion, datos } = montar("guardarAvatar",
      { success: true, user: { avatar_compuesto: "huella-de-hoy" } });

    assert.equal(await fn({ modelo: "tora", pelo: "tora_pelo3" }), true);
    assert.equal(sesion.avatar_compuesto, "huella-de-hoy", "la sesión se quedó con la huella de ayer");
    assert.equal(datos.avatar_compuesto, "huella-de-hoy");
    assert.deepStrictEqual(sesion.avatar, { modelo: "tora", pelo: "tora_pelo3" });
  });

  test("si la respuesta no la trae, null: mejor la dirección desnuda que la de ayer", async () => {
    const { fn, sesion } = montar("guardarAvatar", { success: true, user: {} });
    await fn({ modelo: "tora" });
    assert.equal(sesion.avatar_compuesto, null);
  });

  test("ponerse un PNG de administrador la borra de la sesión", async () => {
    const png = { tipo: "png", src: "data:image/png;base64,AAAA" };
    const { fn, sesion } = montar("guardarAvatarPngAdmin",
      { success: true, user: { avatar: png, avatar_compuesto: null } });

    await fn("data:image/png;base64,AAAA");
    assert.equal(sesion.avatar_compuesto, null, "la sesión se quedó con la huella de la ropa");
    assert.deepStrictEqual(sesion.avatar, png);
  });

});

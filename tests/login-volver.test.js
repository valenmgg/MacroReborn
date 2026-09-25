// ==============================
// VOLVER DESPUÉS DE ENTRAR — tests/login-volver.test.js
// ==============================
// Cuando la sesión caduca, js/core.js ofrece volver a entrar con
// login.html?volver=<la página donde se estaba>, y al entrar se vuelve
// ahí. Solo a una página del propio sitio: una dirección de fuera haría
// del login un trampolín a cualquier web.
//
// Se evalúa la función de verdad de js/login.js.
//
// Correr:  npm test

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const LOGIN = fs.readFileSync(path.join(__dirname, "..", "js", "login.js"), "utf8").replace(/\r\n/g, "\n");
const i = LOGIN.indexOf("function paginaTrasEntrar(busqueda){");
const j = LOGIN.indexOf("\n}\n", i);
const contexto = { URLSearchParams };
vm.createContext(contexto);
vm.runInContext(LOGIN.slice(i, j + 2), contexto);
const pagina = (busqueda) => contexto.paginaTrasEntrar(busqueda);

test("sin volver, al perfil, como siempre", () => {
  assert.equal(pagina(""), "perfil.html");
  assert.equal(pagina("?otra=cosa"), "perfil.html");
});

test("con volver, a esa página del sitio, con su búsqueda", () => {
  assert.equal(pagina("?volver=" + encodeURIComponent("jugar.html?id=5")), "jugar.html?id=5");
  assert.equal(pagina("?volver=mi-dia.html"), "mi-dia.html");
});

test("nunca fuera del sitio", () => {
  for (const malo of ["https://malo.com/x.html", "//malo.com/x.html", "javascript:alert(1)",
                      "/perfil.html", "../x.html", "perfil.html#x", "x.html?a=1#b", "carpeta/x.html"]) {
    assert.equal(pagina("?volver=" + encodeURIComponent(malo)), "perfil.html", malo);
  }
});

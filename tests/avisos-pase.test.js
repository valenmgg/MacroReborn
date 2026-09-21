// ==============================
// EL PASE PARA /api/avisos — tests/avisos-pase.test.js
// ==============================
// EventSource no puede mandar cabeceras, así que la línea de avisos en
// vivo se abre con un pase de un minuto que viaja en la URL. Lo que hay
// que sujetar es que el pase y la sesión no valgan el uno por el otro:
// un pase caído en un registro no puede abrir la API, y una sesión no
// puede hacer de pase aunque lleve la misma firma.
//
// Correr:  npm test

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret";

const { test, describe } = require("node:test");
const assert = require("node:assert");

const auth = require("../api/_auth");

const luis = { id: 7, username: "Luis" };

// Lo que el despachador tiene en req.auth cuando hay sesión.
function sesionDeLuis() {
  return auth.verificarToken(auth.crearToken(luis));
}

describe("un pase recién hecho", () => {

  test("se verifica y dice de quién es", () => {
    const pase = auth.crearPase(sesionDeLuis());
    const quien = auth.verificarPase(pase);

    assert.ok(quien, "no se verificó");
    assert.equal(quien.sub, 7);
    assert.equal(quien.username, "Luis");
    assert.equal(quien.uso, "avisos");
  });

  test("caduca en un minuto, no en siete días", () => {
    const antes = Date.now();
    const quien = auth.verificarPase(auth.crearPase(sesionDeLuis()));

    assert.ok(quien.exp > antes, "nació caducado");
    assert.ok(quien.exp <= antes + auth.PASE_TTL_MS + 1000, "vive más de un minuto");
    assert.ok(auth.PASE_TTL_MS < auth.TOKEN_TTL_MS);
  });

});

describe("lo que no vale como pase", () => {

  test("un pase caducado", () => {
    const caducado = auth.crearPase(sesionDeLuis(), -1);
    assert.equal(auth.verificarPase(caducado), null);
  });

  test("una sesión de verdad, aunque lleve el mismo secreto", () => {
    // Si valiera, el token de siete días serviría en la URL de
    // /api/avisos, que es justo lo que el pase existe para evitar.
    assert.equal(auth.verificarPase(auth.crearToken(luis)), null);
  });

  test("un pase con la firma tocada", () => {
    const [carga, firma] = auth.crearPase(sesionDeLuis()).split(".");
    const tocada = firma.slice(0, -1) + (firma.endsWith("A") ? "B" : "A");
    assert.equal(auth.verificarPase(carga + "." + tocada), null);
  });

  test("un pase con la carga tocada", () => {
    const pase = auth.crearPase(sesionDeLuis());
    assert.equal(auth.verificarPase("x" + pase), null);
  });

  test("y basura de todo tipo", () => {
    for (const cosa of ["", null, undefined, 42, "a", "a.b", "a.b.c", "..."]) {
      assert.equal(auth.verificarPase(cosa), null, "aceptó " + JSON.stringify(cosa));
    }
  });

});

describe("y en el otro sentido", () => {

  test("un pase no abre la API como si fuera una sesión", () => {
    // La misma firma, el mismo secreto, sujeto y nombre válidos: lo único
    // que lo delata es el `uso`. Esta es la prueba que importa.
    assert.equal(auth.verificarToken(auth.crearPase(sesionDeLuis())), null);
  });

  test("la sesión de siempre sigue valiendo igual", () => {
    const quien = auth.verificarToken(auth.crearToken(luis));
    assert.equal(quien.sub, 7);
    assert.equal(quien.username, "Luis");
    assert.equal(quien.uso, undefined);
  });

});

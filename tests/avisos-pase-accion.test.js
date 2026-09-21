// ==============================
// PEDIR EL PASE POR /api/content — tests/avisos-pase-accion.test.js
// ==============================
// La acción avisos-pase es lo único que separa a un navegador con sesión
// de uno sin ella a la hora de abrir la línea de avisos en vivo: con la
// cabecera de siempre se lleva un pase de un minuto, y sin ella no se
// lleva nada. Lo que se prueba es que exige sesión, que lo que devuelve
// es un pase de verdad para esa misma persona, y que ese pase no sirve
// como sesión.
//
// El handler no toca la base, pero api/content.js toma la conexión al
// cargarse, así que se enchufa la base local antes de pedirlo, igual
// que en tests/autorizacion-content.test.js.
//
// Correr:  npm test

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret";

const { test, before, describe } = require("node:test");
const assert = require("node:assert");

const { crearBaseLocal, crearSqlPGlite } = require("../scripts/pglite");
const { usarSqlLocal } = require("../api/_db");
const { crearToken, verificarPase, verificarToken, PASE_TTL_MS } = require("../api/_auth");

let contentHandler;

before(async () => {
  usarSqlLocal(crearSqlPGlite(await crearBaseLocal()));
  contentHandler = require("../api/content");
});

const luis = { id: 7, username: "Luis" };

// La misma forma de petición que arma server.js para /api/: query,
// cuerpo y, si hay sesión, el token en la cabecera.
function llamar(metodo, sesion) {
  return new Promise((resolve) => {
    const req = {
      method: metodo,
      query: { action: "avisos-pase" },
      body: {},
      headers: sesion ? { authorization: "Bearer " + crearToken(sesion) } : {}
    };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      setHeader() {},
      json(obj) { resolve({ codigo: this.statusCode, cuerpo: obj }); },
      end(cuerpo) { resolve({ codigo: this.statusCode, cuerpo }); }
    };
    contentHandler(req, res);
  });
}

describe("pedir el pase", () => {

  test("sin sesión no hay pase", async () => {
    const r = await llamar("GET", null);
    assert.equal(r.codigo, 401);
    assert.equal(r.cuerpo.success, false);
    assert.equal(r.cuerpo.pase, undefined);
  });

  test("con sesión, un pase de esa misma persona", async () => {
    const r = await llamar("GET", luis);
    assert.equal(r.codigo, 200);
    assert.equal(r.cuerpo.success, true);

    const quien = verificarPase(r.cuerpo.pase);
    assert.ok(quien, "lo que devolvió no es un pase válido");
    assert.equal(quien.sub, 7);
    assert.equal(quien.username, "Luis");
  });

  test("y dice cuánto dura, para que el navegador no adivine", async () => {
    const r = await llamar("GET", luis);
    assert.equal(r.cuerpo.caduca_ms, PASE_TTL_MS);
  });

  test("el pase que devuelve no abre la API como sesión", async () => {
    const r = await llamar("GET", luis);
    assert.equal(verificarToken(r.cuerpo.pase), null);
  });

  test("solo por GET", async () => {
    const r = await llamar("POST", luis);
    assert.equal(r.codigo, 405);
  });

});

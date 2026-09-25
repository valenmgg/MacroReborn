// ==============================
// RENOVAR LA SESIÓN MIENTRAS SE USA — tests/sesion-renovar.test.js
// ==============================
// Reporte del 25/09/2026: "podía jugar pero no me contaba el XP, y no
// podía escribir en perfiles ni en el chat; cerré sesión, volví a entrar
// y se arregló". El pase de sesión caducaba a los 7 días de iniciar
// sesión y nunca se renovaba: pasado ese plazo, todo lo que escribe
// fallaba en silencio.
//
// Ahora requerirAuth() (api/_auth.js) renueva el pase de quien lo usa:
// si se firmó hace más de un día, la respuesta trae uno nuevo en la
// cabecera X-Sesion-Nueva. Con un tope de 30 días desde que se inició
// sesión, para que un pase robado no viva para siempre.
//
// Correr:  npm test

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret";

require("./_aislar-datos");   // antes de api/: ver ese archivo

const { test, before, describe } = require("node:test");
const assert = require("node:assert");

const auth = require("../api/_auth");

const DIA = 24 * 60 * 60 * 1000;

// Un pase firmado de verdad, pero como si fuera de hace un tiempo.
function paseDeHace({ iatDias, inicioDias, expDias }) {
  const ahora = Date.now();
  const carga = { sub: 7, username: "ana", iat: ahora - iatDias * DIA, exp: ahora + (expDias === undefined ? 1 : expDias) * DIA };
  if (inicioDias !== undefined) carga.inicio = ahora - inicioDias * DIA;
  return auth.firmar(carga);
}

// requerirAuth con una respuesta de mentira: devuelve la sesión y la
// cabecera que haya puesto.
function pedir(pase) {
  const cabeceras = {};
  const res = {
    status(c) { this.codigo = c; return this; },
    json(o) { this.cuerpo = o; return this; },
    setHeader(k, v) { cabeceras[k] = v; }
  };
  const sesion = auth.requerirAuth({ headers: { authorization: "Bearer " + pase } }, res);
  return { sesion, nuevo: cabeceras["X-Sesion-Nueva"] || null, res };
}

const carga = (pase) => JSON.parse(Buffer.from(pase.split(".")[0], "base64url").toString("utf8"));

describe("renovar el pase", () => {

  test("uno recién firmado no se renueva", () => {
    const { sesion, nuevo } = pedir(auth.crearToken({ id: 7, username: "ana" }));
    assert.equal(sesion.sub, 7);
    assert.equal(nuevo, null);
  });

  test("uno de hace más de un día se renueva: 7 días más, misma cuenta, mismo inicio", () => {
    const viejo = paseDeHace({ iatDias: 2, inicioDias: 5 });
    const { nuevo } = pedir(viejo);
    assert.ok(nuevo, "no llegó pase nuevo");
    const verificado = auth.verificarToken(nuevo);
    assert.equal(verificado.sub, 7);
    assert.equal(verificado.username, "ana");
    assert.equal(verificado.inicio, carga(viejo).inicio);
    assert.ok(Math.abs(verificado.exp - (Date.now() + 7 * DIA)) < 5000);
  });

  test("los pases de antes, sin inicio, cuentan desde que se firmaron", () => {
    const viejo = paseDeHace({ iatDias: 3 });
    const { nuevo } = pedir(viejo);
    assert.equal(carga(nuevo).inicio, carga(viejo).iat);
  });

  test("cerca del tope de 30 días, se renueva solo hasta el tope", () => {
    const { nuevo } = pedir(paseDeHace({ iatDias: 2, inicioDias: 27 }));
    const c = carga(nuevo);
    assert.ok(Math.abs(c.exp - (c.inicio + 30 * DIA)) < 1000, "pasó del tope");
  });

  test("pasado el tope ya no se renueva: toca iniciar sesión", () => {
    const { sesion, nuevo } = pedir(paseDeHace({ iatDias: 2, inicioDias: 31 }));
    assert.ok(sesion, "el pase sigue valiendo hasta que caduque");
    assert.equal(nuevo, null);
  });

  test("uno caducado no se renueva: 401, como siempre", () => {
    const { sesion, nuevo, res } = pedir(paseDeHace({ iatDias: 8, expDias: -1 }));
    assert.equal(sesion, null);
    assert.equal(nuevo, null);
    assert.equal(res.codigo, 401);
  });

  test("un pase de avisos no vale como sesión, y no se renueva", () => {
    const pase = auth.crearPase({ sub: 7, username: "ana" });
    const { sesion, nuevo } = pedir(pase);
    assert.equal(sesion, null);
    assert.equal(nuevo, null);
  });

});

describe("en una ruta de verdad", () => {

  let db;
  let handler;

  before(async () => {
    const { crearBaseLocal, crearSqlPGlite } = require("../scripts/pglite");
    const { usarSqlLocal } = require("../api/_db");
    db = await crearBaseLocal();
    usarSqlLocal(crearSqlPGlite(db));
    handler = require("../api/content");
  });

  test("mis-monedas, que la barra pide en cada página, trae el pase nuevo", async () => {
    const u = await db.query(
      `INSERT INTO users (username, password_hash, level, xp, status, created_at, last_login)
       VALUES ('ana', 'hash', 1, 0, 'active', now(), now()) RETURNING id`);
    const ahora = Date.now();
    const viejo = auth.firmar({ sub: Number(u.rows[0].id), username: "ana", iat: ahora - 2 * DIA, exp: ahora + 5 * DIA, inicio: ahora - 2 * DIA });

    const cabeceras = {};
    const cuerpo = await new Promise((resolve) => {
      handler({ method: "GET", query: { action: "mis-monedas" }, body: {}, headers: { authorization: "Bearer " + viejo } }, {
        status() { return this; },
        setHeader(k, v) { cabeceras[k] = v; },
        json(o) { resolve(o); },
        end() { resolve(null); }
      });
    });
    assert.equal(cuerpo.success, true);
    assert.ok(auth.verificarToken(cabeceras["X-Sesion-Nueva"]), "no llegó un pase nuevo válido");
  });

});

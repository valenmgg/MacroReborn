// ==============================
// UNA MENCIÓN, UNA NOTIFICACIÓN — tests/menciones-comentario.test.js
// ==============================
// Una mención en un comentario de perfil llegaba dos veces: el navegador
// creaba la notificación desde js/menciones.js, y ocho días después se
// añadió el mismo trabajo en el servidor sin quitar el del navegador.
// La del servidor además terminaba en dos puntos, porque el contexto ya
// venía con punto y la plantilla añadía otro.
//
// Acá se sujeta la mitad del servidor: un comentario con una mención
// produce exactamente una notificación de mención, con un solo punto.
// La otra mitad, que el navegador ya no la cree, está en
// tests/menciones-navegador.test.js.
//
// Correr:  npm test

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret";

require("./_aislar-datos");   // antes de api/: ver ese archivo

const { test, before, describe } = require("node:test");
const assert = require("node:assert");

const { crearBaseLocal, crearSqlPGlite } = require("../scripts/pglite");
const { usarSqlLocal } = require("../api/_db");
const { crearToken } = require("../api/_auth");

let db;
let contentHandler;
let idAna, idBeto, idCami;

async function crearUsuario(username) {
  const r = await db.query(
    `INSERT INTO users (username, password_hash, level, xp, status, created_at, last_login)
     VALUES ($1, 'hash', 1, 0, 'active', now(), now()) RETURNING id`,
    [username]
  );
  return Number(r.rows[0].id);
}

before(async () => {
  db = await crearBaseLocal();
  usarSqlLocal(crearSqlPGlite(db));
  contentHandler = require("../api/content");
  idAna = await crearUsuario("ana");
  idBeto = await crearUsuario("beto");
  idCami = await crearUsuario("cami");
});

function llamar(metodo, query, body, sesion) {
  return new Promise((resolve) => {
    const req = {
      method: metodo,
      query: Object.assign({}, query),
      body: body || {},
      headers: sesion
        ? { authorization: "Bearer " + crearToken({ id: sesion.id, username: sesion.username }) }
        : {}
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

async function notificacionesDe(userId) {
  const r = await db.query(
    "SELECT titulo, mensaje FROM notifications WHERE user_id = $1 ORDER BY id",
    [userId]
  );
  return r.rows;
}

describe("una mención en un comentario de perfil", () => {

  test("produce UNA notificación a quien se menciona, con un solo punto", async () => {
    await db.query("DELETE FROM notifications");

    const r = await llamar("POST", { action: "comments" },
      { profileUsername: "ana", texto: "hola @cami, mira esto" },
      { id: idBeto, username: "beto" });
    assert.equal(r.codigo, 200, JSON.stringify(r.cuerpo));

    const deCami = await notificacionesDe(idCami);
    const menciones = deCami.filter(n => n.titulo.includes("Te mencionaron"));

    assert.equal(menciones.length, 1, "llegaron " + menciones.length + " menciones: " + JSON.stringify(deCami));
    assert.equal(menciones[0].mensaje, "beto te mencionó en un comentario en el perfil de ana.");
    assert.ok(!menciones[0].mensaje.endsWith(".."), "termina en dos puntos");
  });

  test("y al dueño del perfil le llega el aviso de comentario, no el de mención", async () => {
    await db.query("DELETE FROM notifications");

    await llamar("POST", { action: "comments" },
      { profileUsername: "ana", texto: "hola @cami" },
      { id: idBeto, username: "beto" });

    const deAna = await notificacionesDe(idAna);
    assert.equal(deAna.length, 1, JSON.stringify(deAna));
    assert.ok(deAna[0].titulo.includes("Nuevo comentario"));
    assert.equal(deAna[0].mensaje, "beto comentó en tu perfil.");
  });

  test("mencionarse a uno mismo no notifica nada", async () => {
    await db.query("DELETE FROM notifications");

    await llamar("POST", { action: "comments" },
      { profileUsername: "ana", texto: "soy @beto" },
      { id: idBeto, username: "beto" });

    const deBeto = await notificacionesDe(idBeto);
    assert.equal(deBeto.length, 0, JSON.stringify(deBeto));
  });

});

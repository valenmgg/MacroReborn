// ==============================
// LAS LISTAS DEL PERFIL MANDAN LA HUELLA — tests/perfil-listas-api.test.js
// ==============================
// Fase 3 de docs/AVATARES-SERVIDOR.md, perfil público. Dos listas del
// perfil tenían su propia consulta y no mandaban con qué pedir el
// avatar compuesto, así que se dibujaba prenda por prenda:
//
//   LOS AMIGOS (/api/social?action=friends). Los usan también el perfil
//   propio, la página de amigos, explorar y la portada.
//
//   LA GALERÍA DE DISEÑOS GUARDADOS (/api/content?action=avatar-gallery).
//   Cada ranura tiene su propio compuesto, en /avatares/<id>/ranura<N>/:
//   hace falta el id del dueño y la huella de cada ranura. El "id" de
//   una ranura es el del diseño, no el de la persona, así que el de la
//   persona va aparte, como usuario_id.
//
// Correr:  npm test

require("./_aislar-datos");   // antes de api/: ver ese archivo

const { test, before, describe } = require("node:test");
const assert = require("node:assert");

const { crearBaseLocal, crearSqlPGlite } = require("../scripts/pglite");
const { usarSqlLocal } = require("../api/_db");

let db, social, content;
const ids = {};

const PNG = "data:image/png;base64," +
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const CAPAS = { modelo: "tora", pelo: "tora_pelo3" };
const HUELLA = "b1c2d3e4f5a6".repeat(5) + "abcd";
const HUELLA_RANURA = "c1d2e3f4a5b6".repeat(5) + "abcd";

async function crearCuenta(nombre, avatar, huella) {
  const r = await db.query(
    `INSERT INTO users (username, password_hash, level, xp, status, created_at, last_login, avatar, avatar_compuesto)
     VALUES ($1, 'hash', 3, 10, 'active', now(), now(), $2, $3) RETURNING id`,
    [nombre, avatar ? JSON.stringify(avatar) : null, huella || null]
  );
  return Number(r.rows[0].id);
}

before(async () => {
  db = await crearBaseLocal();
  usarSqlLocal(crearSqlPGlite(db));
  social = require("../api/social");
  content = require("../api/content");

  ids.luis = await crearCuenta("luis", CAPAS, HUELLA);
  ids.ana = await crearCuenta("ana", CAPAS, HUELLA);
  ids.jefa = await crearCuenta("jefa", { tipo: "png", src: PNG, restaurar: CAPAS });
  ids.nadie = await crearCuenta("nadie", null);

  for (const amigo of ["ana", "jefa", "nadie"]) {
    await db.query("INSERT INTO friendships (user_id, friend_id) VALUES ($1, $2)", [ids.luis, ids[amigo]]);
  }

  await db.query(
    `INSERT INTO saved_avatars (user_id, slot, avatar, avatar_compuesto) VALUES
       ($1, 1, $2, $3), ($1, 3, $2, NULL)`,
    [ids.luis, JSON.stringify(CAPAS), HUELLA_RANURA]);
});

function pedir(handler, query) {
  return new Promise((resolve) => {
    const req = { method: "GET", query, body: {}, headers: {} };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      setHeader() {},
      json(obj) { resolve({ codigo: this.statusCode, cuerpo: obj }); },
      end(c) { resolve({ codigo: this.statusCode, cuerpo: c }); }
    };
    handler(req, res);
  });
}

describe("los amigos", () => {

  test("traen su id y su huella", async () => {
    const r = await pedir(social, { action: "friends", username: "luis" });
    assert.equal(r.codigo, 200, JSON.stringify(r.cuerpo));
    const amigos = Object.fromEntries(r.cuerpo.amigos.map(a => [a.username, a]));

    assert.deepStrictEqual(Object.keys(amigos).sort(), ["ana", "jefa", "nadie"]);
    for (const nombre of Object.keys(amigos)) {
      assert.equal(amigos[nombre].id, ids[nombre], nombre + ": no viaja su id");
    }
    assert.equal(amigos.ana.avatar_compuesto, HUELLA);
    assert.equal(amigos.nadie.avatar_compuesto, null);
  });

  test("y el PNG de administrador sigue yendo recortado", async () => {
    const r = await pedir(social, { action: "friends", username: "luis" });
    const jefa = r.cuerpo.amigos.find(a => a.username === "jefa");
    assert.ok(!JSON.stringify(jefa.avatar).includes("base64"), "el PNG viaja entero");
    assert.match(jefa.avatar.url, /^\/api\/users\?action=avatar-png&username=jefa&v=/);
  });

});

describe("la galería de diseños guardados", () => {

  test("trae el id del dueño aparte, y la huella de cada ranura", async () => {
    const r = await pedir(content, { action: "avatar-gallery", username: "luis" });
    assert.equal(r.codigo, 200, JSON.stringify(r.cuerpo));
    assert.equal(r.cuerpo.usuario_id, ids.luis, "no viaja el id del dueño");

    const porRanura = Object.fromEntries(r.cuerpo.slots.map(s => [s.slot, s]));
    assert.equal(porRanura[1].avatar_compuesto, HUELLA_RANURA);
    assert.equal(porRanura[3].avatar_compuesto, null, "sin huella tiene que llegar null");
    assert.equal(porRanura[2].avatar, null, "una ranura vacía sigue vacía");
  });

});

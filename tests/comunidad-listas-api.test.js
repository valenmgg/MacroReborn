// ==============================
// LAS LISTAS PEQUEÑAS DE COMUNIDAD — tests/comunidad-listas-api.test.js
// ==============================
// Fase 3 de docs/AVATARES-SERVIDOR.md, página de comunidad. Además de
// la cuadrícula principal, la página pinta tres listas con su propia
// consulta: recién llegados (community-stats), moderación
// (moderators-status) y la actividad (community-feed).
//
// Las tres mandaban solo el nombre y el avatar, así que el navegador no
// tenía con qué pedir el compuesto y dibujaba cada avatar prenda por
// prenda: 64 imágenes sueltas de /prendas/ medidas en producción el
// 24/09/2026.
//
// Lo que se sujeta:
//
//   EL ID Y LA HUELLA VIAJAN. Sin el id no hay dirección; sin la
//   huella, la dirección no se puede cachear un año.
//
//   EN LA ACTIVIDAD SE LLAMA usuario_id. La fila es una actividad, no
//   una persona: un "id" ahí se confundiría con el de la actividad.
//
//   EL PNG DE ADMINISTRADOR VA RECORTADO. Las tres mandaban el base64
//   entero, el mismo fallo de 1,35 MB que ya se arregló en /api/users y
//   en la lista de amigos.
//
// Correr:  npm test

require("./_aislar-datos");   // antes de api/: ver ese archivo

const { test, before, describe } = require("node:test");
const assert = require("node:assert");

const { crearBaseLocal, crearSqlPGlite } = require("../scripts/pglite");
const { usarSqlLocal } = require("../api/_db");

let db, system, content;
const ids = {};

// Un PNG real de 1x1, y la receta de capas de alguien normal.
const PNG = "data:image/png;base64," +
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const CAPAS = { modelo: "tora", pelo: "tora_pelo3" };
const HUELLA = "a1b2c3d4e5f6".repeat(5) + "abcd";

async function crearCuenta(nombre, avatar, huella) {
  const r = await db.query(
    `INSERT INTO users (username, password_hash, level, xp, status, created_at, last_login, avatar, avatar_compuesto)
     VALUES ($1, 'hash', 1, 0, 'active', now(), now(), $2, $3) RETURNING id`,
    [nombre, avatar ? JSON.stringify(avatar) : null, huella || null]
  );
  return Number(r.rows[0].id);
}

before(async () => {
  db = await crearBaseLocal();
  usarSqlLocal(crearSqlPGlite(db));
  system = require("../api/system");
  content = require("../api/content");

  ids.ana = await crearCuenta("ana", CAPAS, HUELLA);
  ids.jefa = await crearCuenta("jefa", { tipo: "png", src: PNG, restaurar: CAPAS });
  ids.nadie = await crearCuenta("nadie", null);

  await db.query(`INSERT INTO badges (user_id, badge_id) VALUES ($1, 'administrador'), ($2, 'moderador')`,
    [ids.jefa, ids.ana]);
  await db.query(`INSERT INTO activity_log (user_id, tipo, detalle) VALUES
    ($1, 'comentario', 'x'), ($2, 'favorito', 'y'), ($3, 'logro', 'z')`,
    [ids.ana, ids.jefa, ids.nadie]);
});

function pedir(handler, action) {
  return new Promise((resolve) => {
    const req = { method: "GET", query: { action }, body: {}, headers: {} };
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

// Lo que tiene que cumplir cada persona de cada lista, se llame como se
// llame su id en esa lista.
function comprobarPersona(p, campoId) {
  const nombre = p.username;
  assert.equal(p[campoId], ids[nombre], nombre + ": no viaja su " + campoId);

  if (nombre === "ana") {
    assert.equal(p.avatar_compuesto, HUELLA, "ana: no viaja la huella");
  }
  if (nombre === "jefa") {
    const texto = JSON.stringify(p.avatar);
    assert.ok(!texto.includes("base64"), "jefa: el PNG viaja entero");
    assert.match(p.avatar.url, /^\/api\/users\?action=avatar-png&username=jefa&v=/);
    assert.deepStrictEqual(p.avatar.restaurar, CAPAS, "jefa: se perdió la receta a restaurar");
  }
  if (nombre === "nadie") {
    assert.equal(p.avatar, null);
    assert.equal(p.avatar_compuesto, null);
  }
}

describe("recién llegados", () => {
  test("traen el id, la huella y el PNG recortado", async () => {
    const r = await pedir(system, "community-stats");
    assert.equal(r.codigo, 200, JSON.stringify(r.cuerpo));
    const lista = r.cuerpo.recienLlegados;
    assert.equal(lista.length, 3);
    for (const p of lista) comprobarPersona(p, "id");
  });
});

describe("moderación", () => {
  test("trae el id, la huella y el PNG recortado", async () => {
    const r = await pedir(system, "moderators-status");
    assert.equal(r.codigo, 200, JSON.stringify(r.cuerpo));
    const staff = r.cuerpo.staff;
    assert.deepStrictEqual(staff.map(s => s.username), ["jefa", "ana"], "cambió el orden por rol");
    for (const p of staff) comprobarPersona(p, "id");
    assert.equal(staff[0].rol, "administrador");
    assert.equal(typeof staff[0].conectado, "boolean");
  });
});

describe("actividad", () => {
  test("trae usuario_id, la huella y el PNG recortado", async () => {
    const r = await pedir(content, "community-feed");
    assert.equal(r.codigo, 200, JSON.stringify(r.cuerpo));
    const lista = r.cuerpo.actividades;
    assert.equal(lista.length, 3);
    for (const p of lista) comprobarPersona(p, "usuario_id");
  });

  test("y no un id, que se confundiría con el de la actividad", async () => {
    const r = await pedir(content, "community-feed");
    for (const a of r.cuerpo.actividades) {
      assert.ok(!("id" in a), "la actividad trae un id suelto: " + JSON.stringify(a));
    }
  });
});

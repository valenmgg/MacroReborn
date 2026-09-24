// ==============================
// AL GUARDAR EL AVATAR SE COMPONE — tests/avatar-compuesto-guardar.test.js
// ==============================
// El compositor y su almacen se prueban aparte. Esto prueba el gancho:
// que guardar un avatar por la API de verdad deje la huella en la base
// y los JPG en el disco, sin que quien guarda tenga que saber nada.
//
// Se compone AL GUARDAR y no al mirar por una razon de tamano: una
// pagina de comunidad pide 500 usuarios de golpe, y componer ahi serian
// 500 composiciones de 156 ms en una maquina de dos nucleos. Al
// guardar, es una vez cada vez que alguien se cambia de ropa.
//
// Y lo que mas importa aqui: GUARDAR NO PUEDE FALLAR POR ESTO. Si el
// disco esta lleno o el catalogo no responde, la persona se queda sin
// compuesto hasta el siguiente guardado, nunca sin poder guardar.
//
// Correr:  npm test

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret";

require("./_aislar-datos");   // antes de api/: ver ese archivo

const { test, before, after, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TEMPORAL = fs.mkdtempSync(path.join(os.tmpdir(), "mr-guardar-"));
process.env.MR_AVATARES_DIR = TEMPORAL;

const { crearBaseLocal, crearSqlPGlite } = require("../scripts/pglite");
const { usarSqlLocal } = require("../api/_db");
const { crearToken } = require("../api/_auth");
const lienzo = require("../api/_lienzo");
const AC = require("../api/_avatar-compuesto");

let db, usersHandler, idAna;

function png(r, g, b) {
  const rgba = Buffer.alloc(327 * 504 * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
  }
  return lienzo.escribirRGBA8({ rgba, ancho: 327, alto: 504 });
}

async function sembrarPrenda(valor, capa, sha, color) {
  const binario = png(color, 120, 200);
  const arch = await db.query(
    `INSERT INTO avatar_archivos (sha256, datos, ancho, alto, peso)
     VALUES ($1, $2, 327, 504, $3) RETURNING id`,
    [sha, binario, binario.length]
  );
  await db.query(
    `INSERT INTO avatar_prendas (valor, modelo, capa, nombre, archivo_id, publicada)
     VALUES ($1, 'tora', $2, $1, $3, true)`,
    [valor, capa, arch.rows[0].id]
  );
}

before(async () => {
  db = await crearBaseLocal();
  usarSqlLocal(crearSqlPGlite(db));
  usersHandler = require("../api/users");

  await sembrarPrenda("tora", "modelo", "a".repeat(64), 200);
  await sembrarPrenda("tora_fondo9", "fondo", "b".repeat(64), 30);  // tora_fondo1 y tora_fondo2 los siembra la migracion 018 en la tienda
  await sembrarPrenda("tora_pelo3", "pelo", "c".repeat(64), 60);

  const r = await db.query(
    `INSERT INTO users (username, password_hash, level, xp, status, created_at, last_login)
     VALUES ('ana', 'hash', 1, 0, 'active', now(), now()) RETURNING id`
  );
  idAna = Number(r.rows[0].id);
});

after(() => {
  fs.rmSync(TEMPORAL, { recursive: true, force: true });
});

function guardar(avatar, sesion) {
  return new Promise((resolve) => {
    const req = {
      method: "POST",
      query: { action: "update-avatar" },
      body: { username: sesion.username, avatar },
      headers: { authorization: "Bearer " + crearToken(sesion) }
    };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      setHeader() {},
      json(obj) { resolve({ codigo: this.statusCode, cuerpo: obj }); },
      end(cuerpo) { resolve({ codigo: this.statusCode, cuerpo }); }
    };
    usersHandler(req, res);
  });
}

async function filaDeAna() {
  const r = await db.query("SELECT avatar, avatar_compuesto FROM users WHERE id = $1", [idAna]);
  return r.rows[0];
}

const ana = () => ({ id: idAna, username: "ana" });
const DESTINO = () => ({ usuarioId: idAna });

describe("guardar un avatar", () => {

  test("deja la huella en la base y los JPG en el disco", async () => {
    const r = await guardar({ fondo: "tora_fondo9", modelo: "tora", pelo: "tora_pelo3" }, ana());
    assert.equal(r.codigo, 200, JSON.stringify(r.cuerpo));

    const fila = await filaDeAna();
    assert.match(fila.avatar_compuesto, /^[a-f0-9]{64}$/, "no se guardo la huella");

    for (const [a, l] of AC.TAMANOS) {
      assert.ok(fs.existsSync(AC.rutaDe(DESTINO(), a, l)), a + "x" + l + " no esta en disco");
    }
  });

  test("y la respuesta la devuelve, para que el navegador no tenga que pedirla", async () => {
    const r = await guardar({ modelo: "tora", pelo: "tora_pelo3" }, ana());
    assert.match(r.cuerpo.user.avatar_compuesto, /^[a-f0-9]{64}$/);
  });

  test("cambiarse de ropa cambia la huella", async () => {
    await guardar({ modelo: "tora", pelo: "tora_pelo3" }, ana());
    const antes = (await filaDeAna()).avatar_compuesto;

    await guardar({ modelo: "tora", fondo: "tora_fondo9" }, ana());
    const despues = (await filaDeAna()).avatar_compuesto;

    assert.notEqual(antes, despues, "la huella no cambio con el avatar");
    assert.ok(fs.existsSync(AC.rutaDe(DESTINO(), 62, 96)));
  });

  test("y volver al de antes devuelve la huella de antes", async () => {
    // La huella es la version, y depende solo de la ropa. El archivo
    // SI se reescribe, porque con nombre fijo el de ayer podria llevar
    // la ropa de ayer.
    await guardar({ modelo: "tora", pelo: "tora_pelo3" }, ana());
    const primera = (await filaDeAna()).avatar_compuesto;

    await guardar({ modelo: "tora", fondo: "tora_fondo9" }, ana());
    await guardar({ modelo: "tora", pelo: "tora_pelo3" }, ana());

    assert.equal((await filaDeAna()).avatar_compuesto, primera);
  });

  test("y la direccion es la misma siempre, aunque cambie la ropa", async () => {
    // El corazon del cambio del 21/09/2026: la direccion es de la
    // persona, el archivo se reescribe, y no queda nada huerfano.
    await guardar({ modelo: "tora", pelo: "tora_pelo3" }, ana());
    const ruta = AC.rutaDe(DESTINO(), 62, 96);
    const antes = fs.readFileSync(ruta);

    await guardar({ modelo: "tora", fondo: "tora_fondo9" }, ana());

    assert.ok(!antes.equals(fs.readFileSync(ruta)), "el archivo no cambio");
    assert.equal(fs.readdirSync(AC.carpetaDe(DESTINO())).length, 2, "quedaron archivos de mas");
    assert.equal(AC.urlDe(DESTINO(), null, 62, 96), "/avatares/" + idAna + "/62x96.jpg");
  });

  test("un avatar sin ninguna prenda se guarda igual, con la huella en NULL", async () => {
    const r = await guardar({ modelo: "ninguno", pelo: "ninguno" }, ana());
    assert.equal(r.codigo, 200, JSON.stringify(r.cuerpo));
    assert.equal((await filaDeAna()).avatar_compuesto, null);
  });

  test("y sin dejar en el disco el compuesto de la ropa de antes", async () => {
    // La direccion desnuda sirve lo que haya en el disco: si se quedara,
    // seguiria enseñando lo que esta persona ya no lleva puesto.
    AC.olvidarPresupuesto();
    await guardar({ modelo: "tora", pelo: "tora_pelo3" }, ana());
    assert.ok(AC.leer(DESTINO(), 62, 96));

    await guardar({ modelo: "ninguno", pelo: "ninguno" }, ana());
    assert.equal(AC.leer(DESTINO(), 62, 96), null, "se quedo el compuesto de antes");
  });

  test("sin sesion no se guarda nada, como antes", async () => {
    const r = await new Promise((resolve) => {
      const req = { method: "POST", query: { action: "update-avatar" }, body: { username: "ana", avatar: {} }, headers: {} };
      const res = {
        statusCode: 200,
        status(c) { this.statusCode = c; return this; },
        setHeader() {},
        json(obj) { resolve({ codigo: this.statusCode, cuerpo: obj }); },
        end(c) { resolve({ codigo: this.statusCode, cuerpo: c }); }
      };
      usersHandler(req, res);
    });
    assert.equal(r.codigo, 401);
  });

});

describe("ponerse un PNG de administrador", () => {

  // Un PNG real de 1x1: el endpoint comprueba la firma.
  const PNG_1PX = "data:image/png;base64," +
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  function ponerPNG(sesion) {
    return new Promise((resolve) => {
      const req = {
        method: "POST",
        query: { action: "update-admin-avatar-png" },
        body: { username: sesion.username, avatarPng: PNG_1PX },
        headers: { authorization: "Bearer " + crearToken(sesion) }
      };
      const res = {
        statusCode: 200,
        status(c) { this.statusCode = c; return this; },
        setHeader() {},
        json(obj) { resolve({ codigo: this.statusCode, cuerpo: obj }); },
        end(cuerpo) { resolve({ codigo: this.statusCode, cuerpo }); }
      };
      usersHandler(req, res);
    });
  }

  test("se lleva la huella y el JPG de la ropa de antes", async () => {
    // Con la huella puesta, las listas seguirian pidiendo el compuesto
    // de lo que llevaba antes en vez de su PNG.
    await db.query(
      `INSERT INTO badges (user_id, badge_id) VALUES ($1, 'administrador')
       ON CONFLICT (user_id, badge_id) DO NOTHING`, [idAna]);
    AC.olvidarPresupuesto();
    await guardar({ modelo: "tora", pelo: "tora_pelo3" }, ana());
    assert.ok((await filaDeAna()).avatar_compuesto);
    assert.ok(AC.leer(DESTINO(), 62, 96));

    const r = await ponerPNG(ana());
    assert.equal(r.codigo, 200, JSON.stringify(r.cuerpo));

    assert.equal((await filaDeAna()).avatar_compuesto, null, "se quedo la huella de la ropa");
    assert.equal(r.cuerpo.user.avatar_compuesto, null);
    for (const [a, l] of AC.TAMANOS) {
      assert.equal(AC.leer(DESTINO(), a, l), null, a + "x" + l + " se quedo en el disco");
    }
  });

  test("y volver a las prendas lo compone otra vez", async () => {
    AC.olvidarPresupuesto();
    const r = await guardar({ modelo: "tora", pelo: "tora_pelo3" }, ana());
    assert.equal(r.codigo, 200, JSON.stringify(r.cuerpo));
    assert.match((await filaDeAna()).avatar_compuesto, /^[a-f0-9]{64}$/);
    assert.ok(AC.leer(DESTINO(), 62, 96));
  });

});

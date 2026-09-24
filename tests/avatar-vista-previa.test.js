// ==============================
// LA VISTA PREVIA DEL EDITOR — tests/avatar-vista-previa.test.js
// ==============================
// Fase 5 de docs/AVATARES-SERVIDOR.md: la ropa que se va eligiendo en
// el editor la dibuja el servidor, en vez de apilar las prendas sueltas
// en el navegador. Ver api/_vista-previa.js.
//
// Lo que se sujeta:
//
//   SOLO LO QUE ESA PERSONA PODRÍA GUARDAR. Una prenda sin publicar no
//   se dibuja: si no, la vista previa serviría para ver lo que el equipo
//   de arte todavía no ha sacado. Lo retirado que ya lleva puesto, sí.
//   Y una de la tienda, solo comprada: si no, se sacaría entera sin
//   pagarla, y la tienda solo enseña su previsualización.
//
//   LO YA DIBUJADO NO GASTA. El tope es por dibujo nuevo; volver a una
//   combinación ya probada sale de memoria.
//
//   Y SIN SESIÓN, NADA.
//
// Correr:  npm test

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret";

require("./_aislar-datos");   // antes de api/: ver ese archivo

const { test, before, beforeEach, describe } = require("node:test");
const assert = require("node:assert");

const { crearBaseLocal, crearSqlPGlite } = require("../scripts/pglite");
const { usarSqlLocal } = require("../api/_db");
const { crearToken } = require("../api/_auth");
const lienzo = require("../api/_lienzo");
const VP = require("../api/_vista-previa");

let db, usersHandler, idAna;

function png(r, g, b) {
  const rgba = Buffer.alloc(327 * 504 * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
  }
  return lienzo.escribirRGBA8({ rgba, ancho: 327, alto: 504 });
}

let sembradas = 0;
async function sembrarPrenda(valor, capa, publicada) {
  sembradas++;
  const binario = png(sembradas * 20 % 256, 90, 160);
  const arch = await db.query(
    `INSERT INTO avatar_archivos (sha256, datos, ancho, alto, peso)
     VALUES ($1, $2, 327, 504, $3) RETURNING id`,
    [String(sembradas).padStart(64, "0"), binario, binario.length]
  );
  await db.query(
    `INSERT INTO avatar_prendas (valor, modelo, capa, nombre, archivo_id, publicada)
     VALUES ($1, 'tora', $2, $1, $3, $4)`,
    [valor, capa, arch.rows[0].id, publicada]
  );
}

before(async () => {
  db = await crearBaseLocal();
  usarSqlLocal(crearSqlPGlite(db));
  usersHandler = require("../api/users");

  await sembrarPrenda("tora", "modelo", true);
  for (let n = 1; n <= 8; n++) await sembrarPrenda("tora_pelo9" + n, "pelo", true);
  for (let n = 1; n <= 8; n++) await sembrarPrenda("tora_remera9" + n, "remera", true);
  await sembrarPrenda("tora_pelo89", "pelo", true);      // de la tienda
  await sembrarPrenda("tora_pelo80", "pelo", false);     // sin publicar
  await sembrarPrenda("tora_remera80", "remera", false); // retirada, pero ana la lleva
  await db.query(
    `INSERT INTO avatar_shop_items (categoria, modelo, valor_capa, nombre, precio)
     VALUES ('pelo', 'tora', 'tora_pelo89', 'De la tienda', 500)`);

  const r = await db.query(
    `INSERT INTO users (username, password_hash, level, xp, status, created_at, last_login, avatar)
     VALUES ('ana', 'hash', 1, 0, 'active', now(), now(), $1) RETURNING id`,
    [JSON.stringify({ modelo: "tora", remera: "tora_remera80" })]
  );
  idAna = Number(r.rows[0].id);
});

beforeEach(() => VP.olvidar());

function pedirVista(avatar, conSesion = true) {
  return new Promise((resolve) => {
    const req = {
      method: "POST",
      query: { action: "avatar-vista-previa" },
      body: { avatar },
      headers: conSesion ? { authorization: "Bearer " + crearToken({ id: idAna, username: "ana" }) } : {}
    };
    const cabeceras = {};
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      setHeader(k, v) { cabeceras[k] = v; },
      json(obj) { resolve({ codigo: this.statusCode, cuerpo: obj, cabeceras }); },
      end(cuerpo) { resolve({ codigo: this.statusCode, cuerpo, cabeceras }); }
    };
    usersHandler(req, res);
  });
}

describe("la vista previa del editor", () => {

  test("dibuja la ropa sin guardarla, como un JPG", async () => {
    const r = await pedirVista({ modelo: "tora", pelo: "tora_pelo91" });
    assert.equal(r.codigo, 200, JSON.stringify(r.cuerpo));
    assert.equal(r.cabeceras["Content-Type"], "image/jpeg");
    assert.equal(r.cuerpo[0], 0xFF);
    assert.equal(r.cuerpo[1], 0xD8);

    const fila = await db.query("SELECT avatar FROM users WHERE id = $1", [idAna]);
    assert.equal(fila.rows[0].avatar.pelo, undefined, "la vista previa guardó el avatar");
  });

  test("no se cachea: es ropa que todavía no se ha decidido", async () => {
    const r = await pedirVista({ modelo: "tora", pelo: "tora_pelo91" });
    assert.equal(r.cabeceras["Cache-Control"], "no-store");
  });

  test("una prenda sin publicar no se dibuja", async () => {
    // Si se dibujara, la vista previa enseñaría lo que el equipo de arte
    // todavía no ha sacado.
    const r = await pedirVista({ modelo: "tora", pelo: "tora_pelo80" });
    assert.equal(r.codigo, 400);
    assert.match(r.cuerpo.error, /no existe/);
  });

  test("lo retirado que ya lleva puesto, sí", async () => {
    const r = await pedirVista({ modelo: "tora", remera: "tora_remera80" });
    assert.equal(r.codigo, 200, JSON.stringify(r.cuerpo));
  });

  test("una de la tienda sin comprar no se dibuja, como al guardar", async () => {
    const r = await pedirVista({ modelo: "tora", pelo: "tora_pelo89" });
    assert.equal(r.codigo, 400);
    assert.match(r.cuerpo.error, /compraste/);
  });

  test("y comprada, sí", async () => {
    const item = await db.query("SELECT id FROM avatar_shop_items WHERE valor_capa = 'tora_pelo89'");
    await db.query("INSERT INTO avatar_shop_purchases (user_id, item_id) VALUES ($1, $2)",
      [idAna, item.rows[0].id]);
    try {
      const r = await pedirVista({ modelo: "tora", pelo: "tora_pelo89" });
      assert.equal(r.codigo, 200, JSON.stringify(r.cuerpo));
    } finally {
      await db.query("DELETE FROM avatar_shop_purchases WHERE user_id = $1", [idAna]);
    }
  });

  test("sin ninguna prenda no hay nada que dibujar: 204", async () => {
    const r = await pedirVista({ modelo: "ninguno", pelo: "ninguno" });
    assert.equal(r.codigo, 204);
  });

  test("sin sesión, nada", async () => {
    const r = await pedirVista({ modelo: "tora" }, false);
    assert.equal(r.codigo, 401);
  });

  test("tiene un tope de dibujos nuevos por minuto", async () => {
    const codigos = [];
    let n = 0;
    for (let p = 1; p <= 8 && n <= VP.TOPE_POR_MINUTO; p++) {
      for (let q = 1; q <= 8 && n <= VP.TOPE_POR_MINUTO; q++, n++) {
        codigos.push((await pedirVista({ modelo: "tora", pelo: "tora_pelo9" + p, remera: "tora_remera9" + q })).codigo);
      }
    }
    assert.equal(codigos.filter(c => c === 200).length, VP.TOPE_POR_MINUTO);
    assert.equal(codigos[codigos.length - 1], 429);
  });

  test("pero lo ya dibujado sale de memoria y no gasta", async () => {
    const ya = { modelo: "tora", pelo: "tora_pelo91", remera: "tora_remera91" };
    const primera = await pedirVista(ya);
    assert.equal(primera.codigo, 200);

    // Gastar el tope con todas las demás combinaciones de pelo y remera:
    // con la primera son 64, más que el tope.
    assert.ok(64 > VP.TOPE_POR_MINUTO, "hacen falta más combinaciones para gastar el tope");
    for (let p = 1; p <= 8; p++) {
      for (let q = 1; q <= 8; q++) {
        if (p === 1 && q === 1) continue;
        await pedirVista({ modelo: "tora", pelo: "tora_pelo9" + p, remera: "tora_remera9" + q });
      }
    }
    // Una que no se ha dibujado nunca: frenada.
    const otra = await pedirVista({ modelo: "tora", pelo: "tora_pelo95" });
    assert.equal(otra.codigo, 429, "el tope no se gastó");

    const repetida = await pedirVista(ya);
    assert.equal(repetida.codigo, 200, "lo ya dibujado también se frenó");
    assert.ok(repetida.cuerpo.equals(primera.cuerpo));
  });

});

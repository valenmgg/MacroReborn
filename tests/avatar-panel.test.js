// ==============================
// TESTS DEL PANEL DEL EQUIPO DE ARTE — tests/avatar-panel.test.js
// ==============================
// Las rutas que permiten al equipo de dibujo subir, publicar y retirar
// prendas sin commit ni despliegue.
//
// Lo que se prueba acá:
//   - Quién entra: hace falta el rol, y sin él no se ve nada.
//   - Una tanda con un fichero malo no tumba a los buenos.
//   - Lo que se rechaza al subir: lo que no es un PNG de verdad, lo que
//     pesa de más, la ranura inventada, el personaje inexistente, el
//     nombre vacío y el precio negativo.
//   - El identificador lo genera el servidor, nunca el artista.
//   - Dos prendas con el mismo dibujo comparten fichero.
//   - Precio 0 es gratis; con precio entra en la tienda.
//   - Retirar no borra, y solo puede el autor o un administrador.
//   - Cada cambio sube la versión del catálogo, que es lo que hace que
//     los dos procesos del cluster se enteren.
//
// Correr:  npm test

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret";

const { test, before, describe } = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");

const { crearBaseLocal, crearSqlPGlite } = require("../scripts/pglite");
const { usarSqlLocal } = require("../api/_db");
const { crearToken } = require("../api/_auth");

let db;
let contentHandler;
let idArtista, idOtroArtista, idAdmin, idPelado;

// PNGs reales de 1x1, distintos entre sí.
const PNG_A = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const PNG_B = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

const comoDataUrl = b => "data:image/png;base64," + b.toString("base64");

async function crearUsuario(username, badge) {
  const r = await db.query(
    `INSERT INTO users (username, password_hash, level, xp, status, created_at, last_login)
     VALUES ($1, 'hash', 1, 0, 'active', now(), now()) RETURNING id`,
    [username]
  );
  const id = r.rows[0].id;
  if (badge) {
    await db.query(`INSERT INTO badges (user_id, badge_id) VALUES ($1, $2)`, [id, badge]);
  }
  return id;
}

function llamar(metodo, query, body, sesion) {
  return new Promise((resolve) => {
    const cabeceras = {};
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
      setHeader(k, v) { cabeceras[k] = v; },
      json(obj) { resolve({ codigo: this.statusCode, cuerpo: obj, cabeceras }); },
      end(cuerpo) { resolve({ codigo: this.statusCode, cuerpo, cabeceras }); }
    };
    contentHandler(req, res);
  });
}

const panel = sesion => llamar("GET", { action: "avatar-panel" }, {}, sesion);
const subir = (prendas, sesion) => llamar("POST", { action: "avatar-subir-prendas" }, { prendas }, sesion);
const estado = (id, publicada, sesion) => llamar("POST", { action: "avatar-estado-prenda" }, { id, publicada }, sesion);

async function version() {
  const r = await db.query("SELECT version FROM avatar_catalogo_version WHERE id = 1");
  return Number(r.rows[0].version);
}

function prendaDePrueba(extra) {
  return Object.assign({
    archivo: "dibujo.png",
    modelo: "tora",
    capa: "remera",
    nombre: "Remera nueva",
    precio: 0,
    png: comoDataUrl(PNG_A)
  }, extra || {});
}

before(async () => {
  db = await crearBaseLocal();
  usarSqlLocal(crearSqlPGlite(db));
  contentHandler = require("../api/content");

  idArtista = await crearUsuario("dibujante", "artista");
  idOtroArtista = await crearUsuario("otro_dibujante", "artista");
  idAdmin = await crearUsuario("jefa", "administrador");
  idPelado = await crearUsuario("cualquiera", null);

  // Un personaje base, que es lo que valida el campo "modelo".
  const sha = crypto.createHash("sha256").update(PNG_B).digest("hex");
  const a = await db.query(
    `INSERT INTO avatar_archivos (sha256, datos, ancho, alto, peso)
     VALUES ($1, $2, 327, 504, $3) RETURNING id`,
    [sha, PNG_B, PNG_B.length]
  );
  await db.query(
    `INSERT INTO avatar_prendas (valor, modelo, capa, nombre, archivo_id, publicada)
     VALUES ('tora', 'tora', 'modelo', 'Tora', $1, true)`,
    [a.rows[0].id]
  );
});

const ARTISTA = () => ({ id: idArtista, username: "dibujante" });
const OTRO = () => ({ id: idOtroArtista, username: "otro_dibujante" });
const ADMIN = () => ({ id: idAdmin, username: "jefa" });
const PELADO = () => ({ id: idPelado, username: "cualquiera" });

// ==============================

describe("quién entra al panel", () => {
  test("sin sesión, no", async () => {
    assert.equal((await panel(null)).codigo, 401);
  });

  test("con sesión pero sin el rol, tampoco", async () => {
    const r = await panel(PELADO());
    assert.equal(r.codigo, 403);
    assert.match(r.cuerpo.error, /equipo de arte/i);
  });

  test("un artista sí, y sabe que no es administrador", async () => {
    const r = await panel(ARTISTA());
    assert.equal(r.codigo, 200);
    assert.equal(r.cuerpo.esAdmin, false);
    assert.equal(r.cuerpo.yo, "dibujante");
  });

  test("un administrador también", async () => {
    const r = await panel(ADMIN());
    assert.equal(r.codigo, 200);
    assert.equal(r.cuerpo.esAdmin, true);
  });

  test("el panel no ofrece 'modelo' como ranura para subir", async () => {
    // Por ahora solo se añaden prendas a personajes que ya existen.
    const r = await panel(ARTISTA());
    assert.ok(!r.cuerpo.capas.includes("modelo"));
    assert.ok(r.cuerpo.capas.includes("remera"));
    assert.equal(r.cuerpo.capas.length, 14);
  });

  test("subir requiere el rol igual que mirar", async () => {
    assert.equal((await subir([prendaDePrueba()], PELADO())).codigo, 403);
    assert.equal((await subir([prendaDePrueba()], null)).codigo, 401);
  });
});

describe("subir prendas", () => {
  test("una prenda válida entra, con su identificador generado", async () => {
    const antes = await version();
    const r = await subir([prendaDePrueba({ nombre: "Remera de rayas" })], ARTISTA());

    assert.equal(r.codigo, 200);
    assert.equal(r.cuerpo.entraron, 1);
    assert.equal(r.cuerpo.fallaron, 0);

    const uno = r.cuerpo.resultados[0];
    assert.equal(uno.ok, true);
    // El artista mandó "dibujo.png" y "Remera de rayas"; el identificador
    // lo pone el servidor.
    assert.equal(uno.valor, "tora_remera1");
    assert.equal(uno.medidas, "1x1");

    const fila = await db.query("SELECT * FROM avatar_prendas WHERE valor = 'tora_remera1'");
    assert.equal(fila.rows[0].nombre, "Remera de rayas");
    assert.equal(Number(fila.rows[0].autor_id), idArtista);
    assert.equal(fila.rows[0].publicada, true);

    assert.ok(await version() > antes, "subir debe mover la versión del catálogo");
  });

  test("la siguiente prenda de la misma ranura toma el número libre", async () => {
    const r = await subir([prendaDePrueba({ png: comoDataUrl(PNG_B) })], ARTISTA());
    assert.equal(r.cuerpo.resultados[0].valor, "tora_remera2");
  });

  test("dos prendas con el mismo dibujo comparten fichero", async () => {
    const r = await subir([prendaDePrueba({ capa: "cara", nombre: "Cara A" })], ARTISTA());
    assert.equal(r.cuerpo.entraron, 1);

    const sha = crypto.createHash("sha256").update(PNG_A).digest("hex");
    const archivos = await db.query("SELECT count(*)::int AS n FROM avatar_archivos WHERE sha256 = $1", [sha]);
    assert.equal(archivos.rows[0].n, 1, "el dibujo debería guardarse una sola vez");

    const prendas = await db.query(
      `SELECT count(*)::int AS n FROM avatar_prendas p
       JOIN avatar_archivos a ON a.id = p.archivo_id WHERE a.sha256 = $1`, [sha]);
    assert.ok(prendas.rows[0].n >= 2, "pero varias prendas pueden apuntarlo");
  });

  test("con precio entra en la tienda; con 0 es gratis", async () => {
    const r = await subir([
      prendaDePrueba({ capa: "guantes", nombre: "Guantes caros", precio: 250, png: comoDataUrl(PNG_B) }),
      prendaDePrueba({ capa: "guantes", nombre: "Guantes gratis", precio: 0 })
    ], ARTISTA());

    assert.equal(r.cuerpo.entraron, 2);
    const caros = r.cuerpo.resultados[0].valor;
    const gratis = r.cuerpo.resultados[1].valor;

    const tienda = await db.query("SELECT valor_capa, precio FROM avatar_shop_items WHERE valor_capa IN ($1,$2)", [caros, gratis]);
    assert.equal(tienda.rows.length, 1);
    assert.equal(tienda.rows[0].valor_capa, caros);
    assert.equal(Number(tienda.rows[0].precio), 250);
  });

  test("un fichero malo no tumba a los buenos de la tanda", async () => {
    const r = await subir([
      prendaDePrueba({ archivo: "bueno1.png", capa: "botas", nombre: "Botas 1" }),
      prendaDePrueba({ archivo: "roto.png", capa: "botas", nombre: "Rotas", png: "data:image/png;base64,bm9Fc1VuUG5n" }),
      prendaDePrueba({ archivo: "bueno2.png", capa: "botas", nombre: "Botas 2", png: comoDataUrl(PNG_B) })
    ], ARTISTA());

    assert.equal(r.codigo, 200);
    assert.equal(r.cuerpo.entraron, 2);
    assert.equal(r.cuerpo.fallaron, 1);

    const roto = r.cuerpo.resultados.find(x => x.archivo === "roto.png");
    assert.equal(roto.ok, false);
    assert.match(roto.error, /PNG/i);
  });

  test("se rechaza lo que no debería entrar", async () => {
    const casos = [
      [{ capa: "sombrero" }, /ranura/i],
      [{ modelo: "inventado" }, /personaje/i],
      [{ nombre: "   " }, /nombre/i],
      [{ nombre: "x".repeat(61) }, /nombre/i],
      [{ precio: -5 }, /precio/i],
      [{ precio: 1.5 }, /precio/i],
      [{ png: "no soy una imagen" }, /PNG/i],
      // Un JPEG renombrado: la firma de los bytes lo delata.
      [{ png: "data:image/png;base64," + Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0]).toString("base64") }, /PNG de verdad/i]
    ];

    for (const [extra, esperado] of casos) {
      const r = await subir([prendaDePrueba(extra)], ARTISTA());
      assert.equal(r.cuerpo.entraron, 0, "no debería entrar: " + JSON.stringify(extra).slice(0, 60));
      assert.match(r.cuerpo.resultados[0].error, esperado);
    }
  });

  test("una tanda vacía o demasiado grande se rechaza entera", async () => {
    assert.equal((await subir([], ARTISTA())).codigo, 400);

    const muchas = Array.from({ length: 21 }, () => prendaDePrueba());
    const r = await subir(muchas, ARTISTA());
    assert.equal(r.codigo, 400);
    assert.match(r.cuerpo.error, /20/);
  });

  test("un PNG de más de 1 MB se rechaza", async () => {
    // Cabecera válida y relleno hasta pasarse del tope.
    const gordo = Buffer.concat([PNG_A, Buffer.alloc(1024 * 1024 + 10)]);
    const r = await subir([prendaDePrueba({ png: comoDataUrl(gordo) })], ARTISTA());

    assert.equal(r.cuerpo.entraron, 0);
    assert.match(r.cuerpo.resultados[0].error, /1 MB/);
  });
});

describe("publicar y retirar", () => {
  let idPropia;

  before(async () => {
    const r = await subir([prendaDePrueba({ capa: "pelo", nombre: "Pelo mío" })], ARTISTA());
    idPropia = r.cuerpo.resultados[0].id;
  });

  test("el autor puede retirar lo suyo, y no se borra", async () => {
    const antes = await version();
    const r = await estado(idPropia, false, ARTISTA());

    assert.equal(r.codigo, 200);
    const fila = await db.query("SELECT publicada, retirada_at FROM avatar_prendas WHERE id = $1", [idPropia]);
    assert.equal(fila.rows.length, 1, "retirar no debe borrar la fila");
    assert.equal(fila.rows[0].publicada, false);
    assert.ok(fila.rows[0].retirada_at, "debería quedar cuándo se retiró");
    assert.ok(await version() > antes);
  });

  test("y volver a publicarla", async () => {
    await estado(idPropia, true, ARTISTA());
    const fila = await db.query("SELECT publicada, retirada_at FROM avatar_prendas WHERE id = $1", [idPropia]);
    assert.equal(fila.rows[0].publicada, true);
    assert.equal(fila.rows[0].retirada_at, null);
  });

  test("otro artista no puede tocar lo ajeno", async () => {
    const r = await estado(idPropia, false, OTRO());
    assert.equal(r.codigo, 403);
    assert.match(r.cuerpo.error, /no es tuya/i);
  });

  test("un administrador sí", async () => {
    const r = await estado(idPropia, false, ADMIN());
    assert.equal(r.codigo, 200);
    await estado(idPropia, true, ADMIN());
  });

  test("los personajes no se retiran desde el panel", async () => {
    // Dejar sin modelo a quien lo lleve puesto le rompe el avatar entero.
    const tora = await db.query("SELECT id FROM avatar_prendas WHERE valor = 'tora'");
    const r = await estado(Number(tora.rows[0].id), false, ADMIN());

    assert.equal(r.codigo, 400);
    assert.match(r.cuerpo.error, /personajes/i);
  });

  test("una prenda que no existe da 404", async () => {
    assert.equal((await estado(999999, false, ADMIN())).codigo, 404);
  });

  test("lo retirado sigue saliendo en el panel, pero no en el catálogo público", async () => {
    await estado(idPropia, false, ARTISTA());

    const p = await panel(ARTISTA());
    assert.ok(p.cuerpo.prendas.some(x => x.id === idPropia), "el panel debe seguir mostrándola");

    const publico = await llamar("GET", { action: "avatar-catalogo" }, {}, null);
    assert.ok(!publico.cuerpo.prendas.some(x => x.id === idPropia), "el catálogo público no");
  });
});

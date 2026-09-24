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

require("./_aislar-datos");   // antes de api/: ver ese archivo

const { test, before, after, describe } = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Subir una prenda genera su previsualizacion en disco. Va a una carpeta
// temporal, fijada ANTES de cargar content.js, para no escribir en
// datos-locales/ del proyecto.
const PREVISUALIZACIONES = fs.mkdtempSync(path.join(os.tmpdir(), "mr-panel-previsualizaciones-"));
process.env.MR_PREVISUALIZACIONES_DIR = PREVISUALIZACIONES;
after(() => fs.rmSync(PREVISUALIZACIONES, { recursive: true, force: true }));

const { crearBaseLocal, crearSqlPGlite } = require("../scripts/pglite");
const { usarSqlLocal } = require("../api/_db");
const { crearToken } = require("../api/_auth");

let db;
let contentHandler;
let idArtista, idOtroArtista, idAdmin, idPelado;

// PNGs de verdad en el lienzo canónico, que es lo único que el panel
// acepta desde que se cerró la puerta de entrada.
//
// Se construyen aquí en vez de pegar un base64 gigante: así se puede
// pedir cualquier medida y se ve de un vistazo qué distingue a uno del
// otro. Gris de 8 bits, sin entrelazar, un color plano por imagen.
const zlib = require("node:zlib");
const { escribirBloques } = require("../api/_png");

function pngDe(ancho, alto, tono) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8;    // 8 bits por muestra
  ihdr[9] = 0;    // gris
  ihdr[12] = 0;   // sin entrelazar

  // Cada fila va precedida de su byte de filtro, y 0 es "sin filtro".
  const fila = Buffer.concat([Buffer.from([0]), Buffer.alloc(ancho, tono)]);
  const crudo = Buffer.concat(Array.from({ length: alto }, () => fila));

  return escribirBloques([
    { tipo: "IHDR", datos: ihdr },
    { tipo: "IDAT", datos: zlib.deflateSync(crudo) },
    { tipo: "IEND", datos: Buffer.alloc(0) }
  ]);
}

const LIENZO = [327, 504];
const PNG_A = pngDe(...LIENZO, 10);
const PNG_B = pngDe(...LIENZO, 200);

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
    assert.equal(uno.medidas, LIENZO[0] + "x" + LIENZO[1]);

    const fila = await db.query("SELECT * FROM avatar_prendas WHERE valor = 'tora_remera1'");
    assert.equal(fila.rows[0].nombre, "Remera de rayas");
    assert.equal(Number(fila.rows[0].autor_id), idArtista);
    assert.equal(fila.rows[0].publicada, true);

    assert.ok(await version() > antes, "subir debe mover la versión del catálogo");
  });

  test("y trae su previsualizacion hecha, en disco y en la base", async () => {
    // Asi la tienda y el editor la pueden enseñar en cuanto se sube, sin
    // esperar a ningun relleno.
    const PV = require("../api/_previsualizaciones");
    const fila = await db.query("SELECT id, previsualizacion FROM avatar_prendas WHERE valor = 'tora_remera1'");
    assert.match(fila.rows[0].previsualizacion || "", /^[0-9a-f]{64}$/, "no apunto la huella");
    const jpg = fs.readFileSync(PV.rutaDe(Number(fila.rows[0].id)));
    assert.deepStrictEqual([jpg[0], jpg[1]], [0xFF, 0xD8]);
    assert.ok(PV.rutaDe(1).startsWith(PREVISUALIZACIONES), "escribiria fuera de la carpeta temporal");
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

  test("el lienzo tiene que ser el canónico", async () => {
    // Todas las capas se dibujan superpuestas en el mismo encuadre, así
    // que una que venga con otras medidas no se cae: se ESTIRA hasta el
    // marco de las demás y descuadra el dibujo sin que nadie se entere
    // hasta que alguien se lo pone y le queda el pelo torcido.
    //
    // Que esto no estuviera puesto se nota en la copia de producción: de
    // 438 archivos hay 80 fuera del lienzo, y entre ellos un 1919x1079 y
    // un 1338x2066. Eso es un pantallazo subido sin querer.
    const fuera = [
      [326, 503],     // el grupo más numeroso del catálogo viejo
      [327, 505],     // el lienzo de macrojuegos, un píxel más alto
      [1919, 1079],   // un pantallazo
      [654, 1008]     // el doble, que estirado se ve igual pero pesa cuatro veces
    ];

    for (const [ancho, alto] of fuera) {
      const r = await subir([prendaDePrueba({ png: comoDataUrl(pngDe(ancho, alto, 55)) })], ARTISTA());

      assert.equal(r.cuerpo.entraron, 0, "no debería entrar " + ancho + "x" + alto);
      assert.match(r.cuerpo.resultados[0].error, /lienzo/i);
      // El mensaje dice qué medida trae, que es lo que el artista
      // necesita para arreglarlo sin adivinar.
      assert.match(r.cuerpo.resultados[0].error, new RegExp(ancho + "x" + alto));
    }
  });

  test("el lienzo canónico sí entra", async () => {
    const r = await subir([prendaDePrueba({
      capa: "pantalon",
      nombre: "Pantalon canonico",
      png: comoDataUrl(pngDe(...LIENZO, 77))
    })], ARTISTA());

    assert.equal(r.cuerpo.entraron, 1);
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

  test("lo retirado sigue saliendo en el panel, pero no en el catálogo del editor", async () => {
    await estado(idPropia, false, ARTISTA());

    const p = await panel(ARTISTA());
    assert.ok(p.cuerpo.prendas.some(x => x.id === idPropia), "el panel debe seguir mostrándola");

    // El editor la deja de ofrecer. Quien ya la llevara la conserva: su
    // avatar lo dibuja el servidor, y la receta incluye lo retirado. El
    // índice público, que era por donde se dibujaba antes, ya no existe.
    const fila = await db.query("SELECT valor FROM avatar_prendas WHERE id = $1", [idPropia]);
    const valor = fila.rows[0].valor;

    const catalogo = await llamar("GET", { action: "avatar-catalogo-completo" }, {}, ARTISTA());
    assert.equal(catalogo.codigo, 200, JSON.stringify(catalogo.cuerpo));
    assert.ok(!JSON.stringify(catalogo.cuerpo).includes(valor), "el editor no debe ofrecerla");
  });
});

describe("no repartir un identificador que alguien lleva puesto", () => {
  test("se salta el número de una prenda que sobrevivió a su dibujo", async () => {
    // El caso real: "tora_piel7" lo llevan tres cuentas y dos casilleros
    // de galería, pero su fichero se borró hace tiempo y no está en el
    // catálogo. El primer hueco libre de tora/piel era justo el 7, así
    // que la siguiente piel de tora que alguien subiera se habría
    // convertido, en silencio, en la piel de esas tres personas.
    const id = await crearUsuario("lleva_una_fantasma");
    await db.query(
      "UPDATE users SET avatar = $1 WHERE id = $2",
      [JSON.stringify({ modelo: "tora", espalda: "tora_espalda1" }), id]
    );

    // tora_espalda1 no está en avatar_prendas: el hueco libre sería el 1.
    const hay = await db.query("SELECT count(*)::int AS n FROM avatar_prendas WHERE valor = 'tora_espalda1'");
    assert.equal(hay.rows[0].n, 0, "el montaje asume que esa prenda no está en el catálogo");

    const r = await subir([prendaDePrueba({ capa: "espalda", nombre: "Espalda nueva" })], ARTISTA());

    assert.equal(r.cuerpo.entraron, 1, r.cuerpo.resultados[0] && r.cuerpo.resultados[0].error);
    assert.notEqual(r.cuerpo.resultados[0].valor, "tora_espalda1",
      "no debe reutilizar un valor que alguien lleva puesto");
    assert.equal(r.cuerpo.resultados[0].valor, "tora_espalda2");
  });

  test("también mira los casilleros de la galería, no solo el avatar activo", async () => {
    const id = await crearUsuario("guarda_una_fantasma");
    await db.query(
      `INSERT INTO saved_avatars (user_id, slot, avatar) VALUES ($1, 1, $2)`,
      [id, JSON.stringify({ modelo: "tora", guantes: "tora_guantes3" })]
    );

    const r = await subir([
      prendaDePrueba({ capa: "guantes", nombre: "Guantes A" }),
      prendaDePrueba({ capa: "guantes", nombre: "Guantes B", png: comoDataUrl(PNG_B) })
    ], ARTISTA());

    assert.equal(r.cuerpo.entraron, 2);
    const valores = r.cuerpo.resultados.map(x => x.valor);
    // El 3 está guardado en una galería, así que no debe repartirse.
    // Los números bajos ya los ocupó un test anterior de este archivo:
    // lo que importa es que se salte el 3, no cuáles toquen.
    assert.ok(!valores.includes("tora_guantes3"), "el 3 está guardado en una galería");
    assert.equal(new Set(valores).size, 2, "deben ser dos identificadores distintos");
    valores.forEach(v => assert.match(v, /^tora_guantes\d+$/));
  });
});

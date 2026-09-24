// ==============================
// TESTS DEL ENDPOINT DE PRENDAS — tests/avatar-prenda.test.js
// ==============================
// Las prendas de avatar pasan a vivir en la base (migración 018) en vez
// de en imagenes/. Este endpoint es el que las sirve como PNG.
//
// Lo que se prueba acá:
//   - Devuelve un PNG de verdad, con su firma y su Content-Type.
//   - El cuerpo llega ESCRITO a través del adaptador real de server.js,
//     no solo de una maqueta. Es la misma precaución que tomó
//     tests/avatar-png.test.js, y por un motivo concreto: aquella vez
//     los tests daban verde con una maqueta más permisiva mientras el
//     servidor real devolvía la imagen vacía, porque su end() ignoraba
//     el argumento.
//   - SOLO CON FIRMA, desde la fase 5 de docs/AVATARES-SERVIDOR.md: sin
//     ella, caducada, de otra prenda o manipulada, 403. Las firmas las
//     reparte avatar-panel, que exige el rol de arte. Ver
//     api/_prendas-firma.js.
//   - Se cachea en privado y solo mientras dure la firma.
//   - Dos prendas que comparten el mismo dibujo comparten URL. Es el
//     punto del diseño: 635 prendas usan solo 418 archivos, así que el
//     navegador se baja cada fondo repetido una sola vez.
//   - Una huella que no existe da 404, y una con formato raro da 400
//     sin llegar a consultar la base.
//
// Correr:  npm test

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret";

require("./_aislar-datos");   // antes de api/: ver ese archivo

const { test, before } = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");

const { crearBaseLocal, crearSqlPGlite } = require("../scripts/pglite");
const { usarSqlLocal } = require("../api/_db");
const firmas = require("../api/_prendas-firma");

let db;
let contentHandler;

// PNGs reales de 1x1 px, distintos entre sí.
const PNG_A = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const PNG_B = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

const FIRMA_PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function huellaDe(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

// Mete un archivo y devuelve su id. Deduplica por huella, igual que el
// script de importación.
async function meterArchivo(buffer) {
  const sha = huellaDe(buffer);
  const ya = await db.query("SELECT id FROM avatar_archivos WHERE sha256 = $1", [sha]);
  if (ya.rows.length) return ya.rows[0].id;

  const res = await db.query(
    `INSERT INTO avatar_archivos (sha256, datos, ancho, alto, peso)
     VALUES ($1, $2, 1, 1, $3) RETURNING id`,
    [sha, buffer, buffer.length]
  );
  return res.rows[0].id;
}

async function meterPrenda(valor, modelo, capa, archivoId) {
  await db.query(
    `INSERT INTO avatar_prendas (valor, modelo, capa, nombre, archivo_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [valor, modelo, capa, valor, archivoId]
  );
}

before(async () => {
  db = await crearBaseLocal();
  usarSqlLocal(crearSqlPGlite(db));

  contentHandler = require("../api/content");

  // Dos prendas de modelos distintos que comparten EL MISMO dibujo, que
  // es exactamente lo que pasa en el catálogo real con los fondos.
  const compartido = await meterArchivo(PNG_A);
  await meterPrenda("tora_fondo1", "tora", "fondo", compartido);
  await meterPrenda("cereza_fondo1", "cereza", "fondo", compartido);

  // Y una con dibujo propio.
  const propio = await meterArchivo(PNG_B);
  await meterPrenda("tora_remera1", "tora", "remera", propio);
});

// El mismo objeto de respuesta que arma server.js, sobre una respuesta
// HTTP simulada. Si el adaptador no escribiera el cuerpo, estos tests
// tienen que fallar.
function llamarComoServidor(query) {
  return new Promise((resolve) => {
    const trozos = [];
    const cabeceras = {};
    let terminado = false;

    const respuestaHTTP = {
      get writableEnded() { return terminado; },
      getHeader(nombre) { return cabeceras[nombre]; },
      setHeader(nombre, valor) { cabeceras[nombre] = valor; },
      writeHead(codigo, extra) {
        respuestaHTTP.statusCode = codigo;
        if (extra) Object.assign(cabeceras, extra);
      },
      end(cuerpo) {
        terminado = true;
        if (cuerpo) trozos.push(Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.from(String(cuerpo)));
        resolve({
          codigo: respuestaHTTP.statusCode || 200,
          cuerpo: Buffer.concat(trozos),
          cabeceras
        });
      },
      statusCode: 200
    };

    const resSim = {
      statusCode: 200,
      setHeader(nombre, valor) { respuestaHTTP.setHeader(nombre, valor); },
      status(codigo) { this.statusCode = codigo; return this; },
      json(obj) {
        if (respuestaHTTP.writableEnded) return;
        if (!respuestaHTTP.getHeader("Content-Type")) {
          respuestaHTTP.setHeader("Content-Type", "application/json; charset=utf-8");
        }
        respuestaHTTP.writeHead(this.statusCode || 200);
        respuestaHTTP.end(JSON.stringify(obj));
      },
      end(cuerpo) {
        if (respuestaHTTP.writableEnded) return;
        respuestaHTTP.writeHead(this.statusCode || 200);
        respuestaHTTP.end(cuerpo);
      }
    };

    contentHandler(
      { method: "GET", query: Object.assign({ action: "avatar-prenda" }, query), body: {}, headers: {} },
      resSim
    );
  });
}

// La consulta de una dirección firmada, como la manda avatar-panel.
function firmada(huella, ahora) {
  const url = new URL(firmas.firmar(huella, ahora), "https://macroreborn.com");
  return { v: huella, hasta: url.searchParams.get("hasta"), firma: url.searchParams.get("firma") };
}

// ==============================

test("devuelve el PNG con su firma y no un cuerpo vacío", async () => {
  const r = await llamarComoServidor(firmada(huellaDe(PNG_A)));

  assert.equal(r.codigo, 200);
  assert.equal(r.cabeceras["Content-Type"], "image/png");
  assert.ok(r.cuerpo.length > 0, "el cuerpo llegó vacío");
  assert.ok(r.cuerpo.subarray(0, 8).equals(FIRMA_PNG), "no tiene firma PNG");
  assert.ok(r.cuerpo.equals(PNG_A), "los bytes no son los que se guardaron");
});

test("el Content-Length coincide con los bytes enviados", async () => {
  const r = await llamarComoServidor(firmada(huellaDe(PNG_B)));

  assert.equal(r.codigo, 200);
  assert.equal(Number(r.cabeceras["Content-Length"]), r.cuerpo.length);
  assert.equal(r.cuerpo.length, PNG_B.length);
});

test("se cachea en privado, y solo mientras dure la firma", async () => {
  // Pública, una caché compartida la serviría a cualquiera. Más larga
  // que la firma, el navegador la seguiría enseñando ya caducada.
  const r = await llamarComoServidor(firmada(huellaDe(PNG_A)));
  const cache = r.cabeceras["Cache-Control"] || "";
  assert.match(cache, /^private, max-age=\d+$/);
  const segundos = Number(cache.match(/max-age=(\d+)/)[1]);
  assert.ok(segundos > 0 && segundos <= firmas.DURACION_S + 3600, "dura " + segundos + " s");
});

test("sin firma, 403: las prendas sueltas son del equipo de arte", async () => {
  const r = await llamarComoServidor({ v: huellaDe(PNG_A) });
  assert.equal(r.codigo, 403);
  assert.ok(!r.cuerpo.subarray(0, 8).equals(FIRMA_PNG), "mandó el dibujo igual");
});

test("con la firma de otra prenda, caducada o tocada, tampoco", async () => {
  const a = huellaDe(PNG_A), b = huellaDe(PNG_B);

  const deOtra = firmada(b);
  assert.equal((await llamarComoServidor({ ...deOtra, v: a })).codigo, 403, "firma de otra prenda");

  const vieja = firmada(a, Date.now() - 8 * 3600 * 1000);
  assert.equal((await llamarComoServidor(vieja)).codigo, 403, "caducada");

  const buena = firmada(a);
  const alargada = { ...buena, hasta: String(Number(buena.hasta) + 3600) };
  assert.equal((await llamarComoServidor(alargada)).codigo, 403, "caducidad alargada a mano");

  const inventada = { ...buena, firma: "0".repeat(32) };
  assert.equal((await llamarComoServidor(inventada)).codigo, 403, "firma inventada");
});

test("y sin firma no se puede ni sondear qué existe", async () => {
  // Una huella inventada sin firma da 403, igual que una que existe: el
  // servidor no mira la base hasta comprobar la firma.
  assert.equal((await llamarComoServidor({ v: "e".repeat(64) })).codigo, 403);
});

test("dos prendas con el mismo dibujo comparten una sola URL", async () => {
  // Es el punto del diseño: en el catálogo real, 635 prendas usan solo
  // 418 archivos. Si esto se direccionara por id de prenda, el navegador
  // se bajaría el mismo fondo una vez por modelo.
  const filas = await db.query(
    `SELECT p.valor, a.sha256
     FROM avatar_prendas p
     JOIN avatar_archivos a ON a.id = p.archivo_id
     WHERE p.valor IN ('tora_fondo1', 'cereza_fondo1')
     ORDER BY p.valor`
  );

  assert.equal(filas.rows.length, 2);
  assert.equal(filas.rows[0].sha256, filas.rows[1].sha256, "deberían compartir huella");

  // Y esa huella única sirve a las dos.
  const r = await llamarComoServidor(firmada(filas.rows[0].sha256));
  assert.equal(r.codigo, 200);
  assert.ok(r.cuerpo.equals(PNG_A));
});

test("una huella que no existe da 404", async () => {
  const inventada = "f".repeat(64);
  const r = await llamarComoServidor(firmada(inventada));

  assert.equal(r.codigo, 404);
});

test("una huella con formato raro da 400 y no consulta la base", async () => {
  for (const malo of ["", "abc", "'; DROP TABLE avatar_archivos; --", "g".repeat(64), "A".repeat(64)]) {
    const r = await llamarComoServidor({ v: malo });
    assert.equal(r.codigo, 400, "debería rechazar: " + malo);
  }

  // Y la tabla sigue ahí, por si acaso.
  const quedan = await db.query("SELECT count(*)::int AS n FROM avatar_archivos");
  assert.equal(quedan.rows[0].n, 2);
});

// ==============================
// GUARDAR Y SERVIR LAS PREVISUALIZACIONES — tests/previsualizaciones.test.js
// ==============================
// api/_previsualizaciones.js decide con que nombre se guarda cada
// previsualizacion, donde, cuando rehacerla y como se sirve. Fase 4 de
// docs/AVATARES-SERVIDOR.md.
//
// Lo que hay que sujetar:
//
//   LA HUELLA CAMBIA CUANDO CAMBIA EL DIBUJO, y solo entonces. Si no
//   cambiara al resubir el modelo, la direccion con version seguiria
//   sirviendo la imagen vieja un año desde cualquier cache.
//
//   LO QUE NO CAMBIO NO SE REHACE. El relleno se puede correr las veces
//   que haga falta sin rehacer las 768.
//
//   UNA QUE FALLA NO PARA A LAS DEMAS, y el simulacro no toca nada.
//
//   SE SIRVE SOLO LO SUYO: la ruta acepta un id y nada mas.
//
// Se monta sobre PGlite con un catalogo sembrado, como los compuestos.
//
// Correr:  npm test

require("./_aislar-datos");   // antes de api/: ver ese archivo

const { test, before, after, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// La carpeta de salida se fija ANTES de cargar el modulo, que la lee al
// importarse.
const TEMPORAL = fs.mkdtempSync(path.join(os.tmpdir(), "mr-previsualizaciones-"));
process.env.MR_PREVISUALIZACIONES_DIR = TEMPORAL;

const { crearBaseLocal, crearSqlPGlite } = require("../scripts/pglite");
const lienzo = require("../api/_lienzo");
const R = require("../api/_recortes");
const PV = require("../api/_previsualizaciones");

let db, sql;
const ids = {};

// Un PNG del lienzo con un rectangulo de color, y transparente el resto.
function png(r, g, b, x0, y0, ancho, alto) {
  const rgba = Buffer.alloc(327 * 504 * 4);
  for (let y = y0; y < y0 + alto; y++) for (let x = x0; x < x0 + ancho; x++) {
    const i = (y * 327 + x) * 4;
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
  }
  return lienzo.escribirRGBA8({ rgba, ancho: 327, alto: 504 });
}

async function sembrar(valor, capa, binario, sha) {
  const arch = await db.query(
    `INSERT INTO avatar_archivos (sha256, datos, ancho, alto, peso)
     VALUES ($1, $2, 327, 504, $3) RETURNING id`,
    [sha, binario, binario.length]
  );
  const prenda = await db.query(
    `INSERT INTO avatar_prendas (valor, modelo, capa, nombre, archivo_id)
     VALUES ($1, 'tora', $2, $1, $3) RETURNING id`,
    [valor, capa, arch.rows[0].id]
  );
  ids[valor] = Number(prenda.rows[0].id);
}

const huellaDe = async valor =>
  (await db.query("SELECT previsualizacion FROM avatar_prendas WHERE valor = $1", [valor])).rows[0].previsualizacion;

const versionCatalogo = async () =>
  Number((await db.query("SELECT version FROM avatar_catalogo_version WHERE id = 1")).rows[0].version);

before(async () => {
  db = await crearBaseLocal();
  sql = crearSqlPGlite(db);
  await sembrar("tora", "modelo", png(200, 180, 160, 100, 40, 127, 420), "a".repeat(64));
  await sembrar("tora_pelo1", "pelo", png(90, 40, 20, 110, 30, 110, 90), "b".repeat(64));
  await sembrar("tora_fondo1", "fondo", png(20, 40, 90, 0, 0, 327, 504), "c".repeat(64));
});

after(async () => {
  if (db) await db.close();
  fs.rmSync(TEMPORAL, { recursive: true, force: true });
});

describe("generar y guardar", () => {

  test("el simulacro cuenta lo que haria y no toca nada", async () => {
    const r = await PV.asegurar(sql, { config: R.vacio(), escribir: false });
    assert.equal(r.total, 3);
    assert.equal(r.hechas, 3);
    assert.equal(fs.existsSync(PV.rutaDe(ids.tora_pelo1)), false, "el simulacro escribio en disco");
    assert.equal(await huellaDe("tora_pelo1"), null, "el simulacro escribio en la base");
  });

  test("genera la de cada prenda, la guarda en su sitio y apunta su huella", async () => {
    const r = await PV.asegurar(sql, { config: R.vacio() });
    assert.deepStrictEqual({ hechas: r.hechas, iguales: r.iguales, fallos: r.fallos }, { hechas: 3, iguales: 0, fallos: [] });
    for (const valor of ["tora", "tora_pelo1", "tora_fondo1"]) {
      const jpg = fs.readFileSync(PV.rutaDe(ids[valor]));
      assert.deepStrictEqual([jpg[0], jpg[1]], [0xFF, 0xD8], valor + " no es un JPG");
      assert.match(await huellaDe(valor), /^[0-9a-f]{64}$/);
    }
  });

  test("lo que no cambio no se rehace, ni mueve la version del catalogo", async () => {
    const antes = fs.statSync(PV.rutaDe(ids.tora_pelo1)).mtimeMs;
    const version = await versionCatalogo();
    const r = await PV.asegurar(sql, { config: R.vacio() });
    assert.equal(r.hechas, 0);
    assert.equal(r.iguales, 3);
    assert.equal(fs.statSync(PV.rutaDe(ids.tora_pelo1)).mtimeMs, antes, "reescribio una que no cambio");
    assert.equal(await versionCatalogo(), version, "subio la version sin cambiar nada");
  });

  test("si cambia alguna direccion, sube la version del catalogo", async () => {
    // El catalogo del editor vive en memoria y solo se rehace al subirla.
    const version = await versionCatalogo();
    await db.query("UPDATE avatar_prendas SET previsualizacion = NULL WHERE valor = 'tora_fondo1'");
    await PV.asegurar(sql, { config: R.vacio() });
    assert.ok(await versionCatalogo() > version, "el editor seguiria mandando la direccion vieja");
  });

  test("si falta el archivo se vuelve a hacer, aunque la huella coincida", async () => {
    fs.rmSync(PV.rutaDe(ids.tora_pelo1));
    const r = await PV.asegurar(sql, { config: R.vacio(), ids: [ids.tora_pelo1] });
    assert.equal(r.total, 1, "no se limito a la prenda pedida");
    assert.equal(r.hechas, 1);
    assert.ok(fs.existsSync(PV.rutaDe(ids.tora_pelo1)));
  });

  test("si cambia el dibujo del modelo, cambian las de sus prendas", async () => {
    const antes = await huellaDe("tora_pelo1");
    await db.query("UPDATE avatar_archivos SET sha256 = $1, datos = $2 WHERE sha256 = $3",
      ["d".repeat(64), png(210, 190, 170, 90, 40, 140, 420), "a".repeat(64)]);
    await PV.asegurar(sql, { config: R.vacio() });
    assert.notEqual(await huellaDe("tora_pelo1"), antes, "el modelo cambio y la huella no");
  });

  test("un cuadro forzado para su capa cambia la huella, y solo la de esa capa", async () => {
    const pelo = await huellaDe("tora_pelo1");
    const fondo = await huellaDe("tora_fondo1");
    const config = R.vacio();
    config.cuadros = { tora: { pelo: { x: 60, y: 0, lado: 200 } } };
    await PV.asegurar(sql, { config });
    assert.notEqual(await huellaDe("tora_pelo1"), pelo);
    assert.equal(await huellaDe("tora_fondo1"), fondo);
  });

  test("una que falla no para a las demas", async () => {
    await sembrar("tora_boca1", "boca", Buffer.from("esto no es un png"), "e".repeat(64));
    const r = await PV.asegurar(sql, { config: R.vacio() });
    assert.equal(r.fallos.length, 1);
    assert.equal(r.fallos[0].valor, "tora_boca1");
    assert.equal(r.total, 4);
    assert.equal(await huellaDe("tora_boca1"), null);
  });

  test("asegurarSinFallar no revienta aunque la base falle", async () => {
    const rota = () => Promise.reject(new Error("sin base"));
    assert.equal(await PV.asegurarSinFallar(rota, [1]), null);
  });

});

describe("la direccion", () => {

  test("lleva el id y, si hay huella, doce caracteres de version", () => {
    assert.equal(PV.urlDe(412, "3f2a9c1b7d04e5f6"), "/previsualizaciones/412.jpg?v=3f2a9c1b7d04");
    assert.equal(PV.urlDe(412), "/previsualizaciones/412.jpg");
    assert.equal(PV.urlDe(0, "abc"), null);
  });

  test("la ruta acepta un id y nada mas", () => {
    assert.deepStrictEqual(PV.partirRuta("/previsualizaciones/412.jpg"), { id: 412 });
    for (const mala of ["/previsualizaciones/0.jpg", "/previsualizaciones/abc.jpg", "/previsualizaciones/1.png",
      "/previsualizaciones/../1.jpg", "/previsualizaciones/1.jpg/x", "/previsualizaciones/-1.jpg",
      "/previsualizaciones/1234567890.jpg", "/avatares/1/62x96.jpg"]) {
      assert.equal(PV.partirRuta(mala), null, mala);
    }
  });

});

describe("servirla", () => {

  function pedir(ruta, metodo) {
    const res = {
      codigo: 0, cabeceras: {}, cuerpo: null,
      writeHead(c, h) { this.codigo = c; this.cabeceras = h || {}; },
      end(d) { this.cuerpo = d === undefined ? null : d; }
    };
    const atendida = PV.atender({ method: metodo || "GET" }, res, new URL("http://x" + ruta));
    return { atendida, ...res };
  }

  test("con version, un año y immutable", () => {
    const r = pedir("/previsualizaciones/" + ids.tora_fondo1 + ".jpg?v=abc");
    assert.equal(r.codigo, 200);
    assert.equal(r.cabeceras["Content-Type"], "image/jpeg");
    assert.equal(r.cabeceras["Cache-Control"], "public, max-age=31536000, immutable");
    assert.deepStrictEqual([r.cuerpo[0], r.cuerpo[1]], [0xFF, 0xD8]);
  });

  test("sin version, un minuto", () => {
    assert.equal(pedir("/previsualizaciones/" + ids.tora_fondo1 + ".jpg").cabeceras["Cache-Control"], "public, max-age=60");
  });

  test("una que no existe es 404, y HEAD no manda cuerpo", () => {
    assert.equal(pedir("/previsualizaciones/999999.jpg").codigo, 404);
    const r = pedir("/previsualizaciones/" + ids.tora_fondo1 + ".jpg?v=abc", "HEAD");
    assert.equal(r.codigo, 200);
    assert.equal(r.cuerpo, null);
  });

  test("una ruta que no es suya no la toca", () => {
    assert.equal(pedir("/avatares/1/62x96.jpg").atendida, false);
    assert.equal(pedir("/prendas/" + "a".repeat(64) + ".png").atendida, false);
  });

});

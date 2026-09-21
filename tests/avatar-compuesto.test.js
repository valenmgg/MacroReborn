// ==============================
// GUARDAR Y SERVIR EL COMPUESTO — tests/avatar-compuesto.test.js
// ==============================
// api/_avatar-compuesto.js decide cuándo componer, con qué nombre
// guardar y dónde. Fase 2 de docs/AVATARES-SERVIDOR.md.
//
// Lo que hay que sujetar, y por qué cada cosa:
//
//   LA HUELLA ES LA RECETA. El nombre sale del sha256 de las capas con
//   la huella del archivo de cada prenda, no del JSON del avatar. Si
//   saliera del JSON, rehornear una prenda dejaría a todo el mundo
//   viendo el compuesto viejo durante un año, porque la URL se cachea
//   con immutable y nadie la volvería a pedir.
//
//   DOS AVATARES IGUALES, UN SOLO ARCHIVO. Sale gratis de lo anterior y
//   conviene que se note si se rompe.
//
//   REPETIR NO CUESTA. El relleno de los 215 que ya existen se tiene
//   que poder volver a correr sin componer nada dos veces.
//
//   GUARDAR NO PUEDE FALLAR POR ESTO. Si el disco está lleno, la
//   persona se queda sin compuesto hasta el siguiente guardado, no sin
//   poder guardar su avatar.
//
// Se monta sobre PGlite con el catálogo de verdad sembrado, porque la
// receta necesita leer avatar_prendas y avatar_archivos.
//
// Correr:  npm test

const { test, before, after, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// El directorio de salida se fija ANTES de cargar el módulo, que lo lee
// al importarse. Va a una carpeta temporal para no ensuciar el
// proyecto ni depender de lo que haya de una corrida anterior.
const TEMPORAL = fs.mkdtempSync(path.join(os.tmpdir(), "mr-avatares-"));
process.env.MR_AVATARES_DIR = TEMPORAL;

const { crearBaseLocal, crearSqlPGlite } = require("../scripts/pglite");
const lienzo = require("../api/_lienzo");
const AC = require("../api/_avatar-compuesto");

let db, sql;

// Un PNG liso del lienzo, para sembrar prendas de mentira.
function png(r, g, b, a) {
  const rgba = Buffer.alloc(327 * 504 * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a === undefined ? 255 : a;
  }
  return lienzo.escribirRGBA8({ rgba, ancho: 327, alto: 504 });
}

async function sembrarPrenda(valor, capa, binario, sha) {
  const arch = await db.query(
    `INSERT INTO avatar_archivos (sha256, datos, ancho, alto, peso)
     VALUES ($1, $2, 327, 504, $3) RETURNING id`,
    [sha, binario, binario.length]
  );
  await db.query(
    `INSERT INTO avatar_prendas (valor, modelo, capa, nombre, archivo_id)
     VALUES ($1, 'tora', $2, $1, $3)`,
    [valor, capa, arch.rows[0].id]
  );
}

before(async () => {
  db = await crearBaseLocal();
  sql = crearSqlPGlite(db);
  await sembrarPrenda("tora", "modelo", png(200, 180, 160), "a".repeat(64));
  await sembrarPrenda("tora_fondo1", "fondo", png(20, 40, 90), "b".repeat(64));
  await sembrarPrenda("tora_pelo3", "pelo", png(30, 20, 10), "c".repeat(64));
  await sembrarPrenda("tora_remera2", "remera", png(220, 30, 30), "d".repeat(64));
});

after(() => {
  fs.rmSync(TEMPORAL, { recursive: true, force: true });
});

const avatarBase = { fondo: "tora_fondo1", modelo: "tora", pelo: "tora_pelo3" };

describe("la receta", () => {

  test("toma las capas con prenda, en orden de dibujo", async () => {
    // Se pide desordenado a propósito: el orden lo pone CAPAS, no el
    // orden de las claves del objeto.
    const r = await AC.recetaDe(sql, { pelo: "tora_pelo3", fondo: "tora_fondo1", modelo: "tora" });
    assert.deepStrictEqual(r.capas.map(c => c.capa), ["fondo", "modelo", "pelo"]);
  });

  test("ignora las capas vacías", async () => {
    const r = await AC.recetaDe(sql, { fondo: "tora_fondo1", pelo: "ninguno", boca: "", cara: null });
    assert.deepStrictEqual(r.capas.map(c => c.capa), ["fondo"]);
  });

  test("un avatar sin nada no tiene receta, y eso no es un error", async () => {
    for (const vacio of [null, undefined, {}, { pelo: "ninguno" }]) {
      assert.equal(await AC.recetaDe(sql, vacio), null);
    }
  });

  test("una prenda que no está en el catálogo se salta, no revienta", async () => {
    // Pasa con un avatar viejo que lleva algo retirado. Dejar a esa
    // persona sin imagen sería peor que dibujarla sin esa capa, que es
    // lo que hace hoy el navegador.
    const r = await AC.recetaDe(sql, { fondo: "tora_fondo1", pelo: "no_existe_esta" });
    assert.deepStrictEqual(r.capas.map(c => c.valor), ["tora_fondo1"]);
  });

  test("la huella sale de las prendas, no del orden en que se escriban", async () => {
    const a = await AC.recetaDe(sql, { fondo: "tora_fondo1", pelo: "tora_pelo3" });
    const b = await AC.recetaDe(sql, { pelo: "tora_pelo3", fondo: "tora_fondo1" });
    assert.equal(a.huella, b.huella);
  });

  test("dos avatares distintos dan huellas distintas", async () => {
    const a = await AC.recetaDe(sql, { fondo: "tora_fondo1", pelo: "tora_pelo3" });
    const b = await AC.recetaDe(sql, { fondo: "tora_fondo1", remera: "tora_remera2" });
    assert.notEqual(a.huella, b.huella);
  });

  test("y la misma prenda en otra capa también", async () => {
    // La capa entra en la huella. Si no entrara, el mismo dibujo puesto
    // de pelo y de fondo daria el mismo nombre para dos imagenes
    // distintas.
    const a = await AC.recetaDe(sql, { fondo: "tora_fondo1" });
    const b = await AC.recetaDe(sql, { pelo: "tora_fondo1" });
    assert.notEqual(a.huella, b.huella);
  });

});

describe("generar y guardar", () => {

  test("deja los dos tamaños en disco y devuelve la huella", async () => {
    const huella = await AC.asegurar(sql, avatarBase);
    assert.match(huella, /^[a-f0-9]{64}$/);
    for (const [a, l] of AC.TAMANOS) {
      assert.ok(fs.existsSync(AC.rutaDe(huella, a, l)), a + "x" + l + " no se escribió");
    }
  });

  test("lo que escribe es un JPG de verdad", async () => {
    const huella = await AC.asegurar(sql, avatarBase);
    const jpg = AC.leer(huella, 62, 96);
    assert.ok(jpg && jpg.length > 0);
    assert.equal(jpg[0], 0xFF);
    assert.equal(jpg[1], 0xD8);
  });

  test("la miniatura pesa menos que la grande", async () => {
    const huella = await AC.asegurar(sql, avatarBase);
    assert.ok(AC.leer(huella, 62, 96).length < AC.leer(huella, 327, 504).length);
  });

  test("repetir no vuelve a componer, y devuelve lo mismo", async () => {
    // De esto depende que el relleno de los 215 que ya existen se pueda
    // volver a correr sin coste.
    const huella = await AC.asegurar(sql, avatarBase);
    const antes = fs.statSync(AC.rutaDe(huella, 62, 96)).mtimeMs;
    const otra = await AC.asegurar(sql, avatarBase);
    assert.equal(otra, huella);
    assert.equal(fs.statSync(AC.rutaDe(huella, 62, 96)).mtimeMs, antes, "reescribió el archivo");
  });

  test("dos personas con el mismo avatar comparten archivo", async () => {
    const a = await AC.asegurar(sql, { fondo: "tora_fondo1", modelo: "tora" });
    const b = await AC.asegurar(sql, { modelo: "tora", fondo: "tora_fondo1" });
    assert.equal(a, b);
  });

  test("un avatar sin nada no genera nada", async () => {
    assert.equal(await AC.asegurar(sql, {}), null);
    assert.equal(await AC.asegurar(sql, { pelo: "ninguno" }), null);
  });

  test("no deja archivos a medias con nombre definitivo", async () => {
    const huella = await AC.asegurar(sql, avatarBase);
    const sueltos = fs.readdirSync(AC.carpetaDe(huella)).filter(f => f.endsWith(".tmp"));
    assert.deepStrictEqual(sueltos, [], "quedaron temporales sin renombrar");
  });

  test("si falla, no tumba a quien lo llamó", async () => {
    // Guardar el avatar tiene que funcionar aunque esto no pueda.
    const roto = { query: () => { throw new Error("disco lleno"); } };
    const sqlRoto = () => { throw new Error("disco lleno"); };
    assert.equal(await AC.asegurarSinFallar(sqlRoto, avatarBase), null);
  });

});

describe("leer y servir", () => {

  test("una huella que no existe da null en vez de romper", () => {
    assert.equal(AC.leer("f".repeat(64), 62, 96), null);
  });

  test("y una huella con forma inventada también", () => {
    for (const mala of ["", null, "../../etc/passwd", "AAAA", "g".repeat(64), "a".repeat(63)]) {
      assert.equal(AC.leer(mala, 62, 96), null, "acepto " + JSON.stringify(mala));
    }
  });

  test("un tamaño que no se genera no se sirve", async () => {
    const huella = await AC.asegurar(sql, avatarBase);
    assert.equal(AC.leer(huella, 1000, 1000), null);
  });

});

describe("la ruta pública", () => {

  test("se arma y se vuelve a partir igual", () => {
    const h = "a1b2c3".padEnd(64, "0");
    const url = AC.urlDe(h, 62, 96);
    assert.equal(url, "/avatares/" + h + "/62x96.jpg");
    assert.deepStrictEqual(AC.partirRuta(url), { huella: h, ancho: 62, alto: 96 });
  });

  test("por defecto pide la miniatura, que es lo que usan las listas", () => {
    const h = "a".repeat(64);
    assert.equal(AC.urlDe(h), "/avatares/" + h + "/62x96.jpg");
  });

  test("sin huella no hay URL", () => {
    assert.equal(AC.urlDe(null), null);
  });

  test("lo que no es una ruta de compuesto no lo parece", () => {
    const h = "a".repeat(64);
    const malas = [
      "/", "/avatares/", "/avatares/" + h + ".jpg",
      "/avatares/" + h + "/62x96.png",
      "/avatares/" + h + "/999x999.jpg",
      "/avatares/NOESUNAHUELLA/62x96.jpg",
      "/avatares/" + h + "/../../etc/passwd",
      "/prendas/" + h + ".png"
    ];
    for (const m of malas) assert.equal(AC.partirRuta(m), null, "acepto " + m);
  });

});

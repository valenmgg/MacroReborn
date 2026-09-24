// ==============================
// PARTIR UN VOLCADO DE pg_dump — tests/volcado.test.js
// ==============================
// scripts/base-real.js baja la base de producción a una copia local para
// poder probar contra datos de verdad. Para eso tiene que partir el
// archivo de pg_dump en trozos de SQL y bloques de datos, porque PGlite
// no entiende ni los metacomandos de psql ni el COPY con las filas
// pegadas debajo.
//
// Ese partidor es la pieza peligrosa de todo el asunto: si se equivoca,
// no explota — pierde filas EN SILENCIO y uno se pasa la tarde
// preguntándose por qué la copia local tiene menos comentarios que
// producción. Por eso va con pruebas, y por eso las pruebas se meten con
// los datos raros, que es donde un analizador por líneas se rompe.
//
// Correr:  npm test

require("./_aislar-datos");   // antes de api/: ver ese archivo

const { test, describe } = require("node:test");
const assert = require("node:assert");
const { PGlite } = require("@electric-sql/pglite");
const { partirVolcado, cargarVolcado } = require("../scripts/base-real");

// Un volcado de mentira con la misma forma que los de pg_dump.
function volcado(cuerpo) {
  return [
    "--",
    "-- PostgreSQL database dump",
    "--",
    "",
    "\\restrict aBcDeF123",
    "",
    "SET statement_timeout = 0;",
    "SELECT pg_catalog.set_config('search_path', '', false);",
    "",
    cuerpo,
    "",
    "\\unrestrict aBcDeF123",
    ""
  ].join("\n");
}

const TAB = "\t";

// ==============================

describe("partir el volcado", () => {
  test("los metacomandos de psql no llegan al SQL", () => {
    const trozos = partirVolcado(volcado("CREATE TABLE public.t (id int);"));
    const sql = trozos.filter(t => t.tipo === "sql").map(t => t.texto).join("\n");

    assert.doesNotMatch(sql, /\\restrict/);
    assert.doesNotMatch(sql, /\\unrestrict/);
    assert.match(sql, /CREATE TABLE public\.t/);
  });

  test("un bloque COPY sale aparte, con su sentencia y sus filas", () => {
    const trozos = partirVolcado(volcado([
      "COPY public.t (id, nombre) FROM stdin;",
      "1" + TAB + "uno",
      "2" + TAB + "dos",
      "\\."
    ].join("\n")));

    const copias = trozos.filter(t => t.tipo === "copy");
    assert.strictEqual(copias.length, 1);
    assert.strictEqual(copias[0].tabla, "public.t");
    assert.match(copias[0].sentencia, /FROM stdin;$/);
    assert.strictEqual(copias[0].datos, "1\tuno\n2\tdos\n");
  });

  // Acá es donde un analizador por líneas se rompe: el dato ES una barra
  // invertida seguida de algo. Solo la línea que es EXACTAMENTE "\." cierra
  // el bloque.
  test("una fila que empieza por barra invertida no cierra el bloque", () => {
    const trozos = partirVolcado(volcado([
      "COPY public.t (id, nombre) FROM stdin;",
      "1" + TAB + "\\N",
      "2" + TAB + "\\\\ruta\\\\rara",
      "3" + TAB + "\\.punto",
      "\\."
    ].join("\n")));

    const copia = trozos.find(t => t.tipo === "copy");
    assert.strictEqual(copia.datos.trimEnd().split("\n").length, 3,
      "se perdieron filas: " + JSON.stringify(copia.datos));
  });

  // Y acá también: el dato contiene la palabra COPY al principio de línea.
  // Un comentario de perfil puede decir cualquier cosa.
  test("una fila que empieza por COPY tampoco abre otro bloque", () => {
    const trozos = partirVolcado(volcado([
      "COPY public.comentarios (id, texto) FROM stdin;",
      "1" + TAB + "COPY public.users (id) FROM stdin;",
      "2" + TAB + "normal",
      "\\."
    ].join("\n")));

    const copias = trozos.filter(t => t.tipo === "copy");
    assert.strictEqual(copias.length, 1, "creyó que había dos bloques");
    assert.strictEqual(copias[0].datos.trimEnd().split("\n").length, 2);
  });

  test("un bloque vacío no se cuela como una fila en blanco", () => {
    const trozos = partirVolcado(volcado([
      "COPY public.t (id) FROM stdin;",
      "\\."
    ].join("\n")));

    const copia = trozos.find(t => t.tipo === "copy");
    assert.strictEqual(copia.datos, "\n");
  });

  test("el SQL de antes y el de después de un COPY no se mezclan", () => {
    const trozos = partirVolcado(volcado([
      "CREATE TABLE public.t (id int);",
      "COPY public.t (id) FROM stdin;",
      "1",
      "\\.",
      "CREATE INDEX idx ON public.t (id);"
    ].join("\n")));

    const tipos = trozos.map(t => t.tipo);
    assert.deepStrictEqual(tipos, ["sql", "copy", "sql"]);
    assert.match(trozos[0].texto, /CREATE TABLE/);
    assert.match(trozos[2].texto, /CREATE INDEX/);
    assert.doesNotMatch(trozos[0].texto, /CREATE INDEX/);
  });

  test("varios bloques seguidos se separan bien", () => {
    const trozos = partirVolcado(volcado([
      "COPY public.a (id) FROM stdin;",
      "1",
      "\\.",
      "COPY public.b (id) FROM stdin;",
      "2",
      "3",
      "\\."
    ].join("\n")));

    const copias = trozos.filter(t => t.tipo === "copy");
    assert.deepStrictEqual(copias.map(c => c.tabla), ["public.a", "public.b"]);
    assert.strictEqual(copias[1].datos, "2\n3\n");
  });
});

describe("cargarlo de verdad en PGlite", () => {
  // La prueba que importa: que los datos lleguen enteros y con los tipos
  // correctos. Partir bien el texto no sirve de nada si después COPY lo
  // interpreta distinto.
  test("los datos llegan completos, con NULL y con caracteres raros", async () => {
    const db = new PGlite();
    await db.ready;

    const texto = volcado([
      "CREATE TABLE public.t (id int, nombre text, datos jsonb);",
      "COPY public.t (id, nombre, datos) FROM stdin;",
      "1" + TAB + "normal" + TAB + '{"a": 1}',
      "2" + TAB + "\\N" + TAB + "\\N",
      "3" + TAB + "con\\ttab y \\\\barra" + TAB + '{"b": "ñ á ü"}',
      "4" + TAB + "COPY algo FROM stdin;" + TAB + "null",
      "\\."
    ].join("\n"));

    const r = await cargarVolcado(db, texto);
    assert.strictEqual(r.tablas, 1);
    assert.strictEqual(r.filas, 4);

    const filas = (await db.query("SELECT * FROM public.t ORDER BY id")).rows;
    assert.strictEqual(filas.length, 4);

    assert.strictEqual(filas[0].nombre, "normal");
    assert.deepStrictEqual(filas[0].datos, { a: 1 });

    // El \N del formato texto de COPY es NULL, no la cadena "\N".
    assert.strictEqual(filas[1].nombre, null, "el \\N tenía que ser NULL");
    assert.strictEqual(filas[1].datos, null);

    // Y los escapes se deshacen: en el archivo hay "con\ttab y \\barra",
    // y lo que tiene que llegar a la columna es un TABULADOR de verdad y
    // UNA sola barra invertida.
    assert.strictEqual(filas[2].nombre, "con\ttab y \\barra");
    assert.strictEqual(filas[2].datos.b, "ñ á ü");

    assert.strictEqual(filas[3].nombre, "COPY algo FROM stdin;");

    await db.close();
  });

  test("y el search_path queda usable, que si no nada funciona", async () => {
    const db = new PGlite();
    await db.ready;

    await cargarVolcado(db, volcado([
      "CREATE TABLE public.t (id int);",
      "COPY public.t (id) FROM stdin;",
      "7",
      "\\."
    ].join("\n")));

    // El volcado deja el search_path vacío a propósito, para que todo vaya
    // calificado. Si no se devuelve a public, un SELECT normal contesta
    // relation "t" does not exist y uno se vuelve loco.
    const r = await db.query("SELECT id FROM t");
    assert.strictEqual(r.rows[0].id, 7);

    await db.close();
  });

  test("se pueden dejar tablas fuera sin perder su esquema", async () => {
    const db = new PGlite();
    await db.ready;

    await cargarVolcado(db, volcado([
      "CREATE TABLE public.chico (id int);",
      "CREATE TABLE public.enorme (id int);",
      "COPY public.chico (id) FROM stdin;",
      "1",
      "\\.",
      "COPY public.enorme (id) FROM stdin;",
      "1",
      "2",
      "3",
      "\\."
    ].join("\n")), null, ["public.enorme"]);

    assert.strictEqual((await db.query("SELECT count(*)::int n FROM chico")).rows[0].n, 1);
    // La tabla existe -el esquema se creó igual- pero está vacía.
    assert.strictEqual((await db.query("SELECT count(*)::int n FROM enorme")).rows[0].n, 0);

    await db.close();
  });
});

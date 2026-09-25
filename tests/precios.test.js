// ==============================
// EL PRECIO DE CADA RANURA — tests/precios.test.js
// ==============================
// api/_precios.js y la migración 022 llevan la misma tabla, una en
// JavaScript y otra en SQL, porque la migración no puede leer el módulo.
// Si alguien cambia una y no la otra, las prendas nuevas costarían
// distinto que las del catálogo original sin que nadie lo hubiera
// decidido. Esto lo impide.
//
// Correr:  npm test

require("./_aislar-datos");   // antes de api/: ver ese archivo

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const precios = require("../api/_precios");
const { CAPAS } = require("../api/_avatar-catalogo");

const MIGRACION = fs.readFileSync(path.join(__dirname, "..", "migrations", "022_tienda_catalogo_entero.sql"), "utf8");

test("la tabla del módulo es la de la migración 022", () => {
  const enSql = {};
  for (const m of MIGRACION.matchAll(/WHEN '(\w+)'\s+THEN (\d+)/g)) enSql[m[1]] = Number(m[2]);
  assert.deepStrictEqual(enSql, { ...precios.PRECIO_POR_CAPA });

  const otro = MIGRACION.match(/ELSE (\d+)\s+END/);
  assert.ok(otro, "la migración ya no tiene ELSE");
  assert.equal(Number(otro[1]), precios.PRECIO_POR_DEFECTO);
});

test("toda ranura que se vende tiene su precio", () => {
  for (const capa of CAPAS.filter(c => c !== "modelo")) {
    assert.ok(capa in precios.PRECIO_POR_CAPA, "falta el precio de " + capa);
  }
});

test("precioDeCapa: el de la tabla, o el de por defecto", () => {
  assert.equal(precios.precioDeCapa("pelo"), 120);
  assert.equal(precios.precioDeCapa("mascota"), 220);
  assert.equal(precios.precioDeCapa("no-existe"), precios.PRECIO_POR_DEFECTO);
  assert.equal(precios.precioDeCapa("constructor"), precios.PRECIO_POR_DEFECTO);
});

test("precioValido: enteros de 1 a 100.000", () => {
  for (const bueno of [1, 120, "150", 100000]) assert.ok(precios.precioValido(bueno), String(bueno));
  for (const malo of [0, -5, 1.5, 100001, "", null, undefined, "abc", NaN]) {
    assert.ok(!precios.precioValido(malo), String(malo));
  }
});

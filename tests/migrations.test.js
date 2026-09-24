// ==============================
// TESTS DE MIGRACIONES — tests/migrations.test.js
// ==============================
// Comprueban el esquema que arma la base local PGlite y, en particular,
// que la migración 015 se pueda aplicar más de una vez sin tocar el
// saldo existente de users.monedas.

require("./_aislar-datos");   // antes de api/: ver ese archivo

const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { crearBaseLocal } = require("../scripts/pglite");

const NOMBRE_USUARIO = "sonda_migracion_015";
const RUTA_MIGRACION = path.join(__dirname, "..", "migrations", "015_monedas_por_tiempo.sql");

let db;
let textoMigracion;

before(async () => {
  textoMigracion = fs.readFileSync(RUTA_MIGRACION, "utf8");
  db = await crearBaseLocal();

  await db.query(
    `INSERT INTO users (username, password_hash, level, xp, status, created_at, last_login, monedas)
     VALUES ($1, 'hash-de-prueba', 1, 0, 'active', now(), now(), 173)`,
    [NOMBRE_USUARIO]
  );
});

async function columnasUsers() {
  const resultado = await db.query(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'users'
       AND column_name IN (
         'monedas',
         'monedas_ultimo_otorgamiento',
         'monedas_ganadas_hoy',
         'monedas_ganadas_fecha'
       )
     ORDER BY column_name`
  );

  return resultado.rows;
}

test("la migración 015 deja el esquema de monedas con los tipos esperados", async () => {
  const columnas = await columnasUsers();
  const porNombre = new Map(columnas.map((columna) => [columna.column_name, columna]));

  assert.equal(columnas.length, 4, "debe existir una sola columna para cada dato de monedas");

  assert.equal(porNombre.get("monedas").data_type, "integer");
  assert.equal(porNombre.get("monedas").is_nullable, "NO");

  assert.equal(porNombre.get("monedas_ultimo_otorgamiento").data_type, "timestamp with time zone");
  assert.equal(porNombre.get("monedas_ultimo_otorgamiento").is_nullable, "YES");

  assert.equal(porNombre.get("monedas_ganadas_hoy").data_type, "integer");
  assert.equal(porNombre.get("monedas_ganadas_hoy").is_nullable, "NO");
  assert.match(porNombre.get("monedas_ganadas_hoy").column_default, /0/);

  assert.equal(porNombre.get("monedas_ganadas_fecha").data_type, "date");
  assert.equal(porNombre.get("monedas_ganadas_fecha").is_nullable, "YES");
});

test("la migración 015 es idempotente y no modifica users.monedas", async () => {
  const saldoAntes = await db.query(
    "SELECT monedas FROM users WHERE username = $1",
    [NOMBRE_USUARIO]
  );
  assert.equal(saldoAntes.rows[0].monedas, 173);

  // Se quitan solamente las columnas nuevas dentro de la base efímera
  // para simular una base previa a la 015 y probar la instalación real.
  await db.exec(`
    ALTER TABLE users DROP COLUMN monedas_ultimo_otorgamiento;
    ALTER TABLE users DROP COLUMN monedas_ganadas_hoy;
    ALTER TABLE users DROP COLUMN monedas_ganadas_fecha;
  `);

  await db.exec(textoMigracion);
  await db.exec(textoMigracion);

  const saldoDespues = await db.query(
    "SELECT monedas FROM users WHERE username = $1",
    [NOMBRE_USUARIO]
  );
  assert.equal(saldoDespues.rows[0].monedas, 173, "la migración no debe alterar el saldo existente");

  const columnas = await columnasUsers();
  assert.equal(columnas.length, 4, "reaplicar la migración no debe duplicar columnas");
});

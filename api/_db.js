// ==============================
// CONEXIÓN A LA BASE DE DATOS — api/_db.js
// ==============================
// Único lugar del backend que decide CON QUÉ base hablamos:
//
//   - En producción (VPS): usa el Postgres instalado en el servidor,
//     vía el adaptador de api/_pg.js, leyendo DATABASE_URL.
//
//   - Contra Neon (el hosting anterior): si DATABASE_URL apunta a un
//     host de Neon, se usa el driver HTTP de Neon. Se conserva para
//     poder leer la base vieja durante la migración de datos.
//
//   - En desarrollo local (tests y scripts de esta computadora):
//     se puede reemplazar con una base de práctica local (PGlite,
//     Postgres embebido) llamando a usarSqlLocal(). Así podemos
//     probar TODO el flujo (registro, login, migración de contraseñas)
//     sin tocar la base real del proyecto original.
//
// Por qué existe: antes cada archivo de la API creaba su propia
// conexión con `neon(process.env.DATABASE_URL)` en la primera línea.
// Con esto queda centralizado y, además, se vuelve posible probar los
// mismos handlers de verdad contra una base local.
//
// El driver se elige mirando la URL, no una variable aparte: así no
// hay forma de que la app apunte a un Postgres normal pero intente
// hablarle por HTTP (o al revés), que es el tipo de error que solo
// aparece en producción.

let _sql = null;
let _sqlLocal = null;

// Un host de Neon se reconoce por su dominio. Cualquier otra cosa
// (127.0.0.1, un host propio) se trata como Postgres normal.
function esUrlDeNeon(url) {
  return typeof url === "string" && url.includes(".neon.tech");
}

// Cambia la conexión a una base local (solo para desarrollo/tests).
// Recibe una función "sql" con la misma interfaz que la de Neon
// (sql`...`), por ejemplo el adaptador de scripts/pglite.js.
function usarSqlLocal(sqlLocal) {
  _sqlLocal = sqlLocal;
  _sql = null; // la próxima llamada vuelve a resolver la conexión
}

// Devuelve la función sql lista para usar (Postgres del VPS, Neon o
// la base local de pruebas).
function obtenerSql() {
  if (_sql) return _sql;
  if (_sqlLocal) {
    _sql = _sqlLocal;
    return _sql;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "Falta DATABASE_URL. En el VPS se define en el archivo .env del proyecto."
    );
  }

  if (esUrlDeNeon(url)) {
    // require() adentro para no exigir el paquete de Neon en un
    // servidor que ya no lo necesita.
    const { neon } = require("@neondatabase/serverless");
    _sql = neon(url);
  } else {
    const { crearSqlPg, crearPool } = require("./_pg");
    _sql = crearSqlPg(crearPool(url));
  }

  return _sql;
}

module.exports = { obtenerSql, usarSqlLocal };

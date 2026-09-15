// ==============================
// BASE LOCAL DE PRÁCTICA — scripts/pglite.js
// ==============================
// Maqueta de la base de datos que corre DENTRO de esta computadora,
// usando PGlite (Postgres real compilado a WASM, sin servidor ni
// cuenta). Sirve para probar TODO localmente sin tocar la base de
// producción del proyecto original.
//
// Dos piezas:
//
//   1) crearSqlPGlite(db): adaptador que imita la interfaz del driver
//      de Neon (`sql\`...\`` con interpolaciones -> placeholders $1,
//      $2... y devuelve un array de filas). Con esto, el MISMO código
//      de la API corre contra la base local sin cambiar nada.
//
//   2) crearBaseLocal(): crea la base, arma la tabla "users" mínima
//      (igual que en producción antes de las migraciones) y le aplica
//      TODAS las migraciones de migrations/ en orden, tal como se
//      haría en Neon. Así la maqueta queda con el mismo esquema.

const { PGlite } = require("@electric-sql/pglite");
const fs = require("fs");
const path = require("path");

// Marca para reconocer los "fragmentos" de SQL que arma este adaptador.
const SIMBOLO_FRAGMENTO = Symbol("fragmentoSQL");

// El driver de Neon permite componer consultas en pedazos:
//
//   const pedazo = sql`date_trunc('week', now())`;   // NO se ejecuta aún
//   await sql`SELECT ... WHERE x = ${pedazo} ...`;   // el pedazo se incrusta
//
// Este adaptador replica ese comportamiento:
//   - sql`...` devuelve un "fragmento" (objeto thenable) que recién se
//     ejecuta cuando se espera con await.
//   - Si un fragmento aparece interpolado dentro de otro sql`...`, se
//     incrusta su texto SQL y sus parámetros (renumbrándolos) en vez
//     de tratarlo como un valor común.
//
// La API de producción usa esto en api/users.js (semanaActualSQL): sin
// este soporte, cualquier GET /api/users fallaba en el modo local con
// un error de sintaxis en date_trunc.

// Renumera los placeholders $k de un fragmento según la posición que
// le toca dentro de la consulta que lo contiene.
function renumbrarFragmento(texto, cantidadParams, base) {
  if (cantidadParams === 0) return texto;
  let contador = 0;
  return texto.replace(/\$\d+/g, (coincidencia) => {
    const n = parseInt(coincidencia.slice(1), 10);
    if (n <= cantidadParams) {
      contador++;
      return `$${base + contador}`;
    }
    return coincidencia;
  });
}

// Arma el texto SQL final: los valores comunes se convierten en
// placeholders $1, $2... y los fragmentos se incrustan tal cual (con
// sus parámetros renumerados al final de los ya acumulados).
function compilar(plantilla, valores) {
  let texto = "";
  const params = [];

  for (let i = 0; i < plantilla.length; i++) {
    texto += plantilla[i];
    if (i >= valores.length) continue;

    const valor = valores[i];

    if (valor && typeof valor === "object" && valor[SIMBOLO_FRAGMENTO]) {
      texto += renumbrarFragmento(valor.texto, valor.params.length, params.length);
      params.push(...valor.params);
    } else {
      params.push(valor);
      texto += `$${params.length}`;
    }
  }

  return { texto, params };
}

// Convierte el uso `sql\`...\`` (estilo Neon) en consultas de PGlite.
// Neon devuelve un array de filas; acá se replica ese comportamiento.
function crearSqlPGlite(db) {

  function sql(plantilla, ...valores) {
    const { texto, params } = compilar(plantilla, valores);

    // Objeto "thenable": SIEMPRE es un fragmento, y si se espera con
    // await se ejecuta. Así un pedazo suelto se puede incrustar en
    // otro sql`...` sin ejecutarse antes de tiempo.
    return {
      [SIMBOLO_FRAGMENTO]: true,
      texto,
      params,
      then(resolve, reject) {
        return db.query(texto, params).then(
          (resultado) => resolve(resultado.rows),
          reject
        );
      }
    };
  }

  // api/content.js usa sql.query(texto, parametros) en el registro de
  // moderación; se expone también por compatibilidad.
  sql.query = async (texto, valores) => {
    const resultado = await db.query(texto, valores || []);
    return resultado.rows;
  };

  return sql;
}

// Tabla "users" base, igual que en producción ANTES de la migración
// 013 (sin password_hash todavía): las migraciones 001-012 se apoyan
// en que esta tabla ya existe y solo le agregan columnas (monedas,
// rank_*, ranking_puntuacion, etc.).
const USERS_INICIAL = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password TEXT,
    level INTEGER NOT NULL DEFAULT 1,
    xp INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    bio TEXT,
    -- JSONB, igual que en producción. Estuvo como TEXT y eso hacía que
    -- los handlers devolvieran el avatar como cadena en los tests y como
    -- objeto en el servidor real: la maqueta mentía sobre la base.
    avatar JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    last_login TIMESTAMP
  );
`;

// Crea la base local (en memoria por defecto) y le aplica todas las
// migraciones de migrations/ en orden.
async function crearBaseLocal() {
  const db = new PGlite(); // en memoria
  await db.ready;
  await db.exec(USERS_INICIAL);

  const directorio = path.join(__dirname, "..", "migrations");
  const archivos = fs.readdirSync(directorio)
    .filter(f => f.endsWith(".sql"))
    .sort();

  for (const archivo of archivos) {
    await db.exec(fs.readFileSync(path.join(directorio, archivo), "utf8"));
  }

  return db;
}

module.exports = { crearSqlPGlite, crearBaseLocal };

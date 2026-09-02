// ==============================
// ADAPTADOR POSTGRES — api/_pg.js
// ==============================
// Traduce el uso `sql`...`` (estilo del driver de Neon) a consultas
// del driver "pg", para poder correr contra un Postgres normal, como
// el que vive en el VPS, sin cambiar ni una línea de los handlers.
//
// Por qué existe: el driver de Neon (@neondatabase/serverless) habla
// SQL sobre HTTPS contra la infraestructura de Neon. Un Postgres
// instalado en el servidor habla el protocolo nativo por TCP, así que
// ese driver no sirve. Lo que sí se puede conservar es la INTERFAZ:
// los siete handlers de api/ escriben sus consultas como
// `sql`SELECT ... ${valor}`` y esperan de vuelta un array de filas.
//
// Este archivo es el gemelo de scripts/pglite.js (el adaptador que ya
// se usaba en los tests). Misma técnica, mismo contrato, distinto
// motor debajo: allá PGlite en memoria, acá un Pool de "pg". Que los
// tests lleven tiempo corriendo contra esa forma es la garantía de
// que los handlers no notan el cambio.

const { Pool } = require("pg");

// Marca para reconocer los "fragmentos" de SQL que arma este adaptador.
const SIMBOLO_FRAGMENTO = Symbol("fragmentoSQL");

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
//
// El soporte de fragmentos anidados no es un lujo: api/users.js arma
// `semanaActualSQL` como un pedazo suelto y lo incrusta dentro de
// otras consultas. Sin esto, cualquier GET /api/users falla con un
// error de sintaxis en date_trunc.
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

// Crea la función sql`...` conectada a un Pool de "pg".
// Devuelve un array de filas, igual que el driver de Neon.
function crearSqlPg(pool) {

  function sql(plantilla, ...valores) {
    const { texto, params } = compilar(plantilla, valores);

    // Objeto "thenable": SIEMPRE es un fragmento, y solo se ejecuta si
    // se espera con await. Así un pedazo suelto se puede incrustar en
    // otro sql`...` sin dispararse antes de tiempo.
    return {
      [SIMBOLO_FRAGMENTO]: true,
      texto,
      params,
      then(resolve, reject) {
        return pool.query(texto, params).then(
          (resultado) => resolve(resultado.rows),
          reject
        );
      }
    };
  }

  // api/content.js usa sql.query(texto, parametros) en el registro de
  // moderación; se expone también por compatibilidad.
  sql.query = async (texto, valores) => {
    const resultado = await pool.query(texto, valores || []);
    return resultado.rows;
  };

  return sql;
}

// Pool único para todo el proceso. Tamaño contenido a propósito: el
// VPS tiene 950 MB de RAM y cada conexión de Postgres cuesta memoria
// del lado del servidor. Con un solo proceso de Node, 10 conexiones
// sobran para el tráfico de este sitio.
function crearPool(connectionString) {
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });
}

module.exports = { crearSqlPg, crearPool };

// ==============================
// UNA COPIA DE LA BASE DE VERDAD — scripts/base-real.js
// ==============================
// Carga un respaldo de producción en una base PGlite local, para poder
// probar contra los datos reales antes de tocar el servidor.
//
// Hasta ahora el modo local nacía vacío y se llenaba con lo que dijeran
// las migraciones más un puñado de cosas de mentira. Sirve para el camino
// feliz, pero no para lo que de verdad rompe: el usuario con 200 prendas
// guardadas, la prenda descuadrada que lleva puesta alguien desde hace un
// año, el avatar PNG de 984 kB, las 271.000 puntuaciones del ranking.
//
// LO QUE NO CARGA: las credenciales. Ver despersonalizar(), abajo.
//
// ---------------------------------------------------------------
// POR QUÉ HAY QUE TRADUCIR EL VOLCADO
// ---------------------------------------------------------------
// pg_dump escribe un archivo pensado para psql, y PGlite no es psql:
//
//   1. Lleva metacomandos de psql (\restrict, \unrestrict) que no son
//      SQL. PGlite contesta: syntax error at or near "estrict".
//
//   2. Vuelca los datos con COPY ... FROM stdin y las filas a
//      continuación, en el mismo archivo. Eso funciona porque psql las va
//      mandando por el protocolo; PGlite recibe el texto de golpe y se
//      atraganta con la primera fila: syntax error at or near "1".
//
// PGlite sí sabe hacer COPY desde un bloque de datos, con la ruta mágica
// '/dev/blob'. Así que este archivo parte el volcado en trozos, ejecuta
// el SQL tal cual y le pasa cada bloque de datos por esa vía. Es además
// mucho más rápido que convertirlo todo a INSERT: son 271.000 filas en
// una sola tabla.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// El esquema lo trae el propio volcado, así que la copia real NO aplica
// las migraciones: lo que queda en local es exactamente lo que hay en
// producción, con la deriva que tenga.
const { PGlite } = require("@electric-sql/pglite");


// ---------- PARTIR EL VOLCADO ----------

// Devuelve una lista de trozos: {tipo:"sql", texto} y
// {tipo:"copy", sentencia, datos, tabla}.
//
// Se recorre por líneas y no con una expresión regular sobre todo el
// archivo: los bloques de datos tienen de todo dentro -punto y coma,
// comillas, llaves de JSON- y cualquier intento de reconocerlos "por
// forma" se rompe con el primer avatar que lleve un ';' en la biografía.
function partirVolcado(texto) {
  const trozos = [];
  let sql = [];
  let copiando = null;
  let datos = [];

  for (const linea of texto.split("\n")) {
    if (copiando) {
      // El fin de un bloque COPY es una línea con exactamente "\.".
      if (linea === "\\.") {
        trozos.push({
          tipo: "copy",
          sentencia: copiando.sentencia,
          tabla: copiando.tabla,
          datos: datos.join("\n") + "\n"
        });
        copiando = null;
        datos = [];
      } else {
        datos.push(linea);
      }
      continue;
    }

    // Metacomandos de psql: no son SQL y PGlite no los entiende.
    if (/^\\[a-zA-Z]/.test(linea)) continue;

    const copy = /^COPY\s+(\S+)\s.*FROM stdin;\s*$/.exec(linea);
    if (copy) {
      if (sql.length) { trozos.push({ tipo: "sql", texto: sql.join("\n") }); sql = []; }
      copiando = { sentencia: linea, tabla: copy[1] };
      continue;
    }

    sql.push(linea);
  }

  if (sql.length) trozos.push({ tipo: "sql", texto: sql.join("\n") });
  return trozos;
}


// ---------- CARGARLO ----------

async function cargarVolcado(db, texto, avisar, saltar) {
  const trozos = partirVolcado(texto);
  const copias = trozos.filter(t => t.tipo === "copy");
  const fuera = new Set(saltar || []);
  let hechas = 0;
  let filas = 0;

  for (const trozo of trozos) {
    if (trozo.tipo === "sql") {
      if (!trozo.texto.trim()) continue;
      await db.exec(trozo.texto);
      continue;
    }

    // Los dos registros históricos son 90 de los 108 MB y no hacen falta
    // para probar nada del sitio; se pueden dejar fuera. La TABLA se crea
    // igual -eso lo hizo el trozo de SQL anterior-, solo se queda vacía.
    if (fuera.has(trozo.tabla)) {
      hechas++;
      if (avisar) avisar(trozo.tabla, 0, hechas, copias.length);
      continue;
    }

    // COPY tabla (cols) FROM stdin;  ->  ... FROM '/dev/blob'
    const sentencia = trozo.sentencia.replace(/FROM stdin;\s*$/, "FROM '/dev/blob'");
    const cuantas = trozo.datos === "\n" ? 0 : trozo.datos.trimEnd().split("\n").length;

    if (cuantas) {
      await db.query(sentencia, [], { blob: new Blob([trozo.datos]) });
      filas += cuantas;
    }

    hechas++;
    if (avisar) avisar(trozo.tabla, cuantas, hechas, copias.length);
  }

  // El volcado arranca con set_config('search_path', '', false) para que
  // todo vaya calificado con su esquema, y eso deja la SESIÓN sin
  // search_path: después de cargar, un "SELECT ... FROM users" a secas
  // contesta relation "users" does not exist. Se devuelve a lo normal.
  //
  // Es solo de sesión: una conexión nueva contra la carpeta ya guardada
  // nace con el search_path por defecto, y hay una prueba que lo afirma.
  await db.exec("SET search_path TO public;");

  return { tablas: copias.length, filas };
}


// ---------- QUITAR LAS CREDENCIALES ----------

// Esto NO es opcional por capricho.
//
// La tabla users guarda password_hash (bcrypt) y todavía password EN
// TEXTO PLANO, que es el resto de la migración perezosa: quien no haya
// entrado desde entonces conserva su contraseña legible. Bajar eso a un
// portátil es sacar contraseñas reales de gente que las reutiliza en
// otros sitios, a cambio de nada: para probar el sitio no hace falta
// saber la contraseña de nadie.
//
// Lo que se hace es mejor para probar, además: TODAS las cuentas quedan
// con la misma contraseña conocida, así que se puede entrar como
// cualquiera para reproducir lo que le pasa.
async function despersonalizar(db, clave) {
  const bcrypt = require("bcryptjs");
  const hash = await bcrypt.hash(clave, 10);

  // Si el volcado no trae users -uno parcial, uno de prueba- no se cae:
  // se dice y se sigue. Caerse aqui seria caerse DESPUES de haber borrado
  // la copia anterior.
  try {
    const r = await db.query(
      "UPDATE public.users SET password = NULL, password_hash = $1 RETURNING id", [hash]);
    return { cuentas: r.rows.length, clave };
  } catch (_) {
    return { cuentas: 0, clave, sinTablaUsers: true };
  }
}


// ---------- ARMARLA ----------

function leerVolcado(ruta) {
  const bytes = fs.readFileSync(ruta);
  return ruta.endsWith(".gz")
    ? zlib.gunzipSync(bytes).toString("utf8")
    : bytes.toString("utf8");
}

// Construye la copia local desde cero y la deja en disco. PGlite guarda
// su base en una carpeta, así que esto se hace UNA vez y después el
// servidor local arranca en segundos.
async function construirBaseReal(rutaDatos, rutaVolcado, opciones) {
  const conf = opciones || {};

  if (fs.existsSync(rutaDatos)) fs.rmSync(rutaDatos, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(rutaDatos), { recursive: true });

  const db = new PGlite(rutaDatos);
  await db.ready;

  const resumen = await cargarVolcado(db, leerVolcado(rutaVolcado), conf.avisar, conf.saltar);

  let credenciales = null;
  if (conf.despersonalizar !== false) {
    credenciales = await despersonalizar(db, conf.clave || "local1234");
  }

  return { db, ...resumen, credenciales };
}

// Abre la copia que ya está en disco.
async function abrirBaseReal(rutaDatos) {
  if (!fs.existsSync(rutaDatos)) return null;
  const db = new PGlite(rutaDatos);
  await db.ready;
  return db;
}

module.exports = {
  partirVolcado,
  cargarVolcado,
  despersonalizar,
  construirBaseReal,
  abrirBaseReal,
  leerVolcado
};

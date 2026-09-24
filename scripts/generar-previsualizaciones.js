// ==============================
// GENERAR LAS PREVISUALIZACIONES — scripts/generar-previsualizaciones.js
// ==============================
// Genera la previsualizacion de cada prenda del catalogo y apunta su
// huella en la base (migracion 021). Las nuevas ya la traen al subirse
// desde el panel de arte; esto es para las que ya estaban, y para cuando
// cambie algo que las afecte a muchas: la regla del cuadro, un modelo
// resubido, un cuadro forzado con la herramienta.
//
// Es IDEMPOTENTE: lo que no cambio no se rehace, asi que se puede correr
// las veces que haga falta y cortar por la mitad sin consecuencias.
//
//   node scripts/generar-previsualizaciones.js                          simulacro, no escribe
//   node scripts/generar-previsualizaciones.js --aplicar                de verdad, en local
//   node scripts/generar-previsualizaciones.js --produccion --aplicar
//
// Como el relleno de los avatares: --aplicar y --produccion se piden a
// proposito, cada uno por su lado.
//
// CUANTO TARDA: las 768 en unos 10 segundos en un PC. Va de una en una a
// proposito: en el VPS, la maquina esta sirviendo el sitio mientras tanto.
//
// OJO en local: abre la copia de la base, asi que no se corre con el
// servidor local (npm run db:real) abierto. Dos procesos sobre la misma
// copia pueden estropearla.

const path = require("path");

const previsualizaciones = require("../api/_previsualizaciones");

const PGDATA = process.env.MR_PGDATA || path.join(__dirname, "..", "datos-locales", "pgdata");
const PRODUCCION = process.argv.includes("--produccion");
const APLICAR = process.argv.includes("--aplicar");

const ms = () => Number(process.hrtime.bigint() / 1000000n);

async function abrirBase() {
  if (PRODUCCION) {
    if (!process.env.DATABASE_URL) {
      console.error("Falta DATABASE_URL para trabajar contra produccion.");
      process.exit(1);
    }
    const { obtenerSql } = require("../api/_db");
    return { sql: obtenerSql(), cerrar: async () => {} };
  }

  const { abrirBaseReal } = require("./base-real");
  const { crearSqlPGlite } = require("./pglite");

  const db = await abrirBaseReal(PGDATA);
  if (!db) {
    console.error("\nNo hay copia de produccion en datos-locales/pgdata.");
    console.error("Traela con:  npm run db:traer\n");
    process.exit(1);
  }
  return { sql: crearSqlPGlite(db), cerrar: async () => db.close() };
}

async function main() {
  console.log((PRODUCCION ? "PRODUCCION" : "Copia local") + " · " +
    (APLICAR ? "APLICANDO" : "simulacro, no se escribe nada (pasar --aplicar para escribir)"));
  console.log("Carpeta: " + previsualizaciones.DIRECTORIO + "\n");

  const { sql, cerrar } = await abrirBase();
  const t0 = ms();
  let r;
  try {
    r = await previsualizaciones.asegurar(sql, { escribir: APLICAR });
  } finally {
    await cerrar();
  }

  const segundos = ((ms() - t0) / 1000).toFixed(1);
  console.log(r.total + " prendas en " + segundos + " s:");
  console.log("  " + (APLICAR ? "hechas  " : "por hacer") + " " + r.hechas +
    (APLICAR && r.hechas ? " (" + (r.bytes / 1024).toFixed(0) + " kB)" : ""));
  console.log("  ya estaban " + r.iguales);
  if (APLICAR) console.log("  direcciones nuevas " + r.cambiadas + (r.cambiadas ? " (se subio la version del catalogo)" : ""));
  console.log("  fallos     " + r.fallos.length);
  for (const f of r.fallos) console.log("    " + f.id + " " + f.valor + ": " + f.error);

  if (r.fallos.length) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

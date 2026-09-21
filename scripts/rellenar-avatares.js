// ==============================
// COMPONER LOS AVATARES QUE YA EXISTEN — scripts/rellenar-avatares.js
// ==============================
// A partir de la migracion 019, el servidor compone el avatar al
// guardarlo. Pero los que ya estaban guardados nunca pasaron por ahi:
// quedarian sin compuesto hasta que su dueno se cambiara de ropa, y hay
// quien no se la cambia desde julio.
//
// Esto los compone todos de una vez. Es IDEMPOTENTE: lo que ya esta
// hecho no se vuelve a hacer, asi que se puede correr las veces que
// haga falta y se puede cortar por la mitad sin consecuencias.
//
//   node scripts/rellenar-avatares.js               simulacro, no escribe
//   node scripts/rellenar-avatares.js --aplicar     de verdad, en local
//   node scripts/rellenar-avatares.js --produccion --aplicar
//
// Como el horno del catalogo: hay que pedir --aplicar y --produccion a
// proposito, cada uno por su lado.
//
// CUANTO TARDA: unos 156 ms por avatar en el VPS. Con 215 son unos 35
// segundos, y va de uno en uno a proposito: la maquina tiene dos
// nucleos y esta sirviendo el sitio mientras tanto.

const path = require("path");

const avatarCompuesto = require("../api/_avatar-compuesto");

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

// Recorre una tabla componiendo lo que le falte. Las dos tablas
// -users y saved_avatars- tienen la misma forma para esto, asi que se
// hace una sola vez y se llama dos.
async function rellenar(sql, nombreTabla, filas) {
  let hechos = 0, yaEstaban = 0, sinNada = 0, fallos = 0;
  const t0 = ms();

  for (const fila of filas) {
    const avatar = typeof fila.avatar === "string" ? JSON.parse(fila.avatar) : fila.avatar;

    let receta;
    try {
      receta = await avatarCompuesto.recetaDe(sql, avatar);
    } catch (error) {
      console.log("  FALLO  " + fila.quien + ": " + error.message);
      fallos++;
      continue;
    }

    if (!receta) {
      // Sin prendas no hay compuesto, y eso no es un error.
      sinNada++;
      continue;
    }

    const yaEsta = fila.avatar_compuesto === receta.huella && avatarCompuesto.estanTodos(receta.huella);
    if (yaEsta) { yaEstaban++; continue; }

    if (!APLICAR) { hechos++; continue; }

    try {
      const huella = await avatarCompuesto.asegurar(sql, avatar);
      if (nombreTabla === "users") {
        await sql`UPDATE users SET avatar_compuesto = ${huella} WHERE id = ${fila.id};`;
      } else {
        await sql`UPDATE saved_avatars SET avatar_compuesto = ${huella} WHERE id = ${fila.id};`;
      }
      hechos++;
    } catch (error) {
      console.log("  FALLO  " + fila.quien + ": " + error.message);
      fallos++;
    }
  }

  const tardo = ms() - t0;
  console.log("  " + nombreTabla + ":");
  console.log("    " + (APLICAR ? "compuestos" : "por componer") + ": " + hechos);
  console.log("    ya estaban        : " + yaEstaban);
  console.log("    sin prendas       : " + sinNada);
  console.log("    fallos            : " + fallos);
  if (APLICAR && hechos) {
    console.log("    tardo             : " + (tardo / 1000).toFixed(1) + " s, " + Math.round(tardo / hechos) + " ms por avatar");
  }
  return { hechos, fallos };
}

async function main() {
  console.log("");
  console.log("RELLENAR LOS AVATARES COMPUESTOS");
  console.log("================================");
  console.log("Base    : " + (PRODUCCION ? "PRODUCCION" : "datos-locales/pgdata"));
  console.log("Modo    : " + (APLICAR ? "APLICAR (escribe de verdad)" : "simulacro, no escribe nada"));
  console.log("Destino : " + avatarCompuesto.DIRECTORIO);
  console.log("");

  const { sql, cerrar } = await abrirBase();

  try {
    const usuarios = await sql`
      SELECT id, username AS quien, avatar, avatar_compuesto
      FROM users
      WHERE avatar IS NOT NULL AND avatar::text <> '{}'
      ORDER BY id;`;

    const ranuras = await sql`
      SELECT a.id, u.username || ' #' || a.slot AS quien, a.avatar, a.avatar_compuesto
      FROM saved_avatars a JOIN users u ON u.id = a.user_id
      ORDER BY a.id;`;

    console.log("Hay " + usuarios.length + " avatares puestos y " + ranuras.length + " en ranuras.");
    console.log("");

    const a = await rellenar(sql, "users", usuarios);
    const b = await rellenar(sql, "saved_avatars", ranuras);

    console.log("");
    if (!APLICAR) {
      console.log("Esto fue un simulacro. Para hacerlo de verdad, anade --aplicar.");
    } else {
      console.log("Listo: " + (a.hechos + b.hechos) + " compuestos, " + (a.fallos + b.fallos) + " fallos.");
    }
    console.log("");
    process.exitCode = (a.fallos + b.fallos) ? 1 : 0;
  } finally {
    await cerrar();
  }
}

main().catch(error => {
  console.error("\nFallo el relleno:", error && error.stack || error);
  process.exit(2);
});

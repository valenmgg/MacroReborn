// ==============================
// TRAER LA BASE DE PRODUCCIÓN — scripts/traer-base.js
// ==============================
// Baja el último respaldo del VPS y arma con él una copia local, para
// poder probar contra los datos de verdad antes de tocar el servidor.
//
//   npm run db:traer                  respaldo nuevo, copia limpia
//   npm run db:traer -- --ultimo      usa el último respaldo que ya haya
//   npm run db:traer -- --archivo=X   usa un .sql.gz que ya esté bajado
//   npm run db:traer -- --sin-registros   se salta los dos registros
//                                     históricos (90 de los 108 MB)
//   npm run db:traer -- --tal-cual    NO toca las credenciales (leer abajo)
//
// Y después:  npm run db:real
//
// ---------------------------------------------------------------
// ESTO BAJA DATOS DE PERSONAS
// ---------------------------------------------------------------
// El respaldo trae las cuentas, los comentarios de perfil, los mensajes
// de chat y las biografías de 141 personas. No hay correos -la tabla
// users no tiene esa columna- pero sí contraseñas: password_hash con
// bcrypt y, en quien no haya entrado desde la migración perezosa,
// password EN TEXTO PLANO.
//
// Por eso, por defecto, la copia local se queda SIN credenciales: todas
// las cuentas pasan a tener la misma clave conocida. No se pierde nada
// para probar y se gana algo -se puede entrar como cualquiera para
// reproducir lo que le pasa-, y deja de haber contraseñas reales de
// terceros en un portátil.
//
// --tal-cual existe para cuando haga falta depurar la propia migración de
// contraseñas. Si se usa, que sea a sabiendas.
//
// La carpeta datos-locales/ está en .gitignore. Que siga estando.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { construirBaseReal } = require("./base-real");

const RAIZ = path.join(__dirname, "..");
const DESTINO = path.join(RAIZ, "datos-locales");
const PGDATA = path.join(DESTINO, "pgdata");

// Configurable por si cambia la máquina; los valores por defecto son los
// que documenta docs/VPS.md.
const HOST = process.env.MR_VPS_HOST || "azureuser@172.184.203.20";
const LLAVE = process.env.MR_VPS_KEY ||
  path.join(process.env.USERPROFILE || process.env.HOME || "", ".ssh", "macroreborn-vps-key.pem");

const REGISTROS_HISTORICOS = ["public.activity_log", "public.originales_scores"];

function bandera(nombre) {
  return process.argv.slice(2).some(a => a === "--" + nombre);
}

function valor(nombre) {
  const a = process.argv.slice(2).find(x => x.startsWith("--" + nombre + "="));
  return a ? a.slice(nombre.length + 3) : null;
}

function porSsh(orden) {
  return execFileSync("ssh", ["-i", LLAVE, "-o", "BatchMode=yes", HOST, orden],
    { encoding: "utf8", maxBuffer: 1024 * 1024 }).trim();
}

function bajarRespaldo() {
  if (!fs.existsSync(LLAVE)) {
    console.error("No está la llave del VPS en " + LLAVE);
    console.error("Se puede indicar otra con MR_VPS_KEY. Ver docs/VPS.md.");
    process.exit(1);
  }

  if (!bandera("ultimo")) {
    console.log("Pidiéndole al servidor un respaldo nuevo...");
    console.log("  " + porSsh("~/respaldar.sh"));
  }

  const nombre = porSsh("ls -t ~/respaldos/diarios/ | head -1");
  const local = path.join(DESTINO, nombre);

  if (fs.existsSync(local)) {
    console.log("Ya estaba bajado: " + nombre);
    return local;
  }

  console.log("Bajando " + nombre + "...");
  fs.mkdirSync(DESTINO, { recursive: true });
  execFileSync("scp", ["-i", LLAVE, "-o", "BatchMode=yes",
    HOST + ":~/respaldos/diarios/" + nombre, local], { stdio: "inherit" });

  return local;
}

async function main() {
  const elegido = valor("archivo");
  const volcado = elegido
    ? (path.isAbsolute(elegido) ? elegido : path.join(RAIZ, elegido))
    : bajarRespaldo();

  if (!fs.existsSync(volcado)) {
    console.error("No existe el volcado: " + volcado);
    process.exit(1);
  }

  const peso = Math.round(fs.statSync(volcado).size / 1024 / 1024 * 10) / 10;
  console.log("\nArmando la copia local desde " + path.basename(volcado) + " (" + peso + " MB)...");

  const saltar = bandera("sin-registros") ? REGISTROS_HISTORICOS : [];
  if (saltar.length) console.log("  (sin " + saltar.join(" ni ") + ")");

  const t0 = Date.now();
  const r = await construirBaseReal(PGDATA, volcado, {
    saltar,
    despersonalizar: !bandera("tal-cual"),
    clave: valor("clave") || "local1234",
    avisar: (tabla, filas) => {
      if (filas >= 1000) console.log("  " + tabla + ": " + filas + " filas");
    }
  });

  console.log("\n" + r.tablas + " tablas, " + r.filas.toLocaleString("es") +
    " filas, en " + Math.round((Date.now() - t0) / 1000) + " s");

  if (r.credenciales) {
    console.log("\nTodas las cuentas (" + r.credenciales.cuentas + ") tienen ahora la clave: " +
      r.credenciales.clave);
    console.log("Se puede entrar como cualquier usuario del sitio para reproducir lo suyo.");
  } else {
    console.log("\nCUIDADO: --tal-cual. Esta copia lleva las contraseñas reales.");
  }

  const cuantas = async s => (await r.db.query(s)).rows[0].n;
  console.log("\nLo que hay dentro:");
  console.log("  usuarios          " + await cuantas("SELECT count(*)::int n FROM users"));
  console.log("  prendas           " + await cuantas("SELECT count(*)::int n FROM avatar_prendas"));
  console.log("  archivos de arte  " + await cuantas("SELECT count(*)::int n FROM avatar_archivos"));
  console.log("  avatares guardados " + await cuantas("SELECT count(*)::int n FROM saved_avatars"));

  await r.db.close();

  console.log("\nListo. Ahora:  npm run db:real");
}

main().catch(e => {
  console.error("\nFalló: " + e.message.split("\n")[0]);
  if (/ssh|scp|ENOENT/i.test(e.message)) {
    console.error("Si es por el acceso al servidor, mirá docs/VPS.md.");
  }
  process.exit(1);
});

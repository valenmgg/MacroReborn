// ==============================
// PRENDAS COLGANDO — scripts/avatares-colgando.js
// ==============================
// Busca valores que la gente LLEVA PUESTOS y que ya no existen en el
// catálogo (avatar_prendas). Mira el avatar activo de cada cuenta y los
// seis casilleros de galería.
//
//   node scripts/avatares-colgando.js            -> solo informa
//   node scripts/avatares-colgando.js --limpiar  -> pone esas capas en "ninguno"
//
// Sin --limpiar no escribe nada, igual que importar-catalogo.js.
//
// ------------------------------------------------------------------
// POR QUÉ IMPORTA
// ------------------------------------------------------------------
// Un valor colgando hace dos cosas, y la segunda es la grave:
//
//   1. Un 404 en la consola de cualquiera que mire ese perfil, y una
//      capa que no se dibuja.
//
//   2. Deja un hueco en la numeración que el panel del equipo de arte
//      puede repartir otra vez.
//
// El segundo caso ya estuvo a punto de morder. "tora_piel7" lo llevaban
// tres cuentas y dos casilleros, pero su fichero se borró hace tiempo y
// nunca entró en la base: el catálogo de tora/piel llegaba hasta el 6,
// así que el primer hueco libre era justo el 7. La siguiente piel de
// tora que alguien subiera se habría convertido, sin aviso, en la piel
// de esas tres personas.
//
// api/content.js ya no reparte números que alguien lleve puestos, así
// que el agujero está tapado. Este script es la otra mitad: ver cuáles
// hay y, si se quiere, limpiarlos.
//
// ------------------------------------------------------------------
// QUÉ NO TOCA
// ------------------------------------------------------------------
// - La capa "modelo". Es el cuerpo del avatar, no una prenda; ponerla
//   en "ninguno" dejaría un avatar imposible de dibujar. Si alguna sale
//   colgando se informa, pero --limpiar la salta.
//
// - Los avatares subidos como PNG (tipo: "png"). No tienen capas.
//
// - Las prendas RETIRADAS. Siguen en avatar_prendas, así que no cuentan
//   como colgando: retirar saca una prenda del editor, no del avatar de
//   quien ya la llevaba puesta. Eso es a propósito.

const fs = require("fs");
const path = require("path");

// Mismo cargador a mano que server.js, por no sumar dotenv.
function cargarEnv() {
  const archivo = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(archivo)) return;

  for (const linea of fs.readFileSync(archivo, "utf8").split("\n")) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith("#")) continue;

    const corte = limpia.indexOf("=");
    if (corte === -1) continue;

    const clave = limpia.slice(0, corte).trim();
    let valor = limpia.slice(corte + 1).trim();

    const comilla = valor.charAt(0);
    if (valor.length > 1 && (comilla === '"' || comilla === "'") &&
        valor.charAt(valor.length - 1) === comilla) {
      valor = valor.slice(1, -1);
    }

    if (!(clave in process.env)) process.env[clave] = valor;
  }
}
cargarEnv();

const { CAPAS, VACIO } = require("../api/_avatar-catalogo");

const CAPAS_VALIDAS = new Set(CAPAS);
const LIMPIAR = process.argv.includes("--limpiar");

// Devuelve el objeto de capas, o null si esta fila no es un avatar por
// capas (un PNG subido, un JSON roto, un nulo).
function capasDe(crudo) {
  let avatar = crudo;
  if (typeof avatar === "string") {
    try { avatar = JSON.parse(avatar); } catch (_) { return null; }
  }
  if (!avatar || typeof avatar !== "object" || Array.isArray(avatar)) return null;
  if (avatar.tipo === "png") return null;
  return avatar;
}

// Las capas de este avatar que apuntan a un valor que ya no existe.
function capasColgando(avatar, existentes) {
  const fuera = [];
  for (const [capa, valor] of Object.entries(avatar)) {
    if (!CAPAS_VALIDAS.has(capa)) continue;
    if (typeof valor !== "string" || !valor || valor === VACIO) continue;
    if (existentes.has(valor)) continue;
    fuera.push([capa, valor]);
  }
  return fuera;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL.");
    process.exit(1);
  }

  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });

  const existentes = new Set(
    (await pool.query("SELECT valor FROM avatar_prendas")).rows.map(f => f.valor)
  );
  console.log("catálogo: " + existentes.size + " valores\n");

  // valor -> { avatares: [...], casilleros: [...] }
  const colgando = new Map();

  function revisar(crudo, donde, referencia) {
    const avatar = capasDe(crudo);
    if (!avatar) return;

    for (const [capa, valor] of capasColgando(avatar, existentes)) {
      if (!colgando.has(valor)) colgando.set(valor, { avatares: [], casilleros: [] });
      colgando.get(valor)[donde].push(Object.assign({ capa }, referencia));
    }
  }

  const usuarios = await pool.query(
    "SELECT id, username, avatar FROM users WHERE avatar IS NOT NULL"
  );
  for (const f of usuarios.rows) {
    revisar(f.avatar, "avatares", { id: f.id, quien: f.username });
  }

  const galerias = await pool.query(
    "SELECT s.id, s.slot, s.avatar, u.username" +
    "  FROM saved_avatars s JOIN users u ON u.id = s.user_id"
  );
  for (const f of galerias.rows) {
    revisar(f.avatar, "casilleros", { id: f.id, quien: f.username, slot: f.slot });
  }

  console.log("=== valores que alguien lleva y ya no existen ===");
  if (!colgando.size) {
    console.log("  ninguno\n");
    await pool.end();
    return;
  }

  for (const [valor, d] of [...colgando].sort()) {
    const esModelo = valor.indexOf("_") === -1;
    console.log("  " + valor.padEnd(22) +
      "avatares: " + d.avatares.length +
      "   casilleros: " + d.casilleros.length +
      (esModelo ? "   (es un MODELO: no se limpia)" : ""));
    for (const r of d.avatares) {
      console.log("      avatar de " + r.quien + " (capa " + r.capa + ")");
    }
    for (const r of d.casilleros) {
      console.log("      galería de " + r.quien + ", casillero " + r.slot + " (capa " + r.capa + ")");
    }
  }

  if (!LIMPIAR) {
    console.log("\nSolo informe: no se escribió nada.");
    console.log("Para poner esas capas en vacío: node scripts/avatares-colgando.js --limpiar");
    await pool.end();
    return;
  }

  // ----------------------------------------------------------------
  // Limpiar
  // ----------------------------------------------------------------
  // Se reescribe el objeto entero en vez de usar jsonb_set capa por
  // capa: una fila puede tener más de una colgando y así se resuelven
  // todas de una, dentro de la misma transacción.
  console.log("\nLimpiando...");

  const cliente = await pool.connect();
  let filasUsuarios = 0, filasGalerias = 0, capasSaltadas = 0;

  try {
    await cliente.query("BEGIN");

    async function limpiarTabla(tabla, filas) {
      let tocadas = 0;

      for (const f of filas) {
        const avatar = capasDe(f.avatar);
        if (!avatar) continue;

        let cambiada = false;
        for (const [capa] of capasColgando(avatar, existentes)) {
          if (capa === "modelo") { capasSaltadas++; continue; }
          avatar[capa] = VACIO;
          cambiada = true;
        }

        if (!cambiada) continue;
        await cliente.query(
          "UPDATE " + tabla + " SET avatar = $1 WHERE id = $2",
          [JSON.stringify(avatar), f.id]
        );
        tocadas++;
      }

      return tocadas;
    }

    filasUsuarios = await limpiarTabla("users", usuarios.rows);
    filasGalerias = await limpiarTabla("saved_avatars", galerias.rows);

    await cliente.query("COMMIT");
  } catch (error) {
    await cliente.query("ROLLBACK");
    throw error;
  } finally {
    cliente.release();
  }

  console.log("  avatares corregidos   : " + filasUsuarios);
  console.log("  casilleros corregidos : " + filasGalerias);
  if (capasSaltadas) {
    console.log("  capas modelo saltadas : " + capasSaltadas + " (hay que revisarlas a mano)");
  }
  console.log("\nListo.");

  await pool.end();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

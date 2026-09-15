// ==============================
// IMPORTAR EL CATÁLOGO DE AVATARES A LA BASE — scripts/importar-catalogo.js
// ==============================
// Lee imagenes/ y mete cada prenda en avatar_archivos + avatar_prendas.
//
//   node scripts/importar-catalogo.js              -> simulacro, no escribe
//   node scripts/importar-catalogo.js --produccion -> escribe de verdad
//
// Es idempotente: se puede correr las veces que haga falta. Los archivos
// se deduplican por su huella SHA-256 y las prendas por su "valor", así
// que una segunda pasada no duplica nada ni pisa lo que ya esté.
//
// ------------------------------------------------------------------
// QUÉ ENTRA Y QUÉ NO
// ------------------------------------------------------------------
// Se aplican las MISMAS reglas de nombres que api/_avatar-catalogo.js,
// para que el catálogo de la base salga idéntico al que hoy valida el
// servidor. Pero además se rescatan piezas que esas reglas dejaban
// fuera, porque este es el momento de hacerlo:
//
//   - Las 8 bocas "tora/Boca N.png". Se comprobó que NO son duplicados
//     de "tora/bocaN.png": las 16 huellas son distintas. Son ocho bocas
//     de verdad que nadie pudo usar nunca porque el nombre llevaba
//     mayúscula y espacio. Como boca1..boca8 están ocupados, entran
//     renumeradas a partir del primer hueco libre.
//
//   - "cereza/boca5 (1).png" NO entra: su huella es idéntica byte a
//     byte a "cereza/boca5.png", del mismo modelo. Es una copia, no arte.
//
// OJO CON LA DEDUPLICACIÓN. Muchos modelos comparten el mismo archivo:
// tora/fondo1.png y cereza/fondo1.png son idénticos byte a byte, y lo
// mismo pasa con casi todos los fondos, bordes y mascotas. Pero son
// PRENDAS DISTINTAS: "tora_fondo1" y "cereza_fondo1" son dos valores
// que la gente tiene guardados por separado.
//
// Por eso se deduplica en dos niveles distintos:
//   - el ARCHIVO se comparte (una sola fila en avatar_archivos por
//     contenido, que es para lo que está la huella única);
//   - la PRENDA nunca (una fila por cada nombre de archivo válido).
//
// Fusionarlas borraría del catálogo prendas que hay puestas en avatares
// reales. Solo se descarta una copia cuando está DENTRO DEL MISMO
// MODELO y además tiene el nombre irregular, que es el caso de
// "boca5 (1).png".
//
// Todo lo rescatado entra con publicada = false, igual que las prendas
// que ya existían en el disco pero que el editor nunca ofreció. No se
// publican solas: hay que mirarlas una a una en el panel, porque alguna
// puede estar fuera de lugar (cereza_espalda3 mide 332x512 en vez de
// 327x504, y puede que se dejara fuera justamente por eso).
//
// ------------------------------------------------------------------
// LOS NOMBRES VISIBLES
// ------------------------------------------------------------------
// Se toman de perfil.html, que es lo que la gente ve hoy ("Botas 1").
// Así el editor de la fase 3 muestra exactamente lo mismo que ahora y
// el cambio es invisible para quien lo usa. Para lo que no está en
// perfil.html se deriva del propio nombre del archivo.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const RAIZ = path.join(__dirname, "..");
const RAIZ_IMAGENES = path.join(RAIZ, "imagenes");
const PRODUCCION = process.argv.includes("--produccion");

// Mismas constantes que api/_avatar-catalogo.js.
const CAPAS = [
  "fondo", "espalda", "modelo", "piel", "ojos", "boca",
  "botas", "pantalon", "remera", "guantes", "accesorio",
  "cara", "pelo", "mascota", "borde"
];
const CAPAS_VALIDAS = new Set(CAPAS);
const NO_MODELOS = new Set(["juegos"]);
const NOMBRE_LIMPIO = /^[a-z0-9]+$/;

// ------------------------------------------------------------------
// .env (igual que server.js: a mano, para no sumar una dependencia)
// ------------------------------------------------------------------
function cargarEnv() {
  try {
    const texto = fs.readFileSync(path.join(RAIZ, ".env"), "utf8");
    for (const linea of texto.split("\n")) {
      const limpia = linea.trim();
      if (!limpia || limpia.startsWith("#")) continue;
      const idx = limpia.indexOf("=");
      if (idx === -1) continue;
      const clave = limpia.slice(0, idx).trim();
      if (!(clave in process.env)) process.env[clave] = limpia.slice(idx + 1).trim();
    }
  } catch (_) { /* si no hay .env, se usa lo que venga del entorno */ }
}

// ------------------------------------------------------------------
// PNG: huella y medidas
// ------------------------------------------------------------------
const FIRMA_PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function leerPNG(ruta) {
  const datos = fs.readFileSync(ruta);
  if (datos.length < 24 || !datos.subarray(0, 8).equals(FIRMA_PNG)) return null;
  return {
    datos,
    sha256: crypto.createHash("sha256").update(datos).digest("hex"),
    // El IHDR es el primer bloque y siempre está en el mismo sitio.
    ancho: datos.readUInt32BE(16),
    alto: datos.readUInt32BE(20),
    peso: datos.length
  };
}

// ------------------------------------------------------------------
// Nombres visibles, sacados de perfil.html
// ------------------------------------------------------------------
function nombresDelEditor() {
  const mapa = new Map();
  let html;
  try {
    html = fs.readFileSync(path.join(RAIZ, "perfil.html"), "utf8");
  } catch (_) {
    return mapa;
  }
  // <div ... data-valor="tora_botas1" ...><img ...>Botas 1</div>
  const re = /data-valor="([^"]+)"[^>]*>(?:\s*<img[^>]*>)?\s*([^<]*)</g;
  for (const m of html.matchAll(re)) {
    const etiqueta = m[2].trim();
    if (etiqueta) mapa.set(m[1], etiqueta);
  }
  return mapa;
}

function nombreDerivado(capa, numero) {
  return capa.charAt(0).toUpperCase() + capa.slice(1) + (numero ? " " + numero : "");
}

// ------------------------------------------------------------------
// Recorrer el disco
// ------------------------------------------------------------------
function recolectar() {
  const etiquetas = nombresDelEditor();
  const enEditor = new Set(etiquetas.keys());
  const prendas = [];
  const descartes = [];

  const carpetas = fs.readdirSync(RAIZ_IMAGENES, { withFileTypes: true });

  for (const entrada of carpetas) {
    if (!entrada.isDirectory()) continue;
    const modelo = entrada.name;
    if (NO_MODELOS.has(modelo) || !NOMBRE_LIMPIO.test(modelo)) continue;

    const rutaModelo = path.join(RAIZ_IMAGENES, modelo + ".png");
    if (!fs.existsSync(rutaModelo)) continue;

    // El modelo en sí es una opción del editor (capa "modelo").
    const png = leerPNG(rutaModelo);
    if (png) {
      prendas.push({
        valor: modelo, modelo, capa: "modelo",
        nombre: etiquetas.get(modelo) || (modelo.charAt(0).toUpperCase() + modelo.slice(1)),
        png, publicada: true, origen: modelo + ".png"
      });
    }

    const archivos = fs.readdirSync(path.join(RAIZ_IMAGENES, modelo)).sort();

    // Huellas de los archivos bien nombrados de ESTE modelo. Sirve para
    // detectar que un archivo de nombre irregular es solo una copia de
    // uno que ya entró, y no arte que haya que rescatar.
    const huellasDelModelo = new Map();   // sha256 -> valor que ya la usa

    // Para renumerar lo rescatado hace falta saber qué números ya se usan.
    const ocupados = new Map();   // capa -> Set de números
    for (const archivo of archivos) {
      const ext = path.extname(archivo).toLowerCase();
      if (ext !== ".png" && ext !== ".jpg") continue;
      const base = path.basename(archivo, ext);
      if (!NOMBRE_LIMPIO.test(base)) continue;
      const capa = base.replace(/\d+$/, "");
      const num = parseInt(base.slice(capa.length), 10);
      if (!CAPAS_VALIDAS.has(capa)) continue;
      if (!ocupados.has(capa)) ocupados.set(capa, new Set());
      if (!Number.isNaN(num)) ocupados.get(capa).add(num);
    }

    function primerHueco(capa) {
      if (!ocupados.has(capa)) ocupados.set(capa, new Set());
      const usados = ocupados.get(capa);
      let n = 1;
      while (usados.has(n)) n++;
      usados.add(n);
      return n;
    }

    // ---- Pasada 1: los archivos bien nombrados ----
    // Cada uno es una prenda, siempre. Que su contenido coincida con el
    // de otro modelo es normal (los fondos y las mascotas se comparten)
    // y NO es motivo para descartarlo: el archivo se comparte, la
    // prenda no.
    for (const archivo of archivos) {
      const ext = path.extname(archivo).toLowerCase();
      if (ext !== ".png" && ext !== ".jpg") continue;

      const base = path.basename(archivo, ext);
      if (!NOMBRE_LIMPIO.test(base)) continue;

      const capa = base.replace(/\d+$/, "");
      if (!CAPAS_VALIDAS.has(capa)) {
        descartes.push({ archivo: modelo + "/" + archivo, motivo: 'capa desconocida "' + capa + '"' });
        continue;
      }

      const png = leerPNG(path.join(RAIZ_IMAGENES, modelo, archivo));
      if (!png) {
        descartes.push({ archivo: modelo + "/" + archivo, motivo: "no es un PNG válido" });
        continue;
      }

      const valor = modelo + "_" + base;
      // Lo que el disco tiene pero el editor nunca ofreció entra
      // apagado, para que no aparezca de golpe sin que nadie lo mire.
      const publicada = enEditor.has(valor);

      prendas.push({
        valor, modelo, capa,
        nombre: etiquetas.get(valor) || nombreDerivado(capa, base.slice(capa.length)),
        png, publicada, rescatada: !publicada,
        origen: modelo + "/" + archivo
      });

      if (!huellasDelModelo.has(png.sha256)) huellasDelModelo.set(png.sha256, valor);
    }

    // ---- Pasada 2: los de nombre irregular ----
    // "Boca 1.png", "boca5 (1).png". El frontend nunca pudo mostrarlos.
    // Se rescatan renumerados, salvo que sean una copia de un archivo
    // del mismo modelo que ya entró.
    for (const archivo of archivos) {
      const ext = path.extname(archivo).toLowerCase();
      if (ext !== ".png" && ext !== ".jpg") continue;

      const base = path.basename(archivo, ext);
      if (NOMBRE_LIMPIO.test(base)) continue;

      const capa = base.toLowerCase().replace(/[^a-z]/g, "");
      if (!CAPAS_VALIDAS.has(capa)) {
        descartes.push({ archivo: modelo + "/" + archivo, motivo: 'capa desconocida "' + capa + '"' });
        continue;
      }

      const png = leerPNG(path.join(RAIZ_IMAGENES, modelo, archivo));
      if (!png) {
        descartes.push({ archivo: modelo + "/" + archivo, motivo: "no es un PNG válido" });
        continue;
      }

      if (huellasDelModelo.has(png.sha256)) {
        descartes.push({
          archivo: modelo + "/" + archivo,
          motivo: "copia exacta de " + huellasDelModelo.get(png.sha256)
        });
        continue;
      }

      const n = primerHueco(capa);
      const valor = modelo + "_" + capa + n;

      prendas.push({
        valor, modelo, capa,
        nombre: nombreDerivado(capa, String(n)),
        png, publicada: false, rescatada: true,
        origen: modelo + "/" + archivo
      });
      huellasDelModelo.set(png.sha256, valor);
    }
  }

  return { prendas, descartes };
}

// ------------------------------------------------------------------
// Escribir
// ------------------------------------------------------------------
async function escribir(prendas) {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  const cliente = await pool.connect();

  let archivosNuevos = 0, prendasNuevas = 0, yaEstaban = 0;

  try {
    await cliente.query("BEGIN");

    for (const p of prendas) {
      // El archivo, deduplicado por contenido.
      let archivoId;
      const existe = await cliente.query(
        "SELECT id FROM avatar_archivos WHERE sha256 = $1", [p.png.sha256]
      );
      if (existe.rows.length) {
        archivoId = existe.rows[0].id;
      } else {
        const ins = await cliente.query(
          `INSERT INTO avatar_archivos (sha256, datos, ancho, alto, peso)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [p.png.sha256, p.png.datos, p.png.ancho, p.png.alto, p.png.peso]
        );
        archivoId = ins.rows[0].id;
        archivosNuevos++;
      }

      // La prenda. autor_id queda NULL: esto es arte anterior al panel.
      const res = await cliente.query(
        `INSERT INTO avatar_prendas (valor, modelo, capa, nombre, archivo_id, publicada)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (valor) DO NOTHING
         RETURNING id`,
        [p.valor, p.modelo, p.capa, p.nombre, archivoId, p.publicada]
      );
      if (res.rows.length) prendasNuevas++; else yaEstaban++;
    }

    await cliente.query(
      "UPDATE avatar_catalogo_version SET version = version + 1 WHERE id = 1"
    );
    await cliente.query("COMMIT");
  } catch (error) {
    await cliente.query("ROLLBACK");
    throw error;
  } finally {
    cliente.release();
    await pool.end();
  }

  return { archivosNuevos, prendasNuevas, yaEstaban };
}

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------
async function main() {
  cargarEnv();

  const { prendas, descartes } = recolectar();

  const publicadas = prendas.filter(p => p.publicada);
  const apagadas = prendas.filter(p => !p.publicada);
  const rescatadas = prendas.filter(p => p.rescatada);
  const pesoTotal = prendas.reduce((s, p) => s + p.png.peso, 0);
  const huellas = new Set(prendas.map(p => p.png.sha256));

  console.log("=== LO QUE SE VA A IMPORTAR ===");
  console.log("  prendas            : " + prendas.length);
  console.log("    publicadas       : " + publicadas.length);
  console.log("    apagadas         : " + apagadas.length + "  (hay que revisarlas en el panel)");
  console.log("  archivos distintos : " + huellas.size);
  console.log("  peso total         : " + (pesoTotal / 1048576).toFixed(2) + " MB");

  const porModelo = new Map();
  for (const p of prendas) porModelo.set(p.modelo, (porModelo.get(p.modelo) || 0) + 1);
  console.log("  por modelo         : " +
    [...porModelo].sort().map(([m, n]) => m + ":" + n).join("  "));

  if (rescatadas.length) {
    console.log("\n=== ARTE RESCATADO (entra apagado) ===");
    for (const p of rescatadas) {
      console.log("  " + p.valor.padEnd(22) + p.png.ancho + "x" + p.png.alto +
        "  <- " + p.origen);
    }
  }

  if (descartes.length) {
    console.log("\n=== DESCARTADO ===");
    for (const d of descartes) console.log("  " + d.archivo.padEnd(26) + d.motivo);
  }

  if (!PRODUCCION) {
    console.log("\nSIMULACRO: no se escribió nada.");
    console.log("Para hacerlo de verdad: node scripts/importar-catalogo.js --produccion");
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.error("\nFalta DATABASE_URL.");
    process.exit(1);
  }

  console.log("\nEscribiendo en la base...");
  const r = await escribir(prendas);
  console.log("  archivos nuevos : " + r.archivosNuevos);
  console.log("  prendas nuevas  : " + r.prendasNuevas);
  console.log("  ya estaban      : " + r.yaEstaban);
  console.log("\nListo.");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

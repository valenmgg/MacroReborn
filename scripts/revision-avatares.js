// ==============================
// MIRAR LOS AVATARES COMPUESTOS — scripts/revision-avatares.js
// ==============================
// El compositor del servidor (api/_compositor.js) todavia no esta
// enchufado a ninguna pagina, asi que no hay nada que clicar en el
// sitio para saber si funciona. Y "funciona" aqui no lo dice una
// prueba: lo dice el ojo. Un avatar puede pasar las 22 pruebas y salir
// con el pelo debajo de la cabeza.
//
// Esto compone avatares de verdad y arma una pagina donde cada uno
// aparece DOS VECES, lado a lado:
//
//   IZQUIERDA  lo que hace el navegador hoy: las capas apiladas con
//              una etiqueta <img> por prenda, que es exactamente lo
//              que la gente esta viendo ahora mismo.
//   DERECHA    lo que devuelve el servidor: una sola imagen.
//
// Si las dos columnas se ven iguales, el cambio no altera el producto.
// Si se ven distintas, ahi esta el fallo, y se ve sin leer una linea de
// codigo.
//
//   node scripts/revision-avatares.js              contra datos-locales/pgdata
//   node scripts/revision-avatares.js --produccion contra el VPS
//   node scripts/revision-avatares.js --cuantos 30
//   node scripts/revision-avatares.js --calidad 92   mas calidad, mas peso
//
// Escribe en revision-avatares/, que esta fuera de git: se mira y se
// borra. Mismo criterio que revision-lienzo.html.
//
// OJO: la copia de datos-locales se queda vieja rapido. Si algo no
// cuadra, correr antes  npm run db:traer.

const fs = require("fs");
const path = require("path");

const C = require("../api/_compositor");

const RAIZ = path.join(__dirname, "..");
const PGDATA = path.join(RAIZ, "datos-locales", "pgdata");
const SALIDA = path.join(RAIZ, "revision-avatares");

const PRODUCCION = process.argv.includes("--produccion");
const CUANTOS = (() => {
  const i = process.argv.indexOf("--cuantos");
  const n = i > -1 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 200) : 12;
})();

const CALIDAD = (() => {
  const i = process.argv.indexOf("--calidad");
  const n = i > -1 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(n) && n >= 1 && n <= 100 ? n : C.CALIDAD;
})();

// El orden de dibujo. Es el mismo de ORDEN_CAPAS_AVATAR en js/core.js y
// de CAPAS en api/content.js. Aqui se repite porque esto es una
// herramienta de revision y no produccion: si un dia las tres se
// unifican, esta se va con ellas.
const ORDEN = [
  "fondo", "espalda", "modelo", "piel", "ojos", "boca",
  "botas", "pantalon", "remera", "guantes", "accesorio",
  "cara", "pelo", "mascota", "borde"
];

const kb = n => (n / 1024).toFixed(1) + " kB";
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

function escapar(v) {
  return String(v === null || v === undefined ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function pagina(fichas, resumen) {
  const tarjetas = fichas.map(f => `
    <article class="ficha">
      <h2>${escapar(f.nombre)} <small>${f.capas.length} capas</small></h2>
      <div class="par">
        <figure>
          <div class="pila">
            ${f.capas.map(c => `<img src="capas/${escapar(c)}" alt="">`).join("\n            ")}
          </div>
          <figcaption>Hoy: ${f.capas.length} imagenes apiladas<br><b>${escapar(f.pesoHoy)}</b></figcaption>
        </figure>
        <figure>
          <div class="pila"><img src="${escapar(f.grande)}" alt=""></div>
          <figcaption>Servidor: una sola<br><b>${escapar(f.pesoGrande)}</b> en ${f.tardo} ms</figcaption>
        </figure>
        <figure class="mini">
          <div class="pila"><img src="${escapar(f.chico)}" alt=""></div>
          <figcaption>Miniatura 62x96<br><b>${escapar(f.pesoChico)}</b></figcaption>
        </figure>
      </div>
      ${f.transparente ? '<p class="aviso">Sin capa de fondo: el hueco va aplanado sobre BLANCO.</p>' : ""}
    </article>`).join("\n");

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>Revision de avatares compuestos</title>
<style>
 body{background:#0b1020;color:#e5e7eb;font:15px/1.5 system-ui,sans-serif;margin:0;padding:24px}
 h1{font-size:22px;margin:0 0 4px}
 .intro{color:#9ca3af;max-width:70ch;margin:0 0 20px}
 .intro b{color:#e5e7eb}
 .resumen{background:#111827;border:1px solid #1f2937;border-radius:8px;padding:12px 16px;margin:0 0 24px;display:inline-block}
 .resumen td{padding:2px 14px 2px 0}
 .ficha{background:#111827;border:1px solid #1f2937;border-radius:8px;padding:14px 16px;margin:0 0 18px}
 .ficha h2{font-size:15px;margin:0 0 10px;font-weight:600}
 .ficha h2 small{color:#9ca3af;font-weight:400}
 .par{display:flex;gap:22px;align-items:flex-start;flex-wrap:wrap}
 figure{margin:0}
 .pila{position:relative;width:163px;height:252px;background:#1f2937;border:1px solid #374151;border-radius:6px;overflow:hidden}
 .mini .pila{width:62px;height:96px}
 .pila img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;image-rendering:auto}
 figcaption{color:#9ca3af;font-size:12px;margin-top:6px;max-width:170px}
 figcaption b{color:#e5e7eb}
 .aviso{color:#fbbf24;font-size:12px;margin:10px 0 0}
</style></head><body>
<h1>Revision de avatares compuestos</h1>
<p class="intro">Cada avatar aparece dos veces. A la <b>izquierda</b>, las capas apiladas
como las apila hoy el navegador. A la <b>derecha</b>, la sola imagen que devolveria el
servidor. <b>Si las dos se ven iguales, el cambio no altera lo que ve la gente.</b>
Las diferencias de compresion se buscan mirando de cerca los bordes y los degradados.</p>
<table class="resumen">${resumen}</table>
${tarjetas}
</body></html>`;
}

async function main() {
  console.log("");
  console.log("REVISION DE AVATARES COMPUESTOS");
  console.log("===============================");
  console.log("Origen: " + (PRODUCCION ? "produccion" : "datos-locales/pgdata"));
  console.log("Calidad del JPG: " + CALIDAD);
  console.log("");

  const { sql, cerrar } = await abrirBase();

  try {
    const usuarios = await sql`
      SELECT username, avatar FROM users
      WHERE avatar IS NOT NULL AND avatar::text <> '{}'
      ORDER BY last_login DESC NULLS LAST
      LIMIT ${CUANTOS};`;

    if (!usuarios.length) {
      console.error("No hay avatares que mirar.");
      process.exit(1);
    }

    const prendas = await sql`
      SELECT p.valor, a.sha256, a.datos
      FROM avatar_prendas p JOIN avatar_archivos a ON a.id = p.archivo_id;`;
    const porValor = new Map(prendas.map(f => [f.valor, f]));

    fs.rmSync(SALIDA, { recursive: true, force: true });
    fs.mkdirSync(path.join(SALIDA, "capas"), { recursive: true });

    const fichas = [];
    let sumaHoy = 0, sumaGrande = 0, sumaChico = 0, sumaMs = 0, sinFondo = 0;
    const capasEscritas = new Set();

    for (const u of usuarios) {
      const avatar = typeof u.avatar === "string" ? JSON.parse(u.avatar) : u.avatar;
      const valores = ORDEN.map(c => avatar[c]).filter(v => v && v !== "ninguno");

      const archivos = valores.map(v => porValor.get(v)).filter(Boolean);
      if (!archivos.length) continue;

      // Las capas sueltas, para la columna de la izquierda. Se escriben
      // una sola vez aunque las lleven varias personas, que es
      // justamente por lo que hoy pesan menos de lo que parece.
      const nombres = [];
      for (const a of archivos) {
        const nombre = a.sha256.slice(0, 16) + ".png";
        if (!capasEscritas.has(nombre)) {
          fs.writeFileSync(path.join(SALIDA, "capas", nombre), a.datos);
          capasEscritas.add(nombre);
        }
        nombres.push(nombre);
      }

      const t = ms();
      const r = C.renderizar(archivos.map(a => a.datos), [[327, 504], [62, 96]], { calidad: CALIDAD });
      const tardo = ms() - t;

      const base = u.username.replace(/[^a-zA-Z0-9_-]/g, "_");
      const grande = base + "-327." + r.formato;
      const chico = base + "-62." + r.formato;
      fs.writeFileSync(path.join(SALIDA, grande), r.salidas["327x504"]);
      fs.writeFileSync(path.join(SALIDA, chico), r.salidas["62x96"]);

      const pesoHoy = archivos.reduce((s, a) => s + a.datos.length, 0);
      sumaHoy += pesoHoy;
      sumaGrande += r.salidas["327x504"].length;
      sumaChico += r.salidas["62x96"].length;
      sumaMs += tardo;
      if (r.transparente) sinFondo++;

      fichas.push({
        nombre: u.username,
        capas: nombres,
        grande, chico, tardo,
        transparente: r.transparente,
        pesoHoy: kb(pesoHoy),
        pesoGrande: kb(r.salidas["327x504"].length),
        pesoChico: kb(r.salidas["62x96"].length)
      });

      console.log("  " + u.username.padEnd(22).slice(0, 22) +
        String(archivos.length).padStart(3) + " capas  " +
        kb(pesoHoy).padStart(9) + " -> " + kb(r.salidas["327x504"].length).padStart(9) +
        "  mini " + kb(r.salidas["62x96"].length).padStart(8) + "  " + tardo + " ms");
    }

    // Lo que de verdad importa no es un avatar suelto sino la pagina
    // entera: hoy las capas se repiten entre personas y se bajan una
    // sola vez, y un compuesto es unico. Por eso se cuenta lo UNICO.
    const bytesUnicos = [...capasEscritas].reduce(
      (s, n) => s + fs.statSync(path.join(SALIDA, "capas", n)).size, 0);

    const resumen = [
      ["Avatares mirados", fichas.length],
      ["Sin capa de fondo (van sobre blanco)", sinFondo],
      ["Archivos de capa DISTINTOS que se bajan hoy", capasEscritas.size + "  (" + kb(bytesUnicos) + ")"],
      ["Los mismos avatares, compuestos a 327x504", kb(sumaGrande)],
      ["Los mismos avatares, en miniatura 62x96", kb(sumaChico)],
      ["Tiempo medio de componer uno", (sumaMs / fichas.length).toFixed(0) + " ms"],
      ["Calidad del JPG", CALIDAD]
    ].map(([k, v]) => `<tr><td>${escapar(k)}</td><td><b>${escapar(v)}</b></td></tr>`).join("");

    const html = path.join(SALIDA, "index.html");
    fs.writeFileSync(html, pagina(fichas, resumen));

    console.log("");
    console.log("  capas distintas que se bajan hoy: " + capasEscritas.size + " (" + kb(bytesUnicos) + ")");
    console.log("  esos " + fichas.length + " compuestos a 327x504: " + kb(sumaGrande));
    console.log("  esos " + fichas.length + " en miniatura 62x96:   " + kb(sumaChico));
    console.log("  media por avatar: " + (sumaMs / fichas.length).toFixed(0) + " ms");
    console.log("");
    console.log("ABRE ESTO EN EL NAVEGADOR:");
    console.log("  " + html);
    console.log("");
    console.log("Las dos columnas deben verse iguales. Si lo son, el cambio no");
    console.log("altera lo que ve la gente.");
    console.log("");
  } finally {
    await cerrar();
  }
}

main().catch(error => {
  console.error("\nFallo la revision:", error && error.stack || error);
  process.exit(2);
});

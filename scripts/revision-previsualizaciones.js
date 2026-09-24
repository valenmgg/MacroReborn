// ==============================
// MIRAR LAS PREVISUALIZACIONES — scripts/revision-previsualizaciones.js
// ==============================
// Las previsualizaciones son automaticas: un cuadro por prenda, alrededor
// de su propio dibujo (api/_recortes.js). Que la regla este bien no lo
// dice una prueba, lo dice el ojo: esto dibuja las 768 con el mismo
// codigo que las generara para el sitio (api/_previsualizacion.js) y las
// pone todas en una pagina, por capa y por modelo.
//
// Lo que hay que buscar al mirarla: una prenda diminuta, una cortada que
// no deberia, o una que no se entiende. Esas son las que mas adelante se
// corregiran una por una.
//
//   node scripts/revision-previsualizaciones.js              contra datos-locales/pgdata
//   node scripts/revision-previsualizaciones.js --produccion contra la base de DATABASE_URL
//   node scripts/revision-previsualizaciones.js --color      con el modelo a color
//
// Escribe revision-previsualizaciones/index.html, una sola pagina con las
// imagenes dentro, para poder abrirla o pasarla sin nada mas. Esta fuera
// de git porque lleva arte: se mira y se borra.
//
// OJO: abre la copia local de la base. No correrlo con el servidor local
// (npm run db:real) abierto: dos procesos sobre la misma copia pueden
// estropearla.

const fs = require("fs");
const path = require("path");

const C = require("../api/_compositor");
const R = require("../api/_recortes");
const P = require("../api/_previsualizacion");
const { CAPAS } = require("../api/_avatar-catalogo");

const RAIZ = path.join(__dirname, "..");
const PGDATA = path.join(RAIZ, "datos-locales", "pgdata");
const SALIDA = path.join(RAIZ, "revision-previsualizaciones");

const PRODUCCION = process.argv.includes("--produccion");
const COLOR = process.argv.includes("--color");

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

const binario = d => (Buffer.isBuffer(d) ? d : Buffer.from(d));

function seSale(caja, q) {
  return !!caja && (caja.x < q.x || caja.y < q.y ||
    caja.x + caja.ancho > q.x + q.lado || caja.y + caja.alto > q.y + q.lado);
}

async function main() {
  const inicio = Date.now();
  const { sql, cerrar } = await abrirBase();
  const config = R.leer();
  const maniqui = COLOR ? "color" : (config.maniqui || "plano");

  const filas = await sql`
    SELECT p.valor, p.nombre, p.capa, p.modelo, a.datos
    FROM avatar_prendas p JOIN avatar_archivos a ON a.id = p.archivo_id
    ORDER BY p.modelo, p.valor;`;
  await cerrar();

  const bases = new Map();
  for (const f of filas) if (f.capa === "modelo") bases.set(f.modelo, binario(f.datos));

  // capa -> modelo -> fichas
  const porCapa = new Map(CAPAS.map(c => [c, new Map()]));
  let bytes = 0, forzadas = 0, noCaben = 0, fallos = 0;

  for (const f of filas) {
    const prenda = binario(f.datos);
    let ficha;
    try {
      const caja = R.cajaParaCuadro(C.componer([prenda]));
      const cuadro = R.cuadroParaPrenda(config, { modelo: f.modelo, capa: f.capa, caja });
      const forzada = !!R.cuadroDe(config, f.modelo, f.capa);
      const jpg = P.renderizar({ base: bases.get(f.modelo), prenda, capa: f.capa, cuadro, maniqui });
      bytes += jpg.length;
      if (forzada) forzadas++;
      const noCabe = seSale(caja, cuadro);
      if (noCabe) noCaben++;
      ficha = { nombre: f.nombre || f.valor, valor: f.valor, jpg, forzada, noCabe };
    } catch (error) {
      fallos++;
      ficha = { nombre: f.nombre || f.valor, valor: f.valor, error: error.message };
    }
    const modelos = porCapa.get(f.capa) || porCapa.set(f.capa, new Map()).get(f.capa);
    if (!modelos.has(f.modelo)) modelos.set(f.modelo, []);
    modelos.get(f.modelo).push(ficha);
  }

  const bloques = [];
  for (const [capa, modelos] of porCapa) {
    if (!modelos.size) continue;
    const total = [...modelos.values()].reduce((s, l) => s + l.length, 0);
    const filasModelo = [...modelos.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([modelo, lista]) => `
      <div class="modelo"><h3>${escapar(modelo)} <small>${lista.length}</small></h3><div class="rejilla">${
        lista.map(p => p.error
          ? `<figure class="fallo" title="${escapar(p.nombre)}"><div class="caja">no se pudo dibujar</div><figcaption>${escapar(p.nombre)}</figcaption></figure>`
          : `<figure class="${p.forzada ? "forzada " : ""}${p.noCabe ? "nocabe" : ""}" title="${escapar(p.nombre)} (${escapar(p.valor)})"><img src="data:image/jpeg;base64,${p.jpg.toString("base64")}" width="96" height="96" alt=""><figcaption>${escapar(p.nombre)}</figcaption></figure>`
        ).join("")}</div></div>`).join("");
    bloques.push(`<section><h2>${escapar(capa)} <small>${total} prendas</small></h2>${filasModelo}</section>`);
  }

  const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Revision de previsualizaciones</title>
<style>
 body{background:#0b1020;color:#e5e7eb;font:14px/1.45 system-ui,sans-serif;margin:0;padding:20px 16px 40px}
 h1{font-size:21px;margin:0 0 4px}
 .intro{color:#9ca3af;max-width:78ch;margin:0 0 14px}
 .intro b{color:#e5e7eb}
 .leyenda span{display:inline-block;margin-right:16px}
 .leyenda i{display:inline-block;width:12px;height:12px;border-radius:2px;vertical-align:-1px;margin-right:5px}
 section{background:#111827;border:1px solid #1f2937;border-radius:8px;padding:12px 14px;margin:16px 0 0}
 h2{font-size:16px;margin:0 0 8px}
 h2 small,h3 small{color:#9ca3af;font-weight:400}
 h3{font-size:13px;margin:10px 0 6px;color:#cbd5e1}
 .rejilla{display:flex;flex-wrap:wrap;gap:6px}
 figure{margin:0;width:98px}
 figure img,.caja{display:block;width:96px;height:96px;border:1px solid #374151;border-radius:4px;background:#fff}
 .caja{color:#f87171;font-size:11px;display:flex;align-items:center;justify-content:center;text-align:center;background:#1f2937}
 figure.nocabe img{border-color:#fbbf24;box-shadow:0 0 0 1px #fbbf24}
 figure.forzada img{border-color:#60a5fa;box-shadow:0 0 0 1px #60a5fa}
 figcaption{color:#9ca3af;font-size:10.5px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
</style></head><body>
<h1>Revision de previsualizaciones</h1>
<p class="intro"><b>${filas.length}</b> prendas dibujadas en ${segundos} s, <b>${(bytes / 1024).toFixed(0)} kB</b> en total,
con el maniqui <b>${escapar(maniqui)}</b>. Cada una con su cuadro automatico${forzadas ? `, salvo ${forzadas} de capas forzadas con la herramienta` : ""}.
${noCaben} no caben enteras y se ven desde arriba.${fallos ? ` <b>${fallos} no se pudieron dibujar.</b>` : ""}</p>
<p class="intro leyenda"><span><i style="background:#fbbf24"></i>no cabe entera: se ve la parte de arriba</span><span><i style="background:#60a5fa"></i>cuadro forzado para su capa</span></p>
${bloques.join("\n")}
</body></html>
`;

  fs.mkdirSync(SALIDA, { recursive: true });
  const salida = path.join(SALIDA, "index.html");
  fs.writeFileSync(salida, html);
  console.log(`${filas.length} previsualizaciones en ${segundos} s, ${(bytes / 1024).toFixed(0)} kB` +
    ` · ${noCaben} no caben enteras · ${forzadas} forzadas · ${fallos} fallos`);
  console.log("Abrir: " + salida);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

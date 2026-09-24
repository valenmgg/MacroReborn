// ==============================
// LLEVAR EL CATALOGO AL LIENZO — scripts/encajar-lienzo.js
// ==============================
// Pone las prendas descuadradas en el lienzo de 327x504, con la misma
// politica que ya usa el vestidor (ver api/_lienzo.js).
//
//   node scripts/encajar-lienzo.js              informe, no toca nada
//   node scripts/encajar-lienzo.js --revision   + pagina para mirarlo
//   node scripts/encajar-lienzo.js --aplicar    escribe en la base
//   node scripts/encajar-lienzo.js --produccion --aplicar
//
// Por defecto trabaja contra la copia de produccion de
// datos-locales/pgdata y NO escribe.
//
// ---------------------------------------------------------------
// ESTO VA ANTES QUE EL HORNO, Y EN LA MISMA VENTANA
// ---------------------------------------------------------------
// Cambiar pixeles cambia el sha256, y el sha256 ES la URL. El horno de
// la autoria (scripts/hornear-catalogo.js) hace lo mismo. Si se corren
// en dias distintos, todo el mundo redescarga el catalogo DOS veces y
// hay que vaciar la cache de nginx dos veces.
//
// El orden correcto es:
//
//   1. node scripts/encajar-lienzo.js --produccion --aplicar
//   2. node scripts/hornear-catalogo.js --produccion --aplicar
//   3. sudo rm -rf /var/cache/nginx/prendas/*  &&  sudo systemctl reload nginx
//
// Asi los bytes cambian dos veces pero la gente solo lo paga una.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const lienzo = require("../api/_lienzo");

// La revision pide las prendas al servidor local, y desde la fase 5
// /prendas/ solo contesta con firma (ver api/_prendas-firma.js). Se
// firman con el mismo secreto por defecto que scripts/servidor-local.js.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "local-development-session-secret";
const firmas = require("../api/_prendas-firma");

// ./base-real y ./pglite NO se piden aqui arriba a proposito: los dos
// acaban cargando PGlite, que es una dependencia de DESARROLLO. En el
// VPS se instala con `npm install --omit=dev`, asi que no esta, y pedirla
// de entrada hace que el script se caiga antes de empezar aunque vaya a
// trabajar contra produccion, donde PGlite no pinta nada.
//
// Paso de verdad al desplegar: MODULE_NOT_FOUND en la primera linea.

const PGDATA = process.env.MR_PGDATA || path.join(__dirname, "..", "datos-locales", "pgdata");
const RAIZ = path.join(__dirname, "..");
const CARPETA_REVISION = path.join(RAIZ, "revision-lienzo");
const PAGINA_REVISION = path.join(RAIZ, "revision-lienzo.html");

const APLICAR = process.argv.includes("--aplicar");
const PRODUCCION = process.argv.includes("--produccion");
const REVISION = process.argv.includes("--revision");

const kb = n => (n / 1024).toFixed(1) + " kB";


async function abrirBase() {
  if (PRODUCCION) {
    if (!process.env.DATABASE_URL) {
      console.error("Falta DATABASE_URL para trabajar contra produccion.");
      process.exit(1);
    }
    const { obtenerSql } = require("../api/_db");
    return { sql: obtenerSql(), cerrar: async () => {} };
  }

  // Solo aqui, que es el unico camino que las usa.
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


// ------------------------------------------------------------------
// LA PAGINA DE REVISION
// ------------------------------------------------------------------
// Temporal, y a proposito: se escribe fuera de git (esta en .gitignore)
// para que no pueda desplegarse por accidente. Se abre en
// http://localhost:3001/revision-lienzo.html con `npm run db:real`
// levantado, porque el "antes" se pide en vivo a la base por su huella.
//
// Cada prenda se enseña SOBRE SU MODELO, que es lo unico que contesta la
// pregunta que importa: no "¿se ve bien el PNG?" sino "¿sigue cuadrando
// sobre el personaje?".
function armarPagina(fichas) {
  const tarjeta = f => {
    const variantes = f.variantes.map(v => `
        <figure class="v">
          <div class="marco">
            ${f.modeloUrl ? `<img class="base" src="${f.modeloUrl}" alt="">` : ""}
            <img class="capa" src="${v.src}" alt="">
          </div>
          <figcaption>${v.titulo}<span>${v.pie}</span></figcaption>
        </figure>`).join("");

    return `
    <article class="p${f.sospechosa ? " mala" : ""}" data-metodo="${f.metodo}">
      <header>
        ${f.sospechosa ? '<span class="chapa">REVISAR — la proporción no es la del lienzo</span>' : ""}
        <h3>${f.valores}</h3>
        <p><b>${f.metodo}</b> · ${f.desde} → 327×504 · ${f.capa} · ${f.pesoAntes} → ${f.pesoDespues}${f.aviso ? ` · <em>${f.aviso}</em>` : ""}</p>
      </header>
      <div class="fila">${variantes}</div>
    </article>`;
  };

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Revisión del lienzo (temporal)</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; padding:24px; background:#12151c; color:#e8ecf4;
         font:14px/1.5 system-ui, sans-serif; }
  h1 { font-size:20px; margin:0 0 4px; }
  .aviso { background:#2a2010; border-left:3px solid #d9a441; padding:10px 14px;
           border-radius:0 6px 6px 0; margin:16px 0 24px; max-width:900px; }
  .barra { position:sticky; top:0; background:#12151c; padding:12px 0;
           border-bottom:1px solid #2a3040; margin-bottom:20px; z-index:2; }
  .barra button { background:#1d2430; color:#e8ecf4; border:1px solid #384252;
                  padding:6px 12px; border-radius:6px; cursor:pointer; margin-right:6px; }
  .barra button.on { background:#2d4a6b; border-color:#4a7ab0; }
  .p { border:1px solid #242c3a; border-radius:10px; padding:14px;
       margin-bottom:18px; background:#171b24; }
  .p.mala { border-color:#a8452f; background:#1f1715; }
  .chapa { display:inline-block; background:#a8452f; color:#fff; font-size:11px;
           font-weight:700; letter-spacing:.3px; padding:3px 9px;
           border-radius:5px; margin-bottom:8px; }
  .p header h3 { margin:0; font-size:15px; color:#9ecbff; word-break:break-all; }
  .p header p { margin:2px 0 12px; color:#9aa6b8; font-size:12px; }
  .p header em { color:#d9a441; font-style:normal; }
  .fila { display:flex; gap:18px; flex-wrap:wrap; }
  .marco { position:relative; width:327px; height:504px;
           background:
             linear-gradient(45deg,#1b2029 25%,transparent 25%,transparent 75%,#1b2029 75%),
             linear-gradient(45deg,#1b2029 25%,#141820 25%,#141820 75%,#1b2029 75%);
           background-size:16px 16px; background-position:0 0,8px 8px;
           border:1px solid #2a3040; border-radius:6px; overflow:hidden; }
  .marco img { position:absolute; inset:0; width:100%; height:100%;
               object-fit:contain; image-rendering:auto; }
  .marco .base { opacity:.85; }
  figcaption { margin-top:6px; font-size:12px; color:#c6d0e0; }
  figcaption span { display:block; color:#7f8b9e; font-size:11px; }
  @media (max-width:760px){ .marco{ width:218px; height:336px; } }
</style></head>
<body>

<h1>Revisión del lienzo</h1>
<p style="color:#9aa6b8;margin:0">${fichas.length} prendas cambiadas · generado el ${new Date().toISOString().slice(0, 16).replace("T", " ")}</p>

<div class="aviso">
  <b>Página temporal.</b> No está en git y no se despliega. Bórrala cuando termines
  con <code>rm revision-lienzo.html; rm -r revision-lienzo</code>.<br>
  El «antes» se pide en vivo a la base, así que hace falta <code>npm run db:real</code> levantado.
  El cuadriculado es transparencia.
</div>

<div class="barra">
  <button data-f="todos" class="on">Todas</button>
  <button data-f="calco">Calco (exacto)</button>
  <button data-f="estirado">Estirado</button>
  <button data-f="encaje">Encaje</button>
</div>

${fichas.map(tarjeta).join("\n")}

<script>
  document.querySelectorAll(".barra button").forEach(b => {
    b.onclick = () => {
      document.querySelectorAll(".barra button").forEach(x => x.classList.remove("on"));
      b.classList.add("on");
      const f = b.dataset.f;
      document.querySelectorAll(".p").forEach(p => {
        p.style.display = (f === "todos" || p.dataset.metodo === f) ? "" : "none";
      });
    };
  });
</script>
</body></html>`;
}


async function main() {
  console.log("");
  console.log("LLEVAR EL CATALOGO AL LIENZO");
  console.log("============================");
  console.log("Base:   " + (PRODUCCION ? "PRODUCCION (DATABASE_URL)" : "copia local (" + PGDATA + ")"));
  console.log("Modo:   " + (APLICAR ? "APLICAR (escribe)" : "informe (no toca nada)"));
  console.log("");

  const { sql, cerrar } = await abrirBase();

  const archivos = await sql`
    SELECT a.id, a.sha256, a.datos, a.ancho, a.alto,
           (SELECT string_agg(p.valor, ', ' ORDER BY p.valor)
              FROM avatar_prendas p WHERE p.archivo_id = a.id) AS valores,
           (SELECT min(p.capa) FROM avatar_prendas p WHERE p.archivo_id = a.id) AS capa,
           (SELECT min(p.modelo) FROM avatar_prendas p WHERE p.archivo_id = a.id) AS modelo
    FROM avatar_archivos a
    ORDER BY a.id;
  `;

  // Para poder enseñar cada prenda sobre su personaje en la revisión.
  const modelos = new Map();
  for (const m of await sql`
    SELECT p.valor, a.sha256 FROM avatar_prendas p
    JOIN avatar_archivos a ON a.id = p.archivo_id
    WHERE p.capa = 'modelo';
  `) modelos.set(m.valor, firmas.firmar(m.sha256));

  const cambios = [];
  const rotos = [];
  const cuenta = new Map();
  let pesoAntes = 0, pesoDespues = 0;

  for (const fila of archivos) {
    const binario = Buffer.isBuffer(fila.datos) ? fila.datos : Buffer.from(fila.datos);

    let res;
    try {
      res = lienzo.llevarAlLienzo(binario);
    } catch (error) {
      rotos.push({ id: fila.id, valores: fila.valores, error: error.message });
      continue;
    }

    cuenta.set(res.metodo, (cuenta.get(res.metodo) || 0) + 1);
    if (res.metodo === "ya-estaba") continue;

    pesoAntes += binario.length;
    pesoDespues += res.binario.length;

    cambios.push({
      id: fila.id,
      shaViejo: fila.sha256,
      shaNuevo: crypto.createHash("sha256").update(res.binario).digest("hex"),
      binario: res.binario,
      original: binario,
      metodo: res.metodo,
      desde: res.desde,
      valores: fila.valores || ("archivo " + fila.id),
      capa: fila.capa || "?",
      modelo: fila.modelo || ""
    });
  }

  // ---------------------------------------------------------------
  console.log("-- QUE VA A PASAR --");
  for (const [metodo, n] of [...cuenta.entries()].sort((a, b) => b[1] - a[1])) {
    const explica = {
      "ya-estaba": "ya miden 327x504, no se tocan",
      "calco": "se rellena o se recorta una fila. EXACTO, cero interpolacion",
      "estirado": "se estira al lienzo. Remuestrea, pero no pierde nada ni deja franjas",
      "encaje": "se encaja con margenes, como el taller. Remuestrea"
    }[metodo] || "";
    console.log("  " + String(n).padStart(4) + "  " + metodo.padEnd(10) + explica);
  }
  console.log("");
  console.log("  Archivos que cambian:  " + cambios.length + " de " + archivos.length);
  console.log("  Peso de esos:          " + kb(pesoAntes) + "  ->  " + kb(pesoDespues));
  console.log("");

  if (rotos.length) {
    console.log("-- ILEGIBLES (no se tocan) --");
    rotos.forEach(r => console.log("  id " + r.id + "  " + (r.valores || "") + "  " + r.error));
    console.log("");
  }

  // ---------------------------------------------------------------
  if (REVISION) {
    fs.rmSync(CARPETA_REVISION, { recursive: true, force: true });
    fs.mkdirSync(CARPETA_REVISION, { recursive: true });

    const fichas = [];

    for (const c of cambios) {
      const variantes = [{
        src: firmas.firmar(c.shaViejo),
        titulo: "ANTES",
        pie: c.desde + " · " + kb(c.original.length)
      }];

      fs.writeFileSync(path.join(CARPETA_REVISION, c.id + ".png"), c.binario);
      variantes.push({
        src: "/revision-lienzo/" + c.id + ".png",
        titulo: "DESPUES (" + c.metodo + ")",
        pie: "327×504 · " + kb(c.binario.length)
      });

      let aviso = "";

      // Para los que se estiran se enseña TAMBIEN la alternativa de
      // recortar la fila: es exacta y conserva la paleta, pero pierde la
      // ultima fila de pixeles. En un fondo degradado eso no se ve y
      // ahorra mucho peso; en otra cosa puede que si se vea. Que lo
      // decida quien mira.
      if (c.metodo === "estirado") {
        try {
          const img = lienzo.leerPixeles(c.original);
          const cortado = lienzo.pegar1a1(img, lienzo.LIENZO_ANCHO, lienzo.LIENZO_ALTO);
          const bin = cortado.indices ? lienzo.escribirPaleta(cortado) : lienzo.escribirRGBA8(cortado);
          fs.writeFileSync(path.join(CARPETA_REVISION, c.id + "-recortado.png"), bin);
          variantes.push({
            src: "/revision-lienzo/" + c.id + "-recortado.png",
            titulo: "ALTERNATIVA (recortar la fila)",
            pie: "327×504 · " + kb(bin.length) + " · exacto, conserva paleta"
          });
          if (bin.length * 2 < c.binario.length) {
            aviso = "estirar pesa " + Math.round(c.binario.length / bin.length) + "x mas que recortar";
          }
        } catch (_) { /* si no se puede, se enseña solo el estirado */ }
      }

      // ¿La proporcion de origen es la del lienzo?
      //
      // Casi todo lo descuadrado del catalogo esta bien encuadrado y solo
      // viene a otra escala: un 1338x2066 es 0,6476 y el lienzo es
      // 0,6488, o sea un 0,2 % de diferencia. Eso baja al lienzo nitido y
      // no hay nada que decidir.
      //
      // Lo que SI hay que mirar con lupa es lo que trae otra proporcion
      // de verdad -un cuadrado, un apaisado-, porque ahi no existe
      // transformacion que quede bien: encajarlo lo deja con margenes y
      // estirarlo lo aplasta. Esas se marcan para que salten a la vista y
      // se puedan apartar.
      const [anchoOrigen, altoOrigen] = String(c.desde).split("x").map(Number);
      const proporcion = anchoOrigen / altoOrigen;
      const proporcionLienzo = lienzo.LIENZO_ANCHO / lienzo.LIENZO_ALTO;
      const sospechosa = Math.abs(proporcion - proporcionLienzo) / proporcionLienzo > 0.01;

      fichas.push({
        sospechosa,
        valores: c.valores,
        metodo: c.metodo,
        desde: c.desde,
        capa: c.capa,
        modeloUrl: modelos.get(c.modelo) || "",
        pesoAntes: kb(c.original.length),
        pesoDespues: kb(c.binario.length),
        aviso,
        variantes
      });
    }

    // Las marcadas primero: son las unicas que piden una decision, y son
    // cuatro entre ciento veinticinco. Enterradas en medio de la lista no
    // las ve nadie.
    fichas.sort((a, b) => (b.sospechosa ? 1 : 0) - (a.sospechosa ? 1 : 0));

    fs.writeFileSync(PAGINA_REVISION, armarPagina(fichas));

    console.log("-- REVISION --");
    console.log("  " + cambios.length + " prendas escritas en revision-lienzo/");
    console.log("");
    console.log("  Levanta el sitio:   npm run db:real");
    console.log("  Y abre:             http://localhost:3001/revision-lienzo.html");
    console.log("");
    console.log("  (Temporal y fuera de git. Para borrarlo:");
    console.log("   rm revision-lienzo.html ; rm -r revision-lienzo)");
    console.log("");
  }

  // ---------------------------------------------------------------
  if (!APLICAR) {
    console.log("No se escribio nada en la base. Para aplicarlo:  --aplicar");
    if (!REVISION) console.log("Para mirarlo antes:                     --revision");
    console.log("");
    await cerrar();
    return;
  }

  if (!cambios.length) {
    console.log("No hay nada que encajar.");
    console.log("");
    await cerrar();
    return;
  }

  console.log("-- APLICANDO --");

  let hechos = 0;
  for (const c of cambios) {
    await sql`
      UPDATE avatar_archivos
      SET datos = ${c.binario}, sha256 = ${c.shaNuevo},
          ancho = ${lienzo.LIENZO_ANCHO}, alto = ${lienzo.LIENZO_ALTO},
          peso = ${c.binario.length}
      WHERE id = ${c.id};
    `;
    hechos++;
    if (hechos % 20 === 0) console.log("  " + hechos + " / " + cambios.length);
  }

  await sql`UPDATE avatar_catalogo_version SET version = version + 1 WHERE id = 1;`;

  console.log("  " + hechos + " archivos llevados al lienzo.");
  console.log("  Version del catalogo subida.");
  console.log("");
  console.log("AHORA, sin esperar a otro dia:");
  console.log("  node scripts/hornear-catalogo.js" + (PRODUCCION ? " --produccion" : "") + " --aplicar");
  console.log("  sudo rm -rf /var/cache/nginx/prendas/*  &&  sudo systemctl reload nginx");
  console.log("");

  await cerrar();
}

main().catch(error => {
  console.error("");
  console.error("Se paro:", error.message);
  console.error("");
  process.exit(1);
});

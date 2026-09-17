// ==============================
// EL HORNO DEL CATALOGO — scripts/hornear-catalogo.js
// ==============================
// Mete la autoria de MacroReborn dentro de cada dibujo del catalogo, en
// los metadatos del propio PNG.
//
// QUE COMPRA ESTO, sin vender humo: no impide copiar nada, y nada lo
// impide. Lo que hace es que la copia lleve dentro de quien es.
// Sobrevive a un copiar-pegar, a subirlo a otra web y a la mayoria de
// las tuberias de imagenes. NO sobrevive a un reguardado deliberado en
// un editor, y ahi esta la gracia: quien la borro demostro que sabia lo
// que hacia, y eso es justo lo que hace falta para reclamar una
// retirada.
//
// ---------------------------------------------------------------
// LO QUE ESTO CUESTA, Y POR QUE VA EN UNA SOLA PASADA
// ---------------------------------------------------------------
// Meter la autoria cambia los bytes del fichero, y por tanto su sha256.
// Y el sha256 ES la URL: /prendas/<huella>.png. O sea que hornear el
// catalogo obliga a todo el mundo a redescargarlo una vez, y deja sin
// efecto la cache de nginx (365 dias) y la del navegador.
//
// Por eso se hace TODO de una vez y no en dos veces: cada pasada que
// cambie los bytes se paga con una redescarga entera del catalogo.
//
// ---------------------------------------------------------------
// COMO SE USA
// ---------------------------------------------------------------
//   node scripts/hornear-catalogo.js                  informe, no toca nada
//   node scripts/hornear-catalogo.js --aplicar        escribe en la copia local
//   node scripts/hornear-catalogo.js --produccion     informe contra el VPS
//   node scripts/hornear-catalogo.js --produccion --aplicar
//
// Por defecto trabaja contra la COPIA de produccion que hay en
// datos-locales/pgdata (la que trae `npm run db:traer`), y por defecto
// NO escribe. Hay que pedir las dos cosas a proposito.

const path = require("path");
const crypto = require("crypto");

const png = require("../api/_png");
// ./base-real y ./pglite NO se piden aqui arriba a proposito: los dos
// acaban cargando PGlite, que es una dependencia de DESARROLLO. En el
// VPS se instala con `npm install --omit=dev`, asi que no esta, y pedirla
// de entrada hace que el script se caiga antes de empezar aunque vaya a
// trabajar contra produccion, donde PGlite no pinta nada.
//
// Paso de verdad al desplegar: MODULE_NOT_FOUND en la primera linea.

// MR_PGDATA existe para poder probar la escritura contra una copia
// desechable sin tocar la copia de produccion de datos-locales.
const PGDATA = process.env.MR_PGDATA || path.join(__dirname, "..", "datos-locales", "pgdata");

const APLICAR = process.argv.includes("--aplicar");
const PRODUCCION = process.argv.includes("--produccion");

// El lienzo canonico. Es el de macrojuegos menos un pixel de alto: su
// editor servia un <img> de 327x505 y el arte de aqui se hizo para ese
// marco. Lo que no encaje se informa, no se toca: recortar o estirar el
// dibujo de otra persona es una decision de arte, no de codigo.
const ANCHO = 327;
const ALTO = 504;

// La autoria va a nombre del proyecto y no de personas: es lo que menos
// hay que mantener cuando entra o sale gente del equipo de dibujo.
const AUTORIA = {
  Author: "MacroReborn",
  Copyright: "(c) MacroReborn. Todos los derechos reservados.",
  Source: "https://www.macroreborn.com/",
  Disclaimer: "Prohibido su uso fuera de macroreborn.com sin autorizacion escrita."
};


function kb(n) {
  return (n / 1024).toFixed(1) + " kB";
}

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


async function main() {
  console.log("");
  console.log("EL HORNO DEL CATALOGO");
  console.log("=====================");
  console.log("Base:   " + (PRODUCCION ? "PRODUCCION (DATABASE_URL)" : "copia local (" + PGDATA + ")"));
  console.log("Modo:   " + (APLICAR ? "APLICAR (escribe)" : "informe (no toca nada)"));
  console.log("");

  const { sql, cerrar } = await abrirBase();

  const archivos = await sql`
    SELECT a.id, a.sha256, a.datos, a.ancho, a.alto,
           (SELECT count(*) FROM avatar_prendas p WHERE p.archivo_id = a.id) AS prendas
    FROM avatar_archivos a
    ORDER BY a.id;
  `;

  console.log("Archivos en avatar_archivos: " + archivos.length);
  console.log("");

  const yaFirmados = [];
  const aHornear = [];
  const fueraDeLienzo = [];
  const rotos = [];
  const choques = [];

  let pesoAntes = 0;
  let pesoDespues = 0;

  // Para detectar si dos archivos distintos acabarian con la misma
  // huella. No deberia pasar nunca, pero la columna sha256 es unica y un
  // choque abortaria la escritura a mitad.
  const huellasNuevas = new Map();

  for (const fila of archivos) {
    const binario = Buffer.isBuffer(fila.datos) ? fila.datos : Buffer.from(fila.datos);

    let cabecera;
    try {
      cabecera = png.leerCabecera(binario);
    } catch (error) {
      rotos.push({ id: fila.id, sha: fila.sha256, error: error.message });
      continue;
    }

    // El mismo criterio que la puerta de entrada de arte.html: medidas y
    // entrelazado. La PROFUNDIDAD no entra, y es a proposito.
    //
    // Ocho archivos del catalogo son paletas de 2 y 4 bits. Miden
    // 327x504 y se ven igual que cualquier otro -la profundidad de una
    // paleta no cambia el dibujo, solo cuantos colores caben-, y encima
    // pesan menos que en 8 bits. Avisar de ellos era mandar a alguien a
    // arreglar algo que no esta roto.
    if (cabecera.ancho !== ANCHO || cabecera.alto !== ALTO ||
        cabecera.entrelazado !== 0) {
      fueraDeLienzo.push({
        id: fila.id,
        sha: fila.sha256,
        medidas: cabecera.ancho + "x" + cabecera.alto,
        profundidad: cabecera.profundidad,
        tipoColor: cabecera.tipoColor,
        entrelazado: cabecera.entrelazado,
        prendas: Number(fila.prendas)
      });
    }

    let horneado;
    try {
      horneado = png.ponerAutoria(binario, AUTORIA);
    } catch (error) {
      rotos.push({ id: fila.id, sha: fila.sha256, error: error.message });
      continue;
    }

    const shaNuevo = crypto.createHash("sha256").update(horneado).digest("hex");

    pesoAntes += binario.length;
    pesoDespues += horneado.length;

    // Ya horneado: los bytes no cambian, asi que no hay nada que hacer.
    // Es lo que permite volver a correr esto sin coste.
    if (shaNuevo === fila.sha256) {
      yaFirmados.push(fila.id);
      continue;
    }

    if (huellasNuevas.has(shaNuevo)) {
      choques.push({ id: fila.id, contra: huellasNuevas.get(shaNuevo), sha: shaNuevo });
      continue;
    }
    huellasNuevas.set(shaNuevo, fila.id);

    aHornear.push({
      id: fila.id,
      shaViejo: fila.sha256,
      shaNuevo,
      binario: horneado,
      crece: horneado.length - binario.length,
      prendas: Number(fila.prendas)
    });
  }

  // ---------------------------------------------------------------
  // EL INFORME
  // ---------------------------------------------------------------
  console.log("-- QUE VA A PASAR --");
  console.log("  Ya llevan la autoria:  " + yaFirmados.length);
  console.log("  Se van a hornear:      " + aHornear.length);
  console.log("  Ilegibles:             " + rotos.length);
  console.log("  Choques de huella:     " + choques.length);
  console.log("");

  if (aHornear.length) {
    const prendasTocadas = aHornear.reduce((n, a) => n + a.prendas, 0);
    const crece = aHornear.reduce((n, a) => n + a.crece, 0);
    console.log("  Prendas que cambian de URL:  " + prendasTocadas);
    console.log("  Peso del catalogo:           " + kb(pesoAntes) + "  ->  " + kb(pesoDespues));
    console.log("  Coste de la autoria:         " + Math.round(crece / aHornear.length) + " bytes por archivo");
    console.log("");
    console.log("  OJO: cambiar la huella cambia la URL. Al aplicar esto,");
    console.log("  la cache de nginx (365 dias) y la de los navegadores");
    console.log("  quedan sin efecto para el catalogo entero, y todo el");
    console.log("  mundo lo vuelve a descargar una vez. " + kb(pesoDespues) + ".");
    console.log("");
  }

  if (rotos.length) {
    console.log("-- ILEGIBLES (no se tocan) --");
    rotos.forEach(r => console.log("  id " + r.id + "  " + r.sha.slice(0, 12) + "  " + r.error));
    console.log("");
  }

  if (choques.length) {
    console.log("-- CHOQUES DE HUELLA (no se tocan) --");
    choques.forEach(c => console.log("  id " + c.id + " chocaria con id " + c.contra));
    console.log("");
  }

  if (fueraDeLienzo.length) {
    console.log("-- FUERA DEL LIENZO CANONICO (" + ANCHO + "x" + ALTO + ", sin entrelazar) --");
    console.log("");
    console.log("  Estos NO se corrigen aqui: este script solo escribe la");
    console.log("  autoria y no toca un pixel. Para llevarlos al lienzo:");
    console.log("");
    console.log("    node scripts/encajar-lienzo.js --revision   para mirarlo");
    console.log("    node scripts/encajar-lienzo.js --aplicar    para hacerlo");
    console.log("");
    console.log("  Y hay que hacerlo ANTES que este script y en la misma");
    console.log("  ventana: los dos cambian el sha256, que es la URL, y en");
    console.log("  dias distintos la gente redescarga el catalogo dos veces.");
    console.log("");

    const grupos = new Map();
    for (const f of fueraDeLienzo) {
      const clave = f.medidas + "  prof=" + f.profundidad +
                    "  color=" + f.tipoColor + "  entrelazado=" + f.entrelazado;
      if (!grupos.has(clave)) grupos.set(clave, { archivos: 0, prendas: 0 });
      const g = grupos.get(clave);
      g.archivos++;
      g.prendas += f.prendas;
    }

    [...grupos.entries()]
      .sort((a, b) => b[1].archivos - a[1].archivos)
      .forEach(([clave, g]) => {
        console.log("  " + String(g.archivos).padStart(4) + " archivos  (" +
                    g.prendas + " prendas)   " + clave);
      });
    console.log("");
    console.log("  Total fuera de lienzo: " + fueraDeLienzo.length + " archivos de " + archivos.length);
    console.log("");
  }

  // ---------------------------------------------------------------
  // ESCRIBIR, SI SE PIDIO
  // ---------------------------------------------------------------
  if (!APLICAR) {
    console.log("No se escribio nada. Para aplicarlo:  --aplicar");
    console.log("");
    await cerrar();
    return;
  }

  if (!aHornear.length) {
    console.log("No hay nada que hornear.");
    console.log("");
    await cerrar();
    return;
  }

  console.log("-- APLICANDO --");

  let hechos = 0;
  for (const a of aHornear) {
    await sql`
      UPDATE avatar_archivos
      SET datos = ${a.binario}, sha256 = ${a.shaNuevo}, peso = ${a.binario.length}
      WHERE id = ${a.id};
    `;
    hechos++;
    if (hechos % 50 === 0) console.log("  " + hechos + " / " + aHornear.length);
  }

  // Subir la version es obligatorio: es lo que hace que los dos procesos
  // del cluster tiren su catalogo en memoria y empiecen a servir las URL
  // nuevas. Sin esto, uno de los dos seguiria dando las huellas viejas y
  // las imagenes darian 404 segun quien contestara.
  await sql`UPDATE avatar_catalogo_version SET version = version + 1 WHERE id = 1;`;

  console.log("  " + hechos + " archivos horneados.");
  console.log("  Version del catalogo subida.");
  console.log("");
  console.log("Ahora hay que vaciar la cache de prendas de nginx, que si no");
  console.log("seguira sirviendo las huellas viejas durante 365 dias:");
  console.log("");
  console.log("  sudo rm -rf /var/cache/nginx/prendas/*  &&  sudo systemctl reload nginx");
  console.log("");

  await cerrar();
}

main().catch(error => {
  console.error("");
  console.error("El horno se paro:", error.message);
  console.error("");
  process.exit(1);
});

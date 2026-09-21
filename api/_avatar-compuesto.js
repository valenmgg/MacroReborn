// ==============================
// GUARDAR Y SERVIR EL AVATAR COMPUESTO — api/_avatar-compuesto.js
// ==============================
// api/_compositor.js apila las capas y devuelve bytes. Esto decide
// cuándo hacerlo, con qué nombre guardarlo y dónde. Fase 2 de
// docs/AVATARES-SERVIDOR.md.
//
// ---------------------------------------------------------------
// LA HUELLA ES LA RECETA, NO EL AVATAR
// ---------------------------------------------------------------
// El nombre del archivo es el sha256 de la lista ordenada de
// "capa:huella del archivo de esa prenda". No del JSON del avatar.
//
// La diferencia importa el día que el equipo de arte rehornee una
// prenda: el JSON del avatar no cambia (sigue diciendo "tora_pelo3")
// pero el dibujo sí, y con el JSON por nombre el navegador seguiría
// mostrando un año el compuesto viejo. Con la receta, cambia la huella
// del archivo, cambia la receta, cambia la URL. Ni antes ni después.
//
// Y sale gratis una cosa que nadie tuvo que programar: dos personas con
// el mismo avatar comparten archivo.
//
// VERSION va dentro de la huella a propósito. Si algún día cambia la
// calidad del JPG, el color de relleno o el orden de mezcla, la misma
// receta daría bytes distintos con el mismo nombre, y las cachés de un
// año servirían lo viejo. Subir VERSION invalida todo de una vez.
//
// ---------------------------------------------------------------
// EN DISCO, NO EN POSTGRES
// ---------------------------------------------------------------
// La base mide 127 MB contra 128 de shared_buffers: hoy lee el 100 %
// de memoria y el día que se pase, eso se cae de golpe. Y hay una razón
// mejor que el tamaño: el arte es la FUENTE y vive en la base, que se
// respalda cada noche; un compuesto es DERIVADO y se rehace en 150 ms.
// Lo derivado no necesita respaldo.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const compositor = require("./_compositor");
const { CAPAS, VACIO } = require("./_avatar-catalogo");

// Sube esto cuando cambie algo que altere los bytes de salida.
const VERSION = 1;

// Los tamaños que se generan y se sirven. 62x96 es el de las listas,
// donde el avatar se pinta a 35-46 px; 327x504 es el del perfil.
const TAMANOS = [[327, 504], [62, 96]];
const TAMANOS_VALIDOS = new Set(TAMANOS.map(([a, l]) => a + "x" + l));

// Todo sale en JPG, incluido lo que no lleva fondo, que se aplana sobre
// blanco. Decidido el 21/09/2026: un solo formato, sin una rama aparte
// que mantener por el 5 % de los casos.
const EXTENSION = "jpg";

// Fuera del repositorio a propósito, para que un despliegue no los
// toque. datos-locales/ ya está en .gitignore, y git no borra lo
// ignorado ni con reset --hard.
const DIRECTORIO = process.env.MR_AVATARES_DIR ||
  path.join(__dirname, "..", "datos-locales", "avatares-compuestos");

const ES_HUELLA = /^[a-f0-9]{64}$/;

// ------------------------------------------------------------------
// LA RECETA
// ------------------------------------------------------------------

// Saca las capas con prenda de un avatar, en orden de dibujo. El orden
// sale de api/_avatar-catalogo.js, que es el único sitio del servidor
// donde vive; no se copia aquí.
function capasCon(avatar) {
  if (!avatar || typeof avatar !== "object") return [];
  return CAPAS
    .map(capa => ({ capa, valor: avatar[capa] }))
    .filter(x => x.valor && x.valor !== VACIO && typeof x.valor === "string");
}

// Busca el archivo de cada prenda y arma la receta. Devuelve null
// cuando no hay nada que componer: quien no eligió ninguna prenda no
// tiene compuesto, y eso no es un error.
async function recetaDe(sql, avatar) {
  const capas = capasCon(avatar);
  if (!capas.length) return null;

  const valores = capas.map(c => c.valor);
  const filas = await sql`
    SELECT p.valor, a.sha256, a.datos
    FROM avatar_prendas p
    JOIN avatar_archivos a ON a.id = p.archivo_id
    WHERE p.valor = ANY(${valores});
  `;
  const porValor = new Map(filas.map(f => [f.valor, f]));

  const encontradas = capas
    .map(c => ({ capa: c.capa, valor: c.valor, archivo: porValor.get(c.valor) }))
    .filter(c => c.archivo);

  if (!encontradas.length) return null;

  // Una prenda que no está en el catálogo se salta en vez de reventar.
  // Pasa con un avatar viejo que lleva algo retirado, y dejar a esa
  // persona sin imagen sería peor que dibujarla sin esa capa, que es
  // exactamente lo que hace hoy el navegador.

  const texto = "v" + VERSION + "\n" +
    encontradas.map(c => c.capa + ":" + c.archivo.sha256).join("\n");
  const huella = crypto.createHash("sha256").update(texto).digest("hex");

  return {
    huella,
    capas: encontradas.map(c => ({ capa: c.capa, valor: c.valor, sha256: c.archivo.sha256 })),
    // bytea llega como Buffer con el driver de Postgres y como
    // Uint8Array con PGlite. El compositor ya normaliza, pero se deja
    // dicho aquí porque es donde se mira primero.
    archivos: encontradas.map(c => c.archivo.datos)
  };
}

// ------------------------------------------------------------------
// EL DISCO
// ------------------------------------------------------------------

function carpetaDe(huella) {
  // Dos niveles por los dos primeros caracteres. Con una sola carpeta,
  // decenas de miles de archivos en un mismo directorio hacen lento
  // cualquier listado, y este directorio va a crecer con cada cuenta.
  return path.join(DIRECTORIO, huella.slice(0, 2), huella);
}

function rutaDe(huella, ancho, alto) {
  return path.join(carpetaDe(huella), ancho + "x" + alto + "." + EXTENSION);
}

function estanTodos(huella) {
  return TAMANOS.every(([a, l]) => fs.existsSync(rutaDe(huella, a, l)));
}

// Escribe por un nombre temporal y renombra. Sin esto, dos peticiones a
// la vez o un corte de luz dejan un archivo a medias que se servirá
// durante un año, porque la URL es immutable y nadie la va a volver a
// pedir.
function escribirEntero(destino, datos) {
  const temporal = destino + "." + process.pid + "." + Date.now() + ".tmp";
  fs.writeFileSync(temporal, datos);
  fs.renameSync(temporal, destino);
}

function leer(huella, ancho, alto) {
  if (!ES_HUELLA.test(String(huella || ""))) return null;
  if (!TAMANOS_VALIDOS.has(ancho + "x" + alto)) return null;
  try {
    return fs.readFileSync(rutaDe(huella, ancho, alto));
  } catch (_) {
    return null;
  }
}

// ------------------------------------------------------------------
// LO QUE SE USA DESDE FUERA
// ------------------------------------------------------------------

// Devuelve la huella del compuesto de este avatar, generándolo si no
// estaba. null si no hay nada que componer.
//
// Es idempotente y barato de repetir: si los archivos ya existen no
// compone nada. Por eso el relleno se puede volver a correr sin miedo.
async function asegurar(sql, avatar) {
  const receta = await recetaDe(sql, avatar);
  if (!receta) return null;

  if (estanTodos(receta.huella)) return receta.huella;

  const carpeta = carpetaDe(receta.huella);
  fs.mkdirSync(carpeta, { recursive: true });

  const salida = compositor.renderizar(receta.archivos, TAMANOS, { formato: EXTENSION });
  for (const [a, l] of TAMANOS) {
    escribirEntero(rutaDe(receta.huella, a, l), salida.salidas[a + "x" + l]);
  }

  return receta.huella;
}

// La misma llamada, pero que no pueda tumbar lo que la llamó. Guardar
// un avatar tiene que funcionar aunque el disco esté lleno: la persona
// se queda sin compuesto hasta el siguiente guardado, no sin avatar.
async function asegurarSinFallar(sql, avatar) {
  try {
    return await asegurar(sql, avatar);
  } catch (error) {
    console.error("avatar compuesto: no se pudo generar.", error.message);
    return null;
  }
}

// La URL pública. Un año de caché y immutable, porque el nombre ES el
// contenido: mismo criterio que /prendas/<huella>.png.
function urlDe(huella, ancho, alto) {
  if (!huella) return null;
  const a = ancho || 62, l = alto || 96;
  return "/avatares/" + huella + "/" + a + "x" + l + "." + EXTENSION;
}

// ¿Esta ruta es la de un compuesto? Devuelve sus piezas o null. Vive
// aquí y no en server.js porque el servidor de desarrollo es OTRO
// servidor: cuando el cierre de las prendas vivió dentro de server.js,
// en local no se aplicaba y probar decía lo contrario de la verdad.
// Misma lección que api/_prendas-ruta.js.
const RUTA = new RegExp("^/avatares/([a-f0-9]{64})/(\\d{1,4})x(\\d{1,4})\\." + EXTENSION + "$");

function partirRuta(pathname) {
  const m = RUTA.exec(String(pathname || ""));
  if (!m) return null;
  const ancho = Number(m[2]), alto = Number(m[3]);
  if (!TAMANOS_VALIDOS.has(ancho + "x" + alto)) return null;
  return { huella: m[1], ancho, alto };
}

module.exports = {
  VERSION,
  TAMANOS,
  TAMANOS_VALIDOS,
  EXTENSION,
  DIRECTORIO,
  capasCon,
  recetaDe,
  carpetaDe,
  rutaDe,
  estanTodos,
  leer,
  asegurar,
  asegurarSinFallar,
  urlDe,
  partirRuta
};

// ==============================
// LA RUTA DE UNA PRENDA — api/_prendas-ruta.js
// ==============================
// Esto vivia dentro de server.js, y por eso el servidor de desarrollo
// (scripts/servidor-local.js, el que levanta `npm run db:real`) no lo
// tenia: es OTRO servidor, con su propio manejo de estaticos.
//
// El resultado fue que en local /imagenes/tora/pelo3.png seguia
// devolviendo el dibujo mientras en produccion ya daba 404. O sea que
// probar el cierre en local decia que no funcionaba cuando si
// funcionaba, que es la peor forma de equivocarse: te hace deshacer un
// arreglo que estaba bien.
//
// Ahora los dos servidores piden lo mismo a este modulo. Copiar el
// guard en el segundo habria arreglado el sintoma y dejado la causa: es
// la misma trampa que ya se piso con ORDEN_CAPAS_AVATAR copiado en once
// archivos, donde dos llevaban el orden cambiado y el mismo avatar se
// dibujaba distinto segun la pagina.

const { obtenerSql } = require("./_db");

// ==============================
// LA RUTA VIEJA DE LAS PRENDAS DEJA DE SERVIR ARTE
// ==============================
// El arte de los avatares vive en la base desde la migración 018, y su
// URL buena es /prendas/<huella sha256>.png: el nombre ES el contenido,
// así que se cachea un año sin poder quedarse vieja.
//
// Durante la mudanza quedó abierta la ruta de antes,
// imagenes/<modelo>/<prenda>.png, sirviendo el mismo dibujo desde el
// disco o, si el fichero no estaba, desde la base. Era compatibilidad
// hacia atrás y tenía sentido mientras el frontend armara esa ruta a
// mano.
//
// El problema es que ese nombre SE ADIVINA. "tora_pelo3" es
// imagenes/tora/pelo3.png, y el nombrado es sistemático: modelo, capa y
// un número. Cualquiera enumera pelo1, pelo2, pelo3... por cada capa y
// por cada modelo, y se lleva el catálogo entero sin necesitar índice
// ninguno. Cerrar el índice del catálogo —que es lo que se hizo en la
// acción avatar-catalogo— no sirve de nada mientras esta puerta siga
// abierta, porque es la misma puerta.
//
// Así que ahora estas rutas devuelven 404 cuando corresponden a una
// prenda de verdad, esté el fichero en el disco o no. El arte solo sale
// por /prendas/<huella>.png, que es una dirección que hay que conocer y
// no se puede adivinar.
//
// Lo que NO se toca: imagenes/logo.png, imagenes/og-image.png,
// imagenes/juegos/... y compañía. No son prendas, no están en
// avatar_prendas, y se siguen sirviendo como siempre. Por eso el corte
// se decide consultando la base y no con una lista escrita a mano: una
// lista se queda vieja en cuanto el equipo de arte sube un modelo nuevo.

// Solo se mira si la ruta tiene forma de prenda. Sin este filtro,
// cualquier escáner pidiendo imágenes al azar acabaría consultando la
// base en cada 404.
const RUTA_DE_PRENDA = /^\/imagenes\/([a-z0-9]+)(?:\/([a-z0-9]+))?\.png$/;

// La URL canónica de una prenda: /prendas/<huella sha256>.png.
//
// Hasta ahora esa ruta solo existía como `rewrite` en la configuración de
// nginx, que la traduce a /api/content?action=avatar-prenda. Eso deja el
// sitio dependiendo de nginx para algo que no es infraestructura sino
// parte de la aplicación: con `node server.js` a pelo —que es el flujo
// que documenta el README para trabajar en local— todas esas imágenes
// daban 404, y el editor de avatares salía en blanco.
//
// Aquí se hace la misma traducción, así que la ruta funciona con nginx
// delante o sin él. nginx sigue teniendo la suya, que además cachea.
const RUTA_POR_HUELLA = /^\/prendas\/([a-f0-9]{64})\.png$/;

// Traduce la URL en su sitio y avisa si lo hizo. No sirve la imagen ni
// duplica la consulta: deja la petición hecha una llamada de API normal,
// que ya valida la huella, responde 404 si no existe y marca la
// respuesta como immutable durante un año. Es correcto marcarla así
// porque en esta URL el nombre ES el contenido.
function traducirRutaCanonica(url) {
  const m = RUTA_POR_HUELLA.exec(url.pathname);
  if (!m) return false;

  url.pathname = "/api/content";
  url.searchParams.set("action", "avatar-prenda");
  url.searchParams.set("v", m[1]);
  return true;
}

function valorDePrenda(rutaRelativa) {
  const m = RUTA_DE_PRENDA.exec(rutaRelativa);
  if (!m) return null;
  // imagenes/tora.png -> "tora"   |   imagenes/tora/pelo3.png -> "tora_pelo3"
  return m[2] ? m[1] + "_" + m[2] : m[1];
}

// El conjunto de valores que SON una prenda, cacheado.
//
// Se cachea por la misma razón que el catálogo en api/content.js: esto
// se consulta en cada imagen que alguien pida con forma de prenda, y un
// escáner insistente no puede convertirse en una consulta por petición.
//
// La versión del catálogo manda, igual que en el resto del proyecto:
// avatar_catalogo_version es una fila por clave primaria, así que
// comprobarla es barato y los dos procesos del cluster se enteran solos
// cuando el equipo de arte publica algo, sin hablar entre ellos.
//
// Entran las retiradas también (no se filtra por `publicada`): una
// prenda retirada sigue siendo arte del equipo, y su dibujo tampoco
// tiene por qué salir por la ruta adivinable.
let _valoresDePrenda = null;   // { version, conjunto }

async function conjuntoDeValores(sql) {
  let version = null;
  try {
    const filas = await sql`SELECT version FROM avatar_catalogo_version WHERE id = 1;`;
    version = filas.length ? Number(filas[0].version) : null;
  } catch (error) {
    // Si no se puede leer la versión, se sirve lo que haya en memoria
    // antes que dejar pasar una prenda por la ruta vieja.
    console.error("valores de prenda: no se pudo leer la versión", error.message);
    if (_valoresDePrenda) return _valoresDePrenda.conjunto;
    throw error;
  }

  if (_valoresDePrenda && _valoresDePrenda.version === version) {
    return _valoresDePrenda.conjunto;
  }

  const filas = await sql`SELECT valor FROM avatar_prendas;`;
  const conjunto = new Set(filas.map(f => f.valor));
  _valoresDePrenda = { version, conjunto };
  return conjunto;
}

// ¿Esta ruta de imagenes/ corresponde a una prenda de avatar?
//
// Ante la duda se contesta que SÍ, y por eso el catch devuelve true: si
// la base no responde, preferimos un logo que no carga durante un rato
// antes que abrir la puerta por la que se fue el catálogo. El arte no
// deja de verse por esto —sale por /prendas/<huella>.png, que no pasa
// por aquí—, así que el coste de equivocarse por este lado es bajo.
async function esPrendaDeAvatar(rutaRelativa) {
  const valor = valorDePrenda(rutaRelativa);
  if (!valor) return false;

  try {
    const conjunto = await conjuntoDeValores(obtenerSql());
    return conjunto.has(valor);
  } catch (error) {
    console.error("prenda por la ruta vieja:", error.message);
    return true;
  }
}

// invalidarValores() existe para los tests: la version del catalogo ya
// obliga a reconstruir cuando algo cambia, asi que en produccion no hace
// falta llamarla. Misma idea que invalidarCache() en _avatar-catalogo.js.
function invalidarValores() {
  _valoresDePrenda = null;
}

module.exports = {
  RUTA_DE_PRENDA,
  RUTA_POR_HUELLA,
  traducirRutaCanonica,
  valorDePrenda,
  esPrendaDeAvatar,
  invalidarValores
};

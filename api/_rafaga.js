// ==============================
// AVISO POR RAFAGA DE PRENDAS — api/_rafaga.js
// ==============================
// Cuenta cuántas prendas DISTINTAS pide cada IP en una ventana de
// tiempo, y avisa cuando una se pasa de lo que puede pedir alguien
// mirando el sitio.
//
// Esto NO impide nada, y conviene decirlo en voz alta para que nadie se
// confíe: quien quiera el catálogo se lo va a llevar igual. Lo que
// compra es enterarse EL MISMO DÍA en vez de meses después, que es
// exactamente lo que dolió la vez que pasó: alguien se bajó el catálogo
// entero y el equipo de dibujo lo descubrió al ver su trabajo publicado
// en otra web.
//
// ---------------------------------------------------------------
// DE DONDE SALE EL UMBRAL
// ---------------------------------------------------------------
// Medido contra la copia de producción del 16/09/2026:
//
//   655  prendas en el catálogo
//   438  archivos distintos (los fondos y bordes se repiten entre modelos)
//   354  valores que alguien lleva puesto
//   298  huellas distintas EN USO  <- el techo de una visita anónima
//
// Quien no tiene cuenta solo puede llegar a las 298 que alguien lleva
// puesta, porque el índice público solo entrega eso. Las otras 140 solo
// salen del catálogo completo, y ése pide sesión.
//
// Por eso el umbral va por encima de 298: por debajo saltaría con una
// página de comunidad cargada entera.
//
// ---------------------------------------------------------------
// LOS DOS AGUJEROS, DICHOS ANTES DE QUE SORPRENDAN
// ---------------------------------------------------------------
// 1. nginx cachea /prendas/ durante 365 días (proxy_cache), así que una
//    petición que acierte en esa caché NUNCA llega hasta acá y no se
//    cuenta. Esto ve un subconjunto.
//
//    Lo salva el propio caso que importa: quien se lleva el catálogo
//    ENTERO se lleva también las prendas que no lleva casi nadie, y ésas
//    no están en la caché. Un raspado completo asoma por aquí aunque la
//    mitad de las peticiones se queden en nginx. Un raspado de solo lo
//    popular, no.
//
// 2. cluster.js levanta un proceso por núcleo y cada uno cuenta por su
//    cuenta. Con dos procesos, una ráfaga repartida entre los dos tarda
//    el doble en asomar. No se arregla con una tabla en la base: sería
//    escribir en cada imagen servida. Se asume, y por eso el umbral no
//    va pegado al techo.

const { obtenerSql } = require("./_db");
const { crearNotificacionServidor } = require("./_notifications");

const sql = obtenerSql();

// Todo configurable por si hay que apretar o aflojar sin desplegar.
const VENTANA_MS = Number(process.env.MR_RAFAGA_VENTANA_MS) || 3 * 60 * 1000;
const UMBRAL = Number(process.env.MR_RAFAGA_UMBRAL) || 320;

// Para no repetirle el mismo aviso a los administradores cada tres
// minutos mientras dure la ráfaga.
const ESPERA_AVISO_MS = Number(process.env.MR_RAFAGA_ESPERA_MS) || 60 * 60 * 1000;

// Tope de IP vigiladas a la vez. Sin esto, un escáner con muchas IP
// distintas llenaría la memoria del proceso, que en esta máquina son
// 950 MB para todo. Al llegar al tope se tira la mitad más vieja.
const TOPE_IPS = 5000;

const porIP = new Map();   // ip -> { huellas: Map<huella, cuando>, avisadoEn }


function limpiar(registro, ahora) {
  for (const [huella, cuando] of registro.huellas) {
    if (ahora - cuando > VENTANA_MS) registro.huellas.delete(huella);
  }
}

function podar(ahora) {
  if (porIP.size <= TOPE_IPS) return;

  // Se van las que no han pedido nada en toda la ventana. Si aun así no
  // baja del tope, se tira la mitad por orden de inserción, que en un
  // Map es el orden natural.
  for (const [ip, registro] of porIP) {
    limpiar(registro, ahora);
    if (!registro.huellas.size) porIP.delete(ip);
  }

  if (porIP.size <= TOPE_IPS) return;
  let sobran = porIP.size - Math.floor(TOPE_IPS / 2);
  for (const ip of porIP.keys()) {
    porIP.delete(ip);
    if (--sobran <= 0) break;
  }
}


// La IP de quien pide, con nginx delante.
//
// X-Forwarded-For puede traer una lista si hay varios saltos; el primero
// es el cliente. Se recorta a algo razonable porque es una cabecera que
// manda el cliente y no hay que fiarse de su longitud.
function ipDe(req) {
  const cabecera = (req.headers && (req.headers["x-forwarded-for"] || req.headers["x-real-ip"])) || "";
  const primera = String(cabecera).split(",")[0].trim();
  const cruda = primera || (req.socket && req.socket.remoteAddress) || "";
  return cruda.slice(0, 64);
}


async function avisarAdministradores(ip, cuantas) {
  const titulo = "Posible descarga masiva del catálogo";
  const mensaje =
    "La dirección " + ip + " pidió " + cuantas + " prendas distintas en " +
    Math.round(VENTANA_MS / 60000) + " minutos. El techo de una visita normal " +
    "sin cuenta son 298. Puede ser alguien copiando el catálogo.";

  // El aviso al registro va SIEMPRE, aunque lo de abajo falle: es lo
  // único que no depende de que la base conteste.
  console.warn("[rafaga] " + mensaje);

  let admins;
  try {
    admins = await sql`
      SELECT u.username
      FROM badges b
      JOIN users u ON u.id = b.user_id
      WHERE b.badge_id = 'administrador';
    `;
  } catch (error) {
    console.error("[rafaga] no se pudo leer la lista de administradores:", error.message);
    return;
  }

  for (const admin of admins) {
    try {
      await crearNotificacionServidor(admin.username, titulo, mensaje);
    } catch (error) {
      console.error("[rafaga] no se pudo avisar a " + admin.username + ":", error.message);
    }
  }
}


// Se llama con cada prenda servida. Devuelve true si esta petición fue
// la que disparó el aviso, y eso es solo para poder probarlo: quien
// llama no tiene que hacer nada con el valor.
//
// Nunca lanza. Un fallo contando imágenes no puede dejar de servir una
// imagen, así que todo va envuelto.
async function contarPrenda(req, huella) {
  try {
    const ahora = Date.now();
    const ip = ipDe(req);
    if (!ip || !huella) return false;

    let registro = porIP.get(ip);
    if (!registro) {
      registro = { huellas: new Map(), avisadoEn: 0 };
      porIP.set(ip, registro);
      podar(ahora);
    }

    registro.huellas.set(huella, ahora);
    limpiar(registro, ahora);

    if (registro.huellas.size < UMBRAL) return false;
    if (ahora - registro.avisadoEn < ESPERA_AVISO_MS) return false;

    registro.avisadoEn = ahora;
    await avisarAdministradores(ip, registro.huellas.size);
    return true;
  } catch (error) {
    console.error("[rafaga] contando:", error.message);
    return false;
  }
}

// Para los tests.
function olvidarTodo() {
  porIP.clear();
}

module.exports = { contarPrenda, olvidarTodo, ipDe, VENTANA_MS, UMBRAL };

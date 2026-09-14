// ==============================
// CATÁLOGO DE PRENDAS DE AVATAR — api/_avatar-catalogo.js
// ==============================
// Único lugar del backend que sabe QUÉ prendas existen y CUÁLES hay que
// pagar. Nació para tapar un agujero concreto: hasta ahora el editor de
// avatares bloqueaba las prendas premium solo con una clase de CSS
// (aplicarBloqueosTienda() en js/perfil.js), pero el servidor guardaba
// cualquier cosa que le mandaran. Con abrir la consola del navegador se
// podían vestir todas las prendas de pago sin gastar una moneda.
//
// El catálogo se arma leyendo la carpeta imagenes/, que es la fuente de
// verdad real del proyecto:
//
//   imagenes/tora.png          -> el modelo "tora"
//   imagenes/tora/remera3.png  -> la prenda "tora_remera3"
//
// Es el mismo criterio que usa el frontend para resolver rutas
// (rutaImagenCapa() en js/usuario.js), así que catálogo y dibujo no
// pueden desincronizarse.
//
// Solo se aceptan nombres en minúsculas, sin espacios ni paréntesis. En
// la carpeta hay archivos como "Boca 1.png" o "boca5 (1).png" que el
// frontend nunca pudo mostrar: quedan fuera a propósito, para no
// convertir un descuido de nombres en una prenda a medio funcionar.
//
// El escaneo se hace una sola vez y queda cacheado: hoy agregar arte
// implica commit y despliegue (que reinicia el proceso), así que no hace
// falta releer el disco en cada request. Cuando exista el panel de carga
// del equipo de arte, este módulo pasará a leer la tabla del catálogo y
// habrá que invalidar la caché al publicar una prenda.

const fs = require("fs");
const path = require("path");

// Las 15 capas que componen un avatar, en el mismo orden en que se
// dibujan. Acá vive la versión del servidor, que es la que manda para
// validar.
//
// El frontend tenía esta lista copiada en once archivos, y dos de ellos
// (js/ranking.js y js/comunidad-ranking.js) llevaban "pantalon" antes
// que "botas": el mismo avatar se dibujaba distinto según la página.
// Ahora los once toman la lista de ORDEN_CAPAS_AVATAR en js/core.js, que
// es el gemelo de esta constante del lado del navegador. Si se cambia
// una, hay que cambiar la otra.
const CAPAS = [
  "fondo", "espalda", "modelo", "piel", "ojos", "boca",
  "botas", "pantalon", "remera", "guantes", "accesorio",
  "cara", "pelo", "mascota", "borde"
];

const CAPAS_VALIDAS = new Set(CAPAS);

// "ninguno" es cómo el editor representa una capa vacía.
const VACIO = "ninguno";

// Carpetas dentro de imagenes/ que no son modelos de avatar.
const NO_MODELOS = new Set(["juegos"]);

// Un nombre de archivo utilizable: minúsculas, dígitos, nada más.
const NOMBRE_LIMPIO = /^[a-z0-9]+$/;

const RAIZ_IMAGENES = path.join(__dirname, "..", "imagenes");

let _catalogo = null;

// Arma el catálogo leyendo el disco. Devuelve:
//   modelos: Set de modelos válidos ("tora", "cereza", ...)
//   prendas: Map de valor -> capa ("tora_remera3" -> "remera")
//
// Guardar la capa de cada prenda es lo que permite rechazar que alguien
// mande una remera en la ranura del pelo: sin eso, un avatar podría
// tener {"pelo": "tora_remera3"} y el navegador dibujaría una remera
// flotando sobre la cabeza.
function construirCatalogo() {
  const modelos = new Set();
  const prendas = new Map();

  let carpetas;
  try {
    carpetas = fs.readdirSync(RAIZ_IMAGENES, { withFileTypes: true });
  } catch (error) {
    // Si no se puede leer el disco preferimos un catálogo vacío antes
    // que reventar: quien llame decide qué hacer (ver validarAvatar,
    // que ante un catálogo vacío no bloquea a nadie).
    console.error("_avatar-catalogo: no se pudo leer imagenes/", error.message);
    return { modelos, prendas };
  }

  for (const entrada of carpetas) {
    if (!entrada.isDirectory()) continue;

    const modelo = entrada.name;
    if (NO_MODELOS.has(modelo)) continue;
    if (!NOMBRE_LIMPIO.test(modelo)) continue;

    // Un modelo solo cuenta si tiene su propia imagen en la raíz:
    // imagenes/tora.png es lo que el editor usa como "cuerpo".
    if (!fs.existsSync(path.join(RAIZ_IMAGENES, modelo + ".png"))) continue;

    modelos.add(modelo);

    let archivos;
    try {
      archivos = fs.readdirSync(path.join(RAIZ_IMAGENES, modelo));
    } catch (_) {
      continue;
    }

    for (const archivo of archivos) {
      const ext = path.extname(archivo).toLowerCase();
      if (ext !== ".png" && ext !== ".jpg") continue;

      const base = path.basename(archivo, ext);
      if (!NOMBRE_LIMPIO.test(base)) continue;

      // "remera3" -> capa "remera". El número final es solo la variante.
      const capa = base.replace(/\d+$/, "");
      if (!CAPAS_VALIDAS.has(capa)) continue;

      prendas.set(modelo + "_" + base, capa);
    }
  }

  return { modelos, prendas };
}

function obtenerCatalogo() {
  if (!_catalogo) _catalogo = construirCatalogo();
  return _catalogo;
}

// Para los tests y para el futuro panel de carga de prendas.
function invalidarCache() {
  _catalogo = null;
}

// Devuelve un Map de valor_capa -> item_id con las prendas que hay que
// pagar. Se consulta en cada validación porque la tienda cambia sin
// reiniciar el proceso (se agregan prendas con un INSERT).
async function prendasPremium(sql) {
  const filas = await sql`SELECT id, valor_capa FROM avatar_shop_items;`;
  const mapa = new Map();
  for (const fila of filas) mapa.set(fila.valor_capa, fila.id);
  return mapa;
}

async function comprasDe(sql, userId) {
  const filas = await sql`
    SELECT item_id FROM avatar_shop_purchases WHERE user_id = ${userId};
  `;
  return new Set(filas.map(f => f.item_id));
}

// Junta todos los valores de capa que un usuario YA tiene guardados,
// tanto en su avatar activo como en los 6 casilleros de la galería.
//
// Esto es el "derecho adquirido" y es la parte más importante del
// diseño: al momento de escribir esto hay 39 casos de usuarios con
// prendas premium que nunca compraron, y 21 más en galerías. Son
// anteriores a esta validación. Si las rechazáramos sin más, esas
// personas no podrían volver a guardar su avatar: cualquier cambio, por
// mínimo que fuera, les daría error. La regla es entonces:
//
//   - lo que ya tenías puesto, se respeta;
//   - lo que agregues de ahora en más, tiene que ser tuyo.
//
// El agujero queda cerrado hacia adelante sin romperle la página a
// nadie. Regularizar esos casos viejos (cobrarlos, regalarlos o
// quitarlos) es una decisión de producto, no algo que deba pasar
// silenciosamente en una validación.
async function valoresYaEnUso(sql, userId) {
  const enUso = new Set();

  // Dos consultas en vez de un UNION: la columna avatar no tiene el
  // mismo tipo en las dos tablas según el motor (jsonb en Postgres,
  // text en la maqueta local de los tests), y unirlas falla con
  // "UNION types text and jsonb cannot be matched".
  const [activo, guardados] = await Promise.all([
    sql`SELECT avatar FROM users WHERE id = ${userId};`,
    sql`SELECT avatar FROM saved_avatars WHERE user_id = ${userId};`
  ]);

  for (const fila of [...activo, ...guardados]) {
    // Según el driver, un jsonb puede llegar ya parseado o como texto.
    let avatar = fila.avatar;
    if (typeof avatar === "string") {
      try { avatar = JSON.parse(avatar); } catch (_) { continue; }
    }
    if (!avatar || typeof avatar !== "object" || Array.isArray(avatar)) continue;

    for (const [capa, valor] of Object.entries(avatar)) {
      if (!CAPAS_VALIDAS.has(capa)) continue;
      if (typeof valor === "string" && valor && valor !== VACIO) enUso.add(valor);
    }
  }

  return enUso;
}

// ==============================
// VALIDACIÓN
// ==============================
// Devuelve { ok: true, avatar } con el avatar ya normalizado, o
// { ok: false, error } con un mensaje para mostrarle a la persona.
//
// El avatar que sale NO es el que entró: se reconstruye capa por capa
// desde el catálogo. Así, cualquier clave de más que venga en el cuerpo
// del request se descarta en vez de terminar guardada en la base.
async function validarAvatar(sql, userId, avatar) {

  if (avatar === null || avatar === undefined) {
    return { ok: true, avatar: null };
  }

  if (typeof avatar !== "object" || Array.isArray(avatar)) {
    return { ok: false, error: "El avatar tiene un formato inválido" };
  }

  // Los avatares PNG del administrador tienen otra forma ({tipo, src,
  // restaurar}) y su propio camino con su propia validación
  // (update-admin-avatar-png). Acá no se aceptan.
  if (avatar.tipo === "png" || typeof avatar.src === "string") {
    return { ok: false, error: "Este formato de avatar no se guarda por acá" };
  }

  const claves = Object.keys(avatar);
  if (claves.length > CAPAS.length) {
    return { ok: false, error: "El avatar tiene más capas de las que existen" };
  }

  const { modelos, prendas } = obtenerCatalogo();

  // Si el catálogo quedó vacío (disco ilegible), validar rechazaría
  // absolutamente todo y dejaría a la gente sin poder guardar. Ante esa
  // falla preferimos no bloquear: se registra y se deja pasar, que es
  // exactamente el comportamiento que había antes de este módulo.
  if (prendas.size === 0) {
    console.error("_avatar-catalogo: catálogo vacío, se omite la validación");
    return { ok: true, avatar };
  }

  const premium = await prendasPremium(sql);
  const compradas = await comprasDe(sql, userId);
  const yaEnUso = await valoresYaEnUso(sql, userId);

  const limpio = {};

  for (const capa of claves) {
    if (!CAPAS_VALIDAS.has(capa)) {
      return { ok: false, error: `"${capa}" no es una capa de avatar` };
    }

    const valor = avatar[capa];

    if (valor === null || valor === undefined || valor === VACIO || valor === "") {
      limpio[capa] = VACIO;
      continue;
    }

    if (typeof valor !== "string" || valor.length > 80) {
      return { ok: false, error: `El valor de "${capa}" es inválido` };
    }

    // Lo que la persona ya tenía guardado se acepta sin más preguntas,
    // aunque hoy no esté en el catálogo o sea premium sin comprar.
    // Cubre los 39 casos previos y también las capas que quedaron
    // apuntando a un archivo que ya no existe (ej: "tora_piel7", que
    // llevan tres usuarios y no se dibuja).
    if (yaEnUso.has(valor)) {
      limpio[capa] = valor;
      continue;
    }

    if (capa === "modelo") {
      if (!modelos.has(valor)) {
        return { ok: false, error: `El modelo "${valor}" no existe` };
      }
      limpio[capa] = valor;
      continue;
    }

    const capaDeLaPrenda = prendas.get(valor);

    if (!capaDeLaPrenda) {
      return { ok: false, error: `La prenda "${valor}" no existe` };
    }

    // La prenda tiene que corresponder a la ranura donde se la pone.
    if (capaDeLaPrenda !== capa) {
      return { ok: false, error: `"${valor}" no es una prenda de ${capa}` };
    }

    // Y si es de pago, tiene que estar comprada. Esto es lo que hasta
    // ahora solo comprobaba el navegador.
    const itemId = premium.get(valor);
    if (itemId !== undefined && !compradas.has(itemId)) {
      return { ok: false, error: "Hay una prenda de la tienda que todavía no compraste" };
    }

    limpio[capa] = valor;
  }

  return { ok: true, avatar: limpio };
}

module.exports = {
  CAPAS,
  VACIO,
  obtenerCatalogo,
  invalidarCache,
  validarAvatar
};

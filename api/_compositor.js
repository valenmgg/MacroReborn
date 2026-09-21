// ==============================
// COMPONER UN AVATAR — api/_compositor.js
// ==============================
// Hasta ahora el avatar lo armaba el navegador: el servidor le mandaba
// las quince prendas sueltas y el navegador las apilaba con quince
// etiquetas <img>. Eso significa que cualquiera con la pestaña de Red
// abierta se lleva el archivo del artista, a 327x504 y con su alfa
// intacto, sin más esfuerzo que mirar.
//
// Aquí se apilan en el servidor y sale UNA imagen. Es lo que hacía
// macrojuegos durante una década, y el porqué entero, con lo medido y
// lo que este cambio NO compra, está en docs/AVATARES-SERVIDOR.md.
//
// ESTE MÓDULO NO SABE DE HTTP NI DE LA BASE, a propósito: recibe bytes
// de PNG ya en orden de dibujo y devuelve bytes. Por eso se puede
// probar sin levantar un servidor ni tocar una tabla, igual que
// api/_avisos.js.
//
// EL ORDEN LO PONE QUIEN LLAMA. No se guarda aquí una copia de
// ORDEN_CAPAS_AVATAR, que ya vive en js/core.js y tiene una gemela en
// api/content.js. Una tercera copia es exactamente la trampa que este
// proyecto ya pisó: hubo dos que no coincidían y el mismo avatar se
// dibujaba distinto según la página.

const jpeg = require("jpeg-js");
const lienzo = require("./_lienzo");

const ANCHO = lienzo.LIENZO_ANCHO;
const ALTO = lienzo.LIENZO_ALTO;

// La calidad del JPG. Medido sobre tres avatares reales: a 80 pesan
// unos 56 kB a tamaño completo y 4 kB en miniatura; a 88 pesan un 30 %
// más y no se ven mejor.
const CALIDAD = 80;

// Con qué se rellena el hueco cuando no hay capa de fondo. JPG no tiene
// alfa, así que un avatar sin fondo necesita un color debajo o los
// píxeles transparentes salen negros, que es lo que haya en memoria.
//
// Blanco, decidido el 21/09/2026. Son 6 de 117 avatares y 9 de 98
// ranuras: quien no eligió fondo verá un rectángulo blanco donde antes
// se veía la página. Es un cambio visible para esas personas, y se
// aceptó a cambio de que TODO salga en el mismo formato, sin una rama
// aparte que mantener.
const FONDO_POR_DEFECTO = { r: 255, g: 255, b: 255 };

// ------------------------------------------------------------------
// MEZCLAR
// ------------------------------------------------------------------
// source-over sin premultiplicar, que es lo que hace el navegador al
// apilar quince <img> y por tanto lo que la gente ya está viendo. Si
// esto se calculara de otra forma, los avatares cambiarían de aspecto
// el día del cambio, y eso sería un cambio de producto disfrazado de
// cambio técnico.
function encimar(base, capa) {
  for (let i = 0; i < base.length; i += 4) {
    const alfa = capa[i + 3];
    if (alfa === 0) continue;

    // Opaco: se pisa y se acabó. Es el caso de la mayoría de los
    // píxeles de un fondo o de una piel, así que sale a cuenta
    // separarlo en vez de pasar por la fórmula general.
    if (alfa === 255) {
      base[i] = capa[i];
      base[i + 1] = capa[i + 1];
      base[i + 2] = capa[i + 2];
      base[i + 3] = 255;
      continue;
    }

    const af = alfa / 255;
    const ab = base[i + 3] / 255;
    const salida = af + ab * (1 - af);

    base[i] = Math.round((capa[i] * af + base[i] * ab * (1 - af)) / salida);
    base[i + 1] = Math.round((capa[i + 1] * af + base[i + 1] * ab * (1 - af)) / salida);
    base[i + 2] = Math.round((capa[i + 2] * af + base[i + 2] * ab * (1 - af)) / salida);
    base[i + 3] = Math.round(salida * 255);
  }
}

// Lleva una capa al lienzo de 327x504 si no viene ya en él.
//
// Hoy no debería pasar nunca: los 549 archivos del catálogo miden
// 327x504 desde que scripts/encajar-lienzo.js los llevó allí. Pero el
// que no pase nunca no es razón para reventar si pasa, y menos en el
// camino que dibuja el avatar de alguien.
//
// La política no se inventa: es la misma que ya está escrita en
// api/_lienzo.js y en docs/ARTE.md 3. Pegado 1:1 cuando basta con
// recortar o rellenar unas filas, que es un calco y no toca un solo
// píxel; encaje solo cuando de verdad tiene otra proporción, que sí
// remuestrea y por eso se reserva para eso.
const HOLGURA = 4;

function alLienzo(img) {
  if (img.ancho === ANCHO && img.alto === ALTO) return lienzo.aRGBA(img);

  const cerca = Math.abs(img.ancho - ANCHO) <= HOLGURA && Math.abs(img.alto - ALTO) <= HOLGURA;
  const llevada = cerca
    ? lienzo.pegar1a1(img, ANCHO, ALTO)
    : lienzo.encajarContain(img, ANCHO, ALTO);

  return lienzo.aRGBA(llevada);
}

// Apila los PNG que se le den, en el orden en que vengan, sobre un
// lienzo transparente de 327x504.
function componer(pngs) {
  if (!Array.isArray(pngs)) throw new TypeError("componer espera una lista de PNG");

  const base = Buffer.alloc(ANCHO * ALTO * 4);

  for (const png of pngs) {
    if (!png || !png.length) continue;
    // La columna bytea llega como Buffer con el driver de Postgres y
    // como Uint8Array con PGlite, que es el de los tests y el de la
    // copia local. Buffer.from cubre los dos, y sin esto el mismo
    // codigo funciona en produccion y falla en local, que es la peor
    // forma de romperse. Mismo apaño que api/content.js.
    const binario = Buffer.isBuffer(png) ? png : Buffer.from(png);
    encimar(base, alLienzo(lienzo.leerPixeles(binario)).rgba);
  }

  return { rgba: base, ancho: ANCHO, alto: ALTO };
}

// ------------------------------------------------------------------
// SALIDA
// ------------------------------------------------------------------

// ¿Queda algo transparente? Ya no decide el formato, pero sí decide si
// hay que aplanar antes de codificar, y se informa hacia fuera porque
// quien mire una previsualización querrá saberlo.
function tieneTransparencia(img) {
  for (let i = 3; i < img.rgba.length; i += 4) {
    if (img.rgba[i] !== 255) return true;
  }
  return false;
}

// Aplana sobre un color opaco. Hace falta antes de un JPG, porque
// jpeg-js ignora el canal alfa y dejaría el color de un píxel
// transparente tal cual esté en memoria, que es negro.
function aplanar(img, color) {
  const c = color || FONDO_POR_DEFECTO;
  const rgba = Buffer.from(img.rgba);
  for (let i = 0; i < rgba.length; i += 4) {
    const af = rgba[i + 3] / 255;
    if (af === 1) continue;
    rgba[i] = Math.round(rgba[i] * af + c.r * (1 - af));
    rgba[i + 1] = Math.round(rgba[i + 1] * af + c.g * (1 - af));
    rgba[i + 2] = Math.round(rgba[i + 2] * af + c.b * (1 - af));
    rgba[i + 3] = 255;
  }
  return { rgba, ancho: img.ancho, alto: img.alto };
}

function reducir(img, ancho, alto) {
  if (img.ancho === ancho && img.alto === alto) return img;
  return lienzo.remuestrearPorArea(img, ancho, alto);
}

function aJPG(img, calidad) {
  const plano = tieneTransparencia(img) ? aplanar(img) : img;
  const cod = jpeg.encode(
    { data: plano.rgba, width: plano.ancho, height: plano.alto },
    calidad === undefined ? CALIDAD : calidad
  );
  return Buffer.from(cod.data);
}

function aPNG(img) {
  return lienzo.escribirRGBA8(img);
}

// Recorta un rectángulo. Es lo que necesita una previsualización: la
// prenda puesta sobre el modelo, enmarcada en su zona, como en un
// inventario de videojuego. Un recorte NO remuestrea: los píxeles que
// quedan son los de origen.
function recortar(img, x, y, ancho, alto) {
  if (x < 0 || y < 0 || x + ancho > img.ancho || y + alto > img.alto) {
    throw new RangeError("El recorte se sale del lienzo");
  }
  const rgba = Buffer.alloc(ancho * alto * 4);
  for (let fila = 0; fila < alto; fila++) {
    const desde = ((y + fila) * img.ancho + x) * 4;
    img.rgba.copy(rgba, fila * ancho * 4, desde, desde + ancho * 4);
  }
  return { rgba, ancho, alto };
}

// La caja que ocupa el dibujo, ignorando lo transparente. Sirve para
// calcular el recorte de cada capa a partir del arte de verdad, en vez
// de escribir quince rectángulos a ojo. Devuelve null si está vacía.
function cajaDibujada(img) {
  let x0 = img.ancho, y0 = img.alto, x1 = -1, y1 = -1;
  for (let y = 0; y < img.alto; y++) {
    for (let x = 0; x < img.ancho; x++) {
      if (img.rgba[(y * img.ancho + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, ancho: x1 - x0 + 1, alto: y1 - y0 + 1 };
}

// El trabajo entero para un avatar: apilar, y sacar cada tamaño que se
// pida en el formato que le corresponda.
//
// Devuelve también `formato`, porque quien guarde esto necesita saber
// con qué extensión, y averiguarlo dos veces es cómo se acaba con una
// extensión que miente sobre su contenido.
function renderizar(pngs, tamanos, opciones) {
  const op = opciones || {};
  const base = componer(pngs);
  const transparente = tieneTransparencia(base);

  // Siempre JPG salvo que se pida otra cosa. Lo que no lleve fondo se
  // aplana sobre blanco: ver FONDO_POR_DEFECTO.
  const formato = op.formato || "jpg";

  const salidas = {};
  for (const [ancho, alto] of tamanos) {
    const chico = reducir(base, ancho, alto);
    salidas[ancho + "x" + alto] = formato === "png"
      ? aPNG(chico)
      : aJPG(chico, op.calidad);
  }

  return { formato, transparente, salidas, base };
}

module.exports = {
  ANCHO,
  ALTO,
  CALIDAD,
  FONDO_POR_DEFECTO,
  componer,
  encimar,
  aplanar,
  reducir,
  recortar,
  cajaDibujada,
  tieneTransparencia,
  aJPG,
  aPNG,
  renderizar
};

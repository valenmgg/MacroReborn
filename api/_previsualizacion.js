// ==============================
// DIBUJAR UNA PREVISUALIZACION — api/_previsualizacion.js
// ==============================
// La prenda puesta sobre un maniqui y recortada a su cuadro, como en el
// inventario de un videojuego. Los cuadros los decide una persona y
// viven en api/_recortes.js; esto solo dibuja. Fase 4 de
// docs/AVATARES-SERVIDOR.md.
//
// NUNCA LA PRENDA SOLA SOBRE TRANSPARENTE. Eso seria regalar el catalogo
// otra vez: una previsualizacion es un trozo pequeño de la prenda PUESTA,
// aplanado en JPG, que es lo que hacia macrojuegos.
//
// EL MANIQUI PLANO. Leidas sus previsualizaciones archivadas el
// 23/09/2026, macrojuegos no ponia la prenda sobre el modelo a color sino
// sobre una silueta de un solo tono gris azulado. Por eso la prenda
// resaltaba tanto. Aqui la silueta se saca del propio modelo: se conserva
// su forma, que es el alfa, y se pinta entera de un color.

const compositor = require("./_compositor");
const { CAPAS } = require("./_avatar-catalogo");
const recortes = require("./_recortes");

const INDICE_MODELO = CAPAS.indexOf("modelo");

// La silueta de un modelo: su misma forma, de un solo color. Se toca el
// color y no el alfa, asi que los bordes suaves del dibujo siguen suaves.
function silueta(img, color) {
  const c = color || recortes.COLOR_MANIQUI;
  const rgba = Buffer.from(img.rgba);
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue;
    rgba[i] = c.r;
    rgba[i + 1] = c.g;
    rgba[i + 2] = c.b;
  }
  return { rgba, ancho: img.ancho, alto: img.alto };
}

// El maniqui con la prenda puesta, a tamaño de lienzo, sin recortar.
//
// El orden importa y sale de CAPAS: el fondo y la espalda van DETRAS del
// modelo, todo lo demas delante. Con el orden al reves, un fondo se
// pintaria encima del cuerpo.
function puesta(opciones) {
  const { base, prenda, capa } = opciones;
  const maniqui = opciones.maniqui || "plano";

  // La capa "modelo" es el propio cuerpo: su previsualizacion es el
  // modelo tal cual. Volverlo silueta dejaria seis manchas iguales.
  if (capa === "modelo" || !base) {
    return compositor.componer([prenda]);
  }

  let cuerpo = compositor.componer([base]);
  if (maniqui === "plano") cuerpo = silueta(cuerpo);

  const encima = compositor.componer([prenda]);
  const detras = CAPAS.indexOf(capa) < INDICE_MODELO;

  const lienzo = Buffer.alloc(compositor.ANCHO * compositor.ALTO * 4);
  const capasEnOrden = detras ? [encima.rgba, cuerpo.rgba] : [cuerpo.rgba, encima.rgba];
  for (const c of capasEnOrden) compositor.encimar(lienzo, c);

  return { rgba: lienzo, ancho: compositor.ANCHO, alto: compositor.ALTO };
}

// La previsualizacion final: puesta, recortada a su cuadro, reducida al
// lado de salida y en JPG. Devuelve los bytes.
function renderizar(opciones) {
  const { cuadro } = opciones;
  const problema = recortes.problemaDeCuadro(cuadro);
  if (problema) throw new RangeError("Cuadro invalido: " + problema);

  const lado = opciones.lado || recortes.LADO_SALIDA;
  const img = puesta(opciones);
  const trozo = compositor.recortar(img, cuadro.x, cuadro.y, cuadro.lado, cuadro.lado);
  const chico = compositor.reducir(trozo, lado, lado);
  return compositor.aJPG(chico, opciones.calidad);
}

module.exports = {
  silueta,
  puesta,
  renderizar
};

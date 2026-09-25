// ==============================
// EL PRECIO DE CADA RANURA — api/_precios.js
// ==============================
// Lo que cuesta una prenda según su ranura cuando nadie ha dicho otra
// cosa. Es la tabla con la que la migración 022 puso precio a las 594
// prendas que eran gratis (docs/TIENDA.md, 2), y la que se usa desde
// entonces para que ninguna vuelva a quedar gratis sin querer: el panel
// de arte la propone al subir una prenda, y publicar una que no tenía
// precio le pone el suyo.
//
// Todo lo publicado tiene precio, entre PRECIO_MINIMO y PRECIO_MAXIMO.
//
// La migración lleva su propia copia en SQL, porque no puede leer este
// archivo: tests/precios.test.js comprueba que las dos digan lo mismo.

const PRECIO_POR_CAPA = Object.freeze({
  boca: 50,
  cara: 50,
  accesorio: 60,
  guantes: 70,
  ojos: 80,
  piel: 80,
  botas: 90,
  pantalon: 100,
  remera: 100,
  pelo: 120,
  fondo: 130,
  borde: 150,
  espalda: 150,
  mascota: 220
});

// El ELSE de la migración, para una ranura que no esté en la tabla.
const PRECIO_POR_DEFECTO = 100;

const PRECIO_MINIMO = 1;
const PRECIO_MAXIMO = 100000;

function precioDeCapa(capa) {
  return Object.prototype.hasOwnProperty.call(PRECIO_POR_CAPA, capa)
    ? PRECIO_POR_CAPA[capa]
    : PRECIO_POR_DEFECTO;
}

function precioValido(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n >= PRECIO_MINIMO && n <= PRECIO_MAXIMO;
}

module.exports = {
  PRECIO_POR_CAPA,
  PRECIO_POR_DEFECTO,
  PRECIO_MINIMO,
  PRECIO_MAXIMO,
  precioDeCapa,
  precioValido
};

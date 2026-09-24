// ==============================
// QUÉ NOMBRE DE USUARIO SE ACEPTA — api/_nombre-usuario.js
// ==============================
// Hasta el 24/09/2026 el registro aceptaba cualquier texto no vacío como
// nombre, de cualquier largo y con cualquier carácter. Y el nombre se
// pinta en todas partes: en la lista de amigos se metía en el HTML sin
// escapar, así que un nombre como <img src=x onerror=...> se ejecutaba
// en el navegador de quien lo tuviera de amigo, o solo con mandarle una
// solicitud. Punto 77 de docs/AUDITORIA.md.
//
// El arreglo de verdad es escapar al pintar, y se hizo. Esto es la otra
// mitad: que un nombre así no se pueda ni crear.
//
// La regla deja fuera lo que rompe el HTML, un atributo o una ruta, y
// lo invisible, y deja pasar todo lo demás. Los 186 nombres que había
// ese día cumplen la regla, incluidos los que la gente eligió con
// cuidado: letras decorativas (𝕊𝔼𝔼𝕀ℕ𝔾), runas, ♡, ñ, espacios por
// dentro, puntos y signos de exclamación. Largo entre 3 y 25, que eran
// el más corto y el más largo.

const MINIMO = 3;
const MAXIMO = 25;

// Lo que rompe HTML, atributos o rutas.
const PROHIBIDOS = /[<>"'`&/\\]/;

// Lo invisible: controles (saltos de línea, tabuladores), formato
// (marcas de dirección que dan la vuelta al texto, espacios de ancho
// cero, que dejan hacerse pasar por otra cuenta), sustitutos sueltos y
// separadores de línea.
const INVISIBLES = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

// Devuelve { ok: true, nombre } o { ok: false, error }, con el error en
// palabras que se pueden enseñar tal cual en el formulario.
function validarNombreUsuario(nombre) {
  if (typeof nombre !== "string" || !nombre) {
    return { ok: false, error: "Elegí un nombre de usuario" };
  }
  if (nombre !== nombre.trim()) {
    return { ok: false, error: "El nombre no puede empezar ni terminar con un espacio" };
  }

  // Contados como los ve una persona: una letra decorativa como 𝕊 son
  // dos unidades de JavaScript pero es un carácter.
  const largo = [...nombre].length;
  if (largo < MINIMO || largo > MAXIMO) {
    return { ok: false, error: `El nombre tiene que tener entre ${MINIMO} y ${MAXIMO} caracteres` };
  }
  if (PROHIBIDOS.test(nombre)) {
    return { ok: false, error: "El nombre no puede llevar < > \" ' ` & / ni \\" };
  }
  if (INVISIBLES.test(nombre)) {
    return { ok: false, error: "El nombre lleva caracteres invisibles o de control" };
  }

  return { ok: true, nombre };
}

module.exports = { MINIMO, MAXIMO, validarNombreUsuario };

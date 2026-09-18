// ==============================
// RUTA DE UN ARCHIVO ESTÁTICO — api/_ruta-estatica.js
// ==============================
// Convierte el `pathname` de una petición en la ruta relativa con la que
// el servidor va a DECIDIR y con la que va a ABRIR el archivo.
//
// Que las dos salgan de aquí es el punto entero de este módulo. Mientras
// vivió suelto en server.js había dos lecturas distintas de la misma
// URL: se decidía con la cadena cruda y se abría con lo que devolviera
// `path.join`, que normaliza por su cuenta. Por esa diferencia se colaba
// el arte de los avatares:
//
//     /imagenes/tora/pelo3.png    -> 404, la expresión de
//                                    esPrendaDeAvatar() la reconoce
//     /imagenes//tora/pelo3.png   -> 200, la misma expresión NO
//                                    contempla la barra doble, pero
//                                    path.join la colapsaba y servía
//                                    el PNG igual
//
// Medido contra producción el 18/09/2026: la segunda devolvía el fichero
// con el mismo sha256 que el del repositorio. Y además ese camino no
// pasa por el contador de ráfagas de api/_rafaga.js, así que un raspado
// por ahí no dejaba ni rastro.
//
// El otro motivo por el que existe este módulo es que `decodeURIComponent`
// lanza. Con secuencias como %C0%80 o %ED%A0%80 —válidas en sintaxis,
// inválidas en UTF-8— tira un URIError. Dentro del handler `async` de
// server.js eso es una promesa rechazada, y Node 20 mata el proceso por
// defecto. `cluster.js` relanzaba al muerto, pero un GET en bucle dejaba
// los dos procesos reiniciándose sin parar y el sitio caído. nginx no
// filtra esas secuencias: son sintácticamente correctas y las reenvía
// tal cual.
//
// Se saca a un módulo en vez de dejarlo en server.js por lo mismo que se
// sacó `traducirRutaCanonica` a api/_prendas-ruta.js: requerir server.js
// desde un test arrancaría un servidor. Ver el comentario de
// tests/ruta-canonica.test.js.

const path = require("node:path");

// Devuelve { ok: true, ruta } con la ruta ya decodificada y normalizada,
// o { ok: false } si la URL no se puede decodificar. Quien llama
// responde 400 en ese caso: no es un 404, porque no es que el archivo no
// exista, es que la petición está mal formada.
function resolverRutaEstatica(pathname) {
  let ruta;

  try {
    ruta = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  } catch (_) {
    return { ok: false };
  }

  // posix a propósito: una URL usa barras normales venga del sistema que
  // venga, y en Windows `path.normalize` convertiría las barras a "\",
  // que es justo lo que no queremos para comparar contra una ruta de
  // URL.
  return { ok: true, ruta: path.posix.normalize(ruta) };
}

module.exports = { resolverRutaEstatica };

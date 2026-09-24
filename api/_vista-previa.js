// ==============================
// LA VISTA PREVIA DEL EDITOR — api/_vista-previa.js
// ==============================
// Fase 5 de docs/AVATARES-SERVIDOR.md. El editor de avatar enseñaba la
// ropa que se va eligiendo apilando las prendas sueltas, una <img> por
// capa: justo los archivos que no tienen que salir del equipo de arte.
// Es lo único que quedaba pidiéndolos al acabar la fase 3.
//
// Ahora la dibuja el servidor, con la misma receta y el mismo
// compositor que el avatar guardado, pero sin guardarla: es ropa que
// todavía no se ha decidido, y no tiene dirección propia.
//
// Cada clic en el editor es un dibujo de unos 100 ms de CPU, así que
// lleva dos frenos:
//
//   LO YA DIBUJADO NO SE REPITE. Se guarda en memoria por la huella de
//   la receta, que depende solo de las prendas: el mismo conjunto
//   probado por dos personas se dibuja una vez, y probarse algo y
//   quitárselo vuelve a lo que ya estaba sin dibujar nada.
//
//   UN TOPE POR PERSONA. 60 dibujos por minuto: quien va probando
//   prendas a mano no llega, y quien lo haga en bucle no se lleva la
//   máquina. Lo que ya está en memoria no cuenta.
//
// El editor, por su parte, espera a que se deje de hacer clic antes de
// pedirla. Ver actualizarPreview() en js/perfil.js.
//
// Qué se puede dibujar lo decide quien llama, con validarAvatar(): aquí
// se dibuja lo que llegue.

const compuesto = require("./_avatar-compuesto");
const compositor = require("./_compositor");

const ANCHO = 327;
const ALTO = 504;

// Unos 45 kB por imagen: 200 son unos 9 MB por proceso.
const MAXIMO_EN_MEMORIA = 200;

const TOPE_POR_MINUTO = 60;
const VENTANA_MS = 60 * 1000;

const hechas = new Map();    // huella -> JPG, del menos al más usado
const gastado = new Map();   // usuarioId -> [instantes]

function recordar(huella, jpg) {
  hechas.delete(huella);
  hechas.set(huella, jpg);
  if (hechas.size > MAXIMO_EN_MEMORIA) hechas.delete(hechas.keys().next().value);
}

// El mismo tope por ventana que el del compuesto, con su propia cuenta:
// probarse ropa no puede gastar lo que hace falta para guardarla.
function hayPresupuesto(usuarioId) {
  const ahora = Date.now();
  const previos = (gastado.get(usuarioId) || []).filter(t => ahora - t < VENTANA_MS);

  if (previos.length >= TOPE_POR_MINUTO) {
    gastado.set(usuarioId, previos);
    return false;
  }

  previos.push(ahora);
  gastado.set(usuarioId, previos);

  if (gastado.size > 500) {
    for (const [id, marcas] of gastado) {
      if (!marcas.some(t => ahora - t < VENTANA_MS)) gastado.delete(id);
    }
  }

  return true;
}

// Devuelve una de tres cosas:
//   { jpg }          la imagen
//   { vacio: true }  no lleva ninguna prenda: no hay nada que dibujar
//   { freno: true }  gastó su tope de este minuto
async function dibujar(sql, usuarioId, avatar) {
  const receta = await compuesto.recetaDe(sql, avatar);
  if (!receta) return { vacio: true };

  const ya = hechas.get(receta.huella);
  if (ya) {
    recordar(receta.huella, ya);
    return { jpg: ya };
  }

  if (!hayPresupuesto(usuarioId)) return { freno: true };

  const salida = compositor.renderizar(receta.archivos, [[ANCHO, ALTO]], { formato: compuesto.EXTENSION });
  const jpg = salida.salidas[ANCHO + "x" + ALTO];
  recordar(receta.huella, jpg);
  return { jpg };
}

// Para los tests.
function olvidar() {
  hechas.clear();
  gastado.clear();
}

module.exports = {
  ANCHO,
  ALTO,
  TOPE_POR_MINUTO,
  MAXIMO_EN_MEMORIA,
  dibujar,
  olvidar
};

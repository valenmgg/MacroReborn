// ==============================
// LOS CUADROS DE LAS PREVISUALIZACIONES — api/_recortes.js
// ==============================
// Una previsualizacion es la prenda puesta sobre un maniqui y recortada
// a un cuadro, como en el inventario de un videojuego. Fase 4 de
// docs/AVATARES-SERVIDOR.md.
//
// EL CUADRO ES AUTOMATICO, UNO POR PRENDA. Decidido el 24/09/2026:
// automatico para todas, y mas adelante se podran corregir una por una.
// Uno por prenda, alrededor de su propio dibujo, y no uno compartido por
// toda la capa: medido sobre las 768 prendas, uno compartido dejaba
// diminutos el 58 % de los accesorios y cortaba el 93 % de los pelos, y
// uno por prenda casi ninguno.
//
// SE PUEDE FORZAR, y quien decide cual manda es cuadroParaPrenda:
//   - para toda una capa de un modelo, con la herramienta de
//     scripts/herramientas/recortes. Va al archivo de abajo, versionado;
//     lo que no esta ahi es automatico.
//   - para una prenda sola, todavia no. Cuando exista, entra en
//     cuadroParaPrenda antes que lo demas.
//
// SIEMPRE CUADRADOS, uno a uno. Como el lienzo mide 327x504, el mayor
// cuadrado que cabe es de 327: de un fondo o de una melena de cuerpo
// entero se ve un trozo, el de arriba. Macrojuegos tenia la misma
// limitacion.

const fs = require("fs");
const path = require("path");

const { CAPAS } = require("./_avatar-catalogo");
const compositor = require("./_compositor");

const LIENZO_ANCHO = 327;
const LIENZO_ALTO = 504;
const LADO_MAXIMO = Math.min(LIENZO_ANCHO, LIENZO_ALTO);

// Un cuadro mas pequeño que esto no es un recorte, es un error de dedo.
const LADO_MINIMO = 12;

// El tamaño de la previsualizacion final. Un poco mas grande que los
// 70x70 de macrojuegos.
const LADO_SALIDA = 96;

// El maniqui: con el modelo tal cual, o plano de un solo tono como hacia
// macrojuegos. El tono se midio de sus propias previsualizaciones.
const MANIQUIES = ["plano", "color"];
const COLOR_MANIQUI = { r: 172, g: 180, b: 204 };

// Versionado y dentro del repositorio: es configuracion del producto,
// no un dato de nadie. Se puede leer, discutir y deshacer con git.
const ARCHIVO = process.env.MR_RECORTES_ARCHIVO ||
  path.join(__dirname, "recortes-previsualizacion.json");

function vacio() {
  return { ladoSalida: LADO_SALIDA, maniqui: "plano", cuadros: {} };
}

// ------------------------------------------------------------------
// VALIDAR
// ------------------------------------------------------------------

// Devuelve null si el cuadro vale, o el motivo si no. Un motivo y no un
// booleano, porque quien guarda desde la herramienta necesita saber que
// arreglar.
function problemaDeCuadro(c) {
  if (!c || typeof c !== "object") return "no es un cuadro";
  for (const k of ["x", "y", "lado"]) {
    if (!Number.isInteger(c[k])) return k + " tiene que ser un entero";
  }
  if (c.x < 0 || c.y < 0) return "se sale por arriba o por la izquierda";
  if (c.lado < LADO_MINIMO) return "es demasiado pequeño (minimo " + LADO_MINIMO + ")";
  if (c.lado > LADO_MAXIMO) return "es mas grande que el lienzo (maximo " + LADO_MAXIMO + ")";
  if (c.x + c.lado > LIENZO_ANCHO) return "se sale por la derecha";
  if (c.y + c.lado > LIENZO_ALTO) return "se sale por abajo";
  return null;
}

// Revisa el archivo entero. Devuelve la lista de problemas, vacia si esta
// bien. Los modelos no se validan contra una lista fija a proposito: si
// el equipo de arte sube uno nuevo, tiene que poder recortarse sin tocar
// este codigo.
function problemasDe(config) {
  const problemas = [];
  if (!config || typeof config !== "object") return ["no es una configuracion"];
  if (!Number.isInteger(config.ladoSalida) || config.ladoSalida < 16 || config.ladoSalida > 512) {
    problemas.push("ladoSalida tiene que ser un entero entre 16 y 512");
  }
  if (!MANIQUIES.includes(config.maniqui)) {
    problemas.push("maniqui tiene que ser " + MANIQUIES.join(" o "));
  }
  if (!config.cuadros || typeof config.cuadros !== "object") {
    problemas.push("faltan los cuadros");
    return problemas;
  }
  for (const [modelo, porCapa] of Object.entries(config.cuadros)) {
    if (!/^[a-z0-9_]{1,40}$/.test(modelo)) { problemas.push("modelo con nombre raro: " + modelo); continue; }
    for (const [capa, cuadro] of Object.entries(porCapa || {})) {
      if (!CAPAS.includes(capa)) { problemas.push(modelo + ": capa desconocida " + capa); continue; }
      const p = problemaDeCuadro(cuadro);
      if (p) problemas.push(modelo + "/" + capa + ": " + p);
    }
  }
  return problemas;
}

// ------------------------------------------------------------------
// LEER Y ESCRIBIR
// ------------------------------------------------------------------

function leer(archivo) {
  const ruta = archivo || ARCHIVO;
  let texto;
  try {
    texto = fs.readFileSync(ruta, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return vacio();
    throw error;
  }
  const config = JSON.parse(texto);
  // Lo que falte se completa con lo de por defecto: un archivo viejo sin
  // "maniqui" sigue valiendo.
  return Object.assign(vacio(), config, { cuadros: config.cuadros || {} });
}

// Escribe solo si todo el archivo vale, y por un nombre temporal que se
// renombra al final: un corte a mitad no puede dejar la configuracion de
// las 768 previsualizaciones a medias.
function escribir(config, archivo) {
  const problemas = problemasDe(config);
  if (problemas.length) {
    const error = new Error("Configuracion de recortes invalida: " + problemas.join("; "));
    error.problemas = problemas;
    throw error;
  }

  // Ordenado, para que el diff de git se lea: un cambio en la boca de tora
  // tiene que verse como una linea, no como el archivo entero movido.
  const ordenado = { ladoSalida: config.ladoSalida, maniqui: config.maniqui, cuadros: {} };
  for (const modelo of Object.keys(config.cuadros).sort()) {
    ordenado.cuadros[modelo] = {};
    const porCapa = config.cuadros[modelo];
    for (const capa of CAPAS) {
      if (porCapa[capa]) {
        const { x, y, lado } = porCapa[capa];
        ordenado.cuadros[modelo][capa] = { x, y, lado };
      }
    }
  }

  const ruta = archivo || ARCHIVO;
  const temporal = ruta + "." + process.pid + ".tmp";
  fs.writeFileSync(temporal, JSON.stringify(ordenado, null, 2) + "\n");
  fs.renameSync(temporal, ruta);
  return ordenado;
}

function cuadroDe(config, modelo, capa) {
  const c = config && config.cuadros && config.cuadros[modelo] && config.cuadros[modelo][capa];
  return c && !problemaDeCuadro(c) ? { x: c.x, y: c.y, lado: c.lado } : null;
}

// ------------------------------------------------------------------
// EL CUADRO AUTOMATICO
// ------------------------------------------------------------------

// La caja de una prenda con la que se calcula su cuadro: solo lo que se
// ve bien, y sin puntos sueltos. El arte trae a veces restos casi
// invisibles o algun punto lejos del dibujo -dos pelos de Naruto los
// tenian por todo el lienzo- y con ellos la prenda salia diminuta en
// medio de un cuadro enorme. Medido sobre las 768 el 24/09/2026: cambian
// 24, todas a mejor. Si no queda nada que se vea bien, cuenta todo.
const ALFA_VISIBLE = 64;
const PUNTOS_SUELTOS = 0.005;

function cajaParaCuadro(img) {
  return compositor.cajaDibujada(img, { alfaMinimo: ALFA_VISIBLE, recorte: PUNTOS_SUELTOS }) ||
    compositor.cajaDibujada(img);
}

// El de UNA prenda: el menor cuadrado que contiene su dibujo, con margen,
// centrado en el y empujado dentro del lienzo si se sale.
//
// Nunca mas chico que LADO_SALIDA. Una prenda diminuta, un pendiente, no
// se amplia por encima de su tamaño real, que se veria borrosa; y asi las
// pequeñas de una misma capa salen todas a la misma escala.
//
// Si no cabe entera -un fondo, la piel, una melena de cuerpo entero- se
// ve su parte de ARRIBA: es la que la reconoce. De un pelo, la cabeza, no
// las puntas.
function cuadroAutomatico(caja, margen) {
  const m = margen === undefined ? 10 : margen;
  if (!caja) return { x: 0, y: 0, lado: LADO_MAXIMO };

  const lado = Math.max(LADO_SALIDA,
    Math.min(LADO_MAXIMO, Math.max(caja.ancho, caja.alto) + 2 * m));
  const cabe = caja.alto + 2 * m <= lado;
  const cx = caja.x + caja.ancho / 2;
  const y = cabe ? caja.y + caja.alto / 2 - lado / 2 : caja.y - m;
  return {
    x: Math.max(0, Math.min(LIENZO_ANCHO - lado, Math.round(cx - lado / 2))),
    y: Math.max(0, Math.min(LIENZO_ALTO - lado, Math.round(y))),
    lado
  };
}

// El cuadro con el que se dibuja una prenda. Es el UNICO sitio que lo
// decide, de lo mas concreto a lo mas general:
//   1. el de esa prenda sola. Todavia no existe; cuando exista, va aqui,
//      antes que nada.
//   2. el que se fijo para toda su capa en su modelo, con la herramienta.
//   3. el automatico, alrededor de su propio dibujo.
// `prenda` es { modelo, capa, caja }, con la caja de cajaParaCuadro.
function cuadroParaPrenda(config, prenda) {
  return cuadroDe(config, prenda.modelo, prenda.capa) || cuadroAutomatico(prenda.caja);
}

// Cuantas de estas cajas se salen de un cuadro. Es lo que la herramienta
// enseña en vivo mientras se mueve: la pregunta "¿le sirve a todas?".
function cuantasSeSalen(cajas, cuadro) {
  return (cajas || []).filter(c => c && (
    c.x < cuadro.x || c.y < cuadro.y ||
    c.x + c.ancho > cuadro.x + cuadro.lado ||
    c.y + c.alto > cuadro.y + cuadro.lado
  )).length;
}

module.exports = {
  LIENZO_ANCHO,
  LIENZO_ALTO,
  LADO_MAXIMO,
  LADO_MINIMO,
  LADO_SALIDA,
  MANIQUIES,
  COLOR_MANIQUI,
  ARCHIVO,
  vacio,
  problemaDeCuadro,
  problemasDe,
  leer,
  escribir,
  cuadroDe,
  cajaParaCuadro,
  cuadroAutomatico,
  cuadroParaPrenda,
  cuantasSeSalen
};

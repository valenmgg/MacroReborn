// ==============================
// LOS CUADROS DE LAS PREVISUALIZACIONES — api/_recortes.js
// ==============================
// Una previsualizacion es la prenda puesta sobre un maniqui y recortada
// a un cuadro fijo, como en el inventario de un videojuego: todas las
// bocas de un modelo en el mismo sitio, todas sus camisas en el mismo.
// Fase 4 de docs/AVATARES-SERVIDOR.md.
//
// LOS CUADROS LOS ELIGE UNA PERSONA, NO ESTE CODIGO. Se calcularon del
// arte el 22/09/2026 y el resultado fue correcto pero no era lo que se
// queria ver, asi que se decidio que los elige quien mira, con la
// herramienta de scripts/herramientas/recortes. Lo que hay en el archivo
// de abajo es lo que alguien decidio; lo que no esta, no se ha decidido.
//
// UN CUADRO POR CAPA Y POR MODELO, no uno por capa. Los seis modelos
// tienen poses muy distintas -fengchao agachado, fenglei con un brazo
// arriba- y la cabeza de cada uno cae en otro sitio, asi que un solo
// cuadro de "boca" no les sirve a los seis. Son 78 combinaciones con
// prendas.
//
// SIEMPRE CUADRADOS, uno a uno. Como el lienzo mide 327x504, el mayor
// cuadrado que cabe es de 327: un fondo o una melena de cuerpo entero
// no caben enteros y la previsualizacion enseña un trozo. Se acepto el
// 23/09/2026 sabiendolo. Macrojuegos tenia la misma limitacion.

const fs = require("fs");
const path = require("path");

const { CAPAS } = require("./_avatar-catalogo");

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
// SUGERIR
// ------------------------------------------------------------------
// Un punto de partida para la herramienta, no una decision: el cuadro
// mas pequeño que cubre el dibujo de todas las prendas de esa capa en ese
// modelo, con margen, y cuadrado. La persona lo mueve desde ahi. No se
// guarda nunca solo: lo que va al archivo es lo que alguien acepto.
function sugerir(cajas, margen) {
  const m = margen === undefined ? 10 : margen;
  const validas = (cajas || []).filter(Boolean);
  if (!validas.length) return { x: 0, y: 0, lado: LADO_MAXIMO };

  const x0 = Math.min(...validas.map(c => c.x));
  const y0 = Math.min(...validas.map(c => c.y));
  const x1 = Math.max(...validas.map(c => c.x + c.ancho));
  const y1 = Math.max(...validas.map(c => c.y + c.alto));

  const lado = Math.max(LADO_MINIMO,
    Math.min(LADO_MAXIMO, Math.max(x1 - x0, y1 - y0) + 2 * m));

  // Centrado sobre el dibujo, y empujado dentro del lienzo si se sale.
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const x = Math.max(0, Math.min(LIENZO_ANCHO - lado, Math.round(cx - lado / 2)));
  const y = Math.max(0, Math.min(LIENZO_ALTO - lado, Math.round(cy - lado / 2)));
  return { x, y, lado };
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
  sugerir,
  cuantasSeSalen
};

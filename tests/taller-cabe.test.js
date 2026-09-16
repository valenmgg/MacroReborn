// ==============================
// NADA SE SALE DE SU COLUMNA — tests/taller-cabe.test.js
// ==============================
// El taller son tres columnas que ruedan en vertical, y eso está bien: lo
// que no se quiere es rodar de lado. Una barra horizontal dentro de una
// columna significa que algo de dentro trajo su propio ancho y no lo
// soltó.
//
// Lo que había, medido:
//
//   · El <input type="file"> del paso 2. Un file mide lo que mide su
//     texto -en español pasa de 350 px- y no se encoge. El rail son 320.
//     Y en esta página no había NADA que estilara los controles: las
//     reglas compartidas cuelgan de .arte-main, que es arte.html.
//   · El dibujo de la comparación, también en el paso 2: dos cajas que
//     sumaban 14+45+18+260+14 = 351 px. Sale justo cuando un archivo no
//     mide el lienzo, que según la historia del panel es casi siempre.
//   · El marco del lienzo, que lleva flex-shrink:0 porque es la caja
//     clavada sobre la que se hace la aritmética, a cualquier zoom por
//     encima de lo que entra en su columna.
//   · Y las pistas de la rejilla, que tienen por mínimo automático el
//     min-content de lo que llevan: cualquiera de los tres las empujaba.
//
// El encogido del lienzo se prueba con números en
// tests/vestidor-geometria.test.js y con el DOM en
// tests/vestidor-pantalla.test.js. Acá se vigila lo que sólo vive en la
// hoja de estilo, que ninguna prueba de jsdom puede ver porque jsdom no
// maqueta.
//
// Correr:  npm test

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const CSS = fs.readFileSync(
  path.join(__dirname, "..", "css", "arte.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// Selector y cuerpo de cada regla. No entiende anidamiento, y no le hace
// falta: un bloque con llaves dentro (@media) no casa, así que las
// envolturas se saltan solas y las reglas de dentro casan una a una.
function reglas() {
  const salida = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(CSS))) {
    salida.push({ selector: m[1].trim().replace(/\s+/g, " "), cuerpo: m[2] });
  }
  return salida;
}

// Todos los valores que las reglas de un selector le dan a una propiedad.
// Se parte por ";" y se compara el nombre entero, en vez de armar una
// expresión regular: así "width" no casa dentro de "max-width".
function busca(sel, prop) {
  const suyas = reglas().filter(x => x.selector.includes(sel));
  assert.ok(suyas.length, "no hay ninguna regla para " + sel);

  const valores = [];
  for (const regla of suyas) {
    for (const trozo of regla.cuerpo.split(";")) {
      const i = trozo.indexOf(":");
      if (i === -1) continue;
      if (trozo.slice(0, i).trim() === prop) valores.push(trozo.slice(i + 1).trim());
    }
  }
  return valores;
}

// ==============================

describe("las columnas mandan sobre lo que llevan dentro", () => {
  // Una pista de rejilla tiene por mínimo automático el min-content de su
  // contenido: "290px" a secas no impide que un select ancho la estire.
  // El 0 de minmax(0, …) es lo que se lo impide.
  test("las tres pistas del panel van con minmax(0, …)", () => {
    const [plantilla] = busca(".vest-panel", "grid-template-columns");
    const pistas = plantilla.match(/minmax\([^)]*\)/g) || [];

    assert.strictEqual(pistas.length, 3, "esperaba tres columnas: " + plantilla);
    for (const p of pistas) {
      assert.match(p, /^minmax\(\s*0\s*,/, "esta pista puede crecer sola: " + p);
    }
    assert.strictEqual(plantilla.replace(/minmax\([^)]*\)/g, "").trim(), "",
      "queda una pista sin topar en: " + plantilla);
  });

  // Si un eje rueda y del otro no se dice nada, el CSS convierte el otro
  // en auto por su cuenta. O sea: barra horizontal en cuanto algo
  // sobresale un píxel, sin que nadie la haya pedido.
  test("ninguna caja del taller rueda en un eje callando el otro", () => {
    const callados = reglas().filter(r => {
      if (!/vest-|taller-/.test(r.selector)) return false;
      if (!/(^|;|\s)overflow-y\s*:\s*(auto|scroll)/.test(r.cuerpo)) return false;
      return !/(^|;|\s)overflow-x\s*:/.test(r.cuerpo);
    });

    assert.deepStrictEqual(callados.map(r => r.selector), [],
      "estas ruedan en vertical y dejan el eje horizontal a lo que salga");
  });
});

describe("lo que traía su propio ancho", () => {
  test("los controles del taller están topados al 100 %", () => {
    assert.ok(busca('.taller-pagina input[type="file"]', "max-width").includes("100%"),
      "el input de archivos es lo más ancho del paso 2 y no se encoge solo");
    assert.ok(busca(".taller-pagina select", "max-width").includes("100%"),
      "un select mide lo que mida su opción más larga");
  });

  test("y la comparación se apila si no caben las dos cajas", () => {
    assert.deepStrictEqual(busca(".taller-comparar", "flex-wrap"), ["wrap"]);
  });

  // Los nombres de archivo no traen espacios donde partir la línea.
  test("los nombres largos parten en vez de estirar", () => {
    assert.ok(busca(".taller-comparar figcaption", "overflow-wrap").includes("anywhere"));
  });
});

// ==============================
// NINGUNA PRUEBA ESCRIBE EN datos-locales/ — tests/aislar-datos.test.js
// ==============================
// Toda prueba que cargue algo de api/ o de scripts/ tiene que cargar
// antes tests/_aislar-datos.js. Allí está el porqué: sin eso, guardar
// un avatar en una prueba reescribe el de una cuenta de verdad en la
// copia local.
//
// Correr:  npm test

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

test("toda prueba que carga la API aísla antes sus carpetas de datos", () => {
  const faltan = [];
  for (const archivo of fs.readdirSync(__dirname).filter(f => f.endsWith(".test.js"))) {
    const texto = fs.readFileSync(path.join(__dirname, archivo), "utf8");
    const primero = texto.search(/require\(["']\.\.\/(api|scripts)\//);
    if (primero === -1) continue;
    const aislar = texto.search(/require\(["']\.\/_aislar-datos["']\)/);
    if (aislar === -1 || aislar > primero) faltan.push(archivo);
  }
  assert.deepStrictEqual(faltan, [],
    "estas pruebas cargan la API sin require(\"./_aislar-datos\") delante");
});

test("y con eso, los módulos que escriben lo hacen fuera de datos-locales", () => {
  // En otro proceso: aquí los módulos ya podrían estar cargados.
  const salida = execFileSync(process.execPath, ["-e", `
    require("./tests/_aislar-datos");
    const compuestos = require("./api/_avatar-compuesto").DIRECTORIO;
    const previas = require("./api/_previsualizaciones").DIRECTORIO;
    console.log(JSON.stringify([compuestos, previas]));
  `], { cwd: path.join(__dirname, ".."), encoding: "utf8" });

  for (const carpeta of JSON.parse(salida)) {
    assert.ok(!/datos-locales/.test(carpeta), "sigue escribiendo en " + carpeta);
  }
});

// ==============================
// LAS PRUEBAS NO ESCRIBEN EN datos-locales/ — tests/_aislar-datos.js
// ==============================
// Las pruebas que pasan por la API usan los módulos de verdad, y esos
// escriben en disco: los avatares compuestos (api/_avatar-compuesto.js)
// y las previsualizaciones (api/_previsualizaciones.js). Sin decirles
// otra cosa lo hacen en datos-locales/, que es donde vive la copia
// local de producción.
//
// Pasó el 24/09/2026: una tanda de pruebas reescribió el avatar
// compuesto de siete cuentas de la copia local con los cuadrados de
// colores de las pruebas. Las ids de la base de pruebas (1, 7, 9, 10,
// 11, 12 y 18) son también cuentas de verdad. El servidor local las
// enseñaba así, y parecía un fallo del compositor.
//
// Esto manda las dos carpetas a una temporal, propia de cada archivo de
// pruebas, y la borra al terminar. Va antes de cualquier require de
// api/ o de scripts/, porque los módulos leen su carpeta al cargarse.
// Una prueba que quiera mirar esos archivos puede fijar la suya después
// de esto. tests/aislar-datos.test.js comprueba que ninguna lo olvide.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const base = fs.mkdtempSync(path.join(os.tmpdir(), "mr-pruebas-"));
process.env.MR_AVATARES_DIR = path.join(base, "avatares-compuestos");
process.env.MR_PREVISUALIZACIONES_DIR = path.join(base, "previsualizaciones");

process.on("exit", () => {
  try { fs.rmSync(base, { recursive: true, force: true }); } catch (_) { /* es temporal */ }
});

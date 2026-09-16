// ==============================
// LA PUERTA DEL TALLER — tests/taller-puerta.test.js
// ==============================
// El taller lleva a la gente por seis pasos y no deja llegar a publicar
// sin haber resuelto los anteriores. Acá se prueba esa puerta, y la
// propuesta de nombre, que son las dos piezas que atacan los fallos que
// de verdad ocurrieron.
//
// Lo que ocurrió, para que se entienda qué defiende cada prueba: de las
// CINCO prendas subidas por el panel en toda su historia, las cinco
// venían con el lienzo equivocado y hubo que retirar las cinco. Y se
// publicaron con el nombre del archivo: "teto", "pearto", "Pearto",
// "Mascara MR." y "Captura de pantalla 2026 09 15 113043".
//
// Se recorta la ZONA A de js/arte-vestidor.js y se evalúa en un vm sin
// navegador, igual que tests/vestidor-geometria.test.js.
//
// Correr:  npm test

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FUENTE = fs.readFileSync(path.join(__dirname, "..", "js", "arte-vestidor.js"), "utf8");

const EXPORTA = `;({
  esDeMaquina: vestNombreEsDeMaquina,
  desdeArchivo: vestNombreDesdeArchivo,
  siguiente: vestSiguienteNombre,
  propuesto: vestNombrePropuesto,
  estado: vestEstadoDePrenda,
  resuelto: vestPasoResuelto,
  falta: vestQueFalta,
  resumen: vestResumenDeCola,
  PASOS: VEST_PASOS
})`;

function zonaA() {
  const i = FUENTE.indexOf("const VEST_LIENZO_ANCHO");
  const j = FUENTE.indexOf("// ZONA B — LA PANTALLA");
  assert.ok(i !== -1 && j !== -1, "no se encontró la ZONA A en js/arte-vestidor.js");
  const contexto = { console: { warn() {}, error() {}, log() {} } };
  vm.createContext(contexto);
  return vm.runInContext(FUENTE.slice(i, j) + EXPORTA, contexto);
}

const V = zonaA();

// Un objeto nacido en el vm tiene otro Object.prototype; ver la misma
// nota en tests/vestidor-geometria.test.js.
const plano = o => (o && typeof o === "object" ? Object.assign({}, o) : o);
const igual = (a, b, m) => assert.deepStrictEqual(plano(a), b, m);

// Una prenda como la que arma js/arte.js al elegir un archivo.
function prenda(extra) {
  return Object.assign({
    clave: "k1", archivo: "gorro_rojo.png", dataUrl: "data:image/png;base64,AAAA",
    ancho: 327, alto: 504, modelo: "tora", capa: "accesorio",
    nombre: "Gorro rojo", precio: 0, ajuste: null
  }, extra || {});
}

// ==============================

describe("el nombre que propone la herramienta", () => {
  test("si el archivo ya trae un nombre bueno, se respeta", () => {
    assert.strictEqual(V.propuesto("gorro_rojo.png", "accesorio", []), "Gorro rojo");
    assert.strictEqual(V.propuesto("botas-de-nieve.png", "botas", []), "Botas de nieve");
  });

  // El caso real: el último que se publicó se llamaba así.
  test("pero el nombre que pone el teléfono, no", () => {
    assert.strictEqual(
      V.propuesto("Captura de pantalla 2026 09 15 113043.png", "fondo", []),
      "Fondo 1");
  });

  test("y tampoco lo que ponen la cámara o el programa de dibujo", () => {
    for (const malo of ["IMG_2049", "image12", "screenshot", "WhatsApp Image 2026",
                        "Sin título", "untitled", "20260915", "0038"]) {
      assert.strictEqual(V.esDeMaquina(malo), true, malo + " tendría que caer");
    }
  });

  // El detector caza lo que nombró una MÁQUINA, no lo que nombró mal una
  // persona. "teto" y "pearto" son dos de los cinco nombres reales del
  // catálogo y son raros, pero alguien los eligió: no es cosa de la
  // herramienta corregir el gusto de nadie.
  test("y no se mete con los nombres raros que eligió una persona", () => {
    for (const bueno of ["teto", "pearto", "Mascara MR.", "Gorro rojo", "Pelo largo"]) {
      assert.strictEqual(V.esDeMaquina(bueno), false, bueno + " no tendría que caer");
    }
  });

  test("el número propuesto salta los que ya están tomados", () => {
    assert.strictEqual(V.siguiente("accesorio", []), "Accesorio 1");
    assert.strictEqual(V.siguiente("accesorio", ["Accesorio 1", "Accesorio 2"]), "Accesorio 3");
    assert.strictEqual(V.siguiente("accesorio", ["Accesorio 1", "Accesorio 3"]), "Accesorio 2");
    // Mayúsculas y nombres que no son de la serie no estorban.
    assert.strictEqual(V.siguiente("pelo", ["pelo 1", "Coletas", "Pelo 2"]), "Pelo 3");
  });
});

describe("las tres marcas de una prenda", () => {
  test("una bien dibujada y bien fichada las tiene las tres", () => {
    igual(V.estado(prenda()), { medida: "ok", ficha: "ok", colocada: "ok" });
  });

  test("una que no mide el lienzo empieza con dos por resolver", () => {
    const e = V.estado(prenda({ ancho: 1919, alto: 1079 }));
    assert.strictEqual(e.medida, "revisar");
    assert.strictEqual(e.colocada, "revisar", "hay que decidir qué hacer con ella");
  });

  test("y se resuelve llevándola al lienzo", () => {
    const e = V.estado(prenda({ ancho: 1919, alto: 1079,
      ajuste: { dx: 0, dy: 0, escala: 100, espejo: false, alLienzo: true } }));
    assert.strictEqual(e.colocada, "ok");
  });

  // La segunda salida, que en la pantalla es un enlace pequeño debajo del
  // botón grande: publicarla tal cual. No se bloquea, pero hay que
  // decirlo a propósito.
  test("o diciendo a propósito que se publique tal cual", () => {
    const e = V.estado(prenda({ ancho: 1919, alto: 1079, talCual: true }));
    assert.strictEqual(e.colocada, "ok");
  });

  test("sin ranura no está fichada", () => {
    assert.strictEqual(V.estado(prenda({ capa: null })).ficha, "revisar");
  });

  test("con el nombre del archivo tampoco", () => {
    assert.strictEqual(
      V.estado(prenda({ nombre: "Captura de pantalla 2026 09 15 113043" })).ficha,
      "revisar");
  });

  test("y un PNG que no se pudo leer se marca roto, no ok", () => {
    const e = V.estado(prenda({ ancho: 0, alto: 0 }));
    assert.strictEqual(e.medida, "rota");
    assert.strictEqual(e.colocada, "rota");
  });
});

describe("no se llega a publicar saltándose nada", () => {
  test("traer no pasa con la cola vacía", () => {
    assert.strictEqual(V.resuelto([], "traer"), false);
    assert.strictEqual(V.resuelto([prenda()], "traer"), true);
  });

  test("fichar no pasa si a una le falta la ranura", () => {
    const cola = [prenda(), prenda({ clave: "k2", capa: null })];
    assert.strictEqual(V.resuelto(cola, "fichar"), false);
    assert.match(V.falta(cola, "fichar"), /1 prenda sin fichar/);
  });

  test("colocar no pasa si una descuadrada sigue sin decidirse", () => {
    const cola = [prenda(), prenda({ clave: "k2", ancho: 903, alto: 691 })];
    assert.strictEqual(V.resuelto(cola, "colocar"), false);
    assert.match(V.falta(cola, "colocar"), /1 prenda sin decidir/);
  });

  test("probar sólo pasa cuando se confirma a mano", () => {
    const cola = [prenda()];
    assert.strictEqual(V.resuelto(cola, "probar", false), false);
    assert.strictEqual(V.resuelto(cola, "probar", true), true);
  });

  // Lo que hace que el taller sea llevadero con cuarenta prendas: si
  // están bien dibujadas, las tres marcas se ponen solas y cada paso se
  // despacha en un clic. Obliga a MIRAR, no a teclear.
  test("pero cuarenta bien dibujadas pasan todos los pasos sin tocar nada", () => {
    const cola = [];
    for (let i = 0; i < 40; i++) {
      cola.push(prenda({ clave: "k" + i, archivo: "gorro_" + i + ".png", nombre: "Gorro " + (i + 1) }));
    }
    for (const paso of ["traer", "fichar", "colocar"]) {
      assert.strictEqual(V.resuelto(cola, paso), true, paso + " se atascó");
      assert.strictEqual(V.falta(cola, paso), "");
    }
  });

  test("y el botón apagado siempre dice por qué lo está", () => {
    assert.match(V.falta([], "traer"), /al menos un dibujo/);
    assert.match(V.falta([prenda()], "probar", false), /confirmá/);
    assert.strictEqual(V.falta([prenda()], "personaje"), "");
  });
});

describe("el recuento de la cola", () => {
  test("cuenta lo que mide, lo que no y lo que se va a hornear", () => {
    const cola = [
      prenda(),
      prenda({ clave: "k2", ancho: 327, alto: 505,
        ajuste: { dx: 0, dy: 0, escala: 100, espejo: false, alLienzo: true } }),
      prenda({ clave: "k3", ancho: 0, alto: 0 })
    ];
    const r = V.resumen(cola);
    assert.strictEqual(r.total, 3);
    assert.strictEqual(r.miden, 1);
    assert.strictEqual(r.descuadradas, 1);
    assert.strictEqual(r.rotas, 1);
    assert.strictEqual(r.seHornean, 1, "sólo la que lleva alLienzo");
    assert.strictEqual(r.sePublican, 2);
  });
});

describe("los seis pasos están declarados en orden", () => {
  test("y son los que dice el diseño", () => {
    assert.deepStrictEqual([...V.PASOS],
      ["personaje", "traer", "fichar", "colocar", "probar", "publicar"]);
  });
});

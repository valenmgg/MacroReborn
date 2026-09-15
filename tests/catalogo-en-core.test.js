// ==============================
// TESTS DEL CATÁLOGO EN core.js — tests/catalogo-en-core.test.js
// ==============================
// rutaCapaAvatar() es por donde pasan los ocho archivos del frontend que
// dibujan avatares. Si devuelve la URL del catálogo, la lleva la huella
// del contenido y se cachea un año; si devuelve la ruta de siempre,
// server.js la resuelve contra la base y se revalida cada 5 minutos.
//
// Lo delicado no es el camino bueno, es el respaldo. El catálogo SOLO
// trae las prendas publicadas, así que una prenda retirada no aparece
// ahí. Si en ese caso rutaCapaAvatar devolviera null, a quien la lleva
// puesta se le caería esa capa del avatar sin haber hecho nada. Retirar
// una prenda la saca del editor, no de la gente.
//
// Se lee la función real de js/core.js, no una copia.
//
// Correr:  npm test

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FUENTE = fs.readFileSync(path.join(__dirname, "..", "js", "core.js"), "utf8");

const HUELLA_PELO = "1".repeat(64);
const HUELLA_TORA = "2".repeat(64);

const CATALOGO = {
  success: true,
  version: 7,
  modelos: [{ valor: "tora", url: "/prendas/" + HUELLA_TORA + ".png" }],
  prendas: [{ valor: "tora_pelo3", url: "/prendas/" + HUELLA_PELO + ".png" }]
};

// Levanta el trozo de core.js que va del mapa a avatarMiniaturaHTML,
// con un fetch de mentira que se puede controlar desde fuera.
function montar(respuesta) {
  const i = FUENTE.indexOf("const RUTAS_DE_PRENDA");
  const j = FUENTE.indexOf("function avatarMiniaturaHTML");
  assert.ok(i !== -1 && j !== -1, "no se encontró el bloque en js/core.js");

  const avisos = [];
  const contexto = {
    console: { warn: (...a) => avisos.push(a.join(" ")), error() {}, log() {} },
    fetch: () => respuesta()
  };
  vm.createContext(contexto);

  const api = vm.runInContext(
    FUENTE.slice(i, j) +
    "\n;({ ruta: rutaCapaAvatar, cargar: cargarCatalogoAvatares, mapa: RUTAS_DE_PRENDA })",
    contexto
  );

  return { ...api, avisos };
}

const respuestaBuena = () => Promise.resolve({ ok: true, json: () => Promise.resolve(CATALOGO) });

describe("antes de que llegue el catálogo", () => {
  test("una prenda sale por la ruta de siempre", () => {
    // Se monta sin resolver la promesa: el mapa está vacío.
    const { ruta } = montar(() => new Promise(() => {}));

    assert.equal(ruta("tora_pelo3"), "imagenes/tora/pelo3.png");
  });

  test("un modelo también, que vive en la raíz", () => {
    const { ruta } = montar(() => new Promise(() => {}));

    assert.equal(ruta("tora"), "imagenes/tora.png");
  });
});

describe("con el catálogo cargado", () => {
  test("una prenda publicada sale por su URL con huella", async () => {
    const { ruta, cargar } = montar(respuestaBuena);
    await cargar();

    assert.equal(ruta("tora_pelo3"), "/prendas/" + HUELLA_PELO + ".png");
  });

  test("un modelo también", async () => {
    const { ruta, cargar } = montar(respuestaBuena);
    await cargar();

    assert.equal(ruta("tora"), "/prendas/" + HUELLA_TORA + ".png");
  });

  test("solo se pide una vez aunque se llame varias", async () => {
    let veces = 0;
    const { cargar } = montar(() => { veces++; return respuestaBuena(); });

    await Promise.all([cargar(), cargar(), cargar()]);

    // Una la hace el propio core.js al cargarse.
    assert.equal(veces, 1);
  });
});

describe("derecho adquirido: lo retirado se sigue viendo", () => {
  test("una prenda que NO está en el catálogo cae a la ruta de siempre", async () => {
    const { ruta, cargar } = montar(respuestaBuena);
    await cargar();

    // No está en CATALOGO: es una prenda retirada que alguien lleva.
    assert.equal(ruta("cereza_piel4"), "imagenes/cereza/piel4.png");
  });

  test("y no devuelve null, que es lo que borraría la capa", async () => {
    const { ruta, cargar } = montar(respuestaBuena);
    await cargar();

    assert.notEqual(ruta("cereza_piel4"), null);
  });
});

describe("una capa vacía no dibuja nada", () => {
  test("ninguno", () => {
    const { ruta } = montar(() => new Promise(() => {}));
    assert.equal(ruta("ninguno"), null);
  });

  test("cadena vacía", () => {
    const { ruta } = montar(() => new Promise(() => {}));
    assert.equal(ruta(""), null);
  });

  test("undefined", () => {
    const { ruta } = montar(() => new Promise(() => {}));
    assert.equal(ruta(undefined), null);
  });
});

describe("si el catálogo no se puede cargar, nadie se queda sin avatar", () => {
  test("con un error HTTP se sigue dibujando por la ruta de siempre", async () => {
    const { ruta, cargar, avisos } = montar(() => Promise.resolve({ ok: false, status: 500 }));
    await cargar();

    assert.equal(ruta("tora_pelo3"), "imagenes/tora/pelo3.png");
    assert.ok(avisos.some(a => a.includes("catálogo")), "debería avisar en consola");
  });

  test("con la red caída tampoco revienta", async () => {
    const { ruta, cargar } = montar(() => Promise.reject(new Error("sin red")));

    assert.equal(await cargar(), null);
    assert.equal(ruta("tora_pelo3"), "imagenes/tora/pelo3.png");
  });

  test("si la respuesta viene sin success se trata como fallo", async () => {
    const { ruta, cargar } = montar(
      () => Promise.resolve({ ok: true, json: () => Promise.resolve({ success: false }) })
    );
    await cargar();

    assert.equal(ruta("tora_pelo3"), "imagenes/tora/pelo3.png");
  });
});

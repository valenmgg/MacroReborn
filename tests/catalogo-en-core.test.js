// ==============================
// TESTS DEL CATÁLOGO EN core.js — tests/catalogo-en-core.test.js
// ==============================
// rutaCapaAvatar() es por donde pasan los ocho archivos del frontend que
// dibujan avatares. Si devuelve la URL del catálogo, la lleva la huella
// del contenido y se cachea un año; si devuelve la ruta de siempre,
// server.js la resuelve contra la base y se revalida cada 5 minutos.
//
// Lo delicado no es el camino bueno, es el respaldo, y hay que separar
// DOS casos que antes se trataban igual:
//
//   - Una prenda RETIRADA. Alguien la lleva puesta y se le tiene que
//     seguir dibujando: retirar una prenda la saca del editor, no de la
//     gente. Desde d54251f el servidor la manda en "retiradas" con su
//     URL con huella, así que entra en el mapa como cualquier otra.
//
//   - Un valor COLGANDO: no está en ninguna fila de avatar_prendas.
//     Acá no hay nada que dibujar, y adivinarle una ruta solo consigue
//     un 404. Un 404 en una <img> no deja un hueco: el navegador pinta
//     su marca de "imagen no encontrada" encima del avatar.
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
const HUELLA_RETIRADA = "3".repeat(64);

const CATALOGO = {
  success: true,
  version: 7,
  modelos: [{ valor: "tora", url: "/prendas/" + HUELLA_TORA + ".png" }],
  prendas: [{ valor: "tora_pelo3", url: "/prendas/" + HUELLA_PELO + ".png" }],
  retiradas: [{ valor: "cereza_piel4", url: "/prendas/" + HUELLA_RETIRADA + ".png" }]
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
  test("una retirada sale por su URL con huella, igual que una publicada", async () => {
    const { ruta, cargar } = montar(respuestaBuena);
    await cargar();

    assert.equal(ruta("cereza_piel4"), "/prendas/" + HUELLA_RETIRADA + ".png");
  });

  test("y no devuelve null, que es lo que borraría la capa", async () => {
    const { ruta, cargar } = montar(respuestaBuena);
    await cargar();

    assert.notEqual(ruta("cereza_piel4"), null);
  });

  // Este test es el que sujeta el arreglo por el lado peligroso: si
  // alguien quita "retiradas" del servidor o del mapa, las retiradas
  // pasan a ser valores colgando y desaparecen de golpe de los avatares
  // de quien las lleva. Antes eso no se notaba porque TODO caía a la
  // ruta inventada.
  test("si el catálogo llega SIN la lista de retiradas, se nota acá", async () => {
    const sinRetiradas = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ...CATALOGO, retiradas: [] })
    });
    const { ruta, cargar } = montar(sinRetiradas);
    await cargar();

    assert.equal(ruta("cereza_piel4"), null);
  });
});

// ------------------------------------------------------------------
// LO QUE ESTÁ COLGANDO
// ------------------------------------------------------------------
// "tora_piel7" es real: lo llevan puesto cinco veces -tres cuentas y dos
// casilleros de galería- y no tiene fila en avatar_prendas ni fichero en
// imagenes/. Antes rutaCapaAvatar le inventaba "imagenes/tora/piel7.png"
// y las cinco veces salía la marca de imagen rota encima del avatar.
describe("un valor colgando no deja la marca de imagen rota", () => {
  test("con el catálogo cargado y sin rastro del valor, no hay ruta", async () => {
    const { ruta, cargar } = montar(respuestaBuena);
    await cargar();

    assert.equal(ruta("tora_piel7"), null);
  });

  test("y en concreto ya no se inventa imagenes/<modelo>/<resto>.png", async () => {
    const { ruta, cargar } = montar(respuestaBuena);
    await cargar();

    assert.notEqual(ruta("tora_piel7"), "imagenes/tora/piel7.png");
  });

  // Los dos que siguen son el límite del arreglo, y son los que impiden
  // que "devolver null" se coma avatares enteros: sin catálogo en la
  // mano no se puede saber si un valor cuelga o no, así que se dibuja.
  test("pero sin catálogo todavía se sigue dibujando por la ruta de siempre", () => {
    const { ruta } = montar(() => new Promise(() => {}));

    assert.equal(ruta("tora_piel7"), "imagenes/tora/piel7.png");
  });

  test("y si el catálogo no llega nunca, tampoco se borra nada", async () => {
    const { ruta, cargar } = montar(() => Promise.reject(new Error("red caída")));
    await cargar();

    assert.equal(ruta("tora_piel7"), "imagenes/tora/piel7.png");
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

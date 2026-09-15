// ==============================
// TESTS DE LA PÁGINA DEL PANEL DE ARTE — tests/arte-pagina.test.js
// ==============================
// Complementan a tests/avatar-panel.test.js, que prueba las rutas. Esto
// prueba la pantalla: se carga arte.html de verdad en jsdom y se ejecuta
// js/arte.js tal cual está en el disco, con el servidor simulado.
//
// Se hace así por lo que pasó con el editor de avatares: el fallo no
// estuvo en el backend, que tenía tests, sino en la pantalla, que no
// tenía ninguno.
//
// Lo que se prueba acá:
//   - Sin sesión y sin rol, la página echa a la portada sin enseñar nada.
//   - Con rol, se pintan los controles y el catálogo.
//   - Los filtros hacen lo que dicen.
//   - El botón de retirar solo aparece donde se puede usar.
//   - Retirar llama al servidor y refleja el cambio.
//   - Los nombres de prenda se pintan como texto, nunca como HTML.
//
// Correr:  npm test

const { test, before, describe, beforeEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const RAIZ = path.join(__dirname, "..");
const HTML = fs.readFileSync(path.join(RAIZ, "arte.html"), "utf8");
const FUENTE = fs.readFileSync(path.join(RAIZ, "js", "arte.js"), "utf8");

function panelDePrueba(extra) {
  return Object.assign({
    success: true,
    capas: ["fondo", "espalda", "piel", "ojos", "boca", "botas", "pantalon",
            "remera", "guantes", "accesorio", "cara", "pelo", "mascota", "borde"],
    modelos: [
      { id: 1, valor: "tora", modelo: "tora", capa: "modelo", nombre: "Tora", url: "/prendas/aaa.png", medidas: "327x504", peso: 1200, publicada: true, autor: null, precio: null },
      { id: 2, valor: "cereza", modelo: "cereza", capa: "modelo", nombre: "Cereza", url: "/prendas/bbb.png", medidas: "327x504", peso: 1200, publicada: true, autor: null, precio: null }
    ],
    prendas: [
      { id: 10, valor: "tora_botas1", modelo: "tora", capa: "botas", nombre: "Botas de combate", url: "/prendas/ccc.png", medidas: "327x504", peso: 8000, publicada: true, autor: "dibujante", precio: 140 },
      { id: 11, valor: "tora_pelo1", modelo: "tora", capa: "pelo", nombre: "Pelo largo", url: "/prendas/ddd.png", medidas: "327x504", peso: 9000, publicada: true, autor: "otra", precio: null },
      { id: 12, valor: "cereza_boca9", modelo: "cereza", capa: "boca", nombre: "Boca recuperada", url: "/prendas/eee.png", medidas: "332x512", peso: 4000, publicada: false, autor: null, precio: null }
    ],
    esAdmin: false,
    yo: "dibujante"
  }, extra || {});
}

// Monta la página con un servidor simulado. Devuelve el documento y el
// registro de las llamadas que hizo, para poder comprobarlas.
async function montar(respuestas) {
  // jsdom no navega de verdad, pero avisa cuando alguien lo intenta. Es
  // lo que permite comprobar que la página echa a quien no debe entrar.
  const navegaciones = [];
  const consola = new VirtualConsole();
  consola.on("jsdomError", e => {
    if (/navigation/i.test(String(e && e.message))) navegaciones.push(String(e.message));
  });

  const dom = new JSDOM(HTML, {
    url: "https://macroreborn.com/arte.html",
    runScripts: "outside-only",
    virtualConsole: consola
  });

  const llamadas = [];
  dom.window.fetch = (url, opciones) => {
    llamadas.push({ url: String(url), opciones: opciones || {} });
    const responder = respuestas(String(url), opciones || {});
    return Promise.resolve(responder);
  };
  dom.window.confirm = () => true;
  dom.window.alert = () => {};

  dom.window.eval(FUENTE);

  // El panel se pide al cargar; se deja resolver la cadena de promesas.
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));

  return { dom, doc: dom.window.document, llamadas, navegaciones };
}

function respuestaJson(codigo, cuerpo) {
  return { ok: codigo >= 200 && codigo < 300, status: codigo, json: () => Promise.resolve(cuerpo) };
}

const servidorOk = datos => () => respuestaJson(200, datos);

// ==============================

describe("quién ve el panel", () => {
  test("sin sesión, echa a la portada sin enseñar nada", async () => {
    const { doc, navegaciones } = await montar(() => respuestaJson(401, { success: false }));

    assert.equal(navegaciones.length, 1, "debería haber salido de la página");
    assert.equal(doc.getElementById("arteSubir").hidden, true);
    assert.equal(doc.getElementById("arteCatalogo").hidden, true);
  });

  test("sin el rol, lo mismo: ni se explica que la sección existe", async () => {
    // Es una herramienta interna. Un cartel que diga "esto es del equipo
    // de arte" le confirma a cualquiera que existe y dónde está.
    const { doc, navegaciones } = await montar(() => respuestaJson(403, { success: false }));

    assert.equal(navegaciones.length, 1);
    assert.equal(doc.getElementById("arteSubir").hidden, true);
    assert.ok(!/equipo de arte/i.test(doc.getElementById("arteAviso").textContent));
  });

  test("si el servidor falla, avisa y NO echa a nadie", async () => {
    // Un 500 no es un problema de permisos. Redirigir ahí escondería la
    // avería y dejaría a quien sí tiene acceso sin saber qué pasó.
    const { doc, navegaciones } = await montar(() => respuestaJson(500, { success: false }));

    assert.equal(navegaciones.length, 0, "un error del servidor no debe echar a nadie");
    assert.match(doc.getElementById("arteAviso").textContent, /salió mal/i);
    assert.ok(!/Comprobando/i.test(doc.getElementById("arteAviso").textContent));
  });

  test("con el rol, aparecen las dos secciones", async () => {
    const { doc } = await montar(servidorOk(panelDePrueba()));

    assert.equal(doc.getElementById("arteAviso").hidden, true);
    assert.equal(doc.getElementById("arteSubir").hidden, false);
    assert.equal(doc.getElementById("arteCatalogo").hidden, false);
  });
});

describe("los controles se llenan con lo que hay", () => {
  test("los personajes salen del catálogo, no de una lista fija", async () => {
    const { doc } = await montar(servidorOk(panelDePrueba()));

    const opciones = [...doc.getElementById("arteTodosModelo").options].map(o => o.value);
    assert.deepEqual(opciones, ["tora", "cereza"]);
  });

  test("las ranuras tampoco incluyen 'modelo'", async () => {
    // Por ahora solo se añaden prendas a personajes que ya existen.
    const { doc } = await montar(servidorOk(panelDePrueba()));

    const opciones = [...doc.getElementById("arteTodosCapa").options].map(o => o.value);
    assert.ok(!opciones.includes("modelo"));
    assert.ok(opciones.includes("botas"));
  });

  test("sin archivos elegidos no se ofrece subir", async () => {
    const { doc } = await montar(servidorOk(panelDePrueba()));

    assert.equal(doc.getElementById("arteAcciones").hidden, true);
    assert.equal(doc.getElementById("arteComunes").hidden, true);
  });
});

describe("el catálogo", () => {
  test("pinta una tarjeta por prenda y cuenta las apagadas", async () => {
    const { doc } = await montar(servidorOk(panelDePrueba()));

    assert.equal(doc.querySelectorAll(".arte-tarjeta").length, 3);
    assert.match(doc.getElementById("arteCuenta").textContent, /3 prendas/);
    assert.match(doc.getElementById("arteCuenta").textContent, /1 apagadas/);
  });

  test("lo retirado se marca como tal", async () => {
    const { doc } = await montar(servidorOk(panelDePrueba()));

    const retiradas = doc.querySelectorAll(".arte-tarjeta.retirada");
    assert.equal(retiradas.length, 1);
    assert.match(retiradas[0].textContent, /Boca recuperada/);
  });

  test("filtrar por personaje deja solo las suyas", async () => {
    const { doc, dom } = await montar(servidorOk(panelDePrueba()));

    const filtro = doc.getElementById("arteFiltroModelo");
    filtro.value = "cereza";
    filtro.dispatchEvent(new dom.window.Event("change"));

    const tarjetas = doc.querySelectorAll(".arte-tarjeta");
    assert.equal(tarjetas.length, 1);
    assert.match(tarjetas[0].textContent, /Boca recuperada/);
  });

  test("filtrar por retiradas deja solo lo apagado", async () => {
    const { doc, dom } = await montar(servidorOk(panelDePrueba()));

    const filtro = doc.getElementById("arteFiltroEstado");
    filtro.value = "retiradas";
    filtro.dispatchEvent(new dom.window.Event("change"));

    assert.equal(doc.querySelectorAll(".arte-tarjeta").length, 1);
  });

  test("'solo mías' usa la autoría, no el nombre de la prenda", async () => {
    const { doc, dom } = await montar(servidorOk(panelDePrueba()));

    const filtro = doc.getElementById("arteFiltroAutor");
    filtro.value = "mias";
    filtro.dispatchEvent(new dom.window.Event("change"));

    const tarjetas = doc.querySelectorAll(".arte-tarjeta");
    assert.equal(tarjetas.length, 1);
    assert.match(tarjetas[0].textContent, /Botas de combate/);
  });

  test("si no queda nada, lo dice en vez de mostrar el hueco", async () => {
    const { doc, dom } = await montar(servidorOk(panelDePrueba()));

    const filtro = doc.getElementById("arteFiltroCapa");
    filtro.value = "guantes";
    filtro.dispatchEvent(new dom.window.Event("change"));

    assert.equal(doc.querySelectorAll(".arte-tarjeta").length, 0);
    assert.match(doc.getElementById("arteGrid").textContent, /No hay nada/i);
  });
});

describe("quién puede retirar qué", () => {
  test("un artista solo ve el botón en lo suyo", async () => {
    const { doc } = await montar(servidorOk(panelDePrueba()));

    const tarjetas = [...doc.querySelectorAll(".arte-tarjeta")];
    const mia = tarjetas.find(t => /Botas de combate/.test(t.textContent));
    const ajena = tarjetas.find(t => /Pelo largo/.test(t.textContent));
    const sinAutor = tarjetas.find(t => /Boca recuperada/.test(t.textContent));

    assert.ok(mia.querySelector("button"), "debería poder retirar lo suyo");
    assert.equal(ajena.querySelector("button"), null, "lo ajeno no");
    assert.equal(sinAutor.querySelector("button"), null, "lo del catálogo original tampoco");
  });

  test("un administrador ve el botón en todas", async () => {
    const { doc } = await montar(servidorOk(panelDePrueba({ esAdmin: true })));

    const conBoton = [...doc.querySelectorAll(".arte-tarjeta")].filter(t => t.querySelector("button"));
    assert.equal(conBoton.length, 3);
  });

  test("retirar llama al servidor y la tarjeta cambia", async () => {
    const { doc, llamadas } = await montar((url) => {
      if (url.includes("avatar-estado-prenda")) return respuestaJson(200, { success: true });
      return respuestaJson(200, panelDePrueba());
    });

    const mia = [...doc.querySelectorAll(".arte-tarjeta")]
      .find(t => /Botas de combate/.test(t.textContent));
    mia.querySelector("button").click();

    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    const envio = llamadas.find(l => l.url.includes("avatar-estado-prenda"));
    assert.ok(envio, "debería haber llamado al servidor");
    assert.equal(envio.opciones.method, "POST");
    assert.deepEqual(JSON.parse(envio.opciones.body), { id: 10, publicada: false });

    const despues = [...doc.querySelectorAll(".arte-tarjeta")]
      .find(t => /Botas de combate/.test(t.textContent));
    assert.ok(despues.classList.contains("retirada"));
    assert.match(despues.querySelector("button").textContent, /Publicar/);
  });
});

describe("los nombres se pintan como texto", () => {
  test("una prenda con HTML en el nombre no ejecuta nada", async () => {
    // El nombre lo escribe una persona del equipo, y este panel lo abren
    // administradores. Pegarlo como HTML sería el peor sitio donde
    // hacerlo.
    const datos = panelDePrueba();
    datos.prendas[0].nombre = '<img src=x onerror="robar()">Botas';

    const { doc } = await montar(servidorOk(datos));

    const tarjeta = [...doc.querySelectorAll(".arte-tarjeta")]
      .find(t => /onerror/.test(t.textContent));
    assert.ok(tarjeta, "el nombre debería verse tal cual, escapado");
    // Solo las imágenes de la vista previa: el personaje y la prenda.
    assert.equal(tarjeta.querySelectorAll("img").length, 2);
  });
});

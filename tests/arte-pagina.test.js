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
    // La de api/_precios.js, que es la que manda el servidor.
    preciosPorCapa: { boca: 50, cara: 50, accesorio: 60, guantes: 70, ojos: 80, piel: 80, botas: 90,
                      pantalon: 100, remera: 100, pelo: 120, fondo: 130, borde: 150, espalda: 150, mascota: 220 },
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

    assert.ok(mia.querySelector("button.arte-estado"), "debería poder retirar lo suyo");
    assert.equal(ajena.querySelector("button.arte-estado"), null, "lo ajeno no");
    assert.equal(sinAutor.querySelector("button.arte-estado"), null, "lo del catálogo original tampoco");
  });

  test("un administrador ve el botón en todas", async () => {
    const { doc } = await montar(servidorOk(panelDePrueba({ esAdmin: true })));

    const conBoton = [...doc.querySelectorAll(".arte-tarjeta")].filter(t => t.querySelector("button.arte-estado"));
    assert.equal(conBoton.length, 3);
  });

  test("retirar llama al servidor y la tarjeta cambia", async () => {
    const { doc, llamadas } = await montar((url) => {
      if (url.includes("avatar-estado-prenda")) return respuestaJson(200, { success: true });
      return respuestaJson(200, panelDePrueba());
    });

    const mia = [...doc.querySelectorAll(".arte-tarjeta")]
      .find(t => /Botas de combate/.test(t.textContent));
    mia.querySelector("button.arte-estado").click();

    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    const envio = llamadas.find(l => l.url.includes("avatar-estado-prenda"));
    assert.ok(envio, "debería haber llamado al servidor");
    assert.equal(envio.opciones.method, "POST");
    assert.deepEqual(JSON.parse(envio.opciones.body), { id: 10, publicada: false });

    const despues = [...doc.querySelectorAll(".arte-tarjeta")]
      .find(t => /Botas de combate/.test(t.textContent));
    assert.ok(despues.classList.contains("retirada"));
    assert.match(despues.querySelector("button.arte-estado").textContent, /Publicar/);
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

// ==============================
// Elegir archivos, simulado
// ==============================
// jsdom trae FileReader y File, pero no decodifica imágenes: un
// new Image() con un data URL no dispararía nunca onload y la lectura se
// quedaría colgada. Se sustituye por uno que contesta enseguida con unas
// medidas fijas.
function prepararEleccionDeArchivos(dom, ancho, alto) {
  dom.window.Image = class {
    set src(_) {
      this.naturalWidth = ancho;
      this.naturalHeight = alto;
      setTimeout(() => { if (this.onload) this.onload(); }, 0);
    }
  };
}

async function elegir(dom, doc, nombres) {
  const input = doc.getElementById("arteArchivos");
  const archivos = nombres.map(n =>
    new dom.window.File([Buffer.from("png-de-mentira")], n, { type: "image/png" }));

  Object.defineProperty(input, "files", { value: archivos, configurable: true });
  input.dispatchEvent(new dom.window.Event("change"));

  for (let i = 0; i < 12; i++) await new Promise(r => setTimeout(r, 0));
}

describe("a qué personaje va a parar cada archivo", () => {
  test("si el nombre del archivo trae el personaje, se usa ese", async () => {
    // Es el arreglo de un caso real: el desplegable venía con el primero
    // de la lista —"cereza", por orden alfabético— y quien subía una
    // prenda de tora sin fijarse la archivaba en cereza. Después no la
    // encontraba en el editor, porque el editor solo enseña la ropa del
    // personaje que uno lleva puesto.
    const { dom, doc } = await montar(servidorOk(panelDePrueba()));
    prepararEleccionDeArchivos(dom, 327, 504);

    await elegir(dom, doc, ["tora_botas3.png"]);

    const filas = doc.querySelectorAll(".arte-fila");
    assert.equal(filas.length, 1, "debería haber una fila");

    const select = filas[0].querySelector("select");
    assert.equal(select.value, "tora", "debería haber adivinado tora");
  });

  test("si no lo trae, se usa el del desplegable", async () => {
    const { dom, doc } = await montar(servidorOk(panelDePrueba()));
    prepararEleccionDeArchivos(dom, 327, 504);

    doc.getElementById("arteTodosModelo").value = "cereza";
    await elegir(dom, doc, ["fondo7.png"]);

    const select = doc.querySelector(".arte-fila select");
    assert.equal(select.value, "cereza");
  });

  test("la fila dice en voz alta dónde va a acabar", async () => {
    const { dom, doc } = await montar(servidorOk(panelDePrueba()));
    prepararEleccionDeArchivos(dom, 327, 504);

    await elegir(dom, doc, ["tora_botas3.png"]);

    const destino = doc.querySelector(".arte-destino");
    assert.ok(destino, "debería decir el destino");
    assert.match(destino.textContent, /Tora/);
    assert.match(destino.textContent, /Botas/);
  });

  test("también adivina la ranura cuando el nombre lleva personaje delante", async () => {
    const { dom, doc } = await montar(servidorOk(panelDePrueba()));
    prepararEleccionDeArchivos(dom, 327, 504);

    await elegir(dom, doc, ["tora_pelo9.png"]);

    const selects = doc.querySelectorAll(".arte-fila select");
    assert.equal(selects[0].value, "tora");
    assert.equal(selects[1].value, "pelo");
  });

  test("una medida distinta a 327x504 se avisa, pero no se bloquea", async () => {
    const { dom, doc } = await montar(servidorOk(panelDePrueba()));
    prepararEleccionDeArchivos(dom, 500, 500);

    await elegir(dom, doc, ["tora_botas3.png"]);

    const medidas = doc.querySelector(".arte-medidas");
    assert.match(medidas.textContent, /500/);
    assert.ok(medidas.classList.contains("ojo"), "debería quedar resaltada");
    // Y aun así se puede subir: exigir el lienzo quedó para más adelante.
    assert.equal(doc.getElementById("arteAcciones").hidden, false);
  });
});

describe("el precio al subir", () => {
  // Todo lo que se publica se vende en la tienda (docs/TIENDA.md): se
  // propone el precio de la ranura, que la sigue mientras nadie lo toque.
  const fila = doc => doc.querySelector(".arte-fila");
  const precio = doc => fila(doc).querySelector("input[type=number]");
  const ranura = doc => fila(doc).querySelectorAll("select")[1];

  async function conUnArchivo(nombre) {
    const t = await montar(servidorOk(panelDePrueba()));
    prepararEleccionDeArchivos(t.dom, 327, 504);
    await elegir(t.dom, t.doc, [nombre]);
    return t;
  }

  test("propone el de la ranura, y el campo ya no habla de gratis", async () => {
    const { doc } = await conUnArchivo("tora_pelo9.png");
    assert.equal(precio(doc).value, "120");
    assert.equal(precio(doc).min, "1");
    assert.ok(!/gratis/i.test(fila(doc).textContent));
    assert.ok(!/gratis/i.test(doc.getElementById("arteSubir").textContent));
  });

  test("cambiar la ranura cambia el precio propuesto, y el destino", async () => {
    const { dom, doc } = await conUnArchivo("tora_pelo9.png");
    ranura(doc).value = "mascota";
    ranura(doc).dispatchEvent(new dom.window.Event("change"));
    assert.equal(precio(doc).value, "220");
    assert.match(doc.querySelector(".arte-destino").textContent, /Mascota/);
  });

  test("pero no pisa el que se puso a mano", async () => {
    const { dom, doc } = await conUnArchivo("tora_pelo9.png");
    precio(doc).value = "500";
    precio(doc).dispatchEvent(new dom.window.Event("input"));
    ranura(doc).value = "mascota";
    ranura(doc).dispatchEvent(new dom.window.Event("change"));
    assert.equal(precio(doc).value, "500");
  });

  test("Aplicar a todas: sin precio, el de cada ranura; con precio, ese", async () => {
    const { doc } = await conUnArchivo("tora_pelo9.png");
    doc.getElementById("arteTodosCapa").value = "fondo";
    doc.getElementById("arteTodosPrecio").value = "";
    doc.getElementById("arteAplicarTodas").click();
    assert.equal(precio(doc).value, "130");

    doc.getElementById("arteTodosPrecio").value = "77";
    doc.getElementById("arteAplicarTodas").click();
    assert.equal(precio(doc).value, "77");
  });

  test("lo que se sube lleva ese precio", async () => {
    const t = await montar((url) => url.includes("avatar-subir-prendas")
      ? respuestaJson(200, { success: true, entraron: 1, fallaron: 0,
          resultados: [{ archivo: "tora_pelo9.png", ok: true, id: 99, valor: "tora_pelo10", precio: 120 }] })
      : respuestaJson(200, panelDePrueba()));
    prepararEleccionDeArchivos(t.dom, 327, 504);
    await elegir(t.dom, t.doc, ["tora_pelo9.png"]);

    t.doc.getElementById("arteSubirBtn").click();
    for (let i = 0; i < 12; i++) await new Promise(r => setTimeout(r, 0));

    const subida = t.llamadas.find(l => l.url.includes("avatar-subir-prendas"));
    assert.ok(subida, "no se subió nada");
    assert.equal(JSON.parse(subida.opciones.body).prendas[0].precio, 120);
  });
});

describe("editar una prenda del catálogo", () => {
  // El precio lo cambia cualquiera del equipo, en cualquier prenda; el
  // nombre, quien la subió o un administrador (decidido el 24/09/2026).
  const tarjetaDe = (doc, texto) => [...doc.querySelectorAll(".arte-tarjeta")]
    .find(t => new RegExp(texto).test(t.textContent));
  const esperar = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0)); };

  test("todas las tarjetas ofrecen Editar", async () => {
    const { doc } = await montar(servidorOk(panelDePrueba()));
    const tarjetas = [...doc.querySelectorAll(".arte-tarjeta")];
    assert.equal(tarjetas.length, 3);
    assert.ok(tarjetas.every(t => t.querySelector("button.arte-editar")));
  });

  test("el nombre solo se ofrece en lo propio; el precio, en todo", async () => {
    const { doc } = await montar(servidorOk(panelDePrueba()));
    const mia = tarjetaDe(doc, "Botas de combate");
    const ajena = tarjetaDe(doc, "Pelo largo");

    mia.querySelector("button.arte-editar").click();
    ajena.querySelector("button.arte-editar").click();

    assert.equal(mia.querySelector(".arte-edicion input[type=text]").value, "Botas de combate");
    assert.equal(mia.querySelector(".arte-edicion input[type=number]").value, "140");
    assert.equal(ajena.querySelector(".arte-edicion input[type=text]"), null);
    // Sin precio todavía: se propone el de su ranura.
    assert.equal(ajena.querySelector(".arte-edicion input[type=number]").value, "120");
    assert.match(ajena.textContent, /Sin precio/);
  });

  test("un administrador puede cambiar el nombre de todas", async () => {
    const { doc } = await montar(servidorOk(panelDePrueba({ esAdmin: true })));
    const original = tarjetaDe(doc, "Boca recuperada");
    original.querySelector("button.arte-editar").click();
    assert.ok(original.querySelector(".arte-edicion input[type=text]"));
  });

  test("guardar manda solo lo que cambió, y la tarjeta se repinta", async () => {
    const { doc, llamadas } = await montar((url) => url.includes("avatar-editar-prenda")
      ? respuestaJson(200, { success: true, prenda: { id: 11, nombre: "Pelo largo", precio: 300 } })
      : respuestaJson(200, panelDePrueba()));

    const ajena = tarjetaDe(doc, "Pelo largo");
    ajena.querySelector("button.arte-editar").click();
    ajena.querySelector(".arte-edicion input[type=number]").value = "300";
    ajena.querySelector(".arte-edicion button.primario").click();
    await esperar();

    const envio = llamadas.find(l => l.url.includes("avatar-editar-prenda"));
    assert.ok(envio, "debería haber llamado al servidor");
    assert.equal(envio.opciones.method, "POST");
    assert.deepStrictEqual(JSON.parse(envio.opciones.body), { id: 11, precio: 300 });

    const despues = tarjetaDe(doc, "Pelo largo");
    assert.equal(despues.querySelector(".arte-edicion"), null, "el formulario debería cerrarse");
    assert.match(despues.textContent, /300/);
  });

  test("si el servidor dice que no, se cuenta en la tarjeta y el formulario sigue", async () => {
    const { doc } = await montar((url) => url.includes("avatar-editar-prenda")
      ? respuestaJson(400, { success: false, error: "El precio tiene que ser un número entero entre 1 y 100.000" })
      : respuestaJson(200, panelDePrueba()));

    const mia = tarjetaDe(doc, "Botas de combate");
    mia.querySelector("button.arte-editar").click();
    mia.querySelector(".arte-edicion input[type=number]").value = "0";
    mia.querySelector(".arte-edicion button.primario").click();
    await esperar();

    const error = mia.querySelector(".arte-edicion-error");
    assert.equal(error.hidden, false);
    assert.match(error.textContent, /precio/i);
    assert.ok(mia.querySelector(".arte-edicion"), "el formulario tiene que seguir abierto");
  });

  test("Cancelar, o guardar sin cambiar nada, cierra sin llamar a nadie", async () => {
    const { doc, llamadas } = await montar(servidorOk(panelDePrueba()));
    const mia = tarjetaDe(doc, "Botas de combate");

    mia.querySelector("button.arte-editar").click();
    [...mia.querySelectorAll(".arte-edicion button")].find(b => b.textContent === "Cancelar").click();
    assert.equal(mia.querySelector(".arte-edicion"), null);

    mia.querySelector("button.arte-editar").click();
    mia.querySelector(".arte-edicion button.primario").click();
    await esperar();
    assert.equal(mia.querySelector(".arte-edicion"), null);
    assert.ok(!llamadas.some(l => l.url.includes("avatar-editar-prenda")));
  });
});

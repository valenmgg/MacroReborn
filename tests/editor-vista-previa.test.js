// ==============================
// LA VISTA PREVIA DEL EDITOR, EN EL NAVEGADOR — tests/editor-vista-previa.test.js
// ==============================
// Fase 5 de docs/AVATARES-SERVIDOR.md: el editor ya no apila prendas
// sueltas; pide la vista previa al servidor
// (POST /api/users?action=avatar-vista-previa). Cada petición es un
// dibujo allí, así que el navegador tiene que ser prudente:
//
//   ESPERA A QUE SE DEJE DE HACER CLIC. Diez clics seguidos son una
//   petición, la del último.
//
//   LO YA VISTO NO SE VUELVE A PEDIR. Probarse algo y quitárselo vuelve
//   a lo que había sin ir al servidor.
//
//   UNA RESPUESTA VIEJA NO PISA A LA NUEVA. Si la anterior llega tarde,
//   se descarta.
//
//   SI FALLA, SE QUEDA LA ANTERIOR. Un 429 del tope no deja el editor en
//   blanco.
//
// Se evalúa el trozo de verdad de js/perfil.js, con relojes y red de
// mentira.
//
// Correr:  npm test

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const PERFIL = fs.readFileSync(path.join(__dirname, "..", "js", "perfil.js"), "utf8");
const DESDE = "// ---------- PREVIEW EDITOR ----------";
const HASTA = "// ---------- AVATAR PRINCIPAL ----------";

const ORDEN = ["fondo", "espalda", "modelo", "piel", "ojos", "boca", "botas", "pantalon",
               "remera", "guantes", "accesorio", "cara", "pelo", "mascota", "borde"];

function montar() {
  const i = PERFIL.indexOf(DESDE);
  const j = PERFIL.indexOf(HASTA, i);
  assert.ok(i !== -1 && j > i, "no está el bloque de la vista previa en js/perfil.js");

  const dom = new JSDOM('<div id="previewAvatar" class="preview-capas"></div>');
  const relojes = [];
  const pedidas = [];
  let blobs = 0;

  const contexto = {
    document: dom.window.document,
    console: { warn() {}, error() {}, log() {} },
    editorCapas: { modelo: "tora", pelo: "ninguno" },
    ORDEN_CAPAS: ORDEN,
    SILUETA_AVATAR: { tipo: "silueta", src: "imagenes/avatar.png" },
    URL: { createObjectURL: () => "blob:" + (++blobs), revokeObjectURL() {} },
    setTimeout: (fn, ms) => { relojes.push({ fn, ms }); return relojes.length; },
    clearTimeout: (n) => { if (relojes[n - 1]) relojes[n - 1].fn = null; },
    // Cada petición queda en espera hasta que la prueba la contesta.
    fetch: (url, opciones) => new Promise(resolver => {
      pedidas.push({ url, cuerpo: JSON.parse(opciones.body), resolver });
    })
  };
  vm.createContext(contexto);
  const api = vm.runInContext(PERFIL.slice(i, j) + "\n;({ actualizarPreview })", contexto);

  return {
    doc: dom.window.document,
    pedidas,
    vestir(capas) { Object.assign(contexto.editorCapas, capas); api.actualizarPreview(); },
    // Pasa el tiempo: corre los relojes que sigan vivos.
    esperar() {
      const vivos = relojes.filter(r => r.fn).map(r => ({ fn: r.fn, ms: r.ms }));
      relojes.forEach(r => { r.fn = null; });
      vivos.forEach(r => r.fn());
      return vivos.map(r => r.ms);
    },
    img() { return dom.window.document.querySelector("#previewAvatar img.capa"); }
  };
}

const bien = () => ({ ok: true, status: 200, blob: async () => ({}) });
const vacio = () => ({ ok: true, status: 204, blob: async () => ({}) });
const frenado = () => ({ ok: false, status: 429, blob: async () => ({}) });
const listo = () => new Promise(r => setImmediate(r));

describe("la vista previa del editor", () => {

  test("espera a que se deje de hacer clic: diez clics, una petición", async () => {
    const e = montar();
    for (let n = 1; n <= 10; n++) e.vestir({ pelo: "tora_pelo" + n });
    assert.equal(e.pedidas.length, 0, "pidió antes de esperar");

    const esperas = e.esperar();
    assert.deepStrictEqual(esperas, [250]);
    assert.equal(e.pedidas.length, 1);
    assert.equal(e.pedidas[0].url, "/api/users?action=avatar-vista-previa");
    assert.equal(e.pedidas[0].cuerpo.avatar.pelo, "tora_pelo10");
  });

  test("pinta la imagen que dibuja el servidor", async () => {
    const e = montar();
    e.vestir({ pelo: "tora_pelo1" });
    e.esperar();
    e.pedidas[0].resolver(bien());
    await listo();

    assert.equal(e.img().getAttribute("src"), "blob:1");
    assert.ok(!e.doc.getElementById("previewAvatar").classList.contains("cargando"));
  });

  test("lo ya visto no se vuelve a pedir", async () => {
    const e = montar();
    e.vestir({ pelo: "tora_pelo1" });
    e.esperar();
    e.pedidas[0].resolver(bien());
    await listo();

    e.vestir({ pelo: "tora_pelo2" });
    e.esperar();
    e.pedidas[1].resolver(bien());
    await listo();
    assert.equal(e.img().getAttribute("src"), "blob:2");

    e.vestir({ pelo: "tora_pelo1" });   // quitárselo: vuelve a lo de antes
    assert.equal(e.img().getAttribute("src"), "blob:1", "no volvió al instante");
    e.esperar();
    assert.equal(e.pedidas.length, 2, "volvió a pedir algo ya visto");
  });

  test("sin ninguna prenda, la silueta", async () => {
    const e = montar();
    e.vestir({ modelo: "ninguno" });
    e.esperar();
    e.pedidas[0].resolver(vacio());
    await listo();
    assert.equal(e.img().getAttribute("src"), "imagenes/avatar.png");
  });

  test("una respuesta vieja no pisa a la nueva", async () => {
    const e = montar();
    e.vestir({ pelo: "tora_pelo1" });
    e.esperar();                         // petición A, lenta
    e.vestir({ pelo: "tora_pelo2" });
    e.esperar();                         // petición B
    e.pedidas[1].resolver(bien());       // B llega primero
    await listo();
    e.pedidas[0].resolver(bien());       // A llega tarde
    await listo();

    assert.equal(e.img().getAttribute("src"), "blob:1",
      "la imagen tiene que ser la de B, la primera que se creó");
  });

  test("si el servidor frena o falla, se queda la anterior", async () => {
    const e = montar();
    e.vestir({ pelo: "tora_pelo1" });
    e.esperar();
    e.pedidas[0].resolver(bien());
    await listo();

    e.vestir({ pelo: "tora_pelo2" });
    assert.ok(e.doc.getElementById("previewAvatar").classList.contains("cargando"));
    e.esperar();
    e.pedidas[1].resolver(frenado());
    await listo();

    assert.equal(e.img().getAttribute("src"), "blob:1");
    assert.ok(!e.doc.getElementById("previewAvatar").classList.contains("cargando"));
  });

  test("y nunca pide una prenda suelta", async () => {
    const e = montar();
    for (let n = 1; n <= 5; n++) {
      e.vestir({ pelo: "tora_pelo" + n, remera: "tora_remera" + n });
      e.esperar();
      e.pedidas[e.pedidas.length - 1].resolver(bien());
      await listo();
    }
    assert.ok(e.pedidas.every(p => p.url === "/api/users?action=avatar-vista-previa"));
    assert.ok(!e.doc.body.innerHTML.includes("/prendas/"));
  });

});

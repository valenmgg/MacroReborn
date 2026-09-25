// ==============================
// LA SESIÓN, SEGÚN EL SERVIDOR — tests/sesion-navegador.test.js
// ==============================
// Reporte del 25/09/2026: "podía jugar pero no me contaba el XP ni podía
// escribir; cerré sesión, volví a entrar y se arregló". El navegador
// guardaba quién eres (usuarioActivo) por un lado y el pase (el token)
// por otro, y nada comprobaba que siguieran de acuerdo: con el pase
// caducado, de otra cuenta, o sin pase, la página parecía funcionar pero
// no guardaba nada.
//
// js/core.js tiene ahora el interceptor de la API y MRSesionServidor,
// que guardan el pase renovado (X-Sesion-Nueva) y avisan con una franja
// cuando la sesión del navegador ya no es la que acepta el servidor. Se
// evalúa ese trozo de verdad en jsdom, con la red de mentira.
//
// Correr:  npm test

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

// Sin los CR: en Windows la copia de trabajo está en CRLF.
const CORE = fs.readFileSync(path.join(__dirname, "..", "js", "core.js"), "utf8").replace(/\r\n/g, "\n");
const DESDE = "(function instalarInterceptorApi() {";
const HASTA = "// FIN: LA SESIÓN, SEGÚN EL SERVIDOR";
const TROZO = CORE.slice(CORE.indexOf(DESDE), CORE.indexOf(HASTA));

// Un pase con su nombre dentro. La firma da igual: el navegador no la
// comprueba, eso es cosa del servidor.
const pase = (username) => Buffer.from(JSON.stringify({ sub: 1, username, iat: 1, exp: 2 })).toString("base64url") + ".firma";

// Una respuesta de la API, como la que da fetch.
function respuesta(status, cuerpo, cabeceras) {
  const r = {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => (cabeceras || {})[k] || null },
    json: async () => cuerpo,
    clone: () => r
  };
  return r;
}

// opciones: url de la página, usuario y pase guardados, y qué contesta la red.
async function montar(opciones) {
  const o = opciones || {};
  assert.ok(CORE.includes(DESDE) && CORE.includes(HASTA), "no está el trozo de la sesión en js/core.js");
  const dom = new JSDOM("<!doctype html><body></body>", {
    url: "https://www.macroreborn.com/" + (o.pagina || "jugar.html?id=5"),
    runScripts: "outside-only"
  });
  const w = dom.window;
  if (o.usuario !== undefined) w.localStorage.setItem("usuarioActivo", JSON.stringify({ nombre: o.usuario }));
  if (o.pase !== undefined) w.localStorage.setItem("macroSessionToken", o.pase);

  const pedidas = [];
  w.fetch = async (url, init) => {
    pedidas.push({ url: String(url), init: init || {} });
    if (o.antesDeContestar) o.antesDeContestar(w);
    return o.contestar ? o.contestar(String(url), init) : respuesta(200, { success: true });
  };
  w.eval(TROZO);
  await new Promise(r => setTimeout(r, 0));

  const esperar = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0)); };
  return {
    w, pedidas, esperar,
    franja: () => w.document.getElementById("mrAvisoSesion"),
    guardado: (k) => w.localStorage.getItem(k),
    pedir: async (url, init) => { const r = await w.fetch(url, init); await esperar(); return r; }
  };
}

describe("el pase en cada petición", () => {

  test("va en las de la API y no en las de fuera", async () => {
    const p = await montar({ usuario: "ana", pase: pase("ana") });
    await p.pedir("/api/content?action=chat");
    await p.pedir("https://otro-sitio.com/api/algo");
    assert.equal(new p.w.Headers(p.pedidas[0].init.headers).get("Authorization"), "Bearer " + pase("ana"));
    assert.equal(new p.w.Headers(p.pedidas[1].init.headers || {}).get("Authorization"), null);
  });

  test("se guarda el pase renovado que manda el servidor", async () => {
    const p = await montar({ usuario: "ana", pase: pase("ana"),
      contestar: () => respuesta(200, { success: true }, { "X-Sesion-Nueva": "pase-renovado" }) });
    await p.pedir("/api/content?action=mis-monedas");
    assert.equal(p.guardado("macroSessionToken"), "pase-renovado");
  });

  test("pero no si mientras tanto otra pestaña cambió el pase", async () => {
    const p = await montar({ usuario: "ana", pase: pase("ana"),
      antesDeContestar: (w) => w.localStorage.setItem("macroSessionToken", pase("rafa")),
      contestar: () => respuesta(200, { success: true }, { "X-Sesion-Nueva": "pase-de-ana-renovado" }) });
    await p.pedir("/api/content?action=mis-monedas");
    assert.equal(p.guardado("macroSessionToken"), pase("rafa"));
  });

});

describe("cuando el servidor ya no acepta la sesión", () => {

  const caducado = () => respuesta(401, { success: false, error: "Sesión no válida o expirada" });

  test("401: se cierra la sesión del navegador y se dice, con vuelta a esta página", async () => {
    const p = await montar({ usuario: "ana", pase: pase("ana"), contestar: caducado });
    await p.pedir("/api/users?action=xp", { method: "POST" });
    assert.equal(p.guardado("usuarioActivo"), null);
    assert.equal(p.guardado("macroSessionToken"), null);
    assert.match(p.franja().textContent, /Tu sesión caducó/);
    assert.equal(p.franja().querySelector("a").getAttribute("href"), "login.html?volver=" + encodeURIComponent("jugar.html?id=5"));
  });

  test("usa MRSession.clear si está, para que la página se entere", async () => {
    let cerrada = false;
    const p = await montar({ usuario: "ana", pase: pase("ana"), contestar: caducado });
    p.w.MRSession = { clear: () => { cerrada = true; } };
    await p.pedir("/api/content?action=chat", { method: "POST" });
    assert.equal(cerrada, true);
  });

  test("un 401 de otra cosa (la tarea del ranking) no cierra nada", async () => {
    const p = await montar({ usuario: "ana", pase: pase("ana"),
      contestar: () => respuesta(401, { success: false, error: "No autorizado" }) });
    await p.pedir("/api/system?action=recalcular-ranking");
    assert.equal(p.franja(), null);
    assert.equal(p.guardado("macroSessionToken"), pase("ana"));
  });

  test("lo de /api/auth tampoco: tiene sus propias pantallas", async () => {
    const p = await montar({ usuario: "ana", pase: pase("ana"), contestar: caducado });
    await p.pedir("/api/auth?action=delete-account", { method: "POST" });
    assert.equal(p.franja(), null);
  });

  test("una petición que salió con un pase viejo no decide nada", async () => {
    // Una página con su propia copia del pase, de antes de renovarlo.
    const p = await montar({ usuario: "ana", pase: pase("ana"), contestar: caducado });
    await p.pedir("/api/progreso?action=status", { headers: { Authorization: "Bearer pase-viejo" } });
    assert.equal(p.franja(), null);
    assert.equal(p.guardado("macroSessionToken"), pase("ana"));
  });

  test("403 de otra cuenta: se pide recargar, sin cerrar nada", async () => {
    const p = await montar({ usuario: "ana", pase: pase("ana"),
      contestar: () => respuesta(403, { success: false, error: "Sesión no corresponde al usuario" }) });
    // Otra pestaña entró con otra cuenta; esta página sigue con "ana" en memoria.
    p.w.localStorage.setItem("macroSessionToken", pase("rafa"));
    p.w.localStorage.setItem("usuarioActivo", JSON.stringify({ nombre: "rafa" }));
    await p.pedir("/api/content?action=chat", { method: "POST" });
    assert.match(p.franja().textContent, /Iniciaste sesión como rafa en otra pestaña/);
    assert.equal(p.franja().querySelector("button").textContent, "Recargar");
    assert.equal(p.guardado("macroSessionToken"), pase("rafa"));
  });

});

describe("al abrir la página", () => {

  test("usuario guardado sin pase: caducó", async () => {
    const p = await montar({ usuario: "ana" });
    assert.match(p.franja().textContent, /Tu sesión caducó/);
    assert.equal(p.guardado("usuarioActivo"), null);
  });

  test("usuario de una cuenta y pase de otra: mezclada", async () => {
    const p = await montar({ usuario: "ana", pase: pase("rafa") });
    assert.match(p.franja().textContent, /mezclada entre dos cuentas/);
    assert.equal(p.guardado("macroSessionToken"), null);
  });

  test("todo en orden, o nadie conectado: nada", async () => {
    assert.equal((await montar({ usuario: "ana", pase: pase("ANA") })).franja(), null, "las mayúsculas no cuentan");
    assert.equal((await montar({})).franja(), null);
  });

  test("nombres con tildes, runas o corazones se leen bien del pase", async () => {
    const p = await montar({ usuario: "Ñandú ♡ ᚠ", pase: pase("Ñandú ♡ ᚠ") });
    assert.equal(p.franja(), null);
  });

  test("en el login y el registro no se avisa ni se cierra nada", async () => {
    for (const pagina of ["login.html", "registro.html"]) {
      const p = await montar({ pagina, usuario: "ana" });
      assert.equal(p.franja(), null, pagina);
      assert.ok(p.guardado("usuarioActivo"), pagina);
    }
  });

});

describe("si otra pestaña cambia la sesión", () => {

  function avisarDeCambio(w, clave) {
    const evento = new w.Event("storage");
    Object.defineProperty(evento, "key", { value: clave });
    w.dispatchEvent(evento);
  }

  test("entra con otra cuenta: se pide recargar", async () => {
    const p = await montar({ usuario: "ana", pase: pase("ana") });
    p.w.localStorage.setItem("macroSessionToken", pase("rafa"));
    avisarDeCambio(p.w, "macroSessionToken");
    assert.match(p.franja().textContent, /Iniciaste sesión como rafa/);
  });

  test("renueva el pase de la misma cuenta: nada", async () => {
    const p = await montar({ usuario: "ana", pase: pase("ana") });
    p.w.localStorage.setItem("macroSessionToken", pase("ana") + "-renovado");
    avisarDeCambio(p.w, "macroSessionToken");
    assert.equal(p.franja(), null);
  });

  test("cierra sesión: se dice", async () => {
    const p = await montar({ usuario: "ana", pase: pase("ana") });
    p.w.localStorage.clear();
    avisarDeCambio(p.w, null);
    assert.match(p.franja().textContent, /Cerraste sesión en otra pestaña/);
  });

});

test("la franja pinta los nombres como texto", async () => {
  const malo = '<img src=x onerror="alert(1)">';
  const p = await montar({ usuario: "ana", pase: pase("ana") });
  p.w.localStorage.setItem("macroSessionToken", pase(malo));
  const evento = new p.w.Event("storage");
  Object.defineProperty(evento, "key", { value: "macroSessionToken" });
  p.w.dispatchEvent(evento);
  assert.ok(p.franja().textContent.includes(malo));
  assert.equal(p.franja().querySelector("img"), null);
});

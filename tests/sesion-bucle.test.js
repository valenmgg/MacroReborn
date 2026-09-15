// ==============================
// TESTS DEL REFRESCO DE SESIÓN — tests/sesion-bucle.test.js
// ==============================
// MRSession.refresh() vuelve a leer la cuenta propia del servidor y la
// guarda. Guardarla emite "macro:session-change", y en perfil.html había
// alguien escuchando ese evento para... volver a refrescar la sesión:
//
//   load({refreshSession:true}) -> MRApp.refreshSession()
//     -> guardar() -> "macro:session-change"
//     -> programarRefresco({refreshSession:true}) -> 120 ms -> otra vez
//
// Cargando los archivos de verdad con el fetch instrumentado salían 64
// peticiones en 2 segundos, en tandas cada 125 ms, sin señal de parar.
// Con cada vuelta arrastraba además a notificaciones, favoritos,
// historial y actividad, que escuchan el mismo evento. Eso es lo que
// hacía lenta la carga del perfil.
//
// El bucle tenía dos mitades y cada una bastaba para abrirlo:
//
//   1. El oyente de perfil-identidad.js volvía a pedir la sesión.
//   2. El freno de 5 segundos de session.js estaba escrito
//      `refreshPromise && ahora - lastRefreshAt < 5000`, y refreshPromise
//      vale null en cuanto un refresco termina. O sea que no frenaba.
//
// Estos tests cubren las dos.
//
// Correr:  npm test

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..");
const FUENTE_SESION = fs.readFileSync(path.join(RAIZ, "js", "session.js"), "utf8");
const FUENTE_IDENTIDAD = fs.readFileSync(path.join(RAIZ, "js", "perfil-identidad.js"), "utf8");

const USUARIO = { username: "gurime", nombre: "gurime", level: 3, nivel: 3 };

// Monta js/session.js de verdad sobre un localStorage y un fetch falsos.
function montar(respuesta) {
  const almacen = new Map([["usuarioActivo", JSON.stringify(USUARIO)]]);
  const peticiones = [];

  const ventana = {
    localStorage: {
      getItem: k => (almacen.has(k) ? almacen.get(k) : null),
      setItem: (k, v) => almacen.set(k, String(v)),
      removeItem: k => almacen.delete(k)
    },
    addEventListener() {},
    fetch(url) {
      peticiones.push(String(url));
      return respuesta();
    }
  };
  ventana.window = ventana;

  const contexto = {
    window: ventana,
    localStorage: ventana.localStorage,
    console: { warn() {}, error() {}, log() {} },
    JSON, Date, Set, Map, encodeURIComponent
  };
  vm.createContext(contexto);
  vm.runInContext(FUENTE_SESION, contexto);

  return { sesion: ventana.MRSession, peticiones };
}

const ok = () => Promise.resolve({
  ok: true,
  json: () => Promise.resolve({ success: true, user: USUARIO })
});

// ==============================

describe("el freno de 5 segundos existe de verdad", () => {
  test("dos refrescos seguidos hacen UNA sola petición", async () => {
    const { sesion, peticiones } = montar(ok);

    await sesion.refresh();
    await sesion.refresh();

    assert.equal(peticiones.length, 1,
      "el segundo cae dentro de los 5 s: no debe llegar al servidor");
  });

  test("y cinco seguidos, tampoco más de una", async () => {
    const { sesion, peticiones } = montar(ok);

    for (let i = 0; i < 5; i++) await sesion.refresh();

    assert.equal(peticiones.length, 1);
  });

  test("varios a la vez se juntan en una", async () => {
    const { sesion, peticiones } = montar(ok);

    await Promise.all([sesion.refresh(), sesion.refresh(), sesion.refresh()]);

    assert.equal(peticiones.length, 1);
  });

  test("con force sí se vuelve a pedir, que para eso está", async () => {
    const { sesion, peticiones } = montar(ok);

    await sesion.refresh();
    await sesion.refresh({ force: true });

    assert.equal(peticiones.length, 2);
  });
});

describe("si el servidor falla, tampoco se insiste sin parar", () => {
  // Antes lastRefreshAt solo se ponía en el camino de éxito, así que
  // ante un error se quedaba a 0 y el freno no llegaba a existir nunca.
  // Justo cuando el servidor va mal es cuando menos conviene insistir.
  test("tras un fallo, el siguiente refresco no vuelve a pedir", async () => {
    const { sesion, peticiones } = montar(() => Promise.reject(new Error("sin red")));

    await sesion.refresh();
    await sesion.refresh();

    assert.equal(peticiones.length, 1);
  });

  test("una respuesta sin success cuenta igual", async () => {
    const { sesion, peticiones } = montar(
      () => Promise.resolve({ ok: true, json: () => Promise.resolve({ success: false }) })
    );

    await sesion.refresh();
    await sesion.refresh();

    assert.equal(peticiones.length, 1);
  });
});

describe("el perfil no pide la sesión al enterarse de que la sesión cambió", () => {
  // Se lee el fuente porque el bucle es una propiedad de cómo está
  // escrito el oyente, no de lo que devuelve ninguna función.
  test("el oyente de macro:session-change no pide refreshSession", () => {
    const i = FUENTE_IDENTIDAD.indexOf("'macro:session-change'");
    assert.ok(i !== -1, "no se encontró el oyente en js/perfil-identidad.js");

    const linea = FUENTE_IDENTIDAD.slice(i, FUENTE_IDENTIDAD.indexOf("\n", i));

    assert.ok(!/refreshSession/.test(linea),
      "pedir la sesión al recibir el evento que produce la propia sesión " +
      "vuelve a abrir el bucle: " + linea.trim());
  });

  test("pero sí repinta las listas cuando la sesión cambia de verdad", () => {
    const i = FUENTE_IDENTIDAD.indexOf("'macro:session-change'");
    const linea = FUENTE_IDENTIDAD.slice(i, FUENTE_IDENTIDAD.indexOf("\n", i));

    assert.ok(/programarRefresco/.test(linea),
      "si la sesión cambia desde otra pestaña, las listas tienen que " +
      "repintarse: " + linea.trim());
  });
});

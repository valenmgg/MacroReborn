// ==============================
// EL NAVEGADOR PIDE EL COMPUESTO — tests/avatar-compuesto-navegador.test.js
// ==============================
// Fase 3 de docs/AVATARES-SERVIDOR.md: las páginas dejan de apilar
// quince etiquetas por avatar y piden una sola imagen al servidor.
//
// Lo que hay que sujetar:
//
//   LA DIRECCION SE ARMA IGUAL QUE EN EL SERVIDOR. El navegador la
//   construye con el id y la huella; el servidor la parte con una
//   expresión regular. Si las dos formas se separan, no lo dice
//   ninguna prueba de las que hay: sale un 404 en la cara de alguien.
//   Por eso esta prueba compara las dos mitades de verdad.
//
//   SIN COMPUESTO SE SIGUE DIBUJANDO. Quien no tiene avatar, quien usa
//   un PNG de administrador y quien agotó el freno del servidor no
//   tienen huella. Ninguno puede quedarse en blanco.
//
//   LA PAGINA DE COMUNIDAD PASA EL USUARIO. Es donde está el ahorro, y
//   es un argumento nuevo en una llamada que ya tenía cuatro: olvidarlo
//   en uno de los cuatro sitios no rompe nada visible, solo deja esa
//   lista sin el ahorro. Se comprueba leyendo el fichero.
//
// Correr:  npm test

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const raiz = (...p) => path.join(__dirname, "..", ...p);
const CORE = fs.readFileSync(raiz("js", "core.js"), "utf8");
const COMUNIDAD = fs.readFileSync(raiz("js", "comunidad-ranking.js"), "utf8");

const AC = require("../api/_avatar-compuesto");

// Levanta solo el trozo de core.js que va del ayudante nuevo a
// avatarMiniaturaHTML, sin arrastrar el resto del fichero.
function montarAyudante() {
  const i = CORE.indexOf("function urlAvatarCompuesto");
  const j = CORE.indexOf("function avatarMiniaturaHTML");
  assert.ok(i !== -1, "no está urlAvatarCompuesto en js/core.js");
  assert.ok(j > i, "avatarMiniaturaHTML debería ir después");

  const contexto = { console: { warn() {}, error() {}, log() {} } };
  vm.createContext(contexto);
  return vm.runInContext(
    CORE.slice(i, j) + "\n;({ url: urlAvatarCompuesto, img: imgCompuesta })",
    contexto
  );
}

const LUIS = { id: 38, avatar_compuesto: "401ddea4553cacbbe043e00d0c330eca" };

describe("la dirección que arma el navegador", () => {

  test("lleva el id, el tamaño y la versión", () => {
    const { url } = montarAyudante();
    assert.equal(url(LUIS, 62, 96), "/avatares/38/62x96.jpg?v=401ddea4553c");
    assert.equal(url(LUIS, 327, 504), "/avatares/38/327x504.jpg?v=401ddea4553c");
  });

  test("por defecto pide la miniatura, que es la de las listas", () => {
    const { url } = montarAyudante();
    assert.equal(url(LUIS), "/avatares/38/62x96.jpg?v=401ddea4553c");
  });

  test("EL SERVIDOR LA ENTIENDE, que es lo que de verdad importa", () => {
    // Las dos mitades se escribieron por separado: el navegador
    // concatena, el servidor parte con una expresión regular. Esta
    // prueba es la única que las pone frente a frente.
    const { url } = montarAyudante();

    for (const [a, l] of AC.TAMANOS) {
      const completa = url(LUIS, a, l);
      const soloRuta = completa.split("?")[0];
      const partida = AC.partirRuta(soloRuta);

      assert.ok(partida, "el servidor no entiende " + soloRuta);
      assert.deepStrictEqual(partida.destino, { usuarioId: 38 });
      assert.equal(partida.ancho, a);
      assert.equal(partida.alto, l);
    }
  });

  test("y los dos tamaños que pide el navegador son de los que existen", () => {
    const { url } = montarAyudante();
    for (const [a, l] of [[62, 96], [327, 504]]) {
      assert.ok(AC.TAMANOS_VALIDOS.has(a + "x" + l),
        a + "x" + l + " no lo genera el servidor");
      assert.ok(url(LUIS, a, l).includes(a + "x" + l));
    }
  });

  test("sin huella no hay dirección, y entonces se dibuja por capas", () => {
    const { url } = montarAyudante();
    assert.equal(url({ id: 38 }), null);
    assert.equal(url({ id: 38, avatar_compuesto: null }), null);
    assert.equal(url({ avatar_compuesto: "abc" }), null);
    assert.equal(url(null), null);
    assert.equal(url(undefined), null);
    assert.equal(url({}), null);
  });

  test("un id raro no se cuela sin escapar en la dirección", () => {
    const { url } = montarAyudante();
    const sucio = url({ id: "38/../../otro", avatar_compuesto: "abcdef123456" });
    assert.ok(!sucio.includes("../"), "el id salió sin escapar: " + sucio);
    // Y el servidor lo rechaza igualmente.
    assert.equal(AC.partirRuta(sucio.split("?")[0]), null);
  });

});

describe("la etiqueta que se pinta", () => {

  test("sale con data-src, que es lo que recoge el cargador perezoso", () => {
    // Si saliera con src, las 181 imágenes de la comunidad se pedirían
    // todas de golpe en vez de al entrar en pantalla.
    const { img } = montarAyudante();
    const html = img("/avatares/38/62x96.jpg?v=abc", "width:100%;");
    assert.match(html, /data-src="/);
    assert.ok(!/\ssrc="/.test(html), "salió con src y no con data-src");
    assert.match(html, /loading="lazy"/);
  });

});

describe("la página de comunidad", () => {

  test("las cuatro listas pasan el usuario, no solo su avatar", () => {
    // Olvidarlo en una no rompe nada visible: esa lista sigue
    // dibujándose por capas y nadie se entera de que no se ahorró.
    const llamadas = COMUNIDAD.match(/rkAvatarHTML\([^)]*\)/g) || [];
    const usos = llamadas.filter(l => !l.includes("function"));
    assert.ok(usos.length >= 3, "se esperaban al menos tres usos, hay " + usos.length);
    for (const uso of usos) {
      assert.match(uso, /usuario\)\s*$/, "esta llamada no pasa el usuario: " + uso);
    }

    assert.match(COMUNIDAD, /crAvatarCapasHTML\(u\.avatar, "cr-capa-chica", u\)/,
      "la lista de conectados no pasa el usuario");
  });

  test("y las dos funciones miran primero si hay compuesto", () => {
    for (const nombre of ["rkAvatarHTML", "crAvatarCapasHTML"]) {
      const i = COMUNIDAD.indexOf("function " + nombre);
      assert.ok(i !== -1, "no está " + nombre);
      // El corte tiene que llegar a las capas: rkAvatarHTML es larga.
      const cuerpo = COMUNIDAD.slice(i, i + 2500);
      const dondeCompuesto = cuerpo.indexOf("urlAvatarCompuesto");
      const dondeCapas = cuerpo.indexOf("RK_ORDEN_CAPAS");

      assert.ok(dondeCompuesto !== -1, nombre + " no usa el compuesto");
      assert.ok(dondeCapas !== -1, "el corte no llega a las capas de " + nombre);
      assert.ok(dondeCompuesto < dondeCapas,
        nombre + " mira las capas antes que el compuesto");
    }
  });

  test("pero siguen sabiendo dibujar por capas si no lo hay", () => {
    // El repliegue tiene que seguir entero: 64 de 182 cuentas no tienen
    // avatar, y un PNG de administrador tampoco tiene huella.
    assert.match(COMUNIDAD, /RK_ORDEN_CAPAS\.forEach/);
    assert.match(COMUNIDAD, /imagenes\/avatar\.png/);
  });

});

describe("el servidor manda la huella en las listas", () => {

  test("las tres consultas de usuarios la traen", () => {
    // Sin esto el navegador no tiene con qué armar la dirección, y todo
    // lo de arriba se repliega a capas sin que nadie lo note.
    const users = fs.readFileSync(raiz("api", "users.js"), "utf8");
    const consultas = users.match(/SELECT u\.id, u\.username[^;]*/g) || [];
    assert.ok(consultas.length >= 3, "se esperaban tres consultas, hay " + consultas.length);
    for (const c of consultas) {
      assert.match(c, /u\.avatar_compuesto/, "una consulta no trae la huella");
    }
  });

});

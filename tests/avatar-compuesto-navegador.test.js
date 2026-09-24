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
//   tienen huella. Ninguno puede quedarse en blanco, y ninguno puede
//   acabar pidiendo prendas sueltas: el PNG va antes que el compuesto,
//   sin prendas sale la silueta, y sin huella la dirección desnuda.
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

// Una función suelta de core.js, de su "function" a su llave de cierre.
function funcion(nombre) {
  const i = CORE.indexOf("function " + nombre + "(");
  assert.ok(i !== -1, "no está " + nombre + " en js/core.js");
  const fin = CORE.slice(i).search(/\r?\n}\r?\n/);
  return CORE.slice(i, i + fin) + "\n}\n";
}

// Levanta solo el trozo de core.js que va del ayudante nuevo a
// avatarMiniaturaHTML, y lo poco de fuera que usa, sin arrastrar el
// resto del fichero.
function montarAyudante() {
  const i = CORE.indexOf("function urlAvatarCompuesto");
  const j = CORE.indexOf("function avatarMiniaturaHTML");
  assert.ok(i !== -1, "no está urlAvatarCompuesto en js/core.js");
  assert.ok(j > i, "avatarMiniaturaHTML debería ir después");

  const k = CORE.indexOf("const ORDEN_CAPAS_AVATAR");
  const orden = CORE.slice(k, CORE.indexOf("];", k) + 2);

  const contexto = { console: { warn() {}, error() {}, log() {} } };
  vm.createContext(contexto);
  return vm.runInContext(
    funcion("leerJSON") + funcion("normalizarAvatar") + funcion("avatarPNGData") +
    orden + "\n" + CORE.slice(i, j) +
    "\n;({ url: urlAvatarCompuesto, img: imgCompuesta, imagen: imagenDeAvatar," +
    " tienePrendas: avatarTienePrendas })",
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

  test("sin huella sale la dirección desnuda, que el servidor también entiende", () => {
    // El servidor lo compone al pedirlo si falta, o manda la silueta.
    // Se cachea un minuto en vez de un año, y nada más cambia.
    const { url } = montarAyudante();
    assert.equal(url({ id: 38 }), "/avatares/38/62x96.jpg");
    assert.equal(url({ id: 38, avatar_compuesto: null }, 327, 504), "/avatares/38/327x504.jpg");

    const partida = AC.partirRuta(url({ id: 38 }));
    assert.ok(partida, "el servidor no entiende la dirección desnuda");
    assert.deepStrictEqual(partida.destino, { usuarioId: 38 });
  });

  test("y sin saber de quién es, no hay dirección", () => {
    const { url } = montarAyudante();
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

describe("qué imagen se enseña", () => {

  const CAPAS = { modelo: "tora", pelo: "tora_pelo3" };
  const PNG = { tipo: "png", url: "/api/users?action=avatar-png&username=luis&v=abc" };

  test("con huella, el compuesto con su versión", () => {
    const { imagen } = montarAyudante();
    assert.deepStrictEqual({ ...imagen(CAPAS, LUIS) },
      { tipo: "compuesto", src: "/avatares/38/62x96.jpg?v=401ddea4553c" });
    assert.equal(imagen(CAPAS, LUIS, 327, 504).src, "/avatares/38/327x504.jpg?v=401ddea4553c");
  });

  test("el PNG de administrador va antes, aunque quede una huella vieja", () => {
    // Antes del 24/09/2026 ponerse un PNG no borraba la huella: con el
    // compuesto primero, saldría la ropa de antes.
    const { imagen } = montarAyudante();
    assert.deepStrictEqual({ ...imagen(PNG, LUIS) }, { tipo: "png", src: PNG.url });
  });

  test("sin ninguna prenda, la silueta, sin preguntarle al servidor", () => {
    // 65 de 186 cuentas no llevan nada: pedirle al servidor cada una
    // sería una consulta a la base por avatar para acabar igual.
    const { imagen } = montarAyudante();
    for (const vacio of [null, undefined, "", {}, { pelo: "ninguno" }, { pelo: "" }]) {
      assert.deepStrictEqual({ ...imagen(vacio, { id: 38 }) },
        { tipo: "silueta", src: "imagenes/avatar.png" }, JSON.stringify(vacio));
    }
  });

  test("con prendas y sin huella, la dirección desnuda", () => {
    const { imagen } = montarAyudante();
    assert.deepStrictEqual({ ...imagen(CAPAS, { id: 38 }) },
      { tipo: "compuesto", src: "/avatares/38/62x96.jpg" });
    // El avatar también puede llegar como texto JSON, como en la base.
    assert.equal(imagen(JSON.stringify(CAPAS), { id: 38 }).tipo, "compuesto");
  });

  test("con prendas y sin saber quién es, null: esa página aún dibuja por capas", () => {
    const { imagen } = montarAyudante();
    assert.equal(imagen(CAPAS), null);
    assert.equal(imagen(CAPAS, { avatar_compuesto: "abc" }), null);
  });

  test("un PNG que apunta fuera no se enseña: sale la silueta", () => {
    const { imagen } = montarAyudante();
    const ajeno = { tipo: "png", url: "https://otro.sitio/cara.png" };
    assert.deepStrictEqual({ ...imagen(ajeno, { id: 38 }) },
      { tipo: "silueta", src: "imagenes/avatar.png" });
  });

  test("cuándo lleva prendas lo decide igual que el servidor", () => {
    // Si el navegador creyera que no lleva nada y el servidor que sí,
    // alguien con ropa saldría como silueta. Y al revés, se preguntaría
    // al servidor por nada.
    const { tienePrendas } = montarAyudante();
    const casos = [{}, { pelo: "ninguno" }, { pelo: "" }, { pelo: null }, CAPAS,
      { fondo: "tora_fondo1" }, { borde: "x" }, { mascota: "ninguno", ojos: "tora_ojos2" },
      { cualquiera: "tora_pelo3" }];
    for (const avatar of casos) {
      assert.equal(tienePrendas(avatar), AC.capasCon(avatar).length > 0, JSON.stringify(avatar));
    }
  });

  test("y mira las mismas capas que el servidor", () => {
    const k = CORE.indexOf("const ORDEN_CAPAS_AVATAR");
    const lista = CORE.slice(k, CORE.indexOf("];", k)).match(/"[a-z]+"/g).map(s => s.slice(1, -1));
    assert.deepStrictEqual(lista, require("../api/_avatar-catalogo").CAPAS);
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

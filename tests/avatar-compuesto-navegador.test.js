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
//   LA PAGINA DE COMUNIDAD PASA EL USUARIO, en sus siete listas. Desde
//   el 24/09/2026 ya no dibuja por capas: la lista que lo olvide sale
//   con siluetas. Se ejecutan sus funciones de verdad, y se comprueba
//   leyendo el fichero que cada llamada pasa la persona.
//
// Correr:  npm test

require("./_aislar-datos");   // antes de api/: ver ese archivo

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

// Lo mismo, con las funciones de avatar de la pagina de comunidad
// encima, que usan imagenDeAvatar.
function montarComunidad() {
  const trozo = nombre => {
    const i = COMUNIDAD.indexOf("function " + nombre + "(");
    assert.ok(i !== -1, "no está " + nombre + " en js/comunidad-ranking.js");
    const fin = COMUNIDAD.slice(i).search(/\r?\n}\r?\n/);
    return COMUNIDAD.slice(i, i + fin) + "\n}\n";
  };
  const i = CORE.indexOf("function urlAvatarCompuesto");
  const j = CORE.indexOf("function avatarMiniaturaHTML");
  const k = CORE.indexOf("const ORDEN_CAPAS_AVATAR");
  const contexto = { console: { warn() {}, error() {}, log() {} } };
  vm.createContext(contexto);
  return vm.runInContext(
    funcion("leerJSON") + funcion("normalizarAvatar") + funcion("avatarPNGData") +
    CORE.slice(k, CORE.indexOf("];", k) + 2) + "\n" + CORE.slice(i, j) +
    trozo("rkImagenAvatar") + trozo("rkAvatarHTML") + trozo("crAvatarHTML") +
    "\n;({ rk: rkAvatarHTML, cr: crAvatarHTML })",
    contexto
  );
}

// Cada llamada a una funcion, con sus argumentos enteros aunque ocupen
// varias lineas o lleven parentesis dentro.
function llamadasA(texto, nombre) {
  const salida = [];
  let desde = 0;
  for (;;) {
    const i = texto.indexOf(nombre + "(", desde);
    if (i === -1) return salida;
    let nivel = 0, j = i + nombre.length;
    for (; j < texto.length; j++) {
      if (texto[j] === "(") nivel++;
      if (texto[j] === ")" && --nivel === 0) break;
    }
    const llamada = texto.slice(i, j + 1);
    if (!texto.slice(Math.max(0, i - 9), i).includes("function")) salida.push(llamada);
    desde = j;
  }
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

  const CAPAS = { modelo: "tora", pelo: "tora_pelo3" };
  const PNG = { tipo: "png", url: "/api/users?action=avatar-png&username=jefa&v=abc" };

  test("con la persona, su compuesto", () => {
    const { rk, cr } = montarComunidad();
    assert.match(cr(CAPAS, "cr-capa-chica", LUIS),
      /<img class="cr-capa-chica" data-src="\/avatares\/38\/62x96\.jpg\?v=401ddea4553c"/);
    assert.match(rk(CAPAS, "avatar-tarjeta", "capa-tarjeta", null, LUIS),
      /data-src="\/avatares\/38\/62x96\.jpg\?v=401ddea4553c"/);
    // Sin huella, la direccion desnuda.
    assert.match(cr(CAPAS, "cr-capa-chica", { id: 38 }), /data-src="\/avatares\/38\/62x96\.jpg"/);
  });

  test("el PNG de administrador, con su clase para el repliegue", () => {
    // avatar-png-personalizado es lo que core.js mira para caer a la
    // silueta si el PNG no carga.
    const { rk, cr } = montarComunidad();
    assert.match(cr(PNG, "cr-capa-chica", LUIS), /class="cr-capa-chica avatar-png-personalizado"/);
    assert.match(rk(PNG, "rk-mini-avatar", "capa-rk-mini", null, LUIS),
      /class="capa-rk-mini avatar-png-personalizado"/);
  });

  test("sin prendas, o si una lista llega sin la persona, la silueta", () => {
    const { rk, cr } = montarComunidad();
    for (const html of [cr(null, "cr-capa-chica", { id: 38 }), cr(CAPAS, "cr-capa-chica"),
                        rk(CAPAS, "rk-podio-avatar", "capa-rk", null), rk({}, "x", "y", null, { id: 38 })]) {
      assert.match(html, /src="imagenes\/avatar\.png"/);
    }
  });

  test("y nunca una prenda suelta, pase lo que pase", () => {
    const { rk, cr } = montarComunidad();
    const casos = [[CAPAS, LUIS], [CAPAS, { id: 38 }], [CAPAS, undefined], [PNG, undefined],
                   [null, undefined], [JSON.stringify(CAPAS), undefined]];
    for (const [avatar, usuario] of casos) {
      for (const html of [cr(avatar, "c", usuario), rk(avatar, "a", "b", null, usuario)]) {
        assert.ok(!/prendas\/|imagenes\/tora|data-capas/.test(html), "salió una prenda: " + html);
      }
    }
  });

  test("las siete listas pasan la persona, no solo su avatar", () => {
    // La que lo olvide sale con siluetas.
    const rk = llamadasA(COMUNIDAD, "rkAvatarHTML");
    assert.equal(rk.length, 3, "cambió el número de usos de rkAvatarHTML");
    for (const uso of rk) {
      assert.match(uso, /, usuario\)$/, "esta llamada no pasa el usuario: " + uso);
    }

    const cr = llamadasA(COMUNIDAD, "crAvatarHTML");
    assert.equal(cr.length, 4, "cambió el número de usos de crAvatarHTML");
    for (const uso of cr) {
      assert.match(uso, /"cr-capa-chica",\s*\S/, "esta llamada no pasa la persona: " + uso);
    }
    // La actividad no es una persona: su id se llama usuario_id.
    assert.ok(cr.some(uso => /id: item\.usuario_id, avatar_compuesto: item\.avatar_compuesto/.test(uso)),
      "la actividad no pasa usuario_id");
  });

  test("y la página ya no sabe dibujar por capas", () => {
    for (const rastro of ["ORDEN_CAPAS_AVATAR", "rutaCapaAvatar", "data-capas", "RK_ORDEN_CAPAS", "rkRutaCapa"]) {
      assert.ok(!COMUNIDAD.includes(rastro), "queda " + rastro + " en js/comunidad-ranking.js");
    }
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

describe("la tienda de la comunidad", () => {

  test("sin previsualización no cae al dibujo suelto de la prenda", () => {
    // Ese dibujo es justo lo que no tiene que salir del equipo de arte.
    // Toda prenda tiene previsualización desde que se sube; si alguna
    // faltara, la caja se queda vacía.
    const i = COMUNIDAD.indexOf("async function crCargarTienda");
    assert.ok(i !== -1, "no está crCargarTienda");
    const cuerpo = COMUNIDAD.slice(i, COMUNIDAD.indexOf("\nasync function", i + 10));
    assert.match(cuerpo, /item\.previsualizacion/);
    for (const prohibido of ["rkRutaCapa", "rutaCapaAvatar", "valorCapa)", "/prendas/"]) {
      assert.ok(!cuerpo.includes(prohibido), "la tienda todavía usa " + prohibido);
    }
  });

});

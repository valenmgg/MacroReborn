// ==============================
// LA GEOMETRÍA DEL VESTIDOR — tests/vestidor-geometria.test.js
// ==============================
// El vestidor deja mover y escalar una prenda antes de publicarla, y al
// publicar dibuja ese ajuste DENTRO del PNG. O sea que hay dos cosas que
// tienen que coincidir: lo que se ve en pantalla y lo que sale del horno.
//
// Coinciden porque no hay dos cuentas. Hay una -vestEncuadreDeCapa- y
// dos consumidores que la escriben tal cual, uno en left/top/width/height
// y otro en drawImage. Este archivo prueba esa cuenta sola, sin navegador.
//
// Se recorta la ZONA A de js/arte-vestidor.js y se evalúa en un vm con
// un contexto mínimo: solo console. Si alguna función de la ZONA A se
// acopla al DOM, esto revienta con ReferenceError, y eso es información,
// no un estorbo.
//
// Correr:  npm test

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RUTA = path.join(__dirname, "..", "js", "arte-vestidor.js");
const FUENTE = fs.readFileSync(RUTA, "utf8");

const EXPORTA = `;({
  VEST_LIENZO_ANCHO, VEST_LIENZO_ALTO, VEST_AJUSTE_NEUTRO,
  VEST_DATA_PNG, VEST_TOPE_PRENDA, VEST_TOPE_CUERPO,
  normalizar: vestNormalizarAjuste,
  esNeutro: vestEsNeutro,
  puedeAjustarse: vestPuedeAjustarse,
  seriaIdentidad: vestSeriaIdentidad,
  hayQueHornear: vestHayQueHornear,
  anclaje: vestAnclaje,
  recorteDeAnclaje: vestRecorteDeAnclaje,
  pegado: vestEncuadrePegado,
  factorContain: vestFactorContain,
  encaje: vestEncajeContain,
  escalaDeEncaje: vestEscalaDeEncaje,
  encuadre: vestEncuadreDeCapa,
  estilo: vestEstiloDeCapa,
  medidasDeTexto: vestMedidasDeTexto,
  cajaEnLienzo: vestCajaEnLienzo,
  recorteDeCaja: vestRecorteDeCaja,
  resumen: vestResumenDeAjuste,
  instruccion: vestInstruccionParaElArchivo,
  pesoDeDataUrl: vestPesoDeDataUrl,
  bytesDeCuerpo: vestBytesDeCuerpo
})`;

function zonaA() {
  const i = FUENTE.indexOf("const VEST_LIENZO_ANCHO");
  const j = FUENTE.indexOf("// ZONA B — LA PANTALLA");
  assert.ok(i !== -1, "no se encontró el arranque de la ZONA A en js/arte-vestidor.js");
  assert.ok(j !== -1, "no se encontró la banda de la ZONA B en js/arte-vestidor.js");

  const contexto = { console: { warn() {}, error() {}, log() {} } };
  vm.createContext(contexto);
  return vm.runInContext(FUENTE.slice(i, j) + EXPORTA, contexto);
}

const V = zonaA();

// Las SIETE medidas que de verdad existen en el catálogo, leídas del
// IHDR de los 641 PNG de imagenes/:
//
//   327x504  504 archivos      326x504     1
//   327x505   86               654x1010    1   (cereza/espalda2)
//   326x503   42               332x512     1   (cereza/espalda3)
//                              415x640     1   (cereza/remera2)
//
// El 400x504 que se usa más abajo para ilustrar el encaje NO existe en
// el catálogo: es un ejemplo, y está marcado como tal donde aparece.
const MEDIDAS = [
  [327, 504], [327, 505], [326, 503], [326, 504],
  [654, 1010], [332, 512], [415, 640]
];

const NEUTRO = { dx: 0, dy: 0, escala: 100, espejo: false, alLienzo: false };

function casi(a, b, mensaje) {
  assert.ok(Math.abs(a - b) < 1e-9, (mensaje || "") + " — esperaba " + b + " y llegó " + a);
}

// Un objeto nacido dentro del vm tiene OTRO Object.prototype, y
// deepStrictEqual compara también el prototipo: rechazaría {x:0,y:0}
// contra {x:0,y:0} con un "same structure but not reference-equal" que no
// dice nada. Copiarlo a un objeto de este lado arregla la comparación sin
// aflojar nada: los valores se siguen comparando con Object.is, así que
// un -0 en vez de un 0 -que es justo lo que vestAnclaje tiene que evitar-
// sigue saltando.
function plano(o) {
  return o && typeof o === "object" ? Object.assign({}, o) : o;
}

function igual(actual, esperado, mensaje) {
  assert.deepStrictEqual(plano(actual), esperado, mensaje);
}

function item(ancho, alto, ajuste) {
  return { ancho, alto, ajuste: ajuste === undefined ? null : ajuste };
}

// ==============================

describe("el anclaje, que es de donde cuelga todo", () => {
  // G1. Si alguien quita este Math.round, nada se ve distinto a ojo y
  // todos los dibujos empiezan a salir interpolados. Es invisible sin
  // esta prueba.
  test("siempre cae en un número entero, para cualquier medida", () => {
    for (const [w, h] of MEDIDAS) {
      const n = V.anclaje(w, h);
      assert.ok(Number.isInteger(n.x), w + "x" + h + " deja x en " + n.x);
      assert.ok(Number.isInteger(n.y), w + "x" + h + " deja y en " + n.y);
    }
  });

  // G3. El sobrante impar va SIEMPRE arriba y a la izquierda: se rellena
  // por arriba/izquierda y se recorta por abajo/derecha.
  test("coloca cada familia exactamente donde dice el panel", () => {
    igual(V.anclaje(327, 504), { x: 0, y: 0 });
    igual(V.anclaje(327, 505), { x: 0, y: 0 });
    igual(V.anclaje(326, 503), { x: 1, y: 1 });
    igual(V.anclaje(326, 504), { x: 1, y: 0 });
    igual(V.anclaje(654, 1010), { x: -163, y: -253 });
    igual(V.anclaje(332, 512), { x: -2, y: -4 });
    igual(V.anclaje(415, 640), { x: -44, y: -68 });
  });

  test("y dice qué pierde y qué rellena en cada caso", () => {
    const cinco = V.recorteDeAnclaje(327, 505);
    igual(cinco.recorta, { izq: 0, arriba: 0, der: 0, abajo: 1 });
    igual(cinco.rellena, { izq: 0, arriba: 0, der: 0, abajo: 0 });

    const tres = V.recorteDeAnclaje(326, 503);
    igual(tres.recorta, { izq: 0, arriba: 0, der: 0, abajo: 0 });
    igual(tres.rellena, { izq: 1, arriba: 1, der: 0, abajo: 0 });

    const justo = V.recorteDeAnclaje(327, 504);
    igual(justo.recorta, { izq: 0, arriba: 0, der: 0, abajo: 0 });
    igual(justo.rellena, { izq: 0, arriba: 0, der: 0, abajo: 0 });
  });
});

describe("a escala 100 el horneado es un calco, no un remuestreo", () => {
  // G2. La prueba insignia. Coordenadas de destino enteras y tamaño de
  // destino idéntico al de origen es, literalmente, copiar píxeles: cero
  // interpolación, el dibujo de línea limpia sale intacto.
  //
  // El intento anterior usaba el encaje como base y solo conseguía esto
  // para 327x504, o sea el 79 % del catálogo. Con la base pegada sale
  // para el 100 %.
  test("mismas medidas y coordenadas enteras, en las siete medidas reales", () => {
    for (const [w, h] of MEDIDAS) {
      for (const dx of [-40, 0, 12]) {
        for (const dy of [-4, 0, 31]) {
          const e = V.pegado(w, h, { dx, dy, escala: 100 });
          const donde = w + "x" + h + " con dx=" + dx + " dy=" + dy;
          assert.strictEqual(e.ancho, w, donde + ": el ancho cambió");
          assert.strictEqual(e.alto, h, donde + ": el alto cambió");
          assert.ok(Number.isInteger(e.x), donde + ": x = " + e.x);
          assert.ok(Number.isInteger(e.y), donde + ": y = " + e.y);
        }
      }
    }
  });

  // Este es el caso que demostró que el problema no era el lienzo de
  // destino sino la BASE: en tora/pelo10 (326x504) el factor de encaje
  // es 1,000000 exacto -no hay nada que redimensionar- y con base encaje
  // el dibujo caía igualmente en x = 0,5, o sea interpolado entero para
  // moverlo medio píxel.
  test("incluido el 326x504, donde el factor de encaje es 1 y aun así el encaje interpolaba", () => {
    assert.strictEqual(V.factorContain(326, 504), 1);
    assert.strictEqual(V.encaje(326, 504).x, 0.5);          // lo que hacía antes
    assert.strictEqual(V.pegado(326, 504, null).x, 1);      // lo que hace ahora
  });

  // G10. Espejar tampoco interpola: la recta de reflexión cae en una
  // frontera de píxel o justo en el centro de uno.
  test("y espejar refleja sobre una recta que respeta los píxeles", () => {
    for (const [w, h] of MEDIDAS) {
      const e = V.pegado(w, h, { espejo: true });
      const cx = e.x + e.ancho / 2;
      assert.ok(Number.isInteger(cx * 2), w + "x" + h + " refleja sobre " + cx);
    }
  });
});

describe("lo que se ve es lo que se publica", () => {
  // G5. La demostración central: el MISMO predicado que decide si hay
  // horno decide qué rectángulo se pinta. No hay forma de que discrepen.
  test("el mismo predicado elige el rectángulo y elige si hay horno", () => {
    const casos = [
      item(327, 504, null),
      item(327, 504, NEUTRO),
      item(327, 504, { dx: 12 }),
      item(327, 504, Object.assign({}, NEUTRO, { alLienzo: true })),
      item(327, 505, null),
      item(327, 505, Object.assign({}, NEUTRO, { alLienzo: true })),
      item(654, 1010, { escala: 50, alLienzo: true })
    ];

    for (const i of casos) {
      const esperado = V.hayQueHornear(i)
        ? V.pegado(i.ancho, i.alto, i.ajuste)
        : V.encaje(i.ancho, i.alto);
      igual(V.encuadre(i), plano(esperado),
        JSON.stringify(i) + " pinta un rectángulo que no es el que se hornea");
    }
  });

  test("y el estilo del DOM son esos mismos números con px pegado", () => {
    const casos = [
      item(327, 504, { dx: 12, dy: -4 }),
      item(400, 504, null),
      item(654, 1010, { escala: 50 }),
      item(327, 504, { dx: 12, espejo: true })
    ];
    for (const i of casos) {
      const e = V.encuadre(i);
      igual(V.estilo(i), {
        left: e.x + "px",
        top: e.y + "px",
        width: e.ancho + "px",
        height: e.alto + "px",
        transform: e.espejo ? "scaleX(-1)" : "none"
      });
    }
  });

  // Lo de arriba deriva el valor esperado de la misma expresión que usa la
  // función, así que la rama del espejo pasaría aunque las dos estuvieran
  // mal. Acá va el literal: es lo que de verdad tiene que salir escrito en
  // el atributo style.
  test("y el espejo del DOM es un scaleX(-1), literalmente", () => {
    assert.strictEqual(V.estilo(item(327, 504, { dx: 12, espejo: true })).transform, "scaleX(-1)");
    assert.strictEqual(V.estilo(item(327, 504, { dx: 12 })).transform, "none");
    assert.strictEqual(V.estilo(item(327, 504, null)).transform, "none");
  });

  // G4. Para cinco de cada seis dibujos las dos ramas son la MISMA, así
  // que el artista no ve ningún salto al dar su primer ajuste.
  test("para un PNG del lienzo, encajar y pegar son la misma cosa", () => {
    igual(V.encaje(327, 504), plano(V.pegado(327, 504, null)));
  });
});

describe("el número del panel es el número del exportador", () => {
  // G6. Con el encaje como base, el ancho dibujado era w*k*s: un "103 %"
  // sobre un PNG de 327x505 era en realidad un 102,8 % de su exportador,
  // y la frase accionable corregía el desplazamiento pero dejaba la
  // escala mintiendo.
  test("la escala es exacta para cualquier medida", () => {
    for (const [w, h] of MEDIDAS) {
      for (const escala of [50, 99, 103, 200]) {
        const e = V.pegado(w, h, { escala });
        assert.strictEqual(e.ancho, w * (escala / 100), w + "x" + h + " al " + escala + " %");
        assert.strictEqual(e.alto, h * (escala / 100));
      }
    }
  });

  test("y el desplazamiento suma píxeles del archivo tal cual", () => {
    for (const [w, h] of MEDIDAS) {
      const quieto = V.pegado(w, h, null);
      const movido = V.pegado(w, h, { dx: 12, dy: -4 });
      casi(movido.x - quieto.x, 12, w + "x" + h + " en x");
      casi(movido.y - quieto.y, -4, w + "x" + h + " en y");
      assert.strictEqual(movido.ancho, w, "y no cambia de tamaño al moverse");
    }
  });

  // La propiedad que hace que "+12 px" signifique algo: subir un
  // sombrero del 100 % al 103 % no lo saca de la cabeza.
  test("escalar no mueve el centro de la capa", () => {
    for (const escala of [10, 25, 99, 100, 101, 103, 200, 400]) {
      for (const dx of [-40, 0, 17]) {
        // El caso literal del 92,9 % del catálogo: todo lo que mide 327
        // de ancho tiene su centro en 163,5.
        const e = V.pegado(327, 504, { escala, dx });
        casi(e.x + e.ancho / 2, 163.5 + dx, "327x504 al " + escala + " % con dx=" + dx);

        // Y en general, el centro es el del anclaje más el desplazamiento.
        for (const [w, h] of MEDIDAS) {
          const g = V.pegado(w, h, { escala, dx });
          casi(g.x + g.ancho / 2, V.anclaje(w, h).x + w / 2 + dx, w + "x" + h);
        }
      }
    }
  });

  test("el espejo no mueve nada de sitio", () => {
    const sin = V.pegado(327, 505, { dx: 12 });
    const con = V.pegado(327, 505, { dx: 12, espejo: true });
    assert.strictEqual(con.x, sin.x);
    assert.strictEqual(con.y, sin.y);
    assert.strictEqual(con.ancho, sin.ancho);
    assert.strictEqual(con.espejo, true);
    assert.strictEqual(sin.espejo, false);
  });
});

describe("el encaje, que ahora solo sirve para exhibir", () => {
  // Las capas del CATÁLOGO se siguen pintando encajadas, porque así es
  // como las muestra el editor de verdad. El maniquí tiene que enseñar
  // el fondo de comparación tal como lo verá el usuario.
  test("un PNG del lienzo llena el marco entero", () => {
    igual(V.encaje(327, 504),
      { x: 0, y: 0, ancho: 327, alto: 504, espejo: false });
  });

  test("pero uno de 400x504 no: se encaja y le quedan bandas", () => {
    // 400x504 no existe en el catálogo; es el ejemplo clásico de la
    // trampa de object-fit:contain, escrito como cifra.
    const e = V.encaje(400, 504);
    casi(V.factorContain(400, 504), 0.8175, "el factor");
    casi(e.x, 0, "x");
    casi(e.y, 45.99, "y");
    casi(e.ancho, 327, "ancho");
    casi(e.alto, 412.02, "alto");
  });

  test("y uno de 327x1008 se encaja por el alto", () => {
    igual(V.encaje(327, 1008),
      { x: 81.75, y: 0, ancho: 163.5, alto: 504, espejo: false });
  });

  test("si no se pudo medir, se comporta como hasta ahora", () => {
    igual(V.encaje(0, 0),
      { x: 0, y: 0, ancho: 327, alto: 504, espejo: false });
    assert.strictEqual(V.factorContain(0, 0), 1);
  });

  // G7. Es lo que justifica que el botón "Encajar" no se pinte en 61 de
  // los 64 dibujos descuadrados: a esos les basta con recortar o rellenar
  // una fila, que no remuestrea nada.
  test("llevar al lienzo no es encajar, y solo tres bichos necesitan encaje", () => {
    assert.strictEqual(V.escalaDeEncaje(327, 504), 100);
    assert.strictEqual(V.escalaDeEncaje(327, 505), 100);
    assert.strictEqual(V.escalaDeEncaje(326, 503), 100);
    assert.strictEqual(V.escalaDeEncaje(326, 504), 100);

    assert.strictEqual(V.escalaDeEncaje(654, 1010), 50);
    assert.strictEqual(V.escalaDeEncaje(332, 512), 98);
    assert.strictEqual(V.escalaDeEncaje(415, 640), 79);
  });
});

describe("quién pasa por el horno y quién no", () => {
  test("qué cuenta como no haber movido nada", () => {
    assert.strictEqual(V.esNeutro(null), true);
    assert.strictEqual(V.esNeutro(NEUTRO), true);
    // alLienzo no es una transformación: no cuenta para esto.
    assert.strictEqual(V.esNeutro(Object.assign({}, NEUTRO, { alLienzo: true })), true);

    assert.strictEqual(V.esNeutro({ dx: 1 }), false);
    assert.strictEqual(V.esNeutro({ escala: 99 }), false);
    assert.strictEqual(V.esNeutro({ espejo: true }), false);
  });

  test("un item sin ajuste nunca se hornea", () => {
    assert.strictEqual(V.hayQueHornear(item(327, 505, null)), false);
    assert.strictEqual(V.hayQueHornear(item(654, 1010, null)), false);
    assert.strictEqual(V.hayQueHornear(null), false);
  });

  test("mover y volver a cero también sube el original", () => {
    assert.strictEqual(V.hayQueHornear(item(327, 505, NEUTRO)), false);
  });

  // La única forma de llevar un PNG descuadrado al lienzo canónico sin
  // fingir un desplazamiento de un píxel, que es lo que haría falta si
  // esto no existiera... y ese píxel falso quedaría grabado para siempre
  // en avatar_archivos.
  test("pero alLienzo obliga a hornear aunque no se haya movido nada", () => {
    assert.strictEqual(
      V.hayQueHornear(item(327, 505, Object.assign({}, NEUTRO, { alLienzo: true }))), true);
  });

  // G8. Cierra la duplicación de filas que abre "aplicar este ajuste a
  // todas las de esta ranura" cuando alguna hermana ya estaba bien.
  test("salvo que hornear fuera la identidad, que no es hornear", () => {
    const yaEstaBien = item(327, 504, Object.assign({}, NEUTRO, { alLienzo: true }));
    assert.strictEqual(V.seriaIdentidad(yaEstaBien), true);
    assert.strictEqual(V.hayQueHornear(yaEstaBien), false);
  });

  // G9. js/arte.js deja ancho y alto en 0 cuando el navegador no
  // consiguió decodificar la imagen. Ese item no se puede ajustar, pero
  // tampoco se pinta de 0x0: se enseña encajado como cualquier otro.
  test("sin medidas no se ajusta nada, pero se sigue viendo", () => {
    assert.strictEqual(V.puedeAjustarse(item(0, 0, null)), false);
    assert.strictEqual(V.puedeAjustarse(item(327, 504, null)), true);

    igual(V.encuadre(item(0, 0, { dx: 12 })),
      { x: 0, y: 0, ancho: 327, alto: 504, espejo: false });

    // Y sigue pidiendo horno, para que el horno pueda negarse en voz
    // alta en vez de subir el original como si nada hubiera pasado.
    assert.strictEqual(V.hayQueHornear(item(0, 0, { dx: 12 })), true);
  });
});

describe("el ajuste que llega de fuera no se cree nada", () => {
  test("cadenas, NaN y disparates salen enteros y dentro de los topes", () => {
    igual(V.normalizar({ dx: "7", dy: -3.6, escala: "103", espejo: 1 }),
      { dx: 7, dy: -4, escala: 103, espejo: false, alLienzo: false });

    igual(V.normalizar({ dx: 99999, dy: -99999, escala: 0 }),
      { dx: 1000, dy: -1000, escala: 10, espejo: false, alLienzo: false });

    igual(V.normalizar({ dx: NaN, escala: "abc" }),
      { dx: 0, dy: 0, escala: 100, espejo: false, alLienzo: false });

    assert.strictEqual(V.normalizar(null), V.VEST_AJUSTE_NEUTRO);
    assert.strictEqual(V.normalizar("hola"), V.VEST_AJUSTE_NEUTRO);
  });

  test("y el neutro está congelado, porque se devuelve por referencia", () => {
    assert.ok(Object.isFrozen(V.VEST_AJUSTE_NEUTRO));
  });

  test("la escala tope no deja achicar hasta desaparecer", () => {
    assert.strictEqual(V.normalizar({ escala: -50 }).escala, 10);
    assert.strictEqual(V.normalizar({ escala: 9999 }).escala, 400);
  });
});

describe("las medidas de lo ya publicado", () => {
  // avatar-panel manda las medidas en una cadena (api/content.js:96).
  test("se leen de la cadena que manda el servidor", () => {
    igual(V.medidasDeTexto("332x512"), { ancho: 332, alto: 512 });
    igual(V.medidasDeTexto("327x504"), { ancho: 327, alto: 504 });
  });

  test("y una cadena rara no inventa un tamaño", () => {
    igual(V.medidasDeTexto(""), { ancho: 0, alto: 0 });
    igual(V.medidasDeTexto("327 x 504"), { ancho: 0, alto: 0 });
    igual(V.medidasDeTexto(undefined), { ancho: 0, alto: 0 });
  });
});

describe("lo que se sale del lienzo", () => {
  test("la caja de tinta se mapea con el mismo encuadre", () => {
    // Una caja que cubre el archivo entero tiene que caer exactamente
    // sobre el rectángulo del encuadre.
    const w = 400, h = 504, ajuste = { escala: 103 };
    const e = V.pegado(w, h, ajuste);
    const caja = V.cajaEnLienzo({ x: 0, y: 0, ancho: w, alto: h }, w, h, ajuste);
    casi(caja.x, e.x, "x");
    casi(caja.y, e.y, "y");
    casi(caja.ancho, e.ancho, "ancho");
    casi(caja.alto, e.alto, "alto");
  });

  test("y dice cuánto se pierde por cada lado", () => {
    igual(
      V.recorteDeCaja({ x: -3.2, y: 0, ancho: 10, alto: 10 }),
      { izq: 4, arriba: 0, der: 0, abajo: 0 });

    igual(
      V.recorteDeCaja({ x: 0, y: 0, ancho: 327, alto: 504 }),
      { izq: 0, arriba: 0, der: 0, abajo: 0 });

    igual(
      V.recorteDeCaja({ x: -163, y: -253, ancho: 654, alto: 1010 }),
      { izq: 163, arriba: 253, der: 164, abajo: 253 });
  });

  test("un 327x505 llevado al lienzo pierde exactamente una fila", () => {
    const caja = V.cajaEnLienzo({ x: 0, y: 0, ancho: 327, alto: 505 }, 327, 505,
      Object.assign({}, NEUTRO, { alLienzo: true }));
    igual(V.recorteDeCaja(caja),
      { izq: 0, arriba: 0, der: 0, abajo: 1 });
  });

  // El espejo hay que aplicarlo también a la caja, y sobre la misma recta
  // que usa el horno. Sin esto, el dibujo se refleja y la caja no, así que
  // el aviso de recorte señala el lado contrario: avisa de lo que no se
  // pierde y calla lo que sí.
  //
  // Se necesita una caja ASIMÉTRICA para verlo. Con la caja del archivo
  // entero -la única que se podía construir hasta ahora- el fallo es
  // invisible, porque reflejar un rectángulo centrado lo deja donde estaba.
  test("y el espejo mueve la caja al otro lado, como mueve el dibujo", () => {
    const tintaIzquierda = { x: 0, y: 100, ancho: 50, alto: 200 };

    // Sin espejo, correr 30 px a la izquierda pierde esos 30 px.
    const quieta = V.cajaEnLienzo(tintaIzquierda, 327, 504, { dx: -30 });
    igual(V.recorteDeCaja(quieta), { izq: 30, arriba: 0, der: 0, abajo: 0 });

    // Con espejo, esa misma tinta acaba a la derecha del lienzo y no se
    // pierde ni un píxel.
    const reflejada = V.cajaEnLienzo(tintaIzquierda, 327, 504, { dx: -30, espejo: true });
    igual(V.recorteDeCaja(reflejada), { izq: 0, arriba: 0, der: 0, abajo: 0 });

    // Y al revés: moviéndola a la derecha con espejo, lo que se pierde se
    // pierde por la derecha.
    const alOtroLado = V.cajaEnLienzo(tintaIzquierda, 327, 504, { dx: 30, espejo: true });
    igual(V.recorteDeCaja(alOtroLado), { izq: 0, arriba: 0, der: 30, abajo: 0 });
  });
});

describe("lo que se le enseña al artista", () => {
  test("los números que se enseñan son los que se aplican", () => {
    assert.strictEqual(
      V.resumen({ dx: 12, dy: -4, escala: 103, espejo: true }),
      "+12 px · −4 px · 103 % · espejo");
    assert.strictEqual(V.resumen(null), "sin ajuste");
    assert.strictEqual(V.resumen(NEUTRO), "sin ajuste");
  });

  // El requisito de fondo: que el artista pueda arreglar SU archivo y
  // volver a subirlo sin ajuste, en vez de que el apaño viva dentro de
  // nuestra web para siempre.
  test("y la frase habla en píxeles de su archivo", () => {
    const frase = V.instruccion({ dx: 12, dy: -4 }, 327, 505);
    assert.match(frase, /12 px a la derecha/);
    assert.match(frase, /4 px arriba/);

    // Y esos 12 son 12 de verdad: el rectángulo mide 327*1,03 exacto, no
    // 327*0,998*1,03, que es lo que daba la base encaje.
    assert.strictEqual(V.pegado(327, 505, { dx: 12, dy: -4, escala: 103 }).ancho, 327 * 1.03);
  });

  // EL ORDEN IMPORTA, y por eso la frase lo dice.
  //
  // En vestEncuadrePegado el desplazamiento se suma DESPUÉS de escalar, y
  // el espejo refleja sobre el centro del rectángulo ya desplazado. O sea
  // que dx está medido en píxeles de la EXPORTACIÓN. A escala 100 da
  // igual -es el caso de todo el catálogo menos tres dibujos- pero al
  // 50 % no: alguien que leyera "mové 40 px, exportá al 50 %" y lo
  // hiciera en ese orden acabaría a mitad de camino.
  test("y dice el orden, porque hacerlo al revés da otro resultado", () => {
    const frase = V.instruccion({ dx: 40, escala: 50, espejo: true }, 327, 504);

    assert.match(frase, /por este orden/);

    const espejo = frase.indexOf("espejá");
    const exportar = frase.indexOf("exportalo");
    const mover = frase.indexOf("movelo");

    assert.ok(espejo !== -1 && exportar !== -1 && mover !== -1, frase);
    assert.ok(espejo < exportar, "el espejo va antes de exportar: " + frase);
    assert.ok(exportar < mover, "mover va al final, sobre lo ya exportado: " + frase);

    // Y cuando la escala cambia, se dice sobre qué se mide el movimiento.
    assert.match(frase, /sobre esa exportación/);
  });

  test("pero a escala 100 no se añade ninguna coletilla, porque no hace falta", () => {
    const frase = V.instruccion({ dx: 12 }, 327, 504);
    assert.match(frase, /^En tu archivo: movelo 12 px a la derecha.$/);
    assert.doesNotMatch(frase, /exportación/);
    assert.doesNotMatch(frase, /exportalo/);
  });

  test("y sabe cuándo no hay nada que decir", () => {
    assert.match(V.instruccion(null, 327, 504), /tal cual/);
    assert.match(V.instruccion(Object.assign({}, NEUTRO, { alLienzo: true }), 327, 505),
      /lienzo de 327×504/);
    assert.match(V.instruccion({ dx: 12 }, 0, 0), /no se puede ajustar/);
  });
});

describe("los dos pesos, que se cuentan distinto a propósito", () => {
  // server.js:126 corta el cuerpo por bytes RECIBIDOS, y lo que se recibe
  // es el base64, que abulta un tercio más que el PNG. Confundirlos manda
  // 12 MB creyendo que son 9.
  test("uno mide el PNG y el otro la cadena que viaja", () => {
    const url = "data:image/png;base64," + "A".repeat(12);
    assert.strictEqual(V.pesoDeDataUrl(url), 9);
    assert.strictEqual(V.bytesDeCuerpo(url), 34);
    assert.notStrictEqual(V.pesoDeDataUrl(url), V.bytesDeCuerpo(url));
  });

  test("y el relleno del base64 no se cuenta como dibujo", () => {
    assert.strictEqual(V.pesoDeDataUrl("data:image/png;base64," + "A".repeat(10) + "=="), 7);
    assert.strictEqual(V.pesoDeDataUrl("data:image/png;base64," + "A".repeat(11) + "="), 8);
    assert.strictEqual(V.pesoDeDataUrl("sin coma"), 0);
  });

});

// ==============================
// EL CONTRATO CON EL SERVIDOR
// ==============================
// Estas tres pruebas LEEN el servidor. Antes comparaban las constantes
// del cliente contra las mismas cifras escritas a mano acá, o sea que
// decían "1 MB es 1 MB" y se habrían quedado verdes para siempre aunque
// api/content.js cambiara de opinión. Una prueba que no puede fallar por
// el motivo que dice su nombre no es una prueba.

const FUENTE_CONTENT = fs.readFileSync(
  path.join(__dirname, "..", "api", "content.js"), "utf8");
const FUENTE_SERVER = fs.readFileSync(
  path.join(__dirname, "..", "server.js"), "utf8");

function constanteDelServidor(fuente, nombre) {
  const m = new RegExp("const " + nombre + "\\s*=\\s*([0-9*\\s]+);").exec(fuente);
  assert.ok(m, "no se encontró " + nombre + " en el servidor");
  // Solo dígitos, espacios y asteriscos: es una multiplicación, no código.
  return m[1].trim().split("*").reduce((a, b) => a * Number(b.trim()), 1);
}

describe("el contrato con el servidor, leído del servidor", () => {
  test("acepta y rechaza exactamente lo mismo que leerPngSubido", () => {
    // Se saca la expresión del propio api/content.js, recortando la línea
    // entre sus dos barras. La del cliente no lleva grupo de captura, así
    // que compararlas como texto daría un falso negativo: lo que importa
    // es que las dos decidan lo mismo sobre las mismas cadenas.
    const i = FUENTE_CONTENT.indexOf("texto.match(");
    assert.ok(i !== -1, "no se encontró leerPngSubido en api/content.js");

    const linea = FUENTE_CONTENT.slice(i, FUENTE_CONTENT.indexOf("\n", i));
    const a = linea.indexOf("/");
    const b = linea.lastIndexOf("/");
    assert.ok(a !== -1 && b > a, "no se pudo recortar la expresión de: " + linea);

    const delServidor = new RegExp(linea.slice(a + 1, b));

    const casos = [
      "data:image/png;base64,AAAA",
      "data:image/png;base64,AA==",
      "data:image/png;base64,",
      "data:image/jpeg;base64,AAAA",
      "data:image/png;charset=utf-8;base64,AAAA",
      "data:image/png;base64,AA AA",
      "data:image/png;base64,AA\nAA",
      " data:image/png;base64,AAAA",
      "data:image/png;base64,AAAA ",
      "AAAA"
    ];

    for (const c of casos) {
      assert.strictEqual(V.VEST_DATA_PNG.test(c), delServidor.test(c),
        "el cliente y el servidor no opinan igual sobre " + JSON.stringify(c));
    }
  });

  test("el tope por prenda es el de api/content.js", () => {
    assert.strictEqual(V.VEST_TOPE_PRENDA,
      constanteDelServidor(FUENTE_CONTENT, "TOPE_POR_PRENDA"));
  });

  // Este NO tiene que ser igual, tiene que ser MENOR: el servidor corta a
  // los 12 MB del cuerpo entero, y en el cuerpo viaja el JSON con todas
  // las prendas de la tanda más sus nombres. El cliente se guarda margen.
  test("y el presupuesto de la tanda cabe con holgura en el del servidor", () => {
    const limiteCuerpo = constanteDelServidor(FUENTE_SERVER, "LIMITE_CUERPO");
    assert.ok(V.VEST_TOPE_CUERPO < limiteCuerpo,
      "el cliente presupuesta " + V.VEST_TOPE_CUERPO + " y el servidor corta en " + limiteCuerpo);
    assert.ok(V.VEST_TOPE_CUERPO >= limiteCuerpo * 0.5,
      "tanto margen deja la tanda innecesariamente pequeña");
  });
});

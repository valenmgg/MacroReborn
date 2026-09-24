// ==============================
// LA CONEXIÓN ABIERTA — tests/avisos-sse.test.js
// ==============================
// api/_avisos-sse.js es la cara HTTP del reparto de avisos: el sitio
// donde un navegador deja una línea abierta y espera.
//
// Casi todo se prueba con un `req`/`res` de mentira, porque lo que
// importa son los bytes que se escriben y quién queda apuntado o
// desapuntado, no el socket. Pero el formato en el cable se prueba
// contra un servidor HTTP de verdad y un cliente de verdad: es el único
// modo de cazar un salto de línea de más, que es el fallo clásico de
// SSE y no se ve en ninguna comprobación de igualdad de objetos.
//
// Correr:  npm test

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret";

require("./_aislar-datos");   // antes de api/: ver ese archivo

const { test, describe, beforeEach, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { EventEmitter } = require("node:events");

const sse = require("../api/_avisos-sse");
const avisos = require("../api/_avisos");

// ---------- dobles ----------

function resFalso() {
  const res = new EventEmitter();
  res.escrito = "";
  res.codigo = 0;
  res.cabeceras = {};
  res.writableLength = 0;
  res.destruido = false;
  res.writeHead = (codigo, cabeceras) => {
    res.codigo = codigo;
    res.cabeceras = cabeceras || {};
    return res;
  };
  res.write = (texto) => { res.escrito += texto; return true; };
  res.end = (texto) => { if (texto) res.escrito += texto; return res; };
  res.destroy = () => { res.destruido = true; };
  return res;
}

function reqFalso(metodo) {
  const req = new EventEmitter();
  req.method = metodo || "GET";
  return req;
}

function urlDe(cadena) {
  return new URL(cadena, "http://localhost");
}

// Abre una conexión y devuelve las tres piezas, dejándola registrada
// para que el beforeEach la cierre pase lo que pase.
let abiertas = [];
function abrir(canales, metodo) {
  const req = reqFalso(metodo);
  const res = resFalso();
  const cerrar = sse.atender(req, res, urlDe("/api/avisos?canales=" + canales));
  abiertas.push({ req, res, cerrar });
  return { req, res, cerrar };
}

beforeEach(() => {
  for (const c of abiertas) if (typeof c.cerrar === "function") c.cerrar();
  abiertas = [];
  assert.equal(sse.cuantasAbiertas(), 0, "quedaron conexiones de un test anterior");
  assert.equal(avisos.cuantasEscuchas(), 0, "quedaron escuchas de un test anterior");
});

// ---------- lo que se rechaza ----------

describe("lo que ni siquiera abre conexión", () => {

  test("un método que no es GET", () => {
    const res = resFalso();
    sse.atender(reqFalso("POST"), res, urlDe("/api/avisos?canales=a"));
    assert.equal(res.codigo, 405);
    assert.equal(res.cabeceras.Allow, "GET");
    assert.equal(sse.cuantasAbiertas(), 0);
  });

  test("una petición sin canales", () => {
    const res = resFalso();
    sse.atender(reqFalso("GET"), res, urlDe("/api/avisos"));
    assert.equal(res.codigo, 400);
    assert.equal(sse.cuantasAbiertas(), 0, "una petición rechazada no puede contar como conexión");
  });

  test("y unos canales que son solo comas y espacios", () => {
    const res = resFalso();
    sse.atender(reqFalso("GET"), res, urlDe("/api/avisos?canales=,,%20,"));
    assert.equal(res.codigo, 400);
  });

  test("cuando el proceso está lleno, un 503 con Retry-After", () => {
    // El techo es lo único que separa a una máquina de 950 MB de quedarse
    // sin memoria por conexiones ociosas, así que conviene comprobar que
    // de verdad frena en el número y no una conexión más tarde.
    for (let i = 0; i < sse.TOPE_CONEXIONES; i++) abrir("lleno");
    assert.equal(sse.cuantasAbiertas(), sse.TOPE_CONEXIONES);

    const res = resFalso();
    sse.atender(reqFalso("GET"), res, urlDe("/api/avisos?canales=a"));
    assert.equal(res.codigo, 503);
    assert.equal(res.cabeceras["Retry-After"], "30");
  });
});

// ---------- la conexión que sí se abre ----------

describe("la conexión abierta", () => {

  test("responde 200 con las cabeceras que hacen falta", () => {
    const { res } = abrir("notificaciones-luis");

    assert.equal(res.codigo, 200);
    assert.equal(res.cabeceras["Content-Type"], "text/event-stream; charset=utf-8");
    // Sin esta, nginx se queda la respuesta entera en su buffer y no
    // suelta un byte hasta que se cierre, que aquí no pasa nunca.
    assert.equal(res.cabeceras["X-Accel-Buffering"], "no");
    assert.match(res.cabeceras["Cache-Control"], /no-cache/);
    assert.match(res.cabeceras["Cache-Control"], /no-transform/);
  });

  test("y lo primero que manda es el retry y una señal de vida", () => {
    const { res } = abrir("notificaciones-luis");
    assert.match(res.escrito, /^retry: \d+\n: abierto\n\n$/);
  });

  test("el retry no es siempre el mismo número", () => {
    // Al reiniciar el servicio se caen TODAS las conexiones a la vez. Con
    // un retry fijo volverían todas juntas al mismo segundo.
    const vistos = new Set();
    for (let i = 0; i < 30; i++) {
      const { res } = abrir("notificaciones-luis");
      vistos.add(res.escrito.match(/^retry: (\d+)/)[1]);
    }
    assert.ok(vistos.size > 1, "el retry salió idéntico 30 veces seguidas");
  });

  test("queda apuntada al canal que pidió", () => {
    abrir("notificaciones-luis");
    assert.equal(avisos.cuantosEscuchan("notificaciones-luis"), 1);
  });

  test("a varios canales si pidió varios, con una sola conexión", () => {
    // js/usuario.js necesita dos: el tuyo y el del perfil que estás
    // mirando. Con Pusher eso eran dos conexiones distintas.
    abrir("notificaciones-luis,notificaciones-pepe");

    assert.equal(sse.cuantasAbiertas(), 1, "debería ser UNA conexión");
    assert.equal(avisos.cuantosEscuchan("notificaciones-luis"), 1);
    assert.equal(avisos.cuantosEscuchan("notificaciones-pepe"), 1);
  });

  test("pero no a más de los que permite el tope", () => {
    const muchos = [];
    for (let i = 0; i < 20; i++) muchos.push("canal" + i);
    abrir(muchos.join(","));

    let apuntados = 0;
    for (const c of muchos) apuntados += avisos.cuantosEscuchan(c);
    assert.equal(apuntados, sse.TOPE_CANALES);
  });

  test("y descarta un nombre de canal absurdamente largo", () => {
    const largo = "x".repeat(sse.TOPE_NOMBRE + 1);
    abrir("notificaciones-luis," + largo);

    assert.equal(avisos.cuantosEscuchan(largo), 0);
    assert.equal(avisos.cuantosEscuchan("notificaciones-luis"), 1);
  });
});

// ---------- entregar ----------

describe("lo que llega por la línea", () => {

  test("un aviso sale como un evento con sus datos", async () => {
    // Con un evento público de muestra: por una línea sin pase el buzón
    // ya no sale, y eso se prueba aparte en "quién puede oír qué".
    const { res } = abrir("notificaciones-luis");
    res.escrito = "";

    await avisos.avisar("notificaciones-luis", "nuevo-logro", { titulo: "Hola" });

    assert.equal(res.escrito,
      'event: nuevo-logro\ndata: {"canal":"notificaciones-luis","datos":{"titulo":"Hola"}}\n\n');
  });

  test("y cada aviso dice por que canal vino", async () => {
    // La razon de que el canal viaje dentro del mensaje. usuario.html
    // escucha DOS canales por la misma conexion -el tuyo y el del perfil
    // que miras- y los dos mandan los mismos eventos. Sin esto, un
    // comentario en el perfil ajeno repintaria tambien el propio.
    const { res } = abrir("notificaciones-luis,notificaciones-pepe");
    res.escrito = "";

    await avisos.avisar("notificaciones-pepe", "nuevo-comentario", { id: 3 });

    const linea = res.escrito.split("\n").find(l => l.startsWith("data: "));
    const sobre = JSON.parse(linea.slice("data: ".length));

    assert.equal(sobre.canal, "notificaciones-pepe");
    assert.deepStrictEqual(sobre.datos, { id: 3 });
  });

  test("un aviso de otro canal no se cuela", async () => {
    const { res } = abrir("notificaciones-luis");
    res.escrito = "";

    await avisos.avisar("notificaciones-pepe", "nuevo-logro", {});

    assert.equal(res.escrito, "");
  });

  test("un salto de línea dentro de los datos no parte el mensaje", async () => {
    // EL fallo clásico de SSE: una línea en blanco cierra el mensaje, así
    // que un salto de línea sin escapar dentro del contenido corta el
    // aviso por la mitad y el navegador recibe basura. JSON.stringify lo
    // escapa, pero conviene que esté sujeto: el día que alguien decida
    // mandar el texto tal cual, esto se entera.
    const { res } = abrir("notificaciones-luis");
    res.escrito = "";

    await avisos.avisar("notificaciones-luis", "nuevo-comentario", {
      mensaje: "primera\nsegunda\n\ntercera"
    });

    const lineas = res.escrito.split("\n");
    assert.equal(lineas.filter(l => l.startsWith("data: ")).length, 1);
    assert.equal(lineas[lineas.length - 3],
      'data: {"canal":"notificaciones-luis","datos":{"mensaje":"primera\\nsegunda\\n\\ntercera"}}');
  });

  test("sin datos manda null y no la palabra undefined", async () => {
    const { res } = abrir("notificaciones-luis");
    res.escrito = "";

    await avisos.avisar("notificaciones-luis", "comentarios-vaciados");

    assert.equal(res.escrito,
      'event: comentarios-vaciados\ndata: {"canal":"notificaciones-luis","datos":null}\n\n');
  });
});

// ---------- cerrar ----------

describe("cuando la conexión se va", () => {

  test("el navegador que se marcha deja de estar apuntado", () => {
    const { req } = abrir("notificaciones-luis");
    assert.equal(avisos.cuantosEscuchan("notificaciones-luis"), 1);

    req.emit("close");

    assert.equal(avisos.cuantosEscuchan("notificaciones-luis"), 0);
    assert.equal(sse.cuantasAbiertas(), 0);
  });

  test("y sus canales se sueltan todos, no solo el primero", () => {
    const { req } = abrir("notificaciones-luis,notificaciones-pepe");
    req.emit("close");

    assert.equal(avisos.cuantosEscuchan("notificaciones-luis"), 0);
    assert.equal(avisos.cuantosEscuchan("notificaciones-pepe"), 0);
    assert.equal(avisos.cuantasEscuchas(), 0);
  });

  test("un cierre por partida doble no descuenta dos veces", () => {
    // Saltan los tres avisos -close del pedido, close de la respuesta,
    // error del socket- y es normal que salten varios. Sin la guarda, el
    // contador se va a negativo y el tope deja de frenar nada.
    abrir("a");
    const { req, res } = abrir("b");

    req.emit("close");
    res.emit("close");
    res.emit("error", new Error("roto"));

    assert.equal(sse.cuantasAbiertas(), 1, "el contador se descontó de más");
  });

  test("ya cerrada, un aviso no intenta escribir en ella", async () => {
    const { req, res } = abrir("notificaciones-luis");
    req.emit("close");
    res.escrito = "";

    await avisos.avisar("notificaciones-luis", "uno", {});

    assert.equal(res.escrito, "");
  });
});

describe("el navegador que deja de leer", () => {

  test("se le corta cuando lo pendiente ya no cabe", async () => {
    // Pestaña congelada o red muerta: Node acumula en memoria todo lo que
    // no puede entregar. Sin este corte, una sola conexión así se come la
    // RAM del proceso.
    const { res } = abrir("notificaciones-luis");
    res.writableLength = sse.TOPE_PENDIENTE + 1;
    res.escrito = "";

    await avisos.avisar("notificaciones-luis", "uno", {});

    assert.equal(res.destruido, true, "no se cortó la conexión atascada");
    assert.equal(res.escrito, "", "escribió igual en una conexión atascada");
    assert.equal(sse.cuantasAbiertas(), 0, "la conexión cortada siguió contando");
    assert.equal(avisos.cuantosEscuchan("notificaciones-luis"), 0);
  });
});

// ---------- en el cable ----------

describe("contra un servidor de verdad", () => {

  let servidor = null;

  after(() => { if (servidor) servidor.close(); });

  test("el navegador recibe el evento con el formato que espera", async () => {
    servidor = http.createServer((req, res) => {
      sse.atender(req, res, new URL(req.url, "http://localhost"));
    });
    await new Promise(listo => servidor.listen(0, "127.0.0.1", listo));
    const puerto = servidor.address().port;

    const trozos = [];
    const respuesta = await new Promise((resolver, rechazar) => {
      const pedido = http.get(
        `http://127.0.0.1:${puerto}/api/avisos?canales=notificaciones-luis`,
        resolver
      );
      pedido.on("error", rechazar);
    });

    assert.equal(respuesta.statusCode, 200);
    assert.match(respuesta.headers["content-type"], /text\/event-stream/);

    respuesta.setEncoding("utf8");
    respuesta.on("data", t => trozos.push(t));

    // El aviso se emite una vez que la conexión ya está apuntada.
    await new Promise(seguir => setTimeout(seguir, 50));
    await avisos.avisar("notificaciones-luis", "nuevo-logro", { achievementId: 7 });
    await new Promise(seguir => setTimeout(seguir, 50));

    const recibido = trozos.join("");
    assert.match(recibido, /^retry: \d+\n: abierto\n\n/);
    assert.ok(
      recibido.includes('event: nuevo-logro\ndata: {"canal":"notificaciones-luis","datos":{"achievementId":7}}\n\n'),
      "no llegó el evento con el formato de SSE; llegó: " + JSON.stringify(recibido)
    );

    respuesta.destroy();
    await new Promise(seguir => setTimeout(seguir, 50));
    assert.equal(avisos.cuantosEscuchan("notificaciones-luis"), 0, "no se soltó al cerrar el cliente");
  });
});

// ---------- quién puede oír qué ----------

const { crearPase, crearToken } = require("../api/_auth");

// La misma conexión de abrir(), pero con un pase en la URL.
function abrirConPase(canales, pase) {
  const req = reqFalso("GET");
  const res = resFalso();
  const url = urlDe("/api/avisos?canales=" + canales + (pase ? "&pase=" + encodeURIComponent(pase) : ""));
  const cerrar = sse.atender(req, res, url);
  abiertas.push({ req, res, cerrar });
  return { req, res, cerrar };
}

const luis = { sub: 7, username: "Luis" };

describe("quién puede oír qué", () => {

  test("sin pase, el buzón de una persona no sale por la línea", async () => {
    // Esto es lo que estaba abierto: cualquiera, sin cuenta, abría
    // "notificaciones-fulano" y leía las notificaciones de fulano en
    // vivo, con su texto dentro.
    const { res } = abrir("notificaciones-luis");
    res.escrito = "";
    await avisos.avisar("notificaciones-luis", "nueva-notificacion", { titulo: "Te mencionaron", mensaje: "..." });
    assert.equal(res.escrito, "");
  });

  test("ni quién la bloqueó", async () => {
    const { res } = abrir("notificaciones-luis");
    res.escrito = "";
    await avisos.avisar("notificaciones-luis", "estado-bloqueo", { bloqueado: true, por: "pepe" });
    assert.equal(res.escrito, "");
  });

  test("pero lo que el perfil enseña a cualquiera sigue saliendo", async () => {
    // Un visitante anónimo mirando un perfil ve aparecer los comentarios
    // al vuelo, como hasta ahora. Los avisos públicos, uno a uno.
    const { res } = abrir("notificaciones-luis");
    for (const evento of ["nuevo-comentario", "comentarios-vaciados", "nueva-actividad", "nuevo-historial", "nuevo-logro", "latido"]) {
      res.escrito = "";
      await avisos.avisar("notificaciones-luis", evento, { x: 1 });
      assert.ok(res.escrito.startsWith("event: " + evento + "\n"), evento + " no salió por la línea anónima");
    }
  });

  test("con pase, el buzón propio llega entero", async () => {
    const { res } = abrirConPase("notificaciones-luis", crearPase(luis));
    res.escrito = "";
    await avisos.avisar("notificaciones-luis", "nueva-notificacion", { titulo: "Hola" });
    assert.equal(res.escrito,
      'event: nueva-notificacion\ndata: {"canal":"notificaciones-luis","datos":{"titulo":"Hola"}}\n\n');
  });

  test("y el nombre se compara como lo compara el canal: en minúsculas", async () => {
    // El token lleva el nombre como se registró; el canal va en
    // minúsculas. Comparado tal cual, nadie con una mayúscula en el
    // nombre volvería a ver una notificación en vivo.
    const { res } = abrirConPase("notificaciones-luis", crearPase({ sub: 7, username: "LUIS" }));
    res.escrito = "";
    await avisos.avisar("notificaciones-luis", "nueva-notificacion", { titulo: "Hola" });
    assert.ok(res.escrito.includes("Hola"));
  });

  test("con pase, el buzón ajeno sigue callado aunque se pida su canal", async () => {
    // usuario.html pide dos canales por la misma línea: el propio y el
    // del perfil que se mira. Del ajeno tienen que llegar los comentarios
    // y no las notificaciones.
    const { res } = abrirConPase("notificaciones-luis,notificaciones-pepe", crearPase(luis));
    res.escrito = "";
    await avisos.avisar("notificaciones-pepe", "nueva-notificacion", { titulo: "Secreto de pepe" });
    assert.equal(res.escrito, "", "llegó el buzón de otra persona");
    await avisos.avisar("notificaciones-pepe", "nuevo-comentario", { id: 3 });
    assert.ok(res.escrito.startsWith("event: nuevo-comentario\n"), "el comentario ajeno no llegó");
  });

  test("un pase que no vale: 401, y no queda nada abierto ni apuntado", () => {
    const { res } = abrirConPase("notificaciones-luis", "esto-no-es-un-pase");
    assert.equal(res.codigo, 401);
    assert.equal(sse.cuantasAbiertas(), 0);
    assert.equal(avisos.cuantasEscuchas(), 0);
  });

  test("un pase caducado: 401", () => {
    const { res } = abrirConPase("notificaciones-luis", crearPase(luis, -1));
    assert.equal(res.codigo, 401);
  });

  test("la sesión de siete días en la URL no es un pase: 401", () => {
    // Si valiera, el token de sesión acabaría en el registro de nginx,
    // que es justo lo que el pase existe para evitar.
    const { res } = abrirConPase("notificaciones-luis", crearToken({ id: 7, username: "Luis" }));
    assert.equal(res.codigo, 401);
  });

  test("un pase vacío en la URL es lo mismo que no traerlo", async () => {
    const { res } = abrirConPase("notificaciones-luis", "");
    assert.equal(res.codigo, 200);
    res.escrito = "";
    await avisos.avisar("notificaciones-luis", "nuevo-logro", {});
    assert.ok(res.escrito.startsWith("event: nuevo-logro\n"));
  });

});

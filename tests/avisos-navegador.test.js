// ==============================
// AVISOS EN EL NAVEGADOR — tests/avisos-navegador.test.js
// ==============================
// js/avisos.js es la mitad del navegador: abre la línea con /api/avisos
// y reparte lo que llega. Sustituye a pusher-js.
//
// Se prueba con un EventSource de mentira porque jsdom no trae uno, y
// porque lo que importa acá no es el transporte sino las decisiones:
// cuántas conexiones se abren, con qué canales, a quién se le entrega
// cada aviso, y qué pasa cuando la línea se cae.
//
// Lo más importante que hay acá sujeto es el caso CLOSED. EventSource
// reconecta solo cuando se corta la red, pero se RINDE para siempre si
// el servidor contesta algo que no sea un 200 — por ejemplo el 503 de
// "este proceso está lleno". Sin el reintento a mano, esa pestaña se
// queda muda hasta que alguien recargue, y nada en pantalla lo diría.
//
// Correr:  npm test

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const FUENTE = fs.readFileSync(path.join(__dirname, "..", "js", "avisos.js"), "utf8");

// Un turno del bucle de eventos: js/avisos.js junta las suscripciones del
// mismo tick y abre UNA conexión en el siguiente.
const unTurno = () => new Promise(seguir => setTimeout(seguir, 0));

function montar(reloj) {
  const creadas = [];

  class FuenteFalsa {
    constructor(url) {
      this.url = url;
      this.readyState = FuenteFalsa.CONNECTING;
      this.porEvento = new Map();
      this.cerrada = false;
      creadas.push(this);
    }
    addEventListener(nombre, fn) {
      if (!this.porEvento.has(nombre)) this.porEvento.set(nombre, []);
      this.porEvento.get(nombre).push(fn);
    }
    close() { this.cerrada = true; this.readyState = FuenteFalsa.CLOSED; }

    // ---- ayudas de prueba, no parte de la interfaz real ----
    conectar() {
      this.readyState = FuenteFalsa.OPEN;
      if (this.onopen) this.onopen();
    }
    emitir(evento, sobre) {
      this.emitirCrudo(evento, JSON.stringify(sobre));
    }
    emitirCrudo(evento, texto) {
      for (const fn of this.porEvento.get(evento) || []) fn({ data: texto });
    }
    romper(estado) {
      this.readyState = estado;
      if (this.onerror) this.onerror();
    }
  }
  FuenteFalsa.CONNECTING = 0;
  FuenteFalsa.OPEN = 1;
  FuenteFalsa.CLOSED = 2;

  const dom = new JSDOM("<body></body>");
  dom.window.EventSource = FuenteFalsa;

  const contexto = {
    window: dom.window,
    document: dom.window.document,
    console: { warn() {}, error() {}, log() {} },
    EventSource: FuenteFalsa,
    setTimeout: (reloj && reloj.setTimeout) || setTimeout,
    clearTimeout: (reloj && reloj.clearTimeout) || clearTimeout,
    // El JSON del test, no el del contexto: si no, lo que sale de
    // JSON.parse lleva el prototipo de OTRO realm y deepStrictEqual lo
    // rechaza aunque sea identico, comparando prototipos y no valores.
    JSON
  };
  vm.createContext(contexto);
  vm.runInContext(FUENTE, contexto);

  return { MRAvisos: dom.window.MRAvisos, creadas, FuenteFalsa };
}

// Los canales que pide una conexión, sacados de su URL.
function canalesDe(fuente) {
  const q = decodeURIComponent(fuente.url.split("canales=")[1] || "");
  return q ? q.split(",") : [];
}

describe("cuándo se abre la línea, y cuántas veces", () => {

  test("sin nadie escuchando no se abre nada", async () => {
    // La mayoría de las visitas son de gente que no entró. Con Pusher se
    // conectaban igual, y abrían un WebSocket para no recibir nada.
    const { creadas } = montar();
    await unTurno();
    assert.equal(creadas.length, 0);
  });

  test("una escucha abre una conexión, con su canal en la URL", async () => {
    const { MRAvisos, creadas } = montar();
    MRAvisos.escuchar("notificaciones-luis", "nueva-notificacion", () => {});
    await unTurno();

    assert.equal(creadas.length, 1);
    assert.deepStrictEqual(canalesDe(creadas[0]), ["notificaciones-luis"]);
  });

  test("tres escuchas en el mismo turno abren UNA sola", async () => {
    // Lo normal: cada fichero se apunta al cargar, uno detrás de otro.
    // Sin juntarlas, eso eran tres conexiones y dos de ellas huérfanas.
    const { MRAvisos, creadas } = montar();
    MRAvisos.escuchar("notificaciones-luis", "nueva-notificacion", () => {});
    MRAvisos.escuchar("notificaciones-luis", "nuevo-logro", () => {});
    MRAvisos.escuchar("notificaciones-pepe", "nuevo-comentario", () => {});
    await unTurno();

    assert.equal(creadas.length, 1, "abrió una conexión por escucha");
    assert.deepStrictEqual(canalesDe(creadas[0]), ["notificaciones-luis", "notificaciones-pepe"]);
  });

  test("apuntarse a un canal nuevo más tarde reabre con los dos", async () => {
    const { MRAvisos, creadas } = montar();
    MRAvisos.escuchar("notificaciones-luis", "nueva-notificacion", () => {});
    await unTurno();
    MRAvisos.escuchar("notificaciones-pepe", "nuevo-comentario", () => {});
    await unTurno();

    assert.equal(creadas.length, 2);
    assert.equal(creadas[0].cerrada, true, "la conexión vieja quedó abierta");
    assert.deepStrictEqual(canalesDe(creadas[1]), ["notificaciones-luis", "notificaciones-pepe"]);
  });

  test("pero una segunda escucha del MISMO canal no reabre nada", async () => {
    // Reabrir corta la línea y pierde lo que viaje en ese instante. Si lo
    // que hay que pedirle al servidor no cambia, no se toca.
    const { MRAvisos, creadas } = montar();
    MRAvisos.escuchar("notificaciones-luis", "nueva-notificacion", () => {});
    await unTurno();
    MRAvisos.escuchar("notificaciones-luis", "nuevo-logro", () => {});
    await unTurno();

    assert.equal(creadas.length, 1, "reabrió sin necesidad");
  });

  test("darse de baja del último del canal reabre sin él", async () => {
    const { MRAvisos, creadas } = montar();
    MRAvisos.escuchar("notificaciones-luis", "nueva-notificacion", () => {});
    const cancelar = MRAvisos.escuchar("notificaciones-pepe", "nuevo-comentario", () => {});
    await unTurno();

    cancelar();
    await unTurno();

    assert.equal(creadas.length, 2);
    assert.deepStrictEqual(canalesDe(creadas[1]), ["notificaciones-luis"]);
  });

  test("cancelar la última escucha cierra la línea y no abre otra", async () => {
    // Sin la guarda de "sin canales no se conecta", la baja de la última
    // escucha abriria una conexión nueva pidiendo cero canales: una línea
    // abierta contra el servidor para no recibir nada nunca.
    const { MRAvisos, creadas } = montar();
    const cancelar = MRAvisos.escuchar("notificaciones-luis", "latido", () => {});
    await unTurno();
    assert.equal(creadas.length, 1);

    cancelar();
    await unTurno();

    assert.equal(creadas.length, 1, "abrió una conexión sin canales");
    assert.equal(creadas[0].cerrada, true, "dejó la línea abierta sin nadie escuchando");
  });
});

describe("a quién le llega cada aviso", () => {

  test("al que escucha ese canal y ese evento", async () => {
    const { MRAvisos, creadas } = montar();
    const recibido = [];
    MRAvisos.escuchar("notificaciones-luis", "nuevo-logro", d => recibido.push(d));
    await unTurno();

    creadas[0].emitir("nuevo-logro", {
      canal: "notificaciones-luis",
      datos: { achievementId: 7 }
    });

    assert.deepStrictEqual(recibido, [{ achievementId: 7 }]);
  });

  test("y no al que escucha el mismo evento en OTRO canal", async () => {
    // El motivo de que el canal viaje dentro del aviso. usuario.html
    // escucha "nuevo-comentario" en dos canales a la vez: el tuyo y el
    // del perfil que estás mirando. Sin distinguirlos, un comentario en
    // el perfil ajeno repintaría también el propio.
    const { MRAvisos, creadas } = montar();
    const mio = [];
    const ajeno = [];
    MRAvisos.escuchar("notificaciones-luis", "nuevo-comentario", () => mio.push(1));
    MRAvisos.escuchar("notificaciones-pepe", "nuevo-comentario", () => ajeno.push(1));
    await unTurno();

    creadas[0].emitir("nuevo-comentario", { canal: "notificaciones-pepe", datos: {} });

    assert.deepStrictEqual(mio, [], "el aviso del perfil ajeno tocó el propio");
    assert.deepStrictEqual(ajeno, [1]);
  });

  test("una escucha que revienta no impide que cobren las demás", async () => {
    const { MRAvisos, creadas } = montar();
    const sanos = [];
    MRAvisos.escuchar("notificaciones-luis", "latido", () => { throw new Error("rota"); });
    MRAvisos.escuchar("notificaciones-luis", "latido", () => sanos.push(1));
    await unTurno();

    creadas[0].emitir("latido", { canal: "notificaciones-luis", datos: {} });

    assert.deepStrictEqual(sanos, [1]);
  });

  test("un mensaje que no es JSON no tumba la página", async () => {
    const { MRAvisos, creadas } = montar();
    const recibido = [];
    MRAvisos.escuchar("notificaciones-luis", "nuevo-logro", d => recibido.push(d));
    await unTurno();

    creadas[0].emitirCrudo("nuevo-logro", "esto no es json {{{");
    creadas[0].emitir("nuevo-logro", { canal: "notificaciones-luis", datos: { ok: true } });

    assert.deepStrictEqual(recibido, [{ ok: true }], "el mensaje roto se llevó al siguiente");
  });

  test("un data: null no revienta la escucha", async () => {
    // JSON.parse("null") devuelve null, no un objeto: leerle .canal tira
    // un TypeError dentro del manejador del evento, donde nadie lo caza.
    const { MRAvisos, creadas } = montar();
    const recibido = [];
    MRAvisos.escuchar("notificaciones-luis", "nuevo-logro", d => recibido.push(d));
    await unTurno();

    creadas[0].emitirCrudo("nuevo-logro", "null");
    creadas[0].emitir("nuevo-logro", { canal: "notificaciones-luis", datos: { ok: true } });

    assert.deepStrictEqual(recibido, [{ ok: true }]);
  });

  test("un aviso sin canal se descarta en vez de repartirse a ciegas", async () => {
    const { MRAvisos, creadas } = montar();
    const recibido = [];
    MRAvisos.escuchar("notificaciones-luis", "nuevo-logro", d => recibido.push(d));
    await unTurno();

    creadas[0].emitir("nuevo-logro", { datos: { achievementId: 7 } });

    assert.deepStrictEqual(recibido, []);
  });

  test("y deja de llegarle en cuanto se da de baja", async () => {
    const { MRAvisos, creadas } = montar();
    const recibido = [];
    const cancelar = MRAvisos.escuchar("notificaciones-luis", "latido", () => recibido.push(1));
    await unTurno();

    creadas[0].emitir("latido", { canal: "notificaciones-luis", datos: {} });
    cancelar();
    await unTurno();
    const ultima = creadas[creadas.length - 1];
    ultima.emitir("latido", { canal: "notificaciones-luis", datos: {} });

    assert.deepStrictEqual(recibido, [1]);
  });
});

describe("cuando la línea se cae", () => {

  test("el navegador reintentando solo no programa un segundo intento", async () => {
    // readyState CONNECTING significa que EventSource ya está en ello con
    // el retry que mandó el servidor. Meter otro encima abriría dos.
    const { MRAvisos, creadas, FuenteFalsa } = montar();
    MRAvisos.escuchar("notificaciones-luis", "latido", () => {});
    await unTurno();

    creadas[0].romper(FuenteFalsa.CONNECTING);

    assert.equal(MRAvisos.estado().reintentando, false, "programó un reintento de más");
  });

  test("pero si se rindió del todo, se programa uno a mano", async () => {
    // El caso del 503: EventSource NO vuelve a intentarlo solo. Sin esto
    // la pestaña se queda muda para siempre y nada lo dice.
    //
    // Se comprueba que quede PROGRAMADO y no se espera a que salte: la
    // espera mínima son cinco segundos y no hace falta gastarlos para
    // saber si la decisión se tomó bien.
    const { MRAvisos, creadas, FuenteFalsa } = montar();
    MRAvisos.escuchar("notificaciones-luis", "latido", () => {});
    await unTurno();

    creadas[0].romper(FuenteFalsa.CLOSED);

    assert.equal(MRAvisos.estado().reintentando, true, "nadie volvió a intentarlo");
    MRAvisos.cerrar();
  });
});

// Un reloj de mentira: en vez de esperar los cinco segundos del
// reintento, se dispara a mano lo que haya en cola. Deja ver cuántos
// temporizadores se programaron, que es lo que hay que medir aquí.
function relojFalso() {
  let siguiente = 1;
  const pendientes = new Map();
  return {
    pendientes,
    poner(fn) { const id = siguiente++; pendientes.set(id, fn); return id; },
    quitar(id) { pendientes.delete(id); },
    correr() {
      const cola = [...pendientes.values()];
      pendientes.clear();
      for (const fn of cola) fn();
    }
  };
}

describe("una línea que da tumbos", () => {

  test("dos caídas seguidas no programan dos reconexiones", async () => {
    // Sin la guarda, cada error deja su propio temporizador y el primero
    // se pierde sin poder cancelarlo: al saltar los dos se abren dos
    // conexiones para el mismo navegador, y una queda huérfana.
    const reloj = relojFalso();
    const { MRAvisos, creadas, FuenteFalsa } = montar({
      setTimeout: fn => reloj.poner(fn),
      clearTimeout: id => reloj.quitar(id)
    });

    MRAvisos.escuchar("notificaciones-luis", "latido", () => {});
    reloj.correr();
    assert.equal(creadas.length, 1);

    creadas[0].romper(FuenteFalsa.CLOSED);
    creadas[0].romper(FuenteFalsa.CLOSED);
    assert.equal(reloj.pendientes.size, 1, "quedaron dos reintentos en cola");

    reloj.correr();
    assert.equal(creadas.length, 2, "se abrió una conexión de más");
  });
});

describe("volver de una caída", () => {

  test("la primera conexión no cuenta como reconexión", async () => {
    // No hay nada que repescar la primera vez: la página acaba de pedir
    // sus datos por su cuenta.
    const { MRAvisos, creadas } = montar();
    let repescas = 0;
    MRAvisos.alReconectar(() => repescas++);
    MRAvisos.escuchar("notificaciones-luis", "latido", () => {});
    await unTurno();

    creadas[0].conectar();

    assert.equal(repescas, 0);
  });

  test("la segunda sí, porque mientras estuvo caída se perdieron avisos", async () => {
    // Esto NO es un bus con historia: lo que no se entregó no se guarda.
    // Quien vuelve tiene que volver a pedir.
    const { MRAvisos, creadas } = montar();
    let repescas = 0;
    MRAvisos.alReconectar(() => repescas++);
    MRAvisos.escuchar("notificaciones-luis", "latido", () => {});
    await unTurno();

    creadas[0].conectar();
    MRAvisos.escuchar("notificaciones-pepe", "latido", () => {});
    await unTurno();
    creadas[1].conectar();

    assert.equal(repescas, 1);
  });
});

describe("sin EventSource en el navegador", () => {

  test("no se cae: simplemente no hay avisos en vivo", async () => {
    const dom = new JSDOM("<body></body>");
    const contexto = {
      window: dom.window,
      document: dom.window.document,
      console: { warn() {}, error() {}, log() {} },
      setTimeout,
      clearTimeout,
      JSON
    };
    vm.createContext(contexto);
    vm.runInContext(FUENTE, contexto);

    const MRAvisos = dom.window.MRAvisos;
    assert.equal(MRAvisos.estado().disponible, false);

    // No debe tirar: el resto de la página sigue funcionando y los datos
    // llegan igual al recargar.
    MRAvisos.escuchar("notificaciones-luis", "latido", () => {});
    await unTurno();
    assert.equal(MRAvisos.estado().conectada, false);
  });
});

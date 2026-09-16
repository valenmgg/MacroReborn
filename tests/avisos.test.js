// ==============================
// AVISOS EN VIVO — tests/avisos.test.js
// ==============================
// api/_avisos.js es el reparto de avisos que sustituyó a Pusher. Lo que
// se prueba acá es el registro local: quién recibe qué, quién no, y qué
// pasa cuando una conexión se cae o revienta.
//
// El puente entre procesos (Postgres LISTEN/NOTIFY) NO se prueba acá a
// propósito: hace falta un Postgres de verdad y los tests corren contra
// PGlite, que es un solo proceso y no lo tiene. Sin puente, `avisar()`
// entrega en local, que en un solo proceso es la entrega completa — y es
// justo el camino que corre en `npm run db:local`.
//
// El conteo de escuchas sí importa que esté sujeto: una baja que
// descuenta de más deja el contador en negativo, y de ese contador
// cuelga el diagnóstico de cuánta gente hay escuchando. El tope de
// conexiones abiertas vive en tests/avisos-sse.test.js, que es donde
// vive la conexión.
//
// Correr:  npm test

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert");

const avisos = require("../api/_avisos");

// Cada test empieza con el registro vacío: el módulo es un singleton y
// una suscripción que sobreviva de un test al siguiente contamina el
// conteo de conexiones, que es justo lo que se está midiendo.
let bajas = [];
function suscribir(canal, escucha) {
  const cancelar = avisos.suscribir(canal, escucha);
  bajas.push(cancelar);
  return cancelar;
}

beforeEach(() => {
  for (const cancelar of bajas) cancelar();
  bajas = [];
  assert.equal(avisos.cuantasEscuchas(), 0, "quedaron conexiones de un test anterior");
});

describe("a quién le llega un aviso", () => {

  test("a quien escucha ese canal", async () => {
    const recibido = [];
    suscribir("notificaciones-luis", (evento, datos) => recibido.push([evento, datos]));

    await avisos.avisar("notificaciones-luis", "nueva-notificacion", { titulo: "Hola" });

    assert.deepStrictEqual(recibido, [["nueva-notificacion", { titulo: "Hola" }]]);
  });

  test("y no a quien escucha otro", async () => {
    const mio = [];
    const ajeno = [];
    suscribir("notificaciones-luis", e => mio.push(e));
    suscribir("notificaciones-pepe", e => ajeno.push(e));

    await avisos.avisar("notificaciones-luis", "nuevo-logro", {});

    assert.deepStrictEqual(mio, ["nuevo-logro"]);
    assert.deepStrictEqual(ajeno, [], "el aviso se coló en el canal de otra persona");
  });

  test("a los dos, si dos escuchan el mismo canal", async () => {
    // Pasa de verdad: la misma persona con el sitio abierto en dos
    // pestañas, o mirando su propio perfil mientras le llega algo.
    let a = 0;
    let b = 0;
    suscribir("notificaciones-luis", () => a++);
    suscribir("notificaciones-luis", () => b++);

    await avisos.avisar("notificaciones-luis", "latido", {});

    assert.equal(a, 1);
    assert.equal(b, 1);
  });

  test("a nadie, si el canal no tiene a nadie escuchando", async () => {
    // No debe explotar: el 90% de los avisos del sitio se emiten para
    // gente que en ese momento no lo tiene abierto.
    const resultado = await avisos.avisar("notificaciones-fantasma", "nuevo-logro", {});
    assert.equal(resultado, true);
  });

  test("y deja de llegarle en cuanto se da de baja", async () => {
    const recibido = [];
    const cancelar = suscribir("notificaciones-luis", e => recibido.push(e));

    await avisos.avisar("notificaciones-luis", "uno", {});
    cancelar();
    await avisos.avisar("notificaciones-luis", "dos", {});

    assert.deepStrictEqual(recibido, ["uno"], "siguió recibiendo después de la baja");
  });
});

describe("el conteo de escuchas", () => {

  test("sube al suscribirse y baja al darse de baja", () => {
    assert.equal(avisos.cuantasEscuchas(), 0);

    const uno = suscribir("a", () => {});
    assert.equal(avisos.cuantasEscuchas(), 1);

    const dos = suscribir("b", () => {});
    assert.equal(avisos.cuantasEscuchas(), 2);

    uno();
    assert.equal(avisos.cuantasEscuchas(), 1);
    dos();
    assert.equal(avisos.cuantasEscuchas(), 0);
  });

  test("darse de baja dos veces no descuenta dos veces", () => {
    // El caso real: la respuesta se cierra -y dispara su "close"- y
    // además alguien llama a cancelar a mano. Sin la guarda, el contador
    // se va a negativo y el tope deja de ser un tope.
    const cancelar = suscribir("a", () => {});
    suscribir("b", () => {});

    cancelar();
    cancelar();
    cancelar();

    assert.equal(avisos.cuantasEscuchas(), 1, "el contador se descontó de más");
  });

  test("una suscripción sin función no cuenta como conexión", () => {
    avisos.suscribir("a", null);
    avisos.suscribir("", () => {});
    assert.equal(avisos.cuantasEscuchas(), 0);
  });
});

describe("una conexión que se rompe no se lleva a las demás", () => {

  test("la que revienta se da de baja sola y el resto cobra igual", async () => {
    // Pasa cuando el navegador se va sin avisar: escribir en esa
    // respuesta tira. Antes de esto, una sola conexión muerta cortaba el
    // reparto y las que venían detrás en el Set no recibían nada.
    const sanos = [];
    suscribir("notificaciones-luis", () => { throw new Error("socket cerrado"); });
    suscribir("notificaciones-luis", e => sanos.push(e));

    await avisos.avisar("notificaciones-luis", "uno", {});

    assert.deepStrictEqual(sanos, ["uno"], "la conexión rota se llevó por delante a la sana");
    assert.equal(avisos.cuantosEscuchan("notificaciones-luis"), 1, "la rota debió quedar fuera");
  });

  test("quien se apunta durante el reparto no cobra ese mismo aviso", async () => {
    // Un Set en vivo también entrega a quien entra mientras se lo
    // recorre, así que sin copiarlo primero una escucha que se suscribe
    // al recibir algo cobraría el aviso que la hizo nacer. Se recorre una
    // copia justamente para congelar quién estaba cuando empezó.
    const tardia = [];
    suscribir("notificaciones-luis", () => {
      suscribir("notificaciones-luis", e => tardia.push(e));
    });

    await avisos.avisar("notificaciones-luis", "uno", {});

    assert.deepStrictEqual(tardia, [], "la escucha recién apuntada cobró el aviso que la creó");
  });

  test("y no vuelve a recibir en el siguiente aviso", async () => {
    let veces = 0;
    suscribir("notificaciones-luis", () => { veces++; throw new Error("socket cerrado"); });

    await avisos.avisar("notificaciones-luis", "uno", {});
    await avisos.avisar("notificaciones-luis", "dos", {});

    assert.equal(veces, 1, "se siguió intentando con una conexión ya muerta");
  });
});

describe("el nombre del canal", () => {

  test("es el mismo que usaba Pusher, en minúsculas", () => {
    // Importa que no cambie: es el nombre que el navegador pide y el que
    // los diez sitios del servidor emiten. Si las dos mitades no lo
    // escriben igual, no llega nada y no hay ningún error que lo diga.
    assert.equal(avisos.canalNotificaciones("Luis"), "notificaciones-luis");
    assert.equal(avisos.canalNotificaciones("DarknessBelch"), "notificaciones-darknessbelch");
  });

  test("y aguanta que le pasen algo que no es texto", () => {
    assert.equal(avisos.canalNotificaciones(null), "notificaciones-null");
  });
});

describe("sin canal o sin evento no se manda nada", () => {

  test("porque un aviso sin nombre no lo puede escuchar nadie", async () => {
    const recibido = [];
    suscribir("notificaciones-luis", e => recibido.push(e));

    assert.equal(await avisos.avisar("", "evento", {}), false);
    assert.equal(await avisos.avisar("notificaciones-luis", "", {}), false);

    assert.deepStrictEqual(recibido, []);
  });
});

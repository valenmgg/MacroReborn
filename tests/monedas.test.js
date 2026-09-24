// ==============================
// TESTS DE MONEDAS — tests/monedas.test.js
// ==============================
// Prueban el "banco" del sitio (api/_monedas.js) y su enganche en los
// handlers REALES de la API (los mismos que corren en Vercel) contra
// una base local PGlite. Cero contacto con la base de producción:
// todo vive en esta computadora.
//
// Cómo funciona: antes de cargar la API, se crea la maqueta local y se
// la inyecta con api/_db.js (usarSqlLocal). Como cada archivo de test
// corre en su propio proceso, no hay contaminación con los tests de
// contraseñas.
//
// Qué se cubre:
//   - Primer otorgamiento a un usuario nuevo.
//   - Segundo otorgamiento antes de los 10 minutos (no debe dar nada).
//   - Tope diario: una vez alcanzado, los otorgamientos dan 0.
//   - Overshoot: el otorgamiento que cruza el tope se entrega COMPLETO.
//   - Reseteo perezoso: acumulado de "ayer" que se ignora.
//   - gastar(): rechaza compras sin saldo suficiente.
//   - El enganche real en POST /api/users?action=xp.
//   - La compra real en POST /api/content?action=avatar-shop-buy.
//
// Correr:  npm test   (o: node --test tests/)

// Los handlers de escrituras del main actual exigen una sesión firmada.
// Este secreto solo vive en el proceso de pruebas y nunca se usa en producción.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret";

const { test, before } = require("node:test");
const assert = require("node:assert");

const { crearBaseLocal, crearSqlPGlite } = require("../scripts/pglite");
const { usarSqlLocal } = require("../api/_db");
const { crearToken } = require("../api/_auth");
const {
  MINUTOS_ENTRE_OTORGAMIENTOS,
  MONEDAS_MINIMAS,
  MONEDAS_MAXIMAS,
  TOPE_DIARIO,
  montoAleatorio,
  montoSegunTope,
  MonedasService
} = require("../api/_monedas");

// Saldo con el que arranca todo usuario (migración 012).
const SALDO_INICIAL = 500;

let db;
let sql;
let monedas;
let usersHandler;
let contentHandler;

before(async () => {
  db = await crearBaseLocal();
  sql = crearSqlPGlite(db);
  usarSqlLocal(sql);

  monedas = new MonedasService(sql);

  // IMPORTANTE: se cargan DESPUÉS de inyectar la base local, porque
  // los handlers resuelven su conexión al cargarse.
  usersHandler = require("../api/users");
  contentHandler = require("../api/content");
});

// Llama a un handler como lo llamaría Vercel (req/res simulados).
function llamar(handler, metodo, query, body, headers) {
  return new Promise((resolve) => {
    const req = { method: metodo, query: query || {}, body: body || {}, headers: headers || {} };
    const res = {
      status(codigo) { this.statusCode = codigo; return this; },
      json(obj) { resolve(obj); },
      end() { resolve(null); },
      setHeader() {}
    };
    handler(req, res);
  });
}

// Crea un usuario de prueba y devuelve su id.
async function crearUsuario(username) {
  const filas = await db.query(
    `INSERT INTO users (username, password_hash, level, xp, status, created_at, last_login)
     VALUES ($1, 'hash-de-prueba', 1, 0, 'active', now(), now())
     RETURNING id`,
    [username]
  );
  return filas.rows[0].id;
}

async function headersParaUsuario(username) {
  const filas = await db.query("SELECT id FROM users WHERE username = $1", [username]);
  assert.equal(filas.rows.length, 1, `debe existir el usuario ${username}`);
  return {
    authorization: `Bearer ${crearToken({ id: filas.rows[0].id, username })}`
  };
}

// Lee las columnas de monedas de un usuario.
async function estadoMonedas(userId) {
  const filas = await db.query(
    `SELECT monedas, monedas_ganadas_hoy, monedas_ganadas_fecha, monedas_ultimo_otorgamiento
     FROM users WHERE id = $1`,
    [userId]
  );
  return filas.rows[0];
}

// Simula que el último otorgamiento fue hace N minutos, para no tener
// que esperar 10 minutos reales en un test.
async function ultimoOtorgamientoHaceMinutos(userId, minutos) {
  await db.query(
    `UPDATE users SET monedas_ultimo_otorgamiento = now() - ($2 * INTERVAL '1 minute') WHERE id = $1`,
    [userId, minutos]
  );
}

// Deja al usuario con un acumulado del día ya cargado, fechado HOY o
// AYER (para probar el reseteo perezoso).
async function acumuladoDelDia(userId, ganadas, dia) {
  const fecha = dia === "ayer"
    ? `((now() AT TIME ZONE 'UTC')::date - 1)`
    : `(now() AT TIME ZONE 'UTC')::date`;
  await db.query(
    `UPDATE users SET monedas_ganadas_hoy = $2, monedas_ganadas_fecha = ${fecha} WHERE id = $1`,
    [userId, ganadas]
  );
}

// ==============================
// LA REGLA, PIEZA POR PIEZA
// ==============================

test("el monto sorteado siempre cae entre 10 y 30 monedas, incluidos los extremos", () => {
  // 2000 tiradas: suficiente para que un rango mal calculado (un
  // extremo que nunca sale, o uno que se pasa) aparezca.
  const vistos = new Set();

  for (let i = 0; i < 2000; i++) {
    const monto = montoAleatorio();
    assert.ok(Number.isInteger(monto), "el monto debe ser un entero");
    assert.ok(monto >= MONEDAS_MINIMAS, `${monto} quedó por debajo del mínimo`);
    assert.ok(monto <= MONEDAS_MAXIMAS, `${monto} se pasó del máximo`);
    vistos.add(monto);
  }

  assert.ok(vistos.has(MONEDAS_MINIMAS), "el mínimo tiene que poder salir");
  assert.ok(vistos.has(MONEDAS_MAXIMAS), "el máximo tiene que poder salir");
});

test("el tope no recorta el premio: lo entrega completo o no entrega nada", () => {
  // Todavía no llegó al tope -> premio completo, aunque se pase.
  assert.equal(montoSegunTope(TOPE_DIARIO - 1, 30), 30, "no debe recortarse a lo que faltaba");
  assert.equal(montoSegunTope(0, 25), 25);

  // Tope justo alcanzado o superado -> nada.
  assert.equal(montoSegunTope(TOPE_DIARIO, 30), 0);
  assert.equal(montoSegunTope(TOPE_DIARIO + 15, 30), 0);
});

// ==============================
// OTORGAMIENTO
// ==============================

test("(a) primer otorgamiento a un usuario nuevo: cobra de entrada, sin esperar", async () => {
  const id = await crearUsuario("jugador_nuevo");

  const antes = await estadoMonedas(id);
  assert.equal(antes.monedas, SALDO_INICIAL, "arranca con el saldo de bienvenida");
  assert.equal(antes.monedas_ultimo_otorgamiento, null, "nunca tuvo un otorgamiento");
  assert.equal(antes.monedas_ganadas_hoy, 0);
  assert.equal(antes.monedas_ganadas_fecha, null);

  const resultado = await monedas.otorgarPorTiempoJugado(id);

  assert.equal(resultado.otorgado, true);
  assert.equal(resultado.razon, null, "un otorgamiento exitoso no lleva razon");
  assert.ok(resultado.monto >= MONEDAS_MINIMAS && resultado.monto <= MONEDAS_MAXIMAS);
  assert.equal(resultado.saldoNuevo, SALDO_INICIAL + resultado.monto);

  const despues = await estadoMonedas(id);
  assert.equal(despues.monedas, SALDO_INICIAL + resultado.monto, "el saldo real debe haber subido");
  assert.equal(despues.monedas_ganadas_hoy, resultado.monto, "el acumulado del día arranca en el premio");
  assert.ok(despues.monedas_ultimo_otorgamiento, "debe quedar marcada la fecha del otorgamiento");
  assert.ok(despues.monedas_ganadas_fecha, "debe quedar anclado el día del acumulado");
});

test("(b) un segundo otorgamiento antes de los 10 minutos no otorga nada", async () => {
  const id = await crearUsuario("jugador_apurado");

  const primero = await monedas.otorgarPorTiempoJugado(id);
  assert.equal(primero.otorgado, true);

  const saldoTrasPrimero = primero.saldoNuevo;

  // Los 9 pulsos siguientes (1 por minuto) no deben cobrar. Se llama
  // varias veces porque es el caso más frecuente en producción.
  for (let intento = 0; intento < 3; intento++) {
    const segundo = await monedas.otorgarPorTiempoJugado(id);
    assert.equal(segundo.otorgado, false, "no debe otorgar antes de los 10 minutos");
    assert.equal(segundo.monto, 0);
    assert.equal(segundo.razon, "aun-no-pasaron-10-minutos");
    assert.equal(segundo.saldoNuevo, saldoTrasPrimero, "el saldo no se debe mover");
  }

  const estado = await estadoMonedas(id);
  assert.equal(estado.monedas, saldoTrasPrimero, "el saldo real tampoco se movió");
  assert.equal(estado.monedas_ganadas_hoy, primero.monto, "el acumulado del día tampoco");

  // Y cuando sí pasaron los 10 minutos, vuelve a cobrar.
  await ultimoOtorgamientoHaceMinutos(id, MINUTOS_ENTRE_OTORGAMIENTOS);
  const tercero = await monedas.otorgarPorTiempoJugado(id);
  assert.equal(tercero.otorgado, true, "pasados los 10 minutos debe volver a otorgar");
  assert.equal(tercero.saldoNuevo, saldoTrasPrimero + tercero.monto);
});

test("dos pulsos simultáneos solo pueden cobrar un otorgamiento", async () => {
  const id = await crearUsuario("jugador_dos_pestanas");

  const resultados = await Promise.all([
    monedas.otorgarPorTiempoJugado(id),
    monedas.otorgarPorTiempoJugado(id)
  ]);

  const otorgados = resultados.filter(resultado => resultado.otorgado);
  const rechazados = resultados.filter(resultado => !resultado.otorgado);

  assert.equal(otorgados.length, 1, "solo uno de los pulsos debe cobrar");
  assert.equal(rechazados.length, 1);
  assert.equal(rechazados[0].razon, "aun-no-pasaron-10-minutos");

  const estado = await estadoMonedas(id);
  assert.equal(estado.monedas, SALDO_INICIAL + otorgados[0].monto);
  assert.equal(estado.monedas_ganadas_hoy, otorgados[0].monto);
  assert.equal(resultados[0].saldoNuevo, estado.monedas);
  assert.equal(resultados[1].saldoNuevo, estado.monedas);
});

test("(c) tope diario: alcanzado el tope, los otorgamientos siguientes dan 0", async () => {
  const id = await crearUsuario("jugador_topeado");

  await acumuladoDelDia(id, TOPE_DIARIO, "hoy");
  await ultimoOtorgamientoHaceMinutos(id, MINUTOS_ENTRE_OTORGAMIENTOS + 5);

  const saldoAntes = (await estadoMonedas(id)).monedas;

  const resultado = await monedas.otorgarPorTiempoJugado(id);

  assert.equal(resultado.otorgado, false);
  assert.equal(resultado.monto, 0);
  assert.equal(resultado.razon, "tope-diario-alcanzado");
  assert.equal(resultado.saldoNuevo, saldoAntes, "el saldo no debe subir");

  const estado = await estadoMonedas(id);
  assert.equal(estado.monedas, saldoAntes);
  assert.equal(estado.monedas_ganadas_hoy, TOPE_DIARIO, "el acumulado no debe moverse");

  // Aunque haya entregado 0, ES un otorgamiento: la marca de tiempo se
  // mueve, así no se vuelve a sortear en cada uno de los 10 pulsos
  // siguientes. Y la fecha queda anclada en hoy, que es lo que hace
  // funcionar el reseteo perezoso de mañana.
  assert.ok(estado.monedas_ultimo_otorgamiento, "la marca de tiempo debe haberse movido");

  const inmediato = await monedas.otorgarPorTiempoJugado(id);
  assert.equal(
    inmediato.razon,
    "aun-no-pasaron-10-minutos",
    "tras un otorgamiento de 0, el pulso del minuto siguiente ya no llega a sortear"
  );

  // Sigue dando 0 el resto del día, tantas veces como se lo llame.
  await ultimoOtorgamientoHaceMinutos(id, MINUTOS_ENTRE_OTORGAMIENTOS + 5);
  const otraVez = await monedas.otorgarPorTiempoJugado(id);
  assert.equal(otraVez.otorgado, false);
  assert.equal(otraVez.razon, "tope-diario-alcanzado");
  assert.equal((await estadoMonedas(id)).monedas, saldoAntes);
});

test("(d) overshoot: el otorgamiento que cruza el tope se entrega COMPLETO, sin recortar", async () => {
  const id = await crearUsuario("jugador_al_limite");

  // A 5 monedas del tope: cualquier premio (10 a 30) lo cruza.
  const acumuladoPrevio = TOPE_DIARIO - 5;
  await acumuladoDelDia(id, acumuladoPrevio, "hoy");
  await ultimoOtorgamientoHaceMinutos(id, MINUTOS_ENTRE_OTORGAMIENTOS);

  const saldoAntes = (await estadoMonedas(id)).monedas;

  const resultado = await monedas.otorgarPorTiempoJugado(id);

  assert.equal(resultado.otorgado, true, "el otorgamiento que cruza el tope sí se entrega");
  assert.ok(
    resultado.monto >= MONEDAS_MINIMAS,
    `el monto se recortó a ${resultado.monto}: tenía que entregarse completo`
  );
  assert.equal(resultado.monto, resultado.saldoNuevo - saldoAntes, "el saldo subió el monto completo");

  const estado = await estadoMonedas(id);
  assert.equal(estado.monedas_ganadas_hoy, acumuladoPrevio + resultado.monto);
  assert.ok(
    estado.monedas_ganadas_hoy > TOPE_DIARIO,
    "el acumulado del día tiene que poder pasarse del tope (una vez)"
  );

  // Y a partir de acá, ya pasado el tope, el siguiente da 0.
  await ultimoOtorgamientoHaceMinutos(id, MINUTOS_ENTRE_OTORGAMIENTOS);
  const siguiente = await monedas.otorgarPorTiempoJugado(id);
  assert.equal(siguiente.otorgado, false);
  assert.equal(siguiente.monto, 0);
  assert.equal(siguiente.razon, "tope-diario-alcanzado");
});

test("(e) reseteo perezoso: un acumulado fechado ayer se ignora y el día arranca en 0", async () => {
  const id = await crearUsuario("jugador_de_ayer");

  // Ayer llegó al tope. Sin reseteo, hoy no cobraría nada.
  await acumuladoDelDia(id, TOPE_DIARIO, "ayer");
  await ultimoOtorgamientoHaceMinutos(id, MINUTOS_ENTRE_OTORGAMIENTOS + (24 * 60));

  const saldoAntes = (await estadoMonedas(id)).monedas;

  const resultado = await monedas.otorgarPorTiempoJugado(id);

  assert.equal(resultado.otorgado, true, "el tope de ayer no debe afectar a hoy");
  assert.ok(resultado.monto >= MONEDAS_MINIMAS);
  assert.equal(resultado.saldoNuevo, saldoAntes + resultado.monto);

  const estado = await estadoMonedas(id);
  assert.equal(
    estado.monedas_ganadas_hoy,
    resultado.monto,
    "el acumulado debe arrancar de 0 y quedar en el premio de hoy, no en 500 + premio"
  );

  // Y la fecha quedó reanclada en hoy (sin cron, solo por consultarla).
  const fechas = await db.query(
    `SELECT (monedas_ganadas_fecha = (now() AT TIME ZONE 'UTC')::date) AS es_hoy FROM users WHERE id = $1`,
    [id]
  );
  assert.equal(fechas.rows[0].es_hoy, true, "la fecha del acumulado debe quedar en el día de hoy");
});

test("otorgar a un usuario que no existe no explota: devuelve la razon correspondiente", async () => {
  const resultado = await monedas.otorgarPorTiempoJugado(999999);
  assert.equal(resultado.otorgado, false);
  assert.equal(resultado.monto, 0);
  assert.equal(resultado.razon, "usuario-no-encontrado");
});

// ==============================
// GASTO
// ==============================

test("(f) gastar rechaza la compra cuando no alcanza el saldo, y no toca las monedas", async () => {
  const id = await crearUsuario("comprador_pelado");

  const saldo = (await estadoMonedas(id)).monedas;

  const gasto = await monedas.gastar(id, saldo + 1);

  assert.equal(gasto.ok, false);
  assert.equal(gasto.error, "No te alcanzan las monedas", "el mensaje que ve el usuario no cambió");
  assert.equal((await estadoMonedas(id)).monedas, saldo, "el saldo no se debe tocar");
});

test("gastar descuenta el precio exacto y permite gastar hasta el último peso", async () => {
  const id = await crearUsuario("comprador_justo");
  const saldo = (await estadoMonedas(id)).monedas;

  const gasto = await monedas.gastar(id, 120);
  assert.equal(gasto.ok, true);
  assert.equal(gasto.saldoNuevo, saldo - 120);
  assert.equal((await estadoMonedas(id)).monedas, saldo - 120);

  // Gastar exactamente lo que queda debe funcionar (no es "no alcanza").
  const resto = gasto.saldoNuevo;
  const gastoTotal = await monedas.gastar(id, resto);
  assert.equal(gastoTotal.ok, true);
  assert.equal(gastoTotal.saldoNuevo, 0);

  // Y con 0 ya no alcanza para nada.
  const sinSaldo = await monedas.gastar(id, 1);
  assert.equal(sinSaldo.ok, false);
  assert.equal(sinSaldo.error, "No te alcanzan las monedas");
});

test("gastar un monto negativo no puede usarse para ganar saldo", async () => {
  const id = await crearUsuario("comprador_tramposo");
  const saldo = (await estadoMonedas(id)).monedas;

  const gasto = await monedas.gastar(id, -1000);

  assert.equal(gasto.ok, false);
  assert.equal(gasto.error, "Monto inválido");
  assert.equal((await estadoMonedas(id)).monedas, saldo, "el saldo no se debe mover");
});

test("consultarSaldo devuelve el saldo, y null si el usuario no existe", async () => {
  const id = await crearUsuario("consultante");
  assert.equal(await monedas.consultarSaldo(id), SALDO_INICIAL);
  assert.equal(await monedas.consultarSaldo(999999), null);
});

// ==============================
// ENGANCHE REAL EN LOS HANDLERS
// ==============================

test("POST /api/users?action=xp otorga monedas y sigue devolviendo todo lo de antes", async () => {
  await crearUsuario("pulso_jugando");
  const headers = await headersParaUsuario("pulso_jugando");

  const resp = await llamar(usersHandler, "POST", { action: "xp" }, {
    username: "pulso_jugando",
    cantidad: 10,
    gameId: "juego-de-prueba"
  }, headers);

  // La forma vieja de la respuesta no cambió.
  assert.equal(resp.success, true);
  assert.ok(resp.user, "debe seguir devolviendo user");
  assert.equal(resp.user.username, "pulso_jugando");
  assert.equal(resp.user.xp, 10, "el XP se sumó igual que siempre");
  assert.equal(resp.subioNivel, false, "debe seguir devolviendo subioNivel");

  // Y ahora además viajan las monedas.
  assert.ok(resp.monedas, "la respuesta debe incluir el campo monedas");
  assert.equal(resp.monedas.otorgado, true, "el primer pulso otorga (nunca hubo otorgamiento)");
  assert.ok(resp.monedas.monto >= MONEDAS_MINIMAS && resp.monedas.monto <= MONEDAS_MAXIMAS);
  assert.equal(resp.monedas.saldoNuevo, SALDO_INICIAL + resp.monedas.monto);
  assert.equal(resp.monedas.razon, null);

  // El segundo pulso (un minuto después) suma XP pero no monedas.
  const resp2 = await llamar(usersHandler, "POST", { action: "xp" }, {
    username: "pulso_jugando",
    cantidad: 10,
    gameId: "juego-de-prueba"
  }, headers);

  assert.equal(resp2.success, true);
  assert.equal(resp2.user.xp, 20, "el XP sigue sumando en cada pulso");
  assert.equal(resp2.monedas.otorgado, false, "las monedas no se otorgan cada minuto");
  assert.equal(resp2.monedas.monto, 0);
  assert.equal(resp2.monedas.saldoNuevo, resp.monedas.saldoNuevo, "el saldo quedó igual");
  assert.equal(resp2.monedas.razon, "aun-no-pasaron-10-minutos");
});

test("todo pulso de XP exitoso llama al servicio de monedas, aunque gameId no venga", async () => {
  await crearUsuario("pulso_sin_juego");
  const headers = await headersParaUsuario("pulso_sin_juego");

  const resp = await llamar(usersHandler, "POST", { action: "xp" }, {
    username: "pulso_sin_juego",
    cantidad: 10
  }, headers);

  assert.equal(resp.success, true);
  assert.equal(resp.user.xp, 10, "el XP se suma igual");
  assert.equal(resp.monedas.otorgado, true);
  assert.ok(resp.monedas.monto >= MONEDAS_MINIMAS && resp.monedas.monto <= MONEDAS_MAXIMAS);
  assert.equal(resp.monedas.razon, null);

  const estado = await db.query("SELECT monedas, monedas_ultimo_otorgamiento FROM users WHERE username = $1", ["pulso_sin_juego"]);
  assert.equal(estado.rows[0].monedas, SALDO_INICIAL + resp.monedas.monto);
  assert.ok(estado.rows[0].monedas_ultimo_otorgamiento, "el otorgamiento quedó registrado");
});

test("si falla el servicio de monedas, el pulso de XP igual responde correctamente", async () => {
  await crearUsuario("pulso_con_falla_monedas");
  const headers = await headersParaUsuario("pulso_con_falla_monedas");

  const otorgarOriginal = MonedasService.prototype.otorgarPorTiempoJugado;
  const warnOriginal = console.warn;

  MonedasService.prototype.otorgarPorTiempoJugado = async () => {
    throw new Error("falla simulada del banco");
  };
  console.warn = () => {};

  try {
    const resp = await llamar(usersHandler, "POST", { action: "xp" }, {
      username: "pulso_con_falla_monedas",
      cantidad: 10,
      gameId: "juego-de-prueba"
    }, headers);

    assert.equal(resp.success, true);
    assert.equal(resp.user.xp, 10, "el XP no debe perderse por una falla de monedas");
    assert.equal(resp.subioNivel, false);
    assert.deepEqual(resp.monedas, {
      otorgado: false,
      monto: 0,
      saldoNuevo: null,
      razon: "error-al-otorgar"
    });
  } finally {
    MonedasService.prototype.otorgarPorTiempoJugado = otorgarOriginal;
    console.warn = warnOriginal;
  }
});

test("comprar en la tienda de avatares descuenta el saldo y rechaza si no alcanza", async () => {
  const id = await crearUsuario("comprador_tienda");
  const headers = await headersParaUsuario("comprador_tienda");

  const items = await sql`SELECT id, precio, nombre FROM avatar_shop_items ORDER BY precio ASC LIMIT 1;`;
  const item = items[0];

  const compra = await llamar(contentHandler, "POST", { action: "avatar-shop-buy" }, {
    username: "comprador_tienda",
    itemId: item.id
  }, headers);

  assert.equal(compra.success, true);
  assert.equal(compra.itemComprado, item.nombre);
  assert.equal(compra.monedas, SALDO_INICIAL - item.precio, "el saldo devuelto es el nuevo");
  assert.equal((await estadoMonedas(id)).monedas, SALDO_INICIAL - item.precio);

  // Comprar la misma prenda dos veces sigue rechazándose igual.
  const repetida = await llamar(contentHandler, "POST", { action: "avatar-shop-buy" }, {
    username: "comprador_tienda",
    itemId: item.id
  }, headers);
  assert.equal(repetida.success, false);
  assert.equal(repetida.error, "Ya tenés esta prenda");

  // Sin saldo, la compra se rechaza con el mensaje de siempre y no
  // queda registrada.
  await db.query("UPDATE users SET monedas = 0 WHERE id = $1", [id]);

  const otros = await sql`
    SELECT id FROM avatar_shop_items WHERE id <> ${item.id} ORDER BY precio ASC LIMIT 1;
  `;

  const sinSaldo = await llamar(contentHandler, "POST", { action: "avatar-shop-buy" }, {
    username: "comprador_tienda",
    itemId: otros[0].id
  }, headers);

  assert.equal(sinSaldo.success, false);
  assert.equal(sinSaldo.error, "No te alcanzan las monedas");
  assert.equal((await estadoMonedas(id)).monedas, 0, "el saldo no quedó en negativo");

  const compras = await db.query(
    "SELECT COUNT(*)::int AS cantidad FROM avatar_shop_purchases WHERE user_id = $1",
    [id]
  );
  assert.equal(compras.rows[0].cantidad, 1, "la compra rechazada no debe registrarse");
});

test("el catálogo de la tienda devuelve el saldo del usuario que lo pide", async () => {
  await crearUsuario("mirona_de_vidrieras");

  const resp = await llamar(contentHandler, "GET", { action: "avatar-shop", username: "mirona_de_vidrieras" });

  assert.equal(resp.success, true);
  assert.ok(resp.items.length > 0, "el catálogo debe tener prendas");
  assert.deepEqual(resp.comprados, [], "todavía no compró nada");
  assert.equal(resp.monedas, SALDO_INICIAL);
});

test("cada prenda de la tienda trae la dirección de su previsualización, o null", async () => {
  // La tienda enseña la previsualizacion. Antes buscaba el dibujo en el
  // indice publico, que solo trae lo que alguien lleva puesto, y lo que
  // nadie llevaba salia como una caja vacia con precio.
  const [item] = await sql`SELECT id, valor_capa FROM avatar_shop_items ORDER BY id LIMIT 1;`;
  const archivo = await db.query(
    `INSERT INTO avatar_archivos (sha256, datos, ancho, alto, peso) VALUES ($1, $2, 1, 1, 1) RETURNING id`,
    ["9".repeat(64), Buffer.from([1])]
  );
  const prenda = await db.query(
    `INSERT INTO avatar_prendas (valor, modelo, capa, nombre, archivo_id, previsualizacion)
     VALUES ($1, 'tora', 'remera', 'Con previsualizacion', $2, $3)
     ON CONFLICT (valor) DO UPDATE SET previsualizacion = EXCLUDED.previsualizacion
     RETURNING id`,
    [item.valor_capa, archivo.rows[0].id, "a1".repeat(32)]
  );

  const resp = await llamar(contentHandler, "GET", { action: "avatar-shop" });
  const conPrevia = resp.items.find(i => i.id === item.id);
  assert.equal(conPrevia.previsualizacion,
    "/previsualizaciones/" + prenda.rows[0].id + ".jpg?v=" + "a1".repeat(6));
  assert.ok(!("prendaId" in conPrevia), "se colo el id interno de la prenda");
  const sinPrevia = resp.items.filter(i => i.id !== item.id);
  assert.ok(sinPrevia.length > 0 && sinPrevia.every(i => i.previsualizacion === null),
    "una prenda sin previsualizacion tiene que llegar con null");
});

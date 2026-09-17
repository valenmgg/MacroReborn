// ==============================
// TESTS DEL AVISO POR RAFAGA — tests/rafaga.test.js
// ==============================
// api/_rafaga.js cuenta cuántas prendas DISTINTAS pide cada IP en una
// ventana de tiempo y avisa a los administradores cuando una se pasa.
//
// No impide nada, y por eso lo que hay que probar no es que bloquee sino
// que AVISE cuando toca y que no moleste cuando no toca:
//
//   - Por debajo del umbral, silencio. Si saltara con una página de
//     comunidad cargada entera, los administradores lo apagarían a la
//     semana y entonces no serviría para nada.
//   - La misma prenda pedida veinte veces es UNA prenda. Lo que delata a
//     quien copia el catálogo es la variedad, no el volumen.
//   - Cada IP por su cuenta.
//   - Un aviso, no uno por imagen mientras dure la ráfaga.
//   - Lo viejo se cae de la ventana.
//   - Y lo más importante de todo: contar imágenes no puede impedir
//     servir una imagen. Si la base no contesta, esto se traga el error.
//
// El umbral y la ventana se aprietan por variables de entorno, que para
// eso son configurables: aquí se usan números pequeños para no tener que
// simular trescientas peticiones.
//
// Correr:  npm test

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret";
process.env.MR_RAFAGA_UMBRAL = "5";
process.env.MR_RAFAGA_VENTANA_MS = "1000";
process.env.MR_RAFAGA_ESPERA_MS = "60000";

const { test, before, beforeEach, describe } = require("node:test");
const assert = require("node:assert");

const { crearBaseLocal, crearSqlPGlite } = require("../scripts/pglite");
const { usarSqlLocal } = require("../api/_db");

let db;
let rafaga;

const peticion = (ip) => ({ headers: { "x-forwarded-for": ip }, socket: {} });

async function notificaciones(username) {
  const r = await db.query(
    `SELECT n.titulo, n.mensaje FROM notifications n
     JOIN users u ON u.id = n.user_id
     WHERE u.username = $1 ORDER BY n.id`,
    [username]
  );
  return r.rows;
}

before(async () => {
  db = await crearBaseLocal();
  usarSqlLocal(crearSqlPGlite(db));
  rafaga = require("../api/_rafaga");

  const jefa = await db.query(
    `INSERT INTO users (username, password_hash, level, xp, status, created_at, last_login)
     VALUES ('jefa', 'hash', 1, 0, 'active', now(), now()) RETURNING id`
  );
  await db.query(`INSERT INTO badges (user_id, badge_id) VALUES ($1, 'administrador')`,
    [jefa.rows[0].id]);

  // Una cuenta normal, que NO tiene que recibir nada.
  await db.query(
    `INSERT INTO users (username, password_hash, level, xp, status, created_at, last_login)
     VALUES ('cualquiera', 'hash', 1, 0, 'active', now(), now())`
  );
});

beforeEach(() => rafaga.olvidarTodo());


describe("contar prendas distintas", () => {
  test("por debajo del umbral no avisa", async () => {
    let salto = false;
    for (let i = 0; i < 4; i++) {
      salto = await rafaga.contarPrenda(peticion("10.0.0.1"), "huella" + i) || salto;
    }

    assert.equal(salto, false, "cuatro prendas no son una ráfaga");
  });

  test("al llegar al umbral, avisa", async () => {
    let salto = false;
    for (let i = 0; i < 5; i++) {
      salto = await rafaga.contarPrenda(peticion("10.0.0.2"), "huella" + i) || salto;
    }

    assert.equal(salto, true);
  });

  test("la misma prenda veinte veces sigue siendo una prenda", async () => {
    // Lo que delata a quien copia el catálogo es la VARIEDAD. Alguien
    // recargando su propio perfil pide la misma capa muchas veces y no
    // tiene por qué disparar nada.
    let salto = false;
    for (let i = 0; i < 20; i++) {
      salto = await rafaga.contarPrenda(peticion("10.0.0.3"), "la-misma") || salto;
    }

    assert.equal(salto, false);
  });

  test("cada IP cuenta por su cuenta", async () => {
    for (let i = 0; i < 4; i++) await rafaga.contarPrenda(peticion("10.0.0.4"), "h" + i);
    for (let i = 0; i < 4; i++) await rafaga.contarPrenda(peticion("10.0.0.5"), "h" + i);

    // Ocho peticiones en total, cuatro por IP: ninguna llega al umbral.
    const salto = await rafaga.contarPrenda(peticion("10.0.0.4"), "otra-mas");
    assert.equal(salto, true, "la quinta de ESA IP sí");
  });

  test("lo viejo se cae de la ventana", async () => {
    const reloj = Date.now;
    let ahora = reloj();
    Date.now = () => ahora;

    try {
      for (let i = 0; i < 4; i++) await rafaga.contarPrenda(peticion("10.0.0.6"), "vieja" + i);

      // Pasa la ventana entera: esas cuatro ya no cuentan.
      ahora += 2000;

      let salto = false;
      for (let i = 0; i < 4; i++) {
        salto = await rafaga.contarPrenda(peticion("10.0.0.6"), "nueva" + i) || salto;
      }
      assert.equal(salto, false, "las viejas no deberían sumar");
    } finally {
      Date.now = reloj;
    }
  });
});


describe("a quién se avisa", () => {
  test("le llega a los administradores, y solo a ellos", async () => {
    for (let i = 0; i < 5; i++) await rafaga.contarPrenda(peticion("10.0.0.7"), "x" + i);

    const deLaJefa = await notificaciones("jefa");
    assert.ok(deLaJefa.length >= 1, "la administradora debería tener aviso");
    assert.match(deLaJefa[deLaJefa.length - 1].titulo, /catálogo/i);
    assert.match(deLaJefa[deLaJefa.length - 1].mensaje, /10\.0\.0\.7/);

    assert.equal((await notificaciones("cualquiera")).length, 0);
  });

  test("un aviso, no uno por imagen", async () => {
    const antes = (await notificaciones("jefa")).length;

    // Veinte prendas distintas de la misma IP: cruza el umbral en la
    // quinta y sigue pidiendo. Sin la espera, serían dieciséis avisos.
    for (let i = 0; i < 20; i++) await rafaga.contarPrenda(peticion("10.0.0.8"), "y" + i);

    const despues = (await notificaciones("jefa")).length;
    assert.equal(despues - antes, 1);
  });
});


describe("de dónde sale la IP", () => {
  test("con nginx delante, del X-Forwarded-For", () => {
    assert.equal(rafaga.ipDe({ headers: { "x-forwarded-for": "203.0.113.9" } }), "203.0.113.9");
  });

  test("si hay varios saltos, el primero es el cliente", () => {
    assert.equal(
      rafaga.ipDe({ headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1, 10.0.0.2" } }),
      "203.0.113.9"
    );
  });

  test("sin cabecera, la del socket", () => {
    assert.equal(rafaga.ipDe({ headers: {}, socket: { remoteAddress: "198.51.100.4" } }),
      "198.51.100.4");
  });

  test("una cabecera absurda se recorta", () => {
    // Es una cabecera que manda el cliente: no hay que fiarse de su
    // longitud ni guardarla entera como clave de un Map.
    const larga = rafaga.ipDe({ headers: { "x-forwarded-for": "9".repeat(5000) } });
    assert.ok(larga.length <= 64);
  });
});


describe("contar no puede romper el servir", () => {
  test("sin cabeceras ni socket, no lanza", async () => {
    assert.equal(await rafaga.contarPrenda({}, "alguna"), false);
  });

  test("sin huella, no cuenta", async () => {
    assert.equal(await rafaga.contarPrenda(peticion("10.0.0.9"), ""), false);
  });

  test("si la base no contesta, se traga el error", async () => {
    // El aviso se pierde, pero la imagen se sirve. Es el orden correcto
    // de prioridades: contar imágenes no puede impedir servirlas.
    usarSqlLocal(() => Promise.reject(new Error("base caída")));

    try {
      let salto = false;
      for (let i = 0; i < 5; i++) {
        salto = await rafaga.contarPrenda(peticion("10.0.0.10"), "z" + i) || salto;
      }
      assert.equal(salto, true, "debería haber intentado avisar, sin lanzar");
    } finally {
      usarSqlLocal(crearSqlPGlite(db));
    }
  });
});

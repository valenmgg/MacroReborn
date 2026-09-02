// ==============================
// TESTS DEL CATÁLOGO DE AVATARES — tests/avatar-catalogo.test.js
// ==============================
// Prueban el cierre del agujero de la Fase 3: hasta ahora el servidor
// aceptaba cualquier avatar que le mandaran, y las prendas de la tienda
// estaban bloqueadas solo por CSS en el navegador. Cualquiera con la
// consola abierta podía vestirse prendas de pago gratis.
//
// Se corren contra los handlers REALES (api/users.js y api/content.js)
// sobre una base local PGlite, igual que tests/monedas.test.js. Cero
// contacto con la base de producción.
//
// Qué se cubre:
//   - Un avatar legítimo se guarda.
//   - Una prenda inventada se rechaza.
//   - Una prenda premium sin comprar se rechaza (el agujero).
//   - Esa misma prenda, una vez comprada, se acepta.
//   - Una prenda puesta en la ranura equivocada se rechaza.
//   - Las claves que no son capas se rechazan.
//   - Las capas de más que vengan en el cuerpo no se guardan.
//   - DERECHO ADQUIRIDO: lo que el usuario ya tenía guardado se sigue
//     aceptando aunque hoy sea premium sin comprar. Esto protege a los
//     39 usuarios que ya estaban en esa situación antes de la
//     validación (y a los 3 que llevan "tora_piel7", que ni existe).
//   - La galería (saved_avatars) valida igual que el avatar activo.
//
// Correr:  npm test   (o: node --test tests/)

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret";

const { test, before } = require("node:test");
const assert = require("node:assert");

const { crearBaseLocal, crearSqlPGlite } = require("../scripts/pglite");
const { usarSqlLocal } = require("../api/_db");
const { crearToken } = require("../api/_auth");
const { obtenerCatalogo, CAPAS } = require("../api/_avatar-catalogo");

let db;
let sql;
let usersHandler;
let contentHandler;

// Prendas reales tomadas del catálogo en disco. No se escriben a mano
// para que el test no se rompa si mañana se renombra un archivo.
//
// Los tests comparten una misma base y corren en orden, así que cada
// prenda tiene un propósito fijo: las que se registran en la tienda no
// se reutilizan como prendas gratuitas más adelante, porque a partir de
// ese momento exigirían compra y harían fallar a los tests siguientes.
let MODELO;
let PRENDA_LIBRE;      // nunca entra a la tienda
let PRENDA_LIBRE_2;    // nunca entra a la tienda
let PRENDA_TIENDA;     // se registra como premium
let PRENDA_COMPRADA;   // premium, pero con compra registrada

before(async () => {
  db = await crearBaseLocal();
  sql = crearSqlPGlite(db);
  usarSqlLocal(sql);

  usersHandler = require("../api/users");
  contentHandler = require("../api/content");

  const { modelos, prendas } = obtenerCatalogo();

  assert.ok(modelos.size > 0, "el catálogo debe encontrar al menos un modelo");
  assert.ok(prendas.size > 0, "el catálogo debe encontrar prendas en imagenes/");

  // Las migraciones ya siembran la tienda con prendas reales, así que
  // no se puede dar por hecho que una prenda cualquiera sea gratuita:
  // se consulta cuáles son de pago y se descartan para los casos que
  // necesitan una prenda libre.
  const yaEnTienda = new Set(
    (await sql`SELECT valor_capa FROM avatar_shop_items;`).map(f => f.valor_capa)
  );

  // Se elige el modelo con más remeras gratuitas, para tener varias
  // distintas y no reutilizar ninguna entre tests.
  const remerasPorModelo = new Map();
  for (const [valor, capa] of prendas.entries()) {
    if (capa !== "remera" || yaEnTienda.has(valor)) continue;
    const modelo = valor.slice(0, valor.indexOf("_"));
    remerasPorModelo.set(modelo, (remerasPorModelo.get(modelo) || 0) + 1);
  }
  MODELO = [...remerasPorModelo.entries()].sort((a, b) => b[1] - a[1])[0][0];

  const libresDe = (capa) =>
    [...prendas.entries()]
      .filter(([valor, c]) =>
        c === capa && valor.startsWith(MODELO + "_") && !yaEnTienda.has(valor))
      .map(([valor]) => valor)
      .sort();

  const remeras = libresDe("remera");
  const pelos = libresDe("pelo");

  assert.ok(remeras.length >= 3, `${MODELO} debe tener 3 remeras fuera de la tienda`);
  assert.ok(pelos.length >= 1, `debe haber un pelo de ${MODELO} fuera de la tienda`);

  PRENDA_LIBRE = remeras[0];
  PRENDA_LIBRE_2 = remeras[1];
  PRENDA_COMPRADA = remeras[2];
  PRENDA_TIENDA = pelos[0];
});

function llamar(handler, metodo, query, body, headers) {
  return new Promise((resolve) => {
    const req = { method: metodo, query: query || {}, body: body || {}, headers: headers || {} };
    const res = {
      statusCode: 200,
      status(codigo) { this.statusCode = codigo; return this; },
      json(obj) { resolve({ codigo: this.statusCode, cuerpo: obj }); },
      end() { resolve({ codigo: this.statusCode, cuerpo: null }); },
      setHeader() {}
    };
    handler(req, res);
  });
}

async function crearUsuario(username) {
  const filas = await db.query(
    `INSERT INTO users (username, password_hash, level, xp, status, created_at, last_login)
     VALUES ($1, 'hash-de-prueba', 1, 0, 'active', now(), now())
     RETURNING id`,
    [username]
  );
  return filas.rows[0].id;
}

function cabeceras(id, username) {
  return { authorization: `Bearer ${crearToken({ id, username })}` };
}

function guardarAvatar(id, username, avatar) {
  return llamar(
    usersHandler, "POST", { action: "update-avatar" },
    { username, avatar }, cabeceras(id, username)
  );
}

function guardarEnGaleria(id, username, slot, avatar) {
  return llamar(
    contentHandler, "POST", { action: "avatar-gallery" },
    { username, slot, avatar }, cabeceras(id, username)
  );
}

// Registra una prenda en la tienda y devuelve su id.
async function ponerEnLaTienda(valorCapa, categoria, precio) {
  const filas = await db.query(
    `INSERT INTO avatar_shop_items (categoria, modelo, valor_capa, nombre, precio)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [categoria, MODELO, valorCapa, "Prenda de prueba " + valorCapa, precio]
  );
  return filas.rows[0].id;
}

// ==============================

test("un avatar con prendas del catálogo se guarda", async () => {
  const id = await crearUsuario("ana");
  const r = await guardarAvatar(id, "ana", {
    modelo: MODELO,
    remera: PRENDA_LIBRE,
    pelo: "ninguno"
  });

  assert.equal(r.cuerpo.success, true, r.cuerpo.error);
  assert.equal(r.cuerpo.user.avatar.remera, PRENDA_LIBRE);
  assert.equal(r.cuerpo.user.avatar.pelo, "ninguno");
});

test("una prenda inventada se rechaza", async () => {
  const id = await crearUsuario("beto");
  const r = await guardarAvatar(id, "beto", {
    modelo: MODELO,
    remera: MODELO + "_remera9999"
  });

  assert.equal(r.codigo, 400);
  assert.equal(r.cuerpo.success, false);
  assert.match(r.cuerpo.error, /no existe/i);
});

test("un modelo inventado se rechaza", async () => {
  const id = await crearUsuario("carla");
  const r = await guardarAvatar(id, "carla", { modelo: "modelo-que-no-existe" });

  assert.equal(r.codigo, 400);
  assert.match(r.cuerpo.error, /modelo/i);
});

test("una prenda en la ranura equivocada se rechaza", async () => {
  const id = await crearUsuario("dario");
  // Una remera puesta donde va el pelo: el navegador la dibujaría
  // flotando sobre la cabeza.
  const r = await guardarAvatar(id, "dario", {
    modelo: MODELO,
    pelo: PRENDA_LIBRE
  });

  assert.equal(r.codigo, 400);
  assert.match(r.cuerpo.error, /no es una prenda de pelo/i);
});

test("una clave que no es una capa se rechaza", async () => {
  const id = await crearUsuario("elsa");
  const r = await guardarAvatar(id, "elsa", {
    modelo: MODELO,
    sombrero_magico: PRENDA_LIBRE
  });

  assert.equal(r.codigo, 400);
  assert.match(r.cuerpo.error, /no es una capa/i);
});

test("EL AGUJERO: una prenda de la tienda sin comprar se rechaza", async () => {
  const id = await crearUsuario("fabi");
  await ponerEnLaTienda(PRENDA_TIENDA, "pelo", 120);

  const r = await guardarAvatar(id, "fabi", {
    modelo: MODELO,
    pelo: PRENDA_TIENDA
  });

  assert.equal(r.codigo, 400, "sin comprarla no debería poder ponérsela");
  assert.match(r.cuerpo.error, /no compraste/i);
});

test("la misma prenda, ya comprada, se acepta", async () => {
  const id = await crearUsuario("gina");

  const itemId = await ponerEnLaTienda(PRENDA_COMPRADA, "remera", 100);
  await db.query(
    `INSERT INTO avatar_shop_purchases (user_id, item_id) VALUES ($1, $2)`,
    [id, itemId]
  );

  const r = await guardarAvatar(id, "gina", {
    modelo: MODELO,
    remera: PRENDA_COMPRADA
  });

  assert.equal(r.cuerpo.success, true, r.cuerpo.error);
  assert.equal(r.cuerpo.user.avatar.remera, PRENDA_COMPRADA);
});

test("y sin comprarla, esa misma prenda se le rechaza a otro usuario", async () => {
  // Comprobación cruzada: la compra vale para quien la hizo, no para
  // cualquiera. PRENDA_COMPRADA ya está en la tienda por el test anterior.
  const id = await crearUsuario("gonzalo");

  const r = await guardarAvatar(id, "gonzalo", {
    modelo: MODELO,
    remera: PRENDA_COMPRADA
  });

  assert.equal(r.codigo, 400, "la compra de otro no debería habilitarlo");
  assert.match(r.cuerpo.error, /no compraste/i);
});

test("DERECHO ADQUIRIDO: lo que ya tenía puesto se sigue aceptando", async () => {
  // Reproduce el caso real de los 39 usuarios que ya llevaban prendas
  // premium antes de que existiera esta validación: si las
  // rechazáramos, no podrían volver a guardar su avatar nunca más.
  //
  // PRENDA_TIENDA ya está registrada como premium (test "EL AGUJERO") y
  // este usuario no la compró; la diferencia es que la tiene guardada.
  const id = await crearUsuario("hugo");

  await db.query(
    `UPDATE users SET avatar = $1 WHERE id = $2`,
    [JSON.stringify({ modelo: MODELO, pelo: PRENDA_TIENDA }), id]
  );

  // Cambia otra capa, pero conserva el pelo premium que ya tenía.
  const r = await guardarAvatar(id, "hugo", {
    modelo: MODELO,
    pelo: PRENDA_TIENDA,
    remera: PRENDA_LIBRE_2
  });

  assert.equal(r.cuerpo.success, true,
    "debe poder seguir usando lo que ya tenía: " + r.cuerpo.error);
  assert.equal(r.cuerpo.user.avatar.pelo, PRENDA_TIENDA);
});

test("una capa que apunta a un archivo inexistente, si ya la tenía, se conserva", async () => {
  // El caso real de "tora_piel7": tres usuarios lo llevan y el archivo
  // no está en disco. No se dibuja, pero no debe impedirles guardar.
  const id = await crearUsuario("ines");
  const fantasma = MODELO + "_piel999";

  await db.query(
    `UPDATE users SET avatar = $1 WHERE id = $2`,
    [JSON.stringify({ modelo: MODELO, piel: fantasma }), id]
  );

  const r = await guardarAvatar(id, "ines", {
    modelo: MODELO,
    piel: fantasma,
    remera: PRENDA_LIBRE
  });

  assert.equal(r.cuerpo.success, true, r.cuerpo.error);
  assert.equal(r.cuerpo.user.avatar.piel, fantasma);
});

test("las capas vacías se normalizan a 'ninguno'", async () => {
  const id = await crearUsuario("juan");
  const r = await guardarAvatar(id, "juan", {
    modelo: MODELO,
    remera: PRENDA_LIBRE,
    botas: null,
    guantes: ""
  });

  assert.equal(r.cuerpo.success, true, r.cuerpo.error);
  assert.equal(r.cuerpo.user.avatar.botas, "ninguno");
  assert.equal(r.cuerpo.user.avatar.guantes, "ninguno");
});

test("el avatar guardado se reconstruye: no entra basura extra", async () => {
  // El avatar que se guarda no es el que llegó: se rearma capa por
  // capa. Así, cualquier clave de más muere en la validación en vez de
  // terminar dentro del jsonb.
  const id = await crearUsuario("nadia");
  const r = await guardarAvatar(id, "nadia", {
    modelo: MODELO,
    remera: PRENDA_LIBRE
  });

  assert.equal(r.cuerpo.success, true, r.cuerpo.error);
  const guardado = r.cuerpo.user.avatar;
  assert.deepEqual(
    Object.keys(guardado).sort(),
    ["modelo", "remera"],
    "solo deben quedar las capas que se mandaron"
  );
});

test("un avatar que no es un objeto se rechaza", async () => {
  const id = await crearUsuario("nestor");
  const r = await guardarAvatar(id, "nestor", ["esto", "es", "un", "array"]);

  assert.equal(r.codigo, 400);
  assert.match(r.cuerpo.error, /formato/i);
});

test("un avatar con formato PNG no entra por este camino", async () => {
  const id = await crearUsuario("kevin");
  const r = await guardarAvatar(id, "kevin", {
    tipo: "png",
    src: "data:image/png;base64,AAAA"
  });

  assert.equal(r.codigo, 403);
  assert.equal(r.cuerpo.success, false);
});

test("LA GALERÍA valida igual: prenda no comprada, rechazada", async () => {
  // Sin esto, el agujero seguiría abierto por el otro lado: bastaría
  // con guardar la prenda en un casillero de la galería.
  // PRENDA_TIENDA ya está registrada como premium y lucia no la compró.
  const id = await crearUsuario("lucia");

  const r = await guardarEnGaleria(id, "lucia", 1, {
    modelo: MODELO,
    pelo: PRENDA_TIENDA
  });

  assert.equal(r.codigo, 400, "la galería no debe aceptar prendas sin comprar");
  assert.equal(r.cuerpo.success, false);
  assert.match(r.cuerpo.error, /no compraste/i);
});

test("la galería también rechaza una prenda inventada", async () => {
  const id = await crearUsuario("marta");
  const r = await guardarEnGaleria(id, "marta", 3, {
    modelo: MODELO,
    remera: MODELO + "_remera8888"
  });

  assert.equal(r.codigo, 400);
  assert.match(r.cuerpo.error, /no existe/i);
});

test("la galería sí acepta un avatar legítimo", async () => {
  const id = await crearUsuario("mario");
  const r = await guardarEnGaleria(id, "mario", 2, {
    modelo: MODELO,
    remera: PRENDA_LIBRE
  });

  assert.equal(r.cuerpo.success, true, r.cuerpo.error);
  assert.equal(r.cuerpo.slot.slot, 2);
});

test("el catálogo descarta los archivos con nombres irregulares", async () => {
  // En imagenes/tora/ hay "Boca 1.png" ... "Boca 8.png" (mayúscula y
  // espacio) que el frontend nunca pudo mostrar. No deben entrar al
  // catálogo como si fueran prendas usables.
  const { prendas } = obtenerCatalogo();
  for (const valor of prendas.keys()) {
    assert.ok(
      /^[a-z0-9]+_[a-z0-9]+$/.test(valor),
      `el catálogo no debería incluir "${valor}"`
    );
  }
});

test("todas las capas del catálogo son capas conocidas", async () => {
  const { prendas } = obtenerCatalogo();
  for (const capa of new Set(prendas.values())) {
    assert.ok(CAPAS.includes(capa), `"${capa}" no está en CAPAS`);
  }
});

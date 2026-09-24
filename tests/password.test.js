// ==============================
// TESTS DE CONTRASEÑAS — tests/password.test.js
// ==============================
// Prueban el flujo REAL de la API (los mismos handlers que corren en
// Vercel) contra una base local PGlite. Cero contacto con la base de
// producción: todo vive en esta computadora.
//
// Cómo funciona: antes de cargar la API, se crea la maqueta local y se
// la inyecta con api/_db.js (usarSqlLocal). Como cada archivo de test
// corre en su propio proceso, no hay contaminación entre tests.
//
// Correr:  npm test   (o: node --test tests/)

// El main actual firma las sesiones con SESSION_SECRET. Este valor solo
// existe dentro del proceso aislado de pruebas.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret";

require("./_aislar-datos");   // antes de api/: ver ese archivo

const { test, before } = require("node:test");
const assert = require("node:assert");
const bcrypt = require("bcryptjs");

const { crearBaseLocal, crearSqlPGlite } = require("../scripts/pglite");
const { usarSqlLocal } = require("../api/_db");

let db;
let authHandler;

// Se ejecuta una sola vez, antes que todos los tests.
before(async () => {
  db = await crearBaseLocal();
  usarSqlLocal(crearSqlPGlite(db));

  // IMPORTANTE: se cargan DESPUÉS de inyectar la base local, porque
  // los handlers resuelven su conexión al cargarse.
  authHandler = require("../api/auth");
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

// Lee una fila de la tabla users de la maqueta local.
async function filaUsuario(username) {
  const resultado = await db.query("SELECT * FROM users WHERE username = $1", [username]);
  return resultado.rows[0];
}

test("registrar guarda solo el hash bcrypt, nunca el texto plano", async () => {
  const resp = await llamar(authHandler, "POST", { action: "register" }, {
    username: "nuevo",
    password: "secreto123"
  });

  assert.equal(resp.success, true);

  const fila = await filaUsuario("nuevo");
  assert.ok(fila, "el usuario debe existir en la base");
  assert.ok(fila.password_hash, "debe haberse guardado un hash");
  assert.notEqual(fila.password_hash, "secreto123", "el hash no puede ser el texto plano");
  assert.equal(fila.password, null, "el texto plano no debe guardarse en la columna password");

  // El hash guardado debe verificar la contraseña original.
  assert.equal(await bcrypt.compare("secreto123", fila.password_hash), true);
});

test("login: contraseña correcta entra, incorrecta no, y la respuesta no filtra contraseñas", async () => {
  const ok = await llamar(authHandler, "POST", { action: "login" }, {
    username: "nuevo",
    password: "secreto123"
  });

  assert.equal(ok.success, true);
  assert.equal(ok.user.username, "nuevo");
  assert.ok(!("password" in ok.user), "la respuesta no debe incluir la contraseña");
  assert.ok(!("password_hash" in ok.user), "la respuesta no debe incluir el hash");

  const mal = await llamar(authHandler, "POST", { action: "login" }, {
    username: "nuevo",
    password: "incorrecta"
  });

  assert.equal(mal.success, false);
  assert.equal(mal.error, "Usuario o contraseña incorrectos");
});

test("usuario legacy (texto plano): login funciona y queda migrado a hash en el momento", async () => {
  // Simula un usuario de los viejos: contraseña en claro en users.password.
  await db.query(
    "INSERT INTO users (username, password, level, xp, status, created_at, last_login) VALUES ($1, $2, 1, 0, 'active', now(), now())",
    ["veterano", "clavevieja"]
  );

  const resp = await llamar(authHandler, "POST", { action: "login" }, {
    username: "veterano",
    password: "clavevieja"
  });

  assert.equal(resp.success, true, "el usuario viejo debe poder entrar con su contraseña");

  const fila = await filaUsuario("veterano");
  assert.ok(fila.password_hash, "debe quedar migrado a hash");
  assert.equal(fila.password, null, "el texto plano debe borrarse al migrar");

  // El segundo login debe seguir funcionando, ahora vía hash.
  const resp2 = await llamar(authHandler, "POST", { action: "login" }, {
    username: "veterano",
    password: "clavevieja"
  });
  assert.equal(resp2.success, true);

  // Y una contraseña incorrecta debe seguir rechazándose.
  const mal = await llamar(authHandler, "POST", { action: "login" }, {
    username: "veterano",
    password: "otra"
  });
  assert.equal(mal.success, false);
});

test("cambiar contraseña: verifica la actual, guarda el hash nuevo y la vieja deja de servir", async () => {
  const usersHandler = require("../api/users");

  const login = await llamar(authHandler, "POST", { action: "login" }, {
    username: "nuevo",
    password: "secreto123"
  });
  assert.equal(login.success, true);
  const headers = { authorization: `Bearer ${login.token}` };

  // Contraseña actual incorrecta -> error.
  const mal = await llamar(usersHandler, "POST", { action: "change-password" }, {
    username: "nuevo",
    currentPassword: "mal",
    newPassword: "nueva123"
  }, headers);
  assert.equal(mal.success, false);
  assert.equal(mal.error, "La contraseña actual no es correcta");

  // Cambio correcto.
  const ok = await llamar(usersHandler, "POST", { action: "change-password" }, {
    username: "nuevo",
    currentPassword: "secreto123",
    newPassword: "nueva123"
  }, headers);
  assert.equal(ok.success, true);

  const fila = await filaUsuario("nuevo");
  assert.ok(fila.password_hash);
  assert.equal(await bcrypt.compare("nueva123", fila.password_hash), true, "el hash guardado debe ser el de la nueva contraseña");

  // La contraseña vieja ya no entra; la nueva sí.
  const loginVieja = await llamar(authHandler, "POST", { action: "login" }, {
    username: "nuevo",
    password: "secreto123"
  });
  assert.equal(loginVieja.success, false);

  const loginNueva = await llamar(authHandler, "POST", { action: "login" }, {
    username: "nuevo",
    password: "nueva123"
  });
  assert.equal(loginNueva.success, true);
});

test("borrar cuenta: requiere la contraseña correcta y elimina al usuario", async () => {
  const login = await llamar(authHandler, "POST", { action: "login" }, {
    username: "veterano",
    password: "clavevieja"
  });
  assert.equal(login.success, true);
  const headers = { authorization: `Bearer ${login.token}` };

  // Contraseña incorrecta -> no borra.
  const mal = await llamar(authHandler, "POST", { action: "delete-account" }, {
    password: "mal"
  }, headers);
  assert.equal(mal.success, false);
  assert.ok(await filaUsuario("veterano"), "el usuario debe seguir existiendo");

  // Contraseña correcta -> borra.
  const ok = await llamar(authHandler, "POST", { action: "delete-account" }, {
    password: "clavevieja"
  }, headers);
  assert.equal(ok.success, true);
  assert.equal(await filaUsuario("veterano"), undefined, "el usuario debe haber desaparecido");
});

test("registro rechaza un nombre de usuario ya existente", async () => {
  const resp = await llamar(authHandler, "POST", { action: "register" }, {
    username: "nuevo",
    password: "otra123"
  });
  assert.equal(resp.success, false);
  assert.equal(resp.error, "Ese nombre de usuario ya existe");
});

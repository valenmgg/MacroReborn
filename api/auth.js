const { setCors } = require("./_utils");
const { obtenerSql } = require("./_db");
const { PasswordService } = require("./_password");
const { crearToken, requerirAuth } = require("./_auth");
const { validarNombreUsuario } = require("./_nombre-usuario");

const sql = obtenerSql();
const passwordService = new PasswordService(sql);

// ==============================
// /api/auth?action=login|register|delete-account
// ==============================
// Fusión de los antiguos endpoints /api/login, /api/register y
// /api/delete-account en un solo archivo, para bajar la cantidad de
// Serverless Functions en Vercel (plan Hobby: máx. 12). La lógica de
// cada acción es EXACTAMENTE la misma que tenían los archivos
// originales, solo cambia cómo se elige cuál correr.
//
// SEGURIDAD (migración hash de contraseñas): las contraseñas ya no se
// guardan en texto plano en users.password. Se guarda SOLO el hash
// bcrypt en users.password_hash (ver api/_password.js). Los usuarios
// que todavía tienen texto plano se migran solos en su próximo login.
//
// POST /api/auth?action=login           { username, password }
// POST /api/auth?action=register        { username, password }
// POST /api/auth?action=delete-account  { username, password }
// ==============================

async function login(req, res) {
  const { username, password } = req.body;

  // verificar() valida la contraseña (contra el hash, o contra el
  // texto plano restante migrándolo al vuelo) y devuelve el usuario
  // sin campos de contraseña, o null si las credenciales no sirven.
  const usuario = await passwordService.verificar(username, password);

  if (!usuario) {
    return res.status(200).json({
      success: false,
      error: "Usuario o contraseña incorrectos"
    });
  }

  const actualizado = await sql`
    UPDATE users
    SET last_login = now()
    WHERE id = ${usuario.id}
    RETURNING last_login;
  `;

  const usuarioSesion = { ...usuario, last_login: actualizado[0].last_login };
  return res.status(200).json({
    success: true,
    user: usuarioSesion,
    token: crearToken(usuarioSesion)
  });
}

async function register(req, res) {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(200).json({
      success: false,
      error: "Usuario y contraseña son obligatorios"
    });
  }

  // El nombre se pinta en todo el sitio: ver api/_nombre-usuario.js.
  const revision = validarNombreUsuario(username);
  if (!revision.ok) {
    return res.status(200).json({ success: false, error: revision.error });
  }

  const existente = await sql`SELECT id FROM users WHERE username = ${username};`;

  if (existente.length > 0) {
    return res.status(200).json({
      success: false,
      error: "Ese nombre de usuario ya existe"
    });
  }

  // registrar() guarda SOLO el hash de la contraseña, nunca el texto
  // plano. El resto del comportamiento es idéntico al original:
  // last_login arranca en NULL (un usuario recién registrado todavía
  // no inició sesión, así que no debe aparecer "En línea").
  const user = await passwordService.registrar(username, password);

  return res.status(200).json({
    success: true,
    user
  });
}

async function deleteAccount(req, res) {
  const auth = requerirAuth(req, res);
  if (!auth) return;

  const { password } = req.body || {};

  if (!password) {
    return res.status(400).json({ success: false, error: "Faltan datos" });
  }

  // El token firmado identifica a la cuenta; el username enviado por
  // el navegador ya no decide qué fila puede borrarse.
  const usuario = await sql`
    SELECT id, username
    FROM users
    WHERE id = ${auth.sub}
    LIMIT 1;
  `;

  if (usuario.length === 0) {
    return res.status(401).json({ success: false, error: "La sesión ya no es válida" });
  }

  const resultado = await passwordService.eliminarCuenta(usuario[0].username, password);

  if (!resultado.ok) {
    return res.status(200).json({ success: false, error: "Contraseña incorrecta" });
  }

  return res.status(200).json({ success: true });
}

module.exports = async function handler(req, res) {

  setCors(res, "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Método no permitido" });
  }

  const action = req.query.action;

  try {

    if (action === "login") return await login(req, res);
    if (action === "register") return await register(req, res);
    if (action === "delete-account") return await deleteAccount(req, res);

    return res.status(400).json({ success: false, error: "Acción inválida" });

  } catch (error) {
    console.error("/api/auth:", error);
    return res.status(500).json({ success: false, error: "Error interno del servidor" });
  }
};

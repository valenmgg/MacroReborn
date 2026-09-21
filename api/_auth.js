const crypto = require('crypto');

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Cuánto vive un pase para /api/avisos. Un minuto sobra: el navegador lo
// pide y lo usa en el mismo instante. Ver "EL PASE" más abajo.
const PASE_TTL_MS = 60 * 1000;

function getSecret() {
  // SESSION_SECRET es la clave recomendada y tiene prioridad.
  // El fallback a DATABASE_URL mantiene el login funcionando en despliegues
  // existentes que todavía no tienen SESSION_SECRET configurado.
  // Configura SESSION_SECRET en Vercel para eliminar este fallback.
  const secret = process.env.SESSION_SECRET || process.env.DATABASE_URL;
  if (!secret) throw new Error('Falta configurar SESSION_SECRET');
  return String(secret);
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function sign(value) {
  return crypto.createHmac('sha256', getSecret()).update(value).digest('base64url');
}

function firmar(payload) {
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

function crearToken(usuario) {
  return firmar({
    sub: Number(usuario.id),
    username: usuario.username,
    iat: Date.now(),
    exp: Date.now() + TOKEN_TTL_MS
  });
}

// Lee un valor firmado y devuelve su carga si la firma es buena, no ha
// caducado y trae sujeto y nombre. No distingue una sesión de un pase:
// eso lo hacen verificarToken() y verificarPase(), cada uno en su
// sentido, porque lo que hace falta es que NINGUNO valga por el otro.
function leerFirmado(valor) {
  if (!valor || typeof valor !== 'string') return null;
  const partes = valor.split('.');
  if (partes.length !== 2) return null;

  const [encoded, signature] = partes;
  const expected = sign(encoded);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch (_) {
    return null;
  }

  if (!payload || !payload.sub || !payload.username || !payload.exp || Date.now() > Number(payload.exp)) {
    return null;
  }

  return payload;
}

// La sesión de siempre. Un pase lleva la misma firma y el mismo secreto,
// así que sin esta comprobación un pase caído en un registro abriría la
// API entera durante su minuto de vida. Se reconoce por su `uso`.
function verificarToken(token) {
  const payload = leerFirmado(token);
  if (!payload || payload.uso) return null;
  return payload;
}

// ==============================
// EL PASE PARA /api/avisos
// ==============================
// Toda la API se identifica con la cabecera Authorization. Pero la pieza
// del navegador que abre la línea de avisos en vivo, EventSource, no
// puede mandar cabeceras: es una limitación del navegador. Lo único que
// puede llevar es la URL.
//
// Meter el token de sesión en la URL está descartado: nginx apunta las
// URL en su registro durante dos semanas, y ese token vale siete días.
// Así que el navegador pide primero, con su cabecera de siempre, un pase
// que caduca en un minuto y solo sirve para abrir /api/avisos. Si acaba
// en un registro, al minuto no vale para nada; y nunca vale como sesión,
// porque verificarToken() lo rechaza por su `uso`.
//
// El segundo parámetro existe para las pruebas: un pase que nace ya
// caducado. En el código de verdad no se pasa.
function crearPase(auth, ttlMs = PASE_TTL_MS) {
  return firmar({
    sub: Number(auth.sub),
    username: auth.username,
    uso: 'avisos',
    exp: Date.now() + ttlMs
  });
}

function verificarPase(pase) {
  const payload = leerFirmado(pase);
  if (!payload || payload.uso !== 'avisos') return null;
  return payload;
}

function extraerBearer(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice(7).trim();
}

function obtenerAuth(req) {
  const payload = verificarToken(extraerBearer(req));
  return payload;
}

function requerirAuth(req, res) {
  const auth = obtenerAuth(req);
  if (!auth) {
    res.status(401).json({ success: false, error: 'Sesión no válida o expirada' });
    return null;
  }
  return auth;
}

module.exports = {
  TOKEN_TTL_MS, PASE_TTL_MS,
  crearToken, verificarToken,
  crearPase, verificarPase,
  extraerBearer, obtenerAuth, requerirAuth
};

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

// "inicio" es cuándo se inició sesión de verdad, y viaja de pase en pase
// al renovarlo (ver renovarSiToca, abajo).
function crearToken(usuario) {
  const ahora = Date.now();
  return firmar({
    sub: Number(usuario.id),
    username: usuario.username,
    iat: ahora,
    exp: ahora + TOKEN_TTL_MS,
    inicio: ahora
  });
}

// ==============================
// RENOVAR LA SESIÓN MIENTRAS SE USA
// ==============================
// El pase dura 7 días desde que se firma, y hasta el 25/09/2026 solo se
// firmaba al iniciar sesión: a los 7 días de entrar, todo lo que escribe
// -el XP de jugar, el chat, los comentarios- fallaba en silencio, aunque
// la página siguiera enseñando a la persona como conectada. Lo reportó la
// comunidad, y en los registros eran de 150 a 330 escrituras rechazadas
// al día.
//
// Ahora, a quien usa el sitio se le renueva: si el pase que trae se firmó
// hace más de un día, la respuesta lleva uno nuevo en la cabecera
// X-Sesion-Nueva, y js/core.js lo guarda en lugar del viejo. Así solo
// caduca tras 7 días sin entrar.
//
// Con un tope de 30 días desde "inicio". Sin él, un pase robado se podría
// mantener vivo para siempre usándolo una vez por semana, y hoy cerrar
// sesión no lo invalida (punto 12 de docs/AUDITORIA.md). Una vez al mes,
// iniciar sesión otra vez; js/core.js avisa cuando toca.
const RENOVAR_TRAS_MS = 24 * 60 * 60 * 1000;
const SESION_MAXIMA_MS = 30 * 24 * 60 * 60 * 1000;

function renovarSiToca(payload, res) {
  if (!res || typeof res.setHeader !== 'function') return;
  const ahora = Date.now();
  if (ahora - Number(payload.iat || 0) < RENOVAR_TRAS_MS) return;

  // Los pases de antes no traen "inicio": se cuenta desde que se firmaron.
  const inicio = Number(payload.inicio || payload.iat) || ahora;
  const exp = Math.min(ahora + TOKEN_TTL_MS, inicio + SESION_MAXIMA_MS);
  if (exp <= Number(payload.exp)) return;   // llegó al tope: ya no se alarga

  res.setHeader('X-Sesion-Nueva', firmar({
    sub: Number(payload.sub),
    username: payload.username,
    iat: ahora,
    exp,
    inicio
  }));
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
  renovarSiToca(auth, res);
  return auth;
}

module.exports = {
  TOKEN_TTL_MS, PASE_TTL_MS, RENOVAR_TRAS_MS, SESION_MAXIMA_MS,
  firmar,
  crearToken, verificarToken,
  crearPase, verificarPase,
  extraerBearer, obtenerAuth, requerirAuth
};

const { obtenerSql } = require('./_db');
const { setCors } = require('./_utils');
const { requerirAuth } = require('./_auth');

const sql = obtenerSql();

const ORIGINALES = new Map([
  ['113', { id: '113', slug: 'macro-snake', nombre: 'Macro Snake' }]
]);

function enteroNoNegativo(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function validarNombreJuego(gameId) {
  const juego = ORIGINALES.get(String(gameId));
  return juego || null;
}

async function leaderboard(req, res) {
  const gameId = String(req.query?.gameId || '113');
  const juego = validarNombreJuego(gameId);
  if (!juego) return res.status(400).json({ success: false, error: 'Original no disponible' });

  const limitRaw = enteroNoNegativo(req.query?.limit || 20);
  const limit = Math.min(Math.max(limitRaw || 20, 1), 100);

  const filas = await sql`
    SELECT
      s.id,
      s.score,
      s.created_at,
      u.username,
      u.level,
      u.avatar
    FROM originales_scores s
    JOIN users u ON u.id = s.user_id
    WHERE s.game_id = ${juego.id}
    ORDER BY s.score DESC, s.created_at ASC, s.id ASC
    LIMIT ${limit};
  `;

  const mejoresPorUsuario = new Map();
  for (const fila of filas) {
    const key = String(fila.username);
    if (!mejoresPorUsuario.has(key)) mejoresPorUsuario.set(key, fila);
  }

  const top = [...mejoresPorUsuario.values()].map((fila, index) => ({
    posicion: index + 1,
    username: fila.username,
    level: Number(fila.level || 1),
    avatar: fila.avatar || null,
    score: Number(fila.score),
    createdAt: fila.created_at
  }));

  return res.status(200).json({ success: true, juego, top });
}

async function enviarPuntuacion(req, res) {
  const auth = requerirAuth(req, res);
  if (!auth) return;

  const body = req.body || {};
  const juego = validarNombreJuego(body.gameId);
  if (!juego) return res.status(400).json({ success: false, error: 'Original no disponible' });

  const score = enteroNoNegativo(body.score);
  if (score === null || score > 1000000000) {
    return res.status(400).json({ success: false, error: 'Puntuación inválida' });
  }

  const fila = await sql`
    INSERT INTO originales_scores (user_id, game_id, score, created_at)
    VALUES (${auth.sub}, ${juego.id}, ${score}, NOW())
    RETURNING id, score, created_at;
  `;

  const mejor = await sql`
    SELECT MAX(score)::bigint AS score
    FROM originales_scores
    WHERE user_id = ${auth.sub} AND game_id = ${juego.id};
  `;

  return res.status(201).json({
    success: true,
    juego,
    puntuacion: Number(fila[0].score),
    mejorPuntuacion: Number(mejor[0]?.score || score),
    id: fila[0].id,
    createdAt: fila[0].created_at
  });
}

async function misPuntuaciones(req, res) {
  const auth = requerirAuth(req, res);
  if (!auth) return;

  const gameId = String(req.query?.gameId || '113');
  const juego = validarNombreJuego(gameId);
  if (!juego) return res.status(400).json({ success: false, error: 'Original no disponible' });

  const filas = await sql`
    SELECT score, created_at
    FROM originales_scores
    WHERE user_id = ${auth.sub} AND game_id = ${juego.id}
    ORDER BY score DESC, created_at ASC
    LIMIT 20;
  `;

  return res.status(200).json({
    success: true,
    juego,
    mejorPuntuacion: filas.length ? Number(filas[0].score) : 0,
    historial: filas.map(f => ({ score: Number(f.score), createdAt: f.created_at }))
  });
}

module.exports = async function handler(req, res) {
  setCors(res, "GET, POST, OPTIONS");
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const action = String(req.query?.action || 'leaderboard');
    if (req.method === 'GET' && action === 'leaderboard') return await leaderboard(req, res);
    if (req.method === 'GET' && action === 'mine') return await misPuntuaciones(req, res);
    if (req.method === 'POST' && action === 'score') return await enviarPuntuacion(req, res);
    return res.status(405).json({ success: false, error: 'Método o acción no permitidos' });
  } catch (error) {
    console.error('originales-ranking error', error);
    return res.status(500).json({ success: false, error: 'No se pudo procesar la competición' });
  }
};

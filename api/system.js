const { setCors } = require("./_utils");
const { requerirAuth } = require("./_auth");
const { obtenerSql } = require("./_db");

const sql = obtenerSql();

// ==============================
// /api/system?action=test-db
// ==============================
// Antes era /api/test-db. Se mantiene como diagnóstico manual (no lo
// llama ningún archivo del frontend) para poder chequear la conexión
// a Neon a mano visitando /api/system?action=test-db.
// ==============================

async function testDb(req, res) {
  const result = await sql`SELECT NOW()`;
  return res.status(200).json({
    success: true,
    time: result[0].now
  });
}

// ==============================
// /api/system?action=admin-stats
// ==============================
// Agregados para el panel de administración (pestaña Estadísticas,
// admin.html). Antes se calculaban recorriendo un montón de claves de
// localStorage (juegosJugados_<nombre>, favoritos_<nombre>,
// chatGeneral, amigos_<nombre>, reportesComentarios, logros_<nombre>,
// usuariosMacro) que dejaron de llenarse cuando esos sistemas pasaron
// a Neon, así que el panel siempre mostraba todo en cero. Ahora se
// calcula todo con SQL, del lado del servidor.
//
// "juegos.totalDisponibles" y las etiquetas (nombre/ícono) de juegos,
// logros e insignias NO viajan acá: esos catálogos viven en archivos
// JS del sitio (js/datos-juegos.js, js/motor/logros.js,
// js/motor/insignias.js), no en la base. El endpoint devuelve
// gameId/achievementId/badgeId "en crudo" y js/motor/panelEstadisticas.js
// los traduce con esos catálogos, que ya están cargados en admin.html.
// ==============================

async function adminStats(req, res) {

  const auth = requerirAuth(req, res);
  if (!auth) return;
  const admin = await sql`SELECT 1 FROM badges WHERE user_id = ${auth.sub} AND badge_id = 'administrador' LIMIT 1;`;
  if (!admin.length) return res.status(403).json({ success:false,error:"Solo un administrador puede consultar estas estadísticas" });

  const [
    usuariosTotal,
    usuariosSuspendidos,
    usuariosActivos7dias,
    usuariosNuevos30dias,
    usuariosConectadosAhora,
    rolesFilas,
    comentariosTotal,
    mensajesChatTotal,
    amistadesTotal,
    reportesPendientes,
    reportesTotales,
    juegosMasJugados,
    juegosFavoritos,
    topNivel,
    topXP,
    logrosTop,
    insigniasTop
  ] = await Promise.all([

    sql`SELECT COUNT(*)::int AS n FROM users;`,
    sql`SELECT COUNT(*)::int AS n FROM users WHERE suspendido = true;`,
    sql`SELECT COUNT(*)::int AS n FROM users WHERE last_login > now() - interval '7 days';`,
    sql`SELECT COUNT(*)::int AS n FROM users WHERE created_at > now() - interval '30 days';`,
    sql`SELECT COUNT(*)::int AS n FROM users WHERE last_login > now() - interval '5 minutes';`,

    sql`SELECT badge_id, COUNT(*)::int AS n FROM badges WHERE badge_id IN ('administrador','moderador','colaborador') GROUP BY badge_id;`,

    sql`SELECT COUNT(*)::int AS n FROM profile_comments;`,
    sql`SELECT COUNT(*)::int AS n FROM chat_messages;`,
    sql`SELECT (COUNT(*) / 2)::int AS n FROM friendships;`,

    sql`SELECT COUNT(*)::int AS n FROM comment_reports WHERE estado = 'pendiente';`,
    sql`SELECT COUNT(*)::int AS n FROM comment_reports;`,

    sql`SELECT game_id, COUNT(*)::int AS cantidad FROM games_played GROUP BY game_id ORDER BY cantidad DESC LIMIT 5;`,
    sql`SELECT game_id, COUNT(*)::int AS cantidad FROM game_favorites GROUP BY game_id ORDER BY cantidad DESC LIMIT 5;`,

    sql`SELECT username, level FROM users ORDER BY level DESC, xp DESC LIMIT 5;`,
    sql`SELECT username, xp FROM users ORDER BY xp DESC LIMIT 5;`,

    sql`SELECT achievement_id, COUNT(*)::int AS cantidad FROM achievements GROUP BY achievement_id ORDER BY cantidad DESC LIMIT 5;`,
    sql`SELECT badge_id, COUNT(*)::int AS cantidad FROM badges GROUP BY badge_id ORDER BY cantidad DESC LIMIT 5;`

  ]);

  const rolesMapa = { administrador: 0, moderador: 0, colaborador: 0 };
  rolesFilas.forEach(f => { rolesMapa[f.badge_id] = f.n; });

  return res.status(200).json({
    success: true,

    usuarios: {
      total: usuariosTotal[0].n,
      suspendidos: usuariosSuspendidos[0].n,
      activos7dias: usuariosActivos7dias[0].n,
      nuevos30dias: usuariosNuevos30dias[0].n,
      conectadosAhora: usuariosConectadosAhora[0].n
    },

    roles: {
      administradores: rolesMapa.administrador,
      moderadores: rolesMapa.moderador,
      colaboradores: rolesMapa.colaborador
    },

    juegos: {
      masJugados: juegosMasJugados,
      favoritos: juegosFavoritos
    },

    comunidad: {
      comentarios: comentariosTotal[0].n,
      mensajesChat: mensajesChatTotal[0].n,
      amigos: amistadesTotal[0].n,
      reportesPendientes: reportesPendientes[0].n,
      reportesTotales: reportesTotales[0].n
    },

    progreso: {
      topNivel: topNivel,
      topXP: topXP,
      logrosTop: logrosTop,
      insigniasTop: insigniasTop
    }

  });

}

// ==============================
// RANKING POR TIEMPO JUGADO — cálculo compartido
// ==============================
// La cuenta en sí (calcularYAplicarRanking) es una sola función que
// usan DOS acciones distintas, cada una con su propia manera de
// autorizarse:
//
//   - action=recalcular-ranking (GET): la dispara el cron del servidor
//     todos los lunes a las 5:00 hora Argentina (ver
//     infra/scripts/crontab.txt y infra/scripts/recalcular-ranking.sh).
//     Se protege con CRON_SECRET, que vive en el .env del proyecto.
//
//     Ojo con esto: el secreto lo ponía Vercel en el entorno de la
//     función, y al mudarnos al VPS nadie lo puso. Durante semanas el
//     cron corrió cada lunes y devolvió 503 sin que el ranking se
//     recalculara, porque devolver un error no es fallar desde el punto
//     de vista de cron. Ahora el script sale con código 1 si la
//     respuesta no es un 200 con success:true.
//
//   - action=recalcular-ranking-manual (POST): botón "🔄 Recalcular
//     ranking ahora" en admin.html (pestaña Estadísticas), para poder
//     probarlo o forzarlo sin esperar al próximo lunes. Se protege
//     verificando que el usuario que lo pide tenga la insignia de
//     administrador (misma tabla "badges" que ya usa el resto del
//     panel), no con CRON_SECRET: ese secreto no debe viajar nunca al
//     navegador.
//
// Ninguna otra parte del código llama a esto: entre una corrida y la
// siguiente, las posiciones quedan fijas a propósito.
//
// ---- Cómo se puntúa cada usuario ----
//
// 1) Se toma la semana recién terminada (lunes a domingo, en horario
//    argentino) de "ranking_actividad_semanal" y
//    "ranking_juegos_semanales" (ver migración
//    011_ranking_tiempo_jugado.sql; se van llenando solas mientras el
//    usuario juega, un pulso por minuto — ver api/users.js).
//
// 2) factorFrecuencia: premia haber jugado en varios días distintos
//    de la semana en vez de todo de una sentada. 1 día = factor 1.00,
//    7 días = factor 1.48 (+8% por cada día activo extra).
//
// 3) factorDiversidad: compara los juegos jugados esta semana contra
//    los jugados en las 4 semanas previas.
//      - Si son todos juegos que NO se venían jugando: factor 1.25.
//      - Si son EXACTAMENTE los mismos juegos de siempre: factor 0.75.
//    Por eso, jugar nada más que a los mismos juegos de siempre no
//    hace subir el ranking: en el mejor de los casos, sube bastante
//    menos que alguien que varía; en la práctica termina empujando la
//    puntuación hacia abajo frente a jugadores más activos/variados.
//
// 4) puntuacionSemana = minutosJugados * factorFrecuencia * factorDiversidad
//
// 5) La puntuación final no es solo la de esta semana: se mezcla con
//    la puntuación acumulada que ya tenía (60% lo que ya tenía + 40%
//    lo de esta semana). Así el ranking refleja un hábito sostenido
//    en el tiempo, no un pico de un solo lunes, y un usuario que deja
//    de jugar va cayendo semana a semana (puntuacionSemana = 0 esa
//    semana) en vez de quedar congelado en su mejor puntuación vieja.
//
// 6) Se ordena a todos por esa puntuación final (de mayor a menor) y
//    se guarda: rank_anterior = la posición que tenían, rank_actual =
//    la posición nueva, rank_actualizado_at = ahora. Esto es lo mismo
//    que ya usaba comunidad-ranking.html para mostrar "+2 / -1" junto
//    a cada jugador (js/comunidad-ranking.js -> rkDeltaHTML()).
//
// IMPORTANTE — si se llama dos veces la misma semana (por ejemplo,
// probando el botón manual un miércoles): como todavía no pasó el
// próximo lunes, "semana" da la misma que la última vez, así que
// vuelve a mezclar la puntuación ya mezclada con la misma
// puntuacionSemana de nuevo. No rompe nada, pero repetirlo varias
// veces seguidas para la misma semana empuja la puntuación un poco
// más de lo normal hacia esa semana. Pensado para probar el sistema,
// no para spamear el botón.
// ==============================

const DIAS_POR_SEMANA = 7;
const PASO_FRECUENCIA = 0.08;          // cada día activo extra suma 8%
const BONUS_DIVERSIDAD_MAX = 1.25;     // 0% de juegos repetidos
const PENALIZACION_DIVERSIDAD_MAX = 0.75; // 100% de juegos repetidos
const PESO_PUNTUACION_ANTERIOR = 0.6;
const PESO_PUNTUACION_SEMANA = 0.4;

async function calcularYAplicarRanking() {

  // Semana recién terminada (el lunes anterior al lunes de hoy),
  // calculada en horario argentino para que coincida con el
  // calendario real de los usuarios.
  const [{ semana }] = await sql`
    SELECT (
      date_trunc('week', (now() AT TIME ZONE 'America/Argentina/Buenos_Aires'))
      - interval '7 days'
    )::date AS semana;
  `;

  const [
    actividadSemana,
    juegosSemana,
    juegosHistorial,
    usuarios
  ] = await Promise.all([

    sql`
      SELECT user_id, minutos_jugados, dias_activos
      FROM ranking_actividad_semanal
      WHERE semana = ${semana};
    `,

    sql`
      SELECT user_id, game_id
      FROM ranking_juegos_semanales
      WHERE semana = ${semana};
    `,

    // Juegos distintos jugados en las 4 semanas ANTERIORES a la que
    // se está puntuando (no incluye la semana actual).
    sql`
      SELECT DISTINCT user_id, game_id
      FROM ranking_juegos_semanales
      WHERE semana < ${semana}
        AND semana >= (${semana}::date - INTERVAL '28 days');
    `,

    sql`SELECT id, rank_actual, ranking_puntuacion FROM users;`

  ]);

  if (usuarios.length === 0) {
    return { semana, usuariosActualizados: 0 };
  }

  const actividadPorUsuario = new Map();
  actividadSemana.forEach(fila => actividadPorUsuario.set(fila.user_id, fila));

  const juegosEstaSemanaPorUsuario = new Map();
  juegosSemana.forEach(fila => {
    if (!juegosEstaSemanaPorUsuario.has(fila.user_id)) {
      juegosEstaSemanaPorUsuario.set(fila.user_id, new Set());
    }
    juegosEstaSemanaPorUsuario.get(fila.user_id).add(fila.game_id);
  });

  const juegosHistorialPorUsuario = new Map();
  juegosHistorial.forEach(fila => {
    if (!juegosHistorialPorUsuario.has(fila.user_id)) {
      juegosHistorialPorUsuario.set(fila.user_id, new Set());
    }
    juegosHistorialPorUsuario.get(fila.user_id).add(fila.game_id);
  });

  const resultados = usuarios.map(usuario => {

    const actividad = actividadPorUsuario.get(usuario.id);
    const minutos = actividad ? Number(actividad.minutos_jugados) || 0 : 0;
    const dias = actividad ? Math.min(Number(actividad.dias_activos) || 0, DIAS_POR_SEMANA) : 0;

    const juegosEstaSemana = juegosEstaSemanaPorUsuario.get(usuario.id) || new Set();
    const juegosPrevios = juegosHistorialPorUsuario.get(usuario.id) || new Set();

    let ratioRepeticion = 0;
    if (juegosEstaSemana.size > 0) {
      let repetidos = 0;
      juegosEstaSemana.forEach(juego => { if (juegosPrevios.has(juego)) repetidos++; });
      ratioRepeticion = repetidos / juegosEstaSemana.size;
    }

    const factorFrecuencia = dias > 0 ? 1 + ((dias - 1) * PASO_FRECUENCIA) : 0;

    const factorDiversidadCrudo = BONUS_DIVERSIDAD_MAX - (ratioRepeticion * (BONUS_DIVERSIDAD_MAX - PENALIZACION_DIVERSIDAD_MAX));
    const factorDiversidad = Math.min(BONUS_DIVERSIDAD_MAX, Math.max(PENALIZACION_DIVERSIDAD_MAX, factorDiversidadCrudo));

    const puntuacionSemana = minutos * factorFrecuencia * factorDiversidad;

    const puntuacionAnterior = Number(usuario.ranking_puntuacion) || 0;
    const puntuacionFinal = Math.round(
      ((puntuacionAnterior * PESO_PUNTUACION_ANTERIOR) + (puntuacionSemana * PESO_PUNTUACION_SEMANA)) * 100
    ) / 100;

    return {
      id: usuario.id,
      rankAnterior: usuario.rank_actual,
      puntuacionFinal,
      minutos // para desempatar posiciones iguales de puntuación
    };

  });

  resultados.sort((a, b) => {
    if (b.puntuacionFinal !== a.puntuacionFinal) return b.puntuacionFinal - a.puntuacionFinal;
    return b.minutos - a.minutos;
  });

  // Se actualiza de a un usuario por vez (cantidad de jugadores
  // acotada, no hace falta una sola query masiva — mismo criterio que
  // ya usaba el snapshot anterior).
  for (let i = 0; i < resultados.length; i++) {
    const r = resultados[i];
    await sql`
      UPDATE users
      SET rank_anterior = ${r.rankAnterior},
          rank_actual = ${i + 1},
          rank_actualizado_at = now(),
          ranking_puntuacion = ${r.puntuacionFinal}
      WHERE id = ${r.id};
    `;
  }

  return { semana, usuariosActualizados: resultados.length };

}

// ==============================
// /api/system?action=recalcular-ranking (GET, cron)
// ==============================

async function recalcularRanking(req, res) {

  const secreto = process.env.CRON_SECRET;

  if (!secreto) {
    return res.status(503).json({
      success: false,
      error: "Falta configurar CRON_SECRET en las variables de entorno del proyecto."
    });
  }

  if (req.headers["authorization"] !== `Bearer ${secreto}`) {
    return res.status(401).json({ success: false, error: "No autorizado" });
  }

  const resultado = await calcularYAplicarRanking();

  return res.status(200).json({ success: true, ...resultado });

}

// ==============================
// /api/system?action=recalcular-ranking-manual (POST, panel admin)
// ==============================
// Mismo cálculo que el cron, pero disparado a mano desde el botón
// "🔄 Recalcular ranking ahora" de admin.html. Se autoriza chequeando
// del lado del servidor que el usuario que lo pide tenga la insignia
// de administrador (tabla "badges"), no confiando solo en que el
// panel esté oculto en el navegador.

async function recalcularRankingManual(req, res) {

  const auth = requerirAuth(req, res);
  if (!auth) return;

  const esAdmin = await sql`
    SELECT 1 FROM badges b
    WHERE b.user_id = ${auth.sub} AND b.badge_id = 'administrador'
    LIMIT 1;
  `;

  if (esAdmin.length === 0) {
    return res.status(403).json({ success: false, error: "Solo un administrador puede hacer esto" });
  }

  const resultado = await calcularYAplicarRanking();

  return res.status(200).json({ success: true, ...resultado });

}

// ==============================
// /api/system?action=community-stats
// ==============================
// Panel "Estadísticas de usuarios" de comunidad-ranking.html (pestaña
// General): registrados en total, conectados ahora, comentarios en
// la última hora y avatares de los últimos usuarios registrados hoy.
// Mismos criterios que ya usa adminStats() (conectado = last_login en
// los últimos 5 minutos), solo que acá es un endpoint público liviano
// (sin el resto de las métricas de admin).
// ==============================

async function communityStats(req, res) {

  const [
    registradosTotal,
    conectadosAhora,
    comentariosUltimaHora,
    recienLlegados
  ] = await Promise.all([

    sql`SELECT COUNT(*)::int AS n FROM users;`,
    sql`SELECT COUNT(*)::int AS n FROM users WHERE last_login > now() - interval '5 minutes';`,
    sql`SELECT COUNT(*)::int AS n FROM profile_comments WHERE created_at > now() - interval '1 hour';`,
    sql`SELECT username, avatar FROM users WHERE created_at > now() - interval '1 day' ORDER BY created_at DESC LIMIT 12;`

  ]);

  return res.status(200).json({
    success: true,
    registradosTotal: registradosTotal[0].n,
    conectadosAhora: conectadosAhora[0].n,
    comentariosPorHora: comentariosUltimaHora[0].n,
    recienLlegados
  });
}

// ==============================
// /api/system?action=moderators-status
// ==============================
// Pestaña "Moderación" del panel de comunidad-ranking.html: lista de
// administradores/moderadores/colaboradores (mismo criterio de rol
// que adminStats: badge_id en la tabla "badges") con si están
// conectados ahora o no.
// ==============================

async function moderatorsStatus(req, res) {

  const filas = await sql`
    SELECT u.username, u.avatar, u.last_login, b.badge_id AS rol
    FROM badges b
    JOIN users u ON u.id = b.user_id
    WHERE b.badge_id IN ('administrador','moderador','colaborador')
    ORDER BY
      CASE b.badge_id
        WHEN 'administrador' THEN 0
        WHEN 'moderador' THEN 1
        ELSE 2
      END,
      u.username ASC;
  `;

  const cincoMin = 5 * 60 * 1000;
  const staff = filas.map(f => ({
    username: f.username,
    avatar: f.avatar,
    rol: f.rol,
    conectado: !!(f.last_login && (Date.now() - new Date(f.last_login).getTime()) <= cincoMin)
  }));

  return res.status(200).json({ success: true, staff });
}

module.exports = async function handler(req, res) {

  setCors(res, "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const action = req.query.action;

  try {

    if (action === "test-db") return await testDb(req, res);
    if (action === "admin-stats") return await adminStats(req, res);
    if (action === "recalcular-ranking") return await recalcularRanking(req, res);
    if (action === "recalcular-ranking-manual") return await recalcularRankingManual(req, res);
    if (action === "community-stats") return await communityStats(req, res);
    if (action === "moderators-status") return await moderatorsStatus(req, res);

    return res.status(400).json({ success: false, error: "Acción inválida" });

  } catch (error) {
    console.error("/api/system:", error);
    return res.status(500).json({ success: false, error: "Error interno del servidor" });
  }
};

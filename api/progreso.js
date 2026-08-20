const { setCors } = require("./_utils");
const { obtenerSql } = require("./_db");
const { requerirAuth } = require("./_auth");

const sql = obtenerSql();

function pad(n) { return String(n).padStart(2, "0"); }
function fechaLocalAR(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric", month: "2-digit", day: "2-digit"
  }).format(d);
}
function addDays(dateText, days) {
  const d = new Date(`${dateText}T12:00:00-03:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function semanaActual(d = new Date()) {
  const base = new Date(`${fechaLocalAR(d)}T12:00:00-03:00`);
  const weekday = base.getDay() || 7;
  base.setDate(base.getDate() - weekday + 1);
  return base.toISOString().slice(0, 10);
}

const MISIONES_DIARIAS = [
  { key: "daily_3_games", title: "Explorador diario", description: "Jugá 3 juegos distintos hoy.", metric: "games_today", target: 3, xp: 40, coins: 35 },
  { key: "daily_15_minutes", title: "Tiempo de juego", description: "Jugá al menos 15 minutos hoy.", metric: "minutes_today", target: 15, xp: 55, coins: 40 },
  { key: "daily_2_games", title: "Entrá en calor", description: "Jugá 2 juegos distintos hoy.", metric: "games_today", target: 2, xp: 30, coins: 25 },
  { key: "daily_30_minutes", title: "Sesión larga", description: "Acumulá 30 minutos de juego hoy.", metric: "minutes_today", target: 30, xp: 85, coins: 60 },
  { key: "daily_5_games", title: "Coleccionista", description: "Probá 5 juegos distintos hoy.", metric: "games_today", target: 5, xp: 70, coins: 55 },
  { key: "daily_20_minutes", title: "Veterano del día", description: "Jugá 20 minutos hoy.", metric: "minutes_today", target: 20, xp: 65, coins: 45 },
  { key: "daily_4_games", title: "Cambio de juego", description: "Jugá 4 juegos distintos hoy.", metric: "games_today", target: 4, xp: 50, coins: 40 }
];

const MISIONES_SEMANALES = [
  { key: "weekly_6_games", title: "Descubridor", description: "Jugá 6 juegos distintos esta semana.", metric: "games_week", target: 6, xp: 180, coins: 140 },
  { key: "weekly_90_minutes", title: "Jugador constante", description: "Jugá 90 minutos esta semana.", metric: "minutes_week", target: 90, xp: 250, coins: 180 },
  { key: "weekly_180_minutes", title: "Maratón Macro", description: "Jugá 180 minutos esta semana.", metric: "minutes_week", target: 180, xp: 400, coins: 300 },
  { key: "weekly_10_games", title: "Turista del catálogo", description: "Jugá 10 juegos distintos esta semana.", metric: "games_week", target: 10, xp: 320, coins: 240 }
];

// Debe coincidir con la fórmula usada por /api/users?action=xp.
function xpNecesaria(nivel) {
  const n = Math.max(1, Number(nivel) || 1);
  if (n === 1) return 50;
  if (n === 2) return 100;
  return 100 + ((n - 2) * 200);
}

function pickDaily(dateText) {
  const day = new Date(`${dateText}T12:00:00-03:00`).getDate();
  return MISIONES_DIARIAS[day % MISIONES_DIARIAS.length];
}
function pickWeekly(weekText) {
  const day = Number(weekText.slice(-2));
  return MISIONES_SEMANALES[day % MISIONES_SEMANALES.length];
}

async function asegurarDesafioGlobal() {
  const hoy = new Date();
  const inicio = new Date(`${semanaActual(hoy)}T00:00:00-03:00`);
  const fin = new Date(inicio);
  fin.setDate(fin.getDate() + 7);
  const key = `global_week_${semanaActual(hoy)}`;
  const existente = await sql`SELECT * FROM macro_global_challenges WHERE challenge_key = ${key} LIMIT 1;`;
  if (existente.length) return existente[0];

  const creado = await sql`
    INSERT INTO macro_global_challenges
      (challenge_key, target_value, reward_xp, reward_coins, starts_at, ends_at)
    VALUES
      (${key}, 10000, 500, 250,
       ${inicio.toISOString()}, ${fin.toISOString()})
    ON CONFLICT (challenge_key) DO NOTHING
    RETURNING *;
  `;
  if (creado.length) return creado[0];
  const relectura = await sql`SELECT * FROM macro_global_challenges WHERE challenge_key = ${key} LIMIT 1;`;
  return relectura[0];
}

async function obtenerMetricas(userId) {
  const hoy = fechaLocalAR();
  const semana = semanaActual();

  const [hoyJugados, semanaJugados, semanaTiempo, checkins, perfil] = await Promise.all([
    sql`
      SELECT COUNT(*)::int AS cantidad
      FROM game_history gh
      WHERE gh.user_id = ${userId}
        AND gh.played_at >= (${hoy}::date AT TIME ZONE 'America/Argentina/Buenos_Aires')
        AND gh.played_at <  ((${hoy}::date + 1) AT TIME ZONE 'America/Argentina/Buenos_Aires');
    `,
    sql`
      SELECT COUNT(*)::int AS cantidad
      FROM ranking_juegos_semanales
      WHERE user_id = ${userId} AND semana = ${semana}::date;
    `,
    sql`
      SELECT COALESCE(minutos_jugados,0)::int AS minutos
      FROM ranking_actividad_semanal
      WHERE user_id = ${userId} AND semana = ${semana}::date
      LIMIT 1;
    `,
    sql`
      SELECT current_streak, best_streak, last_checkin_date
      FROM player_streaks WHERE user_id = ${userId} LIMIT 1;
    `,
    sql`
      SELECT username, level, xp, monedas, rank_actual, ranking_puntuacion
      FROM users WHERE id = ${userId} LIMIT 1;
    `
  ]);

  return {
    hoy,
    semana,
    games_today: hoyJugados[0]?.cantidad || 0,
    games_week: semanaJugados[0]?.cantidad || 0,
    minutes_week: semanaTiempo[0]?.minutos || 0,
    streak: checkins[0] || { current_streak: 0, best_streak: 0, last_checkin_date: null },
    user: perfil[0] || null
  };
}

async function estado(req, res, auth) {
  const metricas = await obtenerMetricas(auth.sub);
  const daily = pickDaily(metricas.hoy);
  const weekly = pickWeekly(metricas.semana);
  const global = await asegurarDesafioGlobal();

  const [claims, progresoGlobal] = await Promise.all([
    sql`
      SELECT mission_key, period_key
      FROM player_mission_claims
      WHERE user_id = ${auth.sub}
        AND period_key IN (${metricas.hoy}, ${metricas.semana});
    `,
    sql`
      SELECT COALESCE(SUM(r.minutos_jugados),0)::int AS valor
      FROM ranking_actividad_semanal r
      WHERE r.semana = ${metricas.semana}::date;
    `
  ]);

  const claimed = new Set(claims.map(c => `${c.mission_key}:${c.period_key}`));
  const mapMission = (mission, periodKey) => {
    const value = Number(metricas[mission.metric] || 0);
    const completed = value >= mission.target;
    return {
      ...mission,
      periodKey,
      value: Math.min(value, mission.target),
      completed,
      claimed: claimed.has(`${mission.key}:${periodKey}`)
    };
  };

  return res.status(200).json({
    success: true,
    today: { date: metricas.hoy, mission: mapMission(daily, metricas.hoy) },
    week: { start: metricas.semana, mission: mapMission(weekly, metricas.semana) },
    streak: metricas.streak,
    global: {
      key: global.challenge_key,
      value: progresoGlobal[0]?.valor || 0,
      target: Number(global.target_value),
      rewardXp: Number(global.reward_xp),
      rewardCoins: Number(global.reward_coins),
      endsAt: global.ends_at
    },
    user: metricas.user
  });
}

async function checkin(req, res, auth) {
  const hoy = fechaLocalAR();
  const fila = await sql`SELECT current_streak, best_streak, last_checkin_date FROM player_streaks WHERE user_id = ${auth.sub} LIMIT 1;`;
  const actual = fila[0] || { current_streak: 0, best_streak: 0, last_checkin_date: null };

  if (actual.last_checkin_date && String(actual.last_checkin_date).slice(0, 10) === hoy) {
    return res.status(200).json({ success: true, alreadyChecked: true, streak: actual });
  }

  const ayer = addDays(hoy, -1);
  const siguiente = String(actual.last_checkin_date || "").slice(0, 10) === ayer
    ? Number(actual.current_streak || 0) + 1
    : 1;
  const mejor = Math.max(Number(actual.best_streak || 0), siguiente);

  const guardado = await sql`
    INSERT INTO player_streaks (user_id, current_streak, best_streak, last_checkin_date, updated_at)
    VALUES (${auth.sub}, ${siguiente}, ${mejor}, ${hoy}::date, now())
    ON CONFLICT (user_id) DO UPDATE SET
      current_streak = EXCLUDED.current_streak,
      best_streak = EXCLUDED.best_streak,
      last_checkin_date = EXCLUDED.last_checkin_date,
      updated_at = now()
    RETURNING current_streak, best_streak, last_checkin_date;
  `;

  return res.status(200).json({ success: true, alreadyChecked: false, streak: guardado[0] });
}

async function reclamar(req, res, auth) {
  const body = req.body || {};
  const missionKey = String(body.missionKey || "");
  const periodKey = String(body.periodKey || "");
  const tipo = body.tipo === "weekly" ? "weekly" : "daily";
  const hoy = fechaLocalAR();
  const semana = semanaActual();
  const mission = tipo === "weekly" ? pickWeekly(semana) : pickDaily(hoy);
  const esperado = tipo === "weekly" ? semana : hoy;

  if (!missionKey || missionKey !== mission.key || periodKey !== esperado) {
    return res.status(400).json({ success: false, error: "Misión no válida para este período" });
  }

  const metricas = await obtenerMetricas(auth.sub);
  const value = Number(metricas[mission.metric] || 0);
  if (value < mission.target) {
    return res.status(400).json({ success: false, error: "Todavía no completaste la misión" });
  }

  const usuarioActual = await sql`
    SELECT id, username, level, xp, monedas, rank_actual, ranking_puntuacion
    FROM users
    WHERE id = ${auth.sub}
    LIMIT 1;
  `;

  if (!usuarioActual.length) {
    return res.status(404).json({ success: false, error: "Usuario no encontrado" });
  }

  const creada = await sql`
    INSERT INTO player_mission_claims (user_id, mission_key, period_key, reward_xp, reward_coins)
    VALUES (${auth.sub}, ${mission.key}, ${esperado}, ${mission.xp}, ${mission.coins})
    ON CONFLICT (user_id, mission_key, period_key) DO NOTHING
    RETURNING id;
  `;

  if (!creada.length) {
    return res.status(200).json({ success: true, alreadyClaimed: true });
  }

  // Aplicamos XP + monedas en la misma actualización lógica.
  // El cálculo de nivel sigue la misma idea que /api/users?action=xp,
  // pero en bucle: las recompensas de misión (hasta 400 XP de una
  // sola vez) pueden superar de sobra el umbral de más de un nivel,
  // algo que no pasa con el pulso normal (siempre +10). Si se subiera
  // un solo nivel y se descartara el resto como hacía el pulso normal,
  // el sobrante de XP se perdería en vez de acreditarse. Acá se sube
  // de a un nivel por vez, restando el umbral en lugar de resetear a
  // 0, hasta que el XP que queda ya no alcance para el siguiente nivel.
  let level = Math.max(1, Number(usuarioActual[0].level) || 1);
  let xp = Math.max(0, Number(usuarioActual[0].xp) || 0) + Number(mission.xp);
  let subioNivel = false;

  while (xp >= xpNecesaria(level)) {
    xp -= xpNecesaria(level);
    level += 1;
    subioNivel = true;
  }

  const actualizado = await sql`
    UPDATE users
    SET level = ${level},
        xp = ${xp},
        monedas = COALESCE(monedas, 0) + ${mission.coins}
    WHERE id = ${auth.sub}
    RETURNING username, level, xp, monedas, rank_actual, ranking_puntuacion;
  `;

  return res.status(200).json({
    success: true,
    alreadyClaimed: false,
    reward: { xp: mission.xp, coins: mission.coins },
    subioNivel,
    user: actualizado[0] || null
  });
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    const auth = requerirAuth(req, res);
    if (!auth) return;
    const action = String(req.query.action || "status");
    if (req.method === "GET" && action === "status") return await estado(req, res, auth);
    if (req.method === "POST" && action === "checkin") return await checkin(req, res, auth);
    if (req.method === "POST" && action === "claim") return await reclamar(req, res, auth);
    return res.status(400).json({ success: false, error: "Acción no válida" });
  } catch (error) {
    console.error("/api/progreso", error);
    return res.status(500).json({ success: false, error: "No se pudo cargar el progreso" });
  }
};

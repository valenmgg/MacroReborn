const { setCors } = require("./_utils");
const { getPusher, canalNotificaciones } = require("./_pusher");
const { obtenerSql } = require("./_db");
const { PasswordService } = require("./_password");
const { requerirAuth } = require("./_auth");
const { MonedasService } = require("./_monedas");
const { crearNotificacionServidor } = require("./_notifications");

const sql = obtenerSql();
const passwordService = new PasswordService(sql);
const monedasService = new MonedasService(sql);

// ==============================
// /api/users
// ==============================
// Fusión de los antiguos endpoints /api/users, /api/perfil,
// /api/update-avatar, /api/update-bio, /api/heartbeat y /api/xp en un
// solo archivo, para bajar la cantidad de Serverless Functions en
// Vercel (plan Hobby: máx. 12). La lógica de cada sección es
// EXACTAMENTE la misma que tenían los archivos originales, solo
// cambia cómo se elige cuál correr.
//
// (/api/perfil quedó reemplazado hace tiempo por /api/users?username=X
// y ya no lo llamaba ningún archivo del frontend, así que no hace
// falta una acción aparte para él: su comportamiento ya está cubierto
// por la lectura de abajo.)
//
// Lecturas (GET), sin action -> se mantiene igual que el /api/users
// original para no romper nada de lo que ya lo usaba así:
//   GET /api/users            -> lista de usuarios (ranking/comunidad)
//   GET /api/users?q=texto    -> búsqueda por nombre (buscador)
//   GET /api/users?username=X -> un usuario puntual
//
// Escrituras (POST), con ?action= para elegir cuál correr:
//   POST /api/users?action=update-avatar { username, avatar }
//   POST /api/users?action=update-bio    { username, bio }
//   POST /api/users?action=heartbeat     { username }
//   POST /api/users?action=xp            { username, cantidad, gameId }
//   POST /api/users?action=suspend       { username, motivo }
//   POST /api/users?action=reactivate    { username }
//   POST /api/users?action=change-password { username, currentPassword, newPassword }
//
// (suspend/reactivate/change-password se agregaron en el cierre de la
// Fase 2: antes vivían en la clave localStorage "usuariosMacro", que
// dejó de llenarse cuando el registro/login pasaron a Neon, así que
// no tenían ningún efecto real.)
// ==============================

// XP necesaria por nivel (misma fórmula que js/motor/xp.js en el cliente).
function xpNecesaria(nivel) {
  if (nivel === 1) return 50;
  if (nivel === 2) return 100;
  return 100 + ((nivel - 2) * 200);
}

// ==============================
// RANKING POR TIEMPO JUGADO
// ==============================
// El ranking (comunidad-ranking.html y demás lugares donde aparece)
// YA NO se calcula por nivel/XP: se calcula una vez por semana, todos
// los lunes a las 5:00 (hora Argentina), en api/system.js
// (recalcularRankingSemanal(), disparada por un cron de Vercel — ver
// vercel.json). Ese cálculo usa lo que se va guardando acá abajo.
//
// Mientras el usuario está jugando (jugar.html tiene abierto
// js/motor/xp.js), cada 60 segundos ya se llamaba a
// POST /api/users?action=xp para sumar XP. Ahora ese mismo pulso de
// 1 vez por minuto, si viaja con "gameId", también cuenta como
// "1 minuto jugado a ese juego" para el ranking semanal. No hace
// falta ningún pedido nuevo al servidor: se reusa el que ya existía.
//
// registrarTickTiempoJugado() actualiza dos tablas (ver migración
// 011_ranking_tiempo_jugado.sql):
//   - ranking_actividad_semanal: minutos totales y días distintos
//     jugados esta semana (semana calculada en horario de Argentina).
//   - ranking_juegos_semanales: minutos jugados esta semana, por
//     cada juego (para medir diversidad: si siempre son los mismos
//     juegos, el ranking semanal lo penaliza — ver api/system.js).
//
// Si falla (por lo que sea), no debe romper el XP en sí: se llama
// siempre dentro de un try/catch, igual que ya se hacía con el aviso
// de Pusher en heartbeat().
async function registrarTickTiempoJugado(userId, gameId) {

  if (!gameId) return; // sin juego asociado (no debería pasar, pero por las dudas)

  const idJuego = String(gameId);

  await sql`
    INSERT INTO ranking_actividad_semanal (user_id, semana, minutos_jugados, dias_activos, ultimo_dia_registrado)
    VALUES (
      ${userId},
      date_trunc('week', (now() AT TIME ZONE 'America/Argentina/Buenos_Aires'))::date,
      1,
      1,
      (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
    )
    ON CONFLICT (user_id, semana) DO UPDATE SET
      minutos_jugados = ranking_actividad_semanal.minutos_jugados + 1,
      dias_activos = ranking_actividad_semanal.dias_activos + CASE
        WHEN ranking_actividad_semanal.ultimo_dia_registrado IS DISTINCT FROM (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
        THEN 1 ELSE 0
      END,
      ultimo_dia_registrado = (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  `;

  await sql`
    INSERT INTO ranking_juegos_semanales (user_id, semana, game_id, minutos)
    VALUES (
      ${userId},
      date_trunc('week', (now() AT TIME ZONE 'America/Argentina/Buenos_Aires'))::date,
      ${idJuego},
      1
    )
    ON CONFLICT (user_id, semana, game_id) DO UPDATE SET
      minutos = ranking_juegos_semanales.minutos + 1;
  `;

}

// ==============================
// MONEDAS POR TIEMPO JUGADO
// ==============================
// El mismo pulso de 1 vez por minuto que suma XP y cuenta minutos para
// el ranking también es el reloj con el que se GANAN monedas. Toda la
// regla (cada 10 minutos, premio aleatorio de 10 a 30, tope de 500 por
// día UTC con reseteo perezoso) vive en api/_monedas.js: acá solo se lo
// llama y se agrega el resultado a la respuesta.
//
// No hay endpoint nuevo a propósito: Vercel (plan Hobby) permite 12
// Serverless Functions y ya están todas usadas, así que se reusa el
// pedido que el cliente ya hacía.
//
// Respuesta defensiva si falla el servicio. Se manda igual, con la
// misma forma, para que el frontend nunca tenga que preguntarse si el
// campo "monedas" existe: alcanza con mirar "otorgado".
const MONEDAS_SIN_OTORGAR = {
  otorgado: false,
  monto: 0,
  saldoNuevo: null,
  razon: "error-al-otorgar"
};

async function listarUsuarios(req, res) {
  const { q, username, limit } = req.query;
  // Tope subido de 500 a 2000: el panel de administración
  // (js/motor/permisos.js -> obtenerUsuarios()) pide la lista
  // completa de usuarios con limit=2000 para poder listarlos a todos,
  // no solo los primeros 500.
  const tope = Math.min(Number(limit) || 300, 2000);

  // Minutos/días jugados en la semana QUE ESTÁ EN CURSO ahora mismo
  // (no la última puntuada). Es solo informativo para el front
  // ("llevás X min esta semana"): la posición del ranking
  // (rank_actual) no se mueve con esto, se recalcula recién el lunes.
  const semanaActualSQL = sql`date_trunc('week', (now() AT TIME ZONE 'America/Argentina/Buenos_Aires'))::date`;

  if (username) {
    const usuario = await sql`
      SELECT u.id, u.username, u.level, u.xp, u.monedas, u.status, u.bio, u.avatar, u.created_at, u.last_login,
             u.suspendido, u.fecha_suspension, u.motivo_suspension,
             u.rank_actual, u.rank_anterior, u.ranking_puntuacion,
             COALESCE(ras.minutos_jugados, 0) AS minutos_semana_actual,
             COALESCE(ras.dias_activos, 0) AS dias_activos_semana_actual
      FROM users u
      LEFT JOIN ranking_actividad_semanal ras
        ON ras.user_id = u.id AND ras.semana = ${semanaActualSQL}
      WHERE u.username = ${username};
    `;

    if (usuario.length === 0) {
      return res.status(404).json({ success: false, error: "Usuario no encontrado" });
    }

    return res.status(200).json({ success: true, user: usuario[0] });
  }

  let usuarios;

  if (q && String(q).trim() !== "") {
    const buscado = "%" + String(q).trim() + "%";
    usuarios = await sql`
      SELECT u.id, u.username, u.level, u.xp, u.status, u.bio, u.avatar, u.created_at, u.last_login,
             u.suspendido, u.fecha_suspension, u.motivo_suspension,
             u.rank_actual, u.rank_anterior, u.ranking_puntuacion,
             COALESCE(ras.minutos_jugados, 0) AS minutos_semana_actual,
             COALESCE(ras.dias_activos, 0) AS dias_activos_semana_actual
      FROM users u
      LEFT JOIN ranking_actividad_semanal ras
        ON ras.user_id = u.id AND ras.semana = ${semanaActualSQL}
      WHERE u.username ILIKE ${buscado}
      ORDER BY u.username ASC
      LIMIT ${tope};
    `;
  } else {

    // Orden del ranking/comunidad: por posición ya calculada
    // (rank_actual, la de la última corrida semanal del cron), no por
    // nivel. Los usuarios que todavía no tienen posición calculada
    // (recién registrados, antes de que corra el cron del próximo
    // lunes) quedan al final, ordenados por nombre.
    usuarios = await sql`
      SELECT u.id, u.username, u.level, u.xp, u.status, u.bio, u.avatar, u.created_at, u.last_login,
             u.suspendido, u.fecha_suspension, u.motivo_suspension,
             u.rank_actual, u.rank_anterior, u.ranking_puntuacion,
             COALESCE(ras.minutos_jugados, 0) AS minutos_semana_actual,
             COALESCE(ras.dias_activos, 0) AS dias_activos_semana_actual
      FROM users u
      LEFT JOIN ranking_actividad_semanal ras
        ON ras.user_id = u.id AND ras.semana = ${semanaActualSQL}
      ORDER BY u.rank_actual ASC NULLS LAST, u.username ASC
      LIMIT ${tope};
    `;
  }

  return res.status(200).json({ success: true, users: usuarios });
}

async function updateAvatar(req, res) {
  const auth = requerirAuth(req, res);
  if (!auth) return;
  const { username, avatar } = req.body || {};
  if (String(auth.username).toLowerCase() !== String(username || '').toLowerCase()) {
    return res.status(403).json({ success: false, error: "No podés modificar otro usuario" });
  }

  // Los PNG personalizados son un privilegio exclusivo del administrador.
  // El editor normal sigue usando exactamente el formato de capas de siempre.
  if (avatar && typeof avatar === "object" && avatar.tipo === "png") {
    return res.status(403).json({ success: false, error: "El avatar PNG personalizado solo puede guardarse mediante el panel de administrador." });
  }

  const user = await sql`
    UPDATE users
    SET avatar = ${JSON.stringify(avatar)}
    WHERE username = ${username}
    RETURNING id, username, avatar;
  `;

  if (user.length === 0) {
    return res.status(404).json({ success: false, error: "Usuario no encontrado" });
  }

  return res.status(200).json({ success: true, user: user[0] });
}

async function updateAdminAvatarPng(req, res) {
  const auth = requerirAuth(req, res);
  if (!auth) return;

  const { username, avatarPng, avatarAnterior } = req.body || {};

  if (String(auth.username).toLowerCase() !== String(username || '').toLowerCase()) {
    return res.status(403).json({ success: false, error: "No podés modificar otro usuario" });
  }

  const admin = await sql`
    SELECT 1
    FROM badges
    WHERE user_id = ${auth.sub} AND badge_id = 'administrador'
    LIMIT 1;
  `;

  if (!admin.length) {
    return res.status(403).json({ success: false, error: "Solo un administrador puede usar avatares PNG personalizados" });
  }

  const texto = typeof avatarPng === "string" ? avatarPng : "";
  const match = texto.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);

  if (!match) {
    return res.status(400).json({ success: false, error: "El avatar debe ser un PNG válido" });
  }

  const base64 = match[1];
  const padding = (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
  const bytes = Math.floor(base64.length * 3 / 4) - padding;

  // Limite defensivo para no guardar blobs enormes dentro de users.avatar.
  if (bytes <= 0 || bytes > 1024 * 1024) {
    return res.status(400).json({ success: false, error: "El PNG no puede superar 1 MB" });
  }

  let binario;
  try {
    binario = Buffer.from(base64, "base64");
  } catch (_) {
    return res.status(400).json({ success: false, error: "El PNG está corrupto" });
  }

  const firmaPNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (binario.length < firmaPNG.length || !firmaPNG.every((byte, i) => binario[i] === byte)) {
    return res.status(400).json({ success: false, error: "El archivo no tiene una firma PNG válida" });
  }

  const avatar = {
    tipo: "png",
    src: texto,
    restaurar: (avatarAnterior && typeof avatarAnterior === "object" && avatarAnterior.tipo !== "png")
      ? avatarAnterior
      : null
  };

  const user = await sql`
    UPDATE users
    SET avatar = ${JSON.stringify(avatar)}
    WHERE username = ${username}
    RETURNING id, username, avatar;
  `;

  if (user.length === 0) {
    return res.status(404).json({ success: false, error: "Usuario no encontrado" });
  }

  return res.status(200).json({ success: true, user: user[0] });
}

async function updateBio(req, res) {
  const auth = requerirAuth(req, res);
  if (!auth) return;
  const { username, bio } = req.body;
  if (String(auth.username).toLowerCase() !== String(username || '').toLowerCase()) {
    return res.status(403).json({ success: false, error: "No podés modificar otro usuario" });
  }

  const user = await sql`
    UPDATE users
    SET bio = ${bio}
    WHERE username = ${username}
    RETURNING id, username, bio;
  `;

  if (user.length === 0) {
    return res.status(404).json({ success: false, error: "Usuario no encontrado" });
  }

  return res.status(200).json({ success: true, user: user[0] });
}

async function heartbeat(req, res) {
  const auth = requerirAuth(req, res);
  if (!auth) return;

  // La identidad válida viene del token firmado, no del body del navegador.
  // El frontend puede seguir enviando username por compatibilidad, pero no
  // se utiliza para decidir qué usuario actualizar.
  const actualizado = await sql`
    UPDATE users
    SET last_login = now()
    WHERE id = ${auth.sub}
    RETURNING username, last_login;
  `;

  if (actualizado.length === 0) {
    return res.status(404).json({ success: false, error: "Usuario no encontrado" });
  }

  // Push en tiempo real: quien tenga este perfil abierto (el suyo o
  // el de otra persona) ve "Última conexión" y el estado 🟢/⚪
  // actualizarse solos, sin recargar.
  try {
    await getPusher().trigger(
      canalNotificaciones(actualizado[0].username),
      "latido",
      { last_login: actualizado[0].last_login }
    );
  } catch (error) {
    console.warn("Pusher: no se pudo avisar el latido en vivo.", error);
  }

  return res.status(200).json({ success: true, last_login: actualizado[0].last_login });
}

async function sumarXp(req, res) {
  const auth = requerirAuth(req, res);
  if (!auth) return;
  const { username, cantidad, gameId } = req.body;
  if (String(auth.username).toLowerCase() !== String(username || '').toLowerCase()) {
    return res.status(403).json({ success: false, error: "Sesión no corresponde al usuario" });
  }
  const monto = Number(cantidad) || 0;

  if (!username || monto <= 0) {
    return res.status(200).json({ success: false, error: "Datos inválidos" });
  }

  const filas = await sql`SELECT id, level, xp FROM users WHERE username = ${username};`;

  if (filas.length === 0) {
    return res.status(404).json({ success: false, error: "Usuario no encontrado" });
  }

  let { id, level, xp } = filas[0];
  level = level || 1;
  xp = (xp || 0) + monto;

  let subioNivel = false;
  const necesario = xpNecesaria(level);

  if (xp >= necesario) {
    level += 1;
    xp = 0;
    subioNivel = true;
  }

  const actualizado = await sql`
    UPDATE users
    SET level = ${level}, xp = ${xp}
    WHERE id = ${id}
    RETURNING id, username, level, xp;
  `;

  // Ranking por tiempo jugado: cada pulso de XP mientras se está
  // jugando (1 por minuto) también cuenta como 1 minuto jugado para
  // el ranking semanal. No debe romper la respuesta de XP si falla.
  try {
    await registrarTickTiempoJugado(id, gameId);
  } catch (error) {
    console.warn("MacroReborn: no se pudo registrar el tiempo jugado para el ranking.", error);
  }

  // Monedas por tiempo jugado: el mismo pulso, además de XP y minutos,
  // puede otorgar monedas (cada 10 minutos, no cada minuto: la regla
  // completa está en api/_monedas.js).
  // Mismo criterio defensivo que el tick de arriba: si el banco falla
  // (columnas de la migración 015 sin aplicar todavía, base caída),
  // se loguea y el usuario igual recibe su XP. Perder un otorgamiento
  // de monedas es un problema chico; perder el XP del minuto sería
  // visible en pantalla.
  let monedas = MONEDAS_SIN_OTORGAR;

  try {
    monedas = await monedasService.otorgarPorTiempoJugado(id);
  } catch (error) {
    console.warn("MacroReborn: no se pudieron otorgar las monedas por tiempo jugado.", error);
  }

  if (subioNivel) {
    await crearNotificacionServidor(
      username,
      "⭐ Nuevo nivel",
      `Subiste al nivel ${level}.`
    );
  }

  return res.status(200).json({
    success: true,
    user: actualizado[0],
    subioNivel,
    monedas
  });
}

async function suspend(req, res) {
  const auth = requerirAuth(req, res);
  if (!auth) return;
  const { username, motivo } = req.body || {};

  if (!username) {
    return res.status(400).json({ success: false, error: "Falta username" });
  }

  const admin = await sql`
    SELECT 1 FROM badges WHERE user_id = ${auth.sub} AND badge_id = 'administrador' LIMIT 1;
  `;
  if (!admin.length) return res.status(403).json({ success: false, error: "Solo un administrador puede suspender usuarios" });

  const usuario = await sql`
    UPDATE users
    SET suspendido = true, fecha_suspension = now(),
        motivo_suspension = ${(motivo && String(motivo).trim()) ? String(motivo).trim() : "No especificado"}
    WHERE username = ${username}
    RETURNING id, username, suspendido, fecha_suspension, motivo_suspension;
  `;

  if (usuario.length === 0) {
    return res.status(404).json({ success: false, error: "Usuario no encontrado" });
  }

  return res.status(200).json({ success: true, user: usuario[0] });
}

async function reactivate(req, res) {
  const auth = requerirAuth(req, res);
  if (!auth) return;
  const { username } = req.body || {};

  if (!username) {
    return res.status(400).json({ success: false, error: "Falta username" });
  }

  const admin = await sql`
    SELECT 1 FROM badges WHERE user_id = ${auth.sub} AND badge_id = 'administrador' LIMIT 1;
  `;
  if (!admin.length) return res.status(403).json({ success: false, error: "Solo un administrador puede reactivar usuarios" });

  const usuario = await sql`
    UPDATE users
    SET suspendido = false, fecha_suspension = NULL, motivo_suspension = NULL
    WHERE username = ${username}
    RETURNING id, username, suspendido;
  `;

  if (usuario.length === 0) {
    return res.status(404).json({ success: false, error: "Usuario no encontrado" });
  }

  return res.status(200).json({ success: true, user: usuario[0] });
}

async function changePassword(req, res) {
  const auth = requerirAuth(req, res);
  if (!auth) return;
  const { username, currentPassword, newPassword } = req.body || {};
  if (String(auth.username).toLowerCase() !== String(username || '').toLowerCase()) {
    return res.status(403).json({ success: false, error: "Sesión no corresponde al usuario" });
  }

  if (!username || !currentPassword || !newPassword) {
    return res.status(400).json({ success: false, error: "Faltan datos" });
  }

  if (String(newPassword).length < 6) {
    return res.status(200).json({ success: false, error: "La nueva contraseña debe tener al menos 6 caracteres" });
  }

  // Verifica la contraseña actual (migrando al hash si el usuario
  // todavía tenía texto plano) y guarda SOLO el hash de la nueva.
  const resultado = await passwordService.cambiarContrasena(username, currentPassword, newPassword);

  if (!resultado.ok) {
    return res.status(200).json({ success: false, error: resultado.error });
  }

  return res.status(200).json({ success: true });
}

module.exports = async function handler(req, res) {

  setCors(res, "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const action = req.query.action;

  try {

    if (req.method === "GET") {
      return await listarUsuarios(req, res);
    }

    if (req.method === "POST") {
      if (action === "update-avatar") return await updateAvatar(req, res);
      if (action === "update-admin-avatar-png") return await updateAdminAvatarPng(req, res);
      if (action === "update-bio") return await updateBio(req, res);
      if (action === "heartbeat") return await heartbeat(req, res);
      if (action === "xp") return await sumarXp(req, res);
      if (action === "suspend") return await suspend(req, res);
      if (action === "reactivate") return await reactivate(req, res);
      if (action === "change-password") return await changePassword(req, res);

      return res.status(400).json({ success: false, error: "Acción inválida" });
    }

    return res.status(405).json({ success: false, error: "Método no permitido" });

  } catch (error) {
    console.error("/api/users:", error);
    return res.status(500).json({ success: false, error: "Error interno del servidor" });
  }
};

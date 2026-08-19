const { neon } = require("@neondatabase/serverless");
const { setCors, hayBloqueoEntreUsuarios, usuarioBloqueaA } = require("./_utils");
const { getPusher, canalNotificaciones } = require("./_pusher");
const { requerirAuth } = require("./_auth");
const { crearNotificacionServidor } = require("./_notifications");

const sql = neon(process.env.DATABASE_URL);

// ==============================
// /api/social?action=friends|favoriteFriends|achievements|badges
// ==============================
// Fusión de los antiguos endpoints /api/friends, /api/achievements y
// /api/badges en un solo archivo, para bajar la cantidad de
// Serverless Functions en Vercel (plan Hobby: máx. 12). La lógica de
// cada sección es EXACTAMENTE la misma que tenían los archivos
// originales, solo cambia cómo se elige cuál correr.
//
// NOTA: dentro de "friends", el body también tiene su propio campo
// "action" (request/accept/reject/cancel/remove) igual que antes.
// Ese es un campo de negocio de amigos y no tiene relación con el
// ?action=friends de la URL que elige la sección.
//
// GET  /api/social?action=friends&username=X
// POST /api/social?action=friends  { action:"request"|"accept"|"reject"|"cancel"|"remove", ... }
//
// GET  /api/social?action=favoriteFriends&username=X
// POST /api/social?action=favoriteFriends { action:"add"|"remove", username, friendUsername }
//   Máximo 10 favoritos por usuario (validado acá, no en la base) y
//   solo se puede marcar como favorito a alguien que ya es amigo.
//
// GET  /api/social?action=achievements&username=X
// GET  /api/social?action=achievements&usernames=a,b,c
// POST /api/social?action=achievements { username, achievementId }
//
// GET    /api/social?action=badges&username=X
// GET    /api/social?action=badges&usernames=a,b,c
// POST   /api/social?action=badges { username, badgeId, assignedBy }
// DELETE /api/social?action=badges { username, badgeId }
// ==============================

const MAX_AMIGOS_FAVORITOS = 10;

async function getUserId(username) {
  if (!username) return null;
  const filas = await sql`SELECT id FROM users WHERE username = ${username};`;
  return filas.length ? filas[0].id : null;
}

async function aceptarSolicitud(requestId, fromId, toId) {
  await sql`UPDATE friend_requests SET status = 'aceptada', responded_at = now() WHERE id = ${requestId};`;
  await sql`
    INSERT INTO friendships (user_id, friend_id) VALUES (${fromId}, ${toId})
    ON CONFLICT (user_id, friend_id) DO NOTHING;
  `;
  await sql`
    INSERT INTO friendships (user_id, friend_id) VALUES (${toId}, ${fromId})
    ON CONFLICT (user_id, friend_id) DO NOTHING;
  `;
}

// ============== FRIENDS ==============

async function friends(req, res) {

  if (req.method === "GET") {

    const { username } = req.query;
    if (!username) {
      return res.status(400).json({ success: false, error: "Falta username" });
    }

    const userId = await getUserId(username);
    if (!userId) {
      return res.status(404).json({ success: false, error: "Usuario no encontrado" });
    }

    const amigos = await sql`
      SELECT u.username, u.level, u.xp, u.avatar
      FROM friendships f
      JOIN users u ON u.id = f.friend_id
      WHERE f.user_id = ${userId}
      ORDER BY u.username ASC;
    `;

    const solicitudesEntrantes = await sql`
      SELECT fr.id, u.username AS de, fr.created_at
      FROM friend_requests fr
      JOIN users u ON u.id = fr.from_user_id
      WHERE fr.to_user_id = ${userId} AND fr.status = 'pendiente'
      ORDER BY fr.created_at DESC;
    `;

    const solicitudesSalientes = await sql`
      SELECT fr.id, u.username AS para, fr.created_at
      FROM friend_requests fr
      JOIN users u ON u.id = fr.to_user_id
      WHERE fr.from_user_id = ${userId} AND fr.status = 'pendiente'
      ORDER BY fr.created_at DESC;
    `;

    return res.status(200).json({
      success: true,
      amigos,
      solicitudesEntrantes,
      solicitudesSalientes
    });
  }

  if (req.method === "POST") {

    const { action } = req.body || {};

    if (action === "request") {
      const { from, to } = req.body;
      if (String(req.auth.username).toLowerCase() !== String(from || '').toLowerCase()) return res.status(403).json({ success:false,error:"Sesión no corresponde al remitente" });
      const fromId = await getUserId(from);
      const toId = await getUserId(to);

      if (!fromId || !toId) {
        return res.status(404).json({ success: false, error: "Usuario no encontrado" });
      }
      if (fromId === toId) {
        return res.status(200).json({ success: false, error: "No podés agregarte a vos mismo" });
      }

      const yaAmigos = await sql`
        SELECT 1 FROM friendships WHERE user_id = ${fromId} AND friend_id = ${toId};
      `;
      if (yaAmigos.length) {
        return res.status(200).json({ success: false, error: "Ya son amigos" });
      }

      const inversa = await sql`
        SELECT id FROM friend_requests
        WHERE from_user_id = ${toId} AND to_user_id = ${fromId} AND status = 'pendiente';
      `;

      if (inversa.length) {
        await aceptarSolicitud(inversa[0].id, toId, fromId);
        await crearNotificacionServidor(
          to,
          "🤝 Nueva amistad",
          `${from} aceptó tu solicitud de amistad.`,
          from
        );
        return res.status(200).json({ success: true, aceptadaAutomaticamente: true });
      }

      await sql`
        INSERT INTO friend_requests (from_user_id, to_user_id, status)
        VALUES (${fromId}, ${toId}, 'pendiente')
        ON CONFLICT (from_user_id, to_user_id) WHERE status = 'pendiente' DO NOTHING;
      `;

      await crearNotificacionServidor(
        to,
        "📩 Nueva solicitud de amistad",
        `${from} te envió una solicitud de amistad.`,
        from
      );

      return res.status(200).json({ success: true });
    }

    if (action === "accept" || action === "reject") {
      const { requestId } = req.body;

      const filas = await sql`
        SELECT * FROM friend_requests WHERE id = ${requestId} AND status = 'pendiente';
      `;

      if (!filas.length) {
        return res.status(404).json({ success: false, error: "Solicitud no encontrada" });
      }

      const solicitud = filas[0];
      if (Number(req.auth.sub) !== Number(solicitud.to_user_id)) return res.status(403).json({ success:false,error:"No podés responder esa solicitud" });

      if (action === "reject") {
        await sql`UPDATE friend_requests SET status = 'rechazada', responded_at = now() WHERE id = ${requestId};`;
        return res.status(200).json({ success: true });
      }

      await aceptarSolicitud(requestId, solicitud.from_user_id, solicitud.to_user_id);
      const nombres = await sql`SELECT id, username FROM users WHERE id IN (${solicitud.from_user_id}, ${solicitud.to_user_id});`;
      const nombreDe = nombres.find(u => Number(u.id) === Number(solicitud.from_user_id))?.username || "Alguien";
      const nombrePara = nombres.find(u => Number(u.id) === Number(solicitud.to_user_id))?.username || req.auth.username;
      await crearNotificacionServidor(
        nombreDe,
        "🤝 Nueva amistad",
        `${nombrePara} aceptó tu solicitud de amistad.`,
        nombrePara
      );
      return res.status(200).json({ success: true });
    }

    if (action === "cancel") {
      const { requestId } = req.body;
      await sql`
        UPDATE friend_requests SET status = 'cancelada', responded_at = now()
        WHERE id = ${requestId} AND status = 'pendiente' AND from_user_id = ${req.auth.sub};
      `;
      return res.status(200).json({ success: true });
    }

    if (action === "remove") {
      const { username, friendUsername } = req.body;
      if (String(req.auth.username).toLowerCase() !== String(username || '').toLowerCase()) return res.status(403).json({success:false,error:"Sesión no corresponde al usuario"});
      const userId = await getUserId(username);
      const friendId = await getUserId(friendUsername);

      if (!userId || !friendId) {
        return res.status(404).json({ success: false, error: "Usuario no encontrado" });
      }

      await sql`DELETE FROM friendships WHERE user_id = ${userId} AND friend_id = ${friendId};`;
      await sql`DELETE FROM friendships WHERE user_id = ${friendId} AND friend_id = ${userId};`;

      // Si alguno de los dos lo tenía marcado como "Amigo favorito",
      // esa marca deja de tener sentido (ya no son amigos): se limpia
      // en ambos sentidos para que no quede un favorito "fantasma"
      // ocupando uno de los 10 lugares.
      await sql`DELETE FROM friend_favorites WHERE user_id = ${userId} AND friend_id = ${friendId};`;
      await sql`DELETE FROM friend_favorites WHERE user_id = ${friendId} AND friend_id = ${userId};`;

      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ success: false, error: "Acción inválida" });
  }

  return res.status(405).json({ success: false, error: "Método no permitido" });
}

// ============== AMIGOS FAVORITOS ==============

async function favoriteFriends(req, res) {

  if (req.method === "GET") {

    const { username } = req.query;
    if (!username) {
      return res.status(400).json({ success: false, error: "Falta username" });
    }

    const userId = await getUserId(username);
    if (!userId) {
      return res.status(404).json({ success: false, error: "Usuario no encontrado" });
    }

    const filas = await sql`
      SELECT u.username, ff.created_at
      FROM friend_favorites ff
      JOIN users u ON u.id = ff.friend_id
      WHERE ff.user_id = ${userId}
      ORDER BY ff.created_at ASC;
    `;

    return res.status(200).json({
      success: true,
      favoritos: filas.map(f => f.username)
    });
  }

  if (req.method === "POST") {

    const { action, username, friendUsername } = req.body || {};
    if (String(req.auth.username).toLowerCase() !== String(username || '').toLowerCase()) return res.status(403).json({success:false,error:"Sesión no corresponde al usuario"});

    if (!username || !friendUsername) {
      return res.status(400).json({ success: false, error: "Datos incompletos" });
    }

    const userId = await getUserId(username);
    const friendId = await getUserId(friendUsername);

    if (!userId || !friendId) {
      return res.status(404).json({ success: false, error: "Usuario no encontrado" });
    }

    if (action === "add") {

      const esAmigo = await sql`
        SELECT 1 FROM friendships WHERE user_id = ${userId} AND friend_id = ${friendId};
      `;
      if (!esAmigo.length) {
        return res.status(200).json({ success: false, error: "Solo podés marcar como favorito a alguien que ya es tu amigo" });
      }

      const yaFavorito = await sql`
        SELECT 1 FROM friend_favorites WHERE user_id = ${userId} AND friend_id = ${friendId};
      `;
      if (yaFavorito.length) {
        return res.status(200).json({ success: true, yaExistia: true });
      }

      const cantidadActual = await sql`
        SELECT COUNT(*)::int AS total FROM friend_favorites WHERE user_id = ${userId};
      `;
      if (cantidadActual[0].total >= MAX_AMIGOS_FAVORITOS) {
        return res.status(200).json({ success: false, error: `Ya tenés el máximo de ${MAX_AMIGOS_FAVORITOS} amigos favoritos` });
      }

      await sql`
        INSERT INTO friend_favorites (user_id, friend_id) VALUES (${userId}, ${friendId})
        ON CONFLICT (user_id, friend_id) DO NOTHING;
      `;

      return res.status(200).json({ success: true });
    }

    if (action === "remove") {
      await sql`DELETE FROM friend_favorites WHERE user_id = ${userId} AND friend_id = ${friendId};`;
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ success: false, error: "Acción inválida" });
  }

  return res.status(405).json({ success: false, error: "Método no permitido" });
}

// ============== ACHIEVEMENTS ==============

async function achievements(req, res) {

  if (req.method === "GET") {
    const { username, usernames } = req.query;

    if (usernames) {
      const lista = String(usernames).split(",").map(n => n.trim()).filter(Boolean);
      if (!lista.length) {
        return res.status(200).json({ success: true, porUsuario: {} });
      }

      const filas = await sql`
        SELECT u.username, a.achievement_id, a.unlocked_at
        FROM achievements a
        JOIN users u ON u.id = a.user_id
        WHERE u.username = ANY(${lista});
      `;

      const porUsuario = {};
      lista.forEach(n => { porUsuario[n] = []; });
      filas.forEach(f => {
        if (!porUsuario[f.username]) porUsuario[f.username] = [];
        porUsuario[f.username].push({ achievement_id: f.achievement_id, unlocked_at: f.unlocked_at });
      });

      return res.status(200).json({ success: true, porUsuario });
    }

    if (!username) {
      return res.status(400).json({ success: false, error: "Falta username" });
    }

    const filas = await sql`
      SELECT a.achievement_id, a.unlocked_at
      FROM achievements a
      JOIN users u ON u.id = a.user_id
      WHERE u.username = ${username}
      ORDER BY a.unlocked_at ASC;
    `;

    return res.status(200).json({ success: true, logros: filas });
  }

  if (req.method === "POST") {
    const { username, achievementId } = req.body;
    if (String(req.auth.username).toLowerCase() !== String(username || '').toLowerCase()) return res.status(403).json({success:false,error:"Sesión no corresponde al usuario"});

    if (!username || !achievementId) {
      return res.status(400).json({ success: false, error: "Datos incompletos" });
    }

    const usuarios = await sql`SELECT id FROM users WHERE username = ${username};`;
    if (!usuarios.length) {
      return res.status(404).json({ success: false, error: "Usuario no encontrado" });
    }

    const yaExiste = await sql`
      SELECT 1 FROM achievements WHERE user_id = ${usuarios[0].id} AND achievement_id = ${achievementId};
    `;

    if (yaExiste.length) {
      return res.status(200).json({ success: true, nuevo: false });
    }

    await sql`
      INSERT INTO achievements (user_id, achievement_id)
      VALUES (${usuarios[0].id}, ${achievementId})
      ON CONFLICT (user_id, achievement_id) DO NOTHING;
    `;

    await crearNotificacionServidor(
      username,
      "🏅 Nuevo logro desbloqueado",
      `Conseguiste: ${achievementId}`
    );

    // Push en tiempo real: refresca la pestaña "Logros" sin recargar.
    try {
      await getPusher().trigger(
        canalNotificaciones(username),
        "nuevo-logro",
        { achievementId }
      );
    } catch (error) {
      console.warn("Pusher: no se pudo avisar el nuevo logro en vivo.", error);
    }

    return res.status(200).json({ success: true, nuevo: true });
  }

  return res.status(405).json({ success: false, error: "Método no permitido" });
}

// ============== BADGES ==============

async function badges(req, res) {

  if (req.method === "GET") {
    const { username, usernames } = req.query;

    if (usernames) {
      const lista = String(usernames).split(",").map(n => n.trim()).filter(Boolean);
      if (!lista.length) {
        return res.status(200).json({ success: true, porUsuario: {} });
      }

      const filas = await sql`
        SELECT u.username, b.badge_id
        FROM badges b
        JOIN users u ON u.id = b.user_id
        WHERE u.username = ANY(${lista});
      `;

      const porUsuario = {};
      lista.forEach(n => { porUsuario[n] = []; });
      filas.forEach(f => {
        if (!porUsuario[f.username]) porUsuario[f.username] = [];
        porUsuario[f.username].push(f.badge_id);
      });

      return res.status(200).json({ success: true, porUsuario });
    }

    if (!username) {
      return res.status(400).json({ success: false, error: "Falta username" });
    }

    const filas = await sql`
      SELECT b.badge_id, b.assigned_at
      FROM badges b
      JOIN users u ON u.id = b.user_id
      WHERE u.username = ${username};
    `;

    return res.status(200).json({
      success: true,
      insignias: filas.map(f => f.badge_id),
      detalle: filas
    });
  }

  if (req.method === "POST") {
    const { username, badgeId, assignedBy } = req.body;
    const admin = await sql`SELECT 1 FROM badges WHERE user_id = ${req.auth.sub} AND badge_id = 'administrador' LIMIT 1;`;
    if (!admin.length) return res.status(403).json({ success:false,error:"Solo un administrador puede asignar insignias" });

    if (!username || !badgeId) {
      return res.status(400).json({ success: false, error: "Datos incompletos" });
    }

    const usuarios = await sql`SELECT id FROM users WHERE username = ${username};`;
    if (!usuarios.length) {
      return res.status(404).json({ success: false, error: "Usuario no encontrado" });
    }

    const assignedById = Number(req.auth.sub);

    await sql`
      INSERT INTO badges (user_id, badge_id, assigned_by)
      VALUES (${usuarios[0].id}, ${badgeId}, ${assignedById})
      ON CONFLICT (user_id, badge_id) DO NOTHING;
    `;

    return res.status(200).json({ success: true });
  }

  if (req.method === "DELETE") {
    const { username, badgeId } = req.body || {};
    const admin = await sql`SELECT 1 FROM badges WHERE user_id = ${req.auth.sub} AND badge_id = 'administrador' LIMIT 1;`;
    if (!admin.length) return res.status(403).json({ success:false,error:"Solo un administrador puede quitar insignias" });

    if (!username || !badgeId) {
      return res.status(400).json({ success: false, error: "Datos incompletos" });
    }

    const usuarios = await sql`SELECT id FROM users WHERE username = ${username};`;
    if (!usuarios.length) {
      return res.status(404).json({ success: false, error: "Usuario no encontrado" });
    }

    await sql`DELETE FROM badges WHERE user_id = ${usuarios[0].id} AND badge_id = ${badgeId};`;

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ success: false, error: "Método no permitido" });
}

// ============== BLOQUEOS DE USUARIO ==============
// GET  /api/social?action=blocks&username=X
//   -> { success, bloqueados: [usernames que X bloqueó] }
// POST /api/social?action=blocks { action:"block"|"unblock", username, targetUsername }
//   "block": username bloquea a targetUsername. Además rompe el
//   vínculo de amistad/solicitudes pendientes entre ambos, si existía.
//   "unblock": username deja de bloquear a targetUsername.

async function blocks(req, res) {

  if (req.method === "GET") {

    const { username, viewer } = req.query;
    if (!username) {
      return res.status(400).json({ success: false, error: "Falta username" });
    }

    if (viewer) {
      const auth = requerirAuth(req, res);
      if (!auth) return;
      if (String(auth.username).toLowerCase() !== String(viewer).toLowerCase()) {
        return res.status(403).json({ success: false, error: "Sesión no coincide con el visitante" });
      }
    }

    const userId = await getUserId(username);
    if (!userId) {
      return res.status(404).json({ success: false, error: "Usuario no encontrado" });
    }

    const filas = await sql`
      SELECT u.username, b.created_at
      FROM user_blocks b
      JOIN users u ON u.id = b.blocked_id
      WHERE b.blocker_id = ${userId}
      ORDER BY b.created_at DESC;
    `;

    // Estas banderas SOLO son verdaderas cuando existe una fila real
    // en user_blocks con la dirección exacta del bloqueo. No se infieren
    // por visitar un perfil ni por ninguna otra relación social.
    let bloqueadoPorElPerfil = false;
    let bloqueadoPorMi = false;

    if (viewer) {
      const perfilUsername = username;
      const visitanteUsername = viewer;

      if (perfilUsername.toLowerCase() !== visitanteUsername.toLowerCase()) {
        bloqueadoPorElPerfil = await usuarioBloqueaA(sql, perfilUsername, visitanteUsername);
        bloqueadoPorMi = await usuarioBloqueaA(sql, visitanteUsername, perfilUsername);
      }
    }

    return res.status(200).json({
      success: true,
      bloqueados: filas.map(f => f.username),
      bloqueadoPorElPerfil: bloqueadoPorElPerfil === true,
      bloqueadoPorMi: bloqueadoPorMi === true
    });
  }

  if (req.method === "POST") {

    const { action, username, targetUsername } = req.body || {};
    if (String(req.auth.username).toLowerCase() !== String(username || '').toLowerCase()) return res.status(403).json({success:false,error:"Sesión no corresponde al usuario"});

    if (!username || !targetUsername) {
      return res.status(400).json({ success: false, error: "Datos incompletos" });
    }
    if (username === targetUsername) {
      return res.status(200).json({ success: false, error: "No podés bloquearte a vos mismo" });
    }

    const userId = await getUserId(username);
    const targetId = await getUserId(targetUsername);

    if (!userId || !targetId) {
      return res.status(404).json({ success: false, error: "Usuario no encontrado" });
    }

    if (action === "unblock") {
      await sql`DELETE FROM user_blocks WHERE blocker_id = ${userId} AND blocked_id = ${targetId};`;

      try {
        await getPusher().trigger(
          canalNotificaciones(targetUsername),
          "estado-bloqueo",
          { bloqueado: false, por: username }
        );
      } catch (pusherError) {
        console.warn("Pusher bloqueos (unblock):", pusherError.message);
      }

      return res.status(200).json({ success: true, bloqueado: false });
    }

    await sql`
      INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (${userId}, ${targetId})
      ON CONFLICT (blocker_id, blocked_id) DO NOTHING;
    `;

    // Bloquear a alguien también corta la amistad y cualquier
    // solicitud pendiente entre ambos, en los dos sentidos.
    await sql`DELETE FROM friendships WHERE (user_id = ${userId} AND friend_id = ${targetId}) OR (user_id = ${targetId} AND friend_id = ${userId});`;
    await sql`DELETE FROM friend_favorites WHERE (user_id = ${userId} AND friend_id = ${targetId}) OR (user_id = ${targetId} AND friend_id = ${userId});`;
    await sql`UPDATE friend_requests SET status = 'cancelada', responded_at = now()
      WHERE status = 'pendiente' AND ((from_user_id = ${userId} AND to_user_id = ${targetId}) OR (from_user_id = ${targetId} AND to_user_id = ${userId}));`;

    try {
      await getPusher().trigger(
        canalNotificaciones(targetUsername),
        "estado-bloqueo",
        { bloqueado: true, por: username }
      );
    } catch (pusherError) {
      console.warn("Pusher bloqueos (block):", pusherError.message);
    }

    return res.status(200).json({ success: true, bloqueado: true });
  }

  return res.status(405).json({ success: false, error: "Método no permitido" });
}

module.exports = async function handler(req, res) {

  setCors(res, "GET, POST, DELETE, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const action = req.query.action;

  try {
    if (req.method === "POST" || req.method === "DELETE") {
      const auth = requerirAuth(req, res);
      if (!auth) return;
      req.auth = auth;
    }

    if (action === "friends") return await friends(req, res);
    if (action === "favoriteFriends") return await favoriteFriends(req, res);
    if (action === "achievements") return await achievements(req, res);
    if (action === "badges") return await badges(req, res);
    if (action === "blocks") return await blocks(req, res);

    return res.status(400).json({ success: false, error: "Acción inválida" });

  } catch (error) {
    console.error("/api/social:", error);
    return res.status(500).json({ success: false, error: "Error interno del servidor" });
  }
};

const { setCors, hayBloqueoEntreUsuarios } = require("./_utils");
const { getPusher, canalNotificaciones } = require("./_pusher");
const { requerirAuth } = require("./_auth");
const { crearNotificacionServidor, notificarMencionesServidor } = require("./_notifications");
const { obtenerSql } = require("./_db");
const { MonedasService } = require("./_monedas");

// La conexión se pide a api/_db.js en vez de crearla acá con
// neon(process.env.DATABASE_URL). En producción es exactamente la misma
// conexión de siempre; el motivo del cambio es que así este handler
// también se puede correr contra la base local PGlite en los tests, que
// es lo que permite probar de verdad la compra en la tienda de avatares.
const sql = obtenerSql();

// El "banco": el único lugar que sabe restar monedas (ver api/_monedas.js).
const monedasService = new MonedasService(sql);

// ==============================
// /api/content?action=comments|likes|reports
// ==============================
// Fase 2 / Bloque 1: comentarios de perfil, likes (genérico) y
// reportes de comentarios/mensajes. Mismo criterio que api/social.js:
// un solo archivo por límite de Serverless Functions en Vercel.
//
// GET    /api/content?action=comments&username=X
// POST   /api/content?action=comments   { profileUsername, texto, authorUsername }
// DELETE /api/content?action=comments   { commentId }
//
// GET  /api/content?action=likes&targetType=comment&targetIds=1,2,3&username=X
// POST /api/content?action=likes        { targetType, itemId, username }
//
// GET    /api/content?action=chat
// POST   /api/content?action=chat        { username, texto }
// DELETE /api/content?action=chat        { messageId, username }
//
// GET    /api/content?action=notifications&username=X
// POST   /api/content?action=notifications          { username, titulo, mensaje }
// DELETE /api/content?action=notifications           { username }
// POST   /api/content?action=notifications-mark-read { username }
//
// GET  /api/content?action=activity&username=X
// POST /api/content?action=activity          { username, tipo, detalle }
// GET  /api/content?action=activity-friends&usernames=a,b,c
// GET  /api/content?action=mentions-received&username=X   (requiere sesión propia)
//
// GET  /api/content?action=favorites&username=X
// POST /api/content?action=favorites   { username, gameId }
//
// GET  /api/content?action=game-history&username=X
// POST /api/content?action=game-history   { username, gameId }
//
// GET  /api/content?action=reports
// POST /api/content?action=reports         { targetType, targetId, origen, contentUsername, contentTexto, reportedBy, motivo }
// POST /api/content?action=reports-resolve { reportId, resolution: "ignorar"|"eliminar" }
//
// GET    /api/content?action=reviews&gameId=X
// POST   /api/content?action=reviews    { username, gameId, calificacion, texto }
// DELETE /api/content?action=reviews    { username, gameId }
//
// GET  /api/content?action=game-ratings&gameId=X&username=Y
// POST /api/content?action=game-ratings { username, gameId, calificacion }
//
// GET  /api/content?action=game-votes&gameId=X&username=Y
// POST /api/content?action=game-votes   { username, gameId, voto: "like"|"dislike" }
//
// GET  /api/content?action=moderation-log&rol=X&accion=Y&texto=Z
// POST /api/content?action=moderation-log { moderatorUsername, moderatorRole, accion, usuarioAfectado, motivo }
//
// GET  /api/content?action=avatar-gallery&username=X&viewer=Y
//   -> devuelve los 6 casilleros de la galería de avatares guardados
//      de X (ocupados o vacíos), con el conteo de likes/dislikes de
//      cada uno y, si se pasa "viewer", el voto de ese usuario.
// POST /api/content?action=avatar-gallery { username, slot, avatar }
//   -> guarda (o reemplaza) el diseño de avatar en ese casillero
//      (1 a 6) de "username". Si "avatar" viene null/vacío, vacía el
//      casillero en vez de guardar.
//
// POST /api/content?action=avatar-vote { username, avatarId, voto: "like"|"dislike" }
//   -> vota (o saca el voto, toggle) un avatar guardado de la galería
//      de otro usuario. Mismo criterio que "game-votes".
// ==============================

async function getUserId(username) {
  if (!username) return null;
  const filas = await sql`SELECT id FROM users WHERE username = ${username};`;
  return filas.length ? filas[0].id : null;
}


async function accesoPerfilPermitido(username, viewer) {
  if (!viewer || !username) return true;
  if (String(username).toLowerCase() === String(viewer).toLowerCase()) return true;
  return !(await hayBloqueoEntreUsuarios(sql, username, viewer));
}

// A viewer supplied by the browser is only trusted when it matches
// the signed session. Without this guard a blocked user could forge
// ?viewer=otroUsuario and bypass the profile visibility checks.
function validarViewer(req, res, viewer) {
  if (!viewer) return true;
  const auth = requerirAuth(req, res);
  if (!auth) return false;
  if (String(auth.username).toLowerCase() !== String(viewer).toLowerCase()) {
    res.status(403).json({ success: false, error: "La sesión no corresponde al visor" });
    return false;
  }
  return true;
}

// ============== COMMENTS ==============

async function comments(req, res) {

  if (req.method === "GET") {
    const { username, viewer } = req.query;
    if (!validarViewer(req, res, viewer)) return;
    if (!username) {
      return res.status(400).json({ success: false, error: "Falta username" });
    }

    const profileId = await getUserId(username);
    if (!profileId) {
      return res.status(404).json({ success: false, error: "Usuario no encontrado" });
    }

    const viewerPermitido = await accesoPerfilPermitido(username, viewer);
    if (!viewerPermitido) {
      return res.status(200).json({ success: true, comentarios: [] });
    }

    const viewerEsElPropioPerfil = !!(
      viewer &&
      String(viewer).trim().toLowerCase() === String(username).trim().toLowerCase()
    );

    const filas = await sql`
      SELECT id, author_username AS usuario, texto, created_at
      FROM profile_comments pc
      WHERE profile_user_id = ${profileId}
        AND (
          ${viewerEsElPropioPerfil}
          OR ${viewer || null}::text IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM user_blocks b
            JOIN users u1 ON u1.id = b.blocker_id
            JOIN users u2 ON u2.id = b.blocked_id
            WHERE
              (LOWER(u1.username) = LOWER(${viewer || ""}) AND LOWER(u2.username) = LOWER(pc.author_username))
              OR
              (LOWER(u1.username) = LOWER(pc.author_username) AND LOWER(u2.username) = LOWER(${viewer || ""}))
          )
        )
      ORDER BY id DESC;
    `;

    return res.status(200).json({ success: true, comentarios: filas });
  }

  if (req.method === "POST") {
    const { profileUsername, texto, authorUsername } = req.body || {};

    if (!profileUsername || !texto || !texto.trim()) {
      return res.status(400).json({ success: false, error: "Datos incompletos" });
    }

    const profileId = await getUserId(profileUsername);
    if (!profileId) {
      return res.status(404).json({ success: false, error: "Usuario no encontrado" });
    }

    const nombreAutor = (authorUsername && authorUsername.trim()) ? authorUsername.trim() : "Usuario";
    const authorId = await getUserId(nombreAutor);

    const esPropioPerfil = String(profileUsername).trim().toLowerCase() === String(nombreAutor).trim().toLowerCase();
    if (!esPropioPerfil && await hayBloqueoEntreUsuarios(sql, profileUsername, nombreAutor)) {
      return res.status(403).json({
        success: false,
        bloqueado: true,
        error: "No se puede comentar entre usuarios bloqueados"
      });
    }

    const filas = await sql`
      INSERT INTO profile_comments (profile_user_id, author_user_id, author_username, texto)
      VALUES (${profileId}, ${authorId}, ${nombreAutor}, ${texto.trim()})
      RETURNING id, author_username AS usuario, texto, created_at;
    `;

    if (!esPropioPerfil) {
      await crearNotificacionServidor(
        profileUsername,
        "💬 Nuevo comentario",
        `${nombreAutor} comentó en tu perfil.`,
        nombreAutor
      );
    }
    await notificarMencionesServidor(
      texto.trim(),
      nombreAutor,
      `en un comentario en el perfil de ${profileUsername}.`
    );

    // Push en tiempo real: avisa a quien tenga el perfil abierto (el
    // suyo o el de otra persona) para que la lista de comentarios se
    // repinte sola, sin recargar la página. Mismo criterio que las
    // notificaciones: si Pusher falla, el comentario ya quedó guardado
    // igual, así que no rompemos la respuesta por esto.
    try {
      await getPusher().trigger(
        canalNotificaciones(profileUsername),
        "nuevo-comentario",
        filas[0]
      );
    } catch (error) {
      console.warn("Pusher: no se pudo avisar el nuevo comentario en vivo.", error);
    }

    return res.status(200).json({ success: true, comentario: filas[0] });
  }

  if (req.method === "DELETE") {
    const { commentId, username, profileUsername } = req.body || {};

    if (!username) {
      return res.status(400).json({ success: false, error: "Falta username" });
    }

    // Vaciar TODOS los comentarios de un perfil de una sola vez: solo
    // puede hacerlo el dueño de ese perfil, sin importar quién haya
    // escrito cada comentario. Se distingue de un borrado individual
    // porque no viene commentId, sino profileUsername.
    if (!commentId && profileUsername) {

      if (username !== profileUsername) {
        return res.status(403).json({ success: false, error: "Solo el dueño del perfil puede vaciar sus comentarios" });
      }

      const profileId = await getUserId(profileUsername);
      if (!profileId) {
        return res.status(404).json({ success: false, error: "Usuario no encontrado" });
      }

      await sql`DELETE FROM profile_comments WHERE profile_user_id = ${profileId};`;

      try {
        await getPusher().trigger(
          canalNotificaciones(profileUsername),
          "comentarios-vaciados",
          {}
        );
      } catch (error) {
        console.warn("Pusher: no se pudo avisar el vaciado de comentarios en vivo.", error);
      }

      return res.status(200).json({ success: true });
    }

    if (!commentId) {
      return res.status(400).json({ success: false, error: "Falta commentId" });
    }

    // Quién puede borrar un comentario individual:
    //  - el autor del comentario, sin importar en qué perfil lo haya
    //    escrito (mismo criterio que ya usa el chat), o
    //  - el dueño del perfil donde está publicado ese comentario,
    //    aunque no sea el autor (puede moderar su propio muro).
    const perfilDeQuienBorra = await getUserId(username);

    const borrado = await sql`
      DELETE FROM profile_comments
      WHERE id = ${commentId}
        AND (author_username = ${username} OR profile_user_id = ${perfilDeQuienBorra})
      RETURNING id, profile_user_id;
    `;

    if (!borrado.length) {
      return res.status(403).json({ success: false, error: "No podés eliminar este comentario" });
    }

    // Push en tiempo real: si alguien tiene abierto el perfil donde
    // estaba este comentario, se le refresca la lista sola.
    try {
      const filasPerfil = await sql`SELECT username FROM users WHERE id = ${borrado[0].profile_user_id};`;
      if (filasPerfil.length) {
        await getPusher().trigger(
          canalNotificaciones(filasPerfil[0].username),
          "nuevo-comentario",
          {}
        );
      }
    } catch (error) {
      console.warn("Pusher: no se pudo avisar la eliminación en vivo.", error);
    }

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ success: false, error: "Método no permitido" });
}

// ============== LIKES ==============

async function likes(req, res) {

  if (req.method === "GET") {
    const { targetType, targetIds, username } = req.query;

    if (!targetType || !targetIds) {
      return res.status(400).json({ success: false, error: "Datos incompletos" });
    }

    const ids = String(targetIds).split(",").map(s => s.trim()).filter(Boolean);
    if (!ids.length) {
      return res.status(200).json({ success: true, counts: {}, likedByMe: [] });
    }

    const filas = await sql`
      SELECT target_id, COUNT(*)::int AS cantidad
      FROM likes
      WHERE target_type = ${targetType} AND target_id = ANY(${ids})
      GROUP BY target_id;
    `;

    const counts = {};
    filas.forEach(f => { counts[f.target_id] = f.cantidad; });

    let likedByMe = [];
    if (username) {
      const propios = await sql`
        SELECT target_id FROM likes
        WHERE target_type = ${targetType} AND target_id = ANY(${ids}) AND username = ${username};
      `;
      likedByMe = propios.map(f => f.target_id);
    }

    return res.status(200).json({ success: true, counts, likedByMe });
  }

  if (req.method === "POST") {
    const { targetType, itemId, username } = req.body || {};

    if (!targetType || itemId === undefined || itemId === null || !username) {
      return res.status(400).json({ success: false, error: "Datos incompletos" });
    }

    const targetId = String(itemId);

    const existente = await sql`
      SELECT id FROM likes
      WHERE target_type = ${targetType} AND target_id = ${targetId} AND username = ${username};
    `;

    let liked;
    if (existente.length) {
      await sql`DELETE FROM likes WHERE id = ${existente[0].id};`;
      liked = false;
    } else {
      await sql`
        INSERT INTO likes (target_type, target_id, username)
        VALUES (${targetType}, ${targetId}, ${username})
        ON CONFLICT (target_type, target_id, username) DO NOTHING;
      `;
      liked = true;
    }

    const cantidad = await sql`
      SELECT COUNT(*)::int AS cantidad FROM likes
      WHERE target_type = ${targetType} AND target_id = ${targetId};
    `;

    return res.status(200).json({ success: true, liked, count: cantidad[0].cantidad });
  }

  return res.status(405).json({ success: false, error: "Método no permitido" });
}

// ============== CHAT ==============

async function chat(req, res) {

  if (req.method === "GET") {
    const { username: viewer } = req.query;
    if (!validarViewer(req, res, viewer)) return;
    // Se traen los 200 mensajes más recientes, del más nuevo al más
    // viejo (misma consulta simple que ya funcionaba antes). El orden
    // para mostrarlos de más viejo a más nuevo se resuelve en
    // js/chat.js, así evitamos subconsultas SQL nuevas sin probar.
    const filas = await sql`
      SELECT id, username AS usuario, texto, created_at
      FROM chat_messages cm
      WHERE (
        ${viewer || null}::text IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM user_blocks b
          JOIN users a ON a.id = b.blocker_id
          JOIN users blocked ON blocked.id = b.blocked_id
          WHERE
            (a.username = ${viewer || ""} AND blocked.username = cm.username)
            OR
            (a.username = cm.username AND blocked.username = ${viewer || ""})
        )
      )
      ORDER BY id DESC
      LIMIT 200;
    `;

    return res.status(200).json({ success: true, mensajes: filas });
  }

  if (req.method === "POST") {
    const { username, texto } = req.body || {};

    if (!username || !texto || !texto.trim()) {
      return res.status(400).json({ success: false, error: "Datos incompletos" });
    }

    const userId = await getUserId(username);

    const filas = await sql`
      INSERT INTO chat_messages (user_id, username, texto)
      VALUES (${userId}, ${username}, ${texto.trim()})
      RETURNING id, username AS usuario, texto, created_at;
    `;

    return res.status(200).json({ success: true, mensaje: filas[0] });
  }

  if (req.method === "DELETE") {
    const { messageId, username } = req.body || {};

    if (!messageId) {
      return res.status(400).json({ success: false, error: "Falta messageId" });
    }

    // Solo el autor puede borrar su propio mensaje (mismo criterio que
    // ya usaba la UI, que solo mostraba el botón "Borrar" en los
    // mensajes propios).
    if (username) {
      await sql`DELETE FROM chat_messages WHERE id = ${messageId} AND username = ${username};`;
    } else {
      await sql`DELETE FROM chat_messages WHERE id = ${messageId};`;
    }

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ success: false, error: "Método no permitido" });
}

// ============== NOTIFICATIONS ==============

async function notifications(req, res) {

  if (req.method === "GET") {
    const { username } = req.query;
    if (!username) {
      return res.status(400).json({ success: false, error: "Falta username" });
    }

    const auth = requerirAuth(req, res);
    if (!auth) return;
    if (String(auth.username).toLowerCase() !== String(username).toLowerCase()) {
      return res.status(403).json({ success: false, error: "No podés consultar las notificaciones de otro usuario" });
    }

    const userId = await getUserId(username);
    if (!userId) {
      return res.status(404).json({ success: false, error: "Usuario no encontrado" });
    }

    const filas = await sql`
      SELECT id, titulo, mensaje, leida, created_at
      FROM notifications
      WHERE user_id = ${userId}
      ORDER BY id DESC
      LIMIT 100;
    `;

    return res.status(200).json({ success: true, notificaciones: filas });
  }

  if (req.method === "POST") {
    const { username, titulo, mensaje, origenNombre } = req.body || {};

    if (!username || !titulo) {
      return res.status(400).json({ success: false, error: "Datos incompletos" });
    }

    const resultado = await crearNotificacionServidor(username, titulo, mensaje, origenNombre);
    return res.status(resultado.success ? 200 : (resultado.bloqueado ? 403 : 200)).json(resultado);
  }

  if (req.method === "DELETE") {
    const { username } = req.body || {};
    if (!username) {
      return res.status(400).json({ success: false, error: "Falta username" });
    }

    const userId = await getUserId(username);
    if (userId) {
      await sql`DELETE FROM notifications WHERE user_id = ${userId};`;
    }

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ success: false, error: "Método no permitido" });
}

async function notificationsMarkRead(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Método no permitido" });
  }

  const { username } = req.body || {};
  if (!username) {
    return res.status(400).json({ success: false, error: "Falta username" });
  }

  const userId = await getUserId(username);
  if (userId) {
    await sql`UPDATE notifications SET leida = true WHERE user_id = ${userId} AND leida = false;`;
  }

  return res.status(200).json({ success: true });
}

// ============== ACTIVITY ==============

async function activity(req, res) {

  if (req.method === "GET") {
    const { username, viewer } = req.query;
    if (!validarViewer(req, res, viewer)) return;
    if (!username) {
      return res.status(400).json({ success: false, error: "Falta username" });
    }

    if (viewer) {
      const permitido = await accesoPerfilPermitido(username, viewer);
      if (!permitido) return res.status(200).json({ success: true, actividades: [] });
    }

    const userId = await getUserId(username);
    if (!userId) {
      return res.status(200).json({ success: true, actividades: [] });
    }

    // "Actividad reciente" ya no muestra todo lo que hace el usuario:
    // solo reseñas de juegos, comentarios que mencionan a alguien
    // (@usuario), likes a juegos, amigos agregados y logros. Jugar,
    // favoritos y subir de nivel se siguen guardando en activity_log
    // igual que antes, simplemente no se devuelven acá.
    const filas = await sql`
      SELECT tipo, detalle, created_at
      FROM activity_log
      WHERE user_id = ${userId}
        AND (
          tipo IN ('resena', 'like_juego', 'amigo', 'logro')
          OR (tipo = 'comentario' AND detalle ~ '@[A-Za-z0-9_]{3,20}')
        )
      ORDER BY id DESC
      LIMIT 20;
    `;

    return res.status(200).json({ success: true, actividades: filas });
  }

  if (req.method === "POST") {
    const { username, tipo, detalle } = req.body || {};

    if (!username || !tipo) {
      return res.status(400).json({ success: false, error: "Datos incompletos" });
    }

    const userId = await getUserId(username);
    if (!userId) {
      return res.status(200).json({ success: false, error: "Usuario no encontrado" });
    }

    await sql`
      INSERT INTO activity_log (user_id, tipo, detalle)
      VALUES (${userId}, ${tipo}, ${detalle || ""});
    `;

    // Push en tiempo real: quien tenga este perfil abierto ve la
    // actividad nueva sin recargar.
    try {
      await getPusher().trigger(
        canalNotificaciones(username),
        "nueva-actividad",
        { tipo, detalle: detalle || "" }
      );
    } catch (error) {
      console.warn("Pusher: no se pudo avisar la nueva actividad en vivo.", error);
    }

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ success: false, error: "Método no permitido" });
}

async function activityFriends(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Método no permitido" });
  }

  const { usernames } = req.query;
  const lista = usernames ? String(usernames).split(",").map(s => s.trim()).filter(Boolean) : [];

  if (!lista.length) {
    return res.status(200).json({ success: true, actividades: [] });
  }

  // Mismo criterio de "solo estas 5 acciones" que en activity() de acá arriba.
  const filas = await sql`
    SELECT u.username, a.tipo, a.detalle, a.created_at
    FROM activity_log a
    JOIN users u ON u.id = a.user_id
    WHERE u.username = ANY(${lista})
      AND (
        a.tipo IN ('resena', 'like_juego', 'amigo', 'logro')
        OR (a.tipo = 'comentario' AND a.detalle ~ '@[A-Za-z0-9_]{3,20}')
      )
    ORDER BY a.id DESC
    LIMIT 20;
  `;

  return res.status(200).json({ success: true, actividades: filas });
}

// ==============================
// /api/content?action=mentions-received
// ==============================
// "Actividad reciente" del PROPIO perfil ya no muestra lo que el
// dueño hizo (eso ahora es lo que ve un visitante en usuario.html):
// muestra las menciones (@usuario) que OTROS le hicieron a él, con el
// mensaje completo donde lo mencionaron (comentario de perfil o
// reseña de un juego). Reutiliza activity_log — no crea tabla nueva —
// pero acá la búsqueda es al revés de activity()/activityFriends():
// en vez de filtrar por el autor, se busca en TODOS los autores algo
// que mencione a "username".
//
// Requiere sesión propia (como notifications()): es el buzón de
// menciones de alguien, no un dato público de su perfil.

const REGEX_MENCION_SERVIDOR = /@([a-zA-Z0-9_]{3,20})/g;

function _textoParaBuscarMencion(tipo, detalle) {
  if (tipo === "resena") {
    try {
      const obj = JSON.parse(detalle);
      if (obj && typeof obj === "object" && "texto" in obj) return obj.texto || "";
    } catch (_e) { /* no era JSON: se usa el detalle plano de abajo */ }
  }
  return detalle || "";
}

async function mencionesRecibidas(req, res) {

  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Método no permitido" });
  }

  const { username } = req.query;
  if (!username) {
    return res.status(400).json({ success: false, error: "Falta username" });
  }

  const auth = requerirAuth(req, res);
  if (!auth) return;
  if (String(auth.username).toLowerCase() !== String(username).toLowerCase()) {
    return res.status(403).json({ success: false, error: "No podés consultar las menciones de otro usuario" });
  }

  // Filtro grueso en SQL (ILIKE, escapando los comodines propios de
  // ILIKE por si el username los contiene) para no traer toda la
  // tabla; el filtro fino y exacto (que sea justo "@username", no
  // "@username2") se hace después en JS con la misma regex que usa
  // el resto de la app.
  const patronILIKE = "%@" + String(username).replace(/[\\%_]/g, c => "\\" + c) + "%";

  const filas = await sql`
    SELECT u.username AS autor, a.tipo, a.detalle, a.created_at
    FROM activity_log a
    JOIN users u ON u.id = a.user_id
    WHERE a.tipo IN ('comentario', 'resena')
      AND u.username <> ${username}
      AND a.detalle ILIKE ${patronILIKE} ESCAPE '\\'
    ORDER BY a.id DESC
    LIMIT 200;
  `;

  const objetivo = String(username).toLowerCase();

  const coincidencias = filas.filter(fila => {
    const texto = _textoParaBuscarMencion(fila.tipo, fila.detalle);
    const menciones = texto.match(REGEX_MENCION_SERVIDOR) || [];
    return menciones.some(m => m.slice(1).toLowerCase() === objetivo);
  }).slice(0, 20);

  return res.status(200).json({ success: true, menciones: coincidencias });
}

// ============== FAVORITES ==============

async function favorites(req, res) {

  if (req.method === "GET") {
    const { username, viewer } = req.query;
    if (!validarViewer(req, res, viewer)) return;
    if (!username) {
      return res.status(400).json({ success: false, error: "Falta username" });
    }

    if (viewer && !(await accesoPerfilPermitido(username, viewer))) {
      return res.status(200).json({ success: true, favoritos: [] });
    }

    const userId = await getUserId(username);
    if (!userId) {
      return res.status(200).json({ success: true, favoritos: [] });
    }

    const filas = await sql`SELECT game_id FROM game_favorites WHERE user_id = ${userId};`;

    return res.status(200).json({ success: true, favoritos: filas.map(f => f.game_id) });
  }

  if (req.method === "POST") {
    const { username, gameId } = req.body || {};

    if (!username || gameId === undefined || gameId === null) {
      return res.status(400).json({ success: false, error: "Datos incompletos" });
    }

    const userId = await getUserId(username);
    if (!userId) {
      return res.status(404).json({ success: false, error: "Usuario no encontrado" });
    }

    const idTexto = String(gameId);

    const existente = await sql`
      SELECT id FROM game_favorites WHERE user_id = ${userId} AND game_id = ${idTexto};
    `;

    let favorito;
    if (existente.length) {
      await sql`DELETE FROM game_favorites WHERE id = ${existente[0].id};`;
      favorito = false;
    } else {
      await sql`
        INSERT INTO game_favorites (user_id, game_id) VALUES (${userId}, ${idTexto})
        ON CONFLICT (user_id, game_id) DO NOTHING;
      `;
      favorito = true;
    }

    return res.status(200).json({ success: true, favorito });
  }

  return res.status(405).json({ success: false, error: "Método no permitido" });
}

// ============== GAME HISTORY (últimos jugados + juegos jugados para logros) ==============

async function gameHistory(req, res) {

  if (req.method === "GET") {
    const { username, viewer } = req.query;
    if (!validarViewer(req, res, viewer)) return;
    if (!username) {
      return res.status(400).json({ success: false, error: "Falta username" });
    }

    if (viewer && !(await accesoPerfilPermitido(username, viewer))) {
      return res.status(200).json({ success: true, historial: [] });
    }

    const userId = await getUserId(username);
    if (!userId) {
      return res.status(200).json({ success: true, historial: [] });
    }

    const filas = await sql`
      SELECT game_id FROM game_history
      WHERE user_id = ${userId}
      ORDER BY played_at DESC
      LIMIT 5;
    `;

    return res.status(200).json({ success: true, historial: filas.map(f => f.game_id) });
  }

  if (req.method === "POST") {
    const { username, gameId } = req.body || {};

    if (!username || gameId === undefined || gameId === null) {
      return res.status(400).json({ success: false, error: "Datos incompletos" });
    }

    const userId = await getUserId(username);
    if (!userId) {
      return res.status(404).json({ success: false, error: "Usuario no encontrado" });
    }

    const idTexto = String(gameId);

    // Últimos jugados: upsert, se actualiza la fecha si ya estaba.
    await sql`
      INSERT INTO game_history (user_id, game_id, played_at)
      VALUES (${userId}, ${idTexto}, now())
      ON CONFLICT (user_id, game_id) DO UPDATE SET played_at = now();
    `;

    // Juegos jugados para logros: nunca se borra, solo se agrega una
    // vez por juego distinto.
    const insertado = await sql`
      INSERT INTO games_played (user_id, game_id)
      VALUES (${userId}, ${idTexto})
      ON CONFLICT (user_id, game_id) DO NOTHING
      RETURNING id;
    `;

    const totalJuegosUnicos = await sql`
      SELECT COUNT(*)::int AS cantidad FROM games_played WHERE user_id = ${userId};
    `;

    // Push en tiempo real: refresca "Últimos jugados" sin recargar.
    try {
      await getPusher().trigger(
        canalNotificaciones(username),
        "nuevo-historial",
        { gameId: idTexto }
      );
    } catch (error) {
      console.warn("Pusher: no se pudo avisar el nuevo juego jugado en vivo.", error);
    }

    return res.status(200).json({
      success: true,
      esNuevo: insertado.length > 0,
      juegosUnicos: totalJuegosUnicos[0].cantidad
    });
  }

  return res.status(405).json({ success: false, error: "Método no permitido" });
}


// ============== GAMES OVERVIEW ==============
// Lectura agregada para Home/Catálogo. No modifica datos existentes.
// "partidas" mantiene el nombre de campo que ya consume el frontend;
// representa sesiones históricas registradas en game_history por usuario/juego.
async function gamesOverview(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Método no permitido" });
  }

  const [historial, ratings, favoritos, tendencia] = await Promise.all([
    sql`
      SELECT game_id, COUNT(*)::int AS cantidad
      FROM game_history
      GROUP BY game_id;
    `,
    sql`
      SELECT game_id,
             ROUND(AVG(calificacion)::numeric, 2)::float AS promedio,
             COUNT(*)::int AS votos
      FROM game_ratings
      GROUP BY game_id;
    `,
    sql`
      SELECT game_id, COUNT(*)::int AS cantidad
      FROM game_favorites
      GROUP BY game_id;
    `,
    sql`
      SELECT game_id, COUNT(*)::int AS cantidad
      FROM game_history
      WHERE played_at >= now() - INTERVAL '7 days'
      GROUP BY game_id;
    `
  ]);

  const juegos = {};
  const asegurar = (id) => {
    const key = String(id);
    if (!juegos[key]) juegos[key] = { partidas: 0, promedio: 0, votos: 0, valoraciones: 0, favoritos: 0, tendencia: 0, jugadores: 0 };
    return juegos[key];
  };

  historial.forEach(f => {
    const item = asegurar(f.game_id);
    item.partidas = Number(f.cantidad) || 0;
    item.jugadores = Number(f.cantidad) || 0;
  });
  ratings.forEach(f => {
    const item = asegurar(f.game_id);
    item.promedio = Number(f.promedio) || 0;
    item.votos = Number(f.votos) || 0;
    item.valoraciones = item.votos;
  });
  favoritos.forEach(f => {
    asegurar(f.game_id).favoritos = Number(f.cantidad) || 0;
  });
  tendencia.forEach(f => {
    asegurar(f.game_id).tendencia = Number(f.cantidad) || 0;
  });

  return res.status(200).json({ success: true, juegos });
}

// ============== REPORTS ==============

async function reports(req, res) {

  if (req.method === "GET") {
    const auth = requerirAuth(req, res);
    if (!auth) return;
    const rolAuth = await sql`SELECT 1 FROM badges WHERE user_id = ${auth.sub} AND badge_id IN ('administrador','moderador') LIMIT 1;`;
    if (!rolAuth.length) return res.status(403).json({ success:false,error:"No tenés permisos para ver reportes" });
    const filas = await sql`
      SELECT id, target_type, target_id, origen, content_username AS usuario,
             content_texto AS texto, reported_by AS "reportadoPor", motivo,
             estado, created_at
      FROM comment_reports
      WHERE estado = 'pendiente'
      ORDER BY id DESC;
    `;

    return res.status(200).json({ success: true, reportes: filas });
  }

  if (req.method === "POST") {
    const { targetType, targetId, origen, contentUsername, contentTexto, reportedBy, motivo } = req.body || {};

    if (!targetType || !origen || !reportedBy) {
      return res.status(400).json({ success: false, error: "Datos incompletos" });
    }

    await sql`
      INSERT INTO comment_reports
        (target_type, target_id, origen, content_username, content_texto, reported_by, motivo)
      VALUES (
        ${targetType}, ${targetId !== undefined && targetId !== null ? String(targetId) : null},
        ${origen}, ${contentUsername || ""}, ${contentTexto || ""},
        ${reportedBy}, ${(motivo && motivo.trim()) ? motivo.trim() : "No especificado"}
      );
    `;

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ success: false, error: "Método no permitido" });
}

async function resolveReport(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Método no permitido" });
  }

  const { reportId, resolution } = req.body || {};
  const rol = await sql`SELECT 1 FROM badges WHERE user_id = ${req.auth.sub} AND badge_id IN ('administrador','moderador') LIMIT 1;`;
  if (!rol.length) return res.status(403).json({ success:false,error:"Solo moderadores o administradores pueden resolver reportes" });

  if (!reportId || !resolution) {
    return res.status(400).json({ success: false, error: "Datos incompletos" });
  }

  const filas = await sql`SELECT * FROM comment_reports WHERE id = ${reportId} AND estado = 'pendiente';`;
  if (!filas.length) {
    return res.status(404).json({ success: false, error: "Reporte no encontrado" });
  }

  const reporte = filas[0];

  if (resolution === "ignorar") {
    await sql`UPDATE comment_reports SET estado = 'ignorado', resolved_at = now() WHERE id = ${reportId};`;
    return res.status(200).json({ success: true, targetType: reporte.target_type, targetId: reporte.target_id });
  }

  if (resolution === "eliminar") {
    let eliminado = false;

    if (reporte.target_type === "comment" && reporte.target_id) {
      const borrado = await sql`DELETE FROM profile_comments WHERE id = ${reporte.target_id} RETURNING id;`;
      eliminado = borrado.length > 0;
    }

    if (reporte.target_type === "chat" && reporte.target_id) {
      const borrado = await sql`DELETE FROM chat_messages WHERE id = ${reporte.target_id} RETURNING id;`;
      eliminado = borrado.length > 0;
    }

    await sql`
      UPDATE comment_reports
      SET estado = ${eliminado ? "eliminado" : "eliminado_no_encontrado"},
          resolved_at = now()
      WHERE id = ${reportId};
    `;

    return res.status(200).json({
      success: true,
      eliminado,
      targetType: reporte.target_type,
      targetId: reporte.target_id,
      origen: reporte.origen,
      usuario: reporte.content_username
    });
  }

  return res.status(400).json({ success: false, error: "Resolución inválida" });
}

// ============== GAME REVIEWS (reseñas de juegos) ==============

async function reviews(req, res) {

  if (req.method === "GET") {
    const { gameId } = req.query;
    if (!gameId) {
      return res.status(400).json({ success: false, error: "Falta gameId" });
    }

    const filas = await sql`
      SELECT u.username AS usuario, r.calificacion, r.texto,
             r.created_at, r.updated_at, r.editado
      FROM game_reviews r
      JOIN users u ON u.id = r.user_id
      WHERE r.game_id = ${String(gameId)}
      ORDER BY r.updated_at DESC;
    `;

    return res.status(200).json({ success: true, resenas: filas });
  }

  if (req.method === "POST") {
    const { username, gameId, calificacion, texto } = req.body || {};

    const cal = Number(calificacion);
    const textoLimpio = (texto || "").trim();

    if (!username || gameId === undefined || gameId === null || !cal || !textoLimpio) {
      return res.status(400).json({ success: false, error: "Datos incompletos" });
    }

    if (cal < 1 || cal > 5) {
      return res.status(400).json({ success: false, error: "Calificación inválida" });
    }

    const userId = await getUserId(username);
    if (!userId) {
      return res.status(404).json({ success: false, error: "Usuario no encontrado" });
    }

    const idTexto = String(gameId);

    const existente = await sql`
      SELECT id FROM game_reviews WHERE user_id = ${userId} AND game_id = ${idTexto};
    `;

    let filas;
    if (existente.length) {
      filas = await sql`
        UPDATE game_reviews
        SET calificacion = ${cal}, texto = ${textoLimpio}, updated_at = now(), editado = true
        WHERE id = ${existente[0].id}
        RETURNING calificacion, texto, created_at, updated_at, editado;
      `;
    } else {
      filas = await sql`
        INSERT INTO game_reviews (user_id, game_id, calificacion, texto)
        VALUES (${userId}, ${idTexto}, ${cal}, ${textoLimpio})
        RETURNING calificacion, texto, created_at, updated_at, editado;
      `;
    }

    return res.status(200).json({ success: true, resena: { usuario: username, ...filas[0] } });
  }

  if (req.method === "DELETE") {
    const { username, gameId } = req.body || {};

    if (!username || gameId === undefined || gameId === null) {
      return res.status(400).json({ success: false, error: "Datos incompletos" });
    }

    const userId = await getUserId(username);
    if (!userId) {
      return res.status(404).json({ success: false, error: "Usuario no encontrado" });
    }

    await sql`DELETE FROM game_reviews WHERE user_id = ${userId} AND game_id = ${String(gameId)};`;

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ success: false, error: "Método no permitido" });
}

// ============== GAME RATINGS (estrellas sueltas) ==============

async function gameRatings(req, res) {

  if (req.method === "GET") {
    const { gameId, username } = req.query;
    if (!gameId) {
      return res.status(400).json({ success: false, error: "Falta gameId" });
    }

    const idTexto = String(gameId);

    const agregado = await sql`
      SELECT COUNT(*)::int AS cantidad, COALESCE(AVG(calificacion), 0)::float AS promedio
      FROM game_ratings WHERE game_id = ${idTexto};
    `;

    let miCalificacion = 0;
    if (username) {
      const userId = await getUserId(username);
      if (userId) {
        const propia = await sql`
          SELECT calificacion FROM game_ratings WHERE user_id = ${userId} AND game_id = ${idTexto};
        `;
        miCalificacion = propia.length ? propia[0].calificacion : 0;
      }
    }

    return res.status(200).json({
      success: true,
      promedio: agregado[0].promedio,
      cantidad: agregado[0].cantidad,
      miCalificacion
    });
  }

  if (req.method === "POST") {
    const { username, gameId, calificacion } = req.body || {};
    const cal = Number(calificacion);

    if (!username || gameId === undefined || gameId === null || !cal || cal < 1 || cal > 5) {
      return res.status(400).json({ success: false, error: "Datos incompletos" });
    }

    const userId = await getUserId(username);
    if (!userId) {
      return res.status(404).json({ success: false, error: "Usuario no encontrado" });
    }

    const idTexto = String(gameId);

    await sql`
      INSERT INTO game_ratings (user_id, game_id, calificacion)
      VALUES (${userId}, ${idTexto}, ${cal})
      ON CONFLICT (user_id, game_id) DO UPDATE SET calificacion = ${cal};
    `;

    const agregado = await sql`
      SELECT COUNT(*)::int AS cantidad, COALESCE(AVG(calificacion), 0)::float AS promedio
      FROM game_ratings WHERE game_id = ${idTexto};
    `;

    return res.status(200).json({
      success: true,
      promedio: agregado[0].promedio,
      cantidad: agregado[0].cantidad,
      miCalificacion: cal
    });
  }

  return res.status(405).json({ success: false, error: "Método no permitido" });
}

// ============== GAME VOTES (like / dislike) ==============

async function gameVotes(req, res) {

  if (req.method === "GET") {
    const { gameId, username } = req.query;
    if (!gameId) {
      return res.status(400).json({ success: false, error: "Falta gameId" });
    }

    const idTexto = String(gameId);

    const filas = await sql`
      SELECT voto, COUNT(*)::int AS cantidad FROM game_votes
      WHERE game_id = ${idTexto} GROUP BY voto;
    `;

    let likes = 0, dislikes = 0;
    filas.forEach(f => {
      if (f.voto === "like") likes = f.cantidad;
      if (f.voto === "dislike") dislikes = f.cantidad;
    });

    let miVoto = null;
    if (username) {
      const userId = await getUserId(username);
      if (userId) {
        const propio = await sql`
          SELECT voto FROM game_votes WHERE user_id = ${userId} AND game_id = ${idTexto};
        `;
        miVoto = propio.length ? propio[0].voto : null;
      }
    }

    return res.status(200).json({ success: true, likes, dislikes, miVoto });
  }

  if (req.method === "POST") {
    const { username, gameId, voto } = req.body || {};

    if (!username || gameId === undefined || gameId === null || !["like", "dislike"].includes(voto)) {
      return res.status(400).json({ success: false, error: "Datos incompletos" });
    }

    const userId = await getUserId(username);
    if (!userId) {
      return res.status(404).json({ success: false, error: "Usuario no encontrado" });
    }

    const idTexto = String(gameId);

    const existente = await sql`
      SELECT id, voto FROM game_votes WHERE user_id = ${userId} AND game_id = ${idTexto};
    `;

    let miVoto;
    if (existente.length && existente[0].voto === voto) {
      // Mismo voto de nuevo -> se quita (toggle), igual que hacía la UI.
      await sql`DELETE FROM game_votes WHERE id = ${existente[0].id};`;
      miVoto = null;
    } else if (existente.length) {
      await sql`UPDATE game_votes SET voto = ${voto} WHERE id = ${existente[0].id};`;
      miVoto = voto;
    } else {
      await sql`INSERT INTO game_votes (user_id, game_id, voto) VALUES (${userId}, ${idTexto}, ${voto});`;
      miVoto = voto;
    }

    const filas = await sql`
      SELECT voto, COUNT(*)::int AS cantidad FROM game_votes
      WHERE game_id = ${idTexto} GROUP BY voto;
    `;

    let likes = 0, dislikes = 0;
    filas.forEach(f => {
      if (f.voto === "like") likes = f.cantidad;
      if (f.voto === "dislike") dislikes = f.cantidad;
    });

    return res.status(200).json({ success: true, likes, dislikes, miVoto });
  }

  return res.status(405).json({ success: false, error: "Método no permitido" });
}

// ============== AVATAR GALLERY (6 casilleros guardados por usuario) ==============
// Mismo criterio que gameVotes/gameRatings de acá arriba: cuenta
// likes/dislikes agrupando por avatar_id y resuelve "miVoto" del
// visitante (query "viewer") si se pasa.

const CASILLEROS_GALERIA = 6;

async function avatarGallery(req, res) {

  if (req.method === "GET") {
    const { username, viewer } = req.query;

    if (!username) {
      return res.status(400).json({ success: false, error: "Falta username" });
    }

    const userId = await getUserId(username);
    if (!userId) {
      return res.status(404).json({ success: false, error: "Usuario no encontrado" });
    }

    const guardados = await sql`
      SELECT id, slot, avatar FROM saved_avatars WHERE user_id = ${userId};
    `;

    const conteos = await sql`
      SELECT v.avatar_id, v.voto, COUNT(*)::int AS cantidad
      FROM avatar_votes v
      JOIN saved_avatars a ON a.id = v.avatar_id
      WHERE a.user_id = ${userId}
      GROUP BY v.avatar_id, v.voto;
    `;

    let misVotos = {};
    if (viewer) {
      const viewerId = await getUserId(viewer);
      if (viewerId) {
        const propios = await sql`
          SELECT v.avatar_id, v.voto
          FROM avatar_votes v
          JOIN saved_avatars a ON a.id = v.avatar_id
          WHERE a.user_id = ${userId} AND v.user_id = ${viewerId};
        `;
        propios.forEach(p => { misVotos[p.avatar_id] = p.voto; });
      }
    }

    const porSlot = {};
    guardados.forEach(fila => { porSlot[fila.slot] = fila; });

    const slots = [];
    for (let n = 1; n <= CASILLEROS_GALERIA; n++) {
      const fila = porSlot[n];

      if (!fila) {
        slots.push({ slot: n, id: null, avatar: null, likes: 0, dislikes: 0, miVoto: null });
        continue;
      }

      let likes = 0, dislikes = 0;
      conteos.forEach(c => {
        if (c.avatar_id !== fila.id) return;
        if (c.voto === "like") likes = c.cantidad;
        if (c.voto === "dislike") dislikes = c.cantidad;
      });

      slots.push({
        slot: n,
        id: fila.id,
        avatar: fila.avatar,
        likes,
        dislikes,
        miVoto: misVotos[fila.id] || null
      });
    }

    return res.status(200).json({ success: true, slots });
  }

  if (req.method === "POST") {
    const { username, slot, avatar } = req.body || {};
    const slotNum = Number(slot);

    if (!username || !Number.isInteger(slotNum) || slotNum < 1 || slotNum > CASILLEROS_GALERIA) {
      return res.status(400).json({ success: false, error: "Datos incompletos" });
    }

    const userId = await getUserId(username);
    if (!userId) {
      return res.status(404).json({ success: false, error: "Usuario no encontrado" });
    }

    // Sin avatar (null/vacío) -> vacía el casillero (borra el diseño
    // guardado y, en cascada, los votos que tenía).
    if (!avatar) {
      await sql`DELETE FROM saved_avatars WHERE user_id = ${userId} AND slot = ${slotNum};`;
      return res.status(200).json({
        success: true,
        slot: { slot: slotNum, id: null, avatar: null, likes: 0, dislikes: 0, miVoto: null }
      });
    }

    const fila = await sql`
      INSERT INTO saved_avatars (user_id, slot, avatar)
      VALUES (${userId}, ${slotNum}, ${JSON.stringify(avatar)})
      ON CONFLICT (user_id, slot)
      DO UPDATE SET avatar = ${JSON.stringify(avatar)}, updated_at = now()
      RETURNING id, slot, avatar;
    `;

    // Reemplazar el diseño de un casillero limpia los votos viejos:
    // esos votos eran sobre el diseño anterior, no sobre el nuevo.
    await sql`DELETE FROM avatar_votes WHERE avatar_id = ${fila[0].id};`;

    return res.status(200).json({
      success: true,
      slot: { slot: fila[0].slot, id: fila[0].id, avatar: fila[0].avatar, likes: 0, dislikes: 0, miVoto: null }
    });
  }

  return res.status(405).json({ success: false, error: "Método no permitido" });
}

// ============== AVATAR VOTE (like / dislike sobre un avatar guardado) ==============

async function avatarVote(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Método no permitido" });
  }

  const { username, avatarId, voto } = req.body || {};
  const avatarIdNum = Number(avatarId);

  if (!username || !Number.isInteger(avatarIdNum) || !["like", "dislike"].includes(voto)) {
    return res.status(400).json({ success: false, error: "Datos incompletos" });
  }

  const userId = await getUserId(username);
  if (!userId) {
    return res.status(404).json({ success: false, error: "Usuario no encontrado" });
  }

  const avatarGuardado = await sql`SELECT id, user_id FROM saved_avatars WHERE id = ${avatarIdNum};`;
  if (avatarGuardado.length === 0) {
    return res.status(404).json({ success: false, error: "Avatar no encontrado" });
  }

  // No tiene sentido votar el propio avatar (acá el dueño ve los
  // cuadros de conteo en vez de los botones, pero se valida también
  // del lado del servidor por las dudas).
  if (avatarGuardado[0].user_id === userId) {
    return res.status(400).json({ success: false, error: "No podés votar tu propio avatar" });
  }

  const existente = await sql`
    SELECT id, voto FROM avatar_votes WHERE user_id = ${userId} AND avatar_id = ${avatarIdNum};
  `;

  if (existente.length && existente[0].voto === voto) {
    // Mismo voto de nuevo -> se quita (toggle), igual que game-votes.
    await sql`DELETE FROM avatar_votes WHERE id = ${existente[0].id};`;
  } else if (existente.length) {
    await sql`UPDATE avatar_votes SET voto = ${voto} WHERE id = ${existente[0].id};`;
  } else {
    await sql`INSERT INTO avatar_votes (user_id, avatar_id, voto) VALUES (${userId}, ${avatarIdNum}, ${voto});`;
  }

  const filas = await sql`
    SELECT voto, COUNT(*)::int AS cantidad FROM avatar_votes
    WHERE avatar_id = ${avatarIdNum} GROUP BY voto;
  `;

  let likes = 0, dislikes = 0;
  filas.forEach(f => {
    if (f.voto === "like") likes = f.cantidad;
    if (f.voto === "dislike") dislikes = f.cantidad;
  });

  const miVotoFinal = (existente.length && existente[0].voto === voto) ? null : voto;

  return res.status(200).json({ success: true, likes, dislikes, miVoto: miVotoFinal });
}

// ============== MODERATION LOG (historial de moderación) ==============

async function moderationLog(req, res) {

  if (req.method === "GET") {
    const auth = requerirAuth(req, res);
    if (!auth) return;
    const rolAuth = await sql`SELECT 1 FROM badges WHERE user_id = ${auth.sub} AND badge_id IN ('administrador','moderador','colaborador') LIMIT 1;`;
    if (!rolAuth.length) return res.status(403).json({ success:false,error:"No tenés permisos para ver el historial de moderación" });
    const { rol, accion, texto } = req.query;

    // Se arma el WHERE a mano (sql.query, con placeholders $1, $2...)
    // en vez de encadenar if/else por cada combinación de filtros.
    const condiciones = [];
    const valores = [];

    if (rol) {
      valores.push(rol);
      condiciones.push(`moderator_role = $${valores.length}`);
    }
    if (accion) {
      valores.push(accion);
      condiciones.push(`accion = $${valores.length}`);
    }
    if (texto && String(texto).trim()) {
      valores.push("%" + String(texto).trim() + "%");
      const p = `$${valores.length}`;
      condiciones.push(`(moderator_username ILIKE ${p} OR usuario_afectado ILIKE ${p} OR motivo ILIKE ${p})`);
    }

    const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

    const filas = await sql.query(
      `SELECT id, moderator_username AS usuario, moderator_role AS rol, accion,
              usuario_afectado AS "usuarioAfectado", motivo, created_at
       FROM moderation_log ${where}
       ORDER BY id DESC LIMIT 500;`,
      valores
    );

    return res.status(200).json({ success: true, historial: filas });
  }

  if (req.method === "POST") {
    const { moderatorUsername, moderatorRole, accion, usuarioAfectado, motivo } = req.body || {};
    const rol = await sql`SELECT badge_id FROM badges WHERE user_id = ${req.auth.sub} AND badge_id IN ('administrador','moderador','colaborador') LIMIT 1;`;
    if (!rol.length) return res.status(403).json({ success:false,error:"No tenés permisos de moderación" });

    if (!moderatorUsername || !moderatorRole || !accion) {
      return res.status(400).json({ success: false, error: "Datos incompletos" });
    }

    const filas = await sql`
      INSERT INTO moderation_log (moderator_username, moderator_role, accion, usuario_afectado, motivo)
      VALUES (
        ${moderatorUsername}, ${rol[0].badge_id}, ${accion},
        ${usuarioAfectado || null},
        ${(motivo && String(motivo).trim()) ? String(motivo).trim() : "No especificado"}
      )
      RETURNING id, moderator_username AS usuario, moderator_role AS rol, accion,
                usuario_afectado AS "usuarioAfectado", motivo, created_at;
    `;

    return res.status(200).json({ success: true, entrada: filas[0] });
  }

  return res.status(405).json({ success: false, error: "Método no permitido" });
}

// ==============================
// /api/content?action=community-feed
// ==============================
// Fase "Ranking y comunidad": feed global "¿Qué está ocurriendo
// ahora?" — a diferencia de activity()/activityFriends(), NO filtra
// por un usuario puntual: junta lo último de TODOS los usuarios.
// Reusa la misma tabla activity_log y los mismos "tipo" que ya
// registra js/motor/actividad.js (comentario, favorito, resena,
// like_juego, amigo, logro), no crea nada nuevo.
//
// GET /api/content?action=community-feed&limit=18

async function communityFeed(req, res) {

  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Método no permitido" });
  }

  const limite = Math.min(parseInt(req.query.limit, 10) || 18, 60);

  const filas = await sql`
    SELECT a.tipo, a.detalle, a.created_at,
           u.username, u.avatar
    FROM activity_log a
    JOIN users u ON u.id = a.user_id
    WHERE a.tipo IN ('comentario','favorito','resena','like_juego','amigo','logro')
    ORDER BY a.id DESC
    LIMIT ${limite};
  `;

  return res.status(200).json({ success: true, actividades: filas });
}


// ==============================
// /api/content?action=avatar-shop
// ==============================
// Fase "Ranking y comunidad" / Centro de Avatares: catálogo de
// prendas comprables con monedas (users.monedas) y qué prendas ya
// tiene cada usuario. Las prendas reusan el mismo sistema de capas
// del editor de avatar (ver ORDEN_CAPAS_AVATAR en js/core.js):
// "valorCapa" queda listo para guardarse tal cual en el objeto
// avatar del usuario.
//
// GET  /api/content?action=avatar-shop&username=X
//   -> catálogo completo + cuáles ya compró X (si se manda username)
//
// GET  /api/content?action=avatar-shop-buy&username=X&itemId=Y
//   (se resuelve como POST más abajo)
// POST /api/content?action=avatar-shop-buy { username, itemId }
//   -> descuenta el precio del saldo (users.monedas) a través del banco
//   (api/_monedas.js) e inserta la compra. Falla si ya la tiene o si no
//   le alcanzan las monedas.
//
// El saldo se LEE y se GASTA por api/_monedas.js, no con SQL suelto acá:
// ese módulo es también el que otorga monedas por jugar, así que las dos
// puntas del saldo (ganarlo y gastarlo) viven en el mismo lugar.

async function avatarShop(req, res) {

  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Método no permitido" });
  }

  const { username } = req.query;

  const items = await sql`
    SELECT id, categoria, modelo, valor_capa AS "valorCapa", nombre, precio, created_at AS "creadoEl"
    FROM avatar_shop_items
    ORDER BY created_at DESC, id DESC;
  `;

  let comprados = [];
  let monedas = null;

  if (username) {
    const userId = await getUserId(username);
    if (userId) {
      monedas = await monedasService.consultarSaldo(userId);

      const filasCompras = await sql`
        SELECT item_id FROM avatar_shop_purchases WHERE user_id = ${userId};
      `;
      comprados = filasCompras.map(f => f.item_id);
    }
  }

  return res.status(200).json({ success: true, items, comprados, monedas });
}

async function avatarShopBuy(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Método no permitido" });
  }

  const { username, itemId } = req.body || {};
  if (!username || !itemId) {
    return res.status(400).json({ success: false, error: "Datos incompletos" });
  }

  const userId = await getUserId(username);
  if (!userId) {
    return res.status(404).json({ success: false, error: "Usuario no encontrado" });
  }

  const filasItem = await sql`SELECT id, nombre, precio FROM avatar_shop_items WHERE id = ${itemId};`;
  if (!filasItem.length) {
    return res.status(404).json({ success: false, error: "La prenda no existe" });
  }
  const item = filasItem[0];

  const yaLaTiene = await sql`
    SELECT 1 FROM avatar_shop_purchases WHERE user_id = ${userId} AND item_id = ${itemId};
  `;
  if (yaLaTiene.length) {
    return res.status(200).json({ success: false, error: "Ya tenés esta prenda" });
  }

  // El descuento del saldo lo hace el banco (api/_monedas.js), no este
  // handler: antes acá había un SELECT del saldo, la comparación y un
  // UPDATE escritos a mano. El servicio lo hace en una sola instrucción
  // condicionada, así que dos clics simultáneos no pueden dejar el saldo
  // en negativo. El mensaje de error es el mismo que veía el usuario.
  const gasto = await monedasService.gastar(userId, item.precio);

  if (!gasto.ok) {
    return res.status(200).json({ success: false, error: gasto.error });
  }

  await sql`INSERT INTO avatar_shop_purchases (user_id, item_id) VALUES (${userId}, ${itemId});`;

  return res.status(200).json({
    success: true,
    itemComprado: item.nombre,
    monedas: gasto.saldoNuevo
  });
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
      const body = req.body || {};
      // Las notificaciones pueden dirigirse a otro usuario solo cuando
      // el remitente declarado (origenNombre) coincide con la sesión.
      // Para el resto de escrituras, username sigue siendo el actor.
      if (action !== "notifications" && body.username && String(body.username).toLowerCase() !== String(auth.username).toLowerCase()) {
        return res.status(403).json({ success:false,error:"Sesión no corresponde al usuario" });
      }
      if (action === "notifications") {
        if (body.origenNombre) {
          if (String(body.origenNombre).toLowerCase() !== String(auth.username).toLowerCase()) {
            return res.status(403).json({ success:false,error:"Sesión no corresponde al origen de la notificación" });
          }
        } else if (body.username && String(body.username).toLowerCase() !== String(auth.username).toLowerCase()) {
          return res.status(403).json({ success:false,error:"Una notificación a otro usuario requiere origenNombre" });
        }
      }
      if (body.reportedBy && String(body.reportedBy).toLowerCase() !== String(auth.username).toLowerCase()) {
        return res.status(403).json({ success:false,error:"Sesión no corresponde al reportante" });
      }
      if (body.moderatorUsername && String(body.moderatorUsername).toLowerCase() !== String(auth.username).toLowerCase()) {
        return res.status(403).json({ success:false,error:"Sesión no corresponde al moderador" });
      }
    }

    if (action === "comments") return await comments(req, res);
    if (action === "likes") return await likes(req, res);
    if (action === "chat") return await chat(req, res);
    if (action === "notifications") return await notifications(req, res);
    if (action === "notifications-mark-read") return await notificationsMarkRead(req, res);
    if (action === "activity") return await activity(req, res);
    if (action === "activity-friends") return await activityFriends(req, res);
    if (action === "mentions-received") return await mencionesRecibidas(req, res);
    if (action === "favorites") return await favorites(req, res);
    if (action === "game-history") return await gameHistory(req, res);
    if (action === "games-overview") return await gamesOverview(req, res);
    if (action === "reports") return await reports(req, res);
    if (action === "reports-resolve") return await resolveReport(req, res);
    if (action === "reviews") return await reviews(req, res);
    if (action === "game-ratings") return await gameRatings(req, res);
    if (action === "game-votes") return await gameVotes(req, res);
    if (action === "avatar-gallery") return await avatarGallery(req, res);
    if (action === "avatar-vote") return await avatarVote(req, res);
    if (action === "moderation-log") return await moderationLog(req, res);
    if (action === "community-feed") return await communityFeed(req, res);
    if (action === "avatar-shop") return await avatarShop(req, res);
    if (action === "avatar-shop-buy") return await avatarShopBuy(req, res);

    return res.status(400).json({ success: false, error: "Acción inválida" });

  } catch (error) {
    console.error("/api/content:", error);
    return res.status(500).json({ success: false, error: "Error interno del servidor" });
  }
};

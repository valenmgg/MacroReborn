const { obtenerSql } = require('./_db');
const { getUserId, hayBloqueoEntreUsuarios } = require('./_utils');
const { getPusher, canalNotificaciones } = require('./_pusher');

const sql = obtenerSql();

async function crearNotificacionServidor(username, titulo, mensaje, origenNombre) {
  if (!username || !titulo) return { success: false, error: 'Datos incompletos' };

  try {
    const userId = await getUserId(sql, username);
    if (!userId) return { success: false, error: 'Usuario no encontrado' };

    if (origenNombre && await hayBloqueoEntreUsuarios(sql, origenNombre, username)) {
      return { success: false, bloqueado: true, error: 'Notificación bloqueada entre usuarios' };
    }

    const filas = await sql`
      INSERT INTO notifications (user_id, titulo, mensaje)
      VALUES (${userId}, ${titulo}, ${mensaje || ''})
      RETURNING id, titulo, mensaje, leida, created_at;
    `;

    const notif = filas[0];

    try {
      await getPusher().trigger(
        canalNotificaciones(username),
        'nueva-notificacion',
        notif
      );
    } catch (error) {
      console.warn('Pusher: no se pudo enviar la notificación en tiempo real.', error);
    }

    return { success: true, notificacion: notif };
  } catch (error) {
    // Las notificaciones nunca deben romper la acción principal (amistad,
    // comentario, XP, logro, etc.). La escritura principal ya ocurrió o
    // continúa con normalidad aunque este subsistema falle.
    console.warn('MacroReborn: no se pudo crear la notificación.', error);
    return { success: false, error: 'No se pudo crear la notificación' };
  }
}

function extraerMenciones(texto, origenNombre) {
  const encontrados = String(texto || '').match(/@([a-zA-Z0-9_]{3,20})/g) || [];
  const origen = String(origenNombre || '').toLowerCase();
  return [...new Set(encontrados
    .map(m => m.slice(1))
    .filter(nombre => nombre.toLowerCase() !== origen))];
}

async function notificarMencionesServidor(texto, origenNombre, contexto) {
  const nombres = extraerMenciones(texto, origenNombre);
  for (const nombre of nombres) {
    try {
      await crearNotificacionServidor(
        nombre,
        '📣 Te mencionaron',
        `${origenNombre || 'Alguien'} te mencionó ${contexto || 'en MacroReborn'}.`,
        origenNombre
      );
    } catch (error) {
      console.warn('MacroReborn: no se pudo crear la notificación de mención.', error);
    }
  }
}

module.exports = { crearNotificacionServidor, notificarMencionesServidor };

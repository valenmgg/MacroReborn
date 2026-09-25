// ==============================
// LOS DÍAS JUGADOS Y LA RACHA — api/_racha.js
// ==============================
// Un minuto jugado deja dos rastros:
//
//   - actividad_diaria: los minutos de hoy. Es lo que miden las misiones
//     diarias de minutos ("Jugá 15 minutos hoy"), que hasta la migración
//     023 no tenían de dónde leerlo.
//
//   - la racha: días seguidos jugando. Decidido el 25/09/2026, se cuenta
//     sola: un día más por cada día en que se juega al menos un minuto.
//     Antes había que pulsar "Registrar mi día", y ni así subía: el
//     servidor pasaba a texto la fecha que devuelve la base, que llega
//     como Date, y comparaba "Thu Sep 24" con "2026-09-24". Nunca era
//     "ayer", así que cada registro la devolvía a 1. Ahora la comparación
//     la hace la base, con fechas de verdad.
//
// El día es el de Argentina, como el resto de la progresión (misiones y
// ranking semanal): cambia a las 00:00 de allí.
//
// Lo llama el pulso de cada minuto de juego (registrarTickTiempoJugado,
// en api/users.js). Sin juego no hay pulso que cuente: abrir el sitio
// no suma racha.

async function registrarMinutoJugado(sql, userId) {
  await sql`
    INSERT INTO actividad_diaria (user_id, dia, minutos)
    VALUES (${userId}, (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date, 1)
    ON CONFLICT (user_id, dia) DO UPDATE SET minutos = actividad_diaria.minutos + 1;
  `;

  // La racha, una vez al día. Si ayer se jugó, suma uno; si no, vuelve a
  // empezar en 1. La mejor se queda con la más alta. Si hoy ya contó, el
  // WHERE deja la fila como estaba: el pulso llega cada minuto.
  await sql`
    INSERT INTO player_streaks (user_id, current_streak, best_streak, last_checkin_date, updated_at)
    VALUES (${userId}, 1, 1, (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date, now())
    ON CONFLICT (user_id) DO UPDATE SET
      current_streak = CASE
        WHEN player_streaks.last_checkin_date = EXCLUDED.last_checkin_date - 1
        THEN player_streaks.current_streak + 1
        ELSE 1
      END,
      best_streak = GREATEST(player_streaks.best_streak, CASE
        WHEN player_streaks.last_checkin_date = EXCLUDED.last_checkin_date - 1
        THEN player_streaks.current_streak + 1
        ELSE 1
      END),
      last_checkin_date = EXCLUDED.last_checkin_date,
      updated_at = now()
    WHERE player_streaks.last_checkin_date IS DISTINCT FROM EXCLUDED.last_checkin_date;
  `;
}

module.exports = { registrarMinutoJugado };

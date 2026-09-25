-- ============================================
-- MacroReborn — Migración 023: los minutos de cada día
-- ============================================
-- Decidido el 25/09/2026, a raíz de un reporte de la comunidad: "la
-- racha no rachea y las misiones diarias, aunque las cumplas, no se
-- validan".
--
-- Tres de las siete misiones diarias ("Jugá 15, 20 o 30 minutos hoy")
-- miden los minutos de hoy, y no había dónde contarlos: la única cuenta
-- de minutos era por semana (ranking_actividad_semanal). Valían siempre
-- 0, así que nadie las cumplió nunca, y tocan 14 días de cada 31.
--
-- Esta tabla lleva los minutos de cada persona y cada día, con el mismo
-- día que el resto de la progresión: el de Argentina. La suma el mismo
-- pulso de un minuto que ya cuenta los de la semana
-- (registrarTickTiempoJugado, en api/users.js), y es también lo que
-- mueve la racha desde ese día: un día más por cada día en que se juega
-- al menos un minuto (api/_racha.js).
--
-- Empieza vacía: los minutos de antes no se guardaban por día.
-- ============================================

CREATE TABLE IF NOT EXISTS actividad_diaria (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dia     DATE    NOT NULL,
  minutos INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, dia)
);

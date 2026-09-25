-- ============================================
-- MacroReborn — Migración 022: la tienda entera
-- ============================================
-- Decidido el 24/09/2026, a raíz de lo que más pedía la comunidad ("¡no
-- hay tienda!"): se venden todas las prendas publicadas. Hasta ahora
-- solo 162 tenían precio (127 del equipo de arte y 35 de la tienda
-- original, la de la migración 012); las otras 594, del catálogo
-- original, eran gratis.
--
-- Tres cosas, y se puede aplicar más de una vez sin efecto:
--
--   1. avatar_shop_purchases.precio_pagado: lo que costó cada compra.
--      NULL en las anteriores a esta migración (no se apuntaba) y 0 en
--      las regaladas. Sirve para contar ventas de verdad y para un
--      historial.
--
--   2. Un precio por tipo de prenda para las publicadas que no lo
--      tenían, calibrado con los 35 de la tienda original: accesorio 60,
--      guantes 70, ojos 80-90, botas 90-100, pantalón y remera 100-110,
--      pelo 120-150, fondo 130, borde 150 y mascota 220-240. Los tipos
--      que aquella no tenía van con los de su tamaño: boca y cara con lo
--      más pequeño, piel con los ojos, espalda con el borde.
--
--      Lo que ya tenía precio NO se toca: los precios del equipo de
--      arte se quedan como están. Los personajes base no se venden. Y la
--      fecha es la de la prenda, no la de hoy: si no, las 594 saldrían
--      en la tienda como novedades.
--
--   3. A quien ya llevaba puesta o guardada una de esas prendas, se le
--      regala: queda como comprada, a 0. Sin esto la seguiría llevando
--      (api/_avatar-catalogo.js deja conservar lo que ya se tiene), pero
--      al quitársela no podría volver a ponérsela sin pagarla.
--
-- Solo se regala lo que esta migración pone a la venta, gracias al
-- RETURNING: lo que ya estaba en la tienda sigue como estaba.
-- ============================================

ALTER TABLE avatar_shop_purchases ADD COLUMN IF NOT EXISTS precio_pagado INTEGER;

WITH nuevas AS (
  INSERT INTO avatar_shop_items (categoria, modelo, valor_capa, nombre, precio, created_at)
  SELECT p.capa, p.modelo, p.valor, p.nombre,
         CASE p.capa
           WHEN 'boca'      THEN 50
           WHEN 'cara'      THEN 50
           WHEN 'accesorio' THEN 60
           WHEN 'guantes'   THEN 70
           WHEN 'ojos'      THEN 80
           WHEN 'piel'      THEN 80
           WHEN 'botas'     THEN 90
           WHEN 'pantalon'  THEN 100
           WHEN 'remera'    THEN 100
           WHEN 'pelo'      THEN 120
           WHEN 'fondo'     THEN 130
           WHEN 'borde'     THEN 150
           WHEN 'espalda'   THEN 150
           WHEN 'mascota'   THEN 220
           ELSE 100
         END,
         p.created_at
  FROM avatar_prendas p
  WHERE p.publicada
    AND p.capa <> 'modelo'
    AND NOT EXISTS (SELECT 1 FROM avatar_shop_items s WHERE s.valor_capa = p.valor)
  ON CONFLICT (valor_capa) DO NOTHING
  RETURNING id, valor_capa
),
-- Lo que cada persona lleva puesto o tiene guardado. Un avatar PNG no
-- aporta nada: sus valores no son prendas.
en_uso AS (
  SELECT u.id AS user_id, v.valor
  FROM users u,
       jsonb_each_text(CASE WHEN jsonb_typeof(u.avatar) = 'object'
                            THEN u.avatar ELSE '{}'::jsonb END) AS v(clave, valor)
  WHERE u.avatar IS NOT NULL
  UNION
  SELECT a.user_id, v.valor
  FROM saved_avatars a,
       jsonb_each_text(CASE WHEN jsonb_typeof(a.avatar) = 'object'
                            THEN a.avatar ELSE '{}'::jsonb END) AS v(clave, valor)
)
INSERT INTO avatar_shop_purchases (user_id, item_id, precio_pagado)
SELECT DISTINCT e.user_id, n.id, 0
FROM nuevas n
JOIN en_uso e ON e.valor = n.valor_capa
ON CONFLICT (user_id, item_id) DO NOTHING;

-- ============================================
-- MacroReborn — Migración 021: la huella de la previsualización de cada prenda
-- ============================================
-- Solo añade una columna. No elimina ni modifica nada.
--
-- Guarda la huella de la previsualización que el servidor ya generó para
-- esa prenda: un sha256 sobre todo lo que la dibuja (su archivo, el del
-- modelo, la capa, el cuadro, el maniquí y la versión del dibujo). Con
-- ella, el catálogo y la tienda arman la dirección con versión sin volver
-- a calcular nada.
--
-- LA IMAGEN NO ENTRA AQUÍ, igual que en la 019: los JPG viven en disco,
-- en datos-locales/previsualizaciones/. El porqué está en
-- docs/AVATARES-SERVIDOR.md 4 y 12.
--
-- NULL significa "todavía no se ha generado", y es un estado legítimo:
-- la tienda y el editor caen entonces a lo de siempre. Se rellena con
-- scripts/generar-previsualizaciones.js, y cada prenda nueva la trae al
-- subirse desde el panel de arte.
-- ============================================

ALTER TABLE avatar_prendas
  ADD COLUMN IF NOT EXISTS previsualizacion TEXT;

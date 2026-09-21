-- ============================================
-- MacroReborn — Migración 019: la huella del avatar compuesto
-- ============================================
-- Solo añade una columna a dos tablas. No elimina ni modifica nada.
--
-- Guarda la huella del avatar que el servidor ya compuso, para no tener
-- que recalcularla en cada lectura: es un sha256 sobre la lista de
-- prendas y sus archivos, y una lista de usuarios pide 500 de golpe.
--
-- LA IMAGEN NO ENTRA AQUI. Solo la huella, que son 64 caracteres. Los
-- JPG viven en disco (MR_AVATARES_DIR), y el motivo esta en
-- docs/AVATARES-SERVIDOR.md 4: la base mide 127 MB contra 128 de
-- shared_buffers, asi que hoy lee el 100 % de memoria y cruzar esa
-- linea se paga de golpe. Ademas el arte es la fuente y se respalda
-- cada noche; un compuesto es derivado y se rehace en 150 ms.
--
-- NULL significa "todavia no se ha compuesto", que es un estado
-- legitimo: quien no eligio ninguna prenda no tiene compuesto, y quien
-- guardo su avatar antes de esta migracion lo tendra en cuanto lo
-- vuelva a guardar o pase el relleno.
-- ============================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_compuesto TEXT;

ALTER TABLE saved_avatars
  ADD COLUMN IF NOT EXISTS avatar_compuesto TEXT;

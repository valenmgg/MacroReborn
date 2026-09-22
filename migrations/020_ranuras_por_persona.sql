-- ============================================
-- MacroReborn — Migración 020: las ranuras de avatar son de cada persona
-- ============================================
-- Solo añade una columna. No elimina ni modifica nada.
--
-- Hasta ahora el numero de casilleros de la galeria era una constante
-- del codigo, CASILLEROS_GALERIA = 6, igual para todo el mundo. Pasa a
-- ser un valor por persona, para que se pueda subir sin desplegar y
-- para que algun dia se puedan comprar.
--
-- EL CODIGO NO PONE TECHO. El limite es lo que diga esta columna, y
-- puede ser cualquier numero. El unico tope es el de cordura que hay en
-- api/_avatar-compuesto.js sobre el numero de ranura, que existe para
-- que una ruta inventada no llegue al disco.
--
-- Arranca en 6 para que nadie pierda nada: es lo que todo el mundo
-- tiene hoy, y de 65 personas que guardan algo, la que mas usa cinco.
-- Nadie ha llegado al tope, asi que subirlo no corre prisa; lo que
-- corria prisa era dejar de tenerlo escrito a fuego.
--
-- Lo de VENDER ranuras esta pensado y descartado POR AHORA, y el
-- motivo esta en docs/AVATARES-SERVIDOR.md 9: la economia de monedas
-- esta rota (cuatro cuentas tienen mas de cien millones y 178 menos de
-- diez mil), asi que vender consumo de disco a cambio de una moneda
-- que se fabrica seria dar un boton para llenar el disco. Primero el
-- punto 18 de la auditoria.
-- ============================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS ranuras_avatar INTEGER NOT NULL DEFAULT 6;

-- Que nadie pueda quedarse sin ninguna, ni por un UPDATE a mano.
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_ranuras_avatar_minimo;

ALTER TABLE users
  ADD CONSTRAINT users_ranuras_avatar_minimo CHECK (ranuras_avatar >= 1);

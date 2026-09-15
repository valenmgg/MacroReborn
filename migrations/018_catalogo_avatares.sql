-- ============================================
-- MacroReborn — Migración 018
-- ============================================
-- Lleva el catálogo de prendas de avatar a la base de datos.
--
-- Hasta ahora el catálogo estaba escrito a mano en CUATRO sitios que
-- nadie obligaba a coincidir: los archivos de imagenes/, los 622 divs
-- de perfil.html, los 622 pares de CAPAS_IMG en js/perfil.js y la
-- tabla avatar_shop_items. Añadir una prenda exigía tocar tres de ellos
-- y desplegar; olvidarse de uno no daba error, la prenda simplemente no
-- aparecía. Así se perdieron 13 piezas de arte que existen en el repo y
-- que nadie puede usar.
--
-- Estas tablas son el paso previo para que el equipo de arte publique
-- desde la propia web, sin commit y sin despliegue.
--
-- NO modifica ni elimina ninguna tabla existente. La tienda
-- (avatar_shop_items / avatar_shop_purchases) sigue igual: se enlaza
-- por el valor de capa, que es el mismo texto en las dos.
--
-- Seguro de re-ejecutar (usa IF NOT EXISTS).
-- ============================================


-- ==============================
-- LOS ARCHIVOS
-- ==============================
-- Direccionados por su contenido: la huella SHA-256 es única, así que
-- si dos artistas suben el mismo PNG se guarda una sola vez y las dos
-- prendas apuntan a la misma fila.
--
-- Esa huella es además lo que va en la URL (&v=), que es lo que permite
-- cachear la imagen un año sin quedarse nunca con la versión vieja: si
-- el contenido cambia, cambia la huella y cambia la URL. Es la misma
-- técnica que ya usa el avatar PNG del administrador en api/users.js.
--
-- ancho/alto se guardan desde el primer día aunque hoy no se rechace
-- nada por tamaño. El día que se quiera exigir el lienzo de 327x504
-- bastará con consultar estas columnas, sin tener que releer 630
-- archivos para averiguar cuáles no encajan.

CREATE TABLE IF NOT EXISTS avatar_archivos (
  id          SERIAL PRIMARY KEY,
  sha256      TEXT      NOT NULL UNIQUE,
  datos       BYTEA     NOT NULL,
  ancho       INTEGER   NOT NULL,
  alto        INTEGER   NOT NULL,
  peso        INTEGER   NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT now()
);


-- ==============================
-- LAS PRENDAS
-- ==============================
-- valor: el identificador de siempre ("tora_pelo3"). NO se toca nunca.
--   Los avatares guardados de todas las cuentas y los casilleros de sus
--   galerías apuntan a estas cadenas; si una cambiara, esa prenda
--   desaparecería del avatar de quien la llevara puesta.
--
--   Para el arte nuevo lo genera el servidor a partir del modelo y la
--   capa, buscando el primer número libre. El artista nunca lo escribe:
--   es lo que hace imposible que se repita el caso de "Boca 1.png", un
--   set de ocho bocas que nunca funcionó por llevar mayúscula y espacio.
--
-- capa: una de las 15 de ORDEN_CAPAS_AVATAR (js/core.js) y CAPAS
--   (api/_avatar-catalogo.js). Guardarla es lo que permite rechazar que
--   alguien mande una remera en la ranura del pelo.
--
-- nombre: lo que ve la persona en el editor ("Botas de combate"). Hasta
--   ahora salía derivado del archivo ("Botas 1").
--
-- autor_id: quién la subió. Se llena desde el primer día aunque todavía
--   no se muestre en ningún sitio; mostrarlo es una decisión de producto
--   posterior y no queremos descubrir entonces que el dato no se guardó.
--   Queda NULL para las 621 prendas que vienen de la migración inicial.
--
-- publicada: si se ofrece o no en el editor. Una prenda retirada NO se
--   borra: quien ya la tuviera puesta la conserva, que es la misma regla
--   de derecho adquirido que ya aplica api/_avatar-catalogo.js.

CREATE TABLE IF NOT EXISTS avatar_prendas (
  id          SERIAL PRIMARY KEY,
  valor       TEXT      NOT NULL UNIQUE,
  modelo      TEXT      NOT NULL,
  capa        TEXT      NOT NULL,
  nombre      TEXT      NOT NULL,
  archivo_id  INTEGER   NOT NULL REFERENCES avatar_archivos(id),
  autor_id    INTEGER   REFERENCES users(id) ON DELETE SET NULL,
  publicada   BOOLEAN   NOT NULL DEFAULT true,
  created_at  TIMESTAMP NOT NULL DEFAULT now(),
  retirada_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_avatar_prendas_publicadas
  ON avatar_prendas(modelo, capa) WHERE publicada;

CREATE INDEX IF NOT EXISTS idx_avatar_prendas_autor
  ON avatar_prendas(autor_id);


-- ==============================
-- LA VERSIÓN DEL CATÁLOGO
-- ==============================
-- Una sola fila con un contador que sube con cada publicación o
-- retirada.
--
-- Existe por cluster.js: el sitio corre DOS procesos, y el catálogo se
-- cachea en la memoria de cada uno. Si un artista publica una prenda,
-- solo se entera el proceso que atendió esa petición; el otro seguiría
-- sirviendo el catálogo viejo, y la prenda nueva aparecería y
-- desaparecería al recargar según quién contestara. Es un fallo
-- desconcertante y difícil de perseguir.
--
-- Con esto, en vez de cachear a ciegas, cada petición comprueba este
-- entero —una consulta de una fila por clave primaria— y solo
-- reconstruye si cambió. Los dos procesos se enteran solos, sin tener
-- que hablar entre ellos.
--
-- El CHECK (id = 1) garantiza que no pueda haber más de una fila.

CREATE TABLE IF NOT EXISTS avatar_catalogo_version (
  id      INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  version BIGINT  NOT NULL DEFAULT 1
);

INSERT INTO avatar_catalogo_version (id, version)
VALUES (1, 1)
ON CONFLICT (id) DO NOTHING;

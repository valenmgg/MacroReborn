# DESARROLLO — backend e infraestructura local

Guía técnica del backend del proyecto y de la infraestructura local
para desarrollar y probar: la conexión a la base de datos, el sistema
de contraseñas, y las herramientas locales (PGlite, servidor local,
backfill y tests).

---

## 1. Qué cubre esta guía

- Los módulos compartidos del backend (`api/_db.js`, `api/_password.js`,
  `api/_avisos.js`, `api/_monedas.js`) y los cambios en `api/auth.js`,
  `api/users.js` y `api/content.js`.
- La infraestructura local: `scripts/pglite.js`,
  `scripts/servidor-local.js`, `scripts/migrar-passwords.js` y
  `scripts/smoke-local.js`, junto con los tests de `tests/`.
- Cómo correr, probar y desplegar, y las convenciones del proyecto.

## 2. Módulos nuevos del backend

### 2.1 `api/_db.js` — conector único de base

Antes cada archivo de la API creaba su conexión con
`neon(process.env.DATABASE_URL)`. Ahora la conexión pasa por acá:

- `obtenerSql()` → devuelve la función `sql` lista (Neon en
  producción).
- `usarSqlLocal(sqlLocal)` → reemplaza la conexión por una base local
  (PGlite) en desarrollo/tests.

Los handlers de esta rama (`api/auth.js`, `api/users.js` y
`api/content.js`) usan `obtenerSql()` en vez de crear la conexión a mano.

Cuando se escribió esto, `social.js` y `system.js` no pasaban por acá:
llamaban a `neon()` directo en su primera línea. La mudanza al VPS lo
arregló —contra un Postgres normal habrían seguido intentando hablar con
Neon— y hoy **los siete handlers** pasan por `obtenerSql()`. Ver
`docs/VPS.md` §3.3.

### 2.2 `api/_password.js` — contraseñas

El único lugar que sabe hashear y verificar contraseñas:

- Funciones puras: `hashContrasena(plana)`, `verificarHash(plana,
  hash)`, `verificarContrasenaYMigrar(sql, username, plana)`.
- Clase `PasswordService(sql)` con `registrar`, `verificar`,
  `cambiarContrasena` y `eliminarCuenta`.

Detalles del flujo (ver `docs/SEGURIDAD.md` para el panorama
completo):

- **Registro**: guarda solo `password_hash`; el texto plano nunca se
  escribe.
- **Login**: si el usuario tiene hash, compara con bcrypt; si todavía
  tiene texto plano (usuario viejo), compara el texto y, si coincide,
  migra a hash en la misma operación (migración perezosa).

### 2.3 `api/_avisos.js` — los avisos en vivo

`avisar(canal, evento, datos)`: el único sitio que sabe empujar algo al
navegador sin que lo pida. Sustituyó a `api/_pusher.js`, que hablaba con
un servicio de pago, en septiembre de 2026.

La sección 9 cuenta el porqué entero, incluido cómo estuvo dos semanas
sin funcionar sin que nadie lo notara.

### 2.4 Cambios en `api/auth.js` y `api/users.js`

| Archivo | Acciones que ahora usan `PasswordService` |
|---|---|
| `api/auth.js` | `login`, `register`, `delete-account` |
| `api/users.js` | `change-password` |

Las respuestas al frontend mantienen exactamente la misma forma que
antes (el contrato de la API no cambió).

## 3. Infraestructura local

### 3.1 `scripts/pglite.js` — base de práctica

- `crearBaseLocal()` → crea un Postgres real embebido (PGlite, WASM),
  arma la tabla `users` base y aplica todas las migraciones de
  `migrations/` en orden (incluidas la 013, 014 y 015).
- `crearSqlPGlite(db)` → adaptador que imita la interfaz del driver de
  Neon (`sql\`...\``), para que los mismos handlers corran contra la
  base local. Soporta **fragmentos SQL anidados**: pedazos `sql\`...\``
  incrustados dentro de otros (como hace `api/users.js` con
  `semanaActualSQL`); un fragmento solo se ejecuta cuando se espera
  con `await`, y al incrustarse se pega su SQL con los parámetros
  renumerados.

### 3.2 `scripts/servidor-local.js` — probar en el navegador

```bash
npm run db:local
```

Abre `http://localhost:3001`:

- Sirve los archivos estáticos del sitio.
- Rutea `/api/auth`, `/api/users` y `/api/content` con los handlers
  reales contra la base de práctica.
- Crea un usuario de prueba `demo` / `demo1234` con contraseña en
  texto plano, para ver la migración perezosa en vivo: la consola
  avisa `"demo" entró: su contraseña en texto plano fue migrada a
  hash` solo cuando hubo una migración real (los usuarios nuevos no
  imprimen nada).
- Siembra un catálogo de arte de mentira (`scripts/sembrar-arte.js`):
  dos personajes y quince prendas de colores planos, dibujadas con
  `zlib`, para poder probar el panel de arte y el vestidor. Las medidas
  NO son todas 327x504 a propósito: trae los mismos casos raros que el
  catálogo real (ver la sección 6).
- `demo` recibe los roles de `artista` y `administrador`, o el panel de
  arte lo echaría a la portada.
- Limitación a propósito: `/api/social` y `/api/system` no están
  activados en el modo local; las secciones que los usan se ven vacías
  (esperado).
- Y para probar contra los datos DE VERDAD, ver la sección 8.

### 3.3 `scripts/migrar-passwords.js` — backfill

Pica las contraseñas en texto plano restantes y borra el texto.
Protecciones (ver `docs/SEGURIDAD.md`):

- Sin `--local` ni `--produccion` se niega a correr.
- `--produccion` exige confirmación escrita ("SI").
- `--simular` solo muestra qué haría.
- Con `--produccion` verifica que la migración 013 esté aplicada.

### 3.4 `tests/password.test.js` — tests

```bash
npm test
```

Usa `node:test` (incluido en Node). Los tests crean su propia base de
práctica, inyectan la conexión con `usarSqlLocal()` y ejercitan los
handlers reales. Cubren: registro con hash, login correcto/incorrecto,
migración legacy, cambio de contraseña, borrado de cuenta y usuario
duplicado.

### 3.5 `tests/monedas.test.js` — reglas de monedas

Se ejecuta junto con `npm test` y usa una base PGlite nueva por suite. Cubre
el primer otorgamiento, la ventana de diez minutos, el tope diario, el
overshoot permitido, el reseteo perezoso UTC, llamadas concurrentes,
`gastar()`/`consultarSaldo()` y el enganche real de monedas en el handler de
XP y en la tienda.

### 3.6 `tests/migrations.test.js` — contrato de la migración 015

Comprueba que las tres columnas nuevas existen con tipo, default y nulabilidad
correctos, que la columna `users.monedas` conserva su saldo y que volver a
aplicar la migración es seguro. La base es efímera: al terminar el proceso no
queda ningún archivo ni conexión con Neon.

### 3.7 `scripts/smoke-local.js` — prueba HTTP de extremo a extremo

```bash
npm run test:smoke
```

El script busca un puerto libre, arranca `scripts/servidor-local.js` con una
PGlite efímera, comprueba que el sitio responde, hace login con `demo` /
`demo1234`, envía dos pulsos de XP y verifica que el primero otorga entre 10 y
30 monedas y el segundo devuelve el no-op de diez minutos. Después abre una
conexión de avisos en vivo, dispara un latido y comprueba que el aviso llega
por esa línea (sección 9): es lo único que ejercita la cadena entera, porque
las suites de `tests/` prueban cada pieza por separado. Siempre termina el
proceso hijo, también cuando falla una aserción. No necesita una base externa;
el servidor local usa un secreto efímero por defecto solo cuando no se
proporciona `SESSION_SECRET` en el entorno.

### 3.8 Verificación manual en navegador

La automatización no sustituye la comprobación visual del flujo del sitio.
Para hacerla sin tocar la base real:

1. Ejecutar `npm run db:local` y abrir `http://localhost:3001/login.html`.
2. Entrar como `demo` / `demo1234`; la consola del servidor debe mostrar la
   migración perezosa de la contraseña solo en el primer login.
3. Abrir `http://localhost:3001/jugar.html?id=112`, dejar la pestaña activa y
   abrir DevTools → Network. Cada minuto debe aparecer
   `POST /api/users?action=xp` con `success: true` y un objeto `monedas`.
4. En el primer pulso de un usuario nuevo se verá `otorgado: true` y un monto
   entre 10 y 30. Los pulsos siguientes durante los diez minutos siguientes
   deben mostrar `otorgado: false`, `monto: 0` y
   `razon: "aun-no-pasaron-10-minutos"`. El frontend todavía no muestra un
   toast de monedas, por decisión de alcance de esta rama.
5. Para observar un nuevo premio hay que dejar transcurrir diez minutos
   reales (el smoke test y los tests unitarios simulan el tiempo; no hace
   falta esperar para validar la regla automáticamente).

La compra de un avatar se valida automáticamente contra el handler real en
`tests/monedas.test.js`. Desde que el servidor local enruta `/api/content`, la
pantalla de tienda y el panel de arte también se pueden mirar en el navegador
sin tocar producción: con datos de mentira (`npm run db:local`) o con una copia
de los de verdad (`npm run db:real`, sección 8).

## 4. Despliegue de estos cambios

Orden estricto (la migración SIEMPRE antes que el código que la usa):

1. Aplicar la migración 013 a la base de producción (agrega
   `users.password_hash`).
2. Aplicar la migración 014 (quita el NOT NULL de `users.password`;
   sin ella, registro y login fallan con el error de not-null
   constraint — ver `docs/SEGURIDAD.md`).
3. Aplicar la migración 015 (agrega la contabilidad de monedas por tiempo;
   no modifica `users.monedas`).
4. Desplegar el código nuevo (todo el repo).
5. Verificar: registrar un usuario de prueba y entrar con un usuario
   existente (se migra solo).
6. Correr el backfill con `--produccion` (cubre a los que no entran).
7. Verificar que no quede texto plano:
   `SELECT COUNT(*) FROM users WHERE password IS NOT NULL;` → 0.
8. Recién entonces planificar una migración futura (borrar
   `users.password` y la rama legacy de `api/_password.js`).

**Estado (16/09/2026)**: los pasos 1 a 7 están hechos. El backfill se
corrió contra el VPS y no queda ni una contraseña en texto plano. El
paso 8 sigue pendiente a propósito; el detalle está en
`docs/SEGURIDAD.md` §5.

Si se despliega el código sin la 013, registro y login fallan (la
columna `password_hash` no existe). Si se despliega sin la 014,
fallan por la restricción NOT NULL de `password`. Si se despliega sin la
015, el primer pulso de XP intentará usar columnas que no existen. Las tres
migraciones van antes que el código.

## 5. Convenciones del proyecto

- **Idioma**: comentarios y mensajes en español, explicando el "por
  qué".
- **Sin emojis**: en código, consola, commits y documentación nueva.
  Lo preexistente no se toca.
- **Commits**: un cambio lógico por commit, sin firmas ni pies de
  autoría automáticos.
- **Reutilizar**: la lógica compartida va en `api/_*.js`; no duplicar
  lo que ya existe.
- **Dependencias**: una librería que se ejecuta **dentro del VPS**
  está permitida, y se elige por lo que cuesta mantenerla: mejor sin
  binario nativo que con él, y mejor sin dependencias propias que con
  ellas. Lo que no se acepta es depender de un **servicio de terceros**
  que se pueda acabar o cambiar de precio: de ahí salieron Vercel, Neon
  y Pusher. `api/_png.js` y `api/_lienzo.js` están escritos a mano por
  la primera regla y no por la segunda, y siguen así porque funcionan y
  están probados, no porque traer una librería esté prohibido.

---

## 6. El lienzo del catálogo

El arte de los avatares se dibuja sobre un lienzo de 327x504 y se apila
con `object-fit: contain`. Esa es la norma, y es la que comprueba el
panel de arte (`LIENZO` en `js/arte.js`). Pero el catálogo heredado no la
cumple entero.

### Lo que hay, medido

Leyendo el bloque IHDR de los 641 PNG de `imagenes/`, de los que 636 son
prendas:

| Medida | Archivos | Dibujos distintos por sha256 |
|---|---|---|
| 327x504 | 504 | 353 |
| 327x505 | 86 | 25 |
| 326x503 | 42 | 36 |
| 326x504 | 1 | 1 |
| 654x1010 | 1 | 1 (`cereza/espalda2`, el doble exacto de 327x505) |
| 332x512 | 1 | 1 (`cereza/espalda3`) |
| 415x640 | 1 | 1 (`cereza/remera2`) |

Son 636 archivos pero solo 418 dibujos distintos: 297 archivos comparten
bytes con algún otro, porque los fondos, los bordes y las mascotas se
repiten entre personajes. `tora/fondo24`, `cereza/fondo24` y los
`fondo1` de fengchao, fenglei, fiora y max son el mismo sha256: seis
archivos, una fila de `avatar_archivos`.

### Y lo que dice la base, que es lo que manda

`imagenes/` es la carpeta heredada de la que se importó el catálogo. La
comprobación autoritativa es sobre `avatar_archivos`, y ya está hecha
(sobre la copia local de producción del 16/09/2026):

```sql
SELECT ancho, alto, count(*) FROM avatar_archivos GROUP BY 1, 2;
```

| Medida | Archivos | |
|---|---|---|
| 327x504 | 353 | |
| 326x503 | 36 | |
| 327x505 | 25 | |
| 654x1010 | 1 | `cereza/espalda2` |
| 415x640 | 1 | `cereza/remera2` |
| 332x512 | 1 | `cereza/espalda3` |
| 326x504 | 1 | `tora/pelo10` |
| **718x509** | 1 | subida por el panel |
| **569x570** | 1 | subida por el panel |
| **1338x2066** | 1 | subida por el panel |
| **500x500** | 1 | subida por el panel |

Los siete primeros coinciden **exactamente** con lo medido en `imagenes/`.
Los cuatro últimos no están en la carpeta: son arte subido desde
`arte.html` después de la importación.

### Lo que eso destapa sobre el panel

Todas las prendas que se han subido por el panel hasta hoy —cinco— están
**retiradas**, y ninguna medía el lienzo:

| Prenda | Nombre | Medida |
|---|---|---|
| `cereza_piel4` | teto | 500x500 |
| `cereza_fondo40` | pearto | 569x570 |
| `tora_fondo40` | Pearto | 569x570 |
| `tora_cara9` | Mascara MR. | 1338x2066 |
| `tora_fondo41` | Captura de pantalla 2026 09 15 113043 | 718x509 |

Cinco de cinco subidas fueron descuadradas y hubo que retirarlas. La
última es, literalmente, una captura de pantalla. Y retirar no recupera
el identificador: `siguienteValor()` se lo salta para siempre.

Esto no es una anécdota: es el motivo por el que el equipo de arte pidió
un sitio donde probar las prendas ANTES de publicarlas. Cada una de esas
cinco se habría visto mal en el vestidor antes de gastar un
identificador.

(Las dos "pearto" comparten un solo `avatar_archivos`: son el mismo
dibujo subido para dos personajes, y la deduplicación por sha256 hizo su
trabajo.)

### Cuánto importa

Poco, a la vista. Dentro del marco del avatar, la diferencia de encuadre
entre un 327x504 y un 327x505 es de 0,46 px a 300 px de ancho; entre un
326x503 y un 327x505, de 0,21 px. Es subpixel: no es la causa de ningún
descuadre visible. El descuadre que se ve viene de dónde está dibujada la
prenda dentro de su lienzo, no de la medida del lienzo.

Importa por otra cosa: cualquier operación que reencuadre una prenda
tiene que decidir qué hacer con esas 64 piezas, y si lo hace por encaje
las remuestrea. Es la razón de que el vestidor use base pegada 1:1 con
anclaje entero en vez de `contain` (ver `js/arte-vestidor.js`).

### Que no es un desorden vivo

La numeración de las prendas es cronológica, porque `siguienteValor()`
(`api/content.js`) nunca reutiliza un número. Mirando los fondos:

```
tora/fondo      1-2:503   3-23:504   24-35:505   36-39:504
cereza/fondo    1-2:503   3-23:504   24-35:505   36-39:504
fengchao/fondo  1-12:505  13-19:504
max/fondo       1-12:505  13-19:504
```

Los doce fondos de 327x505 son un lote comprado una vez y replicado en
los seis personajes. Y de las 70 capas del catálogo (personaje x ranura),
66 terminan en 327x504: las cuatro excepciones son de cereza
(`boca9`, `guantes2`, `ojos12`, `pelo20`). O sea que el episodio está
cerrado: lo último dibujado ya respeta la norma.

### Trabajo pendiente que esto destapa

Ninguno es urgente y ninguno se arregla desde el vestidor.

1. **Normalizar las 64 filas descuadradas.** Sería un script, no una
   pantalla: rehornear a 327x504 con el mismo recorte o relleno entero
   que usa el vestidor, en una transacción, apuntando los `archivo_id`
   en bloque y **sin tocar los `valor`**, que es lo que las cuentas
   llevan puesto. Tres cosas a resolver antes: la URL `/prendas/<sha>.png`
   cambia y está cacheada un año con `immutable`; hay que decidir qué
   pasa con `avatar_catalogo_version` y los dos procesos de `cluster.js`;
   y el servidor no tiene librería de imagen, así que el horno tendría
   que correr en un navegador.

2. **`componerAvatarPNG` compone al tamaño de la primera capa que
   cargue** (`js/core.js`): `const ancho = imagenes[0].naturalWidth`. La
   primera es `fondo`, o `espalda` si no hay fondo, y ahí vive
   `cereza/espalda2`, de 654x1010. Un avatar sin fondo con esa espalda
   compone un PNG con cuatro veces los píxeles y estira las otras catorce
   capas. Como todas las proporciones reales caen dentro del 0,3 %, la
   deformación es subpixel; el peso no. Clavar el lienzo de composición
   es una línea, pero toca camino caliente (perfil, chat, ranking,
   comentarios, amigos) y va con su propia prueba.

3. **El CSS se contradice.** `css/arte.css` usa 327x504 y `css/perfil.css`
   usa `aspect-ratio: 327 / 505` en cuatro sitios, más
   `css/perfil-macrojuegos-light.css`. Son los dos previos que ve un
   artista y discrepan un 0,2 %. Con la medición en la mano el número
   correcto es el del panel de arte.

4. **El aviso del panel se enciende para el 21 % del arte histórico.**
   `js/arte.js` resalta cualquier medida distinta de 327x504. Es correcto
   como norma de futuro, pero si alguien vuelve a subir uno de los doce
   fondos del lote verá un aviso sobre un dibujo que ya está publicado
   veinticuatro veces tal cual. No es un fallo: conviene tenerlo escrito
   antes de que alguien "arregle" el aviso quitándolo.

---

## 7. La marca de "imagen no encontrada" sobre los avatares

Síntoma tal como se ve: al quitar o retirar una prenda queda **un
recuadro de borde fino con el icono de imagen rota en la esquina
superior izquierda**, del tamaño de la capa.

No es un resto que haya que limpiar. Es lo que el navegador dibuja
cuando una `<img>` tiene `src` y ese `src` da 404: no deja el hueco
vacío, pinta su propia marca ocupando la caja que el CSS le dio. Encima
de un avatar eso no se lee como un error de red, se lee como una prenda
rota que la persona lleva puesta.

### De dónde salía

`rutaCapaAvatar()` en `js/core.js` es el embudo por el que pasan los
ocho ficheros del frontend que dibujan avatares. Cuando el valor no
estaba en el catálogo, se inventaba la ruta de siempre:

    "imagenes/" + modelo + "/" + resto + ".png"

Eso tenía sentido cuando el catálogo solo traía lo publicado: una prenda
retirada no aparecía, y a quien la llevara puesta había que seguir
dibujándosela. Desde `d54251f` el servidor manda la lista `retiradas`
con su URL con huella (`construirCatalogo`, en `api/content.js`), así
que una retirada entra en el mapa como cualquier otra y ya no llega a
ese respaldo.

Lo único que llega hoy es un valor **colgando**: no existe en ninguna
fila de `avatar_prendas`. Y ahí adivinar una ruta no arregla nada,
porque ese fichero tampoco está. Lo único que consigue es el 404, o sea
la marca.

Medido contra la copia de producción (ver §8), hoy hay exactamente uno:

| valor | puesto | ruta que se inventaba | existe |
|---|---|---|---|
| `tora_piel7` | 5 veces | `imagenes/tora/piel7.png` | no |

Cinco: tres cuentas y dos casilleros de galería. Es el mismo caso que ya
está contado en `scripts/avatares-colgando.js`.

### El arreglo, en dos mitades

**1. `rutaCapaAvatar()` devuelve `null` si el valor cuelga.** La capa
sencillamente no se dibuja y el avatar sale con las otras catorce. Es lo
mismo que `rutaDePrenda()` de `js/perfil.js` ya hacía desde que se
arregló ahí; esto pone de acuerdo a las otras siete páginas.

El límite importa y está sujeto por tests: **sin catálogo en la mano no
se puede saber si un valor cuelga**, así que mientras el mapa esté vacío
—porque todavía no llegó, o porque la red se cayó— se sigue dibujando
por la ruta de siempre. Devolver `null` ahí dejaría a todo el mundo sin
avatar cada vez que fallara una petición.

**2. Una capa que no carga se esconde sola.** Lo anterior solo tapa el
caso que se puede saber de antemano, y solo después de que el catálogo
llegue. Quedan tres que no dependen de nosotros:

- El avatar se dibuja **antes** de que el catálogo cargue, que es lo
  normal: ahí todavía se adivina la ruta.
- Un 404 que nginx marcó como `immutable` y el navegador se guardó
  treinta días. Ya pasó de verdad: está contado en `api/content.js`.
- Un fichero que desaparece con la fila todavía puesta.

Así que `js/core.js` escucha `error` **una vez en el documento** y pone
`display:none` en la capa que falló.

Tres decisiones de esa escucha, porque las tres se pueden deshacer sin
querer:

- **En el documento y no en cada `<img>`.** Acordarse de poner `onerror`
  en los ocho ficheros que dibujan capas es justo lo que ya se olvidó una
  vez. Además hay capas que se escriben con `innerHTML` (chat, reseñas,
  galería), donde no hay dónde colgarlo.
- **En fase de captura** (`addEventListener(..., true)`). Los `error` de
  una `<img>` **no burbujean**, pero sí bajan. Sin ese `true` no se
  entera de nada.
- **`style.display` y no el atributo `hidden`.** Cualquier regla de CSS
  que ponga un `display` le gana al atributo, y estas capas llevan reglas
  propias en cinco hojas distintas.

Un avatar que es un PNG entero (`avatar-png-personalizado`) no se
esconde: no hay capas debajo y quedaría un círculo vacío. Ese cae a
`imagenes/avatar.png`, que es lo que ya se enseña cuando alguien no
tiene avatar.

### El detalle que casi muerde

El maniquí del taller no es como el resto del sitio: sus 15 `<img>` son
**siempre las mismas** y van cambiando de prenda toda la tarde. Un
`display:none` puesto a mano sobrevive al cambio de `src`, así que una
sola prenda que fallara dejaba esa ranura muerta hasta recargar la
página. `refrescarCapa()` en `js/arte-vestidor.js` limpia la marca al
asignar un `src` nuevo.

### Qué queda

`tora_piel7` sigue guardado en las cinco filas. Ya no se ve —se salta la
capa— y el hueco de numeración tampoco es peligroso, porque
`siguienteValor()` no reutiliza identificadores: comprobado, a la
siguiente piel de tora le tocó `tora_piel8`. Limpiarlo es higiene, no
urgencia, y para eso está `scripts/avatares-colgando.js --limpiar`, que
pone esas capas en `ninguno`. Sin `--limpiar` solo informa.

### Tests

- `tests/catalogo-en-core.test.js` — las retiradas por su URL con huella,
  el valor colgando sin ruta, y los dos límites (sin catálogo todavía, y
  catálogo que no llega nunca).
- `tests/capas-rotas.test.js` — las ocho clases de capa, que no toca nada
  que no sea un avatar, el PNG entero, y que vale para capas escritas
  después con `innerHTML`.
- `tests/vestidor-pantalla.test.js` — que la ranura del maniquí revive al
  cambiar de prenda.

---

## 8. Probar contra los datos de verdad

El modo local de siempre (`npm run db:local`) arma una base vacía desde
las migraciones y la rellena con un puñado de cosas de mentira. Sirve
para el camino feliz, y es lo que hay que usar todos los días porque
arranca en segundos y no tiene datos de nadie.

Pero no sirve para lo que de verdad rompe: el usuario con doscientas
prendas guardadas, la prenda descuadrada que alguien lleva puesta desde
hace un año, el avatar PNG de casi un mega, las 271.000 puntuaciones del
ranking. Para eso está la copia de producción.

```bash
npm run db:traer     # baja el ultimo respaldo del VPS y arma la copia
npm run db:real      # arranca el servidor local contra ella
```

La primera vez tarda lo que tarde el `scp`; armar la base son unos 4
segundos para 557.535 filas. Después queda guardada en
`datos-locales/pgdata` y `npm run db:real` arranca enseguida.

### Lo que hay que saber antes de usarlo

**Baja datos de personas.** El respaldo trae las cuentas, las biografías,
los comentarios de perfil y los mensajes de chat de 141 personas. No hay
correos —`users` no tiene esa columna— pero sí contraseñas, hoy todas
picadas con bcrypt en `password_hash`.

Hasta el 16/09/2026 el respaldo traía además `password` **en texto
plano** para quien no hubiera entrado desde la migración perezosa. El
backfill cerró ese hueco en la base (`docs/SEGURIDAD.md` §5), pero no en
los respaldos ya sacados: **un `.sql.gz` anterior a esa fecha sigue
llevando 17 contraseñas en claro**. Los del VPS se borran solos a los 14
días; el que esté en `datos-locales/` de un portátil, no. Si hay uno
viejo ahí, lo que corresponde es borrarlo y volver a bajar.

Por eso, por defecto, **la copia local se queda sin credenciales**: todas
las cuentas pasan a tener la misma clave conocida, `local1234`. No se
pierde nada para probar y se gana algo —se puede entrar como cualquier
usuario del sitio para reproducir lo que le pasa— y deja de haber
contraseñas reales de terceros en un portátil.

`datos-locales/` está en `.gitignore`. Que siga estando.

### Las opciones

```bash
npm run db:traer -- --ultimo          # no pide un respaldo nuevo: usa el ultimo
npm run db:traer -- --archivo=X.sql.gz  # uno que ya este bajado
npm run db:traer -- --sin-registros   # sin activity_log ni originales_scores
npm run db:traer -- --clave=otra      # otra clave para las cuentas locales
npm run db:traer -- --tal-cual        # NO toca las credenciales
```

`--sin-registros` deja fuera las dos tablas de histórico, que son 90 de
los 108 MB de la base y no hacen falta para probar nada del sitio. Las
tablas se crean igual, solo se quedan vacías.

`--tal-cual` existe para cuando haya que depurar la propia migración de
contraseñas. Si se usa, que sea a sabiendas.

El acceso al VPS sale de `docs/VPS.md`; se puede apuntar a otra máquina
con `MR_VPS_HOST` y `MR_VPS_KEY`.

### Por qué hace falta traducir el volcado

`pg_dump` escribe un archivo pensado para `psql`, y PGlite no es `psql`:
lleva metacomandos (`\restrict`) que no son SQL, y vuelca los datos con
`COPY ... FROM stdin` seguido de las filas en el mismo archivo, que
funciona porque `psql` las va mandando por el protocolo. PGlite recibe el
texto de golpe y contesta `syntax error at or near "1"`.

`scripts/base-real.js` parte el volcado en trozos de SQL y bloques de
datos, ejecuta el SQL tal cual y le pasa cada bloque por la vía propia de
PGlite: `COPY ... FROM '/dev/blob'`. Es además mucho más rápido que
convertirlo todo a `INSERT`.

Un detalle que cuesta media hora si no se sabe: el volcado empieza con
`set_config('search_path', '', false)` para que todo vaya calificado con
su esquema, y eso deja la sesión sin `search_path`. Después de cargar hay
que devolverlo a `public` o un `SELECT ... FROM users` a secas contesta
`relation "users" does not exist`.

### De paso, el respaldo que faltaba

La sección 5 de `docs/VPS.md` dice que conviene bajar una copia a otro
lado, porque un respaldo que solo existe en el servidor que respalda no
protege de perder el servidor. `npm run db:traer` deja el `.sql.gz` en
`datos-locales/`, así que cada vez que se usa para probar, de paso
cumple eso.

---

## 9. Los avisos en vivo

Cuando alguien te menciona, te manda una solicitud de amistad o comenta
en tu perfil, eso aparece sin que recargues. Esta sección cuenta cómo, y
por qué la respuesta cambió en septiembre de 2026.

### El problema de fondo

La web funciona a preguntas: el navegador pide, el servidor contesta,
siempre en ese orden. El servidor no puede hablar primero. Para que algo
aparezca solo hace falta una conexión que quede **abierta**, por la que
el servidor pueda escribir cuando tenga algo que contar.

Eso lo hacía **Pusher**, un servicio que alquila esas conexiones. Y no
era un capricho: en Vercel el código del servidor corría en funciones que
viven unos segundos y se apagan, y una función así no puede sostener nada
abierto. Era la única salida posible.

### Por qué llevaba dos semanas roto sin que nadie lo viera

La mudanza al VPS quitó esa limitación: hay un proceso de Node encendido
de forma permanente. Pero nadie lo notó, porque las variables `PUSHER_*`
**nunca se pusieron** en el `.env` del servidor.

`api/_pusher.js` estaba escrito para no romperse si faltaban: devolvía
una instancia muda que aceptaba la orden y no hacía nada. Era una buena
decisión para desarrollo local y resultó ser una trampa en producción.
El sitio pasó dos semanas emitiendo diez avisos al vacío mientras cada
navegador mantenía abierto un WebSocket contra Pusher esperando algo que
no iba a llegar nunca. Ni un error en los logs, ni un síntoma en
pantalla: todo seguía apareciendo, sólo que al recargar.

El comentario del propio módulo decía *"en producción estas variables
SIEMPRE están definidas"*. Una afirmación así, cuando deja de ser cierta,
es exactamente lo que impide encontrar el fallo.

### Lo que hay ahora

Server-Sent Events, servidos por la propia máquina. Cero dependencias
nuevas y dos menos: el paquete `pusher` y el `<script>` de
`js.pusher.com` que cargaban las 22 páginas.

Un SSE es una respuesta HTTP que no se cierra. El navegador pide una vez
y el servidor le va escribiendo líneas:

```
event: nueva-notificacion
data: {"canal":"notificaciones-luis","datos":{"titulo":"Te mencionaron"}}
```

Una línea en blanco cierra cada aviso y una que empieza por `:` es un
comentario que el navegador ignora. Ese es todo el protocolo.

**Se eligió SSE y no WebSocket** porque los diez avisos del sitio van en
una sola dirección, del servidor al navegador. Ninguno va al revés: un
mensaje de chat se manda por una petición normal. Un WebSocket es una
línea de dos direcciones y aquí sobraría la mitad — además de necesitar
una librería en el servidor, que SSE no necesita.

### Las piezas

| Fichero | Qué hace |
|---|---|
| `api/_avisos.js` | El reparto. `avisar(canal, evento, datos)` y el registro de quién escucha qué. No sabe nada de HTTP, que es lo que deja probarlo sin levantar un servidor. |
| `api/_avisos-sse.js` | La cara HTTP: `/api/avisos`, donde el navegador deja la línea abierta. |
| `js/avisos.js` | La mitad del navegador. `MRAvisos.escuchar(canal, evento, fn)`. |
| `api/_auth.js` | El pase de un minuto con el que la línea demuestra de quién es. |
| `js/realtime.js`, `js/perfil-realtime.js`, `js/usuario.js` | Los tres que escuchan. |

`/api/avisos` **no pasa por el despacho de `/api/` de `server.js`**: ese
despacho junta el cuerpo entero de la petición y contesta de una sola vez
con un `res` simulado. Aquí hace falta lo contrario, el `res` de verdad y
no cerrarlo, así que se intercepta antes.

### El detalle que lo complica: dos procesos

`cluster.js` arranca dos copias de `server.js`. La conexión abierta de
una persona la sostiene **una sola** de ellas, y el aviso puede generarse
en la otra, que no la tiene y no puede alcanzarla. El propio `cluster.js`
lo dejó advertido: *"si algún día se guarda algo en memoria y se espera
que persista, dejará de serlo"*.

Se resuelve sin añadir nada: Postgres trae `LISTEN`/`NOTIFY`. Quien
genera el aviso hace `NOTIFY`, los dos procesos escuchan, y el que
sostiene la conexión la atiende. Hace falta una conexión `pg` **propia**
y no una del pool: un `LISTEN` vive en la conexión que lo declara, y una
del pool vuelve al pool en cuanto termina la consulta.

Sin puente —en los tests, o con un solo proceso— la entrega dentro del
proceso es la entrega completa, y es correcta. Por eso `npm run db:local`
funciona igual sin configurar nada.

### Los límites, y por qué están

Antes este riesgo lo absorbía Pusher; ahora lo absorbe una máquina de
950 MB.

- **400 conexiones por proceso.** Pasado eso, un 503 con `Retry-After`.
- **4 canales por conexión.** `js/usuario.js` necesita dos; sin tope, una
  URL escrita a mano apunta una conexión a mil canales.
- **1 MB pendiente por conexión.** Si el navegador deja de leer —pestaña
  congelada, red muerta— Node acumula en memoria lo que no puede
  entregar. Pasado ese tamaño se corta esa conexión; el navegador
  reconecta solo.
- **8000 bytes por aviso**, que es el tope de `NOTIFY`. Si uno se pasa,
  viaja sin contenido: casi todas las escuchas del navegador lo ignoran y
  vuelven a pedir lo que necesitan.

### Tres cosas que no son adorno

**`X-Accel-Buffering: no`.** Sin esa cabecera nginx acumula la respuesta
en su buffer y no suelta un byte hasta que termine — y ésta no termina.
El bloque `location = /api/avisos` de `infra/nginx/macroreborn.conf`
repite lo mismo con `proxy_buffering off`: van las dos porque una es la
intención del programa y la otra la del sitio, y el día que ese bloque se
pierda en una reinstalación la cabecera lo salva.

**Un latido cada 25 segundos.** `proxy_read_timeout` corta la conexión a
los 60 segundos sin datos, y además es la única forma de enterarse de que
el navegador se fue sin avisar.

**El `retry` se reparte al azar entre 5 y 10 segundos.** Al reiniciar el
servicio se caen todas las conexiones a la vez; con un valor fijo
volverían todas al mismo segundo.

### Lo que el navegador tiene que hacer y no es evidente

`EventSource` reconecta solo cuando se corta la red, pero **se rinde para
siempre** si el servidor contesta algo que no sea un 200 — por ejemplo el
503 de "este proceso está lleno". Sin un reintento a mano, esa pestaña se
queda muda hasta que alguien recargue, y nada en pantalla lo diría.
`js/avisos.js` distingue los dos casos por `readyState`: `CONNECTING` es
el navegador ya ocupándose, `CLOSED` es que se rindió.

Y como esto **no es un bus con historia** —lo que no se entregó no se
guarda en ningún sitio— quien vuelve de una caída tiene que volver a
pedir. De ahí `MRAvisos.alReconectar()`, que los tres ficheros usan para
repescar la campanita, los comentarios, la actividad y los logros.

### Quién puede oír qué

Por el canal de una persona viajan siete avisos, y no todos son de la
misma naturaleza. Dos son suyos y de nadie más: `nueva-notificacion`
lleva dentro el título y el texto de lo que acaba de llegar al buzón, y
`estado-bloqueo` dice quién la bloqueó o desbloqueó. Los otros cinco son
lo que su perfil ya enseña a cualquiera que lo abra, con cuenta o sin ella.

Hasta el 21 de septiembre de 2026 los siete salían por cualquier línea:
bastaba pedir `notificaciones-fulano` sin cuenta para leer el buzón de
fulano en vivo. El nombre del canal era público a propósito desde los
tiempos de Pusher, cuando el aviso era un toque sin contenido; al
sustituirlo, la notificación entera empezó a viajar dentro y nadie volvió
a mirar quién escuchaba.

Ahora la línea sigue sin pedir sesión para abrirse, porque un visitante
anónimo mirando un perfil tiene que seguir viendo los comentarios al
vuelo. Lo que cambia es que los dos avisos privados **solo salen por la
línea que demostró ser de su dueño**.

Demostrarlo tiene truco: `EventSource` no puede mandar cabeceras, así que
la línea no puede llevar la sesión como el resto de la API, y meter el
token de siete días en la URL lo dejaría en el registro de nginx durante
dos semanas. En su lugar, `js/avisos.js` pide primero un **pase de un
minuto** por `/api/content?action=avisos-pase`, con la cabecera de
siempre, y abre la línea con `&pase=...` en la URL. El pase lleva la
misma firma que la sesión pero un `uso` que la sesión rechaza y el pase
exige: ninguno vale por el otro (`api/_auth.js`, "EL PASE").

Pase malo o caducado: 401. Es 401 y no 403 a propósito: `EventSource` se
rinde ante cualquier código que no sea 200, y el reintento a mano de
`js/avisos.js` entiende esa rendición como "pide otro pase y vuelve".

### Cómo probarlo

Automático, con `npm run test:smoke`: abre la conexión como un navegador,
dispara un latido y comprueba que el aviso llega por la línea. Es lo
único que ejercita la cadena entera; las suites prueban cada pieza por
separado.

A mano:

1. `npm run db:local` y entrar como `demo` / `demo1234`.
2. Abrir DevTools → Network, filtrar por `avisos`. Debe aparecer **una**
   petición a `/api/avisos?canales=notificaciones-demo&pase=...` en estado
   pendiente, que no termina. Una sola, aunque la página cargue varios
   ficheros que escuchan.
3. En la pestaña Response se ve llegar `: latido` cada 25 segundos.
4. Sin haber entrado, en la portada esa petición **no** debe existir:
   quien no tiene sesión no abre conexión allí. En un perfil sí se abre,
   sin `pase`, para repintar comentarios y actividad al vuelo.
5. Justo antes de la línea tiene que verse una petición a
   `/api/content?action=avisos-pase` que devuelve el pase. Sin sesión,
   esa petición contesta 401.
6. Desde una terminal, `curl -N "http://localhost:3001/api/avisos?canales=notificaciones-demo"`
   deja una línea anónima abierta sobre el canal de demo. Mandarle una
   notificación a demo desde otra cuenta: por esa línea no debe llegar
   nada, y en la pestaña de demo sí. Un comentario en el perfil de demo,
   en cambio, llega por las dos.

# AUDITORÍA — lo que hay por arreglar

Lista viva de todo lo que se encontró en la auditoría del 18 de
septiembre de 2026. No es un informe cerrado: es la lista de trabajo. Se
marca aquí lo que se va haciendo y se añade aquí lo que se va
encontrando.

---

## Cómo se usa

**Marcar algo como hecho:** se escribe la fecha en la columna Estado.
Nunca se borra la fila ni se cambia su número, aunque quede resuelta.
Una fila resuelta con su fecha explica por qué el código está como está;
una fila borrada deja un hueco que nadie sabe interpretar seis meses
después. (`docs/VPS.md` §10 ya contó lo que pasa cuando se borran puntos
de una lista numerada sin renumerar: no hay forma de saber si se
hicieron o se perdieron.)

**Añadir algo nuevo:** al final del bloque que le corresponda, con el
siguiente número libre. Los números no se reutilizan aunque se borre
algo.

**Estado:** `-` mientras esté pendiente, o la fecha en formato
`2026-09-18` cuando esté hecho. Si se decide no hacerlo, `descartado` y
una nota al pie explicando por qué.

**El orden es de importancia, no de ejecución.** Mezcla daño potencial,
probabilidad y coste de no arreglarlo. Dentro de un bloque se puede
hacer en cualquier orden.

---

## Cómo se hizo la auditoría

Catorce revisiones en paralelo, en dos rondas, más una auditoría del
servidor en vivo por SSH. Lo que aparece aquí está verificado contra
producción el 18 de septiembre de 2026: las afirmaciones con números
salen de consultas a la base real o de peticiones reales al sitio, no de
leer el código y suponer.

Algunas cifras de referencia de ese día, para que se pueda medir si algo
mejoró: 144 cuentas (141 personas), 271.626 partidas de Macro Snake,
277.000 filas en `activity_log`, entre 300.000 y 1.400.000 peticiones
diarias con unos 500 visitantes únicos, y la base en 127 MB.

---

## Bloque 1 — Urgente

Los catorce primeros suman una tarde de trabajo entre todos, y son los
que pueden costar una cuenta de usuario o el sitio entero.

| # | Estado | Categoría | Qué pasa | Dónde | Esfuerzo |
|---|---|---|---|---|---|
| 1 | - | Seguridad | 109 de 113 juegos se sirven desde el propio origen, sin `sandbox`. 177 referencias a ramas mutables de GitHub pueden leer el token de sesión de quien juega | `js/jugar.js:60` | 1 tarde + probar juegos |
| 2 | - | Seguridad | XSS en los reportes: `contentTexto` es texto libre y se pinta sin escapar dentro del navegador de un administrador | `js/admin.js:583` | 30 min |
| 3 | - | Seguridad | `/api/avisos` no pide sesión: cualquiera lee en vivo las notificaciones y la presencia de cualquiera | `api/_avisos-sse.js:71` | 1 h |
| 4 | - | Seguridad | XSS almacenado en la biografía: se ejecuta en todo el que abra la comunidad | `js/comunidad-ranking.js:398` | 15 min |
| 5 | - | Seguridad | XSS dirigido por notificación: cualquiera se la manda a quien quiera | `js/notificaciones.js:179` | 15 min |
| 6 | - | Seguridad | No hay `Content-Security-Policy` en ninguna parte. Es la red que falta bajo los cuatro anteriores | nginx | 1 h |
| 7 | - | Seguridad | Cualquier usuario borra cualquier mensaje del chat omitiendo el campo `username` | `api/content.js:1217` | 10 min |
| 8 | - | Seguridad | Cualquier usuario borra todas las notificaciones de otro | `api/content.js:1270` | 10 min |
| 9 | - | Seguridad | Se puede firmar un comentario con el nombre de otra persona | `api/content.js:947` | 15 min |
| 10 | 2026-09-18 | Seguridad | `GET /%C0%80` tumba el proceso: `decodeURIComponent` sin `try/catch` | `server.js:249` | 10 min |
| 11 | 2026-09-18 | Seguridad | La barra de más expone el arte: `/imagenes//tora/pelo3.png` devuelve 200. Mismo arreglo que el 10 | `server.js:249` | incluido en el 10 |
| 12 | - | Seguridad | El token vive 7 días en `localStorage`, sin revocación. Cerrar sesión no lo invalida | `api/_auth.js:3` | 1 día |
| 13 | - | Infraestructura | 75 commits solo existen en el PC y en el VPS. GitHub está en el 15/09 | — | 2 min |
| 14 | - | Decisión | El repositorio es público: 630 prendas descargables con `git clone`. Anula todo lo que promete `docs/ARTE.md` | GitHub | decisión |

---

## Bloque 2 — Funciones que existen y no funcionan

Esto es lo que hace que el sitio parezca a medias, más que cualquier
cambio visual: son cosas que los usuarios creen que ya tienen.

| # | Estado | Categoría | Qué pasa | Dónde | Esfuerzo |
|---|---|---|---|---|---|
| 15 | - | Función rota | Las rachas diarias nunca han subido. Las 17 personas con racha tienen racha 1. Son dos mitades: arreglar solo la primera no basta | `api/progreso.js:182` y `:187` | 30 min |
| 16 | - | Moderación | Las advertencias no llegan a nadie. 4 registradas, 0 entregadas. El panel afirma que sí se enviaron | `js/admin.js:102` | 1 h |
| 17 | - | Moderación | Suspender no hace nada: el servidor nunca consulta `suspendido`, ni siquiera al iniciar sesión | `api/_auth.js:70` | 2 h |
| 18 | - | Economía | El XP y los minutos se conceden por número de peticiones, no por tiempo verificado. Los tres primeros del ranking tienen minutos imposibles | `api/users.js:542` | 1 día |
| 19 | - | Economía | Macro Snake paga XP por muerte. Una cuenta generó 265.605 de las 271.626 partidas | `html/juegos/macro-snake.js:17` | 2 h |
| 20 | - | Función rota | `explorar.html` está vacía para todos: lee `window.juegos` y `datos-juegos.js` declara un `const`, que no cuelga de `window` | `js/explorar.js:14` | 10 min |
| 21 | - | Contenido | 15 de 113 juegos no cargan. El usuario ve una pantalla negra sin mensaje | `js/datos-juegos.js` | 2 h |
| 22 | - | Contenido | Un juego roto por una errata de un carácter: `fairytail` frente a `fairytale` | `js/datos-juegos.js:894` | 1 min |
| 23 | - | Función rota | La tienda muestra 12 cajas vacías con precio. 130 de 152 artículos no tienen dibujo en el índice público | `js/comunidad-ranking.js:617` | 2 h |
| 24 | - | Función rota | Se puede comprar una prenda retirada y no poder ponérsela nunca | `api/content.js:2367` | 1 h |
| 25 | - | Economía | 3 de 7 misiones diarias piden `minutes_today`, métrica que el servidor nunca calcula. 14 días de cada 31 son incompletables | `api/progreso.js:28` | 3 h |
| 26 | - | Economía | El reto global anuncia 500 XP y 250 monedas que ningún código reparte | `api/progreso.js:60` | 2 h |
| 27 | - | Función rota | No hay botón para rechazar ni cancelar una solicitud de amistad. El backend existe desde la fase 1 | `js/amigos.js:237` | 2 h |
| 28 | - | Función rota | El panel "Tus amigos jugaron esto" nunca aparece: lee un global que solo define la copia duplicada de la raíz | `portal-growth.js:106` | 15 min |
| 29 | - | Función rota | El chat anunciado "en tiempo real" no se actualiza solo: nadie emite evento de mensaje nuevo | `js/chat.js:411` | 3 h |
| 30 | - | Función rota | 12 usuarios no son mencionables porque la regex no cubre sus nombres. El botón Responder inserta la arroba igual | `api/_notifications.js:47` | 1 h |
| 31 | - | Datos | Dos personas no pudieron entrar y se registraron de nuevo: `jader`/`Jader` y `yotter`/`Yotter`. El registro compara exacto y `getUserId` con `LOWER()` | `api/_utils.js:15` | 2 h |
| 32 | - | Función rota | El guardado del avatar se traga todos los errores del servidor: el editor se cierra igual y no dice nada | `js/perfil.js:1065` | 30 min |
| 33 | - | Función rota | El "top 20" de Macro Snake muestra dos o tres personas: deduplica por usuario después del `LIMIT` | `api/originales-ranking.js:29` | 30 min |
| 34 | - | Economía | La puntuación la fija el cliente hasta 1.000.000.000, sin validar que sea múltiplo de 10 ni el tiempo transcurrido | `api/originales-ranking.js:70` | 1 h |
| 35 | - | Economía | Nivel 1 más 400 XP da nivel 2 por una puerta y nivel 3 por otra. `xp = 0` descarta el excedente | `api/users.js:526` | 1 h |
| 36 | - | Economía | Más de dos tercios del ranking se baraja al azar cada lunes: el `SELECT` no lleva `ORDER BY` y el desempate no rompe los ceros | `api/system.js:262` | 30 min |

---

## Bloque 3 — Que el sitio se sienta terminado

El 37 es el que más deuda desactiva por hora invertida: casi todo lo que
hace que MacroReborn parezca inacabado es ausencia de chasis, no
fealdad. En cuanto las 28 páginas compartan las mismas hojas en el mismo
orden, la mayoría de los `!important` del punto 44 dejan de tener razón
de ser, y los puntos 38, 40, 41 y 42 caen dentro de esa misma tarea.

| # | Estado | Categoría | Qué pasa | Dónde | Esfuerzo |
|---|---|---|---|---|---|
| 37 | - | Visual | No hay chasis de página: el buscador está en 10 de 28 páginas y el pie en 14 de 28 | las 28 `.html` | 1 semana |
| 38 | - | Visual | 12 páginas no cargan `js/tema.js`: se elige el tema claro, se navega, y vuelve a oscuro sin avisar | 12 `.html` | 1 h |
| 39 | - | Visual | El modo claro es otra marca: una segunda paleta azul corriendo a la vez que la clara real de `inicio.css` | `css/theme-canonical.css` | 3 h |
| 40 | - | Visual | El botón de menú móvil es invisible en modo claro: `.nav-toggle-label` no tiene ninguna regla CSS en todo el proyecto | `js/nav-toggle.js:30` | 30 min |
| 41 | - | Visual | En móvil, el modo claro es una trampa sin salida: el conmutador de tema cuelga de un contenedor oculto | `js/tema.js` | 1 h |
| 42 | - | Accesibilidad | `finalizacion.css` (foco visible, movimiento reducido, 16 px en controles móviles) solo está en 14 de 28 páginas | 14 `.html` | 30 min |
| 43 | - | Visual | 5 páginas llevan dos barras de navegación apiladas. En móvil eso es el 45 % de la pantalla antes del contenido | 5 `.html` | 3 h |
| 44 | - | Visual | 382 colores distintos, 102 tamaños de fuente, 116 sombras, 1.102 `!important` y 9 vocabularios de variables para los mismos seis conceptos | `css/` | 2-3 semanas |
| 45 | - | Contenido | La portada muestra 30 tarjetas con 15 juegos únicos: las cinco estanterías no deduplican entre sí | `js/home-portal.js:145` | 1 h |
| 46 | - | Contenido | 26 de las 30 chapas dicen "Nuevo", porque 112 de 113 juegos tienen `estado: "Nuevo"` y los 113 tienen `tipo: "destacado"` | `js/datos-juegos.js` | 1 h |
| 47 | - | Visual | 34 `alert()`, 21 `confirm()` y 8 `prompt()` nativos, con `MRModal` ya escrito y sin usar en ninguna parte | `js/` | 1 día |
| 48 | - | Seguridad | La contraseña para borrar la cuenta se pide con `prompt()`, en claro y sin enmascarar | `js/perfil-eliminar-cuenta.js:76` | 30 min |
| 49 | - | UX | No hay página 404: texto plano sobre fondo negro, sin título ni enlace de vuelta | `server.js` | 1 h |
| 50 | - | UX | `/juego.html?id=99999` devuelve 200 y se queda en "Cargando..." para siempre, con la página indexable | `js/juego.js:298` | 30 min |
| 51 | - | UX | Un usuario inexistente lanza un `alert()` bloqueante y luego inventa un perfil que dice "Has sido bloqueado por este usuario" | `js/usuario.js:129` | 1 h |
| 52 | - | Contenido | Tuteo y voseo mezclados en la misma pantalla, "1 juegos", textos de 9 px y placeholders cortados a media palabra | varias | 2 h |
| 53 | - | Rendimiento | El editor de avatares reconstruye el DOM entero en cada `pointermove`, sin `requestAnimationFrame` | `js/arte-vestidor.js:1548` | 3 h |

---

## Bloque 4 — Contenido, SEO, privacidad y moderación

| # | Estado | Categoría | Qué pasa | Dónde | Esfuerzo |
|---|---|---|---|---|---|
| 54 | - | SEO | Las 112 fichas de juego comparten título, descripción y `canonical`. Ese `canonical` sin `?id=` las declara duplicados de una sola página | `juego.html` | 3 h |
| 55 | - | SEO | `www` y el dominio raíz responden 200 los dos, sin redirección, mientras todo el SEO apunta a `www` | nginx | 15 min |
| 56 | - | SEO | 9 páginas públicas sin `canonical`, `robots` ni Open Graph. Macro Snake no está en el sitemap | 9 `.html` | 2 h |
| 57 | - | Privacidad | `motivo_suspension`, `last_login` y `monedas` de los 144 usuarios, públicos y sin sesión | `api/users.js:178` | 1 h |
| 58 | - | Privacidad | La lista de a quién bloqueó cada persona es pública | `api/social.js:533` | 30 min |
| 59 | - | Privacidad | El chat, los muros y la actividad completos son legibles sin cuenta, y el filtro de bloqueo se apaga omitiendo un parámetro | `api/content.js` | 3 h |
| 60 | - | Decisión | No hay política de privacidad, ni edad mínima declarada, ni enlace a los términos desde el registro | `terminos.html` | decisión |
| 61 | - | Decisión | No hay recuperación de cuenta. Sin correo, quien olvida la contraseña la pierde, y no hay forma de distinguir al titular de un impostor | — | decisión |
| 62 | - | Privacidad | Analítica de terceros (6 identificadores de GA y GTM ajenos) escribiendo cookies en el dominio propio desde los envoltorios de juego | `html/juegos/` | 1 h |
| 63 | - | Moderación | Bloquear no impide solicitudes de amistad, ni ver el perfil, ni aparecer en el feed global | `api/social.js:121` | 3 h |
| 64 | - | Moderación | Los colaboradores pueden leer y escribir el registro de moderación, aunque `js/motor/permisos.js:81` diga que ese rol no otorga permisos | `api/content.js:2239` | 30 min |
| 65 | - | Moderación | El registro de moderación lo escribe el navegador después de la acción y se puede falsear. El filtro por rol nunca encuentra nada por una diferencia de mayúsculas | `api/content.js:2277` | 3 h |
| 66 | - | Moderación | No se puede silenciar temporalmente, ni borrar contenido sin pasar por un reporte, ni deshacer una acción, ni ver la ficha de una persona | `admin.html` | 1 semana |

---

## Bloque 5 — Datos, rendimiento y mantenibilidad

| # | Estado | Categoría | Qué pasa | Dónde | Esfuerzo |
|---|---|---|---|---|---|
| 67 | - | Datos | `migrations/` no puede reconstruir el sitio: ninguna migración crea la tabla `users`, y aplicarlas en limpio falla en el primer archivo | `migrations/` | 2 h |
| 68 | - | Datos | 271.700 de las 277.000 filas de `activity_log` no las lee nadie, y `originales_scores` guarda cada partida en vez de la mejor | `activity_log`, `originales_scores` | 3 h |
| 69 | - | Rendimiento | `comunidad-ranking.html` pide 201 recursos y 2,4 MB en la carga inicial, con `/api/users?limit=500` pedido dos veces | `js/comunidad-ranking.js` | 3 h |
| 70 | - | Rendimiento | Un solo avatar PNG ocupa 1.313 kB de los 1.349 kB de la columna. Tres endpoints públicos lo siguen mandando entero | `api/system.js`, `api/originales-ranking.js` | 1 h |
| 71 | - | Infraestructura | Nada vigila nada: sin monitorización, sin registro de errores de la aplicación, 16 líneas de log en 24 horas | VPS | 1 día |
| 72 | - | Infraestructura | El despliegue no tiene comprobación de salud ni vuelta atrás, y las 595 pruebas no han visto ninguno de los 75 commits que están en producción | `infra/scripts/` | 1 día |
| 73 | - | Mantenibilidad | 19 copias de la función de escapar HTML en 3 variantes distintas, y `xpNecesaria` copiada en 7 archivos | `js/` | 1 día |
| 74 | - | Mantenibilidad | Cero pruebas de autorización, del ranking, de moderación y de todo el sistema social | `tests/` | 2-3 días |

---

## Lo que está bien, y conviene no romper

La auditoría también dejó claro qué piezas están resueltas. Antes de
tocar algo de aquí, conviene saber que ya se pensó:

- **No hay inyección SQL.** Se revisó toda la interpolación: `api/_pg.js`
  parametriza cada valor, los fragmentos anidados son literales del
  propio código y no hay ningún `ORDER BY` construido con entrada del
  usuario.
- **Las contraseñas están terminadas.** 144 de 144 con bcrypt, cero en
  texto plano. El backfill de `docs/SEGURIDAD.md` acabó.
- **`api/_monedas.js` es el modelo a copiar.** Resuelve el otorgamiento en
  una sola sentencia condicionada contra el `now()` de Postgres, no
  contando peticiones. Es la única pieza del sitio que hoy no se puede
  falsear, y es exactamente el patrón que necesitan los puntos 18 y 34.
- **`infra/` está sincronizado con el servidor.** Se compararon los siete
  archivos: seis idénticos, y la única diferencia es el marcador
  `TU.IP.AQUI`, que está bien puesto a propósito para no publicar la IP
  del administrador.
- **El servidor está sano.** Sin errores 5xx, sin eventos OOM en 30 días,
  certificado renovándose solo, `ufw` cerrado, Postgres solo en
  `127.0.0.1`, y respaldos diarios cuya integridad se verificó.
- **La lista blanca de estáticos aguanta.** Se probaron diez rutas
  sensibles (`/.env`, `/.git/config`, `/server.js`, `/api/_db.js` y seis
  más) y las diez dan 404. El único hueco es el del punto 11, que es de
  normalización de ruta, no de la lista.

# AVATARES EN EL SERVIDOR — el plan

Decidido el 21 de septiembre de 2026. El navegador deja de recibir las
prendas sueltas y recibe **una sola imagen ya compuesta**, una por
avatar, hecha por el servidor y regenerada cuando esa persona cambia de
ropa. Más una previsualización por prenda, para poder verla antes de
comprarla.

Es lo que hacía macrojuegos durante una década. Está reconstruido en la
memoria del proyecto y resumido en `docs/ARTE.md` 6.

Este archivo es la lista de trabajo. Se marca aquí lo que se va
haciendo, con la fecha, y no se borran filas: una fila resuelta explica
por qué el código está como está.

---

## 1. Por qué, y por qué ahora

`docs/ARTE.md` 6 descartó esto en septiembre con un argumento que era
correcto entonces: *"media implementación no deja a mitad de camino:
deja en cero, con el trabajo hecho"*. Componer el avatar y seguir
sirviendo las prendas sueltas al vestidor no compra nada, porque la
puerta sigue abierta.

Lo que ha cambiado es un dato que entonces no teníamos: **el editor de
todos los días es un selector, no un lienzo.**

El que deja mover, escalar y espejar prendas es `js/arte-vestidor.js`, y
vive en `taller.html`, que es la herramienta del equipo de arte. El de la
gente está en `perfil.html` y solo elige una prenda por capa. Lo confirma
la base: de 117 avatares, **cero** llevan transformaciones.

Eso es lo que hace viable el plan. Si la gente pudiera arrastrar prendas,
cada movimiento necesitaría un viaje al servidor y no habría discusión
posible.

---

## 2. Lo medido el 21/09/2026

Todo sobre el VPS real, un ARM de dos núcleos con 950 MB, no estimado.

**Qué hay que componer**

| | |
|---|---|
| Avatares puestos | 117 de 181 cuentas |
| Avatares guardados en ranuras | 98, de 65 personas |
| Capas por avatar | 11,5 de media, 15 como máximo |
| Avatares con capa de fondo | 111 de 117, y 89 de 98 en ranuras |
| Prendas en el catálogo | 768, cada una de un solo modelo |

**Cuánto cuesta componer uno**

| Fase | Tiempo |
|---|---|
| Descomprimir los PNG de las capas | 88 ms |
| Mezclar las capas | 23 ms |
| Comprimir a JPG | unos 40 ms en ARM |
| **Total** | **unos 150 ms** |

Irrelevante, porque se compone **al guardar** y no al mirar. Rehacer los
215 que existen hoy son 30 segundos de CPU, una vez.

**Cuánto pesa la salida, sobre tres avatares reales**

| Tamaño | PNG | JPG calidad 80 |
|---|---|---|
| 327×504 | 91 kB | 56 kB |
| 62×96 | 13 kB | 4 kB |

**Lo que gana la página de comunidad**, que hoy pinta 181 tarjetas:

| | Bytes |
|---|---|
| Hoy: 339 archivos de capa distintos | 5.562 kB |
| 117 compuestos a 62×96 en JPG | **468 kB** |

Un 92 % menos. Y esto vale por sí solo, aunque no hubiera nada que
proteger: hoy se mandan 5,5 MB de capas a tamaño completo para pintar
avatares de 35 a 46 píxeles.

A tamaño completo el compuesto **pierde**: 117 × 56 kB son 6.552 kB
contra los 5.562 de hoy, porque las capas se repiten entre personas y se
cachean una sola vez, y un compuesto es único. Por eso importa servir
cada tamaño en su sitio.

---

## 3. Lo que se decidió

| Qué | Decisión |
|---|---|
| Formato | **JPG**. No hace falta transparencia y pesa la mitad |
| Calidad | 80. A 88 pesa un 30 % más sin verse mejor |
| Tamaños | 62×96 para listas, 327×504 para el perfil |
| Sin capa de fondo | PNG, porque sin fondo sí hace falta alfa. Son 6 de 117 |
| Codificador | `jpeg-js`: JavaScript puro, cero dependencias, sin binario nativo |
| Dónde se guardan | **En disco**, no en Postgres. Ver 4 |
| Cuándo se componen | Al guardar el avatar |
| Nombre del archivo | La huella de la receta, así que se cachea un año |
| Avatares en ranuras | También se componen |
| Previsualizaciones | La prenda puesta sobre un modelo vacío, recortada a su zona |
| El taller | Sigue recibiendo las prendas sueltas, con sesión y permiso |
| La caché al cerrar | Se invalida entera. Decidido que da igual |

**La previsualización, en las palabras que la definen:** como en un
videojuego. Si es pelo, un recorte de la cabeza con ese pelo puesto. Si
es una camisa, un recorte del torso con la camisa puesta. Nunca la
prenda sola sobre transparente, porque eso es regalar el catálogo otra
vez.

---

## 4. Por qué en disco y no en Postgres

Postgres reserva un trozo de memoria para tener a mano las páginas de la
base que ha leído hace poco. Aquí son **128 MB** (`shared_buffers`), y la
base entera mide **127 MB**. O sea que cabe justa: hoy el 100 % de las
lecturas salen de memoria y ninguna del disco, y por eso el sitio va
rápido en una máquina tan pequeña.

El día que la base pase de 128 MB eso no se degrada poco a poco: se cae
de golpe. Una consulta que tardaba microsegundos empieza a tardar
milisegundos porque tiene que ir al disco.

Los compuestos serían unos 23 MB para los usuarios de hoy. Metidos en
Postgres, cruzan la línea. En disco no la rozan: hay 56 GB libres.

Y hay una razón mejor que el tamaño. El arte **es la fuente** y vive en
la base, que se respalda cada noche. Un compuesto es **derivado**: se
puede rehacer desde la fuente en 150 ms. Lo derivado no necesita
respaldo, y encima nginx sirviendo un archivo del disco es mucho más
barato que Node leyendo una fila.

De paso, para cuando haga falta: de esos 127 MB, 91 son
`originales_scores` (50 MB) y `activity_log` (41 MB), dos tablas que casi
nadie lee. Es el punto 68 de la auditoría, y limpiarlo devolvería la base
a unos 36 MB.

---

## 5. Las fases

Cada una se despliega sola y se puede deshacer sola. El orden importa:
la protección no existe hasta la fase 5, y las cuatro anteriores no
rompen nada mientras tanto.

| # | Estado | Fase | Qué entra | Rompe algo |
|---|---|---|---|---|
| 1 | - | El compositor | `api/_compositor.js`, `jpeg-js`, tests. No se enchufa a nada | No |
| 2 | - | Guardar y servir | Migración, `/avatares/<huella>/<tam>.jpg`, gancho al guardar, relleno de los 215 que ya existen | No |
| 3 | - | Las listas | Los diez archivos que pintan avatares pasan a la URL del compuesto | No |
| 4 | - | Las previsualizaciones | 768 recortes sobre modelo vacío, para editor y tienda | No |
| 5 | - | Cerrar la puerta | `/prendas/` deja de servir a nadie salvo al taller | Sí, a propósito |

### Fase 1 — El compositor

Un módulo que recibe una receta y devuelve bytes. No sabe de HTTP, no
sabe de la base, y por eso se puede probar sin levantar nada. Mismo
criterio que `api/_avisos.js`.

- `api/_compositor.js`: mezcla alfa de las capas en orden, aplanado
  sobre un color cuando toca, reducción por área y salida en JPG o PNG.
- El orden de capas sale de un solo sitio. Hoy `ORDEN_CAPAS_AVATAR` está
  en `js/core.js` y copiado en varios más, y ya hubo una vez en que dos
  copias diferían y el mismo avatar se dibujaba distinto según la página.
- `jpeg-js` entra en `dependencies`.
- `tests/compositor.test.js`: el orden, el alfa, el aplanado, los
  tamaños, y que la misma receta dé siempre los mismos bytes.

### Fase 2 — Guardar y servir

- Migración: una columna con la huella del compuesto en `users` y en
  `saved_avatars`. Nada de imágenes en la base.
- Los archivos van a `~/avatares/<huella>/<tam>.jpg`, fuera del
  repositorio para que un despliegue no los toque. La ruta se configura
  con `MR_AVATARES_DIR` para que el servidor local use la suya.
- La huella es el `sha256` de la receta: la lista ordenada de capas con
  la huella del archivo de cada prenda. Cambia exactamente cuando
  cambiaría el dibujo, ni antes ni después. Dos personas con el mismo
  avatar comparten archivo sin que nadie lo programe.
- Ruta `/avatares/<huella>/<tam>.jpg` en `server.js` y en
  `scripts/servidor-local.js`, del mismo módulo y no copiada.
- nginx la sirve del disco, un año, `immutable`.
- Gancho al guardar el avatar y al guardar una ranura.
- Un script de relleno para los 215 que ya existen, y que se pueda
  volver a correr sin duplicar nada.

### Fase 3 — Las listas

Aquí es donde se gana el 92 %. Los endpoints devuelven la URL del
compuesto junto al avatar, y los archivos que hoy arman quince
etiquetas `img` pintan una sola.

Son al menos diez: `core.js`, `comunidad-ranking.js`,
`actividad-comunidad.js`, `amigos.js`, `buscador.js`, `chat.js`,
`explorar.js`, `home-portal.js`, `perfil-actividad.js`,
`perfil-avatares-galeria.js`, `usuario.js` y `portal-growth.js`.

### Fase 4 — Las previsualizaciones

768 imágenes, una por prenda, con la prenda puesta sobre su modelo
vacío y recortada a su zona.

El recorte de cada capa **no se inventa a ojo**: se calcula del propio
arte, tomando la caja que ocupa el dibujo de todas las prendas de esa
capa y uniéndolas. Así el recorte de "pelo" sale de dónde está el pelo
de verdad.

Esta fase arregla de paso el punto 23 de la auditoría: las 134 cajas
vacías de la tienda dejan de estarlo. Son el mismo trabajo.

### Fase 5 — Cerrar la puerta

`/prendas/<huella>.png` deja de responder salvo con sesión y con
insignia de administrador o de equipo de arte, que es lo que el taller
necesita. Se invalidan los 12 MB de caché de nginx y las copias de cada
navegador. Decidido que no importa.

---

## 6. Lo que esto NO compra, dicho antes de que sorprenda

**La resta de dos composiciones.** Si pido mi avatar con una prenda y sin
ella y resto las dos imágenes, obtengo la prenda. Con PNG sale exacta.
Con JPG sale sucia, porque la compresión con pérdida mete ruido, y por
eso macrojuegos servía JPG y por eso lo servimos nosotros. Sucia no es
imposible: es recuperable con esfuerzo y con calidad peor.

**El alcance del ataque es lo que de verdad lo limita.** Solo se puede
componer lo que uno posee. Para sacar el catálogo entero por esta vía
habría que comprar las 768 prendas.

**Salvo por las previsualizaciones**, que enseñan prendas que no tienes.
Ahí la defensa es el recorte: una previsualización es un trozo pequeño
sobre un modelo, no la capa completa sobre transparente. Restarle el
modelo vacío da el trozo de la prenda que se ve en ese recorte, en JPG y
recortado. Es lo mismo que compraba macrojuegos, y es mucho, pero no es
un candado.

**Lo que sí es un candado** es que el archivo original del artista, a
327×504 y con su alfa intacto, deja de salir del servidor. Eso hoy se
baja entero con una petición.

---

## 7. Lo que muerde si no se sabe

- **El taller es la excepción a propósito.** `taller.html` seguirá
  recibiendo prendas sueltas, con sesión y permiso. Es el único agujero
  que queda abierto, y queda abierto porque el equipo de arte no puede
  trabajar de otra forma.
- **JPG no tiene alfa.** Los 6 avatares sin capa de fondo salen en PNG.
  Si algún día se decide que todos lleven fondo, eso desaparece.
- **El orden de las capas tiene que salir de un solo sitio.** Está
  copiado en varios archivos y ya hubo un caso en que dos copias no
  coincidían.
- **`avatar_catalogo_version` ya existe** y sirve para saber cuándo el
  catálogo cambió. La huella de la receta lo hace innecesario para
  invalidar, pero sigue siendo el modo barato de detectar un rehorneado.
- **Rehornear la autoría cambia el `sha256` de cada prenda**, y por tanto
  la huella de cada receta que la use. Después de un rehorneado hay que
  volver a componer. Es el mismo aviso que ya daba `docs/ARTE.md` 2.

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
| Comprimir a JPG | 45 ms |
| **Total** | **156 ms de media, sobre diez avatares reales** |

Irrelevante, porque se compone **al guardar** y no al mirar. Rehacer los
215 que existen hoy son 34 segundos de CPU, una vez.

**Cuánto pesa la salida**, medido sobre diez avatares reales:

| Tamaño | PNG | JPG calidad 80 |
|---|---|---|
| 327×504 | 91 kB | 36 kB de media |
| 62×96 | 13 kB | 4 kB |


**Cuánto cambia el dibujo al pasar por JPG de calidad 80.** Medido
comparando el compuesto exacto contra el JPG decodificado, canal por
canal, sobre seis avatares reales:

| | |
|---|---|
| Desviación media | de 0,31 a 3,96 sobre 255 |
| Desviación máxima | de 27 a 75 |
| Píxeles que se desvían más de 16 | del 0,01 % al 2,54 % |

La media es imperceptible. El máximo no lo es, y está donde se espera:
en los bordes duros del trazo, que es el punto flojo de JPG y abunda en
un dibujo de línea. Ese 0,5 % a 2,5 % de píxeles es lo que hay que mirar
de cerca antes de dar la calidad por buena. Subir a 92 lo reduce y pesa
un 60 % más; `npm run revision:avatares -- --calidad 92` deja verlo.
**Lo que gana la página de comunidad**, que hoy pinta 181 tarjetas:

| | Bytes |
|---|---|
| Hoy: 339 archivos de capa distintos | 5.562 kB |
| 117 compuestos a 62×96 en JPG | **468 kB** |
| 117 compuestos a 327×504 en JPG | 4.212 kB |

Un 92 % menos. Y esto vale por sí solo, aunque no hubiera nada que
proteger: hoy se mandan 5,5 MB de capas a tamaño completo para pintar
avatares de 35 a 46 píxeles.

A tamaño completo también gana, aunque por mucho menos, y ese margen es
frágil: las capas se repiten entre personas y se cachean una sola vez,
mientras que un compuesto es único por avatar. Cuantas más cuentas haya,
peor sale la comparación a tamaño completo y mejor sale la de miniatura.
Por eso importa servir cada tamaño en su sitio.

---

## 3. Lo que se decidió

| Qué | Decisión |
|---|---|
| Formato | **JPG**. No hace falta transparencia y pesa la mitad |
| Calidad | 80. A 88 pesa un 30 % más sin verse mejor |
| Tamaños | 62×96 para listas, 327×504 para el perfil |
| Sin capa de fondo | **JPG aplanado sobre blanco**. Son 6 de 117 y 9 de 98 ranuras |
| Codificador | `jpeg-js`: JavaScript puro, cero dependencias, sin binario nativo |
| Dónde se guardan | **En disco**, no en Postgres. Ver 4 |
| Cuándo se componen | Al guardar el avatar |
| Nombre del archivo | `/avatares/<id>/<tam>.jpg`, la dirección de esa persona. No cambia nunca |
| La versión | En la consulta, `?v=<huella>`. Ver 8 |
| Ranuras por persona | Una columna, `ranuras_avatar`. El código no pone techo. Ver 9 |
| Avatares en ranuras | También se componen |
| Previsualizaciones | La prenda puesta sobre un modelo vacío, recortada a su zona. Afinado el 23/09: sobre un maniquí, y el cuadro lo elige una persona. Ver 12 |
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

Los compuestos de hoy son 8 MB medidos, y crecerían a unos 45 MB con
mil cuentas. Metidos en Postgres, esa línea se cruza. En disco no se
roza: hay 56 GB libres.

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
| 1 | 2026-09-21 | El compositor | `api/_compositor.js`, `jpeg-js`, tests. No se enchufa a nada | No |
| 2 | 2026-09-21 | Guardar y servir | Migración, `/avatares/<huella>/<tam>.jpg`, gancho al guardar, relleno de los 215 que ya existen | No |
| 3 | Empezada el 21/09 | Las listas | Los diez archivos que pintan avatares pasan a la URL del compuesto. La comunidad ya: sus miniaturas bajaron de 5.562 kB a 399 kB | No |
| 4 | Empezada el 23/09 | Las previsualizaciones | 768 recortes sobre maniquí, para editor y tienda. La herramienta está; faltan los cuadros. Ver el punto 12 | No |
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


### Lo que se validó al cerrar la fase 1

Contra el arte de verdad, en el VPS, el 21/09/2026:

- Los **549 archivos** del catálogo pasan por el decodificador. Cero
  fallos, y los 549 acaban en 327×504.
- Diez avatares reales compuestos de punta a punta: **156 ms de media**,
  36 kB a tamaño completo y 4 kB en miniatura.
- **Determinista**: la misma receta da la misma huella dos veces, que es
  de lo que depende poder cachear la URL un año.
- Dos de esos diez salieron en PNG por no llevar fondo, que es
  exactamente lo previsto.

### Cómo mirarlo con los ojos

Las pruebas dicen que el orden y el alfa están bien, pero no dicen si el
avatar se ve como se veía. Eso lo dice el ojo, y para eso está
`npm run revision:avatares`.

Arma una página donde cada avatar sale dos veces: a la izquierda las
capas apiladas como las apila hoy el navegador, a la derecha la sola
imagen del servidor. Si las dos columnas se ven iguales, el cambio no
altera el producto.

```
npm run revision:avatares                     doce, de datos-locales
npm run revision:avatares -- --cuantos 40
npm run revision:avatares -- --calidad 92
```

Escribe en `revision-avatares/`, fuera de git porque lleva arte dentro.
La copia de `datos-locales` envejece rápido: si algo no cuadra, correr
antes `npm run db:traer`.
### Fase 2 — Guardar y servir

- Migración: una columna con la huella del compuesto en `users` y en
  `saved_avatars`. Nada de imágenes en la base.
- Los archivos van a `datos-locales/avatares-compuestos/<hu>/<huella>/`,
  la misma ruta en el servidor y en local. `datos-locales/` ya está en
  `.gitignore`, y git no borra lo ignorado ni con `reset --hard`, así
  que un despliegue no los toca. Se reparten en subcarpetas por los dos
  primeros caracteres de la huella: con una sola carpeta, decenas de
  miles de archivos hacen lento cualquier listado.
- **La misma ruta por defecto en los dos sitios, y sin variable de
  entorno en producción.** `MR_AVATARES_DIR` existe solo para los tests.
  Si el servidor web y el script de relleno pudieran discrepar sobre
  dónde están los archivos, el fallo sería invisible hasta que alguien
  viera un avatar roto.
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


### Lo que se hizo y se midió al cerrar la fase 2

Desplegado el 21/09/2026, en este orden, que importa: **la migración va
antes que el código**, porque el código nuevo escribe en una columna que
hasta entonces no existe.

| | |
|---|---|
| Avatares compuestos en el relleno | 215, cero fallos, 28 segundos |
| Huellas distintas para esas 215 filas | 164 |
| En disco | 8,9 MB en 328 archivos |
| Temporales sin renombrar | 0 |

Las 164 huellas para 215 filas son 51 avatares idénticos a otro, que
comparten archivo sin que nadie lo programara. Sale del diseño de la
huella.

**Dos cosas que muerden y que costaron un susto:**

- **Un respaldo de la configuración de nginx NO puede vivir dentro de
  `sites-enabled/`.** nginx lee ese directorio entero, así que el
  respaldo se carga como un segundo servidor en el mismo puerto y
  `nginx -t` falla con `duplicate listen options`. Peor: la vuelta atrás
  también falla, y el sitio se queda funcionando con la configuración
  vieja en memoria mientras cualquier recarga futura, incluida la de la
  renovación del certificado, reventaría. Los respaldos van a
  `/etc/nginx/respaldos/`.
- **`add_header` dentro de un `location` cancela todos los del
  `server`.** Medido antes de tocar nada: la portada devolvía las cuatro
  cabeceras de seguridad y `/prendas/`, `/imagenes/` y los `.css`/`.js`
  devolvían cero. Arreglado de paso.
### Fase 3 — Las listas

Aquí es donde se gana el 92 %. Los endpoints devuelven la URL del
compuesto junto al avatar, y los archivos que hoy arman quince
etiquetas `img` pintan una sola.

Son al menos diez: `core.js`, `comunidad-ranking.js`,
`actividad-comunidad.js`, `amigos.js`, `buscador.js`, `chat.js`,
`explorar.js`, `home-portal.js`, `perfil-actividad.js`,
`perfil-avatares-galeria.js`, `usuario.js` y `portal-growth.js`.

### Fase 4 — Las previsualizaciones

768 imágenes, una por prenda, con la prenda puesta sobre su modelo y
recortada a un cuadro.

**El cuadro lo elige una persona, no el código.** Primero se calculó
del propio arte, uniendo la caja de todas las prendas de cada capa, y
funcionaba; pero cómo se ve la tienda es una decisión, no una cuenta.
Cómo se eligen, y con qué, en el punto 12.

Esta fase arregla de paso el punto 23 de la auditoría: las cajas vacías
de la tienda dejan de estarlo. Son el mismo trabajo.

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

---

## 8. La forma de la URL (resuelto el 21/09/2026)

**Hecho el 21/09/2026.** Lo de abajo es el razonamiento, que se deja
porque explica por qué el código está como está. El resultado:

```
/avatares/38/62x96.jpg                 la dirección de esa persona
/avatares/38/62x96.jpg?v=401ddea4553c  la misma, con la versión
/avatares/38/ranura2/327x504.jpg       su segundo diseño guardado
```

Las dos primeras apuntan al MISMO archivo: una cadena de consulta no
toca el disco. La desnuda se sirve con un minuto de caché y es para
escribirla a mano; la otra con un año e `immutable`, y es la que usan
las páginas.

---

El planteamiento original, del mismo día. Antes la URL era
`/avatares/<huella de la receta>/<tam>.jpg`, y eso tiene dos costes que
no se ven hasta que llevas un tiempo:

- **Nadie puede encontrar su propia imagen** sin consultar la base. Para
  responder "por que el avatar de fulano se ve mal" hace falta una
  consulta, no escribir su nombre.
- **Los archivos viejos se quedan.** Cada vez que alguien se cambia de
  ropa nace una imagen y la anterior queda huerfana. Son unos 45 kB por
  cambio. Hoy da igual, con 56 GB libres, pero es una tarea de limpieza
  que alguien tendra que escribir.

### Lo que hacia macrojuegos, leido del archivo el 21/09/2026

Consultado el indice CDX de la Wayback Machine sobre
`av1.na.macrojuegos.com`, 600 URL reales:

```
/users/<id redondeado a miles>/<id>/little.jpg    540 de 600
/users/1021000/1021181/little.jpg?r=154487401
/users/1021000/1021181/little.jpg?r=955152952
```

| | |
|---|---|
| Tamanos | `little` 540, `normal` 43, `full` 17 |
| URL con `?r=` | 39 de 600 |
| Reparto | av0 a av9, diez hosts |

**El dato que decide**: el MISMO usuario aparece con dos `?r=`
distintos. O sea que la ruta era estable y la version viajaba en la
cadena de consulta. No tenian una URL fija a secas: tenian una ruta fija
mas un invalidador, porque sin el una imagen cacheada no se renueva
nunca.

Y el reparto de tamanos confirma lo medido aqui: el 90 % de lo que
servian era la miniatura.

### La sintesis que propongo, cuando se decida

`/avatares/<id de usuario>/<tam>.jpg?v=<12 primeros de la huella>`

- La ruta base es legible y se deriva del usuario: quien quiera mirar su
  avatar escribe la ruta sin `?v=` y ve el actual.
- El `?v=` conserva el cacheado de un ano con `immutable`, porque cambia
  cuando cambia el dibujo. Es el mismo patron que el sitio ya usa en
  `js/core.js?v=20260918`, y el que usaba macrojuegos.
- **Se acaban los huerfanos**: el archivo se sobrescribe.
- Se pierde la deduplicacion, que hoy ahorra 51 archivos de 215. Son 2,7
  MB. No importa.

**El id y no el nombre de usuario**, aunque el nombre seria mas legible.
Medido sobre las 181 cuentas: 14 llevan caracteres que no caben en una
URL sin escapar (espacios, `ñ`, unicode matematico, emoji), y hay dos
pares que solo se distinguen por mayusculas (`yotter`/`Yotter`,
`jader`/`Jader`), asi que una ruta insensible a mayusculas los pisaria.
macrojuegos uso el id por lo mismo.

**Lo que hay que tocar si se hace**: `api/_avatar-compuesto.js` (nombre y
ruta), el bloque de nginx, y nada mas, porque todavia no hay ninguna
pagina que consuma estas URL. **Hacerlo antes de la fase 3 cuesta una
tarde; hacerlo despues cuesta tocar los diez archivos otra vez.**

---

## 9. El freno, y por que existe

Componer cuesta **170 ms de CPU** en esta máquina, y nginx deja pasar
**30 peticiones por segundo** por IP en `location /`, que es por donde
entra guardar el avatar. Sin freno, una sola persona guardando en bucle
pide cinco segundos de CPU por cada segundo de reloj, en una máquina de
dos núcleos. Eso es tumbar el sitio desde una cuenta normal.

**Lo trajo este mismo trabajo** y conviene decirlo: antes, guardar el
avatar era validar y un `UPDATE`.

Dos frenos, y el primero hace casi todo:

1. **No se recompone lo que no cambió.** Si la huella que la base ya
   tiene es la misma que la de la receta nueva y los dos archivos están,
   el archivo YA es correcto. Guardar veinte veces el mismo avatar
   cuesta una composición.
2. **Doce composiciones por persona y por minuto**, para quien alterne
   entre dos avatares a propósito. Un humano guarda dos o tres veces
   seguidas como mucho. Agotado, se devuelve "sin compuesto" y la página
   lo dibuja por capas; el siguiente guardado lo arregla. Nunca se
   bloquea el guardado.

El presupuesto vive en memoria y no entre procesos, así que con dos
procesos el techo real es el doble. Da igual: no es una cuota que haya
que cuadrar, es un tope para que nadie se lleve la máquina. Mismo
criterio que `api/_rafaga.js`.

---

## 10. Vender ranuras: pendiente, y con motivo

La idea, del 21/09/2026: que cada persona empiece con una ranura y
pueda comprar más, sin techo, con el precio subiendo en cada compra.

**La mitad técnica está hecha.** Desde la migración 020 el número de
ranuras es una columna de cada persona (`ranuras_avatar`) y el código no
pone techo: el límite es lo que diga esa columna. Subírsela a alguien es
un `UPDATE`. Lo que falta es la tienda.

**Por qué no se hizo ya**, y son dos razones medidas el mismo día:

| | |
|---|---|
| Personas que usan 1 ranura de las 6 | 44 de 65 |
| Personas que usan las 6 | 0 |
| Cuentas con más de 100 millones de monedas | 4 |
| Cuentas con menos de 10 mil | 178 |
| Lo más caro de la tienda | 50.000 monedas |

Nadie ha llegado al tope que ya tiene, así que se vendería algo que
nadie ha gastado. Y la economía está partida en dos poblaciones: cuatro
cuentas pueden comprar la tienda entera veinte mil veces.

Peor: el **punto 18 de la auditoría** dice que las monedas se conceden
por número de peticiones y no por tiempo verificado, o sea que se
fabrican. **Vender consumo de disco a cambio de una moneda que se
fabrica es dar un botón para llenar el disco.** Primero el 18.

**Cuando llegue el momento**, así lo haría:

- **El precio sube en cada compra, geométrico y no al cuadrado.** Al
  cuadrado es demasiado brusco: la quinta costaría 25 veces la primera.
  Multiplicar por 1,5 cada vez se siente mejor y es lo que usa medio
  género: con una base de 500, las ranuras salen a 500, 750, 1.125,
  1.688, 2.531... La décima cuesta 38 veces la primera y la vigésima
  2.200 veces. Se limita solo, sin un tope que parezca arbitrario.
- **Un tope duro de seguridad de todas formas**, porque un límite que no
  depende de que la economía funcione es el único en el que se puede
  confiar.
- **Una ranura vacía no cuesta disco.** Lo que ocupa 45 kB es la ranura
  LLENA. Comprar no consume nada; llenar sí. No se "asigna" espacio a
  nadie: cada diseño guardado es un archivo y ya está.

---

## 11. Cómo probarlo en tu máquina

El sitio entero, con los datos de verdad, en `localhost:3001`. Nada de
lo que se haga ahí toca producción.

```powershell
cd D:\Macroreborn
npm test                  # 756 pruebas, ~1 min, no tocan nada
npm run db:traer          # baja una copia de la base de produccion
node scripts/rellenar-avatares.js --aplicar    # compone los 215
npm run db:real           # el sitio en http://localhost:3001
```

Ese tercer paso es el que suele olvidarse: `db:traer` baja las recetas
pero no las imágenes, porque son derivadas y viven en el disco del
servidor. Sin él, las direcciones de avatar dan 404 en local.

Dentro del sitio local se puede entrar **como cualquier persona del
sitio**, con la contraseña `local1234` que `db:traer` le pone a todas en
la copia. Así se reproduce lo que le pasa a alguien concreto.

Qué mirar:

| Dirección | Qué debe pasar |
|---|---|
| `/avatares/<id>/327x504.jpg` | La imagen, con un minuto de caché |
| `/avatares/<id>/327x504.jpg?v=loquesea` | La MISMA imagen, con un año |
| `/avatares/<id>/ranura1/327x504.jpg` | Su primer diseño guardado |
| `/avatares/999999/62x96.jpg` | 404 |

Y la prueba que de verdad importa: **cambiarse el avatar y recargar la
misma dirección.** Tiene que salir la ropa nueva sin que la dirección
haya cambiado.

Para mirar los compuestos a ojo, uno al lado del otro con lo que hace
hoy el navegador, está `npm run revision:avatares`.

---

## 12. Las previsualizaciones: los cuadros los elige una persona

**Decidido el 23/09/2026.** Lo que hay en
`api/recortes-previsualizacion.json` es lo que alguien eligió mirando,
no lo que salió de una cuenta. El código solo propone.

### Lo que se aprendió de macrojuegos

Leído de la Wayback Machine el 23/09/2026, en dos búsquedas: la primera
encontró 19 previsualizaciones, y la segunda, más a fondo, 25 más.

- **Quedan 44 previsualizaciones**, todas de 70x70, en dos formatos de
  dirección:

  | Formato | Cuántas | De dónde |
  |---|---|---|
  | `av…/items/ref/<modelo>/<prenda>.jpg` | 23 | 19 de macrojuegos, 4 de microjogos |
  | `avatar1.na…/items/<miles>/<id>/thumb.jpg` | 21 | 16 de macrojuegos, 5 de microjeux |

- **Macrojuegos era una red de sitios** de la misma empresa, con el
  mismo catálogo de prendas: microjeux (francés), microjogos (portugués),
  microgiochi (italiano), microspiele (alemán), microgry (polaco),
  macrogames.ru y macrogamers.com. La misma prenda sale con el mismo
  número en varios, y las dos que se compararon eran idénticas byte a
  byte.
- **Dónde se buscó**: en macrojuegos, servidor por servidor, `av`, `av0`
  a `av9`, `avatar` y `avatar0` a `avatar30`, con y sin `.na`, y los de
  imágenes (`img`, `static`, `mcdn`); en los siete sitios hermanos, que
  son pequeños, todo el dominio de una vez; 127 de los 128 rastreos de
  Common Crawl, que no guardan ninguna imagen de prenda (uno no
  respondió); y las dos wikis de fans
  en Fandom, que solo tienen las miniaturas de los modelos. No hay más.
- **No queda ni una de espalda**, ni de fondo, ojos, guantes, accesorio,
  mascota o borde. Solo se archivaron las que alguien tenía a la vista
  cuando se guardó su página, y la tienda cargaba las prendas por su
  cuenta, así que el archivo casi nunca las vio. Las cuatro nuevas que
  parecían capas o alas son piezas del pecho, puestas por delante.
- **Fuera de los archivos quedan vídeos.** Tres vídeos de YouTube enseñan
  el editor y la tienda por dentro. En la portada del de 2016, *Como
  personalizar Tu avatar en macrojuegos*, de Rey Tutoriales
  (`youtube.com/watch?v=-00Q20_WLzU`), se ve la tienda abierta en camisas
  y un avatar con alas. Son para mirarlos, no se bajaron. Las capturas
  de las wikis de fans son de otras cosas: verificar la cuenta, avisos de
  moderación.
- **En macrojuegos, preguntar por todo el dominio no basta.** La primera
  búsqueda pidió `macrojuegos.com` entero filtrado por `/items/` y se dejó
  las 16 de `avatar1.na`: en un dominio tan grande la consulta no llega
  al final. Por eso la segunda fue servidor por servidor.
- **Sus modelos se llaman como los nuestros**: cereza, fengchao,
  fenglei, fiora, max y tora, más otros seis que aquí no están, como
  Nadia, la sirena, que parece la dueña de muchas de las prendas nuevas:
  conchas, algas, escamas. O sea que esas previsualizaciones son de
  nuestro mismo arte base.
- **En el primer formato, el número lleva el tipo dentro**, en los dos
  dígitos que siguen al modelo: `05` camisas, `06` pantalones, `08`
  pelos, `09` una barba y `12` zapatos. Se comprobó mirando las 23 una
  por una. En el segundo el número no dice nada, y las 21 se clasificaron
  a ojo: 15 camisas, 3 pantalones y 3 de piel.
- **No ponían la prenda sobre el modelo a color, sino sobre una silueta
  plana** de un solo tono gris azulado, medido de sus imágenes en
  `rgb(172,180,204)`. Por eso la prenda resaltaba tanto. Aquí es la
  opción por defecto, y la silueta se saca del propio modelo
  conservando su forma. **La excepción es la única barba**, que sale
  sobre piel morena y sin nada de gris: o ese tipo se enseñaba a color,
  o la prenda traía la piel dentro. Con una sola no se puede saber.
- **La piel se enseñaba como el torso desnudo, a color**, con el mismo
  encuadre que las camisas. Son 3, y es la única referencia que hay para
  nuestra capa piel.
- **Cada tipo tenía siempre el mismo encuadre, y muy cerrado**: las
  camisas del cuello a la cintura, los pantalones de la cadera al muslo,
  los zapatos un solo pie.
- **De sus 12 modelos queda la miniatura**, `models/<nombre>/thumb.jpg`,
  de 73x73: solo la cabeza, y a color. Es lo más parecido que hay a una
  previsualización de la capa modelo.

Todo se bajó solo como referencia, a
`datos-locales/macrojuegos-referencia/`, fuera de git:

| | |
|---|---|
| `prendas/` | Las del primer formato, con su nombre original |
| `prendas-por-id/` | Las del segundo, con la capa delante del número |
| `modelos/` | Las 12 miniaturas |
| `fuentes.tsv` | De dónde salió cada archivo y cuándo se capturó |
| `galeria.html` | Todas juntas, agrupadas por tipo |

**Se acordó borrarlo todo en cuanto los cuadros estén decididos**, por
coherencia con el motivo de todo este proyecto.

### Un cuadro por capa y por modelo

No uno por capa. Las poses de los seis modelos son muy distintas:
fengchao está agachado, fenglei tiene un brazo arriba, y la cabeza de
cada uno cae en otro sitio. Un solo cuadro de boca no les sirve a los
seis. Son **78 combinaciones** de modelo y capa con prendas.

**Siempre cuadrados.** El lienzo mide 327x504, así que el mayor
cuadrado que cabe es de 327: un fondo, un borde o una melena de cuerpo
entero no caben enteros y la previsualización enseña un trozo. Se
aceptó sabiéndolo; macrojuegos tenía la misma limitación.

**El fondo va solo, sin el avatar delante.** Decidido el 23/09/2026: en
la previsualización de un fondo no sale nadie, en los seis modelos y con
cualquier maniquí. Las capas que van solas, hoy fondo y modelo, están en
una lista de `api/_previsualizacion.js`, y la herramienta la recibe de
ahí para que su vista en vivo no discrepe de la de verdad.

### La herramienta

Solo existe en el sitio local, y solo responde a peticiones de la
propia máquina, porque tiene un botón que escribe un archivo del
repositorio. `server.js` no la conoce, y una prueba lo vigila.

```
npm run db:real
```

Y en el navegador, `http://localhost:3001/herramientas/recortes/`.

| | |
|---|---|
| Arrastrar el cuadro | lo mueve |
| Arrastrar una esquina | lo agranda o lo encoge, siempre cuadrado, con la esquina opuesta quieta |
| Flechas | un píxel; con Mayús, diez |
| `+` y `-`, o la rueda | el tamaño, sin mover el centro |
| Aceptar | la sugerencia pasa a ser decisión |
| Copiar a los demás modelos | pone el mismo cuadro en esa capa de los otros; hay que revisarlos, las poses no son iguales |
| La más grande, la más pequeña | salta a las prendas extremas, que es donde se ve si el cuadro les sirve a todas |

Lo que sale como **"la de verdad"** lo hace el mismo código que
generará las 768 (`api/_previsualizacion.js`). Si difiere de la de en
vivo, manda ella.

**Junto a ella, al mismo tamaño, salen las de macrojuegos** de esa capa,
para comparar sin tener que bajar. En las capas de las que no quedó
ninguna sale una de cada tipo, con su nombre, para ver al menos el
estilo; y en la capa modelo, las cabezas de sus modelos, con la del
abierto primero. Las lee de `datos-locales/macrojuegos-referencia/`: si
esa carpeta no está, la herramienta funciona igual y lo dice.

Un cuadro solo sugerido se ve con borde amarillo discontinuo y **no se
guarda**; uno decidido, verde y continuo. Así nunca acaba en el archivo
algo que nadie eligió.

### Lo que queda de la fase 4

1. Elegir los cuadros con la herramienta y guardar.
2. Generar las 768 previsualizaciones con ellos.
3. Servirlas, y que el editor y la tienda las usen.
4. Borrar las referencias de macrojuegos.

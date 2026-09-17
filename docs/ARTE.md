# ARTE — proteger el trabajo del equipo de dibujo

Qué se hizo el 16 de septiembre de 2026 para que el catálogo de prendas
dejara de ser fácil de copiar, qué compra cada pieza y qué **no**.

---

## 0. El punto de partida, sin adornos

Impedir la descarga es imposible. En el momento en que publicas una
imagen, quien sepa usar una terminal llega al PNG. No existen candados
para esto, ni aquí ni en Netflix.

Lo que sí existe es la diferencia entre **cómodo** y **caro**, y entre
**anónimo** y **demostrable**. Todo lo de abajo trabaja en esos dos ejes.

El caso real que lo disparó: alguien se descargó prácticamente el
catálogo entero y publicó las prendas en otra web. El equipo de dibujo se
enteró meses después, al ver su trabajo en otro sitio.

---

## 1. El índice del catálogo ya no se entrega a cualquiera

**Antes:** `GET /api/content?action=avatar-catalogo`, sin sesión,
devolvía las 655 prendas con su nombre, su ranura, su precio y su URL.
Una petición daba el mapa completo; 655 descargas daban el arte. El
catálogo entero pesa 4,4 MB.

**Ahora** son dos acciones, porque son dos trabajos con dos públicos:

| acción | sesión | qué entrega | para qué |
|---|---|---|---|
| `avatar-catalogo` | no | `valor -> URL`, **solo de lo que alguien lleva puesto** | dibujar |
| `avatar-catalogo-completo` | **sí** | nombres, ranuras, precios, retiradas | vestir |

Las 24 páginas que muestran avatares siguen funcionando para cualquiera,
con cuenta o sin ella. El catálogo de compra deja de ser público.

Medido en producción: de 438 archivos, solo **298 huellas** están en uso.
Quien no tiene cuenta ya no puede ni saber que existen las otras 140.

**El detalle que hace que esto sirva de algo:** cerrar el índice no
valdría nada por sí solo, porque `imagenes/<modelo>/<prenda>.png` servía
el mismo dibujo y **ese nombre se adivina** — `tora_pelo3` es
`imagenes/tora/pelo3.png`, con un nombrado sistemático de modelo, capa y
número. Se enumeraba `pelo1`, `pelo2`, `pelo3`… por capa y por modelo y
salía todo, sin índice ninguno. Esa ruta ahora da 404 para cualquier
prenda de verdad, esté el fichero en el disco o no. El arte solo sale por
`/prendas/<huella sha256>.png`, que hay que conocer.

El corte se decide consultando `avatar_prendas` y no con una lista a
mano, que se quedaría vieja en cuanto suba un modelo nuevo. El logo, la
portada y las imágenes de los juegos no están en esa tabla y se siguen
sirviendo igual.

**La ventana de un minuto:** el índice público se cachea por tiempo y no
por versión del catálogo, porque cambia cuando alguien se cambia de ropa.
Si alguien estrena una prenda que nadie llevaba, durante hasta un minuto
esa capa se omite en la pantalla de quien mire desde fuera. No se ve
rota: se ve el avatar sin esa prenda. Quien se la puso la ve bien
enseguida, porque el editor trabaja con el catálogo completo.

---

## 2. La autoría va dentro de cada dibujo

`scripts/hornear-catalogo.js` escribe la autoría de MacroReborn en los
metadatos del propio PNG (bloques `tEXt`/`iTXt`), sin tocar un solo píxel.

```
node scripts/hornear-catalogo.js                  informe, no toca nada
node scripts/hornear-catalogo.js --aplicar        escribe en la copia local
node scripts/hornear-catalogo.js --produccion --aplicar
```

Por defecto no escribe y trabaja contra la copia de producción de
`datos-locales/pgdata`. Hay que pedir `--aplicar` y `--produccion` a
propósito, cada uno por su lado.

Se hace **en una sola pasada** porque cambiar los bytes cambia el
`sha256`, y el `sha256` *es* la URL. Cada pasada se paga con una
redescarga entera del catálogo por parte de todo el mundo y con la caché
de nginx (365 días) quedándose sin efecto. Al aplicarlo hay que vaciarla:

```
sudo rm -rf /var/cache/nginx/prendas/*  &&  sudo systemctl reload nginx
```

Medido contra producción: 438 archivos, 655 prendas, 4389 kB → 4490 kB,
**236 bytes de autoría por archivo**. Cero ilegibles, cero choques de
huella. Es idempotente: volver a correrlo no cambia nada.

**Qué compra, sin vender humo:** no impide copiar. Hace que la copia
lleve dentro de quién es. Sobrevive a un copiar-pegar, a subirlo a otra
web y a la mayoría de las tuberías de imágenes. **No** sobrevive a un
reguardado deliberado en un editor — y ahí está la gracia: quien la borró
demostró que sabía lo que hacía, y eso es justo lo que hace falta para
reclamar una retirada.

El PNG se lee y se escribe a mano en `api/_png.js`, sin librerías de
imagen: es la regla de la casa, la misma que ya obligó a sustituir el
canvas por un falso en `tests/vestidor-horneado.test.js`. Probado contra
las 630 prendas del disco: 630 de 630 dan ida y vuelta byte a byte
exacta.

---

## 3. El lienzo canónico, al subir

Una prenda nueva tiene que venir en **327×504 y sin entrelazar**.

Todas las capas se dibujan superpuestas en el mismo encuadre, así que una
que venga con otras medidas no se cae: se **estira** hasta el marco de
las demás y descuadra el dibujo, sin que nadie se entere hasta que
alguien se la pone y le queda el pelo torcido.

Que esto no estuviera puesto se nota: de 438 archivos en producción, **80
están fuera del lienzo**, y entre ellos hay un 1919×1079 y un 1338×2066.
Eso es un pantallazo o un dibujo sin recortar, subido sin querer.

**Los 80 de dentro NO se corrigen por código.** Recortar, estirar o
rellenar el dibujo de otra persona mueve la prenda sobre el avatar de
quien la lleva puesta, y esa es una decisión del equipo de arte. El
informe del horno los lista agrupados por medida para que decidan qué
hacer con cada grupo. Lo que queda cerrado es la puerta de entrada, para
que esa lista no siga creciendo.

Grupos, tal como salen del informe:

```
36 archivos (42 prendas)  326x503        11 archivos       varios tamaños sueltos
21 archivos (81 prendas)  327x505         1 archivo        654x1010
 7 archivos ( 7 prendas)  327x504 4 bits  1 archivo        1919x1079
 4 archivos ( 4 prendas)  327x505 4 bits  1 archivo        1338x2066
```

El `327×505` es el lienzo original de macrojuegos: su editor servía un
`<img>` de 327×505 y parte del arte se hizo para ese marco.

---

## 4. Términos de uso y a quién reclamar

`terminos.html`, enlazada desde el pie de las 13 páginas que lo tienen y
en el sitemap.

Dice de quién es el arte, qué se puede hacer con él y qué no, y cómo
pedir una retirada. Incluye a propósito **lo que sí se puede hacer sin
pedir permiso** —vestir tu avatar, compartir su imagen, enseñar
capturas—, porque una lista que solo prohíbe no se lee.

Esto es lo más barato de todo el plan y probablemente lo que más peso
tiene cuando hay que pedirle a otro sitio que retire material: sin un
titular con nombre y un contacto, no hay a quién reclamar.

El contacto es `macroreborn0@gmail.com`. Hay que **leerlo**: una dirección
de retirada que nadie atiende es peor que no ponerla, porque promete un
canal que no existe.

---

## 5. Aviso cuando alguien se pone a descargar

`api/_rafaga.js` cuenta cuántas prendas **distintas** pide cada IP en una
ventana de tiempo, y cuando una se pasa deja constancia en el registro
del servidor y manda una notificación dentro del sitio a las cuentas con
la insignia `administrador`.

No impide nada. Lo que compra es enterarse **el mismo día** en vez de
meses después.

Lo que cuenta es la **variedad**, no el volumen: la misma prenda pedida
veinte veces es una prenda. Alguien recargando su perfil no dispara nada.

**De dónde sale el umbral** (medido, no inventado):

```
655  prendas en el catálogo
438  archivos distintos
354  valores que alguien lleva puesto
298  huellas distintas EN USO   <- techo de una visita anónima
```

Por eso el umbral va en **320 prendas distintas en 3 minutos**: por
debajo de 298 saltaría con una página de comunidad cargada entera, y un
aviso que molesta se acaba apagando. Se puede apretar o aflojar sin
desplegar con `MR_RAFAGA_UMBRAL`, `MR_RAFAGA_VENTANA_MS` y
`MR_RAFAGA_ESPERA_MS`.

**Los dos agujeros, dichos antes de que sorprendan:**

1. nginx cachea `/prendas/` durante 365 días, así que una petición que
   acierte en esa caché nunca llega a Node y no se cuenta. Esto ve un
   subconjunto. Lo salva el caso que importa: quien se lleva el catálogo
   **entero** se lleva también las prendas que no lleva casi nadie, y
   ésas no están cacheadas. Un raspado completo asoma; uno de solo lo
   popular, no.
2. `cluster.js` levanta un proceso por núcleo y cada uno cuenta por su
   cuenta. Con dos procesos, una ráfaga repartida tarda el doble en
   asomar. Por eso el umbral no va pegado al techo.

---

## 6. Lo que se decidió NO hacer, y por qué

**Un PNG único por usuario, compuesto en el servidor.** Es lo que hacía
macrojuegos, y funcionaba — pero funcionaba porque era **completo**: no
existía ningún archivo transparente de una prenda en ninguna parte (ni
suelto, ni en las miniaturas de tienda, que iban aplanadas sobre el
modelo), la salida era JPG con pérdida (lo que ensucia el ataque de
restar dos composiciones), y no había índice del catálogo en ningún
sitio.

Son cinco piezas que se sostienen entre sí. El compositor no es la que
protege: es la que **hace posibles** a las otras cuatro.

Media implementación —componer el avatar mostrado y seguir sirviendo las
prendas sueltas al vestidor— no deja a mitad de camino: deja en cero, con
el trabajo hecho. Y la mitad que de verdad protege (cerrar el vestidor
por propiedad) le hace daño a la tienda, porque el objetivo es que la
gente vea bien lo que puede comprar.

Además, hoy no se justifica por rendimiento: la carga del VPS es 0.00 y
nginx ya cachea las prendas. Si algún día se construye, que sea por el
móvil del visitante y no como candado, y acuñando la URL en el servidor
—macrojuegos dejó esa URL sin firmar en su versión de 2021, y con la
receta libre se le podía pedir una prenda sola.

El análisis completo de su sistema está en la memoria del proyecto.

---

## 7. Lo que sigue abierto

- El buzón de `macroreborn0@gmail.com`.
- Los 80 archivos fuera del lienzo: decisión del equipo de arte.
- Un navegador que ya tuviera cacheada una `imagenes/<modelo>/<x>.png`
  la conserva hasta 30 días (`immutable`). El cierre de esa ruta aplica a
  partir de ahora, no hacia atrás.

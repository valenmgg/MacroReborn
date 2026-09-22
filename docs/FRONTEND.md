# FRONTEND — por qué está así, y qué haríamos si empezáramos de cero

Escrito el 22 de septiembre de 2026, a raíz de una pregunta que va a
volver: *¿no deberíamos migrar a un framework para que esto sea un
proyecto serio?*

Esto no es un plan. Es la respuesta razonada, con los números que la
sostienen, para que dentro de un año no haya que pensarla otra vez desde
cero.

---

## 1. El diagnóstico, que no es el que parece

El problema **no es la falta de framework**. Es que las dos mitades del
proyecto tienen disciplinas distintas.

**El servidor está bien modularizado.** Dieciocho módulos compartidos en
`api/_*.js`: el compositor, el lienzo, el PNG, las monedas, los avisos,
las rutas de prenda. Cada uno hace una cosa, se prueba solo, y lo usan
varios sitios. El 21/09/2026 se añadieron dos más y encajaron sin tocar
nada de lo que había.

**El navegador no tiene nada equivalente.** Veinte mil líneas en 58
archivos y ningún mecanismo para decir "esto existe una sola vez".

Lo que eso produce, medido el 22/09/2026:

| | |
|---|---|
| Archivos que saben pintar un avatar | 15 |
| Archivos con una copia del orden de capas | 13 |
| Páginas con pie de página | 15 de 28 |
| Páginas con buscador | 13 de 28 |
| Colores distintos en el CSS | 668, con solo 83 variables |
| `!important` | 1.102 |

Y no es teórico: **once copias del orden de capas llegaron a existir, y
dos llevaban `pantalon` antes que `botas`**, así que el mismo avatar se
dibujaba distinto según la página. Está contado en
`api/_avatar-catalogo.js`. Eso es lo que pasa cuando algo no existe una
sola vez.

---

## 2. Si se empezara de cero: Astro

No React, no Vue, no Next. Astro, y por razones de **este** sitio:

- **Son páginas de contenido con islas interactivas.** 28 páginas que se
  leen, con tres o cuatro trozos que reaccionan: el vestidor, el chat,
  las listas. Es exactamente la forma que Astro asume.
- **Manda cero JavaScript por defecto.** El problema de este sitio es el
  peso, no la interactividad: la comunidad bajaba 5,5 MB de capas para
  pintar avatares de 35 píxeles.
- **Las plantillas arreglan el chasis por construcción.** No es que te
  acuerdes de poner el pie: es que no puedes quitarlo. El punto 37 de la
  auditoría desaparece solo.
- **Compila a HTML y lo sirve nginx.** Una máquina de dos núcleos no
  renderiza nada.
- **Se autoaloja.** Después de salir de Vercel, de Neon y de Pusher, esto
  pesa más que cualquier característica.

**Lo que se descarta y por qué.** Una aplicación de una sola página
rompe el SEO, y arreglarlo significa renderizar en el servidor, que es
trabajo que esta máquina no debería hacer con 112 fichas de juego
indexadas. Y Next.js empuja hacia Vercel, que es de donde se salió.

---

## 3. Lo que NO se va a hacer: reescribir

63 puntos de auditoría abiertos, 182 personas usando el sitio, diez
cuentas nuevas al día, 113 juegos con sus rarezas. Una reescritura
cambia 63 problemas conocidos por un número desconocido de problemas
nuevos.

**Y hay un coste que se ve poco.** Hoy se edita un archivo, se hace push,
y el servidor actualiza su árbol solo (`receive.denyCurrentBranch =
updateInstead`): lo que está en el repositorio es exactamente lo que se
sirve. Con un paso de compilación en medio eso deja de ser cierto, y esa
comodidad vale mucho cuando algo falla a las once de la noche.

---

## 4. El camino barato, que captura casi todo

**Elementos personalizados del propio navegador.** Nativos, sin
compilación, adoptables de un archivo en uno.

```html
<mr-avatar usuario="38" v="401ddea4553c" tamano="62"></mr-avatar>
```

Es lo mismo que se hizo el 21/09 con `urlAvatarCompuesto()`, pero para el
marcado en vez de solo para la lógica. Y encaja con esta situación:

| | |
|---|---|
| Paso de compilación | Ninguno |
| Adopción | Un archivo cada vez |
| Vuelta atrás | Por archivo, no global |

Con `<mr-nav>` y `<mr-pie>` se cierra el punto 37 sin tocar la estructura
de las 28 páginas.

El CSS es un trabajo aparte y ningún framework lo cura: 668 colores con
83 variables se arregla con un sistema de fichas de diseño, y se puede
hacer hoy sobre el CSS que ya existe.

---

## 5. Cuándo volver a mirarlo

**Si se hace el punto 4, el valor que queda de Astro baja mucho.** Lo que
añadiría encima son las plantillas de página y la optimización al
compilar. Es real, pero bastante menos de lo que parece desde aquí.

Por eso esto **no se planifica como proyecto**. La señal para volver a
mirarlo es concreta:

> El día que añadir una página nueva cueste más por el chasis que por el
> contenido, Astro se paga solo.

Hoy no estamos ahí.

**El riesgo de convertirlo en objetivo** es concreto y conocido: se va el
año que tenía que ir a los 63 puntos abiertos, y queda un sitio precioso
por dentro e igual de roto por fuera. Con 182 personas usándolo, eso se
nota más que la arquitectura.

---

## 6. Lo que sí hace serio a este proyecto, para no perderlo de vista

Porque la pregunta venía de ahí, y la respuesta es que la seriedad ya
está, solo que no donde se estaba mirando:

- **767 pruebas** en 42 archivos, que se corren antes de cada despliegue.
- **20 migraciones** versionadas.
- **Nueve documentos** que explican el porqué, no solo el qué.
- **Una auditoría viva** de 76 puntos, cada uno con su fecha al cerrarse
  y sin borrar filas.
- **Respaldos diarios verificados** y una vuelta atrás escrita.
- **Se mide antes de afirmar.** El 21/09, una predicción propia sobre el
  peso de los compuestos resultó estar equivocada en un 64 %, y se
  corrigió porque se midió en vez de suponerse.

Lo que no es serio no es la ausencia de framework: son los 63 puntos
abiertos, las 13 copias del orden de capas, y una economía en la que
cualquiera fabrica monedas (auditoría, punto 18).

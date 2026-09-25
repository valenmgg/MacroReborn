# LA TIENDA DE AVATARES

Hecha el 24 de septiembre de 2026. Era lo que más pedía la comunidad:
"¡no hay tienda!". Hasta entonces la tienda eran las doce últimas
prendas en un panel de `comunidad-ranking.html`, que compraban de un
solo clic y sin preguntar, y el editor del perfil mandaba ahí a comprar
prendas que casi nunca salían en esas doce.

Ahora tiene página propia, `tienda.html`, con todo el catálogo.

---

## 1. Lo que se decidió

El 24/09/2026, a partir de la auditoría de lo que había:

| Decisión | Por qué |
|---|---|
| Página propia, no un panel más grande | Son unas 750 prendas: hacen falta filtros, orden y una dirección que se pueda enlazar |
| Sin probador, por ahora | Probarse lo que no se ha comprado es dibujar con el servidor prendas de pago para cualquiera. La vista previa del editor solo dibuja lo que se puede guardar (`api/_vista-previa.js`) |
| Los precios del equipo de arte no se tocan | Los puso quien hizo la prenda, al subirla |
| Todo lo publicado tiene precio | Las 594 prendas del catálogo original eran gratis. Se les puso un precio por tipo (abajo) |
| Lo que alguien ya llevaba, se le regala | Quien llevaba puesta o guardada una de esas 594 la tiene como comprada, a 0. Sin eso la seguiría llevando, pero al quitársela no podría volver a ponérsela sin pagar |

---

## 2. Los precios

Los de las 594, por tipo de prenda, calibrados con los 35 de la tienda
original (migración 012). Los tipos que aquella no tenía van con los de
su tamaño: boca y cara con lo más pequeño, piel con los ojos, espalda
con el borde.

| Tipo | Precio | | Tipo | Precio |
|---|---|---|---|---|
| boca, cara | 50 | | pantalón, remera | 100 |
| accesorio | 60 | | pelo | 120 |
| guantes | 70 | | fondo | 130 |
| ojos, piel | 80 | | borde, espalda | 150 |
| botas | 90 | | mascota | 220 |

Los del equipo de arte van de 1.500 a 50.000 (mediana, 2.900). Los
personajes base no se venden.

La tabla vive en `api/_precios.js`, y es la que se usa desde entonces
para que ninguna prenda vuelva a quedar gratis sin querer (sección 5).
La migración lleva su propia copia en SQL, porque no puede leer el
módulo; `tests/precios.test.js` vigila que digan lo mismo.

**Lo que da de sí el saldo.** Una cuenta nueva empieza con 500 monedas
y no tiene nada puesto aparte del personaje: le alcanza para ojos,
boca, pelo, remera y pantalón (450). Las monedas se ganan jugando: entre
10 y 30 cada 10 minutos de juego, hasta 500 al día (`api/_monedas.js`).
El 24/09/2026 el saldo más alto de alguien que no es del equipo era 980,
así que lo del equipo de arte queda, de momento, lejos de todo el mundo.

---

## 3. La migración 022

`migrations/022_tienda_catalogo_entero.sql`, que se puede aplicar más de
una vez:

1. Añade `avatar_shop_purchases.precio_pagado`: lo que costó cada
   compra. `NULL` en las anteriores a la migración, que no lo
   apuntaban, y 0 en las regaladas.
2. Pone a la venta, con su precio por tipo, cada prenda publicada que
   no lo estaba. Con la fecha de la prenda, no la de hoy: si no, las
   594 saldrían como novedades. Las 594 llevan la fecha de cuando se
   importó el catálogo a la base (14/09/2026), anterior a todo lo que ha
   subido el equipo de arte.
3. Regala a 0 esas prendas a quien las llevaba puestas o guardadas en
   una ranura. Solo esas: lo que ya estaba en la tienda sigue como
   estaba.

Medido en producción el 24/09/2026, antes de aplicarla: 594 prendas sin
precio, y 1.560 regalos para 120 personas, de 354 prendas distintas.

---

## 4. Las piezas

**La API** (`api/content.js`):

- `GET ?action=avatar-shop`: el catálogo entero, solo con prendas
  publicadas. Cada una trae su previsualización y cuántas se han
  vendido pagando (`vendidas`: las regaladas no cuentan). Con sesión,
  además, el saldo y lo comprado de quien la tiene, y de nadie más.
- `POST ?action=avatar-shop-buy { itemId }`: apunta la compra y cobra,
  las dos cosas o ninguna (`sql.transaccion`, en `api/_pg.js`). Primero
  se apunta: la clave única `(user_id, item_id)` deja entrar un solo
  clic de dos simultáneos. Luego cobra `api/_monedas.js`, en una sola
  instrucción condicionada; si no alcanza, se deshace todo. Devuelve la
  prenda, para ponérsela al momento.
- `GET ?action=mis-monedas`: solo el saldo, para la barra de navegación.

**La página** (`tienda.html`, `js/tienda.js`, `css/tienda.css`): todo
sale de una petición y se filtra en el navegador. Por personaje (abre en
el de cada cual), tipo, texto, "solo lo que puedo comprar" y "ocultar lo
que ya tengo"; ordenado por lo más nuevo, precio o ventas; de 48 en 48.
Comprar pregunta antes, con `MRModal` (`js/modal.js`), y después ofrece
ponérsela. Como lo más nuevo es lo caro del equipo de arte, el resumen
dice cuántas prendas le alcanzan a cada cual y ofrece ver solo esas.

**Los caminos que llevan a ella:**

- La barra de navegación de todas las páginas, detrás de "Juegos"
  (`js/navbar.js`).
- `tienda.html?prenda=<valor>` enseña esa prenda y pregunta si
  comprarla. Ahí mandan el candado del editor del perfil y el
  escaparate de Comunidad.
- Tras comprar, `perfil.html?ponerse=<valor>` abre el editor con la
  prenda puesta. Si es de otro personaje, cambia de personaje y lo
  avisa.

**Nunca el dibujo suelto.** La tienda solo enseña previsualizaciones:
la prenda puesta en un maniquí, 96 px, en JPG. El dibujo suelto es el
arte del equipo y `/prendas/` está cerrado a los demás
(`docs/AVATARES-SERVIDOR.md`, fase 5).

---

## 5. El equipo de arte y los precios

Decidido el 24/09/2026, el mismo día de la tienda. Todo lo que se
publica se vende, entre 1 y 100.000 monedas:

- **Al subir** (`arte.html` y `taller.html`), cada prenda llega con el
  precio de su ranura, y lo sigue al cambiar de ranura mientras nadie
  lo toque a mano. El 0, que antes era gratis, ya no vale.
- **Al publicar** una prenda que no tenía precio (un borrador subido
  gratis antes de la tienda, o una del catálogo original que estaba
  retirada cuando la migración 022), se le pone el de su ranura.
- **Después de subirla**, el botón "Editar" de cada prenda del catálogo
  del panel (`avatarEditarPrenda`, en `api/content.js`):
  - el **precio** lo cambia cualquiera del equipo, en cualquier prenda
    ("confío en ellos");
  - el **nombre**, quien la subió o un administrador, igual que publicar
    y retirar;
  - **descripción** no hay: se decidió no tenerla;
  - el **personaje y la ranura** no se cambian: el dibujo está hecho
    para ellos, y de ahí sale el identificador (`tora_pelo8`) que la
    gente lleva guardado en su avatar. Para eso se sube otra y se
    retira esta.

Lo ya pagado no se toca: cada compra guarda lo que costó
(`precio_pagado`). Cada cambio queda en el registro del servidor, con
quién lo hizo y de qué a qué:

```bash
journalctl -u macroreborn | grep "\[arte\]"
# [arte] dibujante cambió tora_pelo8: precio 120 -> 150
```

---

## 6. Lo que queda

- **Probador.** Descartado por ahora (arriba). Si vuelve, que dibuje
  sobre el avatar de quien mira y con marca de agua, no la prenda sola.
- **Quien llevaba una prenda de la tienda sin haberla comprado** (de
  antes de que se vendiera, anterior a la 022) la conserva, pero el
  editor se la enseña con candado.
- **El saldo de cualquiera** sigue saliendo por `/api/users?username=X`:
  es el punto 57 de `docs/AUDITORIA.md`.

---

## 7. Las pruebas

| Archivo | Qué sujeta |
|---|---|
| `tests/tienda-catalogo-migracion.test.js` | La migración 022: precios, fechas, regalos, que se pueda aplicar dos veces |
| `tests/precios.test.js` | Que la tabla de `api/_precios.js` sea la de la migración |
| `tests/arte-editar.test.js` | Editar nombre y precio: quién puede, qué cambia, qué se rechaza |
| `tests/avatar-panel.test.js` | Subir con precio y publicar poniendo el de la ranura |
| `tests/arte-pagina.test.js`, `tests/taller.test.js` | El precio propuesto al subir y el botón Editar |
| `tests/tienda-api.test.js` | Catálogo, privacidad, compra, clics dobles y `mis-monedas` |
| `tests/transaccion.test.js` | `sql.transaccion` en los dos adaptadores |
| `tests/tienda-pagina.test.js` | La página entera, con la compra y los enlaces |
| `tests/editor-tienda.test.js` | El candado del editor y `?ponerse=` |
| `tests/comunidad-tienda.test.js` | El escaparate de Comunidad |
| `tests/navbar-tienda.test.js`, `tests/navbar-monedas.test.js` | El enlace y el saldo de la barra |
| `tests/modal.test.js` | Los botones y la imagen de `MRModal` |

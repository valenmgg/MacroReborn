# VPS — despliegue en Azure (sin Vercel ni Neon)

Cómo está montado el sitio en el servidor propio, qué se cambió del
código para lograrlo, y cómo operarlo.

---

## 1. La máquina

| | |
|---|---|
| IP | 172.184.203.20 |
| Usuario SSH | `azureuser` (con la llave `~/.ssh/macroreborn-vps-key`, ed25519 desde el 19/09/2026) |
| OS | Ubuntu 24.04.4 LTS |
| Arquitectura | **ARM64 (aarch64)** |
| Recursos | 2 vCPU, 950 MB de RAM, 60 GB libres |
| Ruta del proyecto | `/home/azureuser/MacroReborn` |

La arquitectura ARM importa al instalar cosas nuevas: hay que elegir
paquetes `arm64`, no `amd64`. Node, Postgres y nginx tienen paquetes
ARM nativos en Ubuntu, así que no hubo que compilar nada.

Los 950 MB de RAM son el recurso escaso. Por eso hay **2 GB de swap**
en `/swapfile` (activado en `/etc/fstab`) y el pool de conexiones a
Postgres está limitado a 10. Sin swap, Node y Postgres juntos pueden
hacer que el kernel mate procesos bajo carga.

## 2. Piezas instaladas

```
navegador -> nginx (:443 HTTPS) -> node server.js (:3000) -> postgres (:5432, local)
             (:80 redirige a :443)
```

- **PostgreSQL 16.15**: base `macroreborn`, rol `macroreborn`. Solo
  escucha en `127.0.0.1`, no está expuesto a internet.
- **Node 20.20.2** corriendo `server.js` bajo systemd.
- **nginx** como proxy inverso.
- **ufw**: solo 22, 80 y 443 abiertos.

## 3. Qué se cambió del código

### 3.1 `api/_pg.js` — adaptador nuevo

El driver de Neon (`@neondatabase/serverless`) habla SQL sobre HTTPS
contra la infraestructura de Neon. Un Postgres normal habla el
protocolo nativo por TCP, así que ese driver no sirve en el VPS.

Lo que sí se conservó es la **interfaz**: los handlers escriben
`` sql`SELECT ... ${valor}` `` y reciben un array de filas. `_pg.js`
traduce eso al driver `pg`, incluido el soporte de **fragmentos
anidados** (`api/users.js` arma `semanaActualSQL` como pedazo suelto y
lo incrusta en otras consultas; sin ese soporte, todo `GET /api/users`
falla con un error de sintaxis en `date_trunc`).

Es el gemelo de `scripts/pglite.js`, que ya hacía lo mismo para los
tests. Misma técnica, distinto motor debajo. **Ningún handler se tocó.**

### 3.2 `api/_db.js` — elige driver según la URL

`obtenerSql()` mira `DATABASE_URL`: si el host contiene `.neon.tech`
usa el driver de Neon, si no usa `_pg.js`. La decisión se toma desde
la URL y no desde una variable aparte, para que no exista el caso de
apuntar a un Postgres normal pero hablarle por HTTP (un error que solo
se descubriría en producción).

Se conserva la rama de Neon a propósito: sirve para leer la base vieja
cuando se pueda hacer la migración de datos pendiente.

### 3.3 `api/social.js` y `api/system.js`

Estos dos **se saltaban `_db.js`** y llamaban a `neon()` directo en su
primera línea (`docs/DESARROLLO.md` lo decía: "no se tocaron"). Contra
el VPS habrían seguido intentando conectarse a Neon. Ahora los siete
handlers pasan por `obtenerSql()`.

### 3.4 `server.js` — carga de `.env`

Lee el `.env` del proyecto antes de cualquier otro `require`, porque
los handlers resuelven su conexión al importarse. Se hace a mano en
vez de con `dotenv` para no sumar una dependencia por diez líneas. Lo
que ya venga del entorno tiene prioridad sobre el archivo.

### 3.5 `package.json`

Se agregó `pg`. Se dejó `@neondatabase/serverless` para la migración
de datos pendiente; cuando esté hecha, se puede quitar.

## 4. Configuración y secretos

`/home/azureuser/MacroReborn/.env` (permisos `600`, **no está en git**):

```
DATABASE_URL=postgresql://macroreborn:<contraseña>@127.0.0.1:5432/macroreborn
PORT=3000
SESSION_SECRET=<secreto>
```

La contraseña de Postgres y el `SESSION_SECRET` se generaron **en el
servidor** con `openssl rand`. Las dos se rotaron el 2 de septiembre de
2026 porque el archivo estuvo sirviéndose por HTTP (ver §9); las
actuales nunca han salido de la máquina.

Para que las notificaciones en vivo funcionen hay que agregar a este
archivo las cuatro variables de Pusher (`PUSHER_APP_ID`, `PUSHER_KEY`,
`PUSHER_SECRET`, `PUSHER_CLUSTER`), sacadas del dashboard de Pusher.
Sin ellas `getPusher()` devuelve una instancia muda y el sitio funciona
igual, solo que sin avisos en tiempo real.

## 5. Operación

```bash
sudo systemctl status macroreborn     # ver estado
sudo systemctl restart macroreborn    # reiniciar tras un cambio
journalctl -u macroreborn -f          # ver logs en vivo
journalctl -u macroreborn -n 100      # ultimos 100
```

El servicio tiene `Restart=always`, así que si el proceso muere systemd
lo levanta a los 5 segundos. Está `enabled`: arranca solo al reiniciar
la máquina.

### Desplegar un cambio

```bash
cd ~/MacroReborn
git pull
npm install --omit=dev     # solo si cambiaron las dependencias
sudo systemctl restart macroreborn
```

### Base de datos

```bash
cd ~/MacroReborn && set -a && source .env && set +a
psql "$DATABASE_URL"                       # consola
psql "$DATABASE_URL" -f migrations/0XX.sql # aplicar una migracion
```

### Respaldos

`~/respaldar.sh` corre todas las noches a las 3:30 por crontab, deja un
`.sql.gz` en `~/respaldos/diarios/` y borra los de más de 14 días.

```bash
~/respaldar.sh                      # lanzar uno a mano
ls -lh ~/respaldos/diarios/         # ver los que hay
cat ~/respaldos/respaldo.log        # historial del cron
```

Para restaurar uno:

```bash
cd ~/MacroReborn && set -a && source .env && set +a
gunzip -c ~/respaldos/diarios/macroreborn-FECHA.sql.gz | psql "$DATABASE_URL"
```

Ahora los datos viven en una sola máquina, sin la red de seguridad que
daba un servicio administrado, así que estas copias son la única vuelta
atrás. Conviene bajar una a otro lado de vez en cuando: un respaldo que
solo existe en el servidor que respalda no protege de perder el servidor.

## 6. El cron semanal

`vercel.json` definía un cron que recalculaba el ranking los lunes a
las 8. Eso lo hacía Vercel y aquí no existe, así que se reemplazó por
una entrada en el crontab de `azureuser`:

```
0 8 * * 1 curl -s -m 120 "http://127.0.0.1:3000/api/system?action=recalcular-ranking" >> /home/azureuser/ranking-cron.log 2>&1
```

Se puede borrar `vercel.json` cuando se confirme que no queda nada
apuntando a Vercel.

## 7. La migración de los datos

Hecha el 1 de septiembre de 2026, una vez que se liberó la cuota de
Neon. Se volcó con `pg_dump` y se restauró completo (esquema + datos)
sobre un esquema vacío, no solo los datos sobre las migraciones: así el
esquema que manda es el que la app venía usando de verdad en Neon, y no
una reconstrucción a partir de los archivos de migración.

Detalle que costó un rato: **Neon corre PostgreSQL 18.6 y el VPS 16.15**.
`pg_dump` se niega a volcar un servidor más nuevo que él, así que hubo
que agregar el repositorio PGDG e instalar `postgresql-client-18`. El
volcado se hace con `/usr/lib/postgresql/18/bin/pg_dump`.

Al restaurar aparece un único error, y es inofensivo:
`unrecognized configuration parameter "transaction_timeout"`. Ese
parámetro existe desde Postgres 17; el 16 no lo conoce. No afecta a los
datos.

Se verificó comparando el conteo de filas **tabla por tabla contra
Neon**: las 33 coinciden exactamente. En total 63 usuarios (más de los
~30-40 que se estimaban), 4131 filas de actividad y 2372 puntajes.

Ojo con `n_live_tup` de `pg_stat_user_tables` si se rehace esta
comprobación: es una estimación del planificador y muestra diferencias
de unas pocas filas que no son datos perdidos. Hay que contar con
`count(*)`.

Sobre las contraseñas: 42 usuarios tienen `password_hash` (bcrypt) y 21
siguen con `password` en texto plano. Es el estado esperado — las
migraciones 013/014 convierten cada cuenta a bcrypt en su siguiente
inicio de sesión, no todas de golpe.

Los volcados originales quedaron en `~/respaldos/` del VPS y en
`Documentos\Proyectos de código\MacroReborn - respaldos\` del PC.

## 8. Dominio y HTTPS

El sitio vive en **https://macroreborn.com** (y `www`), con el dominio
comprado en IONOS.

En la zona DNS de IONOS hay dos registros A, `@` y `www`, apuntando a
`172.184.203.20`. Lo demás que aparece ahí (`MX`, el `TXT` de SPF, los
`CNAME` de DKIM/DMARC) es del correo y no se toca. No hay registros
AAAA a propósito: el VPS solo tiene IPv4, y un AAAA suelto mandaría a
los visitantes con IPv6 a la página aparcada de IONOS — un fallo que se
manifiesta como "a unos les carga y a otros no".

El certificado es de Let's Encrypt, emitido con certbot para ambos
nombres, y `certbot.timer` lo renueva solo (comprobado con
`certbot renew --dry-run`). nginx redirige todo el tráfico HTTP a HTTPS
con un 301. La configuración anterior al certificado quedó guardada en
`/etc/nginx/sites-available/macroreborn.antes-de-https`.

Si hay que rehacer el certificado:

```bash
sudo certbot --nginx -d macroreborn.com -d www.macroreborn.com
sudo certbot certificates      # ver los que hay y cuando vencen
```

## 9. Seguridad y rendimiento

Vercel absorbía parte de esto por su cuenta. En un VPS hay que ponerlo,
porque el servidor está expuesto directamente a internet. A las pocas
horas de existir el dominio ya aparecieron escáneres automáticos
(`l9scan` y varias IPs de centros de datos): rastrean los registros de
certificados nuevos y llegan solos, sin que nadie comparta el enlace.

### La fuga del `.env` (2 de septiembre de 2026)

Vale la pena contarlo porque el fallo no estaba en nada de lo que se
instaló para protegerse, sino en algo anterior que nadie miró.

**Qué pasaba.** La raíz del sitio es la raíz del proyecto, y el servidor
de estáticos de `server.js` entregaba *cualquier* archivo que hubiera
ahí. `GET /.env` devolvía **200 con la contraseña de Postgres y el
`SESSION_SECRET` completos**. También salían `/.git/config`,
`/package.json` y el propio `server.js`.

**Se descubrió por casualidad**, probando otra cosa: al simular un
escaneo se vio que `/.env` y `/.git/config` respondían `200` donde el
resto daba `404`.

**Quién llegó a leerlo.** En el log, tres IPs de fuera bajaron el `.env`
con un `200`: `130.12.182.254` (dos veces), `64.227.32.66` y
`165.22.34.189`. Otras cuatro lo pidieron antes de que existiera el
dominio y solo se llevaron el redirect. Son escáneres automáticos, no
alguien que fuera a por este sitio — pero lo que se llevaron es real.

**Alcance.** Limitado, por dos cosas que sí estaban bien: Postgres solo
escucha en `127.0.0.1` y ufw no abre el 5432, así que **con esa
contraseña no se podía entrar desde internet**. Comprobado: cero
conexiones a Postgres desde fuera, cero usuarios nuevos, 63 usuarios
antes y después, y los 275 accesos SSH del día son todos de la IP del
administrador y todos por clave pública (`passwordauthentication no`).

**Qué se hizo.** Se rotaron las dos credenciales (generadas en el
servidor, la vieja comprobada como rechazada) y se tapó en las dos
capas: `esPublico()` en `server.js` y reglas equivalentes en nginx.

La lección: el filtro es **lista blanca por extensión**, no lista negra
de rutas. Una lista negra se queda corta en cuanto alguien añade un
archivo nuevo al proyecto — que es exactamente cómo se llegó aquí.

Si algún día se cambia esa función, la comprobación rápida es:

```bash
for R in /.env /.git/config /package.json /server.js; do
  curl -s -o /dev/null -w "%{http_code} $R\n" https://macroreborn.com$R
done   # las cuatro deben dar 404
```

### fail2ban

Bloquea por IP a quien insiste. Seis cárceles en `/etc/fail2ban/jail.local`:
`sshd`, `nginx-http-auth`, `nginx-botsearch`, `nginx-bad-request`,
`nginx-limite` (caza a quien acumula respuestas 429) y **`nginx-hostil`**,
que es la que de verdad detecta los escaneos.

Dos cosas que hubo que arreglar, y que conviene conocer porque las dos
fallaban en silencio:

1. **El backend va en cada cárcel, no en `[DEFAULT]`.** Con
   `backend = systemd` heredado, las cárceles de nginx ignoran su
   `logpath` y no vigilan nada. Se ve con
   `fail2ban-client get <cárcel> logpath`: si dice *"No file is currently
   monitored"*, esa cárcel no está haciendo nada. En `sshd` **sí** es
   correcto que lo diga: esa lee del journal.

2. **Los filtros de serie no cazan lo que nos llega.**
   `nginx-bad-request` solo cuenta respuestas `400`, y la lista de rutas
   de `nginx-botsearch` no incluye ninguna de las que nos pidieron de
   verdad (`.env`, `.git/config`, `/v2/_catalog`, `/actuator/env`,
   `/telescope/requests`). Medido con `fail2ban-regex` sobre el log real:
   de las 64 peticiones de un escaneo, entre los dos cazaban **2**. Por
   eso existe `filter.d/nginx-hostil.conf`, con las rutas reales; caza
   27 rutas distintas y ningún archivo legítimo del sitio.

Antes de dar por buena una cárcel nueva, conviene medirla contra el log
de verdad — que es lo que delató a las otras dos:

```bash
sudo fail2ban-regex /var/log/nginx/access.log \
     /etc/fail2ban/filter.d/nginx-hostil.conf
```

La IP del administrador está en `ignoreip` para no quedarse fuera por
error. **Si esa IP cambia, hay que actualizarla** o un descuido puede
dejar sin acceso SSH.

```bash
sudo fail2ban-client status              # carceles activas
sudo fail2ban-client status sshd         # bloqueados en una carcel
sudo fail2ban-client set sshd unbanip X  # desbloquear a alguien
```

### Límites de peticiones

En `/etc/nginx/conf.d/macroreborn-limites.conf` y aplicados en el sitio:

| Zona | Límite | Para qué |
|---|---|---|
| `general` | 30/s por IP, ráfaga 60 | Navegación normal (una visita son 12-15 peticiones) |
| `login` | 5/min por IP | Fuerza bruta sobre `/api/auth` |
| `porip` | 40 conexiones | Agotamiento de conexiones |

Devuelven `429`, no el `503` por defecto: es lo que un cliente bien
hecho entiende como "vas demasiado rápido".

Detalle importante: **la app responde `200` con `success:false` a un
login fallido**, no `401`. Por eso fail2ban no puede distinguir los
intentos fallidos leyendo el log, y la barrera real contra la fuerza
bruta es el límite de nginx. Si algún día se cambia a `401`, se puede
añadir una cárcel que los cuente directamente.

### Caché del navegador: `immutable` es una promesa que no se retira

Los estáticos se servían todos con `Cache-Control: public, max-age=2592000,
immutable`. `immutable` le dice al navegador que **ni siquiera pregunte**: no
hace una petición condicional, usa lo que tiene y punto. Para una imagen que
no se edita en sitio está bien. Para el código del navegador fue un error, y
costó un fallo en producción.

**Qué pasó (14 de septiembre de 2026).** El HTML no está cacheado y el JS sí,
durante 30 días. Al desplegar el editor de avatares dinámico, quien había
visitado el sitio en las semanas anteriores recibió el `perfil.html` nuevo —que
ya no trae los divs del catálogo— junto con el `perfil.js` viejo, que espera
encontrarlos. El editor le salía vacío.

**Cómo se reconoció.** En la consola de un navegador afectado, los errores
apuntaban a líneas de `ranking.js` que en el código actual ya no existen. Si una
traza señala líneas que no se corresponden con el archivo desplegado, lo que
corre es código cacheado, no el que está en el servidor.

**Lo que hay ahora, en dos capas:**

1. `server.js` manda `ETag` y `Last-Modified` en los estáticos, y contesta `304`
   sin leer el disco si el navegador ya tiene esa versión. nginx sirve `.js` y
   `.css` con `max-age=300, must-revalidate`: fresco cinco minutos, luego se
   pregunta, y la pregunta se contesta con una respuesta vacía. Un despliegue
   llega a todo el mundo en cinco minutos.
2. Los HTML piden los scripts con `?v=20260914`. Ese número es de un solo uso:
   existía para escapar de las entradas `immutable` que ya estaban guardadas en
   los navegadores, que es lo único que una entrada así permite hacer —cambiar
   la URL—. No hace falta tocarlo en cada despliegue; la capa 1 se encarga.

**La regla.** `immutable` solo en URLs que lleven la huella de su contenido,
como `/prendas/<sha256>.png`: ahí no hay nada que invalidar, porque si el
contenido cambia la URL cambia sola. Todo lo que se edite en sitio —el código
del navegador— tiene que revalidar.

### Cabeceras de seguridad

`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` y
`Strict-Transport-Security`, más `server_tokens off` para no anunciar la
versión de nginx.

### Compresión de las respuestas JSON

`gzip` estaba activo pero solo cubría HTML: faltaba `gzip_types`, así que
cada `/api/users` enviaba 1,38 MB sin comprimir.

### Modo cluster

`cluster.js` arranca un proceso por núcleo (máximo 2) y systemd lanza ese
en vez de `server.js`. Antes un único proceso usaba un solo núcleo y se
veía al 90% de CPU con el otro ocioso.

Es seguro porque **la app no guarda estado en memoria entre peticiones**:
las sesiones están en Postgres y los `Map`/`Set` de los handlers son
variables locales. Si eso cambia, el cluster deja de ser seguro — cada
proceso tendría su propia copia.

Para volver atrás: cambiar `ExecStart` a `server.js` (queda copia en
`macroreborn.service.antes-cluster`) y `daemon-reload`.

### Medidas

| | 1 proceso | 2 procesos |
|---|---|---|
| Portada | 6022 pet/s | **8401 pet/s** |
| `/api/users` | 52 pet/s | **68 pet/s** |

Por HTTPS y contra la red real, la portada da ~800-1200 pet/s, que son
varios miles de usuarios simultáneos. El hardware sobra de largo para 63
usuarios.

El cuello de botella es `/api/users`: 34 veces más lento que el resto.
No es la base de datos — esa consulta tarda **0,064 ms**. Es que la
columna `avatar` ocupa **1340 kB de los 1382 kB** de la respuesta: se
envían los avatares completos de todos los usuarios en cada llamada, y
Node se va al 90% de CPU serializando. Comprime mal (solo un 26%) porque
ya son datos comprimidos.

Esto **empeora con cada usuario nuevo**: a 300 usuarios serían ~6 MB por
petición. Merece la pena revisar si quien consume ese endpoint necesita
de verdad los avatares o le basta con nombre y nivel.

## 10. Lo que falta

1. **Rotar la contraseña de Neon**, que se compartió por chat durante
   la migración. (La del VPS ya está rotada — ver §9.)

2. **Dar de baja Neon** cuando el VPS lleve un tiempo estable. Conviene
   conservar el snapshot hasta entonces. Después se puede quitar
   `@neondatabase/serverless` de `package.json` y la rama de Neon de
   `_db.js`.

### Resuelto

- **Las variables de Pusher** en `.env`, para que volvieran los avisos en
  tiempo real. No se pusieron, y ya no hacen falta: los avisos dejaron de
  necesitar un tercero. Se sostienen desde esta misma máquina con
  Server-Sent Events, y el paquete `pusher` salió de `package.json`. El
  porqué entero está en `docs/DESARROLLO.md` §9. **(16/09/2026)**

- **Publicar los cambios en git.** El código de la migración estaba en el
  VPS y en el PC, pero sin commit. Ya está publicado. **(16/09/2026)**

(Esta lista llegó a estar numerada 1, 4, 5, 6: se habían borrado dos
puntos sin renumerar el resto, así que no había forma de saber si se
habían hecho o se habían perdido. Si se quita uno, que se quite entero o
que baje a «Resuelto».)

# RETOMAR — cómo volver a trabajar tras formatear el PC

Esto ya pasó una vez. En septiembre de 2026 se formateó la máquina y se
perdió todo rastro de cómo entrar al servidor: no había nada en local y
hubo que reconstruirlo desde Google Drive a ciegas. Este archivo existe
para que la segunda vez cueste quince minutos.

Última actualización: 18 de septiembre de 2026.

---

## 1. Lo que NO está en este repositorio

Guardar la carpeta del proyecto **no basta**. Estas tres cosas viven
fuera y hay que copiarlas aparte.

| Qué | Dónde está en el PC | ¿Dónde hay copia? |
|---|---|---|
| **La llave SSH del servidor** | `~/.ssh/macroreborn-vps-key` | **Se perdió dos veces. Ver §1.1** |
| **La memoria y las conversaciones de Claude Code** | `~/.claude/projects/<carpeta>/` | Sí: copiado entero en `memoria-claude/` de esta misma carpeta (fuera de git a propósito) |
| **El `.env` del proyecto** | Solo en el servidor, en `~/MacroReborn/.env` | No hace falta copiarlo: se lee desde allí |

### 1.1 La llave SSH se ha perdido dos veces. Léelo antes de formatear

**Septiembre de 2026:** se formateó el PC sin nada en local. Se
reconstruyó desde Drive.

**19 de septiembre de 2026:** se volvió a formatear. Esta vez la copia
del proyecto sí viajó a Drive y **sobrevivió todo** —código, git,
memorias, conversaciones—, pero la llave no estaba dentro del proyecto:
vivía en `G:\Mi unidad\02_Proyectos_Software\Proyectos de código\Oracle
Cloud - MacroReborn\`, y al reorganizar Drive esa carpeta desapareció.
Búsqueda exhaustiva de todo Drive y de `C:`, `D:`, `E:` y `F:`: **cero
archivos `.pem`**.

Las dos veces el fallo fue el mismo, y la lección es una sola: **lo que
viaja bien es lo que está DENTRO de la carpeta que se copia.** Lo que
está fuera se pierde aunque esté anotado, porque la anotación envejece
antes que el olvido.

**Cómo recuperar el acceso.** El sitio sigue funcionando solo; lo que se
pierde es administrarlo y desplegar. Se recupera por Azure:

1. Portal de Azure → la máquina virtual → **Ayuda** → **Restablecer
   contraseña** → **Restablecer clave pública SSH**, usuario
   `azureuser`, y pegar la clave pública nueva.
2. O por línea de comandos:
   `az vm user update -u azureuser --ssh-key-value <ruta a la .pub> -g <grupo> -n <vm>`

Para generar un par nuevo: `ssh-keygen -t ed25519 -f ~/.ssh/macroreborn-vps-key`

Ahí dentro hay dos cosas distintas, y las dos viven fuera del proyecto:

- **`memory/`**: nueve archivos con lo aprendido del proyecto (cómo
  entrar al servidor, por qué `fail2ban` está apagado, qué protege de
  verdad el plan del arte, cómo firmar los commits). Son 44 kB y es lo
  más barato de salvar y lo más caro de perder: es lo que hace que una
  sesión nueva sepa de qué va esto sin contárselo todo otra vez.
- **Las conversaciones**: once sesiones completas en `.jsonl`, 153 MB.
  Útiles para consultar qué se decidió y por qué, aunque no se cargan
  solas.

`memoria-claude/LEEME.md` explica cuál es cuál, cómo devolverlas a su
sitio y cómo refrescar la copia. **No se actualiza sola**, así que
conviene rehacerla antes de volver a formatear, y con la sesión cerrada
para que la conversación en curso esté completa.

En la carpeta del proyecto hay además dos cosas que **no** conviene
subir a Drive tal cual:

- `datos-locales/` — la copia de la base de producción. Lleva las
  cuentas, los comentarios y los mensajes de 141 personas reales.
  Decide a conciencia si eso va a Drive. Se puede volver a bajar en
  cualquier momento con `npm run db:traer`.
- `node_modules/` — 76 MB regenerables con `npm install`. Copiarlo solo
  hace la sincronización más lenta.

## 2. Dónde vive cada cosa

| | |
|---|---|
| Sitio en producción | https://macroreborn.com |
| Servidor | Azure, `172.184.203.20`, Ubuntu 24.04 **ARM64**, 2 vCPU, 950 MB de RAM |
| Entrar | `ssh -i ~/.ssh/macroreborn-vps-key azureuser@172.184.203.20` |
| Ruta del proyecto en el servidor | `/home/azureuser/MacroReborn` |
| Ruta del proyecto en el PC | `D:\Macroreborn` (desde el 19/09/2026; antes `C:\Users\luisd\Documents\Macroreborn`) |
| Copia en Drive | `G:\Mi unidad\01_Proyectos_Software\Proyectos de código\Macroreborn\` (desde el 19/09/2026; antes `02_Proyectos_Software\...`) |
| Repositorio | `github.com/valenmgg/MacroReborn` (**público**, ver `docs/AUDITORIA.md` punto 14) |
| Base de datos | PostgreSQL 16 en el propio servidor, solo escucha en `127.0.0.1` |
| Respaldos | `~/respaldos/diarios/` en el servidor, uno cada noche a las 3:30, se guardan 14 días |

La documentación completa de la máquina está en `docs/VPS.md`. Casi
todo lo que se pueda preguntar sobre el servidor está ahí antes que en
ningún otro sitio.

## 3. Levantar el entorno en un PC nuevo

```bash
git clone git@github.com:valenmgg/MacroReborn.git
cd MacroReborn
npm install
npm test            # 655 pruebas, ~45 s, no tocan nada real
npm run db:traer    # baja una copia de la base de produccion
npm run db:local    # sitio local en http://localhost:3001
```

Y copiar la llave SSH desde Drive a `~/.ssh/`, que es lo que da acceso
al servidor.

**Ojo con dos cosas al configurar git:**

- La identidad tiene que ser `Luis David Trejos Rojas
  <luisdavid.trejosrojas@gmail.com>`, autor y committer. El 15/09/2026
  aparecieron 17 commits firmados como `Ubuntu <azureuser@...>` porque
  el servidor no tenía identidad configurada, y el 18/09 otros 8 salieron
  con un correo distinto. Las dos veces hubo que reescribir el historial.
- El remoto `vps` **no lleva la llave configurada**. Hay que pasársela:

```bash
GIT_SSH_COMMAND='ssh -i "<ruta de la llave>"' git push vps main
```

## 4. Desplegar un cambio

El servidor tiene `receive.denyCurrentBranch=updateInstead`, así que un
push actualiza su árbol de trabajo solo. Después hay que reiniciar:

```bash
GIT_SSH_COMMAND='ssh -i "<ruta>"' git push vps main
ssh -i "<ruta>" azureuser@172.184.203.20 "sudo systemctl restart macroreborn"
```

`npm install --omit=dev` solo si cambió `package-lock.json`.

Comprobación mínima después de desplegar:

```bash
for R in / /comunidad-ranking.html; do curl -s -o /dev/null -w "%{http_code} $R\n" https://macroreborn.com$R; done
for R in /.env /.git/config /server.js; do curl -s -o /dev/null -w "%{http_code} $R\n" https://macroreborn.com$R; done   # las tres deben dar 404
curl -s -o /dev/null -w "%{http_code} URI mal formada\n" 'https://macroreborn.com/%C0%80'                                 # debe dar 400
```

Vuelta atrás, si algo falla:

```bash
ssh -i "<ruta>" azureuser@172.184.203.20 "cd ~/MacroReborn && git reset --hard <commit anterior> && sudo systemctl restart macroreborn"
```

## 5. En qué punto está el trabajo

El 18 de septiembre de 2026 se hizo una auditoría completa del proyecto:
catorce revisiones en paralelo más una del servidor en vivo. Salieron 74
cosas por arreglar, y están todas en **`docs/AUDITORIA.md`**, ordenadas
por importancia y con una columna de estado para ir marcándolas.

De las catorce urgentes del bloque 1, **ocho están hechas y desplegadas**
(2, 4, 5, 7, 8, 9, 10 y 11): tres XSS almacenados, tres agujeros de
autorización, el proceso que se podía tumbar con una URL y la barra de
más que sacaba el arte.

**Quedan seis, y este es el orden que tenía sentido:**

| # | Qué falta | Notas |
|---|---|---|
| 3 | Pedir sesión en `/api/avisos` | Hoy cualquiera lee en vivo las notificaciones de cualquiera |
| 6 | Poner una `Content-Security-Policy` en nginx | Empezar en `Report-Only` para ver qué rompe |
| 1 | `sandbox` en el iframe de los juegos | Hay que probar juego por juego; algunos perderán su guardado local |
| 12 | Versión de sesión en el token | Decidido: **hay que cerrar todas las sesiones**. Migración nueva |
| 13 | Publicar los commits en GitHub | Estaban 83 commits sin publicar |
| 14 | Sacar el arte del repositorio | Decidido: intentarlo. Ojo, borrarlo de `HEAD` no lo saca del historial |

## 6. Lo que muerde si no se sabe

- **`fail2ban` está apagado a propósito** desde el 17/09/2026. No se
  vuelve a encender hasta arreglar el punto 18 de la auditoría, o el
  administrador se autobanea al abrir su panel.
- **La base está en 127 MB y `shared_buffers` en 128 MB.** Ahora mismo
  el 100 % de las lecturas salen de memoria, y por eso el sitio va
  rápido. El día que la base pase de 128 MB eso se cae de golpe. De esos
  127 MB, 90 son dos tablas que no lee nadie (punto 68).
- **`migrations/` no puede reconstruir el sitio**: ninguna migración crea
  la tabla `users` (punto 67). Hoy la única forma de rehacer la base es
  un volcado de `pg_dump`.
- **Los respaldos viven en la misma máquina que protegen.** Conviene
  bajarse uno a otro sitio de vez en cuando.
- **La IP del administrador está en `ignoreip` de `fail2ban`.** Si cambia
  y algún día se reactiva, hay que actualizarla o te deja fuera.

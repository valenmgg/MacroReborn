# RETOMAR — cómo volver a trabajar tras formatear el PC

Esto ya pasó una vez. En septiembre de 2026 se formateó la máquina y se
perdió todo rastro de cómo entrar al servidor: no había nada en local y
hubo que reconstruirlo desde Google Drive a ciegas. Este archivo existe
para que la segunda vez cueste quince minutos.

Última actualización: 21 de septiembre de 2026.

---

## 1. Lo que NO está en este repositorio

Guardar la carpeta del proyecto **no basta**. Estas cuatro cosas viven
fuera y hay que copiarlas aparte.

| Qué | Dónde está en el PC | ¿Dónde hay copia? |
|---|---|---|
| **La llave SSH del servidor** | `~/.ssh/macroreborn-vps-key` | En **Bitwarden**, elemento de tipo Clave SSH. Ver §1.1 |
| **La memoria y las conversaciones de Claude Code** | `~/.claude/projects/<carpeta>/` | Sí: copiado entero en `memoria-claude/` de esta misma carpeta (fuera de git a propósito) |
| **El `.env` del proyecto** | Solo en el servidor, en `~/MacroReborn/.env` | No hace falta copiarlo: se lee desde allí |
| **Los dibujos originales de las prendas** | `imagenes/<modelo>/` y `imagenes/<modelo>.png`, fuera de git desde el 21/09/2026 | Cuatro copias: la base de datos del servidor (`avatar_archivos`, que es lo que sirve el sitio) con su respaldo diario, esta misma carpeta, la copia de Drive, y el `~/respaldos/arte-originales-imagenes-2026-09-21.tar.gz` del servidor |

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

1. Generar un par nuevo:
   `ssh-keygen -t ed25519 -f ~/.ssh/macroreborn-vps-key`
2. Portal de Azure → la máquina virtual (`macroreborn-vps`) → **Ayuda** →
   **Restablecer contraseña** → modo **Restablecer clave pública SSH**,
   usuario `azureuser`, y pegar el contenido del `.pub`.
3. O por línea de comandos:
   `az vm user update -u azureuser --ssh-key-value <ruta a la .pub> -g <grupo> -n <vm>`

**Ojo: Azure AÑADE la clave, no reemplaza.** Después hay que quitar a
mano la vieja de `~/.ssh/authorized_keys`, o el servidor sigue aceptando
una llave cuyo paradero se desconoce.

### 1.2 Lo que se hizo el 19/09/2026

Clave activa, la única que entra:

```
SHA256:NtNfiLpBLPf+zKj2oJbGsM5KbkJsjKNROogkcLG8Lr8   ed25519   macroreborn-vps-2026-09-19
```

Se quitó la anterior (`SHA256:xUnZ0B9e4opNR0nBIbcGM4uzpfG8ZNKe+9wcVPF4EwU`,
RSA 3072, comentario `generated-by-azure`) de **dos** sitios, no de uno:
estaba autorizada para `azureuser` **y también para `root`**, y como
`PermitRootLogin` está en `without-password`, quien tuviera ese `.pem`
entraba directamente como root. El `authorized_keys` de root quedó
vacío, así que ya no hay ninguna vía de acceso como root por SSH
(`PasswordAuthentication` está en `no`). Se administra con `sudo` desde
`azureuser`, como siempre.

Quedan copias de los dos archivos originales en el servidor, por si
acaso: `~/.ssh/authorized_keys.antes-limpieza-2026-09-19` y
`/root/.ssh/authorized_keys.antes-limpieza-2026-09-19`.

### 1.3 Dónde vive ahora la llave, y por qué ahí

En **Bitwarden**, como elemento de tipo Clave SSH. No en una carpeta de
Drive, que es lo que falló las dos veces.

El razonamiento, por si hay que rehacerlo:

- **La cuenta de Azure es el respaldo de verdad.** Mientras se controle
  esa cuenta, siempre se puede recuperar el acceso, se pierda la llave
  que se pierda. Lo crítico que hay que custodiar es esa cuenta con su
  segundo factor; la llave SSH es una comodidad.
- **La llave en Bitwarden** es la comodidad. Si el PC arde, se saca
  desde el móvil. Bitwarden puede además hacer de agente SSH, y entonces
  la clave privada ni siquiera necesita estar en el disco.
- **Una segunda llave autorizada** en otro equipo hace que perder una
  deje de ser un problema. Es gratis.

Lo que **no** hay que volver a hacer es dejarla suelta en una carpeta de
Drive. Falló dos veces por el mismo motivo: la carpeta se movió y la
ruta anotada envejeció antes que el olvido.

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
| Repositorio | `github.com/valenmgg/MacroReborn` (**público**; las prendas ya no van en él desde el 21/09/2026, ver `docs/AUDITORIA.md` punto 75) |
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

Y sacar la llave SSH de Bitwarden a `~/.ssh/macroreborn-vps-key`, que es lo
que da acceso al servidor.

Un clon de GitHub viene sin las prendas: `imagenes/<modelo>/` y
`imagenes/<modelo>.png` están fuera de git desde el 21/09/2026. El sitio
no las echa en falta, porque las sirve desde la base y `npm run db:traer`
trae esa base entera. Si hacen falta los originales, están en la copia
de Drive.

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

Y para empujar a GitHub por HTTPS: la primera vez salta el inicio de
sesión en el navegador, y el gestor de credenciales de git guarda el
token en Windows. Tiene que ser una cuenta con permiso de escritura en
`valenmgg/MacroReborn`.

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

De las catorce urgentes del bloque 1, **once están hechas** (2, 3, 4, 5,
7, 8, 9, 10, 11, 13 y 14): tres XSS almacenados, tres agujeros de
autorización, el proceso que se podía tumbar con una URL, la barra de
más que sacaba el arte, los commits publicados en GitHub, las prendas
fuera del árbol del repositorio, y el buzón que cualquiera leía en vivo
por `/api/avisos`.

**Quedan tres, y este es el orden que tenía sentido:**

| # | Qué falta | Notas |
|---|---|---|
| 6 | Poner una `Content-Security-Policy` en nginx | Empezar en `Report-Only` para ver qué rompe |
| 1 | `sandbox` en el iframe de los juegos | Hay que probar juego por juego; algunos perderán su guardado local |
| 12 | Versión de sesión en el token | Decidido: **hay que cerrar todas las sesiones**. Migración nueva |
| 75 | Sacar las prendas del historial de GitHub | **Descartado** el 21/09/2026: se acepta que el arte anterior a esa fecha siga en el historial |

**Aparte de la auditoría, hay un trabajo a medias:** que el servidor
componga los avatares y deje de repartir las prendas sueltas. Está en
`docs/AVATARES-SERVIDOR.md`, y su tabla de fases (punto 5) dice cuáles
están hechas y cuál toca.

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

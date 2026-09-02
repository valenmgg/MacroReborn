# Configuracion del servidor

Copia de los archivos que hacen funcionar el VPS y que viven fuera del
proyecto, en las carpetas del sistema. Aqui no se ejecutan: son un
respaldo versionado, para poder reconstruir la maquina si se pierde y
para ver en el historial por que quedo cada cosa como quedo.

Si se cambia algo en el servidor, hay que copiarlo aqui y hacer commit.
No se sincroniza solo.

| Archivo | Va en |
|---|---|
| `nginx/macroreborn.conf` | la carpeta `sites-available` de nginx |
| `nginx/macroreborn-limites.conf` | la carpeta `conf.d` de nginx |
| `systemd/macroreborn.service` | la carpeta de unidades de systemd |
| `fail2ban/jail.local` | la carpeta de configuracion de fail2ban |
| `fail2ban/nginx-limite.conf` | la subcarpeta `filter.d` de fail2ban |
| `scripts/respaldar.sh` | el home de `azureuser` |
| `scripts/crontab.txt` | se carga con `crontab -e` |

Las rutas exactas estan en `docs/VPS.md`.

En `jail.local` hay que sustituir `TU.IP.AQUI` por la IP del
administrador. Si se deja el marcador, fail2ban puede acabar bloqueando
el acceso SSH propio tras varios intentos fallidos.

Lo que **no** esta aqui: el `.env` con las contrasenas y los
certificados de Let's Encrypt. Los certificados los regenera certbot; el
`.env` hay que rehacerlo a mano (ver `docs/VPS.md`).

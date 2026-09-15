#!/bin/bash
# ==============================
# RECALCULAR EL RANKING SEMANAL — infra/scripts/recalcular-ranking.sh
# ==============================
# Lo llama el cron los lunes a las 8:00 UTC (5:00 en Argentina).
#
# Antes esto era una linea de curl en el crontab, heredada de cuando el
# cron lo disparaba Vercel. Pero /api/system?action=recalcular-ranking
# esta protegido con CRON_SECRET, y ese secreto lo ponia Vercel en el
# entorno de la funcion. Al mudarnos al VPS nadie lo puso: desde la
# migracion, cada lunes la llamada devolvia
#
#   {"success":false,"error":"Falta configurar CRON_SECRET ..."}
#
# y el ranking no se recalculaba. Salia en ~/ranking-cron.log, que nadie
# miraba porque el cron "corria bien" -devolver un 503 no es fallar,
# desde el punto de vista de cron-.
#
# El secreto se lee del .env del proyecto, que es donde ya viven
# DATABASE_URL y SESSION_SECRET. Asi no queda escrito en el crontab,
# donde lo veria cualquiera que corra `crontab -l`.
set -u

PROYECTO="${PROYECTO:-/home/azureuser/MacroReborn}"
ENV="$PROYECTO/.env"

if [ ! -f "$ENV" ]; then
  echo "$(date -Is) no existe $ENV" >&2
  exit 1
fi

# Solo esa variable, y sin ejecutar el fichero entero.
SECRETO=$(grep -E '^CRON_SECRET=' "$ENV" | head -1 | cut -d= -f2- | tr -d '"'"'"'')

if [ -z "$SECRETO" ]; then
  echo "$(date -Is) falta CRON_SECRET en $ENV" >&2
  exit 1
fi

RESPUESTA=$(curl -s -m 120 -w '\n%{http_code}' \
  -H "Authorization: Bearer $SECRETO" \
  "http://127.0.0.1:3000/api/system?action=recalcular-ranking")

CODIGO=$(echo "$RESPUESTA" | tail -1)
CUERPO=$(echo "$RESPUESTA" | head -n -1)

echo "$(date -Is) HTTP $CODIGO $CUERPO"

# Que cron se entere de que fallo. Un 200 con success:false tambien
# cuenta como fallo: es lo que tapaba el problema anterior.
if [ "$CODIGO" != "200" ] || echo "$CUERPO" | grep -q '"success":false'; then
  exit 1
fi

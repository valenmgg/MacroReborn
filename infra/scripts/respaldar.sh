#!/bin/bash
# Respaldo diario de la base de datos de MacroReborn.
# Guarda copias comprimidas y conserva las de los ultimos 14 dias.
set -euo pipefail
set -a; source /home/azureuser/MacroReborn/.env; set +a
DESTINO=/home/azureuser/respaldos/diarios
FECHA=$(date +%Y-%m-%d-%H%M)
pg_dump "$DATABASE_URL" --no-owner --no-acl | gzip > "$DESTINO/macroreborn-$FECHA.sql.gz"
find "$DESTINO" -name "macroreborn-*.sql.gz" -mtime +14 -delete
echo "$(date -Is) respaldo ok: macroreborn-$FECHA.sql.gz"

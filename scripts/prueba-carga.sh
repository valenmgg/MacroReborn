#!/bin/bash
#
# Mide cuanta carga aguanta el servidor.
#
#   ./scripts/prueba-carga.sh          prueba normal (unos 4 minutos)
#   ./scripts/prueba-carga.sh rapida   solo lo esencial (1 minuto)
#   ./scripts/prueba-carga.sh limite   busca el punto de rotura (10 minutos)
#
# Se ejecuta EN EL SERVIDOR. Medir desde el PC de casa no sirve para saber
# que aguanta la maquina: lo que se acaba midiendo es la conexion de casa y
# el limite de conexiones del cliente. Eso ya paso una vez — daba numeros que
# bajaban al subir la concurrencia, que es justo la senal de que el cuello
# esta en quien mide, no en quien responde.
#
# Contra https://127.0.0.1 y no contra el puerto 3000, para que la medida
# incluya nginx, el TLS y la compresion, que es por donde pasan los usuarios
# de verdad. Ojo: contra el puerto 80 se mide la redireccion a HTTPS y salen
# numeros absurdamente altos de respuestas que no son la pagina.

set -u

MODO="${1:-normal}"
HOST="https://127.0.0.1"
RESOLVER="--header Host:macroreborn.com"
SALIDA="/tmp/prueba-carga-$(date +%Y%m%d-%H%M).txt"

# La IP del administrador esta en la lista blanca de fail2ban, pero los
# limites de nginx no distinguen: una prueba de carga son miles de peticiones
# por segundo desde una sola IP. Hay que subir LOS DOS limites, y es facil
# olvidarse del segundo:
#
#   - limit_req  (30 peticiones/s) frena el ritmo
#   - limit_conn (40 conexiones)   frena las conexiones simultaneas
#
# Con solo el primero quitado, una prueba de 50 conexiones ve 40 aceptadas y
# 10 rechazadas con 429, y los numeros salen sin sentido: se llegaron a medir
# 1,4 peticiones/s en un endpoint que responde en 5 ms.
#
# Se restauran al terminar pase lo que pase, incluso con Ctrl-C.
LIMITES="/etc/nginx/conf.d/macroreborn-limites.conf"
SITIO="/etc/nginx/sites-available/macroreborn"

restaurar_limites() {
  rm -f /tmp/prueba-carga.lock
  local hubo=0
  [ -f "${LIMITES}.prueba" ] && { sudo mv "${LIMITES}.prueba" "$LIMITES"; hubo=1; }
  [ -f "${SITIO}.prueba" ]   && { sudo mv "${SITIO}.prueba" "$SITIO";     hubo=1; }
  if [ "$hubo" = "1" ]; then
    sudo nginx -t >/dev/null 2>&1 && sudo systemctl reload nginx
    echo ""
    echo "Limites restaurados. Comprobacion:"
    grep -o "rate=[0-9a-z/]*" "$LIMITES" | sed 's/^/  /'
    grep -o "limit_conn porip [0-9]*" "$SITIO" | sed 's/^/  /'
  fi
}
trap restaurar_limites EXIT INT TERM

quitar_limites() {
  sudo cp "$LIMITES" "${LIMITES}.prueba"
  sudo cp "$SITIO" "${SITIO}.prueba"
  # Subir los limites en vez de quitar las directivas: si se quita la zona,
  # el `limit_req zone=general` del sitio deja de resolver y nginx no arranca.
  sudo sed -i 's/rate=30r\/s/rate=100000r\/s/; s/rate=5r\/m/rate=100000r\/s/' "$LIMITES"
  sudo sed -i 's/limit_conn porip 40/limit_conn porip 10000/' "$SITIO"
  sudo nginx -t >/dev/null 2>&1 && sudo systemctl reload nginx
  sleep 1
}

# ---------------------------------------------------------------- utilidades

titulo() {
  echo ""
  echo "=============================================================="
  echo " $1"
  echo "=============================================================="
}

# Estado de la maquina mientras corre la prueba, para saber que se agota
# primero: la CPU, la memoria o ninguna de las dos.
vigilar() {
  local segundos="$1" archivo="$2"
  ( for _ in $(seq 1 "$segundos"); do
      top -bn1 | grep "^%Cpu" | awk '{print $2+$4}'
      sleep 1
    done | sort -n | tail -1 > "$archivo" ) &
  VIGIA=$!
}

# Una prueba: nombre, ruta, conexiones, duracion.
medir() {
  local nombre="$1" ruta="$2" con="$3" dur="$4"
  # wrk usa la maquina que mide, y aqui es la misma que responde. Con 2 hilos
  # a 500 conexiones el cuello pasa a ser wrk (se ven "timeout" que no son del
  # servidor), pero pasarse tampoco vale: cada hilo de wrk le quita CPU al que
  # tiene que servir. Con 2 nucleos, 2 hilos es el equilibrio.
  local hilos=2
  [ "$con" -lt 2 ] && hilos=1

  vigilar "$dur" /tmp/cpu.txt
  local r
  # --latency es imprescindible: sin el, wrk no imprime los percentiles y la
  # media sola engana (una media de 20 ms puede esconder que 1 de cada 100
  # usuarios espera 2 segundos).
  r=$(wrk -t$hilos -c"$con" -d"${dur}s" --latency --timeout 10s $RESOLVER "$HOST$ruta" 2>&1)
  wait $VIGIA 2>/dev/null
  local cpu; cpu=$(cat /tmp/cpu.txt 2>/dev/null || echo "?")

  local rps p50 p99 err noOk
  rps=$(echo "$r"  | grep "Requests/sec" | awk '{print $2}')
  p50=$(echo "$r"  | grep -E "^ +50%" | awk '{print $2}')
  p99=$(echo "$r"  | grep -E "^ +99%" | awk '{print $2}')
  noOk=$(echo "$r" | grep "Non-2xx" | awk '{print $4}')
  err=$(echo "$r"  | grep "Socket errors" | sed 's/.*Socket errors: //')

  # Una medida con respuestas que no son 200 no vale para nada, y encima
  # enganan hacia arriba: rechazar con un 429 es mucho mas rapido que servir
  # la pagina, asi que las peticiones/segundo se disparan. Ya paso dos veces
  # (midiendo la redireccion del puerto 80, y con el limite de conexiones
  # puesto), asi que aqui se marca bien visible en vez de dejarlo en una nota
  # al final de la linea.
  local aviso=""
  if [ -n "${noOk:-}" ]; then
    aviso="  <== INVALIDA: $noOk respuestas no fueron 200"
  fi

  printf "  %-26s %4s con  %9s pet/s  p50 %8s  p99 %8s  CPU %5s%%  %s%s\n" \
    "$nombre" "$con" "${rps:-0}" "${p50:-?}" "${p99:-?}" "$cpu" \
    "${err:-}" "$aviso"
}

# ---------------------------------------------------------------- inicio

if ! command -v wrk >/dev/null; then
  echo "Falta wrk. Instalar con: sudo apt install wrk"
  exit 1
fi

# Dos pruebas a la vez se estorban y dan numeros sin sentido: llegaron a
# salir 0,40 peticiones/s en un endpoint que responde en 40 ms, porque otra
# ejecucion anterior seguia viva y se repartian la maquina.
#
# Se usa un archivo de bloqueo y no `pgrep -f prueba-carga`: ese patron caza
# tambien al `bash -c` que lanzo el script y a cualquier comando de ssh que
# lleve el nombre escrito, asi que el script se detectaba a si mismo y no
# arrancaba nunca.
BLOQUEO="/tmp/prueba-carga.lock"
if [ -e "$BLOQUEO" ] && kill -0 "$(cat "$BLOQUEO" 2>/dev/null)" 2>/dev/null; then
  echo "ERROR: ya hay otra prueba corriendo (pid $(cat "$BLOQUEO"))."
  echo "Si estas seguro de que no, borra $BLOQUEO"
  exit 1
fi
echo $$ > "$BLOQUEO"

if pgrep -x wrk >/dev/null; then
  echo "ERROR: hay un wrk suelto de una prueba anterior. Terminalo con: pkill -x wrk"
  rm -f "$BLOQUEO"
  exit 1
fi

# El resultado no vale si la maquina viene cargada de antes.
CARGA=$(awk '{print $1}' /proc/loadavg)
if [ "$(awk -v c="$CARGA" 'BEGIN{print (c > 1.0)}')" = "1" ]; then
  echo "AVISO: la maquina ya viene cargada (load $CARGA). Esperando a que baje..."
  for _ in $(seq 1 12); do
    sleep 10
    CARGA=$(awk '{print $1}' /proc/loadavg)
    [ "$(awk -v c="$CARGA" 'BEGIN{print (c < 0.5)}')" = "1" ] && break
  done
  echo "  load actual: $CARGA"
fi

exec > >(tee "$SALIDA") 2>&1

echo "Prueba de carga de MacroReborn — modo: $MODO"
echo "Fecha: $(date)"
echo "Maquina: $(nproc) nucleos, $(free -m | awk '/Mem:/{print $2}') MB de RAM"
echo "Procesos de node: $(pgrep -c node)"
echo ""
echo "Antes de empezar:"
free -m | awk '/Mem:/{print "  RAM usada: "$3" MB de "$2" MB"}'
uptime | grep -oE "load average.*" | sed 's/^/  /'

quitar_limites
echo "  (limite de peticiones desactivado durante la prueba)"

# Calentar: la primera peticion siempre es lenta y falsearia el resto.
wrk -t1 -c4 -d5s $RESOLVER "$HOST/" >/dev/null 2>&1

DUR=20
[ "$MODO" = "rapida" ] && DUR=10

titulo "1. La portada (lo que pide todo el que entra)"
for C in 10 50 200 500; do
  medir "portada" "/" "$C" "$DUR"
  [ "$MODO" = "rapida" ] && break
done

titulo "2. Las llamadas a la API"
medir "users (1,4 MB)"      "/api/users?action=listar"           50 "$DUR"
medir "juegos (10 kB)"      "/api/content?action=games-overview" 50 "$DUR"
medir "estadisticas (0,1 kB)" "/api/system?action=community-stats" 50 "$DUR"

if [ "$MODO" != "rapida" ]; then
  titulo "3. Un archivo estatico (CSS)"
  medir "style.css" "/style.css" 200 "$DUR"
fi

if [ "$MODO" = "limite" ]; then
  titulo "4. Buscando el punto de rotura"
  echo "  Subiendo la concurrencia hasta que empiece a fallar."
  for C in 100 250 500 1000 2000 4000; do
    medir "portada" "/" "$C" 15
  done
  echo ""
  echo "  Lo mismo contra el endpoint pesado:"
  for C in 25 50 100 200; do
    medir "users" "/api/users?action=listar" "$C" 15
  done
fi

titulo "Estado al terminar"
free -m | awk '/Mem:/{print "  RAM usada: "$3" MB de "$2" MB"}'
uptime | grep -oE "load average.*" | sed 's/^/  /'
echo "  servicio: $(systemctl is-active macroreborn)"
echo "  reinicios del servicio: $(systemctl show macroreborn -p NRestarts --value)"
echo "  errores en el log: $(sudo journalctl -u macroreborn --since '10 min ago' --no-pager 2>/dev/null | grep -ciE 'error|exception')"

echo ""
echo "Guardado en: $SALIDA"

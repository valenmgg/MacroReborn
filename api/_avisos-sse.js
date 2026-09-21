// ==============================
// LA CONEXION ABIERTA - api/_avisos-sse.js
// ==============================
// La cara HTTP de api/_avisos.js: el sitio por donde un navegador deja
// una linea abierta y se queda esperando. El reparto de avisos no sabe
// nada de HTTP -por eso se puede probar sin levantar un servidor- y esto
// es lo unico que traduce entre las dos cosas.
//
// El formato es Server-Sent Events, que es mas simple de lo que suena.
// La respuesta no se cierra nunca y cada aviso son dos lineas:
//
//     event: nueva-notificacion
//     data: {"titulo":"Te mencionaron"}
//
// Una linea en blanco cierra cada aviso, y una que empieza por ":" es un
// comentario que el navegador ignora. Eso es todo el protocolo.
//
// NO PASA POR EL DESPACHO DE /api/ DE server.js a proposito. Ese despacho
// junta el cuerpo entero de la peticion y luego llama al handler con un
// `res` de mentira que responde de una sola vez. Aqui hace falta
// exactamente lo contrario: el `res` de verdad, y no cerrarlo.

const { suscribir, canalNotificaciones } = require("./_avisos");
const { verificarPase } = require("./_auth");

// Techo de conexiones abiertas POR PROCESO. Antes este riesgo lo absorbia
// Pusher; ahora lo absorbe una maquina de 950 MB. Una conexion ociosa
// cuesta poco, pero "poco" multiplicado por infinito sigue siendo la
// maquina. Con dos procesos el techo real es el doble, y sobra: el sitio
// tiene 141 cuentas.
const TOPE_CONEXIONES = 400;

// Cuantos canales puede pedir UNA conexion. js/usuario.js necesita dos
// -el tuyo y el del perfil que estas mirando-; cuatro deja aire. Sin
// tope, una URL a mano apunta una sola conexion a mil canales.
const TOPE_CANALES = 4;

// Un nombre de canal mas largo que esto no es un nombre de canal.
const TOPE_NOMBRE = 80;

// Cada 25 segundos se manda un comentario que el navegador tira. No es
// decorativo: nginx corta la conexion con el backend si pasan 60
// segundos sin que llegue un byte (proxy_read_timeout), y ademas es la
// unica forma de enterarse de que el navegador se fue sin avisar.
const LATIDO_MS = 25000;

// Si el navegador deja de leer -pestana congelada, red muerta- Node
// acumula en memoria todo lo que no puede entregar. Pasado este tamano,
// esa conexion se corta: es preferible que se reconecte y vuelva a pedir
// a que se coma la RAM del proceso.
const TOPE_PENDIENTE = 1024 * 1024;

// ==============================
// QUIEN PUEDE OIR QUE
// ==============================
// Por el canal de una persona viajan siete avisos, y no todos son de la
// misma naturaleza. Dos son suyos y de nadie mas: nueva-notificacion
// lleva dentro el titulo y el texto de lo que le acaba de llegar al
// buzon, y estado-bloqueo dice quien la bloqueo o desbloqueo. Los otros
// cinco -comentarios, actividad, historial, logros y el latido de
// "ultima conexion"- son lo que su perfil ya ensena a cualquiera que lo
// abra, con cuenta o sin ella.
//
// Asi que la linea NO pide sesion para abrirse: un visitante anonimo
// mirando un perfil sigue viendo aparecer los comentarios al vuelo, como
// hasta ahora. Lo que cambia es que los dos avisos privados SOLO salen
// por la linea que demostro ser de su dueno con un pase (api/_auth.js,
// "EL PASE"). Por cualquier otra linea se callan.
//
// Antes salian por todas. El canal siempre fue publico a proposito, y con
// Pusher no pasaba nada porque el aviso era un toque sin contenido; al
// sustituirlo, la notificacion entera empezo a viajar dentro y nadie
// volvio a mirar quien escuchaba. Cualquiera podia abrir
// "notificaciones-fulano" y leer el buzon de fulano en vivo.
const EVENTOS_PRIVADOS = new Set(["nueva-notificacion", "estado-bloqueo"]);

let abiertas = 0;

function cuantasAbiertas() {
  return abiertas;
}

function haySitio() {
  return abiertas < TOPE_CONEXIONES;
}

// Saca los canales pedidos de ?canales=a,b,c
function canalesPedidos(url) {
  return String(url.searchParams.get("canales") || "")
    .split(",")
    .map(c => c.trim())
    .filter(c => c.length > 0 && c.length <= TOPE_NOMBRE)
    .slice(0, TOPE_CANALES);
}

function atender(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "application/json; charset=utf-8", "Allow": "GET" });
    return res.end(JSON.stringify({ success: false, error: "Solo GET" }));
  }

  const canales = canalesPedidos(url);
  if (canales.length === 0) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ success: false, error: "Falta ?canales=" }));
  }

  // De quien es esta linea. Sin pase, de nadie: anonima, y solo oye lo
  // publico. Con un pase malo o caducado, 401 y no 403: EventSource se
  // rinde ante cualquier codigo que no sea 200, y js/avisos.js entiende
  // esa rendicion como "pide otro pase y vuelve", que es justo lo que
  // hace falta cuando el pase caduco durante una reconexion.
  const pase = url.searchParams.get("pase");
  let canalPropio = null;
  if (pase) {
    const quien = verificarPase(pase);
    if (!quien) {
      res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ success: false, error: "Pase no valido o caducado" }));
    }
    canalPropio = canalNotificaciones(quien.username);
  }

  if (!haySitio()) {
    // 503 y no 429: no es que esta persona pida demasiado, es que el
    // proceso esta lleno. Retry-After evita que todos vuelvan a la vez.
    res.writeHead(503, {
      "Content-Type": "application/json; charset=utf-8",
      "Retry-After": "30"
    });
    return res.end(JSON.stringify({ success: false, error: "Sin sitio para mas conexiones" }));
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    // no-transform ademas de no-cache: le pide a cualquier proxy que no
    // recomprima ni reempaquete la respuesta, que con un flujo que no
    // termina significa quedarselo entero sin entregar nada.
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    // La instruccion que de verdad importa detras de nginx: sin ella
    // nginx acumula la respuesta en su buffer y no suelta un byte hasta
    // que se cierre, que es justo lo que no va a pasar nunca.
    "X-Accel-Buffering": "no"
  });

  abiertas++;

  // Cuanto espera el navegador antes de reconectar. Se reparte al azar
  // entre 5 y 10 segundos a proposito: al reiniciar el servicio se caen
  // TODAS las conexiones a la vez, y con un valor fijo volverian todas
  // juntas al mismo segundo. El azar las desparrama.
  const espera = 5000 + Math.floor(Math.random() * 5000);
  res.write("retry: " + espera + "\n");
  res.write(": abierto\n\n");

  let cerrado = false;

  // El canal viaja DENTRO del mensaje. SSE no tiene un sitio para el, y
  // sin el no se puede saber por cual vino: una misma conexion escucha
  // varios -js/usuario.js escucha el tuyo y el del perfil que miras- y
  // los dos mandan los mismos eventos. Sin distinguirlos, un comentario
  // en el perfil ajeno repintaria tambien el propio.
  function escribir(canal, evento, datos) {
    if (cerrado) return;

    // Lo privado solo sale por la linea de su dueno. El resto, por todas.
    if (EVENTOS_PRIVADOS.has(evento) && canal !== canalPropio) return;

    // El navegador dejo de leer y lo pendiente ya no cabe: se corta. Como
    // EventSource reconecta solo, esto se ve como un parpadeo, no como
    // una perdida de servicio.
    if (res.writableLength > TOPE_PENDIENTE) {
      cerrar();
      res.destroy();
      return;
    }

    const sobre = { canal: canal, datos: datos === undefined ? null : datos };
    res.write("event: " + evento + "\n");
    res.write("data: " + JSON.stringify(sobre) + "\n\n");
  }

  const bajas = canales.map(canal =>
    suscribir(canal, (evento, datos) => escribir(canal, evento, datos)));

  const latido = setInterval(() => {
    if (cerrado) return;
    res.write(": latido\n\n");
  }, LATIDO_MS);
  // Sin unref, este temporizador mantiene vivo el proceso el solo. El que
  // tiene que sostenerlo es el socket, no el latido.
  if (latido.unref) latido.unref();

  function cerrar() {
    if (cerrado) return;
    cerrado = true;
    abiertas--;
    clearInterval(latido);
    for (const baja of bajas) baja();
  }

  // Los tres: "close" del pedido cubre al navegador que se va, "close"
  // de la respuesta cubre el corte por nuestra parte, y "error" cubre el
  // socket que muere sin decirlo. Cerrar es idempotente, asi que que
  // salten los tres no molesta.
  req.on("close", cerrar);
  res.on("close", cerrar);
  res.on("error", cerrar);

  return cerrar;
}

module.exports = {
  atender,
  cuantasAbiertas,
  haySitio,
  canalesPedidos,
  EVENTOS_PRIVADOS,
  TOPE_CONEXIONES,
  TOPE_CANALES,
  TOPE_NOMBRE,
  LATIDO_MS,
  TOPE_PENDIENTE
};

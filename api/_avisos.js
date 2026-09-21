// ==============================
// AVISOS EN VIVO - api/_avisos.js
// ==============================
// El reemplazo de api/_pusher.js. Hace lo mismo -contarle al navegador
// que paso algo, apenas pasa, sin que tenga que recargar- pero desde
// esta misma maquina, sin alquilarle la linea a nadie.
//
// POR QUE EXISTIA PUSHER Y POR QUE YA NO HACE FALTA. En Vercel el codigo
// del servidor corria en funciones que viven unos segundos y se apagan.
// Una funcion asi NO PUEDE sostener una conexion abierta con un
// navegador, y sostenerla es exactamente lo que hace falta para empujar
// un aviso. Por eso habia que alquilarsela a un tercero: no era un
// capricho, era la unica salida. Desde la mudanza al VPS hay un proceso
// de Node encendido de forma permanente, asi que la limitacion que
// justificaba Pusher se fue con ella.
//
// LA TECNICA es Server-Sent Events: una respuesta HTTP que no se cierra.
// El navegador pide una vez y el servidor le va escribiendo lineas a
// medida que tiene algo que contar. Va nativo en el navegador
// (EventSource) y de este lado es HTTP del de siempre, asi que no suma
// dependencias en ninguno de los dos extremos. De hecho quita las dos
// que habia: el paquete "pusher" y el <script> de js.pusher.com que
// cargaban 22 paginas.
//
// Se eligio SSE y no WebSocket porque los diez avisos del sitio van en
// UNA sola direccion, del servidor al navegador. Ninguno va al reves: un
// mensaje de chat se manda por una peticion normal. Un WebSocket es una
// linea de dos direcciones y aqui sobraria la mitad.
//
// EL DETALLE QUE LO COMPLICA TODO: cluster.js arranca DOS procesos. La
// conexion abierta de una persona la sostiene uno solo de ellos, y el
// aviso puede generarse en el otro, que no la tiene y no puede
// alcanzarla. El propio cluster.js lo dejo advertido: "si algun dia se
// guarda algo en memoria y se espera que persista, dejara de serlo".
//
// Se resuelve sin agregar nada: Postgres trae LISTEN/NOTIFY, un sistema
// de avisos entre conexiones. Quien genera el aviso hace NOTIFY, los dos
// procesos estan escuchando, y el que sostiene la conexion la atiende.
// La base ya esta ahi y el driver ya lo soporta.

// Canal fijo de Postgres por el que viaja TODO. El canal de verdad
// -"notificaciones-fulano"- va dentro del mensaje y no en el nombre del
// canal de Postgres, que tendria que ser un identificador valido y
// obligaria a escapar nombres de usuario. Un solo canal, cero escapado.
const CANAL_POSTGRES = "mr_avisos";

// NOTIFY no admite cargas de mas de 8000 bytes: Postgres responde con un
// error y, sin este tope, un aviso grande tumbaria la escritura que lo
// origino. Se deja margen para el sobre (canal, evento y comillas).
const TOPE_CARGA = 7000;

// canal -> Set de funciones que escriben en una respuesta abierta.
const oyentes = new Map();

// Cuantas escuchas hay apuntadas, sumando todos los canales. NO es lo
// mismo que cuantas conexiones hay abiertas: una sola conexion puede
// escuchar varios canales a la vez -js/usuario.js escucha el tuyo y el
// del perfil que estas mirando-, y entonces cuenta como dos. El techo de
// conexiones se lleva en api/_avisos-sse.js, que es quien las tiene.
let escuchas = 0;

// ---------- EL REGISTRO LOCAL ----------

// Apunta a una escucha en un canal y devuelve como darse de baja. La
// baja se devuelve en vez de exponer un quitar(canal, escucha) porque
// quien se suscribe casi nunca conserva la referencia exacta a su propia
// funcion, y una baja que no encuentra a quien dar de baja no falla:
// simplemente deja la conexion colgada para siempre.
function suscribir(canal, escucha) {
  if (!canal || typeof escucha !== "function") return () => {};

  if (!oyentes.has(canal)) oyentes.set(canal, new Set());
  oyentes.get(canal).add(escucha);
  escuchas++;

  let dadaDeBaja = false;
  return function cancelar() {
    // Idempotente a proposito: la baja se dispara desde dos sitios que no
    // se coordinan -el "close" de la respuesta y el cierre a mano- y sin
    // esto la segunda vez descontaria una conexion que ya no existe.
    if (dadaDeBaja) return;
    dadaDeBaja = true;
    escuchas--;

    const grupo = oyentes.get(canal);
    if (!grupo) return;
    grupo.delete(escucha);
    if (grupo.size === 0) oyentes.delete(canal);
  };
}

// Entrega un aviso a quien lo escucha EN ESTE PROCESO.
function repartir(canal, evento, datos) {
  const grupo = oyentes.get(canal);
  if (!grupo) return 0;

  let entregados = 0;
  // Sobre una COPIA, y no por lo que parece: borrar del Set mientras se
  // recorre es seguro en JavaScript, asi que la expulsion de una escucha
  // rota no necesita esto. Lo que si necesita es lo contrario: un Set en
  // vivo tambien entrega a quien se APUNTA durante el reparto, y una
  // escucha que se suscribe al recibir un aviso cobraria ese mismo aviso
  // que la hizo nacer. La copia congela quien estaba cuando empezo.
  for (const escucha of [...grupo]) {
    try {
      escucha(evento, datos);
      entregados++;
    } catch (error) {
      console.warn("Avisos: una conexion fallo al recibir; se la deja ir.", error.message);
      grupo.delete(escucha);
    }
  }
  return entregados;
}

function cuantosEscuchan(canal) {
  const grupo = oyentes.get(canal);
  return grupo ? grupo.size : 0;
}

function cuantasEscuchas() {
  return escuchas;
}

// ---------- EL PUENTE ENTRE PROCESOS ----------

let cliente = null;      // conexion pg dedicada al LISTEN
let busArrancado = false;
let reintento = null;

// Hace falta una conexion PROPIA, no una del pool: un LISTEN vive en la
// conexion que lo declara, y una del pool vuelve al pool en cuanto
// termina la consulta. El aviso llegaria a una conexion que ya no es la
// nuestra, o a ninguna.
function urlDePostgres() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  // El driver de Neon habla por HTTPS y no tiene LISTEN. Si algun dia se
  // vuelve a apuntar ahi, mejor quedarse sin puente que romper el aviso.
  if (url.includes(".neon.tech")) return null;
  return url;
}

async function arrancarBus() {
  if (busArrancado) return true;

  const url = urlDePostgres();
  if (!url) return false;

  const { Client } = require("pg");
  cliente = new Client({ connectionString: url });

  cliente.on("notification", (mensaje) => {
    if (mensaje.channel !== CANAL_POSTGRES) return;
    let sobre;
    try {
      sobre = JSON.parse(mensaje.payload);
    } catch (error) {
      console.warn("Avisos: llego un mensaje que no es JSON; se ignora.");
      return;
    }
    if (sobre && sobre.canal && sobre.evento) {
      repartir(sobre.canal, sobre.evento, sobre.datos);
    }
  });

  // Si Postgres se reinicia, esta conexion muere y con ella el LISTEN. Sin
  // reenganche, el sitio seguiria en pie pero mudo hasta el siguiente
  // despliegue, que es la peor forma de fallar: sin sintoma visible.
  cliente.on("error", (error) => {
    console.warn("Avisos: se corto la conexion de escucha.", error.message);
    busArrancado = false;
    cliente = null;
    if (!reintento) {
      reintento = setTimeout(() => {
        reintento = null;
        arrancarBus().catch(() => {});
      }, 5000);
      if (reintento.unref) reintento.unref();
    }
  });

  await cliente.connect();
  await cliente.query("LISTEN " + CANAL_POSTGRES);
  busArrancado = true;
  return true;
}

async function pararBus() {
  if (reintento) { clearTimeout(reintento); reintento = null; }
  busArrancado = false;
  const c = cliente;
  cliente = null;
  if (c) { try { await c.end(); } catch (_) {} }
}

function busActivo() {
  return busArrancado && cliente !== null;
}

// ---------- PUBLICAR ----------

// Manda un aviso a todo el que escuche ese canal, en cualquiera de los
// procesos.
//
// Con puente se publica SOLO por NOTIFY y no se entrega tambien en local:
// Postgres devuelve el aviso tambien a la conexion que lo emitio, asi que
// hacer las dos cosas lo entregaria dos veces a quien esta en este mismo
// proceso. Un solo camino, una sola entrega.
async function avisar(canal, evento, datos) {
  if (!canal || !evento) return false;

  if (!busActivo()) {
    // Sin puente -tests, o un solo proceso- la entrega local es la
    // entrega completa, y es correcta.
    repartir(canal, evento, datos);
    return true;
  }

  let sobre = JSON.stringify({ canal, evento, datos: datos === undefined ? null : datos });

  if (sobre.length > TOPE_CARGA) {
    // Mejor el aviso sin su contenido que ningun aviso: casi todas las
    // escuchas del navegador ignoran los datos y vuelven a pedir lo que
    // necesitan. El unico que los usa de verdad es el toast, y una
    // notificacion no llega a este tamano.
    console.warn(`Avisos: ${evento} pesaba ${sobre.length} bytes; va sin contenido.`);
    sobre = JSON.stringify({ canal, evento, datos: null });
  }

  try {
    await cliente.query("SELECT pg_notify($1, $2)", [CANAL_POSTGRES, sobre]);
    return true;
  } catch (error) {
    console.warn("Avisos: no se pudo publicar; se entrega solo en este proceso.", error.message);
    repartir(canal, evento, datos);
    return false;
  }
}

// ---------- NOMBRES DE CANAL ----------

// Igual que el de api/_pusher.js, y el nombre sigue siendo publico:
// cualquiera que adivine un nombre de usuario puede pedir su canal. Lo
// que ya NO es publico es todo lo que viaja por el: desde el 21/09/2026
// api/_avisos-sse.js solo entrega nueva-notificacion y estado-bloqueo
// por la linea que trae un pase de su dueno. El comentario que habia
// aqui decia que por el canal no se podia "leer nada"; era verdad con
// Pusher, que mandaba un toque sin contenido, y dejo de serlo cuando la
// notificacion entera empezo a viajar dentro del aviso.
function canalNotificaciones(username) {
  return "notificaciones-" + String(username).toLowerCase();
}

module.exports = {
  avisar,
  canalNotificaciones,
  suscribir,
  repartir,
  cuantosEscuchan,
  cuantasEscuchas,
  arrancarBus,
  pararBus,
  busActivo,
  CANAL_POSTGRES,
  TOPE_CARGA
};

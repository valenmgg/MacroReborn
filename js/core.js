// ============================================
// MacroReborn — core.js
// Utilidades compartidas por todas las páginas.
// Se carga PRIMERO en cada HTML para que el resto
// de los scripts puedan usar leerJSON() de forma segura.
// ============================================

// ============================================
// ESCAPAR TEXTO ANTES DE METERLO EN HTML
// ============================================
// Un solo sitio con la versión correcta, disponible en las 28 páginas
// porque core.js se carga en todas.
//
// Por qué hacía falta: había 19 copias de "escaparHTML" repartidas por
// js/, en tres variantes con distinta cobertura, y las páginas que
// pintan lo que escriben OTROS usuarios eran justo las que no tenían
// ninguna. Tres XSS almacenados salieron de ahí: la biografía en la
// lista de comunidad, el título y el mensaje de una notificación, y el
// texto de un reporte dentro del panel de administración -este último
// se ejecuta en el navegador de un administrador, y con el token de
// sesión en localStorage eso es la cuenta entera.
//
// Escapa también las comillas, que es lo que le falta a la variante más
// repetida (la del truco `div.textContent` + `div.innerHTML`): esa
// escapa & < > pero NUNCA las comillas, porque en un nodo de texto no
// hacen falta. El problema es que el resultado se mete dentro de
// atributos -title="...", data-usuario="..."- y ahí una comilla se sale
// del atributo sin necesidad de un solo "<".
//
// Se llama MRTexto y no escaparHTML a propósito: varios archivos
// declaran su propia función con ese nombre en el ámbito global, y dos
// declaraciones iguales se pisan según el orden de carga. Unificar las
// 19 copias es otra tarea (docs/AUDITORIA.md, punto 73); esto no la
// estorba.
const MRTexto = {
  escapar(valor) {
    return String(valor === null || valor === undefined ? "" : valor)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
};

if (typeof window !== "undefined") window.MRTexto = MRTexto;

// urlAvatarCompuesto se declara mas abajo, junto al resto del avatar.
// Se expone al final del archivo.

/**
 * Envoltorio seguro de JSON.parse.
 * Si el valor guardado en localStorage está corrupto o mal formado,
 * en vez de romper toda la ejecución del script devuelve null
 * (igual que si la clave no existiera), y deja un aviso en consola.
 */
function leerJSON(valorCrudo) {
  try {
    return JSON.parse(valorCrudo);
  } catch (error) {
    console.warn("MacroReborn: dato corrupto en localStorage, se ignora.", error);
    return null;
  }
}

/**
 * Envoltorio seguro para guardar en localStorage.
 * Evita que un error de guardado (por ejemplo, cuota superada)
 * detenga la ejecución del resto del script.
 */
function guardarJSON(clave, valor) {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
    return true;
  } catch (error) {
    console.warn("MacroReborn: no se pudo guardar en localStorage.", error);
    return false;
  }
}

/**
 * Convierte una fecha/timestamp en un texto relativo tipo
 * "Hace 5 minutos", "Hace 3 horas", "Hace 2 días", etc.
 * Acepta un número (epoch en ms) o un string de fecha parseable.
 * Si no se puede interpretar, devuelve el valor de "porDefecto".
 */
function tiempoRelativo(fechaOTimestamp, porDefecto) {
  if (fechaOTimestamp === undefined || fechaOTimestamp === null || fechaOTimestamp === "") {
    return porDefecto !== undefined ? porDefecto : "Nunca";
  }

  const fecha = new Date(fechaOTimestamp);

  if (isNaN(fecha.getTime())) {
    return porDefecto !== undefined ? porDefecto : "Nunca";
  }

  const segundos = Math.floor((Date.now() - fecha.getTime()) / 1000);

  if (segundos < 0) return "Hace unos segundos";
  if (segundos < 60) return "Hace unos segundos";

  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return "Hace " + minutos + (minutos === 1 ? " minuto" : " minutos");

  const horas = Math.floor(minutos / 60);
  if (horas < 24) return "Hace " + horas + (horas === 1 ? " hora" : " horas");

  const dias = Math.floor(horas / 24);
  if (dias < 30) return "Hace " + dias + (dias === 1 ? " día" : " días");

  const meses = Math.floor(dias / 30);
  if (meses < 12) return "Hace " + meses + (meses === 1 ? " mes" : " meses");

  const anios = Math.floor(meses / 12);
  return "Hace " + anios + (anios === 1 ? " año" : " años");
}






// ==============================
// SESIÓN API — token firmado
// ==============================
// El navegador sigue usando localStorage para la interfaz, pero las
// escrituras contra la API llevan además el token de sesión firmado
// que devuelve /api/auth. Así el backend puede comprobar quién está
// haciendo realmente una modificación y no confiar en un username
// enviado por el cliente.
(function instalarInterceptorApi() {
  if (window.__macroRebornFetchProtegido) return;
  window.__macroRebornFetchProtegido = true;

  const fetchOriginal = window.fetch.bind(window);
  window.fetch = function(url, options = {}) {
    try {
      const destino = new URL(url, window.location.href);
      const esApi = destino.origin === window.location.origin && destino.pathname.startsWith('/api/');
      if (esApi) {
        const token = localStorage.getItem('macroSessionToken');
        if (token) {
          const headers = new Headers(options.headers || {});
          if (!headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + token);
          options = { ...options, headers };
        }
      }
    } catch (_) {}
    return fetchOriginal(url, options);
  };
})();

// ==============================
// PRESENCIA (usuarios "conectados ahora")
// ==============================
// Sistema liviano de latido para aproximar cuántos usuarios están
// usando MacroReborn en este momento, pensado para el panel de
// estadísticas del administrador. Como todo el sitio vive en
// localStorage (sin servidor), no hay forma de saber en tiempo real
// quién está conectado desde otra máquina: lo que sí se puede hacer es
// que, cada vez que carga una página con un usuario con sesión
// iniciada EN ESTE NAVEGADOR, se guarde la hora en un mapa
// { nombre: timestamp } bajo una única clave global
// ("presenciaMacro"). Un usuario cuenta como "conectado ahora" si tiene
// un latido de los últimos MINUTOS_CONECTADO minutos.
//
// En la v1.0 con servidor esto se reemplaza por sesiones reales
// (websockets, "último ping", etc.) sin tocar admin.js: alcanza con
// que "obtenerUsuariosConectadosAhora" pida la lista a una API.

const MINUTOS_CONECTADO = 5;

function _registrarLatidoPresencia(){

  const activo = (window.MRSession && typeof MRSession.get === "function")
    ? MRSession.get()
    : leerJSON(localStorage.getItem("usuarioActivo") || "null");
  if(!activo || !activo.nombre) return;

  const mapa = leerJSON(localStorage.getItem("presenciaMacro") || "{}") || {};
  mapa[activo.nombre] = Date.now();

  guardarJSON("presenciaMacro", mapa);

}

function obtenerUsuariosConectadosAhora(){

  const mapa = leerJSON(localStorage.getItem("presenciaMacro") || "{}") || {};
  const limite = Date.now() - (MINUTOS_CONECTADO * 60 * 1000);

  return Object.keys(mapa).filter(nombre => mapa[nombre] >= limite);

}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", _registrarLatidoPresencia);
}else{
  _registrarLatidoPresencia();
}




// ==============================
// LATIDO AL SERVIDOR (last_login real, Fase 1: Neon)
// ==============================
// Complementa al latido local de arriba: ese solo sirve dentro de ESTE
// navegador (localStorage no se comparte entre dispositivos). Para que
// "Comunidad" pueda saber quién está conectado de verdad sin importar
// desde qué navegador/dispositivo, refrescamos periódicamente
// "last_login" en Neon mientras haya una sesión iniciada con una
// pestaña abierta. js/comunidad.js considera "conectado" a cualquier
// usuario cuyo last_login sea de los últimos MINUTOS_CONECTADO minutos
// (misma constante de arriba).

const MINUTOS_LATIDO_SERVIDOR = 2; // más seguido que el umbral de "conectado" (5 min)

function _latidoServidor(){

  const activo = (window.MRSession && typeof MRSession.get === "function")
    ? MRSession.get()
    : leerJSON(localStorage.getItem("usuarioActivo") || "null");
  if(!activo || !activo.nombre) return;

  const token = (window.MRSession && typeof MRSession.getToken === "function")
    ? MRSession.getToken()
    : localStorage.getItem("macroSessionToken");
  if (!token) return;

  fetch("/api/users?action=heartbeat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + token
    },
    body: JSON.stringify({ username: activo.nombre })
  }).catch(() => {
    // Si falla (sin conexión, etc.) no rompe nada: se reintenta solo
    // en el próximo latido.
  });

}

function _iniciarLatidoServidor(){
  _latidoServidor();
  setInterval(_latidoServidor, MINUTOS_LATIDO_SERVIDOR * 60 * 1000);
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", _iniciarLatidoServidor);
}else{
  _iniciarLatidoServidor();
}




// ==============================
// AVATAR — NORMALIZACIÓN (Fase 1: Neon)
// ==============================
// El avatar ahora viaja dentro de cada usuario (columna users.avatar,
// guardada como JSON) en vez de vivir en la clave localStorage
// "avatar_<nombre>". Según el driver, esa columna puede llegar ya
// parseada como objeto o como texto crudo: esta función normaliza
// cualquiera de los dos casos a un objeto de capas (o null si el
// usuario todavía no armó su avatar), para que el resto del sitio siga
// trabajando con el mismo objeto { modelo, fondo, pelo, ... } de
// siempre.

function normalizarAvatar(valor){
  if(!valor) return null;
  if(typeof valor === "string"){
    return leerJSON(valor);
  }
  return valor;
}

// Avatar especial exclusivo de administradores. Viaja como un objeto
// compacto { tipo:"png", src:"data:image/png;base64,..." } dentro de
// users.avatar, por lo que funciona igual en perfiles, ranking, chat,
// buscador y actividad sin depender del sistema de capas.
// Puede llegar de dos formas, y las dos terminan en un src que se le
// puede poner a un <img>:
//
//   { tipo:"png", src:"data:image/png;base64,..." }  -> la imagen entera
//   { tipo:"png", url:"/api/users?action=avatar-png..." } -> un puntero
//
// La segunda es la que viaja en las listas de usuarios (ranking,
// comunidad, buscador, actividad). Antes iba el base64 completo en cada
// lista: un solo avatar PNG hacía que /api/users pesara 1,35 MB y todo
// el mundo se lo descargaba al abrir la comunidad, sin poder cachearlo.
// Ahora va un puntero de unos 80 bytes y el navegador pide la imagen
// una sola vez, como cualquier otra.
//
// El base64 directo se sigue aceptando porque es lo que devuelve
// /api/users?username=X y lo que el editor del perfil maneja mientras
// se está cambiando el avatar.
function avatarPNGData(avatarCrudo){
  const avatar = normalizarAvatar(avatarCrudo);
  if(!avatar || avatar.tipo !== "png") return null;

  if(typeof avatar.src === "string"){
    return /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(avatar.src) ? avatar.src : null;
  }

  // Solo rutas propias: nunca una URL que venga de afuera.
  if(typeof avatar.url === "string" && avatar.url.startsWith("/api/users?action=avatar-png")){
    return avatar.url;
  }

  return null;
}

function avatarEsPNG(avatarCrudo){
  return !!avatarPNGData(avatarCrudo);
}

function avatarPNGImgHTML(avatarCrudo, clase="", alt="") {
  const src = avatarPNGData(avatarCrudo);
  if(!src) return "";
  const cls = clase ? ` class="${clase}"` : "";
  const altSeguro = String(alt || "").replace(/[&<>"]/g, caracter => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[caracter]));
  return `<img${cls} src="${src}" alt="${altSeguro}" loading="lazy">`;
}




// ==============================
// AVATAR DE OTROS USUARIOS — CACHÉ (Fase 2: cierre de migración)
// ==============================
// Varios lugares del sitio (chat, comentarios de perfil, reseñas,
// actividad de amigos) necesitan pintar el avatar de OTRO usuario de
// forma sincrónica dentro de un bucle de render. Antes leían
// "avatar_<nombre>" de localStorage, una clave que solo existía en el
// navegador donde ese usuario había armado su avatar (nunca en el de
// quien está mirando), así que en la práctica siempre mostraban el
// avatar por defecto. Mismo criterio que _cacheInsignias en
// js/motor/insignias.js: una caché en memoria que se llena con
// cargarAvatarUsuario()/cargarAvataresDeVarios() antes de renderizar,
// y un getter sincrónico (obtenerAvatarCacheado) para usar en el HTML.

const _cacheAvatares = {};
const _peticionesAvatares = {};

function obtenerAvatarCacheado(nombre){
  return Object.prototype.hasOwnProperty.call(_cacheAvatares, nombre)
    ? _cacheAvatares[nombre]
    : null;
}

async function cargarAvatarUsuario(nombre){

  if(!nombre) return null;

  if(Object.prototype.hasOwnProperty.call(_cacheAvatares, nombre)){
    return _cacheAvatares[nombre];
  }

  if(_peticionesAvatares[nombre]){
    return _peticionesAvatares[nombre];
  }

  _peticionesAvatares[nombre] = (async function(){
    try{
      // ligero=1: esto es para DIBUJAR el avatar de otra persona, no
      // para editarlo. Sin ese parámetro llega el PNG entero en base64
      // dentro del JSON; con él llega un puntero de unos 80 bytes y la
      // imagen se pide aparte, cacheada un año por su huella.
      //
      // Una sola de estas llamadas pesaba 1.313 kB en una carga real del
      // perfil. avatarPNGData() entiende las dos formas.
      const resp = await fetch("/api/users?ligero=1&username=" + encodeURIComponent(nombre));
      const datos = await resp.json();
      const avatar = (datos && datos.success) ? normalizarAvatar(datos.user.avatar) : null;
      _cacheAvatares[nombre] = avatar;
      return avatar;
    }catch(error){
      console.warn("MacroReborn: no se pudo cargar el avatar.", error);
      return _cacheAvatares[nombre] || null;
    }finally{
      delete _peticionesAvatares[nombre];
    }
  })();

  return _peticionesAvatares[nombre];

}

// Trae los avatares de varios usuarios de una vez (listas: chat,
// comentarios, reseñas, actividad), un pedido por nombre único.

async function cargarAvataresDeVarios(nombres){

  const unicos = [...new Set((nombres || []).filter(Boolean))]
    .filter(nombre => !Object.prototype.hasOwnProperty.call(_cacheAvatares, nombre));

  if(!unicos.length) return;

  await Promise.all(unicos.map(nombre => cargarAvatarUsuario(nombre)));

}




// ==============================
// FECHA LEGIBLE (Fase 1: Neon)
// ==============================
// Convierte una fecha/timestamp (ISO de Neon, epoch, etc.) en un
// texto corto y legible tipo "05/08/2026 13:53" (formato es-AR).
// Mismo criterio de "porDefecto" que ya usa tiempoRelativo() más
// arriba. Se usa, por ejemplo, para "Registrado" en perfil.html y
// usuario.html, que hasta ahora mostraban el ISO crudo de Neon.

function fechaLegible(fechaOTimestamp, porDefecto){
  if (fechaOTimestamp === undefined || fechaOTimestamp === null || fechaOTimestamp === "") {
    return porDefecto !== undefined ? porDefecto : "Desconocida";
  }

  const fecha = new Date(fechaOTimestamp);

  if (isNaN(fecha.getTime())) {
    return porDefecto !== undefined ? porDefecto : "Desconocida";
  }

  const fechaCorta = fecha.toLocaleDateString("es-AR");
  const horaCorta = fecha.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

  return fechaCorta + " " + horaCorta;
}


// ==============================
// ¿ESTÁ CONECTADO? (Fase 2: cierre de migración)
// ==============================
// Mismo criterio que ya usa comunidad.js para la lista de "jugadores
// conectados": se considera en línea si tuvo actividad (last_login,
// refrescado por el latido de _iniciarLatidoServidor más arriba)
// dentro de los últimos MINUTOS_CONECTADO minutos. Se centraliza acá
// (con un nombre propio para no pisar la función local que ya tiene
// comunidad.js) para que cualquier otra página -como usuario.html-
// pueda mostrar el estado real de conexión de un usuario sin
// reinventar este cálculo.

function usuarioEstaConectado(usuario){
  if(!usuario || !usuario.last_login) return false;

  const ultima = new Date(usuario.last_login).getTime();
  if(isNaN(ultima)) return false;

  return (Date.now() - ultima) <= MINUTOS_CONECTADO * 60 * 1000;
}


// ==============================
// AVATAR EN MINIATURA — HTML COMPARTIDO (Fase 2: cierre de migración)
// ==============================
// Arma el HTML de un avatar en miniatura (capas apiladas) a partir
// del valor crudo guardado en users.avatar (string JSON u objeto ya
// normalizado). Misma convención de rutas que ya usan
// comunidad.js/amigos.js/usuario.js/chat.js: el "modelo" (ej. "tora")
// vive en imagenes/tora.png, y cada capa de guardarropa (ej.
// "tora_pelo1") vive en imagenes/tora/pelo1.png. Si el usuario no
// tiene avatar guardado, devuelve el avatar por defecto
// (imagenes/avatar.png) — nunca genera uno al azar.
//
// El HTML se arma con estilos inline (mismo criterio "top:0;left:0;
// width:100%;height:100%;object-fit:contain" que ya usan
// usuario.js/amigos.js/comunidad.js para el avatar principal) para
// que se vea bien en CUALQUIER contenedor, sin depender de que la
// página tenga cargado css/perfil.css ni de un tamaño fijo en
// píxeles. Así se puede reutilizar en lugares nuevos como el panel
// del buscador (ítems chicos) o la bienvenida de Inicio, además de
// los que ya arman este mismo HTML "a mano" en cada archivo.

// ==============================
// CAPAS DE AVATAR — fuente única del navegador
// ==============================
// Estas dos son las versiones buenas para todo el frontend. core.js se
// carga antes que cualquier otro script en todas las páginas que dibujan
// avatares, así que el resto de archivos usan estas y no su propia copia.
//
// Antes cada archivo llevaba la suya: once copias de la lista, y dos de
// ellas (ranking.js y comunidad-ranking.js) con "pantalon" antes que
// "botas". El orden es el orden de dibujo, así que el mismo avatar salía
// con las botas encima del pantalón en esas dos páginas y debajo en el
// resto. Si hay que cambiar el orden, se cambia acá y en CAPAS de
// api/_avatar-catalogo.js, que es el gemelo del servidor.

const ORDEN_CAPAS_AVATAR = [
  "fondo","espalda","modelo","piel","ojos","boca",
  "botas","pantalon","remera","guantes","accesorio",
  "cara","pelo","mascota","borde"
];

// ------------------------------------------------------------------
// EL CATÁLOGO, PARA TODAS LAS PÁGINAS
// ------------------------------------------------------------------
// Un mapa de valor -> URL del dibujo, que llega de /api/content.
//
// Hasta ahora esto solo lo tenía el editor del perfil, y el resto de las
// páginas armaban la ruta a mano a partir del valor guardado. Funcionaba
// gracias a una vía de compatibilidad en server.js que, cuando el
// fichero no está en el disco, busca la prenda en la base. Pero esa vía
// se cachea con revalidación cada 5 minutos, porque el nombre no dice
// nada del contenido y una prenda podría cambiar de dibujo.
//
// La URL del catálogo lleva la huella SHA-256 del contenido, así que
// puede cachearse un año y de verdad: si el dibujo cambiara, cambiaría
// la URL. Poniendo el mapa acá lo heredan de una vez los ocho archivos
// que dibujan avatares, porque todos pasan por rutaCapaAvatar().
const RUTAS_DE_PRENDA = new Map();
let _promesaCatalogoAvatares = null;

function cargarCatalogoAvatares(){
  if(_promesaCatalogoAvatares) return _promesaCatalogoAvatares;

  // Este es el índice PÚBLICO, y trae una sola cosa: valor -> URL del
  // dibujo, de las prendas que alguien lleva puestas. Nada de nombres,
  // ranuras ni precios.
  //
  // Antes esta misma llamada bajaba el catálogo entero -las 630 prendas
  // con todos sus datos-, y lo bajaba sin sesión. Eso convertía una
  // petición en el índice completo del trabajo del equipo de dibujo, y
  // las 630 descargas siguientes en una copia del catálogo. Lo que el
  // editor necesita de más ahora se pide aparte y con sesión, en
  // cargarCatalogoCompleto() de js/perfil.js.
  //
  // Las retiradas vienen mezcladas con el resto y está bien: acá lo
  // único que importa es poder DIBUJAR lo que alguien lleva puesto. Una
  // prenda retirada hay que poder dibujarla —quien ya la llevaba sigue
  // con ella—, y elegirla o no se decide en el editor, que se arma con
  // otra respuesta.
  _promesaCatalogoAvatares = fetch("/api/content?action=avatar-catalogo")
    .then(r => r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)))
    .then(datos => {
      if(!datos || !datos.success) throw new Error("el catálogo vino sin éxito");
      RUTAS_DE_PRENDA.clear();
      Object.entries(datos.rutas || {}).forEach(([valor, url]) => {
        RUTAS_DE_PRENDA.set(valor, url);
      });

      return datos;
    })
    .catch(error => {
      // Que no se pueda cargar el catálogo no puede dejar sin avatar a
      // nadie: rutaCapaAvatar sigue funcionando con la ruta de siempre.
      console.warn("MacroReborn: no se pudo cargar el catálogo de avatares.", error);
      return null;
    });

  return _promesaCatalogoAvatares;
}

// Se pide cuanto antes, no cuando haga falta: así el mapa suele estar
// listo para el primer avatar que se dibuje. Lo que se dibuje antes sale
// con la ruta de siempre, que también funciona.
cargarCatalogoAvatares();

function rutaCapaAvatar(valor){
  if(!valor || valor === "ninguno") return null;

  const delCatalogo = RUTAS_DE_PRENDA.get(valor);
  if(delCatalogo) return delCatalogo;

  // Sin catálogo TODAVÍA: la ruta de siempre. Que la red falle o que el
  // catálogo tarde en llegar no puede dejar a nadie sin avatar.
  if(!RUTAS_DE_PRENDA.size){
    const texto = String(valor);
    const idx = texto.indexOf("_");

    if(idx === -1) return "imagenes/" + texto + ".png";

    return "imagenes/" + texto.slice(0, idx) + "/" + texto.slice(idx + 1) + ".png";
  }

  // CON catálogo y sin rastro del valor: la prenda está COLGANDO.
  //
  // Esto ya NO incluye a las retiradas. Antes sí, y por eso acá se
  // adivinaba una ruta: una prenda retirada tiene que seguir dibujándose
  // en quien ya la llevaba puesta. Desde que el servidor manda la lista
  // "retiradas" con su URL con huella (ver construirCatalogo en
  // api/content.js), una retirada entra en RUTAS_DE_PRENDA como
  // cualquier otra y no llega hasta acá.
  //
  // Lo que llega es un valor que no existe en NINGUNA fila de
  // avatar_prendas. Adivinarle "imagenes/<modelo>/<resto>.png" no lo
  // arregla, porque ese fichero tampoco está: lo único que consigue es
  // un 404, y un 404 en una <img> no se ve como un hueco sino como la
  // marca de "imagen no encontrada" del navegador, pegada encima del
  // avatar y con el tamaño que el CSS le dio a la capa.
  //
  // Medido contra la base de producción: "tora_piel7" está puesto cinco
  // veces -tres cuentas y dos casilleros de galería- y no tiene fila ni
  // fichero. Es el único caso hoy, y los cinco daban esa marca.
  //
  // Devolver null lo deja fuera, y el avatar se dibuja con el resto de
  // las capas. Es lo mismo que hace rutaDePrenda() en js/perfil.js desde
  // que se arregló ahí; esto pone de acuerdo a las otras siete páginas
  // que dibujan avatares.
  return null;
}

// ------------------------------------------------------------------
// UNA CAPA QUE NO CARGA NO DEJA MARCA
// ------------------------------------------------------------------
// Cuando el dibujo de una capa no está, el navegador NO deja el hueco
// vacío: pinta su marca de "imagen no encontrada" -un recuadro de borde
// fino con el icono roto arriba a la izquierda- del tamaño que el CSS le
// haya dado a la <img>. Encima de un avatar eso no se lee como un error
// de red: se lee como una prenda rota que la persona lleva puesta.
//
// Lo de arriba (rutaCapaAvatar devolviendo null) tapa el caso conocido,
// pero solo ese y solo después de que el catálogo llegue. Quedan otros
// que no dependen de nosotros:
//
//   - El avatar se dibuja ANTES de que el catálogo cargue, que es lo
//     normal: ahí todavía se adivina la ruta de siempre.
//   - Un 404 que nginx marcó como immutable y el navegador se guardó
//     treinta días (ya pasó: ver el comentario de "retiradas" en
//     api/content.js).
//   - Un fichero que desaparece por debajo con la fila todavía puesta.
//
// El arreglo no es acordarse de poner onerror en los siete sitios que
// dibujan capas -ya se olvidó una vez- sino escuchar UNA vez en el
// documento. Los "error" de una <img> no burbujean, pero sí bajan en la
// fase de captura, y por eso el tercer argumento es true. Así entran
// también las capas escritas con innerHTML, las perezosas con data-src
// y las que todavía no existen.
function _esCapaDeAvatar(img){
  const clases = img.classList;
  if(clases){
    if(clases.contains("capa") || clases.contains("vest-capa")) return true;
    for(let i = 0; i < clases.length; i++){
      if(clases[i].indexOf("capa-") === 0) return true;
    }
  }
  return !!(img.closest && img.closest(".avatar-compuesto"));
}

const _capasRotasAvisadas = new Set();

if(typeof document !== "undefined"){
  document.addEventListener("error", evento=>{
    const img = evento.target;
    if(!img || img.tagName !== "IMG") return;

    const ruta = img.getAttribute("src") || "";

    // Un avatar que es UN PNG entero no se puede esconder: no hay más
    // capas debajo, quedaría un círculo vacío. Ese cae al avatar por
    // defecto, que es lo que ya se enseña cuando alguien no tiene.
    if(img.classList && img.classList.contains("avatar-png-personalizado")){
      if(img.dataset.capaRota) return;   // falló hasta el de por defecto
      img.dataset.capaRota = "1";
      img.src = "imagenes/avatar.png";
      return;
    }

    if(!_esCapaDeAvatar(img)) return;

    // display:none en el propio elemento, y no el atributo hidden,
    // porque cualquier regla de CSS con display le gana al atributo y
    // estas capas llevan reglas propias en cinco hojas distintas.
    img.style.display = "none";
    img.dataset.capaRota = "1";

    // Un aviso por dibujo, no por avatar: la misma prenda rota puede
    // estar puesta en veinte tarjetas de la misma página.
    if(ruta && !_capasRotasAvisadas.has(ruta)){
      _capasRotasAvisadas.add(ruta);
      console.warn("MacroReborn: falta el dibujo de una capa del avatar; se dibuja sin ella.", ruta);
    }
  }, true);
}

// ------------------------------------------------------------------
// EL AVATAR YA COMPUESTO POR EL SERVIDOR
// ------------------------------------------------------------------
// Desde el 21/09/2026 el servidor compone el avatar al guardarlo y lo
// sirve como UNA imagen. El porque entero esta en
// docs/AVATARES-SERVIDOR.md; lo que importa aqui es el numero: la
// pagina de comunidad mandaba 5.562 kB de capas sueltas para pintar
// avatares de 35 pixeles, y con miniaturas compuestas manda 468.
//
// La direccion es de la persona y no cambia nunca:
//     /avatares/38/62x96.jpg
//
// El ?v= es la version, y es lo que deja cachearla un ano: cuando
// alguien se cambia de ropa, la API devuelve otra huella, esta funcion
// arma otra direccion, y el navegador baja la nueva. Sin el habria que
// preguntar por cada avatar en cada visita.
//
// Sin huella sale la direccion desnuda, que tambien vale: si el
// compuesto falta, el servidor lo compone al pedirlo, y si no puede
// manda la silueta. Se cachea un minuto en vez de un ano. Pasa con quien
// agoto el freno del servidor o con un guardado que fallo.
//
// Devuelve null solo si no se sabe de quien es.
function urlAvatarCompuesto(usuario, ancho, alto){
  if(!usuario || !usuario.id) return null;
  const a = ancho || 62, l = alto || 96;
  const ruta = "/avatares/" + encodeURIComponent(usuario.id) + "/" + a + "x" + l + ".jpg";
  if(!usuario.avatar_compuesto) return ruta;
  const v = String(usuario.avatar_compuesto).slice(0, 12);
  return ruta + "?v=" + encodeURIComponent(v);
}

// ¿Lleva alguna prenda puesta? El mismo criterio que capasCon() en
// api/_avatar-compuesto.js: sin ninguna, el servidor no compone nada, y
// no hace falta preguntarle para acabar en la silueta.
function avatarTienePrendas(avatarCrudo){
  const avatar = normalizarAvatar(avatarCrudo);
  if(!avatar || typeof avatar !== "object" || avatar.tipo === "png") return false;
  return ORDEN_CAPAS_AVATAR.some(capa=>{
    const valor = avatar[capa];
    return typeof valor === "string" && valor !== "" && valor !== "ninguno";
  });
}

// Que imagen enseñar como avatar de alguien, en este orden:
//
//   png        su PNG de administrador;
//   compuesto  con huella: la version, cacheada un ano;
//   silueta    no lleva ninguna prenda: la del sitio, sin preguntar;
//   compuesto  lleva prendas y no hay huella: la direccion desnuda.
//
// Devuelve { tipo, src }. Y null solo cuando lleva prendas pero no se
// sabe quien es: son las paginas que aun no pasan el usuario, y esas
// siguen dibujando por capas hasta que se migren. Ninguna prenda suelta
// sale de aqui.
function imagenDeAvatar(avatarCrudo, usuario, ancho, alto){
  const png = avatarPNGData(avatarCrudo);
  if(png) return { tipo: "png", src: png };

  const conId = !!(usuario && usuario.id);
  if(conId && usuario.avatar_compuesto){
    return { tipo: "compuesto", src: urlAvatarCompuesto(usuario, ancho, alto) };
  }
  if(!avatarTienePrendas(avatarCrudo)){
    return { tipo: "silueta", src: "imagenes/avatar.png" };
  }
  if(conId){
    return { tipo: "compuesto", src: urlAvatarCompuesto(usuario, ancho, alto) };
  }
  return null;
}

// Una sola etiqueta con el compuesto, con el mismo data-src perezoso
// que las capas, para que el observador de mas abajo la recoja igual.
function imgCompuesta(url, estilo, clase){
  return `<img data-src="${url}" alt="" loading="lazy"` +
    (clase ? ` class="${clase}"` : "") +
    ` style="${estilo}">`;
}

// El segundo parametro es opcional a proposito: quien solo tenga el
// avatar a mano sigue llamando con uno solo y se dibuja por capas,
// como antes. Quien tenga el usuario entero pasa los dos y se lleva la
// imagen compuesta. Asi las paginas se migran de una en una.
function avatarMiniaturaHTML(avatarCrudo, usuario){
  const imagen = imagenDeAvatar(avatarCrudo, usuario, 62, 96);

  if(imagen && imagen.tipo === "compuesto"){
    return imgCompuesta(imagen.src,
      "width:100%;height:100%;object-fit:cover;border-radius:inherit;");
  }
  if(imagen && imagen.tipo === "png"){
    return `<img class="avatar-png-personalizado" src="${imagen.src}" alt="Avatar" loading="lazy" style="width:100%;height:100%;object-fit:contain;border-radius:inherit;">`;
  }
  const avatarPorDefecto =
    `<img src="imagenes/avatar.png" alt="" loading="lazy" ` +
    `style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">`;

  if(imagen) return avatarPorDefecto;

  // Por capas: solo quien aun no pasa el usuario.
  const avatar = normalizarAvatar(avatarCrudo);
  if(!avatar) return avatarPorDefecto;

  let capas = "";
  ORDEN_CAPAS_AVATAR.forEach(tipo=>{
    const ruta = rutaCapaAvatar(avatar[tipo]);
    if(ruta){
      capas += `<img data-src="${ruta}" alt="" loading="lazy" ` +
        `style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;">`;
    }
  });

  if(!capas) return avatarPorDefecto;

  const rutas = ORDEN_CAPAS_AVATAR
    .map(tipo => rutaCapaAvatar(avatar[tipo]))
    .filter(Boolean);

  const estiloCapa = "position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;";

  return `<div class="avatar-compuesto" data-capas="${rutas.join("|")}" ` +
    `data-capa-style="${estiloCapa}">${capas}</div>`;
}




// ==============================
// IMÁGENES QUE ESPERAN A VERSE
// ==============================
// loading="lazy" no sirve para lo que el sitio necesita. Un navegador
// solo aplaza una imagen si tiene caja de dibujo y puede medir su
// distancia a la pantalla; dentro de algo con display:none no hay caja,
// así que la descarga igual.
//
// Y el sitio esconde muchas cosas con display:none:
//
//   - Las pestañas del perfil y de usuario.html son .contenido-tab, que
//     en css/perfil.css es display:none salvo la activa. Ahí viven la
//     lista de amigos, la galería de avatares guardados y la actividad.
//   - El editor de avatares vive en un #editorAvatar oculto.
//
// Medido con un HAR de usuario.html: 123 imágenes de avatares de gente
// que no se veía, 914 kB, repartidas en tres listas dentro de pestañas
// cerradas. El dueño del sitio lo describió como "en Home estoy y lo
// único visible es su avatar".
//
// La solución es un IntersectionObserver, que resuelve los tres casos
// con la misma regla y sin que nadie tenga que acordarse de nada:
//
//   pestaña cerrada  -> nunca se cruza con la pantalla -> no se pide
//   más abajo        -> se pide al llegar bajando
//   pestaña que se abre -> se cruza en ese momento -> se pide
//
// Las imágenes se emiten con data-src en vez de src y esto las recoge.
// El MutationObserver de más abajo se encarga de las que aparecen luego,
// que son casi todas: estas listas se pintan con innerHTML.

const _observadorPerezosas = (typeof IntersectionObserver !== "undefined")
  ? new IntersectionObserver(entradas=>{
      entradas.forEach(entrada=>{
        if(!entrada.isIntersecting) return;
        const img = entrada.target;
        _observadorPerezosas.unobserve(img);
        if(img.dataset.src){
          img.src = img.dataset.src;
          delete img.dataset.src;
        }
      });
    }, { rootMargin: "300px" })   // un poco antes de que asome
  : null;

function activarImagenesPerezosas(raiz){
  const contenedor = raiz || document;
  const sueltas = [];

  if(contenedor.matches && contenedor.matches("img[data-src]")) sueltas.push(contenedor);
  if(contenedor.querySelectorAll){
    contenedor.querySelectorAll("img[data-src]").forEach(img=>sueltas.push(img));
  }

  if(!sueltas.length) return;

  // Sin IntersectionObserver (navegador viejo) se cargan todas de una:
  // peor para la red, pero nadie se queda sin ver un avatar.
  if(!_observadorPerezosas){
    sueltas.forEach(img=>{ img.src = img.dataset.src; delete img.dataset.src; });
    return;
  }

  sueltas.forEach(img=>_observadorPerezosas.observe(img));
}

// ==============================
// AVATAR — COMPOSICIÓN EN UNA SOLA IMAGEN (Fase 4: click derecho)
// ==============================
// El editor (js/perfil.js) sigue armando el avatar con varias <img>
// superpuestas, tal cual funcionaba siempre: esto NO se toca. El
// problema es que, fuera del editor (perfil, comentarios, amigos,
// ranking, buscador, actividad, chat, reseñas), esas mismas capas
// apiladas hacen que el botón derecho del navegador ("Guardar imagen
// como", "Copiar imagen", "Abrir imagen") tome una sola capa suelta en
// vez del avatar completo.
//
// La solución no reemplaza el sistema de capas: lo reutiliza. Cada
// lugar del sitio que arma un avatar para MOSTRAR (no para editar)
// sigue calculando sus capas exactamente igual que antes (mismo orden,
// mismas rutas, mismas clases CSS) y las pinta apiladas como siempre
// -eso da el primer pantallazo, instantáneo e idéntico al actual-,
// pero además envuelve ese grupo de capas en un contenedor con
// class="avatar-compuesto" y un data-capas con las rutas en orden.
//
// Esta sección junta esas capas en un <canvas>, las funde en un único
// PNG con transparencia y reemplaza el contenido del contenedor por
// una sola <img> con ese PNG -conservando la misma clase/estilo que
// tenían las capas individuales, para que el recorte/zoom que ya
// define cada CSS (.capa-comentario, .capa-ranking, etc.) se vea
// exactamente igual-. A partir de ahí, para el navegador es una imagen
// común y corriente: el click derecho la trata como una sola imagen.
//
// No hace falta acordarse de llamar a nada después de cada innerHTML:
// un MutationObserver vigila el documento y compone solo cualquier
// ".avatar-compuesto" que aparezca (más abajo).

const _cacheAvatarCompuesto = {};

function _cargarImagenAvatarParaCanvas(ruta){
  return new Promise(resolve=>{
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // una capa rota no debe tirar abajo el resto
    img.src = ruta;
  });
}

// Todas las capas de un mismo avatar están pensadas para superponerse
// en el mismo encuadre (por eso hoy funcionan apiladas con
// position:absolute + object-fit:contain dentro del mismo contenedor).
// Alcanza entonces con dibujar cada una a pantalla completa dentro de
// un canvas del tamaño de la primera capa que cargue bien: el
// resultado es un PNG con el mismo encuadre que tenía cada capa suelta,
// así que al insertarlo con la misma clase/estilo CSS que usaban las
// capas se ve exactamente igual (incluido cualquier recorte o zoom que
// ya aplique ese CSS).

function componerAvatarPNG(rutas){
  const clave = rutas.join("|");
  if(_cacheAvatarCompuesto[clave]) return _cacheAvatarCompuesto[clave];

  const promesa = (async ()=>{
    const imagenes = (await Promise.all(rutas.map(_cargarImagenAvatarParaCanvas))).filter(Boolean);
    if(!imagenes.length) return null;

    const ancho = imagenes[0].naturalWidth || 512;
    const alto = imagenes[0].naturalHeight || 512;

    const canvas = document.createElement("canvas");
    canvas.width = ancho;
    canvas.height = alto;
    const ctx = canvas.getContext("2d");

    imagenes.forEach(img => ctx.drawImage(img, 0, 0, ancho, alto));

    return canvas.toDataURL("image/png");
  })();

  _cacheAvatarCompuesto[clave] = promesa;
  return promesa;
}

// Busca contenedores ".avatar-compuesto" todavía no procesados dentro
// de "raiz" (por defecto, todo el documento) y les compone la imagen
// única. Si algo falla (capas rotas, canvas no disponible, etc.) deja
// las capas apiladas tal cual estaban: se sigue viendo igual, solo que
// en ese caso puntual el click derecho seguiría tomando una sola capa.

// Compone UN avatar. Antes esto vivía suelto dentro del bucle de
// componerAvataresEnPantalla; se saca aparte para poder llamarlo cuando
// el avatar se acerca a la pantalla y no antes.
async function _componerUnAvatar(nodo){
  {
    nodo.setAttribute("data-compuesto", "1"); // evita procesarlo dos veces

    const rutasTexto = nodo.getAttribute("data-capas") || "";
    const rutas = rutasTexto.split("|").filter(Boolean);

    // Una sola capa ya ES una sola imagen: no hace falta canvas.
    if(rutas.length < 2) return;

    try{
      const dataURL = await componerAvatarPNG(rutas);
      if(!dataURL) return;
      if(!nodo.isConnected) return; // se sacó del DOM mientras se componía

      const clase = nodo.getAttribute("data-capa-class") || "";
      const estilo = nodo.getAttribute("data-capa-style") || "";

      const imgFinal = document.createElement("img");
      if(clase) imgFinal.className = clase;
      if(estilo) imgFinal.setAttribute("style", estilo);
      imgFinal.alt = "";
      // FIX: esta imagen ya está 100% en memoria (es un data:URI en base64,
      // resultado de fusionar las capas en el <canvas> de más arriba), no
      // hay nada que "cargar" de la red. Ponerle loading="lazy" a un <img>
      // creado por JS, absolutamente posicionado y recortado dentro de un
      // círculo chico (overflow:hidden), hacía que en varios navegadores el
      // cálculo de "¿está visible?" del lazy-loading nativo fallara para
      // este tipo de elemento fuera de flujo, y la imagen se quedaba sin
      // pintar nunca: el círculo aparecía vacío aunque el <img> ya tuviera
      // su src asignado y ningún error en consola. Con loading="eager" se
      // pinta apenas está lista, como corresponde para algo que ya está en
      // memoria.
      imgFinal.loading = "eager";
      imgFinal.src = dataURL;

      nodo.innerHTML = "";
      nodo.appendChild(imgFinal);
    }catch(error){
      console.warn("MacroReborn: no se pudo componer el avatar en una sola imagen.", error);
    }
  }
}

// Componer un avatar obliga a descargar sus capas con new Image(), y eso
// NO respeta el loading="lazy" que llevan las <img> apiladas: una imagen
// creada por JavaScript se descarga en cuanto se le asigna src, esté
// donde esté el avatar.
//
// Como esto recorría el documento entero, cada avatar de la página se
// bajaba completo aunque estuviera mucho más abajo de lo que se ve. En
// un HAR de una carga real del perfil eran 20 y pico peticiones de
// capas de gente que ni aparecía en pantalla. Fue lo que el dueño del
// sitio describió como "imágenes que no reconozco".
//
// Ahora se espera a que el avatar se acerque a la vista. No se pierde
// nada: la composición existe para que el clic derecho copie el avatar
// entero, y solo se puede hacer clic derecho en lo que se ve.
const _observadorAvatares = (typeof IntersectionObserver !== "undefined")
  ? new IntersectionObserver(entradas=>{
      entradas.forEach(entrada=>{
        if(!entrada.isIntersecting) return;
        _observadorAvatares.unobserve(entrada.target);
        _componerUnAvatar(entrada.target);
      });
    }, { rootMargin: "300px" })   // un poco antes de que asome, para que no se note
  : null;

async function componerAvataresEnPantalla(raiz){
  const contenedor = raiz || document;
  const nodos = contenedor.querySelectorAll(".avatar-compuesto:not([data-compuesto]):not([data-esperando-vista])");
  if(!nodos.length) return;

  // Sin IntersectionObserver (navegador viejo) se compone todo de una,
  // como antes: es peor para la red pero sigue funcionando.
  if(!_observadorAvatares){
    await Promise.all(Array.from(nodos).map(_componerUnAvatar));
    return;
  }

  Array.from(nodos).forEach(nodo=>{
    nodo.setAttribute("data-esperando-vista", "1");
    _observadorAvatares.observe(nodo);
  });
}

function _iniciarObservadorAvatares(){
  activarImagenesPerezosas(document);
  componerAvataresEnPantalla(document);

  if(typeof MutationObserver === "undefined") return; // navegador muy viejo: se queda con las capas apiladas

  const observador = new MutationObserver(mutaciones=>{
    for(const mutacion of mutaciones){
      for(const nodo of mutacion.addedNodes){
        if(nodo.nodeType !== 1) continue;

        // Lo primero: recoger las imágenes que esperan a verse. Se hace
        // en cada nodo nuevo y no solo cuando hay avatares, porque
        // data-src lo usan también otras listas.
        activarImagenesPerezosas(nodo);

        const esCandidato =
          (nodo.matches && nodo.matches(".avatar-compuesto:not([data-compuesto])")) ||
          (nodo.querySelector && nodo.querySelector(".avatar-compuesto:not([data-compuesto])"));
        if(esCandidato){
          componerAvataresEnPantalla(document);
          return;
        }
      }
    }
  });

  observador.observe(document.body, { childList: true, subtree: true });
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", _iniciarObservadorAvatares);
}else{
  _iniciarObservadorAvatares();
}


// ==============================
// FALLBACK DE NOTIFICACIONES
// ==============================
// Algunas páginas históricas podían cargar navbar.js sin notificaciones.js.
// En esas páginas, los módulos que llaman a crearNotificacion() se quedaban
// sin una función global y el POST nunca llegaba a Vercel.
// Este fallback mantiene la compatibilidad: notificaciones.js lo reemplaza
// cuando está cargado, y en las páginas antiguas garantiza que la creación
// llegue igualmente al endpoint existente.
if (typeof window.crearNotificacion !== "function") {
    window.crearNotificacionFallback = true;
    window.crearNotificacion = function(nombre, titulo, mensaje, origenNombre) {
        if (!nombre || !titulo) return Promise.resolve({ success: false, error: "Datos incompletos" });

        return fetch("/api/content?action=notifications", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
            body: JSON.stringify({ username: nombre, titulo, mensaje: mensaje || "", origenNombre })
        }).then(async (resp) => {
            let datos = null;
            try { datos = await resp.json(); } catch (_) {}
            if (!resp.ok || !datos || !datos.success) {
                console.warn("MacroReborn: el servidor rechazó la notificación.", resp.status, datos && datos.error);
            }
            return datos;
        }).catch((error) => {
            console.warn("MacroReborn: error creando la notificación.", error);
            return { success: false, error: error && error.message ? error.message : "Error de red" };
        });
    };
}

// El ayudante del avatar compuesto, para los diez archivos que pintan
// avatares. El resto de este fichero ya vive en el ambito global por
// como se carga; este se declara explicito porque es el que se va a
// buscar desde fuera.
if (typeof window !== "undefined") {
  window.urlAvatarCompuesto = urlAvatarCompuesto;
  window.imagenDeAvatar = imagenDeAvatar;
  window.avatarTienePrendas = avatarTienePrendas;
}

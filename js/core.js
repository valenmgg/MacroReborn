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
//
// Y cada respuesta de la API pasa por MRSesionServidor (abajo): guarda el
// pase renovado que mande el servidor, y avisa si el servidor ya no
// acepta la sesión que el navegador cree tener.
(function instalarInterceptorApi() {
  if (window.__macroRebornFetchProtegido) return;
  window.__macroRebornFetchProtegido = true;

  const fetchOriginal = window.fetch.bind(window);
  window.fetch = function(url, options = {}) {
    let enviado = null;   // el pase con el que sale esta petición, si lleva uno
    let ruta = '';
    try {
      const destino = new URL(url, window.location.href);
      const esApi = destino.origin === window.location.origin && destino.pathname.startsWith('/api/');
      if (esApi) {
        ruta = destino.pathname;
        const token = localStorage.getItem('macroSessionToken');
        const headers = new Headers(options.headers || {});
        if (token && !headers.has('Authorization')) {
          headers.set('Authorization', 'Bearer ' + token);
          options = { ...options, headers };
        }
        const cabecera = headers.get('Authorization') || '';
        if (cabecera.startsWith('Bearer ')) enviado = cabecera.slice(7).trim();
      }
    } catch (_) {}
    const peticion = fetchOriginal(url, options);
    if (!enviado) return peticion;
    return peticion.then((respuesta) => {
      try { MRSesionServidor.revisar(respuesta, enviado, ruta); } catch (_) {}
      return respuesta;
    });
  };
})();

// ==============================
// LA SESIÓN, SEGÚN EL SERVIDOR
// ==============================
// El navegador guarda por separado quién eres (usuarioActivo: el nombre,
// el avatar, las monedas que se ven) y el pase que acepta el servidor
// (macroSessionToken). Nada comprobaba que siguieran de acuerdo, y cuando
// no lo estaban el sitio parecía funcionar -se podía jugar y leer- pero
// no guardaba nada: ni el XP de jugar, ni el chat, ni los comentarios.
// Reporte de la comunidad del 25/09/2026. Se llega ahí de varias formas:
//
//   - el pase caducó (7 días sin entrar; api/_auth.js lo renueva a quien
//     entra), o la clave con que se firman cambió: el servidor contesta
//     401 "Sesión no válida o expirada";
//   - hay usuario guardado pero no pase;
//   - el pase es de otra cuenta: se inició sesión con otra en otra
//     pestaña. El servidor contesta 403 "Sesión no corresponde...".
//
// Aquí se detectan todas, al cargar la página y en cada respuesta, y se
// dice con una franja arriba. La barra pide el saldo con la sesión en
// cada página (mis-monedas), así que el aviso sale al abrirla, antes de
// intentar escribir nada, y lo decide el servidor, no el reloj de quien
// mira.
const MRSesionServidor = (function () {
  const CLAVE_USUARIO = 'usuarioActivo';
  const CLAVE_PASE = 'macroSessionToken';
  let avisado = false;

  function leer(clave) {
    try { return localStorage.getItem(clave); } catch (_) { return null; }
  }

  // El nombre que lleva dentro un pase. No se comprueba la firma, que es
  // cosa del servidor: aquí solo se compara con el usuario de la página.
  // Va en UTF-8, y hay nombres con tildes, runas o corazones.
  function nombreDelPase(pase) {
    try {
      const b64 = String(pase).split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
      const carga = JSON.parse(decodeURIComponent(escape(atob(b64))));
      return carga && carga.username ? String(carga.username) : null;
    } catch (_) {
      return null;
    }
  }

  function nombreGuardado() {
    try {
      const usuario = JSON.parse(leer(CLAVE_USUARIO) || 'null');
      const nombre = usuario && (usuario.nombre || usuario.username);
      return nombre ? String(nombre) : null;
    } catch (_) {
      return null;
    }
  }

  const mismo = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

  // Con quién se abrió esta página: lo que tiene en memoria.
  const nombreAlCargar = nombreGuardado();

  // En el login y el registro no se avisa: ahí se está entrando.
  function enLaEntrada() {
    return /(^|\/)(login|registro)\.html$/.test(window.location.pathname);
  }

  // Dentro de un marco (el de Macro Snake también carga core.js) no se
  // avisa ni se cierra nada: eso lo hace la página que lo contiene, con
  // sus propias peticiones. Aquí solo se guarda el pase renovado.
  const enMarco = (() => {
    try { return window.self !== window.top; } catch (_) { return true; }
  })();

  function rutaActual() {
    const ruta = window.location.pathname.replace(/^\//, '') || 'index.html';
    return ruta + window.location.search;
  }

  // La franja: arriba, encima de todo, con su botón. Con createElement y
  // textContent, porque puede llevar el nombre de una cuenta.
  function avisar(texto, boton) {
    const pintar = () => {
      document.getElementById('mrAvisoSesion')?.remove();
      const franja = document.createElement('div');
      franja.id = 'mrAvisoSesion';
      franja.setAttribute('role', 'alert');
      franja.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483000;display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:center;padding:10px 44px 10px 16px;background:var(--bg-panel,#241145);color:var(--text-main,#f4f1fb);border-bottom:2px solid var(--gold,#f0b429);box-shadow:0 6px 18px rgba(0,0,0,.35);font:600 14px/1.4 system-ui,sans-serif;text-align:center';

      const mensaje = document.createElement('span');
      mensaje.textContent = texto;
      franja.appendChild(mensaje);

      if (boton) {
        const accion = document.createElement(boton.href ? 'a' : 'button');
        accion.textContent = boton.texto;
        if (boton.href) {
          accion.href = boton.href;
        } else {
          accion.type = 'button';
          accion.addEventListener('click', boton.alPulsar);
        }
        accion.style.cssText = 'padding:6px 14px;border-radius:8px;border:0;background:var(--gold,#f0b429);color:var(--text-on-accent,#241804);font:800 14px system-ui,sans-serif;text-decoration:none;cursor:pointer';
        franja.appendChild(accion);
      }

      const cerrar = document.createElement('button');
      cerrar.type = 'button';
      cerrar.setAttribute('aria-label', 'Cerrar aviso');
      cerrar.textContent = '×';
      cerrar.style.cssText = 'position:absolute;right:12px;top:50%;transform:translateY(-50%);border:0;background:transparent;color:inherit;font-size:22px;line-height:1;cursor:pointer';
      cerrar.addEventListener('click', () => franja.remove());
      franja.appendChild(cerrar);

      document.body.appendChild(franja);
    };
    if (document.body) pintar();
    else document.addEventListener('DOMContentLoaded', pintar);
  }

  function cerrarSesionLocal() {
    if (window.MRSession && typeof window.MRSession.clear === 'function') {
      window.MRSession.clear();
      return;
    }
    try {
      localStorage.removeItem(CLAVE_USUARIO);
      localStorage.removeItem(CLAVE_PASE);
    } catch (_) {}
  }

  // El servidor ya no acepta esta sesión: se cierra también aquí, que es
  // la verdad, y se ofrece volver a entrar y volver a esta misma página.
  function sesionPerdida(texto) {
    if (avisado || enLaEntrada() || enMarco) return;
    avisado = true;
    cerrarSesionLocal();
    avisar(texto, { texto: 'Iniciar sesión', href: 'login.html?volver=' + encodeURIComponent(rutaActual()) });
  }

  const caducada = () => sesionPerdida('Tu sesión caducó. Volvé a iniciarla para seguir sumando XP y poder escribir.');

  // Otra pestaña cambió la sesión. El almacenamiento ya tiene la buena;
  // lo viejo es lo que esta página tiene en memoria: basta con recargar.
  function cambioFuera(texto) {
    if (avisado || enLaEntrada() || enMarco) return;
    avisado = true;
    avisar(texto, { texto: 'Recargar', alPulsar: () => window.location.reload() });
  }

  // Cada respuesta de la API que salió con pase (la llama el interceptor).
  function revisar(respuesta, enviado, ruta) {
    // /api/auth (entrar, registrarse, borrar la cuenta) tiene sus propias
    // respuestas y pantallas.
    if (ruta === '/api/auth') return;

    // Solo decide la petición que salió con el pase que sigue guardado.
    // Una que salió con otro (una copia vieja, o de antes de que otra
    // pestaña cambiara la sesión) no dice nada de la sesión de ahora.
    const actual = leer(CLAVE_PASE);
    if (enviado !== actual) return;

    const nuevo = respuesta.headers && respuesta.headers.get('X-Sesion-Nueva');
    if (nuevo) {
      try { localStorage.setItem(CLAVE_PASE, nuevo); } catch (_) {}
    }

    if (respuesta.status !== 401 && respuesta.status !== 403) return;
    respuesta.clone().json().then((datos) => {
      const error = String((datos && datos.error) || '');
      if (respuesta.status === 401 && /^Sesión no válida/.test(error)) {
        caducada();
      } else if (respuesta.status === 403 && /^Sesión no corresponde/.test(error)) {
        const delPase = nombreDelPase(actual);
        if (delPase && !mismo(delPase, nombreAlCargar)) {
          cambioFuera('Iniciaste sesión como ' + delPase + ' en otra pestaña. Recargá esta página para seguir con esa cuenta.');
        }
      }
    }).catch(() => {});
  }

  // Al abrir la página: lo que se puede ver sin preguntar a nadie.
  function revisarAlCargar() {
    if (!nombreAlCargar) return;
    const pase = leer(CLAVE_PASE);
    if (!pase) {
      caducada();
      return;
    }
    const delPase = nombreDelPase(pase);
    if (delPase && !mismo(delPase, nombreAlCargar)) {
      sesionPerdida('Tu sesión quedó mezclada entre dos cuentas. Volvé a iniciarla con la que quieras usar.');
    }
  }

  // Si otra pestaña cambia la sesión mientras esta está abierta.
  window.addEventListener('storage', (evento) => {
    if (evento.key !== null && evento.key !== CLAVE_PASE && evento.key !== CLAVE_USUARIO) return;
    if (!nombreAlCargar) return;
    const pase = leer(CLAVE_PASE);
    if (!pase && !nombreGuardado()) {
      cambioFuera('Cerraste sesión en otra pestaña. Recargá esta página.');
      return;
    }
    const delPase = pase ? nombreDelPase(pase) : null;
    if (delPase && !mismo(delPase, nombreAlCargar)) {
      cambioFuera('Iniciaste sesión como ' + delPase + ' en otra pestaña. Recargá esta página para seguir con esa cuenta.');
    }
  });

  revisarAlCargar();

  return { revisar };
})();
// FIN: LA SESIÓN, SEGÚN EL SERVIDOR

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
const _cachePersonas = {};
const _peticionesAvatares = {};

function obtenerAvatarCacheado(nombre){
  return Object.prototype.hasOwnProperty.call(_cacheAvatares, nombre)
    ? _cacheAvatares[nombre]
    : null;
}

// Su id y la huella de su compuesto, { id, avatar_compuesto }, para
// pasarselos a imagenDeAvatar(). La API los manda desde el 21/09/2026 y
// hasta el 24/09 aqui se tiraban: el chat, los comentarios, la actividad
// y las reseñas no tenian con que pedir el compuesto.
function obtenerPersonaCacheada(nombre){
  return Object.prototype.hasOwnProperty.call(_cachePersonas, nombre)
    ? _cachePersonas[nombre]
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
      _cachePersonas[nombre] = (datos && datos.success && datos.user.id)
        ? { id: datos.user.id, avatar_compuesto: datos.user.avatar_compuesto || null }
        : null;
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
// YA NO HAY ÍNDICE PÚBLICO DE PRENDAS
// ------------------------------------------------------------------
// Aquí vivía cargarCatalogoAvatares(), que en cada página pedía
// /api/content?action=avatar-catalogo: un mapa de cada prenda puesta a
// la dirección de su dibujo suelto, para que rutaCapaAvatar() apilara
// las capas de cada avatar.
//
// Desde la fase 5 de docs/AVATARES-SERVIDOR.md ninguna página dibuja
// prenda por prenda: cada avatar es una sola imagen, compuesta por el
// servidor (ver imagenDeAvatar, más abajo), y la vista previa del editor
// también la dibuja él. Y ese mapa era justo la lista de lo que no tiene
// que salir del equipo de arte. Se quitó el 24/09/2026.

// ------------------------------------------------------------------
// UNA CAPA QUE NO CARGA NO DEJA MARCA
// ------------------------------------------------------------------
// Cuando el dibujo de una capa no está, el navegador NO deja el hueco
// vacío: pinta su marca de "imagen no encontrada" -un recuadro de borde
// fino con el icono roto arriba a la izquierda- del tamaño que el CSS le
// haya dado a la <img>. Encima de un avatar eso no se lee como un error
// de red: se lee como una prenda rota que la persona lleva puesta.
//
// Desde la fase 5 las páginas ya no apilan capas: cada avatar es una
// sola imagen. Quien sí las apila es el vestidor del equipo de arte
// (vest-capa), y ahí esto sigue haciendo falta:
//
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
// Un diseño guardado va con su ranura, { id, ranura, avatar_compuesto },
// y vive en su propia carpeta: /avatares/38/ranura2/62x96.jpg.
//
// Devuelve null solo si no se sabe de quien es.
function urlAvatarCompuesto(usuario, ancho, alto){
  if(!usuario || !usuario.id) return null;
  const a = ancho || 62, l = alto || 96;
  const ranura = usuario.ranura ? "/ranura" + encodeURIComponent(usuario.ranura) : "";
  const ruta = "/avatares/" + encodeURIComponent(usuario.id) + ranura + "/" + a + "x" + l + ".jpg";
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

// Lo que las paginas ya migradas enseñan cuando imagenDeAvatar() no
// sabe de quien es: la silueta, nunca las capas.
const SILUETA_AVATAR = Object.freeze({ tipo: "silueta", src: "imagenes/avatar.png" });

// Que imagen enseñar como avatar de alguien, en este orden:
//
//   png        su PNG de administrador;
//   compuesto  con huella: la version, cacheada un ano;
//   silueta    no lleva ninguna prenda: la del sitio, sin preguntar;
//   compuesto  lleva prendas y no hay huella: la direccion desnuda.
//
// Devuelve { tipo, src }. Y null solo cuando lleva prendas pero no se
// sabe quien es: quien llama enseña entonces la silueta, SILUETA_AVATAR.
// Ninguna prenda suelta sale de aqui.
function imagenDeAvatar(avatarCrudo, usuario, ancho, alto){
  const png = avatarPNGData(avatarCrudo);
  if(png) return { tipo: "png", src: png };

  const conId = !!(usuario && usuario.id);
  if(conId && usuario.avatar_compuesto){
    return { tipo: "compuesto", src: urlAvatarCompuesto(usuario, ancho, alto) };
  }
  if(!avatarTienePrendas(avatarCrudo)){
    return SILUETA_AVATAR;
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

// Con la persona entera, { id, avatar_compuesto }, sale su compuesto.
// Solo con el avatar ya no se sabe de quien es: sale la silueta, y hasta
// la fase 5 salia dibujado prenda por prenda.
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

  return avatarPorDefecto;
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
// YA NO SE COMPONEN AVATARES EN EL NAVEGADOR
// ==============================
// Aquí vivía componerAvatarPNG(): juntaba en un <canvas> las capas
// apiladas de cada avatar, para que el clic derecho copiara el avatar
// entero y no una capa suelta. Para eso volvía a descargar cada capa.
// Desde la fase 3 el avatar ya llega hecho una sola imagen del servidor,
// así que no queda nada que juntar. Se quitó el 24/09/2026.

function _iniciarObservadorAvatares(){
  activarImagenesPerezosas(document);

  if(typeof MutationObserver === "undefined") return; // navegador muy viejo: se cargan las que ya estaban

  const observador = new MutationObserver(mutaciones=>{
    for(const mutacion of mutaciones){
      for(const nodo of mutacion.addedNodes){
        if(nodo.nodeType !== 1) continue;

        // Recoger las imágenes que esperan a verse, en cada nodo nuevo:
        // data-src lo usan los avatares y también otras listas.
        activarImagenesPerezosas(nodo);
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
  window.SILUETA_AVATAR = SILUETA_AVATAR;
  window.obtenerPersonaCacheada = obtenerPersonaCacheada;
}

// ==============================
// ACTUALIZACIONES EN TIEMPO REAL DEL PERFIL PROPIO (Pusher)
// ==============================
// Se conecta al mismo canal público por usuario que ya usa
// js/realtime.js para las notificaciones ("notificaciones-<nombre>")
// y escucha los eventos que ahora dispara el servidor (api/content.js
// y api/social.js) cada vez que se crea un comentario, una actividad,
// un juego jugado o un logro en ESTE perfil. Al recibir el evento,
// vuelve a pintar solo esa sección, sin recargar la página.
//
// Va en un archivo aparte (no adentro de js/realtime.js) para no
// tocar la lógica de la campanita de notificaciones, que es un tema
// distinto aunque comparta el mismo canal.
//
// Requiere que datosUsuario (js/perfil.js) y las funciones
// renderComentarios / renderActividadReciente / renderHistorialPerfil
// / renderLogros ya estén definidas, así que este script se carga al
// final, después de todos esos.

(function () {

  // Eventos locales: funcionan incluso cuando Pusher no está disponible.
  // No hacen escrituras ni llamadas al backend por sí mismos; solo vuelven
  // a pintar lo que ya confirmó el servidor.
  if (typeof datosUsuario !== "undefined" && datosUsuario && datosUsuario.nombre) {
    function usuarioPerfilActual(){
      if (window.MRProfileContext && MRProfileContext.type === "own" && typeof MRProfileContext.getUser === "function") {
        return MRProfileContext.getUser();
      }
      return datosUsuario;
    }

    function esMiEvento(payload){
      const usuario = usuarioPerfilActual();
      return !!(payload && payload.username && usuario && usuario.nombre && String(payload.username).toLowerCase() === String(usuario.nombre).toLowerCase());
    }

    function registrarEventoMacro(nombre, handler){
      if (window.MRApp && MRApp.events && typeof MRApp.events.on === "function") {
        return MRApp.events.on(nombre, handler);
      }
      window.addEventListener(nombre, function(event){
        handler(event && event.detail);
      });
      return function(){};
    }

    async function refrescarLogrosConfirmados(payload){
      if (!esMiEvento(payload)) return;
      const usuario = usuarioPerfilActual();
      try {
        if (typeof cargarLogros === "function" && usuario && usuario.nombre) {
          const lista = await cargarLogros(usuario.nombre);
          if (typeof datosUsuario !== "undefined" && datosUsuario && Array.isArray(lista)) {
            datosUsuario.logros = lista.length;
          }
          if (typeof window.usuario !== "undefined" && window.usuario) {
            window.usuario.logros = Array.isArray(lista) ? lista.length : window.usuario.logros;
          }
        }
      } catch (_) {}
      if (typeof renderLogros === "function") renderLogros();
      if (typeof actualizarPuntosLogrosUI === "function") actualizarPuntosLogrosUI();
    }

    registrarEventoMacro("macro:achievement-unlocked", refrescarLogrosConfirmados);

    window.addEventListener("storage", function (event) {
      if (event.key === "macro:last-achievement-unlocked" && event.newValue) {
        try {
          const payload = JSON.parse(event.newValue);
          if (!esMiEvento(payload)) return;
          refrescarLogrosConfirmados(payload);
        } catch (_) {}
      }
    });
  }

  if (typeof Pusher === "undefined") {
    console.warn("MacroReborn: pusher-js no cargó, actualizaciones Pusher del perfil desactivadas; eventos locales siguen activos.");
    return;
  }

  if (typeof datosUsuario === "undefined" || !datosUsuario || !datosUsuario.nombre) return;

  // Mismos valores que js/realtime.js (públicos a propósito, ver ese
  // archivo para más detalle).
  const PUSHER_KEY = "767a9d93fede4f8f7b52";
  const PUSHER_CLUSTER = "sa1";

  if (PUSHER_KEY === "TU_PUSHER_KEY") return;

  const pusher = new Pusher(PUSHER_KEY, { cluster: PUSHER_CLUSTER });
  let canalActual = null;
  let nombreCanalActual = null;

  function obtenerNombreCanal() {
    const usuario = usuarioPerfilActual();
    return usuario && usuario.nombre ? String(usuario.nombre).toLowerCase() : "";
  }

  function enlazarCanal(nombre) {
    const normalizado = String(nombre || "").trim().toLowerCase();
    if (!normalizado || normalizado === nombreCanalActual) return;

    if (canalActual && nombreCanalActual) {
      try { pusher.unsubscribe("notificaciones-" + nombreCanalActual); } catch (_) {}
    }

    nombreCanalActual = normalizado;
    canalActual = pusher.subscribe("notificaciones-" + normalizado);

    canalActual.bind("nuevo-comentario", function () {
      if (typeof renderComentarios === "function") renderComentarios();
    });

    canalActual.bind("comentarios-vaciados", function () {
      if (typeof renderComentarios === "function") renderComentarios();
    });

    canalActual.bind("nueva-actividad", function () {
      if (typeof renderActividadReciente === "function") renderActividadReciente();
    });

    // "Actividad reciente" del perfil propio ahora es un buzón de
    // menciones recibidas (ver js/perfil-actividad.js), no la propia
    // actividad; "nueva-actividad" arriba se dispara en el canal del
    // AUTOR (quien comentó/reseñó), no en el de la persona mencionada.
    // "nueva-notificacion" sí llega al canal de la persona mencionada
    // (api/_notifications.js), así que también se usa acá para
    // refrescar la pestaña en vivo cuando a alguien lo mencionan.
    canalActual.bind("nueva-notificacion", function () {
      if (typeof renderActividadReciente === "function") renderActividadReciente();
    });

    canalActual.bind("nuevo-historial", function () {
      if (typeof renderHistorialPerfil === "function") renderHistorialPerfil();
    });

    canalActual.bind("nuevo-logro", function (payload) {
      const usuario = usuarioPerfilActual();
      if (typeof cargarLogros === "function" && usuario && usuario.nombre) {
        cargarLogros(usuario.nombre).then(function(){
          if (typeof renderLogros === "function") renderLogros();
          if (typeof actualizarPuntosLogrosUI === "function") actualizarPuntosLogrosUI();
        }).catch(function(){});
        return;
      }
      if (typeof renderLogros === "function") renderLogros();
    });

    canalActual.bind("latido", function (datos) {
      if (datos && datos.last_login) datosUsuario.ultimaConexion = datos.last_login;
      if (typeof pintarUltimaConexion === "function") pintarUltimaConexion();
    });
  }

  enlazarCanal(obtenerNombreCanal());

  // Si la sesión cambia en la misma pestaña, el perfil debe escuchar el
  // canal del nuevo usuario y dejar de escuchar el anterior.
  if (window.MRSession && typeof MRSession.subscribe === "function") {
    MRSession.subscribe(function () {
      enlazarCanal(obtenerNombreCanal());
    });
  }

  if (typeof pintarUltimaConexion === "function") {
    setInterval(pintarUltimaConexion, 30 * 1000);
  }

})();

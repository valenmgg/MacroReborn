// ==============================
// ACTUALIZACIONES EN TIEMPO REAL DEL PERFIL PROPIO
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

  // Eventos locales: funcionan incluso sin línea con el servidor.
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

  if (!window.MRAvisos) {
    console.warn("MacroReborn: js/avisos.js no cargó; el perfil no se actualiza solo, pero los eventos locales siguen activos.");
    return;
  }

  if (typeof datosUsuario === "undefined" || !datosUsuario || !datosUsuario.nombre) return;

  // Las bajas de las escuchas puestas en el canal actual, para poder
  // soltarlas enteras cuando la sesión cambie de usuario.
  let bajas = [];
  let nombreCanalActual = null;

  function obtenerNombreCanal() {
    const usuario = usuarioPerfilActual();
    return usuario && usuario.nombre ? String(usuario.nombre).toLowerCase() : "";
  }

  function soltarCanal() {
    for (const baja of bajas) baja();
    bajas = [];
    nombreCanalActual = null;
  }

  // Repintar lo que dependa del servidor. Se usa al recibir cada aviso y
  // también al volver de una caída de la línea, porque mientras estuvo
  // cortada no llegó nada y lo perdido no se guarda.
  function repintarComentarios() {
    if (typeof renderComentarios === "function") renderComentarios();
  }
  function repintarActividad() {
    if (typeof renderActividadReciente === "function") renderActividadReciente();
  }
  function repintarHistorial() {
    if (typeof renderHistorialPerfil === "function") renderHistorialPerfil();
  }
  function repintarLogros() {
    const usuario = usuarioPerfilActual();
    if (typeof cargarLogros === "function" && usuario && usuario.nombre) {
      cargarLogros(usuario.nombre).then(function () {
        if (typeof renderLogros === "function") renderLogros();
        if (typeof actualizarPuntosLogrosUI === "function") actualizarPuntosLogrosUI();
      }).catch(function () {});
      return;
    }
    if (typeof renderLogros === "function") renderLogros();
  }

  function enlazarCanal(nombre) {
    const normalizado = String(nombre || "").trim().toLowerCase();
    if (!normalizado || normalizado === nombreCanalActual) return;

    soltarCanal();
    nombreCanalActual = normalizado;

    const canal = "notificaciones-" + normalizado;
    const escuchar = (evento, fn) => bajas.push(MRAvisos.escuchar(canal, evento, fn));

    escuchar("nuevo-comentario", repintarComentarios);
    escuchar("comentarios-vaciados", repintarComentarios);
    escuchar("nueva-actividad", repintarActividad);

    // "Actividad reciente" del perfil propio ahora es un buzón de
    // menciones recibidas (ver js/perfil-actividad.js), no la propia
    // actividad; "nueva-actividad" arriba se dispara en el canal del
    // AUTOR (quien comentó/reseñó), no en el de la persona mencionada.
    // "nueva-notificacion" sí llega al canal de la persona mencionada
    // (api/_notifications.js), así que también se usa acá para
    // refrescar la pestaña en vivo cuando a alguien lo mencionan.
    escuchar("nueva-notificacion", repintarActividad);

    escuchar("nuevo-historial", repintarHistorial);
    escuchar("nuevo-logro", repintarLogros);

    escuchar("latido", function (datos) {
      if (datos && datos.last_login) datosUsuario.ultimaConexion = datos.last_login;
      if (typeof pintarUltimaConexion === "function") pintarUltimaConexion();
    });
  }

  // Al volver de una caída hay que repescar: durante el corte pudo haber
  // comentarios, logros o actividad que no llegaron.
  MRAvisos.alReconectar(function () {
    if (!nombreCanalActual) return;
    repintarComentarios();
    repintarActividad();
    repintarHistorial();
    repintarLogros();
  });

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

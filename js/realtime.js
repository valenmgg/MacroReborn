// ==============================
// NOTIFICACIONES EN TIEMPO REAL
// ==============================
// Se apunta al canal público del usuario logueado y escucha el evento
// "nueva-notificacion" que dispara api/_notifications.js apenas se crea
// una (logro, mención con @usuario, XP, solicitud de amistad,
// comentario...). No agrega ningún endpoint nuevo: usa las mismas
// funciones de js/notificaciones.js -que se carga antes que este script
// en el <head> de cada página- para refrescar la campanita y el listado.
//
// La línea la sostiene js/avisos.js, que se carga justo antes en todas
// las páginas. Antes esto abría su propio WebSocket contra Pusher; ahora
// comparte una sola conexión con el resto de la página.

(function () {

  function iniciarTiempoReal() {
    if (!window.MRAvisos) {
      console.warn("MacroReborn: js/avisos.js no cargó, notificaciones en vivo desactivadas.");
      return;
    }

    let cancelar = null;
    let nombreActual = "";

    function usuarioActual() {
      return (typeof obtenerUsuarioNotificaciones === "function")
        ? obtenerUsuarioNotificaciones()
        : (window.MRSession && typeof MRSession.get === "function" ? MRSession.get() : null);
    }

    function soltar() {
      if (cancelar) cancelar();
      cancelar = null;
      nombreActual = "";
    }

    // Repintar la campanita y el listado con lo que haya en el servidor.
    // Se llama al recibir un aviso y TAMBIÉN al volver de una caída de la
    // línea: mientras estuvo cortada no llegó nada, y lo que no se
    // entregó no se guarda en ningún sitio.
    function refrescar(nombre) {
      if (window.MRNotifications && typeof MRNotifications.invalidate === "function") {
        MRNotifications.invalidate(nombre);
      }
      if (typeof actualizarContador === "function") actualizarContador();
      if (typeof renderNotificaciones === "function") renderNotificaciones();
      if (typeof renderNotificacionesDropdown === "function") renderNotificacionesDropdown();
    }

    function suscribirUsuario(usuario) {
      const nombre = String(usuario && (usuario.nombre || usuario.username) || "").trim().toLowerCase();

      if (!nombre) { soltar(); return; }
      if (nombre === nombreActual && cancelar) return;

      soltar();
      nombreActual = nombre;

      cancelar = MRAvisos.escuchar(
        "notificaciones-" + nombre,
        "nueva-notificacion",
        function (notif) {
          refrescar(nombre);
          mostrarToastNotificacion(notif && notif.titulo, notif && notif.mensaje);
        }
      );
    }

    suscribirUsuario(usuarioActual());

    if (window.MRSession && typeof MRSession.subscribe === "function") {
      MRSession.subscribe(function (detalle) {
        suscribirUsuario((detalle && detalle.usuario) || usuarioActual());
      });
    }

    MRAvisos.alReconectar(function () {
      if (nombreActual) refrescar(nombreActual);
    });

    window.addEventListener("beforeunload", soltar);
  }

  // Layout.js de Morpho -> MRApp: el tiempo real espera a que la
  // infraestructura común esté lista, sin cambiar la arquitectura multi-página.
  if (window.MRApp && typeof MRApp.whenReady === "function") {
    MRApp.whenReady().then(iniciarTiempoReal);
  } else {
    iniciarTiempoReal();
  }

})();


// ---------- TOAST ----------
// Mismo estilo visual que mostrarToastNivel() de js/motor/xp.js, pero
// en la esquina superior derecha (para no pisar el toast de subida de
// nivel, que aparece arriba al centro) y clickeable para ir directo
// al listado completo.

function mostrarToastNotificacion(titulo, mensaje) {

  let contenedor = document.getElementById("toastNotifContenedor");

  if (!contenedor) {

    contenedor = document.createElement("div");
    contenedor.id = "toastNotifContenedor";
    contenedor.style.position = "fixed";
    contenedor.style.top = "20px";
    contenedor.style.right = "20px";
    contenedor.style.zIndex = "999999";
    contenedor.style.display = "flex";
    contenedor.style.flexDirection = "column";
    contenedor.style.gap = "8px";
    contenedor.style.maxWidth = "320px";

    document.body.appendChild(contenedor);

  }

  const toast = document.createElement("div");
  toast.style.background = "#1e1e2f";
  toast.style.color = "#fff";
  toast.style.padding = "14px 16px";
  toast.style.borderRadius = "10px";
  toast.style.fontSize = "14px";
  toast.style.lineHeight = "1.4";
  toast.style.boxShadow = "0 4px 14px rgba(0,0,0,0.35)";
  toast.style.border = "1px solid #ffd54a";
  toast.style.opacity = "0";
  toast.style.transition = "opacity 0.3s ease, transform 0.3s ease";
  toast.style.transform = "translateX(20px)";
  toast.style.cursor = "pointer";

  const elTitulo = document.createElement("div");
  elTitulo.textContent = titulo || "🔔 Notificación";
  elTitulo.style.fontWeight = "bold";
  elTitulo.style.color = "#ffd54a";

  const elMensaje = document.createElement("div");
  elMensaje.textContent = mensaje || "";
  elMensaje.style.marginTop = "4px";

  toast.appendChild(elTitulo);
  if (mensaje) toast.appendChild(elMensaje);

  toast.addEventListener("click", () => {
    window.location.href = "notificaciones.html";
  });

  contenedor.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateX(0)";
  });

  setTimeout(() => {

    toast.style.opacity = "0";
    toast.style.transform = "translateX(20px)";

    setTimeout(() => toast.remove(), 300);

  }, 5000);

}

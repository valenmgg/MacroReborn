// ==============================================================
// MACROREBORN - TARJETA DE PERFIL "ESTILO CLÁSICO" (layout real)
// --------------------------------------------------------------
// Widget aparte, mismo criterio que js/retro-perfil.js y
// js/perfil-avatares-galeria.js: NO modifica js/perfil.js ni
// js/usuario.js. Solo LEE el nombre que esos scripts ya pintan en
// #nombreUsuario y lo refleja en los dos lugares puramente
// decorativos del nuevo layout (el cartel inferior de la tarjeta de
// avatar y el título de la caja de estadísticas), que no tienen
// datos propios en ningún otro lado.
//
// Como usuario.js carga el perfil con fetch (asincrónico), no
// alcanza con leer una sola vez al cargar la página: se usa un
// MutationObserver + reintentos cortos, igual que retro-perfil.js.
// ==============================================================

(function () {

  function sincronizarNombre() {
    const nombreEl = document.getElementById("nombreUsuario");
    if (!nombreEl) return;

    const nombre = nombreEl.textContent.trim();
    if (!nombre || nombre === "Usuario") return;

    const destinos = [
      document.getElementById("tarjetaAvatarNombre"),
      document.getElementById("statsNombreUsuario")
    ];

    destinos.forEach(destino => {
      if (destino && destino.textContent !== nombre) {
        destino.textContent = nombre;
      }
    });
  }

  function iniciar() {
    const nombreEl = document.getElementById("nombreUsuario");
    if (!nombreEl) return;

    sincronizarNombre();

    if (typeof MutationObserver !== "undefined") {
      const observador = new MutationObserver(sincronizarNombre);
      observador.observe(nombreEl, { childList: true, characterData: true, subtree: true });
    }

    // Red de seguridad extra para usuario.html (el nombre llega por
    // fetch asincrónico y puede tardar más que el primer render).
    let intentos = 0;
    const reintento = setInterval(() => {
      sincronizarNombre();
      intentos++;
      if (intentos >= 12) clearInterval(reintento);
    }, 400);
  }

  // ---- Barra "💬 Últimos Comentarios" (solo perfil.html) ----
  // Puramente visual: colapsa/expande la vista previa de comentarios
  // que ya pinta perfil.js en #ultimosComentariosInicio. No reemplaza
  // ni duplica esa lógica, solo la muestra u oculta.
  function esModoClaro() {
    return document.documentElement.getAttribute("data-tema") === "claro";
  }

  function sincronizarPresentacionClasica() {
    if (!esModoClaro()) return;

    const nombreEl = document.getElementById("nombreUsuario");
    const migasNombre = document.getElementById("perfilMigasUsuario");
    if (nombreEl && migasNombre) {
      const nombre = nombreEl.textContent.trim();
      if (nombre && nombre !== "Usuario") migasNombre.textContent = nombre.toUpperCase();
    }

    const estadoEl = document.querySelector(".tarjeta-chapa-estado");
    if (estadoEl) {
      const texto = estadoEl.textContent.trim().toLowerCase();
      const online = texto.includes("en línea") || texto.includes("online") || texto.includes("🟢");
      estadoEl.textContent = online ? "ONLINE" : "OFFLINE";
    }
  }

  function observarModoClaro() {
    sincronizarPresentacionClasica();
    if (typeof MutationObserver !== "undefined") {
      const root = document.documentElement;
      const obs = new MutationObserver(() => sincronizarPresentacionClasica());
      obs.observe(root, { attributes: true, attributeFilter: ["data-tema"] });
    }
  }

  function iniciarBarraComentarios() {
    const barra = document.querySelector(".perfil-barra-comentarios");
    const preview = document.getElementById("ultimosComentariosInicio");
    if (!barra || !preview) return;

    barra.setAttribute("aria-expanded", "true");
    barra.addEventListener("click", () => {
      const visible = preview.style.display !== "none";
      preview.style.display = visible ? "none" : "";
      barra.setAttribute("aria-expanded", String(!visible));
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      iniciar();
      iniciarBarraComentarios();
      observarModoClaro();
    });
  } else {
    iniciar();
    iniciarBarraComentarios();
    observarModoClaro();
  }

})();

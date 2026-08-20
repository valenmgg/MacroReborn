// ============================================================
// MacroReborn — Navbar retro estilo MacroJuegos
// Conserva la estructura/categorías del proyecto y cambia de
// estado automáticamente según MRSession (invitado / logueado).
// ============================================================
(function () {
  "use strict";

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn, { once: true });
    else fn();
  }

  ready(function () {
    const nav = document.querySelector(".navbar");
    if (!nav) return;

    // ----------------------------------------------------------
    // 1) Preparar la fila inferior usando las categorías reales
    //    que ya existen en cada HTML.
    // ----------------------------------------------------------
    const categorias = nav.querySelector(".nav-categorias");
    const linksOriginales = nav.querySelector(".nav-links");

    if (categorias && linksOriginales && !nav.dataset.retroPreparada) {
      const extras = Array.from(linksOriginales.querySelectorAll(":scope > a:not(.sesion-extra)")).reverse();
      extras.forEach((a) => categorias.insertBefore(a, categorias.firstChild));

      if (!categorias.querySelector(".nav-retro-todos")) {
        const todos = document.createElement("a");
        todos.className = "nav-retro-todos";
        todos.href = "juegos.html";
        todos.textContent = "Ver Todos";
        categorias.insertBefore(todos, categorias.firstChild);
      }

      nav.dataset.retroPreparada = "1";
    }

    // ----------------------------------------------------------
    // 2) Buscador de la foto.
    // ----------------------------------------------------------
    if (!nav.querySelector("#navRetroBusqueda")) {
      const form = document.createElement("form");
      form.id = "navRetroBusqueda";
      form.className = "nav-retro-busqueda";
      form.setAttribute("role", "search");
      form.innerHTML = `
        <input id="navRetroBusquedaInput" name="q" type="search" autocomplete="off" placeholder="Buscar" aria-label="Buscar">
        <button type="submit" aria-label="Buscar">🔍</button>
      `;
      nav.insertBefore(form, linksOriginales || categorias);
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        const q = String(form.querySelector("input")?.value || "").trim();
        window.location.href = q ? "juegos.html?q=" + encodeURIComponent(q) : "juegos.html";
      });
    }

    // ----------------------------------------------------------
    // 3) Crear un contenedor estable para el estado de sesión.
    // ----------------------------------------------------------
    let actions = nav.querySelector(".nav-links");
    if (!actions) {
      actions = document.createElement("div");
      actions.className = "nav-links";
      nav.appendChild(actions);
    }
    actions.classList.add("nav-session-actions");
    actions.innerHTML = "";

    function getUser() {
      try {
        if (window.MRSession && typeof MRSession.get === "function") return MRSession.get();
        return JSON.parse(localStorage.getItem("usuarioActivo") || "null");
      } catch (_) {
        return null;
      }
    }

    function isLogged(user) {
      if (!user) return false;
      if (window.MRSession && typeof MRSession.isLogged === "function") return MRSession.isLogged();
      return !!localStorage.getItem("macroSessionToken");
    }

    function escapeHTML(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function xpPercent(user) {
      const level = Math.max(1, Number(user?.nivel ?? user?.level ?? 1));
      const xp = Number(user?.xp ?? user?.experience ?? 0);
      if (!Number.isFinite(xp) || xp <= 0) return 0;
      const base = Math.max(1, (level - 1) * 1000);
      const next = Math.max(base + 1, level * 1000);
      return Math.max(0, Math.min(100, ((xp - base) / (next - base)) * 100));
    }

    function iconAccount() {
      return `<span class="mr-account-icon" aria-hidden="true">?</span>`;
    }

    function closeAllDropdowns() {
      actions.querySelectorAll(".mr-user-dropdown").forEach((d) => d.classList.remove("abierto"));
      actions.querySelectorAll("button[aria-expanded='true']").forEach((b) => b.setAttribute("aria-expanded", "false"));
    }

    function injectCommonHelpAndGrid() {
      const help = document.createElement("a");
      help.className = "sesion-extra nav-ayuda";
      help.href = "chat.html";
      help.title = "Chat / ayuda";
      help.textContent = "?";
      actions.appendChild(help);

      const grid = document.createElement("a");
      grid.className = "nav-app-grid";
      grid.href = "index.html";
      grid.title = "Inicio";
      grid.setAttribute("aria-label", "Inicio");
      actions.appendChild(grid);
    }

    function bindDropdown(button, dropdown, wrap) {
      button.addEventListener("click", function (e) {
        e.stopPropagation();
        const open = dropdown.classList.contains("abierto");
        closeAllDropdowns();
        if (!open) {
          dropdown.classList.add("abierto");
          button.setAttribute("aria-expanded", "true");
          dropdown.querySelector("input")?.focus();
        }
      });

      document.addEventListener("click", function (e) {
        if (!dropdown.classList.contains("abierto")) return;
        if (e.target.closest(wrap)) return;
        dropdown.classList.remove("abierto");
        button.setAttribute("aria-expanded", "false");
      });
    }

    function renderGuest() {
      actions.innerHTML = `
        <div class="mr-guest-account" id="mrGuestAccount">
          <button type="button" class="mr-guest-trigger" id="botonUsuarioTemporal" aria-expanded="false" aria-haspopup="true">
            <span class="mr-guest-copy">
              <strong>Entrar con tu cuenta</strong>
              <small>¿No tienes una cuenta? <span>consigue una</span></small>
            </span>
            <span class="mr-guest-status">
              <span class="mr-guest-avatar">?</span>
              <span class="mr-guest-name">Usuario temporal</span>
              <span class="mr-guest-level">1</span>
              <span class="mr-guest-progress"><i></i></span>
            </span>
          </button>
          <div class="mr-user-dropdown" id="dropdownUsuarioTemporal">
            <div class="mr-user-dropdown-title">Iniciar sesión</div>
            <form id="formLoginNav" class="mr-login-form" novalidate>
              <input type="text" id="navLoginUsuario" placeholder="Usuario" autocomplete="username">
              <input type="password" id="navLoginPassword" placeholder="Contraseña" autocomplete="current-password">
              <div id="navLoginMensaje" class="mr-login-msg" role="alert"></div>
              <button type="submit">Login</button>
            </form>
            <div class="mr-user-dropdown-foot">¿No tienes cuenta? <a href="registro.html">Registrarse</a></div>
          </div>
        </div>
      `;

      bindDropdown(
        document.getElementById("botonUsuarioTemporal"),
        document.getElementById("dropdownUsuarioTemporal"),
        "#mrGuestAccount"
      );

      const form = document.getElementById("formLoginNav");
      const msg = document.getElementById("navLoginMensaje");
      form?.addEventListener("submit", async function (e) {
        e.preventDefault();
        const username = document.getElementById("navLoginUsuario")?.value.trim();
        const password = document.getElementById("navLoginPassword")?.value || "";
        if (!username || !password) {
          msg.textContent = "Completá usuario y contraseña";
          msg.className = "mr-login-msg visible error";
          return;
        }
        const btn = form.querySelector("button[type='submit']");
        if (btn) btn.disabled = true;
        try {
          const response = await fetch("/api/auth?action=login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
          });
          const data = await response.json();
          if (!data.success) throw new Error(data.error || "No se pudo iniciar sesión");
          const user = { ...data.user, nombre: data.user.username, nivel: data.user.level };
          if (data.token) localStorage.setItem("macroSessionToken", data.token);
          if (window.MRSession) MRSession.set(user);
          else localStorage.setItem("usuarioActivo", JSON.stringify(user));
          msg.textContent = "Bienvenido " + data.user.username;
          msg.className = "mr-login-msg visible ok";
          // El cambio de navbar sucede inmediatamente por MRSession.subscribe.
        } catch (err) {
          msg.textContent = err?.message || "Error de conexión";
          msg.className = "mr-login-msg visible error";
          if (btn) btn.disabled = false;
        }
      });

      injectCommonHelpAndGrid();
    }

    function renderLogged(user) {
      const username = escapeHTML(user?.nombre || user?.username || "Usuario");
      const level = Math.max(1, Number(user?.nivel ?? user?.level ?? 1));
      const percent = xpPercent(user);
      const monedas = Number(user?.monedas);
      const coinText = Number.isFinite(monedas) ? monedas.toLocaleString("es-ES") : "0";

      actions.innerHTML = `
        <div class="mr-logged-account" id="mrLoggedAccount">
          <button type="button" class="mr-logged-trigger" id="botonUsuarioSesion" aria-expanded="false" aria-haspopup="true">
            <span class="mr-logged-avatar">${iconAccount()}</span>
            <span class="mr-logged-copy">
              <strong>${username}</strong>
              <small>Nivel ${level}</small>
              <span class="mr-logged-progress"><i style="width:${percent}%"></i></span>
            </span>
          </button>
          <div class="mr-user-dropdown" id="dropdownUsuarioSesion">
            <div class="mr-user-dropdown-title">${username}</div>
            <a href="perfil.html">Mi perfil</a>
            <a href="notificaciones.html">Notificaciones</a>
            <a href="amigos.html">Amigos</a>
            <a href="chat.html">Chat</a>
            <div class="mr-user-dropdown-sep"></div>
            <a href="#" id="cerrarSesion">Cerrar sesión</a>
          </div>
        </div>
        <span class="nav-monedas" id="navMonedas">🪙 ${coinText}</span>
      `;

      bindDropdown(
        document.getElementById("botonUsuarioSesion"),
        document.getElementById("dropdownUsuarioSesion"),
        "#mrLoggedAccount"
      );

      document.getElementById("cerrarSesion")?.addEventListener("click", function (e) {
        e.preventDefault();
        if (window.MRSession) MRSession.logout();
        else {
          localStorage.removeItem("usuarioActivo");
          localStorage.removeItem("macroSessionToken");
        }
        render();
      });

      injectCommonHelpAndGrid();
    }

    async function syncCoins(user) {
      const name = user?.nombre || user?.username;
      if (!name) return;
      try {
        const r = await fetch("/api/content?action=avatar-shop&username=" + encodeURIComponent(name));
        const data = await r.json();
        if (data?.success && Number.isFinite(Number(data.monedas))) {
          const coins = document.getElementById("navMonedas");
          if (coins) coins.textContent = "🪙 " + Number(data.monedas).toLocaleString("es-ES");
          if (window.MRSession) MRSession.update({ monedas: Number(data.monedas) });
        }
      } catch (_) {}
    }

    function render() {
      const user = getUser();
      if (isLogged(user)) {
        renderLogged(user);
        syncCoins(user);
      } else {
        renderGuest();
      }
    }

    render();

    // Cambio inmediato al iniciar/cerrar sesión, sin tener que recargar.
    if (window.MRSession && typeof MRSession.subscribe === "function") {
      MRSession.subscribe(function () { render(); });
    }

    // También detecta cambios hechos desde otra pestaña.
    window.addEventListener("storage", function (e) {
      if (e.key === "usuarioActivo" || e.key === "macroSessionToken") render();
    });
  });
})();

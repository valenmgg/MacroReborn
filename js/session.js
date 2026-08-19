// ============================================
// MacroReborn — sesión global
// Inspirado en UserContext + userReducer de Morpho Dimension.
//
// Esta capa NO cambia el contrato actual de autenticación. La fuente de
// verdad sigue siendo Neon y el token firmado de macroSessionToken.
// usuarioActivo continúa existiendo para no romper páginas actuales.
// ============================================

(function (window) {
  "use strict";

  if (window.MRSession) return;

  const KEY_USER = "usuarioActivo";
  const KEY_TOKEN = "macroSessionToken";
  const EVENTO = "macro:session-change";

  const listeners = new Set();

  function leerSeguro() {
    try {
      return typeof leerJSON === "function"
        ? leerJSON(localStorage.getItem(KEY_USER) || "null")
        : JSON.parse(localStorage.getItem(KEY_USER) || "null");
    } catch (_) {
      return null;
    }
  }

  function normalizarUsuario(usuario) {
    if (!usuario || typeof usuario !== "object") return null;

    const copia = { ...usuario };

    // Compatibilidad de nombres de campos actuales/históricos.
    if (!copia.nombre && copia.username) copia.nombre = copia.username;
    if (copia.nivel == null && copia.level != null) copia.nivel = copia.level;
    if (copia.xp == null && copia.experience != null) copia.xp = copia.experience;
    if (copia.biografia == null && copia.bio != null) copia.biografia = copia.bio;

    return copia;
  }

  function estadoActual() {
    return normalizarUsuario(leerSeguro());
  }

  function emitir(motivo) {
    const detalle = {
      usuario: estadoActual(),
      autenticado: !!localStorage.getItem(KEY_TOKEN),
      motivo: motivo || "sync"
    };

    let enviadoPorApp = false;
    if (window.MRApp && MRApp.events && typeof MRApp.events.emit === "function") {
      try {
        MRApp.events.emit(EVENTO, detalle);
        enviadoPorApp = true;
      } catch (_) {}
    }

    if (!enviadoPorApp) {
      try {
        window.dispatchEvent(new CustomEvent(EVENTO, { detail: detalle }));
      } catch (_) {}
    }

    listeners.forEach((listener) => {
      try { listener(detalle); } catch (error) {
        console.warn("MacroReborn: listener de sesión produjo un error.", error);
      }
    });
  }

  function guardar(usuario, opciones) {
    const normalizado = normalizarUsuario(usuario);
    if (!normalizado) {
      cerrar({ limpiarToken: !(opciones && opciones.conservarToken) });
      return null;
    }

    if (typeof guardarJSON === "function") {
      guardarJSON(KEY_USER, normalizado);
    } else {
      try { localStorage.setItem(KEY_USER, JSON.stringify(normalizado)); } catch (_) {}
    }

    emitir("set");
    return normalizado;
  }

  function actualizar(parcial) {
    const actual = estadoActual() || {};
    return guardar({ ...actual, ...(parcial || {}) });
  }

  // Sincroniza la identidad local con la fila real de Neon.
  // No cambia autenticación ni crea endpoints nuevos: reutiliza
  // GET /api/users?username=... que ya existe en MacroReborn.
  // Se mantiene opt-in para no agregar tráfico extra a todas las páginas.
  let refreshPromise = null;
  let lastRefreshAt = 0;

  async function refresh(opciones) {
    const opts = opciones || {};
    const ahora = Date.now();
    if (!opts.force && refreshPromise && ahora - lastRefreshAt < 5000) return refreshPromise;
    const local = estadoActual();
    const username = opts.username || (local && (local.nombre || local.username));

    if (!username) return local;

    refreshPromise = (async function () {
      try {
      const url = "/api/users?username=" + encodeURIComponent(username);
      let data;

      if (window.MRApi && typeof MRApi.requestShared === "function") {
        data = await MRApi.requestShared("GET", url, { credentials: "same-origin" });
      } else {
        const response = await window.fetch(url, { credentials: "same-origin" });
        if (!response.ok) return local;
        data = await response.json();
      }

      if (!data || !data.success || !data.user) return local;

      const remoto = normalizarUsuario({
        ...data.user,
        nombre: data.user.username || data.user.nombre,
        nivel: data.user.level != null ? data.user.level : data.user.nivel
      });

      const resultado = guardar(remoto, { conservarToken: true });
      lastRefreshAt = Date.now();
      return resultado;
      } catch (error) {
        console.warn("MacroReborn: no se pudo sincronizar la sesión con Neon.", error);
        return local;
      } finally {
        refreshPromise = null;
      }
    })();

    return refreshPromise;
  }

  function cerrar(opciones) {
    try { localStorage.removeItem(KEY_USER); } catch (_) {}
    if (!opciones || opciones.limpiarToken !== false) {
      try { localStorage.removeItem(KEY_TOKEN); } catch (_) {}
    }
    emitir("logout");
  }

  function suscribir(listener) {
    if (typeof listener !== "function") return function () {};
    listeners.add(listener);
    return function () { listeners.delete(listener); };
  }

  const api = {
    get: estadoActual,
    load: estadoActual,
    getToken: function () {
      try { return localStorage.getItem(KEY_TOKEN); } catch (_) { return null; }
    },
    isLogged: function () {
      const usuario = estadoActual();
      return !!(usuario && localStorage.getItem(KEY_TOKEN));
    },
    set: guardar,
    update: actualizar,
    refresh: refresh,
    clear: cerrar,
    logout: cerrar,
    subscribe: suscribir,
    sync: function (motivo) { emitir(motivo || "sync"); }
  };

  window.MRSession = api;

  // Sincronización entre pestañas/ventanas. No hace ninguna petición al
  // servidor y por eso no altera la experiencia de juego actual.
  window.addEventListener("storage", function (event) {
    if (event.key === KEY_USER || event.key === KEY_TOKEN) {
      emitir("storage");
    }
  });
})(window);

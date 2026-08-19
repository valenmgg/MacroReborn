// ============================================
// MacroReborn — App Shell
// Inspirado en Layout.js de Morpho Dimension.
//
// No reemplaza las páginas HTML ni crea una SPA.
// Solo coordina la inicialización común del frontend
// y expone un punto único para que los módulos sepan
// cuándo la infraestructura básica está disponible.
// ============================================
(function (window, document) {
  "use strict";

  if (window.MRApp) return;

  const EVENT = "macro:app-ready";
  const listeners = new Set();

  // Bus de eventos global inspirado en la separación de responsabilidades
  // de Morpho. Mantiene los CustomEvent existentes para compatibilidad,
  // pero permite que nuevos módulos se comuniquen sin acoplarse entre sí.
  const eventListeners = new Map();

  function normalizarEvento(nombre) {
    const texto = String(nombre || "").trim();
    return texto || "macro:unknown";
  }

  function emit(eventName, detail) {
    const nombre = normalizarEvento(eventName);
    const payload = detail === undefined ? {} : detail;

    try {
      window.dispatchEvent(new CustomEvent(nombre, { detail: payload }));
    } catch (_) {}

    const set = eventListeners.get(nombre);
    if (set) {
      set.forEach((listener) => {
        try { listener(payload); } catch (error) {
          console.warn("MacroReborn: listener de evento produjo un error.", error);
        }
      });
    }
    return payload;
  }

  function on(eventName, listener) {
    if (typeof listener !== "function") return function () {};
    const nombre = normalizarEvento(eventName);
    let set = eventListeners.get(nombre);
    if (!set) {
      set = new Set();
      eventListeners.set(nombre, set);
    }
    set.add(listener);
    return function () {
      set.delete(listener);
      if (!set.size) eventListeners.delete(nombre);
    };
  }

  function once(eventName, listener) {
    if (typeof listener !== "function") return function () {};
    let unsubscribe = null;
    unsubscribe = on(eventName, function (detail) {
      if (unsubscribe) unsubscribe();
      listener(detail);
    });
    return unsubscribe;
  }
  let ready = false;
  let readyPromiseResolve;
  const readyPromise = new Promise((resolve) => {
    readyPromiseResolve = resolve;
  });

  function snapshot() {
    return {
      ready: true,
      hasSession: !!window.MRSession,
      hasApi: !!window.MRApi,
      hasTheme: !!window.MRTheme,
      hasModal: !!window.MRModal
    };
  }

  function emitirReady() {
    if (ready) return;
    ready = true;

    const detail = snapshot();

    try {
      window.dispatchEvent(new CustomEvent(EVENT, { detail }));
    } catch (_) {}

    listeners.forEach((listener) => {
      try { listener(detail); } catch (error) {
        console.warn("MacroReborn: listener app-ready produjo un error.", error);
      }
    });

    readyPromiseResolve(detail);
  }

  let sessionRefreshPromise = null;

  async function refreshSession(options) {
    if (!window.MRSession || typeof window.MRSession.refresh !== "function") {
      return null;
    }

    if (sessionRefreshPromise) return sessionRefreshPromise;

    sessionRefreshPromise = Promise.resolve()
      .then(function () { return window.MRSession.refresh(options || {}); })
      .finally(function () { sessionRefreshPromise = null; });

    return sessionRefreshPromise;
  }

  const api = {
    isReady: function () { return ready; },
    getServices: snapshot,
    events: {
      emit: emit,
      on: on,
      once: once
    },
    refreshSession: refreshSession,
    subscribe: function (listener) {
      if (typeof listener !== "function") return function () {};
      listeners.add(listener);
      if (ready) {
        try { listener(snapshot()); } catch (_) {}
      }
      return function () { listeners.delete(listener); };
    },
    on: function (listener) {
      return this.subscribe(listener);
    },
    whenReady: function () {
      return ready ? Promise.resolve(snapshot()) : readyPromise;
    }
  };

  window.MRApp = api;

  function marcarDocumento() {
    document.documentElement.setAttribute("data-macro-app", "ready");
    emitirReady();
  }

  // DOMContentLoaded garantiza que los módulos puedan consultar
  // el documento sin imponer una nueva arquitectura de renderizado.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", marcarDocumento, { once: true });
  } else {
    marcarDocumento();
  }
})(window, document);

// ==============================
// SISTEMA DE TEMAS - MacroReborn
// ==============================
// Maneja el modo oscuro (predeterminado, igual que siempre) y el nuevo
// modo claro de toda la web. Se aplica apenas se puede (antes de que se
// pinte la página) para que no haya parpadeos, y agrega un botón de
// sol/luna en la barra de navegación para alternar entre ambos.
//
// El tema se guarda en localStorage y se restaura solo la próxima vez
// que se abre la página.

(function () {

  const CLAVE_TEMA = "temaMacroReborn";
  const CLAVE_PALETA = "paletaMacroReborn";
  const PALETAS = {
    macro: "macro",
    neon: "neon",
    arcade: "arcade",
    clasica: "clasica"
  };

  // Definiciones públicas de los presets. La UI y otros módulos pueden
  // consultar esta información a través de MRTheme sin leer data-* ni
  // tocar localStorage directamente.
  const DEFINICIONES_PALETA = {
    macro: { id: "macro", nombre: "Macro", descripcion: "Identidad púrpura original", icono: "🟣" },
    neon: { id: "neon", nombre: "Neon", descripcion: "Acentos eléctricos", icono: "⚡" },
    arcade: { id: "arcade", nombre: "Arcade", descripcion: "Más cálida y retro", icono: "🕹️" },
    clasica: { id: "clasica", nombre: "Clásica", descripcion: "Dorada, estilo portal", icono: "🏆" }
  };

  function temaGuardado() {
    const guardado = localStorage.getItem(CLAVE_TEMA);
    return guardado === "claro" ? "claro" : "oscuro";
  }

  function aplicarTema(tema) {
    if (tema === "claro") {
      document.documentElement.setAttribute("data-tema", "claro");
    } else {
      document.documentElement.removeAttribute("data-tema");
    }
  }

  // Se aplica de inmediato (el <html> ya existe apenas el navegador
  // empieza a leer el documento), antes de que se dibuje el resto de
  // la página, para evitar el parpadeo de un tema incorrecto al cargar.
  aplicarTema(temaGuardado());

  function paletaGuardada() {
    const guardada = localStorage.getItem(CLAVE_PALETA);
    return Object.prototype.hasOwnProperty.call(PALETAS, guardada) ? guardada : PALETAS.macro;
  }

  function aplicarPaleta(paleta) {
    const segura = Object.prototype.hasOwnProperty.call(PALETAS, paleta) ? paleta : PALETAS.macro;
    if (segura === PALETAS.macro) document.documentElement.removeAttribute("data-paleta");
    else document.documentElement.setAttribute("data-paleta", segura);
  }

  aplicarPaleta(paletaGuardada());

  function temaActual() {
    return document.documentElement.getAttribute("data-tema") === "claro"
      ? "claro"
      : "oscuro";
  }

  function actualizarIconoBoton(boton) {
    if (!boton) return;

    const esClaro = temaActual() === "claro";

    boton.textContent = esClaro ? "🌙" : "☀️";
    boton.setAttribute(
      "aria-label",
      esClaro ? "Cambiar a modo oscuro" : "Cambiar a modo claro"
    );
    boton.title = boton.getAttribute("aria-label");
  }

  const EVENTO_TEMA = "macro:theme-change";
  const EVENTO_PALETA = "macro:palette-change";
  const listenersTema = new Set();
  const listenersPaleta = new Set();

  function emitirCambioTema(motivo) {
    const detalle = { tema: temaActual(), motivo: motivo || "set" };
    let enviadoPorApp = false;
    if (window.MRApp && MRApp.events && typeof MRApp.events.emit === "function") {
      try {
        MRApp.events.emit(EVENTO_TEMA, detalle);
        enviadoPorApp = true;
      } catch (_) {}
    }

    if (!enviadoPorApp) {
      try {
        window.dispatchEvent(new CustomEvent(EVENTO_TEMA, { detail: detalle }));
      } catch (_) {}
    }
    listenersTema.forEach((listener) => {
      try { listener(detalle); } catch (error) {
        console.warn("MacroReborn: listener de tema produjo un error.", error);
      }
    });
  }

  function emitirCambioPaleta(motivo) {
    const detalle = { paleta: paletaActual(), motivo: motivo || "set" };
    let enviadoPorApp = false;
    if (window.MRApp && MRApp.events && typeof MRApp.events.emit === "function") {
      try {
        MRApp.events.emit(EVENTO_PALETA, detalle);
        enviadoPorApp = true;
      } catch (_) {}
    }
    if (!enviadoPorApp) {
      try {
        window.dispatchEvent(new CustomEvent(EVENTO_PALETA, { detail: detalle }));
      } catch (_) {}
    }
    listenersPaleta.forEach((listener) => {
      try { listener(detalle); } catch (error) {
        console.warn("MacroReborn: listener de paleta produjo un error.", error);
      }
    });
  }

  function paletaActual() {
    return document.documentElement.getAttribute("data-paleta") || PALETAS.macro;
  }

  function definicionPaleta(paleta) {
    const segura = Object.prototype.hasOwnProperty.call(DEFINICIONES_PALETA, paleta)
      ? paleta
      : PALETAS.macro;
    return { ...DEFINICIONES_PALETA[segura] };
  }

  function estadoActual() {
    return {
      tema: temaActual(),
      paleta: paletaActual(),
      paletaDefinicion: definicionPaleta(paletaActual())
    };
  }

  function aplicarBotonesPaleta() {
    document.querySelectorAll("[data-mr-paleta]").forEach((boton) => {
      const activa = boton.getAttribute("data-mr-paleta") === paletaActual();
      boton.classList.toggle("activo", activa);
      boton.setAttribute("aria-pressed", activa ? "true" : "false");
    });
  }

  function alternarTema(motivo) {
    const nuevo = temaActual() === "claro" ? "oscuro" : "claro";

    aplicarTema(nuevo);
    localStorage.setItem(CLAVE_TEMA, nuevo);

    document
      .querySelectorAll(".boton-tema")
      .forEach((boton) => actualizarIconoBoton(boton));

    emitirCambioTema(motivo || "toggle");
    aplicarBotonesPaleta();
  }

  function establecerPaleta(paleta, motivo) {
    const nueva = Object.prototype.hasOwnProperty.call(PALETAS, paleta) ? paleta : PALETAS.macro;
    if (nueva === paletaActual()) {
      aplicarBotonesPaleta();
      return nueva;
    }
    aplicarPaleta(nueva);
    localStorage.setItem(CLAVE_PALETA, nueva);
    aplicarBotonesPaleta();
    emitirCambioPaleta(motivo || "set");
    return nueva;
  }

  // API pública inspirada en ThemeContext de Morpho. Mantiene el mismo
  // almacenamiento y las mismas dos apariencias actuales de MacroReborn.
  window.MRTheme = {
    get: temaActual,
    set: function (tema, motivo) {
      const nuevo = tema === "claro" ? "claro" : "oscuro";
      if (nuevo === temaActual()) {
        document
          .querySelectorAll(".boton-tema")
          .forEach((boton) => actualizarIconoBoton(boton));
        return nuevo;
      }
      aplicarTema(nuevo);
      localStorage.setItem(CLAVE_TEMA, nuevo);
      document
        .querySelectorAll(".boton-tema")
        .forEach((boton) => actualizarIconoBoton(boton));
      emitirCambioTema(motivo || "set");
      return nuevo;
    },
    toggle: alternarTema,
    palettes: Object.keys(PALETAS),
    getPalette: paletaActual,
    getPaletteDefinition: function (paleta) {
      return definicionPaleta(paleta || paletaActual());
    },
    getState: estadoActual,
    setPalette: establecerPaleta,
    subscribePalette: function (listener) {
      if (typeof listener !== "function") return function () {};
      listenersPaleta.add(listener);
      return function () { listenersPaleta.delete(listener); };
    },
    subscribe: function (listener) {
      if (typeof listener !== "function") return function () {};
      listenersTema.add(listener);
      return function () { listenersTema.delete(listener); };
    },
    on: function (listener) {
      return this.subscribe(listener);
    }
  };

  // Como ThemeContext de Morpho, el estado de tema se propaga entre vistas.
  // El evento storage permite que otra pestaña actualice la interfaz sin
  // depender de una recarga manual.
  window.addEventListener("storage", function (event) {
    if (event.key !== CLAVE_TEMA) return;
    const nuevo = event.newValue === "claro" ? "claro" : "oscuro";
    if (nuevo === temaActual()) return;
    aplicarTema(nuevo);
    document
      .querySelectorAll(".boton-tema")
      .forEach((boton) => actualizarIconoBoton(boton));
    emitirCambioTema("storage");
  });

  window.addEventListener("storage", function (event) {
    if (event.key !== CLAVE_PALETA) return;
    const nueva = Object.prototype.hasOwnProperty.call(PALETAS, event.newValue) ? event.newValue : PALETAS.macro;
    if (nueva === paletaActual()) return;
    aplicarPaleta(nueva);
    aplicarBotonesPaleta();
    emitirCambioPaleta("storage");
  });

  document.addEventListener("click", function (event) {
    const boton = event.target.closest("[data-mr-paleta]");
    if (!boton) return;
    establecerPaleta(boton.getAttribute("data-mr-paleta"), "ui");
  });

  function crearBotonTema() {
    // Si ya hay uno (por si este script se llegara a cargar dos veces),
    // no duplicamos nada.
    if (document.getElementById("botonTema")) return;

    const boton = document.createElement("button");
    boton.type = "button";
    boton.id = "botonTema";
    boton.className = "boton-tema";
    boton.addEventListener("click", alternarTema);

    const contenedorNav =
      document.querySelector(".nav-links") || document.querySelector("nav");

    if (contenedorNav) {
      contenedorNav.appendChild(boton);
    } else {
      // Páginas sin navbar (login / registro): queda flotando arriba.
      boton.classList.add("boton-tema-flotante");
      document.body.appendChild(boton);
    }

    actualizarIconoBoton(boton);
  }

  document.addEventListener("DOMContentLoaded", function () {
    crearBotonTema();
    aplicarBotonesPaleta();
  });

})();

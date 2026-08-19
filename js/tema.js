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

  function alternarTema() {
    const nuevo = temaActual() === "claro" ? "oscuro" : "claro";

    aplicarTema(nuevo);
    localStorage.setItem(CLAVE_TEMA, nuevo);

    document
      .querySelectorAll(".boton-tema")
      .forEach((boton) => actualizarIconoBoton(boton));
  }

  // API pública inspirada en ThemeContext de Morpho. Mantiene el mismo
  // almacenamiento y las mismas dos apariencias actuales de MacroReborn.
  window.MRTheme = {
    get: temaActual,
    set: function (tema) {
      const nuevo = tema === "claro" ? "claro" : "oscuro";
      aplicarTema(nuevo);
      localStorage.setItem(CLAVE_TEMA, nuevo);
      document
        .querySelectorAll(".boton-tema")
        .forEach((boton) => actualizarIconoBoton(boton));
      return nuevo;
    },
    toggle: alternarTema
  };

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

  document.addEventListener("DOMContentLoaded", crearBotonTema);

})();

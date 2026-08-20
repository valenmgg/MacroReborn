// ==============================
// MENÚ HAMBURGUESA (navbar mobile) - MacroReborn
// ==============================
// Script independiente: solo agrega el botón de hamburguesa y togglea
// la clase "nav-abierto" en .nav-links. No modifica ni depende de
// navbar.js, tema.js o buscador.js (que siguen agregando sus propios
// links/botón dentro de .nav-links normalmente, antes o después de que
// esto corra).

(function () {
  let contadorNav = 0;

  function prepararNavbar(nav) {
    if (nav.querySelector(".nav-toggle")) return;

    const links = nav.querySelector(".nav-links");
    if (!links) return;

    // Bottom bar de categorías/secciones del sitio (ver comunidad-ranking
    // y el resto de las páginas): si existe, se abre/cierra junto con
    // .nav-links con el mismo botón de hamburguesa, no es un menú aparte.
    const categorias = nav.querySelector(".nav-categorias");

    if (!links.id) {
      contadorNav += 1;
      links.id = "navLinksPrincipal" + contadorNav;
    }

    const boton = document.createElement("button");
    boton.type = "button";
    boton.className = "nav-toggle";
    boton.setAttribute("aria-label", "Abrir menú de navegación");
    boton.setAttribute("aria-expanded", "false");
    boton.setAttribute("aria-controls", links.id);
    boton.innerHTML = '<span class="nav-toggle-barra" aria-hidden="true"></span><span class="nav-toggle-label">Menú</span>';

    nav.insertBefore(boton, links);

    function cerrarMenu() {
      links.classList.remove("nav-abierto");
      if (categorias) categorias.classList.remove("nav-abierto");
      boton.setAttribute("aria-expanded", "false");
      boton.setAttribute("aria-label", "Abrir menú de navegación");
    }

    function abrirMenu() {
      links.classList.add("nav-abierto");
      if (categorias) categorias.classList.add("nav-abierto");
      boton.setAttribute("aria-expanded", "true");
      boton.setAttribute("aria-label", "Cerrar menú de navegación");
    }

    function alternarMenu() {
      if (links.classList.contains("nav-abierto")) {
        cerrarMenu();
      } else {
        abrirMenu();
      }
    }

    boton.addEventListener("click", function (e) {
      e.stopPropagation();
      alternarMenu();
    });

    // Cerrar al tocar cualquier link (incluye los que navbar.js
    // agrega después dinámicamente, gracias a la delegación de eventos).
    links.addEventListener("click", function (e) {
      if (e.target.closest("a")) cerrarMenu();
    });

    if (categorias) {
      categorias.addEventListener("click", function (e) {
        if (e.target.closest("a")) cerrarMenu();
      });
    }

    document.addEventListener("click", function (e) {
      if (!nav.contains(e.target)) cerrarMenu();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") cerrarMenu();
    });

    window.addEventListener("resize", function () {
      if (window.innerWidth > 768) cerrarMenu();
    });
  }

  function iniciar() {
    document.querySelectorAll(".navbar").forEach(prepararNavbar);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iniciar);
  } else {
    iniciar();
  }
})();

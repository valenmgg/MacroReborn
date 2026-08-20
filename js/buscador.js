// ==============================================================
// BUSCADOR GLOBAL - MacroReborn
// --------------------------------------------------------------
// Busca en tiempo real sobre datos que YA existen en el proyecto:
//   - Juegos    -> arreglo "juegos" de js/datos-juegos.js
//   - Usuarios  -> /api/users?q= (Neon, tabla users)
//   - Noticias  -> tarjetas de noticias.html (índice de solo
//                  lectura, ver NOTICIAS más abajo)
//
// Este archivo NO toca localStorage de sesión, favoritos, historial,
// comentarios, ranking ni chat. Solo lee lo que ya existe y arma un
// panel de resultados dentro de la navbar.
// ==============================================================

(function () {

  // --------------------------------------------------------------
  // ÍNDICE DE NOTICIAS
  // noticias.html no tiene (todavía) un archivo de datos propio: las
  // tarjetas están escritas directo en el HTML. Para poder buscarlas
  // desde cualquier página armamos acá un índice mínimo de solo
  // lectura (título + id de la tarjeta real en noticias.html), sin
  // duplicar contenido ni crear un sistema de noticias paralelo.
  // --------------------------------------------------------------
  const NOTICIAS = [
    { id: "noticia-chat-general", titulo: "Chat General disponible" },
    { id: "noticia-sistema-avatares", titulo: "Sistema de avatares" },
    { id: "noticia-ranking-abierto", titulo: "Ranking abierto" }
  ];

  const LIMITE_POR_CATEGORIA = 6;

  // --------------------------------------------------------------
  // HELPERS
  // --------------------------------------------------------------

  // Quita mayúsculas y acentos para que "mario" === "Mario" === "MARIO".
  function normalizar(texto) {
    return (texto || "")
      .toString()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function escaparHTML(texto) {
    return (texto || "").toString()
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function obtenerJuegos() {
    // "juegos" viene de js/datos-juegos.js si esa página lo cargó.
    return (typeof juegos !== "undefined" && Array.isArray(juegos)) ? juegos : [];
  }

  async function obtenerUsuarios(termino) {
    try {
      const resp = await fetch("/api/users?q=" + encodeURIComponent(termino) + "&limit=" + LIMITE_POR_CATEGORIA);
      const datos = await resp.json();
      if (!datos || !datos.success) return [];
      return datos.users.map(u => ({ ...u, nombre: u.username }));
    } catch (e) {
      console.warn("MacroReborn: no se pudo buscar usuarios.", e);
      return [];
    }
  }

  async function buscar(termino) {
    const q = normalizar(termino);

    if (!q) {
      return { juegos: [], usuarios: [], noticias: [] };
    }

    const juegosEncontrados = obtenerJuegos()
      .filter(j => [j.nombre, j.categoria, j.descripcion].some(valor => normalizar(valor).includes(q)))
      .slice(0, LIMITE_POR_CATEGORIA);

    const usuariosEncontrados = await obtenerUsuarios(termino);

    const noticiasEncontradas = NOTICIAS
      .filter(n => normalizar(n.titulo).includes(q))
      .slice(0, LIMITE_POR_CATEGORIA);

    return {
      juegos: juegosEncontrados,
      usuarios: usuariosEncontrados,
      noticias: noticiasEncontradas
    };
  }

  // --------------------------------------------------------------
  // CREACIÓN DEL BUSCADOR EN LA NAVBAR
  // --------------------------------------------------------------

  function crearBuscador() {
    const nav = document.querySelector(".navbar");

    if (!nav || document.getElementById("navBuscador")) return null;

    const wrapper = document.createElement("div");
    wrapper.className = "nav-buscador";
    wrapper.id = "navBuscador";

    wrapper.innerHTML = `
      <div class="buscador-caja">
        <span class="buscador-icono" aria-hidden="true">🔍</span>
        <input
          type="text"
          id="inputBuscadorGlobal"
          class="buscador-input"
          placeholder="Buscar"
          autocomplete="off"
          aria-label="Buscar juegos, usuarios y noticias"
        >
        <button
          type="button"
          id="buscadorSubmit"
          class="buscador-submit"
          aria-label="Buscar"
          title="Buscar"
        ></button>
      </div>
      <div class="buscador-panel" id="buscadorPanel" role="listbox"></div>
    `;

    const links = nav.querySelector(".nav-links");

    if (links) {
      nav.insertBefore(wrapper, links);
    } else {
      nav.appendChild(wrapper);
    }

    return wrapper;
  }

  // --------------------------------------------------------------
  // RENDER DE RESULTADOS
  // --------------------------------------------------------------

  function imagenJuegoHTML(j) {
    // Reutiliza crearImagenJuego() de datos-juegos.js si está disponible
    // (misma miniatura + mismo placeholder que usa el resto del sitio).
    if (typeof crearImagenJuego === "function") {
      return crearImagenJuego(j);
    }
    if (j.imagen) {
      return `<img src="${escaparHTML(j.imagen)}" alt="">`;
    }
    return "🎮";
  }

  // FIX: acá se mostraba siempre "imagenes/avatar.png" (el avatar por
  // defecto), nunca el avatar real de la persona. /api/users?q= ya
  // trae la columna "avatar" de cada usuario (ver api/users.js), así
  // que alcanza con reutilizar avatarMiniaturaHTML() de js/core.js
  // -la misma función que arma el avatar en miniatura en comentarios,
  // reseñas y actividad- en vez de hardcodear la imagen por defecto.
  function avatarUsuarioHTML(u) {
    if (typeof avatarMiniaturaHTML === "function") {
      return avatarMiniaturaHTML(u.avatar);
    }
    return `<img src="imagenes/avatar.png" alt="">`;
  }

  function renderResultados(panel, resultados, termino) {
    const total = resultados.juegos.length + resultados.usuarios.length + resultados.noticias.length;

    if (total === 0) {
      panel.innerHTML = `<div class="buscador-vacio">No se encontraron resultados.</div>`;
      panel.classList.add("abierto");
      return;
    }

    let html = "";

    if (resultados.juegos.length) {
      html += `<div class="buscador-grupo"><span class="buscador-grupo-titulo">🎮 Juegos</span>`;
      resultados.juegos.forEach(j => {
        html += `
          <a class="buscador-item" href="juego.html?id=${encodeURIComponent(j.id)}">
            <span class="buscador-item-imagen">${imagenJuegoHTML(j)}</span>
            <span class="buscador-item-info">
              <span class="buscador-item-nombre">${escaparHTML(j.nombre)}</span>
              ${j.categoria ? `<span class="buscador-item-categoria">${escaparHTML(j.categoria)}</span>` : ""}
            </span>
          </a>`;
      });
      html += `</div>`;
    }

    if (resultados.usuarios.length) {
      html += `<div class="buscador-grupo"><span class="buscador-grupo-titulo">👤 Usuarios</span>`;
      resultados.usuarios.forEach(u => {
        html += `
          <a class="buscador-item" href="usuario.html?usuario=${encodeURIComponent(u.nombre)}">
            <span class="buscador-item-imagen buscador-item-avatar">
              ${avatarUsuarioHTML(u)}
            </span>
            <span class="buscador-item-info">
              <span class="buscador-item-nombre">${escaparHTML(u.nombre)}</span>
            </span>
          </a>`;
      });
      html += `</div>`;
    }

    html += `<a class="buscador-ver-todos" href="juegos.html?q=${encodeURIComponent(termino)}">🔎 Ver todos los resultados para “${escaparHTML(termino)}” →</a>`;

    if (resultados.noticias.length) {
      html += `<div class="buscador-grupo"><span class="buscador-grupo-titulo">📰 Noticias</span>`;
      resultados.noticias.forEach(n => {
        html += `
          <a class="buscador-item buscador-item-noticia" data-noticia-id="${n.id}" href="noticias.html#${n.id}">
            <span class="buscador-item-imagen">📰</span>
            <span class="buscador-item-info">
              <span class="buscador-item-nombre">${escaparHTML(n.titulo)}</span>
            </span>
          </a>`;
      });
      html += `</div>`;
    }

    panel.innerHTML = html;
    panel.classList.add("abierto");

    // Si ya estamos en noticias.html, evitamos el recargado de página:
    // hacemos scroll suave y resaltamos la tarjeta directamente.
    panel.querySelectorAll(".buscador-item-noticia").forEach(enlace => {
      enlace.addEventListener("click", (e) => {
        const id = enlace.getAttribute("data-noticia-id");
        const destino = document.getElementById(id);

        if (destino) {
          e.preventDefault();
          cerrarPanel();
          limpiarInput();
          destino.scrollIntoView({ behavior: "smooth", block: "center" });
          resaltarNoticia(destino);
          history.replaceState(null, "", "noticias.html#" + id);
        }
      });
    });
  }

  function resaltarNoticia(el) {
    el.classList.remove("noticia-resaltada");
    void el.offsetWidth; // reinicia la animación si se repite
    el.classList.add("noticia-resaltada");
    setTimeout(() => el.classList.remove("noticia-resaltada"), 2200);
  }

  // --------------------------------------------------------------
  // INTERACCIÓN
  // --------------------------------------------------------------

  let wrapperEl, inputEl, panelEl;

  function cerrarPanel() {
    if (!panelEl) return;
    panelEl.classList.remove("abierto");
    panelEl.innerHTML = "";
  }

  function limpiarInput() {
    if (inputEl) inputEl.value = "";
  }

  function iniciar() {
    wrapperEl = crearBuscador();
    if (!wrapperEl) return;

    inputEl = document.getElementById("inputBuscadorGlobal");
    panelEl = document.getElementById("buscadorPanel");
    const submitEl = document.getElementById("buscadorSubmit");

    const ejecutarBusqueda = () => {
      const termino = String(inputEl?.value || "").trim();
      if (!termino) return;
      window.location.href = "juegos.html?q=" + encodeURIComponent(termino);
    };

    submitEl?.addEventListener("click", ejecutarBusqueda);

    let temporizador = null;

    inputEl.addEventListener("input", () => {
      const valor = inputEl.value;

      if (temporizador) clearTimeout(temporizador);

      if (!valor.trim()) {
        cerrarPanel();
        return;
      }

      // Pequeño debounce para que la búsqueda en tiempo real no
      // recalcule en cada micro-tecleo, sin que se sienta lenta.
      temporizador = setTimeout(async () => {
        const resultados = await buscar(valor);
        // Si el usuario siguió tipeando mientras esperábamos la
        // respuesta, no pisamos el resultado de la búsqueda más nueva.
        if (inputEl.value !== valor) return;
        renderResultados(panelEl, resultados, valor);
      }, 120);
    });

    inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        ejecutarBusqueda();
      }
    });

    inputEl.addEventListener("focus", () => {
      if (inputEl.value.trim() && panelEl.innerHTML.trim()) {
        panelEl.classList.add("abierto");
      }
    });

    document.addEventListener("click", (e) => {
      if (wrapperEl && !wrapperEl.contains(e.target)) {
        cerrarPanel();
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        cerrarPanel();
        inputEl.blur();
      }
    });

    // Si llegamos a noticias.html desde un resultado del buscador
    // (noticias.html#id), hacemos scroll + resaltado al cargar.
    if (window.location.hash) {
      const destino = document.getElementById(window.location.hash.slice(1));
      if (destino && destino.classList.contains("noticia")) {
        setTimeout(() => {
          destino.scrollIntoView({ behavior: "smooth", block: "center" });
          resaltarNoticia(destino);
        }, 300);
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iniciar);
  } else {
    iniciar();
  }

})();


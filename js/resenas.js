// =========================
// MACROREBORN - RESEÑAS DE JUEGOS (Fase 2: Neon, cierre de migración)
// =========================
// Sistema independiente y autocontenido (IIFE), no depende del orden de
// carga de los demás scripts de juego.html.
//
// Las reseñas viven en la tabla "game_reviews" de Neon
// (/api/content?action=reviews). Un usuario solo puede tener UNA
// reseña por juego (UNIQUE user_id+game_id en la base). Puede editarla
// o eliminarla, pero no duplicarla — mismo criterio que antes.

(function () {
  "use strict";

  const parametrosResena = new URLSearchParams(window.location.search);
  const idJuegoResena = Number(parametrosResena.get("id"));

  if (Number.isNaN(idJuegoResena)) return;

  let usuarioResena = window.MRSession ? window.MRSession.get() : leerJSON(localStorage.getItem("usuarioActivo") || "null");
  if (window.MRSession && typeof window.MRSession.subscribe === "function") {
    window.MRSession.subscribe(function (detalle) {
      usuarioResena = detalle && detalle.usuario ? detalle.usuario : null;
    });
  }

  // ---------- ELEMENTOS ----------

  const listaResenas = document.getElementById("listaResenas");
  const formResena = document.getElementById("formResena");
  const resenaAviso = document.getElementById("resenaAviso");
  const contEstrellasForm = document.getElementById("formResenaEstrellas");
  const textareaResena = document.getElementById("resenaTexto");
  const botonPublicar = document.getElementById("botonPublicarResena");
  const botonEliminar = document.getElementById("botonEliminarResena");

  if (!listaResenas) return;

  // ---------- AVATAR (mismo criterio que comunidad.js / usuario.js) ----------

  const ORDEN_CAPAS_RESENA = [
    "fondo", "espalda", "modelo", "piel", "ojos", "boca",
    "botas", "pantalon", "remera", "guantes", "accesorio",
    "cara", "pelo", "mascota", "borde"
  ];

  function rutaImagenCapaResena(valor) {
    if (!valor || valor === "ninguno") return null;
    if (!valor.includes("_")) {
      return "imagenes/" + valor + ".png";
    }
    const idx = valor.indexOf("_");
    const modelo = valor.slice(0, idx);
    const resto = valor.slice(idx + 1);
    return "imagenes/" + modelo + "/" + resto + ".png";
  }

  function avatarHTMLResena(nombre) {
    const avatar = typeof obtenerAvatarCacheado === "function" ? obtenerAvatarCacheado(nombre) : null;

    if (!avatar) {
      return `<img src="imagenes/avatar.png" class="resena-avatar-simple" alt="${escaparHTML(nombre)}" loading="lazy">`;
    }

    if(avatarEsPNG(avatar)){
      return `<img src="${avatarPNGData(avatar)}" class="resena-avatar-simple avatar-png-personalizado" alt="${escaparHTML(nombre)}" loading="lazy">`;
    }

    let capas = "";
    let rutasCapas = [];
    ORDEN_CAPAS_RESENA.forEach((tipo) => {
      const ruta = rutaImagenCapaResena(avatar[tipo]);
      if (ruta) {
        capas += `<img src="${ruta}" class="capa-resena" alt="" loading="lazy">`;
        rutasCapas.push(ruta);
      }
    });

    return capas
      ? `<div class="resena-avatar avatar-compuesto" data-capas="${rutasCapas.join("|")}" data-capa-class="capa-resena">${capas}</div>`
      : `<img src="imagenes/avatar.png" class="resena-avatar-simple" alt="${escaparHTML(nombre)}" loading="lazy">`;
  }

  // ---------- HELPERS ----------

  function escaparHTML(texto) {
    const div = document.createElement("div");
    div.textContent = texto == null ? "" : String(texto);
    return div.innerHTML;
  }

  function estrellasHTML(valor) {
    let html = "";
    for (let i = 1; i <= 5; i++) {
      html += `<span class="resena-estrella ${i <= valor ? "llena" : ""}">★</span>`;
    }
    return html;
  }

  async function obtenerResenas() {
    try {
      const resp = await fetch("/api/content?action=reviews&gameId=" + encodeURIComponent(idJuegoResena));
      const datos = await resp.json();
      return (datos && datos.success) ? datos.resenas : [];
    } catch (error) {
      console.warn("MacroReborn: no se pudieron cargar las reseñas.", error);
      return [];
    }
  }

  function miResena(lista) {
    if (!usuarioResena) return null;
    return lista.find((r) => r.usuario === usuarioResena.nombre) || null;
  }

  // ---------- RENDER LISTA ----------

  let _resenasCache = [];

  async function renderResenas() {
    const lista = await obtenerResenas();
    _resenasCache = lista;

    if (typeof cargarAvataresDeVarios === "function") {
      await cargarAvataresDeVarios(lista.map((r) => r.usuario));
    }

    if (lista.length === 0) {
      listaResenas.innerHTML = `<p class="resenas-vacio">Todavía no hay reseñas para este juego. ¡Sé el primero en dejar la tuya!</p>`;
      actualizarEstadoBotones();
      return;
    }

    listaResenas.innerHTML = lista
      .map((r) => {
        const esPropia = usuarioResena && r.usuario === usuarioResena.nombre;
        const fecha = new Date(r.updated_at || r.created_at).toLocaleDateString("es-AR");

        return `
      <div class="tarjeta-resena${esPropia ? " resena-propia" : ""}" data-usuario="${escaparHTML(r.usuario)}">
        <div class="resena-cabecera">
          ${avatarHTMLResena(r.usuario)}
          <div class="resena-datos">
            <b class="resena-nombre">${escaparHTML(r.usuario)}</b>
            <div class="resena-estrellas">${estrellasHTML(r.calificacion)}</div>
            <span class="resena-fecha">${escaparHTML(fecha)}${r.editado ? " · editada" : ""}</span>
          </div>
          ${esPropia ? `
          <div class="resena-acciones-propias">
            <button type="button" class="boton-editar-resena">✏️ Editar</button>
            <button type="button" class="boton-borrar-resena">🗑️ Eliminar</button>
          </div>` : ""}
        </div>
        <p class="resena-texto">${escaparHTML(r.texto)}</p>
        ${typeof botonLikeHTML === "function" ? botonLikeHTML("resena", escaparHTML(idJuegoResena + ":" + r.usuario), usuarioResena ? usuarioResena.nombre : null) : ""}
        ${!esPropia ? `
        <button type="button" class="boton-responder-resena" data-usuario="${escaparHTML(r.usuario)}"
          style="margin-top:8px;background:none;border:1px solid rgba(148,163,184,0.35);color:#93c5fd;border-radius:8px;padding:4px 12px;font-size:12.5px;cursor:pointer;">
          Responder
        </button>` : ""}
      </div>
    `;
      })
      .join("");

    // Acciones sobre la propia reseña, directo desde la tarjeta
    listaResenas.querySelectorAll(".boton-editar-resena").forEach((btn) => {
      btn.addEventListener("click", () => {
        cargarFormularioParaEditar();
        if (formResena) {
          formResena.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        if (textareaResena) textareaResena.focus();
      });
    });

    listaResenas.querySelectorAll(".boton-borrar-resena").forEach((btn) => {
      btn.addEventListener("click", eliminarMiResena);
    });

    // RESPONDER (autocompleta @usuario en el textarea de reseña)
    listaResenas.querySelectorAll(".boton-responder-resena").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!usuarioResena) {
          alert("Iniciá sesión para responder");
          return;
        }
        if (textareaResena) {
          textareaResena.value = "@" + btn.dataset.usuario + " ";
          textareaResena.focus();
        }
        if (formResena) {
          formResena.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    });

    actualizarEstadoBotones();
  }

  // ---------- FORMULARIO ----------

  let valorSeleccionadoForm = 0;

  function pintarEstrellasForm(valorHover) {
    if (!contEstrellasForm) return;
    const valor = valorHover || valorSeleccionadoForm;
    contEstrellasForm.querySelectorAll(".estrella").forEach((btn) => {
      const v = Number(btn.dataset.valor);
      btn.classList.toggle("activa", v <= valor);
    });
  }

  function cargarFormularioParaEditar() {
    const existente = miResena(_resenasCache);
    if (!existente) return;

    valorSeleccionadoForm = existente.calificacion;
    pintarEstrellasForm();

    if (textareaResena) textareaResena.value = existente.texto;

    actualizarEstadoBotones();
  }

  function limpiarFormulario() {
    valorSeleccionadoForm = 0;
    pintarEstrellasForm();
    if (textareaResena) textareaResena.value = "";
  }

  function actualizarEstadoBotones() {
    const existente = miResena(_resenasCache);

    if (botonPublicar) {
      botonPublicar.textContent = existente ? "Actualizar reseña" : "Publicar reseña";
    }

    if (botonEliminar) {
      botonEliminar.style.display = existente ? "inline-flex" : "none";
    }
  }

  function actualizarVisibilidadForm() {
    if (usuarioResena) {
      if (formResena) formResena.style.display = "block";
      if (resenaAviso) resenaAviso.style.display = "none";
      cargarFormularioParaEditar();
      actualizarEstadoBotones();
    } else {
      if (formResena) formResena.style.display = "none";
      if (resenaAviso) resenaAviso.style.display = "block";
    }
  }

  if (contEstrellasForm) {
    const botonesEstrellaForm = contEstrellasForm.querySelectorAll(".estrella");

    botonesEstrellaForm.forEach((btn) => {
      btn.addEventListener("mouseenter", () => {
        pintarEstrellasForm(Number(btn.dataset.valor));
      });

      btn.addEventListener("click", () => {
        valorSeleccionadoForm = Number(btn.dataset.valor);
        pintarEstrellasForm();
      });
    });

    contEstrellasForm.addEventListener("mouseleave", () => pintarEstrellasForm());
  }

  if (botonPublicar) {
    botonPublicar.addEventListener("click", async () => {
      if (!usuarioResena) {
        alert("Iniciá sesión para dejar tu reseña");
        return;
      }

      if (typeof bloqueadoPorSuspension === "function" && await bloqueadoPorSuspension()) return;

      const texto = (textareaResena?.value || "").trim();

      if (!valorSeleccionadoForm) {
        alert("Elegí una calificación en estrellas para tu reseña");
        return;
      }

      if (!texto) {
        alert("Escribí un texto para tu reseña");
        return;
      }

      botonPublicar.disabled = true;

      try {
        const resp = await fetch("/api/content?action=reviews", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: usuarioResena.nombre,
            gameId: idJuegoResena,
            calificacion: valorSeleccionadoForm,
            texto: texto
          })
        });
        const datos = await resp.json();

        if (!datos || !datos.success) {
          alert((datos && datos.error) || "No se pudo guardar la reseña");
          return;
        }

        if (typeof notificarMenciones === "function") {
          notificarMenciones(texto, usuarioResena.nombre, "en una reseña de este juego.");
        }

        if (typeof registrarActividad === "function") {
          const nombreJuego = (typeof juego !== "undefined" && juego) ? juego.nombre : ("Juego #" + idJuegoResena);
          registrarActividad(
            usuarioResena.nombre,
            "resena",
            typeof empaquetarJuego === "function" ? empaquetarJuego(nombreJuego, idJuegoResena, texto) : nombreJuego
          );
        }

        await renderResenas();
      } catch (error) {
        console.warn("MacroReborn: no se pudo guardar la reseña.", error);
        alert("Error de conexión. Probá de nuevo.");
      } finally {
        botonPublicar.disabled = false;
      }
    });
  }

  function eliminarMiResena() {
    if (!usuarioResena) return;

    const confirmar =
      typeof pedirConfirmacion === "function"
        ? (mensaje, onConfirmar) => pedirConfirmacion(mensaje, onConfirmar, "🗑️ Eliminar reseña")
        : (mensaje, onConfirmar) => {
            if (confirm(mensaje)) onConfirmar();
          };

    confirmar("¿Seguro que querés eliminar tu reseña de este juego?", async () => {
      try {
        await fetch("/api/content?action=reviews", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: usuarioResena.nombre, gameId: idJuegoResena })
        });
      } catch (error) {
        console.warn("MacroReborn: no se pudo eliminar la reseña.", error);
      }

      limpiarFormulario();
      await renderResenas();
    });
  }

  if (botonEliminar) {
    botonEliminar.addEventListener("click", eliminarMiResena);
  }

  // ---------- INICIO ----------

  actualizarVisibilidadForm();
  renderResenas();
})();

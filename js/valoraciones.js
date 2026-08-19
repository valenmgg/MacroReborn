// =========================
// MACROREBORN - CALIFICACION (ESTRELLAS) + LIKE / NO ME GUSTA
// (Fase 2: Neon, cierre de migración)
// =========================
// Sistema independiente y autocontenido (IIFE) para no chocar con las
// variables globales que ya usa juego.js (idJuego, juego, usuario, etc).
//
// Las calificaciones en estrellas viven en "game_ratings" y los votos
// like/dislike en "game_votes" (tabla de Neon,
// /api/content?action=game-ratings|game-votes). Antes vivían en
// localStorage bajo "calificaciones_<idJuego>" y "votosJuego_<idJuego>".

(function () {
  "use strict";

  const parametrosVal = new URLSearchParams(window.location.search);
  const idJuegoVal = Number(parametrosVal.get("id"));

  if (Number.isNaN(idJuegoVal)) return;

  function obtenerUsuarioValoraciones() {
    try {
      return (window.MRSession && typeof MRSession.get === "function")
        ? MRSession.get()
        : leerJSON(localStorage.getItem("usuarioActivo") || "null");
    } catch (_) { return null; }
  }

  // ---------- ELEMENTOS ----------

  const contEstrellasRelleno = document.getElementById("estrellasRelleno");
  const elPromedio = document.getElementById("calificacionPromedio");
  const elVotos = document.getElementById("calificacionVotos");
  const contEstrellasUsuario = document.getElementById("calificacionEstrellas");

  const botonLike = document.getElementById("botonLike");
  const botonDislike = document.getElementById("botonDislike");
  const contadorLikes = document.getElementById("contadorLikes");
  const contadorDislikes = document.getElementById("contadorDislikes");

  // Si la página no tiene estos elementos, no hay nada que hacer.
  if (!contEstrellasUsuario && !botonLike) return;

  // ---------- CALIFICACIONES (1 a 5 ESTRELLAS) ----------

  async function obtenerCalificaciones() {
    const usuarioVal = obtenerUsuarioValoraciones();
    try {
      const params = new URLSearchParams({ action: "game-ratings", gameId: idJuegoVal });
      if (usuarioVal) params.set("username", usuarioVal.nombre);

      const resp = await fetch("/api/content?" + params.toString());
      const datos = await resp.json();

      if (!datos || !datos.success) return { promedio: 0, cantidad: 0, miCalificacion: 0 };
      return datos;
    } catch (error) {
      console.warn("MacroReborn: no se pudo cargar la calificación.", error);
      return { promedio: 0, cantidad: 0, miCalificacion: 0 };
    }
  }

  function pintarCalificacion(datos) {
    const promedio = datos.promedio || 0;
    const cantidad = datos.cantidad || 0;

    if (contEstrellasRelleno) {
      contEstrellasRelleno.style.width = (promedio / 5) * 100 + "%";
    }

    if (elPromedio) {
      elPromedio.textContent = promedio.toFixed(1) + "/5";
    }

    if (elVotos) {
      elVotos.textContent =
        "(" + cantidad + (cantidad === 1 ? " voto" : " votos") + ")";
    }

    if (contEstrellasUsuario) {
      const miVoto = datos.miCalificacion || 0;
      contEstrellasUsuario.querySelectorAll(".estrella").forEach((btn) => {
        const valor = Number(btn.dataset.valor);
        btn.classList.toggle("activa", valor <= miVoto);
      });
    }
  }

  async function renderCalificacion() {
    pintarCalificacion(await obtenerCalificaciones());
  }

  if (contEstrellasUsuario) {
    const botonesEstrella = contEstrellasUsuario.querySelectorAll(".estrella");

    botonesEstrella.forEach((btn) => {
      btn.addEventListener("mouseenter", () => {
        const valor = Number(btn.dataset.valor);
        botonesEstrella.forEach((b) => {
          b.classList.toggle("preview", Number(b.dataset.valor) <= valor);
        });
      });

      btn.addEventListener("click", async () => {
        const usuarioVal = obtenerUsuarioValoraciones();
        if (!usuarioVal) {
          alert("Iniciá sesión para calificar este juego");
          return;
        }

        if (typeof bloqueadoPorSuspension === "function" && await bloqueadoPorSuspension()) return;

        const valor = Number(btn.dataset.valor);

        try {
          const resp = await fetch("/api/content?action=game-ratings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: usuarioVal.nombre, gameId: idJuegoVal, calificacion: valor })
          });
          const datos = await resp.json();
          if (datos && datos.success) pintarCalificacion(datos);
        } catch (error) {
          console.warn("MacroReborn: no se pudo guardar la calificación.", error);
        }
      });
    });

    contEstrellasUsuario.addEventListener("mouseleave", () => {
      botonesEstrella.forEach((b) => b.classList.remove("preview"));
    });
  }

  renderCalificacion();

  // ---------- LIKE / NO ME GUSTA ----------

  async function obtenerVotosJuego() {
    const usuarioVal = obtenerUsuarioValoraciones();
    try {
      const params = new URLSearchParams({ action: "game-votes", gameId: idJuegoVal });
      if (usuarioVal) params.set("username", usuarioVal.nombre);

      const resp = await fetch("/api/content?" + params.toString());
      const datos = await resp.json();

      if (!datos || !datos.success) return { likes: 0, dislikes: 0, miVoto: null };
      return datos;
    } catch (error) {
      console.warn("MacroReborn: no se pudieron cargar los votos.", error);
      return { likes: 0, dislikes: 0, miVoto: null };
    }
  }

  function pintarVotosJuego(datos) {
    if (contadorLikes) contadorLikes.textContent = datos.likes || 0;
    if (contadorDislikes) contadorDislikes.textContent = datos.dislikes || 0;

    if (botonLike) botonLike.classList.toggle("activo", datos.miVoto === "like");
    if (botonDislike) botonDislike.classList.toggle("activo", datos.miVoto === "dislike");
  }

  async function renderVotosJuego() {
    pintarVotosJuego(await obtenerVotosJuego());
  }

  async function votarJuego(tipo) {
    const usuarioVal = obtenerUsuarioValoraciones();
    if (!usuarioVal) {
      alert("Iniciá sesión para votar este juego");
      return;
    }

    if (typeof bloqueadoPorSuspension === "function" && await bloqueadoPorSuspension()) return;

    try {
      const resp = await fetch("/api/content?action=game-votes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: usuarioVal.nombre, gameId: idJuegoVal, voto: tipo })
      });
      const datos = await resp.json();
      if (datos && datos.success) {
        pintarVotosJuego(datos);

        // Actividad reciente: solo cuando el resultado del click es
        // "me gusta" activo (no cuando se saca el like ni cuando se
        // vota "no me gusta").
        if (tipo === "like" && datos.miVoto === "like" && typeof registrarActividad === "function") {
          const nombreJuego = (typeof juego !== "undefined" && juego) ? juego.nombre : ("Juego #" + idJuegoVal);
          registrarActividad(
            usuarioVal.nombre,
            "like_juego",
            typeof empaquetarJuego === "function" ? empaquetarJuego(nombreJuego, idJuegoVal) : nombreJuego
          );
        }
      }
    } catch (error) {
      console.warn("MacroReborn: no se pudo registrar el voto.", error);
    }
  }

  if (botonLike) {
    botonLike.addEventListener("click", () => votarJuego("like"));
  }

  if (botonDislike) {
    botonDislike.addEventListener("click", () => votarJuego("dislike"));
  }

  renderVotosJuego();

  if (window.MRSession && typeof MRSession.subscribe === "function") {
    MRSession.subscribe(() => {
      renderCalificacion();
      renderVotosJuego();
    });
  }
})();

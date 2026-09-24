// ==============================================================
// MACROREBORN - GALERÍA DE AVATARES GUARDADOS (perfil público)
// --------------------------------------------------------------
// Widget aparte para la pestaña "Avatares" de usuario.html: muestra
// los 6 casilleros de la galería del jugador visitado (los mismos que
// arma en perfil.html, js/perfil-avatares-galeria.js) y deja votar
// cada uno con 👍 "Me gusta" / 👎 "No me gusta".
//
// IMPORTANTE: este archivo NO modifica js/usuario.js. Lee el
// "?usuario=" de la URL de forma independiente (mismo criterio que
// js/usuario-favoritos.js) y el usuario logueado desde localStorage,
// así no depende de ninguna variable interna de usuario.js.
// ==============================================================

(function () {

  const CASILLEROS = 6;

  const contenedor = document.getElementById("galeriaAvataresUsuario");
  if (!contenedor) return;

  const parametros = new URLSearchParams(window.location.search);
  const nombreVisitado = parametros.get("usuario");
  if (!nombreVisitado) return;

  const obtenerActivo = () => (window.MRSession && typeof MRSession.get === "function")
    ? MRSession.get()
    : ((typeof leerJSON === "function")
      ? leerJSON(localStorage.getItem("usuarioActivo") || "null")
      : JSON.parse(localStorage.getItem("usuarioActivo") || "null"));

  // ---------- LA IMAGEN DE CADA RANURA ----------
  // Cada diseño guardado tiene su compuesto, en /avatares/<id>/ranura<N>/,
  // que el servidor hace al guardarlo. Se pide el grande: el visor mide
  // 100x154 y el pequeño se vería borroso. Hasta el 24/09/2026 se
  // dibujaba prenda por prenda. Ver docs/AVATARES-SERVIDOR.md, fase 3.

  // El id del dueño de la galería: lo manda la API junto a las ranuras.
  let idDelDueno = null;

  function marcadoAvatar(fila) {
    const ranura = { id: idDelDueno, ranura: fila.slot, avatar_compuesto: fila.avatar_compuesto };
    const imagen = imagenDeAvatar(fila.avatar, ranura, 327, 504) || SILUETA_AVATAR;
    if (imagen.tipo === "silueta") {
      return `<img src="${imagen.src}" class="capa-tarjeta" alt="" loading="lazy">`;
    }
    return `<img class="capa-tarjeta" data-src="${imagen.src}" alt="" loading="lazy">`;
  }

  // ---------- API ----------

  async function obtenerGaleria() {
    try {
      const params = new URLSearchParams({ action: "avatar-gallery", username: nombreVisitado });
      const activo = obtenerActivo();
      if (activo) params.set("viewer", activo.nombre);

      const resp = await fetch("/api/content?" + params.toString());
      const datos = await resp.json();
      if (datos && datos.success) {
        idDelDueno = datos.usuario_id || null;
        return datos.slots;
      }
    } catch (error) {
      console.warn("MacroReborn: no se pudo cargar la galería de avatares.", error);
    }
    const vacia = [];
    for (let n = 1; n <= CASILLEROS; n++) {
      vacia.push({ slot: n, id: null, avatar: null, likes: 0, dislikes: 0, miVoto: null });
    }
    return vacia;
  }

  async function votarAvatar(avatarId, voto) {
    const activo = obtenerActivo();
    if (!activo) {
      alert("Iniciá sesión para votar este avatar");
      return null;
    }

    if (typeof bloqueadoPorSuspension === "function" && await bloqueadoPorSuspension()) return null;

    try {
      const resp = await fetch("/api/content?action=avatar-vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: activo.nombre, avatarId, voto })
      });
      const datos = await resp.json();
      if (datos && datos.success) return datos;
      if (datos && datos.error) console.warn("MacroReborn:", datos.error);
    } catch (error) {
      console.warn("MacroReborn: no se pudo registrar el voto del avatar.", error);
    }
    return null;
  }

  // ---------- RENDER ----------

  function tarjetaOcupada(fila) {
    const avatarHTML = marcadoAvatar(fila);

    const div = document.createElement("div");
    div.className = "tarjeta-avatar-galeria";

    div.innerHTML = `
      <span class="numero-casillero">${fila.slot}</span>

      <div class="avatar-galeria-visor">
        ${avatarHTML}
      </div>

      <div class="votos-avatar-botones">
        <button type="button" class="btn-voto-avatar btn-voto-like ${fila.miVoto === "like" ? "activo" : ""}" data-avatar-id="${fila.id}" data-voto="like">
          👍 <span class="numero">${fila.likes || 0}</span>
        </button>
        <button type="button" class="btn-voto-avatar btn-voto-dislike ${fila.miVoto === "dislike" ? "activo" : ""}" data-avatar-id="${fila.id}" data-voto="dislike">
          👎 <span class="numero">${fila.dislikes || 0}</span>
        </button>
      </div>
    `;

    div.querySelectorAll(".btn-voto-avatar").forEach(boton => {
      boton.addEventListener("click", async () => {
        const datos = await votarAvatar(fila.id, boton.dataset.voto);
        if (!datos) return;

        const btnLike = div.querySelector(".btn-voto-like");
        const btnDislike = div.querySelector(".btn-voto-dislike");

        btnLike.querySelector(".numero").textContent = datos.likes || 0;
        btnDislike.querySelector(".numero").textContent = datos.dislikes || 0;
        btnLike.classList.toggle("activo", datos.miVoto === "like");
        btnDislike.classList.toggle("activo", datos.miVoto === "dislike");
      });
    });

    return div;
  }

  function tarjetaVacia(fila) {
    const div = document.createElement("div");
    div.className = "tarjeta-avatar-galeria tarjeta-avatar-vacia";

    div.innerHTML = `
      <span class="numero-casillero">${fila.slot}</span>
      <div class="avatar-galeria-visor vacio">—</div>
      <p class="texto-vacio">Vacío</p>
    `;

    return div;
  }

  async function renderizarGaleria() {
    const slots = await obtenerGaleria();

    contenedor.innerHTML = "";
    slots.forEach(fila => {
      contenedor.appendChild(fila.avatar ? tarjetaOcupada(fila) : tarjetaVacia(fila));
    });
  }

  renderizarGaleria();

})();

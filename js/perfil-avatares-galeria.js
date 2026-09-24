// ==============================================================
// MACROREBORN - GALERÍA DE AVATARES GUARDADOS (perfil propio)
// --------------------------------------------------------------
// Widget aparte para la pestaña "Avatar" de perfil.html: 6 casilleros
// donde el usuario puede dejar diseños de avatar ya armados (tal como
// se podía hacer en Macrojuegos), visibles también en su perfil
// público (usuario.html), donde los demás usuarios los votan con
// 👍 / 👎. Acá, en el perfil propio, en vez de botones de voto se
// muestran dos cuadros con el conteo de "me gusta" / "no me gusta".
//
// IMPORTANTE: este archivo NO modifica js/perfil.js. Solo LEE el
// estado que el editor de avatar ya pinta en el DOM (las opciones con
// clase ".seleccionada", que perfil.js mantiene sincronizadas con
// editorCapas) y usa "datosUsuario" (variable global que ya expone
// perfil.js) para saber de quién es la galería. Mismo criterio de
// "script satélite" que ya usan js/perfil-favoritos.js,
// js/perfil-actividad.js, etc.
// ==============================================================

(function () {

  const CASILLEROS = 6;

  const contenedor = document.getElementById("galeriaAvataresGuardados");
  const botonGuardarEnGaleria = document.getElementById("guardarEnGaleria");

  // Si la pestaña Avatar no está en esta página, no hay nada que hacer.
  if (!contenedor) return;

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

  // ---------- LEER EL DISEÑO ACTUAL DEL EDITOR ----------
  // El editor (js/perfil.js) marca con la clase "seleccionada" la
  // opción activa de CADA categoría (aunque su grupo esté oculto), así
  // que esto refleja el estado real de editorCapas sin tener que leer
  // esa variable directamente.

  function leerDisenoDelEditor() {
    const avatar = {};
    document.querySelectorAll(".opcion-item.seleccionada").forEach(item => {
      const cat = item.dataset.capa;
      const val = item.dataset.valor;
      if (cat && val) avatar[cat] = val;
    });
    return avatar.modelo ? avatar : null;
  }

  // ---------- IDENTIDAD DEL PERFIL PROPIO ----------
  // MRProfileContext es la fuente preferida para los módulos de perfil.
  // MRSession queda como respaldo y datosUsuario conserva compatibilidad
  // con el editor existente.
  function usuarioPerfilActual() {
    if (window.MRProfileContext && MRProfileContext.type === "own" && typeof MRProfileContext.getUser === "function") {
      return MRProfileContext.getUser();
    }
    if (window.MRSession && typeof MRSession.get === "function") {
      return MRSession.get();
    }
    return (typeof datosUsuario !== "undefined" && datosUsuario) ? datosUsuario : null;
  }

  function nombrePerfilActual() {
    const usuario = usuarioPerfilActual();
    return usuario?.nombre || usuario?.username || "";
  }

  // ---------- API ----------

  async function obtenerGaleria() {
    const nombre = nombrePerfilActual();
    if (!nombre) return null;
    try {
      const resp = await fetch("/api/content?action=avatar-gallery&username=" + encodeURIComponent(nombre));
      const datos = await resp.json();
      if (datos && datos.success) {
        idDelDueno = datos.usuario_id || null;
        return datos.slots;
      }
    } catch (error) {
      console.warn("MacroReborn: no se pudo cargar la galería de avatares.", error);
    }
    // Galería vacía como respaldo, para no dejar la pestaña rota.
    const vacia = [];
    for (let n = 1; n <= CASILLEROS; n++) {
      vacia.push({ slot: n, id: null, avatar: null, likes: 0, dislikes: 0, miVoto: null });
    }
    return vacia;
  }

  async function guardarEnCasillero(slot, avatar) {
    try {
      await fetch("/api/content?action=avatar-gallery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: nombrePerfilActual(), slot, avatar })
      });
    } catch (error) {
      console.warn("MacroReborn: no se pudo guardar el avatar en la galería.", error);
    }
    await renderizarGaleria();
  }

  async function vaciarCasillero(slot) {
    await guardarEnCasillero(slot, null);
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

      <div class="votos-avatar-caja">
        <div class="caja-conteo caja-conteo-like" title="Me gusta">
          <span class="icono">👍</span>
          <span class="numero">${fila.likes || 0}</span>
        </div>
        <div class="caja-conteo caja-conteo-dislike" title="No me gusta">
          <span class="icono">👎</span>
          <span class="numero">${fila.dislikes || 0}</span>
        </div>
      </div>

      <div class="acciones-avatar-galeria">
        <button type="button" class="btn-reemplazar-avatar" data-slot="${fila.slot}">🔁 Reemplazar con el diseño actual</button>
        <button type="button" class="btn-quitar-avatar-galeria" data-slot="${fila.slot}">🗑️ Quitar de la galería</button>
      </div>
    `;

    div.querySelector(".btn-reemplazar-avatar").addEventListener("click", async () => {
      const diseno = leerDisenoDelEditor();
      if (!diseno) {
        alert("Abrí el editor y armá un diseño antes de guardarlo en la galería.");
        return;
      }
      if (!confirm("¿Reemplazar el avatar guardado en el casillero " + fila.slot + " por el diseño actual del editor? Se van a perder los votos que tenía.")) return;
      await guardarEnCasillero(fila.slot, diseno);
    });

    div.querySelector(".btn-quitar-avatar-galeria").addEventListener("click", async () => {
      if (!confirm("¿Quitar este avatar de la galería? Se van a perder los votos que tenía.")) return;
      await vaciarCasillero(fila.slot);
    });

    return div;
  }

  function tarjetaVacia(fila) {
    const div = document.createElement("div");
    div.className = "tarjeta-avatar-galeria tarjeta-avatar-vacia";

    div.innerHTML = `
      <span class="numero-casillero">${fila.slot}</span>
      <div class="avatar-galeria-visor vacio">➕</div>
      <p class="texto-vacio">Casillero vacío</p>
      <div class="acciones-avatar-galeria">
        <button type="button" class="btn-guardar-aqui" data-slot="${fila.slot}">💾 Guardar diseño actual acá</button>
      </div>
    `;

    div.querySelector(".btn-guardar-aqui").addEventListener("click", async () => {
      const diseno = leerDisenoDelEditor();
      if (!diseno) {
        alert("Abrí el editor y armá un diseño antes de guardarlo en la galería.");
        return;
      }
      await guardarEnCasillero(fila.slot, diseno);
    });

    return div;
  }

  async function renderizarGaleria() {
    const slots = await obtenerGaleria();

    contenedor.innerHTML = "";
    slots.forEach(fila => {
      contenedor.appendChild(fila.avatar ? tarjetaOcupada(fila) : tarjetaVacia(fila));
    });
  }

  // ---------- BOTÓN DEL EDITOR: "Guardar en galería" ----------
  // Guarda el diseño actual en el primer casillero libre; si los 6
  // están ocupados, avisa y sugiere reemplazar uno desde la galería.

  if (botonGuardarEnGaleria) {
    botonGuardarEnGaleria.addEventListener("click", async () => {
      const diseno = leerDisenoDelEditor();
      if (!diseno) {
        alert("Armá un diseño en el editor antes de guardarlo en la galería.");
        return;
      }

      const slots = await obtenerGaleria();
      const libre = slots.find(s => !s.avatar);

      if (!libre) {
        alert("Ya usaste los 6 casilleros de tu galería. Elegí uno para reemplazarlo desde \"Mis avatares guardados\", más abajo.");
        return;
      }

      await guardarEnCasillero(libre.slot, diseno);
    });
  }

  renderizarGaleria();

})();

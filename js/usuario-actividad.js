// =========================
// MACROREBORN - ACTIVIDAD RECIENTE (PERFIL DE OTRO USUARIO) — Fase 2: Neon
// =========================
// FIX: la pestaña "Actividad reciente" de usuario.html nunca hacía
// nada — no existía ningún script que la pintara (solo estaba
// implementada para el perfil propio, en js/perfil-actividad.js).
// Este archivo sigue el mismo patrón que usuario-favoritos.js y
// usuario-historial.js: lee "?usuario=" de la URL y reutiliza
// obtenerActividades() (definida en js/motor/actividad.js, ya cargado
// antes que este archivo) para traer la actividad del usuario
// visitado, no la de la sesión activa.


const parametrosActividadUsuario = new URLSearchParams(
window.location.search
);


const idUsuarioActividad = parametrosActividadUsuario.get("usuario");


const contenedorActividadUsuario = document.getElementById("listaActividadUsuario");


async function renderActividadUsuario(){

    if(!contenedorActividadUsuario || !idUsuarioActividad) return;

    const viewerActividad = (() => {
      try {
        const activo = (window.MRSession && typeof window.MRSession.get === "function") ? window.MRSession.get() : (typeof leerJSON === "function" ? leerJSON(localStorage.getItem("usuarioActivo") || "null") : null);
        return activo && activo.nombre ? activo.nombre : "";
      } catch (_) { return ""; }
    })();

    const lista = typeof obtenerActividades === "function"
        ? await obtenerActividades(idUsuarioActividad, viewerActividad)
        : [];

    if(lista.length === 0){

        contenedorActividadUsuario.innerHTML =
            `<p style="color:#94a3b8;font-size:14px;">Este jugador todavía no tiene actividad registrada.</p>`;

        return;

    }

    // FIX: el avatar del jugador visitado tampoco vive en _cacheAvatares
    // (esa caché es para avatares de OTROS usuarios vistos desde la
    // sesión activa) hasta que se pide explícitamente. El nuevo
    // encabezado con avatar (ver renderizarActividadHTML en
    // js/motor/actividad.js) lo necesita para esta misma pestaña.
    if(typeof cargarAvatarUsuario === "function"){
        await cargarAvatarUsuario(idUsuarioActividad);
    }

    contenedorActividadUsuario.innerHTML = lista.map(a =>
        renderizarActividadHTML(idUsuarioActividad, a.tipo, a.detalle, a.fecha, a.hora, avatarMiniActividadUsuario)
    ).join("");

}

renderActividadUsuario();


// ---------- ACTIVIDAD DE AMIGOS (PERFIL DE OTRO USUARIO) ----------
// Igual que renderActividadAmigos() en js/perfil-actividad.js, pero
// mostrando los amigos favoritos (⭐) del usuario VISITADO
// (idUsuarioActividad), no los de la sesión activa. Cualquier
// visitante puede verla: /api/social?action=favoriteFriends y
// /api/content?action=activity-friends son de lectura pública, igual
// que el resto de usuario.html (lista de amigos, favoritos, etc.).

const contenedorActividadAmigosUsuario = document.getElementById("listaActividadAmigosUsuario");

// Reutiliza rutaImagenCapa()/ORDEN_CAPAS (definidas de forma global en
// js/usuario.js, fuera de su IIFE) en vez de CAPAS_IMG, que es el
// criterio propio de perfil.js.
function avatarMiniActividadUsuario(nombre){
  const avatar = typeof obtenerAvatarCacheado === "function" ? obtenerAvatarCacheado(nombre) : null;

  if(!avatar){
    return `<img src="imagenes/avatar.png" class="avatar-comentario" alt="" loading="lazy">`;
  }

  if(avatarEsPNG(avatar)){
    return `<img src="${avatarPNGData(avatar)}" class="avatar-comentario avatar-png-personalizado" alt="" loading="lazy">`;
  }

  let capas = "";
  let rutasCapas = [];
  ORDEN_CAPAS.forEach(tipo=>{
    const ruta = rutaImagenCapa(avatar[tipo]);
    if(ruta){
      capas += `<img class="capa-comentario" src="${ruta}" alt="" loading="lazy">`;
      rutasCapas.push(ruta);
    }
  });

  return `<div class="avatar-mini avatar-compuesto" ` +
    `data-capas="${rutasCapas.join("|")}" data-capa-class="capa-comentario">${capas}</div>`;
}

async function renderActividadAmigosUsuario(){
  if(!contenedorActividadAmigosUsuario || !idUsuarioActividad) return;

  let favoritosDeEsePerfil = [];
  try{
    const resp = await fetch("/api/social?action=favoriteFriends&username=" + encodeURIComponent(idUsuarioActividad));
    const datos = await resp.json();
    favoritosDeEsePerfil = (datos && datos.success) ? datos.favoritos : [];
  }catch(error){
    console.warn("MacroReborn: no se pudo cargar los amigos favoritos de este jugador.", error);
  }

  if(favoritosDeEsePerfil.length === 0){
    contenedorActividadAmigosUsuario.innerHTML = `<p style="color:#94a3b8;font-size:14px;">Este jugador todavía no marcó amigos favoritos.</p>`;
    return;
  }

  const actividadesAmigos = typeof obtenerActividadesDe === "function"
    ? (await obtenerActividadesDe(favoritosDeEsePerfil)).slice(0, MAX_ACTIVIDADES)
    : [];

  if(actividadesAmigos.length === 0){
    contenedorActividadAmigosUsuario.innerHTML = `<p style="color:#94a3b8;font-size:14px;">Sus amigos todavía no realizaron ninguna actividad.</p>`;
    return;
  }

  if(typeof cargarAvataresDeVarios === "function"){
    await cargarAvataresDeVarios(actividadesAmigos.map(a => a.nombreAmigo));
  }

  contenedorActividadAmigosUsuario.innerHTML = actividadesAmigos.map(a =>
    renderizarActividadHTML(a.nombreAmigo, a.tipo, a.detalle, a.fecha, a.hora, avatarMiniActividadUsuario)
  ).join("");
}

renderActividadAmigosUsuario();

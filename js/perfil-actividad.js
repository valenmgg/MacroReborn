// =========================
// MACROREBORN - ACTIVIDAD (PERFIL PROPIO) — Fase 2: Neon
// =========================
//
// Usa datosUsuario, ORDEN_CAPAS y CAPAS_IMG definidos en perfil.js
// (se carga después en perfil.html), y las funciones del motor de
// actividad (js/motor/actividad.js).


// ---------- AVATAR MINI (reutiliza el mismo criterio que perfil.js) ----------

function avatarMiniActividad(nombre){
  // El avatar viaja embebido en el usuario (users.avatar, Neon); se lee
  // de la caché en memoria de js/core.js, precargada por
  // renderActividadAmigos() antes de pintar la lista.
  const avatar = typeof obtenerAvatarCacheado === "function" ? obtenerAvatarCacheado(nombre) : null;

  if(!avatar){
    return `<img src="imagenes/avatar.png" class="avatar-comentario" alt="" loading="lazy">`;
  }

  let capas = "";
  let rutasCapas = [];
  ORDEN_CAPAS.forEach(tipo=>{
    const valor = avatar[tipo];
    if(valor && valor !== "ninguno" && CAPAS_IMG[valor]){
      capas += `<img class="capa-comentario" src="${CAPAS_IMG[valor]}" alt="" loading="lazy">`;
      rutasCapas.push(CAPAS_IMG[valor]);
    }
  });

  // FIX: este contenedor forzaba un tamaño inline de 44x44px, pero el
  // recorte de ".capa-comentario" está calibrado matemáticamente para
  // los 55x55px de ".avatar-mini" (ver nota en css/perfil.css). Ese
  // desajuste de tamaño rompía por completo el recorte y el círculo
  // quedaba vacío. Se saca el "style" inline para que use el mismo
  // tamaño de 55px que ya funciona bien en Comentarios.
  return `<div class="avatar-mini avatar-compuesto" ` +
    `data-capas="${rutasCapas.join("|")}" data-capa-class="capa-comentario">${capas}</div>`;
}


// ---------- ACTIVIDAD RECIENTE (propia) ----------

async function renderActividadReciente(){
  const contenedor = document.getElementById("listaActividadReciente");
  if(!contenedor) return;

  const usuarioActual = (window.MRSession && typeof MRSession.get === "function") ? MRSession.get() : datosUsuario;
  if(!usuarioActual || !usuarioActual.nombre) return;

  const lista = await obtenerActividades(usuarioActual.nombre);

  if(lista.length === 0){
    contenedor.innerHTML = `<p style="color:#94a3b8;font-size:14px;">Todavía no tenés actividad registrada.</p>`;
    return;
  }

  // FIX: avatarMiniActividad() lee el avatar de _cacheAvatares (js/core.js),
  // una caché pensada para el avatar de OTROS usuarios (chat, comentarios,
  // actividad de amigos). El propio nunca se guarda ahí, así que sin esta
  // línea el nuevo encabezado con avatar (ver renderizarActividadHTML en
  // js/motor/actividad.js) mostraría siempre el avatar por defecto en esta
  // pestaña en vez del avatar real del dueño del perfil.
  _cacheAvatares[usuarioActual.nombre] = normalizarAvatar(usuarioActual.avatar);

  contenedor.innerHTML = lista.map(a =>
    renderizarActividadHTML(usuarioActual.nombre, a.tipo, a.detalle, a.fecha, a.hora, avatarMiniActividad)
  ).join("");
}


// ---------- ACTIVIDAD DE AMIGOS ----------
// Antes mostraba la actividad de TODOS los amigos
// (/api/social?action=friends). Ahora, con el sistema de "Amigos
// favoritos" (pestaña Amigos del perfil), esta pestaña muestra
// únicamente la actividad de los amigos marcados como favoritos
// (/api/social?action=favoriteFriends), no en localStorage.

async function renderActividadAmigos(){
  const contenedor = document.getElementById("listaActividadAmigos");
  if(!contenedor) return;

  const usuarioActual = (window.MRSession && typeof MRSession.get === "function") ? MRSession.get() : datosUsuario;
  if(!usuarioActual || !usuarioActual.nombre) return;

  let misFavoritos = [];
  try{
    const url = "/api/social?action=favoriteFriends&username=" + encodeURIComponent(usuarioActual.nombre);
    let datos;
    if(window.MRApi && typeof MRApi.requestShared === "function"){
      datos = await MRApi.requestShared("GET", url, { credentials: "same-origin" });
    }else{
      const resp = await fetch(url);
      datos = await resp.json();
    }
    misFavoritos = (datos && datos.success) ? datos.favoritos : [];
  }catch(error){
    console.warn("MacroReborn: no se pudo cargar los amigos favoritos.", error);
  }

  if(misFavoritos.length === 0){
    contenedor.innerHTML = `<p style="color:#94a3b8;font-size:14px;">Todavía no marcaste amigos favoritos. Andá a la pestaña 🤝 Amigos y tocá la ⭐ de hasta 10 amigos para ver su actividad acá.</p>`;
    return;
  }

  const actividadesAmigos = (await obtenerActividadesDe(misFavoritos)).slice(0, MAX_ACTIVIDADES);

  if(actividadesAmigos.length === 0){
    contenedor.innerHTML = `<p style="color:#94a3b8;font-size:14px;">Tus amigos todavía no realizaron ninguna actividad.</p>`;
    return;
  }

  if(typeof cargarAvataresDeVarios === "function"){
    await cargarAvataresDeVarios(actividadesAmigos.map(a => a.nombreAmigo));
  }

  contenedor.innerHTML = actividadesAmigos.map(a =>
    renderizarActividadHTML(a.nombreAmigo, a.tipo, a.detalle, a.fecha, a.hora, avatarMiniActividad)
  ).join("");
}


// ---------- INICIO ----------

renderActividadReciente();
renderActividadAmigos();

if(window.MRSession && typeof MRSession.subscribe === "function"){
  MRSession.subscribe(function(detalle){
    if(!detalle || !detalle.usuario) return;
    renderActividadReciente();
    renderActividadAmigos();
  });
}

// Cuando un juego acaba de registrarse en Neon, la pestaña de perfil puede
// refrescar solamente los bloques visibles de actividad. No se escribe
// ninguna actividad localmente: siempre se vuelve a leer del servidor.
function refrescarActividadPorJuego(payload){
  const usuario = (window.MRSession && typeof MRSession.get === "function") ? MRSession.get() : datosUsuario;
  if(!usuario || !usuario.nombre || !payload || !payload.username) return;
  if(String(usuario.nombre).toLowerCase() !== String(payload.username).toLowerCase()) return;
  renderActividadReciente();
}

window.addEventListener("macro:game-played", function(event){
  refrescarActividadPorJuego(event && event.detail);
});

function refrescarActividadPorEvento(payload){
  const usuario = (window.MRSession && typeof MRSession.get === "function") ? MRSession.get() : datosUsuario;
  if(!usuario || !usuario.nombre || !payload || !payload.username) return;
  if(String(usuario.nombre).toLowerCase() !== String(payload.username).toLowerCase()) return;
  renderActividadReciente();
}

window.addEventListener("macro:achievement-unlocked", function(event){
  refrescarActividadPorEvento(event && event.detail);
});

window.addEventListener("macro:activity-recorded", function(event){
  refrescarActividadPorEvento(event && event.detail);
});

window.addEventListener("storage", function(event){
  if(event.key === "macro:last-game-played" && event.newValue){
    try{ refrescarActividadPorJuego(JSON.parse(event.newValue)); }catch(_){}
    return;
  }
  if(event.key === "macro:last-achievement-unlocked" && event.newValue){
    try{ refrescarActividadPorEvento(JSON.parse(event.newValue)); }catch(_){}
    return;
  }
  if(event.key === "macro:last-activity-recorded" && event.newValue){
    try{ refrescarActividadPorEvento(JSON.parse(event.newValue)); }catch(_){}
  }
});

// ==============================
// USUARIO PÚBLICO - MacroReborn
// usuario.html?usuario=NombreDelUsuario
// ==============================


// ---------- PESTAÑAS ----------

const botonesTab = document.querySelectorAll(".tab");
const contenidosTab = document.querySelectorAll(".contenido-tab");
let perfilLimitadoPorBloqueo = false;

function aplicarRestriccionTabsPorBloqueo() {
  // El estado visual SIEMPRE se recalcula desde cero. El aviso y las
  // pestañas no pueden quedar arrastrados de otro perfil visitado.
  botonesTab.forEach(boton => {
    const esInicio = boton.dataset.tab === "inicio";
    if (perfilLimitadoPorBloqueo) {
      boton.hidden = !esInicio;
      boton.style.display = esInicio ? "" : "none";
      boton.classList.toggle("activa", esInicio);
    } else {
      boton.hidden = false;
      boton.style.display = "";
    }
  });

  contenidosTab.forEach(contenido => {
    const esInicio = contenido.id === "inicio";
    if (perfilLimitadoPorBloqueo) {
      contenido.hidden = !esInicio;
      contenido.style.display = esInicio ? "" : "none";
      contenido.classList.toggle("activo", esInicio);
    } else {
      contenido.hidden = false;
      contenido.style.display = "";
    }
  });

  const aviso = document.getElementById("avisoPerfilBloqueado");
  if (aviso) {
    aviso.hidden = !perfilLimitadoPorBloqueo;
    // Algunos estilos globales pueden sobrescribir el comportamiento
    // nativo de [hidden], por eso también fijamos display explícitamente.
    aviso.style.display = perfilLimitadoPorBloqueo ? "inline-flex" : "none";
  }
}

botonesTab.forEach(boton => {
  boton.addEventListener("click", () => {
    if (perfilLimitadoPorBloqueo && boton.dataset.tab !== "inicio") return;

    botonesTab.forEach(b => b.classList.remove("activa"));
    contenidosTab.forEach(c => c.classList.remove("activo"));
    boton.classList.add("activa");
    const destino = document.getElementById(boton.dataset.tab);
    if (destino) destino.classList.add("activo");
  });
});


// ---------- HELPERS ----------

function obtenerActivo() {
  return (window.MRSession && typeof MRSession.get === "function")
    ? MRSession.get()
    : leerJSON(localStorage.getItem("usuarioActivo") || "null");
}

// ---------- ORDEN DE CAPAS ----------

const ORDEN_CAPAS = [
  "fondo","espalda","modelo","piel","ojos","boca",
  "botas","pantalon","remera","guantes","accesorio",
  "cara","pelo","mascota","borde"
];

// Resuelve la ruta real de una capa de avatar.
// El "modelo" (ej: "tora") vive en imagenes/tora.png.
// El resto de las capas (ej: "tora_piel1") viven en imagenes/tora/piel1.png.
function rutaImagenCapa(valor) {
  if (!valor || valor === "ninguno") return null;
  if (!valor.includes("_")) {
    return "imagenes/" + valor + ".png";
  }
  const idx = valor.indexOf("_");
  const modelo = valor.slice(0, idx);
  const resto = valor.slice(idx + 1);
  return "imagenes/" + modelo + "/" + resto + ".png";
}


// ---------- LEER URL ----------

const params = new URLSearchParams(window.location.search);
const nombreBuscado = params.get("usuario");


// ---------- REDIRECCIÓN AL PROPIO PERFIL ----------
// usuario.html es exclusivamente para ver perfiles AJENOS. Si la
// persona logueada entra a su propio perfil desde acá (por ejemplo,
// un link "Ver perfil" en Comunidad, Ranking, etc. que apunta a
// usuario.html?usuario=<su propio nombre>), la mandamos directo a
// perfil.html en vez de mostrarle su propio perfil como si fuera el
// de otro jugador. Se compara sin distinguir mayúsculas/minúsculas
// porque los nombres de usuario no son sensibles a eso en ningún otro
// lugar del sitio (login, búsqueda, etc.).

const _activoParaRedirigir = obtenerActivo();

const _esPropioPerfil = !!(
  _activoParaRedirigir &&
  _activoParaRedirigir.nombre &&
  nombreBuscado &&
  _activoParaRedirigir.nombre.toLowerCase() === nombreBuscado.toLowerCase()
);

if (_esPropioPerfil) {

  window.location.replace("perfil.html");

} else {

(async function(){

let usuario = null;
const activo = obtenerActivo();

try{

  let datos;
  if(window.MRApi && typeof window.MRApi.requestShared === "function"){
    // MRApi ya devuelve el JSON parseado; no es un Response.
    datos = await window.MRApi.requestShared(
      "GET",
      "/api/users?username=" + encodeURIComponent(nombreBuscado),
      { credentials: "same-origin" }
    );
  }else{
    const respuesta = await fetch("/api/users?username=" + encodeURIComponent(nombreBuscado));
    datos = await respuesta.json();
  }

  if(datos && datos.success){
    usuario = {
      ...datos.user,
      nombre: datos.user.username,
      nivel: datos.user.level,
      biografia: datos.user.bio || "Todavía no escribió una biografía.",
      fechaRegistro: datos.user.created_at
    };
  }

}catch(error){

  console.warn("MacroReborn: no se pudo cargar el perfil.", error);

}


if (!usuario) {

  alert("Usuario no encontrado");

} else {

  // Precargar logros/insignias del perfil visitado antes de renderizar
  // nada que dependa de ellos (puntos de logros, insignias, tarjetas).
  if(typeof cargarLogros === "function"){
    await cargarLogros(usuario.nombre);
  }

  // Datos básicos
  document.getElementById("nombreUsuario").textContent = usuario.nombre;

  // SEO: título de pestaña y meta description reales para este perfil
  // (usuario.html es un único archivo para todos los perfiles vía
  // ?id=). La página sigue marcada noindex en el <head> (perfiles con
  // contenido variable/escaso no aportan valor de búsqueda todavía),
  // pero el título correcto mejora igual la pestaña del navegador y
  // cómo se ve el link al compartirlo.
  if (typeof seoActualizar === "function") {
    seoActualizar({
      titulo: usuario.nombre + " - Perfil de jugador | MacroReborn",
      descripcion: seoRecortarDescripcion(
        usuario.biografia ||
        (usuario.nombre + " juega en MacroReborn. Mirá su nivel, sus logros y su actividad reciente.")
      ),
      url: SEO_SITE + "/usuario.html?id=" + encodeURIComponent(nombreBuscado)
    });
  }

  // ---------- INSIGNIAS OFICIALES ----------
  // Se muestran debajo del nombre. Son manuales (no se otorgan por
  // logros): si el usuario no tiene ninguna, el contenedor queda oculto.
  if(typeof renderInsigniasEnContenedor === "function"){
    renderInsigniasEnContenedor("insigniasPerfil", usuario.nombre);
  }
  // FIX: "estado" nunca venía en la respuesta de /api/users (esa
  // columna es el estado de la cuenta -status-, no de conexión), así
  // que siempre caía al literal fijo "🟢 En línea" sin importar si la
  // persona estaba realmente conectada. Se calcula con el mismo
  // criterio que ya usa Comunidad (usuarioEstaConectado, en
  // js/core.js): en línea si tuvo actividad (last_login) en los
  // últimos MINUTOS_CONECTADO minutos.
  // FIX: "estado" nunca venía en la respuesta de /api/users (esa
  // columna es el estado de la cuenta -status-, no de conexión), así
  // que siempre caía al literal fijo "🟢 En línea" sin importar si la
  // persona estaba realmente conectada. Se calcula con el mismo
  // criterio que ya usa Comunidad (usuarioEstaConectado, en
  // js/core.js): en línea si tuvo actividad (last_login) en los
  // últimos MINUTOS_CONECTADO minutos.
  //
  // Queda en una función aparte (en vez de código suelto) para poder
  // volver a pintarla sola cuando llega un latido en vivo por Pusher,
  // o cada cierto tiempo (setInterval más abajo), sin recargar la
  // página.
  function pintarEstadoYUltimaConexion(){

    document.getElementById("estado").textContent =
      usuario.nombre + " · " +
      ((typeof usuarioEstaConectado === "function" && usuarioEstaConectado(usuario))
        ? "🟢 En línea"
        : "⚪ Desconectado");

    const textoUltimaConexion = typeof tiempoRelativo === "function"
      ? tiempoRelativo(usuario.last_login, "Nunca")
      : (usuario.last_login || "Nunca");

    document.getElementById("ultimaConexion").textContent = "Última conexión: " + textoUltimaConexion;

  }

  pintarEstadoYUltimaConexion();
  document.getElementById("nivel").textContent = "⭐ Nivel " + (usuario.nivel || 1);
  document.getElementById("biografia").textContent = usuario.biografia || "Todavía no escribió una biografía.";
  document.getElementById("xp").textContent = (usuario.xp || 0) + " XP";

  // LOGROS: se suman los puntos de los logros realmente desbloqueados,
  // con la misma función que usa perfil.js (calcularPuntosLogros, en
  // js/motor/logros.js), en vez de un campo suelto que podía faltar.
  const puntosLogros = typeof calcularPuntosLogros === "function"
    ? calcularPuntosLogros(usuario.nombre)
    : 0;
  document.getElementById("logros").textContent = puntosLogros + " puntos";

  // RANKING: se reutiliza obtenerPosicionRanking() (js/ranking.js) para
  // mostrar la misma posición real que aparece en ranking.html.
  document.getElementById("ranking").textContent = "Calculando…";
  if(typeof obtenerPosicionRanking === "function"){
    obtenerPosicionRanking(usuario.nombre).then(posicionRanking=>{
      document.getElementById("ranking").textContent = posicionRanking ? "#" + posicionRanking : "Sin clasificar";
    });
  } else {
    document.getElementById("ranking").textContent = "Sin clasificar";
  }

  // FIX: mismos dos bugs que en perfil.js (perfil propio) — se
  // mostraba el ISO crudo de Neon en vez de una fecha legible, y se
  // leía un campo ("ultimaConexionTS") que nunca existía en vez del
  // last_login real que ya viaja embebido en "usuario" (viene de
  // /api/users, ver más arriba).
  document.getElementById("registro").textContent =
    typeof fechaLegible === "function"
      ? fechaLegible(usuario.fechaRegistro, "Desconocido")
      : (usuario.fechaRegistro || "Desconocido");

  document.title = usuario.nombre + " - MacroReborn";
  

  const descripcionInicio = document.getElementById("descripcionInicio");
  if (descripcionInicio) {
    descripcionInicio.textContent = usuario.biografia || "Todavía no escribió una biografía.";
  }


  // ---------- AMIGOS (lista real, solo lectura) ----------
  // Mismas tarjetas que la Comunidad (ver css/comunidad.css, copiadas
  // en css/perfil.css bajo "AMIGOS"). La estrella de "Amigo favorito"
  // acá es solo un indicador (no un botón): los favoritos los define
  // cada usuario en SU PROPIO perfil (perfil.html), no se pueden
  // marcar desde el perfil ajeno de otra persona.

  // Amigos del perfil visitado (para "ya somos amigos" y la lista de
  // solo lectura). Se pide una sola vez y se reusa en ambos lados.
  let _amigosDeEstePerfil = [];
  let _favoritosDeEstePerfil = [];

  async function cargarAmigosDeEstePerfil(){
    try{
      const respuesta = await fetch("/api/social?action=friends&username=" + encodeURIComponent(usuario.nombre));
      const datos = await respuesta.json();
      _amigosDeEstePerfil = (datos && datos.success) ? datos.amigos : [];
    }catch(error){
      console.warn("MacroReborn: no se pudo cargar la lista de amigos.", error);
      _amigosDeEstePerfil = [];
    }

    try{
      const respuestaFav = await fetch("/api/social?action=favoriteFriends&username=" + encodeURIComponent(usuario.nombre));
      const datosFav = await respuestaFav.json();
      _favoritosDeEstePerfil = (datosFav && datosFav.success) ? datosFav.favoritos : [];
    }catch(error){
      console.warn("MacroReborn: no se pudo cargar los amigos favoritos.", error);
      _favoritosDeEstePerfil = [];
    }
  }

  function renderAmigosUsuario() {
    const contenedor = document.getElementById("listaAmigosUsuario");
    if (!contenedor) return;

    if (_amigosDeEstePerfil.length === 0) {
      contenedor.innerHTML = `<p style="color:#94a3b8;font-size:14px;">Este jugador todavía no tiene amigos.</p>`;
      return;
    }

    // Favoritos primero, igual que en perfil.html.
    const amigosOrdenados = [
      ..._amigosDeEstePerfil.filter(a => _favoritosDeEstePerfil.includes(a.username)),
      ..._amigosDeEstePerfil.filter(a => !_favoritosDeEstePerfil.includes(a.username))
    ];

    contenedor.innerHTML = `<div class="grid-usuarios">` + amigosOrdenados.map(amigo => {
      const nombreAmigo = amigo.username;
      const av = normalizarAvatar(amigo.avatar);
      const esFavorito = _favoritosDeEstePerfil.includes(nombreAmigo);

      let capas = "";
      let rutasCapas = [];

      if (av) {
        ORDEN_CAPAS.forEach(tipo => {
          const ruta = rutaImagenCapa(av[tipo]);
          if (ruta) {
            capas += `<img class="capa-tarjeta" src="${ruta}" alt="" loading="lazy">`;
            rutasCapas.push(ruta);
          }
        });
      }

      const avatarHTML = capas || `<img src="imagenes/avatar.png" class="avatar-default" alt="" loading="lazy">`;

      return `
        <div class="tarjeta-usuario">

          ${esFavorito ? `<span class="icono-favorito-amigo" title="Amigo favorito">★</span>` : ""}

          <div class="avatar-tarjeta avatar-compuesto" data-capas="${rutasCapas.join("|")}" data-capa-class="capa-tarjeta">
            ${avatarHTML}
          </div>

          <h3 class="usuario-nombre">${escaparHTML(nombreAmigo)}</h3>

          <div class="usuario-stats">
            <div class="stat-item">
              <span class="stat-valor">${amigo.level || 1}</span>
              <span class="stat-label">⭐ Nivel</span>
            </div>
          </div>

          <a href="usuario.html?usuario=${encodeURIComponent(nombreAmigo)}" class="btn-ver-perfil" style="width:100%;">👤 Ver perfil</a>

        </div>
      `;
    }).join("") + `</div>`;
  }

  await cargarAmigosDeEstePerfil();
  renderAmigosUsuario();


  // ---------- AVATAR ----------
  // El avatar viaja embebido en el usuario (users.avatar), ya no hace
  // falta ir a buscarlo a una clave localStorage aparte.

  const avatar = normalizarAvatar(usuario.avatar);
  const caja = document.getElementById("avatarUsuario");

if (avatar && caja) {

  if(avatarEsPNG(avatar)){
    caja.innerHTML = `<img src="${avatarPNGData(avatar)}" class="avatar-png-personalizado" alt="Avatar PNG" style="width:100%;height:100%;object-fit:contain;">`;
  } else {

  caja.innerHTML = "";

  let contenedorAvatar = document.createElement("div");

  contenedorAvatar.style.position = "relative";
  contenedorAvatar.style.width = "100%";
  contenedorAvatar.style.height = "100%";
  contenedorAvatar.style.display = "flex";
  contenedorAvatar.style.justifyContent = "center";
  contenedorAvatar.style.alignItems = "center";
  contenedorAvatar.className = "avatar-compuesto";

  const estiloCapaUsuario = "position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;";
  let rutasCapasUsuario = [];

  ORDEN_CAPAS.forEach(tipo => {

    const ruta = rutaImagenCapa(avatar[tipo]);

    if(ruta){

      const img = document.createElement("img");

      img.src = ruta;
      img.setAttribute("style", estiloCapaUsuario);

      contenedorAvatar.appendChild(img);
      rutasCapasUsuario.push(ruta);

    }

  });

  contenedorAvatar.setAttribute("data-capas", rutasCapasUsuario.join("|"));
  contenedorAvatar.setAttribute("data-capa-style", estiloCapaUsuario);

  caja.appendChild(contenedorAvatar);

  }
}


  // ---------- BOTÓN AGREGAR AMIGO ----------

  const btnAmigo = document.getElementById("agregarAmigo");

  // Solicitudes propias del visitante (para saber si ya le mandó
  // solicitud a este perfil, o si este perfil ya le mandó una a él).
  let _misSolicitudes = { solicitudesEntrantes: [], solicitudesSalientes: [] };

  async function cargarMisSolicitudes(){
    if(!activo) return;
    try{
      const respuesta = await fetch("/api/social?action=friends&username=" + encodeURIComponent(activo.nombre));
      const datos = await respuesta.json();
      if(datos && datos.success){
        _misSolicitudes = {
          solicitudesEntrantes: datos.solicitudesEntrantes,
          solicitudesSalientes: datos.solicitudesSalientes
        };
      }
    }catch(error){
      console.warn("MacroReborn: no se pudo cargar tus solicitudes.", error);
    }
  }

  function actualizarBotonAmigo() {
    if (!btnAmigo) return;

    if (!activo) {
      btnAmigo.textContent = "🔑 Iniciá sesión para agregar";
      btnAmigo.disabled = true;
      btnAmigo.style.opacity = "0.5";
      btnAmigo.style.cursor = "default";
      return;
    }

    if (activo.nombre === usuario.nombre) {
      btnAmigo.style.display = "none";
      return;
    }

    const yaEsAmigo = _amigosDeEstePerfil.some(a => a.username === activo.nombre);
    const solicitudEnviada = _misSolicitudes.solicitudesSalientes.some(s => s.para === usuario.nombre);
    const solicitudRecibida = _misSolicitudes.solicitudesEntrantes.some(s => s.de === usuario.nombre);

    // Resetear estilos
    btnAmigo.disabled = false;
    btnAmigo.style.cssText = "";

    if (yaEsAmigo) {
      btnAmigo.textContent = "✅ Amigos";
      btnAmigo.disabled = true;
      btnAmigo.style.background = "#4ade8033";
      btnAmigo.style.borderColor = "#4ade80";
      btnAmigo.style.color = "#4ade80";
      btnAmigo.style.cursor = "default";
    } else if (solicitudEnviada) {
      btnAmigo.textContent = "⏳ Solicitud enviada";
      btnAmigo.disabled = true;
      btnAmigo.style.opacity = "0.7";
      btnAmigo.style.cursor = "default";
    } else if (solicitudRecibida) {
      btnAmigo.textContent = "📩 Aceptar solicitud";
      btnAmigo.style.background = "#4ade8033";
      btnAmigo.style.borderColor = "#4ade80";
      btnAmigo.style.color = "#4ade80";
    } else {
      btnAmigo.textContent = "🤝 Agregar amigo";
    }
  }

  await cargarMisSolicitudes();
  actualizarBotonAmigo();

  if (btnAmigo) {
    btnAmigo.addEventListener("click", async () => {
      if (!activo || btnAmigo.disabled) return;

      if(typeof bloqueadoPorSuspension === "function" && await bloqueadoPorSuspension()) return;

      btnAmigo.disabled = true;

      // Si hay solicitud recibida pendiente → aceptar
      const recibida = _misSolicitudes.solicitudesEntrantes.find(s => s.de === usuario.nombre);

      if (recibida) {

        try{
          const respuesta = await fetch("/api/social?action=friends", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "accept", requestId: recibida.id })
          });
          const datos = await respuesta.json();
          if(!datos || !datos.success){ actualizarBotonAmigo(); return; }
        }catch(error){
          console.warn("MacroReborn: no se pudo aceptar la solicitud.", error);
          actualizarBotonAmigo();
          return;
        }

        // LOGROS DE AMIGOS
        if(typeof desbloquearLogro === "function"){
          desbloquearLogro(activo.nombre, "primerAmigo");
          desbloquearLogro(usuario.nombre, "primerAmigo");
        }

        // ACTIVIDAD RECIENTE - AMIGO
        if(typeof registrarActividad === "function"){
          registrarActividad(activo.nombre, "amigo", usuario.nombre);
          registrarActividad(usuario.nombre, "amigo", activo.nombre);
        }

        await cargarAmigosDeEstePerfil();
        await cargarMisSolicitudes();
        actualizarBotonAmigo();
        renderAmigosUsuario();
        return;
      }

      // Evitar duplicados
      const yaExiste = _misSolicitudes.solicitudesSalientes.some(s => s.para === usuario.nombre);
      if (yaExiste){ actualizarBotonAmigo(); return; }

      // Enviar solicitud
      try{
        const respuesta = await fetch("/api/social?action=friends", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "request", from: activo.nombre, to: usuario.nombre })
        });
        const datos = await respuesta.json();
        if(!datos || !datos.success){ actualizarBotonAmigo(); return; }
      }catch(error){
        console.warn("MacroReborn: no se pudo enviar la solicitud.", error);
        actualizarBotonAmigo();
        return;
      }

      await cargarMisSolicitudes();
      actualizarBotonAmigo();
    });
  }


  // ---------- BOTÓN BLOQUEAR USUARIO ----------

  const btnBloquear = document.getElementById("bloquearUsuario");
  let _yaBloqueado = false;
  let _bloqueadoPorElPerfil = false;

  function limpiarEstadoVisualBloqueo(){
    _yaBloqueado = false;
    _bloqueadoPorElPerfil = false;
    perfilLimitadoPorBloqueo = false;
    aplicarRestriccionTabsPorBloqueo();
  }

  async function cargarEstadoBloqueo(){
    // Cada perfil se evalúa desde cero. Así una navegación o un estado
    // anterior nunca puede dejar un aviso/limitación pegado en otro perfil.
    limpiarEstadoVisualBloqueo();

    if(!activo || !activo.nombre || !usuario || !usuario.nombre ||
       activo.nombre.toLowerCase() === usuario.nombre.toLowerCase()){
      return;
    }

    try{
      const respuesta = await fetch(
        "/api/social?action=blocks&username=" + encodeURIComponent(usuario.nombre) +
        "&viewer=" + encodeURIComponent(activo.nombre)
      );
      const datos = await respuesta.json();

      if(datos && datos.success === true){
        _yaBloqueado = datos.bloqueadoPorMi === true;
        _bloqueadoPorElPerfil = datos.bloqueadoPorElPerfil === true;
        perfilLimitadoPorBloqueo = _bloqueadoPorElPerfil === true;
      } else {
        _yaBloqueado = false;
        _bloqueadoPorElPerfil = false;
        perfilLimitadoPorBloqueo = false;
      }

      // Aplicar el resultado explícitamente, incluso cuando el resultado
      // es "no bloqueado".
      aplicarRestriccionTabsPorBloqueo();
    }catch(error){
      // Ante un fallo de red/API, NO asumimos que existe un bloqueo.
      _yaBloqueado = false;
      limpiarEstadoVisualBloqueo();
      console.warn("MacroReborn: no se pudo cargar el estado de bloqueo.", error);
    }
  }

  function actualizarBotonBloquear(){
    if(!btnBloquear) return;

    if(!activo || activo.nombre === usuario.nombre || _bloqueadoPorElPerfil){
      btnBloquear.style.display = "none";
      return;
    }

    btnBloquear.disabled = false;
    if(_yaBloqueado){
      btnBloquear.textContent = "✅ Usuario bloqueado (click para desbloquear)";
      btnBloquear.classList.add("ya-bloqueado");
    }else{
      btnBloquear.textContent = "🚫 Bloquear a este usuario";
      btnBloquear.classList.remove("ya-bloqueado");
    }
  }

  await cargarEstadoBloqueo();
  aplicarRestriccionTabsPorBloqueo();
  actualizarBotonBloquear();

  if(btnBloquear){
    btnBloquear.addEventListener("click", async () => {
      if(!activo || btnBloquear.disabled) return;

      const confirmacion = _yaBloqueado
        ? confirm("¿Desbloquear a " + usuario.nombre + "?")
        : confirm("¿Bloquear a " + usuario.nombre + "? Ya no podrán ser amigos ni tener solicitudes pendientes entre ustedes.");
      if(!confirmacion) return;

      btnBloquear.disabled = true;

      try{
        const respuesta = await fetch("/api/social?action=blocks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: _yaBloqueado ? "unblock" : "block",
            username: activo.nombre,
            targetUsername: usuario.nombre
          })
        });
        const datos = await respuesta.json();
        if(datos && datos.success){
          _yaBloqueado = !!datos.bloqueado;

          if(!_yaBloqueado){
            _bloqueadoPorElPerfil = false;
            perfilLimitadoPorBloqueo = false;
            aplicarRestriccionTabsPorBloqueo();
          }

          actualizarBotonBloquear();
        }
      }catch(error){
        console.warn("MacroReborn: no se pudo actualizar el bloqueo.", error);
      }

      actualizarBotonBloquear();

      // Bloquear rompe la amistad/solicitudes en el servidor: se
      // refresca el botón de amigo para reflejarlo.
      await cargarAmigosDeEstePerfil();
      await cargarMisSolicitudes();
      actualizarBotonAmigo();
    });
  }


  // ---------- COMENTARIOS ----------

// Escapa texto no confiable antes de insertarlo en HTML.
function escaparHTML(texto) {
  const div = document.createElement("div");
  div.textContent = texto == null ? "" : String(texto);
  return div.innerHTML;
}


  function obtenerAvatarComentario(nombre) {
    // El avatar viaja embebido en el usuario (users.avatar, Neon); se
    // lee de la caché en memoria de js/core.js, precargada antes de
    // pintar la lista de comentarios (ver renderComentarios más abajo).
    const av = typeof obtenerAvatarCacheado === "function" ? obtenerAvatarCacheado(nombre) : null;
    if (!av) {
      return `<img src="imagenes/avatar.png" style="width:40px;height:40px;border-radius:50%;object-fit:cover;border:2px solid #f0b429;" alt="" loading="lazy">`;
    }
    if(avatarEsPNG(av)){
      return `<img src="${avatarPNGData(av)}" style="width:40px;height:40px;border-radius:50%;object-fit:contain;border:2px solid #f0b429;" class="avatar-png-personalizado" alt="" loading="lazy">`;
    }
    let capas = "";
    let rutasCapas = [];
    ORDEN_CAPAS.forEach(tipo => {
      const ruta = rutaImagenCapa(av[tipo]);
      if (ruta) {
        capas += `<img class="capa-comentario" src="${ruta}" alt="" loading="lazy">`;
        rutasCapas.push(ruta);
      }
    });
    return `<div class="avatar-mini avatar-compuesto" data-capas="${rutasCapas.join("|")}" ` +
      `data-capa-class="capa-comentario">${capas}</div>`;
  }

  // Comentarios viven en Neon (tabla profile_comments,
  // /api/content?action=comments). Se guarda una copia en memoria para
  // que el handler de "Reportar" pueda encontrar el texto del
  // comentario sin volver a pedirlo al servidor.
  let _comentariosCacheUsuario = [];

  async function obtenerListaComentarios() {
    try{
      const viewerQuery = activo && activo.nombre ? "&viewer=" + encodeURIComponent(activo.nombre) : "";
      const resp = await fetch("/api/content?action=comments&username=" + encodeURIComponent(usuario.nombre) + viewerQuery);
      const datos = await resp.json();
      _comentariosCacheUsuario = (datos && datos.success) ? datos.comentarios : [];
    }catch(error){
      console.warn("MacroReborn: no se pudieron cargar los comentarios.", error);
      _comentariosCacheUsuario = [];
    }
    return _comentariosCacheUsuario;
  }

  async function renderComentarios() {
    const lista = await obtenerListaComentarios();
    const contenedor = document.getElementById("listaComentarios");
    if (!contenedor) return;

    if (lista.length === 0) {
      contenedor.innerHTML = `<p style="color:#94a3b8;font-size:14px;">Este jugador todavía no tiene comentarios.</p>`;
      return;
    }

    if (typeof cargarAvataresDeVarios === "function") {
      await cargarAvataresDeVarios(lista.map(c => c.usuario));
    }

    // Quién puede borrar cada comentario: el que lo escribió, o el
    // dueño de este perfil (por si "activo" está viendo su propio
    // perfil a través de esta misma página).
    const esDueñoDelPerfil = activo && activo.nombre === usuario.nombre;

    contenedor.innerHTML = lista.map((c) => {
      const esMio = activo && c.usuario === activo.nombre;
      const puedeEliminar = esMio || esDueñoDelPerfil;
      return `
      <div class="comentario">
        <div class="usuario-comentario" style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
          ${obtenerAvatarComentario(c.usuario)}
          <b style="color:#f0b429;">${escaparHTML(c.usuario)}</b>
        </div>
        ${typeof insigniasBloqueHTML === "function" ? insigniasBloqueHTML(c.usuario, true) : ""}
        <p style="color:#cbd5e1;margin:0 0 10px;">${escaparHTML(c.texto)}</p>
        ${typeof botonLikeHTML === "function" ? botonLikeHTML("comment", c.id, activo ? activo.nombre : null) : ""}
        <button class="boton-responder" data-usuario="${escaparHTML(c.usuario)}">Responder</button>
        ${puedeEliminar ? `<button class="boton-eliminar" data-id="${c.id}">🗑️ Eliminar</button>` : ""}
        <button class="boton-reportar" data-id="${c.id}">🚩 Reportar</button>
      </div>
    `;
    }).join("");

    // ELIMINAR (solo mis propios comentarios, sin importar en qué
    // perfil los haya dejado)
    contenedor.querySelectorAll(".boton-eliminar").forEach(btn=>{
      btn.onclick = () => {
        const id = btn.dataset.id;

        const confirmar = typeof pedirConfirmacion === "function"
          ? (mensaje, onConfirmar) => pedirConfirmacion(mensaje, onConfirmar, "🗑️ Eliminar")
          : (mensaje, onConfirmar) => { if(confirm(mensaje)) onConfirmar(); };

        confirmar("¿Seguro que querés eliminar este comentario?", async () => {
          try{
            await fetch("/api/content?action=comments", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ commentId: id, username: activo ? activo.nombre : "" })
            });
          }catch(error){
            console.warn("MacroReborn: no se pudo eliminar el comentario.", error);
          }
          renderComentarios();
        });
      };
    });

    // RESPONDER
    contenedor.querySelectorAll(".boton-responder").forEach(btn=>{
      btn.onclick = () => {
        const input = document.getElementById("comentarioTexto");
        if(input){
          input.value = "@" + btn.dataset.usuario + " ";
          input.scrollIntoView({ behavior: "smooth", block: "center" });
          setTimeout(()=> input.focus(), 300);
        }
      };
    });

    // REPORTAR
    contenedor.querySelectorAll(".boton-reportar").forEach(btn=>{
      btn.onclick = () => {
        const id = btn.dataset.id;

        const confirmar = typeof pedirConfirmacion === "function"
          ? (mensaje, onConfirmar) => pedirConfirmacion(mensaje, onConfirmar, "🚩 Reportar")
          : (mensaje, onConfirmar) => { if(confirm(mensaje)) onConfirmar(); };

        confirmar("¿Seguro que querés reportar este comentario?", () => {
          if(typeof reportarComentario === "function"){
            const comentario = _comentariosCacheUsuario.find(c => String(c.id) === id);
            const motivo = prompt("¿Por qué reportás este comentario? (opcional)") || "";
            reportarComentario("comment", id, usuario.nombre, comentario, motivo);
          }
          alert("Gracias. El comentario fue reportado correctamente.");
        });
      };
    });
  }

  renderComentarios();

  // Enviar comentario
  const botonComentar = document.getElementById("botonComentar");
  const inputComentario = document.getElementById("comentarioTexto");

  if (botonComentar && inputComentario) {
    const enviarComentario = async () => {

      if(typeof bloqueadoPorSuspension === "function" && await bloqueadoPorSuspension()) return;

      const texto = inputComentario.value.trim();
      if (!texto) return;

      const quien = activo ? activo.nombre : "Invitado";

      try{
        await fetch("/api/content?action=comments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profileUsername: usuario.nombre,
            texto: texto,
            authorUsername: quien
          })
        });
      }catch(error){
        console.warn("MacroReborn: no se pudo publicar el comentario.", error);
        return;
      }

      inputComentario.value = "";

      await renderComentarios();

      // ==============================
      // LOGRO PRIMER COMENTARIO
      // ==============================
      if (activo && typeof desbloquearLogro === "function") {
        desbloquearLogro(activo.nombre, "primeraPalabra");
      }

      // ACTIVIDAD RECIENTE - COMENTARIO
      if (activo && typeof registrarActividad === "function") {
        const detalleComentario = typeof empaquetarComentario === "function"
          ? empaquetarComentario(usuario.nombre, texto)
          : texto;
        registrarActividad(activo.nombre, "comentario", detalleComentario);
      }
    };

    botonComentar.addEventListener("click", enviarComentario);
    inputComentario.addEventListener("keydown", e => {
      if (e.key === "Enter") enviarComentario();
    });
  }


  // ---------- LOGROS ----------

  function renderLogrosUsuario() {
    const contenedor = document.getElementById("listaLogrosUsuario");
    if (!contenedor) return;
    if (typeof LOGROS === "undefined" || typeof obtenerLogros !== "function") return;

    const lista = obtenerLogros(usuario.nombre);

    if (lista.length === 0) {
      contenedor.innerHTML = `<p style="color:#94a3b8;font-size:14px;">Este jugador todavía no desbloqueó logros.</p>`;
      return;
    }

    contenedor.innerHTML = lista.map(conseguido => {
      const logro = LOGROS[conseguido.id];
      if (!logro) return "";
      return `
        <div class="tarjeta-logro desbloqueado">
          <div class="icono-logro">${logro.icono}</div>
          <div>
            <h3>${logro.nombre}</h3>
            <p>${logro.descripcion}</p>
            <span class="estado-logro">✅ ${logro.puntos} puntos<br>${conseguido.fecha || ""}</span>
          </div>
        </div>
      `;
    }).join("");
  }

  renderLogrosUsuario();


  // ---------- TIEMPO REAL (Pusher) ----------
  // Mismo canal público por usuario que ya usa js/realtime.js para
  // las notificaciones ("notificaciones-<nombre>", acá el nombre del
  // PERFIL VISITADO, no el de quien está mirando). Escucha los
  // eventos que dispara el servidor cada vez que alguien comenta,
  // registra actividad, juega un juego o desbloquea un logro en este
  // perfil, y vuelve a pintar solo esa sección, sin recargar.

  if (typeof Pusher !== "undefined") {

    // Mismos valores que js/realtime.js (públicos a propósito).
    const PUSHER_KEY = "767a9d93fede4f8f7b52";
    const PUSHER_CLUSTER = "sa1";

    if (PUSHER_KEY !== "TU_PUSHER_KEY") {

      // Canal propio: recibe los cambios de bloqueo/desbloqueo que afectan
      // a la cuenta que está navegando, para actualizar el perfil sin recargar.
      if (activo && activo.nombre) {
        const pusherEstadoBloqueo = new Pusher(PUSHER_KEY, { cluster: PUSHER_CLUSTER });
        const canalEstadoBloqueo = pusherEstadoBloqueo.subscribe(
          "notificaciones-" + activo.nombre.toLowerCase()
        );

        canalEstadoBloqueo.bind("estado-bloqueo", async (datos) => {
          if (!datos || !datos.por) return;
          if (String(datos.por).toLowerCase() !== String(usuario.nombre).toLowerCase()) return;

          _bloqueadoPorElPerfil = !!datos.bloqueado;
          perfilLimitadoPorBloqueo = _bloqueadoPorElPerfil;

          aplicarRestriccionTabsPorBloqueo();

          await cargarEstadoBloqueo();
          actualizarBotonBloquear();
        });
      }

      const pusherPerfilVisitado = new Pusher(PUSHER_KEY, { cluster: PUSHER_CLUSTER });
      const canalPerfilVisitado = pusherPerfilVisitado.subscribe("notificaciones-" + usuario.nombre.toLowerCase());

      canalPerfilVisitado.bind("nuevo-comentario", () => renderComentarios());
      canalPerfilVisitado.bind("comentarios-vaciados", () => renderComentarios());
      canalPerfilVisitado.bind("nueva-actividad", () => {
        if (typeof renderActividadUsuario === "function") renderActividadUsuario();
      });
      canalPerfilVisitado.bind("nuevo-historial", () => {
        if (typeof renderHistorialUsuario === "function") renderHistorialUsuario();
      });
      canalPerfilVisitado.bind("nuevo-logro", () => renderLogrosUsuario());

      // "Última conexión" / estado 🟢-⚪ en vivo: el servidor avisa
      // por acá cada vez que este usuario tiene actividad (latido
      // cada pocos minutos mientras navega, ver js/core.js).
      canalPerfilVisitado.bind("latido", (datos) => {
        if (datos && datos.last_login) usuario.last_login = datos.last_login;
        pintarEstadoYUltimaConexion();
      });

    }

  }

  // Aunque no llegue ningún latido nuevo, el texto "hace X minutos" y
  // el pasaje de 🟢 a ⚪ (a los MINUTOS_CONECTADO de inactividad)
  // tienen que actualizarse solos con el correr del tiempo.
  setInterval(pintarEstadoYUltimaConexion, 30 * 1000);

}

})();

}
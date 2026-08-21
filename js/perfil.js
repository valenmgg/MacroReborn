// ==============================
// PERFIL - MacroReborn
// ==============================


// ---------- PESTAÑAS ----------

const botones = document.querySelectorAll(".tab");
const contenidos = document.querySelectorAll(".contenido-tab");

botones.forEach(boton=>{
  boton.addEventListener("click",()=>{
    botones.forEach(b=>b.classList.remove("activa"));
    contenidos.forEach(c=>c.classList.remove("activo"));
    boton.classList.add("activa");
    document.getElementById(boton.dataset.tab).classList.add("activo");
  });
});

// Permite llegar directo a una pestaña puntual desde afuera de esta
// página (por ejemplo, desde el menú de usuario de la navbar:
// "perfil.html#amigos"), simulando el click sobre el botón de esa
// pestaña. Si el hash no coincide con ninguna pestaña, no hace nada
// y queda la pestaña "Home" que ya viene activa por defecto.
function activarPestañaDesdeHash(){
  const idPestaña = location.hash.replace("#", "");
  if(!idPestaña) return;
  const boton = document.querySelector('.tab[data-tab="' + idPestaña + '"]');
  if(boton) boton.click();
}

activarPestañaDesdeHash();
window.addEventListener("hashchange", activarPestañaDesdeHash);


// ---------- PERFIL ----------

// USUARIO LOGUEADO

let datosUsuario = (window.MRSession && typeof MRSession.get === "function")
  ? MRSession.get()
  : leerJSON(localStorage.getItem("usuarioActivo") || "null");


if(!datosUsuario){

  window.location.href = "login.html";
  throw new Error("Sin sesión");

}


// Adaptar datos de Neon al formato antiguo del perfil

datosUsuario.nombre = datosUsuario.username;
datosUsuario.nivel = datosUsuario.level;
datosUsuario.fechaRegistro = datosUsuario.created_at;
datosUsuario.logros = datosUsuario.logros || 0;
datosUsuario.biografia = datosUsuario.bio || "Todavía no escribió una biografía.";

// FIX: acá se pisaba datosUsuario.ultimaConexion con un campo que
// nunca existía ("ultimaConexion"), así que siempre terminaba en
// "Nunca". El dato real de Neon viaja como "last_login" (llega en
// datosUsuario porque /api/auth?action=login y /api/auth?action=register
// lo incluyen en la respuesta y js/login.js lo guarda tal cual en
// usuarioActivo). Se guarda aparte para no perderlo.
datosUsuario.ultimaConexion = datosUsuario.last_login || null;

// GUARDIA DE SESIÓN
// Sin esto, cualquiera podía entrar a perfil.html sin haber iniciado
// sesión: perfil.js rellenaba un usuario "falso" (nombre:"Usuario")
// solo para poder pintar la página, pero como el resto del archivo
// sigue usando esa misma variable "datosUsuario" para guardar (bio,
// avatar, comentarios...), terminaba escribiendo esos datos falsos
// en "usuarioActivo" de localStorage la primera vez que se guardaba
// algo — lo que además dejaba al navbar creyendo que había una sesión
// iniciada. Si no hay sesión real, mandamos directo a login.html y
// no seguimos ejecutando el resto del script.


// PERFIL

// RANKING: preferimos la posición ya calculada por el servidor (rank_actual)
// que viaja con el usuario de la sesión. Solo hacemos la consulta completa
// del ranking como fallback cuando ese dato no está disponible. Esto evita
// descargar /api/users?limit=500 en la carga normal del perfil.
const rankActualSesion = Number(datosUsuario.rank_actual);
const posicionRankingPromesa = Number.isFinite(rankActualSesion) && rankActualSesion > 0
  ? Promise.resolve(rankActualSesion)
  : (typeof obtenerPosicionRanking === "function"
      ? obtenerPosicionRanking(datosUsuario.nombre)
      : Promise.resolve(null));

const usuario={

  nombre: datosUsuario.nombre,

  estado:"🟢 En línea",

  nivel: Number(datosUsuario.nivel) || 1,

  biografia: datosUsuario.biografia || "Todavía no escribió una biografía.",

  xp: Number(datosUsuario.xp) || 0,

  ranking: "Calculando…",

  logros: datosUsuario.logros || 0,

  fechaRegistro: datosUsuario.fechaRegistro || "Desconocida",

  ultimaConexion: datosUsuario.ultimaConexion || "Nunca",

};

// Contexto explícito del PERFIL PROPIO.
// Este objeto deja clara la frontera entre perfil.html (yo) y
// usuario.html (perfil público ajeno): ningún módulo del perfil debe
// sustituir al usuario objetivo por otro valor obtenido de la URL.
window.MRProfileContext = {
  type: "own",
  getUser(){
    return { ...datosUsuario, nombre: usuario.nombre, nivel: usuario.nivel, xp: usuario.xp, biografia: usuario.biografia, ultimaConexion: usuario.ultimaConexion };
  }
};

document.getElementById("nombreUsuario").textContent=usuario.nombre;

// Carga las insignias del usuario propio antes de mostrar las opciones
// exclusivas del administrador. La comprobación real también existe en
// /api/users?action=update-admin-avatar-png, así que ocultar este bloque
// en el cliente nunca se usa como mecanismo de seguridad.
const insigniasPerfilPropioListas = typeof cargarInsignias === "function"
  ? cargarInsignias(usuario.nombre)
  : Promise.resolve([]);

// ---------- INSIGNIAS OFICIALES ----------
// Se muestran debajo del nombre. Son manuales (no se otorgan por
// logros): si el usuario no tiene ninguna, el contenedor queda oculto.
if(typeof renderInsigniasEnContenedor === "function"){
  renderInsigniasEnContenedor("insigniasPerfil", usuario.nombre);
}

const bienvenidaPerfil = document.getElementById("bienvenidaPerfil");
if(bienvenidaPerfil){
  bienvenidaPerfil.textContent = "Bienvenido al perfil de " + usuario.nombre + ".";
}

document.querySelector(".estado").textContent=usuario.nombre+" · "+usuario.estado;
document.querySelector(".nivel").textContent="⭐ Nivel "+usuario.nivel;
document.getElementById("biografia").textContent=usuario.biografia;
document.getElementById("xp").textContent="⚡ "+usuario.xp+" XP";

// ---------- BARRA DE XP ----------

const barraXP = document.getElementById("progresoXP");
const textoXP = document.getElementById("textoXP");

if(barraXP && textoXP){

  let necesario;

  if(usuario.nivel === 1){
    necesario = 50;
  }
  else if(usuario.nivel === 2){
    necesario = 100;
  }
  else{
    necesario = 100 + ((usuario.nivel - 2) * 200);
  }

  let porcentaje = (usuario.xp / necesario) * 100;

  barraXP.style.width = porcentaje + "%";
  textoXP.textContent = usuario.xp + " / " + necesario + " XP";

}

document.getElementById("ranking").textContent=usuario.ranking;

posicionRankingPromesa.then(posicionRanking=>{
  document.getElementById("ranking").textContent = posicionRanking ? "#" + posicionRanking : "Sin clasificar";
});

// ---------- PUNTOS DE LOGROS ----------

function actualizarPuntosLogrosUI(){
  const puntosLogrosEl = document.getElementById("puntosLogros");
  if(puntosLogrosEl){
    puntosLogrosEl.textContent = "🏅 " + calcularPuntosLogros(datosUsuario.nombre) + " puntos de logros";
  }
}

// Los logros ahora salen de /api/achievements: se precargan una sola
// vez acá y de ahí en más calcularPuntosLogros()/obtenerLogros() los
// leen sincrónicamente desde la caché en memoria (js/motor/logros.js).
const logrosListos = typeof cargarLogros === "function"
  ? cargarLogros(datosUsuario.nombre)
  : Promise.resolve();

logrosListos.then(actualizarPuntosLogrosUI);

// FIX: "Registrado" mostraba el timestamp ISO crudo de Neon
// (ej. "2026-08-05T02:48:25.503Z") en vez de una fecha legible.
document.getElementById("fechaRegistro").textContent =
  typeof fechaLegible === "function"
    ? fechaLegible(usuario.fechaRegistro, "Desconocida")
    : usuario.fechaRegistro;

// FIX: usaba un campo ("ultimaConexionTS") que nunca se llenaba en
// ningún lado del sitio, así que siempre caía al valor por defecto
// "Nunca" sin importar si la persona acababa de iniciar sesión. Ahora
// usa el last_login real (ver más arriba, donde se guarda en
// datosUsuario.ultimaConexion).
//
// Queda en una función aparte (en vez de código suelto) para poder
// volver a pintarla sola cuando llega un latido en vivo por Pusher
// (por ejemplo, si iniciaste sesión en otro dispositivo), o cada
// cierto tiempo, sin recargar la página.
function pintarUltimaConexion(){
  document.getElementById("ultimaConexion").textContent =
    typeof tiempoRelativo === "function"
      ? tiempoRelativo(datosUsuario.ultimaConexion, "Nunca")
      : usuario.ultimaConexion;
}

pintarUltimaConexion();

// ==============================
// SINCRONIZACIÓN CON MRSESSION / MRAPP
// ==============================
// El perfil propio ahora reacciona a cambios confirmados por el servidor
// (XP, monedas, nivel, bio, avatar, actividad) sin obligar a recargar la página.
// El fallback a localStorage se conserva para compatibilidad con páginas antiguas.
function actualizarPerfilDesdeSesion(detalle){
  const actualizado = detalle && detalle.usuario ? detalle.usuario
    : (window.MRSession && typeof MRSession.get === "function" ? MRSession.get() : null);
  if(!actualizado || !actualizado.username && !actualizado.nombre) return;

  const nombre = actualizado.nombre || actualizado.username;
  const nivel = Number(actualizado.level ?? actualizado.nivel ?? datosUsuario.nivel) || 1;
  const xp = Number(actualizado.xp ?? datosUsuario.xp) || 0;
  const bio = actualizado.bio ?? actualizado.biografia ?? datosUsuario.biografia;
  const ultima = actualizado.last_login ?? actualizado.ultimaConexion ?? datosUsuario.ultimaConexion;

  datosUsuario = { ...datosUsuario, ...actualizado, username: nombre, level: nivel, xp };
  datosUsuario.nombre = nombre;
  datosUsuario.nivel = nivel;
  datosUsuario.biografia = bio || "Todavía no escribió una biografía.";
  datosUsuario.last_login = ultima || datosUsuario.last_login;
  datosUsuario.ultimaConexion = ultima || null;

  usuario.nombre = nombre;
  usuario.nivel = nivel;
  usuario.xp = xp;
  usuario.biografia = datosUsuario.biografia;
  usuario.ultimaConexion = datosUsuario.ultimaConexion || "Nunca";

  const nombreEl = document.getElementById("nombreUsuario");
  if(nombreEl) nombreEl.textContent = nombre;
  const estadoEl = document.querySelector(".estado");
  if(estadoEl) estadoEl.textContent = nombre + " · " + usuario.estado;
  const nivelEl = document.querySelector(".nivel");
  if(nivelEl) nivelEl.textContent = "⭐ Nivel " + nivel;
  const bioEl = document.getElementById("biografia");
  if(bioEl) bioEl.textContent = usuario.biografia;
  const xpEl = document.getElementById("xp");
  if(xpEl) xpEl.textContent = "⚡ " + xp + " XP";

  if(barraXP && textoXP){
    const necesario = nivel === 1 ? 50 : (nivel === 2 ? 100 : 100 + ((nivel - 2) * 200));
    const porcentaje = Math.max(0, Math.min(100, (xp / necesario) * 100));
    barraXP.style.width = porcentaje + "%";
    textoXP.textContent = xp + " / " + necesario + " XP";
  }

  pintarUltimaConexion();
  if(typeof actualizarPuntosLogrosUI === "function") actualizarPuntosLogrosUI();
  if(typeof renderLogros === "function") renderLogros();
  if(typeof actualizarAvatarPrincipal === "function" && actualizado.avatar !== undefined){
    actualizarAvatarPrincipal();
  }
}

function suscribirPerfilSesion(){
  if(window.MRSession && typeof MRSession.subscribe === "function") {
    MRSession.subscribe(actualizarPerfilDesdeSesion);
  }
  if(window.MRApp && MRApp.events && typeof MRApp.events.on === "function") {
    MRApp.events.on("macro:session-change", actualizarPerfilDesdeSesion);
  }
}

suscribirPerfilSesion();


// ==============================
// SISTEMA AVATAR
// ==============================

const CAPAS_IMG={
  // Selector de modelo
  tora:"imagenes/tora.png",
  cereza:"imagenes/cereza.png",
  fiora:"imagenes/fiora.png",
  max:"imagenes/max.png",
  fenglei:"imagenes/fenglei.png",
  fengchao: "imagenes/fengchao.png",

  // ---- Guardarropa de TORA ----
  tora_fondo1:"imagenes/tora/fondo1.png",
  tora_fondo2:"imagenes/tora/fondo2.png",
  tora_fondo3:"imagenes/tora/fondo3.png",
  tora_fondo4:"imagenes/tora/fondo4.png",
  tora_fondo5:"imagenes/tora/fondo5.png",
  tora_fondo6:"imagenes/tora/fondo6.png",
  tora_fondo7:"imagenes/tora/fondo7.png",
  tora_fondo8:"imagenes/tora/fondo8.png",
  tora_fondo9:"imagenes/tora/fondo9.png",
  tora_fondo10:"imagenes/tora/fondo10.png",
  tora_fondo11:"imagenes/tora/fondo11.png",
  tora_fondo12:"imagenes/tora/fondo12.png",
  tora_fondo13:"imagenes/tora/fondo13.png",
  tora_fondo14:"imagenes/tora/fondo14.png",
  tora_fondo15:"imagenes/tora/fondo15.png",
  tora_fondo16:"imagenes/tora/fondo16.png",
  tora_fondo17:"imagenes/tora/fondo17.png",
  tora_fondo18:"imagenes/tora/fondo18.png",
  tora_fondo19:"imagenes/tora/fondo19.png",
  tora_fondo20:"imagenes/tora/fondo20.png",
  tora_fondo21:"imagenes/tora/fondo21.png",
  tora_fondo22:"imagenes/tora/fondo22.png",
  tora_fondo23:"imagenes/tora/fondo23.png",
  tora_piel1:"imagenes/tora/piel1.png",
  tora_piel2:"imagenes/tora/piel2.png",
  tora_piel3:"imagenes/tora/piel3.png",
  tora_ojos1:"imagenes/tora/ojos1.png",
  tora_ojos2:"imagenes/tora/ojos2.png",
  tora_ojos3:"imagenes/tora/ojos3.png",
  tora_ojos4:"imagenes/tora/ojos4.png",
  tora_ojos5:"imagenes/tora/ojos5.png",
  tora_ojos6:"imagenes/tora/ojos6.png",
  tora_boca1:"imagenes/tora/boca1.png",
  tora_boca2:"imagenes/tora/boca2.png",
  tora_boca3:"imagenes/tora/boca3.png",
  tora_boca4:"imagenes/tora/boca4.png",
  tora_boca5:"imagenes/tora/boca5.png",
  tora_boca6:"imagenes/tora/boca6.png",
  tora_boca7:"imagenes/tora/boca7.png",
  tora_pantalon1:"imagenes/tora/pantalon1.png",
  tora_pantalon2:"imagenes/tora/pantalon2.png",
  tora_pantalon3:"imagenes/tora/pantalon3.png",
  tora_pantalon4:"imagenes/tora/pantalon4.png",
  tora_botas1:"imagenes/tora/botas1.png",
  tora_botas2:"imagenes/tora/botas2.png",
  tora_botas3:"imagenes/tora/botas3.png",
  tora_botas4:"imagenes/tora/botas4.png",
  tora_botas5:"imagenes/tora/botas5.png",
  tora_botas6:"imagenes/tora/botas6.png",
  tora_pelo1:"imagenes/tora/pelo1.png",
  tora_pelo2:"imagenes/tora/pelo2.png",
  tora_pelo3:"imagenes/tora/pelo3.png",
  tora_pelo4:"imagenes/tora/pelo4.png",
  tora_remera1:"imagenes/tora/remera1.png",
  tora_remera2:"imagenes/tora/remera2.png",
  tora_remera3:"imagenes/tora/remera3.png",
  tora_remera4:"imagenes/tora/remera4.png",
  tora_guantes1:"imagenes/tora/guantes1.png",
  tora_guantes2:"imagenes/tora/guantes2.png",
  tora_guantes3:"imagenes/tora/guantes3.png",
  tora_guantes4:"imagenes/tora/guantes4.png",
  tora_espalda1:"imagenes/tora/espalda1.png",
  tora_espalda2:"imagenes/tora/espalda2.png",
  tora_accesorio1:"imagenes/tora/accesorio1.png",
  tora_accesorio2:"imagenes/tora/accesorio2.png",
  tora_accesorio3:"imagenes/tora/accesorio3.png",
  tora_accesorio4:"imagenes/tora/accesorio4.png",
  tora_accesorio5:"imagenes/tora/accesorio5.png",
  tora_accesorio6:"imagenes/tora/accesorio6.png",
  tora_accesorio7:"imagenes/tora/accesorio7.png",
  tora_accesorio8:"imagenes/tora/accesorio8.png",
  tora_accesorio9:"imagenes/tora/accesorio9.png",
  tora_accesorio10:"imagenes/tora/accesorio10.png",
  tora_cara1:"imagenes/tora/cara1.png",
  tora_cara2:"imagenes/tora/cara2.png",
  tora_cara3:"imagenes/tora/cara3.png",
  tora_cara4:"imagenes/tora/cara4.png",
  tora_cara5:"imagenes/tora/cara5.png",
  tora_cara6:"imagenes/tora/cara6.png",
  tora_cara7:"imagenes/tora/cara7.png",
  tora_cara8:"imagenes/tora/cara8.png",
  tora_mascota1:"imagenes/tora/mascota1.png",
  tora_mascota2:"imagenes/tora/mascota2.png",
  tora_mascota3:"imagenes/tora/mascota3.png",
  tora_mascota4:"imagenes/tora/mascota4.png",
  tora_mascota5:"imagenes/tora/mascota5.png",
  tora_mascota6:"imagenes/tora/mascota6.png",
  tora_mascota7:"imagenes/tora/mascota7.png",
  tora_mascota8:"imagenes/tora/mascota8.png",
  tora_mascota9:"imagenes/tora/mascota9.png",
  tora_borde1:"imagenes/tora/borde1.png",
  tora_borde2:"imagenes/tora/borde2.png",
  tora_borde3:"imagenes/tora/borde3.png",
  tora_borde4:"imagenes/tora/borde4.png",
  tora_borde5:"imagenes/tora/borde5.png",
  tora_borde6:"imagenes/tora/borde6.png",
  tora_borde7:"imagenes/tora/borde7.png",
  tora_borde8:"imagenes/tora/borde8.png",
  tora_borde9:"imagenes/tora/borde9.png",
  tora_borde10:"imagenes/tora/borde10.png",
  tora_borde11:"imagenes/tora/borde11.png",
  tora_borde12:"imagenes/tora/borde12.png",
  tora_borde13:"imagenes/tora/borde13.png",
  tora_borde14:"imagenes/tora/borde14.png",
  tora_borde15:"imagenes/tora/borde15.png",
  tora_borde16:"imagenes/tora/borde16.png",

  // ---- Guardarropa de CEREZA ----
  cereza_fondo1:"imagenes/cereza/fondo1.png",
  cereza_fondo2:"imagenes/cereza/fondo2.png",
  cereza_fondo3:"imagenes/cereza/fondo3.png",
  cereza_fondo4:"imagenes/cereza/fondo4.png",
  cereza_fondo5:"imagenes/cereza/fondo5.png",
  cereza_fondo6:"imagenes/cereza/fondo6.png",
  cereza_fondo7:"imagenes/cereza/fondo7.png",
  cereza_fondo8:"imagenes/cereza/fondo8.png",
  cereza_fondo9:"imagenes/cereza/fondo9.png",
  cereza_fondo10:"imagenes/cereza/fondo10.png",
  cereza_fondo11:"imagenes/cereza/fondo11.png",
  cereza_fondo12:"imagenes/cereza/fondo12.png",
  cereza_fondo13:"imagenes/cereza/fondo13.png",
  cereza_fondo14:"imagenes/cereza/fondo14.png",
  cereza_fondo15:"imagenes/cereza/fondo15.png",
  cereza_fondo16:"imagenes/cereza/fondo16.png",
  cereza_fondo17:"imagenes/cereza/fondo17.png",
  cereza_fondo18:"imagenes/cereza/fondo18.png",
  cereza_fondo19:"imagenes/cereza/fondo19.png",
  cereza_fondo20:"imagenes/cereza/fondo20.png",
  cereza_fondo21:"imagenes/cereza/fondo21.png",
  cereza_fondo22:"imagenes/cereza/fondo22.png",
  cereza_fondo23:"imagenes/cereza/fondo23.png",
  cereza_piel1:"imagenes/cereza/piel1.png",
  cereza_piel2:"imagenes/cereza/piel2.png",
  cereza_piel3:"imagenes/cereza/piel3.png",
  cereza_ojos1:"imagenes/cereza/ojos1.png",
  cereza_ojos2:"imagenes/cereza/ojos2.png",
  cereza_ojos3:"imagenes/cereza/ojos3.png",
  cereza_ojos4:"imagenes/cereza/ojos4.png",
  cereza_ojos5:"imagenes/cereza/ojos5.png",
  cereza_ojos6:"imagenes/cereza/ojos6.png",
  cereza_ojos7:"imagenes/cereza/ojos7.png",
  cereza_ojos8:"imagenes/cereza/ojos8.png",
  cereza_ojos9:"imagenes/cereza/ojos9.png",
  cereza_ojos10:"imagenes/cereza/ojos10.png",
  cereza_ojos11:"imagenes/cereza/ojos11.png",
  cereza_ojos12:"imagenes/cereza/ojos12.png",
  cereza_boca1:"imagenes/cereza/boca1.png",
  cereza_boca2:"imagenes/cereza/boca2.png",
  cereza_pantalon1:"imagenes/cereza/pantalon1.png",
  cereza_pantalon2:"imagenes/cereza/pantalon2.png",
  cereza_botas1:"imagenes/cereza/botas1.png",
  cereza_botas2:"imagenes/cereza/botas2.png",
  cereza_pelo1:"imagenes/cereza/pelo1.png",
  cereza_pelo2:"imagenes/cereza/pelo2.png",
  cereza_pelo3:"imagenes/cereza/pelo3.png",
  cereza_pelo4:"imagenes/cereza/pelo4.png",
  cereza_remera1:"imagenes/cereza/remera1.png",
  cereza_remera2:"imagenes/cereza/remera2.png",
  cereza_guantes1:"imagenes/cereza/guantes1.png",
  cereza_guantes2:"imagenes/cereza/guantes2.png",
  cereza_accesorio1:"imagenes/cereza/accesorio1.png",
  cereza_accesorio2:"imagenes/cereza/accesorio2.png",
  cereza_espalda1:"imagenes/cereza/espalda1.png",
  cereza_espalda2:"imagenes/cereza/espalda2.png",
  cereza_cara1:"imagenes/cereza/cara1.png",
  cereza_cara2:"imagenes/cereza/cara2.png",
  cereza_mascota1:"imagenes/cereza/mascota1.png",
  cereza_mascota2:"imagenes/cereza/mascota2.png",
  cereza_mascota5:"imagenes/cereza/mascota5.png",
  cereza_mascota6:"imagenes/cereza/mascota6.png",
  cereza_mascota7:"imagenes/cereza/mascota7.png",
  cereza_mascota8:"imagenes/cereza/mascota8.png",
  cereza_mascota9:"imagenes/cereza/mascota9.png",
  cereza_borde1:"imagenes/cereza/borde1.png",
  cereza_borde2:"imagenes/cereza/borde2.png",
  cereza_borde3:"imagenes/cereza/borde3.png",
  cereza_borde4:"imagenes/cereza/borde4.png",
  cereza_borde5:"imagenes/cereza/borde5.png",
  cereza_borde6:"imagenes/cereza/borde6.png",
  cereza_borde7:"imagenes/cereza/borde7.png",
  cereza_borde8:"imagenes/cereza/borde8.png",
  cereza_borde9:"imagenes/cereza/borde9.png",
  cereza_borde10:"imagenes/cereza/borde10.png",
  cereza_borde11:"imagenes/cereza/borde11.png",
  cereza_borde12:"imagenes/cereza/borde12.png",
  cereza_borde13:"imagenes/cereza/borde13.png",
  cereza_borde14:"imagenes/cereza/borde14.png",
  cereza_borde15:"imagenes/cereza/borde15.png",
  cereza_borde16:"imagenes/cereza/borde16.png",

  // ---- Guardarropa de FENGCHAO ----

  // ---- Prendas nuevas de TORA ----
  tora_fondo24:"imagenes/tora/fondo24.png",
  tora_fondo25:"imagenes/tora/fondo25.png",
  tora_fondo26:"imagenes/tora/fondo26.png",
  tora_fondo27:"imagenes/tora/fondo27.png",
  tora_fondo28:"imagenes/tora/fondo28.png",
  tora_fondo29:"imagenes/tora/fondo29.png",
  tora_fondo30:"imagenes/tora/fondo30.png",
  tora_fondo31:"imagenes/tora/fondo31.png",
  tora_fondo32:"imagenes/tora/fondo32.png",
  tora_fondo33:"imagenes/tora/fondo33.png",
  tora_fondo34:"imagenes/tora/fondo34.png",
  tora_fondo35:"imagenes/tora/fondo35.png",
  tora_fondo36:"imagenes/tora/fondo36.png",
  tora_fondo37:"imagenes/tora/fondo37.png",
  tora_fondo38:"imagenes/tora/fondo38.png",
  tora_fondo39:"imagenes/tora/fondo39.png",
  tora_piel4:"imagenes/tora/piel4.png",
  tora_piel5:"imagenes/tora/piel5.png",
  tora_piel6:"imagenes/tora/piel6.png",
  tora_boca8:"imagenes/tora/boca8.png",
  tora_botas7:"imagenes/tora/botas7.png",
  tora_botas8:"imagenes/tora/botas8.png",
  tora_pantalon5:"imagenes/tora/pantalon5.png",
  tora_pantalon6:"imagenes/tora/pantalon6.png",
  tora_pantalon7:"imagenes/tora/pantalon7.png",
  tora_pantalon8:"imagenes/tora/pantalon8.png",
  tora_pantalon9:"imagenes/tora/pantalon9.png",
  tora_pantalon10:"imagenes/tora/pantalon10.png",
  tora_pantalon11:"imagenes/tora/pantalon11.png",
  tora_pantalon12:"imagenes/tora/pantalon12.png",
  tora_remera5:"imagenes/tora/remera5.png",
  tora_remera6:"imagenes/tora/remera6.png",
  tora_remera7:"imagenes/tora/remera7.png",
  tora_remera8:"imagenes/tora/remera8.png",
  tora_remera9:"imagenes/tora/remera9.png",
  tora_remera10:"imagenes/tora/remera10.png",
  tora_remera11:"imagenes/tora/remera11.png",
  tora_remera12:"imagenes/tora/remera12.png",
  tora_remera13:"imagenes/tora/remera13.png",
  tora_remera14:"imagenes/tora/remera14.png",
  tora_remera15:"imagenes/tora/remera15.png",
  tora_remera16:"imagenes/tora/remera16.png",
  tora_remera17:"imagenes/tora/remera17.png",
  tora_remera18:"imagenes/tora/remera18.png",
  tora_remera19:"imagenes/tora/remera19.png",
  tora_accesorio11:"imagenes/tora/accesorio11.png",
  tora_accesorio12:"imagenes/tora/accesorio12.png",
  tora_accesorio13:"imagenes/tora/accesorio13.png",
  tora_accesorio14:"imagenes/tora/accesorio14.png",
  tora_accesorio15:"imagenes/tora/accesorio15.png",
  tora_accesorio16:"imagenes/tora/accesorio16.png",
  tora_accesorio17:"imagenes/tora/accesorio17.png",
  tora_accesorio18:"imagenes/tora/accesorio18.png",
  tora_accesorio19:"imagenes/tora/accesorio19.png",
  tora_accesorio20:"imagenes/tora/accesorio20.png",
  tora_accesorio21:"imagenes/tora/accesorio21.png",
  tora_accesorio22:"imagenes/tora/accesorio22.png",
  tora_accesorio23:"imagenes/tora/accesorio23.png",
  tora_espalda3:"imagenes/tora/espalda3.png",
  tora_pelo5:"imagenes/tora/pelo5.png",
  tora_pelo6:"imagenes/tora/pelo6.png",
  tora_pelo7:"imagenes/tora/pelo7.png",
  tora_pelo8:"imagenes/tora/pelo8.png",
  tora_pelo9:"imagenes/tora/pelo9.png",
  tora_pelo10:"imagenes/tora/pelo10.png",
  tora_pelo11:"imagenes/tora/pelo11.png",
  tora_pelo12:"imagenes/tora/pelo12.png",
  tora_pelo13:"imagenes/tora/pelo13.png",
  tora_pelo14:"imagenes/tora/pelo14.png",
  tora_pelo15:"imagenes/tora/pelo15.png",
  tora_mascota10:"imagenes/tora/mascota10.png",
  tora_mascota11:"imagenes/tora/mascota11.png",
  tora_mascota12:"imagenes/tora/mascota12.png",
  tora_mascota13:"imagenes/tora/mascota13.png",
  tora_mascota14:"imagenes/tora/mascota14.png",
  tora_mascota15:"imagenes/tora/mascota15.png",
  tora_mascota16:"imagenes/tora/mascota16.png",
  tora_mascota17:"imagenes/tora/mascota17.png",
  tora_mascota18:"imagenes/tora/mascota18.png",
  tora_mascota19:"imagenes/tora/mascota19.png",
  tora_mascota20:"imagenes/tora/mascota20.png",
  tora_mascota21:"imagenes/tora/mascota21.png",
  tora_mascota22:"imagenes/tora/mascota22.png",
  tora_borde17:"imagenes/tora/borde17.png",
  tora_borde18:"imagenes/tora/borde18.png",
  // ---- Prendas nuevas de CEREZA ----
  cereza_fondo24:"imagenes/cereza/fondo24.png",
  cereza_fondo25:"imagenes/cereza/fondo25.png",
  cereza_fondo26:"imagenes/cereza/fondo26.png",
  cereza_fondo27:"imagenes/cereza/fondo27.png",
  cereza_fondo28:"imagenes/cereza/fondo28.png",
  cereza_fondo29:"imagenes/cereza/fondo29.png",
  cereza_fondo30:"imagenes/cereza/fondo30.png",
  cereza_fondo31:"imagenes/cereza/fondo31.png",
  cereza_fondo32:"imagenes/cereza/fondo32.png",
  cereza_fondo33:"imagenes/cereza/fondo33.png",
  cereza_fondo34:"imagenes/cereza/fondo34.png",
  cereza_fondo35:"imagenes/cereza/fondo35.png",
  cereza_fondo36:"imagenes/cereza/fondo36.png",
  cereza_fondo37:"imagenes/cereza/fondo37.png",
  cereza_fondo38:"imagenes/cereza/fondo38.png",
  cereza_fondo39:"imagenes/cereza/fondo39.png",
  cereza_piel6:"imagenes/cereza/piel6.png",
  cereza_piel7:"imagenes/cereza/piel7.png",
  cereza_boca3:"imagenes/cereza/boca3.png",
  cereza_boca4:"imagenes/cereza/boca4.png",
  cereza_boca5:"imagenes/cereza/boca5.png",
  cereza_boca6:"imagenes/cereza/boca6.png",
  cereza_boca7:"imagenes/cereza/boca7.png",
  cereza_boca8:"imagenes/cereza/boca8.png",
  cereza_boca9:"imagenes/cereza/boca9.png",
  cereza_botas3:"imagenes/cereza/botas3.png",
  cereza_botas4:"imagenes/cereza/botas4.png",
  cereza_botas5:"imagenes/cereza/botas5.png",
  cereza_botas6:"imagenes/cereza/botas6.png",
  cereza_botas7:"imagenes/cereza/botas7.png",
  cereza_botas8:"imagenes/cereza/botas8.png",
  cereza_pantalon3:"imagenes/cereza/pantalon3.png",
  cereza_pantalon4:"imagenes/cereza/pantalon4.png",
  cereza_pantalon5:"imagenes/cereza/pantalon5.png",
  cereza_pantalon6:"imagenes/cereza/pantalon6.png",
  cereza_pantalon7:"imagenes/cereza/pantalon7.png",
  cereza_remera3:"imagenes/cereza/remera3.png",
  cereza_remera4:"imagenes/cereza/remera4.png",
  cereza_remera5:"imagenes/cereza/remera5.png",
  cereza_remera6:"imagenes/cereza/remera6.png",
  cereza_remera7:"imagenes/cereza/remera7.png",
  cereza_remera8:"imagenes/cereza/remera8.png",
  cereza_remera9:"imagenes/cereza/remera9.png",
  cereza_remera10:"imagenes/cereza/remera10.png",
  cereza_accesorio3:"imagenes/cereza/accesorio3.png",
  cereza_accesorio4:"imagenes/cereza/accesorio4.png",
  cereza_accesorio5:"imagenes/cereza/accesorio5.png",
  cereza_accesorio6:"imagenes/cereza/accesorio6.png",
  cereza_accesorio7:"imagenes/cereza/accesorio7.png",
  cereza_accesorio8:"imagenes/cereza/accesorio8.png",
  cereza_accesorio9:"imagenes/cereza/accesorio9.png",
  cereza_accesorio10:"imagenes/cereza/accesorio10.png",
  cereza_accesorio11:"imagenes/cereza/accesorio11.png",
  cereza_accesorio12:"imagenes/cereza/accesorio12.png",
  cereza_accesorio13:"imagenes/cereza/accesorio13.png",
  cereza_espalda4:"imagenes/cereza/espalda4.png",
  cereza_espalda5:"imagenes/cereza/espalda5.png",
  cereza_espalda6:"imagenes/cereza/espalda6.png",
  cereza_espalda7:"imagenes/cereza/espalda7.png",
  cereza_espalda8:"imagenes/cereza/espalda8.png",
  cereza_espalda9:"imagenes/cereza/espalda9.png",
  cereza_espalda10:"imagenes/cereza/espalda10.png",
  cereza_espalda11:"imagenes/cereza/espalda11.png",
  cereza_espalda12:"imagenes/cereza/espalda12.png",
  cereza_espalda13:"imagenes/cereza/espalda13.png",
  cereza_espalda14:"imagenes/cereza/espalda14.png",
  cereza_espalda15:"imagenes/cereza/espalda15.png",
  cereza_espalda16:"imagenes/cereza/espalda16.png",
  cereza_espalda17:"imagenes/cereza/espalda17.png",
  cereza_espalda18:"imagenes/cereza/espalda18.png",
  cereza_espalda19:"imagenes/cereza/espalda19.png",
  cereza_espalda20:"imagenes/cereza/espalda20.png",
  cereza_espalda22:"imagenes/cereza/espalda22.png",
  cereza_cara5:"imagenes/cereza/cara5.png",
  cereza_cara6:"imagenes/cereza/cara6.png",
  cereza_pelo8:"imagenes/cereza/pelo8.png",
  cereza_pelo9:"imagenes/cereza/pelo9.png",
  cereza_pelo10:"imagenes/cereza/pelo10.png",
  cereza_pelo11:"imagenes/cereza/pelo11.png",
  cereza_pelo12:"imagenes/cereza/pelo12.png",
  cereza_pelo13:"imagenes/cereza/pelo13.png",
  cereza_pelo14:"imagenes/cereza/pelo14.png",
  cereza_pelo15:"imagenes/cereza/pelo15.png",
  cereza_pelo16:"imagenes/cereza/pelo16.png",
  cereza_pelo17:"imagenes/cereza/pelo17.png",
  cereza_pelo18:"imagenes/cereza/pelo18.png",
  cereza_pelo19:"imagenes/cereza/pelo19.png",
  cereza_pelo20:"imagenes/cereza/pelo20.png",
  cereza_mascota10:"imagenes/cereza/mascota10.png",
  cereza_mascota11:"imagenes/cereza/mascota11.png",
  cereza_mascota12:"imagenes/cereza/mascota12.png",
  cereza_mascota13:"imagenes/cereza/mascota13.png",
  cereza_mascota14:"imagenes/cereza/mascota14.png",
  cereza_mascota15:"imagenes/cereza/mascota15.png",
  cereza_mascota16:"imagenes/cereza/mascota16.png",
  cereza_mascota17:"imagenes/cereza/mascota17.png",
  cereza_mascota18:"imagenes/cereza/mascota18.png",
  cereza_mascota19:"imagenes/cereza/mascota19.png",
  cereza_mascota20:"imagenes/cereza/mascota20.png",
  cereza_mascota21:"imagenes/cereza/mascota21.png",
  cereza_mascota22:"imagenes/cereza/mascota22.png",
  cereza_borde17:"imagenes/cereza/borde17.png",
  cereza_borde18:"imagenes/cereza/borde18.png",
  // ---- Prendas nuevas de FENGCHAO ----
  fengchao_fondo1:"imagenes/fengchao/fondo1.png",
  fengchao_fondo2:"imagenes/fengchao/fondo2.png",
  fengchao_fondo3:"imagenes/fengchao/fondo3.png",
  fengchao_fondo4:"imagenes/fengchao/fondo4.png",
  fengchao_fondo5:"imagenes/fengchao/fondo5.png",
  fengchao_fondo6:"imagenes/fengchao/fondo6.png",
  fengchao_fondo7:"imagenes/fengchao/fondo7.png",
  fengchao_fondo8:"imagenes/fengchao/fondo8.png",
  fengchao_fondo9:"imagenes/fengchao/fondo9.png",
  fengchao_fondo10:"imagenes/fengchao/fondo10.png",
  fengchao_fondo11:"imagenes/fengchao/fondo11.png",
  fengchao_fondo12:"imagenes/fengchao/fondo12.png",
  fengchao_fondo13:"imagenes/fengchao/fondo13.png",
  fengchao_fondo14:"imagenes/fengchao/fondo14.png",
  fengchao_fondo15:"imagenes/fengchao/fondo15.png",
  fengchao_fondo16:"imagenes/fengchao/fondo16.png",
  fengchao_fondo17:"imagenes/fengchao/fondo17.png",
  fengchao_fondo18:"imagenes/fengchao/fondo18.png",
  fengchao_fondo19:"imagenes/fengchao/fondo19.png",
  fengchao_boca1:"imagenes/fengchao/boca1.png",
  fengchao_boca2:"imagenes/fengchao/boca2.png",
  fengchao_boca3:"imagenes/fengchao/boca3.png",
  fengchao_boca4:"imagenes/fengchao/boca4.png",
  fengchao_boca5:"imagenes/fengchao/boca5.png",
  fengchao_boca6:"imagenes/fengchao/boca6.png",
  fengchao_boca7:"imagenes/fengchao/boca7.png",
  fengchao_boca8:"imagenes/fengchao/boca8.png",
  fengchao_boca9:"imagenes/fengchao/boca9.png",
  fengchao_botas1:"imagenes/fengchao/botas1.png",
  fengchao_botas2:"imagenes/fengchao/botas2.png",
  fengchao_botas3:"imagenes/fengchao/botas3.png",
  fengchao_pantalon1:"imagenes/fengchao/pantalon1.png",
  fengchao_remera1:"imagenes/fengchao/remera1.png",
  fengchao_remera2:"imagenes/fengchao/remera2.png",
  fengchao_remera3:"imagenes/fengchao/remera3.png",
  fengchao_remera4:"imagenes/fengchao/remera4.png",
  fengchao_accesorio1:"imagenes/fengchao/accesorio1.png",
  fengchao_accesorio2:"imagenes/fengchao/accesorio2.png",
  fengchao_accesorio3:"imagenes/fengchao/accesorio3.png",
  fengchao_accesorio4:"imagenes/fengchao/accesorio4.png",
  fengchao_accesorio5:"imagenes/fengchao/accesorio5.png",
  fengchao_espalda1:"imagenes/fengchao/espalda1.png",
  fengchao_cara1:"imagenes/fengchao/cara1.png",
  fengchao_pelo1:"imagenes/fengchao/pelo1.png",
  fengchao_pelo2:"imagenes/fengchao/pelo2.png",
  fengchao_mascota1:"imagenes/fengchao/mascota1.png",
  fengchao_mascota2:"imagenes/fengchao/mascota2.png",
  fengchao_mascota3:"imagenes/fengchao/mascota3.png",
  fengchao_mascota4:"imagenes/fengchao/mascota4.png",
  fengchao_mascota5:"imagenes/fengchao/mascota5.png",
  fengchao_mascota6:"imagenes/fengchao/mascota6.png",
  fengchao_mascota7:"imagenes/fengchao/mascota7.png",
  fengchao_mascota8:"imagenes/fengchao/mascota8.png",
  fengchao_mascota9:"imagenes/fengchao/mascota9.png",
  fengchao_mascota10:"imagenes/fengchao/mascota10.png",
  fengchao_mascota11:"imagenes/fengchao/mascota11.png",
  fengchao_mascota12:"imagenes/fengchao/mascota12.png",
  fengchao_mascota13:"imagenes/fengchao/mascota13.png",
  fengchao_borde1:"imagenes/fengchao/borde1.png",
  fengchao_borde2:"imagenes/fengchao/borde2.png",
  // ---- Prendas nuevas de FENGLEI ----
  fenglei_fondo1:"imagenes/fenglei/fondo1.png",
  fenglei_fondo2:"imagenes/fenglei/fondo2.png",
  fenglei_fondo3:"imagenes/fenglei/fondo3.png",
  fenglei_fondo4:"imagenes/fenglei/fondo4.png",
  fenglei_fondo5:"imagenes/fenglei/fondo5.png",
  fenglei_fondo6:"imagenes/fenglei/fondo6.png",
  fenglei_fondo7:"imagenes/fenglei/fondo7.png",
  fenglei_fondo8:"imagenes/fenglei/fondo8.png",
  fenglei_fondo9:"imagenes/fenglei/fondo9.png",
  fenglei_fondo10:"imagenes/fenglei/fondo10.png",
  fenglei_fondo11:"imagenes/fenglei/fondo11.png",
  fenglei_fondo12:"imagenes/fenglei/fondo12.png",
  fenglei_fondo13:"imagenes/fenglei/fondo13.png",
  fenglei_fondo14:"imagenes/fenglei/fondo14.png",
  fenglei_fondo15:"imagenes/fenglei/fondo15.png",
  fenglei_fondo16:"imagenes/fenglei/fondo16.png",
  fenglei_fondo17:"imagenes/fenglei/fondo17.png",
  fenglei_fondo18:"imagenes/fenglei/fondo18.png",
  fenglei_fondo19:"imagenes/fenglei/fondo19.png",
  fenglei_boca1:"imagenes/fenglei/boca1.png",
  fenglei_boca2:"imagenes/fenglei/boca2.png",
  fenglei_boca3:"imagenes/fenglei/boca3.png",
  fenglei_boca4:"imagenes/fenglei/boca4.png",
  fenglei_boca5:"imagenes/fenglei/boca5.png",
  fenglei_boca6:"imagenes/fenglei/boca6.png",
  fenglei_boca7:"imagenes/fenglei/boca7.png",
  fenglei_boca8:"imagenes/fenglei/boca8.png",
  fenglei_boca9:"imagenes/fenglei/boca9.png",
  fenglei_pantalon1:"imagenes/fenglei/pantalon1.png",
  fenglei_remera1:"imagenes/fenglei/remera1.png",
  fenglei_remera2:"imagenes/fenglei/remera2.png",
  fenglei_accesorio1:"imagenes/fenglei/accesorio1.png",
  fenglei_accesorio2:"imagenes/fenglei/accesorio2.png",
  fenglei_accesorio3:"imagenes/fenglei/accesorio3.png",
  fenglei_accesorio4:"imagenes/fenglei/accesorio4.png",
  fenglei_espalda1:"imagenes/fenglei/espalda1.png",
  fenglei_cara1:"imagenes/fenglei/cara1.png",
  fenglei_mascota1:"imagenes/fenglei/mascota1.png",
  fenglei_mascota2:"imagenes/fenglei/mascota2.png",
  fenglei_mascota3:"imagenes/fenglei/mascota3.png",
  fenglei_mascota4:"imagenes/fenglei/mascota4.png",
  fenglei_mascota5:"imagenes/fenglei/mascota5.png",
  fenglei_mascota6:"imagenes/fenglei/mascota6.png",
  fenglei_mascota7:"imagenes/fenglei/mascota7.png",
  fenglei_mascota8:"imagenes/fenglei/mascota8.png",
  fenglei_mascota9:"imagenes/fenglei/mascota9.png",
  fenglei_mascota10:"imagenes/fenglei/mascota10.png",
  fenglei_mascota11:"imagenes/fenglei/mascota11.png",
  fenglei_mascota12:"imagenes/fenglei/mascota12.png",
  fenglei_mascota13:"imagenes/fenglei/mascota13.png",
  fenglei_borde1:"imagenes/fenglei/borde1.png",
  fenglei_borde2:"imagenes/fenglei/borde2.png",
  // ---- Prendas nuevas de FIORA ----
  fiora_fondo1:"imagenes/fiora/fondo1.png",
  fiora_fondo2:"imagenes/fiora/fondo2.png",
  fiora_fondo3:"imagenes/fiora/fondo3.png",
  fiora_fondo4:"imagenes/fiora/fondo4.png",
  fiora_fondo5:"imagenes/fiora/fondo5.png",
  fiora_fondo6:"imagenes/fiora/fondo6.png",
  fiora_fondo7:"imagenes/fiora/fondo7.png",
  fiora_fondo8:"imagenes/fiora/fondo8.png",
  fiora_fondo9:"imagenes/fiora/fondo9.png",
  fiora_fondo10:"imagenes/fiora/fondo10.png",
  fiora_fondo11:"imagenes/fiora/fondo11.png",
  fiora_fondo12:"imagenes/fiora/fondo12.png",
  fiora_fondo13:"imagenes/fiora/fondo13.png",
  fiora_fondo14:"imagenes/fiora/fondo14.png",
  fiora_fondo15:"imagenes/fiora/fondo15.png",
  fiora_fondo16:"imagenes/fiora/fondo16.png",
  fiora_fondo17:"imagenes/fiora/fondo17.png",
  fiora_fondo18:"imagenes/fiora/fondo18.png",
  fiora_fondo19:"imagenes/fiora/fondo19.png",
  fiora_boca1:"imagenes/fiora/boca1.png",
  fiora_boca2:"imagenes/fiora/boca2.png",
  fiora_boca3:"imagenes/fiora/boca3.png",
  fiora_boca4:"imagenes/fiora/boca4.png",
  fiora_boca5:"imagenes/fiora/boca5.png",
  fiora_boca6:"imagenes/fiora/boca6.png",
  fiora_boca7:"imagenes/fiora/boca7.png",
  fiora_boca8:"imagenes/fiora/boca8.png",
  fiora_boca9:"imagenes/fiora/boca9.png",
  fiora_botas1:"imagenes/fiora/botas1.png",
  fiora_botas2:"imagenes/fiora/botas2.png",
  fiora_pantalon1:"imagenes/fiora/pantalon1.png",
  fiora_pantalon2:"imagenes/fiora/pantalon2.png",
  fiora_pantalon3:"imagenes/fiora/pantalon3.png",
  fiora_pantalon4:"imagenes/fiora/pantalon4.png",
  fiora_pantalon5:"imagenes/fiora/pantalon5.png",
  fiora_remera1:"imagenes/fiora/remera1.png",
  fiora_remera2:"imagenes/fiora/remera2.png",
  fiora_remera3:"imagenes/fiora/remera3.png",
  fiora_remera4:"imagenes/fiora/remera4.png",
  fiora_remera5:"imagenes/fiora/remera5.png",
  fiora_accesorio1:"imagenes/fiora/accesorio1.png",
  fiora_accesorio2:"imagenes/fiora/accesorio2.png",
  fiora_accesorio3:"imagenes/fiora/accesorio3.png",
  fiora_espalda1:"imagenes/fiora/espalda1.png",
  fiora_cara1:"imagenes/fiora/cara1.png",
  fiora_pelo1:"imagenes/fiora/pelo1.png",
  fiora_mascota1:"imagenes/fiora/mascota1.png",
  fiora_mascota2:"imagenes/fiora/mascota2.png",
  fiora_mascota3:"imagenes/fiora/mascota3.png",
  fiora_mascota4:"imagenes/fiora/mascota4.png",
  fiora_mascota5:"imagenes/fiora/mascota5.png",
  fiora_mascota6:"imagenes/fiora/mascota6.png",
  fiora_mascota7:"imagenes/fiora/mascota7.png",
  fiora_mascota8:"imagenes/fiora/mascota8.png",
  fiora_mascota9:"imagenes/fiora/mascota9.png",
  fiora_mascota10:"imagenes/fiora/mascota10.png",
  fiora_mascota11:"imagenes/fiora/mascota11.png",
  fiora_mascota12:"imagenes/fiora/mascota12.png",
  fiora_mascota13:"imagenes/fiora/mascota13.png",
  fiora_borde1:"imagenes/fiora/borde1.png",
  fiora_borde2:"imagenes/fiora/borde2.png",
  // ---- Prendas nuevas de MAX ----
  max_fondo1:"imagenes/max/fondo1.png",
  max_fondo2:"imagenes/max/fondo2.png",
  max_fondo3:"imagenes/max/fondo3.png",
  max_fondo4:"imagenes/max/fondo4.png",
  max_fondo5:"imagenes/max/fondo5.png",
  max_fondo6:"imagenes/max/fondo6.png",
  max_fondo7:"imagenes/max/fondo7.png",
  max_fondo8:"imagenes/max/fondo8.png",
  max_fondo9:"imagenes/max/fondo9.png",
  max_fondo10:"imagenes/max/fondo10.png",
  max_fondo11:"imagenes/max/fondo11.png",
  max_fondo12:"imagenes/max/fondo12.png",
  max_fondo13:"imagenes/max/fondo13.png",
  max_fondo14:"imagenes/max/fondo14.png",
  max_fondo15:"imagenes/max/fondo15.png",
  max_fondo16:"imagenes/max/fondo16.png",
  max_fondo17:"imagenes/max/fondo17.png",
  max_fondo18:"imagenes/max/fondo18.png",
  max_fondo19:"imagenes/max/fondo19.png",
  max_boca1:"imagenes/max/boca1.png",
  max_boca2:"imagenes/max/boca2.png",
  max_boca3:"imagenes/max/boca3.png",
  max_boca4:"imagenes/max/boca4.png",
  max_boca5:"imagenes/max/boca5.png",
  max_boca6:"imagenes/max/boca6.png",
  max_boca7:"imagenes/max/boca7.png",
  max_boca8:"imagenes/max/boca8.png",
  max_boca9:"imagenes/max/boca9.png",
  max_botas1:"imagenes/max/botas1.png",
  max_botas2:"imagenes/max/botas2.png",
  max_botas3:"imagenes/max/botas3.png",
  max_pantalon1:"imagenes/max/pantalon1.png",
  max_pantalon2:"imagenes/max/pantalon2.png",
  max_pantalon3:"imagenes/max/pantalon3.png",
  max_remera1:"imagenes/max/remera1.png",
  max_remera2:"imagenes/max/remera2.png",
  max_remera3:"imagenes/max/remera3.png",
  max_remera4:"imagenes/max/remera4.png",
  max_accesorio1:"imagenes/max/accesorio1.png",
  max_accesorio2:"imagenes/max/accesorio2.png",
  max_accesorio3:"imagenes/max/accesorio3.png",
  max_accesorio4:"imagenes/max/accesorio4.png",
  max_accesorio5:"imagenes/max/accesorio5.png",
  max_accesorio6:"imagenes/max/accesorio6.png",
  max_accesorio7:"imagenes/max/accesorio7.png",
  max_accesorio8:"imagenes/max/accesorio8.png",
  max_accesorio9:"imagenes/max/accesorio9.png",
  max_accesorio10:"imagenes/max/accesorio10.png",
  max_espalda1:"imagenes/max/espalda1.png",
  max_cara1:"imagenes/max/cara1.png",
  max_cara2:"imagenes/max/cara2.png",
  max_pelo1:"imagenes/max/pelo1.png",
  max_pelo2:"imagenes/max/pelo2.png",
  max_mascota1:"imagenes/max/mascota1.png",
  max_mascota2:"imagenes/max/mascota2.png",
  max_mascota3:"imagenes/max/mascota3.png",
  max_mascota4:"imagenes/max/mascota4.png",
  max_mascota5:"imagenes/max/mascota5.png",
  max_mascota6:"imagenes/max/mascota6.png",
  max_mascota7:"imagenes/max/mascota7.png",
  max_mascota8:"imagenes/max/mascota8.png",
  max_mascota9:"imagenes/max/mascota9.png",
  max_mascota10:"imagenes/max/mascota10.png",
  max_mascota11:"imagenes/max/mascota11.png",
  max_mascota12:"imagenes/max/mascota12.png",
  max_mascota13:"imagenes/max/mascota13.png",
  max_borde1:"imagenes/max/borde1.png",
  max_borde2:"imagenes/max/borde2.png",
};

let editorCapas={
  fondo:"ninguno",
  espalda:"ninguno",
  modelo:"tora",
  piel:"ninguno",
  ojos:"ninguno",
  boca:"ninguno",
  botas:"ninguno",
  pantalon:"ninguno",
  remera:"ninguno",
  guantes:"ninguno",
  accesorio:"ninguno",
  cara:"ninguno",
  pelo:"ninguno",
  mascota:"ninguno",
  borde:"ninguno"
};

const ORDEN_CAPAS=[
  "fondo","espalda","modelo","piel","ojos","boca",
  "botas","pantalon","remera","guantes","accesorio",
  "cara","pelo","mascota","borde"
];


// ---------- AVATAR (Neon: users.avatar) ----------
// El avatar viaja embebido en datosUsuario (viene de /api/login o ya
// estaba en la sesión guardada), así que leerlo es sincrónico. Guardarlo
// sí pega a la API, además de actualizar la caché local al toque para
// que el resto de la página (preview, avatar principal) lo vea ya.

function cargarAvatar(){
  return normalizarAvatar(datosUsuario.avatar);
}

async function guardarAvatar(avatar){

  const avatarAnterior = datosUsuario.avatar;
  datosUsuario.avatar = avatar;

  try{

    const respuesta = await fetch("/api/users?action=update-avatar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: datosUsuario.nombre, avatar: avatar })
    });

    if(!respuesta.ok){
      datosUsuario.avatar = avatarAnterior;
      console.warn("MacroReborn: el servidor no confirmó el cambio de avatar.");
      return false;
    }

    // Neon confirmó el cambio: recién ahora actualizamos el estado global
    // para que navbar, perfil y otras pestañas vean el nuevo avatar.
    if (window.MRSession && typeof MRSession.update === "function") {
      MRSession.update({ avatar: avatar });
    } else {
      localStorage.setItem("usuarioActivo", JSON.stringify(datosUsuario));
    }

    return true;

  }catch(error){

    datosUsuario.avatar = avatarAnterior;
    console.warn("MacroReborn: no se pudo guardar el avatar en el servidor.", error);
    return false;

  }

}

// ---------- AVATAR PNG EXCLUSIVO DE ADMINISTRADOR ----------

async function guardarAvatarPngAdmin(dataUrl){
  const respuesta = await fetch("/api/users?action=update-admin-avatar-png", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: datosUsuario.nombre,
      avatarPng: dataUrl,
      avatarAnterior: (datosUsuario.avatar && !avatarEsPNG(datosUsuario.avatar)) ? datosUsuario.avatar : null
    })
  });

  let datos = null;
  try { datos = await respuesta.json(); } catch (_) {}

  if(!respuesta.ok || !datos || !datos.success){
    throw new Error((datos && datos.error) || "No se pudo guardar el PNG.");
  }

  datosUsuario.avatar = datos.user.avatar;
  if(window.MRSession && typeof MRSession.update === "function") {
    MRSession.update({ avatar: datos.user.avatar });
  } else {
    localStorage.setItem("usuarioActivo", JSON.stringify(datosUsuario));
  }

  actualizarAvatarPrincipal();
  return datos.user;
}

function prepararPanelAvatarAdminPng(){
  const box = document.getElementById("adminAvatarPngBox");
  const input = document.getElementById("adminAvatarPngInput");
  const btnGuardar = document.getElementById("guardarAdminAvatarPng");
  const btnQuitar = document.getElementById("quitarAdminAvatarPng");
  const preview = document.getElementById("adminAvatarPngPreview");
  const estado = document.getElementById("adminAvatarPngEstado");

  if(!box || !input || !btnGuardar || !btnQuitar || !preview || !estado) return;

  const mostrarPreviewActual = ()=>{
    const avatar = cargarAvatar();
    const src = typeof avatarPNGData === "function" ? avatarPNGData(avatar) : null;
    if(src){
      preview.innerHTML = `<img src="${src}" alt="Avatar PNG actual">`;
      estado.textContent = "Este PNG es tu avatar actual.";
    }else{
      preview.innerHTML = "";
      estado.textContent = "Todavía no tenés un avatar PNG personalizado.";
    }
  };

  input.addEventListener("change", async ()=>{
    const archivo = input.files && input.files[0];
    if(!archivo) return;

    estado.textContent = "Validando PNG…";
    preview.innerHTML = "";

    if(archivo.type !== "image/png" && !archivo.name.toLowerCase().endsWith(".png")){
      input.value = "";
      estado.textContent = "Solo se permiten archivos .png";
      return;
    }

    if(archivo.size > 1024 * 1024){
      input.value = "";
      estado.textContent = "El PNG no puede superar 1 MB.";
      return;
    }

    try{
      const bytes = new Uint8Array(await archivo.arrayBuffer());
      const firma = [137,80,78,71,13,10,26,10];
      if(firma.some((v, i)=>bytes[i] !== v)){
        throw new Error("El archivo no tiene una firma PNG válida.");
      }

      const lector = new FileReader();
      lector.onload = ()=>{
        preview.innerHTML = `<img src="${lector.result}" alt="Vista previa del PNG">`;
        estado.textContent = "PNG listo. Pulsá “Usar este PNG” para convertirlo en tu avatar.";
      };
      lector.onerror = ()=>{ estado.textContent = "No se pudo leer el archivo."; };
      lector.readAsDataURL(archivo);
    }catch(error){
      input.value = "";
      estado.textContent = error.message || "PNG inválido.";
    }
  });

  btnGuardar.addEventListener("click", async ()=>{
    const archivo = input.files && input.files[0];
    if(!archivo){
      estado.textContent = "Seleccioná primero un archivo PNG.";
      return;
    }

    try{
      const lector = new FileReader();
      lector.onload = async ()=>{
        try{
          estado.textContent = "Guardando avatar PNG…";
          btnGuardar.disabled = true;
          await guardarAvatarPngAdmin(lector.result);
          estado.textContent = "Avatar PNG guardado correctamente.";
          mostrarPreviewActual();
          const actual = cargarAvatar();
          if(actual && typeof avatarPNGData === "function" && avatarPNGData(actual)){
            estado.textContent = "Avatar PNG guardado correctamente. Este es tu avatar activo.";
          }
        }catch(error){
          estado.textContent = error.message || "No se pudo guardar el avatar PNG.";
        }finally{
          btnGuardar.disabled = false;
        }
      };
      lector.onerror = ()=>{ estado.textContent = "No se pudo leer el PNG."; };
      lector.readAsDataURL(archivo);
    }catch(error){
      estado.textContent = error.message || "No se pudo preparar el PNG.";
    }
  });

  btnQuitar.addEventListener("click", async ()=>{
    const avatar = cargarAvatar();
    if(!avatar || !avatarEsPNG(avatar)){
      estado.textContent = "Ya estás usando el avatar normal.";
      return;
    }

    const normal = (avatar && avatar.restaurar && !avatarEsPNG(avatar.restaurar))
      ? { ...avatar.restaurar }
      : { ...editorCapas };
    if(!normal.modelo || normal.modelo === "ninguno") normal.modelo = "tora";
    ORDEN_CAPAS.forEach(tipo=>{ if(!Object.prototype.hasOwnProperty.call(normal, tipo)) normal[tipo] = "ninguno"; });

    btnQuitar.disabled = true;
    estado.textContent = "Volviendo al avatar normal…";
    try{
      const ok = await guardarAvatar(normal);
      if(!ok) throw new Error("No se pudo guardar el avatar normal.");
      actualizarAvatarPrincipal();
      input.value = "";
      mostrarPreviewActual();
      estado.textContent = "Volviste al avatar normal del editor.";
    }catch(error){
      estado.textContent = error.message || "No se pudo volver al avatar normal.";
    }finally{
      btnQuitar.disabled = false;
    }
  });

  mostrarPreviewActual();
}

insigniasPerfilPropioListas.then(lista=>{
  if(Array.isArray(lista) && lista.includes("administrador")){
    const box = document.getElementById("adminAvatarPngBox");
    if(box){
      box.style.display = "block";
      prepararPanelAvatarAdminPng();
    }
  }
});


// ---------- CENTRO DE AVATARES (tienda) ----------
// Integración con la tienda de comunidad-ranking.html: las prendas que
// están en el catálogo (avatar_shop_items) y el usuario TODAVÍA no
// compró quedan bloqueadas acá (🔒), en vez de estar libres como el
// resto del guardarropa. Si no hay conexión o la tienda está vacía,
// simplemente no se bloquea nada (se comporta como antes).

let _tiendaPremiumPrecio = new Map(); // valorCapa -> precio
let _tiendaComprados = new Set();     // valorCapa ya comprado por este usuario

async function cargarEstadoTiendaAvatares(){
  try{

    const resp = await fetch("/api/content?action=avatar-shop&username=" + encodeURIComponent(datosUsuario.nombre));
    const datos = await resp.json();
    if(!datos || !datos.success) return;

    const comprados = new Set(datos.comprados || []);
    _tiendaPremiumPrecio = new Map();
    _tiendaComprados = new Set();

    (datos.items || []).forEach(item=>{
      _tiendaPremiumPrecio.set(item.valorCapa, item.precio);
      if(comprados.has(item.id)) _tiendaComprados.add(item.valorCapa);
    });

    aplicarBloqueosTienda();

  }catch(error){
    console.warn("MacroReborn: no se pudo cargar el estado del Centro de avatares.", error);
  }
}

function aplicarBloqueosTienda(){
  document.querySelectorAll(".opcion-item[data-capa]").forEach(opcion=>{

    if(opcion.dataset.capa === "modelo") return; // el modelo nunca se vende

    const valor = opcion.dataset.valor;
    const esPremium = _tiendaPremiumPrecio.has(valor);
    const laTiene = _tiendaComprados.has(valor);

    if(esPremium && !laTiene){
      opcion.classList.add("cr-bloqueada");
      if(!opcion.querySelector(".cr-precio-prenda")){
        const precio = document.createElement("span");
        precio.className = "cr-precio-prenda";
        precio.textContent = "🪙 " + _tiendaPremiumPrecio.get(valor);
        opcion.appendChild(precio);
      }
    } else {
      opcion.classList.remove("cr-bloqueada");
      opcion.querySelector(".cr-precio-prenda")?.remove();
    }

  });
}

cargarEstadoTiendaAvatares();


// ---------- PREVIEW EDITOR ----------

function actualizarPreview(){
  const preview=document.getElementById("previewAvatar");
  if(!preview)return;
  preview.innerHTML="";
  ORDEN_CAPAS.forEach(tipo=>{
    let valor=editorCapas[tipo];
    if(valor!="ninguno" && CAPAS_IMG[valor]){
      let img=document.createElement("img");
      img.src=CAPAS_IMG[valor];
      img.className="capa";
      preview.appendChild(img);
    }
  });
}


// ---------- AVATAR PRINCIPAL ----------

function actualizarAvatarPrincipal(){
  const avatar=cargarAvatar();
  const avatarWrapper=document.querySelector(".avatar");
  if(!avatarWrapper)return;

  if(!avatar){
    avatarWrapper.innerHTML='<img id="avatarPrincipal" src="imagenes/avatar.png" alt="Tu avatar en MacroReborn">';
    return;
  }

  if(avatarEsPNG(avatar)){
    const src = avatarPNGData(avatar);
    avatarWrapper.innerHTML = `<img id="avatarPrincipal" class="avatar-png-personalizado" src="${src}" alt="Avatar PNG personalizado">`;
    return;
  }

  let contenedor=document.createElement("div");
  contenedor.style.position="relative";
  contenedor.style.width="100%";
  contenedor.style.height="100%";
  contenedor.className="avatar-compuesto";

  const estiloCapa = "position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;";
  let rutasCapas = [];

  ORDEN_CAPAS.forEach(tipo=>{
    let valor=avatar[tipo];
    if(valor && valor!="ninguno" && CAPAS_IMG[valor]){
      let capa=document.createElement("img");
      capa.src=CAPAS_IMG[valor];
      capa.setAttribute("style", estiloCapa);
      contenedor.appendChild(capa);
      rutasCapas.push(CAPAS_IMG[valor]);
    }
  });

  contenedor.setAttribute("data-capas", rutasCapas.join("|"));
  contenedor.setAttribute("data-capa-style", estiloCapa);

  avatarWrapper.innerHTML="";
  avatarWrapper.appendChild(contenedor);
}


// ---------- FILTRAR OPCIONES SEGÚN EL MODELO ELEGIDO ----------
// Cada personaje tiene su propio guardarropa. Esta función oculta las
// opciones que no son del modelo actual y muestra un aviso si una
// categoría todavía no tiene nada cargado para ese personaje.

function filtrarOpcionesPorModelo(grupo){
  const modeloActual = editorCapas.modelo;
  let visibles = 0;

  grupo.querySelectorAll(".opcion-item").forEach(item=>{
    const modeloItem = item.dataset.modelo;
    const visible = !modeloItem || modeloItem === modeloActual;
    item.style.display = visible ? "" : "none";
    if(visible) visibles++;
  });

  let aviso = grupo.querySelector(".sin-opciones");
  if(visibles === 0){
    if(!aviso){
      aviso = document.createElement("p");
      aviso.className = "sin-opciones";
      aviso.style.opacity = "0.7";
      aviso.style.padding = "10px 0";
      aviso.textContent = "Todavía no hay opciones cargadas para este personaje.";
      grupo.querySelector(".fila-opciones")?.appendChild(aviso);
    }
  } else if(aviso){
    aviso.remove();
  }
}

function filtrarTodosLosGrupos(){
  gruposOpcion.forEach(g=>filtrarOpcionesPorModelo(g));
}


// ---------- SINCRONIZAR SELECCIONADAS EN EDITOR ----------
// Marca visualmente las opciones según el estado actual de editorCapas

function sincronizarSeleccionadas(){
  document.querySelectorAll(".opcion-item").forEach(opcion=>{
    const capa = opcion.dataset.capa;
    const valor = opcion.dataset.valor;
    if(editorCapas[capa] === valor){
      opcion.classList.add("seleccionada");
    } else {
      opcion.classList.remove("seleccionada");
    }
  });
}


// ---------- BARRA DE CATEGORÍAS ----------

const catBotones = document.querySelectorAll(".cat-btn");
const gruposOpcion = document.querySelectorAll(".grupo-opcion");

catBotones.forEach(btn=>{
  btn.addEventListener("click",()=>{
    const cat = btn.dataset.cat;

    // Activar botón seleccionado
    catBotones.forEach(b=>b.classList.remove("activa-cat"));
    btn.classList.add("activa-cat");

    // Mostrar solo el grupo correspondiente
    gruposOpcion.forEach(g=>{
      g.style.display = (g.dataset.grupo === cat) ? "" : "none";
    });

    const grupoActivo = [...gruposOpcion].find(g=>g.dataset.grupo===cat);
    if(grupoActivo) filtrarOpcionesPorModelo(grupoActivo);
  });
});


// ---------- ABRIR / CERRAR EDITOR ----------

document.getElementById("botonCrearAvatar")?.addEventListener("click",()=>{
  const guardado=cargarAvatar();
  if(guardado && !avatarEsPNG(guardado)) editorCapas={...guardado};

  document.getElementById("editorAvatar").style.display="block";

  // Mostrar primera categoría (modelo) al abrir
  catBotones.forEach(b=>b.classList.remove("activa-cat"));
  catBotones[0]?.classList.add("activa-cat");
  gruposOpcion.forEach(g=>{
    g.style.display = (g.dataset.grupo === "modelo") ? "" : "none";
  });

  sincronizarSeleccionadas();
  filtrarTodosLosGrupos();
  aplicarBloqueosTienda();
  actualizarPreview();
});

document.getElementById("cancelarEditor")?.addEventListener("click",()=>{
  document.getElementById("editorAvatar").style.display="none";
});


// ---------- GUARDAR AVATAR ----------

document.getElementById("guardarAvatar")?.addEventListener("click", async ()=>{
  await guardarAvatar({...editorCapas});
  document.getElementById("editorAvatar").style.display="none";
  actualizarAvatarPrincipal();

  // ==============================
  // LOGRO CREAR AVATAR
  // ==============================

  if(typeof desbloquearLogro === "function"){
    desbloquearLogro(datosUsuario.nombre, "primerAvatar");
    actualizarPuntosLogrosUI();
    renderLogros();
  }
});


// ---------- AVATAR ALEATORIO ----------
// Elige un modelo al azar (solo entre los que ya tienen guardarropa
// cargado en CAPAS_IMG) y, para cada categoría, una opción al azar
// entre las disponibles para ese modelo.

function modelosConGuardarropa(){
  const claves = Object.keys(CAPAS_IMG);
  const modelosBase = claves.filter(k => !k.includes("_"));
  return modelosBase.filter(m => claves.some(k => k.startsWith(m + "_")));
}

document.getElementById("avatarAleatorio")?.addEventListener("click", ()=>{

  const modelos = modelosConGuardarropa();
  if(modelos.length === 0) return;

  const modeloElegido = modelos[Math.floor(Math.random() * modelos.length)];

  ORDEN_CAPAS.forEach(tipo=>{
    editorCapas[tipo] = "ninguno";
  });
  editorCapas.modelo = modeloElegido;

  ORDEN_CAPAS.forEach(tipo=>{
    if(tipo === "modelo") return;

    const opciones = Object.keys(CAPAS_IMG)
      .filter(k => k.startsWith(modeloElegido + "_" + tipo));

    if(opciones.length > 0){
      editorCapas[tipo] = opciones[Math.floor(Math.random() * opciones.length)];
    }
  });

  filtrarTodosLosGrupos();
  sincronizarSeleccionadas();
  actualizarPreview();
});


// ---------- OPCIONES EDITOR (con toggle para deseleccionar) ----------

document.querySelectorAll(".opcion-item").forEach(opcion=>{
  opcion.onclick=()=>{
    const capa = opcion.dataset.capa;
    const valor = opcion.dataset.valor;

    // Prenda de la tienda que todavía no compró: no se deja EQUIPAR.
    // (Si ya la tenía puesta de antes de que existiera la tienda, se
    // la deja desequipar con normalidad más abajo, no se la trabamos).
    if(opcion.classList.contains("cr-bloqueada") && editorCapas[capa] !== valor){
      const precio = _tiendaPremiumPrecio.get(valor) || 0;
      const irATienda = confirm(
        "Esta prenda cuesta 🪙 " + precio + " y todavía no la compraste.\n" +
        "¿Querés ir al Centro de avatares para comprarla?"
      );
      if(irATienda) window.location.href = "comunidad-ranking.html";
      return;
    }

    if(capa === "modelo"){
      // Cambiar de personaje: el modelo siempre queda seleccionado,
      // y como el guardarropa de un personaje no le sirve a otro,
      // reseteamos esas categorías.
      editorCapas.modelo = valor;
      ORDEN_CAPAS.forEach(tipo=>{
        if(tipo !== "modelo") editorCapas[tipo] = "ninguno";
      });

      opcion.parentElement.querySelectorAll(".opcion-item")
        .forEach(x=>x.classList.remove("seleccionada"));
      opcion.classList.add("seleccionada");

      filtrarTodosLosGrupos();
      actualizarPreview();
      return;
    }

    // Toggle: si ya está equipada, desequipar; si no, equipar
    if(editorCapas[capa] === valor){
      editorCapas[capa] = "ninguno";
      opcion.classList.remove("seleccionada");
    } else {
      editorCapas[capa] = valor;
      // Quitar selección previa de la misma categoría
      opcion.parentElement.querySelectorAll(".opcion-item")
        .forEach(x=>x.classList.remove("seleccionada"));
      opcion.classList.add("seleccionada");
    }

    actualizarPreview();
  };
});


// ---------- INICIO ----------

actualizarAvatarPrincipal();



// ==============================
// EDITAR DESCRIPCIÓN
// ==============================

const botonEditar = document.querySelector(".datos button");

if(botonEditar)
  botonEditar.textContent = "✏️ Editar descripción";


botonEditar?.addEventListener("click", ()=>{

  const bio = document.getElementById("biografia");
  const descripcionInicio = document.getElementById("descripcionInicio");

  if(document.getElementById("inputBio")) return;


  const actual = bio.textContent.trim();


  const textarea = document.createElement("textarea");

  textarea.id = "inputBio";

  textarea.value =
    actual === "Todavía no escribió una biografía."
      ? ""
      : actual;


  textarea.style.cssText =
    "width:100%;padding:8px;border-radius:8px;border:2px solid #f0b429;background:#0f172a;color:white;font-size:14px;resize:vertical;min-height:70px;margin-top:8px;";


  textarea.placeholder = "Escribí tu descripción...";


  const btnGuardar = document.createElement("button");

  btnGuardar.textContent = "💾 Guardar";

  btnGuardar.style.cssText =
    "margin-top:8px;background:#f0b429;border:none;padding:8px 18px;border-radius:8px;font-weight:bold;cursor:pointer;";


  const btnCancelar = document.createElement("button");

  btnCancelar.textContent = "Cancelar";

  btnCancelar.style.cssText =
    "margin-top:8px;margin-left:8px;background:#555;color:white;border:none;padding:8px 14px;border-radius:8px;";


  bio.style.display = "none";


  bio.parentElement.insertBefore(
    textarea,
    bio.nextSibling
  );

  bio.parentElement.insertBefore(
    btnGuardar,
    textarea.nextSibling
  );

  bio.parentElement.insertBefore(
    btnCancelar,
    btnGuardar.nextSibling
  );


  textarea.focus();



// GUARDAR BIO EN NEON

btnGuardar.addEventListener("click", ()=>{


  const nuevo =
    textarea.value.trim() ||
    "Todavía no escribió una biografía.";


  bio.textContent = nuevo;


  if(descripcionInicio)
    descripcionInicio.textContent = nuevo;



  fetch("/api/users?action=update-bio", {

    method:"POST",

    headers:{
      "Content-Type":"application/json"
    },

    body:JSON.stringify({

      username: datosUsuario.nombre,

      bio: nuevo

    })

  })


  .then(res=>res.json())


  .then(data=>{

    console.log(
      "Bio actualizada:",
      data
    );


    datosUsuario.bio = nuevo;

    if (window.MRSession && typeof MRSession.update === "function") {
      MRSession.update({ bio: nuevo, biografia: nuevo });
    } else {
      localStorage.setItem(
        "usuarioActivo",
        JSON.stringify(datosUsuario)
      );
    }


  })


  .catch(error=>{

    console.error(
      "Error actualizando bio:",
      error
    );

  });



  bio.style.display = "";

  textarea.remove();

  btnGuardar.remove();

  btnCancelar.remove();


});


  // CANCELAR

  btnCancelar.addEventListener("click", ()=>{


    bio.style.display = "";

    textarea.remove();

    btnGuardar.remove();

    btnCancelar.remove();


  });


});



// CARGAR BIO DESDE DATOS DEL USUARIO

if(datosUsuario.bio){

  document.getElementById("biografia").textContent =
    datosUsuario.bio;


  const desc =
    document.getElementById("descripcionInicio");


  if(desc)
    desc.textContent = datosUsuario.bio;

}

// ==============================
// AMIGOS (pestaña del perfil)
// ==============================

const MAX_AMIGOS_FAVORITOS = 10;

async function renderAmigosPerfil(){
  const contenedor = document.getElementById("listaAmigosPerfil");
  if(!contenedor) return;

  let misAmigos = [];
  let misFavoritos = [];

  try{
    const respuesta = await fetch("/api/social?action=friends&username=" + encodeURIComponent(datosUsuario.nombre));
    const datos = await respuesta.json();
    if(datos && datos.success) misAmigos = datos.amigos;
  }catch(error){
    console.warn("MacroReborn: no se pudo cargar la lista de amigos.", error);
  }

  try{
    const respuestaFav = await fetch("/api/social?action=favoriteFriends&username=" + encodeURIComponent(datosUsuario.nombre));
    const datosFav = await respuestaFav.json();
    if(datosFav && datosFav.success) misFavoritos = datosFav.favoritos;
  }catch(error){
    console.warn("MacroReborn: no se pudo cargar los amigos favoritos.", error);
  }

  if(misAmigos.length === 0){
    contenedor.innerHTML = `<p>Todavía no agregaste amigos. <a href="comunidad.html" style="color:#f0b429;">Buscá jugadores en la comunidad</a>.</p>`;
    return;
  }

  // Amigos favoritos primero, el resto después (mismo orden alfabético
  // que ya trae /api/social?action=friends dentro de cada grupo).
  const amigosOrdenados = [
    ...misAmigos.filter(a => misFavoritos.includes(a.username)),
    ...misAmigos.filter(a => !misFavoritos.includes(a.username))
  ];

  contenedor.innerHTML = `<div class="grid-usuarios">` + amigosOrdenados.map(amigo => {
    const nombreAmigo = amigo.username;
    const avatar = normalizarAvatar(amigo.avatar);
    const esFavorito = misFavoritos.includes(nombreAmigo);

    let capas = "";
    let rutasCapas = [];

    if(avatar){
      ORDEN_CAPAS.forEach(tipo=>{
        const valor = avatar[tipo];
        if(valor && valor!=="ninguno" && CAPAS_IMG[valor]){
          capas += `<img class="capa-tarjeta" src="${CAPAS_IMG[valor]}" alt="" loading="lazy">`;
          rutasCapas.push(CAPAS_IMG[valor]);
        }
      });
    }

    const avatarHTML = capas || `<img src="imagenes/avatar.png" class="avatar-default" alt="" loading="lazy">`;

    return `
      <div class="tarjeta-usuario">

        <button class="btn-favorito-amigo ${esFavorito ? "es-favorito" : ""}" data-nombre="${escaparHTML(nombreAmigo)}" title="${esFavorito ? "Quitar de favoritos" : "Marcar como favorito"}">★</button>

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

        <div class="tarjeta-amigo-acciones">
          <a href="usuario.html?usuario=${encodeURIComponent(nombreAmigo)}" class="btn-ver-perfil">👤 Ver perfil</a>
          <button class="btn-quitar-amigo-perfil" data-nombre="${escaparHTML(nombreAmigo)}" title="Eliminar amigo">🗑️</button>
        </div>

      </div>
    `;
  }).join("") + `</div>`;

  contenedor.querySelectorAll(".btn-quitar-amigo-perfil").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const objetivo = btn.dataset.nombre;
      if(!confirm(`¿Eliminar a ${objetivo} de tus amigos?`)) return;

      btn.disabled = true;

      try{
        await fetch("/api/social?action=friends", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "remove", username: datosUsuario.nombre, friendUsername: objetivo })
        });
      }catch(error){
        console.warn("MacroReborn: no se pudo eliminar al amigo.", error);
      }

      renderAmigosPerfil();
    });
  });

  contenedor.querySelectorAll(".btn-favorito-amigo").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const objetivo = btn.dataset.nombre;
      const esFavoritoActual = btn.classList.contains("es-favorito");

      if(!esFavoritoActual && misFavoritos.length >= MAX_AMIGOS_FAVORITOS){
        alert(`Ya tenés el máximo de ${MAX_AMIGOS_FAVORITOS} amigos favoritos. Quitá uno antes de agregar otro.`);
        return;
      }

      btn.disabled = true;

      try{
        const respuesta = await fetch("/api/social?action=favoriteFriends", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: esFavoritoActual ? "remove" : "add",
            username: datosUsuario.nombre,
            friendUsername: objetivo
          })
        });
        const datosResp = await respuesta.json();
        if(!datosResp || !datosResp.success){
          alert((datosResp && datosResp.error) || "No se pudo actualizar el amigo favorito.");
        }
      }catch(error){
        console.warn("MacroReborn: no se pudo actualizar el amigo favorito.", error);
      }

      renderAmigosPerfil();
    });
  });
}

renderAmigosPerfil();


// ==============================
// COMENTARIOS
// ==============================

// Comentarios viven en Neon (tabla profile_comments,
// /api/content?action=comments). Se guarda una copia en memoria
// (_comentariosCache) para que funciones que antes leían localStorage
// de forma sincrónica (como renderUltimosComentariosInicio) puedan
// seguir haciéndolo sin volverse async.

let _comentariosCache = [];

async function cargarComentarios(){
  try{
    const resp = await fetch("/api/content?action=comments&username=" + encodeURIComponent(datosUsuario.nombre));
    const datos = await resp.json();
    _comentariosCache = (datos && datos.success) ? datos.comentarios : [];
  }catch(error){
    console.warn("MacroReborn: no se pudieron cargar los comentarios.", error);
    _comentariosCache = [];
  }
  return _comentariosCache;
}

// AVATAR DEL USUARIO EN COMENTARIOS

// Escapa texto no confiable antes de insertarlo en HTML.
function escaparHTML(texto) {
  const div = document.createElement("div");
  div.textContent = texto == null ? "" : String(texto);
  return div.innerHTML;
}


function obtenerAvatarComentario(nombre){
  // El avatar viaja embebido en el usuario (users.avatar, Neon); se lee
  // de la caché en memoria de js/core.js, precargada por
  // renderComentarios() antes de pintar la lista.
  const avatar = typeof obtenerAvatarCacheado === "function" ? obtenerAvatarCacheado(nombre) : null;

  if(!avatar){
    return `<img class="avatar-comentario" src="imagenes/avatar.png" alt="" loading="lazy">`;
  }

  let capas = "";
  let rutasCapas = [];
  ORDEN_CAPAS.forEach(tipo=>{
    let valor = avatar[tipo];
    if(valor && valor !== "ninguno" && CAPAS_IMG[valor]){
      capas += `<img class="capa-comentario" src="${CAPAS_IMG[valor]}" alt="" loading="lazy">`;
      rutasCapas.push(CAPAS_IMG[valor]);
    }
  });

  return `<div class="avatar-mini avatar-compuesto" data-capas="${rutasCapas.join("|")}" ` +
    `data-capa-class="capa-comentario">${capas}</div>`;
}

// ÚLTIMOS COMENTARIOS (pestaña Inicio)
// Reutiliza los mismos datos (cargarComentarios) y el mismo avatar
// (obtenerAvatarComentario) que la pestaña Comentarios, mostrando
// solo los más recientes.

function renderUltimosComentariosInicio(){
  const contenedor = document.getElementById("ultimosComentariosInicio");
  if(!contenedor) return;

  const lista = _comentariosCache;

  if(lista.length === 0){
    contenedor.innerHTML = `<p>Todavía no hay comentarios.</p>`;
    return;
  }

  // La lista ya viene del más nuevo al más viejo (ORDER BY id DESC en
  // /api/content?action=comments), así que los "últimos" son
  // simplemente los primeros 3, sin necesidad de invertir nada.
  const ultimos = lista.slice(0, 3);

  contenedor.innerHTML = ultimos.map((c)=>{
    return `
    <div class="comentario">
      <div class="usuario-comentario">
        ${obtenerAvatarComentario(c.usuario)}
        <b>${escaparHTML(c.usuario)}</b>
      </div>
      ${typeof insigniasBloqueHTML === "function" ? insigniasBloqueHTML(c.usuario, true) : ""}
      <p>${escaparHTML(c.texto)}</p>
      ${typeof botonLikeHTML === "function" ? botonLikeHTML("comment", c.id, datosUsuario.nombre) : ""}
    </div>
  `;
  }).join("");
}

// CONFIRMACIÓN ANTES DE ELIMINAR
// Modal simple y reutilizable: muestra el mensaje, y solo ejecuta
// "onConfirmar" si el usuario elige "Eliminar". Si elige "Cancelar",
// hace clic afuera o presiona Escape, no pasa absolutamente nada.

function pedirConfirmacion(mensaje, onConfirmar, textoBoton){
  document.querySelectorAll(".confirmacion-overlay").forEach(el => el.remove());

  const overlay = document.createElement("div");
  overlay.className = "confirmacion-overlay";
  overlay.innerHTML = `
    <div class="confirmacion-caja">
      <p class="confirmacion-mensaje">${mensaje}</p>
      <div class="confirmacion-botones">
        <button type="button" class="confirmacion-cancelar">Cancelar</button>
        <button type="button" class="confirmacion-confirmar">${textoBoton || "🗑️ Eliminar"}</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  function cerrar(){
    overlay.remove();
    document.removeEventListener("keydown", porEscape);
  }

  function porEscape(e){
    if(e.key === "Escape") cerrar();
  }

  overlay.querySelector(".confirmacion-cancelar").addEventListener("click", cerrar);

  overlay.querySelector(".confirmacion-confirmar").addEventListener("click", ()=>{
    cerrar();
    onConfirmar();
  });

  overlay.addEventListener("click", (e)=>{
    if(e.target === overlay) cerrar();
  });

  document.addEventListener("keydown", porEscape);
}

// MOSTRAR COMENTARIOS

async function renderComentarios(){
  const lista = await cargarComentarios();

  if(typeof cargarAvataresDeVarios === "function"){
    await cargarAvataresDeVarios(lista.map(c => c.usuario));
  }

  const contenedor = document.getElementById("listaComentarios");

  // Mantenemos sincronizado el resumen de Inicio cada vez que se
  // actualiza la lista de comentarios (alta o baja).
  renderUltimosComentariosInicio();

  if(!contenedor) return;

  // Usuario logueado en ESTE navegador: el botón "Eliminar" solo debe
  // aparecer en los comentarios que escribió esta persona, sin
  // importar en qué perfil los haya dejado (el suyo o el de otro).
  const usuarioActivoComentarios = (window.MRSession && typeof MRSession.get === "function")
    ? MRSession.get()
    : leerJSON(localStorage.getItem("usuarioActivo") || "null");
  const miNombreComentarios = usuarioActivoComentarios ? usuarioActivoComentarios.nombre : null;

  if(lista.length === 0){
    contenedor.innerHTML = `
    <div class="comentario">
      <b>Usuario</b>
      <p>Buen perfil 😄</p>
      <button class="boton-responder" data-usuario="Usuario">Responder</button>
      <button class="boton-eliminar" data-id="-1">🗑️ Eliminar</button>
      <button class="boton-reportar" data-id="-1">🚩 Reportar</button>
    </div>`;
  } else {
    // Quién puede borrar cada comentario: el que lo escribió, o el
    // dueño de este perfil (esta página siempre muestra el perfil
    // propio, así que "esDueñoDelPerfil" da siempre true acá, pero se
    // deja explícito para que la regla sea igual que en js/usuario.js).
    const esDueñoDelPerfil = miNombreComentarios && miNombreComentarios === datosUsuario.nombre;

    contenedor.innerHTML = lista.map((c)=>{
      const esMio = miNombreComentarios && c.usuario === miNombreComentarios;
      const puedeEliminar = esMio || esDueñoDelPerfil;
      return `
      <div class="comentario">
        <div class="usuario-comentario">
          ${obtenerAvatarComentario(c.usuario)}
          <b>${escaparHTML(c.usuario)}</b>
        </div>
        ${typeof insigniasBloqueHTML === "function" ? insigniasBloqueHTML(c.usuario, true) : ""}
        <p>${escaparHTML(c.texto)}</p>
        ${typeof botonLikeHTML === "function" ? botonLikeHTML("comment", c.id, datosUsuario.nombre) : ""}
        <button class="boton-responder" data-usuario="${escaparHTML(c.usuario)}">Responder</button>
        ${puedeEliminar ? `<button class="boton-eliminar" data-id="${c.id}">🗑️ Eliminar</button>` : ""}
        <button class="boton-reportar" data-id="${c.id}">🚩 Reportar</button>
      </div>`;
    }).join("");
  }

  // RESPONDER
  contenedor.querySelectorAll(".boton-responder").forEach(btn=>{
    btn.onclick=()=>{
      const input = document.getElementById("comentarioTexto");
      if(input){
        input.value = "@" + btn.dataset.usuario + " ";
        input.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(()=> input.focus(), 300);
      }
    };
  });

  // ELIMINAR
  contenedor.querySelectorAll(".boton-eliminar").forEach(btn=>{
    btn.onclick=()=>{
      const id = btn.dataset.id;

      pedirConfirmacion("¿Seguro que querés eliminar este comentario?", async ()=>{
        if(id === "-1"){
          contenedor.innerHTML="";
          return;
        }
        try{
          await fetch("/api/content?action=comments", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ commentId: id, username: miNombreComentarios })
          });
        }catch(error){
          console.warn("MacroReborn: no se pudo eliminar el comentario.", error);
        }
        renderComentarios();
      });
    };
  });

  // REPORTAR
  contenedor.querySelectorAll(".boton-reportar").forEach(btn=>{
    btn.onclick=()=>{
      const id = btn.dataset.id;

      pedirConfirmacion("¿Seguro que querés reportar este comentario?", ()=>{

        if(typeof reportarComentario === "function"){
          const comentario = id === "-1"
            ? { usuario:"Usuario", texto:"Buen perfil 😄" }
            : _comentariosCache.find(c => String(c.id) === id);
          const motivo = prompt("¿Por qué reportás este comentario? (opcional)") || "";
          reportarComentario("comment", id === "-1" ? null : id, datosUsuario.nombre, comentario, motivo);
        }

        alert("Gracias. El comentario fue reportado correctamente.");

      }, "🚩 Reportar");
    };
  });
}

// ELIMINAR TODOS MIS COMENTARIOS (vaciar el muro del propio perfil)

document.getElementById("botonEliminarTodosComentarios")?.addEventListener("click", ()=>{
  pedirConfirmacion(
    "¿Seguro que querés eliminar TODOS los comentarios de tu perfil? Esta acción no se puede deshacer.",
    async ()=>{
      try{
        await fetch("/api/content?action=comments", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profileUsername: datosUsuario.nombre, username: datosUsuario.nombre })
        });
      }catch(error){
        console.warn("MacroReborn: no se pudieron eliminar los comentarios.", error);
      }
      renderComentarios();
    },
    "🗑️ Eliminar todos"
  );
});

// CREAR COMENTARIO

document.getElementById("botonComentar")?.addEventListener("click", async ()=>{

  if(typeof bloqueadoPorSuspension === "function" && await bloqueadoPorSuspension()) return;

  const input = document.getElementById("comentarioTexto");
  const texto = input.value.trim();
  if(!texto) return;

  const usuarioActivo = (window.MRSession && typeof MRSession.get === "function")
    ? MRSession.get()
    : leerJSON(localStorage.getItem("usuarioActivo") || "null");

  try{
    const respuestaComentario = await fetch("/api/content?action=comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profileUsername: datosUsuario.nombre,
        texto: texto,
        authorUsername: usuarioActivo ? usuarioActivo.nombre : "Usuario"
      })
    });

    const datosComentario = await respuestaComentario.json().catch(() => null);
    if (!respuestaComentario.ok || !datosComentario || !datosComentario.success) {
      console.warn("MacroReborn: el servidor rechazó el comentario.", datosComentario);
      return;
    }
  }catch(error){
    console.warn("MacroReborn: no se pudo publicar el comentario.", error);
    return;
  }

  input.value="";
  await renderComentarios();

  if(typeof notificarMenciones === "function" && usuarioActivo){
    notificarMenciones(texto, usuarioActivo.nombre, "en un comentario en el perfil de " + datosUsuario.nombre + ".");
  }

  // ==============================
  // LOGRO PRIMER COMENTARIO
  // ==============================
  if(usuarioActivo && typeof desbloquearLogro === "function"){
    desbloquearLogro(usuarioActivo.nombre, "primeraPalabra");
    actualizarPuntosLogrosUI();
    renderLogros();
  }

  // ACTIVIDAD RECIENTE - COMENTARIO
  if(usuarioActivo && typeof registrarActividad === "function"){
    const detalleComentario = typeof empaquetarComentario === "function"
      ? empaquetarComentario(datosUsuario.nombre, texto)
      : texto;
    registrarActividad(usuarioActivo.nombre, "comentario", detalleComentario);
    if(typeof renderActividadReciente === "function") renderActividadReciente();
  }
});

// ENTER PARA ENVIAR

document.getElementById("comentarioTexto")?.addEventListener("keydown",e=>{
  if(e.key==="Enter"){
    document.getElementById("botonComentar")?.click();
  }
});

renderComentarios();


// ==============================
// MOSTRAR LOGROS
// ==============================
// (la definición de renderLogros queda igual; solo cambia CUÁNDO se
// llama la primera vez, más abajo, para esperar a logrosListos)

function renderLogros(){

  const contenedor = document.getElementById("listaLogros");

  if(!contenedor) return;

  const lista = obtenerLogros(datosUsuario.nombre);

  contenedor.innerHTML = "";

  Object.values(LOGROS).forEach(logro=>{

    const conseguido = lista.find(l=>l.id===logro.id);

    contenedor.innerHTML += `
      <div class="tarjeta-logro ${conseguido ? "desbloqueado" : "bloqueado"}">
        <div class="icono-logro">${logro.icono}</div>
        <div>
          <h3>${logro.nombre}</h3>
          <p>${logro.descripcion}</p>
          ${
            conseguido
            ? `<span class="estado-logro">✅ Desbloqueado<br>${conseguido.fecha}</span>`
            : `<span class="estado-logro">🔒 Bloqueado</span>`
          }
        </div>
      </div>
    `;

  });

}

logrosListos.then(renderLogros);

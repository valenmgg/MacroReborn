// ==============================
// SISTEMA DE ROLES Y PERMISOS - MacroReborn (Fase 2: Neon, cierre de migración)
// ==============================
// Se apoya en las insignias oficiales (js/motor/insignias.js, ya en
// Neon desde la Fase 1) para decidir qué puede hacer cada uno.
//
// La lista de usuarios y la suspensión de cuentas vivían antes en
// localStorage bajo la clave "usuariosMacro" — una clave que dejó de
// llenarse el día que el registro/login pasaron a Neon (Fase 1), así
// que en la práctica "obtenerUsuarios()" siempre devolvía un array
// vacío y la suspensión nunca tenía efecto real. Ahora todo sale de
// /api/users (tabla "users" de Neon).


// ==============================
// LECTURA DE USUARIOS (Neon)
// ==============================

// Trae la lista completa de usuarios (para el panel de administración).
// tope alto a propósito: el panel necesita verlos a todos, no solo los
// primeros 300 que trae /api/users por defecto.
async function obtenerUsuarios(){

  try{

    const resp = await fetch("/api/users?limit=2000");
    const datos = await resp.json();
    return (datos && datos.success) ? datos.users : [];

  }catch(error){

    console.warn("MacroReborn: no se pudo cargar la lista de usuarios.", error);
    return [];

  }

}

function obtenerUsuarioActivo(){
  if (window.MRSession && typeof window.MRSession.get === "function") {
    return window.MRSession.get();
  }
  return leerJSON(localStorage.getItem("usuarioActivo") || "null");
}

async function buscarUsuarioPorNombre(nombre){

  if(!nombre) return null;

  try{

    let datos;
    if(window.MRApi && typeof window.MRApi.requestShared === "function"){
      datos = await window.MRApi.requestShared(
        "GET",
        "/api/users?username=" + encodeURIComponent(nombre),
        { credentials: "same-origin" }
      );
    }else{
      const resp = await fetch("/api/users?username=" + encodeURIComponent(nombre));
      datos = await resp.json();
    }
    return (datos && datos.success) ? datos.user : null;

  }catch(error){

    console.warn("MacroReborn: no se pudo cargar el usuario.", error);
    return null;

  }

}




// ==============================
// ROLES DISPONIBLES
// ==============================
// Coinciden con el id de las insignias oficiales (js/motor/insignias.js).
// El colaborador es puramente visual: no otorga ningún permiso.

const ROLES = {
  ADMINISTRADOR: "administrador",
  MODERADOR: "moderador",
  COLABORADOR: "colaborador"
};




// ==============================
// CONSULTA DE ROL / INSIGNIAS
// ==============================
// Sincrónicas a propósito (se llaman dentro de bucles de render): leen
// de la caché en memoria de js/motor/insignias.js. Cualquier página
// que necesite un resultado confiable tiene que llamar antes a
// cargarInsignias(nombre) (o cargarInsigniasDeVarios) y esperarlo, tal
// como ya hacía el resto del sitio con las insignias.

function _insigniasDe(usuarioONombre){

  const nombre = typeof usuarioONombre === "string"
    ? usuarioONombre
    : (usuarioONombre ? usuarioONombre.nombre : null);

  if(!nombre) return [];

  return typeof obtenerInsignias === "function" ? obtenerInsignias(nombre) : [];

}

function esAdministrador(usuarioONombre){
  return _insigniasDe(usuarioONombre).includes(ROLES.ADMINISTRADOR);
}

// El administrador también puede hacer todo lo que puede un moderador.
function esModerador(usuarioONombre){
  const insignias = _insigniasDe(usuarioONombre);
  return insignias.includes(ROLES.MODERADOR) || insignias.includes(ROLES.ADMINISTRADOR);
}

function esColaborador(usuarioONombre){
  return _insigniasDe(usuarioONombre).includes(ROLES.COLABORADOR);
}




// ==============================
// TABLA DE PERMISOS
// ==============================
// Un único lugar donde queda documentado (y controlado) qué puede
// hacer cada rol. Si el día de mañana se agrega un permiso nuevo,
// alcanza con sumarlo acá.

const PERMISOS = {

  // Exclusivos del administrador
  panelAdmin:            [ROLES.ADMINISTRADOR],
  verUsuarios:            [ROLES.ADMINISTRADOR],
  buscarUsuarios:          [ROLES.ADMINISTRADOR],
  asignarInsignias:        [ROLES.ADMINISTRADOR],
  quitarInsignias:        [ROLES.ADMINISTRADOR],
  gestionarModeradores:      [ROLES.ADMINISTRADOR],
  verEstadisticas:        [ROLES.ADMINISTRADOR],

  // Compartidos entre administrador y moderador
  panelModeracion:        [ROLES.ADMINISTRADOR, ROLES.MODERADOR],
  verReportes:          [ROLES.ADMINISTRADOR, ROLES.MODERADOR],
  eliminarComentarios:      [ROLES.ADMINISTRADOR, ROLES.MODERADOR],
  suspenderUsuarios:        [ROLES.ADMINISTRADOR, ROLES.MODERADOR],
  reactivarUsuarios:        [ROLES.ADMINISTRADOR, ROLES.MODERADOR]

};

function tienePermiso(usuarioONombre, permiso){

  const definicion = PERMISOS[permiso];
  if(!definicion) return false;

  const insignias = _insigniasDe(usuarioONombre);
  return definicion.some(rol => insignias.includes(rol));

}




// ==============================
// SUSPENSIÓN DE USUARIOS (Neon)
// ==============================
// Un usuario suspendido no puede comentar, mandar mensajes ni hacer
// acciones de comunidad (agregar amigos, aceptar solicitudes, etc).
// Sigue pudiendo navegar el sitio con normalidad.

async function estaSuspendido(usuarioONombre){

  const nombre = typeof usuarioONombre === "string"
    ? usuarioONombre
    : (usuarioONombre ? usuarioONombre.nombre : null);

  if(!nombre) return false;

  const usuario = await buscarUsuarioPorNombre(nombre);
  return !!(usuario && usuario.suspendido);

}

async function suspenderUsuario(nombre, motivo){

  try{

    const resp = await fetch("/api/users?action=suspend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: nombre, motivo: motivo || "" })
    });
    const datos = await resp.json();
    return (datos && datos.success) ? datos.user : null;

  }catch(error){

    console.warn("MacroReborn: no se pudo suspender al usuario.", error);
    return null;

  }

}

async function reactivarUsuario(nombre){

  try{

    const resp = await fetch("/api/users?action=reactivate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: nombre })
    });
    const datos = await resp.json();
    return (datos && datos.success) ? datos.user : null;

  }catch(error){

    console.warn("MacroReborn: no se pudo reactivar al usuario.", error);
    return null;

  }

}

// Chequeo genérico para usar antes de comentar / mandar mensajes /
// acciones de comunidad. Si está suspendido, muestra el aviso y
// devuelve true (para poder hacer "if(await bloqueadoPorSuspension()) return;").

async function bloqueadoPorSuspension(){

  const activo = obtenerUsuarioActivo();
  if(!activo) return false;

  if(!(await estaSuspendido(activo.nombre))) return false;

  mostrarAvisoSuspension();
  return true;

}

function mostrarAvisoSuspension(){
  const activo = obtenerUsuarioActivo();
  const nombre = activo && activo.nombre ? activo.nombre : "tu cuenta";
  const mensaje = "La cuenta de " + nombre + " está suspendida y las acciones de comunidad permanecen bloqueadas.";

  if(window.MRModal && typeof window.MRModal.show === "function") {
    window.MRModal.show({
      title: "Cuenta suspendida",
      message: mensaje,
      icon: "🚫",
      buttonText: "Entendido"
    });
    return;
  }

  alert("🚫 Tu cuenta está suspendida.");
}




// ==============================
// BANNER DE SUSPENSIÓN + ACCESO AL PANEL EN LA NAVBAR
// ==============================
// Se ejecuta solo cuando existe un contenedor .navbar en la página
// (lo agrega navbar.js en el DOM al cargar). No pisa nada del diseño
// existente: usa las mismas clases que ya usa navbar.js.

async function _pintarBannerSuspension(){

  const activo = obtenerUsuarioActivo();
  if(!activo) return;

  const usuarioActualizado = await buscarUsuarioPorNombre(activo.nombre);
  if(!usuarioActualizado || !usuarioActualizado.suspendido) return;

  if(document.getElementById("avisoSuspension")) return;

  const motivo = usuarioActualizado.motivo_suspension || "";

  const banner = document.createElement("div");
  banner.id = "avisoSuspension";
  banner.className = "aviso-suspension";
  banner.innerHTML = `🚫 Tu cuenta está suspendida.${motivo ? " Motivo: " + motivo : ""}`;

  document.body.prepend(banner);

}

async function _pintarAccesoPanel(){

  const activo = obtenerUsuarioActivo();
  const nav = document.querySelector(".nav-links") || document.querySelector("nav");

  if(!activo || !nav) return;

  if(typeof cargarInsignias === "function"){
    await cargarInsignias(activo.nombre);
  }

  if(!tienePermiso(activo, "panelModeracion")) return;
  if(document.getElementById("enlacePanelAdmin")) return;

  const esAdmin = esAdministrador(activo);

  nav.insertAdjacentHTML("beforeend", `
    <a class="sesion-extra" id="enlacePanelAdmin" href="admin.html">
      ${esAdmin ? "🛠️ Panel Admin" : "🛡️ Moderación"}
    </a>
  `);

}

document.addEventListener("DOMContentLoaded", function(){
  _pintarBannerSuspension();
  _pintarAccesoPanel();
});

// Por si el script se carga después de que el DOM ya está listo.
if(document.readyState === "interactive" || document.readyState === "complete"){
  _pintarBannerSuspension();
  _pintarAccesoPanel();
}

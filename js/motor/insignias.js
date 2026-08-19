// ==============================
// SISTEMA DE INSIGNIAS OFICIALES - MacroReborn
// ==============================
// Insignias oficiales, asignadas manualmente (desde admin.html, o a mano
// desde la consola). Fase 1: viven en la tabla "badges" de Neon.
//
// Como medio sitio llama a obtenerInsignias()/insigniasBloqueHTML() de
// forma SINCRÓNICA dentro de bucles de render (listas de comunidad,
// ranking, comentarios...), se mantiene una caché en memoria
// (_cacheInsignias). Las páginas precargan esa caché con
// cargarInsignias()/cargarInsigniasDeVarios() antes de renderizar, y
// las funciones de siempre (obtenerInsignias, insigniasItemsHTML, etc.)
// siguen siendo sincrónicas leyendo de ahí, sin que haya que tocar cada
// lugar que ya las usaba.


// LISTA DE INSIGNIAS DISPONIBLES

const INSIGNIAS = {

  administrador:{
    id:"administrador",
    icono:"👑",
    nombre:"Administrador"
  },

  moderador:{
    id:"moderador",
    icono:"🛡️",
    nombre:"Moderador"
  },

  colaborador:{
    id:"colaborador",
    icono:"❤️",
    nombre:"Colaborador"
  }

};




// ==============================
// CACHÉ EN MEMORIA
// ==============================

const _cacheInsignias = {};

function _guardarEnCacheInsignias(nombre, lista){
  _cacheInsignias[nombre] = Array.isArray(lista) ? lista : [];
}




// ==============================
// OBTENER INSIGNIAS DE UN USUARIO (sincrónico, desde caché)
// ==============================

function obtenerInsignias(nombre){
  return _cacheInsignias[nombre] || [];
}




// ==============================
// CARGAR INSIGNIAS DESDE EL SERVIDOR
// ==============================

async function cargarInsignias(nombre){

  if(!nombre) return [];

  try{

    const respuesta = await fetch("/api/social?action=badges&username=" + encodeURIComponent(nombre));
    const datos = await respuesta.json();

    const lista = (datos && datos.success) ? datos.insignias : [];
    _guardarEnCacheInsignias(nombre, lista);
    return lista;

  }catch(error){

    console.warn("MacroReborn: no se pudieron cargar las insignias.", error);
    return _cacheInsignias[nombre] || [];

  }

}

// Trae las insignias de varios usuarios en un solo pedido (para listas:
// comunidad, ranking, amigos). Se usa antes de renderizar esas listas.

async function cargarInsigniasDeVarios(nombres){

  const unicos = [...new Set((nombres || []).filter(Boolean))];
  if(!unicos.length) return;

  try{

    const respuesta = await fetch("/api/social?action=badges&usernames=" + encodeURIComponent(unicos.join(",")));
    const datos = await respuesta.json();

    if(datos && datos.success && datos.porUsuario){
      Object.keys(datos.porUsuario).forEach(nombre=>{
        _guardarEnCacheInsignias(nombre, datos.porUsuario[nombre]);
      });
    }

  }catch(error){

    console.warn("MacroReborn: no se pudieron cargar las insignias.", error);

  }

}




// ==============================
// ASIGNAR / QUITAR INSIGNIA
// ==============================
// Pensadas para usarse desde admin.html (solo administradores) o a
// mano desde la consola.

async function asignarInsignia(nombre,id){

  if(!INSIGNIAS[id]){
    console.warn("Insignia inexistente:",id);
    return;
  }

  try{

    const activo = (window.MRSession && typeof window.MRSession.get === "function")
      ? window.MRSession.get()
      : (typeof obtenerUsuarioActivo === "function" ? obtenerUsuarioActivo() : leerJSON(localStorage.getItem("usuarioActivo") || "null"));

    await fetch("/api/social?action=badges", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: nombre,
        badgeId: id,
        assignedBy: activo ? activo.nombre : null
      })
    });

  }catch(error){

    console.warn("MacroReborn: no se pudo asignar la insignia.", error);

  }

  await cargarInsignias(nombre);

}

async function quitarInsignia(nombre,id){

  try{

    await fetch("/api/social?action=badges", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: nombre, badgeId: id })
    });

  }catch(error){

    console.warn("MacroReborn: no se pudo quitar la insignia.", error);

  }

  await cargarInsignias(nombre);

}




// ==============================
// HTML DE LAS INSIGNIAS
// ==============================
// insigniasItemsHTML(): version completa (icono + nombre), para el perfil.
// insigniasCompactasHTML(): solo el icono, para comentarios y listados
// donde el espacio es reducido.
// Si el usuario no tiene ninguna insignia, devuelven "" y no se muestra
// absolutamente nada.

function insigniasItemsHTML(nombre){

  return obtenerInsignias(nombre)
    .filter(id => INSIGNIAS[id])
    .map(id => `<span class="insignia-oficial" title="${INSIGNIAS[id].nombre}">${INSIGNIAS[id].icono} ${INSIGNIAS[id].nombre}</span>`)
    .join("");

}

function insigniasCompactasHTML(nombre){

  return obtenerInsignias(nombre)
    .filter(id => INSIGNIAS[id])
    .map(id => `<span class="insignia-oficial compacta" title="${INSIGNIAS[id].nombre}">${INSIGNIAS[id].icono}</span>`)
    .join("");

}

// Bloque listo para insertar en un template (incluye el contenedor).
// Devuelve "" si no hay insignias, para no dejar espacios vacios.

function insigniasBloqueHTML(nombre,compacta){

  const items = compacta
    ? insigniasCompactasHTML(nombre)
    : insigniasItemsHTML(nombre);

  if(!items) return "";

  return `<div class="insignias-usuario${compacta ? " compactas" : ""}">${items}</div>`;

}

// Pinta las insignias dentro de un contenedor ya existente en el DOM
// (usado en perfil.html y usuario.html, debajo del nombre). Carga los
// datos frescos del servidor y recién ahí pinta. Si no tiene
// insignias, oculta el contenedor para que no quede ningun espacio.

async function renderInsigniasEnContenedor(idContenedor,nombre,compacta){

  const contenedor = document.getElementById(idContenedor);

  if(!contenedor) return;

  await cargarInsignias(nombre);

  const items = compacta
    ? insigniasCompactasHTML(nombre)
    : insigniasItemsHTML(nombre);

  if(!items){
    contenedor.innerHTML = "";
    contenedor.style.display = "none";
    return;
  }

  contenedor.innerHTML = items;
  contenedor.style.display = "";
  contenedor.classList.toggle("compactas", !!compacta);

}

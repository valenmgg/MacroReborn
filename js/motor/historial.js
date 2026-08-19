// ==============================
// REGISTRO DE ACCIONES DE MODERACIÓN - MacroReborn (Fase 2: Neon)
// ==============================
// Guarda un historial de las acciones importantes que hacen los
// administradores y moderadores desde el panel (admin.html): quién la
// hizo, con qué rol, cuándo, sobre qué usuario y por qué. Vive en la
// tabla "moderation_log" de Neon (/api/content?action=moderation-log).
// Antes vivía en localStorage bajo una única clave global
// ("historialModeracion").
//
// "registrarAccionModeracion" sigue siendo el único punto de entrada
// que usa el panel para escribir acá (ahora async), así que admin.js
// no tuvo que cambiar su forma de llamarlo, solo agregarle "await".


// ==============================
// CATÁLOGO DE ACCIONES
// ==============================
// Un único lugar donde queda documentado cada tipo de acción que se
// puede registrar, con su ícono y su etiqueta para mostrar en el panel.
// Si el día de mañana se suma un tipo de acción nuevo, alcanza con
// agregarlo acá.

const ACCIONES_MODERACION = {

  eliminar_comentario: { icono: "🗑️", etiqueta: "Eliminó un comentario" },
  eliminar_publicacion: { icono: "🗑️", etiqueta: "Eliminó una publicación" },
  aceptar_reporte: { icono: "✅", etiqueta: "Aceptó un reporte" },
  rechazar_reporte: { icono: "👁️", etiqueta: "Rechazó un reporte" },
  advertir_usuario: { icono: "⚠️", etiqueta: "Advirtió a un usuario" },
  suspender_usuario: { icono: "🚫", etiqueta: "Suspendió a un usuario" },
  reactivar_usuario: { icono: "✅", etiqueta: "Reactivó a un usuario" },
  cambiar_rol: { icono: "🔑", etiqueta: "Cambió un rol" },
  asignar_insignia: { icono: "🏅", etiqueta: "Asignó una insignia" },
  quitar_insignia: { icono: "🏅", etiqueta: "Quitó una insignia" },
  recalcular_ranking: { icono: "🏆", etiqueta: "Recalculó el ranking a mano" },
  otra: { icono: "📌", etiqueta: "Otra acción de moderación" }

};




// ==============================
// REGISTRAR UNA ACCIÓN
// ==============================
// datos = {
//   accion: id dentro de ACCIONES_MODERACION (obligatorio),
//   usuarioAfectado: nombre del usuario afectado, o null,
//   motivo: texto libre (opcional, "No especificado" si se omite)
// }
// Quién hizo la acción y con qué rol se toman solos del usuario con
// sesión iniciada en este navegador: el panel ya exige tener permisos
// de moderación (ver js/admin.js) para poder llegar hasta acá.

async function registrarAccionModeracion(datos){

  const activo = (window.MRSession && typeof MRSession.get === "function")
    ? MRSession.get()
    : (typeof obtenerUsuarioActivo === "function"
      ? obtenerUsuarioActivo()
      : leerJSON(localStorage.getItem("usuarioActivo") || "null"));

  if(!activo || !datos || !datos.accion) return null;

  const definicion = ACCIONES_MODERACION[datos.accion] || ACCIONES_MODERACION.otra;

  const rol = (typeof esAdministrador === "function" && esAdministrador(activo))
    ? "Administrador"
    : "Moderador";

  try{

    const resp = await fetch("/api/content?action=moderation-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        moderatorUsername: activo.nombre,
        moderatorRole: rol,
        accion: datos.accion,
        usuarioAfectado: datos.usuarioAfectado || null,
        motivo: datos.motivo || ""
      })
    });

    const respuesta = await resp.json();
    if(!respuesta || !respuesta.success) return null;

    return {
      ...respuesta.entrada,
      accionEtiqueta: definicion.etiqueta,
      accionIcono: definicion.icono,
      fecha: new Date(respuesta.entrada.created_at).toLocaleString("es-AR")
    };

  }catch(error){

    console.warn("MacroReborn: no se pudo registrar la acción de moderación.", error);
    return null;

  }

}




// ==============================
// CONSULTA CON FILTROS (para el panel)
// ==============================
// filtros = { rol, accion, texto }, todos opcionales.
// Devuelve siempre del más reciente al más viejo (así las devuelve el
// servidor).

async function obtenerHistorialFiltrado(filtros){

  filtros = filtros || {};

  const params = new URLSearchParams({ action: "moderation-log" });
  if(filtros.rol) params.set("rol", filtros.rol);
  if(filtros.accion) params.set("accion", filtros.accion);
  if(filtros.texto && filtros.texto.trim()) params.set("texto", filtros.texto.trim());

  try{

    const resp = await fetch("/api/content?" + params.toString());
    const datos = await resp.json();

    if(!datos || !datos.success) return [];

    return datos.historial.map(entrada => {
      const definicion = ACCIONES_MODERACION[entrada.accion] || ACCIONES_MODERACION.otra;
      return {
        ...entrada,
        accionEtiqueta: definicion.etiqueta,
        accionIcono: definicion.icono,
        fecha: new Date(entrada.created_at).toLocaleString("es-AR")
      };
    });

  }catch(error){

    console.warn("MacroReborn: no se pudo cargar el historial de moderación.", error);
    return [];

  }

}




// ==============================
// ADVERTENCIAS DE UN USUARIO
// ==============================
// Se derivan del propio historial (no se guardan aparte) para no
// duplicar datos: una advertencia es, ni más ni menos, una entrada de
// historial con accion "advertir_usuario" sobre ese usuario.

async function obtenerAdvertenciasDe(nombre){

  const params = new URLSearchParams({ action: "moderation-log", accion: "advertir_usuario", texto: nombre });

  try{

    const resp = await fetch("/api/content?" + params.toString());
    const datos = await resp.json();
    if(!datos || !datos.success) return [];

    // El filtro "texto" del servidor busca en usuario/afectado/motivo
    // (coincidencia amplia); acá se filtra fino a que el afectado sea
    // exactamente este usuario, igual que hacía la versión anterior.
    return datos.historial.filter(entrada => entrada.usuarioAfectado === nombre);

  }catch(error){

    console.warn("MacroReborn: no se pudieron cargar las advertencias.", error);
    return [];

  }

}

async function contarAdvertenciasDe(nombre){

  return (await obtenerAdvertenciasDe(nombre)).length;

}

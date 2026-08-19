// ==============================
// SISTEMA DE REPORTES DE COMENTARIOS - MacroReborn (Fase 2: Neon)
// ==============================
// Los reportes viven en la tabla "comment_reports" de Neon
// (/api/content?action=reports). No elimina ni modifica el
// comentario/mensaje original al reportarlo: solo registra que fue
// reportado. Eliminar el comentario / ignorar el reporte son acciones
// aparte, que solo puede disparar un administrador o moderador desde
// el panel (admin.html).
//
// targetType: "comment" (profile_comments) | "chat" (chat_messages).
// Ambos ya viven en Neon, así que el propio servidor
// (/api/content?action=reports-resolve) hace el borrado real cuando
// se acepta un reporte con resolution="eliminar".


// ==============================
// REPORTAR UN COMENTARIO O MENSAJE
// ==============================
// targetType: "comment" | "chat"
// targetId: id del comentario (Neon) o del mensaje de chat.
// origen: nombre del perfil dueño del comentario, o "chatGeneral".
// contenido: el objeto {usuario, texto} del comentario/mensaje reportado.
// motivo: motivo elegido por quien reporta (texto libre, opcional).

async function reportarComentario(targetType, targetId, origen, contenido, motivo){

  const quienReporta = (window.MRSession && typeof MRSession.get === "function")
    ? MRSession.get()
    : (typeof obtenerUsuarioActivo === "function"
      ? obtenerUsuarioActivo()
      : leerJSON(localStorage.getItem("usuarioActivo") || "null"));

  try{
    await fetch("/api/content?action=reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetType,
        targetId,
        origen,
        contentUsername: contenido ? contenido.usuario : "",
        contentTexto: contenido ? contenido.texto : "",
        reportedBy: quienReporta ? quienReporta.nombre : "Anónimo",
        motivo: motivo || ""
      })
    });
  }catch(error){
    console.warn("MacroReborn: no se pudo enviar el reporte.", error);
  }
}


// ==============================
// REPORTES PENDIENTES (para el panel)
// ==============================

async function obtenerReportesPendientes(){

  try{
    const resp = await fetch("/api/content?action=reports");
    const datos = await resp.json();
    return (datos && datos.success) ? datos.reportes : [];
  }catch(error){
    console.warn("MacroReborn: no se pudieron cargar los reportes.", error);
    return [];
  }

}


// ==============================
// RESOLVER UN REPORTE (ignorar o eliminar)
// ==============================
// resolution: "ignorar" | "eliminar"
// Devuelve el resultado del servidor. Si se pidió "eliminar", el
// borrado real del contenido reportado (comentario de perfil o
// mensaje de chat) ya lo hace /api/content?action=reports-resolve del
// lado del servidor (DELETE sobre profile_comments o chat_messages,
// según el target_type del reporte); acá no queda nada por limpiar.

async function resolverReporte(idReporte, resolution){

  try{
    const resp = await fetch("/api/content?action=reports-resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportId: idReporte, resolution })
    });
    return await resp.json();
  }catch(error){
    console.warn("MacroReborn: no se pudo resolver el reporte.", error);
    return { success: false };
  }

}

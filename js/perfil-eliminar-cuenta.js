// ==============================
// PERFIL — ELIMINAR CUENTA (Fase 2: Neon, cierre de migración)
// ==============================
// Antes esta pantalla tenía que limpiar "a mano" un montón de claves
// cruzadas de localStorage (avatar_<nombre>, bio_<nombre>,
// insignias_<nombre>, logros_<nombre>, amigos_<nombre>,
// comentarios_<nombre>, favoritos_<nombre>, historial_<nombre>,
// resenas_<idJuego>, calificaciones_<idJuego>, votosJuego_<idJuego>,
// además de la propia entrada en "usuariosMacro") porque no había
// ninguna base de datos que se ocupara de eso.
//
// Ahora /api/auth?action=delete-account borra la fila del usuario en
// Neon, y las FK "ON DELETE CASCADE" de todas las migraciones (ver
// api/auth.js) se encargan solas de borrar en cascada absolutamente
// todo lo que le pertenecía: insignias, logros, amigos, comentarios,
// favoritos, historial de juegos, reseñas, calificaciones, votos,
// notificaciones, actividad, mensajes de chat, etc. Acá ya no queda
// nada para limpiar a mano salvo la caché de sesión de este navegador.

async function eliminarCuentaCompleta(nombreUsuario, password) {

  const resp = await fetch("/api/auth?action=delete-account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: password })
  });

  const datos = await resp.json();

  if (!datos || !datos.success) {
    return { ok: false, error: (datos && datos.error) || "No se pudo eliminar la cuenta." };
  }

  if (window.MRSession && typeof MRSession.clear === "function") {
    MRSession.clear();
  } else {
    localStorage.removeItem("usuarioActivo");
    localStorage.removeItem("macroSessionToken");
  }

  return { ok: true };

}


// ==============================
// BOTÓN "Eliminar cuenta" (perfil.html)
// ==============================
// El botón existe en perfil.html pero no tenía ningún listener
// enganchado en ningún archivo del sitio: hacer clic no hacía nada.
// La confirmación pide la contraseña por "prompt" (mismo criterio que
// ya usa el panel de admin para pedir el motivo de una suspensión),
// ya que la tarjeta de "zona peligrosa" no tiene un campo de
// contraseña propio.

(function () {

  const boton = document.getElementById("botonEliminarCuenta");
  if (!boton) return;

  boton.addEventListener("click", async () => {

    const activo = (window.MRSession && typeof MRSession.get === "function")
      ? MRSession.get()
      : leerJSON(localStorage.getItem("usuarioActivo") || "null");
    if (!activo) return;

    const confirmar = typeof pedirConfirmacion === "function"
      ? (mensaje, onConfirmar) => pedirConfirmacion(mensaje, onConfirmar, "🗑️ Eliminar cuenta")
      : (mensaje, onConfirmar) => { if (confirm(mensaje)) onConfirmar(); };

    confirmar(
      "Esta acción es permanente y no se puede deshacer. ¿Seguro que querés eliminar tu cuenta?",
      async () => {

        const password = prompt("Para confirmar, ingresá tu contraseña actual:");
        if (!password) return;

        boton.disabled = true;

        try {

          const resultado = await eliminarCuentaCompleta(activo.nombre, password);

          if (resultado.ok) {
            alert("Tu cuenta fue eliminada. ¡Gracias por haber jugado en MacroReborn!");
            window.location.href = "index.html";
          } else {
            alert(resultado.error);
          }

        } catch (error) {

          console.warn("MacroReborn: no se pudo eliminar la cuenta.", error);
          alert("Error de conexión. Probá de nuevo.");

        } finally {

          boton.disabled = false;

        }

      }
    );

  });

})();

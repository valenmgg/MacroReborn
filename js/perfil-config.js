// ==============================
// PERFIL — CONFIGURACIÓN DE CUENTA (Fase 2: Neon, cierre de migración)
// ==============================
// Exclusivo de perfil.html (perfil propio del usuario logueado).
// usuario.html NO carga este script, así que esta sección jamás
// aparece al ver el perfil de otra persona.
//
// El cambio de contraseña se valida y se guarda en el servidor
// (/api/users?action=change-password, tabla "users" de Neon). Antes
// comparaba la contraseña actual contra "usuarioActivo.password" en
// localStorage, un campo que el login ya no incluye desde que pasó a
// Neon (por seguridad, /api/auth nunca devuelve el password) — así
// que la validación fallaba siempre, sin importar lo que se
// escribiera.
// ==============================

(function () {

  const formPassword = document.getElementById("formCambiarPassword");

  // Si el formulario no existe en la página (por ejemplo, si este script
  // se cargara por error en usuario.html), no hacemos nada.
  if (!formPassword) return;

  const inputActual = document.getElementById("passActual");
  const inputNueva = document.getElementById("passNueva");
  const inputConfirmar = document.getElementById("passConfirmar");
  const mensaje = document.getElementById("mensajeConfigPassword");
  const boton = document.getElementById("botonGuardarPassword");

  function mostrarMensajeConfig(texto, tipo) {
    if (!mensaje) {
      alert(texto);
      return;
    }
    mensaje.textContent = texto;
    mensaje.classList.remove("error", "exito", "visible");
    void mensaje.offsetWidth; // fuerza el reinicio de la animación
    mensaje.classList.add(tipo, "visible");
  }

  formPassword.addEventListener("submit", async function (evento) {
    evento.preventDefault();

    const actual = inputActual.value;
    const nueva = inputNueva.value;
    const confirmar = inputConfirmar.value;

    const usuarioActivoActual = (window.MRSession && typeof MRSession.get === "function")
      ? MRSession.get()
      : leerJSON(localStorage.getItem("usuarioActivo") || "null");

    if (!usuarioActivoActual) {
      mostrarMensajeConfig("No se encontró una sesión activa. Iniciá sesión de nuevo.", "error");
      return;
    }

    if (!actual || !nueva || !confirmar) {
      mostrarMensajeConfig("Completá los tres campos para continuar.", "error");
      return;
    }

    if (nueva.length < 6) {
      mostrarMensajeConfig("La nueva contraseña debe tener al menos 6 caracteres.", "error");
      return;
    }

    // Comprobar que la nueva contraseña y la confirmación coincidan.
    if (nueva !== confirmar) {
      mostrarMensajeConfig("La nueva contraseña y la confirmación no coinciden.", "error");
      return;
    }

    if (nueva === actual) {
      mostrarMensajeConfig("La nueva contraseña debe ser distinta a la actual.", "error");
      return;
    }

    if (boton) boton.disabled = true;

    try {

      const resp = await fetch("/api/users?action=change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: usuarioActivoActual.nombre,
          currentPassword: actual,
          newPassword: nueva
        })
      });

      const datos = await resp.json();

      if (datos && datos.success) {
        mostrarMensajeConfig("Contraseña actualizada correctamente. ✅", "exito");
        formPassword.reset();
      } else {
        mostrarMensajeConfig((datos && datos.error) || "No se pudo actualizar la contraseña. Probá de nuevo.", "error");
      }

    } catch (error) {

      console.warn("MacroReborn: no se pudo actualizar la contraseña.", error);
      mostrarMensajeConfig("Error de conexión. Probá de nuevo.", "error");

    } finally {

      if (boton) boton.disabled = false;

    }

  });

})();

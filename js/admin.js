// ==============================
// PANEL DE ADMINISTRACIÓN - MacroReborn (Fase 2: Neon, cierre de migración)
// ==============================
// Usa el motor de permisos (js/motor/permisos.js), insignias
// (js/motor/insignias.js) y reportes (js/motor/reportes.js), todos ya
// conectados a Neon. Envuelto en un IIFE async porque el chequeo de
// acceso necesita esperar a que se precarguen las insignias del
// usuario activo (ver más abajo) antes de decidir si puede entrar.

(async function(){

  // ==============================
  // CONTROL DE ACCESO
  // ==============================

  const activoAdmin = typeof obtenerUsuarioActivo === "function"
    ? obtenerUsuarioActivo()
    : leerJSON(localStorage.getItem("usuarioActivo") || "null");

  // FIX: las insignias (administrador/moderador) viven en una caché en
  // memoria (js/motor/insignias.js) que hay que precargar con un
  // fetch antes de poder consultarla de forma sincrónica. Antes nada
  // llamaba a cargarInsignias() acá, así que tienePermiso() siempre
  // leía la caché vacía y el panel rechazaba incluso a administradores
  // legítimos.
  if(activoAdmin && typeof cargarInsignias === "function"){
    await cargarInsignias(activoAdmin.nombre);
  }

  const tieneAccesoPanel = activoAdmin &&
    typeof tienePermiso === "function" &&
    tienePermiso(activoAdmin, "panelModeracion");

  if(!tieneAccesoPanel){

    document.getElementById("accesoDenegado").style.display = "flex";
    document.getElementById("panelAdmin").style.display = "none";
    return;

  }

  document.getElementById("panelAdmin").style.display = "block";

  const esAdmin = esAdministrador(activoAdmin);

  // ---------- ENCABEZADO SEGÚN ROL ----------

  document.getElementById("adminRolBadge").textContent = esAdmin
    ? "👑 Administrador"
    : "🛡️ Moderador";

  if(!esAdmin){
    document.getElementById("adminTitulo").textContent = "🛡️ Panel de Moderación";
    document.getElementById("adminSubtitulo").textContent =
      "Revisá reportes de la comunidad y suspendé usuarios cuando sea necesario.";
  }

  // ---------- PESTAÑAS ----------
  // El moderador solo tiene acceso a Reportes: las funciones
  // exclusivas del administrador (usuarios, insignias, estadísticas)
  // quedan directamente ocultas, no solo deshabilitadas.

  if(!esAdmin){
    document.getElementById("botonTabUsuarios").remove();
    document.getElementById("botonTabEstadisticas").remove();
    document.getElementById("botonTabRegistro").remove();
    document.getElementById("tabUsuarios").remove();
    document.getElementById("tabEstadisticas").remove();
    document.getElementById("tabRegistro").remove();

    document.getElementById("botonTabReportes").classList.add("activa");
    document.getElementById("tabReportes").classList.add("activo");
  }

  document.querySelectorAll(".menu-perfil .tab").forEach(boton=>{
    boton.addEventListener("click", ()=>{
      document.querySelectorAll(".menu-perfil .tab").forEach(b=>b.classList.remove("activa"));
      document.querySelectorAll(".contenido-tab").forEach(c=>c.classList.remove("activo"));
      boton.classList.add("activa");
      document.getElementById(boton.dataset.tab).classList.add("activo");
    });
  });


  // ==============================
  // ADVERTIR USUARIO (administrador y moderador)
  // ==============================
  // Manda una notificación directa al usuario (POST a
  // /api/content?action=notifications, sin depender de que
  // js/notificaciones.js esté cargado en esta página) y registra la
  // acción en el historial de moderación. Pide el motivo con
  // "prompt", igual que ya hace el sitio para reportar comentarios
  // (js/perfil.js).

  async function advertirUsuario(nombre){

    const mensaje = prompt(`¿Por qué advertís a ${nombre}? Este texto se le va a mostrar como notificación.`);
    if(mensaje === null) return false; // canceló el prompt

    const motivo = mensaje.trim() || "No especificado";

    fetch("/api/content?action=notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: nombre,
        titulo: "⚠️ Advertencia de la moderación",
        mensaje: motivo
      })
    }).catch(error=>{
      console.warn("MacroReborn: no se pudo enviar la notificación de advertencia.", error);
    });

    await registrarAccionModeracion({
      accion: "advertir_usuario",
      usuarioAfectado: nombre,
      motivo: motivo
    });

    alert(`Advertencia enviada a ${nombre}.`);
    return true;

  }


  // ==============================
  // USUARIOS (solo administrador)
  // ==============================
  // Se declaran acá afuera (aunque solo se completan si es admin) para
  // poder llamarlas de forma segura desde la pestaña de Reportes, que
  // sí ve tanto el administrador como el moderador.

  let renderUsuariosAdmin = null;
  let renderEstadisticas = null;
  let renderHistorialModeracion = null;

  if(esAdmin){

    function chipEstadoCuenta(usuario){
      return usuario.suspendido
        ? `<span class="chip-estado chip-suspendido">🚫 Suspendido</span>`
        : `<span class="chip-estado chip-activo">🟢 Activo</span>`;
    }

    // Roles (administrador / moderador) van marcados con data-rol="1"
    // para poder pedir confirmación aparte y registrarlos como
    // "cambiar_rol" en vez de "asignar/quitar_insignia" en el historial.
    // Las insignias de cada usuario salen de la caché de
    // js/motor/insignias.js (tabla "badges" de Neon): hay que haber
    // llamado a cargarInsigniasDeVarios() antes de renderizar (ver
    // renderUsuariosAdmin más abajo).
    function botonesInsigniaUsuario(usuario){
      return Object.values(INSIGNIAS).map(insignia=>{
        const tiene = obtenerInsignias(usuario.username).includes(insignia.id);
        const esRol = insignia.id === ROLES.ADMINISTRADOR || insignia.id === ROLES.MODERADOR;
        return `
          <button
            class="btn-insignia-toggle ${tiene ? "activa-insignia" : ""}"
            data-usuario="${MRTexto.escapar(usuario.username)}"
            data-insignia="${insignia.id}"
            data-rol="${esRol ? "1" : "0"}"
            title="${tiene ? "Quitar" : "Asignar"} ${insignia.nombre}"
          >${insignia.icono} ${insignia.nombre}</button>
        `;
      }).join("");
    }

    renderUsuariosAdmin = async function(filtro){

      const contenedor = document.getElementById("listaUsuariosAdmin");
      const contador = document.getElementById("contadorUsuariosAdmin");

      let usuarios = await obtenerUsuarios();

      if(filtro && filtro.trim()){
        const texto = filtro.trim().toLowerCase();
        usuarios = usuarios.filter(u => u.username.toLowerCase().includes(texto));
      }

      contador.textContent = `${usuarios.length} usuario${usuarios.length === 1 ? "" : "s"}`;

      if(usuarios.length === 0){
        contenedor.innerHTML = `<div class="estado-vacio"><span class="icono-vacio">🕹️</span><p>No se encontraron usuarios.</p></div>`;
        return;
      }

      // Precarga en lote: insignias (para pintar los botones) y
      // cantidad de advertencias (para el chip), un solo pedido por
      // tipo en vez de uno por usuario dentro del map().
      await cargarInsigniasDeVarios(usuarios.map(u => u.username));

      const posiciones = {};
      const advertenciasPorUsuario = {};

      await Promise.all(usuarios.map(async usuario => {
        posiciones[usuario.username] = typeof obtenerPosicionRanking === "function"
          ? await obtenerPosicionRanking(usuario.username)
          : null;
        advertenciasPorUsuario[usuario.username] = typeof contarAdvertenciasDe === "function"
          ? await contarAdvertenciasDe(usuario.username)
          : 0;
      }));

      contenedor.innerHTML = usuarios.map(usuario=>{

        const ranking = posiciones[usuario.username];
        const esUnoMismo = usuario.username === activoAdmin.nombre;
        const advertencias = advertenciasPorUsuario[usuario.username] || 0;

        return `
          <div class="admin-tarjeta-usuario">

            <div class="admin-tarjeta-cabecera">
              <h3>${MRTexto.escapar(usuario.username)}</h3>
              ${chipEstadoCuenta(usuario)}
            </div>

            ${typeof insigniasBloqueHTML === "function" ? insigniasBloqueHTML(usuario.username, false) : ""}

            <div class="admin-tarjeta-stats">
              <span>⭐ Nivel ${usuario.level || 1}</span>
              <span>⚡ ${usuario.xp || 0} XP</span>
              <span>🏆 ${ranking ? "#" + ranking : "Sin clasificar"}</span>
              ${advertencias > 0 ? `<span class="chip-advertencias">⚠️ ${advertencias} advertencia${advertencias === 1 ? "" : "s"}</span>` : ""}
            </div>

            <div class="admin-tarjeta-insignias-acciones">
              ${botonesInsigniaUsuario(usuario)}
            </div>

            <div class="admin-tarjeta-acciones">
              <button class="btn-advertir" data-usuario="${MRTexto.escapar(usuario.username)}" ${esUnoMismo ? "disabled title=\"No podés advertirte a vos mismo\"" : ""}>⚠️ Advertir usuario</button>
              ${usuario.suspendido
                ? `<button class="btn-reactivar" data-usuario="${MRTexto.escapar(usuario.username)}">✅ Reactivar usuario</button>`
                : `<button class="btn-suspender" data-usuario="${MRTexto.escapar(usuario.username)}" ${esUnoMismo ? "disabled title=\"No podés suspender tu propia cuenta\"" : ""}>🚫 Suspender usuario</button>`
              }
            </div>

          </div>
        `;

      }).join("");

      // EVENTOS: insignias / roles
      contenedor.querySelectorAll(".btn-insignia-toggle").forEach(btn=>{
        btn.addEventListener("click", async ()=>{
          const nombre = btn.dataset.usuario;
          const idInsignia = btn.dataset.insignia;
          const esRol = btn.dataset.rol === "1";
          const actuales = obtenerInsignias(nombre);
          const laTiene = actuales.includes(idInsignia);
          const nombreInsignia = INSIGNIAS[idInsignia] ? INSIGNIAS[idInsignia].nombre : idInsignia;

          // Cambiar un rol (administrador/moderador) es más sensible
          // que una insignia cosmética: se pide confirmación aparte.
          if(esRol){
            const pregunta = laTiene
              ? `¿Quitarle el rol de ${nombreInsignia} a ${nombre}?`
              : `¿Convertir a ${nombre} en ${nombreInsignia}?`;
            if(!confirm(pregunta)) return;
          }

          if(laTiene){
            await quitarInsignia(nombre, idInsignia);
          }else{
            await asignarInsignia(nombre, idInsignia);
          }

          await registrarAccionModeracion({
            accion: esRol ? "cambiar_rol" : (laTiene ? "quitar_insignia" : "asignar_insignia"),
            usuarioAfectado: nombre,
            motivo: `${laTiene ? "Quitó" : "Asignó"} ${nombreInsignia}`
          });

          await renderUsuariosAdmin(document.getElementById("buscadorUsuariosAdmin").value);
          await renderEstadisticas();
          await renderHistorialModeracion();
        });
      });

      // EVENTOS: advertir
      contenedor.querySelectorAll(".btn-advertir").forEach(btn=>{
        btn.addEventListener("click", async ()=>{
          if(btn.disabled) return;
          if(!(await advertirUsuario(btn.dataset.usuario))) return;
          await renderUsuariosAdmin(document.getElementById("buscadorUsuariosAdmin").value);
          await renderHistorialModeracion();
        });
      });

      // EVENTOS: suspender
      contenedor.querySelectorAll(".btn-suspender").forEach(btn=>{
        btn.addEventListener("click", async ()=>{
          if(btn.disabled) return;
          const nombre = btn.dataset.usuario;
          if(!confirm(`¿Suspender a ${nombre}? No podrá comentar, mandar mensajes ni usar la comunidad.`)) return;
          const motivo = prompt(`¿Por qué suspendés a ${nombre}? (opcional)`) || "";
          await suspenderUsuario(nombre, motivo);
          await registrarAccionModeracion({
            accion: "suspender_usuario",
            usuarioAfectado: nombre,
            motivo: motivo
          });
          await renderUsuariosAdmin(document.getElementById("buscadorUsuariosAdmin").value);
          await renderEstadisticas();
          await renderHistorialModeracion();
        });
      });

      // EVENTOS: reactivar
      contenedor.querySelectorAll(".btn-reactivar").forEach(btn=>{
        btn.addEventListener("click", async ()=>{
          const nombre = btn.dataset.usuario;
          await reactivarUsuario(nombre);
          await registrarAccionModeracion({
            accion: "reactivar_usuario",
            usuarioAfectado: nombre
          });
          await renderUsuariosAdmin(document.getElementById("buscadorUsuariosAdmin").value);
          await renderEstadisticas();
          await renderHistorialModeracion();
        });
      });

    }

    document.getElementById("buscadorUsuariosAdmin")?.addEventListener("input", (e)=>{
      renderUsuariosAdmin(e.target.value);
    });

    await renderUsuariosAdmin("");


    // ==============================
    // ESTADÍSTICAS (solo administrador)
    // ==============================
    // Los números se calculan en js/motor/panelEstadisticas.js
    // (obtenerEstadisticasAdmin, ahora async: pide los agregados a
    // Neon en vez de recorrer localStorage); acá solo se pintan en
    // el DOM.

    // Todo escapado: en los tops de nivel y XP el nombre es el de una
    // cuenta, y en los de logros, insignias y juegos puede ser el id
    // crudo que haya en la base. Y esto se pinta en el navegador de un
    // administrador. Ver el punto 77 de docs/AUDITORIA.md.
    function _filaTop(item, unidad){
      const valor = item.valor !== undefined ? item.valor : item.veces;
      return `<li><span class="admin-top-nombre">${MRTexto.escapar(item.nombre)}</span><span class="admin-top-valor">${MRTexto.escapar(String(valor) + (unidad || ""))}</span></li>`;
    }

    function _pintarLista(idLista, items, vacio, unidad){
      const contenedor = document.getElementById(idLista);
      if(!contenedor) return;
      contenedor.innerHTML = items.length
        ? items.map(item => _filaTop(item, unidad)).join("")
        : `<li class="admin-top-vacio">${vacio}</li>`;
    }

    renderEstadisticas = async function(){

      const datos = typeof obtenerEstadisticasAdmin === "function"
        ? await obtenerEstadisticasAdmin()
        : null;

      if(!datos) return;

      // ---------- ROLES / MODERACIÓN ----------
      document.getElementById("statUsuarios").textContent = datos.usuarios.total;
      document.getElementById("statSuspendidos").textContent = datos.usuarios.suspendidos;
      document.getElementById("statAdmins").textContent = datos.roles.administradores;
      document.getElementById("statModeradores").textContent = datos.roles.moderadores;
      document.getElementById("statColaboradores").textContent = datos.roles.colaboradores;
      document.getElementById("statReportesPendientes").textContent = datos.comunidad.reportesPendientes;

      // ---------- 👥 USUARIOS ----------
      document.getElementById("statUsuariosTotal").textContent = datos.usuarios.total;
      document.getElementById("statUsuariosActivos").textContent = datos.usuarios.activos7dias;
      document.getElementById("statUsuariosNuevos").textContent = datos.usuarios.nuevos30dias;
      document.getElementById("statUsuariosConectados").textContent =
        datos.usuarios.conectadosAhora !== null ? datos.usuarios.conectadosAhora : "—";

      // ---------- 🎮 JUEGOS ----------
      document.getElementById("statJuegosTotal").textContent = datos.juegos.totalDisponibles;
      _pintarLista("listaJuegosMasJugados", datos.juegos.masJugados, "Todavía no se jugó ningún juego.", " veces");
      _pintarLista("listaJuegosFavoritos", datos.juegos.favoritos, "Todavía no hay favoritos.", " veces");

      // ---------- 💬 COMUNIDAD ----------
      document.getElementById("statComentarios").textContent = datos.comunidad.comentarios;
      document.getElementById("statMensajesChat").textContent = datos.comunidad.mensajesChat;
      document.getElementById("statAmigos").textContent = datos.comunidad.amigos;
      document.getElementById("statReportesTotales").textContent = datos.comunidad.reportesTotales;

      // ---------- 🏆 PROGRESO ----------
      _pintarLista("listaTopNivel", datos.progreso.topNivel.map(u => ({ nombre: u.nombre, valor: "Nivel " + u.valor })), "Sin datos todavía.");
      _pintarLista("listaTopXP", datos.progreso.topXP.map(u => ({ nombre: u.nombre, valor: u.valor + " XP" })), "Sin datos todavía.");
      _pintarLista("listaTopLogros", datos.progreso.logrosTop.map(l => ({ nombre: `${l.icono} ${l.nombre}`, veces: l.veces })), "Todavía no se desbloqueó ningún logro.", " veces");
      _pintarLista("listaTopInsignias", datos.progreso.insigniasTop.map(i => ({ nombre: `${i.icono} ${i.nombre}`, veces: i.veces })), "Todavía no se otorgó ninguna insignia.", " veces");

    }

    await renderEstadisticas();


    // ==============================
    // RANKING SEMANAL - RECALCULAR A MANO (solo administrador)
    // ==============================
    // Dispara el mismo cálculo que corre solo todos los lunes a las
    // 5:00 (ver api/system.js -> recalcularRanking()), pero a pedido,
    // vía POST /api/system?action=recalcular-ranking-manual. El
    // servidor verifica de nuevo (con la insignia de administrador en
    // Neon) que quien lo pide puede hacerlo, no confía solo en que
    // este botón esté oculto para moderadores/usuarios comunes.

    const botonRecalcularRanking = document.getElementById("botonRecalcularRanking");
    const estadoRecalcularRanking = document.getElementById("estadoRecalcularRanking");

    botonRecalcularRanking?.addEventListener("click", async () => {

      const confirmar = confirm(
        "¿Recalcular el ranking ahora? Esto va a actualizar la posición de todos los usuarios."
      );
      if (!confirmar) return;

      botonRecalcularRanking.disabled = true;
      botonRecalcularRanking.textContent = "⏳ Recalculando...";
      estadoRecalcularRanking.textContent = "";
      estadoRecalcularRanking.className = "admin-ranking-estado";

      try {

        const resp = await fetch("/api/system?action=recalcular-ranking-manual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: activoAdmin.nombre })
        });

        const datos = await resp.json();

        if (!datos || !datos.success) {
          estadoRecalcularRanking.textContent = "❌ " + (datos?.error || "No se pudo recalcular el ranking.");
          estadoRecalcularRanking.classList.add("admin-ranking-error");
          return;
        }

        const fechaSemana = new Date(datos.semana + "T00:00:00").toLocaleDateString("es-AR");

        estadoRecalcularRanking.textContent =
          `✅ Listo. Se actualizaron ${datos.usuariosActualizados} usuarios (semana del ${fechaSemana}).`;
        estadoRecalcularRanking.classList.add("admin-ranking-ok");

        await registrarAccionModeracion({
          accion: "recalcular_ranking",
          usuarioAfectado: null,
          motivo: `Semana del ${fechaSemana} · ${datos.usuariosActualizados} usuarios actualizados`
        });

        if (typeof renderHistorialModeracion === "function") {
          await renderHistorialModeracion();
        }

      } catch (error) {

        console.warn("MacroReborn: no se pudo recalcular el ranking.", error);
        estadoRecalcularRanking.textContent = "❌ No se pudo recalcular el ranking.";
        estadoRecalcularRanking.classList.add("admin-ranking-error");

      } finally {

        botonRecalcularRanking.disabled = false;
        botonRecalcularRanking.textContent = "🔄 Recalcular ranking ahora";

      }

    });


    // ==============================
    // REGISTRO DE ACCIONES DE MODERADORES (solo administrador)
    // ==============================
    // Usa js/motor/historial.js (registrarAccionModeracion ya se llama
    // desde cada acción del panel). Acá solo se arman los filtros y se
    // pinta la lista.

    const selectAccionHistorial = document.getElementById("filtroAccionHistorial");

    if(selectAccionHistorial && typeof ACCIONES_MODERACION === "object"){
      Object.keys(ACCIONES_MODERACION).forEach(id=>{
        const opcion = document.createElement("option");
        opcion.value = id;
        opcion.textContent = `${ACCIONES_MODERACION[id].icono} ${ACCIONES_MODERACION[id].etiqueta}`;
        selectAccionHistorial.appendChild(opcion);
      });
    }

    renderHistorialModeracion = async function(){

      const contenedor = document.getElementById("listaHistorialModeracion");
      const contador = document.getElementById("contadorHistorial");
      if(!contenedor) return;

      const filtros = {
        rol: document.getElementById("filtroRolHistorial")?.value || "",
        accion: document.getElementById("filtroAccionHistorial")?.value || "",
        texto: document.getElementById("buscadorHistorial")?.value || ""
      };

      const entradas = typeof obtenerHistorialFiltrado === "function"
        ? await obtenerHistorialFiltrado(filtros)
        : [];

      if(contador){
        contador.textContent = `${entradas.length} acción${entradas.length === 1 ? "" : "es"}`;
      }

      if(entradas.length === 0){
        contenedor.innerHTML = `<div class="estado-vacio"><span class="icono-vacio">🗒️</span><p>No hay acciones registradas todavía.</p></div>`;
        return;
      }

      contenedor.innerHTML = entradas.map(entrada => `
        <div class="admin-tarjeta-historial">

          <div class="admin-historial-cabecera">
            <span class="admin-historial-accion">${MRTexto.escapar(entrada.accionIcono)} ${MRTexto.escapar(entrada.accionEtiqueta)}</span>
            <span class="chip-rol ${entrada.rol === "Administrador" ? "chip-rol-admin" : "chip-rol-moderador"}">
              ${entrada.rol === "Administrador" ? "👑" : "🛡️"} ${MRTexto.escapar(entrada.rol)}
            </span>
          </div>

          <div class="admin-historial-datos">
            <span><b>Hecho por:</b> ${MRTexto.escapar(entrada.usuario)}</span>
            ${entrada.usuarioAfectado ? `<span><b>Usuario afectado:</b> ${MRTexto.escapar(entrada.usuarioAfectado)}</span>` : ""}
            <span><b>Motivo:</b> ${MRTexto.escapar(entrada.motivo)}</span>
            <span><b>Fecha:</b> ${MRTexto.escapar(entrada.fecha)}</span>
          </div>

        </div>
      `).join("");

    }

    document.getElementById("buscadorHistorial")?.addEventListener("input", renderHistorialModeracion);
    document.getElementById("filtroRolHistorial")?.addEventListener("change", renderHistorialModeracion);
    document.getElementById("filtroAccionHistorial")?.addEventListener("change", renderHistorialModeracion);

    await renderHistorialModeracion();

  }


  // ==============================
  // REPORTES (administrador y moderador)
  // ==============================

  let _reportesCacheAdmin = [];

  async function renderReportesAdmin(){

    const contenedor = document.getElementById("listaReportesAdmin");
    const pendientes = (await obtenerReportesPendientes()).slice(); // ya vienen del más nuevo al más viejo
    _reportesCacheAdmin = pendientes;

    if(pendientes.length === 0){
      contenedor.innerHTML = `<div class="estado-vacio"><span class="icono-vacio">✅</span><p>No hay reportes pendientes por ahora.</p></div>`;
      return;
    }

    // Un solo pedido con todos los autores en vez de uno por reporte.
    const listaUsuarios = await obtenerUsuarios();
    const mapaUsuarios = {};
    listaUsuarios.forEach(u => { mapaUsuarios[u.username] = u; });

    contenedor.innerHTML = pendientes.map(reporte=>{

      const autor = mapaUsuarios[reporte.usuario] || null;
      const autorSuspendido = autor && autor.suspendido;
      const esChat = reporte.origen === "chatGeneral";
      const origen = esChat
        ? "💬 Chat general"
        : `👤 Perfil de ${MRTexto.escapar(reporte.origen)}`;
      const fecha = new Date(reporte.created_at).toLocaleString("es-AR");

      return `
        <div class="admin-tarjeta-reporte">

          <div class="admin-reporte-origen">${origen} · ${fecha}</div>

          <p class="admin-reporte-texto">"${MRTexto.escapar(reporte.texto)}"</p>

          <div class="admin-reporte-datos">
            <span><b>Autor:</b> ${MRTexto.escapar(reporte.usuario || "Desconocido")}</span>
            <span><b>Reportado por:</b> ${MRTexto.escapar(reporte.reportadoPor)}</span>
            <span><b>Motivo:</b> ${MRTexto.escapar(reporte.motivo)}</span>
          </div>

          <div class="admin-tarjeta-acciones">
            <button class="btn-ignorar-reporte" data-id="${reporte.id}">👁️ Ignorar</button>
            <button class="btn-eliminar-reporte" data-id="${reporte.id}" data-origen="${esChat ? "comentario" : "publicacion"}">🗑️ Eliminar ${esChat ? "comentario" : "publicación"}</button>
            ${autor
              ? `
                <button class="btn-advertir" data-usuario="${MRTexto.escapar(reporte.usuario)}">⚠️ Advertir autor</button>
                ${autorSuspendido
                  ? `<button class="btn-reactivar" data-usuario="${MRTexto.escapar(reporte.usuario)}">✅ Reactivar autor</button>`
                  : `<button class="btn-suspender" data-usuario="${MRTexto.escapar(reporte.usuario)}">🚫 Suspender autor</button>`}
              `
              : ""
            }
          </div>

        </div>
      `;

    }).join("");

    contenedor.querySelectorAll(".btn-ignorar-reporte").forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        const reporte = _reportesCacheAdmin.find(r => String(r.id) === btn.dataset.id);
        await resolverReporte(btn.dataset.id, "ignorar");
        await registrarAccionModeracion({
          accion: "rechazar_reporte",
          usuarioAfectado: reporte ? reporte.usuario : null,
          motivo: reporte ? `Reporte ignorado (motivo original: ${reporte.motivo})` : ""
        });
        await renderReportesAdmin();
        if(esAdmin){
          await renderEstadisticas();
          await renderHistorialModeracion();
        }
      });
    });

    contenedor.querySelectorAll(".btn-eliminar-reporte").forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        const esPublicacion = btn.dataset.origen === "publicacion";
        if(!confirm(`¿Eliminar ${esPublicacion ? "esta publicación" : "este comentario"}? Esta acción no se puede deshacer.`)) return;
        const reporte = _reportesCacheAdmin.find(r => String(r.id) === btn.dataset.id);
        await resolverReporte(btn.dataset.id, "eliminar");
        await registrarAccionModeracion({
          accion: "aceptar_reporte",
          usuarioAfectado: reporte ? reporte.usuario : null,
          motivo: reporte ? `Se eliminó ${esPublicacion ? "la publicación" : "el comentario"} (motivo del reporte: ${reporte.motivo})` : ""
        });
        await renderReportesAdmin();
        if(esAdmin){
          await renderEstadisticas();
          await renderHistorialModeracion();
        }
      });
    });

    contenedor.querySelectorAll(".btn-advertir").forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        if(!(await advertirUsuario(btn.dataset.usuario))) return;
        await renderReportesAdmin();
        if(esAdmin){
          await renderUsuariosAdmin(document.getElementById("buscadorUsuariosAdmin").value);
          await renderHistorialModeracion();
        }
      });
    });

    contenedor.querySelectorAll(".btn-suspender").forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        const nombre = btn.dataset.usuario;
        if(!confirm(`¿Suspender a ${nombre}? No podrá comentar, mandar mensajes ni usar la comunidad.`)) return;
        const motivo = prompt(`¿Por qué suspendés a ${nombre}? (opcional)`) || "";
        await suspenderUsuario(nombre, motivo);
        await registrarAccionModeracion({
          accion: "suspender_usuario",
          usuarioAfectado: nombre,
          motivo: motivo
        });
        await renderReportesAdmin();
        if(esAdmin){
          await renderUsuariosAdmin(document.getElementById("buscadorUsuariosAdmin").value);
          await renderEstadisticas();
          await renderHistorialModeracion();
        }
      });
    });

    contenedor.querySelectorAll(".btn-reactivar").forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        const nombre = btn.dataset.usuario;
        await reactivarUsuario(nombre);
        await registrarAccionModeracion({
          accion: "reactivar_usuario",
          usuarioAfectado: nombre
        });
        await renderReportesAdmin();
        if(esAdmin){
          await renderUsuariosAdmin(document.getElementById("buscadorUsuariosAdmin").value);
          await renderEstadisticas();
          await renderHistorialModeracion();
        }
      });
    });

  }

  await renderReportesAdmin();

})();

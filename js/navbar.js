// ==============================
// NAVBAR - MacroReborn
// ==============================

const nav = document.querySelector(".nav-links") || document.querySelector("nav");

const usuarioNav = leerJSON(
    localStorage.getItem("usuarioActivo") || "null"
);

// ---------- ESTILOS DEL DESPLEGABLE DE NOTIFICACIONES ----------
// Se inyectan una sola vez desde acá, así el desplegable funciona en
// cualquier página sin tener que agregar un <link> nuevo a cada HTML
// (mismos colores que ya usa notificaciones.html).

function _inyectarEstilosNotifDropdown(){

    if(document.getElementById("estilosNotifDropdown")) return;

    const estilo = document.createElement("style");
    estilo.id = "estilosNotifDropdown";
    estilo.textContent = `
        .notif-bell-wrap{ position: relative; display: inline-flex; }
        .notif-bell-boton{ background: none; border: none; font: inherit; cursor: pointer; padding: 0; color: var(--text-main); }
        .notif-dropdown{
            position: absolute; top: calc(100% + 10px); right: 0;
            width: 320px; max-width: 88vw;
            background: #111c33; border: 1px solid rgba(148,163,184,0.18);
            border-radius: 12px; box-shadow: 0 16px 40px rgba(0,0,0,0.35);
            opacity: 0; transform: translateY(-6px); pointer-events: none;
            transition: opacity .15s ease, transform .15s ease;
            z-index: 200; overflow: hidden; text-align: left;
        }
        .notif-dropdown.abierto{ opacity: 1; transform: translateY(0); pointer-events: auto; }
        .notif-dropdown-header{
            display: flex; align-items: center; justify-content: space-between;
            padding: 12px 14px; border-bottom: 1px solid rgba(148,163,184,0.15);
            font-size: 13px; font-weight: 700; color: #f1f5f9;
        }
        .notif-dropdown-lista{ max-height: 320px; overflow-y: auto; }
        .notif-dropdown-item{ padding: 10px 14px; border-bottom: 1px solid rgba(148,163,184,0.1); }
        .notif-dropdown-item:last-child{ border-bottom: none; }
        .notif-dropdown-item.no-leida{ background: rgba(99,102,241,0.1); }
        .notif-dropdown-item h4{ margin: 0 0 3px; font-size: 12.5px; font-weight: 700; color: #f1f5f9; }
        .notif-dropdown-item p{ margin: 0 0 4px; font-size: 11.5px; color: #cbd5e1; line-height: 1.4; }
        .notif-dropdown-item span{ font-size: 10.5px; color: #64748b; }
        .notif-dropdown-vacio{ padding: 28px 14px; text-align: center; font-size: 12.5px; color: #94a3b8; }
        .notif-dropdown-footer{ padding: 10px 14px; text-align: center; border-top: 1px solid rgba(148,163,184,0.15); }
        .notif-dropdown-footer a{ font-size: 12px; font-weight: 600; color: #93c5fd; text-decoration: none; }
        .notif-dropdown-footer a:hover{ text-decoration: underline; }
    `;
    document.head.appendChild(estilo);
}

if(nav){

    // Evitar duplicados
    document.querySelectorAll(".sesion-extra")
    .forEach(e=>e.remove());
    document.querySelectorAll(".notif-bell-wrap")
    .forEach(e=>e.remove());

    if(usuarioNav){

        _inyectarEstilosNotifDropdown();

        nav.insertAdjacentHTML("beforeend",`

            <a class="sesion-extra nav-ayuda" href="chat.html" title="¿Necesitás ayuda? Preguntá en el chat">❔</a>

            <span class="nav-monedas" id="navMonedas" title="Tus monedas"></span>

            <div class="notif-bell-wrap" id="notifBellWrap">
                <button type="button" class="sesion-extra notif-bell-boton" id="botonNotificaciones" aria-haspopup="true" aria-expanded="false">
                    🔔 <span id="contadorNotificaciones"></span>
                </button>
                <div class="notif-dropdown" id="notifDropdown">
                    <div class="notif-dropdown-header">
                        <span>Notificaciones</span>
                    </div>
                    <div class="notif-dropdown-lista" id="notifDropdownLista">
                        <div class="notif-dropdown-vacio">Cargando...</div>
                    </div>
                    <div class="notif-dropdown-footer">
                        <a href="notificaciones.html">Ver todas las notificaciones</a>
                    </div>
                </div>
            </div>

            <div class="user-guest-wrap" id="userMenuWrap">
                <button type="button" class="sesion-extra user-guest-boton" id="botonUsuarioMenu" aria-haspopup="true" aria-expanded="false">
                    <span class="user-guest-avatar">👤</span>
                    <span class="user-guest-nombre">${usuarioNav.nombre}</span>
                </button>

                <div class="user-guest-dropdown" id="dropdownUsuarioMenu">
                    <div class="user-guest-dropdown-header">${usuarioNav.nombre}</div>

                    <div class="user-menu-lista">
                        <a href="perfil.html">🏠 Home</a>
                        <a href="perfil.html#actividad-amigos">👥 Actividad de amigos</a>
                        <a href="perfil.html#actividad">📜 Actividad reciente</a>
                        <a href="perfil.html#comentarios">💬 Comentarios</a>
                        <a href="perfil.html#favoritos">❤️ Favoritos</a>
                        <a href="perfil.html#ultimos">🎮 Últimos jugados</a>
                        <a href="perfil.html#amigos">🤝 Amigos</a>
                        <a href="perfil.html#logros">🏅 Logros</a>
                    </div>

                    <div class="user-guest-dropdown-footer">
                        <a href="#" id="cerrarSesion">🚪 Cerrar sesión</a>
                    </div>
                </div>
            </div>

        `);

        // ---------- DESPLEGABLE DEL MENÚ DE USUARIO (perfil) ----------
        // Mismo patrón que el desplegable de "Usuario temporal" (invitado)
        // y el de notificaciones: togglea al tocar el botón, se cierra al
        // hacer click afuera o al apretar Escape.

        const botonUsuarioMenu = document.getElementById("botonUsuarioMenu");
        const dropdownUsuarioMenu = document.getElementById("dropdownUsuarioMenu");

        function cerrarDropdownUsuarioMenu(){
            if(!dropdownUsuarioMenu) return;
            dropdownUsuarioMenu.classList.remove("abierto");
            if(botonUsuarioMenu) botonUsuarioMenu.setAttribute("aria-expanded", "false");
        }

        function abrirDropdownUsuarioMenu(){
            if(!dropdownUsuarioMenu) return;
            dropdownUsuarioMenu.classList.add("abierto");
            if(botonUsuarioMenu) botonUsuarioMenu.setAttribute("aria-expanded", "true");
        }

        if(botonUsuarioMenu && dropdownUsuarioMenu){

            botonUsuarioMenu.addEventListener("click", (e)=>{
                e.stopPropagation();
                dropdownUsuarioMenu.classList.contains("abierto")
                    ? cerrarDropdownUsuarioMenu()
                    : abrirDropdownUsuarioMenu();
            });

            document.addEventListener("click", (e)=>{
                if(!dropdownUsuarioMenu.classList.contains("abierto")) return;
                if(e.target.closest("#userMenuWrap")) return;
                cerrarDropdownUsuarioMenu();
            });

            document.addEventListener("keydown", (e)=>{
                if(e.key === "Escape") cerrarDropdownUsuarioMenu();
            });

        }

        // Monedas del usuario (mismo saldo que se gasta en el Centro de
        // avatares de comunidad-ranking.html). Se reusa ese mismo
        // endpoint porque ya devuelve el saldo actual; no hace falta
        // pedir nada nuevo al servidor solo para mostrar el numerito acá.
        fetch("/api/content?action=avatar-shop&username=" + encodeURIComponent(usuarioNav.nombre))
            .then(resp => resp.json())
            .then(datos => {
                if(!datos || !datos.success) return;
                const spanMonedas = document.getElementById("navMonedas");
                if(spanMonedas) spanMonedas.textContent = "🪙 " + (datos.monedas != null ? datos.monedas : 0);
            })
            .catch(error => {
                console.warn("MacroReborn: no se pudo cargar el saldo de monedas.", error);
            });

        // Contador de notificaciones (Neon)
        fetch("/api/content?action=notifications&username=" + encodeURIComponent(usuarioNav.nombre))
            .then(resp => resp.json())
            .then(datos => {
                if(!datos || !datos.success) return;
                const sinLeer = datos.notificaciones.filter(n => !n.leida).length;
                const span = document.getElementById("contadorNotificaciones");
                if(span) span.textContent = sinLeer > 0 ? sinLeer : "";
            })
            .catch(error => {
                console.warn("MacroReborn: no se pudo cargar el contador de notificaciones.", error);
            });

        // ---------- DESPLEGABLE DE NOTIFICACIONES ----------

        const botonNotif = document.getElementById("botonNotificaciones");
        const dropdownNotif = document.getElementById("notifDropdown");

        function cerrarDropdownNotif(){
            if(!dropdownNotif) return;
            dropdownNotif.classList.remove("abierto");
            if(botonNotif) botonNotif.setAttribute("aria-expanded", "false");
        }

        function abrirDropdownNotif(){
            if(!dropdownNotif) return;
            dropdownNotif.classList.add("abierto");
            if(botonNotif) botonNotif.setAttribute("aria-expanded", "true");

            // renderNotificacionesDropdown() vive en js/notificaciones.js.
            // Se llama acá (recién al abrir) y no antes, porque ese
            // script corre antes de que este botón exista en el DOM.
            if(typeof renderNotificacionesDropdown === "function"){
                renderNotificacionesDropdown();
            }

            // Al abrir la campanita, se marcan todas las notificaciones
            // como leídas (mismo endpoint que ya usa el botón "Marcar
            // leídas" de notificaciones.html). El contador se vacía al
            // toque para que se sienta instantáneo, sin esperar la
            // respuesta del servidor.
            const span = document.getElementById("contadorNotificaciones");
            if(span) span.textContent = "";

            fetch("/api/content?action=notifications-mark-read", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username: usuarioNav.nombre })
            }).then(()=>{
                // Repinta el listado para que también se les quite el
                // resaltado de "no leída" a los ítems del desplegable.
                if(typeof renderNotificacionesDropdown === "function"){
                    renderNotificacionesDropdown();
                }
            }).catch(error => {
                console.warn("MacroReborn: no se pudieron marcar las notificaciones como leídas.", error);
            });
        }

        if(botonNotif && dropdownNotif){

            botonNotif.addEventListener("click", (e)=>{
                e.stopPropagation();
                dropdownNotif.classList.contains("abierto")
                    ? cerrarDropdownNotif()
                    : abrirDropdownNotif();
            });

            document.addEventListener("click", (e)=>{
                if(!dropdownNotif.classList.contains("abierto")) return;
                if(e.target.closest("#notifBellWrap")) return;
                cerrarDropdownNotif();
            });

            document.addEventListener("keydown", (e)=>{
                if(e.key === "Escape") cerrarDropdownNotif();
            });

        }

        const botonCerrar = document.getElementById("cerrarSesion");

        if(botonCerrar){

            botonCerrar.addEventListener("click",(e)=>{

                e.preventDefault();

                localStorage.removeItem("usuarioActivo");
                localStorage.removeItem("macroSessionToken");

                window.location.href="index.html";

            });

        }

    }else{

        nav.insertAdjacentHTML("beforeend",`

            <a class="sesion-extra nav-ayuda" href="chat.html" title="¿Necesitás ayuda? Preguntá en el chat">❔</a>

            <div class="user-guest-wrap" id="userGuestWrap">
                <button type="button" class="sesion-extra user-guest-boton" id="botonUsuarioTemporal" aria-haspopup="true" aria-expanded="false">
                    <span class="user-guest-avatar">
                        👤
                        <span class="user-guest-badge">1</span>
                    </span>
                    <span class="user-guest-nombre">Usuario temporal</span>
                </button>

                <div class="user-guest-dropdown" id="dropdownUsuarioTemporal">
                    <div class="user-guest-dropdown-header">
                        <span>Iniciar sesión</span>
                    </div>

                    <form id="formLoginNav" class="user-guest-form" novalidate>
                        <input type="text" id="navLoginUsuario" class="user-guest-input" placeholder="Usuario" autocomplete="username">
                        <input type="password" id="navLoginPassword" class="user-guest-input" placeholder="Contraseña" autocomplete="current-password">
                        <div id="navLoginMensaje" class="user-guest-mensaje" role="alert"></div>
                        <button type="submit" class="user-guest-login-boton">Login</button>
                    </form>

                    <div class="user-guest-dropdown-footer">
                        ¿No tenés cuenta? <a href="registro.html">Registrarse</a>
                    </div>
                </div>
            </div>

        `);

        // ---------- DESPLEGABLE DE "USUARIO TEMPORAL" (login rápido) ----------
        // Mismo patrón que el desplegable de notificaciones de más arriba:
        // se abre/cierra al tocar el botón, se cierra al hacer click afuera
        // o al apretar Escape.

        const botonGuest = document.getElementById("botonUsuarioTemporal");
        const dropdownGuest = document.getElementById("dropdownUsuarioTemporal");

        function cerrarDropdownGuest(){
            if(!dropdownGuest) return;
            dropdownGuest.classList.remove("abierto");
            if(botonGuest) botonGuest.setAttribute("aria-expanded", "false");
        }

        function abrirDropdownGuest(){
            if(!dropdownGuest) return;
            dropdownGuest.classList.add("abierto");
            if(botonGuest) botonGuest.setAttribute("aria-expanded", "true");

            const inputUsuario = document.getElementById("navLoginUsuario");
            if(inputUsuario) inputUsuario.focus();
        }

        if(botonGuest && dropdownGuest){

            botonGuest.addEventListener("click", (e)=>{
                e.stopPropagation();
                dropdownGuest.classList.contains("abierto")
                    ? cerrarDropdownGuest()
                    : abrirDropdownGuest();
            });

            document.addEventListener("click", (e)=>{
                if(!dropdownGuest.classList.contains("abierto")) return;
                if(e.target.closest("#userGuestWrap")) return;
                cerrarDropdownGuest();
            });

            document.addEventListener("keydown", (e)=>{
                if(e.key === "Escape") cerrarDropdownGuest();
            });

        }

        // ---------- LOGIN RÁPIDO DESDE LA NAVBAR ----------
        // Misma llamada a /api/auth?action=login que ya usa js/login.js
        // en login.html: se reutiliza la misma lógica para no duplicar
        // el sistema de autenticación en dos lugares distintos.

        const formLoginNav = document.getElementById("formLoginNav");
        const mensajeLoginNav = document.getElementById("navLoginMensaje");

        function mostrarMensajeLoginNav(texto, tipo){
            if(!mensajeLoginNav) return;

            mensajeLoginNav.textContent = texto;
            mensajeLoginNav.classList.remove("error", "exito", "visible");

            void mensajeLoginNav.offsetWidth;

            mensajeLoginNav.classList.add(tipo, "visible");
        }

        if(formLoginNav){

            formLoginNav.addEventListener("submit", async (e)=>{

                e.preventDefault();

                const usuario = document.getElementById("navLoginUsuario").value.trim();
                const password = document.getElementById("navLoginPassword").value;

                if(!usuario || !password){
                    mostrarMensajeLoginNav("Completá usuario y contraseña", "error");
                    return;
                }

                const botonSubmit = formLoginNav.querySelector(".user-guest-login-boton");
                if(botonSubmit) botonSubmit.disabled = true;

                try{

                    const respuesta = await fetch("/api/auth?action=login", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ username: usuario, password: password })
                    });

                    const datos = await respuesta.json();

                    if(datos.success){

                        // Mismo normalizado que usa js/login.js, para que el
                        // resto del sitio (navbar, chat, ranking, favoritos...)
                        // siga leyendo "nombre" y "nivel" sin adaptarse.
                        const usuarioNormalizado = {
                            ...datos.user,
                            nombre: datos.user.username,
                            nivel: datos.user.level
                        };

                        if (datos.token) localStorage.setItem("macroSessionToken", datos.token);
                        localStorage.setItem("usuarioActivo", JSON.stringify(usuarioNormalizado));

                        mostrarMensajeLoginNav("Bienvenido " + datos.user.username, "exito");

                        setTimeout(()=>{ window.location.reload(); }, 600);

                    }else{

                        mostrarMensajeLoginNav(datos.error || "No se pudo iniciar sesión", "error");
                        if(botonSubmit) botonSubmit.disabled = false;

                    }

                }catch(error){

                    mostrarMensajeLoginNav("Error de conexión", "error");
                    if(botonSubmit) botonSubmit.disabled = false;

                }

            });

        }

    }

}
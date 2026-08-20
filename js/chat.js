// ==============================
// CHAT GENERAL - MacroReborn (Fase 2: Neon)
// ==============================
// Los mensajes viven en la tabla "chat_messages" de Neon
// (/api/content?action=chat).

// ---------- USUARIO ACTIVO ----------

let usuarioActivo = typeof window.MRSession === "object"
    ? window.MRSession.get()
    : leerJSON(localStorage.getItem("usuarioActivo") || "null");

let miNombre = usuarioActivo
    ? (usuarioActivo.nombre || usuarioActivo.username || "Invitado")
    : "Invitado";

if (window.MRSession && typeof window.MRSession.subscribe === "function") {
    window.MRSession.subscribe(function (detalle) {
        usuarioActivo = detalle && detalle.usuario ? detalle.usuario : null;
        miNombre = usuarioActivo
            ? (usuarioActivo.nombre || usuarioActivo.username || "Invitado")
            : "Invitado";
    });
}


// ---------- MENSAJES ----------

let _mensajesCacheChat = [];

async function obtenerMensajes(){
    try{
        const resp = await fetch("/api/content?action=chat" + (usuarioActivo && usuarioActivo.nombre ? "&username=" + encodeURIComponent(usuarioActivo.nombre) : ""));
        const datos = await resp.json();
        // La API entrega los mensajes del más nuevo al más viejo (para
        // traer siempre los 200 más recientes). Acá se invierte el
        // array para pintarlos de más viejo (arriba) a más nuevo
        // (abajo), que es el orden clásico del chat general.
        _mensajesCacheChat = (datos && datos.success) ? datos.mensajes.slice().reverse() : [];
    }catch(error){
        console.warn("MacroReborn: no se pudieron cargar los mensajes del chat.", error);
        _mensajesCacheChat = [];
    }
    return _mensajesCacheChat;
}


// ---------- AVATAR ----------

const ORDEN_CAPAS = [
    "fondo","espalda","modelo","piel","ojos","boca",
    "botas","pantalon","remera","guantes","accesorio",
    "cara","pelo","mascota","borde"
];

// El avatar guardado por perfil.js usa valores como "tora_piel1" para el
// guardarropa (viven en imagenes/tora/piel1.png) y "tora" para el modelo
// (vive en imagenes/tora.png). Misma lógica que comunidad.js/usuario.js/
// amigos.js/ranking.js: la ruta se deriva del propio valor guardado, por
// lo que cualquier imagen nueva agregada a imagenes/<modelo>/ funciona
// automáticamente sin tener que tocar este archivo.
function rutaImagenCapa(valor){
    if(!valor || valor === "ninguno") return null;
    if(!valor.includes("_")){
        return "imagenes/" + valor + ".png";
    }
    const idx = valor.indexOf("_");
    const modelo = valor.slice(0, idx);
    const resto = valor.slice(idx + 1);
    return "imagenes/" + modelo + "/" + resto + ".png";
}


// ---------- AVATAR HTML ----------

// Escapa texto no confiable antes de insertarlo en HTML.
function escaparHTML(texto) {
  const div = document.createElement("div");
  div.textContent = texto == null ? "" : String(texto);
  return div.innerHTML;
}


function obtenerAvatarHTML(nombre){

    // El avatar viaja embebido en el usuario (users.avatar, Neon), ya
    // no vive en la clave localStorage "avatar_<nombre>" (esa clave
    // solo existía en el navegador del propio dueño del avatar, nunca
    // en el de quien está mirando el chat). Se lee de la caché en
    // memoria de js/core.js, precargada por renderChat() antes de
    // pintar los mensajes.
    const avatar = typeof obtenerAvatarCacheado === "function" ? obtenerAvatarCacheado(nombre) : null;

    if(!avatar){
        return `<img src="imagenes/avatar.png" class="avatar-chat" alt="" loading="lazy">`;
    }

    if(avatarEsPNG(avatar)){
        return `<img src="${avatarPNGData(avatar)}" class="avatar-chat avatar-png-personalizado" alt="" loading="lazy">`;
    }

    let capas = "";
    let rutasCapas = [];

    ORDEN_CAPAS.forEach(tipo=>{
        const ruta = rutaImagenCapa(avatar[tipo]);

        if(ruta){
            capas += `<img class="capa-chat" src="${ruta}" alt="" loading="lazy">`;
            rutasCapas.push(ruta);
        }
    });

    return `<div class="avatar-chat-personalizado avatar-compuesto" ` +
        `data-capas="${rutasCapas.join("|")}" data-capa-class="capa-chat">${capas}</div>`;
}


// ---------- RENDER CHAT ----------

function responder(nombre){
    const input = document.getElementById("mensajeInput");
    input.value = "@" + nombre + " ";
    input.focus();
}

async function renderChat(){

    const contenedor = document.getElementById("mensajesChat");
    if(!contenedor) return;

    const mensajes = await obtenerMensajes();

    if(typeof cargarAvataresDeVarios === "function"){
        await cargarAvataresDeVarios(mensajes.map(m => m.usuario));
    }

    contenedor.innerHTML = "";

    if(mensajes.length === 0){
        contenedor.innerHTML = `
        <div class="mensaje-chat-vacio">
            Todavía no hay mensajes.<br>
            ¡Sé el primero en escribir!
        </div>`;
        return;
    }

    mensajes.forEach(msg=>{

        const esMio = msg.usuario === miNombre;
        const fecha = new Date(msg.created_at).toLocaleString("es-AR");

        const div = document.createElement("div");
        div.className = "mensaje" + (esMio ? " mensaje-propio" : "");

        div.innerHTML = `
            <div class="cabecera-mensaje">
                ${obtenerAvatarHTML(msg.usuario)}
                <div>
                    <b>${escaparHTML(msg.usuario)}</b>
                    <div class="fecha-chat">${fecha}</div>
                </div>
            </div>

            <p class="texto-chat">${escaparHTML(msg.texto)}</p>

            <div class="acciones-chat">
                ${typeof botonLikeHTML === "function" ? botonLikeHTML("chat", msg.id, miNombre) : ""}

                <button class="btn-responder" data-usuario="${escaparHTML(msg.usuario)}">
                    Responder
                </button>

                ${esMio ? `
                    <button class="btn-borrar" data-id="${msg.id}">
                        🗑️ Borrar
                    </button>
                ` : `
                    <button class="btn-reportar" data-id="${msg.id}">
                        🚩 Reportar
                    </button>
                `}
            </div>
        `;

        contenedor.appendChild(div);

        const btnResponder = div.querySelector(".btn-responder");
        if (btnResponder) {
            btnResponder.addEventListener("click", () => responder(btnResponder.dataset.usuario));
        }
    });

    // La API entrega los mensajes del más viejo al más nuevo (ORDER BY
    // id ASC sobre los 200 más recientes), así que se pintan en ese
    // mismo orden: más viejo arriba, más nuevo abajo. Por eso acá se
    // lleva el scroll al final, tanto al entrar al chat como después
    // de cada envío o borrado (que vuelven a llamar a renderChat()).
    contenedor.scrollTop = contenedor.scrollHeight;
}


// ---------- ANTISPAM ----------
// Límites del lado del cliente: 5 mensajes por minuto y 200 caracteres
// por mensaje, más las validaciones de mensaje vacío / solo espacios.
// No toca el diseño ni el envío en sí, solo lo frena antes de llegar
// al fetch cuando corresponde.

const LIMITE_CARACTERES_CHAT = 200;
const LIMITE_MENSAJES_POR_MINUTO = 5;
const VENTANA_ANTISPAM_MS = 60 * 1000;

// Se guarda por usuario en localStorage para que el límite sobreviva
// a un refresco de página (no solo a la sesión en memoria).
function _claveAntispamChat(){
    return "chatAntispam_" + miNombre;
}

function _obtenerEnviosRecientes(){
    const envios = leerJSON(localStorage.getItem(_claveAntispamChat()) || "[]") || [];
    const ahora = Date.now();
    return envios.filter(t => ahora - t < VENTANA_ANTISPAM_MS);
}

function _registrarEnvioAntispam(){
    const envios = _obtenerEnviosRecientes();
    envios.push(Date.now());
    localStorage.setItem(_claveAntispamChat(), JSON.stringify(envios));
}

// Devuelve 0 si se puede enviar, o los segundos que faltan si está
// bloqueado por haber superado el límite de mensajes por minuto.
function _segundosDeEsperaAntispam(){
    const envios = _obtenerEnviosRecientes();
    if(envios.length < LIMITE_MENSAJES_POR_MINUTO) return 0;

    const masAntiguo = Math.min(...envios);
    const restante = VENTANA_ANTISPAM_MS - (Date.now() - masAntiguo);
    return Math.max(1, Math.ceil(restante / 1000));
}

function _mostrarAvisoChat(mensaje){
    const aviso = document.getElementById("avisoChat");
    if(aviso) aviso.textContent = mensaje || "";
}

let _intervaloEsperaChat = null;

function _iniciarCuentaRegresivaChat(segundos){
    const boton = document.getElementById("botonEnviar");

    clearInterval(_intervaloEsperaChat);

    let restante = segundos;
    if(boton) boton.disabled = true;
    _mostrarAvisoChat("⏳ Superaste el límite de mensajes. Esperá " + restante + "s para volver a escribir.");

    _intervaloEsperaChat = setInterval(()=>{
        restante--;

        if(restante <= 0){
            clearInterval(_intervaloEsperaChat);
            if(boton) boton.disabled = false;
            _mostrarAvisoChat("");
            return;
        }

        _mostrarAvisoChat("⏳ Superaste el límite de mensajes. Esperá " + restante + "s para volver a escribir.");
    }, 1000);
}

// ---------- CONTADOR DE CARACTERES ----------

function _actualizarContadorChat(){
    const input = document.getElementById("mensajeInput");
    const contador = document.getElementById("contadorChat");
    if(!input || !contador) return;

    const largo = input.value.length;
    contador.textContent = largo + " / " + LIMITE_CARACTERES_CHAT;
    contador.classList.toggle("contador-chat-limite", largo >= LIMITE_CARACTERES_CHAT);
}

document.getElementById("mensajeInput")?.addEventListener("input", _actualizarContadorChat);
_actualizarContadorChat();


// ---------- ENVIAR MENSAJE ----------

async function enviarMensaje(){

    const input = document.getElementById("mensajeInput");
    const textoOriginal = input.value;
    const texto = textoOriginal.trim();

    if(!usuarioActivo){
        alert("Debés iniciar sesión.");
        return;
    }

    // Validaciones: mensaje vacío o compuesto solo por espacios.
    if(textoOriginal === "" || texto === ""){
        _mostrarAvisoChat("✋ El mensaje no puede estar vacío.");
        return;
    }

    // Límite de caracteres.
    if(texto.length > LIMITE_CARACTERES_CHAT){
        _mostrarAvisoChat("✋ El mensaje no puede superar los " + LIMITE_CARACTERES_CHAT + " caracteres.");
        return;
    }

    // Límite de mensajes por minuto.
    const espera = _segundosDeEsperaAntispam();
    if(espera > 0){
        _iniciarCuentaRegresivaChat(espera);
        return;
    }

    if(typeof bloqueadoPorSuspension === "function" && await bloqueadoPorSuspension()) return;

    try{
        await fetch("/api/content?action=chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: miNombre, texto })
        });
    }catch(error){
        console.warn("MacroReborn: no se pudo enviar el mensaje.", error);
        return;
    }

    _registrarEnvioAntispam();
    _mostrarAvisoChat("");

    if(typeof notificarMenciones === "function"){
        notificarMenciones(texto, miNombre, "en el chat general.");
    }

    input.value = "";
    _actualizarContadorChat();
    renderChat();
}


// ---------- EVENTOS ----------

document.getElementById("botonEnviar")?.addEventListener("click", enviarMensaje);

document.getElementById("mensajeInput")?.addEventListener("keydown", function(e){
    if(e.key === "Enter"){
        enviarMensaje();
    }
});


// ---------- BORRAR MENSAJES ----------

document.addEventListener("click", async (e)=>{
    if(e.target.classList.contains("btn-borrar")){

        const id = e.target.dataset.id;

        try{
            await fetch("/api/content?action=chat", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ messageId: id, username: miNombre })
            });
        }catch(error){
            console.warn("MacroReborn: no se pudo borrar el mensaje.", error);
        }

        renderChat();
    }
});


// ---------- REPORTAR MENSAJES ----------
// Reutiliza el mismo motor de reportes que ya usan los comentarios de
// perfil (js/motor/reportes.js -> reportarComentario). Acá el "origen"
// que se pasa es un identificador fijo ("chatGeneral") para distinguir
// estos reportes de los de perfiles.

document.addEventListener("click", (e)=>{
    if(e.target.classList.contains("btn-reportar")){

        if(!usuarioActivo){
            alert("Iniciá sesión para reportar un mensaje.");
            return;
        }

        const id = e.target.dataset.id;
        const mensaje = _mensajesCacheChat.find(m => String(m.id) === id);

        if(!mensaje) return;

        const confirmar =
            typeof pedirConfirmacion === "function"
                ? (texto, onConfirmar) => pedirConfirmacion(texto, onConfirmar, "🚩 Reportar")
                : (texto, onConfirmar) => { if(confirm(texto)) onConfirmar(); };

        confirmar("¿Seguro que querés reportar este mensaje?", () => {
            if(typeof reportarComentario === "function"){
                const motivo = prompt("¿Por qué reportás este mensaje? (opcional)") || "";
                reportarComentario("chat", mensaje.id, "chatGeneral", {
                    usuario: mensaje.usuario,
                    texto: mensaje.texto
                }, motivo);
            }
            alert("Gracias. El mensaje fue reportado correctamente.");
        });
    }
});


// ---------- INICIO ----------

renderChat();

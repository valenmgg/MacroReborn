// ==============================
// SISTEMA DE NOTIFICACIONES (Fase 2: Neon)
// ==============================


// ---------- USUARIO ACTIVO ----------

function obtenerUsuarioNotificaciones(){
    try {
        return (window.MRSession && typeof MRSession.get === "function")
            ? MRSession.get()
            : leerJSON(localStorage.getItem("usuarioActivo") || "null");
    } catch (_) { return null; }
}


// ---------- OBTENER ----------
// Evita peticiones duplicadas cuando contador, página completa y dropdown
// solicitan las mismas notificaciones casi al mismo tiempo. El caché es
// muy corto y se invalida después de mutaciones.
const _notificacionesCache = new Map();
const _notificacionesInflight = new Map();
const NOTIFICACIONES_CACHE_TTL = 2500;

const NOTIFICACIONES_POLL_MS = 8000;
let _notificacionesPollTimer = null;

function programarPollingNotificaciones(){
    if(_notificacionesPollTimer) clearInterval(_notificacionesPollTimer);

    _notificacionesPollTimer = setInterval(async ()=>{
        const usuario = obtenerUsuarioNotificaciones();
        if(!usuario || !usuario.nombre) return;
        if(document.visibilityState === "hidden") return;

        invalidarNotificaciones(usuario.nombre);
        await actualizarContador();
    }, NOTIFICACIONES_POLL_MS);
}

function claveNotificaciones(nombre){
    return String(nombre || "").trim().toLowerCase();
}

function invalidarNotificaciones(nombre){
    const clave = claveNotificaciones(nombre);
    if(clave) _notificacionesCache.delete(clave);
}

async function obtenerNotificaciones(nombre){

    const clave = claveNotificaciones(nombre);
    if(!clave) return [];

    const ahora = Date.now();
    const cache = _notificacionesCache.get(clave);
    if(cache && (ahora - cache.at) < NOTIFICACIONES_CACHE_TTL){
        return cache.data;
    }

    if(_notificacionesInflight.has(clave)){
        return _notificacionesInflight.get(clave);
    }

    const solicitud = (async ()=>{
        try{
            const resp = await fetch("/api/content?action=notifications&username=" + encodeURIComponent(nombre), { cache: "no-store" });
            const datos = await resp.json();
            if(!datos || !datos.success) return [];

            const lista = datos.notificaciones.map(n => ({
                id: n.id,
                titulo: n.titulo,
                mensaje: n.mensaje,
                leida: n.leida,
                fecha: new Date(n.created_at).toLocaleString("es-AR")
            }));

            _notificacionesCache.set(clave, { at: Date.now(), data: lista });
            return lista;
        }catch(error){
            console.warn("MacroReborn: no se pudieron cargar las notificaciones.", error);
            return [];
        }finally{
            _notificacionesInflight.delete(clave);
        }
    })();

    _notificacionesInflight.set(clave, solicitud);
    return solicitud;
}

// Compartido con la navbar cuando este módulo está cargado.
window.MRNotifications = {
    get: obtenerNotificaciones,
    invalidate: invalidarNotificaciones
};


// ---------- CREAR ----------
// No es async a propósito: dispara el POST y no bloquea a quien llama
// (perfil.js, usuario.js, amigos.js, motor/logros.js, motor/xp.js),
// igual que antes hacía con localStorage.

function crearNotificacion(nombre, titulo, mensaje, origenNombre){

    if(!nombre || !titulo) return Promise.resolve({success:false, error:"Datos incompletos"});

    return fetch("/api/content?action=notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ username: nombre, titulo, mensaje, origenNombre })
    }).then(async (resp)=>{
        let datos = null;
        try { datos = await resp.json(); } catch (_) {}

        if(!resp.ok || !datos || !datos.success){
            console.warn("MacroReborn: el servidor rechazó la notificación.", resp.status, datos && datos.error);
            return datos || {success:false, error:"Respuesta inválida"};
        }

        invalidarNotificaciones(nombre);
        if(obtenerUsuarioNotificaciones() && obtenerUsuarioNotificaciones().nombre === nombre){
            actualizarContador();
            renderNotificaciones();
        }
        return datos;
    }).catch(error=>{
        console.warn("MacroReborn: error creando la notificación.", error);
        return {success:false, error:error && error.message ? error.message : "Error de red"};
    });

}


// ---------- DESPLEGABLE (navbar) ----------
// Versión compacta de renderNotificaciones(), para el desplegable que
// abre js/navbar.js al hacer click en la campanita. Reutiliza
// obtenerNotificaciones() de arriba, no agrega ningún endpoint nuevo.

async function renderNotificacionesDropdown(){

    const contenedor = document.getElementById("notifDropdownLista");

    if(!contenedor) return;

    if(!obtenerUsuarioNotificaciones()){

        contenedor.innerHTML = `
        <div class="notif-dropdown-vacio">
            Iniciá sesión para ver tus notificaciones.
        </div>`;

        return;

    }

    contenedor.innerHTML = `<div class="notif-dropdown-vacio">Cargando...</div>`;

    const lista = await obtenerNotificaciones(obtenerUsuarioNotificaciones().nombre);

    if(lista.length === 0){

        contenedor.innerHTML = `
        <div class="notif-dropdown-vacio">
            🔔 No tenés notificaciones.
        </div>`;

        return;

    }

    // Solo las 6 más recientes: el desplegable es un vistazo rápido,
    // el listado completo sigue viviendo en notificaciones.html.
    contenedor.innerHTML = lista.slice(0, 6).map(noti => `

        <div class="notif-dropdown-item ${noti.leida ? "" : "no-leida"}">
            <h4>${noti.titulo}</h4>
            <p>${noti.mensaje}</p>
            <span>${noti.fecha}</span>
        </div>

    `).join("");

}


// ---------- FILTRO ----------

let _filtroNotificaciones = 'todas';

function categoriaNotificacion(n){
    const texto = ((n.titulo || '') + ' ' + (n.mensaje || '')).toLowerCase();
    if(/logro|nivel|xp|insignia|premio|trofeo/.test(texto)) return 'logros';
    if(/juego|jugó|partida|favorito|game/.test(texto)) return 'juegos';
    return 'social';
}

function filtrarNotificaciones(lista){
    if(_filtroNotificaciones === 'todas') return lista;
    return lista.filter(n => categoriaNotificacion(n) === _filtroNotificaciones);
}

// ---------- MOSTRAR ----------

async function renderNotificaciones(){

    const contenedor = document.getElementById("listaNotificaciones");

    if(!contenedor) return;

    if(!obtenerUsuarioNotificaciones()){

        contenedor.innerHTML = `
        <div class="vacio">
            Iniciá sesión para ver tus notificaciones.
        </div>`;

        actualizarContador();

        return;

    }

    const lista = await obtenerNotificaciones(obtenerUsuarioNotificaciones().nombre);

    if(lista.length === 0){

        contenedor.innerHTML = `
        <div class="vacio">
            🔔 No tenés notificaciones.
        </div>`;

        actualizarContador();

        return;

    }

    const listaFiltrada = filtrarNotificaciones(lista);

    if(listaFiltrada.length === 0){
        contenedor.innerHTML = `<div class="vacio">No hay notificaciones en esta categoría.</div>`;
        actualizarContador();
        return;
    }

    contenedor.innerHTML = "";

    listaFiltrada.forEach(noti=>{

        contenedor.innerHTML += `

        <div class="notificacion ${noti.leida ? "leida" : "no-leida"}">

            <h3>${noti.titulo}</h3>

            <p>${noti.mensaje}</p>

            <div class="fecha">
                ${noti.fecha}
            </div>

        </div>

        `;

    });

    actualizarContador();

}


// ---------- CONTADOR ----------

async function actualizarContador(){

    const contador = document.getElementById("contadorNotificaciones");

    if(!contador){

        return;

    }

    if(!obtenerUsuarioNotificaciones()){

        contador.textContent = "";

        return;

    }

    const lista = await obtenerNotificaciones(obtenerUsuarioNotificaciones().nombre);

    const sinLeer = lista.filter(n=>!n.leida).length;

    contador.textContent = sinLeer > 0 ? "(" + sinLeer + ")" : "";

}


// ---------- MARCAR TODAS ----------

document.getElementById("marcarLeidas")?.addEventListener("click", async ()=>{

    if(!obtenerUsuarioNotificaciones()) return;

    try{
        await fetch("/api/content?action=notifications-mark-read", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: obtenerUsuarioNotificaciones().nombre })
        });
    }catch(error){
        console.warn("MacroReborn: no se pudieron marcar las notificaciones como leídas.", error);
    }

    invalidarNotificaciones(obtenerUsuarioNotificaciones()?.nombre);
    renderNotificaciones();

});


// ---------- BORRAR TODAS ----------

document.getElementById("borrarTodas")?.addEventListener("click", async ()=>{

    if(!obtenerUsuarioNotificaciones()) return;

    if(!confirm("¿Vaciar todas las notificaciones?")) return;

    try{
        await fetch("/api/content?action=notifications", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: obtenerUsuarioNotificaciones().nombre })
        });
    }catch(error){
        console.warn("MacroReborn: no se pudieron borrar las notificaciones.", error);
    }

    invalidarNotificaciones(obtenerUsuarioNotificaciones()?.nombre);
    renderNotificaciones();

});


document.querySelectorAll('[data-notif-filtro]').forEach(boton => {
    boton.addEventListener('click', () => {
        _filtroNotificaciones = boton.dataset.notifFiltro || 'todas';
        document.querySelectorAll('[data-notif-filtro]').forEach(b => b.classList.remove('activo'));
        boton.classList.add('activo');
        renderNotificaciones();
    });
});

// ---------- ACTUALIZAR AL ENFOCAR LA PESTAÑA ----------

window.addEventListener("focus",()=>{

    const usuario = obtenerUsuarioNotificaciones();
    if(usuario && usuario.nombre) invalidarNotificaciones(usuario.nombre);

    actualizarContador();
    renderNotificaciones();

});


// ---------- INICIO ----------
// Inspirado en Layout.js de Morpho: las piezas dependientes de la
// infraestructura global arrancan cuando MRApp declara lista la aplicación.
// Si app-shell no estuviera cargado por compatibilidad, se mantiene el
// arranque inmediato anterior.
function iniciarSistemaNotificaciones(){
    actualizarContador();
    renderNotificaciones();

    if (window.MRSession && typeof MRSession.subscribe === "function") {
        MRSession.subscribe(() => {
            const usuario = obtenerUsuarioNotificaciones();
            if(usuario && usuario.nombre) invalidarNotificaciones(usuario.nombre);
            actualizarContador();
            renderNotificaciones();
            renderNotificacionesDropdown();
        });
    }

    programarPollingNotificaciones();
}

if (window.MRApp && typeof MRApp.whenReady === "function") {
    MRApp.whenReady().then(iniciarSistemaNotificaciones);
} else {
    iniciarSistemaNotificaciones();
}

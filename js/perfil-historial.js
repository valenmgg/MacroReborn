// =========================
// MACROREBORN - HISTORIAL PERFIL (Fase 2: Neon + actualización en vivo)
// =========================

const contenedorHistorial = document.querySelector("#ultimos");

function usuarioHistorialActual(){
    if (window.MRProfileContext && MRProfileContext.type === "own" && typeof MRProfileContext.getUser === "function") {
        return MRProfileContext.getUser();
    }
    return (window.MRSession && typeof MRSession.get === "function")
      ? MRSession.get()
      : leerJSON(localStorage.getItem("usuarioActivo"));
}

let renderHistorialEnCurso = null;

async function renderHistorialPerfil(){

    const usuarioActivoHistorial = usuarioHistorialActual();

    if(!contenedorHistorial || !usuarioActivoHistorial || !usuarioActivoHistorial.nombre) return;

    // Evita dos GET simultáneos si llegan juntos un cambio de sesión y
    // un evento de juego jugado.
    if(renderHistorialEnCurso) return renderHistorialEnCurso;

    renderHistorialEnCurso = (async ()=>{
        let historial = [];

        try{
            const url = "/api/content?action=game-history&username=" + encodeURIComponent(usuarioActivoHistorial.nombre);
            let datos;
            if(window.MRApi && typeof MRApi.requestShared === "function"){
                datos = await MRApi.requestShared("GET", url, { credentials: "same-origin" });
            }else{
                const resp = await fetch(url);
                datos = await resp.json();
            }
            historial = (datos && datos.success) ? datos.historial : [];
        }catch(error){
            console.warn("MacroReborn: no se pudo cargar el historial.", error);
        }

        if(historial.length === 0){

            contenedorHistorial.innerHTML = `
                <h2>🎮 Últimos jugados</h2>
                <p>Todavía no jugaste ningún juego.</p>
            `;

        }else{

            contenedorHistorial.innerHTML = `<h2>🎮 Últimos jugados</h2>`;

            historial.forEach(id=>{

                const juego = juegos.find(
                    j => String(j.id) === String(id)
                );

                if(juego){

                    contenedorHistorial.innerHTML += `
                        <a href="juego.html?id=${encodeURIComponent(juego.id)}" class="juego-card">
                            <div class="juego-imagen">
                                ${crearImagenJuego(juego)}
                            </div>
                            <h3>${juego.nombre}</h3>
                        </a>
                    `;

                }

            });

        }
    })();

    try{
        return await renderHistorialEnCurso;
    }finally{
        renderHistorialEnCurso = null;
    }
}

renderHistorialPerfil();

// Actualización inmediata cuando esta misma pestaña registra un juego.
function refrescarHistorialPorJuego(payload){
    const usuario = usuarioHistorialActual();
    const actor = payload && payload.username;
    if(!usuario || !actor || String(usuario.nombre).toLowerCase() !== String(actor).toLowerCase()) return;
    renderHistorialPerfil();
}

function escucharEventoMacroHistorial(nombre, handler){
    if(window.MRApp && MRApp.events && typeof MRApp.events.on === "function") {
        MRApp.events.on(nombre, handler);
        return;
    }
    window.addEventListener(nombre, function(event){
        handler(event && event.detail);
    });
}

escucharEventoMacroHistorial("macro:game-played", refrescarHistorialPorJuego);

// Sincronización entre pestañas: jugar en otra pestaña refresca el historial
// cuando Neon ya confirmó la escritura.
window.addEventListener("storage", function(event){
    if(event.key !== "macro:last-game-played" || !event.newValue) return;
    try{
        const payload = JSON.parse(event.newValue);
        const usuario = usuarioHistorialActual();
        if(usuario && payload && payload.username && String(usuario.nombre).toLowerCase() === String(payload.username).toLowerCase()){
            renderHistorialPerfil();
        }
    }catch(_){}
});

if(window.MRSession && typeof MRSession.subscribe === "function"){
    MRSession.subscribe(function(detalle){
        if(!detalle || !detalle.usuario) return;
        renderHistorialPerfil();
    });
}

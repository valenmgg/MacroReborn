// =========================
// MACROREBORN - FAVORITOS POR USUARIO (Fase 2: Neon)
// =========================

const botonFavorito = document.querySelector(".boton-favorito");
const parametrosJuego = new URLSearchParams(window.location.search);
const idJuegoFavorito = String(parametrosJuego.get("id"));

function obtenerUsuarioFavoritoActual(){
    try {
        return (window.MRSession && typeof MRSession.get === "function")
            ? MRSession.get()
            : leerJSON(localStorage.getItem("usuarioActivo") || "null");
    } catch (_) { return null; }
}

function pintarFavoritoBloqueado(){
    if(!botonFavorito) return;
    botonFavorito.disabled = true;
    botonFavorito.textContent = "🔒 Iniciá sesión para agregar favorito";
}

let esFavoritoActual = false;
let nombreUsuarioFavorito = null;

function actualizarBotonFavorito(){
    if(!botonFavorito) return;
    botonFavorito.textContent = esFavoritoActual
        ? "⭐ En favoritos"
        : "☆ Agregar favorito";
}

async function cargarEstadoFavorito(){
    const usuario = obtenerUsuarioFavoritoActual();
    nombreUsuarioFavorito = usuario && usuario.nombre ? usuario.nombre : null;

    if(!botonFavorito) return;

    if(!nombreUsuarioFavorito){
        esFavoritoActual = false;
        pintarFavoritoBloqueado();
        return;
    }

    botonFavorito.disabled = true;
    try{
        const resp = await fetch("/api/content?action=favorites&username=" + encodeURIComponent(nombreUsuarioFavorito));
        const datos = await resp.json();
        esFavoritoActual = (datos && datos.success)
            ? datos.favoritos.includes(idJuegoFavorito)
            : false;
    }catch(error){
        console.warn("MacroReborn: no se pudo cargar el estado de favorito.", error);
    }

    botonFavorito.disabled = false;
    actualizarBotonFavorito();
}

if(botonFavorito){
    botonFavorito.addEventListener("click", async ()=>{
        const usuarioActual = obtenerUsuarioFavoritoActual();
        const nombreActual = usuarioActual && usuarioActual.nombre ? usuarioActual.nombre : null;

        if(!nombreActual){
            pintarFavoritoBloqueado();
            return;
        }

        if(botonFavorito.disabled) return;
        botonFavorito.disabled = true;

        try{
            const resp = await fetch("/api/content?action=favorites", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username: nombreActual, gameId: idJuegoFavorito })
            });
            const datos = await resp.json();

            if(datos && datos.success){
                nombreUsuarioFavorito = nombreActual;
                esFavoritoActual = !!datos.favorito;

                // ==============================
                // ACTIVIDAD RECIENTE - FAVORITO
                // ==============================
                if(esFavoritoActual && typeof registrarActividad === "function" && typeof juegos !== "undefined"){
                    const juegoFav = juegos.find(j => String(j.id) === idJuegoFavorito);
                    registrarActividad(
                        nombreActual,
                        "favorito",
                        juegoFav ? juegoFav.nombre : ("el juego #" + idJuegoFavorito)
                    );
                }

                actualizarBotonFavorito();
            }
        }catch(error){
            console.warn("MacroReborn: no se pudo actualizar el favorito.", error);
        }finally{
            botonFavorito.disabled = false;
        }
    });
}

cargarEstadoFavorito();

if (window.MRSession && typeof MRSession.subscribe === "function") {
    MRSession.subscribe(() => {
        cargarEstadoFavorito();
    });
}

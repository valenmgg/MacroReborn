// =========================
// MACROREBORN - FAVORITOS PERFIL (Fase 2: Neon)
// =========================

function obtenerUsuarioSesionFavoritos(){
    try {
        if (window.MRProfileContext && MRProfileContext.type === "own" && typeof MRProfileContext.getUser === "function") {
            return MRProfileContext.getUser();
        }
        return (window.MRSession && typeof MRSession.get === "function")
            ? MRSession.get()
            : leerJSON(localStorage.getItem("usuarioActivo"));
    } catch (_) { return null; }
}

const contenedorFavoritos = document.querySelector(".juegos-favoritos");

async function renderFavoritosPerfil(){

    if (!contenedorFavoritos) return;

    const usuarioActivoFavoritos = obtenerUsuarioSesionFavoritos();

    if (!usuarioActivoFavoritos) {

        contenedorFavoritos.innerHTML = `
            <p>Iniciá sesión para ver tus juegos favoritos.</p>
        `;

        return;

    }

    let favoritos = [];

    try{
        const url = "/api/content?action=favorites&username=" + encodeURIComponent(usuarioActivoFavoritos.nombre);
        let datos;
        if(window.MRApi && typeof MRApi.requestShared === "function"){
            datos = await MRApi.requestShared("GET", url, { credentials: "same-origin" });
        }else{
            const resp = await fetch(url);
            datos = await resp.json();
        }
        favoritos = (datos && datos.success) ? datos.favoritos : [];
    }catch(error){
        console.warn("MacroReborn: no se pudieron cargar los favoritos.", error);
    }

    if (favoritos.length === 0) {

        contenedorFavoritos.innerHTML = `
            <p>Todavía no agregaste juegos favoritos.</p>
        `;

    } else {

        contenedorFavoritos.innerHTML = "";

        favoritos.forEach(id => {

            const juego = juegos.find(j => String(j.id) === String(id));

            if (juego) {

                contenedorFavoritos.innerHTML += `
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

}

renderFavoritosPerfil();


if (window.MRSession && typeof MRSession.subscribe === "function") {
    MRSession.subscribe((detalle) => {
        if (detalle && detalle.motivo === "logout") {
            renderFavoritosPerfil();
            return;
        }
        renderFavoritosPerfil();
    });
}

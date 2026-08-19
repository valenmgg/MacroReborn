// =========================
// MACROREBORN - FAVORITOS USUARIO (Fase 2: Neon)
// =========================


const parametrosUsuario = new URLSearchParams(
window.location.search
);


const idUsuario = parametrosUsuario.get("usuario");


// FIX: antes apuntaba a toda la sección "#favoritos" (con su <h2>
// incluido) y las tarjetas quedaban sueltas ahí adentro, sin la
// grilla de ".juegos-favoritos" que sí tiene perfil.html -> las
// imágenes se veían desconfiguradas. Ahora apunta directo al
// contenedor con esa clase (mismo criterio que perfil-favoritos.js).
const seccionFavoritos = document.querySelector("#favoritos .juegos-favoritos");


async function renderFavoritosUsuario(){

    if(!seccionFavoritos || !idUsuario) return;

    let favoritos = [];

    try{
        const activo = (window.MRSession && typeof MRSession.get === "function")
            ? MRSession.get()
            : (typeof leerJSON === "function" ? leerJSON(localStorage.getItem("usuarioActivo") || "null") : null);
        const viewerQuery = activo && activo.nombre ? "&viewer=" + encodeURIComponent(activo.nombre) : "";
        const resp = await fetch("/api/content?action=favorites&username=" + encodeURIComponent(idUsuario) + viewerQuery);
        const datos = await resp.json();
        favoritos = (datos && datos.success) ? datos.favoritos : [];
    }catch(error){
        console.warn("MacroReborn: no se pudieron cargar los favoritos.", error);
    }

    const texto = seccionFavoritos.querySelector("p");

    if(favoritos.length === 0){

        if(texto) texto.textContent = "Este usuario no tiene juegos favoritos.";

    }else{

        if(texto) texto.remove();

        favoritos.forEach(id=>{

            const juego = juegos.find(
                j => String(j.id) === String(id)
            );

            if(juego){

                seccionFavoritos.innerHTML += `
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

renderFavoritosUsuario();

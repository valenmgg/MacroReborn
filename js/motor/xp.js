// =========================
// MACROREBORN - SISTEMA XP
// =========================
// Fase 1: el cálculo de XP/nivel ahora lo hace el servidor
// (POST /api/xp), que es la fuente de verdad. Este archivo solo pide
// el resultado, actualiza la caché local de sesión (usuarioActivo) y
// dispara los mismos efectos visuales/logros/actividad que ya existían.
//
// Ranking por tiempo jugado: iniciarXP(idJuego) ahora recibe el id
// del juego que se está jugando (jugar.js se lo pasa) y lo manda en
// cada pulso a /api/users?action=xp. El servidor usa ese mismo pulso
// de 1 vez por minuto para contar minutos jugados por juego, que es
// lo que usa el ranking semanal (ver api/users.js y api/system.js).
// No se agregó ningún pedido nuevo al servidor: es el mismo que ya
// existía, con un dato más adentro.


let intervaloXP;
let _xpJuegoActual = null; // id del juego que se está jugando ahora



function iniciarXP(idJuego){

    clearInterval(intervaloXP);

    _xpJuegoActual = (idJuego !== undefined && idJuego !== null) ? idJuego : null;

    intervaloXP = setInterval(()=>{

        ganarXP(10);

    },60000); // 1 minuto

}





function detenerXP(){


    clearInterval(intervaloXP);
}





async function ganarXP(cantidad){


    const usuario = leerJSON(
        localStorage.getItem("usuarioActivo")
    );



    if(!usuario || !usuario.nombre) return;


    let subioNivel = false;


    try {

        const respuesta = await fetch("/api/users?action=xp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: usuario.nombre,
                cantidad: cantidad,
                gameId: _xpJuegoActual
            })
        });

        const datos = await respuesta.json();

        if(!datos || !datos.success) return;

        usuario.nivel = datos.user.level;
        usuario.level = datos.user.level;
        usuario.xp = datos.user.xp;

        subioNivel = !!datos.subioNivel;

    } catch(error){

        console.warn("MacroReborn: no se pudo actualizar el XP.", error);
        return;

    }


    guardarUsuario(usuario);


    if(subioNivel){


        mostrarToastNivel(
            "⭐ ¡Subiste al nivel " + usuario.nivel + "!"
        );

        // ==============================
// NOTIFICACION DE NIVEL
// ==============================

if(typeof crearNotificacion === "function"){

    crearNotificacion(

        usuario.nombre,

        "⭐ Nuevo nivel",

        "Subiste al nivel " + usuario.nivel + "."

    );
    

}

        // ==============================
        // ACTIVIDAD RECIENTE - NIVEL
        // ==============================

        if(typeof registrarActividad === "function"){

            registrarActividad(usuario.nombre, "nivel", usuario.nivel);

        }


        // ==============================
        // LOGROS DE NIVEL
        // ==============================

        if(typeof desbloquearLogro === "function"){

            const hitosNivel = {
                2:"nivel2",
                5:"nivel5",
                10:"nivel10",
                25:"nivel25",
                50:"nivel50",
                100:"nivel100",
                200:"nivel200",
                300:"nivel300",
                400:"nivel400",
                500:"nivel500",
                1000:"nivel1000"
            };

            if(hitosNivel[usuario.nivel]){
                desbloquearLogro(usuario.nombre, hitosNivel[usuario.nivel]);
            }

        }



    }


}


function mostrarToastNivel(mensaje){

    let contenedor = document.getElementById("toastNivelContenedor");

    if(!contenedor){

        contenedor = document.createElement("div");
        contenedor.id = "toastNivelContenedor";
        contenedor.style.position = "fixed";
        contenedor.style.top = "20px";
        contenedor.style.left = "50%";
        contenedor.style.transform = "translateX(-50%)";
        contenedor.style.zIndex = "999999";
        contenedor.style.display = "flex";
        contenedor.style.flexDirection = "column";
        contenedor.style.gap = "8px";
        contenedor.style.pointerEvents = "none";

        document.body.appendChild(contenedor);

    }

    const toast = document.createElement("div");
    toast.textContent = mensaje;
    toast.style.background = "#1e1e2f";
    toast.style.color = "#ffd54a";
    toast.style.padding = "12px 20px";
    toast.style.borderRadius = "10px";
    toast.style.fontWeight = "bold";
    toast.style.fontSize = "15px";
    toast.style.boxShadow = "0 4px 14px rgba(0,0,0,0.35)";
    toast.style.border = "1px solid #ffd54a";
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.3s ease, transform 0.3s ease";
    toast.style.transform = "translateY(-10px)";

    contenedor.appendChild(toast);

    requestAnimationFrame(()=>{
        toast.style.opacity = "1";
        toast.style.transform = "translateY(0)";
    });

    setTimeout(()=>{

        toast.style.opacity = "0";
        toast.style.transform = "translateY(-10px)";

        setTimeout(()=>{
            toast.remove();
        }, 300);

    }, 3500);

}


function xpNecesaria(nivel){



    if(nivel === 1){

        return 50;

    }



    if(nivel === 2){

        return 100;

    }



    return 100 + ((nivel - 2) * 200);



}





function guardarUsuario(usuario){

    localStorage.setItem(
        "usuarioActivo",
        JSON.stringify(usuario)
    );

}

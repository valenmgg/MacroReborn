// ==============================
// LOGIN - MacroReborn
// ==============================


const formulario = document.getElementById("formLogin");
const mensajeLogin = document.getElementById("mensajeLogin");
const cardLogin = document.getElementById("cardLogin");


function mostrarMensajeLogin(texto, tipo){
    if(!mensajeLogin){
        alert(texto);
        return;
    }

    mensajeLogin.textContent = texto;
    mensajeLogin.classList.remove("error", "exito", "visible");

    void mensajeLogin.offsetWidth;

    mensajeLogin.classList.add(tipo, "visible");


    if(tipo === "error" && cardLogin){

        cardLogin.classList.remove("auth-shake");

        void cardLogin.offsetWidth;

        cardLogin.classList.add("auth-shake");

    }
}



formulario.addEventListener("submit", async function(e){

    e.preventDefault();


    let usuario = document.getElementById("usuario").value.trim();

    let password = document.getElementById("password").value;



    if(!usuario || !password){

        mostrarMensajeLogin(
            "Completá usuario y contraseña",
            "error"
        );

        return;

    }



    try {


        const respuesta = await fetch("/api/auth?action=login", {

            method:"POST",

            headers:{
                "Content-Type":"application/json"
            },

            body:JSON.stringify({

                username: usuario,

                password: password

            })

        });



        const datos = await respuesta.json();



        if(datos.success){


            // Neon devuelve el usuario con sus columnas tal cual
            // (username, level...). El resto del sitio históricamente
            // trabaja con "nombre" y "nivel", así que se guarda ya
            // normalizado para que cualquier página que lea
            // usuarioActivo directamente (navbar, chat, ranking,
            // favoritos...) funcione sin tener que adaptarlo cada vez.

            const usuarioNormalizado = {
                ...datos.user,
                nombre: datos.user.username,
                nivel: datos.user.level
            };

            if (datos.token) localStorage.setItem("macroSessionToken", datos.token);
            localStorage.setItem(
                "usuarioActivo",
                JSON.stringify(usuarioNormalizado)
            );



            mostrarMensajeLogin(
                "Bienvenido " + datos.user.username,
                "exito"
            );



            setTimeout(function(){

                window.location.href="perfil.html";

            },700);



        }else{


            mostrarMensajeLogin(
                datos.error,
                "error"
            );


        }



    }catch(error){



        mostrarMensajeLogin(
            "Error de conexión",
            "error"
        );


    }



});
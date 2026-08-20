// ==============================
// RANKING - MacroReborn
// ==============================
// Fase 1: la lista de usuarios sale de /api/users (antes: la clave
// localStorage "usuariosMacro", que en la práctica nunca se llegaba a
// llenar). Se cachea en memoria por carga de página para no repetir el
// pedido cada vez que se llama a obtenerListaRanking().
//
// Ranking por tiempo jugado: la posición de cada usuario (rank_actual)
// YA NO se calcula acá con nivel/XP/logros: la calcula el servidor una
// vez por semana (api/system.js -> recalcularRanking(), todos los
// lunes a las 5:00 hora Argentina) según cuánto jugó, qué tan seguido
// y qué tan variados fueron los juegos. Este archivo solo ordena por
// esa posición ya calculada (rank_actual), que viaja en cada usuario
// que devuelve /api/users.


const podioRanking = document.getElementById("podioRanking");
const contenedorRanking = document.getElementById("listaRanking");
const buscador = document.getElementById("buscarJugador");

// Usuario con sesión iniciada en este navegador — se usa únicamente
// para resaltar visualmente su propia fila/tarjeta en el ranking.
// No participa del cálculo ni del orden del ranking.
let activoRanking = (window.MRSession && typeof MRSession.get === "function")
    ? MRSession.get()
    : leerJSON(localStorage.getItem("usuarioActivo") || "null");

if (window.MRSession && typeof MRSession.subscribe === "function") {
    MRSession.subscribe(function (detalle) {
        activoRanking = detalle && detalle.usuario ? detalle.usuario : null;
    });
}


// ==============================
// OBTENER AVATAR
// ==============================
// Ahora el avatar viaja embebido en cada usuario (users.avatar), así
// que se recibe directo en vez de ir a buscarlo a una clave aparte.

function obtenerAvatar(nombre, avatarCrudo){


    const avatar = normalizarAvatar(avatarCrudo);


    if(!avatar){

        return `
        <div class="avatar-mini-ranking">
            <img src="imagenes/avatar.png" alt="" loading="lazy">
        </div>
        `;

    }

    if(avatarEsPNG(avatar)){
        return `
        <div class="avatar-mini-ranking">
            <img src="${avatarPNGData(avatar)}" class="avatar-png-personalizado" alt="" loading="lazy">
        </div>
        `;
    }


    const capas = [

        "fondo",
        "espalda",
        "modelo",
        "piel",
        "ojos",
        "boca",
        "pantalon",
        "botas",
        "remera",
        "guantes",
        "accesorio",
        "cara",
        "pelo",
        "mascota",
        "borde"

    ];



    let html = "";
    let rutasCapas = [];



    capas.forEach(tipo=>{


        let valor = avatar[tipo];


        if(valor && valor !== "ninguno"){


            let ruta;


            if(valor.includes("_")){


                let partes = valor.split("_");

                ruta =
                "imagenes/" +
                partes[0] +
                "/" +
                partes.slice(1).join("_") +
                ".png";


            }else{


                ruta =
                "imagenes/" +
                valor +
                ".png";


            }


            html += `
            <img 
            class="capa-ranking"
            src="${ruta}" alt="" loading="lazy">
            `;

            rutasCapas.push(ruta);

        }


    });



    return `

    <div class="avatar-mini-ranking avatar-compuesto" data-capas="${rutasCapas.join("|")}" data-capa-class="capa-ranking">

        ${html}

    </div>

    `;


}



// ==============================
// LISTA DE RANKING (ordenada)
// ==============================
// Calcula la lista completa de usuarios ordenada por posición
// (rank_actual, calculado por el servidor una vez por semana). La
// usan cargarRanking() acá abajo y también obtenerPosicionRanking(),
// para que el podio, la lista y la posición individual salgan siempre
// de los mismos datos.
//
// Se cachea en memoria (_cacheUsuariosRanking): la primera vez que se
// pide, trae la lista de usuarios y precarga sus logros/insignias en
// bloque; los pedidos siguientes reusan esos datos.

let _cacheUsuariosRanking = null;

async function obtenerListaRanking(forzar){

    if(!_cacheUsuariosRanking || forzar){

        let usuarios = [];

        try{

            const respuesta = await fetch("/api/users?limit=500");
            const datos = await respuesta.json();
            usuarios = (datos && datos.success) ? datos.users : [];

        }catch(error){

            console.warn("MacroReborn: no se pudo cargar la lista de usuarios.", error);

        }

        // Adaptar los nombres de columna de Neon (username/level) al
        // formato que usa el resto del sitio (nombre/nivel).
        _cacheUsuariosRanking = usuarios.map(u => ({
            ...u,
            nombre: u.username,
            nivel: u.level
        }));

        const nombres = _cacheUsuariosRanking.map(u => u.nombre);

        if(typeof cargarLogrosDeVarios === "function"){
            await cargarLogrosDeVarios(nombres);
        }

        if(typeof cargarInsigniasDeVarios === "function"){
            await cargarInsigniasDeVarios(nombres);
        }

    }

    let ranking = _cacheUsuariosRanking.map(usuario=>{

        return{

            ...usuario,

            puntosLogros:
            calcularPuntosLogros(usuario.nombre)

        };

    });

    // Orden por posición ya calculada por el servidor (rank_actual:
    // 1 = primer puesto). Quien todavía no tiene posición calculada
    // (usuario nuevo, antes del próximo lunes) queda al final,
    // desempatado por minutos jugados esta semana.
    ranking.sort((a,b)=>{

        const posA = Number(a.rank_actual) || Infinity;
        const posB = Number(b.rank_actual) || Infinity;

        if(posA !== posB) return posA - posB;

        return (Number(b.minutos_semana_actual)||0) - (Number(a.minutos_semana_actual)||0);

    });

    return ranking;

}



// ==============================
// POSICIÓN DE UN USUARIO EN EL RANKING
// ==============================
// Devuelve la posición real (1, 2, 3...) de un usuario dentro del
// ranking general, o null si todavía no aparece en él. La usan
// perfil.html (perfil.js) y usuario.html (usuario.js).

async function obtenerPosicionRanking(nombre){

    const ranking = await obtenerListaRanking();

    const indice = ranking.findIndex(u=>u.nombre===nombre);

    return indice === -1 ? null : indice + 1;

}



// ==============================
// LOGROS DE RANKING
// ==============================
// Cada vez que se calcula el ranking (ranking.html, perfil.html o
// usuario.html, que también cargan este archivo) se revisa la posición
// de todos los usuarios y se desbloquean los logros correspondientes.
// desbloquearLogro() ya evita duplicados, así que es seguro llamarla
// repetidamente.
//
// Usa el rank_actual real que manda el servidor (no la posición del
// usuario dentro del array): así, si todavía nadie tiene una posición
// calculada (sitio recién levantado, antes del primer lunes), no se
// le adjudica de arranque un top100/top10/etc. a todo el mundo.

async function revisarLogrosRanking(){

    if(typeof desbloquearLogro !== "function") return;

    const ranking = await obtenerListaRanking();

    ranking.forEach((usuario)=>{

        const puesto = Number(usuario.rank_actual);

        if(!puesto) return; // todavía no se calculó (se calcula los lunes)

        if(puesto <= 100) desbloquearLogro(usuario.nombre,"top100");
        if(puesto <= 50) desbloquearLogro(usuario.nombre,"top50");
        if(puesto <= 10) desbloquearLogro(usuario.nombre,"top10");
        if(puesto <= 3) desbloquearLogro(usuario.nombre,"top3");
        if(puesto === 2) desbloquearLogro(usuario.nombre,"subcampeon");
        if(puesto === 1) desbloquearLogro(usuario.nombre,"numeroUno");

    });

}




// ==============================
// CARGAR RANKING
// ==============================

async function cargarRanking(filtro=""){

    // Esta función pinta el podio y la lista de ranking.html. Si el
    // script se incluye en otra página solo para reutilizar
    // obtenerListaRanking()/obtenerPosicionRanking(), esos contenedores
    // no existen y no hay nada que dibujar acá.
    if(!podioRanking || !contenedorRanking) return;

    let ranking = await obtenerListaRanking();

    if(filtro){

        ranking =
        ranking.filter(u=>

            u.nombre
            .toLowerCase()
            .includes(
                filtro.toLowerCase()
            )

        );

    }

    const top3 = ranking.slice(0,3);
    const resto = ranking.slice(3,50);

    // ==========================
    // PODIO
    // ==========================

    podioRanking.innerHTML = "";

    const posiciones = [
        top3[1],
        top3[0],
        top3[2]
    ];

    const clases = [
        "segundo",
        "primero",
        "tercero"
    ];

    posiciones.forEach((usuario,i)=>{

        if(!usuario) return;

        podioRanking.innerHTML += `

        <div class="podio-card ${clases[i]} ${activoRanking && activoRanking.nombre === usuario.nombre ? "es-actual" : ""}">

            ${clases[i]=="primero"
            ? "<div class='corona'>👑</div>"
            : ""}

            ${obtenerAvatar(usuario.nombre, usuario.avatar)}

            <h2>${usuario.nombre}</h2>

            ${typeof insigniasBloqueHTML === "function" ? insigniasBloqueHTML(usuario.nombre, true) : ""}

            <p>⏱️ ${usuario.minutos_semana_actual || 0} min esta semana</p>

            <p>📅 ${usuario.dias_activos_semana_actual || 0} días activos</p>

            <p>🏅 ${usuario.puntosLogros} puntos</p>

            <a
            href="usuario.html?usuario=${encodeURIComponent(usuario.nombre)}"
            class="boton-ranking">

            👤 Ver perfil

            </a>

        </div>

        `;

    });

    // ==========================
    // RESTO DEL RANKING
    // ==========================

    contenedorRanking.innerHTML="";

    resto.forEach((usuario,index)=>{

        let puesto = index + 4;

        // El "puesto" ahora se pinta como número simple + clase de
        // color según el rango (antes se armaba con el emoji de
        // teclado combinado "N️⃣", que solo funciona bien con un
        // dígito: a partir del puesto 10 el emoji se rompía y se veía
        // distinto al resto).
        let claseRango =
        puesto <= 10 ? "puesto-top10" : "puesto-normal";

        contenedorRanking.innerHTML += `

        <div class="jugador ${activoRanking && activoRanking.nombre === usuario.nombre ? "es-actual" : ""}">

            <div class="puesto ${claseRango}">

            ${puesto}

            </div>

            ${obtenerAvatar(usuario.nombre, usuario.avatar)}

            <div class="datos-ranking">

                <h3>${usuario.nombre}</h3>

                ${typeof insigniasBloqueHTML === "function" ? insigniasBloqueHTML(usuario.nombre, true) : ""}

                <p>⏱️ ${usuario.minutos_semana_actual || 0} min esta semana</p>

                <p>📅 ${usuario.dias_activos_semana_actual || 0} días activos</p>

                <p>🏅 ${usuario.puntosLogros} puntos</p>

            </div>

            <a
            href="usuario.html?usuario=${encodeURIComponent(usuario.nombre)}"
            class="boton-ranking">

            👤 Ver perfil

            </a>

        </div>

        `;

    });

}




// ==============================
// BUSCADOR
// ==============================


buscador?.addEventListener(
"input",
()=>{


    cargarRanking(
        buscador.value
    );


});




// INICIO

cargarRanking();
revisarLogrosRanking();

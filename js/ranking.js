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


    // El orden de capas y la resolución de rutas vienen de js/core.js,
    // que se carga antes que este archivo.
    //
    // Hasta ahora esta copia tenía "pantalon" antes que "botas", al revés
    // que el resto del sitio. Como el orden es el orden de dibujo, el
    // mismo avatar se veía con las botas encima del pantalón acá y debajo
    // en cualquier otra página. Al pasar a la lista compartida, las botas
    // vuelven a quedar bajo el pantalón, como en el editor donde la gente
    // arma su avatar.
    const capas = ORDEN_CAPAS_AVATAR;



    let html = "";
    let rutasCapas = [];



    capas.forEach(tipo=>{


        const ruta = rutaCapaAvatar(avatar[tipo]);


        if(ruta){


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
// de QUIEN TIENE LA SESIÓN ABIERTA y se le desbloquean los logros que
// le correspondan. desbloquearLogro() ya evita duplicados, así que es
// seguro llamarla repetidamente.
//
// Usa el rank_actual real que manda el servidor (no la posición del
// usuario dentro del array): así, si todavía nadie tiene una posición
// calculada (sitio recién levantado, antes del primer lunes), no se
// le adjudica de arranque un top100/top10/etc. a todo el mundo.
//
// ----------------------------------------------------------------
// POR QUÉ SOLO EL PROPIO USUARIO
// ----------------------------------------------------------------
// Hasta ahora esto recorría a TODOS los usuarios del ranking y pedía
// el logro para cada uno. Venía de cuando los logros vivían en
// localStorage y el navegador podía escribir los de cualquiera. Desde
// que están en el servidor, api/social.js rechaza con 403 todo intento
// de tocar los logros de otra persona — y hace bien.
//
// O sea que esas llamadas no concedían nada: solo gastaban. Medido en
// el log de nginx de un solo día: 19.692 peticiones a
// ?action=achievements, de las cuales 14.000 devolvieron 403. Era el
// segundo endpoint POST más golpeado del sitio, y el 71% de su tráfico
// no servía para nada, en una máquina de 950 MB y dos núcleos.
//
// Pedir solo el propio logro no quita ninguna funcionalidad: lo demás
// ya fallaba. Lo que SÍ queda pendiente es conceder los logros de los
// demás, que nunca se dieron por esta vía. Eso corresponde al servidor
// —dentro del recálculo de ranking que ya corre los lunes por cron en
// api/system.js— y no al navegador de quien pase por la página.

async function revisarLogrosRanking(){

    if(typeof desbloquearLogro !== "function") return;

    // Sin sesión no hay a quién darle nada.
    const yo = activoRanking && activoRanking.nombre;
    if(!yo) return;

    const ranking = await obtenerListaRanking();

    const mio = ranking.find(usuario =>
        usuario && typeof usuario.nombre === "string" &&
        usuario.nombre.toLowerCase() === String(yo).toLowerCase()
    );

    if(!mio) return;

    const puesto = Number(mio.rank_actual);

    if(!puesto) return; // todavía no se calculó (se calcula los lunes)

    if(puesto <= 100) desbloquearLogro(mio.nombre,"top100");
    if(puesto <= 50) desbloquearLogro(mio.nombre,"top50");
    if(puesto <= 10) desbloquearLogro(mio.nombre,"top10");
    if(puesto <= 3) desbloquearLogro(mio.nombre,"top3");
    if(puesto === 2) desbloquearLogro(mio.nombre,"subcampeon");
    if(puesto === 1) desbloquearLogro(mio.nombre,"numeroUno");

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

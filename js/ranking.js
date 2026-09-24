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


// Aquí se pintaban también el podio y la lista de ranking.html, prenda
// por prenda. Ese código no se ejecutaba nunca: ranking.html es una
// redirección y sus contenedores (#podioRanking, #listaRanking) no
// existen en ningún HTML. Se quitó el 24/09/2026, en la fase 5 de
// docs/AVATARES-SERVIDOR.md. Lo que queda es lo que usan otras páginas:
// obtenerListaRanking(), obtenerPosicionRanking() y los logros del top.

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
// LISTA DE RANKING (ordenada)
// ==============================
// Calcula la lista completa de usuarios ordenada por posición
// (rank_actual, calculado por el servidor una vez por semana). La
// usa obtenerPosicionRanking(), y el panel de administración.
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

    // El puesto ya viaja con el usuario de la sesión: /api/users devuelve
    // rank_actual. Es el mismo atajo que js/perfil.js toma para pintar la
    // posición, y aquí hacía falta igual.
    //
    // Antes esto llamaba siempre a obtenerListaRanking(), que para leer
    // UNA fila se bajaba /api/users?limit=500 (101 kB) y además pedía los
    // logros y las insignias de las ~150 personas del ranking en dos URLs
    // de más de 3 kB cada una. nginx las cortaba con 429 y el navegador
    // intentaba leer como JSON la página de error:
    //
    //   SyntaxError: Unexpected token '<', "<html>..." is not valid JSON
    //
    // Y pasaba en CADA página que carga ranking.js, incluido el perfil,
    // porque revisarLogrosRanking() se ejecuta suelta al final del
    // archivo. Es el mismo derroche que ya se quitó del lado POST en
    // ddf2773, por la otra punta.
    let puesto = Number(activoRanking.rank_actual);

    if(!puesto){
        // Sin ese dato sí toca preguntar: sesiones viejas guardadas antes
        // de que /api/users lo devolviera.
        const ranking = await obtenerListaRanking();

        const mio = ranking.find(usuario =>
            usuario && typeof usuario.nombre === "string" &&
            usuario.nombre.toLowerCase() === String(yo).toLowerCase()
        );

        if(!mio) return;
        puesto = Number(mio.rank_actual);
    }

    if(!puesto) return; // todavía no se calculó (se calcula los lunes)

    if(puesto <= 100) desbloquearLogro(yo,"top100");
    if(puesto <= 50) desbloquearLogro(yo,"top50");
    if(puesto <= 10) desbloquearLogro(yo,"top10");
    if(puesto <= 3) desbloquearLogro(yo,"top3");
    if(puesto === 2) desbloquearLogro(yo,"subcampeon");
    if(puesto === 1) desbloquearLogro(yo,"numeroUno");

}




// INICIO

revisarLogrosRanking();

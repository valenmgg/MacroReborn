// =========================
// MACROREBORN - SISTEMA DE LIKES (Fase 2: Neon)
// =========================
// Sistema genérico y reutilizable para poner "me gusta" en comentarios
// de perfil, mensajes de chat o reseñas de juegos. Cada lugar le pasa
// un "targetType" ("comment" | "chat" | "resena") y un "itemId"
// (id del comentario en la base, id del mensaje de chat, o
// "<idJuego>:<usuario>" para reseñas).
//
// Los datos viven en la tabla "likes" de Neon (/api/content?action=likes).
// Para no tener que volver "async" cada función que arma HTML (como
// hacía antes con localStorage), se guarda una caché en memoria
// (_likesCache) que se llena sola: un MutationObserver detecta cuándo
// aparecen botones ".boton-like" nuevos en la página, pide sus
// contadores en un solo pedido por tipo y actualiza el botón in-place.
// Así perfil.js / usuario.js / chat.js / resenas.js no necesitan
// cambiar su forma de renderizar: solo llaman a botonLikeHTML(...)
// igual que antes.


// ---------- CACHÉ EN MEMORIA ----------

const _likesCache = {};

function _claveCache(targetType, itemId){
    return targetType + ":" + itemId;
}

function cantidadLikes(targetType, itemId){
    const c = _likesCache[_claveCache(targetType, itemId)];
    return c ? c.count : 0;
}

function leDioLike(targetType, itemId, nombreUsuario){
    if(!nombreUsuario) return false;
    const c = _likesCache[_claveCache(targetType, itemId)];
    return c ? c.liked : false;
}


// ---------- HTML DEL BOTÓN ----------
// Devuelve el HTML del botón de like, con el contador que haya en
// caché en este momento (0 la primera vez, hasta que llegue la
// respuesta del servidor y se actualice solo).

function botonLikeHTML(targetType, itemId, nombreUsuarioActivo){
    const cantidad = cantidadLikes(targetType, itemId);
    const activo = leDioLike(targetType, itemId, nombreUsuarioActivo);

    return `<button type="button" class="boton-like${activo ? " like-activo" : ""}" data-clave="${targetType}" data-item="${itemId}">
        <span class="like-icono">${activo ? "❤️" : "🤍"}</span>
        <span class="like-contador">${cantidad}</span>
    </button>`;
}


// ---------- ACTUALIZAR BOTONES VISIBLES ----------

// Los botones cuyo contador TODAVÍA NO conocemos, agrupados por tipo.
//
// Esto es lo que rompe un bucle que estuvo abierto desde la mudanza al
// VPS. El MutationObserver de más abajo vigila el body entero y llama a
// esta función; la función escribía innerHTML en cada botón; eso es una
// mutación del DOM; el observer se disparaba otra vez. Cada vuelta era
// un pedido al servidor, cada 80 ms, mientras la pestaña estuviera
// abierta. El 12 de septiembre fueron 548.726 pedidos a action=likes en
// un día, y la página del perfil tardaba en cargar por eso.
//
// Preguntando solo por lo que falta, la segunda vuelta no tiene nada que
// hacer y se corta sola. Es además lo que el comentario de arriba del
// archivo decía que hacía: "detecta cuándo aparecen botones NUEVOS".
function _likesPendientes(){
    const porTipo = {};

    document.querySelectorAll(".boton-like[data-clave][data-item]").forEach(b=>{
        const tipo = b.dataset.clave;
        const id = b.dataset.item;
        if(_likesCache[_claveCache(tipo, id)]) return;
        if(!porTipo[tipo]) porTipo[tipo] = new Set();
        porTipo[tipo].add(id);
    });

    return porTipo;
}

async function _refrescarLikesVisibles(){

    const porTipo = _likesPendientes();
    if(!Object.keys(porTipo).length) return;

    const activo = (window.MRSession && typeof window.MRSession.get === "function") ? window.MRSession.get() : leerJSON(localStorage.getItem("usuarioActivo") || "null");

    for(const tipo of Object.keys(porTipo)){

        const ids = Array.from(porTipo[tipo]);
        const params = new URLSearchParams({ action: "likes", targetType: tipo, targetIds: ids.join(",") });
        if(activo && activo.nombre) params.set("username", activo.nombre);

        try{
            const resp = await fetch("/api/content?" + params.toString());
            const datos = await resp.json();
            if(!datos || !datos.success) continue;

            ids.forEach(id=>{
                _likesCache[_claveCache(tipo, id)] = {
                    count: datos.counts[id] || 0,
                    liked: (datos.likedByMe || []).includes(String(id))
                };
            });

            document.querySelectorAll(`.boton-like[data-clave="${tipo}"]`).forEach(b=>{
                const id = b.dataset.item;
                const c = _likesCache[_claveCache(tipo, id)];
                if(!c) return;

                // Escribir lo mismo que ya hay cuesta una mutación del
                // DOM, y cada mutación despierta al observer. Cinturón
                // además del tirante.
                const contador = b.querySelector(".like-contador");
                if(contador &&
                   contador.textContent.trim() === String(c.count) &&
                   b.classList.contains("like-activo") === !!c.liked) return;

                b.classList.toggle("like-activo", c.liked);
                b.innerHTML = `
                    <span class="like-icono">${c.liked ? "❤️" : "🤍"}</span>
                    <span class="like-contador">${c.count}</span>
                `;
            });
        }catch(error){
            console.warn("MacroReborn: no se pudieron cargar los likes.", error);
        }
    }
}

let _timeoutRefrescoLikes = null;
const _observerLikes = new MutationObserver(()=>{
    clearTimeout(_timeoutRefrescoLikes);
    _timeoutRefrescoLikes = setTimeout(_refrescarLikesVisibles, 80);
});

function _iniciarObservadorLikes(){
    _observerLikes.observe(document.body, { childList: true, subtree: true });
    _refrescarLikesVisibles();
}

if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", _iniciarObservadorLikes);
}else{
    _iniciarObservadorLikes();
}


// ---------- CLICK GLOBAL ----------
// Cualquier página que incluya este script y pinte botones con
// botonLikeHTML() ya tiene el toggle funcionando solo.

document.addEventListener("click", async (e)=>{

    const boton = e.target.closest(".boton-like");
    if(!boton) return;

    const usuarioActivo = (window.MRSession && typeof window.MRSession.get === "function") ? window.MRSession.get() : leerJSON(localStorage.getItem("usuarioActivo") || "null");

    if(!usuarioActivo){
        alert("Iniciá sesión para dar like.");
        return;
    }

    if(boton.disabled) return;

    const targetType = boton.dataset.clave;
    const itemId = boton.dataset.item;

    boton.disabled = true;

    try{
        const resp = await fetch("/api/content?action=likes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ targetType, itemId, username: usuarioActivo.nombre })
        });
        const datos = await resp.json();

        if(datos && datos.success){
            _likesCache[_claveCache(targetType, itemId)] = { count: datos.count, liked: datos.liked };

            boton.classList.toggle("like-activo", datos.liked);
            boton.innerHTML = `
                <span class="like-icono">${datos.liked ? "❤️" : "🤍"}</span>
                <span class="like-contador">${datos.count}</span>
            `;
        }
    }catch(error){
        console.warn("MacroReborn: no se pudo actualizar el like.", error);
    }finally{
        boton.disabled = false;
    }
});

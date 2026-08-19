// =========================
// MACROREBORN - PAGINA JUEGO
// =========================











// =========================
// CARGAR INFORMACION DEL JUEGO
// =========================



const parametros = new URLSearchParams(
window.location.search
);


const idJuego = Number(
parametros.get("id")
);



const juego = juegos.find(
j => j.id === idJuego
);





if(juego){



const imagen = document.querySelector(".juego-grande");

const nombre = document.querySelector(".nombre-juego");

const categoria = document.querySelector(".categoria-juego");

const estado = document.querySelector(".estado-juego");

const jugadores = document.querySelector(".jugadores-juego");

const descripcion = document.querySelector(".descripcion-juego");





if(imagen){

imagen.innerHTML = crearImagenJuego(juego, { lazy: false });

}



if(nombre){

nombre.textContent = juego.nombre;

}



if(categoria){

categoria.textContent =
"📂 Categoría: " + juego.categoria;

}



if(estado){

estado.textContent =
juego.estado;

}



// Nota: el campo "jugadores" no existe en los datos de los juegos,
// así que no se asigna texto acá (se evita mostrar "undefined").
// El elemento .jugadores-juego queda vacío y se oculta por CSS.



if(descripcion){

descripcion.textContent =
juego.descripcion;

}



// =========================
// SEO DINÁMICO (título, meta description, canonical, OG/Twitter
// y datos estructurados) según el juego cargado. juego.html es un
// único archivo que sirve a todos los juegos vía ?id=, así que sin
// esto todas las fichas compartirían el mismo <title> genérico.
// =========================

if (typeof seoActualizar === "function") {

    const urlFicha = SEO_SITE + "/juego.html?id=" + juego.id;
    const imagenAbsoluta = seoUrlAbsoluta(juego.imagen);
    const descripcionSEO = seoRecortarDescripcion(
        juego.descripcion ||
        ("Jugá a " + juego.nombre + " gratis online, sin instalar nada, en MacroReborn.")
    );

    seoActualizar({
        titulo: juego.nombre + " - Jugá gratis online | MacroReborn",
        descripcion: descripcionSEO,
        url: urlFicha,
        imagen: imagenAbsoluta
    });

    seoInyectarJSONLD("ldJsonJuego", {
        "@context": "https://schema.org",
        "@type": "VideoGame",
        "name": juego.nombre,
        "description": juego.descripcion || descripcionSEO,
        "image": imagenAbsoluta,
        "genre": juego.categoria,
        "url": urlFicha,
        "applicationCategory": "Game",
        "gamePlatform": "Web browser",
        "offers": {
            "@type": "Offer",
            "price": "0",
            "priceCurrency": "USD"
        }
    });

    seoInyectarJSONLD("ldJsonBreadcrumb", {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            { "@type": "ListItem", "position": 1, "name": "Juegos", "item": SEO_SITE + "/juegos.html" },
            { "@type": "ListItem", "position": 2, "name": juego.nombre, "item": urlFicha }
        ]
    });

}



}









// =========================
// HISTORIAL AL JUGAR
// =========================



const botonJugar = document.querySelector(".boton-jugar");



function obtenerUsuarioJuego() {
  return (window.MRSession && typeof MRSession.get === "function")
    ? MRSession.get()
    : leerJSON(localStorage.getItem("usuarioActivo") || "null");
}






if(botonJugar){



botonJugar.addEventListener("click", async ()=>{

const usuario = obtenerUsuarioJuego();

if(!usuario){

alert("Iniciá sesión para jugar");

return;

}

// ==============================
// ACTIVIDAD RECIENTE - JUGAR
// ==============================

if(typeof registrarActividad === "function"){

registrarActividad(usuario.nombre, "juego", juego.nombre);

}

// ==============================
// ÚLTIMOS JUGADOS + JUEGOS DISTINTOS (para Explorador / Coleccionista)
// ==============================
// Un solo pedido hace las dos cosas del lado del servidor: actualiza
// "últimos jugados" (se reordena solo, se acorta a 5 en la consulta)
// y suma el juego a "juegos jugados" si es la primera vez (nunca se
// acorta, sirve para contar juegos distintos jugados alguna vez).

let juegosUnicos = 0;

try{
    const resp = await fetch("/api/content?action=game-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: usuario.nombre, gameId: idJuego })
    });
    const datos = await resp.json();
    if(datos && datos.success){
        juegosUnicos = datos.juegosUnicos;

        // Notifica al frontend que Neon ya registró esta partida.
        // MRApp.events emite el evento local y conserva el CustomEvent tradicional;
        // localStorage sincroniza otras pestañas sin crear ningún endpoint nuevo.
        try{
            const eventoJuego = {
                username: usuario.nombre,
                gameId: idJuego,
                at: Date.now()
            };
            if (window.MRApp && MRApp.events && typeof MRApp.events.emit === "function") {
              MRApp.events.emit("macro:game-played", eventoJuego);
            } else {
              window.dispatchEvent(new CustomEvent("macro:game-played", { detail: eventoJuego }));
            }
            localStorage.setItem("macro:last-game-played", JSON.stringify(eventoJuego));
        }catch(_){}
    }
}catch(error){
    console.warn("MacroReborn: no se pudo registrar la partida.", error);
}

// ==============================
// LOGROS DE JUEGOS
// ==============================

if(typeof desbloquearLogro === "function"){

desbloquearLogro(usuario.nombre,"primerJuego");

if(juegosUnicos >= 5){

desbloquearLogro(usuario.nombre,"explorador");

}

if(juegosUnicos >= 30){

desbloquearLogro(usuario.nombre,"coleccionista");

}

}

// entrar al juego real

window.location.href =

"jugar.html?id=" + idJuego;

});

}

// ============================================================================
// MÉTRICAS + JUEGOS RELACIONADOS
// Usa el agregado público del catálogo para que la ficha deje de ser solo
// una descripción y se convierta en un centro de descubrimiento.
// ============================================================================
(function cargarDatosDeFicha() {
    if (!juego) return;

    function escapar(texto) {
        return (texto || "").toString()
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;");
    }

    function renderMetricas(resumen) {
        const datos = resumen[String(juego.id)] || {};
    function marcarEstadoFicha(resumen) {
        const datos = resumen[String(juego.id)] || {};
        const host = document.getElementById("juegoBadgesExtra");
        if (!host) return;
        const tags = [];
        if (juego.tipo === "destacado") tags.push(["⭐", "Destacado", "destacado"]);
        if (Number(datos.tendencia || 0) >= 15) tags.push(["🔥", "Trending", "trending"]);
        if (Number(datos.partidas || 0) >= 100) tags.push(["👑", "Popular", "popular"]);
        if (juego.estado && /nuevo/i.test(String(juego.estado))) tags.push(["🆕", "Nuevo", "nuevo"]);
        host.innerHTML = tags.slice(0, 3).map(t => `<span class="ficha-tag ${t[2]}">${t[0]} ${t[1]}</span>`).join("");
        host.hidden = !tags.length;
    }

        const set = (id, valor) => {
            const el = document.getElementById(id);
            if (el) el.textContent = valor;
        };
        set("juegoMetricasPartidas", Number(datos.partidas || 0).toLocaleString("es-AR"));
        set("juegoMetricasFavoritos", Number(datos.favoritos || 0).toLocaleString("es-AR"));
        set("juegoMetricasRating", Number(datos.promedio || 0).toFixed(1));
        set("juegoMetricasVotos", Number(datos.valoraciones || 0).toLocaleString("es-AR"));
        const popularidad = document.getElementById("juegoPopularidadTexto");
        if (popularidad) {
            const partidas = Number(datos.partidas || 0);
            const tendencia = Number(datos.tendencia || 0);
            popularidad.textContent = tendencia >= 15 ? "Está en tendencia entre la comunidad" : (partidas >= 100 ? "Uno de los juegos más jugados" : "Descubrílo y dejá tu marca");
        }
        marcarEstadoFicha(resumen);
    }

    function prepararNavegacionFlujo() {
        const host = document.getElementById("juegoFlujoNavegacion");
        const anterior = document.getElementById("juegoAnterior");
        const siguiente = document.getElementById("juegoSiguiente");
        const categoriaBtn = document.getElementById("juegoCategoria");
        const categoriaNombre = document.getElementById("flujoCategoriaNombre");
        if (!host || !categoriaBtn || !Array.isArray(window.juegos) || !juego) return;

        const categoria = String(juego.categoria || "Juegos");
        const categoriaUrl = `categoria.html?categoria=${encodeURIComponent(categoria)}`;
        categoriaBtn.href = categoriaUrl;
        if (categoriaNombre) categoriaNombre.textContent = `Más juegos de ${categoria}`;

        const mismaCategoria = juegos
            .filter(item => item && item.id !== juego.id && String(item.categoria || "") === categoria)
            .sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));

        const indice = mismaCategoria.findIndex(item => Number(item.id) > Number(juego.id));
        const siguienteItem = indice >= 0 ? mismaCategoria[indice] : mismaCategoria[0];
        const anteriorCandidates = mismaCategoria.filter(item => Number(item.id) < Number(juego.id));
        const anteriorItem = anteriorCandidates.length ? anteriorCandidates[anteriorCandidates.length - 1] : mismaCategoria[mismaCategoria.length - 1];

        function prepararEnlace(el, item, etiqueta) {
            if (!el) return;
            if (!item) {
                el.hidden = true;
                el.removeAttribute("href");
                return;
            }
            el.hidden = false;
            el.href = `juego.html?id=${encodeURIComponent(item.id)}`;
            el.title = `${etiqueta}: ${item.nombre || "juego"}`;
            const span = el.querySelector("span");
            if (span) span.textContent = `${etiqueta}: ${item.nombre || "juego"}`;
        }

        prepararEnlace(anterior, anteriorItem, "Anterior");
        prepararEnlace(siguiente, siguienteItem, "Siguiente");
        host.hidden = false;
    }

    function crearRelacionado(item, resumen) {
        const datos = resumen[String(item.id)] || {};
        const rating = Number(datos.promedio || 0).toFixed(1);
        return `
          <article class="juego-relacionado-card">
            <a href="juego.html?id=${encodeURIComponent(item.id)}">
              <div class="juego-relacionado-imagen">
                ${typeof crearImagenJuego === "function" ? crearImagenJuego(item) : "🎮"}
                <span>▶ Jugar</span>
              </div>
              <div class="juego-relacionado-info">
                <strong>${escapar(item.nombre)}</strong>
                <small>${escapar(item.categoria || "Juegos")} · ⭐ ${rating}</small>
              </div>
            </a>
          </article>`;
    }

    function renderRelacionados(resumen) {
        const contenedor = document.getElementById("juegosRelacionados");
        const seccion = document.getElementById("seccionRelacionados");
        if (!contenedor || !seccion) return;

        const candidatos = juegos
            .filter(item => item.id !== juego.id)
            .sort((a, b) => {
                const aMismo = a.categoria === juego.categoria ? 0 : 1;
                const bMismo = b.categoria === juego.categoria ? 0 : 1;
                if (aMismo !== bMismo) return aMismo - bMismo;
                const aP = Number((resumen[String(a.id)] || {}).partidas || 0);
                const bP = Number((resumen[String(b.id)] || {}).partidas || 0);
                return bP - aP || (Number(b.id) || 0) - (Number(a.id) || 0);
            })
            .slice(0, 6);

        if (!candidatos.length) return;
        contenedor.innerHTML = candidatos.map(item => crearRelacionado(item, resumen)).join("");
        seccion.hidden = false;
    }

    fetch("/api/content?action=games-overview")
        .then(resp => resp.json())
        .then(datos => {
            const resumen = datos && datos.success ? (datos.juegos || {}) : {};
            renderMetricas(resumen);
            prepararNavegacionFlujo();
            renderRelacionados(resumen);
        })
        .catch(() => {
            renderMetricas({});
        });
})();

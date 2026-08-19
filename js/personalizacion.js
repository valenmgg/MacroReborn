/* MacroReborn - personalización y resumen gamer */
(function(){
  "use strict";

  function activo(){
    try {
      if (window.MRSession && typeof MRSession.get === "function") return MRSession.get();
      return typeof leerJSON === "function" ? leerJSON(localStorage.getItem("usuarioActivo") || "null") : null;
    } catch(e){ return null; }
  }

  function escapeHtml(value){
    return String(value == null ? "" : value)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
  }

  async function obtenerJson(url, fallback){
    try{
      const resp = await fetch(url, {headers:{"Accept":"application/json"}});
      const datos = await resp.json();
      return datos && datos.success ? datos : fallback;
    }catch(error){
      return fallback;
    }
  }

  function mapaJuegos(){
    return (typeof juegos !== "undefined" && Array.isArray(juegos)) ? juegos : [];
  }

  function contarCategorias(ids){
    const mapa = new Map();
    const todos = mapaJuegos();
    (ids || []).forEach(id=>{
      const juego = todos.find(j=>String(j.id)===String(id));
      if(!juego) return;
      const cat = juego.categoria || "Otros";
      mapa.set(cat, (mapa.get(cat)||0)+1);
    });
    return [...mapa.entries()].sort((a,b)=>b[1]-a[1]);
  }

  function card(juego){
    if(!juego) return "";
    const imagen = typeof crearImagenJuego === "function"
      ? crearImagenJuego(juego,{lazy:true})
      : `<img src="${escapeHtml(juego.imagen)}" alt="${escapeHtml(juego.nombre)}" loading="lazy">`;
    return `<a class="mr-personal-card" href="juego.html?id=${encodeURIComponent(juego.id)}">
      <div class="mr-personal-card-image">${imagen}</div>
      <div class="mr-personal-card-body"><strong>${escapeHtml(juego.nombre)}</strong><span>${escapeHtml(juego.categoria || "Otros")}</span></div>
    </a>`;
  }

  async function cargarDatos(usuario){
    const nombre = usuario && usuario.nombre;
    if(!nombre) return {historial:[],favoritos:[]};
    const [hist, fav] = await Promise.all([
      obtenerJson("/api/content?action=game-history&username="+encodeURIComponent(nombre), {historial:[]}),
      obtenerJson("/api/content?action=favorites&username="+encodeURIComponent(nombre), {favoritos:[]})
    ]);
    return {
      historial: Array.isArray(hist.historial) ? hist.historial : [],
      favoritos: Array.isArray(fav.favoritos) ? fav.favoritos : []
    };
  }

  function buscarRecomendados(historial, favoritos){
    const vistos = new Set([...(historial||[]), ...(favoritos||[])].map(String));
    const categorias = contarCategorias([...(historial||[]), ...(favoritos||[])]);
    const preferidas = new Set(categorias.slice(0,3).map(x=>x[0]));
    return mapaJuegos()
      .filter(j=>!vistos.has(String(j.id)))
      .map(j=>({
        juego:j,
        score:(preferidas.has(j.categoria)?8:0)+(j.tipo==="destacado"?2:0)+(Number(j.id)%7===0?1:0)
      }))
      .sort((a,b)=>b.score-a.score || String(a.juego.nombre).localeCompare(String(b.juego.nombre),"es"))
      .slice(0,6)
      .map(x=>x.juego);
  }

  async function renderPerfil(){
    const root = document.querySelector("#resumenGamer");
    if(!root) return;
    const usuario = activo();
    if(!usuario || !usuario.nombre){
      root.innerHTML = `<div class="mr-personal-empty"><strong>🎮 Tu resumen gamer aparecerá aquí</strong><span>Iniciá sesión para ver tus juegos, favoritos y recomendaciones personalizadas.</span><a href="login.html">Iniciar sesión</a></div>`;
      return;
    }

    const datos = await cargarDatos(usuario);
    const todos = mapaJuegos();
    const historialJuegos = datos.historial.map(id=>todos.find(j=>String(j.id)===String(id))).filter(Boolean);
    const favoritosJuegos = datos.favoritos.map(id=>todos.find(j=>String(j.id)===String(id))).filter(Boolean);
    const recomendados = buscarRecomendados(datos.historial, datos.favoritos);
    const categorias = contarCategorias([...(datos.historial||[]), ...(datos.favoritos||[])]).slice(0,4);

    root.innerHTML = `
      <div class="mr-gamer-overview-head">
        <div><span class="mr-kicker">TU CENTRO GAMER</span><h2>🎮 Tu actividad</h2><p>Un vistazo rápido a cómo estás jugando en MacroReborn.</p></div>
        <a href="juegos.html" class="mr-gamer-action">Explorar juegos →</a>
      </div>
      <div class="mr-gamer-stats">
        <div><strong>${historialJuegos.length}</strong><span>Juegos jugados</span></div>
        <div><strong>${favoritosJuegos.length}</strong><span>Favoritos</span></div>
        <div><strong>${categorias[0] ? escapeHtml(categorias[0][0]) : "—"}</strong><span>Categoría favorita</span></div>
        <div><strong>${recomendados.length}</strong><span>Recomendaciones</span></div>
      </div>
      <div class="mr-personal-grid">
        <section class="mr-personal-panel">
          <div class="mr-personal-panel-head"><h3>▶ Seguí jugando</h3><a href="juegos.html">Ver todos</a></div>
          <div class="mr-personal-cards">${historialJuegos.slice(0,4).map(card).join("") || '<p class="mr-personal-muted">Todavía no tenés historial. Elegí un juego y empezá tu colección.</p>'}</div>
        </section>
        <section class="mr-personal-panel">
          <div class="mr-personal-panel-head"><h3>✨ Para vos</h3><a href="juegos.html">Explorar</a></div>
          <div class="mr-personal-cards">${recomendados.map(card).join("") || '<p class="mr-personal-muted">Jugá algunos juegos para activar tus recomendaciones.</p>'}</div>
        </section>
      </div>
      <section class="mr-personal-categories">
        <div class="mr-personal-panel-head"><h3>🧭 Tus gustos</h3></div>
        <div class="mr-preference-bars">${categorias.map(([cat,n])=>`<a href="categoria.html?categoria=${encodeURIComponent(cat)}"><span>${escapeHtml(cat)}</span><div><i style="width:${Math.max(12,Math.min(100,n*22))}%"></i></div><b>${n}</b></a>`).join("") || '<p class="mr-personal-muted">Aún no hay suficientes datos.</p>'}</div>
      </section>`;
  }

  async function refrescarHome(){
    if(!document.querySelector("body.mr-root")) return;
    const usuario = activo();
    const destino = document.querySelector("#personalizacionHome");
    if(!destino || !usuario || !usuario.nombre) return;
    const datos = await cargarDatos(usuario);
    const recs = buscarRecomendados(datos.historial, datos.favoritos).slice(0,6);
    if(!recs.length) return;
    destino.innerHTML = `<section class="mr-personal-home"><div class="mr-section-head"><div><span class="mr-kicker">PARA VOS</span><h2>✨ Recomendado según tu actividad</h2></div><a href="juegos.html">Ver catálogo →</a></div><div class="mr-game-grid">${recs.map(card).join("")}</div></section>`;
  }

  window.MRPersonalizacion = {renderPerfil,refrescarHome};

  document.addEventListener("DOMContentLoaded",()=>{
    renderPerfil();
    refrescarHome();
  });
})();

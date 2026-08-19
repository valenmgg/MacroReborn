/* MacroReborn - motor de descubrimiento */
(function(){
  "use strict";

  function esc(value){
    return String(value == null ? "" : value)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
  }

  function obtenerCategorias(){
    if(typeof juegos === "undefined" || !Array.isArray(juegos)) return [];
    const mapa = new Map();
    juegos.forEach(j => {
      const cat = String(j.categoria || "Otros").trim() || "Otros";
      mapa.set(cat, (mapa.get(cat) || 0) + 1);
    });
    return [...mapa.entries()].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0],"es"));
  }

  function normalizarTexto(texto){
    return String(texto || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  }

  function puntuarRecomendacion(juego, base){
    const cat = normalizarTexto(juego.categoria);
    const desc = normalizarTexto(juego.descripcion);
    const tokens = base.map(normalizarTexto);
    let score = 0;
    tokens.forEach(token => {
      if(!token) return;
      if(cat.includes(token)) score += 5;
      if(desc.includes(token)) score += 2;
      if(normalizarTexto(juego.nombre).includes(token)) score += 3;
    });
    if(String(juego.tipo) === "destacado") score += 1;
    return score;
  }

  function obtenerRecomendados(limite=8){
    if(typeof juegos === "undefined" || !Array.isArray(juegos)) return [];
    let recientes=[];
    try{ recientes = JSON.parse(localStorage.getItem("macroRebornRecomendacionesBase") || "[]"); }catch(e){}
    const base = Array.isArray(recientes) ? recientes.slice(0,6) : [];
    const scored = juegos.map(j => ({j,score:puntuarRecomendacion(j,base)}));
    return scored.sort((a,b)=>b.score-a.score || String(a.j.nombre).localeCompare(String(b.j.nombre),"es")).slice(0,limite).map(x=>x.j);
  }

  function tarjeta(juego){
    if(!juego) return "";
    return `<a class="mr-game-mini" href="juego.html?id=${encodeURIComponent(juego.id)}" aria-label="Jugar ${esc(juego.nombre)}">
      ${typeof crearImagenJuego === "function" ? crearImagenJuego(juego,{lazy:true}) : `<img src="${esc(juego.imagen)}" alt="${esc(juego.nombre)}" loading="lazy">`}
      <div class="mr-game-mini-body"><h3>${esc(juego.nombre)}</h3><div class="mr-game-meta"><span>🎮 ${esc(juego.categoria || "Otros")}</span>${juego.estado ? `<span>${esc(juego.estado)}</span>` : ""}</div></div>
    </a>`;
  }

  function renderLista(el, lista){
    if(!el) return;
    el.innerHTML = lista.length ? lista.map(tarjeta).join("") : `<div class="mr-empty">Todavía no hay juegos para mostrar.</div>`;
  }

  function slug(texto){
    return normalizarTexto(texto).replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
  }

  function registrarBaseRecomendacion(juego){
    if(!juego) return;
    let base=[];
    try{base=JSON.parse(localStorage.getItem("macroRebornRecomendacionesBase")||"[]");}catch(e){}
    base = Array.isArray(base) ? base : [];
    base = [juego.categoria, juego.nombre, ...(base||[])].filter(Boolean).slice(0,18);
    try{localStorage.setItem("macroRebornRecomendacionesBase",JSON.stringify(base));}catch(e){}
  }


  async function obtenerPerfilRecomendacion(){
    try{
      const usuario = (window.MRSession && typeof window.MRSession.get === "function") ? window.MRSession.get() : (typeof leerJSON === "function" ? leerJSON(localStorage.getItem("usuarioActivo") || "null") : null);
      if(!usuario || !usuario.nombre) return null;
      const [h,f] = await Promise.all([
        fetch("/api/content?action=game-history&username="+encodeURIComponent(usuario.nombre)),
        fetch("/api/content?action=favorites&username="+encodeURIComponent(usuario.nombre))
      ]);
      const hd = await h.json(); const fd = await f.json();
      return {historial:Array.isArray(hd.historial)?hd.historial:[],favoritos:Array.isArray(fd.favoritos)?fd.favoritos:[]};
    }catch(e){ return null; }
  }

  async function obtenerRecomendadosPersonalizados(limite=8){
    if(typeof juegos === "undefined" || !Array.isArray(juegos)) return [];
    const perfil = await obtenerPerfilRecomendacion();
    if(!perfil) return obtenerRecomendados(limite);
    const vistos = new Set([...(perfil.historial||[]),...(perfil.favoritos||[])].map(String));
    const preferencias = {};
    [...(perfil.historial||[]),...(perfil.favoritos||[])].forEach(id=>{
      const juego=juegos.find(j=>String(j.id)===String(id));
      if(juego) preferencias[juego.categoria]=(preferencias[juego.categoria]||0)+1;
    });
    return juegos.filter(j=>!vistos.has(String(j.id))).map(j=>({j,score:(preferencias[j.categoria]||0)*5+(j.tipo==="destacado"?2:0)}))
      .sort((a,b)=>b.score-a.score || String(a.j.nombre).localeCompare(String(b.j.nombre),"es"))
      .slice(0,limite).map(x=>x.j);
  }

  window.MRDescubrimiento = {obtenerCategorias,obtenerRecomendados,obtenerRecomendadosPersonalizados,tarjeta,renderLista,slug,registrarBaseRecomendacion};

  document.addEventListener("click",function(ev){
    const a=ev.target.closest && ev.target.closest("a[href*='juego.html?id=']");
    if(!a || typeof juegos === "undefined") return;
    try{
      const id=new URL(a.href,location.href).searchParams.get("id");
      const juego=juegos.find(j=>String(j.id)===String(id));
      if(juego) registrarBaseRecomendacion(juego);
    }catch(e){}
  });
})();

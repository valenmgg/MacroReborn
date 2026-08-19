(function(){
  "use strict";
  const readUser=()=>{try{if(window.MRSession&&typeof window.MRSession.get==="function") return window.MRSession.get(); return JSON.parse(localStorage.getItem("usuarioActivo")||"null")}catch(_){return null}};
  const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
  async function get(url){try{
    if(window.MRApi&&typeof window.MRApi.requestShared==="function"){
      return await window.MRApi.requestShared("GET",url,{credentials:"same-origin",headers:{Accept:"application/json"}});
    }
    const r=await fetch(url,{headers:{Accept:"application/json"}}); if(!r.ok) throw new Error(); return await r.json();
  }catch(_){return null;}}
  function missionHtml(m){const pct=Math.max(0,Math.min(100,(m.value/m.goal)*100));return `<article class="mr-card mission"><div class="mission-top"><span>${m.icon}</span><b>+${m.reward} XP</b></div><h3>${esc(m.title)}</h3><p>${esc(m.text)}</p><div class="progress"><span style="width:${pct}%"></span></div><small><span>${m.value}/${m.goal}</span><span>${pct>=100?"Completado":"En progreso"}</span></small></article>`;}
  async function init(){
    const u=readUser();
    const badge=document.getElementById("mrSesionBadge");
    if(!u||!u.nombre){
      if(badge) badge.textContent="Inicia sesión para sincronizar";
      document.getElementById("mrNivel").textContent="—"; document.getElementById("mrXp").textContent="—"; document.getElementById("mrMonedas").textContent="—"; document.getElementById("mrJuegos").textContent="—";
      renderMissions({games:0,history:0}); return;
    }
    if(badge) badge.textContent="@"+u.nombre;
    let user = u;
    if(window.MRApp && typeof window.MRApp.refreshSession === "function") {
      const sincronizado = await window.MRApp.refreshSession();
      if(sincronizado) user = sincronizado;
    }
    const historyRes = await get("/api/content?action=game-history&username="+encodeURIComponent(user.nombre));
    const historial=Array.isArray(historyRes?.historial)?historyRes.historial:[];
    document.getElementById("mrNivel").textContent=Number(user.level||user.nivel||1);
    document.getElementById("mrXp").textContent=Number(user.xp||0).toLocaleString("es-AR");
    document.getElementById("mrMonedas").textContent=Number(user.monedas||0).toLocaleString("es-AR");
    document.getElementById("mrJuegos").textContent=historial.length;
    renderMissions({games:historial.length,history:historial.length});
  }
  function renderMissions(s){
    const host=document.getElementById("mrMissions"); if(!host) return;
    const today=Math.min(3,s.games); const weekly=Math.min(10,s.games); const originals=localStorage.getItem("mr_originals_played")==="1"?1:0;
    host.innerHTML=[
      missionHtml({icon:"🎮",reward:50,title:"Explorador diario",text:"Juega al menos 3 partidas o títulos hoy.",value:today,goal:3}),
      missionHtml({icon:"🔥",reward:120,title:"Constancia semanal",text:"Registra 10 juegos en tu actividad semanal.",value:weekly,goal:10}),
      missionHtml({icon:"👑",reward:200,title:"Original de MacroReborn",text:"Completa una partida de un Original esta semana.",value:originals,goal:1})
    ].join("");
  }
  document.addEventListener("DOMContentLoaded",init);
})();

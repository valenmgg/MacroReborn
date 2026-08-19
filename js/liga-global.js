(function(){
  "use strict";
  const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
  const readActive=()=>{try{return JSON.parse(localStorage.getItem("usuarioActivo")||"null")}catch(_){return null}};
  let active=window.MRSession?window.MRSession.get():readActive();
  if(window.MRSession&&typeof window.MRSession.subscribe==="function"){window.MRSession.subscribe(function(d){active=d&&d.usuario?d.usuario:null;renderMe();});}
  let users=[]; let filter="todos";
  const league=(pos,total)=>{const p=pos/Math.max(total,1);if(p<=.03)return["Leyenda","👑","lg-leyenda"];if(p<=.10)return["Maestro","💎","lg-maestro"];if(p<=.20)return["Diamante","💠","lg-diamante"];if(p<=.40)return["Platino","🏆","lg-platino"];if(p<=.65)return["Oro","🥇","lg-oro"];if(p<=.85)return["Plata","🥈","lg-plata"];return["Bronce","🥉","lg-bronce"]};
  const name=u=>String(u?.username||u?.nombre||"");
  async function getFriends(){
    if(!active) return [];
    const who=encodeURIComponent(active.username||active.nombre||"");
    try{const r=await fetch(`/api/social?action=friends&username=${who}`);if(!r.ok)return[];const d=await r.json();return Array.isArray(d?.amigos)?d.amigos:[]}catch(_){return[]}
  }
  function renderMe(){
    const host=document.getElementById("lg-me"); if(!host)return;
    if(!active){host.innerHTML='<div class="lg-loading">Inicia sesión para ver tu liga y tu posición. El ranking global sigue disponible.</div>';return}
    const idx=users.findIndex(u=>name(u).toLowerCase()===name(active).toLowerCase());
    if(idx<0){host.innerHTML='<div class="lg-loading">Tu cuenta todavía no aparece en el ranking global.</div>';return}
    const pos=idx+1,[ln,icon]=league(pos,users.length),me=users[idx],xp=Number(me.xp_total??me.xp??active.xp_total??active.xp??0),games=Number(me.juegos_jugados??me.games_played??0),mon=Number(me.monedas??active.monedas??0),prev=Number(me.rank_anterior||0),delta=prev?prev-pos:0;
    host.innerHTML=`<div class="lg-me-grid"><div class="lg-main-rank"><div class="lg-badge">${icon}</div><div><span class="lg-kicker">TU LIGA</span><h2>${esc(ln)} · #${pos}</h2><p>${delta>0?`▲ ${delta} puestos desde tu posición anterior`:delta<0?`▼ ${Math.abs(delta)} puestos desde tu posición anterior`:"Seguís en tu posición actual"}</p></div></div><div class="lg-stat"><b>${xp.toLocaleString("es-ES")}</b><span>XP</span></div><div class="lg-stat"><b>${games.toLocaleString("es-ES")}</b><span>Juegos</span></div><div class="lg-stat"><b>${mon.toLocaleString("es-ES")}</b><span>Monedas</span></div><div class="lg-stat"><b>${users.length}</b><span>Competidores</span></div></div>`;
  }
  function renderTable(friends){
    const host=document.getElementById("lg-table"); if(!host)return;
    const q=(document.getElementById("lg-search")?.value||"").trim().toLowerCase();
    let rows=users.slice();
    if(filter==="mis-amigos"){const set=new Set(friends.map(name).map(x=>x.toLowerCase()));rows=rows.filter(u=>set.has(name(u).toLowerCase())||name(u).toLowerCase()===name(active).toLowerCase())}
    if(filter==="top-10")rows=rows.slice(0,10);
    if(filter==="ascenso")rows=rows.filter(u=>Number(u.rank_anterior)>Number(u.rank_actual));
    if(q)rows=rows.filter(u=>name(u).toLowerCase().includes(q));
    if(!rows.length){host.innerHTML='<div class="lg-empty">No hay jugadores con estos filtros.</div>';return}
    host.innerHTML=`<table class="lg-table"><thead><tr><th>#</th><th>Jugador</th><th>Liga</th><th>Movimiento</th></tr></thead><tbody>${rows.slice(0,100).map(u=>{const pos=users.indexOf(u)+1,[ln,icon]=league(pos,users.length),prev=Number(u.rank_anterior||0),delta=prev?prev-pos:0;return `<tr><td class="lg-rank">${pos}</td><td><div class="lg-user"><span class="lg-avatar">${esc(name(u).slice(0,1).toUpperCase())}</span><span>@${esc(name(u))}</span></div></td><td class="lg-league">${icon} ${ln}</td><td class="${delta>0?'lg-up':delta<0?'lg-down':''}">${delta>0?`▲ ${delta}`:delta<0?`▼ ${Math.abs(delta)}`:"—"}</td></tr>`}).join("")}</tbody></table>`;
  }
  async function init(){
    try{const r=await fetch("/api/users?limit=500");if(!r.ok)throw new Error("HTTP "+r.status);const d=await r.json();users=(Array.isArray(d?.users)?d.users:[]).slice().sort((a,b)=>(Number(a.rank_actual)||999999)-(Number(b.rank_actual)||999999));renderMe();const friends=await getFriends();renderTable(friends);document.querySelectorAll("[data-filter]").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll("[data-filter]").forEach(x=>x.classList.remove("active"));b.classList.add("active");filter=b.dataset.filter;renderTable(friends)}));document.getElementById("lg-search")?.addEventListener("input",()=>renderTable(friends));}catch(err){document.getElementById("lg-me").innerHTML='<div class="lg-loading">No se pudo cargar el ranking global. El resto del sitio sigue funcionando normalmente.</div>';document.getElementById("lg-table").innerHTML='<div class="lg-empty">Ranking temporalmente no disponible.</div>'}}
  document.addEventListener("DOMContentLoaded",init);
})();

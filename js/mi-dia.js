(function(){
  'use strict';
  const status=document.getElementById('status');
  const $=id=>document.getElementById(id);
  function usuarioActual(){
    try{
      if(window.MRSession && typeof window.MRSession.get === 'function'){
        return window.MRSession.get();
      }
      if(typeof leerJSON === 'function') return leerJSON(localStorage.getItem('usuarioActivo')||'null');
      return JSON.parse(localStorage.getItem('usuarioActivo')||'null');
    }catch(_){ return null; }
  }
  function authHeaders(){
    try{
      const token=(window.MRSession && typeof window.MRSession.getToken === 'function')
        ? window.MRSession.getToken()
        : localStorage.getItem('macroSessionToken');
      return token?{Authorization:'Bearer '+token}:{};
    }catch(_){ return {}; }
  }
  function money(n){return '🪙 '+Number(n||0).toLocaleString('es-ES');}
  function pct(v,t){return t?Math.max(0,Math.min(100,(Number(v||0)/Number(t))*100)):0;}
  function show(msg,ok=false){
    status.hidden=false;
    status.textContent=msg;
    status.classList.toggle('md-status-ok',ok);
    status.style.animation='none';
    void status.offsetWidth;
    status.style.animation='';
  }
  function hide(){status.hidden=true;}
  async function json(url,opts){const options=opts||{};const mergedHeaders={...authHeaders(),...(options.headers||{})};const r=await fetch(url,{...options,headers:mergedHeaders,cache:'no-store'});const d=await r.json();if(!r.ok||d.success===false)throw new Error(d.error||'No se pudo cargar');return d;}

  if(!usuarioActual() || !usuarioActual().nombre){show('Iniciá sesión para activar tu racha, misiones, notificaciones y actividad de amigos.');return;}

  // Lo último que dijo el servidor: de ahí sale qué misión se cobra.
  let ultimo=null;

  // El botón de cobrar de una misión: solo se puede pulsar si está cumplida
  // y todavía no se cobró. Antes esta página enseñaba la misión cumplida
  // sin forma de cobrarla (solo se podía en Progreso), y parecía que no se
  // había validado.
  function pintarCobro(b,m){
    if(!b) return;
    b.disabled=!m.completed||!!m.claimed;
    b.textContent=m.claimed?'Reclamada ✓':(m.completed?'Reclamar recompensa':'Completá la misión');
  }

  async function loadProgress(){
    const d=await json('/api/progreso?action=status');
    ultimo=d;
    // La racha se cuenta sola al jugar (api/_racha.js): aquí solo se dice
    // cómo va. Antes había un botón "Registrar mi día".
    const s=d.streak||{}; const racha=Number(s.current_streak||0);
    $('streakCurrent').textContent=racha+' días'; $('streakBest').textContent='Mejor racha: '+Number(s.best_streak||0);
    $('checkinState').textContent=s.hoy_cuenta?'Hoy ya cuenta ✓':(racha>0?'Jugá hoy para no perderla':'Jugá un minuto para empezarla');
    const dm=d.today?.mission||{}; $('dailyTitle').textContent=dm.title||'Misión diaria'; $('dailyDesc').textContent=dm.description||''; $('dailyValue').textContent=(dm.value||0)+'/'+(dm.target||0); $('dailyReward').textContent='+'+(dm.xp||0)+' XP · '+money(dm.coins); $('dailyPeriod').textContent=dm.periodKey||''; $('dailyBar').style.width=pct(dm.value,dm.target)+'%';
    const wm=d.week?.mission||{}; $('weeklyTitle').textContent=wm.title||'Misión semanal'; $('weeklyDesc').textContent=wm.description||''; $('weeklyValue').textContent=(wm.value||0)+'/'+(wm.target||0); $('weeklyReward').textContent='+'+(wm.xp||0)+' XP · '+money(wm.coins); $('weeklyPeriod').textContent=wm.periodKey?'Desde '+wm.periodKey:''; $('weeklyBar').style.width=pct(wm.value,wm.target)+'%';
    const g=d.global||{}; $('globalValue').textContent=Number(g.value||0).toLocaleString('es-ES'); $('globalTarget').textContent='/ '+Number(g.target||0).toLocaleString('es-ES')+' minutos'; $('globalBar').style.width=pct(g.value,g.target)+'%'; $('globalReward').textContent='+'+(g.rewardXp||0)+' XP · '+money(g.rewardCoins); if(g.endsAt){$('globalEnd').textContent='Hasta '+new Date(g.endsAt).toLocaleDateString('es-ES');}
    pintarCobro($('dailyClaim'),dm);
    pintarCobro($('weeklyClaim'),wm);
  }

  // Cobrar una misión cumplida, igual que en Progreso (js/macro-progreso.js).
  async function reclamar(tipo){
    const m=tipo==='weekly'?ultimo?.week?.mission:ultimo?.today?.mission;
    if(!m||!m.completed||m.claimed) return;
    const b=$(tipo==='weekly'?'weeklyClaim':'dailyClaim'); b.disabled=true;
    try{
      const d=await json('/api/progreso?action=claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({missionKey:m.key,periodKey:m.periodKey,tipo})});
      show(d.alreadyClaimed?'Esa recompensa ya estaba cobrada.':'🎉 Recompensa cobrada: +'+d.reward.xp+' XP · '+money(d.reward.coins)+'.',true);
      // El saldo nuevo, también en la barra de navegación y en la sesión.
      if(d.user&&d.user.monedas!=null){
        const barra=document.getElementById('navMonedas'); if(barra) barra.textContent=money(d.user.monedas);
        if(window.MRSession&&typeof window.MRSession.update==='function') window.MRSession.update({monedas:Number(d.user.monedas)});
      }
      await loadProgress();
    }catch(e){show(e.message); b.disabled=false;}
  }

  async function loadNotifications(){
    try{
      const usuario=usuarioActual();
      const username=usuario && usuario.nombre ? usuario.nombre : '';
      if(!username) throw new Error('Sesión no disponible');
      const d=await json('/api/content?action=notifications&username='+encodeURIComponent(username));
      const list=(d.notificaciones||[]).slice(0,5); const box=$('notifications');
      box.innerHTML=list.length?list.map(n=>`<div class="md-item"><strong>${esc(n.titulo||'Notificación')}</strong><small>${esc(n.mensaje||'')} · ${new Date(n.created_at).toLocaleString('es-ES')}</small></div>`).join(''):'<p class="md-muted">No tienes novedades pendientes.</p>';
    }catch(e){$('notifications').innerHTML='<p class="md-muted">No se pudieron cargar las notificaciones ahora.</p>';}
  }

  async function loadFriends(){
    try{
      const usuario=usuarioActual();
      const username=usuario && usuario.nombre ? usuario.nombre : '';
      if(!username) throw new Error('Sesión no disponible');
      const d=await json('/api/social?action=friends&username='+encodeURIComponent(username));
      const list=(d.amigos||[]).slice(0,8); const box=$('friends');
      box.innerHTML=list.length?list.map(f=>`<div class="md-friend"><div><strong>@${esc(f.username)}</strong><small>Nivel ${Number(f.level||1)} · ${Number(f.xp||0).toLocaleString('es-ES')} XP</small></div><span class="md-pill">Amigo</span></div>`).join(''):'<p class="md-muted">Todavía no tienes amigos agregados.</p>';
    }catch(e){$('friends').innerHTML='<p class="md-muted">No se pudo cargar tu lista de amigos.</p>';}
  }

  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  $('dailyClaim').addEventListener('click',()=>reclamar('daily'));
  $('weeklyClaim').addEventListener('click',()=>reclamar('weekly'));
  Promise.all([loadProgress(),loadNotifications(),loadFriends()]).catch(e=>show(e.message));
  setInterval(()=>{loadProgress().catch(()=>{});loadNotifications().catch(()=>{});loadFriends().catch(()=>{});},30000);
})();

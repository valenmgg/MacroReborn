(function(){
  "use strict";

  const token = localStorage.getItem("macroSessionToken");
  const errorBox = document.getElementById("progressError");
  if(!token){
    errorBox.hidden = false;
    errorBox.textContent = "Iniciá sesión para ver y guardar tu progreso.";
    return;
  }

  const headers = {"Content-Type":"application/json","Authorization":"Bearer " + token};
  let estado = null;

  function $(id){ return document.getElementById(id); }
  function pct(value,target){ return target > 0 ? Math.max(0,Math.min(100,(value/target)*100)) : 0; }
  function money(n){ return "🪙 " + Number(n || 0).toLocaleString("es-AR"); }

  async function getEstado(){
    const r = await fetch("/api/progreso?action=status", {headers});
    const d = await r.json();
    if(!r.ok || !d.success) throw new Error(d.error || "No se pudo cargar el progreso");
    return d;
  }

  async function post(action, body){
    const r = await fetch("/api/progreso?action=" + encodeURIComponent(action), {method:"POST",headers,body:JSON.stringify(body || {})});
    const d = await r.json();
    if(!r.ok || !d.success) throw new Error(d.error || "No se pudo completar la acción");
    return d;
  }

  function pintar(d){
    estado = d;
    const u = d.user || {};
    const level = Number(u.level || 1);
    const xp = Number(u.xp || 0);
    const coins = Number(u.monedas || 0);
    const rank = u.rank_actual ? "#" + u.rank_actual : "Sin puesto";
    $("levelCard").innerHTML = `<div><div class="mr-kicker">TU CUENTA</div><strong>Nivel ${level}</strong><div>${xp.toLocaleString("es-AR")} XP · ${money(coins)}<br>Ranking: ${rank}</div></div>`;

    // La racha se cuenta sola al jugar (api/_racha.js): aquí solo se dice
    // cómo va. Antes había un botón "Registrar hoy".
    const s = d.streak || {};
    const racha = Number(s.current_streak || 0);
    $("streakCurrent").textContent = racha + " días";
    $("streakBest").textContent = "Mejor: " + Number(s.best_streak || 0);
    $("checkinState").textContent = s.hoy_cuenta ? "Hoy ya cuenta ✓"
      : (racha > 0 ? "Jugá hoy para no perderla" : "Jugá un minuto para empezarla");

    pintarMision(d.today.mission,"daily");
    pintarMision(d.week.mission,"weekly");

    const gv = Number(d.global.value || 0), gt = Number(d.global.target || 0);
    $("globalValue").textContent = gv.toLocaleString("es-AR");
    $("globalTarget").textContent = "/ " + gt.toLocaleString("es-AR") + " minutos";
    $("globalBar").style.width = pct(gv,gt) + "%";
    $("globalReward").textContent = "Recompensa: +" + Number(d.global.rewardXp||0) + " XP · " + money(d.global.rewardCoins);
  }

  function pintarMision(m,tipo){
    $(tipo+"Title").textContent = m.title;
    $(tipo+"Description").textContent = m.description;
    $(tipo+"Value").textContent = m.value + "/" + m.target;
    $(tipo+"Reward").textContent = "+" + m.xp + " XP · " + money(m.coins);
    $(tipo+"Bar").style.width = pct(m.value,m.target) + "%";
    const b = $(tipo === "weekly" ? "weeklyClaim" : "dailyClaim");
    b.disabled = !m.completed || m.claimed;
    b.textContent = m.claimed ? "Reclamada ✓" : (m.completed ? "Reclamar recompensa" : "Completá la misión");
    $(tipo+"Period").textContent = tipo === "daily" ? m.periodKey : "Desde " + m.periodKey;
  }

  async function claim(tipo){
    const key = tipo === "weekly" ? "week" : "today";
    const m = estado && estado[key]?.mission;
    if(!m || !m.completed || m.claimed) return;
    const b = $(tipo === "weekly" ? "weeklyClaim" : "dailyClaim");
    b.disabled = true;
    try{
      const d = await post("claim", {missionKey:m.key, periodKey:m.periodKey, tipo});
      $("progressError").hidden = false;
      $("progressError").style.color = "#8be4cb";
      $("progressError").textContent = d.alreadyClaimed ? "La recompensa ya había sido reclamada." : "Recompensa entregada: +" + d.reward.xp + " XP · " + money(d.reward.coins) + ".";
      pintar(await getEstado());
    }catch(e){
      $("progressError").hidden = false;
      $("progressError").style.color = "#ff9d9d";
      $("progressError").textContent = e.message;
      b.disabled = false;
    }
  }

  $("dailyClaim").addEventListener("click",()=>claim("daily"));
  $("weeklyClaim").addEventListener("click",()=>claim("weekly"));

  getEstado().then(pintar).catch(e=>{
    errorBox.hidden = false;
    errorBox.textContent = e.message;
  });
})();

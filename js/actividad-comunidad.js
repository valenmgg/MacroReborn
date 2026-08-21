(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const activeUser = (() => { try { return (window.MRSession && typeof window.MRSession.get === "function") ? window.MRSession.get() : JSON.parse(localStorage.getItem('usuarioActivo') || 'null'); } catch (_) { return null; } })();
  const state = { users: [], friends: [], globalFeed: [], online: [] };

  const escapeHTML = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[char]));
  const relativeTime = (value) => { const t = new Date(value).getTime(); if (!Number.isFinite(t)) return ''; const delta = Math.max(0, Date.now()-t); const mins = Math.floor(delta/60000); if(mins<1)return 'Ahora'; if(mins<60)return `Hace ${mins} min`; const hrs=Math.floor(mins/60); if(hrs<24)return `Hace ${hrs} h`; const days=Math.floor(hrs/24); return `Hace ${days} d`; };

  async function getJSON(url) { try { const response = await fetch(url, { credentials: 'same-origin' }); if (!response.ok) return null; return await response.json(); } catch (_) { return null; } }

  function normalizeUsers(data) { return (data?.users || []).map((u) => ({ name: u.username, level: Number(u.level) || 1, xp: Number(u.xp) || 0, avatar: u.avatar, lastLogin: u.last_login })); }

  function isOnline(user) { if (!user?.lastLogin) return false; const t = new Date(user.lastLogin).getTime(); return Number.isFinite(t) && (Date.now()-t) <= 10*60*1000; }

  function avatarHTML(user) {
    if (!user?.avatar) return '<span>👤</span>';
    const avatar = typeof normalizarAvatar === "function" ? normalizarAvatar(user.avatar) : user.avatar;
    if(typeof avatarPNGData === "function" && avatarPNGData(avatar)){
      return `<img src="${avatarPNGData(avatar)}" class="avatar-png-personalizado" alt="" loading="lazy">`;
    }
    if(typeof avatarMiniaturaHTML === "function"){
      return avatarMiniaturaHTML(avatar);
    }
    return '<span>👤</span>';
  }

  function activityText(item) {
    const username = escapeHTML(item.username || 'Jugador');
    let detail = item.detalle || '';
    try { const parsed = JSON.parse(detail); if (parsed && typeof parsed === 'object') { if (parsed.juego) detail = `${parsed.juego}`; else if ('texto' in parsed) detail = parsed.texto || ''; } } catch (_) {}
    const cleanDetail = escapeHTML(detail);
    switch (item.tipo) {
      case 'logro': return `🏅 <a href="usuario.html?usuario=${encodeURIComponent(item.username)}">${username}</a> desbloqueó un logro${cleanDetail ? `: <strong>${cleanDetail}</strong>` : ''}`;
      case 'amigo': return `🤝 <a href="usuario.html?usuario=${encodeURIComponent(item.username)}">${username}</a> hizo una nueva amistad${cleanDetail ? ` con <strong>${cleanDetail}</strong>` : ''}`;
      case 'comentario': return `💬 <a href="usuario.html?usuario=${encodeURIComponent(item.username)}">${username}</a> publicó un comentario${cleanDetail ? `: “${cleanDetail.slice(0,140)}”` : ''}`;
      case 'resena': return `📝 <a href="usuario.html?usuario=${encodeURIComponent(item.username)}">${username}</a> dejó una reseña${cleanDetail ? ` sobre <strong>${cleanDetail}</strong>` : ''}`;
      case 'like_juego': return `👍 <a href="usuario.html?usuario=${encodeURIComponent(item.username)}">${username}</a> dio me gusta a <strong>${cleanDetail || 'un juego'}</strong>`;
      default: return `🎮 <a href="usuario.html?usuario=${encodeURIComponent(item.username)}">${username}</a> tuvo actividad en la comunidad`;
    }
  }

  function renderGlobal() {
    const target = $('#feedGlobal');
    if (!target) return;
    if (!state.globalFeed.length) { target.innerHTML = '<div class="social-empty">Todavía no hay actividad pública reciente.</div>'; return; }
    target.innerHTML = state.globalFeed.map((item) => `
      <article class="social-feed-item">
        <a class="social-avatar" href="usuario.html?usuario=${encodeURIComponent(item.username || '')}" aria-label="Ver perfil">${avatarHTML(item)}</a>
        <div><p class="social-feed-text">${activityText(item)}</p><p class="social-feed-detail">Actividad de la comunidad · ${escapeHTML(item.tipo || 'evento')}</p></div>
        <span class="social-feed-time">${escapeHTML(relativeTime(item.created_at))}</span>
      </article>`).join('');
  }

  function renderFriends() {
    const target = $('#feedAmigos');
    if (!target) return;
    if (!activeUser) { target.innerHTML = '<div class="social-empty">Iniciá sesión para ver la actividad de tus amigos.</div>'; return; }
    if (!state.friends.length) { target.innerHTML = '<div class="social-empty">Todavía no tenés amigos agregados.</div>'; return; }
    const onlineSet = new Set(state.online.map((u) => u.name));
    target.innerHTML = state.friends.slice(0,8).map((friend) => {
      const online = onlineSet.has(friend.username);
      return `<div class="friend-card"><span class="status-dot ${online ? 'online' : ''}"></span><a href="usuario.html?usuario=${encodeURIComponent(friend.username)}">${escapeHTML(friend.username)}</a><span class="badge-level">Nivel ${Number(friend.level)||1}</span></div>`;
    }).join('');
  }

  function renderOnline() {
    const target = $('#jugadoresOnline');
    if (!target) return;
    const query = ($('#buscarJugador')?.value || '').trim().toLowerCase();
    const filtered = state.online.filter((u) => !query || u.name.toLowerCase().includes(query)).slice(0,20);
    if (!filtered.length) { target.innerHTML = '<div class="social-empty">No encontramos jugadores conectados.</div>'; return; }
    target.innerHTML = filtered.map((u) => `<div class="online-card"><span class="status-dot"></span><a href="usuario.html?usuario=${encodeURIComponent(u.name)}">${escapeHTML(u.name)}</a><span class="online-meta">Nivel ${u.level}</span></div>`).join('');
  }

  async function load() {
    const [users, feed] = await Promise.all([
      getJSON('/api/users?limit=500'),
      getJSON('/api/content?action=community-feed&limit=30')
    ]);
    state.users = normalizeUsers(users);
    state.online = state.users.filter(isOnline);
    state.globalFeed = Array.isArray(feed?.actividades) ? feed.actividades : [];

    if (activeUser?.nombre) {
      const friends = await getJSON(`/api/social?action=friends&username=${encodeURIComponent(activeUser.nombre)}`);
      state.friends = friends?.success ? (friends.amigos || []) : [];
    }

    const notif = activeUser?.nombre ? await getJSON(`/api/content?action=notifications&username=${encodeURIComponent(activeUser.nombre)}`) : null;
    const unread = notif?.success ? (notif.notificaciones || []).filter((n) => !n.leida).length : 0;

    $('#statRegistrados').textContent = state.users.length.toLocaleString('es-ES');
    $('#statConectados').textContent = state.online.length.toLocaleString('es-ES');
    $('#statActividad').textContent = state.globalFeed.length.toLocaleString('es-ES');
    $('#statNotificaciones').textContent = activeUser ? unread.toLocaleString('es-ES') : '—';

    renderGlobal();
    renderFriends();
    renderOnline();
    $('#socialEmptySession')?.classList.toggle('hidden', Boolean(activeUser));
  }

  $('#buscarJugador')?.addEventListener('input', renderOnline);
  $('#btnActualizar')?.addEventListener('click', () => { load(); });

  load();
  setInterval(load, 30000);
})();

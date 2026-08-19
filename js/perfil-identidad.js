(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const escapeHTML = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;'
  }[char]));

  function readActiveUser() {
    try {
      const raw = localStorage.getItem('usuarioActivo');
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  async function fetchJSON(url) {
    try {
      if (window.MRApi && typeof MRApi.requestShared === 'function') {
        return await MRApi.requestShared('GET', url, { credentials: 'same-origin' });
      }

      const response = await fetch(url, { credentials: 'same-origin' });
      if (!response.ok) return null;
      return await response.json();
    } catch (_) {
      return null;
    }
  }

  function number(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function levelFromXP(xp) {
    const currentXP = Math.max(0, number(xp));
    if (currentXP < 100) return 1;
    return 2 + Math.floor((currentXP - 100) / 200);
  }

  function buildCard({ icon, label, value, detail }) {
    return `
      <article class="mr-identidad-stat">
        <div class="mr-identidad-stat-icon">${icon}</div>
        <div class="mr-identidad-stat-copy">
          <span>${escapeHTML(label)}</span>
          <strong>${escapeHTML(value)}</strong>
          ${detail ? `<small>${escapeHTML(detail)}</small>` : ''}
        </div>
      </article>`;
  }

  function createShell() {
    const header = $('.perfil-datos-cabecera');
    if (!header || $('#mrIdentidadHub')) return null;

    const hub = document.createElement('section');
    hub.id = 'mrIdentidadHub';
    hub.className = 'mr-identidad-hub';
    hub.setAttribute('aria-label', 'Resumen de identidad gamer');
    hub.innerHTML = `
      <div class="mr-identidad-hero">
        <div class="mr-identidad-hero-main">
          <span class="mr-identidad-kicker">IDENTIDAD GAMER</span>
          <h2 id="mrIdentidadTitulo">Tu perfil, tu progreso</h2>
          <p id="mrIdentidadSubtitulo">Tu actividad, juegos y progreso reunidos en un solo lugar.</p>
        </div>
        <div class="mr-identidad-quick-actions" aria-label="Accesos rápidos">
          <a href="progreso.html" class="mr-identidad-action">🎯 Progreso</a>
          <a href="comunidad-ranking.html" class="mr-identidad-action">🏆 Ranking</a>
          <a href="comunidad.html" class="mr-identidad-action">👥 Comunidad</a>
        </div>
      </div>
      <div class="mr-identidad-grid" id="mrIdentidadStats">
        <div class="mr-identidad-loading">Cargando estadísticas…</div>
      </div>
      <div class="mr-identidad-lower">
        <section class="mr-identidad-panel">
          <div class="mr-identidad-panel-title">
            <div><span>🎮</span><div><strong>Tu actividad de juego</strong><small>Resumen de tus últimos movimientos</small></div></div>
            <button type="button" data-mr-tab="ultimos">Ver historial</button>
          </div>
          <div id="mrIdentidadActividad" class="mr-identidad-list"><div class="mr-identidad-loading">Cargando…</div></div>
        </section>
        <section class="mr-identidad-panel">
          <div class="mr-identidad-panel-title">
            <div><span>❤️</span><div><strong>Tus favoritos</strong><small>Juegos que quieres tener a mano</small></div></div>
            <button type="button" data-mr-tab="favoritos">Ver favoritos</button>
          </div>
          <div id="mrIdentidadFavoritos" class="mr-identidad-list"><div class="mr-identidad-loading">Cargando…</div></div>
        </section>
      </div>
      <div class="mr-identidad-footer-actions">
        <button type="button" data-mr-tab="amigos">🤝 Mis amigos</button>
        <button type="button" data-mr-tab="avatares">🧑 Personalizar avatar</button>
        <button type="button" data-mr-tab="logros">🏅 Mis logros</button>
        <a href="comunidad-ranking.html">🛒 Tienda y colección</a>
      </div>`;

    header.insertAdjacentElement('afterend', hub);
    return hub;
  }

  function switchTab(tabName) {
    const button = document.querySelector(`.menu-perfil .tab[data-tab="${CSS.escape(tabName)}"]`);
    if (button) button.click();
  }

  function wireActions(root) {
    root.querySelectorAll('[data-mr-tab]').forEach((control) => {
      control.addEventListener('click', () => switchTab(control.dataset.mrTab));
    });
  }

  function renderStats(root, user, history, favorites, friends) {
    const xp = number(user?.xp);
    const level = number(user?.nivel) || levelFromXP(xp);
    const coins = number(user?.monedas ?? user?.moneda ?? user?.coins);
    const rankValue = Number(user?.rank_actual);
    const ranking = Number.isFinite(rankValue) && rankValue > 0
      ? `#${rankValue}`
      : ($('#ranking')?.textContent?.trim() || 'Sin clasificar');

    root.querySelector('#mrIdentidadTitulo').textContent = `Perfil de ${user?.nombre || $('#nombreUsuario')?.textContent?.trim() || 'jugador'}`;
    root.querySelector('#mrIdentidadSubtitulo').textContent = user?.biografia || 'Construye tu identidad gamer, sube de nivel y deja tu huella en MacroReborn.';

    root.querySelector('#mrIdentidadStats').innerHTML = [
      buildCard({ icon: '⭐', label: 'Nivel', value: `Nivel ${level}`, detail: `${xp.toLocaleString('es-ES')} XP` }),
      buildCard({ icon: '🏆', label: 'Ranking', value: ranking, detail: 'Posición global' }),
      buildCard({ icon: '🪙', label: 'Monedas', value: coins.toLocaleString('es-ES'), detail: 'Saldo disponible' }),
      buildCard({ icon: '🎮', label: 'Juegos jugados', value: history.length.toLocaleString('es-ES'), detail: 'Registrados en tu cuenta' }),
      buildCard({ icon: '❤️', label: 'Favoritos', value: favorites.length.toLocaleString('es-ES'), detail: 'Juegos guardados' }),
      buildCard({ icon: '🤝', label: 'Amigos', value: friends.length.toLocaleString('es-ES'), detail: 'Conexiones' })
    ].join('');
  }

  function findCatalogGame(idOrGame) {
    const item = idOrGame?.juego || idOrGame?.game || idOrGame;
    if (item && typeof item === 'object' && (item.nombre || item.name || item.titulo || item.imagen || item.image)) {
      return item;
    }

    const id = item?.game_id ?? item?.id ?? item;
    if (id == null) return null;

    const catalog = (typeof juegos !== 'undefined' && Array.isArray(juegos)) ? juegos : [];
    return catalog.find((juego) => String(juego.id) === String(id)) || null;
  }

  function normalizeGame(item) {
    const game = findCatalogGame(item);
    if (!game) return null;
    return {
      name: game.nombre || game.name || game.titulo || 'Juego',
      image: game.imagen || game.image || 'imagenes/logo.png',
      id: game.id ?? game.game_id ?? null,
      slug: game.slug || game.codigo || null
    };
  }

  function gameHref(game) {
    if (game.slug) return `juego.html?id=${encodeURIComponent(game.slug)}`;
    if (game.id != null) return `juego.html?id=${encodeURIComponent(game.id)}`;
    return 'juegos.html';
  }

  function renderGameList(target, items, emptyText) {
    const games = items.map(normalizeGame).filter(Boolean).slice(0, 4);
    if (!games.length) {
      target.innerHTML = `<p class="mr-identidad-empty">${escapeHTML(emptyText)}</p>`;
      return;
    }
    target.innerHTML = games.map((game) => `
      <a class="mr-identidad-game" href="${escapeHTML(gameHref(game))}">
        <img src="${escapeHTML(game.image)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='imagenes/logo.png';">
        <span>${escapeHTML(game.name)}</span>
      </a>`).join('');
  }

  function obtenerUsuarioPerfilPropio() {
    if (window.MRProfileContext && MRProfileContext.type === 'own' && typeof MRProfileContext.getUser === 'function') {
      return MRProfileContext.getUser();
    }
    if (typeof datosUsuario !== 'undefined' && datosUsuario) return datosUsuario;
    if (window.MRSession && typeof MRSession.get === 'function') return MRSession.get();
    return null;
  }

  function refreshVisibleSessionStats(root) {
    if (!root) return;
    const user = obtenerUsuarioPerfilPropio();
    if (!user) return;

    const xp = number(user.xp);
    const level = number(user.nivel) || levelFromXP(xp);
    const coins = number(user.monedas ?? user.moneda ?? user.coins);
    const stats = root.querySelectorAll('.mr-identidad-stat');
    if (stats[0]) {
      const strong = stats[0].querySelector('strong');
      const small = stats[0].querySelector('small');
      if (strong) strong.textContent = `Nivel ${level}`;
      if (small) small.textContent = `${xp.toLocaleString('es-ES')} XP`;
    }
    if (stats[1]) {
      const strong = stats[1].querySelector('strong');
      if (strong) {
        const rankValue = Number(user.rank_actual);
        strong.textContent = Number.isFinite(rankValue) && rankValue > 0 ? `#${rankValue}` : ($('#ranking')?.textContent?.trim() || 'Sin clasificar');
      }
    }
    if (stats[2]) {
      const strong = stats[2].querySelector('strong');
      if (strong) strong.textContent = coins.toLocaleString('es-ES');
    }
    const title = root.querySelector('#mrIdentidadTitulo');
    const subtitle = root.querySelector('#mrIdentidadSubtitulo');
    if (title && user.nombre) title.textContent = `Perfil de ${user.nombre}`;
    if (subtitle && user.biografia) subtitle.textContent = user.biografia;
  }

  let cargaPerfilEnCurso = null;
  let refrescoProgramado = null;
  let snapshot = { history: [], favorites: [], friends: [], ready: false };

  function obtenerNombrePerfil() {
    const user = obtenerUsuarioPerfilPropio() || readActiveUser() || {};
    return user.nombre || user.username || $('#nombreUsuario')?.textContent?.trim() || '';
  }

  function pintarSnapshot(root, user) {
    renderStats(root, user, snapshot.history, snapshot.favorites, snapshot.friends);
    renderGameList(root.querySelector('#mrIdentidadActividad'), snapshot.history, 'Todavía no hay juegos registrados en tu historial.');
    renderGameList(root.querySelector('#mrIdentidadFavoritos'), snapshot.favorites, 'Todavía no guardaste juegos como favoritos.');
    refreshVisibleSessionStats(root);
  }

  async function load(root, options = {}) {
    if (!root) return;
    if (cargaPerfilEnCurso) return cargaPerfilEnCurso;

    const forceSessionRefresh = options.refreshSession === true;
    const refreshParts = Array.isArray(options.parts) && options.parts.length
      ? new Set(options.parts)
      : new Set(['history', 'favorites', 'friends']);

    cargaPerfilEnCurso = (async () => {
      let storedUser = obtenerUsuarioPerfilPropio() || readActiveUser() || {};

      // Solo sincronizamos con Neon cuando realmente cambió la sesión o
      // la carga inicial lo requiere. Los eventos de juego/logro/actividad
      // pueden actualizar únicamente la parte afectada.
      if (forceSessionRefresh && window.MRApp && typeof MRApp.refreshSession === 'function') {
        const remoto = await MRApp.refreshSession();
        if (remoto) storedUser = remoto;
      }

      const username = storedUser.nombre || storedUser.username || $('#nombreUsuario')?.textContent?.trim();
      if (!username) return;

      if (refreshParts.has('history') || refreshParts.has('favorites') || refreshParts.has('friends')) {
        const encoded = encodeURIComponent(username);
        const jobs = [];
        if (refreshParts.has('history')) jobs.push(fetchJSON(`/api/content?action=game-history&username=${encoded}`).then(data => {
          if (data?.success) snapshot.history = data.historial || [];
        }));
        if (refreshParts.has('favorites')) jobs.push(fetchJSON(`/api/content?action=favorites&username=${encoded}`).then(data => {
          if (data?.success) snapshot.favorites = data.favoritos || [];
        }));
        if (refreshParts.has('friends')) jobs.push(fetchJSON(`/api/social?action=friends&username=${encoded}`).then(data => {
          if (data?.success) snapshot.friends = data.amigos || [];
        }));
        await Promise.all(jobs);
      }

      snapshot.ready = true;
      pintarSnapshot(root, storedUser);
    })();

    try {
      return await cargaPerfilEnCurso;
    } finally {
      cargaPerfilEnCurso = null;
    }
  }

  function programarRefresco(root, options = {}) {
    const refreshSession = options.refreshSession === true;
    const requestedParts = Array.isArray(options.parts) && options.parts.length
      ? options.parts
      : ['history', 'favorites', 'friends'];

    if (refrescoProgramado) {
      refrescoProgramado.refreshSession = refrescoProgramado.refreshSession || refreshSession;
      requestedParts.forEach(part => refrescoProgramado.parts.add(part));
      return;
    }

    const estado = { refreshSession, parts: new Set(requestedParts) };
    refrescoProgramado = estado;
    setTimeout(() => {
      const debeRefrescarSesion = estado.refreshSession;
      const partes = Array.from(estado.parts);
      refrescoProgramado = null;
      load(root, { refreshSession: debeRefrescarSesion, parts: partes });
    }, 120);
  }

  function subscribeToProfileEvents(root) {
    if (window.MRSession && typeof MRSession.subscribe === 'function') {
      MRSession.subscribe(() => {
        // MRSession es solo la fuente de cambios de la CUENTA PROPIA.
        // El usuario mostrado sigue viniendo de MRProfileContext.
        refreshVisibleSessionStats(root);
      });
    }

    const handlers = {
      'macro:game-played': () => programarRefresco(root, { parts: ['history'] }),
      // Un logro no modifica el historial/favoritos/amigos del resumen.
      // perfil-realtime.js se encarga de refrescar el bloque de logros.
      'macro:achievement-unlocked': () => refreshVisibleSessionStats(root),
      // Solo una actividad de tipo juego cambia el conteo de juegos jugados.
      'macro:activity-recorded': (detail) => {
        if (detail && String(detail.tipo || '').toLowerCase() === 'juego') {
          programarRefresco(root, { parts: ['history'] });
        }
      },
      'macro:session-change': () => programarRefresco(root, { refreshSession: true })
    };

    if (window.MRApp && MRApp.events && typeof MRApp.events.on === 'function') {
      Object.entries(handlers).forEach(([eventName, handler]) => MRApp.events.on(eventName, handler));
    } else {
      Object.entries(handlers).forEach(([eventName, handler]) => window.addEventListener(eventName, handler));
    }
  }

  function init() {
    const root = createShell();
    if (!root) return;
    wireActions(root);
    subscribeToProfileEvents(root);
    load(root, { refreshSession: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();

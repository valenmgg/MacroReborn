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
    const ranking = $('#ranking')?.textContent?.trim() || 'Sin clasificar';
    const achievements = $('#puntosLogros')?.textContent?.trim() || '0 puntos';

    root.querySelector('#mrIdentidadTitulo').textContent = `Perfil de ${user?.nombre || $('#nombreUsuario')?.textContent?.trim() || 'jugador'}`;
    root.querySelector('#mrIdentidadSubtitulo').textContent = user?.biografia || 'Construye tu identidad gamer, sube de nivel y deja tu huella en MacroReborn.';

    root.querySelector('#mrIdentidadStats').innerHTML = [
      buildCard({ icon: '⭐', label: 'Nivel', value: `Nivel ${level}`, detail: `${xp.toLocaleString('es-ES')} XP` }),
      buildCard({ icon: '🏆', label: 'Ranking', value: ranking, detail: 'Posición global' }),
      buildCard({ icon: '🪙', label: 'Monedas', value: coins.toLocaleString('es-ES'), detail: 'Saldo disponible' }),
      buildCard({ icon: '🎮', label: 'Juegos jugados', value: history.length.toLocaleString('es-ES'), detail: 'Registrados en tu cuenta' }),
      buildCard({ icon: '❤️', label: 'Favoritos', value: favorites.length.toLocaleString('es-ES'), detail: 'Juegos guardados' }),
      buildCard({ icon: '🤝', label: 'Amigos', value: friends.length.toLocaleString('es-ES'), detail: achievements })
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

  async function load(root) {
    const storedUser = (typeof datosUsuario !== 'undefined' && datosUsuario) || readActiveUser() || {};
    const username = storedUser.nombre || $('#nombreUsuario')?.textContent?.trim();

    if (!username) return;

    const encoded = encodeURIComponent(username);
    const [profileData, historyData, favoritesData, friendsData] = await Promise.all([
      fetchJSON(`/api/users?username=${encoded}`),
      fetchJSON(`/api/content?action=game-history&username=${encoded}`),
      fetchJSON(`/api/content?action=favorites&username=${encoded}`),
      fetchJSON(`/api/social?action=friends&username=${encoded}`)
    ]);

    // La sesión guardada en localStorage puede quedar desactualizada
    // (por ejemplo, después de ganar/gastar monedas). Para este resumen
    // usamos siempre el usuario actual de Neon y sincronizamos la caché
    // local para que navbar/perfil compartan el mismo saldo.
    let user = storedUser;
    if (profileData?.success && profileData.user) {
      user = {
        ...profileData.user,
        nombre: profileData.user.username,
        nivel: profileData.user.level
      };
      try {
        localStorage.setItem('usuarioActivo', JSON.stringify(user));
      } catch (_) {}
    }

    const history = historyData?.success ? (historyData.historial || []) : [];
    const favorites = favoritesData?.success ? (favoritesData.favoritos || []) : [];
    const friends = friendsData?.success ? (friendsData.amigos || []) : [];

    renderStats(root, user, history, favorites, friends);
    renderGameList(root.querySelector('#mrIdentidadActividad'), history, 'Todavía no hay juegos registrados en tu historial.');
    renderGameList(root.querySelector('#mrIdentidadFavoritos'), favorites, 'Todavía no guardaste juegos como favoritos.');
  }

  function init() {
    const root = createShell();
    if (!root) return;
    wireActions(root);
    load(root);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();

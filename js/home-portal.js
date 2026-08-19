// ============================================================================
// MACROREBORN — HOME PORTAL 2.0
// Capa adicional para la portada. No modifica ni reemplaza js/home.js.
// ============================================================================
(function () {
  "use strict";

  function juegosDisponibles() {
    return (typeof juegos !== "undefined" && Array.isArray(juegos)) ? juegos : [];
  }

  function esc(texto) {
    return String(texto == null ? "" : texto)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function usuarioActivo() {
    try {
      return typeof leerJSON === "function"
        ? leerJSON(localStorage.getItem("usuarioActivo") || "null")
        : null;
    } catch (_) { return null; }
  }

  async function json(url, fallback) {
    try {
      const resp = await fetch(url, { headers: { Accept: "application/json" } });
      const datos = await resp.json();
      return datos || fallback;
    } catch (_) { return fallback; }
  }

  function tarjeta(juego, variante) {
    const badge = juego.estado || (variante === "nuevo" ? "🆕 Nuevo" : juego.categoria || "Juegos");
    return `<article class="portal-juego-card ${variante ? `portal-juego-card-${variante}` : ""}">
      <a href="juego.html?id=${encodeURIComponent(juego.id)}" class="portal-juego-link" aria-label="Jugar ${esc(juego.nombre)}">
        <div class="portal-juego-imagen">
          ${typeof crearImagenJuego === "function" ? crearImagenJuego(juego) : `<img src="${esc(juego.imagen || "imagenes/logo.png")}" alt="${esc(juego.nombre)}" loading="lazy">`}
          <span class="portal-juego-badge">${esc(badge)}</span>
          <span class="portal-juego-overlay"><span>▶ Jugar</span></span>
        </div>
        <div class="portal-juego-info"><h3>${esc(juego.nombre)}</h3><span class="portal-juego-meta">${esc(juego.categoria || "Juegos")}</span></div>
      </a>
    </article>`;
  }

  function render(id, items, variante, limite) {
    const host = document.getElementById(id);
    if (!host) return;
    const lista = (items || []).slice(0, limite || 6);
    host.innerHTML = lista.length ? lista.map(item => tarjeta(item, variante)).join("")
      : `<div class="portal-vacio">Todavía no hay juegos para mostrar en esta sección.</div>`;
  }

  function fechaNueva(a, b) { return (Number(b.id) || 0) - (Number(a.id) || 0); }

  function ordenar(resumen, campo) {
    return juegosDisponibles().slice().sort((a, b) => {
      const va = Number((resumen[String(a.id)] || {})[campo] || 0);
      const vb = Number((resumen[String(b.id)] || {})[campo] || 0);
      return vb - va || fechaNueva(a, b);
    });
  }

  function iniciarBusqueda() {
    const form = document.getElementById("portalHomeBusqueda");
    const input = document.getElementById("portalHomeBusquedaInput");
    if (!form || !input) return;
    form.addEventListener("submit", event => {
      event.preventDefault();
      const q = input.value.trim();
      window.location.href = q ? `juegos.html?q=${encodeURIComponent(q)}` : "juegos.html";
    });
  }

  function iconoCategoria(categoria) {
    const mapa = {
      "Acción":"⚔️","Aventura":"🗺️","RPG":"🧙","Carreras":"🏎️","Deportes":"⚽",
      "Puzzle":"🧩","Arcade":"👾","Terror":"👻","Estrategia":"♟️","Simulación":"🛠️",
      "Plataformas":"🕹️"
    };
    return mapa[categoria] || "🎮";
  }

  async function cargarDashboard() {
    const seccion = document.getElementById("portalSeccionPersonal");
    const host = document.getElementById("homeDashboard");
    const activo = usuarioActivo();
    if (!seccion || !host || !activo || !activo.nombre) return;

    const [uRes, amigosRes, logrosRes, favRes] = await Promise.all([
      (window.MRApi && typeof MRApi.requestShared === 'function'
      ? MRApi.requestShared('GET', `/api/users?username=${encodeURIComponent(activo.nombre)}`, { credentials: 'same-origin' })
      : json(`/api/users?username=${encodeURIComponent(activo.nombre)}`, {})),
      json(`/api/social?action=friends&username=${encodeURIComponent(activo.nombre)}`, {}),
      json(`/api/social?action=achievements&username=${encodeURIComponent(activo.nombre)}`, {}),
      json(`/api/content?action=favorites&username=${encodeURIComponent(activo.nombre)}`, {})
    ]);

    const user = uRes && uRes.success ? uRes.user : activo;
    const nivel = Math.max(1, Number(user.level || user.nivel || 1));
    const xp = Math.max(0, Number(user.xp || 0));
    const siguiente = nivel === 1 ? 50 : (nivel === 2 ? 100 : 100 + ((nivel - 2) * 200));
    const progreso = Math.max(0, Math.min(100, xp / siguiente * 100));
    const amigos = amigosRes && Array.isArray(amigosRes.amigos) ? amigosRes.amigos : [];
    const logros = logrosRes && Array.isArray(logrosRes.logros) ? logrosRes.logros : [];
    const favoritos = favRes && Array.isArray(favRes.favoritos) ? favRes.favoritos : [];
    const monedas = Number(user.monedas ?? activo.monedas ?? 0);
    const ranking = Number(user.rank_actual || 0);
    const avatar = typeof avatarMiniaturaHTML === "function" ? avatarMiniaturaHTML(user.avatar) : `<img src="imagenes/avatar.png" alt="Avatar">`;

    const amigosHtml = amigos.slice(0, 5).map(amigo => `<a class="portal-amigo-mini" href="usuario.html?usuario=${encodeURIComponent(amigo.username)}">
      <span class="portal-amigo-avatar">${typeof avatarMiniaturaHTML === "function" ? avatarMiniaturaHTML(amigo.avatar) : "👤"}</span>
      <span><b>${esc(amigo.username)}</b><small>Nivel ${Number(amigo.level || 1)}</small></span>
    </a>`).join("");

    host.innerHTML = `<div class="portal-dashboard-grid">
      <article class="portal-dashboard-card portal-dashboard-profile">
        <div class="portal-profile-line"><div class="portal-dashboard-avatar">${avatar}</div>
          <div><span class="portal-kicker">TU PERFIL</span><h3>${esc(user.username || activo.nombre)}</h3><p>Nivel ${nivel} · ${xp.toLocaleString("es-AR")} XP</p></div></div>
        <div class="portal-xp-track"><span style="width:${progreso}%"></span></div>
        <div class="portal-xp-label"><span>${xp.toLocaleString("es-AR")} XP</span><span>${siguiente.toLocaleString("es-AR")} XP</span></div>
        <div class="portal-stat-row">
          <span><b>🪙 ${monedas.toLocaleString("es-AR")}</b><small>Monedas</small></span>
          <span><b>🏆 ${logros.length}</b><small>Logros</small></span>
          <span><b>❤️ ${favoritos.length}</b><small>Favoritos</small></span>
          <span><b>#${ranking || "—"}</b><small>Ranking</small></span>
        </div>
        <div class="portal-dashboard-actions"><a href="perfil.html">👤 Ver perfil</a><a href="perfil.html#personalizacion">🎨 Personalizar</a></div>
      </article>
      <article class="portal-dashboard-card">
        <div class="portal-dashboard-card-head"><h3>👥 Mis amigos</h3><a href="amigos.html">Ver todos →</a></div>
        <div class="portal-amigos-mini-list">${amigosHtml || `<div class="portal-vacio">Todavía no tenés amigos agregados.</div>`}</div>
      </article>
    </div>`;
    seccion.hidden = false;
  }

  async function iniciar() {
    iniciarBusqueda();
    const lista = juegosDisponibles();
    const total = document.getElementById("homeTotalJuegos");
    if (total) total.textContent = lista.length;
    render("homeDestacados", lista.filter(j => j.tipo === "destacado"), "destacado", 6);
    render("homeNuevos", lista.slice().sort(fechaNueva), "nuevo", 6);

    const resumenRes = await json("/api/content?action=games-overview", {});
    const resumen = resumenRes && resumenRes.success ? (resumenRes.juegos || {}) : {};
    render("homeTrending", ordenar(resumen, "tendencia"), "trending", 6);
    render("homeMasJugados", ordenar(resumen, "partidas"), "jugado", 6);
    render("homeMejorValorados", ordenar(resumen, "promedio"), "valorado", 6);

    const activo = usuarioActivo();
    if (activo && activo.nombre) {
      const historialRes = await json(`/api/content?action=game-history&username=${encodeURIComponent(activo.nombre)}`, {});
      const ids = historialRes && Array.isArray(historialRes.historial) ? historialRes.historial.map(String) : [];
      const mapa = new Map(lista.map(j => [String(j.id), j]));
      const historial = ids.map(id => mapa.get(id)).filter(Boolean);
      render("homeContinuar", historial, "continuar", 5);
      const sec = document.getElementById("portalSeccionContinuar");
      if (sec) sec.hidden = historial.length === 0;
      await cargarDashboard();
    }

    const categorias = document.getElementById("homeCategorias");
    if (categorias) {
      const mapa = lista.reduce((acc, juego) => {
        const cat = juego.categoria || "Otros";
        acc[cat] = (acc[cat] || 0) + 1;
        return acc;
      }, {});
      categorias.innerHTML = Object.entries(mapa).sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0], "es"))
        .map(([cat, total]) => `<a class="portal-categoria-card" href="juegos.html?categoria=${encodeURIComponent(cat)}"><span class="portal-categoria-icon">${iconoCategoria(cat)}</span><span><strong>${esc(cat)}</strong><small>${total} juegos</small></span></a>`).join("");
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();

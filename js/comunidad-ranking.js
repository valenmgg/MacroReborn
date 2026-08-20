// ==============================
// COMUNIDAD + RANKING - MacroReborn
// ==============================
// Página combinada (antes eran ranking.html y comunidad.html por
// separado). Se escribió como archivo nuevo e independiente en vez
// de cargar js/ranking.js y js/comunidad.js juntos, porque ambos
// declaran variables globales con el mismo nombre ("const buscador")
// y cargarlos en la misma página rompía todo el script con un
// SyntaxError. De esta forma ranking.js y comunidad.js quedan
// intactos y se siguen usando tal cual en perfil.html/usuario.html.
//
// De paso, como ranking y comunidad necesitan la misma lista de
// usuarios, acá se pide UNA sola vez a /api/users y se reusa para
// las dos secciones (antes cada página hacía su propio pedido).
//
// Ranking por tiempo jugado: el orden del ranking (podio + resto)
// YA NO sale de nivel/XP: sale de rank_actual, que calcula el
// servidor una vez por semana según minutos jugados, frecuencia
// (días activos) y diversidad de juegos (ver api/system.js ->
// recalcularRanking()). Acá solo se ordena por esa posición ya
// calculada y se muestra cuánto lleva jugado cada uno esta semana,
// a modo informativo (eso no mueve la posición hasta el próximo
// lunes).


// ---------- ELEMENTOS: RANKING ----------

const rkPodio = document.getElementById("podioTop6");
const rkResto = document.getElementById("listaRankingResto");
const rkBuscador = document.getElementById("buscarRankingJugador");
const rkBotonLogros = document.getElementById("botonRankingLogros");
const rkMiPosicion = document.getElementById("rkMiPosicion");
const rkModos = Array.from(document.querySelectorAll(".rk-modo"));
const rkBanner = document.getElementById("rkBannerUnite");
const rkFlechaArriba = document.getElementById("rkFlechaArriba");
const rkFlechaAbajo = document.getElementById("rkFlechaAbajo");

// Cuántos puestos se muestran por página (2 filas de 10, igual que
// el video de referencia) y desde qué puesto (0 = el 7º) arranca la
// ventana visible ahora mismo.
const RK_TAMANIO_PAGINA = 20;
let _rkInicioVentana = 0;

// ---------- ELEMENTOS: COMUNIDAD ----------

const comListaUsuarios = document.getElementById("listaUsuarios");
const comContador = document.getElementById("contadorUsuarios");
const comBuscador = document.getElementById("buscadorUsuarios");

// Usuario con sesión iniciada en este navegador.
let activoComRk = window.MRSession ? window.MRSession.get() : leerJSON(localStorage.getItem("usuarioActivo") || "null");
if (window.MRSession && typeof window.MRSession.subscribe === "function") {
  window.MRSession.subscribe(function (detalle) {
    activoComRk = detalle && detalle.usuario ? detalle.usuario : null;
  });
}

let _rkOrdenarPorLogros = false;
let _rkModo = "general";
let _rkUsuarios = [];       // lista completa ya con puntosLogros
let _comAmigos = [];
let _comSolicitudesEnviadas = [];
let _comSolicitudesRecibidas = [];


// ==============================
// AVATAR POR CAPAS (compartido)
// ==============================
// Misma resolución de rutas que ya usan js/ranking.js y js/comunidad.js.

const RK_ORDEN_CAPAS = [
  "fondo", "espalda", "modelo", "piel", "ojos", "boca",
  "pantalon", "botas", "remera", "guantes", "accesorio",
  "cara", "pelo", "mascota", "borde"
];

function rkRutaCapa(valor) {
  if (!valor || valor === "ninguno") return null;
  if (!valor.includes("_")) return "imagenes/" + valor + ".png";
  const idx = valor.indexOf("_");
  return "imagenes/" + valor.slice(0, idx) + "/" + valor.slice(idx + 1) + ".png";
}

function rkAvatarHTML(avatarCrudo, contenedorClase, capaClase, defaultAncho) {

  const avatar = normalizarAvatar(avatarCrudo);

  if (!avatar) {
    return `
      <div class="${contenedorClase}">
        <img src="imagenes/avatar.png" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;">
      </div>
    `;
  }

  if(avatarEsPNG(avatar)){
    return `
      <div class="${contenedorClase}">
        <img src="${avatarPNGData(avatar)}" class="${capaClase} avatar-png-personalizado" alt="" loading="lazy" style="width:100%;height:100%;object-fit:contain;">
      </div>
    `;
  }

  let html = "";
  let rutas = [];

  RK_ORDEN_CAPAS.forEach(tipo => {
    const ruta = rkRutaCapa(avatar[tipo]);
    if (ruta) {
      html += `<img class="${capaClase}" src="${ruta}" alt="" loading="lazy">`;
      rutas.push(ruta);
    }
  });

  return `
    <div class="${contenedorClase} avatar-compuesto" data-capas="${rutas.join("|")}" data-capa-class="${capaClase}">
      ${html}
    </div>
  `;

}


// ==============================
// INDICADOR DE CAMBIO DE POSICIÓN (+1 / -1 / --)
// ==============================
// Sale de rank_actual y rank_anterior, que llegan desde /api/users
// (se calculan una vez por semana del lado del servidor, ver
// recalcularRanking() en api/system.js, disparado por un cron todos
// los lunes 5am hora Argentina). Si todavía no hay datos guardados
// para ese usuario, se muestra "--".

function rkDeltaHTML(usuario) {

  const actual = Number(usuario.rank_actual);
  const anterior = Number(usuario.rank_anterior);

  if (!actual || !anterior || isNaN(actual) || isNaN(anterior)) {
    return `<span class="rk-delta rk-neutro">--</span>`;
  }

  const cambio = anterior - actual; // positivo = subió puestos

  if (cambio > 0) return `<span class="rk-delta rk-sube">+${cambio}</span>`;
  if (cambio < 0) return `<span class="rk-delta rk-baja">${cambio}</span>`;
  return `<span class="rk-delta rk-neutro">--</span>`;

}


// ==============================
// RENDER: RANKING
// ==============================

function rkRenderizar(filtro = "") {

  if (!rkPodio || !rkResto) return;

  let lista = _rkUsuarios.slice();

  lista.sort((a, b) => {

    if (_rkModo === "logros" || _rkOrdenarPorLogros) {
      return (Number(b.puntosLogros) || 0) - (Number(a.puntosLogros) || 0);
    }

    if (_rkModo === "semana") {
      const minutosA = Number(a.minutos_semana_actual) || 0;
      const minutosB = Number(b.minutos_semana_actual) || 0;
      if (minutosB !== minutosA) return minutosB - minutosA;
      const diasA = Number(a.dias_activos_semana_actual) || 0;
      const diasB = Number(b.dias_activos_semana_actual) || 0;
      if (diasB !== diasA) return diasB - diasA;
    }

    const posA = Number(a.rank_actual) || Infinity;
    const posB = Number(b.rank_actual) || Infinity;
    if (posA !== posB) return posA - posB;
    return (Number(b.minutos_semana_actual) || 0) - (Number(a.minutos_semana_actual) || 0);
  });

  if (filtro) {
    const texto = filtro.toLowerCase();
    lista = lista.filter(u => u.nombre.toLowerCase().includes(texto));
  }

  if (rkMiPosicion) {
    const nombreActivo = activoComRk?.nombre;
    const posicion = nombreActivo ? lista.findIndex(u => u.nombre === nombreActivo) + 1 : 0;
    rkMiPosicion.textContent = posicion > 0
      ? `Tu posición: #${posicion}`
      : nombreActivo ? "Tu posición: fuera del listado" : "Iniciá sesión para competir";
  }

  const top6 = lista.slice(0, 6);
  const restoCompleto = lista.slice(6);

  // Ventana paginada: no se pinta TODO el resto de una — se muestra
  // de a RK_TAMANIO_PAGINA (20) puestos, y las flechas ▲/▼ mueven esa
  // ventana. Si el buscador deja menos gente que la ventana actual,
  // se acomoda para no mostrar una página vacía.
  const maxInicio = Math.max(0, restoCompleto.length - RK_TAMANIO_PAGINA);
  if (_rkInicioVentana > maxInicio) _rkInicioVentana = maxInicio;
  if (_rkInicioVentana < 0) _rkInicioVentana = 0;

  const resto = restoCompleto.slice(_rkInicioVentana, _rkInicioVentana + RK_TAMANIO_PAGINA);

  if (rkFlechaArriba) rkFlechaArriba.disabled = _rkInicioVentana <= 0;
  if (rkFlechaAbajo) rkFlechaAbajo.disabled = _rkInicioVentana >= maxInicio;

  // ---- Podio (top 6) ----

  rkPodio.innerHTML = top6.map((usuario, i) => {

    const puesto = i + 1;

    return `
      <div class="rk-podio-card" data-puesto="${puesto}">

        ${puesto === 1 ? `<div class="rk-corona">👑</div>` : ""}

        <div class="rk-podio-numero">${puesto}</div>

        ${rkAvatarHTML(usuario.avatar, "rk-podio-avatar", "capa-rk")}

        <p class="rk-podio-nombre">${usuario.nombre}</p>

        ${_rkModo === "logros" || _rkOrdenarPorLogros
          ? `<span class="rk-delta rk-neutro">🏅 ${usuario.puntosLogros} puntos</span>`
          : _rkModo === "semana"
            ? `<p class="rk-podio-stat">🔥 ${usuario.minutos_semana_actual || 0} min · ${usuario.dias_activos_semana_actual || 0} días</p>`
            : `<p class="rk-podio-stat">⏱️ ${usuario.minutos_semana_actual || 0} min esta semana</p>${rkDeltaHTML(usuario)}`}

      </div>
    `;

  }).join("");

  // ---- Resto (7º en adelante) ----

  rkResto.innerHTML = resto.map((usuario, i) => {

    const puesto = _rkInicioVentana + i + 7;

    return `
      <a href="usuario.html?usuario=${encodeURIComponent(usuario.nombre)}" class="rk-mini-card">

        ${rkAvatarHTML(usuario.avatar, "rk-mini-avatar", "capa-rk-mini")}

        <p class="rk-mini-nombre">${usuario.nombre}</p>
        <p class="rk-mini-puesto">${puesto}º</p>

        ${_rkModo === "logros" || _rkOrdenarPorLogros
          ? `<span class="rk-delta rk-neutro">🏅 ${usuario.puntosLogros} pts</span>`
          : _rkModo === "semana"
            ? `<p class="rk-mini-stat">🔥 ${usuario.minutos_semana_actual || 0} min · ${usuario.dias_activos_semana_actual || 0} días</p>`
            : `<p class="rk-mini-stat">⏱️ ${usuario.minutos_semana_actual || 0} min</p>${rkDeltaHTML(usuario)}`}

      </a>
    `;

  }).join("");

}


// ---- Modos del ranking ----
rkModos.forEach((boton) => {
  boton.addEventListener("click", () => {
    _rkModo = boton.dataset.rankingModo || "general";
    _rkOrdenarPorLogros = _rkModo === "logros";
    _rkInicioVentana = 0;
    rkModos.forEach(b => b.classList.toggle("activo", b === boton));
    if (rkBotonLogros) {
      rkBotonLogros.classList.toggle("rk-activo", _rkModo === "logros");
      rkBotonLogros.textContent = _rkModo === "logros" ? "Ver Ranking General" : "Ver Ranking de Logros";
    }
    rkRenderizar(rkBuscador?.value || "");
  });
});

// ---- Buscador del ranking ----

rkBuscador?.addEventListener("input", () => {
  _rkInicioVentana = 0;
  rkRenderizar(rkBuscador.value);
});

// ---- Flechas de paginado del resto del ranking ----

rkFlechaArriba?.addEventListener("click", () => {
  _rkInicioVentana = Math.max(0, _rkInicioVentana - RK_TAMANIO_PAGINA);
  rkRenderizar(rkBuscador?.value || "");
});

rkFlechaAbajo?.addEventListener("click", () => {
  _rkInicioVentana += RK_TAMANIO_PAGINA;
  rkRenderizar(rkBuscador?.value || "");
});

// ---- Botón "Ver Ranking de Logros" ----
// Alterna el orden entre la posición general (tiempo jugado, la de
// siempre) y solo puntos de logros, reusando los mismos datos ya
// cargados (no hace falta pedir nada de nuevo al servidor).

rkBotonLogros?.addEventListener("click", () => {

  _rkOrdenarPorLogros = !_rkOrdenarPorLogros;
  _rkModo = _rkOrdenarPorLogros ? "logros" : "general";
  _rkInicioVentana = 0;

  rkBotonLogros.textContent = _rkOrdenarPorLogros
    ? "Ver Ranking General"
    : "Ver Ranking de Logros";

  rkBotonLogros.classList.toggle("rk-activo", _rkOrdenarPorLogros);

  rkRenderizar(rkBuscador?.value || "");

});


// ==============================
// COMUNIDAD (misma lógica que tenía js/comunidad.js, con nombres
// propios para no chocar con el resto de este archivo)
// ==============================

function comEstaConectado(usuario) {
  if (!usuario || !usuario.last_login) return false;
  const ultima = new Date(usuario.last_login).getTime();
  if (isNaN(ultima)) return false;
  return (Date.now() - ultima) <= MINUTOS_CONECTADO * 60 * 1000;
}

function comEstadoRelacion(nombreOtro) {
  if (!activoComRk) return "";
  if (activoComRk.nombre === nombreOtro) return "";

  if (_comAmigos.includes(nombreOtro)) return `<span class="rel-amigos">✅ Amigos</span>`;
  if (_comSolicitudesEnviadas.includes(nombreOtro)) return `<span class="rel-pendiente">⏳ Solicitud enviada</span>`;
  if (_comSolicitudesRecibidas.includes(nombreOtro)) return `<span class="rel-recibida">📩 Te mandó solicitud</span>`;

  return "";
}

function comRenderUsuarios(lista) {

  if (!comListaUsuarios) return;

  if (lista.length === 0) {
    comListaUsuarios.innerHTML = `
      <div class="estado-vacio">
        <span class="icono-vacio">🕹️</span>
        <p>No hay usuarios registrados todavía.</p>
      </div>`;
    if (comContador) comContador.textContent = "";
    return;
  }

  if (comContador) {
    comContador.textContent = `${lista.length} jugador${lista.length === 1 ? "" : "es"} registrado${lista.length === 1 ? "" : "s"}`;
  }

  comListaUsuarios.innerHTML = lista.map(usuario => {

    const conectado = comEstaConectado(usuario);
    const rel = comEstadoRelacion(usuario.nombre);
    const cantidadLogros = typeof obtenerLogros === "function" ? obtenerLogros(usuario.nombre).length : 0;

    return `
      <div class="tarjeta-usuario">

        <span class="badge-estado ${conectado ? "online" : "offline"}">
          ${conectado ? "🟢 En línea" : "⚪ Desconectado"}
        </span>

        ${rkAvatarHTML(usuario.avatar, "avatar-tarjeta", "capa-tarjeta")}

        <h3 class="usuario-nombre">${usuario.nombre}</h3>

        ${typeof insigniasBloqueHTML === "function" ? insigniasBloqueHTML(usuario.nombre, true) : ""}

        ${rel}

        <div class="usuario-stats">
          <div class="stat-item">
            <span class="stat-valor">${usuario.minutos_semana_actual || 0}</span>
            <span class="stat-label">⏱️ min esta semana</span>
          </div>
          ${cantidadLogros ? `
          <div class="stat-item">
            <span class="stat-valor">${cantidadLogros}</span>
            <span class="stat-label">🏅 Logros</span>
          </div>` : ""}
        </div>

        ${usuario.bio ? `<p class="usuario-bio">${usuario.bio}</p>` : ""}

        <a href="usuario.html?usuario=${encodeURIComponent(usuario.nombre)}" class="btn-ver-perfil">👤 Ver perfil</a>

      </div>
    `;

  }).join("");

}

comBuscador?.addEventListener("input", () => {
  const texto = (comBuscador.value || "").trim().toLowerCase();
  const filtrados = texto
    ? _rkUsuarios.filter(u => u.nombre.toLowerCase().includes(texto))
    : _rkUsuarios;
  comRenderUsuarios(filtrados);
});


// ==============================
// PANEL LATERAL — pestañas General / Moderación / Rangos
// ==============================

const crStatRegistrados = document.getElementById("crStatRegistrados");
const crStatConectados = document.getElementById("crStatConectados");
const crStatComentarios = document.getElementById("crStatComentarios");
const crRecienLlegados = document.getElementById("crRecienLlegados");
const crListaModeracion = document.getElementById("crListaModeracion");
const crListaRangos = document.getElementById("crListaRangos");
const crGridConectados = document.getElementById("crGridConectados");
const crBuscarConectado = document.getElementById("crBuscarConectado");
const crMonedasUsuario = document.getElementById("crMonedasUsuario");
const crGridTienda = document.getElementById("crGridTienda");
const crFeedActividad = document.getElementById("crFeedActividad");

// Mismas capas/rutas que ya usa rkAvatarHTML más arriba, pero devuelve
// solo las <img> sueltas (sin div contenedor) para insertarlas dentro
// de un <a> que YA trae position:relative + overflow:hidden por CSS
// (ver .cr-grid-conectados a, .cr-avatar-chico en comunidad-ranking.css).

function crAvatarCapasHTML(avatarCrudo, claseCapa) {
  const avatar = normalizarAvatar(avatarCrudo);
  if (!avatar) {
    return `<img src="imagenes/avatar.png" alt="" loading="lazy">`;
  }
  if(avatarEsPNG(avatar)){
    return `<img src="${avatarPNGData(avatar)}" class="${claseCapa} avatar-png-personalizado" alt="" loading="lazy">`;
  }
  let html = "";
  RK_ORDEN_CAPAS.forEach(tipo => {
    const ruta = rkRutaCapa(avatar[tipo]);
    if (ruta) html += `<img class="${claseCapa}" src="${ruta}" alt="" loading="lazy">`;
  });
  return html || `<img src="imagenes/avatar.png" alt="" loading="lazy">`;
}

// ---- Pestañas ----

document.querySelectorAll(".cr-tab").forEach(boton => {
  boton.addEventListener("click", () => {
    document.querySelectorAll(".cr-tab").forEach(b => b.classList.remove("cr-tab-activa"));
    boton.classList.add("cr-tab-activa");

    const tab = boton.dataset.tab; // "general" | "moderacion" | "rangos"
    const idPanel = "crTab" + tab.charAt(0).toUpperCase() + tab.slice(1);

    document.querySelectorAll(".cr-tab-panel").forEach(p => p.classList.remove("cr-tab-panel-activo"));
    document.getElementById(idPanel)?.classList.add("cr-tab-panel-activo");
  });
});

// ---- General: estadísticas de la comunidad ----

async function crCargarEstadisticas() {
  try {
    const resp = await fetch("/api/system?action=community-stats");
    const datos = await resp.json();
    if (!datos || !datos.success) return;

    if (crStatRegistrados) crStatRegistrados.textContent = datos.registradosTotal;
    if (crStatConectados) crStatConectados.textContent = datos.conectadosAhora;
    if (crStatComentarios) crStatComentarios.textContent = datos.comentariosPorHora;

    if (crRecienLlegados) {
      const llegados = datos.recienLlegados || [];
      crRecienLlegados.innerHTML = llegados.length
        ? llegados.map(u => `
            <a href="usuario.html?usuario=${encodeURIComponent(u.username)}" class="cr-avatar-chico" title="${u.username}">
              ${crAvatarCapasHTML(u.avatar, "cr-capa-chica")}
            </a>
          `).join("")
        : `<p class="cr-vacio">Todavía no se registró nadie hoy.</p>`;
    }
  } catch (error) {
    console.warn("MacroReborn: no se pudieron cargar las estadísticas de la comunidad.", error);
  }
}

// ---- Moderación: staff conectado ----

async function crCargarModeracion() {
  if (!crListaModeracion) return;

  const ICONO_ROL = { administrador: "👑", moderador: "🛡️", colaborador: "🎗️" };

  try {
    const resp = await fetch("/api/system?action=moderators-status");
    const datos = await resp.json();
    if (!datos || !datos.success) return;

    if (!datos.staff.length) {
      crListaModeracion.innerHTML = `<p class="cr-vacio">Todavía no hay staff asignado.</p>`;
      return;
    }

    crListaModeracion.innerHTML = datos.staff.map(s => `
      <div class="cr-fila-staff">
        <a href="usuario.html?usuario=${encodeURIComponent(s.username)}" class="cr-avatar-chico" title="${s.username}">
          ${crAvatarCapasHTML(s.avatar, "cr-capa-chica")}
        </a>
        <div class="cr-staff-info">
          <p class="cr-staff-nombre">${s.username}</p>
          <p class="cr-staff-rol">${ICONO_ROL[s.rol] || "•"} ${s.rol}</p>
        </div>
        <span class="cr-punto-estado ${s.conectado ? "cr-conectado" : ""}" title="${s.conectado ? "Conectado" : "Desconectado"}"></span>
      </div>
    `).join("");
  } catch (error) {
    console.warn("MacroReborn: no se pudo cargar el staff conectado.", error);
  }
}

// ---- Rangos: tramos del ranking general (estático, no pide nada al servidor) ----

function crRenderRangos() {
  if (!crListaRangos) return;

  const TRAMOS = [
    { nombre: "🏆 Leyenda", rango: "Puestos 1 a 3" },
    { nombre: "💎 Élite", rango: "Puestos 4 a 10" },
    { nombre: "🥇 Veterano", rango: "Puestos 11 a 30" },
    { nombre: "🥈 Avanzado", rango: "Puestos 31 a 60" },
    { nombre: "🥉 Novato", rango: "Puesto 61 en adelante" }
  ];

  crListaRangos.innerHTML = TRAMOS.map(t => `
    <div class="cr-fila-rango">
      <span class="cr-rango-nombre">${t.nombre}</span>
      <span class="cr-rango-rango">${t.rango}</span>
    </div>
  `).join("");
}

// ---- Conectados (panel lateral) ----

function crRenderConectados(lista, filtro = "") {
  if (!crGridConectados) return;

  let conectados = lista.filter(comEstaConectado);

  if (filtro) {
    const texto = filtro.toLowerCase();
    conectados = conectados.filter(u => u.nombre.toLowerCase().includes(texto));
  }

  if (!conectados.length) {
    crGridConectados.innerHTML = `<p class="cr-vacio">Nadie conectado ahora mismo.</p>`;
    return;
  }

  crGridConectados.innerHTML = conectados.slice(0, 24).map(u => `
    <a href="usuario.html?usuario=${encodeURIComponent(u.nombre)}" title="${u.nombre}">
      ${crAvatarCapasHTML(u.avatar, "cr-capa-chica")}
    </a>
  `).join("");
}

crBuscarConectado?.addEventListener("input", () => {
  crRenderConectados(_rkUsuarios, crBuscarConectado.value.trim());
});


// ==============================
// CENTRO DE AVATARES (tienda de prendas, se paga con monedas)
// ==============================

async function crCargarTienda() {
  if (!crGridTienda) return;

  try {
    const url = activoComRk
      ? "/api/content?action=avatar-shop&username=" + encodeURIComponent(activoComRk.nombre)
      : "/api/content?action=avatar-shop";

    const resp = await fetch(url);
    const datos = await resp.json();
    if (!datos || !datos.success) return;

    if (crMonedasUsuario) {
      if (activoComRk) {
        crMonedasUsuario.style.display = "";
        crMonedasUsuario.textContent = "🪙 " + (datos.monedas != null ? datos.monedas : 0) + " monedas";
      } else {
        crMonedasUsuario.style.display = "none";
      }
    }

    const comprados = new Set(datos.comprados || []);
    const items = (datos.items || []).slice(0, 12);

    if (!items.length) {
      crGridTienda.innerHTML = `<p class="cr-vacio">Todavía no hay prendas cargadas en la tienda.</p>`;
      return;
    }

    crGridTienda.innerHTML = items.map(item => {

      const yaLaTiene = comprados.has(item.id);
      const ruta = rkRutaCapa(item.valorCapa);

      let boton;
      if (!activoComRk) {
        boton = `<a href="login.html" class="cr-item-tienda-boton" style="display:block;text-decoration:none;box-sizing:border-box;">Iniciar sesión</a>`;
      } else if (yaLaTiene) {
        boton = `<button type="button" class="cr-item-tienda-boton cr-comprada" disabled>✅ La tenés</button>`;
      } else {
        boton = `<button type="button" class="cr-item-tienda-boton" data-item-id="${item.id}">Comprar</button>`;
      }

      return `
        <div class="cr-item-tienda">
          <div class="cr-item-tienda-imagen">
            ${ruta ? `<img src="${ruta}" alt="${item.nombre}" loading="lazy">` : ""}
          </div>
          <p class="cr-item-tienda-nombre">${item.nombre}</p>
          <p class="cr-item-tienda-precio">🪙 ${item.precio}</p>
          ${boton}
        </div>
      `;

    }).join("");

    crGridTienda.querySelectorAll("button[data-item-id]").forEach(boton => {
      boton.addEventListener("click", () => crComprarPrenda(boton));
    });

  } catch (error) {
    console.warn("MacroReborn: no se pudo cargar el Centro de Avatares.", error);
  }
}

async function crComprarPrenda(boton) {
  if (!activoComRk) return;

  const itemId = boton.dataset.itemId;
  const textoOriginal = boton.textContent;
  boton.disabled = true;
  boton.textContent = "Comprando...";

  try {
    const resp = await fetch("/api/content?action=avatar-shop-buy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: activoComRk.nombre, itemId })
    });
    const datos = await resp.json();

    if (!datos || !datos.success) {
      alert((datos && datos.error) || "No se pudo comprar la prenda.");
      boton.disabled = false;
      boton.textContent = textoOriginal;
      return;
    }

    if (crMonedasUsuario) {
      crMonedasUsuario.textContent = "🪙 " + datos.monedas + " monedas";
    }
    boton.textContent = "✅ La tenés";
    boton.classList.add("cr-comprada");

  } catch (error) {
    console.warn("MacroReborn: no se pudo completar la compra.", error);
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
}


// ==============================
// "¿QUÉ ESTÁ OCURRIENDO AHORA?" — feed global de actividad
// ==============================

async function crCargarFeed() {
  if (!crFeedActividad) return;

  try {
    const resp = await fetch("/api/content?action=community-feed&limit=18");
    const datos = await resp.json();
    if (!datos || !datos.success) return;

    if (!datos.actividades.length) {
      crFeedActividad.innerHTML = `<p class="cr-vacio">Todavía no hay actividad reciente en la comunidad.</p>`;
      return;
    }

    crFeedActividad.innerHTML = datos.actividades.map(item => {

      const texto = typeof textoActividadAmigo === "function"
        ? textoActividadAmigo(item.username, item.tipo, item.detalle)
        : (item.username + " tuvo actividad");

      const hace = typeof tiempoRelativo === "function"
        ? tiempoRelativo(item.created_at, "")
        : "";

      return `
        <div class="cr-feed-item">
          <a href="usuario.html?usuario=${encodeURIComponent(item.username)}" class="cr-feed-avatar" title="${item.username}">
            ${crAvatarCapasHTML(item.avatar, "cr-capa-chica")}
          </a>
          <div class="cr-feed-texto">
            <p>${texto}</p>
            <span class="cr-feed-hora">${hace}</span>
          </div>
        </div>
      `;

    }).join("");

  } catch (error) {
    console.warn("MacroReborn: no se pudo cargar la actividad de la comunidad.", error);
  }
}


// ==============================
// CARGA INICIAL (una sola vez para ranking + comunidad)
// ==============================

async function iniciarComunidadRanking() {

  let crudos = [];

  try {
    const respuesta = await fetch("/api/users?limit=500");
    const datos = await respuesta.json();
    crudos = (datos && datos.success) ? datos.users : [];
  } catch (error) {
    console.warn("MacroReborn: no se pudo cargar la lista de usuarios.", error);
  }

  const usuarios = crudos.map(u => ({ ...u, nombre: u.username, nivel: u.level }));
  const nombres = usuarios.map(u => u.nombre);

  // La lista principal no debe quedar esperando a logros, insignias o
  // relaciones sociales. Si alguno de esos pedidos tarda o falla, los
  // usuarios, conectados y ranking igualmente se muestran.
  _rkUsuarios = usuarios.map(usuario => ({
    ...usuario,
    puntosLogros: 0
  }));
  rkRenderizar();
  comRenderUsuarios(usuarios);
  crRenderConectados(usuarios);
  crRenderRangos();

  // Las estadísticas (incluidos conectados y recién llegados) tampoco
  // dependen de las tareas auxiliares del ranking. Se cargan aparte.
  crCargarEstadisticas();

  const tareas = [];

  if (typeof cargarLogrosDeVarios === "function") tareas.push(cargarLogrosDeVarios(nombres));
  if (typeof cargarInsigniasDeVarios === "function") tareas.push(cargarInsigniasDeVarios(nombres));

  if (activoComRk) {
    tareas.push(
      fetch("/api/social?action=friends&username=" + encodeURIComponent(activoComRk.nombre))
        .then(r => r.json())
        .then(datos => {
          if (!datos || !datos.success) return;
          _comAmigos = datos.amigos.map(a => a.username);
          _comSolicitudesEnviadas = datos.solicitudesSalientes.map(s => s.para);
          _comSolicitudesRecibidas = datos.solicitudesEntrantes.map(s => s.de);
        })
        .catch(error => console.warn("MacroReborn: no se pudo cargar el estado de amistad.", error))
    );
  }

  await Promise.all(tareas);

  // Puntos de logros (solo para el toggle "Ver Ranking de Logros"; el
  // orden general ya no depende de esto, ver rkRenderizar()).
  _rkUsuarios = usuarios.map(usuario => {

    const puntosLogros = typeof calcularPuntosLogros === "function"
      ? calcularPuntosLogros(usuario.nombre)
      : 0;

    return { ...usuario, puntosLogros };

  });

  if (rkBanner) {
    rkBanner.classList.toggle("rk-oculto", !!activoComRk);
  }

  // Actualiza de nuevo después de cargar logros/insignias para que el
  // ranking pueda mostrar esos datos sin bloquear la primera pintura.
  rkRenderizar();
  comRenderUsuarios(usuarios);
  crRenderConectados(usuarios);
  crRenderRangos();

  // Estas tareas no bloquean la lista principal.
  crCargarModeracion();
  crCargarTienda();
  crCargarFeed();

}

iniciarComunidadRanking();

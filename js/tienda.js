// ==============================
// LA TIENDA DE AVATARES — js/tienda.js
// ==============================
// La página propia de la tienda (tienda.html). Decidida el 24/09/2026:
// "¡no hay tienda!" era lo que más pedía la comunidad. Hasta entonces la
// tienda eran las doce últimas prendas en comunidad-ranking.html.
//
// Todo sale de una sola petición, GET /api/content?action=avatar-shop:
// el catálogo entero (solo lo publicado) y, con sesión, el saldo y lo
// que ya se compró. Filtrar, buscar y ordenar se hace aquí, sin volver
// al servidor: son unas 750 prendas.
//
// De cada prenda se enseña su previsualización (puesta en un maniquí,
// 96 px), nunca el dibujo suelto, que es el arte del equipo. No hay
// probador, decidido el 24/09/2026: ver docs/TIENDA.md.
//
// Comprar pregunta antes y después ofrece ponérsela:
// perfil.html?ponerse=<valor> abre el editor con la prenda puesta.
//
// Una prenda se puede enlazar: tienda.html?prenda=<valor>. Así llega
// quien pulsa una prenda con candado en el editor del perfil.

(function(){
  "use strict";

  const POR_PAGINA = 48;
  // "Nueva" durante una semana. Las 594 del catálogo original llevan la
  // fecha en que se importaron (14/09/2026): con más días saldrían todas
  // como nuevas.
  const DIAS_NUEVA = 7;

  // Los mismos nombres que las pestañas del editor (perfil.html).
  const TIPOS = {
    fondo: "Fondo", piel: "Piel", ojos: "Ojos", boca: "Boca", pelo: "Pelo",
    remera: "Remera", pantalon: "Pantalón", botas: "Botas", guantes: "Guantes",
    accesorio: "Accesorio", espalda: "Espalda", cara: "Cara", mascota: "Mascota",
    borde: "Borde"
  };

  const $ = (id) => document.getElementById(id);
  const el = {
    saldo: $("tiendaSaldo"),
    monedas: $("tiendaMonedas"),
    invitado: $("tiendaInvitado"),
    invitadoTexto: $("tiendaInvitadoTexto"),
    personajes: $("tiendaPersonajes"),
    buscar: $("tiendaBuscar"),
    tipo: $("tiendaTipo"),
    orden: $("tiendaOrden"),
    puedoCaja: $("tiendaPuedoCaja"),
    puedo: $("tiendaPuedo"),
    ocultarCaja: $("tiendaOcultarCaja"),
    ocultar: $("tiendaOcultar"),
    resumen: $("tiendaResumen"),
    grid: $("tiendaGrid"),
    verMas: $("tiendaVerMas")
  };
  if (!el.grid) return;

  const estado = {
    items: [],
    comprados: new Set(),   // ids de avatar_shop_items
    monedas: null,          // null: sin sesión, o caducada
    personaje: "",          // "" = todos
    tipo: "",
    busqueda: "",
    orden: "novedades",
    puedo: false,
    ocultar: false,
    mostrados: POR_PAGINA,
    comprando: false
  };

  const esc = (valor) => MRTexto.escapar(valor);
  const cifra = (n) => Number(n || 0).toLocaleString("es-ES");
  const conSesion = () => estado.monedas !== null;
  const laTiene = (item) => estado.comprados.has(item.id);
  const nombrePersonaje = (modelo) => {
    const m = String(modelo || "");
    return m.charAt(0).toUpperCase() + m.slice(1);
  };

  function sinAcentos(texto){
    return String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }

  function esNueva(item){
    const creada = Date.parse(item.creadoEl);
    return Number.isFinite(creada) && Date.now() - creada < DIAS_NUEVA * 24 * 60 * 60 * 1000;
  }

  // El personaje que lleva quien mira, para abrir la tienda en el suyo.
  function personajeDeLaSesion(){
    const usuario = window.MRSession && typeof MRSession.get === "function" ? MRSession.get() : null;
    let avatar = usuario && usuario.avatar;
    if (typeof avatar === "string") {
      try { avatar = JSON.parse(avatar); } catch (_) { avatar = null; }
    }
    // Un avatar PNG guarda la receta normal en "restaurar".
    if (avatar && avatar.restaurar && typeof avatar.restaurar === "object") avatar = avatar.restaurar;
    return avatar && typeof avatar.modelo === "string" ? avatar.modelo : "";
  }

  function sesionLocal(){
    return !!(window.MRSession && typeof MRSession.isLogged === "function" && MRSession.isLogged());
  }

  // ---------- QUÉ SE VE ----------

  // Las prendas que pasan los filtros de ahora, en su orden.
  function visibles(){
    const texto = sinAcentos(estado.busqueda).trim();
    const lista = estado.items.filter(item => {
      if (estado.personaje && item.modelo !== estado.personaje) return false;
      if (estado.tipo && item.categoria !== estado.tipo) return false;
      if (estado.ocultar && laTiene(item)) return false;
      if (estado.puedo && conSesion() && (laTiene(item) || item.precio > estado.monedas)) return false;
      if (texto && !item._busqueda.includes(texto)) return false;
      return true;
    });
    const orden = {
      baratas: (a, b) => a.precio - b.precio,
      caras: (a, b) => b.precio - a.precio,
      vendidas: (a, b) => (b.vendidas || 0) - (a.vendidas || 0)
    }[estado.orden];
    // El catálogo ya llega de lo más nuevo a lo más viejo, y sort es
    // estable: a igual precio o ventas, se queda ese orden.
    return orden ? lista.sort(orden) : lista;
  }

  function tarjeta(item){
    const mia = laTiene(item);
    const imagen = item.previsualizacion
      ? `<img data-src="${esc(item.previsualizacion)}" alt="" width="96" height="96">`
      : `<span class="tienda-sin-imagen" aria-hidden="true">👕</span>`;

    let accion;
    if (!conSesion()) {
      accion = `<a class="tienda-boton" href="login.html">Iniciá sesión</a>`;
    } else if (mia) {
      accion = `<a class="tienda-boton tienda-boton--mia" href="perfil.html?ponerse=${esc(encodeURIComponent(item.valorCapa))}">Ponértela</a>`;
    } else if (item.precio > estado.monedas) {
      accion = `<button type="button" class="tienda-boton" disabled title="Las monedas se ganan jugando">Te faltan 🪙 ${cifra(item.precio - estado.monedas)}</button>`;
    } else {
      accion = `<button type="button" class="tienda-boton" data-comprar="${esc(item.id)}">Comprar</button>`;
    }

    return `
      <article class="tienda-item${mia ? " tienda-item--mia" : ""}" data-id="${esc(item.id)}">
        <div class="tienda-item-imagen">
          ${imagen}
          ${esNueva(item) ? `<span class="tienda-etiqueta">Nueva</span>` : ""}
          ${mia ? `<span class="tienda-etiqueta tienda-etiqueta--mia">✓ La tenés</span>` : ""}
        </div>
        <h3 class="tienda-item-nombre" title="${esc(item.nombre)}">${esc(item.nombre)}</h3>
        <p class="tienda-item-meta">${esc(nombrePersonaje(item.modelo))} · ${esc(TIPOS[item.categoria] || item.categoria)}</p>
        <p class="tienda-item-precio">🪙 ${cifra(item.precio)}</p>
        ${accion}
      </article>`;
  }

  function pintarPie(lista){
    const total = lista.length;
    let texto = total === 1 ? "1 prenda" : cifra(total) + " prendas";
    let boton = "";
    // Lo más nuevo es lo del equipo de arte, de 1.500 monedas en adelante:
    // quien acaba de llegar, con 500, abre la tienda y no le alcanza nada
    // de lo que ve. Se le dice cuántas le alcanzan y se le ofrece verlas.
    if (conSesion() && !estado.puedo) {
      const alcanza = lista.filter(item => !laTiene(item) && item.precio <= estado.monedas).length;
      if (alcanza > 0 && alcanza < total) {
        texto += " · con tu saldo te alcanza para " + cifra(alcanza);
        boton = ` <button type="button" class="tienda-enlace" data-solo-alcanza>Ver solo esas</button>`;
      }
    }
    el.resumen.innerHTML = esc(texto) + boton;
    const quedan = total - Math.min(total, estado.mostrados);
    el.verMas.hidden = quedan <= 0;
    el.verMas.textContent = "Ver más (" + cifra(quedan) + ")";
  }

  function pintar(){
    const lista = visibles();
    el.grid.innerHTML = lista.length
      ? lista.slice(0, estado.mostrados).map(tarjeta).join("")
      : `<div class="tienda-vacio">
           <p>No hay prendas con estos filtros.</p>
           <button type="button" class="tienda-boton-secundario" data-quitar-filtros>Quitar filtros</button>
         </div>`;
    pintarPie(lista);
  }

  // Añade la página siguiente sin volver a pintar lo que ya estaba.
  function verMas(){
    const lista = visibles();
    const desde = estado.mostrados;
    estado.mostrados += POR_PAGINA;
    el.grid.insertAdjacentHTML("beforeend", lista.slice(desde, estado.mostrados).map(tarjeta).join(""));
    pintarPie(lista);
  }

  function desdeElPrincipio(){
    estado.mostrados = POR_PAGINA;
    pintar();
  }

  function pintarPersonajes(){
    const cuenta = new Map();
    estado.items.forEach(item => cuenta.set(item.modelo, (cuenta.get(item.modelo) || 0) + 1));
    const modelos = [...cuenta.keys()].sort((a, b) => cuenta.get(b) - cuenta.get(a) || a.localeCompare(b));
    const chip = (valor, texto, n) =>
      `<button type="button" class="tienda-chip" data-personaje="${esc(valor)}" aria-pressed="false">${esc(texto)} <small>${cifra(n)}</small></button>`;
    el.personajes.innerHTML = chip("", "Todos", estado.items.length) +
      modelos.map(m => chip(m, nombrePersonaje(m), cuenta.get(m))).join("");
  }

  // Los controles, a juego con el estado (tras un enlace o "Quitar filtros").
  function sincronizarControles(){
    el.personajes.querySelectorAll("[data-personaje]").forEach(boton => {
      boton.setAttribute("aria-pressed", String(boton.dataset.personaje === estado.personaje));
    });
    el.tipo.value = estado.tipo;
    el.orden.value = estado.orden;
    el.buscar.value = estado.busqueda;
    el.puedo.checked = estado.puedo;
    el.ocultar.checked = estado.ocultar;
  }

  function quitarFiltros(){
    Object.assign(estado, { personaje: "", tipo: "", busqueda: "", puedo: false, ocultar: false });
    sincronizarControles();
    desdeElPrincipio();
  }

  function pintarSaldo(){
    const sesion = conSesion();
    el.saldo.hidden = !sesion;
    el.puedoCaja.hidden = !sesion;
    el.ocultarCaja.hidden = !sesion;
    el.invitado.hidden = sesion;
    if (sesion) {
      el.monedas.textContent = "🪙 " + cifra(estado.monedas);
    } else if (sesionLocal()) {
      // Hay sesión en este navegador, pero el servidor no la reconoce.
      el.invitadoTexto.textContent = "Tu sesión caducó. Volvé a iniciarla para comprar prendas.";
    }
  }

  // El saldo nuevo, también en la barra de navegación y en la sesión.
  function avisarSaldo(monedas){
    const barra = document.getElementById("navMonedas");
    if (barra) barra.textContent = "🪙 " + cifra(monedas);
    if (window.MRSession && typeof MRSession.update === "function") MRSession.update({ monedas });
  }

  // ---------- COMPRAR ----------

  function preguntar(item){
    if (!conSesion() || laTiene(item) || item.precio > estado.monedas) return;
    MRModal.show({
      icon: "🛍️",
      image: item.previsualizacion || null,
      title: "¿Comprar «" + item.nombre + "»?",
      message: "Cuesta " + cifra(item.precio) + " monedas. Te quedarán " + cifra(estado.monedas - item.precio) + ".",
      actions: [
        { text: "Cancelar" },
        { text: "Comprar por 🪙 " + cifra(item.precio), primary: true, onClick: () => comprar(item) }
      ]
    });
  }

  async function comprar(item){
    if (estado.comprando) return;
    estado.comprando = true;
    const boton = el.grid.querySelector(`[data-comprar="${item.id}"]`);
    if (boton) {
      boton.disabled = true;
      boton.textContent = "Comprando…";
    }

    // Quién compra lo dice la sesión: solo viaja la prenda.
    let datos = null;
    let codigo = 0;
    try {
      const resp = await fetch("/api/content?action=avatar-shop-buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id })
      });
      codigo = resp.status;
      datos = await resp.json().catch(() => null);
    } catch (_) {
      // Sin conexión: datos se queda en null y se avisa abajo.
    }
    estado.comprando = false;

    if (datos && datos.success) {
      estado.comprados.add(item.id);
      estado.monedas = Number(datos.monedas);
      avisarSaldo(estado.monedas);
      pintarSaldo();
      pintar();
      MRModal.show({
        icon: "🎉",
        image: item.previsualizacion || null,
        title: "¡Es tuya!",
        message: "«" + item.nombre + "» ya está en tu guardarropa.",
        actions: [
          { text: "Seguir mirando" },
          {
            text: "Ponérmela ahora", primary: true,
            onClick: () => { window.location.href = "perfil.html?ponerse=" + encodeURIComponent(item.valorCapa); }
          }
        ]
      });
      return;
    }

    if (datos && datos.error === "Ya tenés esta prenda") estado.comprados.add(item.id);
    pintar();
    MRModal.show({
      icon: "⚠️",
      title: "No se pudo comprar",
      message: codigo === 401
        ? "Tu sesión caducó. Volvé a iniciarla para comprar prendas."
        : (datos && datos.error) || "No se pudo hablar con el servidor. Probá de nuevo en un momento."
    });
  }

  // ---------- UNA PRENDA ENLAZADA ----------
  // tienda.html?prenda=<valor>: se enseña esa prenda y, si se puede
  // comprar, se pregunta directamente. Es lo que espera quien viene del
  // candado del editor, que ya dijo que quería comprarla.

  function abrirEnlazada(){
    let valor = null;
    try { valor = new URLSearchParams(window.location.search).get("prenda"); } catch (_) {}
    if (!valor) return;
    // Fuera de la dirección: recargar la página no vuelve a preguntar.
    try { history.replaceState(null, "", window.location.pathname); } catch (_) {}

    const item = estado.items.find(i => i.valorCapa === valor);
    if (!item) {
      MRModal.show({
        icon: "🔍",
        title: "Esa prenda no está a la venta",
        message: "Puede que el equipo de arte la haya retirado. Echale un vistazo a todo lo demás."
      });
      return;
    }

    Object.assign(estado, { personaje: item.modelo, tipo: item.categoria, busqueda: "", puedo: false, ocultar: false });
    sincronizarControles();
    const posicion = visibles().indexOf(item);
    estado.mostrados = Math.max(POR_PAGINA, Math.ceil((posicion + 1) / POR_PAGINA) * POR_PAGINA);
    pintar();

    const tarjetaEnlazada = el.grid.querySelector(`[data-id="${item.id}"]`);
    if (tarjetaEnlazada) {
      tarjetaEnlazada.classList.add("tienda-item--destacada");
      if (typeof tarjetaEnlazada.scrollIntoView === "function") {
        tarjetaEnlazada.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }
    preguntar(item);
  }

  // ---------- EVENTOS ----------

  el.personajes.addEventListener("click", (evento) => {
    const boton = evento.target.closest("[data-personaje]");
    if (!boton) return;
    estado.personaje = boton.dataset.personaje;
    sincronizarControles();
    desdeElPrincipio();
  });

  let esperaBusqueda = null;
  el.buscar.addEventListener("input", () => {
    clearTimeout(esperaBusqueda);
    esperaBusqueda = setTimeout(() => {
      estado.busqueda = el.buscar.value;
      desdeElPrincipio();
    }, 150);
  });

  el.tipo.addEventListener("change", () => { estado.tipo = el.tipo.value; desdeElPrincipio(); });
  el.orden.addEventListener("change", () => { estado.orden = el.orden.value; desdeElPrincipio(); });
  el.puedo.addEventListener("change", () => { estado.puedo = el.puedo.checked; desdeElPrincipio(); });
  el.ocultar.addEventListener("change", () => { estado.ocultar = el.ocultar.checked; desdeElPrincipio(); });
  el.verMas.addEventListener("click", verMas);

  el.resumen.addEventListener("click", (evento) => {
    if (!evento.target.closest("[data-solo-alcanza]")) return;
    estado.puedo = true;
    sincronizarControles();
    desdeElPrincipio();
  });

  el.grid.addEventListener("click", (evento) => {
    const boton = evento.target.closest("[data-comprar]");
    if (boton) {
      const item = estado.items.find(i => String(i.id) === boton.dataset.comprar);
      if (item) preguntar(item);
      return;
    }
    if (evento.target.closest("[data-quitar-filtros]")) quitarFiltros();
  });

  // ---------- CARGA ----------

  async function cargar(){
    try {
      const resp = await fetch("/api/content?action=avatar-shop");
      const datos = await resp.json();
      if (!datos || !datos.success) throw new Error("La tienda respondió sin éxito");

      estado.items = (datos.items || []).map(item => ({
        ...item,
        _busqueda: sinAcentos([item.nombre, TIPOS[item.categoria], item.modelo].join(" "))
      }));
      estado.comprados = new Set(datos.comprados || []);
      estado.monedas = datos.monedas == null ? null : Number(datos.monedas);
    } catch (error) {
      console.warn("MacroReborn: no se pudo cargar la tienda.", error);
      el.grid.innerHTML = `<div class="tienda-vacio"><p>No se pudo cargar la tienda. Probá recargar la página.</p></div>`;
      el.resumen.textContent = "";
      return;
    }

    const suyo = personajeDeLaSesion();
    if (suyo && estado.items.some(item => item.modelo === suyo)) estado.personaje = suyo;

    pintarSaldo();
    pintarPersonajes();
    sincronizarControles();
    pintar();
    abrirEnlazada();
  }

  cargar();
})();

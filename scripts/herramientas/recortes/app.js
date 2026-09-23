// ==============================
// LA HERRAMIENTA DE RECORTES, LADO NAVEGADOR
// scripts/herramientas/recortes/app.js
// ==============================
// Una persona elige, capa por capa y modelo por modelo, el cuadro que
// enseñara cada previsualizacion. Aqui solo se decide; las 768 imagenes
// las genera despues el servidor con lo guardado. Fase 4 de
// docs/AVATARES-SERVIDOR.md.
//
// Todas las cuentas del cuadro se hacen en coordenadas del LIENZO, de
// 327x504, y solo se pasan a pixeles de pantalla al dibujar. Mezclarlas
// es la forma clasica de que el cuadro guardado no sea el que se veia.

(function () {
  "use strict";

  const API = "/herramientas/recortes/api";
  const ANCHO = 327, ALTO = 504;
  const ASA = 9;            // radio de las esquinas para agarrar, en px de pantalla

  const $ = id => document.getElementById(id);

  const estado = {
    datos: null,
    modelo: null,
    capa: null,
    indice: 0,
    maniqui: "plano",
    cuadros: {},            // SOLO lo decidido: cuadros[modelo][capa]
    guardado: "",           // la configuracion tal como esta en el archivo
    cuadro: null,           // el que se ve ahora, decidido o sugerido
    k: 1,                   // escala lienzo -> pantalla
    arrastre: null,
    puesta: null,           // la prenda puesta, a tamaño de lienzo
    imagenes: new Map(),
    siluetas: new Map()
  };

  // Cuantas veces se ha pedido componer la prenda puesta. Cargar las
  // imagenes tarda, y si alguien pulsa una capa y enseguida otra, la
  // primera puede terminar DESPUES y pisar a la segunda: se veria la
  // boca con el titulo de pelo. Cada peticion anota su numero y, si al
  // terminar ya no es la ultima, se descarta. Mismo apaño que las
  // aperturas de js/avisos.js.
  let peticionPuesta = 0;

  // Si la pagina esta cargando algo. Se publica en el propio documento
  // (data-ocupada) para que quien necesite saber cuando termino -las
  // pruebas, sobre todo- lo mire en vez de adivinarlo con un reloj. El
  // titulo no vale para eso: cambia ANTES de que se repinte el cuadro.
  let pendientes = 0;
  function ocupada(delta) {
    pendientes = Math.max(0, pendientes + delta);
    document.body.dataset.ocupada = pendientes > 0 ? "si" : "no";
  }

  // ------------------------------------------------------------------
  // CUENTAS DEL CUADRO
  // ------------------------------------------------------------------

  function limitar(c) {
    const d = estado.datos;
    const lado = Math.round(Math.max(d.ladoMinimo, Math.min(d.ladoMaximo, c.lado)));
    return {
      x: Math.round(Math.max(0, Math.min(ANCHO - lado, c.x))),
      y: Math.round(Math.max(0, Math.min(ALTO - lado, c.y))),
      lado
    };
  }

  function prendas() {
    const p = estado.datos.prendas[estado.modelo];
    return (p && p[estado.capa]) || [];
  }

  function seSale(caja, c) {
    return !!caja && (caja.x < c.x || caja.y < c.y ||
      caja.x + caja.ancho > c.x + c.lado || caja.y + caja.alto > c.y + c.lado);
  }

  function decidido(modelo, capa) {
    return !!(estado.cuadros[modelo] && estado.cuadros[modelo][capa]);
  }

  function sugerencia(modelo, capa) {
    const s = estado.datos.sugerencias[modelo];
    return (s && s[capa]) || { x: 0, y: 0, lado: estado.datos.ladoMaximo };
  }

  // Poner el cuadro. Si `decidir`, queda como decision de esta capa en
  // este modelo; si no, es solo lo que se enseña (una sugerencia).
  function fijar(c, decidir) {
    estado.cuadro = limitar(c);
    if (decidir) {
      (estado.cuadros[estado.modelo] = estado.cuadros[estado.modelo] || {})[estado.capa] =
        { ...estado.cuadro };
    }
    pintarTodo();
    pedirReal();
  }

  // ------------------------------------------------------------------
  // LA CONFIGURACION Y SI HAY CAMBIOS
  // ------------------------------------------------------------------

  // En el mismo orden en que la escribe el servidor, para que comparar
  // "lo que hay" con "lo guardado" no dependa del orden de las claves.
  function configActual() {
    const cuadros = {};
    for (const modelo of Object.keys(estado.cuadros).sort()) {
      const porCapa = {};
      for (const capa of estado.datos.capas) {
        const c = estado.cuadros[modelo][capa];
        if (c) porCapa[capa] = { x: c.x, y: c.y, lado: c.lado };
      }
      if (Object.keys(porCapa).length) cuadros[modelo] = porCapa;
    }
    return {
      ladoSalida: estado.datos.config.ladoSalida || 96,
      maniqui: estado.maniqui,
      cuadros
    };
  }

  function hayCambios() {
    return JSON.stringify(configActual()) !== estado.guardado;
  }

  function combinaciones() {
    let total = 0, hechas = 0;
    for (const [modelo, porCapa] of Object.entries(estado.datos.prendas)) {
      for (const capa of Object.keys(porCapa)) {
        total++;
        if (decidido(modelo, capa)) hechas++;
      }
    }
    return { total, hechas };
  }

  // ------------------------------------------------------------------
  // IMAGENES
  // ------------------------------------------------------------------

  function imagen(url) {
    if (!estado.imagenes.has(url)) {
      estado.imagenes.set(url, new Promise((ok, mal) => {
        const img = new Image();
        img.onload = () => ok(img);
        img.onerror = () => mal(new Error("No cargo " + url));
        img.src = url;
      }));
    }
    return estado.imagenes.get(url);
  }

  // La silueta de un modelo: su forma, de un solo tono. Igual que hace el
  // servidor en api/_previsualizacion.js, para que "en vivo" y "la de
  // verdad" se parezcan.
  function silueta(modelo, img) {
    if (estado.siluetas.has(modelo)) return estado.siluetas.get(modelo);
    const c = document.createElement("canvas");
    c.width = ANCHO; c.height = ALTO;
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0, ANCHO, ALTO);
    x.globalCompositeOperation = "source-in";
    const m = estado.datos.colorManiqui;
    x.fillStyle = `rgb(${m.r},${m.g},${m.b})`;
    x.fillRect(0, 0, ANCHO, ALTO);
    estado.siluetas.set(modelo, c);
    return c;
  }

  // Compone la prenda puesta sobre su maniqui, a tamaño de lienzo, en el
  // orden de las capas: la espalda DETRAS del cuerpo. El fondo y el propio
  // modelo van solos.
  async function componerPuesta() {
    const mia = ++peticionPuesta;
    const lista = prendas();
    const prenda = lista[estado.indice];
    estado.puesta = null;
    if (!prenda) return;

    const c = document.createElement("canvas");
    c.width = ANCHO; c.height = ALTO;
    const x = c.getContext("2d");

    try {
      const imgPrenda = await imagen(prenda.url);
      const base = estado.datos.bases[estado.modelo];
      // Las capas que se enseñan solas, sin el cuerpo: la lista la manda
      // el servidor, la misma que usa api/_previsualizacion.js.
      const sola = (estado.datos.capasSolas || []).includes(estado.capa);

      if (sola || !base) {
        x.drawImage(imgPrenda, 0, 0, ANCHO, ALTO);
      } else {
        const imgBase = await imagen(base.url);
        const cuerpo = estado.maniqui === "plano" ? silueta(estado.modelo, imgBase) : imgBase;
        const capas = estado.datos.capas;
        const detras = capas.indexOf(estado.capa) < capas.indexOf("modelo");
        if (detras) { x.drawImage(imgPrenda, 0, 0, ANCHO, ALTO); x.drawImage(cuerpo, 0, 0, ANCHO, ALTO); }
        else { x.drawImage(cuerpo, 0, 0, ANCHO, ALTO); x.drawImage(imgPrenda, 0, 0, ANCHO, ALTO); }
      }
      if (mia !== peticionPuesta) return;   // ya se pidio otra: esta llega tarde
      estado.puesta = c;
    } catch (error) {
      console.warn(error);
    }
  }

  // ------------------------------------------------------------------
  // DIBUJAR
  // ------------------------------------------------------------------

  function ajustarLienzo() {
    const canvas = $("lienzo");
    const disponible = Math.max(360, window.innerHeight - 190);
    estado.k = Math.max(0.8, Math.min(1.6, disponible / ALTO));
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = Math.round(ANCHO * estado.k) + "px";
    canvas.style.height = Math.round(ALTO * estado.k) + "px";
    canvas.width = Math.round(ANCHO * estado.k * dpr);
    canvas.height = Math.round(ALTO * estado.k * dpr);
    canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function pintarLienzo() {
    const canvas = $("lienzo");
    const x = canvas.getContext("2d");
    const k = estado.k, c = estado.cuadro;
    x.clearRect(0, 0, ANCHO * k, ALTO * k);
    x.fillStyle = "#ffffff";
    x.fillRect(0, 0, ANCHO * k, ALTO * k);
    if (estado.puesta) {
      x.imageSmoothingQuality = "high";
      x.drawImage(estado.puesta, 0, 0, ANCHO * k, ALTO * k);
    }
    if (!c) return;

    // Lo de fuera del cuadro, oscurecido: se ve el recorte de un vistazo.
    x.fillStyle = "rgba(11,16,32,0.55)";
    x.beginPath();
    x.rect(0, 0, ANCHO * k, ALTO * k);
    x.rect(c.x * k, c.y * k, c.lado * k, c.lado * k);
    x.fill("evenodd");

    const esDecision = decidido(estado.modelo, estado.capa);
    x.lineWidth = 2;
    x.strokeStyle = esDecision ? "#34d399" : "#fbbf24";
    x.setLineDash(esDecision ? [] : [7, 5]);
    x.strokeRect(c.x * k + 1, c.y * k + 1, c.lado * k - 2, c.lado * k - 2);
    x.setLineDash([]);

    x.fillStyle = x.strokeStyle;
    for (const [ex, ey] of esquinas(c)) {
      x.beginPath();
      x.arc(ex, ey, 6, 0, Math.PI * 2);
      x.fill();
    }
  }

  function esquinas(c) {
    const k = estado.k;
    return [
      [c.x * k, c.y * k, "nw"],
      [(c.x + c.lado) * k, c.y * k, "ne"],
      [c.x * k, (c.y + c.lado) * k, "sw"],
      [(c.x + c.lado) * k, (c.y + c.lado) * k, "se"]
    ];
  }

  function pintarVistaViva() {
    const canvas = $("vistaViva");
    const x = canvas.getContext("2d");
    x.fillStyle = "#ffffff";
    x.fillRect(0, 0, 96, 96);
    const c = estado.cuadro;
    if (!estado.puesta || !c) return;
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = "high";
    x.drawImage(estado.puesta, c.x, c.y, c.lado, c.lado, 0, 0, 96, 96);
  }

  let temporizadorReal = null;
  function pedirReal(ahora) {
    clearTimeout(temporizadorReal);
    const pedir = () => {
      const prenda = prendas()[estado.indice];
      const c = estado.cuadro;
      if (!prenda || !c) return;
      const q = new URLSearchParams({
        valor: prenda.valor, x: c.x, y: c.y, lado: c.lado, maniqui: estado.maniqui
      });
      const url = API + "/muestra?" + q.toString();
      $("vistaReal").src = url;
      $("vistaReal2x").src = url;
    };
    if (ahora) pedir(); else temporizadorReal = setTimeout(pedir, 220);
  }

  function pintarPanel() {
    const c = estado.cuadro;
    const lista = prendas();
    const prenda = lista[estado.indice];

    for (const [id, v] of [["numX", c && c.x], ["numY", c && c.y], ["numLado", c && c.lado]]) {
      const el = $(id);
      if (document.activeElement !== el) el.value = v == null ? "" : v;
    }

    const fuera = c ? lista.filter(p => seSale(p.caja, c)).length : 0;
    const texto = $("seSalen");
    if (!lista.length) { texto.textContent = ""; }
    else if (fuera === 0) { texto.textContent = "Las " + lista.length + " prendas caben enteras en el cuadro"; texto.className = "se-salen bien"; }
    else { texto.textContent = fuera + " de " + lista.length + " prendas asoman fuera del cuadro"; texto.className = "se-salen mal"; }

    const esDecision = decidido(estado.modelo, estado.capa);
    $("avisoSugerencia").hidden = esDecision || !lista.length;
    $("botonAceptar").disabled = esDecision || !lista.length;
    $("botonQuitar").disabled = !esDecision;
    $("botonCopiar").disabled = !lista.length;

    $("contadorPrenda").textContent = lista.length ? (estado.indice + 1) + " de " + lista.length : "";
    const nombre = $("nombrePrenda");
    nombre.textContent = "";
    if (prenda) {
      nombre.append((prenda.nombre || prenda.valor) + " ");
      if (c && seSale(prenda.caja, c)) {
        const s = document.createElement("span");
        s.className = "fuera";
        s.textContent = "asoma fuera del cuadro";
        nombre.append(s);
      }
    }

    // La tira: con borde amarillo las que se salen.
    const tira = $("tira");
    tira.querySelectorAll("button").forEach((b, i) => {
      b.classList.toggle("actual", i === estado.indice);
      b.classList.toggle("fuera", !!(c && seSale(lista[i] && lista[i].caja, c)));
    });
  }

  function pintarCapas() {
    const ol = $("listaCapas");
    ol.textContent = "";
    const porCapa = estado.datos.prendas[estado.modelo] || {};
    for (const capa of estado.datos.capas) {
      const n = (porCapa[capa] || []).length;
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.disabled = !n;
      b.className = capa === estado.capa ? "activa" : "";
      const punto = document.createElement("span");
      punto.className = "punto" + (n ? (decidido(estado.modelo, capa) ? " decidido" : " sugerido") : "");
      const nombre = document.createElement("span");
      nombre.textContent = capa;
      nombre.style.flex = "1";
      const cuenta = document.createElement("span");
      cuenta.className = "n";
      cuenta.textContent = n ? n : "sin prendas";
      b.append(punto, nombre, cuenta);
      b.addEventListener("click", () => elegirCapa(capa));
      li.append(b);
      ol.append(li);
    }
  }

  function pintarModelos() {
    const nav = $("modelos");
    nav.textContent = "";
    for (const modelo of estado.datos.modelos) {
      const porCapa = estado.datos.prendas[modelo] || {};
      const capas = Object.keys(porCapa);
      const hechas = capas.filter(c => decidido(modelo, c)).length;
      const b = document.createElement("button");
      b.type = "button";
      b.className = modelo === estado.modelo ? "activo" : "";
      b.textContent = modelo + " " + hechas + "/" + capas.length;
      b.addEventListener("click", () => elegirModelo(modelo));
      nav.append(b);
    }
  }

  function pintarEstado() {
    const { total, hechas } = combinaciones();
    $("progreso").textContent = "Decididos: " + hechas + " de " + total;
    const cambios = hayCambios();
    $("botonGuardar").disabled = !cambios;
    const el = $("estadoGuardado");
    if (cambios) { el.textContent = "Cambios sin guardar"; el.className = "estado pendiente"; }
    else if (!el.classList.contains("bien")) { el.textContent = "Sin cambios"; el.className = "estado"; }
  }

  function pintarTodo() {
    pintarLienzo();
    pintarVistaViva();
    pintarPanel();
    pintarCapas();
    pintarModelos();
    pintarEstado();
  }

  function pintarTira() {
    const tira = $("tira");
    tira.textContent = "";
    prendas().forEach((p, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.title = p.nombre || p.valor;
      const img = document.createElement("img");
      img.loading = "lazy";
      img.alt = "";
      img.src = p.url;
      b.append(img);
      b.addEventListener("click", () => elegirPrenda(i));
      tira.append(b);
    });
  }

  // Como lo hacia macrojuegos, junto a "la de verdad" y al mismo tamaño,
  // para comparar de un vistazo sin tener que bajar.
  function pintarReferencias() {
    const cont = $("referencias");
    const nota = $("notaReferencias");
    cont.textContent = "";
    // El servidor ya las manda agrupadas por capa y con su URL.
    const todas = estado.datos.referencias || {};
    const refs = (todas.porCapa || {})[estado.capa] || [];
    if (refs.length && estado.capa === "modelo") {
      // Las cabezas de sus modelos, que se llaman como los nuestros: la
      // del modelo abierto, la primera.
      const nombre = url => url.split("/").pop().replace(".jpg", "");
      const orden = [...refs].sort((a, b) =>
        (nombre(b) === estado.modelo) - (nombre(a) === estado.modelo));
      nota.textContent = "Macrojuegos no hacía previsualización del modelo. Lo más parecido: la miniatura de cada uno, solo la cabeza.";
      for (const url of orden) cont.append(figuraReferencia(url, nombre(url)));
      return;
    }
    if (refs.length) {
      nota.textContent = "Cómo la enseñaba macrojuegos (" + refs.length + ")";
      for (const url of refs) cont.append(figuraReferencia(url));
      return;
    }
    // De esta capa no quedo ninguna: una de cada tipo, con su nombre, para
    // que al menos se vea el estilo.
    const muestras = todas.muestras || [];
    if (!muestras.length) {
      nota.textContent = "No hay referencias de macrojuegos en este equipo.";
      return;
    }
    nota.textContent = "De esta capa no quedó ninguna. Estas son de otros tipos, para ver el estilo.";
    for (const m of muestras) cont.append(figuraReferencia(m.url, m.nombre));
  }

  function figuraReferencia(url, pie) {
    const figura = document.createElement("figure");
    const img = document.createElement("img");
    img.src = url;
    img.width = 96;
    img.height = 96;
    img.alt = "Previsualización archivada de macrojuegos";
    img.title = url.split("/").pop();
    figura.append(img);
    if (pie) {
      const c = document.createElement("figcaption");
      c.textContent = pie;
      figura.append(c);
    }
    return figura;
  }

  // ------------------------------------------------------------------
  // ELEGIR
  // ------------------------------------------------------------------

  async function elegirPrenda(i) {
    const lista = prendas();
    if (!lista.length) return;
    estado.indice = (i + lista.length) % lista.length;
    ocupada(1);
    try {
      await componerPuesta();
      pintarTodo();
      pedirReal(true);
    } finally {
      ocupada(-1);
    }
  }

  async function elegirCapa(capa) {
    estado.capa = capa;
    estado.indice = 0;
    const d = estado.cuadros[estado.modelo] && estado.cuadros[estado.modelo][capa];
    estado.cuadro = limitar(d || sugerencia(estado.modelo, capa));
    $("tituloLienzo").textContent = estado.modelo + " · " + capa;
    pintarTira();
    pintarReferencias();
    await elegirPrenda(0);
  }

  async function elegirModelo(modelo) {
    estado.modelo = modelo;
    const porCapa = estado.datos.prendas[modelo] || {};
    const primera = estado.datos.capas.find(c => (porCapa[c] || []).length);
    await elegirCapa(estado.capa && (porCapa[estado.capa] || []).length ? estado.capa : primera);
  }

  function prendaExtrema(mayor) {
    const lista = prendas();
    let mejor = 0, valor = mayor ? -1 : Infinity;
    lista.forEach((p, i) => {
      const area = p.caja ? p.caja.ancho * p.caja.alto : 0;
      if (mayor ? area > valor : area < valor) { valor = area; mejor = i; }
    });
    elegirPrenda(mejor);
  }

  // ------------------------------------------------------------------
  // ARRASTRAR
  // ------------------------------------------------------------------

  function posicion(e) {
    const r = $("lienzo").getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  }

  function agarre(px, py) {
    const c = estado.cuadro;
    if (!c) return null;
    for (const [ex, ey, nombre] of esquinas(c)) {
      if (Math.hypot(px - ex, py - ey) <= ASA + 3) return { modo: nombre };
    }
    const k = estado.k;
    if (px >= c.x * k && px <= (c.x + c.lado) * k && py >= c.y * k && py <= (c.y + c.lado) * k) {
      return { modo: "mover" };
    }
    return null;
  }

  function alPulsar(e) {
    if (!prendas().length) return;
    const { px, py } = posicion(e);
    const a = agarre(px, py);
    if (!a) return;
    $("lienzo").setPointerCapture(e.pointerId);
    estado.arrastre = { ...a, px, py, inicio: { ...estado.cuadro } };
    e.preventDefault();
  }

  function alMover(e) {
    const { px, py } = posicion(e);
    if (!estado.arrastre) {
      const a = agarre(px, py);
      $("lienzo").style.cursor = !a ? "default" :
        a.modo === "mover" ? "move" : (a.modo === "nw" || a.modo === "se") ? "nwse-resize" : "nesw-resize";
      return;
    }
    const k = estado.k, a = estado.arrastre, s = a.inicio;
    const lx = px / k, ly = py / k;

    if (a.modo === "mover") {
      fijar({ x: s.x + (px - a.px) / k, y: s.y + (py - a.py) / k, lado: s.lado }, true);
      return;
    }

    // Cambiar el tamaño desde una esquina, con la opuesta fija y SIEMPRE
    // cuadrado: manda el mayor de los dos desplazamientos.
    const derecha = a.modo === "ne" || a.modo === "se";
    const abajo = a.modo === "sw" || a.modo === "se";
    const ax = derecha ? s.x : s.x + s.lado;           // la esquina fija
    const ay = abajo ? s.y : s.y + s.lado;
    let lado = Math.max(derecha ? lx - ax : ax - lx, abajo ? ly - ay : ay - ly);
    // Que no se salga del lienzo por el lado que crece.
    const tope = Math.min(derecha ? ANCHO - ax : ax, abajo ? ALTO - ay : ay);
    lado = Math.max(estado.datos.ladoMinimo, Math.min(tope, lado));
    fijar({ x: derecha ? ax : ax - lado, y: abajo ? ay : ay - lado, lado }, true);
  }

  function alSoltar(e) {
    if (!estado.arrastre) return;
    estado.arrastre = null;
    try { $("lienzo").releasePointerCapture(e.pointerId); } catch (_) {}
    pedirReal(true);
  }

  // Cambiar el tamaño manteniendo el centro, para la rueda y el teclado.
  function redimensionar(delta) {
    const c = estado.cuadro;
    if (!c || !prendas().length) return;
    const lado = c.lado + delta;
    fijar({ x: c.x - (lado - c.lado) / 2, y: c.y - (lado - c.lado) / 2, lado }, true);
  }

  // ------------------------------------------------------------------
  // GUARDAR
  // ------------------------------------------------------------------

  async function guardar() {
    const boton = $("botonGuardar");
    const el = $("estadoGuardado");
    boton.disabled = true;
    el.textContent = "Guardando...";
    el.className = "estado";
    try {
      const r = await fetch(API + "/guardar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configActual())
      });
      const datos = await r.json();
      if (!r.ok || !datos.ok) {
        el.textContent = "No se guardó: " + (datos.problemas && datos.problemas.length
          ? datos.problemas.slice(0, 2).join("; ") : datos.error);
        el.className = "estado mal";
        boton.disabled = false;
        return;
      }
      estado.guardado = JSON.stringify(configActual());
      const hora = new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
      const { hechas } = combinaciones();
      el.textContent = "Guardado a las " + hora + " · " + hechas + " cuadros en " + datos.archivo;
      el.className = "estado bien";
      pintarEstado();
    } catch (error) {
      el.textContent = "No se pudo guardar: " + error.message;
      el.className = "estado mal";
      boton.disabled = false;
    }
  }

  // ------------------------------------------------------------------
  // ARRANQUE
  // ------------------------------------------------------------------

  function enlazar() {
    const lienzo = $("lienzo");
    lienzo.addEventListener("pointerdown", alPulsar);
    lienzo.addEventListener("pointermove", alMover);
    lienzo.addEventListener("pointerup", alSoltar);
    lienzo.addEventListener("pointercancel", alSoltar);
    lienzo.addEventListener("wheel", e => {
      e.preventDefault();
      redimensionar(e.deltaY < 0 ? 4 : -4);
    }, { passive: false });

    lienzo.addEventListener("keydown", e => {
      const c = estado.cuadro;
      if (!c || !prendas().length) return;
      const paso = e.shiftKey ? 10 : 1;
      const mover = { ArrowLeft: [-paso, 0], ArrowRight: [paso, 0], ArrowUp: [0, -paso], ArrowDown: [0, paso] }[e.key];
      if (mover) {
        e.preventDefault();
        fijar({ x: c.x + mover[0], y: c.y + mover[1], lado: c.lado }, true);
        return;
      }
      if (e.key === "+" || e.key === "=") { e.preventDefault(); redimensionar(e.shiftKey ? 10 : 2); }
      if (e.key === "-" || e.key === "_") { e.preventDefault(); redimensionar(e.shiftKey ? -10 : -2); }
    });

    for (const [id, campo] of [["numX", "x"], ["numY", "y"], ["numLado", "lado"]]) {
      $(id).addEventListener("change", e => {
        const v = Number(e.target.value);
        if (!Number.isFinite(v) || !estado.cuadro) return;
        fijar({ ...estado.cuadro, [campo]: v }, true);
      });
    }

    $("botonAceptar").addEventListener("click", () => fijar(estado.cuadro, true));
    $("botonSugerencia").addEventListener("click", () => fijar(sugerencia(estado.modelo, estado.capa), true));
    $("botonQuitar").addEventListener("click", () => {
      if (estado.cuadros[estado.modelo]) delete estado.cuadros[estado.modelo][estado.capa];
      fijar(sugerencia(estado.modelo, estado.capa), false);
    });
    $("botonCopiar").addEventListener("click", () => {
      const c = estado.cuadro;
      let n = 0;
      for (const modelo of estado.datos.modelos) {
        if (modelo === estado.modelo) continue;
        const lista = (estado.datos.prendas[modelo] || {})[estado.capa] || [];
        if (!lista.length) continue;
        (estado.cuadros[modelo] = estado.cuadros[modelo] || {})[estado.capa] = { ...c };
        n++;
      }
      fijar(c, true);
      const el = $("estadoGuardado");
      el.textContent = "Copiado a " + n + " modelos: revisalos, que las poses no son iguales";
      el.className = "estado pendiente";
    });

    $("botonAnterior").addEventListener("click", () => elegirPrenda(estado.indice - 1));
    $("botonSiguiente").addEventListener("click", () => elegirPrenda(estado.indice + 1));
    $("botonGrande").addEventListener("click", () => prendaExtrema(true));
    $("botonPequena").addEventListener("click", () => prendaExtrema(false));
    $("botonGuardar").addEventListener("click", guardar);

    document.querySelectorAll("[data-maniqui]").forEach(b => {
      b.addEventListener("click", async () => {
        estado.maniqui = b.dataset.maniqui;
        document.querySelectorAll("[data-maniqui]").forEach(x => x.classList.toggle("activo", x === b));
        await elegirPrenda(estado.indice);
      });
    });

    window.addEventListener("resize", () => { ajustarLienzo(); pintarLienzo(); });
    window.addEventListener("beforeunload", e => {
      if (hayCambios()) { e.preventDefault(); e.returnValue = ""; }
    });
  }

  async function arrancar() {
    ajustarLienzo();
    enlazar();
    const r = await fetch(API + "/datos");
    if (!r.ok) {
      $("tituloLienzo").textContent = "No se pudieron cargar los datos (" + r.status + ")";
      return;
    }
    estado.datos = await r.json();
    estado.maniqui = estado.datos.config.maniqui || "plano";
    document.querySelectorAll("[data-maniqui]").forEach(x =>
      x.classList.toggle("activo", x.dataset.maniqui === estado.maniqui));

    // Lo que ya estaba guardado vuelve como decidido.
    estado.cuadros = JSON.parse(JSON.stringify(estado.datos.config.cuadros || {}));
    estado.guardado = JSON.stringify(configActual());

    await elegirModelo(estado.datos.modelos[0]);
    document.body.dataset.lista = "si";
  }

  arrancar().catch(error => {
    console.error(error);
    $("tituloLienzo").textContent = "Algo falló al arrancar: " + error.message;
  });
})();

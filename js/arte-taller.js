// ==============================
// EL TALLER — js/arte-taller.js
// ==============================
// Seis pasos para subir una prenda, con el maniquí presente en los seis.
//
// POR QUÉ EXISTE, con nombres y medidas. De las cinco prendas que se
// subieron por el panel en toda su historia, las cinco venían con el
// lienzo equivocado y hubo que retirar las cinco:
//
//   teto                                   500x500
//   pearto                                 569x570
//   Pearto                                 569x570
//   Mascara MR.                           1338x2066
//   Captura de pantalla 2026 09 15 113043  718x509
//
// Tres modos de fallo, no uno: la MEDIDA (las cinco), el NOMBRE (cuatro
// de los cinco son el nombre del archivo tal cual) y el DESTINO -en
// js/arte.js está escrito que alguien archivó una prenda de Tora en
// Cereza porque el desplegable venía con el primero por orden
// alfabético, y después no la encontraba-.
//
// Los seis pasos atacan los tres, y la puerta es lo que impide llegar a
// publicar sin haberlos mirado. Pero obliga a MIRAR, no a teclear:
// cuarenta prendas bien dibujadas pasan cada paso en un clic.
//
// ESTE ARCHIVO NO TIENE MANIQUÍ PROPIO. Gobierna el de
// js/arte-vestidor.js: mismo lienzo, mismo guardarropa, mismo ajuste. Lo
// único que distingue "taller" de "vestidor libre" es si el carril de
// pasos está a la vista y si la puerta está activa. Por eso hay un solo
// maniquí en el proyecto y no dos.
//
// Si este archivo no se carga, el vestidor sigue funcionando como antes.

(function (window) {
  "use strict";

  const document = window.document;
  const $ = id => document.getElementById(id);

  const V = () => window.MacroVestidor || null;

  let CTX = null;          // lo que presta js/arte.js
  let paso = 1;
  let libre = false;       // modo "sólo vestir", sin pasos
  let salto = 1;           // 1 px o 10 px, para la cruceta
  let conjuntos = [];      // las combinaciones del paso 5

  const PASOS = [
    { n: 1, nombre: "Personaje" },
    { n: 2, nombre: "Traer" },
    { n: 3, nombre: "Fichar" },
    { n: 4, nombre: "Colocar" },
    { n: 5, nombre: "Probar" },
    { n: 6, nombre: "Publicar" }
  ];

  function vaciar(nodo) {
    while (nodo && nodo.firstChild) nodo.removeChild(nodo.firstChild);
  }

  function elem(tag, clase, texto) {
    const n = document.createElement(tag);
    if (clase) n.className = clase;
    if (texto !== undefined && texto !== null) n.textContent = String(texto);
    return n;
  }

  function prendas() {
    return CTX ? CTX.archivos() : [];
  }

  // ==============================
  // LAS MARCAS Y LA PUERTA
  // ==============================

  // Un nombre que sea el del archivo no es un nombre. Cuatro de las cinco
  // prendas publicadas se llaman así, y "Captura de pantalla 2026 09 15
  // 113043" es lo que ve la gente en el editor de avatares.
  const NOMBRE_DE_ARCHIVO =
    /captura|screenshot|whats|^img[-_ ]?\d|^dsc|^photo|^imagen\s*\d|^\d+$|untitled|sin\s*t[ií]tulo|\.png$/i;

  function nombreSirve(nombre) {
    const n = String(nombre || "").trim();
    if (n.length < 2 || n.length > 60) return false;
    if (NOMBRE_DE_ARCHIVO.test(n)) return false;
    // Una ristra de dígitos larga suele ser una fecha o una marca de hora.
    if (/\d{4,}/.test(n)) return false;
    return true;
  }

  function mideElLienzo(item) {
    return item.ancho === V().LIENZO.ancho && item.alto === V().LIENZO.alto;
  }

  function marcas(item) {
    const puede = V().puedeAjustarse(item);
    const ajuste = item.ajuste;

    return {
      // Se puede seguir con una prenda descuadrada: lo que no se puede es
      // seguir sin haberlo decidido.
      medida: !puede ? false : (mideElLienzo(item) || !!(ajuste && ajuste.alLienzo) || item.talCual === true),
      ficha: !!(item.modelo && item.capa && nombreSirve(item.nombre)),
      colocada: !puede
        ? item.talCual === true
        : (mideElLienzo(item) || !!(ajuste && ajuste.alLienzo) || item.talCual === true)
    };
  }

  // Qué falta para poder seguir. Devuelve "" cuando no falta nada.
  function loQueFalta() {
    const lista = prendas();

    if (paso === 1) return "";
    if (paso === 2) return lista.length ? "" : "Traé al menos un PNG.";

    if (paso === 3) {
      const sin = lista.filter(a => !marcas(a).ficha);
      return sin.length ? sin.length + " sin fichar del todo (ranura o nombre)." : "";
    }

    if (paso === 4) {
      const sin = lista.filter(a => !marcas(a).colocada);
      return sin.length ? sin.length + " sin decidir qué hacer con su lienzo." : "";
    }

    // El paso 5 no tiene puerta propia: pulsar "Se ven bien" ES la
    // confirmación. Tenerla como puerta hacía el botón circular -estaba
    // apagado hasta confirmar, y confirmar era pulsarlo-. Que no se pueda
    // saltar ya lo garantiza el carril, que apaga todo lo que está por
    // delante del paso actual.
    return "";
  }

  function irA(n) {
    if (n < 1 || n > 6) return;
    // Hacia adelante, sólo si lo anterior está resuelto.
    if (n > paso && loQueFalta()) return;
    paso = n;
    pintarTodo();
  }

  // ==============================
  // EL CARRIL
  // ==============================

  function pintarCarril() {
    const carril = $("tallerCarril");
    vaciar(carril);
    carril.hidden = libre;
    if (libre) return;

    PASOS.forEach((p, i) => {
      if (i) carril.appendChild(elem("span", "taller-raya"));

      const b = elem("button", "taller-hito");
      b.type = "button";
      if (p.n < paso) b.classList.add("hecho");
      if (p.n === paso) b.setAttribute("aria-current", "step");

      b.appendChild(elem("span", "taller-bolita", p.n < paso ? "✓" : String(p.n)));
      b.appendChild(elem("span", null, p.nombre));

      // Atrás siempre se puede; adelante sólo hasta donde se llegó.
      b.disabled = p.n > paso;
      b.addEventListener("click", () => irA(p.n));
      carril.appendChild(b);
    });
  }

  function pintarNav() {
    const falta = loQueFalta();
    $("tallerNav").hidden = libre;
    $("tallerFalta").textContent = falta;
    $("tallerAtras").disabled = paso === 1;
    $("tallerSeguir").disabled = !!falta || paso === 6;
    $("tallerSeguir").textContent = paso === 5 ? "Se ven bien, seguir" : "Seguir";
  }

  // ==============================
  // PASO 1 — EL PERSONAJE
  // ==============================

  function pintarPersonajes() {
    const caja = $("tallerPersonajes");
    vaciar(caja);
    if (!CTX) return;

    const datos = CTX.datos();
    const actual = V().estado().modelo;

    for (const m of datos.modelos) {
      const cuantas = datos.prendas.filter(p => p.modelo === m.valor && p.publicada).length;

      const b = elem("button", "taller-personaje");
      b.type = "button";
      b.setAttribute("aria-pressed", String(m.valor === actual));
      b.appendChild(elem("div", "nom", CTX.conMayuscula(m.valor)));
      b.appendChild(elem("div", "cuantas", cuantas + " prendas"));
      b.addEventListener("click", () => {
        V().ponerModelo(m.valor);
        pintarTodo();
      });
      caja.appendChild(b);
    }

    pintarPlantillas(actual);
  }

  function pintarPlantillas(modelo) {
    const nombre = CTX ? CTX.conMayuscula(modelo || "") : "";

    const lienzo = $("tallerPlantillaLienzo");
    vaciar(lienzo);
    lienzo.appendChild(elem("span", "que",
      "lienzo-" + (modelo || "avatar") + "-" + V().LIENZO.ancho + "x" + V().LIENZO.alto + ".png"));
    lienzo.appendChild(elem("span", "como", "vacío, transparente, la medida exacta"));

    const guia = $("tallerPlantillaGuia");
    vaciar(guia);
    guia.appendChild(elem("span", "que", "guia-" + (modelo || "avatar") + ".png"));
    guia.appendChild(elem("span", "como", nombre + " desnudo, para ponerlo de capa debajo"));
  }

  // El lienzo vacío se dibuja acá mismo: es un PNG transparente de la
  // medida exacta, y eso un canvas lo sabe hacer sin pedirle nada a nadie.
  function bajarLienzoVacio() {
    const canvas = document.createElement("canvas");
    canvas.width = V().LIENZO.ancho;
    canvas.height = V().LIENZO.alto;
    const ctx = canvas.getContext("2d");
    if (!ctx) { window.alert("Este navegador no deja generar la plantilla."); return; }
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const modelo = V().estado().modelo || "avatar";
    bajar(canvas.toDataURL("image/png"),
      "lienzo-" + modelo + "-" + V().LIENZO.ancho + "x" + V().LIENZO.alto + ".png");
  }

  function bajarGuia() {
    if (!CTX) return;
    const modelo = V().estado().modelo;
    const m = CTX.datos().modelos.find(x => x.valor === modelo);
    if (!m) return;
    bajar(m.url, "guia-" + modelo + ".png");
  }

  function bajar(url, nombre) {
    const a = document.createElement("a");
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // ==============================
  // PASO 2 — TRAER LOS DIBUJOS
  // ==============================

  function pintarTraer() {
    const lista = prendas();
    const fuera = lista.filter(a => V().puedeAjustarse(a) && !mideElLienzo(a));
    const rotas = lista.filter(a => !V().puedeAjustarse(a));

    const dato = $("tallerMedidas");
    if (!lista.length) {
      dato.textContent = "";
    } else {
      const partes = [lista.length + " archivo(s)"];
      partes.push((lista.length - fuera.length - rotas.length) + " miden el lienzo");
      if (fuera.length) partes.push(fuera.length + " no");
      if (rotas.length) partes.push(rotas.length + " sin medida legible");
      dato.textContent = partes.join(" · ");
    }

    // El dibujo a escala del primero que no encaje. Un número en una línea
    // no evitó cinco de cinco; un rectángulo cinco veces más ancho, sí.
    const caja = $("tallerComparar");
    vaciar(caja);
    if (!fuera.length) return;

    const p = fuera[0];
    const alto = 70;
    const escala = alto / V().LIENZO.alto;
    const anchoArchivo = Math.round(p.ancho * escala);
    const altoArchivo = Math.round(p.alto * escala);

    const fig = elem("div", "taller-comparar");

    const uno = elem("figure");
    uno.style.margin = "0";
    const cajaLienzo = elem("div", "taller-caja lienzo");
    cajaLienzo.style.width = Math.round(V().LIENZO.ancho * escala) + "px";
    cajaLienzo.style.height = alto + "px";
    uno.appendChild(cajaLienzo);
    uno.appendChild(elem("figcaption", null, "el lienzo\n" + V().LIENZO.ancho + "×" + V().LIENZO.alto));
    fig.appendChild(uno);

    const dos = elem("figure");
    dos.style.margin = "0";
    const cajaArchivo = elem("div", "taller-caja archivo");
    cajaArchivo.style.width = Math.min(260, anchoArchivo) + "px";
    cajaArchivo.style.height = Math.min(170, altoArchivo) + "px";
    dos.appendChild(cajaArchivo);
    dos.appendChild(elem("figcaption", null, p.archivo + "\n" + p.ancho + "×" + p.alto));
    fig.appendChild(dos);

    caja.appendChild(fig);

    const cuantas = Math.round((p.ancho / V().LIENZO.ancho) * 10) / 10;
    const dice = elem("p", "vest-vacio",
      "Es " + String(cuantas).replace(".", ",") + " veces más ancho que el lienzo" +
      (p.alto < p.ancho ? " y está tumbado" : "") +
      ". En el paso de colocar se decide qué hacer con " +
      (fuera.length === 1 ? "esta." : "estas " + fuera.length + "."));
    dice.style.marginTop = "10px";
    caja.appendChild(dice);
  }

  async function traerArchivos(lista) {
    if (!CTX || !CTX.agregarArchivos) return;
    await CTX.agregarArchivos(lista);
    pintarTodo();
  }

  // ==============================
  // PASO 3 — FICHAR
  // ==============================

  // El nombre lo propone la herramienta, pero SÓLO interviene cuando hace
  // falta: "gorro_rojo.png" ya da "Gorro rojo", que es bueno. Lo que se
  // rechaza es "Captura de pantalla 2026 09 15 113043".
  function nombrePropuesto(item) {
    if (nombreSirve(item.nombre)) return item.nombre;
    if (!CTX || !item.capa) return "Sin nombre";

    const capa = CTX.conMayuscula(item.capa);
    const usados = CTX.datos().prendas
      .filter(p => p.modelo === item.modelo && p.capa === item.capa)
      .map(p => p.nombre);

    let n = 1;
    while (usados.indexOf(capa + " " + n) !== -1) n++;
    return capa + " " + n;
  }

  function pintarFichas() {
    const caja = $("tallerFichas");
    vaciar(caja);
    if (!CTX) return;

    const lista = prendas();
    const activa = V().estado().activa;
    const capas = CTX.datos().capas;

    $("tallerComunes").hidden = lista.length < 2;

    for (const item of lista) {
      const m = marcas(item);
      const ficha = elem("div", "taller-ficha" + (item.clave === activa ? " elegida" : "") + (m.ficha ? "" : " avisa"));
      ficha.addEventListener("click", () => { V().activar(item.clave); pintarTodo(); });

      const cab = elem("div");
      cab.style.display = "flex";
      cab.style.alignItems = "center";
      cab.style.gap = "8px";
      cab.appendChild(elem("span", "arch", item.archivo));
      const medida = elem("span", "vest-chip" + (mideElLienzo(item) ? "" : " ojo"),
        V().puedeAjustarse(item) ? item.ancho + "×" + item.alto : "sin medida");
      medida.style.marginLeft = "auto";
      cab.appendChild(medida);
      ficha.appendChild(cab);

      // Sólo la elegida abre los campos. Con cuarenta prendas, cuarenta
      // formularios abiertos no es una pantalla, es un muro.
      if (item.clave === activa) {
        const campos = elem("div", "taller-campos");
        campos.appendChild(campo("Ranura", select(capas, item.capa, v => {
          item.capa = v;
          if (!nombreSirve(item.nombre)) item.nombre = nombrePropuesto(item);
          pintarTodo();
        })));
        campos.appendChild(campo("Personaje", select(CTX.modelosDisponibles(), item.modelo, v => {
          item.modelo = v;
          pintarTodo();
        })));
        campos.appendChild(campo("Nombre", texto(item.nombre, v => { item.nombre = v; pintarNav(); })));
        campos.appendChild(campo("Precio", numero(item.precio, v => { item.precio = v; })));
        ficha.appendChild(campos);

        if (!nombreSirve(item.nombre)) {
          const aviso = elem("p", "vest-vacio",
            "El nombre del archivo no sirve de nombre: es lo que va a ver la gente en el editor. " +
            "Propuse «" + nombrePropuesto(item) + "».");
          aviso.style.color = "var(--gold)";
          aviso.style.marginTop = "8px";
          ficha.appendChild(aviso);
        }
      } else {
        const resumen = elem("div", "vest-dato",
          CTX.conMayuscula(item.modelo) + " · " + CTX.conMayuscula(item.capa) +
          " · «" + item.nombre + "»" + (item.precio ? " · " + item.precio + " monedas" : " · gratis"));
        ficha.appendChild(resumen);
      }

      caja.appendChild(ficha);
    }
  }

  function campo(etiqueta, control) {
    const caja = elem("div", "arte-campo");
    const id = "t" + Math.random().toString(36).slice(2, 9);
    const lab = elem("label", null, etiqueta);
    lab.setAttribute("for", id);
    control.id = id;
    caja.appendChild(lab);
    caja.appendChild(control);
    return caja;
  }

  function select(valores, actual, alCambiar) {
    const s = document.createElement("select");
    for (const v of valores) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = CTX.conMayuscula(v);
      s.appendChild(o);
    }
    s.value = actual;
    s.addEventListener("click", e => e.stopPropagation());
    s.addEventListener("change", () => alCambiar(s.value));
    return s;
  }

  function texto(valor, alCambiar) {
    const i = document.createElement("input");
    i.type = "text";
    i.maxLength = 60;
    i.value = valor || "";
    i.addEventListener("click", e => e.stopPropagation());
    i.addEventListener("input", () => alCambiar(i.value));
    return i;
  }

  function numero(valor, alCambiar) {
    const i = document.createElement("input");
    i.type = "number";
    i.min = "0";
    i.step = "10";
    i.value = String(valor || 0);
    i.addEventListener("click", e => e.stopPropagation());
    i.addEventListener("input", () => alCambiar(Math.max(0, Math.trunc(Number(i.value) || 0))));
    return i;
  }

  // ==============================
  // PASO 4 — COLOCAR
  // ==============================

  function pintarPorColocar() {
    const caja = $("tallerPorColocar");
    vaciar(caja);

    const lista = prendas();
    const activa = V().estado().activa;

    for (const item of lista) {
      const m = marcas(item);
      const fila = elem("div", "taller-ficha" + (item.clave === activa ? " elegida" : "") + (m.colocada ? "" : " avisa"));
      fila.addEventListener("click", () => { V().activar(item.clave); pintarTodo(); });

      const cab = elem("div");
      cab.style.display = "flex";
      cab.style.alignItems = "center";
      cab.style.gap = "8px";
      cab.appendChild(elem("span", "arch", item.nombre));

      const estado = elem("span", "vest-chip" + (m.colocada ? "" : " ojo"),
        !V().puedeAjustarse(item) ? "sin medida"
          : mideElLienzo(item) ? "no hace falta"
          : m.colocada ? (item.talCual ? "tal cual" : "al lienzo")
          : item.ancho + "×" + item.alto);
      estado.style.marginLeft = "auto";
      cab.appendChild(estado);

      fila.appendChild(cab);
      caja.appendChild(fila);
    }
  }

  function mover(ex, ey) {
    const est = V().estado();
    if (!est.activa) return;
    // Se empuja por el mismo camino que el teclado: cambiarAjuste es el
    // único sitio que escribe un ajuste, y deshacer cuenta con ello.
    const tecla = ex < 0 ? "ArrowLeft" : ex > 0 ? "ArrowRight" : ey < 0 ? "ArrowUp" : "ArrowDown";
    document.dispatchEvent(new window.KeyboardEvent("keydown", {
      key: tecla, shiftKey: salto === 10, bubbles: true
    }));
  }

  function ponerSalto(n) {
    salto = n;
    $("tallerSalto1").setAttribute("aria-pressed", String(n === 1));
    $("tallerSalto10").setAttribute("aria-pressed", String(n === 10));
    $("tallerSalto").textContent = n + "px";
  }

  function sincronizarBarra() {
    const barra = $("vestEscalaBarra");
    const campo = $("vestEscala");
    if (barra && campo && barra.value !== campo.value) barra.value = campo.value;
  }

  function pintarTalCual() {
    const est = V().estado();
    const item = prendas().find(a => a.clave === est.activa);
    const boton = $("tallerTalCual");
    if (!item || !V().puedeAjustarse(item) || mideElLienzo(item) ||
        (item.ajuste && item.ajuste.alLienzo) || item.talCual) {
      boton.hidden = true;
      return;
    }
    boton.hidden = false;
  }

  // ==============================
  // PASO 5 — PROBAR
  // ==============================

  function pintarConjuntos() {
    const caja = $("tallerConjuntos");
    vaciar(caja);
    if (!CTX) return;

    if (!conjuntos.length) sortearConjuntos();

    for (const rutas of conjuntos) {
      const mini = elem("div", "taller-conjunto");
      for (const url of rutas) {
        const img = document.createElement("img");
        img.src = url;
        img.alt = "";
        mini.appendChild(img);
      }
      caja.appendChild(mini);
    }
  }

  // Seis conjuntos del catálogo con las prendas nuevas SIEMPRE puestas.
  // Se arman sobre lo que el motor dice que lleva puesto, para no duplicar
  // la regla de quién gana cada ranura.
  function sortearConjuntos() {
    conjuntos = [];
    if (!CTX) return;

    const datos = CTX.datos();
    const est = V().estado();
    const nuevas = prendas().filter(a => V().puedeAjustarse(a));

    for (let i = 0; i < 6; i++) {
      const rutas = [];
      for (const capa of V().capas()) {
        const dePrueba = nuevas.filter(a => a.capa === capa);
        if (dePrueba.length) { rutas.push(dePrueba[dePrueba.length - 1].dataUrl); continue; }

        if (capa === "modelo") {
          const m = datos.modelos.find(x => x.valor === est.modelo);
          if (m) rutas.push(m.url);
          continue;
        }

        const hay = datos.prendas.filter(p => p.capa === capa && p.modelo === est.modelo && p.publicada);
        if (!hay.length) continue;
        const obligatoria = ["piel", "ojos", "boca", "pelo"].indexOf(capa) !== -1;
        if (!obligatoria && Math.random() < 0.55) continue;
        rutas.push(hay[Math.floor(Math.random() * hay.length)].url);
      }
      conjuntos.push(rutas);
    }
  }

  // ==============================
  // PASO 6 — PUBLICAR
  // ==============================

  function pintarResumen() {
    const caja = $("tallerResumen");
    vaciar(caja);

    for (const item of prendas()) {
      const linea = elem("div", "taller-linea");

      const marca = document.createElement("input");
      marca.type = "checkbox";
      marca.className = "vest-check";
      marca.checked = item.elegida !== false;
      marca.addEventListener("change", () => { item.elegida = marca.checked; pintarNav(); });
      linea.appendChild(marca);

      const mini = document.createElement("img");
      mini.src = item.dataUrl;
      mini.alt = "";
      linea.appendChild(mini);

      const medio = elem("div");
      medio.appendChild(elem("div", null, item.nombre));
      medio.appendChild(elem("div", "sera",
        CTX.conMayuscula(item.modelo) + " · " + CTX.conMayuscula(item.capa) +
        (item.precio ? " · " + item.precio + " monedas" : " · gratis")));
      linea.appendChild(medio);

      const hornea = V().hayQueHornear(item);
      linea.appendChild(elem("span", "vest-chip" + (hornea ? "" : " "),
        hornea ? "horneada al lienzo" : "tal cual, byte a byte"));

      caja.appendChild(linea);
    }
  }

  // ==============================
  // VESTIR CON AVATARES DE VERDAD
  // ==============================

  async function vestirComoUsuario(nombre) {
    const aviso = $("tallerAvisoVestir");
    aviso.textContent = "Buscando a " + nombre + "…";

    try {
      const r = await window.fetch("/api/users?action=get&ligero=1&username=" + encodeURIComponent(nombre));
      const datos = await r.json();
      const avatar = datos && (datos.user ? datos.user.avatar : datos.avatar);

      if (!avatar || typeof avatar !== "object" || avatar.tipo === "png") {
        aviso.textContent = avatar && avatar.tipo === "png"
          ? nombre + " lleva un avatar PNG, que no se arma con prendas."
          : "No se encontró el avatar de " + nombre + ".";
        return;
      }

      const puestas = V().vestirComoAvatar(avatar);
      aviso.textContent = puestas
        ? "Puesto el avatar de " + nombre + " (" + puestas + " prendas)."
        : nombre + " no lleva prendas de este personaje.";
      pintarTodo();
    } catch (_) {
      aviso.textContent = "No se pudo consultar ese usuario.";
    }
  }

  function miAvatar() {
    const yo = CTX ? CTX.datos().yo : null;
    if (yo) vestirComoUsuario(yo);
  }

  // ==============================
  // PINTAR TODO
  // ==============================

  function pintarTodo() {
    if (!CTX) return;

    for (const p of document.querySelectorAll(".taller-paso")) {
      p.hidden = libre || Number(p.dataset.paso) !== paso;
    }
    $("vestGuardarropa").hidden = !libre && paso !== 4 ? true : $("vestGuardarropa").hidden;
    if (libre) $("vestGuardarropa").hidden = false;

    pintarCarril();
    pintarNav();

    if (libre) return;

    if (paso === 1) pintarPersonajes();
    if (paso === 2) pintarTraer();
    if (paso === 3) pintarFichas();
    if (paso === 4) { pintarPorColocar(); pintarTalCual(); sincronizarBarra(); }
    if (paso === 5) pintarConjuntos();
    if (paso === 6) pintarResumen();
  }

  // ==============================
  // CONECTAR
  // ==============================

  function conectar(ctx) {
    // arte.html ya no trae el taller -vive en taller.html- y ademas no
    // carga este archivo. Pero si algun dia volviera a cargarse en una
    // pagina sin el marcado, montarlo reventaria en el primer
    // addEventListener sobre null y se llevaria por delante el resto del
    // arranque. Mejor no hacer nada.
    if (!$("tallerCarril")) return;

    CTX = ctx;

    // El motor avisa cuando cambia un ajuste; si no, la puerta se queda
    // con el texto de antes y Seguir no se enciende nunca.
    if (V() && V().alTocar) V().alTocar(() => { if (!libre) pintarTodo(); });

    // En taller.html la pagina YA es el taller: no hay nada que abrir.
    // En arte.html, en cambio, el taller no existe y esto no corre.
    if (document.body.classList.contains("taller-pagina")) {
      libre = false;
      paso = 1;
      V().abrir();
      setTimeout(pintarTodo, 0);
    }

    $("vestAbrir").addEventListener("click", () => { libre = false; paso = 1; setTimeout(pintarTodo, 0); });
    $("tallerLibre").addEventListener("click", () => {
      libre = true;
      V().abrir();
      setTimeout(pintarTodo, 0);
    });

    $("tallerAtras").addEventListener("click", () => irA(paso - 1));
    $("tallerSeguir").addEventListener("click", () => irA(paso + 1));

    $("tallerGuardarropa").addEventListener("click", () => {
      const g = $("vestGuardarropa");
      g.hidden = !g.hidden;
    });

    $("tallerPlantillaLienzo").addEventListener("click", bajarLienzoVacio);
    $("tallerPlantillaGuia").addEventListener("click", bajarGuia);

    // Traer: el <input>, soltar y pegar. Los tres por el MISMO camino que
    // usa la subida de siempre, así lo que se prueba es lo que se publica.
    $("tallerArchivos").addEventListener("change", e => {
      const archivos = Array.from(e.target.files || []);
      e.target.value = "";
      traerArchivos(archivos);
    });

    const zona = $("tallerSoltar");
    ["dragenter", "dragover"].forEach(t => zona.addEventListener(t, e => {
      e.preventDefault();
      zona.classList.add("encima");
    }));
    ["dragleave", "drop"].forEach(t => zona.addEventListener(t, e => {
      e.preventDefault();
      zona.classList.remove("encima");
    }));
    zona.addEventListener("drop", e => {
      const archivos = Array.from((e.dataTransfer && e.dataTransfer.files) || [])
        .filter(f => f.type === "image/png");
      if (archivos.length) traerArchivos(archivos);
    });

    document.addEventListener("paste", e => {
      if (libre || paso !== 2) return;
      const archivos = Array.from((e.clipboardData && e.clipboardData.files) || [])
        .filter(f => f.type === "image/png");
      if (archivos.length) traerArchivos(archivos);
    });

    $("tallerAplicarTodas").addEventListener("click", () => {
      const capa = $("tallerTodasCapa").value;
      for (const item of prendas()) {
        item.capa = capa;
        if (!nombreSirve(item.nombre)) item.nombre = nombrePropuesto(item);
      }
      pintarTodo();
    });

    // Colocar: la cruceta y el deslizador.
    for (const b of document.querySelectorAll(".taller-flecha")) {
      const partes = b.dataset.mueve.split(",");
      b.addEventListener("click", () => mover(Number(partes[0]), Number(partes[1])));
    }
    $("tallerSalto1").addEventListener("click", () => ponerSalto(1));
    $("tallerSalto10").addEventListener("click", () => ponerSalto(10));

    $("vestEscalaBarra").addEventListener("input", () => {
      const campo = $("vestEscala");
      campo.value = $("vestEscalaBarra").value;
      campo.dispatchEvent(new window.Event("input", { bubbles: true }));
    });

    $("tallerTalCual").addEventListener("click", () => {
      const est = V().estado();
      const item = prendas().find(a => a.clave === est.activa);
      if (!item) return;
      const seguro = window.confirm(
        "Publicar «" + item.nombre + "» tal cual, con " + item.ancho + "×" + item.alto + ".\n\n" +
        "El sitio la va a encajar dentro del marco, así que se verá más chica " +
        "que el resto del catálogo. Llevarla al lienzo no toca un solo píxel del dibujo.");
      if (!seguro) return;
      item.talCual = true;
      pintarTodo();
    });

    $("tallerOtrosSeis").addEventListener("click", () => { sortearConjuntos(); pintarConjuntos(); });

    $("tallerMiAvatar").addEventListener("click", miAvatar);
    $("tallerOtroAvatar").addEventListener("click", () => {
      const nombre = window.prompt("¿El avatar de quién?");
      if (nombre) vestirComoUsuario(nombre.trim());
    });

    // Publicar deja la cola vacía: el taller vuelve al principio.
    $("vestPublicar").addEventListener("click", () => { setTimeout(() => { paso = 1; pintarTodo(); }, 0); });
  }

  // js/arte.js avisa cuando su lista cambia.
  function avisarDeCambio() {
    if (!CTX) return;
    // Un nombre de archivo no sirve de nombre: se propone uno al entrar.
    for (const item of prendas()) {
      if (item.nombrePropuesto) continue;
      if (!nombreSirve(item.nombre) && item.capa) {
        item.nombre = nombrePropuesto(item);
        item.nombrePropuesto = true;
      }
    }
    conjuntos = [];
    pintarTodo();
  }

  function llenarCapas() {
    if (!CTX) return;
    const s = $("tallerTodasCapa");
    vaciar(s);
    for (const c of CTX.datos().capas) {
      const o = document.createElement("option");
      o.value = c;
      o.textContent = CTX.conMayuscula(c);
      s.appendChild(o);
    }
  }

  window.MacroTaller = {
    conectar,
    avisarDeCambio,
    llenarCapas,
    pintarTodo,
    irA,
    nombreSirve,
    marcas
  };

})(window);

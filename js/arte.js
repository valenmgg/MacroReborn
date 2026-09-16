// ==============================
// PANEL DEL EQUIPO DE ARTE — js/arte.js
// ==============================
// La pantalla que permite al equipo de dibujo subir prendas al editor de
// avatares sin tocar código ni esperar un despliegue.
//
// Antes, añadir una prenda era dejar el PNG en imagenes/, escribir un div
// en perfil.html, otra entrada en un mapa de rutas de perfil.js y
// desplegar. Tres sitios a mano, y si te olvidabas de uno la prenda no
// aparecía y nadie se enteraba: así se perdieron cinco prendas y un juego
// entero de ocho bocas.
//
// Todo lo que se pinta acá se arma con createElement y textContent, nunca
// con innerHTML: los nombres de las prendas los escriben personas, y este
// panel lo abren administradores.

(function () {
  "use strict";

  // El lienzo con el que está dibujado el catálogo. Todavía no se rechaza
  // nada por tamaño —se decidió dejarlo para más adelante—, pero si un
  // dibujo no encaja conviene verlo antes de publicarlo, no después.
  const LIENZO = { ancho: 327, alto: 504 };
  const TOPE_POR_TANDA = 20;
  const TOPE_POR_PRENDA = 1024 * 1024;

  const $ = id => document.getElementById(id);

  // ESTE ARCHIVO SIRVE A DOS PAGINAS.
  //
  // Trae los datos del panel de arte -el catalogo, la lista de prendas
  // preparadas, subir y publicar- y ademas pinta el panel clasico de
  // arte.html: la subida rapida y la rejilla del catalogo.
  //
  // taller.html usa lo primero y no tiene lo segundo, asi que toda la
  // pintura del panel viejo se salta sola cuando su marcado no esta. Se
  // reconoce por #arteLista, que es donde vive la lista de subida.
  //
  // Es a proposito que la parte de datos NO sepa nada de esa diferencia:
  // publicar(), agregarArchivos() y el resto funcionan igual en las dos
  // paginas, y eso es lo que hace que lo que se prueba en el taller sea
  // exactamente lo que se publica desde el panel.
  const HAY_PANEL = () => !!$("arteLista");

  // Para los sitios sueltos que solo escriben un texto de estado.
  function decir(texto) {
    const n = $("arteEstado");
    if (n) n.textContent = texto;
  }

  // El vestidor, si está cargado. Es un GETTER y no una constante: este
  // archivo se evalúa antes de que termine el defer del otro en algún
  // orden raro, y además tests/arte-pagina.test.js evalúa SOLO js/arte.js
  // y tiene que seguir pasando sin él.
  //
  // Borrar js/arte-vestidor.js, su <script>, su sección del HTML y su
  // banda de CSS deja este panel exactamente como estaba.
  const V = () => window.MacroVestidor || null;
  const T = () => window.MacroTaller || null;

  let DATOS = null;      // lo que devuelve avatar-panel
  let ARCHIVOS = [];     // lo que hay preparado para subir

  // ==============================
  // UTILIDADES
  // ==============================

  function vaciar(nodo) {
    while (nodo && nodo.firstChild) nodo.removeChild(nodo.firstChild);
  }

  function elem(tag, clase, texto) {
    const n = document.createElement(tag);
    if (clase) n.className = clase;
    if (texto !== undefined && texto !== null) n.textContent = String(texto);
    return n;
  }

  function opcion(valor, texto) {
    const o = document.createElement("option");
    o.value = valor;
    o.textContent = texto;
    return o;
  }

  function llenarSelect(select, valores, etiqueta) {
    vaciar(select);
    valores.forEach(v => select.appendChild(opcion(v, etiqueta ? etiqueta(v) : v)));
  }

  function conMayuscula(texto) {
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  // "botas_de_combate.png" -> "Botas de combate"
  function nombreDesdeArchivo(archivo) {
    const base = archivo.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
    return base ? conMayuscula(base).slice(0, 60) : "Sin nombre";
  }

  // Si el archivo se llama "botas3.png" y "botas" es una ranura real, se
  // adivina. Es solo una comodidad: siempre se puede cambiar.
  function capaDesdeArchivo(archivo, capas) {
    const base = archivo.toLowerCase().replace(/\.[^.]+$/, "");
    const sinModelo = base.replace(/^[a-z0-9]+[_-]/, "");
    return capas.find(c => base.startsWith(c)) ||
           capas.find(c => sinModelo.startsWith(c)) ||
           capas[0];
  }

  // Y el personaje, si el archivo lo trae delante: "tora_botas3.png".
  //
  // Existe porque el desplegable venia con el primero de la lista, que
  // es "cereza" por orden alfabetico. Quien subia una prenda de tora sin
  // fijarse la archivaba en cereza, y despues no la encontraba en el
  // editor: no porque fallara nada, sino porque el editor solo enseña la
  // ropa del personaje que tenes puesto. Paso de verdad la primera vez
  // que se uso el panel.
  function modeloDesdeArchivo(archivo, modelos) {
    const base = archivo.toLowerCase().replace(/\.[^.]+$/, "");
    return modelos.find(m => base === m || base.startsWith(m + "_") || base.startsWith(m + "-")) || null;
  }

  // ==============================
  // AVISOS
  // ==============================

  function mostrarAviso(titulo, parrafos, malo) {
    const caja = $("arteAviso");
    caja.hidden = false;
    caja.className = "arte-aviso" + (malo ? " malo" : "");
    vaciar(caja);
    caja.appendChild(elem("h2", null, titulo));
    (parrafos || []).forEach(p => caja.appendChild(elem("p", null, p)));
  }

  // ==============================
  // CARGA
  // ==============================

  async function cargarPanel() {
    let respuesta;
    try {
      respuesta = await fetch("/api/content?action=avatar-panel");
    } catch (error) {
      mostrarAviso("No se pudo conectar", [
        "Comprobá tu conexión y recargá la página."
      ], true);
      return;
    }

    // Sin sesión o sin el rol no se explica nada: se sale a la portada.
    //
    // Es una herramienta interna, y una pantalla que dice "esta sección
    // es del equipo de arte" le confirma a cualquiera que existe y dónde
    // está. Quien tiene el rol llega acá desde el enlace de su perfil y
    // no ve esto nunca.
    //
    // No protege nada por sí solo: el servidor comprueba el rol en cada
    // petición. Esto es solo para no dejar una puerta señalizada.
    if (respuesta.status === 401 || respuesta.status === 403) {
      window.location.replace("index.html");
      return;
    }

    let datos = null;
    try {
      datos = await respuesta.json();
    } catch (_) { /* cae abajo */ }

    if (!respuesta.ok || !datos || !datos.success) {
      mostrarAviso("Algo salió mal", [
        "El servidor no devolvió el catálogo. Probá recargar la página."
      ], true);
      return;
    }

    DATOS = datos;
    $("arteAviso").hidden = true;

    // Cada pagina destapa lo que tiene. arte.html trae el panel clasico;
    // taller.html, el taller. Ninguna de las dos tiene lo de la otra.
    for (const id of ["arteSubir", "arteCatalogo", "arteVestidor"]) {
      const caja = $(id);
      if (caja) caja.hidden = false;
    }

    prepararControles();
    pintarCatalogo();
  }

  function modelosDisponibles() {
    return DATOS.modelos.map(m => m.valor);
  }

  function urlDelModelo(valor) {
    const m = DATOS.modelos.find(x => x.valor === valor);
    return m ? m.url : null;
  }

  function prepararControles() {
    const modelos = modelosDisponibles();
    const capas = DATOS.capas;

    // Los controles del panel clasico, solo si el panel clasico esta. Lo
    // que viene despues -conectar el vestidor y el taller- va SIEMPRE.
    if (HAY_PANEL()) prepararPanelClasico(modelos, capas);
    conectarHerramientas();
  }

  function prepararPanelClasico(modelos, capas) {
    llenarSelect($("arteTodosModelo"), modelos, conMayuscula);
    llenarSelect($("arteTodosCapa"), capas, conMayuscula);

    llenarSelect($("arteFiltroModelo"), ["todos"].concat(modelos),
      v => v === "todos" ? "Todos" : conMayuscula(v));
    llenarSelect($("arteFiltroCapa"), ["todas"].concat(capas),
      v => v === "todas" ? "Todas" : conMayuscula(v));

    ["arteFiltroModelo", "arteFiltroCapa", "arteFiltroEstado", "arteFiltroAutor"]
      .forEach(id => $(id).addEventListener("change", pintarCatalogo));

    $("arteArchivos").addEventListener("change", alElegirArchivos);
    $("arteAplicarTodas").addEventListener("click", aplicarATodas);
    $("arteSubirBtn").addEventListener("click", () => publicar(ARCHIVOS));

  }

  function conectarHerramientas() {
    // Se le pasan GETTERS y no los objetos: publicar() reasigna ARCHIVOS
    // y recarga DATOS, así que una referencia guardada dejaría al vestidor
    // enseñando el catálogo viejo y una lista fantasma justo después de
    // publicar, que es cuando más se mira.
    if (V()) V().conectar({
      datos: () => DATOS,
      archivos: () => ARCHIVOS,
      repintarLista: pintarLista,
      publicar,
      quitarArchivo,
      agregarArchivos,
      urlDelModelo,
      modelosDisponibles,
      conMayuscula,
      modeloDe,
      destinoDe
    });

    if (T()) {
      T().conectar({
        datos: () => DATOS,
        archivos: () => ARCHIVOS,
        agregarArchivos,
        quitarArchivo,
        publicar,
        repintarLista: pintarLista,
        urlDelModelo,
        modelosDisponibles,
        conMayuscula
      });
      T().llenarCapas();
    }
  }

  // ==============================
  // ELEGIR ARCHIVOS
  // ==============================

  function leerArchivo(file) {
    return new Promise(resolve => {
      const lector = new FileReader();
      lector.onerror = () => resolve(null);
      lector.onload = () => {
        const dataUrl = String(lector.result || "");
        const img = new Image();
        img.onerror = () => resolve({ dataUrl, ancho: 0, alto: 0 });
        img.onload = () => resolve({ dataUrl, ancho: img.naturalWidth, alto: img.naturalHeight });
        img.src = dataUrl;
      };
      lector.readAsDataURL(file);
    });
  }

  // El taller trae archivos por tres caminos -el <input>, soltarlos y
  // pegarlos- y los tres tienen que entrar por AQUI, no por una copia:
  // lo que se prueba tiene que ser lo que se publica.
  //
  // El Array.from va PRIMERO, siempre: evento.target.files es una
  // FileList VIVA, y limpiar el input la vacia. El cuerpo de una funcion
  // async corre sincrono hasta el primer await, asi que con la copia
  // delante la instantanea esta tomada antes de que nada pueda pasar.
  async function agregarArchivos(lista) {
    const elegidos = Array.from(lista || []);
    if (!elegidos.length) return;

    decir("Leyendo " + elegidos.length + " archivo(s)…");

    for (const file of elegidos) {
      if (ARCHIVOS.length >= 200) break;   // freno de cordura

      const leido = await leerArchivo(file);
      if (!leido) continue;

      ARCHIVOS.push({
        clave: file.name + ":" + file.size + ":" + Math.random().toString(36).slice(2, 8),
        archivo: file.name,
        peso: file.size,
        dataUrl: leido.dataUrl,
        ancho: leido.ancho,
        alto: leido.alto,
        // El personaje sale, por este orden: del nombre del archivo
        // ("tora_botas3.png"), del que lleva puesto el maniquí, y sólo si
        // no hay ninguno, del desplegable del formulario viejo.
        //
        // El maniquí va ANTES que el desplegable porque el taller elige el
        // personaje en su primer paso y el maniquí es quien lo sabe. Sin
        // esto, elegir Max en el paso 1 y soltar un PNG lo archivaba en
        // Tora: exactamente el fallo que ese paso existe para evitar, y
        // que ya había pasado con el desplegable alfabético.
        modelo: modeloDesdeArchivo(file.name, modelosDisponibles()) ||
          (V() && V().estado ? V().estado().modelo : null) ||
          ($("arteTodosModelo") ? $("arteTodosModelo").value : modelosDisponibles()[0]),
        capa: capaDesdeArchivo(file.name, DATOS.capas),
        nombre: nombreDesdeArchivo(file.name),
        precio: 0,
        // Mientras sea null, el artista no movió nada y el PNG se sube
        // byte a byte. Un solo campo, no dos: ver vestHayQueHornear.
        ajuste: null
      });
    }

    decir("");
    pintarLista();
  }

  async function alElegirArchivos(evento) {
    const elegidos = Array.from(evento.target.files || []);
    // Se limpia DESPUES de la copia, para poder volver a elegir el mismo
    // archivo si hace falta.
    evento.target.value = "";
    await agregarArchivos(elegidos);
  }

  function aplicarATodas() {
    if (!HAY_PANEL()) return;
    const modelo = $("arteTodosModelo").value;
    const capa = $("arteTodosCapa").value;
    const precio = Math.max(0, Math.trunc(Number($("arteTodosPrecio").value) || 0));

    ARCHIVOS.forEach(a => {
      a.modelo = modelo;
      a.capa = capa;
      a.precio = precio;
    });
    pintarLista();
  }

  // ==============================
  // LISTA DE SUBIDA
  // ==============================

  // La previsualización monta la prenda sobre el personaje elegido, con
  // las mismas capas superpuestas que usa el editor. Es lo que permite
  // ver si un dibujo está descuadrado ANTES de publicarlo, en vez de
  // enterarse cuando alguien se lo pone.
  function vistaPrevia(item) {
    const caja = elem("div", "arte-vista");

    const base = urlDelModelo(item.modelo);
    if (base) {
      const fondo = document.createElement("img");
      fondo.src = base;
      fondo.alt = "";
      caja.appendChild(fondo);
    }

    const prenda = document.createElement("img");
    prenda.src = item.dataUrl || item.url;
    prenda.alt = "";
    caja.appendChild(prenda);

    return caja;
  }

  function quitarArchivo(clave) {
    const i = ARCHIVOS.findIndex(a => a.clave === clave);
    if (i !== -1) ARCHIVOS.splice(i, 1);
    pintarLista();
  }

  function pintarLista() {
    // El rail del vestidor y las fichas del taller pintan ESTA misma
    // lista, no una copia: si tuvieran la suya, se podria ajustar algo
    // que nunca llega a subirse.
    //
    // Y el aviso va ANTES del guardian del panel clasico, no despues.
    // Estuvo al reves un rato y en taller.html -que no tiene panel- esta
    // funcion salia en la primera linea sin avisar a nadie: la cola se
    // quedaba vacia y los nombres no se proponian, con la prenda ya
    // dentro. Un return temprano que se come un efecto que si hacia falta.
    if (V()) V().avisarDeCambio();
    if (T()) T().avisarDeCambio();

    if (!HAY_PANEL()) return;

    const lista = $("arteLista");
    vaciar(lista);

    $("arteComunes").hidden = ARCHIVOS.length === 0;
    $("arteAcciones").hidden = ARCHIVOS.length === 0;

    if (!ARCHIVOS.length) return;

    ARCHIVOS.forEach((item, indice) => {
      const fila = elem("div", "arte-fila");

      // ---- columna izquierda: la prenda sobre el personaje ----
      const izquierda = elem("div");
      izquierda.appendChild(vistaPrevia(item));

      const medidas = elem("div", "arte-medidas");
      if (!item.ancho) {
        medidas.textContent = "no se pudo leer";
        medidas.classList.add("ojo");
      } else {
        medidas.textContent = item.ancho + "×" + item.alto;
        if (item.ancho !== LIENZO.ancho || item.alto !== LIENZO.alto) {
          medidas.classList.add("ojo");
          medidas.title = "El catálogo está dibujado a " + LIENZO.ancho + "×" + LIENZO.alto +
            ". Con otra medida puede quedar descuadrado sobre el personaje.";
        }
      }
      izquierda.appendChild(medidas);
      fila.appendChild(izquierda);

      // ---- columna derecha: los datos ----
      const datos = elem("div", "arte-fila-datos");

      const cabecera = elem("div", "arte-fila-nombrearchivo");
      const izq = elem("span");
      izq.appendChild(elem("span", null,
        item.archivo + " · " + Math.max(1, Math.round(item.peso / 1024)) + " kB · "));
      // El destino, en voz alta. El editor solo enseña la ropa del
      // personaje que uno lleva puesto, asi que equivocarse acá es
      // archivar el dibujo donde nadie lo va a buscar.
      izq.appendChild(elem("strong", "arte-destino",
        "irá a " + conMayuscula(item.modelo) + " · " + conMayuscula(item.capa)));
      cabecera.appendChild(izq);
      const quitar = elem("button", "arte-quitar", "Quitar");
      quitar.type = "button";
      // Por identidad y no por el indice del pintado: hoy funciona solo
      // porque se repinta la lista entera despues de cada cambio, y
      // cualquier repintado parcial borraria la fila equivocada.
      quitar.addEventListener("click", () => quitarArchivo(item.clave));
      cabecera.appendChild(quitar);
      datos.appendChild(cabecera);

      datos.appendChild(campoSelect("Personaje", modelosDisponibles(), item.modelo, conMayuscula, v => {
        item.modelo = v;
        pintarLista();   // cambia el personaje del fondo de la vista previa
      }));

      datos.appendChild(campoSelect("Ranura", DATOS.capas, item.capa, conMayuscula, v => {
        item.capa = v;
      }));

      datos.appendChild(campoTexto("Nombre visible", item.nombre, 60, v => {
        item.nombre = v;
      }));

      datos.appendChild(campoNumero("Precio (0 = gratis)", item.precio, v => {
        item.precio = v;
      }));

      fila.appendChild(datos);
      lista.appendChild(fila);
    });

    decir(ARCHIVOS.length + " prenda(s) preparada(s)" +
      (ARCHIVOS.length > TOPE_POR_TANDA ? " · se enviarán en tandas de " + TOPE_POR_TANDA : ""));
  }

  function envoltorio(etiqueta, control) {
    const caja = elem("div", "arte-campo");
    const lab = elem("label", null, etiqueta);
    const id = "c" + Math.random().toString(36).slice(2, 9);
    lab.setAttribute("for", id);
    control.id = id;
    caja.appendChild(lab);
    caja.appendChild(control);
    return caja;
  }

  function campoSelect(etiqueta, valores, actual, formato, alCambiar) {
    const select = document.createElement("select");
    llenarSelect(select, valores, formato);
    select.value = actual;
    select.addEventListener("change", () => alCambiar(select.value));
    return envoltorio(etiqueta, select);
  }

  function campoTexto(etiqueta, actual, maximo, alCambiar) {
    const input = document.createElement("input");
    input.type = "text";
    input.value = actual;
    input.maxLength = maximo;
    input.addEventListener("input", () => alCambiar(input.value));
    return envoltorio(etiqueta, input);
  }

  function campoNumero(etiqueta, actual, alCambiar) {
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.step = "10";
    input.value = String(actual);
    input.addEventListener("input", () => {
      alCambiar(Math.max(0, Math.trunc(Number(input.value) || 0)));
    });
    return envoltorio(etiqueta, input);
  }

  // ==============================
  // SUBIR
  // ==============================

  // El presupuesto de una tanda, en BYTES DE LA CADENA que viaja. No en
  // bytes del PNG: server.js corta el cuerpo a los 12 MB de lo RECIBIDO, y
  // lo que se recibe es el base64, que abulta un tercio más. Medir un
  // presupuesto de "9 MB" con los bytes del PNG manda 12 MB de cuerpo real.
  const TOPE_CUERPO = 10 * 1024 * 1024;

  // Hornea una prenda para subirla. Si el vestidor no está cargado, o si el
  // artista no movió nada, salen los bytes originales tal cual.
  async function prepararParaSubir(item) {
    if (!V()) return { item, texto: item.dataUrl };
    const r = await V().pngDeSubida(item);
    if (r && r.error) return { item, error: r.error };
    return { item, texto: r.texto, horneado: !!r.horneado };
  }

  // Sube las prendas que se le pasen, no siempre todas: el vestidor deja
  // publicar unas y seguir probando las otras. Antes esto era subir() y
  // mandaba ARCHIVOS entero.
  async function publicar(items) {
    if (!Array.isArray(items) || !items.length) return;

    const boton = $("arteSubirBtn");
    if (boton) boton.disabled = true;

    const resultados = [];
    const cola = items.slice();
    let pendiente = null;      // lo ya horneado que no cupo en la tanda anterior
    let tandaNumero = 0;
    let cortado = null;

    while (cola.length || pendiente) {
      const tanda = [];
      let bytes = 0;

      // Se hornea SOLO lo que entra en la tanda en curso. Hornearlo todo
      // antes de trocear mantendría hasta 200 PNG horneados vivos en la
      // memoria del navegador a la vez, sin ninguna necesidad. (Ocurre en
      // el navegador del artista: no consume un byte del servidor.)
      while (tanda.length < TOPE_POR_TANDA) {
        let listo = pendiente;
        pendiente = null;

        if (!listo) {
          const siguiente = cola.shift();
          if (!siguiente) break;
          decir("Preparando " + siguiente.archivo + "…");
          listo = await prepararParaSubir(siguiente);
        }

        // Si el horno no pudo, se PARA. No se sube el original sin
        // ajustar: el artista colocó la prenda, vio sus números y pulsó
        // Publicar, así que darle un tick verde sobre otro dibujo le
        // gastaría el identificador en algo que no aprobó.
        if (listo.error) { cortado = listo; break; }

        // No cabe y la tanda ya lleva algo: se guarda para la siguiente
        // SIN volver a hornearlo. Si no cabe y la tanda está vacía, viaja
        // sola, que es lo que evita el bucle infinito.
        if (tanda.length && bytes + listo.texto.length > TOPE_CUERPO) {
          pendiente = listo;
          break;
        }

        tanda.push(listo);
        bytes += listo.texto.length;
      }

      if (cortado) break;
      if (!tanda.length) break;

      tandaNumero++;
      decir("Subiendo tanda " + tandaNumero + "…");

      const cuerpo = {
        prendas: tanda.map(t => ({
          archivo: t.item.archivo,
          modelo: t.item.modelo,
          capa: t.item.capa,
          nombre: t.item.nombre,
          precio: t.item.precio,
          png: t.texto
        }))
      };

      try {
        const r = await fetch("/api/content?action=avatar-subir-prendas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cuerpo)
        });
        const datos = await r.json().catch(() => null);

        // El emparejado va POR POSICIÓN, con la longitud comprobada.
        //
        // Antes se emparejaba por r.archivo, que el servidor trunca a 120
        // caracteres y que se repite en cuanto hay dos exportaciones con
        // el mismo nombre -y el vestidor invita a tenerlas-. La
        // comprobación de longitud es imprescindible: el 400 de "máximo 20
        // por tanda" no trae array de resultados, y emparejar por posición
        // ahí correría los resultados una prenda.
        const buenos = r.ok && datos && datos.success &&
          Array.isArray(datos.resultados) && datos.resultados.length === tanda.length;

        if (!buenos) {
          const mensaje = (datos && datos.error) ||
            (r.status === 413 ? "La tanda pesa demasiado, probá con menos archivos a la vez" : "No se pudo subir");
          tanda.forEach(t => resultados.push({
            clave: t.item.clave, r: { archivo: t.item.archivo, ok: false, error: mensaje }
          }));
        } else {
          datos.resultados.forEach((x, k) => resultados.push({ clave: tanda[k].item.clave, r: x }));
        }
      } catch (error) {
        tanda.forEach(t => resultados.push({
          clave: t.item.clave, r: { archivo: t.item.archivo, ok: false, error: "Se cortó la conexión" }
        }));
      }
    }

    if (cortado) {
      resultados.push({
        clave: cortado.item.clave,
        r: { archivo: cortado.item.archivo, ok: false, error: cortado.error }
      });
      // Lo que quedaba en la cola no se mandó: se dice, en vez de dejar al
      // artista pensando que entró.
      cola.forEach(a => resultados.push({
        clave: a.clave,
        r: { archivo: a.archivo, ok: false, error: "No se envió: se paró en " + cortado.item.archivo }
      }));
    }

    pintarResultados(resultados.map(e => e.r));

    // Lo que entró se quita; lo que falló se queda CON SU AJUSTE intacto
    // para poder arreglarlo y reintentar; y lo que no se eligió ni se toca.
    const enviadas = new Set(items.map(a => a.clave));
    const fallaron = new Set(resultados.filter(e => !e.r.ok).map(e => e.clave));
    ARCHIVOS = ARCHIVOS.filter(a => !enviadas.has(a.clave) || fallaron.has(a.clave));

    if (boton) boton.disabled = false;
    pintarLista();

    // El catálogo cambió: se recarga para verlo con lo nuevo dentro.
    try {
      const r = await fetch("/api/content?action=avatar-panel");
      const datos = await r.json();
      if (datos && datos.success) {
        DATOS = datos;
        pintarCatalogo();
      }
    } catch (_) { /* el panel sigue usable con lo que ya tenía */ }
  }

  function pintarResultados(resultados) {
    // Basta con que exista la caja: taller.html tambien la trae, porque
    // publicar sin decir que entro y que fallo no es publicar.
    if (!$("arteResultados")) return;

    const caja = $("arteResultados");
    vaciar(caja);

    const bien = resultados.filter(r => r.ok).length;
    const mal = resultados.length - bien;

    decir("Entraron " + bien + ", fallaron " + mal + ".");

    resultados.forEach(r => {
      const fila = elem("div", "arte-resultado" + (r.ok ? "" : " malo"));
      fila.appendChild(elem("span", null, r.ok ? "✓" : "✕"));
      fila.appendChild(elem("span", "que", r.archivo));
      fila.appendChild(elem("span", "dice", r.ok ? destinoDe(r.valor) + " · " + r.medidas : r.error));
      caja.appendChild(fila);
    });

    // Recordar donde quedaron. Sin esto, alguien publica una prenda, la
    // busca en el editor con otro personaje puesto y no la encuentra.
    const personajes = [...new Set(resultados.filter(r => r.ok).map(r => modeloDe(r.valor)))];
    if (personajes.length) {
      const nota = elem("p", "arte-ayuda");
      nota.style.marginTop = "12px";
      nota.textContent = "Para verlas en el editor de avatares hay que tener puesto el personaje " +
        "correspondiente (" + personajes.map(conMayuscula).join(", ") + "): " +
        "el editor solo muestra la ropa del personaje elegido.";
      caja.appendChild(nota);
    }
  }

  // "cereza_piel4" -> "cereza"
  function modeloDe(valor) {
    const i = String(valor).indexOf("_");
    return i === -1 ? String(valor) : String(valor).slice(0, i);
  }

  // "cereza_piel4" -> "Cereza · Piel"
  function destinoDe(valor) {
    const modelo = modeloDe(valor);
    const resto = String(valor).slice(modelo.length + 1).replace(/\d+$/, "");
    return conMayuscula(modelo) + " · " + conMayuscula(resto);
  }

  // ==============================
  // CATÁLOGO
  // ==============================

  function pintarCatalogo() {
    if (!HAY_PANEL()) return;

    const grid = $("arteGrid");
    vaciar(grid);

    const fModelo = $("arteFiltroModelo").value;
    const fCapa = $("arteFiltroCapa").value;
    const fEstado = $("arteFiltroEstado").value;
    const fAutor = $("arteFiltroAutor").value;

    const visibles = DATOS.prendas.filter(p => {
      if (fModelo !== "todos" && p.modelo !== fModelo) return false;
      if (fCapa !== "todas" && p.capa !== fCapa) return false;
      if (fEstado === "publicadas" && !p.publicada) return false;
      if (fEstado === "retiradas" && p.publicada) return false;
      if (fAutor === "mias" && p.autor !== DATOS.yo) return false;
      return true;
    });

    const apagadas = DATOS.prendas.filter(p => !p.publicada).length;
    $("arteCuenta").textContent =
      DATOS.prendas.length + " prendas · " + apagadas + " apagadas · mostrando " + visibles.length;

    if (!visibles.length) {
      grid.appendChild(elem("p", "arte-vacio", "No hay nada con esos filtros."));
      return;
    }

    // Un tope de pintado: con 600 tarjetas de golpe el navegador sufre, y
    // el equipo trabaja filtrando por personaje y ranura de todos modos.
    visibles.slice(0, 120).forEach(p => grid.appendChild(tarjeta(p)));

    if (visibles.length > 120) {
      grid.appendChild(elem("p", "arte-vacio",
        "y " + (visibles.length - 120) + " más. Afiná los filtros para verlas."));
    }
  }

  function tarjeta(p) {
    const caja = elem("div", "arte-tarjeta" + (p.publicada ? "" : " retirada"));

    caja.appendChild(vistaPrevia(p));
    caja.appendChild(elem("div", "nom", p.nombre));

    const meta = elem("div", "meta");
    meta.appendChild(elem("div", null, conMayuscula(p.modelo) + " · " + conMayuscula(p.capa)));
    meta.appendChild(elem("div", null, p.medidas + " · " + Math.max(1, Math.round(p.peso / 1024)) + " kB"));
    meta.appendChild(elem("div", null, p.autor ? "Por " + p.autor : "Del catálogo original"));
    caja.appendChild(meta);

    const etiquetas = elem("div");
    if (p.precio) etiquetas.appendChild(elem("span", "arte-etiqueta precio", "🪙 " + p.precio));
    if (!p.publicada) etiquetas.appendChild(elem("span", "arte-etiqueta apagada", "Retirada"));
    caja.appendChild(etiquetas);

    // Solo el autor y los administradores pueden cambiar el estado. El
    // botón se esconde en vez de dar un error al pulsarlo; el servidor lo
    // comprueba igual, esto es solo para no ofrecer lo que no se puede.
    const puedo = DATOS.esAdmin || (p.autor && p.autor === DATOS.yo);
    if (puedo) {
      const boton = elem("button", null, p.publicada ? "Retirar" : "Publicar");
      boton.type = "button";
      boton.addEventListener("click", () => cambiarEstado(p, boton));
      caja.appendChild(boton);
    }

    return caja;
  }

  async function cambiarEstado(prenda, boton) {
    const publicar = !prenda.publicada;

    if (!publicar) {
      const seguro = confirm(
        '¿Retirar "' + prenda.nombre + '"?\n\n' +
        "Deja de ofrecerse en el editor, pero quien ya la tenga puesta la conserva."
      );
      if (!seguro) return;
    }

    boton.disabled = true;
    try {
      const r = await fetch("/api/content?action=avatar-estado-prenda", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: prenda.id, publicada: publicar })
      });
      const datos = await r.json().catch(() => null);

      if (!r.ok || !datos || !datos.success) {
        alert((datos && datos.error) || "No se pudo cambiar el estado.");
        boton.disabled = false;
        return;
      }

      prenda.publicada = publicar;
      pintarCatalogo();
    } catch (_) {
      alert("Se cortó la conexión. Probá de nuevo.");
      boton.disabled = false;
    }
  }

  // ==============================

  cargarPanel();
})();

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
    $("arteSubir").hidden = false;
    $("arteCatalogo").hidden = false;

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
    $("arteSubirBtn").addEventListener("click", subir);
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

  async function alElegirArchivos(evento) {
    const elegidos = Array.from(evento.target.files || []);
    if (!elegidos.length) return;

    $("arteEstado").textContent = "Leyendo " + elegidos.length + " archivo(s)…";

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
        modelo: modeloDesdeArchivo(file.name, modelosDisponibles()) || $("arteTodosModelo").value,
        capa: capaDesdeArchivo(file.name, DATOS.capas),
        nombre: nombreDesdeArchivo(file.name),
        precio: 0
      });
    }

    // Se limpia para poder volver a elegir el mismo archivo si hace falta.
    evento.target.value = "";
    $("arteEstado").textContent = "";
    pintarLista();
  }

  function aplicarATodas() {
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

  function pintarLista() {
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
      quitar.addEventListener("click", () => {
        ARCHIVOS.splice(indice, 1);
        pintarLista();
      });
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

    $("arteEstado").textContent = ARCHIVOS.length + " prenda(s) preparada(s)" +
      (ARCHIVOS.length > TOPE_POR_TANDA ? " · se enviarán en tandas de " + TOPE_POR_TANDA : "");
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

  async function subir() {
    if (!ARCHIVOS.length) return;

    const boton = $("arteSubirBtn");
    boton.disabled = true;

    const resultados = [];
    // Se manda en tandas porque el servidor acepta 20 por petición: una
    // tanda de cien PNG en un solo cuerpo son decenas de megas, y esta
    // máquina tiene 950 MB.
    const tandas = [];
    for (let i = 0; i < ARCHIVOS.length; i += TOPE_POR_TANDA) {
      tandas.push(ARCHIVOS.slice(i, i + TOPE_POR_TANDA));
    }

    for (let t = 0; t < tandas.length; t++) {
      $("arteEstado").textContent = "Subiendo tanda " + (t + 1) + " de " + tandas.length + "…";

      const cuerpo = {
        prendas: tandas[t].map(a => ({
          archivo: a.archivo,
          modelo: a.modelo,
          capa: a.capa,
          nombre: a.nombre,
          precio: a.precio,
          png: a.dataUrl
        }))
      };

      try {
        const r = await fetch("/api/content?action=avatar-subir-prendas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cuerpo)
        });
        const datos = await r.json().catch(() => null);

        if (!r.ok || !datos || !datos.success) {
          const mensaje = (datos && datos.error) ||
            (r.status === 413 ? "La tanda pesa demasiado, probá con menos archivos a la vez" : "No se pudo subir");
          tandas[t].forEach(a => resultados.push({ archivo: a.archivo, ok: false, error: mensaje }));
        } else {
          datos.resultados.forEach(x => resultados.push(x));
        }
      } catch (error) {
        tandas[t].forEach(a => resultados.push({ archivo: a.archivo, ok: false, error: "Se cortó la conexión" }));
      }
    }

    pintarResultados(resultados);

    // Lo que entró se quita de la lista; lo que falló se queda para poder
    // arreglarlo y reintentar sin volver a elegir los archivos.
    const fallaron = new Set(resultados.filter(r => !r.ok).map(r => r.archivo));
    ARCHIVOS = ARCHIVOS.filter(a => fallaron.has(a.archivo));

    boton.disabled = false;
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
    const caja = $("arteResultados");
    vaciar(caja);

    const bien = resultados.filter(r => r.ok).length;
    const mal = resultados.length - bien;

    $("arteEstado").textContent = "Entraron " + bien + ", fallaron " + mal + ".";

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

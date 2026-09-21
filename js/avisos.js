// ==============================
// AVISOS EN VIVO — js/avisos.js
// ==============================
// La mitad del navegador de api/_avisos.js. Sustituye a pusher-js, que
// se bajaba de js.pusher.com en las 22 páginas del sitio.
//
// Aquí no se descarga nada: EventSource viene en el navegador desde
// hace años. Se abre una petición a /api/avisos que el servidor no
// cierra, y cada vez que hay algo que contar llega un evento.
//
// UNA SOLA CONEXIÓN PARA TODA LA PÁGINA. Con Pusher no era así: cada
// fichero hacía su `new Pusher(...)`, que es un WebSocket propio.
// usuario.html llegaba a abrir CUATRO —realtime.js uno, y usuario.js
// otros dos, más el de perfil-realtime.js donde aplicaba— para hablar
// con el mismo servidor. Acá se juntan los canales que pida cada uno y
// se abre una.
//
// Uso:
//     const cancelar = MRAvisos.escuchar(canal, "nuevo-logro", datos => ...);
//     MRAvisos.alReconectar(() => ...);   // volvió la línea: repescar

(function () {

  const RUTA = "/api/avisos";

  // De dónde sale el pase que identifica la línea. Ver "EL PASE" abajo.
  const RUTA_PASE = "/api/content?action=avisos-pase";

  // Cuánto se espera antes de reintentar a mano, y hasta cuánto sube.
  const ESPERA_MINIMA = 5000;
  const ESPERA_MAXIMA = 120000;

  // canal -> evento -> Set de funciones
  const escuchas = new Map();

  let fuente = null;
  let abiertaAlgunaVez = false;
  let reconexiones = [];
  let esperaActual = ESPERA_MINIMA;
  let reintento = null;
  let pendienteDeAbrir = null;

  // Cuántas aperturas se han pedido. Pedir el pase tarda un viaje al
  // servidor, y en ese rato la lista de canales puede cambiar y pedirse
  // otra apertura. Cada apertura anota su número, y si al volver el pase
  // ya no es la última, se descarta: si no, abriría una línea con los
  // canales viejos encima de la buena.
  let aperturas = 0;

  // Los eventos que emite el servidor. Se declaran por su nombre porque
  // EventSource solo entrega los que tienen escucha puesta, y un
  // "message" generico no los recoge: llevan campo event.
  const EVENTOS = [
    "nueva-notificacion",
    "nuevo-comentario",
    "comentarios-vaciados",
    "nueva-actividad",
    "nuevo-historial",
    "nuevo-logro",
    "estado-bloqueo",
    "latido"
  ];

  function hayEventSource() {
    return typeof window !== "undefined" && typeof window.EventSource === "function";
  }

  function canalesActivos() {
    const lista = [];
    for (const [canal, eventos] of escuchas) {
      let vivos = 0;
      for (const grupo of eventos.values()) vivos += grupo.size;
      if (vivos > 0) lista.push(canal);
    }
    return lista.sort();
  }

  function repartir(canal, evento, datos) {
    const eventos = escuchas.get(canal);
    if (!eventos) return;
    const grupo = eventos.get(evento);
    if (!grupo) return;

    // Sobre una copia, por lo mismo que en el servidor: quien se apunte
    // durante el reparto no debe cobrar el aviso que lo hizo nacer.
    for (const fn of [...grupo]) {
      try {
        fn(datos);
      } catch (error) {
        console.warn("MacroReborn: una escucha de " + evento + " falló.", error);
      }
    }
  }

  function cerrar() {
    if (reintento) { clearTimeout(reintento); reintento = null; }
    if (!fuente) return;
    try { fuente.close(); } catch (_) {}
    fuente = null;
  }

  // ==============================
  // EL PASE
  // ==============================
  // EventSource no puede mandar cabeceras, así que la línea no puede
  // llevar la sesión como la lleva el resto de la API. En su lugar, si
  // hay sesión, se pide primero un pase de un minuto por una petición
  // normal, con su cabecera, y se abre la línea con el pase en la URL.
  // Con él, el servidor deja pasar también los avisos privados —el buzón
  // y los bloqueos— del canal propio. Sin él, la línea es anónima y solo
  // oye lo público, que es lo que le toca a quien no ha entrado.
  //
  // Si el pase no se consigue (sesión caducada, red caída), se abre la
  // línea igual, sin pase: mejor los comentarios al vuelo que nada.
  //
  // El pase caduca al minuto. Si la línea se cae más tarde, la
  // reconexión automática del navegador vuelve con el pase viejo, el
  // servidor contesta 401 y EventSource se rinde (CLOSED). Eso lo recoge
  // el reintento a mano de más abajo, que vuelve a pasar por aquí y pide
  // uno nuevo. Es la misma ruta que ya existía para el 503.
  function tokenDeSesion() {
    try {
      const sesion = window.MRSession;
      if (sesion && typeof sesion.getToken === "function") {
        const propio = sesion.getToken();
        if (propio) return propio;
      }
      return window.localStorage.getItem("macroSessionToken");
    } catch (_) {
      return null;
    }
  }

  function pedirPase(token) {
    if (typeof window.fetch !== "function") return Promise.resolve(null);

    return window.fetch(RUTA_PASE, { headers: { "Authorization": "Bearer " + token } })
      .then(function (respuesta) { return respuesta.ok ? respuesta.json() : null; })
      .then(function (datos) { return datos && datos.success && datos.pase ? String(datos.pase) : null; })
      .catch(function () { return null; });
  }

  function abrir() {
    if (!hayEventSource()) return;

    const canales = canalesActivos();

    // Sin canales no hay nada que escuchar: no se abre conexión. Es el
    // caso de quien navega sin haber entrado, que es la mayoría de las
    // visitas. Con Pusher se conectaban igual.
    if (canales.length === 0) { cerrar(); return; }

    // Se numera también la apertura sin sesión: un pase pedido justo
    // antes de cerrar sesión que llegara ahora abriría una línea vieja
    // encima de esta.
    const numero = ++aperturas;

    // Sin sesión no hay nada que pedir y la línea se abre en el acto,
    // como siempre. Solo con sesión hay que esperar el pase.
    const token = tokenDeSesion();
    if (!token) { conectar(canales, null); return; }

    pedirPase(token).then(function (pase) {
      if (numero !== aperturas) return;
      conectar(canales, pase);
    });
  }

  function conectar(canales, pase) {
    cerrar();

    let url = RUTA + "?canales=" + encodeURIComponent(canales.join(","));
    if (pase) url += "&pase=" + encodeURIComponent(pase);
    fuente = new EventSource(url);

    fuente.onopen = function () {
      esperaActual = ESPERA_MINIMA;

      // Mientras la línea estuvo caída se perdieron los avisos que
      // hubiera: esto NO es un bus con historia, un aviso que no se
      // entregó no se guarda. Por eso al reconectar hay que avisar a
      // quien quiera volver a pedir lo que se haya perdido.
      if (abiertaAlgunaVez) {
        for (const fn of [...reconexiones]) {
          try { fn(); } catch (error) { console.warn("MacroReborn: fallo al repescar.", error); }
        }
      }
      abiertaAlgunaVez = true;
    };

    fuente.onerror = function () {
      // Dos casos distintos con el mismo evento:
      //
      //   CONNECTING - la conexión se cayó y el navegador YA está
      //     reintentando solo, con el retry que mandó el servidor. No hay
      //     nada que hacer.
      //
      //   CLOSED - el navegador se rindió y no va a volver a intentarlo.
      //     Pasa cuando la respuesta no es un 200 con el tipo correcto;
      //     por ejemplo el 503 de "este proceso está lleno", o el 401 de
      //     un pase que caducó mientras la línea estaba caída. Sin este
      //     reintento a mano, esa pestaña se queda muda hasta que alguien
      //     recargue, y nada en pantalla lo diría.
      if (fuente && fuente.readyState === EventSource.CLOSED) programarReintento();
    };

    for (const evento of EVENTOS) {
      fuente.addEventListener(evento, function (mensaje) {
        // El sobre es { canal, datos }. El canal viene dentro porque SSE no
        // tiene un sitio para el y esta conexion escucha varios: sin el no
        // se sabe si el comentario es del perfil que miras o del tuyo.
        let sobre = null;
        try { sobre = JSON.parse(mensaje.data); } catch (_) { return; }
        if (!sobre || !sobre.canal) return;
        repartir(sobre.canal, evento, sobre.datos);
      });
    }
  }

  function programarReintento() {
    if (reintento) return;
    const conRuido = esperaActual + Math.floor(Math.random() * 2000);
    reintento = setTimeout(function () {
      reintento = null;
      esperaActual = Math.min(esperaActual * 2, ESPERA_MAXIMA);
      abrir();
    }, conRuido);
  }

  // Varias llamadas a escuchar() seguidas -lo normal: cada fichero se
  // apunta al cargar- producirían una conexión cada una. Se junta todo en
  // el siguiente turno y se abre una sola vez.
  function pedirApertura() {
    if (pendienteDeAbrir) return;
    pendienteDeAbrir = setTimeout(function () {
      pendienteDeAbrir = null;
      abrir();
    }, 0);
  }

  // ---------- LO QUE SE USA DESDE FUERA ----------

  // Sólo se abre o se reabre cuando cambia la LISTA DE CANALES, que es lo
  // único que el servidor necesita saber. Apuntar una segunda escucha a un
  // canal que ya se escuchaba no cambia nada, y reabrir por nada corta la
  // línea y pierde lo que viajara en ese instante.
  function siCambianLosCanales(hacer) {
    const antes = canalesActivos().join(",");
    hacer();
    if (canalesActivos().join(",") !== antes) pedirApertura();
  }

  function escuchar(canal, evento, fn) {
    if (!canal || !evento || typeof fn !== "function") return function () {};

    siCambianLosCanales(function () {
      if (!escuchas.has(canal)) escuchas.set(canal, new Map());
      const eventos = escuchas.get(canal);
      if (!eventos.has(evento)) eventos.set(evento, new Set());
      eventos.get(evento).add(fn);
    });

    let dadaDeBaja = false;
    return function cancelar() {
      if (dadaDeBaja) return;
      dadaDeBaja = true;

      siCambianLosCanales(function () {
        const eventos = escuchas.get(canal);
        if (!eventos) return;

        const grupo = eventos.get(evento);
        if (grupo) {
          grupo.delete(fn);
          if (grupo.size === 0) eventos.delete(evento);
        }
        if (eventos.size === 0) escuchas.delete(canal);
      });
    };
  }

  function alReconectar(fn) {
    if (typeof fn !== "function") return function () {};
    reconexiones.push(fn);
    return function () {
      reconexiones = reconexiones.filter(x => x !== fn);
    };
  }

  function estado() {
    return {
      disponible: hayEventSource(),
      conectada: !!fuente && fuente.readyState === 1,
      // Si hay un reintento a mano en cola. Se expone para poder
      // comprobarlo sin esperar los cinco segundos que tarda en saltar.
      reintentando: !!reintento,
      canales: canalesActivos()
    };
  }

  window.MRAvisos = { escuchar, alReconectar, estado, cerrar, EVENTOS };

  // La pestaña que se va suelta la línea. El navegador lo haría igual al
  // navegar, pero dejarlo explícito es lo que libera el hueco en el
  // servidor sin esperar a que salte el latido.
  window.addEventListener("beforeunload", cerrar);

})();

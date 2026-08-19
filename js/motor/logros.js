// ==============================
// SISTEMA DE LOGROS - MacroReborn
// ==============================


// LISTA DE LOGROS

const LOGROS = {

  // ---------- AVATAR ----------

  primerAvatar:{
    id:"primerAvatar",
    icono:"🎨",
    nombre:"Primer Avatar",
    descripcion:"Creá tu primer avatar.",
    puntos:10
  },

  // ---------- JUEGOS ----------

  primerJuego:{
    id:"primerJuego",
    icono:"🎮",
    nombre:"Primer Juego",
    descripcion:"Jugá un juego.",
    puntos:10
  },

  explorador:{
    id:"explorador",
    icono:"🕹️",
    nombre:"Explorador",
    descripcion:"Jugá 5 juegos diferentes.",
    puntos:25
  },

  coleccionista:{
    id:"coleccionista",
    icono:"🌍",
    nombre:"Coleccionista",
    descripcion:"Jugá 30 juegos diferentes.",
    puntos:100
  },

  // ---------- COMUNIDAD ----------

  primeraPalabra:{
    id:"primeraPalabra",
    icono:"💬",
    nombre:"Primera Palabra",
    descripcion:"Escribí un comentario.",
    puntos:10
  },

  primerAmigo:{
    id:"primerAmigo",
    icono:"🤝",
    nombre:"Primer Amigo",
    descripcion:"Agregá un amigo.",
    puntos:10
  },

  popular:{
    id:"popular",
    icono:"👥",
    nombre:"Popular",
    descripcion:"Tené 50 amigos.",
    puntos:60
  },

  leyendaSocial:{
    id:"leyendaSocial",
    icono:"🌟",
    nombre:"Leyenda Social",
    descripcion:"Tené 100 amigos.",
    puntos:120
  },

  // ---------- NIVELES ----------

  nivel2:{
    id:"nivel2",
    icono:"⭐",
    nombre:"Nivel 2",
    descripcion:"Alcanzá el nivel 2.",
    puntos:10
  },

  nivel5:{
    id:"nivel5",
    icono:"⭐⭐",
    nombre:"Nivel 5",
    descripcion:"Alcanzá el nivel 5.",
    puntos:20
  },

  nivel10:{
    id:"nivel10",
    icono:"⭐⭐⭐",
    nombre:"Nivel 10",
    descripcion:"Alcanzá el nivel 10.",
    puntos:35
  },

  nivel25:{
    id:"nivel25",
    icono:"💎",
    nombre:"Nivel 25",
    descripcion:"Alcanzá el nivel 25.",
    puntos:60
  },

  nivel50:{
    id:"nivel50",
    icono:"🔥",
    nombre:"Nivel 50",
    descripcion:"Alcanzá el nivel 50.",
    puntos:100
  },

  nivel100:{
    id:"nivel100",
    icono:"👑",
    nombre:"Nivel 100",
    descripcion:"Alcanzá el nivel 100.",
    puntos:180
  },

  nivel200:{
    id:"nivel200",
    icono:"🌌",
    nombre:"Nivel 200",
    descripcion:"Alcanzá el nivel 200.",
    puntos:300
  },

  nivel300:{
    id:"nivel300",
    icono:"🚀",
    nombre:"Nivel 300",
    descripcion:"Alcanzá el nivel 300.",
    puntos:420
  },

  nivel400:{
    id:"nivel400",
    icono:"⚡",
    nombre:"Nivel 400",
    descripcion:"Alcanzá el nivel 400.",
    puntos:540
  },

  nivel500:{
    id:"nivel500",
    icono:"🏆",
    nombre:"Nivel 500",
    descripcion:"Alcanzá el nivel 500.",
    puntos:700
  },

  nivel1000:{
    id:"nivel1000",
    icono:"💠",
    nombre:"Nivel 1000",
    descripcion:"Alcanzá el nivel 1000.",
    puntos:1500
  },

  // ---------- RANKING ----------

  top100:{
    id:"top100",
    icono:"📈",
    nombre:"Top 100",
    descripcion:"Entrá al Top 100 del ranking.",
    puntos:80
  },

  top50:{
    id:"top50",
    icono:"🥈",
    nombre:"Top 50",
    descripcion:"Entrá al Top 50 del ranking.",
    puntos:150
  },

  top10:{
    id:"top10",
    icono:"🥇",
    nombre:"Top 10",
    descripcion:"Entrá al Top 10 del ranking.",
    puntos:280
  },

  top3:{
    id:"top3",
    icono:"🏅",
    nombre:"Top 3",
    descripcion:"Llegá al Top 3 del ranking.",
    puntos:450
  },

  subcampeon:{
    id:"subcampeon",
    icono:"👑",
    nombre:"Subcampeón",
    descripcion:"Alcanzá el puesto #2 del ranking.",
    puntos:700
  },

  numeroUno:{
    id:"numeroUno",
    icono:"🌟",
    nombre:"Número Uno",
    descripcion:"Alcanzá el puesto #1 del ranking.",
    puntos:1000
  }

};




// ==============================
// CACHÉ EN MEMORIA
// ==============================
// Igual que insignias.js: media web llama a obtenerLogros()/tieneLogro()/
// calcularPuntosLogros() de forma sincrónica dentro de bucles de render
// (comunidad, ranking, comentarios...), así que se mantiene una caché
// en memoria que las páginas precargan con cargarLogros()/
// cargarLogrosDeVarios() antes de renderizar.

const _cacheLogros = {};

function _guardarEnCacheLogros(nombre, lista){
  _cacheLogros[nombre] = Array.isArray(lista) ? lista : [];
}




// ==============================
// OBTENER LOGROS (sincrónico, desde caché)
// ==============================

function obtenerLogros(nombre){
  return _cacheLogros[nombre] || [];
}




// ==============================
// CARGAR LOGROS DESDE EL SERVIDOR
// ==============================

function _adaptarLogroDelServidor(fila){
  return {
    id: fila.achievement_id,
    fecha: new Date(fila.unlocked_at).toLocaleDateString("es-AR")
  };
}

async function cargarLogros(nombre){

  if(!nombre) return [];

  try{

    const respuesta = await fetch("/api/social?action=achievements&username=" + encodeURIComponent(nombre));
    const datos = await respuesta.json();

    const lista = (datos && datos.success)
      ? datos.logros.map(_adaptarLogroDelServidor)
      : [];

    _guardarEnCacheLogros(nombre, lista);
    return lista;

  }catch(error){

    console.warn("MacroReborn: no se pudieron cargar los logros.", error);
    return _cacheLogros[nombre] || [];

  }

}

// Trae los logros de varios usuarios en un solo pedido (para listas:
// comunidad, ranking, amigos). Se usa antes de renderizar esas listas.

async function cargarLogrosDeVarios(nombres){

  const unicos = [...new Set((nombres || []).filter(Boolean))];
  if(!unicos.length) return;

  try{

    const respuesta = await fetch("/api/social?action=achievements&usernames=" + encodeURIComponent(unicos.join(",")));
    const datos = await respuesta.json();

    if(datos && datos.success && datos.porUsuario){
      Object.keys(datos.porUsuario).forEach(nombre=>{
        _guardarEnCacheLogros(nombre, datos.porUsuario[nombre].map(_adaptarLogroDelServidor));
      });
    }

  }catch(error){

    console.warn("MacroReborn: no se pudieron cargar los logros.", error);

  }

}




// ==============================
// TIENE LOGRO (sincrónico, desde caché)
// ==============================

function tieneLogro(nombre,id){

  return obtenerLogros(nombre).some(logro => logro.id === id);

}




// ==============================
// DESBLOQUEAR LOGRO
// ==============================
// Actualiza la caché local al toque (para que cualquier render()
// llamado en la línea siguiente ya vea el logro nuevo) y en paralelo
// avisa al servidor. Es seguro llamarla repetidas veces: tanto acá
// como en el servidor está protegida contra duplicados.

async function desbloquearLogro(nombre,id){

  if(!LOGROS[id]){
    console.warn("Logro inexistente:",id);
    return;
  }

  if(tieneLogro(nombre,id)) return;

  const listaPrevia = obtenerLogros(nombre);

  // Actualización optimista: se agrega a la caché ya mismo para que
  // cualquier render() de la línea siguiente lo vea desbloqueado.
  _guardarEnCacheLogros(nombre, [
    ...listaPrevia,
    { id, fecha: new Date().toLocaleDateString("es-AR") }
  ]);

  let datos;

  try{

    const respuesta = await fetch("/api/social?action=achievements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: nombre, achievementId: id })
    });

    datos = await respuesta.json();

  }catch(error){

    // Sin confirmación del servidor: si dejáramos el logro en la
    // caché, la persona lo vería "desbloqueado" en esta sesión pero,
    // como nunca se guardó en Neon, desaparecería en el próximo
    // reload (que vuelve a leer todo desde /api/achievements). Se
    // revierte la actualización optimista para que el estado que se
    // ve en pantalla sea siempre el que realmente está guardado.
    console.warn("MacroReborn: no se pudo desbloquear el logro (sin conexión).", error);
    _guardarEnCacheLogros(nombre, listaPrevia);
    return;

  }

  if(!datos || !datos.success){
    console.warn("MacroReborn: el servidor no pudo guardar el logro.", datos && datos.error);
    _guardarEnCacheLogros(nombre, listaPrevia);
    return;
  }

  if(!datos.nuevo) return;

  // Notifica a la UI solo después de que Neon confirmó el desbloqueo.
  // MRApp.events coordina la pestaña actual y conserva el CustomEvent tradicional;
  // las demás pestañas reciben el mismo dato mediante storage.
  try{
    const eventoLogro = {
      username: nombre,
      achievementId: id,
      achievementName: LOGROS[id].nombre,
      at: Date.now()
    };
    if(window.MRApp && MRApp.events && typeof MRApp.events.emit === "function"){
      MRApp.events.emit("macro:achievement-unlocked", eventoLogro);
    }else{
      window.dispatchEvent(new CustomEvent("macro:achievement-unlocked", { detail: eventoLogro }));
    }
    localStorage.setItem("macro:last-achievement-unlocked", JSON.stringify(eventoLogro));
  }catch(_){}

  // ==============================
  // ACTIVIDAD RECIENTE - LOGRO
  // ==============================

  if(typeof registrarActividad === "function"){
    registrarActividad(nombre, "logro", LOGROS[id].nombre);
  }

}




// ==============================
// CALCULAR PUNTOS DE LOGROS (sincrónico, desde caché)
// ==============================

function calcularPuntosLogros(nombre){

  const lista = obtenerLogros(nombre);
  let puntos = 0;

  lista.forEach(logro=>{
    if(LOGROS[logro.id]){
      puntos += LOGROS[logro.id].puntos || 0;
    }
  });

  return puntos;

}

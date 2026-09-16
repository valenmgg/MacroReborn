// ==============================
// PERFIL - MacroReborn
// ==============================


// ---------- PESTAÑAS ----------

const botones = document.querySelectorAll(".tab");
const contenidos = document.querySelectorAll(".contenido-tab");

botones.forEach(boton=>{
  boton.addEventListener("click",()=>{
    botones.forEach(b=>b.classList.remove("activa"));
    contenidos.forEach(c=>c.classList.remove("activo"));
    boton.classList.add("activa");
    document.getElementById(boton.dataset.tab).classList.add("activo");
  });
});

// Permite llegar directo a una pestaña puntual desde afuera de esta
// página (por ejemplo, desde el menú de usuario de la navbar:
// "perfil.html#amigos"), simulando el click sobre el botón de esa
// pestaña. Si el hash no coincide con ninguna pestaña, no hace nada
// y queda la pestaña "Home" que ya viene activa por defecto.
function activarPestañaDesdeHash(){
  const idPestaña = location.hash.replace("#", "");
  if(!idPestaña) return;
  const boton = document.querySelector('.tab[data-tab="' + idPestaña + '"]');
  if(boton) boton.click();
}

activarPestañaDesdeHash();
window.addEventListener("hashchange", activarPestañaDesdeHash);


// ---------- PERFIL ----------

// USUARIO LOGUEADO

let datosUsuario = (window.MRSession && typeof MRSession.get === "function")
  ? MRSession.get()
  : leerJSON(localStorage.getItem("usuarioActivo") || "null");


if(!datosUsuario){

  window.location.href = "login.html";
  throw new Error("Sin sesión");

}


// Adaptar datos de Neon al formato antiguo del perfil

datosUsuario.nombre = datosUsuario.username;
datosUsuario.nivel = datosUsuario.level;
datosUsuario.fechaRegistro = datosUsuario.created_at;
datosUsuario.logros = datosUsuario.logros || 0;
datosUsuario.biografia = datosUsuario.bio || "Todavía no escribió una biografía.";

// FIX: acá se pisaba datosUsuario.ultimaConexion con un campo que
// nunca existía ("ultimaConexion"), así que siempre terminaba en
// "Nunca". El dato real de Neon viaja como "last_login" (llega en
// datosUsuario porque /api/auth?action=login y /api/auth?action=register
// lo incluyen en la respuesta y js/login.js lo guarda tal cual en
// usuarioActivo). Se guarda aparte para no perderlo.
datosUsuario.ultimaConexion = datosUsuario.last_login || null;

// GUARDIA DE SESIÓN
// Sin esto, cualquiera podía entrar a perfil.html sin haber iniciado
// sesión: perfil.js rellenaba un usuario "falso" (nombre:"Usuario")
// solo para poder pintar la página, pero como el resto del archivo
// sigue usando esa misma variable "datosUsuario" para guardar (bio,
// avatar, comentarios...), terminaba escribiendo esos datos falsos
// en "usuarioActivo" de localStorage la primera vez que se guardaba
// algo — lo que además dejaba al navbar creyendo que había una sesión
// iniciada. Si no hay sesión real, mandamos directo a login.html y
// no seguimos ejecutando el resto del script.


// PERFIL

// RANKING: preferimos la posición ya calculada por el servidor (rank_actual)
// que viaja con el usuario de la sesión. Solo hacemos la consulta completa
// del ranking como fallback cuando ese dato no está disponible. Esto evita
// descargar /api/users?limit=500 en la carga normal del perfil.
const rankActualSesion = Number(datosUsuario.rank_actual);
const posicionRankingPromesa = Number.isFinite(rankActualSesion) && rankActualSesion > 0
  ? Promise.resolve(rankActualSesion)
  : (typeof obtenerPosicionRanking === "function"
      ? obtenerPosicionRanking(datosUsuario.nombre)
      : Promise.resolve(null));

const usuario={

  nombre: datosUsuario.nombre,

  estado:"🟢 En línea",

  nivel: Number(datosUsuario.nivel) || 1,

  biografia: datosUsuario.biografia || "Todavía no escribió una biografía.",

  xp: Number(datosUsuario.xp) || 0,

  ranking: "Calculando…",

  logros: datosUsuario.logros || 0,

  fechaRegistro: datosUsuario.fechaRegistro || "Desconocida",

  ultimaConexion: datosUsuario.ultimaConexion || "Nunca",

};

// Contexto explícito del PERFIL PROPIO.
// Este objeto deja clara la frontera entre perfil.html (yo) y
// usuario.html (perfil público ajeno): ningún módulo del perfil debe
// sustituir al usuario objetivo por otro valor obtenido de la URL.
window.MRProfileContext = {
  type: "own",
  getUser(){
    return { ...datosUsuario, nombre: usuario.nombre, nivel: usuario.nivel, xp: usuario.xp, biografia: usuario.biografia, ultimaConexion: usuario.ultimaConexion };
  }
};

document.getElementById("nombreUsuario").textContent=usuario.nombre;

// Carga las insignias del usuario propio antes de mostrar las opciones
// exclusivas del administrador. La comprobación real también existe en
// /api/users?action=update-admin-avatar-png, así que ocultar este bloque
// en el cliente nunca se usa como mecanismo de seguridad.
const insigniasPerfilPropioListas = typeof cargarInsignias === "function"
  ? cargarInsignias(usuario.nombre)
  : Promise.resolve([]);

// ---------- INSIGNIAS OFICIALES ----------
// Se muestran debajo del nombre. Son manuales (no se otorgan por
// logros): si el usuario no tiene ninguna, el contenedor queda oculto.
if(typeof renderInsigniasEnContenedor === "function"){
  renderInsigniasEnContenedor("insigniasPerfil", usuario.nombre);
}

const bienvenidaPerfil = document.getElementById("bienvenidaPerfil");
if(bienvenidaPerfil){
  bienvenidaPerfil.textContent = "Bienvenido al perfil de " + usuario.nombre + ".";
}

document.querySelector(".estado").textContent=usuario.nombre+" · "+usuario.estado;
document.querySelector(".nivel").textContent="⭐ Nivel "+usuario.nivel;
document.getElementById("biografia").textContent=usuario.biografia;
document.getElementById("xp").textContent="⚡ "+usuario.xp+" XP";

// ---------- BARRA DE XP ----------

const barraXP = document.getElementById("progresoXP");
const textoXP = document.getElementById("textoXP");

if(barraXP && textoXP){

  let necesario;

  if(usuario.nivel === 1){
    necesario = 50;
  }
  else if(usuario.nivel === 2){
    necesario = 100;
  }
  else{
    necesario = 100 + ((usuario.nivel - 2) * 200);
  }

  let porcentaje = (usuario.xp / necesario) * 100;

  barraXP.style.width = porcentaje + "%";
  textoXP.textContent = usuario.xp + " / " + necesario + " XP";

}

document.getElementById("ranking").textContent=usuario.ranking;

posicionRankingPromesa.then(posicionRanking=>{
  document.getElementById("ranking").textContent = posicionRanking ? "#" + posicionRanking : "Sin clasificar";
});

// ---------- PUNTOS DE LOGROS ----------

function actualizarPuntosLogrosUI(){
  const puntosLogrosEl = document.getElementById("puntosLogros");
  if(puntosLogrosEl){
    puntosLogrosEl.textContent = "🏅 " + calcularPuntosLogros(datosUsuario.nombre) + " puntos de logros";
  }
}

// Los logros ahora salen de /api/achievements: se precargan una sola
// vez acá y de ahí en más calcularPuntosLogros()/obtenerLogros() los
// leen sincrónicamente desde la caché en memoria (js/motor/logros.js).
const logrosListos = typeof cargarLogros === "function"
  ? cargarLogros(datosUsuario.nombre)
  : Promise.resolve();

logrosListos.then(actualizarPuntosLogrosUI);

// FIX: "Registrado" mostraba el timestamp ISO crudo de Neon
// (ej. "2026-08-05T02:48:25.503Z") en vez de una fecha legible.
document.getElementById("fechaRegistro").textContent =
  typeof fechaLegible === "function"
    ? fechaLegible(usuario.fechaRegistro, "Desconocida")
    : usuario.fechaRegistro;

// FIX: usaba un campo ("ultimaConexionTS") que nunca se llenaba en
// ningún lado del sitio, así que siempre caía al valor por defecto
// "Nunca" sin importar si la persona acababa de iniciar sesión. Ahora
// usa el last_login real (ver más arriba, donde se guarda en
// datosUsuario.ultimaConexion).
//
// Queda en una función aparte (en vez de código suelto) para poder
// volver a pintarla sola cuando llega un latido en vivo por Pusher
// (por ejemplo, si iniciaste sesión en otro dispositivo), o cada
// cierto tiempo, sin recargar la página.
function pintarUltimaConexion(){
  document.getElementById("ultimaConexion").textContent =
    typeof tiempoRelativo === "function"
      ? tiempoRelativo(datosUsuario.ultimaConexion, "Nunca")
      : usuario.ultimaConexion;
}

pintarUltimaConexion();

// ==============================
// SINCRONIZACIÓN CON MRSESSION / MRAPP
// ==============================
// El perfil propio ahora reacciona a cambios confirmados por el servidor
// (XP, monedas, nivel, bio, avatar, actividad) sin obligar a recargar la página.
// El fallback a localStorage se conserva para compatibilidad con páginas antiguas.
function actualizarPerfilDesdeSesion(detalle){
  const actualizado = detalle && detalle.usuario ? detalle.usuario
    : (window.MRSession && typeof MRSession.get === "function" ? MRSession.get() : null);
  if(!actualizado || !actualizado.username && !actualizado.nombre) return;

  const nombre = actualizado.nombre || actualizado.username;
  const nivel = Number(actualizado.level ?? actualizado.nivel ?? datosUsuario.nivel) || 1;
  const xp = Number(actualizado.xp ?? datosUsuario.xp) || 0;
  const bio = actualizado.bio ?? actualizado.biografia ?? datosUsuario.biografia;
  const ultima = actualizado.last_login ?? actualizado.ultimaConexion ?? datosUsuario.ultimaConexion;

  datosUsuario = { ...datosUsuario, ...actualizado, username: nombre, level: nivel, xp };
  datosUsuario.nombre = nombre;
  datosUsuario.nivel = nivel;
  datosUsuario.biografia = bio || "Todavía no escribió una biografía.";
  datosUsuario.last_login = ultima || datosUsuario.last_login;
  datosUsuario.ultimaConexion = ultima || null;

  usuario.nombre = nombre;
  usuario.nivel = nivel;
  usuario.xp = xp;
  usuario.biografia = datosUsuario.biografia;
  usuario.ultimaConexion = datosUsuario.ultimaConexion || "Nunca";

  const nombreEl = document.getElementById("nombreUsuario");
  if(nombreEl) nombreEl.textContent = nombre;
  const estadoEl = document.querySelector(".estado");
  if(estadoEl) estadoEl.textContent = nombre + " · " + usuario.estado;
  const nivelEl = document.querySelector(".nivel");
  if(nivelEl) nivelEl.textContent = "⭐ Nivel " + nivel;
  const bioEl = document.getElementById("biografia");
  if(bioEl) bioEl.textContent = usuario.biografia;
  const xpEl = document.getElementById("xp");
  if(xpEl) xpEl.textContent = "⚡ " + xp + " XP";

  if(barraXP && textoXP){
    const necesario = nivel === 1 ? 50 : (nivel === 2 ? 100 : 100 + ((nivel - 2) * 200));
    const porcentaje = Math.max(0, Math.min(100, (xp / necesario) * 100));
    barraXP.style.width = porcentaje + "%";
    textoXP.textContent = xp + " / " + necesario + " XP";
  }

  pintarUltimaConexion();
  if(typeof actualizarPuntosLogrosUI === "function") actualizarPuntosLogrosUI();
  if(typeof renderLogros === "function") renderLogros();
  if(typeof actualizarAvatarPrincipal === "function" && actualizado.avatar !== undefined){
    actualizarAvatarPrincipal();
  }
}

function suscribirPerfilSesion(){
  if(window.MRSession && typeof MRSession.subscribe === "function") {
    MRSession.subscribe(actualizarPerfilDesdeSesion);
  }
  if(window.MRApp && MRApp.events && typeof MRApp.events.on === "function") {
    MRApp.events.on("macro:session-change", actualizarPerfilDesdeSesion);
  }
}

suscribirPerfilSesion();


// ==============================
// SISTEMA AVATAR
// ==============================

// ==============================
// EL CATÁLOGO DE PRENDAS
// ==============================
// Acá vivía CAPAS_IMG: 622 pares valor -> ruta escritos a mano. Hacía
// dos trabajos a la vez —traducir rutas y hacer de catálogo de lo que
// existe— y obligaba a escribir cada prenda nueva en tres sitios: el
// fichero en disco, el div de perfil.html y este mapa. Nada obligaba a
// que los tres coincidieran, y no coincidían: cinco prendas estaban en
// el disco sin aparecer nunca en el editor, y ocho bocas de tora no
// funcionaron jamás porque su nombre llevaba mayúscula y espacio.
//
// Ahora el catálogo lo manda el servidor
// (/api/content?action=avatar-catalogo) y de ahí sale todo: qué prendas
// hay, cómo se llaman, de qué ranura son, cuánto cuestan y dónde está
// su dibujo. Publicar una prenda deja de necesitar un despliegue.

let CATALOGO = null;
const RUTAS_PRENDA = new Map();   // valor -> URL del dibujo (elegibles)

// Las retiradas van aparte, y no en RUTAS_PRENDA, porque ese mapa es
// además la lista de lo que el editor ofrece (ver valoresDelCatalogo).
// Una prenda retirada hay que poder DIBUJARLA, pero no ELEGIRLA.
const RUTAS_RETIRADAS = new Map();

// Bandera para no encadenar esperas: si el avatar se pide varias veces
// mientras el catalogo esta en camino, solo una espera y las demas se
// descartan. Sin esto, cada llamada dejaria su propio reintento.
let _avatarEnEspera = false;

let _promesaCatalogo = null;

// La descarga la hace core.js, que se carga antes que esto en todas las
// páginas y ya la arranca al abrirse. Si acá se pidiera otra vez, la
// misma página bajaría el catálogo dos veces en paralelo y habría dos
// copias de la misma verdad en memoria.
//
// De esa llamada sale el mapa de URLs para dibujar. Lo que el editor
// necesita además —nombres, ranuras, precios— está en el mismo cuerpo de
// la respuesta, así que se guarda en CATALOGO desde acá.
function cargarCatalogo(){
  if(_promesaCatalogo) return _promesaCatalogo;

  _promesaCatalogo = cargarCatalogoAvatares()
    .then(datos => {
      if(!datos || !datos.success) throw new Error("el catálogo vino sin éxito");
      CATALOGO = datos;
      RUTAS_PRENDA.clear();
      datos.modelos.forEach(m => RUTAS_PRENDA.set(m.valor, m.url));
      datos.prendas.forEach(p => RUTAS_PRENDA.set(p.valor, p.url));

      RUTAS_RETIRADAS.clear();
      (datos.retiradas || []).forEach(r => RUTAS_RETIRADAS.set(r.valor, r.url));

      return datos;
    })
    .catch(error => {
      console.warn("MacroReborn: no se pudo cargar el catálogo de avatares.", error);
      CATALOGO = null;
      return null;
    });

  return _promesaCatalogo;
}

// Traduce un valor ("tora_pelo3") a la URL de su dibujo.
//
// Mientras el catálogo no esté cargado se usa la ruta de siempre en
// imagenes/, que es lo que hacen el resto de páginas del sitio. Así, si
// el catálogo tarda o falla, los avatares se siguen dibujando en vez de
// quedarse en blanco: degradar a lo de antes es mejor que no mostrar
// nada.
//
// Con el catálogo cargado manda él, y eso es una mejora sobre CAPAS_IMG:
// un valor que ya no existe —como "tora_piel7", que tres cuentas tienen
// guardado y cuyo fichero se borró hace tiempo— deja de pedirse, así que
// deja de dar un 404 en la consola.
//
// Pero hay que separar dos cosas que antes estaban mezcladas, porque se
// parecen y no son lo mismo:
//
//   - RETIRADA: existe en la base, alguien la lleva puesta, y se sacó
//     del editor. HAY QUE DIBUJARLA. Retirar una prenda la saca del
//     editor, no del avatar de quien ya la tenía.
//
//   - COLGANDO: no existe en ningún sitio. Se dibujaría como un hueco y
//     un 404 en la consola. Esa no se pide.
//
// Estaban mezcladas porque el catálogo solo traía las publicadas, así
// que las dos caían en el mismo "no está en el mapa" y las dos se
// descartaban. El resultado se vio en producción: una persona con dos
// prendas retiradas puestas veía su propio avatar sin fondo y sin piel.
function rutaDePrenda(valor){
  if(!valor || valor === "ninguno") return null;

  const conocida = RUTAS_PRENDA.get(valor) || RUTAS_RETIRADAS.get(valor);
  if(conocida) return conocida;

  // Todavía sin catálogo: la ruta de siempre, igual que el resto de las
  // páginas. Degradar a lo de antes es mejor que no mostrar nada.
  if(!RUTAS_PRENDA.size){
    return typeof rutaCapaAvatar === "function" ? rutaCapaAvatar(valor) : null;
  }

  // Con catálogo y sin rastro del valor: está colgando.
  return null;
}

// Los valores que el catálogo reconoce. Sustituye a Object.keys(CAPAS_IMG).
function valoresDelCatalogo(){
  return [...RUTAS_PRENDA.keys()];
}

// ==============================
// CONSTRUIR LAS OPCIONES DEL EDITOR
// ==============================
// perfil.html trae los 15 botones de categoría y los 15 contenedores,
// que son fijos y tienen sus etiquetas y sus emojis. Lo que ya no trae
// son los 622 divs de prenda: se generan acá desde el catálogo.
//
// Se arma con createElement y createTextNode, no con innerHTML. El
// nombre de una prenda sale de la base, y en cuanto el equipo de arte
// pueda subir prendas ese texto lo habrá escrito una persona: pegarlo
// como HTML sería meter un agujero de scripting en el editor.
function construirOpcionesDelEditor(){
  if(!CATALOGO) return false;

  const porCapa = new Map();
  CATALOGO.modelos.forEach(m => {
    if(!porCapa.has("modelo")) porCapa.set("modelo", []);
    porCapa.get("modelo").push(m);
  });
  CATALOGO.prendas.forEach(p => {
    if(!porCapa.has(p.capa)) porCapa.set(p.capa, []);
    porCapa.get(p.capa).push(p);
  });

  document.querySelectorAll(".grupo-opcion").forEach(grupo => {
    const capa = grupo.dataset.grupo;
    const fila = grupo.querySelector(".fila-opciones");
    if(!fila) return;

    fila.textContent = "";

    (porCapa.get(capa) || []).forEach(item => {
      const div = document.createElement("div");
      div.className = "opcion-item";
      div.dataset.capa = capa;
      div.dataset.valor = item.valor;
      // El modelo solo se marca en las prendas: es lo que usa
      // filtrarOpcionesPorModelo() para ocultar la ropa de otro
      // personaje. En la propia capa "modelo" no tiene sentido.
      if(capa !== "modelo") div.dataset.modelo = item.modelo;

      const img = document.createElement("img");

      // loading=lazy se mantiene, aunque ya no sea lo que evita las
      // descargas al cargar la pagina: de eso se encarga data-src.
      // Sirve DENTRO del editor ya abierto, para lo que queda fuera
      // de la fila visible al hacer scroll.
      img.setAttribute("loading", "lazy");
      img.setAttribute("decoding", "async");
      img.setAttribute("alt", "");

      // La URL se guarda, NO se asigna. Ver mostrarImagenesVisibles().
      img.dataset.src = item.url;

      div.appendChild(img);
      div.appendChild(document.createTextNode(item.nombre));
      fila.appendChild(div);


    });
  });

  return true;
}

// ---------- LAS MINIATURAS SE CARGAN CUANDO SE VEN ----------
// El editor tiene 638 miniaturas y vive dentro de un #editorAvatar con
// display:none hasta que alguien pulsa "Crear avatar". Ninguna debería
// descargarse antes de eso.
//
// Durante tres intentos se confió en loading="lazy" para conseguirlo, y
// no funciona. Se midió con HAR de cargas reales del perfil: 25
// miniaturas, luego 3, luego 160, sin tocar ese código en medio. Esa
// variación es la prueba de que no lo estaba decidiendo el lazy sino el
// azar de qué descargas alcanzaban a arrancar. Un navegador no aplaza
// imágenes que no tienen caja de dibujo: sin caja no hay nada contra lo
// que medir la distancia a la pantalla.
//
// Así que no se deja el src puesto. La URL vive en data-src y se pasa a
// src únicamente cuando la miniatura está de verdad dibujándose, que es
// lo que dice offsetParent: null mientras algún antepasado tenga
// display:none. Es una comprobación del DOM, no una heurística del
// navegador, así que no depende de con qué se mire la página.
function mostrarImagenesVisibles(){
  document.querySelectorAll("#editorAvatar img[data-src]").forEach(img=>{
    if(img.offsetParent === null) return;   // todavía oculta
    img.src = img.dataset.src;
    delete img.dataset.src;
  });
}

// Si el catálogo no llega, el editor se quedaría vacío y sin explicación.
// Antes esto no podía pasar porque los divs venían en el HTML.
function avisarCatalogoCaido(){
  document.querySelectorAll(".grupo-opcion .fila-opciones").forEach(fila => {
    if(fila.children.length) return;
    const aviso = document.createElement("p");
    aviso.className = "sin-opciones";
    aviso.textContent = "No se pudieron cargar las prendas. Probá recargar la página.";
    fila.appendChild(aviso);
  });
}

let editorCapas={
  fondo:"ninguno",
  espalda:"ninguno",
  modelo:"tora",
  piel:"ninguno",
  ojos:"ninguno",
  boca:"ninguno",
  botas:"ninguno",
  pantalon:"ninguno",
  remera:"ninguno",
  guantes:"ninguno",
  accesorio:"ninguno",
  cara:"ninguno",
  pelo:"ninguno",
  mascota:"ninguno",
  borde:"ninguno"
};

// La lista de capas viene de js/core.js, que se carga antes que este
// archivo. Acá solo se le da el nombre local de siempre.
const ORDEN_CAPAS=ORDEN_CAPAS_AVATAR;


// ---------- AVATAR (Neon: users.avatar) ----------
// El avatar viaja embebido en datosUsuario (viene de /api/login o ya
// estaba en la sesión guardada), así que leerlo es sincrónico. Guardarlo
// sí pega a la API, además de actualizar la caché local al toque para
// que el resto de la página (preview, avatar principal) lo vea ya.

function cargarAvatar(){
  return normalizarAvatar(datosUsuario.avatar);
}

async function guardarAvatar(avatar){

  const avatarAnterior = datosUsuario.avatar;
  datosUsuario.avatar = avatar;

  try{

    const respuesta = await fetch("/api/users?action=update-avatar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: datosUsuario.nombre, avatar: avatar })
    });

    if(!respuesta.ok){
      datosUsuario.avatar = avatarAnterior;
      console.warn("MacroReborn: el servidor no confirmó el cambio de avatar.");
      return false;
    }

    // Neon confirmó el cambio: recién ahora actualizamos el estado global
    // para que navbar, perfil y otras pestañas vean el nuevo avatar.
    if (window.MRSession && typeof MRSession.update === "function") {
      MRSession.update({ avatar: avatar });
    } else {
      localStorage.setItem("usuarioActivo", JSON.stringify(datosUsuario));
    }

    return true;

  }catch(error){

    datosUsuario.avatar = avatarAnterior;
    console.warn("MacroReborn: no se pudo guardar el avatar en el servidor.", error);
    return false;

  }

}

// ---------- AVATAR PNG EXCLUSIVO DE ADMINISTRADOR ----------

async function guardarAvatarPngAdmin(dataUrl){
  const respuesta = await fetch("/api/users?action=update-admin-avatar-png", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: datosUsuario.nombre,
      avatarPng: dataUrl,
      avatarAnterior: (datosUsuario.avatar && !avatarEsPNG(datosUsuario.avatar)) ? datosUsuario.avatar : null
    })
  });

  let datos = null;
  try { datos = await respuesta.json(); } catch (_) {}

  if(!respuesta.ok || !datos || !datos.success){
    throw new Error((datos && datos.error) || "No se pudo guardar el PNG.");
  }

  datosUsuario.avatar = datos.user.avatar;
  if(window.MRSession && typeof MRSession.update === "function") {
    MRSession.update({ avatar: datos.user.avatar });
  } else {
    localStorage.setItem("usuarioActivo", JSON.stringify(datosUsuario));
  }

  actualizarAvatarPrincipal();
  return datos.user;
}

function prepararPanelAvatarAdminPng(){
  const box = document.getElementById("adminAvatarPngBox");
  const input = document.getElementById("adminAvatarPngInput");
  const btnGuardar = document.getElementById("guardarAdminAvatarPng");
  const btnQuitar = document.getElementById("quitarAdminAvatarPng");
  const preview = document.getElementById("adminAvatarPngPreview");
  const estado = document.getElementById("adminAvatarPngEstado");

  if(!box || !input || !btnGuardar || !btnQuitar || !preview || !estado) return;

  const mostrarPreviewActual = ()=>{
    const avatar = cargarAvatar();
    const src = typeof avatarPNGData === "function" ? avatarPNGData(avatar) : null;
    if(src){
      preview.innerHTML = `<img src="${src}" alt="Avatar PNG actual">`;
      estado.textContent = "Este PNG es tu avatar actual.";
    }else{
      preview.innerHTML = "";
      estado.textContent = "Todavía no tenés un avatar PNG personalizado.";
    }
  };

  input.addEventListener("change", async ()=>{
    const archivo = input.files && input.files[0];
    if(!archivo) return;

    estado.textContent = "Validando PNG…";
    preview.innerHTML = "";

    if(archivo.type !== "image/png" && !archivo.name.toLowerCase().endsWith(".png")){
      input.value = "";
      estado.textContent = "Solo se permiten archivos .png";
      return;
    }

    if(archivo.size > 1024 * 1024){
      input.value = "";
      estado.textContent = "El PNG no puede superar 1 MB.";
      return;
    }

    try{
      const bytes = new Uint8Array(await archivo.arrayBuffer());
      const firma = [137,80,78,71,13,10,26,10];
      if(firma.some((v, i)=>bytes[i] !== v)){
        throw new Error("El archivo no tiene una firma PNG válida.");
      }

      const lector = new FileReader();
      lector.onload = ()=>{
        preview.innerHTML = `<img src="${lector.result}" alt="Vista previa del PNG">`;
        estado.textContent = "PNG listo. Pulsá “Usar este PNG” para convertirlo en tu avatar.";
      };
      lector.onerror = ()=>{ estado.textContent = "No se pudo leer el archivo."; };
      lector.readAsDataURL(archivo);
    }catch(error){
      input.value = "";
      estado.textContent = error.message || "PNG inválido.";
    }
  });

  btnGuardar.addEventListener("click", async ()=>{
    const archivo = input.files && input.files[0];
    if(!archivo){
      estado.textContent = "Seleccioná primero un archivo PNG.";
      return;
    }

    try{
      const lector = new FileReader();
      lector.onload = async ()=>{
        try{
          estado.textContent = "Guardando avatar PNG…";
          btnGuardar.disabled = true;
          await guardarAvatarPngAdmin(lector.result);
          estado.textContent = "Avatar PNG guardado correctamente.";
          mostrarPreviewActual();
          const actual = cargarAvatar();
          if(actual && typeof avatarPNGData === "function" && avatarPNGData(actual)){
            estado.textContent = "Avatar PNG guardado correctamente. Este es tu avatar activo.";
          }
        }catch(error){
          estado.textContent = error.message || "No se pudo guardar el avatar PNG.";
        }finally{
          btnGuardar.disabled = false;
        }
      };
      lector.onerror = ()=>{ estado.textContent = "No se pudo leer el PNG."; };
      lector.readAsDataURL(archivo);
    }catch(error){
      estado.textContent = error.message || "No se pudo preparar el PNG.";
    }
  });

  btnQuitar.addEventListener("click", async ()=>{
    const avatar = cargarAvatar();
    if(!avatar || !avatarEsPNG(avatar)){
      estado.textContent = "Ya estás usando el avatar normal.";
      return;
    }

    const normal = (avatar && avatar.restaurar && !avatarEsPNG(avatar.restaurar))
      ? { ...avatar.restaurar }
      : { ...editorCapas };
    if(!normal.modelo || normal.modelo === "ninguno") normal.modelo = "tora";
    ORDEN_CAPAS.forEach(tipo=>{ if(!Object.prototype.hasOwnProperty.call(normal, tipo)) normal[tipo] = "ninguno"; });

    btnQuitar.disabled = true;
    estado.textContent = "Volviendo al avatar normal…";
    try{
      const ok = await guardarAvatar(normal);
      if(!ok) throw new Error("No se pudo guardar el avatar normal.");
      actualizarAvatarPrincipal();
      input.value = "";
      mostrarPreviewActual();
      estado.textContent = "Volviste al avatar normal del editor.";
    }catch(error){
      estado.textContent = error.message || "No se pudo volver al avatar normal.";
    }finally{
      btnQuitar.disabled = false;
    }
  });

  mostrarPreviewActual();
}

insigniasPerfilPropioListas.then(lista=>{
  if(Array.isArray(lista) && lista.includes("administrador")){
    const box = document.getElementById("adminAvatarPngBox");
    if(box){
      box.style.display = "block";
      prepararPanelAvatarAdminPng();
    }
  }

  // El panel de arte se ofrece a quien puede usarlo. El enlace no protege
  // nada: arte.html comprueba el rol contra el servidor al abrirse. Esto
  // es para que quien lo tiene lo encuentre sin que se lo expliquen.
  if(Array.isArray(lista) && (lista.includes("artista") || lista.includes("administrador"))){
    const enlace = document.getElementById("enlaceArtePanel");
    if(enlace) enlace.style.display = "";
  }
});


// ---------- CENTRO DE AVATARES (tienda) ----------
// Integración con la tienda de comunidad-ranking.html: las prendas que
// están en el catálogo (avatar_shop_items) y el usuario TODAVÍA no
// compró quedan bloqueadas acá (🔒), en vez de estar libres como el
// resto del guardarropa. Si no hay conexión o la tienda está vacía,
// simplemente no se bloquea nada (se comporta como antes).

let _tiendaPremiumPrecio = new Map(); // valorCapa -> precio
let _tiendaComprados = new Set();     // valorCapa ya comprado por este usuario

async function cargarEstadoTiendaAvatares(){
  try{

    const resp = await fetch("/api/content?action=avatar-shop&username=" + encodeURIComponent(datosUsuario.nombre));
    const datos = await resp.json();
    if(!datos || !datos.success) return;

    const comprados = new Set(datos.comprados || []);
    _tiendaPremiumPrecio = new Map();
    _tiendaComprados = new Set();

    (datos.items || []).forEach(item=>{
      _tiendaPremiumPrecio.set(item.valorCapa, item.precio);
      if(comprados.has(item.id)) _tiendaComprados.add(item.valorCapa);
    });

    aplicarBloqueosTienda();

  }catch(error){
    console.warn("MacroReborn: no se pudo cargar el estado del Centro de avatares.", error);
  }
}

function aplicarBloqueosTienda(){
  document.querySelectorAll(".opcion-item[data-capa]").forEach(opcion=>{

    if(opcion.dataset.capa === "modelo") return; // el modelo nunca se vende

    const valor = opcion.dataset.valor;
    const esPremium = _tiendaPremiumPrecio.has(valor);
    const laTiene = _tiendaComprados.has(valor);

    if(esPremium && !laTiene){
      opcion.classList.add("cr-bloqueada");
      if(!opcion.querySelector(".cr-precio-prenda")){
        const precio = document.createElement("span");
        precio.className = "cr-precio-prenda";
        precio.textContent = "🪙 " + _tiendaPremiumPrecio.get(valor);
        opcion.appendChild(precio);
      }
    } else {
      opcion.classList.remove("cr-bloqueada");
      opcion.querySelector(".cr-precio-prenda")?.remove();
    }

  });
}

cargarEstadoTiendaAvatares();


// ---------- PREVIEW EDITOR ----------

function actualizarPreview(){
  const preview=document.getElementById("previewAvatar");
  if(!preview)return;
  preview.innerHTML="";
  ORDEN_CAPAS.forEach(tipo=>{
    const ruta=rutaDePrenda(editorCapas[tipo]);
    if(ruta){
      let img=document.createElement("img");
      img.src=ruta;
      img.className="capa";
      preview.appendChild(img);
    }
  });
}


// ---------- AVATAR PRINCIPAL ----------

function actualizarAvatarPrincipal(){
  const avatar=cargarAvatar();
  const avatarWrapper=document.querySelector(".avatar");
  if(!avatarWrapper)return;

  if(!avatar){
    avatarWrapper.innerHTML='<img id="avatarPrincipal" src="imagenes/avatar.png" alt="Tu avatar en MacroReborn">';
    return;
  }

  if(avatarEsPNG(avatar)){
    const src = avatarPNGData(avatar);
    avatarWrapper.innerHTML = `<img id="avatarPrincipal" class="avatar-png-personalizado" src="${src}" alt="Avatar PNG personalizado">`;
    return;
  }

  // Si el catálogo todavía no llegó, se espera en vez de dibujar con las
  // rutas de imagenes/ y tener que repetirlo entero cuando llegue.
  //
  // Dibujar antes de tiempo no era gratis: en un HAR de una carga real
  // las cuatro capas del avatar aparecían DOS veces, una por la ruta
  // vieja y otra por la del catálogo. 464 kB descargados de más para
  // pintar exactamente lo mismo.
  //
  // La espera es corta: core.js pide el catálogo nada más cargarse, muy
  // antes de que esta función llegue a ejecutarse. Y si el catálogo
  // falla, cargarCatalogo() resuelve igual y se sigue por la ruta vieja.
  if(typeof cargarCatalogo === "function" && !RUTAS_PRENDA.size){
    // La bandera decide si se PROGRAMA el reintento, no si se espera.
    //
    // Antes estaba dentro de la condición del if, y eso dejaba pasar de
    // largo a la segunda llamada: entraba una, se ponía la bandera, y la
    // siguiente ya no cumplía la condición, así que seguía hasta abajo y
    // dibujaba con las rutas de imagenes/. Que es justo lo que este
    // bloque existe para evitar.
    //
    // Se vio en un HAR: las cuatro capas del avatar otra vez por
    // duplicado, 470 kB, después de un arreglo que se suponía que lo
    // había quitado.
    if(!_avatarEnEspera){
      _avatarEnEspera = true;
      cargarCatalogo().finally(()=>{
        _avatarEnEspera = false;
        actualizarAvatarPrincipal();
      });
    }
    return;
  }

  let contenedor=document.createElement("div");
  contenedor.style.position="relative";
  contenedor.style.width="100%";
  contenedor.style.height="100%";
  contenedor.className="avatar-compuesto";

  const estiloCapa = "position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;";
  let rutasCapas = [];

  ORDEN_CAPAS.forEach(tipo=>{
    const ruta=rutaDePrenda(avatar[tipo]);
    if(ruta){
      let capa=document.createElement("img");
      capa.src=ruta;
      capa.setAttribute("style", estiloCapa);
      contenedor.appendChild(capa);
      rutasCapas.push(ruta);
    }
  });

  contenedor.setAttribute("data-capas", rutasCapas.join("|"));
  contenedor.setAttribute("data-capa-style", estiloCapa);

  avatarWrapper.innerHTML="";
  avatarWrapper.appendChild(contenedor);
}


// ---------- FILTRAR OPCIONES SEGÚN EL MODELO ELEGIDO ----------
// Cada personaje tiene su propio guardarropa. Esta función oculta las
// opciones que no son del modelo actual y muestra un aviso si una
// categoría todavía no tiene nada cargado para ese personaje.

function filtrarOpcionesPorModelo(grupo){
  const modeloActual = editorCapas.modelo;
  let visibles = 0;

  grupo.querySelectorAll(".opcion-item").forEach(item=>{
    const modeloItem = item.dataset.modelo;
    const visible = !modeloItem || modeloItem === modeloActual;
    item.style.display = visible ? "" : "none";
    if(visible) visibles++;
  });

  let aviso = grupo.querySelector(".sin-opciones");
  if(visibles === 0){
    if(!aviso){
      aviso = document.createElement("p");
      aviso.className = "sin-opciones";
      aviso.style.opacity = "0.7";
      aviso.style.padding = "10px 0";
      aviso.textContent = "Todavía no hay opciones cargadas para este personaje.";
      grupo.querySelector(".fila-opciones")?.appendChild(aviso);
    }
  } else if(aviso){
    aviso.remove();
  }

  // Lo que acaba de quedar a la vista ya puede pedir su dibujo.
  mostrarImagenesVisibles();
}

function filtrarTodosLosGrupos(){
  gruposOpcion.forEach(g=>filtrarOpcionesPorModelo(g));
}


// ---------- SINCRONIZAR SELECCIONADAS EN EDITOR ----------
// Marca visualmente las opciones según el estado actual de editorCapas

function sincronizarSeleccionadas(){
  document.querySelectorAll(".opcion-item").forEach(opcion=>{
    const capa = opcion.dataset.capa;
    const valor = opcion.dataset.valor;
    if(editorCapas[capa] === valor){
      opcion.classList.add("seleccionada");
    } else {
      opcion.classList.remove("seleccionada");
    }
  });
}


// ---------- BARRA DE CATEGORÍAS ----------

const catBotones = document.querySelectorAll(".cat-btn");
const gruposOpcion = document.querySelectorAll(".grupo-opcion");

catBotones.forEach(btn=>{
  btn.addEventListener("click",()=>{
    const cat = btn.dataset.cat;

    // Activar botón seleccionado
    catBotones.forEach(b=>b.classList.remove("activa-cat"));
    btn.classList.add("activa-cat");

    // Mostrar solo el grupo correspondiente
    gruposOpcion.forEach(g=>{
      g.style.display = (g.dataset.grupo === cat) ? "" : "none";
    });

    const grupoActivo = [...gruposOpcion].find(g=>g.dataset.grupo===cat);
    if(grupoActivo) filtrarOpcionesPorModelo(grupoActivo);
  });
});


// ---------- ABRIR / CERRAR EDITOR ----------

document.getElementById("botonCrearAvatar")?.addEventListener("click",()=>{
  const guardado=cargarAvatar();
  if(guardado && !avatarEsPNG(guardado)) editorCapas={...guardado};

  document.getElementById("editorAvatar").style.display="block";

  // Mostrar primera categoría (modelo) al abrir
  catBotones.forEach(b=>b.classList.remove("activa-cat"));
  catBotones[0]?.classList.add("activa-cat");
  gruposOpcion.forEach(g=>{
    g.style.display = (g.dataset.grupo === "modelo") ? "" : "none";
  });

  sincronizarSeleccionadas();
  filtrarTodosLosGrupos();
  aplicarBloqueosTienda();
  actualizarPreview();
  mostrarImagenesVisibles();
});

document.getElementById("cancelarEditor")?.addEventListener("click",()=>{
  document.getElementById("editorAvatar").style.display="none";
});


// ---------- GUARDAR AVATAR ----------

document.getElementById("guardarAvatar")?.addEventListener("click", async ()=>{
  await guardarAvatar({...editorCapas});
  document.getElementById("editorAvatar").style.display="none";
  actualizarAvatarPrincipal();

  // ==============================
  // LOGRO CREAR AVATAR
  // ==============================

  if(typeof desbloquearLogro === "function"){
    desbloquearLogro(datosUsuario.nombre, "primerAvatar");
    actualizarPuntosLogrosUI();
    renderLogros();
  }
});


// ---------- AVATAR ALEATORIO ----------
// Elige un modelo al azar (solo entre los que ya tienen guardarropa) y,
// para cada categoría, una opción al azar entre las disponibles para
// ese modelo.

function modelosConGuardarropa(){
  const claves = valoresDelCatalogo();
  const modelosBase = claves.filter(k => !k.includes("_"));
  return modelosBase.filter(m => claves.some(k => k.startsWith(m + "_")));
}

document.getElementById("avatarAleatorio")?.addEventListener("click", ()=>{

  const modelos = modelosConGuardarropa();
  if(modelos.length === 0) return;

  const modeloElegido = modelos[Math.floor(Math.random() * modelos.length)];

  ORDEN_CAPAS.forEach(tipo=>{
    editorCapas[tipo] = "ninguno";
  });
  editorCapas.modelo = modeloElegido;

  ORDEN_CAPAS.forEach(tipo=>{
    if(tipo === "modelo") return;

    const opciones = valoresDelCatalogo()
      .filter(k => k.startsWith(modeloElegido + "_" + tipo));

    if(opciones.length > 0){
      editorCapas[tipo] = opciones[Math.floor(Math.random() * opciones.length)];
    }
  });

  filtrarTodosLosGrupos();
  sincronizarSeleccionadas();
  actualizarPreview();
});


// ---------- OPCIONES EDITOR (con toggle para deseleccionar) ----------

// Se engancha UN listener al contenedor del editor, en vez de uno por
// cada una de las 622 opciones.
//
// No es solo por economía: los divs ya no vienen en el HTML, se
// construyen cuando llega el catálogo. Con el enganche de antes
// —recorrer .opcion-item al cargar el script— no habría ninguno todavía
// y ningún clic haría nada. La delegación hace que deje de importar
// cuándo se crean, y también que no haya que volver a enganchar nada
// cuando el equipo de arte publique una prenda nueva.
document.getElementById("editorAvatar")?.addEventListener("click", (evento)=>{
  const opcion = evento.target.closest(".opcion-item");
  if(!opcion) return;

  {
    const capa = opcion.dataset.capa;
    const valor = opcion.dataset.valor;

    // Prenda de la tienda que todavía no compró: no se deja EQUIPAR.
    // (Si ya la tenía puesta de antes de que existiera la tienda, se
    // la deja desequipar con normalidad más abajo, no se la trabamos).
    if(opcion.classList.contains("cr-bloqueada") && editorCapas[capa] !== valor){
      const precio = _tiendaPremiumPrecio.get(valor) || 0;
      const irATienda = confirm(
        "Esta prenda cuesta 🪙 " + precio + " y todavía no la compraste.\n" +
        "¿Querés ir al Centro de avatares para comprarla?"
      );
      if(irATienda) window.location.href = "comunidad-ranking.html";
      return;
    }

    if(capa === "modelo"){
      // Cambiar de personaje: el modelo siempre queda seleccionado,
      // y como el guardarropa de un personaje no le sirve a otro,
      // reseteamos esas categorías.
      editorCapas.modelo = valor;
      ORDEN_CAPAS.forEach(tipo=>{
        if(tipo !== "modelo") editorCapas[tipo] = "ninguno";
      });

      opcion.parentElement.querySelectorAll(".opcion-item")
        .forEach(x=>x.classList.remove("seleccionada"));
      opcion.classList.add("seleccionada");

      filtrarTodosLosGrupos();
      actualizarPreview();
      return;
    }

    // Toggle: si ya está equipada, desequipar; si no, equipar
    if(editorCapas[capa] === valor){
      editorCapas[capa] = "ninguno";
      opcion.classList.remove("seleccionada");
    } else {
      editorCapas[capa] = valor;
      // Quitar selección previa de la misma categoría
      opcion.parentElement.querySelectorAll(".opcion-item")
        .forEach(x=>x.classList.remove("seleccionada"));
      opcion.classList.add("seleccionada");
    }

    actualizarPreview();
  }
});


// ---------- ARRANQUE DEL EDITOR ----------
// El catálogo llega por red, así que todo lo que necesita que los divs
// existan tiene que esperarlo. Antes esto no hacía falta porque los 622
// divs venían escritos en perfil.html.

cargarCatalogo().then(()=>{
  if(!construirOpcionesDelEditor()){
    avisarCatalogoCaido();
    return;
  }

  // Ahora que las opciones existen, se les aplica el estado que el
  // resto del archivo ya calculó: qué prendas están bloqueadas por la
  // tienda, qué ropa corresponde al modelo elegido y cuál lleva puesta.
  aplicarBloqueosTienda();
  filtrarTodosLosGrupos();
  sincronizarSeleccionadas();
  actualizarPreview();
  actualizarAvatarPrincipal();
});


// ---------- INICIO ----------

actualizarAvatarPrincipal();



// ==============================
// EDITAR DESCRIPCIÓN
// ==============================

const botonEditar = document.querySelector(".datos button");

if(botonEditar)
  botonEditar.textContent = "✏️ Editar descripción";


botonEditar?.addEventListener("click", ()=>{

  const bio = document.getElementById("biografia");
  const descripcionInicio = document.getElementById("descripcionInicio");

  if(document.getElementById("inputBio")) return;


  const actual = bio.textContent.trim();


  const textarea = document.createElement("textarea");

  textarea.id = "inputBio";

  textarea.value =
    actual === "Todavía no escribió una biografía."
      ? ""
      : actual;


  textarea.style.cssText =
    "width:100%;padding:8px;border-radius:8px;border:2px solid #f0b429;background:#0f172a;color:white;font-size:14px;resize:vertical;min-height:70px;margin-top:8px;";


  textarea.placeholder = "Escribí tu descripción...";


  const btnGuardar = document.createElement("button");

  btnGuardar.textContent = "💾 Guardar";

  btnGuardar.style.cssText =
    "margin-top:8px;background:#f0b429;border:none;padding:8px 18px;border-radius:8px;font-weight:bold;cursor:pointer;";


  const btnCancelar = document.createElement("button");

  btnCancelar.textContent = "Cancelar";

  btnCancelar.style.cssText =
    "margin-top:8px;margin-left:8px;background:#555;color:white;border:none;padding:8px 14px;border-radius:8px;";


  bio.style.display = "none";


  bio.parentElement.insertBefore(
    textarea,
    bio.nextSibling
  );

  bio.parentElement.insertBefore(
    btnGuardar,
    textarea.nextSibling
  );

  bio.parentElement.insertBefore(
    btnCancelar,
    btnGuardar.nextSibling
  );


  textarea.focus();



// GUARDAR BIO EN NEON

btnGuardar.addEventListener("click", ()=>{


  const nuevo =
    textarea.value.trim() ||
    "Todavía no escribió una biografía.";


  bio.textContent = nuevo;


  if(descripcionInicio)
    descripcionInicio.textContent = nuevo;



  fetch("/api/users?action=update-bio", {

    method:"POST",

    headers:{
      "Content-Type":"application/json"
    },

    body:JSON.stringify({

      username: datosUsuario.nombre,

      bio: nuevo

    })

  })


  .then(res=>res.json())


  .then(data=>{

    console.log(
      "Bio actualizada:",
      data
    );


    datosUsuario.bio = nuevo;

    if (window.MRSession && typeof MRSession.update === "function") {
      MRSession.update({ bio: nuevo, biografia: nuevo });
    } else {
      localStorage.setItem(
        "usuarioActivo",
        JSON.stringify(datosUsuario)
      );
    }


  })


  .catch(error=>{

    console.error(
      "Error actualizando bio:",
      error
    );

  });



  bio.style.display = "";

  textarea.remove();

  btnGuardar.remove();

  btnCancelar.remove();


});


  // CANCELAR

  btnCancelar.addEventListener("click", ()=>{


    bio.style.display = "";

    textarea.remove();

    btnGuardar.remove();

    btnCancelar.remove();


  });


});



// CARGAR BIO DESDE DATOS DEL USUARIO

if(datosUsuario.bio){

  document.getElementById("biografia").textContent =
    datosUsuario.bio;


  const desc =
    document.getElementById("descripcionInicio");


  if(desc)
    desc.textContent = datosUsuario.bio;

}

// ==============================
// AMIGOS (pestaña del perfil)
// ==============================

const MAX_AMIGOS_FAVORITOS = 10;

async function renderAmigosPerfil(){
  const contenedor = document.getElementById("listaAmigosPerfil");
  if(!contenedor) return;

  let misAmigos = [];
  let misFavoritos = [];

  // Las dos peticiones a la vez, no una detrás de otra. No dependen entre
  // sí: la segunda no usa nada de la primera, y sin embargo esperaba a
  // que terminara. Eso son dos viajes de ida y vuelta al servidor donde
  // cabe uno, y en el arranque del perfil se notan.
  //
  // allSettled y no all: si una de las dos falla, la otra se sigue
  // usando. Antes cada una tenía su propio try/catch y esa tolerancia no
  // se puede perder al juntarlas.
  const nombreCodificado = encodeURIComponent(datosUsuario.nombre);
  const [resAmigos, resFavoritos] = await Promise.allSettled([
    fetch("/api/social?action=friends&username=" + nombreCodificado).then(r => r.json()),
    fetch("/api/social?action=favoriteFriends&username=" + nombreCodificado).then(r => r.json())
  ]);

  if(resAmigos.status === "fulfilled" && resAmigos.value && resAmigos.value.success){
    misAmigos = resAmigos.value.amigos;
  }else{
    console.warn("MacroReborn: no se pudo cargar la lista de amigos.", resAmigos.reason);
  }

  if(resFavoritos.status === "fulfilled" && resFavoritos.value && resFavoritos.value.success){
    misFavoritos = resFavoritos.value.favoritos;
  }else{
    console.warn("MacroReborn: no se pudo cargar los amigos favoritos.", resFavoritos.reason);
  }

  if(misAmigos.length === 0){
    contenedor.innerHTML = `<p>Todavía no agregaste amigos. <a href="comunidad.html" style="color:#f0b429;">Buscá jugadores en la comunidad</a>.</p>`;
    return;
  }

  // Amigos favoritos primero, el resto después (mismo orden alfabético
  // que ya trae /api/social?action=friends dentro de cada grupo).
  const amigosOrdenados = [
    ...misAmigos.filter(a => misFavoritos.includes(a.username)),
    ...misAmigos.filter(a => !misFavoritos.includes(a.username))
  ];

  contenedor.innerHTML = `<div class="grid-usuarios">` + amigosOrdenados.map(amigo => {
    const nombreAmigo = amigo.username;
    const avatar = normalizarAvatar(amigo.avatar);
    const esFavorito = misFavoritos.includes(nombreAmigo);

    let capas = "";
    let rutasCapas = [];

    if(avatar){
      ORDEN_CAPAS.forEach(tipo=>{
        const ruta = rutaDePrenda(avatar[tipo]);
        if(ruta){
          capas += `<img class="capa-tarjeta" data-src="${ruta}" alt="" loading="lazy">`;
          rutasCapas.push(ruta);
        }
      });
    }

    const avatarHTML = capas || `<img src="imagenes/avatar.png" class="avatar-default" alt="" loading="lazy">`;

    return `
      <div class="tarjeta-usuario">

        <button class="btn-favorito-amigo ${esFavorito ? "es-favorito" : ""}" data-nombre="${escaparHTML(nombreAmigo)}" title="${esFavorito ? "Quitar de favoritos" : "Marcar como favorito"}">★</button>

        <div class="avatar-tarjeta avatar-compuesto" data-capas="${rutasCapas.join("|")}" data-capa-class="capa-tarjeta">
          ${avatarHTML}
        </div>

        <h3 class="usuario-nombre">${escaparHTML(nombreAmigo)}</h3>

        <div class="usuario-stats">
          <div class="stat-item">
            <span class="stat-valor">${amigo.level || 1}</span>
            <span class="stat-label">⭐ Nivel</span>
          </div>
        </div>

        <div class="tarjeta-amigo-acciones">
          <a href="usuario.html?usuario=${encodeURIComponent(nombreAmigo)}" class="btn-ver-perfil">👤 Ver perfil</a>
          <button class="btn-quitar-amigo-perfil" data-nombre="${escaparHTML(nombreAmigo)}" title="Eliminar amigo">🗑️</button>
        </div>

      </div>
    `;
  }).join("") + `</div>`;

  contenedor.querySelectorAll(".btn-quitar-amigo-perfil").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const objetivo = btn.dataset.nombre;
      if(!confirm(`¿Eliminar a ${objetivo} de tus amigos?`)) return;

      btn.disabled = true;

      try{
        await fetch("/api/social?action=friends", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "remove", username: datosUsuario.nombre, friendUsername: objetivo })
        });
      }catch(error){
        console.warn("MacroReborn: no se pudo eliminar al amigo.", error);
      }

      renderAmigosPerfil();
    });
  });

  contenedor.querySelectorAll(".btn-favorito-amigo").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const objetivo = btn.dataset.nombre;
      const esFavoritoActual = btn.classList.contains("es-favorito");

      if(!esFavoritoActual && misFavoritos.length >= MAX_AMIGOS_FAVORITOS){
        alert(`Ya tenés el máximo de ${MAX_AMIGOS_FAVORITOS} amigos favoritos. Quitá uno antes de agregar otro.`);
        return;
      }

      btn.disabled = true;

      try{
        const respuesta = await fetch("/api/social?action=favoriteFriends", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: esFavoritoActual ? "remove" : "add",
            username: datosUsuario.nombre,
            friendUsername: objetivo
          })
        });
        const datosResp = await respuesta.json();
        if(!datosResp || !datosResp.success){
          alert((datosResp && datosResp.error) || "No se pudo actualizar el amigo favorito.");
        }
      }catch(error){
        console.warn("MacroReborn: no se pudo actualizar el amigo favorito.", error);
      }

      renderAmigosPerfil();
    });
  });
}

renderAmigosPerfil();


// ==============================
// COMENTARIOS
// ==============================

// Comentarios viven en Neon (tabla profile_comments,
// /api/content?action=comments). Se guarda una copia en memoria
// (_comentariosCache) para que funciones que antes leían localStorage
// de forma sincrónica (como renderUltimosComentariosInicio) puedan
// seguir haciéndolo sin volverse async.

let _comentariosCache = [];

async function cargarComentarios(){
  try{
    const resp = await fetch("/api/content?action=comments&username=" + encodeURIComponent(datosUsuario.nombre));
    const datos = await resp.json();
    _comentariosCache = (datos && datos.success) ? datos.comentarios : [];
  }catch(error){
    console.warn("MacroReborn: no se pudieron cargar los comentarios.", error);
    _comentariosCache = [];
  }
  return _comentariosCache;
}

// AVATAR DEL USUARIO EN COMENTARIOS

// Escapa texto no confiable antes de insertarlo en HTML.
function escaparHTML(texto) {
  const div = document.createElement("div");
  div.textContent = texto == null ? "" : String(texto);
  return div.innerHTML;
}


function obtenerAvatarComentario(nombre){
  // El avatar viaja embebido en el usuario (users.avatar, Neon); se lee
  // de la caché en memoria de js/core.js, precargada por
  // renderComentarios() antes de pintar la lista.
  const avatar = typeof obtenerAvatarCacheado === "function" ? obtenerAvatarCacheado(nombre) : null;

  if(!avatar){
    return `<img class="avatar-comentario" src="imagenes/avatar.png" alt="" loading="lazy">`;
  }

  let capas = "";
  let rutasCapas = [];
  ORDEN_CAPAS.forEach(tipo=>{
    const ruta = rutaDePrenda(avatar[tipo]);
    if(ruta){
      capas += `<img class="capa-comentario" data-src="${ruta}" alt="" loading="lazy">`;
      rutasCapas.push(ruta);
    }
  });

  return `<div class="avatar-mini avatar-compuesto" data-capas="${rutasCapas.join("|")}" ` +
    `data-capa-class="capa-comentario">${capas}</div>`;
}

// ÚLTIMOS COMENTARIOS (pestaña Inicio)
// Reutiliza los mismos datos (cargarComentarios) y el mismo avatar
// (obtenerAvatarComentario) que la pestaña Comentarios, mostrando
// solo los más recientes.

function renderUltimosComentariosInicio(){
  const contenedor = document.getElementById("ultimosComentariosInicio");
  if(!contenedor) return;

  const lista = _comentariosCache;

  if(lista.length === 0){
    contenedor.innerHTML = `<p>Todavía no hay comentarios.</p>`;
    return;
  }

  // La lista ya viene del más nuevo al más viejo (ORDER BY id DESC en
  // /api/content?action=comments), así que los "últimos" son
  // simplemente los primeros 3, sin necesidad de invertir nada.
  const ultimos = lista.slice(0, 3);

  contenedor.innerHTML = ultimos.map((c)=>{
    return `
    <div class="comentario">
      <div class="usuario-comentario">
        ${obtenerAvatarComentario(c.usuario)}
        <b>${escaparHTML(c.usuario)}</b>
      </div>
      ${typeof insigniasBloqueHTML === "function" ? insigniasBloqueHTML(c.usuario, true) : ""}
      <p>${escaparHTML(c.texto)}</p>
      ${typeof botonLikeHTML === "function" ? botonLikeHTML("comment", c.id, datosUsuario.nombre) : ""}
    </div>
  `;
  }).join("");
}

// CONFIRMACIÓN ANTES DE ELIMINAR
// Modal simple y reutilizable: muestra el mensaje, y solo ejecuta
// "onConfirmar" si el usuario elige "Eliminar". Si elige "Cancelar",
// hace clic afuera o presiona Escape, no pasa absolutamente nada.

function pedirConfirmacion(mensaje, onConfirmar, textoBoton){
  document.querySelectorAll(".confirmacion-overlay").forEach(el => el.remove());

  const overlay = document.createElement("div");
  overlay.className = "confirmacion-overlay";
  overlay.innerHTML = `
    <div class="confirmacion-caja">
      <p class="confirmacion-mensaje">${mensaje}</p>
      <div class="confirmacion-botones">
        <button type="button" class="confirmacion-cancelar">Cancelar</button>
        <button type="button" class="confirmacion-confirmar">${textoBoton || "🗑️ Eliminar"}</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  function cerrar(){
    overlay.remove();
    document.removeEventListener("keydown", porEscape);
  }

  function porEscape(e){
    if(e.key === "Escape") cerrar();
  }

  overlay.querySelector(".confirmacion-cancelar").addEventListener("click", cerrar);

  overlay.querySelector(".confirmacion-confirmar").addEventListener("click", ()=>{
    cerrar();
    onConfirmar();
  });

  overlay.addEventListener("click", (e)=>{
    if(e.target === overlay) cerrar();
  });

  document.addEventListener("keydown", porEscape);
}

// MOSTRAR COMENTARIOS

async function renderComentarios(){
  const lista = await cargarComentarios();

  if(typeof cargarAvataresDeVarios === "function"){
    await cargarAvataresDeVarios(lista.map(c => c.usuario));
  }

  const contenedor = document.getElementById("listaComentarios");

  // Mantenemos sincronizado el resumen de Inicio cada vez que se
  // actualiza la lista de comentarios (alta o baja).
  renderUltimosComentariosInicio();

  if(!contenedor) return;

  // Usuario logueado en ESTE navegador: el botón "Eliminar" solo debe
  // aparecer en los comentarios que escribió esta persona, sin
  // importar en qué perfil los haya dejado (el suyo o el de otro).
  const usuarioActivoComentarios = (window.MRSession && typeof MRSession.get === "function")
    ? MRSession.get()
    : leerJSON(localStorage.getItem("usuarioActivo") || "null");
  const miNombreComentarios = usuarioActivoComentarios ? usuarioActivoComentarios.nombre : null;

  if(lista.length === 0){
    contenedor.innerHTML = `
    <div class="comentario">
      <b>Usuario</b>
      <p>Buen perfil 😄</p>
      <button class="boton-responder" data-usuario="Usuario">Responder</button>
      <button class="boton-eliminar" data-id="-1">🗑️ Eliminar</button>
      <button class="boton-reportar" data-id="-1">🚩 Reportar</button>
    </div>`;
  } else {
    // Quién puede borrar cada comentario: el que lo escribió, o el
    // dueño de este perfil (esta página siempre muestra el perfil
    // propio, así que "esDueñoDelPerfil" da siempre true acá, pero se
    // deja explícito para que la regla sea igual que en js/usuario.js).
    const esDueñoDelPerfil = miNombreComentarios && miNombreComentarios === datosUsuario.nombre;

    contenedor.innerHTML = lista.map((c)=>{
      const esMio = miNombreComentarios && c.usuario === miNombreComentarios;
      const puedeEliminar = esMio || esDueñoDelPerfil;
      return `
      <div class="comentario">
        <div class="usuario-comentario">
          ${obtenerAvatarComentario(c.usuario)}
          <b>${escaparHTML(c.usuario)}</b>
        </div>
        ${typeof insigniasBloqueHTML === "function" ? insigniasBloqueHTML(c.usuario, true) : ""}
        <p>${escaparHTML(c.texto)}</p>
        ${typeof botonLikeHTML === "function" ? botonLikeHTML("comment", c.id, datosUsuario.nombre) : ""}
        <button class="boton-responder" data-usuario="${escaparHTML(c.usuario)}">Responder</button>
        ${puedeEliminar ? `<button class="boton-eliminar" data-id="${c.id}">🗑️ Eliminar</button>` : ""}
        <button class="boton-reportar" data-id="${c.id}">🚩 Reportar</button>
      </div>`;
    }).join("");
  }

  // RESPONDER
  contenedor.querySelectorAll(".boton-responder").forEach(btn=>{
    btn.onclick=()=>{
      const input = document.getElementById("comentarioTexto");
      if(input){
        input.value = "@" + btn.dataset.usuario + " ";
        input.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(()=> input.focus(), 300);
      }
    };
  });

  // ELIMINAR
  contenedor.querySelectorAll(".boton-eliminar").forEach(btn=>{
    btn.onclick=()=>{
      const id = btn.dataset.id;

      pedirConfirmacion("¿Seguro que querés eliminar este comentario?", async ()=>{
        if(id === "-1"){
          contenedor.innerHTML="";
          return;
        }
        try{
          await fetch("/api/content?action=comments", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ commentId: id, username: miNombreComentarios })
          });
        }catch(error){
          console.warn("MacroReborn: no se pudo eliminar el comentario.", error);
        }
        renderComentarios();
      });
    };
  });

  // REPORTAR
  contenedor.querySelectorAll(".boton-reportar").forEach(btn=>{
    btn.onclick=()=>{
      const id = btn.dataset.id;

      pedirConfirmacion("¿Seguro que querés reportar este comentario?", ()=>{

        if(typeof reportarComentario === "function"){
          const comentario = id === "-1"
            ? { usuario:"Usuario", texto:"Buen perfil 😄" }
            : _comentariosCache.find(c => String(c.id) === id);
          const motivo = prompt("¿Por qué reportás este comentario? (opcional)") || "";
          reportarComentario("comment", id === "-1" ? null : id, datosUsuario.nombre, comentario, motivo);
        }

        alert("Gracias. El comentario fue reportado correctamente.");

      }, "🚩 Reportar");
    };
  });
}

// ELIMINAR TODOS MIS COMENTARIOS (vaciar el muro del propio perfil)

document.getElementById("botonEliminarTodosComentarios")?.addEventListener("click", ()=>{
  pedirConfirmacion(
    "¿Seguro que querés eliminar TODOS los comentarios de tu perfil? Esta acción no se puede deshacer.",
    async ()=>{
      try{
        await fetch("/api/content?action=comments", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profileUsername: datosUsuario.nombre, username: datosUsuario.nombre })
        });
      }catch(error){
        console.warn("MacroReborn: no se pudieron eliminar los comentarios.", error);
      }
      renderComentarios();
    },
    "🗑️ Eliminar todos"
  );
});

// CREAR COMENTARIO

document.getElementById("botonComentar")?.addEventListener("click", async ()=>{

  if(typeof bloqueadoPorSuspension === "function" && await bloqueadoPorSuspension()) return;

  const input = document.getElementById("comentarioTexto");
  const texto = input.value.trim();
  if(!texto) return;

  const usuarioActivo = (window.MRSession && typeof MRSession.get === "function")
    ? MRSession.get()
    : leerJSON(localStorage.getItem("usuarioActivo") || "null");

  try{
    const respuestaComentario = await fetch("/api/content?action=comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profileUsername: datosUsuario.nombre,
        texto: texto,
        authorUsername: usuarioActivo ? usuarioActivo.nombre : "Usuario"
      })
    });

    const datosComentario = await respuestaComentario.json().catch(() => null);
    if (!respuestaComentario.ok || !datosComentario || !datosComentario.success) {
      console.warn("MacroReborn: el servidor rechazó el comentario.", datosComentario);
      return;
    }
  }catch(error){
    console.warn("MacroReborn: no se pudo publicar el comentario.", error);
    return;
  }

  input.value="";
  await renderComentarios();

  if(typeof notificarMenciones === "function" && usuarioActivo){
    notificarMenciones(texto, usuarioActivo.nombre, "en un comentario en el perfil de " + datosUsuario.nombre + ".");
  }

  // ==============================
  // LOGRO PRIMER COMENTARIO
  // ==============================
  if(usuarioActivo && typeof desbloquearLogro === "function"){
    desbloquearLogro(usuarioActivo.nombre, "primeraPalabra");
    actualizarPuntosLogrosUI();
    renderLogros();
  }

  // ACTIVIDAD RECIENTE - COMENTARIO
  if(usuarioActivo && typeof registrarActividad === "function"){
    const detalleComentario = typeof empaquetarComentario === "function"
      ? empaquetarComentario(datosUsuario.nombre, texto)
      : texto;
    registrarActividad(usuarioActivo.nombre, "comentario", detalleComentario);
    if(typeof renderActividadReciente === "function") renderActividadReciente();
  }
});

// ENTER PARA ENVIAR

document.getElementById("comentarioTexto")?.addEventListener("keydown",e=>{
  if(e.key==="Enter"){
    document.getElementById("botonComentar")?.click();
  }
});

renderComentarios();


// ==============================
// MOSTRAR LOGROS
// ==============================
// (la definición de renderLogros queda igual; solo cambia CUÁNDO se
// llama la primera vez, más abajo, para esperar a logrosListos)

function renderLogros(){

  const contenedor = document.getElementById("listaLogros");

  if(!contenedor) return;

  const lista = obtenerLogros(datosUsuario.nombre);

  contenedor.innerHTML = "";

  Object.values(LOGROS).forEach(logro=>{

    const conseguido = lista.find(l=>l.id===logro.id);

    contenedor.innerHTML += `
      <div class="tarjeta-logro ${conseguido ? "desbloqueado" : "bloqueado"}">
        <div class="icono-logro">${logro.icono}</div>
        <div>
          <h3>${logro.nombre}</h3>
          <p>${logro.descripcion}</p>
          ${
            conseguido
            ? `<span class="estado-logro">✅ Desbloqueado<br>${conseguido.fecha}</span>`
            : `<span class="estado-logro">🔒 Bloqueado</span>`
          }
        </div>
      </div>
    `;

  });

}

logrosListos.then(renderLogros);

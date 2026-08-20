// ==============================
// AMIGOS - MacroReborn
// ==============================
// Fase 1: solicitudes y amistades salen de /api/friends (tablas
// friend_requests / friendships en Neon) en vez de las claves
// localStorage "solicitudesAmigos" / "amigos_<nombre>".


// ---------- HELPERS ----------

function obtenerActivo(){
  if (window.MRSession && typeof window.MRSession.get === "function") {
    return window.MRSession.get();
  }
  return leerJSON(localStorage.getItem("usuarioActivo") || "null");
}


// Datos traídos del servidor para la sesión actual (se llenan en
// cargarDatosAmigos() y los leen los distintos render*()).
let _datosAmigos = { amigos: [], solicitudesEntrantes: [], solicitudesSalientes: [] };

async function cargarDatosAmigos(nombre){

  try{

    const respuesta = await fetch("/api/social?action=friends&username=" + encodeURIComponent(nombre));
    const datos = await respuesta.json();

    if(datos && datos.success){
      _datosAmigos = {
        amigos: datos.amigos || [],
        solicitudesEntrantes: datos.solicitudesEntrantes || [],
        solicitudesSalientes: datos.solicitudesSalientes || []
      };
    }

  }catch(error){

    console.warn("MacroReborn: no se pudo cargar amigos/solicitudes.", error);

  }

}




// ---------- AVATAR ----------


const ORDEN_CAPAS = [

"fondo",
"espalda",
"modelo",
"piel",
"ojos",
"boca",
"botas",
"pantalon",
"remera",
"guantes",
"accesorio",
"cara",
"pelo",
"mascota",
"borde"

];




function rutaImagenCapa(valor){

if(!valor || valor==="ninguno")
return null;


if(!valor.includes("_")){

return "imagenes/"+valor+".png";

}


let partes = valor.split("_");


return "imagenes/"+partes[0]+"/"+partes.slice(1).join("_")+".png";

}




function htmlAvatarMini(avatarCrudo){

const avatar = normalizarAvatar(avatarCrudo);

const div=document.createElement("div");
div.className="amigo-avatar";

if(avatarEsPNG(avatar)){
  let img=document.createElement("img");
  img.src=avatarPNGData(avatar);
  img.loading="lazy";
  div.appendChild(img);
  return div;
}

if(!avatar){
  let img=document.createElement("img");
  img.src="imagenes/avatar.png";
  div.appendChild(img);
  return div;
}

let rutasCapas = [];

ORDEN_CAPAS.forEach(tipo=>{
  const ruta=rutaImagenCapa(avatar[tipo]);
  if(ruta){
    let img=document.createElement("img");
    img.src=ruta;
    img.className="capa-amigo";
    div.appendChild(img);
    rutasCapas.push(ruta);
  }
});

div.classList.add("avatar-compuesto");
div.setAttribute("data-capas", rutasCapas.join("|"));
div.setAttribute("data-capa-class", "capa-amigo");

return div;

}


// ---------- RENDER AMIGOS ----------


function renderAmigos(activo){


const contenedor =
document.getElementById("listaAmigos");

if(!contenedor)return;



const lista = _datosAmigos.amigos;



if(lista.length===0){

contenedor.innerHTML=
`
<p class="lista-vacia">
Todavía no tenés amigos.
</p>
`;

return;

}



contenedor.innerHTML="";



lista.forEach(amigo=>{

const nombre = amigo.username;

let card=document.createElement("div");

card.className="amigo-card";



card.appendChild(
htmlAvatarMini(amigo.avatar)
);



card.innerHTML += `

<div class="amigo-info">

<div class="amigo-nombre">
${nombre}
</div>

${typeof insigniasBloqueHTML === "function" ? insigniasBloqueHTML(nombre, true) : ""}

<a class="btn-ver-perfil"
href="usuario.html?usuario=${encodeURIComponent(nombre)}">

👤 Ver perfil

</a>


</div>

`;



contenedor.appendChild(card);



});


}




// ---------- SOLICITUDES ----------


function renderSolicitudes(activo){


const contenedor =
document.getElementById("listaSolicitudes");


if(!contenedor)return;



const recibidas = _datosAmigos.solicitudesEntrantes;



if(recibidas.length===0){


contenedor.innerHTML=
`
<p class="lista-vacia">
No tenés solicitudes.
</p>
`;

return;

}



contenedor.innerHTML="";



recibidas.forEach(sol=>{


let div=document.createElement("div");


div.className="solicitud-card";


div.innerHTML=`

<div>
👤 ${sol.de}
</div>


<button class="btn-aceptar"
data-request-id="${sol.id}">

✅ Aceptar

</button>


`;



contenedor.appendChild(div);



});




contenedor.querySelectorAll(".btn-aceptar")
.forEach(btn=>{


btn.onclick=async ()=>{

btn.disabled = true;

await aceptarSolicitud(
Number(btn.dataset.requestId),
activo.nombre
);

await renderTodo(activo);


};



});



}




// ---------- ACEPTAR SOLICITUD ----------


async function aceptarSolicitud(requestId, para){

  const solicitud = _datosAmigos.solicitudesEntrantes.find(s => s.id === requestId);
  const de = solicitud ? solicitud.de : null;

  try{

    const respuesta = await fetch("/api/social?action=friends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "accept", requestId })
    });

    const datos = await respuesta.json();
    if(!datos || !datos.success) return;

  }catch(error){

    console.warn("MacroReborn: no se pudo aceptar la solicitud.", error);
    return;

  }

  if(!de) return;

  // LOGROS DE AMIGOS

  if(typeof desbloquearLogro==="function"){

    desbloquearLogro(de,"primerAmigo");
    desbloquearLogro(para,"primerAmigo");

  }


  // ACTIVIDAD RECIENTE - AMIGO

  if(typeof registrarActividad==="function"){

    registrarActividad(de,"amigo",para);
    registrarActividad(para,"amigo",de);

  }






}




// ---------- ENVIAR SOLICITUD ----------
// (usada desde otras páginas, ej. usuario.html, si llaman a esta
// función en vez de repetir la lógica)


async function enviarSolicitud(de,para){


  try{

    const respuesta = await fetch("/api/social?action=friends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "request", from: de, to: para })
    });

    const datos = await respuesta.json();
    if(!datos || !datos.success) return;

  }catch(error){

    console.warn("MacroReborn: no se pudo enviar la solicitud.", error);
    return;

  }





}





// ---------- PESTAÑAS ----------


function iniciarPestanas(){


const botones =
document.querySelectorAll(".atab");


const contenidos =
document.querySelectorAll(".atab-contenido");



botones.forEach(btn=>{


btn.addEventListener("click",()=>{


botones.forEach(b=>

b.classList.remove("activa-tab")

);



contenidos.forEach(c=>

c.classList.remove("activo-tab")

);



btn.classList.add("activa-tab");


const contenido =
document.getElementById(
btn.dataset.tab
);



if(contenido)

contenido.classList.add("activo-tab");



});


});


}






// ---------- SOLICITUDES ENVIADAS ----------


function renderEnviadas(activo){


const contenedor =
document.getElementById("listaEnviadas");


if(!contenedor)return;



const enviadas = _datosAmigos.solicitudesSalientes;



if(enviadas.length===0){


contenedor.innerHTML=
`
<p class="lista-vacia">
No enviaste solicitudes.
</p>
`;

return;

}



contenedor.innerHTML="";



enviadas.forEach(sol=>{


let div=document.createElement("div");


div.className="solicitud-card";


div.innerHTML=`

<div>
👤 ${sol.para}
</div>

<span class="badge">⏳ Pendiente</span>

`;



contenedor.appendChild(div);


});


}




// ---------- BADGES ----------


function actualizarBadges(activo){

const badgeAmigos = document.getElementById("badgeAmigos");
const badgeSolicitudes = document.getElementById("badgeSolicitudes");
const badgeEnviadas = document.getElementById("badgeEnviadas");

const cantAmigos = _datosAmigos.amigos.length;
const cantRecibidas = _datosAmigos.solicitudesEntrantes.length;
const cantEnviadas = _datosAmigos.solicitudesSalientes.length;

if(badgeAmigos) badgeAmigos.textContent = cantAmigos > 0 ? cantAmigos : "";
if(badgeSolicitudes) badgeSolicitudes.textContent = cantRecibidas > 0 ? cantRecibidas : "";
if(badgeEnviadas) badgeEnviadas.textContent = cantEnviadas > 0 ? cantEnviadas : "";

}




// ---------- RENDER TOTAL ----------


async function renderTodo(activo){

await cargarDatosAmigos(activo.nombre);

const nombres = [
  ..._datosAmigos.amigos.map(a => a.username),
  activo.nombre
];

if(typeof cargarInsigniasDeVarios === "function"){
  await cargarInsigniasDeVarios(nombres);
}

renderAmigos(activo);

renderSolicitudes(activo);

renderEnviadas(activo);

actualizarBadges(activo);

  const totalEl = document.getElementById('resumenAmigosTotal');
  const solicitudesEl = document.getElementById('resumenSolicitudes');
  const onlineEl = document.getElementById('resumenEnLinea');
  if(totalEl) totalEl.textContent = String(_datosAmigos.amigos.length);
  if(solicitudesEl) solicitudesEl.textContent = String(_datosAmigos.solicitudesEntrantes.length);
  if(onlineEl){
    const activos = _datosAmigos.amigos.filter(a =>
      typeof usuarioEstaConectado === 'function' ? usuarioEstaConectado(a) : false
    ).length;
    onlineEl.textContent = String(activos);
  }

}





// ---------- INICIO ----------


(function(){


const activo =
obtenerActivo();



const sinSesion =
document.getElementById("panelSinSesion");


const panel =
document.getElementById("panelAmigos");



if(!activo){


if(sinSesion)
sinSesion.style.display="block";


if(panel)
panel.style.display="none";


return;


}



if(sinSesion)
sinSesion.style.display="none";


if(panel)
panel.style.display="block";



iniciarPestanas();

renderTodo(activo);



})();

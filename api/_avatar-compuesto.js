// ==============================
// GUARDAR Y SERVIR EL AVATAR COMPUESTO — api/_avatar-compuesto.js
// ==============================
// api/_compositor.js apila las capas y devuelve bytes. Esto decide
// cuándo hacerlo, con qué nombre guardarlo y dónde. Fase 2 de
// docs/AVATARES-SERVIDOR.md.
//
// ---------------------------------------------------------------
// CADA PERSONA TIENE UNA DIRECCION, Y NO CAMBIA NUNCA
// ---------------------------------------------------------------
//     /avatares/128/62x96.jpg              el avatar que lleva puesto
//     /avatares/128/ranura3/62x96.jpg      su tercer diseño guardado
//
// Esas direcciones son suyas para siempre. Se cambia de ropa y el
// ARCHIVO cambia; la dirección no. Quien quiera mirar su propio avatar
// escribe eso y ve el de hoy, sin consultar nada.
//
// Es lo que hacía macrojuegos: /users/<id>/full.jpg, diez años en pie.
// Leído de su archivo el 21/09/2026, en docs/AVATARES-SERVIDOR.md 8.
//
// EL IDENTIFICADOR Y NO EL NOMBRE, aunque el nombre sería más legible.
// Medido sobre las 181 cuentas: 14 llevan caracteres que no caben en
// una URL sin escapar (espacios, ñ, unicode matemático, emoji) y hay
// dos pares que solo se distinguen por mayúsculas (yotter/Yotter,
// jader/Jader), así que una ruta insensible a mayúsculas los pisaría.
// macrojuegos usó el id por lo mismo.
//
// ---------------------------------------------------------------
// LA VERSION VA EN LA CONSULTA, NO EN LA RUTA
// ---------------------------------------------------------------
//     /avatares/128/62x96.jpg?v=401ddea45538
//
// Es LA MISMA DIRECCION con un sufijo. Apunta al mismo archivo: una
// cadena de consulta no toca el disco. Sirve para una sola cosa, y es
// la que hace que todo esto funcione:
//
//   - CON sufijo el navegador se queda la imagen un AÑO sin volver a
//     preguntar. La página de comunidad, en una segunda visita, pide
//     cero avatares.
//   - Cuando alguien se cambia de ropa, la API devuelve una huella
//     nueva, la página arma una dirección que ese navegador no ha visto
//     nunca, y baja la imagen nueva. Los demás lo ven al recargar, sin
//     esperar a que caduque nada.
//   - SIN sufijo la dirección es la misma de siempre, así que se sirve
//     con caché corta: es para escribirla a mano, no para las páginas.
//
// Antes la huella iba en la RUTA, y eso dejaba un archivo huérfano cada
// vez que alguien se cambiaba de ropa. Ahora se sobrescribe.
//
// VERSION va dentro de la huella a propósito. Si algún día cambia la
// calidad del JPG, el color de relleno o el orden de mezcla, la misma
// receta daría bytes distintos con la misma huella, y las cachés de un
// año servirían lo viejo. Subirla invalida todo de una vez.
//
// ---------------------------------------------------------------
// EN DISCO, NO EN POSTGRES
// ---------------------------------------------------------------
// La base mide 127 MB contra 128 de shared_buffers: hoy lee el 100 %
// de memoria y el día que se pase, eso se cae de golpe. Y hay una razón
// mejor que el tamaño: el arte es la FUENTE y vive en la base, que se
// respalda cada noche; un compuesto es DERIVADO y se rehace en 150 ms.
// Lo derivado no necesita respaldo.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const compositor = require("./_compositor");
const { CAPAS, VACIO } = require("./_avatar-catalogo");

// Sube esto cuando cambie algo que altere los bytes de salida.
const VERSION = 1;

// Los tamaños que se generan y se sirven. 62x96 es el de las listas,
// donde el avatar se pinta a 35-46 px; 327x504 es el del perfil.
const TAMANOS = [[327, 504], [62, 96]];
const TAMANOS_VALIDOS = new Set(TAMANOS.map(([a, l]) => a + "x" + l));

// Todo sale en JPG, incluido lo que no lleva fondo, que se aplana sobre
// blanco. Decidido el 21/09/2026: un solo formato, sin una rama aparte
// que mantener por el 5 % de los casos.
const EXTENSION = "jpg";

// Cuánto vive en el navegador cada forma de la dirección. Con versión,
// un año: la dirección cambia cuando cambia el dibujo. Sin versión, un
// minuto: es la misma dirección para siempre, así que no puede
// guardarse mucho o alguien se vería con la ropa de ayer.
const CACHE_CON_VERSION = 31536000;
const CACHE_SIN_VERSION = 60;

// Fuera del alcance de git a propósito, para que un despliegue no los
// toque. datos-locales/ ya está en .gitignore, y git no borra lo
// ignorado ni con reset --hard. La variable de entorno existe para los
// tests: en producción y en local se usa la misma ruta por defecto, y
// eso es deliberado. Si el servidor web y el script de relleno pudieran
// discrepar sobre dónde están los archivos, el fallo sería invisible
// hasta que alguien viera un avatar roto.
const DIRECTORIO = process.env.MR_AVATARES_DIR ||
  path.join(__dirname, "..", "datos-locales", "avatares-compuestos");

// ------------------------------------------------------------------
// EL DESTINO
// ------------------------------------------------------------------
// Un destino dice DONDE va el archivo, no qué lleva dentro:
//     { usuarioId: 128 }             el avatar puesto
//     { usuarioId: 128, ranura: 3 }  el tercer diseño guardado

function destinoValido(destino) {
  if (!destino || !Number.isInteger(destino.usuarioId) || destino.usuarioId < 1) return false;
  if (destino.ranura === undefined || destino.ranura === null) return true;
  return Number.isInteger(destino.ranura) && destino.ranura >= 1 && destino.ranura <= 9999;
}

// La carpeta en disco. Se agrupa de mil en mil por el mismo motivo que
// macrojuegos: con una sola carpeta, decenas de miles de subcarpetas
// hacen lento cualquier listado, y esto crece con cada cuenta.
//
// El agrupamiento NO sale en la URL. macrojuegos lo enseñaba
// (/users/1021000/1021181/) y no hacía falta: el servidor sabe
// calcularlo, y así la dirección que la gente escribe es más corta.
function carpetaDe(destino) {
  const grupo = String(Math.floor(destino.usuarioId / 1000) * 1000);
  const base = path.join(DIRECTORIO, grupo, String(destino.usuarioId));
  return destino.ranura ? path.join(base, "ranura" + destino.ranura) : base;
}

function rutaDe(destino, ancho, alto) {
  return path.join(carpetaDe(destino), ancho + "x" + alto + "." + EXTENSION);
}

// ------------------------------------------------------------------
// LA RECETA
// ------------------------------------------------------------------

// Saca las capas con prenda de un avatar, en orden de dibujo. El orden
// sale de api/_avatar-catalogo.js, que es el único sitio del servidor
// donde vive; no se copia aquí.
function capasCon(avatar) {
  if (!avatar || typeof avatar !== "object") return [];
  return CAPAS
    .map(capa => ({ capa, valor: avatar[capa] }))
    .filter(x => x.valor && x.valor !== VACIO && typeof x.valor === "string");
}

// Busca el archivo de cada prenda y arma la receta. Devuelve null
// cuando no hay nada que componer: quien no eligió ninguna prenda no
// tiene compuesto, y eso no es un error.
//
// La huella sale de las prendas y NO del destino: dos personas con el
// mismo avatar tienen la misma huella, aunque cada una guarde su propio
// archivo. Eso deja comparar "¿cambió este avatar?" sin mirar el disco.
async function recetaDe(sql, avatar) {
  const capas = capasCon(avatar);
  if (!capas.length) return null;

  const valores = capas.map(c => c.valor);
  const filas = await sql`
    SELECT p.valor, a.sha256, a.datos
    FROM avatar_prendas p
    JOIN avatar_archivos a ON a.id = p.archivo_id
    WHERE p.valor = ANY(${valores});
  `;
  const porValor = new Map(filas.map(f => [f.valor, f]));

  // Una prenda que no está en el catálogo se salta en vez de reventar.
  // Pasa con un avatar viejo que lleva algo retirado, y dejar a esa
  // persona sin imagen sería peor que dibujarla sin esa capa, que es
  // exactamente lo que hace hoy el navegador.
  const encontradas = capas
    .map(c => ({ capa: c.capa, valor: c.valor, archivo: porValor.get(c.valor) }))
    .filter(c => c.archivo);

  if (!encontradas.length) return null;

  const texto = "v" + VERSION + "\n" +
    encontradas.map(c => c.capa + ":" + c.archivo.sha256).join("\n");
  const huella = crypto.createHash("sha256").update(texto).digest("hex");

  return {
    huella,
    capas: encontradas.map(c => ({ capa: c.capa, valor: c.valor, sha256: c.archivo.sha256 })),
    archivos: encontradas.map(c => c.archivo.datos)
  };
}

// ------------------------------------------------------------------
// EL DISCO
// ------------------------------------------------------------------

// Escribe por un nombre temporal y renombra. Sin esto, dos peticiones a
// la vez o un corte de luz dejan un archivo a medias, y ahora que el
// archivo se sobrescribe eso seria pisar uno bueno con uno roto.
function escribirEntero(destino, datos) {
  const temporal = destino + "." + process.pid + "." + Date.now() + ".tmp";
  fs.writeFileSync(temporal, datos);
  fs.renameSync(temporal, destino);
}

function leer(destino, ancho, alto) {
  if (!destinoValido(destino)) return null;
  if (!TAMANOS_VALIDOS.has(ancho + "x" + alto)) return null;
  try {
    return fs.readFileSync(rutaDe(destino, ancho, alto));
  } catch (_) {
    return null;
  }
}

// ------------------------------------------------------------------
// EL FRENO
// ------------------------------------------------------------------
// Componer cuesta 170 ms de CPU en esta maquina, y nginx deja pasar 30
// peticiones por segundo por IP. O sea que, sin freno, una sola persona
// guardando su avatar en bucle pide 5 segundos de CPU por cada segundo
// de reloj, en una maquina de dos nucleos. Eso es tumbar el sitio desde
// una cuenta normal, y lo trajo este mismo trabajo: antes, guardar el
// avatar era validar y un UPDATE.
//
// Dos frenos, y el primero hace casi todo el trabajo:
//
//   1. NO SE RECOMPONE LO QUE NO CAMBIO. Si la huella guardada es la
//      misma que la de la receta nueva y los dos archivos estan en su
//      sitio, el archivo YA es correcto: la huella captura la receta
//      entera. Guardar veinte veces el mismo avatar cuesta una
//      composicion, no veinte.
//
//   2. UN PRESUPUESTO POR PERSONA Y POR MINUTO, para el caso de quien
//      alterne entre dos avatares a proposito. Un humano guarda dos o
//      tres veces seguidas como mucho; el tope de abajo ni lo roza.
//
// El presupuesto vive en memoria y NO entre procesos, asi que con dos
// procesos el techo real es el doble. Da igual: no es una cuota que
// haya que cuadrar, es un tope para que nadie se lleve la maquina. Lo
// mismo que hace api/_rafaga.js y por el mismo motivo.
const TOPE_POR_MINUTO = 12;
const VENTANA_MS = 60 * 1000;

const gastado = new Map();   // usuarioId -> [instantes]

function hayPresupuesto(usuarioId) {
  const ahora = Date.now();
  const previos = (gastado.get(usuarioId) || []).filter(t => ahora - t < VENTANA_MS);

  if (previos.length >= TOPE_POR_MINUTO) {
    gastado.set(usuarioId, previos);
    return false;
  }

  previos.push(ahora);
  gastado.set(usuarioId, previos);

  // El Map crece con cada persona que se cambia de ropa y nunca
  // encogeria solo. Se barre de vez en cuando lo que ya caduco.
  if (gastado.size > 500) {
    for (const [id, marcas] of gastado) {
      if (!marcas.some(t => ahora - t < VENTANA_MS)) gastado.delete(id);
    }
  }

  return true;
}

// Para los tests, que no pueden esperar un minuto.
function olvidarPresupuesto() {
  gastado.clear();
}

// ------------------------------------------------------------------
// LO QUE SE USA DESDE FUERA
// ------------------------------------------------------------------

// Compone el avatar de este destino y devuelve su huella. null si no
// hay nada que componer, o si esta persona agoto su presupuesto.
//
// `huellaGuardada` es la que la base ya tiene para este destino. Si
// coincide con la nueva y los archivos estan, no se recompone: ver EL
// FRENO. Quien no la tenga a mano puede no pasarla, y entonces se
// compone siempre, que es lo correcto pero mas caro.
async function asegurar(sql, destino, avatar, huellaGuardada) {
  if (!destinoValido(destino)) throw new TypeError("Destino de avatar inválido");

  // Sin prendas no hay compuesto, y tampoco puede quedarse el de la ropa
  // de antes: lo que esta en el disco se sirve sin preguntar a la base
  // (ver SI FALTA, SE COMPONE AL PEDIRLO), asi que se seguiria viendo.
  // Pasa al quitarse todo y al ponerse un PNG de administrador.
  const receta = await recetaDe(sql, avatar);
  if (!receta) {
    borrar(destino);
    return null;
  }

  // Freno 1: no cambio nada.
  if (huellaGuardada && huellaGuardada === receta.huella &&
      TAMANOS.every(([a, l]) => fs.existsSync(rutaDe(destino, a, l)))) {
    return receta.huella;
  }

  // Freno 2: esta persona ya gasto lo suyo este minuto. Se devuelve
  // null, que significa "sin compuesto": la pagina la dibuja por capas
  // como siempre, y el siguiente guardado o el relleno lo arreglan.
  if (!hayPresupuesto(destino.usuarioId)) {
    console.warn("avatar compuesto: presupuesto agotado para el usuario " + destino.usuarioId);
    // Lo del disco es la ropa de antes. Fuera, por lo mismo que arriba:
    // sin archivo, se compone al pedirlo cuando vuelva a haber presupuesto.
    borrar(destino);
    return null;
  }

  const carpeta = carpetaDe(destino);
  fs.mkdirSync(carpeta, { recursive: true });

  const salida = compositor.renderizar(receta.archivos, TAMANOS, { formato: EXTENSION });
  for (const [a, l] of TAMANOS) {
    escribirEntero(rutaDe(destino, a, l), salida.salidas[a + "x" + l]);
  }

  return receta.huella;
}

// La misma llamada, pero que no pueda tumbar lo que la llamó. Guardar
// un avatar tiene que funcionar aunque el disco esté lleno: la persona
// se queda sin compuesto hasta el siguiente guardado, no sin avatar.
async function asegurarSinFallar(sql, destino, avatar, huellaGuardada) {
  try {
    return await asegurar(sql, destino, avatar, huellaGuardada);
  } catch (error) {
    console.error("avatar compuesto: no se pudo generar.", error.message);
    return null;
  }
}

// Borra los archivos de un destino. Para cuando alguien vacía una
// ranura: sin esto, el dibujo de un diseño borrado seguiria sirviendose
// en su direccion para siempre.
//
// Solo los archivos, nunca la carpeta del avatar puesto: las de las
// ranuras viven dentro, y un borrado recursivo se llevaria los diseños
// guardados de esa persona. La de una ranura si se quita entera.
function borrar(destino) {
  if (!destinoValido(destino)) return false;
  try {
    for (const [a, l] of TAMANOS) fs.rmSync(rutaDe(destino, a, l), { force: true });
    if (destino.ranura) fs.rmSync(carpetaDe(destino), { recursive: true, force: true });
    return true;
  } catch (error) {
    console.error("avatar compuesto: no se pudo borrar.", error.message);
    return false;
  }
}

// La dirección pública. Sin huella devuelve la dirección desnuda, que
// también funciona y sirve para escribirla a mano.
function urlDe(destino, huella, ancho, alto) {
  if (!destinoValido(destino)) return null;
  const a = ancho || 62, l = alto || 96;
  const base = "/avatares/" + destino.usuarioId +
    (destino.ranura ? "/ranura" + destino.ranura : "") +
    "/" + a + "x" + l + "." + EXTENSION;
  // Doce caracteres bastan: es un identificador de version, no un
  // secreto, y la huella entera haria la URL ilegible.
  return huella ? base + "?v=" + String(huella).slice(0, 12) : base;
}

// ¿Esta ruta es la de un compuesto? Devuelve sus piezas o null. Vive
// aquí y no en server.js porque el servidor de desarrollo es OTRO
// servidor: cuando el cierre de las prendas vivió dentro de server.js,
// en local no se aplicaba y probar decía lo contrario de la verdad.
// Misma lección que api/_prendas-ruta.js.
const RUTA = new RegExp(
  "^/avatares/(\\d{1,9})(?:/ranura(\\d{1,4}))?/(\\d{1,4})x(\\d{1,4})\\." + EXTENSION + "$"
);

function partirRuta(pathname) {
  const m = RUTA.exec(String(pathname || ""));
  if (!m) return null;

  const ancho = Number(m[3]), alto = Number(m[4]);
  if (!TAMANOS_VALIDOS.has(ancho + "x" + alto)) return null;

  const destino = { usuarioId: Number(m[1]) };
  if (m[2] !== undefined) destino.ranura = Number(m[2]);
  if (!destinoValido(destino)) return null;

  return { destino, ancho, alto };
}

// ------------------------------------------------------------------
// SI FALTA, SE COMPONE AL PEDIRLO
// ------------------------------------------------------------------
// Decidido el 24/09/2026, para la fase 3: todas las paginas piden el
// avatar compuesto, y el servidor ya lo tiene porque lo compone al
// guardar. Si aun asi falta -fallo al guardarse, o la cuenta nunca paso
// por el relleno-, se compone en ese momento, se guarda y se sirve. SOLO
// entonces: lo que esta en el disco se sirve tal cual, sin recalcular
// nada.
//
// Y si no se puede -no tiene avatar de prendas, se agoto su freno o
// fallo el dibujo- se sirve la silueta generica del sitio, con cache
// corta para que se vuelva a intentar. Nunca una prenda suelta.

const SILUETA = path.join(__dirname, "..", "imagenes", "avatar.png");
let _silueta = null;

function silueta() {
  if (!_silueta) _silueta = fs.readFileSync(SILUETA);
  return _silueta;
}

// Componer cuesta unos 170 ms de CPU. Como mucho estas a la vez por
// proceso: si una pagina pide cien que faltan, las demas reciben la
// silueta y se componen en la siguiente visita, en vez de llevarse la
// maquina.
const A_LA_VEZ = 2;
let enCurso = 0;

async function leerOComponer(sql, destino, ancho, alto) {
  const listo = leer(destino, ancho, alto);
  if (listo) return { datos: listo, compuesto: true };

  const sinAvatar = { datos: silueta(), compuesto: false };
  if (!destinoValido(destino) || !TAMANOS_VALIDOS.has(ancho + "x" + alto)) return sinAvatar;
  if (enCurso >= A_LA_VEZ) return sinAvatar;

  enCurso++;
  try {
    const filas = destino.ranura
      ? await sql`SELECT avatar, avatar_compuesto FROM saved_avatars
                  WHERE user_id = ${destino.usuarioId} AND slot = ${destino.ranura};`
      : await sql`SELECT avatar, avatar_compuesto FROM users WHERE id = ${destino.usuarioId};`;
    if (!filas.length || !filas[0].avatar) return sinAvatar;

    let avatar = filas[0].avatar;
    if (typeof avatar === "string") {
      try { avatar = JSON.parse(avatar); } catch (_) { return sinAvatar; }
    }

    // Sin huella guardada a proposito: el archivo falta, asi que hay que
    // hacerlo aunque la base diga que ya estaba.
    const huella = await asegurarSinFallar(sql, destino, avatar, null);
    if (!huella) return sinAvatar;

    if (huella !== filas[0].avatar_compuesto) {
      if (destino.ranura) {
        await sql`UPDATE saved_avatars SET avatar_compuesto = ${huella}
                  WHERE user_id = ${destino.usuarioId} AND slot = ${destino.ranura};`;
      } else {
        await sql`UPDATE users SET avatar_compuesto = ${huella} WHERE id = ${destino.usuarioId};`;
      }
    }

    const hecho = leer(destino, ancho, alto);
    return hecho ? { datos: hecho, compuesto: true } : sinAvatar;
  } catch (error) {
    console.error("avatar compuesto: no se pudo componer al pedirlo.", error.message);
    return sinAvatar;
  } finally {
    enCurso--;
  }
}

// Sirve /avatares/<id>/<tam>.jpg y las ranuras. Devuelve true si la ruta
// era suya. Vive aqui y no en server.js para que el servidor de
// desarrollo haga exactamente lo mismo: misma leccion que
// api/_prendas-ruta.js.
async function atender(req, res, url, sql) {
  const ruta = partirRuta(url.pathname);
  if (!ruta) return false;

  const r = await leerOComponer(sql, ruta.destino, ruta.ancho, ruta.alto);

  // La silueta, con cache corta aunque la direccion traiga version: no
  // es el avatar de esa persona, y en cuanto se pueda componer tiene que
  // dejar de verse.
  if (!r.compuesto) {
    res.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": r.datos.length,
      "Cache-Control": "public, max-age=" + CACHE_SIN_VERSION
    });
    res.end(req.method === "HEAD" ? undefined : r.datos);
    return true;
  }

  // CON version, un año: esa direccion exacta solo existe mientras el
  // avatar sea ese. SIN version, un minuto: la direccion desnuda es la
  // misma para siempre, y guardarsela mucho seria enseñar la ropa de ayer.
  const conVersion = !!url.searchParams.get("v");
  const segundos = conVersion ? CACHE_CON_VERSION : CACHE_SIN_VERSION;
  res.writeHead(200, {
    "Content-Type": "image/jpeg",
    "Content-Length": r.datos.length,
    "Cache-Control": "public, max-age=" + segundos + (conVersion ? ", immutable" : "")
  });
  res.end(req.method === "HEAD" ? undefined : r.datos);
  return true;
}

module.exports = {
  VERSION,
  TAMANOS,
  TAMANOS_VALIDOS,
  EXTENSION,
  DIRECTORIO,
  CACHE_CON_VERSION,
  CACHE_SIN_VERSION,
  destinoValido,
  capasCon,
  recetaDe,
  carpetaDe,
  rutaDe,
  leer,
  TOPE_POR_MINUTO,
  hayPresupuesto,
  olvidarPresupuesto,
  asegurar,
  asegurarSinFallar,
  borrar,
  urlDe,
  partirRuta,
  leerOComponer,
  atender
};

// ==============================
// EL VESTIDOR DEL PANEL DE ARTE — js/arte-vestidor.js
// ==============================
// Un maniquí donde el equipo de dibujo se prueba las prendas ANTES de
// publicarlas: se las pone todas, las combina con lo que ya está en el
// catálogo, y si alguna quedó descuadrada la corre unos píxeles hasta
// que encaja.
//
// Existe porque hasta ahora una prenda descuadrada solo se descubría
// cuando alguien se la ponía, y para entonces ya estaba publicada y su
// identificador repartido. Retirarla es fácil (avatar-estado-prenda),
// pero el número que gastó no vuelve nunca: siguienteValor() se lo salta
// para siempre, igual que se salta el 7 de las pieles de tora desde que
// tres cuentas se quedaron con un "tora_piel7" cuyo dibujo ya no existe.
//
// NADA DE ESTO TOCA EL SERVIDOR HASTA QUE SE PULSA PUBLICAR. Los PNG en
// prueba son archivos locales del navegador. No hay borradores en la
// base, y no se gasta un identificador por probar algo.
//
// El archivo está partido en dos zonas, y la frontera es literal:
//
//   ZONA A  aritmética pura, de nivel superior, sin document ni window.
//           Se recorta y se evalúa en un vm para probarla sin navegador
//           (tests/vestidor-geometria.test.js). Si alguna función de acá
//           se acopla al DOM, ese test revienta con ReferenceError, y
//           eso es exactamente lo que queremos que pase.
//
//   ZONA B  la pantalla. Un IIFE que termina exponiendo un único global,
//           window.MacroVestidor. No ejecuta nada al cargarse: quien lo
//           arranca es js/arte.js llamando a conectar().
//
// ==============================
// TRABAJO PENDIENTE — CORREGIR UNA PRENDA YA PUBLICADA
// ==============================
// El vestidor arregla el dibujo ANTES de publicarlo. Lo que no hace, y
// hoy no se puede hacer desde ninguna parte, es corregir una prenda que
// ya está en el catálogo.
//
// No es que falte una pantalla: es del esquema. avatar_prendas.archivo_id
// apunta a una fila de avatar_archivos deduplicada por sha256, y esa fila
// puede estar COMPARTIDA por varias prendas de varios personajes. No es
// hipotético: cereza/fondo24, tora/fondo24 y los fondo1 de fengchao,
// fenglei, fiora y max son SEIS archivos con un solo sha256, o sea una
// sola fila. Editar sus bytes le cambiaría el fondo a los seis a la vez,
// incluidos los cinco que estaban bien.
//
// Corregir, entonces, es hornear un PNG nuevo, insertarlo como un
// avatar_archivos NUEVO y apuntar ahí el archivo_id de esa prenda y solo
// de esa. Nunca editar el archivo existente. Y hay que convivir con que
// la URL vieja, /prendas/<sha viejo>.png, está cacheada un año e
// immutable en el navegador de cada persona que ya vio la prenda: la
// corrección solo la verían quienes no la tuvieran en caché. El "valor"
// de la prenda no cambia, pero su URL sí, y hay que mirar qué hacer con
// avatar_catalogo_version y con los dos procesos de cluster.js.
//
// Mientras tanto, el camino que sí funciona es el de siempre: subir el
// dibujo corregido como prenda NUEVA desde el vestidor, y retirar la
// vieja desde el catálogo. Quien la lleve puesta la conserva.
//
// Ver también docs/DESARROLLO.md, "El lienzo del catálogo", para el otro
// trabajo que esto destapó: 64 dibujos del catálogo no miden 327x504.


// ==============================
// ZONA A — LA ARITMÉTICA
// ==============================
// Todo lo que sigue son funciones puras. Las medidas van en PÍXELES DEL
// LIENZO, un rectángulo de 327x504 con el origen arriba a la izquierda.
//
// Y la decisión que gobierna el archivo entero: a escala 100, un píxel
// del lienzo es un píxel del archivo del artista. La base de la
// transformación es el PEGADO 1:1, no el encaje. Eso hace dos cosas a la
// vez que ninguna otra parametrización consigue juntas:
//
//   1. El número que enseña el panel es el que el artista teclea en su
//      programa de dibujo. "+12 px" son 12 píxeles de su archivo y
//      "103 %" es el 103 % de su exportador.
//
//   2. Mover y espejar NO tocan el dibujo. Son traslaciones de píxeles
//      enteros, o sea un calco: cero interpolación.
//
// El intento anterior usaba el encaje (object-fit: contain) como base, y
// eso remuestreaba el dibujo completo para el 21 % del catálogo. El caso
// que lo demuestra es tora/pelo10, de 326x504: el factor de encaje es
// 1,000000 exacto -no hay nada que redimensionar- y aun así el dibujo
// caía en x = 0,5 y había que interpolarlo entero para correrlo medio
// píxel. El problema no era el lienzo de destino: era la base.

const VEST_LIENZO_ANCHO = 327;
const VEST_LIENZO_ALTO = 504;

// Lo que significa "no he movido nada". Congelado porque se devuelve por
// referencia desde vestNormalizarAjuste(null) y nadie debe escribirlo.
const VEST_AJUSTE_NEUTRO = Object.freeze({
  dx: 0, dy: 0, escala: 100, espejo: false, alLienzo: false
});

// La misma expresión que api/content.js:132. Si una de las dos cambia,
// el navegador y el servidor dejan de estar de acuerdo sobre qué es un
// PNG y la subida falla con un mensaje que no explica nada.
const VEST_DATA_PNG = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

// Los dos topes, que se cuentan en unidades DISTINTAS a propósito; ver
// vestPesoDeDataUrl y vestBytesDeCuerpo, más abajo.
const VEST_TOPE_PRENDA = 1024 * 1024;        // bytes del PNG ya decodificado
const VEST_TOPE_CUERPO = 10 * 1024 * 1024;   // bytes de la cadena que viaja

const VEST_TOPE_DESPLAZAMIENTO = 1000;
const VEST_ESCALA_MINIMA = 10;
const VEST_ESCALA_MAXIMA = 400;


// ---------- EL AJUSTE ----------

function vestEnteroEntre(valor, minimo, maximo, porDefecto) {
  const n = Math.round(Number(valor));
  if (!Number.isFinite(n)) return porDefecto;
  return Math.min(maximo, Math.max(minimo, n));
}

// El único conversor. Todo lo que entra al vestidor desde fuera -un
// input de texto, un JSON viejo, un atajo de teclado- pasa por acá, y
// sale con enteros y booleanos de verdad.
//
// La escala se guarda como PORCENTAJE ENTERO y no como factor decimal a
// propósito: el panel enseña "103 %" y eso tiene que ser el valor
// guardado, no el redondeo de un 1.0299999999999998.
function vestNormalizarAjuste(crudo) {
  if (!crudo || typeof crudo !== "object") return VEST_AJUSTE_NEUTRO;
  return {
    dx: vestEnteroEntre(crudo.dx, -VEST_TOPE_DESPLAZAMIENTO, VEST_TOPE_DESPLAZAMIENTO, 0),
    dy: vestEnteroEntre(crudo.dy, -VEST_TOPE_DESPLAZAMIENTO, VEST_TOPE_DESPLAZAMIENTO, 0),
    escala: vestEnteroEntre(crudo.escala, VEST_ESCALA_MINIMA, VEST_ESCALA_MAXIMA, 100),
    espejo: crudo.espejo === true,
    alLienzo: crudo.alLienzo === true
  };
}

// Solo la transformación: alLienzo no cuenta, porque no mueve nada.
//
// Nótese lo que esto da gratis: mover una prenda y volver a ponerlo todo
// a cero vuelve a ser "no he movido nada", y el archivo se sube byte a
// byte como si nunca se hubiera abierto el vestidor.
function vestEsNeutro(ajuste) {
  if (!ajuste) return true;
  const a = vestNormalizarAjuste(ajuste);
  return a.dx === 0 && a.dy === 0 && a.escala === 100 && a.espejo === false;
}

// ¿Se puede ajustar? Hace falta saber cuánto mide el PNG, y hay un
// camino por el que no se sabe: js/arte.js deja ancho y alto en 0 cuando
// el navegador no consiguió decodificar la imagen.
function vestPuedeAjustarse(item) {
  return !!item && item.ancho > 0 && item.alto > 0;
}

// Hornear un PNG que ya mide el lienzo y no se ha movido produciría un
// dibujo píxel a píxel idéntico al original... pero con otros bytes,
// otro sha256 y una fila DUPLICADA en avatar_archivos.
//
// Parece rebuscado y no lo es: lo dispara "aplicar este ajuste a todas
// las de esta ranura" en cuanto una de las hermanas ya estaba bien.
function vestSeriaIdentidad(item) {
  return !!item &&
    item.ancho === VEST_LIENZO_ANCHO &&
    item.alto === VEST_LIENZO_ALTO &&
    vestEsNeutro(item.ajuste);
}

// LA ÚNICA PUERTA. Nadie más decide si un PNG pasa por el horno.
//
// Ojo con el caso sin medidas: acá sigue dando true, porque el artista
// SÍ pidió un ajuste. Que no se pueda cumplir es cosa del horno, que
// avisa en vez de subir el original en silencio. Un respaldo silencioso
// publicaría algo que el artista no vio.
function vestHayQueHornear(item) {
  if (!item || !item.ajuste) return false;
  if (vestSeriaIdentidad(item)) return false;
  return item.ajuste.alLienzo === true || !vestEsNeutro(item.ajuste);
}


// ---------- EL ANCLAJE ----------

// Dónde cae la esquina superior izquierda del archivo cuando el artista
// no ha movido nada. El archivo se centra en el lienzo, PERO el
// desplazamiento se redondea a entero, y ese redondeo es la decisión más
// importante de todo el vestidor.
//
// Si se centrara con decimales, un PNG de 327x505 caería en y = -0,5 y
// uno de 326x503 en (0,5 , 0,5): coordenadas fraccionarias. Y drawImage
// con coordenadas fraccionarias INTERPOLA el dibujo entero. El artista
// que solo quería correr un fondo 12 px a la derecha recibiría su dibujo
// de línea limpia filtrado en los dos ejes, sin enterarse. Es lo mismo
// que prohibimos para la rotación, y por el mismo motivo.
//
// Math.round redondea hacia +infinito en los empates, así que el
// sobrante impar se resuelve SIEMPRE hacia arriba y a la izquierda: el
// relleno transparente aparece arriba/izquierda y el recorte se come la
// fila/columna de abajo/derecha. Es una regla, no un azar, y el panel la
// dice en voz alta en cada prenda descuadrada.
//
// El "+ 0" no es decorativo: Math.round(-0.5) devuelve -0, y -0 no es 0
// para assert.deepStrictEqual ni para Object.is. Sumarle 0 lo convierte
// en +0 sin tocar ningún otro valor.
function vestAnclaje(w, h) {
  return {
    x: Math.round((VEST_LIENZO_ANCHO - w) / 2) + 0,
    y: Math.round((VEST_LIENZO_ALTO - h) / 2) + 0
  };
}

// Los píxeles que el anclaje neutro tira y los que rellena, por lado.
// Alimenta la línea del panel que dice "recorta 1 px por abajo".
function vestRecorteDeAnclaje(w, h) {
  const n = vestAnclaje(w, h);
  const der = n.x + w - VEST_LIENZO_ANCHO;
  const abajo = n.y + h - VEST_LIENZO_ALTO;
  return {
    recorta: {
      izq: Math.max(0, -n.x), arriba: Math.max(0, -n.y),
      der: Math.max(0, der), abajo: Math.max(0, abajo)
    },
    rellena: {
      izq: Math.max(0, n.x), arriba: Math.max(0, n.y),
      der: Math.max(0, -der), abajo: Math.max(0, -abajo)
    }
  };
}


// ---------- LA CUENTA QUE MANDA ----------

// Un rectángulo en píxeles del lienzo. Es lo único que sabe geometría en
// todo el vestidor, y lo consumen SIN RECALCULAR NADA los dos únicos
// interesados: el DOM, que lo escribe en left/top/width/height sobre un
// marco de 327x504 px de CSS clavados, y el canvas, que mete esos mismos
// cuatro números en drawImage sobre un lienzo de 327x504.
//
// Que sean los mismos cuatro números es la razón de que lo que el
// artista ve sea lo que se publica. No hay dos aritméticas que mantener
// sincronizadas: hay una y dos consumidores.
function vestEncuadrePegado(w, h, ajuste) {
  const a = vestNormalizarAjuste(ajuste);
  const n = vestAnclaje(w, h);
  const s = a.escala / 100;
  return {
    // El (1 - s) / 2 es lo que hace que escalar no mueva el centro: el
    // rectángulo crece o encoge alrededor de su punto medio. Sin esto,
    // subir un sombrero del 100 % al 103 % lo sacaría de la cabeza.
    x: n.x + w * (1 - s) / 2 + a.dx,
    y: n.y + h * (1 - s) / 2 + a.dy,
    ancho: w * s,
    alto: h * s,
    espejo: a.espejo
  };
}


// ---------- EL ENCAJE ----------

// El encaje sigue existiendo, pero ya NO es la base del ajuste. Sirve
// para dos cosas, y ninguna de las dos pasa por el horno:
//
//   1. pintar las capas del CATÁLOGO, que se suben tal cual y que el
//      editor de verdad muestra con object-fit: contain. El maniquí
//      tiene que enseñarlas como las verá el usuario, porque son el
//      fondo contra el que se compara lo nuevo;
//
//   2. pintar una prenda LOCAL que todavía no tiene ajuste, porque
//      mientras no lo tenga se sube tal cual y el sitio la encajará
//      igual que a las del catálogo.
function vestFactorContain(w, h) {
  if (!w || !h) return 1;
  return Math.min(VEST_LIENZO_ANCHO / w, VEST_LIENZO_ALTO / h);
}

function vestEncajeContain(w, h) {
  if (!w || !h) {
    return { x: 0, y: 0, ancho: VEST_LIENZO_ANCHO, alto: VEST_LIENZO_ALTO, espejo: false };
  }
  const k = vestFactorContain(w, h);
  const ancho = w * k;
  const alto = h * k;
  return {
    x: (VEST_LIENZO_ANCHO - ancho) / 2,
    y: (VEST_LIENZO_ALTO - alto) / 2,
    ancho, alto, espejo: false
  };
}

// Lo que costaría llevar un PNG al lienzo por encaje, en porcentaje.
//
// Vale exactamente 100 para las tres medidas raras que de verdad abundan
// (327x505, 326x503, 326x504), porque a esas les basta con recortar o
// rellenar una fila. Solo los tres bichos sueltos del catálogo -el
// 654x1010, el 415x640 y el 332x512- necesitan de verdad un cambio de
// escala, y para esos el botón lo dice en voz alta: eso sí remuestrea.
function vestEscalaDeEncaje(w, h) {
  return Math.round(100 * vestFactorContain(w, h));
}


// ---------- LA PUERTA ÚNICA ----------

// El MISMO predicado que decide si se hornea decide qué rectángulo se
// pinta. No hay forma de que la pantalla y el PNG que sale discrepen
// sobre el destino, porque no hay dos decisiones: hay una.
function vestEncuadreDeCapa(item) {
  const i = item || {};
  if (!vestPuedeAjustarse(i)) return vestEncajeContain(0, 0);
  return vestHayQueHornear(i)
    ? vestEncuadrePegado(i.ancho, i.alto, i.ajuste)
    : vestEncajeContain(i.ancho, i.alto);
}

// Los mismos números, en cadenas para el DOM. Es deliberadamente tonta:
// si alguien necesita corregir algo, lo corrige en vestEncuadreDeCapa y
// las dos mitades se enteran a la vez.
//
// El object-fit de .vest-capa es "fill", no "contain": el rectángulo que
// sale de acá YA es el encaje cuando toca serlo, y dejar que el
// navegador lo aplique otra vez lo aplicaría dos veces.
function vestEstiloDeCapa(item) {
  const e = vestEncuadreDeCapa(item);
  return {
    left: e.x + "px",
    top: e.y + "px",
    width: e.ancho + "px",
    height: e.alto + "px",
    transform: e.espejo ? "scaleX(-1)" : "none"
  };
}


// ---------- LAS MEDIDAS DEL CATÁLOGO ----------

// "332x512" -> {ancho: 332, alto: 512}
//
// Es como se miden las capas ya publicadas: avatar-panel manda las
// medidas en una cadena (api/content.js:96). Sin esto, el maniquí daría
// por hecho que todo lo publicado mide el lienzo, y mentiría justo con
// las prendas descuadradas que el vestidor existe para cazar.
function vestMedidasDeTexto(texto) {
  const m = /^(\d+)x(\d+)$/.exec(String(texto || "").trim());
  if (!m) return { ancho: 0, alto: 0 };
  return { ancho: Number(m[1]), alto: Number(m[2]) };
}


// ---------- LO QUE SE SALE DEL LIENZO ----------

// Mapea una caja medida en píxeles DEL ARCHIVO -por ejemplo la caja de
// tinta, el rectángulo donde de verdad hay dibujo- a píxeles del lienzo,
// a través del mismo encuadre con el que se va a hornear.
function vestCajaEnLienzo(caja, w, h, ajuste) {
  const e = vestEncuadrePegado(w, h, ajuste);
  const k = w ? e.ancho / w : 1;
  const j = h ? e.alto / h : 1;
  return {
    x: e.x + (caja.x || 0) * k,
    y: e.y + (caja.y || 0) * j,
    ancho: (caja.ancho || 0) * k,
    alto: (caja.alto || 0) * j
  };
}

// Cuántos píxeles de lienzo se pierden por cada lado. Hacia arriba,
// porque medio píxel perdido es un píxel que el artista no ve.
function vestRecorteDeCaja(caja) {
  return {
    izq: Math.max(0, Math.ceil(-caja.x)),
    arriba: Math.max(0, Math.ceil(-caja.y)),
    der: Math.max(0, Math.ceil(caja.x + caja.ancho - VEST_LIENZO_ANCHO)),
    abajo: Math.max(0, Math.ceil(caja.y + caja.alto - VEST_LIENZO_ALTO))
  };
}


// ---------- LO QUE SE LE ENSEÑA AL ARTISTA ----------

function vestConSigno(n) {
  return (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n);
}

function vestResumenDeAjuste(ajuste) {
  if (vestEsNeutro(ajuste) && !(ajuste && ajuste.alLienzo)) return "sin ajuste";
  const a = vestNormalizarAjuste(ajuste);
  const partes = [vestConSigno(a.dx) + " px", vestConSigno(a.dy) + " px", a.escala + " %"];
  if (a.espejo) partes.push("espejo");
  if (a.alLienzo) partes.push("al lienzo");
  return partes.join(" · ");
}

// La frase accionable. El objetivo de la herramienta no es que el ajuste
// viva dentro de nuestra web: es que el artista pueda arreglar SU
// archivo y volver a subirlo sin ajuste ninguno.
//
// Y los números ya están en píxeles de su archivo. No hay que dividir
// por nada, que es justo lo que la base pegada compró: con el encaje
// como base, el ancho dibujado era w*k*s, así que un "103 %" en un PNG
// de 327x505 era en realidad un 102,8 % de su exportador, y la frase
// corregía el desplazamiento pero dejaba la escala mintiendo.
function vestInstruccionParaElArchivo(ajuste, w, h) {
  const a = vestNormalizarAjuste(ajuste);

  if (!w || !h) return "No se pudo leer el tamaño de este PNG, así que no se puede ajustar.";

  if (vestEsNeutro(a)) {
    return a.alLienzo
      ? "Exportá el dibujo en un lienzo de " + VEST_LIENZO_ANCHO + "×" + VEST_LIENZO_ALTO +
        " y no hará falta rehacerlo."
      : "No moviste nada: se sube tu archivo tal cual.";
  }

  const pasos = [];
  if (a.dx) pasos.push("mové el dibujo " + Math.abs(a.dx) + " px a la " + (a.dx > 0 ? "derecha" : "izquierda"));
  if (a.dy) pasos.push((pasos.length ? "" : "mové el dibujo ") + Math.abs(a.dy) + " px " + (a.dy > 0 ? "abajo" : "arriba"));
  if (a.escala !== 100) pasos.push("exportalo al " + a.escala + " %");
  if (a.espejo) pasos.push("espejalo en horizontal");

  return "En tu archivo: " + pasos.join(", ") + ".";
}


// ---------- LOS DOS PESOS ----------

// Bytes del PNG YA DECODIFICADO. Es lo que se compara con el tope de 1 MB
// por prenda, porque es lo que el servidor mide después de hacer el
// Buffer.from(base64) (api/content.js:144).
function vestPesoDeDataUrl(texto) {
  const s = String(texto || "");
  const i = s.indexOf(",");
  if (i === -1) return 0;
  const b64 = s.slice(i + 1);
  let relleno = 0;
  if (b64.endsWith("==")) relleno = 2;
  else if (b64.endsWith("=")) relleno = 1;
  return Math.max(0, Math.floor(b64.length / 4) * 3 - relleno);
}

// Bytes de la CADENA que viaja por la red. Son dos funciones distintas a
// propósito: server.js:126 corta el cuerpo por bytes RECIBIDOS, y lo que
// se recibe es el base64, que abulta un tercio más que el PNG. Confundir
// las dos manda 12 MB creyendo que son 9, y el servidor corta la subida
// con un 413 que no explica nada.
function vestBytesDeCuerpo(texto) {
  return String(texto || "").length;
}


// ==============================
// ZONA B — LA PANTALLA
// ==============================
// (todavía no existe: llega en el paso siguiente)

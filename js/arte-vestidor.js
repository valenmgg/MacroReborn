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

// Un suelo para el encaje. Si la columna llegara absurdamente estrecha,
// escalar a cero dejaría el lienzo invisible en vez de pequeño.
const VEST_ZOOM_MINIMO = 0.1;

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


// ---------- QUE EL LIENZO QUEPA EN SU COLUMNA ----------

// El zoom que de verdad se aplica: el que pidió la persona, salvo que no
// quepa de ancho donde tiene que dibujarse.
//
// Hace falta porque el marco del lienzo lleva flex-shrink:0, y tiene que
// llevarlo: es la caja clavada de 327x504 sobre la que se hace TODA la
// aritmética de esta zona. Una caja que no se encoge dentro de una columna
// que sí, sobresale. Y como .vest-escena rueda en vertical, el CSS le
// convierte el eje horizontal en auto por su cuenta y aparece la barra.
//
// Se mira SOLO el ancho. Que sobre alto y haya que bajar rodando está
// bien; lo que no se quiere es rodar de lado.
//
// Con ancho 0 no se encoge nada. Pasa en jsdom, que no maqueta, y pasa
// mientras el panel está escondido: encoger contra un ancho que todavía no
// se sabe dejaría el lienzo hecho un sello.
function vestEncajeDeVista(disponible, zoom) {
  const z = Number(zoom) > 0 ? Number(zoom) : 1;
  const d = Number(disponible);
  if (!(d > 0)) return z;

  const cabe = d / VEST_LIENZO_ANCHO;
  // A tres decimales: el ancho disponible se mueve de a un píxel cuando
  // aparece y desaparece una barra vertical, y sin redondear el lienzo
  // temblaría a cada cambio.
  const escala = Math.round(Math.min(z, cabe) * 1000) / 1000;
  return Math.max(VEST_ZOOM_MINIMO, escala);
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
//
// El espejo hay que aplicarlo aquí también, y sobre LA MISMA RECTA que usa
// el horno (el centro del rectángulo, no el del lienzo). Sin esto, la caja
// sale sin reflejar mientras el dibujo sí se refleja, y el aviso de
// recorte señala el lado contrario: con la tinta pegada al borde izquierdo
// y un ajuste {dx:-30, espejo:true} avisaría de 30 px perdidos por la
// izquierda cuando no se pierde ninguno, y callaría los 30 que sí se
// pierden por la derecha con {dx:+30, espejo:true}.
function vestCajaEnLienzo(caja, w, h, ajuste) {
  const e = vestEncuadrePegado(w, h, ajuste);
  const k = w ? e.ancho / w : 1;
  const j = h ? e.alto / h : 1;

  const ancho = (caja.ancho || 0) * k;
  const alto = (caja.alto || 0) * j;
  let x = e.x + (caja.x || 0) * k;
  const y = e.y + (caja.y || 0) * j;

  if (e.espejo) {
    const cx = e.x + e.ancho / 2;
    x = 2 * cx - (x + ancho);
  }

  return { x, y, ancho, alto, espejo: e.espejo };
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
// La escala es exacta y no hay que dividirla por nada, que es justo lo
// que la base pegada compró: con el encaje como base el ancho dibujado
// era w*k*s, así que un "103 %" sobre un PNG de 327x505 era en realidad
// un 102,8 % de su exportador.
//
// Pero EL ORDEN DE LOS PASOS IMPORTA, y por eso la frase lo dice. En
// vestEncuadrePegado el desplazamiento se suma DESPUÉS de escalar, y el
// espejo refleja sobre el centro del rectángulo ya desplazado. O sea que
// dx y dy están medidos en píxeles de la EXPORTACIÓN, no del archivo de
// partida: a escala 100 son la misma cosa -que es el caso de todo el
// catálogo menos tres dibujos-, pero al 50 % no. Un artista que leyera
// "mové 40 px y exportá al 50 %" y lo hiciera en ese orden acabaría con
// el dibujo a la mitad de camino.
//
// Se resuelve diciendo el orden en vez de convirtiendo los números,
// porque convertirlos obligaría a redondear y el artista teclearía una
// cifra que ya no es la que ve en pantalla.
function vestInstruccionParaElArchivo(ajuste, w, h) {
  const a = vestNormalizarAjuste(ajuste);

  if (!w || !h) return "No se pudo leer el tamaño de este PNG, así que no se puede ajustar.";

  if (vestEsNeutro(a)) {
    return a.alLienzo
      ? "Exportá el dibujo en un lienzo de " + VEST_LIENZO_ANCHO + "×" + VEST_LIENZO_ALTO +
        " y no hará falta rehacerlo."
      : "No moviste nada: se sube tu archivo tal cual.";
  }

  // El mismo orden en que lo hace el horno: espejar, escalar, mover.
  const pasos = [];
  if (a.espejo) pasos.push("espejá el dibujo en horizontal");
  if (a.escala !== 100) pasos.push("exportalo al " + a.escala + " %");

  const mover = [];
  if (a.dx) mover.push(Math.abs(a.dx) + " px a la " + (a.dx > 0 ? "derecha" : "izquierda"));
  if (a.dy) mover.push(Math.abs(a.dy) + " px " + (a.dy > 0 ? "abajo" : "arriba"));
  if (mover.length) {
    pasos.push("movelo " + mover.join(" y ") +
      (a.escala === 100 ? "" : " sobre esa exportación"));
  }

  // "Por este orden" solo cuando hay más de un paso que ordenar.
  return "En tu archivo" + (pasos.length > 1 ? ", por este orden: " : ": ") +
    pasos.join(", ") + ".";
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
// De acá para abajo sí hay navegador. Todo vive dentro de un IIFE que no
// ejecuta nada al cargarse -a diferencia de js/arte.js, que termina
// llamando a cargarPanel()- y que expone un único global,
// window.MacroVestidor. Quien lo arranca es js/arte.js.
//
// De momento solo está el horno, que es lo que js/arte.js necesita para
// publicar. El maniquí llega en el paso siguiente.

(function (window) {
  "use strict";

  const document = window.document;

  // ---------- DECODIFICAR ----------

  // El onerror resuelve null en vez de lanzar, igual que hace
  // _cargarImagenAvatarParaCanvas en js/core.js: una imagen ilegible no
  // debe tirar abajo la tanda entera.
  //
  // Es un data: URL del mismo origen, así que no ensucia el canvas y no
  // hace falta crossOrigin.
  function cargarImagen(dataUrl) {
    return new Promise(resolve => {
      const img = new window.Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  // ---------- EL HORNO ----------

  async function hornearPrenda(item) {
    // Sin medidas no se hornea: vestAnclaje(0,0) daría un rectángulo
    // degenerado y saldría un PNG vacío con el identificador ya gastado.
    if (!vestPuedeAjustarse(item)) {
      return { error: "No se pudo leer la medida del PNG: no se puede hornear el ajuste" };
    }

    const img = await cargarImagen(item.dataUrl);
    if (!img) {
      return { error: "No se pudo leer este PNG: no se puede hornear el ajuste" };
    }

    // EL LIENZO ES FIJO. 327x504 siempre, nunca img.naturalWidth.
    //
    // Es lo que hace que la caja de recorte del horno sea la MISMA que el
    // overflow:hidden del escenario: lo que el artista ve caer fuera del
    // marco es exactamente lo que este canvas tira. Si el lienzo siguiera
    // la medida del archivo, el borde real quedaría dentro del marco, en
    // una línea invisible, y se vería el dibujo entero mientras se
    // publica uno cortado.
    //
    // Que el destino sea fijo NO obliga a remuestrear: lo que evita el
    // remuestreo es el anclaje entero de vestAnclaje() con escala 100.
    const canvas = document.createElement("canvas");
    canvas.width = VEST_LIENZO_ANCHO;
    canvas.height = VEST_LIENZO_ALTO;

    // SIN CANVAS NO SE PUBLICA EN SILENCIO.
    //
    // jsdom devuelve null sin lanzar, y también un navegador con el
    // canvas intervenido (Tor, Firefox con resistFingerprinting, varias
    // extensiones). Acá NO se cae de vuelta a item.dataUrl: el artista
    // colocó la prenda, vio sus números, pulsó Publicar, y recibiría un
    // tick verde sobre el PNG SIN AJUSTAR, con su identificador ya
    // gastado y sin forma de corregirlo. Publicar algo distinto de lo
    // que el artista aprobó es peor que no publicar.
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return { error: "Este navegador no deja hornear el ajuste (canvas bloqueado)" };
    }

    // El canvas nace transparente, pero decirlo cuesta cero y documenta
    // que el fondo NO es blanco: es lo que hace que rellenar un 326x503
    // hasta el lienzo deje píxeles transparentes y no una franja negra.
    ctx.clearRect(0, 0, VEST_LIENZO_ANCHO, VEST_LIENZO_ALTO);

    // El suavizado solo entra en juego cuando de verdad hay que
    // remuestrear, o sea con escala distinta de 100: a escala 100 el
    // dibujo se copia píxel a píxel y el interpolador ni se consulta.
    // Se pide "high" porque las pocas veces que se usa -los tres dibujos
    // del catálogo que necesitan el preset "Encajar"- son reducciones
    // grandes, y ahí la diferencia entre el filtro rápido y el bueno se
    // ve a simple vista en los bordes de línea.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // LA MISMA CUENTA. Sin recalcular, sin volver a redondear, sin
    // "ajustar un poquito". Se llama a vestEncuadrePegado y no a
    // vestEncuadreDeCapa solo porque acá ya sabemos que hay que hornear:
    // en esta rama son la misma cosa, y hay una prueba que lo afirma.
    const e = vestEncuadrePegado(item.ancho, item.alto, item.ajuste);

    // Nunca ctx.rotate: no hay rotación, porque interpolar rota mal el
    // dibujo de línea limpia. Mover de a píxeles enteros y espejar con
    // scale(-1,1) son exactos.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (e.espejo) {
      // La reflexión va sobre la vertical que pasa por el centro del
      // rectángulo, que es la misma recta que usa el transform-origin
      // por defecto del scaleX(-1) del DOM.
      const cx = e.x + e.ancho / 2;
      ctx.save();
      ctx.translate(cx, 0);
      ctx.scale(-1, 1);
      ctx.translate(-cx, 0);
    }
    ctx.drawImage(img, e.x, e.y, e.ancho, e.alto);
    if (e.espejo) ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // toDataURL y no toBlob + createObjectURL: la expresión de
    // api/content.js:132 exige exactamente data:image/png;base64,<b64>,
    // sin ";charset", sin espacios y sin saltos de línea.
    const texto = canvas.toDataURL("image/png");
    if (typeof texto !== "string" || !VEST_DATA_PNG.test(texto)) {
      return { error: "El navegador no devolvió un PNG válido" };
    }

    // El tope de 1 MB, comprobado acá. El canvas reencoda sin las
    // optimizaciones del exportador del artista, así que un dibujo
    // pesado puede pasarse del tope del servidor. Comprobarlo antes
    // ahorra un viaje de red y hace que la noticia llegue mientras el
    // artista está mirando la prenda.
    const bytes = vestPesoDeDataUrl(texto);
    if (bytes > VEST_TOPE_PRENDA) {
      return {
        error: "El horneado pesa " + Math.round(bytes / 1024) +
          " kB y el tope es 1 MB: bajá la escala o exportá el PNG con menos colores"
      };
    }

    // "exacto" es si el horneado fue un calco o hubo que interpolar. Lo
    // usa el panel para decir en voz alta las pocas veces que remuestrea.
    const exacto = Number.isInteger(e.x) && Number.isInteger(e.y) &&
      e.ancho === item.ancho && e.alto === item.alto;

    return { texto, horneado: true, bytes, exacto };
  }

  // ---------- LA ÚNICA PUERTA HACIA js/arte.js ----------

  async function pngDeSubida(item) {
    // El artista no movió nada: van los bytes originales, intactos.
    //
    // Es el primer if a propósito. Los bytes que leyó el FileReader son
    // los que el servidor hashea para reusar la fila de avatar_archivos.
    // Cualquier ida y vuelta por toDataURL vuelve a comprimir el PNG,
    // cambia sus bytes aunque los píxeles sean idénticos, cambia el
    // sha256 y crea un archivo duplicado. Ahí se pierde que un mismo
    // fondo compartido por seis personajes ocupe UNA fila y no seis.
    //
    // Vale también cuando el PNG no mide el lienzo: si no se tocó, se
    // sube tal cual, exactamente como hasta ahora. La salida es el botón
    // "Llevar al lienzo", que es un acto deliberado del artista.
    //
    // Acá NO se crea ni se toca un <canvas>, y hay una prueba que lo
    // comprueba espiando document.createElement.
    if (!vestHayQueHornear(item)) {
      return { texto: item.dataUrl, horneado: false };
    }
    return hornearPrenda(item);
  }

  // ==============================
  // EL MANIQUÍ
  // ==============================

  const $ = id => document.getElementById(id);

  // Lo que js/arte.js nos presta. Son GETTERS y no los objetos, porque
  // publicar() reasigna tanto DATOS como ARCHIVOS: con una referencia
  // guardada, el vestidor abierto después de publicar seguiría enseñando
  // el catálogo viejo y una lista fantasma, justo cuando más se mira.
  let CTX = null;

  let abierto = false;

  // Si AHORA MISMO se puede mover la prenda con el ratón o el teclado.
  //
  // Nace en true a propósito: el vestidor no sabe que los pasos existen y
  // tiene que seguir siendo usable solo. Es el taller quien lo apaga fuera
  // del paso de colocar, con permitirAjuste().
  let ajustable = true;

  // A dónde se va al cerrar y al terminar de publicar.
  //
  // Es una variable con puerta trasera y no un window.location suelto por
  // un motivo concreto: jsdom no navega. Sin esto no habría forma de
  // comprobar en las pruebas que se sale al sitio correcto, y cada prueba
  // que cierra el taller ensuciaría la consola con un "Not implemented:
  // navigation" que además rompe el test que exige la consola limpia.
  let salir = url => { window.location.href = url; };
  function alSalir(fn) { if (typeof fn === "function") salir = fn; }

  // Quién quiere enterarse de que una publicación terminó, y de cómo fue.
  let avisoDePublicar = null;
  function alPublicar(fn) { avisoDePublicar = fn; }

  const enElTaller = () =>
    document.body && document.body.classList.contains("taller-pagina");
  let modeloActual = null;      // el personaje que lleva puesto el maniquí
  let puesto = {};              // capa -> valor del catálogo
  let montadas = [];            // claves de las prendas en prueba, en orden
  let ranuraAbierta = null;
  let pintadas = 0;             // cuántas opciones lleva pintadas la rejilla
  const capas = {};             // capa -> el <img> de esa capa
  const fondos = ["", "vest-fondo-blanco", "vest-fondo-negro", "vest-fondo-magenta"];
  let fondo = 0;
  let zoom = 1;

  const TOPE_REJILLA = 60;
  const MAS_REJILLA = 40;

  // Las 15 capas salen de js/core.js, que se carga antes que este archivo.
  // Si no está, el vestidor no puede dibujar nada y lo dice en vez de
  // inventarse su propia lista: once archivos del sitio llevaban una copia
  // de esta lista y dos de ellos la tenían en otro orden, así que el mismo
  // avatar se dibujaba distinto según la página.
  function ordenDeCapas() {
    return typeof ORDEN_CAPAS_AVATAR !== "undefined" ? ORDEN_CAPAS_AVATAR : null;
  }

  function vaciar(nodo) {
    while (nodo && nodo.firstChild) nodo.removeChild(nodo.firstChild);
  }

  // Esconde o destapa lo que EXISTA. El maniqui vive en dos paginas y
  // cada una tiene su marco: arte.html trae las secciones hermanas del
  // panel clasico, taller.html no.
  function esconder(ids, si) {
    for (const id of ids) {
      const caja = $(id);
      if (caja) caja.hidden = si;
    }
  }

  function elem(tag, clase, texto) {
    const n = document.createElement(tag);
    if (clase) n.className = clase;
    if (texto !== undefined && texto !== null) n.textContent = String(texto);
    return n;
  }

  // ---------- QUÉ VA EN CADA RANURA ----------

  // Una prenda EN PRUEBA gana a una del catálogo, y entre dos en prueba
  // gana la última montada: una ranura, una prenda, igual que en el avatar
  // de verdad. La que pierde se marca en el rail.
  function pruebaDeRanura(capa) {
    if (!CTX) return null;
    const lista = CTX.archivos();
    for (let i = montadas.length - 1; i >= 0; i--) {
      const item = lista.find(a => a.clave === montadas[i]);
      if (item && item.capa === capa) return item;
    }
    return null;
  }

  // Devuelve lo que hay que dibujar en esa capa, ya en la forma que espera
  // vestEncuadreDeCapa: { url, ancho, alto, ajuste }.
  function fuenteDeRanura(capa) {
    const prueba = pruebaDeRanura(capa);
    if (prueba) {
      return {
        url: prueba.dataUrl,
        ancho: prueba.ancho,
        alto: prueba.alto,
        ajuste: prueba.ajuste || null,
        esPrueba: true,
        puedeAjustarse: vestPuedeAjustarse(prueba)
      };
    }

    const valor = capa === "modelo" ? modeloActual : puesto[capa];
    if (!valor) return null;

    const datos = CTX.datos();
    const p = (capa === "modelo" ? datos.modelos : datos.prendas)
      .find(x => x.valor === valor);
    if (!p) return null;

    // Las del catálogo se suben tal cual, así que se pintan como las va a
    // pintar el sitio: encajadas. Las medidas vienen del servidor en una
    // cadena "332x512".
    const m = vestMedidasDeTexto(p.medidas);
    return { url: p.url, ancho: m.ancho, alto: m.alto, ajuste: null, esPrueba: false };
  }

  // ---------- EL ESCENARIO ----------

  // Las 15 capas se crean UNA vez. Después solo se les cambia el src, el
  // hidden y las cuatro medidas en línea.
  //
  // No se vuelven a crear nunca, y eso importa por tres motivos: no hay
  // que reinsertar nodos en cada movimiento del ratón; no dispara el
  // MutationObserver de js/core.js, que ante cualquier nodo nuevo reescanea
  // el DOCUMENTO ENTERO buscando avatares que componer (y en arte.html hay
  // avatares compuestos rondando, los mete navbar.js); y reasignar data-src
  // sobre un nodo ya insertado no lo recoge nadie, porque ese observador
  // solo mira childList.
  function montarEscenario() {
    const lienzo = $("vestLienzo");
    const overlay = lienzo.querySelector(".vest-overlay");
    const orden = ordenDeCapas();

    for (const capa of orden) {
      const img = document.createElement("img");
      img.className = "vest-capa";
      img.alt = "";
      img.hidden = true;
      img.dataset.ranura = capa;
      // El orden del DOM es el orden de pintado, así que no hace falta ni
      // un z-index. Y va antes del overlay, que tiene que quedar encima.
      lienzo.insertBefore(img, overlay);
      capas[capa] = img;
    }
  }

  function refrescarCapa(capa) {
    const img = capas[capa];
    if (!img) return;

    const f = fuenteDeRanura(capa);
    if (!f || !f.url) {
      img.hidden = true;
      img.removeAttribute("src");
      // Y se le quitan también las medidas, y eso es la otra mitad.
      //
      // Un <img> sin src pero con 233x359 puestos a mano sigue siendo una
      // caja con su sitio en la maqueta. Sin medidas mide 0x0: es como
      // nace en montarEscenario, y por eso una capa que no se había usado
      // nunca no dejaba nada y una usada sí. Quien la esconde de verdad es
      // .mr-root img[hidden] en css/inicio.css; esto es el cinturón por si
      // alguien vuelve a escribirle un display a las imágenes y lo desarma
      // otra vez.
      img.style.left = "";
      img.style.top = "";
      img.style.width = "";
      img.style.height = "";
      img.style.transform = "";
      return;
    }

    const e = vestEstiloDeCapa(f);
    img.style.left = e.left;
    img.style.top = e.top;
    img.style.width = e.width;
    img.style.height = e.height;
    img.style.transform = e.transform;

    // src pelado y no data-src: esto SIEMPRE se ve -es lo que el artista
    // está mirando- y encima son 15 imágenes contadas, no una lista.
    if (img.getAttribute("src") !== f.url) {
      img.src = f.url;

      // Estas 15 <img> se REUSAN: la misma capa "pelo" va cambiando de
      // prenda toda la tarde. Si una no cargó, js/core.js la esconde con
      // display:none para que no quede la marca de imagen rota, y esa
      // marca sobrevive al cambio de src. Sin esto, una sola prenda que
      // fallara dejaba esa ranura muerta hasta recargar la página.
      if (img.dataset.capaRota) {
        delete img.dataset.capaRota;
        img.style.display = "";
      }
    }
    img.hidden = false;
  }

  function refrescarEscenario() {
    for (const capa of ordenDeCapas()) refrescarCapa(capa);
    pintarRanuras();
    pintarContador();
  }

  // ---------- EL PERSONAJE ----------

  function pintarPersonajes() {
    const select = $("vestPersonaje");
    vaciar(select);
    for (const m of CTX.datos().modelos) {
      const o = document.createElement("option");
      o.value = m.valor;
      o.textContent = CTX.conMayuscula(m.valor);
      select.appendChild(o);
    }
    if (!modeloActual && select.options.length) modeloActual = select.options[0].value;
    select.value = modeloActual;
  }

  // Cambiar de personaje DESNUDA el maniquí: el guardarropa de uno no le
  // sirve a otro, que es la misma regla del editor de perfil. Pero no toca
  // las prendas en prueba, que llevan su propio personaje; si alguna es de
  // otro, el rail lo dice.
  function alCambiarPersonaje() {
    modeloActual = $("vestPersonaje").value;
    puesto = {};
    ranuraAbierta = null;
    refrescarEscenario();
    pintarRejilla();
    pintarPruebas();
  }

  // ---------- LAS RANURAS ----------

  function prendasDe(capa) {
    const datos = CTX.datos();
    const incluirRetiradas = $("vestRetiradas").checked;
    return datos.prendas.filter(p =>
      p.capa === capa && p.modelo === modeloActual && (p.publicada || incluirRetiradas));
  }

  function pintarRanuras() {
    const caja = $("vestRanuras");
    vaciar(caja);

    for (const capa of ordenDeCapas()) {
      const b = elem("button", "vest-ranura", CTX.conMayuscula(capa));
      b.type = "button";

      const ocupada = capa === "modelo" || !!puesto[capa] || !!pruebaDeRanura(capa);
      if (ocupada) b.classList.add("ocupada");

      // La ranura "modelo" se pinta pero no se abre: avatar-panel no la
      // ofrece (capas viene ya sin ella) y avatar-subir-prendas contesta
      // "Esa ranura no existe" si se le manda. Ofrecerla dejaría meter una
      // prenda local en una ranura que la API rechaza justo al publicar.
      if (capa === "modelo") {
        b.disabled = true;
        b.title = "El personaje se cambia con el desplegable de arriba";
      } else {
        b.setAttribute("aria-pressed", String(ranuraAbierta === capa));
        b.addEventListener("click", () => abrirRanura(capa));
      }

      caja.appendChild(b);
    }
  }

  function abrirRanura(capa) {
    ranuraAbierta = ranuraAbierta === capa ? null : capa;
    pintarRanuras();
    pintarRejilla();
  }

  // ---------- EL GUARDARROPA ----------

  function pintarRejilla(añadir) {
    const rejilla = $("vestRejilla");
    const buscar = $("vestBuscar");
    const retiradas = $("vestRetiradasCaja");
    const mas = $("vestMas");

    if (!ranuraAbierta) {
      vaciar(rejilla);
      buscar.hidden = true;
      retiradas.hidden = true;
      mas.hidden = true;
      return;
    }

    buscar.hidden = false;
    retiradas.hidden = false;

    const todas = prendasDe(ranuraAbierta);
    pintadas = añadir ? pintadas + MAS_REJILLA : TOPE_REJILLA;

    vaciar(rejilla);

    // "Ninguna", para quitar lo que haya puesto sin tener que desnudar todo.
    rejilla.appendChild(opcionVacia());

    for (const p of todas.slice(0, pintadas)) rejilla.appendChild(opcion(p));

    mas.hidden = todas.length <= pintadas;
    mas.textContent = "Ver " + Math.min(MAS_REJILLA, todas.length - pintadas) + " más";

    // A MANO, y no esperando al MutationObserver de js/core.js: el return
    // de ese callback sale de TODO el lote de mutaciones, no del bucle, así
    // que si en el mismo lote entra antes un .avatar-compuesto -y navbar.js
    // los mete en esta página- los nodos posteriores nunca pasan por acá y
    // sus data-src se quedan en blanco para siempre. Es barato y se puede
    // llamar las veces que haga falta.
    if (typeof activarImagenesPerezosas === "function") activarImagenesPerezosas(rejilla);

    aplicarBusqueda();
  }

  function opcionVacia() {
    const b = elem("button", "vest-opcion");
    b.type = "button";
    b.setAttribute("aria-pressed", String(!puesto[ranuraAbierta]));
    const hueco = elem("div");
    hueco.style.aspectRatio = "327 / 504";
    b.appendChild(hueco);
    b.appendChild(elem("span", null, "Ninguna"));
    b.addEventListener("click", () => elegirPrenda(null));
    return b;
  }

  function opcion(p) {
    const b = elem("button", "vest-opcion");
    b.type = "button";
    b.dataset.valor = p.valor;
    b.dataset.busca = (p.nombre + " " + p.valor).toLowerCase();
    b.setAttribute("aria-pressed", String(puesto[ranuraAbierta] === p.valor));

    // UN solo <img>, y con data-src. Un solo dibujo por casilla y no dos
    // (prenda sobre personaje): el personaje base es el mismo en las
    // sesenta casillas, no aporta nada y duplicaría la red. El maniquí,
    // que es el personaje de verdad, está a un palmo a la izquierda.
    const img = document.createElement("img");
    img.dataset.src = p.url;
    img.alt = "";
    img.loading = "lazy";
    b.appendChild(img);

    const nombre = p.nombre + (p.publicada ? "" : " (retirada)");
    b.appendChild(elem("span", null, nombre));
    b.title = nombre + " · " + p.medidas;

    b.addEventListener("click", () => elegirPrenda(p.valor));
    return b;
  }

  function elegirPrenda(valor) {
    if (!ranuraAbierta) return;
    if (valor === null) delete puesto[ranuraAbierta];
    else puesto[ranuraAbierta] = valor;
    refrescarEscenario();
    pintarRejilla();
  }

  // Filtra moviendo display sobre lo ya pintado, sin repintar nada.
  function aplicarBusqueda() {
    const texto = $("vestBuscar").value.trim().toLowerCase();
    for (const b of $("vestRejilla").querySelectorAll(".vest-opcion[data-busca]")) {
      b.style.display = (!texto || b.dataset.busca.includes(texto)) ? "" : "none";
    }
  }

  // ---------- VESTIR DE UNA ----------

  function desnudar() {
    puesto = {};
    refrescarEscenario();
    pintarRejilla();
  }

  // Nadie juzga una remera sobre un muñeco desnudo.
  function loBasico() {
    puesto = {};
    for (const capa of ["piel", "ojos", "boca", "pelo"]) {
      const primera = prendasDe(capa)[0];
      if (primera) puesto[capa] = primera.valor;
    }
    refrescarEscenario();
    pintarRejilla();
  }

  // Ver la prenda nueva contra diez conjuntos en veinte segundos es la
  // forma más rápida de descubrir que choca con el pelo.
  function alAzar() {
    puesto = {};
    for (const capa of ordenDeCapas()) {
      if (capa === "modelo") continue;
      const hay = prendasDe(capa);
      if (!hay.length) continue;
      // Las capas opcionales no siempre se ponen; las de cuerpo, sí.
      const obligatoria = ["piel", "ojos", "boca", "pelo"].indexOf(capa) !== -1;
      if (!obligatoria && Math.random() < 0.45) continue;
      puesto[capa] = hay[Math.floor(Math.random() * hay.length)].valor;
    }
    refrescarEscenario();
    pintarRejilla();
  }

  // ---------- EL RAIL DE PRENDAS EN PRUEBA ----------

  function pintarPruebas() {
    const caja = $("vestPruebas");
    vaciar(caja);

    const lista = CTX ? CTX.archivos() : [];
    $("vestSinPruebas").hidden = lista.length > 0;

    // Toda prenda nueva nace elegida para publicar: lo normal es subir lo
    // que se acaba de probar, y desmarcar es más raro que marcar.
    const vivas = new Set(lista.map(a => a.clave));
    for (const c of [...elegidas]) if (!vivas.has(c)) elegidas.delete(c);
    for (const a of lista) if (!elegidas.has(a.clave)) elegidas.add(a.clave);

    for (const item of lista) caja.appendChild(filaDePrueba(item));
    pintarContador();
    pintarPie();
  }

  // ---------- EL PIE ----------

  function loElegido() {
    if (!CTX) return [];
    return CTX.archivos().filter(a => elegidas.has(a.clave));
  }

  function pintarPie() {
    const pie = $("vestPie");
    const boton = $("vestPublicar");
    const elegidasAhora = loElegido();

    pie.hidden = !CTX || CTX.archivos().length === 0;
    boton.disabled = elegidasAhora.length === 0;
    boton.textContent = elegidasAhora.length === 1
      ? "Publicar 1 prenda"
      : "Publicar " + elegidasAhora.length + " prendas";

    const rotas = elegidasAhora.filter(a => !vestPuedeAjustarse(a) && vestHayQueHornear(a));
    const conAjuste = elegidasAhora.filter(a => vestHayQueHornear(a)).length;
    const descuadradas = elegidasAhora.filter(a =>
      vestPuedeAjustarse(a) && !vestHayQueHornear(a) &&
      (a.ancho !== VEST_LIENZO_ANCHO || a.alto !== VEST_LIENZO_ALTO));

    const dice = [];
    if (conAjuste) dice.push(conAjuste + " con el ajuste horneado dentro del PNG");
    if (elegidasAhora.length - conAjuste) {
      dice.push((elegidasAhora.length - conAjuste) + " tal cual, sin tocar un byte");
    }
    $("vestResumen").textContent = dice.join(" · ");

    // El aviso, con nombres: no se bloquea nada, pero se dice antes de
    // pulsar y no después. Publicar es irreversible en lo que importa: el
    // identificador que gasta una prenda no vuelve nunca.
    const aviso = $("vestAvisoLienzo");
    vaciar(aviso);
    if (descuadradas.length || rotas.length) {
      aviso.hidden = false;
      if (descuadradas.length) {
        aviso.appendChild(elem("h2", null, "Se van a subir tal cual, sin llevar al lienzo"));
        aviso.appendChild(elem("p", null,
          descuadradas.map(a => a.archivo + " (" + a.ancho + "×" + a.alto + ")").join(", ") +
          ". El sitio las encajará, que es lo que hace hoy con el arte que no mide " +
          VEST_LIENZO_ANCHO + "×" + VEST_LIENZO_ALTO + ". Si preferís arreglarlas, " +
          "elegí cada una y pulsá Llevar al lienzo."));
      }
      if (rotas.length) {
        aviso.appendChild(elem("h2", null, "Estas no se van a poder hornear"));
        aviso.appendChild(elem("p", null,
          rotas.map(a => a.archivo).join(", ") +
          ". No se pudo leer su tamaño, así que el ajuste no se puede dibujar dentro."));
      }
    } else {
      aviso.hidden = true;
    }
  }

  function filaDePrueba(item) {
    const fila = elem("div", "vest-prueba");
    const estaMontada = montadas.indexOf(item.clave) !== -1;
    if (item.clave === activa) fila.classList.add("vest-activa");
    if (!vestPuedeAjustarse(item)) fila.classList.add("vest-rota");

    // Tocar la fila elige esa prenda para ajustarla. La casilla de la
    // izquierda es otra cosa -ponérsela o quitársela al maniquí- y por eso
    // se para el evento ahí.
    fila.addEventListener("click", () => activar(item.clave));

    // La casilla elige qué se PUBLICA, que no es lo mismo que qué se ve:
    // se puede publicar media tanda y seguir probando la otra media. Hasta
    // ahora la única salida era pulsar Quitar en las demás, que borra su
    // ajuste sin vuelta atrás.
    const elegir = document.createElement("input");
    elegir.type = "checkbox";
    elegir.className = "vest-check";
    elegir.checked = elegidas.has(item.clave);
    elegir.title = "Publicar esta";
    elegir.addEventListener("change", () => {
      if (elegir.checked) elegidas.add(item.clave); else elegidas.delete(item.clave);
      pintarPie();
    });
    elegir.addEventListener("click", e => e.stopPropagation());
    fila.appendChild(elegir);

    const mini = document.createElement("img");
    mini.src = item.dataUrl;      // ya está en memoria: cero red
    mini.alt = "";
    fila.appendChild(mini);

    const datos = elem("div");
    datos.appendChild(elem("div", "nom", item.archivo));
    datos.appendChild(elem("div", "vest-dato",
      CTX.conMayuscula(item.modelo) + " · " + CTX.conMayuscula(item.capa)));

    // Si es de otro personaje, se dice: el editor solo enseña la ropa del
    // personaje que uno lleva puesto, así que probarla acá sobre otro
    // engaña.
    if (item.modelo !== modeloActual) {
      const aviso = elem("span", "vest-chip ojo",
        "es de " + CTX.conMayuscula(item.modelo));
      datos.appendChild(aviso);
    }

    if (!vestPuedeAjustarse(item)) {
      datos.appendChild(elem("span", "vest-chip mala", "no se pudo leer"));
    } else if (item.ancho !== VEST_LIENZO_ANCHO || item.alto !== VEST_LIENZO_ALTO) {
      datos.appendChild(elem("span", "vest-chip ojo", item.ancho + "×" + item.alto));
    }

    // Y si otra prueba le ganó la ranura, también.
    const gana = pruebaDeRanura(item.capa);
    if (estaMontada && gana && gana.clave !== item.clave) {
      datos.appendChild(elem("span", "vest-chip", "tapada por " + gana.archivo));
    }

    const ojo = elem("button", "vest-tecla", estaMontada ? "Quitar del maniquí" : "Ponérsela");
    ojo.type = "button";
    ojo.addEventListener("click", e => {
      e.stopPropagation();
      montar(item.clave, !estaMontada);
    });
    datos.appendChild(ojo);

    fila.appendChild(datos);
    return fila;
  }

  function montar(clave, si) {
    const i = montadas.indexOf(clave);
    if (si && i === -1) montadas.push(clave);
    if (!si && i !== -1) montadas.splice(i, 1);
    refrescarEscenario();
    pintarPruebas();
  }

  function pintarContador() {
    const lista = CTX ? CTX.archivos() : [];
    const conAjuste = lista.filter(a => a.ajuste && !vestEsNeutro(a.ajuste)).length;
    $("vestContador").textContent = lista.length
      ? lista.length + " en prueba · " + conAjuste + " con ajuste"
      : "";
  }

  // ==============================
  // EL AJUSTE
  // ==============================

  const elegidas = new Set();   // qué se publica cuando se pulsa Publicar
  let activa = null;        // clave de la prenda que se está ajustando
  const hechos = [];        // pila de deshacer: { clave, antes, despues }
  let deshechos = 0;        // cuántos de la pila están deshechos

  function itemActivo() {
    if (!CTX || !activa) return null;
    return CTX.archivos().find(a => a.clave === activa) || null;
  }

  // El ÚNICO sitio que escribe un ajuste. Todo lo demás -el teclado, los
  // campos, el arrastre, los presets- pasa por acá, así que deshacer no
  // tiene que enterarse de cada camino por separado.
  function cambiarAjuste(parcial, agrupar) {
    const item = itemActivo();
    if (!item || !vestPuedeAjustarse(item)) return;

    const antes = item.ajuste;

    // MOVER NO PUEDE CAMBIAR EL TAMAÑO.
    //
    // Una prenda sin ajuste se pinta ENCAJADA, porque es como la mostrará
    // el sitio si se sube tal cual. En cuanto recibe un ajuste se pinta
    // PEGADA 1:1, porque es como va a salir del horno. Las dos cosas son
    // ciertas, y esa es la puerta única de vestEncuadreDeCapa.
    //
    // Pero el salto entre las dos, en el primer píxel de movimiento, es
    // brutal para un PNG que no mida el lienzo. Medido con una captura de
    // pantalla de móvil, 1170x2532:
    //
    //   sin tocar   left=47px    ancho=232,9   alto=504     se ve entera
    //   +1 px       left=-420px  ancho=1170    alto=2532    se ve el medio
    //
    // O sea que el dibujo desaparece: el marco solo enseña un recorte
    // central a tamaño real, y si ese trozo es transparente -un borde, un
    // fondo, cualquier cosa con el centro vacío- no queda nada. Pasó de
    // verdad, y quien lo sufrió no tenía forma de entender por qué.
    //
    // Se arranca en la escala del encaje, así que el rectángulo NO se
    // mueve: para un 1170x2532 el encaje es el 20 %, y pegado al 20 % cae
    // en (47, -1,2) con 234x506, que es donde ya estaba. Para los 327x504
    // -cuatro de cada cinco dibujos del catálogo- el encaje es el 100 % y
    // no cambia absolutamente nada.
    const base = item.ajuste
      ? vestNormalizarAjuste(item.ajuste)
      : vestNormalizarAjuste({ escala: vestEscalaDeEncaje(item.ancho, item.alto) });

    const nuevo = vestNormalizarAjuste(Object.assign({}, base, parcial));

    // Volver al punto de partida deja el ajuste en null, no en un neutro
    // explícito: así "no moví nada" y "moví y volví" son exactamente lo
    // mismo, y el archivo se sube byte a byte en los dos casos.
    //
    // El punto de partida es el que se sembró arriba, o sea la escala del
    // encaje. Para un 327x504 eso es el 100 % y esto es literalmente la
    // regla de siempre; para un descuadrado, es la escala a la que se
    // empezó a mover, que es la única que deja el rectángulo quieto.
    const partida = vestEscalaDeEncaje(item.ancho, item.alto);
    const comoAlPrincipio = nuevo.dx === 0 && nuevo.dy === 0 &&
      nuevo.espejo === false && nuevo.alLienzo === false && nuevo.escala === partida;

    item.ajuste = comoAlPrincipio ? null : nuevo;

    // Un arrastre entero es UN paso de deshacer, no doscientos.
    const ultimo = hechos[hechos.length - 1];
    if (agrupar && ultimo && ultimo.clave === activa && ultimo.agrupa === agrupar) {
      ultimo.despues = item.ajuste;
    } else {
      hechos.length = hechos.length - deshechos;   // se pierde lo rehacible
      deshechos = 0;
      hechos.push({ clave: activa, antes, despues: item.ajuste, agrupa: agrupar || null });
      if (hechos.length > 60) hechos.shift();
    }

    tocado();
  }

  function aplicarPaso(paso, haciaAtras) {
    const item = CTX.archivos().find(a => a.clave === paso.clave);
    if (!item) return;
    item.ajuste = haciaAtras ? paso.antes : paso.despues;
    activa = paso.clave;
    tocado();
  }

  function deshacer() {
    const i = hechos.length - deshechos - 1;
    if (i < 0) return;
    deshechos++;
    aplicarPaso(hechos[i], true);
  }

  function rehacer() {
    if (!deshechos) return;
    const paso = hechos[hechos.length - deshechos];
    deshechos--;
    aplicarPaso(paso, false);
  }

  // Quien gobierne el maniqui desde fuera -el taller- necesita enterarse
  // cuando un ajuste cambia, o su puerta se queda con el texto viejo:
  // pulsabas "Llevar al lienzo", la prenda quedaba resuelta, y el boton de
  // Seguir seguia apagado diciendo "1 sin decidir".
  const oyentes = [];
  function alTocar(fn) { if (typeof fn === "function") oyentes.push(fn); }

  // Lo que hay que repintar cuando un ajuste cambia.
  function tocado() {
    refrescarEscenario();
    pintarPruebas();
    pintarAjuste();
    for (const fn of oyentes) { try { fn(); } catch (_) {} }
  }

  // ---------- LO QUE SE ENSEÑA DEL AJUSTE ----------

  function pintarAjuste() {
    const item = itemActivo();
    const caja = $("vestAjusteCaja");
    const recuadro = $("vestRecuadro");

    if (!item) {
      caja.hidden = true;
      recuadro.hidden = true;
      $("vestDestino").textContent = CTX && CTX.archivos().length
        ? "Elegí una prenda de la izquierda para ajustarla."
        : "";
      return;
    }

    caja.hidden = false;

    const a = vestNormalizarAjuste(item.ajuste);
    $("vestDx").value = String(a.dx);
    $("vestDy").value = String(a.dy);
    $("vestEscala").value = String(a.escala);
    $("vestEspejo").checked = a.espejo;

    const puede = vestPuedeAjustarse(item);
    for (const id of ["vestDx", "vestDy", "vestEscala", "vestEspejo"]) $(id).disabled = !puede;

    $("vestResumenAjuste").textContent = vestResumenDeAjuste(item.ajuste);
    $("vestInstruccion").textContent =
      vestInstruccionParaElArchivo(item.ajuste, item.ancho, item.alto);

    // El recuadro de la prenda activa, en las coordenadas del lienzo.
    if (montadas.indexOf(item.clave) !== -1 && puede) {
      const e = vestEncuadreDeCapa(item);
      recuadro.hidden = false;
      recuadro.style.left = e.x + "px";
      recuadro.style.top = e.y + "px";
      recuadro.style.width = e.ancho + "px";
      recuadro.style.height = e.alto + "px";
    } else {
      recuadro.hidden = true;
    }

    pintarDestino(item);
    pintarPresets(item);
  }

  // La línea que dice a dónde va a parar el dibujo. Aparece con el PRIMER
  // ajuste y no al publicar: enterarse de que tu PNG mide 327x505 cuando
  // ya le diste a Publicar no sirve de nada.
  function pintarDestino(item) {
    if (!vestPuedeAjustarse(item)) {
      $("vestDestino").textContent = "No se pudo leer el tamaño de este PNG.";
      return;
    }

    const medidas = item.ancho + "×" + item.alto;

    if (!vestHayQueHornear(item)) {
      $("vestDestino").textContent = (item.ancho === VEST_LIENZO_ANCHO && item.alto === VEST_LIENZO_ALTO)
        ? medidas + " · se sube tal cual"
        : medidas + " · se sube tal cual, y el sitio lo encajará";
      return;
    }

    const r = vestRecorteDeAnclaje(item.ancho, item.alto);
    const partes = [medidas + " → " + VEST_LIENZO_ANCHO + "×" + VEST_LIENZO_ALTO];

    const recorta = ["izq", "der", "arriba", "abajo"]
      .filter(l => r.recorta[l]).map(l => r.recorta[l] + " px por " + nombreDeLado(l));
    const rellena = ["izq", "der", "arriba", "abajo"]
      .filter(l => r.rellena[l]).map(l => r.rellena[l] + " px por " + nombreDeLado(l));

    if (recorta.length) partes.push("recorta " + recorta.join(" y "));
    if (rellena.length) partes.push("rellena " + rellena.join(" y "));

    $("vestDestino").textContent = partes.join(" · ");
  }

  function nombreDeLado(l) {
    return l === "izq" ? "la izquierda" : l === "der" ? "la derecha" : l;
  }

  function pintarPresets(item) {
    const alLienzo = $("vestAlLienzo");
    const encajar = $("vestEncajar");
    const original = $("vestOriginal");

    const puede = vestPuedeAjustarse(item);
    const enMedida = item.ancho === VEST_LIENZO_ANCHO && item.alto === VEST_LIENZO_ALTO;

    alLienzo.hidden = !puede || enMedida;
    alLienzo.textContent = "Llevar a " + VEST_LIENZO_ANCHO + "×" + VEST_LIENZO_ALTO;

    // "Encajar" solo se ofrece cuando de verdad hace algo distinto de
    // llevar al lienzo, o sea cuando el encaje no da 100 %. Son tres
    // dibujos en todo el catálogo; para los demás, recortar o rellenar una
    // fila es exacto y encajar solo emborronaría.
    const pct = puede ? vestEscalaDeEncaje(item.ancho, item.alto) : 100;
    encajar.hidden = !puede || pct === 100;
    encajar.textContent = "Encajar (" + pct + " %) · remuestrea";
    encajar.dataset.pct = String(pct);

    original.hidden = !item.ajuste;
  }

  // ---------- CUÁNDO SE PUEDE AJUSTAR ----------

  // El taller lleva a la gente por seis pasos y sólo uno, el de colocar,
  // es para mover la prenda. En los otros el lienzo está para MIRAR: en el
  // de fichar se reparten ranuras y en el de probar se comparan conjuntos.
  // Un arrastre de más ahí cambiaba el dibujo sin que nadie lo notara, y el
  // ajuste se quedaba guardado hasta publicar.
  //
  // Se apagan las dos entradas que ESCRIBEN un ajuste -el ratón y las
  // teclas- y además se quita el cursor de agarrar, que si no el lienzo
  // sigue invitando a arrastrar algo que no se va a mover.
  //
  // Lo que NO se apaga: Escape, el fondo (b) y el conjunto al azar (r). No
  // tocan la prenda, son ayudas para mirar.
  function permitirAjuste(si) {
    ajustable = si !== false;
    const lienzo = $("vestLienzo");
    if (lienzo) lienzo.classList.toggle("vest-quieto", !ajustable);
  }

  // ---------- EL ARRASTRE ----------

  // De píxeles de pantalla a píxeles del lienzo. Con el zoom, el lienzo
  // mide 327*zoom en pantalla, así que el factor es 1/zoom.
  //
  // jsdom no maqueta y el rect mide 0: dividir daría Infinity y cada
  // prueba de arrastre saldría NaN. Sin maquetación el factor es 1, que
  // además es lo correcto a zoom 1.
  function factorDePantalla() {
    const r = $("vestLienzo").getBoundingClientRect();
    return r.width ? (VEST_LIENZO_ANCHO / r.width) : 1;
  }

  let arrastre = null;

  function empezarArrastre(e) {
    if (!ajustable) return;
    const item = itemActivo();
    if (!item || !vestPuedeAjustarse(item)) return;
    if (montadas.indexOf(item.clave) === -1) return;

    const a = vestNormalizarAjuste(item.ajuste);
    arrastre = {
      id: e.pointerId,
      x0: e.clientX, y0: e.clientY,
      dx0: a.dx, dy0: a.dy,
      // El factor se CONGELA acá: si a media arrastre algo reflotara la
      // página -una chip que aparece, la barra que cambia de alto- el
      // mapa de pantalla a lienzo cambiaría a mitad del gesto.
      factor: factorDePantalla(),
      sello: "arrastre:" + e.pointerId + ":" + hechos.length
    };

    $("vestLienzo").classList.add("vest-arrastrando");
    try { $("vestLienzo").setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  }

  function moverArrastre(e) {
    if (!arrastre || e.pointerId !== arrastre.id) return;

    // Se redondea el delta TOTAL desde el pointerdown, NUNCA el de cada
    // evento. Acumulando deltas redondeados, un arrastre de N eventos
    // acumula hasta N/2 px de error: la prenda deriva y el número del
    // panel deja de corresponderse con lo que se ve.
    cambiarAjuste({
      dx: arrastre.dx0 + Math.round((e.clientX - arrastre.x0) * arrastre.factor),
      dy: arrastre.dy0 + Math.round((e.clientY - arrastre.y0) * arrastre.factor)
    }, arrastre.sello);

    e.preventDefault();
  }

  function soltarArrastre(e) {
    if (!arrastre || (e && e.pointerId !== arrastre.id)) return;
    try { $("vestLienzo").releasePointerCapture(arrastre.id); } catch (_) {}
    $("vestLienzo").classList.remove("vest-arrastrando");
    arrastre = null;
  }

  // ---------- EL TECLADO ----------

  function alTeclado(e) {
    if (!abierto) return;

    if (e.key === "Escape") { cerrar(); return; }

    // Si se está escribiendo en un campo, el teclado es del campo.
    const donde = e.target && e.target.tagName;
    if (donde === "INPUT" || donde === "SELECT" || donde === "TEXTAREA") return;

    // Deshacer también escribe un ajuste, así que va del lado apagado.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      if (!ajustable) return;
      if (e.shiftKey) rehacer(); else deshacer();
      e.preventDefault();
      return;
    }

    // El fondo y el conjunto al azar son para mirar: siguen valiendo.
    if (e.key.toLowerCase() === "b") { ciclarFondo(); return; }
    if (e.key.toLowerCase() === "r") { alAzar(); return; }

    if (!ajustable) return;

    const item = itemActivo();
    if (!item) return;

    const paso = e.shiftKey ? 10 : 1;
    const a = vestNormalizarAjuste(item.ajuste);

    if (e.key === "ArrowLeft") { cambiarAjuste({ dx: a.dx - paso }); e.preventDefault(); }
    else if (e.key === "ArrowRight") { cambiarAjuste({ dx: a.dx + paso }); e.preventDefault(); }
    else if (e.key === "ArrowUp") { cambiarAjuste({ dy: a.dy - paso }); e.preventDefault(); }
    else if (e.key === "ArrowDown") { cambiarAjuste({ dy: a.dy + paso }); e.preventDefault(); }
    else if (e.key.toLowerCase() === "e") { cambiarAjuste({ espejo: !a.espejo }); }
  }

  // ---------- ELEGIR QUÉ SE AJUSTA ----------

  function activar(clave) {
    activa = clave;

    // Ajustar algo que no se ve no tiene sentido: se monta sola Y se pone
    // DELANTE de las que compartan ranura.
    //
    // Lo de delante es la mitad que faltaba. pruebaDeRanura() recorre
    // montadas del final al principio y devuelve la primera que coincide,
    // así que quien está al final gana la ranura. Antes, montarla sólo
    // entraba si NO estaba montada ya, de modo que elegir una prenda que ya
    // llevaba puesta no la movía de sitio: seguía tapada.
    //
    // Y como el maniquí tiene quince capas y una <img> por capa, dos
    // prendas de la misma ranura no pueden verse a la vez. El resultado era
    // que se podía arrastrar una prenda -está montada, el arrastre la
    // acepta- sin ver moverse nada, y que aparecía «por arte de magia» al
    // tocar cualquier otra cosa que reordenara la lista.
    //
    // Pasa en cuanto se suben varios PNG cuyo nombre no empieza por una
    // ranura: capaDesdeArchivo() los archiva a todos en la primera de la
    // lista, que es «fondo».
    if (clave) {
      const i = montadas.indexOf(clave);
      if (i !== -1) montadas.splice(i, 1);
      montadas.push(clave);
    }

    tocado();
  }

  // ---------- LA VISTA ----------

  // El ancho del que dispone el lienzo. clientWidth y no el rectángulo:
  // clientWidth deja fuera la barra vertical, que es precisamente la que
  // hace que lo de dentro deje de caber.
  function anchoDeLaVista() {
    const lienzo = $("vestLienzo");
    const marco = lienzo && lienzo.parentNode;
    const columna = marco && marco.parentNode;
    return columna ? (columna.clientWidth || 0) : 0;
  }

  function aplicarZoom() {
    const lienzo = $("vestLienzo");

    // Se ajusta la INTENCIÓN, no solo el dibujo. Si se guardara un zoom
    // mayor del que entra, el botón de alejar no haría nada visible hasta
    // bajar por debajo del tope, y parecería roto.
    zoom = vestEncajeDeVista(anchoDeLaVista(), zoom);

    lienzo.parentNode.style.setProperty("--vest-zoom", String(zoom));
    lienzo.style.setProperty("--vest-zoom", String(zoom));
    lienzo.classList.toggle("vest-nitido", zoom >= 2);
    $("vestZoom").textContent = Math.round(zoom * 100) + " %";

    // Y el botón de acercar se apaga en el tope, que si no es un botón que
    // se pulsa y no pasa nada.
    const mas = $("vestZoomMas");
    if (mas) mas.disabled = zoom >= vestEncajeDeVista(anchoDeLaVista(), 4);
  }

  function cambiarZoom(paso) {
    zoom = Math.min(4, Math.max(0.5, Math.round((zoom + paso) * 10) / 10));
    aplicarZoom();
  }

  // La columna cambia de ancho al mover la ventana, al apilarse en el
  // teléfono y al aparecer la barra del rail de al lado. Cada vez hay que
  // volver a mirar si el lienzo cabe.
  //
  // No se realimenta: la pista de la rejilla es minmax(0, 1fr), así que su
  // ancho no depende de lo que mida el lienzo, y .vest-escena lleva
  // scrollbar-gutter:stable para que la barra vertical no lo mueva al
  // aparecer. Sin eso, encoger quitaría la barra, quitar la barra daría más
  // ancho, y el lienzo se pondría a latir.
  function vigilarElAncho() {
    const lienzo = $("vestLienzo");
    const marco = lienzo && lienzo.parentNode;
    const columna = marco && marco.parentNode;
    if (!columna) return;

    if (typeof ResizeObserver === "function") {
      new ResizeObserver(() => aplicarZoom()).observe(columna);
      return;
    }
    // jsdom no trae ResizeObserver, y navegadores viejos tampoco.
    window.addEventListener("resize", aplicarZoom);
  }

  function ciclarFondo() {
    const lienzo = $("vestLienzo");
    lienzo.classList.remove(...fondos.filter(Boolean));
    fondo = (fondo + 1) % fondos.length;
    if (fondos[fondo]) lienzo.classList.add(fondos[fondo]);
  }

  // ---------- ABRIR Y CERRAR ----------

  function abrir() {
    if (!CTX) return;

    if (!ordenDeCapas()) {
      window.alert("No se pudo cargar el orden de las capas (js/core.js). Recargá la página.");
      return;
    }

    if (!capas.modelo) montarEscenario();

    abierto = true;
    // Las secciones hermanas solo existen en arte.html. En taller.html la
    // pagina entera es el taller y no hay nada que esconder.
    esconder(["arteSubir", "arteCatalogo"], true);
    esconder(["vestPanel"], false);
    esconder(["vestAbrir"], true);

    pintarPersonajes();
    aplicarZoom();
    refrescarEscenario();
    pintarRejilla();
    pintarPruebas();
    pintarAjuste();

    $("arteVestidor").scrollIntoView({ block: "start" });
  }

  function cerrar() {
    // En taller.html no hay nada debajo del maniquí: la página ES el
    // taller. Cerrar ahí es volver al panel de arte, y por eso el enlace
    // que había en la cabecera sobraba.
    //
    // Con la cola llena se pregunta antes, y no por cortesía: esa cola vive
    // SÓLO en la memoria de esta pestaña. Salir se lleva por delante cada
    // ajuste colocado a mano, y a Cerrar se llega también con Escape.
    if (enElTaller()) {
      const cuantas = CTX ? CTX.archivos().length : 0;
      if (cuantas && !window.confirm(
        "Salir del taller con " + cuantas + " prenda(s) sin publicar." + "\n\n" +
        "Se pierden los ajustes que hayas colocado: todavía no están " +
        "guardadas en ninguna parte.")) return;
      salir("arte.html");
      return;
    }

    abierto = false;
    esconder(["vestPanel", "vestAbrir"], true);
    esconder(["vestAbrir"], false);
    esconder(["arteSubir", "arteCatalogo"], false);
    // Una sola vez: pintarLista() reconstruye la lista de subida entera.
    if (CTX && CTX.repintarLista) CTX.repintarLista();
  }

  // ---------- LA CONEXIÓN CON js/arte.js ----------

  function conectar(ctx) {
    // El maniqui vive en taller.html. Si este archivo acabara cargandose
    // en una pagina sin el, montarlo reventaria en el primer
    // addEventListener sobre null y se llevaria por delante el arranque.
    if (!$("vestLienzo")) return;

    CTX = ctx;

    $("vestAbrir").addEventListener("click", abrir);
    $("vestCerrar").addEventListener("click", cerrar);
    $("vestPersonaje").addEventListener("change", alCambiarPersonaje);
    $("vestRetiradas").addEventListener("change", () => pintarRejilla());
    $("vestBuscar").addEventListener("input", aplicarBusqueda);
    $("vestMas").addEventListener("click", () => pintarRejilla(true));
    $("vestDesnudar").addEventListener("click", desnudar);
    $("vestBasico").addEventListener("click", loBasico);
    $("vestAzar").addEventListener("click", alAzar);
    $("vestZoomMas").addEventListener("click", () => cambiarZoom(0.25));
    $("vestZoomMenos").addEventListener("click", () => cambiarZoom(-0.25));
    $("vestZoomUno").addEventListener("click", () => { zoom = 1; aplicarZoom(); });
    vigilarElAncho();
    $("vestFondo").addEventListener("click", ciclarFondo);

    $("vestPublicar").addEventListener("click", async () => {
      const lista = loElegido();
      if (!lista.length) return;
      const seguro = window.confirm(
        "Publicar " + lista.length + " prenda(s).\n\n" +
        "Aparecen en el editor de avatares enseguida. Retirarlas después se " +
        "puede, pero el identificador que gastan no vuelve nunca.");
      if (!seguro) return;

      // Se espera a que TERMINE. Antes el taller reaccionaba a este mismo
      // clic con un setTimeout de 0 ms, que se disparaba mucho antes de que
      // la primera tanda saliera siquiera por la red.
      const resumen = await CTX.publicar(lista);
      if (avisoDePublicar) avisoDePublicar(resumen || { bien: 0, mal: 0 });
    });

    // Los campos: cada uno escribe su parte del ajuste y nada más.
    $("vestDx").addEventListener("input", () => cambiarAjuste({ dx: $("vestDx").value }));
    $("vestDy").addEventListener("input", () => cambiarAjuste({ dy: $("vestDy").value }));
    $("vestEscala").addEventListener("input", () => cambiarAjuste({ escala: $("vestEscala").value }));
    $("vestEspejo").addEventListener("change", () => cambiarAjuste({ espejo: $("vestEspejo").checked }));

    $("vestAlLienzo").addEventListener("click", () => cambiarAjuste({ alLienzo: true }));
    $("vestEncajar").addEventListener("click", () => cambiarAjuste({
      alLienzo: true, escala: Number($("vestEncajar").dataset.pct) || 100, dx: 0, dy: 0
    }));
    $("vestOriginal").addEventListener("click", () => {
      const item = itemActivo();
      if (!item) return;
      // Al PUNTO DE PARTIDA, que no siempre es el 100 %: para una prenda
      // descuadrada es la escala del encaje. Poner 100 a pelo la dejaría
      // pegada a tamaño real, o sea resucitando el salto que este botón
      // existe para deshacer.
      cambiarAjuste({
        dx: 0, dy: 0, espejo: false, alLienzo: false,
        escala: vestEscalaDeEncaje(item.ancho, item.alto)
      });
    });

    // El arrastre. pointer y no mouse: así vale igual con el dedo.
    const lienzo = $("vestLienzo");
    lienzo.addEventListener("pointerdown", empezarArrastre);
    lienzo.addEventListener("pointermove", moverArrastre);
    lienzo.addEventListener("pointerup", soltarArrastre);
    lienzo.addEventListener("pointercancel", soltarArrastre);

    document.addEventListener("keydown", alTeclado);
  }

  // Para que js/arte.js pueda refrescar el rail cuando cambia su lista.
  function avisarDeCambio() {
    if (!abierto) return;
    // Si la prenda que se estaba ajustando ya no está en la lista -la
    // quitaron, o se publicó- deja de haber nada activo.
    if (activa && !itemActivo()) activa = null;
    pintarPruebas();
    refrescarEscenario();
    pintarAjuste();
  }

  // ---------- LO QUE EL TALLER NECESITA DEL MOTOR ----------
  //
  // El taller (js/arte-taller.js) NO tiene su propio maniquí: gobierna
  // ESTE. Mismo lienzo, mismo guardarropa, mismo ajuste. Lo único que
  // cambia entre "taller" y "vestidor libre" es si hay carril de pasos y
  // si la puerta está activa.
  //
  // Por eso lo que sigue son mandos, no datos: el taller pide "ponele
  // este personaje" o "vestilo al azar" y el motor hace lo de siempre.
  // Si el taller no está cargado, nada de esto se llama y el vestidor
  // funciona como hasta ahora.

  function estado() {
    return {
      modelo: modeloActual,
      puesto: Object.assign({}, puesto),
      montadas: montadas.slice(),
      activa: activa,
      abierto: abierto
    };
  }

  function ponerModelo(valor) {
    if (!CTX || !valor) return;
    const select = $("vestPersonaje");
    if (select && select.value !== valor) select.value = valor;
    modeloActual = valor;
    puesto = {};
    ranuraAbierta = null;
    refrescarEscenario();
    pintarRejilla();
    pintarPruebas();
  }

  // Vestir el maniquí con un avatar de verdad: el de quien está mirando,
  // o el de cualquiera. Es lo que pidió el equipo para poder ver la
  // prenda nueva sobre gente real y no sobre un conjunto inventado.
  //
  // El avatar llega con la forma {capa: valor}; sólo se aceptan los
  // valores que existen en el catálogo del personaje que se está
  // probando, porque el guardarropa de uno no le sirve a otro.
  function vestirComoAvatar(avatar) {
    if (!avatar || typeof avatar !== "object") return 0;

    const datos = CTX.datos();
    puesto = {};
    let puestas = 0;

    for (const capa of ordenDeCapas()) {
      if (capa === "modelo") continue;
      const valor = avatar[capa];
      if (!valor || valor === "ninguno") continue;
      const p = datos.prendas.find(x => x.valor === valor && x.modelo === modeloActual);
      if (!p) continue;
      puesto[capa] = valor;
      puestas++;
    }

    // Si el avatar trae personaje y lo tenemos, se respeta.
    if (avatar.modelo && datos.modelos.some(m => m.valor === avatar.modelo)) {
      modeloActual = avatar.modelo;
      const select = $("vestPersonaje");
      if (select) select.value = modeloActual;
    }

    refrescarEscenario();
    pintarRejilla();
    return puestas;
  }

  // Las rutas de las capas que lleva puestas ahora mismo, en orden de
  // dibujo. Lo usa la rejilla de conjuntos del paso de probar, que pinta
  // seis maniquíes pequeños sin duplicar la lógica de quién gana cada
  // ranura.
  function capasPuestas() {
    const rutas = [];
    for (const capa of ordenDeCapas()) {
      const f = fuenteDeRanura(capa);
      if (f && f.url) rutas.push({ capa: capa, url: f.url, esPrueba: !!f.esPrueba });
    }
    return rutas;
  }

  window.MacroVestidor = {
    pngDeSubida,
    hornearPrenda,
    cargarImagen,
    conectar,
    abrir,
    cerrar,
    avisarDeCambio,
    activar,
    permitirAjuste,
    alPublicar,
    alSalir,
    deshacer,
    rehacer,
    resumenDeAjuste: vestResumenDeAjuste,

    // La aritmetica y las medidas, expuestas a proposito.
    //
    // El taller es OTRO <script>, y aunque en el navegador los const de
    // nivel superior se comparten entre scripts, apoyarse en eso es una
    // dependencia invisible: no se puede probar por separado y se rompe
    // sola si alguien envuelve este archivo de otra forma. Mejor un
    // contrato explicito.
    LIENZO: { ancho: VEST_LIENZO_ANCHO, alto: VEST_LIENZO_ALTO },
    capas: () => ordenDeCapas(),
    puedeAjustarse: vestPuedeAjustarse,
    hayQueHornear: vestHayQueHornear,
    esNeutro: vestEsNeutro,
    escalaDeEncaje: vestEscalaDeEncaje,

    // mandos para el taller
    alTocar,
    estado,
    ponerModelo,
    vestirComoAvatar,
    capasPuestas,
    desnudar,
    loBasico,
    alAzar,
    montar
  };

})(window);

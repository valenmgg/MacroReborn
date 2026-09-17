// ==============================
// LLEVAR UN PNG AL LIENZO — api/_lienzo.js
// ==============================
// Los píxeles. api/_png.js lee y escribe los BLOQUES de un PNG sin
// descomprimir nada; esto es la otra mitad: descomprimir, mover el
// dibujo al lienzo de 327x504 y volver a comprimir.
//
// Sin librerías de imagen, como todo lo demás. Un PNG por dentro es
// zlib más cinco filtros por fila, y los cinco caben en veinte líneas.
//
// ---------------------------------------------------------------
// LAS DOS FORMAS DE LLEVARLO, Y CUÁNDO CADA UNA
// ---------------------------------------------------------------
// No se inventa una política: se copia la que el vestidor ya tiene
// escrita en js/arte-vestidor.js, y que dice, con sus palabras:
//
//   "a escala 100, un píxel del lienzo es un píxel del archivo del
//    artista. La base de la transformación es el PEGADO 1:1, no el
//    encaje. [...] Mover y espejar NO tocan el dibujo. Son traslaciones
//    de píxeles enteros, o sea un calco: cero interpolación."
//
//   1. PEGADO 1:1 (pegar1a1). El dibujo se copia tal cual desde la
//      esquina de arriba a la izquierda. Lo que sobra se recorta; lo que
//      falta queda transparente. Es un calco: los píxeles que quedan son
//      EXACTAMENTE los de origen.
//
//      Para eso están las tres medidas que abundan (327x505, 326x503,
//      326x504): les basta con recortar o rellenar una fila, y el
//      vestidor ya lo dice así.
//
//   2. ENCAJE (encajarContain). La misma cuenta que vestEncajeContain:
//
//          k = min(327 / ancho, 504 / alto)
//          destino = ancho*k x alto*k, centrado
//
//      Esto SÍ remuestrea. Se reserva para lo que de verdad no cabe de
//      otra forma: los tres bichos sueltos del catálogo y las subidas
//      con medidas de pantallazo.
//
// ---------------------------------------------------------------
// POR QUÉ SE CONSERVA LA PALETA
// ---------------------------------------------------------------
// Casi todo el catálogo son PNG de paleta de unos 11 kB. Decodificarlos
// a color completo y volver a escribirlos así los multiplicaría por
// cuatro o cinco, y el catálogo entero pasaría de 4,4 MB a bastante más,
// que es justo lo contrario de lo que se quiere.
//
// En el pegado 1:1 no aparece ningún color nuevo -es un calco-, así que
// la paleta de origen vale tal cual y se conserva. En el encaje sí
// aparecen colores nuevos (interpolar los inventa), y ahí no queda más
// remedio que salir en color completo. Son dieciocho archivos.

const zlib = require("zlib");
const png = require("./_png");

const LIENZO_ANCHO = 327;
const LIENZO_ALTO = 504;

// Canales por tipo de color, según la especificación.
const CANALES = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };


// ------------------------------------------------------------------
// DESHACER LOS FILTROS
// ------------------------------------------------------------------
// Cada fila de un PNG va precedida de un byte que dice con qué filtro se
// guardó, y todos menos el 0 se apoyan en la fila de arriba o en el
// píxel de al lado. Sin deshacerlos no hay píxeles, solo diferencias.
function desfiltrar(crudo, bytesFila, alto, bpp) {
  const salida = Buffer.alloc(bytesFila * alto);
  let pos = 0;

  for (let y = 0; y < alto; y++) {
    if (pos >= crudo.length) throw new Error("PNG cortado: faltan filas");

    const filtro = crudo[pos++];
    const linea = crudo.subarray(pos, pos + bytesFila);
    pos += bytesFila;

    const inicio = y * bytesFila;
    const arriba = y ? inicio - bytesFila : -1;

    for (let i = 0; i < bytesFila; i++) {
      const a = i >= bpp ? salida[inicio + i - bpp] : 0;              // izquierda
      const b = arriba >= 0 ? salida[arriba + i] : 0;                 // arriba
      const c = (arriba >= 0 && i >= bpp) ? salida[arriba + i - bpp] : 0;  // diagonal
      const x = linea[i];
      let v;

      switch (filtro) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: {
          // Paeth: se queda con el vecino que menos se aleja de a+b-c.
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : (pb <= pc ? b : c));
          break;
        }
        default: throw new Error("Filtro de PNG desconocido: " + filtro);
      }

      salida[inicio + i] = v & 0xff;
    }
  }

  return salida;
}

// Al revés. Se usa el filtro 0 (ninguno) a propósito: deflate ya hace el
// trabajo, y con filtro 0 lo que se escribe se puede leer de un vistazo
// cuando algo sale torcido. En un dibujo de colores planos la diferencia
// de tamaño es pequeña.
function filtrarSinFiltro(datos, bytesFila, alto) {
  const salida = Buffer.alloc((bytesFila + 1) * alto);
  for (let y = 0; y < alto; y++) {
    salida[y * (bytesFila + 1)] = 0;
    datos.copy(salida, y * (bytesFila + 1) + 1, y * bytesFila, (y + 1) * bytesFila);
  }
  return salida;
}


// ------------------------------------------------------------------
// LEER
// ------------------------------------------------------------------
// Devuelve, según el tipo de color:
//   paleta:  { ancho, alto, indices, paleta, alfas }
//   resto:   { ancho, alto, rgba }
//
// El entrelazado (Adam7) se rechaza. Ninguna prenda del catálogo lo usa
// -está comprobado sobre los 438 archivos- y soportarlo obligaría a
// escribir siete pasadas distintas para nada.
function leerPixeles(binario) {
  const cab = png.leerCabecera(binario);

  if (cab.entrelazado !== 0) throw new Error("PNG entrelazado, no soportado");
  if (cab.profundidad === 16) throw new Error("PNG de 16 bits, no soportado");

  const canales = CANALES[cab.tipoColor];
  if (canales === undefined) throw new Error("Tipo de color desconocido: " + cab.tipoColor);

  const bloques = png.leerBloques(binario);
  const idat = Buffer.concat(bloques.filter(b => b.tipo === "IDAT").map(b => b.datos));
  if (!idat.length) throw new Error("PNG sin datos de imagen");

  const bitsPorPixel = canales * cab.profundidad;
  const bytesFila = Math.ceil(bitsPorPixel * cab.ancho / 8);
  const bpp = Math.max(1, bitsPorPixel >> 3);

  const planos = desfiltrar(zlib.inflateSync(idat), bytesFila, cab.alto, bpp);

  // ---- Paleta ----
  if (cab.tipoColor === 3) {
    const plte = bloques.find(b => b.tipo === "PLTE");
    if (!plte) throw new Error("PNG de paleta sin PLTE");

    const trns = bloques.find(b => b.tipo === "tRNS");
    const colores = plte.datos.length / 3;

    // Los alfas de tRNS pueden venir cortos: lo que no está es opaco.
    const alfas = Buffer.alloc(colores, 255);
    if (trns) trns.datos.copy(alfas, 0, 0, Math.min(trns.datos.length, colores));

    // Los índices se desempaquetan a un byte cada uno, venga el PNG en
    // 1, 2, 4 u 8 bits. Así el resto del módulo trabaja de una sola
    // forma y de paso se arreglan solos los ocho archivos del catálogo
    // que venían en 2 y 4 bits.
    const indices = Buffer.alloc(cab.ancho * cab.alto);
    const porByte = 8 / cab.profundidad;
    const mascara = (1 << cab.profundidad) - 1;

    for (let y = 0; y < cab.alto; y++) {
      for (let x = 0; x < cab.ancho; x++) {
        if (cab.profundidad === 8) {
          indices[y * cab.ancho + x] = planos[y * bytesFila + x];
        } else {
          const byte = planos[y * bytesFila + Math.floor(x / porByte)];
          const desplazamiento = 8 - cab.profundidad * ((x % porByte) + 1);
          indices[y * cab.ancho + x] = (byte >> desplazamiento) & mascara;
        }
      }
    }

    return { ancho: cab.ancho, alto: cab.alto, indices, paleta: plte.datos, alfas };
  }

  // ---- Todo lo demás, a RGBA de 8 bits ----
  const rgba = Buffer.alloc(cab.ancho * cab.alto * 4);
  const trns = bloques.find(b => b.tipo === "tRNS");

  for (let y = 0; y < cab.alto; y++) {
    for (let x = 0; x < cab.ancho; x++) {
      const destino = (y * cab.ancho + x) * 4;
      let r, g, b, a = 255;

      if (cab.profundidad === 8) {
        const o = y * bytesFila + x * canales;
        if (cab.tipoColor === 0) { r = g = b = planos[o]; }
        else if (cab.tipoColor === 4) { r = g = b = planos[o]; a = planos[o + 1]; }
        else if (cab.tipoColor === 2) { r = planos[o]; g = planos[o + 1]; b = planos[o + 2]; }
        else { r = planos[o]; g = planos[o + 1]; b = planos[o + 2]; a = planos[o + 3]; }
      } else {
        // Gris de 1, 2 o 4 bits. Se estira al rango completo.
        const porByte = 8 / cab.profundidad;
        const mascara = (1 << cab.profundidad) - 1;
        const byte = planos[y * bytesFila + Math.floor(x / porByte)];
        const desplazamiento = 8 - cab.profundidad * ((x % porByte) + 1);
        const valor = (byte >> desplazamiento) & mascara;
        r = g = b = Math.round(valor * 255 / mascara);
      }

      // tRNS en gris o en color: un color concreto es el transparente.
      if (trns && cab.tipoColor === 0 && trns.datos.length >= 2) {
        if (r === trns.datos.readUInt16BE(0)) a = 0;
      } else if (trns && cab.tipoColor === 2 && trns.datos.length >= 6) {
        if (r === trns.datos.readUInt16BE(0) &&
            g === trns.datos.readUInt16BE(2) &&
            b === trns.datos.readUInt16BE(4)) a = 0;
      }

      rgba[destino] = r; rgba[destino + 1] = g; rgba[destino + 2] = b; rgba[destino + 3] = a;
    }
  }

  return { ancho: cab.ancho, alto: cab.alto, rgba };
}


// ------------------------------------------------------------------
// ESCRIBIR
// ------------------------------------------------------------------

function cabeceraIHDR(ancho, alto, profundidad, tipoColor) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = profundidad;
  ihdr[9] = tipoColor;
  ihdr[12] = 0;
  return ihdr;
}

function escribirPaleta(img) {
  const bytesFila = img.ancho;
  const comprimido = zlib.deflateSync(
    filtrarSinFiltro(img.indices, bytesFila, img.alto), { level: 9 }
  );

  const bloques = [
    { tipo: "IHDR", datos: cabeceraIHDR(img.ancho, img.alto, 8, 3) },
    { tipo: "PLTE", datos: img.paleta }
  ];

  // tRNS solo si hace falta. Se recorta en el último color que no sea
  // opaco: la especificación deja omitir la cola, y todo lo que falte
  // se entiende opaco.
  let ultimo = -1;
  for (let i = 0; i < img.alfas.length; i++) if (img.alfas[i] !== 255) ultimo = i;
  if (ultimo >= 0) bloques.push({ tipo: "tRNS", datos: img.alfas.subarray(0, ultimo + 1) });

  bloques.push({ tipo: "IDAT", datos: comprimido });
  bloques.push({ tipo: "IEND", datos: Buffer.alloc(0) });

  return png.escribirBloques(bloques);
}

// Escribe de la forma que menos pese, SIN perder un solo color.
//
// Remuestrear inventa colores, así que el resultado sale en RGBA. Pero
// "inventa colores" no quiere decir "inventa muchos": estirar un fondo
// de 327x505 a 327x504 solo mezcla filas vecinas de un degradado, y el
// total sigue cabiendo de sobra en una paleta.
//
// Y la diferencia no es pequeña. Los doce fondos del catálogo que hay
// que estirar pesan 319 kB entre todos con paleta y 849 kB en RGBA: casi
// tres veces más, y un fondo se lo baja CADA avatar que lo lleve puesto.
//
// Así que se cuentan los colores. Si caben en 256 se arma la paleta y se
// escribe así, y el resultado es idéntico píxel a píxel: no es una
// cuantización ni una aproximación, es el mismo dibujo guardado mejor.
// Si no caben, RGBA y a otra cosa.
function escribirAjustado(img) {
  if (img.indices) return escribirPaleta(img);

  const vistos = new Map();
  const indices = Buffer.alloc(img.ancho * img.alto);

  for (let i = 0; i < indices.length; i++) {
    const o = i * 4;
    // Un píxel totalmente transparente es el MISMO color mires el RGB
    // que mires, y hay dibujos con varios negros invisibles distintos.
    // Sin esto, esos cuentan como colores diferentes y llenan la paleta
    // para nada.
    const clave = img.rgba[o + 3] === 0
      ? -1
      : (img.rgba[o] << 24) | (img.rgba[o + 1] << 16) | (img.rgba[o + 2] << 8) | img.rgba[o + 3];

    let idx = vistos.get(clave);
    if (idx === undefined) {
      if (vistos.size >= 256) return escribirRGBA8(img);
      idx = vistos.size;
      vistos.set(clave, idx);
    }
    indices[i] = idx;
  }

  const paleta = Buffer.alloc(vistos.size * 3);
  const alfas = Buffer.alloc(vistos.size, 255);

  for (const [clave, idx] of vistos) {
    if (clave === -1) { alfas[idx] = 0; continue; }
    paleta[idx * 3] = (clave >>> 24) & 0xff;
    paleta[idx * 3 + 1] = (clave >>> 16) & 0xff;
    paleta[idx * 3 + 2] = (clave >>> 8) & 0xff;
    alfas[idx] = clave & 0xff;
  }

  return escribirPaleta({ ancho: img.ancho, alto: img.alto, indices, paleta, alfas });
}

function escribirRGBA8(img) {
  const bytesFila = img.ancho * 4;
  const comprimido = zlib.deflateSync(
    filtrarSinFiltro(img.rgba, bytesFila, img.alto), { level: 9 }
  );

  return png.escribirBloques([
    { tipo: "IHDR", datos: cabeceraIHDR(img.ancho, img.alto, 8, 6) },
    { tipo: "IDAT", datos: comprimido },
    { tipo: "IEND", datos: Buffer.alloc(0) }
  ]);
}


// ------------------------------------------------------------------
// 1. EL PEGADO 1:1
// ------------------------------------------------------------------
// Copia el dibujo tal cual desde la esquina de arriba a la izquierda.
// Lo que sobra por abajo o por la derecha se recorta; lo que falta queda
// transparente. Es el ajuste neutro del vestidor (dx 0, dy 0, escala
// 100) y es un calco: los píxeles que quedan son los de origen, bit a
// bit.
//
// Con paleta hace falta un índice transparente para lo que se rellene.
// Se busca uno que ya lo sea; si no hay y cabe un color más, se añade.
// Si la paleta está llena y es toda opaca, no hay dónde meterlo y se
// avisa: quien llame decide (encajarContain no tiene ese problema).
function pegar1a1(img, ancho, alto) {
  if (img.indices) {
    let transparente = -1;
    for (let i = 0; i < img.alfas.length; i++) {
      if (img.alfas[i] === 0) { transparente = i; break; }
    }

    let paleta = img.paleta;
    let alfas = img.alfas;

    const hayQueRellenar = ancho > img.ancho || alto > img.alto;

    if (transparente === -1 && hayQueRellenar) {
      const colores = paleta.length / 3;
      if (colores >= 256) {
        throw new Error("La paleta está llena y no tiene color transparente");
      }
      transparente = colores;
      paleta = Buffer.concat([paleta, Buffer.from([0, 0, 0])]);
      alfas = Buffer.concat([alfas, Buffer.from([0])]);
    }

    const indices = Buffer.alloc(ancho * alto, transparente === -1 ? 0 : transparente);
    const copiarAncho = Math.min(ancho, img.ancho);
    const copiarAlto = Math.min(alto, img.alto);

    for (let y = 0; y < copiarAlto; y++) {
      img.indices.copy(indices, y * ancho, y * img.ancho, y * img.ancho + copiarAncho);
    }

    return { ancho, alto, indices, paleta, alfas };
  }

  const rgba = Buffer.alloc(ancho * alto * 4);   // todo a cero = transparente
  const copiarAncho = Math.min(ancho, img.ancho);
  const copiarAlto = Math.min(alto, img.alto);

  for (let y = 0; y < copiarAlto; y++) {
    img.rgba.copy(rgba, y * ancho * 4, y * img.ancho * 4, (y * img.ancho + copiarAncho) * 4);
  }

  return { ancho, alto, rgba };
}


// ------------------------------------------------------------------
// 2. EL ENCAJE
// ------------------------------------------------------------------
// La misma cuenta que vestEncajeContain en js/arte-vestidor.js:
//
//     k = min(327 / ancho, 504 / alto)
//     el dibujo mide ancho*k x alto*k y va centrado
//
// El remuestreo es por ÁREA: cada píxel de destino es la media de los
// de origen que le tocan, con sus pesos. Es lo que hace un canvas con
// imageSmoothingQuality "high", y es lo que importa aquí porque el caso
// feo es reducir mucho -un 1919x1079 cabe diecisiete veces en el
// lienzo-, y ahí una interpolación de dos vecinos deja el dibujo
// dentado, saltándose quince de cada dieciséis píxeles.
//
// El alfa va PREMULTIPLICADO durante la media. Sin eso, promediar el
// color de un píxel transparente con el de uno opaco arrastra el color
// del transparente -que suele ser negro- y aparece un borde sucio
// alrededor del dibujo.
function factorContain(ancho, alto) {
  if (!ancho || !alto) return 1;
  return Math.min(LIENZO_ANCHO / ancho, LIENZO_ALTO / alto);
}

function encajarContain(img, ancho, alto) {
  const origen = img.indices ? aRGBA(img) : img;

  const k = factorContain(origen.ancho, origen.alto);
  const destAncho = Math.max(1, Math.round(origen.ancho * k));
  const destAlto = Math.max(1, Math.round(origen.alto * k));
  const offsetX = Math.round((ancho - destAncho) / 2);
  const offsetY = Math.round((alto - destAlto) / 2);

  const escalado = remuestrearPorArea(origen, destAncho, destAlto);
  const rgba = Buffer.alloc(ancho * alto * 4);

  for (let y = 0; y < destAlto; y++) {
    const filaDestino = y + offsetY;
    if (filaDestino < 0 || filaDestino >= alto) continue;
    for (let x = 0; x < destAncho; x++) {
      const colDestino = x + offsetX;
      if (colDestino < 0 || colDestino >= ancho) continue;
      escalado.rgba.copy(
        rgba,
        (filaDestino * ancho + colDestino) * 4,
        (y * destAncho + x) * 4,
        (y * destAncho + x) * 4 + 4
      );
    }
  }

  return { ancho, alto, rgba };
}

function aRGBA(img) {
  if (!img.indices) return img;

  const rgba = Buffer.alloc(img.ancho * img.alto * 4);
  for (let i = 0; i < img.indices.length; i++) {
    const idx = img.indices[i];
    rgba[i * 4] = img.paleta[idx * 3];
    rgba[i * 4 + 1] = img.paleta[idx * 3 + 1];
    rgba[i * 4 + 2] = img.paleta[idx * 3 + 2];
    rgba[i * 4 + 3] = idx < img.alfas.length ? img.alfas[idx] : 255;
  }
  return { ancho: img.ancho, alto: img.alto, rgba };
}

function remuestrearPorArea(img, destAncho, destAlto) {
  const rgba = Buffer.alloc(destAncho * destAlto * 4);
  const escalaX = img.ancho / destAncho;
  const escalaY = img.alto / destAlto;

  for (let y = 0; y < destAlto; y++) {
    const desdeY = y * escalaY;
    const hastaY = (y + 1) * escalaY;
    const y0 = Math.floor(desdeY);
    const y1 = Math.min(img.alto, Math.ceil(hastaY));

    for (let x = 0; x < destAncho; x++) {
      const desdeX = x * escalaX;
      const hastaX = (x + 1) * escalaX;
      const x0 = Math.floor(desdeX);
      const x1 = Math.min(img.ancho, Math.ceil(hastaX));

      let sr = 0, sg = 0, sb = 0, sa = 0, peso = 0;

      for (let sy = y0; sy < y1; sy++) {
        const altoTrozo = Math.min(sy + 1, hastaY) - Math.max(sy, desdeY);
        if (altoTrozo <= 0) continue;

        for (let sx = x0; sx < x1; sx++) {
          const anchoTrozo = Math.min(sx + 1, hastaX) - Math.max(sx, desdeX);
          if (anchoTrozo <= 0) continue;

          const w = anchoTrozo * altoTrozo;
          const o = (sy * img.ancho + sx) * 4;
          const a = img.rgba[o + 3];

          // Premultiplicado: el color pesa lo que pese su alfa.
          sr += img.rgba[o] * a * w;
          sg += img.rgba[o + 1] * a * w;
          sb += img.rgba[o + 2] * a * w;
          sa += a * w;
          peso += w;
        }
      }

      const destino = (y * destAncho + x) * 4;
      if (peso <= 0 || sa <= 0) continue;   // queda transparente

      rgba[destino] = Math.round(sr / sa);
      rgba[destino + 1] = Math.round(sg / sa);
      rgba[destino + 2] = Math.round(sb / sa);
      rgba[destino + 3] = Math.round(sa / peso);
    }
  }

  return { ancho: destAncho, alto: destAlto, rgba };
}


// ------------------------------------------------------------------
// LA PUERTA DE ARRIBA
// ------------------------------------------------------------------
// Decide sola qué hacer con un PNG y devuelve el que va al lienzo,
// junto con lo que hizo y por qué. Quien llama no tiene que saber de
// filtros ni de paletas.
//
// El criterio es el del vestidor: si cabe sin estirar, se calca; si no,
// se encaja. Cabe sin estirar cuando ninguna medida se pasa del lienzo
// por más de una fila o una columna, que es el caso de las tres medidas
// que abundan.
// ¿Lo que el calco recortaría está vacío?
//
// Vacío significa TRANSPARENTE, no "todos los píxeles iguales". Una fila
// de un solo color plano y opaco es dibujo, y perderla se ve; una fila
// transparente no está ahí para nadie.
//
// Si el dibujo cabe entero (solo hay que rellenar), no se recorta nada y
// la respuesta es que sí por definición.
function recorteVacio(img, ancho, alto) {
  if (img.ancho <= ancho && img.alto <= alto) return true;

  const alfaDe = img.indices
    ? (x, y) => {
        const idx = img.indices[y * img.ancho + x];
        return idx < img.alfas.length ? img.alfas[idx] : 255;
      }
    : (x, y) => img.rgba[(y * img.ancho + x) * 4 + 3];

  // Las filas de abajo que se caen.
  for (let y = alto; y < img.alto; y++) {
    for (let x = 0; x < img.ancho; x++) if (alfaDe(x, y) !== 0) return false;
  }

  // Y las columnas de la derecha, sin repetir la esquina.
  for (let x = ancho; x < img.ancho; x++) {
    for (let y = 0; y < Math.min(alto, img.alto); y++) if (alfaDe(x, y) !== 0) return false;
  }

  return true;
}

function llevarAlLienzo(binario, opciones) {
  const conf = opciones || {};
  const ancho = conf.ancho || LIENZO_ANCHO;
  const alto = conf.alto || LIENZO_ALTO;

  const img = leerPixeles(binario);

  if (img.ancho === ancho && img.alto === alto && !conf.forzar) {
    return { binario, ancho, alto, metodo: "ya-estaba", exacto: true };
  }

  const cercaDeAncho = Math.abs(img.ancho - ancho) <= 1;
  const cercaDeAlto = Math.abs(img.alto - alto) <= 1;

  // El calco recorta lo que se sale del lienzo, y recortar solo es
  // gratis si lo que se va está VACÍO. Si en esa fila o esa columna hay
  // dibujo -la punta de los pies, una sombra, el borde de una capa-,
  // calcar se lo come para siempre.
  //
  // En ese caso se encaja, aunque la medida esté a un píxel: encajar
  // remuestrea y ablanda un poco el dibujo, pero no pierde nada. Es la
  // decisión que se tomó mirando el catálogo, donde ocho de los
  // veinticinco 327x505 tienen dibujo en la última fila.
  const recorteLimpio = !conf.forzarEncaje && recorteVacio(img, ancho, alto);

  if (cercaDeAncho && cercaDeAlto && recorteLimpio && conf.metodo !== "encaje") {
    try {
      const puesto = pegar1a1(img, ancho, alto);
      return {
        binario: puesto.indices ? escribirPaleta(puesto) : escribirRGBA8(puesto),
        ancho, alto,
        metodo: "calco",
        exacto: true,
        desde: img.ancho + "x" + img.alto
      };
    } catch (error) {
      // Paleta llena y sin transparente: se cae al encaje, que no
      // necesita inventar ningún color.
      if (!/paleta/i.test(error.message)) throw error;
    }
  }

  // A un píxel del lienzo pero con dibujo en lo que se recortaría: se
  // ESTIRA al lienzo exacto, sin márgenes.
  //
  // Aquí no vale el encaje del taller, y el caso lo demuestra: los doce
  // archivos del catálogo que caen aquí son todos FONDOS de 327x505.
  // Encajarlos preservando la proporción los dejaría en 326x504 con una
  // franja transparente de un píxel al lado — una costura visible en el
  // borde de cada avatar que lleve ese fondo. Estirar un 0,2 % no se ve;
  // una franja transparente sí.
  //
  // El encaje sigue siendo lo correcto para lo que NO está a un píxel,
  // que es lo de abajo: ahí la proporción es otra de verdad y estirar
  // aplastaría el dibujo.
  if (cercaDeAncho && cercaDeAlto) {
    const estirado = remuestrearPorArea(img.indices ? aRGBA(img) : img, ancho, alto);
    return {
      binario: escribirAjustado(estirado),
      ancho, alto,
      metodo: "estirado",
      exacto: false,
      desde: img.ancho + "x" + img.alto
    };
  }

  const encajado = encajarContain(img, ancho, alto);
  return {
    binario: escribirAjustado(encajado),
    ancho, alto,
    metodo: "encaje",
    exacto: false,
    desde: img.ancho + "x" + img.alto,
    factor: Number(factorContain(img.ancho, img.alto).toFixed(4))
  };
}


module.exports = {
  LIENZO_ANCHO,
  LIENZO_ALTO,
  leerPixeles,
  escribirPaleta,
  escribirRGBA8,
  escribirAjustado,
  pegar1a1,
  encajarContain,
  factorContain,
  aRGBA,
  remuestrearPorArea,
  recorteVacio,
  llevarAlLienzo
};

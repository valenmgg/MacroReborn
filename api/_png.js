// ==============================
// PNG A MANO — api/_png.js
// ==============================
// Leer y escribir los bloques de un PNG sin instalar nada. No porque las
// librerias esten prohibidas -lo que esta prohibido es depender de un
// servicio de terceros, ver docs/DESARROLLO.md 5- sino porque aqui no
// hacia falta ninguna. Por eso tests/vestidor-horneado.test.js sustituye
// el canvas por un falso en vez de traerse node-canvas con sus decenas
// de MB de binario nativo.
//
// Aquí no hace falta ninguna librería porque un PNG es, por dentro, una
// lista de bloques con nombre:
//
//   firma (8 bytes)  IHDR  [ lo que sea ]  IDAT...  IEND
//
// y cada bloque es: longitud (4), tipo (4), datos (n), CRC (4). Con eso
// se puede leer la cabecera, meter texto y volver a escribirlo todo
// entero sin tocar un solo píxel.
//
// LO QUE ESTE MÓDULO NO HACE: descomprimir los píxeles. Poner la autoría
// no lo necesita —un bloque de texto se mete al lado de los datos, no
// dentro—, y no tocar los píxeles es justo lo que hace que la operación
// sea segura sobre las 630 prendas de golpe, sean del formato que sean.

const zlib = require("zlib");

const FIRMA = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// Los bloques de texto que llevan la autoría. Son los nombres que
// entiende todo el mundo: exiftool, ImageMagick, el visor de Windows y
// los paneles de propiedades de los editores.
const CLAVES_AUTORIA = ["Author", "Copyright", "Source", "Software", "Disclaimer"];


// ------------------------------------------------------------------
// CRC32, el de la especificación del PNG
// ------------------------------------------------------------------
// Cada bloque lleva el suyo al final. Si se escribe mal, un visor
// estricto da el PNG por corrupto, así que no se puede improvisar.
const TABLA_CRC = (() => {
  const tabla = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabla[n] = c;
  }
  return tabla;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}


// ------------------------------------------------------------------
// Leer y escribir la lista de bloques
// ------------------------------------------------------------------

function esPNG(binario) {
  return Buffer.isBuffer(binario) &&
         binario.length >= 8 &&
         binario.subarray(0, 8).equals(FIRMA);
}

// Devuelve [{ tipo, datos }] en el orden en que están.
//
// Se recorre con cuidado a propósito: esto va a comer ficheros subidos
// por gente, y un fichero recortado no puede tumbar el proceso. Ante
// cualquier cosa rara se lanza un error con un mensaje que se entiende,
// y quien llama decide.
function leerBloques(binario) {
  if (!esPNG(binario)) throw new Error("No es un PNG: la firma no cuadra");

  const bloques = [];
  let i = 8;

  while (i + 8 <= binario.length) {
    const longitud = binario.readUInt32BE(i);
    const tipo = binario.toString("latin1", i + 4, i + 8);
    const desde = i + 8;
    const hasta = desde + longitud;

    // +4 del CRC. Si no llega, el fichero está cortado.
    if (hasta + 4 > binario.length) {
      throw new Error("PNG cortado: el bloque " + tipo + " se sale del fichero");
    }

    bloques.push({ tipo, datos: binario.subarray(desde, hasta) });

    i = hasta + 4;
    if (tipo === "IEND") break;
  }

  if (!bloques.length || bloques[0].tipo !== "IHDR") {
    throw new Error("PNG sin IHDR: no se puede leer");
  }

  return bloques;
}

function escribirBloques(bloques) {
  const trozos = [FIRMA];

  for (const bloque of bloques) {
    const cabecera = Buffer.alloc(8);
    cabecera.writeUInt32BE(bloque.datos.length, 0);
    cabecera.write(bloque.tipo, 4, "latin1");

    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([cabecera.subarray(4, 8), bloque.datos])), 0);

    trozos.push(cabecera, bloque.datos, crc);
  }

  return Buffer.concat(trozos);
}

// Las medidas y el formato, del IHDR. Son los mismos 13 bytes que ya
// leía a mano api/content.js al validar una subida; acá salen con
// nombre para no volver a contar desplazamientos en ningún sitio.
function leerCabecera(binario) {
  const ihdr = leerBloques(binario)[0].datos;
  if (ihdr.length < 13) throw new Error("IHDR incompleto");

  return {
    ancho: ihdr.readUInt32BE(0),
    alto: ihdr.readUInt32BE(4),
    profundidad: ihdr[8],
    tipoColor: ihdr[9],
    compresion: ihdr[10],
    filtro: ihdr[11],
    entrelazado: ihdr[12]
  };
}


// ------------------------------------------------------------------
// La autoría
// ------------------------------------------------------------------
// Un bloque tEXt es "clave\0valor" en latin1. Para acentos y eñes el
// formato manda usar iTXt, que es UTF-8; se usa iTXt en cuanto el texto
// se sale de ASCII, y tEXt cuando cabe, que es lo que más programas
// entienden.
//
// QUÉ COMPRA ESTO, dicho sin vender humo: no impide copiar nada. Lo que
// hace es que la copia lleve dentro de quién es. Sobrevive a un
// copiar-pegar, a subirlo a otra web y a la mayoría de las tuberías de
// imágenes. NO sobrevive a un reguardado deliberado en Photoshop — y ahí
// está la gracia: quien lo borró demostró que sabía lo que hacía, y eso
// es justo lo que hace falta para reclamar.

function bloqueTexto(clave, valor) {
  const soloAscii = /^[\x20-\x7e]*$/.test(valor);

  if (soloAscii) {
    return {
      tipo: "tEXt",
      datos: Buffer.concat([
        Buffer.from(clave, "latin1"),
        Buffer.from([0]),
        Buffer.from(valor, "latin1")
      ])
    };
  }

  // iTXt: clave \0 comprimido(0) metodo(0) \0 idioma \0 clave traducida \0 texto
  return {
    tipo: "iTXt",
    datos: Buffer.concat([
      Buffer.from(clave, "latin1"),
      Buffer.from([0, 0, 0]),
      Buffer.from([0]),
      Buffer.from([0]),
      Buffer.from(valor, "utf8")
    ])
  };
}

function claveDeBloqueTexto(bloque) {
  if (bloque.tipo !== "tEXt" && bloque.tipo !== "iTXt" && bloque.tipo !== "zTXt") return null;
  const fin = bloque.datos.indexOf(0);
  if (fin === -1) return null;
  return bloque.datos.toString("latin1", 0, fin);
}

// Mete (o reemplaza) la autoría y devuelve el PNG nuevo.
//
// Va DESPUÉS del IHDR y antes de todo lo demás: la especificación deja
// los bloques de texto donde sea, pero ponerlos al principio hace que un
// programa que solo lee la cabecera los encuentre igual.
//
// Es idempotente: si ya había autoría puesta, se quita antes. Si no, una
// segunda pasada del horno dejaría dos Author dentro.
function ponerAutoria(binario, autoria) {
  const bloques = leerBloques(binario);

  const limpios = bloques.filter(b => {
    const clave = claveDeBloqueTexto(b);
    return !(clave && CLAVES_AUTORIA.includes(clave));
  });

  const nuevos = [];
  for (const clave of CLAVES_AUTORIA) {
    const valor = autoria[clave];
    if (typeof valor === "string" && valor) nuevos.push(bloqueTexto(clave, valor));
  }

  limpios.splice(1, 0, ...nuevos);
  return escribirBloques(limpios);
}

// Lee la autoría que lleve puesta, para poder comprobarla.
function leerAutoria(binario) {
  const salida = {};

  for (const bloque of leerBloques(binario)) {
    const clave = claveDeBloqueTexto(bloque);
    if (!clave || !CLAVES_AUTORIA.includes(clave)) continue;

    if (bloque.tipo === "tEXt") {
      const fin = bloque.datos.indexOf(0);
      salida[clave] = bloque.datos.toString("latin1", fin + 1);
    } else if (bloque.tipo === "iTXt") {
      // clave \0 comprimido metodo \0(idioma) \0(clave traducida) texto
      let i = bloque.datos.indexOf(0) + 1;
      const comprimido = bloque.datos[i];
      i += 2;                                   // comprimido + método
      i = bloque.datos.indexOf(0, i) + 1;       // fin del idioma
      i = bloque.datos.indexOf(0, i) + 1;       // fin de la clave traducida
      const resto = bloque.datos.subarray(i);
      salida[clave] = comprimido
        ? zlib.inflateSync(resto).toString("utf8")
        : resto.toString("utf8");
    }
  }

  return salida;
}

module.exports = {
  FIRMA,
  CLAVES_AUTORIA,
  crc32,
  esPNG,
  leerBloques,
  escribirBloques,
  leerCabecera,
  ponerAutoria,
  leerAutoria
};

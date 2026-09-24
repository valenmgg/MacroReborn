// ==============================
// GUARDAR Y SERVIR LAS PREVISUALIZACIONES — api/_previsualizaciones.js
// ==============================
// api/_previsualizacion.js dibuja una y api/_recortes.js decide su
// cuadro. Esto decide con que nombre se guarda, donde, cuando hay que
// rehacerla y como se sirve. Fase 4 de docs/AVATARES-SERVIDOR.md.
// Calcado de api/_avatar-compuesto.js, que hace lo mismo con los avatares.
//
// ---------------------------------------------------------------
// CADA PRENDA TIENE SU DIRECCION, POR SU ID
// ---------------------------------------------------------------
//     /previsualizaciones/412.jpg?v=3f2a9c1b7d04
//
// El id de avatar_prendas y no el valor ("tora_pelo3"): es un entero, no
// hay nada que escapar, y no cambia aunque la prenda cambie de nombre.
//
// La version va en la consulta, igual que en los avatares compuestos: con
// ella el navegador guarda la imagen un año; sin ella, un minuto. Cuando
// la previsualizacion cambia, cambia su huella, y la pagina arma una
// direccion que ningun navegador tiene guardada.
//
// LA HUELLA sale de todo lo que cambia el dibujo: el archivo de la
// prenda, el de su modelo, la capa, el cuadro, el maniqui y VERSION. Si
// el equipo de arte resube un dibujo, o alguien fuerza un cuadro con la
// herramienta, la huella cambia sola.
//
// EN DISCO Y NO EN LA BASE, por lo mismo que los compuestos: la base
// guarda la fuente, y esto es derivado y se rehace en milisegundos.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const compositor = require("./_compositor");
const recortes = require("./_recortes");
const previsualizacion = require("./_previsualizacion");

// Sube esto cuando cambie algo que altere los bytes de salida sin pasar
// por la receta: la calidad del JPG, el tono del maniqui, la regla del
// cuadro automatico. Sin eso, las caches de un año servirian lo viejo.
const VERSION = 1;
const EXTENSION = "jpg";

// Con version, un año: la direccion cambia cuando cambia el dibujo. Sin
// version, un minuto: es la misma para siempre.
const CACHE_CON_VERSION = 31536000;
const CACHE_SIN_VERSION = 60;

// Fuera de git, como los compuestos, para que un despliegue no las toque.
// En produccion y en local, la misma ruta: la variable de entorno existe
// solo para los tests.
const DIRECTORIO = process.env.MR_PREVISUALIZACIONES_DIR ||
  path.join(__dirname, "..", "datos-locales", "previsualizaciones");

function idValido(id) {
  return Number.isInteger(id) && id >= 1 && id <= 999999999;
}

// Agrupadas de mil en mil, como los compuestos: una sola carpeta con
// decenas de miles de archivos hace lento cualquier listado.
function rutaDe(id) {
  return path.join(DIRECTORIO, String(Math.floor(id / 1000) * 1000), id + "." + EXTENSION);
}

function leer(id) {
  if (!idValido(id)) return null;
  try {
    return fs.readFileSync(rutaDe(id));
  } catch (_) {
    return null;
  }
}

// Escribe por un nombre temporal y renombra: dos generaciones a la vez o
// un corte de luz no pueden dejar una imagen a medias en su sitio.
function escribirEntero(destino, datos) {
  const temporal = destino + "." + process.pid + "." + Date.now() + ".tmp";
  fs.writeFileSync(temporal, datos);
  fs.renameSync(temporal, destino);
}

// La direccion publica. Sin huella, la desnuda, que tambien funciona.
function urlDe(id, huella) {
  if (!idValido(id)) return null;
  const base = "/previsualizaciones/" + id + "." + EXTENSION;
  // Doce caracteres bastan: es un identificador de version, no un secreto.
  return huella ? base + "?v=" + String(huella).slice(0, 12) : base;
}

const RUTA = new RegExp("^/previsualizaciones/(\\d{1,9})\\." + EXTENSION + "$");

function partirRuta(pathname) {
  const m = RUTA.exec(String(pathname || ""));
  if (!m) return null;
  const id = Number(m[1]);
  return idValido(id) ? { id } : null;
}

// ------------------------------------------------------------------
// LA RECETA
// ------------------------------------------------------------------
// Todo lo que dibuja una previsualizacion, y su huella. `fila` es una de
// las que devuelve filasDe(): la prenda con los bytes de su archivo y los
// del modelo sobre el que se pone.

const binario = d => (d === null || d === undefined ? null : Buffer.isBuffer(d) ? d : Buffer.from(d));

function recetaDe(fila, config) {
  const datos = binario(fila.datos);
  const caja = recortes.cajaParaCuadro(compositor.componer([datos]));
  const cuadro = recortes.cuadroParaPrenda(config, { modelo: fila.modelo, capa: fila.capa, caja });
  const maniqui = (config && config.maniqui) || "plano";

  const texto = [
    "v" + VERSION,
    "prenda:" + fila.sha256,
    "modelo:" + (fila.baseSha || "-"),
    "capa:" + fila.capa,
    "cuadro:" + cuadro.x + "," + cuadro.y + "," + cuadro.lado,
    "maniqui:" + maniqui,
    "lado:" + recortes.LADO_SALIDA
  ].join("\n");

  return {
    huella: crypto.createHash("sha256").update(texto).digest("hex"),
    cuadro,
    maniqui,
    datos,
    base: binario(fila.baseDatos)
  };
}

// Las prendas con su archivo y el de su modelo, listas para dibujar.
// Con `ids`, solo esas; sin ellos, todas. Una sola consulta para el
// relleno y para el gancho de subida, para que no puedan leer distinto.
async function filasDe(sql, ids) {
  if (ids) {
    return sql`
      SELECT p.id, p.valor, p.modelo, p.capa, p.previsualizacion,
             a.sha256, a.datos, b.sha256 AS "baseSha", b.datos AS "baseDatos"
      FROM avatar_prendas p
      JOIN avatar_archivos a ON a.id = p.archivo_id
      LEFT JOIN avatar_prendas m ON m.valor = p.modelo AND m.capa = 'modelo'
      LEFT JOIN avatar_archivos b ON b.id = m.archivo_id
      WHERE p.id = ANY(${ids})
      ORDER BY p.id;
    `;
  }
  return sql`
    SELECT p.id, p.valor, p.modelo, p.capa, p.previsualizacion,
           a.sha256, a.datos, b.sha256 AS "baseSha", b.datos AS "baseDatos"
    FROM avatar_prendas p
    JOIN avatar_archivos a ON a.id = p.archivo_id
    LEFT JOIN avatar_prendas m ON m.valor = p.modelo AND m.capa = 'modelo'
    LEFT JOIN avatar_archivos b ON b.id = m.archivo_id
    ORDER BY p.id;
  `;
}

// ------------------------------------------------------------------
// GENERAR
// ------------------------------------------------------------------

// Dibuja y guarda la de una fila, salvo que ya este hecha: si la huella
// guardada es la de la receta y el archivo esta en su sitio, el archivo
// YA es correcto, porque la huella captura la receta entera.
function generar(fila, config) {
  const id = Number(fila.id);
  const receta = recetaDe(fila, config);
  const ruta = rutaDe(id);

  if (fila.previsualizacion === receta.huella && fs.existsSync(ruta)) {
    return { huella: receta.huella, hecha: false };
  }

  const jpg = previsualizacion.renderizar({
    base: receta.base, prenda: receta.datos, capa: fila.capa,
    cuadro: receta.cuadro, maniqui: receta.maniqui
  });
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  escribirEntero(ruta, jpg);
  return { huella: receta.huella, hecha: true, bytes: jpg.length };
}

// Genera las de estas prendas, o las de todas, y apunta su huella en la
// base. Es lo que usan el relleno y el gancho de subida. Una prenda que
// falla no para a las demas: se cuenta y se sigue.
//
// Con `escribir: false` no toca ni el disco ni la base: solo dice cuantas
// se harian. Es el simulacro del relleno.
async function asegurar(sql, opciones) {
  const op = opciones || {};
  const config = op.config || recortes.leer();
  const escribir = op.escribir !== false;
  const lista = await filasDe(sql, op.ids || null);

  const resumen = { total: lista.length, hechas: 0, iguales: 0, cambiadas: 0, bytes: 0, fallos: [] };
  for (const fila of lista) {
    const id = Number(fila.id);
    try {
      if (!escribir) {
        const receta = recetaDe(fila, config);
        const igual = fila.previsualizacion === receta.huella && fs.existsSync(rutaDe(id));
        if (igual) resumen.iguales++; else resumen.hechas++;
        continue;
      }

      const r = generar(fila, config);
      if (r.hecha) { resumen.hechas++; resumen.bytes += r.bytes; } else resumen.iguales++;
      if (r.huella !== fila.previsualizacion) {
        await sql`UPDATE avatar_prendas SET previsualizacion = ${r.huella} WHERE id = ${id};`;
        resumen.cambiadas++;
      }
    } catch (error) {
      resumen.fallos.push({ id, valor: fila.valor, error: error.message });
    }
  }

  // El catalogo del editor vive en memoria y solo se rehace cuando sube
  // su version (ver construirCatalogo en api/content.js). Si cambio
  // alguna direccion, se sube, o el editor seguiria mandando la vieja.
  if (escribir && resumen.cambiadas) {
    await sql`UPDATE avatar_catalogo_version SET version = version + 1 WHERE id = 1;`;
  }
  return resumen;
}

// La misma, pero que no pueda tumbar lo que la llamo. Subir una prenda
// tiene que funcionar aunque el disco este lleno: la prenda se queda sin
// previsualizacion hasta el siguiente relleno, no sin subirse.
async function asegurarSinFallar(sql, ids) {
  try {
    const r = await asegurar(sql, { ids });
    for (const f of r.fallos) console.error("previsualizaciones: fallo la " + f.id + " (" + f.valor + "): " + f.error);
    return r;
  } catch (error) {
    console.error("previsualizaciones: no se pudieron generar.", error.message);
    return null;
  }
}

// ------------------------------------------------------------------
// SERVIR
// ------------------------------------------------------------------
// Vive aqui y no en server.js porque el servidor de desarrollo es OTRO
// servidor: asi los dos sirven exactamente lo mismo. Misma leccion que
// api/_prendas-ruta.js. Devuelve true si la ruta era suya.
function atender(req, res, url) {
  const r = partirRuta(url.pathname);
  if (!r) return false;

  const datos = leer(r.id);
  if (!datos) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("No encontrado");
    return true;
  }

  const conVersion = !!url.searchParams.get("v");
  const segundos = conVersion ? CACHE_CON_VERSION : CACHE_SIN_VERSION;
  res.writeHead(200, {
    "Content-Type": "image/jpeg",
    "Content-Length": datos.length,
    "Cache-Control": "public, max-age=" + segundos + (conVersion ? ", immutable" : "")
  });
  res.end(req.method === "HEAD" ? undefined : datos);
  return true;
}

module.exports = {
  VERSION,
  EXTENSION,
  DIRECTORIO,
  CACHE_CON_VERSION,
  CACHE_SIN_VERSION,
  idValido,
  rutaDe,
  leer,
  urlDe,
  partirRuta,
  recetaDe,
  filasDe,
  generar,
  asegurar,
  asegurarSinFallar,
  atender
};

// ==============================
// LA HERRAMIENTA DE RECORTES, LADO SERVIDOR
// scripts/herramientas/recortes/servidor.js
// ==============================
// Una pagina para elegir a mano el cuadro de las previsualizaciones:
// una prenda puesta sobre su maniqui, un cuadro uno a uno encima, y la
// miniatura final en vivo. Lo que se guarda va a
// api/recortes-previsualizacion.json. Fase 4 de docs/AVATARES-SERVIDOR.md.
//
// SOLO EXISTE EN EL SERVIDOR LOCAL. Esto lo engancha
// scripts/servidor-local.js y nadie mas: server.js no lo carga, y la
// carpeta scripts/ esta cerrada en produccion por el propio server.js y
// por nginx. Hay una prueba que se entera si alguien lo engancha alli,
// porque aqui hay una ruta que ESCRIBE un archivo del repositorio.
//
// Y SOLO RESPONDE DESDE ESTA MISMA MAQUINA. El servidor local escucha en
// todas las interfaces, asi que cualquiera en la misma red wifi llegaria
// a el. Para servir el sitio da igual; para un boton que escribe
// archivos, no.

const fs = require("fs");
const path = require("path");

const recortes = require("../../../api/_recortes");
const previsualizacion = require("../../../api/_previsualizacion");
const compositor = require("../../../api/_compositor");
const { CAPAS } = require("../../../api/_avatar-catalogo");

const RAIZ = path.join(__dirname, "..", "..", "..");
const PREFIJO = "/herramientas/recortes";
const CARPETA = __dirname;
const REFERENCIAS = path.join(RAIZ, "datos-locales", "macrojuegos-referencia", "prendas");

// Los archivos de la pagina, con nombre fijo. Nada de rutas armadas con
// lo que venga en la URL.
const ESTATICOS = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "application/javascript; charset=utf-8"],
  "/estilo.css": ["estilo.css", "text/css; charset=utf-8"]
};

// Que tipo de macrojuegos corresponde a cada capa nuestra. Sale de mirar
// sus previsualizaciones archivadas una por una el 23/09/2026: el numero
// del archivo lleva el tipo en los dos digitos que siguen al modelo, y
// 05 son camisas, 06 pantalones, 08 pelos, 09 una barba y 12 zapatos.
const TIPOS_MACROJUEGOS = {
  "05": ["remera"],
  "06": ["pantalon"],
  "08": ["pelo"],
  "09": ["cara", "boca"],
  "12": ["botas"]
};

function esLocal(req) {
  const ip = String((req.socket && req.socket.remoteAddress) || "");
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function json(res, codigo, cuerpo) {
  res.writeHead(codigo, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(cuerpo));
}

// Las referencias de macrojuegos, agrupadas por nuestra capa. Si la
// carpeta no esta -en otro PC, o porque ya se borraron como se acordo-
// simplemente no hay referencias.
function referencias() {
  const porCapa = {};
  let archivos = [];
  try { archivos = fs.readdirSync(REFERENCIAS).filter(f => /^\d+_\d+\.jpg$/.test(f)); }
  catch (_) { return porCapa; }

  for (const f of archivos.sort()) {
    const [modeloRef, nombre] = f.replace(".jpg", "").split("_");
    const tipo = nombre.slice(modeloRef.length, modeloRef.length + 2);
    for (const capa of TIPOS_MACROJUEGOS[tipo] || []) {
      (porCapa[capa] = porCapa[capa] || []).push(f);
    }
  }
  return porCapa;
}

// El catalogo con la caja de dibujo de cada prenda. Calcular las 768
// cajas lleva un par de segundos, asi que se guarda en memoria la
// primera vez: la pagina lo pide al abrir y al cambiar de modelo.
let _catalogo = null;

async function catalogo(sql) {
  if (_catalogo) return _catalogo;

  const filas = await sql`
    SELECT p.valor, p.nombre, p.capa, p.modelo, a.sha256, a.datos
    FROM avatar_prendas p JOIN avatar_archivos a ON a.id = p.archivo_id
    ORDER BY p.modelo, p.capa, p.valor;`;

  const prendas = {}, bases = {}, datos = new Map();
  for (const f of filas) {
    const binario = Buffer.isBuffer(f.datos) ? f.datos : Buffer.from(f.datos);
    datos.set(f.valor, { binario, modelo: f.modelo, capa: f.capa });

    let caja = null;
    try { caja = compositor.cajaDibujada(compositor.componer([binario])); } catch (_) {}

    const ficha = { valor: f.valor, nombre: f.nombre, url: "/prendas/" + f.sha256 + ".png", caja };
    ((prendas[f.modelo] = prendas[f.modelo] || {})[f.capa] =
      prendas[f.modelo][f.capa] || []).push(ficha);
    if (f.capa === "modelo") bases[f.modelo] = { valor: f.valor, url: ficha.url };
  }

  const sugerencias = {};
  for (const [modelo, porCapa] of Object.entries(prendas)) {
    sugerencias[modelo] = {};
    for (const [capa, lista] of Object.entries(porCapa)) {
      sugerencias[modelo][capa] = recortes.sugerir(lista.map(p => p.caja));
    }
  }

  _catalogo = { prendas, bases, sugerencias, datos };
  return _catalogo;
}

async function atender(req, res, url, sql) {
  if (url.pathname !== PREFIJO && !url.pathname.startsWith(PREFIJO + "/")) return false;

  if (!esLocal(req)) {
    json(res, 403, { error: "Esta herramienta solo responde desde la propia maquina." });
    return true;
  }

  const ruta = url.pathname.slice(PREFIJO.length) || "/";

  // ----- la pagina -----
  if (ESTATICOS[ruta]) {
    const [archivo, tipo] = ESTATICOS[ruta];
    res.writeHead(200, { "Content-Type": tipo, "Cache-Control": "no-store" });
    res.end(fs.readFileSync(path.join(CARPETA, archivo)));
    return true;
  }

  // ----- las referencias de macrojuegos -----
  const ref = /^\/referencia\/(\d+_\d+\.jpg)$/.exec(ruta);
  if (ref) {
    try {
      const datos = fs.readFileSync(path.join(REFERENCIAS, ref[1]));
      res.writeHead(200, { "Content-Type": "image/jpeg" });
      res.end(datos);
    } catch (_) {
      res.writeHead(404); res.end();
    }
    return true;
  }

  // ----- todo lo que la pagina necesita para arrancar -----
  if (ruta === "/api/datos" && req.method === "GET") {
    const c = await catalogo(sql);
    json(res, 200, {
      capas: CAPAS,
      modelos: Object.keys(c.prendas).sort(),
      lienzo: { ancho: recortes.LIENZO_ANCHO, alto: recortes.LIENZO_ALTO },
      ladoMaximo: recortes.LADO_MAXIMO,
      ladoMinimo: recortes.LADO_MINIMO,
      colorManiqui: recortes.COLOR_MANIQUI,
      config: recortes.leer(),
      prendas: c.prendas,
      bases: c.bases,
      sugerencias: c.sugerencias,
      referencias: referencias()
    });
    return true;
  }

  // ----- la miniatura de verdad, hecha por el mismo codigo que la hara
  // para las 768. Lo que se ve aqui es lo que va a salir.
  if (ruta === "/api/muestra" && req.method === "GET") {
    const c = await catalogo(sql);
    const prenda = c.datos.get(url.searchParams.get("valor"));
    if (!prenda) { json(res, 404, { error: "No existe esa prenda" }); return true; }

    const cuadro = {
      x: Number(url.searchParams.get("x")),
      y: Number(url.searchParams.get("y")),
      lado: Number(url.searchParams.get("lado"))
    };
    const problema = recortes.problemaDeCuadro(cuadro);
    if (problema) { json(res, 400, { error: problema }); return true; }

    const base = c.bases[prenda.modelo] ? c.datos.get(c.bases[prenda.modelo].valor) : null;
    const maniqui = url.searchParams.get("maniqui") === "color" ? "color" : "plano";
    const jpg = previsualizacion.renderizar({
      base: base && base.binario, prenda: prenda.binario, capa: prenda.capa, cuadro, maniqui
    });
    res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "no-store" });
    res.end(jpg);
    return true;
  }

  // ----- guardar -----
  if (ruta === "/api/guardar" && req.method === "POST") {
    let cuerpo = "";
    for await (const trozo of req) {
      cuerpo += trozo;
      if (cuerpo.length > 256 * 1024) { json(res, 413, { error: "Demasiado grande" }); return true; }
    }
    let config;
    try { config = JSON.parse(cuerpo); }
    catch (_) { json(res, 400, { error: "No es JSON" }); return true; }

    try {
      const guardado = recortes.escribir(config);
      console.log("[recortes] guardados " +
        Object.values(guardado.cuadros).reduce((s, p) => s + Object.keys(p).length, 0) +
        " cuadros en " + path.relative(RAIZ, recortes.ARCHIVO));
      json(res, 200, { ok: true, config: guardado, archivo: path.relative(RAIZ, recortes.ARCHIVO) });
    } catch (error) {
      json(res, 400, { error: error.message, problemas: error.problemas || [] });
    }
    return true;
  }

  json(res, 404, { error: "No existe en la herramienta" });
  return true;
}

module.exports = { atender, PREFIJO, esLocal, referencias, TIPOS_MACROJUEGOS };

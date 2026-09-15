// ==============================
// TESTS DE LAS RUTAS HEREDADAS DE PRENDAS — tests/prenda-heredada.test.js
// ==============================
// El arte de los avatares se mudó a la base, pero casi todo el frontend
// sigue armando la ruta a mano a partir del valor guardado:
// "cereza_fondo40" -> imagenes/cereza/fondo40.png. Solo el editor del
// perfil consulta el catálogo.
//
// Eso hacía que una prenda subida desde el panel del equipo de arte se
// viera bien en el editor y se perdiera en todas las demás pantallas:
// Ranking, Comunidad, chat, amigos, los perfiles ajenos, las galerías y
// la portada. La capa no se dibujaba y quedaba un 404 en la consola.
//
// server.js resuelve esas rutas contra la base cuando el fichero no está
// en el disco. Esto prueba esa parte, leyendo la función real del disco
// en vez de una copia.
//
// Correr:  npm test

const { test, before, describe } = require("node:test");
const assert = require("node:assert");
const fsReal = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

const { crearBaseLocal, crearSqlPGlite } = require("../scripts/pglite");

const FUENTE = fsReal.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const FIRMA_PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

let db;
let servir;
let registro;

// El PNG que se guarda en la base para las pruebas.
const PNG = Buffer.concat([
  FIRMA_PNG,
  Buffer.from("0000000d49484452", "hex"),
  Buffer.alloc(40, 7)
]);

function trozoDeServidor() {
  const i = FUENTE.indexOf("const RUTA_DE_PRENDA");
  const j = FUENTE.indexOf("async function main()");
  assert.ok(i !== -1 && j !== -1, "no se encontró el bloque en server.js");
  return FUENTE.slice(i, j);
}

async function meterPrenda(valor, modelo, capa, publicada, datos) {
  const sha = crypto.createHash("sha256").update(datos).digest("hex");
  const ya = await db.query("SELECT id FROM avatar_archivos WHERE sha256 = $1", [sha]);
  let archivoId;
  if (ya.rows.length) {
    archivoId = ya.rows[0].id;
  } else {
    const r = await db.query(
      `INSERT INTO avatar_archivos (sha256, datos, ancho, alto, peso)
       VALUES ($1, $2, 327, 504, $3) RETURNING id`,
      [sha, datos, datos.length]
    );
    archivoId = r.rows[0].id;
  }
  await db.query(
    `INSERT INTO avatar_prendas (valor, modelo, capa, nombre, archivo_id, publicada)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [valor, modelo, capa, valor, archivoId, publicada]
  );
  return sha;
}

let shaFondo, shaRetirada, shaModelo;

before(async () => {
  db = await crearBaseLocal();
  const sql = crearSqlPGlite(db);

  shaFondo = await meterPrenda("cereza_fondo40", "cereza", "fondo", true, PNG);
  shaRetirada = await meterPrenda("cereza_piel4", "cereza", "piel", false,
    Buffer.concat([PNG, Buffer.from("otra")]));
  shaModelo = await meterPrenda("sonda", "sonda", "modelo", true,
    Buffer.concat([PNG, Buffer.from("modelo")]));

  registro = [];
  const contexto = {
    Buffer,
    console: { error: (...a) => registro.push(a.join(" ")), log() {} },
    obtenerSql: () => sql
  };
  vm.createContext(contexto);
  servir = vm.runInContext(trozoDeServidor() + "\n;servirPrendaDeLaBase", contexto);
});

// Una respuesta de mentira que apunta lo que le hacen.
function respuestaFalsa() {
  const r = {
    cabeceras: {},
    codigo: null,
    cuerpo: null,
    writableEnded: false,
    setHeader(k, v) { this.cabeceras[k] = v; },
    writeHead(c, extra) { this.codigo = c; if (extra) Object.assign(this.cabeceras, extra); },
    end(c) { this.cuerpo = c || null; this.writableEnded = true; }
  };
  return r;
}

const pedir = (ruta, cabeceras) =>
  servir({ headers: cabeceras || {} }, respuestaFalsa(), ruta);

async function pedirCon(ruta, cabeceras) {
  const res = respuestaFalsa();
  const atendida = await servir({ headers: cabeceras || {} }, res, ruta);
  return { atendida, res };
}

// ==============================

describe("prendas que solo existen en la base", () => {
  test("se sirven por su ruta de imagenes/ de siempre", async () => {
    const { atendida, res } = await pedirCon("/imagenes/cereza/fondo40.png");

    assert.equal(atendida, true);
    assert.equal(res.codigo, 200);
    assert.equal(res.cabeceras["Content-Type"], "image/png");
    assert.ok(res.cuerpo.equals(PNG), "deberían ser los bytes guardados");
    assert.equal(Number(res.cabeceras["Content-Length"]), PNG.length);
  });

  test("el modelo también, que vive en la raíz", async () => {
    const { atendida, res } = await pedirCon("/imagenes/sonda.png");

    assert.equal(atendida, true);
    assert.equal(res.codigo, 200);
    assert.ok(res.cuerpo.subarray(0, 8).equals(FIRMA_PNG));
  });

  test("una prenda RETIRADA se sigue sirviendo", async () => {
    // Retirar saca una prenda del editor, no del avatar de quien ya la
    // llevaba puesta. Si dejara de servirse, a esa persona se le
    // rompería el avatar sin haber hecho nada.
    const { atendida, res } = await pedirCon("/imagenes/cereza/piel4.png");

    assert.equal(atendida, true);
    assert.equal(res.codigo, 200);
  });

  test("se puede revalidar con ETag en vez de rebajarla", async () => {
    const primera = await pedirCon("/imagenes/cereza/fondo40.png");
    const etag = primera.res.cabeceras["ETag"];
    assert.ok(etag, "debería mandar ETag");

    const segunda = await pedirCon("/imagenes/cereza/fondo40.png", { "if-none-match": etag });
    assert.equal(segunda.res.codigo, 304);
    assert.equal(segunda.res.cuerpo, null);
  });

  test("NO se cachea como immutable", async () => {
    // El nombre no dice nada del contenido, al revés que la URL del
    // catálogo. Prometer que nunca cambia sería una promesa que no se
    // puede retirar, que es exactamente el error que ya costó una vez.
    const { res } = await pedirCon("/imagenes/cereza/fondo40.png");

    assert.ok(!/immutable/.test(res.cabeceras["Cache-Control"] || ""));
    assert.match(res.cabeceras["Cache-Control"], /must-revalidate/);
  });
});

describe("lo que no debe tocar la base", () => {
  test("una prenda que no existe se deja pasar al 404 de siempre", async () => {
    const { atendida, res } = await pedirCon("/imagenes/tora/inventada9.png");

    assert.equal(atendida, false);
    assert.equal(res.codigo, null, "no debería haber contestado");
  });

  test("las rutas que no tienen forma de prenda ni se consultan", async () => {
    // Sin este filtro, cualquier escáner pidiendo imágenes al azar
    // acabaría haciendo una consulta a la base por cada 404.
    const raras = [
      "/imagenes/logo.png",           // sí tiene forma: se consulta y no está
      "/imagenes/Boca 1.png",         // espacio y mayúscula
      "/imagenes/tora/../../etc.png", // intento de salirse
      "/imagenes/a/b/c.png",          // demasiado hondo
      "/css/inicio.css",
      "/imagenes/juegos/chess.png"
    ];

    for (const ruta of raras) {
      const { atendida } = await pedirCon(ruta);
      assert.equal(atendida, false, "no debería atender: " + ruta);
    }
  });

  test("si la base no responde, no revienta: deja pasar al 404", async () => {
    const contexto = {
      Buffer,
      console: { error() {}, log() {} },
      obtenerSql: () => () => Promise.reject(new Error("base caída"))
    };
    vm.createContext(contexto);
    const servirRoto = vm.runInContext(trozoDeServidor() + "\n;servirPrendaDeLaBase", contexto);

    const res = respuestaFalsa();
    const atendida = await servirRoto({ headers: {} }, res, "/imagenes/cereza/fondo40.png");

    assert.equal(atendida, false);
    assert.equal(res.codigo, null);
  });
});

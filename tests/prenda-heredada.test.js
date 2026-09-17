// ==============================
// TESTS DE LA RUTA VIEJA DE PRENDAS — tests/prenda-heredada.test.js
// ==============================
// El arte de los avatares vive en la base y su URL buena es
// /prendas/<huella sha256>.png. Durante la mudanza quedó abierta la ruta
// de antes, imagenes/<modelo>/<prenda>.png, sirviendo el mismo dibujo.
//
// Ese nombre SE ADIVINA: "tora_pelo3" es imagenes/tora/pelo3.png, y el
// nombrado es sistemático —modelo, capa y un número—. Cualquiera
// enumera pelo1, pelo2, pelo3... por cada capa y por cada modelo y se
// lleva el catálogo entero sin necesitar índice ninguno. Por eso cerrar
// el índice del catálogo no servía de nada mientras esta puerta siguiera
// abierta: es la misma puerta.
//
// Antes este archivo probaba que esas rutas SIRVIERAN el dibujo. Ahora
// prueba lo contrario: que lo nieguen cuando es una prenda, y que no se
// lleven por delante el logo ni las imágenes de los juegos.
//
// Se lee la función real de server.js, no una copia.
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
let esPrenda;
let consultas;

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

// Monta el bloque real de server.js con un sql que cuenta consultas, para
// poder comprobar que la caché hace su trabajo.
function montar(sqlReal) {
  consultas = [];
  const espiado = (trozos, ...valores) => {
    consultas.push(String(trozos.raw ? trozos.raw.join("?") : trozos));
    return sqlReal(trozos, ...valores);
  };

  const contexto = {
    Buffer,
    console: { error() {}, log() {} },
    obtenerSql: () => espiado
  };
  vm.createContext(contexto);
  return vm.runInContext(trozoDeServidor() + "\n;esPrendaDeAvatar", contexto);
}

before(async () => {
  db = await crearBaseLocal();
  const sql = crearSqlPGlite(db);

  await meterPrenda("cereza_fondo40", "cereza", "fondo", true, PNG);
  await meterPrenda("cereza_piel4", "cereza", "piel", false,
    Buffer.concat([PNG, Buffer.from("otra")]));
  await meterPrenda("sonda", "sonda", "modelo", true,
    Buffer.concat([PNG, Buffer.from("modelo")]));

  esPrenda = montar(sql);
});

// ==============================

describe("el arte no sale por su nombre adivinable", () => {
  test("una prenda de la base se niega", async () => {
    assert.equal(await esPrenda("/imagenes/cereza/fondo40.png"), true);
  });

  test("un modelo también, que vive en la raíz", async () => {
    assert.equal(await esPrenda("/imagenes/sonda.png"), true);
  });

  test("una prenda RETIRADA se niega igual", async () => {
    // Retirada sigue siendo arte del equipo. Que no se pueda elegir en
    // el editor no la convierte en algo que regalar por la ruta vieja.
    //
    // Ojo con el matiz: esto NO rompe el avatar de quien la lleva
    // puesta. Ese avatar se dibuja con /prendas/<huella>.png, que sale
    // del índice público y no pasa por aquí. Lo cubre
    // tests/avatar-catalogo-api.test.js.
    assert.equal(await esPrenda("/imagenes/cereza/piel4.png"), true);
  });
});

describe("lo que no es una prenda se sigue sirviendo", () => {
  test("un valor con forma de prenda pero que no existe, pasa", async () => {
    assert.equal(await esPrenda("/imagenes/tora/inventada9.png"), false);
  });

  test("el logo, la portada y las imágenes de los juegos pasan", async () => {
    // Estas no están en avatar_prendas, así que el corte no las toca.
    // Por eso se decide consultando la base y no con una lista escrita a
    // mano: una lista se queda vieja en cuanto sube un modelo nuevo.
    for (const ruta of ["/imagenes/logo.png", "/imagenes/og-image.png",
                        "/imagenes/juegos/chess.png"]) {
      assert.equal(await esPrenda(ruta), false, "debería pasar: " + ruta);
    }
  });

  test("las rutas que no tienen forma de prenda ni se consultan", async () => {
    // Sin este filtro, cualquier escáner pidiendo imágenes al azar
    // acabaría haciendo una consulta a la base por cada 404.
    const antes = consultas.length;

    const raras = [
      "/imagenes/Boca 1.png",         // espacio y mayúscula
      "/imagenes/tora/../../etc.png", // intento de salirse
      "/imagenes/a/b/c.png",          // demasiado hondo
      "/css/inicio.css"
    ];

    for (const ruta of raras) {
      assert.equal(await esPrenda(ruta), false, "debería pasar: " + ruta);
    }

    assert.equal(consultas.length, antes, "ninguna de esas debe tocar la base");
  });
});

describe("la caché de valores", () => {
  test("no vuelve a leer la tabla mientras no cambie la versión", async () => {
    await esPrenda("/imagenes/cereza/fondo40.png");
    const antes = consultas.filter(c => c.includes("FROM avatar_prendas")).length;

    await esPrenda("/imagenes/cereza/piel4.png");
    await esPrenda("/imagenes/sonda.png");

    const despues = consultas.filter(c => c.includes("FROM avatar_prendas")).length;
    assert.equal(despues, antes, "la tabla se lee una vez, no en cada imagen");
  });

  test("al subir la versión, se entera de una prenda nueva", async () => {
    // Mismo mecanismo que el catálogo: avatar_catalogo_version es una
    // fila por clave primaria, así que comprobarla es barato y los dos
    // procesos del cluster se enteran solos.
    assert.equal(await esPrenda("/imagenes/sonda/pelo1.png"), false);

    await meterPrenda("sonda_pelo1", "sonda", "pelo", true,
      Buffer.concat([PNG, Buffer.from("pelo1")]));
    await db.query("UPDATE avatar_catalogo_version SET version = version + 1 WHERE id = 1");

    assert.equal(await esPrenda("/imagenes/sonda/pelo1.png"), true);
  });
});

describe("si la base no responde", () => {
  test("se niega igual: ante la duda, no se abre la puerta", async () => {
    // Preferimos un logo que no carga durante un rato antes que dejar
    // escapar el catálogo por la ruta vieja. El arte no deja de verse
    // por esto: sale por /prendas/<huella>.png, que no pasa por aquí.
    const contexto = {
      Buffer,
      console: { error() {}, log() {} },
      obtenerSql: () => () => Promise.reject(new Error("base caída"))
    };
    vm.createContext(contexto);
    const roto = vm.runInContext(trozoDeServidor() + "\n;esPrendaDeAvatar", contexto);

    assert.equal(await roto("/imagenes/cereza/fondo40.png"), true);
  });

  test("pero una ruta sin forma de prenda sigue pasando", async () => {
    const contexto = {
      Buffer,
      console: { error() {}, log() {} },
      obtenerSql: () => () => Promise.reject(new Error("base caída"))
    };
    vm.createContext(contexto);
    const roto = vm.runInContext(trozoDeServidor() + "\n;esPrendaDeAvatar", contexto);

    assert.equal(await roto("/css/inicio.css"), false);
  });
});

// ==============================
// GUARDAR Y SERVIR EL COMPUESTO — tests/avatar-compuesto.test.js
// ==============================
// api/_avatar-compuesto.js decide cuándo componer, con qué nombre
// guardar y dónde. Fase 2 de docs/AVATARES-SERVIDOR.md.
//
// Lo que hay que sujetar, y por qué cada cosa:
//
//   LA DIRECCION ES DE LA PERSONA Y NO CAMBIA. /avatares/128/62x96.jpg
//   es de quien tenga el id 128, hoy y dentro de un año. Se cambia de
//   ropa y el ARCHIVO cambia; la dirección no. Antes la huella iba en
//   la ruta y cada cambio dejaba un archivo huérfano.
//
//   LA HUELLA SALE DE LAS PRENDAS, no del JSON del avatar ni del
//   destino. Si saliera del JSON, rehornear una prenda dejaría a todo
//   el mundo viendo el compuesto viejo un año, porque la dirección con
//   versión se cachea con immutable y nadie la volvería a pedir.
//
//   EL ARCHIVO SE REESCRIBE SIEMPRE. Es lo contrario de antes y es
//   deliberado: con el nombre fijo, el archivo de ayer puede seguir ahí
//   con la ropa de ayer, así que no vale saltárselo por existir.
//
//   GUARDAR NO PUEDE FALLAR POR ESTO. Si el disco está lleno, la
//   persona se queda sin compuesto hasta el siguiente guardado, no sin
//   poder guardar su avatar.
//
// Se monta sobre PGlite con un catálogo sembrado, porque la receta
// necesita leer avatar_prendas y avatar_archivos.
//
// Correr:  npm test

require("./_aislar-datos");   // antes de api/: ver ese archivo

const { test, before, after, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// El directorio de salida se fija ANTES de cargar el módulo, que lo lee
// al importarse. Va a una carpeta temporal para no ensuciar el
// proyecto ni depender de lo que haya de una corrida anterior.
const TEMPORAL = fs.mkdtempSync(path.join(os.tmpdir(), "mr-avatares-"));
process.env.MR_AVATARES_DIR = TEMPORAL;

const { crearBaseLocal, crearSqlPGlite } = require("../scripts/pglite");
const lienzo = require("../api/_lienzo");
const AC = require("../api/_avatar-compuesto");

let db, sql;

const ANA = { usuarioId: 128 };
const BETO = { usuarioId: 129 };
const RANURA = { usuarioId: 128, ranura: 3 };
const avatarBase = { fondo: "tora_fondo1", modelo: "tora", pelo: "tora_pelo3" };

function png(r, g, b) {
  const rgba = Buffer.alloc(327 * 504 * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
  }
  return lienzo.escribirRGBA8({ rgba, ancho: 327, alto: 504 });
}

async function sembrarPrenda(valor, capa, binario, sha) {
  const arch = await db.query(
    `INSERT INTO avatar_archivos (sha256, datos, ancho, alto, peso)
     VALUES ($1, $2, 327, 504, $3) RETURNING id`,
    [sha, binario, binario.length]
  );
  await db.query(
    `INSERT INTO avatar_prendas (valor, modelo, capa, nombre, archivo_id)
     VALUES ($1, 'tora', $2, $1, $3)`,
    [valor, capa, arch.rows[0].id]
  );
}

before(async () => {
  db = await crearBaseLocal();
  sql = crearSqlPGlite(db);
  await sembrarPrenda("tora", "modelo", png(200, 180, 160), "a".repeat(64));
  await sembrarPrenda("tora_fondo1", "fondo", png(20, 40, 90), "b".repeat(64));
  await sembrarPrenda("tora_pelo3", "pelo", png(30, 20, 10), "c".repeat(64));
  await sembrarPrenda("tora_remera2", "remera", png(220, 30, 30), "d".repeat(64));
});

after(() => {
  fs.rmSync(TEMPORAL, { recursive: true, force: true });
});

describe("la receta", () => {

  test("toma las capas con prenda, en orden de dibujo", async () => {
    // Se pide desordenado a propósito: el orden lo pone CAPAS, no el
    // orden de las claves del objeto.
    const r = await AC.recetaDe(sql, { pelo: "tora_pelo3", fondo: "tora_fondo1", modelo: "tora" });
    assert.deepStrictEqual(r.capas.map(c => c.capa), ["fondo", "modelo", "pelo"]);
  });

  test("ignora las capas vacías", async () => {
    const r = await AC.recetaDe(sql, { fondo: "tora_fondo1", pelo: "ninguno", boca: "", cara: null });
    assert.deepStrictEqual(r.capas.map(c => c.capa), ["fondo"]);
  });

  test("un avatar sin nada no tiene receta, y eso no es un error", async () => {
    for (const vacio of [null, undefined, {}, { pelo: "ninguno" }]) {
      assert.equal(await AC.recetaDe(sql, vacio), null);
    }
  });

  test("una prenda que no está en el catálogo se salta, no revienta", async () => {
    // Pasa con un avatar viejo que lleva algo retirado. Dejar a esa
    // persona sin imagen sería peor que dibujarla sin esa capa, que es
    // lo que hace hoy el navegador.
    const r = await AC.recetaDe(sql, { fondo: "tora_fondo1", pelo: "no_existe_esta" });
    assert.deepStrictEqual(r.capas.map(c => c.valor), ["tora_fondo1"]);
  });

  test("la huella no depende del orden en que se escriban las claves", async () => {
    const a = await AC.recetaDe(sql, { fondo: "tora_fondo1", pelo: "tora_pelo3" });
    const b = await AC.recetaDe(sql, { pelo: "tora_pelo3", fondo: "tora_fondo1" });
    assert.equal(a.huella, b.huella);
  });

  test("dos avatares distintos dan huellas distintas", async () => {
    const a = await AC.recetaDe(sql, { fondo: "tora_fondo1", pelo: "tora_pelo3" });
    const b = await AC.recetaDe(sql, { fondo: "tora_fondo1", remera: "tora_remera2" });
    assert.notEqual(a.huella, b.huella);
  });

  test("y la misma prenda en otra capa también", async () => {
    // La capa entra en la huella. Si no entrara, el mismo dibujo puesto
    // de pelo y de fondo daría la misma versión para dos imágenes
    // distintas, y una de las dos se quedaría cacheada mal.
    const a = await AC.recetaDe(sql, { fondo: "tora_fondo1" });
    const b = await AC.recetaDe(sql, { pelo: "tora_fondo1" });
    assert.notEqual(a.huella, b.huella);
  });

});

describe("generar y guardar", () => {

  test("deja los dos tamaños en el sitio de esa persona", async () => {
    const huella = await AC.asegurar(sql, ANA, avatarBase);
    assert.match(huella, /^[a-f0-9]{64}$/);
    for (const [a, l] of AC.TAMANOS) {
      assert.ok(fs.existsSync(AC.rutaDe(ANA, a, l)), a + "x" + l + " no se escribió");
    }
  });

  test("lo que escribe es un JPG de verdad", async () => {
    await AC.asegurar(sql, ANA, avatarBase);
    const jpg = AC.leer(ANA, 62, 96);
    assert.ok(jpg && jpg.length > 0);
    assert.equal(jpg[0], 0xFF);
    assert.equal(jpg[1], 0xD8);
  });

  test("la miniatura pesa menos que la grande", async () => {
    await AC.asegurar(sql, ANA, avatarBase);
    assert.ok(AC.leer(ANA, 62, 96).length < AC.leer(ANA, 327, 504).length);
  });

  test("cambiarse de ropa reescribe EL MISMO archivo", async () => {
    // El corazón del cambio. Antes nacía un archivo por versión y el
    // anterior quedaba huérfano para siempre.
    await AC.asegurar(sql, ANA, avatarBase);
    const ruta = AC.rutaDe(ANA, 62, 96);
    const antes = fs.readFileSync(ruta);

    const huellaNueva = await AC.asegurar(sql, ANA, { modelo: "tora", remera: "tora_remera2" });
    const despues = fs.readFileSync(ruta);

    assert.ok(!antes.equals(despues), "el archivo no cambió al cambiar de ropa");
    assert.match(huellaNueva, /^[a-f0-9]{64}$/);
    assert.equal(fs.readdirSync(AC.carpetaDe(ANA)).length, 2, "quedaron archivos de más");
  });

  test("cada persona tiene su archivo, aunque lleven lo mismo", async () => {
    // Se pierde la deduplicación que daba el nombre por huella, y es el
    // precio acordado: son 45 kB por persona y a cambio no hay
    // huérfanos. Lo que SI se comparte es la huella, que es la versión.
    const a = await AC.asegurar(sql, ANA, avatarBase);
    const b = await AC.asegurar(sql, BETO, avatarBase);
    assert.equal(a, b, "el mismo avatar debería dar la misma versión");
    assert.notEqual(AC.rutaDe(ANA, 62, 96), AC.rutaDe(BETO, 62, 96));
    assert.ok(fs.existsSync(AC.rutaDe(BETO, 62, 96)));
  });

  test("una ranura va a su propio sitio, sin pisar el avatar puesto", async () => {
    await AC.asegurar(sql, ANA, avatarBase);
    await AC.asegurar(sql, RANURA, { modelo: "tora", remera: "tora_remera2" });

    assert.notEqual(AC.rutaDe(ANA, 62, 96), AC.rutaDe(RANURA, 62, 96));
    assert.ok(!AC.leer(ANA, 62, 96).equals(AC.leer(RANURA, 62, 96)));
  });

  test("un avatar sin nada no genera nada", async () => {
    assert.equal(await AC.asegurar(sql, ANA, {}), null);
    assert.equal(await AC.asegurar(sql, ANA, { pelo: "ninguno" }), null);
  });

  test("y quitarse todo se lleva el compuesto de la ropa de antes", async () => {
    // Lo del disco se sirve sin mirar la base: si se quedara, la
    // direccion desnuda seguiria enseñando lo que ya no lleva puesto.
    AC.olvidarPresupuesto();
    await AC.asegurar(sql, ANA, avatarBase);
    assert.ok(AC.leer(ANA, 62, 96));

    assert.equal(await AC.asegurar(sql, ANA, { pelo: "ninguno" }), null);
    for (const [a, l] of AC.TAMANOS) {
      assert.equal(AC.leer(ANA, a, l), null, a + "x" + l + " se quedo en el disco");
    }
  });

  test("y ponerse un PNG de administrador, igual", async () => {
    AC.olvidarPresupuesto();
    await AC.asegurar(sql, ANA, avatarBase);

    const png = { tipo: "png", url: "/api/users?action=avatar-png&username=ana&v=abc", restaurar: avatarBase };
    assert.equal(await AC.asegurar(sql, ANA, png), null);
    assert.equal(AC.leer(ANA, 62, 96), null, "el PNG dejo el compuesto de antes");
  });

  test("no deja archivos a medias con nombre definitivo", async () => {
    await AC.asegurar(sql, ANA, avatarBase);
    const sueltos = fs.readdirSync(AC.carpetaDe(ANA)).filter(f => f.endsWith(".tmp"));
    assert.deepStrictEqual(sueltos, [], "quedaron temporales sin renombrar");
  });

  test("si falla, no tumba a quien lo llamó", async () => {
    const sqlRoto = () => { throw new Error("disco lleno"); };
    assert.equal(await AC.asegurarSinFallar(sqlRoto, ANA, avatarBase), null);
  });

  test("un destino inventado se rechaza en vez de escribir donde sea", async () => {
    for (const malo of [null, {}, { usuarioId: 0 }, { usuarioId: -1 }, { usuarioId: "1; rm -rf /" },
                        { usuarioId: 1, ranura: 0 }, { usuarioId: 1, ranura: 1.5 }]) {
      await assert.rejects(() => AC.asegurar(sql, malo, avatarBase), TypeError,
        "aceptó " + JSON.stringify(malo));
    }
  });

});

describe("borrar", () => {

  test("vaciar una ranura se lleva sus archivos", async () => {
    // Sin esto, el dibujo de un diseño borrado seguiría sirviéndose en
    // su dirección para siempre.
    await AC.asegurar(sql, RANURA, avatarBase);
    assert.ok(AC.leer(RANURA, 62, 96));

    assert.equal(AC.borrar(RANURA), true);
    assert.equal(AC.leer(RANURA, 62, 96), null);
  });

  test("y no toca el avatar puesto de esa misma persona", async () => {
    await AC.asegurar(sql, ANA, avatarBase);
    await AC.asegurar(sql, RANURA, avatarBase);

    AC.borrar(RANURA);

    assert.ok(AC.leer(ANA, 62, 96), "borrar la ranura se llevó el avatar puesto");
  });

  test("y borrar el avatar puesto no se lleva los diseños guardados", async () => {
    // Las carpetas de las ranuras viven dentro de la del avatar puesto,
    // y el borrado era recursivo: se las llevaba todas.
    AC.olvidarPresupuesto();
    await AC.asegurar(sql, ANA, avatarBase);
    await AC.asegurar(sql, RANURA, avatarBase);

    assert.equal(AC.borrar(ANA), true);

    assert.equal(AC.leer(ANA, 62, 96), null);
    assert.ok(AC.leer(RANURA, 62, 96), "borrar el avatar puesto se llevo la ranura");
  });

  test("borrar algo que no existe no es un error", () => {
    assert.equal(AC.borrar({ usuarioId: 999999, ranura: 7 }), true);
  });

});

describe("leer", () => {

  test("un destino que no tiene nada da null en vez de romper", () => {
    assert.equal(AC.leer({ usuarioId: 999999 }, 62, 96), null);
  });

  test("y un destino con forma inventada también", () => {
    for (const malo of [null, undefined, {}, { usuarioId: 0 }, { usuarioId: "../../etc" },
                        { usuarioId: 1, ranura: -1 }]) {
      assert.equal(AC.leer(malo, 62, 96), null, "aceptó " + JSON.stringify(malo));
    }
  });

  test("un tamaño que no se genera no se sirve", async () => {
    await AC.asegurar(sql, ANA, avatarBase);
    assert.equal(AC.leer(ANA, 1000, 1000), null);
  });

});

describe("la dirección pública", () => {

  test("sin versión es la dirección de siempre, la que se escribe a mano", () => {
    assert.equal(AC.urlDe(ANA, null, 62, 96), "/avatares/128/62x96.jpg");
    assert.equal(AC.urlDe(ANA), "/avatares/128/62x96.jpg");
  });

  test("con versión es LA MISMA, con un sufijo", () => {
    const url = AC.urlDe(ANA, "401ddea4553cacbb", 62, 96);
    assert.equal(url, "/avatares/128/62x96.jpg?v=401ddea4553c");
    assert.ok(url.startsWith(AC.urlDe(ANA, null, 62, 96)), "el sufijo cambió la ruta");
  });

  test("la de una ranura lleva su número", () => {
    assert.equal(AC.urlDe(RANURA, null, 327, 504), "/avatares/128/ranura3/327x504.jpg");
  });

  test("las dos formas se vuelven a partir en el mismo destino", () => {
    for (const d of [ANA, RANURA]) {
      const url = AC.urlDe(d, null, 62, 96);
      assert.deepStrictEqual(AC.partirRuta(url), { destino: d, ancho: 62, alto: 96 });
    }
  });

  test("y la cadena de consulta no entra en la ruta", () => {
    // partirRuta recibe solo el pathname. Si alguna vez le llegara la
    // URL entera, esto se entera.
    assert.equal(AC.partirRuta("/avatares/128/62x96.jpg?v=abc"), null);
  });

  test("sin destino no hay dirección", () => {
    assert.equal(AC.urlDe(null), null);
    assert.equal(AC.urlDe({ usuarioId: 0 }), null);
  });

  test("lo que no es una dirección de compuesto no lo parece", () => {
    const malas = [
      "/", "/avatares/", "/avatares/128.jpg", "/avatares/128/62x96.png",
      "/avatares/128/999x999.jpg", "/avatares/abc/62x96.jpg",
      "/avatares/128/../../etc/passwd", "/avatares/-1/62x96.jpg",
      "/avatares/128/ranura0/62x96.jpg", "/avatares/128/ranuraX/62x96.jpg",
      "/prendas/" + "a".repeat(64) + ".png"
    ];
    for (const m of malas) assert.equal(AC.partirRuta(m), null, "aceptó " + m);
  });

  test("los dos tiempos de caché son los que dice el plan", () => {
    assert.equal(AC.CACHE_CON_VERSION, 31536000);
    assert.ok(AC.CACHE_SIN_VERSION > 0 && AC.CACHE_SIN_VERSION <= 300,
      "sin versión no puede cachearse mucho: la dirección nunca cambia");
  });

});

describe("el freno", () => {

  // Componer cuesta 170 ms de CPU y nginx deja pasar 30 peticiones por
  // segundo. Sin freno, una sola persona guardando en bucle pide cinco
  // segundos de CPU por cada segundo de reloj en una maquina de dos
  // nucleos. Lo trajo este mismo trabajo: antes guardar era un UPDATE.

  test("no recompone lo que no cambio", async () => {
    AC.olvidarPresupuesto();
    const huella = await AC.asegurar(sql, ANA, avatarBase);
    const cuando = fs.statSync(AC.rutaDe(ANA, 62, 96)).mtimeMs;

    // Se le pasa la huella que la base ya tiene: es la misma.
    const otra = await AC.asegurar(sql, ANA, avatarBase, huella);

    assert.equal(otra, huella);
    assert.equal(fs.statSync(AC.rutaDe(ANA, 62, 96)).mtimeMs, cuando,
      "recompuso un avatar que no habia cambiado");
  });

  test("pero si el archivo falta, lo rehace aunque la huella cuadre", async () => {
    AC.olvidarPresupuesto();
    const huella = await AC.asegurar(sql, ANA, avatarBase);
    fs.rmSync(AC.rutaDe(ANA, 62, 96));

    await AC.asegurar(sql, ANA, avatarBase, huella);

    assert.ok(fs.existsSync(AC.rutaDe(ANA, 62, 96)), "no rehizo el archivo que faltaba");
  });

  test("y si cambio de ropa lo rehace, aunque le pasen una huella vieja", async () => {
    AC.olvidarPresupuesto();
    const vieja = await AC.asegurar(sql, ANA, avatarBase);
    const antes = fs.readFileSync(AC.rutaDe(ANA, 62, 96));

    await AC.asegurar(sql, ANA, { modelo: "tora", remera: "tora_remera2" }, vieja);

    assert.ok(!antes.equals(fs.readFileSync(AC.rutaDe(ANA, 62, 96))));
  });

  test("una persona no puede componer sin fin en un minuto", async () => {
    // El caso de quien alterna entre dos avatares a proposito, que el
    // freno de "no cambio nada" no atrapa.
    AC.olvidarPresupuesto();
    const dos = [avatarBase, { modelo: "tora", remera: "tora_remera2" }];

    let compuestos = 0;
    for (let i = 0; i < AC.TOPE_POR_MINUTO + 5; i++) {
      if (await AC.asegurar(sql, ANA, dos[i % 2])) compuestos++;
    }

    assert.equal(compuestos, AC.TOPE_POR_MINUTO,
      "compuso " + compuestos + " veces, el tope es " + AC.TOPE_POR_MINUTO);
  });

  test("y agotarlo no le quita el presupuesto a otra persona", async () => {
    AC.olvidarPresupuesto();
    for (let i = 0; i < AC.TOPE_POR_MINUTO + 3; i++) await AC.asegurar(sql, ANA, avatarBase);

    assert.equal(AC.hayPresupuesto(ANA.usuarioId), false);
    assert.equal(AC.hayPresupuesto(BETO.usuarioId), true);
  });

  test("y al agotarlo no se queda en el disco la ropa de antes", async () => {
    // Sin presupuesto no se compone el avatar nuevo. Si el viejo se
    // quedara, la direccion desnuda lo seguiria sirviendo hasta el
    // siguiente guardado. Sin archivo, se compone al pedirlo.
    AC.olvidarPresupuesto();
    await AC.asegurar(sql, ANA, avatarBase);
    while (AC.hayPresupuesto(ANA.usuarioId)) { /* gastarlo entero */ }

    assert.equal(await AC.asegurar(sql, ANA, { modelo: "tora", remera: "tora_remera2" }), null);
    assert.equal(AC.leer(ANA, 62, 96), null, "se quedo el compuesto de la ropa anterior");
  });

  test("el tope deja sitio de sobra para una persona de verdad", () => {
    // Un humano guarda dos o tres veces seguidas como mucho.
    assert.ok(AC.TOPE_POR_MINUTO >= 10, "demasiado bajo, molestaria a la gente");
    assert.ok(AC.TOPE_POR_MINUTO <= 30, "demasiado alto, no frena nada");
  });

});

describe("si falta, se compone al pedirlo", () => {

  // Fase 3: todas las paginas piden el avatar compuesto. Si falta, el
  // servidor lo compone en ese momento; si no puede, la silueta generica.
  // Y lo que ya esta en el disco se sirve sin recalcular nada.

  const SILUETA = fs.readFileSync(path.join(__dirname, "..", "imagenes", "avatar.png"));
  const CARLA = { usuarioId: 500 };

  async function crearCuenta(id, nombre, avatar) {
    await db.query(
      `INSERT INTO users (id, username, password_hash, level, xp, status, created_at, last_login, avatar)
       VALUES ($1, $2, 'hash', 1, 0, 'active', now(), now(), $3)`,
      [id, nombre, avatar ? JSON.stringify(avatar) : null]
    );
  }

  const huellaDe = async id =>
    (await db.query("SELECT avatar_compuesto FROM users WHERE id = $1", [id])).rows[0].avatar_compuesto;

  before(async () => {
    await crearCuenta(500, "carla", avatarBase);
    await crearCuenta(501, "dani_sin_avatar", null);
    await crearCuenta(502, "eva_frenada", avatarBase);
  });

  test("lo que ya esta en el disco se sirve sin tocar la base", async () => {
    AC.olvidarPresupuesto();
    await AC.asegurar(sql, ANA, avatarBase);
    const sinBase = () => { throw new Error("no deberia consultar la base"); };
    const r = await AC.leerOComponer(sinBase, ANA, 62, 96);
    assert.equal(r.compuesto, true);
    assert.ok(r.datos.equals(fs.readFileSync(AC.rutaDe(ANA, 62, 96))));
  });

  test("si falta, lo compone, lo guarda y apunta su huella", async () => {
    AC.olvidarPresupuesto();
    assert.equal(fs.existsSync(AC.rutaDe(CARLA, 62, 96)), false);
    const r = await AC.leerOComponer(sql, CARLA, 62, 96);
    assert.equal(r.compuesto, true);
    assert.deepStrictEqual([r.datos[0], r.datos[1]], [0xFF, 0xD8]);
    assert.ok(fs.existsSync(AC.rutaDe(CARLA, 327, 504)), "no guardo los dos tamaños");
    assert.match(await huellaDe(500) || "", /^[a-f0-9]{64}$/, "no apunto la huella en la base");
  });

  test("y la segunda vez ya no compone nada", async () => {
    const antes = fs.statSync(AC.rutaDe(CARLA, 62, 96)).mtimeMs;
    await AC.leerOComponer(sql, CARLA, 62, 96);
    assert.equal(fs.statSync(AC.rutaDe(CARLA, 62, 96)).mtimeMs, antes, "recompuso uno que ya estaba");
  });

  test("una ranura que falta, igual", async () => {
    AC.olvidarPresupuesto();
    await db.query("INSERT INTO saved_avatars (user_id, slot, avatar) VALUES (500, 2, $1)",
      [JSON.stringify({ modelo: "tora", remera: "tora_remera2" })]);
    const r = await AC.leerOComponer(sql, { usuarioId: 500, ranura: 2 }, 62, 96);
    assert.equal(r.compuesto, true);
    const fila = await db.query("SELECT avatar_compuesto FROM saved_avatars WHERE user_id = 500 AND slot = 2");
    assert.match(fila.rows[0].avatar_compuesto || "", /^[a-f0-9]{64}$/);
  });

  test("sin avatar, o sin cuenta, la silueta generica y nunca una prenda", async () => {
    for (const destino of [{ usuarioId: 501 }, { usuarioId: 999999 }, { usuarioId: 500, ranura: 9 }]) {
      const r = await AC.leerOComponer(sql, destino, 62, 96);
      assert.equal(r.compuesto, false, JSON.stringify(destino));
      assert.ok(r.datos.equals(SILUETA), "no es la silueta: " + JSON.stringify(destino));
    }
  });

  test("con su freno agotado, la silueta en vez de componer", async () => {
    AC.olvidarPresupuesto();
    for (let i = 0; i < AC.TOPE_POR_MINUTO; i++) AC.hayPresupuesto(502);
    const r = await AC.leerOComponer(sql, { usuarioId: 502 }, 62, 96);
    assert.equal(r.compuesto, false);
    assert.equal(fs.existsSync(AC.rutaDe({ usuarioId: 502 }, 62, 96)), false);
  });

  function pedir(ruta) {
    const res = {
      codigo: 0, cabeceras: {}, cuerpo: null,
      writeHead(c, h) { this.codigo = c; this.cabeceras = h || {}; },
      end(d) { this.cuerpo = d === undefined ? null : d; }
    };
    return AC.atender({ method: "GET" }, res, new URL("http://x" + ruta), sql).then(atendida => ({ atendida, ...res }));
  }

  test("la ruta sirve el compuesto con su cache, y la silueta siempre con cache corta", async () => {
    const con = await pedir("/avatares/500/62x96.jpg?v=abc");
    assert.equal(con.cabeceras["Content-Type"], "image/jpeg");
    assert.equal(con.cabeceras["Cache-Control"], "public, max-age=31536000, immutable");

    // Aunque la direccion traiga version: la silueta no es su avatar, y
    // en cuanto se pueda componer tiene que dejar de verse.
    const sil = await pedir("/avatares/501/62x96.jpg?v=abc");
    assert.equal(sil.codigo, 200);
    assert.equal(sil.cabeceras["Content-Type"], "image/png");
    assert.equal(sil.cabeceras["Cache-Control"], "public, max-age=60");

    assert.equal((await pedir("/previsualizaciones/1.jpg")).atendida, false);
  });

});

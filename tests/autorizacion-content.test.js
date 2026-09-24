// ==============================
// TESTS DE AUTORIZACIÓN EN /api/content — tests/autorizacion-content.test.js
// ==============================
// Tres rutas de escritura se creían a pies juntillas lo que venía en el
// CUERPO de la petición para decidir de quién era lo que tocaban. El
// cuerpo lo escribe el navegador, así que lo firmaba cualquiera.
//
// El guard del despachador (module.exports, "Sesión no corresponde al
// usuario") no alcanzaba, porque solo mira cuatro campos concretos
// -username, origenNombre, reportedBy, moderatorUsername- y además solo
// cuando VIENEN. Los tres agujeros vivían justo en esos huecos:
//
//   1. DELETE ?action=chat sin `username`: el guard es
//      `body.username && ...`, así que omitir el campo lo apaga; y el
//      handler, sin `username`, borraba por id a secas. Cualquier
//      cuenta podía vaciar el chat entero recorriendo los ids, que los
//      devuelve el propio GET.
//
//   2. DELETE ?action=notifications: el guard perdona el `username`
//      ajeno cuando `origenNombre` coincide con la sesión. Esa excepción
//      es para el POST -mandarle una notificación a OTRA persona es
//      justo lo que se quiere-, pero se aplicaba igual al DELETE, así
//      que {username:"victima", origenNombre:"yo"} le vaciaba a otro sus
//      solicitudes de amistad, sus menciones y los avisos de moderación.
//
//   3. POST ?action=comments: firmaba con `authorUsername`, un campo que
//      el guard ni mira. Se podía publicar un comentario a nombre de
//      otra persona, con su author_user_id de verdad -indistinguible de
//      uno legítimo-, con la notificación "X comentó en tu perfil"
//      saliendo a su nombre, y saltándose de paso un bloqueo, porque el
//      bloqueo se comprobaba contra el nombre falso.
//
// Lo que se prueba acá es que el autor y el dueño salen ahora del token
// de sesión (req.auth) y que el cuerpo ya no manda en eso. Cada prueba
// está escrita para FALLAR si se devuelve el código anterior.
//
// Correr:  npm test

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret";

require("./_aislar-datos");   // antes de api/: ver ese archivo

const { test, before, describe } = require("node:test");
const assert = require("node:assert");

const { crearBaseLocal, crearSqlPGlite } = require("../scripts/pglite");
const { usarSqlLocal } = require("../api/_db");
const { crearToken } = require("../api/_auth");

let db;
let contentHandler;
let idAna, idBeto;

async function crearUsuario(username) {
  const r = await db.query(
    `INSERT INTO users (username, password_hash, level, xp, status, created_at, last_login)
     VALUES ($1, 'hash', 1, 0, 'active', now(), now()) RETURNING id`,
    [username]
  );
  return Number(r.rows[0].id);
}

// Una petición como la que arma Vercel: query, cuerpo y, si hay sesión,
// el token en la cabecera. Sin sesión no se manda cabecera ninguna, que
// es el caso del visitante anónimo.
function llamar(metodo, query, body, sesion) {
  return new Promise((resolve) => {
    const cabeceras = {};
    const req = {
      method: metodo,
      query: Object.assign({}, query),
      body: body || {},
      headers: sesion
        ? { authorization: "Bearer " + crearToken({ id: sesion.id, username: sesion.username }) }
        : {}
    };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      setHeader(k, v) { cabeceras[k] = v; },
      json(obj) { resolve({ codigo: this.statusCode, cuerpo: obj, cabeceras }); },
      end(cuerpo) { resolve({ codigo: this.statusCode, cuerpo, cabeceras }); }
    };
    contentHandler(req, res);
  });
}

const borrarChat = (body, sesion) => llamar("DELETE", { action: "chat" }, body, sesion);
const borrarNotificaciones = (body, sesion) => llamar("DELETE", { action: "notifications" }, body, sesion);
const comentar = (body, sesion) => llamar("POST", { action: "comments" }, body, sesion);

// user_id se pasa a mano porque uno de los casos de prueba es
// precisamente un mensaje SIN user_id, de los de antes de que existiera
// esa columna.
async function mensajeDe(username, userId, texto) {
  const r = await db.query(
    `INSERT INTO chat_messages (user_id, username, texto) VALUES ($1, $2, $3) RETURNING id`,
    [userId, username, texto || "un mensaje cualquiera"]
  );
  return Number(r.rows[0].id);
}

async function existeMensaje(id) {
  const r = await db.query("SELECT count(*)::int AS n FROM chat_messages WHERE id = $1", [id]);
  return r.rows[0].n === 1;
}

// Deja la tabla con un reparto conocido: dos avisos de ana y tres de
// beto. Se vuelve a sembrar en cada prueba para que ninguna dependa de
// lo que hizo la anterior.
async function sembrarNotificaciones() {
  await db.query("DELETE FROM notifications");
  await db.query(
    `INSERT INTO notifications (user_id, titulo, mensaje)
     VALUES ($1, 'aviso de ana 1', ''), ($1, 'aviso de ana 2', ''),
            ($2, 'aviso de beto 1', ''), ($2, 'aviso de beto 2', ''), ($2, 'aviso de beto 3', '')`,
    [idAna, idBeto]
  );
}

async function cuantasNotificaciones(userId) {
  const r = await db.query("SELECT count(*)::int AS n FROM notifications WHERE user_id = $1", [userId]);
  return r.rows[0].n;
}

async function ultimoComentario(profileId) {
  const r = await db.query(
    "SELECT author_username, author_user_id, texto FROM profile_comments WHERE profile_user_id = $1 ORDER BY id DESC LIMIT 1",
    [profileId]
  );
  return r.rows[0];
}

before(async () => {
  db = await crearBaseLocal();
  usarSqlLocal(crearSqlPGlite(db));
  // El handler toma la conexión al cargarse (obtenerSql() en la primera
  // línea de api/content.js), así que se pide DESPUÉS de enchufar la
  // base local. Al revés, hablaría con la base de producción.
  contentHandler = require("../api/content");

  idAna = await crearUsuario("ana");
  idBeto = await crearUsuario("beto");
});

const ANA = () => ({ id: idAna, username: "ana" });
const BETO = () => ({ id: idBeto, username: "beto" });

// ==============================

describe("borrar mensajes del chat", () => {
  test("ana no puede borrar un mensaje de beto omitiendo el username", async () => {
    // ESTE es el bypass exacto. No mandar el campo apagaba el guard del
    // despachador -que solo compara `body.username` si existe- y, ya
    // dentro, el handler caía en la rama del DELETE por id a secas.
    const id = await mensajeDe("beto", idBeto, "algo que beto escribió");

    const r = await borrarChat({ messageId: id }, ANA());

    assert.equal(r.codigo, 403);
    assert.match(r.cuerpo.error, /propio/i);
    assert.ok(await existeMensaje(id), "el mensaje de beto debe seguir ahí");
  });

  test("ni declarando que es de beto: ahí lo corta el guard", async () => {
    // La puerta que todo el mundo creía que protegía la ruta. Sigue
    // cerrada, pero era la única de las dos y se esquivaba sola con solo
    // no escribir el campo (la prueba de arriba).
    const id = await mensajeDe("beto", idBeto, "otro de beto");

    const r = await borrarChat({ messageId: id, username: "beto" }, ANA());

    assert.equal(r.codigo, 403);
    assert.match(r.cuerpo.error, /no corresponde/i);
    assert.ok(await existeMensaje(id), "el mensaje de beto debe seguir ahí");
  });

  test("ana sí puede borrar el suyo", async () => {
    const id = await mensajeDe("ana", idAna, "algo mío");

    const r = await borrarChat({ messageId: id }, ANA());

    assert.equal(r.codigo, 200);
    assert.equal(r.cuerpo.success, true);
    assert.ok(!(await existeMensaje(id)), "el mensaje propio sí se borra");
  });

  test("sin sesión no se borra nada", async () => {
    const id = await mensajeDe("ana", idAna, "a ver si alguien lo borra");

    const r = await borrarChat({ messageId: id }, null);

    assert.equal(r.codigo, 401);
    assert.ok(await existeMensaje(id));
  });

  test("un mensaje viejo sin user_id lo borra su autor por el nombre", async () => {
    // Quedan 2 mensajes así en producción, de antes de que la tabla
    // tuviera la columna user_id. Si la consulta solo mirara
    // `user_id = req.auth.sub`, sus autores no podrían borrarlos nunca:
    // por eso lleva la segunda condición por nombre.
    const mio = await mensajeDe("ana", null, "un mensaje de los antiguos");

    const r = await borrarChat({ messageId: mio }, ANA());

    assert.equal(r.codigo, 200);
    assert.ok(!(await existeMensaje(mio)), "el autor sí debe poder borrar su mensaje antiguo");

    // Y esa segunda condición no puede ser un colador: sigue comparando
    // el nombre, así que el mensaje antiguo de otro tampoco se toca.
    const ajeno = await mensajeDe("beto", null, "un mensaje antiguo de beto");
    const r2 = await borrarChat({ messageId: ajeno }, ANA());

    assert.equal(r2.codigo, 403);
    assert.ok(await existeMensaje(ajeno));
  });
});

describe("borrar notificaciones", () => {
  test("ana no vacía las notificaciones de beto usando origenNombre", async () => {
    // ESTE es el bypass exacto: el guard deja pasar el `username` ajeno
    // porque `origenNombre` coincide con la sesión, y el handler viejo
    // borraba por ese `username`. Con esta llamada, beto perdía las
    // cinco cosas que tenía sin enterarse.
    await sembrarNotificaciones();

    const r = await borrarNotificaciones({ username: "beto", origenNombre: "ana" }, ANA());

    assert.equal(r.codigo, 200);
    assert.equal(await cuantasNotificaciones(idBeto), 3, "las de beto no se tocan");
  });

  test("y esa misma llamada sí borra las suyas: el cuerpo se ignora", async () => {
    // El DELETE ya no lee el cuerpo para nada: el dueño es req.auth.sub.
    // Da igual a nombre de quién venga escrita la petición.
    await sembrarNotificaciones();

    const r = await borrarNotificaciones({ username: "beto", origenNombre: "ana" }, ANA());

    assert.equal(r.codigo, 200);
    assert.equal(await cuantasNotificaciones(idAna), 0, "se borran las de la sesión");
  });

  test("sin sesión no se borra nada", async () => {
    await sembrarNotificaciones();

    const r = await borrarNotificaciones({ username: "ana" }, null);

    assert.equal(r.codigo, 401);
    assert.equal(await cuantasNotificaciones(idAna), 2);
    assert.equal(await cuantasNotificaciones(idBeto), 3);
  });
});

describe("firmar comentarios de perfil", () => {
  test("no se puede firmar con un nombre que no es el de la sesión", async () => {
    // ESTE es el bypass exacto: `authorUsername` no está entre los
    // campos que mira el guard, así que se usaba tal cual para firmar.
    const r = await comentar(
      { profileUsername: "beto", texto: "hola", authorUsername: "Administrador" },
      ANA()
    );

    assert.equal(r.codigo, 200);
    assert.equal(r.cuerpo.success, true);

    const fila = await ultimoComentario(idBeto);
    assert.equal(fila.author_username, "ana", "el comentario lo firma quien tiene la sesión");
    assert.equal(Number(fila.author_user_id), idAna);

    // La respuesta que ve el navegador dice lo mismo que la base: no se
    // devuelve el nombre suplantado para pintarlo en la lista.
    assert.equal(r.cuerpo.comentario.usuario, "ana");

    // El daño no era solo la firma: el aviso "X comentó en tu perfil"
    // que le llega al dueño del perfil salía con el nombre falso.
    const aviso = await db.query(
      "SELECT mensaje FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 1",
      [idBeto]
    );
    assert.match(aviso.rows[0].mensaje, /^ana comentó/);
  });

  test("tampoco con el nombre de una cuenta que sí existe", async () => {
    // La versión peligrosa de verdad: `getUserId(authorUsername)`
    // resolvía el author_user_id REAL de beto, y la fila quedaba
    // indistinguible de un comentario que hubiera escrito él.
    const r = await comentar(
      { profileUsername: "ana", texto: "me firmo como beto", authorUsername: "beto" },
      ANA()
    );

    assert.equal(r.codigo, 200);

    const fila = await ultimoComentario(idAna);
    assert.equal(fila.author_username, "ana");
    assert.equal(Number(fila.author_user_id), idAna, "no debe quedar a nombre de beto");
  });

  test("sin authorUsername el comentario sale igual de bien", async () => {
    // Antes, sin ese campo el comentario se firmaba "Usuario" y se
    // guardaba con author_user_id nulo, así que ni siquiera el camino
    // honesto dejaba constancia de quién había escrito.
    const r = await comentar({ profileUsername: "beto", texto: "sin firmar" }, ANA());

    assert.equal(r.codigo, 200);

    const fila = await ultimoComentario(idBeto);
    assert.equal(fila.texto, "sin firmar");
    assert.equal(fila.author_username, "ana");
    assert.equal(Number(fila.author_user_id), idAna);
  });

  test("sin sesión no se comenta", async () => {
    const antes = await db.query("SELECT count(*)::int AS n FROM profile_comments");

    const r = await comentar(
      { profileUsername: "beto", texto: "anónimo", authorUsername: "ana" },
      null
    );

    assert.equal(r.codigo, 401);
    const despues = await db.query("SELECT count(*)::int AS n FROM profile_comments");
    assert.equal(despues.rows[0].n, antes.rows[0].n, "no debe guardarse nada");
  });
});

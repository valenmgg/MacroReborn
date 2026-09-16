// ==============================
// AVATARES PNG SIN SU BASE64 — api/_avatar-ligero.js
// ==============================
// Un avatar subido como PNG guarda la imagen entera en base64 dentro de
// users.avatar. Esa columna viaja en cualquier consulta que la
// seleccione, así que una lista de gente puede acabar pesando megabytes
// por culpa de una sola cuenta.
//
// Pasó dos veces, con el mismo tamaño y todo:
//
//   /api/users            1,35 MB, de los cuales 1,31 MB era una cuenta
//   /api/social?friends   1,35 MB, de los cuales 1,31 MB era una cuenta
//
// El arreglo se hizo primero solo en api/users.js, y api/social.js se
// quedó con el problema durante meses. Por eso las dos piezas viven
// ahora acá: la que recorta en SQL y la que arma el puntero. Quien
// escriba una consulta nueva que traiga avatares tiene las dos a mano.
//
// Cómo funciona: en vez del base64 viaja un puntero de unos 80 bytes al
// endpoint que sirve esa imagen como PNG de verdad. El navegador la pide
// una vez y la cachea como cualquier otra imagen.
//
// El "v" del puntero es la huella del contenido: mientras el avatar no
// cambie la URL es la misma y el navegador ni pregunta; si la persona se
// cambia el PNG, cambia la huella, cambia la URL y se ve al instante.
// Eso es lo que permite cachear un año sin quedarse nunca con la imagen
// vieja.

// El recorte, en la consulta y no en JavaScript: así el megabyte ni
// siquiera sale de la base. No se lee del disco, no viaja al proceso y
// no hay que reservarle memoria en un servidor de 950 MB.
//
// Los avatares normales (recetas de capas) pasan enteros, intactos.
//
// Se recibe `sql` en vez de importarlo para que el fragmento se arme con
// el mismo tag que la consulta donde se va a incrustar.
function fragmentoAvatarLigero(sql) {
  return sql`
    CASE WHEN u.avatar->>'tipo' = 'png'
      THEN jsonb_build_object(
             'tipo', 'png',
             'huella', left(md5(u.avatar->>'src'), 12),
             'restaurar', u.avatar->'restaurar'
           )
      ELSE u.avatar
    END AS avatar`;
}

// La otra mitad, y es obligatoria: la consulta deja una "huella" y esto
// la convierte en la URL que el navegador entiende.
//
// Sin este paso el frontend recibe {tipo:"png", huella:"..."} y
// avatarPNGData() en js/core.js devuelve null, porque solo acepta un
// "src" con data:image/png o una "url" propia. Resultado: la respuesta
// pesa poco y el avatar no se dibuja.
//
// No es hipotético: se soltó así en producción durante unas horas al
// añadir el parámetro ?ligero=1 a la lectura de un usuario suelto.
// Recortar sin convertir es cambiar un problema de peso por uno de que
// no se ve nada.
function aligerarAvatarPNG(usuario) {
  const avatar = usuario && usuario.avatar;

  // Según el driver, un jsonb puede llegar ya parseado o como texto.
  let datos = avatar;
  if (typeof datos === "string") {
    try { datos = JSON.parse(datos); } catch (_) { return usuario; }
  }

  if (!datos || typeof datos !== "object" || datos.tipo !== "png") return usuario;

  // Si no hay huella, el avatar no pasó por fragmentoAvatarLigero() y se
  // deja como está antes que devolver un puntero roto.
  if (typeof datos.huella !== "string" || !datos.huella) return usuario;

  const nombre = usuario.username || usuario.nombre;
  if (!nombre) return usuario;

  return {
    ...usuario,
    avatar: {
      tipo: "png",
      url: "/api/users?action=avatar-png&username=" +
           encodeURIComponent(nombre) + "&v=" + datos.huella,
      // "restaurar" es la receta de capas que la persona tenía antes de
      // ponerse el PNG. Son unos pocos cientos de bytes y el perfil la
      // necesita para el botón de volver al avatar normal.
      restaurar: datos.restaurar || null
    }
  };
}

module.exports = { fragmentoAvatarLigero, aligerarAvatarPNG };

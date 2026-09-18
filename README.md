# MacroReborn — documentación para desarrolladores

Documentación técnica del proyecto MacroReborn, pensada para cualquier
desarrollador que trabaje en el código: cómo está armado, qué sistemas
existen y cómo probar los cambios localmente.

Índice de guías:

| Guía | Contenido |
|---|---|
| `docs/DESARROLLO.md` | Módulos del backend, infraestructura local (PGlite, servidor local, tests) y despliegue |
| `docs/SEGURIDAD.md` | Sistema de hash de contraseñas, migración de datos existentes y plan de activación |
| `docs/JUEGOS.md` | Cómo agregar un juego al catálogo: proceso completo, prueba local y notas de Ruffle/CORS e iframes |
| `docs/VPS.md` | El servidor: máquina, nginx, base de datos, respaldos, seguridad y despliegue |
| `docs/SEO.md` | Metadatos, sitemap, robots y lo que quedó recomendado para la v1.0 |
| `docs/AUDITORIA.md` | Lista viva de lo que hay por arreglar, por orden de importancia, con su estado |

---

## Qué es el proyecto

MacroReborn es una comunidad de juegos web: un catálogo de juegos
gratis online (estáticos, del lado del navegador) con ficha por juego,
calificaciones, reseñas, favoritos, historial, ranking por tiempo
jugado, amigos, chat, notificaciones y perfiles de usuario.

## Stack

- **Frontend**: HTML/CSS/JS vanilla (sin frameworks), en la raíz del
  repo y en `js/`.
- **Backend**: handlers en `api/` servidos por `server.js` sobre Node,
  contra un PostgreSQL en el mismo VPS. Antes era serverless en Vercel
  contra Neon; la mudanza está contada en `docs/VPS.md`.
- **Catálogo de juegos**: datos estáticos en `js/datos-juegos.js`; los
  juegos en sí se referencian desde CDNs externos (nada de binarios en
  el repo).
- **Desarrollo local**: base de práctica PGlite (Postgres embebido en
  WASM) y un servidor local para probar en el navegador.

## Cómo probar localmente

```bash
npm install        # instala las dependencias (solo la primera vez)
npm test           # tests automáticos (base local, no toca la real)
npm run test:smoke  # smoke test HTTP: levanta y cierra un servidor local efímero
npm run db:local   # sitio local en http://localhost:3001
```

Todo corre en la máquina de desarrollo; nada toca la base real ni el
servidor de producción. Detalles en `docs/DESARROLLO.md`.

## Sistemas documentados

- **Contraseñas**: hash bcrypt, migración perezosa de usuarios
  existentes y backfill protegido — ver `docs/SEGURIDAD.md`.
- **Juegos**: cómo se agrega un juego nuevo al catálogo (datos,
  portada, sitemap, prueba local) — ver `docs/JUEGOS.md`.
- **Avisos en vivo**: cómo aparece una notificación sin recargar, con
  Server-Sent Events servidos por la propia máquina — ver
  `docs/DESARROLLO.md` §9.

## Convenciones del proyecto

- Comentarios y mensajes en español, explicando el "por qué".
- Sin emojis en código, consola, commits y documentación nueva.
- Un cambio lógico por commit, sin firmas ni pies de autoría
  automáticos.
- Reutilizar lo que ya existe (helpers compartidos, patrones del
  catálogo) en lugar de crear sistemas paralelos.


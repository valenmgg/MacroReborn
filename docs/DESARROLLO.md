# DESARROLLO — backend e infraestructura local

Guía técnica del backend del proyecto y de la infraestructura local
para desarrollar y probar: la conexión a la base de datos, el sistema
de contraseñas, y las herramientas locales (PGlite, servidor local,
backfill y tests).

---

## 1. Qué cubre esta guía

- Los módulos compartidos del backend (`api/_db.js`, `api/_password.js`,
  `api/_pusher.js`, `api/_monedas.js`) y los cambios en `api/auth.js`,
  `api/users.js` y `api/content.js`.
- La infraestructura local: `scripts/pglite.js`,
  `scripts/servidor-local.js`, `scripts/migrar-passwords.js` y
  `scripts/smoke-local.js`, junto con los tests de `tests/`.
- Cómo correr, probar y desplegar, y las convenciones del proyecto.

## 2. Módulos nuevos del backend

### 2.1 `api/_db.js` — conector único de base

Antes cada archivo de la API creaba su conexión con
`neon(process.env.DATABASE_URL)`. Ahora la conexión pasa por acá:

- `obtenerSql()` → devuelve la función `sql` lista (Neon en
  producción).
- `usarSqlLocal(sqlLocal)` → reemplaza la conexión por una base local
  (PGlite) en desarrollo/tests.

Los handlers de esta rama (`api/auth.js`, `api/users.js` y
`api/content.js`) usan `obtenerSql()` en vez de crear la conexión a mano.
Los otros archivos de la API (`social.js`, `system.js`) no se tocaron.

### 2.2 `api/_password.js` — contraseñas

El único lugar que sabe hashear y verificar contraseñas:

- Funciones puras: `hashContrasena(plana)`, `verificarHash(plana,
  hash)`, `verificarContrasenaYMigrar(sql, username, plana)`.
- Clase `PasswordService(sql)` con `registrar`, `verificar`,
  `cambiarContrasena` y `eliminarCuenta`.

Detalles del flujo (ver `docs/SEGURIDAD.md` para el panorama
completo):

- **Registro**: guarda solo `password_hash`; el texto plano nunca se
  escribe.
- **Login**: si el usuario tiene hash, compara con bcrypt; si todavía
  tiene texto plano (usuario viejo), compara el texto y, si coincide,
  migra a hash en la misma operación (migración perezosa).

### 2.3 `api/_pusher.js` — instancia muda

Si faltan las variables `PUSHER_*` (típico en desarrollo local),
`getPusher()` devuelve una instancia "muda" (`trigger` no hace nada)
en vez de una rota que explota en cada aviso. En producción las
variables siempre existen, así que ahí no cambia nada.

### 2.4 Cambios en `api/auth.js` y `api/users.js`

| Archivo | Acciones que ahora usan `PasswordService` |
|---|---|
| `api/auth.js` | `login`, `register`, `delete-account` |
| `api/users.js` | `change-password` |

Las respuestas al frontend mantienen exactamente la misma forma que
antes (el contrato de la API no cambió).

## 3. Infraestructura local

### 3.1 `scripts/pglite.js` — base de práctica

- `crearBaseLocal()` → crea un Postgres real embebido (PGlite, WASM),
  arma la tabla `users` base y aplica todas las migraciones de
  `migrations/` en orden (incluidas la 013, 014 y 015).
- `crearSqlPGlite(db)` → adaptador que imita la interfaz del driver de
  Neon (`sql\`...\``), para que los mismos handlers corran contra la
  base local. Soporta **fragmentos SQL anidados**: pedazos `sql\`...\``
  incrustados dentro de otros (como hace `api/users.js` con
  `semanaActualSQL`); un fragmento solo se ejecuta cuando se espera
  con `await`, y al incrustarse se pega su SQL con los parámetros
  renumerados.

### 3.2 `scripts/servidor-local.js` — probar en el navegador

```bash
npm run db:local
```

Abre `http://localhost:3001`:

- Sirve los archivos estáticos del sitio.
- Rutea `/api/auth` y `/api/users` con los handlers reales contra la
  base de práctica (son las únicas rutas que toca esta rama).
- Crea un usuario de prueba `demo` / `demo1234` con contraseña en
  texto plano, para ver la migración perezosa en vivo: la consola
  avisa `"demo" entró: su contraseña en texto plano fue migrada a
  hash` solo cuando hubo una migración real (los usuarios nuevos no
  imprimen nada).
- Limitación a propósito: `/api/content`, `/api/social` y
  `/api/system` no están activados en el modo local; las secciones que
  los usan se ven vacías (esperado).

### 3.3 `scripts/migrar-passwords.js` — backfill

Pica las contraseñas en texto plano restantes y borra el texto.
Protecciones (ver `docs/SEGURIDAD.md`):

- Sin `--local` ni `--produccion` se niega a correr.
- `--produccion` exige confirmación escrita ("SI").
- `--simular` solo muestra qué haría.
- Con `--produccion` verifica que la migración 013 esté aplicada.

### 3.4 `tests/password.test.js` — tests

```bash
npm test
```

Usa `node:test` (incluido en Node). Los tests crean su propia base de
práctica, inyectan la conexión con `usarSqlLocal()` y ejercitan los
handlers reales. Cubren: registro con hash, login correcto/incorrecto,
migración legacy, cambio de contraseña, borrado de cuenta y usuario
duplicado.

### 3.5 `tests/monedas.test.js` — reglas de monedas

Se ejecuta junto con `npm test` y usa una base PGlite nueva por suite. Cubre
el primer otorgamiento, la ventana de diez minutos, el tope diario, el
overshoot permitido, el reseteo perezoso UTC, llamadas concurrentes,
`gastar()`/`consultarSaldo()` y el enganche real de monedas en el handler de
XP y en la tienda.

### 3.6 `tests/migrations.test.js` — contrato de la migración 015

Comprueba que las tres columnas nuevas existen con tipo, default y nulabilidad
correctos, que la columna `users.monedas` conserva su saldo y que volver a
aplicar la migración es seguro. La base es efímera: al terminar el proceso no
queda ningún archivo ni conexión con Neon.

### 3.7 `scripts/smoke-local.js` — prueba HTTP de extremo a extremo

```bash
npm run test:smoke
```

El script busca un puerto libre, arranca `scripts/servidor-local.js` con una
PGlite efímera, comprueba que el sitio responde, hace login con `demo` /
`demo1234`, envía dos pulsos de XP y verifica que el primero otorga entre 10 y
30 monedas y el segundo devuelve el no-op de diez minutos. Siempre termina el
proceso hijo, también cuando falla una aserción. No necesita una base externa;
el servidor local usa un secreto efímero por defecto solo cuando no se
proporciona `SESSION_SECRET` en el entorno.

### 3.8 Verificación manual en navegador

La automatización no sustituye la comprobación visual del flujo del sitio.
Para hacerla sin tocar la base real:

1. Ejecutar `npm run db:local` y abrir `http://localhost:3001/login.html`.
2. Entrar como `demo` / `demo1234`; la consola del servidor debe mostrar la
   migración perezosa de la contraseña solo en el primer login.
3. Abrir `http://localhost:3001/jugar.html?id=112`, dejar la pestaña activa y
   abrir DevTools → Network. Cada minuto debe aparecer
   `POST /api/users?action=xp` con `success: true` y un objeto `monedas`.
4. En el primer pulso de un usuario nuevo se verá `otorgado: true` y un monto
   entre 10 y 30. Los pulsos siguientes durante los diez minutos siguientes
   deben mostrar `otorgado: false`, `monto: 0` y
   `razon: "aun-no-pasaron-10-minutos"`. El frontend todavía no muestra un
   toast de monedas, por decisión de alcance de esta rama.
5. Para observar un nuevo premio hay que dejar transcurrir diez minutos
   reales (el smoke test y los tests unitarios simulan el tiempo; no hace
   falta esperar para validar la regla automáticamente).

El servidor local solo enruta `/api/auth` y `/api/users`. Por eso la compra de
un avatar se valida automáticamente contra el handler real en
`tests/monedas.test.js`; probar la pantalla de tienda requiere un entorno de
staging que tenga `/api/content` habilitado y no debe hacerse contra
producción durante esta fase.

## 4. Despliegue de estos cambios

Orden estricto (la migración SIEMPRE antes que el código que la usa):

1. Aplicar la migración 013 a la base de producción (agrega
   `users.password_hash`).
2. Aplicar la migración 014 (quita el NOT NULL de `users.password`;
   sin ella, registro y login fallan con el error de not-null
   constraint — ver `docs/SEGURIDAD.md`).
3. Aplicar la migración 015 (agrega la contabilidad de monedas por tiempo;
   no modifica `users.monedas`).
4. Desplegar el código nuevo (todo el repo).
5. Verificar: registrar un usuario de prueba y entrar con un usuario
   existente (se migra solo).
6. Correr el backfill con `--produccion` (cubre a los que no entran).
7. Verificar que no quede texto plano:
   `SELECT COUNT(*) FROM users WHERE password IS NOT NULL;` → 0.
8. Recién entonces planificar una migración futura (borrar
   `users.password` y la rama legacy de `api/_password.js`).

Si se despliega el código sin la 013, registro y login fallan (la
columna `password_hash` no existe). Si se despliega sin la 014,
fallan por la restricción NOT NULL de `password`. Si se despliega sin la
015, el primer pulso de XP intentará usar columnas que no existen. Las tres
migraciones van antes que el código.

## 5. Convenciones del proyecto

- **Idioma**: comentarios y mensajes en español, explicando el "por
  qué".
- **Sin emojis**: en código, consola, commits y documentación nueva.
  Lo preexistente no se toca.
- **Commits**: un cambio lógico por commit, sin firmas ni pies de
  autoría automáticos.
- **Reutilizar**: la lógica compartida va en `api/_*.js`; no duplicar
  lo que ya existe.

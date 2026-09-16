# SEGURIDAD — sistema de contraseñas

Documentación del sistema de seguridad de contraseñas del proyecto:
el hash con bcrypt, la migración de los datos existentes y el plan
para activarlo en producción.

---

## 1. El problema que se atacó

El proyecto guardaba las contraseñas en TEXTO PLANO en la columna
`users.password`, y el login comparaba directo en SQL
(`WHERE username = ? AND password = ?`). Cualquiera con acceso a la
base podía leer la contraseña de todos los usuarios. Ese era el riesgo
más grave y fue lo primero que se resolvió.

## 2. La solución

- **bcryptjs**: se guarda solo un hash de la contraseña (no se puede
  revertir), con costo de trabajo 10.
- **Columna nueva `users.password_hash`** (migración 013). La columna
  vieja `password` se conserva durante la transición (sin su
  restricción NOT NULL, ver migración 014) y se borra recién en una
  migración futura, después del período de gracia.
- **Módulo `api/_password.js`**: funciones puras (`hashContrasena`,
  `verificarHash`, `verificarContrasenaYMigrar`) + clase
  `PasswordService`.

### 2.1 Qué hace cada operación

- **Registro** (`api/auth.js`): guarda SOLO el hash. El texto plano
  nunca se escribe en la base.
- **Login** (`api/auth.js`): busca al usuario por nombre y verifica:
  1. Si tiene `password_hash` → compara con bcrypt.
  2. Si todavía tiene texto plano (usuario viejo) → compara el texto;
     si coincide, pica la contraseña, guarda el hash y borra el texto
     plano en la misma operación (migración perezosa).
- **Cambio de contraseña** (`api/users.js`): verifica la actual (con
  migración incluida si hace falta) y guarda solo el hash de la nueva.
- **Borrado de cuenta** (`api/auth.js`): verifica la contraseña antes
  de borrar.

### 2.2 Por qué no se puede "perder" una contraseña

El borrado del texto plano y el guardado del hash ocurren en una única
instrucción SQL (`SET password_hash = ..., password = NULL`), y el
hash se genera a partir de la misma contraseña. No existe un estado
intermedio en el que el texto desaparezca sin que el hash quede
guardado y funcione.

## 3. Backfill (`scripts/migrar-passwords.js`)

La migración perezosa cubre a los usuarios que vuelven a entrar. El
backfill cubre al resto (los que nunca más entran), picando todas las
contraseñas en texto plano de una sola vez.

### 3.1 Alcance

Solo toca las columnas `password` / `password_hash` de la tabla
`users`. No borra usuarios ni modifica ninguna otra tabla. Es seguro
de re-ejecutar.

### 3.2 Protecciones

- **`--local`** → corre contra la maqueta PGlite (crea usuarios de
  prueba). Sin riesgo.
- **`--produccion`** → obligatorio para tocar la base real; sin esa
  bandera el script se niega a correr.
- **Confirmación escrita**: con `--produccion`, pide tipear "SI"
  antes de tocar nada.
- **`--simular`** → solo muestra qué haría, no cambia nada.
- **Chequeo de migración**: con `--produccion` verifica que la
  columna `password_hash` exista (migración 013); si no, se detiene
  sin cambios.

### 3.3 Uso

```bash
node scripts/migrar-passwords.js --local --simular   # ver qué haría (local)
node scripts/migrar-passwords.js --local             # ejecutar en la maqueta
DATABASE_URL="postgres://..." node scripts/migrar-passwords.js --produccion --simular  # ver qué haría (real)
DATABASE_URL="postgres://..." node scripts/migrar-passwords.js --produccion           # ejecutar (pide confirmación)
```

## 4. Pruebas

`tests/password.test.js` (correr con `npm test`) crea su propia base de
práctica y ejercita los handlers reales:

- El registro guarda solo el hash, nunca el texto plano.
- El login acepta la contraseña correcta y rechaza la incorrecta, sin
  filtrar campos de contraseña en la respuesta.
- Un usuario legacy (texto plano) entra y queda migrado a hash en el
  momento.
- El cambio de contraseña verifica la actual, guarda el hash nuevo y
  deja de aceptar la vieja.
- El borrado de cuenta exige la contraseña correcta y elimina al
  usuario.
- El registro rechaza nombres de usuario duplicados.

## 5. Plan de activación en producción

Orden estricto:

1. Aplicar la migración 013 (agrega `users.password_hash`).
2. Aplicar la migración 014 (quita el NOT NULL de `users.password`).
   Este paso es OBLIGATORIO: sin él, el registro y el login fallan con
   `null value in column "password" violates not-null constraint`,
   porque el código nuevo ya no escribe en `password` pero la columna
   sigue marcada como obligatoria (fue el error que se vio en
   producción).
3. Desplegar el código nuevo (`api/_db.js`, `api/_password.js`,
   `api/auth.js`, `api/users.js`, `api/_pusher.js`).
4. Verificar: registrar un usuario de prueba y entrar con un usuario
   existente (se migra solo).
5. Correr el backfill con `--produccion` (cubre a los que no entran).
6. Verificar que no quede texto plano:
   `SELECT COUNT(*) FROM users WHERE password IS NOT NULL;` → 0.
7. Tras un período de gracia: crear una migración futura para borrar
   `users.password` y quitar la rama de comparación legacy de
   `api/_password.js`.

### Estado (16/09/2026)

Los pasos 1 a 6 están hechos. El backfill se corrió contra el VPS ese
día y migró 17 cuentas: las que tenían texto plano y ningún hash, o sea
las que no habían vuelto a entrar desde el despliegue (las otras 124 ya
las había migrado el login). Hoy `SELECT COUNT(*) FROM users WHERE
password IS NOT NULL` devuelve 0, y las 141 filas guardan un hash `$2b$`
de 60 caracteres.

Se comprobó además lo que el backfill no puede comprobar por sí solo:
que nadie perdió el acceso. Con el respaldo anterior al cambio delante,
se verificó con `bcrypt.compare` que las 17 contraseñas originales
validan contra su hash nuevo. 17 de 17.

Una trampa que casi se cuela, por si se repite la comprobación: verificar
el formato con una expresión regular a través de `ssh ... psql -c "..."`
no funciona. Los `$` se expanden por el camino, el patrón llega vacío y
**devuelve 0 coincidencias sin error**, que es justo lo que uno quiere
ver. Es más seguro agrupar por `left(password_hash, 4)`, que no lleva
caracteres especiales.

Queda el paso 7, y queda a propósito: `users.password` sigue existiendo y
`api/_password.js` conserva su rama legacy.

Lo que el backfill **no** limpia son los respaldos ya sacados: cualquier
`.sql.gz` anterior al 16/09/2026 sigue llevando esas 17 contraseñas en
claro. En el VPS se borran solos a los 14 días; una copia bajada a un
portátil, no (ver `docs/DESARROLLO.md` §8).

Si se despliega el código sin la 013, registro y login fallan (la
columna `password_hash` no existe). Si se despliega sin la 014,
registro y login fallan por la restricción NOT NULL de `password`.
Por eso el orden importa: migraciones primero, código después.

## 6. Alcance (qué NO incluyó)

El sistema de hash de contraseñas no incluye (ni modifica):
sesiones/autenticación real, verificación de permisos de moderación en
los endpoints, rate limiting en login/registro y el escapado de
contenido generado por usuarios. Son candidatos para futuras
iteraciones.

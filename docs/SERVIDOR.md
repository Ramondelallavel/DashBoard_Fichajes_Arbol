# Modo servidor (multiusuario)

La aplicación funciona de dos formas con el mismo código de interfaz:

| | Modo local | Modo servidor |
|---|---|---|
| Cómo se usa | Abrir la web compilada sin servidor (o el artefacto) | `node dist-server/server.mjs` sirve la web y la API |
| Datos | En el navegador de cada usuario (IndexedDB) | Base de datos del servidor, compartida |
| Usuarios | Un usuario; perfil elegido en la barra superior para probar permisos | Inicio de sesión; perfil asignado por un administrador |
| Permisos | Solo en la interfaz | Aplicados por el servidor |
| Revisiones, validaciones, configuración | Locales | Compartidas, con usuario y fecha fijados por el servidor |

La aplicación detecta el modo al arrancar (`GET /api/health`).

## Requisitos e instalación

- Node.js **22.13 o superior** (usa la base de datos SQLite integrada en Node, `node:sqlite`; no hay módulos nativos que compilar).
- Funciona en Linux y en Windows Server.

```bash
npm ci
```

```bash
npm run build:all
```

```bash
cp .env.example .env
```

Edite `.env` (puerto, carpeta de datos, administrador inicial) y arranque:

```bash
npm run start:env
```

Abra `http://servidor:3000`. En el primer arranque se crea el administrador `ADMIN_USERNAME`:

- con la contraseña de `ADMIN_PASSWORD`; o
- si se deja vacía, con una contraseña temporal que se muestra **una sola vez** en la consola y que
  hay que cambiar al entrar.

Node muestra el aviso `ExperimentalWarning: SQLite is an experimental feature`: es informativo.

### Desarrollo

```bash
npm run dev:server
```

```bash
npm run dev
```

Vite redirige `/api` al servidor de desarrollo (puerto 3000).

## Despliegue recomendado

- Detrás de un proxy inverso con HTTPS (nginx, IIS, Apache). Configure `TRUST_PROXY=true` y deje
  `COOKIE_SECURE=auto` (o `true`) para que la cookie de sesión solo viaje por HTTPS.
- Ejecútelo como servicio (systemd en Linux; NSSM o el Programador de tareas en Windows).
- **Copias de seguridad**: la base de datos es el archivo `DATA_DIR/planificacion.db` (más sus ficheros
  `-wal`/`-shm`). Copie la carpeta con el servicio parado, o use `sqlite3 planificacion.db ".backup copia.db"`.
- `MAX_UPLOAD_MB` limita el tamaño de una importación (los datos normalizados viajan en JSON).

## Variables de entorno

| Variable | Por defecto | Uso |
|---|---|---|
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Puerto y dirección de escucha |
| `DATA_DIR` | `./data` | Carpeta de la base de datos |
| `DB_PATH` | `DATA_DIR/planificacion.db` | Ruta completa de la base de datos (opcional) |
| `STATIC_DIR` | `./dist` | Web compilada |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / vacío | Administrador inicial (solo si no hay usuarios) |
| `SESSION_HOURS` | `12` | Caducidad de la sesión sin actividad |
| `COOKIE_SECURE` | `auto` | `auto`, `true` o `false` |
| `TRUST_PROXY` | `false` | `true` detrás de un proxy inverso |
| `MAX_UPLOAD_MB` | `300` | Tamaño máximo de una importación |
| `LOG_LEVEL` | `info` | `silent`, `error`, `warn`, `info`, `debug` |

Ninguna credencial está en el código ni en el repositorio (`.env` está excluido en `.gitignore`).

## Seguridad

- **Contraseñas**: scrypt con sal aleatoria; mínimo 10 caracteres con letras y números. Cambio obligatorio
  en el primer acceso y tras un restablecimiento.
- **Sesiones**: token aleatorio de 256 bits en cookie `HttpOnly`, `SameSite=Strict` (y `Secure` con HTTPS).
  En la base de datos solo se guarda su huella SHA-256. Caducidad deslizante. Al desactivar un usuario,
  cambiarle el perfil o restablecer su contraseña se cierran sus sesiones.
- **Fuerza bruta**: bloqueo de 15 minutos tras 5 intentos fallidos por usuario y dirección IP.
- **CSRF**: las peticiones que modifican datos exigen una cabecera propia y, si llevan `Origin`, que sea el mismo origen.
- **Permisos en el servidor** con la misma matriz que la interfaz (`src/auth/roles.ts`).
- **Validación** de todo lo que envía el cliente (tipos, tamaños, valores permitidos).
- **Cabeceras**: `Content-Security-Policy` restrictiva, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`.
- **Registro de actividad**: accesos (también fallidos), importaciones, cambios de configuración, validaciones
  y gestión de usuarios.
- Los datos de auditoría (usuario y fecha de una importación o revisión) los fija el servidor, no el cliente.

### Inicio de sesión corporativo (SSO)

La sesión del servidor es independiente de cómo se autentica el usuario (`SessionUser` en `server/auth.ts`).
Para integrar un proveedor corporativo (Azure AD / Entra ID, Keycloak, ADFS mediante OpenID Connect) basta con
añadir las rutas del flujo OIDC que, tras validar el token del proveedor, creen la misma sesión. No está
implementado porque requiere los datos del proveedor de la empresa.

## Concurrencia

Cada importación indica la versión sobre la que se preparó. Si otro usuario ha importado antes una versión
nueva de la misma fuente, el servidor responde **409** y no guarda nada; el asistente recarga los datos y
vuelve a calcular la validación frente a la versión vigente para que el usuario confirme de nuevo.
Los demás usuarios ven un aviso («Ana Planificación importó… — Actualizar ahora») en un máximo de 30 segundos.

## API

Todas las rutas (salvo `health`, `auth/login`, `auth/logout` y `auth/session`) requieren sesión.

| Método y ruta | Permiso | Uso |
|---|---|---|
| `GET /api/health` | — | Modo y versión |
| `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/session` | — | Sesión |
| `POST /api/auth/password` | sesión | Cambiar la propia contraseña |
| `GET /api/state` | sesión | Datos activos, historial, configuración, revisiones, validaciones y filtros propios |
| `GET /api/revision` | sesión | Último cambio (para avisar a los demás usuarios) |
| `GET /api/datasets/:id`, `GET /api/raw/:batchId` | sesión | Versión de datos y datos originales de una importación |
| `POST /api/imports` | importar | Confirmar una importación (control de versión) |
| `DELETE /api/data` | borrar_datos | Borrar los datos importados |
| `PUT /api/settings` | configurar_capacidad o configurar | Configuración (el servidor comprueba qué apartados cambian) |
| `PUT/DELETE /api/profiles/:id` | importar | Perfiles de columnas |
| `PUT /api/reviews/:alertId` | revisar_alertas | Revisión de una alerta o discrepancia |
| `PUT /api/manual`, `DELETE /api/manual/:id` | validar_relaciones | Validaciones manuales del árbol |
| `PUT/DELETE /api/filters/:id` | sesión | Filtros guardados (de cada usuario) |
| `GET/POST /api/users`, `PATCH /api/users/:id`, `GET /api/audit` | administrar_usuarios | Usuarios y registro de actividad |

## Base de datos

SQLite en modo WAL. Tablas: `users`, `sessions`, `batches`, `raw_sheets`, `datasets`, `active`, `settings`,
`profiles`, `reviews`, `manual`, `saved_filters`, `audit`, `meta`. Los objetos de dominio se guardan como JSON
(las mismas estructuras que usa el cliente), con columnas para las consultas. Para usar PostgreSQL o SQL Server
basta con reimplementar `server/db.ts` y las consultas de `server/app.ts`.

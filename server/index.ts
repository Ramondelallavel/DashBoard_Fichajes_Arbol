/**
 * Arranque del servidor. Toda la configuración se lee de variables de entorno (ver .env.example);
 * no hay credenciales en el código.
 *   npm run build && npm run build:server && node --env-file=.env dist-server/server.mjs
 */
import { join, resolve } from 'node:path';
import { buildApp, type AppConfig } from './app';

const env = process.env;
const cfg: AppConfig = {
  dbPath: env.DB_PATH ?? join(resolve(env.DATA_DIR ?? 'data'), 'planificacion.db'),
  staticDir: resolve(env.STATIC_DIR ?? 'dist'),
  sessionHours: Math.max(1, Number(env.SESSION_HOURS ?? 12) || 12),
  cookieSecure: (['auto', 'true', 'false'].includes(env.COOKIE_SECURE ?? '') ? env.COOKIE_SECURE : 'auto') as AppConfig['cookieSecure'],
  maxUploadMb: Math.max(5, Number(env.MAX_UPLOAD_MB ?? 300) || 300),
  trustProxy: env.TRUST_PROXY === 'true',
  logLevel: env.LOG_LEVEL ?? 'info',
  adminUsername: env.ADMIN_USERNAME,
  adminPassword: env.ADMIN_PASSWORD,
};

const { app, bootstrap } = buildApp(cfg);
if (bootstrap.created) {
  if (bootstrap.generatedPassword) {
    // Solo se muestra una vez, en la consola del servidor; se exige cambiarla en el primer acceso.
    console.warn(`\n  Usuario administrador inicial: ${bootstrap.username}\n  Contraseña temporal (cámbiela al entrar): ${bootstrap.generatedPassword}\n`);
  } else {
    console.warn(`\n  Usuario administrador inicial creado: ${bootstrap.username} (contraseña de ADMIN_PASSWORD)\n`);
  }
}

const port = Number(env.PORT ?? 3000);
const host = env.HOST ?? '0.0.0.0';
app.listen({ port, host }).catch((e) => {
  console.error(e);
  process.exit(1);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void app.close().then(() => process.exit(0));
  });
}

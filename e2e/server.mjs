/**
 * Prueba de extremo a extremo del MODO SERVIDOR con dos usuarios simultáneos (dos navegadores).
 * Requiere: npm run build && npm run build:server
 * Uso: npm run e2e:server
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require('/opt/node-tools/node_modules/playwright');
}
const out = process.env.E2E_OUT ?? join(process.cwd(), 'e2e', 'output');
mkdirSync(out, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), 'pi-e2e-'));
const PORT = 4181;
const URL = `http://localhost:${PORT}/`;
const ADMIN_PW = 'Prueba-admin-2026';
const server = spawn(process.execPath, ['dist-server/server.mjs'], {
  stdio: 'pipe',
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, STATIC_DIR: join(process.cwd(), 'dist'), ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: ADMIN_PW, LOG_LEVEL: 'warn', COOKIE_SECURE: 'false' },
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(`${URL}api/health`);
    if (r.ok) break;
  } catch {
    /* esperando */
  }
  await new Promise((r) => setTimeout(r, 250));
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const browser = await playwright.chromium.launch();
const errors = [];
const watch = (page, who) => {
  page.on('pageerror', (e) => errors.push(`${who} pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/fonts\.(googleapis|gstatic)|net::ERR/.test(m.text()) && errors.push(`${who} console: ${m.text()}`));
};
async function login(page, user, pw) {
  await page.goto(URL);
  await page.getByRole('heading', { name: 'Iniciar sesión' }).waitFor({ timeout: 20000 });
  await page.locator('#lg-user').fill(user);
  await page.locator('#lg-pass').fill(pw);
  await page.getByRole('button', { name: 'Entrar' }).click();
}
try {
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-ES', timezoneId: 'Europe/Madrid' });
  const admin = await ctxA.newPage();
  watch(admin, 'admin');
  await login(admin, 'admin', ADMIN_PW);
  await admin.getByText('Todavía no hay datos importados').waitFor({ timeout: 20000 });
  check('El administrador inicia sesión (servidor sin datos)', true);
  await admin.screenshot({ path: join(out, 'srv-01-admin-vacio.png') });

  await admin.getByRole('button', { name: 'Cargar datos de demostración' }).first().click();
  await admin.getByText('Situación de fábrica').waitFor({ timeout: 40000 });
  const ap = await admin.locator('.kpi').filter({ hasText: 'Aparatos' }).locator('.value').innerText();
  check('Datos de demostración guardados en el servidor y analizados', ap.trim() === '48', `aparatos = ${ap}`);

  // Alta de un planificador
  await admin.goto(`${URL}#configuracion`);
  await admin.getByRole('button', { name: 'Nuevo usuario' }).click();
  await admin.locator('#nu-user').fill('plani');
  await admin.locator('#nu-name').fill('Ana Planificación');
  await admin.locator('#nu-role').selectOption('planificador');
  await admin.locator('#nu-pass').fill('Temporal-2026x');
  await admin.getByRole('button', { name: 'Crear usuario' }).click();
  await admin.getByRole('cell', { name: 'plani', exact: true }).waitFor();
  check('El administrador da de alta un usuario planificador', true);
  await admin.screenshot({ path: join(out, 'srv-02-usuarios.png') });

  // Segundo navegador: el planificador
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-ES', timezoneId: 'Europe/Madrid' });
  const plan = await ctxB.newPage();
  watch(plan, 'planificador');
  await login(plan, 'plani', 'Temporal-2026x');
  await plan.getByRole('heading', { name: 'Cambie su contraseña' }).waitFor();
  check('Primer acceso: se exige cambiar la contraseña', true);
  await plan.locator('#pw-cur').fill('Temporal-2026x');
  await plan.locator('#pw-new').fill('Personal-2026x');
  await plan.locator('#pw-rep').fill('Personal-2026x');
  await plan.getByRole('button', { name: 'Cambiar contraseña' }).click();
  await plan.getByText('Situación de fábrica').waitFor({ timeout: 40000 });
  const ap2 = await plan.locator('.kpi').filter({ hasText: 'Aparatos' }).locator('.value').innerText();
  check('El planificador ve los mismos datos compartidos', ap2.trim() === '48');
  const userBtn = await plan.getByRole('button', { name: /Ana Planificación/ }).count();
  check('El perfil lo fija la sesión (no hay selector de perfil)', userBtn === 1 && (await plan.getByLabel('Perfil de usuario (modo local)').count()) === 0);

  await plan.goto(`${URL}#importacion`);
  await plan.getByText('Historial de importaciones').waitFor();
  const delDisabled = await plan.getByRole('button', { name: /Borrar datos importados/ }).isDisabled();
  check('Permisos: el planificador no puede borrar los datos', delDisabled);

  // El planificador revisa una alerta
  await plan.goto(`${URL}#alertas`);
  await plan.locator('.vt-row').first().click();
  await plan.locator('#al-note').fill('Revisado con el jefe de taller');
  await plan.getByRole('button', { name: 'Marcar como revisada' }).click();
  await plan.waitForTimeout(500);

  // El administrador recibe el aviso de cambios de otro usuario
  await admin.goto(`${URL}#dashboard`);
  await admin.locator('.remote-banner').waitFor({ timeout: 45000 });
  const banner = await admin.locator('.remote-banner').innerText();
  check('Aviso al administrador de los cambios hechos por el planificador', /Ana Planificación/.test(banner), banner.replace(/\s+/g, ' ').slice(0, 90));
  await admin.screenshot({ path: join(out, 'srv-03-aviso-cambios.png') });
  await admin.getByRole('button', { name: 'Actualizar ahora' }).click();
  // el aviso desaparece cuando la recarga de datos ha terminado
  await admin.locator('.remote-banner').waitFor({ state: 'detached', timeout: 20000 });
  await admin.goto(`${URL}#alertas`);
  await admin.getByLabel('Estado de revisión').selectOption('revisada');
  await admin.locator('.vt-row').first().click();
  await admin.getByText(/Revisada · Ana Planificación \(planificador\)/).waitFor({ timeout: 10000 }).catch(() => undefined);
  const reviewedBy = await admin.getByText(/Revisada · Ana Planificación \(planificador\)/).count();
  check('La revisión es compartida y registra quién la hizo', reviewedBy === 1);
  await admin.keyboard.press('Escape');

  // Registro de actividad
  await admin.goto(`${URL}#configuracion`);
  await admin.getByText('Registro de actividad').waitFor();
  const activity = await admin.locator('table').filter({ hasText: 'Importación' }).count();
  check('Registro de actividad con importaciones y accesos', activity >= 1);

  // Cierre de sesión
  await plan.getByRole('button', { name: /Ana Planificación/ }).click();
  await plan.getByRole('menuitem', { name: 'Cerrar sesión' }).click();
  await plan.getByRole('heading', { name: 'Iniciar sesión' }).waitFor();
  check('Cierre de sesión', true);
  const st = await fetch(`${URL}api/state`);
  check('La API rechaza peticiones sin sesión', st.status === 401);

  check('Sin errores de JavaScript ni de consola', errors.length === 0, errors.slice(0, 4).join(' | '));
} catch (e) {
  check('Ejecución de la prueba', false, e.message);
  console.log(serverLog.slice(-2000));
} finally {
  await browser.close();
  server.kill();
  rmSync(dataDir, { recursive: true, force: true });
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} comprobaciones superadas.`);
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
}

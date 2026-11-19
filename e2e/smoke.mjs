/**
 * Prueba de extremo a extremo con un navegador real (Playwright + Chromium).
 * 1. Sirve la build de producción (dist/) con `vite preview`.
 * 2. Carga los datos de demostración y recorre todas las secciones.
 * 3. Importa los Excel ficticios de /samples con el asistente (flujo completo).
 * 4. Falla si hay errores de JavaScript o de consola.
 * Uso: npm run build && npm run samples && npm run e2e
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
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
const PORT = 4179;
const server = spawn(process.execPath, [join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', env: { ...process.env } });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('El servidor de vista previa no arrancó')), 30000);
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && (clearTimeout(t), resolve()));
});

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await playwright.chromium.launch();
let failed = false;
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-ES', timezoneId: 'Europe/Madrid', acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_TUNNEL|ERR_CONNECTION|net::ERR/.test(m.text()) && errors.push(`console: ${m.text()}`));
  await page.goto(`http://localhost:${PORT}/#dashboard`);
  await page.getByText('Todavía no hay datos importados').waitFor({ timeout: 20000 });
  check('Arranque sin datos muestra el estado vacío', true);

  await page.getByRole('button', { name: 'Cargar datos de demostración' }).first().click();
  await page.getByText('Situación de fábrica').waitFor({ timeout: 30000 });
  await page.waitForSelector('.kpi .value');
  const aparatos = await page.locator('.kpi').filter({ hasText: 'Aparatos' }).locator('.value').innerText();
  check('Dashboard con datos de demostración', aparatos.trim() === '48', `aparatos = ${aparatos}`);
  await page.screenshot({ path: join(out, '01-dashboard.png'), fullPage: false });

  // Gantt general
  await page.goto(`http://localhost:${PORT}/#gantt`);
  await page.waitForSelector('.gbar', { timeout: 15000 });
  const bars = await page.locator('.gbar').count();
  check('Gantt general renderiza barras', bars > 10, `${bars} barras visibles`);
  await page.getByRole('button', { name: 'Desplegar', exact: false }).first().click();
  await page.waitForTimeout(300);
  const opBars = await page.locator('.gbar.prod:not(.summary)').count();
  const ortBars = await page.locator('.gbar.ortems:not(.summary)').count();
  check('Gantt desplegado distingue producción y Ortems', opBars > 0 && ortBars > 0, `${opBars} barras de producción, ${ortBars} de Ortems`);
  for (const sc of ['Día', 'Mes', 'Trimestre', 'Año', 'Semana']) {
    await page.getByRole('group', { name: 'Escala temporal' }).getByRole('button', { name: sc, exact: true }).click();
    await page.waitForTimeout(150);
  }
  check('Cambio de escalas temporales (día, mes, trimestre, año, semana)', errors.length === 0);
  // Elegir una barra de operación realmente visible (a la derecha de la columna de etiquetas)
  await page.getByRole('group', { name: 'Escala temporal' }).getByRole('button', { name: 'Mes', exact: true }).click();
  await page.waitForTimeout(400);
  const box = await page.evaluate(() => {
    const label = document.querySelector('.gantt-corner')?.getBoundingClientRect();
    const scroller = document.querySelector('.gantt-scroll')?.getBoundingClientRect();
    for (const el of document.querySelectorAll('.gbar.prod:not(.summary)')) {
      const r = el.getBoundingClientRect();
      if (label && scroller && r.left > label.right + 4 && r.right < scroller.right - 4 && r.top > label.bottom && r.bottom < scroller.bottom && r.width > 4) return { x: r.left + Math.min(r.width / 2, 20), y: r.top + r.height / 2 };
    }
    return null;
  });
  check('Hay barras de operación visibles en la vista', !!box);
  await page.mouse.move(box.x, box.y);
  await page.waitForTimeout(200);
  const tip = await page.locator('.gtip').count();
  check('Información contextual al pasar el cursor', tip === 1);
  await page.screenshot({ path: join(out, '02-gantt.png') });
  await page.mouse.click(box.x, box.y);
  await page.getByText('Trazabilidad').waitFor({ timeout: 5000 });
  check('Detalle de operación con trazabilidad', (await page.getByText(/hoja «Operaciones» · fila \d+/).count()) > 0);
  await page.keyboard.press('Escape');

  // Filtros combinados
  await page.getByRole('button', { name: 'Filtros' }).first().click();
  await page.locator('#f-familias').click();
  await page.getByRole('listbox').getByText('Celda MT', { exact: true }).click();
  await page.keyboard.press('Escape');
  await page.locator('#f-year').selectOption('2026');
  await page.getByRole('group', { name: 'Semanas' }).getByRole('button', { name: '49', exact: true }).click();
  await page.getByRole('button', { name: 'Ver resultados' }).click();
  await page.waitForTimeout(400);
  const chips = await page.locator('.chip').count();
  const note = await page.locator('.hidden-note').innerText().catch(() => '');
  check('Filtros combinados (familia + semana ISO con año) con aviso de lo oculto', chips >= 2 && /Mostrando/.test(note), note.replace(/\s+/g, ' ').slice(0, 90));
  await page.getByRole('button', { name: 'Limpiar', exact: true }).click();

  // Gantt por aparato con dependencias
  await page.goto(`http://localhost:${PORT}/#gantt-aparato`);
  await page.waitForSelector('.gantt-deps > path', { timeout: 15000, state: 'attached' });
  check('Gantt por aparato con dependencias dibujadas', (await page.locator('.gantt-deps > path').count()) > 0, `${await page.locator('.gantt-deps > path').count()} flechas`);
  await page.screenshot({ path: join(out, '03-gantt-aparato.png') });

  // Árbol de procesos
  await page.goto(`http://localhost:${PORT}/#arbol`);
  await page.getByText('Relaciones a validar').waitFor();
  check('Árbol de procesos con órdenes y operaciones', (await page.locator('.tree-node').count()) > 4);
  await page.screenshot({ path: join(out, '04-arbol.png') });

  // Ficha
  await page.goto(`http://localhost:${PORT}/#aparato`);
  await page.getByRole('tab', { name: 'Cuellos de botella' }).click();
  await page.getByText('Paso por puestos de trabajo').waitFor();
  check('Ficha de aparato: análisis de cuellos de botella del aparato', true);

  for (const [route, text, shot] of [
    ['puestos', 'Puestos de trabajo', '05-puestos.png'],
    ['carga', 'Mapa de carga', '06-carga.png'],
    ['cuellos', 'Avisos de saturación futura', '07-cuellos.png'],
    ['ortems', 'Comparador producción vs. Ortems', '08-comparador.png'],
    ['alertas', 'Alertas e incidencias', '09-alertas.png'],
    ['configuracion', 'Capacidad por puesto de trabajo', '10-configuracion.png'],
    ['importacion', 'Historial de importaciones', '11-importacion.png'],
  ]) {
    await page.goto(`http://localhost:${PORT}/#${route}`);
    await page.getByText(text).first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(out, shot) });
    check(`Sección «${route}» se muestra`, true);
  }
  const histRows = await page.locator('.tbl tbody tr').count();
  check('Historial registra las 3 importaciones de la demo', histRows >= 3, `${histRows} filas`);

  // Asistente de importación con los Excel ficticios (actualización de Ortems)
  await page.getByRole('button', { name: /Importar nueva versión/ }).nth(1).click();
  await page.locator('input[type=file]').first().setInputFiles(join(process.cwd(), 'samples', 'ejemplo_ortems_ficticio.xlsx'));
  await page.getByText('Plan Ortems').first().waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Siguiente' }).click();
  const hdr = await page.getByText(/Detección automática: fila (\d+)/).innerText();
  check('Asistente: detecta la cabecera de Ortems bajo las filas de título', /fila 4/.test(hdr), hdr.slice(0, 60));
  await page.getByRole('button', { name: 'Siguiente' }).click();
  const fieldSel = await page.locator('select[aria-label="Campo para la columna Recurso"]').inputValue();
  check('Asistente: propone «Recurso» → puesto asignado', fieldSel === 'puestoId', fieldSel);
  await page.getByRole('button', { name: 'Validar datos' }).click();
  await page.getByText('Filas leídas').waitFor();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByText('Modo de importación').waitFor();
  await page.getByRole('button', { name: 'Confirmar importación' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Importar' }).click();
  await page.getByText(/Importación completada/).waitFor({ timeout: 20000 });
  check('Asistente: importación de una nueva versión de Ortems completada', true);
  await page.screenshot({ path: join(out, '12-importacion-ok.png') });

  // Exportación a Excel
  await page.goto(`http://localhost:${PORT}/#ortems`);
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.getByRole('button', { name: /Exportar comparación/ }).click()]);
  check('Exportación de la comparación a Excel', /comparacion_ortems_.*\.xlsx$/.test(download.suggestedFilename()), download.suggestedFilename());

  // Vista móvil y tema oscuro
  const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: 'dark', locale: 'es-ES', timezoneId: 'Europe/Madrid' });
  const mp = await mob.newPage();
  mp.on('pageerror', (e) => errors.push(`pageerror(móvil): ${e.message}`));
  await mp.goto(`http://localhost:${PORT}/#dashboard`);
  await mp.getByRole('button', { name: 'Cargar datos de demostración' }).first().click();
  await mp.getByText('Situación de fábrica').waitFor({ timeout: 30000 });
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('Vista móvil (390 px) sin desplazamiento horizontal de la página', overflow <= 1, `exceso ${overflow}px`);
  await mp.screenshot({ path: join(out, '13-movil-oscuro.png') });
  await mob.close();

  check('Sin errores de JavaScript ni de consola', errors.length === 0, errors.slice(0, 5).join(' | '));
} catch (e) {
  check('Ejecución de la prueba', false, e.message);
} finally {
  await browser.close();
  server.kill();
  failed = results.some((r) => !r.ok);
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} comprobaciones superadas. Capturas en ${out}`);
  process.exit(failed ? 1 : 0);
}

/**
 * Genera Excel de ejemplo con datos FICTICIOS en /samples para probar el asistente de importación.
 * Uso: npm run samples
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateDemo } from '../src/demo/demoData';
import { gridsToXlsx } from '../src/export/excel';

const out = join(process.cwd(), 'samples');
mkdirSync(out, { recursive: true });
const base = new Date(2026, 10, 19).getTime();
const demo = generateDemo({ base });

const files: [string, Parameters<typeof gridsToXlsx>[0]][] = [
  ['ejemplo_produccion_ficticio.xlsx', demo.produccion],
  ['ejemplo_ortems_ficticio.xlsx', [demo.ortems]],
  ['ejemplo_ortems_ficticio_semana_anterior.xlsx', [demo.ortemsPrev]],
];
for (const [name, grids] of files) {
  const buf = await gridsToXlsx(grids);
  writeFileSync(join(out, name), Buffer.from(buf));
  console.log(`✓ ${name} (${Math.round(buf.byteLength / 1024)} KB)`);
}
console.log(`Fecha base de los datos ficticios: 19/11/2026 · ${demo.stats.aparatos} aparatos · ${demo.stats.operaciones} operaciones`);

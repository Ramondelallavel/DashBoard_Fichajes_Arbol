import { describe, expect, it } from 'vitest';
import { generateDemo } from '../src/demo/demoData';
import { gridsToXlsx, buildWorkbook } from '../src/export/excel';
import { readWorkbook } from '../src/import/readers';
import { analyzeSheet, autoImport, DEFAULT_PARSE_OPTIONS, prepareImport, suggestionsToMapping } from '../src/import/pipeline';
import { mergeSettings } from '../src/domain/settings';
import { runAnalysis } from '../src/engine/analysis';
import { applyFilters, EMPTY_FILTERS } from '../src/engine/filters';
import { analyzeAparato } from '../src/engine/aparato';
import type { ProdRecord } from '../src/domain/types';
import { D } from './helpers';

const base = D(2026, 11, 19);
const demo = generateDemo({ base });
const settings = mergeSettings({ capacities: demo.capacities, calendar: { workingWeekdays: [1, 2, 3, 4, 5], holidays: demo.holidays }, referenceDate: '2026-11-19' });

describe('Integración: Excel real → importación → análisis', () => {
  it('escribe y vuelve a leer un .xlsx conservando ceros iniciales y fechas locales', async () => {
    const buf = await gridsToXlsx(demo.produccion);
    const wb = await readWorkbook('produccion.xlsx', buf);
    expect(wb.sheets.map((s) => s.name)).toEqual(['Operaciones', 'Puestos']);
    const sheets = wb.sheets.map((g) => {
      const role = g.name === 'Puestos' ? 'puestos' : 'filas';
      const an = analyzeSheet(g, 'produccion', role, DEFAULT_PARSE_OPTIONS, []);
      return { grid: g, config: { sheet: g.name, role, headerRow: an.headerIndex + 1, mapping: suggestionsToMapping(an.suggestions) } as const };
    });
    const fromFile = prepareImport({ kind: 'produccion', fileName: 'produccion.xlsx', fileSize: buf.byteLength, fileHash: 'x', sheets: sheets.map((s) => ({ grid: s.grid, config: { ...s.config } })), options: DEFAULT_PARSE_OPTIONS, mode: 'inicial', settings, user: 'test' });
    const inMemory = autoImport('produccion', 'mem', [{ grid: demo.produccion[0], role: 'filas' }, { grid: demo.produccion[1], role: 'puestos' }], settings, 'inicial', undefined, 'test');
    expect(fromFile.result.counts).toEqual(inMemory.result.counts);
    const r0 = fromFile.dataset.records[0] as ProdRecord;
    const m0 = inMemory.dataset.records[0] as ProdRecord;
    expect(r0.ordenId).toMatch(/^00\d{5}$/);
    expect(r0.puestoId).toMatch(/^\d{2}$/);
    expect(r0.operacionId).toBe('0010');
    expect(r0.inicioPrevisto).toBe(m0.inicioPrevisto);
    expect(r0.seccion).toBeDefined();
  });
  it('lee CSV con punto y coma y codificación Windows-1252', async () => {
    const text = 'Nº OF;Op.;Puesto;Descripción\r\n0050001;0010;05;Soldadura en ángulo\r\n';
    const bytes = new Uint8Array([...text].map((c) => c.charCodeAt(0)));
    const wb = await readWorkbook('datos.csv', bytes.buffer);
    expect(wb.sheets[0].rows[1]).toEqual(['0050001', '0010', '05', 'Soldadura en ángulo']);
    expect(wb.warnings.join(' ')).toMatch(/1252/);
  });
  it('análisis completo de la demo: árbol, comparación, cuellos de botella y alertas', () => {
    const p = autoImport('produccion', 'p', [{ grid: demo.produccion[0], role: 'filas' }, { grid: demo.produccion[1], role: 'puestos' }], settings, 'inicial', undefined, 't');
    const o1 = autoImport('ortems', 'o1', [{ grid: demo.ortemsPrev, role: 'filas' }], settings, 'inicial', undefined, 't');
    const o2 = autoImport('ortems', 'o2', [{ grid: demo.ortems, role: 'filas' }], settings, 'actualizacion', o1.dataset, 't');
    expect(o2.dataset.version).toBe(2);
    expect(o2.diff!.summary.modified).toBeGreaterThan(0);
    const a = runAnalysis({ prod: p.dataset, ortems: o2.dataset, ortemsPrev: o1.dataset, settings, manual: [], now: base });
    expect(a.model.aparatos.size).toBe(48);
    expect(a.model.quality.some((q) => q.code === 'ORDENES_SIN_RELACION')).toBe(true);
    expect(a.comparison.stats.emparejadas).toBeGreaterThan(200);
    expect(a.bottlenecks.ranking.some((r) => r.label === 'Cuello de botella confirmado')).toBe(true);
    expect(a.bottlenecks.ranking.find((r) => r.id === '10')!.confianza).toBe('sin_capacidad');
    expect(a.alerts.length).toBeGreaterThan(50);
    // Ficha de aparato
    const apId = [...a.model.aparatos.keys()][0];
    const fa = analyzeAparato(a, apId)!;
    expect(fa.ordenes.length).toBeGreaterThan(1);
    expect(fa.pasos.length).toBeGreaterThan(1);
    // Filtros combinados: familia + sección + puesto + semana ISO
    const f = applyFilters(a, { ...EMPTY_FILTERS, familias: ['Celda MT'], secciones: ['Mecanizado'], puestos: ['05'], year: 2026, weeks: [48, 49] });
    expect(f.ops.size).toBeGreaterThan(0);
    for (const k of f.ops) {
      const op = a.model.ops.get(k)!;
      expect(op.puestoId).toBe('05');
      expect(op.seccion).toBe('Mecanizado');
      expect(a.model.aparatos.get(op.aparatoId!)!.familia).toBe('Celda MT');
    }
    const fNone = applyFilters(a, { ...EMPTY_FILTERS, familias: ['Celda MT'], puestos: ['10'], secciones: ['Mecanizado'] });
    expect(fNone.ops.size).toBe(0);
  });
  it('exporta informes a Excel con metadatos de generación, versión y filtros', async () => {
    const buf = await buildWorkbook(
      [{ name: 'Datos', columns: [{ header: 'Orden', value: (r: { o: string }) => r.o }, { header: 'Texto', value: () => '=HYPERLINK("x")' }], rows: [{ o: '0050001' }] as unknown[] } as never],
      { title: 'Informe de prueba', generatedAt: new Date(2026, 10, 19, 9, 30), user: 'test', versions: ['Producción v1'], filters: ['Puesto: 05'] },
    );
    const wb = await readWorkbook('informe.xlsx', buf);
    expect(wb.sheets.map((s) => s.name)).toEqual(['Informe', 'Datos']);
    expect(wb.sheets[1].rows[1][0]).toBe('0050001');
    expect(String(wb.sheets[1].rows[1][1]).startsWith("'=")).toBe(true);
    expect(wb.sheets[0].rows.flat()).toContain('Puesto: 05');
  });
});

describe('Rendimiento', () => {
  it('analiza ~13.000 operaciones en un tiempo razonable', () => {
    const big = generateDemo({ base, aparatos: 1500, seed: 7 });
    const s = mergeSettings({ capacities: big.capacities, referenceDate: '2026-11-19' });
    const t0 = performance.now();
    const p = autoImport('produccion', 'p', [{ grid: big.produccion[0], role: 'filas' }, { grid: big.produccion[1], role: 'puestos' }], s, 'inicial', undefined, 't');
    const o = autoImport('ortems', 'o', [{ grid: big.ortems, role: 'filas' }], s, 'inicial', undefined, 't');
    const t1 = performance.now();
    const a = runAnalysis({ prod: p.dataset, ortems: o.dataset, settings: s, manual: [], now: base });
    const t2 = performance.now();
    const f = applyFilters(a, { ...EMPTY_FILTERS, puestos: ['05'] });
    const t3 = performance.now();
    console.log(`[rendimiento] ${a.model.ops.size} operaciones · importación ${Math.round(t1 - t0)} ms · análisis ${Math.round(t2 - t1)} ms · filtro ${Math.round(t3 - t2)} ms`, a.timings);
    expect(a.model.ops.size).toBeGreaterThan(12000);
    expect(f.ops.size).toBeGreaterThan(0);
    expect(t2 - t1).toBeLessThan(20000);
  });
});

import { describe, expect, it } from 'vitest';
import { generateDemo } from '../src/demo/demoData';
import { autoImport } from '../src/import/pipeline';
import { mergeSettings } from '../src/domain/settings';
import { rehydrateAnalysis, runAnalysis } from '../src/engine/analysis';
import { applyFilters, EMPTY_FILTERS } from '../src/engine/filters';
import { analyzeAparato } from '../src/engine/aparato';
import { D } from './helpers';

describe('Cálculo en segundo plano (Web Worker)', () => {
  it('el análisis sobrevive al clonado estructurado y da los mismos resultados', () => {
    const base = D(2026, 11, 19);
    const demo = generateDemo({ base });
    const settings = mergeSettings({ capacities: demo.capacities, calendar: { workingWeekdays: [1, 2, 3, 4, 5], holidays: demo.holidays }, referenceDate: '2026-11-19' });
    const p = autoImport('produccion', 'p', [{ grid: demo.produccion[0], role: 'filas' }, { grid: demo.produccion[1], role: 'puestos' }], settings, 'inicial', undefined, 't');
    const o = autoImport('ortems', 'o', [{ grid: demo.ortems, role: 'filas' }], settings, 'inicial', undefined, 't');
    const a = runAnalysis({ prod: p.dataset, ortems: o.dataset, settings, manual: [], now: base });
    // Lo mismo que hace el worker: quitar el calendario (clase) y clonar
    const { calendar, ...rest } = a;
    void calendar;
    const b = rehydrateAnalysis(structuredClone(rest));
    expect(b.model.ops.size).toBe(a.model.ops.size);
    expect(b.alerts.length).toBe(a.alerts.length);
    expect(b.calendar.workingDaysDiff(D(2026, 11, 20), D(2026, 11, 23))).toBe(1);
    const fa = applyFilters(a, { ...EMPTY_FILTERS, puestos: ['05'] });
    const fb = applyFilters(b, { ...EMPTY_FILTERS, puestos: ['05'] });
    expect([...fb.ops].sort()).toEqual([...fa.ops].sort());
    const apId = [...a.model.aparatos.keys()][3];
    expect(analyzeAparato(b, apId)!.waits.length).toBe(analyzeAparato(a, apId)!.waits.length);
    expect(b.load.produccion.puestos.get('05')!.buckets.semana.size).toBe(a.load.produccion.puestos.get('05')!.buckets.semana.size);
  });
});

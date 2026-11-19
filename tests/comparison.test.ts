import { describe, expect, it } from 'vitest';
import { runAnalysis } from '../src/engine/analysis';
import { cap8, D, dataset, ort, prod, settingsWith } from './helpers';

const prodRecs = [
  prod({ aparatoId: '1', ordenId: '0050001', operacionId: '0010', puestoId: '05', inicioPrevisto: D(2026, 11, 23, 7), finPrevisto: D(2026, 11, 23, 15), duracionH: 8 }),
  prod({ aparatoId: '1', ordenId: '0050001', operacionId: '0020', puestoId: '06', inicioPrevisto: D(2026, 11, 24, 7), finPrevisto: D(2026, 11, 24, 15), duracionH: 8 }),
  prod({ aparatoId: '2', ordenId: '0050002', operacionId: '0010', puestoId: '05', inicioPrevisto: D(2026, 11, 25, 7), finPrevisto: D(2026, 11, 25, 15), duracionH: 8 }),
  prod({ aparatoId: '3', ordenId: '0050003', operacionId: '0010', puestoId: '08', inicioPrevisto: D(2026, 11, 26, 7), finPrevisto: D(2026, 11, 26, 15), duracionH: 8 }),
  prod({ aparatoId: '4', ordenId: '0050004', operacionId: '0010', puestoId: '05', inicioPrevisto: D(2026, 11, 26, 7), finPrevisto: D(2026, 11, 26, 15), duracionH: 8 }),
];
const ortRecs = [
  // misma fecha (coincide)
  ort({ ordenId: '0050001', operacionId: '0010', puestoId: '05', prioridad: 3, prioridadRaw: '3', inicio: D(2026, 11, 23, 7), fin: D(2026, 11, 23, 15) }),
  // Ortems la quiere 3 días laborables antes y con prioridad alta -> producción va retrasada (crítica)
  ort({ ordenId: '0050001', operacionId: '0020', puestoId: '06', prioridad: 1, prioridadRaw: '1', inicio: D(2026, 11, 19, 7), fin: D(2026, 11, 19, 15) }),
  // emparejada a nivel de orden (Ortems sin operación) y con recurso distinto
  ort({ ordenId: '0050002', puestoId: '04', prioridad: 3, prioridadRaw: '3', inicio: D(2026, 11, 25, 7), fin: D(2026, 11, 25, 15) }),
  // preorden prioritaria sin orden en producción
  ort({ preordenId: 'PO-1', prioridad: 1, prioridadRaw: '1', puestoId: '05', inicio: D(2026, 11, 26, 7), fin: D(2026, 11, 26, 15) }),
];

describe('Comparador producción vs. Ortems', () => {
  const settings = settingsWith({ capacities: { '05': cap8('05'), '06': cap8('06'), '08': cap8('08') }, referenceDate: '2026-11-19' });
  const a = runAnalysis({ prod: dataset('produccion', prodRecs), ortems: dataset('ortems', ortRecs), settings, manual: [], now: D(2026, 11, 19) });
  it('relaciona la misma orden/operación en ambos archivos por identificador exacto', () => {
    expect(a.match.opMatches.get('0050001|0010')).toHaveLength(1);
    expect(a.match.ordenMatches.get('0050002')).toHaveLength(1);
    expect(a.match.ortemsOnly).toHaveLength(1);
    expect(a.match.prodOnlyOrdenes.sort()).toEqual(['0050003', '0050004']);
  });
  it('compara fechas con tolerancia y calcula el desfase en días laborables y horas', () => {
    const same = a.comparison.byOp.get('0050001|0010')!;
    expect(same.coincide).toBe(true);
    const late = a.comparison.byOp.get('0050001|0020')!;
    expect(late.dEndWD).toBe(3);
    expect(late.dEndH).toBe(5 * 24);
    expect(late.discrepancies.map((d) => d.type)).toEqual(expect.arrayContaining(['inicio', 'fin', 'prioridad_alta_retrasada']));
    expect(late.criticidad).toBe('critica');
  });
  it('con más tolerancia la diferencia de fechas deja de considerarse discrepancia', () => {
    const b = runAnalysis({ prod: dataset('produccion', prodRecs), ortems: dataset('ortems', ortRecs), settings: { ...settings, tolerance: { value: 5, unit: 'dias_laborables' } }, manual: [], now: D(2026, 11, 19) });
    const types = b.comparison.byOp.get('0050001|0020')!.discrepancies.map((d) => d.type);
    expect(types).not.toContain('inicio');
    expect(types).not.toContain('fin');
    // pero sigue señalando que Ortems inicia la 0020 antes de que termine su precedente 0010 (dependencia inferida)
    expect(types).toEqual(['precedencia_ortems']);
  });
  it('detecta diferencias de recurso, órdenes ausentes y prioritarias sin programar', () => {
    const ord = a.comparison.byOrden.get('0050002')!.find((r) => r.level === 'orden')!;
    expect(ord.discrepancies.some((d) => d.type === 'recurso')).toBe(true);
    const only = a.comparison.rows.find((r) => r.level === 'solo_ortems')!;
    expect(only.discrepancies[0].type).toBe('preorden_no_lanzada');
    expect(only.criticidad).toBe('critica');
    expect(a.alerts.some((x) => x.type === 'ORDEN_PRIORITARIA_SIN_PROGRAMAR')).toBe(true);
    expect(a.comparison.rows.filter((r) => r.level === 'solo_produccion')).toHaveLength(2);
  });
  it('detecta cambios de prioridad respecto a la importación anterior de Ortems', () => {
    const prev = dataset('ortems', [ort({ ordenId: '0050001', operacionId: '0010', prioridadRaw: '4', prioridad: 4 })]);
    const b = runAnalysis({ prod: dataset('produccion', prodRecs), ortems: dataset('ortems', ortRecs, 2), ortemsPrev: prev, settings, manual: [], now: D(2026, 11, 19) });
    const r = b.comparison.byOp.get('0050001|0010')!;
    expect(r.discrepancies[0]).toMatchObject({ type: 'prioridad_modificada' });
    expect(r.prioridadAnteriorRaw).toBe('4');
  });
  it('la carga combinada suma la preorden solo-Ortems y detecta la saturación resultante', () => {
    const w = a.load.combinada.puestos.get('05')!.buckets.dia.get('2026-11-26')!;
    expect(w.loadH).toBe(16);
    expect(w.occupancy).toBe(2);
    expect(a.load.produccion.puestos.get('05')!.buckets.dia.get('2026-11-26')!.occupancy).toBe(1);
  });
  it('detecta la prioridad invertida en un mismo puesto', () => {
    const rs = [
      prod({ ordenId: 'X', operacionId: '10', puestoId: '05', inicioPrevisto: D(2026, 11, 23, 7), finPrevisto: D(2026, 11, 23, 11) }),
      prod({ ordenId: 'Y', operacionId: '10', puestoId: '05', inicioPrevisto: D(2026, 11, 23, 11), finPrevisto: D(2026, 11, 23, 15) }),
    ];
    const os = [
      ort({ ordenId: 'X', operacionId: '10', prioridad: 4, prioridadRaw: '4', inicio: D(2026, 11, 23, 11), fin: D(2026, 11, 23, 15) }),
      ort({ ordenId: 'Y', operacionId: '10', prioridad: 1, prioridadRaw: '1', inicio: D(2026, 11, 23, 7), fin: D(2026, 11, 23, 11) }),
    ];
    const b = runAnalysis({ prod: dataset('produccion', rs), ortems: dataset('ortems', os), settings: settingsWith({ tolerance: { value: 8, unit: 'horas' } }), manual: [], now: D(2026, 11, 19) });
    const y = b.comparison.byOp.get('Y|10')!;
    expect(y.discrepancies.some((d) => d.type === 'prioridad_invertida' && d.criticidad === 'alta')).toBe(true);
  });
  it('no empareja automáticamente si la regla encuentra varias candidatas (ambigua)', () => {
    const rs = [prod({ ordenId: 'X1', preordenId: 'P', operacionId: '10' }), prod({ ordenId: 'X2', preordenId: 'P', operacionId: '10' })];
    const os = [ort({ preordenId: 'P', inicio: D(2026, 11, 23), fin: D(2026, 11, 24) })];
    const b = runAnalysis({ prod: dataset('produccion', rs), ortems: dataset('ortems', os), settings: settingsWith(), manual: [], now: D(2026, 11, 19) });
    expect(b.match.ambiguous).toHaveLength(1);
    expect(b.comparison.rows.find((r) => r.level === 'ambigua')).toBeDefined();
  });
});

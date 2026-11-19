import { describe, expect, it } from 'vitest';
import { CapacityCalendar } from '../src/engine/calendar';
import { computeLoad } from '../src/engine/load';
import { detectOverlaps } from '../src/engine/overlaps';
import { computeBottlenecks } from '../src/engine/bottlenecks';
import { buildProductionModel } from '../src/engine/model';
import { cap8, D, dataset, settingsWith } from './helpers';

describe('Solapamientos', () => {
  it('detecta 08:00–12:00 frente a 10:00–14:00 en el mismo puesto y no cuenta los contiguos', () => {
    const cal = new CapacityCalendar(settingsWith({ capacities: { '05': cap8('05') } }));
    const g = detectOverlaps(
      [
        { id: 'a', puestoId: '05', start: D(2026, 11, 19, 8), end: D(2026, 11, 19, 12) },
        { id: 'b', puestoId: '05', start: D(2026, 11, 19, 10), end: D(2026, 11, 19, 14) },
        { id: 'c', puestoId: '05', start: D(2026, 11, 19, 14), end: D(2026, 11, 19, 16) },
        { id: 'd', puestoId: '06', start: D(2026, 11, 19, 8), end: D(2026, 11, 19, 12) },
      ],
      cal,
      'produccion',
    );
    expect(g).toHaveLength(1);
    expect(g[0].ids.sort()).toEqual(['a', 'b']);
    expect(g[0].maxConcurrency).toBe(2);
    expect(g[0].peakStart).toBe(D(2026, 11, 19, 10));
    expect(g[0].clase).toBe('sobrecarga_confirmada');
  });
  it('distingue solape dentro de capacidad, potencial, confirmado y estimado', () => {
    const ivs = [
      { id: 'a', puestoId: 'P', start: D(2026, 11, 19, 8), end: D(2026, 11, 19, 12) },
      { id: 'b', puestoId: 'P', start: D(2026, 11, 19, 9), end: D(2026, 11, 19, 12) },
    ];
    const known2 = new CapacityCalendar(settingsWith({ capacities: { P: cap8('P', 2) } }));
    const unknown = new CapacityCalendar(settingsWith());
    const assumed = new CapacityCalendar(settingsWith({ assumedCapacity: { enabled: true, hoursPerDay: 8, units: 1 } }));
    expect(detectOverlaps(ivs, known2, 'produccion')[0].clase).toBe('solape_dentro_capacidad');
    expect(detectOverlaps(ivs, unknown, 'produccion')[0].clase).toBe('solape_potencial');
    expect(detectOverlaps(ivs, assumed, 'produccion')[0].clase).toBe('sobrecarga_estimada');
  });
});

describe('Carga, ocupación y cuellos de botella', () => {
  const settings = settingsWith({ capacities: { '05': cap8('05') }, referenceDate: '2026-10-12' });
  const cal = new CapacityCalendar(settings);
  // Semana 43 de 2026: 19–23 octubre (40 h de capacidad en el puesto 05)
  const items = [
    { id: 'o1', puestoId: '05', start: D(2026, 10, 19, 7), end: D(2026, 10, 21, 15), hours: 24, estimated: false, source: 'produccion' as const },
    { id: 'o2', puestoId: '05', start: D(2026, 10, 21, 7), end: D(2026, 10, 23, 15), hours: 20.8, estimated: false, source: 'produccion' as const },
    { id: 'o3', puestoId: '10', start: D(2026, 10, 19, 7), end: D(2026, 10, 19, 15), hours: 30, estimated: false, source: 'produccion' as const },
    { id: 'o4', puestoId: '05', hours: 3, estimated: false, source: 'produccion' as const },
  ];
  const load = computeLoad(items, cal, 'produccion', new Map([['05', 'Mecanizado'], ['10', 'Pruebas']]));
  it('calcula horas, ocupación y exceso respecto a la capacidad conocida', () => {
    const w = load.puestos.get('05')!.buckets.semana.get('2026-S43')!;
    expect(w.loadH).toBeCloseTo(44.8);
    expect(w.capacityH).toBe(40);
    expect(w.occupancy).toBeCloseTo(1.12);
    expect(load.puestos.get('05')!.unscheduledIds).toEqual(['o4']);
  });
  it('sin capacidad conocida muestra la carga pero no calcula ocupación', () => {
    const w = load.puestos.get('10')!.buckets.semana.get('2026-S43')!;
    expect(w.loadH).toBe(30);
    expect(w.occupancy).toBeUndefined();
    expect(load.puestos.get('10')!.capSource).toBe('desconocida');
  });
  it('genera el aviso futuro respaldado por el cálculo y no confirma lo que es hipótesis', () => {
    const model = buildProductionModel(dataset('produccion', []), settings);
    const b = computeBottlenecks(load, [], settings, D(2026, 10, 12), model);
    const f = b.findings.find((x) => x.entityId === '05' && x.granularity === 'semana')!;
    expect(f.message).toBe('El puesto de trabajo 05 presenta una ocupación prevista del 112 % durante la semana 43 de 2026 (carga 44,8 h / capacidad 40 h).');
    expect(f.confianza).toBe('confirmado');
    const r10 = b.ranking.find((r) => r.id === '10')!;
    expect(r10.label).toMatch(/no se puede confirmar/);
    expect(r10.confianza).toBe('sin_capacidad');
    const sec = b.findings.find((x) => x.scope === 'seccion');
    expect(sec?.entityId).toBe('Mecanizado');
  });
  it('la sección con capacidad parcial se etiqueta como parcial/estimada', () => {
    const l2 = computeLoad(items, cal, 'produccion', new Map([['05', 'Taller'], ['10', 'Taller']]));
    expect(l2.secciones.get('Taller')!.capSource).toBe('parcial');
    const model = buildProductionModel(dataset('produccion', []), settings);
    const b = computeBottlenecks(l2, [], settings, D(2026, 10, 12), model);
    const f = b.findings.find((x) => x.scope === 'seccion')!;
    expect(f.confianza).toBe('estimado');
  });
});

import { describe, expect, it } from 'vitest';
import { buildProductionModel } from '../src/engine/model';
import { D, dataset, prod, settingsWith } from './helpers';

function sample() {
  return [
    // Aparato 10001: tres órdenes con estructura confirmada (A,B -> C)
    prod({ aparatoId: '10001', ordenId: 'A', ordenPadreId: 'C', operacionId: '0010', puestoId: '01', inicioPrevisto: D(2026, 11, 16, 7), finPrevisto: D(2026, 11, 16, 11) }),
    prod({ aparatoId: '10001', ordenId: 'A', ordenPadreId: 'C', operacionId: '0020', puestoId: '02', inicioPrevisto: D(2026, 11, 16, 11), finPrevisto: D(2026, 11, 16, 15) }),
    prod({ ordenId: 'B', ordenPadreId: 'C', operacionId: '0010', puestoId: '05', inicioPrevisto: D(2026, 11, 17, 7), finPrevisto: D(2026, 11, 17, 12) }),
    prod({ aparatoId: '10001', ordenId: 'C', operacionId: '0010', puestoId: '07', inicioPrevisto: D(2026, 11, 17, 9), finPrevisto: D(2026, 11, 18, 15) }),
    // Aparato 10002: dos órdenes sin relación conocida
    prod({ aparatoId: '10002', ordenId: 'D', operacionId: '0010', puestoId: '01' }),
    prod({ aparatoId: '10002', ordenId: 'E', operacionId: '0010', puestoId: '08', operacionPrecedenteId: '0005' }),
    prod({ aparatoId: '10002', ordenId: 'E', operacionId: '0020', operacionPrecedenteId: '0010' }),
    // Orden sin aparato
    prod({ ordenId: 'F', operacionId: '0010', puestoId: '05' }),
  ];
}

describe('Relaciones y árbol de procesos', () => {
  const m = buildProductionModel(dataset('produccion', sample()), settingsWith());
  it('relaciona aparato → órdenes → operaciones y distingue confirmado de inferido', () => {
    const ap = m.aparatos.get('10001')!;
    expect(ap.ordenIds).toEqual(['A', 'B', 'C']);
    expect(ap.rootOrdenIds).toEqual(['C']);
    expect(m.ordenes.get('A')!.aparatoLink).toBe('confirmada');
    // B no trae aparato: se hereda de su orden padre C (INFERIDO, nunca confirmado)
    expect(m.ordenes.get('B')!.aparatoLink).toBe('inferida');
    expect(m.ordenes.get('B')!.aparatoRule).toMatch(/orden padre C/);
    expect(m.ordenes.get('C')!.childIds.sort()).toEqual(['A', 'B']);
  });
  it('infiere secuencia por número de operación y la orden hija antes que la padre (marcadas como inferidas)', () => {
    const a20 = m.ops.get('A|0020')!;
    expect(a20.preds).toEqual([expect.objectContaining({ from: 'A|0010', tipo: 'inferida' })]);
    const c10 = m.ops.get('C|0010')!;
    expect(c10.preds.map((p) => p.from).sort()).toEqual(['A|0020', 'B|0010']);
    expect(c10.preds.every((p) => p.tipo === 'inferida')).toBe(true);
  });
  it('usa la precedente explícita como confirmada y marca como pendiente la que no existe', () => {
    const e20 = m.ops.get('E|0020')!;
    expect(e20.preds).toEqual([expect.objectContaining({ from: 'E|0010', tipo: 'confirmada' })]);
    const e10 = m.ops.get('E|0010')!;
    expect(e10.preds[0].tipo).toBe('pendiente');
    expect(m.quality.some((q) => q.code === 'PRECEDENTE_NO_ENCONTRADO' && q.opKey === 'E|0010')).toBe(true);
  });
  it('no inventa relaciones: órdenes sin relación quedan pendientes de validar', () => {
    const ap = m.aparatos.get('10002')!;
    expect(ap.rootOrdenIds).toEqual(['D', 'E']);
    expect(m.relations.filter((r) => r.status === 'pendiente' && r.aparatoId === '10002' && r.kind === 'orden-padre')).toHaveLength(2);
    expect(m.quality.some((q) => q.code === 'ORDENES_SIN_RELACION' && q.aparatoId === '10002')).toBe(true);
    expect(m.quality.some((q) => q.code === 'ORDEN_SIN_APARATO' && q.ordenId === 'F')).toBe(true);
    expect(m.quality.some((q) => q.code === 'OPERACION_SIN_PUESTO' && q.opKey === 'E|0020')).toBe(true);
  });
  it('las reglas de inferencia se pueden desactivar', () => {
    const m2 = buildProductionModel(dataset('produccion', sample()), settingsWith({ dependencies: { sequenceByOperationNumber: false, childBeforeParent: false, inheritAparatoFromParent: false, waitThresholdDays: 3 } }));
    expect(m2.ops.get('A|0020')!.preds).toHaveLength(0);
    expect(m2.ordenes.get('B')!.aparatoId).toBeUndefined();
  });
  it('la validación manual se aplica en una capa separada y queda trazada', () => {
    const m3 = buildProductionModel(dataset('produccion', sample()), settingsWith(), [
      { id: 'm1', kind: 'orden-padre', ordenId: 'D', targetId: 'E', decision: 'confirmada', user: 'planificador', at: '' },
      { id: 'm2', kind: 'orden-aparato', ordenId: 'F', targetId: '10002', decision: 'confirmada', user: 'planificador', at: '' },
    ]);
    expect(m3.ordenes.get('D')!.parentLink).toBe('manual');
    expect(m3.ordenes.get('D')!.parentRule).toMatch(/planificador/);
    // D cuelga de E; F (asignada manualmente al aparato) es otra raíz cuya relación sigue pendiente
    expect(m3.aparatos.get('10002')!.rootOrdenIds).toEqual(['E', 'F']);
    expect(m3.ordenes.get('F')!.aparatoLink).toBe('manual');
    expect(m3.aparatos.get('10002')!.ordenIds).toContain('F');
  });
  it('detecta ciclos en la estructura de órdenes', () => {
    const m4 = buildProductionModel(dataset('produccion', [prod({ aparatoId: '1', ordenId: 'X', ordenPadreId: 'Y', operacionId: '10' }), prod({ aparatoId: '1', ordenId: 'Y', ordenPadreId: 'X', operacionId: '10' })]), settingsWith());
    expect(m4.quality.some((q) => q.code === 'CICLO_ORDENES')).toBe(true);
  });
  it('detecta identificadores duplicados de operación', () => {
    const m5 = buildProductionModel(dataset('produccion', [prod({ ordenId: 'X', operacionId: '10', puestoId: '01' }), prod({ ordenId: 'X', operacionId: '10', puestoId: '02' })]), settingsWith());
    expect(m5.ops.size).toBe(1);
    expect(m5.ops.get('X|10')!.rids).toHaveLength(2);
    expect(m5.quality.some((q) => q.code === 'ID_DUPLICADO')).toBe(true);
  });
});

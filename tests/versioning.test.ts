import { describe, expect, it } from 'vitest';
import { buildDatasetVersion, diffRecords, incrementalAllowed, mergeIncremental } from '../src/import/versioning';
import { D, prod } from './helpers';

describe('Versiones e importaciones sucesivas', () => {
  const v1 = [prod({ ordenId: '1', operacionId: '10', puestoId: '05', finPrevisto: D(2026, 11, 20) }), prod({ ordenId: '1', operacionId: '20', puestoId: '06' }), prod({ ordenId: '2', operacionId: '10' })];
  const v2 = [prod({ ordenId: '1', operacionId: '10', puestoId: '05', finPrevisto: D(2026, 11, 24) }), prod({ ordenId: '1', operacionId: '20', puestoId: '06' }), prod({ ordenId: '3', operacionId: '10' })];
  it('identifica registros nuevos, eliminados y modificados (con el detalle del cambio)', () => {
    const { diffs, summary } = diffRecords('produccion', v1, v2);
    expect(summary).toEqual({ added: 1, removed: 1, modified: 1, unchanged: 1 });
    const mod = diffs.find((d) => d.type === 'modificado')!;
    expect(mod.key).toBe('1|10');
    expect(mod.changes[0].field).toBe('finPrevisto');
  });
  it('la importación incremental fusiona por clave sin eliminar nada ni duplicar', () => {
    const merged = mergeIncremental('produccion', v1, v2);
    expect(merged.map((r) => `${r.ordenId}|${(r as { operacionId?: string }).operacionId}`)).toEqual(['1|10', '1|20', '2|10', '3|10']);
    expect(merged.filter((r) => r.ordenId === '1' && (r as { operacionId?: string }).operacionId === '10')).toHaveLength(1);
  });
  it('mantiene la trazabilidad de versiones y lotes', () => {
    const a = buildDatasetVersion('produccion', 'inicial', 'b1', v1, undefined);
    const b = buildDatasetVersion('produccion', 'incremental', 'b2', v2, a);
    const c = buildDatasetVersion('produccion', 'sustitucion', 'b3', v2, b);
    expect([a.version, b.version, c.version]).toEqual([1, 2, 3]);
    expect(b.batchIds).toEqual(['b1', 'b2']);
    expect(c.batchIds).toEqual(['b3']);
    expect(c.records).toHaveLength(3);
  });
  it('no permite incremental si las claves no son fiables', () => {
    expect(incrementalAllowed('produccion', v1, ['operacionId']).ok).toBe(false);
    expect(incrementalAllowed('produccion', [...v1, prod({ ordenId: '1', operacionId: '10' })], ['ordenId', 'operacionId']).ok).toBe(false);
    expect(incrementalAllowed('produccion', v1, ['ordenId', 'operacionId']).ok).toBe(true);
  });
});

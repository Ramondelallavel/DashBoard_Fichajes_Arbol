import { mergeSettings, type Settings } from '../src/domain/settings';
import type { DatasetVersion, ProdRecord, OrtemsRecord } from '../src/domain/types';

export const D = (y: number, m: number, d: number, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();

let n = 0;
export function prod(p: Partial<ProdRecord>): ProdRecord {
  n++;
  return { rid: `b:s:${n}`, src: { batchId: 'b', sheet: 's', row: n }, issues: [], status: 'ok', ...p };
}
export function ort(p: Partial<OrtemsRecord>): OrtemsRecord {
  n++;
  return { rid: `o:s:${n}`, src: { batchId: 'o', sheet: 's', row: n }, issues: [], status: 'ok', ...p };
}
export function dataset<R extends ProdRecord | OrtemsRecord>(kind: 'produccion' | 'ortems', records: R[], version = 1): DatasetVersion {
  return { id: `${kind}-v${version}`, kind, version, createdAt: new Date().toISOString(), mode: 'inicial', batchId: 'b', batchIds: ['b'], records, masters: [] };
}
export function settingsWith(p: Partial<Settings> = {}): Settings {
  return mergeSettings(p);
}
export const cap8 = (puestoId: string, units = 1) => ({
  puestoId,
  hoursPerWeekday: { 1: 8, 2: 8, 3: 8, 4: 8, 5: 8, 6: 0, 7: 0 },
  units,
  efficiency: 1,
  stops: [],
  specialDays: [],
});

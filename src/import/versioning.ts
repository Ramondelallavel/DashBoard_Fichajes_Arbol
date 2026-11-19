import type { AnyRecord, DatasetVersion, DiffSummary, FieldChange, ImportMode, MasterRow, RecordDiff, SourceKind } from '../domain/types';
import { fmtDateTime } from '../lib/dates';
import { recordKey } from './normalize';

/** Campos comparados entre versiones (fechas, prioridades, cantidades, recursos, órdenes). */
const COMPARE_FIELDS: Record<SourceKind, string[]> = {
  produccion: [
    'aparatoId', 'articuloRef', 'familia', 'preordenId', 'ordenPadreId', 'operacionDesc', 'puestoId', 'seccion',
    'inicioPrevisto', 'finPrevisto', 'inicioReal', 'finReal', 'fechaObjetivo', 'duracionH', 'cantidad', 'estadoRaw', 'prioridadRaw',
  ],
  ortems: ['aparatoId', 'articuloRef', 'puestoId', 'inicio', 'fin', 'periodoRaw', 'duracionH', 'cantidad', 'estadoPlanificacion', 'prioridadRaw'],
};

const DATE_FIELDS = new Set(['inicioPrevisto', 'finPrevisto', 'inicioReal', 'finReal', 'fechaObjetivo', 'inicio', 'fin']);

function show(field: string, v: unknown): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (DATE_FIELDS.has(field) && typeof v === 'number') return fmtDateTime(v);
  if (typeof v === 'number') return String(Math.round(v * 1000) / 1000);
  return String(v);
}

function activeRecords<R extends AnyRecord>(records: R[]): R[] {
  return records.filter((r) => r.status !== 'rechazado');
}

function indexByKey<R extends AnyRecord>(kind: SourceKind, records: R[]): Map<string, R> {
  const m = new Map<string, R>();
  for (const r of activeRecords(records)) {
    const k = recordKey(kind, r);
    if (!m.has(k)) m.set(k, r);
  }
  return m;
}

export function diffRecords(kind: SourceKind, before: AnyRecord[], after: AnyRecord[]): { diffs: RecordDiff[]; summary: DiffSummary } {
  const a = indexByKey(kind, before);
  const b = indexByKey(kind, after);
  const diffs: RecordDiff[] = [];
  let unchanged = 0;
  for (const [key, rb] of b) {
    const ra = a.get(key);
    if (!ra) {
      diffs.push({ key, type: 'nuevo', changes: [], afterRid: rb.rid });
      continue;
    }
    const changes: FieldChange[] = [];
    for (const f of COMPARE_FIELDS[kind]) {
      const va = show(f, (ra as unknown as Record<string, unknown>)[f]);
      const vb = show(f, (rb as unknown as Record<string, unknown>)[f]);
      if (va !== vb) changes.push({ field: f, before: va, after: vb });
    }
    if (changes.length) diffs.push({ key, type: 'modificado', changes, beforeRid: ra.rid, afterRid: rb.rid });
    else unchanged++;
  }
  for (const [key, ra] of a) if (!b.has(key)) diffs.push({ key, type: 'eliminado', changes: [], beforeRid: ra.rid });
  const summary: DiffSummary = {
    added: diffs.filter((d) => d.type === 'nuevo').length,
    removed: diffs.filter((d) => d.type === 'eliminado').length,
    modified: diffs.filter((d) => d.type === 'modificado').length,
    unchanged,
  };
  return { diffs, summary };
}

/**
 * Fusión incremental: los registros del nuevo archivo sustituyen a los existentes con la misma
 * clave y se añaden los nuevos. No se elimina nada.
 */
export function mergeIncremental(kind: SourceKind, prev: AnyRecord[], incoming: AnyRecord[]): AnyRecord[] {
  const incomingByKey = indexByKey(kind, incoming);
  const out: AnyRecord[] = [];
  const replaced = new Set<string>();
  for (const r of prev) {
    const k = recordKey(kind, r);
    const nr = r.status !== 'rechazado' ? incomingByKey.get(k) : undefined;
    if (nr) {
      out.push(nr);
      replaced.add(k);
    } else out.push(r);
  }
  for (const r of incoming) {
    if (r.status === 'rechazado') continue;
    const k = recordKey(kind, r);
    if (!replaced.has(k)) {
      out.push(r);
      replaced.add(k);
    }
  }
  return out;
}

/** Comprueba si la importación incremental es fiable: exige claves completas y únicas. */
export function incrementalAllowed(kind: SourceKind, incoming: AnyRecord[], mappedFields: string[]): { ok: boolean; reason?: string } {
  if (!mappedFields.includes('ordenId') && !(kind === 'ortems' && mappedFields.includes('preordenId'))) {
    return { ok: false, reason: 'Falta la columna de orden: no se pueden identificar registros nuevos o modificados.' };
  }
  const keys = new Set<string>();
  for (const r of activeRecords(incoming)) {
    const k = recordKey(kind, r);
    if (keys.has(k)) return { ok: false, reason: 'El archivo contiene claves duplicadas: la fusión incremental no sería fiable.' };
    keys.add(k);
  }
  return { ok: true };
}

export function buildDatasetVersion(
  kind: SourceKind,
  mode: ImportMode,
  batchId: string,
  incoming: AnyRecord[],
  previous: DatasetVersion | undefined,
  masters: MasterRow[] = [],
  now = new Date(),
): DatasetVersion {
  const version = (previous?.version ?? 0) + 1;
  const incremental = mode === 'incremental' && !!previous;
  const records = incremental ? mergeIncremental(kind, previous.records, incoming) : incoming;
  const batchIds = incremental ? [...previous.batchIds, batchId] : [batchId];
  let mergedMasters = masters;
  if (incremental) {
    const m = new Map<string, MasterRow>();
    for (const r of previous.masters ?? []) m.set(`${r.role}|${r.key}`, r);
    for (const r of masters) m.set(`${r.role}|${r.key}`, r);
    mergedMasters = [...m.values()];
  }
  return { id: `${kind}-v${version}`, kind, version, createdAt: now.toISOString(), mode, batchId, batchIds, records, masters: mergedMasters };
}

export const MODE_LABEL: Record<ImportMode, string> = {
  inicial: 'Importación inicial',
  actualizacion: 'Actualización (nueva versión completa)',
  sustitucion: 'Sustitución completa',
  incremental: 'Importación incremental',
};

export const MODE_HELP: Record<ImportMode, string> = {
  inicial: 'Primera carga de esta fuente. No hay datos previos.',
  actualizacion:
    'El archivo es una foto completa y actualizada. Pasa a ser la versión activa; se calculan los cambios (nuevos, modificados y desaparecidos) frente a la versión anterior, que se conserva en el historial.',
  sustitucion:
    'Descarta la versión activa y empieza de cero con este archivo (por ejemplo, si cambia el alcance). La versión anterior queda en el historial como sustituida.',
  incremental:
    'El archivo solo trae registros nuevos o modificados. Se fusionan por clave (orden + operación) con la versión activa sin eliminar nada.',
};

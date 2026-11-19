/**
 * Validación estructural de lo que envía el cliente. El servidor no confía en el cliente:
 * comprueba tipos, tamaños y valores permitidos antes de guardar.
 */
import type { DatasetVersion, ImportBatch, RawSheet } from '../src/domain/types';

export class BadRequest extends Error {
  status = 400;
}
export class Conflict extends Error {
  status = 409;
}
export class Forbidden extends Error {
  status = 403;
}

const KINDS = ['produccion', 'ortems'];
const MODES = ['inicial', 'actualizacion', 'sustitucion', 'incremental'];
const STATUS = ['ok', 'revision', 'rechazado'];
const ID_RE = /^[A-Za-z0-9_.:-]{1,120}$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 1000) => typeof v === 'string' && v.length <= max;
const optStr = (v: unknown, max = 2000) => v === undefined || str(v, max);
const optNum = (v: unknown) => v === undefined || (typeof v === 'number' && Number.isFinite(v));

function need(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new BadRequest(msg);
}

const STR_FIELDS = [
  'aparatoId', 'articuloRef', 'articuloDesc', 'familia', 'ordenId', 'preordenId', 'ordenPadreId', 'operacionId', 'operacionDesc',
  'operacionPrecedenteId', 'puestoId', 'puestoDesc', 'seccion', 'area', 'centroTrabajo', 'estadoRaw', 'estado', 'prioridadRaw',
  'periodoRaw', 'estadoPlanificacion',
];
const NUM_FIELDS = ['inicioPrevisto', 'finPrevisto', 'inicioReal', 'finReal', 'fechaObjetivo', 'duracionH', 'cantidad', 'prioridad', 'secuencia', 'inicio', 'fin'];

export interface ImportPayload {
  batch: ImportBatch;
  dataset: DatasetVersion;
  rawSheets: RawSheet[];
  basedOnVersion: number | null;
}

export function validateImport(body: unknown, maxRecords = 2_000_000): ImportPayload {
  need(isObj(body), 'Cuerpo de la petición no válido.');
  const { batch, dataset, rawSheets, basedOnVersion } = body;
  need(basedOnVersion === null || (typeof basedOnVersion === 'number' && Number.isInteger(basedOnVersion)), 'basedOnVersion no válido.');
  need(isObj(batch), 'Falta el lote de importación.');
  need(str(batch.id, 120) && ID_RE.test(batch.id as string), 'Identificador de lote no válido.');
  need(KINDS.includes(batch.kind as string), 'Fuente no válida.');
  need(MODES.includes(batch.mode as string), 'Modo de importación no válido.');
  need(str(batch.fileName, 255) && optNum(batch.fileSize) && str(batch.fileHash, 128), 'Datos del archivo no válidos.');
  need(Array.isArray(batch.sheets) && batch.sheets.length <= 50, 'Configuración de hojas no válida.');
  need(isObj(batch.counts) && ['total', 'ok', 'revision', 'rechazado', 'vacias'].every((k) => typeof (batch.counts as Record<string, unknown>)[k] === 'number'), 'Recuentos no válidos.');
  need(Array.isArray(batch.unknownColumns) && batch.unknownColumns.length <= 5000 && batch.unknownColumns.every((c) => str(c, 600)), 'Columnas desconocidas no válidas.');
  need(isObj(dataset), 'Falta la versión de datos.');
  need(dataset.kind === batch.kind && dataset.batchId === batch.id && dataset.mode === batch.mode, 'La versión de datos no corresponde al lote.');
  need(typeof dataset.version === 'number' && Number.isInteger(dataset.version) && dataset.version > 0, 'Versión no válida.');
  need(Array.isArray(dataset.batchIds) && dataset.batchIds.every((b) => str(b, 120)), 'Lotes de la versión no válidos.');
  need(Array.isArray(dataset.records) && dataset.records.length <= maxRecords, 'Registros no válidos o demasiados registros.');
  need(Array.isArray(dataset.masters) && dataset.masters.length <= maxRecords, 'Filas complementarias no válidas.');
  for (const r of dataset.records as unknown[]) {
    need(isObj(r) && str(r.rid, 400) && STATUS.includes(r.status as string) && Array.isArray(r.issues), 'Registro no válido.');
    need(isObj(r.src) && str(r.src.batchId, 120) && str(r.src.sheet, 300) && typeof r.src.row === 'number', 'Origen de registro no válido.');
    for (const f of STR_FIELDS) if (!optStr(r[f])) throw new BadRequest(`Campo ${f} no válido en ${r.rid}.`);
    for (const f of NUM_FIELDS) if (!optNum(r[f])) throw new BadRequest(`Campo ${f} no válido en ${r.rid}.`);
  }
  need(Array.isArray(rawSheets) && rawSheets.length <= 50, 'Datos originales no válidos.');
  for (const s of rawSheets as unknown[]) need(isObj(s) && str(s.name, 300) && Array.isArray(s.headers) && Array.isArray(s.rows), 'Hoja original no válida.');
  return { batch: batch as unknown as ImportBatch, dataset: dataset as unknown as DatasetVersion, rawSheets: rawSheets as unknown as RawSheet[], basedOnVersion: basedOnVersion as number | null };
}

export function validateId(id: unknown, what = 'Identificador'): string {
  need(typeof id === 'string' && ID_RE.test(id), `${what} no válido.`);
  return id;
}

export function validateJsonObject(v: unknown, maxBytes: number, what: string): Record<string, unknown> {
  need(isObj(v), `${what} no válido.`);
  need(JSON.stringify(v).length <= maxBytes, `${what} demasiado grande.`);
  return v;
}

export { isObj, str };

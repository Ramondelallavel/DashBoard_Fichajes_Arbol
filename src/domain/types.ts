/**
 * Modelo de dominio de la aplicación.
 *
 * Capas de información (ver docs/MODELO_DATOS.md):
 *  1. Datos originales   -> RawSheet / RawCell (valores tal y como vienen del Excel)
 *  2. Datos normalizados -> ProdRecord / OrtemsRecord (campos canónicos + incidencias)
 *  3. Relaciones calculadas -> engine/model.ts (Aparato, Orden, Operacion, Relation, Dependency)
 *  4. Resultados de análisis -> engine/* (carga, solapes, comparación, alertas)
 *  5. Información manual -> ManualRelation, AlertReview (capa separada, nunca mezclada con el origen)
 */

export type SourceKind = 'produccion' | 'ortems';

/**
 * Valor de celda original serializable. Las fechas se guardan como {d: ISO local}.
 * Un número con formato que altera su texto (p. ej. "00123" con formato 00000) se guarda
 * como {n, t}: valor numérico original + texto visible en Excel.
 */
export type RawCell = string | number | boolean | null | { d: string } | { n: number; t: string };

/** Referencia de trazabilidad a la fila de origen. `row` es el número de fila de Excel (1-based). */
export interface SourceRef {
  batchId: string;
  sheet: string;
  row: number;
}

export type IssueSeverity = 'error' | 'aviso' | 'info';

export interface Issue {
  code: IssueCode;
  severity: IssueSeverity;
  field?: string;
  message: string;
  value?: string;
}

export type IssueCode =
  | 'FALTA_ORDEN'
  | 'FALTA_OPERACION_ID'
  | 'FALTA_PUESTO'
  | 'FALTA_APARATO'
  | 'FECHA_INVALIDA'
  | 'FECHA_FUERA_RANGO'
  | 'INICIO_POSTERIOR_FIN'
  | 'NUMERO_INVALIDO'
  | 'DURACION_NEGATIVA'
  | 'ID_NUMERICO'
  | 'DUPLICADO_EXACTO'
  | 'CLAVE_DUPLICADA'
  | 'VALOR_DISCREPANTE_HOJAS'
  | 'ESTADO_DESCONOCIDO'
  | 'PRIORIDAD_NO_INTERPRETABLE'
  | 'FILAS_CONSOLIDADAS';

export type RecordStatus = 'ok' | 'revision' | 'rechazado';

export type EstadoCanonico = 'pendiente' | 'en_curso' | 'terminada' | 'bloqueada' | 'anulada' | 'desconocido';

/** Registro normalizado del Excel de producción (una fila de planificación). */
export interface ProdRecord {
  rid: string;
  src: SourceRef;
  aparatoId?: string;
  articuloRef?: string;
  articuloDesc?: string;
  familia?: string;
  ordenId?: string;
  preordenId?: string;
  ordenPadreId?: string;
  operacionId?: string;
  operacionDesc?: string;
  secuencia?: number;
  operacionPrecedenteId?: string;
  puestoId?: string;
  puestoDesc?: string;
  seccion?: string;
  area?: string;
  centroTrabajo?: string;
  /** Fechas en milisegundos (hora local "flotante", sin zona horaria). */
  inicioPrevisto?: number;
  finPrevisto?: number;
  inicioReal?: number;
  finReal?: number;
  fechaObjetivo?: number;
  /** Duración prevista normalizada a horas. */
  duracionH?: number;
  cantidad?: number;
  /** Porcentaje de avance declarado (0-100), p. ej. en los fichajes. */
  avance?: number;
  estadoRaw?: string;
  estado?: EstadoCanonico;
  prioridadRaw?: string;
  prioridad?: number;
  issues: Issue[];
  status: RecordStatus;
  /** Campos rellenados desde hojas complementarias (trazabilidad del enriquecimiento). */
  enriched?: { field: string; from: SourceRef }[];
}

/** Registro normalizado del Excel de Ortems. Se mantiene siempre separado de producción. */
export interface OrtemsRecord {
  rid: string;
  src: SourceRef;
  ordenId?: string;
  preordenId?: string;
  aparatoId?: string;
  articuloRef?: string;
  articuloDesc?: string;
  familia?: string;
  modelo?: string;
  seccion?: string;
  operacionId?: string;
  puestoId?: string;
  inicio?: number;
  fin?: number;
  periodoRaw?: string;
  duracionH?: number;
  cantidad?: number;
  estadoPlanificacion?: string;
  prioridadRaw?: string;
  prioridad?: number;
  issues: Issue[];
  status: RecordStatus;
}

export type AnyRecord = ProdRecord | OrtemsRecord;

/* ------------------------------------------------------------------ */
/* Importación                                                         */
/* ------------------------------------------------------------------ */

export type ImportMode = 'inicial' | 'actualizacion' | 'sustitucion' | 'incremental';

export type SheetRole = 'filas' | 'ordenes' | 'puestos' | 'aparatos';

export interface RawSheet {
  name: string;
  headerRow: number; // fila de Excel (1-based) usada como cabecera
  headers: string[];
  rows: { row: number; cells: RawCell[] }[];
}

export interface SheetImportConfig {
  sheet: string;
  role: SheetRole;
  headerRow: number;
  /** índice de columna -> campo canónico */
  mapping: Record<number, string>;
}

export interface ParseOptions {
  dateOrder: 'DMY' | 'MDY' | 'YMD';
  durationUnit: 'h' | 'min' | 's';
  decimalSeparator: 'auto' | ',' | '.';
  /**
   * Qué hacer con varias filas con la misma clave:
   * - conflicto: se avisa (pendiente de revisión) y el modelo usa la primera.
   * - consolidar: son avances/fichajes del mismo registro y se agregan (inicio mínimo, fin máximo, mayor avance).
   */
  repeatedKeys?: 'conflicto' | 'consolidar';
}

export interface ImportCounts {
  total: number;
  ok: number;
  revision: number;
  rechazado: number;
  vacias: number;
}

export type BatchStatus = 'activa' | 'historica' | 'sustituida' | 'fusionada';

export interface ImportBatch {
  id: string;
  kind: SourceKind;
  fileName: string;
  fileSize: number;
  fileHash: string;
  importedAt: string; // ISO
  user: string;
  mode: ImportMode;
  sheets: SheetImportConfig[];
  options: ParseOptions;
  profileId?: string;
  counts: ImportCounts;
  status: BatchStatus;
  /** Versión del conjunto de datos que generó esta importación. */
  datasetVersion: number;
  unknownColumns: string[];
  diffSummary?: DiffSummary;
}

/** Conjunto de datos activo (materializado) de una fuente, versionado. */
export interface DatasetVersion<R extends AnyRecord = AnyRecord> {
  id: string;
  kind: SourceKind;
  version: number;
  createdAt: string;
  mode: ImportMode;
  batchId: string;
  batchIds: string[];
  records: R[];
  /** Filas de hojas complementarias (maestros de órdenes, puestos o aparatos). */
  masters: MasterRow[];
}

export interface MasterRow {
  role: 'ordenes' | 'puestos' | 'aparatos';
  key: string;
  values: Record<string, unknown>;
  src: SourceRef;
}

export interface DiffSummary {
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
}

export interface FieldChange {
  field: string;
  before?: string;
  after?: string;
}

export interface RecordDiff {
  key: string;
  type: 'nuevo' | 'eliminado' | 'modificado';
  changes: FieldChange[];
  beforeRid?: string;
  afterRid?: string;
}

export interface MappingProfile {
  id: string;
  name: string;
  /** Perfil incluido en la aplicación para un formato conocido (no se guarda ni se borra). */
  builtin?: boolean;
  kind: SourceKind;
  role: SheetRole;
  /** Firma de cabeceras normalizadas, para reconocer el mismo formato de Excel. */
  headerSignature: string[];
  /** cabecera normalizada -> campo canónico */
  mapping: Record<string, string>;
  options: ParseOptions;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Capa manual                                                          */
/* ------------------------------------------------------------------ */

export type ReviewState = 'pendiente' | 'revisada' | 'descartada';

export interface AlertReview {
  alertId: string;
  state: ReviewState;
  note?: string;
  user?: string;
  updatedAt?: string;
  firstSeen: string;
}

/** Validación manual de una relación que no se ha podido resolver automáticamente. */
export interface ManualRelation {
  id: string;
  kind: 'orden-padre' | 'orden-aparato';
  /** orden afectada */
  ordenId: string;
  /** orden padre o aparato asignado; vacío si se rechaza la relación */
  targetId: string;
  decision: 'confirmada' | 'rechazada';
  user: string;
  at: string;
  note?: string;
}

export type Role = 'administrador' | 'planificador' | 'consulta';

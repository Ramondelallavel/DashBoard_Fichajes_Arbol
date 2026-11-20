import { fieldDef, ROLE_FIELDS, ROLE_JOIN_FIELD } from '../domain/fields';
import type { Settings } from '../domain/settings';
import type {
  AnyRecord,
  ImportCounts,
  MasterRow,
  Issue,
  IssueCode,
  OrtemsRecord,
  ParseOptions,
  ProdRecord,
  RawCell,
  RawSheet,
  SheetImportConfig,
  SourceKind,
  SourceRef,
} from '../domain/types';
import { headersAt } from './header';
import { isEmptyCell, parseDate, parseDuration, parseId, parseNumber, parsePriority, parseState, parseText, toRawCell, type SheetGrid } from './values';

export interface NormalizeInput {
  kind: SourceKind;
  batchId: string;
  sheets: { grid: SheetGrid; config: SheetImportConfig }[];
  options: ParseOptions;
  settings: Pick<Settings, 'stateMap' | 'priority'>;
}

export interface IssueStat {
  code: IssueCode;
  severity: Issue['severity'];
  count: number;
  examples: { sheet: string; row: number; message: string }[];
}

export interface ColumnNote {
  sheet: string;
  header: string;
  message: string;
}

export interface NormalizeResult {
  records: AnyRecord[];
  rawSheets: RawSheet[];
  counts: ImportCounts;
  issueStats: IssueStat[];
  unknownColumns: string[];
  columnNotes: ColumnNote[];
  masters: MasterRow[];
}

/** Propiedad del registro en la que se guarda cada campo canónico. */
const PROP: Record<string, string> = { duracion: 'duracionH', periodo: 'periodoRaw' };

type Values = Record<string, unknown>;

function parseRowValues(
  kind: SourceKind,
  cells: RawCell[],
  mapping: Record<number, string>,
  opts: ParseOptions,
  settings: NormalizeInput['settings'],
  issues: Issue[],
  numericIdCols: Map<number, number>,
): Values {
  const v: Values = {};
  for (const [colStr, field] of Object.entries(mapping)) {
    if (!field) continue;
    const col = Number(colStr);
    const def = fieldDef(kind, field);
    if (!def) continue;
    const cell = cells[col] ?? null;
    if (isEmptyCell(cell)) continue;
    const prop = PROP[field] ?? field;
    switch (def.type) {
      case 'id': {
        const r = parseId(cell);
        if (r.value !== undefined) v[prop] = r.value;
        if (r.info) numericIdCols.set(col, (numericIdCols.get(col) ?? 0) + 1);
        break;
      }
      case 'text': {
        const r = parseText(cell);
        if (r.value !== undefined) v[prop] = r.value;
        break;
      }
      case 'date': {
        const r = parseDate(cell, opts);
        if (r.error) issues.push({ code: 'FECHA_INVALIDA', severity: 'aviso', field, message: `${def.label}: ${r.error}`, value: String(cell) });
        else if (r.value !== undefined) {
          v[prop] = r.value;
          if (r.info) issues.push({ code: 'FECHA_FUERA_RANGO', severity: 'aviso', field, message: `${def.label}: ${r.info}` });
        }
        break;
      }
      case 'number': {
        const r = parseNumber(cell, opts);
        if (r.error) issues.push({ code: 'NUMERO_INVALIDO', severity: 'aviso', field, message: `${def.label}: ${r.error}` });
        else if (r.value !== undefined) v[prop] = r.value;
        break;
      }
      case 'duration': {
        const r = parseDuration(cell, opts);
        if (r.error && r.value !== undefined) issues.push({ code: 'DURACION_NEGATIVA', severity: 'aviso', field, message: `${def.label}: ${r.error}` });
        else if (r.error) issues.push({ code: 'NUMERO_INVALIDO', severity: 'aviso', field, message: `${def.label}: ${r.error}` });
        else if (r.value !== undefined) v[prop] = r.value;
        break;
      }
      case 'state': {
        const r = parseState(cell, settings.stateMap);
        if (r.value) {
          v.estadoRaw = r.value.raw;
          v.estado = r.value.canon;
        }
        if (r.info) issues.push({ code: 'ESTADO_DESCONOCIDO', severity: 'info', field, message: r.info });
        break;
      }
      case 'priority': {
        const r = parsePriority(cell, opts, settings.priority.textMap);
        if (r.value) {
          v.prioridadRaw = r.value.raw;
          if (r.value.value !== undefined) v.prioridad = r.value.value;
        }
        if (r.info) issues.push({ code: 'PRIORIDAD_NO_INTERPRETABLE', severity: 'aviso', field, message: r.info });
        break;
      }
    }
  }
  return v;
}

function statusOf(issues: Issue[]): AnyRecord['status'] {
  if (issues.some((i) => i.severity === 'error')) return 'rechazado';
  if (issues.some((i) => i.severity === 'aviso')) return 'revision';
  return 'ok';
}

/** Clave de negocio de un registro (para duplicados, versiones e importación incremental). */
export function recordKey(kind: SourceKind, r: AnyRecord): string {
  if (kind === 'produccion') {
    const p = r as ProdRecord;
    return `${p.ordenId ?? p.preordenId ?? ''}|${p.operacionId ?? ''}`;
  }
  const o = r as OrtemsRecord;
  return `${o.ordenId ?? ''}|${o.operacionId ?? ''}|${o.preordenId ?? ''}`;
}

const SIGNATURE_SKIP = new Set(['rid', 'src', 'issues', 'status', 'enriched']);

function signature(r: AnyRecord): string {
  const entries = Object.entries(r)
    .filter(([k, v]) => !SIGNATURE_SKIP.has(k) && v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}

export function normalizeImport(input: NormalizeInput): NormalizeResult {
  const { kind, batchId, options, settings } = input;
  const rawSheets: RawSheet[] = [];
  const records: AnyRecord[] = [];
  const counts: ImportCounts = { total: 0, ok: 0, revision: 0, rechazado: 0, vacias: 0 };
  const unknownColumns: string[] = [];
  const columnNotes: ColumnNote[] = [];
  const lookups: { role: 'ordenes' | 'puestos' | 'aparatos'; sheet: string; map: Map<string, { values: Values; src: SourceRef }> }[] = [];

  // 1) Hojas: datos originales + registros / tablas de unión
  for (const { grid, config } of input.sheets) {
    const headerIdx = config.headerRow - 1;
    const headers = headersAt(grid, headerIdx);
    const raw: RawSheet = { name: grid.name, headerRow: config.headerRow, headers, rows: [] };
    headers.forEach((h, i) => {
      if (!config.mapping[i]) unknownColumns.push(`${grid.name} › ${h}`);
    });
    const numericIdCols = new Map<number, number>();
    const mappedFields = new Set(Object.values(config.mapping).filter(Boolean));
    const lookup = config.role !== 'filas' ? new Map<string, { values: Values; src: SourceRef }>() : undefined;

    for (let i = headerIdx + 1; i < grid.rows.length; i++) {
      const cells = (grid.rows[i] ?? []).map(toRawCell);
      const excelRow = i + 1;
      if (cells.every((c) => isEmptyCell(c))) {
        if (config.role === 'filas') counts.vacias++;
        continue;
      }
      raw.rows.push({ row: excelRow, cells });
      const src: SourceRef = { batchId, sheet: grid.name, row: excelRow };
      const issues: Issue[] = [];
      const values = parseRowValues(kind, cells, config.mapping, options, settings, issues, numericIdCols);

      if (lookup && config.role !== 'filas') {
        const joinField = ROLE_JOIN_FIELD[config.role];
        const key = values[joinField] as string | undefined;
        if (key && !lookup.has(key)) lookup.set(key, { values, src });
        continue;
      }

      counts.total++;
      const rec = { rid: `${batchId}:${grid.name}:${excelRow}`, src, ...values, issues, status: 'ok' } as AnyRecord;
      validateRecord(kind, rec, mappedFields, issues);
      records.push(rec);
    }
    for (const [col, n] of numericIdCols) {
      columnNotes.push({
        sheet: grid.name,
        header: headers[col],
        message: `${n} valores de identificador están guardados como número en Excel. Se conservan tal cual; si el sistema de origen usa ceros a la izquierda, expórtelos como texto.`,
      });
    }
    if (lookup && config.role !== 'filas') lookups.push({ role: config.role, sheet: grid.name, map: lookup });
    rawSheets.push(raw);
  }

  // 2) Enriquecimiento con hojas complementarias (nunca sobrescribe: solo rellena huecos)
  for (const lk of lookups) {
    const joinField = ROLE_JOIN_FIELD[lk.role];
    const fields = ROLE_FIELDS[lk.role].filter((f) => f !== joinField);
    for (const rec of records) {
      const key = (rec as unknown as Values)[joinField] as string | undefined;
      if (!key) continue;
      const hit = lk.map.get(key);
      if (!hit) continue;
      for (const f of fields) {
        const prop = PROP[f] ?? f;
        const props = f === 'estado' ? ['estado', 'estadoRaw'] : f === 'prioridad' ? ['prioridad', 'prioridadRaw'] : [prop];
        const extVal = hit.values[props[props.length - 1]] ?? hit.values[prop];
        if (extVal === undefined) continue;
        const r = rec as unknown as Values;
        const own = r[props[props.length - 1]] ?? r[prop];
        if (own === undefined) {
          for (const p of props) if (hit.values[p] !== undefined) r[p] = hit.values[p];
          ((rec as ProdRecord).enriched ??= []).push({ field: f, from: hit.src });
        } else if (String(own) !== String(extVal)) {
          rec.issues.push({
            code: 'VALOR_DISCREPANTE_HOJAS',
            severity: 'aviso',
            field: f,
            message: `«${fieldDef(kind, f)?.label ?? f}» difiere entre hojas: «${own}» (fila) frente a «${extVal}» (hoja ${lk.sheet}, fila ${hit.src.row}). Se conserva el valor de la fila.`,
          });
        }
      }
    }
  }

  // 3) Duplicados (exactos y de clave). En modo «consolidar», las filas repetidas son avances del
  //    mismo registro (p. ej. fichajes parciales): no son errores y el modelo las agrega.
  if (options.repeatedKeys === 'consolidar') {
    const groups = new Map<string, AnyRecord[]>();
    for (const rec of records) {
      if (statusOf(rec.issues) === 'rechazado') continue;
      const k = recordKey(kind, rec);
      const l = groups.get(k) ?? [];
      l.push(rec);
      groups.set(k, l);
    }
    for (const [key, list] of groups) {
      if (list.length < 2) continue;
      for (const rec of list) {
        rec.issues.push({
          code: 'FILAS_CONSOLIDADAS',
          severity: 'info',
          message: `${list.length} filas para ${key.split('|').filter(Boolean).join(' / ')}: se consolidan como avances del mismo registro.`,
        });
      }
    }
    for (const rec of records) {
      rec.status = statusOf(rec.issues);
      counts[rec.status]++;
    }
    const masters: MasterRow[] = lookups.flatMap((lk) => [...lk.map.entries()].map(([key, v]) => ({ role: lk.role, key, values: v.values, src: v.src })));
    return { records, rawSheets, counts, issueStats: buildStats(records), unknownColumns, columnNotes, masters };
  }
  const byKey = new Map<string, AnyRecord[]>();
  const bySig = new Map<string, AnyRecord>();
  for (const rec of records) {
    if (statusOf(rec.issues) === 'rechazado') continue;
    const sig = signature(rec);
    const prev = bySig.get(sig);
    if (prev) {
      rec.issues.push({
        code: 'DUPLICADO_EXACTO',
        severity: 'error',
        message: `Fila duplicada de la fila ${prev.src.row} (hoja ${prev.src.sheet}). No se importa dos veces.`,
      });
      continue;
    }
    bySig.set(sig, rec);
    const key = recordKey(kind, rec);
    const list = byKey.get(key) ?? [];
    list.push(rec);
    byKey.set(key, list);
  }
  for (const [key, list] of byKey) {
    if (list.length < 2) continue;
    const rows = list.map((r) => `${r.src.sheet}:${r.src.row}`).join(', ');
    for (const rec of list) {
      rec.issues.push({
        code: 'CLAVE_DUPLICADA',
        severity: 'aviso',
        message: `El identificador ${key.split('|').filter(Boolean).join(' / ')} aparece en varias filas con datos distintos (${rows}). Revise cuál es válida; el modelo usa la primera.`,
      });
    }
  }

  for (const rec of records) {
    rec.status = statusOf(rec.issues);
    counts[rec.status]++;
  }

  const masters: MasterRow[] = lookups.flatMap((lk) => [...lk.map.entries()].map(([key, v]) => ({ role: lk.role, key, values: v.values, src: v.src })));
  return { records, rawSheets, counts, issueStats: buildStats(records), unknownColumns, columnNotes, masters };
}

function validateRecord(kind: SourceKind, rec: AnyRecord, mapped: Set<string>, issues: Issue[]) {
  if (kind === 'produccion') {
    const p = rec as ProdRecord;
    if (!p.ordenId && !p.preordenId) issues.push({ code: 'FALTA_ORDEN', severity: 'error', field: 'ordenId', message: 'Fila sin número de orden ni de preorden: no se puede relacionar.' });
    if (p.avance !== undefined && (p.avance < 0 || p.avance > 100)) issues.push({ code: 'NUMERO_INVALIDO', severity: 'aviso', field: 'avance', message: `Porcentaje de avance fuera de 0-100: ${p.avance}.` });
    if (mapped.has('operacionId') && !p.operacionId) issues.push({ code: 'FALTA_OPERACION_ID', severity: 'aviso', field: 'operacionId', message: 'Fila sin identificador de operación.' });
    if (mapped.has('puestoId') && !p.puestoId) issues.push({ code: 'FALTA_PUESTO', severity: 'aviso', field: 'puestoId', message: 'Operación sin puesto de trabajo asignado.' });
    if (mapped.has('aparatoId') && !p.aparatoId) issues.push({ code: 'FALTA_APARATO', severity: 'aviso', field: 'aparatoId', message: 'Fila sin número de aparato.' });
    if (p.inicioPrevisto !== undefined && p.finPrevisto !== undefined && p.inicioPrevisto > p.finPrevisto) {
      issues.push({ code: 'INICIO_POSTERIOR_FIN', severity: 'aviso', message: 'La fecha prevista de inicio es posterior a la de finalización.' });
    }
    if (p.inicioReal !== undefined && p.finReal !== undefined && p.inicioReal > p.finReal) {
      issues.push({ code: 'INICIO_POSTERIOR_FIN', severity: 'aviso', message: 'La fecha real de inicio es posterior a la real de finalización.' });
    }
  } else {
    const o = rec as OrtemsRecord;
    if (!o.ordenId && !o.preordenId) issues.push({ code: 'FALTA_ORDEN', severity: 'error', message: 'Fila sin orden ni preorden: no se puede comparar.' });
    if (o.inicio !== undefined && o.fin !== undefined && o.inicio > o.fin) {
      issues.push({ code: 'INICIO_POSTERIOR_FIN', severity: 'aviso', message: 'Inicio de Ortems posterior al fin.' });
    }
  }
}

function buildStats(records: AnyRecord[]): IssueStat[] {
  const map = new Map<IssueCode, IssueStat>();
  for (const r of records) {
    for (const i of r.issues) {
      const st = map.get(i.code) ?? { code: i.code, severity: i.severity, count: 0, examples: [] };
      st.count++;
      if (st.examples.length < 8) st.examples.push({ sheet: r.src.sheet, row: r.src.row, message: i.message });
      map.set(i.code, st);
    }
  }
  const order = { error: 0, aviso: 1, info: 2 };
  return [...map.values()].sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count);
}

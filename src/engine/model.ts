import type { Settings } from '../domain/settings';
import type { DatasetVersion, EstadoCanonico, ManualRelation, MasterRow, ProdRecord, RecordStatus, SourceRef } from '../domain/types';
import { naturalCompare } from '../lib/text';

/** Estado de una relación entre entidades. */
export type LinkStatus = 'confirmada' | 'inferida' | 'pendiente' | 'manual' | 'rechazada';

export interface Dependency {
  /** Operación predecesora (undefined si no se ha podido resolver). */
  from?: string;
  to: string;
  tipo: 'confirmada' | 'inferida' | 'pendiente';
  regla: string;
}

export interface Operacion {
  key: string;
  ordenId: string;
  operacionId?: string;
  /** Etiqueta mostrable (nº de operación o fila de origen si no hay identificador). */
  label: string;
  seq?: number;
  desc?: string;
  puestoId?: string;
  puestoDesc?: string;
  seccion?: string;
  area?: string;
  centro?: string;
  aparatoId?: string;
  articuloRef?: string;
  articuloDesc?: string;
  familia?: string;
  preordenId?: string;
  /** Fechas previstas (planificación). */
  start?: number;
  end?: number;
  /** Fechas reales (p. ej. fichajes). Nunca se presentan como previstas. */
  realStart?: number;
  realEnd?: number;
  target?: number;
  /** Avance declarado (0-100). */
  avance?: number;
  /** Duración del Excel (horas). */
  durationH?: number;
  estado: EstadoCanonico;
  estadoRaw?: string;
  prioridad?: number;
  prioridadRaw?: string;
  cantidad?: number;
  rid: string;
  rids: string[];
  src: SourceRef;
  status: RecordStatus;
  /** Operación precedente indicada explícitamente en el Excel (texto original). */
  predRaw?: string;
  preds: Dependency[];
  succs: string[];
}

export interface Orden {
  /** Identificador del nodo: número de orden o, si el Excel no tiene orden, número de preorden. */
  id: string;
  tipo: 'orden' | 'preorden';
  /** Número de orden de fabricación (solo si existe en el Excel). */
  ordenId?: string;
  aparatoId?: string;
  aparatoLink: LinkStatus | 'sin_aparato';
  aparatoRule?: string;
  preordenId?: string;
  articuloRef?: string;
  articuloDesc?: string;
  familia?: string;
  parentId?: string;
  parentLink?: LinkStatus;
  parentRule?: string;
  /** La orden/preorden padre no está en producción pero sí está planificada en Ortems. */
  parentExternal?: boolean;
  childIds: string[];
  opKeys: string[];
  start?: number;
  end?: number;
  realStart?: number;
  realEnd?: number;
  estado: EstadoCanonico;
  prioridad?: number;
  target?: number;
  rids: string[];
}

/** Nombre mostrable de un nodo del árbol («Orden 50001» o «Preorden 9000001»). */
export function nodeName(o: Pick<Orden, 'id' | 'tipo'> | undefined, id?: string): string {
  if (!o) return `Orden ${id ?? ''}`;
  return `${o.tipo === 'preorden' ? 'Preorden' : 'Orden'} ${o.id}`;
}

/**
 * Intervalo de una operación para representarla: fechas previstas si existen; si no, fechas reales.
 * `real` indica que se trata de ejecución real (fichajes), no de planificación.
 */
export function opSpan(op: Pick<Operacion, 'start' | 'end' | 'realStart' | 'realEnd'>): { start: number; end: number; real: boolean } | undefined {
  if (op.start !== undefined && op.end !== undefined) return { start: op.start, end: Math.max(op.end, op.start), real: false };
  if (op.realStart !== undefined && op.realEnd !== undefined) return { start: op.realStart, end: Math.max(op.realEnd, op.realStart), real: true };
  if (op.realEnd !== undefined && op.start === undefined) return { start: op.realEnd, end: op.realEnd, real: true };
  return undefined;
}

/** Identificadores conocidos fuera de producción (p. ej. órdenes y preórdenes planificadas en Ortems). */
export interface ExternalIds {
  has(id: string): boolean;
  source: string;
}

export interface Aparato {
  id: string;
  articuloRef?: string;
  desc?: string;
  familia?: string;
  secciones: string[];
  puestos: string[];
  ordenIds: string[];
  rootOrdenIds: string[];
  start?: number;
  end?: number;
  estado: EstadoCanonico;
  /** Solo existe en maestro (sin órdenes). */
  soloMaestro?: boolean;
}

export interface Puesto {
  id: string;
  desc?: string;
  seccion?: string;
  area?: string;
  centro?: string;
  opKeys: string[];
}

export interface Relation {
  id: string;
  kind: 'orden-aparato' | 'orden-padre' | 'operacion';
  from: string;
  to?: string;
  status: LinkStatus;
  regla: string;
  detail: string;
  aparatoId?: string;
}

export type QualityCode =
  | 'ORDEN_SIN_APARATO'
  | 'APARATO_SIN_ORDENES'
  | 'OPERACION_SIN_PUESTO'
  | 'OPERACION_SIN_FECHAS'
  | 'OPERACION_SIN_DURACION'
  | 'ID_DUPLICADO'
  | 'RELACION_AMBIGUA'
  | 'PADRE_NO_ENCONTRADO'
  | 'PRECEDENTE_NO_ENCONTRADO'
  | 'ORDENES_SIN_RELACION'
  | 'CICLO_ORDENES';

export interface QualityIssue {
  id: string;
  code: QualityCode;
  severity: 'alta' | 'media' | 'informativa';
  message: string;
  aparatoId?: string;
  ordenId?: string;
  opKey?: string;
  puestoId?: string;
  rids: string[];
}

export interface ProductionModel {
  aparatos: Map<string, Aparato>;
  ordenes: Map<string, Orden>;
  ops: Map<string, Operacion>;
  puestos: Map<string, Puesto>;
  secciones: string[];
  familias: string[];
  relations: Relation[];
  quality: QualityIssue[];
  records: Map<string, ProdRecord>;
  /** El Excel contiene identificadores de operación. */
  opLevel: boolean;
  /** Qué tipo de información trae el Excel de producción (para no exigir lo que no contiene). */
  has: { puestos: boolean; previstas: boolean; reales: boolean; duracion: boolean };
}

function aggregateEstado(states: EstadoCanonico[]): EstadoCanonico {
  const known = states.filter((s) => s !== 'desconocido');
  if (!known.length) return 'desconocido';
  if (known.includes('bloqueada')) return 'bloqueada';
  if (known.every((s) => s === 'terminada')) return 'terminada';
  if (known.every((s) => s === 'pendiente')) return 'pendiente';
  return 'en_curso';
}

function minDef(a: number | undefined, b: number | undefined) {
  return a === undefined ? b : b === undefined ? a : Math.min(a, b);
}
function maxDef(a: number | undefined, b: number | undefined) {
  return a === undefined ? b : b === undefined ? a : Math.max(a, b);
}

function distinct<T>(values: (T | undefined)[]): T[] {
  return [...new Set(values.filter((v): v is T => v !== undefined && v !== null && (v as unknown) !== ''))];
}

function mostFrequent(values: (string | undefined)[]): string | undefined {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | undefined;
  let n = 0;
  for (const [v, c] of counts) if (c > n) [best, n] = [v, c];
  return best;
}

export function buildProductionModel(dataset: DatasetVersion | undefined, settings: Settings, manual: ManualRelation[] = [], external?: ExternalIds): ProductionModel {
  const records = new Map<string, ProdRecord>();
  const ops = new Map<string, Operacion>();
  const ordenes = new Map<string, Orden>();
  const aparatos = new Map<string, Aparato>();
  const puestos = new Map<string, Puesto>();
  const relations: Relation[] = [];
  const quality: QualityIssue[] = [];
  const masters: MasterRow[] = dataset?.masters ?? [];
  const recs = ((dataset?.records ?? []) as ProdRecord[]).filter((r) => r.status !== 'rechazado' && (r.ordenId || r.preordenId));
  for (const r of recs) records.set(r.rid, r);
  const opLevel = recs.some((r) => r.operacionId);
  const has = {
    puestos: recs.some((r) => r.puestoId),
    previstas: recs.some((r) => r.inicioPrevisto !== undefined || r.finPrevisto !== undefined),
    reales: recs.some((r) => r.inicioReal !== undefined || r.finReal !== undefined),
    duracion: recs.some((r) => r.duracionH !== undefined),
  };
  const estadoOf = (r: ProdRecord): EstadoCanonico => (r.estado && r.estado !== 'desconocido' ? r.estado : r.avance === 100 ? 'terminada' : r.estado ?? 'desconocido');

  // 1) Operaciones (una por clave orden+operación; los duplicados quedan trazados)
  const ordenRecs = new Map<string, ProdRecord[]>();
  const allRecs = new Map<string, ProdRecord[]>();
  const consolidated = (r: ProdRecord) => r.issues.some((i) => i.code === 'FILAS_CONSOLIDADAS');
  for (const r of recs) {
    const ordenId = (r.ordenId ?? r.preordenId)!;
    const al = allRecs.get(ordenId) ?? [];
    al.push(r);
    allRecs.set(ordenId, al);
    // Filas consolidadas sin operación: todas son avances de la misma preorden/orden
    const key = r.operacionId ? `${ordenId}|${r.operacionId}` : consolidated(r) ? `${ordenId}|*` : `${ordenId}|fila ${r.src.sheet}:${r.src.row}`;
    const existing = ops.get(key);
    if (existing && consolidated(r)) {
      // Consolidación de avances: intervalo total, mayor avance y estado de la fila más reciente
      existing.rids.push(r.rid);
      const latest = (r.finReal ?? r.finPrevisto ?? -Infinity) >= (existing.realEnd ?? existing.end ?? -Infinity);
      existing.start = minDef(existing.start, r.inicioPrevisto);
      existing.end = maxDef(existing.end, r.finPrevisto);
      existing.realStart = minDef(existing.realStart, r.inicioReal);
      existing.realEnd = maxDef(existing.realEnd, r.finReal);
      existing.avance = maxDef(existing.avance, r.avance);
      existing.durationH ??= r.duracionH;
      if (latest) {
        existing.estado = estadoOf(r);
        existing.estadoRaw = r.estadoRaw ?? existing.estadoRaw;
      }
      if (existing.avance === 100 && existing.estado === 'desconocido') existing.estado = 'terminada';
      continue;
    }
    if (existing) {
      existing.rids.push(r.rid);
      quality.push({
        id: `dup:${key}`,
        code: 'ID_DUPLICADO',
        severity: 'media',
        message: `La operación ${r.operacionId ?? existing.label} de ${r.ordenId ? 'la orden' : 'la preorden'} ${ordenId} aparece en varias filas (filas ${existing.src.row} y ${r.src.row}). Se usa la primera.`,
        ordenId,
        opKey: key,
        rids: [existing.rid, r.rid],
      });
      continue;
    }
    const list = ordenRecs.get(ordenId) ?? [];
    list.push(r);
    ordenRecs.set(ordenId, list);
    ops.set(key, {
      key,
      ordenId,
      operacionId: r.operacionId,
      label: r.operacionId ?? (!r.ordenId && r.seccion ? r.seccion : `Fila ${r.src.row}`),
      seq: r.secuencia,
      desc: r.operacionDesc,
      puestoId: r.puestoId,
      puestoDesc: r.puestoDesc,
      seccion: r.seccion,
      area: r.area,
      centro: r.centroTrabajo,
      aparatoId: r.aparatoId,
      articuloRef: r.articuloRef,
      articuloDesc: r.articuloDesc,
      familia: r.familia,
      preordenId: r.preordenId,
      start: r.inicioPrevisto,
      end: r.finPrevisto,
      realStart: r.inicioReal,
      realEnd: r.finReal,
      target: r.fechaObjetivo,
      avance: r.avance,
      durationH: r.duracionH,
      estado: estadoOf(r),
      estadoRaw: r.estadoRaw,
      prioridad: r.prioridad,
      prioridadRaw: r.prioridadRaw,
      cantidad: r.cantidad,
      rid: r.rid,
      rids: [r.rid],
      src: r.src,
      status: r.status,
      predRaw: r.operacionPrecedenteId,
      preds: [],
      succs: [],
    });
  }

  // 2) Órdenes
  for (const [ordenId, firstRecs] of ordenRecs) {
    // incluye las filas consolidadas: un padre distinto en otra fila es una ambigüedad real
    const list = allRecs.get(ordenId) ?? firstRecs;
    const aparatoIds = distinct(list.map((r) => r.aparatoId));
    const parentIds = distinct(list.map((r) => r.ordenPadreId));
    const tipo: Orden['tipo'] = list.some((r) => r.ordenId) ? 'orden' : 'preorden';
    const o: Orden = {
      id: ordenId,
      tipo,
      ordenId: tipo === 'orden' ? ordenId : undefined,
      aparatoLink: 'sin_aparato',
      preordenId: distinct(list.map((r) => r.preordenId))[0],
      articuloRef: mostFrequent(list.map((r) => r.articuloRef)),
      articuloDesc: mostFrequent(list.map((r) => r.articuloDesc)),
      familia: mostFrequent(list.map((r) => r.familia)),
      childIds: [],
      opKeys: [],
      estado: 'desconocido',
      rids: list.map((r) => r.rid),
      target: list.reduce<number | undefined>((acc, r) => maxDef(acc, r.fechaObjetivo), undefined),
      prioridad: list.find((r) => r.prioridad !== undefined)?.prioridad,
    };
    if (aparatoIds.length === 1) {
      o.aparatoId = aparatoIds[0];
      o.aparatoLink = 'confirmada';
      o.aparatoRule = 'Campo «Número de aparato» del Excel';
    } else if (aparatoIds.length > 1) {
      o.aparatoLink = 'pendiente';
      o.aparatoRule = `Ambigua: la orden aparece con ${aparatoIds.length} aparatos distintos (${aparatoIds.join(', ')})`;
      quality.push({
        id: `amb-ap:${ordenId}`,
        code: 'RELACION_AMBIGUA',
        severity: 'alta',
        message: `${nodeName(o)} está asociada a varios aparatos (${aparatoIds.join(', ')}). Requiere validación manual.`,
        ordenId,
        rids: o.rids,
      });
    }
    if (parentIds.length === 1) {
      o.parentId = parentIds[0];
      o.parentLink = 'confirmada';
      o.parentRule = tipo === 'preorden' ? 'Campo «Preorden siguiente» del Excel' : 'Campo «Orden padre» del Excel';
    } else if (parentIds.length > 1) {
      o.parentLink = 'pendiente';
      o.parentRule = `Ambigua: el Excel indica ${parentIds.length} ${tipo === 'preorden' ? 'preórdenes siguientes' : 'órdenes padre'} distintas (${parentIds.join(', ')})`;
      quality.push({
        id: `amb-pa:${ordenId}`,
        code: 'RELACION_AMBIGUA',
        severity: 'media',
        message: `${nodeName(o)} indica varios padres/siguientes distintos en distintas filas (${parentIds.join(', ')}). Requiere validación.`,
        ordenId,
        aparatoId: o.aparatoId,
        rids: o.rids,
      });
    }
    ordenes.set(ordenId, o);
  }
  for (const op of ops.values()) ordenes.get(op.ordenId)?.opKeys.push(op.key);

  // Maestro de órdenes: aporta atributos sin sobrescribir
  for (const m of masters.filter((x) => x.role === 'ordenes')) {
    const o = ordenes.get(m.key);
    if (!o) continue;
    const v = m.values as Record<string, string | undefined>;
    if (!o.aparatoId && v.aparatoId) {
      o.aparatoId = v.aparatoId;
      o.aparatoLink = 'confirmada';
      o.aparatoRule = `Hoja complementaria «${m.src.sheet}», fila ${m.src.row}`;
    }
    if (!o.parentId && v.ordenPadreId) {
      o.parentId = v.ordenPadreId;
      o.parentLink = 'confirmada';
      o.parentRule = `Hoja complementaria «${m.src.sheet}», fila ${m.src.row}`;
    }
  }

  // 3) Validaciones manuales (capa separada, prevalecen sobre la inferencia y se trazan)
  for (const mr of manual) {
    const o = ordenes.get(mr.ordenId);
    if (!o) continue;
    if (mr.kind === 'orden-padre') {
      if (mr.decision === 'confirmada' && mr.targetId) {
        o.parentId = mr.targetId;
        o.parentLink = 'manual';
        o.parentRule = `Validada manualmente por ${mr.user}`;
      } else if (mr.decision === 'confirmada' && !mr.targetId) {
        o.parentId = undefined;
        o.parentLink = 'manual';
        o.parentRule = `Confirmada manualmente como orden independiente (${mr.user})`;
      } else if (mr.decision === 'rechazada') {
        o.parentLink = 'rechazada';
        o.parentRule = `Relación con ${o.parentId ?? '—'} rechazada manualmente (${mr.user})`;
        o.parentId = undefined;
      }
    } else if (mr.kind === 'orden-aparato' && mr.decision === 'confirmada' && mr.targetId) {
      o.aparatoId = mr.targetId;
      o.aparatoLink = 'manual';
      o.aparatoRule = `Asignado manualmente por ${mr.user}`;
    }
  }

  // 4) Relaciones orden-padre: padre existente o pendiente; detección de ciclos
  for (const o of ordenes.values()) {
    if (!o.parentId) continue;
    const parent = ordenes.get(o.parentId);
    if (!parent) {
      const what = o.tipo === 'preorden' ? 'su preorden siguiente' : 'como padre la orden';
      if (external?.has(o.parentId)) {
        // relación declarada en el Excel; el padre aún no está en producción pero sí planificado en Ortems
        o.parentExternal = true;
        relations.push({ id: `rel-pa:${o.id}`, kind: 'orden-padre', from: o.id, to: o.parentId, status: o.parentLink ?? 'confirmada', regla: o.parentRule ?? '', detail: `${nodeName(o)} → ${o.parentId} (planificada en ${external.source}, todavía sin datos en producción)`, aparatoId: o.aparatoId });
        continue;
      }
      quality.push({
        id: `pnf:${o.id}`,
        code: 'PADRE_NO_ENCONTRADO',
        severity: 'informativa',
        message: `${nodeName(o)} indica ${what} ${o.parentId}, que no está ni en producción ni en Ortems.`,
        ordenId: o.id,
        aparatoId: o.aparatoId,
        rids: o.rids,
      });
      relations.push({ id: `rel-pa:${o.id}`, kind: 'orden-padre', from: o.id, to: o.parentId, status: 'pendiente', regla: o.parentRule ?? '', detail: `${o.parentId} no encontrada en los datos importados`, aparatoId: o.aparatoId });
      continue;
    }
    parent.childIds.push(o.id);
  }
  for (const o of ordenes.values()) {
    const seen = new Set<string>([o.id]);
    let p = o.parentId ? ordenes.get(o.parentId) : undefined;
    while (p) {
      if (seen.has(p.id)) {
        quality.push({ id: `cyc:${o.id}`, code: 'CICLO_ORDENES', severity: 'alta', message: `Ciclo en la estructura de órdenes a partir de ${o.id}. Se ignora la relación con ${o.parentId}.`, ordenId: o.id, rids: o.rids });
        const par = ordenes.get(o.parentId!);
        if (par) par.childIds = par.childIds.filter((c) => c !== o.id);
        o.parentLink = 'pendiente';
        o.parentRule = 'Ciclo detectado';
        o.parentId = undefined;
        break;
      }
      seen.add(p.id);
      p = p.parentId ? ordenes.get(p.parentId) : undefined;
    }
  }

  // 5) Aparato heredado (INFERIDO) a través de la estructura de órdenes
  if (settings.dependencies.inheritAparatoFromParent) {
    let changed = true;
    let guard = 0;
    while (changed && guard < 50) {
      changed = false;
      guard++;
      for (const o of ordenes.values()) {
        if (o.aparatoId) continue;
        const parent = o.parentId ? ordenes.get(o.parentId) : undefined;
        if (parent?.aparatoId) {
          o.aparatoId = parent.aparatoId;
          o.aparatoLink = 'inferida';
          o.aparatoRule = `Heredado de la orden padre ${parent.id}`;
          changed = true;
          continue;
        }
        const childAps = distinct(o.childIds.map((c) => ordenes.get(c)?.aparatoId));
        if (childAps.length === 1) {
          o.aparatoId = childAps[0];
          o.aparatoLink = 'inferida';
          o.aparatoRule = `Inferido de sus órdenes hijas (${o.childIds.join(', ')})`;
          changed = true;
        }
      }
    }
  }

  // 6) Agregados de órdenes
  for (const o of ordenes.values()) {
    const list = o.opKeys.map((k) => ops.get(k)!);
    o.start = list.reduce<number | undefined>((a, x) => minDef(a, x.start), undefined);
    o.end = list.reduce<number | undefined>((a, x) => maxDef(a, x.end), undefined);
    o.realStart = list.reduce<number | undefined>((a, x) => minDef(a, x.realStart), undefined);
    o.realEnd = list.reduce<number | undefined>((a, x) => maxDef(a, x.realEnd), undefined);
    o.estado = aggregateEstado(list.map((x) => x.estado));
    for (const op of list) {
      // la operación hereda el aparato de su orden (incluido el inferido), sin tocar el registro original
      if (!op.aparatoId && o.aparatoId) op.aparatoId = o.aparatoId;
    }
    relations.push({
      id: `rel-ap:${o.id}`,
      kind: 'orden-aparato',
      from: o.id,
      to: o.aparatoId,
      status: o.aparatoLink === 'sin_aparato' ? 'pendiente' : o.aparatoLink,
      regla: o.aparatoRule ?? 'Sin dato de aparato',
      detail: o.aparatoId ? `${nodeName(o)} → aparato ${o.aparatoId}` : `${nodeName(o)} no tiene aparato asociado`,
      aparatoId: o.aparatoId,
    });
    if (o.parentId && ordenes.has(o.parentId)) {
      relations.push({ id: `rel-pa:${o.id}`, kind: 'orden-padre', from: o.id, to: o.parentId, status: o.parentLink ?? 'confirmada', regla: o.parentRule ?? '', detail: `${nodeName(o)} → ${nodeName(ordenes.get(o.parentId))}`, aparatoId: o.aparatoId });
    }
    if (!o.aparatoId) {
      quality.push({ id: `nap:${o.id}`, code: 'ORDEN_SIN_APARATO', severity: 'media', message: `${nodeName(o)} no tiene aparato asociado y no se ha podido inferir.`, ordenId: o.id, rids: o.rids });
    }
  }

  // 7) Puestos
  for (const op of ops.values()) {
    if (!op.puestoId) continue;
    const p = puestos.get(op.puestoId) ?? { id: op.puestoId, opKeys: [] };
    p.desc ??= op.puestoDesc;
    p.seccion ??= op.seccion;
    p.area ??= op.area;
    p.centro ??= op.centro;
    p.opKeys.push(op.key);
    puestos.set(op.puestoId, p);
  }
  for (const m of masters.filter((x) => x.role === 'puestos')) {
    const v = m.values as Record<string, string | undefined>;
    const p = puestos.get(m.key) ?? { id: m.key, opKeys: [] };
    p.desc ??= v.puestoDesc;
    p.seccion ??= v.seccion;
    p.area ??= v.area;
    p.centro ??= v.centroTrabajo;
    puestos.set(m.key, p);
  }
  // completar la sección de la operación desde el puesto si la fila no la traía
  for (const op of ops.values()) {
    if (op.puestoId && !op.seccion) op.seccion = puestos.get(op.puestoId)?.seccion;
    if (op.puestoId && !op.area) op.area = puestos.get(op.puestoId)?.area;
    if (op.puestoId && !op.centro) op.centro = puestos.get(op.puestoId)?.centro;
    if (op.puestoId && !op.puestoDesc) op.puestoDesc = puestos.get(op.puestoId)?.desc;
  }

  // 8) Aparatos
  for (const o of ordenes.values()) {
    if (!o.aparatoId) continue;
    const a = aparatos.get(o.aparatoId) ?? { id: o.aparatoId, secciones: [], puestos: [], ordenIds: [], rootOrdenIds: [], estado: 'desconocido' as EstadoCanonico };
    a.ordenIds.push(o.id);
    aparatos.set(o.aparatoId, a);
  }
  for (const m of masters.filter((x) => x.role === 'aparatos')) {
    const v = m.values as Record<string, string | undefined>;
    let a = aparatos.get(m.key);
    if (!a) {
      a = { id: m.key, secciones: [], puestos: [], ordenIds: [], rootOrdenIds: [], estado: 'desconocido', soloMaestro: true };
      aparatos.set(m.key, a);
      quality.push({ id: `apso:${m.key}`, code: 'APARATO_SIN_ORDENES', severity: 'informativa', message: `El aparato ${m.key} figura en el maestro pero no tiene órdenes asociadas.`, aparatoId: m.key, rids: [] });
    }
    a.articuloRef ??= v.articuloRef;
    a.desc ??= v.articuloDesc;
    a.familia ??= v.familia;
  }
  for (const a of aparatos.values()) {
    const ords = a.ordenIds.map((id) => ordenes.get(id)!);
    const aops = ords.flatMap((o) => o.opKeys.map((k) => ops.get(k)!));
    a.rootOrdenIds = ords.filter((o) => !o.parentId || ordenes.get(o.parentId)?.aparatoId !== a.id).map((o) => o.id).sort(naturalCompare);
    const roots = a.rootOrdenIds.map((id) => ordenes.get(id)!);
    a.articuloRef ??= mostFrequent(roots.map((o) => o.articuloRef)) ?? mostFrequent(ords.map((o) => o.articuloRef));
    a.desc ??= mostFrequent(roots.map((o) => o.articuloDesc)) ?? mostFrequent(ords.map((o) => o.articuloDesc));
    a.familia ??= mostFrequent(ords.map((o) => o.familia));
    a.secciones = distinct(aops.map((op) => op.seccion)).sort(naturalCompare);
    a.puestos = distinct(aops.map((op) => op.puestoId)).sort(naturalCompare);
    a.start = ords.reduce<number | undefined>((x, o) => minDef(x, o.start ?? o.realStart), undefined);
    a.end = ords.reduce<number | undefined>((x, o) => maxDef(x, o.end ?? o.realEnd), undefined);
    a.estado = aggregateEstado(ords.map((o) => o.estado));
    a.ordenIds.sort(naturalCompare);
    // Solo cuentan como «sin relación» las raíces que no declaran padre: si lo declaran (aunque el padre
    // esté fuera de los datos o planificado en Ortems), la relación es conocida.
    const undeclared = a.rootOrdenIds.filter((r) => !ordenes.get(r)!.parentId);
    if (undeclared.length > 1) {
      for (const rid of undeclared) {
        const o = ordenes.get(rid)!;
        if (o.parentLink === 'manual') continue;
        relations.push({
          id: `rel-root:${rid}`,
          kind: 'orden-padre',
          from: rid,
          status: 'pendiente',
          regla: 'Sin dato de orden padre',
          detail: `${nodeName(o)} no tiene relación jerárquica conocida con las demás órdenes del aparato ${a.id}.`,
          aparatoId: a.id,
        });
      }
      const pend = undeclared.filter((r) => ordenes.get(r)?.parentLink !== 'manual');
      if (pend.length > 1) {
        quality.push({
          id: `nrel:${a.id}`,
          code: 'ORDENES_SIN_RELACION',
          severity: 'media',
          message: `El aparato ${a.id} tiene ${pend.length} órdenes sin relación jerárquica conocida (${pend.join(', ')}). El árbol de procesos está incompleto: valide la relación.`,
          aparatoId: a.id,
          rids: pend.flatMap((r) => ordenes.get(r)?.rids ?? []),
        });
      }
    }
  }

  // 9) Dependencias entre operaciones
  buildDependencies(ops, ordenes, settings, quality, relations);

  // 10) Calidad de operaciones
  for (const op of ops.values()) {
    // solo se exige lo que el Excel contiene: un fichero sin puestos no genera una alerta por operación
    if (!op.puestoId && has.puestos) {
      quality.push({ id: `nps:${op.key}`, code: 'OPERACION_SIN_PUESTO', severity: 'alta', message: `La operación ${op.label} de la orden ${op.ordenId} no tiene puesto de trabajo.`, aparatoId: op.aparatoId, ordenId: op.ordenId, opKey: op.key, rids: op.rids });
    }
    if (!opSpan(op)) {
      quality.push({ id: `nfe:${op.key}`, code: 'OPERACION_SIN_FECHAS', severity: 'media', message: `La operación ${op.label} de ${op.ordenId} no tiene fechas completas (ni previstas ni reales): no aparece en el Gantt ni en la carga por periodo.`, aparatoId: op.aparatoId, ordenId: op.ordenId, opKey: op.key, puestoId: op.puestoId, rids: op.rids });
    }
    if (op.durationH === undefined && has.duracion) {
      quality.push({ id: `ndu:${op.key}`, code: 'OPERACION_SIN_DURACION', severity: 'informativa', message: `La operación ${op.label} de la orden ${op.ordenId} no tiene duración prevista en el Excel${settings.load.estimateDurationFromDates ? '; la carga se estima a partir de las fechas' : ''}.`, aparatoId: op.aparatoId, ordenId: op.ordenId, opKey: op.key, puestoId: op.puestoId, rids: op.rids });
    }
  }

  const secciones = distinct([...puestos.values()].map((p) => p.seccion).concat([...ops.values()].map((o) => o.seccion))).sort(naturalCompare);
  const familias = distinct([...aparatos.values()].map((a) => a.familia).concat([...ordenes.values()].map((o) => o.familia))).sort(naturalCompare);
  return { aparatos, ordenes, ops, puestos, secciones, familias, relations, quality, records, opLevel, has };
}

/** Ordena las operaciones de una orden en grupos de secuencia (las del mismo grupo son paralelas). */
export function sequenceGroups(list: Operacion[]): Operacion[][] {
  const withSeq = list.every((o) => o.seq !== undefined);
  const sorted = [...list].sort((a, b) => (withSeq ? a.seq! - b.seq! : 0) || naturalCompare(a.operacionId ?? a.label, b.operacionId ?? b.label));
  const groups: Operacion[][] = [];
  for (const op of sorted) {
    const last = groups[groups.length - 1];
    if (last && withSeq && last[0].seq === op.seq) last.push(op);
    else groups.push([op]);
  }
  return groups;
}

function addDep(ops: Map<string, Operacion>, dep: Dependency) {
  const to = ops.get(dep.to);
  if (!to) return;
  if (dep.from && to.preds.some((p) => p.from === dep.from)) return;
  to.preds.push(dep);
  if (dep.from) ops.get(dep.from)?.succs.push(dep.to);
}

function buildDependencies(ops: Map<string, Operacion>, ordenes: Map<string, Orden>, settings: Settings, quality: QualityIssue[], relations: Relation[]) {
  const byOrden = new Map<string, Operacion[]>();
  for (const op of ops.values()) {
    const l = byOrden.get(op.ordenId) ?? [];
    l.push(op);
    byOrden.set(op.ordenId, l);
  }
  const explicitRecs = new Set<string>();
  // a) Dependencias explícitas (CONFIRMADAS por dato)
  for (const [ordenId, list] of byOrden) {
    for (const op of list) {
      const predId = recordPredecessor(op, ops);
      if (predId === undefined) continue;
      explicitRecs.add(ordenId);
      const { key, raw } = predId;
      if (key) addDep(ops, { from: key, to: op.key, tipo: 'confirmada', regla: 'Campo «Operación precedente» del Excel' });
      else {
        addDep(ops, { to: op.key, tipo: 'pendiente', regla: `Precedente «${raw}» no encontrada` });
        quality.push({
          id: `pre:${op.key}`,
          code: 'PRECEDENTE_NO_ENCONTRADO',
          severity: 'media',
          message: `La operación ${op.label} de la orden ${op.ordenId} indica como precedente «${raw}», que no existe en los datos.`,
          ordenId: op.ordenId,
          aparatoId: op.aparatoId,
          opKey: op.key,
          rids: op.rids,
        });
      }
    }
  }
  // b) Secuencia por número de operación (INFERIDA), solo en órdenes sin dependencias explícitas
  const groupsByOrden = new Map<string, Operacion[][]>();
  for (const [ordenId, list] of byOrden) {
    const groups = sequenceGroups(list);
    groupsByOrden.set(ordenId, groups);
    if (!settings.dependencies.sequenceByOperationNumber || explicitRecs.has(ordenId)) continue;
    if (!list.every((o) => o.operacionId || o.seq !== undefined)) continue;
    for (let g = 1; g < groups.length; g++) {
      for (const to of groups[g]) for (const from of groups[g - 1]) addDep(ops, { from: from.key, to: to.key, tipo: 'inferida', regla: 'Secuencia por número de operación' });
    }
  }
  // c) Orden hija antes que orden padre (INFERIDA), solo con relación padre confirmada o manual
  if (settings.dependencies.childBeforeParent) {
    for (const o of ordenes.values()) {
      if (!o.parentId || !(o.parentLink === 'confirmada' || o.parentLink === 'manual')) continue;
      const childGroups = groupsByOrden.get(o.id);
      const parentGroups = groupsByOrden.get(o.parentId);
      if (!childGroups?.length || !parentGroups?.length) continue;
      const lastChild = childGroups[childGroups.length - 1];
      const firstParent = parentGroups[0];
      for (const to of firstParent) for (const from of lastChild) addDep(ops, { from: from.key, to: to.key, tipo: 'inferida', regla: `La orden hija ${o.id} precede a la orden padre ${o.parentId}` });
    }
  }
  for (const op of ops.values()) {
    for (const d of op.preds) {
      relations.push({ id: `rel-op:${d.from ?? '?'}>${op.key}`, kind: 'operacion', from: d.from ?? '?', to: op.key, status: d.tipo, regla: d.regla, detail: `${d.from ?? '¿?'} → ${op.key}`, aparatoId: op.aparatoId });
    }
  }
}

/** Resuelve la precedente explícita: primero dentro de la misma orden, después «orden/operación». */
function recordPredecessor(op: Operacion, ops: Map<string, Operacion>): { key?: string; raw: string } | undefined {
  const raw = op.predRaw?.trim();
  if (!raw) return undefined;
  const sameOrder = `${op.ordenId}|${raw}`;
  if (ops.has(sameOrder)) return { key: sameOrder, raw };
  const m = /^(.+?)[/|](.+)$/.exec(raw);
  const cross = m ? `${m[1].trim()}|${m[2].trim()}` : undefined;
  return cross && ops.has(cross) ? { key: cross, raw } : { raw };
}

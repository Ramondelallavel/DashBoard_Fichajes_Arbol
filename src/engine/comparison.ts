import { isHighPriority, priorityRank, type Settings } from '../domain/settings';
import type { DatasetVersion, OrtemsRecord } from '../domain/types';
import { HOUR } from '../lib/dates';
import { fmtNum } from '../lib/format';
import { idKey, stableHash } from '../lib/text';
import { recordKey } from '../import/normalize';
import type { CapacityCalendar } from './calendar';
import type { MatchResult } from './matching';
import { nodeName, type ProductionModel } from './model';
import { OVERLAP_LABEL, type OverlapGroup } from './overlaps';

export type Criticidad = 'critica' | 'alta' | 'media' | 'informativa';

/** Días hacia atrás en la cola de un puesto en los que se busca una inversión de prioridad. */
export const INVERSION_WINDOW_DAYS = 14;

export const CRIT_RANK: Record<Criticidad, number> = { critica: 4, alta: 3, media: 2, informativa: 1 };
export const CRIT_LABEL: Record<Criticidad, string> = { critica: 'Crítica', alta: 'Alta', media: 'Media', informativa: 'Informativa' };

export type DiscrepancyType =
  | 'inicio'
  | 'fin'
  | 'duracion'
  | 'recurso'
  | 'prioridad_modificada'
  | 'solo_produccion'
  | 'solo_ortems'
  | 'preorden_no_lanzada'
  | 'ambigua'
  | 'operacion_no_encontrada'
  | 'prioridad_alta_retrasada'
  | 'prioridad_invertida'
  | 'precedencia_ortems'
  | 'solape_ortems'
  | 'multiples_registros'
  | 'saturacion_combinada'
  | 'terminada_planificada'
  | 'anulada_planificada';

export const DISCREPANCY_LABEL: Record<DiscrepancyType, string> = {
  inicio: 'Diferencia de inicio',
  fin: 'Diferencia de finalización',
  duracion: 'Diferencia de duración',
  recurso: 'Diferencia de recurso',
  prioridad_modificada: 'Prioridad modificada',
  solo_produccion: 'Solo en producción',
  solo_ortems: 'Solo en Ortems',
  preorden_no_lanzada: 'Preorden no lanzada',
  ambigua: 'Correspondencia ambigua',
  operacion_no_encontrada: 'Operación Ortems no encontrada',
  prioridad_alta_retrasada: 'Prioridad alta retrasada',
  prioridad_invertida: 'Prioridad invertida',
  precedencia_ortems: 'Precedencia incumplida (Ortems)',
  solape_ortems: 'Solapamiento en Ortems',
  multiples_registros: 'Varios registros Ortems',
  saturacion_combinada: 'Saturación combinada',
  terminada_planificada: 'Terminada en producción, planificada en Ortems',
  anulada_planificada: 'Anulada en producción, planificada en Ortems',
};

export interface Discrepancy {
  type: DiscrepancyType;
  criticidad: Criticidad;
  message: string;
}

export type ComparisonLevel = 'operacion' | 'orden' | 'solo_produccion' | 'solo_ortems' | 'ambigua' | 'recurso';

export interface ComparisonRow {
  id: string;
  level: ComparisonLevel;
  aparatoId?: string;
  ordenId?: string;
  preordenId?: string;
  opKey?: string;
  operacionLabel?: string;
  puestoProd?: string;
  puestoOrtems?: string;
  seccion?: string;
  prioridad?: number;
  prioridadRaw?: string;
  prioridadAnteriorRaw?: string;
  highPriority: boolean;
  prodStart?: number;
  prodEnd?: number;
  /** Ejecución real según producción (fichajes). */
  realStart?: number;
  realEnd?: number;
  avance?: number;
  estadoProd?: string;
  ortStart?: number;
  ortEnd?: number;
  /** Desfases producción − Ortems. Positivo = producción más tarde que Ortems. */
  dStartH?: number;
  dEndH?: number;
  dStartWD?: number;
  dEndWD?: number;
  dDurWD?: number;
  discrepancies: Discrepancy[];
  criticidad?: Criticidad;
  coincide: boolean;
  ortemsRids: string[];
  prodRids: string[];
  regla?: string;
}

export interface ComparisonResult {
  rows: ComparisonRow[];
  byOp: Map<string, ComparisonRow>;
  byOrden: Map<string, ComparisonRow[]>;
  byOrtemsRid: Map<string, ComparisonRow>;
  stats: {
    emparejadas: number;
    coincidentes: number;
    conDesviacion: number;
    soloProduccion: number;
    soloOrtems: number;
    ambiguas: number;
  };
}

function minDef(vals: (number | undefined)[]) {
  const v = vals.filter((x): x is number => x !== undefined);
  return v.length ? Math.min(...v) : undefined;
}
function maxDef(vals: (number | undefined)[]) {
  const v = vals.filter((x): x is number => x !== undefined);
  return v.length ? Math.max(...v) : undefined;
}

export function worstCrit(ds: Discrepancy[]): Criticidad | undefined {
  let best: Criticidad | undefined;
  for (const d of ds) if (!best || CRIT_RANK[d.criticidad] > CRIT_RANK[best]) best = d.criticidad;
  return best;
}

export interface CompareInput {
  model: ProductionModel;
  ortems: Map<string, OrtemsRecord>;
  match: MatchResult;
  calendar: CapacityCalendar;
  settings: Settings;
  ortemsPrev?: DatasetVersion;
  ortemsOverlaps: OverlapGroup[];
  /** Fecha de referencia (para valorar si una planificación de Ortems es futura). */
  refMs?: number;
  /** Aparato de producción resuelto para cada registro de Ortems. */
  ortemsAparato?: Map<string, string>;
}

export function compareSources(input: CompareInput): ComparisonResult {
  const { model, ortems, match, calendar, settings } = input;
  const tol = settings.tolerance;
  const beyond = (dH?: number, dWD?: number) =>
    tol.unit === 'horas' ? dH !== undefined && Math.abs(dH) > tol.value : dWD !== undefined && Math.abs(dWD) > tol.value;
  const tolText = tol.unit === 'horas' ? `${fmtNum(tol.value, 1)} h` : `${fmtNum(tol.value)} día(s) laborable(s)`;

  const prevPrio = new Map<string, string | undefined>();
  if (input.ortemsPrev) for (const r of input.ortemsPrev.records as OrtemsRecord[]) if (r.status !== 'rechazado') prevPrio.set(recordKey('ortems', r), r.prioridadRaw);

  const rows: ComparisonRow[] = [];
  const byOp = new Map<string, ComparisonRow>();
  const byOrden = new Map<string, ComparisonRow[]>();
  const byOrtemsRid = new Map<string, ComparisonRow>();
  const push = (row: ComparisonRow) => {
    row.criticidad = worstCrit(row.discrepancies);
    row.coincide = row.level !== 'solo_ortems' && row.level !== 'solo_produccion' && row.level !== 'ambigua' && row.discrepancies.length === 0;
    rows.push(row);
    if (row.opKey) byOp.set(row.opKey, row);
    if (row.ordenId) {
      const l = byOrden.get(row.ordenId) ?? [];
      l.push(row);
      byOrden.set(row.ordenId, l);
    }
    for (const rid of row.ortemsRids) byOrtemsRid.set(rid, row);
  };

  const ortemsInfo = (rids: string[]) => {
    const recs = rids.map((r) => ortems.get(r)!).filter(Boolean);
    const prio = recs.find((r) => r.prioridad !== undefined) ?? recs[0];
    const prevRaw = recs.map((r) => prevPrio.get(recordKey('ortems', r))).find((v) => v !== undefined);
    const hasPrev = recs.some((r) => prevPrio.has(recordKey('ortems', r)));
    return {
      recs,
      ortStart: minDef(recs.map((r) => r.inicio)),
      ortEnd: maxDef(recs.map((r) => r.fin)),
      prioridad: prio?.prioridad,
      prioridadRaw: prio?.prioridadRaw,
      prevRaw: hasPrev ? prevRaw : undefined,
      prioChanged: hasPrev && (prevRaw ?? '') !== (prio?.prioridadRaw ?? ''),
      puesto: recs.find((r) => r.puestoId)?.puestoId,
      preordenId: recs.find((r) => r.preordenId)?.preordenId,
    };
  };

  const compareDates = (row: ComparisonRow) => {
    const ds = row.discrepancies;
    if (row.prodStart !== undefined && row.ortStart !== undefined) {
      row.dStartH = (row.prodStart - row.ortStart) / HOUR;
      row.dStartWD = calendar.workingDaysDiff(row.ortStart, row.prodStart);
    }
    if (row.prodEnd !== undefined && row.ortEnd !== undefined) {
      row.dEndH = (row.prodEnd - row.ortEnd) / HOUR;
      row.dEndWD = calendar.workingDaysDiff(row.ortEnd, row.prodEnd);
    }
    if (row.prodStart !== undefined && row.prodEnd !== undefined && row.ortStart !== undefined && row.ortEnd !== undefined) {
      row.dDurWD = calendar.workingDaysDiff(row.prodStart, row.prodEnd) - calendar.workingDaysDiff(row.ortStart, row.ortEnd);
    }
    const sevFor = (wd?: number): Criticidad => (wd !== undefined && Math.abs(wd) >= settings.highDeviationDays ? 'alta' : 'media');
    const txt = (wd?: number, h?: number) =>
      `${wd !== undefined ? `${Math.abs(wd)} día(s) laborable(s)` : ''}${h !== undefined ? ` (${h > 0 ? '+' : '−'}${fmtNum(Math.abs(h), 1)} h)` : ''}`;
    if (beyond(row.dStartH, row.dStartWD)) {
      ds.push({
        type: 'inicio',
        criticidad: sevFor(row.dStartWD),
        message: `Inicio en producción ${txt(row.dStartWD, row.dStartH)} ${row.dStartH! > 0 ? 'más tarde' : 'antes'} que en Ortems (tolerancia ${tolText}).`,
      });
    }
    if (beyond(row.dEndH, row.dEndWD)) {
      ds.push({
        type: 'fin',
        criticidad: sevFor(row.dEndWD),
        message: `Finalización en producción ${txt(row.dEndWD, row.dEndH)} ${row.dEndH! > 0 ? 'más tarde' : 'antes'} que en Ortems (tolerancia ${tolText}).`,
      });
      if (row.highPriority && row.dEndH! > 0) {
        ds.push({
          type: 'prioridad_alta_retrasada',
          criticidad: 'critica',
          message: `Orden de prioridad alta en Ortems (${row.prioridadRaw}) que producción termina ${txt(row.dEndWD, row.dEndH)} más tarde.`,
        });
      }
    }
    if (row.dDurWD !== undefined && Math.abs(row.dDurWD) > (tol.unit === 'horas' ? Math.max(1, Math.ceil(tol.value / 24)) : tol.value)) {
      ds.push({ type: 'duracion', criticidad: 'informativa', message: `La duración difiere en ${Math.abs(row.dDurWD)} día(s) laborable(s) entre ambas planificaciones.` });
    }
  };

  const refMs = input.refMs ?? Date.now();
  const fmtD = (ms?: number) => (ms === undefined ? '—' : new Date(ms).toLocaleDateString('es-ES'));
  /** Producción da por terminada (o anulada) una orden u operación que Ortems sigue planificando. */
  const stateVsPlan = (row: ComparisonRow, estado: string, what: string) => {
    if (row.ortStart === undefined && row.ortEnd === undefined) return;
    const future = (row.ortEnd ?? row.ortStart!) >= refMs;
    if (estado === 'terminada') {
      row.discrepancies.push({
        type: 'terminada_planificada',
        criticidad: future ? 'alta' : 'media',
        message: `${what} figura terminada en producción${row.realEnd !== undefined ? ` (fin real ${fmtD(row.realEnd)})` : ''}, pero Ortems la planifica del ${fmtD(row.ortStart)} al ${fmtD(row.ortEnd)}${future ? ': reserva capacidad futura para trabajo ya hecho' : ''}.`,
      });
    } else if (estado === 'anulada') {
      row.discrepancies.push({
        type: 'anulada_planificada',
        criticidad: future ? 'alta' : 'media',
        message: `${what} figura anulada en producción, pero Ortems la planifica del ${fmtD(row.ortStart)} al ${fmtD(row.ortEnd)}.`,
      });
    }
  };

  // 1) Emparejamientos a nivel de operación
  for (const [opKey, rids] of match.opMatches) {
    const op = model.ops.get(opKey);
    if (!op) continue;
    const info = ortemsInfo(rids);
    const row: ComparisonRow = {
      id: `cmp:op:${opKey}`,
      level: 'operacion',
      aparatoId: op.aparatoId,
      ordenId: op.ordenId,
      preordenId: op.preordenId ?? info.preordenId,
      opKey,
      operacionLabel: op.label,
      puestoProd: op.puestoId,
      puestoOrtems: info.puesto,
      seccion: op.seccion,
      prioridad: info.prioridad,
      prioridadRaw: info.prioridadRaw,
      prioridadAnteriorRaw: info.prevRaw,
      highPriority: isHighPriority(info.prioridad, settings),
      prodStart: op.start,
      prodEnd: op.end,
      realStart: op.realStart,
      realEnd: op.realEnd,
      avance: op.avance,
      estadoProd: op.estado,
      ortStart: info.ortStart,
      ortEnd: info.ortEnd,
      discrepancies: [],
      coincide: false,
      ortemsRids: rids,
      prodRids: op.rids,
      regla: match.matches.get(rids[0])?.rule.label,
    };
    compareDates(row);
    stateVsPlan(row, op.estado, `La operación ${op.label} de ${op.ordenId}`);
    if (info.puesto && op.puestoId && info.puesto.trim().toUpperCase() !== op.puestoId.trim().toUpperCase()) {
      row.discrepancies.push({ type: 'recurso', criticidad: 'media', message: `Recurso distinto: producción ${op.puestoId}, Ortems ${info.puesto}.` });
    }
    if (rids.length > 1) row.discrepancies.push({ type: 'multiples_registros', criticidad: 'media', message: `${rids.length} registros de Ortems para la misma operación; se comparan agregados (inicio mínimo, fin máximo).` });
    if (info.prioChanged) row.discrepancies.push({ type: 'prioridad_modificada', criticidad: 'informativa', message: `Prioridad Ortems modificada: ${info.prevRaw ?? '(sin prioridad)'} → ${info.prioridadRaw ?? '(sin prioridad)'}.` });
    push(row);
  }

  // 2) Emparejamientos a nivel de orden
  for (const [ordenId, rids] of match.ordenMatches) {
    const o = model.ordenes.get(ordenId);
    if (!o) continue;
    const info = ortemsInfo(rids);
    const opPuestos = new Set(o.opKeys.map((k) => model.ops.get(k)?.puestoId?.toUpperCase()).filter(Boolean));
    const row: ComparisonRow = {
      id: `cmp:ord:${ordenId}`,
      level: 'orden',
      aparatoId: o.aparatoId,
      ordenId,
      preordenId: o.preordenId ?? info.preordenId,
      puestoOrtems: info.puesto,
      seccion: o.opKeys.map((k) => model.ops.get(k)?.seccion).find(Boolean),
      prioridad: info.prioridad,
      prioridadRaw: info.prioridadRaw,
      prioridadAnteriorRaw: info.prevRaw,
      highPriority: isHighPriority(info.prioridad, settings),
      prodStart: o.start,
      prodEnd: o.end,
      realStart: o.realStart,
      realEnd: o.realEnd,
      avance: maxDef(o.opKeys.map((k) => model.ops.get(k)?.avance)),
      estadoProd: o.estado,
      ortStart: info.ortStart,
      ortEnd: info.ortEnd,
      discrepancies: [],
      coincide: false,
      ortemsRids: rids,
      prodRids: o.rids,
      regla: match.matches.get(rids[0])?.rule.label,
    };
    compareDates(row);
    stateVsPlan(row, o.estado, `La ${o.tipo === 'preorden' ? 'preorden' : 'orden'} ${o.id}`);
    if (info.puesto && opPuestos.size && !opPuestos.has(info.puesto.toUpperCase())) {
      row.discrepancies.push({ type: 'recurso', criticidad: 'media', message: `Ortems asigna el recurso ${info.puesto}, que no aparece en ninguna operación de la orden en producción.` });
    }
    const notFound = rids.filter((r) => match.matches.get(r)?.opNotFound);
    if (notFound.length) {
      const opsTxt = notFound.map((r) => ortems.get(r)?.operacionId).filter(Boolean).join(', ');
      row.discrepancies.push({ type: 'operacion_no_encontrada', criticidad: 'media', message: `Ortems planifica operaciones (${opsTxt}) que no existen en producción para esta orden; se compara a nivel de orden.` });
    }
    if (info.prioChanged) row.discrepancies.push({ type: 'prioridad_modificada', criticidad: 'informativa', message: `Prioridad Ortems modificada: ${info.prevRaw ?? '(sin prioridad)'} → ${info.prioridadRaw ?? '(sin prioridad)'}.` });
    push(row);
  }

  // 3) Solo en Ortems
  for (const rid of match.ortemsOnly) {
    const r = ortems.get(rid);
    if (!r) continue;
    const high = isHighPriority(r.prioridad, settings);
    const isPre = !r.ordenId && !!r.preordenId;
    const ds: Discrepancy[] = [];
    if (!model.has.previstas && model.ops.size) {
      // Producción solo contiene ejecución real: es normal que el trabajo futuro planificado aún no tenga fichajes
      ds.push({
        type: 'solo_ortems',
        criticidad: high ? 'alta' : 'informativa',
        message: `${r.preordenId ? `Preorden ${r.preordenId}` : `Orden ${r.ordenId}`} planificada en Ortems sin fichajes en producción${(r.fin ?? r.inicio ?? 0) >= refMs ? ' (trabajo futuro)' : ' aunque su plan ya ha pasado'}.`,
      });
    } else if (isPre) {
      ds.push({
        type: 'preorden_no_lanzada',
        criticidad: high ? 'critica' : 'informativa',
        message: high
          ? `Preorden ${r.preordenId} de prioridad alta (${r.prioridadRaw}) sin orden de fabricación en producción: orden prioritaria pendiente de programación.`
          : `Preorden ${r.preordenId} planificada por Ortems sin orden de fabricación en producción.`,
      });
    } else {
      ds.push({
        type: 'solo_ortems',
        criticidad: high ? 'critica' : 'media',
        message: high
          ? `La orden ${r.ordenId} tiene prioridad alta en Ortems (${r.prioridadRaw}) pero no aparece en producción: orden prioritaria pendiente de programación.`
          : `La orden ${r.ordenId ?? r.preordenId} aparece en Ortems pero no en producción.`,
      });
    }
    push({
      id: `cmp:ort:${rid}`,
      level: 'solo_ortems',
      aparatoId: input.ortemsAparato?.get(rid) ?? r.aparatoId,
      ordenId: r.ordenId,
      preordenId: r.preordenId,
      operacionLabel: r.operacionId,
      puestoOrtems: r.puestoId,
      prioridad: r.prioridad,
      prioridadRaw: r.prioridadRaw,
      highPriority: high,
      ortStart: r.inicio,
      ortEnd: r.fin,
      discrepancies: ds,
      coincide: false,
      ortemsRids: [rid],
      prodRids: [],
    });
  }

  // 4) Ambiguas
  for (const a of match.ambiguous) {
    const r = ortems.get(a.rid);
    if (!r) continue;
    push({
      id: `cmp:amb:${a.rid}`,
      level: 'ambigua',
      aparatoId: input.ortemsAparato?.get(a.rid) ?? r.aparatoId,
      ordenId: r.ordenId,
      preordenId: r.preordenId,
      operacionLabel: r.operacionId,
      puestoOrtems: r.puestoId,
      prioridad: r.prioridad,
      prioridadRaw: r.prioridadRaw,
      highPriority: isHighPriority(r.prioridad, settings),
      ortStart: r.inicio,
      ortEnd: r.fin,
      discrepancies: [
        {
          type: 'ambigua',
          criticidad: 'media',
          message: `La regla «${a.rule.label}» encuentra ${a.candidates.length} candidatos en producción (${a.candidates.slice(0, 5).join(', ')}${a.candidates.length > 5 ? '…' : ''}). No se empareja automáticamente: requiere validación.`,
        },
      ],
      coincide: false,
      ortemsRids: [a.rid],
      prodRids: [],
      regla: a.rule.label,
    });
  }

  // 5) Solo en producción
  for (const ordenId of match.prodOnlyOrdenes) {
    const o = model.ordenes.get(ordenId)!;
    const done = o.estado === 'terminada';
    push({
      id: `cmp:prod:${ordenId}`,
      level: 'solo_produccion',
      aparatoId: o.aparatoId,
      ordenId,
      preordenId: o.preordenId,
      seccion: o.opKeys.map((k) => model.ops.get(k)?.seccion).find(Boolean),
      highPriority: false,
      prodStart: o.start,
      prodEnd: o.end,
      realStart: o.realStart,
      realEnd: o.realEnd,
      estadoProd: o.estado,
      discrepancies: [
        {
          type: 'solo_produccion',
          criticidad: done || o.estado === 'anulada' ? 'informativa' : 'media',
          message: done
            ? `La ${o.tipo === 'preorden' ? 'preorden' : 'orden'} ${ordenId} está terminada y Ortems ya no la planifica.`
            : o.estado === 'anulada'
              ? `La ${o.tipo === 'preorden' ? 'preorden' : 'orden'} ${ordenId} está anulada; Ortems no la planifica.`
              : `La ${o.tipo === 'preorden' ? 'preorden' : 'orden'} ${ordenId} está en producción${o.estado === 'en_curso' ? ' (en curso)' : ''} pero Ortems no la planifica.`,
        },
      ],
      coincide: false,
      ortemsRids: [],
      prodRids: o.rids,
    });
  }
  for (const opKey of match.prodOnlyOps) {
    const op = model.ops.get(opKey)!;
    const done = op.estado === 'terminada' || op.realEnd !== undefined;
    push({
      id: `cmp:prodop:${opKey}`,
      level: 'solo_produccion',
      aparatoId: op.aparatoId,
      ordenId: op.ordenId,
      opKey,
      operacionLabel: op.label,
      puestoProd: op.puestoId,
      seccion: op.seccion,
      highPriority: false,
      prodStart: op.start,
      prodEnd: op.end,
      discrepancies: [
        {
          type: 'solo_produccion',
          criticidad: done ? 'informativa' : 'media',
          message: done
            ? `La operación ${op.label} de la orden ${op.ordenId} está terminada; Ortems ya no la planifica.`
            : `La operación ${op.label} de la orden ${op.ordenId} no tiene planificación en Ortems (Ortems planifica otras operaciones de la orden).`,
        },
      ],
      coincide: false,
      ortemsRids: [],
      prodRids: op.rids,
    });
  }

  // 6) Prioridad invertida: en un mismo puesto, Ortems da más prioridad y la programa antes,
  //    pero producción la programa detrás de una de menor prioridad.
  const byPuesto = new Map<string, ComparisonRow[]>();
  for (const row of rows) {
    if (row.level !== 'operacion' || !row.puestoProd || row.prodStart === undefined || row.ortStart === undefined || row.prioridad === undefined) continue;
    const l = byPuesto.get(row.puestoProd) ?? [];
    l.push(row);
    byPuesto.set(row.puestoProd, l);
  }
  // Ventana deslizante: solo se comparan operaciones próximas en la cola del mismo puesto.
  const WINDOW = INVERSION_WINDOW_DAYS * 24 * HOUR;
  for (const [puesto, list] of byPuesto) {
    list.sort((a, b) => a.prodStart! - b.prodStart!);
    for (let j = 1; j < list.length; j++) {
      const rj = list[j];
      const rankJ = priorityRank(rj.prioridad, settings)!;
      for (let i = j - 1; i >= 0 && list[i].prodStart! >= rj.prodStart! - WINDOW; i--) {
        const ri = list[i];
        if (ri.ordenId === rj.ordenId) continue;
        const rankI = priorityRank(ri.prioridad, settings)!;
        if (rankJ < rankI && rj.ortStart! < ri.ortStart! && rj.prodStart! > ri.prodStart!) {
          rj.discrepancies.push({
            type: 'prioridad_invertida',
            criticidad: rj.highPriority ? 'alta' : 'media',
            message: `En ${puesto}, la orden ${rj.ordenId} (prioridad ${rj.prioridadRaw}) está programada en producción detrás de la orden ${ri.ordenId} (prioridad ${ri.prioridadRaw}), al contrario que en Ortems.`,
          });
          rj.criticidad = worstCrit(rj.discrepancies);
          rj.coincide = false;
          break;
        }
      }
    }
  }

  // 7) Precedencias incumplidas en la planificación de Ortems
  for (const op of model.ops.values()) {
    const row = byOp.get(op.key);
    if (!row || row.ortStart === undefined) continue;
    for (const dep of op.preds) {
      if (!dep.from) continue;
      const prow = byOp.get(dep.from);
      if (!prow || prow.ortEnd === undefined) continue;
      if (row.ortStart < prow.ortEnd) {
        row.discrepancies.push({
          type: 'precedencia_ortems',
          criticidad: dep.tipo === 'confirmada' ? 'alta' : 'media',
          message: `Ortems inicia ${op.label} antes de que termine su precedente ${model.ops.get(dep.from)?.label} (orden ${model.ops.get(dep.from)?.ordenId})${dep.tipo === 'inferida' ? ' — dependencia inferida, no confirmada' : ''}.`,
        });
        row.criticidad = worstCrit(row.discrepancies);
        row.coincide = false;
      }
    }
  }

  // 7b) Precedencias del árbol (hijo → padre) en la planificación de Ortems, a nivel de orden/preorden:
  //     el padre (siguiente) no puede empezar antes de que termine el hijo.
  const norm = (x?: string) => (x === undefined ? undefined : idKey(x, { caseInsensitive: settings.matching.caseInsensitive, stripLeadingZeros: settings.matching.stripLeadingZeros }));
  const ortByNode = new Map<string, OrtemsRecord[]>();
  for (const r of ortems.values()) {
    for (const id of new Set([norm(r.preordenId), norm(r.ordenId)])) {
      if (!id) continue;
      const l = ortByNode.get(id) ?? [];
      l.push(r);
      ortByNode.set(id, l);
    }
  }
  const nodeOrt = (id: string, o?: { ordenId?: string; preordenId?: string }) => {
    const keys = new Set([norm(id), norm(o?.ordenId), norm(o?.preordenId)]);
    const out = new Map<string, OrtemsRecord>();
    for (const k of keys) if (k) for (const r of ortByNode.get(k) ?? []) out.set(r.rid, r);
    return [...out.values()];
  };
  for (const child of model.ordenes.values()) {
    if (!child.parentId || child.estado === 'terminada' || child.estado === 'anulada') continue;
    const cr = nodeOrt(child.id, child);
    const childEnd = maxDef(cr.map((r) => r.fin));
    if (childEnd === undefined) continue;
    const parent = model.ordenes.get(child.parentId);
    const pr = nodeOrt(child.parentId, parent);
    const parentStart = minDef(pr.map((r) => r.inicio));
    if (parentStart === undefined || parentStart >= childEnd) continue;
    const row = pr.map((r) => byOrtemsRid.get(r.rid)).find(Boolean);
    if (!row || row.discrepancies.some((d) => d.type === 'precedencia_ortems' && d.message.includes(child.id))) continue;
    row.discrepancies.push({
      type: 'precedencia_ortems',
      criticidad: child.parentLink === 'confirmada' ? 'alta' : 'media',
      message: `Ortems inicia ${nodeName(parent, child.parentId).toLowerCase()} el ${fmtD(parentStart)}, antes de que termine ${nodeName(child).toLowerCase()} que la precede en el árbol (fin Ortems ${fmtD(childEnd)})${child.parentLink === 'confirmada' ? '' : ' — relación no confirmada'}.`,
    });
    row.criticidad = worstCrit(row.discrepancies);
    row.coincide = false;
  }

  // 8) Solapamientos en Ortems
  for (const g of input.ortemsOverlaps) {
    if (g.clase === 'solape_dentro_capacidad') continue;
    for (const rid of g.ids) {
      const row = byOrtemsRid.get(rid);
      if (!row || row.discrepancies.some((d) => d.type === 'solape_ortems')) continue;
      row.discrepancies.push({
        type: 'solape_ortems',
        // sin capacidad paralela configurada el solape solo es potencial (un puesto puede tener varias máquinas u operarios)
        criticidad: g.clase === 'sobrecarga_confirmada' ? 'alta' : g.clase === 'solape_potencial' ? 'informativa' : 'media',
        message: `${OVERLAP_LABEL[g.clase]}: Ortems programa ${g.maxConcurrency} trabajos a la vez en ${g.puestoId}${g.units ? ` (capacidad ${g.units} ${g.unitsSource === 'supuesta' ? 'supuesta' : 'configurada'})` : ' (capacidad paralela desconocida)'}.`,
      });
      row.criticidad = worstCrit(row.discrepancies);
      row.coincide = false;
    }
  }

  const stats = {
    emparejadas: rows.filter((r) => r.level === 'operacion' || r.level === 'orden').length,
    coincidentes: rows.filter((r) => r.coincide).length,
    conDesviacion: rows.filter((r) => (r.level === 'operacion' || r.level === 'orden') && !r.coincide).length,
    soloProduccion: rows.filter((r) => r.level === 'solo_produccion').length,
    soloOrtems: rows.filter((r) => r.level === 'solo_ortems').length,
    ambiguas: rows.filter((r) => r.level === 'ambigua').length,
  };
  return { rows, byOp, byOrden, byOrtemsRid, stats };
}

export function reviewIdFor(row: ComparisonRow): string {
  return `cmp_${stableHash(row.id)}`;
}

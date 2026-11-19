import { referenceMs, type Settings } from '../domain/settings';
import type { DatasetVersion, ManualRelation, OrtemsRecord } from '../domain/types';
import { addDays, startOfDay, weekKey } from '../lib/dates';
import { fmtHours, fmtNum } from '../lib/format';
import { buildAlerts, type Alert } from './alerts';
import { computeBottlenecks, type BottleneckResult } from './bottlenecks';
import { CapacityCalendar } from './calendar';
import { compareSources, worstCrit, type ComparisonResult, type ComparisonRow } from './comparison';
import { computeLoad, type LoadItem, type LoadResult } from './load';
import { matchSources, type MatchResult } from './matching';
import { buildProductionModel, type Operacion, type ProductionModel } from './model';
import { detectOverlaps, worstOverlapById, type OverlapGroup } from './overlaps';

export interface OpFlags {
  /** Fin previsto anterior a la fecha de referencia sin constancia de que esté terminada. */
  vencida?: 'confirmada' | 'posible';
  retrasoReal?: boolean;
  fueraObjetivo?: boolean;
  retrasoOrtems?: boolean;
  adelantoOrtems?: boolean;
  desviacionOrtems?: boolean;
  sinOrtems?: boolean;
  solape?: OverlapGroup;
  saturado?: 'confirmado' | 'estimado';
  precedencia?: { tipo: 'confirmada' | 'inferida'; predKey: string };
  pendienteValidacion?: string;
  sinInfo: string[];
  durEstimada?: boolean;
  /** Horas usadas en la carga (dato o estimación). */
  hours?: number;
}

export function isRetrasada(f: OpFlags | undefined): boolean {
  return !!f && (!!f.vencida || !!f.retrasoReal || !!f.fueraObjetivo || !!f.retrasoOrtems);
}
export function isAdelantada(f: OpFlags | undefined): boolean {
  return !!f && !!f.adelantoOrtems;
}

export interface AnalysisInput {
  prod?: DatasetVersion;
  ortems?: DatasetVersion;
  ortemsPrev?: DatasetVersion;
  settings: Settings;
  manual: ManualRelation[];
  now?: number;
}

export interface Analysis {
  settings: Settings;
  refMs: number;
  calendar: CapacityCalendar;
  model: ProductionModel;
  ortems: Map<string, OrtemsRecord>;
  ortemsList: OrtemsRecord[];
  match: MatchResult;
  comparison: ComparisonResult;
  load: { produccion: LoadResult; ortems: LoadResult; combinada: LoadResult };
  overlaps: { produccion: OverlapGroup[]; ortems: OverlapGroup[] };
  overlapByOp: Map<string, OverlapGroup>;
  overlapByOrtems: Map<string, OverlapGroup>;
  opFlags: Map<string, OpFlags>;
  bottlenecks: BottleneckResult;
  bottlenecksCombined: BottleneckResult;
  alerts: Alert[];
  timings: Record<string, number>;
}

export function runAnalysis(input: AnalysisInput): Analysis {
  const t0 = performance.now();
  const timings: Record<string, number> = {};
  const lap = (k: string, from: number) => (timings[k] = Math.round(performance.now() - from));
  const { settings } = input;
  const refMs = referenceMs(settings, input.now);
  const calendar = new CapacityCalendar(settings);

  let t = performance.now();
  const model = buildProductionModel(input.prod, settings, input.manual);
  lap('modelo', t);

  const ortemsList = ((input.ortems?.records ?? []) as OrtemsRecord[]).filter((r) => r.status !== 'rechazado');
  const ortems = new Map(ortemsList.map((r) => [r.rid, r]));

  t = performance.now();
  const match = matchSources(model, ortemsList, settings);
  lap('emparejamiento', t);

  // Elementos de carga
  t = performance.now();
  const opFlags = new Map<string, OpFlags>();
  const prodItems: LoadItem[] = [];
  for (const op of model.ops.values()) {
    const flags: OpFlags = { sinInfo: [] };
    opFlags.set(op.key, flags);
    let hours = op.durationH;
    let estimated = false;
    if (hours === undefined && settings.load.estimateDurationFromDates && op.start !== undefined && op.end !== undefined) {
      hours = calendar.estimateHoursFromDates(op.puestoId, op.start, op.end);
      estimated = true;
      flags.durEstimada = true;
    }
    flags.hours = hours;
    if (!op.puestoId) flags.sinInfo.push('sin puesto');
    if (op.start === undefined || op.end === undefined) flags.sinInfo.push('sin fechas');
    if (op.durationH === undefined) flags.sinInfo.push(estimated ? 'duración estimada' : 'sin duración');
    prodItems.push({ id: op.key, puestoId: op.puestoId, seccion: op.seccion, ordenId: op.ordenId, start: op.start, end: op.end, hours, estimated, source: 'produccion' });
  }
  const ortItems: LoadItem[] = [];
  for (const r of ortemsList) {
    if (!r.puestoId && !(match.matches.get(r.rid)?.level === 'operacion')) continue;
    const m = match.matches.get(r.rid);
    const op = m?.level === 'operacion' ? model.ops.get(m.target) : undefined;
    const puestoId = r.puestoId ?? op?.puestoId;
    let hours = r.duracionH ?? op?.durationH;
    let estimated = r.duracionH === undefined && op?.durationH === undefined;
    if (hours === undefined && settings.load.estimateDurationFromDates && r.inicio !== undefined && r.fin !== undefined) {
      hours = calendar.estimateHoursFromDates(puestoId, r.inicio, r.fin);
      estimated = true;
    }
    ortItems.push({ id: r.rid, puestoId, ordenId: r.ordenId, start: r.inicio, end: r.fin, hours, estimated, source: 'ortems' });
  }
  const onlyOrtems = new Set(match.ortemsOnly);
  const combinedItems = [...prodItems, ...ortItems.filter((i) => onlyOrtems.has(i.id))];
  const puestoSeccion = new Map([...model.puestos.values()].map((p) => [p.id, p.seccion]));
  const load = {
    produccion: computeLoad(prodItems, calendar, 'produccion', puestoSeccion),
    ortems: computeLoad(ortItems, calendar, 'ortems', puestoSeccion),
    combinada: computeLoad(combinedItems, calendar, 'combinada', puestoSeccion),
  };
  lap('carga', t);

  t = performance.now();
  const prodOverlaps = detectOverlaps(
    [...model.ops.values()].filter((o) => o.puestoId && o.start !== undefined && o.end !== undefined).map((o) => ({ id: o.key, puestoId: o.puestoId!, start: o.start!, end: o.end! })),
    calendar,
    'produccion',
  );
  const ortOverlaps = detectOverlaps(
    ortItems.filter((i) => i.puestoId && i.start !== undefined && i.end !== undefined).map((i) => ({ id: i.id, puestoId: i.puestoId!, start: i.start!, end: i.end! })),
    calendar,
    'ortems',
  );
  const overlapByOp = worstOverlapById(prodOverlaps);
  const overlapByOrtems = worstOverlapById(ortOverlaps);
  lap('solapes', t);

  t = performance.now();
  const comparison = compareSources({ model, ortems, match, calendar, settings, ortemsPrev: input.ortemsPrev, ortemsOverlaps: ortOverlaps });
  addCombinedSaturation(comparison, load, refMs);
  lap('comparacion', t);

  t = performance.now();
  const bottlenecks = computeBottlenecks(load.produccion, prodOverlaps, settings, refMs, model);
  const bottlenecksCombined = computeBottlenecks(load.combinada, prodOverlaps, settings, refMs, model);
  lap('cuellos', t);

  // Indicadores por operación
  t = performance.now();
  computeFlags(model, opFlags, comparison, overlapByOp, bottlenecks, settings, refMs, calendar);
  lap('indicadores', t);

  t = performance.now();
  const partial: Omit<Analysis, 'alerts' | 'timings'> = {
    settings,
    refMs,
    calendar,
    model,
    ortems,
    ortemsList,
    match,
    comparison,
    load,
    overlaps: { produccion: prodOverlaps, ortems: ortOverlaps },
    overlapByOp,
    overlapByOrtems,
    opFlags,
    bottlenecks,
    bottlenecksCombined,
  };
  const alerts = buildAlerts(partial);
  lap('alertas', t);
  timings.total = Math.round(performance.now() - t0);
  return { ...partial, alerts, timings };
}

function computeFlags(
  model: ProductionModel,
  opFlags: Map<string, OpFlags>,
  comparison: ComparisonResult,
  overlapByOp: Map<string, OverlapGroup>,
  bottlenecks: BottleneckResult,
  settings: Settings,
  refMs: number,
  calendar: CapacityCalendar,
) {
  const estadoMapped = [...model.ops.values()].some((o) => o.estadoRaw !== undefined);
  const tolH = settings.tolerance.unit === 'horas' ? settings.tolerance.value : undefined;
  for (const op of model.ops.values()) {
    const f = opFlags.get(op.key)!;
    // Vencida: fin previsto pasado y sin evidencia de terminación
    if (op.end !== undefined && op.end < refMs && op.realEnd === undefined && op.estado !== 'terminada') {
      f.vencida = estadoMapped && op.estado !== 'desconocido' ? 'confirmada' : 'posible';
    }
    if (op.realEnd !== undefined && op.end !== undefined) {
      const late = tolH !== undefined ? (op.realEnd - op.end) / 3_600_000 > tolH : calendar.workingDaysDiff(op.end, op.realEnd) > settings.tolerance.value;
      if (late) f.retrasoReal = true;
    }
    if (op.target !== undefined && op.end !== undefined && op.end > op.target) f.fueraObjetivo = true;
    const order = model.ordenes.get(op.ordenId);
    if (order?.target !== undefined && op.end !== undefined && op.end > order.target) f.fueraObjetivo = true;
    const row = comparison.byOp.get(op.key) ?? comparison.byOrden.get(op.ordenId)?.find((r) => r.level === 'orden');
    if (row) {
      const fin = row.discrepancies.find((d) => d.type === 'fin');
      const ini = row.discrepancies.find((d) => d.type === 'inicio');
      if (fin && (row.dEndH ?? 0) > 0) f.retrasoOrtems = true;
      if (ini && (row.dStartH ?? 0) < 0) f.adelantoOrtems = true;
      if (row.level === 'operacion' || row.level === 'orden') f.desviacionOrtems = !row.coincide;
      if (row.level === 'solo_produccion') f.sinOrtems = true;
    }
    const ov = overlapByOp.get(op.key);
    if (ov) f.solape = ov;
    if (op.puestoId && op.start !== undefined && op.end !== undefined) {
      let d = startOfDay(op.start);
      let guard = 0;
      while (d <= op.end && guard < 400) {
        const sat = bottlenecks.saturatedWeeks.get(`${op.puestoId}|${weekKey(d)}`);
        if (sat && sat.ids.includes(op.key)) {
          f.saturado = sat.confianza === 'confirmado' ? 'confirmado' : f.saturado ?? 'estimado';
          if (f.saturado === 'confirmado') break;
        }
        d = addDays(d, 7);
        guard++;
      }
    }
    // Precedencia incumplida en la planificación de producción
    for (const dep of op.preds) {
      if (!dep.from || op.start === undefined) continue;
      const pred = model.ops.get(dep.from);
      if (pred?.end !== undefined && op.start < pred.end && dep.tipo !== 'pendiente') {
        if (!f.precedencia || (f.precedencia.tipo === 'inferida' && dep.tipo === 'confirmada')) f.precedencia = { tipo: dep.tipo, predKey: dep.from };
      }
    }
    const pend: string[] = [];
    if (order && (order.aparatoLink === 'pendiente' || order.aparatoLink === 'sin_aparato')) pend.push('orden sin aparato confirmado');
    if (order?.parentLink === 'pendiente') pend.push('relación con orden padre pendiente');
    if (op.preds.some((d) => d.tipo === 'pendiente')) pend.push('dependencia sin resolver');
    if (pend.length) f.pendienteValidacion = pend.join('; ');
  }
}

/** Recursos que solo se saturan al sumar la carga de órdenes/preórdenes que solo están en Ortems. */
function addCombinedSaturation(comparison: ComparisonResult, load: Analysis['load'], refMs: number) {
  const refDay = startOfDay(refMs);
  for (const [puesto, comb] of load.combinada.puestos) {
    const prod = load.produccion.puestos.get(puesto);
    for (const c of comb.buckets.semana.values()) {
      if (c.occupancy === undefined || c.occupancy <= 1 + 1e-9 || c.start < addDays(refDay, -7)) continue;
      const prodOcc = prod?.buckets.semana.get(c.key)?.occupancy ?? 0;
      if (prodOcc > 1 + 1e-9) continue;
      const row: ComparisonRow = {
        id: `cmp:sat:${puesto}:${c.key}`,
        level: 'recurso',
        puestoProd: puesto,
        seccion: comb.seccion,
        highPriority: false,
        discrepancies: [
          {
            type: 'saturacion_combinada',
            criticidad: comb.capSource === 'conocida' ? 'alta' : 'media',
            message: `El puesto ${puesto} queda saturado (${fmtNum(c.occupancy * 100)} %) en la semana ${c.key.replace('-S', ' S')} al sumar a producción la carga de órdenes/preórdenes que solo están en Ortems (carga ${fmtHours(c.loadH)} / capacidad ${fmtHours(c.capacityH)}; solo producción: ${fmtNum(prodOcc * 100)} %)${comb.capSource === 'conocida' ? '' : ' — estimado'}.`,
          },
        ],
        coincide: false,
        ortemsRids: c.ids.filter((id) => !id.includes('|')),
        prodRids: [],
      };
      row.criticidad = worstCrit(row.discrepancies);
      comparison.rows.push(row);
    }
  }
}

/**
 * Reconstruye un análisis recibido por clonado estructurado (p. ej. desde un Web Worker):
 * el calendario es una clase con métodos y se vuelve a crear a partir de la configuración.
 */
export function rehydrateAnalysis(a: Omit<Analysis, 'calendar'>): Analysis {
  return { ...a, calendar: new CapacityCalendar(a.settings) };
}

export function opsOfAparato(model: ProductionModel, aparatoId: string): Operacion[] {
  const a = model.aparatos.get(aparatoId);
  if (!a) return [];
  return a.ordenIds.flatMap((id) => model.ordenes.get(id)?.opKeys.map((k) => model.ops.get(k)!) ?? []);
}

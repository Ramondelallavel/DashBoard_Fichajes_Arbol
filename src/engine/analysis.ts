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
import { buildProductionModel, opSpan, type Operacion, type ProductionModel } from './model';
import { demonstratedCapacity } from './demonstrated';
import { idKey } from '../lib/text';
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
  /** Cuellos de botella sobre la planificación base (ver loadBase). */
  bottlenecks: BottleneckResult;
  bottlenecksCombined: BottleneckResult;
  bottlenecksBy: Record<'produccion' | 'ortems' | 'combinada', BottleneckResult>;
  /** Planificación usada para el análisis futuro (resuelta si la configuración es «auto»). */
  loadBase: 'produccion' | 'ortems' | 'combinada';
  loadBaseReason: string;
  /** Carga ejecutada según fechas reales (fichajes) y capacidad demostrada por sección. */
  loadReal: LoadResult;
  /** Elementos de carga calculados (para recalcular la carga con los filtros activos). */
  loadItems: { produccion: LoadItem[]; ortems: LoadItem[] };
  puestoSeccion: Map<string, string | undefined>;
  demonstrated: ReturnType<typeof demonstratedCapacity>;
  /** Aparato de producción al que corresponde cada registro de Ortems (si se ha podido resolver). */
  ortemsAparato: Map<string, string>;
  aparatoCheck: { comparados: number; coincidentes: number; regla: Settings['matching']['aparatoKey'] };
  alerts: Alert[];
  timings: Record<string, number>;
}

/** Clave de comparación de un número de aparato entre fuentes (el original no se modifica). */
export function aparatoMatchKey(id: string | undefined, mode: Settings['matching']['aparatoKey']): string | undefined {
  if (!id) return undefined;
  const t = id.trim().toUpperCase();
  if (!t) return undefined;
  if (mode === 'exacto') return t;
  if (mode === 'sin_ceros') return t.replace(/^0+(?=.)/, '');
  const digits = t.replace(/\D/g, '').replace(/^0+(?=.)/, '');
  return digits || t;
}

export function runAnalysis(input: AnalysisInput): Analysis {
  const t0 = performance.now();
  const timings: Record<string, number> = {};
  const lap = (k: string, from: number) => (timings[k] = Math.round(performance.now() - from));
  const { settings } = input;
  const refMs = referenceMs(settings, input.now);
  const calendar = new CapacityCalendar(settings);

  const ortemsList = ((input.ortems?.records ?? []) as OrtemsRecord[]).filter((r) => r.status !== 'rechazado');
  const ortems = new Map(ortemsList.map((r) => [r.rid, r]));
  // Identificadores planificados en Ortems: permiten reconocer relaciones del árbol cuyo padre aún no está en producción
  const norm = (x?: string) => (x === undefined ? undefined : idKey(x, { caseInsensitive: settings.matching.caseInsensitive, stripLeadingZeros: settings.matching.stripLeadingZeros }));
  const ortemsIds = new Set<string>();
  for (const r of ortemsList) {
    const a = norm(r.preordenId);
    const b = norm(r.ordenId);
    if (a) ortemsIds.add(a);
    if (b) ortemsIds.add(b);
  }

  let t = performance.now();
  const model = buildProductionModel(input.prod, settings, input.manual, { has: (id) => ortemsIds.has(norm(id) ?? ''), source: 'Ortems' });
  lap('modelo', t);

  t = performance.now();
  const match = matchSources(model, ortemsList, settings);
  lap('emparejamiento', t);

  // Aparato de cada registro de Ortems: primero por la correspondencia (orden/preorden emparejada), después por la clave
  const apByKey = new Map<string, string | null>();
  for (const id of model.aparatos.keys()) {
    const k = aparatoMatchKey(id, settings.matching.aparatoKey);
    if (!k) continue;
    apByKey.set(k, apByKey.has(k) && apByKey.get(k) !== id ? null : id);
  }
  const ortemsAparato = new Map<string, string>();
  const aparatoCheck = { comparados: 0, coincidentes: 0, regla: settings.matching.aparatoKey };
  for (const r of ortemsList) {
    const m = match.matches.get(r.rid);
    const prodAp = m ? (m.level === 'operacion' ? model.ops.get(m.target)?.aparatoId : model.ordenes.get(m.target)?.aparatoId) : undefined;
    const byKey = apByKey.get(aparatoMatchKey(r.aparatoId, settings.matching.aparatoKey) ?? '') ?? undefined;
    if (prodAp && r.aparatoId) {
      aparatoCheck.comparados++;
      if (byKey === prodAp) aparatoCheck.coincidentes++;
    }
    const resolved = prodAp ?? byKey;
    if (resolved) ortemsAparato.set(r.rid, resolved);
  }

  // Elementos de carga
  t = performance.now();
  const opFlags = new Map<string, OpFlags>();
  const prodItems: LoadItem[] = [];
  for (const op of model.ops.values()) {
    const flags: OpFlags = { sinInfo: [] };
    opFlags.set(op.key, flags);
    const span = opSpan(op);
    let hours = op.durationH;
    let estimated = false;
    if (hours === undefined && settings.load.estimateDurationFromDates && span) {
      hours = calendar.estimateHoursFromDates(op.puestoId, span.start, span.end);
      estimated = true;
      flags.durEstimada = true;
    }
    flags.hours = hours;
    if (!op.puestoId && model.has.puestos) flags.sinInfo.push('sin puesto');
    if (!span) flags.sinInfo.push('sin fechas');
    if (op.durationH === undefined && model.has.duracion) flags.sinInfo.push(estimated ? 'duración estimada' : 'sin duración');
    if (op.estado === 'anulada') continue; // las anuladas no cargan a ningún recurso
    prodItems.push({ id: op.key, puestoId: op.puestoId, seccion: op.seccion, ordenId: op.ordenId, start: span?.start, end: span?.end, hours, estimated, real: span?.real, source: 'produccion' });
  }
  const ortItems: LoadItem[] = [];
  for (const r of ortemsList) {
    if (!r.puestoId && !r.seccion && !(match.matches.get(r.rid)?.level === 'operacion')) continue;
    const m = match.matches.get(r.rid);
    const op = m?.level === 'operacion' ? model.ops.get(m.target) : undefined;
    // Una preorden ya terminada según producción no debería cargar el plan de Ortems: se avisa (comparador)
    // pero se mantiene en la carga de Ortems tal como Ortems la planifica.
    const puestoId = r.puestoId ?? op?.puestoId;
    let hours = r.duracionH ?? op?.durationH;
    let estimated = r.duracionH === undefined && op?.durationH === undefined;
    if (hours === undefined && settings.load.estimateDurationFromDates && r.inicio !== undefined && r.fin !== undefined) {
      hours = calendar.estimateHoursFromDates(puestoId, r.inicio, r.fin);
      estimated = true;
    }
    ortItems.push({ id: r.rid, puestoId, seccion: r.seccion ?? (puestoId ? model.puestos.get(puestoId)?.seccion : undefined), ordenId: r.ordenId, start: r.inicio, end: r.fin, hours, estimated, source: 'ortems' });
  }
  const onlyOrtems = new Set(match.ortemsOnly);
  // En la carga combinada no se suma la ejecución real pasada: producción planificada + lo que solo está en Ortems
  const combinedItems = [...prodItems.filter((i) => !i.real), ...ortItems.filter((i) => onlyOrtems.has(i.id))];
  const puestoSeccion = new Map<string, string | undefined>([...model.puestos.values()].map((p) => [p.id, p.seccion]));
  for (const r of ortemsList) if (r.puestoId && r.seccion && !puestoSeccion.get(r.puestoId)) puestoSeccion.set(r.puestoId, r.seccion);
  const load = {
    produccion: computeLoad(prodItems, calendar, 'produccion', puestoSeccion),
    ortems: computeLoad(ortItems, calendar, 'ortems', puestoSeccion),
    combinada: computeLoad(combinedItems, calendar, 'combinada', puestoSeccion),
  };
  const loadReal = computeLoad(prodItems.filter((i) => i.real), calendar, 'produccion', puestoSeccion);
  lap('carga', t);

  // Base del análisis futuro
  const futurePlanned = prodItems.some((i) => !i.real && i.end !== undefined && i.end >= refMs);
  let loadBase: Analysis['loadBase'];
  let loadBaseReason: string;
  if (settings.load.base !== 'auto') {
    loadBase = settings.load.base;
    loadBaseReason = 'Elegida en Configuración.';
  } else if (futurePlanned) {
    loadBase = 'produccion';
    loadBaseReason = 'Automática: el Excel de producción tiene fechas previstas futuras.';
  } else if (ortemsList.length) {
    loadBase = 'ortems';
    loadBaseReason = model.has.reales
      ? 'Automática: el Excel de producción solo contiene ejecución real (fichajes); el plan futuro es el de Ortems.'
      : 'Automática: el Excel de producción no tiene fechas previstas futuras; se usa el plan de Ortems.';
  } else {
    loadBase = 'produccion';
    loadBaseReason = 'Automática: no hay datos de Ortems.';
  }

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
  const comparison = compareSources({ model, ortems, match, calendar, settings, ortemsPrev: input.ortemsPrev, ortemsOverlaps: ortOverlaps, refMs, ortemsAparato });
  addCombinedSaturation(comparison, load, refMs);
  lap('comparacion', t);

  t = performance.now();
  const apOrt = new Map<string, Set<string>>();
  for (const r of ortemsList) {
    const ap = ortemsAparato.get(r.rid) ?? r.aparatoId;
    if (!r.puestoId || !ap) continue;
    const st = apOrt.get(r.puestoId) ?? new Set<string>();
    st.add(ap);
    apOrt.set(r.puestoId, st);
  }
  const bottlenecksBy = {
    produccion: computeBottlenecks(load.produccion, prodOverlaps, settings, refMs, model),
    ortems: computeBottlenecks(load.ortems, ortOverlaps, settings, refMs, model, apOrt),
    combinada: computeBottlenecks(load.combinada, prodOverlaps, settings, refMs, model),
  };
  const bottlenecks = bottlenecksBy[loadBase];
  const bottlenecksCombined = bottlenecksBy.combinada;
  const demonstrated = demonstratedCapacity(loadReal, load[loadBase === 'produccion' && !futurePlanned ? 'ortems' : loadBase], refMs, settings.load.demonstratedWeeks, settings.horizonWeeks, loadBase === 'produccion' && futurePlanned ? 'la planificación de producción' : 'Ortems');
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
    bottlenecksBy,
    loadBase,
    loadBaseReason,
    loadReal,
    loadItems: { produccion: prodItems, ortems: ortItems },
    puestoSeccion,
    demonstrated,
    ortemsAparato,
    aparatoCheck,
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

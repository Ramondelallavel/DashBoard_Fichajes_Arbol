import type { Settings } from '../domain/settings';
import { addDays, startOfDay, weekLabel } from '../lib/dates';
import { fmtHours, fmtNum } from '../lib/format';
import type { Granularity, LoadCell, LoadResult, ResourceLoad } from './load';
import type { ProductionModel } from './model';
import { OVERLAP_LABEL, type OverlapGroup } from './overlaps';

/**
 * Grado de certeza de un hallazgo:
 * - confirmado: capacidad real configurada y carga por encima de ella.
 * - estimado: capacidad supuesta (no configurada) o capacidad parcial de la sección, o carga con duraciones estimadas.
 * - sin_capacidad: no hay capacidad: solo se informa de la carga, sin afirmar saturación.
 */
export type Confianza = 'confirmado' | 'estimado' | 'sin_capacidad';

export const CONFIANZA_LABEL: Record<Confianza, string> = {
  confirmado: 'Confirmado',
  estimado: 'Estimado',
  sin_capacidad: 'Sin capacidad conocida',
};

export interface SaturationFinding {
  id: string;
  scope: 'puesto' | 'seccion';
  entityId: string;
  granularity: Granularity;
  periodKey: string;
  periodStart: number;
  loadH: number;
  capacityH?: number;
  occupancy?: number;
  excessH?: number;
  estimatedShare: number;
  confianza: Confianza;
  estado: 'saturado' | 'riesgo';
  future: boolean;
  ids: string[];
  message: string;
}

export interface ResourceRanking {
  id: string;
  scope: 'puesto' | 'seccion';
  seccion?: string;
  totalH: number;
  futureH: number;
  peakOccupancy?: number;
  peakPeriod?: string;
  overloadedWeeks: number;
  riskWeeks: number;
  overlapConflicts: number;
  capSource: ResourceLoad['capSource'];
  confianza: Confianza;
  aparatos: number;
  label: string;
  freeCapacityH?: number;
}

export interface Forecast {
  id: string;
  message: string;
  confianza: Confianza;
  scope: 'puesto' | 'seccion';
  entityId: string;
  periods: string[];
  severity: 'critica' | 'alta' | 'media' | 'informativa';
  ids: string[];
}

export interface BottleneckResult {
  findings: SaturationFinding[];
  ranking: ResourceRanking[];
  seccionRanking: ResourceRanking[];
  forecasts: Forecast[];
  /** Semanas saturadas por puesto (clave puesto|semana) para marcar operaciones. */
  saturatedWeeks: Map<string, SaturationFinding>;
}

function confianzaOf(cell: LoadCell, capSource: ResourceLoad['capSource']): Confianza {
  if (capSource === 'desconocida' || cell.capacityH === undefined) return 'sin_capacidad';
  if (capSource === 'conocida' && cell.estimatedH / Math.max(cell.loadH, 1e-9) < 0.5) return 'confirmado';
  return 'estimado';
}

export function computeBottlenecks(load: LoadResult, overlaps: OverlapGroup[], settings: Settings, refMs: number, model: ProductionModel): BottleneckResult {
  const refWeekStart = (() => {
    const d = startOfDay(refMs);
    const wd = new Date(d).getDay() || 7;
    return addDays(d, -(wd - 1));
  })();
  const horizonEnd = addDays(refWeekStart, settings.horizonWeeks * 7);
  const findings: SaturationFinding[] = [];
  const saturatedWeeks = new Map<string, SaturationFinding>();

  const scan = (rl: ResourceLoad, scope: 'puesto' | 'seccion', g: Granularity) => {
    for (const c of rl.buckets[g].values()) {
      if (c.occupancy === undefined || !(c.loadH > 0)) continue;
      const occ = c.occupancy;
      if (occ < settings.riskThreshold) continue;
      const estado = occ > 1 + 1e-9 ? 'saturado' : 'riesgo';
      const confianza = confianzaOf(c, rl.capSource);
      const future = g === 'semana' ? c.start >= refWeekStart : c.start >= startOfDay(refMs);
      const excess = c.capacityH !== undefined ? (scope === 'seccion' ? (c.loadWithCapH ?? 0) : c.loadH) - c.capacityH : undefined;
      const periodTxt = g === 'semana' ? `la semana ${Number(c.key.slice(6))} de ${c.key.slice(0, 4)}` : g === 'dia' ? `el día ${c.key.split('-').reverse().join('/')}` : `el mes ${c.key}`;
      const who = scope === 'puesto' ? `El puesto de trabajo ${rl.id}` : `La sección ${rl.id}`;
      const verb = future ? 'presenta una ocupación prevista' : 'presentó una ocupación planificada';
      const tag = confianza === 'confirmado' ? '' : rl.capSource === 'parcial' ? ' — estimado: solo parte de los puestos de la sección tiene capacidad configurada' : rl.capSource === 'supuesta' ? ' — estimado con capacidad supuesta' : ' — estimado: parte de la carga procede de duraciones estimadas';
      const f: SaturationFinding = {
        id: `sat:${scope}:${rl.id}:${g}:${c.key}`,
        scope,
        entityId: rl.id,
        granularity: g,
        periodKey: c.key,
        periodStart: c.start,
        loadH: c.loadH,
        capacityH: c.capacityH,
        occupancy: occ,
        excessH: excess,
        estimatedShare: c.loadH ? c.estimatedH / c.loadH : 0,
        confianza,
        estado,
        future,
        ids: c.ids,
        message: `${who} ${verb} del ${Number.isFinite(occ) ? fmtNum(occ * 100) : '∞'} % durante ${periodTxt} (carga ${fmtHours(scope === 'seccion' ? c.loadWithCapH ?? c.loadH : c.loadH)} / capacidad ${fmtHours(c.capacityH)})${tag}.`,
      };
      findings.push(f);
      if (scope === 'puesto' && g === 'semana' && estado === 'saturado') saturatedWeeks.set(`${rl.id}|${c.key}`, f);
    }
  };
  for (const pl of load.puestos.values()) {
    scan(pl, 'puesto', 'semana');
    scan(pl, 'puesto', 'dia');
  }
  for (const sl of load.secciones.values()) scan(sl, 'seccion', 'semana');

  const conflicts = overlaps.filter((g) => g.clase !== 'solape_dentro_capacidad');
  const aparatosByPuesto = new Map<string, Set<string>>();
  for (const op of model.ops.values()) {
    if (!op.puestoId || !op.aparatoId) continue;
    const s = aparatosByPuesto.get(op.puestoId) ?? new Set();
    s.add(op.aparatoId);
    aparatosByPuesto.set(op.puestoId, s);
  }

  const rank = (rl: ResourceLoad, scope: 'puesto' | 'seccion'): ResourceRanking => {
    const weeks = [...rl.buckets.semana.values()];
    const fut = weeks.filter((c) => c.start >= refWeekStart && c.start < horizonEnd);
    let peak: LoadCell | undefined;
    for (const c of fut) if (c.occupancy !== undefined && (!peak || c.occupancy > peak.occupancy!)) peak = c;
    const overloaded = fut.filter((c) => (c.occupancy ?? 0) > 1 + 1e-9).length;
    const risk = fut.filter((c) => (c.occupancy ?? 0) >= settings.riskThreshold && (c.occupancy ?? 0) <= 1 + 1e-9).length;
    const futureH = fut.reduce((a, c) => a + c.loadH, 0);
    const freeCap = fut.reduce((a, c) => (c.capacityH !== undefined ? a + Math.max(0, c.capacityH - (scope === 'seccion' ? c.loadWithCapH ?? 0 : c.loadH)) : a), 0);
    const ov = scope === 'puesto' ? conflicts.filter((g) => g.puestoId === rl.id && g.end >= refWeekStart).length : conflicts.filter((g) => rl.members?.includes(g.puestoId) && g.end >= refWeekStart).length;
    const peakConf = peak ? confianzaOf(peak, rl.capSource) : rl.capSource === 'desconocida' ? 'sin_capacidad' : 'estimado';
    let label: string;
    if (rl.capSource === 'desconocida') label = futureH > 0 ? 'Carga sin capacidad conocida: no se puede confirmar saturación' : 'Sin carga futura';
    else if (overloaded > 0) label = peakConf === 'confirmado' ? 'Cuello de botella confirmado' : 'Riesgo de cuello de botella (estimado)';
    else if (risk > 0) label = 'Riesgo: ocupación cercana a la capacidad';
    else label = 'Sin saturación en el horizonte';
    const aps = scope === 'puesto' ? aparatosByPuesto.get(rl.id)?.size ?? 0 : new Set((rl.members ?? []).flatMap((m) => [...(aparatosByPuesto.get(m) ?? [])])).size;
    return {
      id: rl.id,
      scope,
      seccion: rl.seccion,
      totalH: rl.totalH,
      futureH,
      peakOccupancy: peak?.occupancy,
      peakPeriod: peak?.key,
      overloadedWeeks: overloaded,
      riskWeeks: risk,
      overlapConflicts: ov,
      capSource: rl.capSource,
      confianza: peakConf,
      aparatos: aps,
      label,
      freeCapacityH: rl.capSource === 'desconocida' ? undefined : freeCap,
    };
  };
  const sortRank = (a: ResourceRanking, b: ResourceRanking) =>
    (b.peakOccupancy ?? -1) - (a.peakOccupancy ?? -1) || b.overlapConflicts - a.overlapConflicts || b.futureH - a.futureH;
  const ranking = [...load.puestos.values()].map((p) => rank(p, 'puesto')).sort(sortRank);
  const seccionRanking = [...load.secciones.values()].map((s) => rank(s, 'seccion')).sort(sortRank);

  // Previsiones (cuellos de botella futuros) con mensaje respaldado por el cálculo
  const forecasts: Forecast[] = [];
  for (const f of findings) {
    if (!f.future || f.granularity !== 'semana' || f.periodStart >= horizonEnd || f.scope !== 'puesto') continue;
    forecasts.push({
      id: `fc:${f.id}`,
      message: f.message,
      confianza: f.confianza,
      scope: f.scope,
      entityId: f.entityId,
      periods: [f.periodKey],
      severity: f.estado === 'saturado' ? (f.confianza === 'confirmado' ? 'alta' : 'media') : 'informativa',
      ids: f.ids,
    });
  }
  // Secciones: rachas de semanas consecutivas saturadas
  for (const sl of load.secciones.values()) {
    const weeks = [...sl.buckets.semana.values()].filter((c) => c.start >= refWeekStart && c.start < horizonEnd).sort((a, b) => a.start - b.start);
    let run: LoadCell[] = [];
    const flush = () => {
      if (!run.length) return;
      const conf = run.every((c) => confianzaOf(c, sl.capSource) === 'confirmado') ? 'confirmado' : 'estimado';
      const first = run[0];
      const last = run[run.length - 1];
      const isNext = first.start <= addDays(refWeekStart, 7);
      const span = run.length === 1 ? `la semana ${weekLabel(first.key)}` : `${isNext ? 'las próximas ' : ''}${run.length} semanas (${weekLabel(first.key)} – ${weekLabel(last.key)})`;
      forecasts.push({
        id: `fc:sec:${sl.id}:${first.key}`,
        message: `La sección ${sl.id} concentra una carga superior a su capacidad disponible durante ${span}${conf === 'estimado' ? (sl.capSource === 'parcial' ? ` — estimado: capacidad configurada en ${sl.membersWithCap} de ${sl.members?.length} puestos` : ' — estimado') : ''}.`,
        confianza: conf,
        scope: 'seccion',
        entityId: sl.id,
        periods: run.map((c) => c.key),
        severity: conf === 'confirmado' ? 'alta' : 'media',
        ids: run.flatMap((c) => c.ids),
      });
      run = [];
    };
    for (const c of weeks) {
      const prev = run[run.length - 1];
      const consecutive = prev && Math.abs(c.start - addDays(prev.start, 7)) < 3 * 3600_000;
      if ((c.occupancy ?? 0) > 1 + 1e-9) {
        if (prev && !consecutive) flush();
        run.push(c);
      } else flush();
    }
    flush();
  }
  // Solapamientos futuros por puesto
  const byPuesto = new Map<string, OverlapGroup[]>();
  for (const g of conflicts) {
    if (g.end < refWeekStart) continue;
    const l = byPuesto.get(g.puestoId) ?? [];
    l.push(g);
    byPuesto.set(g.puestoId, l);
  }
  for (const [puesto, gs] of byPuesto) {
    const ids = [...new Set(gs.flatMap((g) => g.ids))];
    const worst = gs.some((g) => g.clase === 'sobrecarga_confirmada') ? 'sobrecarga_confirmada' : gs.some((g) => g.clase === 'sobrecarga_estimada') ? 'sobrecarga_estimada' : 'solape_potencial';
    const conf: Confianza = worst === 'sobrecarga_confirmada' ? 'confirmado' : worst === 'sobrecarga_estimada' ? 'estimado' : 'sin_capacidad';
    const maxC = Math.max(...gs.map((g) => g.maxConcurrency));
    forecasts.push({
      id: `fc:ov:${puesto}`,
      message:
        worst === 'solape_potencial'
          ? `Se detectan ${ids.length} operaciones que coinciden en el tiempo en el puesto ${puesto} (hasta ${maxC} a la vez). Posible conflicto: la capacidad paralela del puesto no está configurada.`
          : `Se detectan ${ids.length} operaciones que necesitan el puesto ${puesto} durante periodos incompatibles (${OVERLAP_LABEL[worst].toLowerCase()}: hasta ${maxC} simultáneas para ${gs[0].units} unidad(es)${worst === 'sobrecarga_estimada' ? ' supuesta(s)' : ''}).`,
      confianza: conf,
      scope: 'puesto',
      entityId: puesto,
      periods: [],
      severity: worst === 'sobrecarga_confirmada' ? 'alta' : 'media',
      ids,
    });
  }
  const sevRank = { critica: 4, alta: 3, media: 2, informativa: 1 };
  forecasts.sort((a, b) => sevRank[b.severity] - sevRank[a.severity] || (a.confianza === 'confirmado' ? -1 : 1));
  return { findings, ranking, seccionRanking, forecasts, saturatedWeeks };
}


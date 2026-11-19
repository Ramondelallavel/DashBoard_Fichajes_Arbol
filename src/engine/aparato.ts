import { weekKey } from '../lib/dates';
import type { Alert } from './alerts';
import { isRetrasada, type Analysis, type OpFlags } from './analysis';
import type { Confianza } from './bottlenecks';
import type { ComparisonRow } from './comparison';
import type { Aparato, Dependency, Operacion, Orden } from './model';

export interface PuestoPaso {
  puestoId: string;
  seccion?: string;
  ops: Operacion[];
  firstStart?: number;
  lastEnd?: number;
  hours: number;
  /** Semanas en que el aparato pasa por el puesto y el puesto está saturado. */
  saturatedWeeks: { week: string; occupancy?: number; confianza: Confianza }[];
  overlapConflicts: number;
  riesgo: 'confirmado' | 'estimado' | 'posible' | 'ninguno';
}

export interface AparatoAnalysis {
  aparato: Aparato;
  ordenes: Orden[];
  ops: Operacion[];
  pasos: PuestoPaso[];
  delayed: { op: Operacion; flags: OpFlags }[];
  pendingDeps: { op: Operacion; dep: Dependency }[];
  violations: { op: Operacion; pred: Operacion; tipo: Dependency['tipo'] }[];
  waits: { op: Operacion; pred: Operacion; gapDays: number }[];
  alerts: Alert[];
  comparison: ComparisonRow[];
  incompleto: string[];
}

/** Análisis de fabricación y cuellos de botella de un aparato concreto. */
export function analyzeAparato(a: Analysis, aparatoId: string): AparatoAnalysis | undefined {
  const ap = a.model.aparatos.get(aparatoId);
  if (!ap) return undefined;
  const ordenes = ap.ordenIds.map((id) => a.model.ordenes.get(id)!).filter(Boolean);
  const ops = ordenes.flatMap((o) => o.opKeys.map((k) => a.model.ops.get(k)!)).sort((x, y) => (x.start ?? Infinity) - (y.start ?? Infinity));
  const byPuesto = new Map<string, Operacion[]>();
  for (const op of ops) {
    if (!op.puestoId) continue;
    const l = byPuesto.get(op.puestoId) ?? [];
    l.push(op);
    byPuesto.set(op.puestoId, l);
  }
  const pasos: PuestoPaso[] = [];
  for (const [puestoId, list] of byPuesto) {
    const weeks = new Set<string>();
    for (const op of list) {
      if (op.start !== undefined) weeks.add(weekKey(op.start));
      if (op.end !== undefined) weeks.add(weekKey(op.end));
    }
    const pl = a.load.produccion.puestos.get(puestoId);
    const saturatedWeeks: PuestoPaso['saturatedWeeks'] = [];
    for (const w of weeks) {
      const sat = a.bottlenecks.saturatedWeeks.get(`${puestoId}|${w}`);
      if (sat) saturatedWeeks.push({ week: w, occupancy: sat.occupancy, confianza: sat.confianza });
      else {
        const c = pl?.buckets.semana.get(w);
        if (c?.occupancy !== undefined && c.occupancy >= a.settings.riskThreshold) saturatedWeeks.push({ week: w, occupancy: c.occupancy, confianza: 'estimado' });
      }
    }
    const conflicts = list.filter((op) => {
      const ov = a.overlapByOp.get(op.key);
      return ov && ov.clase !== 'solape_dentro_capacidad';
    }).length;
    const conf = saturatedWeeks.some((s) => s.confianza === 'confirmado' && (s.occupancy ?? 0) > 1)
      ? 'confirmado'
      : saturatedWeeks.some((s) => (s.occupancy ?? 0) > 1) || list.some((op) => a.overlapByOp.get(op.key)?.clase === 'sobrecarga_estimada')
        ? 'estimado'
        : conflicts || saturatedWeeks.length
          ? 'posible'
          : 'ninguno';
    pasos.push({
      puestoId,
      seccion: a.model.puestos.get(puestoId)?.seccion,
      ops: list,
      firstStart: Math.min(...list.map((o) => o.start ?? Infinity)),
      lastEnd: Math.max(...list.map((o) => o.end ?? -Infinity)),
      hours: list.reduce((s, o) => s + (a.opFlags.get(o.key)?.hours ?? 0), 0),
      saturatedWeeks: saturatedWeeks.sort((x, y) => x.week.localeCompare(y.week)),
      overlapConflicts: conflicts,
      riesgo: conf,
    });
  }
  pasos.sort((x, y) => (x.firstStart ?? Infinity) - (y.firstStart ?? Infinity));

  const delayed = ops.map((op) => ({ op, flags: a.opFlags.get(op.key)! })).filter((x) => isRetrasada(x.flags));
  const pendingDeps: AparatoAnalysis['pendingDeps'] = [];
  const violations: AparatoAnalysis['violations'] = [];
  const waits: AparatoAnalysis['waits'] = [];
  for (const op of ops) {
    for (const dep of op.preds) {
      if (dep.tipo === 'pendiente' || !dep.from) {
        pendingDeps.push({ op, dep });
        continue;
      }
      const pred = a.model.ops.get(dep.from);
      if (!pred || op.start === undefined || pred.end === undefined) continue;
      if (op.start < pred.end) violations.push({ op, pred, tipo: dep.tipo });
      else {
        const gap = a.calendar.workingDaysDiff(pred.end, op.start);
        if (gap >= a.settings.dependencies.waitThresholdDays) waits.push({ op, pred, gapDays: gap });
      }
    }
  }
  const opKeys = new Set(ops.map((o) => o.key));
  const ordenIds = new Set(ap.ordenIds);
  const alerts = a.alerts.filter((x) => x.aparatoId === aparatoId || (x.opKey && opKeys.has(x.opKey)) || (x.ordenId && ordenIds.has(x.ordenId)));
  const comparison = a.comparison.rows.filter((r) => r.aparatoId === aparatoId || (r.ordenId && ordenIds.has(r.ordenId)));
  const incompleto: string[] = [];
  for (const o of ordenes) {
    if (o.aparatoLink === 'inferida') incompleto.push(`Orden ${o.id}: aparato inferido (${o.aparatoRule}).`);
    if (o.parentLink === 'pendiente') incompleto.push(`Orden ${o.id}: relación con orden padre pendiente (${o.parentRule}).`);
  }
  if (ap.rootOrdenIds.length > 1 && ap.rootOrdenIds.some((r) => a.model.ordenes.get(r)?.parentLink !== 'manual')) {
    incompleto.push(`Las órdenes ${ap.rootOrdenIds.join(', ')} no tienen relación jerárquica conocida entre sí.`);
  }
  for (const op of ops) {
    const f = a.opFlags.get(op.key);
    if (f?.sinInfo.length) incompleto.push(`Op. ${op.ordenId}/${op.label}: ${f.sinInfo.join(', ')}.`);
  }
  return { aparato: ap, ordenes, ops, pasos, delayed, pendingDeps, violations, waits, alerts, comparison, incompleto };
}

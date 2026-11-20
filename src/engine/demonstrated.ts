import { addDays, startOfDay } from '../lib/dates';
import { fmtHours, fmtNum } from '../lib/format';
import type { LoadResult } from './load';

/**
 * Capacidad DEMOSTRADA por sección: horas de carga de las preórdenes ejecutadas por la sección cada semana
 * según los fichajes (la carga de cada preorden se reparte entre los días laborables de su intervalo real). No es la capacidad nominal, sino lo que la sección
 * ha sido capaz de completar recientemente; sirve como referencia ESTIMADA cuando no hay capacidad
 * configurada. Se compara con la carga que la planificación (Ortems) le asigna en las semanas futuras.
 */
export interface DemonstratedRow {
  seccion: string;
  /** semanas de historial con fichajes usadas */
  weeks: number;
  meanH: number;
  maxH: number;
  history: { week: string; hours: number }[];
  planned: { week: string; start: number; hours: number; ratioMax?: number; ratioMean?: number }[];
}

export interface DemonstratedForecast {
  id: string;
  seccion: string;
  week: string;
  plannedH: number;
  maxH: number;
  ratio: number;
  message: string;
  ids: string[];
}

export function demonstratedCapacity(real: LoadResult, plan: LoadResult | undefined, refMs: number, weeks: number, horizonWeeks: number, planLabel: string): { rows: DemonstratedRow[]; forecasts: DemonstratedForecast[] } {
  const refWeekStart = (() => {
    const d = startOfDay(refMs);
    const wd = new Date(d).getDay() || 7;
    return addDays(d, -(wd - 1));
  })();
  const histFrom = addDays(refWeekStart, -7 * weeks);
  const horizonEnd = addDays(refWeekStart, 7 * horizonWeeks);
  const rows: DemonstratedRow[] = [];
  const forecasts: DemonstratedForecast[] = [];
  const secs = new Set([...real.secciones.keys(), ...(plan?.secciones.keys() ?? [])]);
  for (const sec of secs) {
    const r = real.secciones.get(sec);
    const history = r
      ? [...r.buckets.semana.values()].filter((c) => c.start >= histFrom && c.start < refWeekStart && c.loadH > 0).sort((a, b) => a.start - b.start).map((c) => ({ week: c.key, hours: c.loadH }))
      : [];
    const maxH = history.length ? Math.max(...history.map((h) => h.hours)) : 0;
    const meanH = history.length ? history.reduce((s, h) => s + h.hours, 0) / history.length : 0;
    const p = plan?.secciones.get(sec);
    const planned = p
      ? [...p.buckets.semana.values()]
          .filter((c) => c.start >= refWeekStart && c.start < horizonEnd && c.loadH > 0)
          .sort((a, b) => a.start - b.start)
          .map((c) => ({ week: c.key, start: c.start, hours: c.loadH, ratioMax: maxH ? c.loadH / maxH : undefined, ratioMean: meanH ? c.loadH / meanH : undefined, ids: c.ids }))
      : [];
    rows.push({ seccion: sec, weeks: history.length, meanH, maxH, history, planned: planned.map(({ ids, ...x }) => (void ids, x)) });
    if (history.length < 2) continue; // sin historial suficiente no se afirma nada
    for (const w of planned) {
      if (!w.ratioMax || w.ratioMax <= 1) continue;
      const wk = `${Number(w.week.slice(6))} de ${w.week.slice(0, 4)}`;
      forecasts.push({
        id: `dem:${sec}:${w.week}`,
        seccion: sec,
        week: w.week,
        plannedH: w.hours,
        maxH,
        ratio: w.ratioMax,
        message: `La sección ${sec} tiene planificadas ${fmtHours(w.hours)} en la semana ${wk} según ${planLabel}: un ${fmtNum(w.ratioMax * 100)} % de lo que completó en su mejor semana de las últimas ${history.length} según los fichajes (${fmtHours(maxH)}; media ${fmtHours(meanH)}). Estimado: es una referencia de lo demostrado, no la capacidad nominal.`,
        ids: w.ids,
      });
    }
  }
  rows.sort((a, b) => Math.max(0, ...b.planned.map((x) => x.ratioMax ?? 0)) - Math.max(0, ...a.planned.map((x) => x.ratioMax ?? 0)) || a.seccion.localeCompare(b.seccion));
  forecasts.sort((a, b) => b.ratio - a.ratio);
  return { rows, forecasts };
}


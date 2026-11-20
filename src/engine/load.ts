import { addDays, dayKey, monthKey, startOfDay, weekKey } from '../lib/dates';
import type { CapacityCalendar, CapSource } from './calendar';
import type { PlanSource } from './overlaps';

export type Granularity = 'dia' | 'semana' | 'mes';

/** Elemento de carga: una operación (o registro Ortems) con su puesto, fechas y horas. */
export interface LoadItem {
  id: string;
  puestoId?: string;
  seccion?: string;
  ordenId?: string;
  start?: number;
  end?: number;
  hours?: number;
  /** Las horas proceden de una estimación (no del dato de duración del Excel). */
  estimated: boolean;
  /** Las fechas son de ejecución real (fichajes), no de planificación. */
  real?: boolean;
  source: 'produccion' | 'ortems';
}

export type BucketCapSource = CapSource | 'parcial';

export interface LoadCell {
  key: string;
  start: number;
  loadH: number;
  estimatedH: number;
  ids: string[];
  capacityH?: number;
  capSource: BucketCapSource;
  /** Para secciones con capacidad parcial: carga de los puestos con capacidad conocida. */
  loadWithCapH?: number;
  occupancy?: number;
}

export interface ResourceLoad {
  id: string;
  kind: 'puesto' | 'seccion';
  seccion?: string;
  buckets: Record<Granularity, Map<string, LoadCell>>;
  totalH: number;
  estimatedH: number;
  scheduledIds: Set<string>;
  unscheduledIds: string[];
  unscheduledH: number;
  noHoursIds: string[];
  capSource: BucketCapSource;
  /** Puestos que componen una sección (solo secciones). */
  members?: string[];
  membersWithCap?: number;
}

export interface LoadResult {
  source: PlanSource;
  puestos: Map<string, ResourceLoad>;
  secciones: Map<string, ResourceLoad>;
  range?: { start: number; end: number };
  /** Elementos sin puesto: no computan en ningún recurso. */
  sinPuesto: string[];
}

function keyOf(g: Granularity, dayMs: number) {
  return g === 'dia' ? dayKey(dayMs) : g === 'semana' ? weekKey(dayMs) : monthKey(dayMs);
}

function emptyLoad(id: string, kind: 'puesto' | 'seccion', capSource: BucketCapSource, seccion?: string): ResourceLoad {
  return {
    id,
    kind,
    seccion,
    buckets: { dia: new Map(), semana: new Map(), mes: new Map() },
    totalH: 0,
    estimatedH: 0,
    scheduledIds: new Set(),
    unscheduledIds: [],
    unscheduledH: 0,
    noHoursIds: [],
    capSource,
  };
}

function cell(map: Map<string, LoadCell>, key: string, start: number, capSource: BucketCapSource): LoadCell {
  let c = map.get(key);
  if (!c) {
    c = { key, start, loadH: 0, estimatedH: 0, ids: [], capSource };
    map.set(key, c);
  }
  return c;
}

/**
 * Calcula la carga por puesto y sección y la compara con la capacidad.
 * Reparto: las horas de cada operación se reparten entre los días laborables de su intervalo
 * proporcionalmente a la capacidad diaria del puesto (a partes iguales si se desconoce).
 * La capacidad de semanas y meses es la suma de la capacidad de todos sus días.
 */
export function computeLoad(items: LoadItem[], calendar: CapacityCalendar, source: PlanSource, puestoSeccion: Map<string, string | undefined>): LoadResult {
  const puestos = new Map<string, ResourceLoad>();
  const sinPuesto: string[] = [];
  let rangeStart = Infinity;
  let rangeEnd = -Infinity;

  // Carga con sección pero sin puesto (p. ej. fichajes por sección): cuenta en la sección, sin capacidad propia
  const direct = new Map<string, ResourceLoad>();
  for (const it of items) {
    let pl: ResourceLoad | undefined;
    if (!it.puestoId) {
      if (!it.seccion) {
        sinPuesto.push(it.id);
        continue;
      }
      pl = direct.get(it.seccion);
      if (!pl) {
        pl = emptyLoad(it.seccion, 'seccion', 'desconocida', it.seccion);
        direct.set(it.seccion, pl);
      }
    } else {
      pl = puestos.get(it.puestoId);
      if (!pl) {
        pl = emptyLoad(it.puestoId, 'puesto', calendar.capacitySource(it.puestoId), puestoSeccion.get(it.puestoId) ?? it.seccion);
        puestos.set(it.puestoId, pl);
      }
    }
    if (it.hours === undefined) {
      pl.noHoursIds.push(it.id);
      continue;
    }
    if (it.start === undefined || it.end === undefined) {
      pl.unscheduledIds.push(it.id);
      pl.unscheduledH += it.hours;
      continue;
    }
    const end = Math.max(it.end, it.start);
    let days = calendar.workingDaysIn(it.puestoId, it.start, end);
    if (!days.length) days = [startOfDay(it.start)];
    const weights = days.map((d) => Math.max(0, calendar.unitHours(it.puestoId, d) ?? 1));
    const wsum = weights.reduce((a, b) => a + b, 0);
    days.forEach((d, i) => {
      const share = wsum > 0 ? weights[i] / wsum : 1 / days.length;
      const h = it.hours! * share;
      if (!(h > 0)) return;
      for (const g of ['dia', 'semana', 'mes'] as Granularity[]) {
        const c = cell(pl!.buckets[g], keyOf(g, d), g === 'dia' ? d : bucketStart(g, d), pl!.capSource);
        c.loadH += h;
        if (it.estimated) c.estimatedH += h;
        if (c.ids[c.ids.length - 1] !== it.id) c.ids.push(it.id);
      }
    });
    pl.totalH += it.hours;
    if (it.estimated) pl.estimatedH += it.hours;
    pl.scheduledIds.add(it.id);
    rangeStart = Math.min(rangeStart, startOfDay(it.start));
    rangeEnd = Math.max(rangeEnd, startOfDay(end));
  }

  const range = Number.isFinite(rangeStart) ? { start: rangeStart, end: rangeEnd } : undefined;
  // Capacidad de todos los días del rango (también los días sin carga)
  if (range) {
    for (const pl of puestos.values()) fillCapacity(pl, calendar, range);
  }

  // Secciones
  const secciones = new Map<string, ResourceLoad>();
  for (const [sec, dl] of direct) {
    const sl = emptyLoad(sec, 'seccion', 'desconocida');
    sl.members = [];
    sl.membersWithCap = 0;
    secciones.set(sec, sl);
    void dl;
  }
  for (const pl of puestos.values()) {
    const sec = pl.seccion ?? '(sin sección)';
    let sl = secciones.get(sec);
    if (!sl) {
      sl = emptyLoad(sec, 'seccion', 'desconocida');
      sl.members = [];
      sl.membersWithCap = 0;
      secciones.set(sec, sl);
    }
    sl.members!.push(pl.id);
    if (pl.capSource !== 'desconocida') sl.membersWithCap!++;
    sl.totalH += pl.totalH;
    sl.estimatedH += pl.estimatedH;
    sl.unscheduledH += pl.unscheduledH;
    sl.unscheduledIds.push(...pl.unscheduledIds);
    sl.noHoursIds.push(...pl.noHoursIds);
    pl.scheduledIds.forEach((id) => sl!.scheduledIds.add(id));
  }
  for (const sl of secciones.values()) {
    const members = sl.members!.map((id) => puestos.get(id)!);
    const known = members.filter((m) => m.capSource !== 'desconocida');
    const dl = direct.get(sl.id);
    sl.capSource = known.length === 0 ? 'desconocida' : known.length < members.length || dl ? 'parcial' : known.every((m) => m.capSource === 'conocida') ? 'conocida' : 'supuesta';
    if (dl) {
      sl.totalH += dl.totalH;
      sl.estimatedH += dl.estimatedH;
      sl.unscheduledH += dl.unscheduledH;
      sl.unscheduledIds.push(...dl.unscheduledIds);
      sl.noHoursIds.push(...dl.noHoursIds);
      dl.scheduledIds.forEach((id) => sl.scheduledIds.add(id));
    }
    for (const g of ['dia', 'semana', 'mes'] as Granularity[]) {
      // la carga sin puesto suma horas a la sección, pero no capacidad (no se conoce)
      for (const c of dl?.buckets[g].values() ?? []) {
        const sc = cell(sl.buckets[g], c.key, c.start, sl.capSource);
        sc.loadH += c.loadH;
        sc.estimatedH += c.estimatedH;
        for (const id of c.ids) sc.ids.push(id);
      }
      for (const m of members) {
        for (const c of m.buckets[g].values()) {
          const sc = cell(sl.buckets[g], c.key, c.start, sl.capSource);
          sc.loadH += c.loadH;
          sc.estimatedH += c.estimatedH;
          for (const id of c.ids) sc.ids.push(id);
          if (c.capacityH !== undefined) {
            sc.capacityH = (sc.capacityH ?? 0) + c.capacityH;
            sc.loadWithCapH = (sc.loadWithCapH ?? 0) + c.loadH;
          }
        }
      }
      for (const sc of sl.buckets[g].values()) {
        if (sc.capacityH !== undefined) sc.occupancy = sc.capacityH > 0 ? (sc.loadWithCapH ?? 0) / sc.capacityH : sc.loadWithCapH ? Infinity : 0;
      }
    }
  }
  return { source, puestos, secciones, range, sinPuesto };
}

function fillCapacity(pl: ResourceLoad, calendar: CapacityCalendar, range: { start: number; end: number }) {
  if (pl.capSource === 'desconocida') return;
  let d = range.start;
  let guard = 0;
  while (d <= range.end && guard < 4000) {
    const cap = calendar.capacityHours(pl.id, d).hours ?? 0;
    for (const g of ['dia', 'semana', 'mes'] as Granularity[]) {
      const c = cell(pl.buckets[g], keyOf(g, d), g === 'dia' ? d : bucketStart(g, d), pl.capSource);
      c.capacityH = (c.capacityH ?? 0) + cap;
    }
    d = addDays(d, 1);
    guard++;
  }
  for (const g of ['dia', 'semana', 'mes'] as Granularity[]) {
    for (const c of pl.buckets[g].values()) {
      if (c.capacityH === undefined) continue;
      c.occupancy = c.capacityH > 0 ? c.loadH / c.capacityH : c.loadH > 0 ? Infinity : 0;
    }
  }
}

function bucketStart(g: Granularity, d: number): number {
  if (g === 'mes') {
    const x = new Date(d);
    return new Date(x.getFullYear(), x.getMonth(), 1).getTime();
  }
  const wd = new Date(d).getDay() || 7;
  return addDays(startOfDay(d), -(wd - 1));
}

export function sortedCells(rl: ResourceLoad, g: Granularity): LoadCell[] {
  return [...rl.buckets[g].values()].sort((a, b) => a.start - b.start);
}

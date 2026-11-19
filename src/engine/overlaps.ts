import type { CapacityCalendar, CapSource } from './calendar';

export type PlanSource = 'produccion' | 'ortems' | 'combinada';

/**
 * Clasificación de solapamientos (no todo solape es un problema):
 * - solape_dentro_capacidad: hay coincidencia, pero no supera las unidades paralelas conocidas (informativo).
 * - solape_potencial: hay coincidencia y se desconoce la capacidad paralela del puesto.
 * - sobrecarga_confirmada: la simultaneidad supera las unidades paralelas configuradas.
 * - sobrecarga_estimada: la simultaneidad supera la capacidad SUPUESTA (sin capacidad real configurada).
 */
export type OverlapClass = 'solape_dentro_capacidad' | 'solape_potencial' | 'sobrecarga_confirmada' | 'sobrecarga_estimada';

export const OVERLAP_LABEL: Record<OverlapClass, string> = {
  solape_dentro_capacidad: 'Solapamiento detectado (dentro de capacidad)',
  solape_potencial: 'Solapamiento potencialmente conflictivo',
  sobrecarga_confirmada: 'Sobrecarga confirmada',
  sobrecarga_estimada: 'Sobrecarga estimada',
};

export const OVERLAP_RANK: Record<OverlapClass, number> = {
  solape_dentro_capacidad: 1,
  solape_potencial: 2,
  sobrecarga_estimada: 3,
  sobrecarga_confirmada: 4,
};

export interface Interval {
  id: string;
  puestoId: string;
  start: number;
  end: number;
}

export interface OverlapGroup {
  id: string;
  puestoId: string;
  source: PlanSource;
  ids: string[];
  start: number;
  end: number;
  maxConcurrency: number;
  peakStart: number;
  peakEnd: number;
  units?: number;
  unitsSource: CapSource;
  clase: OverlapClass;
}

export function detectOverlaps(intervals: Interval[], calendar: CapacityCalendar, source: PlanSource): OverlapGroup[] {
  const byPuesto = new Map<string, Interval[]>();
  for (const iv of intervals) {
    if (!(iv.end > iv.start)) continue;
    const l = byPuesto.get(iv.puestoId) ?? [];
    l.push(iv);
    byPuesto.set(iv.puestoId, l);
  }
  const groups: OverlapGroup[] = [];
  for (const [puestoId, list] of byPuesto) {
    list.sort((a, b) => a.start - b.start || a.end - b.end);
    let cluster: Interval[] = [];
    let clusterEnd = -Infinity;
    const flush = () => {
      if (cluster.length > 1) {
        const g = analyseCluster(cluster, puestoId, calendar, source);
        if (g) groups.push(g);
      }
      cluster = [];
      clusterEnd = -Infinity;
    };
    for (const iv of list) {
      if (iv.start < clusterEnd) {
        cluster.push(iv);
        clusterEnd = Math.max(clusterEnd, iv.end);
      } else {
        flush();
        cluster = [iv];
        clusterEnd = iv.end;
      }
    }
    flush();
  }
  return groups;
}

function analyseCluster(cluster: Interval[], puestoId: string, calendar: CapacityCalendar, source: PlanSource): OverlapGroup | undefined {
  // barrido: los finales se procesan antes que los inicios en el mismo instante ([8,12) y [12,16) no solapan)
  const events: [number, number][] = [];
  for (const iv of cluster) {
    events.push([iv.start, 1]);
    events.push([iv.end, -1]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let max = 0;
  let peakStart = cluster[0].start;
  let peakEnd = cluster[0].end;
  for (let i = 0; i < events.length; i++) {
    cur += events[i][1];
    if (cur > max) {
      max = cur;
      peakStart = events[i][0];
      peakEnd = events[i + 1]?.[0] ?? events[i][0];
    }
  }
  if (max < 2) return undefined;
  const { units, source: unitsSource } = calendar.units(puestoId);
  let clase: OverlapClass;
  if (unitsSource === 'conocida') clase = max > (units ?? 1) ? 'sobrecarga_confirmada' : 'solape_dentro_capacidad';
  else if (unitsSource === 'supuesta') clase = max > (units ?? 1) ? 'sobrecarga_estimada' : 'solape_dentro_capacidad';
  else clase = 'solape_potencial';
  const start = Math.min(...cluster.map((c) => c.start));
  const end = Math.max(...cluster.map((c) => c.end));
  return {
    id: `ov:${source}:${puestoId}:${start}`,
    puestoId,
    source,
    ids: cluster.map((c) => c.id),
    start,
    end,
    maxConcurrency: max,
    peakStart,
    peakEnd,
    units,
    unitsSource,
    clase,
  };
}

/** Peor clase de solape por identificador (operación o registro Ortems). */
export function worstOverlapById(groups: OverlapGroup[]): Map<string, OverlapGroup> {
  const m = new Map<string, OverlapGroup>();
  for (const g of groups) {
    for (const id of g.ids) {
      const prev = m.get(id);
      if (!prev || OVERLAP_RANK[g.clase] > OVERLAP_RANK[prev.clase]) m.set(id, g);
    }
  }
  return m;
}

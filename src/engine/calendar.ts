import type { ResourceCapacity, Settings } from '../domain/settings';
import { addDays, dayKey, HOUR, isoWeekday, startOfDay } from '../lib/dates';

export type CapSource = 'conocida' | 'supuesta' | 'desconocida';

/**
 * Calendario laboral y capacidad por puesto.
 * - Un puesto con capacidad configurada usa sus horas por día de semana, unidades, eficiencia,
 *   paradas y horarios especiales, además de los festivos globales.
 * - Un puesto sin capacidad configurada tiene capacidad DESCONOCIDA, salvo que se active la
 *   capacidad supuesta, en cuyo caso es SUPUESTA (y todo resultado se marca como estimado).
 */
export class CapacityCalendar {
  private holidays: Set<string>;
  private working: Set<number>;
  private cache = new Map<string, { hours?: number; source: CapSource }>();

  /** Índices de día (UTC) de los festivos que caen en día laborable, ordenados. */
  private holidayIdx: number[];

  constructor(private settings: Settings) {
    this.holidays = new Set(settings.calendar.holidays);
    this.working = new Set(settings.calendar.workingWeekdays);
    this.holidayIdx = [...this.holidays]
      .map((k) => {
        const [y, m, d] = k.split('-').map(Number);
        return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
      })
      .filter((i) => this.working.has(isoWeekdayOfIndex(i)))
      .sort((a, b) => a - b);
  }

  isGlobalWorkingDay(dayMs: number): boolean {
    return this.working.has(isoWeekday(dayMs)) && !this.holidays.has(dayKey(dayMs));
  }

  config(puestoId: string | undefined): ResourceCapacity | undefined {
    return puestoId ? this.settings.capacities[puestoId] : undefined;
  }

  capacitySource(puestoId: string | undefined): CapSource {
    if (this.config(puestoId)) return 'conocida';
    return this.settings.assumedCapacity.enabled ? 'supuesta' : 'desconocida';
  }

  /** Unidades en paralelo del puesto (máquinas/operarios equivalentes). */
  units(puestoId: string | undefined): { units?: number; source: CapSource } {
    const c = this.config(puestoId);
    if (c) return { units: Math.max(1, c.units || 1), source: 'conocida' };
    if (this.settings.assumedCapacity.enabled) return { units: Math.max(1, this.settings.assumedCapacity.units), source: 'supuesta' };
    return { source: 'desconocida' };
  }

  /** Horas por unidad disponibles un día concreto (sin multiplicar por unidades). */
  unitHours(puestoId: string | undefined, dayMs: number): number | undefined {
    const key = dayKey(dayMs);
    const c = this.config(puestoId);
    if (c) {
      if (this.holidays.has(key)) return 0;
      if (c.stops.some((s) => key >= s.from && key <= s.to)) return 0;
      const special = c.specialDays.find((s) => s.date === key);
      if (special) return special.hours;
      return c.hoursPerWeekday[isoWeekday(dayMs)] ?? 0;
    }
    if (this.settings.assumedCapacity.enabled) return this.isGlobalWorkingDay(dayMs) ? this.settings.assumedCapacity.hoursPerDay : 0;
    return undefined;
  }

  /** Capacidad total del puesto un día (horas × unidades × eficiencia). */
  capacityHours(puestoId: string | undefined, dayMs: number): { hours?: number; source: CapSource } {
    const k = `${puestoId ?? ''}|${dayKey(dayMs)}`;
    const hit = this.cache.get(k);
    if (hit) return hit;
    const c = this.config(puestoId);
    let res: { hours?: number; source: CapSource };
    if (c) {
      const uh = this.unitHours(puestoId, dayMs) ?? 0;
      res = { hours: uh * Math.max(1, c.units || 1) * (c.efficiency > 0 ? c.efficiency : 1), source: 'conocida' };
    } else if (this.settings.assumedCapacity.enabled) {
      const uh = this.unitHours(puestoId, dayMs) ?? 0;
      res = { hours: uh * Math.max(1, this.settings.assumedCapacity.units), source: 'supuesta' };
    } else res = { source: 'desconocida' };
    this.cache.set(k, res);
    return res;
  }

  /** ¿Es día de trabajo para el puesto? Sin capacidad conocida se usa el calendario global. */
  isWorkingDay(puestoId: string | undefined, dayMs: number): boolean {
    const uh = this.unitHours(puestoId, dayMs);
    if (uh === undefined) return this.isGlobalWorkingDay(dayMs);
    return uh > 0;
  }

  /**
   * Diferencia con signo en días laborables (calendario global) entre dos instantes: b - a.
   * Mismo día = 0. Viernes -> lunes siguiente = 1.
   */
  workingDaysDiff(a: number, b: number): number {
    const ia = dayIndex(a);
    const ib = dayIndex(b);
    if (ia === ib) return 0;
    const sign = ib > ia ? 1 : -1;
    const from = Math.min(ia, ib);
    const to = Math.max(ia, ib);
    // días laborables en (from, to]: semanas completas + resto + festivos (cálculo O(1) + búsqueda binaria)
    const n = to - from;
    const full = Math.floor(n / 7);
    let count = full * this.working.size;
    for (let i = from + full * 7 + 1; i <= to; i++) if (this.working.has(isoWeekdayOfIndex(i))) count++;
    count -= upperBound(this.holidayIdx, to) - upperBound(this.holidayIdx, from);
    return count * sign;
  }

  /** Días laborables del puesto incluidos en [start, end]. */
  workingDaysIn(puestoId: string | undefined, start: number, end: number): number[] {
    const out: number[] = [];
    let d = startOfDay(start);
    const last = startOfDay(Math.max(start, end - 1));
    let guard = 0;
    while (d <= last && guard < 3000) {
      if (this.isWorkingDay(puestoId, d)) out.push(d);
      d = addDays(d, 1);
      guard++;
    }
    return out;
  }

  /**
   * Duración ESTIMADA a partir de fechas: suma, por día laborable, del tiempo del intervalo
   * contenido en el día, limitado a las horas por unidad del puesto (24 h si se desconocen).
   */
  estimateHoursFromDates(puestoId: string | undefined, start: number, end: number): number {
    if (end <= start) return 0;
    let total = 0;
    let d = startOfDay(start);
    let guard = 0;
    while (d < end && guard < 3000) {
      const next = addDays(d, 1);
      const overlap = (Math.min(end, next) - Math.max(start, d)) / HOUR;
      if (overlap > 0 && this.isWorkingDay(puestoId, d)) {
        const cap = this.unitHours(puestoId, d);
        total += Math.min(overlap, cap ?? 24);
      }
      d = addDays(d, 1);
      guard++;
    }
    return total;
  }
}

const DAY_MS = 86_400_000;

/** Índice de día independiente de la zona horaria (componentes locales tratados como UTC). */
function dayIndex(ms: number): number {
  const d = new Date(ms);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

/** Día ISO de la semana (1 = lunes) de un índice de día. El 01/01/1970 fue jueves. */
function isoWeekdayOfIndex(i: number): number {
  return ((((i + 3) % 7) + 7) % 7) + 1;
}

/** Número de elementos <= x en un array ordenado. */
function upperBound(arr: number[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

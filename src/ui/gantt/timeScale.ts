import { addDays, DAY, isoWeek, isoWeekday, monthName, pad, quarterOf, startOfDay, weekdayShort } from '../../lib/dates';

export type ScaleId = 'dia' | 'semana' | 'mes' | 'trimestre' | 'anio';

export const SCALES: Record<ScaleId, { label: string; pxPerDay: number }> = {
  dia: { label: 'Día', pxPerDay: 110 },
  semana: { label: 'Semana', pxPerDay: 28 },
  mes: { label: 'Mes', pxPerDay: 7 },
  trimestre: { label: 'Trimestre', pxPerDay: 2.4 },
  anio: { label: 'Año', pxPerDay: 0.75 },
};

export interface TimeScale {
  t0: number;
  t1: number;
  pxPerDay: number;
  width: number;
  x(ms: number): number;
  ms(x: number): number;
}

export function makeScale(t0: number, t1: number, pxPerDay: number): TimeScale {
  const width = Math.max(200, ((t1 - t0) / DAY) * pxPerDay);
  return {
    t0,
    t1,
    pxPerDay,
    width,
    x: (ms) => ((ms - t0) / DAY) * pxPerDay,
    ms: (x) => t0 + (x / pxPerDay) * DAY,
  };
}

export interface Tick {
  key: string;
  x: number;
  w: number;
  label: string;
  weekend?: boolean;
}

function startOfMonth(ms: number) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}
function addMonths(ms: number, n: number) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime();
}
function startOfIsoWeek(ms: number) {
  const d = startOfDay(ms);
  return addDays(d, -(isoWeekday(d) - 1));
}

/** Marcas de la cabecera (solo las del rango visible, para no pintar miles de elementos). */
export function buildTicks(scale: TimeScale, id: ScaleId, from: number, to: number): { top: Tick[]; bottom: Tick[] } {
  const top: Tick[] = [];
  const bottom: Tick[] = [];
  const lo = Math.max(scale.t0, from);
  const hi = Math.min(scale.t1, to);
  const push = (arr: Tick[], a: number, b: number, label: string, key: string, weekend?: boolean) => {
    const x = scale.x(a);
    arr.push({ key, x, w: scale.x(b) - x, label, weekend });
  };
  let guard = 0;
  if (id === 'dia') {
    for (let d = startOfDay(lo); d < hi && guard++ < 2000; d = addDays(d, 1)) {
      const dt = new Date(d);
      push(bottom, d, addDays(d, 1), `${weekdayShort(d)} ${dt.getDate()}`, `d${d}`, isoWeekday(d) > 5);
    }
    guard = 0;
    for (let w = startOfIsoWeek(lo); w < hi && guard++ < 400; w = addDays(w, 7)) {
      const iw = isoWeek(w);
      const dt = new Date(w);
      push(top, w, addDays(w, 7), `S${pad(iw.week)} ${iw.year} · ${dt.getDate()} ${monthName(dt.getMonth())}`, `w${w}`);
    }
  } else if (id === 'semana') {
    for (let w = startOfIsoWeek(lo); w < hi && guard++ < 1000; w = addDays(w, 7)) {
      push(bottom, w, addDays(w, 7), `S${pad(isoWeek(w).week)}`, `w${w}`);
    }
    guard = 0;
    for (let m = startOfMonth(lo); m < hi && guard++ < 400; m = addMonths(m, 1)) {
      const dt = new Date(m);
      push(top, m, addMonths(m, 1), `${monthName(dt.getMonth(), true)} ${dt.getFullYear()}`, `m${m}`);
    }
  } else if (id === 'mes') {
    for (let m = startOfMonth(lo); m < hi && guard++ < 1000; m = addMonths(m, 1)) {
      push(bottom, m, addMonths(m, 1), monthName(new Date(m).getMonth()), `m${m}`);
    }
    guard = 0;
    for (let y = new Date(new Date(lo).getFullYear(), 0, 1).getTime(); y < hi && guard++ < 100; y = new Date(new Date(y).getFullYear() + 1, 0, 1).getTime()) {
      push(top, y, new Date(new Date(y).getFullYear() + 1, 0, 1).getTime(), String(new Date(y).getFullYear()), `y${y}`);
    }
  } else if (id === 'trimestre') {
    for (let m = addMonths(startOfMonth(lo), -(new Date(lo).getMonth() % 3)); m < hi && guard++ < 400; m = addMonths(m, 3)) {
      push(bottom, m, addMonths(m, 3), `T${quarterOf(m)}`, `q${m}`);
    }
    guard = 0;
    for (let y = new Date(new Date(lo).getFullYear(), 0, 1).getTime(); y < hi && guard++ < 100; y = new Date(new Date(y).getFullYear() + 1, 0, 1).getTime()) {
      push(top, y, new Date(new Date(y).getFullYear() + 1, 0, 1).getTime(), String(new Date(y).getFullYear()), `y${y}`);
    }
  } else {
    for (let y = new Date(new Date(lo).getFullYear(), 0, 1).getTime(); y < hi && guard++ < 100; y = new Date(new Date(y).getFullYear() + 1, 0, 1).getTime()) {
      push(bottom, y, new Date(new Date(y).getFullYear() + 1, 0, 1).getTime(), String(new Date(y).getFullYear()), `y${y}`);
    }
  }
  return { top, bottom };
}

/** Días de fin de semana visibles (sombreado en escalas día/semana). */
export function weekendBands(scale: TimeScale, from: number, to: number): { x: number; w: number; key: string }[] {
  const out: { x: number; w: number; key: string }[] = [];
  let guard = 0;
  for (let d = startOfDay(Math.max(scale.t0, from)); d < Math.min(scale.t1, to) && guard++ < 3000; d = addDays(d, 1)) {
    if (isoWeekday(d) === 6) {
      const x = scale.x(d);
      out.push({ x, w: scale.x(addDays(d, 2)) - x, key: `we${d}` });
    }
  }
  return out;
}

/**
 * Utilidades de fecha. Todas las fechas se tratan como hora local "flotante":
 * lo que pone el Excel es lo que se muestra, sin conversiones de zona horaria.
 * Las semanas siguen la norma ISO 8601 (lunes como primer día; la semana 1 es la
 * que contiene el primer jueves del año). Por eso el año de la semana (año ISO) puede
 * diferir del año natural en los días cercanos al 1 de enero.
 */

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function addDays(ms: number, days: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, d.getHours(), d.getMinutes(), d.getSeconds()).getTime();
}

/** Clave de día 'YYYY-MM-DD' en hora local. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDayKey(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0');
}

/** Día de la semana ISO: 1 = lunes ... 7 = domingo. */
export function isoWeekday(ms: number): number {
  const wd = new Date(ms).getDay();
  return wd === 0 ? 7 : wd;
}

/** Año y número de semana ISO 8601. */
export function isoWeek(ms: number): { year: number; week: number } {
  const d = new Date(ms);
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / DAY + 1) / 7);
  return { year: date.getUTCFullYear(), week };
}

export function weekKey(ms: number): string {
  const { year, week } = isoWeek(ms);
  return `${year}-S${pad(week)}`;
}

export function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** Lunes 00:00 de la semana ISO indicada. */
export function isoWeekStart(year: number, week: number): number {
  const jan4 = new Date(year, 0, 4);
  const wd = jan4.getDay() || 7;
  const mondayW1 = new Date(year, 0, 4 - (wd - 1));
  return new Date(mondayW1.getFullYear(), mondayW1.getMonth(), mondayW1.getDate() + (week - 1) * 7).getTime();
}

export function weeksInIsoYear(year: number): number {
  // Un año ISO tiene 53 semanas si el 28 de diciembre cae en la semana 53.
  return isoWeek(new Date(year, 11, 28).getTime()).week;
}

export function weekKeyStart(key: string): number {
  const m = /^(\d{4})-S(\d{2})$/.exec(key);
  if (!m) return NaN;
  return isoWeekStart(Number(m[1]), Number(m[2]));
}

export function weekLabel(key: string): string {
  const m = /^(\d{4})-S(\d{2})$/.exec(key);
  return m ? `S${m[2]} ${m[1]}` : key;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const WEEKDAYS = ['lu', 'ma', 'mi', 'ju', 'vi', 'sá', 'do'];

export function monthName(m: number, long = false): string {
  return (long ? MONTHS_LONG : MONTHS)[m] ?? '';
}

export function weekdayShort(ms: number): string {
  return WEEKDAYS[isoWeekday(ms) - 1];
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${monthName(m - 1)} ${y}`;
}

export function fmtDate(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function fmtDateTime(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${fmtDate(ms)} ${hm}`;
}

/** ISO local sin zona ('2026-11-19T08:00:00'), para serializar fechas originales. */
export function toLocalIso(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function fromLocalIso(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (!m) return NaN;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)).getTime();
}

/**
 * Convierte una fecha devuelta por ExcelJS (que interpreta el número de serie de Excel como UTC)
 * a hora local flotante conservando los componentes que se ven en Excel.
 */
export function excelDateToLocal(d: Date): number {
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()).getTime();
}

/** Número de serie de Excel (sistema 1900) a hora local flotante. */
export function excelSerialToLocal(serial: number): number {
  const utc = Math.round((serial - 25569) * DAY);
  return excelDateToLocal(new Date(utc));
}

/** Itera las claves de día entre dos instantes (inclusive). */
export function eachDay(fromMs: number, toMs: number): number[] {
  const out: number[] = [];
  let d = startOfDay(fromMs);
  const end = startOfDay(toMs);
  let guard = 0;
  while (d <= end && guard < 20000) {
    out.push(d);
    d = addDays(d, 1);
    guard++;
  }
  return out;
}

export function quarterOf(ms: number): number {
  return Math.floor(new Date(ms).getMonth() / 3) + 1;
}

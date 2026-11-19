import type { EstadoCanonico, ParseOptions, RawCell } from '../domain/types';
import { excelSerialToLocal, fromLocalIso, toLocalIso } from '../lib/dates';
import { normalizeHeader } from '../lib/text';

/** Celda tal y como la entrega el lector (antes de serializar). */
export type GridCell = string | number | boolean | Date | null | { n: number; t: string };

export interface SheetGrid {
  name: string;
  /** Filas 0-based; rows[i] corresponde a la fila i+1 de Excel. */
  rows: GridCell[][];
}

export function toRawCell(c: GridCell | undefined): RawCell {
  if (c === undefined || c === null) return null;
  if (c instanceof Date) return { d: toLocalIso(c.getTime()) };
  return c;
}

export function isEmptyCell(c: RawCell | GridCell | undefined): boolean {
  if (c === null || c === undefined) return true;
  if (typeof c === 'string') return c.trim() === '';
  return false;
}

/** Texto visible de una celda (lo que vería el usuario en Excel). */
export function cellText(c: RawCell | undefined): string {
  if (c === null || c === undefined) return '';
  if (typeof c === 'string') return c;
  if (typeof c === 'number') return String(c);
  if (typeof c === 'boolean') return c ? 'VERDADERO' : 'FALSO';
  if ('d' in c) return c.d.replace('T00:00:00', '').replace('T', ' ');
  return c.t;
}

export interface ParseResult<T> {
  value?: T;
  error?: string;
  info?: string;
}

/**
 * Identificadores: siempre texto. Se conservan ceros iniciales, guiones y caracteres especiales.
 * Si en Excel el identificador está guardado como número sin formato, se avisa de que podrían
 * haberse perdido ceros iniciales (no se inventan).
 */
export function parseId(c: RawCell): ParseResult<string> {
  if (c === null || isEmptyCell(c)) return {};
  if (typeof c === 'string') return { value: c.trim() };
  if (typeof c === 'number') {
    return { value: String(c), info: 'Identificador almacenado como número en Excel: si el original tenía ceros a la izquierda, se habrían perdido en el propio Excel.' };
  }
  if (typeof c === 'boolean') return { value: String(c) };
  if ('t' in c) return { value: c.t.trim() };
  return { value: cellText(c) };
}

export function parseText(c: RawCell): ParseResult<string> {
  if (isEmptyCell(c)) return {};
  const t = cellText(c).trim();
  return t ? { value: t } : {};
}

const DATE_RE = /^(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{1,4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

/** Fechas: celdas de fecha de Excel, número de serie, o texto en el orden configurado. */
export function parseDate(c: RawCell, opts: ParseOptions): ParseResult<number> {
  if (isEmptyCell(c)) return {};
  if (typeof c === 'object' && c !== null && 'd' in c) {
    const ms = fromLocalIso(c.d);
    return Number.isFinite(ms) ? checkRange(ms) : { error: `Fecha no válida: ${c.d}` };
  }
  if (typeof c === 'number') {
    if (c > 20000 && c < 80000) return checkRange(excelSerialToLocal(c));
    return { error: `Número no interpretable como fecha: ${c}` };
  }
  if (typeof c === 'object' && c !== null && 'n' in c) return parseDate(c.n, opts);
  const s = String(c).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (iso) return build(+iso[1], +iso[2], +iso[3], +(iso[4] ?? 0), +(iso[5] ?? 0), +(iso[6] ?? 0), s);
  const m = DATE_RE.exec(s);
  if (!m) return { error: `Texto no interpretable como fecha: "${s}"` };
  const [a, b, cc] = [m[1], m[2], m[3]];
  const hh = +(m[4] ?? 0);
  const mi = +(m[5] ?? 0);
  const ss = +(m[6] ?? 0);
  let y: number, mo: number, d: number;
  if (a.length === 4 || opts.dateOrder === 'YMD') {
    y = +a;
    mo = +b;
    d = +cc;
  } else if (opts.dateOrder === 'MDY') {
    mo = +a;
    d = +b;
    y = +cc;
  } else {
    d = +a;
    mo = +b;
    y = +cc;
  }
  if (y < 100) y += 2000;
  return build(y, mo, d, hh, mi, ss, s);
}

function build(y: number, mo: number, d: number, hh: number, mi: number, ss: number, original: string): ParseResult<number> {
  const date = new Date(y, mo - 1, d, hh, mi, ss);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d || hh > 23 || mi > 59) {
    return { error: `Fecha inexistente: "${original}"` };
  }
  return checkRange(date.getTime());
}

function checkRange(ms: number): ParseResult<number> {
  const y = new Date(ms).getFullYear();
  if (y < 2000 || y > 2100) return { value: ms, info: `Año fuera del rango habitual (${y}).` };
  return { value: ms };
}

/** Números con separador decimal configurable ("1.234,5" o "1,234.5"). */
export function parseNumber(c: RawCell, opts: ParseOptions): ParseResult<number> {
  if (isEmptyCell(c)) return {};
  if (typeof c === 'number') return { value: c };
  if (typeof c === 'object' && c !== null && 'n' in c) return { value: c.n };
  if (typeof c === 'boolean') return { error: 'Valor lógico donde se esperaba un número' };
  let s = cellText(c).trim().replace(/\s/g, '');
  if (!s) return {};
  const sep = opts.decimalSeparator;
  if (sep === ',') s = s.replace(/\./g, '').replace(',', '.');
  else if (sep === '.') s = s.replace(/,/g, '');
  else {
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma >= 0 && lastDot >= 0) {
      s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (lastComma >= 0) s = s.replace(',', '.');
  }
  if (!/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return { error: `No es un número: "${cellText(c)}"` };
  return { value: Number(s) };
}

/** Duración normalizada a horas. Acepta número en la unidad configurada o "hh:mm". */
export function parseDuration(c: RawCell, opts: ParseOptions): ParseResult<number> {
  if (isEmptyCell(c)) return {};
  if (typeof c === 'object' && c !== null && 'd' in c) {
    // Celda con formato de hora en Excel (fracción de día anclada en 1899-12-30/31).
    const m = /T(\d{2}):(\d{2}):(\d{2})/.exec(c.d);
    if (m && /^1899-12-3[01]|^1900-01-0/.test(c.d)) return { value: +m[1] + +m[2] / 60 + +m[3] / 3600 };
    return { error: `Fecha donde se esperaba una duración: ${c.d}` };
  }
  const text = cellText(c).trim();
  const hm = /^(\d{1,4}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (hm) return { value: +hm[1] + +hm[2] / 60 + +(hm[3] ?? 0) / 3600 };
  const n = parseNumber(c, opts);
  if (n.value === undefined) return n;
  const factor = opts.durationUnit === 'min' ? 1 / 60 : opts.durationUnit === 's' ? 1 / 3600 : 1;
  const hours = n.value * factor;
  if (hours < 0) return { value: hours, error: 'Duración negativa' };
  return { value: hours };
}

export function parseState(c: RawCell, stateMap: Record<string, EstadoCanonico>): ParseResult<{ raw: string; canon: EstadoCanonico }> {
  const t = parseText(c).value;
  if (!t) return {};
  const key = normalizeHeader(t);
  const canon = stateMap[key];
  if (canon) return { value: { raw: t, canon } };
  return { value: { raw: t, canon: 'desconocido' }, info: `Estado "${t}" sin equivalencia configurada.` };
}

export function parsePriority(c: RawCell, opts: ParseOptions, textMap: Record<string, number>): ParseResult<{ raw: string; value?: number }> {
  if (isEmptyCell(c)) return {};
  const raw = cellText(c).trim();
  const n = parseNumber(c, opts);
  if (n.value !== undefined) return { value: { raw, value: n.value } };
  const mapped = textMap[normalizeHeader(raw)];
  if (mapped !== undefined) return { value: { raw, value: mapped } };
  return { value: { raw }, info: `Prioridad "${raw}" no interpretable numéricamente: se conserva el texto original.` };
}

/** Plausibilidad de una columna para un tipo de campo (0-1), usada para afinar sugerencias. */
export function typePlausibility(samples: RawCell[], type: string, opts: ParseOptions): number {
  const vals = samples.filter((s) => !isEmptyCell(s)).slice(0, 25);
  if (!vals.length) return 0.5;
  let ok = 0;
  for (const v of vals) {
    if (type === 'date') ok += parseDate(v, opts).value !== undefined && !(typeof v === 'number' && v < 20000) ? 1 : 0;
    else if (type === 'number' || type === 'duration') ok += parseDuration(v, opts).value !== undefined ? 1 : 0;
    else ok += 1;
  }
  return ok / vals.length;
}

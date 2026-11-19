import type { GridCell, SheetGrid } from './values';
import { isEmptyCell } from './values';

export interface HeaderDetection {
  /** Índice 0-based de la fila de cabecera en la rejilla. */
  index: number;
  confidence: 'alta' | 'media' | 'baja';
  reason: string;
}

const SCAN_ROWS = 30;

function isTextLike(c: GridCell): boolean {
  if (typeof c !== 'string') return false;
  const s = c.trim();
  if (!s) return false;
  // textos que parecen fechas o números no cuentan como cabecera
  if (/^[-+]?\d+([.,]\d+)?$/.test(s)) return false;
  if (/^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}/.test(s)) return false;
  return true;
}

/**
 * Detecta la fila de cabecera: la fila (entre las primeras 30) con más celdas de texto distintas,
 * con cobertura suficiente respecto al ancho de los datos y seguida de filas de datos.
 * El usuario siempre puede cambiarla en el asistente.
 */
export function detectHeaderRow(grid: SheetGrid): HeaderDetection {
  const rows = grid.rows;
  if (!rows.length) return { index: 0, confidence: 'baja', reason: 'Hoja vacía' };
  const n = Math.min(rows.length, SCAN_ROWS);
  const width = Math.max(...rows.slice(0, Math.min(rows.length, 200)).map((r) => r.filter((c) => !isEmptyCell(c)).length), 1);
  let best = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < n; i++) {
    const r = rows[i] ?? [];
    const nonEmpty = r.filter((c) => !isEmptyCell(c));
    if (nonEmpty.length < Math.max(2, Math.ceil(width * 0.5))) continue;
    const texts = nonEmpty.filter(isTextLike);
    const distinct = new Set(texts.map((t) => String(t).trim().toLowerCase())).size;
    const textRatio = texts.length / nonEmpty.length;
    // la siguiente fila no vacía debe parecer datos (menos texto puro o tipos mezclados)
    let next = i + 1;
    while (next < rows.length && (rows[next] ?? []).every((c) => isEmptyCell(c))) next++;
    const nextRow = rows[next] ?? [];
    const nextTextRatio = nextRow.length ? nextRow.filter(isTextLike).length / Math.max(1, nextRow.filter((c) => !isEmptyCell(c)).length) : 0;
    const score = distinct + textRatio * 5 + (nextRow.length ? (1 - nextTextRatio) * 3 : -5) + (nonEmpty.length / width) * 3 - i * 0.05;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best < 0) return { index: 0, confidence: 'baja', reason: 'No se ha encontrado una fila con aspecto de cabecera; se usa la primera.' };
  const r = rows[best];
  const nonEmpty = r.filter((c) => !isEmptyCell(c));
  const textRatio = nonEmpty.filter(isTextLike).length / nonEmpty.length;
  const confidence = textRatio > 0.9 && nonEmpty.length >= Math.min(width, 3) ? 'alta' : textRatio > 0.6 ? 'media' : 'baja';
  return {
    index: best,
    confidence,
    reason: best === 0 ? 'Primera fila con textos de cabecera.' : `Fila ${best + 1}: las filas anteriores parecen títulos o están vacías.`,
  };
}

/** Cabeceras de la fila indicada; columnas sin nombre reciben "Columna N" (sin perder su posición). */
export function headersAt(grid: SheetGrid, index: number): string[] {
  const row = grid.rows[index] ?? [];
  const width = Math.max(row.length, ...grid.rows.slice(index + 1, index + 50).map((r) => r.length));
  const out: string[] = [];
  const seen = new Map<string, number>();
  for (let c = 0; c < width; c++) {
    const v = row[c];
    let h = isEmptyCell(v) ? `Columna ${columnLetter(c)}` : String(v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'object' && v && 't' in v ? v.t : v).trim();
    const k = h.toLowerCase();
    const count = seen.get(k) ?? 0;
    seen.set(k, count + 1);
    if (count) h = `${h} (${count + 1})`;
    out.push(h);
  }
  return out;
}

export function columnLetter(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

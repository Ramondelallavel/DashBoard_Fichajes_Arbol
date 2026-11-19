import Papa from 'papaparse';
import type { GridCell, SheetGrid } from './values';
import { checkFile, MAX_COLUMNS, MAX_ROWS_PER_SHEET, type FileCheck } from './fileSecurity';
import { excelDateToLocal } from '../lib/dates';

export interface WorkbookData {
  sheets: SheetGrid[];
  warnings: string[];
  check: FileCheck;
}

export class ImportFileError extends Error {}

/** Lee un archivo (xlsx/xlsm/csv) y devuelve una rejilla de valores por hoja. */
export async function readWorkbook(name: string, data: ArrayBuffer): Promise<WorkbookData> {
  const head = new Uint8Array(data.slice(0, 4096));
  const check = checkFile(name, data.byteLength, head);
  if (!check.ok || !check.format) throw new ImportFileError(check.error ?? 'Archivo no válido');
  const warnings = [...check.warnings];
  const sheets = check.format === 'xlsx' ? await readXlsx(data, warnings) : readCsv(data, name, warnings);
  if (!sheets.length) throw new ImportFileError('El archivo no contiene hojas con datos.');
  return { sheets, warnings, check };
}

const ZERO_PAD_FMT = /^0+$/;

async function readXlsx(data: ArrayBuffer, warnings: string[]): Promise<SheetGrid[]> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data);
  } catch (e) {
    throw new ImportFileError(`No se pudo leer el libro Excel: ${(e as Error).message}. Compruebe que no está cifrado ni dañado.`);
  }
  const out: SheetGrid[] = [];
  let formulaWithoutResult = 0;
  wb.eachSheet((ws) => {
    if (ws.state && ws.state !== 'visible') warnings.push(`La hoja "${ws.name}" está oculta en Excel; se muestra igualmente para que decida si importarla.`);
    const rows: GridCell[][] = [];
    const rowCount = Math.min(ws.rowCount, MAX_ROWS_PER_SHEET);
    if (ws.rowCount > MAX_ROWS_PER_SHEET) warnings.push(`La hoja "${ws.name}" supera ${MAX_ROWS_PER_SHEET} filas; se han leído las primeras.`);
    const colCount = Math.min(ws.columnCount, MAX_COLUMNS);
    for (let r = 1; r <= rowCount; r++) {
      const row = ws.getRow(r);
      // row.values es un array 1-based (posición 0 sin uso); es mucho más rápido que getCell por celda.
      const vals = (row.values ?? []) as unknown[];
      const cells: GridCell[] = [];
      const lim = Math.min(vals.length - 1, colCount);
      for (let c = 1; c <= lim; c++) {
        const raw = vals[c];
        const numFmt = typeof raw === 'number' ? row.getCell(c).numFmt : undefined;
        const v = convertCell(raw, numFmt);
        if (v === FORMULA_NO_RESULT) {
          formulaWithoutResult++;
          cells.push(null);
        } else cells.push(v);
      }
      // recortar celdas vacías al final
      let last = cells.length - 1;
      while (last >= 0 && (cells[last] === null || cells[last] === '')) last--;
      rows.push(cells.slice(0, last + 1));
    }
    while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
    out.push({ name: ws.name, rows });
  });
  if (formulaWithoutResult) {
    warnings.push(`${formulaWithoutResult} celdas con fórmula no tienen resultado guardado en el archivo y se han dejado vacías (las fórmulas no se evalúan).`);
  }
  return out;
}

const FORMULA_NO_RESULT = Symbol('formula-no-result');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertCell(value: any, numFmt: string | undefined): GridCell | typeof FORMULA_NO_RESULT {
  if (value === null || value === undefined) return null;
  // ExcelJS entrega las fechas con los componentes de Excel en UTC: se pasan a hora local flotante.
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? new Date(excelDateToLocal(value)) : null;
  if (typeof value === 'number') {
    if (numFmt && ZERO_PAD_FMT.test(numFmt) && Number.isInteger(value)) {
      const t = String(value).padStart(numFmt.length, '0');
      return t !== String(value) ? { n: value, t } : value;
    }
    return value;
  }
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((p: { text: string }) => p.text).join('');
    if ('formula' in value || 'sharedFormula' in value) {
      if (value.result === undefined || value.result === null) return FORMULA_NO_RESULT;
      if (typeof value.result === 'object' && 'error' in value.result) return String(value.result.error);
      return convertCell(value.result, numFmt);
    }
    if ('hyperlink' in value) return String(value.text ?? '');
    if ('error' in value) return String(value.error);
    if ('text' in value) return String(value.text);
  }
  return String(value);
}

function decodeText(data: ArrayBuffer, warnings: string[]): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/^﻿/, '');
  } catch {
    warnings.push('El CSV no está en UTF-8; se ha leído como Windows-1252 (habitual en Excel en español).');
    return new TextDecoder('windows-1252').decode(data);
  }
}

function readCsv(data: ArrayBuffer, name: string, warnings: string[]): SheetGrid[] {
  const text = decodeText(data, warnings);
  const parsed = Papa.parse<string[]>(text, { delimiter: '', skipEmptyLines: false });
  if (parsed.errors.length) {
    const first = parsed.errors.slice(0, 3).map((e) => `fila ${(e.row ?? 0) + 1}: ${e.message}`);
    warnings.push(`Avisos de lectura CSV: ${first.join('; ')}`);
  }
  let rows = (parsed.data as string[][]).slice(0, MAX_ROWS_PER_SHEET).map((r) => r.slice(0, MAX_COLUMNS) as GridCell[]);
  while (rows.length && rows[rows.length - 1].every((c) => c === '' || c === null)) rows = rows.slice(0, -1);
  return [{ name: name.replace(/\.[^.]+$/, ''), rows }];
}

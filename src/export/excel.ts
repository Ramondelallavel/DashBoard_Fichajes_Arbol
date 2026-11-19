import type { GridCell, SheetGrid } from '../import/values';

export type ColType = 'text' | 'date' | 'datetime' | 'number' | 'hours' | 'pct';

export interface ExportColumn<T> {
  header: string;
  value: (row: T) => unknown;
  width?: number;
  type?: ColType;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ExportSheet<T = any> {
  name: string;
  columns: ExportColumn<T>[];
  rows: T[];
}

export interface ExportMeta {
  title: string;
  generatedAt: Date;
  user: string;
  /** Versiones de datos utilizadas (p. ej. "Producción v3 · plan.xlsx · 19/11/2026 08:12"). */
  versions: string[];
  /** Filtros activos en pantalla en el momento de exportar. */
  filters: string[];
  notes?: string[];
}

/**
 * ExcelJS convierte las fechas a número de serie usando UTC. Para que Excel muestre la misma hora
 * local que la aplicación, se pasa una fecha "UTC" con los componentes locales.
 */
export function localToExcelDate(ms: number): Date {
  const d = new Date(ms);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()));
}

const NUMFMT: Partial<Record<ColType, string>> = {
  date: 'dd/mm/yyyy',
  datetime: 'dd/mm/yyyy hh:mm',
  number: '#,##0.##',
  hours: '#,##0.0" h"',
  pct: '0%',
};

function sanitizeSheetName(name: string, used: Set<string>): string {
  let n = name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || 'Hoja';
  let i = 2;
  while (used.has(n.toLowerCase())) n = `${n.slice(0, 28)} ${i++}`;
  used.add(n.toLowerCase());
  return n;
}

/** Evita la inyección de fórmulas al abrir el informe en Excel (=, +, -, @ al inicio de un texto). */
function safeText(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

export async function buildWorkbook(sheets: ExportSheet[], meta?: ExportMeta): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Planificación industrial';
  wb.created = meta?.generatedAt ?? new Date();
  const used = new Set<string>();
  if (meta) {
    const ws = wb.addWorksheet(sanitizeSheetName('Informe', used));
    ws.columns = [{ width: 28 }, { width: 90 }];
    ws.addRow([meta.title]).font = { bold: true, size: 14 };
    ws.addRow([]);
    ws.addRow(['Generado', localToExcelDate(meta.generatedAt.getTime())]).getCell(2).numFmt = 'dd/mm/yyyy hh:mm';
    ws.addRow(['Usuario', meta.user]);
    meta.versions.forEach((v, i) => ws.addRow([i === 0 ? 'Versión de los datos' : '', v]));
    if (!meta.versions.length) ws.addRow(['Versión de los datos', 'Sin datos importados']);
    if (meta.filters.length) meta.filters.forEach((f, i) => ws.addRow([i === 0 ? 'Filtros aplicados' : '', f]));
    else ws.addRow(['Filtros aplicados', 'Ninguno: se exporta toda la información']);
    for (const n of meta.notes ?? []) ws.addRow(['Nota', n]);
    ws.getColumn(1).font = { bold: true };
  }
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sanitizeSheetName(sheet.name, used), { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = sheet.columns.map((c) => ({ header: c.header, width: c.width ?? Math.min(48, Math.max(10, c.header.length + 2)) }));
    const header = ws.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2B3A4A' } };
    for (const row of sheet.rows) {
      const values = sheet.columns.map((c) => {
        const v = c.value(row);
        if (v === undefined || v === null || (typeof v === 'number' && !Number.isFinite(v))) return null;
        if ((c.type === 'date' || c.type === 'datetime') && typeof v === 'number') return localToExcelDate(v);
        if (typeof v === 'string') return safeText(v);
        return v as string | number | boolean;
      });
      ws.addRow(values);
    }
    sheet.columns.forEach((c, i) => {
      const fmt = c.type ? NUMFMT[c.type] : undefined;
      if (fmt) ws.getColumn(i + 1).numFmt = fmt;
    });
    if (sheet.columns.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rows.length + 1), column: sheet.columns.length } };
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/** Escribe rejillas tal cual (para los Excel ficticios de ejemplo). Los textos se escriben como texto. */
export async function gridsToXlsx(grids: SheetGrid[]): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  for (const g of grids) {
    const ws = wb.addWorksheet(g.name);
    g.rows.forEach((r) => {
      const row = ws.addRow(r.map((c: GridCell) => (c instanceof Date ? localToExcelDate(c.getTime()) : c && typeof c === 'object' && 'n' in c ? c.n : c)));
      r.forEach((c, i) => {
        if (c instanceof Date) row.getCell(i + 1).numFmt = c.getHours() || c.getMinutes() ? 'dd/mm/yyyy hh:mm' : 'dd/mm/yyyy';
      });
    });
    ws.columns.forEach((col) => (col.width = 16));
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

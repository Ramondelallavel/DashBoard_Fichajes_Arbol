import { describe, expect, it } from 'vitest';
import { detectHeaderRow, headersAt } from '../src/import/header';
import { findProfile, suggestMapping, validateMapping } from '../src/import/mapping';
import { normalizeImport } from '../src/import/normalize';
import { buildProfile, DEFAULT_PARSE_OPTIONS as O } from '../src/import/pipeline';
import { checkFile } from '../src/import/fileSecurity';
import type { SheetGrid } from '../src/import/values';
import type { ProdRecord } from '../src/domain/types';
import { settingsWith } from './helpers';

const grid: SheetGrid = {
  name: 'Hoja1',
  rows: [
    ['Listado de fabricación'],
    [],
    ['N.º Aparato', 'Nº OF', 'Op.', 'Puesto Trab.', 'F. Inicio Prev.', 'F. Fin Prev.', 'Tiempo (h)', 'Columna rara'],
    [10001, '0050001', '0010', '05', '19/11/2026 07:00', '19/11/2026 11:00', 4, 'x'],
    [10001, '0050001', '0020', '06', '19/11/2026 11:00', '19/11/2026 15:00', 4, 'y'],
    [10001, '0050001', '0020', '06', '19/11/2026 11:00', '19/11/2026 15:00', 4, 'y'],
    [10002, '0050002', '0010', '05', '19/11/2026 07:00', '31/02/2026', 3, ''],
    [10002, '0050002', '0010', '04', '20/11/2026 07:00', '20/11/2026 10:00', 3, ''],
    [null, null, '0010', '05', '19/11/2026 07:00', '19/11/2026 09:00', 2, ''],
    [10003, '0050003', '0010', null, '25/11/2026 07:00', '24/11/2026 09:00', 2, ''],
  ],
};

describe('Asistente de importación', () => {
  it('detecta la fila de cabecera aunque haya títulos encima', () => {
    const h = detectHeaderRow(grid);
    expect(h.index).toBe(2);
    expect(headersAt(grid, h.index)[0]).toBe('N.º Aparato');
  });
  it('propone correspondencias de columnas sin presuponer nombres exactos', () => {
    const headers = headersAt(grid, 2);
    const s = suggestMapping(headers, [], 'produccion', 'filas', O);
    const byHeader = Object.fromEntries(s.map((x) => [x.header, x.field]));
    expect(byHeader['N.º Aparato']).toBe('aparatoId');
    expect(byHeader['Nº OF']).toBe('ordenId');
    expect(byHeader['Op.']).toBe('operacionId');
    expect(byHeader['Puesto Trab.']).toBe('puestoId');
    expect(byHeader['F. Inicio Prev.']).toBe('inicioPrevisto');
    expect(byHeader['F. Fin Prev.']).toBe('finPrevisto');
    expect(byHeader['Tiempo (h)']).toBe('duracion');
    expect(byHeader['Columna rara']).toBeUndefined();
  });
  it('valida campos obligatorios y asignaciones duplicadas', () => {
    expect(validateMapping('produccion', 'filas', ['a', 'b'], { 0: 'aparatoId' }).errors[0]).toMatch(/orden/);
    expect(validateMapping('produccion', 'filas', ['a', 'b'], { 0: 'ordenId', 1: 'ordenId' }).errors[0]).toMatch(/2 columnas/);
    expect(validateMapping('ortems', 'filas', ['a'], { 0: 'preordenId' }).ok).toBe(true);
  });
  it('recuerda la configuración: un perfil guardado se reconoce por la firma de cabeceras', () => {
    const headers = ['Equipo X', 'Código OF', 'Paso'];
    const p = buildProfile('Mi ERP', 'produccion', 'filas', headers, { 0: 'aparatoId', 1: 'ordenId', 2: 'operacionId' }, O);
    expect(findProfile([p], 'produccion', 'filas', ['Equipo X', 'Código OF', 'Paso'])?.name).toBe('Mi ERP');
    const s = suggestMapping(headers, [], 'produccion', 'filas', O, p);
    expect(s.map((x) => x.field)).toEqual(['aparatoId', 'ordenId', 'operacionId']);
  });
  it('normaliza, detecta duplicados, registros incompletos y columnas desconocidas', () => {
    const res = normalizeImport({
      kind: 'produccion',
      batchId: 'b1',
      sheets: [{ grid, config: { sheet: 'Hoja1', role: 'filas', headerRow: 3, mapping: { 0: 'aparatoId', 1: 'ordenId', 2: 'operacionId', 3: 'puestoId', 4: 'inicioPrevisto', 5: 'finPrevisto', 6: 'duracion' } } }],
      options: O,
      settings: settingsWith(),
    });
    expect(res.counts.total).toBe(7);
    expect(res.counts.rechazado).toBe(2); // fila sin orden + duplicado exacto
    const codes = res.issueStats.map((s) => s.code);
    expect(codes).toEqual(expect.arrayContaining(['DUPLICADO_EXACTO', 'CLAVE_DUPLICADA', 'FECHA_INVALIDA', 'FALTA_ORDEN', 'FALTA_PUESTO', 'INICIO_POSTERIOR_FIN']));
    expect(res.unknownColumns).toEqual(['Hoja1 › Columna rara']);
    const first = res.records[0] as ProdRecord;
    expect(first.ordenId).toBe('0050001');
    expect(first.puestoId).toBe('05');
    expect(first.src).toEqual({ batchId: 'b1', sheet: 'Hoja1', row: 4 });
    // los valores originales se conservan íntegros en la capa de datos originales
    expect(res.rawSheets[0].rows[0].cells[1]).toBe('0050001');
    expect(res.columnNotes[0].message).toMatch(/número/);
  });
  it('enriquece con hojas complementarias sin sobrescribir y avisa de discrepancias', () => {
    const ops: SheetGrid = { name: 'Ops', rows: [['OF', 'Puesto', 'Sección'], ['1', '05', null], ['2', '06', 'Pintura B']] };
    const pts: SheetGrid = { name: 'Puestos', rows: [['Puesto', 'Sección'], ['05', 'Mecanizado'], ['06', 'Pintura']] };
    const res = normalizeImport({
      kind: 'produccion',
      batchId: 'b2',
      sheets: [
        { grid: ops, config: { sheet: 'Ops', role: 'filas', headerRow: 1, mapping: { 0: 'ordenId', 1: 'puestoId', 2: 'seccion' } } },
        { grid: pts, config: { sheet: 'Puestos', role: 'puestos', headerRow: 1, mapping: { 0: 'puestoId', 1: 'seccion' } } },
      ],
      options: O,
      settings: settingsWith(),
    });
    const [a, b] = res.records as ProdRecord[];
    expect(a.seccion).toBe('Mecanizado');
    expect(a.enriched?.[0].from.sheet).toBe('Puestos');
    expect(b.seccion).toBe('Pintura B');
    expect(b.issues.some((i) => i.code === 'VALOR_DISCREPANTE_HOJAS')).toBe(true);
    expect(res.masters).toHaveLength(2);
  });
  it('valida el archivo antes de procesarlo (extensión, firma binaria, tamaño)', () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]);
    expect(checkFile('a.xlsx', 10, zip).ok).toBe(true);
    expect(checkFile('a.xlsm', 10, zip).warnings[0]).toMatch(/macros/);
    expect(checkFile('a.xls', 10, ole).ok).toBe(false);
    expect(checkFile('a.xlsx', 10, ole).ok).toBe(false);
    expect(checkFile('a.xlsx', 10, new Uint8Array([1, 2, 3, 4])).ok).toBe(false);
    expect(checkFile('a.exe', 10, zip).ok).toBe(false);
    expect(checkFile('a.csv', 10, new TextEncoder().encode('a;b')).format).toBe('csv');
    expect(checkFile('a.csv', 10, zip).ok).toBe(false);
  });
});

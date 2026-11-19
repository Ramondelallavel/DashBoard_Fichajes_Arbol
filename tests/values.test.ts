import { describe, expect, it } from 'vitest';
import { parseDate, parseDuration, parseId, parseNumber, parsePriority, parseState } from '../src/import/values';
import { DEFAULT_PARSE_OPTIONS as O } from '../src/import/pipeline';
import { DEFAULT_STATE_MAP } from '../src/domain/settings';
import { D } from './helpers';

describe('Interpretación de valores', () => {
  it('preserva identificadores: ceros iniciales, guiones y formato de número con ceros', () => {
    expect(parseId('0050001').value).toBe('0050001');
    expect(parseId(' PT-05 ').value).toBe('PT-05');
    expect(parseId({ n: 123, t: '00123' }).value).toBe('00123');
    const num = parseId(10001);
    expect(num.value).toBe('10001');
    expect(num.info).toMatch(/número/);
    expect(parseId(null).value).toBeUndefined();
  });
  it('interpreta fechas en formato español, ISO y número de serie, y rechaza fechas inexistentes', () => {
    expect(parseDate('19/11/2026 07:30', O).value).toBe(D(2026, 11, 19, 7, 30));
    expect(parseDate('2026-11-19', O).value).toBe(D(2026, 11, 19));
    expect(parseDate({ d: '2026-11-19T08:00:00' }, O).value).toBe(D(2026, 11, 19, 8));
    expect(parseDate(46345, O).value).toBe(D(2026, 11, 19));
    expect(parseDate('31/02/2026', O).error).toMatch(/inexistente/);
    expect(parseDate('mañana', O).error).toBeDefined();
    expect(parseDate('11/19/2026', { ...O, dateOrder: 'MDY' }).value).toBe(D(2026, 11, 19));
  });
  it('números con coma o punto decimal y duraciones en varias unidades', () => {
    expect(parseNumber('1.234,5', O).value).toBe(1234.5);
    expect(parseNumber('1,234.5', O).value).toBe(1234.5);
    expect(parseNumber('2,5', O).value).toBe(2.5);
    expect(parseNumber('abc', O).error).toBeDefined();
    expect(parseDuration('1:30', O).value).toBe(1.5);
    expect(parseDuration(90, { ...O, durationUnit: 'min' }).value).toBe(1.5);
    expect(parseDuration(-2, O).error).toMatch(/negativa/);
  });
  it('estados y prioridades conservan el texto original', () => {
    expect(parseState('Finalizada', DEFAULT_STATE_MAP).value).toEqual({ raw: 'Finalizada', canon: 'terminada' });
    expect(parseState('Raro', DEFAULT_STATE_MAP).value?.canon).toBe('desconocido');
    expect(parsePriority('Alta', O, { alta: 2 }).value).toEqual({ raw: 'Alta', value: 2 });
    expect(parsePriority('3', O, {}).value).toEqual({ raw: '3', value: 3 });
    expect(parsePriority('XYZ', O, {}).info).toBeDefined();
  });
});

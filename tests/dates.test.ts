import { describe, expect, it } from 'vitest';
import { isoWeek, isoWeekStart, weekKey, weeksInIsoYear } from '../src/lib/dates';
import { CapacityCalendar } from '../src/engine/calendar';
import { D, settingsWith } from './helpers';

describe('Semanas ISO 8601', () => {
  it('asigna el año ISO correcto alrededor del cambio de año', () => {
    expect(isoWeek(D(2026, 12, 31))).toEqual({ year: 2026, week: 53 });
    expect(isoWeek(D(2027, 1, 1))).toEqual({ year: 2026, week: 53 });
    expect(isoWeek(D(2027, 1, 4))).toEqual({ year: 2027, week: 1 });
    expect(isoWeek(D(2021, 1, 3))).toEqual({ year: 2020, week: 53 });
    expect(isoWeek(D(2024, 12, 30))).toEqual({ year: 2025, week: 1 });
    expect(weekKey(D(2026, 11, 19))).toBe('2026-S47');
  });
  it('calcula el lunes de una semana ISO y el número de semanas del año', () => {
    expect(new Date(isoWeekStart(2026, 47)).toDateString()).toBe(new Date(2026, 10, 16).toDateString());
    expect(new Date(isoWeekStart(2027, 1)).toDateString()).toBe(new Date(2027, 0, 4).toDateString());
    expect(weeksInIsoYear(2026)).toBe(53);
    expect(weeksInIsoYear(2027)).toBe(52);
  });
});

describe('Calendario laboral y capacidad', () => {
  const cal = new CapacityCalendar(
    settingsWith({
      calendar: { workingWeekdays: [1, 2, 3, 4, 5], holidays: ['2026-12-08'] },
      capacities: {
        '05': { puestoId: '05', hoursPerWeekday: { 1: 8, 2: 8, 3: 8, 4: 8, 5: 8 }, units: 2, efficiency: 0.9, stops: [{ from: '2026-11-30', to: '2026-11-30' }], specialDays: [{ date: '2026-12-04', hours: 4 }] },
      },
    }),
  );
  it('diferencia en días laborables con signo', () => {
    expect(cal.workingDaysDiff(D(2026, 11, 20), D(2026, 11, 23))).toBe(1); // viernes -> lunes
    expect(cal.workingDaysDiff(D(2026, 11, 23), D(2026, 11, 20))).toBe(-1);
    expect(cal.workingDaysDiff(D(2026, 12, 7), D(2026, 12, 9))).toBe(1); // 8 de diciembre festivo
    expect(cal.workingDaysDiff(D(2026, 11, 19, 8), D(2026, 11, 19, 17))).toBe(0);
  });
  it('capacidad = horas × unidades × eficiencia, con paradas, festivos y horarios especiales', () => {
    expect(cal.capacityHours('05', D(2026, 11, 19)).hours).toBeCloseTo(14.4);
    expect(cal.capacityHours('05', D(2026, 11, 30)).hours).toBe(0); // parada
    expect(cal.capacityHours('05', D(2026, 12, 8)).hours).toBe(0); // festivo
    expect(cal.capacityHours('05', D(2026, 12, 4)).hours).toBeCloseTo(7.2); // horario especial 4 h
    expect(cal.capacityHours('05', D(2026, 11, 21)).hours).toBe(0); // sábado
    expect(cal.capacityHours('99', D(2026, 11, 19))).toEqual({ source: 'desconocida' });
  });
  it('sin capacidad configurada no inventa capacidad salvo que se active la capacidad supuesta', () => {
    const c2 = new CapacityCalendar(settingsWith({ assumedCapacity: { enabled: true, hoursPerDay: 7, units: 1 } }));
    expect(c2.capacityHours('99', D(2026, 11, 19))).toEqual({ hours: 7, source: 'supuesta' });
  });
});

describe('Días laborables: cálculo rápido equivalente al recuento día a día', () => {
  it('coincide con el recuento ingenuo en 2.000 pares aleatorios con festivos', () => {
    const hol = ['2026-12-08', '2026-12-25', '2027-01-01', '2027-01-06', '2027-05-01'];
    const cal = new CapacityCalendar(settingsWith({ calendar: { workingWeekdays: [1, 2, 3, 4, 6], holidays: hol } }));
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 2000; k++) {
      const a = D(2026, 1, 1) + Math.floor(rnd() * 600) * 86_400_000 + Math.floor(rnd() * 24) * 3_600_000;
      const b = D(2026, 1, 1) + Math.floor(rnd() * 600) * 86_400_000 + Math.floor(rnd() * 24) * 3_600_000;
      // recuento ingenuo
      const step = (x: number) => new Date(new Date(x).getFullYear(), new Date(x).getMonth(), new Date(x).getDate() + 1).getTime();
      const sod = (x: number) => new Date(new Date(x).getFullYear(), new Date(x).getMonth(), new Date(x).getDate()).getTime();
      let from = Math.min(sod(a), sod(b));
      const to = Math.max(sod(a), sod(b));
      let n = 0;
      while (from < to) {
        from = step(from);
        if (cal.isGlobalWorkingDay(from)) n++;
      }
      expect(cal.workingDaysDiff(a, b)).toBe(sod(b) >= sod(a) ? n : -n);
    }
  });
});

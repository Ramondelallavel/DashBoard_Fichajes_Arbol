/**
 * Generador de datos FICTICIOS para demostración y pruebas.
 * Ningún dato procede de una fábrica real. Es determinista (semilla) para que las pruebas sean reproducibles.
 *
 * Simula una situación realista:
 *  - El Excel de producción procede de una planificación a capacidad infinita (tipo ERP/MRP):
 *    por eso aparecen solapamientos y semanas sobrecargadas.
 *  - El Excel de Ortems procede de una planificación a capacidad finita por prioridad (tipo APS):
 *    sus fechas se retrasan en los puestos congestionados y reordena por prioridad.
 *  - Se inyectan anomalías: duplicados, fecha inválida, operación sin puesto, orden sin aparato,
 *    relaciones sin orden padre, precedente inexistente, preórdenes solo en Ortems, etc.
 */
import type { ResourceCapacity } from '../domain/settings';
import { addDays, dayKey, HOUR, isoWeek, isoWeekday, pad, startOfDay } from '../lib/dates';
import type { GridCell, SheetGrid } from '../import/values';

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEMO_PUESTOS: { id: string; desc: string; seccion: string; area: string; centro: string }[] = [
  { id: '01', desc: 'Corte láser', seccion: 'Calderería', area: 'Chapa', centro: 'Planta 1' },
  { id: '02', desc: 'Plegadora CNC', seccion: 'Calderería', area: 'Chapa', centro: 'Planta 1' },
  { id: '03', desc: 'Soldadura', seccion: 'Calderería', area: 'Chapa', centro: 'Planta 1' },
  { id: '04', desc: 'Torno CNC', seccion: 'Mecanizado', area: 'Mecanizado', centro: 'Planta 1' },
  { id: '05', desc: 'Centro de mecanizado', seccion: 'Mecanizado', area: 'Mecanizado', centro: 'Planta 1' },
  { id: '06', desc: 'Cabina de pintura', seccion: 'Pintura', area: 'Acabados', centro: 'Planta 1' },
  { id: '07', desc: 'Montaje mecánico', seccion: 'Montaje', area: 'Montaje', centro: 'Planta 2' },
  { id: '08', desc: 'Montaje eléctrico', seccion: 'Montaje', area: 'Montaje', centro: 'Planta 2' },
  { id: '09', desc: 'Cableado', seccion: 'Cableado', area: 'Montaje', centro: 'Planta 2' },
  { id: '10', desc: 'Banco de pruebas', seccion: 'Pruebas', area: 'Calidad', centro: 'Planta 2' },
  { id: '11', desc: 'Verificación final', seccion: 'Pruebas', area: 'Calidad', centro: 'Planta 2' },
];

type OpTpl = [puesto: string, desc: string, hMin: number, hMax: number];
interface OrderTpl {
  name: string;
  ops: OpTpl[];
  parent?: number;
}
interface FamilyTpl {
  familia: string;
  articulos: { ref: string; desc: string }[];
  orders: OrderTpl[];
  weight: number;
  ortemsOrderLevel?: boolean;
}

const FAMILIES: FamilyTpl[] = [
  {
    familia: 'Celda MT',
    weight: 0.32,
    articulos: [
      { ref: 'CMT-24-630', desc: 'Celda de media tensión 24 kV 630 A' },
      { ref: 'CMT-36-1250', desc: 'Celda de media tensión 36 kV 1250 A' },
    ],
    orders: [
      { name: 'Envolvente', parent: 2, ops: [['01', 'Corte de chapa', 3, 6], ['02', 'Plegado', 2, 4], ['03', 'Soldadura de bastidor', 4, 8], ['06', 'Pintura', 3, 5]] },
      { name: 'Embarrado', parent: 2, ops: [['04', 'Torneado de bornas', 2, 4], ['05', 'Mecanizado de pletinas', 5, 9]] },
      { name: 'Montaje', parent: 3, ops: [['07', 'Montaje mecánico', 4, 8], ['08', 'Montaje eléctrico', 6, 10], ['09', 'Cableado de control', 4, 8]] },
      { name: 'Pruebas', ops: [['10', 'Ensayo dieléctrico', 3, 6], ['11', 'Verificación final', 1, 2]] },
    ],
  },
  {
    familia: 'Cuadro BT',
    weight: 0.28,
    articulos: [
      { ref: 'CBT-400', desc: 'Cuadro de baja tensión 400 A' },
      { ref: 'CBT-800', desc: 'Cuadro de baja tensión 800 A' },
    ],
    orders: [
      { name: 'Envolvente', parent: 1, ops: [['01', 'Corte de chapa', 2, 4], ['02', 'Plegado', 2, 3], ['06', 'Pintura', 2, 4]] },
      { name: 'Montaje y pruebas', ops: [['07', 'Montaje mecánico', 3, 6], ['08', 'Montaje eléctrico', 4, 8], ['09', 'Cableado', 4, 6], ['10', 'Ensayo funcional', 2, 4], ['11', 'Verificación final', 1, 2]] },
    ],
  },
  {
    familia: 'Transformador seco',
    weight: 0.22,
    articulos: [
      { ref: 'TRS-630', desc: 'Transformador seco 630 kVA' },
      { ref: 'TRS-1000', desc: 'Transformador seco 1000 kVA' },
    ],
    orders: [
      { name: 'Núcleo', parent: 2, ops: [['04', 'Torneado de ejes', 4, 6], ['05', 'Mecanizado de núcleo', 6, 10]] },
      { name: 'Cuba', parent: 2, ops: [['01', 'Corte de chapa', 3, 5], ['03', 'Soldadura de cuba', 6, 10], ['06', 'Pintura', 4, 6]] },
      { name: 'Montaje', parent: 3, ops: [['07', 'Montaje de partes activas', 6, 10], ['08', 'Conexionado', 4, 6]] },
      { name: 'Ensayos', ops: [['10', 'Ensayo de rutina', 4, 8], ['11', 'Verificación final', 1, 2]] },
    ],
  },
  {
    familia: 'Armario control',
    weight: 0.18,
    ortemsOrderLevel: true,
    articulos: [
      { ref: 'ACT-12', desc: 'Armario de control 12 módulos' },
      { ref: 'ACT-24', desc: 'Armario de control 24 módulos' },
    ],
    orders: [
      { name: 'Envolvente', parent: 1, ops: [['01', 'Corte de chapa', 1, 3], ['02', 'Plegado', 1, 2], ['06', 'Pintura', 2, 3]] },
      { name: 'Montaje', ops: [['08', 'Montaje eléctrico', 3, 6], ['09', 'Cableado', 4, 8], ['11', 'Verificación final', 1, 2]] },
    ],
  },
];

export const DEMO_HOLIDAYS = ['2026-12-08', '2026-12-25', '2027-01-01', '2027-01-06'];

export function demoCapacities(base: number): Record<string, ResourceCapacity> {
  const wk = (h: number) => ({ 1: h, 2: h, 3: h, 4: h, 5: h, 6: 0, 7: 0 });
  const mk = (puestoId: string, h: number, units = 1, extra: Partial<ResourceCapacity> = {}): ResourceCapacity => ({
    puestoId,
    hoursPerWeekday: wk(h),
    units,
    efficiency: 1,
    stops: [],
    specialDays: [],
    ...extra,
  });
  const stopFrom = dayKey(nextWorkingDay(addDays(base, 11)));
  const stopTo = dayKey(nextWorkingDay(addDays(base, 12)));
  return {
    '01': mk('01', 8),
    '02': mk('02', 8),
    '03': mk('03', 16, 1, { note: 'Dos turnos de 8 h' }),
    '04': mk('04', 8),
    '05': mk('05', 8, 1, { stops: [{ from: stopFrom, to: stopTo, note: 'Mantenimiento preventivo' }] }),
    '06': mk('06', 8),
    '07': mk('07', 8, 2, { note: 'Dos puestos de montaje equivalentes' }),
    '08': mk('08', 8, 2, { note: 'Dos equipos de montaje eléctrico' }),
    '09': mk('09', 8),
    // '10' y '11' sin capacidad configurada a propósito: la app debe advertir que no puede confirmar saturación
  };
}

function nextWorkingDay(ms: number): number {
  let d = startOfDay(ms);
  while (isoWeekday(d) > 5 || DEMO_HOLIDAYS.includes(dayKey(d))) d = addDays(d, 1);
  return d;
}

const SHIFT_START = 7;
const SHIFT_END = 15;

function isWorking(d: number) {
  return isoWeekday(d) <= 5 && !DEMO_HOLIDAYS.includes(dayKey(d));
}

/** Suma horas de trabajo dentro del turno 07:00–15:00 de días laborables. */
function addWorkingHours(t: number, hours: number): number {
  let cur = t;
  let left = hours;
  let guard = 0;
  while (left > 1e-9 && guard < 2000) {
    guard++;
    const day = startOfDay(cur);
    const ws = day + SHIFT_START * HOUR;
    const we = day + SHIFT_END * HOUR;
    if (!isWorking(day) || cur >= we) {
      cur = nextWorkingDay(addDays(day, 1)) + SHIFT_START * HOUR;
      continue;
    }
    if (cur < ws) cur = ws;
    const avail = (we - cur) / HOUR;
    const take = Math.min(avail, left);
    cur += take * HOUR;
    left -= take;
  }
  return cur;
}

function alignStart(t: number): number {
  const day = startOfDay(t);
  if (!isWorking(day) || t >= day + SHIFT_END * HOUR) return nextWorkingDay(addDays(day, 1)) + SHIFT_START * HOUR;
  return Math.max(t, day + SHIFT_START * HOUR);
}

function subWorkingDays(ms: number, n: number): number {
  let d = startOfDay(ms);
  let k = 0;
  while (k < n) {
    d = addDays(d, -1);
    if (isWorking(d)) k++;
  }
  return d;
}

function addWorkingDays(ms: number, n: number): number {
  let d = startOfDay(ms);
  let k = 0;
  while (k < n) {
    d = addDays(d, 1);
    if (isWorking(d)) k++;
  }
  return d;
}

interface GenOp {
  aparato: number;
  articulo: { ref: string; desc: string };
  familia: string;
  of: string;
  ofPadre?: string;
  preorden?: string;
  op: string;
  desc: string;
  puesto: string;
  hours: number;
  start: number;
  end: number;
  realStart?: number;
  realEnd?: number;
  entrega: number;
  cantidad: number;
  estado: string;
  prioridad: number;
  ortemsOrderLevel: boolean;
  pred?: string;
}

export interface DemoData {
  base: number;
  produccion: SheetGrid[];
  ortems: SheetGrid;
  ortemsPrev: SheetGrid;
  capacities: Record<string, ResourceCapacity>;
  holidays: string[];
  stats: { aparatos: number; ordenes: number; operaciones: number };
}

export interface DemoOptions {
  aparatos?: number;
  seed?: number;
  /** Fecha de referencia (por defecto hoy). */
  base?: number;
}

export function generateDemo(opts: DemoOptions = {}): DemoData {
  const nAparatos = opts.aparatos ?? 48;
  const rnd = mulberry32(opts.seed ?? 20261119);
  const base = startOfDay(opts.base ?? Date.now());
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const between = (a: number, b: number) => a + rnd() * (b - a);
  const halfH = (a: number, b: number) => Math.round(between(a, b) * 2) / 2;

  const ops: GenOp[] = [];
  let ofSeq = 50001;

  for (let i = 0; i < nAparatos; i++) {
    const r = rnd();
    let acc = 0;
    let fam = FAMILIES[0];
    for (const f of FAMILIES) {
      acc += f.weight;
      if (r <= acc) {
        fam = f;
        break;
      }
    }
    const articulo = pick(fam.articulos);
    const aparato = 10001 + i;
    // Inicio de fabricación: repartido entre -6 y +9 semanas, con un pico de lanzamientos en la semana +1
    const cluster = rnd() < 0.2;
    const startOffset = cluster ? Math.round(between(3, 12)) : Math.round(between(-30, 45));
    const relDay = startOffset >= 0 ? addWorkingDays(base, startOffset) : subWorkingDays(base, -startOffset);
    const release = alignStart(relDay + SHIFT_START * HOUR + Math.floor(rnd() * 4) * HOUR);
    const prioridad = pick([1, 2, 2, 3, 3, 3, 3, 4, 4, 5]);
    const cantidad = fam.familia === 'Cuadro BT' ? pick([1, 1, 2, 3]) : 1;
    const ofs = fam.orders.map(() => String(ofSeq++).padStart(7, '0'));
    const omitParents = rnd() < 0.2; // ~20 % de aparatos sin dato de orden padre -> relaciones pendientes
    const orderEnds: number[] = new Array(fam.orders.length).fill(release);
    // planificación hacia delante: primero órdenes hijas (en paralelo), luego padres
    const levels = fam.orders.map((_, idx) => depth(fam.orders, idx));
    const maxLevel = Math.max(...levels);
    const orderStart: number[] = new Array(fam.orders.length).fill(release);
    const genForAparato: GenOp[] = [];
    for (let lvl = maxLevel; lvl >= 0; lvl--) {
      fam.orders.forEach((ot, idx) => {
        if (levels[idx] !== lvl) return;
        const children = fam.orders.map((o, j) => (o.parent === idx ? j : -1)).filter((j) => j >= 0);
        let cursor = children.length ? Math.max(...children.map((j) => orderEnds[j])) : release;
        cursor = alignStart(cursor + Math.floor(rnd() * 6) * HOUR);
        orderStart[idx] = cursor;
        ot.ops.forEach(([puesto, desc, hMin, hMax], k) => {
          const hours = halfH(hMin, hMax) * (cantidad > 1 ? 1 + (cantidad - 1) * 0.6 : 1);
          const start = alignStart(cursor);
          const end = addWorkingHours(start, hours);
          genForAparato.push({
            aparato,
            articulo,
            familia: fam.familia,
            of: ofs[idx],
            ofPadre: ot.parent !== undefined && !omitParents ? ofs[ot.parent] : undefined,
            op: String((k + 1) * 10).padStart(4, '0'),
            desc,
            puesto,
            hours: Math.round(hours * 10) / 10,
            start,
            end,
            entrega: 0,
            cantidad,
            estado: '',
            prioridad,
            ortemsOrderLevel: !!fam.ortemsOrderLevel,
          });
          cursor = end + (rnd() < 0.35 ? Math.floor(between(1, 10)) * HOUR : 0);
        });
        orderEnds[idx] = cursor;
      });
    }
    const finish = Math.max(...genForAparato.map((o) => o.end));
    const entrega = addWorkingDays(finish, Math.round(between(-1, 6))) + 15 * HOUR;
    for (const o of genForAparato) o.entrega = entrega;
    ops.push(...genForAparato);
  }

  // Estados y fechas reales
  for (const o of ops) {
    if (o.end < base) {
      const finished = rnd() < 0.88;
      o.estado = finished ? pick(['Terminada', 'Terminada', 'Finalizada']) : pick(['Pendiente', 'En curso']);
      if (finished) {
        o.realStart = o.start + Math.round(between(-1, 3)) * HOUR;
        const late = rnd() < 0.15 ? between(10, 40) : between(-1, 4);
        o.realEnd = Math.max(o.realStart + HOUR, o.end + Math.round(late) * HOUR);
      } else if (o.estado === 'En curso') o.realStart = o.start + HOUR;
    } else if (o.start <= base + 12 * HOUR) {
      o.estado = 'En curso';
      o.realStart = o.start;
    } else o.estado = rnd() < 0.8 ? 'Pendiente' : 'Lanzada';
  }

  // Ortems: re-planificación a capacidad finita por prioridad (sobre las mismas operaciones)
  const ortemsDates = finiteCapacityPlan(ops, base, rnd);

  // ---------- Hoja de producción ----------
  const prodHeader: GridCell[] = [
    'N.º Aparato', 'Ref. Artículo', 'Descripción', 'Familia', 'Nº OF', 'OF Padre', 'Preorden', 'Op.', 'Descripción operación', 'Puesto Trab.',
    'F. Inicio Prev.', 'F. Fin Prev.', 'F. Inicio Real', 'F. Fin Real', 'Fecha entrega', 'Tiempo (h)', 'Cantidad', 'Estado', 'Observaciones',
  ];
  const d = (ms?: number) => (ms === undefined ? null : new Date(ms));
  const rows: GridCell[][] = ops.map((o) => [
    o.aparato,
    o.articulo.ref,
    o.articulo.desc,
    o.familia,
    o.of,
    o.ofPadre ?? null,
    null,
    o.op,
    o.desc,
    o.puesto,
    d(o.start),
    d(o.end),
    d(o.realStart),
    d(o.realEnd),
    d(o.entrega),
    o.hours,
    o.cantidad,
    o.estado,
    rnd() < 0.05 ? pick(['Material pendiente', 'Plano rev. B', 'Prioridad cliente']) : null,
  ]);

  // Anomalías controladas
  const inject = (fn: (rows: GridCell[][]) => void) => fn(rows);
  inject((rs) => rs.splice(25, 0, [...rs[25]])); // duplicado exacto
  inject((rs) => {
    rs[40][11] = '31/02/2026'; // fecha inexistente
  });
  inject((rs) => {
    rs[61][9] = null; // operación sin puesto
  });
  inject((rs) => {
    rs[77][15] = null; // operación sin duración (se estimará desde fechas)
  });
  inject((rs) => {
    const r = [...rs[90]]; // misma clave OF+Op con datos distintos
    r[9] = '04';
    r[15] = 2.5;
    rs.splice(91, 0, r);
  });
  inject((rs) => {
    const s = rs[104][10];
    rs[104][10] = rs[104][11];
    rs[104][11] = s; // inicio posterior al fin
  });
  // Orden de repuestos sin aparato ni orden padre
  const repStart = alignStart(addWorkingDays(base, 3) + SHIFT_START * HOUR);
  const repEnd = addWorkingHours(repStart, 6);
  rows.push([null, 'REP-PLT-01', 'Pletinas de repuesto', 'Repuestos', '0059001', null, null, '0010', 'Mecanizado de pletinas', '05', d(repStart), d(repEnd), null, null, null, 6, 20, 'Pendiente', 'Pedido de posventa']);
  // Orden padre inexistente
  const lastCelda = rows.findIndex((r) => r[3] === 'Celda MT' && r[5]);
  if (lastCelda >= 0) {
    const of = rows[lastCelda][4];
    for (const r of rows) if (r[4] === of) r[5] = '0099999';
  }
  // Precedente explícita (confirmada) en una orden: columna adicional
  prodHeader.push('Op. precedente');
  for (const r of rows) r.push(null);
  const firstTrs = rows.findIndex((r) => r[3] === 'Transformador seco' && r[7] === '0020');
  if (firstTrs >= 0) rows[firstTrs][19] = '0010';
  const missingPred = rows.findIndex((r, i) => i > firstTrs + 20 && r[7] === '0020');
  if (missingPred >= 0) rows[missingPred][19] = '0015';

  const produccion: SheetGrid = { name: 'Operaciones', rows: [prodHeader, ...rows] };
  const puestosSheet: SheetGrid = {
    name: 'Puestos',
    rows: [['Puesto', 'Denominación', 'Sección', 'Área', 'Centro'], ...DEMO_PUESTOS.map((p) => [p.id, p.desc, p.seccion, p.area, p.centro] as GridCell[])],
  };

  // ---------- Hoja de Ortems ----------
  const fmt = (ms?: number) => {
    if (ms === undefined) return null;
    const x = new Date(ms);
    return `${pad(x.getDate())}/${pad(x.getMonth() + 1)}/${x.getFullYear()} ${pad(x.getHours())}:${pad(x.getMinutes())}`;
  };
  const semana = (ms: number) => {
    const w = isoWeek(ms);
    return `S${pad(w.week)}/${w.year}`;
  };
  const buildOrtems = (variant: 'actual' | 'anterior'): SheetGrid => {
    const r2 = mulberry32((opts.seed ?? 20261119) + (variant === 'actual' ? 7 : 3));
    const out: GridCell[][] = [];
    const excludedOfs = new Set<string>();
    const allOfs = [...new Set(ops.map((o) => o.of))];
    // 3 órdenes de producción que Ortems no planifica
    [5, 17, 33].forEach((k) => allOfs[k] && excludedOfs.add(allOfs[k]));
    const byOf = new Map<string, GenOp[]>();
    for (const o of ops) {
      const l = byOf.get(o.of) ?? [];
      l.push(o);
      byOf.set(o.of, l);
    }
    for (const [of, list] of byOf) {
      if (excludedOfs.has(of)) continue;
      let prio = list[0].prioridad;
      if (variant === 'anterior' && r2() < 0.1) {
        prio = Math.min(5, Math.max(1, prio + (r2() < 0.5 ? -1 : 1)));
      }
      if (list.every((o) => /Terminada|Finalizada/.test(o.estado))) continue;
      if (list[0].ortemsOrderLevel) {
        const s = Math.min(...list.map((o) => ortemsDates.get(o)!.start));
        const e = Math.max(...list.map((o) => ortemsDates.get(o)!.end));
        const shift = variant === 'anterior' ? Math.round((r2() - 0.5) * 2) * 24 * HOUR : 0;
        out.push([of, null, list[0].aparato, list[0].articulo.ref, null, null, prio, fmt(s + shift), fmt(e + shift), list[0].cantidad, 'Planificada', semana(s)]);
        continue;
      }
      for (const o of list) {
        // Un APS no exporta las operaciones ya terminadas
        if (/Terminada|Finalizada/.test(o.estado)) continue;
        const od = ortemsDates.get(o)!;
        let recurso = o.puesto;
        if (o.puesto === '05' && r2() < 0.12) recurso = '04';
        const shift = variant === 'anterior' && r2() < 0.25 ? Math.round((r2() - 0.4) * 3) * 24 * HOUR : 0;
        out.push([of, null, o.aparato, o.articulo.ref, o.op, recurso, prio, fmt(od.start + shift), fmt(od.end + shift), o.cantidad, od.start < base ? 'Iniciada' : 'Planificada', semana(od.start)]);
      }
    }
    // Órdenes en Ortems que no están en producción
    const ghostStart = alignStart(addWorkingDays(base, 2) + SHIFT_START * HOUR);
    out.push(['0058801', null, 10950, 'CBT-400', '0010', '07', 3, fmt(ghostStart), fmt(addWorkingHours(ghostStart, 5)), 1, 'Planificada', semana(ghostStart)]);
    out.push(['0058802', null, 10951, 'CBT-800', '0010', '08', 2, fmt(ghostStart), fmt(addWorkingHours(ghostStart, 7)), 1, 'Planificada', semana(ghostStart)]);
    // Preórdenes (aún sin OF): carga futura que solo conoce Ortems
    const nPre = variant === 'actual' ? 7 : 5;
    for (let k = 0; k < nPre; k++) {
      const st = alignStart(addWorkingDays(base, 6 + k * 2) + (SHIFT_START + (k % 3)) * HOUR);
      const prio = k === 0 || k === 4 ? 1 : 3 + (k % 2);
      const pre = `PO-26-${String(101 + k).padStart(4, '0')}`;
      const ap = 11001 + k;
      // dos operaciones por preorden sobre puestos ya cargados
      const p1 = k % 2 ? '05' : '08';
      const p2 = k % 2 ? '07' : '09';
      const h1 = 14 + (k % 3) * 4;
      const e1 = addWorkingHours(st, h1);
      const e2 = addWorkingHours(e1, 10);
      out.push([null, pre, ap, k % 2 ? 'TRS-630' : 'CMT-24-630', '0010', p1, prio, fmt(st), fmt(e1), 1, 'Propuesta', semana(st)]);
      out.push([null, pre, ap, k % 2 ? 'TRS-630' : 'CMT-24-630', '0020', p2, prio, fmt(e1), fmt(e2), 1, 'Propuesta', semana(e1)]);
    }
    const generated = new Date(variant === 'actual' ? base : addDays(base, -7));
    return {
      name: 'Plan Ortems',
      rows: [
        ['ORTEMS · Exportación de planificación (datos ficticios)'],
        [`Generado: ${pad(generated.getDate())}/${pad(generated.getMonth() + 1)}/${generated.getFullYear()} 06:00 · Horizonte 16 semanas`],
        [],
        ['OF', 'Preorden', 'Aparato', 'Artículo', 'Fase', 'Recurso', 'Prioridad', 'Inicio planificado', 'Fin planificado', 'Cantidad', 'Estado plan.', 'Semana'],
        ...out,
      ],
    };
  };

  return {
    base,
    produccion: [produccion, puestosSheet],
    ortems: buildOrtems('actual'),
    ortemsPrev: buildOrtems('anterior'),
    capacities: demoCapacities(base),
    holidays: DEMO_HOLIDAYS,
    stats: { aparatos: nAparatos, ordenes: new Set(ops.map((o) => o.of)).size + 1, operaciones: ops.length + 1 },
  };
}

function depth(orders: OrderTpl[], idx: number): number {
  let d = 0;
  let p = orders[idx].parent;
  while (p !== undefined) {
    d++;
    p = orders[p].parent;
  }
  return d;
}

/**
 * Planificación simplificada a capacidad finita: cada puesto procesa sus operaciones en orden
 * de (día de inicio previsto, prioridad), respetando la secuencia dentro de cada orden.
 */
function finiteCapacityPlan(ops: GenOp[], base: number, rnd: () => number): Map<GenOp, { start: number; end: number }> {
  const units: Record<string, number> = { '07': 2, '08': 2 };
  const free = new Map<string, number[]>();
  const res = new Map<GenOp, { start: number; end: number }>();
  const prevInOrder = new Map<GenOp, GenOp | undefined>();
  const byOf = new Map<string, GenOp[]>();
  for (const o of ops) {
    const l = byOf.get(o.of) ?? [];
    l.push(o);
    byOf.set(o.of, l);
  }
  for (const l of byOf.values()) l.forEach((o, i) => prevInOrder.set(o, l[i - 1]));
  const sorted = [...ops].sort((a, b) => startOfDay(a.start) - startOfDay(b.start) || a.prioridad - b.prioridad || a.start - b.start);
  for (const o of sorted) {
    const slots = free.get(o.puesto) ?? new Array(units[o.puesto] ?? 1).fill(-Infinity);
    free.set(o.puesto, slots);
    const prev = prevInOrder.get(o);
    const prevEnd = prev ? res.get(prev)?.end ?? prev.end : -Infinity;
    let best = 0;
    for (let i = 1; i < slots.length; i++) if (slots[i] < slots[best]) best = i;
    // operaciones ya terminadas: Ortems refleja lo previsto (sin re-planificar el pasado)
    const earliest = o.end < base ? o.start : Math.max(o.start, prevEnd, slots[best]);
    const start = alignStart(earliest + (rnd() < 0.08 ? -24 * HOUR : 0));
    const end = addWorkingHours(start, o.hours);
    res.set(o, { start, end });
    slots[best] = Math.max(slots[best], end);
  }
  return res;
}

import type { EstadoCanonico } from '../domain/types';
import { addDays, isoWeekStart, parseDayKey } from '../lib/dates';
import { naturalCompare, searchable } from '../lib/text';
import { isAdelantada, isRetrasada, type Analysis } from './analysis';
import { opSpan } from './model';

export type FuenteFiltro = 'todas' | 'produccion' | 'ortems' | 'ambas';

export interface FilterState {
  q: string;
  aparatos: string[];
  articulos: string[];
  descripcion: string;
  familias: string[];
  puestos: string[];
  secciones: string[];
  areas: string[];
  centros: string[];
  ordenes: string[];
  preorden: string;
  prioridades: string[];
  estados: EstadoCanonico[];
  fuente: FuenteFiltro;
  /** Año ISO para semanas; año natural para meses. */
  year?: number;
  weeks: number[];
  month?: number;
  dateFrom?: string;
  dateTo?: string;
  dateOn?: string;
  flags: {
    desviacion?: boolean;
    solapada?: boolean;
    retrasada?: boolean;
    adelantada?: boolean;
    riesgo?: boolean;
    sinCorrespondencia?: boolean;
  };
}

export const EMPTY_FILTERS: FilterState = {
  q: '',
  aparatos: [],
  articulos: [],
  descripcion: '',
  familias: [],
  puestos: [],
  secciones: [],
  areas: [],
  centros: [],
  ordenes: [],
  preorden: '',
  prioridades: [],
  estados: [],
  fuente: 'todas',
  weeks: [],
  flags: {},
};

export const FLAG_LABEL: Record<keyof FilterState['flags'], string> = {
  desviacion: 'Con desviación respecto a Ortems',
  solapada: 'Operaciones solapadas',
  retrasada: 'Operaciones retrasadas',
  adelantada: 'Operaciones adelantadas',
  riesgo: 'Riesgo de cuello de botella',
  sinCorrespondencia: 'Sin correspondencia entre ambos Excel',
};

export const ESTADO_LABEL: Record<EstadoCanonico, string> = {
  pendiente: 'Pendiente',
  en_curso: 'En curso',
  terminada: 'Terminada',
  bloqueada: 'Bloqueada',
  anulada: 'Anulada',
  desconocido: 'Sin estado',
};

export interface FilterChip {
  key: string;
  label: string;
}

export function filterChips(f: FilterState): FilterChip[] {
  const chips: FilterChip[] = [];
  const list = (key: keyof FilterState, label: string, vals: string[]) => {
    if (vals.length) chips.push({ key: String(key), label: `${label}: ${vals.slice(0, 3).join(', ')}${vals.length > 3 ? ` +${vals.length - 3}` : ''}` });
  };
  if (f.q) chips.push({ key: 'q', label: `Búsqueda: «${f.q}»` });
  list('aparatos', 'Aparato', f.aparatos);
  list('articulos', 'Artículo', f.articulos);
  if (f.descripcion) chips.push({ key: 'descripcion', label: `Descripción contiene «${f.descripcion}»` });
  list('familias', 'Familia', f.familias);
  list('puestos', 'Puesto', f.puestos);
  list('secciones', 'Sección', f.secciones);
  list('areas', 'Área', f.areas);
  list('centros', 'Centro', f.centros);
  list('ordenes', 'Orden', f.ordenes);
  if (f.preorden) chips.push({ key: 'preorden', label: `Preorden contiene «${f.preorden}»` });
  list('prioridades', 'Prioridad', f.prioridades);
  list('estados', 'Estado', f.estados.map((e) => ESTADO_LABEL[e]));
  if (f.fuente !== 'todas') chips.push({ key: 'fuente', label: `Fuente: ${f.fuente === 'ambas' ? 'presentes en ambas' : f.fuente === 'produccion' ? 'producción' : 'Ortems'}` });
  if (f.weeks.length && f.year) chips.push({ key: 'weeks', label: `Semana ISO ${f.weeks.map((w) => `S${w}`).join(', ')} de ${f.year}` });
  else if (f.month && f.year) chips.push({ key: 'month', label: `Mes ${String(f.month).padStart(2, '0')}/${f.year}` });
  else if (f.year) chips.push({ key: 'year', label: `Año ${f.year}` });
  if (f.dateFrom || f.dateTo) chips.push({ key: 'range', label: `Entre ${f.dateFrom ?? '…'} y ${f.dateTo ?? '…'}` });
  if (f.dateOn) chips.push({ key: 'dateOn', label: `Previstas el ${f.dateOn}` });
  for (const [k, v] of Object.entries(f.flags)) if (v) chips.push({ key: `flag:${k}`, label: FLAG_LABEL[k as keyof FilterState['flags']] });
  return chips;
}

export function clearChip(f: FilterState, key: string): FilterState {
  const n: FilterState = { ...f, flags: { ...f.flags } };
  if (key.startsWith('flag:')) {
    delete n.flags[key.slice(5) as keyof FilterState['flags']];
    return n;
  }
  switch (key) {
    case 'weeks':
      n.weeks = [];
      return n;
    case 'month':
      n.month = undefined;
      return n;
    case 'year':
      n.year = undefined;
      n.weeks = [];
      n.month = undefined;
      return n;
    case 'range':
      n.dateFrom = undefined;
      n.dateTo = undefined;
      return n;
    case 'dateOn':
      n.dateOn = undefined;
      return n;
    case 'fuente':
      n.fuente = 'todas';
      return n;
  }
  const v = (EMPTY_FILTERS as unknown as Record<string, unknown>)[key];
  (n as unknown as Record<string, unknown>)[key] = Array.isArray(v) ? [] : v;
  return n;
}

export function isEmptyFilter(f: FilterState): boolean {
  return filterChips(f).length === 0;
}

type Window = [number, number];

/** Ventanas temporales del filtro. Las ventanas de un mismo tipo se combinan con O; los tipos, con Y. */
export function timeConstraints(f: FilterState): Window[][] {
  const groups: Window[][] = [];
  if (f.year && f.weeks.length) groups.push(f.weeks.map((w) => [isoWeekStart(f.year!, w), addDays(isoWeekStart(f.year!, w), 7)]));
  else if (f.year && f.month) groups.push([[new Date(f.year, f.month - 1, 1).getTime(), new Date(f.year, f.month, 1).getTime()]]);
  else if (f.year) groups.push([[new Date(f.year, 0, 1).getTime(), new Date(f.year + 1, 0, 1).getTime()]]);
  if (f.dateFrom || f.dateTo) {
    const from = f.dateFrom ? parseDayKey(f.dateFrom) : -Infinity;
    const to = f.dateTo ? addDays(parseDayKey(f.dateTo), 1) : Infinity;
    groups.push([[from, to]]);
  }
  if (f.dateOn) {
    const d = parseDayKey(f.dateOn);
    groups.push([[d, addDays(d, 1)]]);
  }
  return groups;
}

function intersects(start: number | undefined, end: number | undefined, groups: Window[][]): boolean {
  if (!groups.length) return true;
  if (start === undefined && end === undefined) return false;
  const s = start ?? end!;
  const e = Math.max(end ?? start!, s);
  return groups.every((g) => g.some(([from, to]) => s < to && e >= from));
}

export interface FilterResult {
  ops: Set<string>;
  ortemsOnly: Set<string>;
  aparatos: Set<string>;
  ordenes: Set<string>;
  puestos: Set<string>;
  totalOps: number;
  totalOrtemsOnly: number;
  active: boolean;
}

export function applyFilters(a: Analysis, f: FilterState): FilterResult {
  const { model } = a;
  const set = (xs: string[]) => (xs.length ? new Set(xs) : undefined);
  const aparatos = set(f.aparatos);
  const articulos = set(f.articulos);
  const familias = set(f.familias);
  const puestos = set(f.puestos);
  const secciones = set(f.secciones);
  const areas = set(f.areas);
  const centros = set(f.centros);
  const ordenes = set(f.ordenes);
  const prioridades = set(f.prioridades);
  const estados = f.estados.length ? new Set(f.estados) : undefined;
  const q = searchable(f.q.trim());
  const desc = searchable(f.descripcion.trim());
  const pre = searchable(f.preorden.trim());
  const time = timeConstraints(f);
  const flagsOn = Object.entries(f.flags).filter(([, v]) => v).map(([k]) => k);
  const ortemsMatchedOps = new Set<string>([...a.match.opMatches.keys()]);
  const ortemsMatchedOrders = new Set<string>([...a.match.ordenMatches.keys()]);

  const out: FilterResult = { ops: new Set(), ortemsOnly: new Set(), aparatos: new Set(), ordenes: new Set(), puestos: new Set(), totalOps: model.ops.size, totalOrtemsOnly: a.match.ortemsOnly.length, active: !isEmptyFilter(f) };

  for (const op of model.ops.values()) {
    const ord = model.ordenes.get(op.ordenId);
    const ap = op.aparatoId ? model.aparatos.get(op.aparatoId) : undefined;
    const familia = op.familia ?? ord?.familia ?? ap?.familia;
    const artRef = op.articuloRef ?? ord?.articuloRef ?? ap?.articuloRef;
    if (aparatos && !(op.aparatoId && aparatos.has(op.aparatoId))) continue;
    if (articulos && !(artRef && articulos.has(artRef))) continue;
    if (familias && !(familia && familias.has(familia))) continue;
    if (puestos && !(op.puestoId && puestos.has(op.puestoId))) continue;
    if (secciones && !(op.seccion && secciones.has(op.seccion))) continue;
    if (areas && !(op.area && areas.has(op.area))) continue;
    if (centros && !(op.centro && centros.has(op.centro))) continue;
    if (ordenes && !ordenes.has(op.ordenId) && !(ord?.ordenId && ordenes.has(ord.ordenId))) continue;
    if (estados && !estados.has(op.estado)) continue;
    const row = a.comparison.byOp.get(op.key) ?? a.comparison.byOrden.get(op.ordenId)?.find((r) => r.level === 'orden');
    if (prioridades && !(row?.prioridadRaw && prioridades.has(row.prioridadRaw)) && !(op.prioridadRaw && prioridades.has(op.prioridadRaw))) continue;
    if (pre && !searchable(op.preordenId ?? ord?.preordenId ?? row?.preordenId).includes(pre)) continue;
    if (desc && !searchable(`${op.articuloDesc ?? ''} ${ord?.articuloDesc ?? ''} ${ap?.desc ?? ''} ${op.desc ?? ''}`).includes(desc)) continue;
    if (q && !searchable(`${op.aparatoId ?? ''} ${op.ordenId} ${op.label} ${artRef ?? ''} ${op.puestoId ?? ''} ${op.desc ?? ''} ${ap?.desc ?? ''} ${op.preordenId ?? ''}`).includes(q)) continue;
    const inOrtems = ortemsMatchedOps.has(op.key) || ortemsMatchedOrders.has(op.ordenId);
    if (f.fuente === 'ortems' && !inOrtems) continue;
    if (f.fuente === 'ambas' && !inOrtems) continue;
    if (time.length) {
      const span = opSpan(op);
      const okProd = intersects(span?.start, span?.end, time);
      const okOrt = f.fuente !== 'produccion' && row && intersects(row.ortStart, row.ortEnd, time);
      if (!okProd && !okOrt) continue;
    }
    if (flagsOn.length) {
      const fl = a.opFlags.get(op.key);
      let ok = true;
      for (const k of flagsOn) {
        if (k === 'desviacion' && !fl?.desviacionOrtems) ok = false;
        if (k === 'solapada' && !(fl?.solape && fl.solape.clase !== 'solape_dentro_capacidad')) ok = false;
        if (k === 'retrasada' && !isRetrasada(fl)) ok = false;
        if (k === 'adelantada' && !isAdelantada(fl)) ok = false;
        if (k === 'riesgo' && !(fl?.saturado || fl?.solape?.clase === 'sobrecarga_confirmada' || fl?.solape?.clase === 'sobrecarga_estimada')) ok = false;
        if (k === 'sinCorrespondencia' && inOrtems) ok = false;
      }
      if (!ok) continue;
    }
    out.ops.add(op.key);
    out.ordenes.add(op.ordenId);
    if (op.aparatoId) out.aparatos.add(op.aparatoId);
    if (op.puestoId) out.puestos.add(op.puestoId);
  }

  // Registros solo en Ortems (sin correspondencia en producción)
  if (f.fuente === 'todas' || f.fuente === 'ortems') {
    for (const rid of a.match.ortemsOnly) {
      const r = a.ortems.get(rid);
      if (!r) continue;
      const sec = r.seccion ?? (r.puestoId ? model.puestos.get(r.puestoId)?.seccion : undefined);
      const apId = a.ortemsAparato.get(rid) ?? r.aparatoId;
      if (aparatos && !(apId && aparatos.has(apId))) continue;
      if (articulos && !(r.articuloRef && articulos.has(r.articuloRef))) continue;
      if (familias && !(r.familia && familias.has(r.familia))) continue;
      if (desc && !searchable(r.articuloDesc).includes(desc)) continue;
      if (areas || centros || estados) continue;
      if (puestos && !(r.puestoId && puestos.has(r.puestoId))) continue;
      if (secciones && !(sec && secciones.has(sec))) continue;
      if (ordenes && !(r.ordenId && ordenes.has(r.ordenId))) continue;
      if (prioridades && !(r.prioridadRaw && prioridades.has(r.prioridadRaw))) continue;
      if (pre && !searchable(r.preordenId).includes(pre)) continue;
      if (q && !searchable(`${apId ?? ''} ${r.articuloDesc ?? ''} ${r.ordenId ?? ''} ${r.preordenId ?? ''} ${r.articuloRef ?? ''} ${r.puestoId ?? ''} ${r.operacionId ?? ''}`).includes(q)) continue;
      if (time.length && !intersects(r.inicio, r.fin, time)) continue;
      if (flagsOn.length && !(flagsOn.length === 1 && flagsOn[0] === 'sinCorrespondencia')) continue;
      out.ortemsOnly.add(rid);
    }
  }
  return out;
}

/** Valores disponibles para los selectores de filtros. */
export function filterOptions(a: Analysis) {
  const m = a.model;
  const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort(naturalCompare);
  const ops = [...m.ops.values()];
  const years = new Set<number>();
  for (const op of ops) {
    const span = opSpan(op);
    if (span) {
      years.add(new Date(span.start).getFullYear());
      years.add(new Date(span.end).getFullYear());
    }
  }
  for (const r of a.ortemsList) if (r.inicio) years.add(new Date(r.inicio).getFullYear());
  return {
    aparatos: uniq([...m.aparatos.keys(), ...a.ortemsList.map((r) => a.ortemsAparato.get(r.rid) ?? r.aparatoId)]),
    articulos: uniq(ops.map((o) => o.articuloRef).concat([...m.ordenes.values()].map((o) => o.articuloRef), a.ortemsList.map((r) => r.articuloRef))),
    familias: uniq([...m.familias, ...a.ortemsList.map((r) => r.familia)]),
    puestos: uniq([...m.puestos.keys(), ...a.ortemsList.map((r) => r.puestoId)]),
    secciones: uniq([...m.secciones, ...a.ortemsList.map((r) => r.seccion)]),
    areas: uniq(ops.map((o) => o.area)),
    centros: uniq(ops.map((o) => o.centro)),
    ordenes: uniq([...m.ordenes.keys(), ...a.ortemsList.map((r) => r.ordenId)]),
    prioridades: uniq(a.ortemsList.map((r) => r.prioridadRaw).concat(ops.map((o) => o.prioridadRaw))),
    years: [...years].sort(),
  };
}

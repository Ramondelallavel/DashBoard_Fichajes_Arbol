import { useMemo, type ReactNode } from 'react';
import type { Analysis } from '../../engine/analysis';
import type { FilterResult } from '../../engine/filters';
import { computeLoad, type LoadItem, type LoadResult } from '../../engine/load';
import { weekKey, weekLabel, weekKeyStart } from '../../lib/dates';
import { ActiveFilters } from '../filters/FilterPanel';

export function PageHead({ title, lead, actions, eyebrow }: { title: string; lead?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="page-head">
      <div style={{ minWidth: 0 }}>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {lead && <p className="lead">{lead}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function FiltersRow({ onFilters }: { onFilters?: () => void }) {
  if (!onFilters) return null;
  return <ActiveFilters onOpen={onFilters} />;
}

/**
 * Carga recalculada solo con lo visible por el filtro (los indicadores reaccionan a los filtros).
 * `base`: planificación sobre la que se calcula (por defecto, la base del análisis).
 */
export function useFilteredLoad(a: Analysis | undefined, filtered: FilterResult | undefined, base?: 'produccion' | 'ortems' | 'combinada'): LoadResult | undefined {
  return useMemo(() => {
    if (!a) return undefined;
    const b = base ?? a.loadBase;
    if (!filtered?.active) return a.load[b];
    const inSel = (it: LoadItem) => {
      if (it.source === 'produccion') return filtered.ops.has(it.id);
      if (filtered.ortemsOnly.has(it.id)) return true;
      const m = a.match.matches.get(it.id);
      if (!m) return false;
      return m.level === 'operacion' ? filtered.ops.has(m.target) : filtered.ordenes.has(m.target);
    };
    const onlyOrt = new Set(a.match.ortemsOnly);
    const pool = b === 'produccion' ? a.loadItems.produccion : b === 'ortems' ? a.loadItems.ortems : [...a.loadItems.produccion.filter((i) => !i.real), ...a.loadItems.ortems.filter((i) => onlyOrt.has(i.id))];
    return computeLoad(pool.filter(inSel), a.calendar, b, a.puestoSeccion);
  }, [a, filtered, base]);
}

export const BASE_LABEL = { produccion: 'producción', ortems: 'Ortems', combinada: 'producción + solo-Ortems' } as const;

export function weekOptions(load: LoadResult | undefined, refMs: number): { key: string; label: string }[] {
  const keys = new Set<string>([weekKey(refMs)]);
  for (const pl of load?.puestos.values() ?? []) for (const k of pl.buckets.semana.keys()) keys.add(k);
  return [...keys].sort((a, b) => weekKeyStart(a) - weekKeyStart(b)).map((k) => ({ key: k, label: weekLabel(k) }));
}

export function occStatus(occ: number | undefined, risk: number, capKnown: boolean): 'over' | 'risk' | 'ok' | 'nocap' {
  if (!capKnown || occ === undefined) return 'nocap';
  if (occ > 1 + 1e-9) return 'over';
  if (occ >= risk) return 'risk';
  return 'ok';
}

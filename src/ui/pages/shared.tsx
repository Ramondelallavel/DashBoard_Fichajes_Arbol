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

/** Carga recalculada solo con las operaciones visibles por el filtro (los indicadores reaccionan a los filtros). */
export function useFilteredLoad(a: Analysis | undefined, filtered: FilterResult | undefined): LoadResult | undefined {
  return useMemo(() => {
    if (!a) return undefined;
    if (!filtered?.active) return a.load.produccion;
    const items: LoadItem[] = [];
    for (const k of filtered.ops) {
      const op = a.model.ops.get(k)!;
      const f = a.opFlags.get(k);
      items.push({ id: k, puestoId: op.puestoId, seccion: op.seccion, ordenId: op.ordenId, start: op.start, end: op.end, hours: f?.hours, estimated: !!f?.durEstimada, source: 'produccion' });
    }
    return computeLoad(items, a.calendar, 'produccion', new Map([...a.model.puestos.values()].map((p) => [p.id, p.seccion])));
  }, [a, filtered]);
}

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

import { createContext, useContext, useDeferredValue, useMemo, type ReactNode } from 'react';
import { useApp } from '../data/store';
import { runAnalysis, type Analysis } from '../engine/analysis';
import { applyFilters, filterOptions, type FilterResult } from '../engine/filters';

interface Ctx {
  analysis?: Analysis;
  filtered?: FilterResult;
  options?: ReturnType<typeof filterOptions>;
  error?: string;
  stale: boolean;
}

const AnalysisCtx = createContext<Ctx>({ stale: false });

/**
 * Calcula el análisis completo una sola vez por cambio de datos/configuración y lo comparte.
 * Los cálculos de planificación (engine/*) están separados de la representación (ui/*).
 */
export function AnalysisProvider({ children }: { children: ReactNode }) {
  const active = useApp((s) => s.active);
  const settings = useApp((s) => s.settings);
  const manual = useApp((s) => s.manual);
  const filters = useApp((s) => s.filters);
  const deferredFilters = useDeferredValue(filters);

  const { analysis, error } = useMemo(() => {
    if (!active.produccion && !active.ortems) return { analysis: undefined, error: undefined };
    try {
      return { analysis: runAnalysis({ prod: active.produccion, ortems: active.ortems, ortemsPrev: active.ortemsPrev, settings, manual }), error: undefined };
    } catch (e) {
      console.error(e);
      return { analysis: undefined, error: (e as Error).message };
    }
  }, [active.produccion, active.ortems, active.ortemsPrev, settings, manual]);

  const filtered = useMemo(() => (analysis ? applyFilters(analysis, deferredFilters) : undefined), [analysis, deferredFilters]);
  const options = useMemo(() => (analysis ? filterOptions(analysis) : undefined), [analysis]);

  return <AnalysisCtx.Provider value={{ analysis, filtered, options, error, stale: filters !== deferredFilters }}>{children}</AnalysisCtx.Provider>;
}

export function useAnalysis() {
  return useContext(AnalysisCtx);
}

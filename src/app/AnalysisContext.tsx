import { createContext, useContext, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../data/store';
import type { Analysis } from '../engine/analysis';
import { applyFilters, filterOptions, type FilterResult } from '../engine/filters';
import { AnalysisRunner } from './analysisRunner';

interface Ctx {
  analysis?: Analysis;
  filtered?: FilterResult;
  options?: ReturnType<typeof filterOptions>;
  error?: string;
  stale: boolean;
  computing: boolean;
  usingWorker: boolean;
}

const AnalysisCtx = createContext<Ctx>({ stale: false, computing: false, usingWorker: false });

/**
 * Calcula el análisis completo (en un Web Worker) una sola vez por cambio de datos, configuración o
 * validaciones manuales, y lo comparte con todas las vistas. Mientras se recalcula, se sigue mostrando
 * el análisis anterior. Los cálculos (engine/*) están separados de la representación (ui/*).
 */
export function AnalysisProvider({ children }: { children: ReactNode }) {
  const active = useApp((s) => s.active);
  const settings = useApp((s) => s.settings);
  const manual = useApp((s) => s.manual);
  const filters = useApp((s) => s.filters);
  const deferredFilters = useDeferredValue(filters);
  const runner = useRef<AnalysisRunner>(undefined);
  runner.current ??= new AnalysisRunner();
  const [state, setState] = useState<{ analysis?: Analysis; error?: string; computing: boolean }>({ computing: false });

  useEffect(() => {
    if (!active.produccion && !active.ortems) {
      setState({ computing: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, computing: true }));
    runner
      .current!.run({ prod: active.produccion, ortems: active.ortems, ortemsPrev: active.ortemsPrev, settings, manual })
      .then((analysis) => !cancelled && setState({ analysis, computing: false }))
      .catch((e: Error) => {
        console.error(e);
        if (!cancelled) setState({ error: e.message, computing: false });
      });
    return () => {
      cancelled = true;
    };
  }, [active.produccion, active.ortems, active.ortemsPrev, settings, manual]);

  const { analysis, error, computing } = state;
  const filtered = useMemo(() => (analysis ? applyFilters(analysis, deferredFilters) : undefined), [analysis, deferredFilters]);
  const options = useMemo(() => (analysis ? filterOptions(analysis) : undefined), [analysis]);

  return (
    <AnalysisCtx.Provider value={{ analysis, filtered, options, error, stale: filters !== deferredFilters, computing, usingWorker: runner.current.usingWorker }}>
      {children}
    </AnalysisCtx.Provider>
  );
}

export function useAnalysis() {
  return useContext(AnalysisCtx);
}

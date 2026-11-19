/**
 * Cálculo del análisis en un hilo aparte (Web Worker) para que la interfaz no se bloquee con
 * grandes volúmenes. El resultado se envía por clonado estructurado (los Map y Set se conservan);
 * el calendario, que es una clase con métodos, se reconstruye en el hilo principal.
 */
import { runAnalysis, type AnalysisInput } from './analysis';

interface WorkerScope {
  onmessage: ((e: MessageEvent<{ id: number; input: AnalysisInput }>) => void) | null;
  postMessage(msg: unknown): void;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = (e) => {
  const { id, input } = e.data;
  try {
    const { calendar, ...rest } = runAnalysis(input);
    void calendar;
    scope.postMessage({ id, analysis: rest });
  } catch (err) {
    scope.postMessage({ id, error: (err as Error).message ?? String(err) });
  }
};

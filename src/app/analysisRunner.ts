import { rehydrateAnalysis, runAnalysis, type Analysis, type AnalysisInput } from '../engine/analysis';
import AnalysisWorker from '../engine/analysis.worker?worker&inline';

type Pending = { resolve: (a: Analysis) => void; reject: (e: Error) => void; input: AnalysisInput };

/**
 * Ejecuta el análisis en un Web Worker; si el navegador o la política de seguridad no lo permiten,
 * lo ejecuta en el hilo principal (mismo resultado, sin bloquear la funcionalidad).
 */
export class AnalysisRunner {
  private worker?: Worker;
  private seq = 0;
  private pending = new Map<number, Pending>();
  usingWorker = false;

  constructor() {
    try {
      this.worker = new AnalysisWorker();
      this.usingWorker = true;
      this.worker.onmessage = (e: MessageEvent<{ id: number; analysis?: Omit<Analysis, 'calendar'>; error?: string }>) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        if (e.data.error) p.reject(new Error(e.data.error));
        else p.resolve(rehydrateAnalysis(e.data.analysis!));
      };
      this.worker.onerror = (ev) => {
        ev.preventDefault?.();
        this.fallback();
      };
    } catch {
      this.worker = undefined;
      this.usingWorker = false;
    }
  }

  private fallback() {
    this.worker?.terminate();
    this.worker = undefined;
    this.usingWorker = false;
    for (const [id, p] of this.pending) {
      this.pending.delete(id);
      try {
        p.resolve(runAnalysis(p.input));
      } catch (e) {
        p.reject(e as Error);
      }
    }
  }

  run(input: AnalysisInput): Promise<Analysis> {
    if (!this.worker) {
      return new Promise((resolve, reject) =>
        setTimeout(() => {
          try {
            resolve(runAnalysis(input));
          } catch (e) {
            reject(e as Error);
          }
        }, 0),
      );
    }
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, input });
      try {
        this.worker!.postMessage({ id, input });
      } catch {
        this.fallback();
      }
    });
  }
}

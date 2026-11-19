import { useState } from 'react';
import { useAnalysis } from '../../app/AnalysisContext';
import { useApp } from '../../data/store';
import { can } from '../../auth/roles';
import type { ExportSheet } from '../../export/excel';
import { deliver, metaFor, type ReportContext } from '../../export/reports';

/** Exportación a Excel respetando filtros, con metadatos de versión y aviso del resultado. */
export function useExport() {
  const { analysis, filtered } = useAnalysis();
  const filters = useApp((s) => s.filters);
  const active = useApp((s) => s.active);
  const batches = useApp((s) => s.batches);
  const role = useApp((s) => s.role);
  const user = useApp((s) => s.user);
  const toast = useApp((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const allowed = can(role, 'exportar');

  async function run(fileBase: string, title: string, build: (ctx: ReportContext) => ExportSheet[], notes: string[] = []) {
    if (!analysis) return;
    setBusy(true);
    try {
      const ctx: ReportContext = { analysis, filtered, filters, active, batches, user: `${user} (${role})` };
      const res = await deliver(fileBase, build(ctx), metaFor(ctx, title, notes));
      toast(res.outcome === 'guardado' ? 'ok' : res.outcome === 'rechazado' ? 'info' : 'error', res.message);
    } catch (e) {
      toast('error', `No se pudo generar el Excel: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, allowed };
}

import { useMemo, useState } from 'react';
import { useAnalysis } from '../../app/AnalysisContext';
import { can } from '../../auth/roles';
import { useApp } from '../../data/store';
import type { ReviewState } from '../../domain/types';
import { CRIT_LABEL, DISCREPANCY_LABEL, reviewIdFor, type ComparisonRow, type Criticidad, type DiscrepancyType } from '../../engine/comparison';
import { comparisonSheet, discrepancySheet } from '../../export/reports';
import { fmtDateTime } from '../../lib/dates';
import { fmtNum, fmtSigned } from '../../lib/format';
import { searchable } from '../../lib/text';
import { CritPill, Kpi, NoData, Notice, Panel } from '../components/common';
import { DataTable, type Column } from '../components/DataTable';
import { Icon } from '../components/Icon';
import { OperationDetail } from '../components/OperationDetail';
import { useExport } from '../components/useExport';
import { FiltersRow, PageHead } from './shared';

const LEVEL: Record<ComparisonRow['level'], string> = {
  operacion: 'Operación',
  orden: 'Orden',
  solo_produccion: 'Solo producción',
  solo_ortems: 'Solo Ortems',
  ambigua: 'Ambigua',
  recurso: 'Recurso',
};

export function ComparadorPage({ onFilters }: { onFilters: () => void }) {
  const { analysis: a, filtered } = useAnalysis();
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const reviews = useApp((s) => s.reviews);
  const setReview = useApp((s) => s.setReview);
  const role = useApp((s) => s.role);
  const [crit, setCrit] = useState<Criticidad | 'todas' | 'coincide'>('todas');
  const [type, setType] = useState<DiscrepancyType | 'todas'>('todas');
  const [level, setLevel] = useState<ComparisonRow['level'] | 'todos'>('todos');
  const [rev, setRev] = useState<ReviewState | 'todos'>('todos');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<ComparisonRow>();
  const exp = useExport();

  const rows = useMemo(() => {
    if (!a) return [];
    const s = searchable(q);
    return a.comparison.rows.filter((r) => {
      if (filtered?.active) {
        if (r.opKey && !filtered.ops.has(r.opKey)) return false;
        if (!r.opKey && r.ordenId && r.level !== 'solo_ortems' && r.level !== 'ambigua' && !filtered.ordenes.has(r.ordenId)) return false;
        if ((r.level === 'solo_ortems' || r.level === 'ambigua') && !r.ortemsRids.some((x) => filtered.ortemsOnly.has(x))) return false;
        if (r.level === 'recurso' && r.puestoProd && !filtered.puestos.has(r.puestoProd)) return false;
      }
      if (crit === 'coincide' ? !r.coincide : crit !== 'todas' && r.criticidad !== crit) return false;
      if (type !== 'todas' && !r.discrepancies.some((d) => d.type === type)) return false;
      if (level !== 'todos' && r.level !== level) return false;
      if (rev !== 'todos' && (reviews[reviewIdFor(r)]?.state ?? 'pendiente') !== rev) return false;
      if (s && !searchable(`${r.aparatoId ?? ''} ${r.ordenId ?? ''} ${r.preordenId ?? ''} ${r.operacionLabel ?? ''} ${r.puestoProd ?? ''} ${r.puestoOrtems ?? ''}`).includes(s)) return false;
      return true;
    });
  }, [a, filtered, crit, type, level, rev, q, reviews]);

  if (!a) return <NoData what="los Excel de producción y de Ortems" />;
  if (!a.ortemsList.length) return <NoData what="el Excel de Ortems (sin él no hay nada que comparar)" />;
  const st = a.comparison.stats;
  const allowedReview = can(role, 'revisar_alertas');
  const cols: Column<ComparisonRow>[] = [
    { id: 'crit', header: 'Criticidad', width: '118px', render: (r) => <CritPill c={r.coincide ? undefined : r.criticidad} />, sort: (r) => (r.criticidad ? ['informativa', 'media', 'alta', 'critica'].indexOf(r.criticidad) : -1) },
    { id: 'ap', header: 'Aparato', width: '78px', render: (r) => <span className="id">{r.aparatoId ?? '—'}</span>, sort: (r) => r.aparatoId },
    { id: 'of', header: 'Orden', width: '96px', render: (r) => <span className="id">{r.ordenId ?? r.preordenId ?? '—'}</span>, sort: (r) => r.ordenId ?? r.preordenId },
    { id: 'op', header: 'Op.', width: '58px', render: (r) => <span className="id">{r.operacionLabel ?? '—'}</span>, sort: (r) => r.operacionLabel },
    { id: 'lv', header: 'Nivel', width: '108px', render: (r) => LEVEL[r.level], sort: (r) => r.level },
    { id: 'pt', header: 'Puesto', width: '78px', render: (r) => <span className="id">{r.puestoProd ?? r.puestoOrtems ?? '—'}{r.puestoOrtems && r.puestoProd && r.puestoOrtems !== r.puestoProd ? `→${r.puestoOrtems}` : ''}</span>, sort: (r) => r.puestoProd ?? r.puestoOrtems },
    { id: 'sec', header: 'Sección', width: '100px', render: (r) => r.seccion ?? (r.puestoProd ? a.model.puestos.get(r.puestoProd)?.seccion : undefined) ?? '—', sort: (r) => r.seccion },
    { id: 'pr', header: 'Prio.', width: '56px', align: 'center', render: (r) => (r.prioridadRaw ? <strong>{r.prioridadRaw}</strong> : '—'), sort: (r) => r.prioridad },
    { id: 'pf', header: 'Fin producción', width: '142px', render: (r) => fmtDateTime(r.prodEnd), sort: (r) => r.prodEnd },
    { id: 'of2', header: 'Fin Ortems', width: '142px', render: (r) => fmtDateTime(r.ortEnd), sort: (r) => r.ortEnd },
    { id: 'df', header: 'Δ fin', width: '84px', align: 'right', render: (r) => (r.dEndWD !== undefined ? fmtSigned(r.dEndWD, 'd', 0) : '—'), sort: (r) => r.dEndWD, title: (r) => (r.dEndH !== undefined ? `${fmtSigned(r.dEndH, 'h')} · positivo = producción más tarde` : undefined) },
    { id: 'tp', header: 'Tipo de discrepancia', width: 'minmax(200px,2fr)', render: (r) => (r.discrepancies.length ? r.discrepancies.map((d) => DISCREPANCY_LABEL[d.type]).join(' · ') : 'Coincide'), title: (r) => r.discrepancies.map((d) => d.message).join(' ') },
    {
      id: 'rv',
      header: 'Revisión',
      width: '124px',
      render: (r) => (
        <select
          className="input input-sm"
          value={reviews[reviewIdFor(r)]?.state ?? 'pendiente'}
          disabled={!allowedReview}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => void setReview(reviewIdFor(r), e.target.value as ReviewState)}
          aria-label="Estado de revisión"
        >
          <option value="pendiente">Pendiente</option>
          <option value="revisada">Revisada</option>
          <option value="descartada">Descartada</option>
        </select>
      ),
      sort: (r) => reviews[reviewIdFor(r)]?.state ?? 'pendiente',
    },
  ];
  const detailOp = (r: ComparisonRow): { opKey?: string; ortemsRid?: string } | undefined => {
    if (r.opKey) return { opKey: r.opKey };
    if ((r.level === 'orden' || r.level === 'solo_produccion') && r.ordenId) {
      const k = a.model.ordenes.get(r.ordenId)?.opKeys[0];
      if (k) return { opKey: k };
    }
    if (r.ortemsRids[0]) return { ortemsRid: r.ortemsRids[0] };
    return undefined;
  };
  const types = [...new Set(a.comparison.rows.flatMap((r) => r.discrepancies.map((d) => d.type)))];
  return (
    <div className="page">
      <PageHead
        eyebrow="Análisis"
        title="Comparador producción vs. Ortems"
        lead="Correspondencia por identificadores exactos (orden + operación, orden, preorden). Las coincidencias ambiguas no se emparejan automáticamente. Desfase = producción − Ortems."
        actions={
          <>
            <button className="btn" disabled={!exp.allowed || exp.busy} onClick={() => void exp.run('comparacion_ortems', 'Comparación producción vs. Ortems', (ctx) => [comparisonSheet(ctx.analysis, rows, reviews, reviewIdFor)], [`Tolerancia: ${settings.tolerance.value} ${settings.tolerance.unit === 'horas' ? 'horas' : 'días laborables'}`])}>
              <Icon name="download" /> Exportar comparación
            </button>
            <button className="btn" disabled={!exp.allowed || exp.busy} onClick={() => void exp.run('discrepancias', 'Informe de discrepancias', () => [discrepancySheet(rows.filter((r) => r.discrepancies.length))])}>
              <Icon name="download" /> Informe de discrepancias
            </button>
          </>
        }
      />
      <FiltersRow onFilters={onFilters} />
      <div className="grid grid-kpi">
        <Kpi label="Emparejadas" value={fmtNum(st.emparejadas)} sub={`${fmtNum(a.match.opMatches.size)} por operación · ${fmtNum(a.match.ordenMatches.size)} por orden`} />
        <Kpi label="Coinciden" value={fmtNum(st.coincidentes)} onClick={() => setCrit('coincide')} />
        <Kpi label="Con desviación" value={fmtNum(st.conDesviacion)} state={st.conDesviacion ? 'high' : undefined} onClick={() => setLevel('operacion')} />
        <Kpi label="Solo en producción" value={fmtNum(st.soloProduccion)} onClick={() => setLevel('solo_produccion')} />
        <Kpi label="Solo en Ortems" value={fmtNum(st.soloOrtems)} state={a.comparison.rows.some((r) => r.level === 'solo_ortems' && r.criticidad === 'critica') ? 'crit' : undefined} onClick={() => setLevel('solo_ortems')} />
        <Kpi label="Ambiguas" value={fmtNum(st.ambiguas)} state={st.ambiguas ? 'med' : undefined} sub="requieren validación" onClick={() => setLevel('ambigua')} />
      </div>
      <Panel
        title="Tolerancia"
        sub="Dos fechas se consideran coincidentes si su diferencia no supera la tolerancia."
        actions={
          <div className="row">
            <input
              type="number"
              min={0}
              step={0.5}
              className="input input-sm"
              style={{ width: 80 }}
              value={settings.tolerance.value}
              disabled={!can(role, 'configurar_capacidad')}
              onChange={(e) => void setSettings({ ...settings, tolerance: { ...settings.tolerance, value: Math.max(0, Number(e.target.value) || 0) } })}
              aria-label="Valor de tolerancia"
            />
            <select className="input input-sm" style={{ width: 'auto' }} value={settings.tolerance.unit} disabled={!can(role, 'configurar_capacidad')} onChange={(e) => void setSettings({ ...settings, tolerance: { ...settings.tolerance, unit: e.target.value as 'horas' | 'dias_laborables' } })} aria-label="Unidad de tolerancia">
              <option value="dias_laborables">días laborables</option>
              <option value="horas">horas</option>
            </select>
            <span className="small muted">Alta criticidad a partir de {settings.highDeviationDays} días laborables.</span>
          </div>
        }
      >
        {a.match.ambiguous.length > 0 && <Notice kind="warn">{a.match.ambiguous.length} registro(s) de Ortems tienen varias candidatas en producción con la misma regla. No se han emparejado: revise los identificadores o las reglas de correspondencia en Configuración.</Notice>}
        <div className="row" style={{ marginTop: a.match.ambiguous.length ? 10 : 0 }}>
          <input className="input input-sm" style={{ maxWidth: 260 }} placeholder="Buscar aparato, orden, puesto…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar en la comparación" />
          <select className="input input-sm" style={{ width: 'auto' }} value={crit} onChange={(e) => setCrit(e.target.value as typeof crit)} aria-label="Criticidad">
            <option value="todas">Todas las criticidades</option>
            <option value="coincide">Solo coincidentes</option>
            {(['critica', 'alta', 'media', 'informativa'] as Criticidad[]).map((c) => (
              <option key={c} value={c}>
                {CRIT_LABEL[c]}
              </option>
            ))}
          </select>
          <select className="input input-sm" style={{ width: 'auto' }} value={type} onChange={(e) => setType(e.target.value as typeof type)} aria-label="Tipo de discrepancia">
            <option value="todas">Todos los tipos</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {DISCREPANCY_LABEL[t]}
              </option>
            ))}
          </select>
          <select className="input input-sm" style={{ width: 'auto' }} value={level} onChange={(e) => setLevel(e.target.value as typeof level)} aria-label="Nivel">
            <option value="todos">Todos los niveles</option>
            {(Object.keys(LEVEL) as ComparisonRow['level'][]).map((l) => (
              <option key={l} value={l}>
                {LEVEL[l]}
              </option>
            ))}
          </select>
          <select className="input input-sm" style={{ width: 'auto' }} value={rev} onChange={(e) => setRev(e.target.value as typeof rev)} aria-label="Estado de revisión">
            <option value="todos">Cualquier revisión</option>
            <option value="pendiente">Pendiente</option>
            <option value="revisada">Revisada</option>
            <option value="descartada">Descartada</option>
          </select>
          <span className="small muted">{fmtNum(rows.length)} filas</span>
        </div>
      </Panel>
      <Panel flush>
        <DataTable label="Comparación producción vs. Ortems" rows={rows} columns={cols} rowKey={(r) => r.id} onRowClick={setSel} selectedKey={sel?.id} height={560} minWidth={1530} initialSort={{ id: 'crit', dir: -1 }} />
      </Panel>
      {sel && detailOp(sel) && <OperationDetail analysis={a} opKey={detailOp(sel)!.opKey} ortemsRid={detailOp(sel)!.ortemsRid} onClose={() => setSel(undefined)} />}
      {sel && !detailOp(sel) && (
        <Panel title="Detalle" actions={<button className="btn btn-sm" onClick={() => setSel(undefined)}>Cerrar</button>}>
          {sel.discrepancies.map((d, i) => (
            <p key={i}>
              <CritPill c={d.criticidad} /> {d.message}
            </p>
          ))}
        </Panel>
      )}
    </div>
  );
}

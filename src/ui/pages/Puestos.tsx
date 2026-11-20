import { useMemo, useState } from 'react';
import { useAnalysis } from '../../app/AnalysisContext';
import { go } from '../../app/router';
import { useApp } from '../../data/store';
import { CONFIANZA_LABEL } from '../../engine/bottlenecks';
import { sortedCells } from '../../engine/load';
import { OVERLAP_LABEL } from '../../engine/overlaps';
import { loadSheet } from '../../export/reports';
import { addDays, fmtDateTime, weekLabel } from '../../lib/dates';
import { fmtHours, fmtNum, fmtPct } from '../../lib/format';
import { PeriodColumns } from '../components/charts';
import { ConfPill, EstadoPill, NoData, Notice, Panel } from '../components/common';
import { DataTable, type Column } from '../components/DataTable';
import { Icon } from '../components/Icon';
import { OperationDetail } from '../components/OperationDetail';
import { useExport } from '../components/useExport';
import { FiltersRow, PageHead, useFilteredLoad } from './shared';
import { naturalCompare } from '../../lib/text';

export function PuestosPage({ onFilters }: { onFilters: () => void }) {
  const { analysis: a, filtered } = useAnalysis();
  const load = useFilteredLoad(a, filtered);
  const selected = useApp((s) => s.selectedPuesto);
  const select = useApp((s) => s.selectPuesto);
  const filters = useApp((s) => s.filters);
  const setFilters = useApp((s) => s.setFilters);
  const [op, setOp] = useState<string>();
  const exp = useExport();

  const rows = useMemo(() => {
    if (!a || !load) return [];
    const ids = new Set([...a.model.puestos.keys(), ...load.puestos.keys()]);
    return [...ids]
      .filter((id) => !filtered?.active || filtered.puestos.has(id))
      .map((id) => {
        const p = a.model.puestos.get(id);
        const rl = load.puestos.get(id);
        const rk = a.bottlenecks.ranking.find((r) => r.id === id);
        const cap = a.settings.capacities[id];
        const ops = (p?.opKeys ?? []).filter((k) => !filtered?.active || filtered.ops.has(k));
        const conflicts = a.overlaps.produccion.filter((g) => g.puestoId === id && g.clase !== 'solape_dentro_capacidad').length;
        return { id, p, rl, rk, cap, ops: ops.length, conflicts };
      })
      .sort((x, y) => (y.rk?.peakOccupancy ?? -1) - (x.rk?.peakOccupancy ?? -1) || naturalCompare(x.id, y.id));
  }, [a, load, filtered]);

  if (!a || !load) return <NoData />;
  type R = (typeof rows)[number];
  const cols: Column<R>[] = [
    { id: 'id', header: 'Puesto', width: '78px', render: (r) => <span className="id">{r.id}</span>, sort: (r) => r.id },
    { id: 'desc', header: 'Descripción', width: 'minmax(150px,1.4fr)', render: (r) => r.p?.desc ?? '—', sort: (r) => r.p?.desc },
    { id: 'sec', header: 'Sección', width: 'minmax(100px,1fr)', render: (r) => r.p?.seccion ?? '—', sort: (r) => r.p?.seccion },
    { id: 'ops', header: 'Operac.', width: '76px', align: 'right', render: (r) => fmtNum(r.ops), sort: (r) => r.ops },
    { id: 'h', header: 'Horas', width: '84px', align: 'right', render: (r) => fmtHours(r.rl?.totalH), sort: (r) => r.rl?.totalH },
    {
      id: 'cap',
      header: 'Capacidad',
      width: '150px',
      render: (r) => (r.cap ? `${r.cap.units} ud. · ${r.cap.hoursPerWeekday[1] ?? 0} h/día` : <span className="pill pill-outline"><span className="g">?</span>Sin configurar</span>),
      sort: (r) => (r.cap ? r.cap.units * (r.cap.hoursPerWeekday[1] ?? 0) : -1),
    },
    { id: 'peak', header: 'Pico (horiz.)', width: '104px', align: 'right', render: (r) => (r.rk?.peakOccupancy !== undefined ? <strong style={{ color: r.rk.peakOccupancy > 1 ? 'var(--crit-text)' : undefined }}>{fmtPct(r.rk.peakOccupancy)}</strong> : '—'), sort: (r) => r.rk?.peakOccupancy },
    { id: 'ov', header: 'Solapes', width: '76px', align: 'right', render: (r) => r.conflicts, sort: (r) => r.conflicts },
    { id: 'diag', header: 'Diagnóstico', width: 'minmax(200px,1.6fr)', render: (r) => r.rk?.label ?? 'Sin carga', sort: (r) => r.rk?.label },
  ];
  const sel = selected && rows.find((r) => r.id === selected) ? rows.find((r) => r.id === selected)! : rows[0];
  return (
    <div className="page">
      <PageHead
        eyebrow="Fabricación"
        title="Puestos de trabajo"
        lead="Carga, capacidad y solapamientos de cada recurso. Sin capacidad configurada se muestra la carga, pero no se confirma saturación."
        actions={
          <button className="btn" disabled={!exp.allowed || exp.busy} onClick={() => void exp.run('carga_puestos', 'Análisis de carga por puesto', (ctx) => [loadSheet(ctx.analysis, 'puesto', 'semana', 'produccion'), loadSheet(ctx.analysis, 'puesto', 'dia', 'produccion')])}>
            <Icon name="download" /> Exportar carga por puesto
          </button>
        }
      />
      <FiltersRow onFilters={onFilters} />
      <Panel flush>
        <DataTable label="Puestos de trabajo" rows={rows} columns={cols} rowKey={(r) => r.id} onRowClick={(r) => select(r.id)} selectedKey={sel?.id} height={380} minWidth={1060} />
      </Panel>
      {sel && <PuestoDetail id={sel.id} onOp={setOp} onGantt={() => { setFilters({ ...filters, puestos: [sel.id] }); go('gantt'); }} />}
      {op && <OperationDetail analysis={a} opKey={op} onClose={() => setOp(undefined)} />}
    </div>
  );

  function PuestoDetail({ id, onOp, onGantt }: { id: string; onOp: (k: string) => void; onGantt: () => void }) {
    const rl = load!.puestos.get(id);
    const p = a!.model.puestos.get(id);
    const rk = a!.bottlenecks.ranking.find((r) => r.id === id);
    const weeks = rl ? sortedCells(rl, 'semana').filter((c) => c.start >= addDays(a!.refMs, -42)).slice(0, 20) : [];
    const ops = (p?.opKeys ?? []).filter((k) => !filtered?.active || filtered.ops.has(k)).map((k) => a!.model.ops.get(k)!).sort((x, y) => (x.start ?? Infinity) - (y.start ?? Infinity));
    const groups = a!.overlaps.produccion.filter((g) => g.puestoId === id && g.clase !== 'solape_dentro_capacidad');
    type O = (typeof ops)[number];
    const oc: Column<O>[] = [
      { id: 'ap', header: 'Aparato', width: '84px', render: (o) => <span className="id">{o.aparatoId ?? '—'}</span>, sort: (o) => o.aparatoId },
      { id: 'of', header: 'Orden / op.', width: '130px', render: (o) => <span className="id">{o.ordenId}/{o.label}</span>, sort: (o) => o.ordenId },
      { id: 'd', header: 'Descripción', width: 'minmax(140px,1fr)', render: (o) => o.desc ?? '—' },
      { id: 's', header: 'Inicio', width: '130px', render: (o) => fmtDateTime(o.start), sort: (o) => o.start },
      { id: 'e', header: 'Fin', width: '130px', render: (o) => fmtDateTime(o.end), sort: (o) => o.end },
      { id: 'h', header: 'Horas', width: '74px', align: 'right', render: (o) => fmtHours(a!.opFlags.get(o.key)?.hours), sort: (o) => a!.opFlags.get(o.key)?.hours },
      { id: 'st', header: 'Estado', width: '120px', render: (o) => <EstadoPill e={o.estado} raw={o.estadoRaw} /> },
      { id: 'ov', header: 'Solape', width: 'minmax(150px,1fr)', render: (o) => { const g = a!.overlapByOp.get(o.key); return g && g.clase !== 'solape_dentro_capacidad' ? OVERLAP_LABEL[g.clase] : '—'; } },
    ];
    return (
      <>
        <Panel
          title={`Puesto ${id} · ${p?.desc ?? ''}`}
          sub={`${p?.seccion ?? 'Sin sección'}${p?.area ? ` · ${p.area}` : ''}${p?.centro ? ` · ${p.centro}` : ''}`}
          actions={
            <>
              {rk && <ConfPill c={rk.confianza} />}
              <button className="btn btn-sm" onClick={onGantt}>
                Ver en el Gantt
              </button>
            </>
          }
        >
          <div className="stack">
            {rl?.capSource === 'desconocida' && <Notice kind="warn">Este puesto no tiene capacidad configurada: la ocupación no se puede calcular. Configúrela en «Configuración › Capacidad».</Notice>}
            {rl?.capSource === 'supuesta' && <Notice kind="info">Capacidad supuesta (no configurada): los porcentajes son estimados.</Notice>}
            <PeriodColumns
              data={weeks.map((c) => ({ key: c.key, label: weekLabel(c.key).split(' ')[0], value: c.loadH, cap: c.capacityH, title: `${weekLabel(c.key)} · ${c.ids.length} operaciones${c.estimatedH ? ` · ${fmtHours(c.estimatedH)} estimadas` : ''}` }))}
              ariaLabel={`Carga semanal del puesto ${id}`}
            />
            <span className="small muted">
              {rk ? `${rk.label}. ${rk.peakPeriod ? `Pico ${fmtPct(rk.peakOccupancy)} en ${weekLabel(rk.peakPeriod)}.` : ''} Certeza: ${CONFIANZA_LABEL[rk.confianza].toLowerCase()}.` : ''}
              {rl?.unscheduledIds.length ? ` ${rl.unscheduledIds.length} operaciones sin fechas (${fmtHours(rl.unscheduledH)}) no se reparten por periodo.` : ''}
            </span>
          </div>
        </Panel>
        {groups.length > 0 && (
          <Panel title={`Solapamientos conflictivos (${groups.length})`} flush>
            <div className="table-wrap" style={{ maxHeight: 280 }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Clase</th>
                    <th>Periodo</th>
                    <th className="num">Simultáneas</th>
                    <th className="num">Capacidad</th>
                    <th>Operaciones</th>
                  </tr>
                </thead>
                <tbody>
                  {groups
                    .sort((x, y) => x.start - y.start)
                    .map((g) => (
                      <tr key={g.id}>
                        <td>{OVERLAP_LABEL[g.clase]}</td>
                        <td className="nowrap">
                          {fmtDateTime(g.start)} → {fmtDateTime(g.end)}
                        </td>
                        <td className="num">{g.maxConcurrency}</td>
                        <td className="num">{g.units ?? '?'}</td>
                        <td className="small">
                          {g.ids.map((k) => (
                            <button key={k} className="btn btn-ghost btn-sm" style={{ padding: '0 4px' }} onClick={() => onOp(k)}>
                              <span className="id">{k.replace('|', '/')}</span>
                            </button>
                          ))}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
        <Panel title={`Operaciones del puesto (${ops.length})`} flush>
          <DataTable label={`Operaciones del puesto ${id}`} rows={ops} columns={oc} rowKey={(o) => o.key} onRowClick={(o) => onOp(o.key)} height={420} minWidth={1000} />
        </Panel>
      </>
    );
  }
}


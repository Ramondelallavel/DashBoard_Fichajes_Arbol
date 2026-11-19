import { useState } from 'react';
import { useAnalysis } from '../../app/AnalysisContext';
import { go } from '../../app/router';
import { useApp } from '../../data/store';
import { CONFIANZA_LABEL, type ResourceRanking } from '../../engine/bottlenecks';
import { OVERLAP_LABEL } from '../../engine/overlaps';
import { bottleneckSheets } from '../../export/reports';
import { fmtDateTime, weekLabel } from '../../lib/dates';
import { fmtHours, fmtNum, fmtPct } from '../../lib/format';
import { ConfPill, NoData, Notice, Panel, Seg } from '../components/common';
import { DataTable, type Column } from '../components/DataTable';
import { Icon } from '../components/Icon';
import { OperationDetail } from '../components/OperationDetail';
import { useExport } from '../components/useExport';
import { PageHead } from './shared';

export function CuellosPage() {
  const { analysis: a } = useAnalysis();
  const [src, setSrc] = useState<'produccion' | 'combinada'>('produccion');
  const [op, setOp] = useState<string>();
  const selectPuesto = useApp((s) => s.selectPuesto);
  const exp = useExport();
  if (!a) return <NoData />;
  const b = src === 'produccion' ? a.bottlenecks : a.bottlenecksCombined;
  const conflicts = a.overlaps.produccion.filter((g) => g.clase !== 'solape_dentro_capacidad' && g.end >= a.refMs).sort((x, y) => (x.clase === 'sobrecarga_confirmada' ? -1 : 1) - (y.clase === 'sobrecarga_confirmada' ? -1 : 1) || x.start - y.start);
  const unknown = b.ranking.filter((r) => r.capSource === 'desconocida' && r.futureH > 0);
  const cols = (scope: 'puesto' | 'seccion'): Column<ResourceRanking>[] => [
    { id: 'id', header: scope === 'puesto' ? 'Puesto' : 'Sección', width: scope === 'puesto' ? '80px' : 'minmax(120px,1fr)', render: (r) => <span className="id">{r.id}</span>, sort: (r) => r.id },
    ...(scope === 'puesto' ? [{ id: 'desc', header: 'Descripción', width: 'minmax(140px,1fr)', render: (r: ResourceRanking) => a.model.puestos.get(r.id)?.desc ?? '—' }] : []),
    { id: 'diag', header: 'Diagnóstico', width: 'minmax(220px,2fr)', render: (r) => r.label, sort: (r) => r.label },
    { id: 'conf', header: 'Certeza', width: '170px', render: (r) => <ConfPill c={r.confianza} />, sort: (r) => r.confianza },
    { id: 'peak', header: 'Pico', width: '72px', align: 'right', render: (r) => (r.peakOccupancy !== undefined ? <strong style={{ color: r.peakOccupancy > 1 ? 'var(--crit-text)' : undefined }}>{fmtPct(r.peakOccupancy)}</strong> : '—'), sort: (r) => r.peakOccupancy },
    { id: 'pw', header: 'Semana pico', width: '96px', render: (r) => (r.peakPeriod ? weekLabel(r.peakPeriod) : '—'), sort: (r) => r.peakPeriod },
    { id: 'ow', header: 'Sem. sobrecarga', width: '104px', align: 'right', render: (r) => r.overloadedWeeks, sort: (r) => r.overloadedWeeks },
    { id: 'ov', header: 'Solapes', width: '70px', align: 'right', render: (r) => r.overlapConflicts, sort: (r) => r.overlapConflicts },
    { id: 'fh', header: 'Carga futura', width: '96px', align: 'right', render: (r) => fmtHours(r.futureH), sort: (r) => r.futureH },
    { id: 'free', header: 'Cap. libre', width: '90px', align: 'right', render: (r) => (r.freeCapacityH !== undefined ? fmtHours(r.freeCapacityH) : '—'), sort: (r) => r.freeCapacityH },
    { id: 'ap', header: 'Aparatos', width: '76px', align: 'right', render: (r) => r.aparatos, sort: (r) => r.aparatos },
  ];
  return (
    <div className="page">
      <PageHead
        eyebrow="Análisis preventivo"
        title="Cuellos de botella"
        lead={`Saturaciones previstas en las próximas ${a.settings.horizonWeeks} semanas y recursos con trabajos incompatibles. «Confirmado» exige capacidad configurada; sin ella se informa de la carga como hipótesis.`}
        actions={
          <>
            <Seg label="Base de cálculo" value={src} onChange={setSrc} items={[{ id: 'produccion', label: 'Producción' }, { id: 'combinada', label: 'Producción + solo-Ortems', title: 'Suma la carga de órdenes y preórdenes que solo están en Ortems' }]} />
            <button className="btn" disabled={!exp.allowed || exp.busy} onClick={() => void exp.run('cuellos_botella', 'Cuellos de botella', (ctx) => bottleneckSheets(ctx.analysis))}>
              <Icon name="download" /> Exportar listado
            </button>
          </>
        }
      />
      <Panel title="Avisos de saturación futura" sub="Cada mensaje está respaldado por el cálculo de carga/capacidad o de simultaneidad">
        {b.forecasts.length ? (
          <div className="stack">
            {b.forecasts.slice(0, 40).map((f) => (
              <div key={f.id} className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', gap: 12 }}>
                <ConfPill c={f.confianza} />
                <div style={{ minWidth: 0 }}>
                  <div>{f.message}</div>
                  <div className="small muted">{f.ids.length} operaciones implicadas · {f.scope === 'puesto' ? 'puesto' : 'sección'} {f.entityId}</div>
                </div>
                {f.scope === 'puesto' && (
                  <button
                    className="btn btn-sm"
                    style={{ marginLeft: 'auto' }}
                    onClick={() => {
                      selectPuesto(f.entityId);
                      go('puestos');
                    }}
                  >
                    Ver puesto
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <Notice kind="ok">No se prevén saturaciones ni conflictos de recurso en el horizonte analizado.</Notice>
        )}
      </Panel>
      {unknown.length > 0 && (
        <Notice kind="warn">
          {unknown.length} puesto(s) con carga futura no tienen capacidad configurada ({unknown.map((u) => u.id).join(', ')}): no se puede confirmar si son cuellos de botella. Configure su capacidad o active la capacidad supuesta (los resultados serían estimados).
        </Notice>
      )}
      <Panel title="Puestos ordenados por ocupación prevista" flush>
        <DataTable label="Ranking de puestos" rows={b.ranking} columns={cols('puesto')} rowKey={(r) => r.id} height={420} minWidth={1240} onRowClick={(r) => { selectPuesto(r.id); go('puestos'); }} />
      </Panel>
      <Panel title="Secciones ordenadas por ocupación prevista" flush>
        <DataTable label="Ranking de secciones" rows={b.seccionRanking} columns={cols('seccion')} rowKey={(r) => r.id} height={300} minWidth={1100} />
      </Panel>
      <Panel title={`Operaciones que necesitan el mismo recurso en periodos incompatibles (${conflicts.length})`} sub="Planificación de producción, desde la fecha de referencia" flush>
        <div className="table-wrap" style={{ maxHeight: 420 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Clase</th>
                <th>Puesto</th>
                <th>Periodo</th>
                <th>Pico de simultaneidad</th>
                <th className="num">Simult.</th>
                <th className="num">Unidades</th>
                <th>Operaciones</th>
              </tr>
            </thead>
            <tbody>
              {conflicts.map((g) => (
                <tr key={g.id}>
                  <td>
                    {g.clase === 'sobrecarga_confirmada' ? <ConfPill c="confirmado" /> : g.clase === 'sobrecarga_estimada' ? <ConfPill c="estimado" /> : <ConfPill c="sin_capacidad" />}
                    <div className="small muted">{OVERLAP_LABEL[g.clase]}</div>
                  </td>
                  <td className="id">{g.puestoId}</td>
                  <td className="nowrap small">
                    {fmtDateTime(g.start)} → {fmtDateTime(g.end)}
                  </td>
                  <td className="nowrap small">
                    {fmtDateTime(g.peakStart)} → {fmtDateTime(g.peakEnd)}
                  </td>
                  <td className="num">{g.maxConcurrency}</td>
                  <td className="num">{g.units ?? '?'}</td>
                  <td className="small">
                    {g.ids.map((k) => (
                      <button key={k} className="btn btn-ghost btn-sm" style={{ padding: '0 4px' }} onClick={() => setOp(k)}>
                        <span className="id">{k.replace('|', '/')}</span>
                      </button>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!conflicts.length && <div className="empty">Sin solapamientos conflictivos.</div>}
        </div>
      </Panel>
      <Panel title="Análisis por aparato">
        <div className="row">
          <span>El análisis de puestos, esperas y dependencias de un aparato concreto está en su ficha.</span>
          <button className="btn btn-sm" onClick={() => go('aparato')}>
            Abrir ficha de aparato
          </button>
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          Criterios: ocupación = horas previstas / capacidad del periodo (horas por unidad × unidades × eficiencia, descontando festivos y paradas). Riesgo a partir del {fmtNum(a.settings.riskThreshold * 100)} %. {CONFIANZA_LABEL.estimado}: capacidad supuesta o parcial, o más de la mitad de la carga con duración estimada.
        </p>
      </Panel>
      {op && <OperationDetail analysis={a} opKey={op} onClose={() => setOp(undefined)} />}
    </div>
  );
}

import { useEffect, useId, useMemo, useState } from 'react';
import { useAnalysis } from '../../app/AnalysisContext';
import { go } from '../../app/router';
import { useApp } from '../../data/store';
import { planningSheet, treeSheet } from '../../export/reports';
import { fmtDate } from '../../lib/dates';
import { naturalCompare, searchable } from '../../lib/text';
import { EstadoPill, NoData, Notice } from '../components/common';
import { Icon } from '../components/Icon';
import { useExport } from '../components/useExport';
import { GanttView } from '../gantt/GanttView';
import { FiltersRow, PageHead } from './shared';

export function GanttGeneralPage({ onFilters }: { onFilters: () => void }) {
  const { analysis: a, filtered } = useAnalysis();
  const exp = useExport();
  if (!a) return <NoData />;
  return (
    <div className="page">
      <PageHead
        eyebrow="Planificación"
        title="Gantt general"
        lead="Vista de fábrica desplegable por aparato, familia, sección, puesto u orden. Compare la planificación de producción (azul) con la de Ortems (naranja con trama)."
        actions={
          <button className="btn" disabled={!exp.allowed || exp.busy} onClick={() => void exp.run('planificacion_gantt', 'Planificación (Gantt)', (ctx) => [planningSheet(ctx)])}>
            <Icon name="download" /> Exportar planificación
          </button>
        }
      />
      <FiltersRow onFilters={onFilters} />
      <GanttView analysis={a} filtered={filtered} defaultScale="mes" />
    </div>
  );
}

export function AparatoPicker() {
  const { analysis: a } = useAnalysis();
  const selected = useApp((s) => s.selectedAparato);
  const select = useApp((s) => s.selectAparato);
  const [q, setQ] = useState('');
  const id = useId();
  const list = useMemo(() => {
    if (!a) return [];
    return [...a.model.aparatos.values()].sort((x, y) => naturalCompare(x.id, y.id));
  }, [a]);
  const matches = useMemo(() => {
    const s = searchable(q);
    return s ? list.filter((ap) => searchable(`${ap.id} ${ap.articuloRef ?? ''} ${ap.desc ?? ''} ${ap.familia ?? ''}`).includes(s)).slice(0, 40) : [];
  }, [q, list]);
  useEffect(() => {
    if (!selected && list.length) select(list[0].id);
  }, [selected, list, select]);
  const current = selected ? a?.model.aparatos.get(selected) : undefined;
  return (
    <div className="panel">
      <div className="panel-body row" style={{ alignItems: 'flex-end' }}>
        <div className="field ms" style={{ flex: '1 1 260px', maxWidth: 420 }}>
          <label htmlFor={id}>Buscar aparato (número, artículo, descripción, familia)</label>
          <input id={id} className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${list.length} aparatos`} autoComplete="off" />
          {matches.length > 0 && (
            <div className="ms-pop">
              <div className="ms-list">
                {matches.map((ap) => (
                  <button
                    key={ap.id}
                    className="btn btn-ghost btn-sm"
                    style={{ justifyContent: 'flex-start' }}
                    onClick={() => {
                      select(ap.id);
                      setQ('');
                    }}
                  >
                    <span className="id">{ap.id}</span>&nbsp;<span className="muted">{ap.familia} · {ap.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="field" style={{ flex: '0 1 200px' }}>
          <label htmlFor={`${id}-s`}>o selecciónelo</label>
          <select id={`${id}-s`} className="input" value={selected ?? ''} onChange={(e) => select(e.target.value)}>
            {list.map((ap) => (
              <option key={ap.id} value={ap.id}>
                {ap.id}
              </option>
            ))}
          </select>
        </div>
        {current && (
          <div className="row" style={{ marginLeft: 'auto' }}>
            <span>
              <strong className="id">{current.id}</strong> · {current.familia ?? 'sin familia'} · {current.desc ?? current.articuloRef ?? ''}
            </span>
            <EstadoPill e={current.estado} />
            <span className="small muted">
              {fmtDate(current.start)} → {fmtDate(current.end)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function GanttAparatoPage() {
  const { analysis: a } = useAnalysis();
  const selected = useApp((s) => s.selectedAparato);
  const exp = useExport();
  if (!a) return <NoData />;
  if (!a.model.aparatos.size) return <Notice kind="warn">No hay aparatos identificados en los datos de producción. Revise la asignación de la columna «Número de aparato».</Notice>;
  return (
    <div className="page">
      <PageHead
        eyebrow="Planificación"
        title="Gantt por aparato"
        lead="Todas las órdenes y operaciones del aparato, con sus dependencias: línea continua = confirmada por los datos; discontinua = inferida por regla; roja = precedencia incumplida."
        actions={
          <>
            <button className="btn" onClick={() => go('aparato')} disabled={!selected}>
              Ficha del aparato
            </button>
            <button className="btn" disabled={!exp.allowed || exp.busy || !selected} onClick={() => selected && void exp.run(`arbol_${selected}`, `Árbol de procesos del aparato ${selected}`, (ctx) => [treeSheet(ctx.analysis, selected)])}>
              <Icon name="download" /> Exportar árbol
            </button>
          </>
        }
      />
      <AparatoPicker />
      {selected && <GanttView key={selected} analysis={a} onlyAparato={selected} showDeps compact allowedGroups={['aparato']} expandAllByDefault defaultScale="semana" />}
    </div>
  );
}

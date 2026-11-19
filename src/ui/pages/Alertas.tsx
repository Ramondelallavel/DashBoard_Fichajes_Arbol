import { useMemo, useState } from 'react';
import { useAnalysis } from '../../app/AnalysisContext';
import { go } from '../../app/router';
import { can } from '../../auth/roles';
import { useApp } from '../../data/store';
import type { ReviewState } from '../../domain/types';
import { ALERT_TYPE_LABEL, type Alert, type AlertType } from '../../engine/alerts';
import { CRIT_LABEL, type Criticidad } from '../../engine/comparison';
import { alertsSheet } from '../../export/reports';
import { fmtDate, fmtDateTime } from '../../lib/dates';
import { fmtNum } from '../../lib/format';
import { searchable } from '../../lib/text';
import { CritPill, Drawer, Kpi, NoData, SourcePill } from '../components/common';
import { DataTable, type Column } from '../components/DataTable';
import { Icon } from '../components/Icon';
import { OperationDetail } from '../components/OperationDetail';
import { useExport } from '../components/useExport';
import { PageHead } from './shared';

const REVIEW_LABEL: Record<ReviewState, string> = { pendiente: 'Pendiente', revisada: 'Revisada', descartada: 'Descartada' };

export function AlertasPage() {
  const { analysis: a } = useAnalysis();
  const reviews = useApp((s) => s.reviews);
  const active = useApp((s) => s.active);
  const setReview = useApp((s) => s.setReview);
  const role = useApp((s) => s.role);
  const selectAparato = useApp((s) => s.selectAparato);
  const [crit, setCrit] = useState<Criticidad | 'todas'>('todas');
  const [type, setType] = useState<AlertType | 'todos'>('todos');
  const [rev, setRev] = useState<ReviewState | 'todos'>('pendiente');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Alert>();
  const [note, setNote] = useState('');
  const [op, setOp] = useState<string>();
  const exp = useExport();
  const allowed = can(role, 'revisar_alertas');

  const rows = useMemo(() => {
    if (!a) return [];
    const s = searchable(q);
    return a.alerts.filter((x) => {
      if (crit !== 'todas' && x.criticidad !== crit) return false;
      if (type !== 'todos' && x.type !== type) return false;
      if (rev !== 'todos' && (reviews[x.id]?.state ?? 'pendiente') !== rev) return false;
      if (s && !searchable(`${x.title} ${x.description} ${x.aparatoId ?? ''} ${x.ordenId ?? ''} ${x.puestoId ?? ''} ${x.seccion ?? ''}`).includes(s)) return false;
      return true;
    });
  }, [a, crit, type, rev, q, reviews]);

  if (!a) return <NoData />;
  const count = (c: Criticidad) => a.alerts.filter((x) => x.criticidad === c && (reviews[x.id]?.state ?? 'pendiente') === 'pendiente').length;
  const types = [...new Set(a.alerts.map((x) => x.type))];
  const cols: Column<Alert>[] = [
    { id: 'c', header: 'Criticidad', width: '118px', render: (x) => <CritPill c={x.criticidad} />, sort: (x) => ['informativa', 'media', 'alta', 'critica'].indexOf(x.criticidad) },
    { id: 't', header: 'Tipo', width: '190px', render: (x) => ALERT_TYPE_LABEL[x.type], sort: (x) => ALERT_TYPE_LABEL[x.type] },
    { id: 'd', header: 'Descripción', width: 'minmax(260px,3fr)', render: (x) => x.title, title: (x) => x.description },
    { id: 'ap', header: 'Aparato', width: '78px', render: (x) => <span className="id">{x.aparatoId ?? '—'}</span>, sort: (x) => x.aparatoId },
    { id: 'of', header: 'Orden', width: '92px', render: (x) => <span className="id">{x.ordenId ?? '—'}</span>, sort: (x) => x.ordenId },
    { id: 'pt', header: 'Puesto/sección', width: '110px', render: (x) => <span className="id">{x.puestoId ?? x.seccion ?? '—'}</span>, sort: (x) => x.puestoId ?? x.seccion },
    { id: 'f', header: 'Fecha', width: '90px', render: (x) => fmtDate(x.date), sort: (x) => x.date },
    { id: 's', header: 'Fuente', width: '150px', render: (x) => <SourcePill s={x.fuente} />, sort: (x) => x.fuente },
    { id: 'r', header: 'Revisión', width: '104px', render: (x) => REVIEW_LABEL[reviews[x.id]?.state ?? 'pendiente'], sort: (x) => reviews[x.id]?.state ?? 'pendiente' },
  ];
  const open = (x: Alert) => {
    setSel(x);
    setNote(reviews[x.id]?.note ?? '');
  };
  return (
    <div className="page">
      <PageHead
        eyebrow="Seguimiento"
        title="Alertas e incidencias"
        lead="Alertas calculadas a partir de los datos importados. Cada alerta indica su motivo y su fuente; el estado de revisión se conserva entre importaciones mientras la alerta siga existiendo."
        actions={
          <button className="btn" disabled={!exp.allowed || exp.busy} onClick={() => void exp.run('incidencias', 'Informe de incidencias', () => [alertsSheet(rows, reviews)])}>
            <Icon name="download" /> Exportar incidencias
          </button>
        }
      />
      <div className="grid grid-kpi">
        <Kpi label="Críticas pendientes" value={fmtNum(count('critica'))} state={count('critica') ? 'crit' : undefined} onClick={() => { setCrit('critica'); setRev('pendiente'); }} />
        <Kpi label="Altas pendientes" value={fmtNum(count('alta'))} state={count('alta') ? 'high' : undefined} onClick={() => { setCrit('alta'); setRev('pendiente'); }} />
        <Kpi label="Medias pendientes" value={fmtNum(count('media'))} state={count('media') ? 'med' : undefined} onClick={() => { setCrit('media'); setRev('pendiente'); }} />
        <Kpi label="Informativas pendientes" value={fmtNum(count('informativa'))} onClick={() => { setCrit('informativa'); setRev('pendiente'); }} />
        <Kpi label="Revisadas o descartadas" value={fmtNum(a.alerts.filter((x) => reviews[x.id] && reviews[x.id].state !== 'pendiente').length)} onClick={() => { setCrit('todas'); setRev('revisada'); }} />
      </div>
      <div className="panel">
        <div className="panel-body row">
          <input className="input input-sm" style={{ maxWidth: 280 }} placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar alertas" />
          <select className="input input-sm" style={{ width: 'auto' }} value={crit} onChange={(e) => setCrit(e.target.value as typeof crit)} aria-label="Criticidad">
            <option value="todas">Todas las criticidades</option>
            {(['critica', 'alta', 'media', 'informativa'] as Criticidad[]).map((c) => (
              <option key={c} value={c}>
                {CRIT_LABEL[c]}
              </option>
            ))}
          </select>
          <select className="input input-sm" style={{ width: 'auto' }} value={type} onChange={(e) => setType(e.target.value as typeof type)} aria-label="Tipo">
            <option value="todos">Todos los tipos</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {ALERT_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <select className="input input-sm" style={{ width: 'auto' }} value={rev} onChange={(e) => setRev(e.target.value as typeof rev)} aria-label="Estado de revisión">
            <option value="todos">Cualquier estado</option>
            {(Object.keys(REVIEW_LABEL) as ReviewState[]).map((r) => (
              <option key={r} value={r}>
                {REVIEW_LABEL[r]}
              </option>
            ))}
          </select>
          <span className="small muted">
            {fmtNum(rows.length)} de {fmtNum(a.alerts.length)} alertas
          </span>
        </div>
      </div>
      <div className="panel">
        <DataTable label="Alertas" rows={rows} columns={cols} rowKey={(x) => x.id} onRowClick={open} selectedKey={sel?.id} height={600} minWidth={1300} empty="No hay alertas con estos criterios." />
      </div>
      {sel && (
        <Drawer
          title={sel.title}
          onClose={() => setSel(undefined)}
          footer={
            <>
              <button className="btn" disabled={!allowed} onClick={() => { void setReview(sel.id, 'descartada', note); setSel(undefined); }}>
                Descartar
              </button>
              <button className="btn" disabled={!allowed} onClick={() => { void setReview(sel.id, 'pendiente', note); setSel(undefined); }}>
                Dejar pendiente
              </button>
              <button className="btn btn-primary" disabled={!allowed} onClick={() => { void setReview(sel.id, 'revisada', note); setSel(undefined); }}>
                Marcar como revisada
              </button>
            </>
          }
        >
          <div className="row">
            <CritPill c={sel.criticidad} />
            <span className="pill pill-neutral">{ALERT_TYPE_LABEL[sel.type]}</span>
            <SourcePill s={sel.fuente} />
          </div>
          <p>{sel.description}</p>
          <dl className="kv">
            <dt>Motivo</dt>
            <dd>{sel.motivo}</dd>
            <dt>Aparato</dt>
            <dd className="id">{sel.aparatoId ?? '—'}</dd>
            <dt>Orden</dt>
            <dd className="id">{sel.ordenId ?? '—'}</dd>
            <dt>Operación</dt>
            <dd className="id">{sel.operacionLabel ?? '—'}</dd>
            <dt>Puesto / sección</dt>
            <dd>{sel.puestoId ?? '—'} / {sel.seccion ?? '—'}</dd>
            <dt>Fecha relevante</dt>
            <dd>{fmtDateTime(sel.date)}</dd>
            <dt>Fecha de detección</dt>
            <dd>
              {reviews[sel.id]?.firstSeen
                ? fmtDateTime(new Date(reviews[sel.id].firstSeen).getTime())
                : `Con los datos vigentes (${fmtDateTime(Math.max(...[active.produccion?.createdAt, active.ortems?.createdAt].filter(Boolean).map((d) => new Date(d!).getTime())))})`}
            </dd>
            <dt>Estado de revisión</dt>
            <dd>
              {REVIEW_LABEL[reviews[sel.id]?.state ?? 'pendiente']}
              {reviews[sel.id]?.updatedAt && reviews[sel.id]?.state !== 'pendiente' ? ` · ${reviews[sel.id]?.user} · ${fmtDateTime(new Date(reviews[sel.id]!.updatedAt!).getTime())}` : ''}
            </dd>
            <dt>Registros de origen</dt>
            <dd className="small">{sel.rids.slice(0, 8).join(', ')}{sel.rids.length > 8 ? ` y ${sel.rids.length - 8} más` : ''}</dd>
          </dl>
          <div className="field">
            <label htmlFor="al-note">Nota de revisión</label>
            <textarea id="al-note" className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} disabled={!allowed} />
          </div>
          <div className="row">
            {sel.opKey && (
              <button className="btn btn-sm" onClick={() => setOp(sel.opKey)}>
                Ver operación
              </button>
            )}
            {sel.aparatoId && a.model.aparatos.has(sel.aparatoId) && (
              <button className="btn btn-sm" onClick={() => { selectAparato(sel.aparatoId); go('aparato'); }}>
                Ficha del aparato
              </button>
            )}
          </div>
          {!allowed && <span className="small muted">Su perfil (consulta) no permite revisar alertas.</span>}
        </Drawer>
      )}
      {op && <OperationDetail analysis={a} opKey={op} onClose={() => setOp(undefined)} />}
    </div>
  );
}

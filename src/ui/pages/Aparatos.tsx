import { useMemo, useState } from 'react';
import { useAnalysis } from '../../app/AnalysisContext';
import { go } from '../../app/router';
import { can } from '../../auth/roles';
import { useApp } from '../../data/store';
import { analyzeAparato } from '../../engine/aparato';
import type { Analysis } from '../../engine/analysis';
import { CONFIANZA_LABEL } from '../../engine/bottlenecks';
import { DISCREPANCY_LABEL } from '../../engine/comparison';
import { nodeName, opSpan, type Orden } from '../../engine/model';
import { treeSheet } from '../../export/reports';
import { fmtDate, fmtDateTime, weekLabel } from '../../lib/dates';
import { fmtHours, fmtNum, fmtSigned } from '../../lib/format';
import { naturalCompare } from '../../lib/text';
import { ConfPill, CritPill, EstadoPill, Kpi, LinkPill, NoData, Notice, Panel, Tabs } from '../components/common';
import { DataTable, type Column } from '../components/DataTable';
import { Icon } from '../components/Icon';
import { OperationDetail } from '../components/OperationDetail';
import { useExport } from '../components/useExport';
import { GanttView } from '../gantt/GanttView';
import { FLAG_META, opFlagIds } from '../gantt/rows';
import { AparatoPicker } from './GanttPages';
import { PageHead } from './shared';

/* ---------------- Árbol de procesos ---------------- */

function OpFlags({ a, opKey }: { a: Analysis; opKey: string }) {
  const fl = opFlagIds(a, opKey);
  if (!fl.length) return null;
  return (
    <span className="icons" style={{ display: 'inline-flex', gap: 2 }}>
      {fl.map((f) => (
        <span key={f} className={`gicon ${f}`} title={FLAG_META[f].label} aria-label={FLAG_META[f].label}>
          {FLAG_META[f].glyph}
        </span>
      ))}
    </span>
  );
}

function OrdenNode({ a, o, depth, onOp, seen }: { a: Analysis; o: Orden; depth: number; onOp: (k: string) => void; seen: Set<string> }) {
  const [open, setOpen] = useState(depth < 3);
  const ops = o.opKeys.map((k) => a.model.ops.get(k)!).sort((x, y) => naturalCompare(x.operacionId ?? x.label, y.operacionId ?? y.label));
  const children = o.childIds.map((c) => a.model.ordenes.get(c)!).filter((c) => c && !seen.has(c.id));
  children.forEach((c) => seen.add(c.id));
  const rel = o.parentId || o.parentLink ? o.parentLink ?? 'confirmada' : undefined;
  return (
    <div>
      <div className="tree-node">
        <button className="tree-toggle" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`${open ? 'Contraer' : 'Desplegar'} ${nodeName(o).toLowerCase()}`}>
          {open ? '▾' : '▸'}
        </button>
        <div className="tree-title">
          <strong>
            {o.tipo === 'preorden' ? 'Preorden' : 'Orden'} <span className="id">{o.id}</span>
          </strong>
          <span className="muted small">{o.articuloRef} {o.articuloDesc ? `· ${o.articuloDesc}` : ''}</span>
          {o.tipo === 'orden' && o.preordenId && <span className="tag">preorden {o.preordenId}</span>}
          {o.tipo === 'preorden' && o.ordenId && <span className="tag">OF {o.ordenId}</span>}
          {ops.length === 1 && ops[0].operacionId === undefined && ops[0].seccion && <span className="tag">{ops[0].seccion}</span>}
        </div>
        <div className="tree-meta">
          {rel ? (
            <span title={o.parentRule}>
              <LinkPill s={rel} />
            </span>
          ) : (
            <span className="small muted">{o.tipo === 'preorden' ? 'preorden raíz' : 'orden raíz'}</span>
          )}
          <EstadoPill e={o.estado} />
          <span className="small muted nowrap" title={o.start === undefined && o.realStart !== undefined ? 'Fechas reales (fichajes)' : 'Fechas previstas'}>
            {fmtDate(o.start ?? o.realStart)} → {fmtDate(o.end ?? o.realEnd)}
            {o.start === undefined && o.realStart !== undefined ? ' (real)' : ''}
          </span>
        </div>
      </div>
      {open && (
        <div className="tree-children">
          {o.parentId && (
            <div className="dep" style={{ padding: '2px 8px' }}>
              {o.tipo === 'preorden' ? 'Preorden siguiente' : 'Relación con la orden padre'} <span className="id">{o.parentId}</span>: {o.parentRule}
              {o.parentExternal ? ' · planificada en Ortems, todavía sin fichajes en producción' : ''}
            </div>
          )}
          {ops.map((op) => (
            <div key={op.key} className="tree-node">
              <span className="muted" aria-hidden="true">
                ·
              </span>
              <div className="tree-title" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                <span className="row" style={{ gap: 8 }}>
                  <button className="btn btn-ghost btn-sm" style={{ padding: '0 4px' }} onClick={() => onOp(op.key)}>
                    <span className="id">{op.operacionId !== undefined ? `Op. ${op.label}` : 'Ejecución'}</span>
                  </button>
                  <span>{op.desc}</span>
                  {(op.puestoId || a.model.has.puestos) && <span className="tag">{op.puestoId ?? 'sin puesto'}</span>}
                  {op.avance !== undefined && <span className="small muted">avance {op.avance} %</span>}
                  <span className="small muted">{op.seccion}</span>
                  <OpFlags a={a} opKey={op.key} />
                </span>
                {op.preds.length > 0 && (
                  <span className="dep">
                    {op.preds.map((p, i) => {
                      const pred = p.from ? a.model.ops.get(p.from) : undefined;
                      return (
                        <span key={i} className="row" style={{ gap: 4 }} title={p.regla}>
                          <LinkPill s={p.tipo} />
                          tras <span className="id">{pred ? (pred.ordenId === op.ordenId ? pred.label : `${pred.ordenId}/${pred.label}`) : '¿?'}</span>
                        </span>
                      );
                    })}
                  </span>
                )}
              </div>
              <div className="tree-meta">
                <EstadoPill e={op.estado} raw={op.estadoRaw} />
                <span className="small muted nowrap">
                  {fmtDateTime(opSpan(op)?.start)} → {fmtDateTime(opSpan(op)?.end)}
                  {opSpan(op)?.real ? ' (real)' : ''}
                </span>
              </div>
            </div>
          ))}
          {children.map((c) => (
            <OrdenNode key={c.id} a={a} o={c} depth={depth + 1} onOp={onOp} seen={seen} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ProcessTree({ a, aparatoId }: { a: Analysis; aparatoId: string }) {
  const ap = a.model.aparatos.get(aparatoId);
  const [op, setOp] = useState<string>();
  if (!ap) return null;
  const seen = new Set<string>(ap.rootOrdenIds);
  return (
    <div className="tree">
      <div className="tree-node" style={{ background: 'var(--surface-2)' }}>
        <Icon name="aparato" />
        <div className="tree-title">
          <strong>
            Aparato <span className="id">{ap.id}</span>
          </strong>
          <span className="muted small">{[ap.familia, ap.articuloRef, ap.desc].filter(Boolean).join(' · ')}</span>
        </div>
        <div className="tree-meta">
          <EstadoPill e={ap.estado} />
          <span className="small muted">{ap.ordenIds.length} órdenes</span>
        </div>
      </div>
      <div className="tree-children">
        {ap.rootOrdenIds.map((r) => (
          <OrdenNode key={r} a={a} o={a.model.ordenes.get(r)!} depth={1} onOp={setOp} seen={seen} />
        ))}
      </div>
      {op && <OperationDetail analysis={a} opKey={op} onClose={() => setOp(undefined)} />}
    </div>
  );
}

/** Validación manual de relaciones pendientes (capa separada; nunca modifica el Excel). */
function PendingRelations({ a, aparatoId }: { a: Analysis; aparatoId: string }) {
  const role = useApp((s) => s.role);
  const manual = useApp((s) => s.manual);
  const addManual = useApp((s) => s.addManual);
  const removeManual = useApp((s) => s.removeManual);
  const toast = useApp((s) => s.toast);
  const ap = a.model.aparatos.get(aparatoId)!;
  const [choice, setChoice] = useState<Record<string, string>>({});
  const allowed = can(role, 'validar_relaciones');
  const roots = ap.rootOrdenIds.map((id) => a.model.ordenes.get(id)!);
  const pending = roots.length > 1 ? roots : roots.filter((o) => o.parentLink === 'pendiente');
  const inferred = ap.ordenIds.map((id) => a.model.ordenes.get(id)!).filter((o) => o.aparatoLink === 'inferida');
  const myManual = manual.filter((m) => ap.ordenIds.includes(m.ordenId));
  if (!pending.length && !myManual.length && !inferred.length) return <Notice kind="ok">Todas las relaciones entre las órdenes de este aparato están respaldadas por los datos.</Notice>;
  return (
    <div className="stack">
      {pending.length > 0 && (
        <Notice kind="warn">
          {pending.length > 1
            ? `Las órdenes ${pending.map((o) => o.id).join(', ')} no tienen una relación jerárquica conocida. La aplicación no inventa la estructura: indique la orden padre de cada una o confírmela como independiente.`
            : `La relación de la orden ${pending[0].id} está pendiente: ${pending[0].parentRule}.`}
        </Notice>
      )}
      {pending.map((o) => {
        const options = ap.ordenIds.filter((x) => x !== o.id);
        return (
          <div key={o.id} className="row">
            <span>
              Orden <strong className="id">{o.id}</strong> <span className="muted small">{o.articuloDesc}</span>
            </span>
            <select className="input input-sm" style={{ width: 'auto' }} value={choice[o.id] ?? ''} onChange={(e) => setChoice({ ...choice, [o.id]: e.target.value })} disabled={!allowed} aria-label={`Orden padre de ${o.id}`}>
              <option value="">Elegir relación…</option>
              <option value="__root__">Independiente (orden raíz del aparato)</option>
              {options.map((x) => (
                <option key={x} value={x}>
                  Hija de {x} ({a.model.ordenes.get(x)?.articuloDesc ?? ''})
                </option>
              ))}
            </select>
            <button
              className="btn btn-sm btn-primary"
              disabled={!allowed || !choice[o.id]}
              onClick={() => {
                const v = choice[o.id];
                void addManual({ kind: 'orden-padre', ordenId: o.id, targetId: v === '__root__' ? '' : v, decision: 'confirmada' });
                toast('ok', `Relación de la orden ${o.id} validada manualmente.`);
              }}
            >
              Validar
            </button>
          </div>
        );
      })}
      {inferred.length > 0 && (
        <div className="small">
          Aparato inferido (no confirmado) en: {inferred.map((o) => <span key={o.id} title={o.aparatoRule} className="tag" style={{ marginRight: 4 }}>{o.id}</span>)}
        </div>
      )}
      {myManual.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="eyebrow">Decisiones manuales registradas</span>
          {myManual.map((m) => (
            <div key={m.id} className="row small">
              <LinkPill s="manual" />
              <span>
                Orden <span className="id">{m.ordenId}</span> → {m.targetId ? <>padre <span className="id">{m.targetId}</span></> : 'independiente'} · {m.user} · {fmtDateTime(new Date(m.at).getTime())}
              </span>
              <button className="btn btn-ghost btn-sm" disabled={!allowed} onClick={() => void removeManual(m.id)}>
                Deshacer
              </button>
            </div>
          ))}
        </div>
      )}
      {!allowed && <span className="small muted">Su perfil no permite validar relaciones.</span>}
    </div>
  );
}

function OrphanOrders({ a }: { a: Analysis }) {
  const role = useApp((s) => s.role);
  const addManual = useApp((s) => s.addManual);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const orphans = [...a.model.ordenes.values()].filter((o) => !o.aparatoId);
  if (!orphans.length) return null;
  const aps = [...a.model.aparatos.keys()].sort(naturalCompare);
  return (
    <Panel title={`Órdenes sin aparato (${orphans.length})`} sub="No se ha podido determinar el aparato a partir de los datos ni de las reglas activas.">
      <div className="stack">
        {orphans.map((o) => (
          <div className="row" key={o.id}>
            <span>
              Orden <strong className="id">{o.id}</strong> <span className="muted small">{o.articuloRef} {o.articuloDesc}</span>
            </span>
            {o.aparatoRule && <span className="small muted">{o.aparatoRule}</span>}
            <select className="input input-sm" style={{ width: 'auto' }} value={choice[o.id] ?? ''} onChange={(e) => setChoice({ ...choice, [o.id]: e.target.value })} disabled={!can(role, 'validar_relaciones')} aria-label={`Aparato de la orden ${o.id}`}>
              <option value="">Asignar a aparato…</option>
              {aps.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
            <button className="btn btn-sm" disabled={!choice[o.id]} onClick={() => void addManual({ kind: 'orden-aparato', ordenId: o.id, targetId: choice[o.id], decision: 'confirmada' })}>
              Asignar
            </button>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function ArbolPage() {
  const { analysis: a } = useAnalysis();
  const selected = useApp((s) => s.selectedAparato);
  const select = useApp((s) => s.selectAparato);
  const exp = useExport();
  const rows = useMemo(() => {
    if (!a) return [];
    return [...a.model.aparatos.values()].map((ap) => {
      const pend = ap.rootOrdenIds.length > 1 || ap.ordenIds.some((id) => a.model.ordenes.get(id)?.parentLink === 'pendiente');
      const alerts = a.alerts.filter((x) => x.aparatoId === ap.id && (x.criticidad === 'critica' || x.criticidad === 'alta')).length;
      return { ap, pend, alerts };
    });
  }, [a]);
  if (!a) return <NoData />;
  type R = (typeof rows)[number];
  const cols: Column<R>[] = [
    { id: 'id', header: 'Aparato', width: '96px', render: (r) => <span className="id">{r.ap.id}</span>, sort: (r) => r.ap.id },
    { id: 'fam', header: 'Familia', width: 'minmax(110px,1fr)', render: (r) => r.ap.familia ?? '—', sort: (r) => r.ap.familia },
    { id: 'ord', header: 'Órd.', width: '52px', align: 'right', render: (r) => r.ap.ordenIds.length, sort: (r) => r.ap.ordenIds.length },
    { id: 'rel', header: 'Árbol', width: '92px', render: (r) => (r.pend ? <LinkPill s="pendiente" /> : <LinkPill s="confirmada" />), sort: (r) => (r.pend ? 0 : 1) },
    { id: 'al', header: 'Alertas', width: '64px', align: 'right', render: (r) => (r.alerts ? <strong style={{ color: 'var(--crit-text)' }}>{r.alerts}</strong> : '0'), sort: (r) => r.alerts },
  ];
  const pendingCount = rows.filter((r) => r.pend).length;
  return (
    <div className="page">
      <PageHead
        eyebrow="Fabricación"
        title="Árbol de procesos"
        lead="Estructura de fabricación reconstruida a partir de los datos: aparato → órdenes → operaciones, con dependencias. Las relaciones sin respaldo en el Excel quedan pendientes de validar."
        actions={
          <>
            <button className="btn" disabled={!selected} onClick={() => go('aparato')}>
              Ficha completa
            </button>
            <button className="btn" disabled={!exp.allowed || exp.busy || !selected} onClick={() => selected && void exp.run(`arbol_${selected}`, `Árbol de procesos del aparato ${selected}`, (ctx) => [treeSheet(ctx.analysis, selected)])}>
              <Icon name="download" /> Exportar árbol
            </button>
          </>
        }
      />
      <div className="grid grid-kpi">
        <Kpi label="Aparatos" value={fmtNum(a.model.aparatos.size)} />
        <Kpi label="Con árbol pendiente de validar" value={fmtNum(pendingCount)} state={pendingCount ? 'med' : undefined} />
        <Kpi label="Relaciones confirmadas" value={fmtNum(a.model.relations.filter((r) => r.status === 'confirmada').length)} />
        <Kpi label="Relaciones inferidas" value={fmtNum(a.model.relations.filter((r) => r.status === 'inferida').length)} sub="por reglas configurables" />
        <Kpi label="Relaciones pendientes" value={fmtNum(a.model.relations.filter((r) => r.status === 'pendiente').length)} state={a.model.relations.some((r) => r.status === 'pendiente') ? 'med' : undefined} />
      </div>
      <div className="grid grid-side">
        <Panel title="Aparatos" flush>
          <DataTable label="Aparatos" rows={rows} columns={cols} rowKey={(r) => r.ap.id} onRowClick={(r) => select(r.ap.id)} selectedKey={selected} height={620} minWidth={360} initialSort={{ id: 'id', dir: 1 }} />
        </Panel>
        <div className="stack" style={{ gap: 16, minWidth: 0 }}>
          {selected && a.model.aparatos.has(selected) ? (
            <>
              <Panel title={`Árbol del aparato ${selected}`}>
                <ProcessTree a={a} aparatoId={selected} />
              </Panel>
              <Panel title="Relaciones a validar">
                <PendingRelations a={a} aparatoId={selected} />
              </Panel>
            </>
          ) : (
            <Panel>
              <span className="muted">Seleccione un aparato.</span>
            </Panel>
          )}
        </div>
      </div>
      <OrphanOrders a={a} />
    </div>
  );
}

/* ---------------- Ficha de aparato ---------------- */

type FichaTab = 'general' | 'arbol' | 'planificacion' | 'cuellos' | 'alertas';

export function FichaAparatoPage() {
  const { analysis: a } = useAnalysis();
  const selected = useApp((s) => s.selectedAparato);
  const [tab, setTab] = useState<FichaTab>('general');
  const [op, setOp] = useState<string>();
  const exp = useExport();
  const fa = useMemo(() => (a && selected ? analyzeAparato(a, selected) : undefined), [a, selected]);
  const preNodes = useMemo(() => !!a && a.model.ordenes.size > 0 && [...a.model.ordenes.values()].every((o) => o.tipo === 'preorden'), [a]);
  const ortemsOfAp = useMemo(() => (a && selected ? a.match.ortemsOnly.filter((rid) => (a.ortemsAparato.get(rid) ?? a.ortems.get(rid)?.aparatoId) === selected).length : 0), [a, selected]);
  if (!a) return <NoData />;
  return (
    <div className="page">
      <PageHead
        eyebrow="Ficha de aparato"
        title={selected ? `Aparato ${selected}` : 'Aparato'}
        lead={fa ? [fa.aparato.familia, fa.aparato.articuloRef, fa.aparato.desc].filter(Boolean).join(' · ') : undefined}
        actions={
          <button className="btn" disabled={!exp.allowed || exp.busy || !selected} onClick={() => selected && void exp.run(`arbol_${selected}`, `Árbol de procesos del aparato ${selected}`, (ctx) => [treeSheet(ctx.analysis, selected)])}>
            <Icon name="download" /> Exportar árbol
          </button>
        }
      />
      <AparatoPicker />
      {fa && (
        <>
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { id: 'general', label: 'General y fabricación' },
              { id: 'arbol', label: 'Árbol de procesos' },
              { id: 'planificacion', label: 'Planificación (Gantt)' },
              { id: 'cuellos', label: 'Cuellos de botella' },
              { id: 'alertas', label: `Alertas (${fa.alerts.length})` },
            ]}
          />
          {tab === 'general' && (
            <>
              <div className="grid grid-kpi">
                <Kpi label="Estado global" value={<EstadoPill e={fa.aparato.estado} />} />
                {preNodes ? (
                  <Kpi label="Preórdenes con fichajes" value={fa.ordenes.length} sub={`${fa.ordenes.filter((o) => o.estado === 'terminada').length} terminadas`} />
                ) : (
                  <Kpi label="Órdenes" value={fa.ordenes.length} sub={fa.ordenes.map((o) => o.preordenId).filter(Boolean).length ? `${fa.ordenes.filter((o) => o.preordenId).length} con preorden` : undefined} />
                )}
                {preNodes ? <Kpi label="Planificadas en Ortems" value={ortemsOfAp} sub="registros sin fichajes todavía" /> : <Kpi label="Operaciones" value={fa.ops.length} />}
                {a.model.has.puestos ? <Kpi label="Puestos" value={fa.pasos.length} sub={fa.aparato.secciones.join(', ')} /> : <Kpi label="Secciones" value={fa.aparato.secciones.length} sub={fa.aparato.secciones.join(', ')} />}
                <Kpi label="Operaciones retrasadas" value={fa.delayed.length} state={fa.delayed.length ? 'crit' : undefined} />
                <Kpi label={a.model.has.previstas ? 'Fechas previstas' : 'Fechas reales (fichajes)'} value={<span style={{ fontSize: 16 }}>{fmtDate(fa.aparato.start)} → {fmtDate(fa.aparato.end)}</span>} />
              </div>
              {fa.incompleto.length > 0 && (
                <Notice kind="warn">
                  <strong>Información incompleta o pendiente de validar:</strong>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    {fa.incompleto.slice(0, 12).map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                </Notice>
              )}
              <Panel title="Secuencia de fabricación" sub={a.model.has.previstas ? 'Operaciones ordenadas por inicio previsto' : 'Ordenadas por inicio real (fichajes); las fechas reales se marcan con «(real)»'} flush>
                <div className="table-wrap" style={{ maxHeight: 520 }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Orden</th>
                        <th>Op.</th>
                        <th>Descripción</th>
                        <th>Puesto</th>
                        <th>Sección</th>
                        <th>Inicio</th>
                        <th>Fin</th>
                        <th className="num">Horas</th>
                        <th>Estado</th>
                        <th>Ortems</th>
                        <th>Indicadores</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fa.ops.map((o) => {
                        const c = a.comparison.byOp.get(o.key);
                        return (
                          <tr key={o.key} className="clickable" onClick={() => setOp(o.key)}>
                            <td className="id">{o.ordenId}</td>
                            <td className="id">{o.operacionId !== undefined ? o.label : '—'}</td>
                            <td>{o.desc}</td>
                            <td className="id">{o.puestoId ?? '—'}</td>
                            <td>{o.seccion}</td>
                            <td className="nowrap">
                              {fmtDateTime(opSpan(o)?.start)}
                              {opSpan(o)?.real ? <span className="small muted"> (real)</span> : null}
                            </td>
                            <td className="nowrap">{fmtDateTime(opSpan(o)?.end)}</td>
                            <td className="num">{fmtHours(a.opFlags.get(o.key)?.hours)}</td>
                            <td>
                              <EstadoPill e={o.estado} raw={o.estadoRaw} />
                            </td>
                            <td className="nowrap small">{c?.ortEnd !== undefined ? `fin ${fmtDate(c.ortEnd)} (${fmtSigned(c.dEndWD, 'd', 0)})` : '—'}</td>
                            <td>
                              <OpFlags a={a} opKey={o.key} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </>
          )}
          {tab === 'arbol' && (
            <div className="grid grid-2">
              <Panel title="Estructura">
                <ProcessTree a={a} aparatoId={fa.aparato.id} />
              </Panel>
              <Panel title="Relaciones a validar">
                <PendingRelations a={a} aparatoId={fa.aparato.id} />
              </Panel>
            </div>
          )}
          {tab === 'planificacion' && (
            <>
              <GanttView key={fa.aparato.id} analysis={a} onlyAparato={fa.aparato.id} showDeps compact allowedGroups={['aparato']} expandAllByDefault />
              <Panel title="Diferencias con Ortems" flush>
                {fa.comparison.filter((r) => r.discrepancies.length).length ? (
                  <div className="table-wrap" style={{ maxHeight: 360 }}>
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Orden</th>
                          <th>Op.</th>
                          <th>Discrepancia</th>
                          <th>Criticidad</th>
                          <th>Detalle</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fa.comparison
                          .filter((r) => r.discrepancies.length)
                          .map((r) => (
                            <tr key={r.id}>
                              <td className="id">{r.ordenId ?? r.preordenId}</td>
                              <td className="id">{r.operacionLabel ?? '—'}</td>
                              <td>{r.discrepancies.map((d) => DISCREPANCY_LABEL[d.type]).join(', ')}</td>
                              <td>
                                <CritPill c={r.criticidad} />
                              </td>
                              <td className="small">{r.discrepancies.map((d) => d.message).join(' ')}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="panel-body">
                    <Notice kind="ok">Sin diferencias significativas con Ortems para este aparato.</Notice>
                  </div>
                )}
              </Panel>
            </>
          )}
          {tab === 'cuellos' && (
            <>
              <Panel title="Paso por puestos de trabajo" sub="Cuándo pasa el aparato por cada puesto y si coincide con semanas saturadas" flush>
                <div className="table-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Puesto</th>
                        <th>Sección</th>
                        <th>Operaciones</th>
                        <th>Primer inicio</th>
                        <th>Último fin</th>
                        <th className="num">Horas</th>
                        <th>Semanas saturadas</th>
                        <th>Solapes</th>
                        <th>Riesgo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fa.pasos.map((p) => (
                        <tr key={p.puestoId}>
                          <td className="id">{p.puestoId}</td>
                          <td>{p.seccion}</td>
                          <td className="small">{p.ops.map((o) => `${o.ordenId}/${o.label}`).join(', ')}</td>
                          <td className="nowrap">{fmtDateTime(p.firstStart)}</td>
                          <td className="nowrap">{fmtDateTime(p.lastEnd)}</td>
                          <td className="num">{fmtHours(p.hours)}</td>
                          <td className="small">{p.saturatedWeeks.map((w) => `${weekLabel(w.week)} (${w.occupancy !== undefined ? Math.round(w.occupancy * 100) : '?'} %, ${CONFIANZA_LABEL[w.confianza].toLowerCase()})`).join('; ') || '—'}</td>
                          <td className="num">{p.overlapConflicts}</td>
                          <td>
                            {p.riesgo === 'confirmado' ? (
                              <ConfPill c="confirmado" />
                            ) : p.riesgo === 'estimado' ? (
                              <ConfPill c="estimado" />
                            ) : p.riesgo === 'posible' ? (
                              <span className="pill pill-outline">Posible</span>
                            ) : (
                              <span className="pill pill-good">Sin riesgo</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
              <div className="grid grid-3">
                <Panel title={`Precedencias incumplidas (${fa.violations.length})`}>
                  {fa.violations.length ? (
                    <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                      {fa.violations.map((v, i) => (
                        <li key={i}>
                          {v.op.ordenId}/{v.op.label} empieza {fmtDateTime(v.op.start)}, antes de que termine {v.pred.ordenId}/{v.pred.label} ({fmtDateTime(v.pred.end)}) — dependencia {v.tipo}.
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="small muted">Ninguna.</span>
                  )}
                </Panel>
                <Panel title={`Esperas largas (${fa.waits.length})`} sub={`≥ ${a.settings.dependencies.waitThresholdDays} días laborables entre operaciones dependientes`}>
                  {fa.waits.length ? (
                    <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                      {fa.waits.map((w, i) => (
                        <li key={i}>
                          {w.gapDays} días entre {w.pred.ordenId}/{w.pred.label} ({w.pred.puestoId}) y {w.op.ordenId}/{w.op.label} ({w.op.puestoId}).
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="small muted">Ninguna.</span>
                  )}
                </Panel>
                <Panel title={`Dependencias pendientes (${fa.pendingDeps.length})`}>
                  {fa.pendingDeps.length ? (
                    <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                      {fa.pendingDeps.map((d, i) => (
                        <li key={i}>
                          {d.op.ordenId}/{d.op.label}: {d.dep.regla}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="small muted">Ninguna.</span>
                  )}
                </Panel>
              </div>
            </>
          )}
          {tab === 'alertas' && (
            <Panel flush>
              {fa.alerts.length ? (
                <div className="table-wrap" style={{ maxHeight: 560 }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Criticidad</th>
                        <th>Alerta</th>
                        <th>Detalle</th>
                        <th>Puesto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fa.alerts.map((x) => (
                        <tr key={x.id} className={x.opKey ? 'clickable' : ''} onClick={() => x.opKey && setOp(x.opKey)}>
                          <td>
                            <CritPill c={x.criticidad} />
                          </td>
                          <td>{x.title}</td>
                          <td className="small">{x.description}</td>
                          <td className="id">{x.puestoId ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="panel-body">
                  <Notice kind="ok">Sin alertas para este aparato.</Notice>
                </div>
              )}
            </Panel>
          )}
        </>
      )}
      {op && a && <OperationDetail analysis={a} opKey={op} onClose={() => setOp(undefined)} />}
    </div>
  );
}

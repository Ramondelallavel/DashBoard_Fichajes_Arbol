import { useApp } from '../../data/store';
import type { Analysis } from '../../engine/analysis';
import { DISCREPANCY_LABEL } from '../../engine/comparison';
import { OVERLAP_LABEL } from '../../engine/overlaps';
import { fmtDateTime } from '../../lib/dates';
import { fmtHours, fmtSigned } from '../../lib/format';
import { go } from '../../app/router';
import { CritPill, Drawer, EstadoPill, LinkPill, Notice } from './common';

/** Ficha lateral de una operación (o registro Ortems) con trazabilidad al archivo de origen. */
export function OperationDetail({ analysis: a, opKey, ortemsRid, onClose }: { analysis: Analysis; opKey?: string; ortemsRid?: string; onClose: () => void }) {
  const batches = useApp((s) => s.batches);
  const selectAparato = useApp((s) => s.selectAparato);
  const op = opKey ? a.model.ops.get(opKey) : undefined;
  const ort = ortemsRid ? a.ortems.get(ortemsRid) : undefined;
  const ord = op ? a.model.ordenes.get(op.ordenId) : undefined;
  const cmp = opKey ? a.comparison.byOp.get(opKey) ?? (op ? a.comparison.byOrden.get(op.ordenId)?.find((r) => r.level === 'orden') : undefined) : ortemsRid ? a.comparison.byOrtemsRid.get(ortemsRid) : undefined;
  const f = opKey ? a.opFlags.get(opKey) : undefined;
  const fileOf = (batchId: string) => batches.find((b) => b.id === batchId)?.fileName ?? batchId;
  const srcs = op ? op.rids.map((r) => a.model.records.get(r)?.src).filter(Boolean) : ort ? [ort.src] : [];
  const ortSrcs = (cmp?.ortemsRids ?? []).map((r) => a.ortems.get(r)?.src).filter(Boolean);
  const apId = op?.aparatoId ?? ort?.aparatoId;
  return (
    <Drawer title={op ? `Operación ${op.label} · orden ${op.ordenId}` : `Registro Ortems ${ort?.ordenId ?? ort?.preordenId ?? ''}`} onClose={onClose} wide>
      {op && (
        <>
          <div className="row">
            <EstadoPill e={op.estado} raw={op.estadoRaw} />
            {cmp && <CritPill c={cmp.criticidad} />}
            {apId && a.model.aparatos.has(apId) && (
              <button
                className="btn btn-sm"
                onClick={() => {
                  selectAparato(apId);
                  onClose();
                  go('aparato');
                }}
              >
                Abrir ficha del aparato {apId}
              </button>
            )}
          </div>
          <dl className="kv">
            <dt>Aparato</dt>
            <dd className="id">{op.aparatoId ?? '—'}</dd>
            <dt>Relación orden → aparato</dt>
            <dd>{ord ? <><LinkPill s={ord.aparatoLink} /> <span className="small muted">{ord.aparatoRule}</span></> : '—'}</dd>
            <dt>Artículo</dt>
            <dd>{op.articuloRef ?? ord?.articuloRef ?? '—'} {op.articuloDesc ?? ''}</dd>
            <dt>Familia</dt>
            <dd>{op.familia ?? ord?.familia ?? '—'}</dd>
            <dt>Orden / preorden</dt>
            <dd className="id">{op.ordenId} {op.preordenId ? `/ ${op.preordenId}` : ''}</dd>
            <dt>Operación</dt>
            <dd>
              <span className="id">{op.label}</span> {op.desc}
            </dd>
            <dt>Puesto · sección</dt>
            <dd>
              <span className="id">{op.puestoId ?? '—'}</span> {op.puestoDesc ?? ''} · {op.seccion ?? '—'}
            </dd>
            <dt>Inicio / fin previstos</dt>
            <dd>
              {fmtDateTime(op.start)} → {fmtDateTime(op.end)}
            </dd>
            <dt>Inicio / fin reales</dt>
            <dd>{op.realStart === undefined && op.realEnd === undefined ? <span className="muted">Sin datos reales en el Excel</span> : `${fmtDateTime(op.realStart)} → ${fmtDateTime(op.realEnd)}`}</dd>
            <dt>Fecha objetivo</dt>
            <dd>{fmtDateTime(op.target ?? ord?.target)}</dd>
            <dt>Duración</dt>
            <dd>{op.durationH !== undefined ? fmtHours(op.durationH) : f?.durEstimada ? `${fmtHours(f.hours)} (estimada a partir de las fechas)` : 'Sin dato'}</dd>
            <dt>Cantidad</dt>
            <dd>{op.cantidad ?? '—'}</dd>
          </dl>
        </>
      )}
      {ort && !op && (
        <>
          <Notice kind="warn">Este registro de Ortems no tiene correspondencia en el Excel de producción.</Notice>
          <dl className="kv">
            <dt>Orden / preorden</dt>
            <dd className="id">{ort.ordenId ?? '—'} / {ort.preordenId ?? '—'}</dd>
            <dt>Aparato · artículo</dt>
            <dd>{ort.aparatoId ?? '—'} · {ort.articuloRef ?? '—'}</dd>
            <dt>Operación · recurso</dt>
            <dd>{ort.operacionId ?? '—'} · {ort.puestoId ?? '—'}</dd>
            <dt>Inicio / fin Ortems</dt>
            <dd>{fmtDateTime(ort.inicio)} → {fmtDateTime(ort.fin)}</dd>
            <dt>Prioridad</dt>
            <dd>{ort.prioridadRaw ?? '—'}</dd>
            <dt>Estado de planificación</dt>
            <dd>{ort.estadoPlanificacion ?? '—'}</dd>
            <dt>Periodo (original)</dt>
            <dd>{ort.periodoRaw ?? '—'}</dd>
          </dl>
        </>
      )}

      {cmp && (
        <section className="stack">
          <h3>Comparación con Ortems</h3>
          <dl className="kv">
            <dt>Nivel de comparación</dt>
            <dd>{cmp.level === 'operacion' ? 'Operación' : cmp.level === 'orden' ? 'Orden (Ortems sin detalle por operación)' : cmp.level}</dd>
            <dt>Regla</dt>
            <dd>{cmp.regla ?? '—'}</dd>
            <dt>Ortems</dt>
            <dd>
              {fmtDateTime(cmp.ortStart)} → {fmtDateTime(cmp.ortEnd)} · recurso {cmp.puestoOrtems ?? '—'} · prioridad {cmp.prioridadRaw ?? '—'}
              {cmp.prioridadAnteriorRaw !== undefined && ` (antes ${cmp.prioridadAnteriorRaw})`}
            </dd>
            <dt>Desfase inicio</dt>
            <dd>{cmp.dStartWD !== undefined ? `${fmtSigned(cmp.dStartWD, 'días lab.', 0)} · ${fmtSigned(cmp.dStartH, 'h')}` : '—'}</dd>
            <dt>Desfase fin</dt>
            <dd>{cmp.dEndWD !== undefined ? `${fmtSigned(cmp.dEndWD, 'días lab.', 0)} · ${fmtSigned(cmp.dEndH, 'h')}` : '—'}</dd>
          </dl>
          {cmp.discrepancies.map((d, i) => (
            <div key={i} className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
              <CritPill c={d.criticidad} />
              <div>
                <strong>{DISCREPANCY_LABEL[d.type]}.</strong> {d.message}
              </div>
            </div>
          ))}
          {!cmp.discrepancies.length && <span className="small muted">Las fechas coinciden dentro de la tolerancia configurada.</span>}
        </section>
      )}

      {op && (
        <section className="stack">
          <h3>Dependencias</h3>
          {op.preds.length === 0 && <span className="small muted">Sin predecesoras identificadas en los datos ni por las reglas activas.</span>}
          {op.preds.map((p, i) => {
            const pred = p.from ? a.model.ops.get(p.from) : undefined;
            return (
              <div className="dep" key={i}>
                <LinkPill s={p.tipo} />
                <span>
                  Después de <span className="id">{pred ? `${pred.ordenId}/${pred.label}` : '¿?'}</span> {pred?.end !== undefined && `(fin ${fmtDateTime(pred.end)})`} — {p.regla}
                </span>
              </div>
            );
          })}
          {f?.precedencia && <Notice kind="warn">Empieza antes de que termine su precedente ({f.precedencia.tipo === 'inferida' ? 'dependencia inferida, revise si es real' : 'dependencia confirmada'}).</Notice>}
        </section>
      )}

      {f && (f.solape || f.saturado || f.vencida || f.sinInfo.length || f.pendienteValidacion) && (
        <section className="stack">
          <h3>Indicadores</h3>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {f.vencida && <li>{f.vencida === 'confirmada' ? 'Retrasada: fin previsto superado y no consta como terminada.' : 'Posible retraso: fin previsto superado; no hay estado ni fecha real para confirmarlo.'}</li>}
            {f.retrasoReal && <li>Terminada con retraso respecto a lo previsto.</li>}
            {f.fueraObjetivo && <li>Termina después de la fecha objetivo.</li>}
            {f.solape && <li>{OVERLAP_LABEL[f.solape.clase]} en el puesto {f.solape.puestoId} (hasta {f.solape.maxConcurrency} trabajos a la vez{f.solape.units ? `; capacidad ${f.solape.units}` : ''}).</li>}
            {f.saturado && <li>El puesto está saturado en la semana de la operación ({f.saturado}).</li>}
            {f.pendienteValidacion && <li>Pendiente de validación: {f.pendienteValidacion}.</li>}
            {f.sinInfo.length > 0 && <li>Información incompleta: {f.sinInfo.join(', ')}.</li>}
          </ul>
        </section>
      )}

      <section className="stack">
        <h3>Trazabilidad</h3>
        {srcs.map((s, i) => (
          <div className="small" key={`p${i}`}>
            {op ? 'Producción' : 'Ortems'}: <strong>{fileOf(s!.batchId)}</strong> · hoja «{s!.sheet}» · fila {s!.row}
            {op && i > 0 && <span className="muted"> (fila duplicada)</span>}
          </div>
        ))}
        {op &&
          ortSrcs.map((s, i) => (
            <div className="small" key={`o${i}`}>
              Ortems: <strong>{fileOf(s!.batchId)}</strong> · hoja «{s!.sheet}» · fila {s!.row}
            </div>
          ))}
        {op?.rids[0] && a.model.records.get(op.rids[0])?.enriched?.map((e, i) => (
          <div className="small muted" key={`e${i}`}>
            Campo «{e.field}» completado desde la hoja «{e.from.sheet}», fila {e.from.row}
          </div>
        ))}
      </section>
    </Drawer>
  );
}

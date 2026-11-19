import { useLayoutEffect, useRef, useState } from 'react';
import type { Analysis } from '../../engine/analysis';
import { fmtDateTime } from '../../lib/dates';
import { fmtHours, fmtSigned } from '../../lib/format';
import { ESTADO_LABEL } from '../../engine/filters';
import { CritPill } from '../components/common';
import { FLAG_META, type GBar } from './rows';

export function BarTooltip({ analysis: a, bar, x, y }: { analysis: Analysis; bar: GBar; x: number; y: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x + 14, top: y + 14 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = x + 14 + w > window.innerWidth - 8 ? Math.max(8, x - w - 14) : x + 14;
    const top = y + 14 + h > window.innerHeight - 8 ? Math.max(8, y - h - 14) : y + 14;
    setPos({ left, top });
  }, [x, y]);
  const op = bar.opKey ? a.model.ops.get(bar.opKey) : undefined;
  const ort = bar.ortemsRids?.length ? a.ortems.get(bar.ortemsRids[0]) : undefined;
  const ord = bar.ordenId ? a.model.ordenes.get(bar.ordenId) : undefined;
  const cmp = bar.opKey ? a.comparison.byOp.get(bar.opKey) : bar.ordenId ? a.comparison.byOrden.get(bar.ordenId)?.find((r) => r.level === 'orden') : undefined;
  const flags = a.opFlags.get(bar.opKey ?? '');
  const durH = (bar.end - bar.start) / 3_600_000;
  const isOrt = bar.source === 'ortems';
  return (
    <div className="gtip" ref={ref} style={pos} role="tooltip">
      <h4>
        <span className={`sw ${isOrt ? 'sw-ortems' : 'sw-prod'}`} style={{ width: 10, height: 10, borderRadius: 2, display: 'inline-block' }} />
        {isOrt ? 'Planificación Ortems' : 'Planificación de producción'}
        {bar.summary && <span className="muted small">(resumen)</span>}
      </h4>
      <dl>
        <dt>Orden</dt>
        <dd className="id">{op?.ordenId ?? ort?.ordenId ?? bar.ordenId ?? '—'}</dd>
        {(ort?.preordenId || ord?.preordenId) && (
          <>
            <dt>Preorden</dt>
            <dd className="id">{ort?.preordenId ?? ord?.preordenId}</dd>
          </>
        )}
        <dt>Aparato</dt>
        <dd className="id">{op?.aparatoId ?? ord?.aparatoId ?? ort?.aparatoId ?? '—'}</dd>
        <dt>Artículo</dt>
        <dd>{op?.articuloRef ?? ord?.articuloRef ?? ort?.articuloRef ?? '—'}</dd>
        {(op || ort?.operacionId) && (
          <>
            <dt>Operación</dt>
            <dd>
              <span className="id">{op?.label ?? ort?.operacionId}</span> {op?.desc ?? ''}
            </dd>
          </>
        )}
        <dt>Puesto</dt>
        <dd>
          {isOrt ? cmp?.puestoOrtems ?? ort?.puestoId ?? '—' : op?.puestoId ?? '—'} {op?.puestoDesc ? <span className="muted">{op.puestoDesc}</span> : ''}
        </dd>
        <dt>Sección</dt>
        <dd>{op?.seccion ?? (ort?.puestoId ? a.model.puestos.get(ort.puestoId)?.seccion : undefined) ?? '—'}</dd>
        <dt>Inicio previsto</dt>
        <dd>{fmtDateTime(bar.start)}</dd>
        <dt>Fin previsto</dt>
        <dd>{fmtDateTime(bar.end)}</dd>
        <dt>Duración</dt>
        <dd>
          {fmtHours(durH)} transcurridas
          {!isOrt && op?.durationH !== undefined && ` · ${fmtHours(op.durationH)} de trabajo`}
          {!isOrt && flags?.durEstimada && ` · ${fmtHours(flags.hours)} estimadas`}
        </dd>
        {!isOrt && op?.realStart !== undefined && (
          <>
            <dt>Real</dt>
            <dd>
              {fmtDateTime(op.realStart)} → {fmtDateTime(op.realEnd)}
            </dd>
          </>
        )}
        <dt>Prioridad</dt>
        <dd>{cmp?.prioridadRaw ?? ort?.prioridadRaw ?? op?.prioridadRaw ?? '—'}</dd>
        <dt>Estado</dt>
        <dd>{op ? `${ESTADO_LABEL[op.estado]}${op.estadoRaw ? ` («${op.estadoRaw}»)` : ''}` : ort?.estadoPlanificacion ?? '—'}</dd>
        {cmp && cmp.dEndWD !== undefined && (
          <>
            <dt>Desfase fin</dt>
            <dd>
              {fmtSigned(cmp.dEndWD, 'días lab.', 0)} ({fmtSigned(cmp.dEndH, 'h')})
            </dd>
          </>
        )}
      </dl>
      <div className="flags">
        {cmp && <CritPill c={cmp.criticidad} />}
        {bar.flags.map((f) => (
          <span key={f} className={`pill pill-neutral`}>
            <span className="g">{FLAG_META[f].glyph}</span>
            {FLAG_META[f].label}
          </span>
        ))}
      </div>
    </div>
  );
}

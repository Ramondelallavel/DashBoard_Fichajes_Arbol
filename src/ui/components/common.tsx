import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { EstadoCanonico } from '../../domain/types';
import type { Confianza } from '../../engine/bottlenecks';
import type { Criticidad } from '../../engine/comparison';
import type { LinkStatus } from '../../engine/model';
import { ESTADO_LABEL } from '../../engine/filters';
import { searchable } from '../../lib/text';
import { useApp } from '../../data/store';
import { Icon } from './Icon';

/* ---------------- Pastillas de estado (icono + texto) ---------------- */

const CRIT: Record<Criticidad, { cls: string; g: string; label: string }> = {
  critica: { cls: 'pill-crit', g: '!!', label: 'Crítica' },
  alta: { cls: 'pill-high', g: '!', label: 'Alta' },
  media: { cls: 'pill-med', g: '▲', label: 'Media' },
  informativa: { cls: 'pill-info', g: 'i', label: 'Informativa' },
};

export function CritPill({ c }: { c?: Criticidad }) {
  if (!c) return <span className="pill pill-good"><span className="g">✓</span>Coincide</span>;
  const x = CRIT[c];
  return (
    <span className={`pill ${x.cls}`}>
      <span className="g" aria-hidden="true">{x.g}</span>
      {x.label}
    </span>
  );
}

const CONF: Record<Confianza, { cls: string; g: string; label: string }> = {
  confirmado: { cls: 'pill-crit', g: '■', label: 'Confirmado' },
  estimado: { cls: 'pill-med', g: '≈', label: 'Estimado' },
  sin_capacidad: { cls: 'pill-outline', g: '?', label: 'Sin capacidad conocida' },
};

export function ConfPill({ c }: { c: Confianza }) {
  const x = CONF[c];
  return (
    <span className={`pill ${x.cls}`} title={c === 'sin_capacidad' ? 'No hay capacidad configurada: no se puede confirmar saturación' : undefined}>
      <span className="g" aria-hidden="true">{x.g}</span>
      {x.label}
    </span>
  );
}

const LINK: Record<LinkStatus | 'sin_aparato', { cls: string; g: string; label: string; help: string }> = {
  confirmada: { cls: 'pill-good', g: '✓', label: 'Confirmada', help: 'Respaldada por un campo del Excel' },
  inferida: { cls: 'pill-info', g: '~', label: 'Inferida', help: 'Deducida por una regla configurable; no confirmada en los datos' },
  pendiente: { cls: 'pill-outline', g: '?', label: 'Pendiente de validar', help: 'No hay datos suficientes para determinarla' },
  manual: { cls: 'pill-neutral', g: '✎', label: 'Validada manualmente', help: 'Decisión registrada por un usuario' },
  rechazada: { cls: 'pill-crit', g: '✕', label: 'Rechazada', help: 'Rechazada manualmente' },
  sin_aparato: { cls: 'pill-outline', g: '∅', label: 'Sin aparato', help: 'La orden no tiene aparato asociado' },
};

export function LinkPill({ s }: { s: LinkStatus | 'sin_aparato' }) {
  const x = LINK[s];
  return (
    <span className={`pill ${x.cls}`} title={x.help}>
      <span className="g" aria-hidden="true">{x.g}</span>
      {x.label}
    </span>
  );
}

const ESTADO_CLS: Record<EstadoCanonico, string> = {
  pendiente: 'pill-neutral',
  en_curso: 'pill-info',
  terminada: 'pill-good',
  bloqueada: 'pill-crit',
  desconocido: 'pill-outline',
};
const ESTADO_G: Record<EstadoCanonico, string> = { pendiente: '○', en_curso: '◐', terminada: '●', bloqueada: '■', desconocido: '?' };

export function EstadoPill({ e, raw }: { e: EstadoCanonico; raw?: string }) {
  return (
    <span className={`pill ${ESTADO_CLS[e]}`} title={raw ? `Valor original: ${raw}` : 'Sin dato de estado en el Excel'}>
      <span className="g" aria-hidden="true">{ESTADO_G[e]}</span>
      {ESTADO_LABEL[e]}
    </span>
  );
}

export function SourcePill({ s }: { s: 'produccion' | 'ortems' | 'ambas' | 'calculo' }) {
  const label = s === 'produccion' ? 'Producción' : s === 'ortems' ? 'Ortems' : s === 'ambas' ? 'Producción + Ortems' : 'Cálculo';
  return (
    <span className="pill pill-neutral">
      {s === 'produccion' && <span className="sw sw-prod" style={{ width: 8, height: 8, borderRadius: 2, display: 'inline-block' }} />}
      {s === 'ortems' && <span className="sw sw-ortems" style={{ width: 9, height: 9, borderRadius: 2, display: 'inline-block' }} />}
      {label}
    </span>
  );
}

/* ---------------- Contenedores ---------------- */

export function Panel({ title, actions, children, flush, id, sub }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean; id?: string; sub?: ReactNode }) {
  return (
    <section className="panel" id={id}>
      {(title || actions) && (
        <div className="panel-head">
          <div>
            {title && <h2>{title}</h2>}
            {sub && <div className="small muted" style={{ marginTop: 2 }}>{sub}</div>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      <div className={`panel-body${flush ? ' flush' : ''}`}>{children}</div>
    </section>
  );
}

export function Kpi({ label, value, sub, state, onClick }: { label: string; value: ReactNode; sub?: ReactNode; state?: 'crit' | 'high' | 'med'; onClick?: () => void }) {
  const cls = `kpi${state ? ` state-${state}` : ''}`;
  const inner = (
    <>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {sub && <span className="sub">{sub}</span>}
    </>
  );
  return onClick ? (
    <button type="button" className={cls} onClick={onClick}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode }) {
  return (
    <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : undefined}>
      <Icon name={kind === 'ok' ? 'check' : kind === 'info' ? 'info' : 'warning'} />
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="empty">
      <span className="big">{title}</span>
      {children && <div style={{ maxWidth: '60ch' }}>{children}</div>}
      {actions && <div className="row" style={{ justifyContent: 'center' }}>{actions}</div>}
    </div>
  );
}

/** Estado vacío estándar cuando no hay datos importados. */
export function NoData({ what = 'los datos de producción' }: { what?: string }) {
  const loadDemo = useApp((s) => s.loadDemo);
  return (
    <Panel>
      <EmptyState
        title="Todavía no hay datos importados"
        actions={
          <>
            <a className="btn btn-primary" href="#importacion">
              <Icon name="import" /> Importar Excel
            </a>
            <button className="btn" onClick={() => void loadDemo()}>
              Cargar datos de demostración
            </button>
          </>
        }
      >
        Para ver esta sección importe {what}. Si quiere probar la aplicación sin datos reales, cargue los datos de demostración: son ficticios.
      </EmptyState>
    </Panel>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode }[] }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((it) => (
        <button key={it.id} role="tab" aria-selected={value === it.id} onClick={() => onChange(it.id)} type="button">
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Seg<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode; title?: string }[]; label: string }) {
  return (
    <div className="btn-group" role="group" aria-label={label}>
      {items.map((it) => (
        <button key={it.id} type="button" className="btn btn-sm" aria-pressed={value === it.id} onClick={() => onChange(it.id)} title={it.title}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="overlay center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={wide ? { width: 'min(860px, 100%)' } : undefined}>
        <div className="drawer-head">
          <h2>{title}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Cerrar">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Confirmación dentro de la página (el visor no permite confirm()). */
export function ConfirmDialog({ title, message, confirmLabel, danger, requireCheck, onConfirm, onCancel }: { title: string; message: ReactNode; confirmLabel: string; danger?: boolean; requireCheck?: string; onConfirm: () => void; onCancel: () => void }) {
  const [ok, setOk] = useState(!requireCheck);
  const id = useId();
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button className="btn" onClick={onCancel}>
            Cancelar
          </button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={!ok} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <div>{message}</div>
      {requireCheck && (
        <label className="check" htmlFor={id}>
          <input id={id} type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />
          {requireCheck}
        </label>
      )}
    </Modal>
  );
}

export function Drawer({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className={`drawer${wide ? ' wide' : ''}`} role="dialog" aria-modal="true">
        <div className="drawer-head">
          <h2 style={{ minWidth: 0 }}>{title}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Cerrar">
            <Icon name="x" />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </aside>
    </div>
  );
}

/* ---------------- Selección múltiple con búsqueda ---------------- */

export function MultiSelect({ label, options, value, onChange, placeholder = 'Todos', id: idProp, renderOption }: { label: string; options: string[]; value: string[]; onChange: (v: string[]) => void; placeholder?: string; id?: string; renderOption?: (o: string) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const autoId = useId();
  const id = idProp ?? autoId;
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const filtered = useMemo(() => {
    const s = searchable(q);
    return (s ? options.filter((o) => searchable(o).includes(s)) : options).slice(0, 500);
  }, [options, q]);
  const sel = new Set(value);
  const text = value.length === 0 ? placeholder : value.length <= 2 ? value.join(', ') : `${value.length} seleccionados`;
  return (
    <div
      className="field ms"
      ref={ref}
      onKeyDown={(e) => {
        // Escape cierra solo la lista desplegable, no el panel que la contiene
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <label htmlFor={id}>{label}</label>
      <button id={id} type="button" className="ms-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={`val${value.length ? '' : ' muted'}`}>{text}</span>
        <Icon name="chevronDown" style={{ width: 14, height: 14 }} />
      </button>
      {open && (
        <div className="ms-pop">
          <input className="input input-sm" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label={`Buscar en ${label}`} />
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="small muted">{options.length} opciones</span>
            <span className="row" style={{ gap: 4 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([...new Set([...value, ...filtered])])}>
                Marcar visibles
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([])} disabled={!value.length}>
                Limpiar
              </button>
            </span>
          </div>
          <div className="ms-list" role="listbox" aria-multiselectable="true">
            {filtered.map((o) => (
              <label key={o}>
                <input type="checkbox" checked={sel.has(o)} onChange={() => onChange(sel.has(o) ? value.filter((v) => v !== o) : [...value, o])} />
                <span>{renderOption ? renderOption(o) : o}</span>
              </label>
            ))}
            {!filtered.length && <span className="small muted" style={{ padding: 6 }}>Sin coincidencias</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span>{t.text}</span>
          <button onClick={() => dismiss(t.id)} aria-label="Cerrar aviso">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

export function Busy() {
  const busy = useApp((s) => s.busy);
  if (!busy) return null;
  return (
    <div className="busy" role="status">
      <div>
        <span className="spinner" />
        <span>{busy}</span>
      </div>
    </div>
  );
}

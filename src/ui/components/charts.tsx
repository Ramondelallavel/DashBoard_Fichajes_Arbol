import { useState, type ReactNode } from 'react';
import { fmtHours, fmtNum, fmtPct } from '../../lib/format';

export type BarStatus = 'over' | 'risk' | 'ok' | 'nocap';

export interface HBarItem {
  id: string;
  label: string;
  value: number;
  cap?: number;
  status?: BarStatus;
  valueLabel?: string;
  title?: string;
}

const STATUS_FILL: Record<BarStatus, string> = {
  over: 'var(--crit)',
  risk: 'var(--high)',
  ok: 'var(--prod)',
  nocap: 'var(--fg-3)',
};

/** Barras horizontales con marcador de capacidad. El color indica estado; el valor va en texto. */
export function HBarList({ items, onSelect, max, emptyText = 'Sin datos' }: { items: HBarItem[]; onSelect?: (id: string) => void; max?: number; emptyText?: string }) {
  if (!items.length) return <div className="small muted">{emptyText}</div>;
  const scale = max ?? Math.max(1e-9, ...items.map((i) => Math.max(i.value, i.cap ?? 0)));
  return (
    <div className="hbar">
      {items.map((it) => {
        const w = Math.min(100, (it.value / scale) * 100);
        const fill = STATUS_FILL[it.status ?? 'ok'];
        return (
          <div className="hbar-row" key={it.id} title={it.title}>
            {onSelect ? (
              <button className="lbl" onClick={() => onSelect(it.id)}>
                {it.label}
              </button>
            ) : (
              <span className="lbl">{it.label}</span>
            )}
            <div className="hbar-track">
              <div
                className="hbar-fill"
                style={{
                  width: `${w}%`,
                  background: it.status === 'nocap' ? `repeating-linear-gradient(135deg, ${fill} 0 3px, transparent 3px 6px)` : fill,
                }}
              />
              {it.cap !== undefined && it.cap > 0 && <div className="hbar-cap" style={{ left: `calc(${Math.min(100, (it.cap / scale) * 100)}% - 1px)` }} title={`Capacidad ${fmtHours(it.cap)}`} />}
            </div>
            <span className="val">{it.valueLabel ?? fmtNum(it.value)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function StatusLegend({ showCap = true }: { showCap?: boolean }) {
  return (
    <div className="legend">
      <span className="it"><span className="key" style={{ background: 'var(--prod)' }} />Por debajo del umbral de riesgo</span>
      <span className="it"><span className="key" style={{ background: 'var(--high)' }} />Riesgo (≥ umbral)</span>
      <span className="it"><span className="key" style={{ background: 'var(--crit)' }} />Por encima de la capacidad</span>
      <span className="it"><span className="key" style={{ background: 'repeating-linear-gradient(135deg, var(--fg-3) 0 3px, transparent 3px 6px)' }} />Sin capacidad conocida</span>
      {showCap && <span className="it"><span className="key" style={{ width: 2, height: 14, background: 'var(--fg)' }} />Capacidad</span>}
    </div>
  );
}

export interface ColumnDatum {
  key: string;
  label: string;
  value: number;
  cap?: number;
  highlight?: boolean;
  title?: string;
}

/** Columnas por periodo con la capacidad como línea escalonada (un único eje). */
export function PeriodColumns({ data, height = 220, unit = 'h', onSelect, ariaLabel }: { data: ColumnDatum[]; height?: number; unit?: string; onSelect?: (key: string) => void; ariaLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return <div className="small muted">Sin datos para el periodo</div>;
  const W = Math.max(520, data.length * 38);
  const padL = 44;
  const padB = 34;
  const padT = 14;
  const H = height;
  const maxV = Math.max(1, ...data.map((d) => Math.max(d.value, d.cap ?? 0)));
  const nice = niceMax(maxV);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / nice);
  const bw = (W - padL - 8) / data.length;
  const barW = Math.min(24, bw * 0.62);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * nice);
  const capPath = data
    .map((d, i) => (d.cap === undefined ? null : `M${padL + i * bw + 1},${y(d.cap)}H${padL + (i + 1) * bw - 1}`))
    .filter(Boolean)
    .join(' ');
  return (
    <div style={{ overflowX: 'auto', position: 'relative' }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={ariaLabel}>
        <g className="grid">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={W - 4} y1={y(t)} y2={y(t)} />
              <text x={padL - 6} y={y(t) + 4} textAnchor="end">
                {fmtNum(t)}
              </text>
            </g>
          ))}
        </g>
        {data.map((d, i) => {
          const x = padL + i * bw + (bw - barW) / 2;
          const over = d.cap !== undefined && d.value > d.cap + 1e-9;
          const h = Math.max(0, y(0) - y(d.value));
          return (
            <g
              key={d.key}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={onSelect ? () => onSelect(d.key) : undefined}
              style={{ cursor: onSelect ? 'pointer' : 'default' }}
            >
              <rect x={padL + i * bw} y={padT} width={bw} height={H - padT - padB} fill="transparent" />
              {h > 0 && <path d={roundedTop(x, y(d.value), barW, h, 4)} fill={over ? 'var(--crit)' : d.highlight ? 'var(--seq-5)' : 'var(--prod)'} opacity={hover === null || hover === i ? 1 : 0.55} />}
              {over && (
                <text x={x + barW / 2} y={y(d.value) - 4} textAnchor="middle" className="label-strong" style={{ fontSize: 10 }}>
                  ▲
                </text>
              )}
              <text x={padL + i * bw + bw / 2} y={H - padB + 14} textAnchor="middle" style={{ fontSize: 10 }}>
                {d.label}
              </text>
            </g>
          );
        })}
        {capPath && <path d={capPath} stroke="var(--fg)" strokeWidth={2} fill="none" strokeLinecap="round" />}
        <line x1={padL} x2={W - 4} y1={y(0)} y2={y(0)} stroke="var(--border-strong)" />
      </svg>
      {hover !== null && (
        <div className="gtip" style={{ position: 'absolute', top: 8, left: Math.min(W - 260, padL + hover * bw + bw), width: 240 }}>
          <h4>{data[hover].title ?? data[hover].label}</h4>
          <dl>
            <dt>Carga</dt>
            <dd>{unit === 'h' ? fmtHours(data[hover].value) : fmtNum(data[hover].value)}</dd>
            <dt>Capacidad</dt>
            <dd>{data[hover].cap !== undefined ? fmtHours(data[hover].cap) : 'Desconocida'}</dd>
            <dt>Ocupación</dt>
            <dd>{data[hover].cap ? fmtPct(data[hover].value / data[hover].cap!) : '—'}</dd>
          </dl>
        </div>
      )}
    </div>
  );
}

/** Columnas divergentes (positivo = retraso, negativo = adelanto) con punto medio neutro. */
export function DivergingColumns({ data, height = 200, ariaLabel, unit }: { data: { key: string; label: string; value: number; count: number }[]; height?: number; ariaLabel: string; unit: string }) {
  if (!data.length) return <div className="small muted">Sin datos comparables</div>;
  const W = Math.max(480, data.length * 40);
  const padL = 44;
  const padB = 30;
  const padT = 12;
  const H = height;
  const m = niceMax(Math.max(1, ...data.map((d) => Math.abs(d.value))));
  const y = (v: number) => padT + ((H - padT - padB) * (m - v)) / (2 * m);
  const bw = (W - padL - 8) / data.length;
  const barW = Math.min(22, bw * 0.6);
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={ariaLabel}>
        <g className="grid">
          {[-m, -m / 2, 0, m / 2, m].map((t) => (
            <g key={t}>
              <line x1={padL} x2={W - 4} y1={y(t)} y2={y(t)} />
              <text x={padL - 6} y={y(t) + 4} textAnchor="end">
                {fmtNum(t, 1)}
              </text>
            </g>
          ))}
        </g>
        {data.map((d, i) => {
          const x = padL + i * bw + (bw - barW) / 2;
          const top = Math.min(y(d.value), y(0));
          const h = Math.abs(y(d.value) - y(0));
          return (
            <g key={d.key}>
              <title>{`${d.label}: ${fmtNum(d.value, 1)} ${unit} de media (${d.count} comparaciones)`}</title>
              <rect x={x} y={top} width={barW} height={Math.max(h, 0.5)} rx={2} fill={d.value >= 0 ? 'var(--crit)' : 'var(--prod)'} />
              <text x={padL + i * bw + bw / 2} y={H - padB + 14} textAnchor="middle" style={{ fontSize: 10 }}>
                {d.label}
              </text>
            </g>
          );
        })}
        <line x1={padL} x2={W - 4} y1={y(0)} y2={y(0)} stroke="var(--fg-3)" />
      </svg>
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

function niceMax(v: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

export function ChartLegend({ items }: { items: { key: ReactNode; label: string }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span className="it" key={i.label}>
          {i.key}
          {i.label}
        </span>
      ))}
    </div>
  );
}

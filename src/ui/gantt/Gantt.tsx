import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Analysis } from '../../engine/analysis';
import { addDays, DAY, fmtDateTime, startOfDay } from '../../lib/dates';
import { buildTicks, makeScale, SCALES, weekendBands, type ScaleId } from './timeScale';
import { FLAG_META, type FlagId, type GBar, type GRow } from './rows';
import { BarTooltip } from './GanttTooltip';

const ROW_H = 30;
const HEAD_H = 44;
const OVERSCAN = 8;

interface Props {
  analysis: Analysis;
  rows: GRow[];
  range: [number, number];
  scaleId: ScaleId;
  zoom: number;
  source: 'produccion' | 'ortems' | 'ambas';
  labelWidth?: number;
  onToggle: (id: string) => void;
  onSelect: (bar: GBar | undefined, row: GRow) => void;
  selectedId?: string;
  showDeps?: boolean;
  compact?: boolean;
  /** Instante al que desplazar la vista (cambia para provocar el desplazamiento). */
  scrollTo?: { t: number; n: number };
}

export function Gantt({ analysis, rows, range, scaleId, zoom, source, labelWidth = 330, onToggle, onSelect, selectedId, showDeps, compact, scrollTo }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, left: 0, w: 1200, h: 600 });
  const [tip, setTip] = useState<{ bar: GBar; x: number; y: number } | null>(null);
  const pxPerDay = SCALES[scaleId].pxPerDay * zoom;
  const scale = useMemo(() => makeScale(range[0], range[1], pxPerDay), [range, pxPerDay]);
  const totalW = labelWidth + scale.width;
  const totalH = rows.length * ROW_H;

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setView({ top: el.scrollTop, left: el.scrollLeft, w: el.clientWidth, h: el.clientHeight });
    setTip(null);
  }, []);
  useLayoutEffect(() => {
    onScroll();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(onScroll);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onScroll]);

  // Desplazamiento solicitado (Hoy, inicio de periodo, etc.)
  useEffect(() => {
    if (!scrollTo || !ref.current) return;
    const x = scale.x(scrollTo.t) - 80;
    ref.current.scrollLeft = Math.max(0, x);
  }, [scrollTo, scale]);

  const t0 = scale.ms(Math.max(0, view.left - 200));
  const t1 = scale.ms(view.left + view.w + 200);
  const ticks = useMemo(() => buildTicks(scale, scaleId, t0, t1), [scale, scaleId, t0, t1]);
  const weekends = useMemo(() => (scaleId === 'dia' || scaleId === 'semana' ? weekendBands(scale, t0, t1) : []), [scale, scaleId, t0, t1]);
  const firstRow = Math.max(0, Math.floor(view.top / ROW_H) - OVERSCAN);
  const lastRow = Math.min(rows.length, Math.ceil((view.top + view.h) / ROW_H) + OVERSCAN);
  const visible = rows.slice(firstRow, lastRow);
  const xMin = view.left - 100;
  const xMax = view.left + view.w + 100;
  const refX = scale.x(analysis.refMs);
  const height = compact ? Math.min(HEAD_H + totalH + 4, 0.7 * (typeof window !== 'undefined' ? window.innerHeight : 800)) : undefined;

  // Flechas de dependencias (solo en vistas reducidas)
  const deps = useMemo(() => {
    if (!showDeps || rows.length > 400) return [];
    const pos = new Map<string, { y: number; x1: number; x2: number; start: number; end: number }>();
    rows.forEach((r, i) => {
      if (!r.opKey) return;
      const b = r.bars.find((x) => x.source === 'produccion' && !x.summary);
      if (!b) return;
      pos.set(r.opKey, { y: i * ROW_H + ROW_H / 2, x1: labelWidth + scale.x(b.start), x2: labelWidth + scale.x(b.end), start: b.start, end: b.end });
    });
    const out: { d: string; cls: string; key: string }[] = [];
    for (const r of rows) {
      if (!r.opKey) continue;
      const to = pos.get(r.opKey);
      const op = analysis.model.ops.get(r.opKey);
      if (!to || !op) continue;
      for (const p of op.preds) {
        if (!p.from) continue;
        const from = pos.get(p.from);
        if (!from) continue;
        const violated = to.start < from.end;
        const xA = from.x2;
        const xB = to.x1;
        const mid = Math.max(xA + 8, xB - 8);
        const d = `M${xA},${from.y} C${mid},${from.y} ${Math.min(xB - 6, mid)},${to.y} ${xB - 2},${to.y}`;
        out.push({ d, cls: violated ? 'violada' : p.tipo, key: `${p.from}>${r.opKey}` });
      }
    }
    return out;
  }, [showDeps, rows, scale, labelWidth, analysis]);

  const barTop = (b: GBar) => {
    if (b.summary) return source === 'ambas' ? (b.source === 'produccion' ? 8 : 18) : 12;
    if (source === 'ambas') return b.source === 'produccion' ? 5 : 17;
    return 8;
  };
  const barH = (b: GBar) => (b.summary ? 5 : source === 'ambas' ? 9 : 14);

  return (
    <div className={`gantt-scroll${compact ? ' compact' : ''}`} ref={ref} onScroll={onScroll} style={height ? { height } : undefined} role="grid" aria-label="Diagrama de Gantt" aria-rowcount={rows.length}>
      <div className="gantt-inner" style={{ width: totalW, height: HEAD_H + totalH }}>
        <div className="gantt-head" style={{ width: totalW, height: HEAD_H }}>
          <div className="gantt-corner" style={{ width: labelWidth }}>
            {rows.length} filas
          </div>
          {ticks.top.filter((t) => t.x + t.w + labelWidth >= xMin && t.x + labelWidth <= xMax).map((t) => (
            <div key={t.key} className="gantt-tick top" style={{ left: labelWidth + t.x, width: t.w, top: 0 }}>
              {t.w > 40 ? t.label : ''}
            </div>
          ))}
          {ticks.bottom.filter((t) => t.x + t.w + labelWidth >= xMin && t.x + labelWidth <= xMax).map((t) => (
            <div key={t.key} className={`gantt-tick${t.weekend ? ' weekend' : ''}`} style={{ left: labelWidth + t.x, width: t.w, top: 22 }}>
              {t.w > 18 ? t.label : ''}
            </div>
          ))}
          {refX >= 0 && refX <= scale.width && (
            <div className="gantt-today-label" style={{ left: labelWidth + refX }}>
              {analysis.settings.referenceDate ? 'REF.' : 'HOY'}
            </div>
          )}
        </div>
        <div className="gantt-body" style={{ height: totalH, width: totalW }}>
          {weekends.map((w) => (
            <div key={w.key} className="gantt-vline weekend" style={{ left: labelWidth + w.x, width: w.w }} />
          ))}
          {ticks.bottom.filter((t) => t.x + labelWidth >= xMin && t.x + labelWidth <= xMax).map((t) => (
            <div key={`l${t.key}`} className="gantt-vline" style={{ left: labelWidth + t.x }} />
          ))}
          {refX >= 0 && refX <= scale.width && <div className="gantt-todayline" style={{ left: labelWidth + refX }} title={`Fecha de referencia ${fmtDateTime(analysis.refMs)}`} />}
          {deps.length > 0 && (
            <svg className="gantt-deps" width={totalW} height={totalH} aria-hidden="true">
              <defs>
                <marker id="arr" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto">
                  <path d="M0,0 L6,3 L0,6 z" />
                </marker>
              </defs>
              {deps.map((d) => (
                <path key={d.key} d={d.d} className={d.cls} markerEnd="url(#arr)" />
              ))}
            </svg>
          )}
          {visible.map((r, i) => {
            const idx = firstRow + i;
            return (
              <div key={r.id} className={`gantt-row lvl-${Math.min(r.level, 2)}${r.kind === 'op' || r.kind === 'ortems' ? ' leaf' : ''}${selectedId === r.id ? ' sel' : ''}`} style={{ top: idx * ROW_H, height: ROW_H, width: totalW }} role="row">
                <div className="gantt-label" style={{ width: labelWidth, paddingLeft: 6 + r.level * 14 }} role="rowheader">
                  {r.hasChildren ? (
                    <button className="tg" onClick={() => onToggle(r.id)} aria-expanded={r.expanded} aria-label={`${r.expanded ? 'Contraer' : 'Desplegar'} ${r.label}`}>
                      {r.expanded ? '▾' : '▸'}
                    </button>
                  ) : (
                    <span style={{ width: 18, flex: 'none' }} />
                  )}
                  <span className="txt" title={`${r.label}${r.sub ? ` · ${r.sub}` : ''}`}>
                    {r.kind === 'op' || r.kind === 'ortems' ? <span className="id">{r.label}</span> : r.label}
                    {r.sub && <small>{r.sub}</small>}
                  </span>
                  <FlagIcons flags={r.flags} leaf={r.kind === 'op' || r.kind === 'ortems'} />
                </div>
                {r.bars.map((b) => {
                  const x = labelWidth + scale.x(b.start);
                  const w = Math.max(3, scale.x(b.end) - scale.x(b.start));
                  if (x + w < xMin || x > xMax) return null;
                  const cls = ['gbar', b.source === 'produccion' ? 'prod' : 'ortems', b.summary ? 'summary' : '', ...b.flags.map((f) => `f-${f}`)].join(' ');
                  return (
                    <button
                      key={b.id}
                      className={cls}
                      style={{ left: x, width: w, top: barTop(b), height: barH(b) }}
                      onMouseEnter={(e) => setTip({ bar: b, x: e.clientX, y: e.clientY })}
                      onMouseMove={(e) => setTip((t) => (t && t.bar.id === b.id ? { bar: b, x: e.clientX, y: e.clientY } : t))}
                      onMouseLeave={() => setTip(null)}
                      onFocus={(e) => {
                        const rc = (e.target as HTMLElement).getBoundingClientRect();
                        setTip({ bar: b, x: rc.left + rc.width / 2, y: rc.bottom });
                      }}
                      onBlur={() => setTip(null)}
                      onClick={() => onSelect(b, r)}
                      aria-label={`${b.source === 'produccion' ? 'Producción' : 'Ortems'}: ${r.label}, ${fmtDateTime(b.start)} a ${fmtDateTime(b.end)}${b.flags.length ? `. ${b.flags.map((f) => FLAG_META[f].label).join(', ')}` : ''}`}
                    >
                      {!b.summary && w > 60 && b.source === 'produccion' && source !== 'ambas' && <span className="gtxt">{r.kind === 'op' ? r.label.split(' · ')[0] : ''}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {tip && <BarTooltip analysis={analysis} bar={tip.bar} x={tip.x} y={tip.y} />}
    </div>
  );
}

function FlagIcons({ flags, leaf }: { flags: Map<FlagId, number>; leaf: boolean }) {
  if (!flags.size) return null;
  const order: FlagId[] = ['late', 'ovl', 'sat', 'dev', 'early', 'pend', 'info'];
  const items = order.filter((f) => flags.has(f)).slice(0, leaf ? 5 : 4);
  return (
    <span className="icons">
      {items.map((f) => (
        <span key={f} className={`gicon ${f}`} title={`${FLAG_META[f].label}${leaf ? '' : `: ${flags.get(f)} operación(es)`}`} aria-label={FLAG_META[f].label}>
          {FLAG_META[f].glyph}
        </span>
      ))}
    </span>
  );
}

export function GanttLegend({ extra }: { extra?: ReactNode }) {
  return (
    <div className="gantt-legend" aria-label="Leyenda del Gantt">
      <span className="it">
        <span className="key gbar prod" style={{ position: 'relative' }} /> Planificación de producción
      </span>
      <span className="it">
        <span className="key gbar ortems" style={{ position: 'relative' }} /> Planificación Ortems
      </span>
      <span className="it">
        <span className="key gbar prod summary" style={{ position: 'relative', height: 5 }} /> Resumen (orden / aparato / puesto)
      </span>
      {(Object.keys(FLAG_META) as FlagId[]).map((f) => (
        <span className="it" key={f}>
          <span className={`gicon ${f}`}>{FLAG_META[f].glyph}</span> {FLAG_META[f].label}
        </span>
      ))}
      <span className="it">
        <span className="key" style={{ width: 2, height: 14, background: 'var(--today)' }} /> Fecha de referencia
      </span>
      {extra}
    </div>
  );
}

/** Rango temporal por defecto a partir de los datos, con margen. */
export function paddedRange(r: [number, number] | undefined, refMs: number): [number, number] {
  if (!r) return [addDays(startOfDay(refMs), -14), addDays(startOfDay(refMs), 42)];
  const s = Math.min(r[0], refMs);
  const e = Math.max(r[1], refMs);
  const pad = Math.max(3 * DAY, (e - s) * 0.03);
  return [startOfDay(s - pad), startOfDay(e + pad) + DAY];
}

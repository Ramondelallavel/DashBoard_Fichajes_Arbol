import { useMemo, useState } from 'react';
import { useAnalysis } from '../../app/AnalysisContext';
import type { Analysis } from '../../engine/analysis';
import type { Granularity, LoadCell, LoadResult, ResourceLoad } from '../../engine/load';
import { loadSheet } from '../../export/reports';
import { addDays, dayKey, monthKey, monthLabel, startOfDay, weekKey, weekKeyStart, weekLabel } from '../../lib/dates';
import { fmtHours, fmtNum, fmtPct } from '../../lib/format';
import { naturalCompare } from '../../lib/text';
import { Drawer, NoData, Notice, Panel, Seg } from '../components/common';
import { Icon } from '../components/Icon';
import { OperationDetail } from '../components/OperationDetail';
import { useExport } from '../components/useExport';
import { FiltersRow, PageHead, useFilteredLoad } from './shared';

type Src = 'produccion' | 'ortems' | 'combinada';

function periods(g: Granularity, refMs: number, horizon: number): { key: string; label: string; start: number }[] {
  const out: { key: string; label: string; start: number }[] = [];
  if (g === 'dia') {
    for (let i = -5; i < 30; i++) {
      const d = addDays(startOfDay(refMs), i);
      const dt = new Date(d);
      out.push({ key: dayKey(d), label: `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}`, start: d });
    }
  } else if (g === 'semana') {
    for (let i = -4; i < horizon + 4; i++) {
      const d = addDays(startOfDay(refMs), i * 7);
      const k = weekKey(d);
      out.push({ key: k, label: weekLabel(k).replace(' ', ' '), start: weekKeyStart(k) });
    }
  } else {
    const r = new Date(refMs);
    for (let i = -2; i < 10; i++) {
      const d = new Date(r.getFullYear(), r.getMonth() + i, 1).getTime();
      out.push({ key: monthKey(d), label: monthLabel(monthKey(d)), start: d });
    }
  }
  return out;
}

function cellBg(occ: number | undefined, h: number, maxH: number, capKnown: boolean): string | undefined {
  const v = capKnown && occ !== undefined ? Math.min(occ, 1) : maxH ? h / maxH : 0;
  if (!(v > 0)) return undefined;
  const steps = ['var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)', 'var(--seq-5)'];
  return steps[Math.min(4, Math.floor(v * 4.999))];
}

export function CargaPage({ onFilters }: { onFilters: () => void }) {
  const { analysis: a, filtered } = useAnalysis();
  const [srcSel, setSrc] = useState<Src | undefined>();
  const src: Src = srcSel ?? a?.loadBase ?? 'produccion';
  const filteredLoad = useFilteredLoad(a, filtered, src);
  const [scope, setScope] = useState<'puesto' | 'seccion'>('puesto');
  const [g, setG] = useState<Granularity>('semana');
  const [metric, setMetric] = useState<'ocupacion' | 'horas'>('ocupacion');
  const [cell, setCell] = useState<{ rl: ResourceLoad; c: LoadCell } | undefined>();
  const exp = useExport();
  const load: LoadResult | undefined = a ? filteredLoad : undefined;
  const ps = useMemo(() => (a ? periods(g, a.refMs, a.settings.horizonWeeks) : []), [a, g]);
  if (!a || !load) return <NoData />;
  const res = [...(scope === 'puesto' ? load.puestos : load.secciones).values()].sort((x, y) => naturalCompare(x.id, y.id));
  const maxH = Math.max(1, ...res.flatMap((r) => ps.map((p) => r.buckets[g].get(p.key)?.loadH ?? 0)));
  const risk = a.settings.riskThreshold;
  const anyUnknown = res.some((r) => r.capSource === 'desconocida' || r.capSource === 'parcial');
  return (
    <div className="page">
      <PageHead
        eyebrow="Análisis"
        title="Análisis de carga"
        lead="Horas previstas por recurso y periodo frente a la capacidad del calendario configurado. Las horas de cada operación se reparten entre sus días laborables."
        actions={
          <button
            className="btn"
            disabled={!exp.allowed || exp.busy}
            onClick={() => void exp.run(`carga_${scope}_${g}`, `Análisis de carga por ${scope === 'puesto' ? 'puesto' : 'sección'}`, (ctx) => [loadSheet(ctx.analysis, 'puesto', g, src), loadSheet(ctx.analysis, 'seccion', g, src)], [`Fuente de carga: ${src}`])}
          >
            <Icon name="download" /> Exportar carga
          </button>
        }
      />
      <FiltersRow onFilters={onFilters} />
      <Panel
        title="Mapa de carga"
        actions={
          <>
            <Seg label="Fuente" value={src} onChange={setSrc} items={[{ id: 'produccion', label: 'Producción' }, { id: 'ortems', label: 'Ortems' }, { id: 'combinada', label: 'Combinada', title: 'Producción + órdenes/preórdenes que solo están en Ortems' }]} />
            <Seg label="Ámbito" value={scope} onChange={setScope} items={[{ id: 'puesto', label: 'Puesto' }, { id: 'seccion', label: 'Sección' }]} />
            <Seg label="Periodo" value={g} onChange={setG} items={[{ id: 'dia', label: 'Día' }, { id: 'semana', label: 'Semana' }, { id: 'mes', label: 'Mes' }]} />
            <Seg label="Medida" value={metric} onChange={setMetric} items={[{ id: 'ocupacion', label: '% ocupación' }, { id: 'horas', label: 'Horas' }]} />
          </>
        }
      >
        <div className="stack">
          {src !== 'produccion' && filtered?.active && <Notice kind="info">Los filtros se aplican a la carga de producción; la carga {src === 'ortems' ? 'de Ortems' : 'combinada'} se muestra completa.</Notice>}
          {anyUnknown && <Notice kind="warn">Las celdas con trama corresponden a recursos sin capacidad configurada (o con capacidad parcial en la sección): se muestran las horas, sin ocupación ni confirmación de saturación.</Notice>}
          <div className="table-wrap" style={{ maxHeight: 560 }}>
            <table className="heat">
              <thead>
                <tr>
                  <th>{scope === 'puesto' ? 'Puesto' : 'Sección'}</th>
                  {ps.map((p) => (
                    <th key={p.key} style={p.key === (g === 'semana' ? weekKey(a.refMs) : g === 'dia' ? dayKey(a.refMs) : monthKey(a.refMs)) ? { color: 'var(--today)' } : undefined}>
                      {p.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {res.map((r) => (
                  <tr key={r.id}>
                    <th title={scope === 'puesto' ? a.model.puestos.get(r.id)?.desc : `${r.members?.length} puestos`}>
                      <span className="id">{r.id}</span> <span className="muted small">{scope === 'puesto' ? a.model.puestos.get(r.id)?.desc ?? '' : r.capSource === 'parcial' ? `cap. ${r.membersWithCap}/${r.members?.length}` : ''}</span>
                    </th>
                    {ps.map((p) => {
                      const c = r.buckets[g].get(p.key);
                      const capKnown = r.capSource !== 'desconocida' && c?.capacityH !== undefined;
                      const occ = c?.occupancy;
                      const over = capKnown && occ !== undefined && occ > 1 + 1e-9;
                      const isRisk = capKnown && occ !== undefined && !over && occ >= risk;
                      const text = !c || !(c.loadH > 0) ? (capKnown && c?.capacityH === 0 ? '·' : '') : metric === 'ocupacion' && capKnown ? (Number.isFinite(occ!) ? fmtPct(occ) : '∞') : fmtNum(c.loadH, 1);
                      const bg = c ? cellBg(occ, c.loadH, maxH, capKnown) : undefined;
                      const dark = bg === 'var(--seq-4)' || bg === 'var(--seq-5)';
                      return (
                        <td
                          key={p.key}
                          className={`${c?.ids.length ? 'click ' : ''}${over ? 'over ' : ''}${isRisk ? 'risk ' : ''}${!capKnown && c?.loadH ? 'nocap' : ''}`}
                          style={{ background: !capKnown && c?.loadH ? undefined : bg, color: dark ? '#fff' : undefined }}
                          title={c ? `${r.id} · ${p.label}: ${fmtHours(c.loadH)}${c.capacityH !== undefined ? ` / ${fmtHours(c.capacityH)} (${fmtPct(occ)})` : ' · capacidad desconocida'}${c.estimatedH ? ` · ${fmtHours(c.estimatedH)} estimadas` : ''} · ${c.ids.length} operaciones` : `${r.id} · ${p.label}: sin carga`}
                          onClick={c?.ids.length ? () => setCell({ rl: r, c }) : undefined}
                        >
                          {over && <span aria-hidden="true">▲</span>}
                          {text}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="legend">
            <span className="it"><span className="key" style={{ background: 'var(--seq-1)' }} /><span className="key" style={{ background: 'var(--seq-3)' }} /><span className="key" style={{ background: 'var(--seq-5)' }} />Ocupación 0 → 100 % (o horas relativas sin capacidad)</span>
            <span className="it"><span className="key" style={{ outline: '2px solid var(--crit)', outlineOffset: -2 }} />▲ Por encima de la capacidad</span>
            <span className="it"><span className="key" style={{ outline: '2px dashed var(--high)', outlineOffset: -2 }} />Riesgo (≥ {Math.round(risk * 100)} %)</span>
            <span className="it"><span className="key" style={{ background: 'repeating-linear-gradient(135deg, var(--surface-3) 0 3px, transparent 3px 7px)', border: '1px solid var(--border)' }} />Sin capacidad conocida</span>
            <span className="it">«·» = día sin capacidad (festivo, parada o no laborable)</span>
          </div>
        </div>
      </Panel>
      <SummaryTables a={a} load={load} g={g} />
      {cell && <CellDrawer a={a} rl={cell.rl} c={cell.c} onClose={() => setCell(undefined)} />}
    </div>
  );
}

function SummaryTables({ a, load, g }: { a: Analysis; load: LoadResult; g: Granularity }) {
  const top = (map: Map<string, ResourceLoad>) =>
    [...map.values()]
      .flatMap((rl) => [...rl.buckets[g].values()].filter((c) => c.start >= addDays(startOfDay(a.refMs), -7)).map((c) => ({ rl, c })))
      .filter((x) => x.c.loadH > 0)
      .sort((x, y) => (y.c.occupancy ?? -1) - (x.c.occupancy ?? -1) || y.c.loadH - x.c.loadH)
      .slice(0, 10);
  const free = [...load.puestos.values()]
    .map((rl) => {
      const cs = [...rl.buckets.semana.values()].filter((c) => c.start >= addDays(startOfDay(a.refMs), -6) && c.start < addDays(a.refMs, a.settings.horizonWeeks * 7));
      return { rl, free: cs.reduce((s, c) => (c.capacityH !== undefined ? s + Math.max(0, c.capacityH - c.loadH) : s), 0) };
    })
    .filter((x) => x.rl.capSource !== 'desconocida')
    .sort((x, y) => y.free - x.free);
  const label = (c: LoadCell) => (g === 'semana' ? weekLabel(c.key) : c.key);
  return (
    <div className="grid grid-3">
      <Panel title="Periodos más saturados por puesto" sub="Desde la semana actual">
        <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {top(load.puestos).map(({ rl, c }) => (
            <li key={`${rl.id}${c.key}`}>
              <span className="id">{rl.id}</span> · {label(c)}: {c.occupancy !== undefined ? <strong>{fmtPct(c.occupancy)}</strong> : 'capacidad desconocida'} ({fmtHours(c.loadH)})
            </li>
          ))}
        </ol>
      </Panel>
      <Panel title="Periodos más saturados por sección">
        <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {top(load.secciones).map(({ rl, c }) => (
            <li key={`${rl.id}${c.key}`}>
              {rl.id} · {label(c)}: {c.occupancy !== undefined ? <strong>{fmtPct(c.occupancy)}</strong> : 'capacidad desconocida'} ({fmtHours(c.loadH)}){rl.capSource === 'parcial' ? ' · capacidad parcial' : ''}
            </li>
          ))}
        </ol>
      </Panel>
      <Panel title="Recursos con capacidad disponible" sub={`Horas libres en las próximas ${a.settings.horizonWeeks} semanas`}>
        <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {free.slice(0, 10).map((x) => (
            <li key={x.rl.id}>
              <span className="id">{x.rl.id}</span> {a.model.puestos.get(x.rl.id)?.desc}: {fmtHours(x.free)}
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}

function CellDrawer({ a, rl, c, onClose }: { a: Analysis; rl: ResourceLoad; c: LoadCell; onClose: () => void }) {
  const [op, setOp] = useState<string>();
  const items = [...new Set(c.ids)].map((id) => ({ id, op: a.model.ops.get(id), ort: a.ortems.get(id) }));
  return (
    <Drawer title={`${rl.id} · ${c.key}`} onClose={onClose} wide>
      <dl className="kv">
        <dt>Carga</dt>
        <dd>{fmtHours(c.loadH)}{c.estimatedH ? ` (${fmtHours(c.estimatedH)} estimadas)` : ''}</dd>
        <dt>Capacidad</dt>
        <dd>{c.capacityH !== undefined ? fmtHours(c.capacityH) : 'Desconocida'}</dd>
        <dt>Ocupación</dt>
        <dd>{fmtPct(c.occupancy)}</dd>
      </dl>
      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Origen</th>
              <th>Orden / op.</th>
              <th>Puesto</th>
              <th>Aparato</th>
            </tr>
          </thead>
          <tbody>
            {items.map((x) => (
              <tr key={x.id} className={x.op ? 'clickable' : ''} onClick={() => x.op && setOp(x.id)}>
                <td>{x.op ? 'Producción' : 'Ortems'}</td>
                <td className="id">{x.op ? `${x.op.ordenId}/${x.op.label}` : `${x.ort?.ordenId ?? x.ort?.preordenId ?? ''}/${x.ort?.operacionId ?? ''}`}</td>
                <td className="id">{x.op?.puestoId ?? x.ort?.puestoId}</td>
                <td className="id">{x.op?.aparatoId ?? x.ort?.aparatoId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {op && <OperationDetail analysis={a} opKey={op} onClose={() => setOp(undefined)} />}
    </Drawer>
  );
}

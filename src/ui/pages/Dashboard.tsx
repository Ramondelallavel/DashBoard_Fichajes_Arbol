import { useMemo, useState } from 'react';
import { useAnalysis } from '../../app/AnalysisContext';
import { go } from '../../app/router';
import { useApp } from '../../data/store';
import { isRetrasada } from '../../engine/analysis';
import { CONFIANZA_LABEL } from '../../engine/bottlenecks';
import { naturalCompare } from '../../lib/text';
import { addDays, weekKey, weekKeyStart, weekLabel } from '../../lib/dates';
import { fmtHours, fmtNum, fmtPct } from '../../lib/format';
import { bottleneckSheets, loadSheet, ordersSheet, planningSheet } from '../../export/reports';
import { DivergingColumns, HBarList, PeriodColumns, StatusLegend } from '../components/charts';
import { ConfPill, CritPill, Kpi, NoData, Notice, Panel } from '../components/common';
import { Icon } from '../components/Icon';
import { useExport } from '../components/useExport';
import { BASE_LABEL, FiltersRow, occStatus, PageHead, useFilteredLoad, weekOptions } from './shared';

export function DashboardPage({ onFilters }: { onFilters: () => void }) {
  const { analysis: a, filtered } = useAnalysis();
  const setFilters = useApp((s) => s.setFilters);
  const filters = useApp((s) => s.filters);
  const load = useFilteredLoad(a, filtered);
  const [week, setWeek] = useState<string | undefined>();
  const exp = useExport();

  const kpis = useMemo(() => {
    if (!a || !filtered) return undefined;
    const ords = [...filtered.ordenes].map((id) => a.model.ordenes.get(id)!).filter(Boolean);
    const preordenes = new Set<string>();
    for (const o of ords) if (o.preordenId) preordenes.add(o.preordenId);
    for (const rid of filtered.ortemsOnly) {
      const r = a.ortems.get(rid);
      if (r?.preordenId) preordenes.add(r.preordenId);
    }
    const pendientes = ords.filter((o) => o.estado !== 'terminada').length;
    const retrasadas = ords.filter((o) => o.opKeys.some((k) => filtered.ops.has(k) && isRetrasada(a.opFlags.get(k)))).length;
    const conDisc = ords.filter((o) => (a.comparison.byOrden.get(o.id) ?? []).some((r) => !r.coincide && (r.level === 'operacion' || r.level === 'orden'))).length;
    const sinOrtems = ords.filter((o) => (a.comparison.byOrden.get(o.id) ?? []).some((r) => r.level === 'solo_produccion')).length;
    const solapes = a.overlaps.produccion.filter((g) => g.clase !== 'solape_dentro_capacidad' && g.ids.some((k) => filtered.ops.has(k)));
    const confirmedOv = solapes.filter((g) => g.clase === 'sobrecarga_confirmada').length;
    const satPuestos = a.bottlenecks.ranking.filter((r) => (!filtered.active || load?.puestos.has(r.id)) && r.overloadedWeeks > 0);
    const inSel = (x: (typeof a.alerts)[number]) => !filtered.active || (x.opKey ? filtered.ops.has(x.opKey) : x.ordenId ? filtered.ordenes.has(x.ordenId) : true);
    const criticas = a.alerts.filter((x) => x.criticidad === 'critica' && inSel(x)).length;
    const altas = a.alerts.filter((x) => x.criticidad === 'alta' && inSel(x)).length;
    return {
      aparatos: filtered.aparatos.size,
      ordenes: ords.length,
      preordenes: preordenes.size,
      ops: filtered.ops.size,
      pendientes,
      retrasadas,
      conDisc,
      sinOrtems,
      solapes: solapes.length,
      confirmedOv,
      satPuestos,
      ortemsOnly: filtered.ortemsOnly.size,
      criticas,
      altas,
    };
  }, [a, filtered, load]);

  if (!a || !filtered || !kpis || !load) return <NoData />;
  const preNodes = [...a.model.ordenes.values()].every((o) => o.tipo === 'preorden');

  const weeks = weekOptions(load, a.refMs);
  const curWeek = week ?? weekKey(a.refMs);
  const risk = a.settings.riskThreshold;
  const weekLoad = [...load.puestos.values()].reduce((s, p) => s + (p.buckets.semana.get(curWeek)?.loadH ?? 0), 0);
  const weekCap = [...load.puestos.values()].reduce((s, p) => s + (p.buckets.semana.get(curWeek)?.capacityH ?? 0), 0);
  const unknownCapPuestos = [...load.puestos.values()].filter((p) => p.capSource === 'desconocida' && (p.buckets.semana.get(curWeek)?.loadH ?? 0) > 0).length;

  const seccionItems = [...load.secciones.values()]
    .map((s) => {
      const c = s.buckets.semana.get(curWeek);
      return {
        id: s.id,
        label: s.id,
        value: c?.loadH ?? 0,
        cap: c?.capacityH,
        status: occStatus(c?.occupancy, risk, s.capSource !== 'desconocida'),
        valueLabel: c?.occupancy !== undefined ? fmtPct(c.occupancy) : fmtHours(c?.loadH ?? 0),
        title: `${s.id}: ${fmtHours(c?.loadH ?? 0)} de carga${c?.capacityH !== undefined ? ` / ${fmtHours(c.capacityH)} de capacidad${s.capSource === 'parcial' ? ' (parcial)' : ''}` : ' · capacidad desconocida'}`,
      };
    })
    .filter((x) => x.value > 0 || (x.cap ?? 0) > 0)
    .sort((x, y) => y.value - x.value);
  const puestoItems = [...load.puestos.values()]
    .map((p) => {
      const c = p.buckets.semana.get(curWeek);
      return {
        id: p.id,
        label: `${p.id} ${a.model.puestos.get(p.id)?.desc ?? ''}`,
        value: c?.loadH ?? 0,
        cap: c?.capacityH,
        status: occStatus(c?.occupancy, risk, p.capSource !== 'desconocida'),
        valueLabel: c?.occupancy !== undefined ? fmtPct(c.occupancy) : fmtHours(c?.loadH ?? 0),
        title: `${p.id}: ${fmtHours(c?.loadH ?? 0)}${c?.capacityH !== undefined ? ` / ${fmtHours(c.capacityH)}` : ' · capacidad desconocida'}`,
      };
    })
    .filter((x) => x.value > 0)
    .sort((x, y) => (y.cap ? y.value / y.cap : 0) - (x.cap ? x.value / x.cap : 0) || y.value - x.value)
    .slice(0, 12);

  // Evolución semanal (todas las semanas con carga, sumando puestos con capacidad conocida para la línea)
  const weeklyAll = new Map<string, { load: number; cap: number; capAll: boolean }>();
  for (const p of load.puestos.values()) {
    for (const c of p.buckets.semana.values()) {
      const w = weeklyAll.get(c.key) ?? { load: 0, cap: 0, capAll: true };
      w.load += c.loadH;
      if (c.capacityH !== undefined) w.cap += c.capacityH;
      else if (c.loadH > 0) w.capAll = false;
      weeklyAll.set(c.key, w);
    }
  }
  const weekly = [...weeklyAll.entries()]
    .sort((x, y) => weekKeyStart(x[0]) - weekKeyStart(y[0]))
    .filter(([k]) => weekKeyStart(k) >= addDays(a.refMs, -56))
    .slice(0, 20)
    .map(([k, v]) => ({ key: k, label: weekLabel(k).split(' ')[0], value: v.load, cap: v.cap || undefined, highlight: k === curWeek, title: `${weekLabel(k)}${v.capAll ? '' : ' · algunos puestos sin capacidad conocida'}` }));

  // Órdenes por prioridad Ortems
  const prioCount = new Map<string, number>();
  for (const id of filtered.ordenes) {
    const p = (a.comparison.byOrden.get(id) ?? []).find((r) => r.prioridadRaw)?.prioridadRaw ?? 'Sin prioridad Ortems';
    prioCount.set(p, (prioCount.get(p) ?? 0) + 1);
  }
  const prioItems = [...prioCount.entries()].sort((x, y) => naturalCompare(x[0], y[0])).map(([k, v]) => ({ id: k, label: k === 'Sin prioridad Ortems' ? k : `Prioridad ${k}`, value: v, valueLabel: fmtNum(v) }));

  // Distribución por familia
  const famCount = new Map<string, number>();
  for (const id of filtered.ordenes) {
    const o = a.model.ordenes.get(id);
    const f = o?.familia ?? (o?.aparatoId ? a.model.aparatos.get(o.aparatoId)?.familia : undefined) ?? '(sin familia)';
    famCount.set(f, (famCount.get(f) ?? 0) + 1);
  }
  const famItems = [...famCount.entries()].sort((x, y) => y[1] - x[1]).map(([k, v]) => ({ id: k, label: k, value: v, valueLabel: `${fmtNum(v)} órd.` }));

  // Evolución de desviaciones (media del desfase de fin, por semana del fin de producción)
  const devByWeek = new Map<string, { sum: number; n: number }>();
  for (const r of a.comparison.rows) {
    if ((r.level !== 'operacion' && r.level !== 'orden') || r.dEndWD === undefined || r.prodEnd === undefined) continue;
    if (r.opKey && !filtered.ops.has(r.opKey)) continue;
    if (!r.opKey && r.ordenId && !filtered.ordenes.has(r.ordenId)) continue;
    const k = weekKey(r.prodEnd);
    const v = devByWeek.get(k) ?? { sum: 0, n: 0 };
    v.sum += r.dEndWD;
    v.n++;
    devByWeek.set(k, v);
  }
  const devData = [...devByWeek.entries()]
    .sort((x, y) => weekKeyStart(x[0]) - weekKeyStart(y[0]))
    .slice(-20)
    .map(([k, v]) => ({ key: k, label: weekLabel(k).split(' ')[0], value: v.sum / v.n, count: v.n }));

  const topAlerts = a.alerts.filter((x) => (x.criticidad === 'critica' || x.criticidad === 'alta') && (!filtered.active || (x.opKey ? filtered.ops.has(x.opKey) : x.ordenId ? filtered.ordenes.has(x.ordenId) : true))).slice(0, 6);
  const forecasts = a.bottlenecks.forecasts.filter((f) => !filtered.active || (f.scope === 'puesto' ? load.puestos : load.secciones).has(f.entityId)).slice(0, 6);
  const demo = a.demonstrated.forecasts.filter((f) => !filtered.active || load.secciones.has(f.seccion)).slice(0, 6);

  return (
    <div className="page">
      <PageHead
        eyebrow="Visión general"
        title="Situación de fábrica"
        lead={`Indicadores calculados sobre la planificación importada y los filtros activos. Carga y cuellos de botella sobre la planificación de ${BASE_LABEL[a.loadBase]}. Los valores de ocupación solo se muestran donde hay capacidad configurada.`}
        actions={
          <button
            className="btn"
            disabled={!exp.allowed || exp.busy}
            onClick={() => void exp.run('situacion_fabrica', 'Situación de fábrica', (ctx) => [ordersSheet(ctx), planningSheet(ctx), loadSheet(ctx.analysis, 'puesto', 'semana', ctx.analysis.loadBase), loadSheet(ctx.analysis, 'seccion', 'semana', ctx.analysis.loadBase), ...bottleneckSheets(ctx.analysis)])}
          >
            <Icon name="download" /> Exportar a Excel
          </button>
        }
      />
      <FiltersRow onFilters={onFilters} />
      <div className="grid grid-kpi five">
        <Kpi label="Aparatos" value={fmtNum(kpis.aparatos)} onClick={() => go('arbol')} />
        <Kpi label={preNodes ? 'Preórdenes con fichajes' : 'Órdenes de fabricación'} value={fmtNum(kpis.ordenes)} sub={`${fmtNum(kpis.pendientes)} pendientes o en curso`} onClick={() => go('gantt')} />
        <Kpi label="Preórdenes" value={fmtNum(kpis.preordenes)} sub={kpis.ortemsOnly ? `${fmtNum(kpis.ortemsOnly)} registros solo en Ortems` : undefined} />
        <Kpi label="Operaciones" value={fmtNum(kpis.ops)} sub={filtered.active ? `de ${fmtNum(filtered.totalOps)}` : undefined} />
        <Kpi label="Órdenes retrasadas" value={fmtNum(kpis.retrasadas)} state={kpis.retrasadas ? 'crit' : undefined} sub="con alguna operación retrasada" onClick={() => setFilters({ ...filters, flags: { ...filters.flags, retrasada: true } })} />
        <Kpi label="Órdenes con discrepancias" value={fmtNum(kpis.conDisc)} state={kpis.conDisc ? 'high' : undefined} sub={`${fmtNum(kpis.sinOrtems)} sin correspondencia en Ortems`} onClick={() => go('ortems')} />
        <Kpi label="Solapamientos conflictivos" value={fmtNum(kpis.solapes)} state={kpis.confirmedOv ? 'high' : kpis.solapes ? 'med' : undefined} sub={`${fmtNum(kpis.confirmedOv)} sobrecargas confirmadas`} onClick={() => go('cuellos')} />
        <Kpi
          label="Puestos saturados (horizonte)"
          value={fmtNum(kpis.satPuestos.length)}
          state={kpis.satPuestos.some((p) => p.confianza === 'confirmado') ? 'crit' : kpis.satPuestos.length ? 'med' : undefined}
          sub={kpis.satPuestos.length ? kpis.satPuestos.slice(0, 4).map((p) => p.id).join(', ') : `próximas ${a.settings.horizonWeeks} semanas`}
          onClick={() => go('cuellos')}
        />
        <Kpi
          label="Alertas críticas"
          value={fmtNum(kpis.criticas)}
          state={kpis.criticas ? 'crit' : undefined}
          sub={`${fmtNum(kpis.altas)} de criticidad alta`}
          onClick={() => go('alertas')}
        />
        <Kpi label={`Carga ${weekLabel(curWeek)}`} value={fmtHours(weekLoad)} sub={weekCap ? `${fmtPct(weekLoad / weekCap)} de ${fmtHours(weekCap)} con capacidad conocida` : 'sin capacidad configurada'} onClick={() => go('carga')} />
      </div>

      <div className="grid grid-2">
        <Panel
          title="Carga por sección"
          sub={`Semana ISO ${weekLabel(curWeek)}`}
          actions={
            <select className="input input-sm" style={{ width: 'auto' }} value={curWeek} onChange={(e) => setWeek(e.target.value)} aria-label="Semana">
              {weeks.map((w) => (
                <option key={w.key} value={w.key}>
                  {w.label}
                </option>
              ))}
            </select>
          }
        >
          <div className="stack">
            <HBarList items={seccionItems} onSelect={(id) => setFilters({ ...filters, secciones: [id] })} emptyText="Sin carga en la semana seleccionada" />
            <StatusLegend />
            {unknownCapPuestos > 0 && <span className="small muted">{unknownCapPuestos} puesto(s) con carga esta semana no tienen capacidad configurada: su sección se muestra con capacidad parcial o desconocida.</span>}
          </div>
        </Panel>
        <Panel title="Puestos con mayor ocupación" sub={`Semana ISO ${weekLabel(curWeek)} · ordenados por ocupación`}>
          <HBarList items={puestoItems} onSelect={(id) => setFilters({ ...filters, puestos: [id] })} emptyText="Sin carga en la semana seleccionada" />
        </Panel>
      </div>

      <Panel title="Evolución de la carga semanal" sub="Horas previstas (columnas) frente a capacidad conocida (línea). ▲ = por encima de la capacidad.">
        <PeriodColumns data={weekly} onSelect={setWeek} ariaLabel="Carga semanal frente a capacidad" />
      </Panel>

      <div className="grid grid-3">
        <Panel title="Órdenes por prioridad (Ortems)">
          <HBarList items={prioItems} />
        </Panel>
        <Panel title="Órdenes por familia de aparato">
          <HBarList items={famItems} onSelect={(id) => setFilters({ ...filters, familias: [id] })} />
        </Panel>
        <Panel title="Desviación media de fin frente a Ortems" sub="Días laborables por semana. Rojo = producción termina más tarde; azul = antes.">
          <DivergingColumns data={devData} ariaLabel="Desviación media por semana" unit="días laborables" />
        </Panel>
      </div>

      <div className="grid grid-2">
        <Panel title="Alertas críticas y altas" actions={<a className="btn btn-sm" href="#alertas">Ver todas</a>}>
          {topAlerts.length ? (
            <div className="stack">
              {topAlerts.map((x) => (
                <div key={x.id} className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                  <CritPill c={x.criticidad} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 500 }}>{x.title}</div>
                    <div className="small muted">{x.description}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <span className="small muted">Sin alertas críticas ni altas en la selección.</span>
          )}
        </Panel>
        <Panel title="Previsión de cuellos de botella" actions={<a className="btn btn-sm" href="#cuellos">Analizar</a>}>
          {forecasts.length || demo.length ? (
            <div className="stack">
              {forecasts.map((f) => (
                <div key={f.id} className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                  <ConfPill c={f.confianza} />
                  <div className="small">{f.message}</div>
                </div>
              ))}
              {demo.map((f) => (
                <div key={f.id} className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                  <ConfPill c="estimado" />
                  <div className="small">{f.message}</div>
                </div>
              ))}
              <span className="small muted">Certeza: «{CONFIANZA_LABEL.confirmado}» exige capacidad configurada; lo demás se presenta como estimado o sin capacidad conocida.</span>
            </div>
          ) : (
            <Notice kind="ok">No se prevén saturaciones en las próximas {a.settings.horizonWeeks} semanas para la selección.</Notice>
          )}
        </Panel>
      </div>
    </div>
  );
}

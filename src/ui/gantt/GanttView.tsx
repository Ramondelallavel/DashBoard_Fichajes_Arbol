import { useEffect, useMemo, useState } from 'react';
import type { Analysis } from '../../engine/analysis';
import type { FilterResult } from '../../engine/filters';
import { addDays, DAY, parseDayKey, startOfDay } from '../../lib/dates';
import { Seg } from '../components/common';
import { Icon } from '../components/Icon';
import { OperationDetail } from '../components/OperationDetail';
import { Gantt, GanttLegend, paddedRange } from './Gantt';
import { allNodeIds, buildTree, dataRange, flatten, type GBar, type GroupBy, type GRow, type SourceMode } from './rows';
import { SCALES, type ScaleId } from './timeScale';

interface Props {
  analysis: Analysis;
  filtered?: FilterResult;
  onlyAparato?: string;
  defaultGroup?: GroupBy;
  defaultScale?: ScaleId;
  showDeps?: boolean;
  compact?: boolean;
  allowedGroups?: GroupBy[];
  expandAllByDefault?: boolean;
}

const GROUP_LABEL: Record<GroupBy, string> = {
  aparato: 'Aparato › Orden › Operación',
  familia: 'Familia › Aparato › Orden',
  seccion: 'Sección › Puesto › Operación',
  puesto: 'Puesto › Operación',
  orden: 'Orden › Operación',
};

const PERIOD_STEP: Record<ScaleId, number> = { dia: 7, semana: 28, mes: 91, trimestre: 182, anio: 365 };

export function GanttView({ analysis, filtered, onlyAparato, defaultGroup = 'aparato', defaultScale = 'semana', showDeps, compact, allowedGroups, expandAllByDefault }: Props) {
  const [groupBy, setGroupBy] = useState<GroupBy>(defaultGroup);
  const [source, setSource] = useState<SourceMode>('ambas');
  const [scaleId, setScaleId] = useState<ScaleId>(defaultScale);
  const [zoom, setZoom] = useState(1);
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [collapsedByDefault, setCollapsedByDefault] = useState(!expandAllByDefault);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [scrollTo, setScrollTo] = useState<{ t: number; n: number } | undefined>();
  const [sel, setSel] = useState<{ opKey?: string; ortemsRid?: string; rowId: string } | undefined>();

  // Al cambiar el agrupamiento, los grupos de primer nivel por puesto/sección se muestran abiertos
  useEffect(() => {
    setToggled(new Set());
    setCollapsedByDefault(!expandAllByDefault);
  }, [groupBy, expandAllByDefault]);

  const roots = useMemo(() => buildTree(analysis, filtered, groupBy, source, onlyAparato), [analysis, filtered, groupBy, source, onlyAparato]);
  const effectiveToggled = useMemo(() => {
    if (!collapsedByDefault || toggled.size || (groupBy !== 'seccion' && groupBy !== 'familia')) return toggled;
    return new Set(roots.map((r) => r.id));
  }, [collapsedByDefault, toggled, groupBy, roots]);
  const rows: GRow[] = useMemo(() => flatten(roots, effectiveToggled, collapsedByDefault), [roots, effectiveToggled, collapsedByDefault]);
  const autoRange = useMemo(() => paddedRange(dataRange(roots), analysis.refMs), [roots, analysis.refMs]);
  const range: [number, number] = useMemo(() => {
    const f = from ? parseDayKey(from) : autoRange[0];
    const t = to ? addDays(parseDayKey(to), 1) : autoRange[1];
    return t > f ? [f, t] : autoRange;
  }, [from, to, autoRange]);

  // Al abrir, situar la vista cerca de la fecha de referencia
  useEffect(() => {
    setScrollTo({ t: Math.max(range[0], addDays(startOfDay(analysis.refMs), scaleId === 'dia' ? -1 : scaleId === 'semana' ? -7 : -42)), n: Date.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scaleId, onlyAparato]);

  const toggle = (id: string) => {
    const n = new Set(effectiveToggled);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setToggled(n);
  };
  const expandAll = () => {
    setCollapsedByDefault(false);
    setToggled(new Set());
  };
  const collapseAll = () => {
    setCollapsedByDefault(true);
    setToggled(new Set(['__none__']));
  };
  const shift = (dir: 1 | -1) => setScrollTo((s) => ({ t: (s?.t ?? analysis.refMs) + dir * PERIOD_STEP[scaleId] * DAY, n: Date.now() }));
  const onSelect = (bar: GBar | undefined, row: GRow) => {
    if (bar?.opKey && !bar.summary) setSel({ opKey: bar.opKey, rowId: row.id });
    else if (row.ortemsRid) setSel({ ortemsRid: row.ortemsRid, rowId: row.id });
    else if (row.hasChildren) toggle(row.id);
  };
  const groups = allowedGroups ?? (['aparato', 'familia', 'seccion', 'puesto', 'orden'] as GroupBy[]);
  const total = allNodeIds(roots).length;

  return (
    <div className="panel">
      <div className="gantt-toolbar">
        {groups.length > 1 && (
          <div className="field" style={{ minWidth: 220 }}>
            <label htmlFor="g-group" className="sr-only">
              Agrupar por
            </label>
            <select id="g-group" className="input input-sm" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} aria-label="Agrupar por">
              {groups.map((g) => (
                <option key={g} value={g}>
                  {GROUP_LABEL[g]}
                </option>
              ))}
            </select>
          </div>
        )}
        <Seg
          label="Fuente de planificación"
          value={source}
          onChange={setSource}
          items={[
            { id: 'produccion', label: 'Producción' },
            { id: 'ortems', label: 'Ortems' },
            { id: 'ambas', label: 'Ambas' },
          ]}
        />
        <span className="sep" />
        <Seg label="Escala temporal" value={scaleId} onChange={(v) => { setScaleId(v); setZoom(1); }} items={(Object.keys(SCALES) as ScaleId[]).map((s) => ({ id: s, label: SCALES[s].label }))} />
        <div className="btn-group" role="group" aria-label="Zoom">
          <button className="btn btn-sm" onClick={() => setZoom((z) => Math.max(0.25, z / 1.5))} aria-label="Reducir">
            <Icon name="zoomOut" />
          </button>
          <button className="btn btn-sm" onClick={() => setZoom((z) => Math.min(6, z * 1.5))} aria-label="Ampliar">
            <Icon name="zoomIn" />
          </button>
        </div>
        <span className="sep" />
        <div className="btn-group" role="group" aria-label="Navegación temporal">
          <button className="btn btn-sm" onClick={() => shift(-1)} aria-label="Periodo anterior">
            <Icon name="chevronLeft" />
          </button>
          <button className="btn btn-sm" onClick={() => setScrollTo({ t: addDays(startOfDay(analysis.refMs), -2), n: Date.now() })}>
            {analysis.settings.referenceDate ? 'Referencia' : 'Hoy'}
          </button>
          <button className="btn btn-sm" onClick={() => shift(1)} aria-label="Periodo siguiente">
            <Icon name="chevronRight" />
          </button>
        </div>
        <label className="row small" style={{ gap: 4 }}>
          Desde
          <input type="date" className="input input-sm" style={{ width: 140 }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Inicio del periodo" />
        </label>
        <label className="row small" style={{ gap: 4 }}>
          Hasta
          <input type="date" className="input input-sm" style={{ width: 140 }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="Fin del periodo" />
        </label>
        {(from || to) && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setFrom(''); setTo(''); }}>
            Todo el periodo
          </button>
        )}
        <span className="sep" />
        <button className="btn btn-sm" onClick={expandAll} disabled={!total} title="Desplegar todo">
          <Icon name="expand" /> Desplegar
        </button>
        <button className="btn btn-sm" onClick={collapseAll} disabled={!total} title="Contraer todo">
          <Icon name="collapse" /> Contraer
        </button>
      </div>
      {rows.length ? (
        <Gantt
          analysis={analysis}
          rows={rows}
          range={range}
          scaleId={scaleId}
          zoom={zoom}
          source={source}
          onToggle={toggle}
          onSelect={onSelect}
          selectedId={sel?.rowId}
          showDeps={showDeps}
          compact={compact}
          scrollTo={scrollTo}
          labelWidth={compact ? 300 : 340}
        />
      ) : (
        <div className="empty">
          <span className="big">No hay operaciones que mostrar</span>
          {filtered?.active ? 'Los filtros activos ocultan todas las operaciones. Revise la barra de filtros.' : 'Las operaciones no tienen fechas o no hay datos importados.'}
        </div>
      )}
      <GanttLegend
        extra={
          showDeps ? (
            <>
              <span className="it">
                <svg width="26" height="10" aria-hidden="true"><path d="M1 5H25" stroke="var(--fg-2)" strokeWidth="1.2" /></svg> Dependencia confirmada
              </span>
              <span className="it">
                <svg width="26" height="10" aria-hidden="true"><path d="M1 5H25" stroke="var(--fg-3)" strokeWidth="1.2" strokeDasharray="3 3" /></svg> Dependencia inferida
              </span>
              <span className="it">
                <svg width="26" height="10" aria-hidden="true"><path d="M1 5H25" stroke="var(--crit)" strokeWidth="1.8" /></svg> Precedencia incumplida
              </span>
            </>
          ) : undefined
        }
      />
      {sel && <OperationDetail analysis={analysis} opKey={sel.opKey} ortemsRid={sel.ortemsRid} onClose={() => setSel(undefined)} />}
    </div>
  );
}

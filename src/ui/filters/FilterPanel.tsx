import { useMemo, useState } from 'react';
import { useAnalysis } from '../../app/AnalysisContext';
import { useApp } from '../../data/store';
import type { EstadoCanonico } from '../../domain/types';
import { clearChip, EMPTY_FILTERS, ESTADO_LABEL, filterChips, FLAG_LABEL, type FilterState } from '../../engine/filters';
import { isoWeek, weeksInIsoYear } from '../../lib/dates';
import { fmtNum } from '../../lib/format';
import { Drawer, MultiSelect } from '../components/common';
import { Icon } from '../components/Icon';

export function FilterPanel({ onClose }: { onClose: () => void }) {
  const { options, analysis, filtered } = useAnalysis();
  const filters = useApp((s) => s.filters);
  const setFilters = useApp((s) => s.setFilters);
  const saved = useApp((s) => s.savedFilters);
  const saveFilter = useApp((s) => s.saveFilter);
  const deleteFilter = useApp((s) => s.deleteFilter);
  const [name, setName] = useState('');
  const f = filters;
  const upd = (p: Partial<FilterState>) => setFilters({ ...f, ...p });
  const updFlag = (k: keyof FilterState['flags'], v: boolean) => setFilters({ ...f, flags: { ...f.flags, [k]: v || undefined } });

  // semanas con operaciones previstas en el año seleccionado (para orientar la selección)
  const weeksWithData = useMemo(() => {
    const s = new Set<number>();
    if (!analysis || !f.year) return s;
    for (const op of analysis.model.ops.values()) {
      for (const t of [op.start, op.end]) {
        if (t === undefined) continue;
        const w = isoWeek(t);
        if (w.year === f.year) s.add(w.week);
      }
    }
    return s;
  }, [analysis, f.year]);

  const years = options?.years ?? [];
  const nWeeks = f.year ? weeksInIsoYear(f.year) : 52;

  return (
    <Drawer
      title={
        <span className="row" style={{ gap: 8 }}>
          <Icon name="filter" /> Filtros
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <span className="small muted" style={{ marginRight: 'auto' }}>
            {filtered ? `${fmtNum(filtered.ops.size)} de ${fmtNum(filtered.totalOps)} operaciones` : ''}
          </span>
          <button className="btn" onClick={() => setFilters(EMPTY_FILTERS)} disabled={!filterChips(f).length}>
            Limpiar filtros
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            Ver resultados
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="f-q">Búsqueda rápida</label>
        <input id="f-q" className="input" placeholder="Aparato, orden, artículo, puesto, descripción…" value={f.q} onChange={(e) => upd({ q: e.target.value })} />
      </div>

      <div className="fgroup">
        <h3>Aparato y producto</h3>
        <div className="fgrid">
          <MultiSelect id="f-aparatos" label="Número de aparato" options={options?.aparatos ?? []} value={f.aparatos} onChange={(v) => upd({ aparatos: v })} />
          <MultiSelect id="f-articulos" label="Referencia de artículo" options={options?.articulos ?? []} value={f.articulos} onChange={(v) => upd({ articulos: v })} />
          <MultiSelect id="f-familias" label="Familia de aparato" options={options?.familias ?? []} value={f.familias} onChange={(v) => upd({ familias: v })} />
          <div className="field">
            <label htmlFor="f-desc">Descripción del artículo</label>
            <input id="f-desc" className="input" value={f.descripcion} onChange={(e) => upd({ descripcion: e.target.value })} placeholder="Contiene…" />
          </div>
        </div>
      </div>

      <div className="fgroup">
        <h3>Organización industrial</h3>
        <div className="fgrid">
          <MultiSelect
            id="f-puestos"
            label="Puesto de trabajo"
            options={options?.puestos ?? []}
            value={f.puestos}
            onChange={(v) => upd({ puestos: v })}
            renderOption={(o) => (
              <>
                <span className="id">{o}</span> <span className="muted">{analysis?.model.puestos.get(o)?.desc ?? ''}</span>
              </>
            )}
          />
          <MultiSelect id="f-secciones" label="Sección" options={options?.secciones ?? []} value={f.secciones} onChange={(v) => upd({ secciones: v })} />
          <MultiSelect id="f-areas" label="Área de producción" options={options?.areas ?? []} value={f.areas} onChange={(v) => upd({ areas: v })} placeholder={options?.areas.length ? 'Todas' : 'Sin datos en el Excel'} />
          <MultiSelect id="f-centros" label="Centro de trabajo" options={options?.centros ?? []} value={f.centros} onChange={(v) => upd({ centros: v })} placeholder={options?.centros.length ? 'Todos' : 'Sin datos en el Excel'} />
        </div>
      </div>

      <div className="fgroup">
        <h3>Tiempo</h3>
        <p className="small muted">
          Semanas ISO 8601: de lunes a domingo; la semana 1 es la que contiene el primer jueves del año. El año de la semana puede diferir del año natural cerca del 1 de enero.
        </p>
        <div className="fgrid">
          <div className="field">
            <label htmlFor="f-year">Año</label>
            <select id="f-year" className="input" value={f.year ?? ''} onChange={(e) => upd({ year: e.target.value ? Number(e.target.value) : undefined, weeks: [], month: undefined })}>
              <option value="">Todos</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-month">Mes</label>
            <select id="f-month" className="input" value={f.month ?? ''} disabled={!f.year || f.weeks.length > 0} onChange={(e) => upd({ month: e.target.value ? Number(e.target.value) : undefined })}>
              <option value="">{f.year ? 'Todos' : 'Elija antes el año'}</option>
              {['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'].map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <span>Semanas ISO {f.year ? `de ${f.year}` : '(elija antes el año)'}</span>
          {f.year ? (
            <div className="weeks" role="group" aria-label="Semanas">
              {Array.from({ length: nWeeks }, (_, i) => i + 1).map((w) => (
                <button
                  key={w}
                  type="button"
                  aria-pressed={f.weeks.includes(w)}
                  className={weeksWithData.has(w) ? 'has-data' : ''}
                  title={weeksWithData.has(w) ? `Semana ${w}: hay operaciones previstas` : `Semana ${w}`}
                  onClick={() => upd({ weeks: f.weeks.includes(w) ? f.weeks.filter((x) => x !== w) : [...f.weeks, w].sort((a, b) => a - b), month: undefined })}
                >
                  {w}
                </button>
              ))}
            </div>
          ) : (
            <span className="small muted">—</span>
          )}
        </div>
        <div className="fgrid">
          <div className="field">
            <label htmlFor="f-from">Desde</label>
            <input id="f-from" type="date" className="input" value={f.dateFrom ?? ''} onChange={(e) => upd({ dateFrom: e.target.value || undefined })} />
          </div>
          <div className="field">
            <label htmlFor="f-to">Hasta</label>
            <input id="f-to" type="date" className="input" value={f.dateTo ?? ''} onChange={(e) => upd({ dateTo: e.target.value || undefined })} />
          </div>
          <div className="field">
            <label htmlFor="f-on">Previstas en una fecha concreta</label>
            <input id="f-on" type="date" className="input" value={f.dateOn ?? ''} onChange={(e) => upd({ dateOn: e.target.value || undefined })} />
          </div>
        </div>
        <p className="small muted">Una operación cumple el filtro temporal si su intervalo previsto (de producción o, en su defecto, de Ortems) se solapa con el periodo.</p>
      </div>

      <div className="fgroup">
        <h3>Planificación</h3>
        <div className="fgrid">
          <MultiSelect id="f-ordenes" label="Número de orden" options={options?.ordenes ?? []} value={f.ordenes} onChange={(v) => upd({ ordenes: v })} />
          <div className="field">
            <label htmlFor="f-pre">Número de preorden</label>
            <input id="f-pre" className="input" value={f.preorden} onChange={(e) => upd({ preorden: e.target.value })} placeholder="Contiene…" />
          </div>
          <MultiSelect id="f-prio" label="Prioridad" options={options?.prioridades ?? []} value={f.prioridades} onChange={(v) => upd({ prioridades: v })} />
          <MultiSelect
            id="f-estado"
            label="Estado de fabricación"
            options={Object.keys(ESTADO_LABEL)}
            value={f.estados}
            onChange={(v) => upd({ estados: v as EstadoCanonico[] })}
            renderOption={(o) => ESTADO_LABEL[o as EstadoCanonico]}
          />
          <div className="field">
            <label htmlFor="f-fuente">Fuente de planificación</label>
            <select id="f-fuente" className="input" value={f.fuente} onChange={(e) => upd({ fuente: e.target.value as FilterState['fuente'] })}>
              <option value="todas">Todas</option>
              <option value="produccion">Producción</option>
              <option value="ortems">Ortems (incluye solo-Ortems)</option>
              <option value="ambas">Presentes en ambas fuentes</option>
            </select>
          </div>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          {(Object.keys(FLAG_LABEL) as (keyof FilterState['flags'])[]).map((k) => (
            <label className="check" key={k}>
              <input type="checkbox" checked={!!f.flags[k]} onChange={(e) => updFlag(k, e.target.checked)} />
              {FLAG_LABEL[k]}
            </label>
          ))}
        </div>
      </div>

      <div className="fgroup">
        <h3>Configuraciones guardadas</h3>
        <div className="row">
          <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="Nombre de la configuración" value={name} onChange={(e) => setName(e.target.value)} aria-label="Nombre de la configuración de filtros" />
          <button
            className="btn"
            disabled={!name.trim() || !filterChips(f).length}
            onClick={() => {
              void saveFilter(name.trim());
              setName('');
            }}
          >
            Guardar actual
          </button>
        </div>
        {saved.length === 0 && <span className="small muted">Aún no hay configuraciones guardadas.</span>}
        {saved.map((s) => (
          <div className="row" key={s.id} style={{ justifyContent: 'space-between' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setFilters(s.filters)} title={filterChips(s.filters).map((c) => c.label).join(' · ')}>
              {s.name}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => void deleteFilter(s.id)} aria-label={`Eliminar ${s.name}`}>
              <Icon name="trash" />
            </button>
          </div>
        ))}
      </div>
    </Drawer>
  );
}

/** Barra de filtros activos: siempre visible para que el usuario sepa qué está oculto. */
export function ActiveFilters({ onOpen }: { onOpen: () => void }) {
  const filters = useApp((s) => s.filters);
  const setFilters = useApp((s) => s.setFilters);
  const { filtered, analysis } = useAnalysis();
  const chips = filterChips(filters);
  const hiddenCritical = useMemo(() => {
    if (!analysis || !filtered || !chips.length) return 0;
    return analysis.alerts.filter((a) => a.criticidad === 'critica' && a.opKey && !filtered.ops.has(a.opKey)).length;
  }, [analysis, filtered, chips.length]);
  if (!analysis) return null;
  return (
    <div className="filterbar" aria-label="Filtros activos">
      <button className="btn btn-sm" onClick={onOpen}>
        <Icon name="filter" /> Filtros{chips.length ? ` (${chips.length})` : ''}
      </button>
      {chips.map((c) => (
        <span className="chip" key={c.key}>
          {c.label}
          <button onClick={() => setFilters(clearChip(filters, c.key))} aria-label={`Quitar filtro ${c.label}`}>
            ✕
          </button>
        </span>
      ))}
      {chips.length > 0 && filtered && (
        <span className="hidden-note">
          Mostrando {fmtNum(filtered.ops.size)} de {fmtNum(filtered.totalOps)} operaciones
          {filtered.totalOrtemsOnly ? ` · ${fmtNum(filtered.ortemsOnly.size)} de ${fmtNum(filtered.totalOrtemsOnly)} registros solo-Ortems` : ''}
          {hiddenCritical > 0 && (
            <>
              {' '}· <strong>{hiddenCritical} alertas críticas quedan fuera del filtro</strong>
            </>
          )}
        </span>
      )}
      {chips.length > 0 && (
        <button className="btn btn-ghost btn-sm" onClick={() => setFilters(EMPTY_FILTERS)}>
          Limpiar
        </button>
      )}
    </div>
  );
}

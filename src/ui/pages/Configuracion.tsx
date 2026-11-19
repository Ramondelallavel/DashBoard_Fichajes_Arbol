import { useEffect, useMemo, useRef, useState } from 'react';
import { useAnalysis } from '../../app/AnalysisContext';
import { can, ROLE_LABEL, type Permission } from '../../auth/roles';
import { useApp } from '../../data/store';
import { mergeSettings, type ResourceCapacity, type Settings } from '../../domain/settings';
import type { EstadoCanonico, Role } from '../../domain/types';
import { ESTADO_LABEL } from '../../engine/filters';
import { saveFile } from '../../export/download';
import { naturalCompare, normalizeHeader } from '../../lib/text';
import { Notice, Panel } from '../components/common';
import { Icon } from '../components/Icon';
import { PageHead } from './shared';
import { UsuariosPanel } from './Usuarios';

const WD = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

function emptyCap(puestoId: string): ResourceCapacity {
  return { puestoId, hoursPerWeekday: { 1: 8, 2: 8, 3: 8, 4: 8, 5: 8, 6: 0, 7: 0 }, units: 1, efficiency: 1, stops: [], specialDays: [] };
}

export function ConfiguracionPage() {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const profiles = useApp((s) => s.profiles);
  const deleteProfile = useApp((s) => s.deleteProfile);
  const role = useApp((s) => s.role);
  const mode = useApp((s) => s.mode);
  const toast = useApp((s) => s.toast);
  const { analysis } = useAnalysis();
  const [d, setD] = useState<Settings>(settings);
  const [newHoliday, setNewHoliday] = useState('');
  const [newState, setNewState] = useState({ text: '', canon: 'pendiente' as EstadoCanonico });
  const [newPrio, setNewPrio] = useState({ text: '', value: 1 });
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => setD(settings), [settings]);
  const canCap = can(role, 'configurar_capacidad');
  const canAll = can(role, 'configurar');
  const dirty = JSON.stringify(d) !== JSON.stringify(settings);
  const puestos = useMemo(() => {
    const ids = new Set<string>([...Object.keys(d.capacities), ...(analysis ? [...analysis.model.puestos.keys()] : [])]);
    return [...ids].sort(naturalCompare);
  }, [d.capacities, analysis]);
  const upd = (p: Partial<Settings>) => setD({ ...d, ...p });
  const updCap = (id: string, p: Partial<ResourceCapacity>) => upd({ capacities: { ...d.capacities, [id]: { ...(d.capacities[id] ?? emptyCap(id)), ...p } } });

  async function save() {
    await setSettings(mergeSettings(d));
    toast('ok', 'Configuración guardada. El análisis se ha recalculado.');
  }
  async function exportCfg() {
    const res = await saveFile('configuracion_planificacion.json', new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' }), 'application/json');
    toast(res.outcome === 'guardado' ? 'ok' : 'info', res.message);
  }
  async function importCfg(f: File) {
    try {
      const parsed = JSON.parse(await f.text()) as Partial<Settings>;
      if (typeof parsed !== 'object' || !parsed) throw new Error('formato no reconocido');
      setD(mergeSettings(parsed));
      toast('info', 'Configuración cargada. Revise y pulse «Guardar cambios».');
    } catch (e) {
      toast('error', `Archivo de configuración no válido: ${(e as Error).message}`);
    }
  }

  const saveBar = (
    <>
      <button className="btn" onClick={() => setD(settings)} disabled={!dirty}>
        Descartar cambios
      </button>
      <button className="btn btn-primary" onClick={() => void save()} disabled={!dirty || !canCap}>
        Guardar cambios
      </button>
    </>
  );

  return (
    <div className="page">
      <PageHead
        eyebrow="Datos"
        title="Configuración"
        lead="Reglas de cálculo explícitas y configurables. Ningún valor por defecto se presenta como dato: sin capacidad configurada no se calcula ocupación."
        actions={
          <>
            {mode === 'servidor' && can(role, 'administrar_usuarios') && (
              <button className="btn btn-sm" onClick={() => document.getElementById('usuarios')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                Usuarios y actividad
              </button>
            )}
            <button className="btn btn-sm" onClick={() => void exportCfg()}>
              <Icon name="download" /> Exportar configuración
            </button>
            <input ref={fileRef} type="file" accept=".json" hidden onChange={(e) => e.target.files?.[0] && void importCfg(e.target.files[0])} />
            <button className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={!canAll}>
              Cargar configuración
            </button>
            {saveBar}
          </>
        }
      />
      {dirty && <Notice kind="info">Hay cambios sin guardar.</Notice>}
      {!canCap && <Notice kind="warn">Su perfil ({ROLE_LABEL[role]}) solo permite consultar la configuración.</Notice>}

      <div className="grid grid-2">
        <Panel title="Análisis">
          <div className="fgrid">
            <div className="field">
              <label htmlFor="c-ref">Fecha de referencia</label>
              <input id="c-ref" type="date" className="input" value={d.referenceDate ?? ''} onChange={(e) => upd({ referenceDate: e.target.value || null })} disabled={!canCap} />
              <span className="small muted">Vacío = hoy. Se usa para retrasos y para el análisis futuro.</span>
            </div>
            <div className="field">
              <label htmlFor="c-hz">Horizonte de previsión (semanas)</label>
              <input id="c-hz" type="number" min={1} max={52} className="input" value={d.horizonWeeks} onChange={(e) => upd({ horizonWeeks: Math.max(1, Number(e.target.value) || 1) })} disabled={!canCap} />
            </div>
            <div className="field">
              <label htmlFor="c-risk">Umbral de riesgo de ocupación (%)</label>
              <input id="c-risk" type="number" min={10} max={100} className="input" value={Math.round(d.riskThreshold * 100)} onChange={(e) => upd({ riskThreshold: Math.min(1, Math.max(0.1, Number(e.target.value) / 100)) })} disabled={!canCap} />
            </div>
            <div className="field">
              <label htmlFor="c-keep">Versiones completas conservadas por fuente</label>
              <input id="c-keep" type="number" min={2} max={50} className="input" value={d.keepVersions} onChange={(e) => upd({ keepVersions: Math.max(2, Number(e.target.value) || 2) })} disabled={!canAll} />
            </div>
          </div>
          <label className="check" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={d.load.estimateDurationFromDates} onChange={(e) => upd({ load: { ...d.load, estimateDurationFromDates: e.target.checked } })} disabled={!canCap} />
            Si falta la duración, estimarla a partir de las fechas (los resultados se marcan como estimados)
          </label>
        </Panel>

        <Panel title="Calendario laboral global">
          <div className="stack">
            <div className="row">
              {WD.map((w, i) => (
                <label key={w} className="check">
                  <input
                    type="checkbox"
                    checked={d.calendar.workingWeekdays.includes(i + 1)}
                    disabled={!canCap}
                    onChange={(e) => upd({ calendar: { ...d.calendar, workingWeekdays: e.target.checked ? [...d.calendar.workingWeekdays, i + 1].sort() : d.calendar.workingWeekdays.filter((x) => x !== i + 1) } })}
                  />
                  {w}
                </label>
              ))}
            </div>
            <div className="row">
              <input type="date" className="input input-sm" style={{ width: 160 }} value={newHoliday} onChange={(e) => setNewHoliday(e.target.value)} aria-label="Nuevo festivo" disabled={!canCap} />
              <button className="btn btn-sm" disabled={!newHoliday || !canCap} onClick={() => { upd({ calendar: { ...d.calendar, holidays: [...new Set([...d.calendar.holidays, newHoliday])].sort() } }); setNewHoliday(''); }}>
                Añadir festivo
              </button>
            </div>
            <div className="row" style={{ gap: 6 }}>
              {d.calendar.holidays.map((h) => (
                <span key={h} className="chip">
                  {h.split('-').reverse().join('/')}
                  <button onClick={() => upd({ calendar: { ...d.calendar, holidays: d.calendar.holidays.filter((x) => x !== h) } })} disabled={!canCap} aria-label={`Quitar festivo ${h}`}>
                    ✕
                  </button>
                </span>
              ))}
              {!d.calendar.holidays.length && <span className="small muted">Sin festivos configurados.</span>}
            </div>
            <span className="small muted">Los días laborables globales se usan para los desfases en días laborables y para los puestos sin capacidad configurada.</span>
          </div>
        </Panel>
      </div>

      <Panel
        title="Capacidad por puesto de trabajo"
        sub="Horas por unidad y día de la semana × unidades en paralelo × eficiencia. Las paradas y festivos anulan la capacidad del día."
        actions={
          <label className="check">
            <input type="checkbox" checked={d.assumedCapacity.enabled} onChange={(e) => upd({ assumedCapacity: { ...d.assumedCapacity, enabled: e.target.checked } })} disabled={!canCap} />
            Usar capacidad supuesta para puestos sin configurar
          </label>
        }
        flush
      >
        {d.assumedCapacity.enabled && (
          <div className="panel-body row" style={{ borderBottom: '1px solid var(--border)' }}>
            <Notice kind="warn">Con la capacidad supuesta activada, las ocupaciones de los puestos sin configurar se calculan, pero siempre se etiquetan como ESTIMADAS.</Notice>
            <label className="row small" style={{ gap: 6 }}>
              Horas/día
              <input type="number" min={0} max={24} step={0.5} className="input input-sm" style={{ width: 70 }} value={d.assumedCapacity.hoursPerDay} onChange={(e) => upd({ assumedCapacity: { ...d.assumedCapacity, hoursPerDay: Number(e.target.value) || 0 } })} />
            </label>
            <label className="row small" style={{ gap: 6 }}>
              Unidades
              <input type="number" min={1} max={50} className="input input-sm" style={{ width: 70 }} value={d.assumedCapacity.units} onChange={(e) => upd({ assumedCapacity: { ...d.assumedCapacity, units: Math.max(1, Number(e.target.value) || 1) } })} />
            </label>
          </div>
        )}
        <div className="table-wrap" style={{ maxHeight: 560 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Puesto</th>
                <th>Configurada</th>
                {WD.map((w) => (
                  <th key={w} className="num">
                    {w} (h)
                  </th>
                ))}
                <th className="num">Unidades</th>
                <th className="num">Eficiencia %</th>
                <th>Paradas planificadas / horarios especiales</th>
              </tr>
            </thead>
            <tbody>
              {puestos.map((id) => {
                const c = d.capacities[id];
                const p = analysis?.model.puestos.get(id);
                return (
                  <tr key={id}>
                    <td>
                      <span className="id">{id}</span> <span className="small muted">{p?.desc ?? ''}</span>
                    </td>
                    <td>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={!!c}
                          disabled={!canCap}
                          onChange={(e) => {
                            const caps = { ...d.capacities };
                            if (e.target.checked) caps[id] = emptyCap(id);
                            else delete caps[id];
                            upd({ capacities: caps });
                          }}
                        />
                        {c ? 'Sí' : <span className="muted">Desconocida</span>}
                      </label>
                    </td>
                    {WD.map((_, i) => (
                      <td key={i} className="num">
                        {c ? (
                          <input
                            type="number"
                            min={0}
                            max={24}
                            step={0.5}
                            className="input input-sm"
                            style={{ width: 58 }}
                            value={c.hoursPerWeekday[i + 1] ?? 0}
                            disabled={!canCap}
                            aria-label={`Horas ${WD[i]} puesto ${id}`}
                            onChange={(e) => updCap(id, { hoursPerWeekday: { ...c.hoursPerWeekday, [i + 1]: Math.max(0, Math.min(24, Number(e.target.value) || 0)) } })}
                          />
                        ) : (
                          '—'
                        )}
                      </td>
                    ))}
                    <td className="num">
                      {c ? <input type="number" min={1} max={99} className="input input-sm" style={{ width: 58 }} value={c.units} disabled={!canCap} aria-label={`Unidades puesto ${id}`} onChange={(e) => updCap(id, { units: Math.max(1, Number(e.target.value) || 1) })} /> : '—'}
                    </td>
                    <td className="num">
                      {c ? <input type="number" min={10} max={150} className="input input-sm" style={{ width: 64 }} value={Math.round(c.efficiency * 100)} disabled={!canCap} aria-label={`Eficiencia puesto ${id}`} onChange={(e) => updCap(id, { efficiency: Math.max(0.1, (Number(e.target.value) || 100) / 100) })} /> : '—'}
                    </td>
                    <td>{c ? <StopsEditor cap={c} disabled={!canCap} onChange={(p2) => updCap(id, p2)} /> : <span className="small muted">Sin capacidad: se muestra la carga sin confirmar saturación.</span>}</td>
                  </tr>
                );
              })}
              {!puestos.length && (
                <tr>
                  <td colSpan={12} className="muted">
                    Importe datos para ver sus puestos de trabajo.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid grid-2">
        <Panel title="Correspondencia producción ↔ Ortems" sub="Reglas por orden de prioridad. Solo coincidencias exactas; si una regla da varias candidatas, el registro queda ambiguo.">
          <div className="stack">
            {d.matching.rules.map((r, i) => (
              <div key={r.id} className="row">
                <label className="check" style={{ flex: 1 }}>
                  <input type="checkbox" checked={r.enabled} disabled={!canAll} onChange={(e) => upd({ matching: { ...d.matching, rules: d.matching.rules.map((x) => (x.id === r.id ? { ...x, enabled: e.target.checked } : x)) } })} />
                  {i + 1}. {r.label} <span className="small muted">({r.fields.join(' + ')})</span>
                </label>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={!canAll || i === 0}
                  aria-label="Subir prioridad"
                  onClick={() => {
                    const rules = [...d.matching.rules];
                    [rules[i - 1], rules[i]] = [rules[i], rules[i - 1]];
                    upd({ matching: { ...d.matching, rules } });
                  }}
                >
                  ↑
                </button>
              </div>
            ))}
            <label className="check">
              <input type="checkbox" checked={d.matching.caseInsensitive} disabled={!canAll} onChange={(e) => upd({ matching: { ...d.matching, caseInsensitive: e.target.checked } })} />
              Ignorar mayúsculas/minúsculas y espacios en los extremos
            </label>
            <label className="check">
              <input type="checkbox" checked={d.matching.stripLeadingZeros} disabled={!canAll} onChange={(e) => upd({ matching: { ...d.matching, stripLeadingZeros: e.target.checked } })} />
              Ignorar ceros a la izquierda al emparejar (los identificadores originales no se modifican)
            </label>
          </div>
        </Panel>
        <Panel title="Tolerancia y criticidad">
          <div className="fgrid">
            <div className="field">
              <label htmlFor="c-tol">Tolerancia para considerar fechas coincidentes</label>
              <div className="row">
                <input id="c-tol" type="number" min={0} step={0.5} className="input" style={{ width: 90 }} value={d.tolerance.value} disabled={!canCap} onChange={(e) => upd({ tolerance: { ...d.tolerance, value: Math.max(0, Number(e.target.value) || 0) } })} />
                <select className="input" style={{ width: 'auto' }} value={d.tolerance.unit} disabled={!canCap} onChange={(e) => upd({ tolerance: { ...d.tolerance, unit: e.target.value as Settings['tolerance']['unit'] } })} aria-label="Unidad">
                  <option value="dias_laborables">días laborables</option>
                  <option value="horas">horas</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="c-high">Desfase de criticidad alta (días laborables)</label>
              <input id="c-high" type="number" min={1} className="input" value={d.highDeviationDays} disabled={!canCap} onChange={(e) => upd({ highDeviationDays: Math.max(1, Number(e.target.value) || 1) })} />
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid grid-2">
        <Panel title="Prioridades de Ortems">
          <div className="stack">
            <div className="fgrid">
              <div className="field">
                <label htmlFor="c-pdir">Interpretación del valor</label>
                <select id="c-pdir" className="input" value={d.priority.direction} disabled={!canAll} onChange={(e) => upd({ priority: { ...d.priority, direction: e.target.value as Settings['priority']['direction'] } })}>
                  <option value="menor_mas_prioritario">Menor valor = más prioritario (1 es lo más urgente)</option>
                  <option value="mayor_mas_prioritario">Mayor valor = más prioritario</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="c-phigh">Umbral de prioridad alta</label>
                <input id="c-phigh" type="number" className="input" value={d.priority.highThreshold} disabled={!canAll} onChange={(e) => upd({ priority: { ...d.priority, highThreshold: Number(e.target.value) || 0 } })} />
                <span className="small muted">{d.priority.direction === 'menor_mas_prioritario' ? `Valores ≤ ${d.priority.highThreshold} son prioridad alta.` : `Valores ≥ ${d.priority.highThreshold} son prioridad alta.`}</span>
              </div>
            </div>
            <span className="eyebrow">Prioridades en texto → valor</span>
            <div className="row" style={{ gap: 6 }}>
              {Object.entries(d.priority.textMap).map(([k, v]) => (
                <span key={k} className="chip">
                  {k} = {v}
                  <button disabled={!canAll} onClick={() => { const m = { ...d.priority.textMap }; delete m[k]; upd({ priority: { ...d.priority, textMap: m } }); }} aria-label={`Quitar ${k}`}>
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <div className="row">
              <input className="input input-sm" style={{ width: 160 }} placeholder="Texto (p. ej. Urgente)" value={newPrio.text} onChange={(e) => setNewPrio({ ...newPrio, text: e.target.value })} aria-label="Texto de prioridad" />
              <input type="number" className="input input-sm" style={{ width: 70 }} value={newPrio.value} onChange={(e) => setNewPrio({ ...newPrio, value: Number(e.target.value) })} aria-label="Valor" />
              <button className="btn btn-sm" disabled={!newPrio.text.trim() || !canAll} onClick={() => { upd({ priority: { ...d.priority, textMap: { ...d.priority.textMap, [normalizeHeader(newPrio.text)]: newPrio.value } } }); setNewPrio({ text: '', value: 1 }); }}>
                Añadir
              </button>
            </div>
          </div>
        </Panel>
        <Panel title="Dependencias y relaciones">
          <div className="stack">
            <label className="check">
              <input type="checkbox" checked={d.dependencies.sequenceByOperationNumber} disabled={!canAll} onChange={(e) => upd({ dependencies: { ...d.dependencies, sequenceByOperationNumber: e.target.checked } })} />
              Inferir la secuencia por el número de operación dentro de cada orden (dependencia INFERIDA)
            </label>
            <label className="check">
              <input type="checkbox" checked={d.dependencies.childBeforeParent} disabled={!canAll} onChange={(e) => upd({ dependencies: { ...d.dependencies, childBeforeParent: e.target.checked } })} />
              La orden hija debe terminar antes de empezar la orden padre (INFERIDA, solo con relación padre confirmada)
            </label>
            <label className="check">
              <input type="checkbox" checked={d.dependencies.inheritAparatoFromParent} disabled={!canAll} onChange={(e) => upd({ dependencies: { ...d.dependencies, inheritAparatoFromParent: e.target.checked } })} />
              Heredar el aparato a través de la estructura de órdenes (relación INFERIDA)
            </label>
            <label className="row small" style={{ gap: 6 }}>
              Señalar esperas a partir de
              <input type="number" min={1} className="input input-sm" style={{ width: 64 }} value={d.dependencies.waitThresholdDays} disabled={!canAll} onChange={(e) => upd({ dependencies: { ...d.dependencies, waitThresholdDays: Math.max(1, Number(e.target.value) || 1) } })} />
              días laborables entre operaciones dependientes
            </label>
            <span className="small muted">Las dependencias explícitas del Excel (columna «Operación precedente») siempre son CONFIRMADAS y prevalecen sobre la secuencia inferida de su orden.</span>
          </div>
        </Panel>
      </div>

      <div className="grid grid-2">
        <Panel title="Equivalencia de estados de fabricación" sub="Texto del Excel (normalizado) → estado interno. El texto original se conserva siempre.">
          <div className="stack">
            <div className="row" style={{ gap: 6 }}>
              {Object.entries(d.stateMap).map(([k, v]) => (
                <span key={k} className="chip">
                  {k} → {ESTADO_LABEL[v]}
                  <button disabled={!canAll} onClick={() => { const m = { ...d.stateMap }; delete m[k]; upd({ stateMap: m }); }} aria-label={`Quitar ${k}`}>
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <div className="row">
              <input className="input input-sm" style={{ width: 180 }} placeholder="Texto del Excel" value={newState.text} onChange={(e) => setNewState({ ...newState, text: e.target.value })} aria-label="Texto de estado" />
              <select className="input input-sm" style={{ width: 'auto' }} value={newState.canon} onChange={(e) => setNewState({ ...newState, canon: e.target.value as EstadoCanonico })} aria-label="Estado interno">
                {(Object.keys(ESTADO_LABEL) as EstadoCanonico[]).filter((x) => x !== 'desconocido').map((x) => (
                  <option key={x} value={x}>
                    {ESTADO_LABEL[x]}
                  </option>
                ))}
              </select>
              <button className="btn btn-sm" disabled={!newState.text.trim() || !canAll} onClick={() => { upd({ stateMap: { ...d.stateMap, [normalizeHeader(newState.text)]: newState.canon } }); setNewState({ text: '', canon: 'pendiente' }); }}>
                Añadir
              </button>
            </div>
          </div>
        </Panel>
        <Panel title="Perfiles de columnas guardados" sub="Se aplican automáticamente cuando un Excel tiene las mismas cabeceras">
          {profiles.length ? (
            <div className="stack">
              {profiles.map((p) => (
                <div key={p.id} className="row" style={{ justifyContent: 'space-between' }}>
                  <span>
                    <strong>{p.name}</strong> <span className="small muted">· {p.kind === 'produccion' ? 'Producción' : 'Ortems'} · {p.role} · {Object.keys(p.mapping).length} columnas</span>
                  </span>
                  <button className="btn btn-ghost btn-sm" disabled={!canAll && !canCap} onClick={() => void deleteProfile(p.id)} aria-label={`Eliminar perfil ${p.name}`}>
                    <Icon name="trash" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <span className="small muted">Aún no hay perfiles. Se crean al confirmar una importación.</span>
          )}
        </Panel>
      </div>

      {mode === 'servidor' && can(role, 'administrar_usuarios') && <UsuariosPanel />}
      <Panel
        title="Perfiles de usuario y permisos"
        sub={
          mode === 'servidor'
            ? 'Modo servidor: cada usuario inicia sesión y el servidor aplica estos permisos.'
            : 'Modo local (sin servidor): el perfil se elige en la barra superior solo para probar los permisos. Para trabajar varios usuarios con inicio de sesión, ejecute la aplicación con su servidor (ver README).'
        }
      >
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Permiso</th>
                {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                  <th key={r}>{ROLE_LABEL[r]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['importar', 'Importar Excel'],
                  ['configurar_capacidad', 'Capacidad, calendario y tolerancias'],
                  ['configurar', 'Reglas, prioridades y estados'],
                  ['revisar_alertas', 'Revisar alertas y discrepancias'],
                  ['validar_relaciones', 'Validar relaciones del árbol'],
                  ['exportar', 'Exportar a Excel'],
                  ['borrar_datos', 'Borrar datos importados'],
                  ['administrar_usuarios', 'Administrar usuarios y ver la actividad'],
                ] as [Permission, string][]
              ).map(([perm, label]) => (
                <tr key={perm}>
                  <td>{label}</td>
                  {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                    <td key={r}>{can(r, perm) ? '✓' : '—'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {saveBar}
      </div>
    </div>
  );
}

function StopsEditor({ cap, onChange, disabled }: { cap: ResourceCapacity; onChange: (p: Partial<ResourceCapacity>) => void; disabled: boolean }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sd, setSd] = useState('');
  const [sh, setSh] = useState(4);
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row" style={{ gap: 4 }}>
        {cap.stops.map((s, i) => (
          <span key={i} className="chip" title={s.note}>
            Parada {s.from}{s.to !== s.from ? ` → ${s.to}` : ''}
            <button disabled={disabled} onClick={() => onChange({ stops: cap.stops.filter((_, j) => j !== i) })} aria-label="Quitar parada">
              ✕
            </button>
          </span>
        ))}
        {cap.specialDays.map((s, i) => (
          <span key={`s${i}`} className="chip">
            {s.date}: {s.hours} h
            <button disabled={disabled} onClick={() => onChange({ specialDays: cap.specialDays.filter((_, j) => j !== i) })} aria-label="Quitar horario especial">
              ✕
            </button>
          </span>
        ))}
      </div>
      {!disabled && (
        <details>
          <summary className="small">Añadir parada u horario especial</summary>
          <div className="row" style={{ gap: 4, marginTop: 4 }}>
            <input type="date" className="input input-sm" style={{ width: 140 }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Parada desde" />
            <input type="date" className="input input-sm" style={{ width: 140 }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="Parada hasta" />
            <button className="btn btn-sm" disabled={!from} onClick={() => { onChange({ stops: [...cap.stops, { from, to: to || from }] }); setFrom(''); setTo(''); }}>
              Añadir parada
            </button>
          </div>
          <div className="row" style={{ gap: 4, marginTop: 4 }}>
            <input type="date" className="input input-sm" style={{ width: 140 }} value={sd} onChange={(e) => setSd(e.target.value)} aria-label="Día con horario especial" />
            <input type="number" min={0} max={24} className="input input-sm" style={{ width: 60 }} value={sh} onChange={(e) => setSh(Number(e.target.value))} aria-label="Horas ese día" />
            <button className="btn btn-sm" disabled={!sd} onClick={() => { onChange({ specialDays: [...cap.specialDays.filter((x) => x.date !== sd), { date: sd, hours: sh }] }); setSd(''); }}>
              Añadir horario especial
            </button>
          </div>
        </details>
      )}
    </div>
  );
}

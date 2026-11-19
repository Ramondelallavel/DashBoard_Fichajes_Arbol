import { useMemo, useRef, useState } from 'react';
import { can } from '../../auth/roles';
import { useApp } from '../../data/store';
import { fieldsFor, RECOMMENDED_FIELDS, ROLE_LABEL } from '../../domain/fields';
import type { ImportMode, MappingProfile, ParseOptions, ProdRecord, SheetImportConfig, SheetRole, SourceKind } from '../../domain/types';
import { sha256Hex } from '../../import/fileSecurity';
import { columnLetter } from '../../import/header';
import { allowedFields, validateMapping, type ColumnSuggestion } from '../../import/mapping';
import { analyzeSheet, buildProfile, DEFAULT_PARSE_OPTIONS, prepareImport, suggestionsToMapping, type PreparedImport, type SheetAnalysis } from '../../import/pipeline';
import { ImportFileError, readWorkbook, type WorkbookData } from '../../import/readers';
import { cellText, toRawCell } from '../../import/values';
import { incrementalAllowed, MODE_HELP, MODE_LABEL } from '../../import/versioning';
import { saveFile } from '../../export/download';
import { fmtNum } from '../../lib/format';
import { ConfirmDialog, Notice } from '../components/common';
import { Icon } from '../components/Icon';

interface SheetState {
  include: boolean;
  role: SheetRole;
  headerIndex: number;
  analysis: SheetAnalysis;
  mapping: Record<number, string>;
}

const STEPS = ['Archivo', 'Hojas', 'Cabecera', 'Columnas', 'Validación', 'Confirmar', 'Resumen'];

export function ImportWizard({ kind, onClose }: { kind: SourceKind; onClose: () => void }) {
  const profiles = useApp((s) => s.profiles);
  const settings = useApp((s) => s.settings);
  const previous = useApp((s) => s.active[kind]);
  const commitImport = useApp((s) => s.commitImport);
  const saveProfile = useApp((s) => s.saveProfile);
  const toast = useApp((s) => s.toast);
  const role = useApp((s) => s.role);
  const user = useApp((s) => s.user);
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<{ name: string; size: number; hash: string; wb: WorkbookData } | undefined>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [drag, setDrag] = useState(false);
  const [sheets, setSheets] = useState<SheetState[]>([]);
  const [current, setCurrent] = useState(0);
  const [opts, setOpts] = useState<ParseOptions>(DEFAULT_PARSE_OPTIONS);
  const [mode, setMode] = useState<ImportMode>(previous ? 'actualizacion' : 'inicial');
  const [saveProf, setSaveProf] = useState(true);
  const [profName, setProfName] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState<PreparedImport>();
  const inputRef = useRef<HTMLInputElement>(null);
  const profileInput = useRef<HTMLInputElement>(null);
  const label = kind === 'produccion' ? 'Excel de producción' : 'Excel de Ortems';

  async function onFile(f: File) {
    setError(undefined);
    setLoading(true);
    try {
      const buf = await f.arrayBuffer();
      const wb = await readWorkbook(f.name, buf);
      const hash = await sha256Hex(buf);
      setFile({ name: f.name, size: f.size, hash, wb });
      const st = wb.sheets.map((g, i) => {
        const roleGuess: SheetRole = kind === 'ortems' ? 'filas' : /puesto|recurso|maquina|máquina/i.test(g.name) ? 'puestos' : /aparato|equipo/i.test(g.name) && i > 0 ? 'aparatos' : /cabecera|ordenes|órdenes/i.test(g.name) && i > 0 ? 'ordenes' : 'filas';
        const an = analyzeSheet(g, kind, roleGuess, opts, profiles);
        return { include: g.rows.length > 1, role: roleGuess, headerIndex: an.headerIndex, analysis: an, mapping: suggestionsToMapping(an.suggestions) };
      });
      setSheets(st);
      const prof = st.find((s) => s.analysis.profile)?.analysis.profile;
      if (prof) {
        setOpts(prof.options);
        setProfName(prof.name);
      } else setProfName(`${kind === 'produccion' ? 'Producción' : 'Ortems'} · ${f.name.replace(/\.[^.]+$/, '')}`);
      setStep(1);
    } catch (e) {
      setError(e instanceof ImportFileError ? e.message : `No se pudo leer el archivo: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  const reanalyze = (i: number, patch: Partial<Pick<SheetState, 'role' | 'headerIndex'>>) => {
    setSheets((prev) =>
      prev.map((s, j) => {
        if (j !== i) return s;
        const roleN = patch.role ?? s.role;
        const hdr = patch.headerIndex ?? s.headerIndex;
        const an = analyzeSheet(s.analysis.grid, kind, roleN, opts, profiles, hdr);
        return { ...s, role: roleN, headerIndex: hdr, analysis: an, mapping: suggestionsToMapping(an.suggestions) };
      }),
    );
  };

  const included = sheets.filter((s) => s.include);
  const validations = included.map((s) => validateMapping(kind, s.role, s.analysis.headers, s.mapping));
  const mappingOk = included.length > 0 && validations.every((v) => v.ok) && (kind === 'ortems' || included.some((s) => s.role === 'filas'));

  const prepared = useMemo(() => {
    if (step < 4 || !file || !mappingOk) return undefined;
    const cfg = included.map((s) => ({ grid: s.analysis.grid, config: { sheet: s.analysis.grid.name, role: s.role, headerRow: s.headerIndex + 1, mapping: s.mapping } as SheetImportConfig }));
    return prepareImport({ kind, fileName: file.name, fileSize: file.size, fileHash: file.hash, sheets: cfg, options: opts, mode, previous, settings, user: `${user} (${role})` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, file, sheets, opts, mode, previous, settings]);

  const mappedFields = [...new Set(included.flatMap((s) => Object.values(s.mapping)))];
  const incr = prepared ? incrementalAllowed(kind, prepared.result.records, mappedFields) : { ok: false };
  const sameFile = previous && file && useApp.getState().batches.find((b) => b.id === previous.batchId)?.fileHash === file.hash;

  async function doCommit() {
    if (!prepared || !file) return;
    setConfirm(false);
    try {
      if (saveProf && profName.trim()) {
        for (const s of included) {
          const existing = profiles.find((p) => p.name === profName.trim() && p.role === s.role && p.kind === kind);
          await saveProfile(buildProfile(included.length > 1 ? `${profName.trim()}${s.role !== 'filas' ? ` (${s.role})` : ''}` : profName.trim(), kind, s.role, s.analysis.headers, s.mapping, opts, existing));
        }
      }
      await commitImport({ ...prepared, batch: { ...prepared.batch, profileId: undefined } });
      setDone(prepared);
      setStep(6);
      toast('ok', `${label} importado: versión ${prepared.dataset.version}.`);
    } catch (e) {
      toast('error', `No se pudo guardar la importación: ${(e as Error).message}`);
    }
  }

  async function exportProfile() {
    const s = included[current] ?? included[0];
    if (!s) return;
    const p = buildProfile(profName || 'perfil', kind, s.role, s.analysis.headers, s.mapping, opts);
    const res = await saveFile(`perfil_columnas_${kind}.json`, new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }), 'application/json');
    toast(res.outcome === 'guardado' ? 'ok' : 'info', res.message);
  }
  async function importProfile(f: File) {
    try {
      const p = JSON.parse(await f.text()) as MappingProfile;
      if (!p.mapping || typeof p.mapping !== 'object' || p.kind !== kind) throw new Error(`El perfil no es de ${label}.`);
      const clean: MappingProfile = { ...p, id: p.id ?? `perfil_${Date.now()}`, mapping: Object.fromEntries(Object.entries(p.mapping).filter(([, v]) => typeof v === 'string' && fieldsFor(kind).some((x) => x.key === v))) };
      await saveProfile(clean);
      setSheets((prev) => prev.map((s) => (s.role === clean.role ? (() => { const an = analyzeSheet(s.analysis.grid, kind, s.role, clean.options ?? opts, [clean], s.headerIndex); return { ...s, analysis: an, mapping: suggestionsToMapping(an.suggestions) }; })() : s)));
      toast('ok', `Perfil «${clean.name}» cargado y aplicado.`);
    } catch (e) {
      toast('error', `Perfil no válido: ${(e as Error).message}`);
    }
  }

  const s = included[current];
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>
          <Icon name="import" /> Importar {label}
        </h2>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          Cerrar asistente
        </button>
      </div>
      <div className="panel-body stack" style={{ gap: 16 }}>
        <ol className="steps" style={{ margin: 0, padding: 0 }}>
          {STEPS.map((t, i) => (
            <li key={t} className={i < step ? 'done' : i === step ? 'current' : ''}>
              {t}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <>
            <div
              className={`dropzone${drag ? ' drag' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                const f = e.dataTransfer.files[0];
                if (f) void onFile(f);
              }}
            >
              <Icon name="file" style={{ width: 28, height: 28 }} />
              <strong>Arrastre aquí el {label}</strong>
              <span className="small muted">Formatos: .xlsx, .xlsm (las macros se ignoran) y .csv. Máximo 60 MB. Las fórmulas no se evalúan: se usa su último resultado guardado.</span>
              <input ref={inputRef} type="file" accept=".xlsx,.xlsm,.csv,.txt" hidden onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
              <button className="btn btn-primary" onClick={() => inputRef.current?.click()} disabled={loading}>
                {loading ? 'Leyendo…' : 'Seleccionar archivo'}
              </button>
            </div>
            {error && <Notice kind="error">{error}</Notice>}
            {previous && <Notice kind="info">Ya existe una versión activa ({`v${previous.version}`}). La nueva importación no borrará nada sin que usted elija el modo y lo confirme.</Notice>}
          </>
        )}

        {step === 1 && file && (
          <>
            <div className="small">
              <strong>{file.name}</strong> · {fmtNum(file.size / 1024, 0)} KB · huella SHA-256 <span className="id">{file.hash.slice(0, 16)}…</span>
            </div>
            {file.wb.warnings.map((w, i) => (
              <Notice key={i} kind="warn">{w}</Notice>
            ))}
            {sameFile && <Notice kind="warn">Este archivo es idéntico (misma huella) al de la versión activa.</Notice>}
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Importar</th>
                    <th>Hoja</th>
                    <th className="num">Filas</th>
                    <th className="num">Columnas</th>
                    <th>Contenido</th>
                  </tr>
                </thead>
                <tbody>
                  {sheets.map((st, i) => (
                    <tr key={st.analysis.grid.name}>
                      <td>
                        <input type="checkbox" checked={st.include} onChange={(e) => setSheets(sheets.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)))} aria-label={`Importar hoja ${st.analysis.grid.name}`} />
                      </td>
                      <td>{st.analysis.grid.name}</td>
                      <td className="num">{fmtNum(st.analysis.grid.rows.length)}</td>
                      <td className="num">{st.analysis.headers.length}</td>
                      <td>
                        {kind === 'produccion' ? (
                          <select className="input input-sm" value={st.role} onChange={(e) => reanalyze(i, { role: e.target.value as SheetRole })} disabled={!st.include} aria-label="Contenido de la hoja">
                            {(Object.keys(ROLE_LABEL) as SheetRole[]).map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABEL[r]}
                              </option>
                            ))}
                          </select>
                        ) : (
                          'Filas de planificación de Ortems'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small muted">Varias hojas de filas se suman. Las hojas complementarias solo rellenan datos que falten en las filas (nunca sobrescriben) y avisan si hay valores discrepantes.</p>
          </>
        )}

        {(step === 2 || step === 3) && s && (
          <div className="row" role="tablist" aria-label="Hojas">
            {included.map((x, i) => (
              <button key={x.analysis.grid.name} className="btn btn-sm" aria-pressed={i === current} onClick={() => setCurrent(i)} role="tab" aria-selected={i === current}>
                {x.analysis.grid.name} · {x.role === 'filas' ? 'filas' : x.role}
              </button>
            ))}
          </div>
        )}

        {step === 2 && s && (
          <>
            <div className="row">
              <label className="row small" style={{ gap: 6 }}>
                Fila de cabecera
                <input type="number" min={1} max={Math.max(1, s.analysis.grid.rows.length)} className="input input-sm" style={{ width: 80 }} value={s.headerIndex + 1} onChange={(e) => reanalyze(sheets.indexOf(s), { headerIndex: Math.max(0, Number(e.target.value) - 1) })} />
              </label>
              <span className="small">
                Detección automática: fila {s.analysis.header.index + 1} (confianza {s.analysis.header.confidence}). {s.analysis.header.reason}
              </span>
              <span className="small muted">{fmtNum(s.analysis.dataRows)} filas de datos.</span>
            </div>
            <div className="table-wrap" style={{ maxHeight: 420 }}>
              <table className="preview">
                <tbody>
                  {s.analysis.grid.rows.slice(Math.max(0, s.headerIndex - 3), s.headerIndex + 13).map((r, k) => {
                    const idx = Math.max(0, s.headerIndex - 3) + k;
                    return (
                      <tr key={idx}>
                        <td className="rn">{idx + 1}</td>
                        {Array.from({ length: Math.max(s.analysis.headers.length, r.length) }, (_, c) => (
                          <td key={c} className={idx === s.headerIndex ? 'hdr' : ''} title={cellText(toRawCell(r[c]))}>
                            {cellText(toRawCell(r[c]))}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {step === 3 && s && (
          <>
            {s.analysis.profile && <Notice kind="ok">Se ha reconocido el formato y se ha aplicado el perfil guardado «{s.analysis.profile.name}». Revise la asignación igualmente.</Notice>}
            <div className="row">
              <label className="row small" style={{ gap: 6 }}>
                Formato de fecha en texto
                <select className="input input-sm" style={{ width: 'auto' }} value={opts.dateOrder} onChange={(e) => setOpts({ ...opts, dateOrder: e.target.value as ParseOptions['dateOrder'] })}>
                  <option value="DMY">día/mes/año</option>
                  <option value="MDY">mes/día/año</option>
                  <option value="YMD">año-mes-día</option>
                </select>
              </label>
              <label className="row small" style={{ gap: 6 }}>
                Unidad de duración
                <select className="input input-sm" style={{ width: 'auto' }} value={opts.durationUnit} onChange={(e) => setOpts({ ...opts, durationUnit: e.target.value as ParseOptions['durationUnit'] })}>
                  <option value="h">horas</option>
                  <option value="min">minutos</option>
                  <option value="s">segundos</option>
                </select>
              </label>
              <label className="row small" style={{ gap: 6 }}>
                Separador decimal
                <select className="input input-sm" style={{ width: 'auto' }} value={opts.decimalSeparator} onChange={(e) => setOpts({ ...opts, decimalSeparator: e.target.value as ParseOptions['decimalSeparator'] })}>
                  <option value="auto">automático</option>
                  <option value=",">coma (1.234,5)</option>
                  <option value=".">punto (1,234.5)</option>
                </select>
              </label>
              <span style={{ flex: 1 }} />
              <button className="btn btn-sm" onClick={() => void exportProfile()}>
                Exportar perfil (JSON)
              </button>
              <input ref={profileInput} type="file" accept=".json" hidden onChange={(e) => e.target.files?.[0] && void importProfile(e.target.files[0])} />
              <button className="btn btn-sm" onClick={() => profileInput.current?.click()}>
                Cargar perfil
              </button>
            </div>
            <MappingTable kind={kind} sheet={s} onChange={(mapping) => setSheets(sheets.map((x) => (x === s ? { ...x, mapping } : x)))} />
            {validations[current]?.errors.map((e, i) => (
              <Notice key={i} kind="error">{e}</Notice>
            ))}
            {validations[current]?.warnings.map((e, i) => (
              <Notice key={i} kind="warn">{e}</Notice>
            ))}
          </>
        )}

        {step === 4 && prepared && (
          <>
            <div className="grid grid-kpi">
              <div className="kpi"><span className="label">Filas leídas</span><span className="value">{fmtNum(prepared.result.counts.total)}</span><span className="sub">{fmtNum(prepared.result.counts.vacias)} vacías ignoradas</span></div>
              <div className="kpi"><span className="label">Correctas</span><span className="value">{fmtNum(prepared.result.counts.ok)}</span></div>
              <div className="kpi state-med"><span className="label">Pendientes de revisión</span><span className="value">{fmtNum(prepared.result.counts.revision)}</span><span className="sub">se importan con aviso</span></div>
              <div className="kpi state-crit"><span className="label">Rechazadas</span><span className="value">{fmtNum(prepared.result.counts.rechazado)}</span><span className="sub">no se usan en el análisis</span></div>
            </div>
            {prepared.result.issueStats.length ? (
              <div className="table-wrap" style={{ maxHeight: 380 }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Gravedad</th>
                      <th>Incidencia</th>
                      <th className="num">Filas</th>
                      <th>Ejemplos (hoja · fila)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prepared.result.issueStats.map((st) => (
                      <tr key={st.code}>
                        <td>
                          <span className={`pill ${st.severity === 'error' ? 'pill-crit' : st.severity === 'aviso' ? 'pill-med' : 'pill-info'}`}>{st.severity === 'error' ? 'Error' : st.severity === 'aviso' ? 'Aviso' : 'Info'}</span>
                        </td>
                        <td className="id">{st.code}</td>
                        <td className="num">{fmtNum(st.count)}</td>
                        <td className="small">
                          {st.examples.slice(0, 4).map((x, i) => (
                            <div key={i}>
                              {x.sheet} · fila {x.row}: {x.message}
                            </div>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Notice kind="ok">No se han detectado incidencias en los registros.</Notice>
            )}
            {prepared.result.columnNotes.map((n, i) => (
              <Notice key={i} kind="info">
                <strong>{n.sheet} › {n.header}:</strong> {n.message}
              </Notice>
            ))}
            {prepared.result.unknownColumns.length > 0 && (
              <Notice kind="info">
                Columnas sin asignar (se conservan en los datos originales, pero no se usan en el análisis): {prepared.result.unknownColumns.join(', ')}.
              </Notice>
            )}
          </>
        )}

        {step === 5 && prepared && (
          <>
            <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="eyebrow" style={{ marginBottom: 6 }}>Modo de importación</legend>
              {(['inicial', 'actualizacion', 'sustitucion', 'incremental'] as ImportMode[]).map((m) => {
                const disabled = m === 'inicial' ? !!previous : !previous || (m === 'incremental' && !incr.ok);
                return (
                  <label key={m} className="check" style={{ alignItems: 'flex-start', opacity: disabled ? 0.55 : 1 }}>
                    <input type="radio" name="mode" checked={mode === m} disabled={disabled} onChange={() => setMode(m)} />
                    <span>
                      <strong>{MODE_LABEL[m]}</strong>
                      <br />
                      <span className="small muted">{MODE_HELP[m]}{m === 'incremental' && !incr.ok && previous ? ` No disponible: ${incr.reason}` : ''}{m === 'inicial' && previous ? ' No disponible: ya hay datos de esta fuente.' : ''}</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
            {prepared.diff && (
              <Notice kind={prepared.diff.summary.removed ? 'warn' : 'info'}>
                Cambios frente a la versión activa v{previous?.version}: <strong>{fmtNum(prepared.diff.summary.added)}</strong> nuevos · <strong>{fmtNum(prepared.diff.summary.modified)}</strong> modificados · <strong>{fmtNum(prepared.diff.summary.removed)}</strong> {mode === 'incremental' ? 'no incluidos (se mantienen)' : 'desaparecen de la versión activa'} · {fmtNum(prepared.diff.summary.unchanged)} sin cambios.
                {mode === 'actualizacion' && prepared.diff.summary.removed > 0 && ' Los registros que desaparecen seguirán disponibles en el historial de versiones.'}
              </Notice>
            )}
            {mode === 'sustitucion' && <Notice kind="warn">La sustitución descarta la versión activa y empieza de cero con este archivo. La versión anterior queda en el historial como «sustituida».</Notice>}
            <label className="check">
              <input type="checkbox" checked={saveProf} onChange={(e) => setSaveProf(e.target.checked)} />
              Recordar esta configuración de columnas como perfil
            </label>
            {saveProf && <input className="input" style={{ maxWidth: 420 }} value={profName} onChange={(e) => setProfName(e.target.value)} aria-label="Nombre del perfil" />}
            {!can(role, 'importar') && <Notice kind="error">Su perfil ({role}) no permite importar datos.</Notice>}
          </>
        )}

        {step === 6 && done && (
          <>
            <Notice kind="ok">
              Importación completada: <strong>{file?.name}</strong> → versión {done.dataset.version} de {label} ({MODE_LABEL[done.batch.mode].toLowerCase()}).
            </Notice>
            <div className="grid grid-kpi">
              <div className="kpi"><span className="label">Importados</span><span className="value">{fmtNum(done.result.counts.ok + done.result.counts.revision)}</span></div>
              <div className="kpi state-med"><span className="label">Pendientes de revisión</span><span className="value">{fmtNum(done.result.counts.revision)}</span></div>
              <div className="kpi state-crit"><span className="label">Rechazados</span><span className="value">{fmtNum(done.result.counts.rechazado)}</span></div>
              <div className="kpi"><span className="label">Registros en la versión activa</span><span className="value">{fmtNum(done.dataset.records.filter((r) => r.status !== 'rechazado').length)}</span></div>
            </div>
            {done.result.counts.revision > 0 && (
              <details>
                <summary>Ver registros pendientes de revisión</summary>
                <div className="table-wrap" style={{ maxHeight: 300, marginTop: 8 }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Hoja · fila</th>
                        <th>Orden</th>
                        <th>Incidencias</th>
                      </tr>
                    </thead>
                    <tbody>
                      {done.result.records
                        .filter((r) => r.status === 'revision')
                        .slice(0, 200)
                        .map((r) => (
                          <tr key={r.rid}>
                            <td className="nowrap">{r.src.sheet} · {r.src.row}</td>
                            <td className="id">{r.ordenId ?? (r as ProdRecord).aparatoId ?? '—'}</td>
                            <td className="small">{r.issues.map((x) => x.message).join(' ')}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
            <div className="row">
              <a className="btn btn-primary" href="#dashboard" onClick={onClose}>
                Ir al dashboard
              </a>
              <a className="btn" href="#gantt" onClick={onClose}>
                Ver en el Gantt
              </a>
              {kind === 'ortems' && (
                <a className="btn" href="#ortems" onClick={onClose}>
                  Abrir el comparador
                </a>
              )}
            </div>
          </>
        )}

        {step > 0 && step < 6 && (
          <div className="row" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <button className="btn" onClick={() => setStep(step - 1)}>
              Atrás
            </button>
            {step < 5 ? (
              <button className="btn btn-primary" disabled={(step === 1 && !included.length) || (step === 3 && !mappingOk) || (step === 4 && !prepared)} onClick={() => { setCurrent(0); setStep(step + 1); }}>
                {step === 3 ? 'Validar datos' : 'Siguiente'}
              </button>
            ) : (
              <button className="btn btn-primary" disabled={!prepared || !can(role, 'importar')} onClick={() => setConfirm(true)}>
                Confirmar importación
              </button>
            )}
          </div>
        )}
      </div>
      {confirm && prepared && (
        <ConfirmDialog
          title="Confirmar importación"
          danger={mode === 'sustitucion'}
          confirmLabel={mode === 'sustitucion' ? 'Sustituir datos' : 'Importar'}
          requireCheck={mode === 'sustitucion' ? 'Entiendo que la versión activa se sustituye por este archivo' : mode === 'actualizacion' && prepared.diff?.summary.removed ? `Entiendo que ${prepared.diff.summary.removed} registros desaparecen de la versión activa` : undefined}
          message={
            <>
              Se creará la versión <strong>{prepared.dataset.version}</strong> de {label} a partir de <strong>{file?.name}</strong> en modo «{MODE_LABEL[mode]}»: {fmtNum(prepared.result.counts.ok + prepared.result.counts.revision)} registros importados y {fmtNum(prepared.result.counts.rechazado)} rechazados.
            </>
          }
          onCancel={() => setConfirm(false)}
          onConfirm={() => void doCommit()}
        />
      )}
    </div>
  );
}

function MappingTable({ kind, sheet, onChange }: { kind: SourceKind; sheet: SheetState; onChange: (m: Record<number, string>) => void }) {
  const fields = allowedFields(kind, sheet.role);
  const used = new Map<string, number>();
  for (const [c, f] of Object.entries(sheet.mapping)) if (f) used.set(f, Number(c));
  const samples = sheet.analysis.grid.rows.slice(sheet.headerIndex + 1, sheet.headerIndex + 6);
  const sugg = new Map<number, ColumnSuggestion>(sheet.analysis.suggestions.map((x) => [x.col, x]));
  const recommended = sheet.role === 'filas' ? RECOMMENDED_FIELDS[kind] : [];
  return (
    <div className="table-wrap" style={{ maxHeight: 520 }}>
      <table className="tbl">
        <thead>
          <tr>
            <th>Col.</th>
            <th>Cabecera en el Excel</th>
            <th>Valores de ejemplo</th>
            <th>Campo interno</th>
            <th>Propuesta</th>
          </tr>
        </thead>
        <tbody>
          {sheet.analysis.headers.map((h, col) => {
            const s = sugg.get(col);
            const field = sheet.mapping[col] ?? '';
            return (
              <tr key={col}>
                <td className="id muted">{columnLetter(col)}</td>
                <td>
                  <strong>{h}</strong>
                </td>
                <td className="small muted" style={{ maxWidth: 260 }}>
                  {samples
                    .map((r) => cellText(toRawCell(r[col])))
                    .filter(Boolean)
                    .slice(0, 3)
                    .join(' · ') || '—'}
                </td>
                <td>
                  <select
                    className="input input-sm"
                    value={field}
                    onChange={(e) => {
                      const m = { ...sheet.mapping };
                      if (e.target.value) {
                        const prevCol = used.get(e.target.value);
                        if (prevCol !== undefined) delete m[prevCol];
                        m[col] = e.target.value;
                      } else delete m[col];
                      onChange(m);
                    }}
                    aria-label={`Campo para la columna ${h}`}
                  >
                    <option value="">— No importar (columna desconocida) —</option>
                    {fields.map((f) => (
                      <option key={f.key} value={f.key} title={f.description}>
                        {f.label}
                        {used.has(f.key) && used.get(f.key) !== col ? ` (ahora en ${columnLetter(used.get(f.key)!)})` : ''}
                        {recommended.includes(f.key) ? ' ★' : ''}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="small">
                  {s?.field ? (
                    <span className={`conf-${s.confidence}`} title={s.reason}>
                      {s.field === field ? '✓ ' : ''}Confianza {s.confidence}
                    </span>
                  ) : (
                    <span className="muted">Sin propuesta</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="small muted" style={{ padding: '8px 10px' }}>
        ★ campo recomendado. Si mueve un campo a otra columna, se quita de la anterior: cada campo procede de una sola columna. Los identificadores (orden, aparato, operación, puesto) se tratan siempre como texto.
      </p>
    </div>
  );
}

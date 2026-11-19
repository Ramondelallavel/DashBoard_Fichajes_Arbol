import { useState } from 'react';
import { can } from '../../auth/roles';
import { useApp } from '../../data/store';
import type { BatchStatus, DatasetVersion, FieldChange, RawSheet, RecordDiff, SourceKind } from '../../domain/types';
import { generateDemo } from '../../demo/demoData';
import { buildWorkbook, gridsToXlsx } from '../../export/excel';
import { saveFile, timestampForFile } from '../../export/download';
import { cellText } from '../../import/values';
import { diffRecords, MODE_LABEL } from '../../import/versioning';
import { fmtDateTime } from '../../lib/dates';
import { fmtNum } from '../../lib/format';
import { ConfirmDialog, Modal, Notice, Panel } from '../components/common';
import { Icon } from '../components/Icon';
import { ImportWizard } from '../import/ImportWizard';
import { PageHead } from './shared';

const STATUS_LABEL: Record<BatchStatus, string> = { activa: 'Activa', historica: 'Histórica', sustituida: 'Sustituida', fusionada: 'Fusionada (incremental)' };

export function ImportacionPage() {
  const active = useApp((s) => s.active);
  const batches = useApp((s) => s.batches);
  const versions = useApp((s) => s.versions);
  const role = useApp((s) => s.role);
  const loadDemo = useApp((s) => s.loadDemo);
  const resetData = useApp((s) => s.resetData);
  const toast = useApp((s) => s.toast);
  const repo = useApp((s) => s.repo);
  const [wizard, setWizard] = useState<SourceKind>();
  const [confirmDemo, setConfirmDemo] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [raw, setRaw] = useState<{ name: string; sheets: RawSheet[] }>();
  const [cmpKind, setCmpKind] = useState<SourceKind>('ortems');
  const [vA, setVA] = useState('');
  const [vB, setVB] = useState('');
  const [diff, setDiff] = useState<{ a: DatasetVersion; b: DatasetVersion; diffs: RecordDiff[] }>();
  const allowed = can(role, 'importar');
  const hasData = !!(active.produccion || active.ortems);

  async function downloadSample(kind: SourceKind) {
    const demo = generateDemo();
    const buf = await gridsToXlsx(kind === 'produccion' ? demo.produccion : [demo.ortems]);
    const res = await saveFile(kind === 'produccion' ? 'ejemplo_produccion_ficticio.xlsx' : 'ejemplo_ortems_ficticio.xlsx', buf);
    toast(res.outcome === 'guardado' ? 'ok' : 'info', res.message);
  }

  async function showRaw(batchId: string, name: string) {
    const sheets = await repo?.getRaw(batchId);
    if (sheets) setRaw({ name, sheets });
    else toast('info', 'Los datos originales de esta importación ya no están disponibles.');
  }

  async function compare() {
    if (!repo || !vA || !vB) return;
    const [a, b] = await Promise.all([repo.getDataset(vA), repo.getDataset(vB)]);
    if (!a || !b) {
      toast('error', 'Una de las versiones ya no está disponible (se conservan las últimas versiones completas).');
      return;
    }
    const [older, newer] = a.version < b.version ? [a, b] : [b, a];
    setDiff({ a: older, b: newer, diffs: diffRecords(cmpKind, older.records, newer.records).diffs });
  }

  async function exportDiff() {
    if (!diff) return;
    type DRow = { d: RecordDiff; c?: FieldChange };
    const rows: DRow[] = diff.diffs.flatMap((d): DRow[] => (d.changes.length ? d.changes.map((c) => ({ d, c })) : [{ d }]));
    const buf = await buildWorkbook(
      [
        {
          name: 'Cambios',
          rows,
          columns: [
            { header: 'Clave (orden | operación)', value: (r: DRow) => r.d.key, width: 26 },
            { header: 'Tipo de cambio', value: (r: DRow) => r.d.type },
            { header: 'Campo', value: (r: DRow) => r.c?.field },
            { header: 'Antes', value: (r: DRow) => r.c?.before, width: 22 },
            { header: 'Después', value: (r: DRow) => r.c?.after, width: 22 },
          ],
        },
      ],
      { title: `Comparación de versiones ${cmpKind} v${diff.a.version} → v${diff.b.version}`, generatedAt: new Date(), user: role, versions: [`v${diff.a.version} (${fmtDateTime(new Date(diff.a.createdAt).getTime())})`, `v${diff.b.version} (${fmtDateTime(new Date(diff.b.createdAt).getTime())})`], filters: [] },
    );
    const res = await saveFile(`comparacion_versiones_${cmpKind}_${timestampForFile()}.xlsx`, buf);
    toast(res.outcome === 'guardado' ? 'ok' : 'info', res.message);
  }

  const modCard = (kind: SourceKind) => {
    const ds = active[kind];
    const b = ds ? batches.find((x) => x.id === ds.batchId) : undefined;
    return (
      <Panel
        title={
          <>
            <span className={`sw ${kind === 'produccion' ? 'sw-prod' : 'sw-ortems'}`} style={{ width: 12, height: 12, borderRadius: 2, display: 'inline-block' }} />
            {kind === 'produccion' ? 'Excel de producción' : 'Excel de Ortems'}
          </>
        }
        actions={
          <>
            <button className="btn btn-primary" disabled={!allowed} onClick={() => setWizard(kind)}>
              <Icon name="import" /> {ds ? 'Importar nueva versión' : 'Importar'}
            </button>
            <button className="btn btn-sm" onClick={() => void downloadSample(kind)} title="Excel con datos ficticios para probar el asistente">
              Ejemplo ficticio
            </button>
          </>
        }
      >
        {ds && b ? (
          <dl className="kv">
            <dt>Versión activa</dt>
            <dd>
              <strong>v{ds.version}</strong> · {MODE_LABEL[ds.mode]}
            </dd>
            <dt>Archivo</dt>
            <dd>{b.fileName}</dd>
            <dt>Importado</dt>
            <dd>
              {fmtDateTime(new Date(b.importedAt).getTime())} por {b.user}
            </dd>
            <dt>Registros</dt>
            <dd>
              {fmtNum(ds.records.filter((r) => r.status !== 'rechazado').length)} válidos · {fmtNum(b.counts.revision)} pendientes de revisión · {fmtNum(b.counts.rechazado)} rechazados
            </dd>
            <dt>Hojas</dt>
            <dd>{b.sheets.map((s) => `${s.sheet} (${s.role}, cabecera fila ${s.headerRow})`).join('; ')}</dd>
          </dl>
        ) : (
          <p className="muted">
            {kind === 'produccion'
              ? 'Órdenes de fabricación, operaciones, artículos, aparatos, puestos y secciones. Las columnas se asignan en el asistente: no se presupone ningún nombre.'
              : 'Prioridades, órdenes, preórdenes y fechas planificadas por Ortems. Se guarda separado de producción: nunca la sobrescribe.'}
          </p>
        )}
      </Panel>
    );
  };

  const vOpts = versions.filter((v) => v.kind === cmpKind && !v.purged).sort((x, y) => y.version - x.version);
  return (
    <div className="page">
      <PageHead
        eyebrow="Datos"
        title="Importación de Excel"
        lead="Dos módulos independientes. Cada importación queda registrada con su archivo, fecha, usuario, recuentos y versión de los datos; las versiones anteriores se conservan para compararlas."
        actions={
          <>
            <button className="btn" disabled={!can(role, 'importar')} onClick={() => (hasData ? setConfirmDemo(true) : void loadDemo())}>
              Cargar datos de demostración
            </button>
            <button className="btn btn-danger" disabled={!can(role, 'borrar_datos') || !hasData} onClick={() => setConfirmReset(true)}>
              <Icon name="trash" /> Borrar datos importados
            </button>
          </>
        }
      />
      {!allowed && <Notice kind="warn">Su perfil ({role}) no permite importar. Cambie al perfil Planificador o Administrador.</Notice>}
      {wizard ? (
        <ImportWizard key={wizard} kind={wizard} onClose={() => setWizard(undefined)} />
      ) : (
        <div className="grid grid-2">
          {modCard('produccion')}
          {modCard('ortems')}
        </div>
      )}

      <Panel title="Historial de importaciones" flush>
        {batches.length ? (
          <div className="table-wrap" style={{ maxHeight: 420 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Fuente</th>
                  <th>Archivo</th>
                  <th>Modo</th>
                  <th>Usuario</th>
                  <th className="num">Filas</th>
                  <th className="num">Correctas</th>
                  <th className="num">Revisión</th>
                  <th className="num">Rechazadas</th>
                  <th>Versión</th>
                  <th>Estado</th>
                  <th>Cambios</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td className="nowrap">{fmtDateTime(new Date(b.importedAt).getTime())}</td>
                    <td>{b.kind === 'produccion' ? 'Producción' : 'Ortems'}</td>
                    <td title={`SHA-256 ${b.fileHash}`}>{b.fileName}</td>
                    <td>{MODE_LABEL[b.mode]}</td>
                    <td>{b.user}</td>
                    <td className="num">{fmtNum(b.counts.total)}</td>
                    <td className="num">{fmtNum(b.counts.ok)}</td>
                    <td className="num">{fmtNum(b.counts.revision)}</td>
                    <td className="num">{fmtNum(b.counts.rechazado)}</td>
                    <td className="id">v{b.datasetVersion}</td>
                    <td>
                      <span className={`pill ${b.status === 'activa' ? 'pill-good' : 'pill-neutral'}`}>{STATUS_LABEL[b.status]}</span>
                    </td>
                    <td className="small nowrap">{b.diffSummary ? `+${b.diffSummary.added} · ~${b.diffSummary.modified} · −${b.diffSummary.removed}` : '—'}</td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => void showRaw(b.id, b.fileName)}>
                        Datos originales
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">Todavía no se ha importado ningún archivo.</div>
        )}
      </Panel>

      <Panel title="Comparar versiones" sub="Detecta cambios en fechas, prioridades, cantidades, recursos y órdenes entre dos importaciones de la misma fuente">
        <div className="row">
          <select className="input input-sm" style={{ width: 'auto' }} value={cmpKind} onChange={(e) => { setCmpKind(e.target.value as SourceKind); setVA(''); setVB(''); setDiff(undefined); }} aria-label="Fuente">
            <option value="produccion">Producción</option>
            <option value="ortems">Ortems</option>
          </select>
          <select className="input input-sm" style={{ width: 'auto' }} value={vA} onChange={(e) => setVA(e.target.value)} aria-label="Versión anterior">
            <option value="">Versión A…</option>
            {vOpts.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version} · {fmtDateTime(new Date(v.createdAt).getTime())}
              </option>
            ))}
          </select>
          <select className="input input-sm" style={{ width: 'auto' }} value={vB} onChange={(e) => setVB(e.target.value)} aria-label="Versión posterior">
            <option value="">Versión B…</option>
            {vOpts.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version} · {fmtDateTime(new Date(v.createdAt).getTime())}
              </option>
            ))}
          </select>
          <button className="btn btn-sm" disabled={!vA || !vB || vA === vB} onClick={() => void compare()}>
            Comparar
          </button>
          {vOpts.length < 2 && <span className="small muted">Se necesitan al menos dos versiones de la fuente.</span>}
        </div>
        {diff && (
          <div className="stack" style={{ marginTop: 12 }}>
            <div className="row">
              <strong>
                v{diff.a.version} → v{diff.b.version}:
              </strong>
              <span>{fmtNum(diff.diffs.filter((d) => d.type === 'nuevo').length)} nuevos</span>
              <span>{fmtNum(diff.diffs.filter((d) => d.type === 'modificado').length)} modificados</span>
              <span>{fmtNum(diff.diffs.filter((d) => d.type === 'eliminado').length)} eliminados</span>
              <button className="btn btn-sm" onClick={() => void exportDiff()}>
                <Icon name="download" /> Exportar cambios
              </button>
            </div>
            <div className="table-wrap" style={{ maxHeight: 360 }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Clave</th>
                    <th>Cambio</th>
                    <th>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.diffs.slice(0, 500).map((d) => (
                    <tr key={`${d.type}${d.key}`}>
                      <td className="id">{d.key.split('|').filter(Boolean).join(' / ')}</td>
                      <td>
                        <span className={`pill ${d.type === 'nuevo' ? 'pill-good' : d.type === 'eliminado' ? 'pill-crit' : 'pill-med'}`}>{d.type}</span>
                      </td>
                      <td className="small">{d.changes.map((c) => `${c.field}: ${c.before ?? '∅'} → ${c.after ?? '∅'}`).join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {diff.diffs.length > 500 && <span className="small muted">Se muestran 500 de {fmtNum(diff.diffs.length)} cambios; la exportación los incluye todos.</span>}
          </div>
        )}
      </Panel>

      {raw && (
        <Modal title={`Datos originales · ${raw.name}`} onClose={() => setRaw(undefined)} wide>
          <p className="small muted">Valores tal como se leyeron del archivo (sin normalizar). Se muestran las primeras 40 filas de cada hoja.</p>
          {raw.sheets.map((sh) => (
            <div key={sh.name} className="stack">
              <strong>
                {sh.name} · cabecera en la fila {sh.headerRow} · {fmtNum(sh.rows.length)} filas
              </strong>
              <div className="table-wrap" style={{ maxHeight: 320 }}>
                <table className="preview">
                  <tbody>
                    <tr>
                      <td className="rn">{sh.headerRow}</td>
                      {sh.headers.map((h, i) => (
                        <td key={i} className="hdr">
                          {h}
                        </td>
                      ))}
                    </tr>
                    {sh.rows.slice(0, 40).map((r) => (
                      <tr key={r.row}>
                        <td className="rn">{r.row}</td>
                        {sh.headers.map((_, i) => (
                          <td key={i}>{cellText(r.cells[i] ?? null)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </Modal>
      )}
      {confirmDemo && (
        <ConfirmDialog
          title="Cargar datos de demostración"
          message="Los datos de demostración son ficticios y sustituyen a los datos importados actualmente (el historial también se reinicia). La configuración de capacidad se ajusta a los puestos ficticios."
          confirmLabel="Cargar demostración"
          danger
          requireCheck="Entiendo que se borran los datos importados actuales"
          onCancel={() => setConfirmDemo(false)}
          onConfirm={() => {
            setConfirmDemo(false);
            void loadDemo();
          }}
        />
      )}
      {confirmReset && (
        <ConfirmDialog
          title="Borrar datos importados"
          message="Se eliminarán todas las importaciones, versiones, revisiones de alertas y validaciones manuales guardadas en este navegador. La configuración y los perfiles de columnas se conservan."
          confirmLabel="Borrar"
          danger
          requireCheck="Entiendo que esta acción no se puede deshacer"
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            setConfirmReset(false);
            void resetData().then(() => toast('ok', 'Datos importados eliminados.'));
          }}
        />
      )}
    </div>
  );
}

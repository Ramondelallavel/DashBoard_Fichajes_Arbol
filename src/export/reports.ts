import type { AlertReview, DatasetVersion, ImportBatch } from '../domain/types';
import { CONFIANZA_LABEL } from '../engine/bottlenecks';
import { isAdelantada, isRetrasada, type Analysis } from '../engine/analysis';
import type { Alert } from '../engine/alerts';
import { ALERT_TYPE_LABEL } from '../engine/alerts';
import { CRIT_LABEL, DISCREPANCY_LABEL, type ComparisonRow } from '../engine/comparison';
import { ESTADO_LABEL, filterChips, type FilterResult, type FilterState } from '../engine/filters';
import type { Granularity } from '../engine/load';
import { OVERLAP_LABEL } from '../engine/overlaps';
import { fmtDateTime } from '../lib/dates';
import { naturalCompare } from '../lib/text';
import { buildWorkbook, type ExportColumn, type ExportMeta, type ExportSheet } from './excel';
import { saveFile, timestampForFile } from './download';

export function versionLines(active: { produccion?: DatasetVersion; ortems?: DatasetVersion }, batches: ImportBatch[]): string[] {
  const out: string[] = [];
  for (const ds of [active.produccion, active.ortems]) {
    if (!ds) continue;
    const b = batches.find((x) => x.id === ds.batchId);
    out.push(`${ds.kind === 'produccion' ? 'Producción' : 'Ortems'} v${ds.version} · ${b?.fileName ?? '—'} · importado ${b ? fmtDateTime(new Date(b.importedAt).getTime()) : '—'} · ${ds.records.length} registros`);
  }
  return out;
}

export interface ReportContext {
  analysis: Analysis;
  filtered?: FilterResult;
  filters: FilterState;
  active: { produccion?: DatasetVersion; ortems?: DatasetVersion };
  batches: ImportBatch[];
  user: string;
}

export function metaFor(ctx: ReportContext, title: string, notes: string[] = []): ExportMeta {
  return {
    title,
    generatedAt: new Date(),
    user: ctx.user,
    versions: versionLines(ctx.active, ctx.batches),
    filters: filterChips(ctx.filters).map((c) => c.label),
    notes: [
      `Fecha de referencia del análisis: ${fmtDateTime(ctx.analysis.refMs)}`,
      'Semanas según ISO 8601 (lunes a domingo; la semana 1 contiene el primer jueves del año).',
      ...notes,
    ],
  };
}

export async function deliver(fileBase: string, sheets: ExportSheet[], meta: ExportMeta) {
  const buf = await buildWorkbook(sheets, meta);
  return saveFile(`${fileBase}_${timestampForFile()}.xlsx`, buf);
}

const col = <T,>(header: string, value: (r: T) => unknown, type?: ExportColumn<T>['type'], width?: number): ExportColumn<T> => ({ header, value, type, width });

function filteredOps(ctx: ReportContext) {
  const a = ctx.analysis;
  const keys = ctx.filtered ? [...ctx.filtered.ops] : [...a.model.ops.keys()];
  return keys.map((k) => a.model.ops.get(k)!).sort((x, y) => (x.start ?? Infinity) - (y.start ?? Infinity));
}

function cmpOf(a: Analysis, opKey: string, ordenId: string): ComparisonRow | undefined {
  return a.comparison.byOp.get(opKey) ?? a.comparison.byOrden.get(ordenId)?.find((r) => r.level === 'orden');
}

function flagText(a: Analysis, key: string): string {
  const f = a.opFlags.get(key);
  if (!f) return '';
  const out: string[] = [];
  if (f.vencida) out.push(f.vencida === 'confirmada' ? 'Retrasada (vencida)' : 'Posible retraso (sin estado)');
  if (f.retrasoReal) out.push('Terminada con retraso');
  if (f.fueraObjetivo) out.push('Fuera de fecha objetivo');
  if (f.retrasoOrtems) out.push('Más tarde que Ortems');
  if (f.adelantoOrtems) out.push('Antes que Ortems');
  if (f.solape) out.push(OVERLAP_LABEL[f.solape.clase]);
  if (f.saturado) out.push(`Puesto saturado (${f.saturado})`);
  if (f.precedencia) out.push(`Precedencia incumplida (${f.precedencia.tipo})`);
  if (f.pendienteValidacion) out.push(`Pendiente: ${f.pendienteValidacion}`);
  if (f.sinInfo.length) out.push(f.sinInfo.join(', '));
  return out.join('; ');
}

export function planningSheet(ctx: ReportContext): ExportSheet {
  const a = ctx.analysis;
  type R = { kind: 'op'; key: string } | { kind: 'ort'; rid: string };
  const rows: R[] = [...filteredOps(ctx).map((o) => ({ kind: 'op' as const, key: o.key })), ...[...(ctx.filtered?.ortemsOnly ?? a.match.ortemsOnly)].map((rid) => ({ kind: 'ort' as const, rid }))];
  const op = (r: R) => (r.kind === 'op' ? a.model.ops.get(r.key) : undefined);
  const ort = (r: R) => (r.kind === 'ort' ? a.ortems.get(r.rid) : undefined);
  const cmp = (r: R) => (r.kind === 'op' ? cmpOf(a, r.key, op(r)!.ordenId) : a.comparison.byOrtemsRid.get(r.rid));
  return {
    name: 'Planificación',
    rows,
    columns: [
      col<R>('Fuente', (r) => (r.kind === 'op' ? (cmp(r)?.ortemsRids.length ? 'Producción + Ortems' : 'Solo producción') : 'Solo Ortems'), 'text', 18),
      col<R>('Aparato', (r) => op(r)?.aparatoId ?? (r.kind === 'ort' ? a.ortemsAparato.get(r.rid) ?? ort(r)?.aparatoId : undefined)),
      col<R>('Aparato (texto Ortems)', (r) => ort(r)?.aparatoId),
      col<R>('Artículo', (r) => op(r)?.articuloRef ?? ort(r)?.articuloRef),
      col<R>('Descripción artículo', (r) => op(r)?.articuloDesc ?? ort(r)?.articuloDesc, 'text', 28),
      col<R>('Familia', (r) => (op(r) ? op(r)!.familia ?? a.model.aparatos.get(op(r)!.aparatoId ?? '')?.familia : ort(r)?.familia)),
      col<R>('Orden', (r) => (op(r) ? a.model.ordenes.get(op(r)!.ordenId)?.ordenId ?? (a.model.ordenes.get(op(r)!.ordenId)?.tipo === 'orden' ? op(r)!.ordenId : undefined) : ort(r)?.ordenId)),
      col<R>('Preorden', (r) => op(r)?.preordenId ?? a.model.ordenes.get(op(r)?.ordenId ?? '')?.preordenId ?? ort(r)?.preordenId),
      col<R>('Operación', (r) => (op(r)?.operacionId !== undefined ? op(r)!.label : ort(r)?.operacionId)),
      col<R>('Descripción operación', (r) => op(r)?.desc, 'text', 28),
      col<R>('Puesto', (r) => op(r)?.puestoId ?? ort(r)?.puestoId),
      col<R>('Sección', (r) => op(r)?.seccion ?? ort(r)?.seccion ?? (ort(r)?.puestoId ? a.model.puestos.get(ort(r)!.puestoId!)?.seccion : undefined)),
      col<R>('Inicio producción (previsto)', (r) => op(r)?.start, 'datetime', 17),
      col<R>('Fin producción (previsto)', (r) => op(r)?.end, 'datetime', 17),
      col<R>('Inicio real', (r) => op(r)?.realStart, 'datetime', 17),
      col<R>('Fin real', (r) => op(r)?.realEnd, 'datetime', 17),
      col<R>('Avance (%)', (r) => op(r)?.avance, 'number'),
      col<R>('Duración prevista (h)', (r) => op(r)?.durationH, 'number'),
      col<R>('Horas usadas en carga', (r) => (r.kind === 'op' ? a.opFlags.get(r.key)?.hours : undefined), 'number'),
      col<R>('Estado', (r) => (op(r) ? ESTADO_LABEL[op(r)!.estado] : ort(r)?.estadoPlanificacion)),
      col<R>('Estado (texto original)', (r) => op(r)?.estadoRaw),
      col<R>('Inicio Ortems', (r) => cmp(r)?.ortStart ?? ort(r)?.inicio, 'datetime', 17),
      col<R>('Fin Ortems', (r) => cmp(r)?.ortEnd ?? ort(r)?.fin, 'datetime', 17),
      col<R>('Carga Ortems (h)', (r) => (r.kind === 'ort' ? ort(r)?.duracionH : (cmp(r)?.ortemsRids ?? []).reduce<number | undefined>((acc, id) => { const h = a.ortems.get(id)?.duracionH; return h === undefined ? acc : (acc ?? 0) + h; }, undefined)), 'number'),
      col<R>('Prioridad Ortems', (r) => cmp(r)?.prioridadRaw ?? ort(r)?.prioridadRaw),
      col<R>('Indicadores', (r) => (r.kind === 'op' ? flagText(a, r.key) : 'Sin correspondencia en producción'), 'text', 50),
      col<R>('Origen (archivo · hoja · fila)', (r) => {
        const src = op(r)?.src ?? ort(r)?.src;
        return src ? `${src.batchId} · ${src.sheet} · ${src.row}` : '';
      }, 'text', 32),
    ],
  };
}

export function ordersSheet(ctx: ReportContext): ExportSheet {
  const a = ctx.analysis;
  const ids = ctx.filtered ? [...ctx.filtered.ordenes] : [...a.model.ordenes.keys()];
  const rows = ids.map((id) => a.model.ordenes.get(id)!).filter(Boolean).sort((x, y) => naturalCompare(x.id, y.id));
  type O = (typeof rows)[number];
  const cmp = (o: O) => a.comparison.byOrden.get(o.id) ?? [];
  return {
    name: 'Órdenes',
    rows,
    columns: [
      col<O>('Orden', (o) => o.id),
      col<O>('Aparato', (o) => o.aparatoId),
      col<O>('Relación orden-aparato', (o) => o.aparatoLink, 'text', 16),
      col<O>('Regla / origen', (o) => o.aparatoRule, 'text', 36),
      col<O>('Orden padre', (o) => o.parentId),
      col<O>('Relación con padre', (o) => o.parentLink ?? (o.childIds.length ? '(raíz)' : '')),
      col<O>('Preorden', (o) => o.preordenId),
      col<O>('Artículo', (o) => o.articuloRef),
      col<O>('Descripción', (o) => o.articuloDesc, 'text', 30),
      col<O>('Familia', (o) => o.familia),
      col<O>('Nº operaciones', (o) => o.opKeys.length, 'number'),
      col<O>('Inicio producción', (o) => o.start, 'datetime', 17),
      col<O>('Fin producción', (o) => o.end, 'datetime', 17),
      col<O>('Fecha objetivo', (o) => o.target, 'datetime', 17),
      col<O>('Estado', (o) => ESTADO_LABEL[o.estado]),
      col<O>('Prioridad Ortems', (o) => cmp(o).find((r) => r.prioridadRaw)?.prioridadRaw),
      col<O>('Criticidad comparación', (o) => {
        const crits = cmp(o).map((r) => r.criticidad).filter(Boolean);
        return crits.length ? CRIT_LABEL[crits.sort((x, y) => ['informativa', 'media', 'alta', 'critica'].indexOf(y!) - ['informativa', 'media', 'alta', 'critica'].indexOf(x!))[0]!] : cmp(o).length ? 'Coincide' : '';
      }),
      col<O>('Operaciones retrasadas', (o) => o.opKeys.filter((k) => isRetrasada(a.opFlags.get(k))).length, 'number'),
      col<O>('Operaciones adelantadas', (o) => o.opKeys.filter((k) => isAdelantada(a.opFlags.get(k))).length, 'number'),
    ],
  };
}

export function comparisonSheet(a: Analysis, rows: ComparisonRow[], reviews: Record<string, AlertReview>, reviewId: (r: ComparisonRow) => string): ExportSheet {
  type C = ComparisonRow;
  const levelTxt: Record<C['level'], string> = { operacion: 'Operación', orden: 'Orden', solo_produccion: 'Solo producción', solo_ortems: 'Solo Ortems', ambigua: 'Ambigua', recurso: 'Recurso' };
  return {
    name: 'Comparación',
    rows,
    columns: [
      col<C>('Aparato', (r) => r.aparatoId),
      col<C>('Orden', (r) => r.ordenId),
      col<C>('Preorden', (r) => r.preordenId),
      col<C>('Operación', (r) => r.operacionLabel),
      col<C>('Nivel', (r) => levelTxt[r.level]),
      col<C>('Puesto (producción)', (r) => r.puestoProd),
      col<C>('Puesto (Ortems)', (r) => r.puestoOrtems),
      col<C>('Sección', (r) => r.seccion ?? (r.puestoProd ? a.model.puestos.get(r.puestoProd)?.seccion : undefined)),
      col<C>('Prioridad Ortems', (r) => r.prioridadRaw),
      col<C>('Prioridad anterior', (r) => r.prioridadAnteriorRaw),
      col<C>('Inicio producción', (r) => r.prodStart, 'datetime', 17),
      col<C>('Fin producción', (r) => r.prodEnd, 'datetime', 17),
      col<C>('Inicio Ortems', (r) => r.ortStart, 'datetime', 17),
      col<C>('Fin Ortems', (r) => r.ortEnd, 'datetime', 17),
      col<C>('Desfase inicio (días lab.)', (r) => r.dStartWD, 'number'),
      col<C>('Desfase fin (días lab.)', (r) => r.dEndWD, 'number'),
      col<C>('Desfase fin (h)', (r) => (r.dEndH !== undefined ? Math.round(r.dEndH * 10) / 10 : undefined), 'number'),
      col<C>('Tipo de discrepancia', (r) => (r.discrepancies.length ? r.discrepancies.map((d) => DISCREPANCY_LABEL[d.type]).join('; ') : 'Coincide'), 'text', 34),
      col<C>('Detalle', (r) => r.discrepancies.map((d) => d.message).join(' '), 'text', 70),
      col<C>('Criticidad', (r) => (r.criticidad ? CRIT_LABEL[r.criticidad] : 'Coincide')),
      col<C>('Regla de correspondencia', (r) => r.regla),
      col<C>('Estado de revisión', (r) => reviews[reviewId(r)]?.state ?? 'pendiente'),
      col<C>('Nota de revisión', (r) => reviews[reviewId(r)]?.note),
    ],
  };
}

export function discrepancySheet(rows: ComparisonRow[]): ExportSheet {
  const flat = rows.flatMap((r) => r.discrepancies.map((d) => ({ r, d })));
  type F = (typeof flat)[number];
  return {
    name: 'Discrepancias',
    rows: flat,
    columns: [
      col<F>('Criticidad', (x) => CRIT_LABEL[x.d.criticidad]),
      col<F>('Tipo', (x) => DISCREPANCY_LABEL[x.d.type], 'text', 28),
      col<F>('Aparato', (x) => x.r.aparatoId),
      col<F>('Orden', (x) => x.r.ordenId ?? x.r.preordenId),
      col<F>('Operación', (x) => x.r.operacionLabel),
      col<F>('Puesto', (x) => x.r.puestoProd ?? x.r.puestoOrtems),
      col<F>('Descripción', (x) => x.d.message, 'text', 90),
    ],
  };
}

export function alertsSheet(alerts: Alert[], reviews: Record<string, AlertReview>): ExportSheet {
  return {
    name: 'Incidencias',
    rows: alerts,
    columns: [
      col<Alert>('Criticidad', (x) => CRIT_LABEL[x.criticidad]),
      col<Alert>('Tipo', (x) => ALERT_TYPE_LABEL[x.type], 'text', 30),
      col<Alert>('Descripción', (x) => `${x.title}. ${x.description}`, 'text', 80),
      col<Alert>('Motivo', (x) => x.motivo, 'text', 50),
      col<Alert>('Aparato', (x) => x.aparatoId),
      col<Alert>('Orden', (x) => x.ordenId),
      col<Alert>('Operación', (x) => x.operacionLabel),
      col<Alert>('Puesto', (x) => x.puestoId),
      col<Alert>('Sección', (x) => x.seccion),
      col<Alert>('Fuente', (x) => x.fuente),
      col<Alert>('Fecha relevante', (x) => x.date, 'datetime', 17),
      col<Alert>('Fecha de detección', (x) => (reviews[x.id]?.firstSeen ? new Date(reviews[x.id].firstSeen).getTime() : undefined), 'datetime', 17),
      col<Alert>('Estado de revisión', (x) => reviews[x.id]?.state ?? 'pendiente'),
      col<Alert>('Revisado por', (x) => reviews[x.id]?.user),
      col<Alert>('Nota', (x) => reviews[x.id]?.note, 'text', 40),
      col<Alert>('Registros de origen', (x) => x.rids.slice(0, 20).join(', '), 'text', 40),
    ],
  };
}

export function loadSheet(a: Analysis, scope: 'puesto' | 'seccion', g: Granularity, source: keyof Analysis['load']): ExportSheet {
  const load = a.load[source];
  const map = scope === 'puesto' ? load.puestos : load.secciones;
  const rows = [...map.values()].flatMap((rl) => [...rl.buckets[g].values()].map((c) => ({ rl, c }))).sort((x, y) => naturalCompare(x.rl.id, y.rl.id) || x.c.start - y.c.start);
  type L = (typeof rows)[number];
  const capTxt = { conocida: 'Conocida', supuesta: 'Supuesta (estimada)', desconocida: 'Desconocida', parcial: 'Parcial (estimada)' };
  return {
    name: scope === 'puesto' ? 'Carga por puesto' : 'Carga por sección',
    rows,
    columns: [
      col<L>(scope === 'puesto' ? 'Puesto' : 'Sección', (x) => x.rl.id),
      ...(scope === 'puesto' ? [col<L>('Sección', (x) => x.rl.seccion)] : []),
      col<L>(g === 'dia' ? 'Día' : g === 'semana' ? 'Semana ISO' : 'Mes', (x) => x.c.key),
      col<L>('Inicio del periodo', (x) => x.c.start, 'date'),
      col<L>('Carga (h)', (x) => Math.round(x.c.loadH * 100) / 100, 'number'),
      col<L>('De ella estimada (h)', (x) => Math.round(x.c.estimatedH * 100) / 100, 'number'),
      col<L>('Capacidad (h)', (x) => x.c.capacityH, 'number'),
      col<L>('Ocupación', (x) => (x.c.occupancy !== undefined && Number.isFinite(x.c.occupancy) ? x.c.occupancy : undefined), 'pct'),
      col<L>('Exceso (h)', (x) => (x.c.capacityH !== undefined ? Math.max(0, (scope === 'seccion' ? x.c.loadWithCapH ?? 0 : x.c.loadH) - x.c.capacityH) : undefined), 'number'),
      col<L>('Capacidad', (x) => capTxt[x.c.capSource]),
      col<L>('Nº operaciones', (x) => x.c.ids.length, 'number'),
    ],
  };
}

export function bottleneckSheets(a: Analysis): ExportSheet[] {
  const r = a.bottlenecks.ranking;
  type R = (typeof r)[number];
  const f = a.bottlenecks.forecasts;
  type F = (typeof f)[number];
  return [
    {
      name: 'Ranking de puestos',
      rows: [...r, ...a.bottlenecks.seccionRanking],
      columns: [
        col<R>('Ámbito', (x) => (x.scope === 'puesto' ? 'Puesto' : 'Sección')),
        col<R>('Recurso', (x) => x.id),
        col<R>('Diagnóstico', (x) => x.label, 'text', 44),
        col<R>('Certeza', (x) => CONFIANZA_LABEL[x.confianza]),
        col<R>('Ocupación pico (horizonte)', (x) => (x.peakOccupancy !== undefined && Number.isFinite(x.peakOccupancy) ? x.peakOccupancy : undefined), 'pct'),
        col<R>('Semana pico', (x) => x.peakPeriod),
        col<R>('Semanas sobrecargadas', (x) => x.overloadedWeeks, 'number'),
        col<R>('Semanas en riesgo', (x) => x.riskWeeks, 'number'),
        col<R>('Solapes conflictivos', (x) => x.overlapConflicts, 'number'),
        col<R>('Carga futura (h)', (x) => Math.round(x.futureH * 10) / 10, 'number'),
        col<R>('Capacidad libre (h)', (x) => (x.freeCapacityH !== undefined ? Math.round(x.freeCapacityH * 10) / 10 : undefined), 'number'),
        col<R>('Aparatos que pasan', (x) => x.aparatos, 'number'),
      ],
    },
    {
      name: 'Previsiones',
      rows: f,
      columns: [
        col<F>('Severidad', (x) => x.severity),
        col<F>('Certeza', (x) => CONFIANZA_LABEL[x.confianza]),
        col<F>('Ámbito', (x) => x.scope),
        col<F>('Recurso', (x) => x.entityId),
        col<F>('Mensaje', (x) => x.message, 'text', 100),
        col<F>('Periodos', (x) => x.periods.join(', ')),
        col<F>('Operaciones implicadas', (x) => x.ids.length, 'number'),
      ],
    },
  ];
}

export function treeSheet(a: Analysis, aparatoId: string): ExportSheet {
  const ap = a.model.aparatos.get(aparatoId);
  type T = { nivel: number; tipo: string; id: string; desc?: string; puesto?: string; seccion?: string; inicio?: number; fin?: number; estado?: string; relacion?: string; regla?: string; deps?: string };
  const rows: T[] = [];
  if (ap) {
    rows.push({ nivel: 0, tipo: 'Aparato', id: ap.id, desc: ap.desc, inicio: ap.start, fin: ap.end, estado: ESTADO_LABEL[ap.estado] });
    const visit = (ordenId: string, lvl: number, seen: Set<string>) => {
      if (seen.has(ordenId)) return;
      seen.add(ordenId);
      const o = a.model.ordenes.get(ordenId);
      if (!o) return;
      rows.push({ nivel: lvl, tipo: 'Orden', id: o.id, desc: o.articuloDesc, inicio: o.start, fin: o.end, estado: ESTADO_LABEL[o.estado], relacion: o.parentId ? `padre ${o.parentId} (${o.parentLink})` : `aparato (${o.aparatoLink})`, regla: o.parentRule ?? o.aparatoRule });
      for (const k of o.opKeys) {
        const op = a.model.ops.get(k)!;
        rows.push({ nivel: lvl + 1, tipo: 'Operación', id: op.label, desc: op.desc, puesto: op.puestoId, seccion: op.seccion, inicio: op.start, fin: op.end, estado: ESTADO_LABEL[op.estado], deps: op.preds.map((p) => `${p.from ?? '¿?'} (${p.tipo}: ${p.regla})`).join('; ') });
      }
      for (const c of o.childIds) visit(c, lvl + 1, seen);
    };
    const seen = new Set<string>();
    for (const r of ap.rootOrdenIds) visit(r, 1, seen);
  }
  return {
    name: `Árbol ${aparatoId}`,
    rows,
    columns: [
      col<T>('Nivel', (x) => x.nivel, 'number'),
      col<T>('Tipo', (x) => x.tipo),
      col<T>('Identificador', (x) => `${'  '.repeat(x.nivel)}${x.id}`, 'text', 22),
      col<T>('Descripción', (x) => x.desc, 'text', 30),
      col<T>('Puesto', (x) => x.puesto),
      col<T>('Sección', (x) => x.seccion),
      col<T>('Inicio', (x) => x.inicio, 'datetime', 17),
      col<T>('Fin', (x) => x.fin, 'datetime', 17),
      col<T>('Estado', (x) => x.estado),
      col<T>('Relación', (x) => x.relacion, 'text', 28),
      col<T>('Regla / origen', (x) => x.regla, 'text', 36),
      col<T>('Dependencias', (x) => x.deps, 'text', 60),
    ],
  };
}

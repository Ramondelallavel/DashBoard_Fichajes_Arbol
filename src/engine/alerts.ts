import { isHighPriority } from '../domain/settings';
import { fmtDate, weekLabel } from '../lib/dates';
import { stableHash } from '../lib/text';
import type { Analysis } from './analysis';
import { CRIT_RANK, DISCREPANCY_LABEL, type Criticidad } from './comparison';
import { OVERLAP_LABEL } from './overlaps';

export type AlertType =
  | 'OPERACION_RETRASADA'
  | 'ORDEN_PRIORITARIA_SIN_PROGRAMAR'
  | 'PUESTO_SATURADO'
  | 'SECCION_SATURADA'
  | 'ORDEN_SIN_ORTEMS'
  | 'ORTEMS_SIN_PRODUCCION'
  | 'ARBOL_INCOMPLETO'
  | 'OPERACION_SIN_PUESTO'
  | 'DEPENDENCIA_NO_RESUELTA'
  | 'PRECEDENCIA_INCUMPLIDA'
  | 'SOLAPAMIENTO'
  | 'DISCREPANCIA_ORTEMS'
  | 'RELACION_AMBIGUA'
  | 'ORDEN_SIN_APARATO'
  | 'DATOS_INCOMPLETOS';

export const ALERT_TYPE_LABEL: Record<AlertType, string> = {
  OPERACION_RETRASADA: 'Operación retrasada',
  ORDEN_PRIORITARIA_SIN_PROGRAMAR: 'Orden prioritaria pendiente de programación',
  PUESTO_SATURADO: 'Puesto de trabajo saturado',
  SECCION_SATURADA: 'Sección saturada',
  ORDEN_SIN_ORTEMS: 'Orden sin correspondencia en Ortems',
  ORTEMS_SIN_PRODUCCION: 'Registro de Ortems sin producción',
  ARBOL_INCOMPLETO: 'Árbol de procesos incompleto',
  OPERACION_SIN_PUESTO: 'Operación sin puesto de trabajo',
  DEPENDENCIA_NO_RESUELTA: 'Dependencia no resuelta',
  PRECEDENCIA_INCUMPLIDA: 'Precedencia incumplida',
  SOLAPAMIENTO: 'Solapamiento de operaciones',
  DISCREPANCIA_ORTEMS: 'Discrepancia con Ortems',
  RELACION_AMBIGUA: 'Relación ambigua',
  ORDEN_SIN_APARATO: 'Orden sin aparato',
  DATOS_INCOMPLETOS: 'Información incompleta',
};

export type AlertSource = 'produccion' | 'ortems' | 'ambas' | 'calculo';

export interface Alert {
  id: string;
  type: AlertType;
  criticidad: Criticidad;
  title: string;
  description: string;
  motivo: string;
  aparatoId?: string;
  ordenId?: string;
  opKey?: string;
  operacionLabel?: string;
  puestoId?: string;
  seccion?: string;
  fuente: AlertSource;
  /** Fecha relevante (fin previsto, semana, etc.). */
  date?: number;
  /** Registros de origen (trazabilidad). */
  rids: string[];
}

type Partial = Omit<Analysis, 'alerts' | 'timings'>;

export function buildAlerts(a: Partial): Alert[] {
  const out: Alert[] = [];
  const add = (x: Omit<Alert, 'id'> & { key: string }) => {
    const { key, ...rest } = x;
    out.push({ id: `al_${stableHash(`${x.type}|${key}`)}`, ...rest });
  };
  const { model } = a;

  // Operaciones retrasadas / precedencias
  for (const op of model.ops.values()) {
    const f = a.opFlags.get(op.key);
    if (!f) continue;
    const order = model.ordenes.get(op.ordenId);
    const ortRow = a.comparison.byOp.get(op.key) ?? a.comparison.byOrden.get(op.ordenId)?.find((r) => r.level === 'orden');
    const high = ortRow?.highPriority ?? isHighPriority(order?.prioridad, a.settings);
    const base = { aparatoId: op.aparatoId, ordenId: op.ordenId, opKey: op.key, operacionLabel: op.label, puestoId: op.puestoId, seccion: op.seccion, rids: op.rids };
    if (f.vencida) {
      add({
        ...base,
        key: op.key,
        type: 'OPERACION_RETRASADA',
        criticidad: high ? 'critica' : f.vencida === 'confirmada' ? 'alta' : 'media',
        title: `Operación ${op.label} de la orden ${op.ordenId} retrasada`,
        description: `Fin previsto el ${fmtDate(op.end)} y ${op.estadoRaw ? `estado «${op.estadoRaw}»` : 'sin estado de fabricación'}.`,
        motivo:
          f.vencida === 'confirmada'
            ? 'La fecha prevista de fin es anterior a la fecha de referencia y el estado indica que no está terminada.'
            : 'La fecha prevista de fin es anterior a la fecha de referencia; no hay estado ni fecha real para confirmar si está terminada (posible retraso).',
        fuente: 'produccion',
        date: op.end,
      });
    } else if (f.retrasoReal) {
      add({ ...base, key: `${op.key}|real`, type: 'OPERACION_RETRASADA', criticidad: 'media', title: `Operación ${op.label} (orden ${op.ordenId}) terminada con retraso`, description: `Fin real ${fmtDate(op.realEnd)} frente a fin previsto ${fmtDate(op.end)}.`, motivo: 'La fecha real de fin supera la prevista más la tolerancia.', fuente: 'produccion', date: op.realEnd });
    }
    if (f.precedencia) {
      const pred = model.ops.get(f.precedencia.predKey);
      add({
        ...base,
        key: `${op.key}|${f.precedencia.predKey}`,
        type: 'PRECEDENCIA_INCUMPLIDA',
        criticidad: f.precedencia.tipo === 'confirmada' ? 'alta' : 'media',
        title: `La operación ${op.label} empieza antes de que termine ${pred?.label ?? ''}`,
        description: `Inicio previsto ${fmtDate(op.start)}; la precedente (orden ${pred?.ordenId}, op. ${pred?.label}) termina el ${fmtDate(pred?.end)}.`,
        motivo: f.precedencia.tipo === 'confirmada' ? 'Dependencia confirmada por el campo «Operación precedente».' : 'Dependencia INFERIDA por regla (no confirmada en los datos): revise si realmente es secuencial.',
        fuente: 'produccion',
        date: op.start,
      });
    }
  }

  // Calidad de datos y relaciones
  for (const q of model.quality) {
    const type =
      q.code === 'OPERACION_SIN_PUESTO'
        ? 'OPERACION_SIN_PUESTO'
        : q.code === 'ORDENES_SIN_RELACION' || q.code === 'PADRE_NO_ENCONTRADO' || q.code === 'CICLO_ORDENES'
          ? 'ARBOL_INCOMPLETO'
          : q.code === 'PRECEDENTE_NO_ENCONTRADO'
            ? 'DEPENDENCIA_NO_RESUELTA'
            : q.code === 'RELACION_AMBIGUA' || q.code === 'ID_DUPLICADO'
              ? 'RELACION_AMBIGUA'
              : q.code === 'ORDEN_SIN_APARATO'
                ? 'ORDEN_SIN_APARATO'
                : 'DATOS_INCOMPLETOS';
    if (q.code === 'OPERACION_SIN_DURACION' || q.code === 'APARATO_SIN_ORDENES') {
      // informativas: solo se agrupan para no saturar el listado
      continue;
    }
    const op = q.opKey ? model.ops.get(q.opKey) : undefined;
    add({
      key: q.id,
      type,
      criticidad: q.severity === 'alta' ? 'alta' : q.severity === 'media' ? 'media' : 'informativa',
      title: ALERT_TYPE_LABEL[type],
      description: q.message,
      motivo: 'Calidad de datos / relaciones del Excel de producción.',
      aparatoId: q.aparatoId ?? op?.aparatoId,
      ordenId: q.ordenId,
      opKey: q.opKey,
      operacionLabel: op?.label,
      puestoId: q.puestoId ?? op?.puestoId,
      seccion: op?.seccion,
      fuente: 'produccion',
      rids: q.rids,
    });
  }
  const noDur = model.quality.filter((q) => q.code === 'OPERACION_SIN_DURACION');
  if (noDur.length) {
    add({
      key: 'sin-duracion',
      type: 'DATOS_INCOMPLETOS',
      criticidad: 'informativa',
      title: `${noDur.length} operaciones sin duración prevista`,
      description: a.settings.load.estimateDurationFromDates ? 'Su carga se ha estimado a partir de las fechas: los resultados de ocupación correspondientes son estimados.' : 'No computan en la carga de trabajo.',
      motivo: 'El Excel de producción no proporciona la duración de estas operaciones.',
      fuente: 'produccion',
      rids: noDur.flatMap((q) => q.rids).slice(0, 500),
    });
  }

  // Solapamientos
  for (const g of a.overlaps.produccion) {
    if (g.clase === 'solape_dentro_capacidad') continue;
    const ops = g.ids.map((k) => model.ops.get(k)!).filter(Boolean);
    add({
      key: g.id,
      type: 'SOLAPAMIENTO',
      criticidad: g.clase === 'sobrecarga_confirmada' ? 'alta' : 'media',
      title: `${OVERLAP_LABEL[g.clase]} en ${g.puestoId}`,
      description: `${g.ids.length} operaciones coinciden en el tiempo (hasta ${g.maxConcurrency} a la vez) entre ${fmtDate(g.start)} y ${fmtDate(g.end)}: ${ops.slice(0, 6).map((o) => `${o.ordenId}/${o.label}`).join(', ')}${ops.length > 6 ? '…' : ''}.`,
      motivo:
        g.clase === 'solape_potencial'
          ? 'La capacidad paralela del puesto no está configurada: puede no ser un problema si existen varias máquinas u operarios.'
          : `Simultaneidad ${g.maxConcurrency} frente a ${g.units} unidad(es) ${g.unitsSource === 'supuesta' ? 'supuesta(s)' : 'configurada(s)'}.`,
      puestoId: g.puestoId,
      seccion: model.puestos.get(g.puestoId)?.seccion,
      fuente: 'calculo',
      date: g.peakStart,
      rids: ops.flatMap((o) => o.rids),
    });
  }

  // Saturación (solo semanas futuras o actuales; las pasadas se consultan en el análisis)
  for (const f of a.bottlenecks.findings) {
    if (f.granularity !== 'semana' || f.estado !== 'saturado' || !f.future) continue;
    const isP = f.scope === 'puesto';
    add({
      key: f.id,
      type: isP ? 'PUESTO_SATURADO' : 'SECCION_SATURADA',
      criticidad: f.confianza === 'confirmado' ? 'alta' : 'media',
      title: `${isP ? 'Puesto' : 'Sección'} ${f.entityId} saturado en ${weekLabel(f.periodKey)}`,
      description: f.message,
      motivo: f.confianza === 'confirmado' ? 'Carga prevista superior a la capacidad configurada.' : 'Resultado ESTIMADO: capacidad supuesta o parcial, o duraciones estimadas.',
      puestoId: isP ? f.entityId : undefined,
      seccion: isP ? model.puestos.get(f.entityId)?.seccion : f.entityId,
      fuente: 'calculo',
      date: f.periodStart,
      rids: f.ids.flatMap((k) => model.ops.get(k)?.rids ?? []).slice(0, 500),
    });
  }

  // Comparación con Ortems: una alerta por fila comparada (agrupa sus discrepancias)
  for (const row of a.comparison.rows) {
    if (!row.discrepancies.length) continue;
    const worst = [...row.discrepancies].sort((x, y) => CRIT_RANK[y.criticidad] - CRIT_RANK[x.criticidad])[0];
    const types = new Set(row.discrepancies.map((d) => d.type));
    let type: AlertType = 'DISCREPANCIA_ORTEMS';
    if (types.has('solo_produccion')) type = 'ORDEN_SIN_ORTEMS';
    else if ((types.has('solo_ortems') || types.has('preorden_no_lanzada')) && row.highPriority) type = 'ORDEN_PRIORITARIA_SIN_PROGRAMAR';
    else if (types.has('solo_ortems') || types.has('preorden_no_lanzada')) type = 'ORTEMS_SIN_PRODUCCION';
    else if (types.has('saturacion_combinada')) type = 'PUESTO_SATURADO';
    const op = row.opKey ? model.ops.get(row.opKey) : undefined;
    const subject = row.ordenId ? ` · orden ${row.ordenId}` : row.preordenId ? ` · preorden ${row.preordenId}` : row.puestoProd ? ` · ${row.puestoProd}` : '';
    add({
      key: row.id,
      type,
      criticidad: worst.criticidad,
      title: `${row.discrepancies.map((d) => DISCREPANCY_LABEL[d.type]).filter((v, i, arr) => arr.indexOf(v) === i).join(' · ')}${subject}${row.operacionLabel ? ` / op. ${row.operacionLabel}` : ''}`,
      description: row.discrepancies.map((d) => d.message).join(' '),
      motivo: 'Comparación entre la planificación de producción y la de Ortems.',
      aparatoId: row.aparatoId,
      ordenId: row.ordenId,
      opKey: row.opKey,
      operacionLabel: row.operacionLabel,
      puestoId: row.puestoProd ?? row.puestoOrtems,
      seccion: row.seccion ?? op?.seccion,
      fuente: row.level === 'solo_ortems' ? 'ortems' : row.level === 'solo_produccion' ? 'produccion' : row.level === 'recurso' ? 'calculo' : 'ambas',
      date: row.prodEnd ?? row.ortEnd,
      rids: [...row.prodRids, ...row.ortemsRids],
    });
  }

  out.sort((x, y) => CRIT_RANK[y.criticidad] - CRIT_RANK[x.criticidad] || (x.date ?? Infinity) - (y.date ?? Infinity));
  return out;
}

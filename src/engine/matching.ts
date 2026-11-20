import type { MatchRule, Settings } from '../domain/settings';
import type { OrtemsRecord } from '../domain/types';
import { idKey, type IdNormalization } from '../lib/text';
import type { ProductionModel } from './model';

export type MatchLevel = 'operacion' | 'orden';

export interface OrtemsMatch {
  rid: string;
  level: MatchLevel;
  /** clave de operación o id de orden de producción */
  target: string;
  rule: MatchRule;
  /** Ortems indica una operación que no existe en producción (emparejado a nivel de orden). */
  opNotFound?: boolean;
}

export interface MatchResult {
  matches: Map<string, OrtemsMatch>;
  opMatches: Map<string, string[]>;
  ordenMatches: Map<string, string[]>;
  ambiguous: { rid: string; rule: MatchRule; candidates: string[] }[];
  ortemsOnly: string[];
  /** Órdenes de producción sin ningún registro Ortems (ni a nivel de orden ni de operación). */
  prodOnlyOrdenes: string[];
  /** Operaciones de órdenes con planificación Ortems por operación que no tienen su registro Ortems. */
  prodOnlyOps: string[];
}

const OP_FIELDS = new Set(['operacionId', 'puestoId']);

function isOpRule(rule: MatchRule) {
  return rule.fields.some((f) => OP_FIELDS.has(f));
}

function compose(values: (string | undefined)[], norm: IdNormalization): string | undefined {
  const parts: string[] = [];
  for (const v of values) {
    const k = idKey(v, norm);
    if (k === undefined) return undefined;
    parts.push(k);
  }
  return parts.join('¦');
}

/**
 * Empareja cada registro de Ortems con producción aplicando las reglas en orden de prioridad.
 * Solo coincidencias EXACTAS de identificadores (con la normalización configurada).
 * Si una regla devuelve varias candidatas, el registro queda AMBIGUO y no se empareja automáticamente.
 */
export function matchSources(model: ProductionModel, ortems: OrtemsRecord[], settings: Settings): MatchResult {
  const norm: IdNormalization = { caseInsensitive: settings.matching.caseInsensitive, stripLeadingZeros: settings.matching.stripLeadingZeros };
  const rules = settings.matching.rules.filter((r) => r.enabled && r.fields.length);
  const indexes = new Map<string, Map<string, string[]>>();
  for (const rule of rules) {
    const idx = new Map<string, string[]>();
    if (isOpRule(rule)) {
      for (const op of model.ops.values()) {
        const ord = model.ordenes.get(op.ordenId);
        const vals = rule.fields.map((f) => fieldOfOp(f, op, ord));
        const k = compose(vals, norm);
        if (k === undefined) continue;
        const l = idx.get(k) ?? [];
        l.push(op.key);
        idx.set(k, l);
      }
    } else {
      for (const o of model.ordenes.values()) {
        // ordenId = número de orden real (no el de una preorden usada como nodo del árbol)
        const vals = rule.fields.map((f) => (f === 'ordenId' ? o.ordenId : f === 'preordenId' ? o.preordenId : f === 'aparatoId' ? o.aparatoId : f === 'articuloRef' ? o.articuloRef : undefined));
        const k = compose(vals, norm);
        if (k === undefined) continue;
        const l = idx.get(k) ?? [];
        if (!l.includes(o.id)) l.push(o.id);
        idx.set(k, l);
      }
    }
    indexes.set(rule.id, idx);
  }

  const res: MatchResult = { matches: new Map(), opMatches: new Map(), ordenMatches: new Map(), ambiguous: [], ortemsOnly: [], prodOnlyOrdenes: [], prodOnlyOps: [] };
  for (const r of ortems) {
    if (r.status === 'rechazado') continue;
    let done = false;
    for (const rule of rules) {
      const vals = rule.fields.map((f) => (r as unknown as Record<string, string | undefined>)[f]);
      const k = compose(vals, norm);
      if (k === undefined) continue;
      const cands = indexes.get(rule.id)?.get(k);
      if (!cands?.length) continue;
      if (cands.length > 1) {
        res.ambiguous.push({ rid: r.rid, rule, candidates: cands });
        done = true;
        break;
      }
      const level: MatchLevel = isOpRule(rule) ? 'operacion' : 'orden';
      const m: OrtemsMatch = { rid: r.rid, level, target: cands[0], rule, opNotFound: level === 'orden' && !!r.operacionId && model.opLevel };
      res.matches.set(r.rid, m);
      const bucket = level === 'operacion' ? res.opMatches : res.ordenMatches;
      const l = bucket.get(cands[0]) ?? [];
      l.push(r.rid);
      bucket.set(cands[0], l);
      done = true;
      break;
    }
    if (!done) res.ortemsOnly.push(r.rid);
  }

  const ordenesWithOpMatch = new Set<string>();
  for (const opKey of res.opMatches.keys()) {
    const op = model.ops.get(opKey);
    if (op) ordenesWithOpMatch.add(op.ordenId);
  }
  for (const o of model.ordenes.values()) {
    const has = res.ordenMatches.has(o.id) || ordenesWithOpMatch.has(o.id);
    if (!has) res.prodOnlyOrdenes.push(o.id);
    else if (ordenesWithOpMatch.has(o.id) && !res.ordenMatches.has(o.id)) {
      for (const k of o.opKeys) if (!res.opMatches.has(k)) res.prodOnlyOps.push(k);
    }
  }
  return res;
}

function fieldOfOp(f: string, op: { ordenId: string; operacionId?: string; puestoId?: string; aparatoId?: string; articuloRef?: string; preordenId?: string }, ord?: { ordenId?: string; preordenId?: string; aparatoId?: string; articuloRef?: string }): string | undefined {
  switch (f) {
    case 'ordenId':
      return ord?.ordenId;
    case 'operacionId':
      return op.operacionId;
    case 'puestoId':
      return op.puestoId;
    case 'aparatoId':
      return op.aparatoId ?? ord?.aparatoId;
    case 'articuloRef':
      return op.articuloRef ?? ord?.articuloRef;
    case 'preordenId':
      return op.preordenId ?? ord?.preordenId;
  }
  return undefined;
}

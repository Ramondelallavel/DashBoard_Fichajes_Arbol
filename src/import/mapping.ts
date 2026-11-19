import { fieldsFor, ROLE_FIELDS, requiredRules, type FieldDef } from '../domain/fields';
import type { MappingProfile, ParseOptions, RawCell, SheetRole, SourceKind } from '../domain/types';
import { normalizeHeader } from '../lib/text';
import { typePlausibility } from './values';

export interface ColumnSuggestion {
  col: number;
  header: string;
  field?: string;
  score: number;
  confidence: 'alta' | 'media' | 'baja' | 'ninguna';
  reason: string;
}

export function allowedFields(kind: SourceKind, role: SheetRole): FieldDef[] {
  const all = fieldsFor(kind);
  if (role === 'filas') return all;
  const allowed = ROLE_FIELDS[role];
  return all.filter((f) => allowed.includes(f.key));
}

function similarity(header: string, syn: string): number {
  const h = normalizeHeader(header);
  const s = normalizeHeader(syn);
  if (!h || !s) return 0;
  if (h === s) return 1;
  const ht = new Set(h.split(' '));
  const st = s.split(' ');
  const allIn = st.every((t) => ht.has(t));
  if (allIn) return 0.82 - Math.min(0.15, (ht.size - st.length) * 0.05);
  const inter = st.filter((t) => ht.has(t)).length;
  const union = new Set([...ht, ...st]).size;
  const jacc = inter / union;
  if (h.replace(/ /g, '') === s.replace(/ /g, '')) return 0.95;
  return jacc * 0.75;
}

/**
 * Propone una asignación columna -> campo. Nunca es definitiva: el usuario la valida.
 * Orden de preferencia: perfil guardado con la misma cabecera > sinónimos > nada.
 */
export function suggestMapping(
  headers: string[],
  samples: RawCell[][],
  kind: SourceKind,
  role: SheetRole,
  opts: ParseOptions,
  profile?: MappingProfile,
): ColumnSuggestion[] {
  const fields = allowedFields(kind, role);
  const cand: { col: number; field: string; score: number; reason: string }[] = [];
  headers.forEach((h, col) => {
    const nh = normalizeHeader(h);
    if (profile && profile.mapping[nh]) {
      const f = profile.mapping[nh];
      if (fields.some((x) => x.key === f)) cand.push({ col, field: f, score: 2, reason: `Perfil guardado «${profile.name}»` });
    }
    for (const f of fields) {
      let best = similarity(h, f.label);
      let why = `Coincide con «${f.label}»`;
      for (const syn of f.synonyms) {
        const s = similarity(h, syn);
        if (s > best) {
          best = s;
          why = `Coincide con el sinónimo «${syn}»`;
        }
      }
      if (best <= 0.3) continue;
      const plaus = typePlausibility(samples.map((r) => r[col] ?? null), f.type, opts);
      const adj = best + (f.type === 'date' || f.type === 'duration' || f.type === 'number' ? (plaus - 0.5) * 0.3 : 0);
      cand.push({ col, field: f.key, score: adj, reason: why + (plaus < 0.5 && (f.type === 'date' || f.type === 'duration') ? ' (los valores no parecen de este tipo)' : '') });
    }
  });
  // Asignación voraz: mejor puntuación primero, cada campo y cada columna como máximo una vez.
  cand.sort((a, b) => b.score - a.score);
  const usedCols = new Set<number>();
  const usedFields = new Set<string>();
  const result: ColumnSuggestion[] = headers.map((header, col) => ({ col, header, score: 0, confidence: 'ninguna', reason: 'Sin correspondencia propuesta' }));
  for (const c of cand) {
    if (c.score < 0.55) break;
    if (usedCols.has(c.col) || usedFields.has(c.field)) continue;
    usedCols.add(c.col);
    usedFields.add(c.field);
    const confidence = c.score >= 0.9 ? 'alta' : c.score >= 0.7 ? 'media' : 'baja';
    result[c.col] = { col: c.col, header: headers[c.col], field: c.field, score: Math.min(c.score, 1), confidence, reason: c.reason };
  }
  return result;
}

export interface MappingValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  unknownColumns: string[];
}

export function validateMapping(kind: SourceKind, role: SheetRole, headers: string[], mapping: Record<number, string>): MappingValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const assigned = Object.values(mapping).filter(Boolean);
  for (const rule of requiredRules(kind, role)) {
    if (!rule.anyOf.some((f) => assigned.includes(f))) errors.push(rule.message);
  }
  const counts = new Map<string, number>();
  for (const f of assigned) counts.set(f, (counts.get(f) ?? 0) + 1);
  for (const [f, n] of counts) if (n > 1) errors.push(`El campo «${labelOf(kind, f)}» está asignado a ${n} columnas. Cada campo solo puede venir de una columna.`);
  const unknownColumns = headers.filter((_, i) => !mapping[i]);
  if (role === 'filas') {
    const rec = kind === 'produccion' ? ['aparatoId', 'operacionId', 'puestoId', 'inicioPrevisto', 'finPrevisto'] : ['prioridad', 'inicio', 'fin'];
    const missing = rec.filter((f) => !assigned.includes(f));
    if (missing.length) warnings.push(`Campos recomendados sin asignar: ${missing.map((f) => labelOf(kind, f)).join(', ')}. Los análisis que los necesiten se marcarán como incompletos.`);
  }
  return { ok: errors.length === 0, errors, warnings, unknownColumns };
}

function labelOf(kind: SourceKind, key: string): string {
  return fieldsFor(kind).find((f) => f.key === key)?.label ?? key;
}

export function headerSignature(headers: string[]): string[] {
  return headers.map(normalizeHeader).filter((h) => h && !/^columna [a-z]+$/.test(h)).sort();
}

/** Busca un perfil guardado cuyo formato de cabecera coincida (Jaccard >= 0,8). */
export function findProfile(profiles: MappingProfile[], kind: SourceKind, role: SheetRole, headers: string[]): MappingProfile | undefined {
  const sig = new Set(headerSignature(headers));
  let best: MappingProfile | undefined;
  let bestScore = 0;
  for (const p of profiles) {
    if (p.kind !== kind || p.role !== role) continue;
    const ps = new Set(p.headerSignature);
    const inter = [...sig].filter((h) => ps.has(h)).length;
    const union = new Set([...sig, ...ps]).size || 1;
    const j = inter / union;
    if (j > bestScore) {
      bestScore = j;
      best = p;
    }
  }
  return bestScore >= 0.8 ? best : undefined;
}

export function mappingToProfileMapping(headers: string[], mapping: Record<number, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [col, field] of Object.entries(mapping)) {
    if (field) out[normalizeHeader(headers[Number(col)])] = field;
  }
  return out;
}


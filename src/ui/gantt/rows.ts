import { isAdelantada, isRetrasada, type Analysis } from '../../engine/analysis';
import type { FilterResult } from '../../engine/filters';
import { naturalCompare } from '../../lib/text';

export type GroupBy = 'aparato' | 'familia' | 'seccion' | 'puesto' | 'orden';
export type SourceMode = 'produccion' | 'ortems' | 'ambas';

export type FlagId = 'late' | 'early' | 'ovl' | 'sat' | 'pend' | 'info' | 'dev';

export const FLAG_META: Record<FlagId, { glyph: string; label: string }> = {
  late: { glyph: '!', label: 'Retrasada' },
  early: { glyph: '«', label: 'Adelantada respecto a Ortems' },
  ovl: { glyph: '⧉', label: 'Solapada (conflicto de recurso)' },
  sat: { glyph: '▲', label: 'Recurso saturado' },
  pend: { glyph: '?', label: 'Pendiente de validación' },
  info: { glyph: '≈', label: 'Información insuficiente o estimada' },
  dev: { glyph: '↔', label: 'Desviación respecto a Ortems' },
};

export interface GBar {
  id: string;
  start: number;
  end: number;
  source: 'produccion' | 'ortems';
  summary: boolean;
  flags: FlagId[];
  opKey?: string;
  ordenId?: string;
  ortemsRids?: string[];
}

export interface GRow {
  id: string;
  level: number;
  kind: 'grupo' | 'aparato' | 'orden' | 'op' | 'ortems';
  label: string;
  sub?: string;
  hasChildren: boolean;
  expanded: boolean;
  bars: GBar[];
  flags: Map<FlagId, number>;
  opKey?: string;
  ordenId?: string;
  aparatoId?: string;
  puestoId?: string;
  ortemsRid?: string;
}

interface Node {
  id: string;
  kind: GRow['kind'];
  label: string;
  sub?: string;
  children: Node[];
  bars: GBar[];
  opKey?: string;
  ordenId?: string;
  aparatoId?: string;
  puestoId?: string;
  ortemsRid?: string;
  flags: Map<FlagId, number>;
  sortKey: number;
}

export function opFlagIds(a: Analysis, opKey: string): FlagId[] {
  const f = a.opFlags.get(opKey);
  if (!f) return [];
  const out: FlagId[] = [];
  if (isRetrasada(f)) out.push('late');
  if (isAdelantada(f)) out.push('early');
  if (f.solape && f.solape.clase !== 'solape_dentro_capacidad') out.push('ovl');
  if (f.saturado) out.push('sat');
  if (f.pendienteValidacion) out.push('pend');
  if (f.sinInfo.length) out.push('info');
  if (f.desviacionOrtems) out.push('dev');
  return out;
}

function leafNode(a: Analysis, opKey: string, source: SourceMode, labelMode: 'op' | 'full'): Node | undefined {
  const op = a.model.ops.get(opKey);
  if (!op) return undefined;
  const flags = opFlagIds(a, opKey);
  const bars: GBar[] = [];
  if (source !== 'ortems' && op.start !== undefined && op.end !== undefined) {
    bars.push({ id: `p:${opKey}`, start: op.start, end: Math.max(op.end, op.start), source: 'produccion', summary: false, flags, opKey, ordenId: op.ordenId });
  }
  const row = a.comparison.byOp.get(opKey);
  if (source !== 'produccion' && row?.ortStart !== undefined && row.ortEnd !== undefined) {
    const ovl = row.discrepancies.some((d) => d.type === 'solape_ortems');
    bars.push({ id: `o:${opKey}`, start: row.ortStart, end: Math.max(row.ortEnd, row.ortStart), source: 'ortems', summary: false, flags: ovl ? ['ovl'] : [], opKey, ortemsRids: row.ortemsRids, ordenId: op.ordenId });
  }
  const fm = new Map<FlagId, number>();
  for (const f of flags) fm.set(f, 1);
  const label = labelMode === 'op' ? `${op.label}${op.desc ? ` · ${op.desc}` : ''}` : `${op.ordenId} / ${op.label}`;
  const sub = labelMode === 'op' ? op.puestoId : `${op.aparatoId ?? 's/aparato'}${op.desc ? ` · ${op.desc}` : ''}`;
  return { id: `op:${opKey}`, kind: 'op', label, sub, children: [], bars, opKey, ordenId: op.ordenId, aparatoId: op.aparatoId, puestoId: op.puestoId, flags: fm, sortKey: op.start ?? Infinity };
}

function ortemsLeaf(a: Analysis, rid: string): Node | undefined {
  const r = a.ortems.get(rid);
  if (!r) return undefined;
  const bars: GBar[] = [];
  if (r.inicio !== undefined && r.fin !== undefined) bars.push({ id: `or:${rid}`, start: r.inicio, end: Math.max(r.fin, r.inicio), source: 'ortems', summary: false, flags: ['pend'], ortemsRids: [rid] });
  return {
    id: `ort:${rid}`,
    kind: 'ortems',
    label: `${r.ordenId ?? r.preordenId ?? '—'}${r.operacionId ? ` / ${r.operacionId}` : ''}`,
    sub: `Solo Ortems${r.puestoId ? ` · ${r.puestoId}` : ''}${r.prioridadRaw ? ` · prio ${r.prioridadRaw}` : ''}`,
    children: [],
    bars,
    ortemsRid: rid,
    aparatoId: r.aparatoId,
    puestoId: r.puestoId,
    flags: new Map([['pend', 1]]),
    sortKey: r.inicio ?? Infinity,
  };
}

function group(id: string, kind: Node['kind'], label: string, children: Node[], sub?: string, extra: Partial<Node> = {}): Node {
  const n: Node = { id, kind, label, sub, children, bars: [], flags: new Map(), sortKey: Infinity, ...extra };
  return n;
}

/** Barras resumen y banderas agregadas a partir de los hijos (recursivo). */
function summarize(n: Node, a: Analysis, source: SourceMode): void {
  if (!n.children.length) return;
  for (const c of n.children) summarize(c, a, source);
  const all = n.children.flatMap((c) => c.bars);
  for (const src of ['produccion', 'ortems'] as const) {
    if ((src === 'produccion' && source === 'ortems') || (src === 'ortems' && source === 'produccion')) continue;
    const bs = all.filter((b) => b.source === src);
    let s = Math.min(...bs.map((b) => b.start));
    let e = Math.max(...bs.map((b) => b.end));
    // Emparejamiento a nivel de orden: Ortems se representa en la fila de la orden
    if (src === 'ortems' && n.kind === 'orden' && n.ordenId) {
      const ordRow = a.comparison.byOrden.get(n.ordenId)?.find((r) => r.level === 'orden');
      if (ordRow?.ortStart !== undefined && ordRow.ortEnd !== undefined) {
        s = Math.min(s, ordRow.ortStart);
        e = Math.max(e, ordRow.ortEnd);
      }
    }
    if (Number.isFinite(s) && Number.isFinite(e)) n.bars.push({ id: `${src[0]}s:${n.id}`, start: s, end: Math.max(e, s), source: src, summary: true, flags: [], ordenId: n.ordenId });
  }
  n.sortKey = Math.min(...n.children.map((c) => c.sortKey));
  for (const c of n.children) for (const [f, k] of c.flags) n.flags.set(f, (n.flags.get(f) ?? 0) + k);
}

export function buildTree(a: Analysis, filtered: FilterResult | undefined, groupBy: GroupBy, source: SourceMode, onlyAparato?: string): Node[] {
  const m = a.model;
  const opKeys = onlyAparato
    ? (m.aparatos.get(onlyAparato)?.ordenIds ?? []).flatMap((o) => m.ordenes.get(o)?.opKeys ?? [])
    : filtered
      ? [...filtered.ops]
      : [...m.ops.keys()];
  const ortOnly = onlyAparato ? a.match.ortemsOnly.filter((rid) => a.ortems.get(rid)?.aparatoId === onlyAparato) : filtered ? [...filtered.ortemsOnly] : a.match.ortemsOnly;
  const showOrtOnly = source !== 'produccion';
  const roots: Node[] = [];

  const ordenNode = (ordenId: string, keys: string[]): Node => {
    const o = m.ordenes.get(ordenId);
    const kids = keys.map((k) => leafNode(a, k, source, 'op')).filter(Boolean) as Node[];
    kids.sort((x, y) => naturalCompare(x.label, y.label));
    const rel = o?.parentId ? `↳ padre ${o.parentId}` : o && o.childIds.length ? 'orden raíz' : undefined;
    return group(`ord:${ordenId}`, 'orden', `Orden ${ordenId}`, kids, [o?.articuloDesc, rel].filter(Boolean).join(' · '), { ordenId, aparatoId: o?.aparatoId });
  };
  const byOrden = (keys: string[]) => {
    const mp = new Map<string, string[]>();
    for (const k of keys) {
      const op = m.ops.get(k);
      if (!op) continue;
      const l = mp.get(op.ordenId) ?? [];
      l.push(k);
      mp.set(op.ordenId, l);
    }
    return mp;
  };
  const aparatoNode = (apId: string, keys: string[], prefix = ''): Node => {
    const ap = m.aparatos.get(apId);
    const ords = [...byOrden(keys).entries()].map(([o, ks]) => ordenNode(o, ks));
    const extras = showOrtOnly ? ortOnly.filter((rid) => a.ortems.get(rid)?.aparatoId === apId).map((rid) => ortemsLeaf(a, rid)!).filter(Boolean) : [];
    return group(`${prefix}ap:${apId}`, 'aparato', `Aparato ${apId}`, [...ords, ...extras], [ap?.familia, ap?.desc].filter(Boolean).join(' · '), { aparatoId: apId });
  };

  if (groupBy === 'aparato' || groupBy === 'familia') {
    const byAp = new Map<string, string[]>();
    const noAp: string[] = [];
    for (const k of opKeys) {
      const op = m.ops.get(k);
      if (!op) continue;
      if (!op.aparatoId) {
        noAp.push(k);
        continue;
      }
      const l = byAp.get(op.aparatoId) ?? [];
      l.push(k);
      byAp.set(op.aparatoId, l);
    }
    if (showOrtOnly) for (const rid of ortOnly) {
      const ap = a.ortems.get(rid)?.aparatoId;
      if (ap && m.aparatos.has(ap) && !byAp.has(ap)) byAp.set(ap, []);
    }
    const apNodes = [...byAp.entries()].map(([ap, ks]) => aparatoNode(ap, ks, groupBy === 'familia' ? 'f:' : ''));
    if (groupBy === 'familia') {
      const fam = new Map<string, Node[]>();
      for (const n of apNodes) {
        const f = m.aparatos.get(n.aparatoId!)?.familia ?? '(sin familia)';
        const l = fam.get(f) ?? [];
        l.push(n);
        fam.set(f, l);
      }
      for (const [f, ns] of fam) roots.push(group(`fam:${f}`, 'grupo', f, ns, `${ns.length} aparatos`));
    } else roots.push(...apNodes);
    if (noAp.length) roots.push(group('g:noap', 'grupo', 'Órdenes sin aparato', [...byOrden(noAp).entries()].map(([o, ks]) => ordenNode(o, ks)), 'Relación pendiente de validar'));
  } else if (groupBy === 'orden') {
    roots.push(...[...byOrden(opKeys).entries()].map(([o, ks]) => ordenNode(o, ks)));
  } else {
    const byPuesto = new Map<string, Node[]>();
    for (const k of opKeys) {
      const n = leafNode(a, k, source, 'full');
      if (!n) continue;
      const p = n.puestoId ?? '(sin puesto)';
      const l = byPuesto.get(p) ?? [];
      l.push(n);
      byPuesto.set(p, l);
    }
    if (showOrtOnly) for (const rid of ortOnly) {
      const n = ortemsLeaf(a, rid);
      if (!n) continue;
      const p = n.puestoId ?? '(sin puesto)';
      const l = byPuesto.get(p) ?? [];
      l.push(n);
      byPuesto.set(p, l);
    }
    const puestoNodes = [...byPuesto.entries()].map(([p, kids]) => {
      kids.sort((x, y) => x.sortKey - y.sortKey);
      const pd = m.puestos.get(p);
      return group(`pt:${p}`, 'grupo', `Puesto ${p}`, kids, pd?.desc, { puestoId: p });
    });
    if (groupBy === 'seccion') {
      const bySec = new Map<string, Node[]>();
      for (const n of puestoNodes) {
        const s = m.puestos.get(n.puestoId!)?.seccion ?? '(sin sección)';
        const l = bySec.get(s) ?? [];
        l.push(n);
        bySec.set(s, l);
      }
      for (const [s, ns] of bySec) {
        ns.sort((x, y) => naturalCompare(x.label, y.label));
        roots.push(group(`sec:${s}`, 'grupo', s, ns, `${ns.length} puestos`));
      }
    } else roots.push(...puestoNodes);
  }

  if (showOrtOnly && (groupBy === 'aparato' || groupBy === 'familia' || groupBy === 'orden')) {
    const orphan = ortOnly.filter((rid) => {
      const ap = a.ortems.get(rid)?.aparatoId;
      return groupBy === 'orden' || !ap || !m.aparatos.has(ap);
    });
    if (orphan.length) {
      const byKey = new Map<string, Node[]>();
      for (const rid of orphan) {
        const r = a.ortems.get(rid)!;
        const k = r.ordenId ?? r.preordenId ?? '—';
        const l = byKey.get(k) ?? [];
        l.push(ortemsLeaf(a, rid)!);
        byKey.set(k, l);
      }
      const kids = [...byKey.entries()].map(([k, ns]) => {
        const r = a.ortems.get(ns[0].ortemsRid!)!;
        return group(`ok:${k}`, 'orden', r.ordenId ? `Orden ${k}` : `Preorden ${k}`, ns, `${r.aparatoId ? `aparato ${r.aparatoId} · ` : ''}solo en Ortems`);
      });
      roots.push(group('g:ortonly', 'grupo', 'Solo en Ortems (sin correspondencia en producción)', kids, `${orphan.length} registros`));
    }
  }

  for (const r of roots) summarize(r, a, source);
  const sortRec = (ns: Node[]) => {
    ns.sort((x, y) => (x.kind === 'grupo' && y.kind === 'grupo' && x.id.startsWith('g:') !== y.id.startsWith('g:') ? (x.id.startsWith('g:') ? 1 : -1) : 0) || x.sortKey - y.sortKey || naturalCompare(x.label, y.label));
    for (const n of ns) if (n.kind !== 'orden') sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

export function flatten(roots: Node[], expanded: Set<string>, collapsedByDefault: boolean): GRow[] {
  const out: GRow[] = [];
  const walk = (n: Node, level: number) => {
    const hasChildren = n.children.length > 0;
    const isExp = hasChildren && (collapsedByDefault ? expanded.has(n.id) : !expanded.has(n.id));
    out.push({
      id: n.id,
      level,
      kind: n.kind,
      label: n.label,
      sub: n.sub,
      hasChildren,
      expanded: isExp,
      bars: n.bars,
      flags: n.flags,
      opKey: n.opKey,
      ordenId: n.ordenId,
      aparatoId: n.aparatoId,
      puestoId: n.puestoId,
      ortemsRid: n.ortemsRid,
    });
    if (isExp) for (const c of n.children) walk(c, level + 1);
  };
  for (const r of roots) walk(r, 0);
  return out;
}

export function allNodeIds(roots: Node[]): string[] {
  const out: string[] = [];
  const walk = (n: Node) => {
    if (n.children.length) {
      out.push(n.id);
      n.children.forEach(walk);
    }
  };
  roots.forEach(walk);
  return out;
}

export function dataRange(roots: Node[]): [number, number] | undefined {
  let s = Infinity;
  let e = -Infinity;
  const walk = (n: Node) => {
    for (const b of n.bars) {
      s = Math.min(s, b.start);
      e = Math.max(e, b.end);
    }
    n.children.forEach(walk);
  };
  roots.forEach(walk);
  return Number.isFinite(s) ? [s, e] : undefined;
}

export type GanttNode = Node;

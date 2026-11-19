import { useMemo, useRef, useState, type ReactNode } from 'react';

export interface Column<T> {
  id: string;
  header: string;
  /** Ancho en la rejilla CSS (p. ej. '120px' o 'minmax(160px,1fr)'). */
  width: string;
  render: (row: T) => ReactNode;
  sort?: (row: T) => string | number | undefined;
  align?: 'right' | 'center';
  title?: (row: T) => string | undefined;
}

interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectedKey?: string;
  height?: number;
  rowHeight?: number;
  minWidth?: number;
  empty?: ReactNode;
  initialSort?: { id: string; dir: 1 | -1 };
  label: string;
}

/** Tabla virtualizada: solo se pintan las filas visibles, para miles de registros. */
export function DataTable<T>({ rows, columns, rowKey, onRowClick, selectedKey, height = 480, rowHeight = 34, minWidth = 900, empty, initialSort, label }: Props<T>) {
  const [sort, setSort] = useState<{ id: string; dir: 1 | -1 } | undefined>(initialSort);
  const [scrollTop, setScrollTop] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.id === sort.id);
    if (!col?.sort) return rows;
    const get = col.sort;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va === undefined && vb === undefined) return 0;
      if (va === undefined) return 1;
      if (vb === undefined) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sort.dir;
      return String(va).localeCompare(String(vb), 'es', { numeric: true }) * sort.dir;
    });
  }, [rows, sort, columns]);
  const template = columns.map((c) => c.width).join(' ');
  const headH = 34;
  const total = sorted.length * rowHeight;
  const viewH = Math.min(height, headH + total + 2);
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 6);
  const end = Math.min(sorted.length, Math.ceil((scrollTop + viewH) / rowHeight) + 6);
  if (!rows.length) return <div className="empty">{empty ?? 'Sin registros'}</div>;
  return (
    <div className="vtable" ref={ref} style={{ height: viewH }} onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)} role="table" aria-label={label} aria-rowcount={sorted.length}>
      <div style={{ minWidth, position: 'relative', height: headH + total }}>
        <div className="vt-head" style={{ gridTemplateColumns: template, height: headH }} role="row">
          {columns.map((c) => (
            <div key={c.id} role="columnheader" style={{ textAlign: c.align }} aria-sort={sort?.id === c.id ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
              {c.sort ? (
                <button type="button" onClick={() => setSort(sort?.id === c.id ? { id: c.id, dir: sort.dir === 1 ? -1 : 1 } : { id: c.id, dir: 1 })} title="Ordenar">
                  {c.header} {sort?.id === c.id ? (sort.dir === 1 ? '▲' : '▼') : ''}
                </button>
              ) : (
                c.header
              )}
            </div>
          ))}
        </div>
        {sorted.slice(start, end).map((r, i) => {
          const k = rowKey(r);
          return (
            <div
              key={k}
              role="row"
              className={`vt-row${onRowClick ? ' clickable' : ''}${selectedKey === k ? ' selected' : ''}`}
              style={{ gridTemplateColumns: template, top: headH + (start + i) * rowHeight, height: rowHeight }}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={onRowClick ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onRowClick(r)) : undefined}
            >
              {columns.map((c) => (
                <div key={c.id} role="cell" style={{ textAlign: c.align }} title={c.title?.(r)}>
                  {c.render(r)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

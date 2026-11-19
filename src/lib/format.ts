const nf1 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 0 });
const nf0 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });

export function fmtHours(h: number | undefined): string {
  if (h === undefined || !Number.isFinite(h)) return '—';
  return `${nf1.format(h)} h`;
}

export function fmtNum(n: number | undefined, decimals = 0): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  return decimals ? new Intl.NumberFormat('es-ES', { maximumFractionDigits: decimals }).format(n) : nf0.format(n);
}

export function fmtPct(ratio: number | undefined): string {
  if (ratio === undefined || !Number.isFinite(ratio)) return '—';
  return `${nf0.format(ratio * 100)} %`;
}

export function fmtSigned(n: number | undefined, unit: string, decimals = 1): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  const v = new Intl.NumberFormat('es-ES', { maximumFractionDigits: decimals }).format(Math.abs(n));
  if (Math.abs(n) < 1e-9) return `0 ${unit}`;
  return `${n > 0 ? '+' : '−'}${v} ${unit}`;
}

export function plural(n: number, one: string, many: string): string {
  return `${fmtNum(n)} ${n === 1 ? one : many}`;
}

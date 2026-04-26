export function fmtNum(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString('ko-KR', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function fmtPnl(pct: number): string {
  if (!Number.isFinite(pct)) return '-';
  return (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
}

export function pnlColor(v: number): 'var(--up)' | 'var(--down)' | 'var(--muted)' {
  if (!Number.isFinite(v) || v === 0) return 'var(--muted)';
  return v > 0 ? 'var(--up)' : 'var(--down)';
}

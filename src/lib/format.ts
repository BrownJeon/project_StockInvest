/**
 * 시장별 가격 포맷.
 * - domestic: ₩12,345 (정수)
 * - overseas: KIS는 KRW 환산가로 저장 → fxRate로 역산해 $12.34 표시
 */
export function fmtMarketPrice(
  price: number,
  market: string,
  fxRate = 1380,
): string {
  if (!Number.isFinite(price)) return '-';
  if (market === 'overseas') {
    const usd = price / fxRate;
    return `$${usd.toFixed(2)}`;
  }
  return `₩${Math.round(price).toLocaleString('ko-KR')}`;
}

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

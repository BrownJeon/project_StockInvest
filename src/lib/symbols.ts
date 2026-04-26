/**
 * 대시보드 진입 시 표시할 기본 심볼 후보. 보유 종목·universe가 없을 때만 사용.
 * 국내 대표 종목 2개 (삼성전자, SK하이닉스).
 */
export function getAllowedSymbols(): string[] {
  return ['005930', '000660'];
}

export function isAllowedSymbol(_symbol: string): boolean {
  return true;
}

/**
 * UI 표시용 심볼 단축 — 국내(6자리)는 그대로, 해외(`NAS:AAPL`)는 티커만.
 */
export function formatSymbolShort(symbol: string): string {
  if (!symbol) return symbol;
  const idx = symbol.indexOf(':');
  if (idx > 0) return symbol.slice(idx + 1);
  return symbol;
}

/**
 * 수량 단위 — 주식은 모두 '주'.
 */
export function symbolUnit(_symbol: string): string {
  return '주';
}

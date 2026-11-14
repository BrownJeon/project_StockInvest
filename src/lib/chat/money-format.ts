/** T-169 B4 — 비서 채팅 프롬프트용 가격 표기(국내 원 · 미국 달러). 화면 표시와 무관하다. */

/** 달러 표기 — `$1,234.56` */
export function formatUsd(v: number): string {
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 원화 표기 — `1,234원` */
export function formatKrw(v: number): string {
  return `${v.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}원`;
}

/** 앱 심볼 규칙: 해외는 `NAS:AAPL` 처럼 `:` 가 있다. */
export function isOverseasSymbol(symbol: string): boolean {
  return symbol.includes(':');
}

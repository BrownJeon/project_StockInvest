/**
 * 국내/해외 시장 라우팅을 위한 심볼 유틸.
 *
 * 규약:
 *  - 국내(KOSPI/KOSDAQ): 6자리 숫자  (ex: '005930', '000660')
 *  - 해외(NASDAQ/NYSE/AMEX): 'EXCD:TICKER' 접두사 (ex: 'NAS:AAPL', 'NYS:BRK.B')
 *
 * BRK.B 같은 점(.) 포함 티커도 허용. 6자리 숫자와 충돌 없음.
 */

export type Market = 'domestic' | 'overseas';
export type OverseasExchange = 'NAS' | 'NYS' | 'AMS';

const OVERSEAS_PATTERN = /^[A-Z]{3}:[A-Z][A-Z0-9.]*$/;
const DOMESTIC_PATTERN = /^\d{6}$/;

/** 심볼 문자열로부터 시장 구분. 형식이 맞지 않으면 'domestic' 폴백(기존 데이터 호환). */
export function getMarketFromSymbol(symbol: string): Market {
  return OVERSEAS_PATTERN.test(symbol) ? 'overseas' : 'domestic';
}

export function isDomesticSymbol(symbol: string): boolean {
  return DOMESTIC_PATTERN.test(symbol);
}

export function isOverseasSymbol(symbol: string): boolean {
  return OVERSEAS_PATTERN.test(symbol);
}

/** 'NAS:AAPL' → { excd: 'NAS', ticker: 'AAPL' } */
export function parseOverseas(symbol: string): { excd: OverseasExchange; ticker: string } {
  if (!OVERSEAS_PATTERN.test(symbol)) {
    throw new Error(`Not an overseas symbol: ${symbol}`);
  }
  const idx = symbol.indexOf(':');
  return {
    excd:   symbol.slice(0, idx) as OverseasExchange,
    ticker: symbol.slice(idx + 1),
  };
}

export function formatOverseas(excd: OverseasExchange, ticker: string): string {
  return `${excd}:${ticker.toUpperCase()}`;
}

/** OverseasExchange → KIS API의 OVRS_EXCG_CD (4자리). NASDAQ → 'NASD' 등. */
const OVRS_EXCG_CD_MAP: Record<OverseasExchange, string> = {
  NAS: 'NASD',
  NYS: 'NYSE',
  AMS: 'AMEX',
};
export function toOvrsExcgCd(excd: OverseasExchange): string {
  return OVRS_EXCG_CD_MAP[excd];
}

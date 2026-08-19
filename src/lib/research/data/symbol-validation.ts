/**
 * 리서치용 심볼 검증·정규화 — T-032.
 *
 * 이 모듈의 출력은 **외부 URL(Yahoo Finance)에 그대로 붙는다.** 따라서
 *  1) allowlist 정규식을 통과한 문자열만 후보로 만들고,
 *  2) 통과했더라도 URL 조립 시점에 `encodeURIComponent`를 한 번 더 씌운다(이중 방어).
 * DB의 즐겨찾기 심볼은 사용자가 직접 넣을 수 있으므로 신뢰하지 않는다.
 *
 * 시장 판별은 `stock_meta` JOIN이 아니라 **심볼 포맷**으로 한다 —
 * 해외 심볼은 stock_meta 자동 동기화 대상이 아니라 캐시미스가 나기 때문(T-032 설계).
 */
import { getMarketFromSymbol, isDomesticSymbol, isOverseasSymbol, parseOverseas } from '@/lib/exchanges/kis-symbols';
import type { ResearchMarket } from '../types';

/**
 * Yahoo chart API 경로에 넣어도 안전한 최종 형태.
 * 영숫자 + `.`(BRK.B) + `-`(BRK-B) + `^`(지수) 만 허용. 경로 구분자·쿼리 문자 전면 차단.
 */
const YAHOO_SYMBOL_ALLOWLIST = /^[A-Z0-9][A-Z0-9.\-]{0,19}$/;

export type SymbolValidationResult =
  | {
      ok: true;
      /** 원본 내부 심볼 ('005930' | 'NAS:MU') */
      symbol: string;
      market: ResearchMarket;
      /** 우선순위 순 Yahoo 심볼 후보 (국내는 .KS → .KQ 순으로 시도) */
      yahooCandidates: string[];
    }
  | { ok: false; symbol: string; reason: 'empty' | 'unsupported_format' | 'illegal_characters' };

/** allowlist를 통과하는지 — 후보 생성 후 최종 관문. */
export function isSafeYahooSymbol(candidate: string): boolean {
  return YAHOO_SYMBOL_ALLOWLIST.test(candidate);
}

/**
 * 내부 심볼 → Yahoo 심볼 후보.
 *  - 국내 6자리: KOSPI/KOSDAQ 구분 정보가 심볼에 없으므로 `.KS` → `.KQ` 순으로 폴백한다.
 *  - 해외 `EXC:TICKER`: Yahoo는 클래스 구분에 `-`를 쓴다(BRK.B → BRK-B). 원형도 후보로 남긴다.
 */
export function normalizeResearchSymbol(raw: string): SymbolValidationResult {
  const symbol = (raw ?? '').trim();
  if (!symbol) return { ok: false, symbol, reason: 'empty' };

  let candidates: string[];
  let market: ResearchMarket;

  if (isDomesticSymbol(symbol)) {
    market = 'domestic';
    candidates = [`${symbol}.KS`, `${symbol}.KQ`];
  } else if (isOverseasSymbol(symbol)) {
    market = 'overseas';
    const { ticker } = parseOverseas(symbol);
    const dashed = ticker.replace(/\./g, '-');
    candidates = dashed === ticker ? [ticker] : [dashed, ticker];
  } else {
    return { ok: false, symbol, reason: 'unsupported_format' };
  }

  // allowlist 통과분만 남긴다 — 하나도 안 남으면 조회 자체를 시도하지 않는다.
  const safe = candidates.filter(isSafeYahooSymbol);
  if (safe.length === 0) return { ok: false, symbol, reason: 'illegal_characters' };

  // 방어적 이중 확인: 포맷 판별과 시장 판별이 어긋나면 포맷 판별을 신뢰한다.
  if (getMarketFromSymbol(symbol) !== market) {
    return { ok: false, symbol, reason: 'unsupported_format' };
  }

  return { ok: true, symbol, market, yahooCandidates: safe };
}

/**
 * 검증된 심볼을 URL 경로 조각으로 변환 — allowlist 통과 후에도 encodeURIComponent 이중 적용.
 * allowlist를 통과하지 못한 값이 들어오면 던진다(호출자 버그를 조용히 넘기지 않는다).
 */
export function toYahooPathSegment(candidate: string): string {
  if (!isSafeYahooSymbol(candidate)) {
    throw new Error(`unsafe yahoo symbol: ${JSON.stringify(candidate)}`);
  }
  return encodeURIComponent(candidate);
}

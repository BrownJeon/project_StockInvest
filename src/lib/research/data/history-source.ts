/**
 * 심볼 → 일봉 이력 로더 (T-032).
 *
 * 심볼 검증 → Yahoo 후보 조회 → 캔들이 가장 많은 후보 채택.
 *
 * 🔴 **"첫 성공"이 아니라 "가장 많은 캔들"을 고르는 이유** (실측 근거):
 *   국내 6자리 심볼은 KOSPI/KOSDAQ 구분 정보가 없어 `.KS`·`.KQ` 둘 다 시도해야 하는데,
 *   Yahoo는 **틀린 접미어에도 200 + 껍데기 시계열**(대부분 close=null)을 준다.
 *     · 086520(에코프로, KOSDAQ): `.KS` → 23봉(대부분 null) / `.KQ` → 1220봉
 *     · 000660(SK하이닉스, KOSPI): `.KS` → 정상 / `.KQ` → 종가 null 다수
 *   "첫 성공"을 채택하면 KOSDAQ 종목이 23봉짜리 껍데기로 분석된다.
 *   파싱 단계에서 null 봉을 버리므로(`parseYahooChart`), **파싱 후 캔들 수**가
 *   올바른 접미어를 가리는 신뢰할 만한 판별자다. 동률이면 앞선 후보(`.KS`)를 쓴다.
 *
 * 후보가 2개 이상이면 **병렬로** 조회한다 — 순차로 돌리면 심볼당 예산(8초)을 넘긴다.
 */
import type { DailyCandle, ResearchMarket } from '../types';
import { normalizeResearchSymbol } from './symbol-validation';
import { fetchYahooDailyHistory, type YahooFetchOptions } from './yahoo-finance-source';

export interface HistoryLoadResult {
  symbol: string;
  market: ResearchMarket;
  /** 실제로 채택된 Yahoo 심볼 */
  sourceSymbol: string;
  candles: DailyCandle[];
}

export interface HistoryLoadOptions extends YahooFetchOptions {
  /** 테스트 주입용 — 기본은 Yahoo */
  loader?: (yahooSymbol: string, opts: YahooFetchOptions) => Promise<DailyCandle[]>;
}

export async function loadDailyHistory(
  symbol: string,
  opts: HistoryLoadOptions = {},
): Promise<HistoryLoadResult> {
  const norm = normalizeResearchSymbol(symbol);
  if (!norm.ok) {
    throw new Error(`invalid research symbol (${norm.reason}): ${symbol}`);
  }

  const { loader, ...fetchOpts } = opts;
  const load = loader ?? fetchYahooDailyHistory;

  const settled = await Promise.allSettled(
    norm.yahooCandidates.map((c) => load(c, fetchOpts)),
  );

  let best: { sourceSymbol: string; candles: DailyCandle[] } | null = null;
  const errors: string[] = [];

  settled.forEach((s, i) => {
    const candidate = norm.yahooCandidates[i];
    if (s.status === 'rejected') {
      errors.push(`${candidate}: ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`);
      return;
    }
    const candles = s.value;
    if (candles.length === 0) {
      errors.push(`${candidate}: empty`);
      return;
    }
    // 동률이면 먼저 나열된 후보를 유지한다(결정적).
    if (best === null || candles.length > best.candles.length) {
      best = { sourceSymbol: candidate, candles };
    }
  });

  if (best === null) {
    throw new Error(`no daily history for ${symbol} (${errors.join(' | ')})`);
  }

  const chosen: { sourceSymbol: string; candles: DailyCandle[] } = best;
  return {
    symbol: norm.symbol,
    market: norm.market,
    sourceSymbol: chosen.sourceSymbol,
    candles: chosen.candles,
  };
}

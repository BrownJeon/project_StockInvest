import type { MarketSummary } from './ai-filter';

/**
 * 종목 상태 분류기 (Market State Classifier) — StockInvest(KIS 주식) 버전.
 *
 * TradingInvest(코인) 버전과 동일한 구조. SI 전용 차이점:
 *  - volume_momentum → volume-spike-breakout-v1 (이미 구현된 SI 룰 활용)
 *  - 1d 기반 룰 (weekly-trend-follow, dividend-quality-buyback) 은 시장 상태와 무관하게
 *    engine.ts 에서 별도 항상 실행 (interval === '1d' 분기)
 *  - overbought_exit 은 보유 종목에서만 의미 → engine 에서 매도 후보 별도 처리
 */

export type MarketStateCategory =
  | 'divergence_signal'
  | 'oversold_bounce'
  | 'volume_momentum'
  | 'breakout_watch'
  | 'trend_following'
  | 'neutral';

/** 각 카테고리에 활성화할 30m 기반 룰 ID 목록 */
const STATE_RULES: Record<MarketStateCategory, string[]> = {
  divergence_signal: ['rsi-divergence-v1',    'triple-confirmation-v1'],
  oversold_bounce:   ['rsi-oversold-v1',       'rsi-macd-reversal-v1'],
  volume_momentum:   ['volume-spike-breakout-v1'],
  breakout_watch:    ['bb-breakout-v1',         'bb-squeeze-expansion-v1', 'price-breakout-v1'],
  trend_following:   ['ma-cross-v1',            'pullback-trend-v1'],
  neutral:           [],
};

/**
 * MarketSummary 지표를 기반으로 종목 상태 분류 (우선순위 순).
 * 1d 룰 (weekly-trend-follow, dividend-quality-buyback) 과
 * rsi-overbought-exit 은 이 함수 범위 밖 — engine.ts 에서 별도 처리.
 */
export function classifyMarketState(s: MarketSummary): MarketStateCategory {
  // 1순위: 다이버전스 신호 (RSI 극단)
  if (s.rsi14 != null && (s.rsi14 < 35 || s.rsi14 > 68)) return 'divergence_signal';

  // 2순위: 과매도 반등 (RSI < 38 + 상향 추세)
  if (
    s.rsi14 != null && s.rsi14 < 38 &&
    s.ema20 != null && s.ema60 != null && s.ema20 >= s.ema60
  ) return 'oversold_bounce';

  // 2-B: VAL 지지선 아래 + 상향 추세 → 매물대 지지 반등
  if (
    s.val != null && s.currentPrice <= s.val * 1.005 &&
    s.ema20 != null && s.ema60 != null && s.ema20 >= s.ema60 * 0.99
  ) return 'oversold_bounce';

  // 3순위: 거래량 급등 모멘텀
  if (s.volumeRatio >= 2.5 && Math.abs(s.priceChange5) >= 1.5) return 'volume_momentum';

  // 4순위: 돌파 대기 (BB 근접 or 24h 고·저점 근접 or VAH 저항 돌파 시도)
  const nearBB =
    s.bbUpper != null && s.bbLower != null && (
      s.currentPrice > s.bbUpper * 0.985 ||
      s.currentPrice < s.bbLower * 1.015
    );
  const near24hHigh = s.high24h != null && s.high24h > 0 && s.currentPrice >= s.high24h * 0.992;
  const near24hLow  = s.low24h  != null && s.low24h  > 0 && s.currentPrice <= s.low24h  * 1.008;
  const nearVAH     = s.vah != null && s.currentPrice >= s.vah * 0.992;
  if (nearBB || near24hHigh || near24hLow || nearVAH) return 'breakout_watch';

  // 5순위: 추세 추종 (EMA 차이 0.5% 이상)
  if (
    s.ema20 != null && s.ema60 != null &&
    Math.abs((s.ema20 - s.ema60) / s.ema60) > 0.005
  ) return 'trend_following';

  return 'neutral';
}

/** 종목 상태에 맞는 30m 전략 룰 ID 목록 반환. neutral 이면 빈 배열. */
export function getRulesForState(state: MarketStateCategory): string[] {
  return STATE_RULES[state];
}

/** 1d 기반 룰 — 시장 상태와 무관하게 항상 실행 대상 */
export const ALWAYS_ACTIVE_RULES = new Set([
  'weekly-trend-follow-v1',
  'dividend-quality-buyback-v1',
  'rsi-overbought-exit-v1',  // 보유 종목 매도 전용 — 항상 포함
]);

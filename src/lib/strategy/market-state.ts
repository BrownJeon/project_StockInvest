import type { MarketSummary } from './ai-filter';

/**
 * 종목 국면 분류기 (Market State Classifier) — StockInvest(KIS 주식) 버전.
 *
 * ⚠️ **Phase 2 D1 (T-003 §2): 이 분류는 더 이상 게이트가 아니라 라벨이다.**
 *
 * 구 구조는 `STATE_RULES` 로 "이 국면에서 실행할 룰"을 선별했고, 그 결과
 * `rsi-oversold-v1` 은 **구조적으로 발화 불가능**했다:
 *   - 활성 창: classifyMarketState 가 RSI<35 를 `divergence_signal` 로 선점하므로
 *     `oversold_bounce` 는 RSI ∈ [35, 38) 에서만 성립
 *   - 발화 창: 룰 조건은 RSI < rsiBuyThreshold(=35)
 *   → **활성 창 ∩ 발화 창 = ∅**
 * 실측에서도 `rule_no_fire` 가 stage 'final' 의 95%(10,720건)를 차지해 이 데드락이
 * 최상류 병목임이 확인됐다. 그래서 게이팅(`STATE_RULES`·`getRulesForState`·
 * `ALWAYS_ACTIVE_RULES`)을 **삭제**하고 분류는 라벨로만 남긴다.
 *
 * 라벨의 용도 4가지 (§2):
 *   1. 승인 카드 "종목 국면" 표시 — 사람 판단 보조
 *   2. post-market AI 프롬프트 컨텍스트
 *   3. eval_funnel 라벨 → 국면별 룰 성과 사후 분석 (레짐 학습 루프 유지)
 *   4. 향후 포지션 사이징 힌트
 *
 * 룰의 실행 여부는 이제 오직 `strategies.enabled` 가 정한다.
 * 입력 summary 는 **룰과 동일한 1h 축**이어야 한다 (단일 소스 원칙).
 */

export type MarketStateCategory =
  | 'divergence_signal'
  | 'oversold_bounce'
  | 'volume_momentum'
  | 'breakout_watch'
  | 'trend_following'
  | 'neutral';

/**
 * MarketSummary 지표를 기반으로 종목 국면 분류 (우선순위 순).
 * **아무것도 차단하지 않는다** — 반환값은 기록·표시용 라벨이다.
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

/** 사용자 화면용 한글 라벨 — 승인 카드의 "종목 국면" 표기. */
export const MARKET_STATE_LABEL_KO: Record<MarketStateCategory, string> = {
  divergence_signal: '다이버전스',
  oversold_bounce:   '과매도 반등',
  volume_momentum:   '거래량 모멘텀',
  breakout_watch:    '돌파 대기',
  trend_following:   '추세 진행',
  neutral:           '중립',
};

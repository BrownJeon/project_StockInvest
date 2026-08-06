import type { Candle } from '@/lib/exchanges/types';
import type { Candidate, MarketSummary } from './ai-filter';

export type PrefilterReason =
  | 'liquidity_dead'
  | 'atr_zero'
  | 'rsi_extreme_counter'
  | 'blowoff_top';

export interface PrefilterDecision {
  verdict: 'pass' | 'skip';
  reason?: PrefilterReason;
  detail?: string;
}

/**
 * 유동성 고갈 판정에 필요한 "말미 무거래 봉" 수.
 * 장중 축이 1h 로 통일됐으므로 1봉 = 실시간 1시간 (구 30m×2봉과 등가).
 */
const LIQUIDITY_DEAD_MIN_ZERO_BARS = 1;

function countTrailingZeroVolumes(candles: Candle[]): number {
  let n = 0;
  for (let i = candles.length - 1; i >= 0; i--) {
    if ((candles[i].volume ?? 0) === 0) n++;
    else break;
  }
  return n;
}

/**
 * 룰 기반 pre-filter — CLI 호출 없이 명백한 거절 케이스를 제거한다.
 * AI가 99% 거절하는 극단 패턴만 대상으로 보수적 임계값 적용.
 * 공격 성향일 때는 역행 관련 룰 비활성화 (프롬프트 few-shot과 정합).
 */
export function prefilterCandidate(
  candidate: Candidate,
  summary: MarketSummary,
  candles: Candle[],
): PrefilterDecision {
  const { side } = candidate;
  const { rsi14, ema20, ema60, atr14, currentPrice, priceChange5, volumeRatio } = summary;

  // 1) 유동성 고갈 (상장폐지 패턴) — **완화 금지. Operation Contract 최우선.**
  //
  // ⚠️ 임계 1은 "느슨해진 것"이 아니라 **시간축 변경에 따른 등가 환산**이다.
  //    구: 30m 캔들 × 2봉 무거래 = 실시간 1시간
  //    신: 1h 캔들 × 1봉 무거래 = 실시간 1시간  ← 동일한 벽시계 기준
  //    (Phase 2 §2 로 장중 축이 30m → 1h 단일화됐다. 임계를 2로 두면 2시간 무거래를
  //     요구하게 되어 상장폐지 패턴 탐지가 **오히려 둔감**해진다.)
  const trailingZero = countTrailingZeroVolumes(candles);
  if (trailingZero >= LIQUIDITY_DEAD_MIN_ZERO_BARS && volumeRatio < 0.15) {
    return { verdict: 'skip', reason: 'liquidity_dead', detail: `trailing zero ${trailingZero} + volRatio ${volumeRatio}` };
  }

  // 2) ATR 0 — 변동성 계산 불가
  if (atr14 == null || atr14 <= 0) {
    return { verdict: 'skip', reason: 'atr_zero', detail: `atr14=${atr14}` };
  }

  // 3) 극단 RSI 역행
  if (rsi14 != null) {
    if (side === 'buy' && rsi14 >= 85) {
      return { verdict: 'skip', reason: 'rsi_extreme_counter', detail: `buy at RSI ${rsi14.toFixed(1)}` };
    }
    if (side === 'sell' && rsi14 <= 15) {
      return { verdict: 'skip', reason: 'rsi_extreme_counter', detail: `sell at RSI ${rsi14.toFixed(1)}` };
    }
  }

  // 4) ⛔ `strong_counter_trend` 삭제 (T-003 §1).
  //
  //    최근 14일 3,028건으로 프리필터 사살의 ~100% 를 차지한 최다 학살자였다.
  //    **전역 추세 게이트는 역추세 룰의 존재 이유와 정면 충돌한다** — rsi-oversold 같은
  //    과매도 반등 룰은 정의상 하락 구간에서 발화하는데, 전역 게이트가 그걸 일괄 차단했다.
  //
  //    대체 방어 (§1):
  //      (a) 추세 조건이 필요한 룰은 자체 보유 — pullback-trend 는 EMA20>EMA60 내장
  //      (b) 역추세 룰은 반등 확인 조건 내장 + regime_gate 가 시장 전체 급락을 차단
  //      (c) losing_position_buy_block 이 물타기를 차단
  //      (d) assist 모드의 사람 승인이 최종 게이트
  void ema20; void ema60;

  // 5) Blow-off top — 급등 + 과열.
  //    구 조건 `priceChange5 > 30` 은 국내 상한가가 30% 라 **도달 불가능한 사문**이었다.
  //    실측 가능한 임계로 교정: 5봉 누적 +10% 초과 && RSI > 80.
  if (side === 'buy' && rsi14 != null && priceChange5 > 10 && rsi14 > 80) {
    return { verdict: 'skip', reason: 'blowoff_top', detail: `p5=${priceChange5.toFixed(1)}%, RSI ${rsi14.toFixed(1)}` };
  }

  void currentPrice; void candles;
  return { verdict: 'pass' };
}

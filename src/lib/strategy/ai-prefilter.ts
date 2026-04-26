import type { Candle } from '@/lib/exchanges/types';
import type { AnalystStyle } from './style';
import type { Candidate, MarketSummary } from './ai-filter';

export type PrefilterReason =
  | 'liquidity_dead'
  | 'atr_zero'
  | 'rsi_extreme_counter'
  | 'strong_counter_trend'
  | 'blowoff_top';

export interface PrefilterDecision {
  verdict: 'pass' | 'skip';
  reason?: PrefilterReason;
  detail?: string;
}

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
  analystStyle: AnalystStyle,
): PrefilterDecision {
  const { side } = candidate;
  const { rsi14, ema20, ema60, atr14, currentPrice, priceChange5, volumeRatio } = summary;

  // 1) 유동성 고갈 (상장폐지 패턴)
  const trailingZero = countTrailingZeroVolumes(candles);
  if (trailingZero >= 2 && volumeRatio < 0.15) {
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

  // 4) 강한 하락 추세에서 매수 (공격 성향은 허용)
  const isAggressive = analystStyle === 'aggressive';
  if (!isAggressive && side === 'buy' && ema20 != null && ema60 != null) {
    if (ema20 < ema60 * 0.97 && priceChange5 < -5) {
      return { verdict: 'skip', reason: 'strong_counter_trend', detail: `EMA20<EMA60*0.97, p5=${priceChange5}%` };
    }
  }

  // 5) Blow-off top — 급등 + 과열
  if (side === 'buy' && rsi14 != null && priceChange5 > 30 && rsi14 > 75) {
    return { verdict: 'skip', reason: 'blowoff_top', detail: `p5=${priceChange5}%, RSI ${rsi14.toFixed(1)}` };
  }

  void currentPrice;
  return { verdict: 'pass' };
}

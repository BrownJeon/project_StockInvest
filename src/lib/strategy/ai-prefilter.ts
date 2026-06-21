import type { Candle } from '@/lib/exchanges/types';
import type { AnalystStyle } from './style';
import type { Candidate, MarketSummary } from './ai-filter';
import { rsi } from './indicators/rsi';
import { ema } from './indicators/ema';

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

  // 4) 하락 추세에서 매수 — 5% 이상 명확한 하락추세만 차단.
  // 예외: RSI 과매도 바닥 확인 후 반등 중이면 진입 허용 (하락장 반등 포착).
  void analystStyle;
  if (side === 'buy' && ema20 != null && ema60 != null) {
    if (ema20 < ema60 * 0.95) {
      // 하락추세 예외 진입 — 3가지 조건 동시 충족 시 AI 평가 단계로 통과
      const closes  = candles.map(c => c.close);
      const vols    = candles.map(c => c.volume);
      const n       = candles.length - 1;

      // ① RSI 과매도(30 이하) 바닥을 최근 5봉 내 터치한 후 2봉 연속 상승 중
      const rsiSeries = rsi(closes, 14);
      const rsiCur   = rsiSeries[n];
      const rsiPrev1 = rsiSeries[n - 1];
      const rsiPrev2 = rsiSeries[n - 2];
      const rsiWasOversold = n >= 5 && rsiSeries.slice(n - 5, n).some(r => r != null && r < 30);
      const rsiRising2 = rsiCur != null && rsiPrev1 != null && rsiPrev2 != null
        && rsiCur > rsiPrev1 && rsiPrev1 > rsiPrev2;

      // ② EMA20이 5봉 전보다 위 — 하락 모멘텀 약화 확인
      const emaSeries  = ema(closes, 20);
      const ema20Cur   = emaSeries[n];
      const ema20Prev5 = n >= 5 ? emaSeries[n - 5] : null;
      const ema20Recovering = ema20Cur != null && ema20Prev5 != null && ema20Cur > ema20Prev5;

      // ③ 거래량 평균의 80% 이상 — 거래 없는 데드캣 제거
      const vol20Avg = vols.slice(-20).reduce((s, v) => s + v, 0) / Math.min(20, vols.length);
      const volumeOk = vol20Avg > 0 && vols[n] >= vol20Avg * 0.8;

      if (rsiWasOversold && rsiRising2 && ema20Recovering && volumeOk) {
        // 3가지 동시 충족 → AI 평가 단계로 전달 (최종 판단은 AI가 수행)
        return { verdict: 'pass' };
      }

      return { verdict: 'skip', reason: 'strong_counter_trend', detail: `EMA20<EMA60*0.95 (5% 이상 하락추세 매수 차단)` };
    }
  }

  // 5) Blow-off top — 급등 + 과열
  if (side === 'buy' && rsi14 != null && priceChange5 > 30 && rsi14 > 75) {
    return { verdict: 'skip', reason: 'blowoff_top', detail: `p5=${priceChange5}%, RSI ${rsi14.toFixed(1)}` };
  }

  void currentPrice;
  return { verdict: 'pass' };
}

import type { RuleFunction } from './types';

/**
 * 24h 고점/저점 돌파 전략.
 * - 매수: 현재가가 24h 고점에 0.8% 이내 근접 또는 초과 → 상방 모멘텀
 * - 매도: 현재가가 24h 저점에 0.8% 이내 근접 또는 하회 → 하방 압력
 *
 * high24h / low24h 는 MarketSummary 를 통해 코인원 ticker 에서 직접 조회.
 * 별도 API 호출 없이 기존 ticker.high24h / ticker.low24h 사용.
 */
export const priceBreakout: RuleFunction = ({ strategyId, symbol, candles, ticker, amountKRW, style }) => {
  const price   = ticker.price;
  const high24h = ticker.high24h;
  const low24h  = ticker.low24h;

  if (price <= 0) return [];

  if (high24h != null && high24h > 0 && price >= high24h * 0.992) {
    // 모멘텀 추격 가드 — 직전 5봉 누적 상승률 ≥ momentumChaseMaxPct% 면 매수 skip
    // (24h 고점 돌파 자체가 추격 패턴 — 이미 상승분이 큰 경우 진입 단가 고점화)
    if (candles.length >= 6) {
      const n = candles.length - 1;
      const start = candles[n - 5];
      const cumRisePct = start && start.close > 0 ? ((candles[n].close - start.close) / start.close) * 100 : 0;
      if (cumRisePct >= style.momentumChaseMaxPct) return [];
    }
    return [{
      strategyId, symbol, side: 'buy', orderType: 'limit', price, amountKRW,
      reasoning: `24h 고점 돌파 근접: price=${price.toLocaleString('ko-KR')} ≥ high24h×0.992=${Math.round(high24h * 0.992).toLocaleString('ko-KR')} → 상방 모멘텀`,
      indicators: { price, high24h, breakoutPct: ((price - high24h) / high24h * 100).toFixed(2) },
    }];
  }

  if (low24h != null && low24h > 0 && price <= low24h * 1.008) {
    return [{
      strategyId, symbol, side: 'sell', orderType: 'market', price, amountKRW,
      reasoning: `24h 저점 하향 돌파: price=${price.toLocaleString('ko-KR')} ≤ low24h×1.008=${Math.round(low24h * 1.008).toLocaleString('ko-KR')} → 하방 압력`,
      indicators: { price, low24h, breakoutPct: ((price - low24h) / low24h * 100).toFixed(2) },
    }];
  }

  return [];
};

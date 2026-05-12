import { atrLast } from '../indicators/atr';
import type { RuleFunction } from './types';

/**
 * 거래량 폭발 + 신고가 돌파 추격 매수 (공격적투자 전용):
 *  - 매수 트리거 (모두 충족):
 *      1) 현재봉 거래량 ≥ 직전 20봉 평균 × 3
 *      2) 종가가 직전 20봉 고가 돌파 (신고가)
 *      3) ATR 이격: (현재가 − 직전 종가) > ATR × 0.5  → 단발 급등 확인
 *      4) 양봉 (close > open)
 *  - 매도 트리거: bb-breakout 등 다른 룰의 청산 신호에 위임 (이 룰 자체엔 매도 없음)
 *
 * 의도: SK하이닉스·펄어비스 같은 +5% 이상 단발 급등을 추격하는 가짜 돌파 회피형 매수.
 *  - 거래량 ×3 가드로 가짜 돌파 회피
 *  - ATR×0.5 이격으로 미미한 흔들림은 거름
 *  - 손절은 ATR×1.0 (style.atrStopMult) — 손실 작게 + 빠른 청산
 *
 * 주의: 추격 매수 본질적으로 "고점 매수" 위험. 분석가가 P_win을 보수적으로
 *       (시장 거시·regime 통계 보고) 평가하도록 위임. EV 음수면 자동 거절.
 */
const LOOKBACK = 20;
const VOL_MULT = 3;
const ATR_GAP_MULT = 0.5;

export const volumeSpikeBreakout: RuleFunction = ({ strategyId, symbol, candles, ticker, amountKRW, style }) => {
  if (candles.length < LOOKBACK + 2) return [];
  // 공격적투자 전용 — rsiSellPriceMult 1.0(기본) 외 변경값이면 비공격 모드 → 스킵
  if (style.rsiSellPriceMult > 1.0) return [];

  const n = candles.length - 1;
  const cur  = candles[n];
  const prev = candles[n - 1];

  // 모멘텀 추격 가드 — 직전 5봉 누적 상승률 ≥ momentumChaseMaxPct% 면 skip
  // (이미 충분히 상승한 후 진입은 평균 단가가 고점 → Dead Zone 직행)
  if (n >= 5) {
    const start = candles[n - 5];
    const cumRisePct = start && start.close > 0 ? ((cur.close - start.close) / start.close) * 100 : 0;
    if (cumRisePct >= style.momentumChaseMaxPct) return [];
  }

  // 양봉 + 거래량 폭발
  if (cur.close <= cur.open) return [];
  const window = candles.slice(n - LOOKBACK, n);  // 직전 20봉 (current 제외)
  const avgVol = window.reduce((s, c) => s + (c.volume || 0), 0) / Math.max(1, window.length);
  if (avgVol <= 0) return [];
  if (cur.volume < avgVol * VOL_MULT) return [];

  // 신고가 돌파 — 직전 20봉 최고가 초과
  const prior20High = Math.max(...window.map(c => c.high));
  if (cur.close <= prior20High) return [];

  // ATR 이격 가드 — 너무 작은 갭은 흔들림으로 간주
  const atr = atrLast(candles.map(c => ({ high: c.high, low: c.low, close: c.close })), 14);
  if (atr == null || atr <= 0) return [];
  const gap = cur.close - prev.close;
  if (gap < atr * ATR_GAP_MULT) return [];

  const price = ticker.price;
  return [{
    strategyId, symbol, side: 'buy', orderType: 'limit', price, amountKRW,
    reasoning: `volume-spike-breakout: vol ${cur.volume.toFixed(0)} ≥ avg×${VOL_MULT}(${(avgVol * VOL_MULT).toFixed(0)}) + close ${cur.close.toFixed(0)} > 20봉 신고가(${prior20High.toFixed(0)}) + ATR 이격 ${gap.toFixed(0)}>${(atr * ATR_GAP_MULT).toFixed(0)}`,
    indicators: {
      volume:        cur.volume,
      avgVolume20:   avgVol,
      volRatio:      cur.volume / avgVol,
      prior20High,
      currentClose:  cur.close,
      atr,
      atrGap:        gap,
      price,
    },
  }];
};

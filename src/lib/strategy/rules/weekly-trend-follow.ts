import { smaLast } from '../indicators/sma';
import { rsiLast } from '../indicators/rsi';
import type { RuleFunction } from './types';

/**
 * 장기 추세 추종 매수 (중립·안정 성향용):
 *  - 매수 트리거 (모두 충족, 일봉 기준):
 *      1) MA60 > MA200  (장기 골든크로스 진행 중 — 명확한 상승 추세)
 *      2) 종가 > MA60   (단기 조정에서도 상승 추세선 유지)
 *      3) RSI(14) < 60  (과열 회피, 진입 여유 있음)
 *      4) MA60 우상향   (현재 MA60 > 5봉 전 MA60)
 *  - 매도 트리거 없음 (장기 보유 가정 — 청산은 다른 룰·분석가 자체 판단)
 *
 * 의도: 코인 단타용 룰들과 달리 **3개월~6개월 보유 가정**의 안정 모드용 핵심 룰.
 *  - 일봉 60·200 MA로 장기 추세 명확화 (단기 노이즈 제거)
 *  - RSI 60 미만 가드로 과열 종목 회피 → 진입 시점 신중
 *  - 한 번 발화되면 분석가가 EV로 평가 후 진입 결정
 *
 * 주의: 일봉 60+200봉 필요 → 최소 200거래일(약 9개월) 이상 시세 필요. 신규 상장주는 미발화.
 */
const MA_FAST = 60;
const MA_SLOW = 200;
const TREND_LOOKBACK = 5;
const RSI_PERIOD = 14;
const RSI_MAX_FOR_ENTRY = 60;

export const weeklyTrendFollow: RuleFunction = ({ strategyId, symbol, candles, ticker, amountKRW }) => {
  if (candles.length < MA_SLOW + TREND_LOOKBACK) return [];

  const closes = candles.map(c => c.close);
  const n = closes.length - 1;
  const cur = candles[n];

  // (1) MA60 > MA200 — 장기 골든크로스 진행 중
  const ma60  = smaLast(closes, MA_FAST);
  const ma200 = smaLast(closes, MA_SLOW);
  if (ma60 == null || ma200 == null || ma60 <= ma200) return [];

  // (2) 종가 > MA60
  if (cur.close <= ma60) return [];

  // (3) RSI 60 미만 — 과열 회피
  const rsi = rsiLast(closes, RSI_PERIOD);
  if (rsi == null || rsi >= RSI_MAX_FOR_ENTRY) return [];

  // (4) MA60 우상향 — 현재 MA60 > N봉 전 MA60
  const ma60Prev = smaLast(closes.slice(0, closes.length - TREND_LOOKBACK), MA_FAST);
  if (ma60Prev == null || ma60 <= ma60Prev) return [];

  const price = ticker.price;
  return [{
    strategyId, symbol, side: 'buy', orderType: 'limit', price, amountKRW,
    reasoning: `weekly-trend-follow: MA60(${ma60.toFixed(0)}) > MA200(${ma200.toFixed(0)}) + 종가 ${cur.close.toFixed(0)} > MA60 + RSI ${rsi.toFixed(1)}<60 + MA60 우상향(${ma60Prev.toFixed(0)}→${ma60.toFixed(0)})`,
    indicators: {
      ma60, ma200, ma60Prev,
      rsi14: rsi,
      close: cur.close,
      price,
    },
  }];
};

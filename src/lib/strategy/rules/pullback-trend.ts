import { smaLast } from '../indicators/sma';
import { emaLast } from '../indicators/ema';
import { rsi } from '../indicators/rsi';
import type { RuleFunction } from './types';

/**
 * 추세 추종 + 눌림목 매수 (공격적투자 전용):
 *  - 매수 트리거 (모두 충족):
 *      1) 종가 > MA20  (상승 추세 진행 중)
 *      2) MA20 우상향  (현재 MA20 > 5봉 전 MA20)
 *      3) EMA20 > EMA60 (중기 상승 추세 확인 — 하락추세 눌림목 오진 방지)
 *      4) 직전 N봉(3) 동안 RSI가 42~48 영역을 한 번 이상 터치 (눌림 발생)
 *      5) 현재봉이 양봉 + RSI 반등 (cur > prev)
 *  - 매도 트리거 없음 — 다른 룰(bb-breakout 청산·rsi-oversold 매도 등)에 위임
 *
 * 의도: SK하이닉스·삼성전자처럼 **명확한 상승 추세 진행 중인 종목의 깊은 눌림목** 진입.
 *  - 추격 매수와 달리 "상승 후 일시 약세" 시점이라 RR 비율 우수
 *  - 손절: ATR×1.0 (style.atrStopMult)
 * 개선 (2026-05-14): 38.1% 적중률 → EMA 추세 조건 추가 + RSI 구간 40~50→42~48 정밀화
 */
const TREND_LOOKBACK = 5;     // MA20 우상향 판정 윈도우
const PULLBACK_LOOKBACK = 3;  // RSI 눌림 발생 윈도우

/**
 * RSI 눌림 창은 `style.pullbackRsiMin/Max` 로 주입된다 (T-003 §3, Phase 2 Step 4).
 * 코드 기본 42~48 은 유지하고, 운영값 40~50 은 DB override(`style_default_pullbackRsi*`)로 적용.
 * 근거: 장중 AI 관문이 사라져 질적 거절이 없어진 만큼 **빈도를 원복**해야 후보가 확보된다.
 */

export const pullbackTrend: RuleFunction = ({ strategyId, symbol, candles, ticker, amountKRW, style }) => {
  if (candles.length < 30) return [];
  // ⛔ 사문 가드 제거 (T-003 §3) — `style.rsiSellPriceMult > 1.0` 은 3-프리셋 시절
  //    "공격적투자 전용" 표식이었다. 2026-05-09 성향 단일화로 이 값은 항상 1.00 이라
  //    조건이 영구 거짓이 됐고, 반대로 누군가 DB 로 이 값을 건드리면 룰이 통째로
  //    조용히 죽는 함정으로만 남았다. 룰 활성 여부는 `strategies.enabled` 가 정한다.

  const RSI_PULLBACK_MIN = style.pullbackRsiMin;
  const RSI_PULLBACK_MAX = style.pullbackRsiMax;

  const n = candles.length - 1;
  const cur  = candles[n];

  // 양봉 가드
  if (cur.close <= cur.open) return [];

  const closes = candles.map(c => c.close);

  // (1) 종가 > MA20
  const ma20 = smaLast(closes, 20);
  if (ma20 == null || cur.close <= ma20) return [];

  // (2) MA20 우상향 — 현재 MA20 > N봉 전 MA20
  const ma20Prev = smaLast(closes.slice(0, closes.length - TREND_LOOKBACK), 20);
  if (ma20Prev == null || ma20 <= ma20Prev) return [];

  // (3) EMA20 > EMA60 — 중기 상승 추세 확인 (하락추세 눌림목 오진 방지)
  const ema20 = emaLast(closes, 20);
  const ema60 = emaLast(closes, 60);
  if (ema20 == null || ema60 == null || ema20 <= ema60) return [];

  // (4) 직전 N봉 동안 RSI 42~48 영역 터치 (눌림목)
  const rsiSeries = rsi(closes, 14);
  const recentRsi = rsiSeries.slice(n - PULLBACK_LOOKBACK, n + 1);
  const touchedPullback = recentRsi.some(
    r => r != null && r >= RSI_PULLBACK_MIN && r <= RSI_PULLBACK_MAX,
  );
  if (!touchedPullback) return [];

  // (4) RSI 반등 — 현재봉 RSI > 직전봉 RSI
  const curRsi = rsiSeries[n];
  const prevRsi = rsiSeries[n - 1];
  if (curRsi == null || prevRsi == null || curRsi <= prevRsi) return [];

  const price = ticker.price;
  return [{
    strategyId, symbol, side: 'buy', orderType: 'limit', price, amountKRW,
    reasoning: `pullback-trend: close ${cur.close.toFixed(0)} > MA20(${ma20.toFixed(0)}) 우상향 + EMA20(${ema20.toFixed(0)})>EMA60(${ema60.toFixed(0)}) 상승추세 + 최근 ${PULLBACK_LOOKBACK}봉 RSI ${RSI_PULLBACK_MIN}~${RSI_PULLBACK_MAX} 눌림 + RSI 반등(${prevRsi.toFixed(1)}→${curRsi.toFixed(1)}) + 양봉`,
    indicators: {
      ma20,
      ma20Prev,
      ema20,
      ema60,
      curRsi,
      prevRsi,
      open:  cur.open,
      close: cur.close,
      price,
    },
  }];
};

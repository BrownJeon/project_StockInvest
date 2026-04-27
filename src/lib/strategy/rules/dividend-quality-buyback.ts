import { smaLast } from '../indicators/sma';
import { atrLast } from '../indicators/atr';
import { rsiLast } from '../indicators/rsi';
import type { RuleFunction } from './types';

/**
 * 배당·자사주 매입 품질주 매수 (안정·중립 모드 전용):
 *
 * **데이터 한계 안내**: 한국투자증권(KIS) OpenAPI는 배당이력·자사주 매입 이벤트를
 * 직접 조회할 수 없다. 따라서 본 룰은 배당·자사주 정보 대신 **시장 행동 프록시**로
 * "장기 안정 우량주" 패턴을 정의한다:
 *
 *  1) 종가 > MA200 (장기 상승 추세선 위) — 펀더멘털 약화 종목 제거
 *  2) MA60 > MA200 (장기 골든크로스 진행) — 일관된 수요
 *  3) ATR%/close < 1.5% (저변동성) — 배당주 특성 (안정적 가격 흐름)
 *  4) RSI(14) 40~65 (과열·과매도 회피) — 균형잡힌 수급
 *  5) 최근 20봉 거래량 평균 > 직전 60봉 평균의 0.7 이상 — 유동성 확보
 *
 * 적용: neutral·stable 성향 (applicable_styles에서 명시). aggressive 모드는 단기 회전이므로 무관.
 *
 * 의도: 안정 모드(3~6개월 보유) 핵심 진입 룰. weekly-trend-follow보다 더 보수적 — 변동성 가드 추가.
 *  - weekly-trend-follow: MA60>MA200 + 종가>MA60 + RSI<60 + MA60 우상향 (추세 추종)
 *  - 본 룰: + 저변동성(ATR%<1.5%) + RSI 40~65 (질적 조건 강화)
 *
 * 주의: 일봉 200봉 필요 (≈ 9개월). 신규 상장주·고변동주 자동 미발화.
 */
const MA_FAST = 60;
const MA_SLOW = 200;
const ATR_PERIOD = 14;
const RSI_PERIOD = 14;
const ATR_PCT_MAX = 0.015;        // 1.5% — 우량 안정주 변동성 상한
const RSI_LOWER = 40;
const RSI_UPPER = 65;
const VOL_LOOKBACK_RECENT = 20;
const VOL_LOOKBACK_BASE = 60;
const VOL_RATIO_MIN = 0.7;

export const dividendQualityBuyback: RuleFunction = ({ strategyId, symbol, candles, ticker, amountKRW }) => {
  if (candles.length < MA_SLOW + 5) return [];

  const closes = candles.map(c => c.close);
  const cur = candles[candles.length - 1];

  // 1) MA60 / MA200 — 장기 추세 정렬
  const ma60  = smaLast(closes, MA_FAST);
  const ma200 = smaLast(closes, MA_SLOW);
  if (ma60 == null || ma200 == null) return [];
  if (cur.close <= ma200) return [];          // 종가 > MA200
  if (ma60 <= ma200) return [];               // MA60 > MA200

  // 2) 저변동성 — ATR%/close 한도
  const atr = atrLast(candles, ATR_PERIOD);
  if (atr == null || atr <= 0) return [];
  const atrPct = atr / cur.close;
  if (atrPct >= ATR_PCT_MAX) return [];

  // 3) RSI 균형 영역
  const rsi = rsiLast(closes, RSI_PERIOD);
  if (rsi == null || rsi < RSI_LOWER || rsi > RSI_UPPER) return [];

  // 4) 유동성 — 최근 20봉 거래량 평균이 60봉 평균의 0.7배 이상
  if (candles.length < VOL_LOOKBACK_BASE) return [];
  const recent = candles.slice(-VOL_LOOKBACK_RECENT);
  const base = candles.slice(-VOL_LOOKBACK_BASE);
  const recentVolAvg = recent.reduce((s, c) => s + (c.volume ?? 0), 0) / recent.length;
  const baseVolAvg   = base.reduce((s, c) => s + (c.volume ?? 0), 0) / base.length;
  if (baseVolAvg <= 0 || recentVolAvg / baseVolAvg < VOL_RATIO_MIN) return [];

  const price = ticker.price;
  return [{
    strategyId, symbol, side: 'buy', orderType: 'limit', price, amountKRW,
    reasoning: `dividend-quality-buyback: 종가 ${cur.close.toFixed(0)} > MA200(${ma200.toFixed(0)}) + MA60(${ma60.toFixed(0)})>MA200 + ATR% ${(atrPct*100).toFixed(2)}%<1.5% + RSI ${rsi.toFixed(1)}∈[40,65] + 거래량 ${(recentVolAvg/baseVolAvg).toFixed(2)}×base`,
    indicators: {
      ma60, ma200, atrPct,
      rsi14: rsi,
      volRatio: recentVolAvg / baseVolAvg,
      close: cur.close,
      price,
    },
  }];
};

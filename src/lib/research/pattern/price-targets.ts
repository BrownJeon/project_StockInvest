/**
 * 차트 지표 기반 매수 희망가 / 매도 목표가 — T-034.
 *
 * ## 🔴 이 모듈이 하지 않는 것
 *
 * **사용자 포지션을 보지 않는다.** 진입가·수량·손익은 인자에 아예 없다.
 * T-033 까지의 목표가는 `진입가 × (1 + 과거평균상승폭)` 이었는데, 물린 종목에서는
 * 현재가 대비 +49% 같은 숫자가 나와 "2주 안에 49% 오른다"는 예측처럼 읽혔다.
 * 사용자 지시(2026-08-21): *"목표가는 현재가도, 진입가도 아닌 현재 차트 분석 지표를 바탕으로
 * 판단해야 한다. 분석은 철저히 분석에 기반해 얼마에·언제까지 사고팔지를 판단해주면 된다."*
 * 진입가보다 싸게 팔지 비싸게 살지는 **사용자가 정하는 것**이고, 분석은 거기에 개입하지 않는다.
 *
 * ## 🔴 통화 단위 (이 파일 최대의 오류 위험 지점)
 *
 * 입력 `DailyCandle` 은 Yahoo 원본이라 **국내는 KRW, 해외는 USD** 다.
 * 반면 `position_state.entry_price` · `fetchCurrentPricesKRW()` 는 **항상 KRW** 다.
 * 두 계열을 한 식에 넣으면 해외 종목에서 1,000배 이상 틀린 값이 조용히 나온다.
 *
 * 채택한 방식: **환산하지 않고 원통화 그대로 계산·표시하고, 통화를 값에 붙여 보낸다.**
 *  - 환산하려면 "분석 기준일의 환율"이 필요한데 우리는 그 시점 환율을 저장하지 않는다.
 *    실시간 환율을 쓰면 종가 기준 차트 레벨에 오늘 환율이 섞여 근거가 흐려진다.
 *  - 볼린저 하단·60일 고점은 사용자가 **원통화 차트에서 보는 그 선**이다. 환산하면 대조가 안 된다.
 *  - 환산이 없으면 KRW·USD 를 섞을 코드 경로 자체가 존재하지 않는다(구조적 차단).
 * 대신 `PriceTargets.currency` 가 항상 따라다니고 화면·리포트가 `$412.50` / `₩70,000` 로
 * 통화를 명시한다. 손익(`gainPct`)만은 KRW끼리 계산하며 이 모듈과 접점이 없다.
 *
 * ## 🔴 기한의 단위
 *
 * `TARGET_HORIZON_DAYS = 14` 는 **달력일**이다(사용자 지시 "기한은 14일"의 자연스러운 해석).
 * 화면 문구·매도 기간 판정이 전부 이 14 하나를 쓴다 — T-033 에서 표시 21일 / 실제 판정 31.5일이
 * 어긋났던 결함의 재발 방지가 목적이다. 거래일 환산은 **ATR 기대변동폭 한 곳**에만 존재한다
 * (캔들이 거래일 단위라 √ 스케일링은 거래일이어야 맞는다). 그 값은
 * `horizonTradingDays` 라는 이름으로 반환값에 드러내 둔다.
 *
 * ## 🔴 자동매매 미연결
 *
 * 여기서 나온 값은 `createSignal()`·`submitOrder()`·`src/lib/strategy/` 로 흘러가지 않는다.
 * 지표 3종(`atr`/`bollinger`/`sma`)은 **import 만** 하며 그 파일들을 수정하지 않는다.
 */
import { atrLast } from '@/lib/strategy/indicators/atr';
import { bollingerLast } from '@/lib/strategy/indicators/bollinger';
import { smaLast } from '@/lib/strategy/indicators/sma';
import type {
  DailyCandle,
  PriceLevel,
  PriceTargets,
  ResearchMarket,
  TargetCurrency,
} from '../types';

/** 분석 기한 — **달력일**. 사용자 지시(2026-08-21) "기한은 14일로 해줘". */
export const TARGET_HORIZON_DAYS = 14;

/** 주 5거래일 가정. 달력일 → 거래일 환산은 **이 파일 안에서만** 일어난다. */
export const TRADING_DAYS_PER_CALENDAR_DAY = 5 / 7;

export const BOLLINGER_PERIOD = 20;
export const BOLLINGER_K = 2;
export const ATR_PERIOD = 14;
/** 지지 후보로 쓸 스윙 저점의 관측 구간(거래일) */
export const SWING_LOW_LOOKBACK = 20;
/** 저항 후보로 쓸 스윙 고점의 관측 구간(거래일) */
export const SWING_HIGH_LOOKBACK = 60;
/** 추세선 겸 지지/저항 후보 */
export const TREND_MA_PERIOD = 60;

/**
 * 이보다 캔들이 적으면 아예 `null` 을 돌려준다.
 *
 * MA60·60거래일 고점을 만들려면 직전 60봉 + 기준봉 1개가 필요하다. 부분적으로만 계산된
 * 목표가(예: 볼린저만 있고 MA60 은 없는 상태)를 내보내면 "무엇을 근거로 고른 레벨인지"가
 * 심볼마다 달라져 사용자가 비교할 수 없다. 전부 되거나 아무것도 안 되거나 둘 중 하나로 둔다.
 */
export const MIN_CANDLES_FOR_TARGETS = SWING_HIGH_LOOKBACK + 1;

/** 달력일 → 거래일(최소 1). √ 스케일링 전용. */
export function toTradingDays(calendarDays: number): number {
  return Math.max(1, Math.round(calendarDays * TRADING_DAYS_PER_CALENDAR_DAY));
}

/**
 * 시장 → 캔들 통화.
 * 해외는 KIS 가 지원하는 NASDAQ/NYSE/AMEX 뿐이라 전부 USD 다(`OverseasExchange` 참조).
 * 다른 통화권 거래소가 추가되면 **여기부터 고쳐야 한다** — 이 함수가 유일한 판별 지점이다.
 */
export function currencyForMarket(market: ResearchMarket): TargetCurrency {
  return market === 'overseas' ? 'USD' : 'KRW';
}

/** 통화까지 붙인 표시 문자열. 화면·텔레그램 리포트가 같은 함수를 쓴다(표기 불일치 방지). */
export function formatTargetPrice(
  price: number | null | undefined,
  currency: TargetCurrency | null | undefined,
): string {
  if (price == null || !Number.isFinite(price)) return '—';
  if (currency === 'USD') {
    return '$' + price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return '₩' + Math.round(price).toLocaleString('ko-KR');
}

function isPositiveFinite(v: number | null | undefined): v is number {
  return v != null && Number.isFinite(v) && v > 0;
}

/**
 * 스윙 저점/고점은 **기준봉을 빼고** 직전 `lookback` 봉에서 뽑는다.
 *
 * 기준봉을 포함하면 그날의 low 는 정의상 종가 이하이므로 "가장 가까운 지지선"이 항상 오늘의
 * 저가가 되어 버린다(고점도 대칭으로 같은 문제). 그러면 지지·저항이 매일 현재가에 달라붙어
 * 아무 정보도 주지 못한다. 직전 구간에서 뽑으면 "오늘 신저가를 깨는 중이면 아래 지지 후보가
 * 없다"는 사실이 그대로 드러난다 — 이건 결측이 아니라 관측 결과다.
 */
function priorExtreme(
  candles: DailyCandle[],
  lookback: number,
  kind: 'low' | 'high',
): number | null {
  const end = candles.length - 1;              // 기준봉 인덱스 (제외 대상)
  const start = end - lookback;
  if (start < 0) return null;
  let out: number | null = null;
  for (let i = start; i < end; i++) {
    const v = kind === 'low' ? candles[i].low : candles[i].high;
    if (!isPositiveFinite(v)) continue;
    if (out == null) out = v;
    else out = kind === 'low' ? Math.min(out, v) : Math.max(out, v);
  }
  return out;
}

interface Candidate {
  price: number | null;
  basis: string;
}

/** 후보 중 기준가 **아래**에서 가장 가까운 것(= 가장 먼저 닿을 지지선). */
function nearestBelow(asOfPrice: number, candidates: Candidate[]): PriceLevel | null {
  let best: PriceLevel | null = null;
  for (const c of candidates) {
    if (!isPositiveFinite(c.price) || c.price >= asOfPrice) continue;
    if (best === null || c.price > best.price) best = { price: c.price, basis: c.basis };
  }
  return best;
}

/** 후보 중 기준가 **위**에서 가장 가까운 것(= 가장 먼저 닿을 저항선). */
function nearestAbove(asOfPrice: number, candidates: Candidate[]): PriceLevel | null {
  let best: PriceLevel | null = null;
  for (const c of candidates) {
    if (!isPositiveFinite(c.price) || c.price <= asOfPrice) continue;
    if (best === null || c.price < best.price) best = { price: c.price, basis: c.basis };
  }
  return best;
}

/**
 * 기한 내 도달 가능성 게이트.
 *
 * `|target - asOfPrice| ≤ ATR14 × √(기한 거래일)` 이면 도달 가능으로 본다.
 * 넘으면 소비자(화면·리포트)는 **목표가 숫자를 표시하지 않고** "기한 내 도달 근거 없음"으로
 * 대체한다. 사용자가 원래 제기한 문제("변동성이 커서 타이밍을 잡을 수 없다")에 대한 해법이
 * 기한 길이 조정이 아니라 이 게이트다 — 근거 없는 숫자를 아예 만들지 않는 것.
 *
 * `expectedMove` 를 못 구했으면 `false`(도달 불가)가 아니라 `null`(판단 불가)이다.
 */
function reachable(
  asOfPrice: number,
  level: PriceLevel | null,
  expectedMove: number | null,
): boolean | null {
  if (level === null) return null;
  if (expectedMove == null) return null;
  return Math.abs(level.price - asOfPrice) <= expectedMove;
}

export interface ComputePriceTargetsOptions {
  /** 캔들의 통화. `currencyForMarket()` 로 만든다 — 임의로 지정하지 말 것 */
  currency: TargetCurrency;
  /** 분석 기한(달력일). 기본 `TARGET_HORIZON_DAYS` */
  horizonDays?: number;
}

/**
 * 캔들만으로 지지·저항을 산출하는 **순수 함수**. 포지션·환율·DB 접근 없음.
 *
 * 지지 후보(기준가 아래): 볼린저(20,2) 하단 / 직전 20거래일 저점 / MA60
 * 저항 후보(기준가 위)  : 볼린저(20,2) 상단 / 직전 60거래일 고점 / MA60
 * 각각 기준가에 **가장 가까운 것**을 채택한다 — 기한 내 가장 먼저 닿을 레벨이기 때문이다.
 */
export function computePriceTargets(
  candles: DailyCandle[] | null | undefined,
  opts: ComputePriceTargetsOptions,
): PriceTargets | null {
  if (!candles || candles.length < MIN_CANDLES_FOR_TARGETS) return null;

  const last = candles[candles.length - 1];
  const asOfPrice = last?.close;
  if (!isPositiveFinite(asOfPrice)) return null;

  const horizonDays = opts.horizonDays ?? TARGET_HORIZON_DAYS;
  if (!isPositiveFinite(horizonDays)) return null;
  const horizonTradingDays = toTradingDays(horizonDays);

  const closes = candles.map((c) => c.close);
  const bb = bollingerLast(closes, BOLLINGER_PERIOD, BOLLINGER_K);
  const ma = smaLast(closes, TREND_MA_PERIOD);
  const swingLow = priorExtreme(candles, SWING_LOW_LOOKBACK, 'low');
  const swingHigh = priorExtreme(candles, SWING_HIGH_LOOKBACK, 'high');

  // ATR 은 캔들 통화 그대로다 — 아래 expectedMove·목표가 비교가 전부 같은 통화라는 뜻이다.
  const atr14 = atrLast(candles, ATR_PERIOD);
  const expectedMove = isPositiveFinite(atr14) ? atr14 * Math.sqrt(horizonTradingDays) : null;

  const maBasis = `${TREND_MA_PERIOD}일 이동평균`;
  const buyZone = nearestBelow(asOfPrice, [
    { price: bb.lower, basis: `볼린저 하단(${BOLLINGER_PERIOD},${BOLLINGER_K})` },
    { price: swingLow, basis: `최근 ${SWING_LOW_LOOKBACK}거래일 저점` },
    { price: ma, basis: maBasis },
  ]);
  const sellTarget = nearestAbove(asOfPrice, [
    { price: bb.upper, basis: `볼린저 상단(${BOLLINGER_PERIOD},${BOLLINGER_K})` },
    { price: swingHigh, basis: `최근 ${SWING_HIGH_LOOKBACK}거래일 고점` },
    { price: ma, basis: maBasis },
  ]);

  return {
    asOfDate: last.date ?? null,
    asOfPrice,
    currency: opts.currency,
    atr14: isPositiveFinite(atr14) ? atr14 : null,
    expectedMove,
    buyZone,
    sellTarget,
    buyReachable: reachable(asOfPrice, buyZone, expectedMove),
    sellReachable: reachable(asOfPrice, sellTarget, expectedMove),
    horizonDays,
    horizonTradingDays,
  };
}

/** 화면·리포트에 목표가 **숫자**를 띄워도 되는가 — 도달 근거가 확인된 레벨만 통과한다. */
export function displayableBuyZone(t: PriceTargets | null | undefined): PriceLevel | null {
  if (!t || t.buyZone == null || t.buyReachable !== true) return null;
  return t.buyZone;
}

export function displayableSellTarget(t: PriceTargets | null | undefined): PriceLevel | null {
  if (!t || t.sellTarget == null || t.sellReachable !== true) return null;
  return t.sellTarget;
}

/** 표시 불가 사유 — 숫자를 감출 때 그 자리에 대신 쓸 한국어 문구. */
export function unreachableReasonKo(
  t: PriceTargets | null | undefined,
  side: 'buy' | 'sell',
): string {
  if (!t) return '차트 데이터 부족';
  const level = side === 'buy' ? t.buyZone : t.sellTarget;
  if (level == null) {
    return side === 'buy'
      ? '현재가 아래 지지 근거 없음'
      : '현재가 위 저항 근거 없음';
  }
  const flag = side === 'buy' ? t.buyReachable : t.sellReachable;
  if (flag === null) return '변동폭(ATR) 산출 불가';
  return `${t.horizonDays}일 내 도달 근거 없음`;
}

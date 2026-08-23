/**
 * 차트 기반 목표가 — T-034.
 *
 * 이 스위트가 지키는 것:
 *  1. **포지션 독립성** — 입력은 캔들뿐이다. 진입가를 넣을 자리 자체가 없다(시그니처로 고정)
 *  2. 지지·저항은 "현재가에 가장 가까운 후보"를 고른다
 *  3. 기한 내 기대 변동폭(ATR×√거래일)을 넘는 목표가는 도달 불가로 표시된다
 *  4. 캔들이 모자라면 부분값이 아니라 `null`
 *  5. 통화는 시장이 결정하고, 표시 문자열까지 그대로 따라간다(KRW/USD 혼용 금지)
 */
import {
  ATR_PERIOD,
  BOLLINGER_PERIOD,
  MIN_CANDLES_FOR_TARGETS,
  SWING_HIGH_LOOKBACK,
  SWING_LOW_LOOKBACK,
  TARGET_HORIZON_DAYS,
  TREND_MA_PERIOD,
  computePriceTargets,
  currencyForMarket,
  displayableBuyZone,
  displayableSellTarget,
  formatTargetPrice,
  toTradingDays,
  unreachableReasonKo,
} from '../pattern/price-targets';
import type { DailyCandle } from '../types';

/** 종가 배열 → 캔들. high/low 는 종가 ±`spread`(기본 0). 기준봉만 따로 조정할 수 있다. */
function candlesFrom(closes: number[], spread = 0): DailyCandle[] {
  return closes.map((v, i) => ({
    date: new Date(Date.UTC(2024, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
    open: v,
    high: v + spread,
    low: v - spread,
    close: v,
    volume: 1_000,
  }));
}

/** 완전 평탄 → 표준편차 0, ATR 0. 지표 경계를 확인할 때 쓴다. */
const flat = (n: number, price = 100) => candlesFrom(new Array(n).fill(price));

/** 결정적 톱니 시계열 — 변동성이 있고 지지·저항 후보가 모두 생긴다. */
function sawtooth(n: number, base = 100, amp = 5, period = 10): DailyCandle[] {
  const closes: number[] = [];
  for (let i = 0; i < n; i++) {
    closes.push(base + amp * Math.sin((2 * Math.PI * i) / period));
  }
  return candlesFrom(closes, 0.5);
}

describe('상수·단위', () => {
  test('기한은 달력일 14일이며 거래일 환산은 10일이다', () => {
    expect(TARGET_HORIZON_DAYS).toBe(14);
    // 🔴 화면·판정에 쓰는 숫자는 14 하나뿐이고, 거래일 10 은 √ 스케일링 내부에서만 쓴다.
    expect(toTradingDays(TARGET_HORIZON_DAYS)).toBe(10);
  });

  test('거래일 환산은 최소 1일로 바닥을 친다(0 이 되면 √0=0 이라 게이트가 무너진다)', () => {
    expect(toTradingDays(1)).toBe(1);
    expect(toTradingDays(0.1)).toBe(1);
  });

  test('🔴 통화는 시장이 결정한다 — 해외(NASDAQ/NYSE/AMEX)는 전부 USD', () => {
    expect(currencyForMarket('domestic')).toBe('KRW');
    expect(currencyForMarket('overseas')).toBe('USD');
  });
});

describe('formatTargetPrice — 통화 기호가 값에 항상 붙는다', () => {
  test('KRW 는 원 단위 반올림, USD 는 소수 2자리', () => {
    expect(formatTargetPrice(70_123.4, 'KRW')).toBe('₩70,123');
    expect(formatTargetPrice(412.5, 'USD')).toBe('$412.50');
    expect(formatTargetPrice(1_234.567, 'USD')).toBe('$1,234.57');
  });
  test('값이 없으면 숫자를 지어내지 않는다', () => {
    expect(formatTargetPrice(null, 'USD')).toBe('—');
    expect(formatTargetPrice(Number.NaN, 'KRW')).toBe('—');
  });
});

describe('computePriceTargets — 입력 방어', () => {
  test(`캔들이 ${MIN_CANDLES_FOR_TARGETS}봉 미만이면 부분값이 아니라 null`, () => {
    expect(computePriceTargets(sawtooth(MIN_CANDLES_FOR_TARGETS - 1), { currency: 'KRW' })).toBeNull();
    expect(computePriceTargets([], { currency: 'KRW' })).toBeNull();
    expect(computePriceTargets(null, { currency: 'KRW' })).toBeNull();
  });

  test('최소 봉수를 채우면 산출된다', () => {
    expect(computePriceTargets(sawtooth(MIN_CANDLES_FOR_TARGETS), { currency: 'KRW' })).not.toBeNull();
  });

  test('최소 봉수는 MA60·60거래일 고점을 만들 수 있는 값이다', () => {
    expect(MIN_CANDLES_FOR_TARGETS).toBe(SWING_HIGH_LOOKBACK + 1);
    expect(MIN_CANDLES_FOR_TARGETS).toBeGreaterThan(TREND_MA_PERIOD);
    expect(MIN_CANDLES_FOR_TARGETS).toBeGreaterThan(BOLLINGER_PERIOD);
    expect(MIN_CANDLES_FOR_TARGETS).toBeGreaterThan(ATR_PERIOD);
  });

  test('기준일 종가가 0/음수면 null(0 나눗셈·음수 목표가 방지)', () => {
    const c = sawtooth(120);
    c[c.length - 1] = { ...c[c.length - 1], close: 0 };
    expect(computePriceTargets(c, { currency: 'KRW' })).toBeNull();
  });
});

describe('computePriceTargets — 지지·저항 선택', () => {
  test('기준일·기준가는 마지막 캔들에서 나온다', () => {
    const c = sawtooth(200);
    const t = computePriceTargets(c, { currency: 'USD' })!;
    expect(t.asOfDate).toBe(c[c.length - 1].date);
    expect(t.asOfPrice).toBe(c[c.length - 1].close);
    expect(t.currency).toBe('USD');
    expect(t.horizonDays).toBe(TARGET_HORIZON_DAYS);
    expect(t.horizonTradingDays).toBe(toTradingDays(TARGET_HORIZON_DAYS));
  });

  test('매수 희망가는 기준가 **아래**, 매도 목표가는 기준가 **위**에 있다', () => {
    const t = computePriceTargets(sawtooth(300), { currency: 'KRW' })!;
    if (t.buyZone) expect(t.buyZone.price).toBeLessThan(t.asOfPrice);
    if (t.sellTarget) expect(t.sellTarget.price).toBeGreaterThan(t.asOfPrice);
  });

  test('후보 중 기준가에 가장 가까운 것을 고른다 — 근거 라벨을 함께 돌려준다', () => {
    const t = computePriceTargets(sawtooth(300), { currency: 'KRW' })!;
    const known = [
      `볼린저 하단(${BOLLINGER_PERIOD},2)`,
      `최근 ${SWING_LOW_LOOKBACK}거래일 저점`,
      `${TREND_MA_PERIOD}일 이동평균`,
      `볼린저 상단(${BOLLINGER_PERIOD},2)`,
      `최근 ${SWING_HIGH_LOOKBACK}거래일 고점`,
    ];
    if (t.buyZone) expect(known).toContain(t.buyZone.basis);
    if (t.sellTarget) expect(known).toContain(t.sellTarget.basis);
  });

  test('🔴 스윙 고저는 기준봉을 제외해서 뽑는다 — 안 그러면 지지선이 항상 오늘 저가가 된다', () => {
    // 계속 하락하는 시계열: 마지막 봉이 최저가라 "20거래일 저점"에 기준봉이 포함되면
    // 지지선 = 오늘의 low 가 되어 사실상 현재가에 달라붙는다.
    const closes = Array.from({ length: 200 }, (_, i) => 200 - i * 0.5);
    const c = candlesFrom(closes, 0.4);
    const t = computePriceTargets(c, { currency: 'KRW' })!;
    // 오늘 저가(= close-0.4)가 지지선으로 잡히면 안 된다.
    if (t.buyZone) expect(t.buyZone.price).not.toBeCloseTo(c[c.length - 1].low, 6);
  });

  test('신저가를 깨는 중이면 아래 지지 후보가 없을 수 있다 — 없다는 사실을 그대로 돌려준다', () => {
    // 199봉 평탄(100) 후 마지막 봉만 급락(80) → 볼린저 하단·직전 20일 저점·MA60 이 전부 현재가 위
    const c = flat(200);
    c[199] = { ...c[199], close: 80, open: 100, high: 100, low: 80 };
    const t = computePriceTargets(c, { currency: 'KRW' })!;
    expect(t.buyZone).toBeNull();
    expect(t.buyReachable).toBeNull();
    expect(unreachableReasonKo(t, 'buy')).toBe('현재가 아래 지지 근거 없음');
    expect(displayableBuyZone(t)).toBeNull();
    // 반대쪽(저항)은 정상적으로 잡힌다 — "데이터 없음"이 아니라 한쪽만 없는 상태다
    expect(t.sellTarget).not.toBeNull();
  });

  test('신고가를 뚫는 중이면 위 저항 후보가 없다 — 매도 판정의 "저항선 도달" 조건', () => {
    const c = flat(200);
    c[199] = { ...c[199], close: 120, open: 100, high: 120, low: 100 };
    const t = computePriceTargets(c, { currency: 'KRW' })!;
    expect(t.sellTarget).toBeNull();
    expect(t.sellReachable).toBeNull();
    expect(unreachableReasonKo(t, 'sell')).toBe('현재가 위 저항 근거 없음');
    expect(displayableSellTarget(t)).toBeNull();
  });
});

describe('computePriceTargets — 도달 가능성 게이트', () => {
  test('기대 변동폭 = ATR14 × √(기한 거래일)', () => {
    const t = computePriceTargets(sawtooth(300), { currency: 'KRW' })!;
    expect(t.atr14).not.toBeNull();
    expect(t.expectedMove).toBeCloseTo(t.atr14! * Math.sqrt(t.horizonTradingDays), 8);
  });

  test('기한을 늘리면 기대 변동폭도 √ 로 늘어난다(같은 캔들, 같은 ATR)', () => {
    const c = sawtooth(300);
    const short = computePriceTargets(c, { currency: 'KRW', horizonDays: 14 })!;
    const long = computePriceTargets(c, { currency: 'KRW', horizonDays: 28 })!;
    expect(long.atr14).toBeCloseTo(short.atr14!, 8);
    expect(long.expectedMove! / short.expectedMove!)
      .toBeCloseTo(Math.sqrt(long.horizonTradingDays / short.horizonTradingDays), 8);
  });

  test('기대 변동폭 안이면 도달 가능, 밖이면 도달 불가로 표시하고 숫자를 감춘다', () => {
    const t = computePriceTargets(sawtooth(300), { currency: 'KRW' })!;
    for (const side of ['buy', 'sell'] as const) {
      const level = side === 'buy' ? t.buyZone : t.sellTarget;
      const flag = side === 'buy' ? t.buyReachable : t.sellReachable;
      if (level == null) { expect(flag).toBeNull(); continue; }
      expect(flag).toBe(Math.abs(level.price - t.asOfPrice) <= t.expectedMove!);
      const displayable = side === 'buy' ? displayableBuyZone(t) : displayableSellTarget(t);
      expect(displayable != null).toBe(flag === true);
    }
  });

  test('🔴 변동성이 0이면 기대 변동폭을 0으로 쓰지 않고 "산출 불가"(null)로 둔다', () => {
    // ATR=0 을 그대로 쓰면 "±0 안에서만 도달 가능"이라는 가짜 정밀도가 생긴다.
    const t = computePriceTargets(flat(200), { currency: 'KRW' })!;
    expect(t.atr14).toBeNull();
    expect(t.expectedMove).toBeNull();
    // 평탄 시계열은 지지·저항 후보도 전부 현재가와 같아 채택되지 않는다(엄격 부등호)
    expect(t.buyZone).toBeNull();
    expect(t.sellTarget).toBeNull();
    expect(displayableBuyZone(t)).toBeNull();
    expect(displayableSellTarget(t)).toBeNull();
  });

  test('레벨은 있는데 ATR 을 못 구하면 도달 여부는 false 가 아니라 null(판단 불가)이다', () => {
    const t = {
      asOfDate: '2026-08-20', asOfPrice: 100, currency: 'KRW' as const,
      atr14: null, expectedMove: null,
      buyZone: { price: 95, basis: '볼린저 하단(20,2)' },
      sellTarget: { price: 108, basis: '볼린저 상단(20,2)' },
      buyReachable: null, sellReachable: null,
      horizonDays: 14, horizonTradingDays: 10,
    };
    expect(displayableBuyZone(t)).toBeNull();
    expect(unreachableReasonKo(t, 'buy')).toBe('변동폭(ATR) 산출 불가');
  });

  test('목표가 자체가 없을 때와 기한 내 도달 불가일 때의 문구를 구분한다', () => {
    const t = {
      asOfDate: '2026-08-20', asOfPrice: 100, currency: 'USD' as const,
      atr14: 1, expectedMove: 1,
      buyZone: { price: 50, basis: '볼린저 하단(20,2)' }, sellTarget: null,
      buyReachable: false, sellReachable: null,
      horizonDays: 14, horizonTradingDays: 10,
    };
    expect(unreachableReasonKo(t, 'buy')).toBe('14일 내 도달 근거 없음');
    expect(unreachableReasonKo(t, 'sell')).toBe('현재가 위 저항 근거 없음');
    expect(unreachableReasonKo(null, 'buy')).toBe('차트 데이터 부족');
  });
});

describe('🔴 포지션 독립성 — 이 모듈은 사용자 포지션을 볼 수 없다', () => {
  test('같은 캔들이면 결과가 항상 같다(진입가·보유수량이 개입할 자리가 없다)', () => {
    const c = sawtooth(300);
    expect(computePriceTargets(c, { currency: 'KRW' }))
      .toEqual(computePriceTargets(c, { currency: 'KRW' }));
  });

  test('통화만 바꿔도 가격 숫자는 그대로다 — 환산하지 않는다는 계약', () => {
    const c = sawtooth(300);
    const krw = computePriceTargets(c, { currency: 'KRW' })!;
    const usd = computePriceTargets(c, { currency: 'USD' })!;
    expect(usd.asOfPrice).toBe(krw.asOfPrice);
    expect(usd.buyZone?.price).toBe(krw.buyZone?.price);
    expect(usd.sellTarget?.price).toBe(krw.sellTarget?.price);
    expect(usd.currency).toBe('USD');
  });
});

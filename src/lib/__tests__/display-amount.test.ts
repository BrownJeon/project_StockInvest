/**
 * T-035 — 종목별 금액의 달러 표기. **환산이 일어나는 유일한 지점**의 계약 검증.
 *
 * 검증 관점:
 *  - 환율은 오직 **같은 시점 시세 쌍**(KRW/USD)에서만 나온다 — 외부 환율을 끌어오지 않는다
 *  - 국내 종목은 환산 경로에 아예 들어가지 않는다
 *  - 역산 불가(USD 결측·0·음수·시세 없음)면 **KRW 폴백**이며 그 사실이 값에 드러난다
 *  - 🔴 통화 혼용 회귀: 환율이 바뀌어도 KRW 값은 불변, USD 값은 환율에 **정확히 비례**한다
 */
import {
  isFxConverted,
  isFxFallback,
  toDisplayAmount,
  usdPerKrwFromQuote,
  type SymbolQuote,
} from '../display-amount';

/** NAS:SNPS 실사례 근사 — KRW 553,109 / USD 397.92 (환율 ≈ 1,390) */
const SNPS: SymbolQuote = { krw: 553_109, usd: 397.92 };
const DOMESTIC: SymbolQuote = { krw: 70_000, usd: null };

describe('usdPerKrwFromQuote — 환율은 시세 쌍에서만 나온다', () => {
  test('KRW/USD 쌍에서 그 시세에 실제 적용된 환율을 얻는다', () => {
    const rate = usdPerKrwFromQuote(SNPS)!;
    expect(1 / rate).toBeCloseTo(1_390.0, 0);   // 원/달러
  });

  test.each<[string, SymbolQuote | null]>([
    ['시세 자체가 없음', null],
    ['USD 결측(국내 종목)', DOMESTIC],
    ['USD 가 0', { krw: 553_109, usd: 0 }],
    ['USD 가 음수', { krw: 553_109, usd: -1 }],
    ['KRW 가 0', { krw: 0, usd: 397.92 }],
    ['KRW 가 NaN', { krw: Number.NaN, usd: 397.92 }],
    ['USD 가 NaN', { krw: 553_109, usd: Number.NaN }],
  ])('%s 이면 환율을 만들지 않는다(null)', (_label, q) => {
    expect(usdPerKrwFromQuote(q)).toBeNull();
  });
});

describe('toDisplayAmount — 국내 종목', () => {
  test('🔴 원화가 원통화다 — 환산 경로에 들어가지 않는다', () => {
    const d = toDisplayAmount(669_858, 'KRW', DOMESTIC);
    expect(d).toEqual({ value: 669_858, currency: 'KRW', basis: 'krw_native', sourceKRW: 669_858 });
    expect(isFxConverted(d)).toBe(false);
    expect(isFxFallback(d)).toBe(false);
  });

  test('USD 시세가 함께 와도 국내 종목이면 환산하지 않는다', () => {
    const d = toDisplayAmount(70_000, 'KRW', SNPS);
    expect(d.currency).toBe('KRW');
    expect(d.value).toBe(70_000);
  });
});

describe('toDisplayAmount — 해외 종목 (진입가 역산)', () => {
  test('🔴 진입가 KRW 669,858 → 시세 쌍 환율로 달러 환산', () => {
    const d = toDisplayAmount(669_858, 'USD', SNPS);
    expect(d.currency).toBe('USD');
    expect(d.basis).toBe('usd_converted');
    // 669,858 × (397.92 / 553,109) ≈ 481.9
    expect(d.value!).toBeCloseTo(669_858 * (397.92 / 553_109), 6);
    expect(d.value!).toBeGreaterThan(400);
    expect(d.value!).toBeLessThan(600);
  });

  test('환산본은 원화 원본을 함께 들고 다닌다 — 화면이 "지어낸 숫자가 아님"을 보일 수 있게', () => {
    const d = toDisplayAmount(669_858, 'USD', SNPS);
    expect(d.sourceKRW).toBe(669_858);
    expect(isFxConverted(d)).toBe(true);
  });

  test('현재가 자신을 넘기면 시세의 USD 원가와 같은 값이 된다(항등)', () => {
    const d = toDisplayAmount(SNPS.krw, 'USD', SNPS);
    expect(d.value!).toBeCloseTo(SNPS.usd!, 9);
  });
});

describe('toDisplayAmount — 역산 불가 시 KRW 폴백', () => {
  test.each<[string, SymbolQuote | null]>([
    ['시세 조회 실패', null],
    ['USD 원가 결측', { krw: 553_109, usd: null }],
    ['USD 원가 0', { krw: 553_109, usd: 0 }],
  ])('%s — 통화 기호만 바꾸지 않고 원화로 되돌린다', (_label, q) => {
    const d = toDisplayAmount(669_858, 'USD', q);
    expect(d.currency).toBe('KRW');
    expect(d.value).toBe(669_858);
    expect(isFxFallback(d)).toBe(true);
    expect(isFxConverted(d)).toBe(false);
  });

  test('🔴 폴백은 "숫자를 지어내지 않는다" — 값이 원본 그대로다', () => {
    expect(toDisplayAmount(669_858, 'USD', null).value).toBe(669_858);
  });

  test('금액 자체가 없으면 값도 없다(0 으로 얼버무리지 않는다)', () => {
    for (const bad of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(toDisplayAmount(bad as number | null, 'USD', SNPS).value).toBeNull();
      expect(toDisplayAmount(bad as number | null, 'KRW', DOMESTIC).value).toBeNull();
    }
  });
});

describe('🔴 통화 혼용 회귀 — 차원 일관성 (T-034 안전망 유지)', () => {
  /**
   * KRW·USD 를 더하거나 비교하는 코드가 섞여 들어오면 **반드시 깨지는** 성질을 고정한다.
   *
   *  - 환율을 k 배로 바꿔도 KRW 표시값은 **한 톨도** 변하지 않는다
   *  - USD 표시값은 환율에 **정확히 비례**한다 (상수항이 끼면 비례가 깨진다 = KRW 가 섞인 것)
   */
  const scaled = (k: number): SymbolQuote => ({ krw: SNPS.krw, usd: SNPS.usd! * k });

  test('환율이 두 배가 되어도 국내(KRW) 표시값은 그대로다', () => {
    const a = toDisplayAmount(669_858, 'KRW', scaled(1));
    const b = toDisplayAmount(669_858, 'KRW', scaled(2));
    expect(a.value).toBe(b.value);
  });

  test('해외(USD) 표시값은 환율에 정확히 비례한다 — 상수(KRW) 항이 끼면 실패한다', () => {
    const base = toDisplayAmount(669_858, 'USD', scaled(1)).value!;
    for (const k of [0.5, 1.37, 2, 10]) {
      expect(toDisplayAmount(669_858, 'USD', scaled(k)).value!).toBeCloseTo(base * k, 6);
    }
  });

  test('금액을 k 배 하면 표시값도 정확히 k 배 — 환율 상수항이 끼면 실패한다', () => {
    const one = toDisplayAmount(1_000, 'USD', SNPS).value!;
    expect(toDisplayAmount(3_000, 'USD', SNPS).value!).toBeCloseTo(one * 3, 9);
  });
});

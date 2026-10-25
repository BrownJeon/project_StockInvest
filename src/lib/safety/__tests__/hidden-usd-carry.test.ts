/**
 * T-080 — `assessHiddenUsdCarry` 순수 함수 시험.
 *
 * 픽스처는 **비율 단위**다(기준선 총액 = 100). 실제 금액·종목·수량을 쓰지 않는다. USD 행 가격(환율 자리)은 2.
 * 종목 코드는 자리표시자(US1·US2·DOM1).
 */
import {
  assessHiddenUsdCarry, hasHiddenUsdRow, HIDDEN_USD_CARRY_WINDOW_HOURS, HIDDEN_USD_SUPPRESS_MARGIN,
  type CarryPrior, type CarryTarget,
} from '@/lib/safety/hidden-usd-carry';
import type { CompositionPosition } from '@/lib/safety/snapshot-composition';

const HOUR = 60 * 60_000;
const T0 = new Date('2026-10-23T13:42:00Z').getTime();   // 현재 시각 자리 (값 자체는 의미 없음)
const at = (msAgo: number) => new Date(T0 - msAgo);

const pos = (currency: string, value: number): CompositionPosition => ({ currency, qty: 1, price: value, value_krw: value });
const usd = (qty: number, price = 2): CompositionPosition => ({ currency: 'USD', qty, price, value_krw: qty * price });
const target = (ts: Date, total: number, positions: CompositionPosition[] | null): CarryTarget => ({ ts, total, positions });
const prior = (ts: Date, positions: unknown): CarryPrior => ({ ts, positions });

// ── 10-23 사건 재현 (비율) ────────────────────────────────────────────────
const BASE_TS = at(24 * HOUR);
const CUR_TS = at(5 * 60_000);
const incidentBase = target(BASE_TS, 100, [pos('KRW', 9.3), usd(0), pos('US1', 40), pos('US2', 36.5), pos('DOM1', 14.2)]);
const incidentCur = target(CUR_TS, 87.9, [pos('KRW', 13.7), usd(0), pos('US1', 39), pos('US2', 35.2)]);
const incidentPriors: CarryPrior[] = [
  // 기준선 쪽: 16.5시간 전에 USD 2.2 상당이 보였고 그 뒤로 가려짐
  prior(new Date(BASE_TS.getTime() - 16.5 * HOUR), JSON.stringify([pos('KRW', 9.3), usd(1.1), pos('US1', 40.5), pos('US2', 36), pos('DOM1', 14)])),
  prior(new Date(BASE_TS.getTime() - 6 * HOUR), JSON.stringify([pos('KRW', 9.3), usd(0), pos('US1', 40), pos('US2', 36.5), pos('DOM1', 14.2)])),
  // 현재 쪽: 8.3시간 전에 USD 11.4 상당(환전 반영)이 보였고 그 뒤로 가려짐
  // (국내 DOM1 은 그 뒤 매도 — 수량 감소는 구매 증거가 아니다)
  prior(new Date(CUR_TS.getTime() - 8.3 * HOUR), [pos('KRW', 3.0), usd(5.7), pos('US1', 39.5), pos('US2', 35.6), pos('DOM1', 14.2)]),
  prior(new Date(CUR_TS.getTime() - 2 * HOUR), [pos('KRW', 13.7), usd(0), pos('US1', 39), pos('US2', 35.2)]),
];

describe('assessHiddenUsdCarry — 설계 v1 근거 사례', () => {
  test('🔴 10-23 사건: 양쪽 가려짐 → 대칭 이월, 원시 -12.1% → 보정 약 -2.8% → 보류 가능', () => {
    const r = assessHiddenUsdCarry({ baseline: incidentBase, current: incidentCur, priors: incidentPriors, thresholdPct: 10 });
    expect(r.rawDrawdownPct).toBeCloseTo(-12.1, 6);
    expect(r.carried).toBe(true);
    expect(r.carriedSides).toEqual(['baseline', 'current']);
    expect(r.baseline.carriedKRW).toBeCloseTo(2.2, 9);
    expect(r.current.carriedKRW).toBeCloseTo(11.4, 9);
    expect(r.adjustedDrawdownPct).toBeCloseTo(-2.84, 2);
    expect(r.suppress).toBe(true);
    expect(r.current.lastSeenMs).toBe(CUR_TS.getTime() - 8.3 * HOUR);
    expect(r.baseline.lastSeenMs).toBe(BASE_TS.getTime() - 16.5 * HOUR);
  });

  test('🔴 10-23 사건에서 현재 쪽만 이월(기준선 이월 불가)하면 보정하지 않는다 — 비대칭 보정(약 -0.7%) 금지', () => {
    const priors = incidentPriors.filter(p => (p.ts as Date).getTime() > BASE_TS.getTime());   // 기준선 쪽 양수 제거
    const r = assessHiddenUsdCarry({ baseline: incidentBase, current: incidentCur, priors, thresholdPct: 10 });
    expect(r.carried).toBe(false);
    expect(r.suppress).toBe(false);
    expect(r.adjustedDrawdownPct).toBeNull();
    expect(r.hiddenSides).toEqual(['baseline', 'current']);
    expect(r.baseline.state).toBe('hidden_no_prior');
  });

  test('🔴 시간대 비대칭: 기준선 보임(11.4)·현재 가려짐, 보합 → 원시 -11.4% · 보정 0% → 보류 가능', () => {
    const b = target(BASE_TS, 100, [pos('KRW', 12.1), usd(5.7), pos('US1', 76.5)]);
    const c = target(CUR_TS, 88.6, [pos('KRW', 12.1), usd(0), pos('US1', 76.5)]);
    const r = assessHiddenUsdCarry({ baseline: b, current: c, priors: [prior(at(10 * HOUR), [usd(5.7), pos('US1', 76.5)])], thresholdPct: 10 });
    expect(r.rawDrawdownPct).toBeCloseTo(-11.4, 6);
    expect(r.carriedSides).toEqual(['current']);
    expect(r.baseline.state).toBe('visible');
    expect(r.adjustedDrawdownPct).toBeCloseTo(0, 9);
    expect(r.suppress).toBe(true);
  });

  test('🔴 진짜 폭락: 미국 보유 -12% + 현재 USD 가려짐 → 보정 후에도 -5% 보다 깊음 → 보류 불가', () => {
    const b = target(BASE_TS, 100, [pos('KRW', 12.1), usd(5.7), pos('US1', 76.5)]);
    const c = target(CUR_TS, 12.1 + 76.5 * 0.88, [pos('KRW', 12.1), usd(0), pos('US1', 76.5 * 0.88)]);
    const r = assessHiddenUsdCarry({ baseline: b, current: c, priors: [prior(at(10 * HOUR), [usd(5.7), pos('US1', 76.5)])], thresholdPct: 10 });
    expect(r.carried).toBe(true);
    expect(r.adjustedDrawdownPct!).toBeLessThan(-5);
    expect(r.suppress).toBe(false);
  });

  test('🔴 진짜 폭락(10-23 모양): 양쪽 가려짐 + 미국 보유 -12% → 보정 후 -10% 초과 → 보류 불가', () => {
    const c = target(CUR_TS, 13.7 + 74.2 * 0.88, [pos('KRW', 13.7), usd(0), pos('US1', 74.2 * 0.88)]);
    const r = assessHiddenUsdCarry({ baseline: incidentBase, current: c, priors: incidentPriors, thresholdPct: 10 });
    expect(r.carried).toBe(true);
    expect(r.adjustedDrawdownPct!).toBeLessThan(-10);
    expect(r.suppress).toBe(false);
  });
});

describe('보류 경계 — 절반 마진은 "엄격히 얕을 때만"', () => {
  // 기준선: KRW 10 + USD 10(qty 5) + US 80 = 100. 현재: USD 가려짐, US 만 변함. 보정 = (US + 10 + 10 − 100)%.
  const b = target(BASE_TS, 100, [pos('KRW', 10), usd(5), pos('US1', 80)]);
  const cur = (us: number) => target(CUR_TS, 10 + us, [pos('KRW', 10), usd(0), pos('US1', us)]);
  const priors = [prior(at(3 * HOUR), [usd(5), pos('US1', 80)])];
  const run = (us: number, thresholdPct = 10) => assessHiddenUsdCarry({ baseline: b, current: cur(us), priors, thresholdPct });

  test('보정 -7% (모호 구간) → 보류 불가', () => {
    const r = run(73);
    expect(r.adjustedDrawdownPct).toBeCloseTo(-7, 9);
    expect(r.suppress).toBe(false);
  });

  test('🔴 보정 정확히 -5.0% (경계) → 보류 불가', () => {
    const r = run(75);
    expect(r.adjustedDrawdownPct).toBe(-5);
    expect(r.suppress).toBe(false);
  });

  test('보정 -4.9% → 보류 가능', () => {
    const r = run(75.1);
    expect(r.adjustedDrawdownPct).toBeCloseTo(-4.9, 9);
    expect(r.suppress).toBe(true);
  });

  test('마진은 임계에 비례한다 (임계 20% → 경계 -10%)', () => {
    expect(run(71, 20).suppress).toBe(true);      // -9%
    expect(run(70, 20).suppress).toBe(false);     // -10% 정확히
  });

  test('임계가 비정상(0·음수·NaN)이면 보류하지 않는다', () => {
    for (const t of [0, -10, Number.NaN]) expect(run(80, t).suppress).toBe(false);
  });

  test('상수 확인 — 마진 0.5, 창 20시간', () => {
    expect(HIDDEN_USD_SUPPRESS_MARGIN).toBe(0.5);
    expect(HIDDEN_USD_CARRY_WINDOW_HOURS).toBe(20);
  });
});

describe('이월 창(직전 20시간)과 이월값', () => {
  const b = target(BASE_TS, 100, [pos('KRW', 12.1), usd(5.7), pos('US1', 76.5)]);
  const c = target(CUR_TS, 88.6, [pos('KRW', 12.1), usd(0), pos('US1', 76.5)]);
  const run = (priors: CarryPrior[]) => assessHiddenUsdCarry({ baseline: b, current: c, priors, thresholdPct: 10 });

  test('🔴 양수 값이 정확히 20시간 전 → 창 안(경계 포함) → 이월', () => {
    const r = run([prior(new Date(CUR_TS.getTime() - 20 * HOUR), [usd(5.7), pos('US1', 76.5)])]);
    expect(r.carried).toBe(true);
    expect(r.suppress).toBe(true);
  });

  test('🔴 양수 값이 20시간 1분 전 → 창 밖 → 이월 안 함 → 보류 불가', () => {
    const r = run([prior(new Date(CUR_TS.getTime() - 20 * HOUR - 60_000), [usd(5.7), pos('US1', 76.5)])]);
    expect(r.carried).toBe(false);
    expect(r.current.state).toBe('hidden_no_prior');
    expect(r.suppress).toBe(false);
  });

  test('🔴 직전 20시간 안에 양수 값 없음(가려진 행만) → 이월 안 함', () => {
    const r = run([prior(at(3 * HOUR), [usd(0)]), prior(at(6 * HOUR), [usd(0)])]);
    expect(r.carried).toBe(false);
    expect(r.suppress).toBe(false);
  });

  test('자기 시각과 같은 행·미래 행은 근거가 아니다', () => {
    expect(run([prior(CUR_TS, [usd(5.7), pos('US1', 76.5)]), prior(new Date(CUR_TS.getTime() + HOUR), [usd(5.7), pos('US1', 76.5)])]).carried).toBe(false);
  });

  test('가장 최근 양수 값을 쓴다', () => {
    const r = run([prior(at(15 * HOUR), [usd(1), pos('US1', 76.5)]), prior(at(9 * HOUR), [usd(5.7), pos('US1', 76.5)]), prior(at(12 * HOUR), [usd(3), pos('US1', 76.5)])]);
    expect(r.current.carriedQty).toBe(5.7);
    expect(r.current.lastSeenMs).toBe(T0 - 9 * HOUR);
  });

  test('가격: 가려진 행 자신의 가격을 쓴다 — 없으면 직전 양수 행의 가격', () => {
    const own = run([prior(at(3 * HOUR), [usd(5.7, 1.9), pos('US1', 76.5)])]);
    expect(own.current.carriedPrice).toBe(2);
    expect(own.current.carriedKRW).toBeCloseTo(11.4, 9);
    const noPrice = target(CUR_TS, 88.6, [pos('KRW', 12.1), { currency: 'USD', qty: 0, price: 0, value_krw: 0 }, pos('US1', 76.5)]);
    const fb = assessHiddenUsdCarry({ baseline: b, current: noPrice, priors: [prior(at(3 * HOUR), [usd(5.7, 1.9), pos('US1', 76.5)])], thresholdPct: 10 });
    expect(fb.current.carriedPrice).toBe(1.9);
    expect(fb.current.carriedKRW).toBeCloseTo(10.83, 9);
  });

  test('쓸 수 있는 가격이 어디에도 없으면 이월 안 함', () => {
    const noPrice = target(CUR_TS, 88.6, [pos('KRW', 12.1), { currency: 'USD', qty: 0, price: 0, value_krw: 0 }, pos('US1', 76.5)]);
    const r = assessHiddenUsdCarry({ baseline: b, current: noPrice, priors: [prior(at(3 * HOUR), [{ currency: 'USD', qty: 5.7, value_krw: 11.4 }, pos('US1', 76.5)])], thresholdPct: 10 });
    expect(r.current.state).toBe('hidden_no_price');
    expect(r.suppress).toBe(false);
  });

  test('총액과 positions 를 함께 보정한다 — 보정 positions 합 = 보정 총액 (같은 집합)', () => {
    const r = assessHiddenUsdCarry({ baseline: incidentBase, current: incidentCur, priors: incidentPriors, thresholdPct: 10 });
    for (const s of [r.baseline, r.current]) {
      const sum = s.adjustedPositions!.reduce((a, p) => a + p.value_krw, 0);
      expect(sum).toBeCloseTo(s.adjustedTotal, 9);
      expect(s.adjustedPositions!.filter(p => p.currency === 'USD')).toHaveLength(1);
    }
    expect(r.adjustedBaselineTotal).toBeCloseTo(102.2, 9);
    expect(r.adjustedCurrentTotal).toBeCloseTo(99.3, 9);
  });
});

describe('USD 행 4조합 — 부재 / 한쪽 0 / 양쪽 0 / 양쪽 양수', () => {
  const priors = [prior(at(30 * HOUR), [usd(5), pos('US1', 80)]), prior(at(3 * HOUR), [usd(5), pos('US1', 80)])];
  const mk = (ts: Date, total: number, usdRow: CompositionPosition | null) =>
    target(ts, total, [pos('KRW', 10), ...(usdRow ? [usdRow] : []), pos('US1', total - 10 - (usdRow?.value_krw ?? 0))]);

  test('양쪽 부재 → 가려짐 없음, no-op', () => {
    const r = assessHiddenUsdCarry({ baseline: mk(BASE_TS, 100, null), current: mk(CUR_TS, 85, null), priors, thresholdPct: 10 });
    expect(r).toMatchObject({ carried: false, suppress: false, hiddenSides: [] });
  });

  test('한쪽 부재·다른 쪽 0 → 규칙 E 영역이라 다루지 않는다', () => {
    const r = assessHiddenUsdCarry({ baseline: mk(BASE_TS, 100, null), current: mk(CUR_TS, 85, usd(0)), priors, thresholdPct: 10 });
    expect(r).toMatchObject({ carried: false, suppress: false });
    expect(r.reason).toContain('규칙 E');
  });

  test('한쪽 0 (현재만 가려짐) → 이월', () => {
    const r = assessHiddenUsdCarry({ baseline: mk(BASE_TS, 100, usd(5)), current: mk(CUR_TS, 90, usd(0)), priors, thresholdPct: 10 });
    expect(r.carriedSides).toEqual(['current']);
  });

  test('한쪽 0 (기준선만 가려짐) → 기준선을 이월 — 손실이 더 깊어지는 쪽이라 보류로 치우치지 않는다', () => {
    const r = assessHiddenUsdCarry({
      baseline: mk(BASE_TS, 90, usd(0)), current: mk(CUR_TS, 80, usd(5)),
      priors: [prior(new Date(BASE_TS.getTime() - 2 * HOUR), [usd(5), pos('US1', 80)])], thresholdPct: 10,
    });
    expect(r.carriedSides).toEqual(['baseline']);
    expect(r.adjustedDrawdownPct!).toBeLessThan(r.rawDrawdownPct!);
    expect(r.suppress).toBe(false);
  });

  test('양쪽 0 → 양쪽 이월', () => {
    const r = assessHiddenUsdCarry({ baseline: incidentBase, current: incidentCur, priors: incidentPriors, thresholdPct: 10 });
    expect(r.carriedSides).toEqual(['baseline', 'current']);
  });

  test('🔴 양쪽 양수(둘 다 보임) → no-op — 직전 양수 값이 있어도 이월하지 않는다', () => {
    const r = assessHiddenUsdCarry({ baseline: mk(BASE_TS, 100, usd(5)), current: mk(CUR_TS, 85, usd(5)), priors, thresholdPct: 10 });
    expect(r).toMatchObject({ carried: false, suppress: false, hiddenSides: [] });
  });

  test('qty 0 이지만 가치가 0 이 아닌 행은 가려짐으로 보지 않는다', () => {
    const odd = { currency: 'USD', qty: 0, price: 2, value_krw: 3 };
    expect(hasHiddenUsdRow([odd])).toBe(false);
    expect(hasHiddenUsdRow([usd(0)])).toBe(true);
    expect(hasHiddenUsdRow(null)).toBe(false);
  });
});

describe('입력 이상 → 보류하지 않는다 (검증 불가는 발동 쪽)', () => {
  const b = target(BASE_TS, 100, [pos('KRW', 12.1), usd(5.7), pos('US1', 76.5)]);
  const c = target(CUR_TS, 88.6, [pos('KRW', 12.1), usd(0), pos('US1', 76.5)]);
  const good = [prior(at(3 * HOUR), [usd(5.7), pos('US1', 76.5)])];

  test('기준선 positions 를 읽을 수 없음 → 보류 불가', () => {
    expect(assessHiddenUsdCarry({ baseline: { ...b, positions: null }, current: c, priors: good, thresholdPct: 10 }).suppress).toBe(false);
  });

  test('직전 스냅샷 positions JSON 깨짐 → 근거에서 제외 → 이월 불가', () => {
    const r = assessHiddenUsdCarry({ baseline: b, current: c, priors: [prior(at(3 * HOUR), '{{not json')], thresholdPct: 10 });
    expect(r.carried).toBe(false);
    expect(r.suppress).toBe(false);
  });

  test('대상 시각을 읽을 수 없음 → 보류 불가', () => {
    expect(assessHiddenUsdCarry({ baseline: b, current: { ...c, ts: 'garbage' }, priors: good, thresholdPct: 10 }).suppress).toBe(false);
  });

  test('USD 수량을 읽을 수 없는 쪽 → 보류 불가', () => {
    const bad = target(BASE_TS, 100, [pos('KRW', 12.1), { currency: 'USD', qty: 'x' as unknown as number, price: 2, value_krw: 0 }, pos('US1', 76.5)]);
    expect(assessHiddenUsdCarry({ baseline: bad, current: c, priors: good, thresholdPct: 10 }).suppress).toBe(false);
  });

  test('기준 총액 0 이하·현재 총액 비유한 → 보류 불가', () => {
    expect(assessHiddenUsdCarry({ baseline: { ...b, total: 0 }, current: c, priors: good, thresholdPct: 10 }).suppress).toBe(false);
    expect(assessHiddenUsdCarry({ baseline: b, current: { ...c, total: Number.NaN }, priors: good, thresholdPct: 10 }).suppress).toBe(false);
  });

  test('던지지 않는다 — priors 가 배열이 아니거나 null 원소가 섞여도', () => {
    expect(() => assessHiddenUsdCarry({ baseline: b, current: c, priors: null as unknown as CarryPrior[], thresholdPct: 10 })).not.toThrow();
    const r = assessHiddenUsdCarry({ baseline: b, current: c, priors: [null as unknown as CarryPrior, ...good], thresholdPct: 10 });
    expect(r.suppress).toBe(true);
  });
});

describe('(M-1) 구매 증거 가드 — 근거 행 S 뒤 비현금 신규·수량 증가가 있으면 그 쪽은 이월 불가', () => {
  // 기준선 USD 보임(11.4), 현재 가려짐. S = 현재 쪽 10시간 전 양수 행.
  const b = target(BASE_TS, 100, [pos('KRW', 12.1), usd(5.7), pos('US1', 76.5)]);
  const S = (extra: CompositionPosition[] = []) => prior(at(10 * HOUR), [pos('KRW', 12.1), usd(5.7), pos('US1', 76.5), ...extra]);
  const cur = (holdings: CompositionPosition[]) =>
    target(CUR_TS, 12.1 + holdings.reduce((a, p) => a + p.value_krw, 0), [pos('KRW', 12.1), usd(0), ...holdings]);
  const run = (holdings: CompositionPosition[], extra: CompositionPosition[] = []) =>
    assessHiddenUsdCarry({ baseline: b, current: cur(holdings), priors: [S(extra)], thresholdPct: 10 });
  const q = (currency: string, qty: number, value: number): CompositionPosition => ({ currency, qty, price: value / qty, value_krw: value });

  test('🔴 신규 종목(S 에 없음) → hidden_purchase_evidence → 보정 안 함', () => {
    const r = run([pos('US1', 76.5 * 0.87), pos('NEW1', 11.4 * 0.87)]);
    expect(r.current.state).toBe('hidden_purchase_evidence');
    expect(r.current.purchaseEvidence).toEqual(['NEW1']);
    expect(r.carried).toBe(false);
    expect(r.suppress).toBe(false);
    expect(r.reason).toContain('hidden_purchase_evidence');
    expect(r.reason).toContain('NEW1');
  });

  test('🔴 기존 종목 수량 증가 → 이월 불가', () => {
    const r = run([q('US1', 1.149, 87.9 * 0.87)]);
    expect(r.current.state).toBe('hidden_purchase_evidence');
    expect(r.suppress).toBe(false);
  });

  test('🔴 국내 종목 매수도 증거로 본다(보수적)', () => {
    const r = run([pos('US1', 76.5), q('DOM1', 2, 11.4)], [q('DOM1', 1, 5.7)]);
    expect(r.current.purchaseEvidence).toEqual(['DOM1']);
    expect(r.suppress).toBe(false);
  });

  test('수량 동일 → 이월 가능', () => {
    const r = run([pos('US1', 76.5)]);
    expect(r.current.state).toBe('hidden_carried');
    expect(r.suppress).toBe(true);
  });

  test('수량 감소(매도) → 이월을 막지 않는다', () => {
    const r = run([q('US1', 0.5, 38)], [q('DOM1', 1, 5)]);   // US1 절반 매도, DOM1 전량 매도
    expect(r.current.state).toBe('hidden_carried');
    expect(r.current.purchaseEvidence).toEqual([]);
  });

  test('부동소수 허용오차 1e-9 이내 증가는 증가가 아니다, 그보다 크면 증가', () => {
    expect(run([q('US1', 1 + 1e-12, 76.5)]).current.state).toBe('hidden_carried');
    expect(run([q('US1', 1 + 1e-6, 76.5)]).current.state).toBe('hidden_purchase_evidence');
  });

  test('현재 수량 0 인 행은 보유가 아니므로 S 에 없어도 증거가 아니다', () => {
    expect(run([pos('US1', 76.5), { currency: 'ZERO1', qty: 0, price: 0, value_krw: 0 }]).current.state).toBe('hidden_carried');
  });

  test('수량을 읽을 수 없으면 증거로 본다', () => {
    const r = run([{ currency: 'US1', qty: 'x' as unknown as number, price: 1, value_krw: 76.5 }]);
    expect(r.current.state).toBe('hidden_purchase_evidence');
  });

  test('🔴 10-23 사건 재현은 가드에 걸리지 않는다(양쪽 S→H 보유 불변·감소) → 계속 보류 가능', () => {
    const r = assessHiddenUsdCarry({ baseline: incidentBase, current: incidentCur, priors: incidentPriors, thresholdPct: 10 });
    expect(r.baseline.purchaseEvidence).toEqual([]);
    expect(r.current.purchaseEvidence).toEqual([]);
    expect(r.suppress).toBe(true);
  });

  test('기준선 쪽에서 증거가 나와도 전체 보정 안 함', () => {
    const priors = incidentPriors.map(p => (p.ts as Date).getTime() === BASE_TS.getTime() - 16.5 * HOUR
      ? prior(p.ts as Date, JSON.stringify([pos('KRW', 9.3), usd(1.1), pos('US1', 40.5), pos('US2', 36)])) : p);   // DOM1 이 S 뒤 신규
    const r = assessHiddenUsdCarry({ baseline: incidentBase, current: incidentCur, priors, thresholdPct: 10 });
    expect(r.baseline.state).toBe('hidden_purchase_evidence');
    expect(r.carried).toBe(false);
    expect(r.suppress).toBe(false);
  });
});

describe('(M-2) 환율 범위 — 가려진 행 가격 / 근거 행 가격 ∈ [0.8, 1.25] (양 끝 포함)', () => {
  const b = target(BASE_TS, 100, [pos('KRW', 12.1), usd(5.7), pos('US1', 76.5)]);
  const cur = (hPrice: number) => target(CUR_TS, 88.6, [pos('KRW', 12.1), usd(0, hPrice), pos('US1', 76.5)]);
  const priors = [prior(at(10 * HOUR), [usd(5.7, 2), pos('US1', 76.5)])];   // S 가격 2
  const run = (hPrice: number) => assessHiddenUsdCarry({ baseline: b, current: cur(hPrice), priors, thresholdPct: 10 });

  test.each([[20, '×10'], [0.2, '×0.1'], [1.58, '×0.79'], [2.52, '×1.26']])('🔴 가격 %p (%s) → 범위 밖 → 이월 불가', (hp) => {
    const r = run(hp);
    expect(r.current.state).toBe('hidden_no_price_out_of_band');
    expect(r.carried).toBe(false);
    expect(r.suppress).toBe(false);
    expect(r.reason).toContain('hidden_no_price_out_of_band');
  });

  test.each([[1.6, '×0.8 경계'], [2.5, '×1.25 경계'], [2, '×1']])('가격 %p (%s) → 범위 안 → 자기 가격으로 이월', (hp) => {
    const r = run(hp);
    expect(r.current.state).toBe('hidden_carried');
    expect(r.current.carriedPrice).toBe(hp);
  });

  test('가려진 행에 가격이 없으면 근거 행 가격을 쓴다(범위 검사 없음)', () => {
    const r = run(0);
    expect(r.current.state).toBe('hidden_carried');
    expect(r.current.carriedPrice).toBe(2);
  });

  test('가려진 행에 가격이 있는데 근거 행에 가격이 없으면 대조 불가 → 이월 불가', () => {
    const r = assessHiddenUsdCarry({
      baseline: b, current: cur(2),
      priors: [prior(at(10 * HOUR), [{ currency: 'USD', qty: 5.7, value_krw: 11.4 }, pos('US1', 76.5)])], thresholdPct: 10,
    });
    expect(r.current.state).toBe('hidden_no_price_out_of_band');
    expect(r.suppress).toBe(false);
  });
});

describe('(M16) 임계 가드 — 가드가 없으면 결과가 갈리는 입력', () => {
  // 기준선 KRW 10 + USD 10 + US 80 = 100, 현재 USD 가려짐. 보정 = (US + 20 − 100)%.
  const b = target(BASE_TS, 100, [pos('KRW', 10), usd(5), pos('US1', 80)]);
  const run = (us: number, thresholdPct: number) => assessHiddenUsdCarry({
    baseline: b, current: target(CUR_TS, 10 + us, [pos('KRW', 10), usd(0), pos('US1', us)]),
    priors: [prior(at(3 * HOUR), [usd(5), pos('US1', 80)])], thresholdPct,
  });

  test('🔴 임계 0 · 보정 +1% → 보류하지 않는다 (가드 없으면 +1 > −0 으로 보류)', () => {
    const r = run(81, 0);
    expect(r.adjustedDrawdownPct).toBeCloseTo(1, 9);
    expect(r.suppress).toBe(false);
  });

  test('🔴 임계 −10 · 보정 +6% → 보류하지 않는다 (가드 없으면 +6 > +5 로 보류)', () => {
    const r = run(86, -10);
    expect(r.adjustedDrawdownPct).toBeCloseTo(6, 9);
    expect(r.suppress).toBe(false);
  });
});

describe('(Codex high) 중간 행 검사 — S 와 H 사이 모든 중간 행에서 신규 종목·수량 증가를 본다 (왕복 거래)', () => {
  // 기준선 USD 보임(11.4), 현재 가려짐, 현재 보유는 S 와 같다(끝점 비교만으로는 증거 없음).
  const b = target(BASE_TS, 100, [pos('KRW', 12.1), usd(5.7), pos('US1', 76.5)]);
  const c = target(CUR_TS, 88.6, [pos('KRW', 12.1), usd(0), pos('US1', 76.5)]);
  const S = prior(new Date(CUR_TS.getTime() - 10 * HOUR), [pos('KRW', 12.1), usd(5.7), pos('US1', 76.5)]);
  const R = (hAgo: number, positions: unknown) => prior(new Date(CUR_TS.getTime() - hAgo * HOUR), positions);
  const q = (currency: string, qty: number, value: number): CompositionPosition => ({ currency, qty, price: value / qty, value_krw: value });
  const run = (mids: CarryPrior[]) => assessHiddenUsdCarry({ baseline: b, current: c, priors: [S, ...mids], thresholdPct: 10 });

  test('대조: 중간 행이 없거나 보유가 같으면 이월 가능(보류)', () => {
    expect(run([]).suppress).toBe(true);
    expect(run([R(5, [pos('KRW', 12.1), usd(0), pos('US1', 75)])]).suppress).toBe(true);
  });

  test('🔴 왕복: S 에 없던 종목이 중간 행에만 보였다가 H 에서 사라짐 → hidden_purchase_evidence → 보정 안 함', () => {
    const r = run([R(5, [pos('KRW', 12.1), usd(0), pos('US1', 76.5), pos('NEW1', 11)])]);
    expect(r.current.state).toBe('hidden_purchase_evidence');
    expect(r.current.purchaseEvidence).toEqual(['NEW1']);
    expect(r.carried).toBe(false);
    expect(r.suppress).toBe(false);
  });

  test('🔴 왕복: 기존 종목 수량이 중간 행에서만 늘었다가 H 에서 원복 → 이월 불가', () => {
    const r = run([R(5, [pos('KRW', 12.1), usd(0), q('US1', 1.15, 87)])]);
    expect(r.current.state).toBe('hidden_purchase_evidence');
    expect(r.current.purchaseEvidence).toEqual(['US1']);
  });

  test('중간 행에서 감소·동일만 있으면 이월 가능', () => {
    const r = run([R(6, [pos('KRW', 12.1), usd(0), q('US1', 0.5, 38)]), R(3, [pos('KRW', 12.1), usd(0), pos('US1', 76)])]);
    expect(r.current.state).toBe('hidden_carried');
  });

  test('🔴 중간 행 여러 개 중 하나만 증거여도 이월 불가 (증거 종목은 합쳐서 남긴다)', () => {
    const r = run([
      R(8, [pos('KRW', 12.1), usd(0), pos('US1', 76.5)]),
      R(6, [pos('KRW', 12.1), usd(0), pos('US1', 76.5), pos('NEW2', 3)]),
      R(4, [pos('KRW', 12.1), usd(0), pos('US1', 76.5), pos('NEW1', 5)]),
      R(2, [pos('KRW', 12.1), usd(0), pos('US1', 76.5)]),
    ]);
    expect(r.current.state).toBe('hidden_purchase_evidence');
    expect(r.current.purchaseEvidence).toEqual(['NEW1', 'NEW2']);
    expect(r.suppress).toBe(false);
  });

  test('🔴 중간 행 positions 깨짐 → hidden_purchase_evidence_unreadable → 이월 불가', () => {
    const r = run([R(5, '{{not json')]);
    expect(r.current.state).toBe('hidden_purchase_evidence_unreadable');
    expect(r.carried).toBe(false);
    expect(r.suppress).toBe(false);
    expect(r.reason).toContain('hidden_purchase_evidence_unreadable');
    const r2 = run([R(5, { not: 'array' })]);
    expect(r2.current.state).toBe('hidden_purchase_evidence_unreadable');
  });

  test('S 를 고르는 단계의 동작은 그대로 — S 보다 이전의 깨진 행은 근거 후보에서만 빠진다(이월 가능)', () => {
    expect(run([R(15, '{{not json')]).current.state).toBe('hidden_carried');
  });

  test('🔴 경계(하한): S 보다 이전 행의 보유 차이는 증거가 아니다 (S 이후만 본다)', () => {
    const r = run([R(14, [pos('KRW', 12.1), usd(5.7), pos('US1', 76.5), pos('OLD1', 9)])]);   // S 이전에 팔린 종목
    expect(r.current.state).toBe('hidden_carried');
    expect(r.current.lastSeenMs).toBe(CUR_TS.getTime() - 10 * HOUR);   // 근거 행은 여전히 가장 최근 양수 행 S
  });

  test('🔴 경계(상한): H 이후 행은 보지 않는다 — 다른 쪽(현재) 직전 행이 기준선 쪽 판정에 섞여도 무관', () => {
    // 기준선이 가려진 쪽, 현재는 보임. 합쳐 넘긴 목록에 기준선 시각 이후 행(신규 종목 포함)이 있다.
    const bh = target(BASE_TS, 100, [pos('KRW', 12.1), usd(0), pos('US1', 76.5)]);
    const cv = target(CUR_TS, 85, [pos('KRW', 12.1), usd(5.7), pos('US1', 61.5)]);
    const r = assessHiddenUsdCarry({
      baseline: bh, current: cv, thresholdPct: 10,
      priors: [
        prior(new Date(BASE_TS.getTime() - 6 * HOUR), [pos('KRW', 12.1), usd(5.7), pos('US1', 76.5)]),
        prior(new Date(BASE_TS.getTime() + 3 * HOUR), [pos('KRW', 12.1), usd(0), pos('US1', 76.5), pos('NEW1', 4)]),
      ],
    });
    expect(r.baseline.state).toBe('hidden_carried');
  });

  test('🔴 경계(상한 포함): H 와 같은 시각의 다른 행도 검사한다 (S.ts < R.ts <= H.ts)', () => {
    const r = run([prior(CUR_TS, [pos('KRW', 12.1), usd(0), pos('US1', 76.5), pos('NEW1', 2)])]);
    expect(r.current.state).toBe('hidden_purchase_evidence');
  });

  test('🔴 H 자신도 검사 대상이다 (중간 행이 없어도 H 의 신규 종목은 증거)', () => {
    const ch = target(CUR_TS, 88.6, [pos('KRW', 12.1), usd(0), pos('US1', 70), pos('NEW1', 6.5)]);
    const r = assessHiddenUsdCarry({ baseline: b, current: ch, priors: [S], thresholdPct: 10 });
    expect(r.current.state).toBe('hidden_purchase_evidence');
  });
});

describe('실데이터 회귀 방지 — 실제 보류 사건 유형은 중간 행 검사 뒤에도 그대로 보류', () => {
  test('🔴 10-23 사건(#5443 유형): 양쪽 중간 행 보유 불변·감소 + 양쪽 사이에 낀 신규 종목 행(어느 쪽 구간도 아님) → 보류 유지', () => {
    const between = prior(new Date(CUR_TS.getTime() - 12 * HOUR), [pos('KRW', 9.3), usd(0), pos('US1', 40), pos('US2', 36.5), pos('DOM1', 14.2), pos('NEW9', 1)]);
    const r = assessHiddenUsdCarry({ baseline: incidentBase, current: incidentCur, priors: [...incidentPriors, between], thresholdPct: 10 });
    expect(r.baseline.state).toBe('hidden_carried');
    expect(r.current.state).toBe('hidden_carried');
    expect(r.adjustedDrawdownPct).toBeCloseTo(-2.84, 2);
    expect(r.suppress).toBe(true);
  });

  test('🔴 #5450 유형: 기준선 보임·현재 가려짐, 시간당 중간 행 8개 보유 수량 불변(평가만 변동) → 원시 −10.3% · 보정 +1.3% → 보류', () => {
    const b = target(BASE_TS, 100, [pos('KRW', 10), usd(5.8), pos('US1', 78.4)]);
    const c = target(CUR_TS, 89.7, [pos('KRW', 10), usd(0), pos('US1', 79.7)]);
    const priors = [prior(new Date(CUR_TS.getTime() - 9 * HOUR), [pos('KRW', 10), usd(5.8), pos('US1', 78)])];
    for (let h = 8; h >= 1; h--) priors.push(prior(new Date(CUR_TS.getTime() - h * HOUR), [pos('KRW', 10), usd(0), pos('US1', 78 + h / 10)]));
    const r = assessHiddenUsdCarry({ baseline: b, current: c, priors, thresholdPct: 10 });
    expect(r.rawDrawdownPct).toBeCloseTo(-10.3, 6);
    expect(r.adjustedDrawdownPct).toBeCloseTo(1.3, 6);
    expect(r.suppress).toBe(true);
  });
});

/**
 * 선행지표 hit-rate 분석 — 과신 방지 장치가 제대로 붙는지 검증 (T-032).
 */
import {
  analyzePrecursors,
  getActiveRuleIds,
  getRuleLabel,
  PRECURSOR_NOTE,
} from '../pattern/precursor-analysis';
import type { PrecursorFeatures } from '../types';

/** 완전히 채워진(평가 가능) 피처 1개 */
function f(index: number, over: Partial<PrecursorFeatures> = {}): PrecursorFeatures {
  return {
    index,
    date: `2024-01-${String((index % 28) + 1).padStart(2, '0')}`,
    rsi14: 50,
    atrPct: 2,
    bbPercentB: 0.5,
    drawdownPct: 5,
    volumeRatio: 1,
    ...over,
  };
}

describe('analyzePrecursors', () => {
  test('평가 가능 일수는 모든 피처가 채워진 날만 센다', () => {
    const feats = [f(0), f(1, { rsi14: null }), f(2), f(3, { volumeRatio: null })];
    const r = analyzePrecursors(feats, [], { labelToleranceDays: 0 });
    expect(r.evaluatedDays).toBe(2);
  });

  test('positiveDays 는 trough ± labelToleranceDays 로 확장된다', () => {
    const feats = Array.from({ length: 20 }, (_, i) => f(i));
    const r = analyzePrecursors(feats, [10], { labelToleranceDays: 2 });
    expect(r.positiveDays).toBe(5); // 8,9,10,11,12
    expect(r.labelToleranceDays).toBe(2);
    expect(r.baseRate).toBeCloseTo(5 / 20, 8);
  });

  test('라벨 확장이 배열 경계를 넘지 않는다', () => {
    const feats = Array.from({ length: 5 }, (_, i) => f(i));
    const r = analyzePrecursors(feats, [0, 4], { labelToleranceDays: 3 });
    expect(r.positiveDays).toBe(5);
  });

  test('precision·lift 를 정확히 계산한다', () => {
    // 20일 중 index 0~4 만 RSI 25 (규칙 발화), 그중 0~2 가 양성
    const feats = Array.from({ length: 20 }, (_, i) => f(i, { rsi14: i < 5 ? 25 : 60 }));
    const r = analyzePrecursors(feats, [1], { labelToleranceDays: 1 }); // 양성 = 0,1,2
    const rule = r.rules.find((x) => x.id === 'rsi_lt_30')!;
    expect(rule.triggerCount).toBe(5);
    expect(rule.hitCount).toBe(3);
    expect(rule.precision).toBeCloseTo(0.6, 8);
    expect(r.baseRate).toBeCloseTo(3 / 20, 8);
    expect(rule.lift).toBeCloseTo(0.6 / 0.15, 8);
  });

  test('한 번도 발화하지 않은 규칙은 precision·lift 가 null (0 으로 위장하지 않는다)', () => {
    const feats = Array.from({ length: 10 }, (_, i) => f(i));
    const r = analyzePrecursors(feats, [5]);
    const rule = r.rules.find((x) => x.id === 'rsi_lt_30')!;
    expect(rule.triggerCount).toBe(0);
    expect(rule.precision).toBeNull();
    expect(rule.lift).toBeNull();
  });

  test('positiveDays 가 임계치 미만이면 lowSampleWarning', () => {
    const feats = Array.from({ length: 50 }, (_, i) => f(i));
    const few = analyzePrecursors(feats, [10], { labelToleranceDays: 0, minPositiveDays: 5 });
    expect(few.positiveDays).toBe(1);
    expect(few.lowSampleWarning).toBe(true);

    const many = analyzePrecursors(feats, [10, 20, 30], { labelToleranceDays: 2, minPositiveDays: 5 });
    expect(many.positiveDays).toBe(15);
    expect(many.lowSampleWarning).toBe(false);
  });

  test('과신 방지 고정 문구가 항상 붙는다', () => {
    const r = analyzePrecursors([f(0)], [0]);
    expect(r.note).toBe(PRECURSOR_NOTE);
    expect(r.note).toContain('예측 규칙이 아니라 사후 관찰');
  });

  test('p-value 등 유의성 지표는 의도적으로 제공하지 않는다', () => {
    const r = analyzePrecursors([f(0)], [0]);
    expect(Object.keys(r)).not.toContain('pValue');
    for (const rule of r.rules) {
      expect(Object.keys(rule)).toEqual(
        expect.arrayContaining(['id', 'label', 'triggerCount', 'hitCount', 'precision', 'lift']),
      );
      expect(Object.keys(rule)).toHaveLength(6);
    }
  });

  test('빈 입력에서도 던지지 않는다', () => {
    const r = analyzePrecursors([], []);
    expect(r.evaluatedDays).toBe(0);
    expect(r.positiveDays).toBe(0);
    expect(r.baseRate).toBeNull();
    expect(r.lowSampleWarning).toBe(true);
    expect(r.rules.length).toBeGreaterThan(0);
  });

  test('복합 규칙은 두 조건을 모두 만족할 때만 발화한다', () => {
    const feats = [
      f(0, { rsi14: 30, volumeRatio: 2 }),   // 둘 다 만족
      f(1, { rsi14: 30, volumeRatio: 1 }),   // 거래량 미달
      f(2, { rsi14: 50, volumeRatio: 2 }),   // RSI 미달
    ];
    const r = analyzePrecursors(feats, [], { labelToleranceDays: 0 });
    const rule = r.rules.find((x) => x.id === 'rsi_lt_35_and_vol_gt_1_5x')!;
    expect(rule.triggerCount).toBe(1);
  });
});

// ─── T-033 — getActiveRuleIds ───────────────────────────────────────────────

describe('getActiveRuleIds', () => {
  test('평가 불가(피처 결측)면 null — "충족 규칙 없음"과 구분한다', () => {
    expect(getActiveRuleIds(null)).toBeNull();
    expect(getActiveRuleIds(undefined)).toBeNull();
    expect(getActiveRuleIds(f(0, { rsi14: null }))).toBeNull();
    expect(getActiveRuleIds(f(0, { volumeRatio: null }))).toBeNull();
  });

  test('평가 가능하지만 충족 규칙이 0개면 빈 배열(결측 아님)', () => {
    // 중립값: RSI 50, %B 0.5, 낙폭 5%, 거래량비 1, ATR 2%
    expect(getActiveRuleIds(f(0))).toEqual([]);
  });

  test('충족 규칙 1개', () => {
    // ATR% 5 → atr_gt_4 만 참
    expect(getActiveRuleIds(f(0, { atrPct: 5 }))).toEqual(['atr_gt_4']);
  });

  test('충족 규칙 다수 — 복합 규칙까지 포함하고 RULES 정의 순서를 유지한다', () => {
    const ids = getActiveRuleIds(f(0, { rsi14: 28, volumeRatio: 2 }));
    expect(ids).toEqual(['rsi_lt_30', 'rsi_lt_35', 'volume_gt_1_5x', 'rsi_lt_35_and_vol_gt_1_5x']);
  });

  test('규칙 id 는 analyzePrecursors 가 내는 id 집합의 부분집합이다(라벨 복원 가능)', () => {
    const feats = Array.from({ length: 10 }, (_, i) => f(i, { rsi14: 25, drawdownPct: 30 }));
    const stats = analyzePrecursors(feats, [1], { labelToleranceDays: 1 });
    const known = new Set(stats.rules.map((r) => r.id));
    for (const id of getActiveRuleIds(feats[9]) ?? []) {
      expect(known.has(id)).toBe(true);
      expect(getRuleLabel(id)).toEqual(expect.any(String));
    }
  });

  test('getRuleLabel — 모르는 id 는 null', () => {
    expect(getRuleLabel('does_not_exist')).toBeNull();
  });

  test('🔴 look-ahead 없음 — 뒤에 캔들이 더 붙어도 같은 행의 판정은 그대로다', () => {
    const day = f(5, { rsi14: 28, volumeRatio: 2 });
    const before = getActiveRuleIds(day);
    // 함수는 행 1개만 보므로 미래 데이터를 넣을 자리 자체가 없다 — 이 성질을 회귀로 고정한다.
    const after = getActiveRuleIds({ ...day });
    expect(after).toEqual(before);
  });
});

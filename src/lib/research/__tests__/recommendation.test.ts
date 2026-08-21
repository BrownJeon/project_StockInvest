/**
 * 매수/매도 "고려" 추천 — T-033.
 *
 * 이 스위트가 지키는 것은 **정확한 숫자**가 아니라 **과신 방지 규율**이다:
 *  1. 표본이 적으면 buy/sell 이 아니라 insufficient_data 로 강등된다
 *  2. `null`(평가 못 함)과 `[]`(충족 규칙 없음)이 서로 다른 답을 낸다
 *  3. 모든 반환값이 면책 문구를 들고 다닌다
 */
import { PRECURSOR_NOTE } from '../pattern/precursor-analysis';
import {
  CALENDAR_DAYS_PER_TRADING_DAY,
  DURATION_EXCEEDED_RATIO,
  MIN_LIFT_FOR_BUY,
  MIN_SAMPLE_FOR_RECOMMENDATION,
  TARGET_REACHED_RATIO,
  evaluateBuySignal,
  evaluateSellSignal,
  targetProgressPct,
} from '../pattern/recommendation';
import type { PrecursorRuleStat } from '../types';

function rule(id: string, over: Partial<PrecursorRuleStat> = {}): PrecursorRuleStat {
  const triggerCount = over.triggerCount ?? 40;
  const precision = over.precision ?? 0.6;
  return {
    id,
    label: `${id} 라벨`,
    triggerCount,
    hitCount: Math.round(triggerCount * precision),
    precision,
    lift: over.lift ?? 2.1,
    ...over,
  };
}

describe('evaluateBuySignal', () => {
  test('todayActiveRuleIds 가 null(미평가)이면 insufficient_data', () => {
    const r = evaluateBuySignal(null, [rule('rsi_lt_30')]);
    expect(r.action).toBe('insufficient_data');
    expect(r.ruleId).toBeNull();
    expect(r.note).toBe(PRECURSOR_NOTE);
  });

  test('오늘 충족 규칙이 0개면 hold(관망) — 결측이 아니라 관측 결과다', () => {
    const r = evaluateBuySignal([], [rule('rsi_lt_30')]);
    expect(r.action).toBe('hold');
    expect(r.triggerCount).toBe(0);
  });

  test('과거 통계 자체가 없으면 insufficient_data', () => {
    expect(evaluateBuySignal(['rsi_lt_30'], []).action).toBe('insufficient_data');
    expect(evaluateBuySignal(['rsi_lt_30'], null).action).toBe('insufficient_data');
  });

  test('표본이 문턱 미만이면 lift 가 아무리 높아도 buy 로 올리지 않는다', () => {
    const r = evaluateBuySignal(
      ['rsi_lt_30'],
      [rule('rsi_lt_30', { triggerCount: MIN_SAMPLE_FOR_RECOMMENDATION - 1, lift: 9 })],
    );
    expect(r.action).toBe('insufficient_data');
    // "무엇이 얼마나 부족했는지"는 보여준다 — 사용자에게 표본 크기를 알려주기 위함
    expect(r.ruleId).toBe('rsi_lt_30');
    expect(r.triggerCount).toBe(MIN_SAMPLE_FOR_RECOMMENDATION - 1);
    expect(r.confidence).toBeNull();
  });

  test('표본 경계값(=문턱)은 후보로 인정한다', () => {
    const r = evaluateBuySignal(
      ['rsi_lt_30'],
      [rule('rsi_lt_30', { triggerCount: MIN_SAMPLE_FOR_RECOMMENDATION, lift: 2 })],
    );
    expect(r.action).toBe('buy');
  });

  test('lift 경계값 — 문턱 미만은 hold, 문턱 이상은 buy', () => {
    const below = evaluateBuySignal(['a'], [rule('a', { lift: MIN_LIFT_FOR_BUY - 0.01 })]);
    expect(below.action).toBe('hold');
    expect(below.ruleId).toBe('a');   // 관망이어도 근거는 남긴다

    const at = evaluateBuySignal(['a'], [rule('a', { lift: MIN_LIFT_FOR_BUY })]);
    expect(at.action).toBe('buy');
  });

  test('후보가 여럿이면 lift 1위를 고른다', () => {
    const r = evaluateBuySignal(
      ['a', 'b', 'c'],
      [rule('a', { lift: 1.9 }), rule('b', { lift: 3.4 }), rule('c', { lift: 2.5 })],
    );
    expect(r.ruleId).toBe('b');
    expect(r.lift).toBeCloseTo(3.4, 8);
  });

  test('오늘 활성이 아닌 규칙은 아무리 좋아도 후보가 아니다', () => {
    const r = evaluateBuySignal(['a'], [rule('a', { lift: 1.0 }), rule('z', { lift: 9 })]);
    expect(r.ruleId).toBe('a');
    expect(r.action).toBe('hold');
  });

  test('저장된 id 에 대응하는 통계가 없으면(규칙 집합 변경 등) insufficient_data', () => {
    expect(evaluateBuySignal(['legacy_rule'], [rule('a')]).action).toBe('insufficient_data');
  });

  test('표본 구간별 신뢰도 라벨', () => {
    const at = (n: number) => evaluateBuySignal(['a'], [rule('a', { triggerCount: n, lift: 2 })]).confidence;
    expect(at(8)).toBe('low');
    expect(at(14)).toBe('low');
    expect(at(15)).toBe('medium');
    expect(at(29)).toBe('medium');
    expect(at(30)).toBe('high');
  });

  test('precision 이 null 인 규칙은 후보에서 제외된다(0으로 위장하지 않는다)', () => {
    const r = evaluateBuySignal(
      ['a'],
      [{ id: 'a', label: 'a', triggerCount: 50, hitCount: 0, precision: null, lift: null }],
    );
    expect(r.action).toBe('insufficient_data');
  });

  test('모든 반환값에 면책 문구가 붙는다', () => {
    for (const r of [
      evaluateBuySignal(null, []),
      evaluateBuySignal([], [rule('a')]),
      evaluateBuySignal(['a'], [rule('a', { lift: 3 })]),
    ]) {
      expect(r.note).toBe(PRECURSOR_NOTE);
    }
  });
});

describe('evaluateSellSignal', () => {
  const AVG_RALLY = 20;      // 과거 평균 +20%
  const AVG_DAYS = 10;       // 과거 평균 10거래일

  test('사이클 표본이 부족하면 insufficient_data', () => {
    const r = evaluateSellSignal(100, 130, 5, AVG_RALLY, AVG_DAYS, MIN_SAMPLE_FOR_RECOMMENDATION - 1);
    expect(r.action).toBe('insufficient_data');
    expect(r.reason).toBeNull();
    // 계산 가능한 값(수익률)은 그대로 보여준다 — 판정만 보류하는 것이다
    expect(r.gainPct).toBeCloseTo(30, 8);
  });

  test('현재가가 없으면(시세 조회 실패) insufficient_data', () => {
    const r = evaluateSellSignal(100, null, 5, AVG_RALLY, AVG_DAYS, 20);
    expect(r.action).toBe('insufficient_data');
    expect(r.gainPct).toBeNull();
  });

  test('진입가가 0/음수면 insufficient_data (0 나눗셈 방지)', () => {
    expect(evaluateSellSignal(0, 100, 5, AVG_RALLY, AVG_DAYS, 20).action).toBe('insufficient_data');
    expect(evaluateSellSignal(-5, 100, 5, AVG_RALLY, AVG_DAYS, 20).action).toBe('insufficient_data');
  });

  test('목표 도달 경계 — 평균 상승폭의 80% 지점', () => {
    expect(AVG_RALLY * TARGET_REACHED_RATIO).toBeCloseTo(16, 8);   // 목표선 = +16%
    const just = evaluateSellSignal(100, 116, 3, AVG_RALLY, AVG_DAYS, 20);
    expect(just.action).toBe('sell');
    expect(just.reason).toBe('target_reached');

    const below = evaluateSellSignal(100, 115.9, 3, AVG_RALLY, AVG_DAYS, 20);
    expect(below.action).toBe('hold');
    expect(below.reason).toBe('in_progress');
  });

  test('기간 초과 — avgDaysToRally 는 거래일이므로 달력일로 환산해서 비교한다', () => {
    const deadline = AVG_DAYS * CALENDAR_DAYS_PER_TRADING_DAY * DURATION_EXCEEDED_RATIO; // 21일
    expect(deadline).toBeCloseTo(21, 8);

    // 21일 미만 — 아직 진행중
    expect(evaluateSellSignal(100, 105, 20, AVG_RALLY, AVG_DAYS, 20).reason).toBe('in_progress');
    // 21일 도달 — 기간 초과
    const over = evaluateSellSignal(100, 105, 21, AVG_RALLY, AVG_DAYS, 20);
    expect(over.action).toBe('sell');
    expect(over.reason).toBe('duration_exceeded');

    // 🔴 회귀 방지: 거래일을 그대로 달력일처럼 비교하면 15일에 이미 발화했을 것이다
    expect(evaluateSellSignal(100, 105, 15, AVG_RALLY, AVG_DAYS, 20).action).toBe('hold');
  });

  test('목표 도달이 기간 초과보다 우선한다', () => {
    const r = evaluateSellSignal(100, 200, 999, AVG_RALLY, AVG_DAYS, 20);
    expect(r.reason).toBe('target_reached');
  });

  test('보유기간을 모르면 기간 초과 판정을 하지 않는다(추측 금지)', () => {
    const r = evaluateSellSignal(100, 105, null, AVG_RALLY, AVG_DAYS, 20);
    expect(r.action).toBe('hold');
    expect(r.daysSinceEntry).toBeNull();
  });

  test('avgRallyPct 가 없으면 insufficient_data', () => {
    expect(evaluateSellSignal(100, 130, 5, null, AVG_DAYS, 20).action).toBe('insufficient_data');
  });

  test('모든 반환값에 면책 문구가 붙는다', () => {
    for (const r of [
      evaluateSellSignal(100, 130, 5, AVG_RALLY, AVG_DAYS, 20),
      evaluateSellSignal(100, null, 5, AVG_RALLY, AVG_DAYS, 20),
      evaluateSellSignal(100, 101, 1, AVG_RALLY, AVG_DAYS, 20),
    ]) {
      expect(r.note).toBe(PRECURSOR_NOTE);
    }
  });
});

describe('targetProgressPct', () => {
  test('목표 대비 진행률', () => {
    expect(targetProgressPct(16, 20)).toBeCloseTo(80, 8);
  });
  test('값이 없거나 목표가 0 이하면 null', () => {
    expect(targetProgressPct(null, 20)).toBeNull();
    expect(targetProgressPct(10, null)).toBeNull();
    expect(targetProgressPct(10, 0)).toBeNull();
    expect(targetProgressPct(10, -3)).toBeNull();
  });
});

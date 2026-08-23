/**
 * 매수/매도 "고려" 추천 — T-033, 목표가 차트 기반 재설계 T-034.
 *
 * 이 스위트가 지키는 것은 **정확한 숫자**가 아니라 **과신 방지 규율**이다:
 *  1. 표본이 적으면 buy/sell 이 아니라 insufficient_data 로 강등된다
 *  2. `null`(평가 못 함)과 `[]`(충족 규칙 없음)이 서로 다른 답을 낸다
 *  3. 모든 반환값이 면책 문구를 들고 다닌다
 *  4. 🔴 **진입가는 매도 목표가·판정에 전혀 영향을 주지 않는다**(T-034 핵심 회귀)
 *  5. 기한 내 도달 근거가 없으면 매수를 권하지 않는다
 */
import { PRECURSOR_NOTE } from '../pattern/precursor-analysis';
import {
  MIN_LIFT_FOR_BUY,
  MIN_SAMPLE_FOR_RECOMMENDATION,
  evaluateBuySignal,
  evaluateSellSignal,
} from '../pattern/recommendation';
import { TARGET_HORIZON_DAYS } from '../pattern/price-targets';
import type { PrecursorRuleStat, PriceTargets } from '../types';

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

/** 기본값: 매수·매도 목표가가 둘 다 기한 내 도달 가능한 정상 상태 */
function targets(over: Partial<PriceTargets> = {}): PriceTargets {
  return {
    asOfDate: '2026-08-20',
    asOfPrice: 100,
    currency: 'KRW',
    atr14: 2,
    expectedMove: 2 * Math.sqrt(10),          // ≈ 6.32
    buyZone: { price: 96, basis: '볼린저 하단(20,2)' },
    sellTarget: { price: 105, basis: '최근 60거래일 고점' },
    buyReachable: true,
    sellReachable: true,
    horizonDays: TARGET_HORIZON_DAYS,
    horizonTradingDays: 10,
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
    expect(r.downgradeReason).toBeNull();
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
    expect(below.downgradeReason).toBeNull();   // 차트 게이트가 아니라 lift 미달이다

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
      evaluateBuySignal(['a'], [rule('a', { lift: 3 })], targets({ buyZone: null, buyReachable: null })),
    ]) {
      expect(r.note).toBe(PRECURSOR_NOTE);
    }
  });

  describe('T-034 — 도달 가능성 게이트 (구 MAX_TIMEFRAME_DAYS_FOR_BUY 대체)', () => {
    test('기한 내 닿을 매수 희망가가 있으면 buy 유지', () => {
      const r = evaluateBuySignal(['a'], [rule('a', { lift: 3 })], targets());
      expect(r.action).toBe('buy');
      expect(r.downgradeReason).toBeNull();
    });

    test('🔴 지지 후보가 없으면 buy 가 아니라 hold — "얼마에 사라"고 할 근거가 없다', () => {
      const r = evaluateBuySignal(
        ['a'], [rule('a', { lift: 3 })],
        targets({ buyZone: null, buyReachable: null }),
      );
      expect(r.action).toBe('hold');
      expect(r.downgradeReason).toBe('no_support_level');
    });

    test('🔴 지지선이 기한 내 기대 변동폭 밖이면 hold', () => {
      const r = evaluateBuySignal(
        ['a'], [rule('a', { lift: 3 })],
        targets({ buyZone: { price: 60, basis: '볼린저 하단(20,2)' }, buyReachable: false }),
      );
      expect(r.action).toBe('hold');
      expect(r.downgradeReason).toBe('buy_zone_unreachable');
    });

    test('도달 여부를 판단할 수 없어도(ATR 산출 불가) buy 로 올리지 않는다', () => {
      const r = evaluateBuySignal(
        ['a'], [rule('a', { lift: 3 })],
        targets({ atr14: null, expectedMove: null, buyReachable: null }),
      );
      expect(r.action).toBe('hold');
      expect(r.downgradeReason).toBe('buy_zone_unreachable');
    });

    test('targets 자체가 없으면(구버전 행·캔들 부족) 게이트를 걸지 않는다 — 결측과 "너무 멂"은 다르다', () => {
      expect(evaluateBuySignal(['a'], [rule('a', { lift: 3 })]).action).toBe('buy');
      expect(evaluateBuySignal(['a'], [rule('a', { lift: 3 })], null).action).toBe('buy');
    });

    test('게이트는 lift 판정 뒤에만 걸린다 — 원래 hold 였던 건 사유가 붙지 않는다', () => {
      const r = evaluateBuySignal(
        ['a'], [rule('a', { lift: MIN_LIFT_FOR_BUY - 0.01 })],
        targets({ buyZone: null, buyReachable: null }),
      );
      expect(r.action).toBe('hold');
      expect(r.downgradeReason).toBeNull();
    });
  });
});

describe('evaluateSellSignal — 판정은 차트 하나로만 (T-034)', () => {
  test('targets 가 없으면 insufficient_data (숫자를 지어내지 않는다)', () => {
    const r = evaluateSellSignal(null, { daysSinceEntry: 5, entryPriceKRW: 100, currentPriceKRW: 130 });
    expect(r.action).toBe('insufficient_data');
    expect(r.reason).toBeNull();
    expect(r.horizonDays).toBeNull();
    // 계산 가능한 값(손익)은 그대로 보여준다 — 판정만 보류하는 것이다
    expect(r.gainPct).toBeCloseTo(30, 8);
  });

  test('현재가가 없으면(시세 조회 실패) 손익만 null 이고 판정은 그대로 나온다', () => {
    const r = evaluateSellSignal(targets(), { daysSinceEntry: 5, entryPriceKRW: 100, currentPriceKRW: null });
    expect(r.gainPct).toBeNull();
    expect(r.action).toBe('hold');
    expect(r.reason).toBe('in_progress');
  });

  test('진입가가 0/음수면 손익을 만들지 않는다(0 나눗셈 방지)', () => {
    expect(evaluateSellSignal(targets(), { entryPriceKRW: 0, currentPriceKRW: 100 }).gainPct).toBeNull();
    expect(evaluateSellSignal(targets(), { entryPriceKRW: -5, currentPriceKRW: 100 }).gainPct).toBeNull();
  });

  test('현재가 위에 저항 후보가 없으면 매도 고려(저항선 돌파)', () => {
    const r = evaluateSellSignal(targets({ sellTarget: null, sellReachable: null }));
    expect(r.action).toBe('sell');
    expect(r.reason).toBe('target_reached');
    expect(r.horizonDays).toBe(TARGET_HORIZON_DAYS);
  });

  test('저항선까지 남은 거리가 ATR14 이내면 "근접"으로 보고 매도 고려', () => {
    // atr14=2, 근접 문턱 = 2×1 = 2. 기준가 100.
    const near = evaluateSellSignal(targets({ sellTarget: { price: 102, basis: '볼린저 상단(20,2)' } }));
    expect(near.action).toBe('sell');
    expect(near.reason).toBe('target_reached');

    const far = evaluateSellSignal(targets({ sellTarget: { price: 102.01, basis: '볼린저 상단(20,2)' } }));
    expect(far.action).toBe('hold');
    expect(far.reason).toBe('in_progress');
  });

  test('근접 문턱은 ATR 에 비례한다 — 변동성이 큰 종목일수록 넓다', () => {
    const calm = evaluateSellSignal(targets({ atr14: 1, sellTarget: { price: 103, basis: 'x' } }));
    const wild = evaluateSellSignal(targets({ atr14: 5, sellTarget: { price: 103, basis: 'x' } }));
    expect(calm.action).toBe('hold');
    expect(wild.action).toBe('sell');
  });

  test('🔴 기한 내 도달 근거가 없으면 판정도 하지 않는다(insufficient_data)', () => {
    const unreachable = evaluateSellSignal(targets({ sellReachable: false }));
    expect(unreachable.action).toBe('insufficient_data');
    expect(unreachable.reason).toBeNull();

    // ATR 산출 불가(reachable=null)도 마찬가지 — false 와 구분 없이 판정 보류
    const unknown = evaluateSellSignal(targets({ atr14: null, expectedMove: null, sellReachable: null }));
    expect(unknown.action).toBe('insufficient_data');
  });

  test('저항선 아래에 있으면 관망 — 기한 숫자는 표시용으로 그대로 실린다', () => {
    const r = evaluateSellSignal(targets());
    expect(r.action).toBe('hold');
    expect(r.reason).toBe('in_progress');
    expect(r.horizonDays).toBe(TARGET_HORIZON_DAYS);
  });

  test('모든 반환값에 면책 문구가 붙는다', () => {
    for (const r of [
      evaluateSellSignal(null),
      evaluateSellSignal(targets()),
      evaluateSellSignal(targets({ sellTarget: null })),
      evaluateSellSignal(targets({ sellReachable: false })),
    ]) {
      expect(r.note).toBe(PRECURSOR_NOTE);
    }
  });

  describe('🔴 T-034 핵심 회귀 — 사용자 포지션은 매도 판단에 개입하지 않는다', () => {
    const t = targets();

    test('보유기간을 아무리 길게 줘도 차트 조건이 같으면 sell 로 바뀌지 않는다', () => {
      // 기간 초과 판정은 폐기됐다(진입일 = 포지션 정보라 "분석은 포지션과 독립" 원칙과 충돌).
      for (const days of [0, 13, 14, 15, 30, 365, 999]) {
        const r = evaluateSellSignal(t, { daysSinceEntry: days });
        expect(r.action).toBe('hold');
        expect(r.reason).toBe('in_progress');
        expect(r.daysSinceEntry).toBe(days);   // 표시용으로는 그대로 실린다
      }
    });

    test('보유기간이 길어도 sell 인 종목은 사유가 항상 차트(target_reached)다', () => {
      const broke = targets({ sellTarget: null, sellReachable: null });
      expect(evaluateSellSignal(broke, { daysSinceEntry: 999 }).reason).toBe('target_reached');
      expect(evaluateSellSignal(broke, { daysSinceEntry: 0 }).reason).toBe('target_reached');
    });

    test('진입가를 어떻게 바꿔도 판정·기한이 변하지 않는다', () => {
      const at = (entry: number) => evaluateSellSignal(t, { daysSinceEntry: 5, entryPriceKRW: entry, currentPriceKRW: 90 });
      const cheap = at(10);          // 크게 이익난 상태
      const expensive = at(675_724); // -18% 물린 상태(실제 NAS:SNPS 사례)
      expect(expensive.action).toBe(cheap.action);
      expect(expensive.reason).toBe(cheap.reason);
      expect(expensive.horizonDays).toBe(cheap.horizonDays);
      // 손익률만 달라진다 — 이건 사용자 참고 표시 전용이다
      expect(expensive.gainPct).not.toBeCloseTo(cheap.gainPct!, 4);
    });

    test('매도 목표가는 애초에 이 함수의 반환값에 없다 — 차트(targets)에서만 나온다', () => {
      const r = evaluateSellSignal(t, { daysSinceEntry: 5, entryPriceKRW: 675_724, currentPriceKRW: 553_109 });
      expect(Object.keys(r).sort()).toEqual(
        ['action', 'daysSinceEntry', 'gainPct', 'horizonDays', 'note', 'reason'],
      );
      // 목표가는 입력으로 준 차트 값 그대로이고 진입가의 함수가 아니다
      expect(t.sellTarget!.price).toBe(105);
    });

    test('포지션 정보를 아예 안 넘겨도 판정이 완전히 동일하다', () => {
      const withPos = evaluateSellSignal(t, { daysSinceEntry: 999, entryPriceKRW: 675_724, currentPriceKRW: 553_109 });
      const without = evaluateSellSignal(t);
      expect(without.action).toBe(withPos.action);
      expect(without.reason).toBe(withPos.reason);
      expect(without.horizonDays).toBe(withPos.horizonDays);
      expect(without.gainPct).toBeNull();
      expect(without.daysSinceEntry).toBeNull();
    });
  });
});

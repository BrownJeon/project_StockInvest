/**
 * T-041 — 스냅샷 구성 비교(순수 모듈).
 *
 * 두 판정이 있고 **목적이 달라 일부러 다르다**:
 *  - `evaluateVanish`: 저장 가드용. T-041 이전 `checkHoldingVanished` 와 동작이 같아야 한다(회귀 방어).
 *  - `assessDrawdownComposition`: 킬스위치용. 소실된 가치가 현금 증가·신규 보유로 *설명되는가*를 본다.
 *    (1차 설계는 총액 감소로 판정해, 정상 매도 뒤 남은 보유의 실제 하락을 관측 불능으로 오인했다 — Reviewer C-1.)
 */
import {
  CASH_CURRENCIES,
  PURE_DISAPPEARANCE_MAX_EVIDENCE_RATIO,
  VANISH_DROP_RATIO,
  VANISH_MIN_SHARE,
  assessDrawdownComposition,
  evaluateVanish,
  parseSnapshotPositions,
} from '@/lib/safety/snapshot-composition';

const pos = (currency: string, value_krw: number) => ({ currency, value_krw });

describe('상수 — 저장 가드의 기존 값과 같아야 한다', () => {
  test('소실 최소 비중 10%, 증발 비율 70%, 현금은 KRW·USD', () => {
    expect(VANISH_MIN_SHARE).toBe(0.10);
    expect(VANISH_DROP_RATIO).toBe(0.7);
    expect([...CASH_CURRENCIES].sort()).toEqual(['KRW', 'USD']);
  });
});

describe('evaluateVanish — 저장 가드의 정의 (T-041 이전 동작 보존)', () => {
  const prev = [pos('KRW', 1_000_000), pos('A', 6_000_000), pos('B', 3_000_000)];   // 총 10M

  test('🔴 종목이 사라지고 대금이 현금으로 안 잡히면 evaporated', () => {
    const r = evaluateVanish(10_000_000, 4_000_000, prev, [pos('KRW', 1_000_000), pos('B', 3_000_000)]);
    expect(r).toMatchObject({ vanished: ['A'], missingKRW: 6_000_000, evaporated: true });
    expect(r.share).toBeCloseTo(0.6);
    expect(r.dropKRW).toBe(6_000_000);
  });

  test('매도 대금이 현금으로 들어오면(총액 보존) evaporated 가 아니다', () => {
    const r = evaluateVanish(10_000_000, 10_000_000, prev, [pos('KRW', 7_000_000), pos('B', 3_000_000)]);
    expect(r.vanished).toEqual(['A']);
    expect(r.evaporated).toBe(false);
  });

  test('실제 폭락(종목 유지, 단가만 하락)은 소실이 아니다', () => {
    const r = evaluateVanish(10_000_000, 7_000_000, prev, [pos('KRW', 1_000_000), pos('A', 3_000_000), pos('B', 3_000_000)]);
    expect(r.vanished).toEqual([]);
    expect(r.evaporated).toBe(false);
  });

  test('현금 항목(KRW·USD)이 사라져도 소실로 치지 않는다 (출금)', () => {
    const r = evaluateVanish(10_000_000, 6_000_000,
      [pos('KRW', 3_000_000), pos('USD', 1_000_000), pos('A', 6_000_000)], [pos('A', 6_000_000)]);
    expect(r.vanished).toEqual([]);
  });

  test('0원으로 기록된 항목도 사라진 것으로 본다 (저장 가드는 0원 sentinel 도 잡아야 한다)', () => {
    const r = evaluateVanish(10_000_000, 4_000_000, prev, [pos('KRW', 1_000_000), pos('A', 0), pos('B', 3_000_000)]);
    expect(r.vanished).toEqual(['A']);
    expect(r.evaporated).toBe(true);
  });

  test('allowZero 에 든 심볼은 소실 판정에서 제외한다', () => {
    const r = evaluateVanish(10_000_000, 4_000_000, prev, [pos('KRW', 1_000_000), pos('B', 3_000_000)],
      { allowZero: new Set(['A']) });
    expect(r.vanished).toEqual([]);
    expect(r.evaporated).toBe(false);
  });

  test('경계: 소실 비중이 정확히 10% 이면 판정하고, 그 아래면 판정하지 않는다', () => {
    const p = [pos('KRW', 1_000_000), pos('A', 1_000_000), pos('B', 8_000_000)];            // A = 10%
    expect(evaluateVanish(10_000_000, 9_000_000, p, [pos('KRW', 1_000_000), pos('B', 8_000_000)]).evaporated).toBe(true);
    const q = [pos('KRW', 1_000_000), pos('A', 999_999), pos('B', 8_000_001)];              // A < 10%
    expect(evaluateVanish(10_000_000, 9_000_001, q, [pos('KRW', 1_000_000), pos('B', 8_000_001)]).evaporated).toBe(false);
  });

  test('경계: 총액 감소가 소실액의 정확히 70% 이면 증발, 그 아래면 이동으로 본다', () => {
    const p = [pos('KRW', 0), pos('A', 5_000_000), pos('B', 5_000_000)];
    const now = [pos('B', 5_000_000)];
    expect(evaluateVanish(10_000_000, 6_500_000, p, now).evaporated).toBe(true);    // drop 3.5M = 70%
    expect(evaluateVanish(10_000_000, 6_500_001, p, now).evaporated).toBe(false);   // drop < 70%
  });

  test('기준 총액이 0 이하이면 판정하지 않는다', () => {
    expect(evaluateVanish(0, 1, prev, []).evaporated).toBe(false);
    expect(evaluateVanish(-5, 1, prev, []).evaporated).toBe(false);
  });

  test('🔴 현재 총액이 비유한(NaN)이면 거부 쪽 — 리팩터 전 동작 보존 (Reviewer L-1)', () => {
    // 이전 구현은 `if (drop < missing*0.7) return null` 이라 drop 이 NaN 이면 거부로 떨어졌다.
    expect(evaluateVanish(10_000_000, Number.NaN, prev, [pos('KRW', 1_000_000), pos('B', 3_000_000)]).evaporated).toBe(true);
    expect(evaluateVanish(10_000_000, Number.NEGATIVE_INFINITY, prev, [pos('B', 3_000_000)]).evaporated).toBe(true);
  });

  test('항목이 깨져 있어도(null·currency 비문자열) 예외 없이 건너뛴다', () => {
    const broken = [null, { currency: 7, value_krw: 5 }, pos('A', 6_000_000)] as never;
    const r = evaluateVanish(10_000_000, 4_000_000, broken, [pos('KRW', 1)] as never);
    expect(r.vanished).toEqual(['A']);
  });
});

describe('assessDrawdownComposition — 킬스위치용: 소실 가치가 *설명되는가*', () => {
  test('🔴 10-03 실사고: 대금이 어디에도 안 잡힘 → 전부 미설명, 보정 후 손실 ≈ 0%', () => {
    const base = [pos('KRW', 80_000), pos('000660', 1_840_000), pos('005930', 2_480_000), pos('NYS:ORCL', 1_150_000),
      pos('NAS:SMH', 1_710_000), pos('NAS:SNPS', 15_266_065), pos('NYS:V', 970_000)];
    const cur = [pos('KRW', 80_000), pos('000660', 1_840_000), pos('005930', 2_480_000), pos('NYS:ORCL', 1_150_000), pos('NYS:V', 970_000)];
    const a = assessDrawdownComposition(23_496_819, 6_515_279, base, cur);
    expect(a.vanished.sort()).toEqual(['NAS:SMH', 'NAS:SNPS']);
    expect(a.vanishedKRW).toBe(16_976_065);
    expect(a.cashDeltaKRW).toBe(0);
    expect(a.newKRW).toBe(0);
    expect(a.explainedKRW).toBe(0);
    expect(a.unexplainedKRW).toBe(16_976_065);
    expect(a.unexplainedShare).toBeCloseTo(0.7225, 3);
    expect(a.suspected).toBe(true);
    expect(a.adjustedDrawdownPct).toBeCloseTo(-0.084, 2);
  });

  test('🔴 C-1: 정상 매도(대금이 KRW 현금으로 잡힘) → 전부 설명됨, 미설명 0, 보정 대상 아님', () => {
    const a = assessDrawdownComposition(10_000_000, 8_800_000,
      [pos('KRW', 0), pos('A', 1_200_000), pos('B', 8_800_000)],
      [pos('KRW', 1_200_000), pos('B', 7_600_000)]);
    expect(a.vanished).toEqual(['A']);
    expect(a.cashDeltaKRW).toBe(1_200_000);
    expect(a.explainedKRW).toBe(1_200_000);
    expect(a.unexplainedKRW).toBe(0);
    expect(a.suspected).toBe(false);
  });

  test('대금이 USD 현금 행으로 잡혀도 설명된다', () => {
    const a = assessDrawdownComposition(10_000_000, 8_800_000,
      [pos('KRW', 0), pos('A', 1_200_000), pos('B', 8_800_000)],
      [pos('USD', 1_200_000), pos('B', 7_600_000)]);
    expect(a.unexplainedKRW).toBe(0);
    expect(a.suspected).toBe(false);
  });

  test('대금이 신규 종목 매수로 이어져도 설명된다 (A → C)', () => {
    const a = assessDrawdownComposition(10_000_000, 8_800_000,
      [pos('KRW', 0), pos('A', 1_200_000), pos('B', 8_800_000)],
      [pos('KRW', 0), pos('C', 1_200_000), pos('B', 7_600_000)]);
    expect(a.newHoldings).toEqual(['C']);
    expect(a.newKRW).toBe(1_200_000);
    expect(a.unexplainedKRW).toBe(0);
    expect(a.suspected).toBe(false);
  });

  test('일부만 설명되면 나머지가 미설명 (소실 3M, 현금 +1M → 미설명 2M)', () => {
    const a = assessDrawdownComposition(10_000_000, 8_000_000,
      [pos('KRW', 0), pos('A', 3_000_000), pos('B', 7_000_000)],
      [pos('KRW', 1_000_000), pos('B', 7_000_000)]);
    expect(a.explainedKRW).toBe(1_000_000);
    expect(a.unexplainedKRW).toBe(2_000_000);
    expect(a.unexplainedShare).toBeCloseTo(0.2);
    expect(a.suspected).toBe(true);
    // 보정 기준 = 기준 총액 - *미설명* 몫(2M). 설명된 몫(현금 +1M)까지 빼면(M11) 기준이 7M 로 어긋나 +14% 가 된다.
    expect(a.adjustedBaselineKRW).toBe(8_000_000);
    expect(a.adjustedDrawdownPct).toBeCloseTo(0);
  });

  test('설명 한도는 소실액 — 현금이 소실액보다 더 늘어도(입금) 초과분은 쓰지 않는다', () => {
    const a = assessDrawdownComposition(10_000_000, 12_000_000,
      [pos('KRW', 0), pos('A', 1_000_000), pos('B', 9_000_000)],
      [pos('KRW', 5_000_000), pos('B', 7_000_000)]);
    expect(a.explainedKRW).toBe(1_000_000);
    expect(a.unexplainedKRW).toBe(0);
  });

  test('현금 감소(출금)는 소실을 설명하지 못한다', () => {
    const a = assessDrawdownComposition(10_000_000, 5_000_000,
      [pos('KRW', 3_000_000), pos('A', 2_000_000), pos('B', 5_000_000)],
      [pos('KRW', 0), pos('B', 5_000_000)]);
    expect(a.cashDeltaKRW).toBe(-3_000_000);
    expect(a.explainedKRW).toBe(0);
    expect(a.unexplainedKRW).toBe(2_000_000);
  });

  test('🔴 0원으로 *기록된* 보유는 소실이 아니다 — 관측된 실제 손실', () => {
    const a = assessDrawdownComposition(10_000_000, 6_000_000,
      [pos('KRW', 1_000_000), pos('A', 4_000_000), pos('B', 5_000_000)],
      [pos('KRW', 1_000_000), pos('A', 0), pos('B', 5_000_000)]);
    expect(a.vanished).toEqual([]);
    expect(a.suspected).toBe(false);
  });

  test('미설명 소실 + 남은 보유의 실제 하락 → 보정 후에도 큰 손실', () => {
    const a = assessDrawdownComposition(20_000_000, 6_000_000,
      [pos('KRW', 1_000_000), pos('A', 10_000_000), pos('B', 9_000_000)],
      [pos('KRW', 1_000_000), pos('B', 5_000_000)]);
    expect(a.suspected).toBe(true);
    expect(a.adjustedBaselineKRW).toBe(10_000_000);
    expect(a.adjustedDrawdownPct).toBeCloseTo(-40);
  });

  test('경계: 미설명 소실이 정확히 10% 이면 보정 대상, 그 아래면 아니다', () => {
    const base = [pos('KRW', 0), pos('A', 1_000_000), pos('B', 9_000_000)];
    expect(assessDrawdownComposition(10_000_000, 9_000_000, base, [pos('B', 9_000_000)]).suspected).toBe(true);
    const base2 = [pos('KRW', 0), pos('A', 999_999), pos('B', 9_000_001)];
    expect(assessDrawdownComposition(10_000_000, 9_000_001, base2, [pos('B', 9_000_001)]).suspected).toBe(false);
  });

  test('보정 기준이 0 이하이면 adjustedDrawdownPct 는 null (호출처는 발동 쪽으로 처리)', () => {
    const a = assessDrawdownComposition(10_000_000, 1_000_000, [pos('A', 10_000_000)], []);
    expect(a.suspected).toBe(true);
    expect(a.adjustedBaselineKRW).toBe(0);
    expect(a.adjustedDrawdownPct).toBeNull();
  });

  test('기준 총액이 0 이하이거나 현재 총액이 유한하지 않으면 판정하지 않는다', () => {
    expect(assessDrawdownComposition(0, 1, [pos('A', 1)], []).suspected).toBe(false);
    expect(assessDrawdownComposition(10_000_000, Number.NaN, [pos('A', 5_000_000)], []).suspected).toBe(false);
  });

  test('value_krw 가 문자열이거나 항목이 깨져 있어도 예외 없이 처리한다', () => {
    const base = [null, { currency: 3, value_krw: 1 }, { currency: 'KRW', value_krw: '0' }, { currency: 'A', value_krw: '1200000' }, { currency: 'B', value_krw: '8800000' }] as never;
    const cur = [{ currency: 'KRW', value_krw: '1200000' }, { currency: 'B', value_krw: '7600000' }] as never;
    const a = assessDrawdownComposition(10_000_000, 8_800_000, base, cur);
    expect(a.vanishedKRW).toBe(1_200_000);
    expect(a.unexplainedKRW).toBe(0);
  });
});

describe('assessDrawdownComposition — 거래 정황과 순수 소실 (C-2)', () => {
  const qpos = (currency: string, qty: number, price: number) => ({ currency, qty, price, value_krw: Math.round(qty * price) });

  test('🔴 10-03 사고 형태는 순수 소실 → suppressible', () => {
    const base = [pos('KRW', 80_000), pos('A', 6_000_000), pos('B', 16_000_000)];
    const cur = [pos('KRW', 80_000), pos('A', 6_000_000)];
    const a = assessDrawdownComposition(22_080_000, 6_080_000, base, cur);
    expect(a.tradingEvidenceKRW).toBe(0);
    expect(a.pureDisappearance).toBe(true);
    expect(a.suppressible).toBe(true);
  });

  test('상수 — 순수 소실 허용치는 소실액의 3% (정책 값, 바꾸면 이 테스트가 알린다)', () => {
    expect(PURE_DISAPPEARANCE_MAX_EVIDENCE_RATIO).toBe(0.03);
  });

  test('현금 유입은 거래 정황 — 소실액의 3% 를 넘으면 순수 소실이 아니다 (경계 포함)', () => {
    const base = [pos('KRW', 0), pos('A', 3_000_000), pos('B', 7_000_000)];
    const withCash = (c: number) => assessDrawdownComposition(10_000_000, 7_000_000 + c, base, [pos('KRW', c), pos('B', 7_000_000)]);
    expect(withCash(90_000).pureDisappearance).toBe(true);         // 소실 3M 의 정확히 3%
    expect(withCash(90_001).pureDisappearance).toBe(false);
    expect(withCash(90_001).suppressible).toBe(false);
  });

  test('현금 감소(출금)는 거래 정황이 아니다 — 증거는 0', () => {
    const a = assessDrawdownComposition(10_000_000, 5_000_000,
      [pos('KRW', 3_000_000), pos('A', 2_000_000), pos('B', 5_000_000)], [pos('KRW', 0), pos('B', 5_000_000)]);
    expect(a.tradingEvidenceKRW).toBe(0);
    expect(a.pureDisappearance).toBe(true);
  });

  test('신규 보유는 거래 정황이다', () => {
    const a = assessDrawdownComposition(10_000_000, 8_800_000,
      [pos('KRW', 0), pos('A', 5_000_000), pos('B', 5_000_000)], [pos('KRW', 0), pos('B', 5_000_000), pos('C', 3_800_000)]);
    expect(a.tradingEvidenceKRW).toBe(3_800_000);
    expect(a.pureDisappearance).toBe(false);
  });

  test('🔴 기존 종목 추가 매수는 *수량 증가*로 감지한다 (수량 증가분 × 현재 단가)', () => {
    const a = assessDrawdownComposition(10_000_000, 8_800_000,
      [pos('KRW', 0), qpos('A', 20, 100_000), qpos('B', 100, 80_000)],
      [pos('KRW', 0), qpos('B', 125, 70_400)]);
    expect(a.commonBuyKRW).toBeCloseTo(25 * 70_400);
    expect(a.pureDisappearance).toBe(false);
  });

  test('가격만 오른 경우(수량 불변)는 추가 매수가 아니다', () => {
    const a = assessDrawdownComposition(10_000_000, 7_300_000,
      [pos('KRW', 0), qpos('A', 10, 300_000), qpos('B', 100, 70_000)], [pos('KRW', 0), qpos('B', 100, 73_000)]);
    expect(a.commonBuyKRW).toBe(0);
    expect(a.pureDisappearance).toBe(true);
  });

  test('수량 감소(일부 매도)는 추가 매수로 치지 않는다', () => {
    const a = assessDrawdownComposition(10_000_000, 6_000_000,
      [pos('KRW', 0), qpos('A', 10, 300_000), qpos('B', 100, 70_000)], [pos('KRW', 0), qpos('B', 60, 70_000)]);
    expect(a.commonBuyKRW).toBe(0);
  });

  test('수량 정보가 없으면 가치 증가분을 추가 매수로 보수적으로 본다', () => {
    const a = assessDrawdownComposition(10_000_000, 7_500_000,
      [pos('KRW', 0), pos('A', 3_000_000), pos('B', 7_000_000)], [pos('KRW', 0), pos('B', 7_500_000)]);
    expect(a.commonBuyKRW).toBe(500_000);
    expect(a.pureDisappearance).toBe(false);
  });

  test('🔴 KRW·USD 현금 행이 동시에 있으면 *합산*한다 (덮어쓰기 아님)', () => {
    const base = [pos('KRW', 1_000_000), pos('USD', 2_000_000), pos('A', 3_000_000), pos('B', 4_000_000)];
    const cur = [pos('KRW', 1_500_000), pos('USD', 2_800_000), pos('B', 4_000_000)];
    const a = assessDrawdownComposition(10_000_000, 8_300_000, base, cur);
    expect(a.cashDeltaKRW).toBe(1_300_000);               // (1.5+2.8) - (1.0+2.0)
    expect(a.explainedKRW).toBe(1_300_000);
    expect(a.unexplainedKRW).toBe(1_700_000);
  });

  test('🔴 같은 종목이 여러 행이면 수량도 합산해 추가 매수를 판정한다', () => {
    // 기준: B 가 두 행(50+50=100주), 현재 125주 → 추가 매수 25주. 마지막 행만 쓰면(50주) 75주로 과대 계산된다.
    const a = assessDrawdownComposition(10_000_000, 8_800_000,
      [pos('KRW', 0), qpos('A', 20, 100_000), qpos('B', 50, 80_000), qpos('B', 50, 80_000)],
      [pos('KRW', 0), qpos('B', 125, 70_400)]);
    expect(a.commonBuyKRW).toBeCloseTo(25 * 70_400);
  });

  test('같은 코드가 여러 행이면 현금·보유 모두 합산한다 (대칭)', () => {
    const base = [pos('KRW', 0), pos('A', 1_000_000), pos('A', 2_000_000), pos('B', 7_000_000)];
    const a = assessDrawdownComposition(10_000_000, 7_000_000, base, [pos('KRW', 0), pos('B', 7_000_000)]);
    expect(a.vanishedKRW).toBe(3_000_000);
    const cur = [pos('KRW', 0), pos('B', 3_000_000), pos('B', 4_000_000), pos('C', 500_000), pos('C', 500_000)];
    const b = assessDrawdownComposition(10_000_000, 8_000_000, [pos('KRW', 0), pos('A', 3_000_000), pos('B', 7_000_000)], cur);
    expect(b.newKRW).toBe(1_000_000);
  });
});

describe('parseSnapshotPositions', () => {
  test('JSON 문자열과 이미 파싱된 배열을 모두 읽는다', () => {
    const arr = [pos('A', 1)];
    expect(parseSnapshotPositions(JSON.stringify(arr))).toEqual(arr);
    expect(parseSnapshotPositions(arr)).toEqual(arr);
  });

  test('🔴 읽을 수 없으면 null — 호출처가 "구성 비교 불가"로 다룰 수 있게 한다', () => {
    expect(parseSnapshotPositions(undefined)).toBeNull();
    expect(parseSnapshotPositions(null)).toBeNull();
    expect(parseSnapshotPositions('not json')).toBeNull();
    expect(parseSnapshotPositions('{"a":1}')).toBeNull();      // 배열이 아님
    expect(parseSnapshotPositions({ a: 1 })).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// M-1 · M-2 — 3라운드 독립 감사가 남긴 두 개의 보류 우회 (T-041 후속)
// ═══════════════════════════════════════════════════════════════════════════

const hold = (currency: string, value_krw: number, qty: number) => ({ currency, value_krw, qty, price: qty > 0 ? value_krw / qty : 0 });

describe('M-1 — 가치 0 으로 기록됐지만 수량이 있는 보유는 거래 정황이다', () => {
  test('🔴 감사 재현: A 매도 + 신규 C 를 qty 50·가치 0 으로 기록 → 순수 소실이 아니다(발동)', () => {
    // 기준 [A 5M, B 5M] 10M → 현재 [B 5M, C(qty50, value 0)] 5M. 예전에는 C 가 값 > 0 이 아니라 걸러져 보류됐다.
    const base = [hold('KRW', 0, 0), hold('A', 5_000_000, 5), hold('B', 5_000_000, 5)];
    const cur = [hold('KRW', 0, 0), hold('B', 5_000_000, 5), hold('C', 0, 50)];
    const a = assessDrawdownComposition(10_000_000, 5_000_000, base, cur);
    expect(a.vanished).toEqual(['A']);
    expect(a.unpricedTradingCodes).toEqual(['C']);
    expect(a.pureDisappearance).toBe(false);
    expect(a.suppressible).toBe(false);
  });

  test('같은 입력에서 C 가 없으면(기록 자체가 없음) 예전처럼 순수 소실 — 10-03 사고 형태는 그대로 보류', () => {
    const base = [hold('KRW', 0, 0), hold('A', 5_000_000, 5), hold('B', 5_000_000, 5)];
    const cur = [hold('KRW', 0, 0), hold('B', 5_000_000, 5)];
    const a = assessDrawdownComposition(10_000_000, 5_000_000, base, cur);
    expect(a.unpricedTradingCodes).toEqual([]);
    expect(a.pureDisappearance).toBe(true);
    expect(a.suppressible).toBe(true);
  });

  test('수량 0·가치 0 으로 기록된 행은 보유가 아니다 → 정황 아님', () => {
    const base = [hold('KRW', 0, 0), hold('A', 5_000_000, 5), hold('B', 5_000_000, 5)];
    const cur = [hold('KRW', 0, 0), hold('B', 5_000_000, 5), hold('C', 0, 0)];
    const a = assessDrawdownComposition(10_000_000, 5_000_000, base, cur);
    expect(a.unpricedTradingCodes).toEqual([]);
    expect(a.pureDisappearance).toBe(true);
  });

  test('기존 종목이 가치 0 으로 기록되고 수량이 늘었다 → 기준 단가로 환산한 추가 매수', () => {
    // B 기준 qty 10·5M(단가 500k) → 현재 qty 15·가치 0: 증가 5주 × 500k = 2.5M
    const base = [hold('KRW', 0, 0), hold('A', 5_000_000, 5), hold('B', 5_000_000, 10)];
    const cur = [hold('KRW', 0, 0), hold('B', 0, 15)];
    const a = assessDrawdownComposition(10_000_000, 0, base, cur);
    expect(a.commonBuyKRW).toBe(2_500_000);
    expect(a.unpricedTradingCodes).toEqual([]);
    expect(a.pureDisappearance).toBe(false);
  });

  test('기존 종목이 가치 0 으로 기록됐지만 수량이 그대로 → 거래 정황 아님(상폐·시세 0 은 *관측된 손실*)', () => {
    const base = [hold('KRW', 0, 0), hold('A', 4_000_000, 4), hold('B', 3_000_000, 3), hold('C', 3_000_000, 3)];
    const cur = [hold('KRW', 0, 0), hold('B', 3_000_000, 3), hold('C', 0, 3)];
    const a = assessDrawdownComposition(10_000_000, 3_000_000, base, cur);
    expect(a.commonBuyKRW).toBe(0);
    expect(a.unpricedTradingCodes).toEqual([]);
    expect(a.pureDisappearance).toBe(true);
  });

  test('기준 수량을 몰라 증가 여부를 증명할 수 없는 가치 0 보유 → 정황으로 본다(발동 쪽)', () => {
    const base = [hold('KRW', 0, 0), hold('A', 5_000_000, 5), { currency: 'B', value_krw: 5_000_000 }];   // qty 없는 구형 행
    const cur = [hold('KRW', 0, 0), hold('B', 0, 7)];
    const a = assessDrawdownComposition(10_000_000, 0, base, cur);
    expect(a.unpricedTradingCodes).toEqual(['B']);
    expect(a.pureDisappearance).toBe(false);
  });

  test('수량이 늘었는데 단가를 어디서도 구할 수 없으면(기준 수량 0·현재 가치 0) 정황으로 본다', () => {
    // 기준 행이 qty 0 인데 가치가 양수인 손상 행 → 기준 단가 불가. 현재도 가치 0 → 단가 불가 → 증가 사실만 남는다.
    const base = [hold('KRW', 0, 0), hold('A', 5_000_000, 5), hold('B', 5_000_000, 0)];
    const cur = [hold('KRW', 0, 0), hold('B', 0, 5)];
    const a = assessDrawdownComposition(10_000_000, 0, base, cur);
    expect(a.commonBuyKRW).toBe(0);
    expect(a.unpricedTradingCodes).toEqual(['B']);
    expect(a.pureDisappearance).toBe(false);
  });

  test('같은 코드의 가치 0 행이 섞여도 현재 단가가 희석되지 않는다', () => {
    // B 기준 qty 10·5M. 현재 행 2개: (qty 10·6M) + (qty 5·0원) → 합계 qty 15, 단가는 가치가 있는 행만으로 600k
    const base = [hold('KRW', 0, 0), hold('A', 5_000_000, 5), hold('B', 5_000_000, 10)];
    const cur = [hold('KRW', 0, 0), hold('B', 6_000_000, 10), hold('B', 0, 5)];
    const a = assessDrawdownComposition(10_000_000, 6_000_000, base, cur);
    expect(a.commonBuyKRW).toBe(3_000_000);                    // 5주 × 600k (희석되면 2M)
    expect(a.pureDisappearance).toBe(false);
  });
});

describe('M-3 — 기준에도 0원으로 기록돼 있던 종목(영구 0원 행)은 신규가 아니다', () => {
  // 4라운드 독립 감사 재현: "신규" 판정이 값>0 행만 보던 baseHoldings 를 써서, 양쪽 스냅샷에 있는 0원 행이
  // "신규 + 가치 미기록" 으로 읽혀 모든 보류가 꺼졌다 (허용 심볼 `snapshot_zero_price_symbols` 가 있는 동안).
  const base = [hold('KRW', 0, 0), hold('A', 5_000_000, 5), hold('B', 5_000_000, 5), hold('HALT', 0, 10)];

  test('🔴 감사 재현: 양쪽에 같은 수량의 0원 행 → 정황 아님, 순수 소실 보류 유지', () => {
    const cur = [hold('KRW', 0, 0), hold('B', 5_000_000, 5), hold('HALT', 0, 10)];
    const a = assessDrawdownComposition(10_000_000, 5_000_000, base, cur);
    expect(a.vanished).toEqual(['A']);
    expect(a.unpricedTradingCodes).toEqual([]);
    expect(a.newHoldings).toEqual([]);
    expect(a.pureDisappearance).toBe(true);
    expect(a.suppressible).toBe(true);
  });

  test('0원 행의 수량이 줄었어도 정황 아님', () => {
    const cur = [hold('KRW', 0, 0), hold('B', 5_000_000, 5), hold('HALT', 0, 8)];
    const a = assessDrawdownComposition(10_000_000, 5_000_000, base, cur);
    expect(a.unpricedTradingCodes).toEqual([]);
    expect(a.pureDisappearance).toBe(true);
  });

  test('0원 행의 수량이 늘었다 → 추가 매수 정황(금액 불명) → 발동 쪽', () => {
    const cur = [hold('KRW', 0, 0), hold('B', 5_000_000, 5), hold('HALT', 0, 12)];
    const a = assessDrawdownComposition(10_000_000, 5_000_000, base, cur);
    expect(a.unpricedTradingCodes).toEqual(['HALT']);
    expect(a.pureDisappearance).toBe(false);
  });

  test('기준의 0원 행에 수량 정보가 없어 증가를 증명할 수 없다 → 정황으로 본다', () => {
    const legacy = [hold('KRW', 0, 0), hold('A', 5_000_000, 5), hold('B', 5_000_000, 5), { currency: 'HALT', value_krw: 0 }];
    const cur = [hold('KRW', 0, 0), hold('B', 5_000_000, 5), hold('HALT', 0, 10)];
    const a = assessDrawdownComposition(10_000_000, 5_000_000, legacy, cur);
    expect(a.unpricedTradingCodes).toEqual(['HALT']);
    expect(a.pureDisappearance).toBe(false);
  });

  test('기준에 0원이던 종목의 가격 복귀는 금액이 있는 신규 정황 (3라운드 동작 유지)', () => {
    const cur = [hold('KRW', 0, 0), hold('B', 5_000_000, 5), hold('HALT', 3_000_000, 10)];
    const a = assessDrawdownComposition(10_000_000, 8_000_000, base, cur);
    expect(a.newHoldings).toEqual(['HALT']);
    expect(a.newKRW).toBe(3_000_000);
    expect(a.unpricedTradingCodes).toEqual([]);
    expect(a.pureDisappearance).toBe(false);
  });

  test('기준에 행이 전혀 없던 값 0 신규 보유는 여전히 정황 (M-1 유지)', () => {
    const cur = [hold('KRW', 0, 0), hold('B', 5_000_000, 5), hold('HALT', 0, 10), hold('C', 0, 50)];
    const a = assessDrawdownComposition(10_000_000, 5_000_000, base, cur);
    expect(a.unpricedTradingCodes).toEqual(['C']);
    expect(a.pureDisappearance).toBe(false);
  });
});

describe('M-2 — 현금 유입은 통화 행별 양의 증가로 센다 (순변화로 상쇄하지 않는다)', () => {
  test('🔴 감사 재현: 매도 대금이 USD 행으로 들어오고 같은 날 원화 출금 → 순변화 0 이어도 정황이다', () => {
    // 기준 [KRW 3M, US A 4M, US B 3M] → A 를 2.8M 에 매도(USD +2.8M), KRW 2.8M 출금 → [KRW 0.2M, USD 2.8M, B 3M]
    const base = [pos('KRW', 3_000_000), pos('A', 4_000_000), pos('B', 3_000_000)];
    const cur = [pos('KRW', 200_000), pos('USD', 2_800_000), pos('B', 3_000_000)];
    const a = assessDrawdownComposition(10_000_000, 6_000_000, base, cur);
    expect(a.cashDeltaKRW).toBe(0);                            // 순변화는 0 — 예전 증거는 여기서 0 이었다
    expect(a.cashInflowKRW).toBe(2_800_000);
    expect(a.tradingEvidenceKRW).toBe(2_800_000);
    expect(a.pureDisappearance).toBe(false);
    expect(a.suppressible).toBe(false);
  });

  test('반대 방향도 같다: KRW 증가 + USD 감소', () => {
    const base = [pos('KRW', 1_000_000), pos('USD', 3_000_000), pos('A', 4_000_000), pos('B', 2_000_000)];
    const cur = [pos('KRW', 3_800_000), pos('USD', 200_000), pos('B', 2_000_000)];
    const a = assessDrawdownComposition(10_000_000, 6_000_000, base, cur);
    expect(a.cashDeltaKRW).toBe(0);
    expect(a.cashInflowKRW).toBe(2_800_000);
    expect(a.pureDisappearance).toBe(false);
  });

  test('출금만 있으면(현금이 줄기만) 유입 0 → 10-03 사고 형태는 여전히 순수 소실', () => {
    const base = [pos('KRW', 3_000_000), pos('A', 4_000_000), pos('B', 3_000_000)];
    const cur = [pos('KRW', 1_000_000), pos('B', 3_000_000)];
    const a = assessDrawdownComposition(10_000_000, 4_000_000, base, cur);
    expect(a.cashInflowKRW).toBe(0);
    expect(a.pureDisappearance).toBe(true);
  });

  test('경계: 한 통화의 먼지 수준 증가(소실의 3% 이내)는 정황이 아니다 — 과잉 발동 방지', () => {
    // V = 4M → 허용치 120k. USD +50k, KRW 출금 → 유입 50k ≤ 120k
    const base = [pos('KRW', 3_000_000), pos('A', 4_000_000), pos('B', 3_000_000)];
    const cur = [pos('KRW', 2_000_000), pos('USD', 50_000), pos('B', 3_000_000)];
    const a = assessDrawdownComposition(10_000_000, 5_050_000, base, cur);
    expect(a.cashInflowKRW).toBe(50_000);
    expect(a.pureDisappearance).toBe(true);
  });

  test('경계: 정확히 3%(120k)는 순수 소실, 1원 초과면 정황', () => {
    const base = [pos('KRW', 3_000_000), pos('A', 4_000_000), pos('B', 3_000_000)];
    const at = assessDrawdownComposition(10_000_000, 5_120_000, base,
      [pos('KRW', 2_000_000), pos('USD', 120_000), pos('B', 3_000_000)]);
    expect(at.pureDisappearance).toBe(true);
    const over = assessDrawdownComposition(10_000_000, 5_120_001, base,
      [pos('KRW', 2_000_000), pos('USD', 120_001), pos('B', 3_000_000)]);
    expect(over.pureDisappearance).toBe(false);
  });

  test('같은 통화의 현금 행이 여러 개면 *합산*해서 비교한다 (덮어쓰면 증가가 사라진다)', () => {
    // KRW 행 둘: 기준 1M+2M=3M → 현재 2M+2M=4M ⇒ 유입 1M. 마지막 행만 읽으면 2M → 2M 으로 보여 0.
    const base = [pos('KRW', 1_000_000), pos('KRW', 2_000_000), pos('A', 4_000_000), pos('B', 3_000_000)];
    const cur = [pos('KRW', 2_000_000), pos('KRW', 2_000_000), pos('B', 3_000_000)];
    const a = assessDrawdownComposition(10_000_000, 7_000_000, base, cur);
    expect(a.cashDeltaKRW).toBe(1_000_000);
    expect(a.cashInflowKRW).toBe(1_000_000);
    expect(a.pureDisappearance).toBe(false);
  });

  test('기준에 없던 통화 행이 새로 생겨도 유입으로 센다', () => {
    const base = [pos('KRW', 3_000_000), pos('A', 4_000_000), pos('B', 3_000_000)];
    const cur = [pos('KRW', 0), pos('USD', 1_000_000), pos('B', 3_000_000)];
    const a = assessDrawdownComposition(10_000_000, 4_000_000, base, cur);
    expect(a.cashInflowKRW).toBe(1_000_000);
    expect(a.pureDisappearance).toBe(false);
  });
});

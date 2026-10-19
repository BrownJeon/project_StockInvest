/**
 * T-055 1단계 — 매도 제안 판정기(`evaluateSellProposal`) 계약.
 *
 * 이 판정기는 2단계에서 **사람 승인용 매도 시그널**의 원천이 된다. 그래서 1단계(읽기 전용)부터
 * 다음을 고정한다:
 *  1. 경계값 — 진입가 대비 −6.00% 는 대상, −5.99% 는 아님 (≤ 비교).
 *  2. 히스테리시스 — 활성 제안은 임계값 위로 1%p 이상 회복해야 철회된다.
 *  3. 재제안(restep) — 거절·만료·철회 뒤에는 기준가 대비 추가 −5% 이상일 때만 다시 대상.
 *  4. 입력 결손 — 진입가·현재가·수량·정책이 비정상이면 **제안하지 않는다**(fail-closed).
 *  5. 🔴 출력에 `exit_kind` 가 없다 — `router.ts` 의 강제 auto_submit 분기 입력을 만들지 않는다.
 */
import {
  evaluateSellProposal,
  validateSellProposalPolicy,
  SELL_PROPOSAL_STRATEGY_ID,
  type SellProposalPolicy,
  type SellProposalLastDecision,
} from '../sell-proposal';
import type { PositionState } from '../position-state';
import type { Ticker } from '@/lib/exchanges/types';

jest.mock('@/lib/db', () => ({ getPool: () => { throw new Error('판정기는 DB 를 쓰면 안 된다'); } }));

const POLICY: SellProposalPolicy = { stopPct: 6, restepPct: 5, reboundExitPct: 1 };
const ENTRY = 100_000;

function state(over: Partial<PositionState> = {}): PositionState {
  return {
    symbol: '005930', market: 'domestic',
    entryPrice: ENTRY, peakPrice: ENTRY, qty: 9,
    scenarioExit: null, holdingDeadline: null,
    firstSeenAt: new Date('2026-06-30T00:00:00Z'), updatedAt: new Date('2026-10-19T00:00:00Z'),
    ...over,
  };
}
function ticker(price: number, over: Partial<Ticker> = {}): Ticker {
  return { symbol: '005930', price, timestamp: 0, ...over };
}
/** pnl% 가 정확히 p 가 되는 가격 (ENTRY=100,000 이라 0.01% = 10원) */
const priceAt = (pnlPct: number) => Math.round(ENTRY * (1 + pnlPct / 100));

function deepKeys(v: unknown, acc: string[] = []): string[] {
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) { acc.push(k); deepKeys(x, acc); }
  }
  return acc;
}

describe('경계값 — 진입가 대비 −6%', () => {
  test.each([
    [-5.99, 'skip'],
    [-6.00, 'pass'],
    [-6.01, 'pass'],
    [-51.0, 'pass'],
    [0, 'skip'],
    [+3.0, 'skip'],
  ] as const)('손익 %s%% → %s', (pnl, verdict) => {
    const r = evaluateSellProposal(state(), ticker(priceAt(pnl)), POLICY, null);
    expect(r.verdict).toBe(verdict);
    expect(r.pnlPct).toBeCloseTo(pnl, 6);
    expect(r.thresholdPct).toBe(-6);
    if (r.verdict === 'skip') expect(r.reason).toBe('above_threshold');
    if (r.verdict === 'pass') expect(r.trigger).toBe('stop');
  });

  test('부동소수 오차로 정확히 −6.00% 가 빠지지 않는다 (진입가 1,092.5 · 현재가 1,026.95)', () => {
    // 수학적으로 정확히 −6% 지만 JS 로는 (1026.95-1092.5)/1092.5*100 = -5.999999999999996 이 된다.
    // (해외 진입가는 USD 평단 × 환율이라 소수 원화가 실제로 나온다.)
    expect((1026.95 - 1092.5) / 1092.5 * 100).toBeGreaterThan(-6);   // 전제 확인
    const r = evaluateSellProposal(state({ entryPrice: 1_092.5 }), ticker(1_026.95), POLICY, null);
    expect(r.verdict).toBe('pass');
    expect(r.pnlPct).toBe(-6);
  });

  test('임계값은 정책 값을 따른다 (stopPct=10 이면 −9.99% 는 대상 아님)', () => {
    const p = { ...POLICY, stopPct: 10 };
    expect(evaluateSellProposal(state(), ticker(priceAt(-9.99)), p, null).verdict).toBe('skip');
    expect(evaluateSellProposal(state(), ticker(priceAt(-10)), p, null).verdict).toBe('pass');
  });
});

describe('제안 초안 — 전량·시장가, exit_kind 없음', () => {
  const r = evaluateSellProposal(state({ qty: 9 }), ticker(priceAt(-33.63)), POLICY, null);
  if (r.verdict !== 'pass') throw new Error('fixture must pass');

  test('전량 매도 · 시장가 · 금액 = 수량 × 현재가', () => {
    expect(r.draft.strategyId).toBe(SELL_PROPOSAL_STRATEGY_ID);
    expect(r.draft.strategyId).toBe('sell-proposal-v1');
    expect(r.draft.side).toBe('sell');
    expect(r.draft.orderType).toBe('market');
    expect(r.draft.quantity).toBe(9);
    expect(r.draft.amountKRW).toBe(9 * priceAt(-33.63));
    expect(r.draft.symbol).toBe('005930');
  });

  test('🔴 indicators 어디에도 exit_kind 가 없다 (강제 auto_submit 분기 입력 금지)', () => {
    const keys = deepKeys(r.draft);
    expect(keys).not.toContain('exit_kind');
    expect(keys).not.toContain('exitKind');
    expect(JSON.stringify(r.draft)).not.toMatch(/exit_?kind/i);
  });

  test('🔴 indicators 에 ai(시나리오·진입 구간) 키가 없다 — 승인 경로가 진입 감시로 새지 않게', () => {
    const keys = deepKeys(r.draft);
    expect(keys).not.toContain('ai');
    expect(keys).not.toContain('scenario');
    expect(keys).not.toContain('price_zone');
  });

  test('indicators.proposal 에 판정 근거가 남는다', () => {
    const p = (r.draft.indicators as { proposal: Record<string, unknown> }).proposal;
    expect(p.kind).toBe('stop_loss');
    expect(p.trigger).toBe('stop');
    expect(p.entry_price).toBe(ENTRY);
    expect(p.current_price).toBe(priceAt(-33.63));
    expect(p.threshold_pct).toBe(-6);
    expect(Number(p.pnl_pct)).toBeCloseTo(-33.63, 4);
    expect(p.reference_price).toBeNull();
  });

  test('사유 문구에 손익·임계값·KIS 매입평균 기준이 들어간다', () => {
    expect(r.draft.reasoning).toContain('-33.63%');
    expect(r.draft.reasoning).toContain('-6%');
    expect(r.draft.reasoning).toContain('KIS 매입평균');
  });

  test('해외 종목은 원화 환산가(price)로만 판정한다 — USD 원가는 읽지 않는다 (T-035 통화 경계)', () => {
    const o = evaluateSellProposal(
      state({ symbol: 'NAS:MU', market: 'overseas', entryPrice: 1_422_003, qty: 11 }),
      ticker(1_197_425, { symbol: 'NAS:MU', priceUsd: 851.2 }),
      POLICY, null,
    );
    if (o.verdict !== 'pass') throw new Error('must pass');
    const p = (o.draft.indicators as { proposal: Record<string, unknown> }).proposal;
    expect(p.current_price).toBe(1_197_425);
    expect(JSON.stringify(o.draft)).not.toContain('851.2');
    expect(o.pnlPct).toBeCloseTo(-15.7932, 3);
    expect(o.draft.quantity).toBe(11);
  });
});

describe('보유 0·수량 이상', () => {
  test.each([
    [0, 'no_position'],
    [null, 'no_position'],
    [-3, 'no_position'],
    [Number.NaN, 'no_position'],
    [Number.POSITIVE_INFINITY, 'no_position'],
    [0.5, 'quantity_below_min'],
  ] as const)('qty=%s → skip(%s)', (qty, reason) => {
    const r = evaluateSellProposal(state({ qty: qty as number | null }), ticker(priceAt(-20)), POLICY, null);
    expect(r.verdict).toBe('skip');
    if (r.verdict === 'skip') expect(r.reason).toBe(reason);
  });

  test('수량이 줄면 그 수량으로 제안한다 (부분 체결·수동 매도 반영)', () => {
    const r = evaluateSellProposal(state({ qty: 4 }), ticker(priceAt(-20)), POLICY, null);
    if (r.verdict !== 'pass') throw new Error('must pass');
    expect(r.draft.quantity).toBe(4);
    expect(r.draft.amountKRW).toBe(4 * priceAt(-20));
  });

  test('소수 수량은 정수 주로 내림한다 (주식은 정수 주만 주문 가능)', () => {
    const r = evaluateSellProposal(state({ qty: 3.7 }), ticker(priceAt(-20)), POLICY, null);
    if (r.verdict !== 'pass') throw new Error('must pass');
    expect(r.draft.quantity).toBe(3);
  });
});

describe('진입가·현재가 결손·비정상 — 제안하지 않는다', () => {
  test.each([
    [0], [-1], [Number.NaN], [Number.POSITIVE_INFINITY],
  ])('현재가 %s → price_invalid', (price) => {
    const r = evaluateSellProposal(state(), ticker(price), POLICY, null);
    expect(r).toMatchObject({ verdict: 'skip', reason: 'price_invalid', pnlPct: null });
  });

  test.each([
    [0], [-1], [Number.NaN], [Number.POSITIVE_INFINITY],
  ])('진입가 %s → entry_invalid', (entryPrice) => {
    const r = evaluateSellProposal(state({ entryPrice }), ticker(priceAt(-20)), POLICY, null);
    expect(r).toMatchObject({ verdict: 'skip', reason: 'entry_invalid', pnlPct: null });
  });

  test('ticker 자체가 없으면 price_invalid', () => {
    const r = evaluateSellProposal(state(), undefined as unknown as Ticker, POLICY, null);
    expect(r).toMatchObject({ verdict: 'skip', reason: 'price_invalid' });
  });

  test('state 자체가 없으면 entry_invalid', () => {
    const r = evaluateSellProposal(null as unknown as PositionState, ticker(priceAt(-20)), POLICY, null);
    expect(r).toMatchObject({ verdict: 'skip', reason: 'entry_invalid' });
  });

  test.each([
    [0.29], [3.01], [0.001], [100],
  ])('가격/진입가 비율 %s (USD/KRW 단위 불일치) → unit_mismatch', (ratio) => {
    const r = evaluateSellProposal(state(), ticker(ENTRY * ratio), POLICY, null);
    expect(r).toMatchObject({ verdict: 'skip', reason: 'unit_mismatch' });
  });

  test('비율 0.49 (000660 −51%) 는 단위 범위 안이라 대상이다', () => {
    const r = evaluateSellProposal(state({ entryPrice: 2_641_000 }), ticker(1_294_000), POLICY, null);
    expect(r.verdict).toBe('pass');
  });
});

describe('정책 결손·범위 밖 — 판정기도 스스로 거부한다 (방어 2겹)', () => {
  test.each([
    [{ stopPct: Number.NaN }],
    [{ stopPct: 0 }],
    [{ stopPct: -6 }],
    [{ stopPct: 0.5 }],
    [{ stopPct: 51 }],
    [{ restepPct: 0 }],
    [{ restepPct: 51 }],
    [{ reboundExitPct: -1 }],
    [{ reboundExitPct: 5.1 }],
    [{ reboundExitPct: 6 }],
    [{ stopPct: 2, reboundExitPct: 3 }],   // 각자 범위 안이지만 rebound ≥ stop → 철회 밴드가 진입가 위
    [{ stopPct: 3, reboundExitPct: 3 }],
    [{ stopPct: '6' as unknown as number }],
  ])('%j → policy_invalid', (over) => {
    const r = evaluateSellProposal(state(), ticker(priceAt(-20)), { ...POLICY, ...over }, null);
    expect(r).toMatchObject({ verdict: 'skip', reason: 'policy_invalid' });
  });

  test('정책이 null 이면 policy_invalid', () => {
    const r = evaluateSellProposal(state(), ticker(priceAt(-20)), null as unknown as SellProposalPolicy, null);
    expect(r).toMatchObject({ verdict: 'skip', reason: 'policy_invalid' });
  });

  test('validateSellProposalPolicy 는 문제 목록을 돌려준다', () => {
    expect(validateSellProposalPolicy(POLICY)).toEqual([]);
    expect(validateSellProposalPolicy({ ...POLICY, stopPct: 0 }).length).toBeGreaterThan(0);
  });
});

describe('히스테리시스 — 활성 제안은 1%p 이상 회복해야 철회', () => {
  const active = (ref = priceAt(-6.2)): SellProposalLastDecision => ({ status: 'active', referencePrice: ref });

  test.each([
    [-6.20, 'pass'],
    [-5.50, 'pass'],    // 임계값 위로 올라왔지만 밴드 안 — 유지
    [-5.01, 'pass'],
    [-5.00, 'skip'],    // −6 + 1 = −5 이상 회복 → 철회
    [-4.99, 'skip'],
    [+1.00, 'skip'],
  ] as const)('활성 제안 + 손익 %s%% → %s', (pnl, verdict) => {
    const r = evaluateSellProposal(state(), ticker(priceAt(pnl)), POLICY, active());
    expect(r.verdict).toBe(verdict);
    if (r.verdict === 'pass') expect(r.trigger).toBe('hold');
    if (r.verdict === 'skip') expect(r.reason).toBe('rebound_withdraw');
  });

  test('활성 제안이 없을 때 −5.50% 는 대상이 아니다 (밴드는 활성 제안에만)', () => {
    expect(evaluateSellProposal(state(), ticker(priceAt(-5.5)), POLICY, null).verdict).toBe('skip');
  });
});

describe('재제안(restep) — 거절·만료·철회 뒤에는 기준가 대비 추가 −5%', () => {
  // 기준가 = 거절 당시 제안 가격. −6% 에서 거절 → 진입가 대비가 아니라 기준가 대비로 본다.
  const REF = priceAt(-6);                       // 94,000
  const priceFromRef = (dropPct: number) => Math.round(REF * (1 + dropPct / 100));

  for (const status of ['rejected', 'expired', 'superseded'] as const) {
    test(`${status}: 기준가 대비 −4.99% 는 침묵, −5.00% 는 재제안`, () => {
      const last: SellProposalLastDecision = { status, referencePrice: REF };
      const quiet = evaluateSellProposal(state(), ticker(priceFromRef(-4.99)), POLICY, last);
      expect(quiet).toMatchObject({ verdict: 'skip', reason: 'restep_not_met' });

      const again = evaluateSellProposal(state(), ticker(priceFromRef(-5)), POLICY, last);
      expect(again.verdict).toBe('pass');
      if (again.verdict === 'pass') {
        expect(again.trigger).toBe('restep');
        const p = (again.draft.indicators as { proposal: Record<string, unknown> }).proposal;
        expect(p.reference_price).toBe(REF);
      }
    });
  }

  test('설계 예시: −6 거절 → −10.9 침묵 → −11.0 재제안 (진입가 기준 근사)', () => {
    const last: SellProposalLastDecision = { status: 'rejected', referencePrice: REF };
    // 기준가 94,000 의 −5% = 89,300 = 진입가 대비 −10.7%. 설계 문서의 "−11%" 는 근사치다.
    expect(evaluateSellProposal(state(), ticker(89_310), POLICY, last).verdict).toBe('skip');
    expect(evaluateSellProposal(state(), ticker(89_300), POLICY, last).verdict).toBe('pass');
  });

  test('거절 뒤라도 진입가 대비 −6% 위로 회복했으면 재제안하지 않는다', () => {
    const last: SellProposalLastDecision = { status: 'rejected', referencePrice: priceAt(-20) };
    // 기준가 대비로는 크게 올랐다(−20 → −3) — 하락 단계 조건 자체가 불충족
    const r = evaluateSellProposal(state(), ticker(priceAt(-3)), POLICY, last);
    expect(r).toMatchObject({ verdict: 'skip', reason: 'above_threshold' });
  });

  test.each([
    [0], [-5], [Number.NaN], [null], [undefined],
  ])('기준가 %s 이면 재제안하지 않는다 (reference_invalid, fail-closed)', (ref) => {
    const last = { status: 'rejected', referencePrice: ref } as unknown as SellProposalLastDecision;
    const r = evaluateSellProposal(state(), ticker(priceAt(-30)), POLICY, last);
    expect(r).toMatchObject({ verdict: 'skip', reason: 'reference_invalid' });
  });

  test('알 수 없는 결정 상태는 제안하지 않는다 (decision_invalid)', () => {
    const last = { status: 'approved', referencePrice: REF } as unknown as SellProposalLastDecision;
    const r = evaluateSellProposal(state(), ticker(priceAt(-30)), POLICY, last);
    expect(r).toMatchObject({ verdict: 'skip', reason: 'decision_invalid' });
  });
});

describe('순수성', () => {
  test('입력 객체를 변경하지 않는다', () => {
    const s = state();
    const t = ticker(priceAt(-20));
    const p = { ...POLICY };
    const sSnap = JSON.stringify(s); const tSnap = JSON.stringify(t); const pSnap = JSON.stringify(p);
    evaluateSellProposal(s, t, p, null);
    expect(JSON.stringify(s)).toBe(sSnap);
    expect(JSON.stringify(t)).toBe(tSnap);
    expect(JSON.stringify(p)).toBe(pSnap);
  });

  test('같은 입력 → 같은 출력', () => {
    const a = evaluateSellProposal(state(), ticker(priceAt(-20)), POLICY, null);
    const b = evaluateSellProposal(state(), ticker(priceAt(-20)), POLICY, null);
    expect(a).toEqual(b);
  });
});

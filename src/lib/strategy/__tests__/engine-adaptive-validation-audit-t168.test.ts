/**
 * T-168 — 무제한(적응 배분) 모드 장중 엔진 ④ 의 **미검증 매수 후보 감사 경로**.
 *
 * ## 왜 이 파일이 필요한가
 *
 * T-159(명시적 무제한)는 ④ 에서 매수 후보를 전부 `allocateAdaptiveBuys` 로 보냈고, 그 안의 검증 필터가 미검증 후보를
 * `no_validated_candidates` 로 끝냈다 → createSignal G1 에 닿지 못해 감사 행·가상 체결(paper_fills origin=engine)·진입 쿨다운
 * 선점(F-16)이 모두 사라졌다(11-07 06:01 이후 0건, 같은 후보가 매 틱 재평가돼 funnel 7일 10,939행).
 * T-168 은 배분 앞에서 검증 상태로 후보를 나눠 미검증은 T-159 이전과 같은 금액·순서로 G1 에 보낸다(감사 전용).
 *
 * 고정하는 것 (task D1~D5, Developer 지시 ①~⑥):
 *  ① 적응 + 전부 미검증 → 각 후보가 감사 전용·진입 쿨다운 선점·origin engine 으로 createSignal 에 간다. 금액 = T-159 이전 식
 *     (같은 KRW 한도의 양수 한도 경로와 같은 값). 배분·LLM 호출 0, `adaptive_buy_sizing` 행 0. 전략당 검증 판정 1회.
 *  ② 검증·미검증 혼합 → 검증 묶음만 배분(T-159 그대로), 미검증은 감사 전용으로 G1.
 *  ③ 감사 전용 + G1 통과(경합) → funnel `validation_audit_only_passed` skip 1행, 쿨다운 설정 0
 *     (INSERT·routeSignal·submitOrder 0 은 service 쪽 `service-validation-audit-only-t168.test.ts` 가 실 로직으로 본다).
 *  ④ 이전 비율 없음(금액 0)·조회 예외 → 금액 0 으로 기록을 계속한다.
 *  ⑤ 양수 한도(비적응) → 이전과 바이트 동일한 맥락(감사 전용 키 없음)·검증 판정 0·이전 한도 조회 0.
 *  ⑥ 첫 런의 G1 선점이 진입 쿨다운이 되면 다음 런은 createSignal 을 부르지 않고 `cooldown_entry` 로 걸러진다.
 *     (선점 자체의 원자성은 service-validation-gate.test.ts 6절이 실 로직으로 본다 — 여기서는 createSignal 모의가 선점을 흉내 낸다.)
 */
import type { Market } from '@/lib/exchanges/kis-symbols';

// ─── 모의 DB ─────────────────────────────────────────────────────────────────
const funnelRows: Array<{ symbol: string | null; strategyId: string | null; stage: number; gate: string; verdict: string; reason: string | null }> = [];
/** `strategies WHERE enabled = 1` 이 돌려줄 활성 전략 */
let activeIds: string[] = [];
async function poolQuery(sql: unknown, params?: unknown) {
  const s = String(sql);
  const p = (params as unknown[] | undefined) ?? [];
  if (/INSERT INTO eval_funnel/i.test(s)) {
    for (let i = 0; i + 9 < p.length; i += 10) {
      funnelRows.push({
        symbol: p[i + 2] as string | null, strategyId: p[i + 3] as string | null, stage: Number(p[i + 5]),
        gate: String(p[i + 6]), verdict: String(p[i + 7]), reason: p[i + 8] as string | null,
      });
    }
    return [{ affectedRows: 1 }, []];
  }
  if (/FROM strategies/i.test(s)) {
    return [activeIds.map((id) => ({ id, enabled: 1, backtest_interval_h: 6, next_backtest_at: null })), []];
  }
  return [[], []];
}
jest.mock('@/lib/db', () => ({
  getPool: () => ({
    query: (...a: unknown[]) => poolQuery(a[0], a[1]),
    getConnection: async () => ({ query: (...a: unknown[]) => poolQuery(a[0], a[1]), release: () => {}, destroy: () => {} }),
  }),
}));

// ─── 외부 I/O ────────────────────────────────────────────────────────────────
const getBalancesDetailed = jest.fn();
jest.mock('@/lib/exchanges/kis', () => ({
  kis: {
    getTicker: async (s: string) => ({ price: 70_000, open24h: 70_000, timestamp: 0, symbol: s }),
    getCandles: async () => Array.from({ length: 30 }, (_, i) => ({ ts: i * 3_600_000, open: 70_000, high: 70_000, low: 70_000, close: 70_000, volume: 1_000 })),
    getMarket: () => 'domestic',
    createOrder: jest.fn(),
  },
  getBalancesDetailed: (...a: unknown[]) => getBalancesDetailed(...a),
}));
jest.mock('@/lib/strategy/market-hours', () => ({ isDomesticOpen: async () => true, isOverseasOpen: async () => true, getCurrentMarket: async () => 'domestic' }));
jest.mock('@/lib/strategy/position-state', () => ({
  upsertPositionState: jest.fn(async () => undefined),
  reconcilePositionState: jest.fn(async () => 0),
  loadPositionState: jest.fn(async () => null),
}));
const createSignal = jest.fn();
jest.mock('@/lib/signals/service', () => ({ createSignal: (...a: unknown[]) => createSignal(...a), getEffectiveChasePct: async () => 0 }));
jest.mock('@/lib/notify', () => ({ sendAlert: jest.fn() }));
jest.mock('@/lib/notify/throttle', () => ({ sendAlertThrottled: jest.fn(), resetAlertThrottle: () => {} }));
// 운영과 같은 자동 모드 — 엔진 쪽 분류가 모드와 무관하게 감사 전용을 켜는지 본다
jest.mock('@/lib/signals/router', () => ({ getEngineSwitches: async () => ({ engineEnabled: true, autopilotMode: 'auto', source: 'config' }) }));
/** 진입 쿨다운 저장소 — `loadActiveCooldowns` 가 런 시작에 이 집합을 읽는다(⑥) */
const cooldownStore = new Set<string>();
const cooldownKey = (k: { scope: string; symbol: string; strategyId?: string | null; side?: string | null }) =>
  `${k.scope}|${k.symbol}|${k.strategyId ?? ''}|${k.side ?? ''}`;
const setCooldown = jest.fn(async (..._args: unknown[]) => true);
jest.mock('@/lib/strategy/cooldowns', () => ({
  loadActiveCooldowns: async () => ({
    isActive: (k: Parameters<typeof cooldownKey>[0]) => cooldownStore.has(cooldownKey(k)),
    until: () => null,
    loadError: null,
  }),
  setCooldown: (...a: unknown[]) => setCooldown(...a),
  COOLDOWN_TTL_MIN: { entry: 120, rebuy: 30, exit: 15, entryRejected: 240 },
}));
jest.mock('@/lib/strategy/style', () => ({
  getStyleConfig: async () => ({
    hardStopPct: 5, targetProfitPct: 3, trailingActivatePct: 3, trailingDrawdownPct: 2, eodLossCutPct: 2,
    lateSessionBuyBlockMin: 30, feePct: 0.18, slippagePct: 0.15, stableCoreRatioMin: 0, maxPositionsPerSymbol: 2,
  }),
  roundTripCostPct: () => 0.33,
}));
let symbols: string[] = [];
jest.mock('@/lib/strategy/universe', () => ({
  refreshUniverse: async () => ({ refreshed: false }),
  getUniverseSymbols: async () => [] as string[],
  getAlwaysIncludeSymbols: async () => symbols.slice(),
}));
jest.mock('@/lib/strategy/macro', () => ({ fetchMacroIndicators: async () => ({ kospiChangePct: 0, sp500ChangePct: 0 }) }));
let orderMax: number | 'unlimited' = 'unlimited';
const getPreviousOrderMax = jest.fn();
jest.mock('@/lib/safety/order-limits', () => ({
  getEffectiveOrderMax: async () => orderMax,
  getPreviousOrderMax: (...a: unknown[]) => getPreviousOrderMax(...a),
}));
/** 검증된 전략 집합 — 그 밖은 unvalidated 로 막는다(관문 함수의 실제 반환 모양) */
const validatedIds = new Set<string>();
const evaluateValidationGate = jest.fn(async ({ strategyId }: { side: unknown; strategyId: string }) => (validatedIds.has(strategyId)
  ? { allowed: true, kind: 'validated', strategyId, status: 'backtested' }
  : { allowed: false, kind: 'blocked', reason: 'unvalidated', strategyId, status: 'unvalidated' }));
jest.mock('@/lib/safety/validation-gate', () => ({ evaluateValidationGate: (input: { side: unknown; strategyId: string }) => evaluateValidationGate(input) }));
const portfolioGuard = jest.fn(async (_input: unknown) => ({ verdict: 'pass' }));
jest.mock('@/lib/strategy/portfolio-stability', () => ({ checkPortfolioStability: (input: unknown) => portfolioGuard(input) }));
const allocate = jest.fn();
jest.mock('@/lib/strategy/adaptive-buy-sizing', () => ({ allocateAdaptiveBuys: (...args: unknown[]) => allocate(...args) }));
/** LLM 호출 감시 — ④ 에서 모델을 부르는 길은 배분(allocate)뿐이지만 공급자 자체도 0회인지 본다 */
const runLlmOnce = jest.fn();
const runLlm = jest.fn();
jest.mock('@/lib/llm/provider', () => ({
  runLlmOnce: (...a: unknown[]) => runLlmOnce(...a),
  runLlm: (...a: unknown[]) => runLlm(...a),
  getActiveProvider: jest.fn(),
  getProviderConfig: jest.fn(),
}));
jest.mock('@/lib/strategy/ai-prefilter', () => ({ prefilterCandidate: () => ({ verdict: 'pass' }) }));
jest.mock('@/lib/strategy/ai-filter', () => ({ buildMarketSummary: () => ({ rsi14: 30 }) }));
jest.mock('@/lib/strategy/market-state', () => ({ classifyMarketState: () => 'neutral' }));
const VAL = 't168-validated-v1';
const UNV = 't168-unvalidated-v1';
/** 두 전략 모두 모든 종목에서 매수 후보 1건을 낸다 */
jest.mock('@/lib/strategy/rules', () => {
  const fire = ({ strategyId, symbol, amountKRW }: { strategyId: string; symbol: string; amountKRW: number }) =>
    [{ strategyId, symbol, side: 'buy', orderType: 'limit', amountKRW, price: 70_000, indicators: { rsi14: 30 }, reasoning: 't168' }];
  return {
    STRATEGY_REGISTRY: {
      't168-validated-v1': { interval: '1h', minCandles: 20, fn: fire },
      't168-unvalidated-v1': { interval: '1h', minCandles: 20, fn: fire },
    },
  };
});
jest.mock('@/lib/strategy/sell-proposal-preview', () => ({ openSellProposalPreview: async () => null }));

import { runAll, resetHeldUnknownState } from '../engine';
import { FUNNEL_GATES, GATE_LABEL_KO, GATE_STAGE, gateLabelKo } from '../eval-funnel-labels';

// ─── 픽스처 ──────────────────────────────────────────────────────────────────
/** 2026-08-05(수) 10:00 KST — 장마감 매수 차단 창 밖 */
const SAFE_KST = new Date('2026-08-05T01:00:00Z');
const SYMBOLS = ['005930', '000660', '035720'];
/** 무제한 전환 전 1회 한도(= unlimitedPrevious 비율 × 국내 평가액) */
const PREVIOUS_MAX_KRW = 1_000_000;
/** T-159 이전 식 floor(한도 × (1 − (왕복 0.33% + micro 0.07%))) — 양수 한도 경로와 같은 값이어야 한다(①에서 대조) */
const LEGACY_AMOUNT = 996_000;
const ENGINE = { origin: 'engine', claimEntryCooldown: true };
const AUDIT = { origin: 'engine', claimEntryCooldown: true, validationAuditOnly: true };

/** 실제 G1 이 미검증 매수에 돌려주는 모양(엔진 쪽 createSignal 모의). 진입 쿨다운 선점을 흉내 낸다(⑥) */
function g1Blocks(input: { symbol: string; strategyId: string }, _cfg: unknown, opts: { claimEntryCooldown?: boolean }) {
  let claim = 'not_requested';
  if (opts?.claimEntryCooldown) {
    const key = cooldownKey({ scope: 'entry', symbol: input.symbol, strategyId: input.strategyId, side: 'buy' });
    claim = cooldownStore.has(key) ? 'active' : 'inserted';
    cooldownStore.add(key);
  }
  return {
    ok: false, signalId: 0, autoSubmitted: false, errorCode: 'validation_gate', error: 'validation_gate: x',
    validation: { reason: 'unvalidated', strategyId: input.strategyId, status: 'unvalidated', auditSignalId: 1, paperFillId: 2, recorded: claim !== 'active', claim },
  };
}

function resetAll() {
  jest.clearAllMocks();
  funnelRows.length = 0;
  cooldownStore.clear();
  validatedIds.clear();
  symbols = SYMBOLS.slice();
  activeIds = [UNV];
  orderMax = 'unlimited';
  resetHeldUnknownState();
  getPreviousOrderMax.mockResolvedValue(PREVIOUS_MAX_KRW);
  createSignal.mockImplementation(async (input, cfg, opts) => g1Blocks(input, cfg, opts));
  getBalancesDetailed.mockResolvedValue({
    balances: [{ currency: 'KRW', free: 500_000, locked: 0 }],
    ok: ['domestic', 'overseas'] as Market[], failed: [] as Array<{ market: Market; error: string }>, complete: true,
  });
}

let warn: jest.SpyInstance;
beforeAll(() => { jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'performance', 'hrtime'] }); });
afterAll(() => { jest.useRealTimers(); });
beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  resetAll();
  jest.setSystemTime(SAFE_KST);
});
afterEach(() => { jest.restoreAllMocks(); });

const rows = (gate: string) => funnelRows.filter((r) => r.gate === gate);
const callsOf = (strategyId: string) => createSignal.mock.calls.filter((c) => (c[0] as { strategyId: string }).strategyId === strategyId);

describe('① 무제한 + 전부 미검증 → 감사 전용으로 G1 (배분·LLM 0)', () => {
  test('🔴 후보마다 감사 전용·진입 쿨다운 선점·origin engine 으로 createSignal, 금액 = T-159 이전 식, 배분·LLM·adaptive_buy_sizing 0', async () => {
    const res = await runAll({ market: 'domestic' });
    expect(res.errors).toEqual([]);

    // 배분 앞 분류 — 전략당 판정 1회(후보 3건이어도)
    expect(evaluateValidationGate).toHaveBeenCalledTimes(1);
    expect(evaluateValidationGate).toHaveBeenCalledWith({ side: 'buy', strategyId: UNV });
    // 검증된 후보가 없으면 배분을 부르지 않는다 — LLM 0
    expect(allocate).not.toHaveBeenCalled();
    expect(runLlmOnce).not.toHaveBeenCalled();
    expect(runLlm).not.toHaveBeenCalled();
    // 이전 1회 한도 — 런당 1회, 이 시장
    expect(getPreviousOrderMax).toHaveBeenCalledTimes(1);
    expect(getPreviousOrderMax).toHaveBeenCalledWith('domestic');

    expect(createSignal).toHaveBeenCalledTimes(SYMBOLS.length);
    for (const [i, call] of createSignal.mock.calls.entries()) {
      expect(call[0]).toMatchObject({ symbol: SYMBOLS[i], strategyId: UNV, side: 'buy', amountKRW: LEGACY_AMOUNT });
      expect(call[1]).toBeUndefined();
      expect(call[2]).toEqual(AUDIT);
    }
    // T-159 이전 순서 — 포트폴리오 가드를 그 금액으로 거친 뒤 publish
    expect(portfolioGuard).toHaveBeenCalledTimes(SYMBOLS.length);
    expect(portfolioGuard.mock.calls.map((c) => (c[0] as { amountKRW: number }).amountKRW)).toEqual(SYMBOLS.map(() => LEGACY_AMOUNT));

    // funnel — 감사 후보는 validation_gate(skip)로만 남고 adaptive_buy_sizing 행은 없다(무기록 게이트 없음)
    expect(rows('adaptive_buy_sizing')).toHaveLength(0);
    expect(rows('validation_gate').map((r) => [r.symbol, r.strategyId, r.verdict, r.reason, r.stage]))
      .toEqual(SYMBOLS.map((s) => [s, UNV, 'skip', 'unvalidated', 11]));
    // 엔진은 막힌 매수에 쿨다운을 따로 걸지 않는다(G1 의 선점이 곧 쿨다운 — F-16)
    expect(setCooldown).not.toHaveBeenCalled();
    expect(res.results.every((r) => r.signalsCreated === 0)).toBe(true);
  });

  test('🔴 감사 금액은 같은 KRW 한도의 양수 한도(T-159 이전) 경로 금액과 같다', async () => {
    orderMax = PREVIOUS_MAX_KRW;            // 비적응 — collectCandidates 의 defaultAmountKRW
    await runAll({ market: 'domestic' });
    const legacy = createSignal.mock.calls.map((c) => (c[0] as { amountKRW: number }).amountKRW);
    expect(legacy).toEqual(SYMBOLS.map(() => LEGACY_AMOUNT));

    resetAll();
    jest.setSystemTime(SAFE_KST);
    await runAll({ market: 'domestic' });   // 무제한, unlimitedPrevious 로 같은 1회 한도
    expect(createSignal.mock.calls.map((c) => (c[0] as { amountKRW: number }).amountKRW)).toEqual(legacy);
  });

  test('판정 조회가 던지면(이중 방어) 감사 경로로 보낸다 — fail-closed, 배분 0', async () => {
    validatedIds.add(UNV);                  // 판정만 보면 검증됨이지만
    evaluateValidationGate.mockRejectedValueOnce(new Error('db down'));
    await runAll({ market: 'domestic' });
    expect(allocate).not.toHaveBeenCalled();
    expect(createSignal.mock.calls.map((c) => c[2])).toEqual(SYMBOLS.map(() => AUDIT));
  });

  test('판정은 런마다 다시 읽는다(런 사이 캐시 없음)', async () => {
    await runAll({ market: 'domestic' });
    cooldownStore.clear();
    await runAll({ market: 'domestic' });
    expect(evaluateValidationGate).toHaveBeenCalledTimes(2);
  });
});

describe('② 검증·미검증 혼합', () => {
  test('🔴 검증 묶음만 배분(T-159 그대로), 미검증은 감사 전용으로 G1 — adaptive_buy_sizing 행은 검증 후보에만', async () => {
    activeIds = [VAL, UNV];
    validatedIds.add(VAL);
    allocate.mockImplementation((_market: unknown, cands: Array<Record<string, unknown>>) => ({
      orders: new Map([[cands[0], { ...cands[0], amountKRW: 155_000, quantity: 2 }]]), reason: 'allocated',
    }));
    createSignal.mockImplementation(async (input: { strategyId: string; symbol: string }, cfg: unknown, opts: { claimEntryCooldown?: boolean }) => (
      input.strategyId === VAL ? { ok: true, signalId: 501, autoSubmitted: false } : g1Blocks(input, cfg, opts)));

    const res = await runAll({ market: 'domestic' });
    expect(res.errors).toEqual([]);
    expect(evaluateValidationGate).toHaveBeenCalledTimes(2);   // 전략당 1회

    // 배분에는 검증된 후보만 — 3건 모두 VAL
    expect(allocate).toHaveBeenCalledTimes(1);
    const allocated = allocate.mock.calls[0][1] as Array<{ strategyId: string; symbol: string }>;
    expect(allocated.map((c) => [c.symbol, c.strategyId])).toEqual(SYMBOLS.map((s) => [s, VAL]));

    // 검증 후보: 배정된 1건만 이전과 같은 맥락(감사 전용 키 없음)으로 발행
    expect(callsOf(VAL)).toHaveLength(1);
    expect(callsOf(VAL)[0][0]).toMatchObject({ symbol: SYMBOLS[0], amountKRW: 155_000, quantity: 2 });
    expect(callsOf(VAL)[0][2]).toEqual(ENGINE);
    expect(callsOf(VAL)[0][2]).not.toHaveProperty('validationAuditOnly');
    // 미검증 후보: 전부 감사 전용, T-159 이전 금액
    expect(callsOf(UNV).map((c) => [(c[0] as { symbol: string }).symbol, (c[0] as { amountKRW: number }).amountKRW, c[2]]))
      .toEqual(SYMBOLS.map((s) => [s, LEGACY_AMOUNT, AUDIT]));

    // adaptive_buy_sizing — 배정 안 된 검증 후보 2건만(T-159 그대로). 미검증 후보에는 없다
    expect(rows('adaptive_buy_sizing').map((r) => [r.symbol, r.strategyId, r.verdict, r.reason]))
      .toEqual([[SYMBOLS[1], VAL, 'skip', 'candidate_not_allocated'], [SYMBOLS[2], VAL, 'skip', 'candidate_not_allocated']]);
    expect(rows('validation_gate').map((r) => r.strategyId)).toEqual(SYMBOLS.map(() => UNV));
    // 쿨다운은 생성된 검증 시그널 1건에만 엔진이 건다
    expect(setCooldown).toHaveBeenCalledTimes(1);
    expect(setCooldown.mock.calls[0][0]).toMatchObject({ scope: 'entry', symbol: SYMBOLS[0], strategyId: VAL, side: 'buy' });
  });

  test('검증 후보의 배분 사유(미배정·실패)는 T-159 그대로 남는다 — 미검증 후보는 그 사유를 받지 않는다', async () => {
    activeIds = [VAL, UNV];
    validatedIds.add(VAL);
    allocate.mockResolvedValue({ orders: new Map(), reason: 'judgment_unavailable' });
    await runAll({ market: 'domestic' });
    expect(rows('adaptive_buy_sizing').map((r) => [r.strategyId, r.reason])).toEqual(SYMBOLS.map(() => [VAL, 'judgment_unavailable']));
    expect(callsOf(VAL)).toHaveLength(0);
    expect(callsOf(UNV)).toHaveLength(SYMBOLS.length);
  });
});

describe('③ 감사 전용 + G1 통과(경합)', () => {
  test('🔴 funnel validation_audit_only_passed skip 1행 · stage 11 · 엔진 쿨다운 설정 0 · 생성 0', async () => {
    symbols = [SYMBOLS[0]];
    createSignal.mockResolvedValue({
      ok: false, signalId: 0, autoSubmitted: false, errorCode: 'validation_audit_only_passed',
      error: 'validation_audit_only_passed: 감사 전용 호출인데 검증 관문을 통과함 — 시그널·주문을 만들지 않음',
    });
    const res = await runAll({ market: 'domestic' });
    expect(createSignal).toHaveBeenCalledTimes(1);
    expect(createSignal.mock.calls[0][2]).toEqual(AUDIT);
    const raced = rows('validation_audit_only_passed');
    expect(raced).toHaveLength(1);
    expect(raced[0]).toMatchObject({ symbol: SYMBOLS[0], strategyId: UNV, verdict: 'skip', reason: 'validation_audit_only_passed', stage: 11 });
    expect(rows('signal_create_failed')).toHaveLength(0);           // 엔진 고장(error)으로 집계하지 않는다
    expect(rows('signal_created')).toHaveLength(0);
    expect(setCooldown).not.toHaveBeenCalled();
    expect(res.results[0].signalsCreated).toBe(0);
  });

  test('게이트 라벨 — 목록 끝 append, stage 11, 한글 라벨, VARCHAR(48) 이내', () => {
    // T-176 이 그 뒤에 `universe_refresh_failed` 를 append 했으므로 끝에서 두 번째다(append-only 규약 확인 — 꼬리 위치 자체가 계약은 아니다).
    expect(FUNNEL_GATES[FUNNEL_GATES.length - 2]).toBe('validation_audit_only_passed');
    expect(FUNNEL_GATES.filter((g) => g === 'validation_audit_only_passed')).toHaveLength(1);
    expect(GATE_STAGE.validation_audit_only_passed).toBe(11);
    expect(gateLabelKo('validation_audit_only_passed')).toBe(GATE_LABEL_KO.validation_audit_only_passed);
    expect(GATE_LABEL_KO.validation_audit_only_passed).toContain('감사 전용');
    expect('validation_audit_only_passed'.length).toBeLessThanOrEqual(48);
  });
});

describe('④ 이전 비율 없음·조회 실패 → 금액 0 으로 기록 진행', () => {
  test('이전 1회 한도 0(비율 없음·평가액 모름) → 금액 0, 감사 전용 호출은 그대로', async () => {
    getPreviousOrderMax.mockResolvedValue(0);
    await runAll({ market: 'domestic' });
    expect(createSignal.mock.calls.map((c) => [(c[0] as { amountKRW: number }).amountKRW, c[2]])).toEqual(SYMBOLS.map(() => [0, AUDIT]));
    expect(rows('validation_gate')).toHaveLength(SYMBOLS.length);
    expect(allocate).not.toHaveBeenCalled();
  });

  test('이전 한도 조회가 던져도 런은 계속 — 금액 0 · 경고 1줄', async () => {
    getPreviousOrderMax.mockRejectedValue(new Error('boom'));
    const res = await runAll({ market: 'domestic' });
    expect(res.errors).toEqual([]);
    expect(createSignal.mock.calls.map((c) => (c[0] as { amountKRW: number }).amountKRW)).toEqual(SYMBOLS.map(() => 0));
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('이전 1회 한도 조회 실패'))).toHaveLength(1);
  });
});

describe('⑤ 양수 한도(비적응) 경로 무변화', () => {
  test('🔴 검증 판정·이전 한도 조회·배분 0, createSignal 맥락은 이전과 같다(감사 전용 키 없음)', async () => {
    orderMax = PREVIOUS_MAX_KRW;
    activeIds = [VAL, UNV];
    validatedIds.add(VAL);
    createSignal.mockImplementation(async (input: { strategyId: string; symbol: string }, cfg: unknown, opts: { claimEntryCooldown?: boolean }) => (
      input.strategyId === VAL ? { ok: true, signalId: 777, autoSubmitted: false } : g1Blocks(input, cfg, opts)));
    await runAll({ market: 'domestic' });
    expect(evaluateValidationGate).not.toHaveBeenCalled();
    expect(getPreviousOrderMax).not.toHaveBeenCalled();
    expect(allocate).not.toHaveBeenCalled();
    expect(createSignal).toHaveBeenCalledTimes(SYMBOLS.length * 2);
    for (const call of createSignal.mock.calls) {
      expect(call[2]).toEqual(ENGINE);
      expect(call[2]).not.toHaveProperty('validationAuditOnly');
      expect((call[0] as { amountKRW: number }).amountKRW).toBe(LEGACY_AMOUNT);
    }
    expect(rows('adaptive_buy_sizing')).toHaveLength(0);
  });
});

describe('⑥ 진입 쿨다운 — G1 선점이 다음 런을 막는다(F-16 되살림)', () => {
  test('🔴 첫 런 감사 3건 → 다음 런 createSignal 0 · cooldown_entry 3행 · 판정·이전 한도 조회 0', async () => {
    await runAll({ market: 'domestic' });
    expect(createSignal).toHaveBeenCalledTimes(SYMBOLS.length);
    expect(cooldownStore.size).toBe(SYMBOLS.length);

    createSignal.mockClear();
    evaluateValidationGate.mockClear();
    getPreviousOrderMax.mockClear();
    funnelRows.length = 0;
    await runAll({ market: 'domestic' });
    expect(createSignal).not.toHaveBeenCalled();
    expect(rows('cooldown_entry').map((r) => [r.symbol, r.strategyId, r.verdict])).toEqual(SYMBOLS.map((s) => [s, UNV, 'skip']));
    expect(rows('adaptive_buy_sizing')).toHaveLength(0);
    expect(evaluateValidationGate).not.toHaveBeenCalled();
    expect(getPreviousOrderMax).not.toHaveBeenCalled();
    expect(allocate).not.toHaveBeenCalled();
  });
});

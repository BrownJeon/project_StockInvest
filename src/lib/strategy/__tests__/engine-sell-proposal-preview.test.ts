/**
 * T-055 1단계 — 매도 제안 미리보기의 **엔진 레벨** 계약.
 *
 *  1. 자동 청산 OFF + 미리보기 ON → 보유 종목마다 `sell_proposal_preview` 행, 하루 1회 요약.
 *     🔴 시그널(createSignal)·쿨다운·주문은 0건.
 *  2. 🔴 자동 청산 엔진·매수 파이프라인의 동작은 미리보기 ON/OFF 와 무관하게 **동일**하다
 *     (createSignal 인자·경보·position_state·기존 eval_funnel 행 전부 비교).
 *  3. 자동 청산 ON 이면 미리보기는 돌지 않는다(설계 §2.2 — 자동 엔진 우선).
 *  4. 미리보기 예외·알림 지연/실패는 틱으로 새지 않는다.
 *  5. evaluateExit 이 발화하지 않는 종목(예: hardStopPct 10, 손익 −7%)도 미리보기에는 잡힌다.
 */
import type { Market } from '@/lib/exchanges/kis-symbols';

// ─── 모의 DB ─────────────────────────────────────────────────────────────────
const dbState = {
  exitEngineEnabled: 'false' as string | null,
  preview: {
    sell_proposal_preview_enabled: 'true',
    sell_proposal_stop_pct: '6',
    sell_proposal_restep_pct: '5',
    sell_proposal_rebound_exit_pct: '1',
  } as Record<string, string | undefined>,
  strategies: [] as Array<{ id: string; enabled: number; backtest_interval_h: number; next_backtest_at: null }>,
  /** system_config 에 실제로 쓰인 키 (표식) */
  written: new Map<string, string>(),
};
type FunnelRow = { symbol: string | null; strategyId: string | null; stage: number; gate: string; verdict: string; reason: string | null; detail: unknown };
const funnelRows: FunnelRow[] = [];

async function defaultPoolQuery(sql: unknown, params?: unknown) {
  const s = String(sql);
  const p = (params as unknown[]) ?? [];
  if (/INSERT INTO eval_funnel/i.test(s)) {
    for (let i = 0; i + 9 < p.length; i += 10) {
      funnelRows.push({
        symbol: p[i + 2] as string | null,
        strategyId: p[i + 3] as string | null,
        stage: Number(p[i + 5]),
        gate: String(p[i + 6]),
        verdict: String(p[i + 7]),
        reason: p[i + 8] as string | null,
        detail: p[i + 9] ? JSON.parse(String(p[i + 9])) : null,
      });
    }
    return [{ affectedRows: 1 }];
  }
  if (/^INSERT IGNORE INTO system_config/i.test(s)) {
    const [key, value] = p as [string, string];
    if (!dbState.written.has(key)) dbState.written.set(key, value);
    return [{ affectedRows: 1 }];
  }
  if (/^UPDATE system_config SET value = \? WHERE `key` = \? AND value <> \?/i.test(s)) {
    const [value, key, notEq] = p as [string, string, string];
    if (dbState.written.get(key) === notEq) return [{ affectedRows: 0 }];
    dbState.written.set(key, value);
    return [{ affectedRows: 1 }];
  }
  if (/^UPDATE system_config/i.test(s)) return [{ affectedRows: 0 }];
  if (/FROM system_config/i.test(s)) {
    const keys = (p as string[]) ?? [];
    const out: Array<{ key: string; value: string }> = [];
    if (keys.includes('exit_engine_enabled') && dbState.exitEngineEnabled != null) {
      out.push({ key: 'exit_engine_enabled', value: dbState.exitEngineEnabled });
    }
    for (const k of keys) {
      const v = dbState.preview[k];
      if (v !== undefined) out.push({ key: k, value: v });
    }
    return [out];
  }
  if (/FROM strategies/i.test(s)) return [dbState.strategies];
  return [[]];
}
const poolQuery = jest.fn(defaultPoolQuery);
jest.mock('@/lib/db', () => ({ getPool: () => ({ query: (...a: unknown[]) => poolQuery(a[0], a[1]) }) }));

// ─── 외부 I/O ────────────────────────────────────────────────────────────────
const getBalancesDetailed = jest.fn();
const getTicker = jest.fn();
const getCandles = jest.fn();
const createOrder = jest.fn();
jest.mock('@/lib/exchanges/kis', () => ({
  kis: {
    getTicker: (...a: unknown[]) => getTicker(...a),
    getCandles: (...a: unknown[]) => getCandles(...a),
    getMarket: () => 'domestic',
    createOrder: (...a: unknown[]) => createOrder(...a),
  },
  getBalancesDetailed: (...a: unknown[]) => getBalancesDetailed(...a),
}));
jest.mock('@/lib/strategy/market-hours', () => ({
  isDomesticOpen: async () => true,
  isOverseasOpen: async () => true,
  getCurrentMarket: async () => 'domestic',
}));

const upsertPositionState = jest.fn().mockResolvedValue(undefined);
const reconcilePositionState = jest.fn().mockResolvedValue(0);
const loadPositionState = jest.fn();
jest.mock('@/lib/strategy/position-state', () => ({
  upsertPositionState: (...a: unknown[]) => upsertPositionState(...a),
  reconcilePositionState: (...a: unknown[]) => reconcilePositionState(...a),
  loadPositionState: (...a: unknown[]) => loadPositionState(...a),
}));

const createSignal = jest.fn();
jest.mock('@/lib/signals/service', () => ({ createSignal: (...a: unknown[]) => createSignal(...a) }));

const sendAlert = jest.fn();
const sendAlertThrottled = jest.fn();
const dispatchAlert = jest.fn();
jest.mock('@/lib/notify', () => ({
  sendAlert: (...a: unknown[]) => sendAlert(...a),
  dispatchAlert: (...a: unknown[]) => dispatchAlert(...a),
  getSymbolLabel: async (s: string) => s,
}));
jest.mock('@/lib/notify/throttle', () => ({
  sendAlertThrottled: (...a: unknown[]) => sendAlertThrottled(...a),
  resetAlertThrottle: () => {},
}));

const engineSwitches = { engineEnabled: false, autopilotMode: 'assist' as const, source: 'config' as const };
jest.mock('@/lib/signals/router', () => ({ getEngineSwitches: async () => engineSwitches }));

const setCooldown = jest.fn();
jest.mock('@/lib/strategy/cooldowns', () => ({
  loadActiveCooldowns: async () => ({ isActive: () => false, until: () => null, loadError: null }),
  setCooldown: (...a: unknown[]) => setCooldown(...a),
  COOLDOWN_TTL_MIN: { entry: 120, rebuy: 30, exit: 15, entryRejected: 240 },
}));

const STYLE = {
  hardStopPct: 5,
  targetProfitPct: 3,
  trailingActivatePct: 3,
  trailingDrawdownPct: 2,
  eodLossCutPct: 2,
  lateSessionBuyBlockMin: 30,
  feePct: 0.18,
  slippagePct: 0.15,
  stableCoreRatioMin: 0,
};
jest.mock('@/lib/strategy/style', () => ({
  getStyleConfig: async () => STYLE,
  roundTripCostPct: () => 0.33,
}));
const mockUniverse = { symbols: ['005930'] };
jest.mock('@/lib/strategy/universe', () => ({
  refreshUniverse: async () => ({ refreshed: false }),
  getUniverseSymbols: async () => [] as string[],
  getAlwaysIncludeSymbols: async () => mockUniverse.symbols,
}));
jest.mock('@/lib/strategy/macro', () => ({
  fetchMacroIndicators: async () => ({ kospiChangePct: 0, sp500ChangePct: 0 }),
}));
jest.mock('@/lib/safety/order-limits', () => ({ getEffectiveOrderMax: async () => 100_000 }));
jest.mock('@/lib/strategy/portfolio-stability', () => ({
  checkPortfolioStability: async () => ({ verdict: 'pass' }),
}));
jest.mock('@/lib/strategy/ai-prefilter', () => ({ prefilterCandidate: () => ({ verdict: 'pass' }) }));
jest.mock('@/lib/strategy/ai-filter', () => ({ buildMarketSummary: () => ({ rsi14: 30 }) }));
jest.mock('../market-state', () => ({ classifyMarketState: () => 'neutral' }));

const buyRuleFn = jest.fn();
jest.mock('../rules', () => ({
  STRATEGY_REGISTRY: {
    'test-buy-v1': { interval: '1h', minCandles: 20, fn: (...a: unknown[]) => buyRuleFn(...a) },
  },
}));

/** 판정기 예외 주입용 — 기본은 실제 구현 */
const evalMode = { throwIt: false };
jest.mock('../sell-proposal', () => {
  const actual = jest.requireActual('../sell-proposal');
  return {
    ...actual,
    evaluateSellProposal: (...a: unknown[]) => {
      if (evalMode.throwIt) throw new Error('injected evaluator failure');
      return actual.evaluateSellProposal(...a);
    },
  };
});

import { runAll, resetHeldUnknownState } from '../engine';
import { resetSellProposalPreviewState } from '../sell-proposal-preview';

// ─── 픽스처 ──────────────────────────────────────────────────────────────────
const ENTRY = 70_000;
/** 2026-08-05(수) 10:00 KST — EOD 창 밖 */
const SAFE_KST = new Date('2026-08-05T01:00:00Z');

function heldBalances(qty = 10, avgPrice = ENTRY) {
  return {
    balances: [
      { currency: 'KRW', free: 500_000, locked: 0 },
      { currency: '005930', free: qty, locked: 0, avgPrice },
    ],
    ok: ['domestic', 'overseas'] as Market[],
    failed: [] as { market: Market; error: string }[],
    complete: true,
  };
}
function positionState(over: { entryPrice?: number; peakPrice?: number } = {}) {
  return {
    symbol: '005930', market: 'domestic' as Market,
    entryPrice: over.entryPrice ?? ENTRY,
    peakPrice: over.peakPrice ?? ENTRY,
    qty: 10, scenarioExit: null, holdingDeadline: null,
    firstSeenAt: new Date(), updatedAt: new Date(),
  };
}
/** fake timer 아래에서 fire-and-forget 요약이 끝날 때까지 마이크로태스크를 돌린다 */
async function settle() {
  for (let i = 0; i < 20; i++) await new Promise<void>((r) => setImmediate(r));
}
const previewRows = () => funnelRows.filter(r => r.gate === 'sell_proposal_preview');
const nonPreviewRows = () => funnelRows.filter(r => r.gate !== 'sell_proposal_preview')
  .map(({ symbol, strategyId, stage, gate, verdict, reason }) => ({ symbol, strategyId, stage, gate, verdict, reason }));

beforeEach(() => {
  jest.clearAllMocks();
  poolQuery.mockImplementation(defaultPoolQuery);
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  jest.setSystemTime(SAFE_KST);
  resetHeldUnknownState();
  resetSellProposalPreviewState();
  funnelRows.length = 0;
  dbState.written.clear();
  dbState.exitEngineEnabled = 'false';
  dbState.preview.sell_proposal_preview_enabled = 'true';
  dbState.preview.sell_proposal_stop_pct = '6';
  dbState.strategies = [];
  STYLE.hardStopPct = 5;
  evalMode.throwIt = false;
  mockUniverse.symbols = ['005930'];
  engineSwitches.engineEnabled = false;
  buyRuleFn.mockReturnValue([]);
  getBalancesDetailed.mockResolvedValue(heldBalances());
  getTicker.mockResolvedValue({ price: 60_000, open24h: ENTRY });       // −14.29%
  getCandles.mockResolvedValue(Array.from({ length: 60 }, (_, i) => ({
    time: 1_700_000_000 + i * 3600, open: ENTRY, high: ENTRY, low: ENTRY, close: ENTRY, volume: 1_000,
  })));
  loadPositionState.mockResolvedValue(positionState());
  createSignal.mockResolvedValue({ ok: true, signalId: 1, autoSubmitted: false });
  dispatchAlert.mockResolvedValue({ channel: 'telegram', delivered: ['telegram'], failed: [], unconfigured: [] });
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ════════════════════════════════════════════════════════════════════════════
describe('자동 청산 OFF + 미리보기 ON — 기록만, 시그널·주문 없음', () => {
  test('보유 종목마다 sell_proposal_preview pass 행 1개 (stage 26, strategy sell-proposal-v1)', async () => {
    await runAll({ market: 'domestic' });
    const rows = previewRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      symbol: '005930', strategyId: 'sell-proposal-v1', stage: 26, verdict: 'pass', reason: 'stop',
    });
    expect(rows[0].detail).toMatchObject({ simulation: true, kind: 'stop_loss', thresholdPct: -6, kisQty: 10, kisAvgPrice: ENTRY });
    expect((rows[0].detail as { pnlPct: number }).pnlPct).toBeCloseTo(-14.2857, 3);
  });

  test('🔴 createSignal·setCooldown·createOrder 0건 — 기존 OFF 차단 기록(exit_engine_disabled)은 그대로', async () => {
    await runAll({ market: 'domestic' });
    await settle();
    expect(createSignal).not.toHaveBeenCalled();
    expect(setCooldown).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
    expect(funnelRows.some(r => r.gate === 'exit_engine_disabled' && r.symbol === '005930')).toBe(true);
  });

  test('임계값 미도달(−3%)이면 skip(above_threshold)', async () => {
    getTicker.mockResolvedValue({ price: 67_900, open24h: ENTRY });
    await runAll({ market: 'domestic' });
    expect(previewRows()).toEqual([expect.objectContaining({ verdict: 'skip', reason: 'above_threshold' })]);
  });

  test('하루 1회 요약 — 같은 날 두 번째 틱은 보내지 않는다', async () => {
    await runAll({ market: 'domestic' });
    await settle();
    await runAll({ market: 'domestic' });
    await settle();
    expect(dispatchAlert).toHaveBeenCalledTimes(1);
    const [level, title, body] = dispatchAlert.mock.calls[0] as [string, string, string];
    expect(level).toBe('info');
    expect(title).toBe('매도 제안 시뮬레이션: 오늘 1건 (국내)');
    expect(body.trim().split('\n').pop()).toBe('시뮬레이션 — 시그널·주문 없음');
    expect(dbState.written.get('sell_proposal_preview_report_domestic')).toBe(JSON.stringify('2026-08-05'));
    // 두 틱 모두 기록은 남는다 (요약만 1회)
    expect(previewRows()).toHaveLength(2);
  });

  test('🔴 재시작(로컬 상태 초기화) 뒤에도 같은 날 다시 보내지 않는다', async () => {
    await runAll({ market: 'domestic' });
    await settle();
    resetSellProposalPreviewState();
    await runAll({ market: 'domestic' });
    await settle();
    expect(dispatchAlert).toHaveBeenCalledTimes(1);
  });

  test('추가 KIS 호출 없음 — 미리보기 ON/OFF 의 getTicker·getBalancesDetailed 호출 수가 같다', async () => {
    await runAll({ market: 'domestic' });
    await settle();
    const on = { t: getTicker.mock.calls.length, b: getBalancesDetailed.mock.calls.length };
    jest.clearAllMocks();
    resetSellProposalPreviewState();
    dbState.preview.sell_proposal_preview_enabled = 'false';
    await runAll({ market: 'domestic' });
    await settle();
    expect({ t: getTicker.mock.calls.length, b: getBalancesDetailed.mock.calls.length }).toEqual(on);
  });

  test('evaluateExit 이 발화하지 않는 종목도 잡는다 (hardStopPct 10 · 손익 −7.14%)', async () => {
    STYLE.hardStopPct = 10;
    getTicker.mockResolvedValue({ price: 65_000, open24h: ENTRY });
    await runAll({ market: 'domestic' });
    expect(funnelRows.some(r => r.gate === 'exit_no_fire' && r.symbol === '005930')).toBe(true);
    expect(previewRows()).toEqual([expect.objectContaining({ verdict: 'pass', reason: 'stop' })]);
  });
});

describe('🔴 엔진이 넘기는 보유 종목 수 (라운드 2 — Reviewer R-2)', () => {
  /** 005930 + 000660 두 종목 보유 */
  function twoHeld() {
    return {
      balances: [
        { currency: 'KRW', free: 500_000, locked: 0 },
        { currency: '005930', free: 10, locked: 0, avgPrice: ENTRY },
        { currency: '000660', free: 1, locked: 0, avgPrice: 2_641_000 },
      ],
      ok: ['domestic', 'overseas'] as Market[],
      failed: [] as { market: Market; error: string }[],
      complete: true,
    };
  }

  test('보유 1·관측 1 → 요약 "평가 1/1종목"', async () => {
    await runAll({ market: 'domestic' });
    await settle();
    expect(String(dispatchAlert.mock.calls[0][2])).toContain('평가 1/1종목');
  });

  test('보유 2·관측 2 → "평가 2/2종목", 미루지 않고 첫 틱에 보낸다', async () => {
    getBalancesDetailed.mockResolvedValue(twoHeld());
    loadPositionState.mockImplementation(async (symbol: string) => (
      symbol === '000660'
        ? { ...positionState({ entryPrice: 2_641_000 }), symbol: '000660', qty: 1 }
        : positionState()
    ));
    getTicker.mockImplementation(async (symbol: string) => (
      symbol === '000660' ? { price: 1_294_000, open24h: 1_294_000 } : { price: 60_000, open24h: ENTRY }
    ));
    await runAll({ market: 'domestic' });
    await settle();
    expect(dispatchAlert).toHaveBeenCalledTimes(1);
    expect(String(dispatchAlert.mock.calls[0][2])).toContain('평가 2/2종목');
    expect(String(dispatchAlert.mock.calls[0][1])).toBe('매도 제안 시뮬레이션: 오늘 2건 (국내)');
  });

  test('보유 2·한 종목 시세 실패 → 3틱 미룬 뒤 "평가 1/2종목 (… 확인 실패 1종목)" 으로 보낸다', async () => {
    getBalancesDetailed.mockResolvedValue(twoHeld());
    getTicker.mockImplementation(async (symbol: string) => {
      if (symbol === '000660') throw new Error('EGW00201 초당 거래건수 초과');
      return { price: 60_000, open24h: ENTRY };
    });
    for (let i = 0; i < 3; i++) {
      await runAll({ market: 'domestic' });
      await settle();
    }
    expect(dispatchAlert).not.toHaveBeenCalled();         // 보유 수를 엔진이 제대로 넘겨야 미룬다
    await runAll({ market: 'domestic' });
    await settle();
    expect(dispatchAlert).toHaveBeenCalledTimes(1);
    const body = String(dispatchAlert.mock.calls[0][2]);
    expect(body).toContain('평가 1/2종목');
    expect(body).toContain('확인 실패 1종목');
  });
});

describe('🔴 정책 판독 타임아웃 — 엔진 흐름은 상한 뒤 그대로 진행 (라운드 2 — Codex C2 medium)', () => {
  test('판독 SELECT 가 응답하지 않아도 2초 뒤 미리보기만 빠지고 청산 평가·기록은 그대로', async () => {
    poolQuery.mockImplementation(async (sql: unknown, params?: unknown) => {
      if ((params as unknown[] | undefined)?.includes?.('sell_proposal_preview_enabled')) {
        return new Promise(() => { /* 응답 없음 */ });
      }
      return defaultPoolQuery(sql, params);
    });
    let done = false;
    const p = runAll({ market: 'domestic' }).then((r) => { done = true; return r; });
    await jest.advanceTimersByTimeAsync(1_900);
    expect(done).toBe(false);                               // 상한 전에는 기다린다
    await jest.advanceTimersByTimeAsync(200);
    await p;
    expect(done).toBe(true);
    expect(previewRows()).toHaveLength(0);
    expect(funnelRows.some(r => r.gate === 'exit_engine_disabled' && r.symbol === '005930')).toBe(true);
    expect(upsertPositionState).toHaveBeenCalled();
    expect(createSignal).not.toHaveBeenCalled();
    await settle();
    expect(dispatchAlert).not.toHaveBeenCalled();
  });

  test('판독이 정상이면 남는 타이머가 없다 (틱마다 타이머 누적 금지)', async () => {
    await runAll({ market: 'domestic' });
    await settle();
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('스위치 꺼짐·무효 — 아무것도 하지 않는다', () => {
  test.each([
    ['false'], ['"true"'], ['1'], ['on'], [undefined],
  ])('sell_proposal_preview_enabled=%s → 미리보기 행 0, 요약 0, 표식 쓰기 0', async (v) => {
    dbState.preview.sell_proposal_preview_enabled = v;
    await runAll({ market: 'domestic' });
    await settle();
    expect(previewRows()).toHaveLength(0);
    expect(dispatchAlert).not.toHaveBeenCalled();
    expect(dbState.written.size).toBe(0);
  });

  test('임계값 키 누락 → 아무것도 하지 않음', async () => {
    dbState.preview.sell_proposal_stop_pct = undefined;
    await runAll({ market: 'domestic' });
    await settle();
    expect(previewRows()).toHaveLength(0);
    expect(dispatchAlert).not.toHaveBeenCalled();
  });
});

describe('자동 청산 ON — 미리보기는 돌지 않는다 (자동 엔진 우선)', () => {
  test('미리보기 행 0 · 요약 0 · 정책 판독 쿼리도 없음 · hard_stop 은 종전대로 발화', async () => {
    dbState.exitEngineEnabled = 'true';
    await runAll({ market: 'domestic' });
    await settle();
    expect(previewRows()).toHaveLength(0);
    expect(dispatchAlert).not.toHaveBeenCalled();
    const policyQueries = poolQuery.mock.calls.filter(c => (c[1] as unknown[] | undefined)?.includes?.('sell_proposal_preview_enabled'));
    expect(policyQueries).toHaveLength(0);
    expect(createSignal).toHaveBeenCalledTimes(1);
    expect((createSignal.mock.calls[0][0] as { indicators: { exit_kind: string } }).indicators.exit_kind).toBe('hard_stop');
  });
});

describe('🔴 자동 청산 엔진·매수 경로 동작 불변 — 미리보기 ON/OFF 비교', () => {
  async function observeRun(previewOn: boolean) {
    jest.clearAllMocks();
    poolQuery.mockImplementation(defaultPoolQuery);
    resetSellProposalPreviewState();
    funnelRows.length = 0;
    dbState.written.clear();
    dbState.preview.sell_proposal_preview_enabled = previewOn ? 'true' : 'false';
    createSignal.mockResolvedValue({ ok: true, signalId: 1, autoSubmitted: false });
    dispatchAlert.mockResolvedValue({ channel: 'telegram', delivered: ['telegram'], failed: [], unconfigured: [] });
    const result = await runAll({ market: 'domestic' });
    await settle();
    return {
      result,
      createSignal: createSignal.mock.calls,
      setCooldown: setCooldown.mock.calls,
      throttled: sendAlertThrottled.mock.calls,
      sendAlert: sendAlert.mock.calls,
      upsert: upsertPositionState.mock.calls,
      reconcile: reconcilePositionState.mock.calls,
      rows: nonPreviewRows(),
    };
  }

  const SCENARIOS = [
    { name: '청산 OFF · hard_stop 조건', exit: 'false', price: 60_000, peak: ENTRY, buy: false },
    { name: '청산 ON · hard_stop 조건', exit: 'true', price: 60_000, peak: ENTRY, buy: false },
    { name: '청산 ON · target_profit 조건', exit: 'true', price: 75_000, peak: ENTRY, buy: false },
    { name: '청산 ON · trailing 조건', exit: 'true', price: 72_000, peak: 74_000, buy: false },
    { name: '청산 OFF · 매수 룰 발화', exit: 'false', price: 60_000, peak: ENTRY, buy: true },
  ];
  for (const sc of SCENARIOS) {
    test(sc.name, async () => {
      dbState.exitEngineEnabled = sc.exit;
      getTicker.mockResolvedValue({ price: sc.price, open24h: ENTRY });
      loadPositionState.mockResolvedValue(positionState({ peakPrice: sc.peak }));
      if (sc.buy) {
        engineSwitches.engineEnabled = true;
        dbState.strategies = [{ id: 'test-buy-v1', enabled: 1, backtest_interval_h: 6, next_backtest_at: null }];
        // 손실 중 보유 종목(005930)의 추가매수는 별도 가드가 막으므로 미보유 종목에서 매수 후보가 나오게 한다
        mockUniverse.symbols = ['005930', '000660'];
        buyRuleFn.mockImplementation((input: { symbol: string }) => (
          input.symbol === '000660'
            ? [{
                strategyId: 'test-buy-v1', symbol: '000660', side: 'buy',
                orderType: 'limit', price: 50_000, amountKRW: 50_000, reasoning: 'test', indicators: {},
              }]
            : []
        ));
      }
      const off = await observeRun(false);
      const on = await observeRun(true);
      expect(on.result).toEqual(off.result);
      expect(on.createSignal).toEqual(off.createSignal);
      expect(on.setCooldown).toEqual(off.setCooldown);
      expect(on.throttled).toEqual(off.throttled);
      expect(on.sendAlert).toEqual(off.sendAlert);
      expect(on.upsert).toEqual(off.upsert);
      expect(on.reconcile).toEqual(off.reconcile);
      expect(on.rows).toEqual(off.rows);
      // 매수 시나리오는 실제로 매수 시그널이 나가는지 — 비교가 공허하지 않음을 확인
      if (sc.buy) expect(off.createSignal.some(c => (c[0] as { side: string }).side === 'buy')).toBe(true);
      // 미리보기가 만든 시그널은 어떤 경우에도 없다
      expect(on.createSignal.some(c => (c[0] as { strategyId?: string }).strategyId === 'sell-proposal-v1')).toBe(false);
    });
  }
});

describe('🔴 격리 — 미리보기 실패가 틱으로 새지 않는다', () => {
  test('판정기가 던져도 틱은 끝나고 청산 차단 기록·position_state 갱신은 그대로', async () => {
    evalMode.throwIt = true;
    await expect(runAll({ market: 'domestic' })).resolves.toBeDefined();
    expect(upsertPositionState).toHaveBeenCalled();
    expect(funnelRows.some(r => r.gate === 'exit_engine_disabled')).toBe(true);
    expect(previewRows()).toEqual([expect.objectContaining({ verdict: 'skip', reason: 'preview_error' })]);
    expect(createSignal).not.toHaveBeenCalled();
  });

  test('정책 판독 쿼리가 던져도 틱은 정상 (미리보기만 생략)', async () => {
    poolQuery.mockImplementation(async (sql: unknown, params?: unknown) => {
      if ((params as unknown[] | undefined)?.includes?.('sell_proposal_preview_enabled')) throw new Error('db blip');
      return defaultPoolQuery(sql, params);
    });
    await expect(runAll({ market: 'domestic' })).resolves.toBeDefined();
    expect(previewRows()).toHaveLength(0);
    expect(funnelRows.some(r => r.gate === 'exit_engine_disabled')).toBe(true);
  });

  test('알림이 영원히 응답하지 않아도 틱은 기다리지 않는다', async () => {
    dispatchAlert.mockImplementation(() => new Promise(() => { /* never */ }));
    await expect(runAll({ market: 'domestic' })).resolves.toBeDefined();
    expect(funnelRows.length).toBeGreaterThan(0);          // flush 까지 끝났다
  });

  test('알림이 reject 해도 틱·다음 틱에 영향 없음 (unhandled rejection 없음)', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    try {
      dispatchAlert.mockRejectedValue(new Error('telegram 502'));
      await runAll({ market: 'domestic' });
      await settle();
      await runAll({ market: 'domestic' });
      await settle();
      expect(unhandled).not.toHaveBeenCalled();
      expect(previewRows()).toHaveLength(2);
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  test('표식 선점 쿼리가 실패해도 틱은 정상, 요약은 보내지 않는다(중복 방지)', async () => {
    poolQuery.mockImplementation(async (sql: unknown, params?: unknown) => {
      if (/INSERT IGNORE INTO system_config/i.test(String(sql))) throw new Error('db blip');
      return defaultPoolQuery(sql, params);
    });
    await expect(runAll({ market: 'domestic' })).resolves.toBeDefined();
    await settle();
    expect(dispatchAlert).not.toHaveBeenCalled();
  });
});

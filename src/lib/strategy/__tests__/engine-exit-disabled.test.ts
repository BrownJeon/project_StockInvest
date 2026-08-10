/**
 * T-015 — **자동 청산 엔진 마스터 스위치**의 엔진 레벨 계약.
 *
 * 사용자 결정: 시스템은 더 이상 자동으로 매도하지 않는다. 그런데 "안 판다"를 구현하는 방법이
 * 하나만 있는 게 아니다 — 잘못 구현하면 다음 중 하나가 조용히 따라온다:
 *
 *  1. 매수 파이프라인까지 같이 죽는다                    → 제품이 멈춘다
 *  2. `position_state` 갱신이 멈춘다                     → 나중에 다시 켰을 때 **트레일링 고점이
 *     리셋**돼 손절 기준이 틀어진다 (T-012 가 고친 것과 같은 종류의 사고)
 *  3. 네 종류 중 일부만 막힌다                           → 킬스위치 해제 순간 실제 매도가 나간다
 *
 * 그래서 이 파일은 "안 판다"만이 아니라 **무엇이 계속 살아 있어야 하는가**를 함께 고정한다.
 */
import type { Market } from '@/lib/exchanges/kis-symbols';

// ─── 모의 DB — system_config / strategies 만 내용을 갖고 나머지는 빈 결과 ─────────
const dbState = {
  /** null = 키 자체가 없음 */
  exitEngineEnabled: null as string | null,
  exitHardStopEnabled: null as string | null,
  strategies: [] as Array<{ id: string; enabled: number; backtest_interval_h: number; next_backtest_at: null }>,
};
async function defaultPoolQuery(sql: unknown, params?: unknown) {
  const s = String(sql);
  if (/FROM system_config/i.test(s)) {
    const keys = (params as string[] | undefined) ?? [];
    const out: Array<{ key: string; value: string }> = [];
    if (keys.includes('exit_engine_enabled') && dbState.exitEngineEnabled != null) {
      out.push({ key: 'exit_engine_enabled', value: dbState.exitEngineEnabled });
    }
    if (keys.includes('exit_hard_stop_enabled') && dbState.exitHardStopEnabled != null) {
      out.push({ key: 'exit_hard_stop_enabled', value: dbState.exitHardStopEnabled });
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
jest.mock('@/lib/exchanges/kis', () => ({
  kis: {
    getTicker:  (...a: unknown[]) => getTicker(...a),
    getCandles: (...a: unknown[]) => getCandles(...a),
    getMarket:  () => 'domestic',
    createOrder: jest.fn(),
  },
  getBalancesDetailed: (...a: unknown[]) => getBalancesDetailed(...a),
}));
jest.mock('@/lib/strategy/market-hours', () => ({
  isDomesticOpen: async () => true,
  isOverseasOpen: async () => true,
  getCurrentMarket: async () => 'domestic',
}));

// ─── position_state — **이 파일의 핵심 관찰 대상** ────────────────────────────
const upsertPositionState = jest.fn().mockResolvedValue(undefined);
const reconcilePositionState = jest.fn().mockResolvedValue(0);
const loadPositionState = jest.fn();
jest.mock('@/lib/strategy/position-state', () => ({
  upsertPositionState:     (...a: unknown[]) => upsertPositionState(...a),
  reconcilePositionState:  (...a: unknown[]) => reconcilePositionState(...a),
  loadPositionState:       (...a: unknown[]) => loadPositionState(...a),
}));

// ─── 시그널 생성 — 실제 주문 경로의 유일한 입구 ──────────────────────────────
const createSignal = jest.fn();
jest.mock('@/lib/signals/service', () => ({ createSignal: (...a: unknown[]) => createSignal(...a) }));

const sendAlert = jest.fn();
const sendAlertThrottled = jest.fn();
jest.mock('@/lib/notify', () => ({ sendAlert: (...a: unknown[]) => sendAlert(...a) }));
jest.mock('@/lib/notify/throttle', () => ({
  sendAlertThrottled: (...a: unknown[]) => sendAlertThrottled(...a),
  resetAlertThrottle: () => {},
}));

// ─── 진입(매수) 파이프라인 주변부 — 통과시키고, 통과했는지 본다 ───────────────
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

/** 평가 대상 종목 — 테스트마다 바꾼다 (jest.mock 팩토리 밖 참조라 `mock` 접두사 필수). */
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

/** 매수 룰 1종 — 발화 여부를 테스트가 직접 조종한다. */
const buyRuleFn = jest.fn();
jest.mock('../rules', () => ({
  STRATEGY_REGISTRY: {
    'test-buy-v1': { interval: '1h', minCandles: 20, fn: (...a: unknown[]) => buyRuleFn(...a) },
  },
}));

import { runAll, resetHeldUnknownState } from '../engine';

// ─── 픽스처 ──────────────────────────────────────────────────────────────────
const ENTRY = 70_000;

/** 10:00 KST 수요일 — EOD 창(15:20~15:29)·장마감 매수차단(15:00~) 밖의 안전한 시각 */
const SAFE_KST = new Date('2026-08-05T01:00:00Z');
/** 15:25 KST 수요일 — EOD 손절 창 안 */
const EOD_KST = new Date('2026-08-05T06:25:00Z');

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
const NO_POSITION = {
  balances: [{ currency: 'KRW', free: 500_000, locked: 0 }],
  ok: ['domestic', 'overseas'] as Market[],
  failed: [] as { market: Market; error: string }[],
  complete: true,
};

/** exit-engine 이 실제로 발화 조건을 보는 상태를 만든다. */
function positionState(over: { entryPrice?: number; peakPrice?: number } = {}) {
  return {
    symbol: '005930', market: 'domestic' as Market,
    entryPrice: over.entryPrice ?? ENTRY,
    peakPrice: over.peakPrice ?? ENTRY,
    qty: 10, scenarioExit: null, holdingDeadline: null,
    firstSeenAt: new Date(), updatedAt: new Date(),
  };
}

/**
 * 네 가지 청산 종류를 각각 유발하는 (현재가, position_state) 조합.
 * `evaluateExit` 의 우선순위(EOD → hard_stop → … → trailing)를 그대로 이용한다.
 */
const EXIT_CASES = [
  { kind: 'hard_stop',      price: 60_000, state: positionState(),                        at: SAFE_KST },
  { kind: 'target_profit',  price: 75_000, state: positionState(),                        at: SAFE_KST },
  { kind: 'trailing_stop',  price: 72_000, state: positionState({ peakPrice: 74_000 }),   at: SAFE_KST },
  { kind: 'eod_loss_cut',   price: 68_000, state: positionState(),                        at: EOD_KST  },
] as const;

function useClock(at: Date) {
  jest.setSystemTime(at);
}

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks 는 구현(mockImplementation)을 되돌리지 않는다 — DB 장애 테스트의 구현이
  // 뒤 테스트로 새면 "OFF 인 줄 알았는데 사실은 db_error" 같은 거짓 통과가 생긴다.
  poolQuery.mockImplementation(defaultPoolQuery);
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  useClock(SAFE_KST);
  resetHeldUnknownState();
  dbState.exitEngineEnabled = null;
  dbState.exitHardStopEnabled = null;
  dbState.strategies = [];
  mockUniverse.symbols = ['005930'];
  engineSwitches.engineEnabled = false;
  buyRuleFn.mockReturnValue([]);
  getBalancesDetailed.mockResolvedValue(heldBalances());
  getTicker.mockResolvedValue({ price: ENTRY, open24h: ENTRY });
  getCandles.mockResolvedValue(Array.from({ length: 60 }, (_, i) => ({
    time: 1_700_000_000 + i * 3600, open: ENTRY, high: ENTRY, low: ENTRY, close: ENTRY, volume: 1_000,
  })));
  loadPositionState.mockResolvedValue(positionState());
  createSignal.mockResolvedValue({ ok: true, signalId: 1, autoSubmitted: false });
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ════════════════════════════════════════════════════════════════════════════
describe('🔕 OFF — 네 종류 청산이 **전부** 막힌다', () => {
  for (const c of EXIT_CASES) {
    test(`${c.kind}: 시그널을 만들지 않는다 (= 주문도 없다)`, async () => {
      dbState.exitEngineEnabled = 'false';
      useClock(c.at);
      getTicker.mockResolvedValue({ price: c.price, open24h: ENTRY });
      loadPositionState.mockResolvedValue(c.state);

      await runAll({ market: 'domestic' });

      expect(createSignal).not.toHaveBeenCalled();
      // 쿨다운도 걸지 않는다 — 차단은 "시도했다"가 아니다. 재활성 즉시 정상 평가돼야 한다.
      expect(setCooldown).not.toHaveBeenCalled();
    });

    test(`${c.kind}: ON 이면 그대로 발화한다 (기존 동작 보존)`, async () => {
      dbState.exitEngineEnabled = 'true';
      useClock(c.at);
      getTicker.mockResolvedValue({ price: c.price, open24h: ENTRY });
      loadPositionState.mockResolvedValue(c.state);

      await runAll({ market: 'domestic' });

      expect(createSignal).toHaveBeenCalledTimes(1);
      const arg = createSignal.mock.calls[0][0] as {
        side: string; strategyId: string; indicators: { exit_kind: string };
      };
      expect(arg.side).toBe('sell');
      expect(arg.strategyId).toBe('exit-engine-v1');
      expect(arg.indicators.exit_kind).toBe(c.kind);
      expect(setCooldown).toHaveBeenCalled();
    });
  }

  test('키가 아예 없어도(=미시드) 막힌다 — 기본 방향은 비활성', async () => {
    dbState.exitEngineEnabled = null;
    getTicker.mockResolvedValue({ price: 60_000, open24h: ENTRY });
    await runAll({ market: 'domestic' });
    expect(createSignal).not.toHaveBeenCalled();
  });

  test('🔴 system_config 조회가 실패해도 막힌다 (fail-closed)', async () => {
    poolQuery.mockImplementation(async (sql: unknown) => {
      if (/FROM system_config/i.test(String(sql))) throw new Error('db down');
      return [[]];
    });
    getTicker.mockResolvedValue({ price: 60_000, open24h: ENTRY });
    await runAll({ market: 'domestic' });
    expect(createSignal).not.toHaveBeenCalled();
  });

  test('ON + hard_stop 개별 OFF 조합은 종전대로 hard_stop 만 막는다', async () => {
    dbState.exitEngineEnabled = 'true';
    dbState.exitHardStopEnabled = 'false';
    getTicker.mockResolvedValue({ price: 60_000, open24h: ENTRY });
    await runAll({ market: 'domestic' });
    expect(createSignal).not.toHaveBeenCalled();

    // 익절은 마스터 ON 이므로 그대로 나간다
    jest.clearAllMocks();
    getTicker.mockResolvedValue({ price: 75_000, open24h: ENTRY });
    loadPositionState.mockResolvedValue(positionState());
    createSignal.mockResolvedValue({ ok: true, signalId: 2, autoSubmitted: false });
    await runAll({ market: 'domestic' });
    expect(createSignal).toHaveBeenCalledTimes(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('🔴 OFF 여도 position_state 추적은 살아 있다', () => {
  test('진입가·고점 upsert 가 그대로 실행된다', async () => {
    dbState.exitEngineEnabled = 'false';
    getTicker.mockResolvedValue({ price: 60_000, open24h: ENTRY });

    await runAll({ market: 'domestic' });

    expect(upsertPositionState).toHaveBeenCalledTimes(1);
    expect(upsertPositionState).toHaveBeenCalledWith('005930', 'domestic', 60_000, ENTRY, 10);
  });

  test('고점 갱신 경로도 그대로 — 신고가 틱에서도 upsert 된다', async () => {
    dbState.exitEngineEnabled = 'false';
    getTicker.mockResolvedValue({ price: 74_000, open24h: ENTRY });
    loadPositionState.mockResolvedValue(positionState({ peakPrice: 74_000 }));

    await runAll({ market: 'domestic' });

    expect(upsertPositionState).toHaveBeenCalledWith('005930', 'domestic', 74_000, ENTRY, 10);
  });

  test('reconcile(미보유 row 정리)도 실제 보유 목록으로 계속 실행된다', async () => {
    dbState.exitEngineEnabled = 'false';
    await runAll({ market: 'domestic' });
    expect(reconcilePositionState).toHaveBeenCalledTimes(1);
    expect(reconcilePositionState.mock.calls[0]).toEqual(['domestic', ['005930']]);
  });

  test('🔴 OFF 라고 해서 "보유 모름"의 reconcile 차단이 풀리지 않는다 (0ba652e 회귀 방지)', async () => {
    dbState.exitEngineEnabled = 'false';
    getBalancesDetailed.mockResolvedValue({
      balances: [],
      ok: ['overseas'] as Market[],
      failed: [{ market: 'domestic' as Market, error: 'EGW00201' }],
      complete: false,
    });
    const r = await runAll({ market: 'domestic' });
    expect(r.errors).toEqual(['balances_unknown']);
    expect(reconcilePositionState).not.toHaveBeenCalled();
    expect(upsertPositionState).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('✅ 매수 파이프라인은 전혀 영향받지 않는다', () => {
  /** 매수 후보 1건이 나오는 최소 구성 */
  function armBuyPipeline() {
    engineSwitches.engineEnabled = true;
    dbState.strategies = [{ id: 'test-buy-v1', enabled: 1, backtest_interval_h: 6, next_backtest_at: null }];
    buyRuleFn.mockReturnValue([{
      strategyId: 'test-buy-v1', symbol: '005930', side: 'buy',
      orderType: 'limit', price: ENTRY, amountKRW: 50_000,
      reasoning: 'test', indicators: {},
    }]);
  }

  test('청산 OFF 상태에서도 매수 시그널은 그대로 생성된다', async () => {
    dbState.exitEngineEnabled = 'false';
    getBalancesDetailed.mockResolvedValue(NO_POSITION);   // 보유 없음 → 청산 트랙 무관
    armBuyPipeline();

    await runAll({ market: 'domestic' });

    const buys = createSignal.mock.calls.filter(c => (c[0] as { side: string }).side === 'buy');
    expect(buys).toHaveLength(1);
    expect((buys[0][0] as { strategyId: string }).strategyId).toBe('test-buy-v1');
  });

  test('보유 종목이 청산 조건을 충족한 상태에서도 매수 경로는 동일하게 돈다', async () => {
    dbState.exitEngineEnabled = 'false';
    getBalancesDetailed.mockResolvedValue(heldBalances(10, 100_000));  // 다른 종목 없음
    getTicker.mockResolvedValue({ price: 60_000, open24h: ENTRY });
    loadPositionState.mockResolvedValue(positionState({ entryPrice: 100_000 }));
    armBuyPipeline();
    // 손실 중 보유 종목의 추가매수는 별개 가드(losing_position_buy_block)가 막으므로
    // 매수 후보는 **보유하지 않은** 다른 종목에서 나오게 한다.
    mockUniverse.symbols = ['005930', '000660'];
    buyRuleFn.mockImplementation((input: { symbol: string }) => (
      input.symbol === '000660'
        ? [{
            strategyId: 'test-buy-v1', symbol: '000660', side: 'buy',
            orderType: 'limit', price: 50_000, amountKRW: 50_000, reasoning: 'test', indicators: {},
          }]
        : []
    ));

    await runAll({ market: 'domestic' });

    const sells = createSignal.mock.calls.filter(c => (c[0] as { side: string }).side === 'sell');
    expect(sells).toHaveLength(0);                        // 청산은 여전히 0건
    const buys = createSignal.mock.calls.filter(c => (c[0] as { side: string }).side === 'buy');
    expect(buys.length).toBeGreaterThan(0);               // 매수는 살아 있다
  });

  test('청산 ON/OFF 가 매수 결과를 바꾸지 않는다 (동일 입력 → 동일 매수 건수)', async () => {
    getBalancesDetailed.mockResolvedValue(NO_POSITION);
    armBuyPipeline();

    dbState.exitEngineEnabled = 'false';
    await runAll({ market: 'domestic' });
    const offBuys = createSignal.mock.calls.filter(c => (c[0] as { side: string }).side === 'buy').length;

    jest.clearAllMocks();
    createSignal.mockResolvedValue({ ok: true, signalId: 9, autoSubmitted: false });
    armBuyPipeline();
    dbState.exitEngineEnabled = 'true';
    await runAll({ market: 'domestic' });
    const onBuys = createSignal.mock.calls.filter(c => (c[0] as { side: string }).side === 'buy').length;

    expect(offBuys).toBe(1);
    expect(onBuys).toBe(offBuys);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('🔊 꺼진 상태를 오해할 수 없게 만든다', () => {
  test('보유가 있으면 매 틱 경고 로그를 남긴다 (조용한 플래그 금지)', async () => {
    dbState.exitEngineEnabled = 'false';
    await runAll({ market: 'domestic' });
    const warned = (console.warn as jest.Mock).mock.calls.map(c => String(c[0])).join('\n');
    expect(warned).toContain('자동 청산 엔진 OFF');
    expect(warned).toContain('추적은 계속');
  });

  test('실제로 청산이 막힌 틱에는 알림이 나간다', async () => {
    dbState.exitEngineEnabled = 'false';
    getTicker.mockResolvedValue({ price: 60_000, open24h: ENTRY });
    await runAll({ market: 'domestic' });

    expect(sendAlertThrottled).toHaveBeenCalledTimes(1);
    const [key, level, title, body] = sendAlertThrottled.mock.calls[0];
    expect(String(key)).toContain('exit-engine:disabled');
    expect(level).toBe('warning');
    expect(String(title)).toContain('자동 청산 OFF');
    expect(String(body)).toContain('자동으로 끊지 않습니다');
  });

  test('막힌 청산이 없으면 알리지 않는다 (경보 피로 방지)', async () => {
    dbState.exitEngineEnabled = 'false';
    getTicker.mockResolvedValue({ price: ENTRY, open24h: ENTRY });   // 아무 조건도 미충족
    await runAll({ market: 'domestic' });
    expect(sendAlertThrottled).not.toHaveBeenCalled();
  });

  test('ON 상태에서는 OFF 경고를 내지 않는다', async () => {
    dbState.exitEngineEnabled = 'true';
    getTicker.mockResolvedValue({ price: 60_000, open24h: ENTRY });
    await runAll({ market: 'domestic' });
    const warned = (console.warn as jest.Mock).mock.calls.map(c => String(c[0])).join('\n');
    expect(warned).not.toContain('자동 청산 엔진 OFF');
    expect(sendAlertThrottled).not.toHaveBeenCalled();
  });
});

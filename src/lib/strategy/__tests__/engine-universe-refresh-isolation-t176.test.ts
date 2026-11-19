/**
 * T-176 WP-2 — universe 갱신이 **던져도** `runMarket` 이 회차를 끝까지 돈다(방어선).
 *
 * 2026-11-18 12:11 KST: 갱신 안의 KIS 시총 순위 조회 예외가 `runMarket` → `runAll` → 라우트 catch → HTTP 500 으로
 * 이어져 그 회차의 진입 평가가 통째로 빠졌다. 고정하는 것:
 *  ① 던져도 전략 평가(수집)까지 진입하고 run 행(pass)이 남는다 — 이전 universe 로 계속
 *  ② 실패는 조용히 버리지 않는다 — 평가 기록 `universe_refresh_failed`(error, 회차 행) · 로그 · 응답 errors[] 코드
 *  ③ 응답 형식 불변 — `universeRefreshed:false`, 오류 문구는 errors[] 에 싣지 않는다
 *  ④ 정상 갱신이면 종전과 같다(추가 행·키 없음)
 *  ⑤ `job_run_log` 판정은 200 응답이면 `ok` — 성공한 회차를 실패로 바꾸지 않는다
 *
 * 모의 구조는 engine-collect-fanout-t148.test.ts 와 같다(이 파일은 갱신 실패 격리만 본다).
 */
import type { Market } from '@/lib/exchanges/kis-symbols';

// ─── 모의 DB ─────────────────────────────────────────────────────────────────
const funnelRows: Array<{ symbol: string | null; stage: number; gate: string; verdict: string; reason: string | null; detail: unknown }> = [];
let strategyRows: Array<{ id: string; enabled: number; backtest_interval_h: number; next_backtest_at: null }> = [];
async function poolQuery(sql: unknown, params?: unknown) {
  const s = String(sql);
  const p = (params as unknown[] | undefined) ?? [];
  if (/INSERT INTO eval_funnel/i.test(s)) {
    for (let i = 0; i + 9 < p.length; i += 10) {
      funnelRows.push({
        symbol: p[i + 2] as string | null, stage: Number(p[i + 5]), gate: String(p[i + 6]), verdict: String(p[i + 7]),
        reason: p[i + 8] as string | null, detail: p[i + 9] == null ? null : JSON.parse(String(p[i + 9])),
      });
    }
    return [{ affectedRows: 1 }, []];
  }
  if (/FROM strategies/i.test(s)) return [strategyRows.slice(), []];
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
const getTicker = jest.fn();
const getCandles = jest.fn();
jest.mock('@/lib/exchanges/kis', () => ({
  kis: {
    getTicker: (...a: unknown[]) => getTicker(...a),
    getCandles: (...a: unknown[]) => getCandles(...a),
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
jest.mock('@/lib/signals/service', () => ({ createSignal: jest.fn(), getEffectiveChasePct: async () => 0 }));
jest.mock('@/lib/notify', () => ({ sendAlert: jest.fn() }));
jest.mock('@/lib/notify/throttle', () => ({ sendAlertThrottled: jest.fn(), resetAlertThrottle: () => {} }));
jest.mock('@/lib/signals/router', () => ({ getEngineSwitches: async () => ({ engineEnabled: true, autopilotMode: 'assist', source: 'config' }) }));
jest.mock('@/lib/strategy/cooldowns', () => ({
  loadActiveCooldowns: async () => ({ isActive: () => false, until: () => null, loadError: null }),
  setCooldown: jest.fn(async () => true),
  COOLDOWN_TTL_MIN: { entry: 120, rebuy: 30, exit: 15, entryRejected: 240 },
}));
jest.mock('@/lib/strategy/style', () => ({
  getStyleConfig: async () => ({
    hardStopPct: 5, targetProfitPct: 3, trailingActivatePct: 3, trailingDrawdownPct: 2, eodLossCutPct: 2,
    lateSessionBuyBlockMin: 30, feePct: 0.18, slippagePct: 0.15, stableCoreRatioMin: 0,
  }),
  roundTripCostPct: () => 0.33,
}));
/** 갱신 — 시험마다 성공·실패를 바꾼다. 이전 universe 는 `getUniverseSymbols` 가 돌려주는 목록으로 흉내낸다. */
const refreshUniverse = jest.fn();
const previousUniverse: string[] = [];
const alwaysInclude: string[] = [];
jest.mock('@/lib/strategy/universe', () => ({
  refreshUniverse: (...a: unknown[]) => refreshUniverse(...a),
  getUniverseSymbols: async () => previousUniverse.slice(),
  getAlwaysIncludeSymbols: async () => alwaysInclude.slice(),
}));
jest.mock('@/lib/strategy/macro', () => ({ fetchMacroIndicators: async () => ({ kospiChangePct: 0, sp500ChangePct: 0 }) }));
jest.mock('@/lib/safety/order-limits', () => ({ getEffectiveOrderMax: async () => 100_000 }));
jest.mock('@/lib/strategy/portfolio-stability', () => ({ checkPortfolioStability: async () => ({ verdict: 'pass' }) }));
jest.mock('@/lib/strategy/adaptive-buy-sizing', () => ({ allocateAdaptiveBuys: jest.fn() }));
jest.mock('@/lib/safety/validation-gate', () => ({
  evaluateValidationGate: async ({ strategyId }: { strategyId: string }) => ({ allowed: true, kind: 'validated', strategyId, status: 'backtested' }),
}));
jest.mock('@/lib/strategy/ai-prefilter', () => ({ prefilterCandidate: () => ({ verdict: 'pass' }) }));
jest.mock('@/lib/strategy/ai-filter', () => ({ buildMarketSummary: () => ({ rsi14: 30 }) }));
jest.mock('@/lib/strategy/market-state', () => ({ classifyMarketState: () => 'neutral' }));
const RULE_ID = 't176-noop';
jest.mock('@/lib/strategy/rules', () => ({
  STRATEGY_REGISTRY: { 't176-noop': { interval: '1h', minCandles: 20, fn: () => [] } },
}));
jest.mock('@/lib/strategy/sell-proposal-preview', () => ({ openSellProposalPreview: async () => null }));

import { runAll, resetHeldUnknownState } from '../engine';
import { FUNNEL_GATES, GATE_LABEL_KO, GATE_STAGE, gateLabelKo } from '../eval-funnel-labels';
import { classifyRun } from '../records/job-run-log';

// ─── 픽스처 ──────────────────────────────────────────────────────────────────
/** 2026-08-05(수) 10:00 KST — 장마감 전 손절 창 밖 */
const SAFE_KST = new Date('2026-08-05T01:00:00Z');
const PRICE = 70_000;
const CANDLES = Array.from({ length: 30 }, (_, i) => ({ ts: i * 3_600_000, open: PRICE, high: PRICE, low: PRICE, close: PRICE, volume: 1_000 }));

function balances() {
  return {
    balances: [{ currency: 'KRW', free: 500_000, locked: 0 }],
    ok: ['domestic', 'overseas'] as Market[], failed: [] as Array<{ market: Market; error: string }>, complete: true,
  };
}

let errorLog: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
  funnelRows.length = 0;
  strategyRows = [{ id: RULE_ID, enabled: 1, backtest_interval_h: 6, next_backtest_at: null }];
  previousUniverse.length = 0; previousUniverse.push('000660', '035720');
  alwaysInclude.length = 0; alwaysInclude.push('005930');
  resetHeldUnknownState();
  getTicker.mockImplementation(async (s: string) => ({ price: PRICE, open24h: PRICE, timestamp: 0, symbol: s }));
  getCandles.mockResolvedValue(CANDLES);
  getBalancesDetailed.mockResolvedValue(balances());
  jest.setSystemTime(SAFE_KST);
});
afterEach(() => { jest.restoreAllMocks(); });
beforeAll(() => { jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'performance', 'hrtime'] }); });
afterAll(() => { jest.useRealTimers(); });

const rows = (gate: string) => funnelRows.filter((r) => r.gate === gate);

/** 2026-11-18 에 실제로 던진 모양 — undici `fetch failed` + cause */
function networkError() {
  const e = new TypeError('fetch failed');
  (e as { cause?: unknown }).cause = Object.assign(new Error('connect ETIMEDOUT'), {
    code: 'ETIMEDOUT', syscall: 'connect', address: '10.0.0.1', port: 9443,
  });
  return e;
}

describe('universe 갱신이 던질 때', () => {
  test('🔴 회차가 멈추지 않는다 — 이전 universe 로 수집까지 가고 run 행(pass)이 남는다', async () => {
    refreshUniverse.mockRejectedValue(networkError());
    const res = await runAll({ market: 'domestic' });

    expect(refreshUniverse).toHaveBeenCalledTimes(1);
    // 이전 universe(000660·035720) + always-include(005930) 전부 평가
    expect(getTicker.mock.calls.map((c) => c[0]).sort()).toEqual(['000660', '005930', '035720']);
    expect(rows('collect').map((r) => r.symbol).sort()).toEqual(['000660', '005930', '035720']);
    expect(res.ran).toBe(3);
    expect(res.universeRefreshed).toBe(false);
    const run = rows('run');
    expect(run).toHaveLength(1);
    expect(run[0].verdict).toBe('pass');
    expect(run[0].detail).toMatchObject({ universeRefreshFailed: true, errors: 1 });
  });

  test('실패는 평가 기록(회차 행, error)·로그·응답 errors[] 코드로 남는다 — 오류 문구는 응답에 싣지 않는다', async () => {
    refreshUniverse.mockRejectedValue(networkError());
    const res = await runAll({ market: 'domestic' });

    const failed = rows('universe_refresh_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ symbol: null, stage: 0, verdict: 'error' });
    expect(failed[0].detail).toEqual({
      error: 'TypeError: fetch failed',
      cause: 'cause=ETIMEDOUT connect 10.0.0.1:9443',
    });

    expect(res.errors).toEqual(['domestic_universe_refresh_failed']);
    expect(JSON.stringify(res)).not.toContain('fetch failed');

    const logged = errorLog.mock.calls.map((c) => c.map(String).join(' '));
    expect(logged.some((l) => l.includes('[strategy-eval:domestic] universe 갱신 실패 — 이전 후보 목록으로 평가 계속')
      && l.includes('TypeError: fetch failed') && l.includes('cause=ETIMEDOUT connect 10.0.0.1:9443'))).toBe(true);
  });

  test('DB 오류·Error 가 아닌 값·문자열화 불가 값도 같은 방식으로 흡수한다(감싸는 범위 = 갱신 전체)', async () => {
    refreshUniverse.mockRejectedValue(Object.assign(new Error('Connection lost: The server closed the connection.'), { code: 'PROTOCOL_CONNECTION_LOST' }));
    await expect(runAll({ market: 'domestic' })).resolves.toMatchObject({ errors: ['domestic_universe_refresh_failed'] });
    expect(rows('universe_refresh_failed')[0].detail).toMatchObject({ cause: 'code=PROTOCOL_CONNECTION_LOST' });

    funnelRows.length = 0;
    refreshUniverse.mockRejectedValue(Object.create(null));
    await expect(runAll({ market: 'domestic' })).resolves.toMatchObject({ errors: ['domestic_universe_refresh_failed'] });
    expect(rows('universe_refresh_failed')).toHaveLength(1);
    expect(rows('run')[0].verdict).toBe('pass');
  });

  test('동기적으로 던져도(Promise 를 돌려주기 전) 같다', async () => {
    refreshUniverse.mockImplementation(() => { throw new Error('sync boom'); });
    const res = await runAll({ market: 'domestic' });
    expect(res.errors).toEqual(['domestic_universe_refresh_failed']);
    expect(rows('run')[0].verdict).toBe('pass');
  });

  test('활성 전략이 없어 일찍 끝나는 회차도 errors[] 코드와 run 행 표시를 남긴다', async () => {
    strategyRows = [];
    refreshUniverse.mockRejectedValue(networkError());
    const res = await runAll({ market: 'domestic' });
    expect(res).toMatchObject({ ran: 0, errors: ['domestic_universe_refresh_failed'], universeRefreshed: false });
    const run = rows('run');
    expect(run).toHaveLength(1);
    expect(run[0]).toMatchObject({ verdict: 'skip', reason: 'no_active_strategies' });
    expect(run[0].detail).toMatchObject({ universeRefreshFailed: true });
    expect(rows('universe_refresh_failed')).toHaveLength(1);
  });
});

describe('정상 갱신 — 종전과 같다', () => {
  test.each([true, false])('refreshed=%s 면 실패 행·errors[] 코드·detail 키가 없다', async (refreshed) => {
    refreshUniverse.mockResolvedValue({ refreshed });
    const res = await runAll({ market: 'domestic' });
    expect(res.errors).toEqual([]);
    expect(res.universeRefreshed).toBe(refreshed);
    expect(rows('universe_refresh_failed')).toHaveLength(0);
    expect(rows('run')[0].detail).not.toHaveProperty('universeRefreshFailed');
    expect(errorLog.mock.calls.some((c) => String(c[0]).includes('universe 갱신 실패'))).toBe(false);
  });
});

describe('게이트 등록·판정 영향', () => {
  test('목록 끝 append, stage 0(런 게이트), 한글 라벨, VARCHAR(48) 이내', () => {
    expect(FUNNEL_GATES[FUNNEL_GATES.length - 1]).toBe('universe_refresh_failed');
    expect(FUNNEL_GATES.filter((g) => g === 'universe_refresh_failed')).toHaveLength(1);
    expect(GATE_STAGE.universe_refresh_failed).toBe(0);
    expect(GATE_LABEL_KO.universe_refresh_failed).toBe('분석 후보 목록 갱신 실패 — 이전 목록으로 평가 계속');
    expect(gateLabelKo('universe_refresh_failed')).toBe(GATE_LABEL_KO.universe_refresh_failed);
    expect('universe_refresh_failed'.length).toBeLessThanOrEqual(48);
  });

  test('⑤ 200 {ok:true} 응답에 이 코드가 있어도 job_run_log 판정은 ok 다(성공한 회차를 실패로 만들지 않는다)', () => {
    const body = JSON.stringify({ ok: true, ran: 3, skipped: 0, skippedStrategyIds: [], results: [], errors: ['domestic_universe_refresh_failed'], universeRefreshed: false });
    expect(classifyRun('strategy-eval', 200, body).status).toBe('ok');
    // 종전 — 같은 예외가 라우트까지 올라가면 500 → failed(홈 「데이터 이상·분석 실패」)
    expect(classifyRun('strategy-eval', 500, JSON.stringify({ ok: false, error: 'fetch failed' })).status).toBe('failed');
  });
});

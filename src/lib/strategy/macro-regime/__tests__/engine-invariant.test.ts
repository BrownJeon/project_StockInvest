/**
 * 🔴 T-165 완료 기준 3 — **라벨 유무와 무관하게 엔진의 게이트 판정·주문 후보·금액이 동일하다** (Leader G4-5 + G7-4).
 *
 * 같은 입력으로 `runAll` 을 변형마다 돌리고, 기준군 ⓔ 와 **직렬화 바이트 단위로** 비교한다.
 *  ⓔ 기준군 — macro-regime 모듈을 모킹해 kick 은 no-op, 기록 값은 undefined(= detail 에 키 없음, 변경 전 동작)
 *  ⓐ 실제 모듈 · 미로딩(시험 환경 기본 수집기 → disabled_in_test → unknown(cpi_not_loaded))
 *  ⓐ' 실제 모듈 · 캐시 적재(BLS 실측 지수) → 실제 분류(normal_hold)
 *  ⓑ `hot_tightening`(유형⑤) 강제        ⓒ `unknown` 강제
 *  ⓓ 분류 내부가 throw 하도록 강제 → 공개 함수가 흡수해 unknown(internal_error)
 *  ⓕ 수집 promise 가 **끝나지 않는(pending)** 수집기 — 런은 기다리지 않고 기준군과 같게 끝난다
 * 각 변형을 세 장면에서: 거시 게이트 미발동(고정 한도) · 미발동(적응형 무제한 한도·배분 금액) · **발동**.
 *
 * 비교 대상: runAll 반환값 · createSignal 호출 인자(금액·수량 포함) · 배분(allocate)·포트폴리오 가드·프리필터 호출 인자 ·
 * 알림 호출 · eval_funnel INSERT 전체(최종 run 행의 `detail.macroRegime` 키만 제외) · 그 밖의 DB 질의 전체.
 * 제외는 둘뿐이다: ① 최종 run 행의 `detail.macroRegime` ② eval_funnel 보관 삭제(DELETE — 프로세스당 6시간 타이머라
 * 이 파일의 첫 런에서만 나간다. 변형과 무관).
 *
 * ⓓ 주의 — `getMacroRegimeRecord` **자체**를 throw 하는 모의로 바꾸면 엔진은 최종 run 행을 만드는 중에 던진다(G3 은
 * 엔진에 try/catch 를 두지 않기로 했다). 그래서 G4-5 지시대로 엔진을 감싸지 않고, 공개 함수가 절대 던지지 않음을
 * 이 시험(ⓓ: 내부 throw 흡수)과 `snapshot.test.ts`(무예외 묶음)로 고정한다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Market } from '@/lib/exchanges/kis-symbols';

// ─── 모의 DB — 모든 질의를 순서대로 남긴다 ─────────────────────────────────────
const queries: Array<{ sql: string; params: unknown[] }> = [];
async function poolQuery(sql: unknown, params?: unknown) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  const p = Array.isArray(params) ? params.slice() : [];
  queries.push({ sql: s, params: p });
  if (/INSERT INTO eval_funnel/i.test(s)) return [{ affectedRows: p.length / 10 }, []];
  if (/FROM strategies/i.test(s)) return [[{ id: RULE_ID, enabled: 1, backtest_interval_h: 6, next_backtest_at: null }], []];
  return [[], []];
}
jest.mock('@/lib/db', () => ({
  getPool: () => ({
    query: (...a: unknown[]) => poolQuery(a[0], a[1]),
    getConnection: async () => ({ query: (...a: unknown[]) => poolQuery(a[0], a[1]), release: () => {}, destroy: () => {} }),
  }),
}));

// ─── 외부 I/O — 즉시 응답(타이머 없음 → 완료 순서가 결정적) ─────────────────────
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
const createSignal = jest.fn();
jest.mock('@/lib/signals/service', () => ({ createSignal: (...a: unknown[]) => createSignal(...a), getEffectiveChasePct: async () => 0 }));
const sendAlert = jest.fn();
jest.mock('@/lib/notify', () => ({ sendAlert: (...a: unknown[]) => sendAlert(...a) }));
const sendAlertThrottled = jest.fn();
jest.mock('@/lib/notify/throttle', () => ({ sendAlertThrottled: (...a: unknown[]) => sendAlertThrottled(...a), resetAlertThrottle: () => {} }));
jest.mock('@/lib/signals/router', () => ({ getEngineSwitches: async () => ({ engineEnabled: true, autopilotMode: 'assist', source: 'config' }) }));
const setCooldown = jest.fn(async () => true);
jest.mock('@/lib/strategy/cooldowns', () => ({
  loadActiveCooldowns: async () => ({ isActive: () => false, until: () => null, loadError: null }),
  setCooldown: (...a: unknown[]) => (setCooldown as jest.Mock)(...a),
  COOLDOWN_TTL_MIN: { entry: 120, rebuy: 30, exit: 15, entryRejected: 240 },
}));
jest.mock('@/lib/strategy/style', () => ({
  getStyleConfig: async () => ({
    hardStopPct: 5, targetProfitPct: 3, trailingActivatePct: 3, trailingDrawdownPct: 2, eodLossCutPct: 2,
    lateSessionBuyBlockMin: 30, feePct: 0.18, slippagePct: 0.15, stableCoreRatioMin: 0,
  }),
  roundTripCostPct: () => 0.33,
}));
const SYMBOLS = ['005930', '000660', '035720', '005380', '051910', '006400'];
jest.mock('@/lib/strategy/universe', () => ({
  refreshUniverse: async () => ({ refreshed: false }),
  getUniverseSymbols: async () => [] as string[],
  getAlwaysIncludeSymbols: async () => SYMBOLS.slice(),
}));
/** 거시 게이트 입력 — 장면마다 바꾼다 (기존 `macro.ts` 는 건드리지 않고 모의만) */
let macroNow = { kospiChangePct: 0, sp500ChangePct: 0, usdKrwChangePct: 0 };
jest.mock('@/lib/strategy/macro', () => ({ fetchMacroIndicators: async () => ({ ...macroNow }) }));
let orderMax: number | 'unlimited' = 100_000;
jest.mock('@/lib/safety/order-limits', () => ({ getEffectiveOrderMax: async () => orderMax }));
const portfolioGuard = jest.fn(async (_input: unknown) => ({ verdict: 'pass' }));
jest.mock('@/lib/strategy/portfolio-stability', () => ({ checkPortfolioStability: (input: unknown) => portfolioGuard(input) }));
const allocate = jest.fn();
jest.mock('@/lib/strategy/adaptive-buy-sizing', () => ({ allocateAdaptiveBuys: (...args: unknown[]) => allocate(...args) }));
const prefilterCandidate = jest.fn();
jest.mock('@/lib/strategy/ai-prefilter', () => ({ prefilterCandidate: (...a: unknown[]) => prefilterCandidate(...a) }));
jest.mock('@/lib/strategy/ai-filter', () => ({ buildMarketSummary: () => ({ rsi14: 30 }) }));
jest.mock('@/lib/strategy/market-state', () => ({ classifyMarketState: () => 'neutral' }));
const RULE_ID = 't165-fires';
jest.mock('@/lib/strategy/rules', () => ({
  STRATEGY_REGISTRY: {
    't165-fires': {
      interval: '1h',
      minCandles: 20,
      fn: ({ symbol, amountKRW }: { symbol: string; amountKRW: number }) =>
        [{ symbol, side: 'buy', amountKRW, price: 70_000, indicators: { t165: 1 }, reason: 't165' }],
    },
  },
}));
jest.mock('@/lib/strategy/sell-proposal-preview', () => ({ openSellProposalPreview: async () => null }));

/** ⓔ 기준군 스위치 — 'baseline' 이면 macro-regime 이 없던 때처럼 동작한다 */
let regimeMode: 'baseline' | 'real' = 'real';
const regimeCalls = { kick: 0, get: 0 };
jest.mock('@/lib/strategy/macro-regime', () => {
  const actual = jest.requireActual('@/lib/strategy/macro-regime');
  return {
    kickMacroRegimeRefresh: (...a: unknown[]) => {
      regimeCalls.kick++;
      return regimeMode === 'baseline' ? undefined : actual.kickMacroRegimeRefresh(...a);
    },
    getMacroRegimeRecord: (...a: unknown[]) => {
      regimeCalls.get++;
      return regimeMode === 'baseline' ? undefined : actual.getMacroRegimeRecord(...a);
    },
  };
});

import { runAll, resetHeldUnknownState } from '../../engine';
import {
  __macroRegimeInFlightForTest,
  __resetMacroRegimeForTest,
  __setMacroRegimeClassifierForTest,
  __setMacroRegimeFetcherForTest,
  kickMacroRegimeRefresh,
} from '../snapshot';
import { classifyMacroRegime } from '../classify';
import type { BlsFetchResult } from '../bls-cpi';
import type { CpiIndexByMonth, MacroRegimeRecord } from '../types';

const CPI: CpiIndexByMonth = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'cpi-cuur0000sa0-2017-2026.json'), 'utf8')).index;
/** 2026-08-05(수) 10:00 KST — 국내 장중, 장마감 전 손절 창 밖 (T-148 과 같은 시각) */
const SAFE_KST = new Date('2026-08-05T01:00:00Z');
const PRICE = 70_000;
const CANDLES = Array.from({ length: 30 }, (_, i) => ({ ts: i * 3_600_000, open: PRICE, high: PRICE, low: PRICE, close: PRICE, volume: 1_000 }));

const realFetch = globalThis.fetch;
const globalFetch = jest.fn(async () => { throw new Error('전역 fetch 가 호출되면 안 된다 (BLS 실호출 0)'); });

function resetAll() {
  jest.clearAllMocks();
  queries.length = 0;
  regimeCalls.kick = 0; regimeCalls.get = 0;
  resetHeldUnknownState();
  __resetMacroRegimeForTest();
  createSignal.mockImplementation(async (input: { symbol: string }) => ({ ok: true, signalId: 1000 + SYMBOLS.indexOf(input.symbol), autoSubmitted: false }));
  prefilterCandidate.mockReturnValue({ verdict: 'pass' });
  getTicker.mockImplementation(async (s: string) => ({ price: PRICE, open24h: PRICE, timestamp: 0, symbol: s }));
  getCandles.mockImplementation(async () => CANDLES);
  getBalancesDetailed.mockResolvedValue({
    balances: [{ currency: 'KRW', free: 500_000, locked: 0 }],
    ok: ['domestic', 'overseas'] as Market[], failed: [] as Array<{ market: Market; error: string }>, complete: true,
  });
  allocate.mockImplementation((_market: unknown, cands: Array<Record<string, unknown>>) => ({
    orders: new Map(cands.slice(0, 2).map((c, i) => [c, { ...c, amountKRW: 155_000 - i * 10_000, quantity: 2 - i }])),
    reason: 'allocated',
  }));
}

beforeAll(() => {
  jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'performance', 'hrtime'] });
  (globalThis as { fetch: unknown }).fetch = globalFetch;
});
afterAll(() => {
  jest.useRealTimers();
  (globalThis as { fetch: unknown }).fetch = realFetch;
  __resetMacroRegimeForTest();
});
beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.setSystemTime(SAFE_KST);
});
afterEach(() => {
  jest.restoreAllMocks();
  expect(globalFetch).not.toHaveBeenCalled();
});

// ─── 장면 · 변형 ─────────────────────────────────────────────────────────────
interface Scene { name: string; macro: typeof macroNow; orderMax: number | 'unlimited'; gateBlocked: boolean }
const SCENES: Scene[] = [
  { name: '거시 게이트 미발동 · 고정 한도', macro: { kospiChangePct: 0, sp500ChangePct: 0, usdKrwChangePct: 0 }, orderMax: 100_000, gateBlocked: false },
  { name: '거시 게이트 미발동 · 적응형 무제한(배분 금액)', macro: { kospiChangePct: 0.4, sp500ChangePct: -0.3, usdKrwChangePct: 0 }, orderMax: 'unlimited', gateBlocked: false },
  { name: '🔴 거시 게이트 발동(KOSPI·S&P −2%)', macro: { kospiChangePct: -2, sp500ChangePct: -2, usdKrwChangePct: 0 }, orderMax: 100_000, gateBlocked: true },
];

interface Variant { key: string; desc: string; setup: () => Promise<void>; check: (rec: MacroRegimeRecord) => void }
const forced = (over: Partial<MacroRegimeRecord>) => (input: Parameters<typeof classifyMacroRegime>[0]) => ({ ...classifyMacroRegime(input), ...over });
const VARIANTS: Variant[] = [
  {
    key: 'a', desc: 'ⓐ 실제 모듈 · 미로딩(unknown)',
    setup: async () => {},
    check: (r) => { expect(r.label).toBe('unknown'); expect(r.reasonCodes).toEqual(['cpi_not_loaded']); expect(r.cpi.fetchStatus).toBe('disabled_in_test'); },
  },
  {
    key: "a'", desc: "ⓐ' 실제 모듈 · 캐시 적재(실제 분류 normal_hold)",
    setup: async () => {
      __setMacroRegimeFetcherForTest(async (): Promise<BlsFetchResult> => ({ fetchStatus: 'ok', observations: CPI }));
      kickMacroRegimeRefresh(new Date());
      await __macroRegimeInFlightForTest();
    },
    check: (r) => { expect(r.label).toBe('normal_hold'); expect(r.cpi).toMatchObject({ referenceMonth: '2026-06', yoyPct: 3.5 }); },
  },
  {
    key: 'b', desc: 'ⓑ hot_tightening(유형⑤) 강제',
    setup: async () => { __setMacroRegimeClassifierForTest(forced({ label: 'hot_tightening', isType5: true, reasonCodes: [] })); },
    check: (r) => { expect(r.label).toBe('hot_tightening'); expect(r.isType5).toBe(true); },
  },
  {
    key: 'c', desc: 'ⓒ unknown 강제',
    setup: async () => { __setMacroRegimeClassifierForTest(forced({ label: 'unknown', isType5: false, reasonCodes: ['cpi_stale'] })); },
    check: (r) => { expect(r.label).toBe('unknown'); expect(r.reasonCodes).toEqual(['cpi_stale']); },
  },
  {
    key: 'd', desc: 'ⓓ 분류 내부 throw 강제 → 흡수',
    setup: async () => { __setMacroRegimeClassifierForTest(() => { throw new Error('forced classify failure'); }); },
    check: (r) => { expect(r.label).toBe('unknown'); expect(r.reasonCodes).toEqual(['internal_error']); },
  },
  {
    key: 'f', desc: 'ⓕ 끝나지 않는 수집(pending) 중',
    setup: async () => { __setMacroRegimeFetcherForTest(() => new Promise<BlsFetchResult>(() => {})); },
    check: (r) => { expect(r.label).toBe('unknown'); expect(r.reasonCodes).toEqual(['cpi_not_loaded']); expect(r.cpi.fetchStatus).toBe('not_attempted'); },
  },
];

interface Captured { observable: string; macroRegimeRows: unknown[]; runRowsWithKey: number }
/** 한 번 돌리고 관측 가능한 모든 것을 직렬화한다 — 최종 run 행의 detail.macroRegime 만 따로 떼어 낸다 */
async function runOnce(scene: Scene, mode: 'baseline' | 'real', setup: () => Promise<void>): Promise<Captured> {
  resetAll();
  regimeMode = mode;
  macroNow = scene.macro;
  orderMax = scene.orderMax;
  await setup();
  const result = await runAll({ market: 'domestic' });

  const macroRegimeRows: unknown[] = [];
  let runRowsWithKey = 0;
  const dbQueries = queries
    .filter((q) => !/^DELETE FROM eval_funnel/i.test(q.sql))
    .map((q) => {
      if (!/^INSERT INTO eval_funnel/i.test(q.sql)) return q;
      const params = q.params.slice();
      for (let i = 0; i + 9 < params.length; i += 10) {
        const detail = params[i + 9];
        if (typeof detail !== 'string') continue;
        const parsed = JSON.parse(detail) as Record<string, unknown>;
        if (!('macroRegime' in parsed)) continue;
        runRowsWithKey++;
        expect([params[i + 6], params[i + 7]]).toEqual(['run', 'pass']); // 이 키는 최종 pass run 행에만 있다
        macroRegimeRows.push(parsed.macroRegime);
        delete parsed.macroRegime;
        params[i + 9] = JSON.stringify(parsed);
      }
      return { sql: q.sql, params };
    });
  const observable = JSON.stringify({
    result,
    createSignal: createSignal.mock.calls,
    allocate: allocate.mock.calls,
    portfolioGuard: portfolioGuard.mock.calls,
    prefilter: prefilterCandidate.mock.calls,
    setCooldown: setCooldown.mock.calls,
    sendAlert: sendAlert.mock.calls,
    sendAlertThrottled: sendAlertThrottled.mock.calls,
    dbQueries,
  });
  return { observable, macroRegimeRows, runRowsWithKey };
}

describe.each(SCENES.map((s) => [s.name, s] as const))('장면: %s', (_name, scene) => {
  let baseline: Captured;
  beforeAll(async () => {
    jest.setSystemTime(SAFE_KST);
    const quiet = (['log', 'warn', 'error'] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
    try {
      baseline = await runOnce(scene, 'baseline', async () => {});
    } finally {
      quiet.forEach((q) => q.mockRestore());
    }
  });

  it('ⓔ 기준군은 변경 전 동작이다 — 기록 키 없음, 비교가 비어 있지 않다', () => {
    expect(baseline.runRowsWithKey).toBe(0);
    const obs = JSON.parse(baseline.observable);
    expect(obs.result.errors).toEqual([]);
    const funnel = obs.dbQueries.filter((q: { sql: string }) => /^INSERT INTO eval_funnel/i.test(q.sql));
    expect(funnel.length).toBeGreaterThan(0);
    const gates: string[] = funnel.flatMap((q: { params: unknown[] }) => q.params.filter((_: unknown, i: number) => i % 10 === 6));
    if (scene.gateBlocked) {
      // 빈 비교 금지 — 룰이 매수 후보를 냈고(게이트 skip 행은 매수 후보가 있을 때만 남는다) 게이트가 실제로 막았다
      expect(gates.filter((g) => g === 'regime_gate_macro_bear').length).toBe(SYMBOLS.length);
      expect(obs.createSignal).toHaveLength(0);
      expect(obs.sendAlert.some((c: unknown[]) => String(c[1]).includes('신규 매수 차단'))).toBe(true);
    } else {
      // 빈 비교 금지 — 실제 시그널이 1건 이상 생겼다(프리필터·포트폴리오 가드도 실제로 돌았다)
      expect(obs.createSignal.length).toBeGreaterThanOrEqual(1);
      expect(obs.prefilter.length).toBeGreaterThanOrEqual(1);
      expect(obs.portfolioGuard.length).toBeGreaterThanOrEqual(1);
      expect(gates).not.toContain('regime_gate_macro_bear');
      expect(obs.sendAlert.some((c: unknown[]) => String(c[1]).includes('신규 매수 차단'))).toBe(false);
    }
    if (scene.orderMax === 'unlimited') {
      expect(obs.allocate).toHaveLength(1);
      expect(obs.createSignal.map((c: Array<{ amountKRW: number }>) => c[0].amountKRW)).toEqual([155_000, 145_000]);
    }
  });

  it.each(VARIANTS.map((v) => [v.desc, v] as const))('%s — 기준군과 바이트 단위로 같다', async (_d, variant) => {
    const got = await runOnce(scene, 'real', variant.setup);
    expect(got.observable).toBe(baseline.observable);
    // 라벨은 최종 run 행 하나에만 기록됐다
    expect(got.runRowsWithKey).toBe(1);
    variant.check(got.macroRegimeRows[0] as MacroRegimeRecord);
    expect(regimeCalls).toEqual({ kick: 1, get: 1 });
  });
});

it('ⓕ 의 수집은 실제로 시작됐고 끝나지 않은 채였다 — 그래도 런은 기다리지 않았다', async () => {
  const pending = jest.fn(() => new Promise<BlsFetchResult>(() => {}));
  const res = await runOnce(SCENES[0], 'real', async () => { __setMacroRegimeFetcherForTest(pending); });
  expect(pending).toHaveBeenCalledTimes(1);
  expect(__macroRegimeInFlightForTest()).not.toBeNull();
  expect(res.runRowsWithKey).toBe(1);
});

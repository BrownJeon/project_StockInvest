/**
 * T-183 — 거시 하락 게이트(regime gate)가 **시장별로 독립** 판정한다.
 *
 * 배경: 종전 게이트는 "KOSPI 대용·S&P 대용 **모두** −1.5% 이하(AND)"였고, S&P 대용 `NYS:SPY` 가 KIS 에서 늘 빈 값이라
 * S&P 변화율이 null → AND 가 한 번도 성립하지 않았다(2026-11 급락일 발동 0건). 2026-11-20 사용자 결정 「시장별 독립」.
 * 고정하는 것:
 *  ① 국내 평가는 KOSPI 대용만 본다 — KOSPI 만 하락이면 국내 매수 차단, S&P 만 하락이면 국내 매수 허용
 *  ② 해외 평가는 S&P 대용만 본다 — 반대도 같다
 *  ③ 경계값 −1.5% 는 차단(≤), −1.49% 는 허용 — 임계값은 바꾸지 않았다
 *  ④ 그 시장 지수를 판정할 수 없으면 fail-open(매수 허용) + `regime_gate_macro_error` 기록(index·reason·failOpen)
 *     — 종전에는 예외만 기록하고 빈 값·null 은 무기록이었다. 다른 시장 지수의 판정 불가는 기록하지 않는다
 *  ⑤ 차단 알림은 시장별·현지 날짜별 1회 — 5분 틱마다 반복 발송하지 않는다. 단 **전달이 확인된 뒤에만** 억제한다
 *     (라운드 2, Codex C2 지적 2 — 전 채널 실패한 첫 알림이 하루 내내 묻히지 않게 다음 틱에 다시 보낸다)
 *  ⑥ 차단 시 기존 흐름 그대로 — 매수 후보는 `regime_gate_macro_bear` 로 걸러지고 시그널이 0건
 *  ⑦ (라운드 2) 실제 macro 모듈 경유 — 환산값의 부동소수 잡음이 정확히 −1.5% 인 날을 허용으로 뒤집지 않는다
 *
 * 모의 구조는 engine-universe-refresh-isolation-t176.test.ts · macro-regime/__tests__/engine-invariant.test.ts 와 같다.
 * 차단 알림은 **실제** `safety/confirmed-alert` 모듈을 쓰고, 그 아래 전송 함수만 시험 seam(`__setConfirmedAlertDispatchForTest`)으로
 * 바꿔 전달 결과(`delivered`)를 시험마다 정한다(⑤ 를 행동으로 보기 위해). 다른 경보용 `@/lib/notify` 는 종전처럼 모의.
 */
import type { Market } from '@/lib/exchanges/kis-symbols';
import type { MacroIndicators } from '@/lib/strategy/macro';

// ─── 모의 DB ─────────────────────────────────────────────────────────────────
const funnelRows: Array<{ symbol: string | null; stage: number; gate: string; verdict: string; reason: string | null; detail: unknown }> = [];
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
  if (/FROM strategies/i.test(s)) return [[{ id: RULE_ID, enabled: 1, backtest_interval_h: 6, next_backtest_at: null }], []];
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
    getMarket: (s: string) => (s.includes(':') ? 'overseas' : 'domestic'),
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
/** 게이트 외 경보(잔고 미확인 등)용 — 게이트 차단 알림은 여기로 오지 않는다(아래 dispatch 참고) */
const sendAlert = jest.fn();
jest.mock('@/lib/notify', () => ({ sendAlert: (...a: unknown[]) => sendAlert(...a) }));
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
const SYMBOLS: Record<Market, string[]> = { domestic: ['005930', '000660'], overseas: ['NAS:AAPL', 'NAS:MSFT'] };
jest.mock('@/lib/strategy/universe', () => ({
  refreshUniverse: async () => ({ refreshed: false }),
  getUniverseSymbols: async () => [] as string[],
  getAlwaysIncludeSymbols: async (market: Market) => SYMBOLS[market].slice(),
}));
/** 거시 지표 — 시험마다 바꾼다(형태는 실제 `MacroIndicators`) */
let macroNow: MacroIndicators = { kospiChangePct: 0, sp500ChangePct: 0, usdKrwChangePct: 0 };
let macroThrows = false;
/** ⑦ — true 면 실제 macro 모듈(그 아래 kis.getTicker 는 위 모의)로 계산한다 */
let useRealMacro = false;
const realMacro = () => jest.requireActual<typeof import('@/lib/strategy/macro')>('@/lib/strategy/macro');
jest.mock('@/lib/strategy/macro', () => ({
  fetchMacroIndicators: async () => {
    if (useRealMacro) return realMacro().fetchMacroIndicators();
    if (macroThrows) throw new Error('unexpected macro failure');
    return { ...macroNow };
  },
}));
/** 실제 macro 가 부르는 환율 — 게이트는 이 값을 쓰지 않는다(외부 호출 차단용) */
jest.mock('@/lib/exchanges/fx', () => ({ ...jest.requireActual('@/lib/exchanges/fx'), getUsdKrwRate: async () => 1332.1 }));
jest.mock('@/lib/safety/order-limits', () => ({ getEffectiveOrderMax: async () => 100_000 }));
jest.mock('@/lib/strategy/portfolio-stability', () => ({ checkPortfolioStability: async () => ({ verdict: 'pass' }) }));
jest.mock('@/lib/strategy/adaptive-buy-sizing', () => ({ allocateAdaptiveBuys: jest.fn() }));
jest.mock('@/lib/safety/validation-gate', () => ({
  evaluateValidationGate: async ({ strategyId }: { strategyId: string }) => ({ allowed: true, kind: 'validated', strategyId, status: 'backtested' }),
}));
jest.mock('@/lib/strategy/ai-prefilter', () => ({ prefilterCandidate: () => ({ verdict: 'pass' }) }));
jest.mock('@/lib/strategy/ai-filter', () => ({ buildMarketSummary: () => ({ rsi14: 30 }) }));
jest.mock('@/lib/strategy/market-state', () => ({ classifyMarketState: () => 'neutral' }));
const RULE_ID = 't183-fires';
jest.mock('@/lib/strategy/rules', () => ({
  STRATEGY_REGISTRY: {
    't183-fires': {
      interval: '1h',
      minCandles: 20,
      fn: ({ symbol, amountKRW }: { symbol: string; amountKRW: number }) =>
        [{ symbol, side: 'buy', amountKRW, price: 70_000, indicators: { t183: 1 }, reason: 't183' }],
    },
  },
}));
jest.mock('@/lib/strategy/sell-proposal-preview', () => ({ openSellProposalPreview: async () => null }));

import { runAll, resetHeldUnknownState } from '../engine';
import { resetAlertThrottle } from '@/lib/notify/throttle';
import { resetConfirmedAlerts, __setConfirmedAlertDispatchForTest } from '@/lib/safety/confirmed-alert';

/** ⑤ — 실제 confirmed-alert 의 전송 함수. 기본은 전달 성공(채널 1개), 시험마다 결과를 바꾼다 */
const DELIVERED_OK: { delivered: readonly unknown[] } = { delivered: ['telegram'] };
const dispatch = jest.fn(async (_level: string, _title: string, _body: string): Promise<{ delivered: readonly unknown[] }> => DELIVERED_OK);

// ─── 픽스처 ──────────────────────────────────────────────────────────────────
/** 2026-08-05(수) 10:00 KST — 장마감 전 손절 창 밖(T-148·T-176 과 같은 시각) */
const SAFE_KST = new Date('2026-08-05T01:00:00Z');
const PRICE = 70_000;
const CANDLES = Array.from({ length: 30 }, (_, i) => ({ ts: i * 3_600_000, open: PRICE, high: PRICE, low: PRICE, close: PRICE, volume: 1_000 }));

let warnLog: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  warnLog = jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  funnelRows.length = 0;
  macroNow = { kospiChangePct: 0, sp500ChangePct: 0, usdKrwChangePct: 0 };
  macroThrows = false;
  resetHeldUnknownState();
  resetAlertThrottle();
  resetConfirmedAlerts();
  dispatch.mockImplementation(async () => DELIVERED_OK);
  __setConfirmedAlertDispatchForTest(dispatch);
  createSignal.mockImplementation(async () => ({ ok: true, signalId: 1, autoSubmitted: false }));
  getTicker.mockImplementation(async (s: string) => ({ price: PRICE, open24h: PRICE, timestamp: 0, symbol: s }));
  getCandles.mockResolvedValue(CANDLES);
  getBalancesDetailed.mockResolvedValue({
    balances: [{ currency: 'KRW', free: 500_000, locked: 0 }],
    ok: ['domestic', 'overseas'] as Market[], failed: [] as Array<{ market: Market; error: string }>, complete: true,
  });
  jest.setSystemTime(SAFE_KST);
});
afterEach(() => { jest.restoreAllMocks(); });
beforeAll(() => { jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'performance', 'hrtime'] }); });
afterAll(() => { jest.useRealTimers(); __setConfirmedAlertDispatchForTest(); });

const rows = (gate: string) => funnelRows.filter((r) => r.gate === gate);
/** 게이트 차단 알림 전송 시도(전달 성공·실패 무관) — dispatch(level, title, body) */
const gateAlerts = () => dispatch.mock.calls.filter((c) => String(c[1]).includes('신규 매수 차단'));
/** 공용 스로틀 경로로는 게이트 알림이 나가지 않는다(교체 확인용) */
const gateAlertsViaThrottle = () => sendAlert.mock.calls.filter((c) => String(c[1]).includes('신규 매수 차단'));
/** 전송 결과 콜백(.then)이 반영되도록 대기 — setImmediate 는 가짜 타이머 대상이 아니다 */
const settle = () => new Promise<void>((r) => setImmediate(r));

/** 한 회차의 게이트 결과 요약 */
async function runOnce(market: Market) {
  await runAll({ market });
  await settle();
  return {
    blockedRows: rows('regime_gate_macro_bear').filter((r) => r.symbol != null),
    errorRows: rows('regime_gate_macro_error'),
    signals: createSignal.mock.calls.length,
  };
}

describe('① 국내 평가 — KOSPI 대용만 본다', () => {
  test('🔴 KOSPI 만 −1.5% 이하 → 국내 신규 매수 차단(매수 후보 전부 regime_gate_macro_bear, 시그널 0)', async () => {
    macroNow = { kospiChangePct: -5.48, sp500ChangePct: 0.3, usdKrwChangePct: 0 };
    const r = await runOnce('domestic');
    expect(r.blockedRows.map((x) => x.symbol).sort()).toEqual([...SYMBOLS.domestic].sort());
    expect(r.signals).toBe(0);
    expect(r.errorRows).toHaveLength(0);
    expect(gateAlerts()).toHaveLength(1);
    const [level, title, body] = gateAlerts()[0];
    expect(level).toBe('warning');
    expect(title).toBe('거시 지수 하락 — 국내 신규 매수 차단');
    expect(body).toContain('KOSPI(KODEX 200): -5.48% (전일 종가 대비)');
    expect(body).not.toContain('S&P');   // 이 시장 지수만 표기
  });

  test('🔴 S&P 만 하락(KOSPI 정상) → 국내 매수 허용 — 종전 AND 와 달리 다른 시장 지수는 보지 않는다', async () => {
    macroNow = { kospiChangePct: 0.2, sp500ChangePct: -4.4, usdKrwChangePct: 0 };
    const r = await runOnce('domestic');
    expect(r.blockedRows).toHaveLength(0);
    expect(r.signals).toBeGreaterThanOrEqual(1);
    expect(gateAlerts()).toHaveLength(0);
  });

  test('🔴 둘 다 하락이면 차단 — 종전에는 S&P 가 늘 null 이라 이 경우조차 막지 못했다', async () => {
    macroNow = { kospiChangePct: -2, sp500ChangePct: -2, usdKrwChangePct: 0 };
    const r = await runOnce('domestic');
    expect(r.blockedRows).toHaveLength(SYMBOLS.domestic.length);
    expect(r.signals).toBe(0);
  });
});

describe('② 해외 평가 — S&P 대용만 본다', () => {
  test('🔴 S&P 만 −1.5% 이하 → 해외 신규 매수 차단', async () => {
    macroNow = { kospiChangePct: 0.5, sp500ChangePct: -4.4, usdKrwChangePct: 0 };
    const r = await runOnce('overseas');
    expect(r.blockedRows.map((x) => x.symbol).sort()).toEqual([...SYMBOLS.overseas].sort());
    expect(r.signals).toBe(0);
    expect(gateAlerts()).toHaveLength(1);
    const [, title, body] = gateAlerts()[0];
    expect(title).toBe('거시 지수 하락 — 해외 신규 매수 차단');
    expect(body).toContain('S&P500(SPY): -4.40% (전일 종가 대비)');
    expect(body).not.toContain('KOSPI');
  });

  test('🔴 KOSPI 만 하락(S&P 정상) → 해외 매수 허용', async () => {
    macroNow = { kospiChangePct: -6.02, sp500ChangePct: 0.1, usdKrwChangePct: 0 };
    const r = await runOnce('overseas');
    expect(r.blockedRows).toHaveLength(0);
    expect(r.signals).toBeGreaterThanOrEqual(1);
    expect(gateAlerts()).toHaveLength(0);
  });
});

describe('③ 임계값 −1.5% 그대로', () => {
  test.each([
    ['domestic', -1.5, true], ['domestic', -1.49, false],
    ['overseas', -1.5, true], ['overseas', -1.49, false],
  ] as const)('%s %s%% → 차단=%s', async (market, pct, blocked) => {
    macroNow = market === 'domestic'
      ? { kospiChangePct: pct, sp500ChangePct: 0, usdKrwChangePct: 0 }
      : { kospiChangePct: 0, sp500ChangePct: pct, usdKrwChangePct: 0 };
    const r = await runOnce(market);
    expect(r.blockedRows.length > 0).toBe(blocked);
    expect(r.signals === 0).toBe(blocked);
  });
});

describe('④ 판정 불가 — fail-open + 사유 기록', () => {
  test('🔴 국내: KOSPI null(사유 있음) → 매수 허용 + regime_gate_macro_error{index:kospi, reason, failOpen}', async () => {
    macroNow = { kospiChangePct: null, sp500ChangePct: -3, usdKrwChangePct: 0, kospiError: 'prev_close_unavailable' };
    const r = await runOnce('domestic');
    expect(r.blockedRows).toHaveLength(0);
    expect(r.signals).toBeGreaterThanOrEqual(1);
    expect(r.errorRows).toHaveLength(1);
    expect(r.errorRows[0]).toMatchObject({ symbol: null, stage: 6, verdict: 'error' });
    expect(r.errorRows[0].detail).toEqual({ index: 'kospi', reason: 'prev_close_unavailable', failOpen: true });
    expect(warnLog.mock.calls.some((c) => String(c[0]).includes('[regime-gate:domestic] KOSPI(KODEX 200) 판정 불가'))).toBe(true);
    expect(gateAlerts()).toHaveLength(0);
  });

  test('🔴 해외: S&P null → 매수 허용 + error{index:sp500}', async () => {
    macroNow = { kospiChangePct: -3, sp500ChangePct: null, usdKrwChangePct: 0, sp500Error: 'ticker_error: KIS overseas getTicker AMS:SPY: 500' };
    const r = await runOnce('overseas');
    expect(r.blockedRows).toHaveLength(0);
    expect(r.signals).toBeGreaterThanOrEqual(1);
    expect(r.errorRows).toHaveLength(1);
    expect(r.errorRows[0].detail).toEqual({ index: 'sp500', reason: 'ticker_error: KIS overseas getTicker AMS:SPY: 500', failOpen: true });
  });

  test('사유 필드가 없는 null 도 무기록으로 넘기지 않는다(reason=unavailable)', async () => {
    macroNow = { kospiChangePct: null, sp500ChangePct: 0, usdKrwChangePct: 0 };
    const r = await runOnce('domestic');
    expect(r.errorRows).toHaveLength(1);
    expect(r.errorRows[0].detail).toEqual({ index: 'kospi', reason: 'unavailable', failOpen: true });
  });

  test('다른 시장 지수의 판정 불가는 이 시장 회차에 기록하지 않는다', async () => {
    macroNow = { kospiChangePct: 0.1, sp500ChangePct: null, usdKrwChangePct: 0, sp500Error: 'price_unavailable' };
    const r = await runOnce('domestic');
    expect(r.errorRows).toHaveLength(0);
    expect(r.signals).toBeGreaterThanOrEqual(1);
  });

  test('fetchMacroIndicators 자체가 던져도(예상 밖 결함) fail-open + 같은 형태로 기록', async () => {
    macroThrows = true;
    const r = await runOnce('overseas');
    expect(r.blockedRows).toHaveLength(0);
    expect(r.signals).toBeGreaterThanOrEqual(1);
    expect(r.errorRows).toHaveLength(1);
    expect(r.errorRows[0].detail).toEqual({ index: 'sp500', reason: 'unexpected macro failure', failOpen: true });
  });
});

describe('⑤ 차단 알림 — 시장별·현지 날짜별 1회, 전달이 확인된 뒤에만 억제', () => {
  test('🔴 전달 성공 → 같은 날 5분 틱이 4번 돌아도 알림은 1회 — 차단 자체는 매 틱 유지', async () => {
    macroNow = { kospiChangePct: -3, sp500ChangePct: 0, usdKrwChangePct: 0 };
    for (let i = 0; i < 4; i++) {
      jest.setSystemTime(new Date(SAFE_KST.getTime() + i * 5 * 60 * 1000));
      funnelRows.length = 0;
      createSignal.mockClear();
      const r = await runOnce('domestic');
      expect(r.blockedRows).toHaveLength(SYMBOLS.domestic.length);
      expect(r.signals).toBe(0);
    }
    expect(gateAlerts()).toHaveLength(1);
    const [level, title] = gateAlerts()[0];
    expect(level).toBe('warning');
    expect(title).toBe('거시 지수 하락 — 국내 신규 매수 차단');
    expect(gateAlertsViaThrottle()).toHaveLength(0);   // 공용 스로틀(선기록) 경로는 쓰지 않는다
  });

  test('🔴 첫 틱 전 채널 전달 실패(delivered: []) → 다음 틱에 다시 보내고, 성공한 뒤에는 억제한다', async () => {
    macroNow = { kospiChangePct: 0, sp500ChangePct: -3, usdKrwChangePct: 0 };
    dispatch.mockImplementationOnce(async () => ({ delivered: [] }));
    const T = new Date('2026-08-05T14:00:00Z').getTime();   // 8/5 10:00 EDT
    const counts: number[] = [];
    for (let i = 0; i < 4; i++) {
      jest.setSystemTime(new Date(T + i * 5 * 60 * 1000));
      funnelRows.length = 0;
      createSignal.mockClear();
      const r = await runOnce('overseas');
      // 알림 실패와 무관하게 차단은 매 틱 그대로
      expect(r.blockedRows).toHaveLength(SYMBOLS.overseas.length);
      expect(r.signals).toBe(0);
      counts.push(gateAlerts().length);
    }
    // 1틱: 시도(실패) · 2틱: 재전송(성공) · 3·4틱: 억제
    expect(counts).toEqual([1, 2, 2, 2]);
  });

  test('전송 함수가 예외로 끝나도(거부된 promise) 억제하지 않고 다음 틱에 다시 보낸다', async () => {
    macroNow = { kospiChangePct: -3, sp500ChangePct: 0, usdKrwChangePct: 0 };
    dispatch.mockImplementationOnce(async () => { throw new Error('telegram down'); });
    await runOnce('domestic');
    jest.setSystemTime(new Date(SAFE_KST.getTime() + 5 * 60 * 1000));
    await runOnce('domestic');
    jest.setSystemTime(new Date(SAFE_KST.getTime() + 10 * 60 * 1000));
    await runOnce('domestic');
    expect(gateAlerts()).toHaveLength(2);
  });

  test('알림 전송이 끝나지 않아도(pending) 차단은 그 틱에 적용되고 회차는 기다리지 않고 끝난다 — 진행 중이면 겹쳐 보내지 않는다', async () => {
    macroNow = { kospiChangePct: -3, sp500ChangePct: 0, usdKrwChangePct: 0 };
    dispatch.mockImplementation(() => new Promise(() => {}));
    const r1 = await runOnce('domestic');
    expect(r1.blockedRows).toHaveLength(SYMBOLS.domestic.length);
    expect(r1.signals).toBe(0);
    jest.setSystemTime(new Date(SAFE_KST.getTime() + 5 * 60 * 1000));
    funnelRows.length = 0;
    const r2 = await runOnce('domestic');
    expect(r2.blockedRows).toHaveLength(SYMBOLS.domestic.length);
    expect(gateAlerts()).toHaveLength(1);
  });

  test('시장이 다르면 따로 알린다', async () => {
    macroNow = { kospiChangePct: -3, sp500ChangePct: -3, usdKrwChangePct: 0 };
    await runOnce('domestic');
    await runOnce('overseas');
    await runOnce('domestic');
    expect(gateAlerts().map((c) => c[1])).toEqual(['거시 지수 하락 — 국내 신규 매수 차단', '거시 지수 하락 — 해외 신규 매수 차단']);
  });

  test('국내는 KST 날짜가 바뀌면 다시 알린다(24시간 미만 간격이어도) — 같은 날은 억제', async () => {
    macroNow = { kospiChangePct: -3, sp500ChangePct: 0, usdKrwChangePct: 0 };
    jest.setSystemTime(new Date('2026-08-05T05:00:00Z'));   // 8/5 14:00 KST
    await runOnce('domestic');
    jest.setSystemTime(new Date('2026-08-05T06:00:00Z'));   // 8/5 15:00 KST — 같은 날, 억제
    await runOnce('domestic');
    expect(gateAlerts()).toHaveLength(1);
    jest.setSystemTime(new Date('2026-08-06T00:30:00Z'));   // 8/6 09:30 KST — 19.5시간 뒤
    await runOnce('domestic');
    expect(gateAlerts()).toHaveLength(2);
  });

  test('해외는 미국 세션이 KST 자정을 넘어도 같은 ET 날짜면 1회, 다음 ET 날짜에는 다시 알린다', async () => {
    macroNow = { kospiChangePct: 0, sp500ChangePct: -3, usdKrwChangePct: 0 };
    jest.setSystemTime(new Date('2026-08-05T14:00:00Z'));   // 8/5 23:00 KST = 8/5 10:00 EDT
    await runOnce('overseas');
    jest.setSystemTime(new Date('2026-08-05T18:00:00Z'));   // 8/6 03:00 KST = 8/5 14:00 EDT
    await runOnce('overseas');
    expect(gateAlerts()).toHaveLength(1);
    jest.setSystemTime(new Date('2026-08-06T14:00:00Z'));   // 8/6 10:00 EDT — 다음 ET 날짜
    await runOnce('overseas');
    expect(gateAlerts()).toHaveLength(2);
  });
});

/**
 * 라운드 2 (Codex C2 지적 1) — 실제 macro 모듈로 「KIS 응답 → KRW 환산 → 변화율 → 게이트」를 한 번에 잇는다.
 * 해외 last=689.50·base=700.00·환율 1332.1(정확히 −1.5%)은 반올림 전에는 −1.4999999999999927 로 계산돼 게이트를 빠져나갔다.
 */
describe('⑦ 실제 macro 모듈 경유 — 경계 −1.5% 가 해외 매수를 차단한다', () => {
  const FX = 1332.1;
  beforeEach(() => {
    useRealMacro = true;
    realMacro().clearMacroCache();
    getTicker.mockImplementation(async (s: string) => {
      // 어댑터(kis-overseas.ts getTicker)와 같은 환산: price = Number(last)*fx, prevClose = Number(base)*fx
      if (s === 'AMS:SPY') return { symbol: s, price: Number('689.50') * FX, priceUsd: 689.5, prevClose: Number('700.00') * FX, timestamp: 0 };
      if (s === '069500') return { symbol: s, price: 80630, prevClose: 80630, timestamp: 0 };
      return { price: PRICE, open24h: PRICE, timestamp: 0, symbol: s };
    });
  });
  afterEach(() => { useRealMacro = false; realMacro().clearMacroCache(); });

  test('🔴 sp500ChangePct === −1.5 → 해외 신규 매수 차단 + 차단 알림', async () => {
    const m = await realMacro().fetchMacroIndicators();
    expect(m.sp500ChangePct).toBe(-1.5);
    realMacro().clearMacroCache();
    const r = await runOnce('overseas');
    expect(r.blockedRows.map((x) => x.symbol).sort()).toEqual([...SYMBOLS.overseas].sort());
    expect(r.signals).toBe(0);
    expect(r.errorRows).toHaveLength(0);
    expect(gateAlerts()).toHaveLength(1);
    expect(String(gateAlerts()[0][2])).toContain('S&P500(SPY): -1.50% (전일 종가 대비)');
  });
});

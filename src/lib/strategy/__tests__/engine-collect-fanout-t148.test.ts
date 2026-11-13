/**
 * T-148 — 수집 루프(`② 룰 발화 + ③ 억제`)를 동시성 4 팬아웃으로 바꾼 계약을 고정한다.
 *
 * ## 왜 이 파일이 필요한가
 *
 * 변경 전 수집은 완전 직렬이었다. 2026-11-03 국내 장중 평가 버스트 50회 실측(회차당 median 279
 * 호출): 벽시계 **median 136초 · max 257초 · 100초 초과 38/50**, 그중 약 4할이 in-flight 84% 이상
 * (= 한 번에 하나만 떠 있는 직렬 포화)이었다. 그 사이 분당 잡 — 그중 **실주문 집행
 * `entry-watcher`** — 이 평균 95초·최장 412초 간격으로 벌어졌다.
 * (KIS 가 빨랐던 7회차는 같은 직렬 코드로도 52~56초에 끝났다 — 그것이 레이트 상한 5/s 가 정하는
 *  바닥이고, 이 변경의 목표는 모든 회차를 거기로 모으는 것이다.)
 * 팬아웃은 그걸 고치지만 세 가지를 깨뜨릴 수 있다.
 *
 *  (a) **종목 누락·중복·순서 변화** → 시그널 생성 입력이 달라진다. 완료 기준 ①.
 *  (b) **대기열 독점** → 같은 `normal` lane 을 쓰는 손절 알림 티커(T-147)가 줄 끝에서 굶는다.
 *      T-147 설계는 "루프가 직렬이라 큐 깊이가 1을 넘지 않는다"에 의존했고 이 변경이 그 전제를
 *      깬다. `mapWithLimit` 이 아니라 `allSettled(symbols.map(...))` 였다면 깊이가 회차당 호출 수
 *      (실측 median 279)만큼 돼 티커가 279/5 ≈ 56초를 기다린다.
 *  (c) **실패 삼킴** → `mapWithLimit` 은 거부를 `{status:'rejected'}` 로 **돌려준다**. 직렬
 *      루프였을 때 런 전체를 중단시켰던 예외가, 무시하면 아무 기록 없이 사라진다.
 *      T-146 H-1(무제한 팬아웃 + 실패 미집계)의 반대쪽 재발이다.
 *
 * 이 세 가지를 각각 고정한다. `mapWithLimit` 자체의 동시성 상한·순서 보장은
 * `src/lib/exchanges/__tests__/kis-throttle.test.ts` 가 이미 고정하므로 여기서는 **엔진이 그것을
 * 올바르게 소비하는지**만 본다.
 */
import type { Market } from '@/lib/exchanges/kis-symbols';

// ─── 모의 DB ─────────────────────────────────────────────────────────────────
const funnelRows: Array<{ symbol: string | null; stage: number; gate: string; verdict: string; detail: unknown }> = [];
async function poolQuery(sql: unknown, params?: unknown) {
  const s = String(sql);
  const p = (params as unknown[] | undefined) ?? [];
  if (/INSERT INTO eval_funnel/i.test(s)) {
    for (let i = 0; i + 9 < p.length; i += 10) {
      funnelRows.push({
        symbol: p[i + 2] as string | null, stage: Number(p[i + 5]), gate: String(p[i + 6]),
        verdict: String(p[i + 7]), detail: p[i + 9] == null ? null : JSON.parse(String(p[i + 9])),
      });
    }
    return [{ affectedRows: 1 }, []];
  }
  if (/FROM strategies/i.test(s)) {
    return [[{ id: RULE_ID, enabled: 1, backtest_interval_h: 6, next_backtest_at: null }], []];
  }
  if (/FROM system_config/i.test(s)) return [[], []];
  return [[], []];
}
jest.mock('@/lib/db', () => ({
  getPool: () => ({
    query: (...a: unknown[]) => poolQuery(a[0], a[1]),
    getConnection: async () => ({ query: (...a: unknown[]) => poolQuery(a[0], a[1]), release: () => {}, destroy: () => {} }),
  }),
}));

// ─── 외부 I/O ────────────────────────────────────────────────────────────────
/**
 * KIS 호출의 **동시 실행 수**를 센다 — (b) 를 재는 계기.
 * `getTicker`·`getCandles` 둘 다 같은 카운터를 쓴다(둘 다 같은 `normal` lane 토큰을 먹는다).
 */
const inflight = { now: 0, peak: 0 };
function track<T>(fn: () => Promise<T>): Promise<T> {
  inflight.now++;
  inflight.peak = Math.max(inflight.peak, inflight.now);
  return fn().finally(() => { inflight.now--; });
}
/** 완료 순서를 **입력 순서와 다르게** 뒤섞는다 — 순서 보장이 우연이 아님을 보이기 위해. */
const delayFor = new Map<string, number>();
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
jest.mock('@/lib/notify', () => ({ sendAlert: jest.fn() }));
const sendAlertThrottled = jest.fn();
jest.mock('@/lib/notify/throttle', () => ({ sendAlertThrottled: (...a: unknown[]) => sendAlertThrottled(...a), resetAlertThrottle: () => {} }));
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
/**
 * 평가 대상 심볼. `getEvalSymbols` 는 universe 3종 + alwaysInclude + 보유를 Set 삽입 순서로
 * 모으므로, universe 를 비우고 alwaysInclude 만 채우면 **입력 순서를 결정적으로 통제**할 수 있다.
 */
const evalSymbols: string[] = [];
jest.mock('@/lib/strategy/universe', () => ({
  refreshUniverse: async () => ({ refreshed: false }),
  getUniverseSymbols: async () => [] as string[],
  getAlwaysIncludeSymbols: async () => evalSymbols.slice(),
}));
jest.mock('@/lib/strategy/macro', () => ({ fetchMacroIndicators: async () => ({ kospiChangePct: 0, sp500ChangePct: 0 }) }));
let orderMax: number | 'unlimited' = 100_000;
jest.mock('@/lib/safety/order-limits', () => ({ getEffectiveOrderMax: async () => orderMax }));
const portfolioGuard = jest.fn(async (_input: unknown) => ({ verdict: 'pass' }));
jest.mock('@/lib/strategy/portfolio-stability', () => ({ checkPortfolioStability: (input: unknown) => portfolioGuard(input) }));
const allocate = jest.fn();
jest.mock('@/lib/strategy/adaptive-buy-sizing', () => ({ allocateAdaptiveBuys: (...args: unknown[]) => allocate(...args) }));
// T-168 — 무제한(적응 배분) 모드의 ④ 는 배분 앞에서 전략 검증 상태를 읽어 미검증 후보를 감사 경로로 뗀다.
// 이 파일의 무제한 시험은 「검증된 후보의 배분 경로」(T-159)를 보므로 전략을 검증됨으로 둔다(미검증 경로는 engine-adaptive-validation-audit-t168.test.ts).
jest.mock('@/lib/safety/validation-gate', () => ({
  evaluateValidationGate: async ({ strategyId }: { strategyId: string }) => ({ allowed: true, kind: 'validated', strategyId, status: 'backtested' }),
}));
/**
 * ④ 의 **첫 per-candidate 단계**. `applyFilters` 가 `contexts` 순서로 호출하므로, 이 호출 순서가
 * 곧 집행 순서다 — reviewer M-2 가 지적한 "순서에 실제로 민감한 소비처"의 계기로 쓴다.
 */
const prefilterCandidate = jest.fn();
jest.mock('@/lib/strategy/ai-prefilter', () => ({ prefilterCandidate: (...a: unknown[]) => prefilterCandidate(...a) }));
/** 지표 계산 — (c) 의 "잡히지 않은 예외" 주입 지점. `collectCandidates` 는 이걸 try 로 감싸지 않는다. */
const buildMarketSummary = jest.fn();
jest.mock('@/lib/strategy/ai-filter', () => ({ buildMarketSummary: (...a: unknown[]) => buildMarketSummary(...a) }));
jest.mock('@/lib/strategy/market-state', () => ({ classifyMarketState: () => 'neutral' }));
/**
 * 활성 전략이 0건이면 `runMarket` 이 `no_active_strategies` 로 **수집 전에 반환**한다.
 * 그래서 발화하지 않는 룰 1종만 등록해 수집 루프까지 흐르게 한다 — 이 파일이 보는 것은
 * 팬아웃의 구조(순서·동시성·실패 격리)이고 룰 발화 자체가 아니다.
 */
const RULE_ID = 't148-noop';
/** 모든 종목에서 buy 후보 1건을 내는 룰 — 기본은 미발화(`ruleFires=false`)다. */
let ruleFires = false;
jest.mock('@/lib/strategy/rules', () => ({
  STRATEGY_REGISTRY: {
    't148-noop': {
      interval: '1h',
      minCandles: 20,
      fn: ({ symbol, amountKRW }: { symbol: string; amountKRW: number }) =>
        (ruleFires ? [{ symbol, side: 'buy', amountKRW, price: 70_000, indicators: {}, reason: 't148' }] : []),
    },
  },
}));
jest.mock('@/lib/strategy/sell-proposal-preview', () => ({ openSellProposalPreview: async () => null }));

import { runAll, resetHeldUnknownState } from '../engine';
import { DEFAULT_FANOUT_CONCURRENCY } from '@/lib/exchanges/kis-throttle';
import { FUNNEL_GATES, GATE_LABEL_KO, GATE_STAGE } from '../eval-funnel-labels';

// ─── 픽스처 ──────────────────────────────────────────────────────────────────
/** 2026-08-05(수) 10:00 KST — 장마감 전 손절 창 밖 */
const SAFE_KST = new Date('2026-08-05T01:00:00Z');
/** 국내 12종목 — 동시성 4보다 충분히 많아 워커가 여러 번 돌아야 한다 */
const SYMBOLS = ['005930', '000660', '035720', '005380', '051910', '006400', '035420', '068270', '105560', '055550', '012330', '028260'];
const PRICE = 70_000;
/** `summaryCandles.length >= 20` 을 만족시켜야 `buildMarketSummary` 가 호출된다 */
const CANDLES = Array.from({ length: 30 }, (_, i) => ({ ts: i * 3_600_000, open: PRICE, high: PRICE, low: PRICE, close: PRICE, volume: 1_000 }));

function balances() {
  return {
    balances: [{ currency: 'KRW', free: 500_000, locked: 0 }],
    ok: ['domestic', 'overseas'] as Market[], failed: [] as Array<{ market: Market; error: string }>, complete: true,
  };
}
const wait = (ms: number) => new Promise<void>((r) => { setTimeout(r, ms); });

function resetAll() {
  jest.clearAllMocks();
  funnelRows.length = 0;
  inflight.now = 0; inflight.peak = 0;
  delayFor.clear();
  evalSymbols.length = 0; evalSymbols.push(...SYMBOLS);
  ruleFires = false;
  orderMax = 100_000;
  prefilterCandidate.mockReturnValue({ verdict: 'pass' });
  resetHeldUnknownState();
  createSignal.mockResolvedValue({ ok: true, signalId: 777, autoSubmitted: true });
  buildMarketSummary.mockImplementation(() => ({ rsi14: 30 }));
  getTicker.mockImplementation((s: string) => track(async () => {
    await wait(delayFor.get(s) ?? 1);
    return { price: PRICE, open24h: PRICE, timestamp: 0, symbol: s };
  }));
  getCandles.mockImplementation(() => track(async () => { await wait(1); return CANDLES; }));
  getBalancesDetailed.mockResolvedValue(balances());
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  resetAll();
  jest.setSystemTime(SAFE_KST);
});
afterEach(() => { jest.restoreAllMocks(); });
beforeAll(() => { jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'performance', 'hrtime'] }); });
afterAll(() => { jest.useRealTimers(); });

/** 수집 단계가 남기는 종목별 1행 */
const collectRows = () => funnelRows.filter((r) => r.gate === 'collect');

test('명시적 무제한의 장중 매수는 배정된 금액으로 포트폴리오 검사를 거쳐 한 후보만 발행한다', async () => {
  orderMax = 'unlimited';
  ruleFires = true;
  allocate.mockImplementation((_market, [first]) => ({
    orders: new Map([[first, { ...first, amountKRW: 155_000, quantity: 2 }]]), reason: 'allocated',
  }));
  const result = await runAll({ market: 'domestic' });
  expect(result.errors).toEqual([]);
  expect(allocate).toHaveBeenCalledTimes(1);
  expect(allocate.mock.calls[0][1]).toHaveLength(SYMBOLS.length);
  expect(portfolioGuard).toHaveBeenCalledTimes(1);
  expect(portfolioGuard.mock.calls[0][0]).toMatchObject({ amountKRW: 155_000, symbol: SYMBOLS[0] });
  expect(createSignal).toHaveBeenCalledTimes(1);
  expect(createSignal.mock.calls[0][0]).toMatchObject({ amountKRW: 155_000, quantity: 2, symbol: SYMBOLS[0] });
  expect(funnelRows.filter(row => row.gate === 'adaptive_buy_sizing' && row.verdict === 'skip')).toHaveLength(SYMBOLS.length - 1);
});

// ─── (a) 종목 누락·중복·순서 ─────────────────────────────────────────────────
describe('(a) 팬아웃이 종목을 누락·중복시키지 않고 순서를 유지한다', () => {
  it('완료 순서를 역순으로 뒤섞어도 모든 종목이 정확히 1번 수집된다', async () => {
    // 첫 종목이 가장 느리게 끝나도록 — 완료 순서 ≠ 입력 순서
    SYMBOLS.forEach((s, i) => delayFor.set(s, (SYMBOLS.length - i) * 4));

    const res = await runAll({ market: 'domestic' });

    expect(res.errors).toEqual([]);
    const seen = collectRows().map((r) => r.symbol);
    // 누락 없음 · 중복 없음
    expect(seen.slice().sort()).toEqual(SYMBOLS.slice().sort());
    expect(new Set(seen).size).toBe(SYMBOLS.length);
    // 종목당 ticker 1회
    expect(getTicker.mock.calls.map((c) => c[0]).sort()).toEqual(SYMBOLS.slice().sort());
  });

  it('결과 배열(results)은 완료 순서가 아니라 입력 심볼 순서다', async () => {
    SYMBOLS.forEach((s, i) => delayFor.set(s, (SYMBOLS.length - i) * 4));
    const res = await runAll({ market: 'domestic' });
    expect(res.results.map((r) => r.symbol)).toEqual(SYMBOLS);
  });

  /**
   * 🔴 reviewer M-2 — 위 두 시험은 `res.results` 를 보는데 그 배열은 `runMarket` 끝에서
   * `symbols` 순서로 **다시 만들어지므로**(engine.ts) 반영 루프를 역순으로 바꿔도 통과한다.
   * 순서에 실제로 민감한 소비처는 `contexts` → ④ 의 집행 순서다: 한도·현금이 빠듯할 때
   * **어느 종목이 먼저 몫을 가져가는지**를 그 순서가 정한다. 그래서 발화하는 룰을 켜서
   * ④ 를 실제로 돌리고 집행 순서를 직접 단언한다.
   */
  it('🔴 ④ 집행 순서가 심볼 순서다 — 완료 순서 역순에서도 (반영 루프 역순 회귀 방지)', async () => {
    ruleFires = true;
    SYMBOLS.forEach((s, i) => delayFor.set(s, (SYMBOLS.length - i) * 4));

    await runAll({ market: 'domestic' });

    const order = prefilterCandidate.mock.calls.map((c) => (c[0] as { symbol: string }).symbol);
    expect(order).toEqual(SYMBOLS);   // ④ 가 전 종목을 심볼 순서로 집행했다
  });

  it('지연을 똑같이 둔 직렬에 가까운 조건에서도 같은 결과가 나온다 (동시성이 관찰값을 바꾸지 않는다)', async () => {
    const scrambled = await runAll({ market: 'domestic' }).then((r) => r.results.map((x) => x.symbol));
    resetAll();
    SYMBOLS.forEach((s, i) => delayFor.set(s, (SYMBOLS.length - i) * 4));
    const reordered = await runAll({ market: 'domestic' }).then((r) => r.results.map((x) => x.symbol));
    expect(reordered).toEqual(scrambled);
  });
});

// ─── (b) 대기열 독점 — 손절 알림 티커가 굶지 않는다 ──────────────────────────
describe('(b) 대기열을 독점하지 않는다 — 손절 알림 티커(T-147)가 줄 끝에서 굶지 않게', () => {
  it(`KIS 동시 호출 수가 DEFAULT_FANOUT_CONCURRENCY(${DEFAULT_FANOUT_CONCURRENCY})를 넘지 않는다`, async () => {
    SYMBOLS.forEach((s) => delayFor.set(s, 6));
    await runAll({ market: 'domestic' });
    expect(inflight.peak).toBeGreaterThan(1);                             // 실제로 병렬이 됐다
    expect(inflight.peak).toBeLessThanOrEqual(DEFAULT_FANOUT_CONCURRENCY); // 그러나 상한 안이다
  });

  it('🔴 종목 수를 늘려도 동시 호출 수는 늘지 않는다 (allSettled 회귀 방지 — 종목 수에 비례하면 큐 깊이가 터진다)', async () => {
    evalSymbols.length = 0;
    evalSymbols.push(...Array.from({ length: 60 }, (_, i) => String(100_000 + i)));
    evalSymbols.forEach((s) => delayFor.set(s, 6));
    await runAll({ market: 'domestic' });
    expect(inflight.peak).toBeGreaterThan(1);
    expect(inflight.peak).toBeLessThanOrEqual(DEFAULT_FANOUT_CONCURRENCY);
  });
});

// ─── (c) 실패 삼킴 ───────────────────────────────────────────────────────────
describe('(c) 수집이 던진 예외를 삼키지 않는다', () => {
  const BAD = SYMBOLS[3];
  /** `buildMarketSummary` 는 `collectCandidates` 안에서 try 로 감싸여 있지 않다 → 예외가 팬아웃까지 올라간다 */
  function throwFor(bad: string, thrown: unknown) {
    buildMarketSummary.mockImplementation((_c: unknown, t: { symbol?: string }) => {
      if (t?.symbol === bad) throw thrown;
      return { rsi14: 30 };
    });
  }

  it.each([
    ['Error', new Error('indicator blew up')],
    ['문자열', 'string failure'],
    ['undefined', undefined],
  ])('던진 값이 %s 여도 그 종목만 실패로 격리되고 나머지는 평가된다', async (_label, thrown) => {
    throwFor(BAD, thrown);
    const res = await runAll({ market: 'domestic' });

    // 나머지 종목은 전부 수집됐다
    expect(collectRows().map((r) => r.symbol).sort()).toEqual(SYMBOLS.filter((s) => s !== BAD).sort());
    // 실패 종목은 결과에 error 로 남는다
    const bad = res.results.find((r) => r.symbol === BAD);
    expect(bad?.error).toMatch(/^collect_threw:/);
    expect(bad?.signalsCreated).toBe(0);
    // 순서는 그대로다 (실패가 배열을 밀지 않는다)
    expect(res.results.map((r) => r.symbol)).toEqual(SYMBOLS);
  });

  it('funnel 에 collect_threw(error, stage 1) 1행을 남긴다 — ticker_error 로 위장하지 않는다', async () => {
    throwFor(BAD, new Error('indicator blew up'));
    await runAll({ market: 'domestic' });

    const rows = funnelRows.filter((r) => r.gate === 'collect_threw');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ symbol: BAD, verdict: 'error', stage: 1 });
    expect((rows[0].detail as { error: string }).error).toContain('indicator blew up');
    // 같은 사건이 ticker_error 로도 찍히면 진짜 시세 실패가 묻힌다
    expect(funnelRows.filter((r) => r.gate === 'ticker_error')).toHaveLength(0);
  });

  it('런 errors[] 에 종목별 1건 + 팬아웃 집계 1건이 모두 올라간다 (개수가 안 보이면 삼킨 것과 같다)', async () => {
    throwFor(BAD, new Error('indicator blew up'));
    const res = await runAll({ market: 'domestic' });
    expect(res.errors).toContainEqual(expect.stringContaining(`${BAD}: collect_threw:`));
    expect(res.errors).toContainEqual(`domestic_collect_threw_1of${SYMBOLS.length}`);
  });

  it('실패 종목에는 시그널이 만들어지지 않는다', async () => {
    throwFor(BAD, new Error('indicator blew up'));
    await runAll({ market: 'domestic' });
    expect(createSignal.mock.calls.map((c) => (c[0] as { symbol: string }).symbol)).not.toContain(BAD);
  });

  it('모든 종목이 던져도 런은 끝나고 전수 실패가 집계된다 (직렬이었다면 런 전체가 중단됐다)', async () => {
    buildMarketSummary.mockImplementation(() => { throw new Error('all down'); });
    const res = await runAll({ market: 'domestic' });
    expect(funnelRows.filter((r) => r.gate === 'collect_threw')).toHaveLength(SYMBOLS.length);
    expect(res.errors).toContainEqual(`domestic_collect_threw_${SYMBOLS.length}of${SYMBOLS.length}`);
  });

  it('실패가 없으면 집계 줄도 errors 도 생기지 않는다 (평시에 잡음을 만들지 않는다)', async () => {
    const res = await runAll({ market: 'domestic' });
    expect(res.errors).toEqual([]);
    expect(funnelRows.filter((r) => r.gate === 'collect_threw')).toHaveLength(0);
    expect(sendAlertThrottled).not.toHaveBeenCalled();
  });

  /**
   * 🔴 reviewer M-1 — 종목 단위 흡수는 응답을 HTTP 200 `ok` 로 만들고 `classifyRun` 은 `errors[]` 를
   * 보지 않는다. 즉 **다수가 죽어도 운영 이상 목록에는 "정상"으로 보인다.** 직렬이었을 때는 500 →
   * `job_run_log.status='failed'` 로 떴다. 그 가시성을 push 알림으로 메운 것을 고정한다.
   */
  describe('M-1 가시성 — 다발 실패는 push 알림을 띄운다', () => {
    /** n개 종목에서만 던지게 한다 */
    function throwForN(n: number) {
      const bad = new Set(SYMBOLS.slice(0, n));
      buildMarketSummary.mockImplementation((_c: unknown, t: { symbol?: string }) => {
        if (t?.symbol && bad.has(t.symbol)) throw new Error('indicator blew up');
        return { rsi14: 30 };
      });
    }

    it('1~2건(임계 미만)은 로그·퍼널 행으로만 두고 알림을 띄우지 않는다', async () => {
      throwForN(2);   // 2/12 = 17% — 건수 3 미만이고 비율 25% 미만
      await runAll({ market: 'domestic' });
      expect(funnelRows.filter((r) => r.gate === 'collect_threw')).toHaveLength(2);
      expect(sendAlertThrottled).not.toHaveBeenCalled();
    });

    it('3건 이상이면 알림 1건을 띄운다', async () => {
      throwForN(3);
      await runAll({ market: 'domestic' });
      expect(sendAlertThrottled).toHaveBeenCalledTimes(1);
      const [key, level, title] = sendAlertThrottled.mock.calls[0];
      expect(key).toBe('collect_threw:domestic');   // 시장별 키 — 국내·해외가 서로 눌러 끄지 않는다
      expect(level).toBe('warning');
      expect(String(title)).toContain('domestic');
    });

    it('전수 실패(12/12)도 런은 끝나지만 알림으로 사람에게 닿는다', async () => {
      buildMarketSummary.mockImplementation(() => { throw new Error('all down'); });
      const res = await runAll({ market: 'domestic' });
      expect(res.errors).toContainEqual(`domestic_collect_threw_${SYMBOLS.length}of${SYMBOLS.length}`);
      expect(sendAlertThrottled).toHaveBeenCalledTimes(1);
      expect(String(sendAlertThrottled.mock.calls[0][3])).toContain('청산 엔진');  // 영향 범위를 적는다
    });

    /**
     * 🔴 QA L-1 — 부분 실패에 "정지"라고 단정하면 운영자가 신규 진입 전체가 멈춘 것으로 오인한다.
     * 실제로는 실패 종목만 빠지고 나머지는 ④ 까지 간다.
     */
    it('부분 실패는 "정지"라고 단정하지 않고 남은 종목 수를 알려 준다', async () => {
      throwForN(3);
      await runAll({ market: 'domestic' });
      const [, , title, body] = sendAlertThrottled.mock.calls[0];
      expect(String(title)).toContain('일부 중단');
      expect(String(title)).not.toContain('정지');
      expect(String(body)).toContain(`나머지 ${SYMBOLS.length - 3}종목은 정상 평가`);
    });

    it('전수 실패는 "정지"라고 분명히 말한다', async () => {
      buildMarketSummary.mockImplementation(() => { throw new Error('all down'); });
      await runAll({ market: 'domestic' });
      const [, , title, body] = sendAlertThrottled.mock.calls[0];
      expect(String(title)).toContain('전수 중단');
      expect(String(title)).toContain('정지');
      expect(String(body)).toContain('전부 멈췄습니다');
    });

    /**
     * 🔴 reviewer L-7 — 전수는 **별도 스로틀 키**다. 같은 키면 부분 알림 직후 전수로 악화돼도
     * 30분간 두 번째 알림이 억제된다 — 악화가 가장 중요한 순간이다.
     */
    it('전수 실패는 부분 실패와 다른 스로틀 키를 쓴다 (악화가 억제되지 않게)', async () => {
      throwForN(3);
      await runAll({ market: 'domestic' });
      const partialKey = sendAlertThrottled.mock.calls[0][0];

      sendAlertThrottled.mockClear();
      buildMarketSummary.mockImplementation(() => { throw new Error('all down'); });
      await runAll({ market: 'domestic' });
      const totalKey = sendAlertThrottled.mock.calls[0][0];

      expect(partialKey).toBe('collect_threw:domestic');
      expect(totalKey).toBe('collect_threw_all:domestic');
      expect(totalKey).not.toBe(partialKey);
    });

    /**
     * 🔴 reviewer L-6 — 3/12 는 건수(3≥3)와 비율(25%≥25%)을 **동시에** 만족해서, 한쪽 조항만
     * 지워도 시험이 통과했다(reviewer 변이 R3·R4 각 23/23). 두 조항을 **따로** 고정한다.
     */
    describe('L-6 임계 두 조항을 각각 고정한다', () => {
      /** 종목 수를 n 으로 바꾸고 앞 k 개에서 던지게 한다 */
      async function run(n: number, k: number) {
        evalSymbols.length = 0;
        evalSymbols.push(...Array.from({ length: n }, (_, i) => String(200_000 + i)));
        const bad = new Set(evalSymbols.slice(0, k));
        buildMarketSummary.mockImplementation((_c: unknown, t: { symbol?: string }) => {
          if (t?.symbol && bad.has(t.symbol)) throw new Error('boom');
          return { rsi14: 30 };
        });
        await runAll({ market: 'domestic' });
      }

      it('건수 조항만 — 40종목 중 3건(7.5%, 비율 미달)이면 울린다', async () => {
        await run(40, 3);
        expect(sendAlertThrottled).toHaveBeenCalledTimes(1);
      });

      it('비율 조항만 — 4종목 중 1건(25%, 건수 미달)이면 울린다', async () => {
        await run(4, 1);
        expect(sendAlertThrottled).toHaveBeenCalledTimes(1);
      });

      it('둘 다 미달 — 40종목 중 2건(5%)이면 울리지 않는다', async () => {
        await run(40, 2);
        expect(sendAlertThrottled).not.toHaveBeenCalled();
      });
    });
  });

  /**
   * 🔴 QA L-3 — 격리 분기 자신이 던지면 격리가 깨진다. `String(x)` 는 던질 수 있다:
   * `Object.create(null)` 은 `toString` 이 없고, `toString` 이 던지는 객체도 있다.
   * 던진 값은 우리가 고른 것이 아니므로 신뢰하지 않는다.
   */
  describe('L-3 문자열화할 수 없는 값을 던져도 격리가 유지된다', () => {
    const BAD2 = SYMBOLS[5];
    it.each([
      ['null-prototype 객체', Object.create(null) as unknown],
      ['toString 이 던지는 객체', { toString() { throw new Error('nope'); } } as unknown],
      ['Symbol', Symbol('boom') as unknown],
    ])('%s — 런이 끝나고 그 종목만 격리된다', async (_label, thrown) => {
      buildMarketSummary.mockImplementation((_c: unknown, t: { symbol?: string }) => {
        if (t?.symbol === BAD2) throw thrown;
        return { rsi14: 30 };
      });

      const res = await runAll({ market: 'domestic' });   // 던지지 않아야 한다

      expect(funnelRows.filter((r) => r.gate === 'collect_threw')).toHaveLength(1);
      expect(collectRows().map((r) => r.symbol).sort()).toEqual(SYMBOLS.filter((s) => s !== BAD2).sort());
      expect(res.results.find((r) => r.symbol === BAD2)?.error).toMatch(/^collect_threw:/);
      expect(res.results.map((r) => r.symbol)).toEqual(SYMBOLS);
    });
  });
});

// ─── 라벨 레지스트리 ─────────────────────────────────────────────────────────
describe('collect_threw 게이트가 레지스트리에 온전히 등록돼 있다', () => {
  it('게이트 목록·stage·한국어 라벨 세 곳에 모두 있다', () => {
    expect(FUNNEL_GATES).toContain('collect_threw');
    expect(GATE_STAGE.collect_threw).toBe(1);
    expect(GATE_LABEL_KO.collect_threw).toBeTruthy();
  });
});

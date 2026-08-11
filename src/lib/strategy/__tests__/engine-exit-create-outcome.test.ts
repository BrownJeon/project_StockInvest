/**
 * T-020 라운드 2 (reviewer HIGH-1) — **청산 경로에서 정책 스킵이 "실패"로 이중 기록되지 않는다.**
 *
 * ## 고정하려는 결함
 *
 * `createSignalGuarded` 는 성공·정책 스킵·실패·예외를 **전부 자기가** `eval_funnel` 에 기록한다.
 * 그런데 exit-engine 루프는 `res.ok === false` 이기만 하면 `exit_create_failed`(`verdict='error'`)를
 * **한 번 더** 썼다. 같은 청산 시도 1건이 두 행이 되고, 그중 하나가
 * `eval-funnel-query` 의 "⚠ 이상" 집계(`WHERE verdict='error'`)에 걸려 정기 리포트에
 * **"청산 시그널 생성 실패"** 로 올라간다.
 *
 * 하필 가장 위험한 경로에서 터진다 — `hard_stop`·`eod_loss_cut` 은 모드 무관 강제
 * `auto_submit` 이라 반드시 `createSignal` 의 수량 체크까지 도달한다. 즉 손절이 1주 미만이라
 * **정책대로** 스킵될 때마다 거짓 경보가 함께 찍힌다. 운영자는 곧 그 라벨이 무해하다는 걸
 * 학습하고 무시하기 시작하는데, 같은 라벨에 **진짜** 청산 실패(DB 장애·예외)도 찍힌다 —
 * 가짜가 진짜를 묻는다. T-018 H-4(B) 가 알림 키를 나눠 막은 것과 정확히 같은 계열의 실패다.
 *
 * ## 이 파일이 고정하는 계약
 *
 *  1. 정책 스킵(`quantity_below_min` 등)은 `skip` 행 **1개만** 남는다 — `error` 행 없음
 *  2. **진짜 실패·예외는 여전히 `exit_create_failed` 로 잡힌다** (반대 방향의 침묵 방지)
 *  3. 규칙은 `recordedVerdict` 기반이라 게이트별 특례가 아니다 — 다른 스킵 게이트에도 적용된다
 *  4. 스킵돼도 쿨다운을 걸지 않는다 → 다음 틱에 재시도된다 (손절이 통째로 유실되지 않는다)
 */
import type { Market } from '@/lib/exchanges/kis-symbols';

// ─── 모의 DB ─────────────────────────────────────────────────────────────────
const dbState = { exitEngineEnabled: 'true' as string | null };
/** eval_funnel 로 실제 flush 된 행 — 이 파일의 관찰 대상 */
const funnelRows: Array<{ symbol: string | null; stage: number; gate: string; verdict: string; reason: string | null }> = [];

async function defaultPoolQuery(sql: unknown, params?: unknown) {
  const s = String(sql);
  if (/INSERT INTO eval_funnel/i.test(s)) {
    const p = (params as unknown[]) ?? [];
    // flush 는 행당 10개 파라미터를 평평하게 넣는다:
    // run_id, market, symbol, strategy_id, side, stage, gate, verdict, reason, detail
    for (let i = 0; i + 9 < p.length; i += 10) {
      funnelRows.push({
        symbol:  p[i + 2] as string | null,
        stage:   Number(p[i + 5]),
        gate:    String(p[i + 6]),
        verdict: String(p[i + 7]),
        reason:  p[i + 8] as string | null,
      });
    }
    return [{ affectedRows: 1 }];
  }
  if (/FROM system_config/i.test(s)) {
    const keys = (params as string[] | undefined) ?? [];
    const out: Array<{ key: string; value: string }> = [];
    if (keys.includes('exit_engine_enabled') && dbState.exitEngineEnabled != null) {
      out.push({ key: 'exit_engine_enabled', value: dbState.exitEngineEnabled });
    }
    return [out];
  }
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

const loadPositionState = jest.fn();
jest.mock('@/lib/strategy/position-state', () => ({
  upsertPositionState:    jest.fn().mockResolvedValue(undefined),
  reconcilePositionState: jest.fn().mockResolvedValue(0),
  loadPositionState:      (...a: unknown[]) => loadPositionState(...a),
}));

const createSignal = jest.fn();
jest.mock('@/lib/signals/service', () => ({ createSignal: (...a: unknown[]) => createSignal(...a) }));

jest.mock('@/lib/notify', () => ({ sendAlert: jest.fn() }));
jest.mock('@/lib/notify/throttle', () => ({ sendAlertThrottled: jest.fn(), resetAlertThrottle: () => {} }));
jest.mock('@/lib/signals/router', () => ({
  getEngineSwitches: async () => ({ engineEnabled: false, autopilotMode: 'assist', source: 'config' }),
}));

const setCooldown = jest.fn();
jest.mock('@/lib/strategy/cooldowns', () => ({
  loadActiveCooldowns: async () => ({ isActive: () => false, until: () => null, loadError: null }),
  setCooldown: (...a: unknown[]) => setCooldown(...a),
  COOLDOWN_TTL_MIN: { entry: 120, rebuy: 30, exit: 15, entryRejected: 240 },
}));

jest.mock('@/lib/strategy/style', () => ({
  getStyleConfig: async () => ({
    hardStopPct: 5, targetProfitPct: 3, trailingActivatePct: 3, trailingDrawdownPct: 2,
    eodLossCutPct: 2, lateSessionBuyBlockMin: 30, feePct: 0.18, slippagePct: 0.15,
    stableCoreRatioMin: 0,
  }),
  roundTripCostPct: () => 0.33,
}));
jest.mock('@/lib/strategy/universe', () => ({
  refreshUniverse: async () => ({ refreshed: false }),
  getUniverseSymbols: async () => [] as string[],
  getAlwaysIncludeSymbols: async () => ['005930'],
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
jest.mock('../rules', () => ({ STRATEGY_REGISTRY: {} }));

import { runAll, resetHeldUnknownState } from '../engine';

const ENTRY = 70_000;
/** 10:00 KST — EOD 창 밖 */
const SAFE_KST = new Date('2026-08-05T01:00:00Z');
/** hard_stop 을 확실히 유발하는 현재가 (−14%) */
const HARD_STOP_PRICE = 60_000;

const heldBalances = () => ({
  balances: [
    { currency: 'KRW', free: 500_000, locked: 0 },
    { currency: '005930', free: 10, locked: 0, avgPrice: ENTRY },
  ],
  ok: ['domestic', 'overseas'] as Market[],
  failed: [] as { market: Market; error: string }[],
  complete: true,
});

const positionState = () => ({
  symbol: '005930', market: 'domestic' as Market,
  entryPrice: ENTRY, peakPrice: ENTRY, qty: 10,
  scenarioExit: null, holdingDeadline: null,
  firstSeenAt: new Date(), updatedAt: new Date(),
});

const exitRows = () => funnelRows.filter(r => r.symbol === '005930');
const gatesOf = (verdict: string) => exitRows().filter(r => r.verdict === verdict).map(r => r.gate);

beforeEach(() => {
  jest.clearAllMocks();
  poolQuery.mockImplementation(defaultPoolQuery);
  funnelRows.length = 0;
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  jest.setSystemTime(SAFE_KST);
  resetHeldUnknownState();
  dbState.exitEngineEnabled = 'true';
  getBalancesDetailed.mockResolvedValue(heldBalances());
  getTicker.mockResolvedValue({ price: HARD_STOP_PRICE, open24h: ENTRY });
  getCandles.mockResolvedValue([]);
  loadPositionState.mockResolvedValue(positionState());
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ── ① 전제 확인 — 이 하네스가 정말 청산 경로를 타는가 ────────────────────────

describe('전제 — hard_stop 청산이 실제로 createSignal 까지 도달한다', () => {
  test('정상 생성되면 signal_created(pass) 1행만 남고 exit_create_failed 는 없다', async () => {
    createSignal.mockResolvedValue({ ok: true, signalId: 1, autoSubmitted: true });

    await runAll({ market: 'domestic' });

    expect(createSignal).toHaveBeenCalledTimes(1);
    expect((createSignal.mock.calls[0][0] as { indicators: { exit_kind: string } }).indicators.exit_kind)
      .toBe('hard_stop');
    expect(gatesOf('pass')).toContain('signal_created');
    expect(gatesOf('error')).not.toContain('exit_create_failed');
  });
});

// ── ② 🔴 HIGH-1 회귀 — 정책 스킵이 "실패"로 이중 기록되지 않는다 ─────────────

describe('🔴 정책 스킵은 eval_funnel 에 skip 1행만 남는다', () => {
  test('quantity_below_min — skip 1행, error 행 0개 (거짓 "청산 시그널 생성 실패" 없음)', async () => {
    createSignal.mockResolvedValue({
      ok: false, signalId: 9, autoSubmitted: false,
      error: 'quantity_below_min: 1주 미만 — 금액 ₩50,000 / 가격 905,000 = 0.055주',
      errorCode: 'quantity_below_min',
    });

    await runAll({ market: 'domestic' });

    // 정책 스킵으로 정확히 1행
    const skips = exitRows().filter(r => r.gate === 'quantity_below_min');
    expect(skips).toHaveLength(1);
    expect(skips[0].verdict).toBe('skip');
    expect(skips[0].reason).toBe('quantity_below_min');

    // 🔴 핵심 — 같은 사건에 대한 error 행이 하나도 없어야 한다
    expect(gatesOf('error')).not.toContain('exit_create_failed');
    expect(exitRows().filter(r => r.verdict === 'error')).toHaveLength(0);
  });

  test('스킵돼도 쿨다운을 걸지 않는다 — 다음 틱에 손절을 재시도한다', async () => {
    createSignal.mockResolvedValue({
      ok: false, signalId: 9, autoSubmitted: false,
      error: 'quantity_below_min: …', errorCode: 'quantity_below_min',
    });

    await runAll({ market: 'domestic' });
    expect(setCooldown).not.toHaveBeenCalled();
  });

  test('🔴 특례가 아니라 일반 규칙 — 다른 스킵 게이트도 이중 기록되지 않는다', async () => {
    for (const errorCode of ['duplicate_active_signal', 'symbol_blacklisted'] as const) {
      funnelRows.length = 0;
      jest.clearAllMocks();
      poolQuery.mockImplementation(defaultPoolQuery);
      getBalancesDetailed.mockResolvedValue(heldBalances());
      getTicker.mockResolvedValue({ price: HARD_STOP_PRICE, open24h: ENTRY });
      getCandles.mockResolvedValue([]);
      loadPositionState.mockResolvedValue(positionState());
      resetHeldUnknownState();
      createSignal.mockResolvedValue({
        ok: false, signalId: 5, autoSubmitted: false, error: errorCode, errorCode,
      });

      await runAll({ market: 'domestic' });

      expect(exitRows().filter(r => r.gate === errorCode && r.verdict === 'skip')).toHaveLength(1);
      expect(gatesOf('error')).not.toContain('exit_create_failed');
    }
  });
});

// ── ③ 반대 방향의 침묵 방지 — 진짜 실패는 여전히 잡힌다 ─────────────────────

describe('🔴 진짜 실패는 여전히 exit_create_failed 로 잡힌다', () => {
  test('errorCode 없는 일반 거부 → signal_create_failed(error) + exit_create_failed(error) 둘 다', async () => {
    createSignal.mockResolvedValue({
      ok: false, signalId: 0, autoSubmitted: false, error: '한도 초과',
    });

    await runAll({ market: 'domestic' });

    const errs = exitRows().filter(r => r.verdict === 'error').map(r => r.gate);
    // 진입 축(stage 11) 기록 + 청산 트랙(stage 29) 기록 — 후자가 없으면 exit 트랙에서 사라진다
    expect(errs).toContain('signal_create_failed');
    expect(errs).toContain('exit_create_failed');
    expect(exitRows().find(r => r.gate === 'exit_create_failed')!.stage).toBe(29);
  });

  test('createSignal 이 예외를 던져도 exit_create_failed 가 남는다 (런은 계속된다)', async () => {
    createSignal.mockRejectedValue(new Error('ER_LOCK_DEADLOCK'));

    const r = await runAll({ market: 'domestic' });

    expect(r.errors).not.toContain('balances_unknown');   // 런 자체는 죽지 않았다
    const errs = exitRows().filter(r2 => r2.verdict === 'error').map(r2 => r2.gate);
    expect(errs).toContain('exit_create_failed');
  });
});

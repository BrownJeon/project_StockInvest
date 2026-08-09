/**
 * T-012 — **"보유 없음"과 "보유를 모름"은 다른 상태다.**
 *
 * `getHeldAmounts` 는 예전에 잔고 조회 실패에도 빈 `Map` 을 돌려줬다. 호출부는 둘을 구분할
 * 수 없었고, 조회 실패 한 번이 조용히 아래를 전부 일으켰다:
 *
 *  1. `runExitEngine` 이 손절·트레일링 신호를 **한 건도 만들지 않는다** (보호할 게 없다고 판단)
 *  2. 매도 신호가 `!heldAmounts.has(symbol)` 로 거부된다
 *  3. 🔴 `reconcilePositionState(market, [])` 가 그 시장의 `position_state` 를 **전부 DELETE** —
 *     트레일링 고점이 사라져 복구 후에도 손절 기준이 틀어진다
 *
 * 셋 다 "포지션에서 빠져나가는 경로"를 막는 fail-open 이다. 이 테스트가 고정하는 계약:
 * **모르면 아무것도 하지 않는다. 단 시끄럽게.**
 */
import type { Market } from '@/lib/exchanges/kis-symbols';

const getBalancesDetailed = jest.fn();
const getTicker = jest.fn();
const reconcilePositionState = jest.fn().mockResolvedValue(0);
const sendAlertThrottled = jest.fn();
const sendAlert = jest.fn();
const funnelInsert = jest.fn();

jest.mock('@/lib/db', () => ({
  getPool: () => ({ query: (...a: unknown[]) => funnelInsert(...a) }),
}));
jest.mock('@/lib/exchanges/kis', () => ({
  kis: { getTicker: (...a: unknown[]) => getTicker(...a), getMarket: () => 'domestic' },
  getBalancesDetailed: (...a: unknown[]) => getBalancesDetailed(...a),
}));
jest.mock('@/lib/strategy/market-hours', () => ({
  isDomesticOpen: async () => true,
  isOverseasOpen: async () => true,
  getCurrentMarket: async () => 'domestic',
}));
jest.mock('@/lib/strategy/position-state', () => ({
  reconcilePositionState: (...a: unknown[]) => reconcilePositionState(...a),
  upsertPositionState: jest.fn(),
  loadPositionState: jest.fn(),
}));
jest.mock('@/lib/notify', () => ({ sendAlert: (...a: unknown[]) => sendAlert(...a) }));
jest.mock('@/lib/notify/throttle', () => ({
  sendAlertThrottled: (...a: unknown[]) => sendAlertThrottled(...a),
  resetAlertThrottle: () => {},
}));
/**
 * `engineEnabled=false` — 신규 진입 평가는 멈추지만 **청산 트랙은 그대로 돈다**(설계상
 * 의도된 동작). 이 파일의 관심사는 "보유를 아는가/모르는가"가 청산 트랙에 미치는 영향이므로,
 * 진입 파이프라인(유니버스·지표·AI)까지 끌어들이지 않고 그 앞에서 끊는다.
 */
jest.mock('@/lib/signals/router', () => ({
  getEngineSwitches: async () => ({ engineEnabled: false, autopilotMode: 'assist', source: 'env' }),
}));
jest.mock('@/lib/strategy/cooldowns', () => ({
  loadActiveCooldowns: async () => new Set(),
  setCooldown: jest.fn(),
  COOLDOWN_TTL_MIN: { entry: 120, rebuy: 30, exit: 15 },
}));
jest.mock('@/lib/strategy/style', () => ({
  getStyleConfig: async () => ({ feePct: 0.18, slippagePct: 0.15 }),
  roundTripCostPct: () => 0.33,
}));

import { runAll, resetHeldUnknownState } from '../engine';

const OK_BALANCES = {
  balances: [
    { currency: 'KRW', free: 500_000, locked: 0 },
    { currency: '005930', free: 10, locked: 0, avgPrice: 70_000 },
  ],
  ok: ['domestic', 'overseas'] as Market[],
  failed: [] as { market: Market; error: string }[],
  complete: true,
};

const DOMESTIC_FAILED = {
  balances: [],
  ok: ['overseas'] as Market[],
  failed: [{ market: 'domestic' as Market, error: 'KIS getBalances: 500 EGW00201' }],
  complete: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  resetHeldUnknownState();
  funnelInsert.mockResolvedValue([[]]);
  getTicker.mockResolvedValue({ price: 70_000, open24h: 70_000 });
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('🔴 자기 시장 잔고 조회 실패 = "모름"', () => {
  test('평가 틱 전체를 중단하고 balances_unknown 을 보고한다', async () => {
    getBalancesDetailed.mockResolvedValue(DOMESTIC_FAILED);
    const r = await runAll({ market: 'domestic' });
    expect(r.errors).toEqual(['balances_unknown']);
    expect(r.ran).toBe(0);
    expect(r.results).toEqual([]);
  });

  test('🔴 position_state 를 정리하지 않는다 (빈 목록 reconcile = 트레일링 고점 전삭제)', async () => {
    getBalancesDetailed.mockResolvedValue(DOMESTIC_FAILED);
    await runAll({ market: 'domestic' });
    expect(reconcilePositionState).not.toHaveBeenCalled();
  });

  test('🔴 조용하지 않다 — 텔레그램 알림 + error 로그가 나간다', async () => {
    getBalancesDetailed.mockResolvedValue(DOMESTIC_FAILED);
    await runAll({ market: 'domestic' });
    expect(sendAlertThrottled).toHaveBeenCalledTimes(1);
    const [key, level, , body] = sendAlertThrottled.mock.calls[0];
    expect(String(key)).toContain('domestic');
    expect(level).toBe('warning');                     // 첫 발생은 warning
    expect(String(body)).toContain('EGW00201');
    expect(console.error).toHaveBeenCalled();
  });

  test('알림 본문이 무엇이 멈췄는지 설명한다 (손절·매도·position_state)', async () => {
    getBalancesDetailed.mockResolvedValue(DOMESTIC_FAILED);
    await runAll({ market: 'domestic' });
    const body = String(sendAlertThrottled.mock.calls[0][3]);
    expect(body).toContain('손절');
    expect(body).toContain('매도');
    expect(body).toContain('position_state');
  });

  test('🔴 30분 넘게 이어지면 critical 로 승격한다', async () => {
    getBalancesDetailed.mockResolvedValue(DOMESTIC_FAILED);
    const t0 = Date.now();
    const spy = jest.spyOn(Date, 'now');
    spy.mockReturnValue(t0);
    await runAll({ market: 'domestic' });
    expect(sendAlertThrottled.mock.calls[0][1]).toBe('warning');

    spy.mockReturnValue(t0 + 31 * 60_000);             // 31분 뒤에도 계속 실패
    await runAll({ market: 'domestic' });
    expect(sendAlertThrottled.mock.calls[1][1]).toBe('critical');
    expect(String(sendAlertThrottled.mock.calls[1][0])).toContain('critical');
    spy.mockRestore();
  });

  test('복구되면 승격 상태가 해제되고 회복 알림이 나간다', async () => {
    const t0 = Date.now();
    const spy = jest.spyOn(Date, 'now');
    getBalancesDetailed.mockResolvedValue(DOMESTIC_FAILED);
    spy.mockReturnValue(t0);
    await runAll({ market: 'domestic' });
    spy.mockReturnValue(t0 + 31 * 60_000);
    await runAll({ market: 'domestic' });
    expect(sendAlertThrottled.mock.calls[1][1]).toBe('critical');

    getBalancesDetailed.mockResolvedValue(OK_BALANCES);
    spy.mockReturnValue(t0 + 35 * 60_000);
    await runAll({ market: 'domestic' });
    const info = sendAlert.mock.calls.filter(c => c[0] === 'info');
    expect(info).toHaveLength(1);
    expect(String(info[0][1])).toContain('정상화');
    spy.mockRestore();
  });

  test('조회 자체가 예외를 던져도 "모름"으로 다룬다 (빈 맵 아님)', async () => {
    getBalancesDetailed.mockRejectedValue(new Error('network down'));
    const r = await runAll({ market: 'domestic' });
    expect(r.errors).toEqual(['balances_unknown']);
    expect(reconcilePositionState).not.toHaveBeenCalled();
    expect(sendAlertThrottled).toHaveBeenCalledTimes(1);
  });

  test('🔴 조회하지 않은 시장(비활성화)도 "보유 없음"이 아니라 "모름"이다', async () => {
    // overseas 가 KIS_OVERSEAS_ENABLED=false 로 task 에서 빠진 상황 —
    // failed 에도 ok 에도 없다. 예전 코드는 이걸 "보유 없음"으로 읽었다.
    getBalancesDetailed.mockResolvedValue({
      balances: [{ currency: 'KRW', free: 500_000, locked: 0 }],
      ok: ['domestic'] as Market[],
      failed: [] as { market: Market; error: string }[],
      complete: true,
    });
    const r = await runAll({ market: 'overseas' });
    expect(r.errors).toEqual(['balances_unknown']);
    expect(reconcilePositionState).not.toHaveBeenCalled();
  });
});

describe('✅ 정상 조회 — 기존 동작이 유지된다', () => {
  test('보유를 알면 reconcile 이 실제 보유 목록으로 실행된다', async () => {
    getBalancesDetailed.mockResolvedValue(OK_BALANCES);
    await runAll({ market: 'domestic' });
    expect(reconcilePositionState).toHaveBeenCalledTimes(1);
    expect(reconcilePositionState.mock.calls[0][0]).toBe('domestic');
    expect(reconcilePositionState.mock.calls[0][1]).toEqual(['005930']);
  });

  test('🔴 진짜로 보유가 0건이면 빈 목록으로 reconcile 한다 (모름과 구분)', async () => {
    getBalancesDetailed.mockResolvedValue({
      balances: [{ currency: 'KRW', free: 500_000, locked: 0 }],
      ok: ['domestic', 'overseas'] as Market[],
      failed: [] as { market: Market; error: string }[],
      complete: true,
    });
    await runAll({ market: 'domestic' });
    expect(reconcilePositionState).toHaveBeenCalledTimes(1);
    expect(reconcilePositionState.mock.calls[0][1]).toEqual([]);
    expect(sendAlertThrottled).not.toHaveBeenCalled();   // 정상 상태는 알리지 않는다
  });

  test('한쪽 시장만 실패하면 다른 시장은 정상 평가된다 (부분 실패 격리)', async () => {
    getBalancesDetailed.mockResolvedValue({
      balances: [{ currency: 'NAS:SNPS', free: 23, locked: 0, avgPrice: 558_654 }],
      ok: ['overseas'] as Market[],
      failed: [{ market: 'domestic' as Market, error: 'EGW00201' }],
      complete: false,
    });
    const r = await runAll({ market: 'overseas' });
    expect(r.errors).not.toContain('balances_unknown');
    expect(reconcilePositionState).toHaveBeenCalledTimes(1);
    expect(reconcilePositionState.mock.calls[0][1]).toEqual(['NAS:SNPS']);
  });
});

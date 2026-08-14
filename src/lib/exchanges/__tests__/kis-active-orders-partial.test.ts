/**
 * T-018 — 미체결 주문 조회의 **부분 실패를 완전 성공과 구분한다.**
 *
 * [[T-014]] 의 `getBalancesDetailed`/`BalancesIncompleteError` 와 **의도적으로 같은 계약**이다.
 * 잔고에서 "부분 실패를 정상 응답처럼 반환하면 총액이 -20% 로 기록된다"였던 것이, 여기서는
 * "부분 실패를 정상 응답처럼 반환하면 살아 있는 주문이 `cancelled` 로 기록된다"가 된다.
 *
 * 예전 Facade 는 두 시장을 각각 `.catch(() => [])` 로 감쌌고, `KIS_OVERSEAS_ENABLED=false`
 * 분기는 catch 없이 그대로 위임했다 — 어느 쪽이든 어댑터가 이미 삼키고 있어 던질 수 없었다.
 */
const domGetActiveOrders = jest.fn();
const ovsGetActiveOrders = jest.fn();
const domGetCompletedOrders = jest.fn();
const ovsGetCompletedOrders = jest.fn();

jest.mock('@/lib/exchanges/kis-domestic', () => ({
  getActiveOrders:    (...a: unknown[]) => domGetActiveOrders(...a),
  getCompletedOrders: (...a: unknown[]) => domGetCompletedOrders(...a),
  getBalances: jest.fn(), getTicker: jest.fn(), getCandles: jest.fn(),
  createOrder: jest.fn(), cancelOrder: jest.fn(),
  fetchMarketCapRanking: jest.fn(), getKisTickers: jest.fn(),
}));
jest.mock('@/lib/exchanges/kis-overseas', () => ({
  getActiveOrders:    (...a: unknown[]) => ovsGetActiveOrders(...a),
  getCompletedOrders: (...a: unknown[]) => ovsGetCompletedOrders(...a),
  activeOrderExchanges: jest.fn(() => ['NAS']),
  getBalances: jest.fn(), getTicker: jest.fn(), getCandles: jest.fn(),
  createOrder: jest.fn(), cancelOrder: jest.fn(),
  getKisOverseasTickers: jest.fn(),
}));

import {
  getActiveOrders, getActiveOrdersDetailed, getCompletedOrders, ActiveOrdersIncompleteError,
} from '@/lib/exchanges/kis';
import { KisThrottleQueueFullError, KisThrottleTimeoutError } from '@/lib/exchanges/kis-throttle';

const DOM = [{ orderId: 'D1', symbol: '005930' }];
const OVS = [{ orderId: 'O1', symbol: 'NAS:AAPL' }];

const RATE_LIMIT = new Error(
  'KIS getActiveOrders: 500 body={"rt_cd":"1","msg1":"초당 거래건수를 초과하였습니다.","msg_cd":"EGW00201"}',
);

const origOverseasEnabled = process.env.KIS_OVERSEAS_ENABLED;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.KIS_OVERSEAS_ENABLED = 'true';
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  if (origOverseasEnabled === undefined) delete process.env.KIS_OVERSEAS_ENABLED;
  else process.env.KIS_OVERSEAS_ENABLED = origOverseasEnabled;
});

describe('getActiveOrdersDetailed — 시장별 성공/실패를 보존한다', () => {
  test('양 시장 성공 → complete=true', async () => {
    domGetActiveOrders.mockResolvedValue(DOM);
    ovsGetActiveOrders.mockResolvedValue(OVS);
    const r = await getActiveOrdersDetailed();
    expect(r.complete).toBe(true);
    expect(r.ok.sort()).toEqual(['domestic', 'overseas']);
    expect(r.orders).toHaveLength(2);
  });

  test('🔴 국내 실패 → complete=false, 실패 사유 노출, 해외분은 보존', async () => {
    domGetActiveOrders.mockRejectedValue(RATE_LIMIT);
    ovsGetActiveOrders.mockResolvedValue(OVS);
    const r = await getActiveOrdersDetailed();
    expect(r.complete).toBe(false);
    expect(r.failed.map(f => f.market)).toEqual(['domestic']);
    expect(r.failed[0].error).toContain('EGW00201');
    expect(r.ok).toEqual(['overseas']);
    expect(r.orders).toEqual(OVS);
  });

  test('해외 실패 → complete=false, 국내분 보존', async () => {
    domGetActiveOrders.mockResolvedValue(DOM);
    ovsGetActiveOrders.mockRejectedValue(RATE_LIMIT);
    const r = await getActiveOrdersDetailed();
    expect(r.complete).toBe(false);
    expect(r.ok).toEqual(['domestic']);
    expect(r.orders).toEqual(DOM);
  });

  test('양쪽 실패 → 둘 다 failed 에 담긴다', async () => {
    domGetActiveOrders.mockRejectedValue(RATE_LIMIT);
    ovsGetActiveOrders.mockRejectedValue(RATE_LIMIT);
    const r = await getActiveOrdersDetailed();
    expect(r.failed.map(f => f.market).sort()).toEqual(['domestic', 'overseas']);
    expect(r.orders).toEqual([]);
  });

  test('KIS_OVERSEAS_ENABLED=false → 국내만 조회, 국내 성공이면 complete', async () => {
    process.env.KIS_OVERSEAS_ENABLED = 'false';
    domGetActiveOrders.mockResolvedValue(DOM);
    const r = await getActiveOrdersDetailed();
    expect(ovsGetActiveOrders).not.toHaveBeenCalled();
    expect(r.complete).toBe(true);
    expect(r.ok).toEqual(['domestic']);
  });

  test('🔴 KIS_OVERSEAS_ENABLED=false + 국내 실패 → 예전의 catch 없는 위임 경로도 이제 실패로 보인다', async () => {
    process.env.KIS_OVERSEAS_ENABLED = 'false';
    domGetActiveOrders.mockRejectedValue(RATE_LIMIT);
    const r = await getActiveOrdersDetailed();
    expect(r.complete).toBe(false);
    expect(r.ok).toEqual([]);
  });

  test.each([
    ['KisThrottleQueueFullError', new KisThrottleQueueFullError('normal', 192)],
    ['KisThrottleTimeoutError',   new KisThrottleTimeoutError('normal', 30_000, 30_000, 'q')],
  ])('🔴 T-017 %s 도 "0건"이 아니라 실패로 보존된다', async (_n, err) => {
    domGetActiveOrders.mockRejectedValue(err);
    ovsGetActiveOrders.mockResolvedValue([]);
    const r = await getActiveOrdersDetailed();
    expect(r.complete).toBe(false);
    expect(r.failed[0].market).toBe('domestic');
    expect(r.orders).toEqual([]);          // 목록은 비었지만
    expect(r.ok).not.toContain('domestic'); // "국내 0건"이라고 말하지는 않는다
  });

  /**
   * T-023 Reviewer MEDIUM-1 — HIGH-1(페이지 상한 truncate 시 throw)의 다운스트림 상호작용을
   * 못박는다. `getActiveOrders()` 자체의 단위 테스트(kis-domestic.test.ts/kis-overseas.test.ts)는
   * 던지는지만 확인하고, 그 결과 `getActiveOrdersDetailed()` 가 실제로 해당 시장을 ok 에서
   * 빼는지는 여기서 확인해야 한다 — order-sync 의 fail-closed 판정이 바로 이 ok/failed 분류를
   * 근거로 삼기 때문이다.
   */
  test('🔴 T-023 HIGH-1 — 페이지 상한 truncate 에러도 국내 시장을 실패로 분류한다(ok 에서 제외)', async () => {
    const PAGE_CAP_ERROR = new Error(
      'KIS getActiveOrders: 페이지 상한(20)에 도달했는데 tr_cont=M(계속) — 20건만 모은 채 불완전하여 실패로 처리',
    );
    domGetActiveOrders.mockRejectedValue(PAGE_CAP_ERROR);
    ovsGetActiveOrders.mockResolvedValue(OVS);
    const r = await getActiveOrdersDetailed();
    expect(r.complete).toBe(false);
    expect(r.failed).toEqual([{ market: 'domestic', error: PAGE_CAP_ERROR.message }]);
    expect(r.ok).toEqual(['overseas']);
    expect(r.orders).toEqual(OVS); // 해외분은 보존, 국내는 잘린 목록을 성공으로 위장하지 않는다
  });

  test('🔴 T-023 HIGH-1 — 해외 쪽 페이지 상한 truncate 에러도 동일하게 해외 시장을 실패로 분류한다', async () => {
    const PAGE_CAP_ERROR = new Error(
      'KIS overseas getActiveOrders(NAS): 페이지 상한(20)에 도달했는데 tr_cont=M(계속) — 20건만 모은 채 불완전하여 실패로 처리',
    );
    domGetActiveOrders.mockResolvedValue(DOM);
    ovsGetActiveOrders.mockRejectedValue(PAGE_CAP_ERROR);
    const r = await getActiveOrdersDetailed();
    expect(r.complete).toBe(false);
    expect(r.failed).toEqual([{ market: 'overseas', error: PAGE_CAP_ERROR.message }]);
    expect(r.ok).toEqual(['domestic']);
    expect(r.orders).toEqual(DOM);
  });
});

describe('getActiveOrders — 부분 실패를 조용히 통과시키지 않고 던진다', () => {
  test('양 시장 성공이면 합친 목록을 반환', async () => {
    domGetActiveOrders.mockResolvedValue(DOM);
    ovsGetActiveOrders.mockResolvedValue(OVS);
    await expect(getActiveOrders()).resolves.toHaveLength(2);
  });

  test('🔴 국내 실패 시 ActiveOrdersIncompleteError — 잘린 목록을 반환하지 않는다', async () => {
    domGetActiveOrders.mockRejectedValue(RATE_LIMIT);
    ovsGetActiveOrders.mockResolvedValue(OVS);
    await expect(getActiveOrders()).rejects.toBeInstanceOf(ActiveOrdersIncompleteError);
  });

  test('예외에 실패·성공 시장이 모두 담긴다', async () => {
    domGetActiveOrders.mockRejectedValue(RATE_LIMIT);
    ovsGetActiveOrders.mockResolvedValue(OVS);
    const err = await getActiveOrders().catch((e: unknown) => e) as ActiveOrdersIncompleteError;
    expect(err.failed.map(f => f.market)).toEqual(['domestic']);
    expect(err.okMarkets).toEqual(['overseas']);
  });

  /**
   * 회귀 방어의 핵심: 예전 동작은 국내 실패 시 **해외만 든 배열을 정상 반환**했고,
   * `order-sync` 는 그 배열의 부재를 근거로 국내 지정가 주문을 전부 취소로 마킹했다.
   */
  test('🔴 회귀 — 국내 실패가 "해외만 든 정상 배열"로 둔갑하지 않는다', async () => {
    domGetActiveOrders.mockRejectedValue(RATE_LIMIT);
    ovsGetActiveOrders.mockResolvedValue(OVS);
    let resolved: unknown = null;
    try { resolved = await getActiveOrders(); } catch { /* expected */ }
    expect(resolved).toBeNull();
  });
});

describe('getCompletedOrders — 심볼로 라우팅하고 실패를 그대로 전파한다', () => {
  test('국내 심볼은 국내 어댑터로', async () => {
    domGetCompletedOrders.mockResolvedValue([]);
    await getCompletedOrders('005930', 0, 1, 100);
    expect(domGetCompletedOrders).toHaveBeenCalled();
    expect(ovsGetCompletedOrders).not.toHaveBeenCalled();
  });

  test('해외 심볼은 해외 어댑터로', async () => {
    ovsGetCompletedOrders.mockResolvedValue([]);
    await getCompletedOrders('NAS:AAPL', 0, 1, 100);
    expect(ovsGetCompletedOrders).toHaveBeenCalled();
  });

  test('🔴 어댑터가 던지면 빈 배열로 퇴화하지 않고 그대로 던진다', async () => {
    domGetCompletedOrders.mockRejectedValue(RATE_LIMIT);
    await expect(getCompletedOrders('005930', 0, 1, 100)).rejects.toThrow('EGW00201');
  });
});

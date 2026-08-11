/**
 * T-018 — **조회 실패로 살아 있는 주문을 `cancelled` 로 쓰지 않는다.**
 *
 * ## 고정하려는 결함
 *
 * `order-sync` 의 취소 판정은 부재 추론이다 — "미체결에도 없고 체결에도 없으니 취소됐다".
 * 실패가 빈 배열로 삼켜지면 두 집합이 동시에 비고, 그 순간 **모든 비-market 미결 주문이
 * `cancelled` 로 마킹**된다. 브로커에는 여전히 살아 있는 주문인데도.
 *
 * 피해는 두 가지다: 포지션이 없다고 오인한 **중복 진입**, 그리고 실제로 작동 중인 주문의
 * **청산 추적 유실**. 실제 돈이 걸린 경로이므로 회귀를 테스트로 못 박는다.
 *
 * ## 이 파일이 고정하는 계약
 *
 *  1. 미체결 조회 실패 → 아무것도 `cancelled` 로 쓰지 않는다
 *  2. 체결 조회 실패   → 아무것도 `cancelled` 로 쓰지 않는다
 *  3. 두 조회 모두 성공 → 진짜 취소된 주문은 **여전히** 잡아낸다 (fail-closed 가 기능을 죽이지 않음)
 *  4. 시장별 부분 성공 → 성공한 시장은 계속 판정하고, 실패한 시장만 보류한다
 *  5. 스로틀 예외([[T-017]])는 "미체결 0건"이 아니라 **"모름"** 으로 다룬다
 *  6. §역방향 위험 — 보류가 오래되면 알림으로 드러난다 (조용한 정지 방지)
 */
import { getPool } from '@/lib/db';
import { getActiveOrdersDetailed, getCompletedOrders } from '@/lib/exchanges/kis';
import { sendAlertThrottled } from '@/lib/notify/throttle';
import { KisThrottleTimeoutError, KisThrottleQueueFullError } from '@/lib/exchanges/kis-throttle';
import { submittedQuantity } from '@/lib/exchanges/order-quantity';
import {
  syncPendingOrders, resetUnreconciledTracker, clampGraceSec, DEFAULT_CANCEL_GRACE_SEC,
} from '../order-sync';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/exchanges/kis', () => ({
  getActiveOrdersDetailed: jest.fn(),
  getCompletedOrders: jest.fn(),
  overseasActiveOrderExchanges: jest.fn(() => ['NAS']),
}));
jest.mock('@/lib/notify/throttle', () => ({
  sendAlertThrottled: jest.fn(() => true),
  resetAlertThrottle: jest.fn(),
}));

interface PendingRow {
  id: number;
  exchange_order_id: string;
  symbol: string;
  type: 'limit' | 'market';
  status: string;
  quantity: number | null;
  created_at: Date;
}

function setupPool(rows: PendingRow[], opts: { graceConfigSec?: number } = {}) {
  const updates: Array<{ sql: string; params: unknown[] }> = [];
  const query = jest.fn(async (sqlArg: unknown, paramsArg: unknown[] = []) => {
    const sql = String(sqlArg);
    if (/FROM system_config/i.test(sql)) {
      return [opts.graceConfigSec === undefined ? [] : [{ value: JSON.stringify(opts.graceConfigSec) }]];
    }
    if (/SELECT[\s\S]*FROM orders/i.test(sql)) return [rows];
    if (/UPDATE orders/i.test(sql)) {
      updates.push({ sql, params: paramsArg ?? [] });
      return [{}];
    }
    return [[]];
  });
  (getPool as jest.Mock).mockReturnValue({ query });
  return { updates };
}

/** 유예 기간을 확실히 지난 시각 — 실제 시계든 mock 시계든 항상 "오래된" 주문이 되게 한다 */
const AGED = new Date('2026-08-01T00:00:00+09:00');

const row = (o: Partial<PendingRow> & { id: number }): PendingRow => ({
  exchange_order_id: `O${String(o.id).padStart(3, '0')}`,
  symbol: '005930',
  type: 'limit',
  status: 'accepted',
  quantity: 1,
  created_at: AGED,
  ...o,
});

/** 실측 레이트리밋 응답 형태 (kisFetch 재시도 소진 후 어댑터가 던지는 메시지) */
const RATE_LIMIT = new Error(
  'KIS getActiveOrders: 500 body={"rt_cd":"1","msg1":"초당 거래건수를 초과하였습니다.","msg_cd":"EGW00201"} (레이트리밋 — 백오프 재시도 소진)',
);

const bothOk = (orders: { orderId: string; symbol: string }[]) => ({
  orders, ok: ['domestic', 'overseas'], failed: [], complete: true,
});
const marketFailed = (
  market: 'domestic' | 'overseas',
  orders: { orderId: string; symbol: string }[] = [],
  error = RATE_LIMIT.message,
) => ({
  orders,
  ok: (['domestic', 'overseas'] as const).filter(m => m !== market),
  failed: [{ market, error }],
  complete: false,
});
const allFailed = () => ({
  orders: [],
  ok: [],
  failed: [
    { market: 'domestic', error: RATE_LIMIT.message },
    { market: 'overseas', error: RATE_LIMIT.message },
  ],
  complete: false,
});

const cancelledUpdates = (u: Array<{ sql: string }>) => u.filter(x => /status='cancelled'/.test(x.sql));

beforeEach(() => {
  jest.clearAllMocks();
  resetUnreconciledTracker();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); });

// ── ① 미체결 조회 실패 ───────────────────────────────────────────────────────

describe('🔴 미체결(active) 조회 실패는 취소 판정을 만들지 않는다', () => {
  test('양 시장 모두 실패 → cancelled UPDATE 가 한 건도 나가지 않는다', async () => {
    const { updates } = setupPool([row({ id: 1 }), row({ id: 2, symbol: 'NAS:AAPL' })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(allFailed());
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);   // 체결 목록에도 없음

    const r = await syncPendingOrders();

    expect(cancelledUpdates(updates)).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(r.synced).toBe(0);
    expect(r.complete).toBe(false);
    expect(r.skipped).toBe(2);
    expect(r.unreconciled.map(u => u.reason)).toEqual(['active_query_failed', 'active_query_failed']);
  });

  /**
   * 회귀의 핵심 재현: 예전 코드에서 이 조합은 두 집합이 모두 비어
   * **살아 있는 지정가 주문을 cancelled 로 마킹**했다.
   */
  test('🔴 회귀 — 브로커에 살아 있는 주문이 "조회 실패" 때문에 취소로 둔갑하지 않는다', async () => {
    const { updates } = setupPool([row({ id: 7, exchange_order_id: 'LIVE-7' })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(allFailed());
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);

    await syncPendingOrders();
    expect(updates.map(u => u.sql).join('')).not.toMatch(/cancelled/);
  });

  test('미체결 조회가 실패해도 체결 조회가 성공하면 filled 는 정상 마킹된다 (증거 양성)', async () => {
    const { updates } = setupPool([row({ id: 3 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(allFailed());
    (getCompletedOrders as jest.Mock).mockResolvedValue([
      { orderId: 'O003', side: 'buy', price: 70000, qty: 1, ts: Date.now() },
    ]);

    const r = await syncPendingOrders();
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toMatch(/status='filled'/);
    expect(r.synced).toBe(1);
    expect(r.skipped).toBe(0);
  });

  test('getActiveOrdersDetailed 자체가 던져도 빈 목록으로 판정하지 않는다', async () => {
    const { updates } = setupPool([row({ id: 4 })]);
    (getActiveOrdersDetailed as jest.Mock).mockRejectedValue(new Error('unexpected'));
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);

    const r = await syncPendingOrders();
    expect(cancelledUpdates(updates)).toHaveLength(0);
    expect(r.complete).toBe(false);
  });
});

// ── ② 체결 조회 실패 ─────────────────────────────────────────────────────────

describe('🔴 체결(completed) 조회 실패는 취소 판정을 만들지 않는다', () => {
  test('미체결 조회는 성공했지만 체결 조회가 실패 → 보류, cancelled 없음', async () => {
    const { updates } = setupPool([row({ id: 5 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([{ orderId: 'OTHER', symbol: '005930' }]));
    (getCompletedOrders as jest.Mock).mockRejectedValue(RATE_LIMIT);

    const r = await syncPendingOrders();

    expect(cancelledUpdates(updates)).toHaveLength(0);
    expect(r.complete).toBe(false);
    expect(r.unreconciled[0].reason).toBe('completed_query_failed');
    expect(r.errors.join(' ')).toContain('completed_orders 005930');
  });

  /**
   * 예전 코드는 여기서 `errors[]` 에 넣고도 `completedOrderIds = new Set()` 로 두고
   * **마킹 루프로 그대로 진입**했다 — 다섯 겹 삼킴 위의 여섯 번째 삼킴.
   */
  test('🔴 회귀 — 체결 조회 실패가 errors[] 에 기록된 뒤 그대로 마킹 루프로 흘러가지 않는다', async () => {
    const { updates } = setupPool([row({ id: 6 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));   // 미체결 0건(정상)
    (getCompletedOrders as jest.Mock).mockRejectedValue(RATE_LIMIT);

    const r = await syncPendingOrders();
    expect(r.errors).toHaveLength(1);
    expect(updates).toHaveLength(0);
  });

  test('market 주문도 체결 조회 실패 시에는 판정하지 않는다', async () => {
    setupPool([row({ id: 8, type: 'market' })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockRejectedValue(RATE_LIMIT);

    const r = await syncPendingOrders();
    expect(r.complete).toBe(false);
    expect(r.unreconciled[0].reason).toBe('completed_query_failed');
  });

  test('두 조회 모두 실패하면 both_queries_failed 로 구분된다', async () => {
    setupPool([row({ id: 9 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(allFailed());
    (getCompletedOrders as jest.Mock).mockRejectedValue(RATE_LIMIT);

    const r = await syncPendingOrders();
    expect(r.unreconciled[0].reason).toBe('both_queries_failed');
  });
});

// ── ③ 성공 시 기능은 그대로 ──────────────────────────────────────────────────

describe('두 조회가 모두 성공하면 진짜 취소된 주문은 여전히 잡아낸다', () => {
  test('fail-closed 가 정상 취소 감지를 죽이지 않는다', async () => {
    const { updates } = setupPool([row({ id: 10, exchange_order_id: 'GONE' })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([{ orderId: 'OTHER', symbol: '005930' }]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([
      { orderId: 'OTHER2', side: 'buy', price: 1, qty: 1, ts: Date.now() },
    ]);

    const r = await syncPendingOrders();
    expect(cancelledUpdates(updates)).toHaveLength(1);
    expect(updates[0].params).toEqual([10]);
    expect(r.synced).toBe(1);
    expect(r.complete).toBe(true);
    expect(r.staleCount).toBe(0);
  });

  test('두 조회 모두 0건이어도(정상 응답) 취소 판정은 성립한다', async () => {
    const { updates } = setupPool([row({ id: 11 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);

    await syncPendingOrders();
    expect(cancelledUpdates(updates)).toHaveLength(1);
  });
});

// ── ④ 시장별 부분 성공 ───────────────────────────────────────────────────────

describe('완결성은 시장 단위 — 한 시장의 실패가 다른 시장을 멈추지 않는다', () => {
  test('해외만 실패 → 국내 주문은 계속 판정되고 해외 주문만 보류된다', async () => {
    const { updates } = setupPool([
      row({ id: 20, symbol: '005930',  exchange_order_id: 'D-GONE' }),
      row({ id: 21, symbol: 'NAS:AAPL', exchange_order_id: 'O-GONE' }),
    ]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(marketFailed('overseas', []));
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);

    const r = await syncPendingOrders();

    // 국내는 두 축이 모두 성립 → 취소 판정
    expect(cancelledUpdates(updates)).toHaveLength(1);
    expect(updates[0].params).toEqual([20]);
    // 해외는 자기 시장 조회가 실패 → 보류
    expect(r.skipped).toBe(1);
    expect(r.unreconciled[0].id).toBe(21);
    expect(r.unreconciled[0].market).toBe('overseas');
    expect(r.marketsOk).toEqual(['domestic']);
    expect(r.marketsFailed.map(f => f.market)).toEqual(['overseas']);
  });

  test('국내만 실패 → 해외 주문은 계속 판정되고 국내 주문만 보류된다', async () => {
    const { updates } = setupPool([
      row({ id: 22, symbol: '005930',   exchange_order_id: 'D-GONE' }),
      row({ id: 23, symbol: 'NAS:AAPL', exchange_order_id: 'O-GONE' }),
    ]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(marketFailed('domestic', []));
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);

    const r = await syncPendingOrders();
    expect(cancelledUpdates(updates)).toHaveLength(1);
    expect(updates[0].params).toEqual([23]);
    expect(r.unreconciled.map(u => u.id)).toEqual([22]);
  });

  test('🔴 커버리지 밖 거래소(NYS)는 조회가 성공해도 취소로 판정하지 않는다', async () => {
    const { updates } = setupPool([row({ id: 24, symbol: 'NYS:ORCL', exchange_order_id: 'NY-1' })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));   // 조회는 완전 성공
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);

    const r = await syncPendingOrders();

    expect(cancelledUpdates(updates)).toHaveLength(0);
    expect(r.unreconciled[0].reason).toBe('active_coverage_gap');
    expect(sendAlertThrottled).toHaveBeenCalledWith(
      'order-sync:coverage', 'warning', expect.any(String), expect.stringContaining('NYS:ORCL'), expect.any(Number),
    );
  });

  test('커버리지 밖이어도 체결 판정(filled)은 정상 동작한다', async () => {
    const { updates } = setupPool([row({ id: 25, symbol: 'NYS:ORCL', exchange_order_id: 'NY-2' })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([
      { orderId: 'NY-2', side: 'buy', price: 200, qty: 1, ts: Date.now() },
    ]);

    const r = await syncPendingOrders();
    expect(updates[0].sql).toMatch(/status='filled'/);
    expect(r.complete).toBe(true);
  });
});

// ── ⑤ T-017 스로틀 예외 = "모름" ────────────────────────────────────────────

describe('🔴 T-017 스로틀 예외는 "미체결 0건"이 아니라 "모름"이다', () => {
  const throttleErrors: Array<[string, Error]> = [
    ['KisThrottleTimeoutError',   new KisThrottleTimeoutError('normal', 30_000, 30_000, 'critical=0 normal=12 bulk=140')],
    ['KisThrottleQueueFullError', new KisThrottleQueueFullError('normal', 192)],
  ];

  test.each(throttleErrors)('%s — 미체결 조회 경로에서 취소 판정을 만들지 않는다', async (_name, err) => {
    const { updates } = setupPool([row({ id: 30 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue({
      orders: [], ok: ['overseas'], failed: [{ market: 'domestic', error: err.message }], complete: false,
    });
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);

    const r = await syncPendingOrders();
    expect(cancelledUpdates(updates)).toHaveLength(0);
    expect(r.complete).toBe(false);
    expect(r.unreconciled[0].reason).toBe('active_query_failed');
    expect(r.unreconciled[0].detail).toContain(err.name === 'KisThrottleTimeoutError' ? '대기 시간 초과' : '대기열 초과');
  });

  test.each(throttleErrors)('%s — 체결 조회 경로에서 취소 판정을 만들지 않는다', async (_name, err) => {
    const { updates } = setupPool([row({ id: 31 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockRejectedValue(err);

    const r = await syncPendingOrders();
    expect(cancelledUpdates(updates)).toHaveLength(0);
    expect(r.unreconciled[0].reason).toBe('completed_query_failed');
    expect(r.errors.join(' ')).toContain('KIS 요청');
  });
});

// ── ⑥ §역방향 위험 — 보류가 조용해지지 않는다 ────────────────────────────────

describe('§역방향 위험 — 판정 보류가 영원히 조용하지 않다', () => {
  test('보류가 임계를 넘으면 critical 알림이 (스로틀되어) 나간다', async () => {
    setupPool([row({ id: 40 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(allFailed());
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);

    const t0 = Date.parse('2026-08-11T02:00:00+09:00');
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(t0);

    // 1회차 — 아직 임계 미만이면 알림 없음
    const first = await syncPendingOrders();
    expect(first.staleCount).toBe(0);
    expect(sendAlertThrottled).not.toHaveBeenCalledWith('order-sync:stale', expect.anything(), expect.anything(), expect.anything(), expect.anything());

    // 31분 뒤 — 같은 주문이 계속 판정되지 않은 상태
    nowSpy.mockReturnValue(t0 + 31 * 60_000);
    const later = await syncPendingOrders();

    expect(later.oldestUnreconciledMs).toBe(31 * 60_000);
    expect(later.staleCount).toBe(1);
    expect(sendAlertThrottled).toHaveBeenCalledWith(
      'order-sync:stale', 'critical', expect.any(String), expect.stringContaining('005930#40'), expect.any(Number),
    );
  });

  test('중간에 한 번이라도 판정되면 미판정 시계가 리셋된다 (주문 나이가 아니라 미판정 기간을 잰다)', async () => {
    setupPool([row({ id: 41 })]);
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);

    const t0 = Date.parse('2026-08-11T02:00:00+09:00');
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(t0);

    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(allFailed());
    await syncPendingOrders();                                   // 보류 시작

    // 20분 뒤 조회 성공 → 살아 있음이 확인됨 = 판정됨
    nowSpy.mockReturnValue(t0 + 20 * 60_000);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([{ orderId: 'O041', symbol: '005930' }]));
    const ok = await syncPendingOrders();
    expect(ok.complete).toBe(true);

    // 다시 40분 뒤 실패 → 시계는 이 시점부터 다시 시작하므로 0분
    nowSpy.mockReturnValue(t0 + 60 * 60_000);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(allFailed());
    const again = await syncPendingOrders();
    expect(again.oldestUnreconciledMs).toBe(0);
    expect(again.staleCount).toBe(0);
  });

  test('"판정 못 함"과 "판정할 게 없음"이 반환값에서 구분된다', async () => {
    // 판정할 게 없음
    setupPool([]);
    const nothing = await syncPendingOrders();
    expect(nothing).toMatchObject({ complete: true, skipped: 0, synced: 0 });
    expect(nothing.unreconciled).toEqual([]);

    // 판정 못 함 — synced=0 은 같지만 complete/skipped 가 다르다
    setupPool([row({ id: 42 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(allFailed());
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);
    const cannot = await syncPendingOrders();
    expect(cannot.synced).toBe(0);
    expect(cannot).toMatchObject({ complete: false, skipped: 1 });
  });

  test('보류는 grep 가능한 토큰으로 매 회차 로그에 남는다', async () => {
    setupPool([row({ id: 43 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(allFailed());
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);

    await syncPendingOrders();
    const logged = (console.warn as jest.Mock).mock.calls.flat().join(' ');
    expect(logged).toContain('ORDER_SYNC_UNRECONCILED');
  });

  test('🔴 유예 중인 주문은 정체 시계를 시작하지 않는다', async () => {
    const t0 = Date.parse('2026-08-11T02:00:00+09:00');
    setupPool([row({ id: 45, created_at: new Date(t0) })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);

    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(t0 + 30_000);
    const a = await syncPendingOrders();
    expect(a.unreconciled[0].reason).toBe('too_fresh');
    expect(a.unreconciled[0].unreconciledForMs).toBe(0);

    nowSpy.mockReturnValue(t0 + 90_000);           // 여전히 유예 중
    const b = await syncPendingOrders();
    expect(b.unreconciled[0].reason).toBe('too_fresh');
    expect(b.oldestUnreconciledMs).toBe(0);        // 시계가 돌지 않았다
    expect(b.staleCount).toBe(0);
  });

  test('too_fresh 만 있는 회차는 complete=true 이고 경고 토큰을 찍지 않는다', async () => {
    const t0 = Date.parse('2026-08-11T02:00:00+09:00');
    setupPool([row({ id: 46, created_at: new Date(t0) })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);
    jest.spyOn(Date, 'now').mockReturnValue(t0 + 10_000);

    const r = await syncPendingOrders();
    expect(r.complete).toBe(true);        // 판정 실패가 아니라 의도된 대기
    expect(r.skipped).toBe(1);            // 그래도 보류로는 보인다
    const logged = (console.warn as jest.Mock).mock.calls.flat().join(' ');
    expect(logged).not.toContain('ORDER_SYNC_UNRECONCILED');
  });

  test('주문이 더 이상 미결이 아니면 추적 항목이 정리된다', async () => {
    setupPool([row({ id: 44 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(allFailed());
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);

    const t0 = Date.parse('2026-08-11T02:00:00+09:00');
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(t0);
    await syncPendingOrders();

    // 주문이 체결·취소되어 pending 목록에서 사라진 회차
    setupPool([]);
    nowSpy.mockReturnValue(t0 + 10 * 60_000);
    await syncPendingOrders();

    // 같은 id 가 다시 미결로 나타나면 시계는 새로 시작한다
    setupPool([row({ id: 44 })]);
    nowSpy.mockReturnValue(t0 + 90 * 60_000);
    const r = await syncPendingOrders();
    expect(r.oldestUnreconciledMs).toBe(0);
  });
});

// ── ⑦ reviewer HIGH-1 — 갓 접수된 주문은 취소 판정 대상이 아니다 ─────────────

/**
 * 운영 실측 사고 (2026-05-26): 주문 #3137(`NAS:SNDK` 매도 지정가, 수량 1)이
 * `23:21:59` 생성 → `23:22:05` **6초 뒤** `cancelled` 마킹. 이어 #3138 이 같은 종목·방향·수량으로
 * `23:41:03` 생성되어 체결됐다. #3137 이 브로커에 살아 있었다면 **이중 매도**다.
 *
 * 이 케이스는 "조회가 실패한" 것이 아니라 **"조회가 성공했는데 아직 불완전했던"** 것이라,
 * §①~⑥ 의 fail-closed 만으로는 막히지 않는다.
 */
describe('🔴 HIGH-1 유예 기간 — 조회 성공 + 목록 미반영 조합', () => {
  const t0 = Date.parse('2026-05-26T23:21:59+09:00');

  test('생성 6초 뒤(실측 사고 시점)에는 취소 판정하지 않는다', async () => {
    const { updates } = setupPool([row({
      id: 3137, symbol: 'NAS:SNDK', exchange_order_id: '0030357043', created_at: new Date(t0),
    })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));   // 아직 목록에 없다
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);
    jest.spyOn(Date, 'now').mockReturnValue(t0 + 6_000);

    const r = await syncPendingOrders();
    expect(cancelledUpdates(updates)).toHaveLength(0);
    expect(r.unreconciled[0].reason).toBe('too_fresh');
    expect(r.unreconciled[0].detail).toContain('유예');
  });

  test('유예가 지나면 정상적으로 취소 판정된다 (판정을 없애는 게 아니라 미루는 것)', async () => {
    const { updates } = setupPool([row({ id: 50, created_at: new Date(t0) })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);
    jest.spyOn(Date, 'now').mockReturnValue(t0 + 121_000);

    const r = await syncPendingOrders();
    expect(cancelledUpdates(updates)).toHaveLength(1);
    expect(r.complete).toBe(true);
  });

  test('갓 접수됐어도 미체결 목록에 보이면 유예가 아니라 정상 판정이다 (양성 증거 우선)', async () => {
    setupPool([row({ id: 51, exchange_order_id: 'LIVE', created_at: new Date(t0) })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([{ orderId: 'LIVE', symbol: '005930' }]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);
    jest.spyOn(Date, 'now').mockReturnValue(t0 + 5_000);

    const r = await syncPendingOrders();
    expect(r.skipped).toBe(0);
    expect(r.complete).toBe(true);
  });

  test('체결 판정은 유예하지 않는다 — 시장가는 수 초 안에 체결된다', async () => {
    const { updates } = setupPool([row({ id: 52, type: 'market', created_at: new Date(t0) })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([
      { orderId: 'O052', side: 'buy', price: 100, qty: 1, ts: t0 + 1000 },
    ]);
    jest.spyOn(Date, 'now').mockReturnValue(t0 + 3_000);

    await syncPendingOrders();
    expect(updates[0].sql).toMatch(/status='filled'/);
  });

  describe('유예 시간은 재배포 없이 조정할 수 있다', () => {
    const origEnv = process.env.ORDER_SYNC_CANCEL_GRACE_SEC;
    afterEach(() => {
      if (origEnv === undefined) delete process.env.ORDER_SYNC_CANCEL_GRACE_SEC;
      else process.env.ORDER_SYNC_CANCEL_GRACE_SEC = origEnv;
    });

    test('system_config 값이 최우선', async () => {
      const { updates } = setupPool([row({ id: 53, created_at: new Date(t0) })], { graceConfigSec: 600 });
      (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
      (getCompletedOrders as jest.Mock).mockResolvedValue([]);
      // 기본값 120초라면 판정됐을 시점 — config 600초 때문에 아직 유예 중이어야 한다
      jest.spyOn(Date, 'now').mockReturnValue(t0 + 300_000);

      const r = await syncPendingOrders();
      expect(cancelledUpdates(updates)).toHaveLength(0);
      expect(r.unreconciled[0].reason).toBe('too_fresh');
    });

    test('system_config 가 없으면 env 를 쓴다', async () => {
      process.env.ORDER_SYNC_CANCEL_GRACE_SEC = '600';
      const { updates } = setupPool([row({ id: 54, created_at: new Date(t0) })]);
      (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
      (getCompletedOrders as jest.Mock).mockResolvedValue([]);
      jest.spyOn(Date, 'now').mockReturnValue(t0 + 300_000);

      const r = await syncPendingOrders();
      expect(cancelledUpdates(updates)).toHaveLength(0);
      expect(r.unreconciled[0].reason).toBe('too_fresh');
    });

    test('🔴 하한 아래로는 내려가지 않는다 — 보호를 설정으로 끌 수 없다', async () => {
      const { updates } = setupPool([row({ id: 55, created_at: new Date(t0) })], { graceConfigSec: 1 });
      (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
      (getCompletedOrders as jest.Mock).mockResolvedValue([]);
      // 1초 설정이 그대로 먹혔다면 6초 시점에 취소됐을 것 — 하한 30초가 막아야 한다
      jest.spyOn(Date, 'now').mockReturnValue(t0 + 6_000);

      const r = await syncPendingOrders();
      expect(cancelledUpdates(updates)).toHaveLength(0);
      expect(r.unreconciled[0].reason).toBe('too_fresh');
    });
  });

  test('clampGraceSec — 하한·상한·이상값', () => {
    expect(clampGraceSec(1)).toBe(30);
    expect(clampGraceSec(99_999)).toBe(3600);
    expect(clampGraceSec(0)).toBe(DEFAULT_CANCEL_GRACE_SEC);
    expect(clampGraceSec(Number.NaN)).toBe(DEFAULT_CANCEL_GRACE_SEC);
    expect(clampGraceSec(300)).toBe(300);
  });
});

// ── ⑧ reviewer HIGH-3 — 부분체결을 완결로 기록하지 않는다 ────────────────────

describe('🔴 HIGH-3 부분체결 — 두 목록에 동시에 있으면 아직 잔량이 있다', () => {
  test('active·completed 양쪽에 있으면 partially_filled 로 기록한다', async () => {
    const { updates } = setupPool([row({ id: 60, exchange_order_id: 'P1', quantity: 10 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([{ orderId: 'P1', symbol: '005930' }]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([
      { orderId: 'P1', side: 'buy', price: 70000, qty: 4, ts: Date.now() },
    ]);

    const r = await syncPendingOrders();
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toMatch(/status='partially_filled'/);
    expect(r.synced).toBe(1);
  });

  test('🔴 회귀 — 같은 조합이 filled 로 기록되지 않는다 (포지션 종결 오인)', async () => {
    const { updates } = setupPool([row({ id: 61, exchange_order_id: 'P2', quantity: 10 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([{ orderId: 'P2', symbol: '005930' }]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([
      { orderId: 'P2', side: 'buy', price: 70000, qty: 4, ts: Date.now() },
    ]);

    await syncPendingOrders();
    expect(updates.map(u => u.sql).join('')).not.toMatch(/status='filled'/);
  });

  test('이미 partially_filled 면 다시 쓰지 않는다 (synced 부풀리기 방지)', async () => {
    const { updates } = setupPool([row({
      id: 62, exchange_order_id: 'P3', quantity: 10, status: 'partially_filled',
    })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([{ orderId: 'P3', symbol: '005930' }]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([
      { orderId: 'P3', side: 'buy', price: 70000, qty: 4, ts: Date.now() },
    ]);

    const r = await syncPendingOrders();
    expect(updates).toHaveLength(0);
    expect(r.synced).toBe(0);
    expect(r.complete).toBe(true);     // 판정은 됐다 — 변경이 없었을 뿐
  });

  test('🔴 잔량이 사라진 다음 회차에 partially_filled → filled 로 마무리된다', async () => {
    const { updates } = setupPool([row({
      id: 63, exchange_order_id: 'P4', quantity: 10, status: 'partially_filled',
    })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));   // 잔량 없음
    (getCompletedOrders as jest.Mock).mockResolvedValue([
      { orderId: 'P4', side: 'buy', price: 70000, qty: 10, ts: Date.now() },
    ]);

    const r = await syncPendingOrders();
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toMatch(/status='filled'/);
    expect(updates[0].params).toEqual([63]);
    expect(r.synced).toBe(1);
  });

  test('미체결 목록을 못 믿을 때 — 체결수량 < 주문수량이면 partially_filled', async () => {
    const { updates } = setupPool([row({ id: 64, exchange_order_id: 'P5', quantity: 10 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(allFailed());
    (getCompletedOrders as jest.Mock).mockResolvedValue([
      { orderId: 'P5', side: 'buy', price: 70000, qty: 4, ts: Date.now() },
    ]);

    await syncPendingOrders();
    expect(updates[0].sql).toMatch(/status='partially_filled'/);
  });

  test('미체결 목록을 못 믿어도 체결수량 ≥ 주문수량이면 filled (수량이 양성 증거)', async () => {
    const { updates } = setupPool([row({ id: 65, exchange_order_id: 'P6', quantity: 10 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(allFailed());
    (getCompletedOrders as jest.Mock).mockResolvedValue([
      { orderId: 'P6', side: 'buy', price: 70000, qty: 10, ts: Date.now() },
    ]);

    await syncPendingOrders();
    expect(updates[0].sql).toMatch(/status='filled'/);
  });

  test('커버리지 밖(NYS) 전량 체결도 수량 근거로 filled 까지 도달한다 (영구 정체 방지)', async () => {
    const { updates } = setupPool([row({
      id: 66, symbol: 'NYS:ORCL', exchange_order_id: 'P7', quantity: 3,
    })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([
      { orderId: 'P7', side: 'sell', price: 200, qty: 3, ts: Date.now() },
    ]);

    await syncPendingOrders();
    expect(updates[0].sql).toMatch(/status='filled'/);
  });

  test('누적 수량 응답을 여러 행으로 받아도 합산 과대평가하지 않는다', async () => {
    const { updates } = setupPool([row({ id: 67, exchange_order_id: 'P8', quantity: 10 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(allFailed());
    // KIS 국내 tot_ccld_qty 는 누적값 — 합치면 12 가 되어 filled 로 오판할 수 있다
    (getCompletedOrders as jest.Mock).mockResolvedValue([
      { orderId: 'P8', side: 'buy', price: 70000, qty: 4, ts: Date.now() },
      { orderId: 'P8', side: 'buy', price: 70000, qty: 8, ts: Date.now() },
    ]);

    await syncPendingOrders();
    expect(updates[0].sql).toMatch(/status='partially_filled'/);
  });

  test('수량이 NULL 이면 완결을 단정하지 않는다', async () => {
    const { updates } = setupPool([row({ id: 68, exchange_order_id: 'P9', quantity: null })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(allFailed());
    (getCompletedOrders as jest.Mock).mockResolvedValue([
      { orderId: 'P9', side: 'buy', price: 70000, qty: 4, ts: Date.now() },
    ]);

    await syncPendingOrders();
    expect(updates[0].sql).toMatch(/status='partially_filled'/);
  });

  test('market 주문은 미체결 목록과 무관하게 filled (그 목록에 원래 없다)', async () => {
    const { updates } = setupPool([row({ id: 69, type: 'market', exchange_order_id: 'M1', quantity: 5 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(allFailed());
    (getCompletedOrders as jest.Mock).mockResolvedValue([
      { orderId: 'M1', side: 'buy', price: 70000, qty: 5, ts: Date.now() },
    ]);

    await syncPendingOrders();
    expect(updates[0].sql).toMatch(/status='filled'/);
  });
});

// ── ⑨ reviewer H-4 — 소수점 수량 주문이 영원히 갇히지 않는다 ─────────────────

/**
 * ## 결함
 *
 * `orders.quantity` 는 **자르지 않은** 요청 원본(예: `1.7`)이고, KIS 해외 주문은
 * `Math.floor` 된 값(`1`)으로 나간다. 완결 판정이 DB 원본과 비교하면 브로커가 채울 수 있는
 * 최대치(`1`)가 주문 수량(`1.7`)에 영원히 못 미쳐 **부등식이 결코 성립하지 않는다.**
 * 전량 체결된 주문이 `partially_filled` 에 갇혀 5분마다 KIS 조회를 영원히 소모한다.
 *
 * ## 현재 노출도 (2026-08-11 실측)
 *
 * **한 번도 발화한 적 없다.** 소수점 수량 주문 79건은 전부 `rejected`(70)/`blocked`(9) 로
 * 브로커에 도달한 적이 없어 `exchange_order_id` 가 없고, order-sync 대상이 된 적이 없다.
 * 현재 order-sync 대상은 0건. [[T-017]] 이 이 제출들을 억누르던 레이트리밋 거절을 없앴기
 * 때문에 **앞으로** 도달하게 된다 — 활성 사고가 아니라 T-017 이 연 잠재 위험이다.
 */
describe('🔴 H-4 소수점 수량 — DB 원본이 아니라 실제 송신 수량과 비교한다', () => {
  test('해외 1.7주 주문이 1주 전량 체결되면 filled 에 도달한다', async () => {
    const { updates } = setupPool([row({
      id: 70, symbol: 'NAS:AAPL', exchange_order_id: 'FQ1', quantity: 1.7,
    })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(allFailed());   // 잔량 확인 불가
    (getCompletedOrders as jest.Mock).mockResolvedValue([
      { orderId: 'FQ1', side: 'buy', price: 200, qty: 1, ts: Date.now() },
    ]);

    await syncPendingOrders();
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toMatch(/status='filled'/);
  });

  test('🔴 회귀 — 1.7 과 비교해 partially_filled 에 갇히지 않는다', async () => {
    const { updates } = setupPool([row({
      id: 71, symbol: 'NYS:ORCL', exchange_order_id: 'FQ2', quantity: 2.9,
    })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));    // 커버리지 밖
    (getCompletedOrders as jest.Mock).mockResolvedValue([
      { orderId: 'FQ2', side: 'sell', price: 200, qty: 2, ts: Date.now() },  // floor(2.9)=2 전량
    ]);

    await syncPendingOrders();
    expect(updates.map(u => u.sql).join('')).not.toMatch(/partially_filled/);
    expect(updates[0].sql).toMatch(/status='filled'/);
  });

  test('진짜 부분체결은 여전히 partially_filled 다 (자르기가 판정을 무르게 하지 않는다)', async () => {
    const { updates } = setupPool([row({
      id: 72, symbol: 'NAS:AAPL', exchange_order_id: 'FQ3', quantity: 5.4,
    })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(allFailed());
    (getCompletedOrders as jest.Mock).mockResolvedValue([
      { orderId: 'FQ3', side: 'buy', price: 200, qty: 2, ts: Date.now() },   // floor(5.4)=5 중 2주
    ]);

    await syncPendingOrders();
    expect(updates[0].sql).toMatch(/status='partially_filled'/);
  });

  test('국내는 자르지 않는다 — 기존 송신 동작과 동일하게 유지', () => {
    expect(submittedQuantity('domestic', 1.7)).toBe(1.7);
    expect(submittedQuantity('overseas', 1.7)).toBe(1);
    expect(submittedQuantity('overseas', 0.4)).toBe(0);   // 1주도 못 사는 주문
    expect(submittedQuantity('overseas', Number.NaN)).toBe(0);
    expect(submittedQuantity('overseas', -3)).toBe(0);
  });

  test('floor 결과가 0이면 완결로 단정하지 않는다', async () => {
    const { updates } = setupPool([row({
      id: 73, symbol: 'NAS:AAPL', exchange_order_id: 'FQ4', quantity: 0.4,
    })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(allFailed());
    (getCompletedOrders as jest.Mock).mockResolvedValue([
      { orderId: 'FQ4', side: 'buy', price: 200, qty: 0, ts: Date.now() },
    ]);

    await syncPendingOrders();
    expect(updates[0].sql).toMatch(/status='partially_filled'/);
  });
});

// ── ⑩ reviewer H-4(B) — 확인 불가능한 부분체결이 조용히 갇히지 않는다 ────────

describe('🔴 H-4(B) 확인 불가능한 부분체결은 6시간 warning 으로 드러난다', () => {
  const t0 = Date.parse('2026-08-11T02:00:00+09:00');

  /** 커버리지 밖 + 진짜 부분체결 = 잔량 존재 여부를 구조적으로 확인할 수 없다 */
  const setupUnconfirmable = (id: number) => {
    const r = setupPool([row({
      id, symbol: 'NYS:ORCL', exchange_order_id: `U${id}`, quantity: 10, status: 'partially_filled',
    })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([
      { orderId: `U${id}`, side: 'sell', price: 200, qty: 4, ts: t0 },
    ]);
    return r;
  };

  test('임계 이전에는 알리지 않는다 (잔량이 곧 체결될 수 있는 정상 상황)', async () => {
    setupUnconfirmable(80);
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(t0);

    const first = await syncPendingOrders();
    expect(first.unreconciled).toEqual([]);
    expect(first.complete).toBe(true);

    nowSpy.mockReturnValue(t0 + 10 * 60_000);      // 10분 — 아직 임계 미만
    const second = await syncPendingOrders();
    expect(second.unreconciled).toEqual([]);
    expect(sendAlertThrottled).not.toHaveBeenCalledWith(
      'order-sync:partial-unconfirmed', expect.anything(), expect.anything(), expect.anything(), expect.anything(),
    );
  });

  test('임계를 넘으면 partial_fill_unconfirmable 로 승격되어 warning 이 나간다', async () => {
    setupUnconfirmable(81);
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(t0);
    await syncPendingOrders();

    nowSpy.mockReturnValue(t0 + 31 * 60_000);
    const r = await syncPendingOrders();

    expect(r.unreconciled).toHaveLength(1);
    expect(r.unreconciled[0].reason).toBe('partial_fill_unconfirmable');
    expect(r.unreconciled[0].unreconciledForMs).toBe(31 * 60_000);
    expect(sendAlertThrottled).toHaveBeenCalledWith(
      'order-sync:partial-unconfirmed',
      'warning',                                    // critical 이 아니다
      expect.any(String),
      expect.stringContaining('NYS:ORCL#81'),
      6 * 60 * 60_000,                              // 6시간 창
    );
  });

  test('정상 상황임을 알 수 있게 문구가 쓰여 있다 (오류 통보가 아니다)', async () => {
    setupUnconfirmable(82);
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(t0);
    await syncPendingOrders();
    nowSpy.mockReturnValue(t0 + 31 * 60_000);
    await syncPendingOrders();

    const body = (sendAlertThrottled as jest.Mock).mock.calls
      .find(c => c[0] === 'order-sync:partial-unconfirmed')![3] as string;
    expect(body).toContain('장 마감');
    expect(body).toContain('정상');
    expect(body).toContain('조치는 필요 없습니다');
  });

  test('🔴 잔량이 살아 있는 정상 부분체결은 승격되지 않는다', async () => {
    setupPool([row({
      id: 83, exchange_order_id: 'LIVE-REM', quantity: 10, status: 'partially_filled',
    })]);
    // 국내 + 미체결 목록에 잔량이 보인다 = 확인 가능한 정상 부분체결
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([{ orderId: 'LIVE-REM', symbol: '005930' }]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([
      { orderId: 'LIVE-REM', side: 'buy', price: 70000, qty: 4, ts: t0 },
    ]);

    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(t0);
    await syncPendingOrders();
    nowSpy.mockReturnValue(t0 + 10 * 60 * 60_000);   // 10시간 뒤에도
    const r = await syncPendingOrders();

    expect(r.unreconciled).toEqual([]);
    expect(r.complete).toBe(true);
    expect(sendAlertThrottled).not.toHaveBeenCalledWith(
      'order-sync:partial-unconfirmed', expect.anything(), expect.anything(), expect.anything(), expect.anything(),
    );
  });

  test('30분 critical 채널로는 가지 않는다 (재시도로 낫지 않는 것을 재시도 주기로 알리지 않는다)', async () => {
    setupUnconfirmable(84);
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(t0);
    await syncPendingOrders();
    nowSpy.mockReturnValue(t0 + 31 * 60_000);
    await syncPendingOrders();

    expect(sendAlertThrottled).not.toHaveBeenCalledWith(
      'order-sync:stale', expect.anything(), expect.anything(), expect.anything(), expect.anything(),
    );
  });

  test('확인이 가능해지면 시계가 풀리고 filled 로 마무리된다', async () => {
    const { updates } = setupUnconfirmable(85);
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(t0);
    await syncPendingOrders();

    // 잔량까지 체결되어 수량 근거가 완성된 회차
    nowSpy.mockReturnValue(t0 + 31 * 60_000);
    (getCompletedOrders as jest.Mock).mockResolvedValue([
      { orderId: 'U85', side: 'sell', price: 200, qty: 10, ts: t0 },
    ]);
    const r = await syncPendingOrders();

    expect(updates[updates.length - 1].sql).toMatch(/status='filled'/);
    expect(r.unreconciled).toEqual([]);
    expect(r.complete).toBe(true);
  });
});

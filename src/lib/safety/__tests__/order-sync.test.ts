import { getPool } from '@/lib/db';
import { getActiveOrdersDetailed, getCompletedOrders } from '@/lib/exchanges/kis';
import { syncPendingOrders, resetUnreconciledTracker } from '../order-sync';
import { getStaleTracking, markEscalated, recordFirstStale, clearResolved } from '../order-sync-escalation';
import { sendAlertThrottled } from '@/lib/notify/throttle';

jest.mock('@/lib/db', () => ({
  getPool: jest.fn(),
}));

jest.mock('@/lib/exchanges/kis', () => ({
  getActiveOrdersDetailed: jest.fn(),
  getCompletedOrders: jest.fn(),
  overseasActiveOrderExchanges: jest.fn(() => ['NAS']),
}));

jest.mock('@/lib/notify/throttle', () => ({
  sendAlertThrottled: jest.fn(() => true),
  resetAlertThrottle: jest.fn(),
}));

jest.mock('../order-sync-escalation', () => ({
  STRUCTURAL_MS: 2 * 60 * 60_000,
  getStaleTracking: jest.fn(async () => new Map()),
  recordFirstStale: jest.fn(async () => {}),
  markEscalated: jest.fn(async () => {}),
  clearResolved: jest.fn(async () => {}),
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

/** 유예 기간(기본 120초)을 이미 지난 주문 — 취소 판정 대상이 되려면 필요하다 */
const AGED = () => new Date(Date.now() - 10 * 60_000);

function setupPool(rows: PendingRow[]) {
  const updates: Array<{ sql: string; params: unknown[] }> = [];
  const query = jest.fn(async (sqlArg: unknown, paramsArg: unknown[] = []) => {
    const sql = String(sqlArg);
    const params = paramsArg ?? [];
    if (/SELECT[\s\S]*FROM orders/i.test(sql)) {
      return [rows];
    }
    if (/UPDATE orders/i.test(sql)) {
      updates.push({ sql, params });
      // T-071 R-03 — 상태 쓰기가 조건부(CAS)라 affectedRows 로 성공을 판정한다
      return [{ affectedRows: 1 }];
    }
    return [[]];
  });
  (getPool as jest.Mock).mockReturnValue({ query });
  return { updates };
}

/** 양 시장 모두 조회 성공 — 부재 추론을 해도 되는 상태 */
const activeOk = (orders: { orderId: string; symbol: string }[]) => ({
  orders, ok: ['domestic', 'overseas'], failed: [], complete: true,
});

describe('syncPendingOrders', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetUnreconciledTracker();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { jest.restoreAllMocks(); });

  test('active에 있음 → 변경 없음 (limit 미체결)', async () => {
    const rows: PendingRow[] = [{
      id: 1, exchange_order_id: 'O001', symbol: '005930', type: 'limit',
      status: 'accepted', quantity: 1, created_at: AGED(),
    }];
    const { updates } = setupPool(rows);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(activeOk([{ orderId: 'O001', symbol: '005930' }]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);

    const r = await syncPendingOrders();
    expect(r.synced).toBe(0);
    expect(updates).toHaveLength(0);
    // 변경이 없는 것과 판정하지 못한 것은 다르다 — 이건 정상 판정된 결과다.
    expect(r.complete).toBe(true);
    expect(r.skipped).toBe(0);
  });

  test('completed에 있음 → filled로 마킹', async () => {
    const rows: PendingRow[] = [{
      id: 2, exchange_order_id: 'O002', symbol: '005930', type: 'limit',
      status: 'accepted', quantity: 1, created_at: AGED(),
    }];
    const { updates } = setupPool(rows);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(activeOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([
      { orderId: 'O002', side: 'buy', price: 75000, qty: 1, ts: Date.now() },
    ]);

    const r = await syncPendingOrders();
    expect(r.synced).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toMatch(/SET status='filled'/);
    expect(updates[0].params).toEqual([2, 'accepted']);   // T-071 R-03 — CAS: 읽은 상태도 함께 넘긴다
  });

  test('active·completed 모두 없음 + limit → cancelled 마킹', async () => {
    const rows: PendingRow[] = [{
      id: 3, exchange_order_id: 'O003', symbol: '005930', type: 'limit',
      status: 'accepted', quantity: 1, created_at: AGED(),
    }];
    const { updates } = setupPool(rows);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(activeOk([{ orderId: 'OTHER', symbol: '005930' }]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([
      { orderId: 'OTHER2', side: 'buy', price: 1000, qty: 1, ts: Date.now() },
    ]);

    const r = await syncPendingOrders();
    expect(r.synced).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toMatch(/SET status='cancelled'/);
    expect(updates[0].params).toEqual([3, 'accepted']);   // T-071 R-03 — CAS: 읽은 상태도 함께 넘긴다
    expect(r.complete).toBe(true);
  });

  test('market 주문은 active 없어도 cancelled 마킹 안 함 (체결 대기)', async () => {
    const rows: PendingRow[] = [{
      id: 4, exchange_order_id: 'O004', symbol: '005930', type: 'market',
      status: 'accepted', quantity: 1, created_at: AGED(),
    }];
    const { updates } = setupPool(rows);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(activeOk([{ orderId: 'OTHER', symbol: '005930' }]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);

    const r = await syncPendingOrders();
    expect(r.synced).toBe(0);
    expect(updates).toHaveLength(0);
    // 조회가 성공했으므로 "아직 체결 전"은 **판정된** 상태다 — 보류가 아니다.
    expect(r.complete).toBe(true);
    expect(r.skipped).toBe(0);
  });

  test('미결 주문이 없으면 KIS를 조회하지 않고 "할 일 없음"을 반환', async () => {
    setupPool([]);
    const r = await syncPendingOrders();
    expect(getActiveOrdersDetailed).not.toHaveBeenCalled();
    expect(r).toMatchObject({ synced: 0, skipped: 0, complete: true, staleCount: 0 });
    expect(r.unreconciled).toEqual([]);
  });
});

describe('reportUnreconciled 에스컬레이션', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetUnreconciledTracker();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  // 아래 4건 모두 §역방향 위험 테스트(order-sync-fail-closed.test.ts)와 같은 2-회차 패턴을
  // 쓴다 — `unreconciledForMs`는 `order.created_at`이 아니라 **프로세스 메모리
  // `unreconciledSince`가 처음 그 주문을 본 시각**을 기준으로 잰다(order-sync.ts의
  // `track()` 참고). 즉 같은 주문이라도 그 회차에 **처음** 걸리면 무조건 0분이므로, 30분
  // 게이트를 넘기려면 최소 두 회차(첫 회차로 시계 시작 → 시간 이동 후 재호출)가 필요하다.
  // 한 회차만 호출하고 `created_at`만 과거로 돌리는 것으로는 이 게이트를 통과할 수 없다.

  test('30분 넘었지만 2시간 미만이면 기존처럼 반복 critical 알림만 나간다', async () => {
    const rows: PendingRow[] = [{
      id: 1, exchange_order_id: 'O001', symbol: '005930', type: 'limit',
      status: 'accepted', quantity: 1, created_at: AGED(),
    }];
    setupPool(rows);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue({
      orders: [], ok: [], failed: [{ market: 'domestic', error: 'timeout' }], complete: false,
    });
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);

    const t0 = Date.parse('2026-08-11T02:00:00+09:00');
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(t0);
    await syncPendingOrders(); // 1회차 — 미판정 시계 시작, 아직 30분 미만이라 알림 없음
    expect(sendAlertThrottled).not.toHaveBeenCalledWith(
      'order-sync:stale', expect.anything(), expect.anything(), expect.anything(), expect.anything(),
    );

    nowSpy.mockReturnValue(t0 + 35 * 60_000); // 35분 뒤 — 30분은 넘었지만 2시간 미만
    await syncPendingOrders();

    expect(sendAlertThrottled).toHaveBeenCalledWith(
      'order-sync:stale', 'critical', expect.any(String), expect.any(String), expect.any(Number),
    );
    // Fix4(I4) — 인자 검증: recordFirstStale에 넘어가는 시각은 지금(t0+35분)이 아니라
    // 역산한 최초 미판정 시각(t0)이어야 한다 — `now - u.unreconciledForMs`.
    expect(recordFirstStale).toHaveBeenCalledWith(1, '005930', t0);
    expect(markEscalated).not.toHaveBeenCalled();
    nowSpy.mockRestore();
  });

  test('2시간 넘으면 구조적 알림 1회 + escalated 마킹 + 반복알림 대상에서 제외', async () => {
    const rows: PendingRow[] = [{
      id: 2, exchange_order_id: 'O002', symbol: '000660', type: 'limit',
      status: 'accepted', quantity: 1, created_at: AGED(),
    }];
    setupPool(rows);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue({
      orders: [], ok: [], failed: [{ market: 'domestic', error: 'timeout' }], complete: false,
    });
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);

    const t0 = Date.parse('2026-08-11T02:00:00+09:00');
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(t0);
    await syncPendingOrders(); // 1회차 — 미판정 시계 시작(t0)

    const t1 = t0 + 2 * 60 * 60_000 + 5 * 60_000; // 2시간 5분 뒤 — 구조적 임계 초과
    nowSpy.mockReturnValue(t1);
    (getStaleTracking as jest.Mock).mockResolvedValue(new Map([
      [2, { orderId: 2, symbol: '000660', firstStaleAt: t0, escalatedAt: null }],
    ]));

    await syncPendingOrders();

    // Fix2(I2) — 키가 주문별로 나뉜다 (`:2` 접미사) — 고정 키였다면 같은 날 두 번째로
    // 넘는 주문의 알림이 24시간 창 안에서 조용히 삼켜졌을 것이다.
    expect(sendAlertThrottled).toHaveBeenCalledWith(
      'order-sync:stale-structural:2', 'critical', expect.any(String), expect.stringContaining('2.1시간'), expect.any(Number),
    );
    // Fix2 bundled M4 — 메시지가 고정 임계값(2시간)이 아니라 실제 경과 시간(2.1시간)을 보여준다.
    expect(markEscalated).toHaveBeenCalledWith(2, t1);
    expect(sendAlertThrottled).not.toHaveBeenCalledWith(
      'order-sync:stale', 'critical', expect.any(String), expect.any(String), expect.any(Number),
    );
    nowSpy.mockRestore();
  });

  test('이미 escalated된 주문이 남아 있으면 반복 alert 대상에서 계속 제외된다', async () => {
    const rows: PendingRow[] = [{
      id: 3, exchange_order_id: 'O003', symbol: '005380', type: 'limit',
      status: 'accepted', quantity: 1, created_at: AGED(),
    }];
    setupPool(rows);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue({
      orders: [], ok: [], failed: [{ market: 'domestic', error: 'timeout' }], complete: false,
    });
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);

    const t0 = Date.parse('2026-08-11T02:00:00+09:00');
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(t0);
    await syncPendingOrders(); // 1회차 — 미판정 시계 시작(t0)

    const t1 = t0 + 5 * 60 * 60_000; // 5시간 뒤 — 이미 2시간 전에 escalated된 상태를 재현
    nowSpy.mockReturnValue(t1);
    (getStaleTracking as jest.Mock).mockResolvedValue(new Map([
      [3, { orderId: 3, symbol: '005380', firstStaleAt: t0, escalatedAt: t0 + 2 * 60 * 60_000 }],
    ]));

    await syncPendingOrders();

    expect(markEscalated).not.toHaveBeenCalled();
    expect(sendAlertThrottled).not.toHaveBeenCalledWith(
      'order-sync:stale-structural', expect.anything(), expect.anything(), expect.anything(), expect.anything(),
    );
    expect(sendAlertThrottled).not.toHaveBeenCalledWith(
      'order-sync:stale', 'critical', expect.any(String), expect.any(String), expect.any(Number),
    );
    nowSpy.mockRestore();
  });

  test('DB에 저장된 firstStaleAt이 "재시작 직후"의 얕은 메모리 나이를 이긴다 (Fix4/I4 — DB 내구성 증명)', async () => {
    // 이 테스트가 고정하는 것: 에스컬레이션이 **DB에 영속된 나이**로 판단되는지, 아니면
    // 설계 문서가 명시적으로 기각한 순진한 접근(프로세스 메모리 `unreconciledForMs`)으로
    // 판단되는지. 기존 에스컬레이션 테스트들은 mock firstStaleAt과 메모리 시계를 항상
    // 같은 속도로 흘려보내서 둘을 구분하지 못했다 — 여기서는 일부러 어긋나게 만든다:
    // 메모리는 방금(35분 전) 다시 추적을 시작했지만, DB는 실제로 3시간째라고 말한다
    // (=프로세스가 재시작됐고 이 주문은 재시작 전부터 이미 정체돼 있었다는 시나리오).
    const rows: PendingRow[] = [{
      id: 6, exchange_order_id: 'O006', symbol: '035420', type: 'limit',
      status: 'accepted', quantity: 1, created_at: AGED(),
    }];
    setupPool(rows);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue({
      orders: [], ok: [], failed: [{ market: 'domestic', error: 'timeout' }], complete: false,
    });
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);

    // t0 = "재시작 직후" — 프로세스 메모리(unreconciledSince)는 여기서부터 다시 시작한다.
    const t0 = Date.parse('2026-08-11T02:00:00+09:00');
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(t0);
    await syncPendingOrders(); // 1회차 — 메모리 시계 시작(t0). 이 회차엔 아직 DB 조회에 닿지 않는다.

    // t1 = 재시작 후 35분 — 메모리 나이는 35분(STALE_MS는 넘지만 STRUCTURAL_MS엔 한참 못 미친다).
    const t1 = t0 + 35 * 60_000;
    nowSpy.mockReturnValue(t1);
    // DB는 이 주문이 재시작 **이전부터** 이미 3시간째 정체돼 있었다고 말한다.
    (getStaleTracking as jest.Mock).mockResolvedValue(new Map([
      [6, { orderId: 6, symbol: '035420', firstStaleAt: t1 - 3 * 60 * 60_000, escalatedAt: null }],
    ]));

    await syncPendingOrders(); // 2회차 — 메모리 나이=35분, DB 나이=3시간. 어느 쪽이 이기는가?

    // DB 값이 이겼다는 증거: 메모리 나이(35분)만으로는 절대 구조적 알림이 나갈 수 없는데도 나갔다.
    expect(sendAlertThrottled).toHaveBeenCalledWith(
      'order-sync:stale-structural:6', 'critical', expect.any(String), expect.stringContaining('3.0시간'), expect.any(Number),
    );
    expect(markEscalated).toHaveBeenCalledWith(6, t1);
    // 반대 증거: 순진한(메모리 기준) 설계였다면 35분은 STALE_MS는 넘지만 STRUCTURAL_MS엔 못
    // 미치므로 대신 반복 alert('order-sync:stale')이 나갔을 것이다 — 나가지 않았다는 것 자체가
    // 이 판단이 메모리가 아니라 DB 값으로 내려졌다는 뜻이다.
    expect(sendAlertThrottled).not.toHaveBeenCalledWith(
      'order-sync:stale', 'critical', expect.any(String), expect.any(String), expect.any(Number),
    );
    nowSpy.mockRestore();
  });

  test('판단보류가 전부 해소되면 clearResolved가 빈 배열 기준으로 호출된다', async () => {
    const rows: PendingRow[] = [{
      id: 5, exchange_order_id: 'O005', symbol: '005930', type: 'limit',
      status: 'accepted', quantity: 1, created_at: AGED(),
    }];
    setupPool(rows);
    // 미체결 목록에 살아 있음 → reconciled 처리(정상 판정, unreconciled 없음) —
    // "판단보류가 전부 해소된" 회차를 재현한다. rows 자체가 빈 회차(할 일 없음)는
    // reportUnreconciled 호출 이전에 조기 반환되므로 이 시나리오에 맞지 않는다.
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue({
      orders: [{ orderId: 'O005', symbol: '005930' }], ok: ['domestic', 'overseas'], failed: [], complete: true,
    });
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);

    const r = await syncPendingOrders();

    expect(r.unreconciled).toEqual([]);
    expect(clearResolved).toHaveBeenCalledWith([]);
  });

  test('pending 주문이 0건이면 조기 반환 시 clearResolved([]가 호출된다', async () => {
    setupPool([]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue({
      orders: [], ok: ['domestic', 'overseas'], failed: [], complete: true,
    });
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);

    const r = await syncPendingOrders();

    // 조기 반환이므로 complete=true, unreconciled=[]
    expect(r.complete).toBe(true);
    expect(r.unreconciled).toEqual([]);
    // 핵심: clearResolved([])가 호출되어 stale tracking 테이블 정리
    expect(clearResolved).toHaveBeenCalledWith([]);
  });
});

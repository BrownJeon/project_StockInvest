/**
 * T-071 WP-1 (F01) — **해외 market 주문은 브로커에서 지정가다.**
 *
 * KIS 해외는 시장가를 지원하지 않아 모든 주문이 `ORD_DVSN:'00'`(지정가)으로 나가고 `market` 요청은
 * 가격만 ±0.5% 공격적으로 잡는다. 예전 동기화는 DB 의 요청 원본 `type='market'` 을 믿고
 *  ① 체결목록에 주문번호만 있으면 수량·잔량을 보지 않고 `filled` (10주 중 1주 체결·잔량 작동 중에도 종결)
 *  ② 체결목록에 없으면 영원히 `accepted`
 * 로 두었다. 이 파일은 그 두 결함과, 해외 market 이 새로 들어가는 취소 추론 경로의 안전장치
 * (연속 2회차 부재·`cancel_inferred`), 그리고 함께 들어간 조건부 쓰기(CAS)·single-flight·나이 가드·
 * 원화 가격 고정·활성 집합 키를 고정한다. 국내 market 은 **기존 단언 그대로**(쌍둥이 시험).
 */
import { getPool } from '@/lib/db';
import { getActiveOrdersDetailed, getCompletedOrders } from '@/lib/exchanges/kis';
import { sendAlertThrottled } from '@/lib/notify/throttle';
import {
  syncPendingOrders, resetUnreconciledTracker, absentTrackerSize, brokerOrderType,
  INFLIGHT_STALE_MS, CANCEL_CONFIRM_MAX_GAP_MS, RUN_FENCE_MS,
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
jest.mock('../order-sync-escalation', () => ({
  STRUCTURAL_MS: 2 * 60 * 60_000,
  getStaleTracking: jest.fn(async () => new Map()),
  recordFirstStale: jest.fn(async () => {}),
  markEscalated: jest.fn(async () => {}),
  clearResolved: jest.fn(async () => {}),
}));

interface Row {
  id: number;
  exchange_order_id: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
  status: string;
  price: number | null;
  quantity: number | null;
  created_at: Date;
}

/** 기준 시각 — 모든 시험은 Date.now 를 이 값(또는 그 이후)으로 고정한다 */
const T0 = Date.parse('2026-10-23T00:00:00+09:00');
const AGED = new Date(T0 - 60 * 60_000);       // 1시간 전 생성 — 유예(120초) 충분히 경과
const MIN = 60_000;

const row = (o: Partial<Row> & { id: number }): Row => ({
  exchange_order_id: `E${o.id}`,
  symbol: 'NAS:AAPL',
  side: 'sell',
  type: 'market',
  status: 'accepted',
  price: 280_000,          // 원화 기준가 (송신 경로가 쓰는 값)
  quantity: 10,
  created_at: AGED,
  ...o,
});

interface Store {
  rows: Row[];
  updates: Array<{ sql: string; params: unknown[] }>;
  execInserts: Array<{ orderId: number; price: number; quantity: number; executedAt: Date }>;
  tradeLogs: Array<{ orderId: number | null; event: string; payload: Record<string, unknown> }>;
  /** UPDATE 가 돌려줄 affectedRows. undefined 면 필드 자체를 빼서 돌려준다 */
  affectedRows: number | undefined;
  /** executions INSERT…SELECT 가 돌려줄 affectedRows. 0 이면 "상태가 바뀌어 안 넣음"(행 미기록) */
  execAffectedRows?: number;
  execSql: string[];
  /** 이 SQL 이 처음 나올 때 이 Promise 가 풀릴 때까지 멈춘다 (주문 처리 도중 정지 재현) */
  gate?: { re: RegExp; wait: Promise<unknown> };
  failTradeLogEvent?: string;
}

/**
 * 회차를 넘어 상태가 이어지는 가짜 DB. `trade_logs` 의 마지막 `fill_progress` 조회도 이 저장소에서
 * 답하므로 "재시작해도 DB 기준이라 중복이 안 생긴다"를 그대로 재현한다.
 */
function setupDb(rows: Row[]): Store {
  const st: Store = { rows, updates: [], execInserts: [], tradeLogs: [], affectedRows: 1, execSql: [] };
  const query = jest.fn(async (sqlArg: unknown, paramsArg: unknown[] = []) => {
    const sql = String(sqlArg);
    const params = paramsArg ?? [];
    if (st.gate && st.gate.re.test(sql)) {
      const g = st.gate;
      st.gate = undefined;
      await g.wait;
    }
    if (/FROM system_config/i.test(sql)) return [[]];
    if (/SELECT COUNT\(\*\) AS n FROM executions/i.test(sql)) return [[{ n: 1 }]];
    if (/SELECT id FROM executions/i.test(sql)) {
      return [st.execInserts.some(e => e.orderId === Number(params[0])) ? [{ id: 1 }] : []];
    }
    if (/INSERT INTO executions/i.test(sql)) {
      st.execSql.push(sql);
      if (st.execAffectedRows === 0) return [{ affectedRows: 0 }];
      st.execInserts.push({
        orderId: Number(params[0]), price: Number(params[1]),
        quantity: Number(params[2]), executedAt: params[3] as Date,
      });
      return [{ insertId: 1 }];
    }
    if (/SELECT payload FROM trade_logs/i.test(sql)) {
      const id = Number(params[0]);
      const last = [...st.tradeLogs].reverse().find(l => l.orderId === id && l.event === 'fill_progress');
      return [last ? [{ payload: JSON.stringify(last.payload) }] : []];
    }
    if (/INSERT INTO trade_logs/i.test(sql)) {
      const event = String(params[1]);
      if (st.failTradeLogEvent === event) throw new Error('trade_logs down');
      st.tradeLogs.push({
        orderId: params[0] as number | null,
        event,
        payload: JSON.parse(String(params[2])) as Record<string, unknown>,
      });
      return [{ insertId: 1 }];
    }
    if (/SELECT[\s\S]*FROM orders/i.test(sql)) return [st.rows];
    if (/UPDATE orders/i.test(sql)) {
      st.updates.push({ sql, params });
      return [st.affectedRows === undefined ? {} : { affectedRows: st.affectedRows }];
    }
    return [[]];
  });
  (getPool as jest.Mock).mockReturnValue({ query });
  return st;
}

const bothOk = (orders: { orderId: string; symbol: string }[] = []) => ({
  orders, ok: ['domestic', 'overseas'], failed: [], complete: true,
});
const fill = (orderId: string, qty: number, o: { price?: number; ts?: number; side?: string } = {}) => ({
  orderId, side: o.side ?? 'sell', price: o.price ?? 201.5, qty, ts: o.ts ?? T0 - 30 * MIN,
});

const at = (t: number) => jest.spyOn(Date, 'now').mockReturnValue(t);
const warnText = () => (console.warn as jest.Mock).mock.calls.flat().join('\n');
const infoText = () => (console.info as jest.Mock).mock.calls.flat().join('\n');

beforeEach(() => {
  jest.clearAllMocks();
  resetUnreconciledTracker();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  at(T0);
});
afterEach(() => { jest.restoreAllMocks(); });

// ── ① 핵심 — 해외 market 을 지정가 규칙으로 판정한다 ──────────────────────────

describe('🔴 F01 — 해외 market 은 브로커에서 지정가다', () => {
  test('brokerOrderType — 해외는 항상 limit, 국내는 요청 유형 그대로', () => {
    expect(brokerOrderType('market', 'overseas')).toBe('limit');
    expect(brokerOrderType('limit', 'overseas')).toBe('limit');
    expect(brokerOrderType('market', 'domestic')).toBe('market');
    expect(brokerOrderType('limit', 'domestic')).toBe('limit');
  });

  test('0주 체결·잔량 작동(미체결 목록에 있음) → 변경 없음, 정상 판정 + 발화 토큰', async () => {
    const st = setupDb([row({ id: 1 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([{ orderId: 'E1', symbol: 'NAS:AAPL' }]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);

    const r = await syncPendingOrders();
    expect(st.updates).toEqual([]);
    expect(r.complete).toBe(true);
    expect(r.skipped).toBe(0);
    expect(infoText()).toContain('ORDER_SYNC_OVERSEAS_MARKET_AS_LIMIT id=1');
    expect(infoText()).toContain('decision=accepted');
  });

  test('🔴 회귀 — 1/10주 체결·잔량 작동 → filled 가 아니라 partially_filled 로 추적 유지', async () => {
    const st = setupDb([row({ id: 2 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([{ orderId: 'E2', symbol: 'NAS:AAPL' }]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([fill('E2', 1)]);

    const r = await syncPendingOrders();
    expect(st.updates).toHaveLength(1);
    expect(st.updates[0].sql).toMatch(/status='partially_filled'/);
    expect(st.updates[0].sql).not.toMatch(/status='filled'/);
    expect(st.updates[0].params).toEqual([2, 'accepted']);
    expect(st.execInserts).toEqual([]);                 // 종결 전에는 executions 를 쓰지 않는다
    expect(r.partialSettlements).toEqual([]);
    expect(infoText()).toContain('decision=partially_filled');
  });

  test('10/10주 체결·목록 소멸 → filled, executions 없음(전량)', async () => {
    const st = setupDb([row({ id: 3 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([fill('E3', 10)]);

    const r = await syncPendingOrders();
    expect(st.updates[0].sql).toMatch(/status='filled'/);
    expect(st.execInserts).toEqual([]);
    expect(r.partialSettlements).toEqual([]);
  });

  test('1/10주 체결 후 잔량 만료 → executions(1주, 원화 기준가) 먼저, 그다음 filled + 감사·매도 알림', async () => {
    const st = setupDb([row({ id: 4 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([fill('E4', 1, { price: 199.25 })]);

    const r = await syncPendingOrders();
    expect(st.execInserts).toEqual([
      { orderId: 4, price: 280_000, quantity: 1, executedAt: new Date(T0 - 30 * MIN) },
    ]);
    expect(st.updates[0].sql).toMatch(/status='filled'/);
    expect(r.partialSettlements).toEqual([expect.objectContaining({
      id: 4, market: 'overseas', orderedQty: 10, filledQty: 1, executionRecorded: true,
    })]);
    const audit = st.tradeLogs.find(l => l.event === 'partial_fill_settled');
    expect(audit!.payload).toMatchObject({
      priceBasis: 'order_price_krw', brokerPriceNative: 199.25, brokerCurrency: 'USD',
      brokerTsBasis: 'order_time_dmst_ord_dt_ord_tmd', orderPriceKrw: 280_000,
    });
    expect((sendAlertThrottled as jest.Mock).mock.calls.map(c => c[0])).toContain('order-sync:partial-settled-sell');
    expect(infoText()).toContain('decision=partial_settled');
  });

  test('추가 체결 도착: 1주 → 4주(재UPDATE 없음) → 10주·목록 소멸(filled)', async () => {
    const st = setupDb([row({ id: 5 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([{ orderId: 'E5', symbol: 'NAS:AAPL' }]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([fill('E5', 1)]);
    await syncPendingOrders();
    expect(st.updates).toHaveLength(1);

    st.rows = [row({ id: 5, status: 'partially_filled' })];
    at(T0 + 5 * MIN);
    (getCompletedOrders as jest.Mock).mockResolvedValue([fill('E5', 4)]);
    await syncPendingOrders();
    expect(st.updates).toHaveLength(1);                 // 이미 partially_filled — 다시 쓰지 않는다

    at(T0 + 10 * MIN);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([fill('E5', 10)]);
    const r = await syncPendingOrders();
    expect(st.updates).toHaveLength(2);
    expect(st.updates[1].sql).toMatch(/status='filled'/);
    expect(st.updates[1].params).toEqual([5, 'partially_filled']);
    expect(st.execInserts).toEqual([]);
    expect(r.partialSettlements).toEqual([]);
  });

  test('0주 체결·두 목록 모두 없음·유예 전 → too_fresh (취소 판정 없음)', async () => {
    const st = setupDb([row({ id: 6, created_at: new Date(T0 - 30_000) })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);

    const r = await syncPendingOrders();
    expect(st.updates).toEqual([]);
    expect(r.unreconciled.map(u => u.reason)).toEqual(['too_fresh']);
    expect(absentTrackerSize()).toBe(0);                // 유예 중은 부재 회차로 세지 않는다
  });

  test('해외 1.7주 market(송신 1주)이 1주 체결 → filled (H-4 무회귀)', async () => {
    const st = setupDb([row({ id: 7, quantity: 1.7 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([fill('E7', 1)]);

    const r = await syncPendingOrders();
    expect(st.updates[0].sql).toMatch(/status='filled'/);
    expect(st.execInserts).toEqual([]);
    expect(r.partialSettlements).toEqual([]);
  });
});

// ── ② 영구 accepted 해소 — 연속 2회차 부재 후에만 취소로 추론한다 (R-05) ───────

describe('🔴 R-05 — 해외 market 취소 추론은 연속 2회차 부재 + cancel_inferred', () => {
  const absentRound = () => {
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);
  };

  test('1회차는 cancel_confirming 보류(complete=true, 경고 토큰 없음) → 2회차에 cancelled + cancel_inferred', async () => {
    const st = setupDb([row({ id: 10 })]);
    absentRound();

    const r1 = await syncPendingOrders();
    expect(st.updates).toEqual([]);
    expect(r1.unreconciled.map(u => u.reason)).toEqual(['cancel_confirming']);
    expect(r1.complete).toBe(true);                     // C2 — 판정 실패가 아니다
    expect(r1.unreconciled[0].unreconciledForMs).toBe(0);
    expect(warnText()).not.toContain('ORDER_SYNC_UNRECONCILED');
    expect(absentTrackerSize()).toBe(1);
    expect(infoText()).toContain('decision=cancel_confirming');

    at(T0 + 5 * MIN);
    const r2 = await syncPendingOrders();
    expect(st.updates).toHaveLength(1);
    expect(st.updates[0].sql).toMatch(/status='cancelled'/);
    // V-01 — 취소 쓰기도 조건부(CAS)여야 한다: 가장 위험한 filled→cancelled 덮어쓰기를 막는 줄
    expect(st.updates[0].sql).toMatch(/WHERE id=\? AND status=\?/);
    expect(st.updates[0].params).toEqual([10, 'accepted']);
    expect(r2.synced).toBe(1);
    const inferred = st.tradeLogs.find(l => l.event === 'cancel_inferred');
    expect(inferred!.payload).toMatchObject({
      basis: 'absent_both_lists', requestedType: 'market', brokerOrderType: 'limit',
      absentRounds: 2, activeOk: true, completedOk: true, coverage: 'ok', source: 'order-sync',
    });
    expect(warnText()).toContain('ORDER_SYNC_CANCEL_INFERRED id=10');
    expect(absentTrackerSize()).toBe(0);
  });

  test('1회차 부재 뒤 체결목록에 나타나면 부재 연속이 끊기고 체결로 판정된다', async () => {
    const st = setupDb([row({ id: 11 })]);
    absentRound();
    await syncPendingOrders();
    expect(absentTrackerSize()).toBe(1);

    at(T0 + 5 * MIN);
    (getCompletedOrders as jest.Mock).mockResolvedValue([fill('E11', 10)]);
    await syncPendingOrders();
    expect(st.updates[0].sql).toMatch(/status='filled'/);
    expect(st.tradeLogs.some(l => l.event === 'cancel_inferred')).toBe(false);
    expect(absentTrackerSize()).toBe(0);
  });

  test('C2 — 비정상 회차(체결조회 실패)를 끼면 연속이 끊긴다: 실패 뒤 부재는 다시 1회차', async () => {
    const st = setupDb([row({ id: 12 })]);
    absentRound();
    await syncPendingOrders();

    at(T0 + 5 * MIN);
    (getCompletedOrders as jest.Mock).mockRejectedValue(new Error('rate limit'));
    await syncPendingOrders();
    expect(absentTrackerSize()).toBe(0);

    at(T0 + 10 * MIN);
    absentRound();
    const r = await syncPendingOrders();
    expect(st.updates).toEqual([]);                     // 취소하지 않는다
    expect(r.unreconciled.map(u => u.reason)).toEqual(['cancel_confirming']);
  });

  test('C2 — 미체결 목록에 다시 나타나면 연속이 끊긴다', async () => {
    const st = setupDb([row({ id: 13 })]);
    absentRound();
    await syncPendingOrders();

    at(T0 + 5 * MIN);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([{ orderId: 'E13', symbol: 'NAS:AAPL' }]));
    await syncPendingOrders();
    expect(absentTrackerSize()).toBe(0);

    at(T0 + 10 * MIN);
    absentRound();
    await syncPendingOrders();
    expect(st.updates).toEqual([]);
  });

  test('재시작(맵 초기화) 뒤에는 1회차를 더 기다린다 — 안전 방향', async () => {
    const st = setupDb([row({ id: 14 })]);
    absentRound();
    await syncPendingOrders();
    resetUnreconciledTracker();                         // 프로세스 재시작 모사

    at(T0 + 5 * MIN);
    const r = await syncPendingOrders();
    expect(st.updates).toEqual([]);
    expect(r.unreconciled.map(u => u.reason)).toEqual(['cancel_confirming']);

    at(T0 + 10 * MIN);
    await syncPendingOrders();
    expect(st.updates[0].sql).toMatch(/status='cancelled'/);
  });

  test('첫 관측 직후(확인 간격 60초 미만)의 재호출은 다른 회차로 세지 않는다', async () => {
    const st = setupDb([row({ id: 15 })]);
    absentRound();
    await syncPendingOrders();

    at(T0 + 20_000);
    const r = await syncPendingOrders();
    expect(st.updates).toEqual([]);
    expect(r.unreconciled.map(u => u.reason)).toEqual(['cancel_confirming']);
  });

  test('C2 — 비종결 집합에서 사라진 주문의 부재 관측은 prune 된다', async () => {
    const st = setupDb([row({ id: 16 })]);
    absentRound();
    await syncPendingOrders();
    expect(absentTrackerSize()).toBe(1);

    // 다른 경로(예: 수동 취소)로 #16 이 종결돼 조회 대상에서 빠졌다
    st.rows = [row({ id: 17 })];
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([{ orderId: 'E17', symbol: 'NAS:AAPL' }]));
    at(T0 + 5 * MIN);
    await syncPendingOrders();
    expect(absentTrackerSize()).toBe(0);
  });

  test('C5 — cancel_inferred 기록 실패가 이미 성공한 취소 전이를 되돌리지 않는다', async () => {
    const st = setupDb([row({ id: 18 })]);
    st.failTradeLogEvent = 'cancel_inferred';
    absentRound();
    await syncPendingOrders();
    at(T0 + 5 * MIN);
    const r = await syncPendingOrders();
    expect(st.updates[0].sql).toMatch(/status='cancelled'/);
    expect(r.synced).toBe(1);
    expect(r.errors.join(' ')).toContain('cancel_inferred audit 18');
  });

  test('국내 지정가 취소는 기존대로 1회 부재로 즉시 — 다만 cancel_inferred(rounds=1) 근거가 남는다', async () => {
    const st = setupDb([row({ id: 19, symbol: '005930', type: 'limit', price: 70_000 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([{ orderId: 'OTHER', symbol: '005930' }]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);

    await syncPendingOrders();
    expect(st.updates[0].sql).toMatch(/status='cancelled'/);
    // V-01 — 국내 지정가 추론 취소도 조건부(CAS) SQL 이다
    expect(st.updates[0].sql).toMatch(/WHERE id=\? AND status=\?/);
    expect(st.updates[0].params).toEqual([19, 'accepted']);
    expect(st.tradeLogs.find(l => l.event === 'cancel_inferred')!.payload)
      .toMatchObject({ absentRounds: 1, market: 'domestic', brokerOrderType: 'limit' });
  });

  test('V-08 — 첫 관측이 간격 상한(CANCEL_CONFIRM_MAX_GAP_MS=30분)을 넘겨 오래됐으면 버리고 다시 1회차로 센다', async () => {
    expect(CANCEL_CONFIRM_MAX_GAP_MS).toBe(30 * MIN);
    const st = setupDb([row({ id: 25 })]);
    absentRound();
    await syncPendingOrders();                          // 1회차(T0)

    // 사이 회차들이 실행 전체 실패 등으로 이 주문을 판정하지 못해 맵이 그대로 남았다고 가정
    at(T0 + 31 * MIN);
    const r = await syncPendingOrders();
    expect(st.updates).toEqual([]);                     // 오래된 첫 관측을 재사용해 취소하지 않는다
    expect(r.unreconciled.map(u => u.reason)).toEqual(['cancel_confirming']);

    at(T0 + 36 * MIN);                                  // 새 1회차(T0+31분) 기준 5분 뒤 → 이제 확정
    await syncPendingOrders();
    expect(st.updates[0].sql).toMatch(/status='cancelled'/);
    expect(st.tradeLogs.find(l => l.event === 'cancel_inferred')!.payload).toMatchObject({
      absentRounds: 2, firstAbsentAt: new Date(T0 + 31 * MIN).toISOString(),
    });
  });

  test('간격 상한 안(29분)이면 첫 관측을 그대로 이어 확정한다', async () => {
    const st = setupDb([row({ id: 26 })]);
    absentRound();
    await syncPendingOrders();
    at(T0 + 29 * MIN);
    await syncPendingOrders();
    expect(st.updates[0].sql).toMatch(/status='cancelled'/);
  });
});

// ── ③ 커버리지 밖·해외 조회 비활성 — 취소로 둔갑하지 않는다 ─────────────────────

describe('커버리지 밖(NYS)·KIS_OVERSEAS_ENABLED=false', () => {
  test('NYS market 0주 체결 → active_coverage_gap 보류 (예전의 조용한 영구 accepted 대신)', async () => {
    const st = setupDb([row({ id: 20, symbol: 'NYS:ORCL', exchange_order_id: 'E20' })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);

    const r = await syncPendingOrders();
    expect(st.updates).toEqual([]);
    expect(r.unreconciled.map(u => u.reason)).toEqual(['active_coverage_gap']);
    expect(absentTrackerSize()).toBe(0);
  });

  test('NYS market 10/10 체결 → 수량 근거로 filled', async () => {
    const st = setupDb([row({ id: 21, symbol: 'NYS:ORCL', exchange_order_id: 'E21' })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([fill('E21', 10)]);

    await syncPendingOrders();
    expect(st.updates[0].sql).toMatch(/status='filled'/);
  });

  test('NYS market 1/10 체결 → 잔량 확인 불가라 partially_filled (종결하지 않는다)', async () => {
    const st = setupDb([row({ id: 22, symbol: 'NYS:ORCL', exchange_order_id: 'E22' })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([fill('E22', 1)]);

    await syncPendingOrders();
    expect(st.updates[0].sql).toMatch(/status='partially_filled'/);
    expect(st.execInserts).toEqual([]);
  });

  test('해외 조회 비활성(ok=[domestic]) + 열린 해외 market: 체결목록 없음 → active_query_failed 보류', async () => {
    const st = setupDb([row({ id: 23 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue({ orders: [], ok: ['domestic'], failed: [], complete: true });
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);

    const r = await syncPendingOrders();
    expect(st.updates).toEqual([]);
    expect(r.unreconciled.map(u => u.reason)).toEqual(['active_query_failed']);
    expect(r.complete).toBe(false);
    expect(r.unreconciled[0].detail).toContain('KIS_OVERSEAS_ENABLED');
  });

  test('해외 조회 비활성 + 10/10 체결 → 수량 근거로 filled', async () => {
    const st = setupDb([row({ id: 24 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue({ orders: [], ok: ['domestic'], failed: [], complete: true });
    (getCompletedOrders as jest.Mock).mockResolvedValue([fill('E24', 10)]);

    await syncPendingOrders();
    expect(st.updates[0].sql).toMatch(/status='filled'/);
  });
});

// ── ④ 국내 골든 쌍둥이 — 같은 입력, 국내 심볼이면 기존 판정 그대로 ─────────────

describe('국내 market 골든 쌍둥이 (기존 단언 불변)', () => {
  test('국내 market 1/10 체결·미체결 목록에 있음 → 즉시 filled (수량 무관, 기존 동작)', async () => {
    const st = setupDb([row({ id: 30, symbol: '005930', price: 70_000 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([{ orderId: 'E30', symbol: '005930' }]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([fill('E30', 1, { price: 70_100 })]);

    await syncPendingOrders();
    expect(st.updates[0].sql).toMatch(/status='filled'/);
    expect(st.execInserts).toEqual([]);
    expect(infoText()).not.toContain('ORDER_SYNC_OVERSEAS_MARKET_AS_LIMIT');
  });

  test('같은 입력을 해외 심볼로 → partially_filled (차이를 고정)', async () => {
    const st = setupDb([row({ id: 31 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([{ orderId: 'E31', symbol: 'NAS:AAPL' }]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([fill('E31', 1)]);

    await syncPendingOrders();
    expect(st.updates[0].sql).toMatch(/status='partially_filled'/);
  });

  test('국내 market 체결목록 없음 → 변경 없음·보류 아님(기존 동작), 해외 쌍둥이는 cancel_confirming', async () => {
    const st = setupDb([
      row({ id: 32, symbol: '005930', price: 70_000 }),
      row({ id: 33 }),
    ]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);

    const r = await syncPendingOrders();
    expect(st.updates).toEqual([]);
    expect(r.unreconciled.map(u => [u.id, u.reason])).toEqual([[33, 'cancel_confirming']]);
  });
});

// ── ⑤ R-06 나이 가드 ─────────────────────────────────────────────────────────

describe('🔴 R-06 — 방금 낸 주문의 부분체결은 활성 목록 부재만으로 종결하지 않는다', () => {
  test('생성 30초·활성 목록에 없음·1/10 체결 → partially_filled (executions·종결 없음)', async () => {
    const st = setupDb([row({ id: 40, symbol: '005930', type: 'limit', price: 70_000, created_at: new Date(T0 - 30_000) })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([fill('E40', 1, { price: 70_000 })]);

    const r = await syncPendingOrders();
    expect(st.updates[0].sql).toMatch(/status='partially_filled'/);
    expect(st.execInserts).toEqual([]);
    expect(r.partialSettlements).toEqual([]);
  });

  test('같은 주문이 유예를 지나면 종결된다', async () => {
    const st = setupDb([row({
      id: 41, symbol: '005930', type: 'limit', price: 70_000, status: 'partially_filled',
      created_at: new Date(T0 - 30_000),
    })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([fill('E41', 1, { price: 70_000 })]);
    at(T0 + 5 * MIN);

    const r = await syncPendingOrders();
    expect(st.execInserts).toHaveLength(1);
    expect(st.updates[0].sql).toMatch(/status='filled'/);
    expect(r.partialSettlements).toHaveLength(1);
  });

  test('어린 주문이라도 수량으로 전량이 증명되면 바로 filled (양성 증거는 유예하지 않는다)', async () => {
    const st = setupDb([row({ id: 42, created_at: new Date(T0 - 10_000) })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([fill('E42', 10)]);

    await syncPendingOrders();
    expect(st.updates[0].sql).toMatch(/status='filled'/);
  });
});

// ── ⑥ R-03 조건부 쓰기(CAS) ─────────────────────────────────────────────────

describe('🔴 R-03 — 상태는 이번 회차가 읽은 상태일 때만 쓴다', () => {
  test('모든 상태 쓰기가 WHERE id=? AND status=? 형태다', async () => {
    const st = setupDb([
      row({ id: 50, exchange_order_id: 'A', symbol: '005930', type: 'limit', price: 70_000 }),
      row({ id: 51, exchange_order_id: 'B', symbol: '005930', type: 'limit', price: 70_000 }),
    ]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([{ orderId: 'B', symbol: '005930' }]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([fill('A', 10, { price: 70_000 }), fill('B', 1, { price: 70_000 })]);

    await syncPendingOrders();
    expect(st.updates).toHaveLength(2);
    for (const u of st.updates) {
      expect(u.sql).toMatch(/WHERE id=\? AND status=\?/);
      expect(u.params[1]).toBe('accepted');
    }
  });

  test('C5 — 종결 부분체결에서 CAS 를 잃으면: executions 는 남고 알림·partialSettlements·감사 없음', async () => {
    const st = setupDb([row({ id: 52 })]);
    st.affectedRows = 0;
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([fill('E52', 3)]);

    const r = await syncPendingOrders();
    expect(st.execInserts).toHaveLength(1);             // 멱등 가드가 있어 남아도 무해하다
    expect(r.synced).toBe(0);
    expect(r.partialSettlements).toEqual([]);
    expect(st.tradeLogs.some(l => l.event === 'partial_fill_settled')).toBe(false);
    expect((sendAlertThrottled as jest.Mock).mock.calls.map(c => c[0]))
      .not.toEqual(expect.arrayContaining(['order-sync:partial-settled-sell']));
    expect(warnText()).toContain('ORDER_SYNC_CAS_LOST id=52');
    expect(infoText()).toContain('decision=cas_lost');
  });

  test('취소 추론에서 CAS 를 잃으면 cancel_inferred 를 쓰지 않는다', async () => {
    const st = setupDb([row({ id: 53, symbol: '005930', type: 'limit', price: 70_000 })]);
    st.affectedRows = 0;
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);

    const r = await syncPendingOrders();
    expect(r.synced).toBe(0);
    expect(st.tradeLogs.some(l => l.event === 'cancel_inferred')).toBe(false);
  });

  test('affectedRows 를 알 수 없으면 성공으로 보지 않는다(보수)', async () => {
    const st = setupDb([row({ id: 54, symbol: '005930', type: 'limit', price: 70_000 })]);
    st.affectedRows = undefined;
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([fill('E54', 10, { price: 70_000 })]);

    const r = await syncPendingOrders();
    expect(st.updates).toHaveLength(1);
    expect(r.synced).toBe(0);
    expect(warnText()).toContain('affectedRows=unknown');
  });
});

// ── ⑦ single-flight + 워치독 (R-03 / C1) ───────────────────────────────────

describe('🔴 single-flight — 겹친 호출은 진행 중 회차를 공유한다', () => {
  test('동시 두 호출 → KIS 조회 각 1회, 같은 결과 / 끝난 뒤 세 번째는 새로 조회', async () => {
    setupDb([row({ id: 60 })]);
    let release!: (v: unknown) => void;
    (getActiveOrdersDetailed as jest.Mock).mockReturnValueOnce(new Promise(res => { release = res; }));
    (getCompletedOrders as jest.Mock).mockResolvedValue([fill('E60', 10)]);

    const p1 = syncPendingOrders();
    const p2 = syncPendingOrders();
    release(bothOk([]));
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2);
    expect(getActiveOrdersDetailed).toHaveBeenCalledTimes(1);
    expect(warnText()).toContain('ORDER_SYNC_SKIPPED_INFLIGHT');

    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    await syncPendingOrders();
    expect(getActiveOrdersDetailed).toHaveBeenCalledTimes(2);
  });

  test('C1 — 진행 중 회차가 멈추면(INFLIGHT_STALE_MS 초과) 경고 후 새 회차를 허용한다', async () => {
    setupDb([row({ id: 61 })]);
    (getActiveOrdersDetailed as jest.Mock).mockReturnValueOnce(new Promise(() => { /* 영원히 안 끝남 */ }));
    void syncPendingOrders();
    await new Promise(r => setImmediate(r));            // 첫 회차가 KIS 조회까지 진행하도록

    at(T0 + INFLIGHT_STALE_MS - 1000);
    void syncPendingOrders();                           // 아직 멈춘 게 아니다 — 공유
    await new Promise(r => setImmediate(r));
    expect(getActiveOrdersDetailed).toHaveBeenCalledTimes(1);
    expect(warnText()).toContain('ORDER_SYNC_SKIPPED_INFLIGHT');
    expect(warnText()).not.toContain('ORDER_SYNC_INFLIGHT_STALE');

    at(T0 + INFLIGHT_STALE_MS + 1000);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([{ orderId: 'E61', symbol: 'NAS:AAPL' }]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);
    const r = await syncPendingOrders();
    expect(getActiveOrdersDetailed).toHaveBeenCalledTimes(2);
    expect(warnText()).toContain('ORDER_SYNC_INFLIGHT_STALE');
    expect(r.complete).toBe(true);
  });

  test('V-02 — 멈췄다 늦게 끝난 옛 회차가 새 회차의 표식을 지우지 않는다(세 번째 호출은 새 회차를 공유)', async () => {
    expect(INFLIGHT_STALE_MS).toBe(15 * MIN);
    setupDb([row({ id: 62 })]);
    let releaseOld!: (v: unknown) => void;
    let releaseNew!: (v: unknown) => void;
    (getActiveOrdersDetailed as jest.Mock)
      .mockReturnValueOnce(new Promise(res => { releaseOld = res; }))
      .mockReturnValueOnce(new Promise(res => { releaseNew = res; }));
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);
    const flush = () => new Promise(r => setImmediate(r));

    const pOld = syncPendingOrders();                   // 멈출 회차
    await flush();
    at(T0 + INFLIGHT_STALE_MS + 1000);
    const pNew = syncPendingOrders();                   // 워치독이 허용한 새 회차
    await flush();
    expect(getActiveOrdersDetailed).toHaveBeenCalledTimes(2);

    releaseOld(bothOk([{ orderId: 'E62', symbol: 'NAS:AAPL' }]));
    await pOld;                                         // 옛 회차의 finally 가 여기서 돈다

    at(T0 + INFLIGHT_STALE_MS + 2000);
    const pThird = syncPendingOrders();                 // 새 회차가 아직 진행 중 → 공유돼야 한다
    await flush();
    expect(getActiveOrdersDetailed).toHaveBeenCalledTimes(2);
    expect(pThird).toBe(pNew);

    releaseNew(bothOk([{ orderId: 'E62', symbol: 'NAS:AAPL' }]));
    await Promise.all([pNew, pThird]);
  });

  test('회차가 예외로 끝나도 표식이 풀려 다음 호출은 새로 돈다', async () => {
    (getPool as jest.Mock).mockReturnValue({ query: jest.fn(async () => { throw new Error('db down'); }) });
    await expect(syncPendingOrders()).rejects.toThrow('db down');
    setupDb([]);
    await expect(syncPendingOrders()).resolves.toMatchObject({ complete: true });
  });
});

// ── ⑧ R-07 / C3 — 해외 executions 의 가격·시각 ─────────────────────────────

describe('R-07 / C3 — 해외 executions.price = orders.price, executed_at 은 [생성, 지금] 범위', () => {
  test('orders.price 가 없으면 USD 단가로 대신하지 않고 미기록 + ORDER_SYNC_PARTIAL_UNRECORDED', async () => {
    const st = setupDb([row({ id: 70, price: null })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([fill('E70', 2, { price: 200 })]);

    const r = await syncPendingOrders();
    expect(st.execInserts).toEqual([]);
    expect(r.partialSettlements[0]).toMatchObject({ executionRecorded: false });
    expect(r.partialSettlements[0].note).toContain('원화 기준가');
    expect(warnText()).toContain('ORDER_SYNC_PARTIAL_UNRECORDED');
    expect(st.tradeLogs.find(l => l.event === 'partial_fill_settled')!.payload)
      .toMatchObject({ priceBasis: 'order_price_krw', orderPriceKrw: null, brokerPriceNative: 200 });
  });

  test('브로커 시각이 주문 생성보다 이르면 생성 시각으로 올린다', async () => {
    const st = setupDb([row({ id: 71 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([fill('E71', 2, { ts: AGED.getTime() - 9 * 60 * MIN })]);

    await syncPendingOrders();
    expect(st.execInserts[0].executedAt).toEqual(AGED);
  });

  test('브로커 시각이 미래면 지금으로 내린다', async () => {
    const st = setupDb([row({ id: 72 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([fill('E72', 2, { ts: T0 + 9 * 60 * MIN })]);

    await syncPendingOrders();
    expect(st.execInserts[0].executedAt).toEqual(new Date(T0));
  });

  test('국내는 기존 그대로 브로커 체결가·시각', async () => {
    const st = setupDb([row({ id: 73, symbol: '005930', type: 'limit', price: 70_000 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    const ts = T0 + 9 * 60 * MIN;                         // 국내는 clamp 하지 않는다
    (getCompletedOrders as jest.Mock).mockResolvedValue([fill('E73', 2, { price: 70_300, ts })]);

    await syncPendingOrders();
    expect(st.execInserts[0]).toMatchObject({ price: 70_300, executedAt: new Date(ts) });
    expect(st.tradeLogs.find(l => l.event === 'partial_fill_settled')!.payload)
      .toMatchObject({ priceBasis: 'broker_fill' });
  });
});

// ── ⑨ Codex C1 #1 — 활성 집합 키 = 시장:주문번호 ───────────────────────────

describe('Codex C1 #1 — 시장이 다르면 같은 주문번호라도 다른 주문', () => {
  test('국내 미체결 0001 이 있어도 해외 주문 0001 은 "살아 있음"이 아니다', async () => {
    const st = setupDb([row({ id: 80, exchange_order_id: '0001' })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([{ orderId: '0001', symbol: '005930' }]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([fill('0001', 3)]);

    const r = await syncPendingOrders();
    // 해외 잔량은 목록에 없다 → 종결(부분체결) — 예전 키(주문번호만)였다면 partially_filled 로 오인
    expect(st.updates[0].sql).toMatch(/status='filled'/);
    expect(r.partialSettlements).toHaveLength(1);
  });

  test('시장을 판정할 수 없는 심볼의 미체결 항목은 두 시장 모두에서 "살아 있음"으로 본다(보수)', async () => {
    const st = setupDb([row({ id: 81, exchange_order_id: 'X1' })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([{ orderId: 'X1', symbol: 'NAS:BRK/B' }]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([fill('X1', 3)]);

    await syncPendingOrders();
    expect(st.updates[0].sql).toMatch(/status='partially_filled'/);
  });
});

// ── ⑩ fill_progress — 값이 바뀔 때만, 재시작해도 중복 없음 ─────────────────

describe('fill_progress (감사 전용)', () => {
  test('같은 누적 수량이면 1행, 재시작(메모리 초기화) 뒤에도 1행, 수량이 늘면 2행째', async () => {
    const st = setupDb([row({ id: 90 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([{ orderId: 'E90', symbol: 'NAS:AAPL' }]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([fill('E90', 2)]);

    await syncPendingOrders();
    st.rows = [row({ id: 90, status: 'partially_filled' })];
    at(T0 + 5 * MIN);
    await syncPendingOrders();
    resetUnreconciledTracker();
    at(T0 + 10 * MIN);
    await syncPendingOrders();
    const progress = () => st.tradeLogs.filter(l => l.event === 'fill_progress');
    expect(progress()).toHaveLength(1);
    expect(progress()[0].payload).toMatchObject({ filledQty: 2, submittedQty: 10, residualListed: true });

    (getCompletedOrders as jest.Mock).mockResolvedValue([fill('E90', 5)]);
    at(T0 + 15 * MIN);
    await syncPendingOrders();
    expect(progress()).toHaveLength(2);
    expect(progress()[1].payload).toMatchObject({ filledQty: 5 });
  });

  test('fill_progress 기록 실패는 판정을 막지 않는다', async () => {
    const st = setupDb([row({ id: 91 })]);
    st.failTradeLogEvent = 'fill_progress';
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([{ orderId: 'E91', symbol: 'NAS:AAPL' }]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([fill('E91', 2)]);

    const r = await syncPendingOrders();
    expect(st.updates[0].sql).toMatch(/status='partially_filled'/);
    expect(r.errors).toEqual([]);
  });
});

// ── ⑪ C2 지적2 — executions 는 상태 조건부 단일 INSERT ─────────────────────────

describe('C2 지적2 — executions INSERT 는 읽은 상태일 때만 (INSERT … SELECT … WHERE id=? AND status=?)', () => {
  test('INSERT 가 상태 조건부 SQL 이고 파라미터 끝에 id·읽은 상태가 붙는다', async () => {
    const st = setupDb([row({ id: 110 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([fill('E110', 2)]);

    await syncPendingOrders();
    expect(st.execSql[0]).toMatch(/SELECT \?, \?, \?, 0, \? FROM orders WHERE id = \? AND status = \?/);
    const query = (getPool() as unknown as { query: jest.Mock }).query;
    const call = query.mock.calls.find(c => /INSERT INTO executions/.test(String(c[0])))!;
    expect((call[1] as unknown[]).slice(4)).toEqual([110, 'accepted']);
  });

  test('삽입 전에 상태가 바뀌었으면(0행) 행도 상태 전이도 감사·알림도 없다', async () => {
    const st = setupDb([row({ id: 111 })]);
    st.execAffectedRows = 0;
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([fill('E111', 2)]);

    const r = await syncPendingOrders();
    expect(st.execInserts).toEqual([]);
    expect(st.updates).toEqual([]);                     // CAS 시도 없음
    expect(r.synced).toBe(0);
    expect(r.partialSettlements).toEqual([]);
    expect(st.tradeLogs.some(l => l.event === 'partial_fill_settled')).toBe(false);
    expect(sendAlertThrottled).not.toHaveBeenCalled();
    expect(warnText()).toContain('ORDER_SYNC_CAS_LOST id=111');
    expect(warnText()).toContain('stage=executions_insert');
  });

  test('affectedRows 가 없으면 삽입 성공으로 취급한다(빠진 행이 여분 행보다 나쁘다)', async () => {
    const st = setupDb([row({ id: 112 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([fill('E112', 2)]);

    const r = await syncPendingOrders();                // mock 은 { insertId } 만 돌려준다
    expect(st.updates[0].sql).toMatch(/status='filled'/);
    expect(r.partialSettlements[0]).toMatchObject({ executionRecorded: true });
  });
});

// ── ⑫ C2 지적1 — 워치독 펜싱: 정지했다 재개된 옛 회차는 아무것도 쓰지 않는다 ───────

describe('🔴 C2 지적1 — 펜싱 (정지했다 재개된 회차의 쓰기 0)', () => {
  const flush = () => new Promise(r => setImmediate(r));

  test('RUN_FENCE_MS 는 10분이고 워치독(15분)보다 작다', () => {
    expect(RUN_FENCE_MS).toBe(10 * MIN);
    expect(RUN_FENCE_MS).toBeLessThan(INFLIGHT_STALE_MS);
  });

  test('① 옛 회차가 체결조회에서 멈춘 사이 새 회차가 시작되면, 재개된 옛 회차의 쓰기·감사·알림·맵 변경이 모두 0', async () => {
    const st = setupDb([
      row({ id: 120, exchange_order_id: 'E120' }),                                   // 1/10 체결·목록 소멸 → 부분종결 유발
      row({ id: 121, exchange_order_id: 'E121', symbol: 'NAS:MSFT' }),               // 두 목록에 없음 → 취소 확인 유발
      row({ id: 122, exchange_order_id: 'E122', symbol: '005930', type: 'limit', price: 70_000 }), // 국내 지정가 부재 → 즉시 취소 유발
    ]);
    let releaseOld!: (v: unknown) => void;
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock)
      .mockReturnValueOnce(new Promise(res => { releaseOld = res; }))   // 옛 회차의 첫 심볼에서 정지
      .mockResolvedValue([]);

    const pOld = syncPendingOrders();
    await flush();

    // 15분+ 정지 → 워치독이 새 회차 허용(옛 회차 superseded). 새 회차는 다른 스냅샷(주문 없음)을 본다.
    at(T0 + INFLIGHT_STALE_MS + MIN);
    const snapshot = st.rows;
    st.rows = [];
    const rNew = await syncPendingOrders();
    expect(rNew).toMatchObject({ complete: true, errors: [] });   // ④ 새 회차는 정상
    st.rows = snapshot;

    // 옛 회차 재개 — 부분종결을 유발하는 목록으로 풀어 준다
    releaseOld([fill('E120', 1)]);
    const rOld = await pOld;

    expect(st.updates).toEqual([]);
    expect(st.execInserts).toEqual([]);
    expect(st.execSql).toEqual([]);
    expect(st.tradeLogs).toEqual([]);
    expect(sendAlertThrottled).not.toHaveBeenCalled();
    expect(absentTrackerSize()).toBe(0);
    expect(rOld).toMatchObject({ complete: false, errors: ['fenced'], synced: 0, partialSettlements: [] });
    expect(rOld.unreconciled).toEqual([]);                        // ③ 펜스가 보류(track)로 새지 않는다
    expect(warnText()).toMatch(/ORDER_SYNC_RUN_FENCED run=\d+ runAgeSec=\d+ superseded=true/);
  });

  test('② 새 회차 없이 경과 시간만 RUN_FENCE_MS 를 넘겨도 쓰기 0 (경과 검사가 본체)', async () => {
    const st = setupDb([row({ id: 130, symbol: '005930', type: 'limit', price: 70_000 })]);
    let release!: (v: unknown) => void;
    (getActiveOrdersDetailed as jest.Mock).mockReturnValueOnce(new Promise(res => { release = res; }));
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);

    const p = syncPendingOrders();
    await flush();
    at(T0 + RUN_FENCE_MS + MIN);                        // 워치독(15분) 전 — 표식은 없다
    release(bothOk([]));
    const r = await p;

    expect(st.updates).toEqual([]);
    expect(st.tradeLogs).toEqual([]);
    expect(r).toMatchObject({ complete: false, errors: ['fenced'] });
    expect(r.unreconciled).toEqual([]);
    expect(warnText()).toMatch(/ORDER_SYNC_RUN_FENCED .*superseded=false/);
  });

  test('③ 벽시계가 뒤로 조정돼 경과 검사가 놓쳐도 superseded 표식이 막는다 (표식은 보조)', async () => {
    const st = setupDb([row({ id: 140, symbol: '005930', type: 'limit', price: 70_000 })]);
    let releaseOld!: (v: unknown) => void;
    (getActiveOrdersDetailed as jest.Mock)
      .mockReturnValueOnce(new Promise(res => { releaseOld = res; }))
      .mockResolvedValue(bothOk([{ orderId: 'E140', symbol: '005930' }]));   // 새 회차: 살아 있음 → 쓰기 없음
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);

    const pOld = syncPendingOrders();
    await flush();
    at(T0 + INFLIGHT_STALE_MS + MIN);
    await syncPendingOrders();                          // 워치독 → 옛 회차 superseded
    at(T0 + MIN);                                       // 시계가 뒤로 조정됨 — 경과 1분
    releaseOld(bothOk([]));                             // 옛 스냅샷: 부재 → 막지 않으면 취소
    const rOld = await pOld;

    expect(st.updates).toEqual([]);
    expect(st.tradeLogs.some(l => l.event === 'cancel_inferred')).toBe(false);
    expect(rOld).toMatchObject({ errors: ['fenced'] });
  });

  test('④ 주문 처리 도중(쓰기 직전 조회)에서 멈췄다 풀려도 펜스가 주문별 catch 로 새지 않고 회차 밖으로 나간다', async () => {
    const st = setupDb([
      row({ id: 160, exchange_order_id: 'E160', symbol: '005930', type: 'limit', price: 70_000 }),   // 1/10 체결·소멸 → 종결 경로
      row({ id: 161, exchange_order_id: 'E161', symbol: '005930', type: 'limit', price: 70_000 }),   // 부재 → 취소 경로
    ]);
    let release!: (v: unknown) => void;
    st.gate = { re: /SELECT id FROM executions/, wait: new Promise(res => { release = res; }) };
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([fill('E160', 1, { price: 70_000 })]);

    const p = syncPendingOrders();
    await flush();
    at(T0 + RUN_FENCE_MS + MIN);
    release(undefined);
    const r = await p;

    expect(r.unreconciled).toEqual([]);                 // 삼켰다면 160 이 미판정으로 track 됐을 것
    expect(r.errors).toEqual(['fenced']);
    expect(st.updates).toEqual([]);                     // 161 의 취소도 나가지 않는다
    expect(st.execInserts).toEqual([]);
    expect(st.tradeLogs).toEqual([]);

    // 펜스가 주문별 catch 에서 삼켜졌다면 그 회차가 160 을 '미판정'으로 track 해 정체 시계를 낡은 시각에
    // 걸어 두었을 것이다 → 다음 정상 회차의 보류 경과가 0 이 아니게 된다. 0 이어야 맵이 오염되지 않은 것.
    at(T0 + RUN_FENCE_MS + 2 * MIN);
    (getCompletedOrders as jest.Mock).mockRejectedValue(new Error('rate limit'));
    const r2 = await syncPendingOrders();
    expect(r2.unreconciled.find(u => u.id === 160)).toMatchObject({ reason: 'completed_query_failed', unreconciledForMs: 0 });
  });

  test('정상 회차(수십 초)는 펜스에 걸리지 않는다', async () => {
    const st = setupDb([row({ id: 150, symbol: '005930', type: 'limit', price: 70_000 })]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue(bothOk([]));
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);
    const r = await syncPendingOrders();
    expect(st.updates[0].sql).toMatch(/status='cancelled'/);
    expect(r.errors).toEqual([]);
  });
});

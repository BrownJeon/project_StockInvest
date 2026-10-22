/**
 * T-071 WP-1b — 비상 전체 취소는 **취소 결과를 보고** 기록한다.
 *
 * `kis.cancelOrder` 는 KIS 오류를 예외가 아니라 `{ ok:false }` 로 돌려준다. 예전 라우트는 결과를 보지
 * 않고 `cancelled` 로 기록해, 브로커에 살아 있는 주문을 DB 에서 종결시켰다(추적 상실).
 * 이 파일은 ① ok 일 때만 cancelled ② 실패는 상태 유지 + cancel_failed ③ 대상 쿼리·취소 요청 수 불변
 * (취소를 더 보내지 않는다) ④ 브로커 취소 성공 뒤 상태가 바뀐 행은 cancelled 로 덮지 않는다 를 고정한다.
 */
import { POST } from '../route';
import { getPool } from '@/lib/db';
import { kis } from '@/lib/exchanges/kis';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/exchanges/kis', () => ({ kis: { cancelOrder: jest.fn() } }));

interface Cap {
  selects: string[];
  updates: Array<{ sql: string; params: unknown[] }>;
  logs: Array<{ orderId: number; event: string; params: unknown[] }>;
}

function setupDb(
  rows: Array<{ id: number; exchange_order_id: string; symbol: string; side: string }>,
  affectedRows: (id: number) => number = () => 1,
): Cap {
  const cap: Cap = { selects: [], updates: [], logs: [] };
  const query = jest.fn(async (sqlArg: unknown, params: unknown[] = []) => {
    const sql = String(sqlArg);
    if (/^\s*SELECT/i.test(sql)) { cap.selects.push(sql); return [rows]; }
    if (/UPDATE orders/i.test(sql)) {
      cap.updates.push({ sql, params });
      return [{ affectedRows: affectedRows(Number(params[0])) }];
    }
    if (/INSERT INTO trade_logs/i.test(sql)) {
      const ev = /'(cancelled|cancel_failed|cancel_requested)'/.exec(sql)?.[1] ?? '?';
      cap.logs.push({ orderId: Number(params[0]), event: ev, params });
      return [{ insertId: 1 }];
    }
    return [[]];
  });
  (getPool as jest.Mock).mockReturnValue({ query });
  return cap;
}

const ROWS = [
  { id: 1, exchange_order_id: 'E1', symbol: '005930', side: 'buy' },
  { id: 2, exchange_order_id: 'E2', symbol: 'NAS:AAPL', side: 'sell' },
];

beforeEach(() => jest.clearAllMocks());

describe('POST /api/safety/cancel-all — 취소 결과 확인 (T-071 WP-1b)', () => {
  test('ok:true → cancelled 로 조건부 UPDATE + cancelled 감사', async () => {
    const cap = setupDb([ROWS[0]]);
    (kis.cancelOrder as jest.Mock).mockResolvedValue({ ok: true, exchangeOrderId: 'E1' });

    const res = await POST();
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, cancelled: 1, failed: 0, unconfirmed: 0 });
    expect(cap.updates).toHaveLength(1);
    expect(cap.updates[0].sql).toMatch(/status='cancelled'/);
    expect(cap.updates[0].sql).toMatch(/WHERE id=\? AND status IN \('pending', 'accepted'\)/);
    expect(cap.logs.map(l => l.event)).toEqual(['cancelled']);
  });

  test('🔴 회귀 — ok:false 면 상태를 바꾸지 않고 cancel_failed 로 남긴다', async () => {
    const cap = setupDb([ROWS[1]]);
    (kis.cancelOrder as jest.Mock).mockResolvedValue({ ok: false, error: 'KIS overseas cancel HTTP 500' });

    const body = await (await POST()).json();
    expect(cap.updates).toEqual([]);
    expect(cap.logs).toEqual([expect.objectContaining({ orderId: 2, event: 'cancel_failed' })]);
    expect(cap.logs[0].params).toEqual([2, 'KIS overseas cancel HTTP 500']);
    expect(body).toMatchObject({ cancelled: 0, failed: 1 });
    expect(body.results[0]).toMatchObject({ id: 2, ok: false, error: 'KIS overseas cancel HTTP 500' });
  });

  test('예외 → 상태 유지 + cancel_failed (기존 동작)', async () => {
    const cap = setupDb([ROWS[0]]);
    (kis.cancelOrder as jest.Mock).mockRejectedValue(new Error('fetch failed'));

    const body = await (await POST()).json();
    expect(cap.updates).toEqual([]);
    expect(cap.logs.map(l => l.event)).toEqual(['cancel_failed']);
    expect(body).toMatchObject({ cancelled: 0, failed: 1 });
  });

  test('C4 — 브로커 취소는 성공했는데 그 사이 상태가 바뀌어 UPDATE 0행이면 cancelled 감사를 쓰지 않는다', async () => {
    const cap = setupDb([ROWS[0]], () => 0);
    (kis.cancelOrder as jest.Mock).mockResolvedValue({ ok: true });

    const body = await (await POST()).json();
    expect(cap.logs.map(l => l.event)).toEqual(['cancel_requested']);
    expect(body).toMatchObject({ cancelled: 0, failed: 1, unconfirmed: 1 });
  });

  test('🔴 대상 쿼리 불변 — pending/accepted 만, partially_filled 는 대상이 아니다(취소를 더 보내지 않는다)', async () => {
    const cap = setupDb(ROWS);
    (kis.cancelOrder as jest.Mock).mockResolvedValue({ ok: true });

    await POST();
    expect(cap.selects).toHaveLength(1);
    expect(cap.selects[0]).toMatch(/status IN \('pending', 'accepted'\)/);
    expect(cap.selects[0]).not.toMatch(/partially_filled/);
    expect(kis.cancelOrder).toHaveBeenCalledTimes(ROWS.length);   // 행마다 정확히 1회
    expect(kis.cancelOrder).toHaveBeenNthCalledWith(1, { symbol: '005930', exchangeOrderId: 'E1' });
    expect(kis.cancelOrder).toHaveBeenNthCalledWith(2, { symbol: 'NAS:AAPL', exchangeOrderId: 'E2' });
  });

  test('혼합 — 하나 성공·하나 실패면 집계가 실제 결과를 반영한다', async () => {
    setupDb(ROWS);
    (kis.cancelOrder as jest.Mock)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: 'rejected' });

    const body = await (await POST()).json();
    expect(body).toMatchObject({ ok: true, cancelled: 1, failed: 1 });
  });
});

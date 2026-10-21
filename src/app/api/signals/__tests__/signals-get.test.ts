/**
 * T-049 — `GET /api/signals` 옵트인 파라미터 2개(`includeExpired=1`·`withOrder=1`) 계약 고정.
 *
 * 🔴 이 파일의 최대 목적은 **다른 소비자 회귀 방지**다. 이 API 는 승인 대기 큐·추천·트레이딩 보드·
 *    대시보드 카운트 등 14곳이 쓴다. 두 파라미터가 **없거나 값이 정확히 `'1'` 이 아니면** SQL 문자열·
 *    바인딩 값·응답 모양이 변경 전과 바이트 단위로 같아야 한다 — 아래 `baseSql`/`EXPIRES` 는 변경 전
 *    (`5fec4ff`) SQL 을 그대로 옮겨 적은 것에 **T-062 WP-U 의 `market` 열 한 단어만** 더한 것이다(승인 데모 v2,
 *    Reviewer PASS — 화면이 국내·해외를 구분하려고 응답 행에 `market` 키 1개가 늘었고 WHERE·ORDER·LIMIT·바인딩은 그대로).
 *    그 밖의 이유로 이 값을 고쳐야 테스트가 통과한다면 그건 회귀다.
 *
 * - `includeExpired=1` : `status` 가 있을 때 붙던 만료 제외 절만 생략(대시보드 "내 결정" 섹션 전용).
 * - `withOrder=1`      : `orders` PK `IN (...)` 2차 조회로 `order_status`·`order_blocked_by` 를 붙인다.
 *                        2차 조회 실패는 500 — null 로 채워 성공시키면 번호 있는 카드가 전부 거짓 경고가 된다.
 */
import { GET } from '../route';
import { getPool } from '@/lib/db';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
// 라우트 모듈이 함께 import 하는 POST 경로 의존성 — GET 은 쓰지 않지만 부작용 없이 막아 둔다.
jest.mock('@/lib/signals/service', () => ({ createSignal: jest.fn() }));
jest.mock('@/lib/signals/router', () => ({ isEngineEnabled: jest.fn(async () => true) }));
jest.mock('@/lib/strategy/market-hours', () => ({
  isDomesticOpen: jest.fn(async () => true),
  isOverseasOpen: jest.fn(async () => true),
}));

const mockedGetPool = getPool as jest.MockedFunction<typeof getPool>;

/**
 * 변경 전 SELECT 문 — 공백·줄바꿈까지 그대로.
 * T-062 WP-U: 화면이 국내·해외를 구분하도록 `market` 컬럼 한 단어만 추가했다(승인 데모 v2, 가이드 G2-④).
 * WHERE·ORDER·LIMIT·바인딩·응답 모양은 그대로이고, 응답 행에 `market` 키가 하나 늘 뿐이다.
 */
function baseSql(whereSql: string): string {
  return `SELECT id, strategy_id, symbol, side, order_type, price, quantity, amount_krw,
              reasoning, indicators, status, expires_at, valid_from, market, scenario_source,
              consumed_order_id, created_at, updated_at
       FROM signals
       ${whereSql}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`;
}
const EXPIRES = '(expires_at IS NULL OR expires_at >= NOW())';

type Row = Record<string, unknown>;
let query: jest.Mock;

function sig(id: number, consumed: number | null, over: Row = {}): Row {
  return {
    id, strategy_id: 's1', symbol: '005930', side: 'buy', order_type: 'limit',
    price: '70000.0000', quantity: '1.00000000', amount_krw: '70000.00',
    reasoning: null, indicators: null, status: 'executing',
    expires_at: new Date('2026-10-01T00:00:00Z'), valid_from: null, scenario_source: null,
    consumed_order_id: consumed,
    created_at: new Date('2026-10-01T00:00:00Z'), updated_at: new Date('2026-10-01T00:05:00Z'),
    ...over,
  };
}

/** 1차(signals) 응답과, 있으면 2차(orders) 응답을 순서대로 돌려준다. */
function setup(signalRows: Row[], orderRows?: Row[] | Error) {
  query = jest.fn();
  query.mockResolvedValueOnce([signalRows, []]);
  if (orderRows instanceof Error) query.mockRejectedValueOnce(orderRows);
  else if (orderRows) query.mockResolvedValueOnce([orderRows, []]);
  mockedGetPool.mockReturnValue({ query } as never);
}

async function call(qs: string) {
  const res = await GET(new Request(`http://x/api/signals${qs}`));
  return { status: res.status, body: await res.json() };
}

beforeEach(() => { jest.clearAllMocks(); });

// ── 1. 파라미터가 없을 때 — 변경 전과 같은 SQL·응답 ───────────────────────────
describe('GET /api/signals — 새 파라미터 없음: 변경 전과 동일 (다른 소비자 회귀 방지)', () => {
  test('파라미터 없음 → WHERE 없는 SQL, LIMIT 50, 쿼리 1회', async () => {
    setup([sig(1, null)]);
    const { status, body } = await call('');
    expect(status).toBe(200);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toBe(baseSql(''));
    expect(query.mock.calls[0][1]).toEqual([50]);
    expect(body.ok).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).not.toHaveProperty('order_status');
    expect(body.data[0]).not.toHaveProperty('order_blocked_by');
  });

  test('status 하나 → status = ? + 만료 제외 절', async () => {
    setup([]);
    await call('?status=approved_pending_entry&limit=100');
    expect(query.mock.calls[0][0]).toBe(baseSql(`WHERE status = ? AND ${EXPIRES}`));
    expect(query.mock.calls[0][1]).toEqual(['approved_pending_entry', 100]);
  });

  test('status 여러 개 + since + limit → 절 순서(since → status → 만료) 그대로', async () => {
    setup([]);
    await call('?status=approved,rejected&since=2026-10-11T00:00:00.000Z&limit=200');
    expect(query.mock.calls[0][0]).toBe(
      baseSql(`WHERE created_at >= ? AND status IN (?,?) AND ${EXPIRES}`),
    );
    expect(query.mock.calls[0][1]).toEqual([
      new Date('2026-10-11T00:00:00.000Z'), 'approved', 'rejected', 200,
    ]);
  });

  test('symbol·consumedOrderId·scenarioSource·status 조합 → 기존 순서 그대로', async () => {
    setup([]);
    await call('?scenarioSource=post-market&status=pending&limit=20&symbol=005930&consumedOrderId=7');
    expect(query.mock.calls[0][0]).toBe(
      baseSql(`WHERE symbol = ? AND consumed_order_id = ? AND scenario_source = ? AND status = ? AND ${EXPIRES}`),
    );
    expect(query.mock.calls[0][1]).toEqual(['005930', 7, 'post-market', 'pending', 20]);
  });

  test('응답 행은 DB 행 그대로(키 추가 없음)', async () => {
    const rows = [sig(1, 10), sig(2, null)];
    setup(rows);
    const { body } = await call('?status=executing');
    expect(body.data).toEqual(JSON.parse(JSON.stringify(rows)));
    for (const r of body.data) {
      expect(Object.keys(r).sort()).toEqual(Object.keys(rows[0]).sort());
    }
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('limit 클램프 1~1000 불변', async () => {
    setup([]);
    await call('?limit=5000');
    expect(query.mock.calls[0][1]).toEqual([1000]);
    setup([]);
    await call('?limit=0');
    expect(query.mock.calls[0][1]).toEqual([1]);
  });
});

// ── 2. includeExpired ─────────────────────────────────────────────────────
describe('GET /api/signals — includeExpired=1 은 만료 제외 절만 뺀다', () => {
  test('includeExpired=1 + status 여러 개 + since + limit → 만료 절만 없음, 나머지 동일', async () => {
    setup([]);
    await call('?status=approved,rejected&since=2026-10-11T00:00:00.000Z&limit=200&includeExpired=1');
    expect(query.mock.calls[0][0]).toBe(baseSql('WHERE created_at >= ? AND status IN (?,?)'));
    expect(query.mock.calls[0][1]).toEqual([
      new Date('2026-10-11T00:00:00.000Z'), 'approved', 'rejected', 200,
    ]);
  });

  test('includeExpired=1 + status 하나', async () => {
    setup([]);
    await call('?status=expired&includeExpired=1');
    expect(query.mock.calls[0][0]).toBe(baseSql('WHERE status = ?'));
    expect(query.mock.calls[0][1]).toEqual(['expired', 50]);
  });

  test('includeExpired=1 인데 status 없음 → 원래 절이 없으므로 파라미터 없음과 같다', async () => {
    setup([]);
    await call('?includeExpired=1');
    expect(query.mock.calls[0][0]).toBe(baseSql(''));
    expect(query.mock.calls[0][1]).toEqual([50]);
  });

  test.each(['true', '0', '2', '', 'yes', ' 1', '01'])(
    "includeExpired=%p (정확히 '1' 이 아님) → 만료 절 유지",
    async (v) => {
      setup([]);
      await call(`?status=approved&includeExpired=${encodeURIComponent(v)}`);
      expect(query.mock.calls[0][0]).toBe(baseSql(`WHERE status = ? AND ${EXPIRES}`));
      expect(query.mock.calls[0][1]).toEqual(['approved', 50]);
    },
  );

  test('includeExpired=1 은 limit 클램프·정렬을 바꾸지 않는다', async () => {
    setup([]);
    await call('?status=approved&includeExpired=1&limit=99999');
    expect(query.mock.calls[0][0]).toContain('ORDER BY created_at DESC, id DESC');
    expect(query.mock.calls[0][1]).toEqual(['approved', 1000]);
  });
});

// ── 3. withOrder ──────────────────────────────────────────────────────────
describe('GET /api/signals — withOrder=1 은 주문 상태 2개 키를 붙인다', () => {
  test('2차 조회 1회 — 중복 제거·null 제외 id, 1차 SQL 은 그대로', async () => {
    setup(
      [sig(1, 10), sig(2, null), sig(3, 10), sig(4, 11), sig(5, 99)],
      [
        { id: 10, status: 'accepted', blocked_by: null },
        { id: 11, status: 'rejected', blocked_by: 'kis_5xx' },
      ],
    );
    const { status, body } = await call('?status=executing&withOrder=1');
    expect(status).toBe(200);
    expect(query).toHaveBeenCalledTimes(2);
    // 1차 SQL 은 withOrder 와 무관하게 변경 전 그대로
    expect(query.mock.calls[0][0]).toBe(baseSql(`WHERE status = ? AND ${EXPIRES}`));
    expect(query.mock.calls[0][1]).toEqual(['executing', 50]);
    // 2차 = orders PK IN 조회, JOIN 아님
    expect(query.mock.calls[1][0]).toBe('SELECT id, status, blocked_by FROM orders WHERE id IN (?,?,?)');
    expect(query.mock.calls[1][1]).toEqual([10, 11, 99]);

    const byId = Object.fromEntries(body.data.map((r: Row) => [r.id, r]));
    expect(byId[1]).toMatchObject({ consumed_order_id: 10, order_status: 'accepted', order_blocked_by: null });
    expect(byId[2]).toMatchObject({ consumed_order_id: null, order_status: null, order_blocked_by: null });
    expect(byId[3]).toMatchObject({ consumed_order_id: 10, order_status: 'accepted', order_blocked_by: null });
    expect(byId[4]).toMatchObject({ consumed_order_id: 11, order_status: 'rejected', order_blocked_by: 'kis_5xx' });
    // 번호는 있지만 주문 행이 없음 → 둘 다 null (화면에서 "확인 필요")
    expect(byId[5]).toMatchObject({ consumed_order_id: 99, order_status: null, order_blocked_by: null });
    // 두 키는 항상 존재 (undefined 로 빠지지 않음)
    for (const r of body.data) {
      expect(r).toHaveProperty('order_status');
      expect(r).toHaveProperty('order_blocked_by');
    }
    // 정렬(1차 쿼리 순서) 유지
    expect(body.data.map((r: Row) => r.id)).toEqual([1, 2, 3, 4, 5]);
  });

  test('id 가 문자열·다른 행 순서로 와도 id 기준으로 붙는다', async () => {
    setup(
      [sig(1, 21), sig(2, 20)],
      [
        { id: '20', status: 'filled', blocked_by: null },
        { id: '21', status: 'dry_run', blocked_by: null },
      ],
    );
    const { body } = await call('?withOrder=1');
    expect(body.data[0]).toMatchObject({ id: 1, order_status: 'dry_run' });
    expect(body.data[1]).toMatchObject({ id: 2, order_status: 'filled' });
  });

  test('번호가 하나도 없으면 2차 조회 0회, 두 키는 null', async () => {
    setup([sig(1, null), sig(2, null)]);
    const { body } = await call('?status=executing&withOrder=1');
    expect(query).toHaveBeenCalledTimes(1);
    for (const r of body.data) {
      expect(r.order_status).toBeNull();
      expect(r.order_blocked_by).toBeNull();
    }
  });

  test('빈 결과 → 2차 조회 0회, 빈 배열', async () => {
    setup([]);
    const { body } = await call('?withOrder=1');
    expect(query).toHaveBeenCalledTimes(1);
    expect(body).toEqual({ ok: true, data: [] });
  });

  test('2차 조회 예외 → 500 {ok:false} (null 로 채워 성공시키지 않는다)', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    setup([sig(1, 10)], new Error('orders down'));
    const { status, body } = await call('?status=executing&withOrder=1');
    expect(status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('orders down');
    expect(body.data).toBeUndefined();
    spy.mockRestore();
  });

  test.each(['true', '0', '2', '', 'yes'])(
    "withOrder=%p (정확히 '1' 이 아님) → 2차 조회 없음, 키 없음",
    async (v) => {
      setup([sig(1, 10)]);
      const { body } = await call(`?status=executing&withOrder=${encodeURIComponent(v)}`);
      expect(query).toHaveBeenCalledTimes(1);
      expect(body.data[0]).not.toHaveProperty('order_status');
      expect(body.data[0]).not.toHaveProperty('order_blocked_by');
    },
  );

  test('대시보드 섹션 정본 URL — 두 파라미터 함께', async () => {
    setup([sig(1, 10)], [{ id: 10, status: 'filled', blocked_by: null }]);
    const { body } = await call(
      '?status=approved,rejected,approved_pending_entry,executing,expired,auto_submitted'
      + '&since=2026-10-11T00:00:00.000Z&limit=200&includeExpired=1&withOrder=1',
    );
    expect(query.mock.calls[0][0]).toBe(baseSql('WHERE created_at >= ? AND status IN (?,?,?,?,?,?)'));
    expect(query.mock.calls[0][1]).toEqual([
      new Date('2026-10-11T00:00:00.000Z'),
      'approved', 'rejected', 'approved_pending_entry', 'executing', 'expired', 'auto_submitted', 200,
    ]);
    expect(body.data[0]).toMatchObject({ order_status: 'filled', order_blocked_by: null });
  });
});

// ── 4. 1차 조회 실패는 기존과 같은 500 ─────────────────────────────────────
test('1차 조회 예외 → 기존과 같은 500 {ok:false,error}', async () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  query = jest.fn().mockRejectedValueOnce(new Error('db down'));
  mockedGetPool.mockReturnValue({ query } as never);
  const { status, body } = await call('?status=approved');
  expect(status).toBe(500);
  expect(body).toEqual({ ok: false, error: 'db down' });
  spy.mockRestore();
});

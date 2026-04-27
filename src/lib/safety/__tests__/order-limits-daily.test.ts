import type { OrderRequest } from '@/lib/exchanges/types';
import { getPool } from '@/lib/db';
import { checkDailyMax } from '../order-limits';

jest.mock('@/lib/db', () => ({
  getPool: jest.fn(),
}));

const base: OrderRequest = {
  exchange: 'coinone',
  symbol: 'KRW-BTC',
  side: 'buy',
  type: 'limit',
  amountKRW: 10_000,
};

function mockPool(sumKRW: number | null) {
  const query = jest.fn().mockResolvedValue(
    sumKRW == null ? [[]] : [[{ sum_krw: sumKRW }]],
  );
  (getPool as jest.Mock).mockReturnValue({ query });
  return query;
}

describe('checkDailyMax', () => {
  afterEach(() => jest.clearAllMocks());

  test('한도 미설정 시 거부', async () => {
    mockPool(0);
    const r = await checkDailyMax(base, 0);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('daily_limit');
  });

  test('amount 산출 불가 시 거부', async () => {
    mockPool(0);
    const r = await checkDailyMax({ exchange: 'coinone', symbol: 'KRW-BTC', side: 'buy', type: 'limit' }, 50_000);
    expect(r.ok).toBe(false);
  });

  test('누적 0 + 이번 주문 10,000 ≤ 50,000 한도 → ok', async () => {
    const query = mockPool(0);
    const r = await checkDailyMax(base, 50_000);
    expect(r.ok).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toMatch(/SUM\(amount_krw\)/);
    expect(String(sql)).toMatch(/status NOT IN/);
    expect(String(sql)).toMatch(/market = \?/);
    expect(params[0]).toBeInstanceOf(Date);
    expect(params[1]).toMatch(/^(domestic|overseas)$/);
  });

  test('누적 40,000 + 이번 10,000 = 50,000 (한도와 같음) → ok', async () => {
    mockPool(40_000);
    const r = await checkDailyMax(base, 50_000);
    expect(r.ok).toBe(true);
  });

  test('누적 45,000 + 이번 10,000 > 50,000 → 거부 + 상세 포함', async () => {
    mockPool(45_000);
    const r = await checkDailyMax(base, 50_000);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('daily_limit');
    expect(r.detail).toMatch(/^(domestic|overseas) 45000\+10000 > 50000$/);
  });

  test('DB 에러 → 보수적으로 거부', async () => {
    const query = jest.fn().mockRejectedValue(new Error('connection lost'));
    (getPool as jest.Mock).mockReturnValue({ query });
    const r = await checkDailyMax(base, 50_000);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('daily_limit');
    expect(r.detail).toBe('aggregate query failed');
  });

  test('SUM null → 0으로 해석', async () => {
    mockPool(null); // 빈 배열 반환
    const r = await checkDailyMax(base, 50_000);
    expect(r.ok).toBe(true);
  });
});

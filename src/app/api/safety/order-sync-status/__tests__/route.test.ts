import { GET } from '../route';
import { listStaleTracking } from '@/lib/safety/order-sync-escalation';

jest.mock('@/lib/safety/order-sync-escalation', () => ({
  STRUCTURAL_MS: 2 * 60 * 60_000,
  listStaleTracking: jest.fn(),
}));

describe('GET /api/safety/order-sync-status', () => {
  beforeEach(() => jest.clearAllMocks());

  test('빈 목록이면 count 0으로 응답', async () => {
    (listStaleTracking as jest.Mock).mockResolvedValue([]);
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      data: { count: 0, structuralCount: 0, oldestAgeMs: 0, items: [] },
    });
  });

  test('escalated 여부와 나이를 계산해 반환', async () => {
    const now = Date.now();
    (listStaleTracking as jest.Mock).mockResolvedValue([
      { orderId: 1, symbol: '005930', firstStaleAt: now - 3 * 60 * 60_000, escalatedAt: now - 1 * 60 * 60_000 },
      { orderId: 2, symbol: '000660', firstStaleAt: now - 40 * 60_000, escalatedAt: null },
    ]);
    const res = await GET();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.count).toBe(2);
    expect(body.data.structuralCount).toBe(1);
    expect(body.data.items).toHaveLength(2);
    expect(body.data.items[0]).toMatchObject({ orderId: 1, symbol: '005930', escalated: true });
    expect(body.data.items[1]).toMatchObject({ orderId: 2, symbol: '000660', escalated: false });
  });

  test('DB 오류 시 500과 ok:false', async () => {
    (listStaleTracking as jest.Mock).mockRejectedValue(new Error('conn fail'));
    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });
});

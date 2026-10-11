/**
 * T-042 — `POST /api/signals/[id]/approve` 의 **승인 경로 선택**.
 *
 * 하이브리드 모드(운영은 2026-05-23 부터 켜짐)에서 구간 없는 룰 시그널을 승인하면 예전에는 진입 감시로 넘어가
 * `no_zone` 으로 영원히 건너뛰어졌다 — 승인해도 주문이 안 나갔다. 구간이 있을 때만 감시로 보낸다.
 */
import { POST } from '../../signals/[id]/approve/route';
import { approveSignal, approveSignalHybrid, getSignalById } from '@/lib/signals/service';
import { getPool } from '@/lib/db';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/signals/service', () => ({
  approveSignal: jest.fn(async (id: number) => ({ ok: true, signalId: id, autoSubmitted: false, orderId: 1 })),
  approveSignalHybrid: jest.fn(async () => ({ ok: true, status: 'approved_pending_entry', message: '진입 감시가 시작됐습니다' })),
  getSignalById: jest.fn(),
}));

const mApprove = approveSignal as jest.Mock;
const mHybrid = approveSignalHybrid as jest.Mock;
const mGet = getSignalById as jest.Mock;

function setHybrid(enabled: boolean) {
  (getPool as jest.Mock).mockReturnValue({
    query: jest.fn(async () => [[{ value: JSON.stringify(enabled) }]]),
  });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body?: unknown) =>
  new Request('http://x/api/signals/1/approve', { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

const RULE = { id: 1, indicators: JSON.stringify({ rsi14: 30, price: 100 }) };
const CARD = { id: 2, indicators: JSON.stringify({ ai: { scenario: { entry: { price_zone: '100~110' } } } }) };

beforeEach(() => { jest.clearAllMocks(); });

describe('승인 경로 선택', () => {
  test('🔴 하이브리드 ON + 구간 없는 룰 시그널 → 즉시 주문 경로 (감시로 보내지 않는다)', async () => {
    setHybrid(true); mGet.mockResolvedValue(RULE);
    const res = await POST(post(), ctx('1'));
    expect(mApprove).toHaveBeenCalledWith(1);
    expect(mHybrid).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  test('하이브리드 ON + 진입 구간이 있는 시나리오 카드 → 진입 감시', async () => {
    setHybrid(true); mGet.mockResolvedValue(CARD);
    const res = await POST(post(), ctx('2'));
    expect(mHybrid).toHaveBeenCalledTimes(1);
    expect(mApprove).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  test('하이브리드 ON + 사용자가 구간을 직접 고쳐 보냄 → 구간이 없던 시그널도 감시', async () => {
    setHybrid(true); mGet.mockResolvedValue(RULE);
    await POST(post({ editedScenario: { entry: { price_zone: '90~95' } } }), ctx('1'));
    expect(mHybrid).toHaveBeenCalledWith(1, { entry: { price_zone: '90~95' } });
    expect(mApprove).not.toHaveBeenCalled();
  });

  test('하이브리드 OFF → 구간이 있어도 기존대로 즉시 주문', async () => {
    setHybrid(false); mGet.mockResolvedValue(CARD);
    await POST(post(), ctx('2'));
    expect(mApprove).toHaveBeenCalledWith(2);
    expect(mHybrid).not.toHaveBeenCalled();
  });

  test('시그널이 없어도(조회 null) 즉시 경로가 not_found 로 답한다 — 예외를 던지지 않는다', async () => {
    setHybrid(true); mGet.mockResolvedValue(null);
    mApprove.mockResolvedValueOnce({ ok: false, signalId: 9, autoSubmitted: false, error: 'not_found' });
    const res = await POST(post(), ctx('9'));
    expect(res.status).toBe(400);
  });
});

describe('응답 계약', () => {
  test('즉시 경로: 실패하면 400 + data 에 사유 (주문 거부도 더는 200 으로 보이지 않는다)', async () => {
    setHybrid(false); mGet.mockResolvedValue(RULE);
    mApprove.mockResolvedValueOnce({ ok: false, signalId: 1, autoSubmitted: false, error: 'order_not_accepted: order_limit', errorCode: 'order_not_accepted' });
    const res = await POST(post(), ctx('1'));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.data.errorCode).toBe('order_not_accepted');
  });

  test('잘못된 id → 400', async () => {
    const res = await POST(post(), ctx('abc'));
    expect(res.status).toBe(400);
    expect(mApprove).not.toHaveBeenCalled();
  });
});

/**
 * T-058 (S-4) — `POST /api/signals` 응답 계약: 현금 부족 건너뜀은 입력 오류(400)가 아니라 **HTTP 200 + skipped**.
 * 다른 `!ok` 는 기존대로 400. (이 엔드포인트를 POST 로 부르는 화면·스크립트는 저장소에 없다 — 2026-10-21 grep, GET 목록 호출만 있다.)
 */
import { POST } from '../route';
import { createSignal } from '@/lib/signals/service';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/signals/service', () => ({ createSignal: jest.fn() }));
jest.mock('@/lib/signals/router', () => ({ isEngineEnabled: jest.fn(async () => true) }));
jest.mock('@/lib/strategy/market-hours', () => ({
  isDomesticOpen: jest.fn(async () => true),
  isOverseasOpen: jest.fn(async () => true),
}));

const mocked = createSignal as jest.Mock;
const req = () => new Request('http://x/api/signals', {
  method: 'POST',
  body: JSON.stringify({ symbol: '005930', side: 'buy', orderType: 'limit', price: 70_000, quantity: 5, amountKRW: 350_000 }),
});

beforeEach(() => jest.clearAllMocks());

test('🔴 insufficient_cash → 200 + { ok:false, skipped:true, reason, data }', async () => {
  const result = { ok: false, signalId: 0, autoSubmitted: false, errorCode: 'insufficient_cash', error: 'insufficient_cash: x' };
  mocked.mockResolvedValue(result);
  const res = await POST(req());
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: false, skipped: true, reason: 'insufficient_cash', data: result });
});

test('다른 !ok(예: duplicate_active_signal·symbol_blacklisted)는 기존대로 400', async () => {
  for (const errorCode of ['duplicate_active_signal', 'symbol_blacklisted', undefined]) {
    mocked.mockResolvedValue({ ok: false, signalId: 0, autoSubmitted: false, errorCode, error: 'e' });
    const res = await POST(req());
    expect(res.status).toBe(400);
    expect((await res.json()).skipped).toBeUndefined();
  }
});

test('성공은 기존대로 200 + ok:true', async () => {
  mocked.mockResolvedValue({ ok: true, signalId: 5, autoSubmitted: false });
  const res = await POST(req());
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, data: { ok: true, signalId: 5, autoSubmitted: false } });
});

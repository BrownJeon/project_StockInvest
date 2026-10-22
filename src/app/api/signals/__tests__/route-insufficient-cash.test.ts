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

// ── T-072 G1 — 검증 상태 관문 건너뜀도 정책 건너뜀(200 + skipped). origin 은 'api_signals' 로 넘긴다 ──
test.each(['validation_gate', 'validation_lookup_error'])('🔴 %s → 200 + { ok:false, skipped:true, reason, data } (400 아님)', async (code) => {
  const result = {
    ok: false, signalId: 0, autoSubmitted: false, errorCode: code, error: `${code}: x`,
    validation: { reason: 'unregistered', strategyId: null, status: null, auditSignalId: 9001, paperFillId: 501, recorded: true, claim: 'not_requested' },
  };
  mocked.mockResolvedValue(result);
  const res = await POST(req());
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: false, skipped: true, reason: code, data: result });
});

test('🔴 T-072 — createSignal 에 막힌 매수의 가상 체결 출처 origin=api_signals 를 넘긴다(쿨다운 선점은 요청하지 않는다)', async () => {
  mocked.mockResolvedValue({ ok: true, signalId: 5, autoSubmitted: false });
  await POST(req());
  expect(mocked).toHaveBeenCalledTimes(1);
  expect(mocked.mock.calls[0][2]).toEqual({ origin: 'api_signals' });
});

// ── T-072 WP-2d — side 정규화: 변형은 정확한 값으로, buy/sell 이 아니면 400 + 한국어(createSignal 미호출) ──
const reqWith = (side: unknown) => new Request('http://x/api/signals', {
  method: 'POST',
  body: JSON.stringify({ symbol: '005930', side, orderType: 'limit', price: 70_000, quantity: 5, amountKRW: 350_000 }),
});
test.each([['BUY', 'buy'], ['Buy', 'buy'], [' buy ', 'buy'], ['SELL', 'sell'], [' sell', 'sell']])('🔴 side=%p → createSignal 에 정확히 %p', async (raw, norm) => {
  mocked.mockResolvedValue({ ok: true, signalId: 5, autoSubmitted: false });
  const res = await POST(reqWith(raw));
  expect(res.status).toBe(200);
  expect(mocked.mock.calls[0][0].side).toBe(norm);
});
test.each([['purchase'], ['sel'], ['   '], [123], [['buy']]])('🔴 side=%p → 400 + 한국어, createSignal 미호출', async (raw) => {
  const res = await POST(reqWith(raw));
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ ok: false, error: '주문 방향은 buy 또는 sell 이어야 합니다 (대소문자·앞뒤 공백은 허용)' });
  expect(mocked).not.toHaveBeenCalled();
});

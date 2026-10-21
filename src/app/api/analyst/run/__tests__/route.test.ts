/**
 * T-058 (S-3) — `POST /api/analyst/run` 이 `insufficient_cash` 를 생성 성공처럼 응답하지 않는다.
 *
 * 이전 코드는 `r.ok` 를 보지 않고 모두 `created` 에 넣었다 → `signalId: 0` 이 생성 성공처럼 보였다.
 * 이 task 는 `insufficient_cash` 만 `skipped` 로 보낸다(다른 ok:false 코드의 기존 취급은 범위 밖 — 아래 마지막 시험이 현행을 고정).
 */
import { POST } from '../route';
import { createSignal } from '@/lib/signals/service';
import { simpleRsiMomentum } from '@/lib/analyst/rules';

jest.mock('@/lib/exchanges/kis', () => ({ kis: { getTicker: jest.fn(async () => ({ price: 70_000 })), getCandles: jest.fn(async () => []) } }));
jest.mock('@/lib/analyst/rules', () => ({ simpleRsiMomentum: jest.fn() }));
jest.mock('@/lib/signals/router', () => ({
  getRouterConfig: jest.fn(async () => ({ defaultTtlMin: 30 })),
  isEngineEnabled: jest.fn(async () => true),
}));
jest.mock('@/lib/safety/order-limits', () => ({ getEffectiveOrderMax: jest.fn(async () => 350_000) }));
jest.mock('@/lib/signals/service', () => ({ createSignal: jest.fn() }));
jest.mock('@/lib/strategy/market-hours', () => ({ isDomesticOpen: jest.fn(async () => true) }));

const mockedCreate = createSignal as jest.Mock;
const rules = simpleRsiMomentum as jest.Mock;

const run = async () => {
  const res = await POST(new Request('http://x/api/analyst/run', { method: 'POST' }));
  return { status: res.status, body: await res.json() as { ok: boolean; data: { created: Array<{ symbol: string; signalId: number }>; skipped: Array<{ symbol: string; reason: string }> } } };
};

beforeEach(() => {
  jest.clearAllMocks();
  // 10개 기본 종목 중 첫 두 종목만 시그널 1건씩
  rules.mockImplementation(({ symbol }: { symbol: string }) => (
    symbol === '005930' || symbol === '000660'
      ? [{ symbol, side: 'buy', orderType: 'limit', price: 70_000, amountKRW: 350_000, strategyId: 'rsi_momentum_v1' }]
      : []
  ));
});

test('🔴 insufficient_cash → skipped(reason insufficient_cash), created 에 signalId 0 이 들어가지 않는다', async () => {
  mockedCreate.mockImplementation(async (s: { symbol: string }) => (
    s.symbol === '005930'
      ? { ok: false, signalId: 0, autoSubmitted: false, errorCode: 'insufficient_cash', error: 'insufficient_cash: x' }
      : { ok: true, signalId: 42, autoSubmitted: false }
  ));
  const { status, body } = await run();
  expect(status).toBe(200);
  expect(body.ok).toBe(true);
  expect(body.data.created).toEqual([{ symbol: '000660', signalId: 42, autoSubmitted: false }]);
  expect(body.data.created.some((c) => c.signalId === 0)).toBe(false);
  expect(body.data.skipped).toContainEqual({ symbol: '005930', reason: 'insufficient_cash' });
});

test('범위 밖 현행 고정: duplicate_active_signal 등 다른 ok:false 는 기존대로 created 에 들어간다 (후속 후보)', async () => {
  mockedCreate.mockResolvedValue({ ok: false, signalId: 777, autoSubmitted: false, errorCode: 'duplicate_active_signal', error: 'duplicate_active_signal' });
  const { body } = await run();
  expect(body.data.created.map((c) => c.signalId)).toEqual([777, 777]);
});

/**
 * T-058 (S-3) — `POST /api/analyst/run` 이 `insufficient_cash` 를 생성 성공처럼 응답하지 않는다.
 *
 * 이전 코드는 `r.ok` 를 보지 않고 모두 `created` 에 넣었다 → `signalId: 0` 이 생성 성공처럼 보였다.
 * 이 task 는 `insufficient_cash` 만 `skipped` 로 보낸다(다른 ok:false 코드의 기존 취급은 범위 밖 — 아래 마지막 시험이 현행을 고정).
 */
import { POST } from '../route';
import { createSignal } from '@/lib/signals/service';
import { simpleRsiMomentum } from '@/lib/analyst/rules';
import { getEffectiveOrderMax, getLegacyAnalystSellAmount } from '@/lib/safety/order-limits';
import { allocateAdaptiveBuys } from '@/lib/strategy/adaptive-buy-sizing';

jest.mock('@/lib/exchanges/kis', () => ({ kis: { getTicker: jest.fn(async () => ({ price: 70_000 })), getCandles: jest.fn(async () => []) } }));
jest.mock('@/lib/analyst/rules', () => ({ simpleRsiMomentum: jest.fn() }));
jest.mock('@/lib/signals/router', () => ({
  getRouterConfig: jest.fn(async () => ({ defaultTtlMin: 30 })),
  isEngineEnabled: jest.fn(async () => true),
}));
jest.mock('@/lib/safety/order-limits', () => ({
  getEffectiveOrderMax: jest.fn(async () => 350_000),
  getLegacyAnalystSellAmount: jest.fn(),
}));
jest.mock('@/lib/signals/service', () => ({ createSignal: jest.fn(), getEffectiveChasePct: jest.fn(async () => 1) }));
jest.mock('@/lib/strategy/adaptive-buy-sizing', () => ({ allocateAdaptiveBuys: jest.fn() }));
jest.mock('@/lib/strategy/style', () => ({ getStyleConfig: jest.fn(async () => ({ limitChasePct: 1 })) }));
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

test.each(['validation_gate', 'validation_lookup_error'])('🔴 T-072 — %s 도 skipped(reason=그 코드), created 에 signalId 0 이 들어가지 않는다', async (code) => {
  // rsi_momentum_v1 은 strategies 에 없는 ID 라(미등록 fail-closed) 실제로는 매수가 전부 여기로 온다
  mockedCreate.mockImplementation(async (s: { symbol: string }) => (
    s.symbol === '005930'
      ? { ok: false, signalId: 0, autoSubmitted: false, errorCode: code, error: `${code}: x` }
      : { ok: true, signalId: 42, autoSubmitted: false }
  ));
  const { status, body } = await run();
  expect(status).toBe(200);
  expect(body.data.created).toEqual([{ symbol: '000660', signalId: 42, autoSubmitted: false }]);
  expect(body.data.created.some((c) => c.signalId === 0)).toBe(false);
  expect(body.data.skipped).toContainEqual({ symbol: '005930', reason: code });
});

test('🔴 T-072 — createSignal 에 막힌 매수의 가상 체결 출처 origin=analyst_run 을 넘긴다(cfg 는 그대로)', async () => {
  mockedCreate.mockResolvedValue({ ok: true, signalId: 1, autoSubmitted: false });
  await run();
  expect(mockedCreate).toHaveBeenCalledTimes(2);
  for (const c of mockedCreate.mock.calls) {
    expect(c[1]).toEqual({ defaultTtlMin: 30 });
    expect(c[2]).toEqual({ origin: 'analyst_run' });
  }
});

test('범위 밖 현행 고정: duplicate_active_signal 등 다른 ok:false 는 기존대로 created 에 들어간다 (후속 후보)', async () => {
  mockedCreate.mockResolvedValue({ ok: false, signalId: 777, autoSubmitted: false, errorCode: 'duplicate_active_signal', error: 'duplicate_active_signal' });
  const { body } = await run();
  expect(body.data.created.map((c) => c.signalId)).toEqual([777, 777]);
});

test.each([[350_000, 350_000], ['unlimited', 350_000], ['unlimited', 0]] as const)(
  'one-order limit %s with sell amount %s keeps buy and sell sizing separate', async (limit, sellAmount) => {
    (getEffectiveOrderMax as jest.Mock).mockResolvedValueOnce(limit);
    (getLegacyAnalystSellAmount as jest.Mock).mockResolvedValueOnce(sellAmount);
    const mockAllocate = allocateAdaptiveBuys as jest.Mock;
    mockAllocate.mockImplementationOnce(async (_market, [buy]) => ({
      reason: 'allocated', orders: new Map([[buy, { ...buy, amountKRW: 140_000 }]]),
    }));
    mockedCreate.mockResolvedValue({ ok: true, signalId: 1, autoSubmitted: false });
    rules.mockImplementation(({ symbol }, { baseAmountKRW }) => (
      symbol === '005930' ? ['buy', 'sell'].map(side => ({ symbol, side, amountKRW: baseAmountKRW })) : []
    ));

    const { status, body } = await run();
    expect(status).toBe(200);
    const published = mockedCreate.mock.calls.map(([signal]) => signal);
    expect(published).toContainEqual({ symbol: '005930', side: 'buy', amountKRW: limit === 'unlimited' ? 140_000 : limit });
    if (sellAmount > 0) {
      expect(published).toContainEqual({ symbol: '005930', side: 'sell', amountKRW: sellAmount });
    } else {
      expect(published).toHaveLength(1);
      expect(body.data.skipped).toContainEqual({ symbol: '005930', reason: 'sell_amount_unavailable' });
    }
    expect(getLegacyAnalystSellAmount).toHaveBeenCalledTimes(limit === 'unlimited' ? 1 : 0);
    expect(mockAllocate).toHaveBeenCalledTimes(limit === 'unlimited' ? 1 : 0);
    mockAllocate.mockReset();
    (getLegacyAnalystSellAmount as jest.Mock).mockReset();
  },
);

import { getPool } from '@/lib/db';
import { runLlmOnce } from '@/lib/llm/provider';
import { getEffectiveDailyMax, readDailyBuyUsage } from '@/lib/safety/order-limits';
import { evaluateValidationGate } from '@/lib/safety/validation-gate';
import { readAvailableCash } from '@/lib/signals/entry-cash-precheck';
import { readGateUsdKrwRate } from '@/lib/signals/signal-cash-gate';
import type { SignalInput } from '@/lib/signals/router';
import { allocateAdaptiveBuys } from '../adaptive-buy-sizing';

jest.mock('@/lib/db', () => ({ getAccountId: async () => 7, getPool: jest.fn() }));
jest.mock('@/lib/llm/provider', () => ({ runLlmOnce: jest.fn() }));
jest.mock('@/lib/safety/order-limits', () => ({ getEffectiveDailyMax: jest.fn(), readDailyBuyUsage: jest.fn() }));
jest.mock('@/lib/safety/validation-gate', () => ({ evaluateValidationGate: jest.fn() }));
jest.mock('@/lib/signals/entry-cash-precheck', () => ({
  CASH_READ_TIMEOUT_MS: 8_000, ENTRY_CASH_BUFFER_RATIO: 0.002, readAvailableCash: jest.fn(),
}));
jest.mock('@/lib/signals/signal-cash-gate', () => ({
  ...jest.requireActual('@/lib/signals/signal-cash-gate'), readGateUsdKrwRate: jest.fn(),
}));
jest.mock('@/lib/signals/service', () => ({
  buildOrderRequest: (input: SignalInput, chase: number) => ({ req: { price: (input.price ?? 0) * (1 + chase) } }),
}));

const query = jest.fn();
const a: SignalInput = { side: 'buy', symbol: '005930', strategyId: 'a', orderType: 'limit', amountKRW: 0, price: 100_000 };
const b: SignalInput = { ...a, symbol: '000660', strategyId: 'b', price: 40_000 };
const ovs: SignalInput = { ...a, symbol: 'NAS:MU', price: 130_520 };
const model = jest.mocked(runLlmOnce);

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(getPool).mockReturnValue({ query } as unknown as ReturnType<typeof getPool>);
  query.mockResolvedValue([[{ reserved_krw: 0, unresolved: 0 }]]);
  jest.mocked(readAvailableCash).mockResolvedValue({ domesticKRW: 1_000_000, overseasUSD: 500, overseasUnknownReason: null });
  jest.mocked(readGateUsdKrwRate).mockResolvedValue({ kind: 'known', rate: 1300 });
  jest.mocked(getEffectiveDailyMax).mockResolvedValue('unlimited');
  jest.mocked(evaluateValidationGate).mockResolvedValue({ allowed: true, kind: 'validated', status: 'backtested', strategyId: 'a' });
  model.mockResolvedValue(JSON.stringify({ allocations: [{ id: 0, bps: 6000, reason: 'a' }, { id: 1, bps: 2000, reason: 'b' }] }));
});

test('domestic candidates get different allocations from cash net of open buys, leaving the rest unallocated', async () => {
  query.mockResolvedValue([[{ reserved_krw: 100_000, unresolved: 0 }]]);
  const r = await allocateAdaptiveBuys('domestic', [a, b], 0);
  expect(r.orders.get(a)).toMatchObject({ amountKRW: 539_880, quantity: 5, indicators: { adaptiveBuyAllocation: { bps: 6000 } } });
  expect(r.orders.get(b)).toMatchObject({ amountKRW: 179_960, quantity: 4 });
  expect(query.mock.calls[0][1]).toEqual([expect.any(Date), 7, 'domestic', 0, expect.any(Date)]);
  expect(model.mock.calls[0][0]).not.toContain('1000000');
  expect(model.mock.calls[0][1]).toMatchObject({ domain: 'domestic', toolFree: true });
});

test('overseas uses USD cents and preserves a finite daily budget', async () => {
  jest.mocked(getEffectiveDailyMax).mockResolvedValue(500_000);
  jest.mocked(readDailyBuyUsage).mockResolvedValue(160_000);
  model.mockResolvedValue('{"allocations":[{"id":0,"bps":10000,"reason":"candidate"}]}');
  const r = await allocateAdaptiveBuys('overseas', [ovs, a], 0);
  expect(r.orders.get(ovs)).toMatchObject({ amountKRW: 339_989, quantity: 2 });
  expect(r.orders.has(a)).toBe(false);
  expect(model.mock.calls[0][0]).not.toContain(a.symbol);
});

test.each([
  { allocations: [{ id: 0, bps: 6000, reason: 'a' }, { id: 1, bps: 4100, reason: 'b' }] },
  { allocations: [{ id: 2, bps: 1000, reason: 'unknown' }] },
  { allocations: [{ id: 0, bps: 1000, reason: 'a' }, { id: 0, bps: 1000, reason: 'duplicate' }] },
  { allocations: [{ id: 0, bps: '1000', reason: 'string' }] },
])('rejects the batch for malformed model allocation %j', async ({ allocations }) => {
  model.mockResolvedValue(JSON.stringify({ allocations }));
  expect(await allocateAdaptiveBuys('domestic', [a, b], 0)).toMatchObject({ orders: new Map(), reason: 'invalid_judgment' });
});

test('an unaffordable share, missing FX, or unvalidated strategy cannot produce a buy', async () => {
  model.mockResolvedValue('{"allocations":[{"id":0,"bps":1,"reason":"too small"}]}');
  expect((await allocateAdaptiveBuys('domestic', [a], 0)).orders.size).toBe(0);
  jest.mocked(readGateUsdKrwRate).mockResolvedValue({ kind: 'unknown', reason: 'fx_stale' });
  expect((await allocateAdaptiveBuys('overseas', [ovs], 0)).reason).toBe('cash_or_daily_limit_unavailable');
  jest.mocked(evaluateValidationGate).mockResolvedValue({ allowed: false, kind: 'blocked', reason: 'unregistered', strategyId: 'a', status: null });
  expect((await allocateAdaptiveBuys('domestic', [a], 0)).reason).toBe('no_validated_candidates');
  expect(model).toHaveBeenCalledTimes(1);
});

test('does not publish a decision after the engine deadline', async () => {
  jest.useFakeTimers();
  try {
    let finish!: (answer: string) => void;
    model.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const r = allocateAdaptiveBuys('domestic', [a], 0);
    await jest.advanceTimersByTimeAsync(8000);
    expect(await r).toMatchObject({ orders: new Map(), reason: 'judgment_unavailable' });
    finish('{"allocations":[{"id":0,"bps":10000,"reason":"late"}]}');
    await Promise.resolve();
  } finally {
    jest.useRealTimers();
  }
});

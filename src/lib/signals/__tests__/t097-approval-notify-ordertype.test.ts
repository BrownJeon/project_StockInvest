/**
 * T-097 Q-E Codex C2 — `createSignal` 이 승인 요청 알림에 시그널의 `orderType` 을 실제로 넘기는가.
 *
 * `approval-notify` 의 "수량" 줄은 `orderType === 'limit'` 일 때만 만들어진다. 호출부(`service.ts`)가 `orderType` 을
 * 넘기지 않으면 지정가 매수에서도 줄이 사라진다(fail-closed 라 안전하지만 승인된 데모와 다르다) — 그 배선을 고정한다.
 * 하네스는 `t097-sizing-record.test.ts` 와 같은 방식(DB·어댑터·알림 모듈 mock)이다. 그 파일은 건드리지 않는다.
 */
jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/exchanges/kis', () => ({ kis: { createOrder: jest.fn() }, getBalancesDetailed: jest.fn() }));
jest.mock('@/lib/exchanges/fx', () => ({ getUsdKrwRate: jest.fn(async () => 1324) }));
jest.mock('@/lib/safety/dry-run', () => ({ submitOrder: jest.fn(async () => ({ ok: true, orderId: 5000, dryRun: true })) }));
jest.mock('@/lib/safety/order-limits', () => ({
  ...jest.requireActual('@/lib/safety/order-limits'),
  checkSymbolBlacklist: jest.fn(async () => ({ ok: true })),
}));
jest.mock('@/lib/strategy/style', () => ({
  ...jest.requireActual('@/lib/strategy/style'),
  getStyleConfig: jest.fn(),
}));
jest.mock('../router', () => ({
  ...jest.requireActual('../router'),
  getRouterConfig: jest.fn(async () => ({ defaultTtlMin: 30, hybridModeEnabled: false })),
  getEngineSwitches: jest.fn(),
}));
jest.mock('../approval-notify', () => ({ notifyApprovalRequest: jest.fn(async () => undefined) }));
jest.mock('@/lib/notify', () => ({
  sendAlert: jest.fn(), dispatchAlertWithTelegram: jest.fn(async () => ({})), getSymbolLabel: jest.fn(async (s: string) => s),
}));
jest.mock('@/lib/notify/throttle', () => ({ sendAlertThrottled: jest.fn() }));
jest.mock('@/lib/rag/signals-upsert', () => ({ fireAndForgetUpsertSignal: jest.fn() }));

import { getPool } from '@/lib/db';
import { DEFAULT_STYLE_CONFIG, getStyleConfig } from '@/lib/strategy/style';
import { getEngineSwitches, type SignalInput } from '../router';
import { notifyApprovalRequest } from '../approval-notify';
import { createSignal } from '../service';

function setupDb() {
  const query = jest.fn(async (sqlArg: unknown) => {
    const sql = String(sqlArg);
    if (/FROM strategies/.test(sql)) return [[{ validation_status: 'backtested' }]];
    if (/INSERT INTO signals/.test(sql)) return [{ insertId: 7100 }];
    if (/UPDATE signals/.test(sql)) return [{ affectedRows: 1 }];
    return [[]];
  });
  (getPool as jest.Mock).mockReturnValue({ query, getConnection: async () => ({
    query, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
  }) });
}

async function flush() { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); }

const quiet: jest.SpyInstance[] = [];
beforeEach(() => {
  jest.clearAllMocks();
  setupDb();
  (getStyleConfig as jest.Mock).mockResolvedValue({ ...DEFAULT_STYLE_CONFIG, limitChasePct: 0.005 });
  (getEngineSwitches as jest.Mock).mockResolvedValue({ engineEnabled: true, autopilotMode: 'assist', source: 'config' });
  quiet.push(jest.spyOn(console, 'warn').mockImplementation(() => {}), jest.spyOn(console, 'log').mockImplementation(() => {}),
    jest.spyOn(console, 'info').mockImplementation(() => {}));
});
afterEach(() => { while (quiet.length) quiet.pop()!.mockRestore(); });

const buy = (over: Partial<SignalInput> = {}): SignalInput => ({
  strategyId: 'rsi-oversold-v1', symbol: '005930', side: 'buy', orderType: 'limit', price: 50_000, amountKRW: 100_000,
  reasoning: 'r', indicators: { rsi14: 31.2 }, ...over,
});

test.each<[string, Partial<SignalInput>, 'limit' | 'market']>([
  ['국내 지정가 매수', {}, 'limit'],
  ['국내 시장가 매수', { orderType: 'market' }, 'market'],
  ['해외 지정가 매수', { symbol: 'NAS:AAPL', price: 200 * 1324 }, 'limit'],
  ['해외 시장가 매수', { symbol: 'NAS:AAPL', price: 200 * 1324, orderType: 'market' }, 'market'],
])('승인 요청 알림에 시그널 orderType 을 그대로 넘긴다: %s', async (_l, over, expected) => {
  const r = await createSignal(buy(over));
  expect(r.ok).toBe(true);
  await flush();
  expect(notifyApprovalRequest).toHaveBeenCalledTimes(1);
  const arg = (notifyApprovalRequest as jest.Mock).mock.calls[0][0] as { orderType?: unknown; amountKRW: number; side: string };
  expect(arg.orderType).toBe(expected);
  expect(arg.amountKRW).toBe(100_000);                          // 버튼 서명 기준 금액 불변
  expect(arg.side).toBe('buy');
});

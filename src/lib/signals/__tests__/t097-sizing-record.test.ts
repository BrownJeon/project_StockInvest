/**
 * T-097 확정 설계 3 — 시그널 생성 시 `indicators.sizing` 기록.
 *
 * 지킬 것:
 *  - INSERT 의 `indicators` 에 `sizing`(rule·targetKrw·quantity·unitPriceKrw·realizedKrw·limitBasisKrw …)이 들어간다 — 기존 키는 그대로
 *  - `amount_krw`·`price`·`quantity` INSERT 값은 바뀌지 않는다(컬럼 의미 불변)
 *  - 기록 계산이 실패해도(스타일 설정 조회 예외) 시그널은 예전대로 만들어지고 `sizing` 만 빠진다
 *  - 승인 요청 알림에 넘어가는 `indicators` 에도 `sizing` 이 있다(4번 텔레그램 줄의 읽기 경로)
 *  - 1주 미만도 기록한다(H-G "1주 가격 > 시그널 금액" 판정용)
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
import { SIZING_RULE, readSizingSnapshot } from '../sizing-snapshot';

const FX = 1324;
let inserts: unknown[][];

function setupDb() {
  const query = jest.fn(async (sqlArg: unknown, params: unknown[] = []) => {
    const sql = String(sqlArg);
    if (/FROM strategies/.test(sql)) return [[{ validation_status: 'backtested' }]];
    if (/INSERT INTO signals/.test(sql)) { inserts.push(params); return [{ insertId: 7000 + inserts.length }]; }
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
  inserts = [];
  setupDb();
  (getStyleConfig as jest.Mock).mockResolvedValue({ ...DEFAULT_STYLE_CONFIG, limitChasePct: 0.005 });
  (getEngineSwitches as jest.Mock).mockResolvedValue({ engineEnabled: true, autopilotMode: 'assist', source: 'config' });
  quiet.push(jest.spyOn(console, 'warn').mockImplementation(() => {}), jest.spyOn(console, 'log').mockImplementation(() => {}),
    jest.spyOn(console, 'info').mockImplementation(() => {}));
});
afterEach(() => { while (quiet.length) quiet.pop()!.mockRestore(); });

/** INSERT 파라미터 순서: strategy_id, symbol, side, order_type, price, quantity, amount_krw, reasoning, indicators, status, expires_at, market */
const col = (p: unknown[]) => ({ price: p[4], quantity: p[5], amount: p[6], indicators: p[8] == null ? null : JSON.parse(String(p[8])), status: p[9] });

const buy = (over: Partial<SignalInput> = {}): SignalInput => ({
  strategyId: 'rsi-oversold-v1', symbol: '005930', side: 'buy', orderType: 'limit', price: 50_000, amountKRW: 100_000,
  reasoning: 'r', indicators: { rsi14: 31.2 }, ...over,
});

test('국내 지정가 매수(승인 대기) — 기존 키 유지 + sizing 기록, amount_krw·price·quantity 불변', async () => {
  const r = await createSignal(buy());
  expect(r.ok).toBe(true);
  expect(inserts).toHaveLength(1);
  const c = col(inserts[0]);
  expect(c.amount).toBe(100_000);
  expect(c.price).toBe(50_000);
  expect(c.quantity).toBeNull();
  expect(c.indicators.rsi14).toBe(31.2);
  expect(c.indicators.sizing).toEqual({
    rule: SIZING_RULE, targetKrw: 100_000, quantity: 1, unitPriceKrw: 50_000 * 1.005, realizedKrw: 50_000 * 1.005,
    limitBasisKrw: 100_000, quantitySource: 'amount', minOneShareApplied: false, chasePct: 0.005,
  });
  expect(readSizingSnapshot(String(inserts[0][8]))).toEqual(c.indicators.sizing);
});

test('해외 1주 미만(MU $880 · 10만) — quantity 0 으로 기록, 시그널은 예전대로 만든다', async () => {
  const r = await createSignal(buy({ symbol: 'NAS:MU', price: 880 * FX }));
  expect(r.ok).toBe(true);
  const c = col(inserts[0]);
  expect(c.amount).toBe(100_000);
  expect(c.indicators.sizing).toMatchObject({ quantity: 0, realizedKrw: null, limitBasisKrw: 100_000, quantitySource: 'amount' });
  expect(c.indicators.sizing.unitPriceKrw).toBeCloseTo(880 * FX * 1.005, 6);
});

test('indicators 가 없던 시그널 → { sizing } 만 / 배열 indicators 는 그대로', async () => {
  await createSignal(buy({ indicators: undefined }));
  expect(Object.keys(col(inserts[0]).indicators)).toEqual(['sizing']);
  await createSignal(buy({ symbol: '000660', indicators: [1, 2] }));
  expect(col(inserts[1]).indicators).toEqual([1, 2]);
});

test('호가 추격 꺼짐 스위치(safety_limit_chase_disabled) — 기록도 추격 0 으로', async () => {
  const query = jest.fn(async (sqlArg: unknown, params: unknown[] = []) => {
    const sql = String(sqlArg);
    if (/FROM system_config WHERE `key` = \?/.test(sql) && params[0] === 'safety_limit_chase_disabled') return [[{ value: 'true' }]];
    if (/FROM strategies/.test(sql)) return [[{ validation_status: 'backtested' }]];
    if (/INSERT INTO signals/.test(sql)) { inserts.push(params); return [{ insertId: 1 }]; }
    return [[]];
  });
  (getPool as jest.Mock).mockReturnValue({ query, getConnection: async () => ({
    query, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
  }) });
  await createSignal(buy());
  expect(col(inserts[0]).indicators.sizing).toMatchObject({ chasePct: 0, quantity: 2, unitPriceKrw: 50_000, realizedKrw: 100_000, limitBasisKrw: 100_000 });
});

test('🔴 기록 계산 실패(스타일 설정 예외) — sizing 만 빠지고 시그널·금액은 예전대로', async () => {
  (getStyleConfig as jest.Mock).mockRejectedValue(new Error('style db down'));
  const r = await createSignal(buy());
  expect(r.ok).toBe(true);
  const c = col(inserts[0]);
  expect(c.indicators).toEqual({ rsi14: 31.2 });
  expect(c.amount).toBe(100_000);
});

test('승인 요청 알림에 넘기는 indicators 에도 sizing 이 있다(4번 텔레그램 줄의 읽기 경로)', async () => {
  await createSignal(buy());
  await flush();
  expect(notifyApprovalRequest).toHaveBeenCalledTimes(1);
  const arg = (notifyApprovalRequest as jest.Mock).mock.calls[0][0] as { indicators: unknown; amountKRW: number };
  expect(arg.amountKRW).toBe(100_000);                          // 버튼 서명 기준 금액 불변
  expect(readSizingSnapshot(arg.indicators)?.quantity).toBe(1);
});

test('수량을 들고 온 매도(exit-engine) — quantitySource requested, 한도 기준은 목표금액', async () => {
  await createSignal(buy({ side: 'sell', strategyId: 'exit-engine-v1', orderType: 'market', quantity: 7, amountKRW: 350_000, indicators: { exit_kind: 'target_profit' } }));
  const c = col(inserts[0]);
  expect(c.quantity).toBe(7);
  expect(c.indicators.exit_kind).toBe('target_profit');
  expect(c.indicators.sizing).toMatchObject({ quantity: 7, quantitySource: 'requested', realizedKrw: 350_000, limitBasisKrw: 350_000 });
});

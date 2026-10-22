/**
 * T-072 G4 — `approveSignal` / `approveSignalHybrid` × 검증 상태 관문 (**실제 관문**, 호출 여부만 감싼다).
 *
 * 지킬 것 (설계 F-2·F-8, WP-2b 지시 4·8):
 *  1. 🔴 매수 행은 **선점 전에** 그 행의 strategy_id 로 판정한다. 막히면 선점(executing / approved_pending_entry) 0 · orders 행 0 ·
 *     submitOrder 0 · 시그널 상태 그대로(거짓 approved/rejected 없음), 결과 `{ ok:false, errorCode:'validation_gate'|'validation_lookup_error' }`.
 *     흔적 trade_logs `signal_validation_gate`(where signal-approve / signal-approve-hybrid).
 *  2. 🔴 매도 행은 관문이 strategies 조회 없이 통과시킨다 — 미등록 exit-engine-v1 도 기존대로 선점 → 주문.
 *     WP-2c R-1: 판정은 관문 함수 첫 줄에만 있다(service 의 `=== 'buy'` 지역 분기 제거). 행 side 가 'BUY' 같은 변형이어도 매수로 판정.
 *  3. 검증된 전략 매수는 기존대로 — 관문(조회) → 선점 → submitOrder(그 행의 전략 귀속 attribution).
 */
jest.mock('@/lib/db', () => ({ getPool: jest.fn(), getAccountId: jest.fn(async () => 1) }));
jest.mock('@/lib/exchanges/kis', () => ({ kis: { createOrder: jest.fn() }, getBalancesDetailed: jest.fn() }));
jest.mock('@/lib/safety/dry-run', () => ({ submitOrder: jest.fn(async () => ({ ok: true, orderId: 900, dryRun: true })) }));
jest.mock('@/lib/notify', () => ({ sendAlert: jest.fn(), getSymbolLabel: jest.fn(async (s: string) => s) }));
jest.mock('@/lib/notify/throttle', () => ({ sendAlertThrottled: jest.fn(() => true) }));
jest.mock('@/lib/strategy/style', () => ({ ...jest.requireActual('@/lib/strategy/style'), getStyleConfig: jest.fn(async () => ({ limitChasePct: 0 })) }));
jest.mock('@/lib/safety/validation-gate', () => {
  const actual = jest.requireActual('@/lib/safety/validation-gate');
  return { ...actual, evaluateValidationGate: jest.fn(actual.evaluateValidationGate) };
});

import { getPool } from '@/lib/db';
import { submitOrder } from '@/lib/safety/dry-run';
import { evaluateValidationGate } from '@/lib/safety/validation-gate';
import { approveSignal, approveSignalHybrid } from '../service';

interface Row {
  id: number; status: string; symbol: string; side: 'buy' | 'sell'; order_type: 'limit' | 'market'; price: string | null;
  quantity: string | null; amount_krw: string; strategy_id: string | null; indicators: string | null; expires_at: Date | null;
}
interface World {
  row: Row | null;
  strategies: Record<string, string | Error>;
  calls: Array<{ sql: string; params: unknown[] }>;
  /** 'S' 관문 조회 · 'X' 선점 UPDATE · 'O' submitOrder — 순서 확인용 */
  events: string[];
}
let w: World;

function wireDb() {
  const query = jest.fn(async (sqlArg: unknown, paramsArg: unknown[] = []) => {
    const sql = String(sqlArg).replace(/\s+/g, ' ').trim();
    const params = paramsArg ?? [];
    w.calls.push({ sql, params });
    if (/^SELECT validation_status FROM strategies WHERE id = \?/.test(sql)) {
      w.events.push('S');
      const v = w.strategies[String(params[0])];
      if (v instanceof Error) throw v;
      return [v === undefined ? [] : [{ validation_status: v }]];
    }
    if (/FROM signals WHERE id=\?/.test(sql)) return [w.row ? [w.row] : []];
    if (/^UPDATE signals SET (indicators=\?, )?status='(executing|approved_pending_entry)'/.test(sql)) { w.events.push('X'); return [{ affectedRows: 1 }]; }
    if (/^UPDATE signals/.test(sql)) return [{ affectedRows: 1 }];
    if (/INSERT INTO trade_logs/.test(sql)) return [{ insertId: 1 }];
    if (/FROM system_config/.test(sql)) return [[]];
    return [[]];
  });
  (getPool as jest.Mock).mockReturnValue({ query });
}

const row = (over: Partial<Row> = {}): Row => ({
  id: 321, status: 'awaiting_approval', symbol: '005930', side: 'buy', order_type: 'limit', price: '70000', quantity: null,
  amount_krw: '300000', strategy_id: 'rsi-oversold-v1', indicators: null, expires_at: null, ...over,
});
const claims = () => w.calls.filter((c) => /^UPDATE signals SET (indicators=\?, )?status='(executing|approved_pending_entry)'/.test(c.sql));
const signalUpdates = () => w.calls.filter((c) => /^UPDATE signals/.test(c.sql));
const ordersSql = () => w.calls.filter((c) => /\borders\b/.test(c.sql));
const gateLogs = () => w.calls.filter((c) => /INSERT INTO trade_logs/.test(c.sql) && c.params[1] === 'signal_validation_gate')
  .map((c) => JSON.parse(String(c.params[2])) as Record<string, unknown>);

beforeEach(() => {
  jest.clearAllMocks();
  for (const m of ['log', 'warn', 'error'] as const) jest.spyOn(console, m).mockImplementation(() => {});
  w = {
    row: row(),
    strategies: { 'rsi-oversold-v1': 'unvalidated', 'ok-v1': 'backtested', 'weird-v1': 'Backtested',
      'boom-v1': Object.assign(new Error("Unknown column 'validation_status'"), { code: 'ER_BAD_FIELD_ERROR' }) },
    calls: [], events: [],
  };
  wireDb();
  (submitOrder as jest.Mock).mockImplementation(async () => { w.events.push('O'); return { ok: true, orderId: 900, dryRun: true }; });
});
afterEach(() => jest.restoreAllMocks());

const BLOCKED: Array<[string, string | null, string, string]> = [
  ['전략 귀속 없음', null, 'validation_gate', 'null_strategy'],
  ['미등록(rsi_momentum_v1)', 'rsi_momentum_v1', 'validation_gate', 'unregistered'],
  ['unvalidated', 'rsi-oversold-v1', 'validation_gate', 'unvalidated'],
  ['상태값 이상', 'weird-v1', 'validation_gate', 'invalid_status'],
  ['조회 실패(마이그레이션 전)', 'boom-v1', 'validation_lookup_error', 'lookup_error'],
];

describe('1. 🔴 approveSignal(웹·텔레그램 즉시 주문) — 매수는 선점 전에 막는다', () => {
  test.each(BLOCKED)('%s → %s, 선점·orders·submitOrder 0, 상태 그대로', async (_n, sid, code, reason) => {
    w.row = row({ strategy_id: sid });
    const r = await approveSignal(321);
    expect(r).toMatchObject({ ok: false, signalId: 321, autoSubmitted: false, errorCode: code });
    expect(r.error).toMatch(new RegExp(`^${code}: .*선점·주문하지 않음$`));
    expect(claims()).toEqual([]);                  // 🔴 선점 0
    expect(signalUpdates()).toEqual([]);           // 상태 그대로(거짓 approved·rejected 없음) — TTL 로 만료
    expect(submitOrder).not.toHaveBeenCalled();    // 🔴 주문 0
    expect(ordersSql()).toEqual([]);
    expect(gateLogs()).toEqual([{ where: 'signal-approve', signalId: 321, strategyId: sid, symbol: '005930', side: 'buy', reason }]);
  });

  test('검증된 전략 매수 → 관문(S) → 선점(X) → submitOrder(O), 귀속 = 그 행의 전략·id', async () => {
    w.row = row({ strategy_id: 'ok-v1' });
    const r = await approveSignal(321);
    expect(r.ok).toBe(true);
    expect(w.events).toEqual(['S', 'X', 'O']);
    expect((submitOrder as jest.Mock).mock.calls[0][2]).toMatchObject({
      source: 'signal', attribution: { kind: 'strategy', strategyId: 'ok-v1', signalId: 321 },
    });
  });
});

describe('2. 🔴 approveSignalHybrid(진입 감시로 넘기기) — 매수는 선점 전에 막는다', () => {
  test.each(BLOCKED)('%s → %s, approved_pending_entry 전환 0', async (_n, sid, code, reason) => {
    w.row = row({ strategy_id: sid, indicators: JSON.stringify({ ai: { scenario: { entry: { price_zone: '69000~70000' } } } }) });
    const r = await approveSignalHybrid(321, { entry: { trigger: 'price_zone', price_zone: '69100~69900' } });
    expect(r).toMatchObject({ ok: false, errorCode: code });
    expect(r.error).toMatch(new RegExp(`^${code}: `));
    expect(claims()).toEqual([]);
    expect(signalUpdates()).toEqual([]);
    expect(submitOrder).not.toHaveBeenCalled();
    expect(gateLogs()).toEqual([{ where: 'signal-approve-hybrid', signalId: 321, strategyId: sid, symbol: '005930', side: 'buy', reason }]);
  });

  test('검증된 전략 → 관문(S) → 전환(X), 성공', async () => {
    w.row = row({ strategy_id: 'ok-v1' });
    await expect(approveSignalHybrid(321)).resolves.toMatchObject({ ok: true, status: 'approved_pending_entry' });
    expect(w.events).toEqual(['S', 'X']);
  });
});

describe('3. 🔴 매도 행은 관문이 조회 없이 통과시킨다 (보호 청산 — 조회 실패가 매도 실패로 번질 길 없음)', () => {
  test.each([
    ['전략 없음', null],
    ['미등록 exit-engine-v1', 'exit-engine-v1'],
    ['조회가 던지는 전략', 'boom-v1'],
  ])('%s 매도 — approveSignal: 관문 not_applicable · 조회 0 · 선점 → 주문', async (_n, sid) => {
    w.row = row({ side: 'sell', strategy_id: sid, quantity: '3' });
    const r = await approveSignal(321);
    expect(r.ok).toBe(true);
    expect(evaluateValidationGate).toHaveBeenCalledWith({ side: 'sell', strategyId: sid });
    await expect((evaluateValidationGate as jest.Mock).mock.results[0].value).resolves.toEqual({ allowed: true, kind: 'not_applicable' });
    expect(w.calls.some((c) => /FROM strategies/.test(c.sql))).toBe(false);
    expect(w.events).toEqual(['X', 'O']);
    expect((submitOrder as jest.Mock).mock.calls[0][2]).toMatchObject({ attribution: { kind: 'strategy', strategyId: sid, signalId: 321 } });
  });

  test.each([['전략 없음', null], ['미등록 exit-engine-v1', 'exit-engine-v1']])('%s 매도 — approveSignalHybrid: 관문 not_applicable · 조회 0 · 전환', async (_n, sid) => {
    w.row = row({ side: 'sell', strategy_id: sid });
    await expect(approveSignalHybrid(321)).resolves.toMatchObject({ ok: true });
    expect(evaluateValidationGate).toHaveBeenCalledWith({ side: 'sell', strategyId: sid });
    expect(w.events).toEqual(['X']);                                       // 'S'(strategies 조회) 없음
  });
});

describe('4. 🔴 WP-2c R-1 — 행 side 가 변형(대문자·공백)이어도 매수로 판정해 선점 전에 막는다', () => {
  test.each([['BUY'], ['Buy'], ['buy ']])('approveSignal side=%p → validation_gate · 선점·주문 0', async (side) => {
    w.row = row({ side: side as 'buy', strategy_id: 'rsi-oversold-v1' });
    const r = await approveSignal(321);
    expect(r).toMatchObject({ ok: false, errorCode: 'validation_gate' });
    expect(claims()).toEqual([]);
    expect(submitOrder).not.toHaveBeenCalled();
    expect(gateLogs()[0]).toMatchObject({ where: 'signal-approve', side: 'buy', reason: 'unvalidated' });
  });
  test("approveSignalHybrid side='BUY' → validation_gate · 전환 0", async () => {
    w.row = row({ side: 'BUY' as 'buy', strategy_id: null });
    await expect(approveSignalHybrid(321)).resolves.toMatchObject({ ok: false, errorCode: 'validation_gate' });
    expect(claims()).toEqual([]);
  });
  test("대문자 매도 'SELL' 은 매도로 보호 — 조회 0 · 선점 → 주문", async () => {
    w.row = row({ side: 'SELL' as 'sell', strategy_id: 'boom-v1', quantity: '3' });
    await expect(approveSignal(321)).resolves.toMatchObject({ ok: true });
    expect(w.events).toEqual(['X', 'O']);
  });
});

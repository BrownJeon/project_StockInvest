/**
 * T-072 G6 — `submitOrder` 최후 방어선(검증 상태 관문) + F-15 송신 직전 재검증.
 *
 * 지킬 것:
 *  1. 매수 + 귀속 미지정 = 전략 없음 → blocked(validation_gate), realSubmit 0회, orders.status='blocked'·blocked_by='validation_gate',
 *     trade_logs `blocked`, 경고 알림(F-12 — 발동 = 우회 버그 신호)
 *  2. fail-closed 행렬(미등록·unvalidated·이상값·조회 예외·ER_BAD_FIELD_ERROR) — DRY_RUN 과 무관(F-4): DRY_RUN=true 에서도 dry_run 이 아니라 blocked
 *  3. 위치(F-15): 킬스위치·블랙리스트·한도·변동성 **뒤**, DRY_RUN 분기 **앞** — 막히면 safety_dry_run 을 읽지도 않는다
 *  4. 송신 직전 재검증: 첫 판정 뒤 강등·조회 실패 → 송신하지 않는다. 검증된 전략은 PK 조회 2회(DRY_RUN 조회 뒤 1회) 후 송신
 *  5. 검증된 전략(backtested·paper_validated) 매수는 기존 경로 그대로(DRY_RUN → dry_run / 실송신 → accepted)
 */
import { getAccountId, getPool } from '@/lib/db';
import type { OrderRequest } from '@/lib/exchanges/types';
import { sendAlert } from '@/lib/notify';
import { getMarketTotal } from '@/lib/safety/portfolio-total';
import { submitOrder } from '../dry-run';

jest.mock('@/lib/db', () => ({ getPool: jest.fn(), getAccountId: jest.fn() }));
jest.mock('@/lib/safety/portfolio-total', () => ({ getMarketTotal: jest.fn() }));
jest.mock('@/lib/notify', () => ({ sendAlert: jest.fn() }));

interface World {
  /** strategies 조회 응답 — 호출 순서대로 하나씩 소비, 마지막 값 반복. 함수면 예외 */
  strategyAnswers: Array<unknown | (() => never)>;
  queries: string[];
  orderUpdates: Array<{ status?: string; blockedBy?: unknown }>;
  logs: Array<{ event: string; payload: Record<string, unknown> }>;
}
let w: World;
let strategyCalls = 0;

function setupDb() {
  let id = 7000;
  strategyCalls = 0;
  const query = jest.fn(async (sqlArg: unknown, params: unknown[] = []) => {
    const sql = String(sqlArg);
    w.queries.push(sql);
    if (/INSERT INTO orders/i.test(sql)) return [{ insertId: id++ }];
    if (/INSERT INTO trade_logs/i.test(sql)) {
      w.logs.push({ event: String(params[1]), payload: JSON.parse(String(params[2])) });
      return [{}];
    }
    if (/UPDATE orders/i.test(sql)) {
      const m = sql.match(/SET\s+status='([^']+)'/);
      w.orderUpdates.push({ status: m?.[1], blockedBy: /blocked_by=\?/.test(sql) ? params[0] : undefined });
      return [{}];
    }
    if (/SELECT validation_status FROM strategies/i.test(sql)) {
      const i = Math.min(strategyCalls++, w.strategyAnswers.length - 1);
      const a = w.strategyAnswers[i];
      if (typeof a === 'function') (a as () => never)();
      return [a === undefined ? [] : [{ validation_status: a }]];
    }
    if (/SUM\(amount_krw\)/i.test(sql)) return [[{ sum_krw: 0 }]];
    if (/FROM system_config/i.test(sql)) {
      const k = String(params?.[0] ?? '');
      if (k === 'safety_order_max_pct') return [[{ value: '50' }]];
      if (k === 'safety_daily_order_max_pct') return [[{ value: '90' }]];
      return [[]];
    }
    return [[]];
  });
  (getPool as jest.Mock).mockReturnValue({ query });
  (getAccountId as jest.Mock).mockResolvedValue(1);
}

const domBuy: OrderRequest = { exchange: 'kis', symbol: '005930', side: 'buy', type: 'limit', price: 70_000, quantity: 1, amountKRW: 70_000, market: 'domestic' };
const attr = (strategyId: string | null, signalId: number | null = 42) => ({ attribution: { kind: 'strategy' as const, strategyId, signalId } });

const origEnv = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  w = { strategyAnswers: ['backtested'], queries: [], orderUpdates: [], logs: [] };
  process.env.DRY_RUN = 'false';
  process.env.KILL_SWITCH = 'false';
  process.env.BLOCKED_SYMBOLS_DOMESTIC = '';
  process.env.BLOCKED_SYMBOLS_OVERSEAS = '';
  (getMarketTotal as jest.Mock).mockResolvedValue({ status: 'ok', krw: 10_000_000 });
  setupDb();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { process.env = { ...origEnv }; jest.restoreAllMocks(); });

function expectBlocked(r: Awaited<ReturnType<typeof submitOrder>>, realSubmit: jest.Mock) {
  expect(realSubmit).not.toHaveBeenCalled();
  expect(r.ok).toBe(false);
  expect(r.blockedBy).toBe('validation_gate');
  expect(r.error).toMatch(/^validation_gate: /);
  expect(w.orderUpdates).toContainEqual({ status: 'blocked', blockedBy: 'validation_gate' });
  expect(w.orderUpdates.some((u) => u.status === 'dry_run' || u.status === 'accepted')).toBe(false);
  expect(w.logs.some((l) => l.event === 'blocked' && l.payload.reason === 'validation_gate')).toBe(true);
}

describe('1. 🔴 귀속 미지정 매수 = 전략 없음 → 차단', () => {
  test('attribution 없음 → blocked(validation_gate · null_strategy), 송신 0, 경고 알림 1회', async () => {
    const realSubmit = jest.fn();
    const r = await submitOrder(domBuy, realSubmit);
    expectBlocked(r, realSubmit);
    expect(r.error).toContain('reason=null_strategy');
    expect(w.queries.some((q) => /FROM strategies/.test(q))).toBe(false);    // ID 가 없으면 조회조차 하지 않는다
    expect(sendAlert).toHaveBeenCalledWith('warning', '주문 차단: validation_gate', expect.stringContaining('null_strategy'));
  });

  test('attribution.kind 가 strategy 가 아니면(런타임 오용) 전략 없음으로 본다', async () => {
    const realSubmit = jest.fn();
    const r = await submitOrder(domBuy, realSubmit, { attribution: { kind: 'discretionary', strategyId: 'validated-v1', signalId: null } as never });
    expectBlocked(r, realSubmit);
    expect(r.error).toContain('reason=null_strategy');
  });
});

describe('2. 🔴 fail-closed 행렬 — DRY_RUN 과 무관 (F-4)', () => {
  const cases: Array<[string, unknown, string]> = [
    ['미등록(행 없음)', undefined, 'unregistered'],
    ['unvalidated', 'unvalidated', 'unvalidated'],
    ['이상값', 'BACKTESTED', 'invalid_status'],
    ['조회 예외', () => { throw new Error('db down'); }, 'lookup_error'],
    ['컬럼 없음(마이그레이션 전)', () => { throw Object.assign(new Error('Unknown column'), { code: 'ER_BAD_FIELD_ERROR' }); }, 'lookup_error'],
  ];
  describe.each([['false'], ['true']])('DRY_RUN=%s', (dry) => {
    test.each(cases)('%s → blocked, dry_run 아님', async (_n, answer, reason) => {
      process.env.DRY_RUN = dry;
      w.strategyAnswers = [answer];
      const realSubmit = jest.fn();
      const r = await submitOrder(domBuy, realSubmit, attr('rsi-oversold-v1'));
      expectBlocked(r, realSubmit);
      expect(r.dryRun).toBeUndefined();
      expect(r.error).toContain(`reason=${reason}`);
      expect(r.error).toContain('signal=42');
    });
  });
});

describe('3. 위치 — 킬스위치·블랙리스트·한도·변동성 뒤, DRY_RUN 앞', () => {
  test('킬스위치가 먼저 — kill_switch 로 막히고 strategies 를 조회하지 않는다', async () => {
    process.env.KILL_SWITCH = 'true';
    w.strategyAnswers = ['unvalidated'];
    const r = await submitOrder(domBuy, jest.fn(), attr('rsi-oversold-v1'));
    expect(r.blockedBy).toBe('kill_switch');
    expect(w.queries.some((q) => /FROM strategies/.test(q))).toBe(false);
  });

  test('블랙리스트가 먼저', async () => {
    process.env.BLOCKED_SYMBOLS_DOMESTIC = '005930';
    w.strategyAnswers = ['unvalidated'];
    const r = await submitOrder(domBuy, jest.fn(), attr('rsi-oversold-v1'));
    expect(r.blockedBy).toBe('symbol_not_allowed');
  });

  test('1회 한도가 먼저', async () => {
    w.strategyAnswers = ['unvalidated'];
    const r = await submitOrder({ ...domBuy, amountKRW: 9_000_000, quantity: 100 }, jest.fn(), attr('rsi-oversold-v1'));
    expect(r.blockedBy).toBe('order_limit');
    expect(w.queries.some((q) => /FROM strategies/.test(q))).toBe(false);
  });

  test('🔴 막히면 DRY_RUN 스위치를 읽지도 않는다 (DRY_RUN 분기 앞)', async () => {
    process.env.DRY_RUN = 'true';
    w.strategyAnswers = ['unvalidated'];
    await submitOrder(domBuy, jest.fn(), attr('rsi-oversold-v1'));
    const iStrat = w.queries.findIndex((q) => /FROM strategies/.test(q));
    expect(iStrat).toBeGreaterThan(-1);
    // isDryRun 은 `system_config WHERE key = ?` 에 'safety_dry_run' 을 넘긴다 — 관문 차단 뒤에는 그 조회가 없어야 한다
    const pool = (getPool as jest.Mock).mock.results[0].value as { query: jest.Mock };
    const dryReads = pool.query.mock.calls.filter((c) => (c[1] as unknown[] | undefined)?.[0] === 'safety_dry_run');
    expect(dryReads).toHaveLength(0);
  });
});

describe('4. 🔴 F-15 송신 직전 재검증', () => {
  test('첫 판정 backtested → 송신 직전 unvalidated(강등) → 송신 0, phase=pre_send', async () => {
    w.strategyAnswers = ['backtested', 'unvalidated'];
    const realSubmit = jest.fn();
    const r = await submitOrder(domBuy, realSubmit, attr('rsi-oversold-v1'));
    expectBlocked(r, realSubmit);
    expect(r.error).toContain('phase=pre_send');
    expect(r.outcomeUnknown).toBeUndefined();          // 송신 전이므로 확정 거부
  });

  test('송신 직전 조회 실패 → 송신 0', async () => {
    w.strategyAnswers = ['backtested', () => { throw new Error('db blip'); }];
    const realSubmit = jest.fn();
    const r = await submitOrder(domBuy, realSubmit, attr('rsi-oversold-v1'));
    expectBlocked(r, realSubmit);
    expect(r.error).toContain('reason=lookup_error');
  });

  test('검증된 전략: strategies PK 조회 2회 — 두 번째는 DRY_RUN 조회 뒤(송신 직전)', async () => {
    const realSubmit = jest.fn().mockResolvedValue({ ok: true, exchangeOrderId: 'EX-1' });
    const r = await submitOrder(domBuy, realSubmit, attr('rsi-oversold-v1'));
    expect(r.ok).toBe(true);
    expect(realSubmit).toHaveBeenCalledTimes(1);
    const pool = (getPool as jest.Mock).mock.results[0].value as { query: jest.Mock };
    const seq = pool.query.mock.calls.map((c) => {
      const sql = String(c[0]);
      if (/FROM strategies/.test(sql)) return 'S';
      if ((c[1] as unknown[] | undefined)?.[0] === 'safety_dry_run') return 'D';
      return '';
    }).filter(Boolean).join('');
    expect(seq).toBe('SDS');
  });
});

describe('5. 검증된 전략 매수는 기존 경로 그대로', () => {
  test.each(['backtested', 'paper_validated'])('%s + DRY_RUN=false → accepted', async (st) => {
    w.strategyAnswers = [st];
    const realSubmit = jest.fn().mockResolvedValue({ ok: true, exchangeOrderId: 'EX-9' });
    const r = await submitOrder(domBuy, realSubmit, attr('rsi-oversold-v1'));
    expect(r.ok).toBe(true);
    expect(realSubmit).toHaveBeenCalledTimes(1);
    expect(w.orderUpdates).toContainEqual({ status: 'accepted', blockedBy: undefined });
    expect(sendAlert).not.toHaveBeenCalled();
  });

  test('backtested + DRY_RUN=true → dry_run (송신 0, 재검증 조회 없음)', async () => {
    process.env.DRY_RUN = 'true';
    const realSubmit = jest.fn();
    const r = await submitOrder(domBuy, realSubmit, attr('rsi-oversold-v1'));
    expect(r).toMatchObject({ ok: true, dryRun: true, blockedBy: 'dry_run' });
    expect(realSubmit).not.toHaveBeenCalled();
    expect(strategyCalls).toBe(1);
  });
});

/**
 * 🔴 T-072 WP-2d — `submitOrder` 맨 앞 방향 정규화. 어댑터는 `req.side === 'buy'` 일 때만 매수 TR 을 고르므로
 * 검증된 전략 귀속의 `'BUY'`·`'buy '` 가 원문 그대로 내려가면 매도 TR 로 나갔다(Reviewer 2차 항목 6 프로브).
 */
describe('6. 🔴 WP-2d — 방향 정규화: 어댑터에는 정확히 buy/sell 만', () => {
  const ordersInsertSide = () => {
    const pool = (getPool as jest.Mock).mock.results[0].value as { query: jest.Mock };
    return pool.query.mock.calls.filter((c) => /INSERT INTO orders/i.test(String(c[0]))).map((c) => (c[1] as unknown[])[4]);
  };

  test.each([['BUY'], ['Buy'], ['buy '], [' BUY\t']])('검증된 전략 + side=%p → 어댑터에 정확히 "buy", orders 에도 "buy"', async (side) => {
    w.strategyAnswers = ['backtested'];
    const realSubmit = jest.fn().mockResolvedValue({ ok: true, exchangeOrderId: 'EX-N' });
    const r = await submitOrder({ ...domBuy, side: side as 'buy' }, realSubmit, attr('rsi-oversold-v1'));
    expect(r.ok).toBe(true);
    expect(realSubmit).toHaveBeenCalledTimes(1);
    expect(realSubmit.mock.calls[0][0].side).toBe('buy');       // 🔴 원문 'BUY' 면 어댑터가 매도 TR 을 고른다
    expect(ordersInsertSide()).toEqual(['buy']);
  });

  test.each([['SELL'], [' sell '], ['Sell']])('보호 청산 side=%p → 정확히 "sell" 로 정상 매도 — 매도 한도 면제까지 받는다(1회 한도 초과 금액도 송신)', async (side) => {
    const realSubmit = jest.fn().mockResolvedValue({ ok: true, exchangeOrderId: 'EX-S' });
    // 1회 한도 = 총액 10,000,000 × 50% = 5,000,000. 9,000,000 매도는 'sell' 로 정규화돼야 면제된다(원문이면 order_limit 차단)
    const r = await submitOrder({ ...domBuy, side: side as 'sell', amountKRW: 9_000_000, quantity: 100 }, realSubmit, attr(null));
    expect(r.ok).toBe(true);
    expect(realSubmit.mock.calls[0][0].side).toBe('sell');
    expect(w.queries.some((q) => /FROM strategies/.test(q))).toBe(false);   // 매도 — 검증 관문 I/O 0
  });

  test.each([['purchase'], [''], ['   '], [null], [undefined], [123], [['buy']]])('알 수 없는 side=%p → 거래소 호출 0 · orders 행 0 · blocked(invalid_side) · 감사 기록·경고', async (side) => {
    w.strategyAnswers = ['backtested'];
    const realSubmit = jest.fn();
    const r = await submitOrder({ ...domBuy, side: side as 'buy' }, realSubmit, attr('rsi-oversold-v1'));
    expect(realSubmit).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: false, blockedBy: 'invalid_side' });
    expect(r.orderId).toBeUndefined();
    expect(r.error).toMatch(/^invalid_side: /);
    expect(w.queries.some((q) => /INSERT INTO orders/i.test(q))).toBe(false);
    expect(w.queries.some((q) => /FROM strategies/.test(q))).toBe(false);
    expect(w.logs).toContainEqual(expect.objectContaining({ event: 'blocked', payload: expect.objectContaining({ reason: 'invalid_side' }) }));
    expect(sendAlert).toHaveBeenCalledWith('warning', '주문 차단: invalid_side', expect.any(String));
  });
});

/**
 * 🔴 WP-2d (Reviewer R2-1) — G6 의 두 판정(`pre_dry_run`·`pre_send`)을 **각각 독립적으로** 증명한다. 예전 시험은 DRY_RUN=false 만 봐서
 * 한 판정이 변형 side 를 놓쳐도 다른 판정이 막아 단독 변이(W14·W15)가 살아남았다.
 */
describe('7. 🔴 WP-2d — G6 두 판정 독립 증명 (변형 매수)', () => {
  test.each([['BUY'], ['buy ']])('(a) 첫 판정: side=%p + 미검증 + DRY_RUN=true → pre_dry_run 에서 차단(dry_run 아님 — 두 번째 판정은 DRY_RUN 에서 오지 않는다)', async (side) => {
    process.env.DRY_RUN = 'true';
    w.strategyAnswers = ['unvalidated'];
    const realSubmit = jest.fn();
    const r = await submitOrder({ ...domBuy, side: side as 'buy' }, realSubmit, attr('rsi-oversold-v1'));
    expectBlocked(r, realSubmit);
    expect(r.dryRun).toBeUndefined();
    expect(r.error).toContain('phase=pre_dry_run');
    expect(strategyCalls).toBe(1);
  });

  test.each([['BUY'], ['Buy'], ['buy ']])('(b) 두 번째 판정: side=%p, 첫 판정 backtested → 송신 직전 강등(unvalidated) → realSubmit 0회 · phase=pre_send', async (side) => {
    w.strategyAnswers = ['backtested', 'unvalidated'];      // 두 조회 사이에 DB 상태가 바뀐다
    const realSubmit = jest.fn();
    const r = await submitOrder({ ...domBuy, side: side as 'buy' }, realSubmit, attr('rsi-oversold-v1'));
    expectBlocked(r, realSubmit);
    expect(r.error).toContain('phase=pre_send');
    expect(strategyCalls).toBe(2);
  });
});

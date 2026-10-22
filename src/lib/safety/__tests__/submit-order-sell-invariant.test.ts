/**
 * T-056 — **매도는 한도 계산이 무엇을 보든 `realSubmit` 까지 간다** (불변식 고정, 설계 R4·C1-2).
 *
 * `dry-run.ts` 는 `getEffectiveOrderMax/DailyMax` 를 side 와 무관하게 먼저 부른다(이번 task 에서 그 순서를 바꾸지 않는다 — Q7 제외).
 * 이번 작업은 그 아래 계층에 새 실패 원인(CTRP6504R USD 예수금·환율)을 더한다. 그래서 다음 각각에서 해외·국내 **매도**가
 * 송신까지 도달하는지 실제 `submitOrder`·실제 `order-limits` 로 확인한다(평가액 모듈만 목):
 *   해외 현금 unknown · 환율 실패 · 잔고 전체 실패(직전값 없음) · 평가액 조회 예외 · pct DB 실패.
 * 대조: 같은 조건의 **해외 매수**는 `order_limit` 로 막힌다(Q5 — unknown 이면 해외 신규 매수 차단).
 */
import { getAccountId, getPool } from '@/lib/db';
import type { OrderRequest } from '@/lib/exchanges/types';
import { getMarketTotal } from '@/lib/safety/portfolio-total';
import { submitOrder } from '../dry-run';

jest.mock('@/lib/db', () => ({ getPool: jest.fn(), getAccountId: jest.fn() }));
jest.mock('@/lib/safety/portfolio-total', () => ({ getMarketTotal: jest.fn() }));
jest.mock('@/lib/notify', () => ({ sendAlert: jest.fn() }));

let dbDownForConfig = false;
/** T-072 — strategies 조회 횟수. 매도에서는 **반드시 0** 이어야 한다(조회 실패가 매도 실패로 번질 길 자체가 없어야 한다). */
let strategyLookups = 0;
function setupDb() {
  let id = 5000;
  strategyLookups = 0;
  const query = jest.fn(async (sqlArg: unknown, params: unknown[] = []) => {
    const sql = String(sqlArg);
    // T-072 — 검증 상태 조회는 실행되면 던진다(가장 나쁜 경우: 마이그레이션 전·DB 장애). 매도가 이걸 부르면 fail-closed 로 막힐 것이다.
    if (/FROM strategies/i.test(sql)) { strategyLookups++; throw Object.assign(new Error('Unknown column'), { code: 'ER_BAD_FIELD_ERROR' }); }
    if (/INSERT INTO orders/i.test(sql)) return [{ insertId: id++ }];
    if (/INSERT INTO trade_logs/i.test(sql)) return [{}];
    if (/UPDATE orders/i.test(sql)) return [{}];
    if (/SUM\(amount_krw\)/i.test(sql)) return [[{ sum_krw: 0 }]];
    if (/FROM system_config/i.test(sql)) {
      const k = String(params?.[0] ?? '');
      if (k === 'safety_dry_run') return [[{ value: 'false' }]];
      if (k === 'safety_kill_switch') return [[{ value: 'false' }]];
      if (dbDownForConfig && /max_pct/.test(k)) throw new Error('db down');
      if (k === 'safety_order_max_pct') return [[{ value: '5' }]];
      if (k === 'safety_daily_order_max_pct') return [[{ value: '10' }]];
      return [[]];
    }
    if (/FROM orders/i.test(sql)) return [[]];
    if (/portfolio_snapshots/i.test(sql)) return [[]];
    return [[]];
  });
  (getPool as jest.Mock).mockReturnValue({ query });
  (getAccountId as jest.Mock).mockResolvedValue(1);
}

const ovsSell: OrderRequest = { exchange: 'kis', symbol: 'NAS:STK1', side: 'sell', type: 'limit', price: 1_200_000, quantity: 11, amountKRW: 13_200_000, market: 'overseas' };
const domSell: OrderRequest = { exchange: 'kis', symbol: '005930', side: 'sell', type: 'limit', price: 70_000, quantity: 30, amountKRW: 2_100_000, market: 'domestic' };
const ovsBuy: OrderRequest = { ...ovsSell, side: 'buy', quantity: 1, amountKRW: 50_000 };

const origEnv = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  dbDownForConfig = false;
  process.env.DRY_RUN = 'false';
  process.env.KILL_SWITCH = 'false';
  process.env.BLOCKED_SYMBOLS_DOMESTIC = '';
  process.env.BLOCKED_SYMBOLS_OVERSEAS = '';
  setupDb();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { process.env = { ...origEnv }; jest.restoreAllMocks(); });

const conditions: [string, () => void][] = [
  ['해외 현금 unknown', () => (getMarketTotal as jest.Mock).mockResolvedValue({ status: 'unknown', reason: 'usd_cash_unknown', detail: 'x' })],
  ['환율 실패', () => (getMarketTotal as jest.Mock).mockResolvedValue({ status: 'unknown', reason: 'fx_unavailable', detail: 'x' })],
  ['잔고 전체 실패(직전값 없음)', () => (getMarketTotal as jest.Mock).mockResolvedValue({ status: 'unknown', reason: 'balances_failed', detail: 'x' })],
  ['평가액 조회 예외', () => (getMarketTotal as jest.Mock).mockRejectedValue(new Error('KIS down'))],
  ['pct DB 실패', () => { dbDownForConfig = true; (getMarketTotal as jest.Mock).mockResolvedValue({ status: 'ok', krw: 20_000_000 }); }],
];

describe.each(conditions)('🔴 %s', (_name, arrange) => {
  test('해외 매도는 realSubmit 까지 도달한다', async () => {
    arrange();
    const realSubmit = jest.fn().mockResolvedValue({ ok: true, exchangeOrderId: 'X1' });
    const r = await submitOrder(ovsSell, realSubmit);
    expect(realSubmit).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(true);
    expect(r.blockedBy).toBeUndefined();
    expect(strategyLookups).toBe(0);                  // T-072 — 검증 관문은 매도에서 I/O 0
  });

  test('국내 매도도 realSubmit 까지 도달한다', async () => {
    arrange();
    const realSubmit = jest.fn().mockResolvedValue({ ok: true, exchangeOrderId: 'X2' });
    const r = await submitOrder(domSell, realSubmit);
    expect(realSubmit).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(true);
    expect(strategyLookups).toBe(0);
  });

  test('대조: 해외 매수는 order_limit 로 막힌다 (송신 없음)', async () => {
    arrange();
    const realSubmit = jest.fn();
    const r = await submitOrder(ovsBuy, realSubmit);
    expect(realSubmit).not.toHaveBeenCalled();
    expect(r.blockedBy).toBe('order_limit');
  });
});

/**
 * T-072 (L-2·F-2) — **매도는 검증 상태 관문이 무엇을 보든 송신까지 간다.** 귀속 없음·미등록·미검증 전략·검증 조회가 던지는 경우 모두,
 * 그리고 strategies 조회는 **한 번도 실행되지 않는다**(관문의 첫 줄이 side 판정). 송신 직전 재검증(F-15)도 매도에는 I/O 0.
 */
describe('🔴 T-072 — 매도는 검증 상태 관문과 무관하다', () => {
  beforeEach(() => (getMarketTotal as jest.Mock).mockResolvedValue({ status: 'ok', krw: 20_000_000 }));

  const attributions: Array<[string, Parameters<typeof submitOrder>[2]]> = [
    ['귀속 미지정', undefined],
    ['전략 null', { attribution: { kind: 'strategy', strategyId: null, signalId: null } }],
    ['미등록 exit-engine-v1(손절·청산 엔진)', { attribution: { kind: 'strategy', strategyId: 'exit-engine-v1', signalId: 1 } }],
    ['미검증 전략', { attribution: { kind: 'strategy', strategyId: 'rsi-overbought-exit-v1', signalId: 2 } }],
  ];
  describe.each([['false'], ['true']])('DRY_RUN=%s', (dry) => {
    test.each(attributions)('%s — 해외·국내 매도 모두 송신/드라이런까지, strategies 조회 0', async (_n, opts) => {
      process.env.DRY_RUN = dry;
      setupDb();
      if (dry === 'true') {
        // DRY_RUN 조회가 env 를 보도록 system_config 응답을 비운다(setupDb 기본은 'false' 를 돌려준다)
        const pool = (getPool as jest.Mock)();
        const inner = pool.query as jest.Mock;
        (getPool as jest.Mock).mockReturnValue({
          query: jest.fn(async (sql: string, p?: unknown[]) => (p?.[0] === 'safety_dry_run' ? [[{ value: 'true' }]] : inner(sql, p))),
        });
      }
      for (const req of [ovsSell, domSell]) {
        const realSubmit = jest.fn().mockResolvedValue({ ok: true, exchangeOrderId: 'S1' });
        const r = await submitOrder(req, realSubmit, opts);
        expect(r.ok).toBe(true);
        expect(r.blockedBy === undefined || r.blockedBy === 'dry_run').toBe(true);
        expect(realSubmit).toHaveBeenCalledTimes(dry === 'true' ? 0 : 1);
      }
      expect(strategyLookups).toBe(0);
    });
  });

  // WP-2c R-1 — 관문은 side 를 정규화한다: 대소문자·공백 변형 매도는 매도로 보호(조회 0), 변형 매수는 매수로 판정.
  //   (금액은 1회 한도 안 — `dry-run.ts` 의 한도 면제는 정확히 'sell' 만이라 변형 매도에는 한도가 걸리는 것이 기존 동작이다)
  test.each([['SELL'], [' sell '], ['Sell']])("G6: 변형 매도 side=%p 도 검증 관문 I/O 0 → 송신까지", async (side) => {
    const realSubmit = jest.fn().mockResolvedValue({ ok: true, exchangeOrderId: 'S9' });
    const r = await submitOrder({ ...domSell, side: side as 'sell', quantity: 1, amountKRW: 70_000 }, realSubmit,
      { attribution: { kind: 'strategy', strategyId: 'exit-engine-v1', signalId: 9 } });
    expect(strategyLookups).toBe(0);
    expect(r.blockedBy).not.toBe('validation_gate');
    expect(realSubmit).toHaveBeenCalledTimes(1);
  });

  test.each([['BUY'], ['buy ']])("G6: 변형 매수 side=%p 는 (정규화 후 buy) 매수로 판정 — 조회(던짐) → validation_gate, 송신 0", async (side) => {
    const realSubmit = jest.fn();
    const r = await submitOrder({ ...domSell, side: side as 'buy', quantity: 1, amountKRW: 70_000 }, realSubmit,
      { attribution: { kind: 'strategy', strategyId: 'rsi-oversold-v1', signalId: 10 } });
    expect(realSubmit).not.toHaveBeenCalled();
    expect(r.blockedBy).toBe('validation_gate');
    expect(strategyLookups).toBe(1);
  });

  // WP-2d — 정규화해도 buy/sell 이 아닌 값은 관문 판정까지 가지 않는다: submitOrder 맨 앞에서 invalid_side(orders 행·조회·송신 0)
  test.each([['purchase'], [''], [null]])("G6 앞: 알 수 없는 side=%p → invalid_side, 조회 0 · 송신 0", async (side) => {
    const realSubmit = jest.fn();
    const r = await submitOrder({ ...domSell, side: side as 'buy', quantity: 1, amountKRW: 70_000 }, realSubmit,
      { attribution: { kind: 'strategy', strategyId: 'rsi-oversold-v1', signalId: 11 } });
    expect(realSubmit).not.toHaveBeenCalled();
    expect(r.blockedBy).toBe('invalid_side');
    expect(strategyLookups).toBe(0);
  });

  test('대조: 같은 목에서 매수는 검증 조회가 실행되고(던짐) fail-closed 로 막힌다', async () => {
    const realSubmit = jest.fn();
    const r = await submitOrder({ ...domSell, side: 'buy', quantity: 1, amountKRW: 70_000 }, realSubmit,
      { attribution: { kind: 'strategy', strategyId: 'rsi-oversold-v1', signalId: 3 } });
    expect(realSubmit).not.toHaveBeenCalled();
    expect(r.blockedBy).toBe('validation_gate');
    expect(strategyLookups).toBe(1);
  });
});

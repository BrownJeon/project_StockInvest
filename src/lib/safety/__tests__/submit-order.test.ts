import { getAccountId, getPool } from '@/lib/db';
import type { OrderRequest } from '@/lib/exchanges/types';
import { readAdaptiveCashBudget } from '@/lib/signals/adaptive-buy-cash';
import { submitOrder } from '../dry-run';

jest.mock('@/lib/db', () => ({
  getPool: jest.fn(),
  getAccountId: jest.fn(),
}));
jest.mock('@/lib/signals/adaptive-buy-cash', () => ({
  ...jest.requireActual('@/lib/signals/adaptive-buy-cash'), readAdaptiveCashBudget: jest.fn(),
}));

// T-056: 한도는 시장별 *상태*(`getMarketTotal`)를 읽는다. 값은 종전과 같은 1,000,000 (ok).
jest.mock('@/lib/safety/portfolio-total', () => ({
  getMarketTotal: jest.fn().mockResolvedValue({ status: 'ok', krw: 1_000_000 }),
  getPortfolioTotalState: jest.fn().mockResolvedValue({ status: 'ok', krw: 1_000_000 }),
  getPortfolioTotalsKRW: jest.fn().mockResolvedValue({
    domestic: { status: 'ok', krw: 1_000_000 }, overseas: { status: 'ok', krw: 0 },
  }),
}));

interface CapturedUpdate {
  status?: string;
  blockedBy?: string | null;
  exchangeOrderId?: string | null;
  raw: { sql: string; params: unknown[] };
}
interface CapturedLog {
  orderId: number | null;
  event: string;
  payload: unknown;
}
interface CapturedQuery {
  sql: string;
  params: unknown[];
}

interface Captured {
  queries: CapturedQuery[];
  updates: CapturedUpdate[];
  logs: CapturedLog[];
  lastOrderId: number;
}

interface MockOpts {
  filledAutoOn?: boolean;
  dailySum?: number;
  orderMaxPct?: number | 'unlimited';
  dailyMaxPct?: number | 'unlimited';
}

function setupMockDB(opts: MockOpts = {}): Captured {
  const captured: Captured = { queries: [], updates: [], logs: [], lastOrderId: 0 };
  let nextId = 1000;

  const query = jest.fn(async (sqlArg: unknown, paramsArg: unknown[] = []) => {
    const sql = String(sqlArg);
    const params = paramsArg ?? [];
    captured.queries.push({ sql, params });

    if (/INSERT INTO orders/i.test(sql)) {
      const id = nextId++;
      captured.lastOrderId = id;
      return [{ insertId: id } as unknown];
    }
    if (/INSERT INTO trade_logs/i.test(sql)) {
      const [orderId, event, payloadJson] = params as [number | null, string, string];
      let payload: unknown = null;
      try { payload = JSON.parse(payloadJson); } catch { payload = payloadJson; }
      captured.logs.push({ orderId, event, payload });
      return [{}];
    }
    if (/FROM orders[\s\S]*status IN \('filled','partially_filled'\)/i.test(sql)) {
      return [opts.filledAutoOn ? [{ 1: 1 }] : []];
    }
    if (/SUM\(amount_krw\)/i.test(sql)) {
      return [[{ sum_krw: opts.dailySum ?? 0 }]];
    }
    // system_config: 한도 DB override — order-limits.ts는 `key` 컬럼으로 WHERE 파라미터 바인딩
    if (/FROM system_config/i.test(sql)) {
      const keyParam = String(params[0] ?? '');
      if (keyParam === 'safety_order_max_pct') return [[{ value: JSON.stringify(opts.orderMaxPct ?? 1) }]];
      if (keyParam === 'safety_daily_order_max_pct') return [[{ value: JSON.stringify(opts.dailyMaxPct ?? 5) }]];
      return [[]]; // 기타 config 키는 미설정
    }
    // T-072 — 검증 상태 관문(G6). 이 파일의 매수는 검증된 전략 귀속(VALIDATED)으로 낸다 — 관문 자체는 submit-order-validation-gate.test.ts.
    if (/SELECT validation_status FROM strategies WHERE id = \?/i.test(sql)) {
      return [params[0] === VALIDATED_SID ? [{ validation_status: 'backtested' }] : []];
    }
    if (/UPDATE orders/i.test(sql)) {
      const update: CapturedUpdate = { raw: { sql, params } };
      const statusLit = sql.match(/SET\s+status='([^']+)'/);
      if (statusLit) update.status = statusLit[1];
      if (/blocked_by=\?/.test(sql)) update.blockedBy = (params[0] ?? null) as string | null;
      if (/exchange_order_id=\?/.test(sql)) update.exchangeOrderId = (params[0] ?? null) as string | null;
      captured.updates.push(update);
      return [{}];
    }
    throw new Error(`unexpected SQL: ${sql}`);
  });

  (getPool as jest.Mock).mockReturnValue({ query });
  (getAccountId as jest.Mock).mockResolvedValue(1);
  return captured;
}

/** T-072 — 목 DB 에서 validation_status='backtested' 인 전략. 매수가 관문 뒤 단계(한도·DRY_RUN·송신)를 시험하려면 이 귀속이 필요하다. */
const VALIDATED_SID = 'validated-v1';
const VALIDATED = { attribution: { kind: 'strategy' as const, strategyId: VALIDATED_SID, signalId: null } };

const baseReq: OrderRequest = {
  exchange: 'coinone',
  symbol: 'KRW-BTC',
  side: 'buy',
  type: 'limit',
  price: 90_000_000,
  quantity: 0.0001, // amountKRW = 9,000
};

describe('submitOrder — 안전장치 회로 end-to-end', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env.DRY_RUN = 'true';
    process.env.KILL_SWITCH = 'false';
    process.env.BLOCKED_SYMBOLS_DOMESTIC = '';
    process.env.BLOCKED_SYMBOLS_OVERSEAS = '';
    process.env.ORDER_MAX_PCT = '1';   // 1,000,000 × 1% = 10,000
    process.env.DAILY_ORDER_MAX_PCT = '5'; // 1,000,000 × 5% = 50,000
    process.env.ASSET_PROFILE_CRYPTO_SKIP_VERIFY = 'false';
  });
  afterEach(() => {
    process.env = { ...origEnv };
    jest.clearAllMocks();
  });

  const adaptiveBuy: OrderRequest = {
    exchange: 'kis', symbol: 'NAS:MU', market: 'overseas', side: 'buy', type: 'limit',
    price: 130_520, quantity: 2, amountKRW: 300_000,
  };

  test('adaptive buy blocks when fresh USD cash cannot cover the rounded price and fees', async () => {
    setupMockDB({ orderMaxPct: 'unlimited', dailyMaxPct: 'unlimited' });
    jest.mocked(readAdaptiveCashBudget).mockResolvedValue({ availableMinor: 20_039, krwPerMinor: 13 });
    const send = jest.fn();
    const r = await submitOrder(adaptiveBuy, send, { ...VALIDATED, adaptiveBuy: true });
    expect(r).toMatchObject({ ok: false, blockedBy: 'order_limit', error: 'adaptive_buy_cash_unavailable_or_exceeded' });
    expect(readAdaptiveCashBudget).toHaveBeenCalledWith('overseas', 1, 1000);
    expect(send).not.toHaveBeenCalled();
  });

  test('adaptive buy preserves DRY_RUN, and the live wrapper would pass the verified USD price to its adapter', async () => {
    setupMockDB({ orderMaxPct: 'unlimited', dailyMaxPct: 'unlimited' });
    jest.mocked(readAdaptiveCashBudget).mockResolvedValue({ availableMinor: 20_040, krwPerMinor: 13 });
    const send = jest.fn(async (_req: OrderRequest) => ({ ok: true, exchangeOrderId: 'mock' }));
    expect(await submitOrder(adaptiveBuy, send, { ...VALIDATED, adaptiveBuy: true })).toMatchObject({ dryRun: true });
    expect(send).not.toHaveBeenCalled();
    process.env.DRY_RUN = 'false';
    expect(await submitOrder(adaptiveBuy, send, { ...VALIDATED, adaptiveBuy: true })).toMatchObject({ ok: true });
    expect(send).toHaveBeenCalledWith({ ...adaptiveBuy, verifiedAdaptiveLimitUsd: 100 });
  });

  test('1. DRY_RUN 정상 주문 → status=dry_run + trade_logs 2건 + realSubmit 미호출', async () => {
    const cap = setupMockDB();
    const realSubmit = jest.fn();
    const r = await submitOrder(baseReq, realSubmit as never, VALIDATED);

    expect(r.ok).toBe(true);
    expect(r.dryRun).toBe(true);
    expect(r.blockedBy).toBe('dry_run');
    expect(r.orderId).toBe(1000);
    expect(r.clientOrderId).toMatch(/^co-/);
    expect(realSubmit).not.toHaveBeenCalled();
    expect(cap.updates.some((u) => u.status === 'dry_run')).toBe(true);
    const events = cap.logs.map((l) => l.event);
    expect(events).toContain('submit_attempt');
    expect(events).toContain('dry_run');
  });

  test('2. Kill Switch ON → blocked + blocked_by=kill_switch + realSubmit 미호출', async () => {
    process.env.KILL_SWITCH = 'true';
    const cap = setupMockDB();
    const realSubmit = jest.fn();
    const r = await submitOrder(baseReq, realSubmit as never, VALIDATED);

    expect(r.ok).toBe(false);
    expect(r.blockedBy).toBe('kill_switch');
    expect(r.error).toBe('KILL_SWITCH_ACTIVE');
    expect(realSubmit).not.toHaveBeenCalled();
    expect(cap.updates).toContainEqual(expect.objectContaining({ status: 'blocked', blockedBy: 'kill_switch' }));
    expect(cap.logs.map((l) => l.event)).toContain('blocked');
  });

  test('3. 블랙리스트 등록 심볼 → blocked + blocked_by=symbol_not_allowed', async () => {
    const cap = setupMockDB();
    process.env.BLOCKED_SYMBOLS_DOMESTIC = 'KRW-XRP';
    const r = await submitOrder({ ...baseReq, symbol: 'KRW-XRP' }, (async () => ({ ok: true })) as never, VALIDATED);

    expect(r.ok).toBe(false);
    expect(r.blockedBy).toBe('symbol_not_allowed');
    expect(cap.updates).toContainEqual(expect.objectContaining({ status: 'blocked', blockedBy: 'symbol_not_allowed' }));
  });

  test('4. 1회 한도 초과 → blocked_by=order_limit', async () => {
    const cap = setupMockDB();
    const r = await submitOrder({ ...baseReq, amountKRW: 20_000 }, (async () => ({ ok: true })) as never, VALIDATED);

    expect(r.ok).toBe(false);
    expect(r.blockedBy).toBe('order_limit');
    expect(cap.updates).toContainEqual(expect.objectContaining({ blockedBy: 'order_limit' }));
  });

  test('5. 일일 한도 초과 → blocked_by=daily_limit', async () => {
    const cap = setupMockDB({ dailySum: 45_000 });
    const r = await submitOrder(baseReq, (async () => ({ ok: true })) as never, VALIDATED);

    expect(r.ok).toBe(false);
    expect(r.blockedBy).toBe('daily_limit');
    expect(cap.updates).toContainEqual(expect.objectContaining({ blockedBy: 'daily_limit' }));
  });

  test('6. 실송신 성공 → status=accepted + exchange_order_id + trade_logs: accepted', async () => {
    process.env.DRY_RUN = 'false';
    const cap = setupMockDB();
    const realSubmit = jest.fn().mockResolvedValue({ ok: true, exchangeOrderId: 'EX-123' });
    const r = await submitOrder(baseReq, realSubmit, VALIDATED);

    expect(r.ok).toBe(true);
    expect(realSubmit).toHaveBeenCalledTimes(1);
    expect(cap.updates).toContainEqual(expect.objectContaining({ status: 'accepted', exchangeOrderId: 'EX-123' }));
    expect(cap.logs.map((l) => l.event)).toContain('accepted');
  });

  test('7. 실송신 거부 (ok:false) → status=rejected + trade_logs: rejected', async () => {
    process.env.DRY_RUN = 'false';
    const cap = setupMockDB();
    const realSubmit = jest.fn().mockResolvedValue({ ok: false, error: 'INSUFFICIENT_BALANCE' });
    const r = await submitOrder(baseReq, realSubmit, VALIDATED);

    expect(r.ok).toBe(false);
    expect(cap.updates).toContainEqual(expect.objectContaining({ status: 'rejected' }));
    expect(cap.logs.map((l) => l.event)).toContain('rejected');
  });

  test('8. 실송신 예외 → status=failed + error 전파 + trade_logs: error', async () => {
    process.env.DRY_RUN = 'false';
    const cap = setupMockDB();
    const realSubmit = jest.fn().mockRejectedValue(new Error('network down'));
    const r = await submitOrder(baseReq, realSubmit, VALIDATED);

    expect(r.ok).toBe(false);
    expect(r.error).toBe('network down');
    expect(cap.updates).toContainEqual(expect.objectContaining({ status: 'failed' }));
    expect(cap.logs.map((l) => l.event)).toContain('error');
  });

  // ── T-042 — "결과 불명"(outcomeUnknown): 재시도하면 같은 주문이 두 번 나갈 수 있는 실패 ────────────────────────
  describe('outcomeUnknown — 주문이 접수됐는지 알 수 없는 실패', () => {
    test.each([
      ['송신 중 예외 (연결 끊김)', 'failed', 'submit_outcome_unknown', () => jest.fn().mockRejectedValue(new Error('fetch failed (ECONNRESET)'))],
      ['KIS 5xx 응답', 'rejected', 'kis_5xx', () => jest.fn().mockResolvedValue({ ok: false, error: 'HTTP 502 bad gateway' })],
      ['네트워크 타임아웃 응답', 'rejected', 'network_error', () => jest.fn().mockResolvedValue({ ok: false, error: 'request timeout' })],
      ['어댑터 결과 불명', 'rejected', 'submit_outcome_unknown', () => jest.fn().mockResolvedValue({ ok: false, outcomeUnknown: true })],
    ] as const)('🔴 %s → outcomeUnknown=true', async (_name, status, blockedBy, makeSubmit) => {
      process.env.DRY_RUN = 'false';
      const cap = setupMockDB();
      const r = await submitOrder(baseReq, makeSubmit(), VALIDATED);
      expect(r.ok).toBe(false);
      expect(r.outcomeUnknown).toBe(true);
      expect(cap.updates).toContainEqual(expect.objectContaining({ status, blockedBy }));
    });

    test('🔴 KIS 가 접수한 직후 orders UPDATE 가 실패해도 결과 불명이다 (거래소엔 주문이 있다)', async () => {
      process.env.DRY_RUN = 'false';
      const cap = setupMockDB();
      // 접수 UPDATE 만 실패시킨다: 기본 목을 감싸 `status='accepted'` UPDATE 에서 던지게 한다
      const pool = (getPool as jest.Mock)();
      const inner = pool.query as jest.Mock;
      (getPool as jest.Mock).mockReturnValue({
        query: jest.fn(async (sql: string, p?: unknown[]) => {
          if (/UPDATE orders SET status='accepted'/.test(String(sql))) throw new Error('db gone');
          return inner(sql, p);
        }),
      });
      const realSubmit = jest.fn().mockResolvedValue({ ok: true, exchangeOrderId: 'EX-9' });
      const r = await submitOrder(baseReq, realSubmit, VALIDATED);
      expect(realSubmit).toHaveBeenCalledTimes(1);            // 거래소엔 이미 나갔다
      expect(r.ok).toBe(false);                               // 그러나 우리는 ok:false 를 돌려준다
      expect(r.outcomeUnknown).toBe(true);                    // → 호출처가 재시도하면 안 된다는 표시
      expect(cap.updates).toContainEqual(expect.objectContaining({ status: 'failed', blockedBy: 'submit_outcome_unknown' }));
      expect(cap.logs.map((l) => l.event)).toContain('error');
    });

    test('🔴 [2라운드 R2-2] 송신 성공 뒤 DB 가 계속 죽어 `failed` UPDATE 까지 던져도 결과 불명이다 (안쪽 catch 가 던지면 바깥 catch 로 올라간다)', async () => {
      process.env.DRY_RUN = 'false';
      setupMockDB();
      const pool = (getPool as jest.Mock)();
      const inner = pool.query as jest.Mock;
      (getPool as jest.Mock).mockReturnValue({
        query: jest.fn(async (sql: string, p?: unknown[]) => {
          // 송신 *이후*의 모든 orders 상태 갱신이 실패한다 (accepted 도, failed 도)
          if (/UPDATE orders SET status='(accepted|failed)'/.test(String(sql))) throw new Error('db gone');
          return inner(sql, p);
        }),
      });
      const realSubmit = jest.fn().mockResolvedValue({ ok: true, exchangeOrderId: 'EX-77' });
      const r = await submitOrder(baseReq, realSubmit, VALIDATED);
      expect(realSubmit).toHaveBeenCalledTimes(1);            // 거래소엔 이미 나갔다
      expect(r.ok).toBe(false);
      expect(r.error).toBe('db gone');
      expect(r.outcomeUnknown).toBe(true);                    // 🔴 플래그가 없으면 호출처가 확정 거부로 읽고 재시도해 이중 주문이 된다
    });

    test('송신 *전*(안전층 검사 단계)의 예외는 확정 실패다 — 바깥 catch 를 실제로 지나며, 거래소에 나가지 않았으므로 outcomeUnknown 이 없다', async () => {
      process.env.DRY_RUN = 'false';
      const cap = setupMockDB();
      const pool = (getPool as jest.Mock)();
      // 변동폭 가드(step 6b)가 던지게 한다: 이 예외는 checkDailyMax 처럼 자체 처리되지 않고 바깥 catch 로 올라간다
      jest.resetModules();
      jest.doMock('../volatility-guard', () => ({ checkVolatilityGuard: jest.fn().mockRejectedValue(new Error('guard gone')) }));
      let freshSubmit: typeof submitOrder;
      jest.isolateModules(() => {
        // 격리 레지스트리의 db 목은 새 인스턴스다 — 같은 풀에 연결한다
        const db = require('@/lib/db');
        db.getPool.mockReturnValue(pool);
        db.getAccountId.mockResolvedValue(1);
        freshSubmit = require('../dry-run').submitOrder;
      });
      try {
        const realSubmit = jest.fn().mockResolvedValue({ ok: true, exchangeOrderId: 'EX-1' });
        const r = await freshSubmit!(baseReq, realSubmit, VALIDATED);
        expect(realSubmit).not.toHaveBeenCalled();             // 송신 전에 죽었다
        expect(r.ok).toBe(false);
        expect(r.error).toBe('guard gone');                    // 바깥 catch 를 지났다는 증거
        expect(r.outcomeUnknown).toBeUndefined();              // 🔴 송신 전 실패에 불명 표시를 붙이면 멀쩡한 시그널이 잠긴다
        expect(cap.updates).toContainEqual(expect.objectContaining({ status: 'failed', blockedBy: 'submit_not_sent' }));
        expect(cap.logs.map((l) => l.event)).toContain('error');
      } finally {
        jest.dontMock('../volatility-guard');
        jest.resetModules();
      }
    });

    test.each([
      ['잔고 부족', 'INSUFFICIENT_BALANCE 주문가능금액 부족'],
      ['호가 단위 오류', '호가단위 오류'],
      ['장 마감', '장종료 시간외'],
      ['거래 정지', '거래정지 종목'],
    ])('KIS 의 명시적 거부(%s)는 확정 거부 — outcomeUnknown 이 없다', async (_n, error) => {
      process.env.DRY_RUN = 'false';
      setupMockDB();
      const r = await submitOrder(baseReq, jest.fn().mockResolvedValue({ ok: false, error }), VALIDATED);
      expect(r.ok).toBe(false);
      expect(r.outcomeUnknown).toBeUndefined();
    });

    test('안전층 차단(킬스위치·한도)은 송신 전이므로 확정 거부', async () => {
      process.env.KILL_SWITCH = 'true';
      setupMockDB();
      const r = await submitOrder(baseReq, jest.fn(), VALIDATED);
      expect(r).toMatchObject({ ok: false, blockedBy: 'kill_switch' });
      expect(r.outcomeUnknown).toBeUndefined();
    });

    test('성공·DRY_RUN 결과에는 outcomeUnknown 이 붙지 않는다 (기존 결과 형태 불변)', async () => {
      setupMockDB();
      const dry = await submitOrder(baseReq, jest.fn(), VALIDATED);
      expect(dry.outcomeUnknown).toBeUndefined();
      process.env.DRY_RUN = 'false';
      const ok = await submitOrder(baseReq, jest.fn().mockResolvedValue({ ok: true, exchangeOrderId: 'EX-1' }), VALIDATED);
      expect(ok.outcomeUnknown).toBeUndefined();
    });
  });

  test('9. clientOrderId 옵션 → INSERT orders의 client_order_id 컬럼에 전달 값 사용', async () => {
    const cap = setupMockDB();
    const r = await submitOrder(baseReq, (async () => ({ ok: true })) as never, { ...VALIDATED, clientOrderId: 'custom-id-42' });
    expect(r.clientOrderId).toBe('custom-id-42');
    const insertOrders = cap.queries.find((q) => /INSERT INTO orders/i.test(q.sql));
    expect(insertOrders?.params[1]).toBe('custom-id-42');
  });
});

import { getAccountId, getPool } from '@/lib/db';
import { submitOrder } from '@/lib/safety/dry-run';
import { getSymbolLabel, sendAlert } from '@/lib/notify';
import { approveSignal, approveSignalHybrid, createSignal, rejectSignal, TRADE_LOG_EVENTS } from '../service';

jest.mock('@/lib/db', () => ({
  getPool: jest.fn(),
  getAccountId: jest.fn(),
}));

// T-042 — 알림 발송은 막고(외부 호출 없음) 호출 인자만 본다. 종목명 조회는 고정값으로.
jest.mock('@/lib/notify', () => {
  const actual = jest.requireActual('@/lib/notify');
  return { ...actual, sendAlert: jest.fn(), getSymbolLabel: jest.fn(async (s: string) => s) };
});

// T-042 — 평소엔 진짜 `submitOrder` 그대로. 승인 경로 테스트가 "주문이 받아들여졌다/거부됐다"를 정할 때만 덮어쓴다.
jest.mock('@/lib/safety/dry-run', () => {
  const actual = jest.requireActual('@/lib/safety/dry-run');
  return { ...actual, submitOrder: jest.fn(actual.submitOrder) };
});
const ACCEPTED_ORDER = { ok: true, orderId: 2000, dryRun: true, blockedBy: 'dry_run' as const };

interface Captured {
  queries: Array<{ sql: string; params: unknown[] }>;
  signalInserts: Array<{ id: number; status: string; amount: number }>;
  signalUpdates: Array<{ id: number; consumedOrderId?: number; status?: string }>;
  orderInserts: number[];
  orderUpdates: Array<{ id: number; status?: string }>;
  tradeLogs: Array<{ orderId: number | null; event: string }>;
  approvedSql?: string;
  hybridIndicators?: string;
}

interface MockOpts {
  signalRow?: {
    id: number;
    status: string;
    symbol: string;
    side: 'buy' | 'sell';
    order_type: 'limit' | 'market';
    price: string | null;
    quantity: string | null;
    amount_krw: string;
    strategy_id: string | null;
  };
  dailySum?: number;
  /**
   * service.ts 의 "동일 심볼+방향 활성 시그널 중복 방지" 조회 결과.
   * 지정하면 해당 symbol/side 요청에 대해 기존 pending 시그널이 있는 것으로 응답한다.
   */
  activeDuplicate?: { id: number; symbol: string; side: 'buy' | 'sell' };
  /** T-042 — 선점(`executing`) UPDATE 가 몇 행을 바꾸는가. 0 이면 다른 쪽이 먼저 처리한 것 (기본 1) */
  claimAffectedRows?: number;
  /** T-042 — 거절 UPDATE 가 몇 행을 바꾸는가 (기본 1) */
  rejectAffectedRows?: number;
  /** T-042 — 최종 `approved` 기록 / 선점 복귀 UPDATE 가 DB 오류로 실패 */
  finalizeThrows?: boolean;
  releaseThrows?: boolean;
}

function setupMockDB(opts: MockOpts = {}): Captured {
  const cap: Captured = {
    queries: [],
    signalInserts: [],
    signalUpdates: [],
    orderInserts: [],
    orderUpdates: [],
    tradeLogs: [],
  };
  let nextOrderId = 2000;
  let nextSignalId = 3000;

  const query = jest.fn(async (sqlArg: unknown, paramsArg: unknown[] = []) => {
    const sql = String(sqlArg);
    const params = paramsArg ?? [];
    cap.queries.push({ sql, params });

    if (/INSERT INTO signals/i.test(sql)) {
      const id = nextSignalId++;
      const status = String(params[9]);
      const amount = Number(params[6]);
      cap.signalInserts.push({ id, status, amount });
      return [{ insertId: id }];
    }
    if (/UPDATE signals SET consumed_order_id=\?/i.test(sql)) {
      cap.signalUpdates.push({ id: Number(params[1]), consumedOrderId: Number(params[0]) });
      return [{}];
    }
    if (/UPDATE signals SET status='approved'/i.test(sql)) {
      if (opts.finalizeThrows) throw new Error('db gone (finalize)');
      cap.approvedSql = sql.replace(/\s+/g, ' ');
      cap.signalUpdates.push({ id: Number(params[1]), status: 'approved', consumedOrderId: params[0] as number });
      return [{ affectedRows: 1 }];
    }
    // T-042 — 선점·복귀·거절은 모두 `WHERE … AND status IN/=` 조건부 UPDATE 다. affectedRows 로 결과를 돌려준다.
    if (/UPDATE signals SET status='executing'/i.test(sql)) {
      const n = opts.claimAffectedRows ?? 1;
      if (n === 1) cap.signalUpdates.push({ id: Number(params[0]), status: 'executing' });
      return [{ affectedRows: n }];
    }
    if (/UPDATE signals SET status=\?, updated_at=NOW\(\) WHERE id=\? AND status='executing'/i.test(sql)) {
      if (opts.releaseThrows) throw new Error('db gone (release)');
      cap.signalUpdates.push({ id: Number(params[1]), status: String(params[0]) });
      return [{ affectedRows: 1 }];
    }
    if (/UPDATE signals SET status='rejected'/i.test(sql)) {
      const n = opts.rejectAffectedRows ?? 1;
      if (n === 1) cap.signalUpdates.push({ id: Number(params[0]), status: 'rejected' });
      return [{ affectedRows: n }];
    }
    if (/UPDATE signals SET (?:indicators=\?, )?status='approved_pending_entry'/i.test(sql)) {
      const n = opts.claimAffectedRows ?? 1;
      if (n === 1) cap.signalUpdates.push({ id: Number(params[params.length - 1]), status: 'approved_pending_entry' });
      if (/indicators=\?/.test(sql)) cap.hybridIndicators = String(params[0]);
      return [{ affectedRows: n }];
    }
    if (/UPDATE signals SET status='expired'/i.test(sql)) {
      cap.signalUpdates.push({ id: Number(params[0]), status: 'expired' });
      return [{ affectedRows: 1 }];
    }
    // 동일 심볼+방향 활성 시그널 중복 방지 조회 (auto_submit 이 아닌 경로에서만 발생).
    // 기본값은 "중복 없음" — activeDuplicate 를 지정한 케이스만 기존 시그널을 반환한다.
    // 상태 목록은 코드 상수(AWAITING_APPROVAL_STATUSES)에서 생성되므로 SQL 리터럴로 매칭하지 않는다.
    if (/SELECT id FROM signals[\s\S]*WHERE symbol = \? AND side = \?/i.test(sql)) {
      const [sym, side] = params as [string, string];
      const dup = opts.activeDuplicate;
      return [dup && dup.symbol === sym && dup.side === side ? [{ id: dup.id }] : []];
    }
    if (/SELECT[\s\S]*FROM signals WHERE id=\?/i.test(sql)) {
      const row = opts.signalRow ?? {
        id: Number(params[0]),
        status: 'pending',
        symbol: 'KRW-BTC',
        side: 'buy',
        order_type: 'limit',
        price: '90000000',
        quantity: '0.0001',
        amount_krw: '9000',
        strategy_id: 'test',
      };
      return [row ? [row] : []];
    }
    if (/INSERT INTO orders/i.test(sql)) {
      const id = nextOrderId++;
      cap.orderInserts.push(id);
      return [{ insertId: id }];
    }
    if (/INSERT INTO trade_logs/i.test(sql)) {
      // 🔴 운영 `trade_logs.event` 는 varchar(32) + STRICT_TRANS_TABLES — 33자 이름은 INSERT 가 실패한다(T-042 감사 D-2).
      //    이전 목은 길이를 검사하지 않아 33자 이벤트명이 테스트를 통과했다.
      if (String(params[1]).length > 32) throw new Error(`Data too long for column 'event' (${String(params[1]).length} > 32)`);
      cap.tradeLogs.push({ orderId: params[0] as number | null, event: String(params[1]) });
      return [{}];
    }
    if (/FROM orders[\s\S]*status IN \('filled','partially_filled'\)/i.test(sql)) {
      return [[]];
    }
    if (/SUM\(amount_krw\)/i.test(sql)) {
      return [[{ sum_krw: opts.dailySum ?? 0 }]];
    }
    if (/UPDATE orders/i.test(sql)) {
      const m = sql.match(/SET\s+status='([^']+)'/);
      cap.orderUpdates.push({ id: Number(params[params.length - 1]), status: m?.[1] });
      return [{}];
    }
    if (/FROM system_config WHERE `key` = \?/i.test(sql)) {
      // analyst_style / safety_limit_chase_disabled / safety_dry_run 등 — 기본 미설정
      return [[]];
    }
    throw new Error(`unexpected SQL: ${sql}`);
  });

  (getPool as jest.Mock).mockReturnValue({ query });
  (getAccountId as jest.Mock).mockResolvedValue(1);
  return cap;
}

describe('signals/service', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env.DRY_RUN = 'true';
    process.env.KILL_SWITCH = 'false';
    process.env.BLOCKED_SYMBOLS_DOMESTIC = '';
    process.env.BLOCKED_SYMBOLS_OVERSEAS = '';
    process.env.ORDER_MAX_KRW = '10000';
    process.env.DAILY_ORDER_MAX_KRW = '50000';
    process.env.SIGNAL_AUTO_SUBMIT_MAX_KRW = '5000';
    process.env.SIGNAL_DEFAULT_TTL_MIN = '30';
    process.env.ASSET_PROFILE_CRYPTO_SKIP_VERIFY = 'false';
  });
  afterEach(() => {
    process.env = { ...origEnv };
    jest.clearAllMocks();
  });

  // ⚠️ auto 는 `AUTOPILOT_MODE` 를 **명시적으로** 지정했을 때만 도달한다 (T-006 reviewer HIGH).
  //    구 ANALYST_ENABLED=true 만으로는 더 이상 auto 가 되지 않는다 — assist 상한.
  test('createSignal AUTOPILOT_MODE=auto → auto_submitted + submitOrder 호출 + consumed_order_id 업데이트', async () => {
    process.env.ANALYST_ENABLED = 'true';
    process.env.AUTOPILOT_MODE = 'auto';
    const cap = setupMockDB();
    const r = await createSignal({
      symbol: 'KRW-BTC',
      side: 'buy',
      orderType: 'limit',
      // T-020 — 주식은 정수 주식 수로만 거래된다. 원래 이 fixture 는 소수 수량
      // (0.000033)이었는데 그건 자매 프로젝트(암호화폐)의 관례이고, 이제 사이징이
      // 1주 미만을 주문 불성립으로 거부하므로 주식 현실에 맞는 값으로 바꾼다.
      price: 1_000,
      quantity: 3,
      amountKRW: 3_000,
    });
    expect(r.ok).toBe(true);
    expect(r.autoSubmitted).toBe(true);
    expect(r.orderId).toBeDefined();
    expect(cap.signalInserts[0].status).toBe('auto_submitted');
    expect(cap.orderInserts).toHaveLength(1);
    expect(cap.signalUpdates.some((u) => u.consumedOrderId === r.orderId)).toBe(true);
  });

  test('createSignal 엔진 on + assist → awaiting_approval (사람 승인 대기, 주문 미생성)', async () => {
    process.env.ANALYST_ENABLED = 'false';
    const cap = setupMockDB();
    const r = await createSignal({
      symbol: 'KRW-BTC',
      side: 'buy',
      orderType: 'limit',
      price: 90_000_000,
      quantity: 0.000_1,
      amountKRW: 9_000,
    });
    expect(r.ok).toBe(true);
    expect(r.autoSubmitted).toBe(false);
    expect(r.orderId).toBeUndefined();
    expect(cap.signalInserts[0].status).toBe('awaiting_approval');
    expect(cap.orderInserts).toHaveLength(0);
  });

  test('createSignal — 동일 심볼+방향 활성 시그널 존재 시 중복 생성 차단', async () => {
    process.env.ANALYST_ENABLED = 'false';
    const cap = setupMockDB({ activeDuplicate: { id: 777, symbol: 'KRW-BTC', side: 'buy' } });
    const r = await createSignal({
      symbol: 'KRW-BTC',
      side: 'buy',
      orderType: 'limit',
      price: 90_000_000,
      quantity: 0.000_1,
      amountKRW: 9_000,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('duplicate_active_signal');
    expect(r.signalId).toBe(777);
    expect(cap.signalInserts).toHaveLength(0);
    expect(cap.orderInserts).toHaveLength(0);
  });

  test('createSignal — 방향이 다르면 중복으로 보지 않는다', async () => {
    process.env.ANALYST_ENABLED = 'false';
    const cap = setupMockDB({ activeDuplicate: { id: 777, symbol: 'KRW-BTC', side: 'sell' } });
    const r = await createSignal({
      symbol: 'KRW-BTC',
      side: 'buy',
      orderType: 'limit',
      price: 90_000_000,
      quantity: 0.000_1,
      amountKRW: 9_000,
    });
    expect(r.ok).toBe(true);
    expect(cap.signalInserts).toHaveLength(1);
  });

  // T-003 §4-1 — auto 모드에서 SIGNAL_AUTO_SUBMIT_MAX_KRW(5,000) 초과분은 assist 로 격하된다.
  test('createSignal auto 모드 + 자동제출 한도 초과 → awaiting_approval 격하 (주문 미생성)', async () => {
    process.env.ANALYST_ENABLED = 'true';
    process.env.AUTOPILOT_MODE = 'auto';
    const cap = setupMockDB();
    const r = await createSignal({
      symbol: 'KRW-BTC',
      side: 'buy',
      orderType: 'limit',
      price: 90_000_000,
      quantity: 0.000_1,
      amountKRW: 9_000,
    });
    expect(r.ok).toBe(true);
    expect(r.autoSubmitted).toBe(false);
    expect(cap.signalInserts[0].status).toBe('awaiting_approval');
    expect(cap.orderInserts).toHaveLength(0);
  });

  // T-003 §4-1 — hard_stop 청산은 모드와 무관하게 즉시 자동 제출된다 (손실 확대 방지).
  test('createSignal assist 모드 + hard_stop 청산 → auto_submitted + 주문 생성', async () => {
    process.env.ANALYST_ENABLED = 'false';   // assist
    const cap = setupMockDB();
    const r = await createSignal({
      symbol: 'KRW-BTC',
      side: 'sell',
      orderType: 'market',
      amountKRW: 3_000,
      indicators: { exit_kind: 'hard_stop' },
    });
    expect(r.ok).toBe(true);
    expect(r.autoSubmitted).toBe(true);
    expect(cap.signalInserts[0].status).toBe('auto_submitted');
    expect(cap.orderInserts).toHaveLength(1);
  });

  // T-003 §4-1 — manual 모드는 관측 기록만 남기고 주문 경로가 없다.
  test('createSignal manual 모드 → detected (주문 미생성)', async () => {
    process.env.AUTOPILOT_MODE = 'manual';
    process.env.ANALYST_ENABLED = 'true';
    const cap = setupMockDB();
    const r = await createSignal({
      symbol: 'KRW-BTC',
      side: 'buy',
      orderType: 'limit',
      price: 90_000_000,
      amountKRW: 3_000,
    });
    expect(r.ok).toBe(true);
    expect(r.autoSubmitted).toBe(false);
    expect(cap.signalInserts[0].status).toBe('detected');
    expect(cap.orderInserts).toHaveLength(0);
  });

  // 🚨 회귀 — 구 스위치만으로는 자동 주문이 나가지 않는다.
  test('createSignal ANALYST_ENABLED=true 만으로는 자동 제출되지 않는다 (assist 상한)', async () => {
    process.env.ANALYST_ENABLED = 'true';
    delete process.env.AUTOPILOT_MODE;
    const cap = setupMockDB();
    const r = await createSignal({
      symbol: 'KRW-BTC',
      side: 'buy',
      orderType: 'limit',
      price: 90_000_000,
      amountKRW: 3_000,
    });
    expect(r.ok).toBe(true);
    expect(r.autoSubmitted).toBe(false);
    expect(cap.signalInserts[0].status).toBe('awaiting_approval');
    expect(cap.orderInserts).toHaveLength(0);
  });

  test('createSignal 블랙리스트 등록 심볼 → ok:false + INSERT 없음', async () => {
    process.env.BLOCKED_SYMBOLS_DOMESTIC = '005930';
    const cap = setupMockDB();
    const r = await createSignal({
      symbol: '005930',
      side: 'buy',
      orderType: 'limit',
      amountKRW: 3_000,
    });
    expect(r.ok).toBe(false);
    expect(cap.signalInserts).toHaveLength(0);
  });

  test('approveSignal 정상 → 선점(executing) → 주문 수락 → status=approved + consumed_order_id', async () => {
    (submitOrder as jest.Mock).mockResolvedValueOnce(ACCEPTED_ORDER);
    const cap = setupMockDB({
      signalRow: {
        id: 1234,
        status: 'pending',
        symbol: 'KRW-BTC',
        side: 'buy',
        order_type: 'limit',
        // T-020 — 소수 수량 fixture(0.0001)는 이제 "1주 미만 = 주문 불성립"으로 거부된다.
        price: '9000',
        quantity: '1',
        amount_krw: '9000',
        strategy_id: 'test',
      },
    });
    const r = await approveSignal(1234);
    expect(r.ok).toBe(true);
    expect(cap.signalUpdates.map((u) => u.status)).toEqual(['executing', 'approved']);   // 순서가 계약이다
    expect(cap.signalUpdates.find((u) => u.status === 'approved')?.consumedOrderId).toBe(2000);
  });

  test('approveSignal 신규 awaiting_approval 도 승인 가능', async () => {
    (submitOrder as jest.Mock).mockResolvedValueOnce(ACCEPTED_ORDER);
    const cap = setupMockDB({
      signalRow: {
        id: 4321,
        status: 'awaiting_approval',
        symbol: 'KRW-BTC',
        side: 'buy',
        order_type: 'limit',
        price: '9000',
        quantity: '1',
        amount_krw: '9000',
        strategy_id: 'test',
      },
    });
    const r = await approveSignal(4321);
    expect(r.ok).toBe(true);
    expect(cap.signalUpdates.some((u) => u.status === 'approved')).toBe(true);
  });

  // ── T-042 ────────────────────────────────────────────────────────────────

  const PENDING_ROW = {
    id: 5150, status: 'pending', symbol: 'KRW-BTC', side: 'buy' as const, order_type: 'limit' as const,
    price: '9000', quantity: '1', amount_krw: '9000', strategy_id: 'test',
  };

  test('🔴 주문이 거부·차단되면 approved 로 기록하지 않고 대기로 되돌린다 (이전에는 approved + 주문 없음이 쌓였다)', async () => {
    // 진짜 submitOrder: 이 목 환경은 한도(safety_order_max_pct)가 없어 1회 한도 0 → order_limit 차단.
    const cap = setupMockDB({ signalRow: PENDING_ROW });
    const r = await approveSignal(5150);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('order_not_accepted');
    expect(r.error).toMatch(/order_not_accepted/);
    expect(cap.signalUpdates.some((u) => u.status === 'approved')).toBe(false);
    // 선점 → 원래 상태('pending')로 복귀
    expect(cap.signalUpdates.map((u) => u.status)).toEqual(['executing', 'pending']);
    expect(cap.tradeLogs.some((l) => l.event === TRADE_LOG_EVENTS.approveOrderRejected)).toBe(true);
  });

  describe('승인 뒤 후처리 예외 — 결과를 거짓으로 말하지 않는다 (2라운드 감사 Low)', () => {
    test('주문은 접수됐는데 approved 기록이 실패하면 ok:true(주문 접수)로 답하고 경보를 보낸다 — "처리하지 못했습니다"가 아니다', async () => {
      (submitOrder as jest.Mock).mockResolvedValueOnce(ACCEPTED_ORDER);
      (sendAlert as jest.Mock).mockClear();
      jest.spyOn(console, 'error').mockImplementation(() => {});
      setupMockDB({ signalRow: PENDING_ROW, finalizeThrows: true });
      const r = await approveSignal(5150);
      expect(r).toMatchObject({ ok: true, orderId: 2000 });
      const alert = (sendAlert as jest.Mock).mock.calls.find((c) => String(c[1]).includes('상태 기록 실패'));
      expect(alert?.[0]).toBe('warning');
      expect(String(alert?.[2])).toContain('주문 #2000');
    });

    test('확정 거부 뒤 선점 복귀가 실패해도 order_not_accepted 를 돌려주고 경보를 보낸다 (시그널은 executing 에 남아 재승인이 막힌다)', async () => {
      (submitOrder as jest.Mock).mockResolvedValueOnce({ ok: false, orderId: 2003, blockedBy: 'order_limit', error: 'x' });
      (sendAlert as jest.Mock).mockClear();
      jest.spyOn(console, 'error').mockImplementation(() => {});
      const cap = setupMockDB({ signalRow: PENDING_ROW, releaseThrows: true });
      const r = await approveSignal(5150);
      expect(r.errorCode).toBe('order_not_accepted');
      expect(cap.signalUpdates.map((u) => u.status)).toEqual(['executing']);          // 복귀 안 됨 = 잠긴 채
      expect(cap.tradeLogs.map((l) => l.event)).toContain(TRADE_LOG_EVENTS.approveOrderRejected);   // 감사는 계속 남는다
      expect((sendAlert as jest.Mock).mock.calls.some((c) => String(c[1]).includes('복귀 실패'))).toBe(true);
    });

    test('결과 불명 알림 본문에 텔레그램에서 별표로 보이는 ** 표기가 없다', async () => {
      (submitOrder as jest.Mock).mockResolvedValueOnce({ ok: false, orderId: 2001, error: 'fetch failed', outcomeUnknown: true });
      (sendAlert as jest.Mock).mockClear();
      setupMockDB({ signalRow: PENDING_ROW });
      await approveSignal(5150);
      const body = String((sendAlert as jest.Mock).mock.calls.find((c) => String(c[1]).includes('결과 불명'))?.[2]);
      expect(body).not.toContain('**');
    });
  });

  test('🔴 감사 이벤트명은 trade_logs.event(varchar 32) 안에 들어간다', () => {
    for (const name of Object.values(TRADE_LOG_EVENTS)) expect(name.length).toBeLessThanOrEqual(32);
  });

  describe('🔴 주문 결과 불명(outcomeUnknown) — 재시도하면 이중 주문이 될 수 있다 (T-042 감사 D-1)', () => {
    const UNKNOWN = { ok: false, orderId: 2001, error: 'fetch failed (ECONNRESET)', outcomeUnknown: true };

    test('대기로 되돌리지 않고 선점(executing)을 유지한다 — 같은 시그널을 다시 승인할 수 없다', async () => {
      (submitOrder as jest.Mock).mockResolvedValueOnce(UNKNOWN);
      const cap = setupMockDB({ signalRow: PENDING_ROW });
      const r = await approveSignal(5150);
      expect(r).toMatchObject({ ok: false, errorCode: 'order_uncertain', orderId: 2001 });
      expect(r.error).toMatch(/^order_uncertain: /);
      expect(cap.signalUpdates.map((u) => u.status)).toEqual(['executing']);            // 복귀(pending) 없음, approved 도 아님
    });

    test('감사 기록(결과 불명)과 critical 알림을 남긴다', async () => {
      (submitOrder as jest.Mock).mockResolvedValueOnce(UNKNOWN);
      (sendAlert as jest.Mock).mockClear();
      const cap = setupMockDB({ signalRow: PENDING_ROW });
      await approveSignal(5150);
      expect(cap.tradeLogs.map((l) => l.event)).toContain(TRADE_LOG_EVENTS.approveOrderUncertain);
      const alert = (sendAlert as jest.Mock).mock.calls.find((c) => String(c[1]).includes('결과 불명'));
      expect(alert?.[0]).toBe('critical');
      expect(alert?.[2]).toContain('이중 주문');
    });

    test('확정 거부(outcomeUnknown 없음)는 여전히 대기로 복귀 — 재시도가 안전하다', async () => {
      (submitOrder as jest.Mock).mockResolvedValueOnce({ ok: false, orderId: 2002, blockedBy: 'order_limit', error: 'order limit not configured (0)' });
      const cap = setupMockDB({ signalRow: PENDING_ROW });
      const r = await approveSignal(5150);
      expect(r.errorCode).toBe('order_not_accepted');
      expect(cap.signalUpdates.map((u) => u.status)).toEqual(['executing', 'pending']);
    });

    test('알림 본문의 사유는 이스케이프된다', async () => {
      (submitOrder as jest.Mock).mockResolvedValueOnce({ ...UNKNOWN, error: 'bad <gateway> & more' });
      (sendAlert as jest.Mock).mockClear();
      setupMockDB({ signalRow: PENDING_ROW });
      await approveSignal(5150);
      const body = String((sendAlert as jest.Mock).mock.calls.find((c) => String(c[1]).includes('결과 불명'))?.[2]);
      expect(body).toContain('bad &lt;gateway&gt; &amp; more');
    });
  });

  test('🔴 선점에 지면(다른 쪽이 먼저 처리) 주문을 보내지 않는다 — 웹·텔레그램 동시 승인의 이중 주문 방지', async () => {
    (submitOrder as jest.Mock).mockClear();
    const cap = setupMockDB({ signalRow: PENDING_ROW, claimAffectedRows: 0 });
    const r = await approveSignal(5150);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/transition_conflict|invalid_status|signal_expired/);
    expect(submitOrder).not.toHaveBeenCalled();
    expect(cap.orderInserts).toHaveLength(0);
    expect(cap.signalUpdates.some((u) => u.status === 'approved')).toBe(false);
  });

  test('submitOrder 가 예외를 던지면 선점을 되돌리고 예외를 그대로 전파한다', async () => {
    (submitOrder as jest.Mock).mockRejectedValueOnce(new Error('kis down'));
    const cap = setupMockDB({ signalRow: PENDING_ROW });
    await expect(approveSignal(5150)).rejects.toThrow('kis down');
    expect(cap.signalUpdates.map((u) => u.status)).toEqual(['executing', 'pending']);
  });

  test('🔴 자동 제출 알림: 사유는 이스케이프하고, 종목명은 이미 안전한 값이라 *그대로* 쓴다 (이중 이스케이프 금지 — 2라운드 R2-1)', async () => {
    process.env.ANALYST_ENABLED = 'true';
    process.env.AUTOPILOT_MODE = 'auto';
    (submitOrder as jest.Mock).mockResolvedValueOnce(ACCEPTED_ORDER);
    (getSymbolLabel as jest.Mock).mockResolvedValueOnce('AT&amp;T &lt;Inc&gt;');       // 진짜 getSymbolLabel 의 반환 형태(이미 이스케이프됨)
    (sendAlert as jest.Mock).mockClear();
    setupMockDB();
    await createSignal({
      symbol: 'KRW-BTC', side: 'buy', orderType: 'limit', price: 1_000, quantity: 3, amountKRW: 3_000,
      reasoning: 'RSI14=30 < 38 & 과매도 > 기준',
    });
    const call = (sendAlert as jest.Mock).mock.calls.find((c) => String(c[1]).includes('자동 제출'));
    expect(call).toBeDefined();
    expect(call![1]).toBe('✅ 자동 제출: AT&amp;T &lt;Inc&gt;');
    expect(call![1]).not.toContain('&amp;amp;');
    expect(call![2]).toContain('사유: RSI14=30 &lt; 38 &amp; 과매도 &gt; 기준');
    expect(String(call![2]).replace(/&(?:amp|lt|gt);/g, '')).not.toMatch(/[<&>]/);
  });

  test('approveSignalHybrid 정상 → approved_pending_entry 로 원자적 전이', async () => {
    const cap = setupMockDB({ signalRow: PENDING_ROW });
    const r = await approveSignalHybrid(5150);
    expect(r).toMatchObject({ ok: true, status: 'approved_pending_entry' });
    expect(cap.signalUpdates.map((u) => u.status)).toEqual(['approved_pending_entry']);
  });

  test('approveSignalHybrid — editedScenario 는 indicators.ai.scenario 에 병합돼 *같은 UPDATE 문장*으로 저장된다', async () => {
    const row = { ...PENDING_ROW, indicators: JSON.stringify({ rsi14: 30, ai: { scenario: { entry: { price_zone: '100~110' }, note: 'keep' } } }) };
    const cap = setupMockDB({ signalRow: row as never });
    const r = await approveSignalHybrid(5150, { entry: { price_zone: '90~95' } } as never);
    expect(r.ok).toBe(true);
    const merged = JSON.parse(cap.hybridIndicators!);
    expect(merged.rsi14).toBe(30);                                       // 기존 지표는 보존
    expect(merged.ai.scenario.entry.price_zone).toBe('90~95');          // 사용자가 고친 구간으로 덮어씀
    expect(merged.ai.scenario.note).toBe('keep');                        // 건드리지 않은 필드는 보존
    expect(cap.signalUpdates.map((u) => u.status)).toEqual(['approved_pending_entry']);
  });

  test('🔴 최종 approved 기록은 선점(executing) 상태에서만 일어난다 — 다른 상태를 approved 로 덮어쓰지 않는다', async () => {
    (submitOrder as jest.Mock).mockResolvedValueOnce(ACCEPTED_ORDER);
    const cap = setupMockDB({ signalRow: PENDING_ROW });
    await approveSignal(5150);
    expect(cap.approvedSql).toMatch(/WHERE id=\? AND status='executing'/);
  });

  test('🔴 approveSignalHybrid — 전이에 지면(이미 처리됨) 성공이라고 답하지 않는다', async () => {
    const cap = setupMockDB({ signalRow: PENDING_ROW, claimAffectedRows: 0 });
    const r = await approveSignalHybrid(5150);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/transition_conflict|invalid_status|signal_expired/);
    expect(r.status).toBeUndefined();
    expect(cap.signalUpdates).toEqual([]);
  });

  test('rejectSignal — 이미 다른 쪽이 처리해 전이에 지면 로그·쿨다운을 남기지 않는다', async () => {
    const cap = setupMockDB({ signalRow: PENDING_ROW, rejectAffectedRows: 0 });
    const r = await rejectSignal(5150);
    expect(r.ok).toBe(false);
    expect(cap.tradeLogs.some((l) => l.event === 'signal_rejected')).toBe(false);
  });

  test('approveSignal 승인 대기 상태가 아니면 거부', async () => {
    setupMockDB({
      signalRow: {
        id: 1234,
        status: 'approved',
        symbol: 'KRW-BTC',
        side: 'buy',
        order_type: 'limit',
        price: '90000000',
        quantity: '0.0001',
        amount_krw: '9000',
        strategy_id: 'test',
      },
    });
    const r = await approveSignal(1234);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid_status/);
  });

  test('rejectSignal pending → status=rejected + trade_logs에 signal_rejected 기록', async () => {
    const cap = setupMockDB({
      signalRow: {
        id: 7777,
        status: 'pending',
        symbol: 'KRW-BTC',
        side: 'sell',
        order_type: 'limit',
        price: '90000000',
        quantity: '0.0001',
        amount_krw: '9000',
        strategy_id: 'test',
      },
    });
    const r = await rejectSignal(7777);
    expect(r.ok).toBe(true);
    expect(cap.signalUpdates.some((u) => u.status === 'rejected' && u.id === 7777)).toBe(true);
    expect(cap.tradeLogs.some((l) => l.event === 'signal_rejected')).toBe(true);
  });

  // Phase M — limit 호가 추격 (체결률 ↑)
  test('createSignal buy limit → chase 가격 적용 (limitChasePct=0.005)', async () => {
    process.env.ANALYST_ENABLED = 'true';
    process.env.AUTOPILOT_MODE = 'auto';   // 주문 생성 경로를 타려면 명시적 auto 가 필요하다
    const cap = setupMockDB();
    await createSignal({
      symbol: '005930', side: 'buy', orderType: 'limit',
      // T-020 — 원래 price=100,000 / amount=3,000 이라 사이징이 0.03주였다. 이제 그건
      // 주문 불성립으로 스킵되므로(주식은 1주 단위) 최소 1주가 성립하는 값으로 바꾼다.
      // 이 테스트의 의도(호가 추격이 가격에 적용되는가)는 그대로다.
      price: 1_000, amountKRW: 3_000,
    });
    // INSERT INTO orders 의 price (params[6]) 가 1_000 * 1.005 = 1_005
    const orderInsert = cap.queries.find((q) => /INSERT INTO orders/i.test(q.sql));
    expect(orderInsert).toBeDefined();
    expect(Number(orderInsert!.params[6])).toBeCloseTo(1_005, 0);
    // 수량은 floor(3000 / 1005) = 2주 — 소수가 아니다
    expect(Number(orderInsert!.params[7])).toBe(2);
  });

  test('createSignal sell limit → chase 가격 하향 적용', async () => {
    process.env.ANALYST_ENABLED = 'true';
    process.env.AUTOPILOT_MODE = 'auto';   // 주문 생성 경로를 타려면 명시적 auto 가 필요하다
    const cap = setupMockDB();
    await createSignal({
      symbol: '005930', side: 'sell', orderType: 'limit',
      price: 1_000, amountKRW: 3_000,
    });
    const orderInsert = cap.queries.find((q) => /INSERT INTO orders/i.test(q.sql));
    expect(orderInsert).toBeDefined();
    // 1_000 * 0.995 = 995
    expect(Number(orderInsert!.params[6])).toBeCloseTo(995, 0);
    expect(Number(orderInsert!.params[7])).toBe(3);   // floor(3000 / 995)
  });

  test('createSignal market 주문 → chase 미적용 (price null)', async () => {
    process.env.ANALYST_ENABLED = 'true';
    process.env.AUTOPILOT_MODE = 'auto';   // 주문 생성 경로를 타려면 명시적 auto 가 필요하다
    const cap = setupMockDB();
    await createSignal({
      symbol: '005930', side: 'buy', orderType: 'market',
      price: undefined, amountKRW: 3_000,
    });
    const orderInsert = cap.queries.find((q) => /INSERT INTO orders/i.test(q.sql));
    expect(orderInsert).toBeDefined();
    expect(orderInsert!.params[6]).toBeNull();
  });
});

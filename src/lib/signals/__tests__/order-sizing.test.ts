/**
 * T-020 — **주문서에 적힌 수량과 브로커가 받는 수량을 처음부터 일치시킨다.**
 *
 * ## 고정하려는 결함
 *
 * 사이징 공식이 `Math.floor((amountKRW / price) * 1e8) / 1e8` — **소수점 8자리로 내림**,
 * 즉 소수를 *만드는* 코드였다. 그 소수는 `orders.quantity` 에 그대로 저장되고 전송 직전
 * `submittedQuantity` 가 해외만 `Math.floor` 로 잘랐다.
 *
 *  - **1주 미만**(실측 79건 중 11건) → 잘라서 0주. 브로커에 `ORD_QTY: "0"` 이 나간다
 *  - **나머지** → 평균 16.8%·최대 49.9% 의 자본이 조용히 미투입. DB 엔 원래 소수가 남아
 *    있어 **사후에도 알 수 없다**
 *  - **국내**는 `submittedQuantity('domestic', …)` 가 통과시키므로 소수가 그대로 전송되고
 *    KIS 가 거절한다 (`kis-domestic.ts` 폴백이 `Math.floor` 를 쓰는 것 자체가 정수 전제의 증거)
 *
 * ## 이 파일이 고정하는 계약
 *
 *  1. 사이징 결과는 **정수 주식 수** — 국내·해외 모두
 *  2. 1주 미만이면 **주문을 내지 않는다**
 *  3. 그 스킵은 **절대 조용하지 않다** — 구조화된 errorCode + grep 토큰 + trade_logs
 *  4. 매도 스킵은 알림까지 간다 (포지션이 안 닫힌 상태이므로)
 *  5. `submittedQuantity` 의 의미를 바꾸지 않는다 ([[T-019]] 의 판정 기준을 흔들지 않기 위해)
 */
import { getAccountId, getPool } from '@/lib/db';
import { sendAlertThrottled } from '@/lib/notify/throttle';
import { submittedQuantity } from '@/lib/exchanges/order-quantity';
import { approveSignal, createSignal, sizeOrderQuantity } from '../service';

jest.mock('@/lib/db', () => ({ getPool: jest.fn(), getAccountId: jest.fn() }));
jest.mock('@/lib/notify/throttle', () => ({
  sendAlertThrottled: jest.fn(() => true),
  resetAlertThrottle: jest.fn(),
}));
// T-042 — `approveSignal` 은 이제 주문이 **받아들여졌을 때만** `approved` 로 기록한다. 정책 한도(총자산 대비 %)는
// 포트폴리오 총액에서 계산되는데 이 목 DB 에는 없어서, 한도를 통과시키지 않으면 승인 성공 경로를 검증할 수 없다.
// (예전엔 이 차단이 `approved` 기록에 가려져 테스트가 우연히 통과했다.)
jest.mock('@/lib/safety/order-limits', () => {
  const actual = jest.requireActual('@/lib/safety/order-limits');
  return {
    ...actual,
    getEffectiveOrderMax: jest.fn(async () => 10_000_000),
    getEffectiveDailyMax: jest.fn(async () => 50_000_000),
  };
});

// ── ① 순수 함수 계약 ─────────────────────────────────────────────────────────

describe('sizeOrderQuantity — 정수 주식 수만 만든다', () => {
  const limit = (market: 'domestic' | 'overseas', amountKRW: number, price: number) =>
    sizeOrderQuantity({ market, orderType: 'limit', amountKRW, price });

  test('🔴 국내도 정수화한다 — 예전엔 소수가 그대로 KIS 로 나가 거절됐다', () => {
    // 예전 공식: floor(100000/6540 * 1e8)/1e8 = 15.29051987 → 그대로 전송 → KIS 거절
    expect(limit('domestic', 100_000, 6_540)).toEqual({ quantity: 15, raw: 100_000 / 6_540 });
  });

  test('해외도 정수화한다 — 전송 직전 절삭(축소집행)이 아니라 사이징 시점에 확정', () => {
    // 예전: 1.9 주로 기록 → ORD_QTY "1" 전송 → 자본 47% 가 조용히 미투입
    expect(limit('overseas', 190, 100)).toEqual({ quantity: 1, raw: 1.9 });
  });

  test('🔴 1주 미만은 0 — 주문 불성립임을 호출부가 알 수 있다', () => {
    expect(limit('overseas', 132_223, 638_632).quantity).toBe(0);   // 실측 #2580 NAS:MSFT 0.207주
    expect(limit('domestic', 50_000, 70_000).quantity).toBe(0);
  });

  test('시장가는 여기서 수량을 확정하지 않는다 (어댑터가 금액에서 파생 — 이미 정수)', () => {
    const r = sizeOrderQuantity({ market: 'domestic', orderType: 'market', amountKRW: 100_000, price: 6_540 });
    expect(r).toEqual({ quantity: undefined, raw: undefined });
    // `undefined` 와 `0` 은 절대 같은 값이 아니다 — 뭉개면 "수량 미지정"이 "주문 불성립"이 된다
    expect(r.quantity).not.toBe(0);
  });

  test('요청에 수량이 이미 있으면 그것을 정수화한다 (exit-engine 의 보유수량 등)', () => {
    expect(sizeOrderQuantity({
      market: 'domestic', orderType: 'market', requestedQuantity: 7, amountKRW: 500_000, price: 70_000,
    })).toEqual({ quantity: 7, raw: 7 });
    // 잔고가 소수로 오더라도 주문서에는 정수만 적힌다 (KIS 가 받을 수 있는 형태)
    expect(sizeOrderQuantity({
      market: 'overseas', orderType: 'limit', requestedQuantity: 2.6, amountKRW: 1_000, price: 100,
    }).quantity).toBe(2);
  });

  test('가격이 없거나 이상하면 수량을 만들지 않는다', () => {
    expect(limit('domestic', 100_000, 0).quantity).toBeUndefined();
    expect(limit('domestic', 100_000, Number.NaN).quantity).toBeUndefined();
    expect(sizeOrderQuantity({
      market: 'domestic', orderType: 'limit', amountKRW: Number.NaN, price: 1_000,
    }).quantity).toBe(0);
  });

  test('🔴 결과는 항상 송신 수량과 같다 — 두 값이 갈라질 수 있는 구조를 없앤다', () => {
    for (const market of ['domestic', 'overseas'] as const) {
      for (const [amt, px] of [[100_000, 6_540], [190, 100], [1_000_000, 333], [7, 3]]) {
        const q = limit(market, amt, px).quantity!;
        expect(submittedQuantity(market, q)).toBe(q);
        expect(Number.isInteger(q)).toBe(true);
      }
    }
  });

  test('`submittedQuantity` 자체의 의미는 바뀌지 않았다 (T-019 판정 기준 무회귀)', () => {
    expect(submittedQuantity('domestic', 1.7)).toBe(1.7);   // 그대로 통과
    expect(submittedQuantity('overseas', 1.7)).toBe(1);
  });
});

// ── ② createSignal / approveSignal 통합 ──────────────────────────────────────

/** T-072 — 검증 상태가 backtested 인 전략 (목 DB 의 strategies 행) */
const VALIDATED_SID = 'validated-v1';

interface Captured {
  queries: Array<{ sql: string; params: unknown[] }>;
  orderInserts: Array<{ quantity: unknown; price: unknown; amount: unknown }>;
  signalStatusUpdates: string[];
  tradeLogs: Array<{ event: string; payload: Record<string, unknown> }>;
}

function setupMockDB(signalRow?: Record<string, unknown>): Captured {
  const cap: Captured = { queries: [], orderInserts: [], signalStatusUpdates: [], tradeLogs: [] };
  let nextId = 5000;
  const query = jest.fn(async (sqlArg: unknown, paramsArg: unknown[] = []) => {
    const sql = String(sqlArg);
    const params = paramsArg ?? [];
    cap.queries.push({ sql, params });

    if (/INSERT INTO signals/i.test(sql)) return [{ insertId: nextId++ }];
    if (/INSERT INTO orders/i.test(sql)) {
      cap.orderInserts.push({ price: params[6], quantity: params[7], amount: params[8] });
      return [{ insertId: nextId++ }];
    }
    if (/INSERT INTO trade_logs/i.test(sql)) {
      cap.tradeLogs.push({
        event: String(params[1]),
        payload: JSON.parse(String(params[2])) as Record<string, unknown>,
      });
      return [{ insertId: nextId++ }];
    }
    const m = /UPDATE signals SET status='([a-z_]+)'/i.exec(sql);
    // T-042 — 승인·거절 전이는 `affectedRows` 로 성패를 판정한다. 목은 "1행 변경"을 돌려준다.
    if (m) { cap.signalStatusUpdates.push(m[1]); return [{ affectedRows: 1 }]; }
    if (/UPDATE signals/i.test(sql)) return [{ affectedRows: 1 }];
    if (/SELECT[\s\S]*FROM signals WHERE id=\?/i.test(sql)) return [signalRow ? [signalRow] : []];
    if (/SELECT id FROM signals/i.test(sql)) return [[]];
    if (/UPDATE orders/i.test(sql)) return [{}];
    if (/SUM\(amount_krw\)/i.test(sql)) return [[{ sum_krw: 0 }]];
    // T-072 — 검증 상태 관문(G1·G6). 이 파일은 사이징 계약을 본다 — 매수 입력은 **검증된 전략**(VALIDATED_SID)으로 둔다.
    if (/FROM strategies/i.test(sql)) return [params[0] === VALIDATED_SID ? [{ validation_status: 'backtested' }] : []];
    return [[]];
  });
  (getPool as jest.Mock).mockReturnValue({ query, getConnection: async () => ({
    query, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
  }) });
  (getAccountId as jest.Mock).mockResolvedValue(1);
  return cap;
}

const origEnv = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  process.env.DRY_RUN = 'true';
  process.env.KILL_SWITCH = 'false';
  process.env.BLOCKED_SYMBOLS_DOMESTIC = '';
  process.env.BLOCKED_SYMBOLS_OVERSEAS = '';
  process.env.ORDER_MAX_KRW = '1000000';
  process.env.DAILY_ORDER_MAX_KRW = '5000000';
  process.env.SIGNAL_AUTO_SUBMIT_MAX_KRW = '1000000';
  process.env.ANALYST_ENABLED = 'true';
  process.env.AUTOPILOT_MODE = 'auto';
});
afterEach(() => {
  process.env = { ...origEnv };
  jest.restoreAllMocks();
});

describe('createSignal — 사이징이 정수를 만들고, 0주면 주문을 내지 않는다', () => {
  test('국내 지정가: amount/price = 15.29 → 15주 주문 (DB 에도 15)', async () => {
    const cap = setupMockDB();
    const r = await createSignal({
      strategyId: VALIDATED_SID, symbol: '005930', side: 'buy', orderType: 'limit', price: 6_540, amountKRW: 100_000,
    });
    expect(r.ok).toBe(true);
    expect(cap.orderInserts).toHaveLength(1);
    expect(Number(cap.orderInserts[0].quantity)).toBe(15);
    expect(Number.isInteger(Number(cap.orderInserts[0].quantity))).toBe(true);
  });

  test('🔴 T-072 WP-2b — 검증된 전략의 자동 제출 매수는 귀속이 전달돼 G6 를 통과하고 DRY_RUN 까지 간다(validation_gate 로 막히지 않는다)', async () => {
    const cap = setupMockDB();
    const r = await createSignal({
      strategyId: VALIDATED_SID, symbol: '005930', side: 'buy', orderType: 'limit', price: 6_540, amountKRW: 100_000,
    });
    expect(r).toMatchObject({ ok: true, autoSubmitted: true });
    expect((r.orderResult as { blockedBy?: string }).blockedBy).toBe('dry_run');
    // G1(createSignal)·G6(DRY_RUN 앞) 모두 같은 전략으로 조회했다 — G6 가 귀속 없음(null)으로 판정했다면 조회 없이 막혔다
    const lookups = cap.queries.filter(q => /FROM strategies/i.test(q.sql)).map(q => q.params[0]);
    expect(lookups).toEqual([VALIDATED_SID, VALIDATED_SID]);
  });

  test('해외 지정가: amount/price = 1.9 → 1주 주문 (DB 에도 1)', async () => {
    const cap = setupMockDB();
    const r = await createSignal({
      strategyId: VALIDATED_SID, symbol: 'NAS:AAPL', side: 'buy', orderType: 'limit', price: 100, amountKRW: 190,
    });
    expect(r.ok).toBe(true);
    expect(Number(cap.orderInserts[0].quantity)).toBe(1);
  });

  test('🔴 amount/price = 0.79 → 주문 없음 + 구별 가능한 errorCode', async () => {
    const cap = setupMockDB();
    const r = await createSignal({
      strategyId: VALIDATED_SID, symbol: 'NAS:META', side: 'buy', orderType: 'limit', price: 905_000, amountKRW: 718_971,
    });
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('quantity_below_min');
    expect(r.error).toContain('1주 미만');
    expect(cap.orderInserts).toHaveLength(0);       // 브로커에 ORD_QTY "0" 이 나가지 않는다
  });

  test('스킵은 세 곳에 동시에 남는다 — 상태 정정 · grep 토큰 · trade_logs', async () => {
    const cap = setupMockDB();
    await createSignal({
      strategyId: VALIDATED_SID, symbol: 'NAS:META', side: 'buy', orderType: 'limit', price: 905_000, amountKRW: 718_971,
    });

    // ① 시그널 상태 — `auto_submitted` 로 남으면 "주문을 냈다"는 거짓말이 된다
    expect(cap.signalStatusUpdates).toContain('skipped');
    // ② grep 토큰
    const logged = (console.warn as jest.Mock).mock.calls.flat().join(' ');
    expect(logged).toContain('SIZING_BELOW_MIN_QTY');
    // ③ 감사 기록 — 사후 집계가 가능한 형태
    const audit = cap.tradeLogs.find(l => l.event === 'sizing_below_min_qty');
    expect(audit).toBeDefined();
    expect(audit!.payload).toMatchObject({
      where: 'signal-sizing', symbol: 'NAS:META', side: 'buy', amountKRW: 718_971,
    });
    // raw 는 **호가 추격까지 반영된** 가격 기준이다 — 실제로 주문에 쓰였을 값이라야
    // "얼마가 모자랐는가"를 사후에 설명할 수 있다.
    expect(Number(audit!.payload.rawQuantity)).toBeCloseTo(718_971 / (905_000 * 1.005), 6);
    expect(Number(audit!.payload.price)).toBeCloseTo(905_000 * 1.005, 6);
  });

  test('🔴 매도 스킵은 알림까지 간다 — 포지션이 닫히지 않은 상태이기 때문', async () => {
    setupMockDB();
    await createSignal({
      symbol: '005930', side: 'sell', orderType: 'limit', price: 70_000, amountKRW: 50_000,
    });
    const call = (sendAlertThrottled as jest.Mock).mock.calls
      .find(c => String(c[0]).startsWith('sizing-below-min:'));
    expect(call).toBeDefined();
    expect(call![1]).toBe('warning');
    expect(call![3]).toContain('포지션이 그대로 남아 있습니다');
  });

  test('매수 스킵은 알림을 보내지 않는다 (자주 발생할 수 있어 매도 경고가 묻힌다)', async () => {
    setupMockDB();
    await createSignal({
      strategyId: VALIDATED_SID, symbol: '005930', side: 'buy', orderType: 'limit', price: 70_000, amountKRW: 50_000,
    });
    expect(sendAlertThrottled).not.toHaveBeenCalled();
  });

  test('시장가 청산은 무회귀 — 수량 미지정이 0 으로 오독되지 않는다', async () => {
    const cap = setupMockDB();
    const r = await createSignal({
      symbol: '005930', side: 'sell', orderType: 'market', price: 70_000, amountKRW: 700_000,
      indicators: { exit_kind: 'hard_stop' },
    });
    expect(r.ok).toBe(true);
    expect(cap.orderInserts).toHaveLength(1);
    expect(cap.orderInserts[0].quantity).toBeNull();     // 어댑터가 금액에서 파생한다
  });

  test('보유수량이 있는 시장가 청산은 그 수량이 정수로 나간다', async () => {
    const cap = setupMockDB();
    const r = await createSignal({
      symbol: '005930', side: 'sell', orderType: 'market', price: 70_000, quantity: 7,
      amountKRW: 490_000, indicators: { exit_kind: 'hard_stop' },
    });
    expect(r.ok).toBe(true);
    expect(Number(cap.orderInserts[0].quantity)).toBe(7);
  });

  test('amount_krw 는 재계산하지 않는다 — 안전 한도를 느슨하게 만들지 않기 위해', async () => {
    const cap = setupMockDB();
    // 100,000 / 6,540 = 15.29 → 15주 = 실집행 98,100. 그래도 한도 검사는 100,000 으로 한다.
    await createSignal({
      strategyId: VALIDATED_SID, symbol: '005930', side: 'buy', orderType: 'limit', price: 6_540, amountKRW: 100_000,
    });
    expect(Number(cap.orderInserts[0].amount)).toBe(100_000);
  });
});

describe('approveSignal — 승인해도 1주가 안 되면 주문하지 않는다', () => {
  const belowMinRow = {
    id: 777, status: 'awaiting_approval', symbol: 'NAS:META', side: 'buy',
    order_type: 'limit', price: '905000', quantity: null, amount_krw: '718971',
    strategy_id: null, expires_at: null, indicators: null, reasoning: null,
    consumed_order_id: null, created_at: new Date(), updated_at: new Date(),
  };

  test('🔴 주문 없음 + errorCode + 시그널 상태는 그대로 (사람이 다시 판단할 수 있어야 한다)', async () => {
    const cap = setupMockDB(belowMinRow);
    const r = await approveSignal(777);

    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('quantity_below_min');
    expect(cap.orderInserts).toHaveLength(0);
    // `approved` 로 바꾸면 "승인해서 주문했다"는 거짓 기록이 된다
    expect(cap.signalStatusUpdates).not.toContain('approved');
    expect(cap.tradeLogs.some(l => l.event === 'sizing_below_min_qty')).toBe(true);
    const audit = cap.tradeLogs.find(l => l.event === 'sizing_below_min_qty')!;
    expect(audit.payload).toMatchObject({ where: 'signal-approve', signalId: 777 });
  });

  test('1주 이상이면 정상 승인된다 (스킵이 정상 경로를 죽이지 않는다)', async () => {
    // T-072 WP-2b — 승인 경로가 전략 귀속을 넘기므로(G4 판정·G6 attribution) **검증된 전략** 행이면 예전처럼 승인이 성공한다.
    const cap = setupMockDB({ ...belowMinRow, price: '100000', amount_krw: '500000', strategy_id: VALIDATED_SID });
    const r = await approveSignal(777);
    expect(r.ok).toBe(true);
    // 호가 추격(+0.5%) 후 500,000 / 100,500 = 4.97 → 4주. 소수가 아니라 정수다.
    expect(cap.orderInserts).toHaveLength(1);
    expect(Number(cap.orderInserts[0].quantity)).toBe(4);
    expect(Number.isInteger(Number(cap.orderInserts[0].quantity))).toBe(true);
    expect(cap.signalStatusUpdates).toContain('approved');
  });

  test('🔴 T-072 G4 — 같은 행이라도 전략 귀속이 없으면(strategy_id null) 선점·주문 없이 validation_gate (사이징은 통과해도)', async () => {
    const cap = setupMockDB({ ...belowMinRow, price: '100000', amount_krw: '500000' });
    const r = await approveSignal(777);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('validation_gate');
    expect(cap.orderInserts).toHaveLength(0);                       // submitOrder 미도달 — orders 행 없음
    expect(cap.signalStatusUpdates).not.toContain('executing');     // 선점 없음
    expect(cap.signalStatusUpdates).not.toContain('approved');
    expect(cap.tradeLogs.find(l => l.event === 'signal_validation_gate')?.payload)
      .toEqual({ where: 'signal-approve', signalId: 777, strategyId: null, symbol: 'NAS:META', side: 'buy', reason: 'null_strategy' });
  });
});

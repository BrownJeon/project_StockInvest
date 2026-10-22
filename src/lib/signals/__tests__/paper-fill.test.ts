/**
 * T-072 (D-2) — 막힌 매수의 기록(승인 불가 감사 행 + 가상 체결) 단위 시험.
 *
 * 지킬 것:
 *  1. 감사 행은 `status='skipped'`(승인 불가) + `indicators.gate='validation_gate'`, `price`·`price_at_skip` 을 채운다(T-070 이 price 를 읽음)
 *  2. 가상 체결: 멱등(같은 signal_id 두 번 → 1행), 해외는 어댑터와 같은 USD 단가 + 1시간 이내 fx_rates 환율, 모르면 NULL,
 *     수수료율 해외 0.25%·국내 0.014% 를 행마다 기록, fill_model 라벨
 *     🔴 WP-2b — `INSERT IGNORE` 를 쓰지 않는다: **중복(1062)만** "이미 있음"이고, 그 밖의 오류(STRICT 데이터 오류 등)는 잘라 넣지 않고
 *     기록 실패(error)로 돌려준다. 목은 실제 DB 처럼 같은 signal_id 두 번째 INSERT 에서 1062 를 던진다.
 *  3. 🔴 어떤 DB 오류도 던지지 않는다(테이블 없음 포함)
 *  4. 🔴 실 장부(orders·executions·position_state·portfolio_snapshots·holdings)에 쓰지 않는다 · 외부 환율 조회를 유발하지 않는다
 *  5. WP-2b — G3·G4·G5 의 trade_logs 흔적(`signal_validation_gate`, ≤32자, payload 모양, 던지지 않음) · 카드 indicators 표지 병합
 */
jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/exchanges/kis', () => ({ kis: {}, getBalancesDetailed: jest.fn() }));
jest.mock('@/lib/exchanges/fx', () => ({ getUsdKrwRate: jest.fn(async () => 1400) }));

import { getPool } from '@/lib/db';
import { getUsdKrwRate } from '@/lib/exchanges/fx';
import {
  PAPER_FILL_FEE_RATE_PCT,
  VALIDATION_GATE_TRADE_LOG_EVENT,
  insertPaperFill,
  insertValidationAuditSignal,
  readFreshUsdKrw,
  recordValidationBlockedBuy,
  recordValidationGateEvent,
  withValidationGateIndicators,
  type PaperFillInput,
} from '../paper-fill';
import { overseasLimitUnitUsd } from '../signal-cash-gate';
import { isAwaitingApproval } from '../statuses';

const LEDGER = /\b(orders|executions|position_state|portfolio_snapshots|holdings)\b/i;

interface World {
  fxRow: { rate: unknown; age_sec: unknown } | null;
  fxThrows: boolean;
  throwOn: RegExp | null;
  /** 이 정규식에 걸리는 SQL 은 STRICT 데이터 오류(1406, 길이 초과)를 던진다 — IGNORE 였다면 경고로 낮아져 잘려 들어갔을 오류 */
  dataErrorOn: RegExp | null;
  calls: Array<{ sql: string; params: unknown[] }>;
  paper: Map<unknown, unknown[]>;
  signals: unknown[][];
  tradeLogs: unknown[][];
}
let w: World;

function setupDb() {
  const query = jest.fn(async (sqlArg: unknown, params: unknown[] = []) => {
    const sql = String(sqlArg);
    w.calls.push({ sql, params });
    if (w.throwOn && w.throwOn.test(sql)) throw Object.assign(new Error("Table 'paper_fills' doesn't exist"), { code: 'ER_NO_SUCH_TABLE' });
    if (w.dataErrorOn && w.dataErrorOn.test(sql)) {
      throw Object.assign(new Error("Data too long for column 'origin' at row 1"), { code: 'ER_DATA_TOO_LONG', errno: 1406 });
    }
    if (/FROM fx_rates/.test(sql)) {
      if (w.fxThrows) throw new Error('db down');
      return [w.fxRow ? [w.fxRow] : []];
    }
    if (/INSERT IGNORE INTO paper_fills/.test(sql)) throw new Error('T-072 WP-2b: paper_fills 는 INSERT IGNORE 를 쓰지 않는다');
    if (/INSERT INTO paper_fills/.test(sql)) {
      // 실제 DB 처럼: UNIQUE(signal_id) 충돌이면 1062 를 던진다(IGNORE 가 없으므로)
      if (w.paper.has(params[0])) {
        throw Object.assign(new Error(`Duplicate entry '${String(params[0])}' for key 'uq_paper_fills_signal'`), { code: 'ER_DUP_ENTRY', errno: 1062 });
      }
      w.paper.set(params[0], params);
      return [{ affectedRows: 1, insertId: 500 + w.paper.size }];
    }
    if (/INSERT INTO signals/.test(sql)) { w.signals.push(params); return [{ insertId: 9000 + w.signals.length }]; }
    if (/INSERT INTO trade_logs/.test(sql)) { w.tradeLogs.push(params); return [{ insertId: 1 }]; }
    return [[]];
  });
  (getPool as jest.Mock).mockReturnValue({ query });
}

/** paper_fills INSERT 파라미터 → 열 이름 */
const PF_COLS = ['signal_id', 'strategy_id', 'gate_reason', 'origin', 'market', 'symbol', 'order_type', 'currency',
  'limit_price', 'limit_price_krw', 'fx_usdkrw', 'zone_lo', 'zone_hi', 'quantity', 'amount_krw',
  'fee_rate_pct', 'fee_est_krw', 'fill_model', 'valid_from', 'valid_until', 'signal_created_at'] as const;
const pf = (params: unknown[]) => Object.fromEntries(PF_COLS.map((c, i) => [c, params[i]])) as Record<(typeof PF_COLS)[number], unknown>;
/** signals 감사 INSERT 파라미터 → 열 이름 */
const SG_COLS = ['strategy_id', 'symbol', 'order_type', 'price', 'quantity', 'amount_krw', 'reasoning', 'indicators',
  'status', 'expires_at', 'price_at_skip', 'market'] as const;
const sg = (params: unknown[]) => Object.fromEntries(SG_COLS.map((c, i) => [c, params[i]])) as Record<(typeof SG_COLS)[number], unknown>;

const base = (over: Partial<PaperFillInput> = {}): PaperFillInput => ({
  signalId: 1, strategyId: 'rsi-oversold-v1', gateReason: 'unvalidated', origin: 'engine',
  symbol: '005930', orderType: 'limit', limitPriceKrw: 70_350, quantity: 4, amountKrw: 300_000,
  fillModel: 'signal_limit_immediate', validUntil: new Date('2026-10-23T01:00:00Z'), ...over,
});

let err: jest.SpyInstance;
let warn: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  w = { fxRow: { rate: '1400.0000', age_sec: 30 }, fxThrows: false, throwOn: null, dataErrorOn: null, calls: [], paper: new Map(), signals: [], tradeLogs: [] };
  setupDb();
  err = jest.spyOn(console, 'error').mockImplementation(() => {});
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  // 🔴 어떤 시험에서도 실 장부 테이블을 건드리지 않는다 · 외부 환율 조회 0
  expect(w.calls.filter((c) => LEDGER.test(c.sql))).toEqual([]);
  expect(getUsdKrwRate).not.toHaveBeenCalled();
  err.mockRestore(); warn.mockRestore();
});

describe('1. 가상 체결 — 국내', () => {
  test('원화 단가·수수료 0.014%·fill_model, 환율 조회 없음', async () => {
    const r = await insertPaperFill(base());
    expect(r).toEqual({ inserted: true, id: 501 });
    const row = pf(w.paper.get(1)!);
    expect(row).toMatchObject({
      signal_id: 1, strategy_id: 'rsi-oversold-v1', gate_reason: 'unvalidated', origin: 'engine', market: 'domestic',
      symbol: '005930', order_type: 'limit', currency: 'KRW', limit_price: 70_350, limit_price_krw: 70_350, fx_usdkrw: null,
      quantity: 4, amount_krw: 300_000, fee_rate_pct: 0.014, fill_model: 'signal_limit_immediate',
    });
    expect(row.fee_est_krw).toBeCloseTo((4 * 70_350 * 0.014) / 100, 2);
    expect(w.calls.some((c) => /fx_rates/.test(c.sql))).toBe(false);
    // WP-2b — 일반 INSERT(IGNORE 없음): STRICT 데이터 오류를 경고로 낮춰 잘라 넣지 않게. 중복 무시는 1062 처리로만 한다(아래 3절).
    const pfSql = w.calls.find((c) => /paper_fills/.test(c.sql))!.sql;
    expect(pfSql).toMatch(/INSERT INTO paper_fills/);
    expect(pfSql).not.toMatch(/IGNORE/i);
    expect(pfSql).not.toMatch(/ON DUPLICATE KEY/i);
  });

  test('수수료율 상수 — 해외 0.25 · 국내 0.014', () => {
    expect(PAPER_FILL_FEE_RATE_PCT).toEqual({ overseas: 0.25, domestic: 0.014 });
  });

  test('수량 0(1주 미만) 은 0 으로 남기고 수수료 0, 수량 미확정(시장가)은 NULL·의도 금액 기준', async () => {
    await insertPaperFill(base({ signalId: 2, quantity: 0 }));
    expect(pf(w.paper.get(2)!)).toMatchObject({ quantity: 0, fee_est_krw: 0 });
    await insertPaperFill(base({ signalId: 3, orderType: 'market', quantity: undefined, limitPriceKrw: undefined, fillModel: 'signal_market_immediate' }));
    const m = pf(w.paper.get(3)!);
    expect(m).toMatchObject({ quantity: null, limit_price: null, limit_price_krw: null, fill_model: 'signal_market_immediate' });
    expect(m.fee_est_krw).toBeCloseTo((300_000 * 0.014) / 100, 2);
  });
});

describe('2. 가상 체결 — 해외 (USD 단가 = 어댑터와 같은 계산, 1시간 이내 환율만)', () => {
  test.each([[280_000, 1400], [700, 1400], [1_234_567, 1324.63]])('원화 %p @ %p → overseasLimitUnitUsd 와 같은 USD 단가', async (krw, fx) => {
    w.fxRow = { rate: String(fx), age_sec: 30 };
    await insertPaperFill(base({ symbol: 'NAS:MU', limitPriceKrw: krw, quantity: 2 }));
    const row = pf(w.paper.get(1)!);
    expect(row).toMatchObject({ market: 'overseas', currency: 'USD', fx_usdkrw: fx, limit_price_krw: krw, fee_rate_pct: 0.25 });
    expect(row.limit_price).toBe(overseasLimitUnitUsd(krw, fx));
    expect(row.fee_est_krw).toBe(Math.round(((2 * krw * 0.25) / 100) * 100) / 100);   // 원 단위 소수 2자리 반올림
  });

  test.each([
    ['환율 1시간 초과', () => { w.fxRow = { rate: '1400', age_sec: 3_601 }; }],
    ['환율 행 없음', () => { w.fxRow = null; }],
    ['환율 조회 실패', () => { w.fxThrows = true; }],
    ['환율 상식 밖(1)', () => { w.fxRow = { rate: '1', age_sec: 10 }; }],
  ])('%s → USD 단가·환율 NULL, 기록은 남긴다', async (_n, arrange) => {
    arrange();
    const r = await insertPaperFill(base({ symbol: 'NAS:MU', limitPriceKrw: 280_000 }));
    expect(r.inserted).toBe(true);
    expect(pf(w.paper.get(1)!)).toMatchObject({ currency: 'USD', limit_price: null, fx_usdkrw: null, limit_price_krw: 280_000 });
  });

  test('readFreshUsdKrw 는 DB 행만 본다(외부 조회 없음), 3600초 이하면 known', async () => {
    w.fxRow = { rate: '1300.5', age_sec: 3_600 };
    await expect(readFreshUsdKrw()).resolves.toBe(1300.5);
    w.fxRow = { rate: '1300.5', age_sec: 3_601 };
    await expect(readFreshUsdKrw()).resolves.toBeNull();
  });
});

describe('3. 멱등·실패 격리', () => {
  test('🔴 같은 signal_id 두 번 → 1행 (두 번째는 inserted=false·duplicate, 오류 아님·로그 없음)', async () => {
    expect((await insertPaperFill(base())).inserted).toBe(true);
    expect(await insertPaperFill(base({ amountKrw: 1 }))).toEqual({ inserted: false, id: null, duplicate: true });
    expect(w.paper.size).toBe(1);
    expect(pf(w.paper.get(1)!).amount_krw).toBe(300_000);   // 먼저 들어간 행을 덮어쓰지 않는다
    expect(err).not.toHaveBeenCalled();                     // 중복은 기록 실패가 아니다
  });

  test('🔴 WP-2b — 중복이 아닌 데이터 오류(STRICT 1406 길이 초과)는 잘라 넣지 않고 기록 실패로 돌려준다(던지지 않음·로그)', async () => {
    w.dataErrorOn = /INSERT INTO paper_fills/;
    const r = await insertPaperFill(base({ signalId: 77 }));
    expect(r).toEqual({ inserted: false, id: null, error: expect.stringContaining('Data too long') });
    expect(r.duplicate).toBeUndefined();                    // 중복으로 오인하지 않는다
    expect(w.paper.has(77)).toBe(false);
    expect(err).toHaveBeenCalledWith(expect.stringContaining('가상 체결 기록 실패'));
  });

  test.each([
    ['errno 1062', { errno: 1062 }],
    ['code ER_DUP_ENTRY', { code: 'ER_DUP_ENTRY' }],
  ])('중복 판정은 %s 로 한다', async (_n, extra) => {
    (getPool as jest.Mock).mockReturnValue({ query: jest.fn(async () => { throw Object.assign(new Error('dup'), extra); }) });
    await expect(insertPaperFill(base())).resolves.toEqual({ inserted: false, id: null, duplicate: true });
  });

  test('🔴 테이블 없음(마이그레이션 전)·DB 오류 → 던지지 않는다', async () => {
    w.throwOn = /paper_fills/;
    await expect(insertPaperFill(base())).resolves.toMatchObject({ inserted: false, id: null, error: expect.stringContaining("doesn't exist") });
    expect(err).toHaveBeenCalled();
  });

  test('getPool 자체가 던져도 던지지 않는다', async () => {
    (getPool as jest.Mock).mockImplementation(() => { throw new Error('setup fatal'); });
    await expect(insertPaperFill(base())).resolves.toMatchObject({ inserted: false });
    await expect(insertValidationAuditSignal({
      strategyId: null, symbol: '005930', orderType: 'limit', price: 1, quantity: null, amountKrw: 1, reasoning: null,
      indicators: null, expiresAt: null, gateReason: 'null_strategy', gateStatus: null, origin: 'unspecified',
    })).resolves.toBeNull();
  });
});

const audit = (over: Partial<Parameters<typeof insertValidationAuditSignal>[0]> = {}) => ({
  strategyId: 'rsi-oversold-v1', symbol: '005930', orderType: 'limit' as const, price: 70_000, quantity: undefined,
  amountKrw: 300_000, reasoning: 'RSI14 < 38', indicators: { rsi14: 31.2, interval: '1h' }, expiresAt: new Date('2026-10-23T01:00:00Z'),
  gateReason: 'unvalidated' as const, gateStatus: 'unvalidated', origin: 'engine' as const, ...over,
});

describe('4. 승인 불가 감사 행 (signals)', () => {
  test('🔴 status=skipped (승인 대기 아님), indicators.gate, price·price_at_skip 채움, side=buy', async () => {
    const id = await insertValidationAuditSignal(audit());
    expect(id).toBe(9001);
    const row = sg(w.signals[0]);
    expect(row.status).toBe('skipped');
    expect(isAwaitingApproval(String(row.status))).toBe(false);
    expect(['detected', 'approved_pending_entry', 'executing', 'auto_submitted']).not.toContain(row.status);
    expect(row.price).toBe(70_000);
    expect(row.price_at_skip).toBe(70_000);
    expect(row.market).toBe('domestic');
    const ind = JSON.parse(String(row.indicators));
    expect(ind).toMatchObject({ rsi14: 31.2, interval: '1h', gate: 'validation_gate', validation_gate: { reason: 'unvalidated', status: 'unvalidated', origin: 'engine' } });
    const sql = w.calls.find((c) => /INSERT INTO signals/.test(c.sql))!.sql;
    expect(sql).toMatch(/VALUES \(\?, \?, 'buy',/);
  });

  test.each([[null], ['str'], [[1, 2]], [undefined]])('indicators %p 가 객체가 아니어도 gate 키는 남는다', async (ind) => {
    await insertValidationAuditSignal(audit({ indicators: ind }));
    expect(JSON.parse(String(sg(w.signals[0]).indicators)).gate).toBe('validation_gate');
  });

  test('가격이 없으면(시장가) NULL 로 남기고 경고 1줄', async () => {
    await insertValidationAuditSignal(audit({ orderType: 'market', price: undefined }));
    expect(sg(w.signals[0])).toMatchObject({ price: null, price_at_skip: null });
    expect(warn).toHaveBeenCalled();
  });

  test('해외 종목은 market=overseas', async () => {
    await insertValidationAuditSignal(audit({ symbol: 'NAS:MU', price: 280_000 }));
    expect(sg(w.signals[0]).market).toBe('overseas');
  });
});

describe('5. recordValidationBlockedBuy — 감사 행 → 그 id 로 가상 체결', () => {
  test('가상 체결의 signal_id = 감사 행 id, 사이징 결과(호가 추격 지정가·정수 수량)를 쓴다', async () => {
    const r = await recordValidationBlockedBuy({ ...audit(), sized: { limitPriceKrw: 70_350, quantity: 4 } });
    expect(r).toEqual({ auditSignalId: 9001, paperFillId: 501, paperFillInserted: true });
    const row = pf(w.paper.get(9001)!);
    expect(row).toMatchObject({ signal_id: 9001, limit_price_krw: 70_350, quantity: 4, fill_model: 'signal_limit_immediate' });
    expect(row.valid_until).toEqual(new Date('2026-10-23T01:00:00Z'));
    expect(sg(w.signals[0]).price).toBe(70_000);           // 감사 행은 시그널 원 가격
  });

  test('시장가 → fill_model signal_market_immediate', async () => {
    await recordValidationBlockedBuy({ ...audit({ orderType: 'market' }), sized: { limitPriceKrw: undefined, quantity: undefined } });
    expect(pf(w.paper.get(9001)!).fill_model).toBe('signal_market_immediate');
  });

  test('🔴 감사 행이 실패하면 가상 체결도 만들지 않는다(멱등 키 없음) — 던지지 않는다', async () => {
    w.throwOn = /INSERT INTO signals/;
    await expect(recordValidationBlockedBuy({ ...audit(), sized: { limitPriceKrw: 1, quantity: 1 } }))
      .resolves.toEqual({ auditSignalId: null, paperFillId: null, paperFillInserted: false });
    expect(w.calls.some((c) => /paper_fills/.test(c.sql))).toBe(false);
  });

  test('🔴 가상 체결만 실패(테이블 없음) → 감사 행 id 는 돌려주고 던지지 않는다', async () => {
    w.throwOn = /paper_fills/;
    await expect(recordValidationBlockedBuy({ ...audit(), sized: { limitPriceKrw: 1, quantity: 1 } }))
      .resolves.toEqual({ auditSignalId: 9001, paperFillId: null, paperFillInserted: false });
  });

  test('🔴 WP-2b (c) — 사이징 결과 0주(1주 가격 > 시그널 금액)도 가상 체결에 남기고 quantity 는 NULL 이 아니라 0', async () => {
    const r = await recordValidationBlockedBuy({ ...audit({ price: 905_000, amountKrw: 718_971 }), sized: { limitPriceKrw: 909_525, quantity: 0 } });
    expect(r.paperFillInserted).toBe(true);
    const row = pf(w.paper.get(9001)!);
    expect(row.quantity).toBe(0);
    expect(row.quantity).not.toBeNull();
    expect(row.fee_est_krw).toBe(0);
    expect(row.limit_price_krw).toBe(909_525);
  });
});

describe('6. WP-2b — G3·G4·G5 차단 흔적(trade_logs) · 카드 indicators 표지', () => {
  test('🔴 이벤트 이름은 trade_logs.event varchar(32) 안이다(33자면 STRICT 에서 조용히 유실)', () => {
    expect(VALIDATION_GATE_TRADE_LOG_EVENT).toBe('signal_validation_gate');
    expect(VALIDATION_GATE_TRADE_LOG_EVENT.length).toBeLessThanOrEqual(32);
  });

  test('payload = {where, signalId, strategyId, symbol, side, reason}, order_id NULL', async () => {
    await expect(recordValidationGateEvent({
      where: 'entry-watcher', signalId: 42, strategyId: null, symbol: '005930', side: 'buy', reason: 'null_strategy',
    })).resolves.toBe(true);
    expect(w.tradeLogs).toHaveLength(1);
    const [orderId, event, payload] = w.tradeLogs[0];
    expect(orderId).toBeNull();
    expect(event).toBe('signal_validation_gate');
    expect(JSON.parse(String(payload))).toEqual({
      where: 'entry-watcher', signalId: 42, strategyId: null, symbol: '005930', side: 'buy', reason: 'null_strategy',
    });
  });

  test('🔴 기록 실패는 던지지 않는다(false + 로그)', async () => {
    w.throwOn = /trade_logs/;
    await expect(recordValidationGateEvent({
      where: 'custom-confirm', signalId: null, strategyId: null, symbol: '005930', side: 'buy', reason: 'null_strategy',
    })).resolves.toBe(false);
    expect(err).toHaveBeenCalled();
  });

  test('카드 indicators 에 표지를 더해도 원래 값(진입 구간·목표·손절)은 그대로 남는다', () => {
    const card = { pattern: 'eod-high-close', ai: { scenario: { entry: { price_zone: '93000~94000' }, exit: { target_pct: 3.5, stop_pct: 1.8 } } } };
    const out = JSON.parse(withValidationGateIndicators(card, { reason: 'unregistered', status: null, origin: 'post_market' }));
    expect(out).toEqual({ ...card, gate: 'validation_gate', validation_gate: { reason: 'unregistered', status: null, origin: 'post_market' } });
  });
});

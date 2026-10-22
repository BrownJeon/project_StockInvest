/**
 * T-072 G1 — `createSignal` × 검증 상태 관문 통합.
 *
 * 지킬 것 (설계 F-1·F-2·F-7·F-13·F-16, Stage 0 I 절 시험 1·2·3·5·6):
 *  1. 미검증·미등록·귀속 없음·상태 이상·조회 실패 매수 → `{ ok:false, signalId:0, errorCode:'validation_gate'|'validation_lookup_error' }`.
 *     승인 가능한 시그널 INSERT 0 · 승인 요청 알림 0 · RAG 0 · 중복 검사 0 · 현금 게이트(잔고 조회) 0 · 주문 0 — 모든 모드(assist·auto·manual·hard_stop 위장)
 *  2. 승인 불가 감사 행 1(`skipped` + indicators.gate, price·price_at_skip) + 가상 체결 1(signal_id = 감사 행 id)
 *  3. 검증된 전략은 기존 경로(현금 게이트 → 승인 대기) 그대로 — 관문이 과차단하지 않는다
 *  4. 🔴 매도는 strategies 조회 0 으로 기존대로 생성된다(귀속 없음·미등록 exit-engine-v1·조회가 던지는 경우)
 *  5. 🔴 엔진 경로(claimEntryCooldown) — 진입 쿨다운 원자 선점한 쪽만 기록: 연속·동시 호출 → 감사 행 1 · 가상 체결 1. 비엔진 경로는 호출마다 기록
 *  6. 🔴 기록 실패(쿨다운 DB 오류·감사 행 실패·paper_fills 없음·사이징 실패)는 던지지 않고 차단 유지
 *  7. 🔴 실 장부 테이블에 쓰지 않는다
 */
jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/exchanges/kis', () => ({ kis: { createOrder: jest.fn() }, getBalancesDetailed: jest.fn() }));
jest.mock('@/lib/exchanges/fx', () => ({ getUsdKrwRate: jest.fn(async () => 1400) }));
jest.mock('@/lib/safety/dry-run', () => ({ submitOrder: jest.fn(async () => ({ ok: true, orderId: 5000, dryRun: true })) }));
jest.mock('@/lib/safety/order-limits', () => ({
  ...jest.requireActual('@/lib/safety/order-limits'),
  checkSymbolBlacklist: jest.fn(async () => ({ ok: true })),
}));
jest.mock('@/lib/strategy/style', () => ({ ...jest.requireActual('@/lib/strategy/style'), getStyleConfig: jest.fn() }));
jest.mock('../router', () => ({
  ...jest.requireActual('../router'),
  getRouterConfig: jest.fn(async () => ({ defaultTtlMin: 30, hybridModeEnabled: false })),
  getEngineSwitches: jest.fn(),
}));
jest.mock('@/lib/notify', () => ({
  sendAlert: jest.fn(), dispatchAlertWithTelegram: jest.fn(async () => ({})), getSymbolLabel: jest.fn(async (s: string) => s),
}));
jest.mock('@/lib/notify/throttle', () => ({ sendAlertThrottled: jest.fn() }));
jest.mock('@/lib/notify/telegram-api', () => ({ sendTelegramMessage: jest.fn() }));
jest.mock('@/lib/notify/telegram', () => ({ sendTelegramAlert: jest.fn() }));
jest.mock('@/lib/auth/session', () => ({ getSessionSecret: jest.fn(() => undefined) }));
jest.mock('@/lib/rag/signals-upsert', () => ({ fireAndForgetUpsertSignal: jest.fn() }));

import { getPool } from '@/lib/db';
import { getBalancesDetailed } from '@/lib/exchanges/kis';
import { submitOrder } from '@/lib/safety/dry-run';
import { DEFAULT_STYLE_CONFIG, getStyleConfig } from '@/lib/strategy/style';
import { dispatchAlertWithTelegram, sendAlert } from '@/lib/notify';
import { sendTelegramMessage } from '@/lib/notify/telegram-api';
import { sendTelegramAlert } from '@/lib/notify/telegram';
import { fireAndForgetUpsertSignal } from '@/lib/rag/signals-upsert';
import { getEngineSwitches, type SignalInput } from '../router';
import { createSignal } from '../service';
import { resetSignalCashGateState, overseasLimitUnitUsd } from '../signal-cash-gate';
import { resetEntryCashCache } from '../entry-cash-precheck';
import { isAwaitingApproval } from '../statuses';

const LEDGER = /\b(orders|executions|position_state|portfolio_snapshots|holdings)\b/i;
const WRITE = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i;
const detailed = getBalancesDetailed as jest.Mock;

interface World {
  /** strategies.validation_status — 값 없음 = 행 없음, Error = 조회 예외 */
  strategies: Record<string, string | Error>;
  cooldowns: Map<string, number>;
  cooldownThrows: boolean;
  throwOn: RegExp | null;
  sql: Array<{ sql: string; params: unknown[] }>;
  /** 'S' = strategies 조회, 'B' = 잔고(현금 게이트) — 순서 확인용 */
  events: string[];
  signalInserts: Array<{ sql: string; params: unknown[] }>;
  paper: Map<unknown, unknown[]>;
}
let w: World;

function setupDb() {
  let nextSignal = 9000;
  const query = jest.fn(async (sqlArg: unknown, params: unknown[] = []) => {
    const sql = String(sqlArg);
    w.sql.push({ sql, params });
    if (w.throwOn && w.throwOn.test(sql)) throw Object.assign(new Error('boom'), { code: 'ER_NO_SUCH_TABLE' });
    if (/SELECT validation_status FROM strategies/.test(sql)) {
      w.events.push('S');
      const v = w.strategies[String(params[0])];
      if (v instanceof Error) throw v;
      return [v === undefined ? [] : [{ validation_status: v }]];
    }
    // ── cooldowns: 실제 DB 의미대로(체크·설정이 한 동기 구간이라 원자적) ──
    if (/INSERT IGNORE INTO cooldowns/.test(sql)) {
      if (w.cooldownThrows) throw new Error('cooldown db down');
      const k = params.slice(0, 5).join('|');
      if (w.cooldowns.has(k)) return [{ affectedRows: 0 }];
      w.cooldowns.set(k, Date.now() + Number(params[5]) * 60_000);
      return [{ affectedRows: 1, insertId: 1 }];
    }
    if (/UPDATE cooldowns/.test(sql)) {
      const k = params.slice(2, 7).join('|');
      const until = w.cooldowns.get(k);
      if (until !== undefined && until <= Date.now()) { w.cooldowns.set(k, Date.now() + Number(params[0]) * 60_000); return [{ affectedRows: 1 }]; }
      return [{ affectedRows: 0 }];
    }
    // WP-2b — paper_fills 는 IGNORE 없는 INSERT(중복은 1062 로만). 목도 실제 DB 처럼 중복이면 1062 를 던진다.
    if (/INSERT IGNORE INTO paper_fills/.test(sql)) throw new Error('T-072 WP-2b: paper_fills 는 INSERT IGNORE 를 쓰지 않는다');
    if (/INSERT INTO paper_fills/.test(sql)) {
      if (w.paper.has(params[0])) throw Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY', errno: 1062 });
      w.paper.set(params[0], params);
      return [{ affectedRows: 1, insertId: 700 + w.paper.size }];
    }
    if (/INSERT INTO signals/.test(sql)) { w.signalInserts.push({ sql, params }); return [{ insertId: nextSignal++ }]; }
    if (/FROM system_config WHERE `key` = \?/.test(sql)) {
      if (params[0] === 'notify_skip_unexecutable') return [[{ value: 'false' }]];
      return [[]];
    }
    if (/FROM fx_rates/.test(sql)) return [[{ rate: '1400.0000', age_sec: 30 }]];
    return [[]];
  });
  (getPool as jest.Mock).mockReturnValue({ query });
}

/** 감사 행인가(status 파라미터가 'skipped') — 감사 INSERT 는 status 를 9번째 자리 파라미터로 넘긴다 */
const isAuditInsert = (i: { sql: string; params: unknown[] }) => /'buy', \?, \?, \?, \?, \?, \?, \?, \?, \?, \?\)/.test(i.sql) && i.params[8] === 'skipped';
const audits = () => w.signalInserts.filter(isAuditInsert);
const approvable = () => w.signalInserts.filter((i) => !isAuditInsert(i));
/** createSignal 의 본 INSERT: status 는 10번째(인덱스 9) */
const mainStatus = (i: { params: unknown[] }) => String(i.params[9]);

const domBuy = (over: Partial<SignalInput> = {}): SignalInput => ({
  strategyId: 'rsi-oversold-v1', symbol: '005930', side: 'buy', orderType: 'limit', price: 70_000, amountKRW: 300_000,
  reasoning: 'RSI14(1h) < 38', indicators: { rsi14: 31.2 }, ...over,
});

async function flush() { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); }

const quiet: jest.SpyInstance[] = [];
beforeEach(() => {
  jest.clearAllMocks();
  resetSignalCashGateState();
  resetEntryCashCache();
  w = {
    strategies: { 'rsi-oversold-v1': 'unvalidated', 'ok-bt-v1': 'backtested', 'ok-pv-v1': 'paper_validated', 'weird-v1': 'BACKTESTED',
      'boom-v1': Object.assign(new Error("Unknown column 'validation_status'"), { code: 'ER_BAD_FIELD_ERROR' }) },
    cooldowns: new Map(), cooldownThrows: false, throwOn: null, sql: [], events: [], signalInserts: [], paper: new Map(),
  };
  setupDb();
  (getStyleConfig as jest.Mock).mockResolvedValue({ ...DEFAULT_STYLE_CONFIG, limitChasePct: 0.005 });
  (getEngineSwitches as jest.Mock).mockResolvedValue({ engineEnabled: true, autopilotMode: 'assist', source: 'config' });
  detailed.mockImplementation(async () => {
    w.events.push('B');
    return { balances: [{ currency: 'KRW', free: 100_000_000, used: 0, total: 100_000_000 }], ok: ['domestic', 'overseas'], failed: [], complete: true,
      cash: { USD: { state: 'known', usd: 100_000, source: 'CTRP6504R', ustlSllAmtSmtl: 0 } }, overseasEnabled: true };
  });
  for (const m of ['info', 'warn', 'log', 'error'] as const) quiet.push(jest.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => {
  expect(w.sql.filter((c) => WRITE.test(c.sql) && LEDGER.test(c.sql))).toEqual([]);   // 🔴 실 장부 쓰기 0 (모든 시험)
  while (quiet.length) quiet.pop()!.mockRestore();
});

function expectNoApprovableSideEffects() {
  expect(approvable()).toHaveLength(0);
  expect(fireAndForgetUpsertSignal).not.toHaveBeenCalled();
  expect(sendAlert).not.toHaveBeenCalled();
  expect(dispatchAlertWithTelegram).not.toHaveBeenCalled();
  expect(sendTelegramMessage).not.toHaveBeenCalled();
  expect(sendTelegramAlert).not.toHaveBeenCalled();
  expect(submitOrder).not.toHaveBeenCalled();
  expect(w.sql.some((c) => /SELECT id FROM signals/.test(c.sql))).toBe(false);   // 중복 검사 미도달
  expect(detailed).not.toHaveBeenCalled();                                         // T-058 현금 게이트 미도달(G1 이 앞)
  expect(w.sql.filter((c) => LEDGER.test(c.sql))).toEqual([]);                    // 막힌 경로는 실 장부를 읽지도 않는다
}

describe('1. 🔴 막히는 매수 — 사유 행렬', () => {
  test.each([
    ['전략 없음(undefined)', { strategyId: undefined }, 'validation_gate', 'null_strategy'],
    ['전략 빈 문자열', { strategyId: '' }, 'validation_gate', 'null_strategy'],
    ['미등록(oversold-bounce-v1 — 카드 ID 불일치)', { strategyId: 'oversold-bounce-v1' }, 'validation_gate', 'unregistered'],
    ['unvalidated', {}, 'validation_gate', 'unvalidated'],
    ['상태값 이상', { strategyId: 'weird-v1' }, 'validation_gate', 'invalid_status'],
    ['조회 실패(ER_BAD_FIELD_ERROR — 마이그레이션 전)', { strategyId: 'boom-v1' }, 'validation_lookup_error', 'lookup_error'],
  ] as const)('%s → %s(%s), 승인 가능 시그널·알림·RAG·주문 0, 감사 행 1·가상 체결 1', async (_n, over, code, reason) => {
    const r = await createSignal(domBuy(over as Partial<SignalInput>));
    await flush();
    expect(r).toMatchObject({ ok: false, signalId: 0, autoSubmitted: false, errorCode: code });
    expect(r.error).toMatch(new RegExp(`^${code}: `));
    expect(r.validation).toMatchObject({ reason, recorded: true, claim: 'not_requested' });
    expectNoApprovableSideEffects();
    expect(audits()).toHaveLength(1);
    expect(w.paper.size).toBe(1);
    const auditId = r.validation!.auditSignalId!;
    expect(auditId).toBeGreaterThan(0);
    expect(w.paper.get(auditId)![2]).toBe(reason);             // gate_reason
    expect(r.validation!.paperFillId).toBeGreaterThan(0);
  });
});

describe('1b. 🔴 WP-2c R-1 — 입구 side 변형(대문자·공백)도 매수로 판정한다 (ENUM 이 BUY 를 buy 로 저장)', () => {
  test.each([['BUY'], ['Buy'], ['buy '], [' BUY']])('side=%p → validation_gate, 승인 가능 시그널·알림·주문 0, 감사 행·가상 체결은 매수로', async (side) => {
    const r = await createSignal(domBuy({ side: side as 'buy' }));
    await flush();
    expect(r).toMatchObject({ ok: false, signalId: 0, errorCode: 'validation_gate', validation: { reason: 'unvalidated' } });
    expectNoApprovableSideEffects();
    expect(audits()).toHaveLength(1);                                    // 감사 행 SQL 은 side 리터럴 'buy'
    const p = w.paper.get(r.validation!.auditSignalId)!;
    expect(p[9]).toBeCloseTo(70_000 * 1.005, 6);                         // 매수 쪽 호가 추격(+) — 원 side 로 계산했다면 70,000 × 0.995
    expect(p[13]).toBe(4);
  });

  test.each([['SELL'], [' sell '], ['Sell']])('매도 변형 side=%p → 매도로 보호: strategies 조회 0, 기존대로 생성', async (side) => {
    const r = await createSignal(domBuy({ side: side as 'sell', strategyId: 'boom-v1' }));
    expect(r.ok).toBe(true);
    expect(w.events.filter((e) => e === 'S')).toHaveLength(0);
    expect(audits()).toHaveLength(0);
    expect(w.paper.size).toBe(0);
    expect(approvable()).toHaveLength(1);
  });
});

describe('1c. 🔴 WP-2d — createSignal 맨 앞 방향 정규화: 이후 모든 로직이 정규화된 값을 쓴다', () => {
  // WP-2c 에서는 'purchase'·''·null 이 "매수로 판정 → validation_gate(감사 행·가상 체결)"였다. 이제 알 수 없는 방향은 그보다 앞에서
  // 아무것도 만들지 않고 거절한다(invalid_input) — 더 엄격하다(감사 행·가상 체결·조회조차 없음).
  test.each([['purchase'], [''], ['   '], [null], [undefined], [1]])('알 수 없는 side=%p → invalid_input · 시그널·감사 행·가상 체결·알림·조회·잔고 0', async (side) => {
    const r = await createSignal(domBuy({ side: side as 'buy' }));
    await flush();
    expect(r).toEqual({
      ok: false, signalId: 0, autoSubmitted: false,
      error: 'invalid_input: side 가 buy/sell 이 아님 — 시그널을 만들지 않음', errorCode: 'invalid_input',
    });
    expect(w.signalInserts).toHaveLength(0);
    expect(w.paper.size).toBe(0);
    expect(w.events).toEqual([]);                 // strategies 조회(S)·잔고(B) 0
    expect(sendAlert).not.toHaveBeenCalled();
    expect(submitOrder).not.toHaveBeenCalled();
  });

  test("검증된 전략 + side='BUY' → 정규화된 'buy' 로 현금 게이트(T-058)를 탄다 — S → B 순서, 승인 대기 INSERT 의 side 도 'buy'", async () => {
    const r = await createSignal(domBuy({ side: 'BUY' as 'buy', strategyId: 'ok-bt-v1' }));
    await flush();
    expect(r.ok).toBe(true);
    expect(w.events.join('')).toMatch(/^SB/);    // 원문 'BUY' 면 현금 게이트(`=== 'buy'`)를 건너뛰어 'B' 가 없었다
    expect(approvable()[0].params[2]).toBe('buy');
  });

  test("검증된 전략 + side='buy ' + 자동 제출(auto) → submitOrder 에 정확히 'buy' · 호가 추격은 매수 방향(+0.5%)", async () => {
    (getEngineSwitches as jest.Mock).mockResolvedValue({ engineEnabled: true, autopilotMode: 'auto', source: 'config' });
    process.env.SIGNAL_AUTO_SUBMIT_MAX_KRW = '100000000';
    try {
      const r = await createSignal(domBuy({ side: 'buy ' as 'buy', strategyId: 'ok-bt-v1' }));
      expect(r.autoSubmitted).toBe(true);
      const req = (submitOrder as jest.Mock).mock.calls[0][0];
      expect(req.side).toBe('buy');
      expect(req.price).toBeCloseTo(70_000 * 1.005, 6);   // 원문이면 매도 방향(× 0.995)
      expect(req.quantity).toBe(4);                         // floor(300,000 / 70,350)
      expect(w.events.join('')).toMatch(/^SB/);
    } finally { delete process.env.SIGNAL_AUTO_SUBMIT_MAX_KRW; }
  });

  test("매도 변형 'SELL' → 정확히 'sell' 로 INSERT, 관문 조회 0", async () => {
    const r = await createSignal(domBuy({ side: 'SELL' as 'sell', strategyId: 'exit-engine-v1' }));
    expect(r.ok).toBe(true);
    expect(approvable()[0].params[2]).toBe('sell');
    expect(w.events.filter((e) => e === 'S')).toHaveLength(0);
  });
});

describe('2. 🔴 모든 라우팅 모드에서 막힌다 (G1 은 routeSignal 앞)', () => {
  test.each([
    ['assist', {}],
    ['auto', {}],
    ['manual', {}],
    ['assist + exit_kind=hard_stop 위장 매수(모드 무관 강제 auto)', { indicators: { exit_kind: 'hard_stop' } }],
  ] as const)('%s → 주문 0', async (mode, over) => {
    (getEngineSwitches as jest.Mock).mockResolvedValue({ engineEnabled: true, autopilotMode: mode.split(' ')[0], source: 'config' });
    process.env.SIGNAL_AUTO_SUBMIT_MAX_KRW = '100000000';
    try {
      const r = await createSignal(domBuy(over as Partial<SignalInput>));
      await flush();
      expect(r.errorCode).toBe('validation_gate');
      expectNoApprovableSideEffects();
    } finally { delete process.env.SIGNAL_AUTO_SUBMIT_MAX_KRW; }
  });
});

describe('3. 검증된 전략은 기존 경로 그대로 (과차단 없음)', () => {
  test.each(['ok-bt-v1', 'ok-pv-v1'])('%s → 현금 게이트를 거쳐 awaiting_approval 생성, 감사 행·가상 체결 0', async (sid) => {
    const r = await createSignal(domBuy({ strategyId: sid }));
    await flush();
    expect(r.ok).toBe(true);
    expect(r.errorCode).toBeUndefined();
    expect(r.validation).toBeUndefined();
    expect(audits()).toHaveLength(0);
    expect(w.paper.size).toBe(0);
    expect(approvable()).toHaveLength(1);
    expect(mainStatus(approvable()[0])).toBe('awaiting_approval');
    expect(w.events.join('')).toMatch(/^SB/);          // 검증 관문(S) → 현금 게이트(B) 순서
  });
});

describe('4. 🔴 매도는 관문과 무관 — strategies 조회 0', () => {
  test.each([
    ['전략 없음', undefined],
    ['미등록 exit-engine-v1', 'exit-engine-v1'],
    ['미검증', 'rsi-oversold-v1'],
    ['조회가 던지는 전략', 'boom-v1'],
  ])('%s 매도 → 기존대로 생성', async (_n, sid) => {
    const r = await createSignal(domBuy({ side: 'sell', strategyId: sid }));
    expect(r.ok).toBe(true);
    expect(w.events.filter((e) => e === 'S')).toHaveLength(0);
    expect(audits()).toHaveLength(0);
    expect(w.paper.size).toBe(0);
    expect(approvable()).toHaveLength(1);
  });

  test('hard_stop 매도는 assist 에서도 자동 제출된다(기존 동작)', async () => {
    const r = await createSignal(domBuy({ side: 'sell', strategyId: 'exit-engine-v1', indicators: { exit_kind: 'hard_stop' } }));
    expect(r.autoSubmitted).toBe(true);
    expect(submitOrder).toHaveBeenCalledTimes(1);
    expect(w.events).not.toContain('S');
  });
});

describe('5. 감사 행·가상 체결 내용', () => {
  test('감사 행: skipped · gate · price/price_at_skip = 시그널 가격 · expires_at = 막히지 않았다면 받았을 TTL(30분)', async () => {
    const before = Date.now();
    await createSignal(domBuy());
    const a = audits()[0].params;
    expect(a[8]).toBe('skipped');
    expect(isAwaitingApproval(String(a[8]))).toBe(false);
    expect(a[0]).toBe('rsi-oversold-v1');
    expect(a[3]).toBe(70_000);         // price
    expect(a[10]).toBe(70_000);        // price_at_skip
    expect(a[11]).toBe('domestic');
    const ind = JSON.parse(String(a[7]));
    expect(ind).toMatchObject({ rsi14: 31.2, gate: 'validation_gate', validation_gate: { reason: 'unvalidated', origin: 'unspecified' } });
    const exp = (a[9] as Date).getTime();
    expect(exp).toBeGreaterThanOrEqual(before + 30 * 60_000 - 1000);
    expect(exp).toBeLessThanOrEqual(Date.now() + 30 * 60_000 + 1000);
  });

  test('가상 체결: 실제 주문과 같은 사이징(호가 추격 0.5% → 70,350원, floor(300,000/70,350)=4주), origin 기본 unspecified', async () => {
    const r = await createSignal(domBuy());
    const p = w.paper.get(r.validation!.auditSignalId)!;
    expect(p[3]).toBe('unspecified');         // origin
    expect(p[9]).toBeCloseTo(70_350, 6);      // limit_price_krw
    expect(p[13]).toBe(4);                    // quantity
    expect(p[14]).toBe(300_000);              // amount_krw (재계산 안 함)
    expect(p[17]).toBe('signal_limit_immediate');
  });

  test('🔴 WP-2b (c) — 1주 가격 > 시그널 금액(실주문이었다면 quantity_below_min)이어도 가상 체결을 남기고 quantity 는 NULL 이 아니라 0', async () => {
    // 718,971 / (905,000 × 1.005) = 0.79 → 0주. G1 이 사이징 스킵보다 앞이라 결과는 validation_gate(주문 0)
    const r = await createSignal(domBuy({ price: 905_000, amountKRW: 718_971 }));
    expect(r.errorCode).toBe('validation_gate');
    const p = w.paper.get(r.validation!.auditSignalId)!;
    expect(p[13]).toBe(0);                     // quantity — 0 = 주문 불성립(분석 때 걸러낼 수 있게 정직하게)
    expect(p[13]).not.toBeNull();
    expect(p[9]).toBeCloseTo(905_000 * 1.005, 6);
    expect(p[16]).toBe(0);                     // fee_est_krw — 0주 × 단가
    expect(audits()[0].params[4]).toBeNull();  // 감사 행 quantity 는 시그널 원값(미지정) 그대로
    expect(submitOrder).not.toHaveBeenCalled();
  });

  test('해외: USD 단가 = overseasLimitUnitUsd(추격 원화, fx_rates), origin=engine', async () => {
    (getStyleConfig as jest.Mock).mockResolvedValue({ ...DEFAULT_STYLE_CONFIG, limitChasePct: 0 });
    const r = await createSignal(domBuy({ symbol: 'NAS:MU', price: 280_000, amountKRW: 1_000_000 }), undefined, { origin: 'engine' });
    const p = w.paper.get(r.validation!.auditSignalId)!;
    expect(p[3]).toBe('engine');
    expect(p[7]).toBe('USD');
    expect(p[8]).toBe(overseasLimitUnitUsd(280_000, 1400));
    expect(p[10]).toBe(1400);
    expect(p[13]).toBe(3);
  });
});

describe('6. 🔴 중복 기록 방지 (F-16)', () => {
  test('엔진 경로: 같은 (종목·전략) 연속 2회 → 감사 행 1 · 가상 체결 1, 두 번째는 선점 실패(active)·기록 생략, 둘 다 차단', async () => {
    const a = await createSignal(domBuy(), undefined, { origin: 'engine', claimEntryCooldown: true });
    const b = await createSignal(domBuy(), undefined, { origin: 'engine', claimEntryCooldown: true });
    expect(a.errorCode).toBe('validation_gate');
    expect(b.errorCode).toBe('validation_gate');
    expect(a.validation).toMatchObject({ claim: 'inserted', recorded: true });
    expect(b.validation).toMatchObject({ claim: 'active', recorded: false, auditSignalId: null, paperFillId: null });
    expect(audits()).toHaveLength(1);
    expect(w.paper.size).toBe(1);
    // 선점 키 = 엔진 진입 쿨다운 키(scope=entry, symbol, strategy, side) · TTL 120분 — 다음 틱 스냅샷이 cooldown_entry 로 거른다
    const ins = w.sql.find((c) => /INSERT IGNORE INTO cooldowns/.test(c.sql))!;
    expect(ins.params).toEqual(['entry', '005930', 'rsi-oversold-v1', 'buy', '', 120, 'validation_gate']);
  });

  test('엔진 경로: 동시 3회(blue/green 두 엔진 등) → 감사 행 1 · 가상 체결 1', async () => {
    const rs = await Promise.all([1, 2, 3].map(() => createSignal(domBuy(), undefined, { origin: 'engine', claimEntryCooldown: true })));
    expect(rs.every((r) => r.errorCode === 'validation_gate')).toBe(true);
    expect(rs.filter((r) => r.validation!.recorded)).toHaveLength(1);
    expect(audits()).toHaveLength(1);
    expect(w.paper.size).toBe(1);
  });

  test('쿨다운 만료 후에는 다시 선점(reclaimed)·기록 — 실 경로(생성 → 120분 쿨다운)와 같은 빈도', async () => {
    await createSignal(domBuy(), undefined, { origin: 'engine', claimEntryCooldown: true });
    for (const k of w.cooldowns.keys()) w.cooldowns.set(k, Date.now() - 1);
    const c = await createSignal(domBuy(), undefined, { origin: 'engine', claimEntryCooldown: true });
    expect(c.validation).toMatchObject({ claim: 'reclaimed', recorded: true });
    expect(audits()).toHaveLength(2);
  });

  test('다른 전략·다른 종목은 각자 선점한다', async () => {
    w.strategies['other-v1'] = 'unvalidated';
    await createSignal(domBuy(), undefined, { origin: 'engine', claimEntryCooldown: true });
    await createSignal(domBuy({ strategyId: 'other-v1' }), undefined, { origin: 'engine', claimEntryCooldown: true });
    await createSignal(domBuy({ symbol: '000660' }), undefined, { origin: 'engine', claimEntryCooldown: true });
    expect(audits()).toHaveLength(3);
  });

  test('비엔진 경로(선점 요청 없음): 호출마다 기록, 쿨다운 SQL 0', async () => {
    await createSignal(domBuy());
    await createSignal(domBuy());
    expect(audits()).toHaveLength(2);
    expect(w.paper.size).toBe(2);
    expect(w.sql.some((c) => /cooldowns/.test(c.sql))).toBe(false);
  });
});

describe('7. 🔴 기록 실패는 던지지 않고 차단 유지', () => {
  test('쿨다운 DB 오류 → 기록 생략(과소계상이 안전), 차단', async () => {
    w.cooldownThrows = true;
    const r = await createSignal(domBuy(), undefined, { origin: 'engine', claimEntryCooldown: true });
    expect(r).toMatchObject({ ok: false, errorCode: 'validation_gate', validation: { claim: 'error', recorded: false } });
    expect(audits()).toHaveLength(0);
    expectNoApprovableSideEffects();
  });

  test('paper_fills 없음(마이그레이션 전) → 감사 행은 남고 가상 체결 null, 차단', async () => {
    w.throwOn = /paper_fills/;
    const r = await createSignal(domBuy());
    expect(r.errorCode).toBe('validation_gate');
    expect(r.validation).toMatchObject({ recorded: true, paperFillId: null });
    expect(r.validation!.auditSignalId).toBeGreaterThan(0);
    expectNoApprovableSideEffects();
  });

  test('감사 행 INSERT 실패 → 가상 체결 없음, 차단', async () => {
    w.throwOn = /INSERT INTO signals/;
    const r = await createSignal(domBuy());
    expect(r).toMatchObject({ ok: false, errorCode: 'validation_gate', validation: { auditSignalId: null, paperFillId: null } });
    expect(w.paper.size).toBe(0);
    expect(submitOrder).not.toHaveBeenCalled();
  });

  test('사이징 실패(스타일 조회 예외) → 원 가격·수량 미확정으로 기록, 차단', async () => {
    (getStyleConfig as jest.Mock).mockRejectedValue(new Error('style db down'));
    const r = await createSignal(domBuy());
    expect(r.errorCode).toBe('validation_gate');
    const p = w.paper.get(r.validation!.auditSignalId)!;
    expect(p[9]).toBe(70_000);
    expect(p[13]).toBeNull();
  });
});

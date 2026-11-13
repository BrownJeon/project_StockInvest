/**
 * T-168 D4 — `createSignal` 의 감사 전용 선택지(`validationAuditOnly`) — fail-closed.
 *
 * 장중 엔진은 무제한(적응 배분) 모드에서 미검증으로 분류한 매수 후보를 감사 전용으로 G1 에 보낸다. 분류와 G1 사이에 전략이 검증 상태로
 * 바뀌면(경합) 그 후보가 LLM 배분·적응 현금 재검증 없이 이전 비율 금액으로 현금 게이트 → routeSignal → (auto 면) 자동 제출로 갈 수 있다.
 * 무제한 모드의 `checkOrderMax` 는 상한을 보지 않으므로 DRY_RUN 이 꺼져 있어도 이 길이 닫혀 있어야 한다.
 *
 * 지킬 것:
 *  1. 🔴 감사 전용 + G1 통과 → `{ ok:false, signalId:0, errorCode:'validation_audit_only_passed' }`. 시그널 INSERT·감사 행·가상 체결·
 *     중복 검사·현금 게이트(잔고 조회)·모드 잠금·routeSignal·자동 제출(submitOrder)·알림·RAG·쿨다운 SQL 전부 0 — 모든 라우팅 모드에서.
 *  2. 🔴 G1 불통과 경로는 이 선택지 유무와 무관하게 같다(결과·SQL 순서·감사 행·가상 체결 파라미터 동일) — 사유 행렬·선점 패배까지.
 *  3. 막는 방향으로만 작동한다 — 매도도 생성하지 않고, 블랙리스트 판정 순서는 그대로다.
 *  4. 대조: 같은 검증된 전략도 선택지 없이 부르면 기존대로 생성된다(막는 것은 선택지다).
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
jest.mock('../router', () => {
  const actual = jest.requireActual('../router');
  return {
    ...actual,
    getRouterConfig: jest.fn(async () => ({ defaultTtlMin: 30, hybridModeEnabled: false })),
    getEngineSwitches: jest.fn(),
    // 호출 감시용 — 동작은 실제 함수 그대로
    routeSignal: jest.fn((...a: unknown[]) => (actual.routeSignal as (...x: unknown[]) => unknown)(...a)),
  };
});
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
import { checkSymbolBlacklist } from '@/lib/safety/order-limits';
import { DEFAULT_STYLE_CONFIG, getStyleConfig } from '@/lib/strategy/style';
import { dispatchAlertWithTelegram, sendAlert } from '@/lib/notify';
import { sendAlertThrottled } from '@/lib/notify/throttle';
import { sendTelegramMessage } from '@/lib/notify/telegram-api';
import { sendTelegramAlert } from '@/lib/notify/telegram';
import { fireAndForgetUpsertSignal } from '@/lib/rag/signals-upsert';
import { getEngineSwitches, routeSignal, type SignalInput } from '../router';
import { createSignal, type CreateSignalOptions } from '../service';
import { resetSignalCashGateState } from '../signal-cash-gate';
import { resetEntryCashCache } from '../entry-cash-precheck';

const detailed = getBalancesDetailed as jest.Mock;

interface World {
  strategies: Record<string, string | Error>;
  cooldowns: Map<string, number>;
  sql: Array<{ sql: string; params: unknown[] }>;
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
    if (/SELECT validation_status FROM strategies/.test(sql)) {
      w.events.push('S');
      const v = w.strategies[String(params[0])];
      if (v instanceof Error) throw v;
      return [v === undefined ? [] : [{ validation_status: v }]];
    }
    if (/INSERT IGNORE INTO cooldowns/.test(sql)) {
      const k = params.slice(0, 5).join('|');
      if (w.cooldowns.has(k)) return [{ affectedRows: 0 }];
      w.cooldowns.set(k, Date.now() + Number(params[5]) * 60_000);
      return [{ affectedRows: 1, insertId: 1 }];
    }
    if (/UPDATE cooldowns/.test(sql)) return [{ affectedRows: 0 }];
    if (/INSERT INTO paper_fills/.test(sql)) {
      if (w.paper.has(params[0])) throw Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY', errno: 1062 });
      w.paper.set(params[0], params);
      return [{ affectedRows: 1, insertId: 700 + w.paper.size }];
    }
    if (/INSERT INTO signals/.test(sql)) { w.signalInserts.push({ sql, params }); return [{ insertId: nextSignal++ }]; }
    if (/FROM system_config WHERE `key` = \?/.test(sql)) {
      if (params[0] === 'autopilot_mode' && sql.endsWith('LOCK IN SHARE MODE')) return [[{ value: JSON.stringify('auto') }]];
      if (params[0] === 'notify_skip_unexecutable') return [[{ value: 'false' }]];
      return [[]];
    }
    if (/FROM fx_rates/.test(sql)) return [[{ rate: '1400.0000', age_sec: 30 }]];
    return [[]];
  });
  (getPool as jest.Mock).mockReturnValue({ query, getConnection: async () => ({
    query, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
  }) });
}

const domBuy = (over: Partial<SignalInput> = {}): SignalInput => ({
  strategyId: 'ok-bt-v1', symbol: '005930', side: 'buy', orderType: 'limit', price: 70_000, amountKRW: 996_000,
  reasoning: 'RSI14(1h) < 38', indicators: { rsi14: 31.2 }, ...over,
});
/** 장중 엔진(`createSignalGuarded`)이 감사 후보에 넘기는 맥락 그대로 */
const AUDIT: CreateSignalOptions = { origin: 'engine', claimEntryCooldown: true, validationAuditOnly: true };
const ENGINE: CreateSignalOptions = { origin: 'engine', claimEntryCooldown: true };

async function flush() { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); }

function resetWorld() {
  jest.clearAllMocks();
  resetSignalCashGateState();
  resetEntryCashCache();
  w = {
    strategies: { 'rsi-oversold-v1': 'unvalidated', 'ok-bt-v1': 'backtested', 'ok-pv-v1': 'paper_validated', 'weird-v1': 'BACKTESTED',
      'boom-v1': Object.assign(new Error("Unknown column 'validation_status'"), { code: 'ER_BAD_FIELD_ERROR' }) },
    cooldowns: new Map(), sql: [], events: [], signalInserts: [], paper: new Map(),
  };
  setupDb();
  (getStyleConfig as jest.Mock).mockResolvedValue({ ...DEFAULT_STYLE_CONFIG, limitChasePct: 0.005 });
  (getEngineSwitches as jest.Mock).mockResolvedValue({ engineEnabled: true, autopilotMode: 'auto', source: 'config' });
  detailed.mockImplementation(async () => {
    w.events.push('B');
    return { balances: [{ currency: 'KRW', free: 100_000_000, used: 0, total: 100_000_000 }], ok: ['domestic', 'overseas'], failed: [], complete: true,
      cash: { USD: { state: 'known', usd: 100_000, source: 'CTRP6504R', ustlSllAmtSmtl: 0 } }, overseasEnabled: true };
  });
}

const quiet: jest.SpyInstance[] = [];
beforeAll(() => {
  // 감사 행의 expires_at 등 시각 값까지 바이트 비교하려고 시계만 고정한다(타이머는 실제)
  jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'performance', 'hrtime'] });
  jest.setSystemTime(new Date('2026-11-13T01:00:00Z'));
});
afterAll(() => { jest.useRealTimers(); });
beforeEach(() => {
  resetWorld();
  for (const m of ['info', 'warn', 'log', 'error'] as const) quiet.push(jest.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => { while (quiet.length) quiet.pop()!.mockRestore(); });

const RACED = {
  ok: false, signalId: 0, autoSubmitted: false,
  error: 'validation_audit_only_passed: 감사 전용 호출인데 검증 관문을 통과함 — 시그널·주문을 만들지 않음',
  errorCode: 'validation_audit_only_passed',
};

function expectNothingBeyondG1() {
  expect(w.signalInserts).toHaveLength(0);                                       // 승인 가능 시그널·감사 행 0
  expect(w.paper.size).toBe(0);                                                  // 가상 체결 0
  expect(w.sql.some((c) => /cooldowns/.test(c.sql))).toBe(false);                // 쿨다운 선점·설정 0
  expect(w.sql.some((c) => /SELECT id FROM signals/.test(c.sql))).toBe(false);   // 중복 검사 미도달
  expect(w.sql.some((c) => /LOCK IN SHARE MODE/.test(c.sql))).toBe(false);       // 모드 잠금 트랜잭션 미도달
  expect(detailed).not.toHaveBeenCalled();                                       // T-058 현금 게이트 미도달
  expect(routeSignal).not.toHaveBeenCalled();
  expect(submitOrder).not.toHaveBeenCalled();
  expect(fireAndForgetUpsertSignal).not.toHaveBeenCalled();
  expect(sendAlert).not.toHaveBeenCalled();
  expect(sendAlertThrottled).not.toHaveBeenCalled();
  expect(dispatchAlertWithTelegram).not.toHaveBeenCalled();
  expect(sendTelegramMessage).not.toHaveBeenCalled();
  expect(sendTelegramAlert).not.toHaveBeenCalled();
}

describe('1. 🔴 감사 전용 + G1 통과(경합) → 그 자리에서 끝난다', () => {
  test.each([
    ['auto', {}],
    ['assist', {}],
    ['manual', {}],
    ['auto + exit_kind=hard_stop 위장 매수(모드 무관 강제 auto)', { indicators: { exit_kind: 'hard_stop' } }],
  ] as const)('%s — 시그널·감사 행·가상 체결·현금 게이트·routeSignal·주문·알림·RAG·쿨다운 0', async (mode, over) => {
    (getEngineSwitches as jest.Mock).mockResolvedValue({ engineEnabled: true, autopilotMode: mode.split(' ')[0], source: 'config' });
    process.env.SIGNAL_AUTO_SUBMIT_MAX_KRW = '100000000';
    try {
      const r = await createSignal(domBuy(over as Partial<SignalInput>), undefined, AUDIT);
      await flush();
      expect(r).toEqual(RACED);
      expect(w.events).toEqual(['S']);           // G1 의 strategies 조회 1회뿐
      expectNothingBeyondG1();
    } finally { delete process.env.SIGNAL_AUTO_SUBMIT_MAX_KRW; }
  });

  test.each(['ok-bt-v1', 'ok-pv-v1'])('검증 상태 %s 모두 막는다', async (sid) => {
    const r = await createSignal(domBuy({ strategyId: sid }), undefined, AUDIT);
    await flush();
    expect(r).toEqual(RACED);
    expectNothingBeyondG1();
  });

  test('대조: 같은 검증된 전략도 감사 전용 없이(엔진 기본 맥락) 부르면 기존대로 생성·자동 제출된다', async () => {
    process.env.SIGNAL_AUTO_SUBMIT_MAX_KRW = '100000000';
    try {
      const r = await createSignal(domBuy(), undefined, ENGINE);
      await flush();
      expect(r).toMatchObject({ ok: true, autoSubmitted: true });
      expect(w.events.join('')).toMatch(/^SB/);
      expect(routeSignal).toHaveBeenCalled();
      expect(submitOrder).toHaveBeenCalledTimes(1);
      expect(w.signalInserts).toHaveLength(1);
    } finally { delete process.env.SIGNAL_AUTO_SUBMIT_MAX_KRW; }
  });
});

describe('2. 🔴 G1 불통과 경로는 선택지 유무와 무관하게 같다', () => {
  type Snap = { result: unknown; sql: World['sql']; signalInserts: World['signalInserts']; paper: Array<[unknown, unknown[]]>; events: string[] };
  async function runSeq(inputs: SignalInput[], opts: CreateSignalOptions): Promise<Snap> {
    resetWorld();
    const results: unknown[] = [];
    for (const input of inputs) results.push(await createSignal(input, undefined, opts));
    await flush();
    return { result: results, sql: w.sql, signalInserts: w.signalInserts, paper: [...w.paper.entries()], events: w.events };
  }

  test.each([
    ['unvalidated', [domBuy({ strategyId: 'rsi-oversold-v1' })]],
    ['unregistered', [domBuy({ strategyId: 'oversold-bounce-v1' })]],
    ['null_strategy', [domBuy({ strategyId: undefined })]],
    ['invalid_status', [domBuy({ strategyId: 'weird-v1' })]],
    ['lookup_error', [domBuy({ strategyId: 'boom-v1' })]],
    ['선점 패배(같은 후보 연속 2회 — 두 번째는 기록 생략)', [domBuy({ strategyId: 'rsi-oversold-v1' }), domBuy({ strategyId: 'rsi-oversold-v1' })]],
    ['해외 미검증', [domBuy({ strategyId: 'rsi-oversold-v1', symbol: 'NAS:MU', price: 280_000, amountKRW: 1_416_000 })]],
    ['금액 0(이전 비율 없음)', [domBuy({ strategyId: 'rsi-oversold-v1', amountKRW: 0 })]],
  ] as const)('%s — 결과·SQL 순서·감사 행·가상 체결 파라미터가 바이트 동일', async (_n, inputs) => {
    const base = await runSeq([...inputs], ENGINE);
    const audit = await runSeq([...inputs], AUDIT);
    expect((base.result as Array<{ errorCode: string }>)[0].errorCode).toMatch(/^validation_(gate|lookup_error)$/);
    expect(JSON.stringify(audit)).toBe(JSON.stringify(base));
    // 기록이 실제로 일어났다 — 빈 비교가 아니다
    expect(base.signalInserts.length + base.paper.length).toBeGreaterThan(0);
    expect(submitOrder).not.toHaveBeenCalled();
  });
});

describe('3. 막는 방향으로만 작동한다', () => {
  test('감사 전용 매도도 생성하지 않는다(엔진은 매수 후보에만 켠다) — 관문 조회 0, INSERT 0', async () => {
    const r = await createSignal(domBuy({ side: 'sell', strategyId: 'exit-engine-v1' }), undefined, AUDIT);
    await flush();
    expect(r).toEqual(RACED);
    expect(w.events).toEqual([]);              // 매도는 관문 함수 첫 줄에서 I/O 없이 허용 판정
    expectNothingBeyondG1();
  });

  test('블랙리스트가 먼저다 — 판정 순서는 그대로(symbol_blacklisted)', async () => {
    (checkSymbolBlacklist as jest.Mock).mockResolvedValueOnce({ ok: false, detail: '005930 is blacklisted' });
    const r = await createSignal(domBuy(), undefined, AUDIT);
    expect(r).toMatchObject({ ok: false, errorCode: 'symbol_blacklisted' });
    expect(w.events).toEqual([]);
    expectNothingBeyondG1();
  });
});

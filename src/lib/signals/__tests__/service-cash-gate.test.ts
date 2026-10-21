/**
 * T-058 — `createSignal` × 실시간 현금 게이트 통합.
 *
 * 지킬 것:
 *  (1) 현금 부족 매수 → signals INSERT 0회 · RAG 색인 0회 · 알림(실제 기본 배선 발송 함수) 0회 · 주문 0회 ·
 *      반환 `{ ok:false, signalId:0, autoSubmitted:false, errorCode:'insufficient_cash' }` — 승인 대기·자동 제출 경로 모두
 *  (2) 🔴 모르면 기존대로 만든다 (조회 실패·USD unknown·환율 오래됨·시장가·1주 미만)
 *  (3) 매도는 게이트를 타지 않는다 (잔고 조회 0회)
 *  (4) 스위치: 키 없음·true = 켜짐 / false·"false"·0·null·"true"·파싱 불가·읽기 오류 = 꺼짐(기존대로 생성)
 *  (5) 캐시·동시 호출 공유 — 잔고 조회 1회
 *  (6) 막는 기준은 실제 주문과 같은 사이징(호가 추격 반영)이다
 */
jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/exchanges/kis', () => ({ kis: { createOrder: jest.fn() }, getBalancesDetailed: jest.fn() }));
jest.mock('@/lib/exchanges/fx', () => ({ getUsdKrwRate: jest.fn(async () => 1400) }));
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
import { getEngineSwitches } from '../router';
import { dispatchAlertWithTelegram, sendAlert } from '@/lib/notify';
import { sendTelegramMessage } from '@/lib/notify/telegram-api';
import { sendTelegramAlert } from '@/lib/notify/telegram';
import { fireAndForgetUpsertSignal } from '@/lib/rag/signals-upsert';
import { createSignal } from '../service';
import { SIGNAL_CASH_GATE_KEYS, resetSignalCashGateState } from '../signal-cash-gate';
import { resetEntryCashCache } from '../entry-cash-precheck';
import type { SignalInput } from '../router';

const detailed = getBalancesDetailed as jest.Mock;

interface World {
  /** system_config 게이트 키 → 저장값. undefined = 키 없음 */
  gate: Partial<Record<'domestic' | 'overseas', string>>;
  gateThrows: boolean;
  /** 승인 요청 알림이 실행 불가 판정 없이 바로 나가게(false) — 이 시험은 알림 발송 유무만 본다 */
  skipUnexecutable: string;
  chaseDisabled: boolean;
  fxRow: { rate: string; age_sec: number } | null;
  signalInserts: unknown[][];
  tradeLogs: unknown[][];
}
let w: World;

function setupDb() {
  const query = jest.fn(async (sqlArg: unknown, params: unknown[] = []) => {
    const sql = String(sqlArg);
    if (/FROM system_config WHERE `key` IN \(\?, \?\)/.test(sql)) {
      if (w.gateThrows) throw new Error('db down');
      const rows: Array<{ key: string; value: string }> = [];
      for (const m of ['domestic', 'overseas'] as const) {
        const v = w.gate[m];
        if (v !== undefined) rows.push({ key: SIGNAL_CASH_GATE_KEYS[m], value: v });
      }
      return [rows];
    }
    if (/FROM system_config WHERE `key` = \?/.test(sql)) {
      if (params[0] === 'notify_skip_unexecutable') return [[{ value: w.skipUnexecutable }]];
      if (params[0] === 'safety_limit_chase_disabled' && w.chaseDisabled) return [[{ value: 'true' }]];
      return [[]];
    }
    if (/FROM system_config/.test(sql)) return [[]];
    if (/FROM fx_rates/.test(sql)) return [w.fxRow ? [w.fxRow] : []];
    if (/SELECT id FROM signals/.test(sql)) return [[]];
    if (/INSERT INTO signals/.test(sql)) { w.signalInserts.push(params); return [{ insertId: 9000 + w.signalInserts.length }]; }
    if (/INSERT INTO trade_logs/.test(sql)) { w.tradeLogs.push(params); return [{}]; }
    if (/SELECT amount_krw FROM signals/.test(sql)) return [[]];
    if (/UPDATE signals/.test(sql)) return [{ affectedRows: 1 }];
    return [[]];
  });
  (getPool as jest.Mock).mockReturnValue({ query });
  return query;
}

const balances = (krw: number, usd: unknown = { state: 'known', usd: 1_000, source: 'CTRP6504R', ustlSllAmtSmtl: 0 }, ok = ['domestic', 'overseas']) => ({
  balances: [{ currency: 'KRW', free: krw, used: 0, total: krw }], ok, failed: [], complete: true, cash: { USD: usd }, overseasEnabled: true,
});

/** 국내 005930 지정가 매수 — 5주 × 70,000 × 1.002 = 350,700원 필요(호가 추격 0) */
const domBuy = (over: Partial<SignalInput> = {}): SignalInput => ({
  strategyId: 'rsi-oversold-v1', symbol: '005930', side: 'buy', orderType: 'limit', price: 70_000, amountKRW: 350_000, reasoning: 'r', ...over,
});
/** 해외 NAS:AAPL — 원화 280,000(=$200) × 3주 × 1.002 = $601.20 필요 */
const ovsBuy = (over: Partial<SignalInput> = {}): SignalInput => ({
  strategyId: 'rsi-oversold-v1', symbol: 'NAS:AAPL', side: 'buy', orderType: 'limit', price: 280_000, amountKRW: 1_000_000, reasoning: 'r', ...over,
});

async function flush() { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); }

let info: jest.SpyInstance;
const quiet: jest.SpyInstance[] = [];
beforeEach(() => {
  jest.clearAllMocks();
  resetSignalCashGateState();
  resetEntryCashCache();
  w = { gate: {}, gateThrows: false, skipUnexecutable: 'false', chaseDisabled: false, fxRow: { rate: '1400.0000', age_sec: 30 }, signalInserts: [], tradeLogs: [] };
  setupDb();
  (getStyleConfig as jest.Mock).mockResolvedValue({ ...DEFAULT_STYLE_CONFIG, limitChasePct: 0 });
  (getEngineSwitches as jest.Mock).mockResolvedValue({ engineEnabled: true, autopilotMode: 'assist', source: 'config' });
  detailed.mockResolvedValue(balances(1_000_000));
  info = jest.spyOn(console, 'info').mockImplementation(() => {});
  quiet.push(jest.spyOn(console, 'warn').mockImplementation(() => {}), jest.spyOn(console, 'log').mockImplementation(() => {}));
});
afterEach(() => { info.mockRestore(); while (quiet.length) quiet.pop()!.mockRestore(); });

function expectNothingSent() {
  expect(sendAlert).not.toHaveBeenCalled();
  expect(dispatchAlertWithTelegram).not.toHaveBeenCalled();
  expect(sendTelegramMessage).not.toHaveBeenCalled();
  expect(sendTelegramAlert).not.toHaveBeenCalled();
}

describe('1. 🔴 현금 부족 매수 — 행·RAG·알림·주문 없음', () => {
  test('국내 1원 부족 → insufficient_cash, INSERT 0 · RAG 0 · 알림 0', async () => {
    detailed.mockResolvedValue(balances(350_699));
    const r = await createSignal(domBuy());
    await flush();
    expect(r).toEqual({ ok: false, signalId: 0, autoSubmitted: false, errorCode: 'insufficient_cash', error: expect.stringMatching(/^insufficient_cash/) });
    expect(w.signalInserts).toHaveLength(0);
    expect(fireAndForgetUpsertSignal).not.toHaveBeenCalled();
    expectNothingSent();
    expect(submitOrder).not.toHaveBeenCalled();
  });

  test('🔴 [양성 대조] 같은 조건에서 현금이 정확히 필요 금액이면 생성되고 승인 요청이 실제 발송 함수로 나간다', async () => {
    detailed.mockResolvedValue(balances(350_700));
    const r = await createSignal(domBuy());
    await flush();
    expect(r.ok).toBe(true);
    expect(r.signalId).toBeGreaterThan(0);
    expect(w.signalInserts).toHaveLength(1);
    expect(fireAndForgetUpsertSignal).toHaveBeenCalledTimes(1);
    expect(sendAlert).toHaveBeenCalledTimes(1);                         // 기본 배선 sendPlain → sendAlert
    expect((sendAlert as jest.Mock).mock.calls[0][1]).toContain('승인 요청');
  });

  test('해외 1센트 부족($601.19) → insufficient_cash · 행 없음 / $601.20 → 생성', async () => {
    detailed.mockResolvedValue(balances(1e9, { state: 'known', usd: 601.19 }));
    expect((await createSignal(ovsBuy())).errorCode).toBe('insufficient_cash');
    expect(w.signalInserts).toHaveLength(0);
    resetEntryCashCache();
    detailed.mockResolvedValue(balances(0, { state: 'known', usd: 601.2 }));
    expect((await createSignal(ovsBuy())).ok).toBe(true);
    expect(w.signalInserts).toHaveLength(1);
  });

  test('🔴 자동 제출 경로(auto)도 같은 지점에서 막는다 — 주문 0회', async () => {
    (getEngineSwitches as jest.Mock).mockResolvedValue({ engineEnabled: true, autopilotMode: 'auto', source: 'config' });
    process.env.SIGNAL_AUTO_SUBMIT_MAX_KRW = '10000000';
    try {
      detailed.mockResolvedValue(balances(100));
      const r = await createSignal(domBuy());
      await flush();
      expect(r.errorCode).toBe('insufficient_cash');
      expect(submitOrder).not.toHaveBeenCalled();
      expect(w.signalInserts).toHaveLength(0);
      expectNothingSent();
    } finally { delete process.env.SIGNAL_AUTO_SUBMIT_MAX_KRW; }
  });

  test('🔴 manual(detected) 경로도 막는다', async () => {
    (getEngineSwitches as jest.Mock).mockResolvedValue({ engineEnabled: true, autopilotMode: 'manual', source: 'config' });
    detailed.mockResolvedValue(balances(100));
    expect((await createSignal(domBuy())).errorCode).toBe('insufficient_cash');
    expect(w.signalInserts).toHaveLength(0);
  });

  test('🔴 막는 기준은 실제 주문과 같은 사이징 — 호가 추격(0.5%)이 붙으면 필요 금액이 커진다', async () => {
    (getStyleConfig as jest.Mock).mockResolvedValue({ ...DEFAULT_STYLE_CONFIG, limitChasePct: 0.005 });
    // 추격 가격 70,350 → 수량 floor(350,000/70,350)=4 → 4 × 70,350 × 1.002 = 281,962.8 → 281,963원
    detailed.mockResolvedValue(balances(281_962));
    expect((await createSignal(domBuy())).errorCode).toBe('insufficient_cash');
    resetEntryCashCache();
    detailed.mockResolvedValue(balances(281_963));
    expect((await createSignal(domBuy())).ok).toBe(true);
  });

  test('🔴 건너뜀은 매번, 로그·trade_logs 는 1시간 1회', async () => {
    detailed.mockResolvedValue(balances(0));
    const outs = [];
    for (let i = 0; i < 4; i++) outs.push(await createSignal(domBuy()));
    await flush();
    expect(outs.every((o) => o.errorCode === 'insufficient_cash')).toBe(true);
    expect(w.signalInserts).toHaveLength(0);
    const skipLogs = info.mock.calls.filter((c) => String(c[0]).startsWith('[signal-cash-gate] 현금 부족 매수'));
    expect(skipLogs).toHaveLength(1);
    expect(w.tradeLogs.filter((p) => p[1] === 'signal_cash_gate_skip')).toHaveLength(1);
  });

  test('🔴 관측(trade_logs) 이 실패해도 insufficient_cash 반환은 유지된다', async () => {
    const q = setupDb();
    q.mockImplementation(async (sqlArg: unknown, params: unknown[] = []) => {
      if (/INSERT INTO trade_logs/.test(String(sqlArg))) throw new Error('db down');
      if (/FROM fx_rates/.test(String(sqlArg))) return [[w.fxRow]];
      if (/INSERT INTO signals/.test(String(sqlArg))) { w.signalInserts.push(params); return [{ insertId: 1 }]; }
      return [[]];
    });
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    detailed.mockResolvedValue(balances(0));
    expect((await createSignal(domBuy())).errorCode).toBe('insufficient_cash');
    await flush();
    expect(w.signalInserts).toHaveLength(0);
    err.mockRestore();
  });
});

describe('2. 🔴 모르면 기존대로 만든다', () => {
  const cases: Array<[string, () => void, () => SignalInput]> = [
    ['잔고 조회가 던짐', () => detailed.mockRejectedValue(new Error('EGW00201')), () => domBuy()],
    ['국내 잔고 실패(해외만 성공)', () => detailed.mockResolvedValue(balances(0, undefined, ['overseas'])), () => domBuy()],
    ['USD unknown', () => detailed.mockResolvedValue(balances(1e9, { state: 'unknown', error: 'x' })), () => ovsBuy()],
    ['USD not_queried(해외 비활성)', () => detailed.mockResolvedValue(balances(1e9, { state: 'not_queried' })), () => ovsBuy()],
    ['환율 오래됨', () => { detailed.mockResolvedValue(balances(0, { state: 'known', usd: 0 })); w.fxRow = { rate: '1400', age_sec: 7_200 }; }, () => ovsBuy()],
    ['환율 행 없음(폴백 1380)', () => { detailed.mockResolvedValue(balances(0, { state: 'known', usd: 0 })); w.fxRow = null; }, () => ovsBuy()],
    ['시장가', () => detailed.mockResolvedValue(balances(0)), () => domBuy({ orderType: 'market' })],
    ['1주 미만(수량 0)', () => detailed.mockResolvedValue(balances(0)), () => domBuy({ price: 400_000 })],
  ];
  test.each(cases)('%s → 생성', async (_l, arrange, input) => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    arrange();
    const r = await createSignal(input());
    expect(r.ok).toBe(true);
    expect(r.errorCode).toBeUndefined();
    expect(w.signalInserts).toHaveLength(1);
  });
});

describe('3. 매도·스위치·공유', () => {
  test('🔴 매도는 게이트를 타지 않는다 — 잔고 조회 0회, 현금 0 이어도 생성', async () => {
    detailed.mockResolvedValue(balances(0));
    const r = await createSignal(domBuy({ side: 'sell' }));
    expect(r.ok).toBe(true);
    expect(detailed).not.toHaveBeenCalled();
    expect(w.signalInserts).toHaveLength(1);
  });

  test.each([
    ['키 없음', undefined, 'blocked'],
    ['true', 'true', 'blocked'],
    ['false', 'false', 'created'],
    ['"false"(문자열)', '"false"', 'created'],
    ['"true"(문자열)', '"true"', 'created'],
    ['0', '0', 'created'],
    ['null', 'null', 'created'],
    ['파싱 불가', 'yes', 'created'],
  ] as const)('국내 스위치 %s → %s', async (_l, value, expected) => {
    w.gate.domestic = value;
    detailed.mockResolvedValue(balances(0));
    const r = await createSignal(domBuy());
    expect(r.ok ? 'created' : r.errorCode === 'insufficient_cash' ? 'blocked' : 'other').toBe(expected);
    if (expected === 'created') expect(detailed).not.toHaveBeenCalled();     // 꺼지면 잔고도 읽지 않는다
  });

  test('🔴 스위치 읽기 오류 → 꺼짐(기존대로 생성)', async () => {
    w.gateThrows = true;
    detailed.mockResolvedValue(balances(0));
    expect((await createSignal(domBuy())).ok).toBe(true);
    expect(detailed).not.toHaveBeenCalled();
  });

  test('해외 스위치만 끄면 해외는 생성, 국내는 막힘', async () => {
    w.gate.overseas = 'false';
    detailed.mockResolvedValue(balances(0, { state: 'known', usd: 0 }));
    expect((await createSignal(ovsBuy())).ok).toBe(true);
    expect((await createSignal(domBuy())).errorCode).toBe('insufficient_cash');
  });

  test('🔴 동시 호출·연속 호출은 잔고 조회 1회를 공유한다 (30초 캐시)', async () => {
    let release: (v: unknown) => void = () => {};
    detailed.mockReturnValue(new Promise((r) => { release = r; }));
    const ps = [createSignal(domBuy()), createSignal(domBuy({ symbol: '000660' })), createSignal(ovsBuy())];
    await flush();
    release(balances(0, { state: 'known', usd: 0 }));
    const rs = await Promise.all(ps);
    expect(rs.map((r) => r.errorCode)).toEqual(['insufficient_cash', 'insufficient_cash', 'insufficient_cash']);
    await createSignal(domBuy({ symbol: '035420' }));
    expect(detailed).toHaveBeenCalledTimes(1);
  });
});

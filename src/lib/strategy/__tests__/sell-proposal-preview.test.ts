/**
 * T-055 1단계 — 매도 제안 시뮬레이션(미리보기) 계약.
 *
 *  1. 관측 → eval_funnel `sell_proposal_preview` pass/skip 만. 시그널·주문 경로 import 0건(소스 고정).
 *  2. 요약은 **시장 거래일당 1회** — 틱 반복·프로세스 재시작(로컬 상태 초기화)·동시 프로세스에 멱등.
 *  3. 알림 실패는 격리 — finish() 는 절대 reject 하지 않고, 전 채널 실패면 표식을 되돌려 제한 횟수만 재시도.
 *  4. 스위치·정책이 꺼져 있으면 아무것도 하지 않는다.
 */
import * as fs from 'fs';
import * as path from 'path';

// ─── system_config 를 흉내내는 모의 DB — INSERT IGNORE / 조건부 UPDATE 의미를 그대로 구현 ──────────
const configRows = new Map<string, string>();
const poolQuery = jest.fn(async (sql: string, params: unknown[] = []) => {
  const s = String(sql);
  if (/^INSERT IGNORE INTO system_config/i.test(s)) {
    const [key, value] = params as [string, string];
    if (configRows.has(key)) return [{ affectedRows: 0 }];
    configRows.set(key, value);
    return [{ affectedRows: 1 }];
  }
  if (/^UPDATE system_config SET value = \? WHERE `key` = \? AND value <> \?/i.test(s)) {
    const [value, key, notEq] = params as [string, string, string];
    const cur = configRows.get(key);
    if (cur === undefined || cur === notEq) return [{ affectedRows: 0 }];
    configRows.set(key, value);
    return [{ affectedRows: 1 }];
  }
  if (/^UPDATE system_config SET value = \? WHERE `key` = \? AND value = \?/i.test(s)) {
    const [value, key, eq] = params as [string, string, string];
    if (configRows.get(key) !== eq) return [{ affectedRows: 0 }];
    configRows.set(key, value);
    return [{ affectedRows: 1 }];
  }
  // 조건 없는 갱신(변이 시험용 — 실제 코드는 쓰지 않는다)도 실제 DB 처럼 덮어쓴다
  if (/^UPDATE system_config SET value = \? WHERE `key` = \?\s*$/i.test(s)) {
    const [value, key] = params as [string, string];
    if (!configRows.has(key)) return [{ affectedRows: 0 }];
    configRows.set(key, value);
    return [{ affectedRows: 1 }];
  }
  throw new Error(`unexpected SQL in test: ${s}`);
});
jest.mock('@/lib/db', () => ({ getPool: () => ({ query: (...a: unknown[]) => poolQuery(a[0] as string, a[1] as unknown[]) }) }));

const dispatchAlert = jest.fn();
const getSymbolLabel = jest.fn(async (s: string) => s);
jest.mock('@/lib/notify', () => ({
  dispatchAlert: (...a: unknown[]) => dispatchAlert(...a),
  getSymbolLabel: (s: string) => getSymbolLabel(s),
}));

import {
  openSellProposalPreview,
  resetSellProposalPreviewState,
  claimDailyReport,
  releaseDailyReport,
  reportMarkerKey,
  sessionDateFor,
  buildSellProposalPreviewReport,
  MAX_INCOMPLETE_DEFERRALS,
  MAX_SEND_RETRIES,
  POLICY_READ_TIMEOUT_MS,
  type PreviewObservation,
  type SellProposalPreviewDeps,
} from '../sell-proposal-preview';
import type { SellProposalPreviewSwitch } from '../sell-proposal-policy';
import type { PositionState } from '../position-state';
import type { Market } from '@/lib/exchanges/kis-symbols';

const POLICY = { stopPct: 6, restepPct: 5, reboundExitPct: 1 };
const ON: SellProposalPreviewSwitch = { enabled: true, policy: POLICY, source: 'config', problems: [] };
const DELIVERED = { channel: 'telegram', delivered: ['telegram'], failed: [], unconfigured: [] };
const FAILED = { channel: 'telegram', delivered: [], failed: [{ channel: 'telegram', error: 'HTTP 502' }], unconfigured: [] };
/** 2026-10-19(월) 10:00 KST */
const MON_10_KST = new Date('2026-10-19T01:00:00Z');

function st(symbol: string, entryPrice: number, qty: number, market: Market = 'domestic'): PositionState {
  return {
    symbol, market, entryPrice, peakPrice: entryPrice, qty,
    scenarioExit: null, holdingDeadline: null, firstSeenAt: new Date(), updatedAt: new Date(),
  };
}
function obs(symbol: string, entry: number, price: number, qty: number, over: Partial<PreviewObservation> = {}): PreviewObservation {
  return {
    symbol,
    ticker: { symbol, price, timestamp: 0 },
    state: st(symbol, entry, qty),
    kis: { qty, avgPrice: entry },
    ...over,
  };
}
/** 10-19 실측 포지션 (국내 2종목) */
const DOMESTIC = [
  obs('000660', 2_641_000, 1_294_000, 1),
  obs('005930', 331_500, 220_000, 9),
];

function recorder() {
  const rows: Array<{ verdict: string; gate: string; ev: Record<string, unknown> }> = [];
  return {
    rows,
    pass: (gate: string, ev: Record<string, unknown> = {}) => { rows.push({ verdict: 'pass', gate, ev }); },
    skip: (gate: string, ev: Record<string, unknown> = {}) => { rows.push({ verdict: 'skip', gate, ev }); },
  };
}

function deps(over: Partial<SellProposalPreviewDeps> = {}): Partial<SellProposalPreviewDeps> {
  return { readPolicy: async () => ON, now: () => MON_10_KST, ...over };
}

/** 한 틱을 흉내: 열기 → 관측 → 요약 */
async function tick(observations: PreviewObservation[], heldCount = observations.length, d = deps()) {
  const run = await openSellProposalPreview('domestic', heldCount, d);
  if (!run) return { run, outcome: null, rec: recorder() };
  const rec = recorder();
  for (const o of observations) run.observe(o, rec as never);
  const outcome = await run.finish();
  return { run, outcome, rec };
}

beforeEach(() => {
  configRows.clear();
  poolQuery.mockClear();
  dispatchAlert.mockReset().mockResolvedValue(DELIVERED);
  getSymbolLabel.mockClear();
  resetSellProposalPreviewState();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

// ════════════════════════════════════════════════════════════════════════════
describe('스위치·정책 — 꺼져 있으면 아무것도 하지 않는다', () => {
  test.each([
    [{ enabled: false, policy: null, source: 'config', problems: [] }],
    [{ enabled: false, policy: null, source: 'absent', problems: [] }],
    [{ enabled: false, policy: null, source: 'db_error', problems: [] }],
    [{ enabled: true, policy: null, source: 'config', problems: [] }],   // 모순 값도 꺼짐
    [{ enabled: false, policy: POLICY, source: 'config', problems: [] }], // 정책이 있어도 스위치가 꺼졌으면 꺼짐
    [{ enabled: 'true', policy: POLICY, source: 'config', problems: [] }], // enabled 는 불리언 true 만
  ])('%j → null', async (sw) => {
    const run = await openSellProposalPreview('domestic', 2, deps({ readPolicy: async () => sw as SellProposalPreviewSwitch }));
    expect(run).toBeNull();
    expect(poolQuery).not.toHaveBeenCalled();
    expect(dispatchAlert).not.toHaveBeenCalled();
  });

  test('정책 판독이 던져도 null (예외 전파 없음)', async () => {
    const run = await openSellProposalPreview('domestic', 2, deps({ readPolicy: async () => { throw new Error('boom'); } }));
    expect(run).toBeNull();
  });

  test('정책 판독이 동기로 던져도 null', async () => {
    const run = await openSellProposalPreview('domestic', 2, deps({ readPolicy: (() => { throw new Error('sync boom'); }) as never }));
    expect(run).toBeNull();
  });
});

describe('🔴 정책 판독 타임아웃 — 시간 초과면 미리보기만 비활성, 늦은 결과는 버린다', () => {
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  test('기본 상한은 2초 (2~3초 범위)', () => {
    expect(POLICY_READ_TIMEOUT_MS).toBeGreaterThanOrEqual(2000);
    expect(POLICY_READ_TIMEOUT_MS).toBeLessThanOrEqual(3000);
  });

  test('판독이 끝나지 않으면 상한 시각에 null 로 돌아온다', async () => {
    const t0 = Date.now();
    const run = await openSellProposalPreview('domestic', 2, deps({
      readPolicy: () => new Promise(() => { /* never */ }), policyTimeoutMs: 30,
    }));
    expect(run).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(String((console.warn as jest.Mock).mock.calls.flat().join(' '))).toContain('30ms 초과');
  });

  test('🔴 늦게 도착한 켜짐 결과는 쓰지 않는다 — 열기는 null, 이후 관측·요약·DB 쓰기 없음', async () => {
    const readPolicy = jest.fn(async () => { await sleep(80); return ON; });
    const run = await openSellProposalPreview('domestic', 2, deps({ readPolicy, policyTimeoutMs: 20 }));
    expect(run).toBeNull();
    await sleep(150);                                    // 늦은 결과가 도착한 뒤
    expect(readPolicy).toHaveBeenCalledTimes(1);
    expect(poolQuery).not.toHaveBeenCalled();
    expect(dispatchAlert).not.toHaveBeenCalled();
  });

  test('시간 초과 뒤 늦게 reject 돼도 unhandled rejection 이 없다', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const run = await openSellProposalPreview('domestic', 2, deps({
        readPolicy: async () => { await sleep(40); throw new Error('late failure'); }, policyTimeoutMs: 10,
      }));
      expect(run).toBeNull();
      await sleep(100);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  test('상한 안에 오면 정상으로 열린다', async () => {
    const run = await openSellProposalPreview('domestic', 2, deps({
      readPolicy: async () => { await sleep(5); return ON; }, policyTimeoutMs: 1000,
    }));
    expect(run).not.toBeNull();
    expect(run!.policy).toEqual(POLICY);
  });

  test('타이머는 정리된다 — 정상 판독 뒤 남은 타이머 0', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      const run = await openSellProposalPreview('domestic', 2, deps());   // readPolicy 즉시 resolve
      expect(run).not.toBeNull();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  test('타이머는 정리된다 — 판독 예외 뒤에도 남은 타이머 0', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      const run = await openSellProposalPreview('domestic', 2, deps({ readPolicy: async () => { throw new Error('x'); } }));
      expect(run).toBeNull();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('관측 → eval_funnel 기록 (pass = 제안 대상, skip = 아님)', () => {
  test('−51%·−33.6% 는 pass, −3% 는 skip(above_threshold)', async () => {
    const { rec } = await tick([...DOMESTIC, obs('035420', 200_000, 194_000, 2)]);
    expect(rec.rows.map(r => [r.ev.symbol, r.verdict, r.ev.reason])).toEqual([
      ['000660', 'pass', 'stop'],
      ['005930', 'pass', 'stop'],
      ['035420', 'skip', 'above_threshold'],
    ]);
    for (const r of rec.rows) {
      expect(r.gate).toBe('sell_proposal_preview');
      expect(r.ev.side).toBe('sell');
      expect(r.ev.strategyId).toBe('sell-proposal-v1');
      expect(r.ev.detail).toMatchObject({ simulation: true, kind: 'stop_loss', thresholdPct: -6 });
    }
    expect((rec.rows[0].ev.detail as { pnlPct: number }).pnlPct).toBeCloseTo(-51.0, 1);
  });

  test('detail 에 KIS 잔고 원본(수량·매입평균)을 함께 남긴다', async () => {
    const { rec } = await tick([DOMESTIC[1]]);
    expect(rec.rows[0].ev.detail).toMatchObject({ kisQty: 9, kisAvgPrice: 331_500, qty: 9, entry: 331_500 });
  });

  test('관측 하나가 예외를 내도 던지지 않고 preview_error 로 남긴 뒤 다음 종목을 계속 본다', async () => {
    const bad = { symbol: 'BAD', get ticker(): never { throw new Error('getter boom'); } } as unknown as PreviewObservation;
    const run = await openSellProposalPreview('domestic', 2, deps());
    const rec = recorder();
    expect(() => run!.observe(bad, rec as never)).not.toThrow();
    run!.observe(DOMESTIC[0], rec as never);
    expect(rec.rows.map(r => [r.ev.symbol, r.verdict, r.ev.reason])).toEqual([
      ['BAD', 'skip', 'preview_error'],
      ['000660', 'pass', 'stop'],
    ]);
  });

  test('기록기 자체가 던져도 observe 는 던지지 않는다', async () => {
    const run = await openSellProposalPreview('domestic', 1, deps());
    const rec = { pass: () => { throw new Error('rec down'); }, skip: () => { throw new Error('rec down'); } };
    expect(() => run!.observe(DOMESTIC[0], rec as never)).not.toThrow();
  });
});

describe('🔴 하루 1회 — 지속 표식으로 멱등', () => {
  test('같은 거래일 첫 틱만 보내고 이후 틱은 보내지 않는다', async () => {
    expect((await tick(DOMESTIC)).outcome).toBe('sent');
    expect((await tick(DOMESTIC)).outcome).toBe('already_sent');
    expect((await tick(DOMESTIC)).outcome).toBe('already_sent');
    expect(dispatchAlert).toHaveBeenCalledTimes(1);
    expect(configRows.get(reportMarkerKey('domestic'))).toBe(JSON.stringify('2026-10-19'));
  });

  test('🔴 프로세스 재시작(로컬 상태 초기화) 뒤에도 같은 날 다시 보내지 않는다 — DB 표식이 권위', async () => {
    expect((await tick(DOMESTIC)).outcome).toBe('sent');
    resetSellProposalPreviewState();                 // pm2 restart 흉내
    expect((await tick(DOMESTIC)).outcome).toBe('claim_lost');
    resetSellProposalPreviewState();
    expect((await tick(DOMESTIC)).outcome).toBe('claim_lost');
    expect(dispatchAlert).toHaveBeenCalledTimes(1);
  });

  test('동시 두 프로세스(서로 다른 로컬 상태)가 같은 틱에 와도 한쪽만 보낸다', async () => {
    const a = await openSellProposalPreview('domestic', 2, deps());
    const b = await openSellProposalPreview('domestic', 2, deps());
    for (const o of DOMESTIC) { a!.observe(o, recorder() as never); b!.observe(o, recorder() as never); }
    const outA = await a!.finish();
    resetSellProposalPreviewState();                 // b 는 다른 프로세스 — a 의 로컬 상태를 모른다
    const outB = await b!.finish();
    expect([outA, outB].sort()).toEqual(['claim_lost', 'sent']);
    expect(dispatchAlert).toHaveBeenCalledTimes(1);
  });

  test('다음 거래일에는 다시 보낸다', async () => {
    expect((await tick(DOMESTIC)).outcome).toBe('sent');
    const tue = new Date('2026-10-20T01:00:00Z');
    expect((await tick(DOMESTIC, 2, deps({ now: () => tue }))).outcome).toBe('sent');
    expect(dispatchAlert).toHaveBeenCalledTimes(2);
    expect(configRows.get(reportMarkerKey('domestic'))).toBe(JSON.stringify('2026-10-20'));
  });

  test('시장별 표식은 독립 — 국내를 보냈어도 해외는 따로 1회', async () => {
    await tick(DOMESTIC);
    const run = await openSellProposalPreview('overseas', 1, deps({ now: () => new Date('2026-10-19T15:00:00Z') }));
    run!.observe(obs('NAS:MU', 1_422_003, 1_197_425, 11), recorder() as never);
    expect(await run!.finish()).toBe('sent');
    expect(dispatchAlert).toHaveBeenCalledTimes(2);
    expect(configRows.has(reportMarkerKey('overseas'))).toBe(true);
  });

  test('해외 거래일은 ET 기준 — KST 자정을 넘는 같은 세션에서 두 번 보내지 않는다', async () => {
    // ET 10-19 세션: KST 10-19 22:30 ~ 10-20 05:00
    const before = new Date('2026-10-19T14:00:00Z');   // KST 10-19 23:00
    const after  = new Date('2026-10-19T17:00:00Z');   // KST 10-20 02:00
    expect(sessionDateFor('overseas', before)).toBe('2026-10-19');
    expect(sessionDateFor('overseas', after)).toBe('2026-10-19');
    expect(sessionDateFor('domestic', after)).toBe('2026-10-20');
    const o = [obs('NAS:MU', 1_422_003, 1_197_425, 11)];
    for (const at of [before, after]) {
      const run = await openSellProposalPreview('overseas', 1, deps({ now: () => at }));
      for (const x of o) run!.observe(x, recorder() as never);
      await run!.finish();
    }
    expect(dispatchAlert).toHaveBeenCalledTimes(1);
  });

  test('표식 SQL — INSERT IGNORE 로 행을 보장하고 조건부 UPDATE 로 선점한다', async () => {
    expect(await claimDailyReport('domestic', '2026-10-19')).toBe(true);
    expect(await claimDailyReport('domestic', '2026-10-19')).toBe(false);
    expect(await claimDailyReport('domestic', '2026-10-20')).toBe(true);
    const sqls = poolQuery.mock.calls.map(c => String(c[0]));
    expect(sqls.filter(s => /INSERT IGNORE INTO system_config/.test(s)).length).toBe(3);
    // 운영자가 정한 설정을 덮어쓸 수 있는 형태(ON DUPLICATE KEY UPDATE·REPLACE)를 쓰지 않는다
    expect(sqls.some(s => /ON DUPLICATE KEY|REPLACE INTO/i.test(s))).toBe(false);
    // 표식 키 외에는 건드리지 않는다
    for (const c of poolQuery.mock.calls) {
      expect((c[1] as unknown[]).includes(reportMarkerKey('domestic'))).toBe(true);
    }
  });

  test('되돌리기는 아직 그 날짜 값일 때만 — 다음 날 표식을 지우지 않는다', async () => {
    await claimDailyReport('domestic', '2026-10-20');
    await releaseDailyReport('domestic', '2026-10-19');
    expect(configRows.get(reportMarkerKey('domestic'))).toBe(JSON.stringify('2026-10-20'));
    await releaseDailyReport('domestic', '2026-10-20');
    expect(configRows.get(reportMarkerKey('domestic'))).toBe(JSON.stringify(''));
  });
});

describe('🔴 알림 실패 격리', () => {
  test('dispatch 가 reject 해도 finish 는 resolve 한다 — 던지지 않고, 실패 결과와 같은 경로(표식 되돌림)로 간다', async () => {
    // (라운드 2 — Codex C2 high) 예전 기대값 'error' 는 "reject 면 표식이 남아 그날 영구 누락"인 동작을
    // 고정하던 것이라 의도적으로 바꿨다. "던지지 않는다"는 원래 계약은 그대로 검사한다.
    dispatchAlert.mockRejectedValue(new Error('network down'));
    const { outcome } = await tick(DOMESTIC);
    expect(outcome).toBe('send_failed_released');
    expect(configRows.get(reportMarkerKey('domestic'))).toBe(JSON.stringify(''));
  });

  test('요약 처리 중 예상 밖 예외(시계·본문 조립)가 나도 finish 는 resolve(error) — 던지지 않는다', async () => {
    let calls = 0;
    const now = () => { calls++; if (calls > 0) throw new Error('clock broken'); return MON_10_KST; };
    const run = await openSellProposalPreview('domestic', 1, deps({ now }));
    run!.observe(DOMESTIC[0], recorder() as never);
    await expect(run!.finish()).resolves.toBe('error');
    expect(dispatchAlert).not.toHaveBeenCalled();
  });

  test('🔴 reject 뒤 다음 틱에 다시 보낸다 — 그날 요약이 영구 누락되지 않는다', async () => {
    dispatchAlert.mockRejectedValueOnce(new Error('ETIMEDOUT')).mockResolvedValue(DELIVERED);
    expect((await tick(DOMESTIC)).outcome).toBe('send_failed_released');
    expect((await tick(DOMESTIC)).outcome).toBe('sent');
    expect((await tick(DOMESTIC)).outcome).toBe('already_sent');
    expect(dispatchAlert).toHaveBeenCalledTimes(2);
    expect(configRows.get(reportMarkerKey('domestic'))).toBe(JSON.stringify('2026-10-19'));
  });

  test('reject 가 계속되면 재시도 상한 뒤 포기 — 매 틱 반복하지 않는다', async () => {
    dispatchAlert.mockRejectedValue(new Error('network down'));
    const outcomes: string[] = [];
    for (let i = 0; i < MAX_SEND_RETRIES + 3; i++) outcomes.push(String((await tick(DOMESTIC)).outcome));
    expect(outcomes).toEqual([
      ...Array(MAX_SEND_RETRIES).fill('send_failed_released'),
      'send_failed_kept', 'already_sent', 'already_sent',
    ]);
    expect(dispatchAlert).toHaveBeenCalledTimes(MAX_SEND_RETRIES + 1);
    expect(configRows.get(reportMarkerKey('domestic'))).toBe(JSON.stringify('2026-10-19'));
  });

  test('reject 와 실패 결과는 같은 재시도 상한을 함께 쓴다', async () => {
    dispatchAlert
      .mockRejectedValueOnce(new Error('reject'))
      .mockResolvedValueOnce(FAILED)
      .mockRejectedValueOnce(new Error('reject'))
      .mockResolvedValue(FAILED);
    const outcomes: string[] = [];
    for (let i = 0; i < MAX_SEND_RETRIES + 2; i++) outcomes.push(String((await tick(DOMESTIC)).outcome));
    expect(outcomes).toEqual([...Array(MAX_SEND_RETRIES).fill('send_failed_released'), 'send_failed_kept', 'already_sent']);
  });

  test('🔴 되돌리기는 조건부 — 전송 중 다른 프로세스가 다음 거래일로 선점한 표식은 덮지 않는다', async () => {
    const key = reportMarkerKey('domestic');
    dispatchAlert.mockImplementation(async () => {
      configRows.set(key, JSON.stringify('2026-10-20'));    // 다른 프로세스가 그 사이 다음 거래일을 선점·전송
      throw new Error('network down');
    });
    expect((await tick(DOMESTIC)).outcome).toBe('send_failed_released');
    expect(configRows.get(key)).toBe(JSON.stringify('2026-10-20'));
    const releaseCalls = poolQuery.mock.calls.filter(c => /AND value = \?/.test(String(c[0])));
    expect(releaseCalls).toHaveLength(1);
    expect(releaseCalls[0][1]).toEqual([JSON.stringify(''), key, JSON.stringify('2026-10-19')]);
  });

  test('종목명 조회가 던져도 표식·전송 흐름은 영향 없다 (라벨만 코드로 폴백, 되돌림 없음)', async () => {
    getSymbolLabel.mockRejectedValue(new Error('stock_meta down'));
    expect((await tick(DOMESTIC)).outcome).toBe('sent');
    expect(configRows.get(reportMarkerKey('domestic'))).toBe(JSON.stringify('2026-10-19'));
    expect(poolQuery.mock.calls.some(c => /AND value = \?/.test(String(c[0])))).toBe(false);
  });

  test('선점 쿼리가 실패하면 보내지 않고(중복 방지) 다음 틱에 다시 시도한다', async () => {
    poolQuery.mockImplementationOnce(async () => { throw new Error('db blip'); });
    expect((await tick(DOMESTIC)).outcome).toBe('claim_error');
    expect(dispatchAlert).not.toHaveBeenCalled();
    expect((await tick(DOMESTIC)).outcome).toBe('sent');
    expect(dispatchAlert).toHaveBeenCalledTimes(1);
  });

  test('모든 채널 실패 → 표식을 되돌려 재시도, 최대 횟수 뒤에는 포기(매 틱 반복 금지)', async () => {
    dispatchAlert.mockResolvedValue(FAILED);
    const outcomes: string[] = [];
    for (let i = 0; i < MAX_SEND_RETRIES + 3; i++) outcomes.push(String((await tick(DOMESTIC)).outcome));
    expect(outcomes.slice(0, MAX_SEND_RETRIES)).toEqual(Array(MAX_SEND_RETRIES).fill('send_failed_released'));
    expect(outcomes[MAX_SEND_RETRIES]).toBe('send_failed_kept');
    expect(outcomes.slice(MAX_SEND_RETRIES + 1)).toEqual(['already_sent', 'already_sent']);
    expect(dispatchAlert).toHaveBeenCalledTimes(MAX_SEND_RETRIES + 1);
  });

  test('재시도 중 전송이 회복되면 그때 1회 보내고 끝', async () => {
    dispatchAlert.mockResolvedValueOnce(FAILED).mockResolvedValue(DELIVERED);
    expect((await tick(DOMESTIC)).outcome).toBe('send_failed_released');
    expect((await tick(DOMESTIC)).outcome).toBe('sent');
    expect((await tick(DOMESTIC)).outcome).toBe('already_sent');
    expect(dispatchAlert).toHaveBeenCalledTimes(2);
  });

  test('알림 채널 none(전송 시도 없음)은 실패가 아니다 — 재시도하지 않는다', async () => {
    dispatchAlert.mockResolvedValue({ channel: 'none', delivered: [], failed: [], unconfigured: [] });
    expect((await tick(DOMESTIC)).outcome).toBe('no_channel');
    expect((await tick(DOMESTIC)).outcome).toBe('already_sent');
    expect(dispatchAlert).toHaveBeenCalledTimes(1);
  });

  test('종목명 조회가 실패해도 코드로 대신하고 보낸다', async () => {
    getSymbolLabel.mockRejectedValue(new Error('stock_meta down'));
    expect((await tick(DOMESTIC)).outcome).toBe('sent');
    expect(String(dispatchAlert.mock.calls[0][2])).toContain('000660');
  });
});

describe('평가 못 한 종목이 있으면 몇 틱 미룬다 (불완전 요약 방지)', () => {
  test(`보유 3 · 관측 2 → ${MAX_INCOMPLETE_DEFERRALS}틱 미룬 뒤에는 있는 대로 보낸다`, async () => {
    const outcomes: string[] = [];
    for (let i = 0; i < MAX_INCOMPLETE_DEFERRALS + 1; i++) outcomes.push(String((await tick(DOMESTIC, 3)).outcome));
    expect(outcomes).toEqual([...Array(MAX_INCOMPLETE_DEFERRALS).fill('deferred_incomplete'), 'sent']);
    expect(String(dispatchAlert.mock.calls[0][2])).toContain('확인 실패 1종목');
  });

  test('미루는 중에 완전한 틱이 오면 바로 보낸다', async () => {
    expect((await tick(DOMESTIC, 3)).outcome).toBe('deferred_incomplete');
    expect((await tick([...DOMESTIC, obs('035420', 200_000, 194_000, 2)], 3)).outcome).toBe('sent');
  });
});

describe('요약 본문', () => {
  async function sentBody(observations = DOMESTIC) {
    await tick(observations);
    const [level, title, body] = dispatchAlert.mock.calls[0] as [string, string, string];
    return { level, title, body };
  }

  test('제목 "매도 제안 시뮬레이션: 오늘 N건", 마지막 줄 "시뮬레이션 — 시그널·주문 없음"', async () => {
    const { level, title, body } = await sentBody([...DOMESTIC, obs('035420', 200_000, 194_000, 2)]);
    expect(level).toBe('info');
    expect(title).toBe('매도 제안 시뮬레이션: 오늘 2건 (국내)');
    expect(body.trim().split('\n').pop()).toBe('시뮬레이션 — 시그널·주문 없음');
    expect(body).toContain('▶ 제안 대상 2건');
    expect(body).toContain('▶ 대상 아님 1건');
    expect(body).toContain('035420 -3.00% — 임계값 미도달');
  });

  test('큰 손실 순으로 나열하고 사유(손익·임계값)를 적는다', async () => {
    const { body } = await sentBody();
    const i1 = body.indexOf('1. 000660');
    const i2 = body.indexOf('2. 005930');
    expect(i1).toBeGreaterThan(0);
    expect(i2).toBeGreaterThan(i1);
    expect(body).toContain('-51.00%');
    expect(body).toContain('사유: [손절 제안] 손익 -51.00% ≤ -6%');
    expect(body).toContain('9주');
  });

  test('KIS 잔고 원본과 position_state 를 나란히 적고 일치 여부를 표시한다', async () => {
    const mismatch = obs('005930', 331_500, 220_000, 9, { kis: { qty: 10, avgPrice: 331_500 } });
    const { body } = await sentBody([DOMESTIC[0], mismatch]);
    expect(body).toContain('KIS 잔고 원본 대조');
    expect(body).toContain('추가 KIS 호출 없음');
    expect(body).toMatch(/000660 KIS 수량 1 · 매입평균 ₩2,641,000 \| position_state 수량 1 · 진입 ₩2,641,000 → 일치/);
    expect(body).toMatch(/005930 KIS 수량 10 .* → ⚠ 불일치/);
  });

  test('대상 0건이어도 보낸다 (시뮬레이션이 돌고 있음을 알린다)', async () => {
    const { title, body } = await sentBody([obs('035420', 200_000, 194_000, 2)]);
    expect(title).toContain('오늘 0건');
    expect(body).toContain('▶ 제안 대상 0건\n없음');
  });

  test('🔴 동적 문자열은 이스케이프된다 — 종목명·코드의 <, & 가 HTML 로 해석되지 않는다', () => {
    const { body } = buildSellProposalPreviewReport({
      market: 'domestic', sessionDate: '2026-10-19', policy: POLICY, heldCount: 1,
      items: [{
        symbol: '<b>X&Y', price: 90, stateEntry: 100, stateQty: 1, kisQty: 1, kisAvgPrice: 100,
        evaluation: { verdict: 'skip', reason: 'above_threshold', pnlPct: -1, thresholdPct: -6 },
      }],
      labels: new Map([['<b>X&Y', 'S&amp;T모티브']]),
    });
    expect(body).not.toContain('<b>');
    expect(body).toContain('&lt;b&gt;X&amp;Y');
    expect(body).toContain('S&amp;T모티브');
  });

  test('해외 요약은 원화 환산가와 환산 주의 문구를 적는다 (USD 원가는 1단계 범위 밖)', async () => {
    const run = await openSellProposalPreview('overseas', 1, deps({ now: () => new Date('2026-10-19T15:00:00Z') }));
    run!.observe(obs('NAS:MU', 1_422_003, 1_197_425, 11, {
      ticker: { symbol: 'NAS:MU', price: 1_197_425, priceUsd: 851.2, timestamp: 0 },
    }), recorder() as never);
    await run!.finish();
    const [, title, body] = dispatchAlert.mock.calls[0] as [string, string, string];
    expect(title).toBe('매도 제안 시뮬레이션: 오늘 1건 (해외)');
    expect(body).toContain('현재 ₩1,197,425');
    expect(body).not.toContain('$851');
    expect(body).toContain('USD 평단 원값은 잔고 어댑터가 보존하지 않는다');
  });
});

describe('🔴 소스 수준 — 시그널·주문·승인·KIS 경로를 import·호출하지 않는다', () => {
  const FILES = ['sell-proposal.ts', 'sell-proposal-policy.ts', 'sell-proposal-preview.ts'];
  /** 주석을 지운 코드만 본다 (설명 주석에 createSignal 같은 단어가 나올 수 있다) */
  function code(file: string): string {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:])\/\/.*$/gm, '$1');
  }
  /**
   * 모듈 지정자를 전부 모은다 — 정적 `import … from`·`import type … from`·`export … from`,
   * 부수효과 `import '…'`, 동적 `import('…')`, `require('…')`, `jest.requireActual('…')` 류까지.
   * (라운드 2 — Reviewer R-1: 예전에는 `from '…'` 만 훑어 동적 import 한 줄이 그대로 통과했다.)
   */
  function imports(file: string): string[] {
    return specifiersIn(code(file));
  }
  function specifiersIn(c: string): string[] {
    const pats = [
      /\bfrom\s*['"`]([^'"`]+)['"`]/g,
      /\bimport\s*['"`]([^'"`]+)['"`]/g,
      /\bimport\s*\(\s*['"`]([^'"`]+)['"`]/g,
      /\brequire[A-Za-z]*\s*\(\s*['"`]([^'"`]+)['"`]/g,
    ];
    return pats.flatMap(p => [...c.matchAll(p)].map(m => m[1]));
  }

  test('지정자 수집기가 모든 형태를 잡는다 (자기 검증)', () => {
    const probe = [
      "import { a } from '@/lib/x1';",
      "import type { B } from '@/lib/x2';",
      "export { c } from '@/lib/x3';",
      "import '@/lib/x4';",
      "void import('@/lib/x5');",
      "const r = require('@/lib/x6');",
      "const s = await import(\n  '@/lib/x7'\n);",
    ].join('\n');
    expect(specifiersIn(probe).sort()).toEqual(
      ['@/lib/x1', '@/lib/x2', '@/lib/x3', '@/lib/x4', '@/lib/x5', '@/lib/x6', '@/lib/x7'],
    );
  });

  for (const file of FILES) {
    test(`${file}: 금지 모듈 import 없음`, () => {
      const mods = imports(file);
      for (const m of mods) {
        expect(m).not.toMatch(/signals\/(service|router|approval|telegram)/);
        expect(m).not.toMatch(/safety\/(dry-run|order-limits|kill-switch)/);
        expect(m).not.toMatch(/exchanges\/(kis|kis-domestic|kis-overseas|kis-http)$/);
        expect(m).not.toMatch(/strategy\/(engine|cooldowns|position-state)$|^\.\/(engine|cooldowns)$/);
      }
    });

    test(`${file}: 금지 호출 식별자 없음`, () => {
      const c = code(file);
      for (const id of ['createSignal', 'createSignalGuarded', 'submitOrder', 'createOrder', 'approveSignal',
        'approveSignalForUser', 'claimAwaitingSignal', 'getTicker', 'getBalancesDetailed', 'upsertPositionState',
        'setCooldown', 'exit_kind', 'routeSignal', 'readExitKind', 'resolveApprovalPath']) {
        expect(c).not.toContain(id);
      }
    });
  }

  test('position-state 는 타입으로만 참조한다 (런타임 import 아님)', () => {
    for (const file of FILES) {
      const c = code(file);
      const runtime = [...c.matchAll(/import\s+(?!type\b)[^;]*from\s+['"]\.\/position-state['"]/g)];
      expect(runtime).toHaveLength(0);
    }
  });
});

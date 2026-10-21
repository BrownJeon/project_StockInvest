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
  jest.spyOn(console, 'log').mockImplementation(() => {});
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

  test('알림 채널 none(전달 0·실패 0)은 재시도 상한까지만 되돌려 다시 시도하고 그 뒤 멈춘다 (T-060)', async () => {
    // (T-060) 예전 기대값은 "1회 no_channel 뒤 already_sent" — 표식이 남아 그날 요약이 조용히 영구 누락되는
    // 동작을 고정하던 것이라 의도적으로 바꿨다. 의도된 none 이어도 매 틱 반복하지 않는 것은 그대로 검사한다.
    dispatchAlert.mockResolvedValue({ channel: 'none', delivered: [], failed: [], unconfigured: [] });
    const outcomes: string[] = [];
    for (let i = 0; i < MAX_SEND_RETRIES + 3; i++) outcomes.push(String((await tick(DOMESTIC)).outcome));
    expect(outcomes).toEqual([
      ...Array(MAX_SEND_RETRIES).fill('no_channel_released'),
      'no_channel', 'already_sent', 'already_sent',
    ]);
    expect(dispatchAlert).toHaveBeenCalledTimes(MAX_SEND_RETRIES + 1);
  });

  test('종목명 조회가 실패해도 코드로 대신하고 보낸다', async () => {
    getSymbolLabel.mockRejectedValue(new Error('stock_meta down'));
    expect((await tick(DOMESTIC)).outcome).toBe('sent');
    expect(String(dispatchAlert.mock.calls[0][2])).toContain('000660');
  });
});

describe('🔴 T-060 — 전송 결과 로그 1줄 · 전달 0·실패 0 은 표식을 되돌려 재시도', () => {
  const NONE = { channel: 'none', delivered: [], failed: [], unconfigured: [] };
  const UNCONF = { channel: 'telegram', delivered: [], failed: [], unconfigured: ['telegram'] };
  const MARKER = () => configRows.get(reportMarkerKey('domestic'));
  const logCalls = () => (console.log as jest.Mock).mock.calls.map(c => String(c[0]));
  const warnCalls = () => (console.warn as jest.Mock).mock.calls.map(c => String(c[0]));
  const errorCalls = () => (console.error as jest.Mock).mock.calls.map(c => String(c[0]));
  const isResult = (s: string) => s.includes('요약 결과');
  /** 결과 줄 — log 다음 warn 순으로 모은다(호출 시각 순서가 아님. 순서가 필요한 검사는 warn/log 를 따로 본다) */
  const resultLines = () => [...logCalls(), ...warnCalls()].filter(isResult);

  test('① delivered≥1 → sent · 표식 유지 · console.log 결과 1줄 (경고 결과 줄 없음)', async () => {
    expect((await tick(DOMESTIC)).outcome).toBe('sent');
    expect(MARKER()).toBe(JSON.stringify('2026-10-19'));
    expect(logCalls().filter(isResult)).toEqual([
      '[sell-proposal-preview:domestic] 요약 결과 sent (거래일 2026-10-19, channel=telegram, '
      + 'delivered=[telegram], failed=[], unconfigured=[])',
    ]);
    expect(warnCalls().filter(isResult)).toEqual([]);
    // 전송을 시도하지 않는 틱(already_sent)은 결과 줄을 남기지 않는다
    expect((await tick(DOMESTIC)).outcome).toBe('already_sent');
    expect(resultLines()).toHaveLength(1);
  });

  test('① 부분 실패(한 채널 전달·한 채널 실패)는 sent 이지만 결과 줄은 경고로 남는다', async () => {
    dispatchAlert.mockResolvedValue({
      channel: 'both', delivered: ['telegram'], failed: [{ channel: 'slack', error: 'HTTP 500' }], unconfigured: [],
    });
    expect((await tick(DOMESTIC)).outcome).toBe('sent');
    expect(MARKER()).toBe(JSON.stringify('2026-10-19'));
    expect(logCalls().filter(isResult)).toEqual([]);
    expect(warnCalls().filter(isResult)).toEqual([
      '[sell-proposal-preview:domestic] 요약 결과 sent (거래일 2026-10-19, channel=both, '
      + 'delivered=[telegram], failed=[slack], unconfigured=[])',
    ]);
  });

  test('② failed 만 → 기존 send_failed_released 동작 불변(표식 되돌림·기존 경고) + 결과 경고 1줄', async () => {
    dispatchAlert.mockResolvedValue(FAILED);
    expect((await tick(DOMESTIC)).outcome).toBe('send_failed_released');
    expect(MARKER()).toBe(JSON.stringify(''));
    expect(warnCalls().some(s => s.includes(`요약 전송 실패(1/${MAX_SEND_RETRIES}) — 표식을 되돌리고 다음 틱 재시도: telegram: HTTP 502`))).toBe(true);
    expect(resultLines()).toEqual([
      '[sell-proposal-preview:domestic] 요약 결과 send_failed_released (거래일 2026-10-19, channel=telegram, '
      + 'delivered=[], failed=[telegram], unconfigured=[])',
    ]);
    expect(logCalls().filter(isResult)).toEqual([]);
  });

  test('③ 전달 0·실패 0 (자격 증명 미설정) → 경고 + 표식 되돌림 + 다음 틱에 재시도해 보낸다', async () => {
    dispatchAlert.mockResolvedValueOnce(UNCONF).mockResolvedValue(DELIVERED);
    expect((await tick(DOMESTIC)).outcome).toBe('no_channel_released');
    expect(MARKER()).toBe(JSON.stringify(''));
    expect(warnCalls().filter(isResult)).toEqual([
      '[sell-proposal-preview:domestic] 요약 결과 no_channel_released (거래일 2026-10-19, channel=telegram, '
      + `delivered=[], failed=[], unconfigured=[telegram]) — 전달된 채널 0·실패 0 — 표식을 되돌리고 다음 틱 재시도(1/${MAX_SEND_RETRIES})`,
    ]);
    // 되돌리기는 기존과 같은 조건부 UPDATE (그 거래일 값일 때만)
    const releaseCalls = poolQuery.mock.calls.filter(c => /AND value = \?/.test(String(c[0])));
    expect(releaseCalls).toHaveLength(1);
    expect(releaseCalls[0][1]).toEqual([JSON.stringify(''), reportMarkerKey('domestic'), JSON.stringify('2026-10-19')]);

    expect((await tick(DOMESTIC)).outcome).toBe('sent');
    expect((await tick(DOMESTIC)).outcome).toBe('already_sent');
    expect(dispatchAlert).toHaveBeenCalledTimes(2);
    expect(MARKER()).toBe(JSON.stringify('2026-10-19'));
  });

  test('③ 되돌리기 중 다른 프로세스가 다음 거래일로 선점한 표식은 덮지 않는다 (no_channel 경로도 조건부)', async () => {
    const key = reportMarkerKey('domestic');
    dispatchAlert.mockImplementation(async () => {
      configRows.set(key, JSON.stringify('2026-10-20'));
      return NONE;
    });
    expect((await tick(DOMESTIC)).outcome).toBe('no_channel_released');
    expect(configRows.get(key)).toBe(JSON.stringify('2026-10-20'));
  });

  test('③ 되돌리기 자체가 실패해도 finish 는 resolve 하고, 결과 줄 메모는 "되돌리기 실패 — 누락 가능"이다 (Reviewer medium-1)', async () => {
    dispatchAlert.mockResolvedValue(NONE);
    const release = jest.fn(async () => { throw new Error('db down'); });
    const { outcome } = await tick(DOMESTIC, 2, deps({ release }));
    expect(outcome).toBe('no_channel_released');
    expect(release).toHaveBeenCalledTimes(1);
    expect(warnCalls().filter(isResult)).toEqual([
      '[sell-proposal-preview:domestic] 요약 결과 no_channel_released (거래일 2026-10-19, channel=none, '
      + `delivered=[], failed=[], unconfigured=[]) — 전달된 채널 0·실패 0(1/${MAX_SEND_RETRIES}) — 표식 되돌리기 실패 — 오늘 요약 누락 가능`,
    ]);
    // "되돌리고 다음 틱 재시도"라고 거짓으로 적지 않는다 (조용한 누락을 숨기지 않게)
    expect(resultLines().some(s => s.includes('표식을 되돌리고'))).toBe(false);
    expect(logCalls().filter(isResult)).toEqual([]);
    // 표식은 선점된 채 남는다 — 다음 틱은 claim_lost (예전과 같은 결과, 이제 그 이유가 앞 줄에 남는다)
    expect(MARKER()).toBe(JSON.stringify('2026-10-19'));
    expect((await tick(DOMESTIC, 2, deps({ release }))).outcome).toBe('claim_lost');
  });

  test('② 실패 경로에서도 되돌리기가 던지면 결과 줄 메모만 바뀐다 — outcome·재시도 소비는 불변', async () => {
    dispatchAlert.mockResolvedValue(FAILED);
    const release = jest.fn(async () => { throw new Error('db down'); });
    expect((await tick(DOMESTIC, 2, deps({ release }))).outcome).toBe('send_failed_released');
    expect(warnCalls().filter(isResult)).toEqual([
      '[sell-proposal-preview:domestic] 요약 결과 send_failed_released (거래일 2026-10-19, channel=telegram, '
      + 'delivered=[], failed=[telegram], unconfigured=[]) — 표식 되돌리기 실패 — 오늘 요약 누락 가능',
    ]);
    // 기존 실패 경고 줄은 그대로
    expect(warnCalls().some(s => s.includes(`요약 전송 실패(1/${MAX_SEND_RETRIES}) — 표식을 되돌리고 다음 틱 재시도: telegram: HTTP 502`))).toBe(true);
  });

  test('④ 전달 0·실패 0 이 계속되면 상한 도달 시 포기 — 표식 유지·포기 경고·이후 매 틱 반복 없음', async () => {
    dispatchAlert.mockResolvedValue(UNCONF);
    const outcomes: string[] = [];
    for (let i = 0; i < MAX_SEND_RETRIES + 2; i++) outcomes.push(String((await tick(DOMESTIC)).outcome));
    expect(outcomes).toEqual([...Array(MAX_SEND_RETRIES).fill('no_channel_released'), 'no_channel', 'already_sent']);
    expect(dispatchAlert).toHaveBeenCalledTimes(MAX_SEND_RETRIES + 1);
    expect(MARKER()).toBe(JSON.stringify('2026-10-19'));
    const lines = resultLines();
    expect(lines).toHaveLength(MAX_SEND_RETRIES + 1);              // 시도마다 정확히 1줄
    expect(lines[MAX_SEND_RETRIES]).toBe(
      '[sell-proposal-preview:domestic] 요약 결과 no_channel (거래일 2026-10-19, channel=telegram, '
      + 'delivered=[], failed=[], unconfigured=[telegram]) — 전달된 채널 0·실패 0 — 재시도 상한 도달, 오늘은 포기',
    );
    expect(logCalls().filter(isResult)).toEqual([]);
  });

  test('④ 전송 실패·예외·전달 0 은 하나의 재시도 상한을 함께 쓴다', async () => {
    dispatchAlert
      .mockResolvedValueOnce(FAILED)
      .mockResolvedValueOnce(NONE)
      .mockRejectedValueOnce(new Error('reject'))
      .mockResolvedValue(NONE);
    const outcomes: string[] = [];
    for (let i = 0; i < MAX_SEND_RETRIES + 2; i++) outcomes.push(String((await tick(DOMESTIC)).outcome));
    expect(outcomes).toEqual([
      'send_failed_released', 'no_channel_released', 'send_failed_released', 'no_channel', 'already_sent',
    ]);
    expect(dispatchAlert).toHaveBeenCalledTimes(MAX_SEND_RETRIES + 1);
  });

  test('④ 상한은 거래일·시장별 — 다음 거래일에는 다시 시도한다', async () => {
    dispatchAlert.mockResolvedValue(NONE);
    for (let i = 0; i < MAX_SEND_RETRIES + 1; i++) await tick(DOMESTIC);
    dispatchAlert.mockResolvedValue(DELIVERED);
    const tue = new Date('2026-10-20T01:00:00Z');
    expect((await tick(DOMESTIC, 2, deps({ now: () => tue }))).outcome).toBe('sent');
  });

  test('⑤ dispatch 가 throw 해도 기존 동작 불변 — send_failed_released, 표식 되돌림, 결과 줄은 channel=- 로 남김', async () => {
    dispatchAlert.mockRejectedValue(new Error('network down'));
    const outcomes: string[] = [];
    for (let i = 0; i < MAX_SEND_RETRIES + 2; i++) outcomes.push(String((await tick(DOMESTIC)).outcome));
    expect(outcomes).toEqual([...Array(MAX_SEND_RETRIES).fill('send_failed_released'), 'send_failed_kept', 'already_sent']);
    expect(MARKER()).toBe(JSON.stringify('2026-10-19'));
    const lines = resultLines();
    expect(lines).toHaveLength(MAX_SEND_RETRIES + 1);
    expect(lines[0]).toBe(
      '[sell-proposal-preview:domestic] 요약 결과 send_failed_released (거래일 2026-10-19, channel=-, '
      + 'delivered=[], failed=[], unconfigured=[]) — 전송 호출 예외',
    );
    expect(lines[MAX_SEND_RETRIES]).toContain('요약 결과 send_failed_kept');
  });

  test('⑤ 결과 로그 자체가 던져도 반환값·표식은 바뀌지 않는다', async () => {
    (console.log as jest.Mock).mockImplementation(() => { throw new Error('stdout closed'); });
    expect((await tick(DOMESTIC)).outcome).toBe('sent');
    expect(MARKER()).toBe(JSON.stringify('2026-10-19'));
    expect((await tick(DOMESTIC)).outcome).toBe('already_sent');
  });

  test('⑥ 결과 줄에는 토큰·채팅 ID·실패 사유 원문·제목·본문·종목·수량·평단이 없다', async () => {
    const FAKE_TOKEN = '123456789:AAFakeTokenValueForTest';
    const FAKE_CHAT = '-1009876543210';
    dispatchAlert
      .mockResolvedValueOnce({
        channel: 'telegram', delivered: [],
        failed: [{ channel: 'telegram', error: `HTTP 401 bot${FAKE_TOKEN} chat_id=${FAKE_CHAT}` }], unconfigured: [],
      })
      // 계약 밖 채널 이름(외부 문자열 혼입)도 그대로 싣지 않는다
      .mockResolvedValueOnce({ channel: `telegram ${FAKE_TOKEN}`, delivered: [], failed: [], unconfigured: [FAKE_CHAT] })
      .mockResolvedValue(DELIVERED);
    await tick(DOMESTIC);
    await tick(DOMESTIC);
    await tick(DOMESTIC);
    const lines = resultLines();
    expect(lines).toHaveLength(3);
    const odd = lines.find(s => s.includes('요약 결과 no_channel_released'));
    expect(odd).toContain('channel=?');
    expect(odd).toContain('unconfigured=[?]');
    const [, title, body] = dispatchAlert.mock.calls[2] as [string, string, string];
    const forbidden = [
      FAKE_TOKEN, 'AAFakeToken', FAKE_CHAT, '9876543210', 'HTTP 401',
      title, '매도 제안 시뮬레이션', '시뮬레이션 — 시그널·주문 없음',
      '000660', '005930', '2,641,000', '331,500', '220,000', '9주', 'KIS 수량', '매입평균',
    ];
    for (const line of lines) {
      for (const f of forbidden) expect(line).not.toContain(f);
    }
    // 정상 전송 틱에서는 어떤 로그(log·warn·error)에도 제목·본문이 실리지 않는다
    const all = [...logCalls(), ...warnCalls(), ...errorCalls()].join('\n');
    expect(all).not.toContain(title);
    for (const piece of body.split('\n').filter(s => s.trim().length > 8)) expect(all).not.toContain(piece);
  });
});

describe('🔴 T-060 Codex C2 — 같은 프로세스에서 겹친 finish() 는 in_flight (DB·knownDone 불간섭)', () => {
  const NONE = { channel: 'none', delivered: [], failed: [], unconfigured: [] };
  const MARKER = () => configRows.get(reportMarkerKey('domestic'));
  const claimQueries = () => poolQuery.mock.calls.filter(c => /INSERT IGNORE|AND value <> \?/.test(String(c[0]))).length;
  async function openObserved() {
    const run = await openSellProposalPreview('domestic', DOMESTIC.length, deps());
    for (const o of DOMESTIC) run!.observe(o, recorder() as never);
    return run!;
  }
  /** 첫 finish 의 전송을 붙잡아 둔다 — 느린 알림(fetch 타임아웃 없음) 흉내 */
  async function startSlowFirst() {
    let release!: (v: unknown) => void;
    dispatchAlert.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    const first = (await openObserved()).finish();
    for (let i = 0; i < 50 && dispatchAlert.mock.calls.length === 0; i++) await new Promise((r) => setImmediate(r));
    expect(dispatchAlert).toHaveBeenCalledTimes(1);          // 선점까지 끝나고 전송 중
    return { first, finishSend: (v: unknown) => release(v) };
  }

  test('① 첫 finish 가 전송 중이면 두 번째는 in_flight — 선점 쿼리 없음·전송 없음', async () => {
    const { first, finishSend } = await startSlowFirst();
    const before = claimQueries();
    expect(await (await openObserved()).finish()).toBe('in_flight');
    expect(claimQueries()).toBe(before);
    expect(dispatchAlert).toHaveBeenCalledTimes(1);
    finishSend(DELIVERED);
    expect(await first).toBe('sent');
  });

  test('② 겹친 뒤 첫 쪽이 전달 0·실패 0 으로 표식을 되돌리면, 다음 finish 가 다시 선점해 재시도한다 (knownDone 미설정)', async () => {
    const { first, finishSend } = await startSlowFirst();
    expect(await (await openObserved()).finish()).toBe('in_flight');
    finishSend(NONE);
    expect(await first).toBe('no_channel_released');
    expect(MARKER()).toBe(JSON.stringify(''));
    const before = claimQueries();
    expect(await (await openObserved()).finish()).toBe('sent');   // 세 번째 — 다시 선점·전송
    expect(claimQueries()).toBeGreaterThan(before);
    expect(dispatchAlert).toHaveBeenCalledTimes(2);
    expect(MARKER()).toBe(JSON.stringify('2026-10-19'));
  });

  test('② 겹친 뒤 첫 쪽이 전송 실패로 되돌려도 같다', async () => {
    const { first, finishSend } = await startSlowFirst();
    expect(await (await openObserved()).finish()).toBe('in_flight');
    finishSend(FAILED);
    expect(await first).toBe('send_failed_released');
    expect(await (await openObserved()).finish()).toBe('sent');
  });

  test('③ 첫 finish 가 예외로 끝나도(error) 가드가 비워져 다음 호출이 DB 까지 진행한다', async () => {
    dispatchAlert.mockResolvedValueOnce({});                  // 계약 밖 결과 → 결과 판정에서 TypeError
    expect(await (await openObserved()).finish()).toBe('error');
    const before = claimQueries();
    const next = await (await openObserved()).finish();
    expect(next).not.toBe('in_flight');
    expect(next).toBe('claim_lost');                           // 표식은 첫 쪽이 선점한 채 — 기존 'error' 동작 그대로
    expect(claimQueries()).toBeGreaterThan(before);
  });

  test('③ 조기 return(선점 쿼리 오류 claim_error)에서도 가드가 비워진다', async () => {
    poolQuery.mockImplementationOnce(async () => { throw new Error('db blip'); });
    expect(await (await openObserved()).finish()).toBe('claim_error');
    expect(await (await openObserved()).finish()).toBe('sent');
  });

  // ── low-7·low-8 (3차 감사) ─────────────────────────────────────────────────
  const TUE_10_KST = new Date('2026-10-20T01:00:00Z');
  const OVERSEAS_MON = new Date('2026-10-19T15:00:00Z');           // ET 10-19 세션
  const inFlightWarns = () => (console.warn as jest.Mock).mock.calls.map(c => String(c[0])).filter(s => s.includes('아직 진행 중'));
  async function openAt(market: Market, at: Date) {
    const list = market === 'domestic' ? DOMESTIC : [obs('NAS:MU', 1_422_003, 1_197_425, 11)];
    const run = await openSellProposalPreview(market, list.length, deps({ now: () => at }));
    for (const o of list) run!.observe(o, recorder() as never);
    return run!;
  }
  /** 모든 전송을 붙잡아 두고 풀 함수 목록을 돌려준다 */
  function holdAllSends() {
    const releases: Array<(v: unknown) => void> = [];
    dispatchAlert.mockImplementation(() => new Promise((r) => { releases.push(r); }));
    return releases;
  }
  async function untilSends(n: number) {
    for (let i = 0; i < 100 && dispatchAlert.mock.calls.length < n; i++) await new Promise((r) => setImmediate(r));
    expect(dispatchAlert).toHaveBeenCalledTimes(n);
  }

  test('low-8 가드 키는 market:sessionDate — 월요일 전송이 멈춘 채여도 다음 거래일 finish 는 정상 진행한다', async () => {
    const { first, finishSend } = await startSlowFirst();          // 국내 2026-10-19 전송 pending
    const before = claimQueries();
    expect(await (await openAt('domestic', TUE_10_KST)).finish()).toBe('sent');
    expect(claimQueries()).toBeGreaterThan(before);                // 화요일 키로 실제 선점했다
    expect(MARKER()).toBe(JSON.stringify('2026-10-20'));
    expect(inFlightWarns()).toEqual([]);
    finishSend(DELIVERED);
    expect(await first).toBe('sent');
  });

  test('low-7 in_flight 경고는 같은 시장·거래일당 1회, 고정 문구 — 상태(DB·카운터)는 건드리지 않는다', async () => {
    const { first, finishSend } = await startSlowFirst();
    const before = claimQueries();
    for (let i = 0; i < 3; i++) expect(await (await openObserved()).finish()).toBe('in_flight');
    expect(inFlightWarns()).toEqual([
      '[sell-proposal-preview:domestic] 이전 요약 전송이 아직 진행 중 — 거래일 2026-10-19 중복 시도 보류(전송이 멈췄다면 오늘 요약이 누락될 수 있음)',
    ]);
    expect(claimQueries()).toBe(before);
    expect(dispatchAlert).toHaveBeenCalledTimes(1);
    finishSend(NONE);
    expect(await first).toBe('no_channel_released');
    // in_flight 는 재시도 횟수를 쓰지 않았다 — 이후 전달 0 이 MAX_SEND_RETRIES 회 더(첫 1회 포함 총 상한) 이어진 뒤에야 포기
    dispatchAlert.mockResolvedValue(NONE);
    const outcomes: string[] = [];
    for (let i = 0; i < MAX_SEND_RETRIES; i++) outcomes.push(String(await (await openObserved()).finish()));
    expect(outcomes).toEqual([...Array(MAX_SEND_RETRIES - 1).fill('no_channel_released'), 'no_channel']);
    expect(inFlightWarns()).toHaveLength(1);
  });

  test('low-7 서로 다른 시장·거래일은 각각 1회씩 경고한다', async () => {
    const releases = holdAllSends();
    const pMon = (await openAt('domestic', MON_10_KST)).finish();
    await untilSends(1);
    const pTue = (await openAt('domestic', TUE_10_KST)).finish();
    await untilSends(2);
    const pOv = (await openAt('overseas', OVERSEAS_MON)).finish();
    await untilSends(3);
    for (let i = 0; i < 2; i++) {
      expect(await (await openAt('domestic', MON_10_KST)).finish()).toBe('in_flight');
      expect(await (await openAt('domestic', TUE_10_KST)).finish()).toBe('in_flight');
      expect(await (await openAt('overseas', OVERSEAS_MON)).finish()).toBe('in_flight');
    }
    expect(inFlightWarns().sort()).toEqual([
      '[sell-proposal-preview:domestic] 이전 요약 전송이 아직 진행 중 — 거래일 2026-10-19 중복 시도 보류(전송이 멈췄다면 오늘 요약이 누락될 수 있음)',
      '[sell-proposal-preview:domestic] 이전 요약 전송이 아직 진행 중 — 거래일 2026-10-20 중복 시도 보류(전송이 멈췄다면 오늘 요약이 누락될 수 있음)',
      '[sell-proposal-preview:overseas] 이전 요약 전송이 아직 진행 중 — 거래일 2026-10-19 중복 시도 보류(전송이 멈췄다면 오늘 요약이 누락될 수 있음)',
    ].sort());
    // 경고 줄에 토큰·본문·수량·실패 사유가 없다 (고정 문구 + 시장·거래일뿐)
    for (const w of inFlightWarns()) for (const f of ['000660', '005930', 'NAS:MU', '₩', '주', 'HTTP', '매도 제안']) expect(w).not.toContain(f);
    for (const r of releases) r(DELIVERED);
    expect(await Promise.all([pMon, pTue, pOv])).toEqual(['sent', 'sent', 'sent']);
  });

  test('low-7 경고 기록은 재시작(로컬 상태 초기화)에 비워진다', async () => {
    const releases = holdAllSends();
    const p1 = (await openObserved()).finish();
    await untilSends(1);
    expect(await (await openObserved()).finish()).toBe('in_flight');
    expect(inFlightWarns()).toHaveLength(1);
    releases[0](NONE);
    expect(await p1).toBe('no_channel_released');               // 표식 되돌림 — 같은 거래일 재시도 가능
    resetSellProposalPreviewState();                            // 재시작 흉내
    // 같은 시장·거래일로 다시 겹치게 만들면 경고가 다시 1회 나간다(경고 기록도 초기화됐다)
    const p2 = (await openObserved()).finish();
    await untilSends(2);
    expect(await (await openObserved()).finish()).toBe('in_flight');
    expect(await (await openObserved()).finish()).toBe('in_flight');
    expect(inFlightWarns()).toHaveLength(2);
    releases[1](DELIVERED);
    expect(await p2).toBe('sent');
  });

  test('④ 다른 프로세스와의 진짜 경쟁(선점 false)은 기존대로 claim_lost + knownDone', async () => {
    configRows.set(reportMarkerKey('domestic'), JSON.stringify('2026-10-19'));   // 다른 프로세스가 이미 선점
    expect(await (await openObserved()).finish()).toBe('claim_lost');
    const before = claimQueries();
    expect(await (await openObserved()).finish()).toBe('already_sent');         // knownDone — DB 도 안 본다
    expect(claimQueries()).toBe(before);
    expect(dispatchAlert).not.toHaveBeenCalled();
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

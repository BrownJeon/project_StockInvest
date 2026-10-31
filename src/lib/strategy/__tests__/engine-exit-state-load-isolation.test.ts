/**
 * T-134 — 청산 평가 루프(`runExitEngine`)의 **보유 종목 상태 조회(`loadPositionState`) 실패를 종목 단위로 격리**한다.
 *
 * ## 고정하려는 결함 (변경 전 트리 c593300 에서 재현)
 *
 * 루프 안 이웃 호출 `kis.getTicker`·`upsertPositionState` 는 try/catch → 기록 → `continue` 로 종목마다 격리돼 있었지만
 * `loadPositionState` 만 무방비였다. 조회 한 번이 던지면(풀 대기 초과·연결 끊김·DB 일시 정지) 예외가 `for` 를 끊고
 * `runExitEngine` → `runMarket` → `runAll` 밖으로 나가, 그 틱에서
 *  - 아직 평가하지 않은 보유 종목의 손절·익절 평가가 통째로 건너뛰어지고(다음 틱 약 5분 뒤까지 보호 공백)
 *  - 청산 판단 기록(`exit_judgment`) flush·eval_funnel flush·신규 진입 평가가 전부 사라지며
 *  - 크론 라우트가 500 을 돌려 실행 기록이 failed 로 남는다.
 *
 * ## 이 파일이 고정하는 계약
 *
 *  (a) 조회가 던져도(Error·문자열·undefined, 동기 throw·거부 Promise 모두) 같은 틱의 나머지 종목은 평가되고 청산 시그널이 만들어진다.
 *  (b) 실패 종목은 eval_funnel 에 `exit_state_load_failed`(error, stage 23) **1행**, 청산 판단 기록에
 *      `decision='error'`·`decision_code='exit_state_load_failed'` **1행** — 입력은 이웃(`exit_state_upsert_failed`)과 같은 `{symbol, entry, ticker}`.
 *  (d) 실패 종목에는 시그널·쿨다운·추가 position_state 쓰기·경보가 **새로 생기지 않는다**(보수적으로 건너뛰고 기록만 — 새 청산 경로 없음).
 *  (c) 실패가 없는 틱의 관찰값은 변경 전과 같다 — 이 파일은 "실패 종목을 뺀 나머지 = 실패가 없을 때의 그 종목들"까지만 보고,
 *      변경 전 트리와의 바이트 단위 대조는 별도 하네스(task 이력서 Developer 절)가 한다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Market } from '@/lib/exchanges/kis-symbols';

// ─── 모의 DB ─────────────────────────────────────────────────────────────────
const db = { exitEngineEnabled: 'true' as string | null, recordSwitchOn: true };
const SWITCH_SQL = 'SELECT value FROM system_config WHERE `key` = ? LIMIT 1';
/** eval_funnel 로 실제 flush 된 행 (행당 10개 파라미터: run_id, market, symbol, strategy_id, side, stage, gate, verdict, reason, detail) */
const funnelRows: Array<{ symbol: string | null; side: string | null; stage: number; gate: string; verdict: string; detail: unknown }> = [];
/** exit_judgment INSERT 파라미터(평평한 배열) */
const judgmentInserts: unknown[][] = [];
async function poolQuery(sql: unknown, params?: unknown) {
  const s = String(sql);
  const p = (params as unknown[] | undefined) ?? [];
  if (s === SWITCH_SQL && p[0] === 'exit_judgment_record_enabled') return [db.recordSwitchOn ? [{ value: 'true' }] : [], []];
  if (s.startsWith('INSERT INTO exit_judgment')) { judgmentInserts.push(p); return [{ affectedRows: 1 }, []]; }
  if (/INSERT INTO eval_funnel/i.test(s)) {
    for (let i = 0; i + 9 < p.length; i += 10) {
      funnelRows.push({
        symbol: p[i + 2] as string | null, side: p[i + 4] as string | null, stage: Number(p[i + 5]),
        gate: String(p[i + 6]), verdict: String(p[i + 7]), detail: p[i + 9] == null ? null : JSON.parse(String(p[i + 9])),
      });
    }
    return [{ affectedRows: 1 }, []];
  }
  if (/FROM system_config/i.test(s)) {
    const out: Array<{ key: string; value: string }> = [];
    if (p.includes('exit_engine_enabled') && db.exitEngineEnabled != null) out.push({ key: 'exit_engine_enabled', value: db.exitEngineEnabled });
    return [out, []];
  }
  return [[], []];
}
jest.mock('@/lib/db', () => ({
  getPool: () => ({
    query: (...a: unknown[]) => poolQuery(a[0], a[1]),
    getConnection: async () => ({ query: (...a: unknown[]) => poolQuery(a[0], a[1]), release: () => {}, destroy: () => {} }),
  }),
}));

// ─── 외부 I/O ────────────────────────────────────────────────────────────────
const getBalancesDetailed = jest.fn();
const getTicker = jest.fn();
jest.mock('@/lib/exchanges/kis', () => ({
  kis: { getTicker: (...a: unknown[]) => getTicker(...a), getCandles: jest.fn(async () => []), getMarket: () => 'domestic', createOrder: jest.fn() },
  getBalancesDetailed: (...a: unknown[]) => getBalancesDetailed(...a),
}));
jest.mock('@/lib/strategy/market-hours', () => ({ isDomesticOpen: async () => true, isOverseasOpen: async () => true, getCurrentMarket: async () => 'domestic' }));
const upsertPositionState = jest.fn();
const reconcilePositionState = jest.fn();
const loadPositionState = jest.fn();
jest.mock('@/lib/strategy/position-state', () => ({
  upsertPositionState: (...a: unknown[]) => upsertPositionState(...a),
  reconcilePositionState: (...a: unknown[]) => reconcilePositionState(...a),
  loadPositionState: (...a: unknown[]) => loadPositionState(...a),
}));
const createSignal = jest.fn();
jest.mock('@/lib/signals/service', () => ({ createSignal: (...a: unknown[]) => createSignal(...a) }));
const sendAlert = jest.fn();
const sendAlertThrottled = jest.fn();
jest.mock('@/lib/notify', () => ({ sendAlert: (...a: unknown[]) => sendAlert(...a) }));
jest.mock('@/lib/notify/throttle', () => ({ sendAlertThrottled: (...a: unknown[]) => sendAlertThrottled(...a), resetAlertThrottle: () => {} }));
jest.mock('@/lib/signals/router', () => ({ getEngineSwitches: async () => ({ engineEnabled: false, autopilotMode: 'assist', source: 'config' }) }));
const setCooldown = jest.fn();
jest.mock('@/lib/strategy/cooldowns', () => ({
  loadActiveCooldowns: async () => ({ isActive: () => false, until: () => null, loadError: null }),
  setCooldown: (...a: unknown[]) => setCooldown(...a),
  COOLDOWN_TTL_MIN: { entry: 120, rebuy: 30, exit: 15, entryRejected: 240 },
}));
const STYLE = {
  hardStopPct: 5, targetProfitPct: 3, trailingActivatePct: 3, trailingDrawdownPct: 2, eodLossCutPct: 2,
  lateSessionBuyBlockMin: 30, feePct: 0.18, slippagePct: 0.15, stableCoreRatioMin: 0,
};
jest.mock('@/lib/strategy/style', () => ({ getStyleConfig: async () => STYLE, roundTripCostPct: () => 0.33 }));
jest.mock('@/lib/strategy/universe', () => ({
  refreshUniverse: async () => ({ refreshed: false }), getUniverseSymbols: async () => [] as string[], getAlwaysIncludeSymbols: async () => [] as string[],
}));
jest.mock('@/lib/strategy/macro', () => ({ fetchMacroIndicators: async () => ({ kospiChangePct: 0, sp500ChangePct: 0 }) }));
jest.mock('@/lib/safety/order-limits', () => ({ getEffectiveOrderMax: async () => 100_000 }));
jest.mock('@/lib/strategy/portfolio-stability', () => ({ checkPortfolioStability: async () => ({ verdict: 'pass' }) }));
jest.mock('@/lib/strategy/ai-prefilter', () => ({ prefilterCandidate: () => ({ verdict: 'pass' }) }));
jest.mock('@/lib/strategy/ai-filter', () => ({ buildMarketSummary: () => ({ rsi14: 30 }) }));
jest.mock('@/lib/strategy/market-state', () => ({ classifyMarketState: () => 'neutral' }));
jest.mock('@/lib/strategy/rules', () => ({ STRATEGY_REGISTRY: {} }));
jest.mock('@/lib/strategy/sell-proposal-preview', () => ({ openSellProposalPreview: async () => null }));

import { runAll, resetHeldUnknownState } from '../engine';
import { EvalFunnelRecorder, __resetPruneTimer } from '../eval-funnel';
import { FUNNEL_GATES, GATE_LABEL_KO, GATE_STAGE, gateLabelKo } from '../eval-funnel-labels';
import { EXIT_JUDGMENT_COLUMNS, resetExitJudgmentForTest, waitForExitJudgmentRecordsForTest } from '../records/exit-judgment';
import { resetRecordSwitchCacheForTest } from '../records/record-switch';

// ─── 픽스처 ──────────────────────────────────────────────────────────────────
const ENTRY = 70_000;
/** 손실한도 손절(−5%)을 넘는 가격 — 평가되면 반드시 청산 시그널이 나온다 */
const FIRE = 60_000;
/** 2026-08-05(수) 10:00 KST — 장마감 전 손절 창 밖 */
const SAFE_KST = new Date('2026-08-05T01:00:00Z');
const D = ['005930', '000660', '035720'];
const BAD = D[1];

function balances(symbols: string[]) {
  return {
    balances: [{ currency: 'KRW', free: 500_000, locked: 0 }, ...symbols.map((s) => ({ currency: s, free: 10, locked: 0, avgPrice: ENTRY }))],
    ok: ['domestic', 'overseas'] as Market[], failed: [] as Array<{ market: Market; error: string }>, complete: true,
  };
}
function positionState(symbol: string, market: Market) {
  return {
    symbol, market, entryPrice: ENTRY, peakPrice: ENTRY, qty: 10, scenarioExit: null, holdingDeadline: null,
    firstSeenAt: new Date('2026-08-01T00:00:00Z'), updatedAt: new Date('2026-08-05T00:59:00Z'),
  };
}
const okState = async (s: string, m: Market) => positionState(s, m);

/** 던지는 방식 — 거부 Promise(실제 `getPool().query` 실패 모양)와 동기 throw 둘 다. 던지는 값은 Error·문자열·undefined. */
type Thrower = { name: string; thrown: unknown; sync: boolean };
const LONG = 'E'.repeat(400);
const THROWERS: Thrower[] = [
  { name: 'Error 거부', thrown: Object.assign(new Error('pool queue timeout'), { code: 'PROTOCOL_SEQUENCE_TIMEOUT' }), sync: false },
  { name: '문자열 거부', thrown: 'connection lost', sync: false },
  { name: 'undefined 거부', thrown: undefined, sync: false },
  { name: 'Error 동기 throw', thrown: new Error('ECONNREFUSED 10.0.0.1:3306'), sync: true },
  { name: '문자열 동기 throw', thrown: 'sync string', sync: true },
  { name: 'undefined 동기 throw', thrown: undefined, sync: true },
  { name: '긴 메시지(300자 자름)', thrown: new Error(LONG), sync: false },
];
function failFor(bad: ReadonlySet<string>, t: Thrower) {
  loadPositionState.mockImplementation((s: string, m: Market) => {
    if (!bad.has(s)) return okState(s, m);
    if (t.sync) throw t.thrown;
    return Promise.reject(t.thrown);
  });
}

let recordSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;
function resetAll() {
  jest.clearAllMocks();
  funnelRows.length = 0;
  judgmentInserts.length = 0;
  db.exitEngineEnabled = 'true';
  db.recordSwitchOn = true;
  resetHeldUnknownState();
  resetRecordSwitchCacheForTest();
  resetExitJudgmentForTest();
  __resetPruneTimer();
  upsertPositionState.mockResolvedValue(undefined);
  reconcilePositionState.mockResolvedValue(0);
  loadPositionState.mockImplementation(okState);
  createSignal.mockResolvedValue({ ok: true, signalId: 777, autoSubmitted: true });
  setCooldown.mockResolvedValue(true);
  getTicker.mockImplementation(async (s: string) => ({ price: FIRE, open24h: ENTRY, timestamp: 0, symbol: s }));
}

async function tick(symbols: string[], market: Market = 'domestic') {
  getBalancesDetailed.mockResolvedValue(balances(symbols));
  const result = await runAll({ market });
  const records = await waitForExitJudgmentRecordsForTest();
  const rows: Array<Record<string, unknown>> = [];
  const n = EXIT_JUDGMENT_COLUMNS.length;
  for (const p of judgmentInserts) for (let i = 0; i < p.length; i += n) rows.push(Object.fromEntries(EXIT_JUDGMENT_COLUMNS.map((k, j) => [k, p[i + j]])));
  return {
    result,
    records,
    rows,
    events: recordSpy.mock.calls.map((c) => c[0] as { gate: string; verdict: string; symbol?: string; side?: string; detail?: unknown }),
    created: createSignal.mock.calls.map((c) => (c[0] as { symbol: string }).symbol),
    cooldowns: setCooldown.mock.calls.map((c) => (c[0] as { symbol: string }).symbol),
  };
}

beforeAll(() => {
  // Date 만 고정 — 타이머는 실물(기록기 상한)
  jest.useFakeTimers({
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback',
      'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
});
afterAll(() => { jest.useRealTimers(); });
beforeEach(() => {
  recordSpy = jest.spyOn(EvalFunnelRecorder.prototype, 'record');
  jest.spyOn(console, 'log').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  resetAll();
  jest.setSystemTime(SAFE_KST);
});
afterEach(() => { jest.restoreAllMocks(); });

// ═════════════════════════════════════════════════════════════════════════════
describe('정적 — 격리 형태가 이웃(시세·state upsert)과 같다', () => {
  const src = readFileSync(join(__dirname, '..', 'engine.ts'), 'utf8');
  test('조회 호출은 try 안 1곳 — catch 는 경고 → rec.error → 판단 기록 → continue (새 평가·새 조회·await 없음)', () => {
    expect(src.match(/loadPositionState\(/g)).toHaveLength(1);
    expect(src).toContain([
      '    let state: PositionState | null;',
      '    try {',
      '      state = await loadPositionState(symbol, market);',
      '    } catch (e) {',
      '      console.warn(`[exit-engine] state 조회 실패 ${symbol}: ${e instanceof Error ? e.message : String(e)}`);',
      "      rec.error('exit_state_load_failed', { symbol, side: 'sell', detail: { error: String(e).slice(0, 300) } });",
      "      noteExitJudgment(exitJudg, 'error', 'exit_state_load_failed', { symbol, entry, ticker });",
      '      continue;',
      '    }',
      '    if (!state) {',
      "      rec.error('exit_state_missing', { symbol, side: 'sell' });",
    ].join('\n'));
    // 바로 위 이웃(state upsert 실패)과 같은 모양 — 메시지 앞머리·detail 형태·기록 입력이 같다
    expect(src).toContain("      rec.error('exit_state_upsert_failed', { symbol, side: 'sell', detail: { error: String(e).slice(0, 300) } });\n"
      + "      noteExitJudgment(exitJudg, 'error', 'exit_state_upsert_failed', { symbol, entry, ticker });\n      continue;\n    }\n");
  });

  test('게이트 등록 — 목록 끝 append, stage 23(이웃과 같은 단계), 한글 라벨, VARCHAR(48) 이내', () => {
    expect(FUNNEL_GATES[FUNNEL_GATES.length - 1]).toBe('exit_state_load_failed');
    expect(FUNNEL_GATES.filter((g) => g === 'exit_state_load_failed')).toHaveLength(1);
    expect(GATE_STAGE.exit_state_load_failed).toBe(23);
    expect(GATE_STAGE.exit_state_load_failed).toBe(GATE_STAGE.exit_state_missing);
    expect(GATE_LABEL_KO.exit_state_load_failed).toBe('청산: 포지션 조회 실패');
    expect(gateLabelKo('exit_state_load_failed')).toBe('청산: 포지션 조회 실패');
    expect('exit_state_load_failed'.length).toBeLessThanOrEqual(48);   // eval_funnel.gate·exit_judgment.decision_code VARCHAR(48)
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('🔴 결함 재현 — 3종목 중 2번째 상태 조회 실패, 3번째도 평가된다', () => {
  test('runAll 이 던지지 않고, 1·3번째 종목의 청산 시그널이 만들어지며, 틱 끝 기록(eval_funnel run 행)이 남는다', async () => {
    failFor(new Set([BAD]), THROWERS[0]);
    // 한 번의 비교로 모은다 — 변경 전 트리에서 실패 diff 가 「던졌다·3번째 미평가·틱 기록 없음」을 한꺼번에 보여 주게
    let threw: string | null = null;
    let errors: string[] | null = null;
    try { errors = (await tick(D)).result.errors; } catch (e) { threw = e instanceof Error ? e.message : String(e); }
    expect({
      threw,
      errors,
      created: createSignal.mock.calls.map((c) => (c[0] as { symbol: string }).symbol),
      cooldowns: setCooldown.mock.calls.map((c) => (c[0] as { symbol: string }).symbol),
      // 3종목 모두 조회를 시도했다(실패 종목에서 루프가 끊기지 않았다)
      loads: loadPositionState.mock.calls.map((c) => c[0]),
      tickers: getTicker.mock.calls.map((c) => c[0]),
      // 틱이 끝까지 돌아 eval_funnel 이 flush 됐다(이 시험은 신규 진입 엔진을 꺼 둔 틱이라 청산 전용 run 행 skip)
      runRows: funnelRows.filter((r) => r.gate === 'run').map((r) => [r.verdict, (r.detail as { exitSignalsCreated: number }).exitSignalsCreated]),
      judgmentInserts: judgmentInserts.length,
    }).toEqual({
      threw: null,
      errors: ['engine_disabled'],
      created: [D[0], D[2]],
      cooldowns: [D[0], D[2]],
      loads: D,
      tickers: D,
      runRows: [['skip', 2]],
      judgmentInserts: 1,
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe.each(THROWERS.map((t) => [t.name, t] as const))('(a)(b)(d) 던지는 값 %s', (_n, t) => {
  test('나머지 종목 평가·시그널 / 실패 종목 eval_funnel 1행·판단 기록 1행 / 실패 종목에 시그널·쿨다운·추가 쓰기·경보 없음', async () => {
    failFor(new Set([BAD]), t);
    const o = await tick(D);

    // (a) 나머지 종목 — 평가되고 청산 시그널 생성
    expect(o.created).toEqual([D[0], D[2]]);
    expect(o.events.filter((e) => e.gate === 'signal_created').map((e) => e.symbol)).toEqual([D[0], D[2]]);

    // (b) 실패 종목의 eval_funnel — 정확히 1행, 그 종목의 게이트는 이것 하나뿐
    const expectedDetail = { error: String(t.thrown).slice(0, 300) };
    expect(o.events.filter((e) => e.symbol === BAD)).toEqual([
      { symbol: BAD, side: 'sell', detail: expectedDetail, gate: 'exit_state_load_failed', verdict: 'error' },
    ]);
    expect(o.events.filter((e) => e.gate === 'exit_state_load_failed')).toHaveLength(1);
    expect(funnelRows.filter((r) => r.symbol === BAD)).toEqual([
      { symbol: BAD, side: 'sell', stage: 23, gate: 'exit_state_load_failed', verdict: 'error', detail: expectedDetail },
    ]);
    if (t.thrown === LONG || (t.thrown instanceof Error && t.thrown.message === LONG)) expect(expectedDetail.error).toHaveLength(300);

    // (b) 청산 판단 기록 — 틱당 INSERT 1문장, 종목당 1행, 실패 종목은 error/exit_state_load_failed
    expect(o.records).toEqual([expect.objectContaining({ status: 'written', rows: 3, dropped: 0 })]);
    expect(judgmentInserts).toHaveLength(1);
    expect(o.rows.map((r) => [r.symbol, r.decision, r.decision_code])).toEqual([
      [D[0], 'fired', 'signal_created'],
      [BAD, 'error', 'exit_state_load_failed'],
      [D[2], 'fired', 'signal_created'],
    ]);

    // (d) 실패 종목 — 시그널·쿨다운·경보 없음, position_state 쓰기는 조회 앞의 기존 upsert 1회뿐(조회 뒤 추가 쓰기 없음)
    expect(o.created).not.toContain(BAD);
    expect(o.cooldowns).not.toContain(BAD);
    expect(upsertPositionState.mock.calls.map((c) => c[0])).toEqual(D);
    expect(reconcilePositionState).toHaveBeenCalledTimes(1);
    expect(sendAlert).not.toHaveBeenCalled();
    expect(sendAlertThrottled).not.toHaveBeenCalled();

    // 운영 로그 — 종목·메시지만(가격·수량·평단 같은 금액 숫자 없음)
    const warns = warnSpy.mock.calls.map((c) => c.map(String).join(' ')).filter((s) => s.includes('state 조회 실패'));
    expect(warns).toEqual([`[exit-engine] state 조회 실패 ${BAD}: ${t.thrown instanceof Error ? t.thrown.message : String(t.thrown)}`]);
    for (const w of warns) expect(w).not.toMatch(/60000|60,000|70000|70,000/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('(b) 판단 기록 행 — 입력이 이웃(exit_state_upsert_failed)과 같다: 코드만 다르고 나머지 열은 같다', () => {
  test('조회 실패 행 = 갱신 실패 행 (decision_code 만 다름)', async () => {
    failFor(new Set([BAD]), THROWERS[0]);
    const load = (await tick(D)).rows.find((r) => r.symbol === BAD)!;

    resetAll();
    jest.setSystemTime(SAFE_KST);
    upsertPositionState.mockImplementation(async (s: string) => { if (s === BAD) throw new Error('lock wait'); });
    const ups = (await tick(D)).rows.find((r) => r.symbol === BAD)!;

    expect(ups.decision_code).toBe('exit_state_upsert_failed');
    expect(load.decision_code).toBe('exit_state_load_failed');
    expect({ ...load, decision_code: 'X' }).toEqual({ ...ups, decision_code: 'X' });
    // 상태를 읽지 못했으니 고점·발화 종류·시그널은 비고, 진입가는 이웃과 같이 KIS 평단(기록기 규칙 — 관찰 전용, 평가에 쓰지 않는다)
    expect(load).toMatchObject({ decision: 'error', entry_price: ENTRY, peak_price: null, trigger_kind: 'none', signal_id: null, price: FIRE });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('(c) 실패 종목을 뺀 나머지는 실패가 없을 때의 그 종목들과 같다', () => {
  /** 종목별로 갈라 본 관찰값 — 실패 종목만 빼고 비교한다 */
  async function perSymbol(bad: ReadonlySet<string>) {
    const o = await tick(D);
    const by = (s: string) => ({
      funnel: o.events.filter((e) => e.symbol === s),
      created: createSignal.mock.calls.filter((c) => (c[0] as { symbol: string }).symbol === s),
      cooldown: setCooldown.mock.calls.filter((c) => (c[0] as { symbol: string }).symbol === s),
      upsert: upsertPositionState.mock.calls.filter((c) => c[0] === s),
      load: loadPositionState.mock.calls.filter((c) => c[0] === s),
      ticker: getTicker.mock.calls.filter((c) => c[0] === s),
      row: o.rows.filter((r) => r.symbol === s),
    });
    return { o, view: Object.fromEntries(D.filter((s) => !bad.has(s)).map((s) => [s, JSON.parse(JSON.stringify(by(s)))])) };
  }
  test.each([
    ['첫 종목 실패', new Set([D[0]])],
    ['가운데 종목 실패', new Set([D[1]])],
    ['마지막 종목 실패', new Set([D[2]])],
    ['두 종목 실패', new Set([D[0], D[2]])],
  ] as const)('%s', async (_n, bad) => {
    const base = await perSymbol(bad);
    const baseRun = funnelRows.filter((r) => r.gate === 'run');
    resetAll();
    jest.setSystemTime(SAFE_KST);
    failFor(bad, THROWERS[0]);
    const cur = await perSymbol(bad);
    expect(cur.view).toEqual(base.view);
    // run 행(틱 요약)은 만든 청산 시그널 수만 다르다
    const curRun = funnelRows.filter((r) => r.gate === 'run');
    expect(curRun).toHaveLength(1);
    const strip = (r: { detail: unknown }) => ({ ...(r.detail as Record<string, unknown>), exitSignalsCreated: 0 });
    expect(strip(curRun[0])).toEqual(strip(baseRun[0]));
    expect((curRun[0].detail as { exitSignalsCreated: number }).exitSignalsCreated).toBe(D.length - bad.size);
    expect(cur.o.result).toEqual(base.o.result);
  });

  test('모든 종목 실패 — 시그널 0, 종목마다 1행씩, 틱은 끝까지 돈다', async () => {
    failFor(new Set(D), THROWERS[1]);
    const o = await tick(D);
    expect(o.created).toEqual([]);
    expect(o.cooldowns).toEqual([]);
    expect(o.events.filter((e) => e.gate === 'exit_state_load_failed').map((e) => e.symbol)).toEqual(D);
    expect(o.rows.map((r) => r.decision_code)).toEqual(D.map(() => 'exit_state_load_failed'));
    expect(funnelRows.filter((r) => r.gate === 'run')).toHaveLength(1);
  });

  test('해외 시장도 같다 — 실패 종목만 건너뛰고 나머지 발화', async () => {
    const OV = ['NAS:MU', 'NYS:KO', 'NAS:AAPL'];
    failFor(new Set([OV[1]]), THROWERS[0]);
    const o = await tick(OV, 'overseas');
    expect(o.created).toEqual([OV[0], OV[2]]);
    expect(o.rows.map((r) => [r.symbol, r.decision_code])).toEqual([[OV[0], 'signal_created'], [OV[1], 'exit_state_load_failed'], [OV[2], 'signal_created']]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('(d) 자동 청산 OFF 틱 — 실패 종목은 「막힌 청산」 수에 들어가지 않는다(경보 건수 = 평가된 종목만)', () => {
  test('3종목 모두 발화 조건, 1종목 조회 실패 → blocked 2, 경보 1회(2건)', async () => {
    db.exitEngineEnabled = 'false';
    failFor(new Set([BAD]), THROWERS[0]);
    const o = await tick(D);
    expect(o.created).toEqual([]);
    expect(o.events.filter((e) => e.gate === 'exit_engine_disabled').map((e) => e.symbol)).toEqual([D[0], D[2]]);
    expect(sendAlertThrottled).toHaveBeenCalledTimes(1);
    expect(String(sendAlertThrottled.mock.calls[0][2])).toContain('청산 조건 2건');
    const run = funnelRows.find((r) => r.gate === 'run')!;
    expect(run.detail).toMatchObject({ exitBlockedByDisable: 2, exitSignalsCreated: 0, exitEngineEnabled: false });
  });
});

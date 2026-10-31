/**
 * T-126 — 청산 엔진(`engine.ts` `runExitEngine`) ↔ 청산 판단 기록(`exit_judgment`) 배선 시험.
 *
 *  ① 결론 지점 1:1
 *     - 정적: 엔진 소스의 루프 안 청산 트랙 `rec.*` 호출(게이트 ID) 하나마다 **바로 뒤에** 기록 호출이 정확히 하나, 결론(decision)은 설계 D1 표,
 *       시그널 생성 성공·정책 스킵(`res.recordedGate`) 지점에 하나씩 — 누락·중복이 생기면 이 시험이 먼저 깨진다.
 *     - 동적: 경로마다(19장면) 보유 종목당 행이 정확히 1개, 그 코드 = 그 틱에 eval_funnel 에 남은 그 종목의 게이트, 장면 합집합 = 정적 목록.
 *  ② 🔴 영향 0 — 기록 상태 11가지(기록기 없음·스위치 키 없음·false·읽기 오류·읽기 무한 대기·켜짐·테이블 없음·CHECK 위반·INSERT 무한 대기·
 *     수집기 메서드가 매번 던짐·수집기 열기가 던짐)에서 runAll 결과·eval_funnel 기록(순서·내용)·시그널 생성 인자·쿨다운·position_state 쓰기·
 *     시세 조회·경보·로그(기록 모듈 경고 제외)·엔진 자신의 DB 문장(순서·인자)이 **기록기 없는 실행과 같다.** 엔진은 기록을 기다리지 않는다
 *     (1.5초 상한, INSERT 가 매달린 채로 반환).
 *  ③ 스위치 꺼짐 = INSERT 0(스위치 읽기 1회만), 켜짐 = 틱당 multi-row INSERT 1문장.
 *  ④ (선택) 변경 전 `engine.ts` 와의 동일 출력 — `T126_EQUIV_DUMP=<파일>` 이 있으면 장면별 관찰값을 JSON 으로 쓴다.
 *     변경 전 엔진(HEAD)을 잠시 되돌려 같은 시험을 돌린 파일과 비교한다(절차: task 이력서 Developer 절).
 *
 * DB 는 SQL 로 갈라 답하는 목이다(운영 DB·`.env` 접근 없음). 기록기·스위치는 실물을 쓴다(②). 시각은 Date 만 고정하고 타이머는 실물이다
 * (기록기의 4초 상한·스위치 2초 상한이 실제로 걸린다 — 엔진이 그것을 기다리지 않는지 1.5초 경주로 본다).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Market } from '@/lib/exchanges/kis-symbols';

// ─── 모의 DB ─────────────────────────────────────────────────────────────────
type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void; settled: boolean };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const d = { settled: false } as Deferred<T>;
  d.promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  d.resolve = (v) => { d.settled = true; resolve(v); };
  d.reject = (e) => { d.settled = true; reject(e); };
  return d;
}
type Answer = unknown[] | Error | Deferred<unknown>;
const db = {
  exitEngineEnabled: 'true' as string | null,
  exitHardStopEnabled: null as string | null,
  /** 청산 스위치 조회(`readExitEngineSwitch`) 자체가 실패 — source=db_error */
  exitSwitchError: false,
  recordSwitch: [] as Answer,
  insert: [{ affectedRows: 1 }] as Answer,
};
const calls: Array<{ sql: string; params: unknown[] }> = [];
const SWITCH_SQL = 'SELECT value FROM system_config WHERE `key` = ? LIMIT 1';
const isRecordSwitchRead = (c: { sql: string; params: unknown[] }) => c.sql === SWITCH_SQL && c.params[0] === 'exit_judgment_record_enabled';
const isRecordInsert = (c: { sql: string }) => c.sql.startsWith('INSERT INTO exit_judgment');
const isRecordIo = (c: { sql: string; params: unknown[] }) => isRecordSwitchRead(c) || isRecordInsert(c);
function answer(a: Answer): Promise<unknown> {
  if (a instanceof Error) return Promise.reject(a);
  if (Array.isArray(a)) return Promise.resolve([a, []]);
  return a.promise.then((v) => [v, []]);
}
async function poolQuery(sql: unknown, params?: unknown) {
  const c = { sql: String(sql), params: (params as unknown[] | undefined) ?? [] };
  calls.push(c);
  if (isRecordSwitchRead(c)) return answer(db.recordSwitch);
  if (isRecordInsert(c)) return answer(db.insert);
  if (/FROM system_config/i.test(c.sql)) {
    if (db.exitSwitchError && c.params.includes('exit_engine_enabled')) throw new Error('db down');
    const out: Array<{ key: string; value: string }> = [];
    if (c.params.includes('exit_engine_enabled') && db.exitEngineEnabled != null) out.push({ key: 'exit_engine_enabled', value: db.exitEngineEnabled });
    if (c.params.includes('exit_hard_stop_enabled') && db.exitHardStopEnabled != null) out.push({ key: 'exit_hard_stop_enabled', value: db.exitHardStopEnabled });
    return [out, []];
  }
  if (/INSERT INTO eval_funnel/i.test(c.sql)) return [{ affectedRows: 1 }, []];
  return [[], []];
}
/** 기록기가 풀에서 받은 연결의 끝(R1 — 정상 release / 오류·상한 destroy). 받은 수 = release + destroy 여야 한다(누수 0). */
const connEvents: Array<'acquire' | 'release' | 'destroy'> = [];
jest.mock('@/lib/db', () => ({
  getPool: () => ({
    query: (...a: unknown[]) => poolQuery(a[0], a[1]),
    getConnection: async () => {
      connEvents.push('acquire');
      return { query: (...a: unknown[]) => poolQuery(a[0], a[1]), release: () => { connEvents.push('release'); }, destroy: () => { connEvents.push('destroy'); } };
    },
  }),
}));

// ─── 외부 I/O ────────────────────────────────────────────────────────────────
const getBalancesDetailed = jest.fn();
const getTicker = jest.fn();
jest.mock('@/lib/exchanges/kis', () => ({
  kis: { getTicker: (...a: unknown[]) => getTicker(...a), getCandles: jest.fn(async () => []), getMarket: () => 'domestic', createOrder: jest.fn() },
  getBalancesDetailed: (...a: unknown[]) => getBalancesDetailed(...a),
}));
jest.mock('@/lib/strategy/market-hours', () => ({
  isDomesticOpen: async () => true,
  isOverseasOpen: async () => true,
  getCurrentMarket: async () => 'domestic',
}));
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
const cooldownState = { active: false };
jest.mock('@/lib/strategy/cooldowns', () => ({
  loadActiveCooldowns: async () => ({ isActive: () => cooldownState.active, until: () => null, loadError: null }),
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
// 수집기 열기만 감싼다 — 기본은 실물, 모드마다 "기록기 없음"·"매번 던짐"·"열기가 던짐"으로 바꾼다.
jest.mock('../exit-judgment', () => {
  const actual = jest.requireActual('../exit-judgment');
  return { ...actual, openExitJudgmentCollector: jest.fn((...a: unknown[]) => actual.openExitJudgmentCollector(...a)) };
});

import { runAll, resetHeldUnknownState } from '../../engine';
import { EvalFunnelRecorder, __resetPruneTimer } from '../../eval-funnel';
import {
  EXIT_JUDGMENT_COLUMNS,
  openExitJudgmentCollector,
  resetExitJudgmentForTest,
  waitForExitJudgmentRecordsForTest,
  type ExitDecision,
} from '../exit-judgment';
import { resetRecordSwitchCacheForTest } from '../record-switch';

const mOpen = openExitJudgmentCollector as jest.Mock;
const actualOpen = (jest.requireActual('../exit-judgment') as typeof import('../exit-judgment')).openExitJudgmentCollector;
const ROOT = join(__dirname, '..', '..', '..', '..', '..');

// ─── 픽스처 ──────────────────────────────────────────────────────────────────
const ENTRY = 70_000;
/** 2026-08-05(수) 10:00 KST — 장마감 전 손절 창 밖 */
const SAFE_KST = new Date('2026-08-05T01:00:00Z');
/** 15:25 KST — 장마감 전 손절 창 안 */
const EOD_KST = new Date('2026-08-05T06:25:00Z');

function balances(holds: Array<{ symbol: string; qty?: number; avgPrice?: number | undefined }>) {
  return {
    balances: [{ currency: 'KRW', free: 500_000, locked: 0 }, ...holds.map((h) => ({ currency: h.symbol, free: h.qty ?? 10, locked: 0, avgPrice: 'avgPrice' in h ? h.avgPrice : ENTRY }))],
    ok: ['domestic', 'overseas'] as Market[],
    failed: [] as Array<{ market: Market; error: string }>,
    complete: true,
  };
}
function positionState(symbol: string, market: Market, over: { entryPrice?: number; peakPrice?: number } = {}) {
  return {
    symbol, market, entryPrice: over.entryPrice ?? ENTRY, peakPrice: over.peakPrice ?? ENTRY, qty: 10, scenarioExit: null, holdingDeadline: null,
    firstSeenAt: new Date('2026-08-01T00:00:00Z'), updatedAt: new Date('2026-08-05T00:59:00Z'),
  };
}

interface Scene {
  name: string;
  market: Market;
  at?: Date;
  symbols: string[];
  arrange: () => void;
  /** 종목 → 기대 (결론, 코드) */
  expect: Record<string, [ExitDecision, string]>;
}
const DOM = '005930';
const OVS = 'NAS:MU';
const price = (p: number) => getTicker.mockResolvedValue({ price: p, open24h: ENTRY, timestamp: 0, symbol: 'x' });

const SCENES: Scene[] = [
  { name: 'avg_missing', market: 'domestic', symbols: [DOM], arrange: () => getBalancesDetailed.mockResolvedValue(balances([{ symbol: DOM, avgPrice: undefined }])), expect: { [DOM]: ['error', 'exit_avg_price_missing'] } },
  { name: 'ticker_error', market: 'domestic', symbols: [DOM], arrange: () => getTicker.mockRejectedValue(new Error('EGW00201 rate')), expect: { [DOM]: ['error', 'exit_ticker_error'] } },
  { name: 'price_invalid', market: 'domestic', symbols: [DOM], arrange: () => price(0), expect: { [DOM]: ['error', 'exit_price_invalid'] } },
  { name: 'upsert_failed', market: 'domestic', symbols: [DOM], arrange: () => upsertPositionState.mockRejectedValue(new Error('lock wait')), expect: { [DOM]: ['error', 'exit_state_upsert_failed'] } },
  { name: 'state_missing', market: 'domestic', symbols: [DOM], arrange: () => loadPositionState.mockResolvedValue(null), expect: { [DOM]: ['error', 'exit_state_missing'] } },
  { name: 'unit_mismatch', market: 'overseas', symbols: [OVS], arrange: () => { price(98_000); loadPositionState.mockImplementation(async (s: string, m: Market) => positionState(s, m, { entryPrice: 71.2, peakPrice: 71.2 })); }, expect: { [OVS]: ['error', 'exit_unit_mismatch'] } },
  { name: 'no_fire', market: 'domestic', symbols: [DOM], arrange: () => price(ENTRY), expect: { [DOM]: ['no_fire', 'exit_no_fire'] } },
  { name: 'engine_disabled', market: 'domestic', symbols: [DOM], arrange: () => { db.exitEngineEnabled = 'false'; price(60_000); }, expect: { [DOM]: ['skip_policy', 'exit_engine_disabled'] } },
  { name: 'switch_db_error', market: 'domestic', symbols: [DOM], arrange: () => { db.exitSwitchError = true; price(60_000); }, expect: { [DOM]: ['skip_policy', 'exit_engine_disabled'] } },
  { name: 'hard_stop_disabled', market: 'domestic', symbols: [DOM], arrange: () => { db.exitHardStopEnabled = 'false'; price(60_000); }, expect: { [DOM]: ['skip_policy', 'exit_hard_stop_disabled'] } },
  { name: 'cooldown', market: 'domestic', symbols: [DOM], arrange: () => { cooldownState.active = true; price(75_000); }, expect: { [DOM]: ['skip_cooldown', 'cooldown_exit'] } },
  { name: 'fired', market: 'domestic', symbols: [DOM], arrange: () => price(60_000), expect: { [DOM]: ['fired', 'signal_created'] } },
  { name: 'policy_qty', market: 'domestic', symbols: [DOM], arrange: () => { price(60_000); createSignal.mockResolvedValue({ ok: false, errorCode: 'quantity_below_min', error: '1주 미만' }); }, expect: { [DOM]: ['skip_policy', 'quantity_below_min'] } },
  { name: 'policy_dup', market: 'domestic', symbols: [DOM], arrange: () => { price(75_000); createSignal.mockResolvedValue({ ok: false, errorCode: 'duplicate_active_signal', error: 'dup', signalId: 55 }); }, expect: { [DOM]: ['skip_policy', 'duplicate_active_signal'] } },
  { name: 'policy_blacklist', market: 'domestic', symbols: [DOM], arrange: () => { price(60_000); createSignal.mockResolvedValue({ ok: false, errorCode: 'symbol_blacklisted', error: 'blk' }); }, expect: { [DOM]: ['skip_policy', 'symbol_blacklisted'] } },
  { name: 'create_failed', market: 'domestic', symbols: [DOM], arrange: () => { price(60_000); createSignal.mockResolvedValue({ ok: false, error: 'insert failed' }); }, expect: { [DOM]: ['error', 'exit_create_failed'] } },
  { name: 'create_throws', market: 'domestic', symbols: [DOM], arrange: () => { price(60_000); createSignal.mockRejectedValue(new Error('ER_LOCK_DEADLOCK')); }, expect: { [DOM]: ['error', 'exit_create_failed'] } },
  { name: 'eod_fired', market: 'domestic', at: EOD_KST, symbols: [DOM], arrange: () => price(68_000), expect: { [DOM]: ['fired', 'signal_created'] } },
  { name: 'overseas_fired', market: 'overseas', symbols: [OVS], arrange: () => price(60_000), expect: { [OVS]: ['fired', 'signal_created'] } },
  {
    name: 'multi', market: 'domestic', symbols: ['005930', '000660', '035720'],
    arrange: () => {
      getTicker.mockImplementation(async (s: string) => {
        if (s === '000660') throw new Error('timeout');
        return { price: s === '035720' ? 60_000 : ENTRY, open24h: ENTRY, timestamp: 0, symbol: s };
      });
    },
    expect: { '005930': ['no_fire', 'exit_no_fire'], '000660': ['error', 'exit_ticker_error'], '035720': ['fired', 'signal_created'] },
  },
];

/** 설계 D1 표 — 결론 코드 → decision */
const D1: Record<string, ExitDecision> = {
  exit_no_fire: 'no_fire',
  exit_engine_disabled: 'skip_policy', exit_hard_stop_disabled: 'skip_policy',
  quantity_below_min: 'skip_policy', duplicate_active_signal: 'skip_policy', symbol_blacklisted: 'skip_policy',
  insufficient_cash: 'skip_policy', validation_gate: 'skip_policy',
  cooldown_exit: 'skip_cooldown',
  signal_created: 'fired',
  exit_avg_price_missing: 'error', exit_ticker_error: 'error', exit_price_invalid: 'error', exit_state_upsert_failed: 'error',
  exit_state_missing: 'error', exit_unit_mismatch: 'error', exit_create_failed: 'error',
};

// ─── 기록 모드 ───────────────────────────────────────────────────────────────
type Mode =
  | 'no_recorder' | 'switch_missing' | 'switch_false' | 'switch_read_error' | 'switch_read_hang' | 'on_ok' | 'on_no_table'
  | 'on_check_fail' | 'on_insert_hang' | 'collector_throws' | 'open_throws';
const MODES: Mode[] = ['switch_missing', 'switch_false', 'switch_read_error', 'switch_read_hang', 'on_ok', 'on_no_table', 'on_check_fail', 'on_insert_hang', 'collector_throws', 'open_throws'];
const ON = [{ value: 'true' }];

function applyMode(mode: Mode): { release: () => void; hang?: Deferred<unknown> } {
  switch (mode) {
    case 'no_recorder': mOpen.mockImplementation(() => ({ add: () => {}, flushDetached: () => {} })); return { release: () => {} };
    case 'switch_missing': db.recordSwitch = []; return { release: () => {} };
    case 'switch_false': db.recordSwitch = [{ value: 'false' }]; return { release: () => {} };
    case 'switch_read_error': db.recordSwitch = Object.assign(new Error('gone'), { errno: 2013 }); return { release: () => {} };
    case 'switch_read_hang': { const d = deferred<unknown>(); db.recordSwitch = d; return { release: () => d.resolve(ON), hang: d }; }
    case 'on_ok': db.recordSwitch = ON; return { release: () => {} };
    case 'on_no_table': db.recordSwitch = ON; db.insert = Object.assign(new Error('no table'), { errno: 1146 }); return { release: () => {} };
    case 'on_check_fail': db.recordSwitch = ON; db.insert = Object.assign(new Error('Check constraint'), { errno: 4025 }); return { release: () => {} };
    case 'on_insert_hang': { db.recordSwitch = ON; const d = deferred<unknown>(); db.insert = d; return { release: () => d.resolve({ affectedRows: 1 }), hang: d }; }
    case 'collector_throws':
      mOpen.mockImplementation(() => ({ add: () => { throw new Error('collector add exploded'); }, flushDetached: () => { throw new Error('collector flush exploded'); } }));
      return { release: () => {} };
    case 'open_throws': mOpen.mockImplementation(() => { throw new Error('collector open exploded'); }); return { release: () => {} };
  }
}

/** 엔진이 기록을 기다리지 않는지 — 1.5초 안에 끝나야 한다(기록기 상한 4초·스위치 2초보다 짧게). */
async function runBounded<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const out = await Promise.race([p.then((v) => ({ v })), new Promise<'late'>((r) => { timer = setTimeout(() => r('late'), 1500); })]);
  clearTimeout(timer);
  if (out === 'late') throw new Error('엔진이 1.5초 안에 끝나지 않았다 — 기록을 기다리고 있다');
  return out.v;
}

let recordSpy: jest.SpyInstance;
function resetAll() {
  jest.clearAllMocks();
  calls.length = 0;
  connEvents.length = 0;
  db.exitEngineEnabled = 'true';
  db.exitHardStopEnabled = null;
  db.exitSwitchError = false;
  db.recordSwitch = [];
  db.insert = [{ affectedRows: 1 }];
  cooldownState.active = false;
  mOpen.mockImplementation((...a: unknown[]) => (actualOpen as (...x: unknown[]) => unknown)(...a));
  resetHeldUnknownState();
  resetRecordSwitchCacheForTest();
  resetExitJudgmentForTest();
  __resetPruneTimer();
  upsertPositionState.mockResolvedValue(undefined);
  reconcilePositionState.mockResolvedValue(0);
  loadPositionState.mockImplementation(async (s: string, m: Market) => positionState(s, m));
  createSignal.mockResolvedValue({ ok: true, signalId: 777, autoSubmitted: true });
  setCooldown.mockResolvedValue(true);
  price(ENTRY);
}

const isRecorderLog = (s: string) => s.startsWith('[strategy/records/');
function engineView(result: unknown) {
  const logs = (k: 'log' | 'warn' | 'error') => (console[k] as unknown as jest.Mock).mock.calls.map((c) => c.map(String).join(' ')).filter((s) => !isRecorderLog(s));
  return JSON.parse(JSON.stringify({
    result,
    funnel: recordSpy.mock.calls.map((c) => c[0]),
    createSignal: createSignal.mock.calls,
    setCooldown: setCooldown.mock.calls,
    upsert: upsertPositionState.mock.calls,
    reconcile: reconcilePositionState.mock.calls,
    load: loadPositionState.mock.calls,
    ticker: getTicker.mock.calls,
    alerts: sendAlertThrottled.mock.calls,
    alert: sendAlert.mock.calls,
    log: logs('log'),
    warn: logs('warn'),
    error: logs('error'),
    engineSql: calls.filter((c) => !isRecordIo(c)),
  }));
}

async function observe(scene: Scene, mode: Mode) {
  resetAll();
  jest.setSystemTime(scene.at ?? SAFE_KST);
  getBalancesDetailed.mockResolvedValue(balances(scene.symbols.map((symbol) => ({ symbol }))));
  scene.arrange();
  const { release, hang } = applyMode(mode);
  const result = await runBounded(runAll({ market: scene.market }));
  const view = engineView(result);
  // 매달린 기록: 엔진이 돌아온 시점에 끝나지 않았고(기다리지 않았다), 그 뒤에 나간 문장이 풀어 줄 때까지 매달려 있다.
  // (분리 실행은 다음 마이크로태스크에서 시작하므로 엔진이 돌아온 시점에는 INSERT 가 아직 안 나갔을 수도 있다 — 나간 뒤를 기다려 본다.)
  let hangAtReturn: { settledAtReturn: boolean; issuedLater: boolean; settledBeforeRelease: boolean } | null = null;
  if (hang) {
    const settledAtReturn = hang.settled;
    const isHung = mode === 'on_insert_hang' ? isRecordInsert : isRecordSwitchRead;
    for (let i = 0; i < 100 && !calls.some(isHung); i++) await new Promise((r) => setImmediate(r));
    hangAtReturn = { settledAtReturn, issuedLater: calls.some(isHung), settledBeforeRelease: hang.settled };
  }
  release();
  const records = await waitForExitJudgmentRecordsForTest();
  return { view, records, hangAtReturn, recordCalls: calls.filter(isRecordIo), connEvents: [...connEvents] };
}

/** INSERT 1문장의 값 → 행(열 이름 키). */
function insertedRows(c: { params: unknown[] }): Array<Record<string, unknown>> {
  const n = EXIT_JUDGMENT_COLUMNS.length;
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < c.params.length; i += n) out.push(Object.fromEntries(EXIT_JUDGMENT_COLUMNS.map((k, j) => [k, c.params[i + j]])));
  return out;
}

beforeAll(() => {
  // Date 만 고정한다 — 타이머는 실물(기록기·스위치 상한, 1.5초 경주)
  jest.useFakeTimers({
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback',
      'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
});
afterAll(() => { jest.useRealTimers(); });
beforeEach(() => {
  recordSpy = jest.spyOn(EvalFunnelRecorder.prototype, 'record');
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); });

// ═════════════════════════════════════════════════════════════════════════════
describe('① 정적 — 엔진 소스의 결론 지점 ↔ 기록 호출 1:1 (설계 D1)', () => {
  const src = readFileSync(join(ROOT, 'src/lib/strategy/engine.ts'), 'utf8');
  const start = src.indexOf('async function runExitEngine(');
  const end = src.indexOf('return { created, enabled: exitSwitch.enabled, blocked, switchSource: exitSwitch.source };', start);
  const body = src.slice(start, end);
  const loopStart = body.indexOf('  for (const symbol of heldSymbols) {');
  const flushAt = body.indexOf('  flushExitJudgment(exitJudg);');
  const loop = body.slice(loopStart, flushAt);
  const NOTE_RE = /noteExitJudgment\(exitJudg, '([a-z_]+)', (?:'([a-z_]+)'|(res\.recordedGate)), \{ ([^}]*) \}\);/g;
  const notes = [...loop.matchAll(NOTE_RE)].map((m) => ({ decision: m[1], code: m[2] ?? m[3], input: m[4], at: m.index! }));
  const recCalls = [...loop.matchAll(/rec\.(error|skip|pass)\('([a-z_]+)'/g)].map((m) => ({ gate: m[2], at: m.index! }));

  test('구조 — 수집기 열기 1회(루프 바로 앞)·flush 1회(루프 뒤, 미리보기 요약 앞)·기다림 없음', () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(body.match(/openExitJudgment\(/g)).toHaveLength(1);
    expect(body).toContain('  const exitJudg = openExitJudgment(market, rec, exitSwitch, style);\n  for (const symbol of heldSymbols) {\n');
    expect(body.match(/flushExitJudgment\(/g)).toHaveLength(1);
    expect(flushAt).toBeGreaterThan(loopStart);
    expect(body.indexOf('  if (preview) {\n    try {\n      void preview.finish()')).toBeGreaterThan(flushAt);
    // 루프가 닫힌 바로 뒤(주석 한 줄 다음)가 flush 다
    expect(body).toContain('      console.warn(`[exit-engine] ${symbol} ${exitSig.exitKind} 시그널 실패: ${res.error}`);\n    }\n  }\n\n'
      + '  // T-126 — 모은 청산 판단 기록을 분리 실행으로 시작만 한다(기다리지 않음·반환값 없음·절대 던지지 않음). 스위치 읽기도 그 안에서만.\n'
      + '  flushExitJudgment(exitJudg);\n');
    expect(body).not.toMatch(/await\s+(noteExitJudgment|flushExitJudgment|openExitJudgment)/);
    // exitJudg 는 기록 호출에만 쓰인다(열기 1 + 기록 13 + flush 1) — 평가 조건·반환값에 섞이지 않는다
    expect(src.match(/\bexitJudg\b/g)).toHaveLength(15);
  });

  test('세 격리 래퍼 — 본문 전체가 try/catch, 평가에 쓰는 값을 돌려주지 않는다', () => {
    expect(src).toContain('  try { return openExitJudgmentCollector(market, rec, exitSwitch, style); } catch { return null; }\n}');
    expect(src).toContain('  try { c?.add(decision, code, input); } catch { /* 관찰 전용 — 평가 영향 0 */ }\n}');
    expect(src).toContain('  try { c?.flushDetached(); } catch { /* 관찰 전용 — 평가 영향 0 */ }\n}');
    expect(src.match(/openExitJudgmentCollector\(/g)).toHaveLength(1);
  });

  test('🔴 루프 안 청산 트랙 rec 게이트 = 11개, 게이트마다 바로 뒤 기록 호출 정확히 1개(사이에 continue·await·다른 rec 호출 없음)', () => {
    expect(recCalls.map((r) => r.gate).sort()).toEqual([
      'cooldown_exit', 'exit_avg_price_missing', 'exit_create_failed', 'exit_engine_disabled', 'exit_hard_stop_disabled', 'exit_no_fire',
      'exit_price_invalid', 'exit_state_missing', 'exit_state_upsert_failed', 'exit_ticker_error', 'exit_unit_mismatch',
    ]);
    for (const r of recCalls) {
      const mine = notes.filter((n) => n.code === r.gate);
      expect([r.gate, mine.length]).toEqual([r.gate, 1]);
      const n = mine[0];
      expect(n.at).toBeGreaterThan(r.at);
      const between = loop.slice(r.at, n.at);
      expect([r.gate, /\bcontinue\b|\bawait\b|rec\.(error|skip|pass|record)\(/.test(between.slice(4))]).toEqual([r.gate, false]);
    }
  });

  test('시그널 생성 성공·정책 스킵 지점 — 각 1개, 위치 고정', () => {
    expect(notes.filter((n) => n.code === 'signal_created')).toHaveLength(1);
    expect(notes.filter((n) => n.code === 'res.recordedGate')).toHaveLength(1);
    expect(notes).toHaveLength(recCalls.length + 2);
    expect(loop).toContain("    const res = await createSignalGuarded(exitSig, rec);\n    if (res.ok) {\n      created++;\n      noteExitJudgment(exitJudg, 'fired', 'signal_created', ");
    const skipBranch = loop.slice(loop.indexOf("} else if (res.recordedVerdict === 'skip') {"), loop.lastIndexOf('    } else {'));
    expect(skipBranch.match(/noteExitJudgment\(/g)).toHaveLength(1);
    expect(skipBranch).toContain("noteExitJudgment(exitJudg, 'skip_policy', res.recordedGate, ");
  });

  test('🔴 결론(decision) = 설계 D1 표', () => {
    for (const n of notes) {
      const want = n.code === 'res.recordedGate' ? 'skip_policy' : D1[n.code];
      expect([n.code, n.decision]).toEqual([n.code, want]);
    }
  });

  test('기록 입력은 그 지점의 기존 지역 변수만(새 계산·새 조회 없음)', () => {
    const allowed = new Set(['symbol', 'entry', 'ticker', 'state', 'exitSig', 'signalId: res.signalId']);
    for (const n of notes) for (const f of n.input.split(',').map((x) => x.trim())) expect([n.code, allowed.has(f)]).toEqual([n.code, true]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('① 동적 — 경로마다 보유 종목당 1행, 코드 = 그 종목의 eval_funnel 게이트', () => {
  const seenCodes = new Set<string>();
  test.each(SCENES.map((s) => [s.name, s] as const))('%s', async (_n, scene) => {
    const o = await observe(scene, 'on_ok');
    expect(o.records).toEqual([expect.objectContaining({ status: 'written', rows: scene.symbols.length, dropped: 0 })]);
    const ins = o.recordCalls.filter(isRecordInsert);
    expect(ins).toHaveLength(1);
    const rows = insertedRows(ins[0]);
    expect(rows.map((r) => r.symbol)).toEqual(scene.symbols);   // 종목당 정확히 1행, 루프 순서
    for (const r of rows) {
      const [decision, code] = scene.expect[String(r.symbol)];
      expect([r.symbol, r.decision, r.decision_code]).toEqual([r.symbol, decision, code]);
      seenCodes.add(String(r.decision_code));
      // 그 종목의 eval_funnel 게이트(청산 트랙 + stage 11 생성 게이트) 중 마지막 = 결론 코드(생성 실패는 exit_create_failed 가 뒤에 붙는다)
      const gates = (o.view.funnel as Array<{ gate: string; symbol?: string }>).filter((f) => f.symbol === r.symbol).map((f) => f.gate);
      expect(gates[gates.length - 1]).toBe(code);
      expect(r.run_id).toBe(`${scene.market}-${scene.at === EOD_KST ? '202608051525' : '202608051000'}`);
      expect(r.market).toBe(scene.market);
      expect('dry_run' in r).toBe(false);
    }
  });

  test('장면 합집합 = 정적 결론 코드 전부(정책 스킵 3종 포함)', () => {
    expect([...seenCodes].sort()).toEqual([
      'cooldown_exit', 'duplicate_active_signal', 'exit_avg_price_missing', 'exit_create_failed', 'exit_engine_disabled', 'exit_hard_stop_disabled',
      'exit_no_fire', 'exit_price_invalid', 'exit_state_missing', 'exit_state_upsert_failed', 'exit_ticker_error', 'exit_unit_mismatch',
      'quantity_below_min', 'signal_created', 'symbol_blacklisted',
    ]);
  });

  test('행 값 — 발화(국내 손실한도 손절): 가격·손익률·임계·스위치·signal_id·시각', async () => {
    const o = await observe(SCENES.find((s) => s.name === 'fired')!, 'on_ok');
    expect(insertedRows(o.recordCalls.find(isRecordInsert)!)[0]).toEqual({
      run_id: 'domestic-202608051000', evaluated_at: '2026-08-05 10:00:00', session_date_kst: '2026-08-05', session_date_et: null, market: 'domestic',
      symbol: '005930', position_qty: 10, entry_price: 70000, peak_price: 70000, price: 60000, currency: 'KRW', pnl_pct: -14.2857,
      trigger_kind: 'hard_stop', threshold_pct: -5, decision: 'fired', decision_code: 'signal_created', exit_engine_enabled: 1,
      exit_hard_stop_enabled: 1, signal_id: 777, engine_release: null,
    });
  });

  test('행 값 — 장마감 전 손절 발화(임계 −eodLossCutPct)·해외 발화(ET 날짜·KRW)·마스터 OFF·스위치 조회 실패(NULL)', async () => {
    const eod = insertedRows((await observe(SCENES.find((s) => s.name === 'eod_fired')!, 'on_ok')).recordCalls.find(isRecordInsert)!)[0];
    expect(eod).toMatchObject({ trigger_kind: 'eod_loss_cut', threshold_pct: -2, pnl_pct: -2.8571, evaluated_at: '2026-08-05 15:25:00' });
    const ovs = insertedRows((await observe(SCENES.find((s) => s.name === 'overseas_fired')!, 'on_ok')).recordCalls.find(isRecordInsert)!)[0];
    expect(ovs).toMatchObject({ market: 'overseas', symbol: 'NAS:MU', session_date_et: '2026-08-04', currency: 'KRW', trigger_kind: 'hard_stop' });
    const off = insertedRows((await observe(SCENES.find((s) => s.name === 'engine_disabled')!, 'on_ok')).recordCalls.find(isRecordInsert)!)[0];
    expect(off).toMatchObject({ exit_engine_enabled: 0, exit_hard_stop_enabled: 1, trigger_kind: 'hard_stop', pnl_pct: -14.2857, signal_id: null });
    const dbErr = insertedRows((await observe(SCENES.find((s) => s.name === 'switch_db_error')!, 'on_ok')).recordCalls.find(isRecordInsert)!)[0];
    expect(dbErr).toMatchObject({ exit_engine_enabled: null, exit_hard_stop_enabled: null, decision: 'skip_policy' });   // 조회 실패 틱 — 0/1 로 단정하지 않는다
    const mm = insertedRows((await observe(SCENES.find((s) => s.name === 'unit_mismatch')!, 'on_ok')).recordCalls.find(isRecordInsert)!)[0];
    expect(mm).toMatchObject({ price: 98000, entry_price: 71.2, currency: null, pnl_pct: null, trigger_kind: 'none' });
  });

  test('보유 0종목·잔고 미확인 틱은 행이 없다(I/O 0)', async () => {
    resetAll();
    jest.setSystemTime(SAFE_KST);
    db.recordSwitch = ON;
    getBalancesDetailed.mockResolvedValue(balances([]));
    await runAll({ market: 'domestic' });
    getBalancesDetailed.mockResolvedValue({ balances: [], ok: ['overseas'], failed: [{ market: 'domestic', error: 'EGW00201' }], complete: false });
    await runAll({ market: 'domestic' });
    expect(await waitForExitJudgmentRecordsForTest()).toEqual([]);
    expect(calls.filter(isRecordIo)).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe.each(SCENES.map((s) => [s.name, s] as const))('② 🔴 영향 0 (%s) — 기록 상태와 무관하게 엔진 관찰값이 같다', (_n, scene) => {
  let baseline: Awaited<ReturnType<typeof observe>>;
  beforeAll(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    recordSpy = jest.spyOn(EvalFunnelRecorder.prototype, 'record');
    baseline = await observe(scene, 'no_recorder');
    jest.restoreAllMocks();
  });

  test.each(MODES)('%s', async (mode) => {
    const o = await observe(scene, mode);
    expect(o.view).toEqual(baseline.view);
    if (mode === 'on_insert_hang' || mode === 'switch_read_hang') expect(o.hangAtReturn).toEqual({ settledAtReturn: false, issuedLater: true, settledBeforeRelease: false });
    const ins = o.recordCalls.filter(isRecordInsert);
    const reads = o.recordCalls.filter(isRecordSwitchRead);
    if (['switch_missing', 'switch_false', 'switch_read_error'].includes(mode)) { expect(reads).toHaveLength(1); expect(ins).toHaveLength(0); }
    if (['on_ok', 'on_no_table', 'on_check_fail', 'on_insert_hang', 'switch_read_hang'].includes(mode)) { expect(reads).toHaveLength(1); expect(ins).toHaveLength(1); }
    if (['collector_throws', 'open_throws'].includes(mode)) expect(o.recordCalls).toEqual([]);
    // 🔴 R1 — 받은 연결은 하나도 빠짐없이 release 또는 destroy 로 끝난다(누수 0). INSERT 를 보낸 모드만 연결을 받는다.
    const acq = o.connEvents.filter((e) => e === 'acquire').length;
    expect(acq).toBe(ins.length);
    expect(o.connEvents.filter((e) => e !== 'acquire').length).toBe(acq);
    if (mode === 'on_ok' || mode === 'on_insert_hang' || mode === 'switch_read_hang') expect(o.connEvents).toEqual(['acquire', 'release']);
    if (mode === 'on_no_table' || mode === 'on_check_fail') expect(o.connEvents).toEqual(['acquire', 'destroy']);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('③ 기록 결과 — 실패는 기록 쪽에서만 끝난다', () => {
  const fired = SCENES.find((s) => s.name === 'fired')!;
  test('스위치 꺼짐 → disabled(INSERT 0) · 테이블 없음 → no_table · CHECK 위반 → error(분류어) · 무한 대기 → 풀린 뒤 written', async () => {
    expect((await observe(fired, 'switch_missing')).records).toEqual([{ status: 'disabled' }]);
    expect((await observe(fired, 'on_no_table')).records).toEqual([expect.objectContaining({ status: 'no_table' })]);
    expect((await observe(fired, 'on_check_fail')).records).toEqual([expect.objectContaining({ status: 'error', reason: 'check_violation errno=4025' })]);
    expect((await observe(fired, 'on_insert_hang')).records).toEqual([expect.objectContaining({ status: 'written', rows: 1 })]);
    expect((await observe(fired, 'no_recorder')).records).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ④ 변경 전 엔진과의 동일 출력 — 파일로만 남긴다(비교는 스크립트). 환경변수가 없으면 건너뛴다.
const DUMP = process.env.T126_EQUIV_DUMP;
(DUMP ? describe : describe.skip)('④ 장면별 관찰값 덤프(변경 전·후 비교용)', () => {
  test('dump', async () => {
    const mode = (process.env.T126_EQUIV_MODE ?? 'on_ok') as Mode;
    const out: Record<string, unknown> = {};
    for (const s of SCENES) out[s.name] = (await observe(s, mode)).view;
    writeFileSync(DUMP!, JSON.stringify(out, null, 1));
  });
});

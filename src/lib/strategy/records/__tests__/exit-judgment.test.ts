/**
 * T-126 — 청산 판단 기록기(`exit-judgment.ts`) 단위 시험. DB 는 SQL 로 갈라 답하는 목(운영 DB·`.env` 접근 없음).
 *
 *  A. 열·어휘가 DDL(`scripts/migrations/T-126-exit-judgment.sql`)과 같다(열 순서·길이·ENUM)
 *  B. 행 빌더 — 값 규칙(진입가 출처·손익률 단위 범위·통화·임계·스위치 열·signal_id), 경계(절단·거부·반올림), 형식 밖 입력은
 *     행을 버리되 **던지지 않는다**(적대적 getter 포함)
 *  C. 🔴 임계(threshold_pct)는 `evaluateExit` 가 실제로 쓴 값이다 — 소스 줄 고정 + 무작위 입력 대조(추측 금지)
 *  D. 🔴 통화(currency) 근거 — 해외 시세·평단을 어댑터가 원화로 바꾼다는 소스 줄 고정(바뀌면 이 시험이 먼저 깨진다)
 *  E. 엔진 릴리스 이름 = T-112 판단 기록기의 규칙과 같다
 *  F. 수집기 — push 만·상한·flush 1회·적대적 입력·열기 실패 → 아무것도 안 하는 수집기, I/O 는 분리 실행 안에서만
 *  G. 기록 1회 — 스위치 꺼짐 = INSERT 0 · 테이블 없음 = 프로세스당 경고 1줄 · CHECK 위반 · 시간 초과 · 경고에 종목·금액·DB 원문 없음
 *  H. 🔴 (Reviewer R1) 연결 처리 — INSERT 는 풀에서 받은 연결로만 보내고, 정상 = release 1 · 오류 = destroy 1 · 상한 초과 = **상한 시점에** destroy ·
 *     상한 뒤에 받은 연결은 쓰지 않고 release · 연결 받기 실패 = INSERT 0 (실 풀·잠긴 표 재현은 일회용 MariaDB 시험 C)
 *     (T-139) 기록 스위치 읽기(`record-switch.ts`)도 풀에서 **자기** 연결을 받는다 — 그 연결은 처음 보낸 문장(스위치 SELECT)으로 가려 따로 세고
 *     (읽은 뒤 release 1), INSERT 연결의 단언(받은 수·release·destroy)은 예전 값 그대로 INSERT 쪽 연결만 센다.
 *  (Reviewer R3) 행 상한 100 은 리터럴로 고정한다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const queryMock = jest.fn();
/** INSERT 쪽 연결(스위치 SELECT 를 보내지 않은 연결 — 문장 없이 끝난 늦은 연결 포함)의 release·destroy. */
const releaseMock = jest.fn();
const destroyMock = jest.fn();
/** (T-139) 기록 스위치 SELECT 를 보낸 연결의 release·destroy — INSERT 연결과 섞지 않는다. */
const swReleaseMock = jest.fn();
const swDestroyMock = jest.fn();
/** 풀에서 받은 연결 — 받을 때마다 새 연결(운영 mysql2 와 같게). 문장은 queryMock 으로 보내고(기존 단언 그대로), 끝은 처음 보낸 문장으로 갈라 센다. */
interface FakeConn { query: (...a: unknown[]) => unknown; release: () => void; destroy: () => void; isSwitch: () => boolean }
const conns: FakeConn[] = [];
function newConn(): FakeConn {
  let first: { sql: string; params?: unknown[] } | null = null;
  const isSwitch = () => first !== null && isSwitchRead(first.sql, first.params);
  const c: FakeConn = {
    query: (...a: unknown[]) => { if (!first) first = { sql: String(a[0]), params: a[1] as unknown[] | undefined }; return queryMock(...a); },
    release: () => { if (isSwitch()) swReleaseMock(); else releaseMock(); },
    destroy: () => { if (isSwitch()) swDestroyMock(); else destroyMock(); },
    isSwitch,
  };
  conns.push(c);
  return c;
}
const getConnectionMock = jest.fn(async () => newConn());
const getPoolMock = jest.fn(() => ({ query: queryMock, getConnection: getConnectionMock }));
/** INSERT 쪽 연결 수(받은 연결 중 스위치 SELECT 연결이 아닌 것). */
const insertConnCount = () => conns.filter((c) => !c.isSwitch()).length;
/** (T-139) 스위치 연결의 [받은 수, release, destroy]. */
const swEnds = () => [conns.filter((c) => c.isSwitch()).length, swReleaseMock.mock.calls.length, swDestroyMock.mock.calls.length];
/** (T-139) 기록 1회는 스위치 읽기(캐시 비움) → INSERT 순서다 — 첫 연결 받기(스위치)는 정상으로 두고 그 뒤(INSERT)만 impl 로 바꾼다.
 *  첫 연결이 정말 스위치 SELECT 에 쓰였는지는 각 시험이 swEnds() 로 확인한다. */
function insertConnWith(impl: () => Promise<FakeConn>): void {
  getConnectionMock.mockImplementation(impl);
  getConnectionMock.mockImplementationOnce(async () => newConn());
}
jest.mock('@/lib/db', () => ({ getPool: () => getPoolMock() }));
// T-112 판단 기록기의 engineReleaseFromCwd 와 대조하려고 불러온다 — 그 모듈의 LLM 설정 의존은 목으로 막는다.
jest.mock('@/lib/llm/provider', () => ({ getProviderConfig: jest.fn() }));

import {
  EXIT_DECISIONS,
  EXIT_JUDGMENT_COLUMNS,
  EXIT_JUDGMENT_COLUMN_LIMITS,
  EXIT_JUDGMENT_MAX_ABS_AMOUNT,
  EXIT_JUDGMENT_RECORD_SWITCH_KEY,
  EXIT_JUDGMENT_RECORD_TIMEOUT_MS,
  EXIT_TRIGGER_KINDS,
  MAX_EXIT_JUDGMENT_ROWS,
  appliedThresholdPct,
  buildExitJudgmentInsert,
  buildExitJudgmentRow,
  classifyExitJudgmentError,
  decimalOrNull,
  exitEngineReleaseFromCwd,
  openExitJudgmentCollector,
  recordExitJudgments,
  resetExitJudgmentForTest,
  waitForExitJudgmentRecordsForTest,
  type ExitJudgmentContext,
  type ExitJudgmentRow,
} from '../exit-judgment';
import { RECORD_SWITCH_KEYS, resetRecordSwitchCacheForTest } from '../record-switch';
import { SYMBOL_MAX } from '../safe-text';
import { engineReleaseFromCwd } from '../judgment-recorder';
import { evaluateExit, EXIT_UNIT_RATIO_MAX, EXIT_UNIT_RATIO_MIN, type ExitKind } from '../../exit-engine';
import type { StyleConfig } from '../../style';
import type { PositionState } from '../../position-state';

const ROOT = join(__dirname, '..', '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const DDL = read('scripts/migrations/T-126-exit-judgment.sql');

const STYLE = { eodLossCutPct: 1.5, hardStopPct: 1.5, targetProfitPct: 2.5 };
/** 2026-10-30 10:00:07 KST(목) — 장마감 전 손절 창 밖. ET 날짜는 10-29. */
const T_KST = Date.parse('2026-10-30T10:00:07+09:00');

function ctx(over: Partial<ExitJudgmentContext> = {}): ExitJudgmentContext {
  return {
    market: 'overseas',
    runId: 'overseas-202610301000',
    exitSwitch: { enabled: true, hardStopEnabled: false, source: 'config' },
    style: STYLE,
    ...over,
  };
}
const ENTRY = { qty: 3, avgPrice: 100_000 };
const STATE = { entryPrice: 100_000, peakPrice: 104_000, scenarioExit: null };

// ── DB 목 ──────────────────────────────────────────────────────────────────
type Answer = unknown[] | Error | Promise<unknown>;
const db: { recordSwitch: Answer; insert: Answer } = { recordSwitch: [], insert: [{ affectedRows: 1 }] };
const isSwitchRead = (sql: string, params?: unknown[]) => sql === 'SELECT value FROM system_config WHERE `key` = ? LIMIT 1' && params?.[0] === EXIT_JUDGMENT_RECORD_SWITCH_KEY;
function answer(a: Answer): Promise<unknown> {
  if (a instanceof Error) return Promise.reject(a);
  if (a instanceof Promise) return a;
  return Promise.resolve([a, []]);
}
function arrangeDb() {
  queryMock.mockImplementation((sql: string, params?: unknown[]) => {
    if (isSwitchRead(sql, params)) return answer(db.recordSwitch);
    if (sql.startsWith('INSERT INTO exit_judgment')) return answer(db.insert);
    return Promise.resolve([[], []]);
  });
}
const inserts = () => queryMock.mock.calls.filter((c) => String(c[0]).startsWith('INSERT INTO exit_judgment'));
const switchReads = () => queryMock.mock.calls.filter((c) => isSwitchRead(String(c[0]), c[1] as unknown[]));
const warns = () => (console.warn as jest.Mock).mock.calls.map((c) => c.map(String).join(' '));
/** 이 모듈의 경고만(스위치 모듈 경고는 T-112 의 기존 동작이라 따로 본다). */
const ownWarns = () => warns().filter((w) => w.startsWith('[strategy/records/exit-judgment]'));
const ON = [{ value: 'true' }];

beforeEach(() => {
  queryMock.mockReset();
  releaseMock.mockReset();
  destroyMock.mockReset();
  swReleaseMock.mockReset();
  swDestroyMock.mockReset();
  conns.length = 0;
  getConnectionMock.mockReset();
  getConnectionMock.mockImplementation(async () => newConn());
  getPoolMock.mockClear();
  getPoolMock.mockImplementation(() => ({ query: queryMock, getConnection: getConnectionMock }));
  db.recordSwitch = [];
  db.insert = [{ affectedRows: 1 }];
  arrangeDb();
  resetRecordSwitchCacheForTest();
  resetExitJudgmentForTest();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('A. 열·어휘 = DDL', () => {
  const body = DDL.slice(DDL.indexOf('CREATE TABLE IF NOT EXISTS exit_judgment ('), DDL.indexOf(') ENGINE=InnoDB'));
  const colDefs = body.split('\n').map((l) => /^ {2}([a-z_]+)\s+(.+?)(?:\s+--.*)?$/.exec(l)).filter((m): m is RegExpExecArray => !!m)
    .filter((m) => !['KEY', 'CONSTRAINT'].includes(m[1].toUpperCase()) && m[1] !== 'judgment_id');
  test('INSERT 열 순서 = DDL 열 순서(judgment_id 제외)', () => {
    expect(colDefs.map((m) => m[1])).toEqual([...EXIT_JUDGMENT_COLUMNS]);
  });
  test('문자열 열 길이 = 앱 절단 상한', () => {
    const len = (c: string) => Number(/VARCHAR\((\d+)\)/.exec(colDefs.find((m) => m[1] === c)![2])![1]);
    expect(len('run_id')).toBe(EXIT_JUDGMENT_COLUMN_LIMITS.run_id);
    expect(len('symbol')).toBe(EXIT_JUDGMENT_COLUMN_LIMITS.symbol);
    expect(len('decision_code')).toBe(EXIT_JUDGMENT_COLUMN_LIMITS.decision_code);
    expect(len('engine_release')).toBe(EXIT_JUDGMENT_COLUMN_LIMITS.engine_release);
    expect(EXIT_JUDGMENT_COLUMN_LIMITS.symbol).toBe(SYMBOL_MAX);   // normalizeSymbol 의 거부 상한과 같다
  });
  test('ENUM 어휘 = 앱 어휘', () => {
    const enumOf = (c: string) => [...colDefs.find((m) => m[1] === c)![2].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(enumOf('decision')).toEqual([...EXIT_DECISIONS]);
    expect(enumOf('trigger_kind')).toEqual([...EXIT_TRIGGER_KINDS, 'none']);   // 마지막 'none' 은 DEFAULT
    expect(enumOf('market')).toEqual(['domestic', 'overseas']);
  });
  test('가상 주문(DRY_RUN) 열은 없다 — 청산 틱은 읽지 않는 값(Leader 결정 2026-10-31), 열 20개', () => {
    expect(EXIT_JUDGMENT_COLUMNS).toHaveLength(20);
    expect(EXIT_JUDGMENT_COLUMNS as readonly string[]).not.toContain('dry_run');
    expect(body).not.toMatch(/\bdry_run\b/i);
    const row = buildExitJudgmentRow(ctx(), 'fired', 'signal_created', { symbol: 'NAS:MU' }, T_KST)!;
    expect(Object.keys(row).sort()).toEqual(EXIT_JUDGMENT_COLUMNS.filter((c) => c !== 'engine_release').slice().sort());
  });
  test('기록 스위치 키가 record-switch 허용 목록에 있다(기존 두 키 그대로)', () => {
    expect(RECORD_SWITCH_KEYS).toEqual(['job_run_log_enabled', 'judgment_record_enabled', 'exit_judgment_record_enabled']);
    expect(EXIT_JUDGMENT_RECORD_SWITCH_KEY).toBe('exit_judgment_record_enabled');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('B. 행 빌더', () => {
  test('발화(해외) — 시각·날짜·값·통화·손익률·임계·스위치·signal_id', () => {
    const r = buildExitJudgmentRow(ctx({ exitSwitch: { enabled: true, hardStopEnabled: true, source: 'config' } }), 'fired', 'signal_created', {
      symbol: 'NAS:MU', entry: ENTRY, ticker: { price: 98_123.456789123 }, state: STATE, exitSig: { exitKind: 'hard_stop' }, signalId: 19743,
    }, T_KST);
    expect(r).toEqual<ExitJudgmentRow>({
      run_id: 'overseas-202610301000', evaluated_at: '2026-10-30 10:00:07', session_date_kst: '2026-10-30', session_date_et: '2026-10-29',
      market: 'overseas', symbol: 'NAS:MU', position_qty: 3, entry_price: 100000, peak_price: 104000, price: 98123.45678912, currency: 'KRW',
      pnl_pct: -1.8765, trigger_kind: 'hard_stop', threshold_pct: -1.5, decision: 'fired', decision_code: 'signal_created',
      exit_engine_enabled: 1, exit_hard_stop_enabled: 1, signal_id: 19743,
    });
  });

  test('국내 — ET 날짜 없음, 통화 KRW(가격이 없어도)', () => {
    const r = buildExitJudgmentRow(ctx({ market: 'domestic', runId: 'domestic-202610301000' }), 'error', 'exit_ticker_error', { symbol: '005930', entry: ENTRY }, T_KST)!;
    expect(r).toMatchObject({ market: 'domestic', session_date_et: null, currency: 'KRW', price: null, entry_price: 100000, peak_price: null, pnl_pct: null, trigger_kind: 'none', threshold_pct: null });
  });

  test('해외 — 시세가 없거나 단위 검사 범위 밖이면 통화·손익률 NULL(원값 가격은 그대로)', () => {
    const noPrice = buildExitJudgmentRow(ctx(), 'error', 'exit_ticker_error', { symbol: 'NAS:MU', entry: ENTRY }, T_KST)!;
    expect(noPrice).toMatchObject({ currency: null, pnl_pct: null, entry_price: 100000, price: null });
    // 평단 환율 폴백(fx=1)으로 달러 원값이 섞인 모양 — 비율 ≫ 3
    const mixed = buildExitJudgmentRow(ctx(), 'error', 'exit_unit_mismatch', { symbol: 'NAS:MU', entry: { qty: 3, avgPrice: 71.2 }, ticker: { price: 98_000 }, state: { entryPrice: 71.2, peakPrice: 71.2, scenarioExit: null } }, T_KST)!;
    expect(mixed).toMatchObject({ currency: null, pnl_pct: null, entry_price: 71.2, price: 98000, peak_price: 71.2 });
    const domMixed = buildExitJudgmentRow(ctx({ market: 'domestic' }), 'error', 'exit_unit_mismatch', { symbol: '005930', entry: ENTRY, ticker: { price: 400_000 }, state: STATE }, T_KST)!;
    expect(domMixed).toMatchObject({ currency: 'KRW', pnl_pct: null });
  });

  test('손익률은 단위 범위 경계([0.3, 3.0]) 안에서만 — 경계 포함, 엔진 상수와 같다', () => {
    const at = (price: number) => buildExitJudgmentRow(ctx(), 'no_fire', 'exit_no_fire', { symbol: 'NAS:MU', entry: ENTRY, ticker: { price }, state: STATE }, T_KST)!.pnl_pct;
    expect([EXIT_UNIT_RATIO_MIN, EXIT_UNIT_RATIO_MAX]).toEqual([0.3, 3.0]);
    expect(at(30_000)).toBe(-70);
    expect(at(29_999.99)).toBeNull();
    expect(at(300_000)).toBe(200);
    expect(at(300_000.01)).toBeNull();
  });

  test('진입가 출처 — position_state 를 읽은 뒤면 그 값(평단과 달라도), 전이면 KIS 평단', () => {
    const after = buildExitJudgmentRow(ctx(), 'no_fire', 'exit_no_fire', { symbol: 'NAS:MU', entry: ENTRY, ticker: { price: 100_000 }, state: { ...STATE, entryPrice: 99_000 } }, T_KST)!;
    expect(after.entry_price).toBe(99000);
    expect(after.pnl_pct).toBe(1.0101);
    const before = buildExitJudgmentRow(ctx(), 'error', 'exit_state_missing', { symbol: 'NAS:MU', entry: ENTRY, ticker: { price: 101_000 } }, T_KST)!;
    expect(before).toMatchObject({ entry_price: 100000, peak_price: null, pnl_pct: 1 });
  });

  test('평단 결손 지점 — 원값 그대로(undefined → NULL, 0 → 0), 손익률 NULL', () => {
    const u = buildExitJudgmentRow(ctx(), 'error', 'exit_avg_price_missing', { symbol: 'NAS:MU', entry: { qty: 2 } }, T_KST)!;
    expect(u).toMatchObject({ position_qty: 2, entry_price: null, pnl_pct: null });
    const z = buildExitJudgmentRow(ctx(), 'error', 'exit_avg_price_missing', { symbol: 'NAS:MU', entry: { qty: 2, avgPrice: 0 } }, T_KST)!;
    expect(z).toMatchObject({ entry_price: 0, pnl_pct: null });
    const neg = buildExitJudgmentRow(ctx(), 'error', 'exit_price_invalid', { symbol: 'NAS:MU', entry: ENTRY, ticker: { price: -5 } }, T_KST)!;
    expect(neg).toMatchObject({ price: -5, pnl_pct: null });
  });

  test('스위치 열 — 조회 실패 틱(db_error)은 NULL, 키 없음·해석 불가는 엔진이 적용한 값', () => {
    const row = (sw: ExitJudgmentContext['exitSwitch']) => buildExitJudgmentRow(ctx({ exitSwitch: sw }), 'no_fire', 'exit_no_fire', { symbol: 'NAS:MU' }, T_KST)!;
    expect(row({ enabled: false, hardStopEnabled: true, source: 'db_error' })).toMatchObject({ exit_engine_enabled: null, exit_hard_stop_enabled: null });
    expect(row({ enabled: false, hardStopEnabled: true, source: 'absent' })).toMatchObject({ exit_engine_enabled: 0, exit_hard_stop_enabled: 1 });
    expect(row({ enabled: false, hardStopEnabled: true, source: 'unparsable' })).toMatchObject({ exit_engine_enabled: 0, exit_hard_stop_enabled: 1 });
    expect(row({ enabled: true, hardStopEnabled: false, source: 'config' })).toMatchObject({ exit_engine_enabled: 1, exit_hard_stop_enabled: 0 });
  });

  test('signal_id — 양의 안전 정수만', () => {
    const sid = (v: unknown) => buildExitJudgmentRow(ctx(), 'fired', 'signal_created', { symbol: 'NAS:MU', signalId: v as number }, T_KST)!.signal_id;
    expect(sid(42)).toBe(42);
    for (const v of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, '42', undefined]) expect(sid(v)).toBeNull();
  });

  test('trigger_kind — 결과 없음·모르는 종류 = none', () => {
    const k = (exitSig: unknown) => buildExitJudgmentRow(ctx(), 'skip_policy', 'quantity_below_min', { symbol: 'NAS:MU', exitSig: exitSig as { exitKind: ExitKind } }, T_KST)!.trigger_kind;
    expect(k(undefined)).toBe('none');
    expect(k({ exitKind: 'trailing_stop' })).toBe('trailing_stop');
    expect(k({ exitKind: 'moon_shot' })).toBe('none');
  });

  test('형식 밖 입력은 행을 만들지 않는다(null) — 던지지 않는다', () => {
    const ok = { symbol: 'NAS:MU' };
    expect(buildExitJudgmentRow(ctx({ market: 'crypto' as never }), 'no_fire', 'exit_no_fire', ok, T_KST)).toBeNull();
    expect(buildExitJudgmentRow(ctx({ runId: '' }), 'no_fire', 'exit_no_fire', ok, T_KST)).toBeNull();
    expect(buildExitJudgmentRow(ctx({ runId: 'x'.repeat(41) }), 'no_fire', 'exit_no_fire', ok, T_KST)).toBeNull();
    expect(buildExitJudgmentRow(ctx({ runId: 'x'.repeat(40) }), 'no_fire', 'exit_no_fire', ok, T_KST)).not.toBeNull();
    for (const d of ['FIRED', 'skip', '', null, 3]) expect(buildExitJudgmentRow(ctx(), d, 'exit_no_fire', ok, T_KST)).toBeNull();
    for (const c of ['', 'Exit-No-Fire', 'x'.repeat(49), undefined, null, 7, "a';DROP"]) expect(buildExitJudgmentRow(ctx(), 'error', c, ok, T_KST)).toBeNull();
    expect(buildExitJudgmentRow(ctx(), 'error', 'x'.repeat(48), ok, T_KST)).not.toBeNull();
    for (const s of ['', '   ', 'N'.repeat(SYMBOL_MAX + 1), 7, null, '\uD800']) expect(buildExitJudgmentRow(ctx(), 'error', 'exit_ticker_error', { symbol: s as string }, T_KST)).toBeNull();
    expect(buildExitJudgmentRow(ctx(), 'error', 'exit_ticker_error', { symbol: ' nas:mu ' }, T_KST)!.symbol).toBe('NAS:MU');
    expect(buildExitJudgmentRow(ctx(), 'error', 'exit_ticker_error', null as never, T_KST)).toBeNull();
    expect(buildExitJudgmentRow(ctx(), 'error', 'exit_ticker_error', ok, NaN)).toBeNull();
  });

  test('🔴 적대적 입력(읽으면 던지는 getter)도 던지지 않고 null', () => {
    const evil = Object.defineProperty({ symbol: 'NAS:MU' }, 'ticker', { get() { throw new Error('boom'); } });
    expect(() => buildExitJudgmentRow(ctx(), 'no_fire', 'exit_no_fire', evil as never, T_KST)).not.toThrow();
    expect(buildExitJudgmentRow(ctx(), 'no_fire', 'exit_no_fire', evil as never, T_KST)).toBeNull();
    const evilCtx = Object.defineProperty(ctx(), 'exitSwitch', { get() { throw new Error('boom'); } });
    expect(buildExitJudgmentRow(evilCtx, 'no_fire', 'exit_no_fire', { symbol: 'NAS:MU' }, T_KST)).toBeNull();
  });

  test('숫자 — 유한·범위 안만, 열 소수 자리 반올림, −0 → 0', () => {
    expect(decimalOrNull(1.234567891, 8, 1e15)).toBe(1.23456789);
    expect(decimalOrNull(0.1 + 0.2, 8, 1e15)).toBe(0.3);
    expect(decimalOrNull(1e-9, 8, 1e15)).toBe(0);
    expect(decimalOrNull(-0, 4, 1e6)).toBe(0);
    expect(Object.is(decimalOrNull(-0.00001, 4, 1e6), 0)).toBe(true);
    for (const v of [NaN, Infinity, -Infinity, '1', null, undefined, 1e15, -1e15]) expect(decimalOrNull(v, 8, EXIT_JUDGMENT_MAX_ABS_AMOUNT)).toBeNull();
    expect(decimalOrNull(999_999.99996, 4, 1e6)).toBeNull();    // 반올림하면 1e6 — 열 범위 밖
    const r = buildExitJudgmentRow(ctx(), 'no_fire', 'exit_no_fire', { symbol: 'NAS:MU', entry: { qty: 0.1 + 0.2, avgPrice: 1e16 }, ticker: { price: Infinity } }, T_KST)!;
    expect(r).toMatchObject({ position_qty: 0.3, entry_price: null, price: null, pnl_pct: null });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C. 🔴 임계 = evaluateExit 가 실제로 쓴 값(추측 금지)', () => {
  test('종류별 규칙 — 장마감 전 손절은 항상, 손실한도 손절·익절은 시나리오가 아님을 알 때만, 트레일링·none 은 NULL', () => {
    const noSc = { entryPrice: 1, peakPrice: 1, scenarioExit: null };
    const sc = { entryPrice: 1, peakPrice: 1, scenarioExit: { targetLo: 3, targetHi: 9, stopLo: 2, stopHi: 6 } };
    expect(appliedThresholdPct('eod_loss_cut', STYLE, undefined)).toBe(-1.5);
    expect(appliedThresholdPct('eod_loss_cut', STYLE, sc)).toBe(-1.5);
    expect(appliedThresholdPct('hard_stop', STYLE, noSc)).toBe(-1.5);
    expect(appliedThresholdPct('hard_stop', STYLE, sc)).toBeNull();
    expect(appliedThresholdPct('hard_stop', STYLE, undefined)).toBeNull();
    expect(appliedThresholdPct('target_profit', STYLE, noSc)).toBe(2.5);
    expect(appliedThresholdPct('target_profit', STYLE, sc)).toBeNull();
    expect(appliedThresholdPct('trailing_stop', STYLE, noSc)).toBeNull();
    expect(appliedThresholdPct('none', STYLE, noSc)).toBeNull();
    expect(appliedThresholdPct('hard_stop', { hardStopPct: NaN }, noSc)).toBeNull();
    expect(appliedThresholdPct('hard_stop', null, noSc)).toBeNull();
    // evaluateExit 는 시나리오를 참/거짓으로 가른다 — 거짓 값(0)이면 style 임계를 쓴다
    expect(appliedThresholdPct('hard_stop', STYLE, { entryPrice: 1, peakPrice: 1, scenarioExit: 0 })).toBe(-1.5);
  });

  test('소스 고정 — 임계를 고르는 줄과 청산 종류 생성 지점 수(바뀌면 appliedThresholdPct 를 다시 맞춘다)', () => {
    const src = read('src/lib/strategy/exit-engine.ts');
    for (const line of [
      'const sc: ScenarioExitParams | null = state.scenarioExit ?? null;',
      "if (market === 'domestic' && isEodWindowKST(now) && pnlPct <= -style.eodLossCutPct) {",
      'const hardStopThreshold = sc ? sc.stopHi : style.hardStopPct;',
      'if (pnlPct <= -hardStopThreshold) {',
      'if (sc && pnlPct <= -sc.stopLo) {',
      'if (sc && pnlPct >= sc.targetHi) {',
      'const targetThreshold = sc ? sc.targetLo : style.targetProfitPct;',
      'if (pnlPct >= targetThreshold) {',
      'const pnlPct = (price - entry) / entry * 100;',
    ]) expect(src).toContain(line);
    const kinds = [...src.matchAll(/exitKind: '([a-z_]+)'/g)].map((m) => m[1]);
    expect(kinds.sort()).toEqual(['eod_loss_cut', 'hard_stop', 'hard_stop', 'target_profit', 'target_profit', 'trailing_stop']);
  });

  test('무작위 대조 — 시나리오 없는 포지션에서 고른 종류의 발화 조건이 그 임계로 성립하고, 임계 바로 바깥에서는 그 종류가 아니다', () => {
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const style = (s: Partial<StyleConfig>) => ({ ...s, trailingActivatePct: 3.5, trailingDrawdownPct: 1.2 }) as StyleConfig;
    let checked = 0;
    for (let i = 0; i < 4000; i++) {
      const st = style({ eodLossCutPct: Math.round(rnd() * 400) / 100 + 0.5, hardStopPct: Math.round(rnd() * 800) / 100 + 0.5, targetProfitPct: Math.round(rnd() * 800) / 100 + 0.5 });
      const market = rnd() < 0.5 ? 'domestic' : 'overseas';
      const now = rnd() < 0.3 ? new Date('2026-10-30T06:25:00Z') : new Date('2026-10-30T01:00:00Z');   // 15:25 KST(창 안) / 10:00 KST
      const entry = 100;
      const price = Math.round((entry * (0.85 + rnd() * 0.3)) * 10_000) / 10_000;
      const state: PositionState = { symbol: 'X', market, entryPrice: entry, peakPrice: Math.max(entry, price), qty: 1, scenarioExit: null, holdingDeadline: null, firstSeenAt: now, updatedAt: now };
      const sig = evaluateExit({ symbol: 'X', market, ticker: { symbol: 'X', price, timestamp: 0 }, state, style: st, now });
      if (!sig || sig.exitKind === 'trailing_stop') continue;
      const t = appliedThresholdPct(sig.exitKind, st, state);
      expect(t).not.toBeNull();
      const pnl = (price - entry) / entry * 100;
      if (sig.exitKind === 'target_profit') expect(pnl).toBeGreaterThanOrEqual(t! - 1e-9);
      else expect(pnl).toBeLessThanOrEqual(t! + 1e-9);
      // 임계 바로 바깥(0.01%p) — 같은 시각·시장에서 그 종류로는 발화하지 않는다
      const outside = sig.exitKind === 'target_profit' ? t! - 0.01 : t! + 0.01;
      const p2 = entry * (1 + outside / 100);
      const sig2 = evaluateExit({ symbol: 'X', market, ticker: { symbol: 'X', price: p2, timestamp: 0 }, state: { ...state, peakPrice: Math.max(entry, p2) }, style: st, now });
      expect(sig2?.exitKind).not.toBe(sig.exitKind);
      checked++;
    }
    expect(checked).toBeGreaterThan(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('D. 🔴 통화 근거 — 엔진 가격 값은 원화(어댑터 소스 고정)', () => {
  test('해외 시세·평단은 어댑터가 원화로 바꾼다 / (R4) 환율 함수는 던지지 않고 실패하면 1 을 준다 — 그때는 달러 원값', () => {
    const ovs = read('src/lib/exchanges/kis-overseas.ts');
    expect(ovs).toContain('price:          Number(o.last) * fx,');
    expect(ovs).toContain('const fx = await fetchUsdKrwRate();');
    expect(ovs).toContain('const avgKrw = avgUsd > 0 ? avgUsd * balFx : 0;');
    expect(ovs).toContain('avgPrice: avgKrw > 0 ? avgKrw : undefined,');
    // fetchUsdKrwRate 는 자기 안에서 예외를 삼키고 1 을 돌려준다 → 시세 쪽도 던지지 않는다, getBalances 의 `.catch(() => 1)` 은 죽은 코드
    expect(ovs).toContain('async function fetchUsdKrwRate(): Promise<number> {\n  try {\n    const r = await getUsdKrwRate();\n    return Number.isFinite(r) && r > 0 ? r : 1;\n  } catch {\n    return 1;');
  });
  test('엔진이 쓰는 값이 바로 그 시세·평단이다', () => {
    const eng = read('src/lib/strategy/engine.ts');
    expect(eng).toContain('ticker = await kis.getTicker(symbol);');
    expect(eng).toContain('map.set(b.currency, { qty, avgPrice: b.avgPrice });');
    expect(eng).toContain('await upsertPositionState(symbol, market, ticker.price, entry.avgPrice, entry.qty);');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('E. 엔진 릴리스 이름 = T-112 판단 기록기 규칙', () => {
  test.each([
    '/home/brownjeon/apps/stockinvest/releases/20261031-052042-4c6f5950',
    '/home/brownjeon/apps/stockinvest/releases/20261031-052042-4c6f5950/',
    '/home/x/releases/' + 'r'.repeat(60),
    '/home/brownjeon/project/StockInvest',
    '/releases/',
    '',
    null,
    42,
  ])('%p', (cwd) => {
    expect(exitEngineReleaseFromCwd(cwd)).toEqual(engineReleaseFromCwd(cwd));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('F. 수집기', () => {
  const sw = { enabled: true, hardStopEnabled: true, source: 'config' as const };
  const rec = { runId: 'domestic-202610301000' };

  test('add 는 동기 push 만(I/O 0) — flushDetached 에서야 스위치를 읽는다, 꺼져 있으면 INSERT 0', async () => {
    const c = openExitJudgmentCollector('domestic', rec, sw, STYLE);
    c.add('no_fire', 'exit_no_fire', { symbol: '005930', entry: ENTRY, ticker: { price: 100_000 }, state: STATE });
    c.add('error', 'exit_ticker_error', { symbol: '000660', entry: ENTRY });
    expect(queryMock).not.toHaveBeenCalled();
    c.flushDetached();
    expect(queryMock).not.toHaveBeenCalled();   // flush 도 동기 I/O 0 — 다음 마이크로태스크에서 시작한다
    expect(getConnectionMock).not.toHaveBeenCalled();   // (T-139) 스위치 연결 받기도 동기로는 일어나지 않는다
    const res = await waitForExitJudgmentRecordsForTest();
    expect(res).toEqual([{ status: 'disabled' }]);
    expect(switchReads()).toHaveLength(1);
    expect(inserts()).toHaveLength(0);
  });

  test('켜짐 — multi-row INSERT 1문장, 행 순서·열 순서 그대로, engine_release 는 기록 시점 cwd', async () => {
    db.recordSwitch = ON;
    jest.spyOn(process, 'cwd').mockReturnValue('/home/brownjeon/apps/stockinvest/releases/20261031-052042-4c6f5950');
    const c = openExitJudgmentCollector('domestic', rec, sw, STYLE);
    c.add('no_fire', 'exit_no_fire', { symbol: '005930', entry: ENTRY, ticker: { price: 100_000 }, state: STATE });
    c.add('skip_policy', 'quantity_below_min', { symbol: '000660', entry: ENTRY, ticker: { price: 98_000 }, state: STATE, exitSig: { exitKind: 'hard_stop' } });
    c.flushDetached();
    expect(await waitForExitJudgmentRecordsForTest()).toEqual([{ status: 'written', rows: 2, dropped: 0 }]);
    expect(inserts()).toHaveLength(1);
    expect([insertConnCount(), releaseMock.mock.calls.length, destroyMock.mock.calls.length]).toEqual([1, 1, 0]);
    expect(swEnds()).toEqual([1, 1, 0]);   // (T-139) 스위치 SELECT 는 자기 연결 — 읽은 뒤 release
    const [sql, params] = inserts()[0] as [string, unknown[]];
    expect(sql).toBe(buildExitJudgmentInsert([{} as ExitJudgmentRow, {} as ExitJudgmentRow], null).sql);
    expect(params).toHaveLength(2 * EXIT_JUDGMENT_COLUMNS.length);
    const n = EXIT_JUDGMENT_COLUMNS.length;
    const col = (r: unknown[], c: (typeof EXIT_JUDGMENT_COLUMNS)[number]) => r[EXIT_JUDGMENT_COLUMNS.indexOf(c)];
    const rows = [params.slice(0, n), params.slice(n)];
    expect(rows.map((r) => [col(r, 'symbol'), col(r, 'decision'), col(r, 'decision_code'), col(r, 'trigger_kind'), col(r, 'threshold_pct'), col(r, 'engine_release')])).toEqual([
      ['005930', 'no_fire', 'exit_no_fire', 'none', null, '20261031-052042-4c6f5950'],
      ['000660', 'skip_policy', 'quantity_below_min', 'hard_stop', -1.5, '20261031-052042-4c6f5950'],
    ]);
  });

  test('행이 하나도 없으면 I/O 0(스위치도 읽지 않는다) · flush 는 한 번만 · flush 뒤 add 는 버린다', async () => {
    const c = openExitJudgmentCollector('domestic', rec, sw, STYLE);
    c.flushDetached();
    expect(await waitForExitJudgmentRecordsForTest()).toEqual([]);
    expect(queryMock).not.toHaveBeenCalled();
    db.recordSwitch = ON;
    const d = openExitJudgmentCollector('domestic', rec, sw, STYLE);
    d.add('no_fire', 'exit_no_fire', { symbol: '005930' });
    d.flushDetached();
    d.add('no_fire', 'exit_no_fire', { symbol: '000660' });
    d.flushDetached();
    expect(await waitForExitJudgmentRecordsForTest()).toEqual([{ status: 'written', rows: 1, dropped: 0 }]);
    expect(inserts()).toHaveLength(1);
  });

  test(`상한 ${MAX_EXIT_JUDGMENT_ROWS}행 — 넘는 행·형식 밖 행은 버리고 세어 경고 1줄`, async () => {
    db.recordSwitch = ON;
    const c = openExitJudgmentCollector('domestic', rec, sw, STYLE);
    c.add('no_fire', 'Bad Code', { symbol: '005930' });
    for (let i = 0; i < MAX_EXIT_JUDGMENT_ROWS + 4; i++) c.add('no_fire', 'exit_no_fire', { symbol: String(100000 + i) });
    c.flushDetached();
    expect(await waitForExitJudgmentRecordsForTest()).toEqual([{ status: 'written', rows: MAX_EXIT_JUDGMENT_ROWS, dropped: 5 }]);
    expect((inserts()[0][1] as unknown[]).length).toBe(MAX_EXIT_JUDGMENT_ROWS * EXIT_JUDGMENT_COLUMNS.length);
    expect(warns().filter((w) => w.includes('5개를 뺐다'))).toHaveLength(1);
  });

  test('🔴 (R3) 행 상한은 100 이다 — 101행을 넣으면 100행만 쓰고 1행은 버리며 경고 한 줄, 던지지 않는다', async () => {
    expect(MAX_EXIT_JUDGMENT_ROWS).toBe(100);
    db.recordSwitch = ON;
    const c = openExitJudgmentCollector('domestic', rec, sw, STYLE);
    expect(() => { for (let i = 0; i < 101; i++) c.add('no_fire', 'exit_no_fire', { symbol: String(200000 + i) }); }).not.toThrow();
    c.flushDetached();
    expect(await waitForExitJudgmentRecordsForTest()).toEqual([{ status: 'written', rows: 100, dropped: 1 }]);
    const params = inserts()[0][1] as unknown[];
    expect(params.length).toBe(100 * EXIT_JUDGMENT_COLUMNS.length);
    expect(params[99 * EXIT_JUDGMENT_COLUMNS.length + EXIT_JUDGMENT_COLUMNS.indexOf('symbol')]).toBe('200099');   // 100번째 행까지만
    expect(ownWarns()).toEqual([expect.stringContaining('청산 판단 행 1개를 뺐다(형식 밖·상한 100)')]);
  });

  test('🔴 적대적 입력·적대적 문맥에서도 던지지 않는다', () => {
    const evil = new Proxy({}, { get() { throw new Error('boom'); } });
    const c = openExitJudgmentCollector('domestic', rec, sw, STYLE);
    expect(() => c.add('no_fire', 'exit_no_fire', evil as never)).not.toThrow();
    expect(() => c.add(evil as never, evil as never, evil as never)).not.toThrow();
    expect(() => openExitJudgmentCollector('domestic', evil as never, evil as never, evil as never)).not.toThrow();
    const n = openExitJudgmentCollector('domestic', evil as never, evil as never, evil as never);
    expect(() => { n.add('no_fire', 'exit_no_fire', { symbol: '005930' }); n.flushDetached(); }).not.toThrow();
    expect(() => openExitJudgmentCollector('domestic', null, sw, STYLE).add('no_fire', 'exit_no_fire', { symbol: '005930' })).not.toThrow();
  });

  test('run_id 를 모르면(rec 없음) 행을 만들지 않는다 — 켜져 있어도 INSERT 0', async () => {
    db.recordSwitch = ON;
    const c = openExitJudgmentCollector('domestic', null, sw, STYLE);
    c.add('no_fire', 'exit_no_fire', { symbol: '005930' });
    c.flushDetached();
    expect(await waitForExitJudgmentRecordsForTest()).toEqual([{ status: 'empty', rows: 0, dropped: 1 }]);
    expect(inserts()).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('G. 기록 1회 — 실패는 삼키고 분류어 한 줄', () => {
  const row = buildExitJudgmentRow(ctx(), 'skip_policy', 'exit_hard_stop_disabled', {
    symbol: 'NAS:SECRET', entry: { qty: 7, avgPrice: 123_456.78 }, ticker: { price: 120_000.5 }, state: { entryPrice: 123_456.78, peakPrice: 130_000, scenarioExit: null }, exitSig: { exitKind: 'hard_stop' },
  }, T_KST)!;
  const leaks = (w: string) => /NAS:SECRET|123456|120000|130000|leaky/.test(w);

  test('스위치 키 없음 → disabled, INSERT 0, 경고 0', async () => {
    await expect(recordExitJudgments([row], 0, 'overseas')).resolves.toEqual({ status: 'disabled' });
    expect(inserts()).toHaveLength(0);
    expect(warns()).toEqual([]);
  });

  test('테이블 없음(1146) → no_table, 프로세스당 경고 1줄', async () => {
    db.recordSwitch = ON;
    db.insert = Object.assign(new Error("Table 'x.exit_judgment' doesn't exist"), { errno: 1146 });
    await expect(recordExitJudgments([row], 0, 'overseas')).resolves.toMatchObject({ status: 'no_table', reason: 'no_table' });
    await expect(recordExitJudgments([row], 0, 'overseas')).resolves.toMatchObject({ status: 'no_table', reason: 'no_table' });
    expect(warns()).toHaveLength(1);
    expect(warns()[0]).toContain('프로세스당 1회');
    expect([releaseMock.mock.calls.length, destroyMock.mock.calls.length]).toEqual([0, 2]);
    expect(swEnds()).toEqual([1, 1, 0]);   // (T-139) 두 번째 기록은 스위치 캐시(30초) — 스위치 연결은 첫 기록의 1개뿐
  });

  test.each([
    [4025, 'check_violation errno=4025'],
    [1406, 'row_data errno=1406'],
    [1213, 'db_error errno=1213'],
  ])('INSERT 오류 errno=%p → error(%p), 경고에 종목·금액·DB 원문 없음', async (errno, reason) => {
    db.recordSwitch = ON;
    db.insert = Object.assign(new Error("leaky NAS:SECRET value '123456.78'"), { errno });
    await expect(recordExitJudgments([row], 0, 'overseas')).resolves.toMatchObject({ status: 'error', reason });
    expect(ownWarns()).toHaveLength(1);
    expect(ownWarns()[0]).toContain(reason);
    expect(leaks(ownWarns()[0])).toBe(false);
    expect([releaseMock.mock.calls.length, destroyMock.mock.calls.length]).toEqual([0, 1]);   // 오류 = 연결을 풀에서 뺀다
    expect(swEnds()).toEqual([1, 1, 0]);   // (T-139) 스위치 연결은 INSERT 오류와 무관하게 release
  });

  test('errno 없는 예외·getPool 실패 → exception, 던지지 않는다', async () => {
    db.recordSwitch = ON;
    db.insert = new Error('leaky NAS:SECRET');
    await expect(recordExitJudgments([row], 0, 'overseas')).resolves.toMatchObject({ status: 'error', reason: 'exception' });
    resetRecordSwitchCacheForTest();
    getPoolMock.mockImplementation(() => { throw new Error('pool gone NAS:SECRET'); });
    await expect(recordExitJudgments([row], 0, 'overseas')).resolves.toEqual({ status: 'disabled' });   // 스위치 읽기부터 실패 = 꺼짐
    expect(ownWarns().some(leaks)).toBe(false);
    expect(ownWarns()).toHaveLength(1);
  });

  test(`INSERT 무한 대기 → ${EXIT_JUDGMENT_RECORD_TIMEOUT_MS}ms 에 timeout(늦은 실패도 흡수)`, async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    db.recordSwitch = ON;
    let rejectLate!: (e: unknown) => void;
    db.insert = new Promise((_, rej) => { rejectLate = rej; });
    const p = recordExitJudgments([row], 0, 'overseas');
    await new Promise((r) => setImmediate(r));   // 스위치 읽기가 끝나고 INSERT 가 나갈 때까지
    expect(inserts()).toHaveLength(1);
    expect(destroyMock).not.toHaveBeenCalled();
    jest.advanceTimersByTime(EXIT_JUDGMENT_RECORD_TIMEOUT_MS);
    await expect(p).resolves.toMatchObject({ status: 'timeout', reason: 'timeout' });
    // 🔴 R1 — 상한에서 기다림만 끊지 않고 매달린 연결을 풀에서 뺀다(늦은 실패가 오기 **전에**)
    expect([releaseMock.mock.calls.length, destroyMock.mock.calls.length]).toEqual([0, 1]);
    rejectLate(Object.assign(new Error('late'), { errno: 2013 }));
    await new Promise((r) => setImmediate(r));
    // 실패 한 줄만 — 늦게 끝난 본문(2013)이 줄을 더하지 않는다
    expect(ownWarns()).toEqual([expect.stringContaining('청산 판단 기록 실패(timeout) market=overseas')]);
    expect([releaseMock.mock.calls.length, destroyMock.mock.calls.length]).toEqual([0, 1]);   // 늦은 실패도 연결을 더 건드리지 않는다(이미 뺐다)
    expect(swEnds()).toEqual([1, 1, 0]);   // (T-139) 스위치 연결은 INSERT 전에 이미 release
  });

  test('🔴 (R1) 풀이 바빠 상한 뒤에야 받은 연결 — INSERT 를 보내지 않고 release, 결과는 timeout', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    db.recordSwitch = ON;
    let give!: (c: FakeConn) => void;
    insertConnWith(() => new Promise((r) => { give = r; }));
    const p = recordExitJudgments([row], 0, 'overseas');
    await new Promise((r) => setImmediate(r));
    expect(getConnectionMock).toHaveBeenCalledTimes(2);   // (T-139) 스위치 연결 1(읽고 release) + INSERT 연결 1(받는 중)
    expect(swEnds()).toEqual([1, 1, 0]);
    jest.advanceTimersByTime(EXIT_JUDGMENT_RECORD_TIMEOUT_MS);
    await expect(p).resolves.toMatchObject({ status: 'timeout' });
    give(newConn());
    await new Promise((r) => setImmediate(r));
    expect(inserts()).toHaveLength(0);   // 늦은 기록 없음
    expect([releaseMock.mock.calls.length, destroyMock.mock.calls.length]).toEqual([1, 0]);
  });

  test('(R1) 연결 받기 실패 → error(분류어), INSERT 0, 던지지 않는다', async () => {
    db.recordSwitch = ON;
    insertConnWith(async () => { throw Object.assign(new Error('Pool is closed NAS:SECRET'), { errno: 2013 }); });
    await expect(recordExitJudgments([row], 0, 'overseas')).resolves.toMatchObject({ status: 'error', reason: 'db_error errno=2013' });
    expect(inserts()).toHaveLength(0);
    expect(swEnds()).toEqual([1, 1, 0]);   // (T-139) 실패한 것은 INSERT 연결 받기 — 스위치는 읽혔다
    expect(ownWarns().some(leaks)).toBe(false);
  });

  test('(R1) 정상 — 연결 1개를 받아 INSERT 1문장 뒤 release(destroy 0), (T-139) 스위치 읽기는 자기 연결 1개로 SELECT 1문장 뒤 release', async () => {
    db.recordSwitch = ON;
    await expect(recordExitJudgments([row, row], 0, 'overseas')).resolves.toEqual({ status: 'written', rows: 2, dropped: 0 });
    expect([insertConnCount(), inserts().length, releaseMock.mock.calls.length, destroyMock.mock.calls.length]).toEqual([1, 1, 1, 0]);
    expect(switchReads()).toHaveLength(1);
    expect(swEnds()).toEqual([1, 1, 0]);
    expect(getConnectionMock).toHaveBeenCalledTimes(2);
    // 첫 연결은 스위치 SELECT 로 시작, 둘째 연결은 INSERT 로 시작 — 둘이 같은 연결이 아니다
    expect(conns.map((c) => c.isSwitch())).toEqual([true, false]);
  });

  test('분류어 — errno 숫자로만 가른다', () => {
    expect(classifyExitJudgmentError({ errno: 1146, code: 'ER_NO_SUCH_TABLE' })).toBe('no_table errno=1146');
    expect(classifyExitJudgmentError({ errno: 4025, code: 'ER_INNODB_AUTOEXTEND_SIZE_OUT_OF_RANGE' })).toBe('check_violation errno=4025');
    expect(classifyExitJudgmentError({ errno: 1265 })).toBe('row_data errno=1265');
    expect(classifyExitJudgmentError(new Error('x'))).toBe('exception');
    expect(classifyExitJudgmentError(null)).toBe('exception');
    expect(classifyExitJudgmentError(new Proxy({}, { get() { throw new Error('boom'); } }))).toBe('exception');
  });
});

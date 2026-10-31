/**
 * T-112 B — 장마감 분석 엔진(국내·해외) ↔ 기준 판단 기록 배선 시험 (DDL 초안 §7.3 #13~#17).
 *
 *  ① 거르기 지점별 기록 — §3.4 `exclusion_code` 어휘 ↔ 엔진 분기 1:1 **동적** 대조(국내 8 · 해외 12, 마지막 시험이 합집합을 본다).
 *     (정적 대조는 judgment-trace.test.ts — 엔진 소스의 표시 호출)
 *  ② 🔴 기록 on/off·스위치 키 없음·테이블 없음·INSERT 무한 대기·스위치 읽기 무한 대기·카드 id 조회 실패·후보 INSERT 실패·
 *     기록 진입점이 던짐 → 분석 반환값·카드 INSERT 인자·LLM/RAG 호출 인자·로그가 기록기 없는 실행과 같고, 엔진은 기록을 기다리지 않는다.
 *  ③ 조기 반환 경로(ai_fail·ai_parse_fail·LLM 후보 0·insert_fail·후보 0·데이터 모름)에서도 헤더가 남는다 / 정상 건너뜀은 남지 않는다.
 *  ④ 해외 기록은 트랜잭션 연결을 쓰지 않고 커밋 **뒤** 풀로 쓴다. ⑤ prompt_sha256 = runLlm 에 넘긴 문자열의 sha256.
 *
 * DB 는 SQL 로 갈라 답하는 목이다(운영 DB·`.env` 접근 없음). 기록기·스위치·자르기 헬퍼는 실물을 쓴다(②④).
 */
import { createHash } from 'node:crypto';
import type { DailyCandidate } from '../../rules/eod-high-close';
import { runPostMarketAnalysis } from '../../post-market-engine';
import { runPostMarketOverseas } from '../../post-market-overseas';
import { getPool } from '@/lib/db';
import { kis } from '@/lib/exchanges/kis';
import { getCandles as domesticGetCandles } from '@/lib/exchanges/kis-domestic';
import { isOverseasEnabled } from '@/lib/exchanges/market-flags';
import { getUsdKrwRate } from '@/lib/exchanges/fx';
import { runLlm, getProviderConfig } from '@/lib/llm/provider';
import { retrieveRagContext } from '@/lib/rag/retrieval';
import { loadUsTargetSymbols, findMissingTables } from '@/lib/data/us-data-db';
import { eodHighClose } from '../../rules/eod-high-close';
import { insideBar } from '../../rules/inside-bar';
import { oversoldBounceDaily } from '../../rules/oversold-bounce-daily';
import { getStyleConfig } from '../../style';
import { getAlwaysIncludeSymbols, getUniverseSnapshot } from '../../universe';
import { evaluateValidationGate } from '@/lib/safety/validation-gate';
import { recordJudgmentDetached, waitForJudgmentRecordsForTest, resetJudgmentRecorderForTest } from '../judgment-recorder';
import { resetRecordSwitchCacheForTest } from '../record-switch';
import { EXCLUSION_CODES_BY_MARKET, type ExclusionCode, type JudgmentRunSnapshot, type JudgmentTrace } from '../judgment-trace';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/exchanges/kis', () => ({ kis: { getCandles: jest.fn() } }));
jest.mock('@/lib/exchanges/kis-domestic', () => ({ getCandles: jest.fn() }));
jest.mock('@/lib/exchanges/market-flags', () => ({ isOverseasEnabled: jest.fn() }));
jest.mock('@/lib/exchanges/fx', () => ({ getUsdKrwRate: jest.fn() }));
jest.mock('@/lib/llm/provider', () => ({ runLlm: jest.fn(), getProviderConfig: jest.fn() }));
jest.mock('@/lib/rag/retrieval', () => ({ retrieveRagContext: jest.fn() }));
// 뉴스 0건 감시 기록만 목(I/O). 뉴스 검색 신뢰 판정(isNewsRetrievalReliable)은 실물 — 추적의 news 상태가 그것을 쓴다.
jest.mock('@/lib/rag/news-health', () => ({ ...jest.requireActual('@/lib/rag/news-health'), recordRetrievalNewsOutcome: jest.fn(async () => null) }));
jest.mock('@/lib/rag/format', () => ({ formatRagSection: jest.fn(() => '### 뉴스\n- 헤드라인') }));
jest.mock('@/lib/data/us-data-db', () => ({ loadUsTargetSymbols: jest.fn(), findMissingTables: jest.fn() }));
jest.mock('../../rules/eod-high-close', () => ({ eodHighClose: jest.fn() }));
jest.mock('../../rules/inside-bar', () => ({ insideBar: jest.fn() }));
jest.mock('../../rules/oversold-bounce-daily', () => ({ oversoldBounceDaily: jest.fn() }));
jest.mock('../../style', () => ({ getStyleConfig: jest.fn() }));
jest.mock('../../universe', () => ({ getAlwaysIncludeSymbols: jest.fn(), getUniverseSnapshot: jest.fn() }));
jest.mock('@/lib/safety/validation-gate', () => ({ ...jest.requireActual('@/lib/safety/validation-gate'), evaluateValidationGate: jest.fn() }));
jest.mock('@/lib/signals/paper-fill', () => ({ ...jest.requireActual('@/lib/signals/paper-fill'), insertPaperFill: jest.fn(async () => ({ inserted: true, id: 1 })) }));
// 기록 진입점만 감싼다 — 기본은 실물로 넘기고, 시험마다 "추적만 잡기"·"던지기"로 바꾼다.
jest.mock('../judgment-recorder', () => {
  const actual = jest.requireActual('../judgment-recorder');
  return { ...actual, recordJudgmentDetached: jest.fn((t: unknown) => actual.recordJudgmentDetached(t)) };
});

const mGetPool = getPool as jest.Mock;
const mOvsCandles = kis.getCandles as jest.Mock;
const mDomCandles = domesticGetCandles as jest.Mock;
const mOvsEnabled = isOverseasEnabled as jest.Mock;
const mFx = getUsdKrwRate as jest.Mock;
const mLlm = runLlm as jest.Mock;
const mProvider = getProviderConfig as jest.Mock;
const mRag = retrieveRagContext as jest.Mock;
const mTargets = loadUsTargetSymbols as jest.Mock;
const mMissing = findMissingTables as jest.Mock;
const mEod = eodHighClose as jest.Mock;
const mInside = insideBar as jest.Mock;
const mOversold = oversoldBounceDaily as jest.Mock;
const mStyle = getStyleConfig as jest.Mock;
const mAlways = getAlwaysIncludeSymbols as jest.Mock;
const mUniverse = getUniverseSnapshot as jest.Mock;
const mGate = evaluateValidationGate as jest.Mock;
const mRecord = recordJudgmentDetached as jest.Mock;
const actualRecorder = jest.requireActual('../judgment-recorder') as typeof import('../judgment-recorder');

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

function setNow(iso: string) {
  jest.useFakeTimers({
    now: new Date(iso),
    doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'clearImmediate', 'queueMicrotask', 'performance'],
  });
}
const FRI_1602_KST = '2026-10-16T07:02:00Z';   // 국내: 금 16:02 → valid_from 월 10-19 09:00
const SAT_1602_KST = '2026-10-17T07:02:00Z';
const WED_0800_KST = '2026-10-20T23:00:00Z';   // 해외: D0 10-20(화), S1 10-21
const CLOSED = ['2026-01-01', '2026-11-26', '2026-11-27', '2026-12-25', '2027-01-01'];

interface Deferred<T> { promise: Promise<T>; resolve: (v: T) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

// ─────────────────────────────────────────────────────────────────────────────
// DB 목 — SQL 로 갈라 답하고, 모든 호출을 순서와 함께 남긴다(풀/트랜잭션 연결 구분)
// ─────────────────────────────────────────────────────────────────────────────
type Res = { affectedRows: number; insertId?: number };
interface DbState {
  overseasSwitch: unknown[];
  recordSwitch: unknown[] | Error | Deferred<unknown[]>;
  fxRow: Record<string, unknown> | null;
  earningsRows: unknown[];
  cardResults: Array<Res | Error>;
  signalIds: Record<string, number>;
  signalLookup: 'ok' | Error;
  judgmentRun: 'ok' | Error | Deferred<void>;
  judgmentCandidate: 'ok' | Error;
}
/** via — pool: 풀 query · conn: 엔진의 카드 트랜잭션 연결(beginTransaction 을 부른 연결) · poolconn: 풀에서 따로 받은 트랜잭션 없는 연결(T-135 기록기 INSERT,
 *  T-139 기록 스위치 SELECT). cid — 풀에서 받은 연결의 번호(받은 순서, 1부터) · 풀 query 는 0. 어느 문장들이 같은 연결로 갔는지 가른다. */
interface Call { seq: number; via: 'pool' | 'conn' | 'poolconn'; cid: number; sql: string; params: unknown[] }
let db: DbState;
let calls: Call[];
let seq: number;
let commitSeq: number[];
let cardIdx: number;
let connSeq: number;
let query: jest.Mock;
let conn: { beginTransaction: jest.Mock; query: jest.Mock; commit: jest.Mock; rollback: jest.Mock; release: jest.Mock; destroy: jest.Mock };

const isDeferred = (v: unknown): v is Deferred<unknown> => v != null && typeof v === 'object' && 'promise' in v && 'resolve' in v;

async function route(via: Call['via'], sql: string, params: unknown[] = [], cid = 0): Promise<unknown> {
  calls.push({ seq: ++seq, via, cid, sql, params });
  if (sql.includes('INSERT INTO signals')) {
    const r = db.cardResults[cardIdx++] ?? { affectedRows: 1, insertId: 900 + cardIdx };
    if (r instanceof Error) throw r;
    return [r, undefined];
  }
  if (sql.includes('FROM system_config')) {
    if (params[0] === 'judgment_record_enabled') {
      const v = db.recordSwitch;
      if (v instanceof Error) throw v;
      if (isDeferred(v)) return [await v.promise, undefined];
      return [v, undefined];
    }
    if (params[0] === 'post_market_overseas_enabled') return [db.overseasSwitch, undefined];
    return [[], undefined];
  }
  if (sql.includes('FROM market_holidays')) {
    const years = (params[0] as number[]) ?? [];
    return [CLOSED.filter((d) => years.includes(Number(d.slice(0, 4)))).map((d) => ({ d })), undefined];
  }
  if (sql.includes('FROM fx_rates')) return [db.fxRow ? [db.fxRow] : [], undefined];
  if (sql.includes('FROM us_earnings_events')) return [db.earningsRows, undefined];
  if (sql.includes('SELECT id, symbol FROM signals')) {
    if (db.signalLookup instanceof Error) throw db.signalLookup;
    const syms = params.slice(1) as string[];
    return [syms.filter((s) => db.signalIds[s] != null).map((s) => ({ id: db.signalIds[s], symbol: s })), undefined];
  }
  if (sql.includes('INSERT INTO judgment_run')) {
    const v = db.judgmentRun;
    if (v instanceof Error) throw v;
    if (isDeferred(v)) await v.promise;
    return [{ affectedRows: 1, insertId: 4242 }, undefined];
  }
  if (sql.includes('INSERT INTO judgment_candidate')) {
    if (db.judgmentCandidate instanceof Error) throw db.judgmentCandidate;
    return [{ affectedRows: params.length / 10 }, undefined];
  }
  throw new Error(`예상하지 못한 SQL: ${sql.replace(/\s+/g, ' ').slice(0, 80)}`);
}

function wireDb() {
  calls = [];
  seq = 0;
  commitSeq = [];
  cardIdx = 0;
  connSeq = 0;
  query = jest.fn((sql: string, params?: unknown[]) => route('pool', sql, params));
  conn = {
    beginTransaction: jest.fn(async () => undefined),
    query: jest.fn((sql: string, params?: unknown[], cid?: number) => route('conn', sql, params, cid)),
    commit: jest.fn(async () => { commitSeq.push(++seq); }),
    rollback: jest.fn(async () => undefined),
    release: jest.fn(),
    destroy: jest.fn(),
  };
  // (T-135) 풀은 getConnection 마다 **다른** 연결을 준다(운영 mysql2 와 같게) — beginTransaction 을 부른 연결(엔진의 카드 트랜잭션)은 'conn',
  //   트랜잭션 없이 쓰는 연결(기록기가 INSERT 용으로 따로 받는 것)은 'poolconn'. 예전 목은 매번 같은 트랜잭션 연결을 돌려줘서, 기록기가 풀에서
  //   연결을 받기 시작하자 둘을 구별하지 못했다. commit·rollback·release·destroy 횟수는 예전처럼 conn 의 목에 모인다.
  mGetPool.mockReturnValue({
    query,
    getConnection: jest.fn(async () => {
      let inTx = false;
      const cid = ++connSeq;
      return {
        beginTransaction: async () => { inTx = true; return conn.beginTransaction(); },
        query: (sql: string, params?: unknown[]) => (inTx ? conn.query(sql, params, cid) : route('poolconn', sql, params, cid)),
        commit: () => conn.commit(),
        rollback: () => conn.rollback(),
        release: () => conn.release(),
        destroy: () => conn.destroy(),
      };
    }),
  });
}

const NO_TABLE = Object.assign(new Error("Table 'stock.judgment_run' doesn't exist"), { errno: 1146, code: 'ER_NO_SUCH_TABLE' });

/** 추적만 잡고 기록하지 않는 모드 — 거르기 지점별 시험용 */
let captured: JudgmentTrace[];
function captureOnly() {
  captured = [];
  mRecord.mockImplementation((t: JudgmentTrace) => { captured.push(t); });
}
function snap(): JudgmentRunSnapshot {
  expect(captured).toHaveLength(1);
  return captured[0].snapshot();
}
const rowOf = (s: JudgmentRunSnapshot, symbol: string) => {
  const r = s.candidates.find((c) => c.symbol === symbol);
  if (!r) throw new Error(`행 없음: ${symbol}`);
  return r;
};

const seen: Record<'domestic' | 'overseas', Set<ExclusionCode>> = { domestic: new Set(), overseas: new Set() };
function collect(s: JudgmentRunSnapshot) {
  for (const c of s.candidates) if (c.exclusionCode) seen[s.market].add(c.exclusionCode);
}

/** 모든 목·상태를 기본값으로 — beforeEach 와 ②의 observe() 가 같이 쓴다(앞 시험이 바꾼 상태가 새지 않게). */
function resetAll() {
  jest.clearAllMocks();
  for (const m of ['log', 'warn', 'error'] as const) jest.spyOn(console, m).mockImplementation(() => {}).mockClear();
  resetRecordSwitchCacheForTest();
  resetJudgmentRecorderForTest();
  db = {
    overseasSwitch: [{ value: 'true' }],
    recordSwitch: [],
    fxRow: { rate: '1330.0000', age_sec: 120, fetched_kst: '2026-10-21T07:58:00' },
    earningsRows: [],
    cardResults: [],
    signalIds: {},
    signalLookup: 'ok',
    judgmentRun: 'ok',
    judgmentCandidate: 'ok',
  };
  wireDb();
  mRecord.mockImplementation((t: unknown) => actualRecorder.recordJudgmentDetached(t as JudgmentTrace));
  mProvider.mockResolvedValue({ provider: 'claude', homeM4ApiModel: 'qwen2.5:14b-instruct', stage1Model: 'qwen2.5:14b-instruct' });
  mGate.mockImplementation(async ({ strategyId }: { strategyId: string }) => (
    strategyId === 'inside-bar-v1'
      ? { allowed: false, kind: 'blocked', reason: 'unvalidated', strategyId, status: 'unvalidated' }
      : { allowed: true, kind: 'validated', strategyId, status: 'backtested' }
  ));
  mStyle.mockResolvedValue({ limitChasePct: 0.005 });
  mOvsEnabled.mockReturnValue(true);
  mFx.mockImplementation(async () => 1330);
  mMissing.mockResolvedValue([]);
  mEod.mockReturnValue(null);
  mInside.mockReturnValue(null);
  mOversold.mockReturnValue(null);
}
beforeEach(() => { resetAll(); });
afterEach(async () => {
  await waitForJudgmentRecordsForTest();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// 국내 시나리오
// ─────────────────────────────────────────────────────────────────────────────
const dCand = (symbol: string, pattern: DailyCandidate['pattern'] = 'eod-high-close', close = 50000): DailyCandidate => ({
  symbol, pattern, close, high: close * 1.01, low: close * 0.99, open: close * 0.995, volume: 1_000_000, volRatio: 1.5,
  rsi14: 55, ma5: close * 0.99, ma20: close * 0.97, reasoning: `${pattern} 근거`,
});
const dBuy = (symbol: string, over: Record<string, unknown> = {}) => ({
  symbol, action: 'BUY', entry_zone: { lo: 49500, hi: 50500 }, target_pct: 3, stop_pct: 1.5, holding_days: 2, confidence: 80, reasoning: `${symbol} 근거`, ...over,
});
const D = {
  created: '100001', skip: '100002', schema: '100003', invalid: '100004', lowConf: '100005', expensive: '100006',
  dup: '100007', blocked: '100008', insertFail: '100009', none: '100010', override: '100011', candleFail: '100099',
};
const D_DECISIONS = [
  dBuy(D.created),
  { symbol: D.skip, action: 'SKIP', confidence: 40, reasoning: '갭 위험' },
  dBuy(D.schema, { target_pct: undefined }),
  { symbol: D.invalid, action: 'HOLD', confidence: 70, reasoning: '형식 위반' },
  dBuy(D.lowConf, { confidence: 50 }),
  dBuy(D.expensive, { entry_zone: { lo: 150000, hi: 152000 } }),
  dBuy(D.dup),
  dBuy(D.blocked),
  dBuy(D.insertFail),
  dBuy(D.created, { confidence: 59, reasoning: '같은 종목 두 번째 결정(첫 결정이 남는다)' }),
  { symbol: D.override, action: 'SKIP', reasoning: '처음엔 SKIP' },
  dBuy(D.override, { reasoning: '두 번째 결정이 카드를 만들었다' }),
  dBuy('999999'),   // 후보 아닌 종목 — 행 없음
];

function arrangeDomestic(opts: { decisions?: unknown[]; llmRaw?: unknown; llmError?: Error; rag?: unknown | Error } = {}) {
  const syms = [D.created, D.skip, D.schema, D.invalid, D.lowConf, D.expensive, D.dup, D.blocked, D.insertFail, D.none, D.override];
  mAlways.mockResolvedValue([...syms, D.candleFail]);
  mUniverse.mockResolvedValue({});
  mDomCandles.mockImplementation(async (s: string) => {
    if (s === D.candleFail) throw new Error('KIS 500');
    const day = s === D.none ? '2026-10-15' : '2026-10-16';   // 국내 D0 = 마지막 봉 날짜 중 가장 늦은 날
    return [{ ts: Date.parse(`${day}T00:00:00Z`), open: 1, high: 1, low: 1, close: 50000, volume: 1 }];
  });
  mEod.mockImplementation((s: string) => (syms.includes(s) && s !== D.blocked ? dCand(s) : null));
  mInside.mockImplementation((s: string) => (s === D.blocked ? dCand(s, 'inside-bar') : null));
  if (opts.rag instanceof Error) mRag.mockRejectedValue(opts.rag);
  else mRag.mockResolvedValue(opts.rag ?? { totalChars: 10, errors: [], recentNews: [{ id: 'news-1' }, { id: 'news-2' }], pastSignals: [{ id: 'sig-1' }], macroContext: [] });
  if (opts.llmError) mLlm.mockRejectedValue(opts.llmError);
  else mLlm.mockResolvedValue(opts.llmRaw ?? '```json\n' + JSON.stringify({ decisions: opts.decisions ?? D_DECISIONS }) + '\n```');
  // 카드 INSERT 순서: created · dup · blocked · insertFail · override
  db.cardResults = [
    { affectedRows: 1, insertId: 501 },
    { affectedRows: 0 },
    { affectedRows: 1, insertId: 503 },
    Object.assign(new Error('Lock wait timeout exceeded'), { errno: 1205 }),
    { affectedRows: 1, insertId: 511 },
  ];
  db.signalIds = { [D.created]: 501, [D.dup]: 377, [D.blocked]: 503, [D.override]: 511 };
}

describe('① 국내 — 거르기 지점별 기록(동적 대조)', () => {
  beforeEach(() => { setNow(FRI_1602_KST); captureOnly(); });

  test('정상 실행 — 종목 단계·LLM 뒤·카드 단계 제외 사유와 결정·신뢰도·근거·헤더 값', async () => {
    arrangeDomestic();
    const r = await runPostMarketAnalysis('domestic');
    expect(r).toMatchObject({ symbolsEvaluated: 12, candidatesFound: 11, signalsCreated: 2, duplicatesSkipped: 1, unaffordableSkipped: 1, validationBlocked: 1 });
    const s = snap();
    collect(s);
    expect(s).toMatchObject({
      market: 'domestic', judgmentRole: 'baseline', recordable: true, validFrom: '2026-10-19 09:00:00', sessionD0: '2026-10-16',
      candidateCount: 11, dataStatus: { candles: 'partial', news: 'available', llm: 'available' },
      ragContextIds: { news: ['news-1', 'news-2'], signals: ['sig-1'], macro: [] },
    });
    expect(s.promptSha256).toBe(sha256(String(mLlm.mock.calls[0][0])));
    expect(s.asOf).toBeInstanceOf(Date);
    const pick = (sym: string) => { const c = rowOf(s, sym); return [c.pattern, c.sentToLlm, c.aiDecision, c.exclusionCode, c.card, c.confidence]; };
    expect(pick(D.candleFail)).toEqual([null, false, null, 'candle_fail', null, null]);
    expect(pick(D.created)).toEqual(['eod-high-close', true, 'BUY', null, 'created', 80]);
    expect(rowOf(s, D.created).reasoning).toBe(`${D.created} 근거`);   // 같은 종목 두 번째 결정(59)은 남지 않는다
    expect(pick(D.skip)).toEqual(['eod-high-close', true, 'SKIP', null, null, 40]);
    expect(pick(D.schema)).toEqual(['eod-high-close', true, 'BUY', 'schema_invalid', null, 80]);
    expect(pick(D.invalid)).toEqual(['eod-high-close', true, 'INVALID', 'schema_invalid', null, 70]);
    expect(pick(D.lowConf)).toEqual(['eod-high-close', true, 'BUY', 'low_confidence', null, 50]);
    expect(pick(D.expensive)).toEqual(['eod-high-close', true, 'BUY', 'unaffordable', null, 80]);
    expect(pick(D.dup)).toEqual(['eod-high-close', true, 'BUY', 'duplicate', 'duplicate', 80]);
    expect(pick(D.blocked)).toEqual(['inside-bar', true, 'BUY', 'validation_blocked', 'blocked', 80]);
    expect(pick(D.insertFail)).toEqual(['eod-high-close', true, 'BUY', 'insert_fail', null, 80]);
    expect(pick(D.none)).toEqual(['eod-high-close', true, 'NONE', null, null, null]);
    expect(pick(D.override)).toEqual(['eod-high-close', true, 'BUY', null, 'created', 80]);   // SKIP 뒤 카드를 만든 결정으로 바뀐다
    expect(s.candidates.map((c) => c.symbol)).not.toContain('999999');
    expect(s.candidates).toHaveLength(12);
  });

  test('ai_fail — 보낸 후보 전부 llm_error(결정 NULL), 헤더 llm=error', async () => {
    arrangeDomestic({ llmError: new Error('claude timeout') });
    const r = await runPostMarketAnalysis('domestic');
    expect(r.errors.some((e) => e.startsWith('ai_fail:'))).toBe(true);
    const s = snap();
    collect(s);
    expect(s.dataStatus.llm).toBe('error');
    const sent = s.candidates.filter((c) => c.sentToLlm);
    expect(sent).toHaveLength(11);
    expect(sent.every((c) => c.exclusionCode === 'llm_error' && c.aiDecision === null)).toBe(true);
  });

  test('응답 해석 실패(엔진은 빈 목록으로 삼킨다) — 결과는 0건 그대로, 기록은 llm_error 로 구분', async () => {
    arrangeDomestic({ llmRaw: '이건 JSON 이 아님' });
    const r = await runPostMarketAnalysis('domestic');
    expect(r).toMatchObject({ signalsCreated: 0, signalsSkipped: 0, errors: [D.candleFail].map((x) => expect.stringContaining(x)) });
    const s = snap();
    expect(s.dataStatus.llm).toBe('error');
    expect(s.candidates.filter((c) => c.sentToLlm).every((c) => c.exclusionCode === 'llm_error')).toBe(true);
  });

  test('RAG 가 던짐 — news=error, 문맥 id 없음, 분석은 계속', async () => {
    arrangeDomestic({ rag: new Error('KB down') });
    await runPostMarketAnalysis('domestic');
    const s = snap();
    expect(s.dataStatus.news).toBe('error');
    expect(s.ragContextIds).toBeNull();
  });

  test('후보 0건 실행도 헤더가 남는다(candidate_count 0, LLM 없음)', async () => {
    arrangeDomestic();
    mEod.mockReturnValue(null);
    mInside.mockReturnValue(null);
    const r = await runPostMarketAnalysis('domestic');
    expect(r).toMatchObject({ candidatesFound: 0, signalsCreated: 0 });
    const s = snap();
    expect(s).toMatchObject({ recordable: true, candidateCount: 0, asOf: null, promptSha256: null });
    expect(s.candidates.map((c) => c.exclusionCode)).toEqual(['candle_fail']);
  });

  test('주말 건너뜀은 분석 실행이 아니다 — 헤더 없음(기록기는 I/O 0)', async () => {
    setNow(SAT_1602_KST);
    arrangeDomestic();
    const r = await runPostMarketAnalysis('domestic');
    expect(r.skipped).toBe('weekend');
    expect(snap().recordable).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 해외 시나리오
// ─────────────────────────────────────────────────────────────────────────────
const R = 1330;
const candleTs = (d: string) => Date.parse(`${d}T00:00:00Z`);
function oCand(symbol: string, closeUsd: number, pattern: DailyCandidate['pattern'] = 'eod-high-close'): DailyCandidate {
  return {
    symbol, pattern, open: (closeUsd - 0.3) * R, high: (closeUsd + 0.2) * R, low: (closeUsd - 0.4) * R, close: closeUsd * R,
    volume: 1_000_000, volRatio: 1.62, rsi14: 57.3, ma5: (closeUsd - 0.1) * R, ma20: (closeUsd - 0.8) * R, reasoning: '종가 고가권 마감',
  };
}
const oBuy = (symbol: string, lo: number, hi: number, over: Record<string, unknown> = {}) => ({
  symbol, action: 'BUY', entry_zone: { lo, hi }, target_pct: 4, stop_pct: 3, holding_days: 3, confidence: 74, reasoning: `${symbol} 근거`, ...over,
});
const O = {
  fail: 'NAS:FAIL', stale: 'NAS:STALE', blackout: 'NAS:BLK', pre: 'NAS:PRE', created: 'NAS:BUY', skip: 'NAS:SKIP', schema: 'NAS:SCH',
  action: 'NAS:ACT', zone: 'NAS:ZONE', lowConf: 'NAS:LOWC', expensive: 'NAS:EXP', dup: 'NAS:DUP', blocked: 'NYS:VBLK', none: 'NAS:NONE',
};
const O_CLOSES: Record<string, number> = {
  [O.fail]: 27, [O.stale]: 27, [O.blackout]: 27, [O.pre]: 100, [O.created]: 27.4, [O.skip]: 27.4, [O.schema]: 27.4, [O.action]: 27.4,
  [O.zone]: 27.4, [O.lowConf]: 27.4, [O.expensive]: 80, [O.dup]: 27.4, [O.blocked]: 27.4, [O.none]: 27.4,
};
const O_DECISIONS = [
  oBuy(O.created, 27.2, 27.6),
  { symbol: O.skip, action: 'SKIP', confidence: 30, reasoning: '관망' },
  oBuy(O.schema, 27.2, 27.6, { target_pct: 0 }),
  { symbol: O.action, action: 'HOLD', confidence: 70 },
  oBuy(O.zone, 10, 10.2),
  oBuy(O.lowConf, 27.2, 27.6, { confidence: 50 }),
  oBuy(O.expensive, 80, 80.4),
  oBuy(O.dup, 27.2, 27.6),
  oBuy(O.blocked, 27.2, 27.6),
  oBuy(O.created, 27.2, 27.6, { confidence: 99, reasoning: '두 번째 결정 — 엔진이 보지 않는다' }),
  'not-an-object',
];

function arrangeOverseas(opts: { closes?: Record<string, number>; decisions?: unknown[]; llmRaw?: unknown; llmError?: Error } = {}) {
  const closes = opts.closes ?? O_CLOSES;
  const symbols = Object.keys(closes);
  mTargets.mockResolvedValue({ symbols, errors: [] });
  mOvsCandles.mockImplementation(async (s: string) => {
    if (s === O.fail) throw new Error('KIS overseas 500');
    const d = s === O.stale ? '2026-10-19' : '2026-10-20';
    return [{ ts: candleTs(d), open: 1, high: 1, low: 1, close: (closes[s] ?? 27) * R, volume: 1 }];
  });
  mEod.mockImplementation((s: string) => (closes[s] != null && s !== O.blocked ? oCand(s, closes[s]) : null));
  mInside.mockImplementation((s: string) => (s === O.blocked && closes[s] != null ? oCand(s, closes[s], 'inside-bar') : null));
  db.earningsRows = symbols.includes(O.blackout)
    ? [{ symbol: O.blackout, status: 'confirmed', event_time_class: 'AMC', event_date_et: '2026-10-27', window_start_et: null, window_end_et: null }]
    : [];
  mRag.mockResolvedValue({ totalChars: 10, errors: [], recentNews: [{ id: 'us-news-1' }], pastSignals: [], macroContext: [{ id: 'macro-1' }] });
  if (opts.llmError) mLlm.mockRejectedValue(opts.llmError);
  else mLlm.mockResolvedValue(opts.llmRaw ?? JSON.stringify({ decisions: opts.decisions ?? O_DECISIONS }));
  db.cardResults = [{ affectedRows: 1, insertId: 601 }, { affectedRows: 0 }, { affectedRows: 1, insertId: 603 }];   // created · dup · blocked
  db.signalIds = { [O.created]: 601, [O.dup]: 388, [O.blocked]: 603 };
}

describe('① 해외 — 거르기 지점별 기록(동적 대조)', () => {
  beforeEach(() => { setNow(WED_0800_KST); captureOnly(); });

  test('정상 실행 — 종목·후보·LLM 뒤·카드 단계 12개 경로와 결정·헤더 값', async () => {
    arrangeOverseas();
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({
      ok: true, status: 'ok', staleCandleSkipped: 1, blackoutSkipped: 1, prefilterUnaffordable: 1, schemaRejected: 3, zoneRejected: 1,
      unaffordableSkipped: 1, signalsCreated: 1, duplicatesSkipped: 1, validationBlocked: 1,
    });
    const s = snap();
    collect(s);
    expect(s).toMatchObject({
      market: 'overseas', recordable: true, sessionD0: '2026-10-20', validFrom: '2026-10-21 22:30:00', candidateCount: 12,
      dataStatus: { fx: 'available', earnings: 'available', candles: 'partial', news: 'available', llm: 'available' },
      ragContextIds: { news: ['us-news-1'], signals: [], macro: ['macro-1'] },
    });
    expect(s.promptSha256).toBe(sha256(String(mLlm.mock.calls[0][0])));
    const pick = (sym: string) => { const c = rowOf(s, sym); return [c.pattern, c.sentToLlm, c.aiDecision, c.exclusionCode, c.card]; };
    expect(pick(O.fail)).toEqual([null, false, null, 'candle_fail', null]);
    expect(pick(O.stale)).toEqual([null, false, null, 'stale_candle', null]);
    expect(pick(O.blackout)).toEqual(['eod-high-close', false, null, 'blackout', null]);
    expect(pick(O.pre)).toEqual(['eod-high-close', false, null, 'prefilter_unaffordable', null]);
    expect(pick(O.created)).toEqual(['eod-high-close', true, 'BUY', null, 'created']);
    expect(rowOf(s, O.created).confidence).toBe(74);   // 같은 종목 두 번째 결정(99)은 엔진도 기록도 보지 않는다
    expect(pick(O.skip)).toEqual(['eod-high-close', true, 'SKIP', null, null]);
    expect(pick(O.schema)).toEqual(['eod-high-close', true, 'BUY', 'schema_invalid', null]);
    expect(pick(O.action)).toEqual(['eod-high-close', true, 'INVALID', 'schema_invalid', null]);
    expect(pick(O.zone)).toEqual(['eod-high-close', true, 'BUY', 'zone_out_of_range', null]);
    expect(pick(O.lowConf)).toEqual(['eod-high-close', true, 'BUY', 'low_confidence', null]);
    expect(pick(O.expensive)).toEqual(['eod-high-close', true, 'BUY', 'unaffordable', null]);
    expect(pick(O.dup)).toEqual(['eod-high-close', true, 'BUY', 'duplicate', 'duplicate']);
    expect(pick(O.blocked)).toEqual(['inside-bar', true, 'BUY', 'validation_blocked', 'blocked']);
    expect(pick(O.none)).toEqual(['eod-high-close', true, 'NONE', null, null]);
    expect(s.candidates).toHaveLength(14);
  });

  test('카드 트랜잭션 되돌림(insert_fail) — 저장하려던 후보 전부 insert_fail, 헤더는 남는다', async () => {
    arrangeOverseas({ closes: { [O.created]: 27.4, [O.dup]: 27.4 }, decisions: [oBuy(O.created, 27.2, 27.6), oBuy(O.dup, 27.2, 27.6)] });
    db.cardResults = [{ affectedRows: 1, insertId: 601 }, Object.assign(new Error('Deadlock found'), { errno: 1213 })];
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ ok: false, status: 'insert_fail', signalsCreated: 0 });
    const s = snap();
    collect(s);
    expect(s.candidates.map((c) => [c.symbol, c.exclusionCode, c.card])).toEqual([[O.created, 'insert_fail', null], [O.dup, 'insert_fail', null]]);
  });

  test.each([
    ['ai_fail', { llmError: new Error('m4 down') }, 'ai_fail'],
    ['ai_parse_fail', { llmRaw: '{"nope":1}' }, 'ai_parse_fail'],
  ])('%s — 보낸 후보 llm_error, 헤더 llm=error', async (_n, o, status) => {
    arrangeOverseas({ closes: { [O.created]: 27.4, [O.blackout]: 27 }, ...o });
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ ok: false, status });
    const s = snap();
    collect(s);
    expect(s.dataStatus.llm).toBe('error');
    expect(rowOf(s, O.created)).toMatchObject({ sentToLlm: true, exclusionCode: 'llm_error', aiDecision: null });
    expect(rowOf(s, O.blackout)).toMatchObject({ sentToLlm: false, exclusionCode: 'blackout' });
  });

  test('LLM 후보 0 — 헤더·제외 행만, as_of·prompt 없음', async () => {
    arrangeOverseas({ closes: { [O.blackout]: 27, [O.pre]: 100 } });
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ ok: true, llmCandidates: 0 });
    expect(mLlm).not.toHaveBeenCalled();
    const s = snap();
    expect(s).toMatchObject({ recordable: true, candidateCount: 2, asOf: null, promptSha256: null });
    expect(s.candidates.map((c) => c.exclusionCode).sort()).toEqual(['blackout', 'prefilter_unaffordable']);
  });

  test.each([
    ['환율 오래됨(fx_unknown)', () => { db.fxRow = { rate: '1330.0000', age_sec: 99999, fetched_kst: '2026-10-21T01:00:00' }; }, { fx: 'stale' }],
    ['환율 없음(fx_unknown)', () => { db.fxRow = null; }, { fx: 'error' }],
    ['일봉 전부 실패(candles_unavailable)', () => { mOvsCandles.mockRejectedValue(new Error('KIS down')); }, { fx: 'available', earnings: 'available', candles: 'error' }],
  ])('데이터 모름 503 — %s: 헤더만(후보 0), 자료 상태에 원인', async (_n, prep, ds) => {
    arrangeOverseas({ closes: { [O.created]: 27.4 } });
    prep();
    const r = await runPostMarketOverseas();
    expect(r).toMatchObject({ ok: false, status: 'data_unknown' });
    const s = snap();
    expect(s).toMatchObject({ recordable: true, candidateCount: 0, dataStatus: ds });
    expect(s.candidates).toEqual([]);
  });

  test.each([
    ['스위치 꺼짐', () => { db.overseasSwitch = []; }, 'overseas_disabled'],
    ['해외 시장 꺼짐', () => { mOvsEnabled.mockReturnValue(false); }, 'overseas_market_disabled'],
  ])('정상 건너뜀(%s)은 분석 실행이 아니다 — 헤더 없음', async (_n, prep, skipped) => {
    arrangeOverseas();
    prep();
    const r = await runPostMarketOverseas();
    expect(r.skipped).toBe(skipped);
    expect(snap().recordable).toBe(false);
  });
});

describe('① 합집합 — 엔진 분기에서 실제로 나온 exclusion_code = §3.4 시장별 어휘(1:1)', () => {
  test.each(['domestic', 'overseas'] as const)('%s', (market) => {
    expect([...seen[market]].sort()).toEqual([...EXCLUSION_CODES_BY_MARKET[market]].sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ② 영향 0 — 실물 기록기
// ─────────────────────────────────────────────────────────────────────────────
type Mode =
  | 'no_recorder' | 'switch_missing' | 'on_ok' | 'on_no_table' | 'on_insert_hang' | 'switch_read_hang' | 'lookup_fail'
  | 'candidate_insert_fail' | 'entry_throws';
const MODES: Mode[] = ['switch_missing', 'on_ok', 'on_no_table', 'on_insert_hang', 'switch_read_hang', 'lookup_fail', 'candidate_insert_fail', 'entry_throws'];

function applyMode(mode: Mode): { release: () => void } {
  let release = () => {};
  const on = [{ value: 'true' }];
  switch (mode) {
    case 'no_recorder': mRecord.mockImplementation(() => {}); break;
    case 'switch_missing': db.recordSwitch = []; break;
    case 'on_ok': db.recordSwitch = on; break;
    case 'on_no_table': db.recordSwitch = on; db.judgmentRun = NO_TABLE; break;
    case 'on_insert_hang': { db.recordSwitch = on; const d = deferred<void>(); db.judgmentRun = d; release = () => d.resolve(); break; }
    case 'switch_read_hang': { const d = deferred<unknown[]>(); db.recordSwitch = d; release = () => d.resolve(on); break; }
    case 'lookup_fail': db.recordSwitch = on; db.signalLookup = new Error('signals read failed'); break;
    case 'candidate_insert_fail': db.recordSwitch = on; db.judgmentCandidate = Object.assign(new Error('Check constraint'), { errno: 4025 }); break;
    case 'entry_throws': mRecord.mockImplementation(() => { throw new Error('recorder entry exploded'); }); break;
  }
  return { release };
}

/** 엔진이 기록을 기다리지 않는지 — 1.5초 안에 끝나야 한다(기록기 상한 2~4초보다 짧게). */
async function runBounded<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const out = await Promise.race([
    p.then((v) => ({ v })),
    new Promise<'late'>((r) => { timer = setTimeout(() => r('late'), 1500); }),
  ]);
  clearTimeout(timer);
  if (out === 'late') throw new Error('엔진이 1.5초 안에 끝나지 않았다 — 기록을 기다리고 있다');
  return out.v;
}

const engineView = (result: unknown) => ({
  result,
  cardInserts: calls.filter((c) => c.sql.includes('INSERT INTO signals')).map((c) => ({ via: c.via, params: c.params })),
  llmArgs: mLlm.mock.calls,
  ragArgs: mRag.mock.calls,
  gateCalls: mGate.mock.calls,
  commits: conn.commit.mock.calls.length,
  rollbacks: conn.rollback.mock.calls.length,
  logs: (console.log as jest.Mock).mock.calls.map((c) => c.map(String).join(' ')),
  errorLogs: (console.error as jest.Mock).mock.calls.map((c) => c.map(String).join(' ')),
});

async function observe(market: 'domestic' | 'overseas', mode: Mode) {
  resetAll();
  if (market === 'domestic') { setNow(FRI_1602_KST); arrangeDomestic(); } else { setNow(WED_0800_KST); arrangeOverseas(); }
  const { release } = applyMode(mode);
  const result = await runBounded(market === 'domestic' ? runPostMarketAnalysis('domestic') : runPostMarketOverseas());
  const view = engineView(result);
  release();
  const records = await waitForJudgmentRecordsForTest();
  return { view, records, calls: [...calls] };
}

describe.each(['domestic', 'overseas'] as const)('② 🔴 영향 0 (%s) — 기록 상태와 무관하게 분석 결과가 같다', (market) => {
  let baseline: Awaited<ReturnType<typeof observe>>;
  beforeAll(async () => {
    baseline = await observe(market, 'no_recorder');
  });

  test.each(MODES)('%s → 반환값·카드 INSERT 인자·LLM/RAG 인자·관문 호출·로그 동일, 엔진은 기다리지 않는다', async (mode) => {
    const o = await observe(market, mode);
    expect(o.view).toEqual(baseline.view);
  });

  test('on_ok — 커밋된 기록 내용(헤더 1·후보 multi-row 1, 카드 id 조회 1회, signal_id 연결)', async () => {
    const o = await observe(market, 'on_ok');
    expect(o.records).toEqual([expect.objectContaining({ status: 'written', judgmentRunId: 4242, candidates: market === 'domestic' ? 12 : 14 })]);
    const head = o.calls.filter((c) => c.sql.includes('INSERT INTO judgment_run'));
    const cand = o.calls.filter((c) => c.sql.includes('INSERT INTO judgment_candidate'));
    const lookup = o.calls.filter((c) => c.sql.includes('SELECT id, symbol FROM signals'));
    expect([head.length, cand.length, lookup.length]).toEqual([1, 1, 1]);
    // 실행 정보
    const [mkt, role, d0, vf, , , asOf, count, provider, model, prompt] = head[0].params;
    expect([mkt, role, d0, vf, count, provider, model]).toEqual(
      market === 'domestic'
        ? ['domestic', 'baseline', '2026-10-16', '2026-10-19 09:00:00', 11, 'claude', 'sonnet']
        : ['overseas', 'baseline', '2026-10-20', '2026-10-21 22:30:00', 12, 'claude', 'sonnet'],
    );
    expect(typeof asOf).toBe('string');
    expect(prompt).toBe(sha256(String(mLlm.mock.calls[0][0])));
    // 카드 결과가 있는 종목만 조회, signal_id 연결(카드 없는 행은 NULL)
    const rows: unknown[][] = [];
    for (let i = 0; i < cand[0].params.length; i += 10) rows.push(cand[0].params.slice(i, i + 10));
    const sid = Object.fromEntries(rows.map((r) => [r[2], r[9]]));
    if (market === 'domestic') {
      expect((lookup[0].params.slice(1) as string[]).sort()).toEqual([D.created, D.dup, D.blocked, D.override].sort());
      expect(sid).toMatchObject({ [D.created]: 501, [D.dup]: 377, [D.blocked]: 503, [D.override]: 511, [D.insertFail]: null, [D.skip]: null, [D.candleFail]: null });
    } else {
      expect((lookup[0].params.slice(1) as string[]).sort()).toEqual([O.created, O.dup, O.blocked].sort());
      expect(sid).toMatchObject({ [O.created]: 601, [O.dup]: 388, [O.blocked]: 603, [O.zone]: null, [O.fail]: null });
    }
  });

  test('lookup_fail — 카드 id 조회가 실패해도 판단 기록은 signal_id NULL 로 남는다', async () => {
    const o = await observe(market, 'lookup_fail');
    expect(o.records).toEqual([expect.objectContaining({ status: 'written' })]);
    const cand = o.calls.find((c) => c.sql.includes('INSERT INTO judgment_candidate'))!;
    const signalIds = cand.params.filter((_, i) => i % 10 === 9);
    expect(signalIds.every((v) => v === null)).toBe(true);
  });

  test('switch_missing — 스위치 키 없음 = 꺼짐: 스위치 읽기 1회 외 기록 I/O 0', async () => {
    const o = await observe(market, 'switch_missing');
    expect(o.records).toEqual([{ status: 'disabled' }]);
    const recIo = o.calls.filter((c) => /judgment_|SELECT id, symbol FROM signals/.test(c.sql) || c.params[0] === 'judgment_record_enabled');
    expect(recIo.map((c) => c.params[0])).toEqual(['judgment_record_enabled']);
    expect(mProvider).not.toHaveBeenCalled();
  });

  test('on_no_table — 테이블 없음은 조용히 건너뜀(후보 INSERT 시도 없음)', async () => {
    const o = await observe(market, 'on_no_table');
    expect(o.records).toEqual([{ status: 'no_table' }]);
    expect(o.calls.some((c) => c.sql.includes('INSERT INTO judgment_candidate'))).toBe(false);
  });
});

describe('④ 해외 기록은 트랜잭션 연결을 쓰지 않고 커밋 뒤 풀로 쓴다', () => {
  test('judgment_* 문장은 모두 트랜잭션 밖(풀 query·풀에서 따로 받은 연결)·커밋 뒤, 트랜잭션 연결에는 signals INSERT 만', async () => {
    const o = await observe('overseas', 'on_ok');
    const viaConn = o.calls.filter((c) => c.via === 'conn');
    expect(viaConn.length).toBeGreaterThan(0);
    expect(viaConn.every((c) => c.sql.includes('INSERT INTO signals'))).toBe(true);
    const rec = o.calls.filter((c) => /INSERT INTO judgment_|SELECT id, symbol FROM signals/.test(c.sql) || c.params[0] === 'judgment_record_enabled');
    expect(rec.length).toBe(4);
    // (T-135) 카드 id 조회는 풀 query, judgment_* INSERT 2문장은 풀에서 따로 받은 연결 하나(트랜잭션 연결이 아니다 — bounded-conn)
    // (T-139) 기록 스위치 읽기도 풀에서 따로 받은 연결(트랜잭션 연결이 아니다 — bounded-conn) — INSERT 연결과는 **다른** 연결이다
    expect(rec.map((c) => c.via)).toEqual(['poolconn', 'pool', 'poolconn', 'poolconn']);
    const [sw, , run, cand] = rec;
    expect([sw.params[0], run.sql.includes('INSERT INTO judgment_run'), cand.sql.includes('INSERT INTO judgment_candidate')]).toEqual(['judgment_record_enabled', true, true]);
    expect(run.cid).toBe(cand.cid);                                   // INSERT 2문장은 연결 하나
    expect(sw.cid).not.toBe(run.cid);                                 // 스위치 SELECT 는 자기 연결
    const txCids = new Set(viaConn.map((c) => c.cid));
    expect([sw.cid, run.cid].some((id) => txCids.has(id))).toBe(false);   // 둘 다 트랜잭션 연결이 아니다
    expect(commitSeq).toHaveLength(1);
    expect(Math.min(...rec.map((c) => c.seq))).toBeGreaterThan(commitSeq[0]);
  });
});

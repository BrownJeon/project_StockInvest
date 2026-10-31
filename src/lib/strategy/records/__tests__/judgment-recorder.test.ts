/**
 * T-112 B — 기준 판단 기록기(judgment-recorder) 단위 시험.
 *
 *  - 스위치(실물 record-switch): 키 없음·해석 불가 = 꺼짐 → 스위치 읽기 1회 외 I/O 0. 분석 실행이 아니면 I/O 0.
 *  - 헤더·후보 행 값: KST 시각·설정 기준 공급자/모델·engine_release·sha256·JSON 상한, 열마다 코드포인트 자르기(F3).
 *  - 같은 종목 정규화·중복 제거(F5), 32자 초과 종목 제외, 후보 우선 상한, 미전송 행 결정 NULL(chk_jc_decision).
 *  - 실패 삼킴: 테이블 없음(1146, 경고 1회) · CHECK 위반(4025) · insertId 없음 · 카드 id 조회 실패(signal_id NULL 로 기록) ·
 *    getPool 예외 · 시간 상한(4초) — 어느 경우도 던지지 않는다. 진입점은 기다리지 않는다.
 */
import { getPool } from '@/lib/db';
import { getProviderConfig } from '@/lib/llm/provider';
import {
  JUDGMENT_RECORD_TIMEOUT_MS,
  MAX_CANDIDATE_ROWS,
  buildJudgmentCandidateRows,
  buildJudgmentRunRow,
  dataStatusJson,
  engineReleaseFromCwd,
  ragContextIdsJson,
  readLlmSetting,
  recordJudgment,
  recordJudgmentDetached,
  resetJudgmentRecorderForTest,
  waitForJudgmentRecordsForTest,
} from '../judgment-recorder';
import { resetRecordSwitchCacheForTest } from '../record-switch';
import { JudgmentTrace, type CandidateTrace, type JudgmentRunSnapshot } from '../judgment-trace';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/llm/provider', () => ({ getProviderConfig: jest.fn() }));

const mGetPool = getPool as jest.Mock;
const mProvider = getProviderConfig as jest.Mock;

type Handler = (sql: string, params: unknown[]) => unknown;
let query: jest.Mock;
let handlers: { switch: Handler; lookup: Handler; run: Handler; cand: Handler };
/** (T-135) 풀 연결 — INSERT 는 이 연결로 간다. 문장은 같은 `query` 목에 남기고(기존 단언 그대로), 어느 창구로 왔는지만 따로 센다.
 *  (T-139) 기록 스위치 읽기(`record-switch.ts`)도 풀에서 **자기** 연결을 받는다. 받을 때마다 새 연결을 주고 처음 보낸 문장으로 갈라 —
 *  스위치 SELECT 로 시작한 연결의 문장·끝은 swConnQuery·swRelease·swDestroy 로, 나머지(INSERT 연결·문장 없이 끝난 늦은 연결)는 예전처럼
 *  connQuery·connRelease·connDestroy 로 센다. `ends()` 의 받은 수도 INSERT 쪽 연결만이다(스위치 연결이 섞이면 T-135 단언이 흐려진다). */
interface FakeConn { query: (sql: string, params?: unknown[]) => unknown; release: () => void; destroy: () => void; isSwitch: () => boolean }
let connQuery: jest.Mock;
let connRelease: jest.Mock;
let connDestroy: jest.Mock;
let swConnQuery: jest.Mock;
let swRelease: jest.Mock;
let swDestroy: jest.Mock;
let conns: FakeConn[];
let getConnection: jest.Mock;

function makeConn(): FakeConn {
  let kind: 'switch' | 'other' | null = null;
  const kindOf = (sql: string) => (kind ??= sql.includes('FROM system_config') ? 'switch' : 'other');
  const c: FakeConn = {
    query: (sql, params) => (kindOf(sql) === 'switch' ? swConnQuery(sql, params) : connQuery(sql, params)),
    release: () => { if (kind === 'switch') swRelease(); else connRelease(); },
    destroy: () => { if (kind === 'switch') swDestroy(); else connDestroy(); },
    isSwitch: () => kind === 'switch',
  };
  conns.push(c);
  return c;
}
/** (T-139) 기록 1회는 스위치 읽기(캐시 비움) → INSERT 순서다 — 첫 연결 받기(스위치)는 정상으로 두고 그 뒤(INSERT)만 impl 로 바꾼다.
 *  첫 연결이 정말 스위치 SELECT 에 쓰였는지는 각 시험이 swEnds() 로 확인한다. */
function insertConnWith(impl: () => Promise<unknown>): void {
  getConnection.mockImplementation(impl);
  getConnection.mockImplementationOnce(async () => makeConn());
}
/** (T-139) 스위치 연결의 [받은 수, release, destroy]. */
const swEnds = () => [conns.filter((c) => c.isSwitch()).length, swRelease.mock.calls.length, swDestroy.mock.calls.length];

function wire() {
  handlers = {
    switch: () => [[{ value: 'true' }], undefined],
    lookup: () => [[], undefined],
    run: () => [{ affectedRows: 1, insertId: 77 }, undefined],
    cand: (_s, p) => [{ affectedRows: p.length / 10 }, undefined],
  };
  query = jest.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM system_config')) return handlers.switch(sql, params);
    if (sql.includes('SELECT id, symbol FROM signals')) return handlers.lookup(sql, params);
    if (sql.includes('INSERT INTO judgment_run')) return handlers.run(sql, params);
    if (sql.includes('INSERT INTO judgment_candidate')) return handlers.cand(sql, params);
    throw new Error(`예상하지 못한 SQL: ${sql.slice(0, 60)}`);
  });
  connQuery = jest.fn((sql: string, params?: unknown[]) => query(sql, params));
  connRelease = jest.fn();
  connDestroy = jest.fn();
  swConnQuery = jest.fn((sql: string, params?: unknown[]) => query(sql, params));
  swRelease = jest.fn();
  swDestroy = jest.fn();
  conns = [];
  getConnection = jest.fn(async () => makeConn());
  mGetPool.mockReturnValue({ query, getConnection });
}
const callsOf = (needle: string) => query.mock.calls.filter((c) => String(c[0]).includes(needle));
const candRows = () => {
  const p = callsOf('INSERT INTO judgment_candidate')[0][1] as unknown[];
  const rows: unknown[][] = [];
  for (let i = 0; i < p.length; i += 10) rows.push(p.slice(i, i + 10));
  return rows;
};

const cand = (over: Partial<CandidateTrace> & Pick<CandidateTrace, 'symbol'>): CandidateTrace => ({
  pattern: 'eod-high-close', exclusionCode: null, sentToLlm: true, aiDecision: 'BUY', confidence: 80, reasoning: '근거', card: null, ...over,
});
function snapOf(over: Partial<JudgmentRunSnapshot> = {}): JudgmentRunSnapshot {
  return {
    market: 'overseas', judgmentRole: 'baseline', recordable: true,
    startedAt: new Date('2026-10-20T23:00:00Z'), endedAt: new Date('2026-10-20T23:01:30Z'),
    sessionD0: '2026-10-20', validFrom: '2026-10-21 22:30:00', asOf: new Date('2026-10-20T23:00:40Z'),
    candidateCount: 2, promptSha256: 'a'.repeat(64),
    ragContextIds: { news: ['n1'], signals: [], macro: ['m1'] },
    dataStatus: { candles: 'available', news: 'available', llm: 'available' },
    candidates: [cand({ symbol: 'NAS:AAA', card: 'created' }), cand({ symbol: 'NAS:BBB', aiDecision: 'SKIP', confidence: 30 })],
    traceErrors: 0,
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  resetRecordSwitchCacheForTest();
  resetJudgmentRecorderForTest();
  wire();
  mProvider.mockResolvedValue({ provider: 'claude', homeM4ApiModel: 'qwen2.5:14b-instruct', stage1Model: 'glm-4.7-flash' });
});
afterEach(async () => {
  await waitForJudgmentRecordsForTest();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('스위치·대상', () => {
  test('분석 실행이 아니면(recordable=false) I/O 0', async () => {
    await expect(recordJudgment(snapOf({ recordable: false }))).resolves.toEqual({ status: 'not_recordable' });
    expect(mGetPool).not.toHaveBeenCalled();
    expect(mProvider).not.toHaveBeenCalled();
  });

  test.each([
    ['키 없음', [] as unknown[]],
    ['false', [{ value: 'false' }]],
    ['문자열 "true"(JSON 문자열)', [{ value: '"true"' }]],
    ['1', [{ value: '1' }]],
    ['해석 불가', [{ value: 'yes' }]],
  ])('🔴 스위치 %s → 꺼짐: 스위치 읽기 1회 외 I/O 0', async (_n, rows) => {
    handlers.switch = () => [rows, undefined];
    await expect(recordJudgment(snapOf())).resolves.toEqual({ status: 'disabled' });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual(['judgment_record_enabled']);
    expect(mProvider).not.toHaveBeenCalled();
  });

  test('스위치 읽기 오류 = 꺼짐(던지지 않음)', async () => {
    handlers.switch = () => { throw new Error('ECONNREFUSED'); };
    await expect(recordJudgment(snapOf())).resolves.toEqual({ status: 'disabled' });
    expect(callsOf('judgment_run')).toHaveLength(0);
  });
});

describe('헤더 행', () => {
  test('정상 — KST 벽시계·설정 기준 공급자/모델·sha256·JSON·engine_release, 후보 multi-row 1문장', async () => {
    jest.spyOn(process, 'cwd').mockReturnValue('/home/brownjeon/apps/stockinvest/releases/20261030-051343-9d087a4d');
    handlers.lookup = () => [[{ id: 601, symbol: 'NAS:AAA' }], undefined];
    await expect(recordJudgment(snapOf())).resolves.toEqual({ status: 'written', judgmentRunId: 77, candidates: 2, dropped: 0 });
    const head = callsOf('INSERT INTO judgment_run')[0][1];
    expect(head).toEqual([
      'overseas', 'baseline', '2026-10-20', '2026-10-21 22:30:00', '2026-10-21 08:00:00', '2026-10-21 08:01:30', '2026-10-21 08:00:40', 2,
      'claude', 'sonnet', 'a'.repeat(64), '{"news":["n1"],"signals":[],"macro":["m1"]}',
      '{"candles":"available","news":"available","llm":"available"}', '20261030-051343-9d087a4d',
    ]);
    expect(candRows()).toEqual([
      [77, 'baseline', 'NAS:AAA', 'eod-high-close', null, 1, 'BUY', 80, '근거', 601],
      [77, 'baseline', 'NAS:BBB', 'eod-high-close', null, 1, 'SKIP', 30, '근거', null],
    ]);
    // 카드 결과가 있는 종목만, 유니크 키 열로 한 번
    const lk = callsOf('SELECT id, symbol FROM signals');
    expect(lk).toHaveLength(1);
    expect(String(lk[0][0])).toMatch(/side = 'buy' AND scenario_source = 'post-market' AND valid_from = \?/);
    expect(lk[0][1]).toEqual(['2026-10-21 22:30:00', 'NAS:AAA']);
  });

  test('카드 결과가 하나도 없으면 카드 id 조회를 하지 않는다', async () => {
    await recordJudgment(snapOf({ candidates: [cand({ symbol: 'NAS:AAA' })] }));
    expect(callsOf('SELECT id, symbol FROM signals')).toHaveLength(0);
  });

  test.each([
    [{ provider: 'claude' }, 'claude', 'sonnet'],
    [{ provider: 'home-m4-api', homeM4ApiModel: 'llama3.3' }, 'home-m4-api', 'llama3.3'],
    [{ provider: 'hybrid', stage1Model: 'glm-4.7-flash', homeM4ApiModel: 'x' }, 'hybrid', 'glm-4.7-flash'],
  ])('설정 기준 모델 %j', async (cfg, provider, model) => {
    mProvider.mockResolvedValue(cfg);
    await expect(readLlmSetting()).resolves.toEqual({ provider, model });
  });

  test('설정 읽기 실패 → 공급자·모델 NULL 로 기록은 계속', async () => {
    mProvider.mockRejectedValue(new Error('db down'));
    await expect(recordJudgment(snapOf())).resolves.toMatchObject({ status: 'written' });
    expect(callsOf('INSERT INTO judgment_run')[0][1].slice(8, 10)).toEqual([null, null]);
  });

  test('engine_release — 릴리스 디렉터리일 때만, 48자', () => {
    expect(engineReleaseFromCwd('/home/brownjeon/apps/stockinvest/releases/20261030-051343-9d087a4d')).toBe('20261030-051343-9d087a4d');
    expect(engineReleaseFromCwd('/home/brownjeon/apps/stockinvest/releases/x/')).toBe('x');
    expect(engineReleaseFromCwd('/home/brownjeon/.node-local/stockinvest-t112')).toBeNull();
    expect(engineReleaseFromCwd(`/a/releases/${'r'.repeat(60)}`)).toHaveLength(48);
    expect(engineReleaseFromCwd(undefined)).toBeNull();
  });

  test('valid_from·시작 시각을 만들 수 없으면 기록하지 않는다(invalid)', async () => {
    await expect(recordJudgment(snapOf({ validFrom: '2026-10-21T22:30:00Z' }))).resolves.toEqual({ status: 'invalid' });
    await expect(recordJudgment(snapOf({ validFrom: null }))).resolves.toEqual({ status: 'invalid' });
    await expect(recordJudgment(snapOf({ startedAt: new Date('x') }))).resolves.toEqual({ status: 'invalid' });
    expect(callsOf('INSERT INTO')).toHaveLength(0);
  });

  test('형식이 틀린 값은 NULL — session_d0·prompt_sha256·ended_at·as_of, candidate_count 는 0~65535 정수', () => {
    const h = buildJudgmentRunRow(snapOf({
      sessionD0: '20261020', promptSha256: 'ABC', endedAt: null, asOf: new Date('bad'), candidateCount: 1e9,
    }), { provider: null, model: null, engineRelease: null })!;
    expect([h.session_d0, h.prompt_sha256, h.ended_at, h.as_of, h.candidate_count]).toEqual([null, null, null, null, 65535]);
  });

  test('provider·model 은 24·64 코드포인트로 자른다(F3)', () => {
    const h = buildJudgmentRunRow(snapOf(), { provider: 'p'.repeat(30), model: '😀'.repeat(70), engineRelease: null })!;
    expect(Array.from(h.llm_provider!)).toHaveLength(24);
    expect(Array.from(h.llm_model!)).toHaveLength(64);
    expect(h.llm_model).toBe('😀'.repeat(64));
  });

  test('RAG 문맥 id JSON — 4096자 이하로 줄이고(가장 긴 목록 끝부터), 문맥 없음은 NULL', () => {
    expect(ragContextIdsJson(null)).toBeNull();
    expect(ragContextIdsJson({ news: [], signals: [], macro: [] })).toBe('{"news":[],"signals":[],"macro":[]}');
    const long = (k: string) => Array.from({ length: 30 }, (_, i) => `${k}-${String(i).padStart(3, '0')}-${'x'.repeat(200)}`);
    const j = ragContextIdsJson({ news: long('n'), signals: long('s'), macro: long('m') })!;
    expect(j.length).toBeLessThanOrEqual(4096);
    const o = JSON.parse(j);
    expect(o.news[0]).toHaveLength(128);   // id 하나 128자
    expect(o.news.length + o.signals.length + o.macro.length).toBeGreaterThan(0);
    expect(o.news.length).toBeLessThanOrEqual(20);
  });

  test('자료 상태 JSON — J5 어휘만, 비면 NULL', () => {
    expect(dataStatusJson({ candles: 'available', fx: 'stale', nope: 'available', llm: 'weird' })).toBe('{"candles":"available","fx":"stale"}');
    expect(dataStatusJson({})).toBeNull();
    expect(dataStatusJson(null)).toBeNull();
  });
});

describe('후보 행 — F3 자르기 · F5 정규화·중복 제거 · CHECK 일관', () => {
  test('🔴 근거 501자 → 500 코드포인트, 이모지 경계를 쪼개지 않는다', () => {
    const ascii = 'a'.repeat(501);
    const emoji = 'b'.repeat(499) + '😀😀';   // 500번째·501번째가 서로게이트 쌍
    const { rows } = buildJudgmentCandidateRows(snapOf({ candidates: [cand({ symbol: 'A', reasoning: ascii }), cand({ symbol: 'B', reasoning: emoji })] }));
    expect(rows[0].ai_reasoning).toHaveLength(500);
    expect(Array.from(rows[1].ai_reasoning!)).toHaveLength(500);
    expect(rows[1].ai_reasoning!.endsWith('😀')).toBe(true);
    expect(/[\uD800-\uDBFF]$/.test(rows[1].ai_reasoning!)).toBe(false);
  });

  test('🔴 같은 종목의 대소문자·공백 변형은 한 행(첫 행 유지), 32자 넘는 종목은 행을 뺀다', () => {
    const { rows, dropped } = buildJudgmentCandidateRows(snapOf({
      candidates: [
        cand({ symbol: 'nas:mu', reasoning: '첫' }),
        cand({ symbol: 'NAS:MU ', reasoning: '둘' }),
        cand({ symbol: ` ${'X'.repeat(33)}` }),
        cand({ symbol: '' }),
        cand({ symbol: 'NAS:OK' }),
      ],
    }));
    expect(rows.map((r) => [r.symbol, r.ai_reasoning])).toEqual([['NAS:MU', '첫'], ['NAS:OK', '근거']]);
    expect(dropped).toBe(3);
  });

  test('패턴 32자·코드 어휘 밖 = NULL·결정 어휘 밖 = NULL·신뢰도 범위 밖 = NULL', () => {
    const { rows } = buildJudgmentCandidateRows(snapOf({
      candidates: [cand({ symbol: 'A', pattern: 'p'.repeat(40), exclusionCode: 'made_up' as never, aiDecision: 'MAYBE' as never, confidence: 120 })],
    }));
    expect(rows[0]).toMatchObject({ pattern: 'p'.repeat(32), exclusion_code: null, ai_decision: null, confidence: null });
  });

  test('미전송 행은 결정·신뢰도·근거 NULL(chk_jc_decision: sent_to_llm=1 OR ai_decision IS NULL)', () => {
    const { rows } = buildJudgmentCandidateRows(snapOf({
      candidates: [cand({ symbol: 'A', sentToLlm: false, aiDecision: 'BUY', confidence: 90, reasoning: 'x', exclusionCode: 'blackout' })],
    }));
    expect(rows[0]).toMatchObject({ sent_to_llm: 0, ai_decision: null, confidence: null, ai_reasoning: null, exclusion_code: 'blackout' });
  });

  test(`상한 ${MAX_CANDIDATE_ROWS}행 — 후보(패턴 있음) 행을 먼저 남기고 종목 단계 제외 행부터 버린다`, () => {
    const symbolLevel = Array.from({ length: 300 }, (_, i) => cand({ symbol: `F${i}`, pattern: null, sentToLlm: false, aiDecision: null, exclusionCode: 'candle_fail' }));
    const real = Array.from({ length: 300 }, (_, i) => cand({ symbol: `C${i}` }));
    const { rows, dropped } = buildJudgmentCandidateRows(snapOf({ candidates: [...symbolLevel, ...real] }));
    expect(rows).toHaveLength(MAX_CANDIDATE_ROWS);
    expect(rows.slice(0, 300).every((r) => r.pattern != null)).toBe(true);
    expect(dropped).toBe(100);
  });

  test('카드 id — 조회 결과의 대소문자가 달라도 정규화해 잇는다, 문자열 id 도 숫자로', async () => {
    handlers.lookup = () => [[{ id: '601', symbol: 'nas:aaa' }], undefined];
    await recordJudgment(snapOf());
    expect(candRows()[0][9]).toBe(601);
  });
});

describe('🔴 실패 삼킴 — 던지지 않는다', () => {
  test('테이블 없음(1146) → no_table, 후보 INSERT 시도 없음, 경고는 프로세스당 1회', async () => {
    handlers.run = () => { throw Object.assign(new Error("Table 'x.judgment_run' doesn't exist"), { errno: 1146 }); };
    await expect(recordJudgment(snapOf())).resolves.toEqual({ status: 'no_table' });
    await expect(recordJudgment(snapOf())).resolves.toEqual({ status: 'no_table' });
    expect(callsOf('INSERT INTO judgment_candidate')).toHaveLength(0);
    const warns = (console.warn as jest.Mock).mock.calls.filter((c) => String(c[0]).includes('테이블이 없어'));
    expect(warns).toHaveLength(1);
  });

  test('헤더 CHECK 위반(4025) → error, 후보 INSERT 없음', async () => {
    handlers.run = () => { throw Object.assign(new Error('CONSTRAINT `chk_jr_rag` failed'), { errno: 4025, code: 'ER_INNODB_AUTOEXTEND_SIZE_OUT_OF_RANGE' }); };
    await expect(recordJudgment(snapOf())).resolves.toMatchObject({ status: 'error' });
    expect(String((console.warn as jest.Mock).mock.calls.at(-1)?.[0])).toContain('4025');
    expect(callsOf('INSERT INTO judgment_candidate')).toHaveLength(0);
  });

  test('후보 INSERT 실패 → partial(헤더 id 남김)', async () => {
    handlers.cand = () => { throw Object.assign(new Error('Data too long'), { errno: 1406 }); };
    await expect(recordJudgment(snapOf())).resolves.toMatchObject({ status: 'partial', judgmentRunId: 77 });
  });

  test('헤더 insertId 없음 → 후보 INSERT 없이 partial', async () => {
    handlers.run = () => [{ affectedRows: 1, insertId: 0 }, undefined];
    await expect(recordJudgment(snapOf())).resolves.toMatchObject({ status: 'partial', error: 'no_insert_id' });
    expect(callsOf('INSERT INTO judgment_candidate')).toHaveLength(0);
  });

  test('🔴 카드 id 조회 실패 → 판단 기록은 signal_id NULL 로 남는다', async () => {
    handlers.lookup = () => { throw new Error('signals read failed'); };
    await expect(recordJudgment(snapOf())).resolves.toMatchObject({ status: 'written' });
    expect(candRows().map((r) => r[9])).toEqual([null, null]);
  });

  test('getPool() 이 스위치 뒤에 던져도 결과는 error(거부·예외 없음)', async () => {
    let n = 0;
    // (T-139) 첫 getPool 은 스위치 읽기 — 스위치는 풀에서 연결을 받으므로 첫 풀도 getConnection 을 준다(그 뒤의 getPool 만 던진다)
    mGetPool.mockImplementation(() => { if (n++ === 0) return { query, getConnection }; throw new Error('pool closed'); });
    await expect(recordJudgment(snapOf({ candidates: [cand({ symbol: 'A' })] }))).resolves.toMatchObject({ status: 'error' });
  });

  test('🔴 시간 상한 — 헤더 INSERT 가 영원히 안 끝나도 상한에서 timeout 으로 돌아온다', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    handlers.run = () => new Promise(() => {});
    const p = recordJudgment(snapOf());
    await jest.advanceTimersByTimeAsync(JUDGMENT_RECORD_TIMEOUT_MS - 1);
    let settled = false;
    void p.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(2);
    await expect(p).resolves.toEqual({ status: 'timeout' });
  });
});

describe('🔴 진입점 recordJudgmentDetached — 기다리지 않고 던지지 않는다', () => {
  function traceRecordable() {
    const t = new JudgmentTrace('domestic', new Date('2026-10-16T07:00:00Z'));
    t.session('2026-10-19 09:00:00');
    t.candidates([{ symbol: '005930', pattern: 'eod-high-close' }]);
    return t;
  }

  test('동기 반환(undefined) — 스위치 읽기가 멈춰 있어도 바로 돌아오고, 뒤에서 끝난다', async () => {
    let release!: (v: unknown) => void;
    handlers.switch = () => new Promise((r) => { release = r; });
    const t = traceRecordable();
    expect(recordJudgmentDetached(t)).toBeUndefined();
    expect(callsOf('judgment_run')).toHaveLength(0);
    // (T-139) 스위치 SELECT 는 풀에서 연결을 받은 뒤(마이크로태스크 몇 개 뒤) 나간다 — 나가서 매달린 것을 확인한 뒤 푼다
    for (let i = 0; i < 50 && callsOf('FROM system_config').length === 0; i++) await Promise.resolve();
    expect(callsOf('FROM system_config')).toHaveLength(1);
    expect(callsOf('judgment_run')).toHaveLength(0);
    release([[{ value: 'true' }], undefined]);
    await expect(waitForJudgmentRecordsForTest()).resolves.toEqual([expect.objectContaining({ status: 'written' })]);
    expect(callsOf('INSERT INTO judgment_run')).toHaveLength(1);
    expect(t.snapshot().endedAt).toBeInstanceOf(Date);   // 진입점이 추적을 닫는다
  });

  test('분석 실행이 아니면 I/O 0', async () => {
    recordJudgmentDetached(new JudgmentTrace('overseas'));
    await expect(waitForJudgmentRecordsForTest()).resolves.toEqual([]);
    expect(mGetPool).not.toHaveBeenCalled();
  });

  test('추적 객체가 망가져도(snapshot 이 던짐) 던지지 않는다', () => {
    const broken = { finish: () => undefined, snapshot: () => { throw new Error('boom'); } } as unknown as JudgmentTrace;
    expect(() => recordJudgmentDetached(broken)).not.toThrow();
    expect(() => recordJudgmentDetached(null as unknown as JudgmentTrace)).not.toThrow();
  });

  test('getPool 이 처음부터 던져도 진입점·기록 모두 던지지 않는다', async () => {
    mGetPool.mockImplementation(() => { throw new Error('no pool'); });
    expect(() => recordJudgmentDetached(traceRecordable())).not.toThrow();
    await expect(waitForJudgmentRecordsForTest()).resolves.toEqual([{ status: 'disabled' }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (T-135) INSERT 연결 — 하나만 받고, 정상 = release 1 · 오류 = destroy 1 · 상한 = **상한 시점에** destroy ·
// 상한 뒤에 받은 연결은 쓰지 않고 release · 상한 뒤에는 새 문장을 보내지 않고 경고도 더하지 않는다(실 풀·잠긴 표는 일회용 MariaDB 시험 E)
// ─────────────────────────────────────────────────────────────────────────────
describe('🔴 (T-135) INSERT 는 연결 하나로 — 상한이면 그 연결을 풀에서 뺀다', () => {
  const ownWarns = () => (console.warn as jest.Mock).mock.calls.map((c) => String(c[0])).filter((m) => m.startsWith('[strategy/records/judgment]'));
  /** INSERT 쪽 연결의 [받은 수, release, destroy] — (T-139) 스위치 SELECT 연결은 빼고 센다(swEnds). */
  const ends = () => [conns.filter((c) => !c.isSwitch()).length, connRelease.mock.calls.length, connDestroy.mock.calls.length];
  const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };

  test('정상 — 연결 1개로 INSERT 2문장(헤더·후보), 카드 id 조회는 풀 query, 끝나면 release 1 · (T-139) 스위치 읽기는 자기 연결 1개(release 1)', async () => {
    handlers.lookup = () => [[{ id: 601, symbol: 'NAS:AAA' }], undefined];
    await expect(recordJudgment(snapOf())).resolves.toEqual({ status: 'written', judgmentRunId: 77, candidates: 2, dropped: 0 });
    expect(ends()).toEqual([1, 1, 0]);
    expect(connQuery.mock.calls.map((c) => String(c[0]).trim().split('\n')[0])).toEqual(['INSERT INTO judgment_run', 'INSERT INTO judgment_candidate']);
    // INSERT 연결로 간 문장 = 전체 문장 중 INSERT 전부(스위치·조회는 INSERT 연결로 가지 않는다)
    expect(query.mock.calls.filter((c) => String(c[0]).includes('INSERT INTO')).length).toBe(connQuery.mock.calls.length);
    // (T-139) 스위치 연결로 간 문장 = 스위치 SELECT 1문장뿐, 그 연결은 release
    expect(swConnQuery.mock.calls).toEqual([['SELECT value FROM system_config WHERE `key` = ? LIMIT 1', ['judgment_record_enabled']]]);
    expect(swEnds()).toEqual([1, 1, 0]);
    // 카드 id 조회는 풀 query 그대로(어느 연결로도 가지 않는다)
    expect(callsOf('SELECT id, symbol FROM signals')).toHaveLength(1);
    expect([...connQuery.mock.calls, ...swConnQuery.mock.calls].some((c) => String(c[0]).includes('SELECT id, symbol FROM signals'))).toBe(false);
  });

  test('후보 0건 — 헤더 1문장도 연결로, release 1', async () => {
    await expect(recordJudgment(snapOf({ candidates: [] }))).resolves.toMatchObject({ status: 'written', candidates: 0 });
    expect(ends()).toEqual([1, 1, 0]);
    expect(connQuery).toHaveBeenCalledTimes(1);
    expect(swEnds()).toEqual([1, 1, 0]);
  });

  test('꺼짐·형식 밖 헤더·분석 실행 아님 → INSERT 연결을 받지 않는다((T-139) 스위치 읽기의 연결만)', async () => {
    handlers.switch = () => [[], undefined];
    await expect(recordJudgment(snapOf())).resolves.toEqual({ status: 'disabled' });
    resetRecordSwitchCacheForTest();
    handlers.switch = () => [[{ value: 'true' }], undefined];
    await expect(recordJudgment(snapOf({ validFrom: 'bad' }))).resolves.toEqual({ status: 'invalid' });
    await expect(recordJudgment(snapOf({ recordable: false }))).resolves.toEqual({ status: 'not_recordable' });
    expect(ends()).toEqual([0, 0, 0]);
    expect(connQuery).not.toHaveBeenCalled();
    // (T-139) 꺼짐·형식 밖 헤더는 스위치를 읽었다(캐시를 비웠으므로 2회 — 각각 자기 연결, release), 분석 실행 아님은 I/O 0
    expect(swEnds()).toEqual([2, 2, 0]);
    expect(getConnection).toHaveBeenCalledTimes(2);
  });

  test.each([
    ['헤더 테이블 없음(1146)', 'run', 1146, { status: 'no_table' }],
    ['헤더 CHECK 위반(4025)', 'run', 4025, { status: 'error' }],
    ['후보 길이 초과(1406)', 'cand', 1406, { status: 'partial', judgmentRunId: 77 }],
  ] as const)('%s → 그 연결은 destroy 1(release 0)', async (_n, which, errno, expected) => {
    handlers[which] = () => { throw Object.assign(new Error('x'), { errno }); };
    await expect(recordJudgment(snapOf())).resolves.toMatchObject(expected);
    expect(ends()).toEqual([1, 0, 1]);
    expect(swEnds()).toEqual([1, 1, 0]);   // (T-139) 스위치 연결은 INSERT 오류와 무관하게 release
  });

  test('연결 받기 실패 → error, INSERT 0, 경고는 예전 풀 실패와 같은 줄(분류 문구 그대로)', async () => {
    insertConnWith(async () => { throw Object.assign(new Error('Pool is closed'), { errno: 2013 }); });
    await expect(recordJudgment(snapOf())).resolves.toEqual({ status: 'error', error: 'Pool is closed' });
    expect(callsOf('INSERT INTO')).toHaveLength(0);
    expect(ownWarns()).toEqual(['[strategy/records/judgment] judgment_run 기록 실패 — 분석 영향 없음: Pool is closed']);
    expect([connRelease.mock.calls.length, connDestroy.mock.calls.length]).toEqual([0, 0]);
    expect(swEnds()).toEqual([1, 1, 0]);   // (T-139) 실패한 것은 INSERT 연결 받기 — 스위치는 읽혔다
  });

  test('🔴 상한 — 헤더 INSERT 가 매달리면 **상한 시점에** 그 연결을 destroy, 늦은 실패가 와도 경고는 timeout 한 줄뿐', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    let rejectLate!: (e: unknown) => void;
    handlers.run = () => new Promise((_, rej) => { rejectLate = rej; });
    const p = recordJudgment(snapOf());
    await jest.advanceTimersByTimeAsync(JUDGMENT_RECORD_TIMEOUT_MS - 1);
    expect(callsOf('INSERT INTO judgment_run')).toHaveLength(1);
    expect(connDestroy).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(2);
    await expect(p).resolves.toEqual({ status: 'timeout' });
    expect(ends()).toEqual([1, 0, 1]);                                     // 늦은 실패가 오기 **전에** 이미 뺐다
    rejectLate(Object.assign(new Error('Connection lost: The server closed the connection.'), { errno: 2013 }));
    await flush();
    expect(ownWarns()).toEqual([`[strategy/records/judgment] 판단 기록이 ${JUDGMENT_RECORD_TIMEOUT_MS}ms 안에 끝나지 않아 포기 — 분석 영향 없음`]);
    expect(ends()).toEqual([1, 0, 1]);                                     // 늦은 실패도 연결을 다시 건드리지 않는다
    expect(callsOf('INSERT INTO judgment_candidate')).toHaveLength(0);
    expect(swEnds()).toEqual([1, 1, 0]);                                   // (T-139) 스위치 연결은 INSERT 전에 이미 release
  });

  test('🔴 상한 뒤 헤더가 늦게 성공해도 후보 INSERT 를 보내지 않는다(늦은 기록 없음)', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    let finishLate!: (v: unknown) => void;
    handlers.run = () => new Promise((r) => { finishLate = r; });
    const p = recordJudgment(snapOf());
    await jest.advanceTimersByTimeAsync(JUDGMENT_RECORD_TIMEOUT_MS + 1);
    await expect(p).resolves.toEqual({ status: 'timeout' });
    finishLate([{ affectedRows: 1, insertId: 78 }, undefined]);
    await flush();
    expect(callsOf('INSERT INTO judgment_candidate')).toHaveLength(0);
    expect(ends()).toEqual([1, 0, 1]);
    expect(ownWarns()).toHaveLength(1);
  });

  test('🔴 풀이 바빠 상한 뒤에야 받은 연결 — 문장을 보내지 않고 release, 결과는 timeout', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    let give!: (c: unknown) => void;
    insertConnWith(() => new Promise((r) => { give = r; }));
    const p = recordJudgment(snapOf());
    await jest.advanceTimersByTimeAsync(JUDGMENT_RECORD_TIMEOUT_MS + 1);
    await expect(p).resolves.toEqual({ status: 'timeout' });
    expect(getConnection).toHaveBeenCalledTimes(2);                       // (T-139) 스위치 연결 1(읽고 release) + INSERT 연결 1(받는 중)
    expect(swEnds()).toEqual([1, 1, 0]);
    give(makeConn());
    await flush();
    expect(connQuery).not.toHaveBeenCalled();
    expect(callsOf('INSERT INTO')).toHaveLength(0);
    expect([connRelease.mock.calls.length, connDestroy.mock.calls.length]).toEqual([1, 0]);
    expect(ownWarns()).toHaveLength(1);
  });
});

/**
 * T-112 job-run-log — 스풀 줄 해석·상태 분류기(§2.3)·행 조립·롤업(U2)·SQL(b′)·기록(스위치·테이블 없음·값 오류·시간 상한) 시험.
 * DB 는 목(`@/lib/db`), 스위치는 목(`../record-switch`). 실제 DB 의미(b′ 6단계·NULL 회복·롤업 가산)는 job-run-log-disposable-mariadb.test.ts.
 */
const queryMock = jest.fn();
const switchMock = jest.fn();
jest.mock('@/lib/db', () => ({ getPool: () => ({ query: queryMock }) }));
jest.mock('../record-switch', () => ({ readRecordSwitchState: (...a: unknown[]) => switchMock(...a) }));

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  JRL_COLUMNS,
  JRL_LEN,
  ROLLUP_ODKU,
  RUN_ODKU,
  buildRows,
  buildUpsert,
  classifyRun,
  codeWord,
  countsJson,
  extractCounts,
  parseSpoolLine,
  readBody,
  recordSpoolBatch,
  resetJobRunLogWarningsForTest,
  runRow,
  scanTopLevel,
  type SpoolLine,
} from '../job-run-log';

const kst = (s: string) => Date.parse(`${s.replace(' ', 'T')}+09:00`);
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
function line(label: string, http: number | string, start: string, durMs: number, body?: unknown, path = `/api/cron/${label}`): string {
  const t0 = kst(start);
  const raw = body === undefined ? '' : b64(typeof body === 'string' ? body : JSON.stringify(body));
  return ['v1', label, path, String(http).padStart(3, '0'), String(t0), String(t0 + durMs), raw].join('\t');
}
const parsed = (l: string) => parseSpoolLine(l) as SpoolLine;

beforeEach(() => {
  queryMock.mockReset();
  switchMock.mockReset();
  switchMock.mockResolvedValue({ enabled: true, source: 'value' });
  resetJobRunLogWarningsForTest();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('parseSpoolLine', () => {
  it('정상 줄 → 해석(000 = 0, 본문 base64 디코드)', () => {
    const p = parseSpoolLine(line('edgar-sync', '000', '2026-10-30 07:00:05', 1500, { ok: true }));
    expect(p).toMatchObject({ label: 'edgar-sync', http: 0, endMs: kst('2026-10-30 07:00:05') + 1500, body: '{"ok":true}' });
    expect(parseSpoolLine(line('entry-watcher', 200, '2026-10-30 10:00:00', 10))!.body).toBeNull();
  });
  it.each([
    ['칸 수 다름', 'v1\ta\t/api/cron/a\t200\t1\t2'],
    ['버전 다름', line('a', 200, '2026-10-30 10:00:00', 1).replace(/^v1/, 'v2')],
    ['라벨 형식(대문자·공백·탭 주입)', line('A b', 200, '2026-10-30 10:00:00', 1)],
    ['경로가 cron 밖', line('a', 200, '2026-10-30 10:00:00', 1, undefined, '/api/orders')],
    ['HTTP 3자리 아님', line('a', 200, '2026-10-30 10:00:00', 1).replace('\t200\t', '\t20\t')],
    ['HTTP 숫자 아님', line('a', 200, '2026-10-30 10:00:00', 1).replace('\t200\t', '\tabc\t')],
    ['종료 < 시작', ['v1', 'a', '/api/cron/a', '200', String(kst('2026-10-30 10:00:01')), String(kst('2026-10-30 10:00:00')), ''].join('\t')],
    ['시각 범위 밖', ['v1', 'a', '/api/cron/a', '200', '100000000000', '100000000001', ''].join('\t')],
    ['base64 아님', `${line('a', 200, '2026-10-30 10:00:00', 1)}%%`],
  ])('형식 오류 → null: %s', (_n, l) => {
    expect(parseSpoolLine(l)).toBeNull();
  });
  it('CR 끝(줄바꿈 변형)은 허용', () => {
    expect(parseSpoolLine(`${line('a', 200, '2026-10-30 10:00:00', 1)}\r`)).not.toBeNull();
  });
});

describe('readBody / scanTopLevel — 잘린 본문에서 최상위 값만', () => {
  it('완전한 JSON 은 그대로', () => {
    expect(readBody('{"ok":false,"error":"x"}')).toEqual({ ok: false, error: 'x' });
    expect(readBody('[1]')).toEqual({});
    expect(readBody(null)).toEqual({});
  });
  it('🔴 중첩된 같은 이름 키(markets[].ok:false)를 최상위로 읽지 않는다', () => {
    const cut = '{"ok":true,"markets":[{"market":"overseas","ok":false,"upserted":0,"error":"very long';
    const v = scanTopLevel(cut);
    expect(v.ok).toBe(true);
    expect(v).not.toHaveProperty('error');
  });
  it('잘린 문자열 배열은 앞부분 원소까지, 잘린 숫자는 버린다', () => {
    const v = scanTopLevel('{"market":"domestic","symbolsEvaluated":40,"errors":["candle_fail:005930:x","candle_fail:000660:y","ai_f');
    expect(v).toEqual({ market: 'domestic', symbolsEvaluated: 40, errors: ['candle_fail:005930:x', 'candle_fail:000660:y'] });
    expect(scanTopLevel('{"a":12')).toEqual({});
    expect(scanTopLevel('{"a":"x\\"y","b":true}')).toEqual({ a: 'x"y', b: true });
    expect(scanTopLevel('not json')).toEqual({});
  });
});

describe('codeWord — 분류어만(원문 오류 문장·경로 금지)', () => {
  it('영소문자·숫자·밑줄만', () => {
    expect(codeWord('data_unknown')).toBe('data_unknown');
    expect(codeWord(' IN_PROGRESS ')).toBe('in_progress');
    for (const v of ['ENOENT: /home/brownjeon/.env', 'a b', '', '1abc', 'x'.repeat(49), 5, null]) expect(codeWord(v)).toBeNull();
  });
});

describe('classifyRun (§2.3)', () => {
  const C = (label: string, http: number, body?: unknown) =>
    classifyRun(label, http, body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body));

  it('000(연결 끊김·curl 상한) → failed HTTP=000', () => {
    expect(C('edgar-sync', 0)).toMatchObject({ status: 'failed', errorCode: 'HTTP=000', degradedReason: null });
  });
  it('🔴 해외 분석 503 data_unknown → failed + error_code, 사유는 degraded_reason(G-J1 #2)', () => {
    expect(C('post-market-overseas', 503, { ok: false, status: 'data_unknown', skipped: 'holidays_unknown', symbolsEvaluated: 0 }))
      .toMatchObject({ status: 'failed', errorCode: 'HTTP=503:data_unknown', degradedReason: 'holidays_unknown' });
    expect(C('post-market-overseas', 503, { ok: false, status: 'in_progress' })).toMatchObject({ status: 'failed', errorCode: 'HTTP=503:in_progress' });
    expect(C('post-market-overseas', 502, { ok: false, status: 'ai_fail' })).toMatchObject({ errorCode: 'HTTP=502:ai_fail' });
  });
  it('4xx·5xx 본문 오류 문장은 저장하지 않는다(분류어 아니면 HTTP=코드만)', () => {
    expect(C('strategy-eval', 500, { ok: false, error: "Cannot read properties of undefined (reading 'x')" }))
      .toMatchObject({ status: 'failed', errorCode: 'HTTP=500', degradedReason: null });
    expect(C('edgar-sync', 503, { ok: false, aborted: 'sec_blocked' })).toMatchObject({ errorCode: 'HTTP=503:sec_blocked', degradedReason: 'sec_blocked' });
  });
  it('🔴 국내 장마감 분석은 200 이어도 errors 로 실패를 가른다', () => {
    const base = { ok: true, market: 'domestic', symbolsEvaluated: 40, candidatesFound: 8, signalsCreated: 0, signalsSkipped: 8 };
    expect(C('post-market-domestic', 200, { ...base, errors: ['ai_fail:timeout'] })).toMatchObject({ status: 'failed', errorCode: 'ai_fail' });
    expect(C('post-market-domestic', 200, { ...base, errors: ['insert_fail:005930:dup'] })).toMatchObject({ status: 'failed', errorCode: 'insert_fail' });
    expect(C('post-market-domestic', 200, { ...base, errors: ['candle_fail:1:x', 'candle_fail:2:y'] })).toMatchObject({ status: 'partial', errorCode: 'candle_fail=2' });
    expect(C('post-market-domestic', 200, { ...base, errors: ['rag_fail:kb'] })).toMatchObject({ status: 'degraded', degradedReason: 'rag_fail' });
    expect(C('post-market-domestic', 200, { ...base, errors: [], skipped: 'weekend' })).toMatchObject({ status: 'skipped', degradedReason: 'skip:weekend' });
    expect(C('post-market-domestic', 200, { ...base, errors: [] })).toMatchObject({ status: 'ok', errorCode: null });
  });
  it('🔴 국내 분석 본문이 2KB 에서 잘려도 앞부분 errors 의 ai_fail 은 잡는다', () => {
    const full = JSON.stringify({ ok: true, market: 'domestic', symbolsEvaluated: 40, candidatesFound: 8, signalsCreated: 0, signalsSkipped: 8, errors: ['ai_fail:x', ...Array.from({ length: 80 }, (_, i) => `candle_fail:${i}:${'e'.repeat(30)}`)] });
    expect(full.length).toBeGreaterThan(2048);
    expect(classifyRun('post-market-domestic', 200, full.slice(0, 2048))).toMatchObject({ status: 'failed', errorCode: 'ai_fail' });
  });
  it('해외 200 정상 건너뜀(overseas_disabled·no_new_session·us_session_open) → skipped', () => {
    for (const w of ['overseas_disabled', 'no_new_session', 'us_session_open']) {
      expect(C('post-market-overseas', 200, { ok: true, status: 'ok', skipped: w })).toMatchObject({ status: 'skipped', degradedReason: `skip:${w}` });
    }
  });
  it('200 + ok:false → failed(분류어, 없으면 ok_false)', () => {
    expect(C('trade-report', 200, { ok: false, skipped: 'channel_invalid' })).toMatchObject({ status: 'failed', errorCode: 'channel_invalid' });
    expect(C('news-fetch-overseas', 200, { ok: false, error: 'M4_ADMIN_TOKEN 미설정', markets: [] })).toMatchObject({ status: 'failed', errorCode: 'ok_false' });
  });
  it('skipped(문자열·true+reason)·partial·strategy-eval 장 닫힘', () => {
    expect(C('entry-watcher', 200, { ok: true, skipped: true, reason: 'market_closed', processed: 0 })).toMatchObject({ status: 'skipped', degradedReason: 'skip:market_closed' });
    expect(C('edgar-sync', 200, { ok: true, skipped: 'tables_missing' })).toMatchObject({ status: 'skipped', degradedReason: 'skip:tables_missing' });
    expect(C('edgar-sync', 200, { ok: true, partial: true, remaining: 3 })).toMatchObject({ status: 'partial', degradedReason: 'remaining=3' });
    expect(C('strategy-eval', 200, { ok: true, ran: 0, errors: ['all_markets_closed'] })).toMatchObject({ status: 'skipped', degradedReason: 'skip:all_markets_closed' });
  });
  it('뉴스 ingest 0건 → degraded news=0 · peek 캡처 실패 → degraded · peek 스위치 꺼짐 → skipped', () => {
    expect(C('news-fetch-domestic', 200, { ok: true, markets: [{ market: 'domestic', ok: true, upserted: 0, attempts: 1 }] }))
      .toMatchObject({ status: 'degraded', degradedReason: 'news=0', counts: { processed: 0 } });
    expect(C('news-fetch-domestic-pm', 200, { ok: true, markets: [{ market: 'domestic', ok: true, upserted: 37, attempts: 1 }] }))
      .toMatchObject({ status: 'ok', counts: { processed: 37 } });
    expect(C('news-peek-overseas-09', 200, { ok: true, mode: 'peek', markets: [], capture: [{ market: 'overseas', status: 'failed', inserted: 0, duplicates: 0 }] }))
      .toMatchObject({ status: 'degraded', degradedReason: 'capture=failed' });
    expect(C('news-peek-overseas-09', 200, { ok: true, mode: 'peek', markets: [], capture: [{ market: 'overseas', status: 'ok', inserted: 3, duplicates: 17 }] }))
      .toMatchObject({ status: 'ok', counts: { fetched: 20, new: 3 } });
    expect(C('news-peek-domestic-10', 200, { ok: true, skipped: 'capture_disabled' })).toMatchObject({ status: 'skipped', degradedReason: 'skip:capture_disabled' });
  });
  it('본문 없음(매 분 잡 200) → ok, 모르는 본문 기본값', () => {
    expect(C('entry-watcher', 200)).toMatchObject({ status: 'ok', counts: null });
    expect(C('holding-checker', 200, '<html>')).toMatchObject({ status: 'ok' });
  });
});

describe('extractCounts — 지표 계약 §6 키', () => {
  it('분석 키', () => {
    expect(extractCounts('post-market-overseas', {
      symbolsEvaluated: 55, candidatesFound: 9, llmCandidates: 7, signalsCreated: 2, validationBlocked: 1, duplicatesSkipped: 1, signalsSkipped: 7,
    })).toEqual({ evaluated: 55, candidates: 9, llm_input: 7, created: 2, blocked: 1, duplicate: 1, skipped: 7 });
    expect(extractCounts('post-market-domestic', { symbolsEvaluated: -1, candidatesFound: 1.5 })).toBeNull();
  });
  it('일반 수집 키(fetched·new·processed, upserted → processed)', () => {
    expect(extractCounts('sync-stock-meta', { ok: true, upserted: 2500 })).toEqual({ processed: 2500 });
    expect(extractCounts('signal-expiry', { ok: true, expired: 3 })).toBeNull();
  });
  it('counts_json 은 2048자 이하만', () => {
    expect(countsJson({ a: 1 })).toBe('{"a":1}');
    const big: Record<string, number> = {};
    for (let i = 0; i < 300; i++) big[`k${i}`] = 123456;
    expect(countsJson(big)).toBeNull();
  });
});

describe('행 조립 — 슬롯·클램프(F3)·롤업(U2)', () => {
  it('하루 1회 잡: 예정 슬롯·세션 날짜·http_code·counts', () => {
    const r = runRow(parsed(line('post-market-overseas', 503, '2026-10-30 08:00:03', 61_000, { ok: false, status: 'data_unknown', skipped: 'fx_unknown' })));
    expect(r).toMatchObject({
      job_id: 'post-market-overseas', run_kind: 'analysis', market: 'overseas', target: 'llm',
      scheduled_slot_at: '2026-10-30 08:00:00', started_at: '2026-10-30 08:00:03', ended_at: '2026-10-30 08:01:04',
      status: 'failed', attempt: 1, http_code: 503, error_code: 'HTTP=503:data_unknown', degraded_reason: 'fx_unknown',
      session_date_kst: '2026-10-30', session_date_et: '2026-10-29', recorder: 'runner_hook',
    });
  });
  it('🔴 F3 — 모든 문자열 열을 코드포인트 단위로 자른다(서로게이트 반쪽 없음)', () => {
    const r = runRow(parsed(line('edgar-sync', 200, '2026-10-30 07:00:00', 1)), {
      status: 'degraded', errorCode: 'e'.repeat(100), degradedReason: '\u{1F600}'.repeat(200), counts: null,
    });
    expect(r.error_code).toHaveLength(JRL_LEN.error_code);
    expect(Array.from(r.degraded_reason!)).toHaveLength(JRL_LEN.degraded_reason);
    expect(/[\uD800-\uDBFF]$/.test(r.degraded_reason!)).toBe(false);
  });
  it('🔴 롤업: 매 분 잡 3번(1번 실패) → 실패 1줄(runner_hook, 의사 슬롯) + 롤업 1줄(partial, runs 3·failed 1·maxMs)', () => {
    const b = buildRows([
      line('entry-watcher', 200, '2026-10-30 10:00:01', 100),
      line('entry-watcher', 500, '2026-10-30 10:01:02', 900, { ok: false, error: 'boom: something broke' }),
      line('entry-watcher', 200, '2026-10-30 10:02:03', 300),
      line('entry-watcher', 200, '2026-10-30 11:00:01', 50),
    ]);
    expect(b.runRows).toHaveLength(1);
    expect(b.runRows[0]).toMatchObject({ recorder: 'runner_hook', status: 'failed', scheduled_slot_at: '2026-10-30 10:01:00', error_code: 'HTTP=500' });
    expect(b.rollupRows).toHaveLength(2);
    expect(b.rollupRows[0]).toMatchObject({
      recorder: 'runner_rollup', status: 'partial', scheduled_slot_at: '2026-10-30 10:00:00',
      started_at: '2026-10-30 10:00:01', ended_at: '2026-10-30 10:02:03', http_code: null,
      counts_json: '{"runs":3,"failed":1,"maxMs":900}', session_date_et: null,
    });
    expect(b.rollupRows[1]).toMatchObject({ status: 'ok', scheduled_slot_at: '2026-10-30 11:00:00', counts_json: '{"runs":1,"failed":0,"maxMs":50}' });
  });
  it('롤업 상태: 모두 실패 → failed · skipped 는 실패가 아니다', () => {
    const allFail = buildRows([line('stop-alert', 0, '2026-10-30 10:00:01', 20_000), line('stop-alert', 0, '2026-10-30 10:01:21', 20_000)]);
    expect(allFail.rollupRows[0]).toMatchObject({ status: 'failed', counts_json: '{"runs":2,"failed":2,"maxMs":20000}' });
    expect(allFail.runRows).toHaveLength(2);
    const skip = buildRows([line('strategy-eval', 200, '2026-10-30 03:00:01', 10, { ok: true, errors: ['all_markets_closed'] })]);
    expect(skip.runRows).toHaveLength(0);
    expect(skip.rollupRows[0]).toMatchObject({ status: 'ok', counts_json: '{"runs":1,"failed":0,"maxMs":10}' });
  });
  it('portfolio-snapshot(60틱)·하루 1회·peek 는 실행마다 1줄, 형식 오류 줄은 rejected, 빈 줄은 무시', () => {
    const b = buildRows([
      line('portfolio-snapshot', 200, '2026-10-30 10:00:31', 2000, { ok: true }),
      line('news-peek-overseas-10', 200, '2026-10-30 10:00:40', 2000, { ok: true, mode: 'peek', capture: [{ status: 'ok', inserted: 1, duplicates: 2 }] }),
      'garbage', '', 'v1\tx',
    ]);
    expect(b.runRows.map((r) => r.job_id)).toEqual(['portfolio-snapshot', 'news-peek-overseas-10']);
    expect(b.rollupRows).toHaveLength(0);
    expect(b.rejected).toBe(2);
    expect(b.runRows[1]).toMatchObject({ run_kind: 'peek', scheduled_slot_at: '2026-10-30 10:00:00', counts_json: '{"fetched":3,"new":1}' });
  });
  it('표에 없는 라벨도 남긴다(보수적 기본값 — 정합 시험이 이 경우를 막는다)', () => {
    const b = buildRows([line('brand-new-job', 200, '2026-10-30 10:00:00', 5)]);
    expect(b.runRows[0]).toMatchObject({ job_id: 'brand-new-job', run_kind: 'other', market: 'common', target: null, scheduled_slot_at: '2026-10-30 10:00:00' });
  });
});

describe('SQL — b′(F1)·롤업', () => {
  it('🔴 실행 ODKU: 모든 비교가 IFNULL(ended_at, 1000-01-01), ended_at 대입은 맨 마지막, started_at 은 안 바꾼다', () => {
    const parts = RUN_ODKU.replace(/^ON DUPLICATE KEY UPDATE /, '').split(/, (?=[a-z_]+ = )/);
    expect(parts.map((p) => p.split(' = ')[0])).toEqual(['attempt', 'status', 'http_code', 'error_code', 'degraded_reason', 'counts_json', 'ended_at']);
    for (const p of parts) expect(p).toContain("IF(VALUES(ended_at) > IFNULL(ended_at, '1000-01-01 00:00:00'), ");
    expect(RUN_ODKU).not.toMatch(/started_at =/);
    expect(RUN_ODKU).not.toMatch(/GREATEST/);
  });
  it('롤업 ODKU: status 를 counts_json 보다 먼저(옛 값 + 새 값으로 계산)', () => {
    expect(ROLLUP_ODKU.indexOf('status = CASE')).toBeLessThan(ROLLUP_ODKU.indexOf('counts_json = JSON_OBJECT'));
    expect(ROLLUP_ODKU).toContain('started_at = LEAST(started_at, VALUES(started_at))');
  });
  it('buildUpsert: 열 16개 · 행마다 자리표시자 · 값 순서', () => {
    const r = runRow(parsed(line('edgar-sync', 200, '2026-10-30 07:00:00', 1, { ok: true })));
    const q = buildUpsert([r, r], RUN_ODKU);
    expect(JRL_COLUMNS).toHaveLength(16);
    expect(q.params).toHaveLength(32);
    expect((q.sql.match(/\?/g) ?? []).length).toBe(32);
    expect(q.sql.startsWith(`INSERT INTO job_run_log (${JRL_COLUMNS.join(', ')}) VALUES (`)).toBe(true);
    expect(q.params.slice(0, 3)).toEqual(['edgar-sync', 'ingest', 'overseas']);
  });
});

describe('recordSpoolBatch — 스위치·테이블 없음·값 오류·시간 상한·절대 던지지 않음', () => {
  const L = [
    line('edgar-sync', 200, '2026-10-30 07:00:01', 5000, { ok: true }),
    line('entry-watcher', 200, '2026-10-30 07:00:07', 100),
  ].join('\n');

  it('🔴 스위치 꺼짐(키 없음) → skipped_disabled, DB 쓰기 0', async () => {
    switchMock.mockResolvedValue({ enabled: false, source: 'missing' });
    await expect(recordSpoolBatch(L)).resolves.toMatchObject({ status: 'skipped_disabled', received: 2 });
    expect(queryMock).not.toHaveBeenCalled();
    expect(switchMock).toHaveBeenCalledWith('job_run_log_enabled');
  });
  it('스위치를 읽지 못함 → failed(switch_unreadable) — 러너가 스풀을 남긴다', async () => {
    switchMock.mockResolvedValue({ enabled: false, source: 'timeout' });
    await expect(recordSpoolBatch(L)).resolves.toMatchObject({ status: 'failed', reason: 'switch_unreadable' });
    expect(queryMock).not.toHaveBeenCalled();
  });
  it('켜짐 → 실행 행 문장 1 + 롤업 문장 1', async () => {
    queryMock.mockResolvedValue([{ affectedRows: 1 }, undefined]);
    await expect(recordSpoolBatch(L)).resolves.toMatchObject({ status: 'ok', runRows: 1, rollupRows: 1, rejected: 0, rowErrors: 0 });
    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(queryMock.mock.calls[0][0]).toContain(RUN_ODKU);
    expect(queryMock.mock.calls[1][0]).toContain(ROLLUP_ODKU);
  });
  it('🔴 테이블 없음(errno 1146) → skipped_no_table, 경고는 프로세스당 1회', async () => {
    queryMock.mockRejectedValue(Object.assign(new Error("Table 'x.job_run_log' doesn't exist"), { errno: 1146, code: 'ER_NO_SUCH_TABLE' }));
    await expect(recordSpoolBatch(L)).resolves.toMatchObject({ status: 'skipped_no_table' });
    await expect(recordSpoolBatch(L)).resolves.toMatchObject({ status: 'skipped_no_table' });
    expect((console.warn as jest.Mock).mock.calls.filter((c) => String(c[0]).includes('테이블 없음'))).toHaveLength(1);
  });
  it('🔴 값 오류(errno 4025 — code 문자열은 엉뚱해도) → 한 줄씩 다시 넣어 그 행만 뺀다', async () => {
    const three = [
      line('edgar-sync', 200, '2026-10-30 07:00:01', 1, { ok: true }),
      line('research-cycle-overseas', 200, '2026-10-30 07:00:02', 1, { ok: true }),
      line('broker-fills', 200, '2026-10-30 07:20:02', 1, { ok: true }),
    ].join('\n');
    const chk = Object.assign(new Error('CONSTRAINT failed'), { errno: 4025, code: 'ER_INNODB_AUTOEXTEND_SIZE_OUT_OF_RANGE' });
    queryMock
      .mockRejectedValueOnce(chk)                        // 3행 묶음
      .mockResolvedValueOnce([{}, undefined])            // 1행씩: edgar
      .mockRejectedValueOnce(chk)                        // research 만 실패
      .mockResolvedValueOnce([{}, undefined]);           // broker-fills
    await expect(recordSpoolBatch(three)).resolves.toMatchObject({ status: 'ok', runRows: 3, rollupRows: 0, rowErrors: 1 });
    expect(queryMock).toHaveBeenCalledTimes(4);
  });
  it('연결 오류 → failed(db_error), 던지지 않음', async () => {
    queryMock.mockRejectedValue(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET', errno: -104 }));
    await expect(recordSpoolBatch(L)).resolves.toMatchObject({ status: 'failed', reason: 'db_error' });
  });
  it('🔴 시간 상한(2.5초) → failed(timeout), 늦은 결과는 흡수', async () => {
    jest.useFakeTimers();
    queryMock.mockReturnValue(new Promise(() => {}));
    const p = recordSpoolBatch(L, 2500);
    await Promise.resolve(); await Promise.resolve();
    jest.advanceTimersByTime(2500);
    await expect(p).resolves.toMatchObject({ status: 'failed', reason: 'timeout' });
  });
  it('스위치 모듈이 던져도 failed 로 흡수', async () => {
    switchMock.mockRejectedValue(new Error('x'));
    await expect(recordSpoolBatch(L)).resolves.toMatchObject({ status: 'failed' });
  });
  it('🔴 (T-127 ⑤) 503 사유 한 줄 — 스위치를 읽지 못함: 분류어·출처만, 스풀 줄 내용(라벨·본문) 없음', async () => {
    switchMock.mockResolvedValue({ enabled: false, source: 'timeout' });
    await expect(recordSpoolBatch(L)).resolves.toMatchObject({ status: 'failed', reason: 'switch_unreadable' });
    const msgs = (console.warn as jest.Mock).mock.calls.map((c) => String(c[0]));
    expect(msgs.filter((m) => m.includes('503 reason=switch_unreadable (source=timeout)'))).toHaveLength(1);
    for (const m of msgs) expect(m).not.toMatch(/edgar-sync|entry-watcher|eyJ|\/api\/cron/);
  });
  it('🔴 (T-127 ⑤) 503 사유 한 줄 — 처리 상한 초과(timeout): 분류어·상수만', async () => {
    jest.useFakeTimers();
    queryMock.mockReturnValue(new Promise(() => {}));
    const p = recordSpoolBatch(L, 2500);
    await Promise.resolve(); await Promise.resolve();
    jest.advanceTimersByTime(2500);
    await expect(p).resolves.toMatchObject({ status: 'failed', reason: 'timeout' });
    const msgs = (console.warn as jest.Mock).mock.calls.map((c) => String(c[0]));
    expect(msgs.filter((m) => m.includes('503 reason=timeout (deadline=2500ms)'))).toHaveLength(1);
    for (const m of msgs) expect(m).not.toMatch(/edgar-sync|entry-watcher|eyJ|\/api\/cron/);
  });
  it('(T-127 ⑤) 503 이 아닌 결과(꺼짐·정상·테이블 없음)와 db_error(이미 errno 줄이 있음)에는 503 사유 줄을 더하지 않는다', async () => {
    const n503 = () => (console.warn as jest.Mock).mock.calls.filter((c) => String(c[0]).includes('503 reason=')).length;
    switchMock.mockResolvedValue({ enabled: false, source: 'missing' });
    await recordSpoolBatch(L);
    switchMock.mockResolvedValue({ enabled: false, source: 'value' });
    await recordSpoolBatch(L);
    switchMock.mockResolvedValue({ enabled: true, source: 'value' });
    queryMock.mockResolvedValue([{}, undefined]);
    await expect(recordSpoolBatch(L)).resolves.toMatchObject({ status: 'ok' });
    queryMock.mockRejectedValue(Object.assign(new Error('x'), { errno: 1146 }));
    await expect(recordSpoolBatch(L)).resolves.toMatchObject({ status: 'skipped_no_table' });
    expect(n503()).toBe(0);
    queryMock.mockRejectedValue(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET', errno: -104 }));
    await expect(recordSpoolBatch(L)).resolves.toMatchObject({ status: 'failed', reason: 'db_error' });
    expect(n503()).toBe(0);
    expect((console.warn as jest.Mock).mock.calls.filter((c) => String(c[0]).includes('기록 실패 errno=-104'))).toHaveLength(1);
  });
  it('형식 오류 줄만 있으면 쓰지 않고 ok(rejected 수), 100행 넘으면 문장을 나눈다', async () => {
    queryMock.mockResolvedValue([{}, undefined]);
    await expect(recordSpoolBatch('garbage\nv1\tx')).resolves.toMatchObject({ status: 'ok', rejected: 2, runRows: 0 });
    expect(queryMock).not.toHaveBeenCalled();
    const many = Array.from({ length: 150 }, (_, k) => line('portfolio-snapshot', 200, '2026-10-30 10:00:00', 1).replace(/\t(\d{13})\t(\d{13})\t/, (_m, a: string) => `\t${Number(a) + k * 60_000}\t${Number(a) + k * 60_000 + 1}\t`)).join('\n');
    queryMock.mockClear();
    await expect(recordSpoolBatch(many)).resolves.toMatchObject({ status: 'ok', runRows: 150 });
    expect(queryMock).toHaveBeenCalledTimes(2);
  });
});

/**
 * T-127 ① — 러너 jrl_mask_money(scripts/cron-runner.sh 에서 그대로 잘라 bash 로 돌린다)가 금액을 지워도 **분류 결과가 같다**.
 * 경로를 그대로 흉내 낸다: 러너 `head -c 2048 → (마스킹) → base64` → 앱 `parseSpoolLine` 의 디코드(앞 4096바이트 → UTF-8, 빈 값은 null).
 * 응답 모양은 라우트 코드 그대로(portfolio-snapshot route.ts 의 성공·holdForCash·balances_incomplete·markets_closed·500, drawdown 결과
 * kill-switch.ts 의 DrawdownCheckResult / trade-report route.ts 의 발송·건너뜀·channel_invalid·500). 금액·종목 값은 합성값이다.
 */
describe('🔴 T-127 ① 금액 값 마스킹 — 마스킹 전후 classifyRun 불변(러너 함수 그대로)', () => {
  const RUNNER = path.resolve(__dirname, '..', '..', '..', '..', '..', 'scripts', 'cron-runner.sh');
  const fnSrc = (() => {
    const m = /^jrl_mask_money\(\) \{\n[\s\S]*?\n\}\n/m.exec(fs.readFileSync(RUNNER, 'utf8'));
    if (!m) throw new Error('러너에 jrl_mask_money 가 없다');
    return m[0];
  })();
  const mask = (buf: Buffer): Buffer =>
    execFileSync('bash', ['-c', `${fnSrc}\njrl_mask_money`], { input: buf, env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } });
  const viaRunner = (body: string, masked: boolean): string | null => {
    const head = Buffer.from(body, 'utf8').subarray(0, 2048);
    const s = (masked ? mask(head) : head).subarray(0, 4096).toString('utf8');
    return s === '' ? null : s;
  };
  const KEYS = new Set(['totalKRW', 'KRW', 'USD', 'headerPnlKRW', 'lifoPnlKRW']);
  const expectMasked = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(expectMasked);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k,
        KEYS.has(k) && typeof x === 'number' ? 0 : k === 'detail' && typeof x === 'string' ? '' : expectMasked(x)]));
    }
    return v;
  };
  const MONEY = /987654321|12345678|4321\.75|7777\.25|55,555,555|66,666,666|3333333|2222222|98765|005930|AAPL/;
  const psOk = (drawdown: unknown) => ({
    ok: true, totalKRW: 987654321, positions: 4, cash: { KRW: 12345678, USD: 4321.75 },
    volGuard: { level: 'ok', changePct: -1.25 }, killSwitch: false, drawdown, action: null,
  });
  const PAD = 'x'.repeat(2012);
  const CASES: Array<[string, string, number, unknown, { status: string; errorCode?: string | null; degradedReason?: string | null }]> = [
    ['정상(drawdown evaluated)', 'portfolio-snapshot', 200, psOk({ status: 'evaluated', drawdownPct: -2.5, triggered: false }), { status: 'ok' }],
    ['보류 usd_cash_unavailable(detail 에 USD 금액)', 'portfolio-snapshot', 200,
      { ok: true, skipped: 'usd_cash_unavailable', detail: 'USD/KRW 환율 조회 실패 — USD 예수금(7777.25 USD)을 환산할 수 없음: timeout', snapshotAgeMin: 75, blindness: 'warning' },
      { status: 'skipped', degradedReason: 'skip:usd_cash_unavailable' }],
    ['보류 krw_cash_unavailable', 'portfolio-snapshot', 200,
      { ok: true, skipped: 'krw_cash_unavailable', detail: '국내 잔고 응답에 예수금 요약(output2)이 없거나 값이 숫자가 아닙니다', snapshotAgeMin: null, blindness: 'unknown' },
      { status: 'skipped', degradedReason: 'skip:krw_cash_unavailable' }],
    ['balances_incomplete', 'portfolio-snapshot', 200,
      { ok: true, skipped: 'balances_incomplete', failedMarkets: ['overseas'], snapshotAgeMin: 61, blindness: 'ok' },
      { status: 'skipped', degradedReason: 'skip:balances_incomplete' }],
    ['markets_closed', 'portfolio-snapshot', 200, { ok: true, skipped: 'markets_closed', lastSnapshotAt: '2026-10-30T01:00:00.000Z' },
      { status: 'skipped', degradedReason: 'skip:markets_closed' }],
    ['drawdown baseline_invalid(detail 에 원화 금액)', 'portfolio-snapshot', 200,
      psOk({ status: 'skipped', reason: 'baseline_invalid', detail: 'USD 제외 후 기준 자본 98765원 · 양쪽에서 USD(기준 55,555,555원·현재 66,666,666원)를 빼고 비교' }),
      { status: 'ok' }],
    ['drawdown composition_change_suspected(detail 에 금액·종목 코드)', 'portfolio-snapshot', 200,
      psOk({ status: 'skipped', reason: 'composition_change_suspected', detail: '24h -12.3% (-55,555,555원) 이지만 기준선에 있던 [005930, NAS:AAPL] 66,666,666원이 사라졌고' }),
      { status: 'ok' }],
    ['500 error 문장(숫자 포함)', 'portfolio-snapshot', 500, { ok: false, error: 'KIS 잔고 조회 실패 EGW00201 (500)' }, { status: 'failed', errorCode: 'HTTP=500' }],
    ['500 error 분류어', 'portfolio-snapshot', 500, { ok: false, error: 'db_timeout' }, { status: 'failed', errorCode: 'HTTP=500:db_timeout' }],
    ['2KB 절단 — totalKRW 숫자 한가운데', 'portfolio-snapshot', 200, `{"ok":true,"pad":"${PAD}","totalKRW":123456789012,"skipped":"never_read"}`, { status: 'ok' }],
    ['2KB 절단 — 보류 detail 한가운데', 'portfolio-snapshot', 200,
      `{"ok":true,"skipped":"usd_cash_unavailable","detail":"USD 예수금(98765 USD) ${'예'.repeat(900)}"}`, { status: 'skipped', degradedReason: 'skip:usd_cash_unavailable' }],
    ['trade-report 발송', 'trade-report', 200, {
      ok: true, sent: true, channel: 'telegram', partial: false, delivered: ['telegram'], failed: [], unconfigured: [], noTargetChannel: false,
      lastSentAtAdvanced: true, rangeStart: '2026-10-30T00:00:00.000Z', rangeEnd: '2026-10-30T01:00:00.000Z', rangeCapped: false,
      buys: 2, sells: 1, headerPnlKRW: -3333333, lifoPnlKRW: 2222222, unmatchedSellCount: 0, matchedSellCount: 1,
    }, { status: 'ok' }],
    ['trade-report 일부 채널 실패(partial)', 'trade-report', 200, {
      ok: true, sent: true, channel: 'both', partial: true, delivered: ['telegram'], failed: [{ channel: 'slack', error: 'HTTP 500' }], unconfigured: [],
      buys: 1, sells: 1, headerPnlKRW: 2222222, lifoPnlKRW: -3333333, unmatchedSellCount: 1, matchedSellCount: 0,
    }, { status: 'partial', degradedReason: 'partial' }],
    ['trade-report 건너뜀(too_early)', 'trade-report', 200, { ok: true, skipped: 'too_early', lastSentAt: '2026-10-30T00:00:00.000Z' }, { status: 'skipped', degradedReason: 'skip:too_early' }],
    ['trade-report channel_invalid(200 ok:false)', 'trade-report', 200, { ok: false, skipped: 'channel_invalid', channel: 'x' }, { status: 'failed', errorCode: 'channel_invalid' }],
    ['trade-report 500 error 문장', 'trade-report', 500, { ok: false, error: 'Lock wait timeout exceeded; try restarting transaction' }, { status: 'failed', errorCode: 'HTTP=500' }],
    ['trade-report 500 error 분류어', 'trade-report', 500, { ok: false, error: 'ER_LOCK_WAIT_TIMEOUT' }, { status: 'failed', errorCode: 'HTTP=500:er_lock_wait_timeout' }],
  ];

  it('(하네스 확인) 러너에서 마스킹 함수를 잘라 냈고, 실제로 값을 바꾼다', () => {
    expect(fnSrc).toContain('sed -E');
    expect(mask(Buffer.from('{"KRW":12}')).toString()).toBe('{"KRW":0}');
  });
  it.each(CASES)('%s — 분류 결과 같음 · 기대 분류 · 금액/종목 원문 없음', (_n, label, http, body, want) => {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    const before = viaRunner(raw, false);
    const after = viaRunner(raw, true);
    expect(classifyRun(label, http, after)).toEqual(classifyRun(label, http, before));
    expect(classifyRun(label, http, after)).toMatchObject(want);
    expect(after ?? '').not.toMatch(MONEY);
    if (typeof body !== 'string') {
      // 완전한 JSON(2KB 안) — 금액 키 0·detail "" 외에는 키 순서까지 그대로
      expect(Buffer.byteLength(raw, 'utf8')).toBeLessThan(2048);
      expect(after).toBe(JSON.stringify(expectMasked(body)));
    }
  });
  it('🔴 마스킹이 실제로 무언가를 바꾼 경우가 대부분이다(공허한 통과 방지)', () => {
    const changed = CASES.filter(([, , , body]) => {
      const raw = typeof body === 'string' ? body : JSON.stringify(body);
      return viaRunner(raw, true) !== viaRunner(raw, false);
    }).length;
    expect(changed).toBeGreaterThanOrEqual(9);
  });
  it('절단 경우: 숫자 중간 → "totalKRW":0 으로 끝남 · detail 중간 → detail 값이 비고 끝남', () => {
    expect(viaRunner(CASES[9][3] as string, true)!.endsWith('"totalKRW":0')).toBe(true);
    expect(viaRunner(CASES[10][3] as string, true)).toBe('{"ok":true,"skipped":"usd_cash_unavailable","detail":"');
  });
});

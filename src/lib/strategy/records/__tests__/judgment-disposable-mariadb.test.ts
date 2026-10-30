/**
 * T-112 B — 판단 기록기 **일회용 MariaDB 실증 시험** (평소 jest 실행에서는 건너뛴다).
 *
 * 단위 시험(목 풀)은 SQL 문장 자체를 검증하지 못한다 — 열 이름 오타·JSON/CHECK·DECIMAL·utf8mb4 문제가 있으면 기록기는 실패를 삼키므로
 * 운영에서 **조용히 아무것도 남지 않는다.** 그래서 실제 MariaDB 10.11(운영과 같은 strict sql_mode)에 마이그레이션
 * `scripts/migrations/T-112-run-judgment-record.sql` 을 적용하고 기록기의 실제 문장을 돌려 본다.
 *
 *  A. 마이그레이션 전 → no_table(조용히 건너뜀, 던지지 않음)
 *  B. 스위치 키 없음 → disabled, 행 0
 *  C. 스위치 켬 → 헤더 1행 + 후보 multi-row: 열 값·JSON·이모지 경계 500자·대소문자 변형 중복 제거·카드 id 연결(유니크 키 조회)·
 *     미전송 행 결정 NULL — CHECK 위반 없이 들어간다
 *  D. 후보 0건 실행 → 헤더만
 *
 * 실행(운영·공용 DB 금지 — 127.0.0.1 에만 묶인 일회용 컨테이너, 끝나면 제거):
 *   docker run -d --rm --pull=never --name t112-impl-b -p 127.0.0.1:33114:3306 -e MARIADB_ROOT_PASSWORD=<임의> -e MARIADB_DATABASE=t112b \
 *     mariadb:10.11 --sql-mode=IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION
 *   T112B_TEST_DB_PORT=33114 T112B_TEST_DB_PASSWORD=<임의> npx jest src/lib/strategy/records/__tests__/judgment-disposable-mariadb.test.ts
 *   docker rm -fv t112-impl-b
 */
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';

let mockPool: mysql.Pool | null = null;
jest.mock('@/lib/db', () => ({ getPool: () => { if (!mockPool) throw new Error('no pool'); return mockPool; } }));
jest.mock('@/lib/llm/provider', () => ({ getProviderConfig: jest.fn(async () => ({ provider: 'hybrid', stage1Model: 'qwen2.5:14b-instruct' })) }));

import { recordJudgment, resetJudgmentRecorderForTest } from '../judgment-recorder';
import { resetRecordSwitchCacheForTest } from '../record-switch';
import { JudgmentTrace } from '../judgment-trace';

const PORT = process.env.T112B_TEST_DB_PORT;
const maybe = PORT ? describe : describe.skip;
const MIGRATION = path.join(__dirname, '..', '..', '..', '..', '..', 'scripts', 'migrations', 'T-112-run-judgment-record.sql');

/** `--` 주석을 지우고 `;` 로 나눈다(이 파일의 문자열 리터럴에는 `--`·`;` 가 없다 — 아래에서 확인). */
function statements(sql: string): string[] {
  return sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n').split(';').map((s) => s.trim()).filter(Boolean);
}

function fullTrace(): JudgmentTrace {
  const t = new JudgmentTrace('overseas', new Date('2026-10-20T23:00:00Z'));
  t.session('2026-10-21 22:30:00', '2026-10-20');
  t.status('fx', 'available');
  t.status('earnings', 'available');
  t.symbolExcluded('NAS:FAIL', 'candle_fail');
  t.candlesFetched(5);
  t.candidates([
    { symbol: 'NAS:AAA', pattern: 'eod-high-close' },
    { symbol: 'NAS:BBB', pattern: 'inside-bar' },
    { symbol: 'NAS:CCC', pattern: 'oversold-bounce' },
    { symbol: 'NAS:DDD', pattern: 'eod-high-close' },
  ]);
  t.candidateExcluded('NAS:DDD', 'blackout');
  t.markAsOf(new Date('2026-10-20T23:00:40Z'));
  t.rag({ errors: [], recentNews: [{ id: 'us-news-1' }, { id: '뉴스-2' }], pastSignals: [], macroContext: [{ id: 'macro-1' }] });
  t.sentToLlm([{ symbol: 'NAS:AAA' }, { symbol: 'NAS:BBB' }, { symbol: 'NAS:CCC' }], '프롬프트');
  t.llmOk();
  t.decide('NAS:AAA', { action: 'BUY', confidence: 74.567, reasoning: 'x'.repeat(498) + '😀😀😀' }, null);
  t.decide('NAS:BBB', { action: 'SKIP', confidence: 30, reasoning: '관망' }, null);
  t.cardResult('NAS:AAA', 'created');
  t.finish(new Date('2026-10-20T23:01:30Z'));
  return t;
}

maybe('T-112 B 판단 기록기 — 일회용 MariaDB', () => {
  beforeAll(async () => {
    mockPool = mysql.createPool({
      host: '127.0.0.1', port: Number(PORT), user: 'root', password: process.env.T112B_TEST_DB_PASSWORD, database: process.env.T112B_TEST_DB_NAME ?? 't112b',
      timezone: '+09:00', connectionLimit: 4,
    });
    await mockPool.query('CREATE TABLE system_config (`key` VARCHAR(64) PRIMARY KEY, value JSON NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
    await mockPool.query(`CREATE TABLE signals (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, symbol VARCHAR(32) NOT NULL, side ENUM('buy','sell') NOT NULL,
      valid_from DATETIME NULL, scenario_source VARCHAR(32) NULL,
      UNIQUE KEY uq_signals_scenario_card (symbol, side, valid_from, scenario_source)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await mockPool.query(
      "INSERT INTO signals (id, symbol, side, valid_from, scenario_source) VALUES (601, 'NAS:AAA', 'buy', '2026-10-21 22:30:00', 'post-market'), (602, 'NAS:AAA', 'buy', '2026-10-22 22:30:00', 'post-market')",
    );
  });
  afterAll(async () => {
    await mockPool?.end();
    mockPool = null;
  });
  beforeEach(() => {
    resetRecordSwitchCacheForTest();
    resetJudgmentRecorderForTest();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { jest.restoreAllMocks(); });

  test('sql_mode 가 strict 다(운영과 같은 조건에서 본다)', async () => {
    const [r] = await mockPool!.query<RowDataPacket[]>('SELECT @@SESSION.sql_mode AS m');
    expect(String(r[0].m)).toContain('STRICT_TRANS_TABLES');
  });

  test('A. 마이그레이션 전 — 스위치 켜도 no_table, 던지지 않는다', async () => {
    await mockPool!.query("INSERT INTO system_config (`key`, value) VALUES ('judgment_record_enabled', 'true')");
    await expect(recordJudgment(fullTrace().snapshot())).resolves.toEqual({ status: 'no_table' });
    await mockPool!.query("DELETE FROM system_config WHERE `key` = 'judgment_record_enabled'");
  });

  test('마이그레이션 적용(파일 그대로, 2회 — 멱등)', async () => {
    const sql = fs.readFileSync(MIGRATION, 'utf8');
    const stmts = statements(sql);
    expect(stmts.filter((s) => /^CREATE TABLE IF NOT EXISTS (job_run_log|judgment_run|judgment_candidate)\b/.test(s))).toHaveLength(3);
    for (let i = 0; i < 2; i++) for (const s of stmts) await mockPool!.query(s);
  });

  test('B. 스위치 키 없음 → disabled, 행 0', async () => {
    await expect(recordJudgment(fullTrace().snapshot())).resolves.toEqual({ status: 'disabled' });
    const [r] = await mockPool!.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM judgment_run');
    expect(Number(r[0].n)).toBe(0);
  });

  test('🔴 C. 스위치 켬 → 헤더 1행 + 후보 행이 CHECK 위반 없이 들어가고, 값이 그대로다', async () => {
    await mockPool!.query("INSERT INTO system_config (`key`, value) VALUES ('judgment_record_enabled', 'true')");
    const snap = fullTrace().snapshot();
    // F5 — 같은 실행 안 대소문자·공백 변형(엔진 심볼은 정규형이지만 기록기가 넣기 전에 막는지 실제 콜레이션으로 본다)
    snap.candidates.push({ ...snap.candidates[1], symbol: ' nas:bbb ' });
    const res = await recordJudgment(snap);
    expect(res).toMatchObject({ status: 'written', candidates: 5, dropped: 1 });
    const [h] = await mockPool!.query<RowDataPacket[]>(
      `SELECT market, judgment_role, DATE_FORMAT(session_d0,'%Y-%m-%d') d0, DATE_FORMAT(valid_from,'%Y-%m-%d %H:%i:%s') vf,
              DATE_FORMAT(started_at,'%Y-%m-%d %H:%i:%s') st, DATE_FORMAT(ended_at,'%Y-%m-%d %H:%i:%s') en,
              DATE_FORMAT(as_of,'%Y-%m-%d %H:%i:%s') ao, candidate_count, llm_provider, llm_model, prompt_sha256,
              rag_context_ids, data_status, engine_release
         FROM judgment_run WHERE judgment_run_id = ?`,
      [res.judgmentRunId],
    );
    expect(h[0]).toMatchObject({
      market: 'overseas', judgment_role: 'baseline', d0: '2026-10-20', vf: '2026-10-21 22:30:00', st: '2026-10-21 08:00:00',
      en: '2026-10-21 08:01:30', ao: '2026-10-21 08:00:40', candidate_count: 4, llm_provider: 'hybrid', llm_model: 'qwen2.5:14b-instruct',
    });
    expect(h[0].prompt_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(String(h[0].rag_context_ids))).toEqual({ news: ['us-news-1', '뉴스-2'], signals: [], macro: ['macro-1'] });
    expect(JSON.parse(String(h[0].data_status))).toEqual({ candles: 'partial', news: 'available', earnings: 'available', fx: 'available', llm: 'available' });

    const [rows] = await mockPool!.query<RowDataPacket[]>(
      `SELECT symbol, pattern, exclusion_code, sent_to_llm, ai_decision, confidence, ai_reasoning, CHAR_LENGTH(ai_reasoning) rl, signal_id, judgment_role
         FROM judgment_candidate WHERE judgment_run_id = ? ORDER BY candidate_id`,
      [res.judgmentRunId],
    );
    const bySym = Object.fromEntries(rows.map((r) => [r.symbol, r]));
    expect(Object.keys(bySym).sort()).toEqual(['NAS:AAA', 'NAS:BBB', 'NAS:CCC', 'NAS:DDD', 'NAS:FAIL']);
    expect(bySym['NAS:AAA']).toMatchObject({ exclusion_code: null, sent_to_llm: 1, ai_decision: 'BUY', signal_id: 601, rl: 500, judgment_role: 'baseline' });
    expect(Number(bySym['NAS:AAA'].confidence)).toBe(74.57);
    expect(String(bySym['NAS:AAA'].ai_reasoning).endsWith('😀😀')).toBe(true);
    expect(bySym['NAS:BBB']).toMatchObject({ ai_decision: 'SKIP', ai_reasoning: '관망', signal_id: null });
    expect(bySym['NAS:CCC']).toMatchObject({ ai_decision: 'NONE', sent_to_llm: 1 });
    expect(bySym['NAS:DDD']).toMatchObject({ exclusion_code: 'blackout', sent_to_llm: 0, ai_decision: null, confidence: null });
    expect(bySym['NAS:FAIL']).toMatchObject({ pattern: null, exclusion_code: 'candle_fail', sent_to_llm: 0 });
  });

  test('D. 후보 0건 실행 → 헤더만(candidate_count 0)', async () => {
    const t = new JudgmentTrace('domestic', new Date('2026-10-16T07:00:00Z'));
    t.session('2026-10-19 09:00:00');
    t.status('fx', 'error');
    t.finish(new Date('2026-10-16T07:00:05Z'));
    const res = await recordJudgment(t.snapshot());
    expect(res).toMatchObject({ status: 'written', candidates: 0 });
    const [h] = await mockPool!.query<RowDataPacket[]>('SELECT candidate_count, session_d0, as_of, prompt_sha256, rag_context_ids FROM judgment_run WHERE judgment_run_id = ?', [res.judgmentRunId]);
    expect(h[0]).toMatchObject({ candidate_count: 0, session_d0: null, as_of: null, prompt_sha256: null, rag_context_ids: null });
    const [c] = await mockPool!.query<RowDataPacket[]>('SELECT COUNT(*) n FROM judgment_candidate WHERE judgment_run_id = ?', [res.judgmentRunId]);
    expect(Number(c[0].n)).toBe(0);
  });
});

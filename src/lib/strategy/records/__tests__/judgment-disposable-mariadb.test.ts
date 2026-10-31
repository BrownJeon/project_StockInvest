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
 *  E. 🔴 (T-135) 실 풀 10개(운영 `db.ts` 와 같은 connectionLimit 10·queueLimit 0)·실 `LOCK TABLES judgment_run WRITE`:
 *     E1 정상 30회 — 매번 연결이 풀로 돌아온다(바쁜 연결 0, release 30·destroy 0) · E2 표를 잠근 채 12회 동시 × 2회 — 전부 4초 timeout,
 *     매번 바쁜 연결 0, 무관한 `SELECT 1` 이 3초 안에 통과, 잠금을 쥔 채로 서버의 대기 INSERT 가 사라지고, 잠금 해제 뒤 늦게 써진 행 0 ·
 *     기록마다 받은 연결은 정확히 한 번 끝남 · E3 오류 경로(테이블 없음)도 바쁜 연결 0·연결은 destroy
 *     (변경 전 코드 — INSERT 를 풀 query 로 — 는 E2 에서 풀 10개가 매달려 바쁜 연결 10·SELECT 1 굶음: 변이 시험으로 확인)
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

import { JUDGMENT_RECORD_TIMEOUT_MS, recordJudgment, resetJudgmentRecorderForTest } from '../judgment-recorder';
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

maybe('E. 🔴 (T-135) 판단 기록 INSERT 가 매달려도 풀 연결을 붙잡지 않는다(실물 기록기·실 풀 10개·실 잠금)', () => {
  let pool: mysql.Pool;
  let locker: mysql.Connection;    // LOCK TABLES 를 쥐는 세션(풀 밖) — 마이그레이션도 여기서(SET SESSION lock_wait_timeout=5 가 풀 연결에 남지 않게)
  let monitor: mysql.Connection;   // PROCESSLIST·행 수 관찰(풀 밖)
  const opts = () => ({
    host: '127.0.0.1', port: Number(PORT), user: 'root', password: process.env.T112B_TEST_DB_PASSWORD,
    database: process.env.T112B_TEST_DB_NAME ?? 't112b', timezone: '+09:00',
  });
  type CorePool = { _allConnections: { length: number }; _freeConnections: { length: number } };
  const core = () => (pool as unknown as { pool: CorePool }).pool;
  const busy = () => core()._allConnections.length - core()._freeConnections.length;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  async function until(cond: () => boolean | Promise<boolean>, ms: number): Promise<boolean> {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await cond()) return true; await sleep(50); }
    return cond();
  }
  async function within<T>(p: Promise<T>, ms: number): Promise<T | 'late'> {
    let t: ReturnType<typeof setTimeout> | undefined;
    const r = await Promise.race([p, new Promise<'late'>((res) => { t = setTimeout(() => res('late'), ms); })]);
    clearTimeout(t);
    return r;
  }
  /** 받은 연결(획득 1회)마다 release·destroy 횟수 — "기록마다 연결은 정확히 한 번 끝난다" 확인용 */
  const ends = new Map<object, { r: number; d: number }>();
  function instrument(p: mysql.Pool): void {
    const real = p.getConnection.bind(p);
    (p as unknown as { getConnection: () => Promise<mysql.PoolConnection> }).getConnection = async () => {
      const c = await real();
      const e = { r: 0, d: 0 };
      ends.set(c, e);
      const rel = c.release.bind(c);
      const des = c.destroy.bind(c);
      c.release = () => { e.r++; rel(); };
      c.destroy = () => { e.d++; des(); };
      return c;
    };
  }
  const endStats = () => {
    const v = [...ends.values()];
    return {
      conns: v.length, releases: v.reduce((a, e) => a + e.r, 0), destroys: v.reduce((a, e) => a + e.d, 0),
      multi: v.filter((e) => e.r + e.d > 1).length, never: v.filter((e) => e.r + e.d === 0).length,
    };
  };
  const waiters = async () => {
    const [r] = await monitor.query("SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE INFO LIKE 'INSERT INTO judgment_run%' OR INFO LIKE 'INSERT INTO judgment_candidate%'") as [Array<{ n: number }>, unknown];
    return Number(r[0].n);
  };
  const rowCounts = async () => {
    const [r] = await monitor.query('SELECT (SELECT COUNT(*) FROM judgment_run) AS r, (SELECT COUNT(*) FROM judgment_candidate) AS c') as [Array<{ r: number; c: number }>, unknown];
    return [Number(r[0].r), Number(r[0].c)];
  };
  const note = (m: string) => { process.stdout.write(`[T-135 E 관찰] ${m}\n`); };

  beforeAll(async () => {
    pool = mysql.createPool({ ...opts(), connectionLimit: 10, waitForConnections: true, queueLimit: 0 });
    instrument(pool);
    mockPool = pool;
    locker = await mysql.createConnection(opts());
    monitor = await mysql.createConnection(opts());
    await locker.query('CREATE TABLE IF NOT EXISTS system_config (`key` VARCHAR(64) PRIMARY KEY, value JSON NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
    await locker.query("INSERT INTO system_config (`key`, value) VALUES ('judgment_record_enabled', 'true') ON DUPLICATE KEY UPDATE value = 'true'");
    for (const st of statements(fs.readFileSync(MIGRATION, 'utf8'))) await locker.query(st);
  });
  afterAll(async () => {
    try { await locker?.query('UNLOCK TABLES'); } catch { /* 흡수 */ }
    await locker?.end();
    await monitor?.end();
    await pool?.end();
    mockPool = null;
  });
  beforeEach(() => {
    ends.clear();
    resetRecordSwitchCacheForTest();
    resetJudgmentRecorderForTest();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { jest.restoreAllMocks(); });

  test('E1. 정상 30회 — 매번 연결이 풀로 돌아온다(바쁜 연결 0), 연결은 기록마다 하나·release', async () => {
    const [r0] = await rowCounts();
    for (let i = 0; i < 30; i++) {
      await expect(recordJudgment(fullTrace().snapshot())).resolves.toMatchObject({ status: 'written', candidates: 5 });
      expect(busy()).toBe(0);
    }
    expect(endStats()).toEqual({ conns: 30, releases: 30, destroys: 0, multi: 0, never: 0 });
    expect(core()._allConnections.length).toBeLessThanOrEqual(10);
    expect((await rowCounts())[0] - r0).toBe(30);
  }, 60_000);

  test('🔴 E2. 표를 잠근 채 12회 동시 × 2회(24회) — 전부 timeout, 매번 바쁜 연결 0·무관한 SELECT 1 통과, 대기 INSERT 소멸, 늦은 행 0', async () => {
    const before = await rowCounts();
    await locker.query('LOCK TABLES judgment_run WRITE');
    try {
      for (let round = 0; round < 2; round++) {
        const t0 = Date.now();
        const res = await Promise.all(Array.from({ length: 12 }, () => recordJudgment(fullTrace().snapshot())));
        const ms = Date.now() - t0;
        expect(res.map((r) => r.status)).toEqual(Array(12).fill('timeout'));
        expect(ms).toBeLessThan(JUDGMENT_RECORD_TIMEOUT_MS + 1500);
        // 상한에서 매달린 연결을 버렸고(destroy), 상한 뒤에 받은 연결(풀 10 < 12)은 문장 없이 돌려준다 → 바쁜 연결 0
        expect(await until(() => busy() === 0, 2000)).toBe(true);
        const q0 = Date.now();
        const sel = await within(pool.query('SELECT 1 AS ok'), 3000);
        expect(sel).not.toBe('late');
        const selMs = Date.now() - q0;
        const w0 = await waiters();
        const gone = await until(async () => (await waiters()) === 0, 10_000);   // 잠금은 쥔 채 — 끊긴 연결의 대기 INSERT 를 서버가 거둔다
        note(`round ${round + 1}: 12회 ${ms}ms 에 전부 timeout · 풀 all=${core()._allConnections.length} free=${core()._freeConnections.length} busy=${busy()} · 무관한 SELECT 1 ${selMs}ms · 서버 대기 INSERT 직후 ${w0}개 → ${gone ? '0개(소멸)' : `${await waiters()}개 남음`}`);
        expect(gone).toBe(true);
      }
    } finally {
      await locker.query('UNLOCK TABLES');
    }
    await sleep(1500);
    const after = await rowCounts();
    note(`잠금 해제 뒤 늦게 써진 행: judgment_run ${after[0] - before[0]} · judgment_candidate ${after[1] - before[1]} (시도 24회) · 연결 ${JSON.stringify(endStats())}`);
    expect(after).toEqual(before);
    expect(await until(() => endStats().never === 0, 3000)).toBe(true);
    expect(endStats().multi).toBe(0);
    resetRecordSwitchCacheForTest();
    await expect(recordJudgment(fullTrace().snapshot())).resolves.toMatchObject({ status: 'written' });
    expect(busy()).toBe(0);
  }, 90_000);

  test('E3. 오류 경로(테이블 없음 1146) 5회 — 연결은 destroy·바쁜 연결 0, 표를 되돌리면 다시 기록', async () => {
    await locker.query('RENAME TABLE judgment_run TO judgment_run_t135bak');
    try {
      for (let i = 0; i < 5; i++) {
        await expect(recordJudgment(fullTrace().snapshot())).resolves.toEqual({ status: 'no_table' });
        expect(busy()).toBe(0);
      }
    } finally {
      await locker.query('RENAME TABLE judgment_run_t135bak TO judgment_run');
    }
    expect(endStats()).toEqual({ conns: 5, releases: 0, destroys: 5, multi: 0, never: 0 });
    resetRecordSwitchCacheForTest();
    await expect(recordJudgment(fullTrace().snapshot())).resolves.toMatchObject({ status: 'written' });
    expect(busy()).toBe(0);
  }, 30_000);
});

/**
 * T-139 — 기록 스위치 읽기(`record-switch.ts`) **일회용 MariaDB 실증 시험** (`T139_DB_PORT` 가 있을 때만 — 없으면 전부 건너뛴다).
 *
 * 목 풀은 "멈춘 SELECT 가 풀 연결을 붙잡는가"를 보여 주지 못한다(연결·서버 스레드가 없다). 그래서 실제 MariaDB 10.11 과 운영 `db.ts` 와 같은
 * 설정의 mysql2 풀(connectionLimit 10·queueLimit 0)에서 `LOCK TABLES system_config WRITE` 로 스위치 SELECT 를 멈춰 본다.
 * 근거: T-126 소급 Codex 검토 high 1건 → 독립 Reviewer 재현(변경 전: 단일 호출 2초 뒤 꺼짐으로 돌아와도 busy 1 유지, 같은 키 10건 동시 busy 10·free 0,
 * 조회 합치기 없음).
 *
 *  S. 잠금 없음 — 동치·정상 경로: 값마다 (enabled, source) 가 변경 전 규칙과 같고(키 없음·true·false·"true"·잘못된 JSON·NULL·허용 밖 키),
 *     연결은 release 로 풀에 돌아간다(busy 0). 테이블 없음 = read_error.
 *  L1 단일 호출 — 2초 상한에 timeout(꺼짐), 돌려줄 때 이미 busy 0, 서버의 대기 SELECT 가 몇 초 안에 사라진다.
 *  L2 같은 키 10건 동시 — 모두 timeout, 조회 1(창구 2개 합계), busy 0, 무관한 표 조회가 곧바로 통과.
 *  L3 장시간 모사 — 잠긴 채 14분(시계를 61초씩 민다 — 30초 캐시가 매번 지난다) 동안 분당 약 1.2건(크론 기록 매분 14 + 청산 기록 3 = 17건):
 *     매 호출 뒤 busy 0, 최종 서버 대기 SELECT 0, 무관한 조회 통과.
 *  L4 늦은 연결 — 풀 10개가 모두 바쁜 동안 읽기: 2초에 timeout, 풀이 풀린 뒤 받은 연결로는 SELECT 를 보내지 않는다(잠금은 그대로라 보냈다면
 *     서버에 대기 SELECT 가 남는다) → 서버 대기 0·busy 0.
 *  R. 잠금 해제 뒤 — 정상 값으로 곧바로 돌아온다(busy 0).
 *
 * 실행(운영·공용 DB 금지 — 127.0.0.1 에만 묶인 일회용 컨테이너, 끝나면 제거. 비밀번호·포트는 그때그때 임의로, 환경변수로만):
 *   T139_DB_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -dc A-Za-z0-9 | head -c 24)"; export T139_DB_PASSWORD
 *   T139_DB_PORT=$((35500 + RANDOM % 100)); export T139_DB_PORT
 *   docker run -d --rm --pull=never --name t139-dev-db -p 127.0.0.1:$T139_DB_PORT:3306 -e MARIADB_ROOT_PASSWORD="$T139_DB_PASSWORD" \
 *     -e MARIADB_DATABASE=t139sw mariadb:10.11 \
 *     --sql-mode=STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION \
 *     --character-set-server=utf8mb3 --collation-server=utf8mb3_general_ci
 *   npx jest src/lib/strategy/records/__tests__/record-switch-disposable-mariadb.test.ts --runInBand
 *   docker rm -fv t139-dev-db
 * 관찰값은 `T139 <태그> <JSON>` 한 줄씩 console.log 로 남긴다(숫자만 — 비밀·보유 정보 없음). 값은 전부 합성값이다.
 */
import mysql from 'mysql2/promise';

let mockPool: mysql.Pool | null = null;
jest.mock('@/lib/db', () => ({ getPool: () => { if (!mockPool) throw new Error('운영 풀 사용 금지(시험)'); return mockPool; } }));

import {
  RECORD_SWITCH_CACHE_MS,
  RECORD_SWITCH_TIMEOUT_MS,
  readRecordSwitchState,
  resetRecordSwitchCacheForTest,
  type RecordSwitchKey,
} from '../record-switch';

const PORT = process.env.T139_DB_PORT;
const PW = process.env.T139_DB_PASSWORD ?? '';
const DBNAME = process.env.T139_DB_NAME ?? 't139sw';
const maybe = PORT ? describe : describe.skip;

const EXIT: RecordSwitchKey = 'exit_judgment_record_enabled';
const JRL: RecordSwitchKey = 'job_run_log_enabled';
const JUDG: RecordSwitchKey = 'judgment_record_enabled';
/** 서버가 정리하는 데 걸리는 시간의 상한(관찰값은 로그로 남긴다). */
const SERVER_CLEAR_MS = 10_000;

jest.setTimeout(240_000);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function out(tag: string, o: unknown): void { console.log(`T139 ${tag} ${JSON.stringify(o)}`); }

function makePool(): mysql.Pool {
  // src/lib/db.ts createPool() 과 같은 풀 설정(연결 10·대기열 무제한·keepalive) — 접속 대상만 일회용 컨테이너
  return mysql.createPool({
    host: '127.0.0.1', port: Number(PORT), user: 'root', password: PW, database: DBNAME,
    waitForConnections: true, connectionLimit: 10, queueLimit: 0,
    enableKeepAlive: true, keepAliveInitialDelay: 10_000, timezone: '+09:00',
  });
}

/** mysql2/promise 풀 안쪽 콜백 풀의 연결 목록(시험 관찰 전용). */
interface CorePoolView { _allConnections: { length: number }; _freeConnections: { length: number }; _connectionQueue: { length: number } }
function stats(p: mysql.Pool): { all: number; free: number; busy: number; queued: number } {
  const c = (p as unknown as { pool: CorePoolView }).pool;
  const all = c._allConnections.length;
  const free = c._freeConnections.length;
  return { all, free, busy: all - free, queued: c._connectionQueue.length };
}

/** 스위치 SELECT 가 나간 창구를 센다 — 풀 query(변경 전)·받은 연결(변경 후) 둘 다. 시험 자신의 조회는 admin 연결로만 한다. */
function countSends(p: mysql.Pool): { query: number; getConnection: number; total: () => number } {
  const n = { query: 0, getConnection: 0, total: () => n.query + n.getConnection };
  const q = (p.query as unknown as (...a: unknown[]) => unknown).bind(p);
  const gc = (p.getConnection as unknown as () => Promise<mysql.PoolConnection>).bind(p);
  (p as unknown as { query: (...a: unknown[]) => unknown }).query = (...a: unknown[]) => { n.query += 1; return q(...a); };
  (p as unknown as { getConnection: () => Promise<mysql.PoolConnection> }).getConnection = () => { n.getConnection += 1; return gc(); };
  return n;
}

let admin: mysql.Connection;
let locker: mysql.Connection | null = null;

async function lock(): Promise<void> {
  locker = await mysql.createConnection({ host: '127.0.0.1', port: Number(PORT), user: 'root', password: PW, database: DBNAME });
  await locker.query('LOCK TABLES system_config WRITE');
}
async function unlock(): Promise<void> {
  if (!locker) return;
  try { await locker.query('UNLOCK TABLES'); } catch { /* 이미 끊김 */ }
  try { await locker.end(); } catch { /* 흡수 */ }
  locker = null;
}
/** 서버에서 지금 실행 중(대기 포함)인 스위치 SELECT 수. */
async function serverWaiting(): Promise<number> {
  const [r] = await admin.query<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE COMMAND = 'Query' AND INFO LIKE 'SELECT value FROM system_config%' AND ID <> CONNECTION_ID()",
  );
  return Number(r[0].n);
}
/** 서버 대기 SELECT 가 0 이 될 때까지(상한 SERVER_CLEAR_MS) — 걸린 ms 를 돌려준다(못 비우면 -1). */
async function waitServerClear(): Promise<number> {
  const t0 = Date.now();
  while (Date.now() - t0 <= SERVER_CLEAR_MS) {
    if ((await serverWaiting()) === 0) return Date.now() - t0;
    await sleep(250);
  }
  return -1;
}
async function endPool(p: mysql.Pool | null): Promise<void> {
  if (!p) return;
  await Promise.race([p.end().catch(() => undefined), sleep(8_000)]);
}
/** 무관한 표 조회가 ms 안에 끝나는가(풀이 말랐으면 대기열에서 기다린다). 안쪽 콜백 풀로 보내 countSends 계수에 섞지 않는다. */
async function unrelatedWithin(p: mysql.Pool, ms: number): Promise<'done' | 'pending'> {
  const core = (p as unknown as { pool: { query: (sql: string, cb: (e: unknown) => void) => void } }).pool;
  const q = new Promise<'done'>((res) => { core.query('SELECT v FROM other_tbl WHERE id = 1', () => res('done')); });
  return Promise.race([q, sleep(ms).then(() => 'pending' as const)]);
}
async function setValue(key: string, value: string | null): Promise<void> {
  await admin.query('REPLACE INTO system_config (`key`, value) VALUES (?, ?)', [key, value]);
}
async function dropKey(key: string): Promise<void> {
  await admin.query('DELETE FROM system_config WHERE `key` = ?', [key]);
}

maybe('T-139 일회용 MariaDB — 기록 스위치 읽기가 공용 풀 연결을 붙잡지 않는다', () => {
  beforeAll(async () => {
    const boot = await mysql.createConnection({ host: '127.0.0.1', port: Number(PORT), user: 'root', password: PW });
    await boot.query(`CREATE DATABASE IF NOT EXISTS \`${DBNAME}\``);
    await boot.end();
    admin = await mysql.createConnection({ host: '127.0.0.1', port: Number(PORT), user: 'root', password: PW, database: DBNAME });
    // 운영 system_config 와 같은 열 모양(key·value) — 합성 표
    await admin.query('CREATE TABLE IF NOT EXISTS system_config (`key` VARCHAR(64) NOT NULL PRIMARY KEY, value TEXT NULL)');
    await admin.query('CREATE TABLE IF NOT EXISTS other_tbl (id INT PRIMARY KEY, v INT)');
    await admin.query('REPLACE INTO other_tbl VALUES (1, 1)');
    const [v] = await admin.query<mysql.RowDataPacket[]>('SELECT VERSION() AS v, @@GLOBAL.lock_wait_timeout AS lwt');
    out('ENV', { version: String(v[0].v), lock_wait_timeout: Number(v[0].lwt), poolLimit: 10, queueLimit: 0, node: process.version });
  });
  afterAll(async () => {
    await unlock();
    await endPool(mockPool);
    mockPool = null;
    await admin.end();
  });
  beforeEach(async () => {
    resetRecordSwitchCacheForTest();
    await setValue(EXIT, 'true');
    await setValue(JRL, 'true');
    await setValue(JUDG, 'true');
    mockPool = makePool();
  });
  afterEach(async () => {
    await unlock();
    jest.restoreAllMocks();
    await endPool(mockPool);
    mockPool = null;
  });

  describe('S. 잠금 없음 — 동치·정상 경로', () => {
    test.each([
      ['키 없음', null, { enabled: false, source: 'missing' }],
      ["'true'", 'true', { enabled: true, source: 'value' }],
      ["' true '", ' true ', { enabled: true, source: 'value' }],
      ["'false'", 'false', { enabled: false, source: 'value' }],
      ['문자열 "true"', '"true"', { enabled: false, source: 'value' }],
      ["'TRUE'", 'TRUE', { enabled: false, source: 'value' }],
      ["'1'", '1', { enabled: false, source: 'value' }],
      ['잘못된 JSON', '{bad', { enabled: false, source: 'value' }],
      ['NULL 값', 'NULL', { enabled: false, source: 'value' }],
    ] as const)('%s → 변경 전 규칙과 같은 결과, 연결은 release(busy 0)', async (_n, stored, expected) => {
      if (stored === null) await dropKey(JUDG);
      else if (stored === 'NULL') await setValue(JUDG, null);
      else await setValue(JUDG, stored);
      const n = countSends(mockPool!);
      const t0 = Date.now();
      await expect(readRecordSwitchState(JUDG)).resolves.toEqual(expected);
      const ms = Date.now() - t0;
      expect(n.total()).toBe(1);
      expect(stats(mockPool!).busy).toBe(0);
      expect(ms).toBeLessThan(1_000);
    });
    test('허용 목록 밖 키 → unknown_key, 풀을 건드리지 않는다', async () => {
      const n = countSends(mockPool!);
      await expect(readRecordSwitchState('safety_kill_switch' as unknown as RecordSwitchKey)).resolves.toEqual({ enabled: false, source: 'unknown_key' });
      expect(n.total()).toBe(0);
      expect(stats(mockPool!).all).toBe(0);
    });
    test('테이블 없음(1146) → read_error, busy 0', async () => {
      await admin.query('RENAME TABLE system_config TO system_config_t139_hidden');
      try {
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        await expect(readRecordSwitchState(EXIT)).resolves.toEqual({ enabled: false, source: 'read_error' });
        expect(stats(mockPool!).busy).toBe(0);
      } finally {
        await admin.query('RENAME TABLE system_config_t139_hidden TO system_config');
      }
    });
  });

  describe('🔴 잠긴 system_config — 상한 뒤 풀 연결이 남지 않는다', () => {
    test('L1 단일 호출: 2초 상한에 timeout, 돌려줄 때 busy 0, 서버 대기 SELECT 가 곧 사라진다 → 잠금 해제 뒤 정상 값', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      await lock();
      const n = countSends(mockPool!);
      const t0 = Date.now();
      const s = await readRecordSwitchState(EXIT);
      const elapsedMs = Date.now() - t0;
      const atReturn = stats(mockPool!);
      const clearMs = await waitServerClear();
      out('L1', { state: s, elapsedMs, poolAtReturn: atReturn, sends: n.total(), serverClearMs: clearMs, poolAfter: stats(mockPool!) });
      expect(s).toEqual({ enabled: false, source: 'timeout' });
      expect(elapsedMs).toBeGreaterThanOrEqual(RECORD_SWITCH_TIMEOUT_MS - 50);
      expect(elapsedMs).toBeLessThan(RECORD_SWITCH_TIMEOUT_MS + 1_500);
      expect(n.total()).toBe(1);
      expect(atReturn.busy).toBe(0);
      expect(clearMs).toBeGreaterThanOrEqual(0);
      expect(stats(mockPool!).busy).toBe(0);

      // R. 잠금 해제 뒤 — 캐시(30초)를 비우면 곧바로 정상 값
      await unlock();
      resetRecordSwitchCacheForTest();
      const t1 = Date.now();
      await expect(readRecordSwitchState(EXIT)).resolves.toEqual({ enabled: true, source: 'value' });
      expect(Date.now() - t1).toBeLessThan(1_000);
      expect(stats(mockPool!).busy).toBe(0);
    });

    test('L2 같은 키 10건 동시: 모두 timeout, 조회 1, busy 0, 무관한 표 조회는 곧바로 통과', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      await lock();
      const n = countSends(mockPool!);
      const rs = await Promise.all(Array.from({ length: 10 }, () => readRecordSwitchState(EXIT)));
      const atReturn = stats(mockPool!);
      const unrelated = await unrelatedWithin(mockPool!, 1_000);
      const clearMs = await waitServerClear();
      out('L2', { sources: [...new Set(rs.map((r) => r.source))], sends: n.total(), poolAtReturn: atReturn, unrelated, serverClearMs: clearMs, warnLines: warn.mock.calls.length });
      expect(rs).toEqual(Array.from({ length: 10 }, () => ({ enabled: false, source: 'timeout' })));
      expect(n.total()).toBe(1);
      expect(atReturn.busy).toBe(0);
      expect(unrelated).toBe('done');
      expect(clearMs).toBeGreaterThanOrEqual(0);
      expect(warn.mock.calls).toHaveLength(1);
      await unlock();
    });

    test('L3 14분 모사(분당 약 1.2건 = 크론 기록 매분 + 청산 기록 4·8·12분): 매번 busy 0, 끝나고 서버 대기 0', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      await lock();
      const n = countSends(mockPool!);
      const realNow = Date.now.bind(Date);
      let skew = 0;
      jest.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);
      const busyTrace: number[] = [];
      let calls = 0;
      const sources = new Set<string>();
      for (let m = 1; m <= 14; m++) {
        skew += RECORD_SWITCH_CACHE_MS * 2 + 1_000;   // 61초 — 30초 캐시가 매번 지난다
        sources.add((await readRecordSwitchState(JRL)).source); calls += 1;
        busyTrace.push(stats(mockPool!).busy);
        if (m % 4 === 0) {
          sources.add((await readRecordSwitchState(EXIT)).source); calls += 1;
          busyTrace.push(stats(mockPool!).busy);
        }
      }
      jest.restoreAllMocks();
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      const clearMs = await waitServerClear();
      const unrelated = await unrelatedWithin(mockPool!, 1_000);
      out('L3', { calls, perMinute: Number((calls / 14).toFixed(2)), sends: n.total(), busyTrace: busyTrace.join(','), sources: [...sources], serverClearMs: clearMs, unrelated, poolEnd: stats(mockPool!) });
      expect(calls).toBe(17);
      expect(n.total()).toBe(17);                       // 캐시가 매번 지나 호출마다 1번(합칠 동시 호출 없음)
      expect([...sources]).toEqual(['timeout']);
      expect(Math.max(...busyTrace)).toBe(0);
      expect(clearMs).toBeGreaterThanOrEqual(0);
      expect(unrelated).toBe('done');
      await unlock();
    });

    test('L4 풀 10개가 모두 바쁜 동안 읽기: 2초에 timeout, 풀이 풀린 뒤 받은 연결로 SELECT 를 보내지 않는다', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      await lock();
      const occupy = Array.from({ length: 10 }, () => mockPool!.query('SELECT SLEEP(4)'));
      await sleep(300);
      const whileFull = stats(mockPool!);
      const t0 = Date.now();
      const s = await readRecordSwitchState(EXIT);
      const elapsedMs = Date.now() - t0;
      await Promise.all(occupy);
      await sleep(800);                                  // 늦게 받은 연결이 SELECT 를 보냈다면 잠금 때문에 서버에 남아 있을 시간
      const waitingAfter = await serverWaiting();
      const poolAfter = stats(mockPool!);
      out('L4', { state: s, elapsedMs, poolWhileFull: whileFull, serverWaitingAfterSleeps: waitingAfter, poolAfter });
      expect(whileFull.busy).toBe(10);
      expect(s).toEqual({ enabled: false, source: 'timeout' });
      expect(elapsedMs).toBeLessThan(RECORD_SWITCH_TIMEOUT_MS + 1_500);
      expect(waitingAfter).toBe(0);
      expect(poolAfter.busy).toBe(0);
      await unlock();
    });
  });
});

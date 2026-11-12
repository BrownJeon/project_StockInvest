/**
 * T-167 — 거시 레짐 라벨 장기 보관 표 **일회용 MariaDB 실증 시험** (평소 jest 실행에서는 정적 검사만 돌고 DB 부분은 건너뛴다 — `T167_DB_PORT` 가 있을 때만).
 *
 * 단위 시험(목 풀)은 SQL 자체를 검증하지 못한다 — 열 이름 오타·DECIMAL·CHECK·JSON 함수 동작이 틀리면 기록기는 실패를 삼키므로 운영에서
 * **조용히 아무것도 남지 않고**, 이관은 0행이거나 틀린 값을 넣는다. 그래서 운영과 같은 판(10.11.11)·같은 sql_mode·같은 binlog_format 의 일회용 DB 에
 * DDL·이관 파일을 **그대로** 적용하고 실물 기록기로 끝에서 끝까지 넣어 본다(Leader G5-3).
 *
 *  A. A0 환경(판·sql_mode·KST·binlog ROW) · A1 DDL 2회 적용 멱등(2차 Note 1050·SHOW CREATE TABLE 동일) · A2 열·키·CHECK·문자셋 ·
 *     A3 strict 거부(CHECK·길이·ENUM — errno)
 *  B. 이관 — 운영 정의 그대로의 eval_funnel 에 합성 행(ok·unknown(미로딩 단독)·유형⑤·복수 사유·asOfUtc 빈 값·조기 종료 run 행·gate≠run·
 *     라벨 없는 run 행·11-11 행·막 끝난 행·detail NULL·macroRegime null/문자열)을 넣고 이관 파일을 **그대로** 2회 → 대상만·정확한 수·2차 0행 ·
 *     변환값 = 실시간 기록기의 행 빌더 결과(열 하나하나) · record_json 이 원본 JSON.stringify 와 바이트 같음(unknown 포함 — Analyst 미확인 ① 해소) ·
 *     NULL 날짜가 0000-00-00 이 아님 · 파일 주석의 확인·대조 쿼리(①②ⓐⓑⓒ)를 그대로 실행 · 막 끝난 행은 2분 상한 뒤에야 잡힘
 *  C. 실물 기록기 끝에서 끝: 표 없음 → no_table · 정상 → written · 이관된 런을 실시간으로 다시 쓰면 duplicate(행 1개 유지) ·
 *     실시간 먼저 → 이관 때 그 런 건너뜀(NOT EXISTS) · 🔴 (G9-3) 실시간 기록과 경합한 이관이 1062 로 **문장 전체 0행** → 재실행이 정상 완료 ·
 *     표가 잠긴 채 기록 → 4초 timeout, 풀 연결 반환(바쁜 연결 0)
 *  B5. (G10 R-1) 원본 eval_funnel 에 같은 (run_id, as_of_utc) 행이 2개(같은 분 시작·같은 초 종료 두 런) — 고치기 전 문장 모양은 1062 로 0행(재현),
 *     이관 파일은 가장 작은 id 하나만 옮기고 성공 · 2차 0행 · 대조 ⓑ = 1 · ⓐ = 0 (①·ⓒ 가 0 충돌을 가정하는 시험들 뒤에 둔다)
 *  G. 🔴 (G11 R-4) 일회용 대상 가드 — 대상 DB 이름이 `^t167[a-z0-9_]*$` 가 아니거나, 그 스키마에 운영 표 표지(orders·signals·system_config)가 하나라도 있으면
 *     **첫 파괴적 문장(DROP·TRUNCATE·DELETE) 전에** 던진다(beforeAll). 가드를 통과하지 못하면 beforeEach 가 모든 DB 시험 본문을 막는다. 정적 검사가 가드 호출이
 *     첫 파괴적 문장보다 앞에 있음을, DB 시험 G1 이 표지 표를 일부러 만든 별 스키마(t167guard)에서 가드가 던지고 아무것도 지우지 않음을 확인한다.
 *  D. 이관이 READ COMMITTED 로 원본(eval_funnel)을 잠그지 않는다 — 이관 트랜잭션을 열어 둔 채 다른 연결의 eval_funnel INSERT 가 즉시 통과(관찰값 남김).
 *     대조로 REPEATABLE READ 일 때의 결과도 관찰값으로만 남긴다.
 *
 * 실행(운영·공용 DB 금지 — 127.0.0.1 에만 묶인 일회용 컨테이너. 비밀번호·포트는 그때그때 임의로, 환경변수로만. 띄운 컨테이너 ID 를 파일에 적고
 * **그 ID 로만** 지운다 — 이름·패턴 일괄 종료 금지(ISS-0002)):
 *   T167_DB_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -dc A-Za-z0-9 | head -c 24)"; export T167_DB_PASSWORD
 *   T167_DB_PORT=$((33600 + RANDOM % 100)); export T167_DB_PORT
 *   docker run -d --rm --pull=never --name t167-dev-db-$T167_DB_PORT -p 127.0.0.1:$T167_DB_PORT:3306 \
 *     -e MARIADB_ROOT_PASSWORD="$T167_DB_PASSWORD" -e MARIADB_DATABASE=t167impl -e TZ=Asia/Seoul mariadb:10.11.11 \
 *     --sql-mode=STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION \
 *     --character-set-server=utf8mb3 --collation-server=utf8mb3_general_ci --log-bin=t167-bin --binlog-format=ROW --server-id=1 > <id 파일>
 *   npx jest src/lib/strategy/macro-regime/__tests__/label-log-disposable-mariadb.test.ts
 *   docker rm -fv "$(cat <id 파일>)"
 * 값은 전부 합성값이다(ok 기록 1건은 운영 id 904956 의 기록 객체 모양을 그대로 옮긴 것 — 비밀 값 없음).
 */
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';

let mockPool: mysql.Pool | null = null;
jest.mock('@/lib/db', () => ({ getPool: () => { if (!mockPool) throw new Error('운영 풀 사용 금지(시험)'); return mockPool; } }));

import {
  MACRO_REGIME_LABEL_LOG_COLUMNS,
  MACRO_REGIME_LABEL_LOG_TIMEOUT_MS,
  __resetMacroRegimeLabelLogWarningsForTest,
  __setMacroRegimeLabelLogForTest,
  buildMacroRegimeLabelRow,
  recordMacroRegimeLabel,
  recordMacroRegimeLabelRow,
  waitForMacroRegimeLabelLogForTest,
  type MacroRegimeLabelLogRow,
} from '../label-log';
import { classifyMacroRegime, internalErrorRecord } from '../classify';
import type { MacroRegimeRecord } from '../types';

const PORT = process.env.T167_DB_PORT;
const DBNAME = process.env.T167_DB_NAME ?? 't167impl';
const maybe = PORT ? describe : describe.skip;
/** 🔴 (G11 R-4) 일회용 시험 DB 이름 — 이 모양이 아니면 아무것도 지우지 않는다 */
const DISPOSABLE_DB_NAME_RE = /^t167[a-z0-9_]*$/;
/** 운영 스키마 표지 — 하나라도 있으면 일회용 DB 가 아니다 */
const PROD_MARKER_TABLES = ['orders', 'signals', 'system_config'] as const;
/**
 * 🔴 (G11 R-4) 대상이 일회용 시험 DB 인지 확인한다 — 파괴적 문장 전에 반드시 부른다. 아니면 던진다.
 * 던지는 메시지에는 접속값(호스트·포트·DB 이름·비밀번호)을 넣지 않는다.
 */
async function assertDisposableTarget(cn: { query: (sql: string, params?: unknown[]) => Promise<unknown> }, dbName: string): Promise<void> {
  if (!DISPOSABLE_DB_NAME_RE.test(dbName)) {
    throw new Error('T-167 일회용 DB 가드: 대상 DB 이름이 일회용 시험 DB 형식(t167…)이 아니다 — 시험을 멈춘다');
  }
  const [cur] = (await cn.query('SELECT DATABASE() AS db')) as [Array<{ db: string | null }>, unknown];
  if (!cur[0] || cur[0].db !== dbName) {
    throw new Error('T-167 일회용 DB 가드: 연결된 스키마가 지정한 일회용 시험 DB 와 다르다 — 시험을 멈춘다');
  }
  const [mk] = (await cn.query(
    'SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?, ?, ?)',
    [...PROD_MARKER_TABLES],
  )) as [Array<{ n: number | string }>, unknown];
  if (Number(mk[0]?.n) !== 0) {
    throw new Error('T-167 일회용 DB 가드: 대상 스키마에 운영 표 표지(orders·signals·system_config)가 있다 — 일회용 DB 가 아니므로 시험을 멈춘다');
  }
}
const MIG = path.join(__dirname, '..', '..', '..', '..', '..', 'scripts', 'migrations');
const DDL = fs.readFileSync(path.join(MIG, 'T-167-macro-regime-label-log.sql'), 'utf8');
const BACKFILL = fs.readFileSync(path.join(MIG, 'T-167-macro-regime-label-backfill.sql'), 'utf8');
/** 운영 @@GLOBAL.sql_mode (2026-11-12 읽기 전용 조회) */
const PROD_SQL_MODE = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION';
/** 운영 SHOW CREATE TABLE eval_funnel (2026-11-12 읽기 전용 조회 — AUTO_INCREMENT 값만 뺐다) */
const EVAL_FUNNEL_DDL = `CREATE TABLE eval_funnel (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  run_id varchar(40) NOT NULL,
  ts datetime NOT NULL DEFAULT current_timestamp(),
  market enum('domestic','overseas') NOT NULL,
  symbol varchar(32) DEFAULT NULL,
  strategy_id varchar(64) DEFAULT NULL,
  side enum('buy','sell') DEFAULT NULL,
  stage tinyint(3) unsigned NOT NULL,
  gate varchar(48) NOT NULL,
  verdict enum('pass','skip','error') NOT NULL,
  reason varchar(64) DEFAULT NULL,
  detail longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(detail)),
  PRIMARY KEY (id),
  KEY idx_ef_run (run_id),
  KEY idx_ef_ts (ts),
  KEY idx_ef_gate (gate,ts),
  KEY idx_ef_market (market,ts,stage)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`;

function statements(sql: string): string[] {
  return sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n').split(';').map((s) => s.trim()).filter(Boolean);
}
function rollbackStatements(sql: string): string[] {
  return sql.split('\n').filter((l) => /^-- DROP TABLE /.test(l)).map((l) => l.replace(/^-- /, '').replace(/;\s*$/, ''));
}
/** 이관 파일 주석의 [check:<id>] 블록 → SQL(블록 안 「-- 」+공백 3칸 줄만, 끝 ; 제거) */
function checkQueries(sql: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = sql.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const h = /^-- \[check:([a-z0-9]+)\]/.exec(lines[i]);
    if (!h) continue;
    const body: string[] = [];
    for (let j = i + 1; j < lines.length && lines[j].startsWith('--') && lines[j].trim() !== '--'; j++) {
      if (/^-- {3}/.test(lines[j])) body.push(lines[j].slice(2));
    }
    out.set(h[1], body.join('\n').trim().replace(/;\s*$/, ''));
  }
  return out;
}

describe('마이그레이션 파일 정적 검사(DB 없이)', () => {
  test('🔴 (G11 R-4) 일회용 대상 가드 — DB 이름 정규식, beforeAll 에서 첫 파괴적 문장보다 먼저 부른다, 통과 전에는 DB 시험 본문을 막는다', () => {
    expect(DISPOSABLE_DB_NAME_RE.source).toBe('^t167[a-z0-9_]*$');
    for (const ok of ['t167impl', 't167cli', 't167guard', 't167']) expect([ok, DISPOSABLE_DB_NAME_RE.test(ok)]).toEqual([ok, true]);
    for (const bad of ['stockinvest', 'T167impl', 'xt167impl', 't167impl;drop', 't167-impl', 't167impl ', '']) expect([bad, DISPOSABLE_DB_NAME_RE.test(bad)]).toEqual([bad, false]);
    expect([...PROD_MARKER_TABLES]).toEqual(['orders', 'signals', 'system_config']);
    const src = fs.readFileSync(__filename, 'utf8');
    const start = src.search(/^maybe\('T-167 일회용 MariaDB/m);   // 줄 처음의 실제 블록(이 시험 안의 문자열과 구분)
    expect(start).toBeGreaterThan(0);
    // DB 시험 블록의 코드(줄 주석 제거)에서 가드 호출 위치 vs 첫 파괴적 SQL 위치
    const code = src.slice(start).split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    const guardAt = code.indexOf('await assertDisposableTarget(c, DBNAME);');
    const firstDestructive = code.search(/\b(DROP|TRUNCATE|DELETE)\b/);
    expect(guardAt).toBeGreaterThan(0);
    expect(firstDestructive).toBeGreaterThan(0);
    expect(guardAt).toBeLessThan(firstDestructive);
    // 가드 호출은 beforeAll 첫 연결 바로 다음이고, 통과 표시 뒤에야 파괴적 문장이 온다
    const hook = code.slice(code.indexOf('beforeAll(async () => {'));
    const lines = hook.split('\n').map((l) => l.trim()).filter(Boolean);
    expect(lines.slice(1, 4)).toEqual(['c = await conn();', 'await assertDisposableTarget(c, DBNAME);', 'guardOk = true;']);
    expect(code).toMatch(/beforeEach\(\(\) => \{\s*if \(!guardOk\) throw new Error/);
  });

  test('DDL — 문장 2개 = SET SESSION lock_wait_timeout = 5 + CREATE TABLE IF NOT EXISTS macro_regime_label_log — 가산 전용', () => {
    const st = statements(DDL);
    expect(st).toHaveLength(2);
    expect(st[0]).toBe('SET SESSION lock_wait_timeout = 5');
    expect(st[1].startsWith('CREATE TABLE IF NOT EXISTS macro_regime_label_log (')).toBe(true);
    for (const s of st) expect(s).not.toMatch(/\b(ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|RENAME|GRANT|REPLACE)\b/i);
    expect(st[1]).not.toMatch(/\b(FOREIGN|REFERENCES)\b/i);
    expect(DDL).not.toContain('\\');
    expect(rollbackStatements(DDL)).toEqual(['DROP TABLE IF EXISTS macro_regime_label_log']);
  });

  test('DDL 머리 주석 — 적용 즉시 기록 시작·끄는 법·자동 삭제 없음·이관 마감·DDL 먼저(G9-2)', () => {
    expect(DDL).toMatch(/적용하는 즉시 다음 런부터 런마다 1행씩 기록이 시작된다/);
    expect(DDL).toMatch(/MACRO_REGIME_LABEL_LOG_ENABLED=false/);
    expect(DDL).toMatch(/자동 삭제 없음/);
    expect(DDL).toMatch(/2026-12-12 10:20 KST 이후 첫 prune/);
    expect(DDL).toMatch(/실제로 써졌을 때만/);
  });

  test('이관 — 문장 4개(세션 SET 3 + INSERT … SELECT 1), 대상 표만 쓴다, IGNORE·ON DUPLICATE KEY 없음', () => {
    const st = statements(BACKFILL);
    expect(st.slice(0, 3)).toEqual([
      'SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED',
      'SET SESSION innodb_lock_wait_timeout = 5',
      'SET SESSION lock_wait_timeout = 5',
    ]);
    expect(st).toHaveLength(4);
    const ins = st[3];
    expect(ins.startsWith('INSERT INTO macro_regime_label_log (')).toBe(true);
    expect(ins).not.toMatch(/\bIGNORE\b|ON\s+DUPLICATE|\b(UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|RENAME)\b|REPLACE\s+INTO/i);
    expect(ins.match(/\bINSERT\b/gi)).toHaveLength(1);
    expect(ins).toMatch(/ef\.ts < NOW\(\) - INTERVAL 2 MINUTE/);   // G9-3 상한
    expect(ins).toMatch(/ef\.ts >= '2026-11-12 00:00:00'/);
    expect(ins).toMatch(/WHERE x\.rn = 1\s+AND NOT EXISTS \(/);
    // G10 R-1 — 원본 중복은 (run_id, as_of_utc) 마다 가장 작은 eval_funnel.id 하나만(as_of_utc 는 파생 표에서 한 번만 계산한 값)
    expect(ins).toMatch(/ROW_NUMBER\(\) OVER \(PARTITION BY y\.run_id, y\.as_of_utc ORDER BY y\.id\) AS rn/);
    expect(ins.match(/STR_TO_DATE\(NULLIF\(JSON_VALUE\(ef\.detail, '\$\.macroRegime\.asOfUtc'\)/g)).toHaveLength(1);
    expect(BACKFILL).not.toContain('\\');
    // 열 목록 = 실시간 기록기와 같은 상수(순서 포함)
    const cols = /^INSERT INTO macro_regime_label_log \(([^)]*)\)/.exec(ins)![1].split(',').map((c) => c.trim());
    expect(cols).toEqual([...MACRO_REGIME_LABEL_LOG_COLUMNS]);
  });

  test('이관 머리 주석 — 1062 면 문장 전체 0행·다시 실행(G9-3), 조건부 무손실(G9-2)', () => {
    expect(BACKFILL).toMatch(/1062 가 나면: 이 INSERT 는 \*\*문장 전체가 0행으로 롤백\*\*된다.*\*\*다시 실행하면 된다\(멱등\)\*\*/);
    expect(BACKFILL).toMatch(/원본이 지워진 런은 되살릴 수 없다/);
    // G10 R-1 문장
    expect(BACKFILL).toMatch(/원본 중복은 가장 작은 id 하나만 옮긴다\(대조 쿼리 ⓑ 로 수 확인\)/);
    expect(BACKFILL).toMatch(/그래도 1062 가 반복되면 장중 실시간 경합이다 — 장외에 다시 실행한다/);
  });

  test('확인·대조 쿼리 5개(①②ⓐⓑⓒ)가 주석으로 있고 모두 읽기 전용 SELECT 다', () => {
    const q = checkQueries(BACKFILL);
    expect([...q.keys()].sort()).toEqual(['1', '2', 'a', 'b', 'c']);
    for (const [, sql] of q) {
      expect(sql).toMatch(/^SELECT\b/);
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|RENAME|REPLACE)\b/i);
    }
  });
});

// ── 합성 기록 ────────────────────────────────────────────────────────────────
const OK_RECORD: MacroRegimeRecord = {
  ruleVersion: 'macro-regime-c0@1', label: 'normal_tightening', isType5: false, reasonCodes: [],
  asOfUtc: '2026-11-12T01:20:40Z', asOfEtDate: '2026-11-11',
  cpi: {
    seriesId: 'CUUR0000SA0', referenceMonth: '2026-09', releaseAtUtc: '2026-10-14T12:30:00Z', index: 336.94, baseMonth: '2025-09', baseIndex: 324.8,
    yoyPctRaw: 3.7377, yoyPct: 3.7, hot: false, monthGap: 2, expectedReferenceMonth: '2026-10', lagsSchedule: true,
    fetchedAtUtc: '2026-11-12T01:18:14Z', cacheAgeSec: 145, fetchStatus: 'ok',
  },
  rate: {
    upperPct: 4, upperEffectiveFrom: '2026-09-17', compareDate: '2026-05-11', upper6mAgoPct: 3.75, deltaPct: 0.25, direction: 'tightening',
    tableVerifiedThrough: '2026-11-11', nextKnownDecisionDate: '2026-12-09',
  },
};
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const UNKNOWN_RECORD = classifyMacroRegime({ asOf: new Date('2026-11-12T00:35:10Z'), cpiIndex: null, fetchedAt: null, fetchStatus: 'not_attempted' });
const TYPE5_RECORD: MacroRegimeRecord = {
  ...clone(OK_RECORD), label: 'hot_tightening', isType5: true, asOfUtc: '2026-11-12T00:05:00Z', asOfEtDate: '2026-11-11',
  cpi: { ...clone(OK_RECORD).cpi, yoyPctRaw: 4.0512, yoyPct: 4.1, hot: true, lagsSchedule: false, monthGap: 1, cacheAgeSec: -3 },
};
const MULTI_REASON_RECORD = {
  ...clone(OK_RECORD), label: 'unknown', isType5: false, reasonCodes: ['cpi_cache_stale', 'rate_table_stale'],
  asOfUtc: '2026-11-11T23:40:00Z', asOfEtDate: '2026-11-11',
  cpi: { ...clone(OK_RECORD).cpi, referenceMonth: null, releaseAtUtc: null, index: null, baseMonth: null, baseIndex: null, yoyPctRaw: null, yoyPct: null,
    hot: null, monthGap: null, fetchedAtUtc: '2026-11-05T09:00:00Z', cacheAgeSec: 711_600, fetchStatus: 'timeout' },
  rate: { ...clone(OK_RECORD).rate, upperPct: null, upperEffectiveFrom: null, upper6mAgoPct: null, deltaPct: null, direction: null, tableVerifiedThrough: '' },
} as unknown as MacroRegimeRecord;
const EMPTY_ASOF_RECORD = internalErrorRecord(new Date(Number.NaN), 'http_error');

interface EfRow { run_id: string; ts: string | null; market: 'domestic' | 'overseas'; gate: string; verdict: 'pass' | 'skip' | 'error'; detail: string | null }
// ⚠ ts 는 이관 대상 창(2026-11-12 00:00:00 ≤ ts < NOW() − 2분) 안의 **과거** 시각이어야 한다 — 미래 ts 는 상한에 걸려 이관되지 않는다
//   (그러면 「건너뜀」 시험이 엉뚱한 이유로 통과한다). 기록 객체의 asOfUtc 는 내용일 뿐이라 ts 와 맞출 필요가 없다(빈 asOfUtc 폴백 행만 ts − 9h).
const runDetail = (mr: unknown) => JSON.stringify({ symbols: 6, strategies: 1, skippedStrategyIds: [], buyBlocked: false, signalsCreated: 0, errors: 0, macroRegime: mr });
/** 대상 5개 + 제외 8개 */
const TARGETS: Array<{ key: string; ef: EfRow; record: MacroRegimeRecord; fallbackMs?: number }> = [
  { key: 'ok', ef: { run_id: 'domestic-202611121018', ts: '2026-11-12 10:20:40', market: 'domestic', gate: 'run', verdict: 'pass', detail: runDetail(OK_RECORD) }, record: OK_RECORD },
  { key: 'unknown', ef: { run_id: 'overseas-202611120933', ts: '2026-11-12 09:35:11', market: 'overseas', gate: 'run', verdict: 'pass', detail: runDetail(UNKNOWN_RECORD) }, record: UNKNOWN_RECORD },
  { key: 'type5', ef: { run_id: 'domestic-202611120903', ts: '2026-11-12 09:05:02', market: 'domestic', gate: 'run', verdict: 'pass', detail: runDetail(TYPE5_RECORD) }, record: TYPE5_RECORD },
  { key: 'multi', ef: { run_id: 'overseas-202611120838', ts: '2026-11-12 08:40:01', market: 'overseas', gate: 'run', verdict: 'pass', detail: runDetail(MULTI_REASON_RECORD) }, record: MULTI_REASON_RECORD },
  { key: 'empty_asof', ef: { run_id: 'domestic-202611120810', ts: '2026-11-12 08:12:07', market: 'domestic', gate: 'run', verdict: 'pass', detail: runDetail(EMPTY_ASOF_RECORD) }, record: EMPTY_ASOF_RECORD, fallbackMs: Date.parse('2026-11-11T23:12:07Z') },
];
const EXCLUDED: EfRow[] = [
  { run_id: 'domestic-202611121030', ts: '2026-11-12 10:31:00', market: 'domestic', gate: 'run', verdict: 'skip', detail: JSON.stringify({ error: 'synthetic', exitEvaluated: false }) },   // 조기 종료 run 행
  { run_id: 'domestic-202611121035', ts: '2026-11-12 10:36:00', market: 'domestic', gate: 'final', verdict: 'pass', detail: runDetail(OK_RECORD) },   // gate ≠ run
  { run_id: 'domestic-202611120905', ts: '2026-11-12 09:05:00', market: 'domestic', gate: 'run', verdict: 'pass', detail: JSON.stringify({ symbols: 6 }) },   // 라벨 없는 run 행
  { run_id: 'domestic-202611111500', ts: '2026-11-11 23:59:59', market: 'domestic', gate: 'run', verdict: 'pass', detail: runDetail({ ...clone(OK_RECORD), asOfUtc: '2026-11-11T14:59:59Z' }) },   // 11-11
  { run_id: 'domestic-202611121040', ts: '2026-11-12 10:41:00', market: 'domestic', gate: 'run', verdict: 'pass', detail: null },
  { run_id: 'domestic-202611121045', ts: '2026-11-12 10:46:00', market: 'domestic', gate: 'run', verdict: 'pass', detail: JSON.stringify({ macroRegime: null }) },
  { run_id: 'domestic-202611121050', ts: '2026-11-12 10:51:00', market: 'domestic', gate: 'run', verdict: 'pass', detail: JSON.stringify({ macroRegime: 'unknown' }) },
  { run_id: 'domestic-202611121055', ts: '2026-11-12 10:56:00', market: 'domestic', gate: 'run', verdict: 'error', detail: runDetail(OK_RECORD) },
];

const DECIMAL_COLS = new Set(['cpi_index', 'cpi_base_index', 'cpi_yoy_pct_raw', 'cpi_yoy_pct', 'rate_upper_pct', 'rate_upper_6m_ago_pct', 'rate_delta_pct']);
/** 출처마다 달라지는 열 — 변환 동등성 비교에서 뺀다 */
const SOURCE_COLS = new Set(['source', 'source_eval_funnel_id', 'source_ts_kst', 'engine_release']);
const ERR = (e: unknown) => (e as { errno?: number }).errno;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

maybe('T-167 일회용 MariaDB — DDL·이관·실물 기록기', () => {
  let c: mysql.Connection;
  let pool: mysql.Pool;
  const efIds = new Map<string, number>();
  const conn = () => mysql.createConnection({
    host: '127.0.0.1', port: Number(PORT), user: 'root', password: process.env.T167_DB_PASSWORD, database: DBNAME,
    timezone: '+09:00', dateStrings: true, multipleStatements: true,
  });
  const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => (await c.query(sql, params))[0] as T[];
  const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> => (await rows<T>(sql, params))[0];
  const insertEf = async (r: EfRow): Promise<number> => {
    const [res] = await c.query(
      `INSERT INTO eval_funnel (run_id, ts, market, stage, gate, verdict, detail) VALUES (?, ${r.ts === null ? 'NOW()' : '?'}, ?, 0, ?, ?, ?)`,
      r.ts === null ? [r.run_id, r.market, r.gate, r.verdict, r.detail] : [r.run_id, r.ts, r.market, r.gate, r.verdict, r.detail],
    ) as [mysql.ResultSetHeader, unknown];
    return res.insertId;
  };
  /** 이관 파일을 **그대로**(여러 문장 한 번에) 실행하고 INSERT 의 영향 행 수를 돌려준다 */
  const runBackfill = async (cn: mysql.Connection = c): Promise<number> => {
    const [res] = await cn.query(BACKFILL) as [mysql.ResultSetHeader[], unknown];
    // 세션 SET 3 + INSERT 1 (+ 파일 끝 주석만 남은 빈 문장 1 — 서버가 결과 하나를 더 돌려준다). INSERT 외에는 아무 행도 바꾸지 않는다.
    expect(res.length).toBeGreaterThanOrEqual(4);
    expect(res.length).toBeLessThanOrEqual(5);
    for (const r of [...res.slice(0, 3), ...res.slice(4)]) expect(r.affectedRows).toBe(0);
    return res[3].affectedRows;
  };
  const logCount = async (where = '1=1', params: unknown[] = []) => Number((await one<{ n: number }>(`SELECT COUNT(*) AS n FROM macro_regime_label_log WHERE ${where}`, params)).n);
  const runCheck = async (id: string) => rows(checkQueries(BACKFILL).get(id)!);
  const busyConnections = () => {
    const inner = (pool as unknown as { pool: { _allConnections: { length: number }; _freeConnections: { length: number } } }).pool;
    return inner._allConnections.length - inner._freeConnections.length;
  };

  let guardOk = false;
  beforeAll(async () => {
    c = await conn();
    await assertDisposableTarget(c, DBNAME);   // 🔴 (G11 R-4) 첫 파괴적 문장보다 반드시 먼저
    guardOk = true;
    await c.query('DROP TABLE IF EXISTS macro_regime_label_log');
    await c.query('DROP TABLE IF EXISTS eval_funnel');
    await c.query(EVAL_FUNNEL_DDL);
    pool = mysql.createPool({
      host: '127.0.0.1', port: Number(PORT), user: 'root', password: process.env.T167_DB_PASSWORD, database: DBNAME,
      timezone: '+09:00', connectionLimit: 10, queueLimit: 0,
    });
    mockPool = pool;
    __setMacroRegimeLabelLogForTest({ enabled: true });
  });
  afterAll(async () => {
    __setMacroRegimeLabelLogForTest(null);
    mockPool = null;
    await pool?.end();
    await c?.end();
  });
  beforeEach(() => {
    if (!guardOk) throw new Error('T-167 일회용 DB 가드 미통과 — DB 시험 본문을 실행하지 않는다');
    __resetMacroRegimeLabelLogWarningsForTest();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { jest.restoreAllMocks(); });

  test('A0. 환경 — 10.11.11 · 운영과 같은 GLOBAL sql_mode · KST(+9) · binlog ROW', async () => {
    const r = await one<{ v: string; g: string; m: string; off: number; bf: string; lb: number }>(
      'SELECT @@version AS v, @@GLOBAL.sql_mode AS g, @@SESSION.sql_mode AS m, TIMESTAMPDIFF(HOUR, UTC_TIMESTAMP(), NOW()) AS off, @@GLOBAL.binlog_format AS bf, @@GLOBAL.log_bin AS lb',
    );
    console.log(`[T167-evidence] A0 version=${r.v} global_sql_mode=${r.g} session_sql_mode=${r.m} kst_offset_h=${r.off} binlog_format=${r.bf} log_bin=${r.lb}`);
    expect(r.v.startsWith('10.11.11-MariaDB')).toBe(true);
    expect(r.g).toBe(PROD_SQL_MODE);   // 운영 GLOBAL 값 그대로(IGNORE_SPACE 없음 — 사람이 mysql 클라이언트로 파일을 적용하는 세션이 이 값이다)
    // mysql2 는 클라이언트 능력 플래그 CLIENT_IGNORE_SPACE 를 기본으로 보내 세션에 IGNORE_SPACE 가 붙는다 — 운영 앱(mysql2 풀)의 기록기 세션도 같다.
    expect(r.m).toBe(`IGNORE_SPACE,${PROD_SQL_MODE}`);
    expect(Number(r.off)).toBe(9);
    expect(r.bf).toBe('ROW');
    expect(Number(r.lb)).toBe(1);
  });

  test('G1. (G11 R-4) 가드 음성 — 이름이 틀리면 질의 없이 던지고, 표지 표가 있는 스키마(t167guard)에서는 아무것도 지우지 않고 던진다(메시지에 접속값 없음)', async () => {
    const leak = (m: string) => [String(PORT), process.env.T167_DB_PASSWORD ?? '\u0000', '127.0.0.1'].some((v) => v !== '' && m.includes(v));
    let msg = '';
    try { await assertDisposableTarget(c, 'stockinvest'); } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/일회용 시험 DB 형식/);
    expect(leak(msg)).toBe(false);
    await c.query('CREATE DATABASE IF NOT EXISTS t167guard');
    await c.query('CREATE TABLE IF NOT EXISTS t167guard.orders (id INT PRIMARY KEY)');
    await c.query('CREATE TABLE IF NOT EXISTS t167guard.eval_funnel (id INT PRIMARY KEY)');
    const g = await mysql.createConnection({ host: '127.0.0.1', port: Number(PORT), user: 'root', password: process.env.T167_DB_PASSWORD, database: 't167guard' });
    try {
      msg = '';
      try { await assertDisposableTarget(g, 't167guard'); } catch (e) { msg = (e as Error).message; }
      expect(msg).toMatch(/운영 표 표지\(orders·signals·system_config\)가 있다/);
      expect(leak(msg)).toBe(false);
      msg = '';
      try { await assertDisposableTarget(g, 't167impl'); } catch (e) { msg = (e as Error).message; }   // 연결된 스키마와 지정 이름이 다르다
      expect(msg).toMatch(/연결된 스키마가 지정한 일회용 시험 DB 와 다르다/);
      const [left] = await g.query("SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = 't167guard' ORDER BY TABLE_NAME") as [Array<{ t: string }>, unknown];
      expect(left.map((x) => x.t)).toEqual(['eval_funnel', 'orders']);   // 가드가 던졌고 아무것도 지우지 않았다
      console.log(`[T167-evidence] G1 guard negative: name=rejected marker_schema=rejected tables_left=${left.map((x) => x.t).join(',')}`);
    } finally {
      await g.end();
    }
    await c.query('DROP DATABASE t167guard');   // 이 일회용 서버의 시험용 스키마만 정리(대상 서버는 beforeAll 가드를 통과했다)
  });

  test('A1. DDL 2회 적용 멱등 — 1차 경고 0, 2차 Note 1050, SHOW CREATE TABLE 동일', async () => {
    await c.query(DDL);
    const [w1] = await c.query('SHOW WARNINGS') as [unknown[], unknown];
    expect(w1).toHaveLength(0);
    const s1 = await one<{ 'Create Table': string }>('SHOW CREATE TABLE macro_regime_label_log');
    await c.query(DDL);
    const [w2] = await c.query('SHOW WARNINGS') as [Array<{ Level: string; Code: number }>, unknown];
    expect(w2.map((w) => [w.Level, w.Code])).toEqual([['Note', 1050]]);
    const s2 = await one<{ 'Create Table': string }>('SHOW CREATE TABLE macro_regime_label_log');
    expect(s2['Create Table']).toBe(s1['Create Table']);
    console.log(`[T167-evidence] A1 SHOW CREATE TABLE\n${s1['Create Table']}`);
  });

  test('A2. 열·키·CHECK·문자셋', async () => {
    const cols = await rows<{ COLUMN_NAME: string; COLUMN_TYPE: string; IS_NULLABLE: string; COLLATION_NAME: string | null }>(
      'SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
      ['macro_regime_label_log'],
    );
    expect(cols.map((x) => x.COLUMN_NAME).filter((n) => n !== 'id' && n !== 'inserted_at')).toEqual([...MACRO_REGIME_LABEL_LOG_COLUMNS]);
    const byName = new Map(cols.map((x) => [x.COLUMN_NAME, x]));
    expect(byName.get('source')!.COLUMN_TYPE).toBe("enum('live','backfill')");
    expect(byName.get('market')!.COLUMN_TYPE).toBe("enum('domestic','overseas')");
    expect(byName.get('record_json')!.COLLATION_NAME).toBe('utf8mb4_bin');
    expect(byName.get('run_id')!.COLLATION_NAME).toBe('utf8mb4_general_ci');
    expect(byName.get('cpi_index')!.COLUMN_TYPE).toBe('decimal(12,4)');
    expect(byName.get('cpi_yoy_pct')!.COLUMN_TYPE).toBe('decimal(6,1)');
    expect(byName.get('reason_count')!.COLUMN_TYPE).toBe('tinyint(3) unsigned');
    expect(byName.get('as_of_utc')!.IS_NULLABLE).toBe('NO');
    expect(byName.get('as_of_et_date')!.IS_NULLABLE).toBe('YES');
    const idx = await rows<{ INDEX_NAME: string; NON_UNIQUE: number; COLUMN_NAME: string }>(
      'SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX',
      ['macro_regime_label_log'],
    );
    const unique = [...new Set(idx.filter((x) => Number(x.NON_UNIQUE) === 0).map((x) => x.INDEX_NAME))].sort();
    expect(unique).toEqual(['PRIMARY', 'uq_mrl_run_asof', 'uq_mrl_source_ef']);
    expect(idx.filter((x) => x.INDEX_NAME === 'uq_mrl_run_asof').map((x) => x.COLUMN_NAME)).toEqual(['run_id', 'as_of_utc']);
    const checks = await rows<{ CONSTRAINT_NAME: string }>(
      'SELECT CONSTRAINT_NAME FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY CONSTRAINT_NAME',
      ['macro_regime_label_log'],
    );
    expect(checks.map((x) => x.CONSTRAINT_NAME)).toEqual(['chk_mrl_label', 'chk_mrl_rule_version', 'record_json']);
    const t = await one<{ TABLE_COLLATION: string; ENGINE: string }>('SELECT TABLE_COLLATION, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', ['macro_regime_label_log']);
    expect([t.ENGINE, t.TABLE_COLLATION]).toEqual(['InnoDB', 'utf8mb4_general_ci']);
  });

  test('A3. strict 거부(앱을 거치지 않은 값) — errno 로 판별, 표에는 아무것도 남지 않는다', async () => {
    const row = buildMacroRegimeLabelRow('domestic-209901010000', 'domestic', OK_RECORD, Date.now())!;
    const ins = (over: Partial<Record<keyof MacroRegimeLabelLogRow, unknown>>) => {
      const r = { ...row, ...over } as Record<string, unknown>;
      return c.query(`INSERT INTO macro_regime_label_log (${MACRO_REGIME_LABEL_LOG_COLUMNS.join(', ')}) VALUES (${MACRO_REGIME_LABEL_LOG_COLUMNS.map(() => '?').join(', ')})`,
        MACRO_REGIME_LABEL_LOG_COLUMNS.map((k) => r[k]));
    };
    const cases: Array<[string, Partial<Record<keyof MacroRegimeLabelLogRow, unknown>>, number]> = [
      ['label 빈 값(CHECK)', { label: '' }, 4025],
      ['rule_version 빈 값(CHECK)', { rule_version: '' }, 4025],
      ['record_json 형식 밖(CHECK)', { record_json: '{bad' }, 4025],
      ['reason_codes 201자', { reason_codes: 'x'.repeat(201) }, 1406],
      ['market ENUM 밖', { market: 'common' }, 1265],
      ['as_of_utc NULL', { as_of_utc: null }, 1048],
      ['cpi_yoy_pct 범위 밖', { cpi_yoy_pct: 123456.7 }, 1264],
    ];
    for (const [name, over, errno] of cases) {
      let got: number | undefined;
      try { await ins(over); } catch (e) { got = ERR(e); }
      expect([name, got]).toEqual([name, errno]);
    }
    expect(await logCount()).toBe(0);
  });

  test('C1. 실물 기록기 — 표 없음 → no_table(경고 1줄·DB 원문 없음) → DDL 다시 적용', async () => {
    await c.query('DROP TABLE macro_regime_label_log');
    const row = buildMacroRegimeLabelRow('domestic-202611121100', 'domestic', OK_RECORD, Date.now());
    await expect(recordMacroRegimeLabelRow(row, 'domestic')).resolves.toEqual({ status: 'no_table', reason: 'no_table errno=1146' });
    const warns = (console.warn as jest.Mock).mock.calls.map((x) => x.join(' '));
    expect(warns).toHaveLength(1);
    expect(warns[0]).not.toMatch(/doesn't exist|t167impl/);
    await c.query(DDL);
    expect(await logCount()).toBe(0);
    expect(busyConnections()).toBe(0);
  });

  test('B1. 이관 — 대상만·정확한 수, 2차 실행 0행(멱등)', async () => {
    for (const t of TARGETS) efIds.set(t.key, await insertEf(t.ef));
    for (const e of EXCLUDED) await insertEf(e);
    efIds.set('recent', await insertEf({ run_id: 'domestic-209912312359', ts: null, market: 'domestic', gate: 'run', verdict: 'pass', detail: runDetail({ ...clone(OK_RECORD), asOfUtc: '2026-11-14T01:00:00Z' }) }));
    expect(await runBackfill()).toBe(TARGETS.length);
    expect(await runBackfill()).toBe(0);
    const got = await rows<{ source_eval_funnel_id: number; source: string }>('SELECT source_eval_funnel_id, source FROM macro_regime_label_log ORDER BY id');
    expect(got.map((g) => Number(g.source_eval_funnel_id))).toEqual(TARGETS.map((t) => efIds.get(t.key)));
    expect(new Set(got.map((g) => g.source))).toEqual(new Set(['backfill']));
  });

  test('B2. 변환값 = 실시간 기록기의 행 빌더 결과(열 하나하나) · record_json 바이트 동일 · NULL 날짜는 0000-00-00 이 아니다', async () => {
    for (const t of TARGETS) {
      const db = await one<Record<string, unknown>>('SELECT * FROM macro_regime_label_log WHERE source_eval_funnel_id = ?', [efIds.get(t.key)]);
      const live = buildMacroRegimeLabelRow(t.ef.run_id, t.ef.market, t.record, t.fallbackMs ?? Date.now())!;
      expect(live).not.toBeNull();
      for (const col of MACRO_REGIME_LABEL_LOG_COLUMNS) {
        if (SOURCE_COLS.has(col)) continue;
        const v = db[col];
        const actual = DECIMAL_COLS.has(col) && v !== null ? Number(v) : v;
        expect([t.key, col, actual]).toEqual([t.key, col, live[col]]);
      }
      // 이관 행만의 열
      expect([db.source, Number(db.source_eval_funnel_id), db.source_ts_kst, db.engine_release]).toEqual(['backfill', efIds.get(t.key), t.ef.ts, null]);
      // record_json — 앱 JSON.stringify 원문과 바이트 같음(unknown·internal_error 포함)
      expect(db.record_json).toBe(JSON.stringify(t.record));
      for (const v of Object.values(db)) expect(String(v)).not.toMatch(/^0000-00-00/);
    }
    const empty = await one<{ as_of_utc: string; as_of_kst: string; as_of_et_date: string | null }>(
      'SELECT as_of_utc, as_of_kst, as_of_et_date FROM macro_regime_label_log WHERE source_eval_funnel_id = ?', [efIds.get('empty_asof')]);
    expect(empty).toEqual({ as_of_utc: '2026-11-11 23:12:07', as_of_kst: '2026-11-12 08:12:07', as_of_et_date: null });   // ts − 9h 폴백
    const multi = await one<{ reason_codes: string; reason_first: string; reason_count: number; rate_table_verified_through: string | null; cpi_cache_age_sec: number }>(
      'SELECT reason_codes, reason_first, reason_count, rate_table_verified_through, cpi_cache_age_sec FROM macro_regime_label_log WHERE source_eval_funnel_id = ?', [efIds.get('multi')]);
    expect(multi).toEqual({ reason_codes: 'cpi_cache_stale,rate_table_stale', reason_first: 'cpi_cache_stale', reason_count: 2, rate_table_verified_through: null, cpi_cache_age_sec: 711_600 });
    const ok = await one<{ reason_codes: string; reason_first: string | null; is_type5: number; cpi_lags_schedule: number }>(
      'SELECT reason_codes, reason_first, is_type5, cpi_lags_schedule FROM macro_regime_label_log WHERE source_eval_funnel_id = ?', [efIds.get('ok')]);
    expect(ok).toEqual({ reason_codes: '', reason_first: null, is_type5: 0, cpi_lags_schedule: 1 });
    const t5 = await one<{ is_type5: number; cpi_hot: number; cpi_lags_schedule: number; cpi_cache_age_sec: number }>(
      'SELECT is_type5, cpi_hot, cpi_lags_schedule, cpi_cache_age_sec FROM macro_regime_label_log WHERE source_eval_funnel_id = ?', [efIds.get('type5')]);
    expect(t5).toEqual({ is_type5: 1, cpi_hot: 1, cpi_lags_schedule: 0, cpi_cache_age_sec: -3 });
  });

  test('B3. 파일 주석의 확인·대조 쿼리를 그대로 실행 — ① 수 일치 · ② SHA 불일치 0 · ⓐ 미대응 0 · ⓑ 충돌 0 · ⓒ 일별 일치', async () => {
    expect(await runCheck('1')).toEqual([{ ef_targets: TARGETS.length, backfill_rows_with_source: TARGETS.length, live_rows_same_runs: 0 }]);
    expect(await runCheck('2')).toEqual([{ backfill_sha_mismatch: 0, live_sha_mismatch: 0 }]);
    expect(await runCheck('a')).toEqual([{ unmatched_ef_rows: 0 }]);
    expect(await runCheck('b')).toEqual([{ collided_keys: 0 }]);
    const daily = await runCheck('c') as Array<{ et_date: string | null; market: string; ef_rows: number; log_rows: number }>;
    expect(daily).toEqual([
      { et_date: null, market: 'domestic', ef_rows: 1, log_rows: 1 },
      { et_date: '2026-11-11', market: 'domestic', ef_rows: 2, log_rows: 2 },
      { et_date: '2026-11-11', market: 'overseas', ef_rows: 2, log_rows: 2 },
    ]);
  });

  test('B4. (G9-3) 막 끝난 런(ts > NOW() − 2분)은 이관이 집지 않는다 → 2분이 지난 뒤(시험에서는 ts 를 3분 전으로 옮김) 재실행이 잡는다', async () => {
    expect(await logCount('source_eval_funnel_id = ?', [efIds.get('recent')])).toBe(0);
    await c.query('UPDATE eval_funnel SET ts = NOW() - INTERVAL 3 MINUTE WHERE id = ?', [efIds.get('recent')]);   // 일회용 DB 의 합성 행만
    expect(await runBackfill()).toBe(1);
    expect(await logCount('source_eval_funnel_id = ?', [efIds.get('recent')])).toBe(1);
    expect(await runBackfill()).toBe(0);
  });

  test('C2. 실물 기록기 — 정상 written · 이관된 런을 실시간으로 다시 쓰면 duplicate(행 1개 유지, 경고 0) · 엔진 진입점도 같은 결과', async () => {
    const fresh = { ...clone(OK_RECORD), asOfUtc: '2026-11-14T02:00:00Z', asOfEtDate: '2026-11-13' };
    await expect(recordMacroRegimeLabelRow(buildMacroRegimeLabelRow('domestic-202611141058', 'domestic', fresh, Date.now(), 'rel-t167'), 'domestic'))
      .resolves.toEqual({ status: 'written' });
    const w = await one<{ source: string; engine_release: string; record_json: string; as_of_kst: string }>(
      'SELECT source, engine_release, record_json, as_of_kst FROM macro_regime_label_log WHERE run_id = ?', ['domestic-202611141058']);
    expect(w).toEqual({ source: 'live', engine_release: 'rel-t167', record_json: JSON.stringify(fresh), as_of_kst: '2026-11-14 11:00:00' });

    const before = await logCount();
    await expect(recordMacroRegimeLabelRow(buildMacroRegimeLabelRow(TARGETS[0].ef.run_id, 'domestic', OK_RECORD, Date.now()), 'domestic'))
      .resolves.toEqual({ status: 'duplicate', reason: 'duplicate errno=1062' });
    recordMacroRegimeLabel(TARGETS[1].ef.run_id, 'overseas', UNKNOWN_RECORD);
    expect(await waitForMacroRegimeLabelLogForTest()).toEqual([{ status: 'duplicate', reason: 'duplicate errno=1062' }]);
    expect(await logCount()).toBe(before);
    expect(await logCount('run_id = ?', [TARGETS[0].ef.run_id])).toBe(1);
    expect((console.warn as jest.Mock).mock.calls).toHaveLength(0);
    expect(busyConnections()).toBe(0);
  });

  test('C3. 실시간 먼저 → 같은 런의 eval_funnel 행을 이관해도 건너뛴다(NOT EXISTS) — 그 런은 live 1행, 대조 쿼리도 일치', async () => {
    const rec = { ...clone(OK_RECORD), asOfUtc: '2026-11-14T03:00:00Z', asOfEtDate: '2026-11-13' };
    const runId = 'domestic-202611141159';
    recordMacroRegimeLabel(runId, 'domestic', rec);
    expect(await waitForMacroRegimeLabelLogForTest()).toEqual([{ status: 'written' }]);
    await insertEf({ run_id: runId, ts: '2026-11-12 06:00:01', market: 'domestic', gate: 'run', verdict: 'pass', detail: runDetail(rec) });
    expect(await runBackfill()).toBe(0);
    expect(await rows('SELECT source FROM macro_regime_label_log WHERE run_id = ?', [runId])).toEqual([{ source: 'live' }]);
    const c1 = (await runCheck('1'))[0] as { ef_targets: number; backfill_rows_with_source: number; live_rows_same_runs: number };
    expect(c1.ef_targets).toBe(c1.backfill_rows_with_source + c1.live_rows_same_runs);
    expect(c1.live_rows_same_runs).toBe(1);
    expect(await runCheck('2')).toEqual([{ backfill_sha_mismatch: 0, live_sha_mismatch: 0 }]);
    expect(await runCheck('a')).toEqual([{ unmatched_ef_rows: 0 }]);
  });

  test('C4. 🔴 (G9-3) 실시간 기록과 경합한 이관 → 1062 로 문장 전체 0행(다른 대상도 안 들어감) → 재실행이 정상 완료', async () => {
    const racer = { ...clone(OK_RECORD), asOfUtc: '2026-11-14T04:00:00Z', asOfEtDate: '2026-11-13' };
    const other = { ...clone(OK_RECORD), asOfUtc: '2026-11-14T04:05:00Z', asOfEtDate: '2026-11-13' };
    const racerRun = 'domestic-202611141259';
    const otherRun = 'domestic-202611141304';
    await insertEf({ run_id: racerRun, ts: '2026-11-12 06:10:01', market: 'domestic', gate: 'run', verdict: 'pass', detail: runDetail(racer) });
    await insertEf({ run_id: otherRun, ts: '2026-11-12 06:15:01', market: 'domestic', gate: 'run', verdict: 'pass', detail: runDetail(other) });
    const before = await logCount();
    // 실시간 기록 연결 — 같은 런의 행을 넣고 **아직 커밋하지 않는다**(READ COMMITTED 의 NOT EXISTS 는 이 행을 못 본다)
    const live = await conn();
    const backfiller = await conn();
    try {
      await live.query('START TRANSACTION');
      const row = buildMacroRegimeLabelRow(racerRun, 'domestic', racer, Date.now())!;
      await live.query(`INSERT INTO macro_regime_label_log (${MACRO_REGIME_LABEL_LOG_COLUMNS.join(', ')}) VALUES (${MACRO_REGIME_LABEL_LOG_COLUMNS.map(() => '?').join(', ')})`,
        MACRO_REGIME_LABEL_LOG_COLUMNS.map((k) => row[k]));
      let settled = false;
      const p = runBackfill(backfiller).then(
        (n) => { settled = true; return { ok: true as const, n }; },
        (e: unknown) => { settled = true; return { ok: false as const, errno: ERR(e) }; },
      );
      await sleep(700);
      expect(settled).toBe(false);   // 유일 키 잠금을 기다리는 중
      await live.query('COMMIT');
      const r = await p;
      console.log(`[T167-evidence] C4 backfill during uncommitted live insert -> ${JSON.stringify(r)}`);
      expect(r).toEqual({ ok: false, errno: 1062 });
      expect(await logCount()).toBe(before + 1);   // 실시간 1행만 — 이관 문장은 다른 대상(otherRun)까지 0행
      expect(await logCount('run_id = ?', [otherRun])).toBe(0);
      expect(await runBackfill(backfiller)).toBe(1);   // 재실행 — otherRun 만 들어가고 racerRun 은 건너뛴다
      expect(await rows('SELECT run_id, source FROM macro_regime_label_log WHERE run_id IN (?, ?) ORDER BY run_id', [racerRun, otherRun]))
        .toEqual([{ run_id: racerRun, source: 'live' }, { run_id: otherRun, source: 'backfill' }]);
    } finally {
      await live.end();
      await backfiller.end();
    }
  });

  test(`C5. 표가 잠긴 채 기록 → ${MACRO_REGIME_LABEL_LOG_TIMEOUT_MS}ms 에 timeout, 풀 연결 반환(바쁜 연결 0), 무관한 질의 통과`, async () => {
    const locker = await conn();
    try {
      const before = await logCount();   // 잠그기 전에 센다(WRITE 잠금 중에는 읽기도 막힌다)
      await locker.query('LOCK TABLES macro_regime_label_log WRITE');
      const t0 = Date.now();
      const r = await recordMacroRegimeLabelRow(
        buildMacroRegimeLabelRow('domestic-202611141400', 'domestic', { ...clone(OK_RECORD), asOfUtc: '2026-11-14T05:00:00Z' }, Date.now()), 'domestic');
      const ms = Date.now() - t0;
      expect(r).toEqual({ status: 'timeout', reason: 'timeout' });
      expect(ms).toBeGreaterThanOrEqual(MACRO_REGIME_LABEL_LOG_TIMEOUT_MS - 50);
      expect(ms).toBeLessThan(MACRO_REGIME_LABEL_LOG_TIMEOUT_MS + 1500);
      expect(busyConnections()).toBe(0);
      const [ping] = await pool.query('SELECT 1 AS ok') as [Array<{ ok: number }>, unknown];
      expect(ping[0].ok).toBe(1);
      await locker.query('UNLOCK TABLES');
      await sleep(500);
      const late = (await logCount()) - before;
      console.log(`[T167-evidence] C5 timeout_ms=${ms} busy_after=${busyConnections()} late_rows_after_unlock=${late}`);
      expect(late).toBeGreaterThanOrEqual(0);   // 관찰값(destroy 된 연결의 서버 쪽 대기 문장이 잠금 해제 뒤 실행되는지는 서버 동작)
    } finally {
      await locker.end();
    }
  }, 15_000);

  test('B5. (G10 R-1) 원본 중복 1쌍 — 고치기 전 모양은 1062 로 0행, 이관 파일은 가장 작은 id 하나만 옮기고 성공 · 2차 0행 · ⓑ = 1', async () => {
    // ①·ⓒ 의 「충돌 0」 단정을 쓰는 시험(B3·C3) 뒤에 둔다 — 이 뒤로 ⓑ 는 1 이다.
    const runId = 'domestic-202611120700';
    const first = { ...clone(OK_RECORD), asOfUtc: '2026-11-11T22:01:30Z', asOfEtDate: '2026-11-11', cpi: { ...clone(OK_RECORD).cpi, cacheAgeSec: 10 } };
    const second = { ...clone(OK_RECORD), asOfUtc: '2026-11-11T22:01:30Z', asOfEtDate: '2026-11-11', cpi: { ...clone(OK_RECORD).cpi, cacheAgeSec: 11 } };
    const idFirst = await insertEf({ run_id: runId, ts: '2026-11-12 07:01:30', market: 'domestic', gate: 'run', verdict: 'pass', detail: runDetail(first) });
    const idSecond = await insertEf({ run_id: runId, ts: '2026-11-12 07:01:31', market: 'domestic', gate: 'run', verdict: 'pass', detail: runDetail(second) });
    expect(idSecond).toBeGreaterThan(idFirst);
    expect(await runCheck('b')).toEqual([{ collided_keys: 1 }]);   // 이관 전에도 원본 쪽 충돌 수를 보여 준다
    const before = await logCount();

    // 재현(Reviewer R-1): 원본 중복 제거가 없는 1차 문장 모양 → 1062, 문장 전체 0행(재실행해도 같다)
    const st = statements(BACKFILL);
    const unguarded = st[3].replace(/WHERE x\.rn = 1\s+AND NOT EXISTS/, 'WHERE NOT EXISTS');
    expect(unguarded).not.toBe(st[3]);
    const old = await conn();
    try {
      for (const s0 of st.slice(0, 3)) await old.query(s0);
      for (let i = 0; i < 2; i++) {
        let errno: number | undefined;
        try { await old.query(unguarded); } catch (e) { errno = ERR(e); }
        expect(errno).toBe(1062);
        expect(await logCount()).toBe(before);
      }
    } finally {
      await old.end();
    }

    // 수정된 이관 파일 그대로 — 가장 작은 id 하나만 옮기고 성공, 2차 0행
    expect(await runBackfill()).toBe(1);
    expect(await rows('SELECT source, source_eval_funnel_id, record_json FROM macro_regime_label_log WHERE run_id = ?', [runId]))
      .toEqual([{ source: 'backfill', source_eval_funnel_id: idFirst, record_json: JSON.stringify(first) }]);
    expect(await runBackfill()).toBe(0);
    expect(await logCount()).toBe(before + 1);
    // 대조: ⓑ 가 버린 중복을 숫자로 드러내고, ⓐ 는 미대응 0(둘째 행도 같은 키로 대응된다), ② 이관 쪽 바이트 불일치 0
    expect(await runCheck('b')).toEqual([{ collided_keys: 1 }]);
    expect(await runCheck('a')).toEqual([{ unmatched_ef_rows: 0 }]);
    expect(((await runCheck('2'))[0] as { backfill_sha_mismatch: number }).backfill_sha_mismatch).toBe(0);
    console.log(`[T167-evidence] B5 dup pair ids=${idFirst},${idSecond} unguarded=1062x2 guarded_first=1 second=0 check_b=1`);
  });

  test('D. 이관이 READ COMMITTED 로 원본을 잠그지 않는다 — 열린 이관 트랜잭션 중 엔진의 eval_funnel INSERT 가 즉시 통과(관찰값, RR 대조)', async () => {
    const st = statements(BACKFILL);
    const observe = async (iso: 'RC' | 'RR') => {
      const tx = await conn();
      const engine = await conn();
      try {
        await insertEf({ run_id: `domestic-20261114150${iso === 'RC' ? 1 : 2}`, ts: `2026-11-12 06:2${iso === 'RC' ? 0 : 5}:01`, market: 'domestic', gate: 'run', verdict: 'pass',
          detail: runDetail({ ...clone(OK_RECORD), asOfUtc: `2026-11-14T06:0${iso === 'RC' ? 1 : 2}:00Z` }) });
        for (const s of st.slice(0, 3)) await tx.query(s);   // 파일의 세션 설정 그대로(RC·잠금 대기 5초)
        if (iso === 'RR') await tx.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        await tx.query('START TRANSACTION');
        const [res] = await tx.query(st[3]) as [mysql.ResultSetHeader, unknown];
        await engine.query('SET SESSION innodb_lock_wait_timeout = 2');
        const t0 = Date.now();
        let outcome: string;
        try {
          await engine.query("INSERT INTO eval_funnel (run_id, market, stage, gate, verdict, detail) VALUES ('domestic-209912312358', 'domestic', 0, 'run', 'pass', '{}')");
          outcome = 'inserted';
        } catch (e) {
          outcome = `errno=${ERR(e)}`;
        }
        const ms = Date.now() - t0;
        await tx.query('ROLLBACK');
        return { iso, backfillRowsInOpenTx: res.affectedRows, engineInsert: outcome, ms };
      } finally {
        await tx.end();
        await engine.end();
      }
    };
    const rc = await observe('RC');
    const rr = await observe('RR');
    console.log(`[T167-evidence] D ${JSON.stringify(rc)} ${JSON.stringify(rr)}`);
    expect(rc.backfillRowsInOpenTx).toBeGreaterThanOrEqual(1);   // 빈 비교 금지 — 이관 트랜잭션이 실제로 행을 넣고 열려 있었다
    expect(rc.engineInsert).toBe('inserted');
    expect(rc.ms).toBeLessThan(1000);
    expect(rr.backfillRowsInOpenTx).toBeGreaterThanOrEqual(1);
  }, 20_000);
});

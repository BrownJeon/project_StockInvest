/**
 * T-143 WP-A — **일회용 MariaDB 실증 시험** (평소 jest 실행에서는 정적 검사만 돌고 DB 부분은 건너뛴다 —
 * `T143_WPA_DB_PORT` 가 있을 때만 DB 를 쓴다. 선례: `job-run-log-disposable-mariadb.test.ts`).
 *
 * 🔴 **왜 이 파일이 필요한가(Reviewer r3 ②).** 엔진 시험은 메모리 모형 저장소(`fake-refresh-store.ts`)를 써서
 * **저장소의 SQL 을 통과하지 않는다.** Reviewer 가 변이 3개를 넣었는데 시험 33개가 **전부 통과**했다 —
 *   S1 `readFinalizeRows` 가 `kis_enam` 을 `sec_name` 열에서 매핑 · S2 `saveListing` 이 `kisEnam` 파라미터를 버림
 *   E2 ready 분기가 `kisEnam` 을 안 담음
 * 즉 r2 에서 고친 **그 배선(마스터 `enam` → DB → finalize)이 보호되지 않았다.** 모형이 아니라 실제
 * `INSERT`·`SELECT` 를 왕복해 **열 하나하나의 자리**를 고정한다. S3(`prevRunKey` 연말 경계)도 같은 로그에서
 * 틀린 변이가 통과했고, **이 기능이 처음 맞는 1월 첫째 일요일**이 시험에 없었다 — 아래 A·D 가 그 자리다.
 *
 * 무엇을 확인하나:
 *  A. (DB 없이) `prevRunKey` 순수 함수 — 연말 경계 `2027-01` → `2026-12`, 12개월 왕복, 형식 아닌 값은 그대로
 *  B. (DB) `saveListing` → `readFinalizeRows` **끝에서 끝** — `kisEnam` 이 **제 열에** 저장되고 그대로 돌아온다.
 *     `secName` 과 **값을 서로 바꿔 넣어** 두 열이 뒤바뀌면 반드시 깨지게 한다(S1 감도)
 *  C. (DB) `kisEnam` 이 null·빈값·200자 초과·멀티바이트일 때 — clamp 가 돌고 STRICT 에서 거부되지 않는다
 *  D. (DB) `readPrevMonthRunPhase` — 1월이 **직전 해 12월**을 읽는다(연말 경계) · 행 없으면 null ·
 *     미완료 단계(`scan`)와 `complete` 를 구분한다
 *  E. (DB) 변이 감도 자가 점검 — 이 시험이 S1·S2 를 **실제로 잡는지** 같은 SQL 을 손으로 변형해 확인한다
 *  G. (DB) 🔴 **(Reviewer M-3) `readRunKisStatus` 의 SQL 의미** — ⑧-2(스캔 결과를 스냅샷 대리값보다 우선)의
 *     저장소 쪽 절반인데 **어떤 시험에도 없었다**: 반환값을 항상 `true` 로 바꾸거나 `fetched_at IS NOT NULL` 조건을
 *     빼도 DB 를 켠 상태의 92개가 전부 통과했다. 회귀하면 멀쩡한 종목에 「KIS 조회 불가 — 빼기」 제안이 뜨고
 *     그 지문이 `INSERT IGNORE` 로 **영구 소비**된다.
 *  F. (DB) 🔴 **T-145 ⑥ — 단일 행의 흠이 그 달을 버리게 하지 않는다.** Reviewer 가 STRICT 실 DB 로 재현한 셋을
 *     같은 DB 에서 **고쳐졌음**으로 고정한다: `cap_ratio` 범위 초과 · CHAR 열 초과 · 같은 심볼 두 행 ·
 *     스캔 원값 범위 초과. 각 항목에 **감도 짝**(가드를 거치지 않은 생 SQL 은 STRICT 가 거부한다)을 붙여,
 *     「원래도 통과하는 시험」이 아님을 같은 파일에서 보인다.
 *
 * 실행(운영·공용 DB 금지 — 127.0.0.1 에만 묶인 일회용 컨테이너, 끝나면 제거. 비밀번호는 환경변수로만):
 *   T143_WPA_DB_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -dc A-Za-z0-9 | head -c 24)"; export T143_WPA_DB_PASSWORD
 *   docker run -d --rm --name t143wpa-store -p 127.0.0.1:33146:3306 -e MARIADB_ROOT_PASSWORD="$T143_WPA_DB_PASSWORD" \
 *     -e MARIADB_DATABASE=t143wpa mariadb:10.11.11 \
 *     --sql-mode=STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION \
 *     --character-set-server=utf8mb3 --collation-server=utf8mb3_general_ci
 *   T143_WPA_DB_PORT=33146 npx jest src/lib/universe/__tests__/refresh-store-disposable-mariadb.test.ts
 *   docker rm -fv t143wpa-store
 * 값은 전부 합성값이다(실제 시총·종목명이 아니다).
 */
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';

jest.mock('@/lib/db', () => ({
  getPool: () => { throw new Error('운영 풀 사용 금지(시험) — db 를 인자로 넘겨라'); },
}));

import {
  prevRunKey, readPrevMonthRunPhase, createRun, saveListing, applyScanOutcome, advanceRun,
  finalizeRun, readFinalizeRows, readRunKisStatus, type CandidateInsert, type CandidateVerdict,
} from '../refresh-store';

const PORT = process.env.T143_WPA_DB_PORT;
const PASSWORD = process.env.T143_WPA_DB_PASSWORD;
const DB_ON = Boolean(PORT && PASSWORD);
const dbIt = DB_ON ? it : it.skip;

const DDL = path.join(process.cwd(), 'scripts/migrations/T-143-wpa-universe-run.sql');
/**
 * `finalizeRun` 은 WP-B 소유 표(`overseas_universe_auto`)를 한 트랜잭션에서 통째로 교체하므로, F군을 돌리려면
 * 그 DDL 도 함께 올려야 한다(없으면 1146 으로 `not_migrated` 가 되어 **아무것도 검증하지 못한다**).
 */
const DDL_WPB = path.join(process.cwd(), 'scripts/migrations/T-143-overseas-universe.sql');

// ── A. 순수 함수 — DB 없이도 늘 돈다(연말 경계. Reviewer r3 S3 가 통과해 버린 자리)
describe('prevRunKey — 직전 달 키', () => {
  it('🔴 연말 경계: 1월은 **직전 해 12월**을 가리킨다(이 기능이 처음 맞는 1월 첫째 일요일)', () => {
    expect(prevRunKey('2027-01')).toBe('2026-12');
    expect(prevRunKey('2026-01')).toBe('2025-12');
    // 흔한 오구현 세 가지가 전부 걸린다: 해를 안 줄임 · 월을 0 으로 · 월을 13 으로
    expect(prevRunKey('2027-01')).not.toBe('2027-12');
    expect(prevRunKey('2027-01')).not.toBe('2027-00');
    expect(prevRunKey('2027-01')).not.toBe('2026-13');
  });

  it('1월이 아닌 달은 같은 해의 한 달 앞 — 두 자리로 0 을 채운다', () => {
    expect(prevRunKey('2026-12')).toBe('2026-11');
    expect(prevRunKey('2026-11')).toBe('2026-10');
    expect(prevRunKey('2026-10')).toBe('2026-09');   // 두 자리 → 한 자리 경계
    expect(prevRunKey('2026-03')).toBe('2026-02');
    expect(prevRunKey('2026-02')).toBe('2026-01');
  });

  it('12개월을 거꾸로 돌면 정확히 한 해 전으로 돌아온다(누적 오차 0)', () => {
    let k = '2027-06';
    for (let i = 0; i < 12; i += 1) k = prevRunKey(k);
    expect(k).toBe('2026-06');
  });

  it('형식이 아니면 그대로 돌려준다 — 질의가 0행이 되게(가짜 키를 만들지 않는다)', () => {
    for (const bad of ['', '2026', '2026-1', '202612', 'x-01', '2026-13x']) {
      expect(prevRunKey(bad)).toBe(bad);
    }
  });
});

// ── B~E. 실제 DB
describe('refresh-store 실 DB 왕복', () => {
  let pool: mysql.Pool | null = null;
  let runSeq = 0;

  beforeAll(async () => {
    if (!DB_ON) return;
    pool = mysql.createPool({
      host: '127.0.0.1', port: Number(PORT), user: 'root', password: PASSWORD,
      database: 't143wpa', connectionLimit: 4, waitForConnections: true, queueLimit: 0, multipleStatements: false,
    });
    // DDL 을 파일에서 그대로 적용한다(문서가 아니라 실제 적용될 파일을 쓴다).
    // 문장 쪼개기는 선례와 같은 방식 — 줄마다 `--` 뒤를 떼고 `;` 로 나눈다(`job-run-log-disposable-mariadb.test.ts`).
    const apply = async (file: string, expected: number) => {
      const sql = fs.readFileSync(file, 'utf8');
      const stmts = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')
        .split(';').map((x) => x.trim()).filter(Boolean);
      expect(stmts.length).toBe(expected);   // 늘면 이 시험이 먼저 알려 준다
      for (const stmt of stmts) await (pool as mysql.Pool).query(stmt);
    };
    await apply(DDL, 3);          // SET SESSION 1 + CREATE TABLE 2 (run·candidate)
    await apply(DDL_WPB, 5);      // SET SESSION 1 + CREATE TABLE 4 (revision·proposal·auto·watch)
  }, 60_000);

  afterAll(async () => { if (pool) await pool.end(); });

  const q = () => pool as unknown as Parameters<typeof readFinalizeRows>[0]['db'];

  /**
   * 매 시험마다 다른 run_key — 한 컨테이너 안에서 서로 간섭하지 않게.
   * 연도를 **2095** 로 둬서 아래 연말 경계 시험이 쓰는 고정 키(2097·2098·2099)와 절대 겹치지 않게 한다.
   */
  const nextKey = () => { runSeq += 1; return `2095-${String(runSeq).padStart(2, '0')}`; };

  const cand = (over: Partial<CandidateInsert> = {}): CandidateInsert => ({
    ord: 0, symbol: 'NYS:ZZTEST', secTicker: 'ZZTEST', cik: 9999001,
    secName: 'Zz Test Holdings Ltd', kisSymb: 'ZZTEST', kisEnam: 'ZZ TEST HOLDINGS LTD SPON ADS',
    kisStis: '2', kisIsdr: 'N', kisEtyp: null, status: 'pending', exclusion: null, ...over,
  });

  async function seedOk(candidates: readonly CandidateInsert[]): Promise<number> {
    const key = nextKey();
    const run = await createRun({ runKey: key, topN: 50, nowMs: Date.UTC(2099, 0, 4, 16, 10), db: q() });
    if (run.kind !== 'ok') throw new Error(`createRun: ${JSON.stringify(run)}`);
    const saved = await saveListing({
      runId: run.data.runId, candidates,
      sec: { fetchedAtMs: Date.UTC(2099, 0, 4, 16, 10), sha256: 'a'.repeat(64), rows: candidates.length },
      master: { fetchedAtMs: Date.UTC(2099, 0, 4, 16, 10), sha256: 'b'.repeat(64), rows: candidates.length },
      countsJson: JSON.stringify({ scan_target: candidates.length }),
      nowMs: Date.UTC(2099, 0, 4, 16, 10),
      getConnection: async () => (await (pool as mysql.Pool).getConnection()) as never,
    });
    if (saved.kind !== 'ok') throw new Error(`saveListing: ${JSON.stringify(saved)}`);
    for (const c of candidates) {
      if (c.status !== 'pending') continue;
      await applyScanOutcome({
        runId: run.data.runId, nowMs: Date.UTC(2099, 0, 4, 16, 20), db: q(),
        outcome: { ord: c.ord, status: 'ok', tomv: 1_000_000, shar: 1_000, last: 100, curr: 'USD', etypNm: null, rsym: `NYS${c.secTicker}` },
      });
    }
    await advanceRun({ runId: run.data.runId, phase: 'finalize', nowMs: Date.UTC(2099, 0, 4, 16, 30), db: q() });
    return run.data.runId;
  }

  // B. 끝에서 끝 — 열 자리 고정(S1·S2 감도)
  dbIt('🔴 B1 `kisEnam` 이 **제 열로** 저장되고 그대로 돌아온다 — `sec_name` 과 뒤바뀌면 깨진다', async () => {
    // 두 값을 **서로 아주 다르게** 둔다. 열이 뒤바뀌거나 한쪽을 버리면 단언이 반드시 깨진다.
    const runId = await seedOk([cand({
      ord: 0, symbol: 'NYS:ZZA', secTicker: 'ZZA', cik: 9999101,
      secName: 'Sec Side Name Only', kisEnam: 'MASTER SIDE NAME SPON ADS ONLY',
    })]);
    const rows = await readFinalizeRows({ runId, db: q() });
    expect(rows.kind).toBe('ok');
    if (rows.kind !== 'ok') return;
    expect(rows.data).toHaveLength(1);
    expect(rows.data[0].kisEnam).toBe('MASTER SIDE NAME SPON ADS ONLY');
    expect(rows.data[0].secName).toBe('Sec Side Name Only');
    // 뒤바뀜을 직접 배제한다 — 「둘 다 채워져 있다」만 보면 S1 변이가 통과한다
    expect(rows.data[0].kisEnam).not.toBe(rows.data[0].secName);
    expect(rows.data[0].kisEnam).not.toContain('Sec Side');
    expect(rows.data[0].secName).not.toContain('MASTER SIDE');
  }, 30_000);

  dbIt('🔴 B2 DB 에 실제로 들어간 열이 `kis_enam` 이다(앱 코드를 거치지 않고 생 질의로 재확인)', async () => {
    const runId = await seedOk([cand({ ord: 0, symbol: 'NYS:ZZB', secTicker: 'ZZB', cik: 9999102, secName: 'Bee Sec', kisEnam: 'BEE MASTER ADR' })]);
    const [raw] = await (pool as mysql.Pool).query<mysql.RowDataPacket[]>(
      'SELECT sec_name, kis_enam FROM overseas_universe_candidate WHERE run_id = ? AND ord = 0', [runId],
    );
    expect(raw[0].kis_enam).toBe('BEE MASTER ADR');
    expect(raw[0].sec_name).toBe('Bee Sec');
  }, 30_000);

  dbIt('B3 여러 행이 섞여도 행마다 자기 `kisEnam` 을 돌려준다(ord 로 묶이는지 — 한 행의 값이 다른 행에 새지 않는다)', async () => {
    const runId = await seedOk([
      cand({ ord: 0, symbol: 'NYS:ZZC0', secTicker: 'ZZC0', cik: 9999201, secName: 'C Zero Sec', kisEnam: 'C ZERO MASTER' }),
      cand({ ord: 1, symbol: 'NYS:ZZC1', secTicker: 'ZZC1', cik: 9999202, secName: 'C One Sec', kisEnam: 'C ONE MASTER SPON ADS' }),
      cand({ ord: 2, symbol: 'NYS:ZZC2', secTicker: 'ZZC2', cik: 9999203, secName: 'C Two Sec', kisEnam: null }),
    ]);
    const rows = await readFinalizeRows({ runId, db: q() });
    if (rows.kind !== 'ok') throw new Error('readFinalizeRows 실패');
    expect(rows.data.map((r) => [r.ord, r.kisEnam])).toEqual([
      [0, 'C ZERO MASTER'], [1, 'C ONE MASTER SPON ADS'], [2, null],
    ]);
  }, 30_000);

  // C. 값의 변두리 — STRICT 에서 거부되지 않아야 한다(한 행의 흠이 그 달을 닫는 M-3 와 같은 자리)
  dbIt('C1 `kisEnam` null·빈문자·200자 초과·멀티바이트가 STRICT 에서 거부되지 않는다(clamp 가 돈다)', async () => {
    const long = 'Q'.repeat(260);
    const runId = await seedOk([
      cand({ ord: 0, symbol: 'NYS:ZZD0', secTicker: 'ZZD0', cik: 9999301, kisEnam: null }),
      cand({ ord: 1, symbol: 'NYS:ZZD1', secTicker: 'ZZD1', cik: 9999302, kisEnam: '' }),
      cand({ ord: 2, symbol: 'NYS:ZZD2', secTicker: 'ZZD2', cik: 9999303, kisEnam: long }),
      cand({ ord: 3, symbol: 'NYS:ZZD3', secTicker: 'ZZD3', cik: 9999304, kisEnam: 'SOCIÉTÉ GÉNÉRALE SPON ADR' }),
    ]);
    const rows = await readFinalizeRows({ runId, db: q() });
    if (rows.kind !== 'ok') throw new Error('readFinalizeRows 실패');
    const by = new Map(rows.data.map((r) => [r.ord, r.kisEnam]));
    expect(by.get(0)).toBeNull();
    // ⚠ 처음 틀린 기대는 내 것이었다 — 빈 문자열은 **읽을 때 null 이 된다**(`strOf` 가 trim 후 빈값을 null 로 바꾼다).
    //   이 동작이 맞다: 마스터 이름이 빈값이면 「이름 없음」이고, 엔진의 「이름이 없으면 의심으로 집계하지 않는다」가
    //   바로 이 null 에 의존한다. 빈 문자열을 그대로 두면 그 판단이 「이름이 있다」로 바뀐다.
    expect(by.get(1)).toBeNull();
    expect((by.get(2) ?? '').length).toBe(200);        // 260 → 200 으로 잘려 들어갔다(1406 거부 아님)
    expect(by.get(3)).toBe('SOCIÉTÉ GÉNÉRALE SPON ADR');
  }, 30_000);

  // D. 직전 달 조회 — 연말 경계를 **실 질의로**
  dbIt('🔴 D1 1월 창이 **직전 해 12월** run 을 읽는다 — 같은 해 12월을 집으면 깨진다(연말 경계, 실 질의)', async () => {
    // 두 개의 12월을 **다른 단계로** 심는다. 해를 줄이지 않는 오구현은 'complete' 를 집어 미완료를 놓친다.
    const prevYearDec = await createRun({ runKey: '2098-12', topN: 50, nowMs: Date.UTC(2098, 11, 7, 16, 10), db: q() });
    const sameYearDec = await createRun({ runKey: '2099-12', topN: 50, nowMs: Date.UTC(2099, 11, 6, 16, 10), db: q() });
    if (prevYearDec.kind !== 'ok' || sameYearDec.kind !== 'ok') throw new Error('createRun 실패');
    await advanceRun({ runId: prevYearDec.data.runId, phase: 'scan', nowMs: Date.UTC(2098, 11, 7, 16, 20), db: q() });
    await advanceRun({ runId: sameYearDec.data.runId, phase: 'complete', nowMs: Date.UTC(2099, 11, 6, 17, 0), db: q() });

    const got = await readPrevMonthRunPhase({ runKey: '2099-01', db: q() });
    expect(got).toEqual({ kind: 'ok', data: 'scan' });          // 2098-12 를 읽었다
    expect(got).not.toEqual({ kind: 'ok', data: 'complete' });   // 2099-12 를 읽지 않았다
  }, 30_000);

  dbIt('D2 직전 달 run 이 없으면 null — 첫 달을 「미완료」로 만들지 않는다', async () => {
    expect(await readPrevMonthRunPhase({ runKey: '2090-05', db: q() })).toEqual({ kind: 'ok', data: null });
  }, 30_000);

  dbIt('D3 `complete` 와 미완료 단계를 구분한다(라우트가 이 값으로 prevMonthIncomplete 를 낸다)', async () => {
    const a = await createRun({ runKey: '2097-03', topN: 50, nowMs: Date.UTC(2097, 2, 3, 16, 10), db: q() });
    const b = await createRun({ runKey: '2097-05', topN: 50, nowMs: Date.UTC(2097, 4, 5, 16, 10), db: q() });
    if (a.kind !== 'ok' || b.kind !== 'ok') throw new Error('createRun 실패');
    await advanceRun({ runId: a.data.runId, phase: 'complete', nowMs: Date.UTC(2097, 2, 3, 17, 0), db: q() });
    await advanceRun({ runId: b.data.runId, phase: 'retry', nowMs: Date.UTC(2097, 4, 5, 17, 0), db: q() });

    expect(await readPrevMonthRunPhase({ runKey: '2097-04', db: q() })).toEqual({ kind: 'ok', data: 'complete' });
    expect(await readPrevMonthRunPhase({ runKey: '2097-06', db: q() })).toEqual({ kind: 'ok', data: 'retry' });
  }, 30_000);

  // E. 이 시험의 감도 자가 점검 — S1·S2 변이를 **정말 잡는지** 같은 SQL 을 손으로 변형해 확인한다
  dbIt('🔴 E1 감도: `kis_enam` 을 `sec_name` 에서 읽는 변이 SQL 은 **다른 값**을 준다(S1 을 잡는다는 증거)', async () => {
    const runId = await seedOk([cand({ ord: 0, symbol: 'NYS:ZZE', secTicker: 'ZZE', cik: 9999401, secName: 'Sec Only', kisEnam: 'MASTER ONLY ADR' })]);
    // 앱의 SELECT 와 **변이된 SELECT** 를 같은 행에 돌려 결과가 달라지는 것을 보인다
    const [good] = await (pool as mysql.Pool).query<mysql.RowDataPacket[]>(
      'SELECT kis_enam AS v FROM overseas_universe_candidate WHERE run_id = ? AND ord = 0', [runId],
    );
    const [mutated] = await (pool as mysql.Pool).query<mysql.RowDataPacket[]>(
      'SELECT sec_name AS v FROM overseas_universe_candidate WHERE run_id = ? AND ord = 0', [runId],
    );
    expect(good[0].v).toBe('MASTER ONLY ADR');
    expect(mutated[0].v).toBe('Sec Only');
    expect(good[0].v).not.toBe(mutated[0].v);   // 두 열이 구별되는 값을 담고 있다 = B1 단언이 변이에 민감하다
  }, 30_000);

  dbIt('🔴 E2 감도: `kis_enam` 을 넣지 않으면 NULL 로 남는다 — B1 의 단언이 S2(파라미터 버림)를 잡는다', async () => {
    const runId = await seedOk([cand({ ord: 0, symbol: 'NYS:ZZF', secTicker: 'ZZF', cik: 9999501, kisEnam: 'WILL BE WIPED' })]);
    await (pool as mysql.Pool).query('UPDATE overseas_universe_candidate SET kis_enam = NULL WHERE run_id = ? AND ord = 0', [runId]);
    const rows = await readFinalizeRows({ runId, db: q() });
    if (rows.kind !== 'ok') throw new Error('readFinalizeRows 실패');
    expect(rows.data[0].kisEnam).toBeNull();   // 버려지면 이 모양이 된다 → B1 이 깨진다
  }, 30_000);
  // ── F. 🔴 T-145 ⑥ — 단일 행의 흠이 그 달을 버리게 하지 않는다 (Reviewer 가 STRICT 실 DB 로 재현한 셋)

  const verdict = (over: Partial<CandidateVerdict> = {}): CandidateVerdict => ({
    ord: 0, capUsed: 1e11, capAlt: null, capSource: 'tomv', capRatio: 1,
    capFlag: 'consistent', exclusion: null, rankNo: 1, ...over,
  });

  dbIt('🔴 F1 `cap_ratio` 에 2e7 이 와도 finalize 가 **깨지지 않는다** — NULL + `cap_flag +oob` 로 남는다', async () => {
    const runId = await seedOk([cand({ ord: 0, symbol: 'NYS:ZZG', secTicker: 'ZZG', cik: 9999601 })]);
    const fin = await finalizeRun({
      runId,
      // Reviewer 가 "Out of range value for column 'cap_ratio'" 를 낸 그 값이다
      verdicts: [verdict({ ord: 0, capRatio: 2e7, capFlag: 'basis_mismatch' })],
      auto: [{ symbol: 'NYS:ZZG', rankNo: 1, marketCap: 1e11 }],
      countsJson: '{}', added: [], removed: [], nowMs: Date.UTC(2099, 0, 4, 16, 40),
      getConnection: async () => (await (pool as mysql.Pool).getConnection()) as never,
    });
    expect(fin.kind).toBe('ok');          // 전에는 여기서 트랜잭션이 깨지고 그 달이 영구 실패로 닫혔다
    const [raw] = await (pool as mysql.Pool).query<mysql.RowDataPacket[]>(
      'SELECT cap_ratio, cap_flag, rank_no FROM overseas_universe_candidate WHERE run_id = ? AND ord = 0', [runId],
    );
    expect(raw[0].cap_ratio).toBeNull();
    expect(raw[0].cap_flag).toBe('basis_mismatch+oob');
    expect(Number(raw[0].rank_no)).toBe(1);   // 순위는 그대로 — 그 종목을 버리지 않았다
  }, 30_000);

  dbIt('🔴 F1-감도 가드를 거치지 않은 생 UPDATE 는 STRICT 가 **거부한다**(F1 이 원래도 통과하는 시험이 아니다)', async () => {
    const runId = await seedOk([cand({ ord: 0, symbol: 'NYS:ZZH', secTicker: 'ZZH', cik: 9999602 })]);
    await expect((pool as mysql.Pool).query(
      'UPDATE overseas_universe_candidate SET cap_ratio = ? WHERE run_id = ? AND ord = 0', [2e7, runId],
    )).rejects.toThrow(/[Oo]ut of range/);
  }, 30_000);

  dbIt('🔴 F2 `kis_stis` 에 2자가 와도 listing 이 깨지지 않는다 — 1자로 잘려 들어간다', async () => {
    const runId = await seedOk([cand({
      ord: 0, symbol: 'NYS:ZZI', secTicker: 'ZZI', cik: 9999603,
      kisStis: '23', kisIsdr: 'YN', kisEtyp: '0012',
    })]);
    const [raw] = await (pool as mysql.Pool).query<mysql.RowDataPacket[]>(
      'SELECT kis_stis, kis_isdr, kis_etyp FROM overseas_universe_candidate WHERE run_id = ? AND ord = 0', [runId],
    );
    expect([raw[0].kis_stis, raw[0].kis_isdr, raw[0].kis_etyp]).toEqual(['2', 'Y', '001']);
  }, 30_000);

  dbIt('🔴 F2-감도 생 INSERT 로 2자를 넣으면 STRICT 가 **거부한다**', async () => {
    const run = await createRun({ runKey: nextKey(), topN: 50, nowMs: Date.UTC(2099, 0, 4, 16, 10), db: q() });
    if (run.kind !== 'ok') throw new Error('createRun 실패');
    await expect((pool as mysql.Pool).query(
      `INSERT INTO overseas_universe_candidate (run_id, ord, symbol, sec_ticker, cik, kis_stis, status)
       VALUES (?, 0, 'NYS:ZZJ', 'ZZJ', 9999604, '23', 'pending')`, [run.data.runId],
    )).rejects.toThrow(/too long|Data truncated/i);
  }, 30_000);

  dbIt('🔴 F3 같은 심볼이 두 번 와도 listing 이 깨지지 않는다 — 첫 행만 들어간다(uq_cand_symbol)', async () => {
    const runId = await seedOk([
      cand({ ord: 0, symbol: 'NYS:ZZK', secTicker: 'ZZK', cik: 9999701, secName: 'First Row' }),
      cand({ ord: 1, symbol: 'NYS:ZZK', secTicker: 'ZZK2', cik: 9999702, secName: 'Second Row' }),
    ]);
    const [raw] = await (pool as mysql.Pool).query<mysql.RowDataPacket[]>(
      'SELECT ord, sec_name FROM overseas_universe_candidate WHERE run_id = ? ORDER BY ord', [runId],
    );
    expect(raw).toHaveLength(1);
    expect([Number(raw[0].ord), raw[0].sec_name]).toEqual([0, 'First Row']);
  }, 30_000);

  dbIt('🔴 F3-감도 생 INSERT 로 두 행을 넣으면 STRICT 가 **1062 로 거부한다**', async () => {
    const run = await createRun({ runKey: nextKey(), topN: 50, nowMs: Date.UTC(2099, 0, 4, 16, 10), db: q() });
    if (run.kind !== 'ok') throw new Error('createRun 실패');
    await expect((pool as mysql.Pool).query(
      `INSERT INTO overseas_universe_candidate (run_id, ord, symbol, sec_ticker, cik, status) VALUES
         (?, 0, 'NYS:ZZL', 'ZZL', 9999801, 'pending'), (?, 1, 'NYS:ZZL', 'ZZL2', 9999802, 'pending')`,
      [run.data.runId, run.data.runId],
    )).rejects.toThrow(/Duplicate entry/i);
  }, 30_000);

  dbIt('🔴 F4 스캔 원값이 열 범위를 넘어도 그 행이 **진행한다**(status=ok · 값은 NULL · error 는 비어 있다)', async () => {
    const key = nextKey();
    const run = await createRun({ runKey: key, topN: 50, nowMs: Date.UTC(2099, 0, 4, 16, 10), db: q() });
    if (run.kind !== 'ok') throw new Error('createRun 실패');
    const saved = await saveListing({
      runId: run.data.runId, candidates: [cand({ ord: 0, symbol: 'NYS:ZZM', secTicker: 'ZZM', cik: 9999901 })],
      sec: { fetchedAtMs: Date.UTC(2099, 0, 4, 16, 10), sha256: 'a'.repeat(64), rows: 1 },
      master: { fetchedAtMs: Date.UTC(2099, 0, 4, 16, 10), sha256: 'b'.repeat(64), rows: 1 },
      countsJson: '{}', nowMs: Date.UTC(2099, 0, 4, 16, 10),
      getConnection: async () => (await (pool as mysql.Pool).getConnection()) as never,
    });
    if (saved.kind !== 'ok') throw new Error('saveListing 실패');
    // 1e30 은 DECIMAL(28,4) 밖이다 — 전에는 이 UPDATE 가 실패해 그 행이 영원히 `pending` 으로 남았다
    await applyScanOutcome({
      runId: run.data.runId, nowMs: Date.UTC(2099, 0, 4, 16, 20), db: q(),
      outcome: { ord: 0, status: 'ok', tomv: 1e30, shar: 1e30, last: 1e20, curr: 'USD', etypNm: null, rsym: 'NYSZZM' },
    });
    const [raw] = await (pool as mysql.Pool).query<mysql.RowDataPacket[]>(
      'SELECT status, tomv, shar, last_price, attempts, error FROM overseas_universe_candidate WHERE run_id = ? AND ord = 0',
      [run.data.runId],
    );
    expect(raw[0].status).toBe('ok');
    expect([raw[0].tomv, raw[0].shar, raw[0].last_price]).toEqual([null, null, null]);
    expect(Number(raw[0].attempts)).toBe(1);     // 다시 집지 않는다(창을 다 쓰지 않는다)
    expect(raw[0].error).toBeNull();             // 「KIS 가 답했다」의 표식을 지우지 않는다(⑧-2)
  }, 30_000);

  dbIt('🔴 F4-감도 생 UPDATE 로 1e30 을 넣으면 STRICT 가 **거부한다**', async () => {
    const runId = await seedOk([cand({ ord: 0, symbol: 'NYS:ZZN', secTicker: 'ZZN', cik: 9999902 })]);
    await expect((pool as mysql.Pool).query(
      'UPDATE overseas_universe_candidate SET tomv = ? WHERE run_id = ? AND ord = 0', [1e30, runId],
    )).rejects.toThrow(/[Oo]ut of range/);
  }, 30_000);
  // ── G. 🔴 (Reviewer M-3) `readRunKisStatus` — 「KIS 가 답했나」의 SQL 의미

  /** 세 종목을 깔고 **각자 다른 스캔 상태**로 둔다: 답함 · 실패 · 아직 부른 적 없음. */
  async function seedKisStatus(): Promise<number> {
    const key = nextKey();
    const run = await createRun({ runKey: key, topN: 50, nowMs: Date.UTC(2099, 0, 4, 16, 10), db: q() });
    if (run.kind !== 'ok') throw new Error('createRun 실패');
    const cands: CandidateInsert[] = [
      cand({ ord: 0, symbol: 'NYS:ZOK', secTicker: 'ZOK', cik: 9990001 }),     // 답함
      cand({ ord: 1, symbol: 'NYS:ZERR', secTicker: 'ZERR', cik: 9990002 }),   // 조회 실패
      cand({ ord: 2, symbol: 'NYS:ZPEND', secTicker: 'ZPEND', cik: 9990003 }), // 부른 적 없음
      cand({ ord: 3, symbol: 'NYS:ZOOB', secTicker: 'ZOOB', cik: 9990004 }),   // 답했으나 값이 범위 밖
    ];
    const saved = await saveListing({
      runId: run.data.runId, candidates: cands,
      sec: { fetchedAtMs: Date.UTC(2099, 0, 4, 16, 10), sha256: 'a'.repeat(64), rows: cands.length },
      master: { fetchedAtMs: Date.UTC(2099, 0, 4, 16, 10), sha256: 'b'.repeat(64), rows: cands.length },
      countsJson: '{}', nowMs: Date.UTC(2099, 0, 4, 16, 10),
      getConnection: async () => (await (pool as mysql.Pool).getConnection()) as never,
    });
    if (saved.kind !== 'ok') throw new Error('saveListing 실패');
    await applyScanOutcome({
      runId: run.data.runId, nowMs: Date.UTC(2099, 0, 4, 16, 20), db: q(),
      outcome: { ord: 0, status: 'ok', tomv: 1e11, shar: 1e9, last: 100, curr: 'USD', etypNm: null, rsym: 'NYSZOK' },
    });
    await applyScanOutcome({
      runId: run.data.runId, nowMs: Date.UTC(2099, 0, 4, 16, 21), db: q(),
      outcome: { ord: 1, status: 'kis_error', error: 'HTTP 500' },
    });
    // ord 2 는 손대지 않는다(pending · fetched_at NULL)
    await applyScanOutcome({
      runId: run.data.runId, nowMs: Date.UTC(2099, 0, 4, 16, 22), db: q(),
      outcome: { ord: 3, status: 'ok', tomv: 1e30, shar: 1e30, last: 1e20, curr: 'USD', etypNm: null, rsym: 'NYSZOOB' },
    });
    return run.data.runId;
  }

  dbIt('🔴 G1 답한 종목 true · 조회 실패 false · **부른 적 없는 종목은 지도에 없다**(false 가 아니다)', async () => {
    const runId = await seedKisStatus();
    const m = await readRunKisStatus({ runId, db: q() });
    expect(m.get('NYS:ZOK')).toBe(true);
    expect(m.get('NYS:ZERR')).toBe(false);
    // 🔴 `fetched_at IS NOT NULL` 이 빠지면 이 종목이 error NULL 이라 **true** 로 들어온다 → 「답했다」고 거짓 보고
    expect(m.has('NYS:ZPEND')).toBe(false);
    expect(m.get('NYS:ZPEND')).toBeUndefined();
  });

  dbIt('🔴 G2 「답했다/못 했다」를 `error` 열로 가른다 — 둘을 같은 값으로 만들면 제안이 쏟아진다', async () => {
    const runId = await seedKisStatus();
    const m = await readRunKisStatus({ runId, db: q() });
    expect(m.get('NYS:ZOK')).not.toBe(m.get('NYS:ZERR'));     // 두 값이 구별된다
    expect([...m.values()].filter((v) => v === false)).toHaveLength(1);
    expect([...m.values()].filter((v) => v === true)).toHaveLength(2);   // ZOK · ZOOB
  });

  dbIt('🔴 G3 값이 범위를 넘어 NULL 로 저장된 종목도 **답한 것**이다(⑥ 가드와 ⑧-2 가 충돌하지 않는다)', async () => {
    const runId = await seedKisStatus();
    const [raw] = await (pool as mysql.Pool).query<mysql.RowDataPacket[]>(
      'SELECT status, tomv, error FROM overseas_universe_candidate WHERE run_id = ? AND ord = 3', [runId],
    );
    expect([raw[0].status, raw[0].tomv, raw[0].error]).toEqual(['ok', null, null]);
    const m = await readRunKisStatus({ runId, db: q() });
    expect(m.get('NYS:ZOOB')).toBe(true);                     // 「KIS 조회 불가」로 잘못 읽히지 않는다
  });

  dbIt('G4 `finalize` 가 status 를 excluded 로 덮어도 「답했다」가 유지된다(status 가 아니라 fetched_at·error 로 본다)', async () => {
    const runId = await seedKisStatus();
    await (pool as mysql.Pool).query(
      "UPDATE overseas_universe_candidate SET status = 'excluded', exclusion = 'cik_dup' WHERE run_id = ? AND ord = 0", [runId],
    );
    const m = await readRunKisStatus({ runId, db: q() });
    expect(m.get('NYS:ZOK')).toBe(true);
  });

  dbIt('G5 다른 run 의 행이 섞이지 않는다(run_id 로 묶인다)', async () => {
    const a = await seedKisStatus();
    const b = await seedKisStatus();
    const ma = await readRunKisStatus({ runId: a, db: q() });
    const mb = await readRunKisStatus({ runId: b, db: q() });
    expect(ma.size).toBe(3);
    expect(mb.size).toBe(3);
    const empty = await readRunKisStatus({ runId: 999999, db: q() });
    expect(empty.size).toBe(0);
  });
});

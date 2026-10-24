/**
 * T-074 정적 불변식 — 코드 문자열을 읽어 "새 경로가 몰래 생기는 것"을 막는다.
 *  1. 원장·라우트 코드의 쓰기 SQL 대상은 cash_flow_ledger·system_config 뿐(DELETE·DROP·ALTER·TRUNCATE·CREATE 없음)
 *  2. cash_flow_ledger 의 UPDATE 가 바꾸는 열 ⊆ deleted_*·anchor_*·fx_rate_used·fx_source·krw_equiv (금액·종류·통화·시각·메모 in-place UPDATE 금지)
 *  3. 주문·시그널·안전장치·거래소·알림 모듈을 import 하지 않는다 / 화면 공용 모듈은 서버 전용 모듈을 import 하지 않는다
 *  4. 마이그레이션은 부팅(db.ts setupDB)에 들어가지 않는다 / 공개 경로(OAUTH_PUBLIC_PATHS·middleware)에 cash-ledger 없음
 *  5. 라우트 파일은 HTTP 핸들러와 dynamic 만 내보낸다(Next 라우트 규약)
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function walk(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  const out: string[] = [];
  for (const name of fs.readdirSync(abs)) {
    const rel = path.join(dir, name);
    const st = fs.statSync(path.join(ROOT, rel));
    if (st.isDirectory()) { if (name !== '__tests__') out.push(...walk(rel)); } else if (/\.tsx?$/.test(name)) out.push(rel);
  }
  return out;
}

const SOURCES = [...walk('src/lib/ledger'), ...walk('src/app/api/cash-ledger')];
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('대상 파일이 다 잡힌다', () => {
  expect(SOURCES).toEqual(expect.arrayContaining([
    'src/lib/ledger/store.ts', 'src/lib/ledger/service.ts', 'src/lib/ledger/compute.ts', 'src/app/api/cash-ledger/route.ts',
    'src/app/api/cash-ledger/entries/[id]/correct/route.ts', 'src/app/api/cash-ledger/candidates/[key]/reopen/route.ts',
  ]));
  expect(SOURCES.length).toBeGreaterThanOrEqual(21);
});

test('🔴 쓰기 SQL 대상 = cash_flow_ledger · system_config 뿐', () => {
  const targets = new Set<string>();
  for (const f of SOURCES) {
    const code = strip(read(f));
    for (const m of code.matchAll(/\b(INSERT\s+(?:IGNORE\s+)?INTO|UPDATE|REPLACE\s+INTO|DELETE\s+FROM)\s+`?(\w+)`?/gi)) targets.add(m[2]);
    expect(code).not.toMatch(/\b(DELETE\s+FROM|DROP\s+TABLE|ALTER\s+TABLE|TRUNCATE|CREATE\s+TABLE)\b/i);
  }
  expect([...targets].sort()).toEqual(['cash_flow_ledger', 'system_config']);
});

test('🔴 cash_flow_ledger UPDATE 가 바꾸는 열 ⊆ 허용 목록 (추가 전용)', () => {
  const allowed = new Set([
    'deleted_at', 'deleted_by_user_id', 'delete_reason',
    'anchor_status', 'anchor_snapshot_id', 'anchor_snapshot_ts', 'anchor_detail', 'fx_rate_used', 'fx_source', 'krw_equiv',
  ]);
  const code = strip(read('src/lib/ledger/store.ts')).replace(/\s+/g, ' ');
  const sets = [...code.matchAll(/UPDATE cash_flow_ledger SET (.+?) WHERE/g)].map((m) => m[1]);
  expect(sets.length).toBe(3);   // 취소·정정(void) · 매칭 · 복구
  for (const s of sets) {
    for (const part of s.split(',')) {
      const col = part.split('=')[0].trim();
      expect(allowed.has(col)).toBe(true);
    }
  }
  // 금액·종류·통화·시각·메모·키를 바꾸는 UPDATE 가 없다
  expect(code).not.toMatch(/UPDATE cash_flow_ledger SET[^;`]*\b(amount|kind|currency|occurred_at|memo|client_entry_id|supersedes_id|counter_amount|counter_currency)\s*=/);
});

test('🔴 주문·시그널·안전장치·거래소·전략·알림 모듈을 import 하지 않는다', () => {
  for (const f of SOURCES) {
    const imports = [...read(f).matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    for (const i of imports) {
      expect(i).not.toMatch(/^@\/lib\/(safety|exchanges|signals|strategy|notify|orders|risk|profit-engine)(\/|$)/);
    }
  }
});

test('화면 공용 모듈(compute·validate 등)은 서버 전용 모듈을 import 하지 않는다', () => {
  const shared = ['rules', 'kst', 'korean-amount', 'compute', 'validate', 'types', 'snapshots', 'match', 'candidates'];
  for (const m of shared) {
    const imports = [...read(`src/lib/ledger/${m}.ts`).matchAll(/from\s+'([^']+)'/g)].map((x) => x[1]);
    for (const i of imports) {
      expect(i).not.toMatch(/^(@\/lib\/db|@\/lib\/auth|next\/server|mysql2|node:|fs$|\.\/(store|service|handlers))/);
    }
  }
});

test('🔴 마이그레이션은 부팅(db.ts setupDB)에 들어가지 않는다', () => {
  expect(read('src/lib/db.ts')).not.toMatch(/cash_flow_ledger|T-074|cash_ledger/);
});

test('🔴 공개 경로에 cash-ledger 가 없다(인증 필요)', () => {
  expect(read('src/middleware.ts')).not.toMatch(/cash-ledger/);
  expect(read('src/lib/auth/oauth/names.ts')).not.toMatch(/cash-ledger/);
});

test('라우트 파일은 HTTP 핸들러와 dynamic 만 내보낸다', () => {
  for (const f of SOURCES.filter((x) => x.startsWith('src/app/api/cash-ledger/') && x.endsWith('route.ts'))) {
    const code = read(f);
    const names = [...code.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/g)].map((m) => m[1]);
    for (const n of names) expect(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'dynamic']).toContain(n);
    expect(code).toContain("export const dynamic = 'force-dynamic'");
  }
});

test('마이그레이션 SQL: 가산 전용(CREATE TABLE IF NOT EXISTS 1개), 실행문에 DROP·ALTER·DELETE·다른 테이블 쓰기 없음', () => {
  const sql = read('scripts/migrations/T-074-cash-flow-ledger.sql');
  const exec = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
  expect(exec.match(/CREATE TABLE IF NOT EXISTS cash_flow_ledger/g)).toHaveLength(1);
  expect(exec).not.toMatch(/\b(DROP|ALTER|DELETE|INSERT|UPDATE|RENAME)\b|\bTRUNCATE\s+\w/i);   // TRUNCATE(x, 0) 함수(CHECK)는 허용
  expect(exec).toMatch(/COLLATE=utf8mb4_general_ci/);
  // 되돌리기는 주석으로만 둔다
  expect(sql).toMatch(/^-- DROP TABLE IF EXISTS cash_flow_ledger;$/m);
});

/**
 * T-108 A-3 — ops 지표 계층·라우트 **읽기 전용 울타리** (가이드 §4.0 · §6 A-3).
 *
 * 1. `src/lib/ops/metrics/**`·`src/app/api/ops/**`(시험 제외) 소스에 쓰기·DDL·잠금 SQL 0 — 주석을 지운 본문에서 **대소문자 무관**
 *    키워드(INSERT·UPDATE·DELETE·REPLACE·CREATE·ALTER·DROP·TRUNCATE)·문장 모양·잠금 절(FOR UPDATE·FOR SHARE·LOCK IN SHARE MODE·GET_LOCK(·INTO OUTFILE)을 본다.
 *    예외는 정확히 1줄: read-only.ts 의 실행 시점 금지 목록 정의(`const LOCKING_OR_WRITING =`).
 * 2. 주문·거래소·외부 환율·알림 경로 0 — `submitOrder`·`createOrder`·거래소 kis 모듈 import(별칭·상대경로)·`getUsdKrwRate`·
 *    notify·telegram import(별칭·상대경로)·`/api/settings/safety` 호출.
 * 3. `src/app`·`src/components`(시험 제외)에 `!dryRun`·`!safety.dryRun`·`!safety?.dryRun` 0, `dryRun === false` 같은 리터럴 비교 0
 *    — 실거래여부 방향은 live-trading.ts 로만.
 * 4. 라우트 5개 = 정확히 이 목록, 전부 `export const dynamic = 'force-dynamic'` 이고 GET 만 export.
 * 5. 일봉·판단 기록 표 이름은 각 reader 1파일에만(격리 시험 허용 목록과 같은 파일). 이 파일은 표 이름을 조각으로만 쓴다.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..', '..');
const rel = (f: string) => relative(ROOT, f).split(sep).join('/');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'node_modules') walk(p, out); }
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** 주석 제거(문자열 안의 // 는 SQL 에 없다고 본다 — URL·정규식 문자열이 이 계층에 없음을 함께 확인). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}
/** 허용 예외 1줄 — 실행 시점 금지 목록 정의 자체(키워드를 이름으로 담고 있다). */
function withoutGuardDefinition(code: string): string {
  return code.split('\n').filter((l) => !/^\s*const LOCKING_OR_WRITING = /.test(l)).join('\n');
}
const WRITE_WORDS = /\b(insert|update|delete|replace|create|alter|drop|truncate)\b/i;
const LOCK_CLAUSES = /\bfor\s+(update|share)\b|\block\s+in\s+share\s+mode\b|\bget_lock\s*\(|\binto\s+(outfile|dumpfile)\b|\binto\s+@/i;
const FORBIDDEN_MODULES = /(^|\/)exchanges\/kis|(^|\/)exchanges\/fx$|(^|\/)notify(\/|$)|telegram|slack/;

const OPS_FILES = [...walk(join(ROOT, 'src/lib/ops/metrics')), ...walk(join(ROOT, 'src/app/api/ops'))];
const read = (f: string) => readFileSync(f, 'utf8');

describe('A-3 ops 계층 — 읽기 전용', () => {
  test('검사 대상이 비어 있지 않다(지표 모듈 15개 이상 + 라우트 5개)', () => {
    const r = OPS_FILES.map(rel);
    expect(r.filter((x) => x.startsWith('src/lib/ops/metrics/')).length).toBeGreaterThanOrEqual(15);
    expect(r.filter((x) => x.startsWith('src/app/api/ops/')).length).toBe(5);
  });

  test.each(OPS_FILES.map((f) => [rel(f), f]))('%s — 쓰기·DDL·잠금 SQL 0(대소문자 무관)', (_r, f) => {
    const code = withoutGuardDefinition(stripComments(read(f)));
    expect(code).not.toMatch(WRITE_WORDS);
    expect(code).not.toMatch(LOCK_CLAUSES);
    expect(code).not.toMatch(/\bON\s+DUPLICATE\s+KEY\b/i);
  });

  test('예외 1줄은 정확히 read-only.ts 의 금지 목록 정의 한 곳', () => {
    const hits = OPS_FILES.flatMap((f) => read(f).split('\n').filter((l) => /^\s*const LOCKING_OR_WRITING = /.test(l)).map(() => rel(f)));
    expect(hits).toEqual(['src/lib/ops/metrics/read-only.ts']);
  });

  test('울타리 정규식 자기 점검 — 잡아야 할 모양', () => {
    for (const bad of ['select 1 for update', 'SELECT 1 FOR SHARE', 'select a lock in share mode', "select get_lock('x', 1)", 'truncate t', 'select 1 into outfile', 'select 1 into @v', 'Update t set a=1']) {
      expect(WRITE_WORDS.test(bad) || LOCK_CLAUSES.test(bad)).toBe(true);
    }
    for (const ok of ['SELECT updated_at FROM t', 'truncateCodePoints(x)', 'createReader()', 'SELECT 1 FROM t']) {
      expect(WRITE_WORDS.test(ok) || LOCK_CLAUSES.test(ok)).toBe(false);
    }
    for (const m of ['@/lib/exchanges/kis', '@/lib/exchanges/kis-symbols', '../../exchanges/kis', '@/lib/notify', '../notify', '../../notify/throttle', '@/lib/exchanges/fx', './telegram-x']) {
      expect(FORBIDDEN_MODULES.test(m)).toBe(true);
    }
    expect(FORBIDDEN_MODULES.test('@/lib/strategy/exit-switch')).toBe(false);
  });

  test.each(OPS_FILES.map((f) => [rel(f), f]))('%s — 주문·거래소·외부 환율·설정 쓰기 경로 0', (_r, f) => {
    const src = read(f);
    const code = stripComments(src);
    expect(code).not.toMatch(/\b(submitOrder|createOrder|cancelOrder|getUsdKrwRate|seedIfEmpty)\b/);
    const mods = [...src.matchAll(/(?:from\s+|import\s+|import\(\s*|require\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(mods.filter((m) => FORBIDDEN_MODULES.test(m))).toEqual([]);
    expect(code).not.toMatch(/\/api\/settings\/safety/);
    expect(code).not.toMatch(/\bfetch\(/);
  });

  test('라우트 5개 = 목록 그대로, 전부 force-dynamic + GET 만', () => {
    const routes = OPS_FILES.map(rel).filter((x) => x.startsWith('src/app/api/ops/')).sort();
    expect(routes).toEqual([
      'src/app/api/ops/analysis/route.ts', 'src/app/api/ops/funnel/route.ts', 'src/app/api/ops/home/route.ts',
      'src/app/api/ops/safety-state/route.ts', 'src/app/api/ops/trade/route.ts',
    ]);
    for (const r of routes) {
      const s = read(join(ROOT, r));
      expect(s).toMatch(/export const dynamic = 'force-dynamic';/);
      expect(s).toMatch(/export async function GET\(/);
      expect(s).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)\b/);
    }
  });

  // 표 이름은 조각을 이어 만든다 — 이 시험 파일 자신이 두 격리 시험(src 전체 문자열 검사)에 걸리지 않게.
  const BARS_RE = new RegExp(`\\b${['daily', 'bars'].join('_')}\\b`);
  const J = 'judg' + 'ment';
  const JUDG_RE = new RegExp([`${J}_run`, `${J}_candidate`, `${J}-recorder`, `${J}-trace`].join('|'));
  test('안전 판독 예약 레인은 safety-state.ts 만 쓴다(정의는 read-only.ts)', () => {
    const gateUsers = OPS_FILES.filter((f) => /\bOPS_SAFETY_GATE\b/.test(stripComments(read(f)))).map(rel).sort();
    expect(gateUsers).toEqual(['src/lib/ops/metrics/read-only.ts', 'src/lib/ops/metrics/safety-state.ts']);
    const laneReaders = OPS_FILES.filter((f) => /\bcreateSafetyReader\b|\ballowedSql\s*:/.test(stripComments(read(f)))).map(rel).sort();
    expect(laneReaders).toEqual(['src/lib/ops/metrics/safety-state.ts']);
  });

  test('일봉 표 이름 = daily-bars-read.ts 만, 판단 기록 표 이름 = judgment-read.ts 만', () => {
    const bars = OPS_FILES.filter((f) => BARS_RE.test(read(f))).map(rel);
    expect(bars).toEqual(['src/lib/ops/metrics/daily-bars-read.ts']);
    const judg = OPS_FILES.filter((f) => JUDG_RE.test(read(f))).map(rel);
    expect(judg).toEqual(['src/lib/ops/metrics/judgment-read.ts']);
  });
});

describe('A-2 보강 — 화면에서 dryRun 을 직접 뒤집지 않는다', () => {
  const UI = [...walk(join(ROOT, 'src/app')), ...walk(join(ROOT, 'src/components'))];
  test('src/app·src/components 에 `!dryRun`·`!safety.dryRun`·`!safety?.dryRun` 0건', () => {
    const hits = UI.filter((f) => /!\s*(safety\??\.)?dryRun\b/.test(stripComments(read(f)))).map(rel);
    expect(hits).toEqual([]);
  });
  const DRY_LITERAL = /\bdryRun\s*(===|!==|==|!=)\s*(true|false)\b|\b(true|false)\s*(===|!==|==|!=)\s*[\w.?]*dryRun\b/;
  test('src/app·src/components 에 `dryRun === false` 같은 리터럴 비교 0건(방향 해석은 live-trading.ts)', () => {
    const hits = UI.filter((f) => DRY_LITERAL.test(stripComments(read(f)))).map(rel);
    expect(hits).toEqual([]);
  });
  test('리터럴 비교 정규식 자기 점검', () => {
    expect(DRY_LITERAL.test('safety.dryRun === false')).toBe(true);
    expect(DRY_LITERAL.test('s?.dryRun !== true')).toBe(true);
    expect(DRY_LITERAL.test('false === safety.dryRun')).toBe(true);
    expect(DRY_LITERAL.test('form.dryRun !== settings.dryRun')).toBe(false);
  });
});

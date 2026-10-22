/**
 * T-070 경계 시험 — profit-engine 은 **연구·데이터 전용**이다(T-066 risk 격리 시험 패턴).
 *  1. profit-engine 은 주문·안전장치·시그널·전략·알림·LLM 경로를 참조하지 않는다. 거래소 모듈은 **읽기 함수만** 이름까지 고정해 가져온다
 *     (주문 진입점 `kis`·`kis-overseas`·`kis-domestic`·`order-quantity`·`fx` 없음, 토큰 재발급 `invalidateKisToken` 없음).
 *  2. 매매 경로(=src 전체에서 허용 목록 밖)는 profit-engine 을 참조하지 않는다. 예외는 수동 수집 라우트 `app/api/cron/daily-bars/route.ts` 하나.
 *  3. profit-engine 의 쓰기 SQL 은 daily_bars 뿐, DDL 없음. 라우트는 SQL 을 직접 쓰지 않는다.
 *  4. 라우트는 cron-runner 에 등록하지 않는다(정기 증분은 Phase 1).
 *  5. 사후검증 스크립트(scripts/profit-engine/)는 읽기 전용 — 쓰기·DDL SQL 없음, READ ONLY 세션, KIS·주문 호출 없음.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '../../..');
const ROOT = path.resolve(SRC, '..');
const rel = (f: string) => path.relative(SRC, f).split(path.sep).join('/');

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
    return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(e.name) ? [p] : [];
  });
}

const ALL = walk(SRC);
const isTest = (r: string) => /(^|\/)__tests__\//.test(r) || /\.test\.tsx?$/.test(r);
const OWN = /^lib\/profit-engine\//;
const ROUTE = 'app/api/cron/daily-bars/route.ts';
const ROUTE_TESTS = /^app\/api\/cron\/daily-bars\/__tests__\//;

const engineFiles = ALL.filter((f) => OWN.test(rel(f)) && !isTest(rel(f)));
const read = (f: string) => fs.readFileSync(f, 'utf8');
const importsOf = (src: string) => [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
/** (T-2) `import { a, b } from '<모듈>'` 의 이름 목록 — 따옴표 종류(' ")·줄바꿈과 무관하게. moduleRe 는 모듈 경로 정규식 원문. */
function namedImports(src: string, moduleRe: string): Array<{ mod: string; name: string }> {
  const re = new RegExp(`import\\s*(?:type\\s*)?\\{([^}]*)\\}\\s*from\\s*['"](${moduleRe})['"]`, 'g');
  return [...src.matchAll(re)].flatMap((m) => m[1].split(',').map((x) => x.trim().replace(/^type\s+/, '')).filter(Boolean)
    .map((name) => ({ mod: m[2], name })));
}

describe('profit-engine → 주문·안전장치 경로를 쓰지 않는다', () => {
  test('검사 대상 존재', () => {
    expect(engineFiles.map(rel).sort()).toEqual([
      'lib/profit-engine/daily-bars-collector.ts',
      'lib/profit-engine/daily-bars-kis.ts',
      'lib/profit-engine/daily-bars-paginate.ts',
      'lib/profit-engine/daily-bars-quality.ts',
      'lib/profit-engine/daily-bars-request.ts',
      'lib/profit-engine/daily-bars-store.ts',
      'lib/profit-engine/daily-bars-time.ts',
    ]);
  });

  test('import 대상은 허용 목록뿐(상대경로는 같은 폴더만)', () => {
    const allowed = new Set([
      '@/lib/exchanges/kis-auth', '@/lib/exchanges/kis-http', '@/lib/exchanges/kis-throttle', '@/lib/exchanges/kis-symbols',
      '@/lib/credentials', '@/lib/time', 'mysql2',
    ]);
    const bad = engineFiles.flatMap((f) => importsOf(read(f))
      .filter((m) => !(allowed.has(m) || /^\.\/[\w-]+$/.test(m)))
      .map((m) => `${rel(f)} → ${m}`));
    expect(bad).toEqual([]);
  });

  test('(R-8) 자격증명 모듈에서는 읽기 함수 getCredential 하나만 — 쓰기 함수 없음', () => {
    const named = engineFiles.flatMap((f) => namedImports(read(f), '@/lib/credentials').map((x) => x.name));
    expect([...new Set(named)]).toEqual(['getCredential']);
    // 모듈째·기본값 import 로 우회하지 않는다(따옴표 종류 무관)
    for (const f of engineFiles) expect(read(f)).not.toMatch(/import\s+(\*\s+as\s+\w+|\w+)\s+from\s*['"]@\/lib\/credentials['"]/);
  });

  test('(T-2) 이름 추출은 따옴표 종류와 무관하다 — 큰따옴표 둘째 import 도 잡힌다(바늘 자체 점검)', () => {
    const sample = [
      "import { getCredential } from '@/lib/credentials';",
      'import { setCredential } from "@/lib/credentials";',
      'import {\n  kisFetch,\n  isKisRateLimited,\n} from "@/lib/exchanges/kis-http";',
      "import type { KisPriority } from '@/lib/exchanges/kis-throttle';",
    ].join('\n');
    expect(namedImports(sample, '@/lib/credentials').map((x) => x.name)).toEqual(['getCredential', 'setCredential']);
    expect(namedImports(sample, '@/lib/exchanges/[^\'"]+').map((x) => `${x.mod}:${x.name}`)).toEqual([
      '@/lib/exchanges/kis-http:kisFetch', '@/lib/exchanges/kis-http:isKisRateLimited', '@/lib/exchanges/kis-throttle:KisPriority',
    ]);
  });

  test('거래소 모듈에서는 읽기 함수만 — 이름까지 고정', () => {
    const named = engineFiles.flatMap((f) => namedImports(read(f), '@/lib/exchanges/[^\'"]+').map((x) => `${x.mod}:${x.name}`));
    expect([...new Set(named)].sort()).toEqual([
      '@/lib/exchanges/kis-auth:getKisToken',
      '@/lib/exchanges/kis-auth:kisBaseUrl',
      '@/lib/exchanges/kis-http:isKisRateLimited',
      '@/lib/exchanges/kis-http:kisFetch',
      '@/lib/exchanges/kis-symbols:isDomesticSymbol',
      '@/lib/exchanges/kis-symbols:isOverseasSymbol',
      '@/lib/exchanges/kis-symbols:parseOverseas',
      '@/lib/exchanges/kis-throttle:isKisThrottleFailure',
    ]);
  });

  test.each([
    '@/lib/safety', '@/lib/orders', '@/lib/signals', '@/lib/strategy', '@/lib/notify', '@/lib/llm', '@/lib/analyst',
    "'@/lib/exchanges/kis'", 'kis-overseas', 'kis-domestic', 'order-quantity', 'exchanges/fx',
    'submitOrder', 'createOrder', 'cancelOrder', 'getBalances', 'invalidateKisToken', 'oauth2/tokenP', 'getUsdKrwRate',
    'setCredential', 'deleteCredentialOverride', 'trading/', 'order-rvsecncl', 'inquire-balance', 'TTTT', 'VTTT',
  ])('%p 참조 0건', (needle) => {
    const hits = engineFiles.filter((f) => read(f).includes(needle)).map(rel);
    expect(hits).toEqual([]);
  });

  test('동적 import·require 없음, 거래소 HTTP 는 kisFetch 하나로만(전역 fetch 직접 호출 없음)', () => {
    for (const f of engineFiles) {
      const src = read(f);
      expect(src).not.toMatch(/import\(|require\(/);
      expect(src.replace(/kisFetch\(/g, '')).not.toMatch(/\bfetch\(/);
    }
  });

  test('쓰기 SQL 대상은 daily_bars 뿐, DDL 없음', () => {
    const sql = engineFiles.map(read).join('\n');
    const writeVerb = ['INSERT INTO', 'UPDATE', 'DELETE FROM', 'REPLACE INTO'].join('|');
    const writes = [...sql.matchAll(new RegExp(`(?<!KEY )(${writeVerb})\\s+\`?(\\w+)`, 'g'))].map((m) => m[2]);
    expect(new Set(writes)).toEqual(new Set(['daily_bars']));
    expect(sql).not.toMatch(/DELETE FROM|REPLACE INTO|TRUNCATE/i);
    const ddl = ['CREATE', 'ALTER', 'DR' + 'OP'].join('|');
    expect(sql).not.toMatch(new RegExp(`\\b(${ddl})\\s+TABLE\\b`, 'i'));
  });

  test('주문 관련 테이블 이름은 읽기 대상 둘(position_state·signals 의 symbol)만 나온다', () => {
    const sql = engineFiles.map(read).join('\n');
    expect(sql).not.toMatch(/\b(orders|executions|trade_logs|system_config|portfolio_snapshots)\b/);
    expect(sql).toMatch(/SELECT symbol FROM position_state/);
    expect(sql).toMatch(/SELECT symbol, COUNT\(\*\) AS n FROM signals/);
  });
});

describe('매매 경로 → profit-engine 을 참조하지 않는다', () => {
  const guarded = ALL.filter((f) => {
    const r = rel(f);
    return !OWN.test(r) && r !== ROUTE && !ROUTE_TESTS.test(r);
  });

  test('검사 대상이 src 대부분이다(주문·안전장치·전략·cron 포함)', () => {
    const r = guarded.map(rel);
    expect(r.length).toBeGreaterThan(200);
    for (const must of [
      'lib/safety/dry-run.ts', 'lib/strategy/engine.ts', 'lib/signals/service.ts', 'lib/exchanges/kis.ts',
      'app/api/cron/entry-watcher/route.ts', 'app/api/cron/strategy-eval/route.ts', 'instrumentation.ts', 'middleware.ts',
    ]) expect(r).toContain(must);
  });

  test.each([
    ['@/lib/profit-engine', /@\/lib\/profit-engine\b/],
    ['상대경로 profit-engine', /(from\s+|import\(\s*|require\(\s*)['"](\.{1,2}\/)+([^'"]*\/)?profit-engine(\/[^'"]*)?['"]/],
    ['daily-bars 모듈명', /daily-bars-(collector|kis|paginate|quality|store|time|request)\b/],
    ['daily_bars 테이블', /\bdaily_bars\b/],
  ])('%s 참조 0건', (_n, re) => {
    const hits = guarded.filter((f) => re.test(read(f))).map(rel);
    expect(hits).toEqual([]);
  });
});

describe('수동 수집 라우트 — 범위 고정', () => {
  const src = read(path.join(SRC, ROUTE));

  test('import 허용 목록 밖 0건, 동적 import 없음', () => {
    expect(importsOf(src).sort()).toEqual([
      '@/lib/cron-auth', '@/lib/db',
      '@/lib/profit-engine/daily-bars-collector', '@/lib/profit-engine/daily-bars-request',
      '@/lib/profit-engine/daily-bars-store', '@/lib/profit-engine/daily-bars-time',
      'next/server',
    ]);
    expect(src).not.toMatch(/import\(|require\(/);
  });

  test('라우트는 SQL 을 직접 쓰지 않고 인증을 가장 먼저 확인한다', () => {
    expect(src).not.toMatch(/\b(SELECT|INSERT|UPDATE|DELETE)\b/);
    const body = src.slice(src.indexOf('export async function POST'));
    expect(body.indexOf('checkCronAuth(req)')).toBeGreaterThan(-1);
    expect(body.indexOf('checkCronAuth(req)')).toBeLessThan(body.indexOf('req.text()'));
    expect(body.indexOf('checkCronAuth(req)')).toBeLessThan(body.indexOf('getPool()'));
  });

  test('cron-runner 에 등록하지 않는다', () => {
    const runner = read(path.join(ROOT, 'scripts/cron-runner.sh'));
    expect(runner).not.toMatch(/daily-bars|daily_bars/);
  });
});

describe('사후검증 스크립트 — 읽기 전용', () => {
  const dir = path.join(ROOT, 'scripts/profit-engine');
  const files = ['signal-postmortem.mjs', 'postmortem-core.js'].map((n) => path.join(dir, n));

  test('파일 존재', () => {
    for (const f of files) expect(fs.existsSync(f)).toBe(true);
  });

  test('쓰기·DDL SQL 없음, KIS·주문·앱 모듈 호출 없음', () => {
    const src = files.map(read).join('\n');
    expect(src).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|REPLACE\s+INTO|TRUNCATE)\b/i);
    const ddl = ['CREATE', 'ALTER', 'DR' + 'OP'].join('|');
    expect(src).not.toMatch(new RegExp(`\\b(${ddl})\\s+(TABLE|DATABASE|INDEX)\\b`, 'i'));
    expect(src).not.toMatch(/koreainvestment|openapi|submitOrder|createOrder|kis_access_token|\bfetch\(/);
  });

  test('불러오는 모듈은 node 기본·mysql2·계산 본체뿐(앱 모듈 없음), 계산 본체는 아무것도 불러오지 않는다', () => {
    expect(importsOf(read(files[0])).sort()).toEqual(['./postmortem-core.js', 'mysql2/promise', 'node:fs', 'node:path', 'node:url']);
    expect(read(files[0])).not.toMatch(/require\(|import\(/);
    expect(read(files[1])).not.toMatch(/require\(|import\(|\bimport\s|from\s+['"]/);
  });

  test('DB 세션을 READ ONLY 로 열고 SELECT 외 문장은 래퍼가 거부한다', () => {
    const main = read(files[0]);
    expect(main).toMatch(/SET SESSION TRANSACTION READ ONLY/);
    expect(main).toMatch(/assertReadOnlySql/);
  });
});

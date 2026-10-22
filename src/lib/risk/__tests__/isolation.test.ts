/**
 * T-066 경계 시험 — 리스크 정책은 **표시·위험 계산 전용**이다 (Reviewer M-2 반영).
 *  1. `src` 전체에서 허용 목록 밖의 어떤 파일도 risk 모듈·risk_policy 키·리스크 정책 API 를 참조하지 않는다
 *     (주문·청산·시그널·안전장치·알림·분석가·설정 API·instrumentation 등 전부 — 감시 폴더를 나열하지 않고 전체를 걷는다).
 *     상대경로 import(`'../risk/compute'`, `'./risk'`)도 잡는다.
 *  2. risk 모듈은 거래소(KIS)·주문·시그널·안전장치 경로를 import 하지 않고, `@/lib/strategy` 에서는 `exit-switch` 하나만 가져온다.
 *  3. risk 모듈의 쓰기 SQL 은 system_config 뿐(position_state·orders·signals 쓰기 없음, DDL 없음).
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '../../..');
const rel = (f: string) => path.relative(SRC, f).split(path.sep).join('/');

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
    return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(e.name) ? [p] : [];
  });
}

const ALL = walk(SRC);

/** risk 기능 자신 — 서로 참조해도 되는 파일 */
const RISK_OWN = [
  /^lib\/risk\//,
  /^components\/risk\//,
  /^app\/api\/settings\/risk-policy\//,
  /^app\/settings\/risk-policy\//,
  /^app\/settings\/RiskPolicySummaryRow\.tsx$/,
];
/** risk 기능을 화면에 붙이는 곳 (설정 화면 — 요약 행·집행 중 띠만) */
const HOSTS = [/^app\/settings\/SettingsPage\.tsx$/];
const isTest = (r: string) => /(^|\/)__tests__\//.test(r) || /\.test\.tsx?$/.test(r);
const allowed = (r: string) => isTest(r) || RISK_OWN.some(x => x.test(r)) || HOSTS.some(x => x.test(r));

const NEEDLES: [string, RegExp][] = [
  ['@/lib/risk', /@\/lib\/risk\b/],
  ['@/components/risk', /@\/components\/risk\b/],
  ['risk_policy 키', /risk_policy/],
  ['RISK_POLICY_KEY', /RISK_POLICY_KEY/],
  ['리스크 정책 API 경로', /api\/settings\/risk-policy/],
  ['risk 모듈 파일명', /\/risk\/(compute|defaults|policy-store|policy-state)\b/],
  // 상대경로 import/require/동적 import — '../risk/x', './risk', '../../lib/risk/compute' 등
  ['상대경로 risk import', /(from\s+|import\(\s*|require\(\s*)['"](\.{1,2}\/)+([^'"]*\/)?risk(\/[^'"]*)?['"]/],
];

describe('src 전체 — 허용 목록 밖에서 risk 정책을 참조하지 않는다', () => {
  const guarded = ALL.filter(f => !allowed(rel(f)));

  test('검사 대상이 src 대부분이다 (주문·청산·알림·instrumentation 포함)', () => {
    const r = guarded.map(rel);
    expect(r.length).toBeGreaterThan(200);
    for (const must of [
      'lib/strategy/engine.ts', 'lib/strategy/exit-engine.ts', 'lib/safety/dry-run.ts', 'lib/notify/telegram.ts',
      'instrumentation.ts', 'middleware.ts', 'app/api/settings/safety/route.ts',
    ]) {
      expect(r).toContain(must);
    }
    expect(r.some(x => x.startsWith('lib/analyst/') || x.startsWith('app/api/analyst/'))).toBe(true);
    expect(r.some(x => x.startsWith('app/api/settings/strategies/'))).toBe(true);
  });

  test.each(NEEDLES)('%s 참조 0건', (_name, re) => {
    const hits = guarded.filter(f => re.test(fs.readFileSync(f, 'utf8'))).map(rel);
    expect(hits).toEqual([]);
  });

  test('상대경로 패턴이 실제로 잡히는지 (바늘 자체 점검)', () => {
    const re = NEEDLES.find(n => n[0] === '상대경로 risk import')![1];
    expect(re.test("import { computeRisk } from '../risk/compute';")).toBe(true);
    expect(re.test("import x from './risk';")).toBe(true);
    expect(re.test("const m = await import('../../lib/risk/policy-store');")).toBe(true);
    expect(re.test("import { riskScore } from './riskiness';")).toBe(false);
  });

  test('설정 화면은 요약 행·집행 중 띠만 가져온다', () => {
    const src = fs.readFileSync(path.join(SRC, 'app/settings/SettingsPage.tsx'), 'utf8');
    const imports = src.split('\n').filter(l => /^import .*risk/i.test(l));
    expect(imports.sort()).toEqual([
      "import { EnforcedStrip } from '@/components/risk/EnforcedStrip';",
      "import { RiskPolicySummaryRow } from './RiskPolicySummaryRow';",
    ]);
  });
});

describe('risk 모듈은 거래소·주문 경로를 쓰지 않는다', () => {
  const files = ALL.filter(f => RISK_OWN.some(x => x.test(rel(f))) && !isTest(rel(f)));

  test('검사 대상 존재', () => {
    expect(files.length).toBeGreaterThan(15);
  });

  test.each(['@/lib/exchanges', '@/lib/safety', '@/lib/signals', '@/lib/orders', '@/lib/notify', 'submitOrder', 'kis.'])('%p import·호출 0건', (needle) => {
    const hits = files.filter(f => fs.readFileSync(f, 'utf8').includes(needle)).map(rel);
    expect(hits).toEqual([]);
  });

  test('@/lib/strategy 에서 가져오는 것은 exit-switch 하나뿐 (읽기 전용 판독기)', () => {
    const froms = files.flatMap(f => [...fs.readFileSync(f, 'utf8').matchAll(/['"]@\/lib\/strategy\/?([^'"]*)['"]/g)].map(m => `${rel(f)} → ${m[1]}`));
    expect(froms).toEqual(['app/api/settings/risk-policy/route.ts → exit-switch']);
    // 상대경로로 strategy 를 우회해 가져오지도 않는다
    const relStrategy = files.filter(f => /['"](\.{1,2}\/)+([^'"]*\/)?strategy\//.test(fs.readFileSync(f, 'utf8'))).map(rel);
    expect(relStrategy).toEqual([]);
  });

  test('쓰기 SQL 은 system_config 뿐 (position_state·orders·signals 쓰기 없음, DDL 없음)', () => {
    const sql = files.map(f => fs.readFileSync(f, 'utf8')).join('\n');
    const writeVerb = ['INSERT INTO', 'UPDATE', 'DELETE FROM', 'REPLACE INTO'].join('|');
    expect(sql).not.toMatch(new RegExp(`(${writeVerb})\\s+\`?(position_state|orders|signals|portfolio_snapshots)`, 'i'));
    const writes = [...sql.matchAll(new RegExp(`(${writeVerb})\\s+\`?(\\w+)`, 'gi'))].map(m => m[2]);
    expect(new Set(writes)).toEqual(new Set(['system_config']));
    const ddl = ['CREATE', 'ALTER', 'DR' + 'OP'].join('|');
    expect(sql).not.toMatch(new RegExp(`\\b(${ddl})\\s+TABLE\\b`, 'i'));
  });

  test('compute.ts 는 순수 — DB·fetch·Node 전용 모듈 없음', () => {
    const src = fs.readFileSync(path.join(SRC, 'lib/risk/compute.ts'), 'utf8');
    expect(src).not.toMatch(/@\/lib\/db|fetch\(|from 'fs'|from 'path'|process\./);
  });
});

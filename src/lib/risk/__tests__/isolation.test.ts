/**
 * T-066 경계 시험 — 리스크 정책은 **표시·위험 계산 전용**이다 (Reviewer M-2 반영).
 *  1. `src` 전체에서 허용 목록 밖의 어떤 파일도 risk 모듈·risk_policy 키·리스크 정책 API 를 참조하지 않는다
 *     (주문·청산·시그널·안전장치·알림·분석가·설정 API·instrumentation 등 전부 — 감시 폴더를 나열하지 않고 전체를 걷는다).
 *     상대경로 import(`'../risk/compute'`, `'./risk'`)도 잡는다.
 *  2. risk 모듈은 거래소(KIS)·주문·시그널·안전장치 경로를 import 하지 않고, `@/lib/strategy` 에서는 `exit-switch` 하나만 가져온다.
 *  3. risk 모듈의 쓰기 SQL 은 system_config 뿐(position_state·orders·signals 쓰기 없음, DDL 없음).
 *  4. (T-068 WP-C) **명시적 예외 1건**: cron 라우트 `app/api/cron/stop-alert/route.ts` 가 risk → 방향으로 읽는다
 *     (`@/lib/risk/stop-alert`·`@/lib/risk/policy-store` 의 읽기 함수만). 이 라우트는 알림만 하며, 거래소는 `kis.getTicker` 만,
 *     쓰기는 `system_config.risk_stop_alert_state` 한 키뿐이다. 다른 cron·주문·시그널·안전장치 경로는 여전히 risk 를 읽지 않고,
 *     risk 순수 모듈(`stop-alert.ts` 포함)은 여전히 notify·exchanges 를 import 하지 않는다(아래 2).
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
/** T-068 WP-C 명시적 예외 — 손절가 도달 알림 cron 라우트(아래 'stop-alert 라우트 예외' describe 가 범위를 고정한다) */
const STOP_ALERT_ROUTE = 'app/api/cron/stop-alert/route.ts';
const isTest = (r: string) => /(^|\/)__tests__\//.test(r) || /\.test\.tsx?$/.test(r);
const allowed = (r: string) => isTest(r) || RISK_OWN.some(x => x.test(r)) || HOSTS.some(x => x.test(r)) || r === STOP_ALERT_ROUTE;

const NEEDLES: [string, RegExp][] = [
  ['@/lib/risk', /@\/lib\/risk\b/],
  ['@/components/risk', /@\/components\/risk\b/],
  ['risk_policy 키', /risk_policy/],
  ['RISK_POLICY_KEY', /RISK_POLICY_KEY/],
  ['리스크 정책 API 경로', /api\/settings\/risk-policy/],
  ['risk 모듈 파일명', /\/risk\/(compute|defaults|policy-store|policy-state)\b/],
  // 상대경로 import/require/동적 import — '../risk/x', './risk', '../../lib/risk/compute' 등
  ['상대경로 risk import', /(from\s+|import\(\s*|require\(\s*)['"](\.{1,2}\/)+([^'"]*\/)?risk(\/[^'"]*)?['"]/],
  ['risk_stop_alert 키', /risk_stop_alert/],
  ['stop-alert 모듈', /risk\/stop-alert|planStopAlerts|settleStopAlerts/],
];

describe('src 전체 — 허용 목록 밖에서 risk 정책을 참조하지 않는다', () => {
  const guarded = ALL.filter(f => !allowed(rel(f)));

  test('검사 대상이 src 대부분이다 (주문·청산·알림·instrumentation 포함)', () => {
    const r = guarded.map(rel);
    expect(r.length).toBeGreaterThan(200);
    for (const must of [
      'lib/strategy/engine.ts', 'lib/strategy/exit-engine.ts', 'lib/safety/dry-run.ts', 'lib/notify/telegram.ts',
      'instrumentation.ts', 'middleware.ts', 'app/api/settings/safety/route.ts',
      // 예외는 stop-alert 라우트 하나뿐 — 다른 cron(주문 실행 entry-watcher 포함)은 여전히 검사 대상
      'app/api/cron/entry-watcher/route.ts', 'app/api/cron/holding-checker/route.ts', 'app/api/cron/strategy-eval/route.ts',
    ]) {
      expect(r).toContain(must);
    }
    expect(r.some(x => x.startsWith('lib/analyst/') || x.startsWith('app/api/analyst/'))).toBe(true);
    expect(r.some(x => x.startsWith('app/api/settings/strategies/'))).toBe(true);
    expect(r).not.toContain(STOP_ALERT_ROUTE);
    expect(r.filter(x => x.startsWith('app/api/cron/')).length).toBeGreaterThan(10);
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

describe('T-068 stop-alert 라우트 예외 — 범위 고정', () => {
  const route = path.join(SRC, STOP_ALERT_ROUTE);
  const src = fs.readFileSync(route, 'utf8');
  const froms = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);

  test('예외 라우트가 실제로 있다', () => {
    expect(fs.existsSync(route)).toBe(true);
  });

  test('risk 에서는 stop-alert(순수 판정)·policy-store(정책 읽기)만 가져온다', () => {
    expect(froms.filter(f => /risk/.test(f)).sort()).toEqual(['@/lib/risk/policy-store', '@/lib/risk/stop-alert']);
    const fromStore = src.match(/import\s*\{([^}]*)\}\s*from\s*'@\/lib\/risk\/policy-store'/)![1].split(',').map(x => x.trim()).filter(Boolean);
    expect(fromStore).toEqual(['readRiskPolicy']);
  });

  test('import 허용 목록 밖 0건 (주문·안전장치·시그널·자격증명·분석가 없음)', () => {
    expect(froms.sort()).toEqual([
      '@/lib/cron-auth', '@/lib/db', '@/lib/exchanges/kis', '@/lib/notify',
      '@/lib/risk/policy-store', '@/lib/risk/stop-alert',
      '@/lib/strategy/market-hours', '@/lib/strategy/us-session',
      'mysql2', 'next/server',
    ].sort());
    expect(src).not.toMatch(/import\(|require\(/);
  });

  test('거래소는 kis.getTicker 만 — 주문·취소·잔고 호출 0', () => {
    const kisUses = [...src.matchAll(/\bkis\.(\w+)/g)].map(m => m[1]);
    expect([...new Set(kisUses)]).toEqual(['getTicker']);
    expect(src).not.toMatch(/createOrder|cancelOrder|getBalances|submitOrder/);
  });

  test('쓰기 SQL 은 system_config 하나(상태 키) — position_state·orders·signals 쓰기·DDL 없음', () => {
    const writeVerb = ['INSERT INTO', 'UPDATE', 'DELETE FROM', 'REPLACE INTO'].join('|');
    // `ON DUPLICATE KEY UPDATE value = …` 는 같은 INSERT 문의 일부라 대상 테이블이 아니다
    const writes = [...src.matchAll(new RegExp(`(?<!KEY )(${writeVerb})\\s+\`?(\\w+)`, 'g'))].map(m => m[2]);
    expect(writes).toEqual(['system_config']);
    expect(src.match(/ON DUPLICATE KEY UPDATE/g) ?? []).toHaveLength(1);
    expect(src).not.toMatch(new RegExp(`(${writeVerb})\\s+\`?(position_state|orders|signals)`, 'i'));
    const ddl = ['CREATE', 'ALTER', 'DR' + 'OP'].join('|');
    expect(src).not.toMatch(new RegExp(`\\b(${ddl})\\s+TABLE\\b`, 'i'));
    expect(src).toMatch(/STOP_ALERT_STATE_KEY = 'risk_stop_alert_state'/);
  });

  test('notify 에서는 기존 export(dispatchAlert·getSymbolLabel)만 쓴다', () => {
    const m = src.match(/import\s*\{([^}]*)\}\s*from\s*'@\/lib\/notify'/)![1].split(',').map(x => x.trim()).sort();
    expect(m).toEqual(['dispatchAlert', 'getSymbolLabel']);
  });

  test('strategy 에서는 장 열림 판정(market-hours·us-session)만 읽는다', () => {
    expect(froms.filter(f => f.startsWith('@/lib/strategy')).sort()).toEqual(['@/lib/strategy/market-hours', '@/lib/strategy/us-session']);
  });
});

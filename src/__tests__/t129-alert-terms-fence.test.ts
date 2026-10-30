/**
 * T-129 (T-108 WP-D) — 서버가 만드는 사용자 노출 문구(텔레그램 승인·경보·정기 리포트·설정 응답 요약)의 옛 용어 울타리.
 *
 * 정본 용어표: 지표 계약 §12(`docs/design/2026-10-30-t108-metrics-contract-draft.md`) · 구현 가이드 §3.3.
 *   하드 손절 → 손실한도 손절 · EOD 손절 → 장마감 전 손절 · 킬스위치/Kill Switch/KILL_SWITCH → 모든거래차단 ·
 *   표본부족 → 건수 적음 · (DRY_RUN — 실제 주문 아님) → (가상 주문 — 실제 주문 아님).
 *
 * 화면 소스 울타리(`t108-terms-fence.test.ts`)와 달리 이 파일들은 **로그·env 이름·오류 코드가 같은 파일에 섞여 있다.**
 * 그래서 파일 전체 글자가 아니라 **문자열 리터럴만** 본다(TypeScript AST):
 *  - 주석은 리터럴이 아니므로 자동으로 빠진다.
 *  - 정규식 리터럴(`/kill_switch|KILL_SWITCH/i` — 오류 코드 판별)·식별자(`isKillSwitchActive`·`process.env.KILL_SWITCH`)는 리터럴이 아니다.
 *  - `console.*(…)` 호출 안의 리터럴은 운영 로그라 뺀다(pm2 로그 grep·운영 점검 문구가 그 글자를 기대한다 — 가이드 §3.3 제외 목록).
 *  - 그 밖에 남는 옛 용어는 아래 ALLOWED 에 **파일 + 리터럴 원문 정확 일치 + 사유**로만 허용한다. 새로 생기면 시험이 깨진다.
 *
 * 이 울타리가 보지 않는 것(가이드 §3.3 「제외」): `exit-engine.ts` 의 `reasonHead`(DB `signals.reason` 저장 텍스트),
 * 장마감 후 분석 엔진·판단 기록기·`volatility-guard`·`portfolio-snapshot/route.ts` 의 내부 경보(v1 제외).
 * (판단 기록 모듈 파일 이름을 여기 그대로 적지 않는다 — strategy/records 의 경계 시험이 src 전체에서 그 이름을 센다)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const SRC = join(__dirname, '..');   // <repo>/src

const TARGETS = [
  'lib/signals/approval-message.ts',
  'lib/signals/approval-notify.ts',
  'lib/signals/telegram-approval.ts',
  'lib/strategy/eval-funnel-labels.ts',
  'lib/strategy/exit-switch.ts',
  'lib/reports/trade-report.ts',
  'lib/safety/kill-switch.ts',
] as const;

/** 옛 용어 — 「DRY_RUN —」만이 아니라 DRY_RUN 전체를 막는다(이 7파일의 비로그 리터럴에 env 이름 DRY_RUN 이 들어갈 자리가 없다). */
const OLD_TERMS = /DRY_RUN|DRY RUN|킬스위치|KILL_SWITCH|[Kk]ill [Ss]witch|하드 ?손절|EOD ?손절|표본 ?부족/g;

interface Hit { file: string; literal: string; terms: string[] }

function isInsideConsoleCall(node: ts.Node): boolean {
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if (ts.isCallExpression(p)) {
      const callee = p.expression;
      if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'console') return true;
    }
  }
  return false;
}

/** 문자열 리터럴(템플릿 조각 포함)의 원문 — `.text` 는 이스케이프를 푼 값이라 한글이 그대로 보인다 */
function literals(file: string, source: string): Array<{ text: string; log: boolean }> {
  // setParentNodes=true 필수 — console 호출 조상을 찾으려면 parent 가 있어야 한다
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Array<{ text: string; log: boolean }> = [];
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      // import 경로는 문구가 아니다
      if (!(ts.isImportDeclaration(n.parent) || ts.isExportDeclaration(n.parent))) out.push({ text: n.text, log: isInsideConsoleCall(n) });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function scan(file: string, source: string): Hit[] {
  const hits: Hit[] = [];
  for (const l of literals(file, source)) {
    if (l.log) continue;
    const m = l.text.match(OLD_TERMS);
    if (m) hits.push({ file, literal: l.text, terms: m });
  }
  return hits;
}

/**
 * 허용 예외 — 파일 + 리터럴 원문 정확 일치. 추가할 때는 사유를 같이 적는다.
 */
const ALLOWED: Array<Hit & { reason: string }> = [
  {
    file: 'lib/safety/kill-switch.ts',
    literal: '환경변수 KILL_SWITCH',
    terms: ['KILL_SWITCH'],
    reason: 'env 변수 이름 그 자체 — 사용자가 고쳐야 할 값의 위치를 알려 주는 출처 표기(내부 이름 유지 규칙)',
  },
];

const FILES = TARGETS.map((rel) => ({ rel, text: readFileSync(join(SRC, rel), 'utf8') }));

describe('T-129 서버 사용자 문구 — 옛 용어 울타리', () => {
  test('대상 7파일을 실제로 읽었고, 바뀐 용어가 들어 있다 (경로 오류로 빈 검사가 통과하지 않게)', () => {
    expect(FILES).toHaveLength(7);
    for (const f of FILES) expect(literals(f.rel, f.text).length).toBeGreaterThan(5);
    const all = (rel: string) => literals(rel, FILES.find(f => f.rel === rel)!.text).map(l => l.text).join('\n');
    expect(all('lib/signals/approval-message.ts')).toContain('손실한도 손절');
    expect(all('lib/signals/approval-message.ts')).toContain('장마감 전 손절');
    expect(all('lib/signals/approval-message.ts')).toContain('가상 주문 — 실제 주문 아님');
    expect(all('lib/signals/telegram-approval.ts')).toContain('모든거래차단');
    expect(all('lib/strategy/exit-switch.ts')).toContain('손실한도 손절·장마감 전 손절·트레일링·익절');
    expect(all('lib/reports/trade-report.ts')).toContain('건수 적음');
    expect(all('lib/safety/kill-switch.ts')).toContain('모든거래차단 자동 발동');
  });

  test('울타리 자체 점검 — 로그·주석·정규식·식별자는 빼고, 그 밖의 문자열·템플릿 조각은 한글 그대로 잡는다', () => {
    const sample = [
      "// 주석 킬스위치 — 빠진다",
      "/* Kill Switch */ const re = /kill_switch|KILL_SWITCH/i;",          // 정규식 리터럴 — 빠진다
      "const on = process.env.KILL_SWITCH; isKillSwitchActive();",          // 식별자 — 빠진다
      "console.error(`[safety] KILL_SWITCH 해석 불가 ${x}`);",              // 로그 — 빠진다
      "console.warn('[exit-engine] 하드 손절 스킵', { a: 'EOD 손절' });",    // 로그 인자 안 객체도 로그
      "sendAlert('critical', 'Kill Switch 자동 발동', `본문 ${n} 킬스위치를 켜세요`);",
      "const t = { hard_stop: '하드 손절' }; const u = `표본부족, ${k}건`;",
    ].join('\n');
    const got = scan('sample.ts', sample).map(h => h.terms).flat();
    expect(got).toEqual(['Kill Switch', '킬스위치', '하드 손절', '표본부족']);
  });

  test('파일별 옛 용어 = 허용 목록 (정확 일치)', () => {
    const hits = FILES.flatMap(f => scan(f.rel, f.text));
    const key = (h: Hit) => `${h.file} :: ${JSON.stringify(h.literal)} :: ${h.terms.join(',')}`;
    expect(hits.map(key).sort()).toEqual(ALLOWED.map(key).sort());
  });

  // Reviewer 변이 M7 — `describeExitEngineSwitch` 가 「트레일링스탑·목표익절」로 돌아가도 위 OLD_TERMS 에는 안 걸린다.
  // 화면(설정 응답 exitSwitchSummary)과 같은 표기(가이드 §3.3 「손실한도 손절·장마감 전 손절·트레일링·익절」)를 이 파일 한정으로 고정한다.
  test('exit-switch.ts 사용자 노출 문자열에 「트레일링스탑」「목표익절」 0건 (주석·console 제외)', () => {
    const rel = 'lib/strategy/exit-switch.ts';
    const lits = literals(rel, FILES.find(f => f.rel === rel)!.text).filter(l => !l.log).map(l => l.text);
    expect(lits.join('\n')).toContain('트레일링·익절');   // 빈 검사 방지 — 대상 문구를 실제로 읽었다
    expect(lits.filter(t => /트레일링 ?스탑|목표 ?익절/.test(t))).toEqual([]);
  });
});

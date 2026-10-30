/**
 * T-108 C-2 — 화면 용어 회귀 울타리 (가이드 §3.4).
 *
 * 화면에 옛 이름(DRY_RUN·킬스위치·하드 손절·EOD 손절·표본부족·AI BUY·실거래 여부 …)이 다시 들어오지 않게 막는다.
 * 정본 용어표는 가이드 §3.1(계약 §12 · 데모 v3 F 절): 실거래여부 · 모든거래차단 · 손실한도 손절 · 장마감 전 손절 ·
 * 건수 적음 · AI 매수 판단 · 가상 주문/가상 청산 · 시그널.
 *
 * - 대상: `src/app/**`(단 `src/app/api/**` 제외 — 서버 문구는 WP-D) + `src/components/**`. `__tests__`·`*.test.*` 제외.
 * - 주석은 코드가 아니다 → TypeScript 파서로 읽어 **주석을 뺀 출력**(printer removeComments)을 검사한다.
 *   줄 단위 정규식으로 `//` 를 지우면 문자열 속 `https://` 뒤가 잘려 검사 누락이 생기고, JSX 중괄호 주석을 놓치기 쉽다.
 * - 내부 키(`'dry_run'` 상태값·`dryRun` 식별자·`blockedBy: 'kill_switch'`)는 정규식에 걸리지 않는다(대소문자·밑줄 위치가 다르다).
 * - 허용 예외는 없음으로 시작한다. 생기면 `{ file, count, reason }` 정확 일치 목록으로(`usd-cash-balance-fence.test.ts` 방식).
 * - 「카드」는 정규식으로 못 거른다(UI 상자 뜻과 겹침) → §3.2 의 고정 문자열 3개만 0건 검사.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';

const SRC = join(__dirname, '..');   // <repo>/src

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      if (full === join(SRC, 'app', 'api')) continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function withoutComments(path: string, text: string): string {
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  // setParentNodes=true 필수 — false 면 printer 가 문자열 리터럴을 원문 대신 `\uXXXX` 로 다시 써서 한글 문자열이 검사에서 빠진다
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  return ts.createPrinter({ removeComments: true }).printFile(sf);
}

const FILES = [...walk(join(SRC, 'app')), ...walk(join(SRC, 'components'))].map((f) => {
  const text = readFileSync(f, 'utf8');
  return { path: relative(SRC, f).split(sep).join('/'), text, code: withoutComments(f, text) };
});

/** 가이드 §3.4 정규식 그대로. */
const OLD_TERMS = /DRY_RUN|DRY RUN|킬스위치|KILL_SWITCH|Kill Switch|하드 ?손절|EOD ?손절|장마감 손실 차단|표본 ?부족|AI BUY|실거래 여부/g;

/** 허용 예외 — 정확 일치(파일 → 개수). 지금은 없다. 추가할 때는 사유를 같이 적는다. */
const ALLOWED: Record<string, number> = {};

describe('화면 소스에 옛 용어 0건 (주석 제외)', () => {
  test('대상 파일을 실제로 읽었다 (경로 오류로 빈 검사가 통과하지 않게)', () => {
    expect(FILES.length).toBeGreaterThan(50);
    expect(FILES.some(f => f.path === 'app/settings/SettingsPage.tsx')).toBe(true);
    expect(FILES.some(f => f.path === 'components/scenario-card-display.ts')).toBe(true);
    expect(FILES.some(f => f.path.startsWith('app/api/'))).toBe(false);
  });

  test('주석 제거가 문자열·JSX 글자를 지우지 않는다 (울타리 자체 점검)', () => {
    const sample = [
      "const a = 'https://x.test/DRY_RUN'; // 주석 DRY_RUN",
      'const b = <div>{/* KILL_SWITCH */}킬스위치</div>;',
      '/* 하드 손절 */ const c = `EOD 손절`;',
      "const d = { t: '표본부족' };   // 한글 문자열 리터럴도 원문 그대로 검사돼야 한다",
    ].join('\n');
    const out = withoutComments('sample.tsx', sample);
    expect(out.match(OLD_TERMS)).toEqual(['DRY_RUN', '킬스위치', 'EOD 손절', '표본부족']);
  });

  test('파일별 일치 수 = 허용 목록', () => {
    const counts: Record<string, number> = {};
    const where: string[] = [];
    for (const f of FILES) {
      const m = f.code.match(OLD_TERMS);
      if (m) { counts[f.path] = m.length; where.push(`${f.path}: ${m.join(', ')}`); }
    }
    if (JSON.stringify(counts) !== JSON.stringify(ALLOWED)) {
      // 실패 메시지에 어디서 걸렸는지 남긴다
      expect(where).toEqual([]);
    }
    expect(counts).toEqual(ALLOWED);
  });
});

describe('시그널 뜻의 「카드」 — §3.2 고정 문자열 0건', () => {
  test.each(['카드 환율', '카드 금액', '미국 카드는'])('%s', (s) => {
    const hits = FILES.filter(f => f.code.includes(s)).map(f => f.path);
    expect(hits).toEqual([]);
  });
});

/**
 * R-UI 용어 전수(23:22)에서 위 정규식 밖으로 남았던 옛 표현 — 재발 방지.
 * 「AI 스킵·스킵됨」→「AI 매수 안 함」(§3.1 AI SKIP), 「⏭ SKIP·✅ EXEC」→「AI 매수 안 함·AI 매수 판단」, 「과거 표본이 부족」→「건수 적음」 계열,
 * 「모의 매매」(ON=주문 안 보냄)→「실거래여부」(ON=실거래 — 부호가 반대라 같이 두면 위험), 「← 대시보드」→「← 홈」.
 * 내부 값(`'SKIP'` 판단 코드·`ai_skipped` 상태·`skipCount` 필드·`SKIP_DRAFT_KEY`)은 대상이 아니다 — 아래 패턴은 화면 글자 모양만 본다.
 */
// 「모의 주문」(R-UI-N3) → 「가상 주문」. 「모의」 단독은 KIS 모의투자 계좌 종류(실전/모의)라 잡지 않는다.
// 「AI 안 함」 단독·「AI 「안 함」」 → 「AI 매매 안 함」(Designer 검토 — 「AI 가 안 돌았음」으로 거꾸로 읽힐 수 있음)
const OLD_TERMS_2 = /스킵|⏭ ?SKIP|✅ ?EXEC|SKIP \{|과거 표본|표본이 부족|모의 매매|모의 주문|← 대시보드|AI 안 함|AI 「안 함」/g;

/** 허용 예외 — 정확 일치. 지금은 없다(가입·초대 화면 안내도 「실거래여부」로 정정 — Leader 결정). */
const ALLOWED_2: Record<string, number> = {};

describe('R-UI 잔여 용어 0건 (주석 제외)', () => {
  test('울타리 자체 점검 — 내부 값은 걸리지 않고 화면 글자는 걸린다', () => {
    const out = withoutComments('s.tsx', [
      "const k = 'SKIP'; const SKIP_DRAFT_KEY = 'x'; const n = sym.skipCount;",
      "const a = <span>⏭ SKIP</span>; const b = <i>AI 스킵</i>; const c = { text: '스킵됨' };",
    ].join('\n'));
    expect(out.match(OLD_TERMS_2)).toEqual(['⏭ SKIP', '스킵', '스킵']);
  });
  test('파일별 일치 수 = 허용 목록', () => {
    const counts: Record<string, number> = {};
    const where: string[] = [];
    for (const f of FILES) {
      const m = f.code.match(OLD_TERMS_2);
      if (m) { counts[f.path] = m.length; where.push(`${f.path}: ${m.join(', ')}`); }
    }
    const same = Object.keys({ ...counts, ...ALLOWED_2 }).every(k => counts[k] === ALLOWED_2[k]);
    if (!same) expect(where).toEqual([]);   // 실패 메시지에 어디서 걸렸는지 남긴다
    expect(counts).toEqual(ALLOWED_2);
  });
});

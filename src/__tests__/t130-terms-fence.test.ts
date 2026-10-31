/**
 * T-130 D8-A — 청산 이름 회귀 울타리. 홈·거래·분석 화면과 그 서버 문구(`lib/ops`)·거래 리포트가 청산 이름을 **한 가지**로 쓴다:
 * 「목표 익절」「트레일링 스탑」(용어 정정표 §12 — 텔레그램 승인 메시지·저장된 시그널 사유 앞머리와 같은 이름).
 * 「익절」「트레일링」「트레일」 단독 표기가 다시 들어오면 실패한다.
 *
 * - 대상: 홈(`components/home`)·운용 화면 공통(`components/ops`·`components/dashboard`)·거래(`app/recommend`)·분석(`app/analytics`)·
 *   `components/OrderDetail.tsx`·서버 문구(`lib/ops`)·거래 리포트(`lib/reports/trade-report.ts`). 설정 화면(WP1)·전략 화면·텔레그램 승인 메시지는 이 시험의 대상이 아니다
 *   (설정은 `settings-*` 시험, 나머지는 이미 같은 이름 — 계약 §12 표 9·11행).
 * - 주석은 코드가 아니다 → TypeScript 파서로 주석을 뺀 출력을 검사한다(`t108-terms-fence.test.ts` 와 같은 방식).
 * - 일반어 「손절·익절」(예 「자동 손절·익절 없음」)은 청산 이름이 아니라 설명 문장이다 — 정확 일치 목록으로만 허용한다.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';

const SRC = join(__dirname, '..');   // <repo>/src

const ROOTS = ['components/home', 'components/ops', 'components/dashboard', 'app/recommend', 'app/analytics', 'lib/ops'];
const SINGLE_FILES = ['components/OrderDetail.tsx', 'lib/reports/trade-report.ts'];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function withoutComments(path: string, text: string): string {
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  // setParentNodes=true 필수 — false 면 printer 가 문자열 리터럴을 `\uXXXX` 로 다시 써서 한글이 검사에서 빠진다
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  return ts.createPrinter({ removeComments: true }).printFile(sf);
}

const FILES = [...ROOTS.flatMap((r) => walk(join(SRC, r))), ...SINGLE_FILES.map((f) => join(SRC, f))].map((f) => {
  const text = readFileSync(f, 'utf8');
  return { path: relative(SRC, f).split(sep).join('/'), code: withoutComments(f, text) };
});

/** 일반어 — 청산 이름이 아니라 「자동 손절·익절 없음」 같은 설명 문장 안의 낱말. 허용 위치: 파일 → 개수(정확 일치). */
const GENERIC = /손절·익절/g;
const ALLOWED_GENERIC: Record<string, number> = {
  'app/analytics/VerifyPanel.tsx': 1,           // X1 가동 「OFF — 자동 손절·익절 없음」
  'components/home/ExitLogicSection.tsx': 1,    // 가동 줄 「청산 엔진 OFF — 자동 손절·익절 없음」
};

/** 단독 「익절」(앞이 「목표 」가 아님) · 「트레일링」(뒤가 「 스탑」이 아님) · 「트레일」(뒤가 「링」이 아님). */
const BARE_PROFIT = /(?<!목표 )익절/g;
const BARE_TRAILING = /트레일링(?! 스탑)/g;
const BARE_TRAIL = /트레일(?!링)/g;

describe('T-130 D8-A 청산 이름 — 홈·거래·분석·서버 문구·거래 리포트', () => {
  test('대상 파일을 실제로 읽었다 (경로 오류로 빈 검사가 통과하지 않게)', () => {
    expect(FILES.length).toBeGreaterThan(40);
    for (const p of ['components/home/check-copy.ts', 'app/recommend/TradeHoldPanel.tsx', 'app/analytics/VerifyPanel.tsx', 'lib/ops/metrics/activity.ts', 'lib/ops/reason-dictionary.ts', 'lib/reports/trade-report.ts']) {
      expect(FILES.some((f) => f.path === p)).toBe(true);
    }
  });
  test('울타리 자체 점검 — 단독 표기는 잡고, 승인된 이름·일반어는 잡지 않는다', () => {
    expect('목표 익절 · 익절 · 트레일링 스탑 · 트레일링 · 트레일'.match(BARE_PROFIT)).toEqual(['익절']);
    expect('목표 익절 · 익절 · 트레일링 스탑 · 트레일링 · 트레일'.match(BARE_TRAILING)).toEqual(['트레일링']);
    expect('트레일링 스탑 · 트레일'.match(BARE_TRAIL)).toEqual(['트레일']);
    expect(withoutComments('s.tsx', "const a = '익절'; // 트레일링 주석\nconst b = <i>{/* 익절 */}목표 익절</i>;").match(BARE_PROFIT)).toEqual(['익절']);
  });
  test('일반어 「손절·익절」 은 허용 목록과 정확히 일치', () => {
    const counts: Record<string, number> = {};
    for (const f of FILES) { const m = f.code.match(GENERIC); if (m) counts[f.path] = m.length; }
    expect(counts).toEqual(ALLOWED_GENERIC);
  });
  test('단독 「익절」「트레일링」「트레일」 0건 (일반어 「손절·익절」 제외)', () => {
    const hits: string[] = [];
    for (const f of FILES) {
      const code = f.code.replace(GENERIC, '');
      for (const re of [BARE_PROFIT, BARE_TRAILING, BARE_TRAIL]) {
        const m = code.match(re);
        if (m) hits.push(`${f.path}: ${m.join(', ')}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

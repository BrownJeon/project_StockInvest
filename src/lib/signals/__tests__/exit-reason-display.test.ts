/**
 * T-128 A4 — 저장된 청산 사유 앞머리의 표시 시점 별칭(`exit-reason-display.ts`).
 *
 *  1. 변환 규칙 — 옛 앞머리·새 앞머리·앞머리 없음·중간에 있음 4종 + 표에 없는 앞머리·비문자열.
 *  2. 응답 행 변환 — 바뀔 것이 없으면 같은 객체(다른 키·순서·값 불변).
 *  3. 표시 지점 울타리 — 이 함수를 쓰는 곳 = T-128 task 의 표시 지점 목록(소스로 고정). 생성 경로(`exit-engine.ts`)는 쓰지 않고
 *     `reasonHead` 원문도 그대로다(DB 에 저장되는 텍스트 불변).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { displayExitReason, EXIT_REASON_HEAD_ALIASES, withDisplayReasoning } from '../exit-reason-display';

describe('displayExitReason — 맨 앞의 청산 앞머리만 승인 용어로', () => {
  test('옛 앞머리 → 새 앞머리 (손실한도 손절 · 장마감 전 손절)', () => {
    expect(displayExitReason('[하드 손절] 손실 -9.00% ≤ -8% → 자금 보호 청산')).toBe('[손실한도 손절] 손실 -9.00% ≤ -8% → 자금 보호 청산');
    expect(displayExitReason('[EOD 손절] KST 15:20~15:29 동시호가')).toBe('[장마감 전 손절] KST 15:20~15:29 동시호가');
  });
  test('새 앞머리는 그대로 — 두 번 거쳐도 같다', () => {
    expect(displayExitReason('[손실한도 손절] x')).toBe('[손실한도 손절] x');
    expect(displayExitReason('[장마감 전 손절] x')).toBe('[장마감 전 손절] x');
    for (const s of ['[하드 손절] a', '[EOD 손절] b', 'c']) expect(displayExitReason(displayExitReason(s))).toBe(displayExitReason(s));
  });
  test('앞머리 없음 · 표에 없는 앞머리는 그대로', () => {
    for (const s of ['', 'RSI14=30 < 38', '[목표 익절] +5%', '[트레일링 스탑] 풀백', '[시나리오 손절] x', '[AI 80%] 근거', '하드 손절 앞머리 아님']) {
      expect(displayExitReason(s)).toBe(s);
    }
  });
  test('중간에 있으면 그대로(앞에 다른 표지가 붙은 문자열·둘째 줄) · 앞 공백도 맨 앞이 아니다', () => {
    expect(displayExitReason('[INVALIDATED] [하드 손절] x')).toBe('[INVALIDATED] [하드 손절] x');
    expect(displayExitReason('첫 줄\n[EOD 손절] x')).toBe('첫 줄\n[EOD 손절] x');
    expect(displayExitReason(' [하드 손절] x')).toBe(' [하드 손절] x');
  });
  test('비문자열은 그대로', () => {
    expect(displayExitReason(null)).toBeNull();
    expect(displayExitReason(undefined)).toBeUndefined();
  });
  test('별칭 표 = 정본 용어(계약 §12) 2쌍의 옛·새 앞머리 4줄 (정확 일치)', () => {
    expect(EXIT_REASON_HEAD_ALIASES).toEqual([
      ['[하드 손절]', '[손실한도 손절]'],
      ['[손실한도 손절]', '[손실한도 손절]'],
      ['[EOD 손절]', '[장마감 전 손절]'],
      ['[장마감 전 손절]', '[장마감 전 손절]'],
    ]);
  });
});

describe('withDisplayReasoning — 응답 행', () => {
  test('바뀔 것이 없으면 같은 객체(키·값·순서 불변)', () => {
    for (const row of [{ id: 1, reasoning: 'RSI' }, { id: 2, reasoning: null }, { id: 3 }, { id: 4, reasoning: '[목표 익절] x' }]) {
      expect(withDisplayReasoning(row)).toBe(row);
    }
  });
  test('청산 앞머리면 reasoning 만 바꾼 새 객체 — 원본 행은 그대로', () => {
    const row = { id: 7, reasoning: '[하드 손절] x', status: 'auto_submitted' };
    const out = withDisplayReasoning(row);
    expect(out).toEqual({ id: 7, reasoning: '[손실한도 손절] x', status: 'auto_submitted' });
    expect(Object.keys(out)).toEqual(Object.keys(row));
    expect(row.reasoning).toBe('[하드 손절] x');
  });
});

describe('표시 지점 울타리 — 변환 함수를 쓰는 곳은 표시 지점뿐, 생성 경로는 쓰지 않는다', () => {
  const SRC = join(__dirname, '..', '..', '..');   // <repo>/src
  const rel = (f: string) => relative(SRC, f).split(sep).join('/');
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'node_modules') walk(p, out); }
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
    }
    return out;
  }
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const FILES = walk(SRC).map((f) => ({ rel: rel(f), code: strip(readFileSync(f, 'utf8')) }));

  /** T-128 task `## Developer` 의 표시 지점 목록과 같아야 한다(추가하면 둘 다 고친다). */
  const DISPLAY_POINTS: Record<string, RegExp> = {
    'lib/signals/approval-notify.ts': /displayExitReason\(lines/,          // 텔레그램 승인 요청(간단·버튼 본문 공통 pickReasonLine)
    'lib/signals/service.ts': /displayExitReason\(input\.reasoning/,       // 텔레그램 자동 제출 알림
    'app/api/signals/route.ts': /dbRows\.map\(withDisplayReasoning\)/,     // 목록 응답 → 승인 대기·결정 내역·주문 상세 등 화면
    'app/api/signals/[id]/route.ts': /withDisplayReasoning\(rows\[0\]\)/,  // 시나리오 상세 화면
    'app/api/signals/missed/route.ts': /displayExitReason\(r\.reasoning/,  // 놓친 기회 화면(거절된 청산 시그널 포함)
  };

  test('이 모듈을 import 하는 소스 = 표시 지점 5곳(정확 일치)', () => {
    expect(FILES.length).toBeGreaterThan(100);
    const users = FILES.filter((f) => /(?:from\s+|import\(\s*|require\(\s*)['"][^'"]*\/exit-reason-display['"]/.test(f.code)).map((f) => f.rel).sort();
    expect(users).toEqual(Object.keys(DISPLAY_POINTS).sort());
  });

  test.each(Object.entries(DISPLAY_POINTS))('%s 는 표시 직전에 변환 함수를 부른다', (file, re) => {
    const f = FILES.find((x) => x.rel === file);
    expect(f).toBeDefined();
    expect(f!.code).toMatch(re);
  });

  test('생성 경로 불변 — exit-engine.ts 는 변환을 쓰지 않고 저장 앞머리 원문(reasonHead)을 그대로 둔다', () => {
    const engine = FILES.find((f) => f.rel === 'lib/strategy/exit-engine.ts')!.code;
    expect(engine).not.toMatch(/exit-reason-display|displayExitReason|withDisplayReasoning/);
    expect(engine).toContain("reasonHead: '[하드 손절]'");
    expect(engine).toContain("reasonHead: '[EOD 손절]'");
    expect(engine).toContain('reasoning: `${a.reasonHead} ${a.detail}`');
  });
});

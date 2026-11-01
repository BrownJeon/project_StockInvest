/**
 * T-143 — 확인 시트의 **초기 포커스는 제목이다. 확정 버튼에 포커스하지 않는다.**
 *
 * 왜 시험으로 고정하나(Leader 브라우저 실측에서 나온 결함): 고위험 시트에서 확정 버튼을 자동 포커스하면
 * **반사적 Enter·Space 가 저장을 실행**시킨다. 일괄 교체는 분석 대상을 통째로 바꾸고, 제안 처리는 수동 목록을 바꾼다 —
 * 둘 다 「한 번 더 확인시키는 것」이 시트를 둔 이유인데, 확정 버튼에 포커스가 가 있으면 그 확인이 무력해진다.
 *
 * `'title'` 을 고른 근거는 **앱 관례**다 — 기존 호출처 **7곳 중 6곳이 `initialFocus="title"`** 이고
 * 1곳(`EntrySheet.tsx:259`)만 입력 폼이라 입력 칸을 가리킨다(「전부 title」이 아니다 — 2026-11-01 정정).
 * 제목은 이미 `tabIndex={-1}` 이라 새 id 가 필요 없고, `'취소'` 로 하면 T-143 만 또 다른 방식이 된다.
 * 확정 버튼에 초기 포커스를 준 것은 T-143 둘뿐이었다.
 *
 * 소스를 읽어 고정한다(렌더 시험이 아니다) — 시트는 상태가 열려야 그려지고, 여기서 막고 싶은 것은
 * **다음에 누가 한 글자를 되돌리는 것**이라 소스 단언이 그 목적에 맞다(`ops-read-only-fence` 와 같은 방식).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(__dirname, '..', '..', '..', '..');
const rel = (f: string) => relative(SRC, f).split(sep).join('/');

/**
 * 제품 코드만 걷는다 — **시험 파일은 제외**한다(`__tests__` 디렉토리·`*.test.ts(x)`).
 * 관례는 제품 코드에 대한 것이고, 빼지 않으면 **이 파일의 정규식 자기 점검 리터럴이 자기 스캔에 걸린다**
 * (Reviewer 가 「지금은 무해하지만 우연」이라고 지적한 자리 — 함께 닫았다). `ops-read-only-fence` 와 같은 방식이다.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'node_modules' && name !== '__tests__') walk(p, out); }
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const ALL = walk(SRC);
const read = (f: string) => readFileSync(f, 'utf8');
/** 주석을 지운 본문 — 주석에 적은 설명 문장이 단언에 걸리지 않게 한다 */
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const T143_SHEETS = [
  'app/settings/overseas-universe/OverseasUniversePage.tsx',
  'app/settings/overseas-universe/bulk/BulkReplacePage.tsx',
];

/**
 * 고정 문자열로 넘긴 초기 포커스를 모은다 — **`initialFocus="X"` 와 중괄호형 `{'X'}`·`{"X"}`·``{`X`}`` 를 모두** 본다.
 * 중괄호형을 빼면 `initialFocus={'wc-confirm'}` 으로 되돌릴 수 있어, 되돌림을 막으려는 이 시험에 구멍이 생긴다.
 */
function literalFocuses(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/initialFocus="([^"]*)"/g)) out.push(m[1]);
  for (const m of src.matchAll(/initialFocus=\{\s*(['"`])([^'"`]*)\1\s*\}/g)) out.push(m[2]);
  return out;
}

/**
 * **식으로** 넘긴 초기 포커스(`initialFocus={조건 ? 'a' : 'b'}` 같은 것). 리터럴 중괄호형은 위에서 세므로 뺀다.
 * 식은 정적으로 값을 다 알 수 없어 **허용 목록**으로 관리한다 — 새로 생기면 이 시험이 멈추고 사람이 본다.
 */
function expressionFocuses(src: string): string[] {
  return [...src.matchAll(/initialFocus=\{([^}]*)\}/g)]
    .map((m) => m[1].trim())
    .filter((e) => !/^(['"`])[^'"`]*\1$/.test(e));
}

/** 식 안에 박힌 문자열 리터럴들 — 식이라도 값이 확정 버튼을 가리키지 않는지는 볼 수 있다. */
function stringsIn(expr: string): string[] {
  return [...expr.matchAll(/(['"`])([^'"`]*)\1/g)].map((m) => m[2]);
}

describe('🔴 T-143 확인 시트 — 초기 포커스는 제목', () => {
  test('검사 대상이 실재한다(경로가 바뀌면 여기서 멈춘다)', () => {
    const files = ALL.map(rel);
    for (const f of T143_SHEETS) expect(files).toContain(f);
  });

  test.each(T143_SHEETS)('%s — initialFocus 는 "title" 하나뿐이다', (f) => {
    const src = code(join(SRC, f));
    expect(literalFocuses(src)).toEqual(['title']);
  });

  test.each(T143_SHEETS)('%s — 확정 버튼 id 를 초기 포커스로 쓰지 않는다', (f) => {
    const src = code(join(SRC, f));
    // 🔴 「확정 버튼 id 가 `returnFocusIds` 에 쓰이니 남아 있어야 한다」는 단언을 **지웠다** — 그 근거가 거짓이었다.
    //   실제 복귀 대상은 `[pending.openerId, actButtonId(…), 'uv-seg-proposals']`(제안)·
    //   `[sheet.openerId, DIFF_SAVE_BUTTON_ID]`(일괄 교체)이고 `uv-*-yes` 는 거기 없다. 이 시험이 고정할 것은
    //   **초기 포커스가 확정 버튼을 가리키지 않는다**는 사실 하나뿐이다(리터럴·중괄호형 둘 다).
    expect(literalFocuses(src).filter((v) => /^uv-/.test(v))).toEqual([]);
    expect(src).not.toMatch(/initialFocus=\{?\s*['"`]uv-/);
  });
});

/**
 * 이 시험이 **보증하지 않는 것**(후속 묶음에 적어 두었다):
 *  - 같은 파일에 시트를 **더** 두면 새 시트는 이 단언에 걸리지 않는다(`initialFocus` 를 안 주면 기본값
 *    `'first-input'` → 없으면 제목이라 **기본값이 안전 쪽**이다. 해악이 낮아 이번 범위에서 뺐다).
 *  - 이 시험 파일 자신의 정규식 리터럴도 검사 목록에 들어온다(지금은 무해하지만 우연이다).
 *  - **소스를 읽는 시험이라 실제 포커스 이동을 보증하지 않는다.** 그 연결 고리는
 *    `src/components/ui/__tests__/sheet.test.ts:148~152`(`initialFocusIds`)와 `Sheet.tsx:251`(그 값을 쓰는 곳)이다.
 */
describe('앱 관례 — 확정 동작에 초기 포커스를 주는 시트가 없다', () => {
  const withFocus = ALL.filter((f) => /initialFocus=/.test(code(f)));

  test('`Sheet` 를 쓰는 호출처를 실제로 모았다(관례 확인의 전제)', () => {
    // T-143 둘 + 기존 시트들. 숫자를 박지 않고 「T-143 이 전부가 아니다」만 확인한다
    expect(withFocus.length).toBeGreaterThan(T143_SHEETS.length);
    const names = withFocus.map(rel);
    for (const must of [
      'app/recommend/WatchCancelSheet.tsx',
      'components/ledger/CancelSheet.tsx',
      'components/ledger/BaselineSheet.tsx',
    ]) expect(names).toContain(must);
  });

  test('🔴 `src` 전체에서 초기 포커스가 **확정·저장 버튼 id** 를 가리키지 않는다', () => {
    const CONFIRM_ISH = /^(.*-)?(yes|ok|confirm|save|submit|apply)(-.*)?$/i;
    const bad = withFocus.flatMap((f) =>
      literalFocuses(code(f)).filter((v) => v !== 'title' && v !== 'first-input' && CONFIRM_ISH.test(v)).map((v) => `${rel(f)}:${v}`),
    );
    expect(bad).toEqual([]);
  });

  test('🔴 식으로 넘기는 초기 포커스는 허용 목록뿐이고, 그 안의 값도 확정 버튼이 아니다', () => {
    const CONFIRM_ISH = /^(.*-)?(yes|ok|confirm|save|submit|apply)(-.*)?$/i;
    // 머리 주석이 말한 「EntrySheet 조건부는 별도로 본다」를 **실제로 보는** 단언이다(전에는 주석만 있었다)
    const withExpr = withFocus.filter((f) => expressionFocuses(code(f)).length > 0).map(rel);
    expect(withExpr).toEqual(['components/ledger/EntrySheet.tsx']);
    for (const f of withFocus) {
      for (const expr of expressionFocuses(code(f))) {
        for (const v of stringsIn(expr)) {
          expect({ file: rel(f), v, confirmish: CONFIRM_ISH.test(v) }).toEqual({ file: rel(f), v, confirmish: false });
        }
      }
    }
  });

  test('정규식 자기 점검 — 잡아야 할 모양과 통과시킬 모양', () => {
    const CONFIRM_ISH = /^(.*-)?(yes|ok|confirm|save|submit|apply)(-.*)?$/i;
    for (const v of ['uv-bulk-yes', 'uv-sheet-yes', 'sh-ok', 'confirm', 'rp-save-btn']) expect(CONFIRM_ISH.test(v)).toBe(true);
    for (const v of ['title', 'first-input', 'sh-amt', 'sh-from', 'sh-bkrw']) expect(CONFIRM_ISH.test(v)).toBe(false);
    // 중괄호형을 실제로 잡는지 — 이 구멍이 비어 있던 자리다
    expect(literalFocuses(`initialFocus={'wc-confirm'}`)).toEqual(['wc-confirm']);
    expect(literalFocuses(`initialFocus={"sh-ok"}`)).toEqual(['sh-ok']);
    expect(literalFocuses('initialFocus="title"')).toEqual(['title']);
    // 조건식은 리터럴로 세지 않고 식으로 분류한다
    expect(literalFocuses(`initialFocus={x ? 'a' : 'b'}`)).toEqual([]);
    expect(expressionFocuses(`initialFocus={x ? 'a' : 'b'}`)).toEqual([`x ? 'a' : 'b'`]);
    expect(expressionFocuses(`initialFocus={'wc-confirm'}`)).toEqual([]);
  });
});

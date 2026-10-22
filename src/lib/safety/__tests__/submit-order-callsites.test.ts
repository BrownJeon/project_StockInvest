/**
 * 🔴 T-072 F-1 — **정적 시험: `src/` 의 모든 `submitOrder(` 호출부가 전략 귀속(`attribution`)을 명시한다.**
 *
 * `submitOrder` 는 `attribution` 미지정이면 "전략 귀속 없음"으로 보고 매수를 막는다(fail-closed, G6). 그래서 새 호출부가 귀속을
 * 빠뜨리면 막히는 쪽으로 틀리지만, 반대로 **검증된 전략 ID 를 문자열로 박아 넣으면** 관문을 우회한다. 이 시험은 소스를 TypeScript
 * 파서로 읽어(주석·문자열에 속지 않는다) 다음을 단언한다:
 *  1. 모든 호출의 3번째 인자가 객체 리터럴이고 `attribution: { kind: 'strategy', strategyId: <식>, signalId: <식> }` 를 직접 담는다
 *     (스프레드·변수로 감추면 실패 — 사람이 보게 만든다).
 *  2. `strategyId` 는 **문자열 리터럴이 아니다**(시그널 행·입력에서 온 값이거나 null). 직접 주문(`/api/orders`)은 정확히 `null`(F-1).
 *  3. 호출부 목록이 아래 고정 목록과 같다 — 새 호출부를 만들면 이 시험이 실패해 리뷰를 강제한다.
 *  4. `submitOrder` 를 값으로 넘기거나 별칭에 담지 않는다(호출 외 사용은 별칭 없는 import·typeof 뿐). WP-2c R-2 — 별칭 import
 *     (`import { submitOrder as so }`)·재수출(`export { submitOrder }`·`export * from '…dry-run'`)·구조분해도 금지하고, 별칭 호출도
 *     호출부로 센다(예전에는 별칭 호출이 목록·귀속 검사를 모두 빠져나갔다 — Reviewer 변이 R39).
 *  5. 거래소 어댑터 `createOrder` 는 `src/lib/exchanges/` 밖에서 **`submitOrder` 의 두 번째 인자로 넘기는 것만** 허용한다
 *     (직접 호출·`const f = kis.createOrder`·다른 함수 인자·import 금지).
 * 시험 파일(`__tests__/`·`*.test.ts`)은 대상이 아니다.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as ts from 'typescript';

const SRC = path.resolve(__dirname, '..', '..', '..');   // <repo>/src
const rel = (f: string) => path.relative(path.dirname(SRC), f).split(path.sep).join('/');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) {
      out.push(p);
    }
  }
  return out;
}

interface CallSite { file: string; line: number; problem: string | null; strategyIdText: string | null }
interface Scan { calls: CallSite[]; otherUses: string[]; directCreateOrder: string[] }

function propName(n: ts.ObjectLiteralElementLike): string | null {
  if ((ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) && n.name && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name))) return n.name.text;
  return null;
}

function checkOptions(arg: ts.Expression | undefined, sf: ts.SourceFile): { problem: string | null; strategyIdText: string | null } {
  if (!arg) return { problem: '3번째 인자(옵션) 없음', strategyIdText: null };
  if (!ts.isObjectLiteralExpression(arg)) return { problem: `옵션이 객체 리터럴이 아님: ${arg.getText(sf)}`, strategyIdText: null };
  if (arg.properties.some((p) => ts.isSpreadAssignment(p))) return { problem: '옵션에 스프레드 — 정적으로 확인 불가', strategyIdText: null };
  const att = arg.properties.find((p) => propName(p) === 'attribution');
  if (!att) return { problem: 'attribution 없음', strategyIdText: null };
  if (!ts.isPropertyAssignment(att) || !ts.isObjectLiteralExpression(att.initializer)) {
    return { problem: 'attribution 이 객체 리터럴이 아님', strategyIdText: null };
  }
  const o = att.initializer;
  if (o.properties.some((p) => ts.isSpreadAssignment(p))) return { problem: 'attribution 에 스프레드', strategyIdText: null };
  const get = (k: string) => o.properties.find((p) => propName(p) === k);
  const kind = get('kind');
  if (!kind || !ts.isPropertyAssignment(kind) || !ts.isStringLiteral(kind.initializer) || kind.initializer.text !== 'strategy') {
    return { problem: "attribution.kind 가 'strategy' 리터럴이 아님", strategyIdText: null };
  }
  const sid = get('strategyId');
  if (!sid || !ts.isPropertyAssignment(sid)) return { problem: 'attribution.strategyId 없음', strategyIdText: null };
  const init = sid.initializer;
  if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init) || ts.isTemplateExpression(init)) {
    return { problem: `attribution.strategyId 가 문자열 리터럴(${init.getText(sf)}) — 관문 우회`, strategyIdText: init.getText(sf) };
  }
  if (!get('signalId')) return { problem: 'attribution.signalId 없음', strategyIdText: init.getText(sf) };
  return { problem: null, strategyIdText: init.getText(sf) };
}

const DRY_RUN_MODULE = /(^|\/)safety\/dry-run$|^\.\/dry-run$/;

/**
 * 파일 하나를 검사해 `res` 에 쌓는다. WP-2c R-2 — 예전 구현은 `import { submitOrder as so }` 를 import specifier 라는 이유로 허용하고
 * 호출은 이름이 정확히 'submitOrder' 인 것만 셌다 → 별칭 호출 `so(...)` 가 호출부 목록·귀속 검사 **둘 다** 빠져나갔다(Reviewer R39).
 * 이제 ① 별칭 import·재수출(`export { submitOrder }`·`export * from '…dry-run'`)·구조분해·대입 등 **호출 외 모든 참조를 금지**하고
 * ② 별칭으로 들어온 이름의 호출도 호출부로 세어 귀속을 검사한다(금지 단언이 깨져도 귀속 검사가 한 번 더 잡게).
 * `createOrder` 도 `src/lib/exchanges/` 밖에서는 **`submitOrder` 의 두 번째 인자로 넘기는 것만** 허용한다(`const f = kis.createOrder` 금지).
 */
function scanSource(r: string, text: string, res: Scan): void {
  const sf = ts.createSourceFile(r, text, ts.ScriptTarget.Latest, true, r.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const inExchanges = r.startsWith('src/lib/exchanges/');
  const isDefinitionFile = r === 'src/lib/safety/dry-run.ts';
  const where = (n: ts.Node, why: string) => `${r}:${line(n)} ${why}: ${n.getText(sf).slice(0, 80)}`;

  // ① 이 파일에서 submitOrder 를 가리키는 로컬 이름(정상 import 는 'submitOrder' 그대로, 별칭이면 그 별칭)
  const callNames = new Set<string>(['submitOrder']);
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && st.importClause?.namedBindings && ts.isNamedImports(st.importClause.namedBindings)) {
      for (const sp of st.importClause.namedBindings.elements) {
        const imported = (sp.propertyName ?? sp.name).text;
        if (imported === 'submitOrder' && sp.name.text !== 'submitOrder') {
          callNames.add(sp.name.text);
          res.otherUses.push(where(sp, 'submitOrder 별칭 import'));
        }
        if (imported === 'createOrder' && !inExchanges) res.otherUses.push(where(sp, 'createOrder import(거래소 모듈 밖)'));
      }
    }
    if (ts.isExportDeclaration(st) && !isDefinitionFile) {
      const spec = st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : '';
      if (!st.exportClause && DRY_RUN_MODULE.test(spec)) res.otherUses.push(where(st, "dry-run 전체 재수출(export *)"));
      if (st.exportClause && ts.isNamedExports(st.exportClause)) {
        for (const sp of st.exportClause.elements) {
          if ((sp.propertyName ?? sp.name).text === 'submitOrder') res.otherUses.push(where(sp, 'submitOrder 재수출'));
        }
      }
    }
  }

  // WP-2d (Reviewer R2-3) — 요소 접근 호출 `dr['submitOrder'](…)` 도 이름으로 센다(예전엔 식별자·속성 접근만 봐서 호출부로 안 셌다).
  const calleeName = (c: ts.CallExpression): string | null =>
    ts.isIdentifier(c.expression) ? c.expression.text
    : ts.isPropertyAccessExpression(c.expression) ? c.expression.name.text
    : ts.isElementAccessExpression(c.expression) && ts.isStringLiteralLike(c.expression.argumentExpression) ? c.expression.argumentExpression.text
    : null;

  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const name = calleeName(n);
      const isSubmit = name !== null && (callNames.has(name) || (name === 'submitOrder'));
      if (isSubmit) res.calls.push({ file: r, line: line(n), ...checkOptions(n.arguments[2], sf) });
      if (name === 'createOrder' && !inExchanges) res.directCreateOrder.push(`${r}:${line(n)} ${n.getText(sf).slice(0, 80)}`);
    }
    // 요소 접근(`x['submitOrder']`·`kis['createOrder']`)은 호출이든 아니든 금지 — 정적 검사를 피하는 모양이다(호출이면 위에서 호출부로도 센다)
    if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression)) {
      const k = n.argumentExpression.text;
      if (k === 'submitOrder') res.otherUses.push(where(n, 'submitOrder 요소 접근'));
      if (k === 'createOrder' && !inExchanges) res.otherUses.push(where(n, 'createOrder 요소 접근'));
    }
    if (ts.isIdentifier(n) && n.text === 'submitOrder') {
      const p = n.parent;
      const allowed =
        (ts.isCallExpression(p) && p.expression === n) ||                                   // 호출(위에서 검사)
        (ts.isImportSpecifier(p) && !p.propertyName && p.name === n) ||                     // import { submitOrder } — 별칭 없음만
        (ts.isFunctionDeclaration(p) && p.name === n && isDefinitionFile) ||                // 정의(dry-run.ts)
        ts.isTypeQueryNode(p) ||                                                            // typeof submitOrder
        (ts.isPropertyAccessExpression(p) && p.name === n && ts.isCallExpression(p.parent) && p.parent.expression === p);   // x.submitOrder(...)
      // 별칭 import·재수출은 위 문장 단위 검사가 이미 남겼다 — 같은 노드를 두 번 세지 않는다
      const reported = (ts.isImportSpecifier(p) && !!p.propertyName) || ts.isExportSpecifier(p);
      if (!allowed && !reported) res.otherUses.push(where(p, 'submitOrder 를 호출 외로 참조'));
    }
    if (ts.isIdentifier(n) && n.text === 'createOrder' && !inExchanges) {
      const p = n.parent;
      if (ts.isPropertyAccessExpression(p) && p.name === n) {
        const c = p.parent;
        const directCall = ts.isCallExpression(c) && c.expression === p;                    // 위 directCreateOrder 가 센다
        const asSubmitArg = ts.isCallExpression(c) && c.arguments[1] === p && (() => { const nm = calleeName(c); return nm !== null && callNames.has(nm); })();
        if (!directCall && !asSubmitArg) res.otherUses.push(where(c, 'createOrder 를 submitOrder 인자 외로 참조'));
      } else if (!ts.isImportSpecifier(p)) {
        res.otherUses.push(where(p, 'createOrder 를 참조'));
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

function scan(): Scan {
  const res: Scan = { calls: [], otherUses: [], directCreateOrder: [] };
  for (const file of walk(SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    if (!/submitOrder|createOrder|dry-run/.test(text)) continue;
    scanSource(rel(file), text, res);
  }
  return res;
}

const result = scan();

/** 현재 호출부 — 새 호출부는 attribution 을 명시하고 여기에 추가해야 한다(리뷰 강제). */
const EXPECTED_CALLSITES: Record<string, number> = {
  'src/app/api/cron/entry-watcher/route.ts': 1,   // G5 뒤 — 행의 strategy_id
  'src/app/api/orders/route.ts': 1,               // 직접 주문 — strategyId: null (F-1)
  'src/lib/signals/service.ts': 2,                // createSignal 자동 제출(G1 뒤) · approveSignal(G4 뒤)
};

describe('🔴 T-072 — submitOrder 호출부는 전부 전략 귀속을 명시한다', () => {
  test('시험이 실제로 호출부를 찾았다(공허한 통과 방지)', () => {
    expect(result.calls.length).toBeGreaterThanOrEqual(4);
  });

  test('호출부 목록 = 고정 목록 (새 호출부는 이 목록을 고치면서 리뷰를 받는다)', () => {
    const byFile: Record<string, number> = {};
    for (const c of result.calls) byFile[c.file] = (byFile[c.file] ?? 0) + 1;
    expect(byFile).toEqual(EXPECTED_CALLSITES);
  });

  test('🔴 모든 호출이 attribution {kind:"strategy", strategyId:<문자열 리터럴 아님>, signalId} 를 직접 넘긴다', () => {
    const bad = result.calls.filter((c) => c.problem).map((c) => `${c.file}:${c.line} ${c.problem}`);
    expect(bad).toEqual([]);
  });

  test('🔴 직접 주문(POST /api/orders)의 strategyId 는 정확히 null — 사람이 만든 주문은 전략 귀속이 없다(매수 차단)', () => {
    const orders = result.calls.filter((c) => c.file === 'src/app/api/orders/route.ts');
    expect(orders.map((c) => c.strategyIdText)).toEqual(['null']);
  });

  test('submitOrder 를 값·별칭으로 쓰지 않는다(호출 외에는 import·정의·typeof 뿐)', () => {
    expect(result.otherUses).toEqual([]);
  });

  test('거래소 어댑터 createOrder 를 src/lib/exchanges 밖에서 직접 호출하지 않는다(submitOrder 를 거친다)', () => {
    expect(result.directCreateOrder).toEqual([]);
  });
});

describe('정적 검사기 자체 시험 (검사기가 틀리면 위 단언이 공허해진다)', () => {
  const check = (code: string) => {
    const sf = ts.createSourceFile('x.ts', code, ts.ScriptTarget.Latest, true);
    let out: ReturnType<typeof checkOptions> | null = null;
    const v = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'submitOrder') out = checkOptions(n.arguments[2], sf);
      ts.forEachChild(n, v);
    };
    v(sf);
    return out!;
  };
  test.each([
    ["submitOrder(r, f, { source: 'auto' })", 'attribution 없음'],
    ['submitOrder(r, f)', '3번째 인자(옵션) 없음'],
    ['submitOrder(r, f, opts)', '옵션이 객체 리터럴이 아님'],
    ["submitOrder(r, f, { ...o, attribution: { kind: 'strategy', strategyId: null, signalId: null } })", '옵션에 스프레드'],
    ["submitOrder(r, f, { attribution: { kind: 'strategy', strategyId: 'ok-v1', signalId: 1 } })", '문자열 리터럴'],
    ["submitOrder(r, f, { attribution: { kind: 'strategy', strategyId: `ok-v1`, signalId: 1 } })", '문자열 리터럴'],
    ["submitOrder(r, f, { attribution: { kind: 'other', strategyId: null, signalId: 1 } })", "'strategy'"],
    ["submitOrder(r, f, { attribution: { kind: 'strategy', signalId: 1 } })", 'strategyId 없음'],
    ["submitOrder(r, f, { attribution: { kind: 'strategy', strategyId: null } })", 'signalId 없음'],
    ['submitOrder(r, f, { attribution: a })', '객체 리터럴이 아님'],
  ])('%s → 실패(%s)', (code, msg) => {
    expect(check(code).problem).toContain(msg);
  });
  test('정상: 변수·?? 식·null', () => {
    expect(check("submitOrder(r, f, { attribution: { kind: 'strategy', strategyId: row.strategy_id ?? null, signalId: id } })").problem).toBeNull();
    expect(check("submitOrder(r, f, { attribution: { kind: 'strategy', strategyId: null, signalId: null } })").problem).toBeNull();
  });
});

describe('🔴 WP-2c R-2 — 별칭·재수출·간접 참조도 잡는다 (Reviewer R39 재현)', () => {
  const scanOne = (code: string, file = 'src/lib/signals/x.ts') => {
    const res: Scan = { calls: [], otherUses: [], directCreateOrder: [] };
    scanSource(file, code, res);
    return res;
  };
  test("R39: import { submitOrder as so } + 귀속 없는 so(...) → 별칭 금지 + 호출부로 세고 귀속 누락까지 잡는다", () => {
    const r = scanOne(`import { submitOrder as so } from '@/lib/safety/dry-run';
      export async function f(req, kis) { return so(req, kis.createOrder, { assetClass: 'stock', source: 'auto' }); }`);
    expect(r.otherUses).toEqual([expect.stringContaining('submitOrder 별칭 import')]);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].problem).toBe('attribution 없음');
  });
  test.each([
    ['const f = submitOrder', `import { submitOrder } from '@/lib/safety/dry-run'; const f = submitOrder; f(1, 2, {});`, 'submitOrder 를 호출 외로 참조'],
    ['값으로 넘기기', `import { submitOrder } from '@/lib/safety/dry-run'; run(submitOrder);`, 'submitOrder 를 호출 외로 참조'],
    ['구조분해 별칭', `const { submitOrder: so } = await import('@/lib/safety/dry-run'); await so(r, f, {});`, 'submitOrder 를 호출 외로 참조'],
    ['재수출', `export { submitOrder } from '@/lib/safety/dry-run';`, 'submitOrder 재수출'],
    ['별칭 재수출', `export { submitOrder as send } from '@/lib/safety/dry-run';`, 'submitOrder 재수출'],
    ['전체 재수출', `export * from '@/lib/safety/dry-run';`, 'dry-run 전체 재수출'],
    ['namespace 의 값 참조', `import * as dr from '@/lib/safety/dry-run'; const g = dr.submitOrder;`, 'submitOrder 를 호출 외로 참조'],
    ['createOrder 별칭(Reviewer R-2)', `const f = kis.createOrder; await f(req);`, 'createOrder 를 submitOrder 인자 외로 참조'],
    ['createOrder 를 다른 함수 인자로', `await run(req, kis.createOrder);`, 'createOrder 를 submitOrder 인자 외로 참조'],
    ['createOrder import', `import { createOrder } from '@/lib/exchanges/kis-domestic';`, 'createOrder import'],
    ["요소 접근 호출 dr['submitOrder'](…) (Reviewer R2-3)", `import * as dr from '@/lib/safety/dry-run'; await dr['submitOrder'](r, f, { attribution: { kind: 'strategy', strategyId: s, signalId: 1 } });`, 'submitOrder 요소 접근'],
    ["요소 접근 값 const g = dr['submitOrder']", `import * as dr from '@/lib/safety/dry-run'; const g = dr['submitOrder'];`, 'submitOrder 요소 접근'],
    ["kis['createOrder'] 요소 접근", `await submitOrder(r, kis['createOrder'], { attribution: { kind: 'strategy', strategyId: null, signalId: null } });`, 'createOrder 요소 접근'],
  ])('%s → 실패', (_n, code, msg) => {
    expect(scanOne(code).otherUses.join('\n')).toContain(msg);
  });
  test('정상 형태는 통과: import { submitOrder } · submitOrder(req, kis.createOrder, {...}) · typeof · dr.submitOrder(...)', () => {
    const r = scanOne(`import { submitOrder } from '@/lib/safety/dry-run'; import * as dr from '@/lib/safety/dry-run';
      type R = Awaited<ReturnType<typeof submitOrder>>;
      await submitOrder(req, kis.createOrder, { attribution: { kind: 'strategy', strategyId: row.strategy_id ?? null, signalId: id } });
      await dr.submitOrder(req, kis.createOrder, { attribution: { kind: 'strategy', strategyId: null, signalId: null } });`);
    expect(r.otherUses).toEqual([]);
    expect(r.directCreateOrder).toEqual([]);
    expect(r.calls.map((c) => c.problem)).toEqual([null, null]);
  });
  test("요소 접근 호출도 호출부로 센다 — 귀속 없는 dr['submitOrder'](r, f, {}) 는 귀속 누락으로도 잡힌다", () => {
    const r = scanOne(`import * as dr from '@/lib/safety/dry-run'; await dr['submitOrder'](r, f, { source: 'auto' });`);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].problem).toBe('attribution 없음');
  });
  test('거래소 모듈 안의 createOrder 정의·라우팅은 대상 아님', () => {
    expect(scanOne(`export const kis = { createOrder: (r) => adapter.createOrder(r) };`, 'src/lib/exchanges/kis.ts').otherUses).toEqual([]);
  });
});

/**
 * T-087 정적 봉인 — 브로커 원장 조회 코드(kis-ledger-query·kis-domestic-ledger·kis-overseas-ledger)는 **조회 TR 만** 쓴다.
 *  1. 주문·취소·정정 TR 코드(끝이 U 인 KIS TR — TTTC0011U·TTTC0012U·TTTC0013U·TTTC0801U·TTTC0802U·TTTC0803U·TTTT1002U·TTTT1004U·TTTT1006U 등)가 없다.
 *     원장 파일에 나오는 TR 모양 문자열은 전부 조회(끝 R)이고, 허용 목록과 정확히 같다.
 *  2. POST·주문 경로(order-cash·order-rvsecncl·/trading/order)·createOrder/cancelOrder/submitOrder·안전장치 import 가 없다.
 *  3. kisFetch 는 전부 priority 'bulk'(주문·시세 경로를 밀어내지 않는다) — 'critical' 이 없다.
 *  4. kis-domestic.ts·kis-overseas.ts 에 붙인 T-087 블록은 재노출 한 줄뿐이다(기존 함수 본문은 이 task 가 바꾸지 않는다).
 */
import * as fs from 'fs';
import * as path from 'path';
import { moduleRefs } from '@/lib/broker-ledger/__tests__/helpers/module-refs';

const DIR = path.join(__dirname, '..');
const LEDGER_FILES = ['kis-ledger-query.ts', 'kis-domestic-ledger.ts', 'kis-overseas-ledger.ts'];
const read = (f: string) => fs.readFileSync(path.join(DIR, f), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

/** 사용자 지시서에 이름이 나온 주문·취소·정정 TR + 기존 어댑터의 주문 TR(실전·모의). */
const ORDER_TRS = [
  'TTTC0011U', 'TTTC0012U', 'TTTC0013U', 'TTTC0801U', 'TTTC0802U', 'TTTC0803U', 'TTTT1002U', 'TTTT1004U', 'TTTT1006U',
  'VTTC0011U', 'VTTC0012U', 'VTTC0013U', 'VTTC0801U', 'VTTC0802U', 'VTTC0803U', 'VTTT1002U', 'VTTT1004U', 'VTTT1006U',
];
/** 원장 조회가 쓰는 TR 전부(실전·모의). 늘어나면 이 목록과 리뷰가 함께 바뀌어야 한다. */
const ALLOWED_TRS = [
  'TTTC0081R', 'VTTC0081R', 'TTTC8708R', 'VTTC8708R', 'TTTC8434R', 'VTTC8434R',
  'TTTS3035R', 'VTTS3035R', 'TTTS3039R', 'VTTS3039R', 'CTRP6504R', 'VTRP6504R',
];
const TR_LIKE = /\b[A-Z]{4}\d{4}[A-Z]\b/g;

describe.each(LEDGER_FILES)('%s', (f) => {
  const src = read(f);
  const code = stripComments(src);

  test('주문·취소·정정 TR 문자열 0건(주석 포함 원문 기준)', () => {
    for (const tr of ORDER_TRS) expect(src).not.toContain(tr);
    // 끝이 U(갱신 TR)인 KIS TR 모양 문자열이 하나도 없다
    expect([...src.matchAll(TR_LIKE)].map((m) => m[0]).filter((t) => t.endsWith('U'))).toEqual([]);
  });

  test('코드의 TR 모양 문자열은 전부 허용된 조회 TR', () => {
    for (const t of [...code.matchAll(TR_LIKE)].map((m) => m[0])) expect(ALLOWED_TRS).toContain(t);
  });

  test('POST·주문 경로·주문 함수·안전장치 import 0건', () => {
    expect(code).not.toMatch(/\bPOST\b/i);
    expect(code).not.toMatch(/method\s*:/);
    expect(code).not.toMatch(/order-cash|order-rvsecncl|\/trading\/order\b|\/trading\/order['`?]/);
    expect(code).not.toMatch(/\b(createOrder|cancelOrder|submitOrder)\b/);
    expect(code).not.toMatch(/\bbody\s*:/);   // 요청 본문 없음(GET)
  });

  test('금지 모듈 참조 0건 — from·부수효과 import·동적 import()·require 모두(Reviewer R1)', () => {
    const refs = moduleRefs(src);
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) {
      expect(r.mod).not.toMatch(/^@\/lib\/(safety|db|notify|orders|signals|strategy)(\/|$)/);
      // 상대 경로 우회(../safety/kill-switch, ../db 등)
      expect(r.mod).not.toMatch(/(^|\/)(safety|db|notify|orders|signals|strategy|dry-run|kill-switch|order-limits)(\.ts)?(\/|$)/);
    }
  });

  test("kisFetch 우선순위는 'bulk' 뿐", () => {
    expect(code).not.toMatch(/'critical'|"critical"/);
    const calls = [...code.matchAll(/kisFetch\(/g)].length;
    const bulk = [...code.matchAll(/kisFetch\([^)]*\{\s*headers\s*\}\s*,\s*\{\s*priority:\s*'bulk'/g)].length;
    expect(bulk).toBe(calls);
  });
});

test('조회 TR 이 실제로 쓰인다(봉인이 빈 파일을 통과시키지 않게)', () => {
  const all = LEDGER_FILES.map((f) => stripComments(read(f))).join('\n');
  for (const tr of ALLOWED_TRS) expect(all).toContain(`'${tr}'`);
  expect([...all.matchAll(/kisFetch\(/g)].length).toBe(6);
});

test.each(['kis-domestic.ts', 'kis-overseas.ts'])('%s 의 T-087 블록은 재노출 한 줄 + 주석뿐이고 파일 끝에 있다', (f) => {
  const src = read(f);
  const i = src.indexOf('// ── T-087');
  expect(i).toBeGreaterThan(0);
  const tail = src.slice(i).split('\n').filter((l) => l.trim() !== '');
  const codeLines = tail.filter((l) => !l.trim().startsWith('//'));
  const mod = f === 'kis-domestic.ts' ? './kis-domestic-ledger' : './kis-overseas-ledger';
  expect(codeLines).toEqual([`export { getDailyOrderFills, getPeriodProfit, getPositionSnapshot } from '${mod}';`]);
});

/**
 * T-087 정적 불변식 — `src/lib/broker-ledger/` 는 주문 경로와 분리된다(`ledger ⟂ safety` 와 같은 원칙, 설계 §7·T-087 불변 조건).
 *  1. 디렉터리 전체(시험 제외): `@/lib/safety`·`@/lib/db` 를 import 하지 않는다 — DB 연결은 호출자(라우트)가 주입한다.
 *  2. 순수 모듈(types·normalize·hash·decimal): DB 드라이버·Next·네트워크·자격증명·알림 import 없음, 거래소 모듈은 **타입만**(런타임 import 0 —
 *     `kis-ledger-query` 를 런타임으로 불러오면 자격증명 모듈을 거쳐 DB 풀까지 딸려 온다), `fetch(`·SQL 쓰기·주문 함수 없음.
 *  3. 주문·취소·정정 TR 문자열·알림(텔레그램) 없음.
 */
import fs from 'node:fs';
import path from 'node:path';
import { moduleRefs, stripComments } from './helpers/module-refs';

const ROOT = path.join(__dirname, '..');
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '__tests__') out.push(...walk(p)); } else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}
const ALL = walk(ROOT);
const PURE = ['types.ts', 'normalize.ts', 'hash.ts', 'decimal.ts'].map((f) => path.join(ROOT, f));
const read = (p: string) => fs.readFileSync(p, 'utf8');
const strip = stripComments;

test('대상 파일이 잡힌다', () => {
  for (const p of PURE) expect(ALL).toContain(p);
});

test.each(ALL.map((p) => [path.basename(p), p]))('%s — @/lib/safety·@/lib/db import 없음', (_n, p) => {
  for (const r of moduleRefs(read(p))) {
    expect(r.mod).not.toMatch(/^@\/lib\/(safety|db)(\/|$)/);
    expect(r.mod).not.toMatch(/(^|\/)(safety|db)(\.ts)?(\/|$)/);   // 상대 경로 우회(../safety, ../safety/kill-switch, ../../db)
  }
});

test.each(PURE.map((p) => [path.basename(p), p]))('%s — 순수 모듈 import 허용 목록', (_n, p) => {
  for (const r of moduleRefs(read(p))) {
    if (r.mod.startsWith('@/lib/exchanges/')) {
      expect({ stmt: r.stmt, typeOnly: r.typeOnly }).toEqual({ stmt: r.stmt, typeOnly: true });
      continue;
    }
    expect(['node:crypto', './decimal', './hash', './types', './normalize']).toContain(r.mod);
  }
  const code = strip(read(p));
  expect(code).not.toMatch(/\bfetch\(/);
  expect(code).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|REPLACE\s+INTO|CREATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE)\b/i);
  expect(code).not.toMatch(/\b(createOrder|cancelOrder|submitOrder|getPool|process\.env)\b/);
});

test.each(ALL.map((p) => [path.basename(p), p]))('%s — 주문 TR·알림 없음', (_n, p) => {
  const src = read(p);
  expect(src).not.toMatch(/\b[A-Z]{4}\d{4}U\b/);
  // 알림: 알림 모듈 참조·텔레그램/슬랙 전송 흔적. (`slackMs` 같은 "여유" 뜻 식별자는 알림이 아니다 — 단어 경계로만 본다)
  for (const r of moduleRefs(src)) expect(r.mod).not.toMatch(/notify|telegram|slack/i);
  expect(stripComments(src)).not.toMatch(/\btelegram\b|api\.telegram\.org|hooks\.slack\.com|\bsendMessage\b|\bsendTelegram\w*/i);
});

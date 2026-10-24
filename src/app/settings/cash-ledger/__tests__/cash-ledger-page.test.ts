/**
 * T-074 WP-B — /settings/cash-ledger 페이지 틀(머리·띠·배지·토스트 영역)과 경계(정적 점검).
 * 경계: 화면 코드는 서버 전용 모듈·주문·안전장치·리스크 모듈을 import 하지 않고, 네트워크 요청은 `/api/cash-ledger*` 뿐이다.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ReactNS from 'react';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as unknown as { React: typeof ReactNS }).React = ReactNS;
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }), usePathname: () => '/settings/cash-ledger' }));

import Page from '@/app/settings/cash-ledger/page';
import { CashLedgerView } from '@/app/settings/cash-ledger/CashLedgerPage';
import { dupIds, feedOf, stateOf, textOf } from '@/components/ledger/__tests__/fixtures';

const ROOT = path.resolve(__dirname, '../../../../..');
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join('/');
function walk(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(abs, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(rel(p));
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}
const SCREEN_FILES = [
  ...walk('src/components/ledger'), ...walk('src/app/settings/cash-ledger'),
  path.join(ROOT, 'src/app/settings/CashLedgerSummaryRow.tsx'), path.join(ROOT, 'src/components/ui/Sheet.tsx'),
];

describe('페이지 틀 (데모 ledgerScreen)', () => {
  test('첫 렌더 = 로딩 · 머리(‹ 설정 · 입출금 기록 · ◌ 기록·계산 전용) · 띠(돈을 움직이지 않고 주문도 만들지 않음)', () => {
    const html = renderToStaticMarkup(h(Page));
    expect(html).toContain('<a class="back" aria-label="설정으로 돌아가기" href="/settings">‹ 설정</a>');
    expect(html).toContain('<h2>입출금 기록</h2>');
    expect(html).toContain('<span class="mode disp">◌ 기록·계산 전용</span>');
    expect(textOf(html)).toContain('이 화면은 계좌의 돈을 움직이지 않고 주문도 만들지 않습니다. 넣고 뺀 돈을 적어 손익을 바르게 계산하는 기록장입니다.');
    expect(html).toContain('입출금 기록을 불러오는 중…');
    expect(html).toContain('<main class="app-body">');
  });
  test('정상: 토스트 영역(role=status · aria-live) 상시 · 시트 없음 · id 중복 없음 · 2열 영역 순서 top → list → bot', () => {
    const html = renderToStaticMarkup(h(CashLedgerView, { feed: stateOf(feedOf()) }));
    expect(html).toContain('<div class="toast" role="status" aria-live="polite"></div>');
    expect(html).not.toContain('role="dialog"');
    expect(dupIds(html)).toEqual([]);
    const top = html.indexOf('class="lg-top"');
    const list = html.indexOf('class="lg-list"');
    const bot = html.indexOf('class="lg-bot"');
    expect(top).toBeGreaterThan(0);
    expect(list).toBeGreaterThan(top);
    expect(bot).toBeGreaterThan(list);
    expect(html).toContain('<button type="button" class="btn pri wide" id="lg-add">+ 입출금 기록 추가</button>');
  });
  test('기준은 있는데 최신 스냅샷이 없으면 계산 불가를 오류 모양으로 알린다(데모에 없던 경우)', () => {
    const f = feedOf({ snapshot: null });
    const t = textOf(renderToStaticMarkup(h(CashLedgerView, { feed: stateOf(f) })));
    expect(t).toContain('최신 포트폴리오 스냅샷이 없어 손익을 계산하지 못했습니다');
  });
});

describe('🔴 경계 — 화면 코드', () => {
  test('검사 대상이 다 잡힌다', () => {
    const r = SCREEN_FILES.map(rel);
    expect(r).toEqual(expect.arrayContaining([
      'src/components/ledger/EntrySheet.tsx', 'src/components/ledger/actions.ts', 'src/app/settings/cash-ledger/CashLedgerPage.tsx',
      'src/app/settings/CashLedgerSummaryRow.tsx', 'src/components/ui/Sheet.tsx',
    ]));
    expect(r.length).toBeGreaterThanOrEqual(20);
  });
  test('서버 전용·주문·안전장치·거래소·시그널·리스크 모듈을 import 하지 않는다', () => {
    for (const f of SCREEN_FILES) {
      const imports = [...fs.readFileSync(f, 'utf8').matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
      for (const i of imports) {
        expect(`${rel(f)} → ${i}`).not.toMatch(/→ (next\/server|mysql2|node:|fs$|@\/lib\/db|@\/lib\/auth|@\/lib\/(safety|exchanges|signals|strategy|notify|orders|risk|profit-engine)(\/|$)|@\/components\/risk|@\/lib\/ledger\/(store|service|handlers|snapshots|match|candidates)$)/);
      }
    }
  });
  test('네트워크 요청은 actions.ts·useLedgerFeed.ts 두 곳뿐이고 경로는 /api/cash-ledger 아래뿐', () => {
    const withFetch = SCREEN_FILES.filter((f) => /\bfetch\(|fetchImpl\(/.test(fs.readFileSync(f, 'utf8'))).map(rel).sort();
    expect(withFetch).toEqual(['src/components/ledger/actions.ts', 'src/components/ledger/useLedgerFeed.ts']);
    for (const f of SCREEN_FILES) {
      for (const m of fs.readFileSync(f, 'utf8').matchAll(/['`](\/api\/[^'`]*)['`]/g)) expect(m[1]).toMatch(/^\/api\/cash-ledger(\/|$)/);
    }
  });
  test('🔴 배선(소스) — 시트 5종의 저장은 모두 중복 제출 잠금(sub.run)을 거친다', () => {
    // 실제 동작(두 번 눌러도 요청 1번)은 브라우저 확인 몫 — 여기서는 잠금을 우회한 직접 호출이 생기지 않게만 막는다
    for (const name of ['EntrySheet', 'CancelSheet', 'RestoreSheet', 'DismissSheet', 'BaselineSheet']) {
      const src = fs.readFileSync(path.join(ROOT, `src/components/ledger/${name}.tsx`), 'utf8');
      const commit = src.slice(src.indexOf('const commit = async'), src.indexOf('};', src.indexOf('const commit = async')));
      expect(`${name}: ${commit.includes('await sub.run(() => (p.writeImpl ?? write)')}`).toBe(`${name}: true`);
      expect(`${name}: ${/await \(p\.writeImpl \?\? write\)|await write\(/.test(commit)}`).toBe(`${name}: false`);
      expect(src).toContain('const sub = useRef(createSubmitter()).current;');
    }
  });
  test('🔴 배선(소스) — 시트를 닫는 순간 연 버튼 id 를 잡아 둔다(효과 정리 때는 이미 다음 화면)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/app/settings/cash-ledger/CashLedgerPage.tsx'), 'utf8');
    const close = src.slice(src.indexOf('const closeSheet = useCallback'), src.indexOf('}, [showToast]);'));
    expect(close).toContain('closeFocus.current = opts.focus ?? [sheetRef.current?.trigger ?? null, LIST_TITLE_ID, ADD_ID]');
    expect(close.indexOf('closeFocus.current')).toBeLessThan(close.indexOf('setSheet(null)'));
  });
  test('🔴 배선(소스) — 시트를 열 때 떠 있던 토스트와 타이머를 지운다(P1-1: 토스트가 시트를 가림)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/app/settings/cash-ledger/CashLedgerPage.tsx'), 'utf8');
    const clear = src.slice(src.indexOf('const clearToast = useCallback'), src.indexOf('const openSheet = useCallback'));
    expect(clear).toContain('clearTimeout(toastTimer.current)');
    expect(clear).toContain('setToast(null)');
    const open = src.slice(src.indexOf('const openSheet = useCallback'), src.indexOf('const closeSheet = useCallback'));
    expect(open).toContain('clearToast();');
    expect(open.indexOf('clearToast();')).toBeLessThan(open.indexOf('setSheet(s)'));
    // 시트는 모두 openSheet 로만 연다(직접 setSheet({...}) 없음)
    expect(src.match(/setSheet\(\{/g)).toBeNull();
  });
  test('🔴 M1 배선(소스) — client_entry_conflict 면 초안을 버리고(새 번호 재전송 금지) 최신 목록으로 바꾼 뒤 시트를 닫는다', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/app/settings/cash-ledger/CashLedgerPage.tsx'), 'utf8');
    const stale = src.slice(src.indexOf('onStale={(d, existingId, t) => {'), src.indexOf('/>', src.indexOf('onStale={(d, existingId, t) => {')));
    expect(stale).toContain('lastDraft.current = null;');
    expect(stale).toContain('if (d) feed.replace(d); else feed.refresh();');
    expect(stale).toContain('closeSheet({ toast: t');
    expect(stale).not.toMatch(/makeClientEntryId|newDraft/);
    const sheet = fs.readFileSync(path.join(ROOT, 'src/components/ledger/EntrySheet.tsx'), 'utf8');
    expect(sheet).toContain("if (dec.type === 'stale') { p.onStale(dec.data, dec.existingId, dec.toast); return; }");
  });
  test('a11y Minor-3(소스) — 사유에서 "기타"를 골라도 포커스를 글 칸으로 옮기지 않는다(방향키 흐름 유지)', () => {
    for (const name of ['CancelSheet', 'DismissSheet']) {
      const src = fs.readFileSync(path.join(ROOT, `src/components/ledger/${name}.tsx`), 'utf8');
      expect(`${name}: ${src.includes("focusTo('sh-etc')")}`).toBe(`${name}: false`);
      expect(src).toContain('onChange={() => setReason(r)}');
    }
  });
  // 화면의 USD 분기는 원장의 단일 판별 함수 isUsd()(lib/ledger/rules.ts) 한 곳을 거친다 — 그 함수는 T-056 울타리 시험이 세고 허용 목록에 사유와 함께 있다(Reviewer 항목 5 (c)).
  test('화면의 통화 분기는 원장 단일 함수 isUsd() 를 쓴다(직접 비교를 흩어 두지 않는다)', () => {
    for (const f of SCREEN_FILES) {
      const code = fs.readFileSync(f, 'utf8').split('\n').map((l) => l.replace(/^\s*(\*|\/\*|\/\/).*$/, '').replace(/\/\/.*$/, '')).join('\n');
      expect(code).not.toMatch(/\bcurrency\b[\s)]*===?\s*['"`]USD['"`]/);
      expect(code).not.toMatch(/['"`]USD['"`]\s*===?\s*[\w.?()[\]\s]*\bcurrency\b/);
    }
  });
});

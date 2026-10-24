/**
 * T-074 WP-B — 입출금 기록 화면 렌더 시험 (react-dom/server 정적 마크업, jsdom 불필요).
 * 승인 데모 v1 의 **문구·상태 어휘·접근성 속성**을 상태별로 고정한다. 픽셀·폭(360/412/1280)은 브라우저 확인 몫.
 * 시트는 포털이라 서버 렌더에 안 나오므로 `Sheet` 를 같은 마크업(`SheetFrame`)으로 바꿔 내용을 본다.
 * 숫자는 데모 합성값(기준 20,000,000원 · 손익 +830,000원 · 환율 1,250)이다.
 */
import * as ReactNS from 'react';
import { createElement as h, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as unknown as { React: typeof ReactNS }).React = ReactNS;

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }), usePathname: () => '/settings/cash-ledger' }));
jest.mock('@/components/ui/Sheet', () => {
  const actual = jest.requireActual('@/components/ui/Sheet');
  const R = jest.requireActual('react');
  return { ...actual, Sheet: (p: Record<string, unknown>) => R.createElement(actual.SheetFrame, p) };
});

import { LedgerBody, type BodyProps } from '@/app/settings/cash-ledger/CashLedgerPage';
import { EntrySheet, clientConflictToast, decideEntryOutcome, entryRequest, idWithRo } from '@/components/ledger/EntrySheet';
import { CancelSheet, cancelImpact, decideCancelOutcome } from '@/components/ledger/CancelSheet';
import { RestoreSheet, decideRestoreOutcome, restoreImpact } from '@/components/ledger/RestoreSheet';
import { DismissSheet, decideDismissOutcome } from '@/components/ledger/DismissSheet';
import { BaselineSheet, basePreview, baselineRequest, CASH_GAP_TITLE, cashGapLine, cashGapNote, cashGaps, cashVals, decideBaselineOutcome } from '@/components/ledger/BaselineSheet';
import { arrangeCandidates } from '@/components/ledger/FlowCandidateCard';
import { inHourRange } from '@/components/ledger/TrustSignals';
import { newDraft } from '@/components/ledger/entry-draft';
import { classifyWrite } from '@/components/ledger/actions';
import type { SheetErr } from '@/components/ledger/Parts';
import { SHEET_CSS } from '@/components/ui/Sheet';
import { LEDGER_CSS } from '@/components/ledger/LedgerStyles';
import { parseKstWall } from '@/lib/ledger/kst';
import { RULE } from '@/lib/ledger/rules';
import type { EntryWriteResponse, LedgerFeed } from '@/lib/ledger/types';
import { BASE_UNCONFIRMED, CAND, dupIds, entry, feedOf, SNAP, seed, stateOf, textOf } from './fixtures';

const noop = () => {};
function body(feed: ReturnType<typeof stateOf>, over: Partial<BodyProps> = {}) {
  const p: BodyProps = {
    feed, open: {}, showVoid: false, onAdd: noop, onToggle: noop, onToggleVoid: noop, onAction: noop, onGoEntry: noop,
    onCandRecord: noop, onCandDismiss: noop, onCandUndo: noop, onBase: noop, onReload: noop, ...over,
  };
  return renderToStaticMarkup(h(LedgerBody, p));
}
const node = (n: ReactNS.ReactNode) => renderToStaticMarkup(h(Fragment, null, n));
const frame = { returnFocusIds: () => [], onAfterClose: noop };
const sheetCommon = { frame, onClose: noop, onDone: noop, onFeed: noop, onRefresh: noop };

describe('화면 상태 — 로딩 · 조회 오류 · 기준 없음 · 빈 · 정상', () => {
  test('로딩: 스켈레톤 + sr 문구(role=status) · aria-busy', () => {
    const html = body(stateOf(null, 'loading'));
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('<span class="sr" role="status">입출금 기록을 불러오는 중…</span>');
    expect(html).toContain('class="skel big"');
  });
  test('🔴 조회 오류(마이그레이션 전 503 포함): role=alert · "기록이 없어진 것이 아닙니다" · 오류 문장 · 다시 시도', () => {
    const html = body(stateOf(null, 'error', '서버 응답 503 — 입출금 원장 테이블이 아직 없습니다 — 마이그레이션(T-074) 적용 전입니다. 기록이 없어진 것이 아닙니다.'));
    expect(html).toContain('role="alert"');
    const t = textOf(html);
    expect(t).toContain('입출금 기록을 불러오지 못했습니다');
    expect(t).toContain('이 화면이 값을 받지 못했을 뿐, 기록이 없어진 것이 아닙니다. 오류: 서버 응답 503 — 입출금 원장 테이블이 아직 없습니다');
    expect(html).toMatch(/<button type="button" class="btn pri" id="lg-retry">다시 시도<\/button>/);
  });
  test('기준 없음: 기준 정하기 · 기록 추가 불가 안내 · 지금 총자산 · 기록 안내', () => {
    const html = body(stateOf(feedOf({ baseline: null, entries: [], candidates: [] })));
    const t = textOf(html);
    expect(t).toContain('손익 기준이 아직 없습니다');
    expect(t).toContain('기준을 정하기 전에는 기록을 추가할 수 없습니다. 지금 총자산: 21,780,000원 (09-15 09:40 스냅샷)');
    expect(html).toContain('id="lg-nb-set"');
    expect(html).toContain('기록 안내 — 무엇을 넣고, 무엇을 넣지 않나요');
    expect(html).not.toContain('lg-add');
  });
  test('빈 상태: 기준만 — 손익 +420,000원 · "그대로 두어도 손익이 맞습니다" · 첫 기록 추가', () => {
    const html = body(stateOf(feedOf({ entries: [], candidates: [], snapshot: { ...SNAP, totalKrw: 20_420_000 } })));
    const t = textOf(html);
    expect(t).toContain('+420,000원');
    expect(t).toContain('+2.10%');
    expect(t).toContain('아직 기록이 없습니다기준(09-01 07:10) 뒤 계좌에 넣거나 뺀 돈이 없다면 그대로 두어도 손익이 맞습니다. 있었다면 기록하세요.');
    expect(html).toContain('id="lg-add2"');
    expect(t).toContain('마지막 기록없음아직 기록이 없습니다');
  });
  test('🔴 정상: 데모 수치 그대로 — 입출금 뺀 투자 손익 +830,000원 늘어남 · 수익률(근사) +3.99% · 기준부터 14일 · 공식 줄', () => {
    const html = body(stateOf(feedOf()));
    const t = textOf(html);
    expect(html).toMatch(/<span class="pl up">\+830,000원<\/span><span class="w">늘어남<\/span>/);
    // a11y Minor-2: 요약 숫자는 live 영역이 아니다(결과는 토스트가 읽는다)
    expect(html).toContain('<div class="sc-big"><span class="pl up">');
    expect(html).not.toContain('aria-atomic');
    expect(t).toContain('수익률(근사)+3.99%· 기준부터 14일');
    expect(t).toContain('현재 총자산 21,780,000원 − 기준 총자산 20,000,000원 − 순입금(넣은 돈 − 뺀 돈) 950,000원 = +830,000원');
    expect(t).toContain('기준일09-01 07:10스냅샷 #1001');
    expect(t).toContain('현금 확인됨');
    expect(t).toContain('현재 총자산21,780,000원09-15 09:40 스냅샷 · 15분 전');
    expect(t).toContain('순입금+950,000원넣은 돈 1,250,000원 · 뺀 돈 300,000원');
    expect(t).toContain('마지막 기록09-15 09:50입금 500,000원 · 반영 대기');
    expect(t).toContain('기록5건취소·정정 2건 별도');
    expect(html).not.toContain('ptag');
    expect(dupIds(html)).toEqual([]);
  });
  test('손익이 줄면 파랑(down) + 줄어듦 · 분모 ≤ 0 이면 계산 불가', () => {
    const f = feedOf({ entries: [], candidates: [], snapshot: { ...SNAP, totalKrw: 19_000_000 } });
    expect(body(stateOf(f))).toMatch(/<span class="pl down">−1,000,000원<\/span><span class="w">줄어듦<\/span>/);
    const g = { ...f, summary: { ...f.summary!, R: null } };
    expect(textOf(body(stateOf(g)))).toContain('수익률(근사)계산 불가');
  });
});

describe('기록 안 된 변화 카드 (데모 candHtml)', () => {
  test('열림: 시각·원화 +700,000원·보유 수량 변화 없음 · 섞여 있다는 경고 · [입금으로 기록] [입출금 아님] · 알림 기준(상수)', () => {
    const t = textOf(body(stateOf(feedOf())));
    expect(t).toContain('!기록 안 된 입출금 같은 변화 1건');
    expect(t).toContain('09-14 22:20 스냅샷 · 원화 현금 +700,000원직전 21:10 스냅샷 대비 · 보유 종목 수량 변화 없음');
    expect(t).toContain('입금이었다면 기록해 주세요. 기록하기 전까지 이 돈은 위 손익(+830,000원)에 투자로 번 돈처럼 섞여 있습니다.');
    expect(t).toContain('입금으로 기록');
    expect(t).toContain('알림 기준: 보유 수량이 그대로인데 원화 현금이 50,000원 이상, 또는 달러 현금이 $50 이상 바뀐 스냅샷. 매매·배당·이자일 수도 있어 자동으로 기록하지 않습니다.');
  });
  test('입출금 아님으로 표시한 변화: 사유 + 되돌리기 · 출금 후보는 "출금으로 기록"·"잃은"', () => {
    const t = textOf(body(stateOf(feedOf({ candidates: [{ ...CAND, state: 'dismissed', reason: '증권사 표시 차이(일시적)' }] }))));
    expect(t).toContain('입출금 아님으로 표시한 변화 1건 09-14 22:20 · 원화 +700,000원 · 사유: 증권사 표시 차이(일시적)');
    expect(t).toContain('되돌리기');
    const w = textOf(body(stateOf(feedOf({ candidates: [{ ...CAND, delta: -700_000, direction: 'withdrawal' }] }))));
    expect(w).toContain('출금으로 기록');
    expect(w).toContain('투자로 잃은 돈처럼');
  });
  test('🔴 P2-2: 열린 후보 2건 이상이면 카드 1장 — 제목 N건 · 줄마다 시각·통화 현금·두 버튼 · 섞임 문장과 알림 기준은 한 번', () => {
    const c2 = { ...CAND, key: '1341-USD', snapshotId: 1341, ts: '2026-09-14 23:30:00', currency: 'USD' as const, delta: 120 };
    const html = body(stateOf(feedOf({ candidates: [c2, CAND] })));
    const t = textOf(html);
    expect(html.match(/class="cand"/g)).toHaveLength(1);
    expect(t).toContain('!기록 안 된 입출금 같은 변화 2건');
    expect(t).not.toContain('변화 1건');
    expect(t).toContain('09-14 23:30 · 달러 현금 +$120.00');
    expect(t).toContain('09-14 22:20 · 원화 현금 +700,000원');
    expect(html.match(/입금으로 기록/g)).toHaveLength(2);
    expect(html.match(/섞여 있습니다/g)).toHaveLength(1);
    expect(html.match(/알림 기준:/g)).toHaveLength(1);
    // 2건 이상이면 '이 변화들은', 이유 문장은 목록 위(제목 바로 아래 — designer 델타 점검 2-1)
    expect(t).toContain('!기록 안 된 입출금 같은 변화 2건입금이었다면 기록해 주세요. 기록하기 전까지 이 변화들은 위 손익(+830,000원)에 투자로 번 돈처럼 섞여 있습니다.');
    expect(html.indexOf('섞여 있습니다')).toBeLessThan(html.indexOf('class="cand-rows"'));
    // 같은 이름의 버튼이 여러 개 — 줄 내용으로 구분(aria-describedby)
    expect(html).toContain('id="lg-cand-rec-1341-USD" aria-describedby="lg-cd-r-1341-USD"');
    expect(dupIds(html)).toEqual([]);
  });
  test('묶음에서 방향이 섞이면 "입금·출금이었다면 줄마다 … 투자로 번 돈·잃은 돈처럼" (designer 델타 점검 2-1)', () => {
    const w = { ...CAND, key: '1341-KRW', snapshotId: 1341, delta: -80_000, direction: 'withdrawal' as const };
    const t = textOf(body(stateOf(feedOf({ candidates: [w, CAND] }))));
    expect(t).toContain('입금·출금이었다면 줄마다 기록해 주세요. 기록하기 전까지 이 변화들은 위 손익(+830,000원)에 투자로 번 돈·잃은 돈처럼 섞여 있습니다.');
    expect(t).not.toContain('투자 손익처럼');
    expect(t).toContain('출금으로 기록');
  });
  test('🔴 P2-2: 입출금 아님 표시는 가장 최근 1건만 지금 모양, 2건째부터 접는다(건수 기준) · 테두리 중립', () => {
    const d = (k: string, ts: string, at: string) => ({ ...CAND, key: k, ts, state: 'dismissed' as const, reason: '증권사 표시 차이(일시적)', dismissedAt: at });
    const cands = [d('1300-KRW', '2026-09-10 10:00:00', '2026-09-12 08:00:00'), d('1310-KRW', '2026-09-11 10:00:00', '2026-09-14 08:00:00'), d('1320-KRW', '2026-09-12 10:00:00', '2026-09-13 08:00:00')];
    const html = body(stateOf(feedOf({ candidates: cands })));
    const top = html.indexOf('id="lg-cand-undo-1310-KRW"');   // 가장 최근에 표시한 것(09-14)
    const fold = html.indexOf('<details class="more">');
    expect(top).toBeGreaterThan(0);
    expect(fold).toBeGreaterThan(top);
    // 요약은 건수만, 펼치기 ▾ / 접기 ▴ 는 기록 안내와 같은 방식(::after, 기호는 대체 텍스트로 읽지 않음 — 델타 점검 2-2)
    expect(html).toContain('<summary>입출금 아님으로 표시한 변화 2건</summary>');
    expect(textOf(html)).not.toContain('더 보기');
    expect(LEDGER_CSS).toContain('.lg details.more summary::after { content: "펼치기 ▾"; content: "펼치기 ▾" / "펼치기";');
    expect(LEDGER_CSS).toContain('.lg details.more[open] summary::after { content: "접기 ▴"; content: "접기 ▴" / "접기"; }');
    expect(html.indexOf('id="lg-cand-undo-1300-KRW"')).toBeGreaterThan(fold);
    expect(html.indexOf('id="lg-cand-undo-1320-KRW"')).toBeGreaterThan(fold);
    expect(html.match(/class="cand done"/g)).toHaveLength(3);
    expect(LEDGER_CSS).toContain('.lg .cand.done { border: 1px dashed var(--border2); background: none; }');
    // 1건이면 접지 않는다
    expect(body(stateOf(feedOf({ candidates: [cands[0]] })))).not.toContain('details class="more"');
  });
  test('열린 후보와 표시한 후보가 함께면 열린 카드가 먼저 · arrangeCandidates', () => {
    const dis = { ...CAND, key: '1300-KRW', state: 'dismissed' as const, reason: 'x', dismissedAt: '2026-09-12 08:00:00' };
    const a = arrangeCandidates([dis, CAND]);
    expect(a.open.map((c) => c.key)).toEqual(['1340-KRW']);
    expect(a.dismissedTop?.key).toBe('1300-KRW');
    expect(a.dismissedRest).toEqual([]);
    const html = body(stateOf(feedOf({ candidates: [dis, CAND] })));
    expect(html.indexOf('id="lg-cand-rec-1340-KRW"')).toBeLessThan(html.indexOf('id="lg-cand-undo-1300-KRW"'));
  });
  test('P2-6: 스냅샷 읽기가 잘렸으면 후보 아래 muted 한 줄', () => {
    const f = { ...feedOf(), scanTruncated: true };
    expect(body(stateOf(f))).toContain('<p class="muted scan-note">스냅샷이 많아 최근 것만 대조했습니다 — 그보다 오래된 기록 안 된 변화는 여기 보이지 않을 수 있습니다.</p>');
    expect(body(stateOf(feedOf()))).not.toContain('scan-note');
  });
});

describe('신뢰도 표지 (데모 signalsHtml)', () => {
  test('반영 대기 n건 · 금액 · "지금 손익에는 빠져 있습니다"', () => {
    expect(textOf(body(stateOf(feedOf())))).toContain('반영 대기 1건 · +500,000원 — 다음 스냅샷(보통 1시간 안)에서 맞는 현금 변화가 보이면 계산에 넣습니다. 지금 손익에는 빠져 있습니다.');
  });
  test('기준 미확정: 임시 표지 + 경고 + 기준 현금 확인 버튼', () => {
    const html = body(stateOf(feedOf({ baseline: BASE_UNCONFIRMED })));
    const t = textOf(html);
    expect(html).toContain('<span class="ptag">임시 · 기준 미확정</span>');
    expect(t).toContain('! 기준 미확정 — 기준 시각의 현금을 아직 확인하지 않아, 지금 손익은 스냅샷 값으로 낸 임시 계산입니다.');
    expect(t).toContain('현금 미확정 — 스냅샷 값');
    expect(html).toContain('id="lg-sig-base"');
  });
  test('스냅샷 오래됨: "현재 총자산이 3시간 20분 전(09-15 07:10) 스냅샷 값입니다" · 3시간 기준(상수)', () => {
    const t = textOf(body(stateOf(feedOf({ snapshot: { ...SNAP, id: 1338, ts: '2026-09-15 07:10:00', stale: true, ageMin: 200 } }))));
    expect(t).toContain('! 현재 총자산이 3시간 20분 전(09-15 07:10) 스냅샷 값입니다. 그 뒤 변화는 아직 손익에 없습니다. 스냅샷은 보통 1시간마다 생기고, 3시간이 넘으면 이 표시가 뜹니다.');
  });
  test('밤 스냅샷: 달러 현금 약 $250.00 빠져 보임(16~06시) · 약 312,500원 작게', () => {
    const t = textOf(body(stateOf(feedOf({ snapshot: { ...SNAP, ts: '2026-09-15 02:40:00', usdGapHint: { usd: 250, krw: 312_500, sinceTs: '2026-09-14 16:40:00' } } }))));
    expect(t).toContain('! 이 시각(02:40) 스냅샷은 달러 현금 약 $250.00이 빠져 보이는 시간대입니다(16~06시). 손익이 약 312,500원 작게 보일 수 있습니다. 아침 07~09시 값과 비교하세요.');
  });
  test('불일치 n건 + 기록 보기 · 환전 불일치는 표지에 넣지 않는다(P2-2)', () => {
    const es = seed().map((e) => (e.id === 6 ? { ...e, anchor: { ...e.anchor, status: 'unmatched' as const, detail: '이 시각 뒤 스냅샷에서 달러 +$200.00 변화를 찾지 못했습니다.' } } : e));
    const html = body(stateOf(feedOf({ entries: es })));
    expect(textOf(html)).toContain('! 불일치 1건 — 기록한 금액과 맞는 현금 변화를 스냅샷에서 찾지 못했습니다. 기록대로 계산에 넣었으니 금액·시각을 확인하세요. #6 기록 보기');
    const ex = seed().map((e) => (e.id === 3 ? { ...e, anchor: { ...e.anchor, status: 'unmatched' as const } } : e));
    const h2 = body(stateOf(feedOf({ entries: ex })));
    expect(textOf(h2)).not.toContain('불일치');
    expect(textOf(h2)).toContain('확인 전');
  });
  test('표지가 없으면 .sigs 를 그리지 않는다', () => {
    const f = feedOf({ entries: seed().filter((e) => e.id !== 7) });
    expect(body(stateOf(f))).not.toContain('class="sigs"');
  });
});

describe('기록 목록·표 (데모 listHtml)', () => {
  test('🔴 행 버튼: 펼침(aria-expanded·aria-controls) · 접근 이름 짧게(Minor-1) · 금액 중립색(+/− 부호, 손익 색 없음)', () => {
    const html = body(stateOf(feedOf()));
    expect(html).toContain('<button type="button" class="erow-h" id="lg-eh-1" aria-expanded="false" aria-controls="lg-ed-1" aria-label="#1 입금 1,000,000원, 09-03 10:00, 반영됨">');
    expect(html).toContain('aria-label="#5 출금 300,000원, 09-10 14:00, 반영됨"');
    // a11y Minor-4: 목록 이름은 고정(머리 "기록 n건"은 취소·정정 보기 때 항목 수와 다르다)
    expect(html).toContain('<ul class="elist only-m" aria-label="입출금 기록 목록">');
    expect(html).toMatch(/<span class="a">\+1,000,000원<\/span>/);
    expect(html).not.toMatch(/<span class="a"[^>]*class="pl/);
    expect(html).toContain('<div class="erow-d" id="lg-ed-1" hidden="">');
  });
  test('기본은 살아 있는 기록만(5건) · 취소·정정 2건 보기 토글 · 보기면 7건 + 취소선 행', () => {
    const html = body(stateOf(feedOf()));
    expect(html.match(/class="erow"/g)).toHaveLength(5);
    expect(textOf(html)).toContain('기록 5건');
    expect(html).toContain('id="lg-tgl">취소·정정된 기록 2건 보기</button>');
    const all = body(stateOf(feedOf()), { showVoid: true });
    expect(all.match(/class="erow( void)?"/g)).toHaveLength(7);
    expect(all).toContain('class="tgl on" id="lg-tgl">취소·정정된 기록 2건 숨기기');
    expect(all).toContain('aria-label="#4 출금 3,000,000원, 09-10 14:00, 정정됨 → #5"');
  });
  test('🔴 펼친 상세는 목록·표 양쪽에 그려도 id 가 겹치지 않는다(lg- / lgt-)', () => {
    const html = body(stateOf(feedOf()), { open: { 1: true, 3: true, 5: true, 6: true }, showVoid: true });
    expect(html).toContain('id="lg-ac-1-cor"');
    expect(html).toContain('id="lgt-ac-1-cor"');
    expect(html).toContain('id="lgt-eh-1"');
    expect(dupIds(html)).toEqual([]);
  });
  test('상세(데모 entryDetail): 발생·기록 시각 · 반영 근거 · 환율·비용(추정) · 원화 환산 · 동작', () => {
    const t = textOf(body(stateOf(feedOf()), { open: { 1: true, 3: true, 6: true, 7: true } }));
    expect(t).toContain('발생 시각2026-09-03 10:00 (KST)기록한 시각09-03 10:05반영09-03 10:40 스냅샷 · 원화 현금 +1,000,000원 확인 (허용 ±1,000원)메모월급 일부');
    expect(t).toContain('적용 1,260.00원/$ · 앱 환율 1,256.20 대비 +0.30% · 비용(추정) 3,800원추정: 기준 = 앱 환율(스냅샷), KIS 고시환율 아님. 계좌 안 이동이라 순입금·손익에 넣지 않습니다.');
    expect(t).toContain('원화 환산250,000원 — 반영된 스냅샷의 환율 1,250.00원/$');
    expect(t).toContain('최신 스냅샷(09-15 09:40)보다 뒤라 다음 스냅샷을 기다립니다. 지금 손익에는 빠져 있습니다.');
    expect(t).toContain('정정하기');
    expect(t).toContain('기록 취소');
  });
  test('취소된 기록 = 되살리기 · 정정된 기록 = 되살리지 않는다는 안내 · 환전으로 정정 제안', () => {
    const es = seed().map((e) => (e.id === 6 ? { ...e, anchor: { status: 'unmatched' as const, snapshotId: null, snapshotTs: null, detail: '같은 스냅샷에서 원화가 250,600원 줄었습니다 — 환전이었다면 환전으로 정정하세요.', suggest: { kind: 'exchange' as const, snapshotId: 1, snapshotTs: '2026-09-12 22:00:00', krwDelta: -250_600, usdDelta: 200 } } } : e));
    const html = body(stateOf(feedOf({ entries: es })), { open: { 2: true, 4: true, 6: true }, showVoid: true });
    const t = textOf(html);
    expect(html).toContain('id="lg-ac-2-res">되살리기');
    expect(t).toContain('취소중복 입력 · 09-03 10:12');
    expect(t).toContain('정정으로 대체된 기록은 되살리지 않습니다. 바꾸려면 새 기록 #5 를 정정하세요.');
    expect(t).toContain('정정됨자릿수 잘못 입력 · 09-10 15:02 · 새 기록 #5');
    expect(html).toContain('id="lg-ac-6-cx">환전으로 정정');
    expect(t).toContain('!불일치 같은 스냅샷에서 원화가 250,600원 줄었습니다 — 환전이었다면 환전으로 정정하세요. 기록대로 계산에 넣었습니다.');
  });
  test('표(≥900px): caption · 8열 머리 · 행 버튼 aria-label "#n 기록 자세히"', () => {
    const html = body(stateOf(feedOf()));
    expect(html).toContain('<caption class="sr">입출금 기록 목록</caption>');
    expect(html.match(/<th scope="col"/g)).toHaveLength(8);
    expect(html).toContain('aria-label="#1 기록 자세히"');
    expect(html).toContain('<tr class="dt" id="lgt-ed-1" hidden="">');
  });
  test('모든 기록이 취소·정정됨 → "살아 있는 기록이 없습니다"', () => {
    const es = [entry({ id: 1, kind: 'deposit', occurredAt: '2026-09-03 10:00', currency: 'KRW', amount: 1, void: { type: 'cancel', reason: 'x', at: '2026-09-03 10:12:00', byUserId: 1, by: null } })];
    const t = textOf(body(stateOf(feedOf({ entries: es, candidates: [] }))));
    expect(t).toContain('살아 있는 기록이 없습니다모든 기록이 취소·정정됐습니다. 위 버튼으로 이력을 볼 수 있습니다.');
  });
});

describe('손익 기준 카드 · 기록 안내', () => {
  test('확인값 ✓ · 미확정이면 ! 스냅샷 값 · 환율 · 버전 · 두 버튼', () => {
    const t = textOf(body(stateOf(feedOf())));
    expect(t).toContain('손익 기준버전 3');
    expect(t).toContain('기준 시각2026-09-01 07:10 (스냅샷 #1001)기준 총자산20,000,000원원화 현금1,200,000원 ✓확인달러 현금$1,500.00 ✓확인 (외화예수금)환율1,240.00원/$ (그 스냅샷의 앱 환율)');
    const u = textOf(body(stateOf(feedOf({ baseline: BASE_UNCONFIRMED }))));
    expect(u).toContain('원화 현금1,200,000원 !스냅샷 값달러 현금$1,500.00 !스냅샷 값');
  });
  test('달러 현금 행이 없는 기준이면 달러·환율 줄을 그리지 않는다', () => {
    const t = textOf(body(stateOf(feedOf({ baseline: { ...BASE_UNCONFIRMED, usdCash: null, fx: null } }))));
    expect(t).not.toContain('달러 현금$');
    expect(t).not.toContain('그 스냅샷의 앱 환율');
  });
  test('기록 안내 6줄(36시간 상수 · 외화예수금)', () => {
    const t = textOf(body(stateOf(feedOf())));
    expect(t).toContain('시각을 모르면 조금 이르게: 그 시각 뒤 36시간 안 스냅샷에서 맞는 현금 변화를 찾습니다.');
    expect(t).toContain('달러 현금: 이 앱은 KIS 앱의 ‘외화예수금’ 기준입니다. ‘주문가능금액’은 아직 체결되지 않은 주문에 묶인 돈이 빠져 더 작게 보일 수 있습니다.');
  });
});

// ─── 시트 ─────────────────────────────────────────────────────────────────

const NOW = parseKstWall('2026-09-15 09:55')!;
const realNow = Date.now;
beforeAll(() => { Date.now = () => Date.UTC(2026, 8, 15, 0, 55); });   // = KST 2026-09-15 09:55
afterAll(() => { Date.now = realNow; });

function entrySheet(feed: LedgerFeed, d = newDraft('new', NOW, {}, 'cid-test-0001'), initialState?: Parameters<typeof EntrySheet>[0]['initialState'], restored = false) {
  return renderToStaticMarkup(h(EntrySheet, { ...sheetCommon, onStale: noop, feed, initial: d, restored, initialState }));
}

describe('기록 추가 시트 — 폼 (데모 entryForm)', () => {
  test('대화상자 · 제목 · 종류 라디오(부호 입력 없음) · 날짜 min=기준일 max=오늘 · 시각 step 60 · 금액 inputmode', () => {
    const html = entrySheet(feedOf());
    expect(html).toContain('role="dialog"');
    expect(html).toContain('<h2 id="sh-t" tabindex="-1">입출금 기록 추가</h2>');
    expect(html).toMatch(/id="sh-k-dep" checked="" value="deposit"/);
    expect(textOf(html)).toContain('환전원화↔달러 · 손익 영향 없음');
    expect(html).toMatch(/type="date" id="sh-date" min="2026-09-01" max="2026-09-15"[^>]*value="2026-09-15"/);
    expect(html).toMatch(/type="time" id="sh-time" step="60"[^>]*value="09:55"/);
    expect(html).toMatch(/id="sh-amt" type="text" inputMode="numeric"/i);
    expect(html).toContain('aria-describedby="sh-amt-r sh-amt-m"');
    expect(textOf(html)).toContain('기준 09-01 07:10 뒤만 기록합니다. KIS 거래내역의 시각을 넣고, 모르면 조금 이르게 넣으세요.');
    expect(textOf(html)).toContain('배당·이자·수수료는 투자 손익이라 여기 기록하지 않습니다.');
    // 빈 금액: 빨간 오류는 아직 안 보이고, 확인하기는 비활성 + 이유
    expect(html).not.toContain('class="inwrap bad"');
    expect(html).toMatch(/id="sh-next" disabled="" aria-describedby="sh-why">확인하기/);
    expect(textOf(html)).toContain('채우거나 고칠 곳 1곳 — 금액');
  });
  test('🔴 기준 시각 이전 날짜 → 차단 상자(role=alert) · aria-invalid · 확인하기 비활성 · 이유 문장', () => {
    const html = entrySheet(feedOf(), newDraft('new', NOW, { date: '2026-08-30', time: '15:00', amt: '2000000' }, 'cid-x-0001'));
    const t = textOf(html);
    expect(html).toContain('class="blockbox" role="alert"');
    expect(t).toContain('! 기준 시각(09-01 07:10) 이전이라 기록할 수 없습니다.그 전에 넣고 뺀 돈은 기준 총자산 20,000,000원에 이미 들어 있습니다. 여기 다시 넣으면 같은 돈을 두 번 빼게 되어 손익이 그만큼 틀어집니다.더 이른 때부터 세고 싶다면 화면 아래 ‘손익 기준’에서 기준을 바꾸세요.');
    expect(html).toMatch(/id="sh-date"[^>]*aria-invalid="true" value="2026-08-30"/);
    expect(html).toMatch(/id="sh-next" disabled=""/);
    expect(t).toContain('기준 시각 이전 날짜는 기록할 수 없습니다.');
  });
  test('금액 만 단위 읽기 · 큰 금액 경고 · 부호 오류', () => {
    const t = textOf(entrySheet(feedOf(), newDraft('new', NOW, { kind: 'withdrawal', amt: '20000000' }, 'cid-x-0001')));
    expect(t).toContain('= 20,000,000원 · 2,000만원');
    expect(t).toContain('현재 총자산(21,780,000원)의 절반이 넘는 금액입니다. 자릿수와 통화(원·달러)를 확인하세요.');
    const s = entrySheet(feedOf(), newDraft('new', NOW, { amt: '-5' }, 'cid-x-0001'));
    expect(s).toContain('class="inwrap bad"');
    expect(s).toMatch(/id="sh-amt"[^>]*aria-invalid="true"/);
    expect(textOf(s)).toContain('부호는 넣지 않습니다. 나간 돈이면 위에서 종류를 ‘출금’으로 고르세요.');
  });
  test('달러: = $200.00 · 참고 ≈ 250,000원(앱 환율 1,250.00, 반영되면 그 시각 환율로 다시 환산)', () => {
    const t = textOf(entrySheet(feedOf(), newDraft('new', NOW, { ccy: 'USD', amt: '200' }, 'cid-x-0001')));
    expect(t).toContain('= $200.00 · 참고 ≈ 250,000원(앱 환율 1,250.00, 반영되면 그 시각 환율로 다시 환산)');
  });
  test('환전: 방향 · 낸/받은 금액 · 적용 환율·앱 환율 대비·비용(추정) · 손익 영향 없음 안내', () => {
    const t = textOf(entrySheet(feedOf(), newDraft('new', NOW, { kind: 'exchange', dir: 'ku', from: '1300000', to: '1032.50', time: '09:25' }, 'cid-x-0001')));
    expect(t).toContain('원화 → 달러달러 → 원화');
    expect(t).toContain('낸 원화');
    expect(t).toContain('받은 달러');
    expect(t).toContain('적용 환율 1,259.08원/$ (원화 ÷ 달러)앱 환율 1,250.00원/$ 대비 +0.73% · 환전 비용(추정) 약 9,375원추정: 기준 = 앱 환율(최신 스냅샷), KIS 고시환율 아님.');
    expect(t).toContain('환전은 계좌 안 이동이라 순입금·손익에 넣지 않습니다. 기록하지 않아도 손익은 맞고, 기록하면 환전 비용(추정)을 볼 수 있습니다.');
  });
  test('후보에서 연 폼 · 정정 폼 · 🔴 다시 연 초안 "이어서 씁니다"', () => {
    const c = textOf(entrySheet(feedOf(), newDraft('cand', NOW, { amt: '700000', date: '2026-09-14', time: '22:20', candKey: CAND.key }, 'cid-x-0001')));
    expect(c).toContain('09-14 22:20 스냅샷의 원화 +700,000원 변화로 채웠습니다. 실제와 다르면 고치세요. 시각은 직전 스냅샷(21:10)과 이 스냅샷 사이면 됩니다.');
    const k = entrySheet(feedOf(), newDraft('correct', NOW, { target: 5, kind: 'withdrawal', amt: '30000', date: '2026-09-10', time: '14:00' }, 'cid-x-0001'));
    expect(k).toContain('<h2 id="sh-t" tabindex="-1">기록 정정 — #5</h2>');
    expect(textOf(k)).toContain('원래 기록 #5 출금 300,000원은 지우지 않고 ‘정정됨’으로 남깁니다. 아래 새 기록이 대신 계산에 들어갑니다.');
    const r = entrySheet(feedOf(), newDraft('new', NOW, { amt: '123' }, 'cid-x-0001'), undefined, true);
    expect(r).toContain('class="infobox" role="status"');
    expect(textOf(r)).toContain('닫기 전에 쓰던 내용을 이어서 씁니다.');
  });
});

describe('기록 추가 시트 — 확인 단계 (데모 entryConfirm)', () => {
  const cand = newDraft('cand', NOW, { amt: '700000', date: '2026-09-14', time: '22:20', candKey: CAND.key }, 'cid-x-0001');
  test('🔴 "들어온" 문장 · 만 단위 · 바로 반영 · 손익 전→후 +830,000원 → +130,000원 · 두 번 눌러도 한 번', () => {
    const html = entrySheet(feedOf(), cand, { step: 'confirm' });
    const t = textOf(html);
    expect(html).toContain('<h2 id="sh-t" tabindex="-1">기록 확인</h2>');
    expect(t).toContain('계좌에 700,000원(70만원)이 들어온 것으로 기록합니다.');
    expect(t).toContain('총자산이 이만큼 늘어난 것은 투자로 번 돈으로 보지 않고 손익에서 뺍니다.');
    expect(t).toContain('바로 반영 — 09-14 22:20 스냅샷의 변화와 맞습니다.순입금 950,000원 → 1,650,000원 · 입출금 뺀 손익 +830,000원 → +130,000원');
    expect(t).toContain('‘기록하기’를 두 번 눌러도 한 번만 기록됩니다.');
    expect(html).toMatch(/id="sh-primary">기록하기<\/button>/);
  });
  test('출금 "빠져나간" · 반영 대기 · 불일치 예측 문장', () => {
    const w = textOf(entrySheet(feedOf(), newDraft('new', NOW, { kind: 'withdrawal', amt: '100000', time: '09:50' }, 'c-x-00001'), { step: 'confirm' }));
    expect(w).toContain('계좌에서 100,000원(10만원)이 빠져나간 것으로 기록합니다.');
    expect(w).toContain('반영 대기 — 최신 스냅샷(09-15 09:40)보다 뒤라 다음 스냅샷을 기다립니다. 반영되면 총자산도 같이 바뀌어 손익은 거의 그대로입니다.');
    const u = textOf(entrySheet(feedOf(), newDraft('new', NOW, { amt: '123456', date: '2026-09-10', time: '09:00' }, 'c-x-00001'), { step: 'confirm' }));
    expect(u).toContain('스냅샷과 맞춰 봅니다 — 맞는 현금 변화를 찾지 못하면 ‘불일치’로 표시하고 기록대로 계산에 넣습니다.그 경우 순입금 950,000원 → 1,073,456원');
  });
  test('🔴 저장 중: 두 버튼 비활성 · aria-busy · 닫기 비활성', () => {
    const html = entrySheet(feedOf(), cand, { step: 'confirm', saving: true });
    expect(html).toMatch(/<button type="button" class="btn sec" disabled="">‹ 고치기<\/button><button type="button" class="btn pri" id="sh-primary" disabled="" aria-busy="true">기록 중…<\/button>/);
    expect(html).toMatch(/class="sh-x" disabled=""/);
  });
  test('🔴 실패(500): 오류 상자 role=alert · 입력 유지 · "다시 눌러도 두 번 기록되지 않습니다" · 다시 시도', () => {
    const dec = decideEntryOutcome(classifyWrite(500, { ok: false, code: 'server_error', retrySafe: true }, false), { correct: false, target: null, beforeP: 830_000 });
    expect(dec.type).toBe('err');
    const err = (dec as { err: SheetErr }).err;
    expect(err.kind).toBe('fail');
    const html = entrySheet(feedOf(), cand, { step: 'confirm', err });
    expect(html).toContain('class="errbox" role="alert"');
    expect(textOf(html)).toContain('저장하지 못했습니다 — 서버 응답 500입력한 내용은 그대로 있습니다. 다시 눌러도 두 번 기록되지 않습니다.');
    expect(html).toMatch(/id="sh-primary">다시 시도<\/button>/);
  });
  test('🔴 충돌 409 baseline_version: 새 기준으로 기록하기 · 다시 보낼 때 최신 버전 · 같은 clientEntryId', () => {
    const dec = decideEntryOutcome(classifyWrite(409, { ok: false, code: 'baseline_version', latest: { version: 4 } }, false), { correct: false, target: null, beforeP: 830_000 });
    expect(dec).toMatchObject({ type: 'err', refresh: true, feed: null, err: { kind: 'conflict', latestVersion: 4 } });
    const err = (dec as { err: SheetErr }).err;
    const html = entrySheet(feedOf(), cand, { step: 'confirm', err });
    expect(textOf(html)).toContain('기록하지 않았습니다 — 다른 기기에서 기준이 먼저 바뀌었습니다(버전 4)입력은 그대로 있습니다. 새 기준으로 아래 내용을 다시 확인한 뒤 기록하세요.');
    expect(html).toMatch(/id="sh-back">‹ 고치기<\/button><button type="button" class="btn pri" id="sh-primary">새 기준으로 기록하기/);
    const first = entryRequest(cand, feedOf(), null)!;
    const retry = entryRequest(cand, feedOf(), err)!;
    expect(first.body.baseVersion).toBe(3);
    expect(retry.body.baseVersion).toBe(4);
    expect(retry.body.clientEntryId).toBe(first.body.clientEntryId);
    expect(first.url).toBe('/api/cash-ledger/entries');
  });
  test('🔴 중복 409 duplicate: "(#5)" · 같은 돈이면 더 넣지 않아도 됩니다 · [‹ 고치기] [목록으로]', () => {
    const dec = decideEntryOutcome(classifyWrite(409, { ok: false, code: 'duplicate', existingId: 5 }, false), { correct: false, target: null, beforeP: 0 });
    const err = (dec as { err: SheetErr }).err;
    expect(err.kind).toBe('dup');
    const html = entrySheet(feedOf(), cand, { step: 'confirm', err });
    expect(textOf(html)).toContain('기록하지 않았습니다 — 같은 종류·통화·금액·시각(분)의 기록이 이미 있습니다(#5)같은 돈이면 더 넣지 않아도 됩니다. 다른 돈이면 시각을 1분 이상 다르게 넣으세요.');
    expect(html).toMatch(/id="sh-primary">목록으로<\/button>/);
  });
  test('정정 중 409 already_voided → 최신 목록(data) · "다른 기기에서 먼저 취소됐습니다" · [닫고 최신 목록 보기]', () => {
    const f = feedOf();
    const dec = decideEntryOutcome(classifyWrite(409, { ok: false, code: 'already_voided', data: f }, false), { correct: true, target: 5, beforeP: 0 });
    expect(dec).toMatchObject({ type: 'err', feed: f, refresh: false, err: { kind: 'conflictClose' } });
    const err = (dec as { err: SheetErr }).err;
    const k = newDraft('correct', NOW, { target: 5, kind: 'withdrawal', amt: '30000', date: '2026-09-10', time: '14:00' }, 'cid-x-0001');
    const html = entrySheet(f, k, { step: 'confirm', err });
    expect(textOf(html)).toContain('정정하지 않았습니다 — 이 기록(#5)은 다른 기기에서 먼저 취소됐습니다최신 목록을 불러왔습니다. 필요하면 되살리거나 새로 기록하세요.');
    expect(html).toMatch(/<div class="btns"><button type="button" class="btn pri" id="sh-primary">닫고 최신 목록 보기<\/button><\/div>/);
    expect(textOf(html)).toContain('대체할 기록#5 출금 300,000원 → ‘정정됨’으로 남김');
    expect(entryRequest(k, f, null)!.url).toBe('/api/cash-ledger/entries/5/correct');
  });
  test('성공 토스트(데모 success): 반영됨 · 반영 대기 · 불일치 · 환전 확인 전', () => {
    const f = feedOf();
    const ok = (status: 'matched' | 'pending' | 'unmatched', kind: 'deposit' | 'exchange' = 'deposit', P = 130_000) => decideEntryOutcome(
      { kind: 'ok', body: { ok: true, data: { ...f, summary: { ...f.summary!, P } }, entry: { ...seed()[0], id: 8, kind, anchor: { status, snapshotId: 1, snapshotTs: '2026-09-14 22:20:00', detail: null, suggest: null } }, warnings: [], replayed: false, candidateResolved: true } },
      { correct: false, target: null, beforeP: 830_000 },
    );
    const t = (d: ReturnType<typeof ok>) => textOf(node((d as { toast: ReactNS.ReactNode }).toast));
    expect(t(ok('matched'))).toBe('✓기록했습니다 (#8) 09-14 22:20 스냅샷과 맞아 바로 반영했습니다. 손익 +830,000원 → +130,000원');
    expect(t(ok('pending', 'deposit', 830_000))).toBe('✓기록했습니다 (#8) 다음 스냅샷에서 반영 여부를 확인합니다.');
    expect(t(ok('unmatched'))).toBe('✓기록했습니다 (#8) 맞는 현금 변화를 찾지 못해 ‘불일치’로 표시했고, 기록대로 계산에 넣었습니다. 손익 +830,000원 → +130,000원');
    expect(t(ok('unmatched', 'exchange'))).toBe('✓기록했습니다 (#8) 맞는 스냅샷 변화를 찾지 못해 ‘확인 전’으로 표시했습니다(손익 영향 없음).');
  });
  test('🔴 M1: 409 client_entry_conflict → "stale" — 시트를 닫고 최신 목록·저장된 기록 id·경고 토스트(같은 입력을 새 번호로 다시 보내지 않음)', () => {
    const f = feedOf();
    const dec = decideEntryOutcome(classifyWrite(409, { ok: false, code: 'client_entry_conflict', error: 'x', existingId: 5, data: f }, false), { correct: false, target: null, beforeP: 0 });
    expect(dec).toMatchObject({ type: 'stale', data: f, existingId: 5 });
    expect(textOf(node((dec as { toast: ReactNS.ReactNode }).toast))).toBe('!방금 고친 값은 저장되지 않았습니다. 먼저 보낸 내용이 이미 #5로 저장되어 있어 펼쳐 두었습니다. 다르면 정정해 주세요.');
    const noData = decideEntryOutcome(classifyWrite(409, { ok: false, code: 'client_entry_conflict', error: 'x' }, false), { correct: true, target: 3, beforeP: 0 });
    expect(noData).toMatchObject({ type: 'stale', data: null, existingId: null });
  });
  test('네트워크·시간 초과·422 도 입력 유지 실패', () => {
    for (const out of [classifyWrite<EntryWriteResponse>(0, null, false), classifyWrite<EntryWriteResponse>(0, null, true), classifyWrite<EntryWriteResponse>(422, { ok: false, code: 'validation', error: '아직 오지 않은 시각입니다.' }, false)]) {
      const dec = decideEntryOutcome(out, { correct: false, target: null, beforeP: 0 });
      expect(dec).toMatchObject({ type: 'err', feed: null, refresh: false, err: { kind: 'fail' } });
    }
  });
});

describe('기록 취소·되살리기·입출금 아님 시트', () => {
  const f = feedOf();
  const e5 = f.entries.find((e) => e.id === 5)!;
  const e2 = f.entries.find((e) => e.id === 2)!;
  test('취소: 기록 요약 · 손익 전→후 · 사유 필수(비활성 + 이유) · 지우지 않는다', () => {
    const html = renderToStaticMarkup(h(CancelSheet, { ...sheetCommon, feed: f, entry: e5 }));
    const t = textOf(html);
    expect(html).toContain('<h2 id="sh-t" tabindex="-1">기록 취소 — #5</h2>');
    expect(t).toContain('#5출금 300,000원09-10 14:00 · 원화 · 카드값');
    expect(t).toContain('취소하면 계산에서 빠집니다: 순입금 950,000원 → 1,250,000원 · 입출금 뺀 손익 +830,000원 → +530,000원');
    expect(t).toContain('잘못 입력중복 입력기타');
    expect(html).toMatch(/class="btn warnline" id="sh-primary" disabled="" aria-describedby="sh-why">취소로 표시/);
    expect(t).toContain('취소 사유를 골라 주세요.');
    expect(t).toContain('지우지 않습니다. 목록에 ‘취소됨’으로 남고 사유·시각이 함께 기록되며, 언제든 되살릴 수 있습니다.');
    const etc = renderToStaticMarkup(h(CancelSheet, { ...sheetCommon, feed: f, entry: e5, initialState: { reason: '기타' } }));
    expect(etc).toContain('id="sh-etc"');
    expect(textOf(etc)).toContain('사유를 적어 주세요.');
    const ready = renderToStaticMarkup(h(CancelSheet, { ...sheetCommon, feed: f, entry: e5, initialState: { reason: '잘못 입력' } }));
    expect(ready).toMatch(/id="sh-primary">취소로 표시/);
  });
  test('취소 영향 문장: 환전 · 반영 대기 · 기준 이전', () => {
    expect(cancelImpact(f.entries.find((e) => e.id === 3)!, f)).toBe('환전 기록이라 손익 숫자는 바뀌지 않습니다.');
    expect(cancelImpact(f.entries.find((e) => e.id === 7)!, f)).toBe('반영 대기 중인 기록이라 지금 손익은 바뀌지 않습니다(다음 스냅샷 뒤에도 계산에 넣지 않습니다).');
    expect(cancelImpact({ ...e5, beforeBaseline: true }, f)).toBe('기준 이전 기록이라 손익 숫자는 바뀌지 않습니다.');
  });
  test('🔴 취소 충돌 409 already_voided → 최신 데이터 교체 · 닫기만 · 저장 중 "표시 중…"', () => {
    const dec = decideCancelOutcome(classifyWrite(409, { ok: false, code: 'already_voided', data: f }, false), { id: 5, beforeP: 830_000 });
    expect(dec).toMatchObject({ type: 'err', feed: f, err: { kind: 'conflictClose' } });
    const html = renderToStaticMarkup(h(CancelSheet, { ...sheetCommon, feed: f, entry: e5, initialState: { reason: '잘못 입력', err: (dec as { err: SheetErr }).err } }));
    expect(textOf(html)).toContain('표시하지 않았습니다 — 이 기록(#5)은 다른 기기에서 먼저 취소됐습니다최신 목록을 불러왔습니다. 필요하면 되살리거나 새로 기록하세요.');
    expect(html).toContain('닫고 최신 목록 보기');
    const busy = renderToStaticMarkup(h(CancelSheet, { ...sheetCommon, feed: f, entry: e5, initialState: { reason: '잘못 입력', saving: true } }));
    expect(busy).toContain('aria-busy="true">표시 중…');
    expect(busy).toMatch(/id="sh-r-0" disabled="" checked="" value="잘못 입력"/);
  });
  test('취소 성공 토스트: 손익 바뀜 / 변화 없음', () => {
    const ok = (P: number) => decideCancelOutcome({ kind: 'ok', body: { ok: true, data: { ...f, summary: { ...f.summary!, P } }, entry: e5 } }, { id: 5, beforeP: 830_000 });
    expect(textOf(node((ok(530_000) as { toast: ReactNS.ReactNode }).toast))).toBe('✓#5 을 취소로 표시했습니다 손익 +830,000원 → +530,000원');
    expect(textOf(node((ok(830_000) as { toast: ReactNS.ReactNode }).toast))).toBe('✓#5 을 취소로 표시했습니다 손익 변화 없음');
  });
  test('되살리기: 취소 사유 · 손익 전→후 · 중복 주의 · 충돌(not_voided·superseded·duplicate)', () => {
    // 데모 SEED #2 는 '반영 대기'였던 채 취소돼 '지금 손익 숫자는 바뀌지 않습니다'(데모와 같음) — 반영됐던 기록을 취소한 경우로 본다
    expect(restoreImpact(e2, f)).toBe('지금 손익 숫자는 바뀌지 않습니다.');
    const e2m = { ...e2, anchor: { status: 'matched' as const, snapshotId: 1, snapshotTs: '2026-09-03 10:40:00', detail: 'x', suggest: null } };
    const f2 = { ...f, entries: f.entries.map((x) => (x.id === 2 ? e2m : x)) };
    const html = renderToStaticMarkup(h(RestoreSheet, { ...sheetCommon, feed: f2, entry: e2m }));
    const t = textOf(html);
    expect(t).toContain('취소 사유: 중복 입력');
    expect(t).toContain('되살리면 다시 계산에 들어갑니다: 입출금 뺀 손익 +830,000원 → −170,000원');
    expect(t).toContain('같은 돈이 다른 기록으로 이미 들어가 있지 않은지 확인하세요(중복이면 두 번 빠집니다).');
    expect(restoreImpact(f.entries.find((e) => e.id === 3)!, f)).toBe('지금 손익 숫자는 바뀌지 않습니다.');
    const nv = decideRestoreOutcome(classifyWrite(409, { ok: false, code: 'not_voided', data: f }, false), { id: 2, beforeP: 0 });
    expect(textOf(node((nv as { err: SheetErr }).err.node))).toBe('!이미 다른 기기에서 되살렸습니다최신 목록을 불러왔습니다. 두 번 되살아나지 않습니다.');
    const sup = decideRestoreOutcome(classifyWrite(409, { ok: false, code: 'superseded', error: '정정으로 대체된 기록은 되살리지 않습니다 — 바꾸려면 새 기록 #5 를 정정하세요', existingId: 5 }, false), { id: 4, beforeP: 0 });
    expect(sup).toMatchObject({ type: 'err', refresh: true, err: { kind: 'conflictClose' } });
    const dup = decideRestoreOutcome(classifyWrite(409, { ok: false, code: 'duplicate', error: '되살리지 않았습니다 — 같은 …', existingId: 1 }, false), { id: 2, beforeP: 0 });
    expect(dup).toMatchObject({ type: 'err', refresh: true, err: { kind: 'conflictClose' } });
  });
  test('입출금 아님: 변화 요약 · 사유 3개 · 숫자 안 바뀜 안내 · 충돌 already_handled → [닫기]', () => {
    const html = renderToStaticMarkup(h(DismissSheet, { ...sheetCommon, candidate: CAND }));
    const t = textOf(html);
    expect(html).toContain('<h2 id="sh-t" tabindex="-1">입출금이 아닌 변화로 표시</h2>');
    expect(t).toContain('09-14 22:20 스냅샷 · 원화 현금 +700,000원보유 종목 수량 변화 없음');
    expect(t).toContain('매매·배당·이자 등 투자 손익증권사 표시 차이(일시적)기타');
    expect(t).toContain('숫자는 바뀌지 않습니다. 이 변화가 실제로 입출금이었다면 손익에 그대로 섞입니다. 표시한 뒤에도 되돌릴 수 있습니다.');
    expect(html).toMatch(/id="sh-primary" disabled="" aria-describedby="sh-why">입출금 아님으로 표시/);
    const dec = decideDismissOutcome(classifyWrite(409, { ok: false, code: 'already_handled', data: f }, false));
    const c = renderToStaticMarkup(h(DismissSheet, { ...sheetCommon, candidate: CAND, initialState: { err: (dec as { err: SheetErr }).err } }));
    expect(textOf(c)).toContain('다른 기기에서 이미 처리한 변화입니다최신 상태를 불러왔습니다.');
    expect(c).toMatch(/id="sh-primary">닫기<\/button>/);
    expect(textOf(node((decideDismissOutcome({ kind: 'ok', body: { ok: true, data: f, candidate: null } }) as { toast: ReactNS.ReactNode }).toast)))
      .toBe('✓입출금 아님으로 표시했습니다 같은 변화로 다시 알리지 않습니다.');
  });
});

describe('기준 시트 (데모 baseSheet)', () => {
  const f = feedOf();
  test('정하기: 스냅샷 선택지(오늘 아침 · 권장 / 최신 / 어제 아침) · 07~09시 권장 · 현금 확인(선택) · 미리보기', () => {
    const html = renderToStaticMarkup(h(BaselineSheet, { ...sheetCommon, feed: feedOf({ baseline: null }), mode: 'set' }));
    const t = textOf(html);
    expect(html).toContain('<h2 id="sh-t" tabindex="-1">기준 정하기</h2>');
    expect(t).toContain('09-15 07:10오늘 아침 · 권장총자산 21,760,000원#1338');
    expect(t).toContain('09-15 09:40최신');
    expect(t).toContain('09-14 07:12어제 아침');
    expect(html).toMatch(/id="sh-b-1338" checked="" value="1338"/);
    expect(t).toContain('아침 07~09시 스냅샷을 권장합니다. 밤 스냅샷에는 일부 달러 현금이 빠져 보일 때가 있습니다.');
    expect(t).toContain('기준 시각의 현금 확인 (선택)');
    expect(t).toContain('스냅샷 값 $2,700.00 · KIS 앱 ‘외화예수금’ 기준(‘주문가능금액’은 미체결 주문에 묶인 돈이 빠져 더 작을 수 있음). 확실하지 않으면 비워 두세요.');
    expect(t).toContain('스냅샷 값 2,410,000원 · KIS 앱 ‘원화 예수금’ 기준. 확실하지 않으면 비워 두세요.');
    expect(t).toContain('기준 총자산 21,760,000원!비운 칸은 스냅샷 값 — 저장하면 ‘기준 미확정’');
  });
  test('바꾸기: 새 기준 이전 기록은 계산에서 빠진다는 경고(지우지 않음, 버전)', () => {
    const t = textOf(renderToStaticMarkup(h(BaselineSheet, { ...sheetCommon, feed: f, mode: 'change' })));
    expect(t).toContain('! 기준을 바꾸면 새 기준 이전 기록은 계산에서 빠집니다(지우지 않음). 지금 기준(2026-09-01 07:10, 버전 3)은 이력으로 남습니다. 살아 있는 기록 5건 중 새 기준 이전 기록은 ‘기준 이전 · 계산 제외’로 표시됩니다.');
  });
  test('현금 확인: 이미 확인한 값으로 칸을 채워 연다(데모와 다름 — 그대로 저장해도 확인값 유지)', () => {
    const html = renderToStaticMarkup(h(BaselineSheet, { ...sheetCommon, feed: f, mode: 'confirm' }));
    expect(html).toContain('<h2 id="sh-t" tabindex="-1">기준 현금 확인</h2>');
    expect(html).toMatch(/id="sh-bkrw"[^>]*value="1200000"/);
    expect(html).toMatch(/id="sh-busd"[^>]*value="1500"/);
    expect(textOf(html)).toContain('✓두 값 모두 확인 — 저장하면 ‘현금 확인됨’');
    expect(html).not.toContain('sh-bsnap');
  });
  test('미리보기 계산: 달러 차이 × 환율 · 원화 차이(정수 산술)', () => {
    const r = { ts: '2026-09-01 07:10:00', id: 1001, v: 20_000_000, krw: 1_200_000, usd: 1500, fx: 1240 };
    expect(basePreview(r, 1_200_000, 1500)).toEqual({ from: 20_000_000, b1: 20_000_000, same: true, parts: [], unc: false });
    expect(basePreview(r, 1_250_000, 1400)).toEqual({ from: 20_000_000, b1: 20_000_000 - 124_000 + 50_000, same: false, parts: ['달러 −$100.00 × 1,240.00원/$', '원화 +50,000원'], unc: false });
    expect(basePreview(r, null, 1500).unc).toBe(true);
    expect(basePreview({ ...r, usd: null, fx: null }, 1_200_000, null).unc).toBe(false);
    expect(cashVals('0', '', true)).toEqual({ k: 0, u: null, kErr: null, uErr: null });
    expect(cashVals('-1', '1.234', true).kErr).toBe('부호는 넣지 않습니다. 나간 돈이면 위에서 종류를 ‘출금’으로 고르세요.');
  });
  test('🔴 기준 충돌 409 version → [최신 기준 쓰기] [내 값으로 저장] · 다시 보낼 때 최신 버전', () => {
    const dec = decideBaselineOutcome(classifyWrite(409, { ok: false, code: 'version', latest: { version: 5 }, data: f }, false));
    expect(dec).toMatchObject({ type: 'err', feed: f, err: { kind: 'baseConflict', latestVersion: 5 } });
    const err = (dec as { err: SheetErr }).err;
    const html = renderToStaticMarkup(h(BaselineSheet, { ...sheetCommon, feed: f, mode: 'confirm', initialState: { err } }));
    expect(textOf(html)).toContain('저장하지 않았습니다 — 다른 기기에서 기준이 먼저 바뀌었습니다(버전 5)최신 기준을 불러왔습니다. 입력한 값은 그대로 있으니 확인 뒤 다시 저장하면 덮어씁니다.');
    expect(html).toMatch(/id="sh-take">최신 기준 쓰기<\/button><button type="button" class="btn pri" id="sh-primary">내 값으로 저장/);
    expect(baselineRequest({ id: 1001 }, '1200000', '', true, 3, err)).toEqual({ snapshotId: 1001, confirmed: { krwCash: '1200000', usdCash: null }, baseVersion: 5 });
    expect(baselineRequest({ id: 1001 }, ' ', '10', false, 0, null)).toEqual({ snapshotId: 1001, confirmed: { krwCash: null, usdCash: null }, baseVersion: 0 });
    const t = textOf(node((decideBaselineOutcome({ kind: 'ok', body: { ok: true, data: f, baseline: { ...f.baseline!, version: 4, unconfirmed: true } } }) as { toast: ReactNS.ReactNode }).toast));
    expect(t).toBe('✓기준을 저장했습니다 (버전 4) 기준 총자산 20,000,000원 · 기준 미확정');
  });
  test('금액 형식 오류면 저장 비활성 + "금액 형식을 고쳐 주세요."', () => {
    const html = renderToStaticMarkup(h(BaselineSheet, { ...sheetCommon, feed: f, mode: 'confirm', initialState: { krw: '12.5' } }));
    expect(html).toMatch(/id="sh-primary" disabled="">기준 저장/);
    expect(textOf(html)).toContain('금액 형식을 고쳐 주세요.');
    expect(textOf(html)).toContain('원화는 1원 단위로 넣어 주세요(소수점 없음).');
  });
});

describe('스타일 — 반응형·색 규칙', () => {
  test('≥900px 은 미디어 쿼리 2열("top list" "bot list"), container query 없음 · 목록/표 분기', () => {
    expect(LEDGER_CSS).toContain('grid-template-areas: "top list" "bot list"');
    expect(LEDGER_CSS).toMatch(/@media \(min-width: 900px\) \{[\s\S]*\.lg \.only-d \{ display: block; \} \.lg \.only-m \{ display: none; \}/);
    expect(LEDGER_CSS).not.toMatch(/@container/);
  });
  test('빨강/파랑(--up/--down)은 손익(.pl) 에만', () => {
    const lines = LEDGER_CSS.split('\n').filter((l) => /var\(--(up|down)\)/.test(l));
    expect(lines).toEqual(['.lg .pl.up { color: var(--up); } .lg .pl.down { color: var(--down); } .lg .pl.flat { color: var(--text); }']);
  });
  test('[hidden] 이 display 규칙에 덮이지 않는다(접힌 행이 펼쳐져 보이던 데모 결함)', () => {
    expect(LEDGER_CSS).toContain('.lg .hide, .lg [hidden] { display: none !important; }');
  });
});

describe('designer 구현 점검 반영 (Stage 3)', () => {
  test('🔴 P1-2: 마이그레이션 전 503 not_migrated → 중립 "준비 중" 한 문장(role=status) · 다시 시도·기술 용어·중복 문장 없음', () => {
    const html = body(stateOf(null, 'error', '서버 응답 503 — 입출금 원장 테이블이 아직 없습니다 — 마이그레이션(T-074) 적용 전입니다. 기록이 없어진 것이 아닙니다.', 'not_migrated'));
    expect(html).toBe('<div class="sumcard" role="status"><span class="st na"><i aria-hidden="true">◌</i><span>준비 중 — 서버 준비 뒤 쓸 수 있습니다</span></span></div>');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('lg-retry');
    expect(html).not.toContain('마이그레이션');
    expect(html).not.toContain('기록이 없어진');
  });
  test('🔴 다른 원인의 503(코드 없음·다른 코드)은 일반 조회 오류 — 경고 + 다시 시도', () => {
    for (const code of [null, 'server_error', 'auth_not_configured']) {
      const html = body(stateOf(null, 'error', '서버 응답 503 — auth_not_configured', code));
      expect(html).toContain('role="alert"');
      expect(html).toContain('id="lg-retry"');
      expect(textOf(html)).toContain('입출금 기록을 불러오지 못했습니다');
    }
  });
  test('P2-5: 밤 표지 괄호 "(16~06시)" 는 그 시간대 스냅샷일 때만 · inHourRange(자정 넘김)', () => {
    const gap = { usd: 250, krw: 312_500, sinceTs: '2026-09-14 16:40:00' };
    const day = textOf(body(stateOf(feedOf({ snapshot: { ...SNAP, ts: '2026-09-15 11:34:00', usdGapHint: gap } }))));
    expect(day).toContain('! 이 시각(11:34) 스냅샷은 달러 현금 약 $250.00이 빠져 보이는 시간대입니다. 손익이 약 312,500원 작게 보일 수 있습니다.');
    expect(day).not.toContain('16~06시');
    expect([inHourRange('2026-09-15 02:40:00', '16~06'), inHourRange('2026-09-15 16:00:00', '16~06'), inHourRange('2026-09-15 06:00:00', '16~06'), inHourRange('2026-09-15 11:34:00', '16~06')])
      .toEqual([true, true, false, false]);
    expect(inHourRange('2026-09-15 08:00:00', '07~09')).toBe(true);
    expect(inHourRange('2026-09-15 08:00:00', 'bad')).toBe(false);
  });
  test('P2-6: 환율이 없어 계산에서 뺀 달러 기록이 있으면 amber 표지', () => {
    const f = feedOf();
    const g = { ...f, summary: { ...f.summary!, fxMissing: 2 } };
    expect(textOf(body(stateOf(g)))).toContain('! 환율이 없어 계산에서 뺀 달러 기록 2건 — 다음 스냅샷에서 다시 계산합니다');
    expect(textOf(body(stateOf(f)))).not.toContain('환율이 없어');
  });
  test('🔴 P2-1: 현금 확인 미리보기는 지금 기준 총자산과 비교 — 안 바꾸면 "(지금과 같음)", 바꾸면 지금 값 → 새 값 + 지금 확인값 대비 차이', () => {
    // 확인값($1,400)이 스냅샷($1,500)과 다른 채 저장된 기준 — 기준 총자산 = 20,000,000 − 100 × 1,240 = 19,876,000
    const B = { ...feedOf().baseline!, confirmed: { krwCash: 1_200_000, usdCash: 1400, at: '2026-09-01 08:05:00', note: null }, baselineTotalKrw: 19_876_000 };
    const f = feedOf({ baseline: B });
    const same = textOf(renderToStaticMarkup(h(BaselineSheet, { ...sheetCommon, feed: f, mode: 'confirm' })));
    expect(same).toContain('기준 총자산 19,876,000원 (지금과 같음)');
    expect(same).not.toContain('→');
    const changed = textOf(renderToStaticMarkup(h(BaselineSheet, { ...sheetCommon, feed: f, mode: 'confirm', initialState: { usd: '1450' } })));
    expect(changed).toContain('기준 총자산 19,876,000원 → 19,938,000원달러 +$50.00 × 1,240.00원/$');
    // 달러 칸을 비우면 스냅샷 값($1,500)으로 — 지금 확인값 대비 +$100
    const cleared = textOf(renderToStaticMarkup(h(BaselineSheet, { ...sheetCommon, feed: f, mode: 'confirm', initialState: { usd: '' } })));
    expect(cleared).toContain('기준 총자산 19,876,000원 → 20,000,000원달러 +$100.00 × 1,240.00원/$');
    expect(cleared).toContain('비운 칸은 스냅샷 값 — 저장하면 ‘기준 미확정’');
    // 정하기·바꾸기는 새 스냅샷 값과 비교(데모 그대로) — "(지금과 같음)" 없음
    expect(textOf(renderToStaticMarkup(h(BaselineSheet, { ...sheetCommon, feed: f, mode: 'change' })))).not.toContain('지금과 같음');
  });
  test('a11y Minor-5: 충돌로 "닫기"만 남으면 사유 입력 비활성 (취소·입출금 아님) · Minor-3: 기타 선택 때 포커스 이동 없음', () => {
    const f = feedOf();
    const err: SheetErr = { kind: 'conflictClose', node: 'x' };
    const c = renderToStaticMarkup(h(CancelSheet, { ...sheetCommon, feed: f, entry: f.entries.find((e) => e.id === 5)!, initialState: { reason: '기타', etc: 'a', err } }));
    expect(c).toMatch(/id="sh-r-0" disabled=""/);
    expect(c).toMatch(/id="sh-etc"[^>]*disabled=""/);
    const d = renderToStaticMarkup(h(DismissSheet, { ...sheetCommon, candidate: CAND, initialState: { reason: '기타', etc: 'a', err } }));
    expect(d).toMatch(/id="sh-r-2" disabled="" checked=""/);
    expect(d).toMatch(/id="sh-etc"[^>]*disabled=""/);
    const open = renderToStaticMarkup(h(DismissSheet, { ...sheetCommon, candidate: CAND, initialState: { reason: '기타' } }));
    expect(open).not.toMatch(/id="sh-r-2" disabled/);
  });
  test('CSS: 토스트(45)는 시트(50) 아래 · 기준 스냅샷 도움말(.kseg > .hint) · 접힌 행 메모 2줄 말줄임', () => {
    expect(LEDGER_CSS).toMatch(/\.lg \.toast \{[^}]*z-index: 45;/);
    expect(SHEET_CSS).toMatch(/\.sheet-root \{ position: fixed; inset: 0; z-index: 50;/);
    expect(LEDGER_CSS).toContain('.lg .field .hint, .lg .kseg > .hint { font-size: 12px; color: var(--muted); margin-top: 4px; line-height: 1.5; }');
    expect(LEDGER_CSS).toMatch(/\.lg \.erow-h \.m \{[^}]*-webkit-line-clamp: 2;/);
    const base = renderToStaticMarkup(h(BaselineSheet, { ...sheetCommon, feed: feedOf({ baseline: null }), mode: 'set' }));
    expect(base).toMatch(/<\/div><div class="hint">아침 07~09시 스냅샷을 권장합니다/);
  });
});

describe('QA 결함 반영 (Stage 6)', () => {
  // 합성 케이스: 스냅샷 달러 현금 $1,918.60(환율 1,323.89) — 사용자가 KIS 앱 값 $118.60 을 넣는 경우
  const R = { krw: 1_000_000, usd: 1918.6, fx: 1323.89 };
  test('🔴 D-1: 임계(후보 탐지 기준 RULE.krw 5만원 · RULE.usd $50) 미만이면 경고 없음, 이상이면 통화별 경고', () => {
    expect([RULE.krw, RULE.usd]).toEqual([50_000, 50]);
    // 원화: 49,999 차이 → 없음 · 50,000 → 있음(같은 '이상' 비교) · 아래쪽도 같음
    expect(cashGaps(R, 1_049_999, null)).toEqual([]);
    expect(cashGaps(R, 950_001, null)).toEqual([]);
    expect(cashGaps(R, 1_050_000, null)).toEqual([{ currency: 'KRW', snap: 1_000_000, input: 1_050_000, diff: 50_000, diffKrw: 50_000 }]);
    expect(cashGaps(R, 950_000, null).map((g) => g.diff)).toEqual([-50_000]);
    // 달러: $49.99 차이 → 없음 · $50.00 → 있음(센트 정수 비교 — 부동소수 경계 오차 없음)
    expect(cashGaps(R, null, 1968.59)).toEqual([]);
    expect(cashGaps(R, null, 1868.61)).toEqual([]);
    expect(cashGaps(R, null, 1968.6).map((g) => [g.currency, g.diff])).toEqual([['USD', 50]]);
    expect(cashGaps(R, null, 1868.6).map((g) => [g.currency, g.diff])).toEqual([['USD', -50]]);
    // 비어 있음(스냅샷 값 사용) → 경고 없음 · 같은 값 → 없음
    expect(cashGaps(R, null, null)).toEqual([]);
    expect(cashGaps(R, 1_000_000, 1918.6)).toEqual([]);
    // 스냅샷에 달러 행이 없으면 달러 비교 없음
    expect(cashGaps({ krw: 1_000_000, usd: null, fx: null }, null, 118.6)).toEqual([]);
    // 두 통화 모두
    expect(cashGaps(R, 3_000_000, 118.6).map((g) => g.currency)).toEqual(['KRW', 'USD']);
    // 임계는 feed.rules 로 바꿀 수 있다(새 상수 없음)
    expect(cashGaps(R, 1_010_000, null, { krw: 10_000, usd: 50 })).toHaveLength(1);
  });
  test('🔴 D-1: 경고 문장 — 스냅샷 값·입력값·차이(달러는 원화 환산 약 …원) 세 숫자와 끝 문장', () => {
    const [u] = cashGaps(R, null, 118.6);
    expect(u).toEqual({ currency: 'USD', snap: 1918.6, input: 118.6, diff: -1800, diffKrw: -2_383_002 });
    expect(cashGapLine(u)).toBe('달러 현금: 스냅샷 $1,918.60 · 입력 $118.60 · 차이 −$1,800.00(약 −2,383,000원)');
    const [k] = cashGaps(R, 3_000_000, null);
    expect(cashGapLine(k)).toBe('원화 현금: 스냅샷 1,000,000원 · 입력 3,000,000원 · 차이 +2,000,000원');
    expect(cashGapNote([u])).toBe('그대로 저장할 수 있지만, 그러면 손익이 스냅샷 값으로 계산할 때보다 약 2,383,000원 많게 보이고 이 차이가 앞으로도 남습니다. 왜 다른지 모르면 달러 현금 칸을 비우고 저장하세요. 확인되면 나중에 넣을 수 있습니다.');
    // 입력이 스냅샷보다 높으면 기준이 높아져 손익이 '적게' 보인다 — 방향 = −(원화 환산 합)의 부호
    expect(cashGapNote([k])).toBe('그대로 저장할 수 있지만, 그러면 손익이 스냅샷 값으로 계산할 때보다 약 2,000,000원 적게 보이고 이 차이가 앞으로도 남습니다. 왜 다른지 모르면 원화 현금 칸을 비우고 저장하세요. 확인되면 나중에 넣을 수 있습니다.');
    // 두 통화: 합계(+2,000,000 − 2,383,002 = −383,002) → 약 383,000원 많게 · '두 칸'
    expect(cashGapNote([k, u])).toBe('그대로 저장할 수 있지만, 그러면 손익이 스냅샷 값으로 계산할 때보다 약 383,000원 많게 보이고 이 차이가 앞으로도 남습니다. 왜 다른지 모르면 두 칸을 비우고 저장하세요. 확인되면 나중에 넣을 수 있습니다.');
    const [k2] = cashGaps(R, 3_383_002, null);
    // 합 0 — 방향 없음(기준 환율이 고정이라 손익은 지금도 앞으로도 바뀌지 않는다, designer Stage 7 확인 문구)
    expect(cashGapNote([k2, u])).toBe('그대로 저장해도 두 차이가 서로 상쇄되어 손익은 바뀌지 않습니다. 다만 두 값 모두 스냅샷과 크게 달라 어느 쪽이 맞는지 확인이 필요합니다. 왜 다른지 모르면 두 칸을 비우고 저장하세요. 확인되면 나중에 넣을 수 있습니다.');
    // 시트에서도: 원화 +1,000,000원 · 달러 −$800.00 × 1,250 = −1,000,000원
    const z = textOf(renderToStaticMarkup(h(BaselineSheet, { ...sheetCommon, feed: { ...feedOf({ baseline: null }), baselineOptions: [{ id: 2002, ts: '2026-09-15 07:10:00', totalKrw: 20_000_000, krwCash: 1_000_000, usdCash: 2700, fx: 1250, tags: ['today_morning' as const] }] }, mode: 'set', initialState: { krw: '2000000', usd: '1900' } })));
    expect(z).toContain('원화 현금: 스냅샷 1,000,000원 · 입력 2,000,000원 · 차이 +1,000,000원');
    expect(z).toContain('차이 −$800.00(약 −1,000,000원)그대로 저장해도 두 차이가 서로 상쇄되어 손익은 바뀌지 않습니다.');
    expect(z).not.toContain('많게');
    expect(z).not.toContain('적게');
    const [kSmall] = cashGaps({ krw: 0, usd: null, fx: null }, 50_000, null, { krw: 50_000, usd: 50 });
    const uTiny = { ...u, diffKrw: -50_400 };
    expect(cashGapNote([kSmall, uTiny])).toContain('1,000원 미만 많게');
  });
  test('🔴 D-1: 기준 시트 — 미리보기 아래 경고 상자(role=note), 저장은 막지 않음 · 비우면 경고 없음', () => {
    const opt = { id: 2001, ts: '2026-09-15 07:10:00', totalKrw: 20_000_000, krwCash: 1_000_000, usdCash: 1918.6, fx: 1323.89, tags: ['today_morning' as const] };
    const f: LedgerFeed = { ...feedOf({ baseline: null }), baselineOptions: [opt] };
    const html = renderToStaticMarkup(h(BaselineSheet, { ...sheetCommon, feed: f, mode: 'set', initialState: { usd: '118.60' } }));
    const t = textOf(html);
    expect(html).toContain('<div class="warnbox" role="note" id="sh-bgap"');
    expect(html.indexOf('id="sh-bgap"')).toBeGreaterThan(html.indexOf('class="impact"'));
    expect(html.indexOf('id="sh-bgap"')).toBeGreaterThan(html.indexOf('id="sh-bprev"'));
    expect(t).toContain(`${CASH_GAP_TITLE}달러 현금: 스냅샷 $1,918.60 · 입력 $118.60 · 차이 −$1,800.00(약 −2,383,000원)그대로 저장할 수 있지만, 그러면 손익이 스냅샷 값으로 계산할 때보다 약 2,383,000원 많게 보이고`);
    expect(t).toContain('스냅샷 값 $1,918.60 · KIS 앱 ‘외화예수금’ 기준(');   // 도움말의 스냅샷 값은 보간
    expect(t).toContain('기준 총자산 20,000,000원 → 17,616,998원');   // 경고는 계산을 바꾸지 않는다(baseTotal 그대로)
    expect(html).toMatch(/id="sh-primary" aria-describedby="sh-bgap">기준 저장<\/button>/);   // 막지 않음 + 버튼 설명으로 경고 연결
    // 360px 캡처에서 '−' 와 '$1,800.00' 이 갈라졌다 — 조각마다 줄바꿈 금지
    expect(html).toContain('<span style="white-space:nowrap">스냅샷 $1,918.60</span></span><span> · <span style="white-space:nowrap">입력 $118.60</span></span><span> · <span style="white-space:nowrap">차이 −$1,800.00(약 −2,383,000원)</span>');
    const empty = renderToStaticMarkup(h(BaselineSheet, { ...sheetCommon, feed: f, mode: 'set' }));
    expect(empty).not.toContain('sh-bgap');
    const near = renderToStaticMarkup(h(BaselineSheet, { ...sheetCommon, feed: f, mode: 'set', initialState: { usd: '1,900.00', krw: '1,020,000' } }));
    expect(near).not.toContain('sh-bgap');
    const krw = textOf(renderToStaticMarkup(h(BaselineSheet, { ...sheetCommon, feed: f, mode: 'set', initialState: { krw: '3000000' } })));
    expect(krw).toContain('원화 현금: 스냅샷 1,000,000원 · 입력 3,000,000원 · 차이 +2,000,000원');
    expect(krw).toContain('약 2,000,000원 적게 보이고');
    expect(krw).toContain('왜 다른지 모르면 원화 현금 칸을 비우고 저장하세요.');
    // 형식 오류 칸은 비교하지 않는다(오류 문장만)
    expect(renderToStaticMarkup(h(BaselineSheet, { ...sheetCommon, feed: f, mode: 'set', initialState: { usd: '118,60' } }))).not.toContain('sh-bgap');
  });
});

describe('designer 점검 반영 (Stage 7)', () => {
  const opt = { id: 2001, ts: '2026-09-15 07:10:00', totalKrw: 20_000_000, krwCash: 1_000_000, usdCash: 1918.6, fx: 1323.89, tags: ['today_morning' as const] };
  const f: LedgerFeed = { ...feedOf({ baseline: null }), baselineOptions: [opt] };
  const render = (st: { krw?: string; usd?: string }) => renderToStaticMarkup(h(BaselineSheet, { ...sheetCommon, feed: f, mode: 'set', initialState: st }));
  test('🔴 경고 상자는 aria-live 영역(#sh-bprev) 밖 · 저장 버튼 aria-describedby 로만 연결', () => {
    const html = render({ krw: '1000000', usd: '118.60' });
    const a = html.indexOf('<div id="sh-bprev" aria-live="polite">');
    const b = html.indexOf('<div class="warnbox" role="note" id="sh-bgap"');
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    const seg = html.slice(a, b);
    expect((seg.match(/<div/g) ?? []).length).toBe((seg.match(/<\/div>/g) ?? []).length);   // #sh-bprev 가 경고 앞에서 닫힘
    expect(html).toMatch(/<button[^>]*id="sh-primary"[^>]*aria-describedby="sh-bgap"/);
    expect(render({})).not.toContain('aria-describedby="sh-bgap"');
  });
  test('🔴 차이 경고가 있으면 "두 값 모두 확인"은 초록 ✓ 대신 중립 ◌ — 없으면 초록 그대로', () => {
    const gap = textOf(render({ krw: '1000000', usd: '118.60' }));
    expect(gap).toContain('◌두 값 모두 확인 — 저장하면 ‘현금 확인됨’');
    expect(gap).not.toContain('✓두 값 모두 확인');
    expect(render({ krw: '1000000', usd: '118.60' })).toContain('<span class="st na"><i aria-hidden="true">◌</i><span>두 값 모두 확인');
    const clean = textOf(render({ krw: '1000000', usd: '1918.60' }));
    expect(clean).toContain('✓두 값 모두 확인 — 저장하면 ‘현금 확인됨’');
    expect(clean).not.toContain('◌두 값 모두 확인');
  });
  test('🔴 M1 토스트 — 저장된 기록 번호 보간(하드코딩 없음) · 조사 로/으로 · 번호 없을 때', () => {
    const t = (id: number | null) => textOf(node(clientConflictToast(id)));
    expect(t(17)).toBe('!방금 고친 값은 저장되지 않았습니다. 먼저 보낸 내용이 이미 #17로 저장되어 있어 펼쳐 두었습니다. 다르면 정정해 주세요.');
    expect(t(42)).toBe('!방금 고친 값은 저장되지 않았습니다. 먼저 보낸 내용이 이미 #42로 저장되어 있어 펼쳐 두었습니다. 다르면 정정해 주세요.');
    expect(t(13)).toContain('#13으로 저장되어');
    expect([idWithRo(10), idWithRo(6), idWithRo(1), idWithRo(8), idWithRo(9), idWithRo(100)]).toEqual(['#10으로', '#6으로', '#1로', '#8로', '#9로', '#100으로']);
    expect(t(null)).toBe('!방금 고친 값은 저장되지 않았습니다. 먼저 보낸 내용이 이미 저장되어 있습니다. 목록에서 확인하고 다르면 정정해 주세요.');
    const dec = decideEntryOutcome(classifyWrite(409, { ok: false, code: 'client_entry_conflict', error: 'x', existingId: 23, data: feedOf() }, false), { correct: false, target: null, beforeP: 0 });
    expect(textOf(node((dec as { toast: ReactNS.ReactNode }).toast))).toContain('#23으로 저장되어 있어 펼쳐 두었습니다');
  });
});

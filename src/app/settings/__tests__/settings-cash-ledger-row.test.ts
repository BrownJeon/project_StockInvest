/**
 * T-074 설정 화면 — '내 계정' 바로 다음에 SectionHeader '자산 기록' + 입출금 기록 요약 행(데모 settingsFrame·rowSummary).
 * 기존 항목·순서는 그대로이고, 기존 Promise.all 조회·handleSave 저장 대상에 원장을 섞지 않았음을 소스로 고정한다.
 * 숫자는 데모 합성값.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ReactNS from 'react';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as unknown as { React: typeof ReactNS }).React = ReactNS;
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }), usePathname: () => '/settings' }));

import { CashLedgerRowSummary, CashLedgerSummaryRow } from '@/app/settings/CashLedgerSummaryRow';
import { BASE_UNCONFIRMED, feedOf, seed, textOf } from '@/components/ledger/__tests__/fixtures';

const SRC = fs.readFileSync(path.resolve(__dirname, '../SettingsPage.tsx'), 'utf8');
const row = (p: Parameters<typeof CashLedgerRowSummary>[0]) => renderToStaticMarkup(h(CashLedgerRowSummary, p));

describe('요약 행 (데모 rowSummary)', () => {
  test('로딩 · 오류 · 기준 없음 문구', () => {
    expect(row({ load: 'loading', data: null })).toBe('<span role="status">불러오는 중…</span>');
    expect(textOf(row({ load: 'error', data: null }))).toBe('!불러오지 못했습니다 — 눌러서 다시 확인');
    expect(textOf(row({ load: 'ready', data: feedOf({ baseline: null }) }))).toBe('—손익 기준이 아직 없습니다눌러서 기준을 정하면 입출금을 기록할 수 있습니다');
  });
  test('🔴 P1-2: 마이그레이션 전(503 not_migrated) → 중립 "◌ 준비 중" (경고·"다시 확인" 없음) · 다른 오류는 그대로 경고', () => {
    const html = row({ load: 'error', data: null, code: 'not_migrated' });
    expect(html).toBe('<span class="st na"><i aria-hidden="true">◌</i><span>준비 중 — 서버 준비 뒤 쓸 수 있습니다</span></span>');
    expect(textOf(row({ load: 'error', data: null, code: 'server_error' }))).toBe('!불러오지 못했습니다 — 눌러서 다시 확인');
    expect(textOf(row({ load: 'error', data: null, code: null }))).toBe('!불러오지 못했습니다 — 눌러서 다시 확인');
  });
  test('행은 조회 상태의 code 를 넘긴다(배선)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../CashLedgerSummaryRow.tsx'), 'utf8');
    expect(src).toContain('<CashLedgerRowSummary load={feed.load} data={feed.data} code={feed.loadCode} />');
  });
  test('정상: 손익(부호·%)·기준일 · 경고 칩(기록 안 된 변화·반영 대기) · 기록 n건·마지막', () => {
    const html = row({ load: 'ready', data: feedOf() });
    expect(html).toContain('<b class="pl up">+830,000원</b>');
    const t = textOf(html);
    expect(t).toContain('입출금 뺀 손익 +830,000원 (+4.0%) · 09-01부터');
    expect(t).toContain('!기록 안 된 변화 1건');
    expect(t).toContain('◌반영 대기 1건');
    expect(t).toContain('기록 5건 · 마지막 09-15 09:50');
    expect(t).not.toContain('불일치');
    expect(html).not.toContain('ptag');
  });
  test('기준 미확정이면 임시 표지 + 칩 · 불일치 칩', () => {
    const es = seed().map((e) => (e.id === 6 ? { ...e, anchor: { ...e.anchor, status: 'unmatched' as const } } : e));
    const html = row({ load: 'ready', data: feedOf({ baseline: BASE_UNCONFIRMED, entries: es, candidates: [] }) });
    expect(html).toContain('<span class="ptag">임시</span>');
    const t = textOf(html);
    expect(t).toContain('!기준 미확정');
    expect(t).toContain('!불일치 1건');
    expect(t).not.toContain('기록 안 된 변화');
  });
  test('행: 링크 /settings/cash-ledger · aria-labelledby · 배지 · "입출금 기록 · 손익 보기 ›"', () => {
    const html = renderToStaticMarkup(h(CashLedgerSummaryRow));
    expect(html).toContain('<a class="riskrow" aria-labelledby="cl-row-t cl-row-sum" href="/settings/cash-ledger">');
    expect(html).toContain('<b id="cl-row-t">입출금 기록</b><span class="mode disp">◌ 기록·계산 전용</span>');
    expect(html).toContain('<div class="rk-sum" id="cl-row-sum"><span role="status">불러오는 중…</span></div>');
    expect(html).toContain('<span>입출금 기록 · 손익 보기</span><span class="chev" aria-hidden="true">›</span>');
  });
});

describe('설정 화면 배치', () => {
  test("SectionHeader 순서: '내 계정' 다음에 '자산 기록', 나머지 순서 그대로", () => {
    const titles = [...SRC.matchAll(/<SectionHeader title="([^"]+)" \/>/g)].map((m) => m[1]);
    expect(titles.slice(0, 4)).toEqual(['내 계정', '자산 기록', '승인 방식', '안전장치 (공통)']);
    expect(titles.filter((t) => t !== '자산 기록')).toEqual([
      // T-108 §2.6 — 안전장치 카드(·리스크 정책 행) 아래에 '자동매매 자금'(이동 전용 2행)을 새로 넣었다. 나머지 순서는 그대로.
      '내 계정', '승인 방식', '안전장치 (공통)', '자동매매 자금', '거래 보호', '변동폭 가드', '전략 설정', 'AI 제공자 (LLM)', '거래소 계정', '알람', '정기 거래 리포트',
    ]);
  });
  test('요약 행은 내 계정 링크 뒤·승인 방식 앞에 한 번만', () => {
    const acct = SRC.indexOf('내 계정 · 증권계좌 연결');
    const head = SRC.indexOf('<SectionHeader title="자산 기록" />');
    const rowAt = SRC.indexOf('<CashLedgerSummaryRow />');
    const appr = SRC.indexOf('<SectionHeader title="승인 방식" />');
    expect(acct).toBeGreaterThan(0);
    expect(head).toBeGreaterThan(acct);
    expect(rowAt).toBeGreaterThan(head);
    expect(appr).toBeGreaterThan(rowAt);
    expect(SRC.match(/<CashLedgerSummaryRow \/>/g)).toHaveLength(1);
  });
  test('기존 조회·저장 흐름에 원장을 섞지 않았다', () => {
    const effect = SRC.slice(SRC.indexOf('Promise.all(['), SRC.indexOf(']).then(([safetyData'));
    expect(effect).not.toMatch(/ledger|cash/i);
    const save = SRC.slice(SRC.indexOf('const handleSave'), SRC.indexOf('if (loading) return'));
    expect(save).not.toMatch(/ledger|cash-ledger/i);
  });
});

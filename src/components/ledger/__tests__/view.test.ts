/**
 * T-074 WP-B — 표시 순수 함수(데모 statusParts·entryAmt·entryMeta·entryExtra 등)와 Leader 승인 변경(P2-2·Minor-1).
 * 합성값만 쓴다(데모와 같음).
 */
import {
  ago, candidateAmountText, candidateDelta, currencyWord, entryAmt, entryExtra, entryMeta, entryOne, plCls, plWord, rowAriaLabel,
  sortEntries, spct, statusParts, visibleEntries,
} from '@/components/ledger/view';
import { entry, seed } from './fixtures';

const byId = (id: number) => seed().find((e) => e.id === id)!;

describe('반영 상태 (데모 statusParts)', () => {
  test('반영됨 · 반영 대기 · 불일치 · 취소됨 · 정정됨 · 기준 이전', () => {
    expect(statusParts(byId(1))).toEqual(['ok', '✓', '반영됨']);
    expect(statusParts(byId(7))).toEqual(['na', '◌', '반영 대기']);
    expect(statusParts(byId(2))).toEqual(['na', '×', '취소됨']);
    expect(statusParts(byId(4))).toEqual(['na', '↻', '정정됨 → #5']);
    expect(statusParts({ ...byId(1), beforeBaseline: true })).toEqual(['na', '—', '기준 이전 · 계산 제외']);
    const u = { ...byId(6), anchor: { ...byId(6).anchor, status: 'unmatched' as const } };
    expect(statusParts(u)).toEqual(['warn', '!', '불일치']);
  });
  test('🔴 P2-2(Leader 승인): 환전 불일치는 amber `! 불일치` 대신 중립 `◌ 확인 전`', () => {
    const x = { ...byId(3), anchor: { ...byId(3).anchor, status: 'unmatched' as const } };
    expect(statusParts(x)).toEqual(['na', '◌', '확인 전']);
  });
  test('취소가 정정보다, 정정이 기준 이전보다 먼저(데모 순서)', () => {
    expect(statusParts({ ...byId(2), beforeBaseline: true })[2]).toBe('취소됨');
  });
});

describe('금액·메타·부가 줄 (중립색 + 부호 + 종류 — 손익 색 없음)', () => {
  test('entryAmt: 입금 +, 출금 −(U+2212), 환전 낸 → 받은', () => {
    expect(entryAmt(byId(1))).toBe('+1,000,000원');
    expect(entryAmt(byId(5))).toBe('−300,000원');
    expect(entryAmt(byId(6))).toBe('+$200.00');
    expect(entryAmt(byId(3))).toBe('1,260,000원 → $1,000.00');
  });
  test('entryOne · entryMeta · currencyWord', () => {
    expect(entryOne(byId(1))).toBe('입금 1,000,000원');
    expect(entryMeta(byId(1))).toBe('09-03 10:00 · 원화 · 월급 일부');
    expect(entryMeta(byId(3))).toBe('09-05 13:00 · 원화→달러');
    expect(currencyWord({ kind: 'exchange', currency: 'USD' })).toBe('달러→원화');
    expect(currencyWord({ kind: 'deposit', currency: 'USD' })).toBe('달러');
  });
  test('entryExtra: 환전 환율·비용(추정)·손익 영향 없음 / 달러 원화 환산 출처 / 정정 출처', () => {
    expect(entryExtra(byId(3), 1250)).toBe('환율 1,260.00원/$ · 비용(추정) 3,800원 · 손익 영향 없음');
    expect(entryExtra(byId(6), 1250)).toBe('원화 환산 250,000원 (반영 시점 환율 1,250.00)');
    expect(entryExtra(byId(5), 1250)).toBe('#4 를 정정한 기록');
    expect(entryExtra(byId(1), 1250)).toBe('');
    const pend = entry({ id: 9, kind: 'deposit', occurredAt: '2026-09-15 09:50', currency: 'USD', amount: 100 });
    expect(entryExtra(pend, 1250)).toBe('원화 환산 125,000원 (임시 · 최신 환율 1,250.00)');
    const unm = { ...pend, anchor: { ...pend.anchor, status: 'unmatched' as const }, fxRateUsed: 1240 };
    expect(entryExtra(unm, 1250)).toBe('원화 환산 124,000원 (기록 뒤 첫 스냅샷 환율 1,240.00)');
  });
  test('🔴 Minor-1(Leader 승인 + designer a11y Minor-1): 목록 행 접근 이름 = "#1 입금 1,000,000원, 09-03 10:00, 반영됨"', () => {
    expect(rowAriaLabel(byId(1))).toBe('#1 입금 1,000,000원, 09-03 10:00, 반영됨');
    expect(rowAriaLabel(byId(3))).toBe('#3 환전 1,260,000원 → $1,000.00, 09-05 13:00, 반영됨');
    expect(rowAriaLabel(byId(4))).toBe('#4 출금 3,000,000원, 09-10 14:00, 정정됨 → #5');
    // 메모·부가 정보는 접근 이름에 넣지 않는다(펼친 상세에서 읽는다)
    expect(rowAriaLabel(byId(1))).not.toContain('월급');
  });
});

describe('목록 정렬·보이기 (데모 visibleEntries)', () => {
  test('발생 시각 최신순, 같은 시각이면 id 큰 것 먼저 · 기본은 살아 있는 기록만', () => {
    expect(sortEntries(seed()).map((e) => e.id)).toEqual([7, 6, 5, 4, 3, 2, 1]);
    expect(visibleEntries(seed(), false).map((e) => e.id)).toEqual([7, 6, 5, 3, 1]);
    expect(visibleEntries(seed(), true)).toHaveLength(7);
  });
});

describe('숫자·시각 도우미', () => {
  test('ago · spct · plCls · plWord', () => {
    expect(ago(15)).toBe('15분 전');
    expect(ago(200)).toBe('3시간 20분 전');
    expect(ago(180)).toBe('3시간 전');
    expect(spct(3.987, 2)).toBe('+3.99%');
    expect(spct(-1.25, 1)).toBe('−1.3%');
    expect(spct(0, 1)).toBe('0.0%');
    expect([plCls(1), plCls(-1), plCls(0)]).toEqual(['up', 'down', 'flat']);
    expect([plWord(1), plWord(-1), plWord(0)]).toEqual(['늘어남', '줄어듦', '변화 없음']);
  });
  test('후보 금액 표기·폼 채우기 문자열', () => {
    expect(candidateDelta({ currency: 'KRW', delta: 700_000 })).toEqual({ word: '원화', signed: '+700,000원' });
    expect(candidateDelta({ currency: 'USD', delta: -368.6 })).toEqual({ word: '달러', signed: '−$368.60' });
    expect(candidateAmountText({ currency: 'KRW', delta: -700_000 })).toBe('700000');
    expect(candidateAmountText({ currency: 'USD', delta: 200 })).toBe('200');
    expect(candidateAmountText({ currency: 'USD', delta: 368.6 })).toBe('368.60');
  });
});

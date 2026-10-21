/**
 * T-062 WP-U Reviewer R-3 — 국내 카드 마크업 회귀망(HEAD 골든 바이트 비교).
 *
 * 기대값 = HEAD `7cd47e7` 렌더 결과(`fixtures/t062-domestic-golden-head.ts`, 자동 생성 리터럴) +
 * **이 파일에 명시한 의도된 차이만**:
 *   ① ScenarioCard 등급 배지 안 신뢰도 칸 `<span style="font-weight:600"> N%</span>` (신뢰도가 있을 때만)
 *   ② "내일" 탭 목록 맨 위 정렬 라벨 바 1개
 *   ③ "내일" 탭 진입·목표·손절 줄 style 에 `row-gap:2px;flex-wrap:wrap` (국내 카드에도 적용 — 넘칠 때만 영향, R-3 분류 implementation)
 * 이 밖의 바이트가 하나라도 달라지면 실패한다. 입력은 HEAD 가 정상적으로 그리던 모양(객체 indicators·number 금액)만 쓴다.
 */
import * as ReactNS from 'react';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as unknown as { React: typeof ReactNS }).React = ReactNS;

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('@/components/CandleChart', () => ({ CandleChart: () => null }));
jest.mock('@/components/TradingBoard', () => ({ TradingBoard: () => null }));
jest.mock('@/components/dashboard/EvalFunnelCard', () => ({ EvalFunnelCard: () => null }));
jest.mock('@/components/dashboard/MyDecisionSection', () => ({ MyDecisionSection: () => null }));
jest.mock('@/components/dashboard/RecentExecutionsSection', () => ({ RecentExecutionsSection: () => null }));

import { ScenarioCard, type SignalWithScenario } from '@/components/ScenarioCard';
import { TomorrowScenarioTab, type TomorrowSignal } from '@/components/dashboard/Dashboard';
import { useForeignHost } from './fixtures/host-sim';
import { GOLDEN_CARDS, GOLDEN_TOMORROW, GOLDEN_SYMBOL_META } from './fixtures/t062-domestic-golden-inputs';
import { HEAD_CARDS, HEAD_TOMORROW, HEAD_TOMORROW_EMPTY } from './fixtures/t062-domestic-golden-head';

// 골든은 같은 흉내(host-sim) 아래에서 뽑았다 — 실행 머신 시간대·로케일과 무관하게 같은 바이트.
useForeignHost();

/** ① 신뢰도 칸 — 등급 글자 바로 뒤(`>A</span>` → `>A<span …> 81%</span></span>`). */
function withConfidence(headHtml: string, grade: string, conf: number): string {
  const from = `>${grade}</span></div></div>`;
  expect(headHtml.split(from)).toHaveLength(2); // 기대값 조작 위치가 정확히 1곳인지 먼저 확인
  return headHtml.replace(from, `>${grade}<span style="font-weight:600"> ${conf}%</span></span></div></div>`);
}

/** ② 정렬 라벨 바 (가이드 G7·G7-b 문구·색). */
const SORT_BAR =
  '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 14px;background:var(--bg2);' +
  'border-bottom:1px solid var(--border);font-size:11px;color:var(--muted)"><span>정렬: <b style="color:var(--text);' +
  'font-weight:700">평가등급순</b> (같은 등급은 신뢰도 높은 순)</span></div>';

/** ③ 진입줄 style. */
const ROW_HEAD = 'style="display:flex;gap:12px;margin-top:6px;font-size:12px;color:var(--muted)"';
const ROW_NOW = 'style="display:flex;gap:12px;row-gap:2px;flex-wrap:wrap;margin-top:6px;font-size:12px;color:var(--muted)"';

function renderCard(i: number): string {
  return renderToStaticMarkup(h(ScenarioCard, { signal: GOLDEN_CARDS[i] as unknown as SignalWithScenario }));
}

describe('R-3 ScenarioCard 국내 카드 — HEAD 골든 + 의도된 차이만', () => {
  test('G1 매수·A·신뢰도 81 → 신뢰도 칸만 추가', () => {
    expect(renderCard(0)).toBe(withConfidence(HEAD_CARDS[0], 'A', 81));
  });
  test('G2 매도·수량·B+·신뢰도 없음·리스크·내 시나리오 → HEAD 와 완전 동일', () => {
    expect(renderCard(1)).toBe(HEAD_CARDS[1]);
  });
  test('G3 C·신뢰도 55·소수 금액 → 신뢰도 칸만 추가', () => {
    expect(renderCard(2)).toBe(withConfidence(HEAD_CARDS[2], 'C', 55));
  });
  test("G4 정의 밖 등급 'D'·신뢰도 90 → 신뢰도 칸만 추가(등급 글자는 HEAD 처럼 그대로)", () => {
    expect(renderCard(3)).toBe(withConfidence(HEAD_CARDS[3], 'D', 90));
  });
  test('G5 indicators null·금액 없음 → HEAD 와 완전 동일', () => {
    expect(renderCard(4)).toBe(HEAD_CARDS[4]);
  });
});

describe('R-3 "내일" 탭 국내 카드 — HEAD 골든 + 의도된 차이만', () => {
  test('국내 3장(이미 평가등급순 입력) → 정렬 라벨 바 + 진입줄 style 외 동일', () => {
    const now = renderToStaticMarkup(h(TomorrowScenarioTab, {
      signals: GOLDEN_TOMORROW as unknown as TomorrowSignal[], symbolMeta: GOLDEN_SYMBOL_META, onSelectSymbol: () => {},
    }));
    expect(HEAD_TOMORROW.startsWith('<div><div style="padding:12px 14px;')).toBe(true);
    expect(HEAD_TOMORROW.split(ROW_HEAD)).toHaveLength(GOLDEN_TOMORROW.length + 1);
    const expected = HEAD_TOMORROW.replace('<div>', `<div>${SORT_BAR}`).split(ROW_HEAD).join(ROW_NOW);
    expect(now).toBe(expected);
    // 국내 카드에는 미국 배지·정규장 줄·실적 줄·하단 문구가 없다
    expect(now).not.toMatch(/미국|실적|미국 카드는/);
  });
  test('빈 상태 → HEAD 와 완전 동일', () => {
    const now = renderToStaticMarkup(h(TomorrowScenarioTab, { signals: [], symbolMeta: {}, onSelectSymbol: () => {} }));
    expect(now).toBe(HEAD_TOMORROW_EMPTY);
  });
});

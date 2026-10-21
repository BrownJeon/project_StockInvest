/**
 * T-062 WP-U Reviewer R-1·R-2 — 추천 탭 페이지(`app/recommend/page.tsx`)와 승인 화면(`ScenarioDetail`)의
 * **배선** 시험: 실제 컴포넌트를 그려서 정렬 호출·정렬 라벨·진입 감시 금액 서식·서버 달러 구간 우선(R-1),
 * 해외 판정·배지·유효/실적 줄·진입 구간 해외 분기(R-2)가 화면에 이어져 있는지 본다.
 *
 * ── 어떻게 그리는가(소스 변경 없이) ─────────────────────────────────────────────
 * jsdom·@testing-library 는 설치돼 있지 않고(package.json·node_modules 확인), 설치는 이번 범위 밖이다.
 * 두 화면은 데이터를 `useEffect` 안의 fetch 로 채우므로 `react-dom/server` 정적 렌더에서는 "불러오는 중" 만 보인다.
 * 그래서 `react` 의 `useState` 만 감싸, 대상 컴포넌트가 **맨 앞에서 부르는 useState 몇 개**의 초기값을
 * fetch 가 끝난 뒤의 값으로 바꿔 준다(그 밖의 useState 는 실제 구현 그대로). 의존하는 소스 사실:
 *  - page.tsx: useState 순서 = signals → pendingEntry → loading → blockBanner (그 앞에 다른 useState 없음 —
 *    useSymbolMeta·useFxRate 는 목으로 대체)
 *  - ScenarioDetail.tsx: useState 순서 = signal → loading → (나머지는 실제 초기값)
 * 이 순서가 바뀌면 이 시험이 "불러오는 중"·잘못된 화면으로 실패한다(조용히 통과하지 않는다 — 각 시험이 화면 문구를 확인).
 * 한계: effect·fetch·클릭 상호작용 자체는 시험하지 않는다(QA 캡처 몫).
 */
import * as ReactNS from 'react';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mockStateQueue: unknown[] = [];
jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return {
    ...actual,
    useState: (init: unknown) => (mockStateQueue.length > 0 ? [mockStateQueue.shift(), () => {}] : actual.useState(init)),
  };
});
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('@/components/ui/Toast', () => ({ useToast: () => ({ show: jest.fn() }) }));
jest.mock('@/lib/hooks/useFxRate', () => ({ useFxRate: () => 1400 })); // 카드 환율(1330)과 일부러 다르게 — 폴백 경로가 드러난다
jest.mock('@/lib/hooks/useSymbolMeta', () => ({
  useSymbolMeta: () => ({
    meta: {},
    displaySymbol: (s: string) => (s.includes(':') ? s.split(':')[1] : s),
    marketFlag: (s: string) => (s.includes(':') ? '🇺🇸' : '🇰🇷'),
  }),
}));

(globalThis as unknown as { React: typeof ReactNS }).React = ReactNS;

import RecommendPage from '@/app/recommend/page';
import { ScenarioDetail } from '@/components/ScenarioDetail';
import { useForeignHost } from './fixtures/host-sim';
import { T062_FIXTURE, CMCSA_INDICATORS, cmcsaWithoutUsd } from './fixtures/t062-signals-fixture';

useForeignHost();

function text(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

// ─── R-1 추천 탭 ──────────────────────────────────────────────────────────────

/** 진입 감시 중(approved_pending_entry) — 목록 API 모양 그대로(indicators 문자열·DECIMAL 문자열). */
const PENDING = [
  { id: 401, symbol: 'NAS:INTC', side: 'buy', market: 'overseas', expires_at: '2026-10-22T20:00:00.000Z', created_at: '2026-10-21T00:00:00.000Z',
    quantity: null, amount_krw: '100000.00',
    indicators: JSON.stringify({ price_zone_usd: { lo: 20.1, hi: 20.5 }, ai: { scenario: { entry: { price_zone: '26733~27265' }, exit: { target_pct: 3 } } } }) },
  { id: 402, symbol: 'NAS:MU', side: 'buy', market: 'overseas', expires_at: '2026-10-22T20:00:00.000Z', created_at: '2026-10-21T00:00:00.000Z',
    quantity: null, amount_krw: '100000.00',
    indicators: JSON.stringify({ ai: { scenario: { entry: { price_zone: '140000~142800' }, exit: { target_pct: 4 } } } }) },
  { id: 403, symbol: '000660', side: 'buy', market: 'domestic', expires_at: '2026-10-22T06:30:00.000Z', created_at: '2026-10-21T00:00:00.000Z',
    quantity: 2, amount_krw: '360000.00',
    indicators: JSON.stringify({ ai: { scenario: { entry: { price_zone: '180000~182000' }, exit: { target_pct: 2 } } } }) },
];

function renderRecommend(signals: unknown[], pending: unknown[] = PENDING): string {
  mockStateQueue.length = 0;
  mockStateQueue.push(signals, pending, false, null); // signals · pendingEntry · loading=false · blockBanner=null
  const html = renderToStaticMarkup(h(RecommendPage));
  expect(mockStateQueue).toHaveLength(0); // 4개를 정확히 소비했다(순서 전제 확인)
  return html;
}

/** 추천 목록 부분(진입 감시 중 앞)에서 종목 짧은 이름이 나오는 순서. */
function listOrder(html: string, names: string[]): string[] {
  const list = text(html).split('👁 진입 감시 중')[0];
  return [...names].filter(n => list.includes(n)).sort((a, b) => list.indexOf(a) - list.indexOf(b));
}

const NAMES = ['BAC', '005930', 'CMCSA', '066570', 'NFLX', '035720', 'PFE'];

describe('R-1 추천 탭 page.tsx 배선', () => {
  test('서버 순서(최신순) 입력 → 평가등급순 BAC, 005930, CMCSA, 066570, NFLX, 035720, PFE', () => {
    expect(listOrder(renderRecommend(T062_FIXTURE), NAMES)).toEqual(NAMES);
  });
  test('입력을 뒤집어도(오래된 순) 같은 순서 — 정렬 호출·신뢰도 비교가 실제로 쓰인다', () => {
    // 뒤집으면 A 끼리(005930 81 vs BAC 82)·B+ 끼리·B 끼리 입력 순서가 신뢰도 순서와 반대가 된다.
    expect(listOrder(renderRecommend([...T062_FIXTURE].reverse()), NAMES)).toEqual(NAMES);
  });
  test('정렬 라벨 1줄 — 목록 맨 위, 카드가 있을 때만', () => {
    const t = text(renderRecommend(T062_FIXTURE));
    expect(t.split('정렬: 평가등급순 (같은 등급은 신뢰도 높은 순)')).toHaveLength(2);
    expect(t.indexOf('정렬: 평가등급순')).toBeLessThan(t.indexOf('BAC'));
    const empty = text(renderRecommend([], []));
    expect(empty).not.toContain('정렬:');
    expect(empty).toContain('현재 추천 종목이 없습니다');
  });
  test('추천 카드: 문자열 indicators 를 풀어 등급·신뢰도·금액 서식이 보인다', () => {
    const t = text(renderRecommend(T062_FIXTURE));
    expect(t).toContain('B+ 74%');
    expect(t).toContain('🇺🇸미국');
    expect(t).not.toContain('100000.00');
  });
  test('진입 감시 중: 금액 "약 100,000원" (DECIMAL 문자열 서식) · 국내 수량 "2주"', () => {
    const watch = text(renderRecommend(T062_FIXTURE)).split('👁 진입 감시 중')[1];
    expect(watch).toContain('(3)');
    expect(watch.split('· 약 100,000원')).toHaveLength(3); // INTC·MU
    expect(watch).toContain('· 2주');
    expect(watch).not.toMatch(/100000\.00|360,000/);
  });
  test('진입 감시 중: 해외는 서버 저장 달러 구간 우선, 없으면 지금 환율(1400) 환산 폴백, 국내는 ₩', () => {
    const watch = text(renderRecommend(T062_FIXTURE)).split('👁 진입 감시 중')[1];
    expect(watch).toContain('진입구간 $20.10 ~ $20.50');      // INTC: price_zone_usd 그대로 (1400 환산이면 $19.10 ~ $19.48)
    expect(watch).not.toContain('$19.10');
    expect(watch).toContain('진입구간 $100.00 ~ $102.00');    // MU: 140000/1400 폴백
    expect(watch).toContain('진입구간 ₩180,000 ~ ₩182,000');  // 국내
    expect(watch).toContain('🌐INTC');                        // market SELECT 로 해외 판정(G8)
    expect(watch).toContain('🇰🇷000660');
  });
});

// ─── R-2 승인 화면 ScenarioDetail ────────────────────────────────────────────

function renderDetail(signal: unknown): string {
  mockStateQueue.length = 0;
  mockStateQueue.push(signal, false); // signal · loading=false
  const html = renderToStaticMarkup(h(ScenarioDetail, { signalId: (signal as { id: number }).id }));
  expect(mockStateQueue).toHaveLength(0);
  return html;
}

const CMCSA_ROW = T062_FIXTURE.find(r => r.id === 106)!;
/** 상세 API 는 indicators 를 객체로 파싱해 준다. */
const CMCSA_DETAIL = { ...CMCSA_ROW, indicators: CMCSA_INDICATORS };
const DOMESTIC_DETAIL = { ...T062_FIXTURE.find(r => r.id === 103)! };

/** 헤더(첫 sticky 줄) 글자. */
function header(html: string): string {
  return text(html.split('현재가')[0]);
}

describe('R-2 승인 화면 ScenarioDetail 배선', () => {
  test('해외 CMCSA: 헤더 "🇺🇸 미국" 배지(국기 단독 아님) · 등급 B+', () => {
    const html = renderDetail(CMCSA_DETAIL);
    expect(header(html)).toBe('←매수🇺🇸미국CMCSAB+');
    expect(html).toContain('<span aria-hidden="true">🇺🇸</span>미국');
  });
  test('해외 CMCSA: 현재가 아래 유효(미국 정규장)·노랑 실적 줄 — AI 평가 앞', () => {
    const t = text(renderDetail(CMCSA_DETAIL));
    const iValid = t.indexOf('유효: 미국 정규장 10-21(수) 22:30 ~ 10-22(목) 05:00 KST');
    const iEarn = t.indexOf('⚠ 실적 발표 추정 기간과 겹침 · 10-24 ~ 10-31 (추정, 미확정)');
    expect(iValid).toBeGreaterThan(t.indexOf('현재가'));
    expect(iEarn).toBeGreaterThan(iValid);
    expect(t.indexOf('AI 평가')).toBeGreaterThan(iEarn);
  });
  test('해외 CMCSA: AI 권장 진입 구간 달러 주표기 + 원화 보조 줄', () => {
    const t = text(renderDetail(CMCSA_DETAIL));
    expect(t).toContain('AI 권장 진입 구간: $27.20 ~ $27.60≈ 36,176 ~ 36,708원 · 카드 환율 1,330 (10-21 08:00) · 자동 진입은 이 원화 구간으로 판단');
    expect(t).not.toContain('AI 권장 진입 구간: 36176~36708');
  });
  test('indicators 가 문자열로 와도(상세 API 파싱 실패 경로) 같은 화면', () => {
    expect(text(renderDetail(CMCSA_ROW))).toBe(text(renderDetail(CMCSA_DETAIL)));
  });
  test('G11-② 달러 구간 없는 해외(전략 시그널 등) → 원화 단위 표기 폴백', () => {
    const t = text(renderDetail(cmcsaWithoutUsd()));
    expect(t).toContain('AI 권장 진입 구간: 36,176 ~ 36,708원');
    expect(t).not.toContain('$27.20');
  });
  test('market 이 없는 구 응답도 심볼로 해외 판정', () => {
    const { market: _m, ...noMarket } = CMCSA_DETAIL;
    void _m;
    expect(header(renderDetail(noMarket))).toBe('←매수🇺🇸미국CMCSAB+');
  });
  test('국내 005930: 🇰🇷 국기·배지 없음·유효/실적 줄 없음·진입 구간 원문 문자열', () => {
    const html = renderDetail(DOMESTIC_DETAIL);
    const t = text(html);
    expect(header(html)).toBe('←매수🇰🇷005930A');
    expect(t).not.toMatch(/미국|유효:|실적/);
    expect(t).toContain('AI 권장 진입 구간: 71200~72500');
  });
});

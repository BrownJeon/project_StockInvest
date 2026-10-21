/**
 * T-062 WP-U Reviewer R-3 — 국내 카드 마크업 골든의 **입력**.
 *
 * HEAD `7cd47e7` 코드에 이 입력을 넣어 `renderToStaticMarkup` 한 결과가 `t062-domestic-golden-head.ts` 의 기대값이다
 * (생성 절차는 그 파일 머리 주석). HEAD 가 정상적으로 그리던 모양(객체 indicators·number 금액)만 쓴다 —
 * 문자열 indicators·DECIMAL 문자열 금액은 HEAD 가 못 그리던 결함(G1·T-063)이라 골든 대상이 아니다.
 */

const FAR = '2099-01-01T00:00:00.000Z'; // 만료 임박 배지(60분 이내)가 시험 시각에 따라 바뀌지 않게

export const GOLDEN_CARDS = [
  // G1 — 매수·금액·등급 A·신뢰도 81 (WP-U 변경: 신뢰도 칸 1개 추가)
  { id: 201, symbol: '005930', side: 'buy', status: 'pending', expires_at: FAR, created_at: '2026-10-20T07:00:03.000Z',
    quantity: null, amount_krw: 100000, market: 'domestic', displayName: '삼성전자 (005930)', marketFlag: '🇰🇷',
    indicators: { ai: { confidence: 81, scenario: { grade: 'A', entry: { trigger: 'price_zone', price_zone: '71200~72500' }, exit: { target_pct: 3, stop_pct: 2, holding_days: '2일' } } } } },
  // G2 — 매도·수량·등급 B+·신뢰도 없음·리스크·내 시나리오 (WP-U 변경 없음 — R-4 "B+ %" 방지도 겸함)
  { id: 202, symbol: '066570', side: 'sell', status: 'pending', expires_at: FAR, created_at: '2026-10-20T07:00:02.000Z',
    quantity: 3, amount_krw: null, market: 'domestic', displayName: 'LG전자 (066570)', marketFlag: '🇰🇷', scenario_source: 'user',
    indicators: { ai: { scenario: { grade: 'B+', entry: { trigger: '눌림목 지지 확인 후 진입' }, exit: { stop_pct: -1.5, stop_pct_hi: -2, holding_days: '1~2일' }, risk_factors: ['거래량 급감'] } } } },
  // G3 — 등급 C·신뢰도 55·목표 범위·소수 금액 (WP-U 변경: 신뢰도 칸)
  { id: 203, symbol: '035720', side: 'buy', status: 'pending', expires_at: FAR, created_at: '2026-10-20T07:00:01.000Z',
    quantity: null, amount_krw: 250000.5, market: 'domestic', displayName: '카카오 (035720)', marketFlag: '🇰🇷',
    indicators: { ai: { confidence: 55, scenario: { grade: 'C', entry: { trigger: 'price_zone' }, exit: { target_pct: 2, target_pct_hi: 3, holding_days: '3일' } } } } },
  // G4 — 등급 'D'(정의 밖 값 — HEAD 도 글자 그대로 C 색으로 그림)·신뢰도 90 (WP-U 변경: 신뢰도 칸)
  { id: 204, symbol: '000660', side: 'buy', status: 'pending', expires_at: FAR, created_at: '2026-10-20T07:00:00.000Z',
    quantity: null, amount_krw: 100000, market: 'domestic', displayName: 'SK하이닉스 (000660)', marketFlag: '🇰🇷',
    indicators: { ai: { confidence: 90, scenario: { grade: 'D', exit: { target_pct: 1 } } } } },
  // G5 — indicators null·금액 없음 (WP-U 변경 없음)
  { id: 205, symbol: '005380', side: 'buy', status: 'pending', expires_at: FAR, created_at: '2026-10-20T06:59:59.000Z',
    quantity: null, amount_krw: null, market: 'domestic', displayName: '005380', marketFlag: '🇰🇷', indicators: null },
] as const;

/** "내일" 탭 국내 카드 — HEAD 는 정렬하지 않으므로 입력을 이미 평가등급순으로 둔다(정렬 효과와 마크업 변화를 분리). */
export const GOLDEN_TOMORROW = [
  { id: 301, symbol: '005930', strategy_id: null, price: null, reasoning: null, status: 'pending',
    valid_from: '2026-10-21T00:00:00.000Z', expires_at: '2026-10-21T06:30:00.000Z',
    indicators: { pattern: 'eod-high-close', ai: { confidence: 81, reasoning_short: '고점 마감, 거래량 1.8배.', scenario: { grade: 'A', entry: { trigger: 'price_zone', price_zone: '71200~72500' }, exit: { target_pct: 3, stop_pct: 2, holding_days: '2일' } } } } },
  { id: 302, symbol: '066570', strategy_id: 'inside-bar', price: null, reasoning: null, status: 'pending',
    valid_from: '2026-10-21T00:00:00.000Z', expires_at: '2026-10-21T06:30:00.000Z',
    indicators: { ai: { confidence: 71, scenario: { grade: 'B+', entry: { price_zone: '84300~85600' }, exit: { target_pct: 4, stop_pct: 2 } } } } },
  { id: 303, symbol: '035720', strategy_id: null, price: null, reasoning: null, status: 'pending',
    valid_from: null, expires_at: null,
    indicators: { pattern: 'oversold-bounce', ai: { scenario: { grade: 'B', exit: { holding_days: '3일' } } } } },
] as const;

export const GOLDEN_SYMBOL_META: Record<string, string> = { '005930': '삼성전자' };

/**
 * T-108 §1.2 — 거래(`/recommend`) URL 해석 순수 함수 (React·fetch 무관, 시험 대상 C-1).
 *
 * 거래 = 운용 현황(now) · 보유·주문(hold) · 운영 기록(log) 3칸, 기본은 운용 현황.
 * 상세 보기(`detail`)는 옛 분석 탭에서 옮겨 온 기존 컴포넌트 3개다 — 그 상세가 속한 세그먼트에서만 연다
 * (`?tab=log&detail=orders` 는 열고, `?tab=now&detail=orders` 처럼 짝이 안 맞으면 `tab` 만 따르고 상세는 무시한다).
 * 모르는 `tab` 은 조용히 운용 현황으로 — 옛 주소 `/recommend`(쿼리 없음)도 그대로 운용 현황이다.
 */

export type TradeSegment = 'now' | 'hold' | 'log';
export type TradeDetail = 'orders' | 'notes' | 'trailing';
export interface TradeRoute { seg: TradeSegment; detail: TradeDetail | null }

export const TRADE_SEGMENTS: { id: TradeSegment; text: string }[] = [
  { id: 'now',  text: '운용 현황' },
  { id: 'hold', text: '보유·주문' },
  { id: 'log',  text: '운영 기록' },
];

/** 상세 보기 → 속한 세그먼트와 머리 제목. */
export const TRADE_DETAILS: Record<TradeDetail, { seg: TradeSegment; title: string }> = {
  orders:   { seg: 'log',  title: '주문 기록 전체' },
  notes:    { seg: 'log',  title: '투자일지' },
  trailing: { seg: 'hold', title: '포지션 추적' },
};

const SEGMENT_IDS = new Set<string>(TRADE_SEGMENTS.map(s => s.id));

function isDetail(v: string): v is TradeDetail {
  return Object.prototype.hasOwnProperty.call(TRADE_DETAILS, v);
}

export function resolveTradeRoute(tab: string | null | undefined, detail: string | null | undefined): TradeRoute {
  const seg: TradeSegment = tab && SEGMENT_IDS.has(tab) ? (tab as TradeSegment) : 'now';
  if (detail && isDetail(detail) && TRADE_DETAILS[detail].seg === seg) return { seg, detail };
  return { seg, detail: null };
}

/** 화면 상태 → 주소창에 맞출 쿼리(`router.replace` 용). */
export function tradeQuery(route: { seg: TradeSegment; detail?: TradeDetail | null }): string {
  return route.detail ? `?tab=${route.seg}&detail=${route.detail}` : `?tab=${route.seg}`;
}

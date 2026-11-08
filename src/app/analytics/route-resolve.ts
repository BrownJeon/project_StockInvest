/**
 * T-108 §1.2 — 분석(`/analytics`) URL 해석 순수 함수 (React·fetch 무관, 시험 대상 C-1).
 *
 * 분석은 3분류(오늘 분석 · 검증·성과 · 데이터 상태)가 되고, 옛 8탭 중 5개는 그 안의 「상세 보기」로,
 * 3개(거래 이력·투자일지·포지션 추적)는 거래 탭으로 옮겨 간다. **옛 `?tab=` 딥링크는 하나도 404·빈 화면이 되지 않는다** —
 * 모르는 값은 조용히 기본 세그먼트(오늘 분석)로 간다.
 *
 * 화면(`AnalyticsPage`)은 지금처럼 마운트 뒤 `window.location.search` 를 한 번 읽어 이 함수에 넘긴다
 * (`useSearchParams()` 는 Suspense 경계가 필요해 hydration 불일치를 피하려고 쓰지 않는다 — 기존 주석 이유 유지).
 */

export type AnalyticsSegment = 'today' | 'verify' | 'data';
/** 분석 안에 남는 옛 탭(상세 보기). 기존 컴포넌트를 수정 없이 그린다. */
export type AnalyticsDetail = 'research' | 'leaderboard' | 'missed' | 'diagnostics' | 'portfolio' | 'm40';

export type AnalyticsRoute =
  | { kind: 'segment'; seg: AnalyticsSegment }
  | { kind: 'detail'; seg: AnalyticsSegment; detail: AnalyticsDetail }
  | { kind: 'redirect'; href: string };

export const ANALYTICS_SEGMENTS: { id: AnalyticsSegment; text: string }[] = [
  { id: 'today',  text: '오늘 분석' },
  { id: 'verify', text: '검증·성과' },
  { id: 'data',   text: '데이터 상태' },
];

/** 상세 보기 → 속한 세그먼트(강조할 세그먼트)와 머리 제목. */
export const ANALYTICS_DETAILS: Record<AnalyticsDetail, { seg: AnalyticsSegment; title: string }> = {
  m40:         { seg: 'today', title: 'M40 모의분석' },
  research:    { seg: 'today',  title: '리서치분석' },
  leaderboard: { seg: 'today',  title: '주도주' },
  missed:      { seg: 'verify', title: '놓친 기회' },
  diagnostics: { seg: 'verify', title: '신호 진단' },
  portfolio:   { seg: 'verify', title: '포트폴리오' },
};

/** 거래 탭으로 옮겨 간 옛 분석 탭 → 새 주소(§1.2). 클라이언트에서 `router.replace` 로 보낸다. */
export const ANALYTICS_REDIRECTS: Record<string, string> = {
  orders:   '/recommend?tab=log&detail=orders',
  notes:    '/recommend?tab=log&detail=notes',
  trailing: '/recommend?tab=hold&detail=trailing',
};

const SEGMENT_IDS = new Set<string>(ANALYTICS_SEGMENTS.map(s => s.id));

function isDetail(v: string): v is AnalyticsDetail {
  return Object.prototype.hasOwnProperty.call(ANALYTICS_DETAILS, v);
}

export function resolveAnalyticsRoute(tab: string | null | undefined): AnalyticsRoute {
  if (!tab) return { kind: 'segment', seg: 'today' };
  if (SEGMENT_IDS.has(tab)) return { kind: 'segment', seg: tab as AnalyticsSegment };
  if (isDetail(tab)) return { kind: 'detail', seg: ANALYTICS_DETAILS[tab].seg, detail: tab };
  if (Object.prototype.hasOwnProperty.call(ANALYTICS_REDIRECTS, tab)) return { kind: 'redirect', href: ANALYTICS_REDIRECTS[tab] };
  return { kind: 'segment', seg: 'today' };   // 그 밖의 값 — 조용히 기본값
}

/** 화면 상태 → 주소창에 맞출 쿼리(`router.replace` 용). 세그먼트·상세 모두 `?tab=` 하나로 표현한다. */
export function analyticsQuery(route: { seg: AnalyticsSegment; detail?: AnalyticsDetail | null }): string {
  return `?tab=${route.detail ?? route.seg}`;
}

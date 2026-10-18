/**
 * T-049 — 대시보드 "내 결정" 섹션의 순수 판정 모듈 (렌더 없음, node 테스트 대상).
 *
 * 정본: `agent-vault/10-Flow/tasks/T-049-dashboard-executing-label.md` Designer [20:52] 구현 가이드 §3·§4,
 * 승인 데모 `mockups/T-049-dashboard-executing-label-v2.html`.
 *
 * 🔴 핵심 규칙 — `executing` 시그널은 "주문 번호 있음 = 거래소 접수" 가 아니다.
 *    `submitOrder` 는 안전장치 검사 전에 `orders` 행을 만들고, 결과 불명(KIS 5xx·연결 끊김) 주문에도
 *    번호가 연결된다. 그래서 주문 기록 상태(`order_status`, `GET /api/signals?withOrder=1`)로 나누고,
 *    **판정표에 없는 조합은 전부 "주문 여부 확인 필요"** 로 떨어뜨린다(안전한 쪽).
 *
 * 표시 로직이라 `src/lib/signals/`(안전 경로) 밖에 둔다. 색은 같은 화면 "최근 주문"
 * (`RecentExecutionsSection` `ORDER_STATUS_META`)과 맞추고, 일치 여부는 테스트가 확인한다.
 */
import { kstTodayStart } from '@/lib/time';

export type Period = '1d' | '7d' | '30d';
export type FilterType = 'all' | 'approved' | 'rejected' | 'expired';

/** `GET /api/signals?…&withOrder=1` 응답 행 중 이 섹션이 읽는 필드. */
export interface DecisionSignal {
  id: number;
  symbol: string;
  side: 'buy' | 'sell';
  status: string;
  /** decimal 이 문자열로 온다 — 표시 때 `Number()` */
  amount_krw: string;
  consumed_order_id: number | null;
  created_at: string;
  updated_at: string | null;
  /** orders.status 원문(9값) — 번호 없음·주문 행 없음이면 null */
  order_status: string | null;
  order_blocked_by: string | null;
}

export type OutcomeKind =
  // 1행 — executing 이 아닌 상태(원본 문구)
  | 'watch' | 'auto' | 'approved' | 'rejected' | 'expired' | 'none'
  // 2~6행 — 번호 있음 + 확정된 주문 상태
  | 'accepted' | 'partial' | 'filled' | 'cancelled' | 'test'
  // 8행 — 번호 없음 10분 이하
  | 'pending'
  // 7·9행 — 확인 필요(경고)
  | 'check';

export interface DecisionOutcome {
  kind: OutcomeKind;
  text: string;
  color: string;
  /** 문구 앞 장식 기호 — 렌더 때 aria-hidden */
  icon: string | null;
  /** 시각적으로 숨긴 낭독용 접두 */
  srPrefix: string | null;
  /** 카드 안 안내 줄(항상 표시) */
  hint: boolean;
}

/** 번호 없는 executing 이 이 시간을 **초과**해 갱신되지 않으면 경고 — 경보 `findStuckExecutions` 와 같은 기준. */
export const STUCK_MS = 600_000;
/**
 * R-3 (Leader 결정 — 가이드 §3 ③ 의 "음수는 0" 과 다름): `updated_at` 이 이 시간을 **초과**해 미래면
 * 시계·데이터 이상으로 보고 "경과 모름"과 같게 경고한다. 이 이내 미래는 폰 시계 편차로 보고 0 으로 클램프.
 */
export const FUTURE_SKEW_MS = 300_000;
export const HINT_TEXT = 'KIS 체결 내역 먼저 확인 · 확인 전 재주문 금지';
export const PAGE_SIZE = 7;
export const DECISION_STATUSES = 'approved,rejected,approved_pending_entry,executing,expired,auto_submitted';
/** 원본 그대로 — 기간이 길면 건수가 실제보다 적게 보일 수 있다(재개편 때 처리할 후속 항목). */
export const DECISIONS_LIMIT = 200;

export const PERIOD_LABEL: Record<Period, string> = { '1d': '1일', '7d': '7일', '30d': '30일' };
export const PERIOD_SUB: Record<Period, string> = { '1d': '오늘', '7d': '최근 7일', '30d': '최근 30일' };

const WARN_COLOR = 'var(--warn)';

const APPROVED_STATUSES = ['approved', 'approved_pending_entry', 'executing', 'auto_submitted'];

export function isApprovedStatus(status: string): boolean {
  return APPROVED_STATUSES.includes(status);
}

/** 결정 배지 — 원본 `MyDecisionTab.decisionBadge` 그대로. */
export function decisionBadge(status: string): { text: string; bg: string; color: string } {
  if (isApprovedStatus(status)) return { text: '승인', bg: 'rgba(96,165,250,0.15)', color: '#60a5fa' };
  if (status === 'rejected') return { text: '거절', bg: 'rgba(100,100,100,0.12)', color: 'var(--muted)' };
  return { text: '만료', bg: 'rgba(100,100,100,0.10)', color: 'var(--muted)' };
}

function plain(kind: OutcomeKind, text: string, color: string, icon: string | null = null): DecisionOutcome {
  return { kind, text, color, icon, srPrefix: null, hint: false };
}

function check(text: string): DecisionOutcome {
  return { kind: 'check', text, color: WARN_COLOR, icon: '⚠', srPrefix: '경고: ', hint: true };
}

/** 1행 — executing 이 아닌 상태. 원본 `outcomeText` + 카드 본문(거절됨·만료) 그대로. */
function nonExecutingOutcome(status: string): DecisionOutcome {
  switch (status) {
    case 'approved_pending_entry': return plain('watch', '진입 감시 중', '#fbbf24');
    case 'auto_submitted':         return plain('auto', '자동 제출됨', 'var(--up)');
    case 'approved':               return plain('approved', '즉시 승인', 'var(--up)');
    case 'rejected':               return plain('rejected', '거절됨', 'var(--muted)');
    case 'expired':                return plain('expired', '만료 — 조치 없음', 'var(--muted)');
    default:                       return plain('none', '', 'var(--muted)');
  }
}

/**
 * 상태→표시 판정 (가이드 §3 판정표). **위에서부터 처음 맞는 행 하나만** 적용한다.
 * `nowMs` 는 클라이언트 `Date.now()` — 경과 시간 기준은 `updated_at`.
 */
export function decisionOutcome(
  s: Pick<DecisionSignal, 'status' | 'consumed_order_id' | 'order_status' | 'updated_at'>,
  nowMs: number,
): DecisionOutcome {
  // 1행
  if (s.status !== 'executing') return nonExecutingOutcome(s.status);

  // 2~7행 — 번호 있음
  if (s.consumed_order_id != null) {
    const n = `#${s.consumed_order_id}`;
    switch (s.order_status) {
      case 'accepted':         return plain('accepted', `주문 접수됨 ${n}`, '#818cf8');
      case 'partially_filled': return plain('partial', `부분체결 ${n}`, 'var(--accent)');
      case 'filled':           return plain('filled', `체결됨 ${n}`, 'var(--ok)', '✓');
      case 'cancelled':        return plain('cancelled', `주문 취소됨 ${n}`, 'var(--muted)');
      case 'dry_run':          return plain('test', `테스트 ${n} · 실주문 아님`, 'var(--muted)');
      // 7행 — rejected(모든 사유·사유 없음)·failed·pending·blocked·주문 행 없음(null)·모르는 값
      default:                 return check(`주문 여부 확인 필요 ${n}`);
    }
  }

  // 8·9행 — 번호 없음
  const t = s.updated_at ? new Date(s.updated_at).getTime() : NaN;
  if (!Number.isFinite(t)) return check('주문 여부 확인 필요'); // 경과를 모르면 분 표시 생략
  if (t - nowMs > FUTURE_SKEW_MS) return check('주문 여부 확인 필요'); // 5분 넘는 미래 = 경과 모름 (R-3)
  const elapsed = Math.max(0, nowMs - t);
  if (elapsed > STUCK_MS) return check(`주문 여부 확인 필요 · ${Math.floor(elapsed / 60_000)}분째`);
  return plain('pending', '주문 처리 중…', 'var(--muted)');
}

export interface DecisionCounts {
  all: number;
  approved: number;
  rejected: number;
  expired: number;
  /** 확인 필요(kind=check) — 필터와 무관하게 불러온 목록 전체 기준 */
  check: number;
}

export function countDecisions(list: readonly DecisionSignal[], nowMs: number): DecisionCounts {
  const c: DecisionCounts = { all: list.length, approved: 0, rejected: 0, expired: 0, check: 0 };
  for (const s of list) {
    if (isApprovedStatus(s.status)) c.approved++;
    else if (s.status === 'rejected') c.rejected++;
    else if (s.status === 'expired') c.expired++;
    if (decisionOutcome(s, nowMs).kind === 'check') c.check++;
  }
  return c;
}

export function filterDecisions(list: readonly DecisionSignal[], filter: FilterType): DecisionSignal[] {
  switch (filter) {
    case 'approved': return list.filter(s => isApprovedStatus(s.status));
    case 'rejected': return list.filter(s => s.status === 'rejected');
    case 'expired':  return list.filter(s => s.status === 'expired');
    default:         return list.slice();
  }
}

/** 현재 쪽을 `[0, totalPages-1]` 로 클램프하고 slice 범위를 돌려준다(재조회로 건수가 줄어도 빈 쪽이 안 남게). */
export function pageWindow(total: number, page: number): { totalPages: number; page: number; start: number; end: number } {
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const p = Math.min(Math.max(0, page), Math.max(0, totalPages - 1));
  const start = p * PAGE_SIZE;
  return { totalPages, page: p, start, end: Math.min(total, start + PAGE_SIZE) };
}

/** 기간 시작 시각(ms). 1일 = KST 오늘 00:00(대시보드 `todayStart()` 와 같은 함수). */
export function periodSinceMs(period: Period, nowMs: number): number {
  if (period === '1d') return kstTodayStart(new Date(nowMs)).getTime();
  return nowMs - (period === '7d' ? 7 : 30) * 86_400_000;
}

export function buildDecisionsUrl(period: Period, nowMs: number): string {
  const since = new Date(periodSinceMs(period, nowMs)).toISOString();
  return `/api/signals?status=${DECISION_STATUSES}&since=${since}&limit=${DECISIONS_LIMIT}&includeExpired=1&withOrder=1`;
}

/** 응답 판정 — `ok:false`·`data` 가 배열 아님·본문 이상은 **오류(null)** 이지 빈 목록이 아니다. */
export function parseDecisionsResponse(j: unknown): DecisionSignal[] | null {
  if (!j || typeof j !== 'object') return null;
  const o = j as { ok?: unknown; data?: unknown };
  if (o.ok !== true || !Array.isArray(o.data)) return null;
  return o.data as DecisionSignal[];
}

/**
 * R-1 — `executing` 전용 조회 URL. 본 조회(`buildDecisionsUrl`)는 `limit=200` 이라 최신 만료 행이 창을 채워
 * (운영 실측: 7일 창이 약 3일로 줄어듦) 오래된 executing 이 밀려난다. 같은 `since` 로 executing 만 따로 받는다.
 * 두 URL 은 **같은 `nowMs`** 로 만들어야 기간이 어긋나지 않는다.
 */
export function buildExecutingUrl(period: Period, nowMs: number): string {
  const since = new Date(periodSinceMs(period, nowMs)).toISOString();
  return `/api/signals?status=executing&since=${since}&limit=${DECISIONS_LIMIT}&includeExpired=1&withOrder=1`;
}

function createdMs(s: DecisionSignal): number {
  const t = new Date(s.created_at).getTime();
  return Number.isFinite(t) ? t : -Infinity;
}

/** 두 응답을 id 로 중복 제거해 합치고 API 와 같은 순서(`created_at DESC, id DESC`)로 정렬. 입력은 바꾸지 않는다. */
export function mergeDecisionRows(
  main: readonly DecisionSignal[],
  executingOnly: readonly DecisionSignal[],
): DecisionSignal[] {
  const byId = new Map<number, DecisionSignal>();
  for (const s of main) byId.set(s.id, s);
  for (const s of executingOnly) if (!byId.has(s.id)) byId.set(s.id, s);
  return [...byId.values()].sort((a, b) => (createdMs(b) - createdMs(a)) || (b.id - a.id));
}

/**
 * 본 조회 + executing 전용 조회 응답을 **한 묶음**으로 판정한다. 둘 중 하나라도 오류면 null(전체 오류) —
 * 한쪽만 성공한 결과를 정상처럼 보이면 확인 필요 주문이 숨는다(이 작업이 막으려는 것).
 */
export function combineDecisionResponses(mainJson: unknown, executingJson: unknown): DecisionSignal[] | null {
  const main = parseDecisionsResponse(mainJson);
  const exe = parseDecisionsResponse(executingJson);
  if (!main || !exe) return null;
  return mergeDecisionRows(main, exe);
}

/** `fetch` 와 같은 모양의 최소 인터페이스 — 테스트에서 가짜를 주입한다. */
export type JsonFetch = (url: string) => Promise<{ json(): Promise<unknown> }>;

/**
 * 섹션 한 번의 조회 묶음. 두 URL 은 같은 `nowMs` 로 만든다(같은 `since`).
 *
 * 🔴 **순차인 이유 (R-8, Codex C2)** — `mergeDecisionRows` 는 중복 id 에서 **본 조회 행이 이긴다.**
 *    이 규칙이 옳으려면 본 조회가 항상 더 최신 스냅샷이어야 한다. 동시에 보내면 어느 쪽이 나중
 *    스냅샷인지 보장이 없어, 이미 취소·체결된 주문이 낡은 "접수됨"으로 남을 수 있다(재주문 판단에 쓰는
 *    안전 정보). 그래서 **executing 전용 조회를 먼저 끝까지 받고, 그 다음 본 조회**를 보낸다.
 *    지연은 요청 2개 직렬(수십 ms)이라 30초 주기에 영향이 없다.
 *
 * 둘 중 하나라도 네트워크 오류·비 JSON·`ok:false`·`data` 이상이면 **null**(전체 오류, 부분 성공 금지).
 * 예외를 던지지 않는다.
 */
export async function fetchDecisionBundle(
  fetchFn: JsonFetch,
  period: Period,
  nowMs: number,
): Promise<DecisionSignal[] | null> {
  try {
    const executingJson = await (await fetchFn(buildExecutingUrl(period, nowMs))).json();
    const mainJson = await (await fetchFn(buildDecisionsUrl(period, nowMs))).json();
    return combineDecisionResponses(mainJson, executingJson);
  } catch {
    return null;
  }
}

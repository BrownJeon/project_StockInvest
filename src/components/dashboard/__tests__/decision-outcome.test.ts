/**
 * T-049 — 대시보드 "내 결정" 섹션의 상태→표시 판정표(구현 가이드 §3) 고정.
 *
 * 이 작업이 막으려는 것: 주문 번호가 없거나 결과를 모르는 `executing` 이 "주문 실행됨"처럼
 * 정상으로 보이는 것. 그래서 **표에 없는 조합은 전부 "주문 여부 확인 필요"** 쪽으로 떨어져야 한다.
 * RTL·jsdom 없는 node 환경이라 렌더 대신 순수 판정 함수를 검증한다(`safety-bar-outcome.test.ts` 선례).
 */
import {
  DECISION_STATUSES,
  HINT_TEXT,
  PAGE_SIZE,
  STUCK_MS,
  FUTURE_SKEW_MS,
  buildDecisionsUrl,
  buildExecutingUrl,
  combineDecisionResponses,
  fetchDecisionBundle,
  mergeDecisionRows,
  countDecisions,
  decisionBadge,
  decisionOutcome,
  filterDecisions,
  pageWindow,
  parseDecisionsResponse,
  periodSinceMs,
  type DecisionSignal,
} from '@/components/dashboard/decision-outcome';
import { ORDER_STATUS_META } from '@/components/dashboard/RecentExecutionsSection';
import { kstTodayStart } from '@/lib/time';

const NOW = Date.parse('2026-10-18T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function sig(over: Partial<DecisionSignal> = {}): DecisionSignal {
  return {
    id: 1, symbol: '005930', side: 'buy', status: 'executing', amount_krw: '100000.00',
    consumed_order_id: null, created_at: ago(60_000), updated_at: ago(60_000),
    order_status: null, order_blocked_by: null,
    ...over,
  };
}
const withOrder = (order_status: string | null, order_blocked_by: string | null = null, id = 1234) =>
  sig({ consumed_order_id: id, order_status, order_blocked_by });

// ── 1행: executing 이 아닌 상태 — 원본 outcomeText 그대로 ──────────────────
describe('1행 — executing 이 아닌 상태는 원본 문구·색 그대로', () => {
  test.each([
    ['approved_pending_entry', '진입 감시 중', '#fbbf24'],
    ['auto_submitted', '자동 제출됨', 'var(--up)'],
    ['approved', '즉시 승인', 'var(--up)'],
    ['rejected', '거절됨', 'var(--muted)'],
    ['expired', '만료 — 조치 없음', 'var(--muted)'],
  ])('%s → "%s"', (status, text, color) => {
    const o = decisionOutcome(sig({ status }), NOW);
    expect(o.text).toBe(text);
    expect(o.color).toBe(color);
    expect(o.hint).toBe(false);
    expect(o.icon).toBeNull();
    expect(o.srPrefix).toBeNull();
    expect(o.kind).not.toBe('check');
  });

  test('executing 이 아닌 상태는 주문 상태 필드가 있어도 무시한다(1행이 먼저)', () => {
    const o = decisionOutcome(sig({ status: 'auto_submitted', consumed_order_id: 9, order_status: 'failed' }), NOW);
    expect(o.text).toBe('자동 제출됨');
    expect(o.kind).not.toBe('check');
  });

  test('rejected 는 1시간 뒤 가격 변화 값이 없으므로 "거절됨" 만 (price_change_pct 미사용)', () => {
    expect(decisionOutcome(sig({ status: 'rejected' }), NOW).text).toBe('거절됨');
  });

  test('목록에 없는 상태 → 원본처럼 결과 문구 없음(경고 아님)', () => {
    const o = decisionOutcome(sig({ status: 'superseded' }), NOW);
    expect(o.text).toBe('');
    expect(o.hint).toBe(false);
  });
});

// ── 2~6행: 번호 있음 · 확정된 주문 상태 ────────────────────────────────────
describe('2~6행 — 번호 있음 + 주문 기록 상태', () => {
  test('2 accepted → "주문 접수됨 #N" (최근 주문 "접수됨" 과 같은 색)', () => {
    const o = decisionOutcome(withOrder('accepted'), NOW);
    expect(o).toEqual({
      kind: 'accepted', text: '주문 접수됨 #1234', color: ORDER_STATUS_META.accepted.color,
      icon: null, srPrefix: null, hint: false,
    });
    expect(o.color).toBe('#818cf8');
  });

  test('3 partially_filled → "부분체결 #N"', () => {
    const o = decisionOutcome(withOrder('partially_filled'), NOW);
    expect(o).toMatchObject({ kind: 'partial', text: '부분체결 #1234', icon: null, hint: false });
    expect(o.color).toBe(ORDER_STATUS_META.partially_filled.color);
  });

  test('4 filled → "체결됨 #N" + ✓', () => {
    const o = decisionOutcome(withOrder('filled'), NOW);
    expect(o).toMatchObject({ kind: 'filled', text: '체결됨 #1234', icon: '✓', srPrefix: null, hint: false });
    expect(o.color).toBe(ORDER_STATUS_META.filled.color);
  });

  test('5 cancelled → "주문 취소됨 #N"', () => {
    const o = decisionOutcome(withOrder('cancelled'), NOW);
    expect(o).toMatchObject({ kind: 'cancelled', text: '주문 취소됨 #1234', icon: null, hint: false });
    expect(o.color).toBe(ORDER_STATUS_META.cancelled.color);
  });

  test('6 dry_run → "테스트 #N · 실주문 아님" (회색 — 최근 주문의 주황 테스트 배지와 다름, 가이드 §3)', () => {
    const o = decisionOutcome(withOrder('dry_run'), NOW);
    expect(o).toMatchObject({ kind: 'test', text: '테스트 #1234 · 실주문 아님', color: 'var(--muted)', hint: false });
  });

  test('번호가 있으면 updated_at 이 오래돼도 주문 상태가 우선(경과 시간으로 경고하지 않음)', () => {
    const o = decisionOutcome(sig({ consumed_order_id: 5, order_status: 'accepted', updated_at: ago(3 * 3_600_000) }), NOW);
    expect(o.kind).toBe('accepted');
  });
});

// ── 7행: 번호 있음 · 그 밖 전부 → 확인 필요 ────────────────────────────────
describe('7행 — 번호 있음 + 그 밖 전부는 "주문 여부 확인 필요 #N" (안전한 기본값)', () => {
  test.each<[string, string | null, string | null]>([
    ['rejected kis_5xx', 'rejected', 'kis_5xx'],
    ['rejected network_error', 'rejected', 'network_error'],
    ['rejected kis_rejected', 'rejected', 'kis_rejected'],
    ['rejected insufficient_balance', 'rejected', 'insufficient_balance'],
    ['rejected 사유 없음', 'rejected', null],
    ['failed', 'failed', null],
    ['pending', 'pending', null],
    ['blocked', 'blocked', 'kill_switch'],
    ['주문 행 없음(null)', null, null],
    ['모르는 문자열', 'something_new', null],
    ['빈 문자열', '', null],
  ])('%s → check', (_label, os, by) => {
    const o = decisionOutcome(withOrder(os, by), NOW);
    expect(o).toEqual({
      kind: 'check', text: '주문 여부 확인 필요 #1234', color: 'var(--warn)',
      icon: '⚠', srPrefix: '경고: ', hint: true,
    });
  });

  test('"주문 안 나감" 대비 문구는 쓰지 않는다(Leader 결정 4)', () => {
    for (const os of ['rejected', 'blocked']) {
      expect(decisionOutcome(withOrder(os, 'kill_switch'), NOW).text).not.toContain('안 나감');
    }
  });

  test('번호 0 도 "번호 있음"으로 취급(null 만 번호 없음)', () => {
    const o = decisionOutcome(sig({ consumed_order_id: 0, order_status: 'accepted' }), NOW);
    expect(o.text).toBe('주문 접수됨 #0');
  });
});

// ── 8·9행: 번호 없음 — 10분 경계 ───────────────────────────────────────────
describe('8·9행 — 번호 없음: 10분 "초과" 부터 경고 (경보 findStuckExecutions 와 같은 기준)', () => {
  test('STUCK_MS 는 10분', () => { expect(STUCK_MS).toBe(600_000); });

  test('8 경과 2분 → "주문 처리 중…" (회색, 아이콘 없음)', () => {
    const o = decisionOutcome(sig({ updated_at: ago(2 * 60_000) }), NOW);
    expect(o).toEqual({
      kind: 'pending', text: '주문 처리 중…', color: 'var(--muted)', icon: null, srPrefix: null, hint: false,
    });
  });

  test('8 정확히 10분(600_000ms) → 아직 처리 중', () => {
    expect(decisionOutcome(sig({ updated_at: ago(600_000) }), NOW).kind).toBe('pending');
  });

  test('9 10분 + 1ms → 경고 "· 10분째"', () => {
    const o = decisionOutcome(sig({ updated_at: ago(600_001) }), NOW);
    expect(o).toEqual({
      kind: 'check', text: '주문 여부 확인 필요 · 10분째', color: 'var(--warn)',
      icon: '⚠', srPrefix: '경고: ', hint: true,
    });
  });

  test('9 10분 1초 → "10분째"', () => {
    expect(decisionOutcome(sig({ updated_at: ago(601_000) }), NOW).text).toBe('주문 여부 확인 필요 · 10분째');
  });

  test('9 14분 59초 → 표시 분은 내림 "14분째"', () => {
    expect(decisionOutcome(sig({ updated_at: ago(14 * 60_000 + 59_000) }), NOW).text)
      .toBe('주문 여부 확인 필요 · 14분째');
  });

  test('9 3시간 → "180분째"', () => {
    expect(decisionOutcome(sig({ updated_at: ago(3 * 3_600_000) }), NOW).text)
      .toBe('주문 여부 확인 필요 · 180분째');
  });

  // R-3 (Leader 결정, 가이드 §3 ③ 과 다름): 5분 이내 미래는 시계 편차 → 0 으로 보고 처리 중,
  // 5분 **초과** 미래는 시계·데이터 이상 → 경과 모름과 같게 경고(분 생략).
  test('FUTURE_SKEW_MS 는 5분', () => { expect(FUTURE_SKEW_MS).toBe(300_000); });

  test('8 updated_at 이 2분 미래(폰 시계가 느림) → 0 으로 보고 처리 중', () => {
    expect(decisionOutcome(sig({ updated_at: ago(-2 * 60_000) }), NOW).kind).toBe('pending');
  });

  test('8 정확히 5분 미래 → 아직 처리 중(경계는 "초과")', () => {
    expect(decisionOutcome(sig({ updated_at: ago(-300_000) }), NOW).kind).toBe('pending');
  });

  test('9 5분 + 1ms 미래 → 경고, 분 생략 (R-3)', () => {
    expect(decisionOutcome(sig({ updated_at: ago(-300_001) }), NOW)).toEqual({
      kind: 'check', text: '주문 여부 확인 필요', color: 'var(--warn)',
      icon: '⚠', srPrefix: '경고: ', hint: true,
    });
  });

  test('9 30분 미래 → 경고, 분 생략 (절댓값으로 "30분째"가 되지 않음)', () => {
    const o = decisionOutcome(sig({ updated_at: ago(-30 * 60_000) }), NOW);
    expect(o.kind).toBe('check');
    expect(o.text).toBe('주문 여부 확인 필요');
  });

  test('미래 판정은 번호 있는 행에 적용하지 않는다(주문 상태가 우선)', () => {
    const o = decisionOutcome(sig({ consumed_order_id: 7, order_status: 'filled', updated_at: ago(-60 * 60_000) }), NOW);
    expect(o.kind).toBe('filled');
  });

  test.each([null, undefined, '', 'not-a-date'])(
    '9 updated_at=%p (경과 모름) → 경고, "· N분째" 생략',
    (u) => {
      const o = decisionOutcome(sig({ updated_at: u as string | null }), NOW);
      expect(o).toMatchObject({ kind: 'check', text: '주문 여부 확인 필요', hint: true, icon: '⚠' });
    },
  );

  test('updated_at 은 created_at 이 아니라 기준이다', () => {
    const o = decisionOutcome(sig({ created_at: ago(3 * 3_600_000), updated_at: ago(60_000) }), NOW);
    expect(o.kind).toBe('pending');
  });
});

// ── hint / 색 일관성 ──────────────────────────────────────────────────────
describe('hint 는 check 일 때만 true', () => {
  const samples: DecisionSignal[] = [
    sig({ status: 'approved' }), sig({ status: 'rejected' }), sig({ status: 'expired' }),
    sig({ status: 'approved_pending_entry' }), sig({ status: 'auto_submitted' }),
    withOrder('accepted'), withOrder('partially_filled'), withOrder('filled'),
    withOrder('cancelled'), withOrder('dry_run'), withOrder('failed'), withOrder(null),
    sig({ updated_at: ago(60_000) }), sig({ updated_at: ago(30 * 60_000) }),
  ];
  test.each(samples.map((s, i) => [i, s] as const))('sample %i', (_i, s) => {
    const o = decisionOutcome(s, NOW);
    expect(o.hint).toBe(o.kind === 'check');
    expect(o.srPrefix !== null).toBe(o.kind === 'check');
  });

  test('안내 줄 문구', () => {
    expect(HINT_TEXT).toBe('KIS 체결 내역 먼저 확인 · 확인 전 재주문 금지');
  });
});

// ── 배지 ─────────────────────────────────────────────────────────────────
describe('decisionBadge — 원본 그대로', () => {
  test.each(['approved', 'approved_pending_entry', 'executing', 'auto_submitted'])('%s → 승인', (s) => {
    expect(decisionBadge(s)).toEqual({ text: '승인', bg: 'rgba(96,165,250,0.15)', color: '#60a5fa' });
  });
  test('rejected → 거절', () => {
    expect(decisionBadge('rejected')).toEqual({ text: '거절', bg: 'rgba(100,100,100,0.12)', color: 'var(--muted)' });
  });
  test('expired → 만료', () => {
    expect(decisionBadge('expired')).toEqual({ text: '만료', bg: 'rgba(100,100,100,0.10)', color: 'var(--muted)' });
  });
});

// ── 집계·필터 ────────────────────────────────────────────────────────────
describe('countDecisions / filterDecisions', () => {
  const list: DecisionSignal[] = [
    sig({ id: 1, status: 'approved' }),
    sig({ id: 2, status: 'approved_pending_entry' }),
    sig({ id: 3, status: 'executing', updated_at: ago(60_000) }),          // 처리 중
    sig({ id: 4, status: 'executing', updated_at: ago(20 * 60_000) }),     // 확인 필요
    sig({ id: 5, status: 'executing', consumed_order_id: 9, order_status: 'failed' }), // 확인 필요
    sig({ id: 6, status: 'executing', consumed_order_id: 8, order_status: 'filled' }),
    sig({ id: 7, status: 'auto_submitted' }),
    sig({ id: 8, status: 'rejected' }),
    sig({ id: 9, status: 'expired' }),
    sig({ id: 10, status: 'expired' }),
  ];

  test('건수 — 승인 = approved·approved_pending_entry·executing·auto_submitted', () => {
    expect(countDecisions(list, NOW)).toEqual({ all: 10, approved: 7, rejected: 1, expired: 2, check: 2 });
  });

  test('경고 건수는 필터와 무관하게 전체 목록 기준', () => {
    expect(countDecisions(filterDecisions(list, 'expired'), NOW).check).toBe(0);
    expect(countDecisions(list, NOW).check).toBe(2);
  });

  test('빈 목록', () => {
    expect(countDecisions([], NOW)).toEqual({ all: 0, approved: 0, rejected: 0, expired: 0, check: 0 });
  });

  test('필터 4종', () => {
    expect(filterDecisions(list, 'all').map(s => s.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(filterDecisions(list, 'approved').map(s => s.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(filterDecisions(list, 'rejected').map(s => s.id)).toEqual([8]);
    expect(filterDecisions(list, 'expired').map(s => s.id)).toEqual([9, 10]);
  });
});

// ── 페이지 ───────────────────────────────────────────────────────────────
describe('pageWindow — 7건씩, 범위 밖 쪽은 마지막 쪽으로 클램프', () => {
  test('PAGE_SIZE 7', () => { expect(PAGE_SIZE).toBe(7); });
  test('0건 → 0쪽', () => { expect(pageWindow(0, 0)).toEqual({ totalPages: 0, page: 0, start: 0, end: 0 }); });
  test('7건 → 1쪽(페이저 없음)', () => { expect(pageWindow(7, 0)).toEqual({ totalPages: 1, page: 0, start: 0, end: 7 }); });
  test('8건 → 2쪽, 둘째 쪽은 1건', () => {
    expect(pageWindow(8, 0)).toEqual({ totalPages: 2, page: 0, start: 0, end: 7 });
    expect(pageWindow(8, 1)).toEqual({ totalPages: 2, page: 1, start: 7, end: 8 });
  });
  test('재조회로 건수가 줄어 현재 쪽이 사라지면 마지막 쪽', () => {
    expect(pageWindow(8, 5)).toEqual({ totalPages: 2, page: 1, start: 7, end: 8 });
  });
  test('음수 쪽 → 0', () => { expect(pageWindow(8, -1).page).toBe(0); });
});

// ── 기간 · URL ───────────────────────────────────────────────────────────
describe('periodSinceMs / buildDecisionsUrl', () => {
  test('1일 = kstTodayStart (KST 자정) — 원본 sinceMs 의 전날 15:00 결함 없음', () => {
    expect(periodSinceMs('1d', NOW)).toBe(kstTodayStart(new Date(NOW)).getTime());
    // 2026-10-18T12:00Z = KST 21:00 → KST 자정 = 2026-10-17T15:00Z
    expect(new Date(periodSinceMs('1d', NOW)).toISOString()).toBe('2026-10-17T15:00:00.000Z');
  });

  test('1일 — KST 자정 직후(UTC 전날 15:30)도 그날 자정', () => {
    const t = Date.parse('2026-10-17T15:30:00.000Z');
    expect(new Date(periodSinceMs('1d', t)).toISOString()).toBe('2026-10-17T15:00:00.000Z');
  });

  test('7일·30일 = 지금 − N×86_400_000', () => {
    expect(periodSinceMs('7d', NOW)).toBe(NOW - 7 * 86_400_000);
    expect(periodSinceMs('30d', NOW)).toBe(NOW - 30 * 86_400_000);
  });

  test('정본 URL — includeExpired=1·withOrder=1·limit=200', () => {
    expect(buildDecisionsUrl('7d', NOW)).toBe(
      `/api/signals?status=${DECISION_STATUSES}&since=${new Date(NOW - 7 * 86_400_000).toISOString()}`
      + '&limit=200&includeExpired=1&withOrder=1',
    );
    expect(DECISION_STATUSES).toBe('approved,rejected,approved_pending_entry,executing,expired,auto_submitted');
  });
});

// ── 응답 판정 ────────────────────────────────────────────────────────────
describe('parseDecisionsResponse — 실패를 빈 목록으로 숨기지 않는다', () => {
  test('ok + 배열 → 배열', () => {
    const data = [sig()];
    expect(parseDecisionsResponse({ ok: true, data })).toBe(data);
  });
  test('ok + 빈 배열 → 빈 배열(오류 아님)', () => {
    expect(parseDecisionsResponse({ ok: true, data: [] })).toEqual([]);
  });
  test.each([
    [{ ok: false, error: 'x' }],
    [{ ok: true }],
    [{ ok: true, data: null }],
    [{ ok: true, data: {} }],
    [null],
    ['text'],
    [undefined],
  ])('%p → null (오류)', (j) => {
    expect(parseDecisionsResponse(j)).toBeNull();
  });
});

// ── R-1: executing 전용 2차 조회 + 병합 ───────────────────────────────────
// 본 조회는 limit=200 이라 최신 200건(대개 만료)이 다른 행을 밀어낸다 — 운영 실측상 7일 창이 약 3일로 준다.
// 그보다 오래된 executing 이 목록·요약 줄에서 사라지지 않도록 executing 만 따로 받아 합친다.
describe('buildExecutingUrl — 같은 since, status=executing 만', () => {
  test.each<'1d' | '7d' | '30d'>(['1d', '7d', '30d'])('%s', (p) => {
    const since = new Date(periodSinceMs(p, NOW)).toISOString();
    expect(buildExecutingUrl(p, NOW)).toBe(
      `/api/signals?status=executing&since=${since}&limit=200&includeExpired=1&withOrder=1`,
    );
    expect(buildDecisionsUrl(p, NOW)).toContain(`&since=${since}&`);
  });
});

describe('mergeDecisionRows — id 중복 제거 + API 와 같은 정렬(created_at DESC, id DESC)', () => {
  const at = (iso: string) => new Date(iso).toISOString();
  const row = (id: number, created: string, over: Partial<DecisionSignal> = {}) =>
    sig({ id, created_at: at(created), ...over });

  test('본 조회에 없는 executing 이 합쳐진다', () => {
    const main = [row(3, '2026-10-17T00:00:00Z', { status: 'expired' }), row(2, '2026-10-16T00:00:00Z', { status: 'expired' })];
    const exe = [row(1, '2026-10-12T00:00:00Z')];
    expect(mergeDecisionRows(main, exe).map(s => s.id)).toEqual([3, 2, 1]);
  });

  test('양쪽에 같은 id 가 있으면 한 번만', () => {
    const main = [row(5, '2026-10-17T00:00:00Z'), row(4, '2026-10-16T00:00:00Z', { status: 'expired' })];
    const exe = [row(5, '2026-10-17T00:00:00Z')];
    const m = mergeDecisionRows(main, exe);
    expect(m.map(s => s.id)).toEqual([5, 4]);
    expect(m).toHaveLength(2);
  });

  test('정렬 — created_at 내림차순, 같으면 id 내림차순', () => {
    const main = [row(10, '2026-10-15T00:00:00Z'), row(12, '2026-10-17T00:00:00Z')];
    const exe = [row(11, '2026-10-15T00:00:00Z'), row(13, '2026-10-16T00:00:00Z'), row(9, '2026-10-18T00:00:00Z')];
    expect(mergeDecisionRows(main, exe).map(s => s.id)).toEqual([9, 12, 13, 11, 10]);
  });

  test('created_at 이 파싱 불가면 맨 뒤(정렬이 깨지지 않음)', () => {
    const main = [row(1, '2026-10-15T00:00:00Z'), sig({ id: 2, created_at: 'bad' })];
    const exe = [row(3, '2026-10-16T00:00:00Z')];
    expect(mergeDecisionRows(main, exe).map(s => s.id)).toEqual([3, 1, 2]);
  });

  test('입력 배열을 바꾸지 않는다', () => {
    const main = [row(1, '2026-10-15T00:00:00Z')];
    const exe = [row(2, '2026-10-16T00:00:00Z')];
    mergeDecisionRows(main, exe);
    expect(main.map(s => s.id)).toEqual([1]);
    expect(exe.map(s => s.id)).toEqual([2]);
  });

  test('둘 다 비면 빈 배열', () => {
    expect(mergeDecisionRows([], [])).toEqual([]);
  });

  test('시나리오(R-1): 본 조회 200건 전부 만료 + 전용 조회에만 오래된 번호 없는 executing 1건 → 확인 필요 1건', () => {
    const main = Array.from({ length: 200 }, (_, i) =>
      row(10_000 - i, new Date(NOW - (i + 1) * 20 * 60_000).toISOString(), { status: 'expired' }));
    const old = row(42, '2026-10-12T00:00:00Z', { updated_at: '2026-10-12T00:01:00Z' });
    const merged = mergeDecisionRows(main, [old]);
    expect(merged).toHaveLength(201);
    expect(merged[200].id).toBe(42);
    expect(countDecisions(main, NOW).check).toBe(0);
    expect(countDecisions(merged, NOW)).toMatchObject({ all: 201, approved: 1, expired: 200, check: 1 });
  });
});

describe('combineDecisionResponses — 둘 중 하나라도 실패면 전체 오류(부분 성공 금지)', () => {
  const a = { ok: true, data: [sig({ id: 2, status: 'expired', created_at: '2026-10-17T00:00:00.000Z' })] };
  const b = { ok: true, data: [sig({ id: 1, created_at: '2026-10-10T00:00:00.000Z' })] };

  test('둘 다 성공 → 병합', () => {
    expect(combineDecisionResponses(a, b)?.map(s => s.id)).toEqual([2, 1]);
  });

  test('둘 다 성공 + 빈 배열 → 빈 배열(오류 아님)', () => {
    expect(combineDecisionResponses({ ok: true, data: [] }, { ok: true, data: [] })).toEqual([]);
  });

  test.each([
    ['본 조회 ok:false', { ok: false, error: 'x' }, b],
    ['전용 조회 ok:false', a, { ok: false, error: 'x' }],
    ['본 조회 data 없음', { ok: true }, b],
    ['전용 조회 data 배열 아님', a, { ok: true, data: {} }],
    ['전용 조회 본문 null', a, null],
    ['둘 다 실패', { ok: false }, { ok: false }],
  ])('%s → null', (_l, x, y) => {
    expect(combineDecisionResponses(x, y)).toBeNull();
  });
});

// ── R-8 (Codex C2 medium): 중복 id 승자 = 본 조회, 그게 참이 되도록 요청은 전용 → 본 순차 ────────
// 본 조회를 나중에 보내야 본 조회가 항상 더 최신 스냅샷이 되고 "중복 id 는 본 조회가 이긴다" 가 불변식이 된다.
describe('mergeDecisionRows — 중복 id 는 본 조회 행이 이긴다 (R-8)', () => {
  test('전용=accepted, 본=cancelled → 본 조회의 cancelled 가 남는다', () => {
    const exe = [sig({ id: 5, consumed_order_id: 77, order_status: 'accepted' })];
    const main = [sig({ id: 5, consumed_order_id: 77, order_status: 'cancelled' })];
    const m = mergeDecisionRows(main, exe);
    expect(m).toHaveLength(1);
    expect(m[0].order_status).toBe('cancelled');
    expect(decisionOutcome(m[0], NOW).text).toBe('주문 취소됨 #77');
  });

  test('행 전체를 한쪽에서 가져온다(필드가 섞이지 않음)', () => {
    const exe = [sig({ id: 5, consumed_order_id: 77, order_status: 'accepted', updated_at: ago(60_000) })];
    const main = [sig({ id: 5, consumed_order_id: 77, order_status: 'filled', updated_at: ago(30_000) })];
    expect(mergeDecisionRows(main, exe)[0]).toBe(main[0]);
  });
});

describe('fetchDecisionBundle — 전용 조회 → 본 조회 순차, 실패는 전체 null', () => {
  type Reply = unknown | Error | 'not-json';
  /** URL 종류별 응답을 주는 가짜 fetch. 호출 URL 을 순서대로 기록한다. */
  function fakeFetch(exeReply: Reply, mainReply: Reply) {
    const calls: string[] = [];
    const fn = jest.fn(async (url: string) => {
      calls.push(url);
      const reply = url.includes('status=executing&') ? exeReply : mainReply;
      if (reply instanceof Error) throw reply;
      return {
        json: async () => {
          if (reply === 'not-json') throw new SyntaxError('Unexpected token < in JSON');
          return reply;
        },
      };
    });
    return { fn, calls };
  }
  const ok = (data: DecisionSignal[]) => ({ ok: true, data });
  const exeRows = [sig({ id: 1, created_at: '2026-10-10T00:00:00.000Z' })];
  const mainRows = [sig({ id: 2, status: 'expired', created_at: '2026-10-17T00:00:00.000Z' })];

  test('호출 순서: 전용(status=executing) 먼저, 본 조회 다음 — URL 은 같은 nowMs 로 만든 것', async () => {
    const { fn, calls } = fakeFetch(ok(exeRows), ok(mainRows));
    const r = await fetchDecisionBundle(fn, '7d', NOW);
    expect(calls).toEqual([buildExecutingUrl('7d', NOW), buildDecisionsUrl('7d', NOW)]);
    expect(r?.map(s => s.id)).toEqual([2, 1]);
  });

  test('본 조회는 전용 조회 응답(json)이 끝난 뒤에야 시작한다(동시 요청 아님)', async () => {
    let releaseExe!: () => void;
    const gate = new Promise<void>(res => { releaseExe = res; });
    const calls: string[] = [];
    const fn = jest.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('status=executing&')) {
        return { json: async () => { await gate; return ok(exeRows); } };
      }
      return { json: async () => ok(mainRows) };
    });
    const p = fetchDecisionBundle(fn, '7d', NOW);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('status=executing&');
    releaseExe();
    await p;
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe(buildDecisionsUrl('7d', NOW));
  });

  test('두 URL 의 since 가 같다(1d·7d·30d)', async () => {
    for (const period of ['1d', '7d', '30d'] as const) {
      const { fn, calls } = fakeFetch(ok([]), ok([]));
      await fetchDecisionBundle(fn, period, NOW);
      const since = calls.map(u => u.match(/since=([^&]+)/)![1]);
      expect(since[0]).toBe(since[1]);
      expect(since[0]).toBe(new Date(periodSinceMs(period, NOW)).toISOString());
    }
  });

  test('같은 id 가 다른 주문 상태로 오면 본 조회(나중 스냅샷) 행이 남는다', async () => {
    const { fn } = fakeFetch(
      ok([sig({ id: 9, consumed_order_id: 31, order_status: 'accepted' })]),
      ok([sig({ id: 9, consumed_order_id: 31, order_status: 'cancelled' })]),
    );
    const r = await fetchDecisionBundle(fn, '7d', NOW);
    expect(r).toHaveLength(1);
    expect(r![0].order_status).toBe('cancelled');
  });

  test('둘 다 성공 + 빈 배열 → 빈 배열(오류 아님)', async () => {
    const { fn } = fakeFetch(ok([]), ok([]));
    expect(await fetchDecisionBundle(fn, '7d', NOW)).toEqual([]);
  });

  test.each<[string, Reply, Reply]>([
    ['전용 조회 네트워크 실패', new Error('net'), ok(mainRows)],
    ['본 조회 네트워크 실패', ok(exeRows), new Error('net')],
    ['둘 다 네트워크 실패', new Error('a'), new Error('b')],
    ['전용 조회 비 JSON', 'not-json', ok(mainRows)],
    ['본 조회 비 JSON', ok(exeRows), 'not-json'],
    ['전용 조회 ok:false', { ok: false, error: 'x' }, ok(mainRows)],
    ['본 조회 ok:false', ok(exeRows), { ok: false, error: 'x' }],
    ['둘 다 ok:false', { ok: false }, { ok: false }],
  ])('%s → null (예외를 던지지 않음)', async (_l, exe, main) => {
    const { fn } = fakeFetch(exe, main);
    await expect(fetchDecisionBundle(fn, '7d', NOW)).resolves.toBeNull();
  });
});

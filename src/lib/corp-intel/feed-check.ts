/**
 * 피드별 겹침 검사 (T-118 — T-116 후속, T-114 독립 검토 HIGH H1 대응).
 *
 * 캡처마다 응답 항목을 `feed_host` 별로 묶어 "이번 응답의 가장 오래된 발행시각"과 "이 캡처 **전** `ci_raw_item` 에 같은 피드로 남은
 * 가장 최신 발행시각(MAX)"을 비교한다. 이번 응답의 가장 오래된 기사가 직전 최신보다 **늦으면** 그 사이에 피드에서 밀려난(못 본) 기사가
 * 있을 수 있다 → `gap: true`. 그 판정을 상태 JSON(`ci_capture_status:<market>` 의 `feeds`)에 남길 뿐 **알림은 만들지 않는다.**
 *
 * ## 직전 값의 기준 — 같은 피드(feed_host)가 남긴 모든 `ci_raw_item` 행
 *
 * peek 뿐 아니라 06:00·15:30 ingest 가 캡처한 행도 기준에 들어간다. 그 행들도 "우리가 실제로 본 항목"(first_seen_at 이 남은 증거)이라,
 * 다음 캡처의 가장 오래된 기사가 그 행들의 최신 발행시각보다 이르거나 같으면 증거가 끊기지 않고 이어진 것이다. 시장(market)으로
 * 거르지 않는 이유: `ci_raw_item` 에는 시장 열이 없고 feed_host 가 시장마다 다르다(국내 연합뉴스, 해외 4개 피드).
 *
 * ## 비용·시간 — 캡처 공유 마감(4초) 안, 그중 최대 `CI_FEED_CHECK_TIMEOUT_MS`
 *
 * 조회는 1회(피드 최대 `CI_FEED_MAX` 개를 `IN` 하나로)다. `ci_raw_item` 에 feed_host 인덱스가 없어 전체를 훑지 않도록 발행시각 하한
 * (`CI_FEED_LOOKBACK_DAYS` 일 전 — `idx_published` 범위)을 둔다. 그 하한보다 오래전에만 행이 있는 피드는 "직전 값 없음" = `bootstrap`
 * 으로 본다(그 기간 넘게 캡처가 끊겼다면 연속 실패 수가 이미 그것을 보여 준다).
 * **"이 캡처 전" = `first_seen_at < 이번 캡처 시각`**: 이번 캡처가 새로 넣는 행은 first_seen_at 이 이번 캡처 시각(`now`)이고, 이미 있던 행은
 * first_seen_at 이 그대로다(ODKU 는 last_seen_at 만 바꾼다). 그래서 이 조건이 이번 캡처의 새 행만 정확히 뺀다 — 덕분에 조회를 저장(INSERT)과
 * **나란히** 돌려도 결과가 같고, 조회가 늦어도 저장이 쓸 시간을 빼앗지 않는다(raw-capture.ts captureFetchOutcome). 조회는 공유 마감 중
 * 최대 `CI_FEED_CHECK_TIMEOUT_MS` 만 기다린다. 넘기거나 실패하면 검사만 건너뛰고(`skipped`) 저장·상태 기록은 그대로 간다.
 * 이 파일은 **읽기만** 한다(쓰기 0) — 상태 쓰기는 status.ts 가 한다.
 *
 * **절대 던지지 않는다.**
 */
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { toKstDatetime } from '@/lib/time';

/** 비교용 MAX 조회 상한(ms) — 공유 마감(4초)의 일부만 쓴다(나머지는 저장·상태 기록 몫). */
export const CI_FEED_CHECK_TIMEOUT_MS = 1000;
/** 상태에 남기는 피드 수 상한 — 실측 해외 4개·국내 1개. 넘는 피드(이름순 뒤쪽)는 검사·상태에서 뺀다(상태 크기 상한). */
export const CI_FEED_MAX = 8;
/** 직전 최신 발행시각을 찾는 범위(일) — 발행시각 하한으로 인덱스 범위 조회를 만든다. */
export const CI_FEED_LOOKBACK_DAYS = 7;

/**
 * 직전 최신 발행시각 조회 — 읽기 전용. 파라미터: [발행시각 하한(KST DATETIME), 이번 캡처 시각(KST DATETIME — 이번 캡처의 새 행을 뺀다),
 * feed_host 목록]. DATE_FORMAT 으로 KST 벽시계 문자열을 받는다(드라이버의 Date 변환·시간대 해석을 거치지 않는다).
 */
export const CI_FEED_PREV_NEWEST_SQL =
  "SELECT feed_host, DATE_FORMAT(MAX(published_at), '%Y-%m-%d %H:%i:%s') AS newest FROM ci_raw_item WHERE source_kind = 'rss' AND published_at >= ? AND first_seen_at < ? AND feed_host IN (?) GROUP BY feed_host";

const LOG = '[corp-intel/feed-check]';
const KST_DT_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
/** 마감까지 남은 ms — status.ts 의 remainingMs 와 같은 규칙(status.ts 가 이 파일을 import 하므로 순환을 피해 여기 둔다). */
const remaining = (deadline: number) => (Number.isFinite(deadline) ? Math.max(0, deadline - Date.now()) : 0);

/** gap 판정 — true: 사이에 못 본 기사가 있을 수 있음 / false: 이어짐 / bootstrap: 직전 값 없음 / skipped: 검사 못 함. */
export type FeedGap = boolean | 'bootstrap' | 'skipped';

/** 이번 응답의 피드 요약(검사 전). 발행시각은 KST `YYYY-MM-DD HH:mm:ss`, 없으면 null. */
export interface FeedSummary {
  oldestPub: string | null;
  newestPub: string | null;
  items: number;
}

/** 상태 JSON 의 `feeds.<feed_host>` 한 칸(사양 4번). */
export interface FeedStatus extends FeedSummary {
  gap: FeedGap;
  consecutiveGaps: number;
}

/** 검사 결과(연속 횟수 계산 전). */
export interface FeedObservation extends FeedSummary {
  gap: FeedGap;
}

/**
 * 검증된 행(raw-capture 의 validateNewsItem 결과)을 feed_host 별로 묶는다 — 순수 함수. feed_host 가 없는 행은 뺀다.
 * 피드가 `CI_FEED_MAX` 개를 넘으면 이름순 앞쪽만 남긴다. 반환 객체의 키는 검증된 호스트 이름(소문자·숫자·하이픈·점)뿐이다.
 */
export function summarizeFeeds(rows: ReadonlyArray<{ feedHost: string | null; publishedAt: string | null }>): Record<string, FeedSummary> {
  const by = new Map<string, FeedSummary>();
  for (const r of rows) {
    if (!r || typeof r.feedHost !== 'string' || r.feedHost === '') continue;
    const s = by.get(r.feedHost) ?? { oldestPub: null, newestPub: null, items: 0 };
    s.items += 1;
    const p = typeof r.publishedAt === 'string' && KST_DT_RE.test(r.publishedAt) ? r.publishedAt : null;
    if (p !== null) {
      if (s.oldestPub === null || p < s.oldestPub) s.oldestPub = p;
      if (s.newestPub === null || p > s.newestPub) s.newestPub = p;
    }
    by.set(r.feedHost, s);
  }
  const out: Record<string, FeedSummary> = {};
  for (const host of [...by.keys()].sort().slice(0, CI_FEED_MAX)) out[host] = by.get(host)!;
  return out;
}

/** DB 값 → KST 벽시계 문자열. null/undefined → null(직전 값 없음), 해석 불가 → undefined(검사 못 함). */
function normalizeNewest(v: unknown): string | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return KST_DT_RE.test(v) ? v : undefined;
  if (v instanceof Date && Number.isFinite(v.getTime())) return toKstDatetime(v);
  return undefined;
}

/**
 * 같은 피드의 직전 최신 발행시각 — 읽기 1회. 반환: 호스트 → 문자열(직전 최신)·null(직전 값 없음)·undefined(이 호스트는 검사 못 함).
 * 조회 자체가 실패·마감 초과면 null(전부 skipped). **던지지 않는다.** 남은 시간이 0 이면 쿼리를 보내지 않는다.
 * `now` = 이번 캡처 시각 — 저장이 first_seen_at 에 쓰는 값과 **같은 값**을 줘야 이번 캡처의 새 행이 정확히 빠진다.
 */
export async function readPrevNewestByFeed(
  hosts: readonly string[], deadline: number, now: Date = new Date(),
): Promise<Map<string, string | null | undefined> | null> {
  if (hosts.length === 0) return new Map();
  const ms = Math.min(remaining(deadline), CI_FEED_CHECK_TIMEOUT_MS);
  if (ms <= 0) {
    console.warn(`${LOG} 마감이 지나 겹침 검사를 건너뜀`);
    return null;
  }
  const since = toKstDatetime(new Date(now.getTime() - CI_FEED_LOOKBACK_DAYS * 86_400_000));
  const seen = toKstDatetime(now);
  const body = (async (): Promise<Map<string, string | null | undefined> | null> => {
    const [rows] = await getPool().query<(RowDataPacket & { feed_host: unknown; newest: unknown })[]>(
      CI_FEED_PREV_NEWEST_SQL, [since, seen, [...hosts]],
    );
    if (!Array.isArray(rows)) return null;
    const m = new Map<string, string | null | undefined>();
    for (const h of hosts) m.set(h, null);
    for (const r of rows) {
      const h = typeof r?.feed_host === 'string' ? r.feed_host.toLowerCase() : null;
      if (h !== null && m.has(h)) m.set(h, normalizeNewest(r.newest));
    }
    return m;
  })().catch((e: unknown) => {
    try { console.warn(`${LOG} 직전 발행시각 조회 실패 — 겹침 검사를 건너뜀: ${e instanceof Error ? e.message : String(e)}`); } catch { /* 로그 실패도 흡수 */ }
    return null;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`${LOG} 직전 발행시각 조회가 ${ms}ms 안에 끝나지 않아 겹침 검사를 건너뜀`);
      resolve(null);
    }, ms);
  });
  try {
    return await Promise.race([body, t]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 순수 판정 — 이번 요약 + 직전 최신(조회 결과, null = 조회 실패) → 피드별 gap.
 *  - 조회 실패·이 피드 값 해석 불가·이번 응답에 발행시각이 하나도 없음 → 'skipped'
 *  - 직전 값 없음 → 'bootstrap'(첫 캡처 — gap 으로 세지 않는다)
 *  - 이번 가장 오래된 발행시각 > 직전 최신 → true(사이에 못 본 기사가 있을 수 있음), 같거나 이르면 false(이어짐)
 */
export function classifyFeeds(
  summary: Record<string, FeedSummary>, prev: Map<string, string | null | undefined> | null,
): Record<string, FeedObservation> {
  const out: Record<string, FeedObservation> = {};
  for (const [host, s] of Object.entries(summary)) {
    let gap: FeedGap;
    const p = prev === null ? undefined : prev.get(host);
    if (prev === null || p === undefined || s.oldestPub === null) gap = 'skipped';
    else if (p === null) gap = 'bootstrap';
    else gap = s.oldestPub > p;
    out[host] = { ...s, gap };
  }
  return out;
}

/**
 * 연속 gap 횟수 — true 면 직전 +1, false·bootstrap 이면 0, skipped 면 직전 값 그대로(판정 못 함 — 늘리지도 끊지도 않는다).
 */
export function nextConsecutiveGaps(prev: number, gap: FeedGap): number {
  if (gap === true) return prev + 1;
  if (gap === 'skipped') return prev;
  return 0;
}

/** 캡처 진입점용 — 요약 → 조회 → 판정. 던지지 않는다. */
export async function checkFeedOverlap(
  rows: ReadonlyArray<{ feedHost: string | null; publishedAt: string | null }>, deadline: number, now: Date = new Date(),
): Promise<Record<string, FeedObservation>> {
  try {
    const summary = summarizeFeeds(rows);
    const hosts = Object.keys(summary);
    if (hosts.length === 0) return {};
    const prev = await readPrevNewestByFeed(hosts, deadline, now);
    return classifyFeeds(summary, prev);
  } catch (e) {
    console.warn(`${LOG} 예외 흡수: ${e instanceof Error ? e.message : String(e)}`);
    return {};
  }
}

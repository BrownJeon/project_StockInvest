/**
 * 마지막 캡처 상태 기록 (T-116) — `system_config` 키 `ci_capture_status:<market>` 에 JSON 한 개.
 *
 * T-106 `news_zero_streak:*` 와 같은 방식의 **관찰용** 값이다(캡처 공백 감시의 재료 — 알림은 이 task 범위 밖).
 * 값: `{ lastAt, mode, status, fetched, inserted, duplicates, rejected, consecutiveFailures, feeds }`
 *  - lastAt: KST 벽시계 `YYYY-MM-DD HH:mm:ss`
 *  - mode: 'peek' | 'ingest'
 *  - status: 이번 시도의 결과(`CaptureStatusKind`) — 사양 필드 목록에 더한 것(무엇 때문에 실패로 셌는지 보이게)
 *  - consecutiveFailures: 실패로 세는 결과(`isFailureStatus`)가 연속된 횟수. 정상(ok)이면 0 으로 초기화.
 *  - feeds (T-118 추가 — 앞 필드는 그대로라 하위 호환): `{ "<feed_host>": { oldestPub, newestPub, items, gap, consecutiveGaps } }`.
 *    이번 응답을 받아 겹침 검사(feed-check.ts)를 한 시도면 그 결과(연속 gap 수는 직전 상태의 같은 피드 값에서 이어 센다), 응답을 못 받은
 *    시도(fetch_failed·no_items)·검사를 하지 않은 호출이면 **직전 상태의 feeds 를 그대로 옮긴다**(연속 gap 수를 잃지 않게 — 그 값이
 *    이번 시도의 것이 아니라는 것은 status 로 안다). 직전 값이 없거나 손상이면 `{}`. 검사를 한 시도에서 이번 응답에 없는 피드는
 *    빠진다(그 피드의 연속 gap 수는 다음에 다시 보이면 0 에서 센다). 알림은 만들지 않는다.
 *
 * **절대 던지지 않는다.** 읽기·쓰기 오류는 경고 후 무시한다. 대기는 **마감(deadline, epoch ms)** 까지 — 호출자(raw-capture 의
 * captureFetchOutcome)가 스위치 읽기·INSERT 와 **같은 마감 하나를 공유**시킨다(캡처 전체 4초, Leader 결정 Q8). 마감을 주지 않으면
 * 지금부터 `CI_STATUS_TIMEOUT_MS`(4초). 남은 시간이 0 이면 DB 를 건드리지 않고 건너뛴다(null). 늦게 끝난 본문은 그대로 두고 오류만 흡수
 * (news-health.ts 와 같은 패턴).
 * 이 파일의 쓰기는 `system_config` 의 `ci_capture_status:domestic`·`ci_capture_status:overseas` 두 키뿐이다(경계 시험이 확인).
 */
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { toKstDatetime } from '@/lib/time';
import { CI_FEED_MAX, nextConsecutiveGaps, type FeedObservation, type FeedStatus } from './feed-check';

export type CaptureMarket = 'domestic' | 'overseas';
export type CaptureMode = 'peek' | 'ingest';
/**
 * 캡처 시도 결과.
 *  - ok: 저장 시도 완료(신규·중복·거부 수는 따로)
 *  - skipped_disabled: 스위치 꺼짐 — 상태를 기록하지 않는다(꺼짐 = 무동작)
 *  - skipped_no_table: DDL 미적용(ER_NO_SUCH_TABLE)
 *  - failed: DB 오류·4초 상한 초과 등
 *  - fetch_failed: M4 호출이 재시도 끝에 실패해 받은 항목이 없음
 *  - no_items: M4 응답에 `items` 배열이 없음(peek 인데 구 M4 등)
 */
export type CaptureStatusKind = 'ok' | 'skipped_disabled' | 'skipped_no_table' | 'failed' | 'fetch_failed' | 'no_items';

export const CI_STATUS_TIMEOUT_MS = 4000;

/** 마감까지 남은 ms(0 이상). 마감이 숫자가 아니면 0. Date.now() 기준 — 시험의 가짜 타이머도 따른다. */
export function remainingMs(deadline: number): number {
  return Number.isFinite(deadline) ? Math.max(0, deadline - Date.now()) : 0;
}
const LOG = '[corp-intel/status]';
const MARKETS: readonly CaptureMarket[] = ['domestic', 'overseas'];

export interface CaptureStatusValue {
  lastAt: string;
  mode: CaptureMode;
  status: CaptureStatusKind;
  fetched: number;
  inserted: number;
  duplicates: number;
  rejected: number;
  consecutiveFailures: number;
  /** (T-118) 피드별 겹침 검사 — 머리 주석 */
  feeds: Record<string, FeedStatus>;
}

export interface RecordCaptureStatusInput {
  mode: CaptureMode;
  status: CaptureStatusKind;
  fetched: number;
  inserted: number;
  duplicates: number;
  rejected: number;
  now?: Date;
  /** (T-118) 이번 시도의 피드별 겹침 검사 결과. 없으면(검사하지 않은 시도) 직전 상태의 feeds 를 옮긴다. */
  feeds?: Record<string, FeedObservation>;
}

export function isCaptureMarket(m: unknown): m is CaptureMarket {
  return typeof m === 'string' && (MARKETS as readonly string[]).includes(m);
}

/** 상태 키 — 시장이 허용 값이 아니면 null(쓰지 않는다). */
export function captureStatusKey(market: unknown): string | null {
  return isCaptureMarket(market) ? `ci_capture_status:${market}` : null;
}

/** 실패로 세는 결과 — 캡처가 일어나지 않은 경우 전부(스위치 꺼짐은 기록 자체를 하지 않으므로 해당 없음). */
export function isFailureStatus(s: CaptureStatusKind): boolean {
  return s === 'failed' || s === 'fetch_failed' || s === 'no_items' || s === 'skipped_no_table';
}

const nonNegInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/** 이전 값에서 consecutiveFailures 만 읽는다. 손상·없음이면 0. mysql2 JSON 컬럼은 객체, 문자열 저장분은 문자열로 온다. */
export function readPrevFailures(raw: unknown): number {
  let v: unknown = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return 0; }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 0;
  const n = (v as Record<string, unknown>).consecutiveFailures;
  return nonNegInt(n) ? n : 0;
}

const FEED_HOST_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;
const KST_DT_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const isGap = (g: unknown): g is FeedStatus['gap'] => g === true || g === false || g === 'bootstrap' || g === 'skipped';
const pubOrNull = (v: unknown): string | null => (typeof v === 'string' && KST_DT_RE.test(v) ? v : null);

/**
 * (T-118) 이전 값에서 feeds 만 읽는다 — 형태가 맞는 칸만(호스트 이름 꼴·필드 타입), 최대 `CI_FEED_MAX` 개. 손상·없음이면 `{}`.
 * mysql2 JSON 컬럼은 객체, 문자열 저장분은 문자열로 온다.
 */
export function readPrevFeeds(raw: unknown): Record<string, FeedStatus> {
  let v: unknown = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return {}; }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const f = (v as Record<string, unknown>).feeds;
  if (!f || typeof f !== 'object' || Array.isArray(f)) return {};
  const out: Record<string, FeedStatus> = {};
  for (const host of Object.keys(f).filter((h) => h.length <= 120 && FEED_HOST_RE.test(h)).sort().slice(0, CI_FEED_MAX)) {
    const e = (f as Record<string, unknown>)[host];
    if (!e || typeof e !== 'object' || Array.isArray(e)) continue;
    const o = e as Record<string, unknown>;
    out[host] = {
      oldestPub: pubOrNull(o.oldestPub),
      newestPub: pubOrNull(o.newestPub),
      items: nonNegInt(o.items) ? o.items : 0,
      gap: isGap(o.gap) ? o.gap : 'skipped',
      consecutiveGaps: nonNegInt(o.consecutiveGaps) ? o.consecutiveGaps : 0,
    };
  }
  return out;
}

/** (T-118) 순수 계산 — 다음 feeds. 이번 검사 결과가 없으면 직전 feeds 그대로, 있으면 피드마다 연속 gap 수를 직전 값에서 이어 센다. */
export function nextFeeds(prevFeeds: Record<string, FeedStatus>, obs: Record<string, FeedObservation> | undefined): Record<string, FeedStatus> {
  if (obs === undefined) return prevFeeds;
  const out: Record<string, FeedStatus> = {};
  for (const [host, o] of Object.entries(obs)) {
    const prev = Object.prototype.hasOwnProperty.call(prevFeeds, host) ? prevFeeds[host].consecutiveGaps : 0;
    out[host] = { oldestPub: o.oldestPub, newestPub: o.newestPub, items: o.items, gap: o.gap, consecutiveGaps: nextConsecutiveGaps(prev, o.gap) };
  }
  return out;
}

/** 순수 계산 — 다음 상태 값. prevFeeds(T-118)를 주지 않으면 직전 feeds 없음(`{}`)으로 본다. */
export function nextCaptureStatus(
  prevFailures: number, input: RecordCaptureStatusInput, now: Date, prevFeeds: Record<string, FeedStatus> = {},
): CaptureStatusValue {
  const fail = isFailureStatus(input.status);
  const cnt = (n: unknown) => (nonNegInt(n) ? n : 0);
  return {
    lastAt: toKstDatetime(now),
    mode: input.mode,
    status: input.status,
    fetched: cnt(input.fetched),
    inserted: cnt(input.inserted),
    duplicates: cnt(input.duplicates),
    rejected: cnt(input.rejected),
    consecutiveFailures: fail ? prevFailures + 1 : 0,
    feeds: nextFeeds(prevFeeds, input.feeds),
  };
}

/**
 * 상태 기록 — 절대 던지지 않고 마감(기본 지금+4초) 안에 돌아온다. 스위치 꺼짐(skipped_disabled)은 기록하지 않는다.
 * 남은 시간이 0 이면 DB 를 건드리지 않고 null. 반환: 기록한 값(못 했으면 null).
 */
export async function recordCaptureStatus(
  market: CaptureMarket, input: RecordCaptureStatusInput, deadline: number = Date.now() + CI_STATUS_TIMEOUT_MS,
): Promise<CaptureStatusValue | null> {
  const ms = remainingMs(deadline);
  if (ms <= 0) {
    console.warn(`${LOG} ${String(market)} 마감이 지나 상태 기록을 건너뜀(캡처 전체 상한 ${CI_STATUS_TIMEOUT_MS}ms 공유)`);
    return null;
  }
  const body = recordCaptureStatusBody(market, input, deadline).catch((e: unknown) => {
    try { console.warn(`${LOG} 예외 흡수: ${e instanceof Error ? e.message : String(e)}`); } catch { /* 로그 실패도 흡수 */ }
    return null;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`${LOG} ${String(market)} 상태 기록이 마감(남은 ${ms}ms) 안에 끝나지 않아 건너뜀(DB 대기 상한)`);
      resolve(null);
    }, ms);
  });
  try {
    return await Promise.race([body, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function recordCaptureStatusBody(market: CaptureMarket, input: RecordCaptureStatusInput, deadline: number): Promise<CaptureStatusValue | null> {
  try {
    const key = captureStatusKey(market);
    if (!key) {
      console.warn(`${LOG} 알 수 없는 시장(${String(market)}) — 기록하지 않음`);
      return null;
    }
    if (!input || input.status === 'skipped_disabled') return null;
    const now = input.now ?? new Date();
    let prev = 0;
    let prevFeeds: Record<string, FeedStatus> = {};
    try {
      const [rows] = await getPool().query<(RowDataPacket & { value: unknown })[]>(
        'SELECT value FROM system_config WHERE `key` = ? LIMIT 1',
        [key],
      );
      if (Array.isArray(rows) && rows.length > 0) {
        prev = readPrevFailures(rows[0].value);
        prevFeeds = readPrevFeeds(rows[0].value);   // (T-118) 같은 읽기 1회에서 — 쿼리를 늘리지 않는다
      }
    } catch (e) {
      // 읽기 실패 — 연속 횟수는 모르지만 이번 결과는 남긴다(0 에서 다시 센다).
      console.warn(`${LOG} ${key} 읽기 실패 — 연속 실패 횟수를 0 에서 다시 센다: ${e instanceof Error ? e.message : String(e)}`);
    }
    const next = nextCaptureStatus(prev, input, now, prevFeeds);
    // 읽기가 마감을 넘겨 끝났으면(호출자는 이미 null 로 돌아갔다) 쓰기 단계를 보내지 않는다 — 마감 뒤 늦은 쓰기 0.
    if (remainingMs(deadline) <= 0) {
      console.warn(`${LOG} ${key} 마감이 지나 상태 쓰기를 건너뜀`);
      return null;
    }
    try {
      await getPool().query(
        'INSERT INTO system_config (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        [key, JSON.stringify(next)],
      );
    } catch (e) {
      console.warn(`${LOG} ${key} 저장 실패(무시): ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
    return next;
  } catch (e) {
    console.warn(`${LOG} 예외 흡수: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

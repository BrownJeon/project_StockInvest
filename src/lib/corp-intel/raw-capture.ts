/**
 * 뉴스 최초 관측 증거 캡처 (T-116 — 2차 설계 단계 1b, 앱 쪽).
 *
 * M4 `POST /v1/news/fetch` 응답의 `items[]`(`{guid, link, title, published_at, pub_date_raw, feed_host}` — home-m4-api
 * docs/local-llm.md §9.8)를 `ci_raw_item` 에 영구 보존한다. M4 KB 는 같은 본문을 다시 적재하면 `ingested_at` 을 덮어쓰고 링크·GUID 를
 * 남기지 않으므로, "우리가 처음 본 시각"은 여기서만 남는다(설계서 §2.1·§4.1).
 *
 * ## 원칙 — 가산 전용, 기존 동작에 영향 0
 *
 * - **스위치** `system_config.ci_capture_enabled`: **키 없음 = 꺼짐**, 정확히 JSON `true` 만 켜짐, 그 밖의 값·읽기 오류 = 꺼짐
 *   (`post_market_overseas_enabled` 와 같은 관례). 꺼져 있으면 스위치 읽기 1회 외에 DB 를 건드리지 않는다.
 *   판정 규칙은 `src/lib/signals/signal-cash-gate.ts` 의 `gateSwitchValueEnabled` 와 같지만 **가져다 쓰지 않고 같은 4줄을 여기 둔다** —
 *   corp-intel 은 signals 모듈을 import 하지 않는다(경계 시험 `__tests__/isolation.test.ts`, Leader 결정 Q3).
 * - **절대 던지지 않는다.** 모든 공개 함수는 오류를 경고로 바꾸고 결과 객체를 돌려준다.
 * - **캡처 전체 4초 상한 — 마감 하나를 공유한다**(Leader 결정 Q8): `captureFetchOutcome` 은 시작할 때 마감(지금 + `CI_CAPTURE_TIMEOUT_MS`)을
 *   한 번 정하고, 스위치 읽기 → INSERT → 상태 기록이 **같은 마감**까지만 기다린다(단계마다 4초가 아니다 — 합계가 4초를 넘지 않는다).
 *   남은 시간이 0 이면 다음 단계를 **건너뛴다**(DB 를 건드리지 않음). 건너뛴 사실은 결과의 `deadline` 으로 구분한다:
 *   `insert_skipped`(저장 못 함 — capture.status `failed`, reason `deadline`) / `status_skipped`(저장은 했고 상태 기록만 못 함 —
 *   라우트 응답에서 `partial`). 상한 뒤 늦게 끝난 본문은 그대로 두고 오류만 흡수한다(`news-health.ts` 와 같은 패턴).
 * - `ER_NO_SUCH_TABLE`(DDL 미적용)이면 `skipped_no_table` 로 건너뛰고 **프로세스당 한 번만** 경고한다.
 * - `first_seen_at` 은 **절대 덮어쓰지 않는다**: `INSERT … ON DUPLICATE KEY UPDATE last_seen_at = VALUES(last_seen_at)` 만 쓴다.
 * - 링크·제목·GUID 는 **신뢰할 수 없는 외부 데이터**다. 이 모듈은 저장만 하고 링크로 요청을 보내지 않는다.
 *
 * ## 항목 검증 (M4 Reviewer LOW 2건을 여기서 맡는다)
 *
 * 금지 문자: 제어문자 C0(U+0000~001F)·DEL(U+007F)·C1(U+0080~009F), 유니코드 서식 문자(U+200B~200F·2028~202E·2060~2064·FEFF),
 * 짝 없는 서로게이트(utf8mb4 로 저장할 수 없어 일괄 INSERT 전체가 실패한다).
 * - title: 서식 문자·짝 없는 서로게이트는 **삭제**, 제어문자는 공백으로 바꾼 뒤 연속 공백을 접고 다듬는다(표시용 원문은 그 밖에
 *   그대로). 400자(코드 포인트) 초과는 400자로 자른다. 바꾼 것이 있으면 그 항목을 `rejected` 로 센다.
 * - link: 다음 중 하나면 **링크 값만 버리고**(NULL) 항목은 저장한다 + `rejected` (Leader 결정 Q4 — 규칙 목록):
 *     ① 문자열 아님 ② 512자 초과 ③ 공백·금지 문자 포함 ④ URL 해석 불가 ⑤ http/https 아님 ⑥ 사용자 정보(`user:pw@`·`user@`)
 *     ⑦ IP 리터럴 호스트(IPv4·IPv6 — WHATWG URL 이 10진·16진 표기를 점 표기로 바꿔 주므로 점 표기만 보면 된다)
 *     ⑧ `localhost`·`*.localhost` ⑨ 점 없는 호스트 ⑩ 명시 포트 — 기본 포트(URL 이 지운다)가 아닌 **모든** 포트(내부 주소 SSRF 소비자 방지).
 * - guid: 문자열 아님·300자 초과·금지 문자 포함이면 값만 버리고 + `rejected`. 남은 guid 는 `ci_raw_item.guid` 열에 원문 그대로 저장한다
 *   (링크를 버려도 guid 는 저장된다 — Leader 결정 Q1, 설계서 §5 초안에 없던 열).
 * - feed_host: 호스트 이름 꼴(소문자 영숫자·하이픈·점, 120자 이하)이 아니면 값만 버리고 + `rejected`.
 * - published_at: ISO 8601(날짜+시각+시간대) 로 해석될 때만 KST DATETIME 으로 저장. 값이 있는데 해석 못 하면 NULL + `rejected`.
 * - guid·link·title 이 셋 다 남지 않은 항목은 저장하지 않는다(+ `rejected`).
 * `rejected` = 무언가 거부된 **항목 수**(값 일부를 버리고 저장된 항목도 센다 — 그래서 inserted + duplicates + rejected 는 받은 수와
 * 같지 않을 수 있다).
 */
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { toKstDatetime } from '@/lib/time';
import { RSS_KEY_SCHEME, parseIsoUtcStrict, rssSourceKey, sha256Hex } from './keys';
import {
  isCaptureMarket,
  recordCaptureStatus,
  remainingMs,
  type CaptureMarket,
  type CaptureMode,
  type CaptureStatusValue,
} from './status';

export const CI_CAPTURE_SWITCH_KEY = 'ci_capture_enabled';
/**
 * 캡처 전체 상한(ms) — 스위치 읽기·INSERT·상태 기록이 이 하나의 마감을 공유한다(Leader 결정 Q8). 단독 호출(readCaptureSwitch·
 * captureNewsItems)도 마감을 주지 않으면 지금부터 이 값.
 */
export const CI_CAPTURE_TIMEOUT_MS = 4000;
/** 한 번에 받는 항목 상한(M4 limit 최대 100 의 두 배 — 넘는 것은 rejected). */
export const CI_CAPTURE_MAX_ITEMS = 200;
export const CI_TITLE_MAX = 400;
export const CI_GUID_MAX = 300;
export const CI_URL_MAX = 512;
export const CI_FEED_HOST_MAX = 120;
/** parser_version VARCHAR(24) — 키 직렬화 방식 이름을 함께 남긴다. */
export const CI_RSS_PARSER_VERSION = `t116-rss-${RSS_KEY_SCHEME}`;

const LOG = '[corp-intel/capture]';

export type CaptureResultStatus = 'ok' | 'skipped_disabled' | 'skipped_no_table' | 'failed';
export interface CaptureResult {
  status: CaptureResultStatus;
  /** 새로 들어간 행 수. 단건 INSERT 경로에서 같은 초에 다시 본 항목은 mysql2 FOUND_ROWS 때문에 inserted 로 셀 수 있다(수치만 영향 — T-116 Reviewer L-1). */
  inserted: number;
  duplicates: number;
  /** 무언가 거부·수정된 **항목 수** — 값 일부만 버리고 저장된 항목도 센다(그래서 inserted + duplicates + rejected ≠ 받은 수일 수 있다, Leader 결정 Q2). */
  rejected: number;
  /** status 가 failed 인 이유가 마감(공유 4초)이면 'deadline' — 남은 시간이 없어 INSERT 를 건너뛰었거나 INSERT 가 마감까지 끝나지 않음. */
  reason?: 'deadline';
}
/** 공유 마감 때문에 건너뛴 단계 — 'ok' = 건너뛴 것 없음. */
export type CaptureDeadlineState = 'ok' | 'insert_skipped' | 'status_skipped';
export type CaptureSwitchSource = 'missing' | 'value' | 'read_error' | 'timeout';

// ─────────────────────────────────────────────────────────────────────────────
// 공용 — 상한·오류 판별
// ─────────────────────────────────────────────────────────────────────────────

/** p 를 ms 안에 기다린다. 넘으면 onTimeout() 값. p 의 늦은 거부는 흡수한다. */
async function capped<T>(p: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  const safe = p.catch((e: unknown) => {
    try { console.warn(`${LOG} 예외 흡수: ${e instanceof Error ? e.message : String(e)}`); } catch { /* 로그 실패도 흡수 */ }
    return onTimeout();
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<T>((resolve) => { timer = setTimeout(() => resolve(onTimeout()), ms); });
  try {
    return await Promise.race([safe, t]);
  } finally {
    clearTimeout(timer);
  }
}

/** MariaDB/MySQL "테이블 없음"(errno 1146). */
export function isNoSuchTable(e: unknown): boolean {
  const o = e as { code?: unknown; errno?: unknown } | null;
  return !!o && (o.code === 'ER_NO_SUCH_TABLE' || o.errno === 1146);
}

let noTableWarned = false;
/** 시험 전용 — 프로세스당 1회 경고 상태를 되돌린다. */
export function resetCaptureWarningsForTest(): void {
  noTableWarned = false;
}

// ─────────────────────────────────────────────────────────────────────────────
// 스위치
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 정확히 JSON `true` 만 켜짐(드라이버가 이미 파싱한 true 포함).
 * 원본: `src/lib/signals/signal-cash-gate.ts` 의 `gateSwitchValueEnabled` — 경계 시험 때문에 import 하지 않고 복제했다(Leader 결정 Q3).
 * **원본 규칙이 바뀌면 여기도 같이 고칠 것.**
 */
export function captureSwitchValueEnabled(raw: unknown): boolean {
  if (raw === true) return true;
  if (typeof raw !== 'string') return false;
  try { return JSON.parse(raw) === true; } catch { return false; }
}

/** 스위치 읽기 — 키 없음·읽기 오류·마감 초과(기본 지금+4초) = 꺼짐. 남은 시간이 0 이면 DB 를 건드리지 않고 꺼짐(timeout). 던지지 않는다. */
export async function readCaptureSwitch(
  deadline: number = Date.now() + CI_CAPTURE_TIMEOUT_MS,
): Promise<{ enabled: boolean; source: CaptureSwitchSource }> {
  const ms = remainingMs(deadline);
  if (ms <= 0) return { enabled: false, source: 'timeout' };
  const body = (async (): Promise<{ enabled: boolean; source: CaptureSwitchSource }> => {
    try {
      const [rows] = await getPool().query<(RowDataPacket & { value: unknown })[]>(
        'SELECT value FROM system_config WHERE `key` = ? LIMIT 1',
        [CI_CAPTURE_SWITCH_KEY],
      );
      const row = Array.isArray(rows) ? rows[0] : undefined;
      if (!row) return { enabled: false, source: 'missing' as const };
      return { enabled: captureSwitchValueEnabled(row.value), source: 'value' as const };
    } catch (e) {
      console.warn(`${LOG} 스위치(${CI_CAPTURE_SWITCH_KEY}) 읽기 실패 — 꺼짐으로 본다: ${e instanceof Error ? e.message : String(e)}`);
      return { enabled: false, source: 'read_error' as const };
    }
  })();
  return capped(body, ms, () => ({ enabled: false, source: 'timeout' as const }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 항목 검증
// ─────────────────────────────────────────────────────────────────────────────

/** C0·DEL·C1 */
const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F]/;
const CONTROL_G = /[\u0000-\u001F\u007F-\u009F]/g;
/**
 * 유니코드 서식 문자 — 사양 목록(M4 Reviewer LOW: U+200B~200F·2028~202E·2060~2064·FEFF) + 상위 호환 추가(T-116 Reviewer L-4:
 * U+2066~2069 양방향 격리·U+061C 아랍 문자 표시·U+180E 몽골 모음 구분·U+00AD 소프트 하이픈). title 은 삭제, link·guid 는 값을 버린다.
 */
const FORMAT_RE = /[\u200B-\u200F\u2028-\u202E\u2060-\u2064\uFEFF\u2066-\u2069\u061C\u180E\u00AD]/;
const FORMAT_G = /[\u200B-\u200F\u2028-\u202E\u2060-\u2064\uFEFF\u2066-\u2069\u061C\u180E\u00AD]/g;
/** 짝 없는 서로게이트 */
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const LONE_SURROGATE_G = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const HOST_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

const cpLen = (s: string) => [...s].length;
const hasBad = (s: string) => CONTROL_RE.test(s) || FORMAT_RE.test(s) || LONE_SURROGATE_RE.test(s);

interface FieldOut<T> { value: T | null; flagged: boolean }

export function sanitizeTitle(raw: unknown): FieldOut<string> {
  if (raw === null || raw === undefined) return { value: null, flagged: false };
  if (typeof raw !== 'string') return { value: null, flagged: true };
  let s = raw.replace(FORMAT_G, '').replace(LONE_SURROGATE_G, '').replace(CONTROL_G, ' ');
  let flagged = s !== raw;
  s = s.replace(/\s+/g, ' ').trim();
  if (cpLen(s) > CI_TITLE_MAX) {
    s = [...s].slice(0, CI_TITLE_MAX).join('').trim();
    flagged = true;
  }
  return { value: s === '' ? null : s, flagged };
}

export function validateGuid(raw: unknown): FieldOut<string> {
  if (raw === null || raw === undefined) return { value: null, flagged: false };
  if (typeof raw !== 'string') return { value: null, flagged: true };
  const s = raw.trim();
  if (s === '') return { value: null, flagged: false };
  if (cpLen(s) > CI_GUID_MAX || hasBad(s)) return { value: null, flagged: true };
  return { value: s, flagged: false };
}

/** 링크 — 저장 가능한 값이면 원문(앞뒤 공백 제거) 그대로, 아니면 null + flagged. 요청은 보내지 않는다. */
export function validateLink(raw: unknown): FieldOut<string> {
  if (raw === null || raw === undefined) return { value: null, flagged: false };
  if (typeof raw !== 'string') return { value: null, flagged: true };
  const s = raw.trim();
  if (s === '') return { value: null, flagged: false };
  const reject = { value: null, flagged: true };
  if (cpLen(s) > CI_URL_MAX || /\s/.test(s) || hasBad(s)) return reject;
  // (T-116 Reviewer M-1) 파서마다 다르게 읽히는 형태를 먼저 막는다 — WHATWG 는 `\` 를 `/` 로 읽지만 Python urlsplit 은 아니다
  //   (`http://example.com\@127.0.0.1/` → WHATWG 호스트 example.com, urlsplit 호스트 127.0.0.1). `http:example.com/x`·`http:///…` 처럼
  //   `//` 바로 뒤에 호스트가 오지 않는 꼴도 WHATWG 만 고쳐 읽는다.
  if (s.includes('\\')) return reject;
  const m = /^(https?):\/\/([^/?#]+)/i.exec(s);
  if (!m) return reject;
  const authority = m[2];
  if (authority.includes('@')) return reject;                         // 사용자 정보(`user:pw@`·`user@`)
  let u: URL;
  try { u = new URL(s); } catch { return reject; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return reject;
  if (u.username !== '' || u.password !== '') return reject;          // 사용자 정보(WHATWG 판정도 한 번 더)
  if (u.port !== '') return reject;                                   // 기본 포트가 아닌 명시 포트(기본 포트는 URL 이 '' 로 지운다)
  const host = u.hostname.toLowerCase();
  if (host === '' || host.startsWith('[') || IPV4_RE.test(host.replace(/\.+$/, ''))) return reject;   // IP 리터럴
  const bare = host.replace(/\.+$/, '');                              // 끝 점 제거 뒤 판정(`localhost.`·`foo.localhost.`)
  if (bare === 'localhost' || bare.endsWith('.localhost') || !bare.includes('.')) return reject;
  // 원문 authority 의 호스트(포트 제거·소문자) = WHATWG hostname 일 때만 저장 — 정규화가 호스트를 바꾼 형태는 링크만 버린다.
  // 비 ASCII 호스트는 WHATWG 가 punycode 로 바꾸므로 같은 규칙으로 호스트만 다시 해석해 비교한다.
  const rawHost = authority.replace(/:\d*$/, '').toLowerCase();
  let rawHostAscii = rawHost;
  if (/[^\x00-\x7f]/.test(rawHost)) {
    try { rawHostAscii = new URL(`http://${rawHost}/`).hostname; } catch { return reject; }
  }
  if (rawHostAscii !== host) return reject;
  const href = u.href;                                                // 저장값 = WHATWG 정규화(스킴·호스트 소문자, 기본 포트 제거 등)
  if (cpLen(href) > CI_URL_MAX) return reject;
  return { value: href, flagged: false };
}

export function validateFeedHost(raw: unknown): FieldOut<string> {
  if (raw === null || raw === undefined) return { value: null, flagged: false };
  if (typeof raw !== 'string') return { value: null, flagged: true };
  const s = raw.trim().toLowerCase();
  if (s === '') return { value: null, flagged: false };
  if (s.length > CI_FEED_HOST_MAX || !HOST_RE.test(s)) return { value: null, flagged: true };
  return { value: s, flagged: false };
}

/**
 * ISO 8601 → { utc(키·해시용 UTC 정규화 `toISOString()`), kst(DATETIME) }. 해석은 keys.ts `parseIsoUtcStrict` 하나로 한다 —
 * 형식 불일치·1970~2100 년 밖·실재하지 않는 날짜·시각(2월 30일·24시 롤오버, T-116 Reviewer L-3)이면 published_at 만 null(+ rejected),
 * 다른 필드는 그대로 저장한다.
 */
export function parsePublishedAt(raw: unknown): FieldOut<{ utc: string; kst: string }> {
  if (raw === null || raw === undefined) return { value: null, flagged: false };
  if (typeof raw !== 'string') return { value: null, flagged: true };
  const s = raw.trim();
  if (s === '') return { value: null, flagged: false };
  const d = parseIsoUtcStrict(s);
  if (!d) return { value: null, flagged: true };
  return { value: { utc: d.toISOString(), kst: toKstDatetime(d) }, flagged: false };
}

export interface CiRawRssRow {
  sourceKey: string;
  contentSha256: string;
  publishedAt: string | null;
  url: string | null;
  guid: string | null;
  feedHost: string | null;
  title: string | null;
}

/** 항목 1개 검증 — row 가 null 이면 저장하지 않는다. flagged = 무언가 거부·수정됨(rejected 로 센다). */
export function validateNewsItem(raw: unknown): { row: CiRawRssRow | null; flagged: boolean } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { row: null, flagged: true };
  const o = raw as Record<string, unknown>;
  const title = sanitizeTitle(o.title);
  const guid = validateGuid(o.guid);
  const link = validateLink(o.link);
  const feedHost = validateFeedHost(o.feed_host);
  const pub = parsePublishedAt(o.published_at);
  const flagged = title.flagged || guid.flagged || link.flagged || feedHost.flagged || pub.flagged;
  if (guid.value === null && link.value === null && title.value === null) return { row: null, flagged: true };
  // 키·해시에는 UTC 정규화 발행시각(M-3) — 표기만 바뀐 같은 기사는 같은 키. 링크는 정규화된 href(M-1).
  const pubUtc = pub.value?.utc ?? null;
  const sourceKey = rssSourceKey({ feedHost: feedHost.value, guid: guid.value, link: link.value, title: title.value, publishedAt: pubUtc });
  const contentSha256 = sha256Hex(JSON.stringify([link.value, guid.value, title.value, pubUtc, feedHost.value]));
  return {
    row: {
      sourceKey, contentSha256, publishedAt: pub.value?.kst ?? null, url: link.value, guid: guid.value, feedHost: feedHost.value, title: title.value,
    },
    flagged,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 저장
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 🔴 `first_seen_at` 은 갱신 목록에 없다 — 같은 키를 다시 보면 `last_seen_at` 만 바뀐다(경계·단위 시험이 SQL 을 단언한다).
 * 열 목록에 없는 publisher·snippet·payload_ref·run_id 는 NULL. guid 는 Leader 결정 Q1 로 더한 열(url 바로 뒤).
 */
export const CI_RAW_ITEM_UPSERT_SQL =
  'INSERT INTO ci_raw_item (source_kind, source_key, version, content_sha256, availability, published_at, first_seen_at, last_seen_at, url, guid, feed_host, title, parser_version) VALUES ? ON DUPLICATE KEY UPDATE last_seen_at = VALUES(last_seen_at)';

/**
 * 일괄 INSERT 결과 → (신규, 기존 키 수). 여러 행이면 서버 info 문자열 `Records: N  Duplicates: D  Warnings: W` 의 D 가 정확한 기존 키 수다.
 * info 가 없으면(1행 INSERT 는 info 를 주지 않는다) affectedRows 로 추정: ODKU 는 신규 1·바뀐 기존 2·안 바뀐 기존 0
 * (같은 초에 두 번 본 경우 — 운영상 캡처 간격이 시간 단위라 드물다).
 */
export function countUpsert(n: number, res: { affectedRows?: unknown; info?: unknown } | null | undefined): { inserted: number; duplicates: number } {
  const info = typeof res?.info === 'string' ? res.info : '';
  const m = /Duplicates:\s*(\d+)/.exec(info);
  if (m) {
    const d = Math.min(n, Number(m[1]));
    return { inserted: n - d, duplicates: d };
  }
  const a = typeof res?.affectedRows === 'number' && Number.isFinite(res.affectedRows) ? res.affectedRows : 0;
  const inserted = n === 1 ? (a === 1 ? 1 : 0) : Math.max(0, Math.min(n, 2 * n - a));
  return { inserted, duplicates: n - inserted };
}

export interface CaptureOptions {
  now?: Date;
  /** 호출자가 같은 요청에서 이미 스위치를 확인했으면 true(다시 읽지 않는다). */
  assumeEnabled?: boolean;
  /** 공유 마감(epoch ms). 없으면 지금 + `CI_CAPTURE_TIMEOUT_MS`. 스위치 읽기와 INSERT 가 이 마감 하나를 나눠 쓴다. */
  deadline?: number;
}

/**
 * 항목들을 `ci_raw_item` 에 저장한다. **절대 던지지 않고, 마감(기본 지금+4초) 안에 돌아온다** — 스위치를 여기서 읽으면 그 읽기도
 * 같은 마감을 나눠 쓴다(합계 4초). 남은 시간이 0 이면 INSERT 를 보내지 않고 `failed`(reason `deadline`).
 * market 은 로그용이다(행에는 feed_host 가 남는다).
 */
export async function captureNewsItems(market: CaptureMarket, items: unknown, opts: CaptureOptions = {}): Promise<CaptureResult> {
  const zero = (status: CaptureResultStatus, rejected = 0): CaptureResult => ({ status, inserted: 0, duplicates: 0, rejected });
  const deadline = typeof opts.deadline === 'number' ? opts.deadline : Date.now() + CI_CAPTURE_TIMEOUT_MS;
  try {
    if (opts.assumeEnabled !== true) {
      const sw = await readCaptureSwitch(deadline);
      if (!sw.enabled) return zero('skipped_disabled');
    }
  } catch {
    return zero('skipped_disabled');
  }
  const ms = remainingMs(deadline);
  if (ms <= 0) {
    console.warn(`${LOG} ${String(market)} 마감이 지나 저장을 건너뜀(캡처 전체 상한 ${CI_CAPTURE_TIMEOUT_MS}ms 공유)`);
    return { ...zero('failed'), reason: 'deadline' };
  }
  return capped(captureBody(market, items, opts), ms, () => {
    console.warn(`${LOG} ${String(market)} 저장이 마감(남은 ${ms}ms) 안에 끝나지 않아 건너뜀(DB 대기 상한)`);
    return { ...zero('failed'), reason: 'deadline' };
  });
}

async function captureBody(market: CaptureMarket, items: unknown, opts: CaptureOptions): Promise<CaptureResult> {
  const list: unknown[] = Array.isArray(items) ? items : [];
  let rejected = Math.max(0, list.length - CI_CAPTURE_MAX_ITEMS);
  const byKey = new Map<string, CiRawRssRow>();
  let inBatchDup = 0;
  for (const raw of list.slice(0, CI_CAPTURE_MAX_ITEMS)) {
    const { row, flagged } = validateNewsItem(raw);
    if (flagged) rejected++;
    if (!row) continue;
    if (byKey.has(row.sourceKey)) { inBatchDup++; continue; }
    byKey.set(row.sourceKey, row);
  }
  const rows = [...byKey.values()];
  if (rows.length === 0) return { status: 'ok', inserted: 0, duplicates: inBatchDup, rejected };

  const seen = toKstDatetime(opts.now ?? new Date());
  const values = rows.map((r) => [
    'rss', r.sourceKey, 1, r.contentSha256, 'captured', r.publishedAt, seen, seen, r.url, r.guid, r.feedHost, r.title, CI_RSS_PARSER_VERSION,
  ]);
  try {
    const [res] = await getPool().query<ResultSetHeader>(CI_RAW_ITEM_UPSERT_SQL, [values]);
    const { inserted, duplicates } = countUpsert(rows.length, res);
    return { status: 'ok', inserted, duplicates: duplicates + inBatchDup, rejected };
  } catch (e) {
    if (isNoSuchTable(e)) {
      if (!noTableWarned) {
        noTableWarned = true;
        console.warn(`${LOG} ci_raw_item 테이블 없음(DDL 미적용 — scripts/migrations/T-116-ci-raw-item.sql) — 캡처를 건너뜀(프로세스당 1회 경고)`);
      }
      return { status: 'skipped_no_table', inserted: 0, duplicates: 0, rejected };
    }
    console.warn(`${LOG} ${String(market)} 저장 실패(무시): ${e instanceof Error ? e.message : String(e)}`);
    return { status: 'failed', inserted: 0, duplicates: 0, rejected };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 라우트용 진입점 — 캡처 + 상태 기록
// ─────────────────────────────────────────────────────────────────────────────

export interface CaptureFetchOutcomeInput {
  market: CaptureMarket;
  mode: CaptureMode;
  /** M4 호출이 (재시도 끝에) 성공했는가 */
  ok: boolean;
  /** M4 응답의 `items`(배열이 아니면 구 M4 — `no_items`) */
  items?: unknown;
  /** 라우트가 같은 요청에서 스위치를 이미 확인했으면 true */
  assumeEnabled?: boolean;
  now?: Date;
}

export interface CaptureFetchOutcomeResult {
  capture: CaptureResult | null;
  status: CaptureStatusValue | null;
  /** 공유 마감 때문에 건너뛴 단계(머리 주석). */
  deadline: CaptureDeadlineState;
}

/**
 * news-fetch 라우트가 시장별로 부른다. 스위치(꺼짐 = 아무것도 안 함) → 실패·항목 없음이면 상태만 → 저장 → 상태 기록.
 * **절대 던지지 않고, 시작할 때 정한 마감 하나(지금 + `CI_CAPTURE_TIMEOUT_MS` = 4초) 안에 돌아온다** — 세 단계가 그 마감을 나눠 쓰고,
 * 남은 시간이 0 이면 다음 단계를 건너뛴다(결과 `deadline`).
 */
export async function captureFetchOutcome(input: CaptureFetchOutcomeInput): Promise<CaptureFetchOutcomeResult> {
  const deadline = Date.now() + CI_CAPTURE_TIMEOUT_MS;
  try {
    return await captureFetchOutcomeBody(input, deadline);
  } catch (e) {
    console.warn(`${LOG} 예외 흡수: ${e instanceof Error ? e.message : String(e)}`);
    return { capture: null, status: null, deadline: 'ok' };
  }
}

async function captureFetchOutcomeBody(input: CaptureFetchOutcomeInput, deadline: number): Promise<CaptureFetchOutcomeResult> {
  const { market, mode } = input;
  if (!isCaptureMarket(market) || (mode !== 'peek' && mode !== 'ingest')) {
    console.warn(`${LOG} 알 수 없는 시장/모드(${String(market)}/${String(mode)}) — 캡처하지 않음`);
    return { capture: null, status: null, deadline: 'ok' };
  }
  if (input.assumeEnabled !== true) {
    const sw = await readCaptureSwitch(deadline);
    if (!sw.enabled) {
      // 마감 초과로 스위치를 못 읽었으면(timeout) 꺼짐과 같이 아무것도 쓰지 않는다 — 켜졌는지 모르면 쓰지 않는다.
      return { capture: { status: 'skipped_disabled', inserted: 0, duplicates: 0, rejected: 0 }, status: null, deadline: 'ok' };
    }
  }
  /** 상태 기록 + 마감 때문에 못 했는지 판정. */
  const record = async (st: Parameters<typeof recordCaptureStatus>[1]): Promise<{ status: CaptureStatusValue | null; skipped: boolean }> => {
    const status = await recordCaptureStatus(market, st, deadline);
    return { status, skipped: status === null && remainingMs(deadline) <= 0 };
  };
  const base = { mode, inserted: 0, duplicates: 0, rejected: 0, now: input.now };
  if (!input.ok) {
    const r = await record({ ...base, status: 'fetch_failed', fetched: 0 });
    return { capture: null, status: r.status, deadline: r.skipped ? 'status_skipped' : 'ok' };
  }
  if (!Array.isArray(input.items)) {
    console.warn(`${LOG} ${market} ${mode} 응답에 items 배열이 없음(구 M4?) — 캡처하지 않음`);
    const r = await record({ ...base, status: 'no_items', fetched: 0 });
    return { capture: null, status: r.status, deadline: r.skipped ? 'status_skipped' : 'ok' };
  }
  const capture = await captureNewsItems(market, input.items, { now: input.now, assumeEnabled: true, deadline });
  const r = await record({
    mode, status: capture.status, fetched: input.items.length,
    inserted: capture.inserted, duplicates: capture.duplicates, rejected: capture.rejected, now: input.now,
  });
  const dl: CaptureDeadlineState = capture.reason === 'deadline' ? 'insert_skipped' : r.skipped ? 'status_skipped' : 'ok';
  console.log(`${LOG} ${market} ${mode} ${capture.status} fetched=${input.items.length} inserted=${capture.inserted} duplicates=${capture.duplicates} rejected=${capture.rejected}`
    + (dl !== 'ok' ? ` deadline=${dl}` : ''));
  return { capture, status: r.status, deadline: dl };
}

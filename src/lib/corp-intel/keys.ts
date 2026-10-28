/**
 * corp-intel 멱등 키 (T-116) — 순수 함수. 입출력·DB·시계·환경변수 없음.
 *
 * ## RSS 항목 키 `rssSourceKey`
 *
 * 설계서 §6.2: `sha256(feed_host ∣ guid 또는 link ∣ title ∣ pubDate)`. 같은 기사가 다음 캡처에서 다시 보이면 같은 키가 나와야
 * `ci_raw_item` 의 `UNIQUE (source_kind, source_key, version)` 이 한 행으로 묶고 `first_seen_at` 을 지킨다.
 *
 * - **정규화**: 각 값은 문자열이 아니면 빈 문자열, 앞뒤 공백 제거, 안쪽 연속 공백(줄바꿈·탭 포함)을 공백 1개로 접는다.
 *   `feedHost` 는 소문자로(호스트 이름은 대소문자를 구분하지 않는다). guid·link·title·발행시각은 대소문자를 바꾸지 않는다
 *   (URL 경로·GUID 는 대소문자를 구분할 수 있다).
 * - **guid 우선**: guid 가 (정규화 뒤) 비어 있지 않으면 guid, 아니면 link. 둘 다 없으면 빈 문자열.
 * - **발행시각은 UTC 정규화 값**(T-116 Reviewer M-3 · Leader 결정): 원문 문자열을 쓰면 M4 가 표기만 바꿔도(`+00:00`↔`Z`·소수초·
 *   `+09:00`) 같은 기사의 키가 전부 바뀌어 중복 행이 생기고 first_seen_at 이 새로 시작된다. 그래서 `parseIsoUtcStrict` 로 해석한 뒤
 *   `toISOString()`(예 `2026-10-28T09:42:03.000Z`)을 키에 넣는다. 해석 불가·없음·불가능한 날짜(2월 30일·24시 — L-3)는 빈 문자열.
 * - **구분자 충돌 방지**: 설계서의 `∣` 를 문자 그대로 이어 붙이면 `("a|b","c")` 와 `("a","b|c")` 가 같은 입력이 된다.
 *   그래서 네 값을 **JSON 배열 문자열**(`["host","guid 또는 link","title","publishedAt"]`)로 직렬화한 뒤 sha256 을 낸다 —
 *   JSON 은 값 안의 따옴표·역슬래시를 이스케이프하므로 서로 다른 네 값 묶음은 서로 다른 문자열이 된다. 같은 의미의 순서는
 *   설계서 §6.2 그대로다. 단계 2 에서 키를 다시 계산할 때는 이 함수를 그대로 쓴다(직렬화 규칙을 바꾸면 키가 전부 바뀐다 —
 *   바꿀 일이 생기면 `RSS_KEY_SCHEME` 을 올리고 새 `version` 정책을 함께 정한다).
 * - 출력: 소문자 16진 64자(`source_key VARCHAR(190)` 안).
 */
import { createHash } from 'node:crypto';

/** 키 직렬화 방식 이름 — 바꾸면 모든 RSS 키가 바뀐다(위 주석). parser_version 에 함께 남긴다. */
export const RSS_KEY_SCHEME = 'json4-utc';

export interface RssKeyInput {
  feedHost?: unknown;
  guid?: unknown;
  link?: unknown;
  title?: unknown;
  publishedAt?: unknown;
}

/** 문자열이 아니면 빈 문자열, 앞뒤 공백 제거, 안쪽 연속 공백(\s — 줄바꿈·탭 포함)을 공백 1개로. */
export function normalizeKeyPart(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.replace(/\s+/g, ' ').trim();
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** ISO 8601(날짜 T 시각 [초 [소수 1~6자리]] Z 또는 ±hh[:]mm) — 시간대 필수. */
const ISO_PARTS_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?(Z|([+-])(\d{2}):?(\d{2}))$/;

/**
 * 엄격한 ISO 해석 → UTC 시각(Date). 형식이 다르거나, 날짜·시각 성분이 실재하지 않으면(2026-02-30·24:00·60초 — `Date` 가 다음 날로
 * 넘기는 롤오버, T-116 Reviewer L-3) null. 시간대 오프셋은 시 ≤ 23·분 ≤ 59. 1970~2100년 밖도 null. 순수 함수(시계·환경 무관).
 */
export function parseIsoUtcStrict(v: unknown): Date | null {
  if (typeof v !== 'string') return null;
  const m = ISO_PARTS_RE.exec(v.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  const sec = m[6] === undefined ? 0 : Number(m[6]);
  const frac = m[7] === undefined ? 0 : Math.floor(Number(`0.${m[7]}`) * 1000);
  if (y < 1970 || y > 2100) return null;
  const local = new Date(Date.UTC(y, mo - 1, d, h, mi, sec, frac));
  // 역변환 — 성분이 그대로 돌아오지 않으면 롤오버(실재하지 않는 날짜·시각)
  if (local.getUTCFullYear() !== y || local.getUTCMonth() !== mo - 1 || local.getUTCDate() !== d
    || local.getUTCHours() !== h || local.getUTCMinutes() !== mi || local.getUTCSeconds() !== sec) return null;
  let offsetMin = 0;
  if (m[8] !== 'Z') {
    const oh = Number(m[10]);
    const om = Number(m[11]);
    if (oh > 23 || om > 59) return null;
    offsetMin = (m[9] === '-' ? -1 : 1) * (oh * 60 + om);
  }
  const utc = new Date(local.getTime() - offsetMin * 60_000);
  const uy = utc.getUTCFullYear();
  if (uy < 1970 || uy > 2100) return null;
  return utc;
}

/** 키에 넣는 발행시각 — UTC 정규화 `toISOString()`, 해석 불가·없음이면 빈 문자열. */
export function publishedAtKeyPart(v: unknown): string {
  const d = parseIsoUtcStrict(v);
  return d ? d.toISOString() : '';
}

/** 설계서 §6.2 RSS 키 — 위 머리 주석의 규칙. */
export function rssSourceKey(input: RssKeyInput): string {
  const feedHost = normalizeKeyPart(input.feedHost).toLowerCase();
  const guid = normalizeKeyPart(input.guid);
  const link = normalizeKeyPart(input.link);
  const title = normalizeKeyPart(input.title);
  const publishedAt = publishedAtKeyPart(input.publishedAt);
  return sha256Hex(JSON.stringify([feedHost, guid !== '' ? guid : link, title, publishedAt]));
}

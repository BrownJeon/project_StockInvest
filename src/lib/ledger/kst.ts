/**
 * T-074 — KST 벽시계 시각 도우미 (순수, 서버·클라이언트 공용).
 *
 * 원장의 시각은 `portfolio_snapshots.ts` 와 같은 규약인 **KST 벽시계**다(Analyst Q2 DDL 주석).
 * 내부 비교는 "벽시계 ms" — KST 벽시계 성분을 UTC 로 취급한 `Date.UTC(...)` 값 — 로 한다(데모 `tm()` 과 같은 방식).
 * 서버 프로세스 TZ 와 무관하다.
 *
 * DB 에서 읽은 DATETIME 은 mysql2 풀(`timezone: '+09:00'`)이 **올바른 순간(instant)의 Date** 로 돌려주므로 +9h 해서 벽시계로 바꾼다.
 * 쓸 때는 벽시계 문자열('YYYY-MM-DD HH:mm:ss')을 그대로 바인딩한다(T-046·T-050 교훈 — toISOString 을 자르면 9시간 틀어진다).
 */

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
const KST_OFFSET_MS = 9 * HOUR_MS;

const WALL_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;

function z(n: number): string {
  return (n < 10 ? '0' : '') + n;
}

/** 'YYYY-MM-DD HH:mm[:ss]'(KST) → 벽시계 ms. 달력에 없는 날짜·범위 밖 시각은 null */
export function parseKstWall(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const m = WALL_RE.exec(s.trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], se = m[6] == null ? 0 : +m[6];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return null;
  const t = Date.UTC(y, mo - 1, d, h, mi, se);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return t;
}

/** 분 단위 입력 'YYYY-MM-DD HH:mm'(초가 있으면 :00 만 허용) → 벽시계 ms. 아니면 null */
export function parseKstMinute(s: unknown): number | null {
  const t = parseKstWall(s);
  if (t == null) return null;
  return t % MINUTE_MS === 0 ? t : null;
}

/** 벽시계 ms → 'YYYY-MM-DD HH:mm:ss' */
export function formatKstWall(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${z(d.getUTCMonth() + 1)}-${z(d.getUTCDate())} ${z(d.getUTCHours())}:${z(d.getUTCMinutes())}:${z(d.getUTCSeconds())}`;
}

/** 벽시계 ms → 'YYYY-MM-DD HH:mm' */
export function formatKstMinute(ms: number): string {
  return formatKstWall(ms).slice(0, 16);
}

/** 벽시계 ms → 'MM-DD HH:mm' (데모 `md()`) */
export function formatKstShort(ms: number): string {
  return formatKstWall(ms).slice(5, 16);
}

/** 순간(Date·epoch ms) → 벽시계 ms */
export function instantToWallMs(d: Date | number): number {
  return (typeof d === 'number' ? d : d.getTime()) + KST_OFFSET_MS;
}

/**
 * DB DATETIME 값 → 벽시계 ms.
 *  - Date: mysql2(`timezone:'+09:00'`)가 만든 순간 → +9h
 *  - 문자열: 벽시계 그대로(dateStrings 연결·가짜 DB)
 */
export function dbDatetimeToWallMs(v: unknown): number | null {
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? t + KST_OFFSET_MS : null;
  }
  if (typeof v === 'string') return parseKstWall(v.slice(0, 19));
  return null;
}

/** 벽시계 ms 를 분 단위로 내림 */
export function floorMinute(ms: number): number {
  return Math.floor(ms / MINUTE_MS) * MINUTE_MS;
}

/** 벽시계 시(0~23) */
export function wallHour(ms: number): number {
  return new Date(ms).getUTCHours();
}

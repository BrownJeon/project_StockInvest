/**
 * T-112 실행·판단 기록 — 공용 안전 헬퍼(순수 함수 + 시간 상한). DB·환경변수·시계 의존 없음(withDeadline* 의 타이머만).
 *
 * 기록기(`job-run-log.ts` — 크론 실행 기록, 판단 기록기 — 장마감 분석 후보·AI 판단)가 **값을 넣기 전에** 쓰는 도구다.
 * 근거: DDL 일회용 MariaDB 시험(docs/design/2026-10-30-t112-record-ddl-draft.md §10.6 F3·F5·F6)과 T-112 「구현 규칙」 표.
 *
 * - F3 길이: 문자열은 **코드포인트 단위**로 자른다. JS `s.slice(0, N)` 은 서로게이트 쌍(이모지 등)을 반쪽으로 쪼개고, 그 반쪽은 utf8mb4 에
 *   저장할 수 없어(1366) 또는 U+FFFD 로 바뀌어 저장된다. 열 하나만 넘어도 multi-row INSERT **한 문장 전체**가 거부되므로(1406, strict) 모든 열을
 *   넣기 전에 자른다. 짝 없는 서로게이트(원래부터 깨진 입력)도 같은 이유로 U+FFFD 로 바꾼다 — 코드포인트 수는 그대로다.
 * - F5 종목: 한 실행 안의 대소문자·공백 변형('nas:mu', 'NAS:MU ')은 DB 콜레이션(general_ci·PAD SPACE)이 같은 키로 보므로 1062 로 문장 전체가
 *   실패한다 → 넣기 전에 정규화하고 중복을 없앤다.
 * - F6 오류 판별: mysql2 는 MariaDB errno 4025(CHECK 위반)를 MySQL 번호표로 `code: 'ER_INNODB_AUTOEXTEND_SIZE_OUT_OF_RANGE'` 라고 표시한다 —
 *   `code` 문자열이 아니라 **`errno` 숫자**로 판별한다.
 * - 시간 상한: 기록은 관찰 전용이라 늦어도 흐름을 막지 않는다(`news-health.ts`·`raw-capture.ts` 와 같은 원칙). 상한 뒤 늦게 끝난 본문은 그대로
 *   두고 그 거부만 흡수한다(처리되지 않은 거부가 남지 않는다).
 */

/** 짝 없는 서로게이트(앞 짝 없는 하위 / 뒤 짝 없는 상위). */
const LONE_SURROGATE_G = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * 문자열을 코드포인트 `max` 개 이하로 자른다. 문자열이 아니면 null. 짝 없는 서로게이트는 U+FFFD 로 바꾼다.
 * `max` 가 유한한 수가 아니거나 0 이하이면 빈 문자열(음수 길이 열은 없다 — 호출 실수를 조용히 넘기지 않으려 null 이 아닌 '' 를 준다).
 * 서로게이트 쌍은 쪼개지 않는다(`Array.from` 은 코드포인트 단위로 나눈다).
 */
export function truncateCodePoints(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const limit = Number.isFinite(max) ? Math.floor(max) : 0;
  if (limit <= 0) return '';
  const s = v.replace(LONE_SURROGATE_G, '�');
  // 빠른 길: UTF-16 길이 ≤ limit 이면 코드포인트 수도 ≤ limit
  if (s.length <= limit) return s;
  const cps = Array.from(s);
  if (cps.length <= limit) return s;
  return cps.slice(0, limit).join('');
}

/** {@link truncateCodePoints} 와 같은 뜻의 별칭 — 기록기 코드에서 "열에 맞춘다"는 뜻으로 읽히게. */
export const clampText = truncateCodePoints;

/** 앱 심볼 열 길이(judgment_candidate.symbol VARCHAR(32)). */
export const SYMBOL_MAX = 32;

/**
 * 종목 기호 정규화 — 앞뒤 공백 제거·대문자. 문자열이 아니거나, 비었거나, 코드포인트 32개를 넘으면 null(자르지 않고 **거부** — 잘린 기호는
 * 다른 종목이 될 수 있다). 앱 심볼 형식('005930', 'NAS:MU')은 이미 대문자라 값이 바뀌지 않는다.
 */
export function normalizeSymbol(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toUpperCase();
  if (s === '') return null;
  if (LONE_SURROGATE_RE.test(s)) return null;
  if (Array.from(s).length > SYMBOL_MAX) return null;
  return s;
}

/** 같은 키의 행은 **처음 것만** 남긴다(순서 유지). 키 계산이 던지면 그대로 던진다(호출자가 정규화된 값으로 키를 만든다). */
export function dedupeBy<T>(rows: readonly T[], keyOf: (r: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    const k = keyOf(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

function errnoOf(e: unknown): number | undefined {
  if (e === null || typeof e !== 'object') return undefined;
  const n = (e as { errno?: unknown }).errno;
  return typeof n === 'number' ? n : undefined;
}

/** MariaDB CHECK 제약 위반(errno 4025). `code` 문자열은 보지 않는다(F6). */
export function isCheckViolation(e: unknown): boolean {
  return errnoOf(e) === 4025;
}

/** 테이블 없음(ER_NO_SUCH_TABLE, errno 1146) — DDL 적용 전. */
export function isNoSuchTable(e: unknown): boolean {
  return errnoOf(e) === 1146;
}

/**
 * 값이 열에 맞지 않아 거부된 오류인가(그 행만 빼고 나머지는 넣을 수 있는 종류) — 4025 CHECK · 1406 길이 초과 · 1366 문자 · 1265 잘림(ENUM 등) ·
 * 1264 범위 · 4038 JSON 형식 · 1048 NULL · 1292 날짜·시각 형식. 연결·잠금·문법 오류는 여기에 들지 않는다(그때는 다시 보내야 한다).
 */
export function isRowDataError(e: unknown): boolean {
  const n = errnoOf(e);
  return n === 4025 || n === 1406 || n === 1366 || n === 1265 || n === 1264 || n === 4038 || n === 1048 || n === 1292;
}

function settleTimer(ms: number, onTimeout: () => void): ReturnType<typeof setTimeout> {
  const t = setTimeout(onTimeout, ms);
  (t as unknown as { unref?: () => void }).unref?.();
  return t;
}

/**
 * `p` 를 `ms` 까지 기다린다. 시간 안에 끝나면 그 값, 넘으면 **undefined**. 시간 안에 거부되면 그 오류를 **던진다**(호출자가 판별 — 예: 1146).
 * 상한 뒤의 늦은 거부는 흡수한다. `ms` 가 유한한 양수가 아니면 기다리지 않고 undefined(마감이 이미 지났다).
 */
export function withDeadline<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve, reject) => {
    let done = false;
    const wait = Number.isFinite(ms) ? Math.floor(ms) : 0;
    const timer = wait > 0
      ? settleTimer(wait, () => { if (!done) { done = true; resolve(undefined); } })
      : undefined;
    Promise.resolve(p).then(
      (v) => { if (!done) { done = true; if (timer) clearTimeout(timer); resolve(v); } },
      (e: unknown) => { if (!done) { done = true; if (timer) clearTimeout(timer); reject(e); } /* 마감 뒤 거부는 흡수 */ },
    );
    if (wait <= 0 && !done) { done = true; resolve(undefined); }
  });
}

/**
 * {@link withDeadline} 의 **절대 던지지 않는** 변형 — 시간 초과·거부 모두 undefined. 거부는 `onError` 로 알려 준다(그 콜백이 던져도 흡수).
 * 기록처럼 "결과를 정한 뒤 기다리지 않는" 호출의 끝에 쓴다.
 */
export async function withDeadlineSafe<T>(
  p: Promise<T>,
  ms: number,
  onError?: (e: unknown) => void,
): Promise<T | undefined> {
  try {
    return await withDeadline(p, ms);
  } catch (e) {
    try { onError?.(e); } catch { /* 로그 실패도 흡수 */ }
    return undefined;
  }
}

/**
 * us-session.ts — 미국 정규장 세션 날짜·시각 계산 (T-062, post-market 해외 카드 전용).
 *
 * ## 왜 `market-hours.ts` 를 쓰지 않고 따로 두는가
 * `market-hours.ts` 의 휴장 로더는 DB 오류를 **빈 집합으로 삼킨다**(= 휴장 없음 → 열림 쪽 판정, fail-open). entry-watcher 등
 * 기존 호출부는 그 동작을 전제로 하므로 수정하지 않는다. post-market 해외 카드는 휴장일을 모르면 **휴장일용 카드**를 만들 수
 * 있으므로, 여기서는 휴장 표를 엄격하게 읽는다(오류·해당 연도 0행 = 던짐). DST 판정만 `isUSDST` 를 재사용한다.
 *
 * ## 날짜 표기
 * 모든 "세션 날짜"는 **미국 동부(ET) 벽시계 날짜** `YYYY-MM-DD` 문자열이다. 시각은 UTC epoch(ms) 로 돌려주고, DB 저장 문자열은
 * 호출부가 `toKstDatetime` 으로 만든다(T-046 — DB `DATETIME` 은 KST 벽시계).
 *
 * ## 반일장
 * `market_holidays` 의 `half_day=1` 행(추수감사절 다음 날·성탄 전날 등)도 **닫힘**으로 본다(D-2). entry-watcher 의 `isOverseasOpen`
 * 이 반일장을 휴장으로 판정하므로, 그날용 카드는 감시가 영원히 '장외'로 봐서 실행되지 않는다.
 */
import type { RowDataPacket } from 'mysql2';
import { isUSDST } from './market-hours';

/** 최소 쿼리 인터페이스 — mysql2 Pool 과 테스트 대역이 모두 만족한다. */
export interface SessionQueryable {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<[T, unknown]>;
}

const HOUR_MS = 3600_000;
const DAY_MS = 86_400_000;
/** 정규장 09:30 / 16:00 ET (분) */
export const US_OPEN_MIN = 9 * 60 + 30;
export const US_CLOSE_MIN = 16 * 60;

/** 이 시각의 ET 오프셋(시간). EDT = -4, EST = -5. DST 경계는 `isUSDST`(UTC 기준 02:00 현지 전환)를 그대로 쓴다. */
function etOffsetHours(at: Date): number {
  return isUSDST(at) ? -4 : -5;
}

/** 이 시각의 ET 벽시계 날짜 `YYYY-MM-DD`. */
export function etDateOf(now: Date): string {
  return new Date(now.getTime() + etOffsetHours(now) * HOUR_MS).toISOString().slice(0, 10);
}

/** 이 시각의 ET 벽시계 분(0~1439). */
export function etMinutesOf(now: Date): number {
  const w = new Date(now.getTime() + etOffsetHours(now) * HOUR_MS);
  return w.getUTCHours() * 60 + w.getUTCMinutes();
}

function parseYmd(d: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`날짜 형식 아님: ${d}`);
  const t = Date.parse(`${d}T00:00:00Z`);
  if (!Number.isFinite(t)) throw new Error(`날짜 해석 실패: ${d}`);
  return t;
}

/** `YYYY-MM-DD` 에 달력 n 일을 더한다(시간대 무관 — 날짜 라벨 산술). */
export function addDaysYmd(d: string, n: number): string {
  return new Date(parseYmd(d) + n * DAY_MS).toISOString().slice(0, 10);
}

/** 미국 거래일인가: 월~금이고 휴장(반일장 포함) 표에 없다. */
export function isUsTradingDay(d: string, closed: ReadonlySet<string>): boolean {
  const dow = new Date(parseYmd(d)).getUTCDay();
  return dow >= 1 && dow <= 5 && !closed.has(d);
}

/** 지금 미국 정규장이 열려 있는가(ET 날짜가 거래일이고 09:30 ≤ 분 < 16:00). */
export function isUsRegularSessionOpen(now: Date, closed: ReadonlySet<string>): boolean {
  const m = etMinutesOf(now);
  return isUsTradingDay(etDateOf(now), closed) && m >= US_OPEN_MIN && m < US_CLOSE_MIN;
}

/**
 * 방금 끝난 정규장 세션 D0(ET 날짜). **오늘(ET) 이 거래일이고 16:00 ET 가 지났을 때만** 오늘을 돌려주고, 그 밖에는 null.
 *
 * null = "새 종가가 생기지 않았다"(ET 주말·휴장·장 시작 전·장중). 08:00 KST 실행 기준으로 KST 일·월요일 아침(= ET 토·일)과
 * 휴장 다음 날 아침이 여기에 해당한다. 그 실행을 건너뛰어도 카드가 비는 세션은 생기지 않는다 — 직전 실행이 휴장을 건너뛴
 * **다음 거래일**용 카드를 이미 만들었다(`nextSessionsEt`).
 */
export function lastCompletedSessionEt(now: Date, closed: ReadonlySet<string>): string | null {
  const d = etDateOf(now);
  if (!isUsTradingDay(d, closed)) return null;
  return etMinutesOf(now) >= US_CLOSE_MIN ? d : null;
}

/** D0 다음의 미국 거래일 n 개(S1..Sn). 휴장 표가 그 구간을 덮는지는 호출부가 `yearsNeededFor` 로 보장한다. */
export function nextSessionsEt(d0: string, n: number, closed: ReadonlySet<string>): string[] {
  const out: string[] = [];
  let d = d0;
  for (let guard = 0; out.length < n; guard++) {
    if (guard > 60) throw new Error(`다음 거래일을 60일 안에서 찾지 못함 (D0=${d0})`);
    d = addDaysYmd(d, 1);
    if (isUsTradingDay(d, closed)) out.push(d);
  }
  return out;
}

/**
 * ET 날짜의 정규장 09:30 / 16:00 을 UTC epoch(ms) 로. DST 는 **그 날짜에서** 판정한다(실행 시각이 아니라) — 금요일(EDT) 실행이
 * DST 가 끝난 월요일(EST) 세션 카드를 만들 때 1시간 어긋나지 않게 하기 위해서다(T-046 류 사고 방지).
 * 거래일(월~금)에는 하루 안에서 DST 가 바뀌지 않으므로(전환은 일요일 02:00 현지) 그 날짜 12:00 UTC 시점으로 판정한다.
 */
export function sessionWindowUtc(dateEt: string): { openUtc: number; closeUtc: number } {
  const midnight = parseYmd(dateEt);
  const offH = etOffsetHours(new Date(midnight + 12 * HOUR_MS));
  return {
    openUtc: midnight + US_OPEN_MIN * 60_000 - offH * HOUR_MS,
    closeUtc: midnight + US_CLOSE_MIN * 60_000 - offH * HOUR_MS,
  };
}

/**
 * 🔴 S-4 — KIS 해외 일봉 `ts` → 거래소 세션 날짜. **시간대 변환을 하지 않는다.**
 *
 * `kis-overseas.ts getDailyCandles` 는 `xymd`(YYYYMMDD, 거래소 현지 날짜)를 `new Date('YYYY-MM-DDT00:00:00Z')` 로 바꿔
 * `ts` 에 싣는다 = 그 날짜의 **UTC 자정**. 여기에 ET 오프셋을 적용하면 하루 전 날짜(전날 19:00/20:00 ET)가 되어 정상 봉을
 * 전부 '오래된 봉'으로 버리게 된다. 그래서 UTC 날짜를 그대로 읽어 D0(ET 날짜 라벨)와 비교한다.
 */
export function candleSessionDate(ts: number): string | null {
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toISOString().slice(0, 10);
}

/** 실행 시각 기준으로 휴장 표가 있어야 하는 연도들: ET 오늘 −10일 ~ +30일 (S5 + 연휴가 넘어갈 수 있는 범위). */
export function yearsNeededFor(now: Date): number[] {
  const today = etDateOf(now);
  const ys = new Set<number>();
  for (const off of [-10, 30]) ys.add(Number(addDaysYmd(today, off).slice(0, 4)));
  ys.add(Number(today.slice(0, 4)));
  return [...ys].sort((a, b) => a - b);
}

/**
 * 해외 휴장일(반일장 포함) 집합을 **엄격하게** 읽는다. DB 오류는 그대로 던지고, 요청한 연도 중 행이 0개인 연도가 있으면
 * "모름"으로 던진다(휴장 표가 아직 안 채워진 해에 휴장일용 카드를 만들지 않기 위해). 캐시 없음(하루 1회 실행).
 * 날짜는 `DATE_FORMAT` 문자열로 받는다 — mysql2 가 DATE 를 JS Date 로 바꾸며 풀 시간대(+09:00)로 하루 밀리는 일을 피한다.
 */
export async function loadUsClosedDaysStrict(db: SessionQueryable, years: number[]): Promise<Set<string>> {
  if (years.length === 0) throw new Error('휴장 표 연도 없음');
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(holiday_date, '%Y-%m-%d') AS d
       FROM market_holidays
      WHERE market = 'overseas' AND YEAR(holiday_date) IN (?)`,
    [years],
  );
  const set = new Set<string>();
  const seenYears = new Set<number>();
  for (const r of rows ?? []) {
    const d = String(r?.d ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`휴장 표 날짜 형식 이상: ${d}`);
    set.add(d);
    seenYears.add(Number(d.slice(0, 4)));
  }
  const missing = years.filter((y) => !seenYears.has(y));
  if (missing.length > 0) throw new Error(`해외 휴장 표에 ${missing.join(',')}년 행이 없음`);
  return set;
}

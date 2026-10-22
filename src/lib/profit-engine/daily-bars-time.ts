/**
 * T-070 일봉 저장소 — 시장 현지 시각·확정 봉·오프아워 판정 (순수 함수, import 0개).
 *
 *  - 날짜는 전부 'YYYY-MM-DD' 문자열로 다룬다(Date 의 로컬 시간대 해석에 기대지 않는다).
 *  - 미국 = America/New_York(서머타임 자동), 국내 = Asia/Seoul.
 *  - 확정 봉: 지난 날짜이거나, 오늘 날짜면 미국 ET 16:30·국내 KST 15:40 이후(T-064 §5.3·ADP-006 빌더와 같은 기준).
 *  - 오프아워: T-070 금지·안전 — KST 05:10~08:30, 15:40~22:20 에만, 매시 정각 앞뒤와 08:00 작업 시간은 피한다.
 *    장중 주문 감시(entry-watcher 1분 폴링)와 KIS 초당 한도를 나눠 쓰지 않기 위해서다.
 */

export type BarMarket = 'KR' | 'US';

const TZ: Record<BarMarket, string> = { KR: 'Asia/Seoul', US: 'America/New_York' };
/** 그날 봉을 확정으로 보는 현지 시각(분). */
const FINAL_AFTER_MIN: Record<BarMarket, number> = { KR: 15 * 60 + 40, US: 16 * 60 + 30 };

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isYmd(s: unknown): s is string {
  if (typeof s !== 'string' || !YMD.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** 'YYYY-MM-DD' ± n일 (달력 일수, UTC 산술이라 시간대 영향 없음). */
export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 두 날짜 사이 달력 일수(b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function ymdCompact(ymd: string): string {
  return ymd.replace(/-/g, '');
}

/** 'YYYYMMDD' → 'YYYY-MM-DD' (형식이 틀리면 null). */
export function ymdFromCompact(s: unknown): string | null {
  if (typeof s !== 'string' || !/^\d{8}$/.test(s)) return null;
  const ymd = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return isYmd(ymd) ? ymd : null;
}

export interface LocalParts {
  date: string;      // 'YYYY-MM-DD'
  minutes: number;   // 0..1439
  weekday: number;   // 0=일 … 6=토
}

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localPartsIn(timeZone: string, now: Date): LocalParts {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
    }).formatToParts(now).map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute),
    weekday: WD[parts.weekday] ?? 0,
  };
}

export function marketLocal(market: BarMarket, now: Date): LocalParts {
  return localPartsIn(TZ[market], now);
}

/** 이 거래일 봉이 지금 확정인가. 미래 날짜는 false. */
export function isFinalBar(market: BarMarket, tradeDate: string, now: Date): boolean {
  const l = marketLocal(market, now);
  if (tradeDate < l.date) return true;
  if (tradeDate > l.date) return false;
  return l.minutes >= FINAL_AFTER_MIN[market];
}

/**
 * 지금 기준 "가장 최근에 확정됐을 평일" — 저장된 MAX(trade_date) 가 이 날 이상이면 증분 호출을 건너뛴다.
 * 공휴일은 모른다(그날은 호출 1번이 헛돌 뿐 — 데이터는 틀리지 않는다).
 */
export function lastExpectedFinalDate(market: BarMarket, now: Date): string {
  const l = marketLocal(market, now);
  const isWeekday = (wd: number) => wd >= 1 && wd <= 5;
  if (isWeekday(l.weekday) && l.minutes >= FINAL_AFTER_MIN[market]) return l.date;
  let d = addDays(l.date, -1);
  let wd = (l.weekday + 6) % 7;
  while (!isWeekday(wd)) {
    d = addDays(d, -1);
    wd = (wd + 6) % 7;
  }
  return d;
}

/** 오프아워 창(KST 분). [시작, 끝) */
export const OFFHOURS_WINDOWS_KST: ReadonlyArray<readonly [number, number]> = [
  [5 * 60 + 10, 8 * 60 + 30],
  [15 * 60 + 40, 22 * 60 + 20],
];
/** 매시 정각 앞뒤로 피하는 분 — 실행 시작은 분이 이 범위 안일 때만. */
export const OFFHOURS_MINUTE_RANGE: readonly [number, number] = [3, 55];
/** 08:00 해외 분석 작업 회피 구간(KST 분). [시작, 끝) */
export const OFFHOURS_AVOID_KST: ReadonlyArray<readonly [number, number]> = [[7 * 60 + 55, 8 * 60 + 10]];
/** 창 끝 직전에는 시작하지 않는다(한 번 실행 예산 100초 + 여유). */
export const OFFHOURS_END_MARGIN_MIN = 3;

export interface OffHoursCheck {
  ok: boolean;
  kst: string;          // 'HH:MM'
  reason?: 'outside_window' | 'near_hour_mark' | 'avoid_0800_job' | 'window_ending';
}

export function checkOffHoursWindow(now: Date): OffHoursCheck {
  const l = localPartsIn('Asia/Seoul', now);
  const kst = `${String(Math.floor(l.minutes / 60)).padStart(2, '0')}:${String(l.minutes % 60).padStart(2, '0')}`;
  const win = OFFHOURS_WINDOWS_KST.find(([a, b]) => l.minutes >= a && l.minutes < b);
  if (!win) return { ok: false, kst, reason: 'outside_window' };
  if (l.minutes > win[1] - OFFHOURS_END_MARGIN_MIN) return { ok: false, kst, reason: 'window_ending' };
  if (OFFHOURS_AVOID_KST.some(([a, b]) => l.minutes >= a && l.minutes < b)) return { ok: false, kst, reason: 'avoid_0800_job' };
  const m = l.minutes % 60;
  if (m < OFFHOURS_MINUTE_RANGE[0] || m > OFFHOURS_MINUTE_RANGE[1]) return { ok: false, kst, reason: 'near_hour_mark' };
  return { ok: true, kst };
}

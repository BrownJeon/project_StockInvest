import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import type { Market } from '@/lib/exchanges/kis-symbols';

export type { Market };

// ──────────────────────────────────────────────────────────────────────
// 공휴일 캐시 (key=`${market}:${YYYY}` → Set of 'MM-DD')
// ──────────────────────────────────────────────────────────────────────
const HOLIDAY_CACHE = new Map<string, { set: Set<string>; loadedAt: number }>();
const HOLIDAY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function loadHolidaysFor(market: Market, year: number): Promise<Set<string>> {
  const key = `${market}:${year}`;
  const cached = HOLIDAY_CACHE.get(key);
  if (cached && Date.now() - cached.loadedAt < HOLIDAY_CACHE_TTL_MS) {
    return cached.set;
  }
  try {
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(holiday_date, '%m-%d') AS md
         FROM market_holidays
        WHERE market = ? AND YEAR(holiday_date) = ?`,
      [market, year],
    );
    const set = new Set<string>(rows.map(r => String(r.md)));
    HOLIDAY_CACHE.set(key, { set, loadedAt: Date.now() });
    return set;
  } catch {
    // DB 미접근 시 보수적으로 빈 set (가능한 한 닫힘 측 판단은 호출부에서)
    return new Set();
  }
}

export async function isHoliday(market: Market, date: Date): Promise<boolean> {
  const tz = market === 'domestic' ? 'Asia/Seoul' : 'America/New_York';
  const local = new Date(date.toLocaleString('en-US', { timeZone: tz }));
  const year = local.getFullYear();
  const set = await loadHolidaysFor(market, year);
  const md = `${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
  return set.has(md);
}

// ──────────────────────────────────────────────────────────────────────
// US DST: 3월 둘째 일요일 02:00 ~ 11월 첫째 일요일 02:00 (현지 ET 기준)
// ──────────────────────────────────────────────────────────────────────
function nthSundayOfMonth(year: number, monthZeroBased: number, n: number): number {
  const first = new Date(Date.UTC(year, monthZeroBased, 1));
  const offset = (7 - first.getUTCDay()) % 7;
  return 1 + offset + (n - 1) * 7;
}

/** 주어진 시각이 미국 동부 DST(EDT) 기간인지 — 라이브러리 없이 자동 계산 */
export function isUSDST(date: Date): boolean {
  const y = date.getUTCFullYear();
  // 3월 둘째 일요일 02:00 EST = 07:00 UTC (DST 시작 직전 EST)
  const startUtc = Date.UTC(y, 2, nthSundayOfMonth(y, 2, 2), 7);
  // 11월 첫째 일요일 02:00 EDT = 06:00 UTC (DST 종료)
  const endUtc   = Date.UTC(y, 10, nthSundayOfMonth(y, 10, 1), 6);
  return date.getTime() >= startUtc && date.getTime() < endUtc;
}

// ──────────────────────────────────────────────────────────────────────
// 시장별 개장 판정
// ──────────────────────────────────────────────────────────────────────

/** 한국 주식시장: 평일 09:00~15:30 KST + 공휴일 제외 */
export async function isDomesticOpen(now = new Date()): Promise<boolean> {
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const day = kst.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = kst.getHours() * 60 + kst.getMinutes();
  if (minutes < 9 * 60 || minutes >= 15 * 60 + 30) return false;
  if (await isHoliday('domestic', now)) return false;
  return true;
}

/** 미국 NYSE/NASDAQ 정규장: 평일 09:30~16:00 ET + 공휴일 제외 (DST 자동) */
export async function isOverseasOpen(now = new Date()): Promise<boolean> {
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = et.getHours() * 60 + et.getMinutes();
  if (minutes < 9 * 60 + 30 || minutes >= 16 * 60) return false;
  if (await isHoliday('overseas', now)) return false;
  return true;
}

/** 현재 어떤 시장이 열려있는지. 둘 다 닫혀있으면 null. 동시 개장은 정상 운영상 없음. */
export async function getCurrentMarket(now = new Date()): Promise<Market | null> {
  if (await isDomesticOpen(now)) return 'domestic';
  if (await isOverseasOpen(now)) return 'overseas';
  return null;
}

/** Sync 버전 (호환용). 공휴일은 무시하므로 가능한 async 버전 사용 권장. */
export function isMarketOpen(): boolean {
  const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const day = kst.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = kst.getHours() * 60 + kst.getMinutes();
  return minutes >= 9 * 60 && minutes < 15 * 60 + 30;
}

/** 한국장 시작까지 남은 밀리초 (이미 열려있으면 0) — 기존 동작 유지 */
export function msUntilOpen(): number {
  if (isMarketOpen()) return 0;
  const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const day = kst.getDay();
  const daysUntilWeekday = day === 0 ? 1 : day === 6 ? 2 : 1;
  const nextOpen = new Date(kst);
  if (day !== 0 && day !== 6 && kst.getHours() < 9) {
    nextOpen.setHours(9, 0, 0, 0);
  } else {
    nextOpen.setDate(nextOpen.getDate() + daysUntilWeekday);
    nextOpen.setHours(9, 0, 0, 0);
  }
  return nextOpen.getTime() - kst.getTime();
}

/** 테스트/운영 진단용 — 캐시 강제 비우기 */
export function clearHolidayCache(): void {
  HOLIDAY_CACHE.clear();
}

/**
 * 시장별 다음 개장 시각 (UTC ms). 가장 가까운 평일 09:00 KST(국내) 또는 09:30 ET(해외).
 * 공휴일은 단순화를 위해 무시 (주말+다음 날 공휴일이면 약간 오차).
 */
export function nextOpenAt(market: Market, now = new Date()): number {
  if (market === 'domestic') {
    const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const candidate = new Date(kst);
    // 오늘 09:00 KST가 아직 안 지났으면 today, 아니면 다음 영업일
    candidate.setHours(9, 0, 0, 0);
    if (candidate.getTime() <= kst.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }
    while (candidate.getDay() === 0 || candidate.getDay() === 6) {
      candidate.setDate(candidate.getDate() + 1);
    }
    // KST → UTC ms 변환
    const offsetMs = kst.getTime() - now.getTime();
    return candidate.getTime() - offsetMs;
  } else {
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const candidate = new Date(et);
    candidate.setHours(9, 30, 0, 0);
    if (candidate.getTime() <= et.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }
    while (candidate.getDay() === 0 || candidate.getDay() === 6) {
      candidate.setDate(candidate.getDate() + 1);
    }
    const offsetMs = et.getTime() - now.getTime();
    return candidate.getTime() - offsetMs;
  }
}

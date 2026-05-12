/**
 * 한국 거래일 판정 — 주말·공휴일 제외.
 *
 * 기준: KRX(한국거래소) 국내주식 거래일.
 * - 토·일 제외
 * - 한국 법정 공휴일 + 임시 공휴일 제외
 *
 * 공휴일 우선순위:
 *   1) DB system_config.'report_extra_holidays' (JSON string[] YYYY-MM-DD) — 임시 공휴일·대체 공휴일 추가용
 *   2) HOLIDAYS_KR 정적 배열 — 연간 확정 공휴일 (매년 1월 초 업데이트 권장)
 *
 * 주의: force=true 로 발송 시 이 검사를 우회한다 (운영자 수동 트리거 허용).
 */
import type { RowDataPacket } from 'mysql2';

/** 한국 법정 공휴일 (KRX 휴장일 기준). 연도별 동적 날짜(설·추석)는 확정 후 갱신. */
const HOLIDAYS_KR: ReadonlySet<string> = new Set([
  // 2025
  '2025-01-01', // 신정
  '2025-01-28', '2025-01-29', '2025-01-30', // 설날 연휴
  '2025-03-01', // 삼일절
  '2025-05-05', // 어린이날
  '2025-05-06', // 어린이날 대체
  '2025-06-06', // 현충일
  '2025-08-15', // 광복절
  '2025-10-02', '2025-10-03', '2025-10-06', // 추석 연휴 + 한글날
  '2025-10-09', // 한글날
  '2025-12-25', // 크리스마스
  // 2026
  '2026-01-01', // 신정
  '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', // 설날 연휴 (2026)
  '2026-03-01', // 삼일절
  '2026-05-05', // 어린이날
  '2026-06-06', // 현충일
  '2026-08-15', // 광복절
  '2026-09-24', '2026-09-25', '2026-09-26', // 추석 연휴
  '2026-09-28', // 추석 대체 공휴일
  '2026-10-09', // 한글날
  '2026-12-25', // 크리스마스
  // 2027 (추후 갱신)
  '2027-01-01',
]);

/** KST 기준 YYYY-MM-DD 반환 */
function toKstDateStr(date: Date): string {
  const kst = new Date(date.getTime() + 9 * 3600_000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * DB에서 추가 휴일 목록 조회.
 * system_config key = 'report_extra_holidays' value = JSON string[] (예: ["2026-05-02"])
 */
async function fetchExtraHolidays(): Promise<Set<string>> {
  try {
    const { getPool } = await import('@/lib/db');
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT value FROM system_config WHERE `key` = 'report_extra_holidays' LIMIT 1",
    );
    if (rows.length === 0) return new Set();
    const raw = rows[0].value as string;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v: unknown) => typeof v === 'string'));
  } catch {
    return new Set();
  }
}

/**
 * 지정 날짜(UTC Date)가 한국 거래일인지 반환.
 *
 * @param date 현재 시각 (Date 객체). KST 변환은 내부 처리.
 * @param extraHolidays fetchExtraHolidays() 결과 (DB 조회 분리 목적).
 */
export function isKoreanTradingDay(date: Date, extraHolidays: ReadonlySet<string> = new Set()): boolean {
  const kst = new Date(date.getTime() + 9 * 3600_000);
  const dow = kst.getUTCDay(); // 0=Sun, 6=Sat
  if (dow === 0 || dow === 6) return false;

  const ymd = toKstDateStr(date);
  if (HOLIDAYS_KR.has(ymd) || extraHolidays.has(ymd)) return false;

  return true;
}

/**
 * DB 조회 포함 거래일 검사 (trade-report 라우트용).
 * 주말 → DB 조회 없이 즉시 false 반환 (쿼리 절약).
 */
export async function isTradingDay(date: Date): Promise<boolean> {
  const kst = new Date(date.getTime() + 9 * 3600_000);
  const dow = kst.getUTCDay();
  if (dow === 0 || dow === 6) return false;

  const ymd = toKstDateStr(date);
  if (HOLIDAYS_KR.has(ymd)) return false;

  const extra = await fetchExtraHolidays();
  return !extra.has(ymd);
}

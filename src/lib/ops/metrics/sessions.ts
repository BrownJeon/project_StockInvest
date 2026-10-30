/**
 * T-108 운용 지표 — 시각·세션일·휴장 계산 (가이드 §4.0 「세션일」, 계약 §1.2·D2).
 *
 * - 국내 세션일 = KST 날짜, 해외 세션일 = **ET 날짜**. 해외를 KST 자정으로 자르지 않는다.
 *   「오늘」 창: 국내 = KST 00:00~24:00, 해외 = ET 00:00~24:00(그 구간을 epoch 로 — DST 는 날짜마다 판정).
 * - 휴장표는 **엄격하게** 읽는다(`us-session.loadUsClosedDaysStrict` 와 같은 규칙 — 조회 실패·해당 연도 0행 = 모름).
 *   모르면 호출자가 그 지표를 `unknown`/`holidays_unknown` 으로 둔다(휴장일을 거래일로 추정하지 않는다).
 * - 정규장: 국내 09:00~15:30 KST(평일·휴장 제외), 해외 09:30~16:00 ET(`us-session` 그대로, 반일장도 닫힘으로 봄).
 *
 * DB 는 `OpsReader`(SELECT 전용)로만 본다. 그 밖은 순수 함수 — 시각은 인자로 받는다(시험 A-5).
 */
import { etWallToMs } from '@/lib/strategy/records/job-slots';
import { addDaysYmd, etDateOf, isUsTradingDay, sessionWindowUtc } from '@/lib/strategy/us-session';
import { toKstDatetime } from '@/lib/time';
import type { OpsReader } from './read-only';
import type { ByMarket, Market, SessionRef } from './types';

export const KST_OFFSET_MS = 9 * 3600_000;
const MIN_MS = 60_000;
const DAY_MS = 86_400_000;

// ── 시각 표기 ────────────────────────────────────────────────────────────

/** epoch ms → `YYYY-MM-DDTHH:mm:ss+09:00` (초 미만 버림). */
export function kstIso(ms: number): string {
  return new Date(Math.floor(ms / 1000) * 1000 + KST_OFFSET_MS).toISOString().slice(0, 19) + '+09:00';
}

/** DB DATETIME 바인딩용 KST 벽시계 `YYYY-MM-DD HH:MM:SS` (풀·DB 가 KST). */
export function kstSql(ms: number): string {
  return toKstDatetime(new Date(ms));
}

export function kstDateOf(ms: number): string {
  return kstIso(ms).slice(0, 10);
}

/** KST 벽시계 분(0~1439). */
export function kstMinutesOf(ms: number): number {
  const w = new Date(ms + KST_OFFSET_MS);
  return w.getUTCHours() * 60 + w.getUTCMinutes();
}

/** KST 날짜 + 'HH:MM' → epoch ms. */
export function kstWallToMs(date: string, hhmm: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m || !t) throw new Error(`KST 벽시계 형식 아님: ${date} ${hhmm}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2])) - KST_OFFSET_MS;
}

/**
 * DB 시각 값 → epoch ms. mysql2(풀 timezone '+09:00')는 DATETIME 을 올바른 Date 로 준다.
 * 문자열 `YYYY-MM-DD HH:MM:SS` 는 KST 벽시계로 읽는다. 해석 불가면 null.
 */
export function toMs(v: unknown): number | null {
  if (v instanceof Date) { const t = v.getTime(); return Number.isFinite(t) ? t : null; }
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const s = v.trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(s);
    if (m) {
      return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) - KST_OFFSET_MS;
    }
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

export function isoOrNull(v: unknown): string | null {
  const ms = toMs(v);
  return ms == null ? null : kstIso(ms);
}

// ── 세션일 ───────────────────────────────────────────────────────────────

export function sessionRef(market: Market, sessionDate: string): SessionRef {
  return { market, sessionDate, tz: market === 'domestic' ? 'KST' : 'ET' };
}

/** 이 시각의 그 시장 현지 날짜(국내 KST · 해외 ET). */
export function localDateOf(market: Market, ms: number): string {
  return market === 'domestic' ? kstDateOf(ms) : etDateOf(new Date(ms));
}

export interface SessionDay { ref: SessionRef; startMs: number; endMs: number }

/** 현지 날짜 하루(00:00~24:00)의 epoch 구간. */
export function sessionDayOf(market: Market, date: string): SessionDay {
  if (market === 'domestic') {
    const s = kstWallToMs(date, '00:00');
    return { ref: sessionRef(market, date), startMs: s, endMs: s + DAY_MS };
  }
  const s = etWallToMs(date, '00:00');
  const e = etWallToMs(addDaysYmd(date, 1), '00:00');
  if (s == null || e == null) throw new Error(`ET 자정 계산 실패: ${date}`);
  return { ref: sessionRef(market, date), startMs: s, endMs: e };
}

/** 「오늘」 세션일 — 국내 KST 날짜, 해외 ET 날짜(KST 자정으로 자르지 않는다). */
export function currentSessionDay(market: Market, nowMs: number): SessionDay {
  return sessionDayOf(market, localDateOf(market, nowMs));
}

// ── 휴장·거래일 ──────────────────────────────────────────────────────────

export type ClosedDays = ByMarket<Set<string> | null>;

export class HolidaysUnknownError extends Error {
  readonly code = 'holidays_unknown';
  constructor(message: string) { super(message); this.name = 'HolidaysUnknownError'; }
}

/** 필요한 연도 — 현지 오늘 −45일 ~ +20일(20세션 역산·다음 개장·DST 안내 범위). */
export function yearsFor(market: Market, nowMs: number): number[] {
  const today = localDateOf(market, nowMs);
  const ys = new Set<number>([Number(today.slice(0, 4))]);
  for (const off of [-45, 20]) ys.add(Number(addDaysYmd(today, off).slice(0, 4)));
  return [...ys].sort((a, b) => a - b);
}

/**
 * 휴장일(반일장 포함) 집합 — **엄격**. 조회 오류·요청 연도 중 0행인 연도가 있으면 던진다.
 * 날짜는 DATE_FORMAT 문자열로 받는다(풀 시간대로 하루 밀리는 일 방지).
 */
export async function loadClosedDaysStrict(r: OpsReader, market: Market, years: number[]): Promise<Set<string>> {
  if (years.length === 0) throw new HolidaysUnknownError('연도 없음');
  const rows = await r.rows<{ d: unknown }>(
    `SELECT DATE_FORMAT(holiday_date, '%Y-%m-%d') AS d FROM market_holidays WHERE market = ? AND YEAR(holiday_date) IN (?)`,
    [market, years],
  );
  const set = new Set<string>();
  const seen = new Set<number>();
  for (const row of rows) {
    const d = String(row?.d ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new HolidaysUnknownError(`휴장 표 날짜 형식 이상: ${d}`);
    set.add(d);
    seen.add(Number(d.slice(0, 4)));
  }
  const missing = years.filter((y) => !seen.has(y));
  if (missing.length > 0) throw new HolidaysUnknownError(`${market} 휴장 표에 ${missing.join(',')}년 행이 없음`);
  return set;
}

/** 두 시장 휴장표. 실패한 시장은 null(던지지 않는다 — 그 시장 지표만 holidays_unknown). */
export async function loadClosedDays(r: OpsReader): Promise<ClosedDays> {
  const one = async (m: Market) => {
    try { return await loadClosedDaysStrict(r, m, yearsFor(m, r.nowMs)); } catch { return null; }
  };
  const [domestic, overseas] = await Promise.all([one('domestic'), one('overseas')]);
  return { domestic, overseas };
}

function weekdayOf(d: string): number {
  return new Date(`${d}T00:00:00Z`).getUTCDay();
}

export function isTradingDay(market: Market, d: string, closed: ReadonlySet<string>): boolean {
  if (market === 'overseas') return isUsTradingDay(d, closed);
  const dow = weekdayOf(d);
  return dow >= 1 && dow <= 5 && !closed.has(d);
}

/** 정규장 개장·마감 epoch(그 현지 날짜). */
export function sessionHours(market: Market, d: string): { openMs: number; closeMs: number } {
  if (market === 'overseas') {
    const w = sessionWindowUtc(d);
    return { openMs: w.openUtc, closeMs: w.closeUtc };
  }
  return { openMs: kstWallToMs(d, '09:00'), closeMs: kstWallToMs(d, '15:30') };
}

/** 지금 정규장이 열려 있는가. */
export function isSessionOpenAt(market: Market, nowMs: number, closed: ReadonlySet<string>): boolean {
  const d = localDateOf(market, nowMs);
  if (!isTradingDay(market, d, closed)) return false;
  const { openMs, closeMs } = sessionHours(market, d);
  return nowMs >= openMs && nowMs < closeMs;
}

/** 마감이 지난 가장 최근 세션(현지 날짜). 40일 안에서 못 찾으면 null. */
export function lastCompletedSession(market: Market, nowMs: number, closed: ReadonlySet<string>): string | null {
  let d = localDateOf(market, nowMs);
  for (let i = 0; i < 40; i++, d = addDaysYmd(d, -1)) {
    if (isTradingDay(market, d, closed) && sessionHours(market, d).closeMs <= nowMs) return d;
  }
  return null;
}

/** 지금 이후 첫 개장(현지 날짜·epoch). 20일 안에서 못 찾으면 null. */
export function nextSessionOpen(market: Market, nowMs: number, closed: ReadonlySet<string>): { sessionDate: string; openMs: number } | null {
  let d = localDateOf(market, nowMs);
  for (let i = 0; i < 20; i++, d = addDaysYmd(d, 1)) {
    if (!isTradingDay(market, d, closed)) continue;
    const { openMs } = sessionHours(market, d);
    if (openMs > nowMs) return { sessionDate: d, openMs };
  }
  return null;
}

/** KST 'HH:MM' 표기. */
export function kstHhmm(ms: number): string {
  return kstIso(ms).slice(11, 16);
}

/**
 * 해외 다음 개장과, 그 뒤 14일 안에 개장 KST 시각이 바뀌는 첫 세션(DST) — 「개장 {HH:MM} KST ({MM-DD}부터 {HH:MM})」.
 */
export function overseasOpenInfo(nowMs: number, closed: ReadonlySet<string>): {
  next: { sessionDate: string; openMs: number } | null;
  change: { sessionDate: string; openKst: string } | null;
} {
  const next = nextSessionOpen('overseas', nowMs, closed);
  if (!next) return { next: null, change: null };
  const base = kstHhmm(next.openMs);
  let d = next.sessionDate;
  for (let i = 0; i < 14; i++) {
    d = addDaysYmd(d, 1);
    if (!isTradingDay('overseas', d, closed)) continue;
    const open = sessionHours('overseas', d).openMs;
    if (kstHhmm(open) !== base) return { next, change: { sessionDate: d, openKst: kstIso(open) } };
  }
  return { next, change: null };
}

/** d 이전(포함) 최근 거래일 n 개(내림차순). */
export function recentTradingDays(market: Market, fromDate: string, n: number, closed: ReadonlySet<string>): string[] {
  const out: string[] = [];
  let d = fromDate;
  for (let guard = 0; out.length < n && guard < n * 3 + 20; guard++, d = addDaysYmd(d, -1)) {
    if (isTradingDay(market, d, closed)) out.push(d);
  }
  return out;
}

// ── 일 1회 잡 슬롯 (job-slots 의 daily 규칙과 같은 KST 'HH:MM') ─────────────

/** slot + graceMin 이 지난 가장 최근 KST 일 슬롯(epoch). */
export function lastDailySlotMs(hhmm: string, nowMs: number, graceMin: number): number {
  let d = kstDateOf(nowMs);
  for (let i = 0; i < 3; i++, d = addDaysYmd(d, -1)) {
    const s = kstWallToMs(d, hhmm);
    if (s + graceMin * MIN_MS <= nowMs) return s;
  }
  return kstWallToMs(addDaysYmd(kstDateOf(nowMs), -3), hhmm);
}

/** now 보다 뒤인 첫 KST 일 슬롯 중 pred(슬롯 epoch) 를 만족하는 것. 15일 안에 없으면 null. */
export function nextDailySlotMs(hhmm: string, nowMs: number, pred: (slotMs: number) => boolean): number | null {
  let d = kstDateOf(nowMs);
  for (let i = 0; i < 15; i++, d = addDaysYmd(d, 1)) {
    const s = kstWallToMs(d, hhmm);
    if (s > nowMs && pred(s)) return s;
  }
  return null;
}

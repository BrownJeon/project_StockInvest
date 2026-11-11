/**
 * T-165 거시 레짐 라벨(C0) — **순수 분류 함수**.
 *
 * I/O·`Date.now()`·전역 상태 0. 같은 입력이면 항상 같은 출력이다(과거 날짜의 라벨도 언제든 재계산 가능).
 * 예외를 던지지 않는다 — 입력 이상·내부 오류는 `unknown` + 사유 코드로 끝낸다.
 *
 * 규칙 정본(사전등록): task T-165 Analyst §2~§6 · Leader G7-2(releaseBasis)·G7-3(발표 지연 표시).
 *  - 물가 축: 일정표상 발표 시각이 지났고(등호 포함) 값과 12개월 전 값이 모두 있는 가장 최근 기준월의
 *    YoY. 현재 ET 달력월에서 0~3개월 전까지만 본다(4 이상 → `cpi_stale`). 소수 1자리 반올림(0.05 올림) 후
 *    `≥ 4.0` 이면 hot.
 *  - 금리 축: ET 달력일 d 의 상단(효력일 ≤ d 인 마지막 행) − d−6개월(같은 일, 없으면 말일)의 상단.
 *    >0 tightening · =0 hold · <0 easing.
 *  - 라벨 = `${hot|normal}_${direction}` 6개 + `unknown`. `hot_tightening` = 유형⑤.
 */
import { CPI_RELEASE_SCHEDULE, type CpiReleaseRow } from './cpi-release-schedule';
import {
  FOMC_DECISION_DATES,
  FOMC_TARGET_RANGE_ROWS,
  VERIFIED_THROUGH,
  type FomcTargetRangeRow,
} from './fomc-target-range';
import {
  CPI_CACHE_STALE_MS,
  CPI_SERIES_ID,
  HOT_CPI_YOY_PCT,
  MAX_CPI_MONTH_GAP,
  RATE_COMPARE_MONTHS,
  RULE_VERSION,
  type CpiFetchStatus,
  type CpiIndexByMonth,
  type MacroRegimeCpiRecord,
  type MacroRegimeLabel,
  type MacroRegimeRateRecord,
  type MacroRegimeReasonCode,
  type MacroRegimeRecord,
  type RateDirection,
  type ReleaseBasis,
} from './types';

export interface MacroRegimeTables {
  readonly fomcRows: readonly FomcTargetRangeRow[];
  readonly verifiedThrough: string;
  readonly decisionDates: readonly string[];
  readonly cpiReleaseSchedule: readonly CpiReleaseRow[];
}

export const DEFAULT_MACRO_REGIME_TABLES: MacroRegimeTables = Object.freeze({
  fomcRows: FOMC_TARGET_RANGE_ROWS,
  verifiedThrough: VERIFIED_THROUGH,
  decisionDates: FOMC_DECISION_DATES,
  cpiReleaseSchedule: CPI_RELEASE_SCHEDULE,
});

export interface ClassifyMacroRegimeInput {
  /** 판정 시각 */
  asOf: Date;
  /** 수집된 CPI 지수. `null` = 성공 수집 이력 없음 → `cpi_not_loaded` */
  cpiIndex: CpiIndexByMonth | null;
  /** 마지막 **성공** 수집 시각. 생략·null 이면 캐시 나이 판정을 하지 않는다(과거 재계산용) */
  fetchedAt?: Date | null;
  /** 기록용 — 가장 최근 수집 시도의 결과 (기본 `not_attempted`) */
  fetchStatus?: CpiFetchStatus;
  /** 표 주입(시험·재계산). 생략한 표는 기본 상수 */
  tables?: Partial<MacroRegimeTables>;
  /** 기본 `live`(운영). 과거 재계산·백테스트는 `confirmed_only` */
  releaseBasis?: ReleaseBasis;
}

export function classifyMacroRegime(input: ClassifyMacroRegimeInput): MacroRegimeRecord {
  try {
    return classifyUnsafe(input);
  } catch {
    return internalErrorRecord(input?.asOf, input?.fetchStatus);
  }
}

// ─── 날짜 도우미 (순수) ───────────────────────────────────────────────────────

/** 판정 시각 → 미 동부(America/New_York) 달력일 'YYYY-MM-DD'. 서머타임은 tz 데이터가 처리한다. */
export function etDateOf(d: Date): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const y = get('year');
  const m = get('month');
  const day = get('day');
  if (!/^\d{4}$/.test(y) || !/^\d{2}$/.test(m) || !/^\d{2}$/.test(day)) throw new Error('et_date_format');
  return `${y}-${m}-${day}`;
}

/** 초 단위로 자른 ISO UTC ('2026-11-11T14:00:00Z') */
export function isoSeconds(d: Date): string {
  const ms = d.getTime();
  if (!Number.isFinite(ms)) throw new Error('invalid_date');
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');
}

function ymToIndex(ym: string): number {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return y * 12 + (m - 1);
}
function indexToYm(i: number): string {
  const y = Math.floor(i / 12);
  const m = i - y * 12 + 1;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}
/** 'YYYY-MM' + k개월 */
export function addMonths(ym: string, k: number): string {
  return indexToYm(ymToIndex(ym) + k);
}
/** a − b (개월) */
export function monthDiff(a: string, b: string): number {
  return ymToIndex(a) - ymToIndex(b);
}
/** 'YYYY-MM-DD' − n 달력월 (같은 일, 그 달에 없으면 말일 — 8/31 → 2/28·29) */
export function minusCalendarMonths(day: string, n: number): string {
  const ym = addMonths(day.slice(0, 7), -n);
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const d = Math.min(Number(day.slice(8, 10)), lastDay);
  return `${ym}-${String(d).padStart(2, '0')}`;
}

function usableIndex(map: CpiIndexByMonth, ym: string): number | null {
  if (!Object.prototype.hasOwnProperty.call(map, ym)) return null;
  const v = (map as Record<string, unknown>)[ym];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/** 소수 n자리 반올림 + -0 정규화 */
function round(x: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f + 0;
}

// ─── 본체 ────────────────────────────────────────────────────────────────────

function classifyUnsafe(input: ClassifyMacroRegimeInput): MacroRegimeRecord {
  const asOf = input.asOf;
  const asOfMs = asOf instanceof Date ? asOf.getTime() : NaN;
  if (!Number.isFinite(asOfMs)) throw new Error('invalid_as_of');
  const t = input.tables ?? {};
  const tables: MacroRegimeTables = {
    fomcRows: t.fomcRows ?? DEFAULT_MACRO_REGIME_TABLES.fomcRows,
    verifiedThrough: t.verifiedThrough ?? DEFAULT_MACRO_REGIME_TABLES.verifiedThrough,
    decisionDates: t.decisionDates ?? DEFAULT_MACRO_REGIME_TABLES.decisionDates,
    cpiReleaseSchedule: t.cpiReleaseSchedule ?? DEFAULT_MACRO_REGIME_TABLES.cpiReleaseSchedule,
  };
  const basis: ReleaseBasis = input.releaseBasis === 'confirmed_only' ? 'confirmed_only' : 'live';
  const etDay = etDateOf(asOf);
  const curMonth = etDay.slice(0, 7);
  const reasons: MacroRegimeReasonCode[] = [];

  // ── 발표 일정 (기준월 → 행). 같은 달이 두 번 있으면 뒤의 것(운영자 수정분)을 쓴다.
  const schedule = new Map<string, CpiReleaseRow>();
  for (const row of tables.cpiReleaseSchedule) schedule.set(row.referenceMonth, row);
  const releasedAt = (row: CpiReleaseRow | undefined): number | null => {
    if (!row || row.releaseAtUtc === null) return null;
    if (basis === 'confirmed_only' && row.confirmed !== true) return null;
    const t = Date.parse(row.releaseAtUtc);
    return Number.isFinite(t) && asOfMs >= t ? t : null;
  };
  let expectedReferenceMonth: string | null = null;
  for (const [ym, row] of schedule) {
    if (releasedAt(row) !== null && (expectedReferenceMonth === null || ym > expectedReferenceMonth)) {
      expectedReferenceMonth = ym;
    }
  }

  // ── 물가 축
  const fetchedMs = input.fetchedAt instanceof Date && Number.isFinite(input.fetchedAt.getTime())
    ? input.fetchedAt.getTime() : null;
  const cpi: MacroRegimeCpiRecord = {
    seriesId: CPI_SERIES_ID,
    referenceMonth: null, releaseAtUtc: null, index: null, baseMonth: null, baseIndex: null,
    yoyPctRaw: null, yoyPct: null, hot: null, monthGap: null,
    expectedReferenceMonth, lagsSchedule: false,
    fetchedAtUtc: fetchedMs === null ? null : isoSeconds(new Date(fetchedMs)),
    cacheAgeSec: fetchedMs === null ? null : Math.floor((asOfMs - fetchedMs) / 1000),
    fetchStatus: input.fetchStatus ?? 'not_attempted',
  };
  if (input.cpiIndex == null) {
    reasons.push('cpi_not_loaded');
  } else {
    if (fetchedMs !== null && asOfMs - fetchedMs > CPI_CACHE_STALE_MS) reasons.push('cpi_cache_stale');
    const index = input.cpiIndex;
    for (let k = 0; k <= MAX_CPI_MONTH_GAP; k++) {
      const ym = addMonths(curMonth, -k);
      const row = schedule.get(ym);
      if (releasedAt(row) === null) continue;
      const v = usableIndex(index, ym);
      const baseMonth = addMonths(ym, -12);
      const b = usableIndex(index, baseMonth);
      if (v === null || b === null) continue;
      const raw = (v / b - 1) * 100;
      const yoyPct = Math.round(raw * 10 + 1e-9) / 10 + 0; // 0.05 올림 (Analyst §2)
      cpi.referenceMonth = ym;
      cpi.releaseAtUtc = row!.releaseAtUtc;
      cpi.index = v;
      cpi.baseMonth = baseMonth;
      cpi.baseIndex = b;
      cpi.yoyPctRaw = round(raw, 4);
      cpi.yoyPct = yoyPct;
      cpi.hot = yoyPct >= HOT_CPI_YOY_PCT;
      cpi.monthGap = k;
      break;
    }
    if (cpi.referenceMonth === null) reasons.push('cpi_stale');
  }
  cpi.lagsSchedule = expectedReferenceMonth !== null
    && (cpi.referenceMonth === null || cpi.referenceMonth < expectedReferenceMonth);

  // ── 금리 축
  const upperAt = (day: string): FomcTargetRangeRow | null => {
    let best: FomcTargetRangeRow | null = null;
    for (const r of tables.fomcRows) {
      if (r.effectiveDate <= day && (best === null || r.effectiveDate >= best.effectiveDate)) best = r;
    }
    return best && Number.isFinite(best.upperPct) ? best : null;
  };
  const compareDate = minusCalendarMonths(etDay, RATE_COMPARE_MONTHS);
  const now = upperAt(etDay);
  const before = upperAt(compareDate);
  const decisions = [...tables.decisionDates].sort();
  const rate: MacroRegimeRateRecord = {
    upperPct: now ? now.upperPct : null,
    upperEffectiveFrom: now ? now.effectiveDate : null,
    compareDate,
    upper6mAgoPct: before ? before.upperPct : null,
    deltaPct: null,
    direction: null,
    tableVerifiedThrough: tables.verifiedThrough,
    nextKnownDecisionDate: decisions.find((d) => d >= etDay) ?? null,
  };
  if (now === null || before === null) {
    reasons.push('rate_table_before_start');
  } else {
    const delta = round(now.upperPct - before.upperPct, 2);
    rate.deltaPct = delta;
    rate.direction = delta > 0 ? 'tightening' : delta < 0 ? 'easing' : 'hold';
  }
  const past = decisions.filter((d) => d < etDay);
  if (past.length > 0 && past[past.length - 1] > tables.verifiedThrough) reasons.push('rate_table_stale');
  if (decisions.length === 0 || etDay > decisions[decisions.length - 1]) reasons.push('rate_schedule_exhausted');

  // ── 라벨
  let label: MacroRegimeLabel = 'unknown';
  if (reasons.length === 0 && cpi.hot !== null && rate.direction !== null) {
    label = `${cpi.hot ? 'hot' : 'normal'}_${rate.direction}` as MacroRegimeLabel;
  } else if (reasons.length === 0) {
    reasons.push('internal_error'); // 도달 불가 — 축이 비었는데 사유가 없으면 규칙 위반으로 본다
  }
  return {
    ruleVersion: RULE_VERSION,
    label,
    isType5: label === 'hot_tightening',
    reasonCodes: reasons,
    asOfUtc: isoSeconds(asOf),
    asOfEtDate: etDay,
    cpi,
    rate,
  };
}

/** 분류 자체가 예외를 낸 경우의 기록 — 이 함수도 던지지 않는다 */
export function internalErrorRecord(asOf: unknown, fetchStatus?: CpiFetchStatus): MacroRegimeRecord {
  let asOfUtc = '';
  let asOfEtDate = '';
  try { if (asOf instanceof Date) asOfUtc = isoSeconds(asOf); } catch { /* 빈 값 */ }
  try { if (asOf instanceof Date) asOfEtDate = etDateOf(asOf); } catch { /* 빈 값 */ }
  return {
    ruleVersion: RULE_VERSION,
    label: 'unknown',
    isType5: false,
    reasonCodes: ['internal_error'],
    asOfUtc,
    asOfEtDate,
    cpi: {
      seriesId: CPI_SERIES_ID,
      referenceMonth: null, releaseAtUtc: null, index: null, baseMonth: null, baseIndex: null,
      yoyPctRaw: null, yoyPct: null, hot: null, monthGap: null,
      expectedReferenceMonth: null, lagsSchedule: false,
      fetchedAtUtc: null, cacheAgeSec: null,
      fetchStatus: typeof fetchStatus === 'string' ? fetchStatus : 'not_attempted',
    },
    rate: {
      upperPct: null, upperEffectiveFrom: null, compareDate: null, upper6mAgoPct: null,
      deltaPct: null, direction: null as RateDirection | null,
      tableVerifiedThrough: VERIFIED_THROUGH, nextKnownDecisionDate: null,
    },
  };
}

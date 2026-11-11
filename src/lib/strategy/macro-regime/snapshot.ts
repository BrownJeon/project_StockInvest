/**
 * T-165 — 거시 레짐 라벨의 모듈 메모리 캐시와 갱신 정책 (Analyst §8 · Leader G2·G7-3).
 *
 * 엔진은 런마다 두 함수만 부른다(`index.ts`):
 *  - `kickMacroRegimeRefresh()` — 런 시작. **동기·void·무예외.** 갱신이 필요하면 수집을 *시작만* 하고
 *    기다리지 않는다(fire-and-forget). strategy-eval 틱의 지연에 외부 호출을 넣지 않기 위해서다(T-147/148).
 *  - `getMacroRegimeRecord()` — 최종 run 행 기록 때. **동기·무예외.** 캐시 + 순수 분류 결과.
 *
 * 갱신 조건(모두 만족할 때만 시도):
 *  ① 운영 끄기 손잡이 `MACRO_REGIME_BLS_DISABLED=true` 가 아니다 ② 진행 중인 수집이 없다(단일 비행)
 *  ③ 마지막 시도 뒤 2시간이 지났다 ④ UTC 하루 시도 6회 미만 ⑤ 다음 중 하나:
 *     캐시 없음 · 마지막 성공 뒤 24시간 경과 · **마지막 성공 뒤 발표 시각이 지난 기준월이 있다**(G7-3) ·
 *     일정표상 발표가 지난 최신 기준월 값이 캐시에 아직 없다(발표 직후 반영 지연 — 2시간 간격으로 재확인).
 * 실패하면 이전 캐시를 그대로 둔다(값을 덮어쓰지 않는다). 7일 넘게 성공이 없으면 분류가 `cpi_cache_stale`.
 * 후퇴 방지(C2-1): 기존 캐시가 있는데 `ok` 응답의 가장 늦은 숫자 월이 기존보다 이르면 교체하지 않고
 * `bad_schema` 로 기록한다(캐시·수집 시각 보존 → 2시간 간격 재시도).
 * 일 6회 카운터·2시간 간격은 프로세스 메모리라 재기동 때 0 으로 돌아간다(설계상 수용 — Reviewer MEDIUM-2).
 * 캐시는 프로세스 메모리뿐이다(DB 저장 없음, 재기동 시 초기화 → 첫 기록은 `cpi_not_loaded` 일 수 있다).
 */
import { fetchBlsCpi, type BlsFetchResult } from './bls-cpi';
import { classifyMacroRegime, DEFAULT_MACRO_REGIME_TABLES, internalErrorRecord, type ClassifyMacroRegimeInput } from './classify';
import type { CpiFetchStatus, CpiIndexByMonth, MacroRegimeRecord } from './types';

export const SUCCESS_TTL_MS = 24 * 3600_000;
export const RETRY_MIN_INTERVAL_MS = 2 * 3600_000;
export const MAX_ATTEMPTS_PER_UTC_DAY = 6;
/** 이보다 오래 끝나지 않는 수집은 죽은 것으로 보고 새 시도를 허용한다(수집기 자체 마감 5초의 안전망) */
export const STUCK_FLIGHT_MS = 10 * 60_000;

export type MacroRegimeFetcher = () => Promise<BlsFetchResult>;

interface State {
  /** 마지막 성공 수집의 지수 */
  index: CpiIndexByMonth | null;
  /** 마지막 성공 수집 시도의 시작 시각(ms) */
  fetchedAt: number | null;
  lastAttemptAt: number | null;
  lastStatus: CpiFetchStatus;
  attemptDay: string | null;
  attemptsToday: number;
  inFlight: Promise<void> | null;
  inFlightStartedAt: number | null;
}

function freshState(): State {
  return {
    index: null, fetchedAt: null, lastAttemptAt: null, lastStatus: 'not_attempted',
    attemptDay: null, attemptsToday: 0, inFlight: null, inFlightStartedAt: null,
  };
}

let state: State = freshState();
const defaultFetcher: MacroRegimeFetcher = () => fetchBlsCpi();
let fetcher: MacroRegimeFetcher = defaultFetcher;
let classifier: (input: ClassifyMacroRegimeInput) => MacroRegimeRecord = classifyMacroRegime;

export function isMacroRegimeBlsDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MACRO_REGIME_BLS_DISABLED ?? '').trim().toLowerCase() === 'true';
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function isUsable(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/** 일정표(예정 시각 기준)상 nowMs 에 발표가 지난 가장 최근 행 */
function latestScheduledRelease(nowMs: number): { month: string; at: number } | null {
  let best: { month: string; at: number } | null = null;
  for (const row of DEFAULT_MACRO_REGIME_TABLES.cpiReleaseSchedule) {
    if (row.releaseAtUtc === null) continue;
    const at = Date.parse(row.releaseAtUtc);
    if (!Number.isFinite(at) || at > nowMs) continue;
    if (best === null || row.referenceMonth > best.month) best = { month: row.referenceMonth, at };
  }
  return best;
}

function wantsRefresh(s: State, nowMs: number): boolean {
  if (s.index === null || s.fetchedAt === null) return true;
  if (nowMs - s.fetchedAt >= SUCCESS_TTL_MS) return true;
  const latest = latestScheduledRelease(nowMs);
  if (latest !== null) {
    if (s.fetchedAt < latest.at) return true; // 마지막 성공 뒤 발표가 지나갔다 (G7-3)
    if (!isUsable((s.index as Record<string, unknown>)[latest.month])) return true; // 발표 뒤 받았는데 아직 없다
  }
  return false;
}

/**
 * 런 시작 때 부른다. 필요하면 수집을 시작만 하고 즉시 돌아온다. **절대 던지지 않는다.**
 */
export function kickMacroRegimeRefresh(now: Date = new Date()): void {
  try {
    if (isMacroRegimeBlsDisabled()) return;
    const nowMs = now.getTime();
    if (!Number.isFinite(nowMs)) return;
    const s = state;
    if (s.inFlight !== null) {
      if (s.inFlightStartedAt !== null && nowMs - s.inFlightStartedAt < STUCK_FLIGHT_MS) return;
      s.inFlight = null; // 마감을 한참 넘긴 수집 — 버리고 새로 시도한다(늦게 끝나도 결과는 반영된다)
    }
    if (s.lastAttemptAt !== null && nowMs - s.lastAttemptAt < RETRY_MIN_INTERVAL_MS) return;
    if (!wantsRefresh(s, nowMs)) return;
    const day = utcDay(nowMs);
    if (s.attemptDay !== day) { s.attemptDay = day; s.attemptsToday = 0; }
    if (s.attemptsToday >= MAX_ATTEMPTS_PER_UTC_DAY) return;
    s.attemptsToday += 1;
    s.lastAttemptAt = nowMs;

    let started: Promise<BlsFetchResult>;
    try {
      started = Promise.resolve(fetcher());
    } catch {
      started = Promise.resolve({ fetchStatus: 'internal_error' });
    }
    const flight: Promise<void> = started
      .then(
        (res) => applyResult(s, res, nowMs),
        () => applyResult(s, { fetchStatus: 'internal_error' }, nowMs),
      )
      .catch(() => { /* applyResult 는 던지지 않지만 — 처리 안 된 거절 0 을 보장한다 */ })
      .finally(() => {
        if (s.inFlight === flight) { s.inFlight = null; s.inFlightStartedAt = null; }
      });
    s.inFlight = flight;
    s.inFlightStartedAt = nowMs;
  } catch {
    /* 계측이 엔진을 죽이면 안 된다 */
  }
}

/** 값이 양의 유한 숫자인 가장 늦은 기준월('YYYY-MM'), 없으면 null */
export function latestNumericMonth(index: CpiIndexByMonth | null | undefined): string | null {
  if (!index) return null;
  let best: string | null = null;
  for (const key of Object.keys(index)) {
    if (!/^\d{4}-\d{2}$/.test(key) || !isUsable((index as Record<string, unknown>)[key])) continue;
    if (best === null || key > best) best = key;
  }
  return best;
}

function applyResult(s: State, res: BlsFetchResult | undefined, startedAt: number): void {
  try {
    const status = res && typeof res.fetchStatus === 'string' ? res.fetchStatus : 'internal_error';
    if (status === 'ok' && res?.observations) {
      const prevLatest = latestNumericMonth(s.index);
      const nextLatest = latestNumericMonth(res.observations);
      if (prevLatest !== null && (nextLatest === null || nextLatest < prevLatest)) {
        s.lastStatus = 'bad_schema'; // 후퇴 응답 — 더 짧아진 캐시로 바꾸지 않는다(C2-1)
        return;
      }
      s.lastStatus = status;
      s.index = res.observations;
      s.fetchedAt = startedAt;
      return;
    }
    s.lastStatus = status;
  } catch {
    /* 이전 캐시 유지 */
  }
}

/**
 * 최종 run 행에 넣을 기록. **동기·무예외** — 내부 예외 시에도 `unknown(internal_error)` 기록을 돌려준다.
 */
export function getMacroRegimeRecord(now: Date = new Date()): MacroRegimeRecord {
  try {
    const s = state;
    if (isMacroRegimeBlsDisabled()) {
      return classifier({ asOf: now, cpiIndex: null, fetchedAt: null, fetchStatus: 'disabled' });
    }
    return classifier({
      asOf: now,
      cpiIndex: s.index,
      fetchedAt: s.fetchedAt === null ? null : new Date(s.fetchedAt),
      fetchStatus: s.lastStatus,
      releaseBasis: 'live',
    });
  } catch {
    let status: CpiFetchStatus | undefined;
    try { status = state.lastStatus; } catch { /* ignore */ }
    return internalErrorRecord(now, status);
  }
}

// ─── 시험 전용 ────────────────────────────────────────────────────────────────

/** 캐시·시도 횟수·진행 중 수집을 모두 비운다(진행 중이던 수집이 늦게 끝나도 새 상태에 반영되지 않는다) */
export function __resetMacroRegimeForTest(): void {
  state = freshState();
  fetcher = defaultFetcher;
  classifier = classifyMacroRegime;
}
/** 수집기 주입 — null 이면 기본(시험 환경에서는 실호출 차단) */
export function __setMacroRegimeFetcherForTest(f: MacroRegimeFetcher | null): void {
  fetcher = f ?? defaultFetcher;
}
/** 분류기 주입 — 불변식 시험의 강제 라벨·강제 예외용. null 이면 기본 */
export function __setMacroRegimeClassifierForTest(
  c: ((input: ClassifyMacroRegimeInput) => MacroRegimeRecord) | null,
): void {
  classifier = c ?? classifyMacroRegime;
}
/** 진행 중인 수집(없으면 null) — 시험에서 완료를 기다릴 때 */
export function __macroRegimeInFlightForTest(): Promise<void> | null {
  return state.inFlight;
}
/** 내부 상태 사본 */
export function __macroRegimeStateForTest(): Readonly<Omit<State, 'inFlight'>> & { inFlight: boolean } {
  const { inFlight, ...rest } = state;
  return { ...rest, inFlight: inFlight !== null };
}

/**
 * T-165 거시 레짐 라벨(C0) — 타입·상수.
 *
 * C0 = **기록만 한다.** 이 모듈의 결과는 `eval_funnel` 최종 run 행 `detail.macroRegime` 에만 들어가고
 * 매매 판단·게이트·사이징·AI 프롬프트에는 쓰이지 않는다(의존 경계 시험이 고정).
 * 필드 정의 정본: task T-165 Analyst §6·§7 + Leader G7-3 추가 필드(`expectedReferenceMonth`·`lagsSchedule`).
 */

/** 규칙 버전 — 라벨 집합·임계·정렬 규칙이 바뀌면 올린다(사전등록 규율). */
export const RULE_VERSION = 'macro-regime-c0@1' as const;

/** CPI-U, U.S. city average, All items, 비계절조정 (Analyst §2) */
export const CPI_SERIES_ID = 'CUUR0000SA0' as const;

/** 물가 축 임계 — 반올림(소수 1자리) 후 `yoyPct ≥ 4.0` 이면 hot (사용자 결정, T-164 §5) */
export const HOT_CPI_YOY_PCT = 4.0;

/** 허용 낡음 — (현재 ET 달력월 − 사용 기준월) ≤ 3, 4 이상이면 `cpi_stale` (Analyst §2) */
export const MAX_CPI_MONTH_GAP = 3;

/** 마지막 성공 수집이 이보다 오래되면 `cpi_cache_stale` (Analyst §6 — 7일 초과) */
export const CPI_CACHE_STALE_MS = 7 * 24 * 3600_000;

/** 정책금리 변화 비교 기간 (달력월) — Analyst §4 */
export const RATE_COMPARE_MONTHS = 6;

export const MACRO_REGIME_LABELS = [
  'hot_tightening', // = 유형⑤ (isType5)
  'hot_hold',
  'hot_easing',
  'normal_tightening',
  'normal_hold',
  'normal_easing',
  'unknown',
] as const;
export type MacroRegimeLabel = (typeof MACRO_REGIME_LABELS)[number];

/**
 * `unknown` 사유 코드 — 배열 순서 = 기록 순서(우선순위, Analyst §6).
 * `internal_error` 는 Developer 추가: 분류·기록 코드 자체가 예외를 낸 경우(엔진에 예외를 넘기지 않고 이 코드로 끝낸다).
 */
export const MACRO_REGIME_REASON_CODES = [
  'cpi_not_loaded',
  'cpi_cache_stale',
  'cpi_stale',
  'rate_table_before_start',
  'rate_table_stale',
  'rate_schedule_exhausted',
  'internal_error',
] as const;
export type MacroRegimeReasonCode = (typeof MACRO_REGIME_REASON_CODES)[number];

/**
 * BLS 수집 1회의 결과 코드 (라벨 사유와 별개, Analyst §6).
 * Analyst 목록 7개 + Developer 추가 3개:
 *  - `network_error`  — fetch 자체가 거절(DNS·연결·**리다이렉트**: `redirect: 'error'` 라 3xx 는 여기로 온다)
 *  - `internal_error` — 수집기 코드의 예기치 못한 예외(던지지 않고 이 코드로 끝낸다)
 *  - `disabled_in_test` — 시험 환경 실호출 차단 장치(G2)가 막았다
 */
export const BLS_FETCH_STATUSES = [
  'ok',
  'http_error',
  'timeout',
  'too_large',
  'bad_json',
  'bad_schema',
  'request_failed_status',
  'network_error',
  'internal_error',
  'disabled_in_test',
] as const;
export type BlsFetchStatus = (typeof BLS_FETCH_STATUSES)[number];

/**
 * 기록의 `cpi.fetchStatus` — 가장 최근 수집 시도의 결과. 시도 전이면 `not_attempted`,
 * 운영 끄기 손잡이(`MACRO_REGIME_BLS_DISABLED=true`)면 `disabled`.
 */
export type CpiFetchStatus = BlsFetchStatus | 'not_attempted' | 'disabled';

export type RateDirection = 'tightening' | 'hold' | 'easing';

/**
 * 발표 시각 판정 기준 (Leader G7-2).
 *  - `live`: 일정표의 예정 시각으로 판정(운영 기록 — 연기돼도 API 에 값이 없어 자동 안전)
 *  - `confirmed_only`: `confirmed: true` 행만 '발표됨'(과거 재계산·백테스트 전용 — 연기 구간 look-ahead 방지)
 */
export type ReleaseBasis = 'live' | 'confirmed_only';

/** 기준월('YYYY-MM') → 지수. `null` = 그 달 값 없음(BLS `"-"`) */
export type CpiIndexByMonth = Readonly<Record<string, number | null>>;

export interface MacroRegimeCpiRecord {
  seriesId: typeof CPI_SERIES_ID;
  /** 라벨에 쓴 기준월 (YYYY-MM). 사용 가능한 달이 없으면 null */
  referenceMonth: string | null;
  /** 그 달의 발표 시각 (ISO UTC, 일정표 값) */
  releaseAtUtc: string | null;
  index: number | null;
  /** referenceMonth − 12개월 */
  baseMonth: string | null;
  baseIndex: number | null;
  /** (index / baseIndex − 1) × 100, 소수 4자리 */
  yoyPctRaw: number | null;
  /** yoyPctRaw 를 소수 1자리로 반올림(0.05 올림) — 임계 비교 값 */
  yoyPct: number | null;
  hot: boolean | null;
  /** 현재 ET 달력월 − referenceMonth */
  monthGap: number | null;
  /** 지금 시각 기준 일정표상 발표가 지난 가장 최근 기준월 (G7-3) */
  expectedReferenceMonth: string | null;
  /** referenceMonth 가 expectedReferenceMonth 보다 이르면(또는 없으면) true — 미공표 월 fallback 때도 true (G7-3) */
  lagsSchedule: boolean;
  /** 마지막 **성공** 수집 시각 (ISO UTC) */
  fetchedAtUtc: string | null;
  /** asOf − fetchedAt (초) */
  cacheAgeSec: number | null;
  fetchStatus: CpiFetchStatus;
}

export interface MacroRegimeRateRecord {
  /** asOf(ET 달력일) 시점 목표 범위 상단 (%) */
  upperPct: number | null;
  /** 그 상단의 효력일 */
  upperEffectiveFrom: string | null;
  /** asOf(ET 달력일) − 6 달력월 (같은 일, 없으면 그 달 말일) */
  compareDate: string | null;
  upper6mAgoPct: number | null;
  /** upperPct − upper6mAgoPct, 소수 2자리 */
  deltaPct: number | null;
  direction: RateDirection | null;
  tableVerifiedThrough: string;
  /** asOf(ET 달력일) 이상인 첫 정례 결정일 — 알려진 일정이 끝났으면 null */
  nextKnownDecisionDate: string | null;
}

export interface MacroRegimeRecord {
  ruleVersion: typeof RULE_VERSION;
  label: MacroRegimeLabel;
  /** label === 'hot_tightening' */
  isType5: boolean;
  reasonCodes: MacroRegimeReasonCode[];
  /** 판정 시각 (ISO UTC, 초 단위) */
  asOfUtc: string;
  /** 판정 시각의 미 동부 달력일 */
  asOfEtDate: string;
  cpi: MacroRegimeCpiRecord;
  rate: MacroRegimeRateRecord;
}

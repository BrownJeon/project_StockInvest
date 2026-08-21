/**
 * 리서치(급등·급락 사이클 패턴 검증) 공용 타입 — T-032.
 *
 * 이 디렉토리는 **실매매와 완전히 분리**돼 있다. 여기서 나온 어떤 값도
 * `src/lib/strategy/rules/` · `createSignal()` 로 흘러들어가지 않는다(이번 범위 밖).
 * LLM 호출도 하지 않는다 — 전부 순수 통계/코드.
 */

export type ResearchMarket = 'domestic' | 'overseas';

/** 분할·배당 보정이 끝난 일봉 1개. `close`는 항상 조정종가 기준이다. */
export interface DailyCandle {
  /** 거래소 현지 기준 'YYYY-MM-DD' */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** 사이클 탐지 파라미터. 전부 거래일(캔들 개수) 단위. */
export interface RallyCycleConfig {
  /** trough 판정용 트레일링 구간 길이 */
  lookbackDays: number;
  /** trough 이후 랠리를 찾는 forward window */
  rallyWindowDays: number;
  /** 랠리로 인정할 최소 상승률(%) */
  rallyThresholdPct: number;
  /** 랠리 peak 이후 재하락을 찾는 window */
  postRallyDeclineWindowDays: number;
  /** 사이클 확정으로 인정할 최소 재하락률(%) */
  postRallyDeclinePct: number;
}

export const DEFAULT_RALLY_CYCLE_CONFIG: RallyCycleConfig = {
  lookbackDays: 60,
  rallyWindowDays: 20,
  rallyThresholdPct: 15,
  postRallyDeclineWindowDays: 20,
  postRallyDeclinePct: 10,
};

export interface RallyEvent {
  troughIndex: number;
  troughDate: string;
  troughClose: number;
  peakIndex: number;
  peakDate: string;
  /** 랠리 구간 최고가(조정 후) */
  peakPrice: number;
  /** (peakPrice - troughClose) / troughClose * 100 */
  rallyPct: number;
  /** trough → peak 거래일 수 */
  daysToRally: number;
  /**
   * peak 이후 `postRallyDeclineWindowDays` 안에 `postRallyDeclinePct` 이상 재하락했는가.
   * 관측 구간이 시계열 끝에 걸려 아직 판단할 수 없으면 `null`(보류) — 절대 false로 단정하지 않는다.
   */
  confirmedCycle: boolean | null;
  /** 관측된 최대 재하락률(%). 관측 데이터가 전혀 없으면 null */
  declinePct: number | null;
  declineDate: string | null;
  daysToDecline: number | null;
}

export interface RallyDetectionResult {
  events: RallyEvent[];
  /** 양성 라벨로 쓸 trough 인덱스(이벤트로 확정된 것만) */
  troughIndices: number[];
  /**
   * forward window가 시계열 끝에 걸려 랠리 여부를 판단할 수 없었던 trough 수.
   * "랠리 없음"과 구분해서 보고한다.
   */
  pendingTroughCount: number;
  avgRallyPct: number | null;
  avgDaysToRally: number | null;
}

/** 시점 t의 인과적(causal) 선행지표 피처. 계산 불가 구간은 null. */
export interface PrecursorFeatures {
  index: number;
  date: string;
  rsi14: number | null;
  /** ATR14 / close * 100 */
  atrPct: number | null;
  /** 볼린저 %B — (close - lower) / (upper - lower) */
  bbPercentB: number | null;
  /** 트레일링 최고 종가 대비 낙폭(%) — 양수가 낙폭 */
  drawdownPct: number | null;
  /** volume / SMA(volume, 20) */
  volumeRatio: number | null;
}

export interface PrecursorRuleStat {
  id: string;
  label: string;
  /** 규칙이 참이었던 평가 가능 일수 */
  triggerCount: number;
  /** 그중 양성(=trough 근방)이었던 일수 */
  hitCount: number;
  /** hitCount / triggerCount (0~1). triggerCount=0이면 null */
  precision: number | null;
  /** lift = precision / baseRate. baseRate=0이면 null */
  lift: number | null;
}

export interface PrecursorAnalysis {
  /** 모든 피처가 계산 가능했던 평가 대상 일수 */
  evaluatedDays: number;
  /** 양성 라벨 일수(= trough ± labelToleranceDays 로 확장된 일수) */
  positiveDays: number;
  /** positiveDays / evaluatedDays (0~1) */
  baseRate: number | null;
  /** trough 전후 며칠까지 양성으로 볼지 */
  labelToleranceDays: number;
  /** positiveDays가 임계치 미만 — 통계적 의미 없음 */
  lowSampleWarning: boolean;
  /** 과신 방지 고정 문구 */
  note: string;
  rules: PrecursorRuleStat[];
}

export type ResearchDataWarning =
  | 'short_history'
  | 'no_events'
  | 'insufficient_for_precursors'
  | 'pending_recent_trough';

export interface ResearchReport {
  symbol: string;
  market: ResearchMarket;
  /** KST 기준 실행일 'YYYY-MM-DD' */
  runDate: string;
  dataRangeFrom: string | null;
  dataRangeTo: string | null;
  eventCount: number;
  events: RallyEvent[];
  avgRallyPct: number | null;
  avgDaysToRally: number | null;
  precursorAnalysis: PrecursorAnalysis | null;
  /**
   * `dataRangeTo`(마지막 캔들 = 종가 기준일)에 참이었던 선행지표 규칙 id 들 — T-033.
   *
   * `null`  = 평가하지 못함(캔들 없음·지표 워밍업 구간)
   * `[]`    = 평가했고 충족한 규칙이 없음 — **결측이 아니라 관측 결과다**
   *
   * ⚠ 여기서 말하는 "오늘"은 실시간이 아니다. 국내는 16:00 cron(전일 종가 기준), 해외는
   *   07:00 cron(당일 종가 기준)에만 갱신된다. 소비자는 반드시 `dataRangeTo` 를 함께 노출한다.
   */
  todayActiveRuleIds: string[] | null;
  dataWarnings: ResearchDataWarning[];
  error: string | null;
}

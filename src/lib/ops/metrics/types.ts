/**
 * T-108 운용 지표 — **공유 타입** (WP-A 소유, WP-B·WP-C 는 import 만).
 *
 * 정본: `docs/design/2026-10-30-t108-implementation-guide.md` §4.1 (+ §4.4~4.6 의 DTO 모양).
 * 필드 이름을 바꿀 때는 WP-A 가 바꾸고 B·C 에 알린다 — 다른 WP 가 이 파일을 고치지 않는다.
 *
 * 규칙(가이드 §4.0 · 계약 §1.1):
 *  - 「확인된 0」(`zero`)·「모름」(`unknown`)·「조회 실패」(`error`)·「준비 중」(`prep`)을 섞지 않는다.
 *    값이 없을 때 0 을 넣지 않는다 — `value: null` + 상태로 말한다.
 *  - 시각 문자열은 전부 ISO 8601 `+09:00`(KST 표기, 서버가 만든다). 날짜만 있는 값은 `YYYY-MM-DD`
 *    (국내 = KST 날짜, 해외 = ET 날짜 — `SessionRef.tz` 로 구분).
 *  - `reason` 은 짧은 분류어(예: db_error · timeout · not_migrated · record_off · holidays_unknown · fx_fallback).
 *    사용자 문구가 아니다 — 문구는 화면(WP-B·C)이 정한다.
 *
 * 이 파일은 **런타임 import 0개**(type import 만)라 클라이언트 컴포넌트가 그대로 import 해도 DB 코드가 딸려 가지 않는다.
 */
import type { EvalFunnelSummary } from '@/lib/strategy/eval-funnel-query';

// ── 공통 ───────────────────────────────────────────────────────────────────

export type Market = 'domestic' | 'overseas';
export type OpsStage = 'observe' | 'halt' | 'mixed' | 'live' | 'unknown';
export type MetricState = 'available' | 'zero' | 'unknown' | 'error' | 'stale' | 'partial' | 'blocked' | 'off_hours' | 'prep';
/** asOf = ISO 8601 +09:00. reason = 짧은 분류어. */
export interface Metric<T> { state: MetricState; value: T | null; asOf: string | null; reason?: string }
export interface ByMarket<T> { domestic: T; overseas: T }
export interface SessionRef { market: Market; sessionDate: string /* YYYY-MM-DD, 국내 KST·해외 ET */; tz: 'KST' | 'ET' }
/** 섹션 단위 실패 격리 — 한 섹션의 쿼리 실패는 그 섹션만 error, HTTP 는 200. */
export type Section<T> = { state: 'ok'; data: T } | { state: 'error'; error: string };

// ── 안전 상태 (GET /api/ops/safety-state) ─────────────────────────────────

export interface SafetyStateDTO {
  readAt: string;
  stage: OpsStage;
  /** liveTradingFromDryRun(isDryRun()) — null = 읽기 실패 */
  liveTrading: boolean | null;
  /** isKillSwitchActive() — null = 읽기 실패 */
  killSwitch: boolean | null;
  /** readExitEngineSwitch() 그대로. source='db_error' 면 화면은 `—` */
  exitEngine: { enabled: boolean; hardStopEnabled: boolean; source: 'config' | 'absent' | 'unparsable' | 'db_error' } | null;
  /** strategies 집계. validated = VALIDATED_STATUSES, validatedEnabled = 검증 통과 ∧ enabled=1 */
  strategies: { total: number; enabled: number; validated: number; validatedEnabled: number } | null;
  /** notify_signal_auto_submit (키 없으면 true — settings/safety 기본값과 같은 규칙). null = 읽기 실패 */
  notifyAutoSubmit: boolean | null;
  /** db_unreachable | strategies_error | exit_switch_db_error | notify_read_error | dry_run_read_error | kill_switch_read_error */
  errors: string[];
}

// ── 확인 필요 (홈) ─────────────────────────────────────────────────────────

export type CheckKind = 'safety_unknown' | 'kill_switch_on' | 'exit_live_orders' | 'buy_blocked' | 'awaiting_approval' | 'order_rejected'
  | 'order_blocked' | 'hard_stop_off_hit' | 'virtual_exit' | 'universe_change_proposed' | 'data_anomaly' | 'analysis_unknown';
/**
 * 확인 필요 1줄. 문구는 화면(`check-copy.ts`)이 kind 로 정한다 — params 는 그 문구의 빈칸 값.
 * kind 별 params (값이 없으면 null):
 *  - safety_unknown      : errors(쉼표로 이은 SafetyStateDTO.errors) — 안전 상태 일부를 못 읽음(단계 unknown). 맨 앞 줄, severity e
 *  - kill_switch_on      : since(ISO|null — safety_kill_switch 마지막 변경 시각), exitSignalsBlocked(오늘 청산 시그널 중 모든거래차단으로 막힌 주문 수)
 *  - exit_live_orders    : exitFillsToday(오늘 청산 체결 건수)
 *  - buy_blocked         : validatedEnabled, total
 *  - awaiting_approval   : domestic, overseas, earliestSymbol, earliestAt(ISO)
 *  - order_rejected      : symbol, side('buy'|'sell'), reason(첫 거부 사유 요약 — 원문 120자 이내), market
 *  - order_blocked       : symbol, side, reason(blocked_by 분류 코드 — 한도·관문 등, 모든거래차단 제외), market — 오늘 안전장치에 막힌 주문
 *  - hard_stop_off_hit   : symbols(종목 수), days(연속 세션일 수), daysCapped(1 = 30일 이상)
 *  - virtual_exit        : at(ISO), exitKind(내부 이름 — eod_loss_cut 등, 화면이 표시 이름으로), notifyAutoSubmit(1|0|null)
 *  - universe_change_proposed : first(첫 제안 요약 — 서버가 완성한 문자열, 예 'NAS:AAAA 상장폐지 예정'), more(총건수 − 1)
 *                          — T-143. 조회 실패는 이 줄을 **빼는 것**이고 섹션을 오류로 만들지 않는다(가이드 §3.4)
 *  - data_anomaly        : source(DataSourceId), label, state(MetricState), streak(뉴스 0건 연속 일수|null), more(같은 kind 가 잘린 수 — 마지막 줄에만)
 *  - analysis_unknown    : market, slotAt(ISO — 마지막 예정 장마감 분석 슬롯)
 */
export interface CheckItem { kind: CheckKind; severity: 'e' | 'w' | 'i' | 'n'; count?: number; market?: Market;
  params: Record<string, string | number | null>; href: string }

// ── 장마감 AI 분석 1회 (홈 A1·A2 · 오늘의 분석 표 · 분석 › 오늘 분석) ────────

export interface AnalysisRunRow {           // 장마감 AI 분석 1회 (시장별 마지막 세션)
  session: SessionRef; runStartedAt: string | null; runStatus: 'ok' | 'partial' | 'failed' | 'skipped' | 'missing' | 'degraded' | null;
  /** runStatus='skipped' 일 때 건너뜀 사유 코드(실행 기록 degraded_reason 에서 'skip:' 접두를 뗀 값, 예 weekend·no_new_session). 모르면 null */
  skipReason: string | null;
  /** runStatus='failed'·'degraded'·'partial' 일 때 사유 코드(degraded_reason 원문, 예 fx_unknown·rag_fail). 없으면 null */
  failReason: string | null;
  evaluated: Metric<number>; ruleCandidates: Metric<number>; aiBuy: Metric<number>;
  signalsCreated: Metric<number>; signalsBlocked: Metric<number>; signalsPending: Metric<number>;
  topExclusion: Metric<{ code: string; label: string; count: number }>;
  nextRunAt: string | null;               // KST ISO
}

// ── 관찰 세트 A (홈) ───────────────────────────────────────────────────────

export interface ObserveSet {               // A1~A4
  analysis: ByMarket<AnalysisRunRow>;
  postmortem: Metric<{ total: number; done: number; tracking: number; cardsOnly: boolean; lastBarDate: ByMarket<string | null> }>;
  /** items: 원천 7개 중 이상(stale·error·unknown·뉴스 0건 연속 partial) + 오늘(KST) 실행 기록의 failed·missing·degraded 잡(source='job_run', jobId·market 채움) */
  anomalies: Metric<{ total: number; sourcesChecked: number; items: AnomalyItem[]; analysisFailureKnown: boolean }>;
}
export interface AnomalyItem {
  source: DataSourceId | 'job_run';
  state: MetricState;
  /** 원천 표시 이름(예: '뉴스 국내') 또는 잡 이름(job_id) */
  label: string;
  /** source='job_run' 일 때 */
  jobId?: string; market?: Market | 'common'; jobStatus?: string;
  /** 뉴스 0건 연속 일수(뉴스 원천일 때) */
  streak?: number | null;
}

// ── 실거래 세트 B (홈) ─────────────────────────────────────────────────────

export interface LiveSet {                  // B1~B7 (B4·B6 은 v1 고정 상태)
  watch: ByMarket<Metric<{ watching: number; executing: number; nextSession: number }>>;
  positions: Metric<{ autoCount: number; autoValueKrw: number | null; accountCount: number; snapshotAt: string | null }>;
  fillsToday: ByMarket<Metric<{ fills: number; session: SessionRef; exitSells: number }>>;
  allocation: Metric<null>;               // v1 항상 { state:'unknown', reason:'not_set' }
  autoPnl: Metric<null>;                  // v1 항상 { state:'unknown', reason:'baseline_unset' }
  buyable: ByMarket<Metric<{ native: number; currency: 'KRW' | 'USD'; krw: number | null; fxAt: string | null; fxSource: 'fx_rates' | 'fallback' | null }>>;
}

// ── 청산 로직 (홈 3줄 X1·X3·X4 / 분석 › 검증·성과 X1~X6) ───────────────────

/** X3 — 오늘 세션 종목 단위 판정 (종목 수. 틱 수는 hardStopOffTicks 만 병기) */
export interface ExitJudgmentCounts {
  noFire: number; hardStopOffHit: number; hardStopOffDays: number; dataErrors: number; fired: number; trailingActive: number;
  /** 손실한도 손절 OFF 스킵 행 수(틱) — 분석 › 검증·성과 「평가 N회」 병기용. 홈에는 쓰지 않는다(D12) */
  hardStopOffTicks: number;
  /** hardStopOffDays 가 30일 창 끝까지 이어졌는가(= 「30일 이상」) */
  hardStopOffDaysCapped: boolean;
  /** 청산 시그널 생성 실패(exit_create_failed) 종목 수 — 손절 유실 위험이라 따로 센다 */
  createFailed: number;
  /** 자동 청산 엔진이 꺼져 있던 틱에 조건 충족(exit_engine_disabled) 종목 수 — 정책 스킵(상위) */
  engineOffHit: number;
  /** 쿨다운 스킵(cooldown_exit·exit_cooldown_5m) 종목 수 — 정책 스킵 */
  cooldown: number;
}
/** X4 — 오늘 세션 청산 엔진(exit-engine-v1) 시그널과 그 주문 */
export interface ExitProposals {
  /** 오늘(시장별 세션일) 청산 엔진 시그널 **전부**(상태 무관). 「청산 제안 0 ✓ 확인된 0」은 total=0 ∧ state='zero' 일 때만 */
  total: number;
  virtual: number; awaitingApproval: number; submittedLive: number; blockedByKill: number; filled: number;
  firstKind: string | null; firstAt: string | null;
  /** 만료된 청산 시그널(signals.status='expired') */
  expired: number;
  /** 거절된 청산 시그널(signals.status='rejected') */
  rejected: number;
  /** 위 어느 칸에도 들지 않은 것(주문 없는 auto_submitted·superseded·skipped·그 밖 주문 상태 등) — total 과 맞추기 위한 나머지 */
  other: number;
}
export interface ExitLines {                // X1·X3·X4 (홈 3줄)
  engine: Metric<{ enabled: boolean; hardStopEnabled: boolean }>;
  /** off_hours = 장외(그 시장 오늘 세션 run 0행). value 는 off_hours 에서도 채울 수 있다(at=null 가능). */
  lastEval: ByMarket<Metric<{ at: string | null; runsToday: number; sessionOpen: boolean }>>;
  nextOverseasOpenKst: string | null;
  /** 다음 14일 안에 해외 개장 KST 시각이 바뀌는 첫 세션(DST) — 「({MM-DD}부터 {HH:MM})」 */
  nextOverseasOpenChange: { sessionDate: string; openKst: string } | null;
  judgments: ByMarket<Metric<ExitJudgmentCounts>>;  // 종목 수
  proposals: Metric<ExitProposals>;
}
/** 분석 › 검증·성과 「청산 로직 (X1~X6)」 kv 6행 */
export interface ExitDetail extends ExitLines {
  /** X2 평가 대상 — position_state 행 수 대비 오늘 평가됨/데이터 이상/미평가 (종목 수) */
  coverage: ByMarket<Metric<{ positions: number; evaluated: number; dataErrors: number; notEvaluated: number }>>;
  /** X5 임계 대비 현재 — 종목 수만 (종목별은 /api/ops/trade holdings) */
  zones: Metric<{ hardStop: number; eodCut: number; takeProfit: number; trailingActive: number; neutral: number; notEvaluated: number; snapshotAt: string | null }>;
  /** X6 기록 공백 — 국내 오늘 장중 5분 슬롯 기대치 − run 행 수 (근사). 완전판은 T-112 */
  gap: Metric<{ expectedSlots: number; runs: number; gap: number; balancesUnknown: number }>;
}

// ── 최근 활동 ─────────────────────────────────────────────────────────────

/**
 * 최근 활동 1줄 — title/sub 는 서버가 데모 714행 문구 틀로 만든다(종목은 코드 그대로 — 화면이 이름으로 바꿀 수 있게 params.symbol 도 준다).
 * params (값이 없으면 null):
 *  - analysis    : market, status(job_run_log.status), evaluated(number|null), signals(number|null), blocked(number|null)
 *  - order       : market, symbol, side, orderStatus(orders.status), exitKind(청산 엔진 주문이면 내부 이름|null)
 *  - signal_block: market|null, count(오늘 장중 매수 시그널 skipped 수)
 */
export interface ActivityItem { at: string; kind: 'analysis' | 'order' | 'signal_block'; title: string; sub: string;
  params: Record<string, string | number | null> }

// ── 홈 (GET /api/ops/home) ─────────────────────────────────────────────────

/**
 * 「확인 필요」 빈 상태 문장의 근거 — 각 항목을 **실제로 평가했는가**(조회 성공 + 판정 가능). false 인 항목은 「0」이라고 쓰지 않는다.
 *  - approval: 승인 대기 COUNT 성공 · orders: 오늘 거부·차단 주문 조회 성공
 *  - anomalies: 데이터 이상이 완전히 알려짐(state zero|available — partial(분석 실패 모름)·error 는 false)
 *  - exitConditions: 청산 엔진 ON 이고 최소 한 시장이 오늘 평가됨(판정 state zero|available|partial)
 *  - safety: 단계가 unknown 이 아님
 */
export interface CheckCoverage { approval: boolean; orders: boolean; anomalies: boolean; exitConditions: boolean; safety: boolean }

export interface HomeDTO {
  generatedAt: string; stage: OpsStage;
  /** 같은 응답 안에서 쓴 안전 상태 — 띠는 /api/ops/safety-state 를 따로 30초마다 읽는다 */
  safety: SafetyStateDTO;
  checks: Section<CheckItem[]>;
  /** checks 가 ok 일 때만 — 빈 상태 문장의 항목별 평가 여부. checks 가 error 면 null */
  checkCoverage: CheckCoverage | null;
  /** 데이터 이상(A4) — **모든 단계에서** 계산(관찰 세트의 observe.anomalies 와 같은 값) */
  anomalies: Section<ObserveSet['anomalies']>;
  counts: Section<{ approval: ByMarket<number>; earliestExpiry: { symbol: string; at: string } | null; rejectedToday: number }>;
  /** 오늘의 분석·판단 표(§2.3.6) — **단계 무관 항상**. observe.analysis 와 같은 계산 결과(관찰 세트일 때 둘이 같다) */
  analysis: Section<ByMarket<AnalysisRunRow>>;
  observe: Section<ObserveSet> | null;     // stage ∈ observe|halt|unknown 일 때만
  live: Section<LiveSet> | null;           // stage ∈ mixed|live 일 때만
  exit: Section<ExitLines>;
  activity: Section<ActivityItem[]>;
}

export type DataSourceId = 'portfolio_snapshot' | 'fx_usdkrw' | 'daily_bars_kr' | 'daily_bars_us' | 'news_domestic' | 'news_overseas' | 'broker_ledger';

// ── 거래 (GET /api/ops/trade) ──────────────────────────────────────────────

export type ExitZone = 'hard_stop' | 'eod_cut' | 'take_profit' | 'trailing_active' | 'neutral' | 'not_evaluated';
export interface TradeHoldingRow {
  symbol: string; market: Market; auto: boolean; pnlPct: number | null; zone: ExitZone;
  detail: { thresholdPct?: number; fromPeakPct?: number };
}
export interface TradeDTO {
  generatedAt: string;
  counts: Section<{ approval: ByMarket<number>; detected: number; watching: ByMarket<number>; executing: number; nextSession: number; preOrderBlockedToday: number }>;
  /** 진입 감시 목록의 「주문 선점 중」 줄 — signals.status='executing' (취소 불가, 버튼 없음) */
  executing: Section<{ id: number; symbol: string; market: Market; side: 'buy' | 'sell'; since: string | null }[]>;
  /** 관찰 단계 0건일 때 보이는 「오늘 차단된 장마감 시그널」(최대 2) — signals.status='skipped' ∧ scenario_source='post-market' */
  blockedPostMarket: Section<{ id: number; symbol: string; market: Market; confidence: number | null; createdAt: string; session: SessionRef;
    /** `signals.indicators.gate` — `validation_gate` 면 검증 관문 차단, 그 밖·없음이면 단순 건너뜀(T-130 D7-A) */
    gate: string | null }[]>;
  holdings: Section<{ snapshotAt: string | null; stale: boolean; trailing: { activatePct: number; drawdownPct: number; source: 'override' | 'default' };
    /** 손실한도 손절·장마감 전 손절·익절 임계(코드 기본값 ⊕ override) — foot 문구용 */
    thresholds: { hardStopPct: number; eodLossCutPct: number; targetProfitPct: number; source: 'override' | 'default' };
    accountCount: number; autoCount: number;
    rows: TradeHoldingRow[] }>;
  openOrders: Section<{ id: number; symbol: string; market: Market; side: 'buy' | 'sell'; qty: number; filled: number }[]>;
}

// ── 장중 룰 평가 깔때기 (GET /api/ops/funnel?market=) ───────────────────────

/** JSON 으로 나가면 Date 가 문자열이 된다 — 그 모양을 그대로 적는다 */
export type EvalFunnelSummaryJson = Omit<EvalFunnelSummary, 'rangeStart' | 'rangeEnd'> & { rangeStart: string; rangeEnd: string };
export interface FunnelDTO {
  generatedAt: string;
  /**
   * 기준 세션(시장별 마지막 run 시각) 조회 결과. error 면 defaultMarket·sessions 는 **추정값**(fallback 표지가 true 인 것)이고
   * summary 는 error, sessions[*].anomalies·lastRunAt 은 null — 화면은 수치를 정상값처럼 그리지 않는다.
   */
  basis: { state: 'ok' } | { state: 'error'; error: string; fallback: { defaultMarket: boolean; sessions: boolean } };
  defaultMarket: Market;                       // MAX(eval_funnel.ts) 가 더 최근인 시장
  sessions: ByMarket<{ session: SessionRef; anomalies: number | null; lastRunAt: string | null }>;
  market: Market;
  summary: Section<EvalFunnelSummaryJson>;
}

// ── 분석 (GET /api/ops/analysis?part=) ─────────────────────────────────────

export interface AnalysisCandidate {
  symbol: string; market: Market; session: SessionRef;
  /** signal = 시그널로 이어진 종목(signals) · judgment_skip = 판단 기록의 「매수 안 함」 종목 */
  origin: 'signal' | 'judgment_skip';
  aiDecision: 'BUY' | 'SKIP' | null;
  confidence: number | null;
  /** origin=signal: signals.status (skipped=검증 관문 차단 등) */
  signalStatus: string | null;
  /**
   * origin=signal: `signals.indicators.gate`(예 `validation_gate`) — `skipped` 가 검증 관문에 막힌 것인지 그 밖(수량 1주 미만 등)인지 가른다(T-130 D7-A).
   * origin=judgment_skip 이거나 값이 없으면 null.
   */
  signalGate: string | null;
  /** origin=judgment_skip: 판단 기록 후보 행의 제외 코드(exclusion_code) */
  exclusionCode: string | null;
  createdAt: string | null;
}
export interface AnalysisTodayDTO {
  part: 'today'; generatedAt: string;
  runs: Section<ByMarket<AnalysisRunRow>>;
  /** skipRows = 판단 기록 SKIP 행 상태 — prep(record_off|not_migrated) / unknown(기록 켜짐·행 없음) / available */
  candidates: Section<{ rows: AnalysisCandidate[]; skipRows: Metric<number> }>;
  /** 리서치 추적 종목 수 — stock_favorites.research_enabled=1 */
  researchCount: Metric<number>;
}
export interface PostmortemHorizonRow { horizon: 1 | 3 | 5 | 10; n: number; medianExcessPct: Metric<number> }
export interface AnalysisVerifyDTO {
  part: 'verify'; generatedAt: string;
  /** 사후 성과 — n 은 채우고, 초과수익 중앙값은 v1 에서 state='prep'(reason='not_implemented') (L-3) */
  postmortem: Section<{ population: Metric<number>; cardsOnly: boolean; entry: 'd1open'; rows: PostmortemHorizonRow[]; lastBarDate: ByMarket<string | null> }>;
  exit: Section<ExitDetail>;
  /** 가상 진입(paper_fills) 건수 — 라벨만 */
  paperFills: Metric<number>;
}
export interface DataSourceRow { id: DataSourceId; lastOkAt: string | null; state: MetricState; reason?: string;
  /** 일봉 = 마지막 trade_date(YYYY-MM-DD, 해외는 ET 날짜) · 뉴스 = 0건 연속 일수 · 그 밖 null */
  dateRef: string | null; streak: number | null }
export interface UptimeRow { group: 'analysis' | 'collection'; days: number; ok: number; expected: number | null; state: MetricState; reason?: string;
  /** job_run_log 첫 행 시각 — 「기록 {n}일째」 */
  firstRecordAt: string | null }
export interface AnalysisDataDTO {
  part: 'data'; generatedAt: string;
  sources: Section<DataSourceRow[]>;
  uptime: Section<UptimeRow[]>;
}
export type AnalysisDTO = AnalysisTodayDTO | AnalysisVerifyDTO | AnalysisDataDTO;

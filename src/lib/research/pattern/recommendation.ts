/**
 * 리서치 매수/매도 "고려" 추천 — T-033.
 *
 * ## 🔴 이 파일이 만드는 것은 예측이 아니다
 *
 * T-032 는 "예측이 아니라 사후 관찰"이라는 경계를 코드에 못박아 뒀다(`PRECURSOR_NOTE`,
 * `lowSampleWarning`). 이번 확장은 그 경계를 **신중하게** 넘는다 — 사용자가 명시적 추천을
 * 원했기 때문이다. 대신 아래 규율을 코드로 강제한다:
 *
 *  1. **"확률"이라고 부르지 않는다.** 우리가 가진 것은 과거 조건부 적중률(precision)뿐이다.
 *     `precision` 이라는 이름을 그대로 쓰고, 표시 문구도 "과거 적중률"로 통일한다.
 *  2. **표본이 적으면 추천하지 않는다.** `triggerCount < MIN_SAMPLE_FOR_RECOMMENDATION` 인
 *     규칙은 후보에서 제외되고, 후보가 하나도 없으면 `buy` 가 아니라 `insufficient_data` 다.
 *     추측으로 빈칸을 메우지 않는다.
 *  3. **면책 문구를 항상 동반한다.** 모든 반환값이 `note`(= `PRECURSOR_NOTE`)를 들고 다닌다.
 *     소비자가 문구를 따로 챙기는 걸 잊을 수 없게 값에 붙여 보낸다.
 *
 * ## 🔴 자동매매와 연결하지 않는다
 *
 * 이 모듈의 어떤 값도 `createSignal()` · `submitOrder()` · `src/lib/strategy/` 로 흘러가지
 * 않는다. 소비자는 **화면(ResearchTab)과 텔레그램 리포트뿐**이다. 이건 사용자가 직접 고른
 * 안전 경계이며 협상 대상이 아니다. 새 소비자를 붙일 때 이 문단을 먼저 읽을 것.
 *
 * ## 임계치의 지위
 *
 * 8건 / ×1.8 / ×0.8 / ×1.5 는 **1차 휴리스틱이며 실증검증된 값이 아니다.**
 * 근거와 재검토 조건은 `docs/research-rally-cycle.md` 에 기록한다.
 */
import { PRECURSOR_NOTE, getRuleLabel } from './precursor-analysis';
import type { PrecursorRuleStat } from '../types';

export type RecommendationAction = 'buy' | 'sell' | 'hold' | 'insufficient_data';

export type RecommendationConfidence = 'low' | 'medium' | 'high';

export interface BuyRecommendation {
  action: 'buy' | 'hold' | 'insufficient_data';
  /** 판단의 근거가 된 규칙(표본부족이면 "그나마 표본이 많았던" 오늘의 활성 규칙) */
  ruleId: string | null;
  ruleLabel: string | null;
  /** 과거 조건부 적중률(0~1). **확률이 아니다.** */
  precision: number | null;
  /** precision / baseRate */
  lift: number | null;
  /** 과거에 이 규칙이 참이었던 일수 — 표본 크기 */
  triggerCount: number;
  confidence: RecommendationConfidence | null;
  /**
   * `action==='buy'`이고 현재가·과거평균상승폭이 함께 주어졌을 때만 채워진다(그 외 null).
   * 목표가 = 현재가 × (1+avgRallyPct/100) — 참고치일 뿐 보장이 아니다.
   */
  nowPriceKRW: number | null;
  targetPriceKRW: number | null;
  /** 과거 평균 소요 거래일을 달력일로 환산한 값 — "며칠 안에"의 근사치 */
  timeframeDays: number | null;
  /** 과신 방지 고정 문구 — 표시 시 항상 함께 노출한다 */
  note: string;
}

export interface SellAssessment {
  action: 'sell' | 'hold' | 'insufficient_data';
  /** 진입 후 경과 **달력일**(표시용). 판정에는 거래일 환산치를 쓴다 — 아래 주석 참조 */
  daysSinceEntry: number | null;
  /** (현재가 - 진입가) / 진입가 * 100 */
  gainPct: number | null;
  reason: 'target_reached' | 'duration_exceeded' | 'in_progress' | null;
  /** 표본 크기(eventCount) 기준 신뢰도 — buy 와 동일 기준(confidenceFor) */
  confidence: RecommendationConfidence | null;
  /** 목표가 = 진입가 × (1+avgRallyPct/100). sampleOk 일 때만 채워진다. */
  targetPriceKRW: number | null;
  /** 과거 평균 소요 거래일을 달력일로 환산한 "목표 기한"(진입일 기준 며칠째까지) */
  timeframeDays: number | null;
  note: string;
}

/**
 * 추천을 만들기 위한 최소 표본(규칙이 과거에 참이었던 일수).
 * `PrecursorAnalysisConfig.minPositiveDays`(5)보다 보수적으로 잡는다 — 저쪽은 "경고를 띄울지"의
 * 임계치이고 이쪽은 "추천을 낼지"의 임계치라, 더 높은 문턱이 맞다.
 */
export const MIN_SAMPLE_FOR_RECOMMENDATION = 8;

/** 기저율 대비 이 배수 이상이어야 "매수 고려". 미만이면 규칙이 있어도 관망. */
export const MIN_LIFT_FOR_BUY = 1.8;

/**
 * "매수 고려"로 표시하는 목표 도달 기간의 상한(달력일).
 *
 * 사용자 피드백(2026-08-21): 예시로 보여준 14일은 "변동성이 크고 타이밍을 잡을 수 없다"는 이유로
 * 너무 길다고 판단, 5일 이내로 좁혀달라고 요청했다. 과거 평균 소요기간이 이 값을 넘는 종목은
 * lift 조건을 통과해도 `buy`가 아니라 `hold`로 내린다 — "5일 이내"라고 표시할 근거가 없는데
 * 매수를 권하지 않기 위함(기간을 5일로 잘라 보여주는 게 아니라, 애초에 추천 자체를 보류한다).
 */
export const MAX_TIMEFRAME_DAYS_FOR_BUY = 5;

/** 과거 평균 상승폭의 이 비율에 도달하면 "매도 고려"(목표 도달). */
export const TARGET_REACHED_RATIO = 0.8;

/** 과거 평균 소요일의 이 배수를 넘기면 "매도 고려"(기간 초과). */
export const DURATION_EXCEEDED_RATIO = 1.5;

/**
 * 거래일 → 달력일 환산 계수.
 *
 * `avgDaysToRally` 는 캔들 개수, 즉 **거래일** 단위다. 반면 보유기간은
 * `position_state.first_seen_at` 에서 나오는 **달력일**이다. 단위를 맞추지 않고 비교하면
 * 주말·공휴일만큼(약 1.4배) 기간이 부풀려져 "기간 초과" 매도 추천이 실제보다 훨씬 빨리 뜬다.
 * 주 5거래일 가정으로 avgDaysToRally 를 달력일로 환산해서 비교한다(설계서에 없던 세부 결정).
 */
export const CALENDAR_DAYS_PER_TRADING_DAY = 7 / 5;

/** 표본 크기 구간 → 신뢰도 라벨. 순수 휴리스틱이며 통계적 유의성 검정이 아니다. */
function confidenceFor(triggerCount: number): RecommendationConfidence {
  if (triggerCount >= 30) return 'high';
  if (triggerCount >= 15) return 'medium';
  return 'low';
}

/** 과거 평균 소요 거래일 → 달력일 반올림 정수. 표시용("며칠 안에")이며 판정에는 안 쓴다. */
export function estimateTimeframeDays(avgDaysToRally: number | null | undefined): number | null {
  if (avgDaysToRally == null || !Number.isFinite(avgDaysToRally) || avgDaysToRally <= 0) return null;
  return Math.round(avgDaysToRally * CALENDAR_DAYS_PER_TRADING_DAY);
}

/**
 * referencePrice × (1+avgRallyPct/100) — 참고 목표가.
 * 🔴 예측이 아니라 과거 평균 상승폭을 현재/진입가에 대입한 어림값이다. 보장하지 않는다.
 */
export function estimateTargetPrice(
  referencePriceKRW: number | null | undefined,
  avgRallyPct: number | null | undefined,
): number | null {
  if (
    referencePriceKRW == null || !Number.isFinite(referencePriceKRW) || referencePriceKRW <= 0 ||
    avgRallyPct == null || !Number.isFinite(avgRallyPct)
  ) return null;
  return referencePriceKRW * (1 + avgRallyPct / 100);
}

/** 매수 컨텍스트(현재가·과거평균) — 주어졌을 때만 목표가·기간을 채운다. */
export interface BuyPriceContext {
  nowPriceKRW?: number | null;
  avgRallyPct?: number | null;
  avgDaysToRally?: number | null;
}

function emptyBuy(action: BuyRecommendation['action']): BuyRecommendation {
  return {
    action,
    ruleId: null,
    ruleLabel: null,
    precision: null,
    lift: null,
    triggerCount: 0,
    confidence: null,
    nowPriceKRW: null,
    targetPriceKRW: null,
    timeframeDays: null,
    note: PRECURSOR_NOTE,
  };
}

function buyFrom(
  action: BuyRecommendation['action'],
  rule: PrecursorRuleStat,
  confidence: RecommendationConfidence | null,
  ctx?: BuyPriceContext,
): BuyRecommendation {
  // 가격·기간은 실제 매수 추천(action==='buy')일 때만 채운다 — 관망/보류에 목표가를 붙이면
  // "그래도 사도 되나?"로 오해할 수 있다.
  const showPrice = action === 'buy';
  const nowPriceKRW = showPrice ? (ctx?.nowPriceKRW ?? null) : null;
  return {
    action,
    ruleId: rule.id,
    ruleLabel: rule.label || getRuleLabel(rule.id),
    precision: rule.precision,
    lift: rule.lift,
    triggerCount: rule.triggerCount,
    confidence,
    nowPriceKRW,
    targetPriceKRW: showPrice ? estimateTargetPrice(nowPriceKRW, ctx?.avgRallyPct) : null,
    timeframeDays: showPrice ? estimateTimeframeDays(ctx?.avgDaysToRally) : null,
    note: PRECURSOR_NOTE,
  };
}

/**
 * 매수 추천.
 *
 * @param todayActiveRuleIds 기준일 종가에서 참이었던 규칙 id. `null`=평가 못 함(결측),
 *                           `[]`=평가했고 충족한 규칙이 없음(관측 결과). 둘을 구분한다.
 * @param rules              같은 심볼의 과거 규칙별 적중률(`PrecursorAnalysis.rules`).
 *
 * 판정:
 *  - 결측(`null`)이거나 과거 통계가 없으면 → `insufficient_data`
 *  - 오늘 충족 규칙 0개 → `hold`(관망). 이건 결측이 아니라 "조건이 안 걸렸다"는 사실이다.
 *  - 충족했지만 표본(`triggerCount`)이 전부 문턱 미만 → `insufficient_data`
 *    (근거 표시용으로 표본이 가장 큰 활성 규칙을 함께 돌려준다 — "트리거 4건" 같은 안내)
 *  - 표본을 넘긴 후보 중 lift 1위가 `MIN_LIFT_FOR_BUY` 이상 → `buy`, 아니면 `hold`
 *
 * @param priceContext 현재가·과거평균(상승폭/소요일) — 주어지면 `action==='buy'`일 때 목표가·
 *                     기간을 함께 계산한다. 생략하면(기존 호출부 하위호환) 가격 필드는 전부 null.
 */
export function evaluateBuySignal(
  todayActiveRuleIds: string[] | null | undefined,
  rules: PrecursorRuleStat[] | null | undefined,
  priceContext?: BuyPriceContext,
): BuyRecommendation {
  if (todayActiveRuleIds == null) return emptyBuy('insufficient_data');
  if (!rules || rules.length === 0) return emptyBuy('insufficient_data');
  if (todayActiveRuleIds.length === 0) return emptyBuy('hold');

  const activeIds = new Set(todayActiveRuleIds);
  const active = rules.filter((r) => activeIds.has(r.id));
  // 저장된 id 에 대응하는 통계가 하나도 없다 — 규칙 집합이 바뀐 오래된 행 등. 결측으로 다룬다.
  if (active.length === 0) return emptyBuy('insufficient_data');

  const candidates = active.filter(
    (r) => r.triggerCount >= MIN_SAMPLE_FOR_RECOMMENDATION && r.precision != null && r.lift != null,
  );

  if (candidates.length === 0) {
    // 표본부족 — 추천하지 않는다. 다만 "무엇이 얼마나 부족했는지"는 보여준다.
    const best = [...active].sort((a, b) => b.triggerCount - a.triggerCount)[0];
    return { ...buyFrom('insufficient_data', best, null), confidence: null };
  }

  const top = [...candidates].sort((a, b) => (b.lift ?? -1) - (a.lift ?? -1))[0];
  const passesLift = (top.lift ?? 0) >= MIN_LIFT_FOR_BUY;
  // 과거 평균 소요기간이 상한을 넘으면 "5일 이내"라고 보여줄 근거가 없다 — buy로 올리지 않는다.
  // avgDaysToRally 자체가 없으면(드묾 — precision 이 있으면 사실상 항상 함께 있다) 막지 않는다.
  const timeframeDays = estimateTimeframeDays(priceContext?.avgDaysToRally);
  const withinTimeframe = timeframeDays == null || timeframeDays <= MAX_TIMEFRAME_DAYS_FOR_BUY;

  if (passesLift && withinTimeframe) {
    return buyFrom('buy', top, confidenceFor(top.triggerCount), priceContext);
  }
  return buyFrom('hold', top, confidenceFor(top.triggerCount), priceContext);
}

/**
 * 매도 추천 — 보유 포지션이 "과거 평균 사이클" 대비 어디쯤 와 있는지.
 *
 * 이건 손절 로직이 아니다. 실제 손절·트레일링은 `src/lib/strategy/` 의 exit 엔진이 담당하고
 * 이 값은 그 경로에 **전혀 닿지 않는다**. 여기서 보는 건 "과거에 이 종목이 저점에서 평균
 * +N% / M거래일 만에 고점을 찍었는데, 지금 보유분이 그 궤적의 어디쯤인가" 하나뿐이다.
 *
 * ⚠ 알려진 근사: 과거 통계는 **저점(trough) 기준**이고 우리 진입가는 저점이 아니다.
 *   따라서 `gainPct` 를 `avgRallyPct` 와 직접 비교하는 것은 낙관/비관 어느 쪽으로도 치우칠 수
 *   있는 근사다. 화면·리포트에서 "목표(과거평균 +N%) 대비 X% 진행"이라고 **비교 대상을 명시**해
 *   사용자가 근사임을 알 수 있게 한다.
 *
 * @param daysSinceEntry 진입 후 경과 달력일
 * @param avgDaysToRally 과거 평균 소요 **거래일** (단위가 달라 내부에서 환산한다)
 * @param eventCount     과거 관측된 사이클 수 = 표본
 */
export function evaluateSellSignal(
  entryPrice: number | null | undefined,
  currentPrice: number | null | undefined,
  daysSinceEntry: number | null | undefined,
  avgRallyPct: number | null | undefined,
  avgDaysToRally: number | null | undefined,
  eventCount: number | null | undefined,
): SellAssessment {
  const note = PRECURSOR_NOTE;
  const days = daysSinceEntry != null && Number.isFinite(daysSinceEntry) ? daysSinceEntry : null;

  const sampleOk = (eventCount ?? 0) >= MIN_SAMPLE_FOR_RECOMMENDATION;
  const priceOk =
    entryPrice != null && Number.isFinite(entryPrice) && entryPrice > 0 &&
    currentPrice != null && Number.isFinite(currentPrice) && currentPrice > 0;

  const gainPct = priceOk ? ((currentPrice! - entryPrice!) / entryPrice!) * 100 : null;

  if (!sampleOk || !priceOk || avgRallyPct == null || !Number.isFinite(avgRallyPct)) {
    return {
      action: 'insufficient_data', daysSinceEntry: days, gainPct, reason: null,
      confidence: null, targetPriceKRW: null, timeframeDays: null, note,
    };
  }

  // 표본이 sampleOk 를 넘겼으니 이 시점부터는 신뢰도·목표가·기간을 항상 채운다.
  const confidence = confidenceFor(eventCount ?? 0);
  const targetPriceKRW = estimateTargetPrice(entryPrice, avgRallyPct);
  const timeframeDays = estimateTimeframeDays(avgDaysToRally);

  if (avgRallyPct > 0 && gainPct != null && gainPct >= avgRallyPct * TARGET_REACHED_RATIO) {
    return {
      action: 'sell', daysSinceEntry: days, gainPct, reason: 'target_reached',
      confidence, targetPriceKRW, timeframeDays, note,
    };
  }

  if (days != null && avgDaysToRally != null && Number.isFinite(avgDaysToRally) && avgDaysToRally > 0) {
    const deadlineCalendarDays =
      avgDaysToRally * CALENDAR_DAYS_PER_TRADING_DAY * DURATION_EXCEEDED_RATIO;
    if (days >= deadlineCalendarDays) {
      return {
        action: 'sell', daysSinceEntry: days, gainPct, reason: 'duration_exceeded',
        confidence, targetPriceKRW, timeframeDays, note,
      };
    }
  }

  return {
    action: 'hold', daysSinceEntry: days, gainPct, reason: 'in_progress',
    confidence, targetPriceKRW, timeframeDays, note,
  };
}

/** 목표(과거 평균 상승폭) 대비 진행률(%). 표시 전용 — 판정에는 쓰지 않는다. */
export function targetProgressPct(
  gainPct: number | null | undefined,
  avgRallyPct: number | null | undefined,
): number | null {
  if (gainPct == null || avgRallyPct == null || !Number.isFinite(gainPct) || !Number.isFinite(avgRallyPct)) {
    return null;
  }
  if (avgRallyPct <= 0) return null;
  return (gainPct / avgRallyPct) * 100;
}

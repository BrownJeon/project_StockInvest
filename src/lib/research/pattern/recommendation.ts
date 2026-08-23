/**
 * 리서치 매수/매도 "고려" 추천 — T-033, 목표가 전면 재설계 T-034.
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
 * ## 🔴 T-034 — 목표가는 차트에서 나온다. 진입가는 쓰지 않는다.
 *
 * 이전 설계는 `targetPriceKRW = 진입가(또는 현재가) × (1 + 과거평균상승폭)` 이었다.
 * -18% 물린 종목에서 "현재가 대비 +49%" 같은 숫자가 나와 예측처럼 읽혔고, 사용자가 실화면에서
 * 이를 지적했다. 지금은 **목표가 산출이 `price-targets.ts`(캔들 전용 순수 함수)로 완전히
 * 분리**돼 있고 이 파일은 그 결과를 받아 쓰기만 한다.
 *
 * 이 파일 어디에도 `entryPrice` 를 목표가·기한 계산에 넣는 코드는 없다.
 * `gainPct`(진입가 대비 손익)만 **표시 전용**으로 남으며, KRW끼리만 계산한다
 * (`PriceTargets` 는 원통화라 절대 섞지 않는다 — `price-targets.ts` 헤더 참조).
 * 회귀 테스트가 "진입가를 바꿔도 매도 목표가·판정이 변하지 않는다"를 고정한다.
 *
 * ## 🔴 자동매매와 연결하지 않는다
 *
 * 이 모듈의 어떤 값도 `createSignal()` · `submitOrder()` · `src/lib/strategy/` 로 흘러가지
 * 않는다. 소비자는 **화면(ResearchTab)과 텔레그램 리포트뿐**이다. 이건 사용자가 직접 고른
 * 안전 경계이며 협상 대상이 아니다. 새 소비자를 붙일 때 이 문단을 먼저 읽을 것.
 *
 * ## 임계치의 지위
 *
 * 8건 / ×1.8 / ATR×1 은 **1차 휴리스틱이며 실증검증된 값이 아니다.**
 * 근거와 재검토 조건은 `docs/research-rally-cycle.md` 에 기록한다.
 */
import { PRECURSOR_NOTE, getRuleLabel } from './precursor-analysis';
import type { PrecursorRuleStat, PriceTargets } from '../types';

export type RecommendationAction = 'buy' | 'sell' | 'hold' | 'insufficient_data';

export type RecommendationConfidence = 'low' | 'medium' | 'high';

/** `buy` 조건을 만족했는데도 관망으로 내린 이유 — 화면이 사용자에게 그대로 설명한다. */
export type BuyDowngradeReason = 'no_support_level' | 'buy_zone_unreachable';

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
  /** 차트 게이트 때문에 buy → hold 로 내려간 경우에만 채워진다 */
  downgradeReason: BuyDowngradeReason | null;
  /** 과신 방지 고정 문구 — 표시 시 항상 함께 노출한다 */
  note: string;
}

export interface SellAssessment {
  action: 'sell' | 'hold' | 'insufficient_data';
  /**
   * 진입 후 경과 **달력일** — 🔴 **표시 전용이며 판정에 쓰지 않는다.**
   * 이 값이 들어오든 안 들어오든 `action`/`reason` 은 동일하다(회귀 테스트로 고정).
   */
  daysSinceEntry: number | null;
  /**
   * (현재가 - 진입가) / 진입가 * 100 — **사용자 참고용 표시 전용**.
   * 🔴 판정에도, 목표가 계산에도 쓰지 않는다. 두 값 모두 KRW 여야 한다.
   */
  gainPct: number | null;
  /** `target_reached` = 저항선 도달/돌파, `in_progress` = 아직 저항선 아래 */
  reason: 'target_reached' | 'in_progress' | null;
  /** 목표가 판단에 쓴 기한(달력일). 화면에 표시하는 숫자와 **같은 값**이다 */
  horizonDays: number | null;
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

/** 표본 크기 구간 → 신뢰도 라벨. 순수 휴리스틱이며 통계적 유의성 검정이 아니다. */
function confidenceFor(triggerCount: number): RecommendationConfidence {
  if (triggerCount >= 30) return 'high';
  if (triggerCount >= 15) return 'medium';
  return 'low';
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
    downgradeReason: null,
    note: PRECURSOR_NOTE,
  };
}

function buyFrom(
  action: BuyRecommendation['action'],
  rule: PrecursorRuleStat,
  confidence: RecommendationConfidence | null,
  downgradeReason: BuyDowngradeReason | null = null,
): BuyRecommendation {
  return {
    action,
    ruleId: rule.id,
    ruleLabel: rule.label || getRuleLabel(rule.id),
    precision: rule.precision,
    lift: rule.lift,
    triggerCount: rule.triggerCount,
    confidence,
    downgradeReason,
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
 * @param targets 차트 기반 목표가(T-034). 주어지면 **도달 가능성 게이트**가 추가로 걸린다 —
 *   기한 내 닿을 매수 희망가가 없으면 "얼마에 사라"고 말할 근거가 없으므로 `buy` 로 올리지
 *   않는다. 이것이 T-033 의 `MAX_TIMEFRAME_DAYS_FOR_BUY`(과거 평균 소요일 상한)를 대체한다.
 *   `targets` 자체가 없으면(구버전 행·캔들 부족) 게이트를 걸지 않는다 — 그때의 결핍은
 *   "너무 멀다"가 아니라 "모른다"이고, 둘을 같은 판정으로 뭉개지 않는다.
 */
export function evaluateBuySignal(
  todayActiveRuleIds: string[] | null | undefined,
  rules: PrecursorRuleStat[] | null | undefined,
  targets?: PriceTargets | null,
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
    return buyFrom('insufficient_data', best, null);
  }

  const top = [...candidates].sort((a, b) => (b.lift ?? -1) - (a.lift ?? -1))[0];
  const confidence = confidenceFor(top.triggerCount);
  if ((top.lift ?? 0) < MIN_LIFT_FOR_BUY) return buyFrom('hold', top, confidence);

  // 도달 가능성 게이트 — 근거 있는 매수 희망가가 없으면 매수를 권하지 않는다.
  if (targets) {
    if (targets.buyZone == null) return buyFrom('hold', top, confidence, 'no_support_level');
    if (targets.buyReachable !== true) return buyFrom('hold', top, confidence, 'buy_zone_unreachable');
  }
  return buyFrom('buy', top, confidence);
}

/**
 * `evaluateSellSignal` 의 **표시 전용** 포지션 정보.
 *
 * 🔴 이 객체의 어떤 값도 `action`/`reason` 에 영향을 주지 않는다. 그대로 반환값에 실려
 *    화면·리포트의 "정보 줄"이 될 뿐이다. 첫 인자(차트)만이 판정 입력이고 이 인자는 표시
 *    입력이라는 것을 **시그니처 자체로** 드러내려고 두 번째 인자로 분리했다.
 *    가격은 전부 KRW 다(`PriceTargets` 는 원통화이므로 절대 섞지 않는다).
 */
export interface SellPositionContext {
  /** 진입 후 경과 달력일 — 표시 전용 */
  daysSinceEntry?: number | null;
  entryPriceKRW?: number | null;
  currentPriceKRW?: number | null;
}

/**
 * 저항선 "근접"으로 볼 잔여 거리 = ATR14 × 이 배수.
 *
 * 새 자유 파라미터를 만들지 않으려고 이미 계산해 둔 ATR14(하루 평균 변동폭)에 묶었다 —
 * "저항선까지 남은 거리가 **하루치 변동폭 이내**면 사실상 닿은 것"이라는 해석이며,
 * 임의의 % 임계치보다 종목별 변동성에 자동으로 적응한다. 1차 휴리스틱이다.
 */
export const SELL_PROXIMITY_ATR_MULTIPLE = 1;

/**
 * 매도 추천 — **차트 기준 하나로만** 판정한다 (T-034, 기간초과 제거).
 *
 * 이건 손절 로직이 아니다. 실제 손절·트레일링은 `src/lib/strategy/` 의 exit 엔진이 담당하고
 * 이 값은 그 경로에 **전혀 닿지 않는다**.
 *
 * ## 🔴 사용자 포지션은 판정에 들어가지 않는다
 *
 * 진입가도, **진입일도** 쓰지 않는다. 초안에는 "보유일수 ≥ 기한이면 매도 고려(기간 초과)"가
 * 있었으나 폐기했다 — 진입일은 포지션 정보이고, 이번 작업의 대전제가 사용자 지시
 * *"분석은 사용자 포지션과 완전히 독립적이어야 한다"* 이므로 정면 충돌한다. 실제로 그 규칙은
 * **2주 넘게 보유한 종목 전부에서 상시 발화**했는데, 그 노이즈가 바로 충돌의 증상이었다.
 * 사용자가 "제거 — 순수 차트 기준으로만 판정"을 선택했다(2026-08-21).
 *
 * 판정:
 *  - `targets` 없음(캔들 부족·구버전 행) → `insufficient_data`
 *  - `sellTarget == null` → `sell / target_reached`.
 *    현재가 위에 저항 후보(볼린저 상단·직전 60거래일 고점·MA60)가 **하나도 없다**는 뜻이므로
 *    이미 관측 가능한 저항을 전부 넘어선 상태다.
 *  - `sellReachable !== true`(기한 내 도달 근거 없음·ATR 산출 불가) → `insufficient_data`.
 *    표시할 목표가가 없으면 판정도 하지 않는다 — 숫자도 판정도 만들어내지 않는다.
 *  - 저항선까지 남은 거리 ≤ ATR14 × `SELL_PROXIMITY_ATR_MULTIPLE` → `sell / target_reached`
 *  - 그 외 → `hold / in_progress`
 *
 * 🔴 도달 여부를 KRW 현재가가 아니라 **캔들 종가(`asOfPrice`, 목표가와 같은 통화)** 로만
 *    판정한다. KRW와 원통화를 비교하는 코드 경로를 아예 만들지 않기 위해서다.
 */
export function evaluateSellSignal(
  targets: PriceTargets | null | undefined,
  position?: SellPositionContext,
): SellAssessment {
  const note = PRECURSOR_NOTE;

  // ── 아래 두 값은 표시 전용이다. 이 함수의 분기 조건에 절대 등장하지 않는다. ──
  const rawDays = position?.daysSinceEntry;
  const daysSinceEntry = rawDays != null && Number.isFinite(rawDays) ? rawDays : null;
  const entry = position?.entryPriceKRW;
  const current = position?.currentPriceKRW;
  const gainPct =
    entry != null && Number.isFinite(entry) && entry > 0 &&
    current != null && Number.isFinite(current) && current > 0
      ? ((current - entry) / entry) * 100
      : null;

  const base = { daysSinceEntry, gainPct, note };

  if (!targets) {
    return { ...base, action: 'insufficient_data', reason: null, horizonDays: null };
  }

  const horizonDays = targets.horizonDays;

  // 위쪽 저항을 전부 넘어섰다 — 관측 사실이므로 "판단 보류"가 아니라 매도 고려다.
  if (targets.sellTarget == null) {
    return { ...base, action: 'sell', reason: 'target_reached', horizonDays };
  }

  // 기한 내 도달 근거가 없으면 목표가 숫자를 감추므로, 그 위에 판정을 얹지 않는다.
  // (이 분기를 지나면 `atr14`/`expectedMove` 는 non-null 이 보장된다 — reachable 계산의 전제)
  if (targets.sellReachable !== true) {
    return { ...base, action: 'insufficient_data', reason: null, horizonDays };
  }

  const distance = targets.sellTarget.price - targets.asOfPrice;
  const proximity = (targets.atr14 ?? 0) * SELL_PROXIMITY_ATR_MULTIPLE;
  if (distance <= proximity) {
    return { ...base, action: 'sell', reason: 'target_reached', horizonDays };
  }

  return { ...base, action: 'hold', reason: 'in_progress', horizonDays };
}

/**
 * 목표가가 **사용자 진입가 대비** 몇 %인지 — 표시 전용(판정에 쓰지 않는다).
 *
 * 🔴 통화 안전: 목표가·기준가는 캔들 통화(해외는 USD), 진입가·현재가는 KRW다.
 * 두 값을 직접 빼거나 나누면 통화가 섞인다. 대신 **같은 통화끼리의 비(ratio)** 두 개를 곱한다:
 *
 *   목표가/진입가 = (목표가/기준가) × (현재가/진입가)
 *                    └ 캔들 통화끼리      └ KRW 끼리
 *
 * 각 비는 무차원이라 곱해도 통화가 섞이지 않는다. 이렇게 해야 해외 종목에서도
 * "목표가에 팔면 내 진입가 대비 이득인가 손해인가"를 정확히 answer 할 수 있다.
 *
 * ⚠ 근사: 두 비의 기준 시점이 다르다(목표가·기준가는 분석 기준일 종가, 현재가는 실시간).
 * 장중 변동만큼 오차가 있으나 방향·대략의 크기 판단에는 충분하다.
 *
 * @param targetPrice   목표가 (캔들 통화)
 * @param asOfPrice     분석 기준일 종가 (캔들 통화)
 * @param gainPct       (현재가 - 진입가) / 진입가 × 100 — KRW 끼리 계산된 값
 * @returns 진입가 대비 % (양수면 진입가보다 높은 목표가). 계산 불가면 null
 */
export function targetVsEntryPct(
  targetPrice: number | null | undefined,
  asOfPrice: number | null | undefined,
  gainPct: number | null | undefined,
): number | null {
  if (targetPrice == null || !Number.isFinite(targetPrice) || targetPrice <= 0) return null;
  if (asOfPrice == null || !Number.isFinite(asOfPrice) || asOfPrice <= 0) return null;
  if (gainPct == null || !Number.isFinite(gainPct)) return null;
  const currentOverEntry = 1 + gainPct / 100;
  if (currentOverEntry <= 0) return null;          // 진입가 대비 -100% 이하 — 의미 없는 값
  const targetOverEntry = (targetPrice / asOfPrice) * currentOverEntry;
  return (targetOverEntry - 1) * 100;
}

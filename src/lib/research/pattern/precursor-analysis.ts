/**
 * 선행지표 hit-rate 분석 — T-032.
 *
 * 방법론은 **의도적으로 단순하다**: 후보 규칙별 단순 hit-rate 비교뿐이고 회귀분석·머신러닝은 없다.
 * p-value 같은 유의성 지표도 제공하지 않는다 — 표본이 작은 상황에서 과신을 유발하기 때문
 * (사용자가 명시적으로 "순수 통계만" 선택한 범위).
 *
 * 라벨: 랠리 이벤트의 trough를 양성으로 본다. 정확히 그 하루만 양성으로 잡으면 표본이
 * 사실상 0이 되므로 `labelToleranceDays`(기본 3거래일) 만큼 앞뒤로 확장한다.
 * 이 확장 폭은 결과에 항상 함께 노출해 해석 조건을 감춘다는 인상을 주지 않는다.
 *
 * `positiveDays`는 항상 노출하고, 임계치 미만이면 `lowSampleWarning:true`와 함께
 * "예측 규칙이 아니라 사후 관찰"이라는 고정 문구를 붙인다.
 */
import type { PrecursorAnalysis, PrecursorFeatures, PrecursorRuleStat } from '../types';

export interface PrecursorAnalysisConfig {
  /** trough 전후 며칠까지 양성으로 볼지 */
  labelToleranceDays: number;
  /** 이 값 미만이면 lowSampleWarning */
  minPositiveDays: number;
}

export const DEFAULT_PRECURSOR_ANALYSIS_CONFIG: PrecursorAnalysisConfig = {
  labelToleranceDays: 3,
  minPositiveDays: 5,
};

export const PRECURSOR_NOTE =
  '이 수치는 예측 규칙이 아니라 사후 관찰입니다. 과거 구간에서 규칙이 얼마나 자주 저점 근방에 걸렸는지를 셀 뿐이며, 향후 수익을 보장하지 않습니다.';

interface RuleDef {
  id: string;
  label: string;
  test: (f: PrecursorFeatures) => boolean;
}

/** 후보 규칙 — 전부 시점 t의 인과적 피처만 본다. */
const RULES: RuleDef[] = [
  { id: 'rsi_lt_30',        label: 'RSI14 < 30 (과매도)',        test: (f) => f.rsi14! < 30 },
  { id: 'rsi_lt_35',        label: 'RSI14 < 35',                  test: (f) => f.rsi14! < 35 },
  { id: 'bb_pctb_lt_010',   label: '볼린저 %B < 0.10 (하단 이탈)', test: (f) => f.bbPercentB! < 0.10 },
  { id: 'bb_pctb_lt_020',   label: '볼린저 %B < 0.20',            test: (f) => f.bbPercentB! < 0.20 },
  { id: 'drawdown_gt_15',   label: '누적낙폭 > 15%',              test: (f) => f.drawdownPct! > 15 },
  { id: 'drawdown_gt_25',   label: '누적낙폭 > 25%',              test: (f) => f.drawdownPct! > 25 },
  { id: 'volume_gt_1_5x',   label: '거래량 > 20일 평균 1.5배',    test: (f) => f.volumeRatio! > 1.5 },
  { id: 'atr_gt_4',         label: 'ATR% > 4 (변동성 확대)',      test: (f) => f.atrPct! > 4 },
  {
    id: 'rsi_lt_35_and_vol_gt_1_5x',
    label: 'RSI14 < 35 + 거래량 1.5배',
    test: (f) => f.rsi14! < 35 && f.volumeRatio! > 1.5,
  },
  {
    id: 'drawdown_gt_15_and_bb_lt_020',
    label: '누적낙폭 > 15% + %B < 0.20',
    test: (f) => f.drawdownPct! > 15 && f.bbPercentB! < 0.20,
  },
];

function isEvaluable(f: PrecursorFeatures): boolean {
  return (
    f.rsi14 != null &&
    f.atrPct != null &&
    f.bbPercentB != null &&
    f.drawdownPct != null &&
    f.volumeRatio != null
  );
}

/**
 * 특정 하루(대개 시계열의 마지막 캔들)에 **참이 된 규칙 id 목록** — T-033.
 *
 * `analyzePrecursors` 가 과거 전체를 집계하는 것과 달리, 이 함수는 시점 1개만 본다.
 * 매수 추천은 "오늘 걸린 규칙"과 "그 규칙의 과거 적중률"을 곱해서 만들어지는데, 앞쪽 절반이
 * 여기서 나온다. `RULES` 가 비export 라 이 파일 안에 둔다 — 다른 파일에서 규칙을 재정의하면
 * 화면과 리포트가 서로 다른 규칙 집합을 쓰게 된다.
 *
 * 🔴 **look-ahead bias 없음**: `PrecursorFeatures` 한 행만 받고, 그 행은
 * `computePrecursorSeries` 의 불변식상 `candles[0..t]` 에만 의존한다. 미래 캔들은 관여하지 않는다.
 *
 * 반환값의 세 상태를 구분한다:
 *  - `null`  — 피처가 없거나 계산 불가(지표 워밍업 구간 등). "평가하지 않았다"는 뜻.
 *  - `[]`    — 평가했고 **오늘 충족한 규칙이 하나도 없다**. 관측 결과이지 결측이 아니다.
 *  - `[...]` — 충족한 규칙 id 들. 순서는 `RULES` 정의 순서(안정적).
 */
export function getActiveRuleIds(features: PrecursorFeatures | null | undefined): string[] | null {
  if (!features || !isEvaluable(features)) return null;
  return RULES.filter((rule) => rule.test(features)).map((rule) => rule.id);
}

/** 규칙 id → 사람이 읽는 라벨. 저장된 id 만 있는 소비자(리포트·추천)가 라벨을 복원할 때 쓴다. */
export function getRuleLabel(ruleId: string): string | null {
  return RULES.find((r) => r.id === ruleId)?.label ?? null;
}

export function analyzePrecursors(
  features: PrecursorFeatures[],
  troughIndices: number[],
  config: Partial<PrecursorAnalysisConfig> = {},
): PrecursorAnalysis {
  const cfg = { ...DEFAULT_PRECURSOR_ANALYSIS_CONFIG, ...config };

  // 라벨 확장 — trough ± tolerance
  const positive = new Set<number>();
  for (const t of troughIndices) {
    for (let d = -cfg.labelToleranceDays; d <= cfg.labelToleranceDays; d++) {
      const idx = t + d;
      if (idx >= 0 && idx < features.length) positive.add(idx);
    }
  }

  const evaluable = features.filter(isEvaluable);
  const evaluatedDays = evaluable.length;
  const positiveDays = evaluable.filter((f) => positive.has(f.index)).length;
  const baseRate = evaluatedDays > 0 ? positiveDays / evaluatedDays : null;

  const rules: PrecursorRuleStat[] = RULES.map((rule) => {
    let triggerCount = 0;
    let hitCount = 0;
    for (const f of evaluable) {
      if (!rule.test(f)) continue;
      triggerCount++;
      if (positive.has(f.index)) hitCount++;
    }
    const precision = triggerCount > 0 ? hitCount / triggerCount : null;
    const lift = precision != null && baseRate != null && baseRate > 0 ? precision / baseRate : null;
    return { id: rule.id, label: rule.label, triggerCount, hitCount, precision, lift };
  });

  return {
    evaluatedDays,
    positiveDays,
    baseRate,
    labelToleranceDays: cfg.labelToleranceDays,
    lowSampleWarning: positiveDays < cfg.minPositiveDays,
    note: PRECURSOR_NOTE,
    rules,
  };
}

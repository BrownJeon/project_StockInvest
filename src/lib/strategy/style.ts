import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';

/**
 * 투자성향 단일화 (2026-05-09).
 * 기존 aggressive/neutral/stable 3개 프리셋 → DEFAULT_STYLE_CONFIG 단일 설정.
 * 개별 파라미터는 DB `style_default_<field>` 키로 override 가능.
 */

// ─── DB 동적 override 캐시 ─────────────────────────────────────────────────
// 키 형식: style_default_<camelCaseField>  예) style_default_minAiConfidence
// 1분 TTL. 캐시 miss 시 DB 조회. 코드 fallback 유지.
type OverrideCache = { value: Map<string, number>; ts: number };
let overrideCache: OverrideCache | null = null;
const OVERRIDE_TTL_MS = 60_000;

export interface StyleConfig {
  rsiBuyThreshold: number;
  rsiSellThreshold: number;
  rsiSellPriceMult: number;
  minProfitMargin: number;
  rebuyCooldownMin: number;
  minAiConfidence: number;
  minSellAiConfidence: number;
  atrStopMult: number;
  minRWinPct: number;
  universeSource: 'volume-top' | 'top50' | 'top200';
  btcEthCoreRatioMin: number;
  maxPositionsPerSymbol: number;
  holdingPeriodHours: { min: number; max: number };
  /** SI 전용 — 주식 보유기간 (days 단위) */
  holdingPeriodDays: { min: number; max: number };
  /** SI 전용 — 코어 주식 비율 최소치 */
  stableCoreRatioMin: number;
  targetProfitPct: number;
  limitChasePct: number;
  trailingActivatePct: number;
  trailingDrawdownPct: number;
  /** 트레일링 최소 하락폭 하한 (%). trailingDrawdownPct의 동적 조정 최솟값. SI 신규. */
  trailingDrawdownPct_min: number;
  /** 하드 손절 임계값 (%). avgEntry × (1 - hardStopPct/100) 도달 시 시장가 매도. SI 신규. */
  hardStopPct: number;
  /** 장마감 직전 손절 임계값 (%). KST 15:20~15:29 구간 -eodLossCutPct% 이상 손실 시 시장가 매도. SI 신규. */
  eodLossCutPct: number;
  /** 장마감 N분 전 신규 매수 차단 (분). 기본 30 → 15:00 이후 buy 시그널 prefilter skip. SI 신규. */
  lateSessionBuyBlockMin: number;
  /** 모멘텀 추격 가드 — 직전 5봉 누적 상승률 %. 초과 시 추격 룰(volume-spike/price-breakout) 발화 차단. SI 신규. */
  momentumChaseMaxPct: number;

  // ── 비용 모델 (T-003 §3, Phase 2 Step 4) ────────────────────────────────
  // 구조: 하드코딩 0.43%(코인원 0.2%×2 이식 잔재)를 **명시 비용 / 슬리피지로 분리**한다.
  // 하나로 뭉쳐 두면 "수수료가 비싼 건지 체결이 나쁜 건지"를 사후에 구분할 수 없고,
  // 증권사 요율 변경과 체결 품질 변화를 따로 조정할 수도 없다.
  /**
   * 명시 왕복 비용 % — 위탁수수료(0.0140527%×2 ≈ 0.028%) + 매도 제세금 0.15% ≈ **0.18%**.
   * 실계좌 요율이 다르면 DB override 로 조정한다.
   */
  feePct: number;
  /** 왕복 슬리피지·스프레드 % — 대형주 지정가 기준 0.10~0.20%, 기본 0.15%. */
  slippagePct: number;

  // ── 룰 파라미터 (백테스트 미완료 → 코드 default 유지, 운영값은 DB override) ──
  /** pullback-trend RSI 눌림 창 하단 */
  pullbackRsiMin: number;
  /** pullback-trend RSI 눌림 창 상단 */
  pullbackRsiMax: number;
  /** bb-squeeze-expansion 상단 돌파 시 요구 거래량비 하한 */
  bbSqueezeVolRatioMin: number;
}

/**
 * 실효 왕복 비용 % (명시 + 슬리피지).
 *
 * **EV 하한 (§3)**: `p×T − (1−p)×S − C > 0`. C=0.33%, hardStop S=1.5% 기준
 * 목표익 T=2.5% 이면 승률 p ≥ 46.3% 가 필요하고, p=50% 를 가정해도 **T ≥ 1.85%** 다.
 * → `targetProfitPct` 를 1.85% 밑으로 낮추는 튜닝은 비용 구조상 금지선이다.
 */
export function roundTripCostPct(style: Pick<StyleConfig, 'feePct' | 'slippagePct'>): number {
  return style.feePct + style.slippagePct;
}

/** 단일 기본 설정 — 기존 aggressive 기준으로 통합 (SI 고유 필드 포함) */
export const DEFAULT_STYLE_CONFIG: StyleConfig = {
  rsiBuyThreshold:     35,   // 45→35: 주식 변동성 낮음 — 더 과매도 구간에서만 진입
  rsiSellThreshold:    55,
  rsiSellPriceMult:    1.00,
  minProfitMargin:     0.003,
  rebuyCooldownMin:    5,
  minAiConfidence:     35,
  minSellAiConfidence: 35,   // 30→35: 손실 중 매도 통과율 강화 (매도 기회 놓치지 않도록)
  atrStopMult:         2.0,
  minRWinPct:          0.7,
  universeSource:      'volume-top',
  btcEthCoreRatioMin:  0.05,
  // T-068 WP-B: 5→4 (사용자 확정 '분할 최대 4회'). 국내 룰 엔진 24시간 내 동일 종목 매수 건수 한도 — portfolio-stability 가
  // 24h 실주문 BUY 가 이 수에 이르면 다음 국내 자동 BUY 를 거른다(해외는 이 가드가 통과시킨다). 시나리오 확정 경로에는 적용되지
  // 않음 — 그쪽 분할 상한은 `MAX_SCENARIO_SPLITS`(safety/scenario-confirm-fields.ts).
  // DB `style_default_maxPositionsPerSymbol` 이 있으면 그 값이 우선한다(아래 getStyleConfig).
  maxPositionsPerSymbol: 4,
  holdingPeriodHours:  { min: 1, max: 48 },
  holdingPeriodDays:   { min: 1, max: 10 },  // SI 주식: 1~10일
  stableCoreRatioMin:  0.20,                  // SI: 코어 비율 20%
  targetProfitPct:     2.5,   // 1.5→2.5: 손익비 2:1 이상 확보 (수수료 0.43% 왕복 감안)
  limitChasePct:       0.005,
  trailingActivatePct: 2.5,
  trailingDrawdownPct: 1.5,
  trailingDrawdownPct_min: 1.5,  // SI 신규: 트레일링 최소 하락폭 하한
  // SI 신규 — DEFAULT는 보수적 값. 실제 운영값은 system_config style_default_* 로 override.
  // (백테스트 미완료 파라미터는 사용자 가이드대로 코드 default 변경 없이 DB로만 적용)
  hardStopPct:           1.5,
  eodLossCutPct:         1.5,
  lateSessionBuyBlockMin: 30,
  momentumChaseMaxPct:    5.0,
  // 비용 모델 — 실측 근거(§3): 위탁수수료 0.0140527%×2 + 매도 제세금 0.15% ≈ 0.178%
  feePct:                0.18,
  slippagePct:           0.15,
  // 룰 파라미터 — **코드 default 는 현행 값 그대로 둔다.**
  // 백테스트로 검증되지 않은 파라미터는 코드 default 를 바꾸지 않고 DB override 로만 적용한다는
  // 기존 가이드를 따른다. 운영 적용값(40 / 50 / 1.2)은 db.ts 의 style_default_* 시드에 있고,
  // 롤백은 그 키를 지우기만 하면 된다.
  pullbackRsiMin:        42,
  pullbackRsiMax:        48,
  bbSqueezeVolRatioMin:  0.7,
};

/** number 타입 StyleConfig 필드 목록 — override 허용. */
const NUMERIC_FIELDS: Array<keyof StyleConfig> = [
  'rsiBuyThreshold', 'rsiSellThreshold', 'rsiSellPriceMult',
  'minProfitMargin', 'rebuyCooldownMin',
  'minAiConfidence', 'minSellAiConfidence',
  'atrStopMult', 'minRWinPct',
  'btcEthCoreRatioMin', 'maxPositionsPerSymbol',
  'targetProfitPct', 'limitChasePct',
  'trailingActivatePct', 'trailingDrawdownPct', 'trailingDrawdownPct_min',
  'hardStopPct', 'eodLossCutPct', 'lateSessionBuyBlockMin', 'momentumChaseMaxPct',
  'feePct', 'slippagePct',
  'pullbackRsiMin', 'pullbackRsiMax', 'bbSqueezeVolRatioMin',
];

const FIELD_RANGES: Partial<Record<keyof StyleConfig, [number, number]>> = {
  minAiConfidence:      [10, 100],
  minSellAiConfidence:  [0,  100],
  atrStopMult:          [0.5, 10],
  trailingActivatePct:  [0.5, 20],
  trailingDrawdownPct:      [0.2, 15],
  trailingDrawdownPct_min:  [0.2, 15],
  rebuyCooldownMin:     [1,   1440],
  btcEthCoreRatioMin:   [0,   1],
  maxPositionsPerSymbol:[1,   20],
  hardStopPct:          [0.3, 10],
  eodLossCutPct:        [0.3, 10],
  lateSessionBuyBlockMin: [0,  120],
  momentumChaseMaxPct:  [1,   30],
  // 비용은 0 이 될 수 없다 — 0 을 허용하면 EV 계산이 무료 거래를 가정하게 된다.
  feePct:               [0.01, 2],
  slippagePct:          [0.01, 2],
  pullbackRsiMin:       [20,  60],
  pullbackRsiMax:       [25,  70],
  bbSqueezeVolRatioMin: [0.1,  5],
};

function inRange(field: keyof StyleConfig, val: number): boolean {
  const range = FIELD_RANGES[field];
  if (!range) return true;
  return val >= range[0] && val <= range[1];
}

async function loadStyleOverrides(): Promise<Map<string, number>> {
  if (overrideCache && Date.now() - overrideCache.ts < OVERRIDE_TTL_MS) {
    return overrideCache.value;
  }
  const map = new Map<string, number>();
  try {
    const pool = getPool();
    // style_default_* 키 + 하위 호환: style_aggressive_* 도 읽음 (deprecated)
    const [rows] = await pool.query<(RowDataPacket & { key: string; value: string })[]>(
      "SELECT `key`, value FROM system_config WHERE `key` LIKE 'style_%'",
    );
    for (const r of rows) {
      const n = Number(JSON.parse(r.value));
      if (Number.isFinite(n)) map.set(r.key, n);
    }
  } catch { /* fallback to code default */ }
  overrideCache = { value: map, ts: Date.now() };
  return map;
}

/** 동적 override 캐시 강제 만료 (적용 직후 호출) */
export function invalidateStyleOverrideCache(): void {
  overrideCache = null;
}

/**
 * 단일 스타일 설정 반환. DB `style_default_<field>` 키가 있으면 해당 필드만 override.
 * 하위 호환: `style_aggressive_<field>` 도 읽음 (기존 DB 키 재활용).
 */
export async function getStyleConfig(): Promise<StyleConfig> {
  const base = { ...DEFAULT_STYLE_CONFIG };
  try {
    const overrides = await loadStyleOverrides();
    for (const field of NUMERIC_FIELDS) {
      // style_default_* 우선, 없으면 style_aggressive_* fallback (하위 호환)
      const raw = overrides.get(`style_default_${field}`) ?? overrides.get(`style_aggressive_${field}`);
      if (raw !== undefined && inRange(field, raw)) {
        (base as Record<string, unknown>)[field] = raw;
      }
    }
    const maxRaw = overrides.get('style_default_holdingPeriodHoursMax')
                ?? overrides.get('style_aggressive_holdingPeriodHoursMax');
    if (maxRaw !== undefined && maxRaw >= 1 && maxRaw <= 8760) {
      base.holdingPeriodHours = { ...base.holdingPeriodHours, max: maxRaw };
    }
  } catch { /* fallback to code default */ }

  // override 로 눌림 창이 뒤집히면(min ≥ max) 룰이 조용히 영구 미발화가 된다 —
  // market-state 데드락과 같은 종류의 사고다. 둘 다 코드 default 로 되돌린다.
  if (base.pullbackRsiMin >= base.pullbackRsiMax) {
    console.warn(
      `[style] pullbackRsiMin(${base.pullbackRsiMin}) ≥ pullbackRsiMax(${base.pullbackRsiMax}) — ` +
      `창이 공집합이라 코드 기본값으로 되돌립니다.`,
    );
    base.pullbackRsiMin = DEFAULT_STYLE_CONFIG.pullbackRsiMin;
    base.pullbackRsiMax = DEFAULT_STYLE_CONFIG.pullbackRsiMax;
  }
  return base;
}

// ─── 하위 호환 (deprecated) ───────────────────────────────────────────────
/**
 * @deprecated 투자성향 단일화(2026-05-09) — 파라미터는 `getStyleConfig()` 가 진실이다.
 * 이 타입은 이제 **LLM 프롬프트 문구용 라벨**로만 남아 있다 (chat / post-market AI).
 */
export type AnalystStyle = 'aggressive';
/** @deprecated 투자성향 단일화 — getStyleConfig() 로 교체됨 */
export const STYLE_PRESETS: Record<string, StyleConfig> = { aggressive: DEFAULT_STYLE_CONFIG };

/**
 * LLM 프롬프트에 표기할 성향 라벨.
 *
 * ⚠️ D3 (T-003) — 구 `getAnalystStyle()` 은 **항상 'aggressive' 를 반환하는 async 함수**였는데,
 *    엔진이 그 값을 `FIND_IN_SET(style, applicable_styles)` 에 넣어 **룰 선별에 썼다.**
 *    그래서 ma-cross·weekly-trend-follow·dividend-quality·inside-bar 4종이 영구 제외됐다
 *    (사망 원인 #3). 이제 룰 선별은 오직 `strategies.enabled` 가 정하며, 이 라벨은
 *    프롬프트 문구 외에는 **어떤 실행 경로에도 관여하지 않는다.**
 */
export const ANALYST_STYLE_LABEL: AnalystStyle = 'aggressive';

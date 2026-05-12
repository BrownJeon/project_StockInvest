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
  /** 하드 손절 임계값 (%). avgEntry × (1 - hardStopPct/100) 도달 시 시장가 매도. SI 신규. */
  hardStopPct: number;
  /** 장마감 직전 손절 임계값 (%). KST 15:20~15:29 구간 -eodLossCutPct% 이상 손실 시 시장가 매도. SI 신규. */
  eodLossCutPct: number;
  /** 장마감 N분 전 신규 매수 차단 (분). 기본 30 → 15:00 이후 buy 시그널 prefilter skip. SI 신규. */
  lateSessionBuyBlockMin: number;
  /** 모멘텀 추격 가드 — 직전 5봉 누적 상승률 %. 초과 시 추격 룰(volume-spike/price-breakout) 발화 차단. SI 신규. */
  momentumChaseMaxPct: number;
}

/** 단일 기본 설정 — 기존 aggressive 기준으로 통합 (SI 고유 필드 포함) */
export const DEFAULT_STYLE_CONFIG: StyleConfig = {
  rsiBuyThreshold:     45,
  rsiSellThreshold:    55,
  rsiSellPriceMult:    1.00,
  minProfitMargin:     0.003,
  rebuyCooldownMin:    5,
  minAiConfidence:     35,
  minSellAiConfidence: 30,
  atrStopMult:         2.0,
  minRWinPct:          0.7,
  universeSource:      'volume-top',
  btcEthCoreRatioMin:  0.05,
  maxPositionsPerSymbol: 5,
  holdingPeriodHours:  { min: 1, max: 48 },
  holdingPeriodDays:   { min: 1, max: 10 },  // SI 주식: 1~10일
  stableCoreRatioMin:  0.20,                  // SI: 코어 비율 20%
  targetProfitPct:     1.5,
  limitChasePct:       0.005,
  trailingActivatePct: 2.5,
  trailingDrawdownPct: 1.5,
  // SI 신규 — DEFAULT는 보수적 값. 실제 운영값은 system_config style_default_* 로 override.
  // (백테스트 미완료 파라미터는 사용자 가이드대로 코드 default 변경 없이 DB로만 적용)
  hardStopPct:           1.5,
  eodLossCutPct:         1.5,
  lateSessionBuyBlockMin: 30,
  momentumChaseMaxPct:    5.0,
};

/** number 타입 StyleConfig 필드 목록 — override 허용. */
const NUMERIC_FIELDS: Array<keyof StyleConfig> = [
  'rsiBuyThreshold', 'rsiSellThreshold', 'rsiSellPriceMult',
  'minProfitMargin', 'rebuyCooldownMin',
  'minAiConfidence', 'minSellAiConfidence',
  'atrStopMult', 'minRWinPct',
  'btcEthCoreRatioMin', 'maxPositionsPerSymbol',
  'targetProfitPct', 'limitChasePct',
  'trailingActivatePct', 'trailingDrawdownPct',
  'hardStopPct', 'eodLossCutPct', 'lateSessionBuyBlockMin', 'momentumChaseMaxPct',
];

const FIELD_RANGES: Partial<Record<keyof StyleConfig, [number, number]>> = {
  minAiConfidence:      [10, 100],
  minSellAiConfidence:  [0,  100],
  atrStopMult:          [0.5, 10],
  trailingActivatePct:  [0.5, 20],
  trailingDrawdownPct:  [0.2, 15],
  rebuyCooldownMin:     [1,   1440],
  btcEthCoreRatioMin:   [0,   1],
  maxPositionsPerSymbol:[1,   20],
  hardStopPct:          [0.3, 10],
  eodLossCutPct:        [0.3, 10],
  lateSessionBuyBlockMin: [0,  120],
  momentumChaseMaxPct:  [1,   30],
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
  return base;
}

// ─── 하위 호환 (deprecated) — 호출부 마이그레이션 전 임시 유지 ─────────────
/** @deprecated 투자성향 단일화 — getStyleConfig() 로 교체됨 */
export type AnalystStyle = 'aggressive';
/** @deprecated 투자성향 단일화 — getStyleConfig() 로 교체됨 */
export const STYLE_PRESETS: Record<string, StyleConfig> = { aggressive: DEFAULT_STYLE_CONFIG };
/** @deprecated 투자성향 단일화 — getStyleConfig() 로 교체됨 */
export async function getAnalystStyle(): Promise<AnalystStyle> { return 'aggressive'; }

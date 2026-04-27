import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';

export type AnalystStyle = 'aggressive' | 'neutral' | 'stable';

export interface StyleConfig {
  rsiBuyThreshold: number;
  rsiSellThreshold: number;
  rsiSellPriceMult: number;
  /** AI EV floor 가이드 (hard block 아님). 한국 주식 왕복 수수료+세금 0.43% 흡수해야 함. */
  minProfitMargin: number;
  rebuyCooldownMin: number;
  minAiConfidence: number;
  /** 손절 거리를 ATR 배수로 명시 (룰·AI 공유 기준) */
  atrStopMult: number;
  /** AI EV 계산 시 최소 기대 R_win % (floor 가이드) */
  minRWinPct: number;
  /** 보유 기간 가이드 (분석가 R_win 추정 시 시간 척도 명시) */
  holdingPeriodDays: { min: number; max: number };
  /** 평균 목표 수익률 % (정상 R_win 추정의 가이드) */
  targetProfitPct: number;
  /** universe 종목 풀 소스 — Phase B에서 코드 분기 적용 */
  universeSource: 'volume-top' | 'kospi200' | 'kospi100';
  /** 포트폴리오 내 안정 코어(KOSPI 100) 최소 비율 — Phase C 가드용 */
  stableCoreRatioMin: number;
  /** 종목당 동시 진입 한도 — Phase B/C에서 가드 적용 */
  maxPositionsPerSymbol: number;
}

export const STYLE_PRESETS: Record<AnalystStyle, StyleConfig> = {
  aggressive: {
    // 단기 1~4일 보유, 회전율 ↑, 수수료+세금 0.43% 흡수
    rsiBuyThreshold:  45,     // 반등 포착 윈도우 확대
    rsiSellThreshold: 55,     // 조기 이익실현 허용
    rsiSellPriceMult: 1.00,   // 매도 차단 해제
    minProfitMargin:  0.006,  // 수수료 0.43% + 슬리피지 0.15% 흡수 후 순익 floor
    rebuyCooldownMin: 60,     // 한국장 1시간 쿨다운 (장중 6.5h 기준 1일 5~6회)
    minAiConfidence:  50,     // 수수료 큰 주식이라 더 신중
    atrStopMult:      1.0,    // 빠른 손절 (단기 회전 전제)
    minRWinPct:       1.5,    // 1~4일 내 도달 가능 목표
    holdingPeriodDays: { min: 1, max: 4 },
    targetProfitPct: 2.0,
    universeSource:    'volume-top',
    stableCoreRatioMin: 0.20,
    maxPositionsPerSymbol: 3,
  },
  neutral: {
    // 중단기 2주~1달 보유, KOSPI 200 종목 기반
    rsiBuyThreshold:  40,
    rsiSellThreshold: 60,
    rsiSellPriceMult: 1.005,
    minProfitMargin:  0.020,
    rebuyCooldownMin: 240,    // 4시간 쿨다운 (1일 1~2회)
    minAiConfidence:  60,
    atrStopMult:      1.8,
    minRWinPct:       3.0,
    holdingPeriodDays: { min: 14, max: 30 },
    targetProfitPct: 5.0,
    universeSource:    'kospi200',
    stableCoreRatioMin: 0.40,
    maxPositionsPerSymbol: 2,
  },
  stable: {
    // 장기 3~6개월 보유, KOSPI 100 안정 코어 위주
    rsiBuyThreshold:  30,
    rsiSellThreshold: 70,
    rsiSellPriceMult: 1.01,
    minProfitMargin:  0.040,
    rebuyCooldownMin: 1440,   // 1일 쿨다운 (장기 보유 가정)
    minAiConfidence:  75,
    atrStopMult:      2.5,    // 장기 변동성 흡수
    minRWinPct:       6.0,
    holdingPeriodDays: { min: 90, max: 180 },
    targetProfitPct: 10.0,
    universeSource:    'kospi100',
    stableCoreRatioMin: 0.70,
    maxPositionsPerSymbol: 1,
  },
};

export async function getAnalystStyle(): Promise<AnalystStyle> {
  try {
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT value FROM system_config WHERE `key` = 'analyst_style' LIMIT 1",
    );
    if (rows.length > 0) {
      const raw = rows[0].value;
      const v: string = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (v === 'aggressive' || v === 'stable') return v;
    }
  } catch { /* fall through */ }
  return 'neutral';
}

export function getStyleConfig(style: AnalystStyle): StyleConfig {
  return STYLE_PRESETS[style];
}

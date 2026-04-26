import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';

export type AnalystStyle = 'aggressive' | 'neutral' | 'stable';

export interface StyleConfig {
  rsiBuyThreshold: number;
  rsiSellThreshold: number;
  rsiSellPriceMult: number;
  minProfitMargin: number;
  rebuyCooldownMin: number;
  minAiConfidence: number;
  /** 손절 거리를 ATR 배수로 명시 (룰·AI 공유 기준) */
  atrStopMult: number;
  /** AI EV 계산 시 최소 기대 R_win % (floor 가이드) */
  minRWinPct: number;
}

export const STYLE_PRESETS: Record<AnalystStyle, StyleConfig> = {
  aggressive: {
    rsiBuyThreshold:  45,     // 반등 포착 윈도우 확대
    rsiSellThreshold: 55,     // 조기 이익실현 허용
    rsiSellPriceMult: 1.00,   // 매도 차단 해제 (과거 1.01이 주범)
    minProfitMargin:  0.003,  // AI EV floor 가이드 (hard block 아님)
    rebuyCooldownMin: 10,     // 회전율 극대화
    minAiConfidence:  45,     // 경계 케이스 승인 허용
    atrStopMult:      1.0,
    minRWinPct:       0.7,
  },
  neutral: {
    rsiBuyThreshold:  35,
    rsiSellThreshold: 65,
    rsiSellPriceMult: 1.01,
    minProfitMargin:  0.0025,
    rebuyCooldownMin: 30,
    minAiConfidence:  55,
    atrStopMult:      1.5,
    minRWinPct:       1.0,
  },
  stable: {
    rsiBuyThreshold:  28,
    rsiSellThreshold: 72,
    rsiSellPriceMult: 1.02,
    minProfitMargin:  0.004,
    rebuyCooldownMin: 60,
    minAiConfidence:  70,
    atrStopMult:      2.0,
    minRWinPct:       1.5,
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

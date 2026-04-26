import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import type { AnalystStyle } from './style';
import type { AiEvEstimate, MarketSummary, SkipCategory } from './ai-filter';

export interface DedupKey {
  symbol: string;
  strategyId: string;
  side: 'buy' | 'sell';
  regime: string;
}

export interface DedupHit {
  hit: boolean;
  prev?: {
    confidence: number;
    reasoning: string;
    skipCategory: SkipCategory;
    ev?: AiEvEstimate;
    warnings?: string[];
  };
}

/**
 * 지표 상태를 이산 버킷으로 환산. 같은 버킷 내에서는 AI 결정이 반복될 것으로 가정하고 캐시 재사용.
 * 5개 지표 조합 (RSI × EMA × vol × ATR × price5) 으로 촘촘하게 구성 — 상태 변화하면 bucket이 바뀌어 hit 안 됨.
 */
export function buildRegimeBucket(summary: MarketSummary): string {
  const rsi = summary.rsi14;
  const rsiBucket =
    rsi == null ? 'na' :
    rsi < 30 ? 'os'   :   // oversold
    rsi < 45 ? 'low'  :
    rsi < 55 ? 'mid'  :
    rsi < 70 ? 'hi'   :
               'ob';     // overbought

  const ema20 = summary.ema20;
  const ema60 = summary.ema60;
  const emaBucket =
    ema20 == null || ema60 == null ? 'na' :
    ema20 > ema60 * 1.002 ? 'up' :
    ema20 < ema60 * 0.998 ? 'dn' :
                            'fl';

  const vr = summary.volumeRatio;
  const volBucket =
    vr >= 1.5 ? 'hi'  :
    vr >= 0.7 ? 'mid' :
                'low';

  const atrPct =
    summary.atr14 != null && summary.currentPrice > 0
      ? (summary.atr14 / summary.currentPrice) * 100
      : null;
  const atrBucket =
    atrPct == null ? 'na' :
    atrPct >= 5 ? 'hi'  :
    atrPct >= 2 ? 'mid' :
                  'low';

  const p5 = summary.priceChange5;
  const p5Bucket =
    p5 > 3  ? 'up' :
    p5 < -3 ? 'dn' :
              'fl';

  return `rsi${rsiBucket}_ema${emaBucket}_vol${volBucket}_atr${atrBucket}_p5${p5Bucket}`;
}

function ttlMinutesFor(analystStyle: AnalystStyle): number {
  return analystStyle === 'aggressive' ? 15 : 30;
}

interface SignalRow extends RowDataPacket {
  reasoning: string;
  indicators: string | null;
}

/**
 * 최근 TTL 분 내 같은 (symbol, strategyId, side, regimeBucket) 의 ai_skipped 조회.
 * hit이면 이전 reasoning/confidence를 재사용 — CLI 호출 없이 스킵.
 */
export async function lookupRecentSkip(
  key: DedupKey,
  analystStyle: AnalystStyle,
): Promise<DedupHit> {
  const ttl = ttlMinutesFor(analystStyle);
  const pool = getPool();

  try {
    const [rows] = await pool.query<SignalRow[]>(
      `SELECT reasoning, indicators FROM signals
       WHERE symbol = ? AND strategy_id = ? AND side = ?
         AND status = 'ai_skipped'
         AND created_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)
         AND JSON_EXTRACT(indicators, '$.ai.regimeBucket') = ?
         AND JSON_EXTRACT(indicators, '$.ai.skipCategory') IN ('ai_rejected', 'ai_low_confidence')
       ORDER BY created_at DESC LIMIT 1`,
      [key.symbol, key.strategyId, key.side, ttl, key.regime],
    );
    if (rows.length === 0) return { hit: false };

    const row = rows[0];
    let ai: { confidence?: number; skipCategory?: SkipCategory; ev?: AiEvEstimate; warnings?: string[] } = {};
    try {
      const parsed = typeof row.indicators === 'string' ? JSON.parse(row.indicators) : row.indicators ?? {};
      ai = (parsed.ai ?? {}) as typeof ai;
    } catch {
      // fall through
    }

    return {
      hit: true,
      prev: {
        confidence: ai.confidence ?? 0,
        reasoning: row.reasoning ?? '',
        skipCategory: ai.skipCategory ?? 'ai_rejected',
        ev: ai.ev,
        warnings: ai.warnings,
      },
    };
  } catch (e) {
    console.error('[dedup] lookup 실패:', e);
    return { hit: false };
  }
}

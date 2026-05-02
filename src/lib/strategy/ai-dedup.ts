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
 *
 * 정책 (2026-04-28): RSI/ATR/Price5 변수 변동성 때문에 5변수 매트릭스의 hit율이 매우 낮음
 *  → **핵심 3변수만 사용** (RSI · EMA · Volume). ATR%·priceChange5는 RSI/EMA에 강하게 상관 있어 정보 추가량 미미.
 *  → RSI 5단계 → 3단계로 양자화 단순화 (low/mid/hi).
 *
 * 효과: 같은 종목·룰의 11분 간격 반복 발화가 hit으로 잡혀 AI 호출 절감 + 사용자 노이즈 감소.
 */
export function buildRegimeBucket(summary: MarketSummary): string {
  const rsi = summary.rsi14;
  const rsiBucket =
    rsi == null  ? 'na'  :
    rsi < 40     ? 'low' :   // 매수 영역 (과매도 포함)
    rsi < 60     ? 'mid' :   // 중립 영역
                   'hi';     // 매도 영역 (과매수 포함)

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

  return `rsi${rsiBucket}_ema${emaBucket}_vol${volBucket}`;
}

function ttlMinutesFor(analystStyle: AnalystStyle): number {
  // 2026-05-01 — VOO/SCHD 등 평균 80분 간격 반복 발화 차단을 위해 TTL 추가 강화 (60→180 / 120→360).
  // 보유기간 대비 dedup TTL 비율: aggressive 1~4일×5%=3h / neutral·stable 14일+×<3%=6h.
  if (analystStyle === 'aggressive') return 180;  // 3h
  return 360;                                       // 6h (neutral/stable 공통)
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

interface RegimeStatRow extends RowDataPacket {
  cnt: number;
  wins: number;
  avg_ev: number | null;
}

/**
 * 동일 regime bucket에서 과거 N일간 누적 성과 조회.
 *  - 분모: signals.price_1h_after가 채워진 자동승인 시그널 수 (followup은 signals 컬럼)
 *  - wins: price_1h_after가 진입가보다 매수면 +, 매도면 -로 유리한 방향 변화 한 건
 *  - avg_ev: indicators.ai.ev.evPct 평균
 * 응답 5건 미만이면 통계적 유의미 부족 → null 반환.
 */
export async function getRegimePerformance(
  regimeBucket: string,
  days = 30,
): Promise<{ count: number; winRate: number; avgEvPct: number } | null> {
  if (!regimeBucket) return null;
  try {
    const pool = getPool();
    const [rows] = await pool.query<RegimeStatRow[]>(
      `SELECT
         COUNT(*) AS cnt,
         SUM(
           CASE
             WHEN s.price_1h_after IS NULL THEN 0
             WHEN s.side = 'buy'  AND s.price_1h_after > s.price THEN 1
             WHEN s.side = 'sell' AND s.price_1h_after < s.price THEN 1
             ELSE 0
           END
         ) AS wins,
         AVG(CAST(JSON_EXTRACT(s.indicators, '$.ai.ev.evPct') AS DECIMAL(8,4))) AS avg_ev
       FROM signals s
       WHERE s.status IN ('auto_submitted','approved','executed','accepted')
         AND s.created_at > DATE_SUB(NOW(), INTERVAL ? DAY)
         AND JSON_EXTRACT(s.indicators, '$.ai.regimeBucket') = ?
         AND s.price_1h_after IS NOT NULL`,
      [days, regimeBucket],
    );
    const r = rows[0];
    if (!r || Number(r.cnt) < 5) return null;
    const count = Number(r.cnt);
    const winRate = count > 0 ? Number(r.wins) / count : 0;
    const avgEvPct = r.avg_ev != null ? Number(r.avg_ev) : 0;
    return { count, winRate, avgEvPct };
  } catch {
    return null;
  }
}

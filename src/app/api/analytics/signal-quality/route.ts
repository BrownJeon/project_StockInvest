import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * 신호 품질 통계 API — 타임프레임 변경 전후 노이즈 점검용.
 *
 * 주요 지표:
 *  - 전략별 AI 승인율: 낮을수록 노이즈가 많거나 AI가 너무 보수적
 *  - 시간대별 후보 발생 추이: 특정 시간대에 집중되는지 확인
 *  - 심볼별 연속 스킵 수: 같은 심볼이 계속 스킵되면 universe 재검토 필요
 *
 * 사용법:
 *   GET /api/analytics/signal-quality          → 최근 24h
 *   GET /api/analytics/signal-quality?hours=48 → 최근 48h
 */
export async function GET(req: NextRequest) {
  const hours = Math.min(Number(req.nextUrl.searchParams.get('hours') ?? 24), 168);
  const pool  = getPool();

  const [byStrategy, bySymbol, hourly, consecutive, skipCategories, byReason, repeatFires, bySide, byPrefilterReason] = await Promise.all([
    // 전략별 승인율
    pool.query<RowDataPacket[]>(`
      SELECT
        strategy_id,
        COUNT(*)                                                              AS total,
        SUM(status != 'ai_skipped')                                           AS approved,
        SUM(status  = 'ai_skipped')                                           AS skipped,
        ROUND(100 * SUM(status != 'ai_skipped') / COUNT(*), 1)               AS approval_rate
      FROM signals
      WHERE created_at > DATE_SUB(NOW(), INTERVAL ? HOUR)
      GROUP BY strategy_id
      ORDER BY approval_rate DESC
    `, [hours]),

    // 심볼별 승인율 (총 후보 10건 이상인 심볼만)
    pool.query<RowDataPacket[]>(`
      SELECT
        symbol,
        COUNT(*)                                                              AS total,
        SUM(status != 'ai_skipped')                                           AS approved,
        SUM(status  = 'ai_skipped')                                           AS skipped,
        ROUND(100 * SUM(status != 'ai_skipped') / COUNT(*), 1)               AS approval_rate
      FROM signals
      WHERE created_at > DATE_SUB(NOW(), INTERVAL ? HOUR)
      GROUP BY symbol
      HAVING total >= 5
      ORDER BY approval_rate DESC
    `, [hours]),

    // 시간대별 후보 발생 수 (KST 기준)
    pool.query<RowDataPacket[]>(`
      SELECT
        DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+09:00'), '%m-%d %H:00') AS hour_kst,
        COUNT(*)                                                                AS total,
        SUM(status != 'ai_skipped')                                             AS approved,
        SUM(status  = 'ai_skipped')                                             AS skipped
      FROM signals
      WHERE created_at > DATE_SUB(NOW(), INTERVAL ? HOUR)
      GROUP BY hour_kst
      ORDER BY hour_kst DESC
      LIMIT 48
    `, [hours]),

    // 심볼별 연속 스킵 — 최근 20건이 전부 스킵인 심볼 (잠재적 거래정지/관리종목)
    pool.query<RowDataPacket[]>(`
      SELECT symbol, COUNT(*) AS consecutive_skips
      FROM (
        SELECT symbol
        FROM signals
        WHERE created_at > DATE_SUB(NOW(), INTERVAL ? HOUR)
          AND status = 'ai_skipped'
        GROUP BY symbol
        HAVING COUNT(*) >= 10
      ) t
      GROUP BY symbol
      ORDER BY consecutive_skips DESC
    `, [hours]),

    // 스킵 원인 분류별 집계
    pool.query<RowDataPacket[]>(`
      SELECT
        COALESCE(
          JSON_UNQUOTE(JSON_EXTRACT(indicators, '$.ai.skipCategory')),
          'ai_rejected'
        ) AS skip_category,
        COUNT(*) AS total
      FROM signals
      WHERE status = 'ai_skipped'
        AND created_at > DATE_SUB(NOW(), INTERVAL ? HOUR)
      GROUP BY skip_category
      ORDER BY total DESC
    `, [hours]),

    // reasoning 키워드 기반 거절 사유 분류 — 사용자 진단용 ("타이밍 늦음" 같은 직관적 카테고리)
    pool.query<RowDataPacket[]>(`
      SELECT
        CASE
          WHEN reasoning LIKE '%과열%' OR reasoning LIKE '%급등 후%' OR reasoning LIKE '%고점 추격%' OR reasoning LIKE '%추격 매수%' OR reasoning LIKE '%추격%' THEN 'late_entry'
          WHEN reasoning LIKE '%유동성%' OR reasoning LIKE '%거래량%희박%' OR reasoning LIKE '%유동성%희박%' THEN 'liquidity'
          WHEN reasoning LIKE '%하락 추세%' OR reasoning LIKE '%MACD 음수%' OR reasoning LIKE '%추세 역행%' OR reasoning LIKE '%역추세%' THEN 'counter_trend'
          WHEN reasoning LIKE '%이미 보유%' OR reasoning LIKE '%평가익%' THEN 'already_held'
          WHEN reasoning LIKE '%마감%' OR reasoning LIKE '%세션%' THEN 'session_close'
          WHEN reasoning LIKE '%[dedup_reuse]%' THEN 'dedup_reuse'
          WHEN reasoning LIKE '%[portfolio_guard%]%' THEN 'portfolio_guard'
          WHEN reasoning LIKE '%[rule_prefilter]%' THEN 'rule_prefilter'
          ELSE 'other'
        END AS reason,
        COUNT(*) AS total
      FROM signals
      WHERE status = 'ai_skipped'
        AND created_at > DATE_SUB(NOW(), INTERVAL ? HOUR)
      GROUP BY reason
      ORDER BY total DESC
    `, [hours]),

    // 반복 발화 — 같은 (symbol, strategy_id, side)로 N회 이상 (2회 이상 = 반복 의심)
    pool.query<RowDataPacket[]>(`
      SELECT
        symbol,
        strategy_id,
        side,
        COUNT(*) AS fire_count,
        MIN(created_at) AS first_fire,
        MAX(created_at) AS last_fire,
        SUM(status = 'ai_skipped') AS skipped_count
      FROM signals
      WHERE created_at > DATE_SUB(NOW(), INTERVAL ? HOUR)
        AND strategy_id IS NOT NULL
      GROUP BY symbol, strategy_id, side
      HAVING fire_count >= 2
      ORDER BY fire_count DESC
      LIMIT 30
    `, [hours]),

    // side별(buy/sell) × 거절 사유 분포 — 매수/매도 패턴 분리 진단
    pool.query<RowDataPacket[]>(`
      SELECT
        side,
        CASE
          WHEN status != 'ai_skipped' THEN 'approved'
          WHEN reasoning LIKE '%과열%' OR reasoning LIKE '%급등 후%' OR reasoning LIKE '%고점 추격%' OR reasoning LIKE '%추격 매수%' OR reasoning LIKE '%추격%' THEN 'late_entry'
          WHEN reasoning LIKE '%유동성%' OR reasoning LIKE '%거래량%희박%' OR reasoning LIKE '%유동성%희박%' THEN 'liquidity'
          WHEN reasoning LIKE '%하락 추세%' OR reasoning LIKE '%MACD 음수%' OR reasoning LIKE '%추세 역행%' OR reasoning LIKE '%역추세%' OR reasoning LIKE '%하락추세%' OR reasoning LIKE '%EMA20<EMA60%' THEN 'counter_trend'
          WHEN reasoning LIKE '%이미 보유%' OR reasoning LIKE '%평가익%' THEN 'already_held'
          WHEN reasoning LIKE '%마감%' OR reasoning LIKE '%세션%' OR reasoning LIKE '%청산 시간%' THEN 'session_close'
          WHEN reasoning LIKE '%[dedup_reuse]%' THEN 'dedup_reuse'
          WHEN reasoning LIKE '%[portfolio_guard%]%' THEN 'portfolio_guard'
          WHEN reasoning LIKE '%[rule_prefilter]%' THEN 'rule_prefilter'
          ELSE 'other'
        END AS reason,
        COUNT(*) AS total
      FROM signals
      WHERE created_at > DATE_SUB(NOW(), INTERVAL ? HOUR)
      GROUP BY side, reason
      ORDER BY side, total DESC
    `, [hours]),

    // rule_prefilter 세부 이유 breakdown
    pool.query<RowDataPacket[]>(`
      SELECT
        COALESCE(
          JSON_UNQUOTE(JSON_EXTRACT(indicators, '$.ai.prefilterReason')),
          'unknown'
        ) AS prefilter_reason,
        COUNT(*) AS total
      FROM signals
      WHERE status = 'ai_skipped'
        AND JSON_EXTRACT(indicators, '$.ai.skipCategory') = 'rule_prefilter'
        AND created_at > DATE_SUB(NOW(), INTERVAL ? HOUR)
      GROUP BY prefilter_reason
      ORDER BY total DESC
    `, [hours]),
  ]);

  const strategyRows       = byStrategy[0]       as RowDataPacket[];
  const symbolRows         = bySymbol[0]         as RowDataPacket[];
  const hourlyRows         = hourly[0]           as RowDataPacket[];
  const consecRows         = consecutive[0]      as RowDataPacket[];
  const skipCatRows        = skipCategories[0]   as RowDataPacket[];
  const reasonRows         = byReason[0]         as RowDataPacket[];
  const repeatRows         = repeatFires[0]      as RowDataPacket[];
  const sideRows           = bySide[0]           as RowDataPacket[];
  const prefilterRows      = byPrefilterReason[0] as RowDataPacket[];

  const totalAll      = strategyRows.reduce((s, r) => s + Number(r.total), 0);
  const approvedAll   = strategyRows.reduce((s, r) => s + Number(r.approved), 0);
  const skippedAll    = strategyRows.reduce((s, r) => s + Number(r.skipped), 0);
  const overallRate   = totalAll > 0 ? Math.round((approvedAll / totalAll) * 100 * 10) / 10 : 0;

  return NextResponse.json({
    ok:     true,
    period: `${hours}h`,
    summary: {
      total:        totalAll,
      approved:     approvedAll,
      skipped:      skippedAll,
      approvalRate: overallRate,
      // 승인율 평가: 5% 이상=양호, 1~5%=주의, 1% 미만=점검 필요
      health: overallRate >= 5 ? 'good' : overallRate >= 1 ? 'caution' : 'review',
    },
    byStrategy: strategyRows.map(r => ({
      strategyId:   r.strategy_id,
      total:        Number(r.total),
      approved:     Number(r.approved),
      skipped:      Number(r.skipped),
      approvalRate: Number(r.approval_rate),
    })),
    bySymbol: symbolRows.map(r => ({
      symbol:       r.symbol,
      total:        Number(r.total),
      approved:     Number(r.approved),
      skipped:      Number(r.skipped),
      approvalRate: Number(r.approval_rate),
    })),
    hourly: hourlyRows.map(r => ({
      hourKst:  r.hour_kst,
      total:    Number(r.total),
      approved: Number(r.approved),
      skipped:  Number(r.skipped),
    })),
    consecutiveSkipSymbols: consecRows.map(r => ({
      symbol:          r.symbol,
      consecutiveSkips: Number(r.consecutive_skips),
    })),
    bySkipCategory: skipCatRows.map(r => ({
      category: r.skip_category as string,
      total:    Number(r.total),
    })),
    // reasoning 키워드 기반 직관적 거절 사유 분포
    byReason: reasonRows.map(r => ({
      reason: r.reason as string,
      total:  Number(r.total),
    })),
    // 같은 (symbol, strategy, side) 반복 발화 — 룰 후행성 또는 dedup miss 진단
    repeatFires: repeatRows.map(r => ({
      symbol:        r.symbol,
      strategyId:    r.strategy_id,
      side:          r.side,
      fireCount:     Number(r.fire_count),
      skippedCount:  Number(r.skipped_count),
      firstFire:     r.first_fire,
      lastFire:      r.last_fire,
    })),
    // side별(buy/sell) × reason 분포 — 매수/매도 분리 진단용
    bySide: sideRows.map(r => ({
      side:   r.side as 'buy' | 'sell',
      reason: r.reason as string,
      total:  Number(r.total),
    })),
    // rule_prefilter 세부 이유 breakdown
    byPrefilterReason: prefilterRows.map(r => ({
      reason: r.prefilter_reason as string,
      total:  Number(r.total),
    })),
  });
}

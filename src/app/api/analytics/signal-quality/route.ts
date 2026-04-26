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

  const [byStrategy, bySymbol, hourly, consecutive, skipCategories] = await Promise.all([
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
  ]);

  const strategyRows  = byStrategy[0]     as RowDataPacket[];
  const symbolRows    = bySymbol[0]       as RowDataPacket[];
  const hourlyRows    = hourly[0]         as RowDataPacket[];
  const consecRows    = consecutive[0]    as RowDataPacket[];
  const skipCatRows   = skipCategories[0] as RowDataPacket[];

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
  });
}

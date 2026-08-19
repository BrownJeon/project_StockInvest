/**
 * 리서치 결과 저장·조회 — T-032.
 *
 * `research_rally_results` 는 (symbol, run_date) UNIQUE 로 하루 1행 upsert 한다.
 * 원시 캔들 캐시 테이블은 두지 않는다 — 추적 대상이 즐겨찾기라 소규모이고
 * 심볼당 Yahoo 조회가 1초 내외라 매일 재조회로 충분하다(T-032 설계).
 */
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { getMarketFromSymbol } from '@/lib/exchanges/kis-symbols';
import type {
  PrecursorAnalysis,
  RallyEvent,
  ResearchDataWarning,
  ResearchMarket,
  ResearchReport,
} from './types';

export interface TrackedSymbol {
  symbol: string;
  name: string | null;
  market: ResearchMarket;
}

export interface StoredResearchResult {
  symbol: string;
  name: string | null;
  market: ResearchMarket;
  runDate: string;
  dataRangeFrom: string | null;
  dataRangeTo: string | null;
  eventCount: number;
  events: RallyEvent[];
  avgRallyPct: number | null;
  avgDaysToRally: number | null;
  precursorAnalysis: PrecursorAnalysis | null;
  dataWarnings: ResearchDataWarning[];
  error: string | null;
  createdAt: string | null;
}

/** DATE/DATETIME 컬럼은 드라이버 설정에 따라 Date 로 올 수 있어 'YYYY-MM-DD'로 정규화한다. */
function toDateString(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    const kst = new Date(v.getTime() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 10);
  }
  return String(v).slice(0, 10);
}

function parseJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === 'string') {
    try { return JSON.parse(v) as T; } catch { return fallback; }
  }
  return v as T;
}

function toNumberOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** `research_enabled=1` 즐겨찾기 목록. 시장은 심볼 포맷으로 판별한다(stock_meta JOIN 아님). */
export async function listTrackedSymbols(market?: ResearchMarket): Promise<TrackedSymbol[]> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT symbol, name FROM stock_favorites WHERE research_enabled = 1 ORDER BY sort_order ASC, added_at DESC`,
  );
  const all = rows.map((r) => ({
    symbol: String(r.symbol),
    name: (r.name as string | null) ?? null,
    market: getMarketFromSymbol(String(r.symbol)) as ResearchMarket,
  }));
  return market ? all.filter((s) => s.market === market) : all;
}

/** 하루 1행 upsert — 같은 날 재실행하면 덮어쓴다(수동 재트리거 허용). */
export async function upsertResearchResult(report: ResearchReport): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO research_rally_results
       (symbol, market, run_date, data_range_from, data_range_to, event_count, events,
        avg_rally_pct, avg_days_to_rally, precursor_analysis, data_warnings, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       market             = VALUES(market),
       data_range_from    = VALUES(data_range_from),
       data_range_to      = VALUES(data_range_to),
       event_count        = VALUES(event_count),
       events             = VALUES(events),
       avg_rally_pct      = VALUES(avg_rally_pct),
       avg_days_to_rally  = VALUES(avg_days_to_rally),
       precursor_analysis = VALUES(precursor_analysis),
       data_warnings      = VALUES(data_warnings),
       error              = VALUES(error)`,
    [
      report.symbol,
      report.market,
      report.runDate,
      report.dataRangeFrom,
      report.dataRangeTo,
      report.eventCount,
      JSON.stringify(report.events),
      report.avgRallyPct != null ? Number(report.avgRallyPct.toFixed(2)) : null,
      report.avgDaysToRally != null ? Number(report.avgDaysToRally.toFixed(2)) : null,
      report.precursorAnalysis ? JSON.stringify(report.precursorAnalysis) : null,
      JSON.stringify(report.dataWarnings),
      report.error,
    ],
  );
}

/**
 * 추적중 심볼별 **최신 1건**. 아직 한 번도 실행되지 않은 심볼은 결과 없이 목록에만 남긴다
 * (UI가 "분석 대기중"을 표시할 수 있게).
 */
export async function getLatestResearchResults(): Promise<
  { tracked: TrackedSymbol[]; results: StoredResearchResult[] }
> {
  const pool = getPool();
  const tracked = await listTrackedSymbols();
  if (tracked.length === 0) return { tracked, results: [] };

  const symbols = tracked.map((t) => t.symbol);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT r.*
       FROM research_rally_results r
       JOIN (
         SELECT symbol, MAX(run_date) AS run_date
           FROM research_rally_results
          WHERE symbol IN (?)
          GROUP BY symbol
       ) latest ON latest.symbol = r.symbol AND latest.run_date = r.run_date
      ORDER BY r.symbol ASC`,
    [symbols],
  );

  const nameBySymbol = new Map(tracked.map((t) => [t.symbol, t.name]));
  const results: StoredResearchResult[] = rows.map((r) => ({
    symbol: String(r.symbol),
    name: nameBySymbol.get(String(r.symbol)) ?? null,
    market: r.market as ResearchMarket,
    runDate: toDateString(r.run_date) ?? '',
    dataRangeFrom: toDateString(r.data_range_from),
    dataRangeTo: toDateString(r.data_range_to),
    eventCount: Number(r.event_count ?? 0),
    events: parseJson<RallyEvent[]>(r.events, []),
    avgRallyPct: toNumberOrNull(r.avg_rally_pct),
    avgDaysToRally: toNumberOrNull(r.avg_days_to_rally),
    precursorAnalysis: parseJson<PrecursorAnalysis | null>(r.precursor_analysis, null),
    dataWarnings: parseJson<ResearchDataWarning[]>(r.data_warnings, []),
    error: (r.error as string | null) ?? null,
    createdAt: r.created_at ? new Date(r.created_at as string | Date).toISOString() : null,
  }));

  return { tracked, results };
}

/**
 * T-108 `GET /api/ops/analysis?part=today|verify|data` 본체 → `AnalysisDTO` (가이드 §4.6 · §2.5).
 *
 * - today : 장마감 AI 분석 표(홈과 같은 `readAnalysisRuns`) + 후보 행(그 실행 창의 장마감 시그널 · 판단 기록이 있으면 「매수 안 함」 행)
 *           + 리서치 추적 종목 수(`stock_favorites.research_enabled=1`).
 * - verify: 사후 성과 건수(기간별 — 초과수익 중앙값은 v1 `prep`, L-3) + 청산 로직 X1~X6 + 가상 진입(paper_fills) 건수.
 * - data  : 원천 7개 신선도 + 가동률(실행 기록 기준, 분자 = ok 만 — D6). 기록 7일 미만이면 `prep`.
 * 읽기 전용, KIS·FX 외부 호출 없음.
 */
import { JOB_SPECS } from '@/lib/strategy/records/job-slots';
import { addDaysYmd } from '@/lib/strategy/us-session';
import { noRowMetric, POST_MARKET_JOB, readAnalysisRuns, type NoRowReason } from './analysis-runs';
import { readDataSources } from './anomalies';
import { readAnomalyDetails } from './anomaly-details';
import { readExitDetail } from './exit-lines';
import { readJudgmentSkipRows } from './judgment-read';
import { counted, metric } from './metric';
import { readPostmortemSample, SMALL_SAMPLE_N, verifyPostmortemRows } from './postmortem-sample';
import { count, createReader, OpsQueryError, section, type OpsReader } from './read-only';
import { readSafetyState } from './safety-state';
import { confidenceFromIndicators, gateFromIndicators } from './trade';
import { isTradingDay, isoOrNull, kstDateOf, kstIso, kstSql, loadClosedDays, toMs, type ClosedDays } from './sessions';
import type {
  AnalysisCandidate, AnalysisDataDTO, AnalysisTodayDTO, AnalysisVerifyDTO, Market, Metric, SafetyStateDTO, UptimeRow,
} from './types';

export type AnalysisPart = 'today' | 'verify' | 'data';
export function parsePart(v: string | null): AnalysisPart | null {
  return v === 'today' || v === 'verify' || v === 'data' ? v : null;
}

export const RUN_CANDIDATE_SIGNALS_SQL =
  `SELECT symbol, status, indicators, created_at FROM signals
    WHERE market = ? AND scenario_source = 'post-market' AND created_at >= ? AND created_at < ?
    ORDER BY created_at ASC LIMIT 100`;
export const RESEARCH_COUNT_SQL = 'SELECT COUNT(*) AS n FROM stock_favorites WHERE research_enabled = 1';
export const PAPER_FILLS_COUNT_SQL = 'SELECT COUNT(*) AS n FROM paper_fills';
export const UPTIME_ROWS_SQL =
  `SELECT job_id, status, DATE_FORMAT(session_date_kst, '%Y-%m-%d') AS d FROM job_run_log
    WHERE session_date_kst >= ? AND recorder IN ('runner_hook', 'route') AND job_id IN (?)`;
export const FIRST_RECORD_SQL = 'SELECT MIN(started_at) AS t FROM job_run_log';

/** 가동률 창(일) — 주 단위. */
export const UPTIME_DAYS = 7;

const MARKETS: readonly Market[] = ['domestic', 'overseas'];

// ── today ────────────────────────────────────────────────────────────────

export async function buildAnalysisToday(r: OpsReader, closed: ClosedDays): Promise<AnalysisTodayDTO> {
  const runsP = readAnalysisRuns(r, closed);
  const [runs, candidates, research] = await Promise.all([
    section('analysis.runs', async () => (await runsP).rows),
    section('analysis.candidates', async () => {
      const res = await runsP;
      const rows: AnalysisCandidate[] = [];
      let anyFound = false; let skipTotal = 0; let whyNone: NoRowReason | null = null;
      for (const m of MARKETS) {
        const w = res.windows[m];
        const session = res.rows[m].session;
        const sig = await r.rows<Record<string, unknown>>(RUN_CANDIDATE_SIGNALS_SQL, [m, kstSql(w.startMs), kstSql(w.endMs)]);
        for (const s of sig) {
          rows.push({
            symbol: String(s.symbol), market: m, session, origin: 'signal', aiDecision: 'BUY',
            confidence: confidenceFromIndicators(s.indicators), signalStatus: String(s.status), signalGate: gateFromIndicators(s.indicators), exclusionCode: null, createdAt: isoOrNull(s.created_at),
          });
        }
        if (w.judgment.kind === 'found' && w.judgment.id != null) {
          anyFound = true;
          const skips = await readJudgmentSkipRows(r, w.judgment.id);
          skipTotal += skips.length;
          for (const k of skips) {
            rows.push({
              symbol: k.symbol, market: m, session, origin: 'judgment_skip', aiDecision: k.aiDecision,
              confidence: k.confidence, signalStatus: null, signalGate: null, exclusionCode: k.exclusionCode, createdAt: null,
            });
          }
        } else if (!whyNone) {
          whyNone = w.judgment.why ?? 'no_record';
        }
      }
      // 한 시장이라도 판단 기록이 있으면 그 수를, 둘 다 없으면 「준비 중/모름」(시그널로 이어진 것만 남는다).
      const skipRows: Metric<number> = anyFound ? counted(skipTotal) : noRowMetric<number>(whyNone ?? 'no_record');
      return { rows, skipRows };
    }),
    section('analysis.research', async () => counted(count((await r.rows<{ n: unknown }>(RESEARCH_COUNT_SQL))[0]?.n))),
  ]);
  return {
    part: 'today', generatedAt: kstIso(r.nowMs), runs, candidates,
    researchCount: research.state === 'ok' ? research.data : metric<number>('error', null, null, research.error),
  };
}

// ── verify ───────────────────────────────────────────────────────────────

export async function buildAnalysisVerify(r: OpsReader, closed: ClosedDays, safety: SafetyStateDTO): Promise<AnalysisVerifyDTO> {
  const [postmortem, exit, paper] = await Promise.all([
    section('analysis.postmortem', async () => {
      const p = await readPostmortemSample(r, closed);
      const rows = verifyPostmortemRows(p);
      const n = p.markets.domestic.barsAfter.length + p.markets.overseas.barsAfter.length;
      const truncated = p.markets.domestic.truncated || p.markets.overseas.truncated;
      const population = n === 0 ? counted(0)
        : truncated ? metric<number>('partial', n, kstIso(r.nowMs), 'truncated')
        : metric<number>(n < SMALL_SAMPLE_N ? 'partial' : 'available', n, kstIso(r.nowMs), n < SMALL_SAMPLE_N ? 'small_sample' : undefined);
      return {
        population, cardsOnly: true, entry: 'd1open' as const, rows,
        lastBarDate: { domestic: p.markets.domestic.lastBarDate, overseas: p.markets.overseas.lastBarDate },
      };
    }),
    section('analysis.exit', () => readExitDetail(r, closed, safety)),
    section('analysis.paperFills', async () => counted(count((await r.rows<{ n: unknown }>(PAPER_FILLS_COUNT_SQL))[0]?.n))),
  ]);
  return {
    part: 'verify', generatedAt: kstIso(r.nowMs), postmortem, exit,
    paperFills: paper.state === 'ok' ? paper.data : metric<number>('error', null, null, paper.error),
  };
}

// ── data ─────────────────────────────────────────────────────────────────

/** 가동률 대상 잡 — 분석(장마감 2) / 수집(일 1회 ingest 잡). 이름을 적지 않고 슬롯 표에서 고른다. */
export function uptimeJobs(): { analysis: string[]; collection: string[] } {
  const analysis = [POST_MARKET_JOB.domestic, POST_MARKET_JOB.overseas];
  const collection = JOB_SPECS.filter((s) => s.runKind === 'ingest' && !s.rollup && (s.kind === 'daily' || s.kind === 'et_daily')).map((s) => s.jobId);
  return { analysis, collection };
}

/** 가동률 1행 — 순수. 기대 회차: 분석 = 창 안 세션일(국내 KST 거래일 + 해외 장마감 분석이 새 세션을 보는 날), 수집 = 잡 수 × 일수. */
export function uptimeRow(
  group: 'analysis' | 'collection', rows: readonly { job_id: unknown; status: unknown }[], jobs: readonly string[],
  firstMs: number | null, nowMs: number, expected: number | null,
): UptimeRow {
  const firstRecordAt = firstMs != null ? kstIso(firstMs) : null;
  if (firstMs == null) return { group, days: 0, ok: 0, expected: null, state: 'prep', reason: 'no_record', firstRecordAt };
  // 기록 일수 = 첫 기록 KST 날짜부터 오늘까지(오늘 포함). 비율은 창(어제까지 7일)이 기록으로 다 덮일 때부터 — 첫 기록일 ≤ 창 시작.
  const today = kstDateOf(nowMs);
  const firstDate = kstDateOf(firstMs);
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${firstDate}T00:00:00Z`)) / 86_400_000) + 1;
  const set = new Set(jobs);
  const ok = rows.filter((x) => set.has(String(x.job_id)) && String(x.status) === 'ok').length;
  if (firstDate > addDaysYmd(today, -UPTIME_DAYS)) return { group, days, ok, expected, state: 'prep', reason: 'under_7_days', firstRecordAt };
  if (expected == null) return { group, days, ok, expected: null, state: 'unknown', reason: 'holidays_unknown', firstRecordAt };
  return { group, days, ok, expected, state: expected === 0 ? 'zero' : 'available', firstRecordAt };
}

function expectedAnalysisRuns(nowMs: number, closed: ClosedDays): number | null {
  if (!closed.domestic || !closed.overseas) return null;
  let n = 0;
  // 지난 7개 KST 날짜(오늘 제외) — 국내: 그 날이 거래일 / 해외: 그 날 08:00 KST 의 ET 날짜(직전 날)가 거래일
  const today = kstDateOf(nowMs);
  for (let i = 1; i <= UPTIME_DAYS; i++) {
    const d = addDaysYmd(today, -i);
    if (isTradingDay('domestic', d, closed.domestic)) n++;
    if (isTradingDay('overseas', addDaysYmd(d, -1), closed.overseas)) n++;
  }
  return n;
}

export async function buildAnalysisData(r: OpsReader, closed: ClosedDays): Promise<AnalysisDataDTO> {
  const jobs = uptimeJobs();
  const sourcesPromise = readDataSources(r, closed);
  const [sources, uptime, anomalyDetails] = await Promise.all([
    section('analysis.sources', () => sourcesPromise),
    section('analysis.uptime', async () => {
      const from = addDaysYmd(kstDateOf(r.nowMs), -UPTIME_DAYS);
      let first: Record<string, unknown>[];
      let rows: { job_id: unknown; status: unknown; d: unknown }[];
      try {
        [first, rows] = await Promise.all([
          r.rows<Record<string, unknown>>(FIRST_RECORD_SQL),
          r.rows<{ job_id: unknown; status: unknown; d: unknown }>(UPTIME_ROWS_SQL, [from, [...jobs.analysis, ...jobs.collection]]),
        ]);
      } catch (e) {
        if (e instanceof OpsQueryError && e.code === 'not_migrated') {
          return (['analysis', 'collection'] as const).map((g) => ({ group: g, days: 0, ok: 0, expected: null, state: 'prep' as const, reason: 'not_migrated', firstRecordAt: null }));
        }
        throw e;
      }
      // 오늘 행은 아직 끝나지 않은 날이라 빼고 센다(기대 회차도 어제까지).
      const today = kstDateOf(r.nowMs);
      const past = rows.filter((x) => String(x.d) < today);
      const firstMs = toMs(first[0]?.t);
      return [
        uptimeRow('analysis', past, jobs.analysis, firstMs, r.nowMs, expectedAnalysisRuns(r.nowMs, closed)),
        uptimeRow('collection', past, jobs.collection, firstMs, r.nowMs, jobs.collection.length * UPTIME_DAYS),
      ];
    }),
    section('analysis.anomalyDetails', () => readAnomalyDetails(r, sourcesPromise)),
  ]);
  return { part: 'data', generatedAt: kstIso(r.nowMs), sources, uptime, anomalyDetails };
}

export async function buildAnalysis(part: AnalysisPart, nowMs: number = Date.now(), reader: OpsReader = createReader({ nowMs })) {
  const closed = await loadClosedDays(reader);
  if (part === 'today') return buildAnalysisToday(reader, closed);
  if (part === 'data') return buildAnalysisData(reader, closed);
  const safety = await readSafetyState(nowMs);
  return buildAnalysisVerify(reader, closed, safety);
}


/**
 * 심볼 1개 리서치 리포트 생성 — T-032.
 *
 * 데이터 조회 → 사이클 탐지 → 선행지표 피처·hit-rate 분석 → 리포트 조립.
 * LLM은 이 경로 어디에도 없다(사용자가 "순수 통계만" 확정).
 */
import { loadDailyHistory, type HistoryLoadOptions } from './data/history-source';
import { detectRallyEvents } from './pattern/rally-cycle';
import { computePrecursorSeries, type PrecursorFeatureConfig } from './pattern/precursor-features';
import { analyzePrecursors, type PrecursorAnalysisConfig } from './pattern/precursor-analysis';
import {
  DEFAULT_RALLY_CYCLE_CONFIG,
  type DailyCandle,
  type RallyCycleConfig,
  type ResearchDataWarning,
  type ResearchReport,
} from './types';

/**
 * 이 일수 미만이면 "패턴 없음"이 아니라 **이력 부족**으로 보고한다.
 * SNDK처럼 스핀오프 상장이 1.5년 정도인 종목을 "패턴 없는 종목"으로 오독하지 않기 위함.
 * 250거래일 ≈ 1년. lookback(60) + rally(20) + decline(20) 사이클을 여러 번 관측하려면
 * 최소 2년치는 있어야 한다고 보고 500거래일을 임계로 잡았다.
 */
export const SHORT_HISTORY_MIN_DAYS = 500;

export interface BuildResearchReportOptions {
  cycle?: Partial<RallyCycleConfig>;
  features?: Partial<PrecursorFeatureConfig>;
  analysis?: Partial<PrecursorAnalysisConfig>;
  history?: HistoryLoadOptions;
  /** KST 기준 실행일. 미지정 시 현재 KST 날짜 */
  runDate?: string;
}

/** KST 기준 'YYYY-MM-DD' (서버 TZ와 무관하게 동일 결과) */
export function kstDateString(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function buildReport(
  symbol: string,
  market: ResearchReport['market'],
  runDate: string,
  candles: DailyCandle[],
  opts: BuildResearchReportOptions,
): ResearchReport {
  const cfg: RallyCycleConfig = { ...DEFAULT_RALLY_CYCLE_CONFIG, ...opts.cycle };
  const detection = detectRallyEvents(candles, cfg);
  const warnings: ResearchDataWarning[] = [];

  if (candles.length < SHORT_HISTORY_MIN_DAYS) warnings.push('short_history');
  if (detection.events.length === 0) warnings.push('no_events');
  if (detection.pendingTroughCount > 0) warnings.push('pending_recent_trough');

  // 선행지표는 이벤트(양성 라벨)가 있어야 의미가 있다.
  let precursorAnalysis = null as ResearchReport['precursorAnalysis'];
  if (detection.troughIndices.length > 0) {
    const features = computePrecursorSeries(candles, opts.features);
    precursorAnalysis = analyzePrecursors(features, detection.troughIndices, opts.analysis);
  } else {
    warnings.push('insufficient_for_precursors');
  }

  return {
    symbol,
    market,
    runDate,
    dataRangeFrom: candles[0]?.date ?? null,
    dataRangeTo: candles[candles.length - 1]?.date ?? null,
    eventCount: detection.events.length,
    events: detection.events,
    avgRallyPct: detection.avgRallyPct,
    avgDaysToRally: detection.avgDaysToRally,
    precursorAnalysis,
    dataWarnings: warnings,
    error: null,
  };
}

/**
 * 심볼 1개 리포트. 조회·계산 실패는 던지지 않고 `error`가 채워진 리포트로 돌려준다 —
 * cron이 심볼 하나 때문에 사이클 전체를 멈추지 않게 하기 위함.
 */
export async function buildResearchReport(
  symbol: string,
  opts: BuildResearchReportOptions = {},
): Promise<ResearchReport> {
  const runDate = opts.runDate ?? kstDateString();
  try {
    const loaded = await loadDailyHistory(symbol, opts.history ?? {});
    return buildReport(loaded.symbol, loaded.market, runDate, loaded.candles, opts);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    // 시장 판별은 심볼 포맷만으로도 가능하므로 실패 리포트에도 남긴다.
    const market = /^[A-Z]{3}:/.test(symbol) ? 'overseas' : 'domestic';
    return {
      symbol,
      market,
      runDate,
      dataRangeFrom: null,
      dataRangeTo: null,
      eventCount: 0,
      events: [],
      avgRallyPct: null,
      avgDaysToRally: null,
      precursorAnalysis: null,
      dataWarnings: [],
      error,
    };
  }
}

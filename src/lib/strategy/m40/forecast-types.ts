/** Private immutable research-scenario contracts. Never return PreparedForecastInput to a public API. */
import type { ForwardCalendarSession, ForwardPolicy } from './forward-types';
import type { ForwardSourceBundle } from './forward-sources';
import type { PaperBook, PaperIntent } from './paper-ledger';
export const FORECAST_MODEL_VERSION = 'm40-joint-moving-block-next-open-latent-index-v1';
export type ForecastHorizon = 'week' | 'month' | 'quarter' | 'year';
export interface ForecastTarget {
  horizon: ForecastHorizon; calendarTarget: string; targetSession: string; sessions: number;
}
export interface ForecastBaseline {
  kind: 'forecast_only_marked_snapshot'; accountId: string; accountRevision: number;
  session: string; equityUsd: number; bookSha256: string; sourceAccountStateSha256: string;
  epochSession: string; epochProvisional: boolean;
  sourceRegimeSha256?: string; analysisSourceBundleSha256?: string;
}
export interface ForecastBridge {
  kind: 'latent_index_ols_centered_residual' | 'none'; session: string | null;
  intercept: number; slope: number; predictor: number; residuals: number[];
  residualSha256: string; fitStart: string | null; fitEnd: string | null; sampleCount: number;
}
export interface ForecastSampleCounts {
  historicalReturns: number; historicalStart: string; historicalEnd: string;
  blockLength: number; possibleBlockStarts: number; nonoverlappingBlocks: number;
}
export interface PreparedForecastInput {
  modelVersion: typeof FORECAST_MODEL_VERSION; issuedAt: string; sourceDatasetId: string;
  sourceAvailableAt: string; sourceSha256: string; policySha256: string; inputSha256: string;
  baseline: ForecastBaseline; book: PaperBook; pendingIntents: PaperIntent[]; policy: ForwardPolicy;
  symbols: string[]; candidateSymbols: string[]; calendar: ForwardCalendarSession[]; baselineIndex: number;
  historySessions: string[]; stockHistory: number[][]; marketHistory: number[];
  /** Joint date-major paired gross returns. One sampled row is shared by every asset. */
  overnight: number[][]; intraday: number[][]; marketReturns: number[];
  rawMarks: number[]; returnSessions: string[]; targets: ForecastTarget[];
  bridge: ForecastBridge; assumptions: string[];
}
export interface ForecastPrepareArgs {
  analysisSourceBundleSha256?:string;accountId: string; accountRevision: number; book: PaperBook; pendingIntents?: readonly PaperIntent[]; policy: ForwardPolicy;
  bundle: ForwardSourceBundle; calendar: readonly ForwardCalendarSession[];
  issuedAt: string; sourceDatasetId: string; sourceAvailableAt: string;
}
export type ForecastPreparation = { status: 'qualified'; input: PreparedForecastInput }
  | { status: 'blocked'; issues: string[] };
export interface ForecastEngineOptions {
  seed: string; pathCount?: number; blockLength?: number; budgetMs?: number;
  onProgress?: (completedPaths: number, totalPaths: number) => void;
}
export interface ForecastDistribution {
  mean: number; p10: number; p50: number; p90: number;
}
export interface ForecastHorizonResult extends ForecastTarget {
  netUsd: ForecastDistribution; netPct: ForecastDistribution;
  lossCount: number; pathCount: number; lossProbability: number; monteCarloSe: number;
  historicalNonoverlappingWindows: number;
}
export interface ForecastEngineResult {
  status: 'completed' | 'failed'; issues: string[]; modelVersion: string;
  calibration: 'uncalibrated_research_scenario'; quantileConvention: 'linear_type7';
  seed: string; pathCount: number; blockLength: number;
  inputSha256: string; policySha256: string; sourceSha256: string;
  sourceDatasetId: string; issuedAt: string; sourceAvailableAt: string;
  baseline: ForecastBaseline; sampleCounts: ForecastSampleCounts;
  /** Residual sample itself is private input; only its hash and diagnostics leave the engine. */
  bridge: Omit<ForecastBridge, 'residuals'>;
  assumptions: string[]; horizons: ForecastHorizonResult[];
}

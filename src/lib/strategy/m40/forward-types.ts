import type { M40Holding, M40Input, M40MembershipEnd } from './types';

export type ForwardSourceVariant = 'split_only' | 'raw' | 'index' | 'generic_adjusted';
export interface ForwardPriceBar {
  session: string;
  close: number;
  final: boolean;
  /** Actual receipt time; never a reconstructed historical publication time. */
  observedAt: string;
  sourceId: string;
  sourceVariant: ForwardSourceVariant;
  /** Immutable source observation/artifact SHA-256, supplied by the collector. */
  sha256: string;
  currency: 'USD' | 'INDEX';
  qualification: 'evaluation_only';
}
export interface ForwardRawQuote extends Omit<ForwardPriceBar, 'close'> {
  price: number;
}
export interface ForwardCalendarSession {
  session: string;
  openAt: string;
  closeAt: string;
  source: 'historical_canonical' | 'nyse_official_2026_2027';
  sourceUrl?: string;
}
export interface ForwardMemberData {
  symbol: string;
  splitBars: readonly ForwardPriceBar[];
  rawQuote?: ForwardRawQuote;
  listingSession?: string;
  confirmedMembershipEnd?: M40MembershipEnd;
}
export interface ForwardInputData {
  asOfSession: string;
  calendar: readonly ForwardCalendarSession[];
  members: readonly ForwardMemberData[];
  /** Actual S&P 500 price-index observations; SPY is not an equivalent series. */
  sp500Bars: readonly ForwardPriceBar[];
}
export interface ForwardCohortExclusion {
  symbol: string;
  issues: readonly string[];
}
export interface ForwardFrozenCohort {
  symbols: readonly string[];
  excluded: readonly ForwardCohortExclusion[];
  asOfSession: string;
  frozenAt: string;
}
export interface ForwardHistoryExclusionProof {
  symbol: string;
  asOfSession: string;
  splitSourceSha256: string;
  reason: 'documented_initial_history_gap';
}
export interface ForwardPolicy {
  policyId: string;
  strategyId: 'm40-paper-v1';
  registeredAt: string;
  /** Frozen reference list, not a claim to the complete Nasdaq100 + NYSE50. */
  referenceSymbols: readonly string[];
  frozenCohort: ForwardFrozenCohort | null;
  /** Root locks this once, only after forwardEligible, using epochCandidate. */
  epochSession: string | null;
  /** Actual immutable first qualified forward-cycle decision time, not the session date. */
  epochLockedAt?: string | null;
  /** Explicit initial collection audit only; never inferred from a partial response. */
  historyExclusionProofs?: readonly ForwardHistoryExclusionProof[];
}
export interface ForwardPaperAccount {
  equityUsd: number;
  settledCashUsd: number;
  /** Independent cloned US paper holdings; zero-quantity tombstones are allowed. */
  holdings: readonly M40Holding[];
  clonedAt: string;
  cloneSha256: string;
}
export interface ForwardSymbolEligibility {
  symbol: string;
  eligible: boolean;
  inFrozenCohort: boolean;
  held: boolean;
  issues: readonly string[];
}
export interface ForwardObservationProvenance {
  symbol: string;
  session: string;
  kind: 'split_bar' | 'raw_quote' | 'sp500_bar';
  sourceId: string;
  sourceVariant: ForwardSourceVariant;
  sha256: string;
  observedAt: string;
  availableAt: string;
  currency: 'USD' | 'INDEX';
  qualification: 'evaluation_only';
}
export interface ForwardEligibilityReport {
  cohortLabel: 'limited_reference_cohort';
  executionScope: 'paper_only';
  liveEligible: false;
  coreEligible: boolean;
  forwardEligible: boolean;
  asOfLatestCompleted: boolean;
  latestCompletedSession: string | null;
  epochProvisional: boolean;
  epochCandidate: string | null;
  cohortProposal: ForwardFrozenCohort | null;
  issues: readonly string[];
  perSymbol: readonly ForwardSymbolEligibility[];
  provenance: readonly ForwardObservationProvenance[];
  cloneSha256: string;
}
export interface ForwardInputResult {
  input: M40Input | null;
  /** Locked paper policy only: incomplete unrelated prices cannot hide a proven membership exit. */
  confirmedOnlyInput?: M40Input | null;
  report: ForwardEligibilityReport;
}

/** T-156 M40 is an account-level, side-effect-free planning contract. */
export interface M40Bar {
  /** Exchange trading-session date, YYYY-MM-DD. */
  session: string;
  close: number;
  final: boolean;
  /** When this finalized observation was publicly available, with a timezone. */
  availableAt: string;
  priceBasis: 'split_adjusted' | 'index';
}

export interface M40RawQuote {
  session: string;
  price: number;
  availableAt: string;
  priceBasis: 'raw';
}

export interface M40MembershipEnd {
  /** First session on which membership no longer applies. */
  effectiveSession: string;
  /** A dated, explicit source confirmation; absence is never inferred as an exit. */
  confirmedAt: string;
  source: string;
}

export interface M40Member {
  symbol: string;
  membership: 'eligible' | 'ineligible' | 'unknown';
  /** A verified first listing session; do not substitute a provider's first row. */
  listingSession?: string;
  confirmedMembershipEnd?: M40MembershipEnd;
  bars: readonly M40Bar[];
  quote?: M40RawQuote;
}

export interface M40Holding {
  symbol: string;
  quantity: number;
  /** null means legacy/unattributed; only an exact strategyId match may exit. */
  strategyId: string | null;
  positionId?: string;
}

export interface M40Advisory {
  symbol: string;
  source: 'pattern' | 'agent';
  suggestedAction: 'buy' | 'sell' | 'hold';
  note?: string;
}

export interface M40Input {
  asOfSession: string;
  decisionTime: string;
  /** Authoritative exchange sessions, ascending and unique, including epoch. */
  sessions: readonly string[];
  /** Shared T0; account creation/restart must not reset this schedule. */
  rebalanceEpochSession: string;
  strategyId?: string;
  marketBars: readonly M40Bar[];
  /** Must attest that members contains the complete expected universe/exit records. */
  universeComplete: boolean;
  members: readonly M40Member[];
  holdings: readonly M40Holding[];
  account: {
    /** Already marked account equity, in the same USD unit as raw quotes. */
    equityUsd: number;
    /** Available settled buying cash, excluding expected sale proceeds. */
    settledCashUsd: number;
  };
  /** Recorded only; these cannot modify M40 base selection or sizing. */
  advisories?: readonly M40Advisory[];
}

export type M40Gate = 'pass' | 'fail' | 'unknown';

export interface M40Warning {
  code: string;
  message: string;
  symbol?: string;
}

export interface M40Candidate {
  symbol: string;
  status: 'ranked' | 'nonpositive' | 'ineligible' | 'insufficient_listing_history' | 'unknown';
  momentum: number | null;
  rank: number | null;
  selected: boolean;
  reason: string;
}

export interface M40Decision {
  symbol: string;
  strategyId: string;
  action: 'buy' | 'sell' | 'hold';
  reason: string;
  /** Raw whole-share amount; holds report the M40-owned amount. */
  quantity: number;
  referencePriceUsd?: number;
  /** 15% equity cap INCLUDING the entry fee. */
  entryBudgetUsd?: number;
  estimatedNotionalUsd?: number;
  estimatedFeeUsd?: number;
  estimatedDebitUsd?: number;
  /** A buy remains conditional on successful exits and an execution-time recheck. */
  requiresExitSymbols?: readonly string[];
  positionIds?: readonly string[];
}

export interface M40Plan {
  strategyId: string;
  asOfSession: string;
  decisionTime: string;
  status: 'ready' | 'data_unknown' | 'invalid_input';
  isReviewSession: boolean;
  gates: {
    sessionInput: M40Gate;
    accountInput: M40Gate;
    marketTrend: M40Gate;
    universeData: M40Gate;
    marketReferenceSession: string | null;
    marketClose: number | null;
    marketSma200: number | null;
  };
  /** Momentum order, then deterministic symbol order for unranked observations. */
  candidates: readonly M40Candidate[];
  decisions: readonly M40Decision[];
  warnings: readonly M40Warning[];
  /** Kept separate to make the agent/pattern shadow-only boundary observable. */
  advisories: readonly M40Advisory[];
}

import type {
  M40Bar, M40Candidate, M40Decision, M40Holding, M40Input,
  M40Member, M40Plan, M40Warning,
} from './types';

/** The reviewed base strategy is fixed; shadow opinions cannot tune these values. */
export const M40_POLICY = Object.freeze({
  strategyId: 'm40',
  momentumSessions: 126,
  marketSmaSessions: 200,
  rebalanceSessions: 20,
  slots: 5,
  entryBudgetFraction: 0.15,
  feePerSide: 0.0025,
});

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const symbolPattern = /^[A-Z0-9][A-Z0-9.:^/\-]{0,63}$/;
const compareSymbol = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

function validDate(value: string): boolean {
  if (typeof value !== 'string' || !datePattern.test(value)) return false;
  const milliseconds = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString().slice(0, 10) === value;
}

function instant(value: string): number {
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return NaN;
  return Date.parse(value);
}

const positive = (value: number): boolean => Number.isFinite(value) && value > 0;

/** No database, signal router, model, clock, or order dependency is used here. */
export function planM40(input: M40Input): M40Plan {
  const warnings: M40Warning[] = [];
  const warn = (code: string, message: string, symbol?: string): void => {
    warnings.push({ code, message, ...(symbol ? { symbol } : {}) });
  };
  const strategyId = input.strategyId ?? M40_POLICY.strategyId;
  const result: M40Plan = {
    strategyId, asOfSession: input.asOfSession, decisionTime: input.decisionTime,
    status: 'ready', isReviewSession: false,
    gates: {
      sessionInput: 'pass', accountInput: 'pass', marketTrend: 'unknown', universeData: 'unknown',
      marketReferenceSession: null, marketClose: null, marketSma200: null,
    },
    candidates: [], decisions: [], warnings, advisories: input.advisories?.map(item => ({ ...item })) ?? [],
  };
  const cutoff = instant(input.decisionTime);
  const sessions = input.sessions;
  const asOfIndex = sessions.indexOf(input.asOfSession);
  const epochIndex = sessions.indexOf(input.rebalanceEpochSession);
  const validSessions = sessions.length > 0 && sessions.every((session, index) =>
    validDate(session) && (index === 0 || sessions[index - 1] < session));
  if (!validSessions || !validDate(input.asOfSession) || !validDate(input.rebalanceEpochSession)
    || asOfIndex < 0 || epochIndex < 0 || !Number.isFinite(cutoff)
    || new Date(cutoff).toISOString().slice(0, 10) < input.asOfSession) {
    result.status = 'invalid_input';
    result.gates.sessionInput = 'fail';
    warn('invalid_session_input', 'A unique ordered exchange calendar, fixed epoch, and dated decision cutoff are required.');
    return result;
  }
  result.isReviewSession = asOfIndex >= epochIndex
    && (asOfIndex - epochIndex) % M40_POLICY.rebalanceSessions === 0;

  const invalidHolding = input.holdings.some(holding =>
    !symbolPattern.test(holding.symbol) || !positive(holding.quantity)
    || (holding.strategyId !== null && (typeof holding.strategyId !== 'string' || !holding.strategyId.trim()))
    || (holding.strategyId === strategyId && !Number.isSafeInteger(holding.quantity)));
  if (!strategyId.trim() || !Number.isFinite(input.account.equityUsd) || input.account.equityUsd < 0
    || !Number.isFinite(input.account.settledCashUsd) || input.account.settledCashUsd < 0
    || input.account.settledCashUsd > input.account.equityUsd || invalidHolding) {
    result.status = 'invalid_input';
    result.gates.accountInput = 'fail';
    warn('invalid_account_input', 'A consistent long-only marked equity, settled cash, and attributable share quantities are required.');
    return result;
  }

  let invalidData = false;
  let universeKnown = input.universeComplete === true && input.members.length > 0;
  const sessionSet = new Set(sessions);
  const checkBars = (bars: readonly M40Bar[], basis: M40Bar['priceBasis'], symbol?: string): Map<string, M40Bar> => {
    const bySession = new Map<string, M40Bar>();
    for (let index = 0; index < bars.length; index += 1) {
      const bar = bars[index];
      const released = instant(bar.availableAt);
      if (!validDate(bar.session) || !sessionSet.has(bar.session)
        || bar.session > input.asOfSession || (index > 0 && bars[index - 1].session >= bar.session)
        || !positive(bar.close) || bar.final !== true || bar.priceBasis !== basis
        || !Number.isFinite(released) || released > cutoff
        || new Date(released).toISOString().slice(0, 10) < bar.session) {
        invalidData = true;
        warn('invalid_price_observation', 'Prices must be ordered, unique, finalized, known by the cutoff, and use the declared price basis.', symbol);
        return new Map();
      }
      bySession.set(bar.session, bar);
    }
    return bySession;
  };
  const market = checkBars(input.marketBars, 'index');
  if (asOfIndex >= M40_POLICY.marketSmaSessions) {
    const marketWindow = sessions.slice(asOfIndex - M40_POLICY.marketSmaSessions, asOfIndex);
    const values = marketWindow.map(session => market.get(session)?.close);
    result.gates.marketReferenceSession = marketWindow[marketWindow.length - 1];
    if (values.every((value): value is number => value !== undefined)) {
      const lastClose = values[values.length - 1];
      // Centering at the last close preserves strict equality for a flat index
      // even when its decimal price is not exactly representable in binary.
      const meanDelta = values.reduce((sum, value) => sum + (value - lastClose) / M40_POLICY.marketSmaSessions, 0);
      const sma = lastClose + meanDelta;
      result.gates.marketClose = lastClose;
      result.gates.marketSma200 = sma;
      result.gates.marketTrend = meanDelta < 0 ? 'pass' : 'fail';
    } else {
      warn('market_history_missing', 'The complete 200-session index window ending at D-1 is required.');
    }
  } else {
    warn('market_history_missing', 'The calendar does not contain the 200 index sessions preceding D0.');
  }

  const members = new Map<string, M40Member>();
  const confirmedEnds = new Set<string>();
  const candidates: M40Candidate[] = [];
  if (!universeKnown) warn('universe_incomplete', 'An empty or incomplete universe cannot be treated as a zero-candidate result.');
  for (const member of input.members) {
    if (!symbolPattern.test(member.symbol) || members.has(member.symbol)
      || !['eligible', 'ineligible', 'unknown'].includes(member.membership)) {
      invalidData = true;
      universeKnown = false;
      warn('invalid_member', 'Universe symbols must be valid, unique, and have an explicit membership state.', member.symbol);
      continue;
    }
    members.set(member.symbol, member);
    const bars = checkBars(member.bars, 'split_adjusted', member.symbol);
    if (member.quote) {
      const released = instant(member.quote.availableAt);
      if (!validDate(member.quote.session) || !sessionSet.has(member.quote.session)
        || member.quote.session > input.asOfSession || !positive(member.quote.price)
        || member.quote.priceBasis !== 'raw' || !Number.isFinite(released) || released > cutoff
        || new Date(released).toISOString().slice(0, 10) < member.quote.session) {
        invalidData = true;
        universeKnown = false;
        warn('invalid_raw_quote', 'Raw sizing quotes must be valid observations already known by the cutoff.', member.symbol);
      }
    }
    const end = member.confirmedMembershipEnd;
    if (end) {
      const confirmed = instant(end.confirmedAt);
      if (!validDate(end.effectiveSession) || !Number.isFinite(confirmed) || !end.source.trim() || confirmed > cutoff) {
        invalidData = true;
        universeKnown = false;
        warn('invalid_membership_end', 'Membership exits require a source confirmation already known by the cutoff.', member.symbol);
      } else if (end.effectiveSession <= input.asOfSession) {
        confirmedEnds.add(member.symbol);
      }
    }
    const candidate: M40Candidate = {
      symbol: member.symbol, status: 'unknown', momentum: null, rank: null, selected: false, reason: 'data_unknown',
    };
    candidates.push(candidate);
    if (member.membership === 'unknown') {
      universeKnown = false;
      warn('membership_unknown', 'Unconfirmed membership is not an exclusion or a sell signal.', member.symbol);
      continue;
    }
    if (member.membership === 'ineligible' || confirmedEnds.has(member.symbol)) {
      candidate.status = 'ineligible';
      candidate.reason = confirmedEnds.has(member.symbol) ? 'confirmed_membership_end' : 'known_ineligible';
      continue;
    }
    if (member.listingSession !== undefined) {
      if (!validDate(member.listingSession) || member.listingSession > input.asOfSession
        || (member.listingSession >= sessions[0] && !sessionSet.has(member.listingSession))) {
        invalidData = true;
        universeKnown = false;
        warn('invalid_listing_session', 'A verified listing session must be a valid exchange session at or before D0.', member.symbol);
        continue;
      }
      if (asOfIndex >= M40_POLICY.momentumSessions
        && member.listingSession > sessions[asOfIndex - M40_POLICY.momentumSessions]) {
        candidate.status = 'insufficient_listing_history';
        candidate.reason = 'verified_listing_after_lookback';
        continue;
      }
    }
    const window = asOfIndex >= M40_POLICY.momentumSessions
      ? sessions.slice(asOfIndex - M40_POLICY.momentumSessions, asOfIndex + 1) : [];
    if (window.length !== M40_POLICY.momentumSessions + 1 || window.some(session => !bars.has(session))) {
      universeKnown = false;
      warn('symbol_history_missing', 'All 127 split-adjusted closes from D0-126 through finalized D0 are required.', member.symbol);
      continue;
    }
    const momentum = bars.get(input.asOfSession)!.close / bars.get(window[0])!.close - 1;
    if (!Number.isFinite(momentum)) {
      invalidData = true;
      universeKnown = false;
      warn('invalid_momentum', 'Momentum must be a finite ratio of positive split-adjusted prices.', member.symbol);
      continue;
    }
    candidate.momentum = momentum;
    candidate.status = momentum > 0 ? 'ranked' : 'nonpositive';
    candidate.reason = momentum > 0 ? 'positive_126_session_momentum' : 'momentum_not_positive';
  }

  const owned = new Map<string, M40Holding[]>();
  for (const holding of input.holdings) {
    if (holding.strategyId !== strategyId) continue;
    owned.set(holding.symbol, [...(owned.get(holding.symbol) ?? []), holding]);
    if (!members.has(holding.symbol)) {
      universeKnown = false;
      warn('holding_membership_missing', 'An owned holding absent from the roster requires explicit membership evidence; it cannot silently exit.', holding.symbol);
    }
  }
  if ([...owned.values()].some(lots => !Number.isSafeInteger(lots.reduce((sum, lot) => sum + lot.quantity, 0)))) {
    result.status = 'invalid_input';
    result.gates.accountInput = 'fail';
    warn('invalid_account_input', 'Aggregated M40 share quantities must remain exact safe integers.');
    return result;
  }
  const ranked = candidates.filter(candidate => candidate.status === 'ranked').sort((a, b) =>
    b.momentum! - a.momentum! || compareSymbol(a.symbol, b.symbol));
  ranked.forEach((candidate, index) => { candidate.rank = index + 1; });

  // Quotes size proposed entries only; a missing sizing input never changes rank.
  const wouldSelect = result.gates.marketTrend === 'pass' ? ranked.slice(0, M40_POLICY.slots) : [];
  for (const candidate of wouldSelect) {
    if (owned.has(candidate.symbol)) continue;
    const quote = members.get(candidate.symbol)!.quote;
    const released = quote ? instant(quote.availableAt) : NaN;
    if (!quote || quote.session !== input.asOfSession || !positive(quote.price)
      || quote.priceBasis !== 'raw' || !Number.isFinite(released) || released > cutoff
      || new Date(released).toISOString().slice(0, 10) < quote.session) {
      universeKnown = false;
      warn('entry_quote_unknown', 'A current, already available raw quote is required to size a selected new entry.', candidate.symbol);
      if (quote && (quote.session > input.asOfSession || released > cutoff || quote.priceBasis !== 'raw')) invalidData = true;
    }
  }
  result.gates.universeData = universeKnown ? 'pass' : 'unknown';
  if (invalidData) result.status = 'invalid_input';
  else if (!universeKnown || result.gates.marketTrend === 'unknown') result.status = 'data_unknown';
  const baseReady = result.status === 'ready';
  if (baseReady) wouldSelect.forEach(candidate => { candidate.selected = true; });
  result.candidates = [
    ...ranked,
    ...candidates.filter(candidate => candidate.status !== 'ranked').sort((a, b) => compareSymbol(a.symbol, b.symbol)),
  ];

  const decisions: M40Decision[] = [];
  const exits = new Set<string>();
  const selected = new Set(baseReady ? wouldSelect.map(candidate => candidate.symbol) : []);
  for (const [symbol, lots] of [...owned].sort(([a], [b]) => compareSymbol(a, b))) {
    const confirmedExit = confirmedEnds.has(symbol);
    const scheduledExit = baseReady && result.isReviewSession && !selected.has(symbol);
    const action = !invalidData && (confirmedExit || scheduledExit) ? 'sell' : 'hold';
    if (action === 'sell') exits.add(symbol);
    const reason = action === 'sell'
      ? confirmedExit ? 'confirmed_membership_end'
        : result.gates.marketTrend === 'fail' ? 'market_gate_failed' : 'outside_top5'
      : !baseReady ? 'data_unknown_hold'
        : !result.isReviewSession ? 'between_reviews' : 'selected_retained_without_reweighting';
    decisions.push({
      symbol, strategyId, action, reason, quantity: lots.reduce((sum, lot) => sum + lot.quantity, 0),
      positionIds: lots.flatMap(lot => lot.positionId ? [lot.positionId] : []),
    });
  }

  if (baseReady && result.isReviewSession && result.gates.marketTrend === 'pass') {
    const projectedSymbols = new Set(input.holdings
      .filter(holding => holding.strategyId !== strategyId || !exits.has(holding.symbol))
      .map(holding => holding.symbol));
    let remainingCash = input.account.settledCashUsd;
    const entryBudget = input.account.equityUsd * M40_POLICY.entryBudgetFraction;
    for (const candidate of wouldSelect) {
      if (owned.has(candidate.symbol)) continue;
      if (input.holdings.some(holding => holding.symbol === candidate.symbol && holding.strategyId !== strategyId)) {
        warn('symbol_owned_by_other_strategy', 'Existing non-M40 ownership is preserved without adding a mixed-attribution position.', candidate.symbol);
        continue;
      }
      if (projectedSymbols.size >= M40_POLICY.slots) {
        warn('account_slot_limit', 'The five-symbol account limit includes legacy and other-strategy holdings.', candidate.symbol);
        continue;
      }
      const price = members.get(candidate.symbol)!.quote!.price;
      const spendLimit = Math.min(entryBudget, remainingCash);
      let quantity = Math.min(Number.MAX_SAFE_INTEGER,
        Math.floor(spendLimit / (price * (1 + M40_POLICY.feePerSide))));
      let notional = quantity * price;
      let fee = notional * M40_POLICY.feePerSide;
      let debit = notional + fee;
      // Guard floating-point boundary cases without ever rounding into overspend.
      while (quantity > 0 && (debit > spendLimit || !Number.isSafeInteger(quantity))) {
        quantity -= 1;
        notional = quantity * price;
        fee = notional * M40_POLICY.feePerSide;
        debit = notional + fee;
      }
      if (quantity <= 0) {
        warn('insufficient_settled_cash', 'Settled cash and the fee-inclusive 15% entry budget cannot fund one raw share.', candidate.symbol);
        continue;
      }
      decisions.push({
        symbol: candidate.symbol, strategyId, action: 'buy', reason: 'scheduled_top5_entry', quantity,
        referencePriceUsd: price, entryBudgetUsd: entryBudget, estimatedNotionalUsd: notional,
        estimatedFeeUsd: fee, estimatedDebitUsd: debit, requiresExitSymbols: [...exits].sort(compareSymbol),
      });
      remainingCash -= debit;
      projectedSymbols.add(candidate.symbol);
    }
  }
  if (input.advisories?.length) warn('advisories_shadow_only', 'Pattern and agent opinions were recorded without changing base trades.');
  result.decisions = decisions;
  return result;
}

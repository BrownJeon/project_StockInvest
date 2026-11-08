import { M40_POLICY, planM40 } from '../core';
import type { M40Bar, M40Input, M40Member } from '../types';

// A synthetic authoritative calendar, rather than calendar-day offsets, makes
// session-count regressions independent of holidays or the machine clock.
const sessions: string[] = [];
for (let date = new Date('2025-01-02T00:00:00Z'); sessions.length < 260; date.setUTCDate(date.getUTCDate() + 1)) {
  if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) sessions.push(date.toISOString().slice(0, 10));
}
const time = (session: string): string => `${session}T21:00:00Z`;

function member(symbol: string, lastClose = 120, asOfIndex = 220, rawPrice = 100): M40Member {
  return {
    symbol, membership: 'eligible',
    bars: sessions.slice(asOfIndex - 126, asOfIndex + 1).map((session, index) => ({
      session, close: index === 126 ? lastClose : 100, final: true,
      availableAt: time(session), priceBasis: 'split_adjusted',
    })),
    quote: { session: sessions[asOfIndex], price: rawPrice, availableAt: time(sessions[asOfIndex]), priceBasis: 'raw' },
  };
}

function fixture(asOfIndex = 220, epochIndex = 220): M40Input {
  return {
    asOfSession: sessions[asOfIndex], decisionTime: `${sessions[asOfIndex]}T21:30:00Z`,
    sessions, rebalanceEpochSession: sessions[epochIndex], universeComplete: true,
    marketBars: sessions.slice(asOfIndex - 200, asOfIndex).map((session, index) => ({
      session, close: index === 199 ? 110 : 100, final: true, availableAt: time(session), priceBasis: 'index',
    })),
    members: [member('AAA', 120, asOfIndex)], holdings: [],
    account: { equityUsd: 10_000, settledCashUsd: 10_000 },
  };
}

describe('M40 point-in-time base plan', () => {
  test('uses finalized D0 against D0-126, with fees inside the 15% budget', () => {
    const input = fixture();
    input.members = [member('AAA', 126)];
    const plan = planM40(input);
    expect(plan.status).toBe('ready');
    expect(plan.candidates[0].momentum).toBeCloseTo(0.26, 12);
    expect(plan.decisions).toEqual([expect.objectContaining({
      symbol: 'AAA', action: 'buy', quantity: 14, entryBudgetUsd: 1500,
      estimatedNotionalUsd: 1400, estimatedFeeUsd: 3.5, estimatedDebitUsd: 1403.5,
    })]);
    expect(M40_POLICY.feePerSide).toBe(0.0025);
  });

  test('sorts positive momentum first and breaks ties by symbol, selecting exactly five', () => {
    const input = fixture();
    input.members = [member('FFF', 110), member('BBB', 120), member('AAA', 120),
      member('DDD', 118), member('CCC', 119), member('EEE', 117), member('ZERO', 100), member('NEG', 90)];
    const plan = planM40(input);
    expect(plan.candidates.filter(row => row.selected).map(row => row.symbol)).toEqual(['AAA', 'BBB', 'CCC', 'DDD', 'EEE']);
    expect(plan.candidates.find(row => row.symbol === 'ZERO')?.status).toBe('nonpositive');
    expect(plan.candidates.find(row => row.symbol === 'NEG')?.status).toBe('nonpositive');
    expect(plan.decisions.filter(row => row.action === 'buy')).toHaveLength(5);
  });

  test('market gate ends strictly at D-1 even if D0 index collapses', () => {
    const input = fixture();
    const d0: M40Bar = { session: input.asOfSession, close: 1, final: true,
      availableAt: time(input.asOfSession), priceBasis: 'index' };
    input.marketBars = [...input.marketBars, d0];
    const plan = planM40(input);
    expect(plan.gates.marketReferenceSession).toBe(sessions[219]);
    expect(plan.gates.marketClose).toBe(110);
    expect(plan.gates.marketSma200).toBeCloseTo(100.05, 10);
    expect(plan.gates.marketTrend).toBe('pass');
    expect(plan.decisions[0].action).toBe('buy');
  });

  test('equality to SMA200 fails even when the unused D0 index is much higher', () => {
    const input = fixture();
    input.marketBars = [...input.marketBars.map(bar => ({ ...bar, close: 100 })), {
      session: input.asOfSession, close: 1000, final: true, availableAt: time(input.asOfSession), priceBasis: 'index',
    }];
    input.holdings = [{ symbol: 'AAA', quantity: 4, strategyId: 'm40' }];
    const plan = planM40(input);
    expect(plan.status).toBe('ready');
    expect(plan.gates.marketTrend).toBe('fail');
    expect(plan.decisions[0]).toMatchObject({ action: 'sell', quantity: 4, reason: 'market_gate_failed' });
  });

  test('a flat decimal index cannot pass the trend gate due to accumulation rounding', () => {
    const input = fixture();
    input.marketBars = input.marketBars.map(bar => ({ ...bar, close: 101.01 }));
    expect(planM40(input).gates.marketTrend).toBe('fail');
  });

  test.each([[220, true], [221, false], [239, false], [240, true]])(
    'keeps the global epoch on session index %i (review=%s)', (asOfIndex, review) => {
      expect(planM40(fixture(asOfIndex, 220)).isReviewSession).toBe(review);
    });

  test('daily observation cannot turn between-review loss of rank into a regular sale or buy', () => {
    const input = fixture(221, 220);
    input.members = [member('AAA', 90, 221), member('BBB', 140, 221)];
    input.holdings = [{ symbol: 'AAA', quantity: 20, strategyId: 'm40' }];
    const plan = planM40(input);
    expect(plan.candidates.find(row => row.symbol === 'BBB')?.selected).toBe(true);
    expect(plan.decisions).toEqual([expect.objectContaining({ symbol: 'AAA', action: 'hold', reason: 'between_reviews' })]);
  });

  test('a missing interior close makes the universe unknown instead of liquidating a holding', () => {
    const input = fixture();
    input.members = [member('AAA', 90), member('BBB', 140)];
    input.members[1].bars = input.members[1].bars.filter((_, index) => index !== 80);
    input.holdings = [{ symbol: 'AAA', quantity: 20, strategyId: 'm40' }];
    const plan = planM40(input);
    expect(plan.status).toBe('data_unknown');
    expect(plan.gates.universeData).toBe('unknown');
    expect(plan.decisions).toEqual([expect.objectContaining({ symbol: 'AAA', action: 'hold', reason: 'data_unknown_hold' })]);
    expect(plan.warnings).toContainEqual(expect.objectContaining({ code: 'symbol_history_missing', symbol: 'BBB' }));
  });

  test('only a verified recent listing distinguishes a young IPO from a data gap', () => {
    const input = fixture();
    input.members = [member('AAA'), { symbol: 'IPO', membership: 'eligible', listingSession: sessions[210], bars: [] }];
    const knownListing = planM40(input);
    expect(knownListing.status).toBe('ready');
    expect(knownListing.candidates.find(row => row.symbol === 'IPO')?.status).toBe('insufficient_listing_history');
    input.members[1].listingSession = undefined;
    expect(planM40(input).status).toBe('data_unknown');
  });

  test.each(['unknown-membership', 'incomplete-universe', 'missing-owned-symbol'])('%s holds existing positions', mode => {
    const input = fixture();
    input.holdings = [{ symbol: 'AAA', quantity: 10, strategyId: 'm40' }];
    if (mode === 'unknown-membership') input.members[0].membership = 'unknown';
    if (mode === 'incomplete-universe') input.universeComplete = false;
    if (mode === 'missing-owned-symbol') input.members = [member('BBB')];
    expect(planM40(input)).toMatchObject({ status: 'data_unknown', decisions: [expect.objectContaining({ action: 'hold' })] });
  });

  test('explicit membership end can exit daily despite unrelated missing data, preserving other-strategy lots', () => {
    const input = fixture(221, 220);
    input.universeComplete = false;
    input.members[0].confirmedMembershipEnd = {
      effectiveSession: input.asOfSession, confirmedAt: `${sessions[220]}T12:00:00Z`, source: 'exchange notice',
    };
    input.holdings = [{ symbol: 'AAA', quantity: 7, strategyId: 'm40', positionId: 'm40-lot' },
      { symbol: 'AAA', quantity: 99, strategyId: 'legacy', positionId: 'legacy-lot' }];
    const plan = planM40(input);
    expect(plan.status).toBe('data_unknown');
    expect(plan.decisions).toEqual([expect.objectContaining({ action: 'sell', quantity: 7,
      positionIds: ['m40-lot'], reason: 'confirmed_membership_end' })]);
  });

  test('a future membership confirmation cannot be used to justify a current exit', () => {
    const input = fixture();
    input.members[0].confirmedMembershipEnd = {
      effectiveSession: input.asOfSession, confirmedAt: time(sessions[221]), source: 'future notice',
    };
    input.holdings = [{ symbol: 'AAA', quantity: 7, strategyId: 'm40' }];
    const plan = planM40(input);
    expect(plan.status).toBe('invalid_input');
    expect(plan.decisions[0].action).toBe('hold');
  });

  test.each(['future-session', 'future-release', 'unfinished', 'wrong-basis', 'duplicate-session'])(
    'rejects %s price observations without generating trades', mode => {
      const input = fixture();
      const bars = input.members[0].bars.map(bar => ({ ...bar }));
      if (mode === 'future-session') bars.push({ ...bars[126], session: sessions[221], availableAt: time(sessions[221]) });
      if (mode === 'future-release') bars[126].availableAt = `${input.asOfSession}T22:00:00Z`;
      if (mode === 'unfinished') bars[126].final = false;
      if (mode === 'wrong-basis') bars[126].priceBasis = 'index';
      if (mode === 'duplicate-session') bars.push({ ...bars[126] });
      input.members[0].bars = bars;
      expect(planM40(input)).toMatchObject({ status: 'invalid_input', decisions: [] });
    });

  test('split-adjusted ranking prices never size raw shares', () => {
    const input = fixture();
    input.members = [member('AAA', 1000, 220, 25)];
    const buy = planM40(input).decisions[0];
    expect(buy).toMatchObject({ action: 'buy', quantity: 59, referencePriceUsd: 25, estimatedDebitUsd: 1478.6875 });
    expect(Number.isInteger(buy.quantity)).toBe(true);
  });

  test('expected sale proceeds do not fund a replacement before settlement', () => {
    const input = fixture();
    input.members = [member('AAA', 90), member('BBB', 140)];
    input.holdings = [{ symbol: 'AAA', quantity: 100, strategyId: 'm40' }];
    input.account.settledCashUsd = 0;
    const plan = planM40(input);
    expect(plan.decisions).toEqual([expect.objectContaining({ symbol: 'AAA', action: 'sell' })]);
    expect(plan.warnings).toContainEqual(expect.objectContaining({ code: 'insufficient_settled_cash', symbol: 'BBB' }));
  });

  test('replacement buys use existing settled cash and carry explicit exit prerequisites', () => {
    const input = fixture();
    input.members = [member('AAA', 90), member('BBB', 140)];
    input.holdings = [{ symbol: 'AAA', quantity: 100, strategyId: 'm40' }];
    const plan = planM40(input);
    expect(plan.decisions.find(row => row.action === 'buy')).toMatchObject({
      symbol: 'BBB', quantity: 14, requiresExitSymbols: ['AAA'],
    });
  });

  test('legacy and other-strategy symbols consume account slots but are never sold', () => {
    const input = fixture();
    input.members = [member('AAA', 120), member('BBB', 140), member('CCC', 139), member('DDD', 138), member('EEE', 137)];
    input.holdings = [{ symbol: 'AAA', quantity: 3, strategyId: 'm40' },
      ...['LEG1', 'LEG2', 'LEG3', 'LEG4'].map(symbol => ({ symbol, quantity: 2, strategyId: null }))];
    const plan = planM40(input);
    expect(plan.decisions).toEqual([expect.objectContaining({ symbol: 'AAA', action: 'hold' })]);
    expect(plan.warnings.filter(row => row.code === 'account_slot_limit')).toHaveLength(4);
  });

  test('retained holdings are not resized after their account weight drifts', () => {
    const input = fixture();
    input.holdings = [{ symbol: 'AAA', quantity: 70, strategyId: 'm40' }];
    input.account.settledCashUsd = 3000;
    expect(planM40(input).decisions).toEqual([expect.objectContaining({
      symbol: 'AAA', action: 'hold', quantity: 70, reason: 'selected_retained_without_reweighting',
    })]);
  });

  test('does not add mixed-attribution shares to another strategy position', () => {
    const input = fixture();
    input.holdings = [{ symbol: 'AAA', quantity: 9, strategyId: 'other' }];
    const plan = planM40(input);
    expect(plan.decisions).toEqual([]);
    expect(plan.warnings).toContainEqual(expect.objectContaining({ code: 'symbol_owned_by_other_strategy' }));
  });

  test('spends only settled cash in rank order without borrowing or filling with rank six', () => {
    const input = fixture();
    input.members = [member('AAA', 160), member('BBB', 150), member('CCC', 140), member('DDD', 130), member('EEE', 120), member('FFF', 110)];
    input.account.settledCashUsd = 1500;
    const buys = planM40(input).decisions.filter(row => row.action === 'buy');
    expect(buys.map(row => row.symbol)).toEqual(['AAA']);
    expect(buys.reduce((sum, row) => sum + row.estimatedDebitUsd!, 0)).toBeLessThanOrEqual(1500);
    input.members[0].quote!.price = 2000;
    expect(planM40(input).decisions.filter(row => row.action === 'buy').map(row => row.symbol)).toEqual(['BBB']);
    expect(planM40(input).decisions.some(row => row.symbol === 'FFF')).toBe(false);
  });

  test('agent and pattern suggestions remain shadows, including a direct sell recommendation', () => {
    const input = fixture();
    input.holdings = [{ symbol: 'AAA', quantity: 7, strategyId: 'm40' }];
    const base = planM40(input);
    input.advisories = [{ symbol: 'AAA', source: 'agent', suggestedAction: 'sell' },
      { symbol: 'ZZZ', source: 'pattern', suggestedAction: 'buy' }];
    const shadow = planM40(input);
    expect(shadow.decisions).toEqual(base.decisions);
    expect(shadow.candidates).toEqual(base.candidates);
    expect(shadow.advisories).toEqual(input.advisories);
  });

  test.each(['duplicate', 'unordered', 'missing-epoch', 'impossible-date'])('rejects a %s session calendar', mode => {
    const input = fixture();
    if (mode === 'duplicate') input.sessions = [...sessions, sessions[259]];
    if (mode === 'unordered') input.sessions = [sessions[1], sessions[0], ...sessions.slice(2)];
    if (mode === 'missing-epoch') input.rebalanceEpochSession = '1990-01-02';
    if (mode === 'impossible-date') input.sessions = ['2025-02-30', ...sessions];
    expect(planM40(input)).toMatchObject({ status: 'invalid_input', decisions: [], gates: { sessionInput: 'fail' } });
  });

  test('a missing D-1 market row is unknown, not a confirmed failed trend', () => {
    const input = fixture();
    input.marketBars = input.marketBars.slice(0, -1);
    input.holdings = [{ symbol: 'AAA', quantity: 7, strategyId: 'm40' }];
    const plan = planM40(input);
    expect(plan.gates.marketTrend).toBe('unknown');
    expect(plan.decisions[0].action).toBe('hold');
  });

  test('a stale selected-entry quote defers the whole regular rebalance', () => {
    const input = fixture();
    input.members = [member('AAA', 90), member('BBB', 140)];
    input.members[1].quote!.session = sessions[219];
    input.holdings = [{ symbol: 'AAA', quantity: 8, strategyId: 'm40' }];
    expect(planM40(input)).toMatchObject({ status: 'data_unknown', decisions: [expect.objectContaining({ action: 'hold' })] });
  });

  test('even an unused future raw quote is rejected rather than admitted into the snapshot', () => {
    const input = fixture();
    input.members = [member('AAA', 90)];
    input.members[0].quote!.availableAt = time(sessions[221]);
    expect(planM40(input)).toMatchObject({ status: 'invalid_input', decisions: [] });
  });

  test('ownership keys are explicit and can use the persisted strategy identifier', () => {
    const input = fixture();
    input.strategyId = 'm40-v1';
    input.members = [member('AAA', 90)];
    input.holdings = [{ symbol: 'AAA', quantity: 8, strategyId: 'm40-v1' },
      { symbol: 'AAA', quantity: 3, strategyId: 'm40' }];
    expect(planM40(input).decisions).toEqual([expect.objectContaining({ strategyId: 'm40-v1', action: 'sell', quantity: 8 })]);
  });

  test('rejects account values that could fabricate buying cash or fractional M40 shares', () => {
    const input = fixture();
    input.account.settledCashUsd = 10_001;
    expect(planM40(input)).toMatchObject({ status: 'invalid_input', gates: { accountInput: 'fail' }, decisions: [] });
    input.account.settledCashUsd = 100;
    input.holdings = [{ symbol: 'AAA', quantity: 1.5, strategyId: 'm40' }];
    expect(planM40(input).status).toBe('invalid_input');
  });

  test('never mutates the snapshot and produces identical results on replay', () => {
    const input = fixture();
    input.members = [member('BBB', 120), member('AAA', 120)];
    const before = JSON.stringify(input);
    const first = planM40(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(planM40(input)).toEqual(first);
  });
});

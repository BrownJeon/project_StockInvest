# T-156 forecast engine v1: Analyst evidence and numerical contract

Read-only production inspection: 2026-11-08 KST. No collection, DDL, writes, process changes, forward advancement, signal submission, or model invocation performed.

## Confirmed available material

- Published research dataset `t156-research-db-20261108`: verification clock `2026-11-08T01:53:37.234Z`; liveEligible=false. Historic first observation remains unknown.
- `kibot_free_regular_raw_20261107`: 858,628 rows, 125 tickers, date extent 1990-01-02 through 2026-11-06; all raw/unadjusted, publication clocks null, identity `current_label_history_not_identity_audited`. Extent does not establish every symbol's full-period coverage.
- `kibot_guest_raw`: 1,855,428 rows across overlapping identity groups (19,635 known-discontinuity rows; remainder vendor-symbol-unverified). All raw, publication unknown. Do not count overlapping sources as independent evidence or treat raw split jumps as asset returns.
- Latest archived forward bundle: hash verified against record pointer; asOf 2026-11-06; observedAt `2026-11-08T04:47:15.366Z`; 252 stock variants, 126 split-adjusted symbol records; index 463 rows ending 2026-11-05. `complete=true` means transport completeness, not full analytical eligibility.
- All 126 symbols share only 102 dates. Existing approved exclusions NAS:HONA/NAS:SPCX yield frozen cohort 124 symbols and 299 common split dates. Intersection with the index is 298 dates, 2025-09-02 through 2026-11-05. About 297 joint returns are available before additionally enforcing exact canonical consecutive sessions.
- Paper account exists, revision 1, active, frozen cohort exists, epoch=null, lastForwardSession=null, one rehearsal and no forward cycle. Cash, receivables and holdings are structurally present. Every held symbol has 2026-11-06 raw mark and split history in the archived bundle. Account amounts, quantities and identities were not emitted.
- Backfill calendar currently ends 2026-11-06 (9,281 rows); future target session calendar must come from separately verified exchange-calendar logic. The index's missing 11/6 cannot be silently forward-filled as an observed return.

## Issuable baseline without advancing forward T0

A new private, immutable `forecast_only_marked_snapshot` can copy the current paper book revision and mark every holding at the final 2026-11-06 raw USD close. Validate share-basis continuity, all holdings, cash and receivables; include source clocks and hashes. Record actual current issuedAt/observedAt, source mark session, account revision and account identity separately. Never substitute `initialEquityUsd` or the historic clone total for this mark.

This snapshot does not establish a first forward cycle, change cohort/epoch, fill an intent, or mutate the paper book. Future actual comparison requires matching account, baseline, cash-flow treatment, policy hash and rebalance phase. With forward epoch still unset, a forecast-specific provisional schedule must be explicitly labelled and may remain noncomparable until a prospective continuation is anchored to precisely that schedule. It must not be presented as already matching the future operational account path. An explicit forecast-only continuation book is another valid branch; it is distinct from the existing forward account and cannot be quietly substituted for that account's actual performance.

## Proposed scenario model

Use a synchronized multivariate moving-block bootstrap of split-only close returns and index returns. Every block picks one source date range for the whole vector, preserving observed cross-asset dependence; never independently sample symbols. Initial implementation: block length 10 sessions, 2,000 paths, fixed recorded PRNG/seed. Run fixed diagnostic sensitivity at block lengths 5 and 20 without choosing the most profitable result. Reject invalid/nonpositive prices and missing canonical consecutive observations; do not bridge gaps. Do not infer annual price behavior by multiplying a week return.

Initial history is the actual trailing 200 index sessions and 127 stock sessions. Append sampled returns to synthetic histories and replay the existing reviewed `planM40` policy (126 momentum, 200 SMA, 20-session review, five slots, fee-inclusive 15% budget, 0.0025 each transacted side). Use current raw marks as synthetic price scale and split returns as relative changes. Dividends, FX conversion and future corporate actions are excluded assumptions, not zero-risk facts. Future split/cash events in observed comparison require reconciliation.

Execution must preserve existing next-open, fixed-quantity-or-expire, pending sells-before-buys, integer shares, settled cash, receivables/settlement, holding attribution and existing positions. To preserve next-open semantics, obtain joint historical open/close components from the paired raw/split records: split-consistent adjusted-open = raw-open times (split-close/raw-close). Bootstrap overnight and intraday components jointly with each whole date vector. If that contract is not implemented, label the result a different close-price execution scenario and do not call it same-policy actual-comparable.

Trend/drawdown are current initial conditions and explainers. With only ~297 returns, avoid fitting separate regime probabilities or optimizing weights/strategy parameters. Joint blocks already carry local regimes; any conditioning is a separate model version and needs held-out validation. Agent/news commentary remains nontrading and cannot alter probabilities without a specified separately validated model.

## Outputs and sample honesty

For each canonical target (calendar week/month/3 months/year mapped using the established product convention), compute the actual number of exchange sessions to target. Generate one longest path and take shorter-horizon prefixes, ensuring common T0 and coherent nested results.

Path return = (target equity - baseline equity) / baseline equity, including modeled trading fees. Report mean, P10/P50/P90 with recorded quantile convention, USD profit/loss (private owner view), and loss probability `count(return < 0) / successfulPaths`. Never drop failed paths quietly: invalid path is a run failure unless a documented validity rule exists independently of its outcome. No artificial fee on unchanged holdings or final mark-only valuation.

Report Monte Carlo SE `sqrt(p*(1-p)/B)` (at B=2000 maximum approximately 1.12 percentage points), clearly distinct from model/calibration uncertainty. Also show unique historical returns (~297), block length, distinct possible block starts, `floor(N/blockLength)` nonoverlapping block count (29 for N=297,L=10), and `floor(N/horizonSessions)` historical nonoverlapping horizon-window count (about one for one year). None is a proven effective-independent sample size; overlapping observations and bootstrapped paths are not independent empirical forecasts.

Recommended v1 eligibility floor: >=252 consecutive joint historical return observations, >=200 index warmup levels, >=127 candidate levels, valid marked book, known-by-issue clocks and complete target calendar. This permits an explicitly uncalibrated research scenario with current data. It does not validate annual loss probability. If the floor is missed, identify the missing field/count; do not manufacture output. To describe probabilities as prospectively calibrated, predefine >=30 nonoverlapping matured horizon observations plus Brier score, 80% interval coverage and uncertainty, and compare against simple baselines. This is a reporting threshold, not a statistical guarantee; one-year calibration requires much longer history or another justified validation design.

## Immutable forecast and actual comparison

Persist source dataset/hash, original blobs/hashes, availability basis, firstObservedAt (nullable, never invented), cutoff/issuedAt, snapshot hash/revision, cohort and policy hash, model version/seed/block length/path count, calendar version, horizon endpoints, initial book, assumptions, distribution and qualifying status. Record all current source observations <=issuedAt; historical research verification is not historical public availability. Never insert a forecast with a past issuedAt.

Actual evaluation is append-only and references immutable forecast id/hash. Require canonical endpoint mark and every required session/event through target; reject partial coverage, mismatching account/policy/phase, unresolved corporate action, unhandled deposits/withdrawals or missing marks. Keep status pending/not_comparable with reason rather than replacing the original forecast. Target observations are never inputs to their own historical forecast, even if a later snapshot contains them.

## Numerical and adversarial checks

1. Flat prices and no trades: every horizon return=0, P10=P50=P90=mean=0, lossProbability=0. If fee is charged, implementation is wrong.
2. Baseline cash 1,000, buy 10 shares at 10 with side fee .0025: cash 899.75, marked equity 999.75. Sell 10 at 10 later: final cash 999.50 after settlement, return=-.0005; fee debit exactly .50. These are synthetic unit-test amounts, not account data.
3. Cash 100, raw share 100: one-share fee-inclusive buy is unaffordable; shares=0. Cash 100.25 permits one only when policy budget also permits it.
4. Raw 100 to 50 due to 2:1 split while adjusted levels are 50 to 50: return shock must be zero; unresolved share count blocks actual mark/comparison.
5. Identical symbol return columns stay identical in every sampled path; anti-correlated columns retain their paired relationship.
6. Adding future rows after cutoff cannot change serialized input or seeded forecast output. A later correction creates new forecast version, never overwrites old row.
7. Missing one held-symbol mark blocks baseline. Missing one canonical return day cannot become a two-day return masquerading as one day.
8. Same seed/input gives byte-identical results, source-order permutations normalize identically, differing seeds do not overwrite original.
9. Failed/NaN/extreme overflow path cannot be omitted to improve loss frequency. Empty denominator is unavailable, never 0%.
10. Rehearsal cycle/clone amount cannot satisfy forward-origin actual comparison; policy changes, first forward epoch mismatch and endpoint lag remain explicit noncomparability.

## Follow-up: specification freeze and missing index anchor

Root confirmed proposal: provisional forecast epoch = next canonical session, without changing operational T0; actual comparison rejects a genuinely different phase, not every account revision increment.

Fresh read of FRED CSV for 2026-11-05..06 returned only 2026-11-05=7353.73. Stooq returned JavaScript browser verification instead of prices; it was not bypassed. No external source was persisted or treated as newly verified 11/6 index data.

If a current genuine 11/6 index close cannot be sourced, a declared latent index bridge is a valid additional model assumption: on the eligible historical joint panel fit index daily return on equally weighted frozen-cohort daily return with intercept. Feed the actually observed 11/6 cohort return to this regression and independently draw a centered historical residual for each path, yielding a distribution for the missing 11/6 index return. Then continue joint block paths. Record coefficients, fitting dates, residual distribution hash and the unknown-index date; never mark this latent value as an observed final price. Bootstrap randomness here concerns index uncertainty only; initial account equity still uses actual 11/6 raw marks. OLS diagnostics, degenerate predictor variance and nonpositive implied index levels require explicit validation. This is an unvalidated approximation, not an official nowcast or calibrated probability. If undesired, await genuine index data rather than inventing a final observation.

Budget proposal: B=2000, L=10, <=260 projected sessions, 124 symbols (~65 million symbol-day updates). Update rolling means/momentum efficiently; full policy reviews occur every 20 sessions, while exits/settlement/valuation retain their actual daily semantics. Benchmark a 60–120 second execution budget in isolation. Abort the run explicitly if exceeded; do not silently reduce the denominator or emit partial successful paths. This is an operation budget proposal, not a measured CPU benchmark.

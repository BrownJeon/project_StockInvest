import { buildPaperInput,canFreezePaperCohort } from '../forward-input';
import { extendForwardCalendar } from '../forward-calendar';
import { planM40 } from '../core';
import type {
  ForwardCalendarSession, ForwardInputData, ForwardMemberData, ForwardPaperAccount,
  ForwardPolicy, ForwardPriceBar,
} from '../forward-types';

const historical:ForwardCalendarSession[]=[{session:'2025-12-31',openAt:'2025-12-31T14:30:00Z',
  closeAt:'2025-12-31T21:00:00Z',source:'historical_canonical'}];
const calendar=extendForwardCalendar(historical,'2027-12-31');

function fixture(asOfSession='2026-11-09'):{data:ForwardInputData;policy:ForwardPolicy;account:ForwardPaperAccount;cutoff:string} {
  const index=calendar.findIndex(item=>item.session===asOfSession);
  const observedAt=asOfSession==='2026-11-06'?'2026-11-08T00:30:00Z':`${asOfSession}T22:00:00Z`;
  const cutoff=asOfSession==='2026-11-06'?'2026-11-08T01:00:00Z':`${asOfSession}T22:30:00Z`;
  const bar=(session:string,close:number,market=false):ForwardPriceBar=>({session,close,final:true,observedAt,
    sourceId:market?'sp500_index_observation':'kibot_split_only_evaluation',sourceVariant:market?'index':'split_only',
    sha256:'a'.repeat(64),currency:market?'INDEX':'USD',qualification:'evaluation_only'});
  const member=(symbol:string,last:number):ForwardMemberData=>({symbol,
    splitBars:calendar.slice(index-126,index+1).map((item,offset)=>bar(item.session,offset===126?last:100)),
    rawQuote:{session:asOfSession,price:100,final:true,observedAt,sourceId:'kibot_raw_evaluation',sourceVariant:'raw',
      sha256:'b'.repeat(64),currency:'USD',qualification:'evaluation_only'}});
  return {cutoff,
    data:{asOfSession,calendar,members:[member('NAS:AAA',120),member('NYS:BBB',130)],
      sp500Bars:calendar.slice(index-200,index).map((item,offset)=>bar(item.session,100+offset/10,true))},
    policy:{policyId:'paper-policy-test',strategyId:'m40-paper-v1',registeredAt:'2026-11-08T00:00:00Z',
      referenceSymbols:['NAS:AAA','NYS:BBB'],epochSession:null,
      frozenCohort:{symbols:['NAS:AAA','NYS:BBB'],excluded:[],asOfSession:'2026-11-06',frozenAt:'2026-11-08T00:40:00Z'}},
    account:{equityUsd:10000,settledCashUsd:10000,holdings:[],clonedAt:'2026-11-08T00:10:00Z',cloneSha256:'c'.repeat(64)},
  };
}

describe('qualified paper M40 input without a default policy',()=>{
  test('old Nov6 warmup remains a strict core rehearsal, never the forward epoch',()=>{
    const f=fixture('2026-11-06');
    const result=buildPaperInput(f.data,f.policy,f.account,f.cutoff);
    expect(result.report).toMatchObject({coreEligible:true,forwardEligible:false,epochProvisional:true,epochCandidate:null,
      cohortLabel:'limited_reference_cohort',executionScope:'paper_only',liveEligible:false});
    expect(result.report.issues).toContain('session_not_prospective_after_registration');
    expect(result.input?.rebalanceEpochSession).toBe('2026-11-06');
    expect(planM40(result.input!).status).toBe('ready');
    expect(f.policy.epochSession).toBeNull();
  });

  test('first prospective qualified D0 proposes one epoch without persisting or mutating it',()=>{
    const f=fixture();const before=JSON.stringify(f);
    const result=buildPaperInput(f.data,f.policy,f.account,f.cutoff);
    expect(result.report).toMatchObject({coreEligible:true,forwardEligible:true,asOfLatestCompleted:true,epochProvisional:true,epochCandidate:'2026-11-09'});
    expect(result.input).toMatchObject({strategyId:'m40-paper-v1',rebalanceEpochSession:'2026-11-09',universeComplete:true});
    expect(JSON.stringify(f)).toBe(before);
    expect(f.policy.epochSession).toBeNull();
    expect(buildPaperInput(f.data,f.policy,f.account,f.cutoff)).toEqual(result);
  });

  test('a locked epoch is retained on the next day and cannot reset at each snapshot',()=>{
    const f=fixture('2026-11-10');f.policy.epochSession='2026-11-09';f.policy.epochLockedAt='2026-11-09T22:30:00Z';
    const result=buildPaperInput(f.data,f.policy,f.account,f.cutoff);
    expect(result.report).toMatchObject({forwardEligible:true,epochProvisional:false,epochCandidate:null});
    expect(result.input?.rebalanceEpochSession).toBe('2026-11-09');
    expect(planM40(result.input!).isReviewSession).toBe(false);
    expect(f.data.members[0].splitBars[0].observedAt>f.policy.epochLockedAt).toBe(true);
    f.policy.epochSession='2026-11-06';
    expect(buildPaperInput(f.data,f.policy,f.account,f.cutoff).report.issues).toContain('invalid_or_nonprospective_epoch');
  });

  test('an unknown first-epoch lock or a stamp without an epoch cannot establish a forward cycle',()=>{
    const f=fixture();f.policy.epochSession='2026-11-09';
    expect(buildPaperInput(f.data,f.policy,f.account,f.cutoff).report.issues).toContain('invalid_epoch_lock_proof');
    f.policy.epochSession=null;f.policy.epochLockedAt=f.cutoff;
    expect(buildPaperInput(f.data,f.policy,f.account,f.cutoff).report.issues).toContain('epoch_lock_without_session');
  });

  test.each(['2026-11-06T22:30:00Z','2026-11-08T00:05:00Z','2026-11-09T22:30:00.000001Z','not-a-clock'])(
    'rejects an unproven, premature or future epoch lock %s',epochLockedAt=>{
      const f=fixture();f.policy.epochSession='2026-11-09';f.policy.epochLockedAt=epochLockedAt;
      const result=buildPaperInput(f.data,f.policy,f.account,f.cutoff);
      expect(result.input).toBeNull();expect(result.report.forwardEligible).toBe(false);
      expect(result.report.issues).toContain('invalid_epoch_lock_proof');
    });

  test('first-day locking follows actual source receipt, while a later day can use newer observations',()=>{
    const first=fixture();first.policy.epochSession='2026-11-09';first.policy.epochLockedAt='2026-11-09T21:30:00Z';
    expect(buildPaperInput(first.data,first.policy,first.account,first.cutoff).report.issues).toContain('epoch_lock_precedes_source_observation');
    first.policy.epochLockedAt=first.cutoff;
    expect(buildPaperInput(first.data,first.policy,first.account,first.cutoff).report.forwardEligible).toBe(true);
    const later=fixture('2026-11-10');later.policy.epochSession='2026-11-09';later.policy.epochLockedAt=first.cutoff;
    expect(buildPaperInput(later.data,later.policy,later.account,later.cutoff).report.forwardEligible).toBe(true);
  });

  test('T0 is a session date: its lock may follow the close, clone and cohort freeze',()=>{
    const f=fixture();f.policy.epochSession='2026-11-09';f.policy.epochLockedAt=f.cutoff;
    f.account.clonedAt='2026-11-09T22:05:00Z';f.policy.frozenCohort!.frozenAt='2026-11-09T22:10:00Z';
    expect(buildPaperInput(f.data,f.policy,f.account,f.cutoff).report.forwardEligible).toBe(true);
    f.policy.epochLockedAt='2026-11-09T22:09:59Z';
    expect(buildPaperInput(f.data,f.policy,f.account,f.cutoff).report.issues).toContain('invalid_epoch_lock_proof');
  });

  test('first-epoch source-receipt proof retains microsecond precision',()=>{
    const f=fixture();f.policy.epochSession='2026-11-09';
    f.data.members[0].splitBars[0].observedAt='2026-11-09T22:00:00.123456Z';
    f.policy.epochLockedAt='2026-11-09T22:00:00.123455Z';
    expect(buildPaperInput(f.data,f.policy,f.account,f.cutoff).report.issues).toContain('epoch_lock_precedes_source_observation');
    f.policy.epochLockedAt='2026-11-09T22:00:00.123456Z';
    expect(buildPaperInput(f.data,f.policy,f.account,f.cutoff).report.forwardEligible).toBe(true);
  });

  test('initial cohort qualification uses continuous prices and raw quotes, not positive winners',()=>{
    const f=fixture('2026-11-06');f.policy.frozenCohort=null;
    f.data.members[1].splitBars[126].close=90;
    const result=buildPaperInput(f.data,f.policy,f.account,f.cutoff);
    expect(result.report.cohortProposal?.symbols).toEqual(['NAS:AAA','NYS:BBB']);
    expect(result.report.forwardEligible).toBe(false);
    expect(result.report.epochCandidate).toBeNull();
    f.data.members[1].splitBars=f.data.members[1].splitBars.filter((_,index)=>index!==40);
    const missing=buildPaperInput(f.data,f.policy,f.account,f.cutoff);
    expect(missing.report.cohortProposal?.symbols).toEqual(['NAS:AAA']);
    expect(missing.report.cohortProposal?.excluded).toEqual([{symbol:'NYS:BBB',issues:['split_127_session_history_missing']}]);
    expect(missing.report.coreEligible).toBe(true);
  });

  test('a missing frozen member blocks the entire core instead of creating a partial ranked universe',()=>{
    const f=fixture();f.data.members[1].splitBars=f.data.members[1].splitBars.filter((_,index)=>index!==55);
    const result=buildPaperInput(f.data,f.policy,f.account,f.cutoff);
    expect(result.input).toBeNull();
    expect(result.report.coreEligible).toBe(false);
    expect(result.report.issues).toContain('frozen_member_unqualified:NYS:BBB');
    expect(result.report.cohortProposal).toBeNull();
  });

  test.each(['unrelated-stock-gap','market-history-gap'])(
    'a locked policy preserves only a confirmed membership exit through %s on a nonreview day',gap=>{
      const f=fixture('2026-11-10');f.policy.epochSession='2026-11-09';f.policy.epochLockedAt='2026-11-09T22:30:00Z';
      f.account.holdings=[{symbol:'NAS:AAA',quantity:5,strategyId:'m40-paper-v1'},
        {symbol:'NYS:BBB',quantity:2,strategyId:'m40-paper-v1'}];f.account.settledCashUsd=9300;
      f.data.members[0].confirmedMembershipEnd={effectiveSession:'2026-11-10',confirmedAt:'2026-11-10T12:00:00Z',source:'Explicit exchange notice'};
      f.data.members[0].splitBars=[];
      if(gap==='unrelated-stock-gap')f.data.members[1].splitBars=f.data.members[1].splitBars.slice(1);
      else f.data.sp500Bars=[];
      const result=buildPaperInput(f.data,f.policy,f.account,f.cutoff);
      expect(result.input).toBeNull();expect(result.report.coreEligible).toBe(false);
      expect(result.report.forwardEligible).toBe(false);expect(result.report.epochCandidate).toBeNull();expect(result.report.cohortProposal).toBeNull();
      expect(result.report.issues).toContain('confirmed_membership_end_only');
      expect(result.confirmedOnlyInput?.universeComplete).toBe(false);
      const plan=planM40(result.confirmedOnlyInput!);
      expect(plan.status).toBe('data_unknown');expect(plan.isReviewSession).toBe(false);
      expect(plan.decisions.filter(decision=>decision.action!=='hold')).toEqual([
        expect.objectContaining({symbol:'NAS:AAA',action:'sell',quantity:5,reason:'confirmed_membership_end'}),
      ]);
      expect(plan.decisions).toContainEqual(expect.objectContaining({symbol:'NYS:BBB',action:'hold'}));
    });

  test.each(['missing-lock','no-end-proof','unknown-affected-quote','future-end-proof','bad-currency','future-price-clock','bad-account'])(
    'confirmed-only fallback cannot bypass %s',failure=>{
      const f=fixture('2026-11-10');f.policy.epochSession='2026-11-09';f.policy.epochLockedAt='2026-11-09T22:30:00Z';
      f.account.holdings=[{symbol:'NAS:AAA',quantity:5,strategyId:'m40-paper-v1'}];f.account.settledCashUsd=9500;
      f.data.members[0].confirmedMembershipEnd={effectiveSession:'2026-11-10',confirmedAt:'2026-11-10T12:00:00Z',source:'Explicit exchange notice'};
      f.data.members[0].splitBars=[];f.data.sp500Bars=[];
      if(failure==='missing-lock'){f.policy.epochSession=null;f.policy.epochLockedAt=null;}
      if(failure==='no-end-proof')f.data.members[0].confirmedMembershipEnd=undefined;
      if(failure==='unknown-affected-quote')f.data.members[0].rawQuote=undefined;
      if(failure==='future-end-proof')f.data.members[0].confirmedMembershipEnd!.confirmedAt='2026-11-11T00:00:00Z';
      if(failure==='bad-currency')f.data.members[1].rawQuote!.currency='INDEX';
      if(failure==='future-price-clock')f.data.members[1].splitBars[0].observedAt='2026-11-11T00:00:00Z';
      if(failure==='bad-account')f.account.holdings[0].quantity=0.5;
      const result=buildPaperInput(f.data,f.policy,f.account,f.cutoff);
      expect(result.input).toBeNull();expect(result.confirmedOnlyInput).toBeUndefined();expect(result.report.epochCandidate).toBeNull();
    });

  test('an initially excluded name is not added after it later becomes the largest momentum winner',()=>{
    const f=fixture();f.policy.frozenCohort={...f.policy.frozenCohort!,symbols:['NAS:AAA'],
      excluded:[{symbol:'NYS:BBB',issues:['split_127_session_history_missing']}]};
    f.data.members[1].splitBars[126].close=1000;
    const result=buildPaperInput(f.data,f.policy,f.account,f.cutoff);
    expect(result.report.coreEligible).toBe(true);
    expect(result.input?.members.find(member=>member.symbol==='NYS:BBB')?.membership).toBe('ineligible');
    expect(planM40(result.input!).decisions.filter(decision=>decision.action==='buy').map(decision=>decision.symbol)).toEqual(['NAS:AAA']);
  });

  test('cloned holdings outside the reference cohort stay visible for known regular exits with raw valuation prices',()=>{
    const f=fixture();
    f.data.members=[...f.data.members,{symbol:'NAS:HELD',splitBars:[],rawQuote:{...f.data.members[0].rawQuote!}}];
    f.account.holdings=[{symbol:'NAS:HELD',quantity:7,strategyId:'m40-paper-v1',positionId:'paper-cloned-1'}];
    f.account.settledCashUsd=9300;
    const result=buildPaperInput(f.data,f.policy,f.account,f.cutoff);
    expect(result.report.coreEligible).toBe(true);
    expect(result.input?.members.find(member=>member.symbol==='NAS:HELD')).toMatchObject({membership:'ineligible',bars:[]});
    expect(result.input?.members.find(member=>member.symbol==='NAS:HELD')?.confirmedMembershipEnd).toBeUndefined();
    expect(planM40(result.input!).decisions).toContainEqual(expect.objectContaining({symbol:'NAS:HELD',action:'sell',quantity:7}));
    f.data.members[2].rawQuote=undefined;
    expect(buildPaperInput(f.data,f.policy,f.account,f.cutoff).report.issues).toContain('held_raw_quote_unavailable:NAS:HELD');
  });

  test.each([0.5,-1,NaN])('blocks fractional/invalid cloned shares %s',quantity=>{
    const f=fixture();f.account.holdings=[{symbol:'NAS:AAA',quantity,strategyId:'m40-paper-v1'}];
    expect(buildPaperInput(f.data,f.policy,f.account,f.cutoff).report.issues).toContain('invalid_paper_holding_quantity');
  });

  test('cash-only accounts and zero-quantity tombstones need no fabricated positions',()=>{
    const f=fixture();f.account.holdings=[{symbol:'NAS:ZERO',quantity:0,strategyId:null}];
    const result=buildPaperInput(f.data,f.policy,f.account,f.cutoff);
    expect(result.report.coreEligible).toBe(true);
    expect(result.input?.holdings).toEqual([]);
    f.account.holdings=[{symbol:'NAS:AAA',quantity:1,strategyId:null}];
    expect(buildPaperInput(f.data,f.policy,f.account,f.cutoff).report.issues).toContain('invalid_paper_holding_attribution');
  });

  test('KIS generic adjusted rows are not relabelled as split-only history',()=>{
    const f=fixture();f.data.members[0].splitBars=f.data.members[0].splitBars.map(bar=>({...bar,sourceId:'kis_dailyprice',sourceVariant:'generic_adjusted'}));
    const result=buildPaperInput(f.data,f.policy,f.account,f.cutoff);
    expect(result.input).toBeNull();
    expect(result.report.perSymbol[0].issues).toContain('unqualified_price_variant');
  });

  test('raw share prices must be current USD raw quotes, separate from split-adjusted ranking prices',()=>{
    const f=fixture();f.data.members[0].rawQuote!.currency='INDEX';
    expect(buildPaperInput(f.data,f.policy,f.account,f.cutoff).report.perSymbol[0].issues).toContain('price_unit_mismatch');
    f.data.members[0].rawQuote!.currency='USD';f.data.members[0].rawQuote!.session='2026-11-06';
    expect(buildPaperInput(f.data,f.policy,f.account,f.cutoff).report.perSymbol[0].issues).toContain('stale_raw_quote');
  });

  test('uses 200 SP500 index-point sessions ending D-1, never D0 or an inferred USD price',()=>{
    const f=fixture();
    f.data.sp500Bars=[...f.data.sp500Bars,{...f.data.sp500Bars[199],session:f.data.asOfSession,close:1}];
    const result=buildPaperInput(f.data,f.policy,f.account,f.cutoff);
    expect(result.input?.marketBars).toHaveLength(200);
    expect(result.input?.marketBars.at(-1)?.session).toBe('2026-11-06');
    expect(planM40(result.input!).gates.marketTrend).toBe('pass');
    f.data.sp500Bars[0].currency='USD';
    expect(buildPaperInput(f.data,f.policy,f.account,f.cutoff).report.issues).toContain('price_unit_mismatch');
  });

  test.each(['missing-market','future-observation','unfinished','missing-observation','pre-close','future-session','bad-hash'])(
    'blocks unproven input %s',kind=>{
      const f=fixture();
      if(kind==='missing-market')f.data.sp500Bars=f.data.sp500Bars.slice(1);
      if(kind==='future-observation')f.data.members[0].splitBars[0].observedAt='2026-11-09T22:30:00.000001Z';
      if(kind==='unfinished')f.data.members[0].splitBars[126].final=false;
      if(kind==='missing-observation')f.data.members[0].splitBars[0].observedAt='';
      if(kind==='pre-close')f.data.members[0].splitBars[126].observedAt='2026-11-09T20:59:59Z';
      if(kind==='future-session')f.data.members[0].splitBars=[...f.data.members[0].splitBars,{...f.data.members[0].splitBars[126],session:'2026-11-10'}];
      if(kind==='bad-hash')f.data.members[0].rawQuote!.sha256='unknown';
      const result=buildPaperInput(f.data,f.policy,f.account,f.cutoff);
      expect(result.input).toBeNull();expect(result.report.forwardEligible).toBe(false);expect(result.report.epochCandidate).toBeNull();
    });

  test('microsecond cutoff uses actual observation precision and preserves source provenance',()=>{
    const f=fixture();f.data.members[0].splitBars[0].observedAt='2026-11-09T22:00:00.123456Z';
    expect(buildPaperInput(f.data,f.policy,f.account,'2026-11-09T22:00:00.123455Z').input).toBeNull();
    const result=buildPaperInput(f.data,f.policy,f.account,'2026-11-09T22:00:00.123456Z');
    expect(result.report.coreEligible).toBe(true);
    expect(result.report.provenance).toContainEqual(expect.objectContaining({symbol:'NAS:AAA',kind:'split_bar',sourceVariant:'split_only',
      observedAt:'2026-11-09T22:00:00.123456Z',availableAt:'2026-11-09T22:00:00.123456Z',sha256:'a'.repeat(64),qualification:'evaluation_only'}));
  });

  test('an old snapshot never becomes forward-eligible just because the cutoff advances',()=>{
    const f=fixture('2026-11-06');
    const result=buildPaperInput(f.data,f.policy,f.account,'2026-11-09T22:30:00Z');
    expect(result.report.coreEligible).toBe(true);
    expect(result.report).toMatchObject({asOfLatestCompleted:false,latestCompletedSession:'2026-11-09',forwardEligible:false,epochCandidate:null});
  });

  test('a truncated calendar tail cannot conceal a newly completed next session',()=>{
    const f=fixture('2026-11-09');f.data.calendar=f.data.calendar.filter(item=>item.session<='2026-11-09');
    const result=buildPaperInput(f.data,f.policy,f.account,'2026-11-10T22:30:00Z');
    expect(result.report).toMatchObject({coreEligible:true,asOfLatestCompleted:false,latestCompletedSession:'2026-11-10',forwardEligible:false,epochCandidate:null});
    expect(result.input?.sessions).toContain('2026-11-10');
    expect(result.input?.members[0].bars.at(-1)?.session).toBe('2026-11-09');
    expect(result.input?.members[0].quote?.session).toBe('2026-11-09');
  });

  test('extending the schedule cannot fabricate missing current-day prices or a qualified T0',()=>{
    const f=fixture('2026-11-09');f.data.calendar=f.data.calendar.filter(item=>item.session<='2026-11-09');
    f.data.asOfSession='2026-11-10';
    const result=buildPaperInput(f.data,f.policy,f.account,'2026-11-10T22:30:00Z');
    expect(result.report.latestCompletedSession).toBe('2026-11-10');
    expect(result.input).toBeNull();expect(result.report.forwardEligible).toBe(false);expect(result.report.epochCandidate).toBeNull();
    expect(result.report.perSymbol[0].issues).toContain('split_127_session_history_missing');
  });

  test('calendar coverage beyond the published years fails closed rather than assuming a latest day',()=>{
    const f=fixture();
    expect(buildPaperInput(f.data,f.policy,f.account,'2028-01-01T22:00:00Z').report.issues).toContain('forward_calendar_coverage_unknown');
  });

  test('a future clone or a known calendar gap cannot be filled with presumed current data',()=>{
    const f=fixture();f.account.clonedAt='2026-11-10T00:00:00Z';
    expect(buildPaperInput(f.data,f.policy,f.account,f.cutoff).report.issues).toContain('invalid_account_clone_provenance');
    f.account.clonedAt='2026-11-08T00:10:00Z';f.data.calendar=f.data.calendar.filter(item=>item.session!=='2026-11-06');
    expect(buildPaperInput(f.data,f.policy,f.account,f.cutoff).report.issues).toContain('invalid_forward_calendar');
  });
});


test('initial partial responses do not freeze a cohort; a complete retry can recover',()=>{
 const f=fixture();f.policy.frozenCohort=null;
 const full=f.data.members;f.data.members=[full[0]];
 let checked=buildPaperInput(f.data,f.policy,f.account,f.cutoff);
 expect(checked.report.cohortProposal?.symbols).toEqual(['NAS:AAA']);
 expect(canFreezePaperCohort(f.data,f.policy,checked)).toBe(false);
 expect(f.policy.frozenCohort).toBeNull();
 f.data.members=full;f.data.sp500Bars=[];
 checked=buildPaperInput(f.data,f.policy,f.account,f.cutoff);
 expect(canFreezePaperCohort(f.data,f.policy,checked)).toBe(false);
 f.data.sp500Bars=fixture().data.sp500Bars;
 checked=buildPaperInput(f.data,f.policy,f.account,f.cutoff);
 expect(canFreezePaperCohort(f.data,f.policy,checked)).toBe(true);
 f.policy.frozenCohort=checked.report.cohortProposal;
 expect(buildPaperInput(f.data,f.policy,f.account,f.cutoff).report.forwardEligible).toBe(true);
});

test('short history needs the explicit initial audit proof; stale quotes remain retriable',()=>{
 const f=fixture();f.policy.frozenCohort=null;
 f.data.members=[f.data.members[0],{...f.data.members[1],splitBars:f.data.members[1].splitBars.slice(10)}];
 let checked=buildPaperInput(f.data,f.policy,f.account,f.cutoff);
 expect(canFreezePaperCohort(f.data,f.policy,checked)).toBe(false);
 expect(checked.report.cohortProposal?.excluded).toEqual([{symbol:'NYS:BBB',issues:['split_127_session_history_missing']}]);
 f.policy.historyExclusionProofs=[{symbol:'NYS:BBB',asOfSession:f.data.asOfSession,splitSourceSha256:'a'.repeat(64),reason:'documented_initial_history_gap'}];
 checked=buildPaperInput(f.data,f.policy,f.account,f.cutoff);
 expect(canFreezePaperCohort(f.data,f.policy,checked)).toBe(true);
 f.data.members=[f.data.members[0],{...f.data.members[1],rawQuote:{...f.data.members[1].rawQuote!,session:'2026-11-06'}}];
 checked=buildPaperInput(f.data,f.policy,f.account,f.cutoff);
 expect(canFreezePaperCohort(f.data,f.policy,checked)).toBe(false);
});

test.each([1,126])('%i returned closes cannot silently become a permanent cohort exclusion',count=>{
 const f=fixture();f.policy.frozenCohort=null;
 const full=f.data.members[1].splitBars;
 f.data.members[1].splitBars=full.slice(-count);
 let checked=buildPaperInput(f.data,f.policy,f.account,f.cutoff);
 expect(checked.report.coreEligible).toBe(true);
 expect(canFreezePaperCohort(f.data,f.policy,checked)).toBe(false);
 expect(f.policy.historyExclusionProofs).toBeUndefined();
 f.data.members[1].splitBars=full;
 checked=buildPaperInput(f.data,f.policy,f.account,f.cutoff);
 expect(canFreezePaperCohort(f.data,f.policy,checked)).toBe(true);
 expect(checked.report.cohortProposal?.symbols).toEqual(['NAS:AAA','NYS:BBB']);
});

test.each(['wrong-date','wrong-sha','mixed-sha'])('initial history proof must match the exact audited snapshot (%s)',mismatch=>{
 const f=fixture();f.policy.frozenCohort=null;f.data.members[1].splitBars=f.data.members[1].splitBars.slice(10);
 f.policy.historyExclusionProofs=[{symbol:'NYS:BBB',asOfSession:mismatch==='wrong-date'?'2026-11-06':f.data.asOfSession,
  splitSourceSha256:mismatch==='wrong-sha'?'d'.repeat(64):'a'.repeat(64),reason:'documented_initial_history_gap'}];
 if(mismatch==='mixed-sha')f.data.members[1].splitBars[0].sha256='e'.repeat(64);
 const checked=buildPaperInput(f.data,f.policy,f.account,f.cutoff);
 expect(canFreezePaperCohort(f.data,f.policy,checked)).toBe(false);
});

test.each(['duplicate','invalid-sha','foreign-symbol','future-proof','invalid-reason'])('rejects malformed policy history proofs (%s)',failure=>{
 const f=fixture();f.policy.frozenCohort=null;
 const proof={symbol:'NYS:BBB',asOfSession:f.data.asOfSession,splitSourceSha256:'a'.repeat(64),reason:'documented_initial_history_gap' as const};
 f.policy.historyExclusionProofs=[proof];
 if(failure==='duplicate')f.policy.historyExclusionProofs=[proof,{...proof}];
 if(failure==='invalid-sha')proof.splitSourceSha256='not-a-sha';
 if(failure==='foreign-symbol')proof.symbol='NAS:OTHER';
 if(failure==='future-proof')proof.asOfSession='2026-11-10';
 if(failure==='invalid-reason')(proof as {reason:string}).reason='inferred_from_partial_response';
 const checked=buildPaperInput(f.data,f.policy,f.account,f.cutoff);
 expect(checked.input).toBeNull();expect(checked.report.issues).toContain('invalid_history_exclusion_proofs');
 expect(canFreezePaperCohort(f.data,f.policy,checked)).toBe(false);
});

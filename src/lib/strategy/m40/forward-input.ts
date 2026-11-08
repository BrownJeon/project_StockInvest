import { planM40 } from './core';
import { assertForwardCalendar, extendForwardCalendar, normalizeForwardUtc, validForwardSessionDate } from './forward-calendar';
import type { M40Bar, M40Input, M40Member } from './types';
import type {
  ForwardEligibilityReport, ForwardInputData, ForwardInputResult, ForwardObservationProvenance,
  ForwardPaperAccount, ForwardPolicy, ForwardPriceBar, ForwardRawQuote,
} from './forward-types';

const SHA=/^[0-9a-f]{64}$/;
const SYMBOL=/^[A-Z0-9][A-Z0-9.:^/\-]{0,31}$/;
const order=(a:string,b:string):number=>a<b?-1:a>b?1:0;
const unique=(values:readonly string[]):string[]=>[...new Set(values)].sort(order);

function validHistoryExclusionProofs(data:ForwardInputData,policy:ForwardPolicy):boolean {
  const proofs=policy.historyExclusionProofs;
  if(proofs!==undefined&&!Array.isArray(proofs))return false;
  const seen=new Set<string>();
  return (proofs??[]).every(proof=>{
    if(!proof||!SYMBOL.test(proof.symbol)||!policy.referenceSymbols.includes(proof.symbol)||seen.has(proof.symbol)
      ||!validForwardSessionDate(proof.asOfSession)||proof.asOfSession>data.asOfSession
      ||!SHA.test(proof.splitSourceSha256)||proof.reason!=='documented_initial_history_gap')return false;
    seen.add(proof.symbol);return true;
  });
}

/** No clock, collector, database, model, signal router or order side effects. */
export function buildPaperInput(
  data:ForwardInputData,policy:ForwardPolicy,account:ForwardPaperAccount,cutoff:string,
):ForwardInputResult {
  const fatal=new Set<string>(),issues=new Set<string>(),provenance:ForwardObservationProvenance[]=[];
  const report:ForwardEligibilityReport={cohortLabel:'limited_reference_cohort',executionScope:'paper_only',liveEligible:false,
    coreEligible:false,forwardEligible:false,asOfLatestCompleted:false,latestCompletedSession:null,
    epochProvisional:policy.epochSession===null,epochCandidate:null,cohortProposal:null,issues:[],perSymbol:[],provenance,
    cloneSha256:account.cloneSha256};
  const finish=(input:M40Input|null,confirmedOnlyInput?:M40Input|null):ForwardInputResult=>{
    report.issues=unique([...fatal,...issues]);
    report.provenance=provenance.sort((a,b)=>order(a.symbol,b.symbol)||order(a.kind,b.kind)||order(a.session,b.session));
    return {input,report,...(confirmedOnlyInput?{confirmedOnlyInput}:{})};
  };
  const through=normalizeForwardUtc(cutoff),registered=normalizeForwardUtc(policy.registeredAt),cloned=normalizeForwardUtc(account.clonedAt);
  if(!through) fatal.add('invalid_cutoff');
  if(!registered||!policy.policyId?.trim()||policy.strategyId!=='m40-paper-v1') fatal.add('invalid_forward_policy');
  if(!cloned||!SHA.test(account.cloneSha256)||(through&&cloned>through)) fatal.add('invalid_account_clone_provenance');
  try{assertForwardCalendar(data.calendar);}catch{fatal.add('invalid_forward_calendar');}
  let qualifiedCalendar=data.calendar;
  if(through&&!fatal.has('invalid_forward_calendar')) {
    try {
      if(through.slice(0,10)>'2027-12-31') throw new Error('coverage_unknown');
      // Extend known schedule metadata, never prices or receipt timestamps. A
      // truncated input tail must not make an old session appear to be latest.
      const covered=extendForwardCalendar(data.calendar,through.slice(0,10));
      if(covered.at(-1)!.session>data.calendar.at(-1)!.session) qualifiedCalendar=covered;
    }catch{fatal.add('forward_calendar_coverage_unknown');}
  }
  if(policy.epochSession===null&&policy.epochLockedAt!=null) fatal.add('epoch_lock_without_session');
  if(fatal.size) return finish(null);
  const reference=unique(policy.referenceSymbols);
  if(!reference.length||reference.length!==policy.referenceSymbols.length||reference.some(symbol=>!SYMBOL.test(symbol))) fatal.add('invalid_reference_cohort');
  const sessions=qualifiedCalendar.map(item=>item.session),calendar=new Map(qualifiedCalendar.map(item=>[item.session,item]));
  const asOfIndex=sessions.indexOf(data.asOfSession);
  if(!validForwardSessionDate(data.asOfSession)||asOfIndex<0) return (fatal.add('invalid_asof_session'),finish(null));
  if(!validHistoryExclusionProofs(data,policy)||(policy.historyExclusionProofs??[]).some(proof=>!calendar.has(proof.asOfSession))) {
    fatal.add('invalid_history_exclusion_proofs');return finish(null);
  }
  const asOfClose=normalizeForwardUtc(calendar.get(data.asOfSession)!.closeAt)!;
  const completed=qualifiedCalendar.filter(item=>normalizeForwardUtc(item.closeAt)!<=through!);
  report.latestCompletedSession=completed.at(-1)?.session??null;
  report.asOfLatestCompleted=data.asOfSession===report.latestCompletedSession;
  if(asOfClose>through!) fatal.add('asof_session_not_complete');
  if(!report.asOfLatestCompleted) issues.add('asof_not_latest_completed');
  if(asOfClose<=registered!||registered!>through!) issues.add('session_not_prospective_after_registration');
  if(!Number.isFinite(account.equityUsd)||account.equityUsd<0||!Number.isFinite(account.settledCashUsd)
    ||account.settledCashUsd<0||account.settledCashUsd>account.equityUsd) fatal.add('invalid_paper_account');
  for(const holding of account.holdings) {
    if(!SYMBOL.test(holding.symbol)||!Number.isSafeInteger(holding.quantity)||holding.quantity<0) fatal.add('invalid_paper_holding_quantity');
    if(holding.quantity>0&&holding.strategyId!==policy.strategyId) fatal.add('invalid_paper_holding_attribution');
  }
  const holdings=account.holdings.filter(holding=>holding.quantity>0).map(holding=>({...holding}))
    .sort((a,b)=>order(a.symbol,b.symbol)||order(a.positionId??'',b.positionId??''));
  const held=new Set(holdings.map(holding=>holding.symbol));
  const members=new Map<string,ForwardInputData['members'][number]>();
  for(const member of data.members) {
    if(!SYMBOL.test(member.symbol)||members.has(member.symbol)) fatal.add('invalid_or_duplicate_member');
    members.set(member.symbol,member);
  }
  const needed=asOfIndex>=126?sessions.slice(asOfIndex-126,asOfIndex+1):[];
  const marketNeeded=asOfIndex>=200?sessions.slice(asOfIndex-200,asOfIndex):[];

  function inspect(
    observation:ForwardPriceBar|ForwardRawQuote,symbol:string,kind:ForwardObservationProvenance['kind'],variant:'split_only'|'raw'|'index',record=true,
  ):{issues:string[];bar:M40Bar|null;availableAt:string|null} {
    const failures:string[]=[],session=calendar.get(observation.session),observed=normalizeForwardUtc(observation.observedAt);
    const close=session?normalizeForwardUtc(session.closeAt):null;
    if(!session||observation.session>data.asOfSession) failures.push('unknown_or_future_price_session');
    if(!observed||observed>through!) failures.push('unknown_or_future_observation');
    if(observation.final!==true) failures.push('unfinished_price');
    if(!close||(observed&&observed<close)) failures.push('observation_precedes_session_close');
    if(observation.sourceVariant!==variant) failures.push('unqualified_price_variant');
    if(observation.currency!==(variant==='index'?'INDEX':'USD')) failures.push('price_unit_mismatch');
    if(observation.qualification!=='evaluation_only'||typeof observation.sourceId!=='string'||!observation.sourceId.trim()
      ||!SHA.test(observation.sha256)) failures.push('source_provenance_unknown');
    const price='close' in observation?observation.close:observation.price;
    if(!Number.isFinite(price)||price<=0) failures.push('invalid_price');
    const availableAt=observed&&close?(observed>close?observed:close):null;
    if(availableAt&&availableAt>through!) failures.push('price_not_available_at_cutoff');
    if(failures.length) return {issues:unique(failures),bar:null,availableAt};
    if(record) provenance.push({symbol,session:observation.session,kind,sourceId:observation.sourceId,sourceVariant:observation.sourceVariant,
      sha256:observation.sha256,observedAt:observation.observedAt,availableAt:availableAt!,currency:observation.currency,qualification:'evaluation_only'});
    return {issues:[],bar:variant==='raw'?null:{session:observation.session,close:price,final:true,availableAt:availableAt!,
      priceBasis:variant==='index'?'index':'split_adjusted'},availableAt};
  }
  function series(bars:readonly ForwardPriceBar[],window:readonly string[],symbol:string,kind:'split_bar'|'sp500_bar'):{bars:M40Bar[];issues:string[]} {
    const failures:string[]=[],bySession=new Map<string,M40Bar>(),sources=new Set<string>();
    for(const [index,row] of bars.entries()) {
      if(index>0&&bars[index-1].session>=row.session) failures.push('unordered_or_duplicate_price_sessions');
      const checked=inspect(row,symbol,kind,kind==='sp500_bar'?'index':'split_only',window.includes(row.session));
      failures.push(...checked.issues);
      if(checked.bar){bySession.set(row.session,checked.bar);if(window.includes(row.session))sources.add(row.sourceId);}
    }
    if(!window.length||window.some(session=>!bySession.has(session))) failures.push(kind==='sp500_bar'?'sp500_200_session_history_missing':'split_127_session_history_missing');
    if(sources.size>1) failures.push('mixed_price_sources');
    return {bars:window.flatMap(session=>bySession.has(session)?[bySession.get(session)!]:[]),issues:unique(failures)};
  }
  const perSymbol=new Map<string,{bars:M40Bar[];quote:M40Member['quote'];issues:string[];ended:boolean}>();
  for(const symbol of unique([...reference,...held])) {
    const member=members.get(symbol),failures:string[]=[];
    const end=member?.confirmedMembershipEnd;
    let ended=false;
    if(end) {
      const confirmed=normalizeForwardUtc(end.confirmedAt);
      if(!validForwardSessionDate(end.effectiveSession)||!confirmed||confirmed>through!||!end.source.trim()) failures.push('membership_end_unconfirmed');
      else ended=end.effectiveSession<=data.asOfSession;
    }
    let bars:M40Bar[]=[];
    if(reference.includes(symbol)&&!ended) {
      const checked=series(member?.splitBars??[],needed,symbol,'split_bar');bars=checked.bars;failures.push(...checked.issues);
    }else failures.push(ended?'confirmed_membership_end':'outside_reference_cohort');
    let quote:M40Member['quote'];
    if(member?.rawQuote) {
      const checked=inspect(member.rawQuote,symbol,'raw_quote','raw');
      if(member.rawQuote.session!==data.asOfSession) checked.issues.push('stale_raw_quote');
      failures.push(...checked.issues);
      if(!checked.issues.length) quote={session:data.asOfSession,price:member.rawQuote.price,priceBasis:'raw',availableAt:checked.availableAt!};
    }else if(!ended||held.has(symbol)) failures.push('raw_quote_missing');
    perSymbol.set(symbol,{bars,quote,issues:unique(failures),ended});
  }
  const candidateSymbols=reference.filter(symbol=>perSymbol.get(symbol)!.issues.length===0);
  if(!policy.frozenCohort) {
    report.cohortProposal={symbols:candidateSymbols,excluded:reference.filter(symbol=>!candidateSymbols.includes(symbol))
      .map(symbol=>({symbol,issues:perSymbol.get(symbol)!.issues})),asOfSession:data.asOfSession,frozenAt:through!};
    issues.add('cohort_not_frozen');
  }else {
    const frozen=policy.frozenCohort,frozenAt=normalizeForwardUtc(frozen.frozenAt),exclusions=new Map(frozen.excluded.map(item=>[item.symbol,item]));
    if(!frozenAt||frozenAt>through!||!validForwardSessionDate(frozen.asOfSession)||!calendar.has(frozen.asOfSession)
      ||frozen.asOfSession>data.asOfSession||new Set(frozen.symbols).size!==frozen.symbols.length
      ||frozen.symbols.some(symbol=>!reference.includes(symbol))||exclusions.size!==frozen.excluded.length
      ||frozen.excluded.some(item=>!reference.includes(item.symbol)||frozen.symbols.includes(item.symbol)||!item.issues.length)
      ||reference.some(symbol=>!frozen.symbols.includes(symbol)&&!exclusions.has(symbol))) fatal.add('invalid_frozen_cohort');
  }
  const cohort=policy.frozenCohort?.symbols??candidateSymbols,active=new Set(cohort);
  if(!cohort.length) fatal.add('empty_qualified_cohort');
  for(const symbol of cohort) {
    const qualification=perSymbol.get(symbol);
    if(!qualification) fatal.add(`frozen_member_missing:${symbol}`);
    else if(!qualification.ended&&qualification.issues.length) fatal.add(`frozen_member_unqualified:${symbol}`);
  }
  for(const symbol of held) if(!perSymbol.get(symbol)?.quote) fatal.add(`held_raw_quote_unavailable:${symbol}`);
  report.perSymbol=unique([...reference,...held]).map(symbol=>({symbol,eligible:perSymbol.get(symbol)!.issues.length===0,
    inFrozenCohort:policy.frozenCohort!==null&&active.has(symbol),held:held.has(symbol),issues:perSymbol.get(symbol)!.issues}));
  const market=series(data.sp500Bars,marketNeeded,'SP500','sp500_bar');
  if(market.issues.length) for(const reason of market.issues) fatal.add(reason);
  if(policy.epochSession!==null) {
    const epoch=calendar.get(policy.epochSession),close=epoch?normalizeForwardUtc(epoch.closeAt):null;
    if(!epoch||!close||close<=registered!||close>through!||policy.epochSession>data.asOfSession) fatal.add('invalid_or_nonprospective_epoch');
    const locked=normalizeForwardUtc(policy.epochLockedAt),frozen=normalizeForwardUtc(policy.frozenCohort?.frozenAt);
    if(!locked||!frozen||!close||locked<cloned!||locked<frozen||locked<close||locked>through!) fatal.add('invalid_epoch_lock_proof');
    // Only the immutable first-T0 snapshot must predate its lock. Later daily
    // observations are naturally newer and do not reset or invalidate that lock.
    if(locked&&data.asOfSession===policy.epochSession&&provenance.some(item=>normalizeForwardUtc(item.observedAt)!>locked)) {
      fatal.add('epoch_lock_precedes_source_observation');
    }
  }
  if(fatal.size) {
    // This is not partial ranking. Only a sourced end of existing paper
    // ownership may survive unrelated absence; corrupt/foreign/future data,
    // policy, account, or lock failures remain a complete stop.
    const allowedUnknown=new Set(['split_127_session_history_missing','raw_quote_missing','stale_raw_quote',
      'confirmed_membership_end','outside_reference_cohort']);
    const benignFailures=[...fatal].every(reason=>reason==='sp500_200_session_history_missing'
      ||reason.startsWith('frozen_member_unqualified:')||reason.startsWith('held_raw_quote_unavailable:'))
      &&[...perSymbol.values()].every(item=>item.issues.every(reason=>allowedUnknown.has(reason)))
      &&market.issues.every(reason=>reason==='sp500_200_session_history_missing');
    const affected=[...held].filter(symbol=>perSymbol.get(symbol)?.ended);
    if(policy.epochSession!==null&&policy.frozenCohort!==null&&benignFailures&&affected.length
      &&affected.every(symbol=>perSymbol.get(symbol)?.quote)&&report.asOfLatestCompleted
      &&asOfClose>registered!&&registered!<=through!) {
      const affectedSet=new Set(affected);
      const partial:M40Input={asOfSession:data.asOfSession,decisionTime:through!,sessions,
        rebalanceEpochSession:policy.epochSession,strategyId:policy.strategyId,marketBars:market.bars,
        universeComplete:false,holdings,account:{equityUsd:account.equityUsd,settledCashUsd:account.settledCashUsd},
        members:unique([...reference,...held]).map(symbol=>affectedSet.has(symbol)
          ?{symbol,membership:'ineligible',bars:[],quote:perSymbol.get(symbol)!.quote!,
            confirmedMembershipEnd:{...members.get(symbol)!.confirmedMembershipEnd!}}
          :{symbol,membership:'unknown',bars:[]})};
      const partialPlan=planM40(partial),transactions=partialPlan.decisions.filter(decision=>decision.action!=='hold');
      if(partialPlan.status==='data_unknown'&&transactions.length
        &&transactions.every(decision=>decision.action==='sell'&&decision.reason==='confirmed_membership_end')) {
        issues.add('confirmed_membership_end_only');
        return finish(null,partial);
      }
    }
    return finish(null);
  }
  const normalizedMembers:M40Member[]=unique([...reference,...held]).map(symbol=>{
    const qualification=perSymbol.get(symbol)!,member=members.get(symbol);
    return {symbol,membership:active.has(symbol)&&!qualification.ended?'eligible':'ineligible',
      bars:active.has(symbol)&&!qualification.ended?qualification.bars:[],
      ...(qualification.quote?{quote:qualification.quote}:{}),...(member?.listingSession?{listingSession:member.listingSession}:{}),
      ...(member?.confirmedMembershipEnd?{confirmedMembershipEnd:{...member.confirmedMembershipEnd}}:{})};
  });
  const input:M40Input={asOfSession:data.asOfSession,decisionTime:through!,sessions,
    rebalanceEpochSession:policy.epochSession??data.asOfSession,strategyId:policy.strategyId,marketBars:market.bars,
    universeComplete:true,members:normalizedMembers,holdings,account:{equityUsd:account.equityUsd,settledCashUsd:account.settledCashUsd}};
  if(planM40(input).status!=='ready') {fatal.add('strict_m40_core_not_ready');return finish(null);}
  report.coreEligible=true;
  report.forwardEligible=policy.frozenCohort!==null&&report.asOfLatestCompleted&&asOfClose>registered!&&registered!<=through!
    &&(policy.epochSession===null||data.asOfSession>=policy.epochSession);
  if(report.forwardEligible&&policy.epochSession===null) report.epochCandidate=data.asOfSession;
  return finish(input);
}

/** A temporary missing response must not become a permanent cohort exclusion. */
export function canFreezePaperCohort(data:ForwardInputData,policy:ForwardPolicy,checked:ForwardInputResult):boolean {
  const proposal=checked.report.cohortProposal;
  if(policy.frozenCohort||!checked.input||!checked.report.coreEligible||!proposal?.symbols.length
    ||proposal.asOfSession!==data.asOfSession||checked.input.asOfSession!==data.asOfSession||!validHistoryExclusionProofs(data,policy))return false;
  return policy.referenceSymbols.every(symbol=>{
    const member=data.members.find(item=>item.symbol===symbol);
    const row=checked.report.perSymbol.find(item=>item.symbol===symbol);
    if(!member?.splitBars.length||!member.rawQuote||!row)return false;
    if(!row.issues.length)return row.eligible&&proposal.symbols.includes(symbol);
    if(row.issues.length!==1||row.issues[0]!=='split_127_session_history_missing')return false;
    const proof=policy.historyExclusionProofs?.find(item=>item.symbol===symbol&&item.asOfSession===data.asOfSession);
    return !!proof&&member.splitBars.every(bar=>bar.sha256===proof.splitSourceSha256)
      &&proposal.excluded.some(item=>item.symbol===symbol&&item.issues.length===1&&item.issues[0]==='split_127_session_history_missing');
  });
}

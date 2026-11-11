/** Pure preparation of an explicitly uncalibrated, evaluation-only scenario. No DB/clock/feed access. */
import { BRK_PAIR_SYMBOL } from './forward-stock-contract';
import { validateForwardSources,validateForwardBrkPair } from './forward-sources';
import { forwardSourceRegime } from './forward-source-regime';
import { createHash } from 'node:crypto';
import { stableJson } from './advisory';
import { M40_POLICY } from './core';
import { assertForwardCalendar, normalizeForwardUtc, validForwardSessionDate } from './forward-calendar';
import { assertPaperShareBasis, markPaperBook } from './paper-ledger';
import type { ForwardPolicy } from './forward-types';
import type { ForwardCsvBar, ForwardStockSource } from './forward-sources';
import { FORECAST_MODEL_VERSION } from './forecast-types';
import type { ForecastBridge, ForecastPrepareArgs, ForecastPreparation, ForecastTarget, PreparedForecastInput } from './forecast-types';

export const forecastDigest = (value: unknown): string => createHash('sha256').update(stableJson(value)).digest('hex');
export const forecastPolicyHash = (policy: ForwardPolicy): string => forecastDigest({policy, numericalPolicy:M40_POLICY,
  execution:'next_open_fixed_quantity_or_expire',settlement:'conservative_nyse_and_bank_open_t_plus_1_not_verified_kis'});
const positive = (v:number):boolean => Number.isFinite(v) && v > 0;
const order = (a:string,b:string):number => a < b ? -1 : a > b ? 1 : 0;
function fail(issue:string):never {throw Error(issue);}
function calendarTarget(session:string,months:number):string {
  const [year,month,day]=session.split('-').map(Number);
  const target=new Date(Date.UTC(year,month-1+months,1));
  const last=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth(),Math.min(day,last))).toISOString().slice(0,10);
}
export function forecastTargets(session:string,calendar:ForecastPrepareArgs['calendar']):ForecastTarget[] {
  const index=calendar.findIndex(c=>c.session===session);
  if(index<0)fail('forecast_baseline_calendar_missing');
  const week=new Date(Date.parse(`${session}T00:00:00Z`)+7*86400_000).toISOString().slice(0,10);
  return ([['week',week],['month',calendarTarget(session,1)],['quarter',calendarTarget(session,3)],['year',calendarTarget(session,12)]] as const)
    .map(([horizon,target])=>{
      // A full calendar through the calendar anniversary is necessary, even if it is not a session.
      if(calendar.at(-1)!.session<target && Date.parse(target)-Date.parse(calendar.at(-1)!.session)>3*86400_000)
        fail('forecast_target_calendar_incomplete');
      const at=calendar.findLastIndex(c=>c.session<=target);
      if(at<=index)fail('forecast_target_not_future');
      return {horizon,calendarTarget:target,targetSession:calendar[at].session,sessions:at-index};
    });
}
function rows(source:ForwardStockSource,asOf:string,issued:string,closes:ReadonlyMap<string,string>):Map<string,ForwardCsvBar> {
  const observed=normalizeForwardUtc(source.observedAt);
  if(!observed||observed>issued||!source.sourceId||!/^[a-f0-9]{64}$/.test(source.sha256))fail('forecast_source_not_known_by_issue');
  const out=new Map<string,ForwardCsvBar>();
  for(const row of source.rows){
    if(row.session>asOf)continue;
    if(out.has(row.session)||!closes.has(row.session)||closes.get(row.session)!>observed
      ||![row.open,row.close].every(v=>typeof v==='string'&&/^\d+(?:\.\d+)?$/.test(v)&&positive(Number(v))))
      fail('forecast_price_invalid_or_duplicate');
    out.set(row.session,row);
  }
  return out;
}
/** Preparation returns explicit reasons; no missing observation is filled as an observed value. */
export function prepareForecastInput(args:ForecastPrepareArgs):ForecastPreparation {
 try {
  const issued=normalizeForwardUtc(args.issuedAt),available=normalizeForwardUtc(args.sourceAvailableAt);
  const bundleObserved=normalizeForwardUtc(args.bundle.observedAt);
  if(!issued||!available||available>issued||!bundleObserved||bundleObserved>issued)fail('forecast_source_not_known_by_issue');
  if(!args.accountId||!Number.isSafeInteger(args.accountRevision)||args.accountRevision<1||!args.sourceDatasetId)
    fail('forecast_identity_invalid');
  assertForwardCalendar(args.calendar);
  validateForwardSources(args.bundle,args.calendar,issued);
  const asOf=args.bundle.asOfSession;
  const closes=new Map(args.calendar.map(c=>[c.session,normalizeForwardUtc(c.closeAt)!]));
  const latest=args.calendar.filter(c=>normalizeForwardUtc(c.closeAt)!<=issued).at(-1)?.session;
  if(asOf!==latest)fail('forecast_source_price_stale');
  const baselineIndex=args.calendar.findIndex(c=>c.session===asOf);
  const targets=forecastTargets(asOf,args.calendar);
  // Require extra settlement/signal session after the final endpoint, and never accept an exhausted schedule.
  if(baselineIndex<0||!args.calendar[baselineIndex+targets.at(-1)!.sessions+1])fail('forecast_target_calendar_incomplete');
  const cohort=args.policy.frozenCohort;
  if(args.policy.strategyId!=='m40-paper-v1'||!cohort||!cohort.symbols.length
    ||!normalizeForwardUtc(args.policy.registeredAt)||normalizeForwardUtc(args.policy.registeredAt)!>issued
    ||!normalizeForwardUtc(cohort.frozenAt)||normalizeForwardUtc(cohort.frozenAt)!>issued
    ||cohort.asOfSession>asOf)fail('forecast_frozen_policy_required');
  const candidateSymbols=[...cohort.symbols].sort(order);
  const symbols=[...new Set([...candidateSymbols,...args.book.holdings.filter(h=>h.quantity>0).map(h=>h.symbol)])].sort(order);
  validateForwardBrkPair(args.bundle,args.calendar,symbols.includes(BRK_PAIR_SYMBOL),issued);
  if(new Set(candidateSymbols).size!==candidateSymbols.length)fail('forecast_cohort_duplicate');
  const epoch=args.policy.epochSession??args.calendar[baselineIndex+1].session;
  if(!args.calendar.some(c=>c.session===epoch))fail('forecast_epoch_calendar_missing');
  const pendingIntents=JSON.parse(stableJson(args.pendingIntents??[])).sort((a:{id:string},b:{id:string})=>order(a.id,b.id)) as NonNullable<ForecastPrepareArgs['pendingIntents']>;
  const next=args.calendar[baselineIndex+1];
  if(new Set(pendingIntents.map(i=>i.id)).size!==pendingIntents.length||pendingIntents.some(i=>
    i.accountId!==args.accountId||i.status!=='awaiting_open'||i.executionScope!=='paper_only'
    ||i.executeSession!==next.session||!normalizeForwardUtc(i.createdAt)||normalizeForwardUtc(i.createdAt)!>issued
    ||normalizeForwardUtc(i.createdAt)!>=normalizeForwardUtc(next.openAt)!
    ||!Number.isSafeInteger(i.quantity)||i.quantity<=0||!symbols.includes(i.symbol)||!['buy','sell'].includes(i.side)
    ||i.feePerSide!==M40_POLICY.feePerSide||i.fillModel!=='next_open_fixed_quantity_or_expire'
    ||(i.side==='buy'&&(i.maxDebitUsd===null||!positive(i.maxDebitUsd)))))fail('forecast_pending_intents_invalid');
  const book=JSON.parse(JSON.stringify(args.book)) as ForecastPrepareArgs['book'];
  book.holdings=book.holdings.filter(h=>h.quantity!==0);
  if(!Number.isFinite(book.cashUsd)||book.cashUsd<0||!positive(book.initialEquityUsd)||!positive(book.peakEquityUsd)
    || (book.lastForwardSession!==null&&(!validForwardSessionDate(book.lastForwardSession)||book.lastForwardSession>asOf))
    || Object.values(book.splitBasis).some(b=>!validForwardSessionDate(b.session)||b.session>asOf||!positive(b.close))
    ||book.receivables.some(r=>!Number.isFinite(r.usd)||r.usd<0||!validForwardSessionDate(r.settlesOn))
    ||book.holdings.some(h=>!Number.isSafeInteger(h.quantity)||h.quantity<=0
      ||(h.strategyId!==null&&(typeof h.strategyId!=='string'||!h.strategyId.trim()))))fail('forecast_book_invalid');
  const splits:Map<string,ForwardCsvBar>[]=[],raws:Map<string,ForwardCsvBar>[]=[],sourceClocks:unknown[]=[];
  for(const symbol of symbols){
    const choose=(basis:'raw'|'split_adjusted')=>{
      const matches=args.bundle.records.filter(r=>r.symbol===symbol&&r.basis===basis);
      if(matches.length!==1)fail('forecast_paired_source_missing_or_ambiguous');
      const s=matches[0];sourceClocks.push({symbol,basis,sourceId:s.sourceId,observedAt:s.observedAt});
      if(normalizeForwardUtc(s.observedAt)!>available)fail('forecast_source_available_clock_inconsistent');
      return rows(s,asOf,issued,closes);
    };
    splits.push(choose('split_adjusted'));raws.push(choose('raw'));
  }
  const marketSource=args.bundle.market;
  if(!marketSource||!normalizeForwardUtc(marketSource.observedAt)||normalizeForwardUtc(marketSource.observedAt)!>issued
    ||!/^[a-f0-9]{64}$/.test(marketSource.sha256))fail('forecast_index_source_unknown');
  if(normalizeForwardUtc(marketSource.observedAt)!>available)fail('forecast_source_available_clock_inconsistent');
  sourceClocks.push({sourceId:marketSource.sourceId,observedAt:marketSource.observedAt});
  const market=new Map<string,number>();
  for(const row of marketSource.rows){
    if(row.session>asOf)continue;
    if(market.has(row.session)||!closes.has(row.session)
      ||closes.get(row.session)!>normalizeForwardUtc(marketSource.observedAt)!
      ||typeof row.close!=='string'||!/^\d+(?:\.\d+)?$/.test(row.close)||!positive(Number(row.close)))fail('forecast_index_invalid');
    market.set(row.session,Number(row.close));
  }
  const marketEnd=args.calendar.findLastIndex(c=>c.session<=asOf&&market.has(c.session));
  if(marketEnd!==baselineIndex&&marketEnd!==baselineIndex-1)fail('forecast_index_gap_exceeds_one_session');
  // Work backwards over exact canonical dates; missing internal days cannot masquerade as daily returns.
  let start=marketEnd;
  const complete=(day:string)=>market.has(day)&&splits.every((s,i)=>s.has(day)&&raws[i].has(day));
  while(start>=0&&complete(args.calendar[start].session))start--;
  start++;
  const historySessions=args.calendar.slice(start,marketEnd+1).map(c=>c.session);
  if(historySessions.length<253)fail('forecast_joint_history_below_252_returns');
  if(!splits.every((s,i)=>s.has(asOf)&&raws[i].has(asOf)))fail('forecast_baseline_mark_missing');
  const fullSessions=args.calendar.slice(start,baselineIndex+1).map(c=>c.session);
  if(fullSessions.some(day=>splits.some((s,i)=>!s.has(day)||!raws[i].has(day))))fail('forecast_stock_canonical_gap');
  assertPaperShareBasis(book,symbols.map((symbol,i)=>({symbol,splitBars:[...splits[i]].filter(([session])=>session===asOf||session===book.splitBasis[symbol]?.session).map(([session,r])=>({session,close:Number(r.close),
    final:true,observedAt:args.sourceAvailableAt,sourceId:'forecast_private',sourceVariant:'split_only' as const,sha256:'',currency:'USD' as const,qualification:'evaluation_only' as const}))})),asOf);
  const rawMarks=raws.map(r=>Number(r.get(asOf)!.close));
  const marked=markPaperBook(book,new Map(symbols.map((s,i)=>[s,rawMarks[i]])),asOf);
  if(!positive(marked.equityUsd))fail('forecast_baseline_equity_invalid');
  const overnight:number[][]=[],intraday:number[][]=[],marketReturns:number[]=[],returnSessions:string[]=[];
  for(let d=1;d<historySessions.length;d++){
    const prev=historySessions[d-1],day=historySessions[d];
    const over:number[]=[],intra:number[]=[];
    for(let s=0;s<symbols.length;s++){
      const split=splits[s].get(day)!,raw=raws[s].get(day)!;
      const adjustedOpen=Number(raw.open)*(Number(split.close)/Number(raw.close));
      const o=adjustedOpen/Number(splits[s].get(prev)!.close),i=Number(split.close)/adjustedOpen;
      if(!positive(o)||!positive(i))fail('forecast_joint_return_invalid');
      over.push(o);intra.push(i);
    }
    overnight.push(over);intraday.push(intra);marketReturns.push(market.get(day)!/market.get(prev)!);returnSessions.push(day);
  }
  let bridge:ForecastBridge={kind:'none',session:null,intercept:0,slope:0,predictor:0,residuals:[],
    residualSha256:forecastDigest([]),fitStart:null,fitEnd:null,sampleCount:0};
  if(marketEnd===baselineIndex-1){
    const candidateIndices=candidateSymbols.map(symbol=>symbols.indexOf(symbol));
    const xs=overnight.map((r,d)=>candidateIndices.reduce((sum,s)=>sum+(r[s]*intraday[d][s]-1)/candidateSymbols.length,0));
    const ys=marketReturns.map(r=>r-1),meanX=xs.reduce((s,v)=>s+v,0)/xs.length,meanY=ys.reduce((s,v)=>s+v,0)/ys.length;
    const variance=xs.reduce((s,x)=>s+(x-meanX)**2,0),cov=xs.reduce((s,x,i)=>s+(x-meanX)*(ys[i]-meanY),0);
    if(!positive(variance)||variance/xs.length<1e-16)fail('forecast_index_bridge_degenerate');
    const slope=cov/variance,intercept=meanY-slope*meanX;
    const residuals=ys.map((y,i)=>y-intercept-slope*xs[i]);
    const center=residuals.reduce((s,v)=>s+v,0)/residuals.length;
    for(let i=0;i<residuals.length;i++)residuals[i]-=center;
    const prev=args.calendar[marketEnd].session;
    const predictor=candidateIndices.reduce((sum,i)=>sum+(Number(splits[i].get(asOf)!.close)/Number(splits[i].get(prev)!.close)-1)/candidateSymbols.length,0);
    if(![slope,intercept,predictor,...residuals].every(Number.isFinite)
      ||residuals.some(r=>!positive(1+intercept+slope*predictor+r)))fail('forecast_index_bridge_invalid');
    bridge={kind:'latent_index_ols_centered_residual',session:asOf,intercept,slope,predictor,residuals,
      residualSha256:forecastDigest(residuals),fitStart:returnSessions[0],fitEnd:returnSessions.at(-1)!,sampleCount:xs.length};
  }
  const stockHistory=splits.map((s,i)=>fullSessions.map(day=>Number(s.get(day)!.close)/Number(s.get(asOf)!.close)*rawMarks[i]));
  const marketHistory=historySessions.map(day=>market.get(day)!);
  const assumptions=['evaluation_only_no_live_orders','uncalibrated_model_path_frequency_not_validated_world_probability',
    'joint_moving_blocks_frozen_current_cohort_not_point_in_time_historical_universe','no_fx_no_dividends_no_future_corporate_actions',
    'next_open_fixed_quantity_or_expire_integer_shares_sell_before_buy','conservative_nyse_and_bank_open_t_plus_1_not_verified_kis',
    'mark_only_terminal_no_forced_liquidation_fee','historical_publication_unknown_actual_receipt_known_by_issue',
    ...(args.policy.epochSession?[]:['provisional_forecast_epoch_next_canonical_session_operational_epoch_unchanged']),
    ...(bridge.kind==='none'?[]:['missing_one_index_session_is_latent_ols_plus_centered_residual_not_observed'])];
  const sourceSha256=forecastDigest({sourceClocks,fullSessions,stockHistory,marketHistory,overnight,intraday,marketReturns,rawMarks});
  const baseline={kind:'forecast_only_marked_snapshot' as const,accountId:args.accountId,accountRevision:args.accountRevision,
    sourceRegimeSha256:forwardSourceRegime(args.bundle),...(args.analysisSourceBundleSha256?{analysisSourceBundleSha256:args.analysisSourceBundleSha256}:{}),session:asOf,equityUsd:marked.equityUsd,bookSha256:forecastDigest(marked.book),sourceAccountStateSha256:forecastDigest(args.book),epochSession:epoch,epochProvisional:args.policy.epochSession===null};
  const input:PreparedForecastInput={modelVersion:FORECAST_MODEL_VERSION,issuedAt:args.issuedAt,sourceDatasetId:args.sourceDatasetId,
    sourceAvailableAt:args.sourceAvailableAt,sourceSha256,policySha256:forecastPolicyHash(args.policy),inputSha256:'',baseline,
    book:marked.book,pendingIntents:[...pendingIntents],policy:JSON.parse(stableJson(args.policy)) as ForwardPolicy,symbols,candidateSymbols,calendar:args.calendar.map(c=>({...c})),baselineIndex,
    historySessions:fullSessions,stockHistory,marketHistory,overnight,intraday,marketReturns,rawMarks,returnSessions,targets,bridge,assumptions};
  input.inputSha256=forecastDigest(input);
  return {status:'qualified',input};
 }catch(e){return {status:'blocked',issues:[e instanceof Error?e.message:'forecast_preparation_failed']};}
}

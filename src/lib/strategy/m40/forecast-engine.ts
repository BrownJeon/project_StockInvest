/** Evaluation-only numerical scenario. No exchange, DB, active signal or environment dependency. */
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setImmediate as yieldImmediate } from 'node:timers/promises';
import { M40_POLICY } from './core';
import { nextPaperSettlementSession } from './forward-calendar';
import { generatePaperSignals, markPaperBook, settlePaperSignals } from './paper-ledger';
import type { PaperBook, PaperIntent } from './paper-ledger';
import type { M40Decision, M40Holding, M40Plan } from './types';
import type { ForecastDistribution, ForecastEngineOptions, ForecastEngineResult, PreparedForecastInput } from './forecast-types';

/** Compact replay of the validated numerical policy. Compared against planM40 in differential tests.
 * Input eligibility is checked once by prepareForecastInput, rather than re-parsing every historical
 * timestamp for every path/review. Index gate excludes today's close, exactly as the canonical policy.
 */
export function forecastReplayDecisions(args:{symbols:readonly string[];candidateSymbols?:readonly string[];stockHistory:readonly (readonly number[])[];
  marketHistory:readonly number[];holdings:readonly M40Holding[];equityUsd:number;settledCashUsd:number;
  isReviewSession:boolean}):M40Decision[] {
  const {symbols,stockHistory,marketHistory,holdings,equityUsd,settledCashUsd,isReviewSession}=args;
  const strategyId='m40-paper-v1';
  const owned=new Map<string,M40Holding[]>();
  for(const h of holdings)if(h.strategyId===strategyId)owned.set(h.symbol,[...(owned.get(h.symbol)??[]),h]);
  const last=marketHistory[marketHistory.length-2];
  let meanDelta=0;
  for(let i=marketHistory.length-201;i<marketHistory.length-1;i++)meanDelta+=(marketHistory[i]-last)/200;
  const marketPass=meanDelta<0;
  const ranked=symbols.map((symbol,i)=>({symbol,index:i,momentum:stockHistory[i].at(-1)!/stockHistory[i].at(-127)!-1}))
    .filter(c=>c.momentum>0&&(!args.candidateSymbols||args.candidateSymbols.includes(c.symbol))).sort((a,b)=>b.momentum-a.momentum||(a.symbol<b.symbol?-1:a.symbol>b.symbol?1:0));
  const selected=new Set(marketPass?ranked.slice(0,5).map(c=>c.symbol):[]);
  const exits=new Set<string>(),decisions:M40Decision[]=[];
  for(const [symbol,lots] of [...owned].sort(([a],[b])=>a<b?-1:a>b?1:0)){
    const sell=isReviewSession&&!selected.has(symbol);
    if(sell)exits.add(symbol);
    decisions.push({symbol,strategyId,action:sell?'sell':'hold',reason:sell?(marketPass?'outside_top5':'market_gate_failed'):
      !isReviewSession?'between_reviews':'selected_retained_without_reweighting',quantity:lots.reduce((s,h)=>s+h.quantity,0),
      positionIds:lots.flatMap(h=>h.positionId?[h.positionId]:[])});
  }
  if(isReviewSession&&marketPass){
    const projected=new Set(holdings.filter(h=>h.strategyId!==strategyId||!exits.has(h.symbol)).map(h=>h.symbol));
    let cash=settledCashUsd;
    const budget=equityUsd*M40_POLICY.entryBudgetFraction;
    for(const candidate of ranked.slice(0,5)){
      if(owned.has(candidate.symbol)||holdings.some(h=>h.symbol===candidate.symbol&&h.strategyId!==strategyId)||projected.size>=5)continue;
      const price=stockHistory[candidate.index].at(-1)!,limit=Math.min(budget,cash);
      let quantity=Math.min(Number.MAX_SAFE_INTEGER,Math.floor(limit/(price*(1+M40_POLICY.feePerSide))));
      let notional=quantity*price,fee=notional*M40_POLICY.feePerSide,debit=notional+fee;
      while(quantity>0&&(debit>limit||!Number.isSafeInteger(quantity))){quantity--;notional=quantity*price;fee=notional*M40_POLICY.feePerSide;debit=notional+fee;}
      if(quantity<=0)continue;
      decisions.push({symbol:candidate.symbol,strategyId,action:'buy',reason:'scheduled_top5_entry',quantity,
        referencePriceUsd:price,entryBudgetUsd:budget,estimatedNotionalUsd:notional,estimatedFeeUsd:fee,
        estimatedDebitUsd:debit,requiresExitSymbols:[...exits].sort()});
      cash-=debit;projected.add(candidate.symbol);
    }
  }
  return decisions;
}
function randomGenerator(seed:string):()=>number {
  let state=createHash('sha256').update(seed).digest().readUInt32LE(0);
  // Mulberry32, recorded as part of the immutable model version.
  return ()=>{state=(state+0x6D2B79F5)|0;let v=Math.imul(state^(state>>>15),1|state);
    v^=v+Math.imul(v^(v>>>7),61|v);return ((v^(v>>>14))>>>0)/4294967296;};
}
export function forecastQuantile(sorted:readonly number[],q:number):number {
  if(!sorted.length||!Number.isFinite(q)||q<0||q>1)throw Error('forecast_distribution_invalid');
  const at=(sorted.length-1)*q,lo=Math.floor(at),hi=Math.ceil(at),weight=at-lo;
  const left=sorted[lo],right=sorted[hi];
  if(!Number.isFinite(left)||!Number.isFinite(right))throw Error('forecast_distribution_invalid');
  if(lo===hi)return left;
  // Normalize first: right-left may overflow even when both endpoints and their quantile are finite.
  const scale=Math.max(Math.abs(left),Math.abs(right));
  if(scale===0)return 0;
  const normalized=(left/scale)*(1-weight)+(right/scale)*weight;
  return scale*Math.max(-1,Math.min(1,normalized));
}
function distribution(values:number[]):ForecastDistribution {
  if(!values.length||values.some(v=>!Number.isFinite(v)))throw Error('forecast_distribution_invalid');
  values.sort((a,b)=>a-b);
  const scale=values.reduce((largest,v)=>Math.max(largest,Math.abs(v)),0);
  // A compensated sum of normalized terms cannot overflow; the final mean is bounded by the input scale.
  let sum=0,compensation=0;
  if(scale>0)for(const value of values){const term=value/scale-compensation,next=sum+term;
    compensation=(next-sum)-term;sum=next;}
  const mean=scale===0?0:scale*Math.max(-1,Math.min(1,sum/values.length));
  const result={mean,p10:forecastQuantile(values,.1),p50:forecastQuantile(values,.5),p90:forecastQuantile(values,.9)};
  if(Object.values(result).some(v=>!Number.isFinite(v)))throw Error('forecast_distribution_invalid');
  return result;
}
function finitePositive(v:number):boolean{return Number.isFinite(v)&&v>0;}
/** One longest path per replicate; all horizons use that path's prefixes. No failed paths are dropped.
 * The monotonic budget is operational only and is excluded from successful deterministic results.
 */
export async function runForecastEngine(input:PreparedForecastInput,options:ForecastEngineOptions):Promise<ForecastEngineResult> {
  const B=options.pathCount??2000,L=options.blockLength??10,N=input.marketReturns.length;
  const {residuals:_privateResiduals,...bridge}=input.bridge;
  const result:ForecastEngineResult={status:'failed',issues:[],modelVersion:input.modelVersion,
    calibration:'uncalibrated_research_scenario',quantileConvention:'linear_type7',seed:options.seed,pathCount:B,blockLength:L,
    inputSha256:input.inputSha256,policySha256:input.policySha256,sourceSha256:input.sourceSha256,
    sourceDatasetId:input.sourceDatasetId,issuedAt:input.issuedAt,sourceAvailableAt:input.sourceAvailableAt,baseline:{...input.baseline},
    sampleCounts:{historicalReturns:N,historicalStart:input.returnSessions[0],historicalEnd:input.returnSessions.at(-1)!,
      blockLength:L,possibleBlockStarts:N-L+1,nonoverlappingBlocks:Math.floor(N/L)},bridge,
    assumptions:[...input.assumptions,'prng_mulberry32_sha256_seed_nul_path_index_first_u32_le'],horizons:[]};
  try{
    if(typeof options.seed!=='string'||!options.seed||options.seed.length>1024||!Number.isSafeInteger(B)||B<1||B>10000
      ||!Number.isSafeInteger(L)||L<1||L>N||N<252||!finitePositive(input.baseline.equityUsd)
      ||(options.budgetMs!==undefined&&(!finitePositive(options.budgetMs)||options.budgetMs>600000)))throw Error('forecast_engine_options_invalid');
    const longest=input.targets.at(-1)!.sessions;
    if(longest<1||longest>260)throw Error('forecast_horizon_session_budget');
    const began=performance.now();
    const samples=input.targets.map(()=>[] as number[]),sessionIndex=new Map(input.calendar.map((c,i)=>[c.session,i]));
    const epochIndex=sessionIndex.get(input.baseline.epochSession);
    if(epochIndex===undefined)throw Error('forecast_epoch_unknown');
    const settlement=new Map<string,string>();
    for(let d=1;d<=longest;d++){
      if(performance.now()-began>(options.budgetMs??120000))throw Error('forecast_execution_budget_exceeded');
      const day=input.calendar[input.baselineIndex+d].session;
      settlement.set(day,nextPaperSettlementSession(input.calendar,day));
      if(d%8===0)await yieldImmediate();
    }
    const checkBudget=()=>{if(performance.now()-began>(options.budgetMs??120000))throw Error('forecast_execution_budget_exceeded');};
    for(let p=0;p<B;p++){
      checkBudget();
      const rng=randomGenerator(`${options.seed}\0path:${p}`);
      let book:PaperBook=JSON.parse(JSON.stringify(input.book));
      const stocks=input.stockHistory.map(h=>[...h]),market=[...input.marketHistory];
      if(input.bridge.kind==='latent_index_ols_centered_residual'){
        const r=input.bridge.intercept+input.bridge.slope*input.bridge.predictor
          +input.bridge.residuals[Math.floor(rng()*input.bridge.residuals.length)];
        const level=market.at(-1)!*(1+r);
        if(!finitePositive(level))throw Error('forecast_latent_index_path_invalid');
        market.push(level);
      }
      let pending:PaperIntent[]=JSON.parse(JSON.stringify(input.pendingIntents)),blockStart=0;
      for(let d=1;d<=longest;d++){
        if((d-1)%L===0)blockStart=Math.floor(rng()*(N-L+1));
        const sampled=blockStart+(d-1)%L,at=input.baselineIndex+d,day=input.calendar[at];
        const opens:number[]=[],prices=new Map<string,number>();
        for(let s=0;s<input.symbols.length;s++){
          const open=stocks[s].at(-1)!*input.overnight[sampled][s];
          const close=open*input.intraday[sampled][s];
          if(!finitePositive(open)||!finitePositive(close))throw Error('forecast_price_path_invalid');
          opens.push(open);stocks[s].push(close);prices.set(input.symbols[s],close);
        }
        const index=market.at(-1)!*input.marketReturns[sampled];
        if(!finitePositive(index))throw Error('forecast_index_path_invalid');
        market.push(index);
        if(pending.length){
          book=settlePaperSignals({book,intents:pending,
            opens:input.symbols.map((symbol,s)=>({symbol,session:day.session,open:opens[s],observedAt:day.openAt,sha256:'scenario'})),
            session:day.session,cutoff:day.closeAt,openingAt:s=>input.calendar[sessionIndex.get(s)!].openAt,
            settlementAfter:s=>settlement.get(s)!}).book;
          pending=[];
        }
        const marked=markPaperBook(book,prices,day.session);book=marked.book;
        if(!finitePositive(marked.equityUsd)||!Number.isFinite(book.cashUsd)||book.cashUsd < -1e-8)
          throw Error('forecast_book_path_invalid');
        for(let h=0;h<input.targets.length;h++)if(d===input.targets[h].sessions){
          const pnl=marked.equityUsd-input.baseline.equityUsd;
          if(!Number.isFinite(pnl))throw Error('forecast_pnl_path_invalid');
          samples[h].push(pnl);
        }
        const review=at>=epochIndex&&(at-epochIndex)%20===0;
        // Under the frozen-universe assumption there is no newly confirmed membership exit.
        // Canonical policy otherwise emits no trades between reviews.
        if(review&&d<longest){
          const decisions=forecastReplayDecisions({symbols:input.symbols,candidateSymbols:input.candidateSymbols,stockHistory:stocks,marketHistory:market,
            holdings:book.holdings,equityUsd:marked.equityUsd,settledCashUsd:marked.settledCashUsd,isReviewSession:true});
          const plan:M40Plan={strategyId:'m40-paper-v1',asOfSession:day.session,decisionTime:day.closeAt,status:'ready',
            isReviewSession:true,decisions,candidates:[],warnings:[],advisories:[],gates:{sessionInput:'pass',accountInput:'pass',
              marketTrend:'unknown',universeData:'pass',marketReferenceSession:null,marketClose:null,marketSma200:null}};
          pending=generatePaperSignals({accountId:input.baseline.accountId,cycleId:`forecast-${p}-${d}`,plan,
            runId:'forecast-only',inputSha256:input.inputSha256,executeSession:input.calendar[at+1].session,
            createdAt:day.closeAt,mode:'forward'});
        }
      }
      // Path-level yielding keeps health checks and other timers responsive. No successful path is omitted.
      await yieldImmediate();checkBudget();options.onProgress?.(p+1,B);
    }
    result.horizons=input.targets.map((target,h)=>{
      const values=samples[h];if(values.length!==B)throw Error('forecast_path_denominator_incomplete');
      const lossCount=values.filter(v=>v<0).length,lossProbability=lossCount/B;
      return {...target,netUsd:distribution([...values]),netPct:distribution(values.map(v=>v/input.baseline.equityUsd*100)),
        lossCount,pathCount:B,lossProbability,monteCarloSe:Math.sqrt(lossProbability*(1-lossProbability)/B),
        historicalNonoverlappingWindows:Math.floor(N/target.sessions)};
    });
    if(result.horizons.some(h=>[...Object.values(h.netUsd),...Object.values(h.netPct),h.lossCount,h.pathCount,
      h.lossProbability,h.monteCarloSe,h.sessions,h.historicalNonoverlappingWindows].some(v=>!Number.isFinite(v))))
      throw Error('forecast_final_statistics_invalid');
    result.status='completed';return result;
  }catch(e){result.issues=[e instanceof Error?e.message:'forecast_engine_failed'];result.horizons=[];return result;}
}

import { planM40 } from '../core';
import { prepareForecastInput, forecastTargets } from '../forecast-input';
import { forecastReplayDecisions, forecastQuantile, runForecastEngine } from '../forecast-engine';
import { forecastFixture } from './forecast-fixture';
import type { PreparedForecastInput } from '../forecast-types';
import type { M40Input, M40Holding } from '../types';

function prepared(flat=false):PreparedForecastInput {
 const result=prepareForecastInput(forecastFixture(6,flat));
 if(result.status!=='qualified')throw Error(result.issues.join(','));return result.input;
}
describe('forecast actual-source preparation',()=>{
 test('marks the current book independently and retains provisional epoch',()=>{
  const f=forecastFixture(),before=JSON.stringify(f);f.book.initialEquityUsd=1;
  f.book.holdings=[{symbol:'NAS:S000',quantity:2,strategyId:'m40-paper-v1'}];
  const p=prepareForecastInput(f);expect(p.status).toBe('qualified');if(p.status!=='qualified')return;
  expect(p.input.baseline.equityUsd).toBeGreaterThan(10000);expect(p.input.baseline.equityUsd).not.toBe(1);
  expect(p.input.baseline).toMatchObject({epochProvisional:true,epochSession:'2026-11-09',session:'2026-11-06'});
  expect(f.policy.epochSession).toBeNull();expect(JSON.stringify(forecastFixture())).toBe(before);
 });
 test('future row addition and record permutations do not change private input',()=>{
  const f=forecastFixture(),a=prepareForecastInput(f);f.bundle.records.reverse();
  for(const r of f.bundle.records)r.rows.push({...r.rows.at(-1)!,session:'2026-11-09',close:'99999'});
  f.bundle.market!.rows.push({session:'2026-11-09',close:'99999'});
  expect(prepareForecastInput(f)).toEqual(a);
 });
 test('missing held mark, missing joint day, invalid price, and unknown-by-issue block explicitly',()=>{
  const f=forecastFixture();f.book.holdings=[{symbol:'NAS:S000',quantity:1,strategyId:'m40-paper-v1'}];
  f.bundle.records[0].rows.pop();expect(prepareForecastInput(f).status).toBe('blocked');
  const g=forecastFixture();for(const r of g.bundle.records)r.rows.splice(-10,1);
  expect(prepareForecastInput(g)).toMatchObject({status:'blocked',issues:['forecast_joint_history_below_252_returns']});
  const h=forecastFixture();h.bundle.records[0].rows.at(-1)!.close='0';expect(prepareForecastInput(h).status).toBe('blocked');
  const j=forecastFixture();j.sourceAvailableAt='2026-11-09T00:00:00Z';expect(prepareForecastInput(j).status).toBe('blocked');
 });
 test('one missing index session is latent, two sessions or degenerate fit are blocked',()=>{
  const f=forecastFixture();f.bundle.market!.rows.pop();const a=prepareForecastInput(f);
  expect(a.status).toBe('qualified');if(a.status==='qualified')expect(a.input.bridge).toMatchObject({kind:'latent_index_ols_centered_residual',session:'2026-11-06'});
  f.bundle.market!.rows.pop();expect(prepareForecastInput(f).status).toBe('blocked');
  const g=forecastFixture(6,true);g.bundle.market!.rows.pop();expect(prepareForecastInput(g)).toMatchObject({status:'blocked',issues:['forecast_index_bridge_degenerate']});
 });
 test('split jumps use adjusted paired open, not raw close returns',()=>{
  const f=forecastFixture(6,true);
  for(const r of f.bundle.records.filter(r=>r.basis==='raw'))for(const row of r.rows.slice(-30))row.open=row.close='50';
  const p=prepareForecastInput(f);expect(p.status).toBe('qualified');if(p.status!=='qualified')return;
  expect(p.input.overnight.every(row=>row.every(v=>v===1))).toBe(true);
  expect(p.input.intraday.every(row=>row.every(v=>v===1))).toBe(true);
 });
 test('stale source does not become current on a later issue date',()=>{
  const f=forecastFixture();f.issuedAt='2026-11-10T22:00:00Z';expect(prepareForecastInput(f)).toMatchObject({status:'blocked',issues:['forecast_source_price_stale']});
 });
 test('four anniversary endpoints share the original date and clamp once',()=>{
  const f=forecastFixture();const t=forecastTargets('2026-01-30',f.calendar);
  expect(t.map(x=>x.calendarTarget)).toEqual(['2026-02-06','2026-02-28','2026-04-30','2027-01-30']);
 });
});
describe('compact numerical policy equivalence',()=>{
 test('fee-inclusive integer sizing respects the exact settled-cash boundary',()=>{
  const stocks=[Array.from({length:127},(_,i)=>i===126?100:50)],market=Array.from({length:201},(_,i)=>100+i);
  const plan=(cash:number)=>forecastReplayDecisions({symbols:['NAS:S000'],stockHistory:stocks,marketHistory:market,holdings:[],equityUsd:1000,settledCashUsd:cash,isReviewSession:true});
  expect(plan(100)).toEqual([]);expect(plan(100.25)[0]).toMatchObject({action:'buy',quantity:1,estimatedDebitUsd:100.25});
 });
 test('matches canonical actionable and hold decisions over 150 varied accounts and paths',()=>{
  const p=prepared();const days=p.historySessions;
  for(let trial=0;trial<150;trial++){
   const candidateSymbols=trial%3===0?p.symbols.slice(1):p.symbols;
   const stocks=p.stockHistory.map((h,s)=>h.map((v,d)=>v*Math.exp(Math.sin((trial+1)*(s+1)*.13)*d*.001)));
   const holdings:M40Holding[]=[];
   for(let s=0;s<6;s++)if((trial+s)%3===0)holdings.push({symbol:p.symbols[s],quantity:2+s,strategyId:(trial+s)%5===0?null:'m40-paper-v1',positionId:`position-${s}`});
   if(trial%7===0)holdings.push({symbol:p.symbols[0],quantity:3,strategyId:'m40-paper-v1',positionId:'second-lot'});
   const market=p.marketHistory.map((v,d)=>v*Math.exp((trial%3-1)*d*.002));
   const equity=10000+trial*17,cash=trial%9===0?.01:trial%11===0?100.25:5000+trial;
   const review=trial%4!==0,epoch=days[review?days.length-1:days.length-2];
   const input:M40Input={asOfSession:days.at(-1)!,decisionTime:p.issuedAt,sessions:days,rebalanceEpochSession:epoch,
    strategyId:'m40-paper-v1',marketBars:days.map((session,d)=>({session,close:market[d],final:true,priceBasis:'index',availableAt:p.sourceAvailableAt})),
    universeComplete:true,members:p.symbols.map((symbol,s)=>({symbol,membership:candidateSymbols.includes(symbol)?'eligible':'ineligible',bars:days.map((session,d)=>({session,close:stocks[s][d],final:true,
     priceBasis:'split_adjusted',availableAt:p.sourceAvailableAt})),quote:{session:days.at(-1)!,price:stocks[s].at(-1)!,availableAt:p.sourceAvailableAt,priceBasis:'raw'}})),
    holdings,account:{equityUsd:equity,settledCashUsd:cash}};
   const canonical=planM40(input);expect(canonical.status).toBe('ready');
   expect(forecastReplayDecisions({symbols:p.symbols,candidateSymbols,stockHistory:stocks,marketHistory:market,holdings,equityUsd:equity,settledCashUsd:cash,isReviewSession:review}))
    .toEqual(canonical.decisions);
  }
 });
});
describe('seeded coherent scenario engine',()=>{
 test('flat prices no trades charges no fee, including pre-existing holdings',async()=>{
  const p=prepared(true);p.book.holdings=[{symbol:p.symbols[0],quantity:3,strategyId:null}];
  p.book.cashUsd-=300;
  const r=await runForecastEngine(p,{seed:'flat',pathCount:8});
  expect(r.status).toBe('completed');expect(r.horizons).toHaveLength(4);
  for(const h of r.horizons){expect(h.netUsd).toEqual({mean:0,p10:0,p50:0,p90:0});expect(h.lossProbability).toBe(0);}
 });
 test('pre-existing pending buy then canonical next-open sale charges each side once',async()=>{
  const f=forecastFixture(1,true);for(const r of f.bundle.records)for(const row of r.rows)row.open=row.close='10';
  f.book.cashUsd=f.book.initialEquityUsd=f.book.peakEquityUsd=1000;
  f.pendingIntents=[{id:'existing-pending',accountId:f.accountId,cycleId:'existing-cycle',session:'2026-11-06',createdAt:f.sourceAvailableAt,
   symbol:'NAS:S000',side:'buy',quantity:10,executeSession:'2026-11-09',executionScope:'paper_only',status:'awaiting_open',maxDebitUsd:150,
   sourceRunId:'synthetic',inputSha256:'a'.repeat(64),reason:'scheduled_top5_entry',feePerSide:.0025,fillModel:'next_open_fixed_quantity_or_expire'}];
  const p=prepareForecastInput(f);expect(p.status).toBe('qualified');if(p.status!=='qualified')return;
  const r=await runForecastEngine(p.input,{seed:'fees',pathCount:4});expect(r.status).toBe('completed');
  for(const h of r.horizons){expect(h.netUsd.mean).toBeCloseTo(-.50,10);expect(h.lossProbability).toBe(1);}
  const original=prepared(true);original.book.holdings=[{symbol:original.symbols[0],quantity:1,strategyId:'m40-paper-v1'}];original.book.cashUsd-=100;
  const held=await runForecastEngine(original,{seed:'held-fee',pathCount:4});
  for(const h of held.horizons)expect(h.netUsd.mean).toBeCloseTo(-.25,10);
 });
 test('same input and seed is byte-identical, all horizons use the longest path prefixes',async()=>{
  const p=prepared(),a=await runForecastEngine(p,{seed:'deterministic',pathCount:8}),b=await runForecastEngine(p,{seed:'deterministic',pathCount:8});
  expect(a.status).toBe('completed');expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  expect(a.horizons.map(h=>h.pathCount)).toEqual([8,8,8,8]);
  for(const h of a.horizons)expect(h.monteCarloSe).toBe(Math.sqrt(h.lossProbability*(1-h.lossProbability)/8));
 });
 test('shorter horizons are prefixes of exactly the same path replicates',async()=>{
  const p=prepared(),full=await runForecastEngine(p,{seed:'prefix',pathCount:7});
  p.targets=p.targets.slice(0,1);const short=await runForecastEngine(p,{seed:'prefix',pathCount:7});
  expect(short.horizons[0]).toEqual(full.horizons[0]);
 });
 test('joint blocks preserve identical columns, including held symbols outside the candidate cohort',async()=>{
  const a=forecastFixture(2),b=forecastFixture(1);
  for(const basis of ['raw','split_adjusted']){const first=a.bundle.records.find(r=>r.symbol==='NAS:S000'&&r.basis===basis)!;
   a.bundle.records.find(r=>r.symbol==='NAS:S001'&&r.basis===basis)!.rows=JSON.parse(JSON.stringify(first.rows));}
  a.book.holdings=[{symbol:'NAS:S000',quantity:1,strategyId:null},{symbol:'NAS:S001',quantity:1,strategyId:null}];
  a.policy.frozenCohort!.symbols=['NAS:S000'];
  b.book.holdings=[{symbol:'NAS:S000',quantity:2,strategyId:null}];
  const pa=prepareForecastInput(a),pb=prepareForecastInput(b);expect(pa.status).toBe('qualified');expect(pb.status).toBe('qualified');
  if(pa.status!=='qualified'||pb.status!=='qualified')return;
  expect(pa.input.candidateSymbols).toEqual(['NAS:S000']);expect(pa.input.symbols).toHaveLength(2);
  const ra=await runForecastEngine(pa.input,{seed:'joint',pathCount:7}),rb=await runForecastEngine(pb.input,{seed:'joint',pathCount:7});
  for(let h=0;h<4;h++){expect(ra.horizons[h].lossCount).toBe(rb.horizons[h].lossCount);
   for(const q of ['mean','p10','p50','p90'] as const)expect(ra.horizons[h].netUsd[q]).toBeCloseTo(rb.horizons[h].netUsd[q],9);}
 });
 test('a failed path invalidates the run, never a reduced denominator',async()=>{
  const p=prepared();p.overnight=p.overnight.map(r=>r.map(()=>Infinity));
  const r=await runForecastEngine(p,{seed:'invalid',pathCount:8});expect(r).toMatchObject({status:'failed',horizons:[],pathCount:8});
 });
 test('finite extreme paths cannot overflow means, quantiles or percentage summaries',async()=>{
  const p=prepared(true);p.baseline.equityUsd=1e308;p.book.cashUsd=0;
  p.book.holdings=[{symbol:p.symbols[0],quantity:1,strategyId:null}];
  p.stockHistory=p.stockHistory.map(h=>h.map(()=>1e308));
  p.overnight=p.overnight.map(r=>r.map(()=>.1));
  const r=await runForecastEngine(p,{seed:'aggregate-overflow',pathCount:4});
  expect(r.status).toBe('completed');
  for(const h of r.horizons)for(const value of [...Object.values(h.netUsd),...Object.values(h.netPct)])expect(Number.isFinite(value)).toBe(true);
  expect(r.horizons[0].netUsd.mean).toBeCloseTo(r.horizons[0].netUsd.p50,-290);
  expect(forecastQuantile([-1e308,1e308],.5)).toBe(0);
  expect(forecastQuantile([Number.MAX_VALUE,Number.MAX_VALUE],.9)).toBe(Number.MAX_VALUE);
  p.baseline.equityUsd=Number.MIN_VALUE;
  const invalid=await runForecastEngine(p,{seed:'percentage-overflow',pathCount:1});
  expect(invalid.status).toBe('failed');expect(invalid.horizons).toEqual([]);
 });
 test('zero denominator and exceeded execution budget are unavailable',async()=>{
  const p=prepared();expect((await runForecastEngine(p,{seed:'zero',pathCount:0})).status).toBe('failed');
  expect(await runForecastEngine(p,{seed:'budget',pathCount:8,budgetMs:.00001})).toMatchObject({status:'failed',issues:['forecast_execution_budget_exceeded'],horizons:[]});
 });
 test('yields to timers and does not mutate the input book',async()=>{
  const p=prepared(),before=JSON.stringify(p);let tick=false;
  const timer=setTimeout(()=>{tick=true;},0);await runForecastEngine(p,{seed:'yield',pathCount:5});clearTimeout(timer);
  expect(tick).toBe(true);expect(JSON.stringify(p)).toBe(before);
 });
});

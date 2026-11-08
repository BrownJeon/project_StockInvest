import type { PaperForecastHorizon, PaperViewQuery } from '@/lib/strategy/m40/paper-view-types';
export const PAPER_PAGE_SIZE = 10;
export const PAPER_INITIAL_QUERY: PaperViewQuery = { period:'all',anchorSession:null,signalPage:1,valuationPage:1,horizon:'week',snapshot:null };
export const paperHorizonLabel=(h:PaperForecastHorizon)=>({week:'1주',month:'1개월',quarter:'3개월',year:'1년'}[h]);
export function paperLocalPage<T>(rows:readonly T[],page:number){
 const totalCount=rows.length,totalPages=Math.max(1,Math.ceil(totalCount/PAPER_PAGE_SIZE));
 const current=Math.min(Math.max(1,page),totalPages);
 return {rows:rows.slice((current-1)*PAPER_PAGE_SIZE,current*PAPER_PAGE_SIZE),page:current,pageSize:10 as const,totalCount,totalPages,hasNext:current<totalPages,hasPrevious:current>1};
}
export function paperQueryUrl(q:PaperViewQuery){
 const p=new URLSearchParams({period:q.period,signalPage:String(q.signalPage),valuationPage:String(q.valuationPage),horizon:q.horizon,forecastPage:String(q.forecastPage??1),comparisonPage:String(q.comparisonPage??1)});
 if(q.period!=='all'&&q.anchorSession)p.set('anchorSession',q.anchorSession);
 if(q.snapshot)p.set('snapshot',q.snapshot);
 if(q.forecastId)p.set('forecastId',q.forecastId);
 return `/api/research/t156/paper?${p.toString()}`;
}
/** A period changes the observation snapshot; a page/horizon reads the same snapshot. */
export function paperNextQuery(q:PaperViewQuery,patch:Partial<PaperViewQuery>,token:string|null):PaperViewQuery {
 const changedPeriod=patch.period!==undefined&&patch.period!==q.period||patch.anchorSession!==undefined&&patch.anchorSession!==q.anchorSession;
 const next={...q,...patch};
 return changedPeriod?{...next,anchorSession:next.period==='all'?null:next.anchorSession,signalPage:1,valuationPage:1,snapshot:null}:{...next,snapshot:token};
}
/** Actual poll 401 is unauthorized; authentication loss forgets private selection and snapshot. */
export function paperQueryAfterAuthError(q:PaperViewQuery,error:string|null):PaperViewQuery{
 if(!['unauthorized','http_401','http_403'].includes(error??''))return q;
 return q.forecastId||q.snapshot?{...q,forecastId:null,snapshot:null,signalPage:1,valuationPage:1,forecastPage:1,comparisonPage:1}:q;
}
export function paperTabIndex(index:number,key:string,total:number){
 return key==='Home'?0:key==='End'?total-1:key==='ArrowRight'?(index+1)%total:key==='ArrowLeft'?(index+total-1)%total:null;
}

// This is a rendering boundary, not a replacement for the server's authorization/schema.
// Check the containers and child values that the v6 view dereferences before showing any DTO.
function paperRecord(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
const paperStrings=(value:unknown):value is string[]=>Array.isArray(value)&&value.every(v=>typeof v==='string');
const paperNullableText=(value:unknown)=>value===null||typeof value==='string';
function paperPoint(value:unknown){return paperRecord(value)&&typeof value.session==='string'&&(value.equityUsd===null||typeof value.equityUsd==='number');}
function paperCycle(value:unknown):boolean{
 if(value===null)return true;
 if(!paperRecord(value)||typeof value.session!=='string'||!paperRecord(value.collection))return false;
 const c=value.collection;
 return Array.isArray(c.sources)&&c.sources.every(s=>paperRecord(s)&&typeof s.sourceId==='string'&&typeof s.kind==='string'&&typeof s.latestSession==='string')&&paperStrings(c.issues)
  &&['eligibility','candidates','decisions','warnings','judgments'].every(key=>Array.isArray(value[key])&&(value[key] as unknown[]).every(paperRecord))
  &&['eligibility','candidates','decisions'].every(key=>(value[key] as Record<string,unknown>[]).every(row=>typeof row.symbol==='string'))
  &&(value.eligibility as Record<string,unknown>[]).every(row=>paperStrings(row.issues));
}
function paperPage(value:unknown,row:(value:unknown)=>boolean):boolean{
 return paperRecord(value)&&Array.isArray(value.rows)&&value.rows.every(row)&&value.pageSize===10
  &&typeof value.page==='number'&&value.page>=1&&typeof value.totalCount==='number'&&value.totalCount>=0
  &&typeof value.totalPages==='number'&&value.totalPages>=1&&typeof value.hasNext==='boolean'&&typeof value.hasPrevious==='boolean';
}
const paperFinite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const paperCount=(v:unknown)=>paperFinite(v)&&Number.isSafeInteger(v)&&v>=0;
function paperForecastHorizon(v:unknown):boolean{
 if(!paperRecord(v)||!['week','month','quarter','year'].includes(String(v.horizon))||!['calendarTarget','targetSession'].every(k=>typeof v[k]==='string')||!paperCount(v.sessions)||v.sessions===0)return false;
 if(!['netUsd','netPct'].every(k=>paperRecord(v[k])&&['mean','p10','p50','p90'].every(n=>paperFinite((v[k] as Record<string,unknown>)[n]))))return false;
 if(!paperCount(v.lossCount)||!paperCount(v.pathCount)||!paperFinite(v.pathCount)||v.pathCount<=0||!paperFinite(v.lossCount)||v.lossCount>v.pathCount||!paperFinite(v.lossProbability)||v.lossProbability<0||v.lossProbability>1||Math.abs(v.lossProbability-v.lossCount/v.pathCount)>1e-12)return false;
 return paperFinite(v.monteCarloSe)&&v.monteCarloSe>=0&&v.monteCarloSe<=1&&paperCount(v.historicalNonoverlappingWindows);
}
function paperForecastRecord(v:unknown):boolean{
 if(!paperRecord(v)||!paperRecord(v.baseline)||!paperRecord(v.sampleCounts)||!paperRecord(v.bridge)||!paperStrings(v.assumptions)||!paperForecastHorizon(v.result))return false;
 const b=v.baseline,s=v.sampleCounts,bridge=v.bridge;
 return ['id','sha256','inputSha256','issuedAt','sourceAvailableAt','sourceDatasetId','sourceSha256','policySha256','modelVersion','seed'].every(k=>typeof v[k]==='string')
  &&paperNullableText(v.modelCodeSha256)&&['session','accountId','bookSha256','sourceAccountStateSha256','epochSession'].every(k=>typeof b[k]==='string')&&b.kind==='forecast_only_marked_snapshot'&&paperFinite(b.equityUsd)&&b.equityUsd>0&&paperCount(b.accountRevision)&&typeof b.epochProvisional==='boolean'
  &&['historicalStart','historicalEnd'].every(k=>typeof s[k]==='string')&&['historicalReturns','blockLength','possibleBlockStarts','nonoverlappingBlocks'].every(k=>paperCount(s[k]))
  &&['none','latent_index_ols_centered_residual'].includes(String(bridge.kind))&&['intercept','slope','predictor','sampleCount'].every(k=>paperFinite(bridge[k]))&&typeof bridge.residualSha256==='string'&&['session','fitStart','fitEnd'].every(k=>paperNullableText(bridge[k]));
}
function paperComparison(v:unknown):boolean{
 if(!paperRecord(v)||!['id','runId','horizon','createdAt'].every(k=>typeof v[k]==='string')||!['pending','unconfirmed','incomparable','completed'].includes(String(v.status))||!paperStrings(v.issues)||!paperForecastHorizon(v.forecast))return false;
 return v.status==='completed'?['actualPnlUsd','actualReturnPct','errorPct','brier'].every(k=>paperFinite(v[k]))&&typeof v.intervalHit==='boolean':['actualPnlUsd','actualReturnPct','errorPct','brier','intervalHit'].every(k=>v[k]===null);
}
function paperComparisonSummary(v:unknown):boolean{
 if(!paperRecord(v)||!['total','completed','pending','unconfirmed','incomparable'].every(k=>paperCount(v[k])))return false;
 if(v.total!==Number(v.completed)+Number(v.pending)+Number(v.unconfirmed)+Number(v.incomparable))return false;
 return v.completed===0?v.meanBrier===null&&v.intervalCoverage===null:[v.meanBrier,v.intervalCoverage].every(n=>paperFinite(n)&&n>=0&&n<=1);
}
function paperForecasts(v:Record<string,unknown>):boolean{
 if(!['week','month','quarter','year'].includes(String(v.horizon))||!Array.isArray(v.records)||!Array.isArray(v.comparison))return false;
 if(v.comparisonSummary!==undefined&&!paperComparisonSummary(v.comparisonSummary))return false;
 if(v.selectedRecord!=null&&!paperForecastRecord(v.selectedRecord))return false;
 if(v.capability==='not_implemented')return v.records.length===0&&v.comparison.length===0;
 if(!['available','preparing','unavailable'].includes(String(v.capability))||!paperPage(v.recordPage,paperForecastRecord)||!paperPage(v.comparisonPage,paperComparison)||!v.records.every(paperForecastRecord)||!v.comparison.every(paperComparison))return false;
 if(v.capability==='available')return paperRecord(v.selectedRecord)&&v.selectedId===v.selectedRecord.id&&v.selectionStatus==='selected'&&paperRecord(v.selectedRecord.result)&&v.selectedRecord.result.horizon===v.horizon&&paperComparisonSummary(v.comparisonSummary);
 return v.selectedRecord===null&&['empty','missing'].includes(String(v.selectionStatus))&&paperNullableText(v.selectedId);
}
export function isPaperViewV6(value:unknown):value is import('@/lib/strategy/m40/paper-view-types').PaperView{
 if(!paperRecord(value)||value.executionScope!=='paper_only'||value.liveTrading!==false||!paperRecord(value.account)||!paperRecord(value.snapshot)||!paperRecord(value.history)||!paperRecord(value.observation)||!paperRecord(value.policyRecord)||!paperRecord(value.forecasts))return false;
 const {snapshot,history,observation:o,policyRecord:policy,forecasts}=value;
 return typeof snapshot.token==='string'&&snapshot.token.length>0&&typeof snapshot.accountRevision==='number'
  &&paperRecord(history.availablePeriods)&&paperStrings(history.availablePeriods.weeks)&&paperStrings(history.availablePeriods.months)
  &&(history.firstSession===null||typeof history.firstSession==='string')&&(history.lastSession===null||typeof history.lastSession==='string')
  &&['startSession','endSession','asOfSession'].every(key=>paperNullableText(o[key]))
  &&paperStrings(o.issues)&&(o.baseline===null||paperRecord(o.baseline)&&paperPoint(o.baseline.point))
  &&(o.firstObserved===null||paperPoint(o.firstObserved))&&(o.lastObserved===null||paperPoint(o.lastObserved))
  &&typeof o.totalPoints==='number'&&typeof o.observedSessions==='number'
  &&(policy.policyVersion===null||typeof policy.policyVersion==='string')&&paperStrings(policy.modelPolicyVersions)
  &&paperForecasts(forecasts)
  &&paperCycle(value.currentCycle)&&paperCycle(value.lastUsableCycle)
  &&paperPage(value.signalPage,s=>paperRecord(s)&&typeof s.id==='string'&&typeof s.symbol==='string'&&typeof s.session==='string'&&(s.outcome===null||paperRecord(s.outcome)))
  &&paperPage(value.valuationPage,p=>paperPoint(p)&&paperRecord(p)&&typeof p.id==='string');
}
export function paperSafePoll(poll:import('@/components/ops/useOpsPoll').PollState<unknown>):import('@/components/ops/useOpsPoll').PollState<import('@/lib/strategy/m40/paper-view-types').PaperView>{
 if(poll.status==='ok'&&isPaperViewV6(poll.data))return poll as import('@/components/ops/useOpsPoll').PollState<import('@/lib/strategy/m40/paper-view-types').PaperView>;
 if(poll.status==='ok')return {status:'error',data:null,error:'bad_paper_view',lastOkAt:poll.lastOkAt};
 return {...poll,data:null};
}

/** Inclusive calendar span; elapsed days stop at the server's confirmed as-of session. */
export function paperCalendarSpan(period:PaperViewQuery['period'],start:string|null,end:string|null,asOf:string|null){
 const parse=(value:string|null)=>{
  if(!value||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const time=Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value?time:null;
 };
 const first=parse(start),last=parse(end),cutoff=parse(asOf);
 if(first===null||last===null||cutoff===null||last<first)return null;
 const totalDays=Math.round((last-first)/86_400_000)+1;
 const elapsedDays=cutoff<first?0:Math.round((Math.min(cutoff,last)-first)/86_400_000)+1;
 return {totalDays,elapsedDays,label:period==='week'?'1주':period==='month'?'1개월':'전체 관측범위'};
}

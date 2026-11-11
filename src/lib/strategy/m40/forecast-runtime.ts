/** Explicit forecast-only worker: archived data only; no collection, LLM, signals or account writes. */
import { paperPublicationDeadline } from './publication-window';
import { forecastCodeManifest } from './forecast-manifest';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { getPool } from '@/lib/db';
import { readBlob } from '@/lib/analysis-data/store';
import type { ArchiveQueryable } from '@/lib/analysis-data/types';
import { assertForwardSourceReadiness,validateForwardBrkPair,type ForwardSourceBundle } from './forward-sources';
import { BRK_PAIR_SYMBOL } from './forward-stock-contract';
import { brkPairProfileReady } from './forward-stock-alpaca';
import { loadForwardCalendar, readM40ForwardStatus } from './forward-runtime';
import { loadPaperAccount, loadPendingPaperIntents, requirePaperDryRun } from './forward-store';
import { prepareForecastInput } from './forecast-input';
import type { PreparedForecastInput } from './forecast-types';
import { runForecastEngine } from './forecast-engine';
import { acquireForecastJob, failForecastJob, publishForecast, forecastHash, forecastEvaluationWitness,type ForecastLease } from './forecast-store';
const parse=<T>(v:unknown):T=>typeof v==='string'?JSON.parse(v):v as T;
type Row=Record<string,unknown>;
export const forecastDailyJobId=(accountId:string,session:string,seed:string)=>forecastHash(['daily-session-v2',accountId,session,seed]);
async function publishedForecastForSession(accountId:string,session:string,db:ArchiveQueryable){
 const [runs]=await db.query<Row[]>(`SELECT id FROM t156_forecast_run WHERE account_id=?
  AND JSON_UNQUOTE(JSON_EXTRACT(input_json,'$.baseline.session'))=? ORDER BY issued_at,id LIMIT 1`,[accountId,session]);
 return runs.length?String(runs[0].id):null;
}
type ForecastRuntimePreparation={ready:true;lease:ForecastLease;input:PreparedForecastInput;codeManifest:ReturnType<typeof forecastCodeManifest>}
 | {ready:false;response:Record<string,unknown>};
async function forecastFailureResponse(e:unknown,lease:ForecastLease,accountId:string,session:string,db:ArchiveQueryable):Promise<Record<string,unknown>> {
 await failForecastJob(lease,'forecast_run_failed',db);
 if(e instanceof Error&&e.message==='forecast_session_already_published'){const published=await publishedForecastForSession(accountId,session,db);if(published)return {status:'already_published',runId:published,executionScope:'forecast_only'};}
 throw e;
}
/** Large archived bytes/bundle stay in this frame, never in the engine/publication frame. */
async function prepareForecastRuntime(db:ArchiveQueryable,seed:string):Promise<ForecastRuntimePreparation>{
 await requirePaperDryRun(db);
 const readiness=await readM40ForwardStatus(db);
 if(!readiness.completed||!readiness.sourceReady||!readiness.beforeNextOpen)return {ready:false,response:{status:'blocked',issueCode:'forecast_forward_not_ready'}};
 const account=await loadPaperAccount(db);if(!account||account.status!=='active')return {ready:false,response:{status:'blocked',issueCode:'forecast_account_unavailable'}};
 const existing=await publishedForecastForSession(account.id,String(readiness.session),db);
 if(existing)return {ready:false,response:{status:'already_published',runId:existing,executionScope:'forecast_only'}};
 const id=forecastDailyJobId(account.id,String(readiness.session),seed);
 const [legacyBusy]=await db.query<Row[]>(`SELECT id FROM t156_forecast_job WHERE account_id=? AND id<>?
  AND status='running' AND lease_until>UTC_TIMESTAMP(6) LIMIT 1`,[account.id,id]);
 if(legacyBusy.length)return {ready:false,response:{status:'running',completed:false,executionScope:'forecast_only'}};
 const [cycles]=await db.query<Row[]>(`SELECT id,JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.sourceBundleSha256')) sourceBundleSha256 FROM t156_paper_cycle WHERE account_id=? AND session_date=? AND mode='forward' LIMIT 1`,[account.id,readiness.session]);
 const anchor=cycles[0];if(!anchor||typeof anchor.sourceBundleSha256!=='string'||!/^[a-f0-9]{64}$/.test(anchor.sourceBundleSha256))return {ready:false,response:{status:'blocked',issueCode:'forecast_analysis_source_anchor_missing'}};
 const [rows]=await db.query<Row[]>(`SELECT r.dataset_id,r.payload_json,DATE_FORMAT(r.available_at,'%Y-%m-%dT%H:%i:%s.%fZ') availableAt
 FROM t156_record r JOIN t156_dataset d ON d.id=r.dataset_id WHERE d.kind='m40_paper_sources' AND d.status='published' AND d.live_eligible=0 AND r.record_type='m40_paper_source_bundle' AND r.available_at<=UTC_TIMESTAMP(6) AND d.content_sha256=? ORDER BY r.available_at DESC,r.dataset_id DESC LIMIT 1`,[anchor.sourceBundleSha256]);
 if(!rows.length)return {ready:false,response:{status:'blocked',issueCode:'forecast_source_unavailable'}};
 const row=rows[0],pointer=parse<{blobSha256:string;uncompressedSha256:string}>(row.payload_json);
 const bytes=gunzipSync(await readBlob(pointer.blobSha256,db),{maxOutputLength:24*1024*1024});
 if(pointer.uncompressedSha256!==anchor.sourceBundleSha256||createHash('sha256').update(bytes).digest('hex')!==pointer.uncompressedSha256)throw Error('forecast_source_hash_mismatch');
 const bundle=JSON.parse(bytes.toString()) as ForwardSourceBundle;
 const calendar=await loadForwardCalendar(db);
 const requiredSymbols=[...new Set([...(account.policy.frozenCohort?.symbols??account.policy.referenceSymbols),...account.book.holdings.map(h=>h.symbol)])];
 if(requiredSymbols.includes(BRK_PAIR_SYMBOL)&&!(await brkPairProfileReady()))throw Error('forecast_pair_profile_required');
 validateForwardBrkPair(bundle,calendar,requiredSymbols.includes(BRK_PAIR_SYMBOL),new Date().toISOString());
 assertForwardSourceReadiness(bundle,calendar,requiredSymbols,Object.values(account.book.splitBasis??{}).map(b=>b.session));
 const [latest]=await db.query<Row[]>(`SELECT d.content_sha256 latestSourceSha FROM t156_record r JOIN t156_dataset d ON d.id=r.dataset_id WHERE d.kind='m40_paper_sources' AND d.status='published' AND d.live_eligible=0 AND r.record_type='m40_paper_source_bundle' AND r.session_date=? AND r.available_at<=UTC_TIMESTAMP(6) ORDER BY r.available_at DESC,r.dataset_id DESC LIMIT 1`,[readiness.session]);
 if(latest[0]?.latestSourceSha!==anchor.sourceBundleSha256)return {ready:false,response:{status:'blocked',issueCode:'forecast_analysis_source_not_latest'}};
 const codeManifest=forecastCodeManifest();
 const lease=await acquireForecastJob(id,account.id,db);
 if(!lease){
  const published=await publishedForecastForSession(account.id,String(readiness.session),db);
  if(published)return {ready:false,response:{status:'already_published',runId:published,executionScope:'forecast_only'}};
  const [jobs]=await db.query<Row[]>('SELECT status,lease_until>UTC_TIMESTAMP(6) busy FROM t156_forecast_job WHERE id=? AND account_id=?',[id,account.id]);
  if(jobs[0]?.status==='running'&&Number(jobs[0]?.busy)===1)return {ready:false,response:{status:'running',completed:false,executionScope:'forecast_only'}};
  return {ready:false,response:{status:'blocked',issueCode:'forecast_job_state_unconfirmed'}};
 }
 try{
 // Recheck after acquiring the stable session lease. This also preserves legacy
 // immutable runs whose old input-hash job ID differs from daily-session-v2.
 const published=await publishedForecastForSession(account.id,String(readiness.session),db);
 if(published){await failForecastJob(lease,'forecast_session_already_published',db);return {ready:false,response:{status:'already_published',runId:published,executionScope:'forecast_only'}};}
 const prepared=prepareForecastInput({analysisSourceBundleSha256:String(anchor.sourceBundleSha256),accountId:account.id,accountRevision:account.revision,book:account.book,policy:account.policy,pendingIntents:await loadPendingPaperIntents(db),bundle,calendar,issuedAt:lease.issuedAt,sourceDatasetId:String(row.dataset_id),sourceAvailableAt:String(row.availableAt)});
 if(prepared.status==='blocked'){await failForecastJob(lease,'forecast_input_blocked',db);return {ready:false,response:{status:'blocked',issues:prepared.issues}};}
 lease.sourceProof={analysisCycleId:String(anchor.id),analysisSourceBundleSha256:String(anchor.sourceBundleSha256),pointerSha256:forecastHash(pointer),blobSha256:pointer.blobSha256,uncompressedSha256:pointer.uncompressedSha256,baselineSplitBasis:Object.fromEntries(account.book.holdings.map(holding=>{const bar=bundle.records.find(r=>r.symbol===holding.symbol&&r.basis==='split_adjusted')?.rows.find(r=>r.session===prepared.input.baseline.session);if(!bar||!Number.isFinite(Number(bar.close))||Number(bar.close)<=0)throw Error('forecast_baseline_split_basis_missing');return [holding.symbol,{session:bar.session,close:Number(bar.close)}];}))};
 return {ready:true,lease,input:prepared.input,codeManifest};
 }catch(e){return {ready:false,response:await forecastFailureResponse(e,lease,account.id,String(readiness.session),db)};}
}
export async function runM40Forecast(db:ArchiveQueryable=getPool(),seed='t156-forecast-v1'){
 const started=Date.now(),prepared=await prepareForecastRuntime(db,seed);
 if(!prepared.ready)return prepared.response;
 const {lease,input,codeManifest}=prepared;
 try{
 const result=await runForecastEngine(input,{seed,pathCount:2000,blockLength:10,budgetMs:120000});
 if(result.status!=='completed'){await failForecastJob(lease,'forecast_engine_failed',db);return {status:'failed',issues:result.issues,elapsedMs:Date.now()-started};}
 if(new Date().toISOString()>=paperPublicationDeadline(input.calendar,input.baseline.session))throw Error('forecast_publication_deadline_elapsed');
 const runId=await publishForecast(lease,input,{...result,codeManifest} as typeof result,db);
 return {status:'completed',runId,paths:result.pathCount,elapsedMs:Date.now()-started,executionScope:'forecast_only'};
 }catch(e){return forecastFailureResponse(e,lease,input.baseline.accountId,input.baseline.session,db);}
}

/** Active-account matured evaluations append even when evidence is insufficient. Paused accounts never append. */
export async function evaluateM40Forecasts(db:ArchiveQueryable=getPool()){
 await requirePaperDryRun(db);
 const { appendForecastEvaluation }=await import('./forecast-store');
 const { evaluateForecast }=await import('./forecast-evaluation');
 const account=await loadPaperAccount(db);if(!account||account.status!=='active')return {evaluated:0};
 const [clock]=await db.query<Row[]>("SELECT DATE_FORMAT(UTC_TIMESTAMP(6),'%Y-%m-%dT%H:%i:%s.%fZ') nowAt");
 const calendar=await loadForwardCalendar(db),now=String(clock[0].nowAt),asOf=calendar.filter(s=>s.closeAt<=now).at(-1)?.session;
 if(!asOf)return {evaluated:0};
 const [rows]=await db.query<Row[]>(`SELECT r.id,r.result_sha256,r.result_json,h.horizon FROM t156_forecast_run r JOIN t156_forecast_horizon h ON h.run_id=r.id WHERE r.account_id=? AND h.target_session<=? AND NOT EXISTS(SELECT 1 FROM t156_forecast_evaluation checked WHERE checked.run_id=r.id AND checked.horizon=h.horizon AND checked.status<>'pending' AND checked.created_at>=GREATEST(COALESCE((SELECT MAX(created_at) FROM t156_paper_cycle WHERE account_id=r.account_id AND session_date<=h.target_session),'1000-01-01'),COALESCE((SELECT MAX(created_at) FROM t156_forecast_continuation WHERE account_id=r.account_id AND JSON_UNQUOTE(JSON_EXTRACT(receipt_json,'$.session'))<=h.target_session),'1000-01-01'))) ORDER BY r.issued_at,r.id,h.horizon LIMIT 100`,[account.id,asOf]);
 let evaluated=0;
 for(const row of rows){const result=parse<import('./forecast-types').ForecastEngineResult>(row.result_json),h=result.horizons.find(h=>h.horizon===row.horizon);if(!h)throw Error('forecast_horizon_missing');if(forecastHash(result)!==row.result_sha256)throw Error('forecast_result_hash_mismatch');
 const { inspectContinuationChain,fixedForecastPolicy }=await import('./forecast-continuation');
 const [stored]=await db.query<Row[]>('SELECT input_json,source_proof_json FROM t156_forecast_run WHERE id=?',[row.id]);
 const original=parse<import('./forecast-types').PreparedForecastInput>(stored[0]?.input_json);
 const proof=parse<import('./forecast-store').ForecastSourceProof>(stored[0]?.source_proof_json);
 const guard={accountId:account.id,accountRevision:account.revision,baselineRevision:result.baseline.accountRevision,issuedAt:result.issuedAt,targetSession:h.targetSession};
 const witness=await forecastEvaluationWitness(db,guard),anchorRows=witness.anchors;
 const chain=inspectContinuationChain({accountId:account.id,revision:result.baseline.accountRevision,sourceBookSha256:result.baseline.sourceAccountStateSha256,policy:original.policy,baselineSession:result.baseline.session,baselineSourceRegimeSha256:result.baseline.sourceRegimeSha256,baselineSplitBasis:proof.baselineSplitBasis,expectedSessions:calendar.filter(s=>s.session>result.baseline.session&&s.session<=h.targetSession).map(s=>s.session),targetSession:h.targetSession,anchors:anchorRows.map(r=>({receipt:parse<import('./forecast-continuation').ContinuationReceipt>(r.receipt_json),sha256:String(r.receipt_sha256)})),canonical:witness.canonical});
 const endpoint=chain.endpoint,comparisonPolicy=endpoint?.policyAfter??account.policy;
 const policyMatches=forecastHash(fixedForecastPolicy(comparisonPolicy))===forecastHash(fixedForecastPolicy(original.policy));
 const actual={sourceRegimeSha256:endpoint?.sourceRegimeSha256,asOfSession:asOf,accountId:account.id,policySha256:policyMatches?result.policySha256:'changed',epochSession:comparisonPolicy.epochSession,baselineSha256:result.baseline.bookSha256,cashflowReconciled:true,shareBasisReconciled:true,feesReconciled:true,canonicalCoverage:true,endpointSession:endpoint?.session??null,equityUsd:endpoint?.equityUsd??null};
 const evaluation=chain.status!=='valid'?{status:chain.status,issues:chain.issues,actualPnlUsd:null,actualReturnPct:null}:evaluateForecast(result,h,actual);
 await appendForecastEvaluation(String(row.id),h.horizon,String(row.result_sha256),{...evaluation,evidenceSha256:witness.evidenceSha256},db,{...guard,evidenceSha256:witness.evidenceSha256});evaluated++;
 }
 return {evaluated};
}

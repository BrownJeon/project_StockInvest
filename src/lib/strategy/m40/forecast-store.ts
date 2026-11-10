/** Forecast tables are independent of paper and live execution state. */
import { createHash, randomUUID } from 'node:crypto';
import { getPool } from '@/lib/db';
import { canonicalJson, utcSql } from '@/lib/analysis-data/store';
import type { ArchiveQueryable, JsonValue } from '@/lib/analysis-data/types';
import type { PreparedForecastInput, ForecastEngineResult, ForecastHorizon } from './forecast-types';
import { requirePaperDryRun, loadPendingPaperIntents } from './forward-store';
import { assertPublicationWindow } from './publication-window';
import { prepareForecastInput } from './forecast-input';
import { readBlob } from '@/lib/analysis-data/store';
import { gunzipSync } from 'node:zlib';
import type { ForwardSourceBundle } from './forward-sources';
export const forecastJson=(v:unknown)=>canonicalJson(JSON.parse(JSON.stringify(v)) as JsonValue);
export const forecastHash=(v:unknown)=>createHash('sha256').update(forecastJson(v)).digest('hex');
type Row=Record<string,unknown>;
export interface ForecastSourceProof {pointerSha256:string;blobSha256:string;uncompressedSha256:string;baselineSplitBasis:Record<string,{session:string;close:number}>}
export interface ForecastLease {id:string;token:string;issuedAt:string;sourceProof?:ForecastSourceProof}
export async function acquireForecastJob(id:string,accountId:string,db:ArchiveQueryable=getPool()):Promise<ForecastLease|null>{
 await requirePaperDryRun(db);if(!db.getConnection)throw Error('forecast_transaction_required');
 const c=await db.getConnection();try{await c.beginTransaction();
 await c.query(`INSERT IGNORE INTO t156_forecast_job(id,account_id,status,created_at,updated_at) VALUES(?,?,'queued',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))`,[id,accountId]);
 const [rows]=await c.query<Row[]>(`SELECT status,lease_until>UTC_TIMESTAMP(6) busy,DATE_FORMAT(UTC_TIMESTAMP(6),'%Y-%m-%dT%H:%i:%s.%fZ') issuedAt FROM t156_forecast_job WHERE id=? AND account_id=? FOR UPDATE`,[id,accountId]);
 if(!rows.length||rows[0].status==='completed'||Number(rows[0].busy)===1){await c.rollback();return null;}
 const token=forecastHash(randomUUID());await c.query(`UPDATE t156_forecast_job SET status='running',lease_token=?,lease_until=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 5 MINUTE),completed_paths=0,issue_code=NULL,updated_at=UTC_TIMESTAMP(6) WHERE id=?`,[token,id]);
 await c.commit();return {id,token,issuedAt:String(rows[0].issuedAt)};
 }catch(e){await c.rollback();throw e;}finally{c.release?.();}
}
export async function failForecastJob(lease:ForecastLease,issue:string,db:ArchiveQueryable=getPool()){
 await db.query(`UPDATE t156_forecast_job SET status='failed',issue_code=?,lease_token=NULL,lease_until=NULL,updated_at=UTC_TIMESTAMP(6) WHERE id=? AND lease_token=?`,[/^[a-z0-9_]{1,120}$/.test(issue)?issue:'forecast_failed',lease.id,lease.token]);
}
export const FORECAST_PRNG_ASSUMPTION='prng_mulberry32_sha256_seed_nul_path_index_first_u32_le';
const close=(a:number,b:number)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-9*Math.max(1,Math.abs(a),Math.abs(b));
/** A malformed engine result cannot acquire a transaction or publish partial statistics. */
export function assertForecastResult(lease:ForecastLease,input:PreparedForecastInput,result:ForecastEngineResult){
 const invalid=()=>{throw Error('forecast_result_incomplete');};
 if(result.status!=='completed'||!Array.isArray(result.issues)||result.issues.length||result.pathCount!==2000||result.blockLength!==10||!Array.isArray(result.horizons)||result.horizons.length!==4||new Set(result.horizons.map(h=>h.horizon)).size!==4||!result.seed||result.modelVersion!==input.modelVersion||result.calibration!=='uncalibrated_research_scenario'||result.quantileConvention!=='linear_type7')invalid();
 for(const key of ['inputSha256','policySha256','sourceSha256','sourceDatasetId','sourceAvailableAt','issuedAt'] as const)if(result[key]!==input[key])invalid();
 if(result.issuedAt!==lease.issuedAt||forecastJson(result.baseline)!==forecastJson(input.baseline)||forecastJson(result.assumptions)!==forecastJson([...input.assumptions,FORECAST_PRNG_ASSUMPTION]))invalid();
 const {residuals:_,...bridge}=input.bridge;if(forecastJson(result.bridge)!==forecastJson(bridge))invalid();
 const n=input.returnSessions.length,L=10,sample=result.sampleCounts;
 if(sample.historicalReturns!==n||sample.historicalStart!==input.returnSessions[0]||sample.historicalEnd!==input.returnSessions.at(-1)||sample.blockLength!==L||sample.possibleBlockStarts!==n-L+1||sample.nonoverlappingBlocks!==Math.floor(n/L))invalid();
 for(const h of result.horizons){const target=input.targets.find(t=>t.horizon===h.horizon);if(!target||forecastJson({horizon:h.horizon,calendarTarget:h.calendarTarget,targetSession:h.targetSession,sessions:h.sessions})!==forecastJson(target))invalid();
  if(h.pathCount!==2000||!Number.isInteger(h.lossCount)||h.lossCount<0||h.lossCount>2000||h.lossProbability!==h.lossCount/2000||h.monteCarloSe<0||h.monteCarloSe>1||!close(h.monteCarloSe,Math.sqrt(h.lossProbability*(1-h.lossProbability)/2000))||h.historicalNonoverlappingWindows!==Math.floor(n/h.sessions))invalid();
  for(const distribution of [h.netUsd,h.netPct])if(!['mean','p10','p50','p90'].every(k=>Number.isFinite(distribution[k as keyof typeof distribution]))||distribution.p10>distribution.p50||distribution.p50>distribution.p90)invalid();
  for(const k of ['mean','p10','p50','p90'] as const)if(!close(h.netUsd[k]/input.baseline.equityUsd*100,h.netPct[k]))invalid();
 }
}
export async function publishForecast(lease:ForecastLease,input:PreparedForecastInput,result:ForecastEngineResult,db:ArchiveQueryable=getPool()){
 assertForecastResult(lease,input,result);
 if(!db.getConnection)throw Error('forecast_transaction_required');const c=await db.getConnection();
 try{await c.beginTransaction();await requirePaperDryRun(c);
 const [jobs]=await c.query<Row[]>('SELECT status,lease_token,lease_until>UTC_TIMESTAMP(6) valid FROM t156_forecast_job WHERE id=? FOR UPDATE',[lease.id]);
 if(jobs[0]?.status!=='running'||jobs[0]?.lease_token!==lease.token||Number(jobs[0]?.valid)!==1)throw Error('forecast_lease_expired');
 const [accounts]=await c.query<Row[]>('SELECT revision,status,policy_json,state_json FROM t156_paper_account WHERE id=? FOR UPDATE',[input.baseline.accountId]);
 const account=accounts[0];if(!account||account.status!=='active'||Number(account.revision)!==input.baseline.accountRevision||forecastJson(typeof account.policy_json==='string'?JSON.parse(account.policy_json):account.policy_json)!==forecastJson(input.policy)||forecastHash(typeof account.state_json==='string'?JSON.parse(account.state_json):account.state_json)!==input.baseline.sourceAccountStateSha256)throw Error('forecast_account_changed_during_run');
 // Current locking read under the account lock serializes every new-code job ID,
 // including retries whose original legacy input-hash ID differs.
 const [published]=await c.query<Row[]>(`SELECT id FROM t156_forecast_run WHERE account_id=?
  AND JSON_UNQUOTE(JSON_EXTRACT(input_json,'$.baseline.session'))=? LIMIT 1 FOR UPDATE`,[input.baseline.accountId,input.baseline.session]);
 if(published.length)throw Error('forecast_session_already_published');
 const proof=lease.sourceProof;if(!proof)throw Error('forecast_source_proof_missing');
 const [sources]=await c.query<Row[]>(`SELECT r.payload_json,DATE_FORMAT(r.available_at,'%Y-%m-%dT%H:%i:%s.%fZ') availableAt FROM t156_record r JOIN t156_dataset d ON d.id=r.dataset_id WHERE r.dataset_id=? AND r.record_type='m40_paper_source_bundle' AND r.record_key='snapshot' AND d.status='published' AND d.live_eligible=0 AND d.content_sha256=? AND r.available_at<=? LOCK IN SHARE MODE`,[input.sourceDatasetId,proof.uncompressedSha256,utcSql(lease.issuedAt)]);
 if(sources.length!==1||forecastHash(typeof sources[0].payload_json==='string'?JSON.parse(sources[0].payload_json):sources[0].payload_json)!==proof.pointerSha256||new Date(String(sources[0].availableAt)).getTime()!==Date.parse(input.sourceAvailableAt))throw Error('forecast_source_changed_during_run');
 const sourceBytes=gunzipSync(await readBlob(proof.blobSha256,c),{maxOutputLength:24*1024*1024});
 if(createHash('sha256').update(sourceBytes).digest('hex')!==proof.uncompressedSha256)throw Error('forecast_source_hash_mismatch');
 const sourceBundle=JSON.parse(sourceBytes.toString()) as ForwardSourceBundle;
 const baselineBasis=Object.fromEntries(input.book.holdings.map(h=>{const b=sourceBundle.records.find(r=>r.symbol===h.symbol&&r.basis==='split_adjusted')?.rows.find(b=>b.session===input.baseline.session);if(!b)throw Error('forecast_baseline_split_basis_missing');return [h.symbol,{session:b.session,close:Number(b.close)}];}));
 if(forecastJson(baselineBasis)!==forecastJson(proof.baselineSplitBasis))throw Error('forecast_baseline_split_basis_changed');
 const rechecked=prepareForecastInput({accountId:input.baseline.accountId,accountRevision:input.baseline.accountRevision,book:typeof account.state_json==='string'?JSON.parse(account.state_json):account.state_json,pendingIntents:await loadPendingPaperIntents(c),policy:input.policy,bundle:sourceBundle,calendar:input.calendar,issuedAt:input.issuedAt,sourceDatasetId:input.sourceDatasetId,sourceAvailableAt:input.sourceAvailableAt});
 if(rechecked.status!=='qualified'||rechecked.input.inputSha256!==input.inputSha256)throw Error('forecast_input_changed_during_run');
 await assertPublicationWindow(input.calendar,input.baseline.session,c,'forecast');
 const id=forecastHash([lease.id,input.inputSha256,result.seed]),hash=forecastHash(result);
 await c.query('INSERT INTO t156_forecast_run(id,job_id,account_id,issued_at,input_sha256,result_sha256,input_json,result_json,source_proof_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(6))',[id,lease.id,input.baseline.accountId,utcSql(lease.issuedAt),input.inputSha256,hash,forecastJson(input),forecastJson(result),forecastJson(proof)]);
 for(const h of result.horizons){await c.query('INSERT INTO t156_forecast_horizon(run_id,horizon,target_session,result_json) VALUES(?,?,?,?)',[id,h.horizon,h.targetSession,forecastJson(h)]);
 await c.query(`INSERT INTO t156_forecast_evaluation(id,run_id,horizon,forecast_sha256,status,result_json,created_at) VALUES(?,?,?,?,'pending',?,UTC_TIMESTAMP(6))`,[forecastHash([id,h.horizon,'pending']),id,h.horizon,hash,forecastJson({issues:['target_not_matured'],actualPnlUsd:null,actualReturnPct:null})]);}
 await c.query("UPDATE t156_forecast_job SET status='completed',completed_paths=2000,lease_token=NULL,lease_until=NULL,updated_at=UTC_TIMESTAMP(6) WHERE id=? AND lease_token=?",[lease.id,lease.token]);
 await assertPublicationWindow(input.calendar,input.baseline.session,c,'forecast');
 await c.commit();return id;
 }catch(e){await c.rollback();throw e;}finally{c.release?.();}
}
export interface ForecastEvaluation {status:'pending'|'unconfirmed'|'incomparable'|'completed';issues:string[];evidenceSha256?:string;actualPnlUsd:number|null;actualReturnPct:number|null;errorPct?:number;intervalHit?:boolean;brier?:number}
export interface ForecastEvaluationGuard {accountId:string;accountRevision:number;baselineRevision:number;issuedAt:string;targetSession:string;evidenceSha256:string}
export async function forecastEvaluationWitness(db:ArchiveQueryable,guard:Omit<ForecastEvaluationGuard,'evidenceSha256'>,lock=false){
 const [anchors]=await db.query<Row[]>(`SELECT receipt_sha256,receipt_json FROM t156_forecast_continuation WHERE account_id=? AND revision_after>? AND JSON_UNQUOTE(JSON_EXTRACT(receipt_json,'$.session'))<=? ORDER BY revision_after${lock?' LOCK IN SHARE MODE':''}`,[guard.accountId,guard.baselineRevision,guard.targetSession]);
 const [cycles]=await db.query<Row[]>(`SELECT id,DATE_FORMAT(session_date,'%Y-%m-%d') session,mode,JSON_EXTRACT(payload_json,'$.equityUsd') equityUsd FROM t156_paper_cycle WHERE account_id=? AND created_at>? AND session_date<=? ORDER BY created_at,id${lock?' LOCK IN SHARE MODE':''}`,[guard.accountId,utcSql(guard.issuedAt),guard.targetSession]);
 const canonical=cycles.map(r=>({id:String(r.id),session:String(r.session),mode:String(r.mode),equityUsd:r.equityUsd==null?null:Number(r.equityUsd)}));
 return {anchors,canonical,evidenceSha256:forecastHash({anchors:anchors.map(r=>r.receipt_sha256),canonical})};
}
/** Append after rechecking the captured evidence under short account/range locks. */
export async function appendForecastEvaluation(runId:string,horizon:ForecastHorizon,forecastSha256:string,evaluation:ForecastEvaluation,db:ArchiveQueryable=getPool(),guard?:ForecastEvaluationGuard){
 if(evaluation.status==='completed'&&(!Number.isFinite(evaluation.actualPnlUsd)||!Number.isFinite(evaluation.actualReturnPct)||!Number.isFinite(evaluation.errorPct)||typeof evaluation.intervalHit!=='boolean'||!Number.isFinite(evaluation.brier)))throw Error('forecast_completed_evidence_invalid');
 if(evaluation.status!=='completed'&&(evaluation.actualPnlUsd!==null||evaluation.actualReturnPct!==null))throw Error('forecast_unconfirmed_actual_forbidden');
 if(evaluation.status==='completed'&&!guard)throw Error('forecast_evaluation_guard_required');
 const id=forecastHash([runId,horizon,forecastSha256,evaluation]);
 const insert=async(q:ArchiveQueryable)=>q.query(`INSERT IGNORE INTO t156_forecast_evaluation(id,run_id,horizon,forecast_sha256,status,result_json,created_at) SELECT ?,r.id,h.horizon,r.result_sha256,?,?,UTC_TIMESTAMP(6) FROM t156_forecast_run r JOIN t156_forecast_horizon h ON h.run_id=r.id WHERE r.id=? AND h.horizon=? AND r.result_sha256=?`,[id,evaluation.status,forecastJson(evaluation),runId,horizon,forecastSha256]);
 if(!guard){await insert(db);return id;}
 if(!db.getConnection)throw Error('forecast_transaction_required');const c=await db.getConnection();
 try{await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await c.beginTransaction();await requirePaperDryRun(c);
 const [account]=await c.query<Row[]>('SELECT revision FROM t156_paper_account WHERE id=? LOCK IN SHARE MODE',[guard.accountId]);
 if(Number(account[0]?.revision)!==guard.accountRevision)throw Error('forecast_evaluation_evidence_changed');
 const witness=await forecastEvaluationWitness(c,guard,true);
 if(witness.evidenceSha256!==guard.evidenceSha256||evaluation.evidenceSha256!==guard.evidenceSha256)throw Error('forecast_evaluation_evidence_changed');
 await insert(c);await c.commit();return id;
 }catch(e){await c.rollback();throw e;}finally{c.release?.();}
}

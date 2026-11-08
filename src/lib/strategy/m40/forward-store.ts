/** Private, independent paper book. No writes to live positions, orders or strategy status. */
import { randomUUID, createHash } from 'node:crypto';
import { getPool } from '@/lib/db';
import { canonicalJson, utcSql } from '@/lib/analysis-data/store';
import type { ArchiveQueryable, ArchiveTransactionConnection, JsonValue } from '@/lib/analysis-data/types';
import type { ForwardPolicy } from './forward-types';
import { cloneSnapshot, PAPER_ACCOUNT_ID, type PaperBook, type PaperIntent, type PaperOutcome } from './paper-ledger';

export const FORWARD_POLICY_ID='t156-m40-forward-pilot-v1';
const json=(v:unknown)=>canonicalJson(JSON.parse(JSON.stringify(v)) as JsonValue);
const parse=<T>(v:unknown):T=>typeof v==='string'?JSON.parse(v):v as T;
export interface PaperAccountRecord {
 id:string; policy:ForwardPolicy; book:PaperBook; cloneSha256:string; clonedAt:string; revision:number;
  status:'active'|'paused';
}
type Row=Record<string,unknown>;
function unpack(row:Row):PaperAccountRecord {
 const clone=parse<{cloneSha256:string;source:{registeredAt:string}}>(row.clone_json);
 if(createHash('sha256').update(json(clone.source)).digest('hex')!==clone.cloneSha256)throw Error('paper_clone_hash_mismatch');
 if(row.status!=='active'&&row.status!=='paused')throw Error('paper_account_status_invalid');
 return {id:String(row.id),policy:parse<ForwardPolicy>(row.policy_json),book:parse<PaperBook>(row.state_json),
  cloneSha256:clone.cloneSha256,clonedAt:clone.source.registeredAt,revision:Number(row.revision),status:row.status};
}
export async function requirePaperDryRun(db:ArchiveQueryable=getPool()):Promise<void>{
 const [rows]=await db.query<Row[]>("SELECT value FROM system_config WHERE `key`='safety_dry_run'");
 let dry:unknown;try{dry=JSON.parse(String(rows[0]?.value));}catch{dry=null;}
 if(dry!==true)throw Error('m40_forward_requires_dry_run');
}
async function connection(db:ArchiveQueryable) {
 if(!db.getConnection)throw Error('paper_transaction_required');
 const c=await db.getConnection();
 if(!c.release||!c.destroy){c.release?.();throw Error('paper_transaction_required');}
 return c as ArchiveTransactionConnection&{release():void;destroy():void};
}
export async function loadPaperAccount(db:ArchiveQueryable=getPool()):Promise<PaperAccountRecord|null>{
 const [rows]=await db.query<Row[]>('SELECT id,policy_json,clone_json,state_json,revision,status FROM t156_paper_account WHERE id=?',[PAPER_ACCOUNT_ID]);
 return rows.length?unpack(rows[0]):null;
}
/** Explicit initialization is idempotent. Restart never copies later real account changes. */
export async function initializePaperAccount(policy:ForwardPolicy,db:ArchiveQueryable=getPool()) {
 await requirePaperDryRun(db);
 const existing=await loadPaperAccount(db);
 if(existing){if(existing.policy.policyId!==policy.policyId)throw Error('paper_policy_conflict');return existing;}
 if(policy.policyId!==FORWARD_POLICY_ID||policy.epochSession!==null||policy.frozenCohort!==null)throw Error('paper_initial_policy_invalid');
 const [snapshots]=await db.query<Row[]>(
  "SELECT id,DATE_FORMAT(ts,'%Y-%m-%dT%H:%i:%s+09:00') AS source_at,positions FROM portfolio_snapshots ORDER BY ts DESC LIMIT 1");
 if(!snapshots.length)throw Error('paper_clone_snapshot_missing');
 const source=snapshots[0];const clone=cloneSnapshot({id:Number(source.id),at:new Date(String(source.source_at)).toISOString(),positions:source.positions},policy.registeredAt);
 await db.query(`INSERT INTO t156_paper_account (id,status,policy_json,clone_json,state_json,created_at,updated_at)
  VALUES(?,'active',?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id`,
  [PAPER_ACCOUNT_ID,json(policy),json(clone),json(clone.book),utcSql(policy.registeredAt),utcSql(policy.registeredAt)]);
 const saved=await loadPaperAccount(db);if(!saved||saved.policy.policyId!==policy.policyId)throw Error('paper_initial_readback_failed');
 return saved;
}
export interface PaperLease { account:PaperAccountRecord; token:string }
/** Cross-process lease survives an HTTP reply/restart. No network is performed while a lock is held. */
export async function acquirePaperLease(db:ArchiveQueryable=getPool()):Promise<PaperLease|null>{
 await requirePaperDryRun(db);const c=await connection(db);let active=false,destroyed=false;
 try{await c.beginTransaction();active=true;
  const [rows]=await c.query<Row[]>(`SELECT *,lease_until>UTC_TIMESTAMP(6) AS busy FROM t156_paper_account WHERE id=? FOR UPDATE`,[PAPER_ACCOUNT_ID]);
  if(!rows.length)throw Error('paper_account_not_initialized');
  if(rows[0].status!=='active')throw Error('paper_account_paused');
  if(Number(rows[0].busy)===1){await c.rollback();active=false;return null;}
  const account=unpack(rows[0]);
  const token=createHash('sha256').update(randomUUID()).digest('hex');
  await c.query('UPDATE t156_paper_account SET lease_token=?,lease_until=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 12 MINUTE) WHERE id=?',[token,PAPER_ACCOUNT_ID]);
  await c.commit();active=false;return {account,token};
 }catch(e){if(active)try{await c.rollback();}catch{c.destroy();destroyed=true;}throw e;}finally{if(!destroyed)c.release();}
}
export async function releasePaperLease(token:string,db:ArchiveQueryable=getPool()) {
 await db.query('UPDATE t156_paper_account SET lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?',[PAPER_ACCOUNT_ID,token]);
}
export async function loadPendingPaperIntents(db:ArchiveQueryable=getPool()):Promise<PaperIntent[]> {
 const [rows]=await db.query<Row[]>("SELECT intent_json,DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%fZ') recorded_at FROM t156_paper_signal WHERE account_id=? AND status='awaiting_open' ORDER BY session_date,id",[PAPER_ACCOUNT_ID]);
 return rows.map(r=>({...parse<PaperIntent>(r.intent_json),createdAt:String(r.recorded_at)}));
}
export interface PaperCommit {
 lease:PaperLease; policy:ForwardPolicy; book:PaperBook;
 cycle:{id:string;session:string;decisionAt:string;mode:'rehearsal'|'forward'|'blocked';payload:unknown};
 signals:PaperIntent[]; outcomes:PaperOutcome[];
}
/** Policy, paper positions, signals and modeled fills commit as one revision. */
export async function commitPaperCycle(input:PaperCommit,db:ArchiveQueryable=getPool()):Promise<boolean>{
 const c=await connection(db);let active=false,destroyed=false;
 try{await c.beginTransaction();active=true;
  const [rows]=await c.query<Row[]>('SELECT *,lease_until>UTC_TIMESTAMP(6) AS lease_valid FROM t156_paper_account WHERE id=? FOR UPDATE',[PAPER_ACCOUNT_ID]);
  const row=rows[0];
  if(!row||row.status!=='active'||row.lease_token!==input.lease.token||Number(row.lease_valid)!==1||Number(row.revision)!==input.lease.account.revision)throw Error('paper_lease_or_revision_conflict');
  const [safety]=await c.query<Row[]>("SELECT value FROM system_config WHERE `key`='safety_dry_run' LOCK IN SHARE MODE");
  if(parse<unknown>(safety[0]?.value)!==true)throw Error('m40_forward_requires_dry_run');
  const previous=parse<ForwardPolicy>(row.policy_json);
  if(json({...previous,epochSession:null,epochLockedAt:null,frozenCohort:null})!==json({...input.policy,epochSession:null,epochLockedAt:null,frozenCohort:null})
    ||(previous.epochSession!==null&&(previous.epochSession!==input.policy.epochSession||previous.epochLockedAt!==input.policy.epochLockedAt))
    ||(previous.frozenCohort!==null&&json(previous.frozenCohort)!==json(input.policy.frozenCohort)))throw Error('paper_fixed_policy_changed');
  if(previous.epochSession===null&&input.policy.epochSession!==null
    &&(input.cycle.mode!=='forward'||input.policy.epochSession!==input.cycle.session
      ||input.policy.epochLockedAt!==input.cycle.decisionAt))throw Error('paper_epoch_not_first_eligible');
  const [duplicate]=await c.query<Row[]>('SELECT id FROM t156_paper_cycle WHERE account_id=? AND session_date=? AND mode=?',[PAPER_ACCOUNT_ID,input.cycle.session,input.cycle.mode]);
  if(duplicate.length){await c.rollback();active=false;return false;}
  await c.query('INSERT INTO t156_paper_cycle(id,account_id,session_date,decision_at,mode,payload_json,created_at) VALUES(?,?,?,?,?,?,UTC_TIMESTAMP(6))',
    [input.cycle.id,PAPER_ACCOUNT_ID,input.cycle.session,utcSql(input.cycle.decisionAt),input.cycle.mode,json(input.cycle.payload)]);
  for(const signal of input.signals){
   if(signal.executionScope!=='paper_only'||signal.accountId!==PAPER_ACCOUNT_ID||signal.cycleId!==input.cycle.id
     ||!signal.id.startsWith('m40p_'))throw Error('paper_signal_scope_invalid');
   await c.query(`INSERT INTO t156_paper_signal(id,account_id,cycle_id,session_date,symbol,side,execution_scope,status,intent_json,created_at)
    VALUES(?,?,?,?,?,?,'paper_only',?,?,UTC_TIMESTAMP(6))`,[signal.id,PAPER_ACCOUNT_ID,input.cycle.id,signal.session,signal.symbol,signal.side,signal.status,json(signal)]);
  }
  for(const outcome of input.outcomes){
   const [updated]=await c.query<{affectedRows:number}>(`UPDATE t156_paper_signal SET status=?,outcome_json=?
    WHERE id=? AND account_id=? AND execution_scope='paper_only' AND status='awaiting_open'`,[outcome.status,json(outcome),outcome.id,PAPER_ACCOUNT_ID]);
   if(updated.affectedRows!==1)throw Error('paper_fill_revision_conflict');
  }
  await c.query(`UPDATE t156_paper_account SET policy_json=?,state_json=?,revision=revision+1,
    lease_token=NULL,lease_until=NULL,updated_at=UTC_TIMESTAMP(6) WHERE id=?`,[json(input.policy),json(input.book),PAPER_ACCOUNT_ID]);
  await c.commit();active=false;
  // Forecast evidence is a failure-isolated sidecar; a missing receipt is an explicit comparison gap.
  let sidecarTimer:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([
   import('./forecast-continuation').then(({saveContinuation})=>saveContinuation(input,c)),
   new Promise<never>((_,reject)=>{sidecarTimer=setTimeout(()=>{destroyed=true;try{c.destroy();}finally{reject(Error('forecast_sidecar_timeout'));}},1500);})
  ]);}catch{/* A destroyed timed-out connection is never returned to the pool. Paper commit already succeeded. */}
  finally{if(sidecarTimer)clearTimeout(sidecarTimer);}
  return true;
 }catch(e){if(active)try{await c.rollback();}catch{c.destroy();destroyed=true;}throw e;}finally{if(!destroyed)c.release();}
}
/** No account amounts, copied holdings, input snapshots or source bodies leave this inventory. */
export async function paperForwardSummary(db:ArchiveQueryable=getPool()) {
 const account=await loadPaperAccount(db);if(!account)return {initialized:false};
 const [counts]=await db.query<Row[]>('SELECT mode,COUNT(*) n FROM t156_paper_cycle WHERE account_id=? GROUP BY mode',[PAPER_ACCOUNT_ID]);
 const [signals]=await db.query<Row[]>('SELECT status,COUNT(*) n FROM t156_paper_signal WHERE account_id=? GROUP BY status',[PAPER_ACCOUNT_ID]);
 const [completed]=await db.query<Row[]>(`SELECT COUNT(*) n FROM t156_paper_signal WHERE account_id=?
   AND side='sell' AND status='filled' AND JSON_EXTRACT(intent_json,'$.positionIds') REGEXP '"m40p_[0-9a-f]{64}"'`,[PAPER_ACCOUNT_ID]);
 const elapsedDays=Math.max(0,(Date.now()-Date.parse(account.policy.registeredAt))/86400_000);
 return {initialized:true,status:account.status,policyId:account.policy.policyId,registeredAt:account.policy.registeredAt,epochSession:account.policy.epochSession,
  cohortSize:account.policy.frozenCohort?.symbols.length??0,revision:account.revision,cycles:counts,signals,
  epochSelection:'first_observed_qualified_session; unobserved days are not assumed eligible',
  validationProgress:{elapsedDays,minimumDays:84,completedNewPositionRoundTrips:Number(completed[0]?.n??0),minimumRoundTrips:100,
   agentTradingChangedDays:0,agentTradingArm:'disabled; explanations cannot change base trades',
   minimumChangedDaysBeforeAgentTradingAdoption:20},
  qualification:'limited_cohort_evaluation_only',executionScope:'paper_only',profitabilityValidated:false};
}

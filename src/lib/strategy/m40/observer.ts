/** Daily archive/shadow companion. This module never replaces the protective engine. */
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { saveAnalysisRun,putJudgment,findJudgment,putSignalDraft,jsonSha256 } from '@/lib/analysis-data/store';
import type { JsonValue } from '@/lib/analysis-data/types';
import { loadM40Input } from './load-input';
import { runM40Analysis,askConfiguredM40Agent } from './runner';
import { loadM40Evidence } from './load-evidence';
import { captureOperatingData } from '@/lib/analysis-data/capture-operating-data';

type Observation={status:string;runId?:string;reason?:string;draftCount?:number};
let flight:Promise<Observation>|null=null;
export function observeM40Daily():Promise<Observation>{
 if(!flight) flight=runDailyObservation().finally(()=>{flight=null;});
 return flight;
}
async function runDailyObservation():Promise<Observation> {
 const cutoff=new Date().toISOString();
 try {
  const capture=await captureOperatingData({cutoff,limit:450});
  try {
   const input=await loadM40Input({decisionAt:cutoff});
   const {evidence,issues}=await loadM40Evidence(input.decisionTime);
   const result=await runM40Analysis({input,evidence,optionalDataIssues:issues,triggers:[...(evidence.length?['new_evidence' as const]:[]),...(!evidence.length||issues.length?['optional_data_gap' as const]:[])],
    timeoutMs:2000,modelEnabled:process.env.T156_M40_AGENT_ENABLED==='true',modelPolicyVersion:process.env.T156_M40_AGENT_POLICY_VERSION},
    {store:{saveAnalysisRun,putJudgment,findJudgment,putSignalDraft},askAgent:askConfiguredM40Agent});
   return {status:result.plan.status,runId:result.runId,draftCount:result.draftCount};
  } catch(error) {
   const code=error instanceof Error?error.message:'';
   const reason=['m40_policy_not_configured','m40_input_not_published','m40_input_stale','m40_input_invalid'].includes(code)?code:'m40_input_or_archive_unavailable';
   const [sessions]=await getPool().query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(s.trade_date,'%Y-%m-%d') AS session FROM t156_research_backfill_session s
     JOIN t156_dataset d ON d.id='t156-research-db-20261108' AND d.status='published'
     WHERE s.closes_at_utc<=? ORDER BY s.trade_date DESC LIMIT 1`,[cutoff.slice(0,23).replace('T',' ')]);
   if(!sessions.length) return {status:'blocked',reason};
   const session=String(sessions[0].session);
   const record={session,cutoff,reason,captureStatus:capture.status,mode:'shadow',source:'daily_operating_observer'} as JsonValue;
   const digest=jsonSha256(record),runId='m40-blocked-'+digest;
   await saveAnalysisRun({runId,idempotencyKey:runId,sessionDate:session,decisionAt:cutoff,policyVersion:'t156-m40-v1',inputSha256:digest,input:record,plan:{status:'blocked',reason,executionMode:'shadow'},status:'blocked'});
   return {status:'blocked',reason,runId};
  }
 } catch {return {status:'archive_unavailable',reason:'m40_archive_unavailable'};}
}

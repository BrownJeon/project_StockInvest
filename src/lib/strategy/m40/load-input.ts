import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import type { ArchiveQueryable } from '@/lib/analysis-data/types';
import type { M40Input } from './types';
import { planM40 } from './core';

type InputCode='m40_input_not_published'|'m40_input_stale'|'m40_input_invalid'|'m40_policy_not_configured';
export class M40InputError extends Error { constructor(public readonly code:InputCode){super(code);} }
export interface CanonicalM40Session {session:string;closeAt:string}
/** A live snapshot must prove its calendar, fixed policy epoch and final-bar timing. */
export function validateM40Snapshot(input:M40Input, calendar:CanonicalM40Session[], epoch:string, cutoff:string, recordSession:string, requestedSession?:string):void {
 const bad=()=>{throw new M40InputError('m40_input_invalid');};
 if(!input || input.asOfSession!==recordSession || (requestedSession&&input.asOfSession!==requestedSession)
   || input.rebalanceEpochSession!==epoch || !Number.isFinite(Date.parse(input.decisionTime))
   || Date.parse(input.decisionTime)>Date.parse(cutoff)) bad();
 if(!requestedSession&&Date.parse(cutoff)-Date.parse(input.decisionTime)>96*3600_000) throw new M40InputError('m40_input_stale');
 const canonical=new Map(calendar.map(s=>[s.session,s.closeAt]));
 if(!canonical.has(epoch)||!canonical.has(input.asOfSession)||!Array.isArray(input.sessions)||!input.sessions.length) bad();
 const expected=calendar.filter(s=>s.session>=input.sessions[0]&&s.session<=input.sessions[input.sessions.length-1]).map(s=>s.session);
 if(JSON.stringify(expected)!==JSON.stringify(input.sessions)) bad();
 const beforeFinal=(session:string,at:string)=>!canonical.has(session)||!Number.isFinite(Date.parse(at))||Date.parse(at)<Date.parse(canonical.get(session)!);
 if(Date.parse(input.decisionTime)<Date.parse(canonical.get(input.asOfSession)!)) bad();
 if(!Array.isArray(input.members)||!Array.isArray(input.marketBars)) bad();
 for(const bar of input.marketBars) if(beforeFinal(bar.session,bar.availableAt)) bad();
 for(const member of input.members){
  if(!Array.isArray(member.bars)) bad();
  for(const bar of member.bars) if(beforeFinal(bar.session,bar.availableAt)) bad();
  if(member.quote&&beforeFinal(member.quote.session,member.quote.availableAt)) bad();
 }
 try {if(planM40(input).status==='invalid_input') bad();}catch{bad();}
}
/** Proof-carrying snapshots only: a research archive is never an implicit live feed. */
export async function loadM40Input(options:{session?:string;decisionAt?:string}={},db:ArchiveQueryable=getPool()):Promise<M40Input>{
 const decisionAt=options.decisionAt??new Date().toISOString();
 if(!/(?:Z|[+-]\d{2}:\d{2})$/.test(decisionAt)||!Number.isFinite(Date.parse(decisionAt))||(options.session&&!/^\d{4}-\d{2}-\d{2}$/.test(options.session))) throw new M40InputError('m40_input_invalid');
 const epoch=process.env.T156_M40_EPOCH_SESSION;
 if(!epoch||!/^\d{4}-\d{2}-\d{2}$/.test(epoch)) throw new M40InputError('m40_policy_not_configured');
 const [rows]=await db.query<RowDataPacket[]>(
  `SELECT r.payload_json,DATE_FORMAT(r.session_date,'%Y-%m-%d') AS record_session,
    DATE_FORMAT(r.available_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS available_at
   FROM t156_record r JOIN t156_dataset d ON d.id=r.dataset_id
   WHERE d.status='published' AND d.live_eligible=1 AND r.record_type='m40_input'
    AND r.available_at IS NOT NULL AND r.available_at<=?
    ${options.session?'AND r.session_date=?':''}
   ORDER BY r.session_date DESC,r.available_at DESC,r.record_key LIMIT 1`,
  [new Date(decisionAt).toISOString().slice(0,23).replace('T',' '),...(options.session?[options.session]:[])]);
 if(!rows.length) throw new M40InputError('m40_input_not_published');
 const row=rows[0];
 if(!options.session&&Date.parse(decisionAt)-Date.parse(String(row.available_at))>96*3600_000) throw new M40InputError('m40_input_stale');
 let input:M40Input;try{input=typeof row.payload_json==='string'?JSON.parse(row.payload_json):row.payload_json;}catch{throw new M40InputError('m40_input_invalid');}
 const [calendar]=await db.query<RowDataPacket[]>(
  `SELECT DATE_FORMAT(s.trade_date,'%Y-%m-%d') AS session,DATE_FORMAT(s.closes_at_utc,'%Y-%m-%dT%H:%i:%sZ') AS closeAt
   FROM t156_research_backfill_session s JOIN t156_dataset d ON d.id='t156-research-db-20261108' AND d.status='published'
   ORDER BY s.trade_date`);
 validateM40Snapshot(input,calendar as CanonicalM40Session[],epoch,decisionAt,String(row.record_session),options.session);
 return input;
}

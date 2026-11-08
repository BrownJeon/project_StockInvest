import { gunzipSync } from 'node:zlib';
import { readBlob } from '@/lib/analysis-data/store';
import { getPool } from '@/lib/db';
import type { ArchiveQueryable } from '@/lib/analysis-data/types';
import { normalizeForwardUtc, validForwardSessionDate } from './forward-calendar';
import { PAPER_ACCOUNT_ID } from './paper-ledger';
import type { PaperView, PaperViewCycle, PaperViewSignal } from './paper-view-types';
type Row=Record<string,unknown>;
const object=(v:unknown):Row=>{const p=typeof v==='string'?JSON.parse(v):v;return p&&typeof p==='object'&&!Array.isArray(p)?p as Row:{};};
const array=(v:unknown):Row[]=>Array.isArray(v)?v.filter(x=>x&&typeof x==='object'&&!Array.isArray(x)) as Row[]:[];
const code=(v:unknown)=>typeof v==='string'&&/^[a-zA-Z0-9_.:-]{1,160}$/.test(v)?v:'unknown';
const symbol=(v:unknown)=>typeof v==='string'&&/^(NAS|NYS|AMS):[A-Z][A-Z0-9.]{0,25}$/.test(v)?v:null;
const finite=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null;
const amount=(v:unknown)=>{const n=finite(v);return n!==null&&n>=0?n:null;};
const codes=(v:unknown)=>Array.isArray(v)?v.slice(0,150).map(code):[];
const scalarAmount=(v:unknown)=>typeof v==='number'?amount(v):typeof v==='string'&&/^\d+(?:\.\d+)?$/.test(v)?amount(Number(v)):null;
const safeReason=(v:unknown)=>code(v)==='unknown'?null:code(v);
const day=(v:unknown)=>validForwardSessionDate(v)?v:null;
const time=normalizeForwardUtc;
export class PaperViewError extends Error {constructor(public status:403|503, message:string){super(message);}}
export function paperViewLimits(raw:string|null):number {const n=raw===null?20:Number(raw);if(!Number.isInteger(n)||n<1||n>100)throw Error('signal_limit_must_be_1_to_100');return n;}
/** Metrics use only forward observations, never clone/rehearsal peaks or stored cumulative returns. */
export function paperPerformance(rows:Row[], truncated:boolean):PaperView['performance'] {
 const points=rows.filter(r=>r.mode==='forward').map(r=>({session:String(r.session),equityUsd:amount(object(r.payload_json).equityUsd)}));
 const missing=points.some(p=>p.equityUsd===null||p.equityUsd<=0);
 const valid=points.filter((p):p is {session:string;equityUsd:number}=>p.equityUsd!==null&&p.equityUsd>0);
 let returnPct:number|null=null,maxDrawdownPct:number|null=null,cagrPct:number|null=null;
 if(valid.length>=2&&!missing&&!truncated){const first=valid[0].equityUsd,last=valid.at(-1)!.equityUsd;let peak=first,dd=0;for(const p of valid){peak=Math.max(peak,p.equityUsd);dd=Math.min(dd,p.equityUsd/peak-1);}const ret=(last/first-1)*100;returnPct=Number.isFinite(ret)?ret:null;maxDrawdownPct=dd*100;const days=(Date.parse(valid.at(-1)!.session)-Date.parse(valid[0].session))/86400000;if(Number.isFinite(days)&&days>=365){const cagr=(Math.pow(last/first,365.25/days)-1)*100;cagrPct=Number.isFinite(cagr)?cagr:null;}}
 return {status:!points.length?'not_started':valid.length<2?'insufficient_points':'observed',points:valid,returnPct,maxDrawdownPct,cagrPct,realizedPnlUsd:null,unrealizedPnlUsd:null,truncated,gapLabel:'observed_forward_points_only; unobserved_sessions_unknown; annual_sample_not_established'};
}
/** Optional, bounded provenance enrichment. Failure cannot turn blocked/unknown into success. */
export async function readPaperSourceSummary(hash:unknown,db:ArchiveQueryable):Promise<Pick<PaperViewCycle['collection'],'sources'|'actualReceiptAt'|'provenanceStatus'>> {
 const unknown={sources:[],actualReceiptAt:null,provenanceStatus:'unknown' as const};
 if(typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash))return unknown;
 try{
 const [headers]=await db.query<Row[]>('SELECT byte_length,part_count FROM t156_blob WHERE sha256=?',[hash]);const header=headers[0];
 if(!header||!Number.isInteger(Number(header.byte_length))||Number(header.byte_length)<=0||Number(header.byte_length)>2*1024*1024||!Number.isInteger(Number(header.part_count))||Number(header.part_count)<1||Number(header.part_count)>4)return unknown;
 const bytes=await readBlob(hash,db);const parsed:unknown=JSON.parse(gunzipSync(bytes,{maxOutputLength:16*1024*1024}).toString('utf8'));
 if(!Array.isArray(parsed)||parsed.length>30000)return unknown;
 const groups=new Map<string,{sourceId:string;kind:string;sourceVariant:string;observations:number;symbols:Set<string>;latestSession:string;firstReceiptAt:string;lastReceiptAt:string;lastAvailableAt:string;publicationAt:null}>();
 for(const item of parsed){const row=object(item),kind=String(row.kind),sourceId=code(row.sourceId),variant=String(row.sourceVariant),observed=time(row.observedAt),available=time(row.availableAt),session=String(row.session);
 if(sourceId==='unknown'||!['split_bar','raw_quote','sp500_bar'].includes(kind)||!['split_only','raw','index','generic_adjusted'].includes(variant)||!observed||!available||!/^\d{4}-\d{2}-\d{2}$/.test(session)||typeof row.symbol!=='string'||row.symbol.length>32)return unknown;
 const key=sourceId+':'+kind+':'+variant;const group=groups.get(key)??{sourceId,kind,sourceVariant:variant,observations:0,symbols:new Set<string>(),latestSession:session,firstReceiptAt:observed,lastReceiptAt:observed,lastAvailableAt:available,publicationAt:null};
 group.observations++;group.symbols.add(row.symbol);if(session>group.latestSession)group.latestSession=session;
 if(Date.parse(observed)<Date.parse(group.firstReceiptAt))group.firstReceiptAt=observed;
 if(Date.parse(observed)>Date.parse(group.lastReceiptAt))group.lastReceiptAt=observed;
 if(Date.parse(available)>Date.parse(group.lastAvailableAt))group.lastAvailableAt=available;groups.set(key,group);
 }
 const sources=[...groups.values()].map(({symbols,...g})=>({...g,symbolCount:symbols.size}));
 const actualReceiptAt=sources.reduce<string|null>((at,g)=>!at||Date.parse(g.lastReceiptAt)>Date.parse(at)?g.lastReceiptAt:at,null);
 return {sources,actualReceiptAt,provenanceStatus:'available'};
 }catch{return unknown;}
}
async function projectCycle(row:Row, referenceCount:number|null,db:ArchiveQueryable):Promise<PaperViewCycle>{
 const payload=object(row.payload_json),eligibility=object(payload.eligibility);
 const runId=typeof payload.sourceRunId==='string'&&/^[a-zA-Z0-9_-]{1,96}$/.test(payload.sourceRunId)?payload.sourceRunId:null;
 let plan:Row={},judgments:Row[]=[];
 if(runId){const [runs]=await db.query<Row[]>('SELECT plan_json FROM t156_analysis_run WHERE run_id=?',[runId]);plan=object(runs[0]?.plan_json);[judgments]=await db.query<Row[]>(`SELECT stage,status,JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.reason')) reason FROM t156_judgment WHERE run_id=? ORDER BY stage LIMIT 4`,[runId]);}
 const perSymbol=array(eligibility.perSymbol).slice(0,150);
 const sourceSummary=await readPaperSourceSummary(payload.provenanceBlobSha256,db);
 return {id:String(row.id),session:day(row.session)??'unknown',decisionAt:time(row.decisionAt)??'unknown',mode:row.mode as PaperViewCycle['mode'],sourceRunId:runId,errorCode:payload.errorCode?code(payload.errorCode):null,
 collection:{referenceCount,qualifiedCount:eligibility.perSymbol?perSymbol.filter(p=>p.eligible===true).length:null,cutoffAt:null,...sourceSummary,news:'unknown',disclosures:'unknown',issues:codes(eligibility.issues)},
 eligibility:perSymbol.flatMap(p=>{const s=symbol(p.symbol);return s?[{symbol:s,eligible:p.eligible===true,inFrozenCohort:p.inFrozenCohort===true,issues:codes(p.issues)}]:[];}),
 candidates:array(plan.candidates).slice(0,150).flatMap(p=>{const s=symbol(p.symbol);return s?[{symbol:s,status:code(p.status),momentum:finite(p.momentum),rank:amount(p.rank),selected:p.selected===true,reason:code(p.reason)}]:[];}),
 decisions:array(plan.decisions).slice(0,150).flatMap(p=>{const s=symbol(p.symbol);return s?[{symbol:s,action:['buy','sell','hold'].includes(String(p.action))?String(p.action):'unknown',reason:code(p.reason),quantity:amount(p.quantity)}]:[];}),
 judgments:judgments.map(j=>({stage:code(j.stage),status:code(j.status),reason:safeReason(j.reason)}))};
}
/** Exact signal whitelist; owner authorization is enforced by readPaperView before this query. */
export function projectPaperSignal(s:Row):PaperViewSignal|null {
 const sym=symbol(s.symbol);if(!sym)return null;
 let outcome:PaperViewSignal['outcome']=null;
 if(s.outcome_json!=null){try{const o=object(s.outcome_json);outcome={reason:safeReason(o.reason),quantity:amount(o.quantity),priceUsd:amount(o.priceUsd),feeUsd:amount(o.feeUsd),settlementSession:day(o.settlementSession),observedAt:time(o.observedAt)};}catch{/* Corrupt optional outcome remains unknown. */}}
 return {id:code(s.id),session:day(s.session)??'unknown',symbol:sym,side:code(s.side),status:code(s.status),quantity:scalarAmount(s.quantity),reason:safeReason(s.reason),executeSession:day(s.executeSession),createdAt:time(s.createdAt),mode:['rehearsal','forward','blocked'].includes(String(s.mode))?s.mode as PaperViewSignal['mode']:'unknown',outcome};
}
/** Authenticated caller identity must be supplied. Authorization precedes every paper-data read. */
export async function readPaperView(userId:number,limit=20,db:ArchiveQueryable=getPool()):Promise<PaperView>{
 if(!Number.isSafeInteger(userId)||userId<=0)throw new PaperViewError(403,'paper_viewer_forbidden');
 if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('signal_limit_must_be_1_to_100');
 if(!db.getConnection)throw new PaperViewError(503,'paper_snapshot_unavailable');
 const c=await db.getConnection();if(!c.release||!c.destroy){c.release?.();throw new PaperViewError(503,'paper_snapshot_unavailable');}let active=false,destroyed=false,startAttempted=false;
 try{
 await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');startAttempted=true;await c.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');active=true;
 const [viewers]=await c.query<Row[]>('SELECT v.account_id FROM t156_paper_viewer v INNER JOIN users u ON u.id=v.user_id WHERE v.account_id=? AND v.user_id=?',[PAPER_ACCOUNT_ID,userId]);
 if(viewers.length!==1||viewers[0].account_id!==PAPER_ACCOUNT_ID)throw new PaperViewError(403,'paper_viewer_forbidden');
 const [accounts]=await c.query<Row[]>("SELECT status,revision,policy_json,JSON_EXTRACT(state_json,'$.initialEquityUsd') initialEquityUsd FROM t156_paper_account WHERE id=?",[PAPER_ACCOUNT_ID]);
 if(accounts.length!==1)throw new PaperViewError(503,'paper_account_unavailable');
 const account=accounts[0],policy=object(account.policy_json);
 const [cycles]=await c.query<Row[]>("SELECT id,DATE_FORMAT(session_date,'%Y-%m-%d') session,DATE_FORMAT(decision_at,'%Y-%m-%dT%H:%i:%s.%fZ') decisionAt,mode,payload_json FROM t156_paper_cycle WHERE account_id=? ORDER BY decision_at DESC,id DESC LIMIT 1001",[PAPER_ACCOUNT_ID]);
 const referenceCount=Array.isArray(policy.referenceSymbols)?Math.min(policy.referenceSymbols.length,150):null;
 const latest=cycles[0],usable=cycles.find(r=>r.mode!=='blocked');
 const currentCycle=latest?await projectCycle(latest,referenceCount,c):null;
 const lastUsableCycle=latest?.mode==='blocked'&&usable?{...await projectCycle(usable,referenceCount,c),stale:true as const}:null;
 const [signals]=await c.query<Row[]>(`SELECT s.id,DATE_FORMAT(s.session_date,'%Y-%m-%d') session,s.symbol,s.side,s.status,
 JSON_EXTRACT(s.intent_json,'$.quantity') quantity,JSON_UNQUOTE(JSON_EXTRACT(s.intent_json,'$.reason')) reason,
 JSON_UNQUOTE(JSON_EXTRACT(s.intent_json,'$.executeSession')) executeSession,
 DATE_FORMAT(s.created_at,'%Y-%m-%dT%H:%i:%s.%fZ') createdAt,c.mode,s.outcome_json
 FROM t156_paper_signal s INNER JOIN t156_paper_cycle c ON c.id=s.cycle_id AND c.account_id=s.account_id
 WHERE s.account_id=? AND s.execution_scope='paper_only' ORDER BY s.created_at DESC,s.id DESC LIMIT ?`,[PAPER_ACCOUNT_ID,limit]);
 const truncated=cycles.length>1000;
 const performance=paperPerformance(cycles.slice(0,1000).reverse(),truncated);
 const result:PaperView={executionScope:'paper_only',liveTrading:false,account:{status:code(account.status),revision:Number.isSafeInteger(Number(account.revision))&&Number(account.revision)>=0?Number(account.revision):0,registeredAt:time(policy.registeredAt),cloneInvestmentUsd:account.initialEquityUsd==null?null:amount(Number(account.initialEquityUsd)),currentEquityUsd:latest?amount(object(latest.payload_json).equityUsd):null},currentCycle,lastUsableCycle,
 signals:signals.flatMap(s=>{const projected=projectPaperSignal(s);return projected?[projected]:[];}),performance};
 await c.commit();active=false;return result;
 }catch(e){if(active){try{await c.rollback();}catch{c.destroy?.();destroyed=true;}}else if(startAttempted){c.destroy?.();destroyed=true;}if(e instanceof PaperViewError)throw e;throw new PaperViewError(503,'paper_view_unavailable');}finally{if(!destroyed)c.release?.();}
}

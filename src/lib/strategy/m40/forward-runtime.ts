/** Daily evaluation orchestration. Every generated signal belongs to the isolated paper ledger. */
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { getPool } from '@/lib/db';
import type { ArchiveQueryable, JsonValue } from '@/lib/analysis-data/types';
import { putBlob,readBlob,putDataset,putRecord,publishDataset,saveAnalysisRun,putJudgment,findJudgment,putSignalDraft } from '@/lib/analysis-data/store';
import { buildPaperInput,canFreezePaperCohort } from './forward-input';
import { extendForwardCalendar,nextPaperSettlementSession } from './forward-calendar';
import type { ForwardCalendarSession,ForwardPolicy } from './forward-types';
import { collectForwardSources,mapForwardSources,missingForwardSourceSymbols,mergeForwardSources,fetchForwardPublicText,parseForwardIndexCsv,type ForwardSourceBundle } from './forward-sources';
import { loadM40Evidence } from './load-evidence';
import { runM40Analysis,askConfiguredM40Agent } from './runner';
import { acquirePaperLease,commitPaperCycle,initializePaperAccount,loadPaperAccount,loadPendingPaperIntents,
  releasePaperLease,requirePaperDryRun,FORWARD_POLICY_ID } from './forward-store';
import { PAPER_ACCOUNT_ID,PAPER_STRATEGY_ID,markPaperBook,generatePaperSignals,settlePaperSignals,assertPaperShareBasis } from './paper-ledger';

type Row=Record<string,unknown>;
const sha=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const j=(v:unknown)=>JSON.parse(JSON.stringify(v)) as JsonValue;
const parse=<T>(v:unknown):T=>typeof v==='string'?JSON.parse(v):v as T;
export async function loadForwardCalendar(db:ArchiveQueryable=getPool()) {
 const [rows]=await db.query<Row[]>(`SELECT DATE_FORMAT(s.trade_date,'%Y-%m-%d') session,
   DATE_FORMAT(s.closes_at_utc,'%Y-%m-%dT%H:%i:%s.%fZ') closeAt
   FROM t156_research_backfill_session s JOIN t156_dataset d ON d.id='t156-research-db-20261108' AND d.status='published'
   WHERE s.trade_date>='2025-01-01' AND s.closes_at_utc IS NOT NULL ORDER BY s.trade_date`);
 const history:ForwardCalendarSession[]=rows.map(r=>{
  const day=String(r.session);
  const offset=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',timeZoneName:'shortOffset'})
    .formatToParts(new Date(day+'T12:00:00Z')).find(p=>p.type==='timeZoneName')?.value;
  if(offset!=='GMT-4'&&offset!=='GMT-5')throw Error('forward_calendar_offset_unknown');
  return {session:day,openAt:day+(offset==='GMT-4'?'T13:30:00.000Z':'T14:30:00.000Z'),closeAt:String(r.closeAt),source:'historical_canonical'};
 });
 return extendForwardCalendar(history,'2027-12-31');
}
/** Called explicitly after the user's clone/cohort/T0 decisions, never at boot. */
export async function initializeApprovedForwardPilot(db:ArchiveQueryable=getPool()) {
 await requirePaperDryRun(db);
 const existing=await loadPaperAccount(db);if(existing)return existing;
 const [rows]=await db.query<Row[]>('SELECT symbols FROM overseas_universe_revision ORDER BY revision_no DESC LIMIT 1');
 const symbols=parse<unknown>(rows[0]?.symbols);
 if(!Array.isArray(symbols)||!symbols.length||symbols.length>150||new Set(symbols).size!==symbols.length
   ||symbols.some(s=>typeof s!=='string'||!/^(NAS|NYS|AMS):[A-Z][A-Z0-9.]*$/.test(s)))throw Error('paper_reference_universe_unknown');
 const policy:ForwardPolicy={policyId:FORWARD_POLICY_ID,strategyId:PAPER_STRATEGY_ID,registeredAt:new Date().toISOString(),
  referenceSymbols:[...symbols].sort(),frozenCohort:null,epochSession:null,
  // Reviewed initial collection only. A new or partial response cannot invent permanent exclusions.
  historyExclusionProofs:[
   {symbol:'NAS:HONA',asOfSession:'2026-11-06',splitSourceSha256:'d7032e526b104864bbd6fa70c51d28f8dc29d3bcf4ba0bea26a3d17c0bf05452',reason:'documented_initial_history_gap'},
   {symbol:'NAS:SPCX',asOfSession:'2026-11-06',splitSourceSha256:'9deab3795dd799d976b8bce0a72dc77d9957205c590d54aa3aa1a2fe6c3cc934',reason:'documented_initial_history_gap'}
  ].filter(proof=>symbols.includes(proof.symbol)) as NonNullable<ForwardPolicy['historyExclusionProofs']>};
 return initializePaperAccount(policy,db);
}
export async function archiveForwardSources(bundle:ForwardSourceBundle,db:ArchiveQueryable=getPool()) {
 for(const r of bundle.records)if(!r.rawCsv||sha(r.rawCsv)!==r.sha256)throw Error('paper_source_original_missing_or_mismatched');
 if(bundle.market&&(!bundle.market.rawCsv||sha(bundle.market.rawCsv)!==bundle.market.sha256))throw Error('paper_source_original_missing_or_mismatched');
 const bytes=Buffer.from(JSON.stringify(bundle)),hash=sha(bytes),compressed=gzipSync(bytes);
 if(bytes.length>24*1024*1024)throw Error('paper_source_batch_too_large');
 const blobSha=await putBlob(compressed,'binary',db);
 const observedAt=new Date().toISOString(),id='paper-src-'+hash.slice(0,48);
 await putDataset({id,kind:'m40_paper_sources',sourceKey:'evaluation_only',contentSha256:hash,
  metadata:{asOfSession:bundle.asOfSession??null,sourceUse:'evaluation_only',blobSha256:blobSha},createdAt:observedAt},db);
 await putRecord({datasetId:id,recordType:'m40_paper_source_bundle',recordKey:'snapshot',sessionDate:bundle.asOfSession??null,
  availableAt:observedAt,payload:{blobSha256:blobSha,compression:'gzip',uncompressedSha256:hash,bytes:bytes.length}},db);
 await publishDataset(id,{rowCount:1,liveEligible:false},db);
 return id;
}
async function cachedForwardSources(asOf:string,cutoff:string,db:ArchiveQueryable):Promise<ForwardSourceBundle|null>{
 const [rows]=await db.query<Row[]>(`SELECT r.payload_json,DATE_FORMAT(r.available_at,'%Y-%m-%dT%H:%i:%s.%fZ') availableAt
  FROM t156_record r JOIN t156_dataset d ON d.id=r.dataset_id
  WHERE d.kind='m40_paper_sources' AND d.status='published' AND d.live_eligible=0
   AND r.record_type='m40_paper_source_bundle' AND r.session_date=? AND r.available_at<=?
  ORDER BY r.available_at DESC LIMIT 1`,[asOf,cutoff.slice(0,-1).replace('T',' ')]);
 if(!rows.length||Date.parse(cutoff)-Date.parse(String(rows[0].availableAt))>24*3600_000)return null;
 const pointer=parse<{blobSha256:string;uncompressedSha256:string}>(rows[0].payload_json);
 const bytes=gunzipSync(await readBlob(pointer.blobSha256,db),{maxOutputLength:24*1024*1024});
 if(sha(bytes)!==pointer.uncompressedSha256)throw Error('paper_source_readback_failed');
 return JSON.parse(bytes.toString()) as ForwardSourceBundle;
}
async function refreshMissingIndex(bundle:ForwardSourceBundle,referenceSession:string) {
 if(bundle.market?.rows.some(r=>r.session===referenceSession))return bundle;
 const sourceUrl='https://fred.stlouisfed.org/graph/fredgraph.csv?'+new URLSearchParams({id:'SP500',cosd:bundle.dateWindow.start,coed:bundle.dateWindow.end});
 try{
  const response=await fetchForwardPublicText(sourceUrl,{timeoutMs:20000,maxBytes:512*1024});
  if(response.status!==200)throw Error('forward_index_unavailable');
  const parsed=parseForwardIndexCsv(response.text,bundle.dateWindow.start,bundle.dateWindow.end);
  return {...bundle,market:{sourceId:'fred_sp500_forward',sourceUrl,observedAt:new Date().toISOString(),sha256:sha(response.text),
    rows:parsed.rows,rawCsv:response.text,basis:'index' as const,series:'SP500' as const,missingSessions:parsed.missingSessions}};
 }catch{return {...bundle,failures:[...bundle.failures,{basis:'index' as const,errorCode:'forward_index_refresh_unavailable'}]};}
}
let flight:Promise<Record<string,unknown>>|null=null;
export function runM40ForwardCycle():Promise<Record<string,unknown>> {
 if(!flight)flight=runCycle().finally(()=>{flight=null;});
 return flight;
}
async function runCycle():Promise<Record<string,unknown>> {
 const db=getPool() as unknown as ArchiveQueryable;
 await requirePaperDryRun(db);
 if(!await loadPaperAccount(db))return {status:'not_initialized',executionScope:'paper_only'};
 const lease=await acquirePaperLease(db);if(!lease)return {status:'already_running',executionScope:'paper_only'};
 try{
  const calendar=await loadForwardCalendar(db),start=new Date().toISOString();
  const asOf=calendar.filter(s=>s.closeAt<=start).at(-1)?.session;
  if(!asOf)throw Error('forward_completed_session_unknown');
  let policy:ForwardPolicy=JSON.parse(JSON.stringify(lease.account.policy));
  const [done]=await db.query<Row[]>('SELECT mode FROM t156_paper_cycle WHERE account_id=? AND session_date=?',[PAPER_ACCOUNT_ID,asOf]);
  if(done.some(r=>r.mode==='forward')||(done.some(r=>r.mode==='rehearsal')&&calendar.find(s=>s.session===asOf)!.closeAt<policy.registeredAt))
   return {status:'already_observed',session:asOf,executionScope:'paper_only'};
  const symbols=[...new Set([...policy.referenceSymbols,...lease.account.book.holdings.map(h=>h.symbol)])].sort();
  let bundle=await cachedForwardSources(asOf,start,db);
  const absent=bundle?missingForwardSourceSymbols(bundle,symbols):symbols;
  if(!bundle){bundle=await collectForwardSources(symbols,asOf);await archiveForwardSources(bundle,db);}
  else if(absent.length){
   const extra=await collectForwardSources(absent,asOf);
   bundle=mergeForwardSources(bundle,extra,symbols);
   await archiveForwardSources(bundle,db);
  }
  const priorSession=calendar[calendar.findIndex(s=>s.session===asOf)-1]?.session;
  if(priorSession&&!bundle.market?.rows.some(r=>r.session===priorSession)){
   bundle=await refreshMissingIndex(bundle,priorSession);await archiveForwardSources(bundle,db);
  }
  const cutoff=new Date().toISOString();await requirePaperDryRun(db);
  const {data,opens}=mapForwardSources(bundle,calendar);
  data.asOfSession=asOf;
  const prices=new Map(data.members.filter(m=>m.rawQuote?.session===asOf).map(m=>[m.symbol,m.rawQuote!.price]));
  let book=JSON.parse(JSON.stringify(lease.account.book)) as typeof lease.account.book;
  // A split/correction in an already held share basis requires reconciliation;
  // inferred share counts must never fabricate either a windfall or a crash.
  assertPaperShareBasis(book,data.members,asOf);
  const pending=await loadPendingPaperIntents(db);
  const settled=settlePaperSignals({book,intents:pending,opens,session:asOf,cutoff,
   openingAt:s=>calendar.find(c=>c.session===s)?.openAt??'',
   settlementAfter:s=>nextPaperSettlementSession(calendar,s)});
  book=settled.book;
  const marked=markPaperBook(book,prices,asOf);book=marked.book;
  const account={equityUsd:marked.equityUsd,settledCashUsd:marked.settledCashUsd,holdings:book.holdings,
   clonedAt:lease.account.clonedAt,cloneSha256:lease.account.cloneSha256};
  let checked=buildPaperInput(data,policy,account,cutoff);
  if(canFreezePaperCohort(data,policy,checked)){
   policy={...policy,frozenCohort:checked.report.cohortProposal};checked=buildPaperInput(data,policy,account,cutoff);
  }
  const next=calendar.find(s=>s.session>asOf);if(!next)throw Error('paper_next_session_unknown');
  const deadlineElapsed=Date.parse(cutoff)>=Date.parse(next.openAt);
  if(deadlineElapsed)checked={...checked,report:{...checked.report,forwardEligible:false,
    issues:[...checked.report.issues,'next_open_deadline_elapsed']}};
  if(policy.epochSession===null&&checked.report.forwardEligible&&checked.report.epochCandidate){
   policy={...policy,epochSession:checked.report.epochCandidate,epochLockedAt:cutoff};checked=buildPaperInput(data,policy,account,cutoff);
  }
  const confirmedExitOnly=!!checked.confirmedOnlyInput&&policy.epochSession!==null&&policy.frozenCohort!==null
   &&checked.report.asOfLatestCompleted&&!deadlineElapsed;
  const analysisInput=checked.input??checked.confirmedOnlyInput;
  const mode=confirmedExitOnly?'forward':checked.input&&checked.report.coreEligible&&policy.frozenCohort&&!deadlineElapsed?(checked.report.forwardEligible?'forward':'rehearsal'):'blocked';
  const cycleId=sha(JSON.stringify([PAPER_ACCOUNT_ID,asOf,mode]));
  let result:Awaited<ReturnType<typeof runM40Analysis>>|null=null;
  if(analysisInput){
   const {evidence,issues}=await loadM40Evidence(analysisInput.decisionTime);
   result=await runM40Analysis({input:analysisInput,evidence,optionalDataIssues:issues,
    triggers:[...(evidence.length?['new_evidence' as const]:[]),...(!evidence.length||issues.length?['optional_data_gap' as const]:[])],
    timeoutMs:2000,modelEnabled:process.env.T156_M40_AGENT_ENABLED==='true',modelPolicyVersion:process.env.T156_M40_AGENT_POLICY_VERSION},
    {store:{saveAnalysisRun,putJudgment,findJudgment,putSignalDraft},askAgent:askConfiguredM40Agent});
  }
  const signals=result&&mode!=='blocked'?generatePaperSignals({accountId:PAPER_ACCOUNT_ID,cycleId,plan:result.plan,
   runId:result.runId,inputSha256:result.inputSha256,executeSession:next.session,createdAt:new Date().toISOString(),mode}):[];
  if(mode==='forward')book.lastForwardSession=asOf;
  const nextBasis:typeof book.splitBasis={};
  for(const holding of book.holdings){const bar=data.members.find(m=>m.symbol===holding.symbol)?.splitBars.at(-1);
   if(!bar||bar.session!==asOf)throw Error('paper_current_basis_observation_missing');
   nextBasis[holding.symbol]={session:bar.session,close:bar.close};}
  book.splitBasis=nextBasis;
  const {provenance,...eligibility}=checked.report;
  const provenanceSha=await putBlob(gzipSync(Buffer.from(JSON.stringify(provenance))),'binary',db);
  const committed=await commitPaperCycle({lease,policy,book,cycle:{id:cycleId,session:asOf,decisionAt:cutoff,mode,
   payload:{eligibility,executionKind:confirmedExitOnly?'confirmed_membership_exit_only':'full_core',provenanceBlobSha256:provenanceSha,sourceBundleSha256:sha(JSON.stringify(bundle)),
    inputSha256:result?.inputSha256??null,sourceRunId:result?.runId??null,
    equityUsd:marked.equityUsd,returnSinceClone:marked.returnSinceClone,drawdown:marked.drawdown,
    outcomes:settled.outcomes,model:'next_open_fixed_quantity_or_expire; retrospectively evaluated from received EOD, not actual auction fills',feePerSide:0.0025,
    minimumValidation:{weeks:12,completedTrades:100,changedDaysForAgentTrading:20},profitabilityValidated:false}},signals,outcomes:settled.outcomes},db);
  return {status:committed?mode:'already_observed',session:asOf,executionScope:'paper_only',cohortSize:policy.frozenCohort?.symbols.length??0,
   epochSession:policy.epochSession,signalCount:signals.length,modeledFillCount:settled.outcomes.filter(o=>o.status==='filled').length,
   sourceRunId:result?.runId??null,issueCodes:checked.report.issues,profitabilityValidated:false};
 }catch(error){
  // Failure itself is an observed data gap, never a successful/zero-return day.
  const text=error instanceof Error?error.message:'';
  const errorCode=/^(paper|m40_forward|forward)_[a-z_]+$/.test(text)?text:'forward_cycle_failed';
  try{
   const cal=await loadForwardCalendar(db),at=new Date().toISOString();
   const session=cal.filter(s=>s.closeAt<=at).at(-1)?.session;
   if(session)await commitPaperCycle({lease,policy:lease.account.policy,book:lease.account.book,
    cycle:{id:sha(JSON.stringify([PAPER_ACCOUNT_ID,session,'blocked'])),session,decisionAt:at,mode:'blocked',
     payload:{errorCode,executionScope:'paper_only',profitabilityValidated:false}},signals:[],outcomes:[]},db);
  }catch{ /* Missing storage or a changed DRY_RUN cannot authorize processing. */ }
  return {status:'blocked',errorCode,executionScope:'paper_only',profitabilityValidated:false};
 }finally{await releasePaperLease(lease.token,db);}
}

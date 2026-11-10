/** Server-side licensed read-only index adapter. Never use as a live/order feed. */
import { performance } from 'node:perf_hooks';
import { getCredential } from '@/lib/credentials';
import { getKisToken, kisBaseUrl } from '@/lib/exchanges/kis-auth';
import { kisBodyText, kisFetch } from '@/lib/exchanges/kis-http';
import {
  indexEvidenceSha, indexRequiredSessions, indexUtc, kisIndexRequest, mergeKisIndexPages,
  validateKisIndexEnvelope, KIS_INDEX_LIMITS, KIS_SP500_SOURCE_ID, KIS_SP500_SOURCE_URL,
  type FredIndexEvidence, type KisIndexEnvelope, type KisIndexPage,
} from './forward-index-contract';
import type { ForwardCalendarSession } from './forward-types';

export interface CollectKisForwardIndexOptions {
  start:string; end:string; calendar:readonly ForwardCalendarSession[]; fred:FredIndexEvidence;
  now?:()=>Date; monotonicMs?:()=>number;
}
export interface KisForwardIndexDependencies {
  /** Test seam; production always uses the fixed allowlisted GET below. */
  fetchPage?:(request:Readonly<Record<string,string>>,remainingMs:number)=>Promise<{http:number;rawJson:string}>;
}
const fail=(code:string):never=>{throw new Error(`forward_index_${code}`);};
const dayAfter=(day:string,days:number):string=>new Date(Date.parse(`${day}T00:00:00Z`)+days*86400_000).toISOString().slice(0,10);
async function fetchLicensedPage(request:Readonly<Record<string,string>>,remainingMs:number,signal:AbortSignal):Promise<{http:number;rawJson:string}> {
  if(kisBaseUrl()!=='https://openapi.koreainvestment.com:9443')return fail('mock_ineligible');
  const [token,appkey,appsecret]=await Promise.all([getKisToken(),getCredential('KIS_APP_KEY'),getCredential('KIS_APP_SECRET')]);
  if(signal.aborted)return fail('deadline');
  if(!token||!appkey||!appsecret)return fail('credentials_missing');
  const url=new URL(KIS_SP500_SOURCE_URL);url.search=new URLSearchParams(request).toString();
  const response=await kisFetch(url.toString(),{method:'GET',signal,redirect:'error',headers:{
    'Content-Type':'application/json; charset=utf-8',Authorization:`Bearer ${token}`,appkey,appsecret,
    tr_id:'FHKST03030100',custtype:'P',
  }},{priority:'bulk',timeoutMs:Math.max(1,Math.floor(Math.min(10_000,remainingMs))),maxWaitMs:Math.max(1,Math.floor(Math.min(5000,remainingMs))),
    rateLimitRetries:0,transientRetries:0,maxResponseBytes:KIS_INDEX_LIMITS.responseBytes,bodyDeadlineMs:Math.max(1,Math.floor(Math.min(90_000,remainingMs))),label:'m40ForwardSp500Index'});
  return {http:response.status,rawJson:kisBodyText(response)??await response.text()};
}
export async function collectKisForwardIndex(options:CollectKisForwardIndexOptions,dependencies:KisForwardIndexDependencies={}) {
  if(typeof window!=='undefined')return fail('server_only');
  // Missing/unknown configuration is ineligible, including under an injected transport.
  if(String(process.env.KIS_MOCK??'true').toLowerCase()!=='false')return fail('mock_ineligible');
  const now=options.now??(()=>new Date()),monotonic=options.monotonicMs??(()=>performance.now());
  const startClock=monotonic(),startedAt=indexUtc(now().toISOString());
  if(Date.parse(`${options.end}T00:00:00Z`)-Date.parse(`${options.start}T00:00:00Z`)>430*86400_000)return fail('window_invalid');
  const validation={start:options.start,end:options.end,calendar:options.calendar,now:startedAt};
  const required=indexRequiredSessions(validation),pages:KisIndexPage[]=[];

  let lastClock=startClock,lastObserved=startedAt,bytes=0;
  function remaining():number {
    const clock=monotonic();
    if(!Number.isFinite(clock)||clock<lastClock)return fail('clock_reversed');lastClock=clock;
    const left=KIS_INDEX_LIMITS.deadlineMs-(clock-startClock);
    if(left<=0)return fail('deadline');return left;
  }
  async function collect(start:string,end:string):Promise<void> {
    if(pages.length>=KIS_INDEX_LIMITS.requests)return fail('request_budget');
    const budget=remaining(),request=kisIndexRequest(start,end);
    if(budget<15_000)return fail('deadline');
    let timer:ReturnType<typeof setTimeout>|undefined;
    const controller=new AbortController();
    try {
      const response=await Promise.race([(dependencies.fetchPage?dependencies.fetchPage(request,budget):fetchLicensedPage(request,budget,controller.signal)),new Promise<never>((_,reject)=>{
        timer=setTimeout(()=>{controller.abort();reject(new Error('forward_index_deadline'));},budget);
      })]);
      remaining();
      const observedAt=now().toISOString(),normalized=indexUtc(observedAt);
      if(normalized<lastObserved)return fail('clock_reversed');
      // Wall clock must agree with monotonic elapsed time (1s allowance for timestamp resolution).
      if(Math.abs((Date.parse(normalized)-Date.parse(startedAt))-(lastClock-startClock))>1000)return fail('clock_invalid');
      lastObserved=normalized;
      if(typeof response.rawJson!=='string')return fail('page_invalid');
      bytes+=Buffer.byteLength(response.rawJson);if(bytes>KIS_INDEX_LIMITS.totalBytes)return fail('byte_budget');
      const page:KisIndexPage={request,http:response.http,observedAt,rawJson:response.rawJson,sha256:indexEvidenceSha(response.rawJson)};
      // Validation happens before scheduling the next request, not merely at the end.
      mergeKisIndexPages([...pages,page],{...validation,now:observedAt});pages.push(page);
    } finally { if(timer)clearTimeout(timer);controller.abort(); }
  }
  for(let start=options.start;start<=options.end;){
    const end=dayAfter(start,KIS_INDEX_LIMITS.pageDays-1)<options.end?dayAfter(start,KIS_INDEX_LIMITS.pageDays-1):options.end;
    // A calendar-only interval would have no observations; never request it.
    if(required.some(s=>s.session>=start&&s.session<=end))await collect(start,end);
    start=dayAfter(end,1);
  }
  while(true){
    const available=new Set(mergeKisIndexPages(pages,{...validation,now:lastObserved}).map(r=>r.session));
    const missing=required.filter(s=>!available.has(s.session));if(!missing.length)break;
    const first=missing[0].session;
    let end=first;
    for(const session of required.filter(s=>s.session>first)){
      if(available.has(session.session)||session.session>dayAfter(first,KIS_INDEX_LIMITS.gapDays-1))break;
      end=session.session;
    }
    const before=available.size;await collect(first,end);
    const after=mergeKisIndexPages(pages,{...validation,now:lastObserved});
    if(after.length<=before)return fail('gap_no_progress');
  }
  const envelope:KisIndexEnvelope={schemaVersion:1,sourceId:KIS_SP500_SOURCE_ID,series:'SP500',unit:'INDEX',
    sourceUse:'evaluation_only',liveEligible:false,dateWindow:{start:options.start,end:options.end},pages,fred:options.fred};
  const rawJson=JSON.stringify(envelope),checked=validateKisIndexEnvelope(rawJson,{...validation,now:lastObserved});
  remaining();
  return {sourceId:KIS_SP500_SOURCE_ID,sourceUrl:KIS_SP500_SOURCE_URL,observedAt:checked.observedAt,
    sha256:checked.sha256,rows:checked.rows,basis:'index' as const,series:'SP500' as const,rawJson,
    sourceUse:'evaluation_only' as const,liveEligible:false as const};
}

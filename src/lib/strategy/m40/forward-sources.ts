/** Evaluation-only public observations. No DB, account, order or credential-store access. */
import { BRK_PAIR_SOURCE_ID,BRK_PAIR_SYMBOL,BRK_ALPACA_URL,validateBrkPairEnvelope } from './forward-stock-contract';
import { ForwardCollectionBudget } from './forward-collection-budget';
import { createHash } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { performance } from 'node:perf_hooks';
import { spawn } from 'node:child_process';
import { KIS_SP500_SOURCE_ID, KIS_SP500_SOURCE_URL, validateKisIndexEnvelope, canonicalIndexDecimal } from './forward-index-contract';
import { normalizeForwardUtc, validForwardSessionDate } from './forward-calendar';
import type { ForwardCalendarSession, ForwardInputData, ForwardMemberData, ForwardPriceBar } from './forward-types';
import type { RawOpen } from './paper-ledger';

export interface ForwardCsvBar { session:string; open:string; high:string; low:string; close:string; volume:string }
export interface ForwardStockSource {
  symbol:string; vendorTicker:string; basis:'split_adjusted'|'raw'; sourceId:string;
  request:Record<string,string>; observedAt:string; sha256:string; rows:ForwardCsvBar[];
  rawJson?:string;sourceUse?:'evaluation_only';liveEligible?:false;rawCsv?:string; sourceUrl?:string; file?:string; bytes?:number; http?:number; probe?:boolean;
}
export interface ForwardIndexSource {
  sourceId:string; sourceUrl:string; observedAt:string; sha256:string;
  rows:{session:string;close:string}[]; basis?:'index'; series?:'SP500'; rawCsv?:string; rawJson?:string; sourceUse?:'evaluation_only'; liveEligible?:false; missingSessions?:string[];
}
export interface ForwardSourceFailure {
  symbol?:string; basis?:'split_adjusted'|'raw'|'index'; errorCode:string; sourceId?:string;
}
export interface ForwardSourceBundle {
  schemaVersion:1; asOfSession:string; observedAt:string; dateWindow:{start:string;end:string};
  records:ForwardStockSource[]; market?:ForwardIndexSource; failures:ForwardSourceFailure[];
  complete:boolean; sourceUse:string; kind?:string;nonPriceEvidence?:{brkContinuityReference?:ForwardStockSource;quarantine?:{reason:string;observedAt:string;rawJson:string;sha256:string}};
}
export interface ForwardFetchOptions { timeoutMs:number; maxBytes:number; budget?:ForwardCollectionBudget }
export interface ForwardFetchResponse { status:number; text:string }
export interface ForwardSourceDependencies {
  fetchText?:(url:string,options:ForwardFetchOptions)=>Promise<ForwardFetchResponse>;
  budget?:ForwardCollectionBudget; now?:()=>Date; sleep?:(milliseconds:number)=>Promise<void>; monotonicMs?:()=>number;
}
export const FORWARD_COLLECTION_LIMITS=Object.freeze({
  symbols:150, requests:301, responseBytes:512*1024, totalBytes:20*1024*1024,
  timeoutMs:20_000, deadlineMs:7*60_000, requestSpacingMs:1000, consecutiveFailures:3, calendarLookbackDays:430,
});
export const FORWARD_EVALUATION_SOURCE_USE='evaluation_only; guest access is not authorized as a production/live feed';
const SHA=/^[0-9a-f]{64}$/;
const SYMBOL=/^(?:NAS|NYS|AMS):[A-Z0-9][A-Z0-9.\-]{0,23}$/;
const DECIMAL=/^\d+(?:\.\d+)?$/;
const sha=(text:string):string=>createHash('sha256').update(text,'utf8').digest('hex');
const order=(a:string,b:string):number=>a<b?-1:a>b?1:0;
const error=(code:string):never=>{throw new Error(code);};
function positive(value:string):boolean { return typeof value==='string'&&value.length<=40&&DECIMAL.test(value)&&Number.isFinite(Number(value))&&Number(value)>0; }
function utc(value:string):string { const normalized=normalizeForwardUtc(value);return normalized??error('forward_source_clock_invalid'); }
function stockEndpoint(value:string):URL {
  let url:URL;try{url=new URL(value);}catch{return error('forward_source_url_invalid');}
  if(url.protocol!=='https:'||url.hostname!=='api.kibot.com'||url.port||url.pathname!=='/'||url.username||url.password)
    return error('forward_source_url_invalid');
  return url;
}
function indexEndpoint(value:string):URL {
  let url:URL;try{url=new URL(value);}catch{return error('forward_source_url_invalid');}
  if(url.protocol!=='https:'||url.hostname!=='fred.stlouisfed.org'||url.port||url.pathname!=='/graph/fredgraph.csv'
    ||url.username||url.password||url.searchParams.get('id')!=='SP500')return error('forward_source_url_invalid');
  for(const key of url.searchParams.keys())if(!['id','cosd','coed'].includes(key))return error('forward_source_url_invalid');
  return url;
}

/** Direct IPv4 per request; never changes process-wide DNS or accepts a redirect. */
async function fetchForwardNodeText(urlText:string,options:ForwardFetchOptions):Promise<ForwardFetchResponse> {
  if(options.budget)options={...options,timeoutMs:await options.budget.reserve(options.timeoutMs),maxBytes:options.budget.responseLimit(options.maxBytes)};
  const url=urlText.startsWith('https://api.kibot.com/')?stockEndpoint(urlText):indexEndpoint(urlText);
  return new Promise((resolve,reject)=>{
    let ended=false;
    const finish=(reason?:Error,result?:ForwardFetchResponse):void=>{
      if(ended)return;ended=true;clearTimeout(timer);if(reason)reject(reason);else resolve(result!);
    };
    const req=httpsRequest(url,{method:'GET',family:4,headers:{'User-Agent':'StockInvest-T156-evaluation','Accept-Encoding':'identity'}},res=>{
      let bytes=0;const chunks:Buffer[]=[];
      if(res.headers['content-encoding']&&res.headers['content-encoding']!=='identity'){
        res.destroy();req.destroy();finish(new Error('forward_source_encoding_unexpected'));return;
      }
      res.on('data',(chunk:Buffer)=>{
        bytes+=chunk.length;
        try{options.budget?.consume(chunk.length);}catch{res.destroy();req.destroy();finish(new Error('forward_source_response_budget'));return;}
        if(bytes>options.maxBytes){res.destroy();req.destroy();finish(new Error('forward_source_response_budget'));return;}
        chunks.push(chunk);
      });
      res.on('error',()=>finish(new Error('forward_source_transport_failed')));
      res.on('end',()=>finish(undefined,{status:res.statusCode??0,text:Buffer.concat(chunks).toString('utf8')}));
    });
    const timer=setTimeout(()=>{req.destroy();finish(new Error('forward_source_timeout'));},options.timeoutMs);
    req.on('error',()=>finish(new Error('forward_source_transport_failed')));
    req.end();
  });
}
/** FRED-only transport fallback. curl's default truthful UA; no redirects/config/TLS bypass. */
export function fetchForwardIndexCurl(urlText:string,options:ForwardFetchOptions):Promise<ForwardFetchResponse> {
  indexEndpoint(urlText);return fetchForwardIndexCurlBounded(urlText,options);
}
async function fetchForwardIndexCurlBounded(urlText:string,options:ForwardFetchOptions):Promise<ForwardFetchResponse> {
  if(options.budget)options={...options,timeoutMs:await options.budget.reserve(options.timeoutMs),maxBytes:options.budget.responseLimit(options.maxBytes)};
  indexEndpoint(urlText);
  return new Promise((resolve,reject)=>{
    const child=spawn('curl',['-q','--ipv4','--silent','--show-error','--proto','=https','--max-redirs','0',
      '--max-time',String(Math.max(0.001,options.timeoutMs/1000)),'--max-filesize',String(options.maxBytes),
      '--write-out','\n%{http_code}',urlText],{stdio:['ignore','pipe','ignore']});
    let bytes=0,ended=false;const chunks:Buffer[]=[];
    const finish=(cause?:Error):void=>{if(ended)return;ended=true;clearTimeout(timer);
      if(cause){child.kill('SIGKILL');reject(cause);return;}
      const text=Buffer.concat(chunks).toString('utf8'),match=/\n(\d{3})$/.exec(text);
      if(!match){reject(new Error('forward_source_transport_failed'));return;}
      resolve({status:Number(match[1]),text:text.slice(0,-match[0].length)});
    };
    const timer=setTimeout(()=>finish(new Error('forward_source_timeout')),options.timeoutMs);
    child.stdout.on('data',(chunk:Buffer)=>{bytes+=chunk.length;
      try{options.budget?.consume(chunk.length);}catch{finish(new Error('forward_source_response_budget'));return;}
      if(bytes>options.maxBytes+4)finish(new Error('forward_source_response_budget'));else chunks.push(chunk);});
    child.on('error',()=>finish(new Error('forward_source_transport_failed')));
    child.on('close',code=>finish(code===0?undefined:new Error('forward_source_transport_failed')));
  });
}
export function fetchForwardPublicText(urlText:string,options:ForwardFetchOptions):Promise<ForwardFetchResponse> {
  // Validate synchronously before either transport opens a socket.
  const isStock=urlText.startsWith('https://api.kibot.com/');
  if(isStock)stockEndpoint(urlText);else indexEndpoint(urlText);
  const began=performance.now();
  if(isStock)return fetchForwardNodeText(urlText,options);
  // Reserve half of the same per-request budget for curl; never double the deadline.
  return fetchForwardNodeText(urlText,{...options,timeoutMs:Math.max(1,Math.floor(options.timeoutMs/2))})
    .catch((cause:unknown)=>{
      if(!(cause instanceof Error)||!['forward_source_timeout','forward_source_transport_failed'].includes(cause.message))throw cause;
      const remaining=options.timeoutMs-(performance.now()-began);
      if(remaining<=0)throw new Error('forward_source_timeout');
      return fetchForwardIndexCurl(urlText,{...options,timeoutMs:remaining});});
}
function csvSession(value:string):string {
  const match=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if(!match)return error('forward_source_csv_invalid');
  const date=`${match[3]}-${match[1].padStart(2,'0')}-${match[2].padStart(2,'0')}`;
  return validForwardSessionDate(date)?date:error('forward_source_csv_invalid');
}
export function parseForwardStockCsv(text:string,start:string,end:string):ForwardCsvBar[] {
  if(!text.trim()||text.includes('\uFFFD'))return error('forward_source_csv_invalid');
  const rows:ForwardCsvBar[]=[],seen=new Set<string>();
  for(const line of text.replace(/^\uFEFF/,'').trim().split(/\r?\n/)){
    const f=line.split(',');if(f.length!==6)return error('forward_source_csv_invalid');
    const session=csvSession(f[0]);
    if(session<start||session>end||seen.has(session)||f.slice(1,5).some(v=>!positive(v))
      ||f[5].length>40||!/^\d+$/.test(f[5]))return error('forward_source_csv_invalid');
    const [open,high,low,close]=f.slice(1,5).map(Number);
    if(low>Math.min(open,close)||high<Math.max(open,close)||low>high)return error('forward_source_csv_invalid');
    seen.add(session);rows.push({session,open:f[1],high:f[2],low:f[3],close:f[4],volume:f[5]});
  }
  return rows.sort((a,b)=>order(a.session,b.session));
}
export function parseForwardIndexCsv(text:string,start:string,end:string):{rows:ForwardIndexSource['rows'];missingSessions:string[]} {
  const lines=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/);
  if(!['observation_date,SP500','DATE,SP500'].includes(lines.shift()??''))return error('forward_source_csv_invalid');
  const rows:ForwardIndexSource['rows']=[],missingSessions:string[]=[],seen=new Set<string>();
  for(const line of lines){
    const f=line.split(',');
    if(f.length!==2||!validForwardSessionDate(f[0])||f[0]<start||f[0]>end||seen.has(f[0]))return error('forward_source_csv_invalid');
    seen.add(f[0]);if(f[1]===''||f[1]==='.'){missingSessions.push(f[0]);continue;}
    if(!positive(f[1]))return error('forward_source_csv_invalid');
    rows.push({session:f[0],close:f[1]});
  }
  if(!rows.length)return error('forward_source_csv_invalid');
  return {rows:rows.sort((a,b)=>order(a.session,b.session)),missingSessions:missingSessions.sort(order)};
}
function responseCode(response:ForwardFetchResponse):string|null {
  const body=/^\s*(401|402|403|404|405|429)(?:\s|,|$)/.exec(response.text);
  if(body)return `forward_source_provider_${body[1]}`;
  return response.status>=200&&response.status<300?null:`forward_source_http_${response.status}`;
}
const publicFailure=(value:unknown):string=>value instanceof Error&&/^forward_source_[a-z0-9_]+$/.test(value.message)
  ?value.message:'forward_source_transport_failed';

/** Each response has its own real receipt clock. Completed download is not full data eligibility. */
export async function collectForwardSources(
  symbols:string[],asOfSession:string,deps:ForwardSourceDependencies={},
):Promise<ForwardSourceBundle> {
  if(!validForwardSessionDate(asOfSession)||!Array.isArray(symbols)||!symbols.length||symbols.length>FORWARD_COLLECTION_LIMITS.symbols
    ||new Set(symbols).size!==symbols.length||symbols.some(symbol=>!SYMBOL.test(symbol)))return error('forward_source_request_invalid');
  const now=deps.now??(()=>new Date()),clock=deps.monotonicMs??(()=>performance.now());
  const sleep=deps.sleep??((ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms)));
  const fetchText=deps.fetchText??fetchForwardPublicText;
  const start=new Date(Date.parse(`${asOfSession}T00:00:00Z`)-FORWARD_COLLECTION_LIMITS.calendarLookbackDays*86400_000).toISOString().slice(0,10);
  const bundle:ForwardSourceBundle={schemaVersion:1,kind:'public_forward_sources',asOfSession,observedAt:now().toISOString(),
    dateWindow:{start,end:asOfSession},records:[],failures:[],complete:false,sourceUse:FORWARD_EVALUATION_SOURCE_USE};
  const began=clock();let lastStart:number|null=null,requests=0,totalBytes=0,consecutive=0,halted=false;
  async function fetch(url:string,symbol:string,basis:'split_adjusted'|'raw'|'index'):Promise<{text:string;observedAt:string}|null>{
    const remaining=()=>Math.min(FORWARD_COLLECTION_LIMITS.deadlineMs-(clock()-began),deps.budget?.remaining()??Infinity);
    try{
      if(halted||requests>=FORWARD_COLLECTION_LIMITS.requests||remaining()<=0)return error('forward_source_deadline');
      if(lastStart!==null){const pause=Math.max(0,FORWARD_COLLECTION_LIMITS.requestSpacingMs-(clock()-lastStart));if(pause>=remaining())return error('forward_source_deadline');if(pause)await sleep(pause);}
      if(remaining()<=0)return error('forward_source_deadline');
      lastStart=clock();requests++;
      if(deps.fetchText&&deps.budget)await deps.budget.reserve();
      const response=await fetchText(url,{budget:deps.fetchText?undefined:deps.budget,timeoutMs:Math.min(FORWARD_COLLECTION_LIMITS.timeoutMs,remaining()),maxBytes:FORWARD_COLLECTION_LIMITS.responseBytes});
      const bytes=Buffer.byteLength(response.text,'utf8');if(deps.fetchText)deps.budget?.consume(bytes);totalBytes+=bytes;
      if(bytes>FORWARD_COLLECTION_LIMITS.responseBytes||totalBytes>FORWARD_COLLECTION_LIMITS.totalBytes)return error('forward_source_response_budget');
      const code=responseCode(response);if(code)return error(code);
      const observedAt=now().toISOString();utc(observedAt);
      return {text:response.text,observedAt};
    }catch(cause){
      const errorCode=publicFailure(cause);bundle.failures.push({symbol,basis,errorCode});consecutive++;
      if(/_(?:402|429)$/.test(errorCode)||['forward_source_deadline','forward_source_response_budget'].includes(errorCode)
        ||consecutive>=FORWARD_COLLECTION_LIMITS.consecutiveFailures)halted=true;
      return null;
    }
  }
  function invalid(symbol:string,basis:'split_adjusted'|'raw'|'index',cause:unknown):void {
    bundle.failures.push({symbol,basis,errorCode:publicFailure(cause)});consecutive++;
    if(consecutive>=FORWARD_COLLECTION_LIMITS.consecutiveFailures)halted=true;
  }
  const mmdd=(day:string):string=>`${day.slice(5,7)}/${day.slice(8,10)}/${day.slice(0,4)}`;
  for(const symbol of [...symbols].sort(order)){
    for(const basis of ['split_adjusted','raw'] as const){
      if(halted)break;
      const request={action:'history',symbol:symbol.slice(4),interval:'daily',startdate:mmdd(start),enddate:mmdd(asOfSession),
        splitadjusted:basis==='split_adjusted'?'1':'0',unadjusted:basis==='raw'?'1':'0'};
      const url=new URL('https://api.kibot.com/');for(const [k,v]of Object.entries(request))url.searchParams.set(k,v);
      // Public evaluation login only; never retain its URL or authentication query in a record/log.
      url.searchParams.set('user','guest');url.searchParams.set('password','guest');
      const got=await fetch(url.href,symbol,basis);if(!got)continue;
      try{
        const rows=parseForwardStockCsv(got.text,start,asOfSession);
        bundle.records.push({symbol,vendorTicker:request.symbol,basis,sourceId:`kibot_guest_evaluation_${basis}_v1`,request,
          observedAt:got.observedAt,sha256:sha(got.text),rows,rawCsv:got.text,sourceUrl:'https://api.kibot.com/',bytes:Buffer.byteLength(got.text,'utf8'),http:200});
        consecutive=0;
      }catch(cause){invalid(symbol,basis,cause);}
    }
    if(halted)break;
  }
  if(!halted){
    const url=new URL('https://fred.stlouisfed.org/graph/fredgraph.csv');url.searchParams.set('id','SP500');url.searchParams.set('cosd',start);url.searchParams.set('coed',asOfSession);
    const got=await fetch(url.href,'SP500','index');
    if(got)try{
      const parsed=parseForwardIndexCsv(got.text,start,asOfSession);
      bundle.market={series:'SP500',basis:'index',sourceId:'fred_sp500_forward_evaluation_v1',sourceUrl:url.href,
        observedAt:got.observedAt,sha256:sha(got.text),rawCsv:got.text,...parsed};consecutive=0;
    }catch(cause){invalid('SP500','index',cause);}
  }
  bundle.observedAt=now().toISOString();bundle.complete=!halted&&missingForwardSourceSymbols(bundle,symbols).length===0&&bundle.market!==undefined;
  return bundle;
}

/** Pure mapping. Source labels never promote an observation to live eligibility. */
export function brkQuarantineRequiresReview(bundle:ForwardSourceBundle):boolean {return /(?:known_or_unclassified_action_requires_reconciliation|unreviewed_material_filing|source_verification_pending|prior_conflict_requires_review)$/.test(bundle.nonPriceEvidence?.quarantine?.reason??'');}
/** Negative evidence is an append-only snapshot; originals remain in prior archives and the explicit reference. */
export function quarantineForwardBrkEvidence(bundle:ForwardSourceBundle,reference:ForwardStockSource,reason:string,rawJson:string,observedAt:string):ForwardSourceBundle {
 return {...bundle,complete:false,observedAt,records:bundle.records.filter(r=>r.symbol!==BRK_PAIR_SYMBOL),nonPriceEvidence:{brkContinuityReference:reference,quarantine:{reason,observedAt,rawJson,sha256:sha(rawJson)}},failures:[...bundle.failures,{symbol:BRK_PAIR_SYMBOL,basis:'split_adjusted',errorCode:reason}]};
}
/** Pair records are atomic and regenerated from the same whole evidence envelope. */
export function validateForwardBrkPair(bundle:ForwardSourceBundle,calendar:readonly ForwardCalendarSession[],required=false,knownAt=bundle.observedAt):void {
 if(bundle.nonPriceEvidence?.quarantine)throw Error('forward_pair_quarantined_evidence');
 const records=bundle.records.filter(r=>r.sourceId.startsWith(BRK_PAIR_SOURCE_ID));
 if(!records.length){if(required)throw Error('forward_pair_required');return;}
 if(records.length!==2||records.some(r=>r.probe===true||r.symbol!==BRK_PAIR_SYMBOL||r.sourceId!==BRK_PAIR_SOURCE_ID+'_'+r.basis||r.vendorTicker!=='BRK.B'||r.sourceUrl!==BRK_ALPACA_URL||r.rawCsv!==undefined||r.sourceUse!=='evaluation_only'||r.liveEligible!==false||JSON.stringify(r.request)!==JSON.stringify({provider:'alpaca_sip_brk_pair_v1'}))||new Set(records.map(r=>r.basis)).size!==2||records[0].rawJson!==records[1].rawJson||!records[0].rawJson)throw Error('forward_pair_contract_invalid');
 const checked=validateBrkPairEnvelope(records[0].rawJson,{start:bundle.dateWindow.start,end:bundle.asOfSession,now:knownAt,calendar});
 for(const record of records)if(record.sha256!==checked.sha256||record.observedAt!==checked.observedAt||JSON.stringify(record.rows)!==JSON.stringify(record.basis==='raw'?checked.raw:checked.split))throw Error('forward_pair_rows_mismatch');
 if(bundle.records.filter(r=>r.symbol===BRK_PAIR_SYMBOL&&!r.probe).length!==2)throw Error('forward_pair_duplicate_variant');
}
export function mapForwardSources(
  bundle:ForwardSourceBundle,calendar:readonly ForwardCalendarSession[],knownAt=bundle.observedAt,
):{data:ForwardInputData;opens:RawOpen[]} {
 return inspectForwardSources(bundle,calendar,knownAt,true);
}
/** Run the same full validation, retaining only the index bars used by readiness. */
export function validateForwardSources(
 bundle:ForwardSourceBundle,calendar:readonly ForwardCalendarSession[],knownAt=bundle.observedAt,
):readonly ForwardPriceBar[] {
 return inspectForwardSources(bundle,calendar,knownAt,false).data.sp500Bars;
}
function inspectForwardSources(
 bundle:ForwardSourceBundle,calendar:readonly ForwardCalendarSession[],knownAt:string,materializeStockData:boolean,
):{data:ForwardInputData;opens:RawOpen[]} {
  const asOfSession=bundle.asOfSession??bundle.dateWindow?.end;
  if(bundle.schemaVersion!==1||!validForwardSessionDate(asOfSession)||!Array.isArray(bundle.records)
    ||!validForwardSessionDate(bundle.dateWindow?.start)||!validForwardSessionDate(bundle.dateWindow?.end)
    ||bundle.dateWindow.start>bundle.dateWindow.end||bundle.dateWindow.end!==asOfSession)return error('forward_source_bundle_invalid');
  validateForwardBrkPair(bundle,calendar,false,knownAt);
  const sessions=new Map(calendar.map(s=>[s.session,s])),members=materializeStockData?new Map<string,Omit<ForwardMemberData,'splitBars'> & {splitBars:ForwardPriceBar[]}>():null,seen=new Set<string>(),opens:RawOpen[]|null=materializeStockData?[]:null;
  function checkedPrice(session:string,value:string,observedAt:string,sourceId:string,digest:string,variant:'split_only'|'raw'|'index',materialize=true):ForwardPriceBar|undefined {
    if(!validForwardSessionDate(session)||session>asOfSession||!positive(value)||!SHA.test(digest)||!sourceId.trim())return error('forward_source_observation_invalid');
    const observed=utc(observedAt),close=sessions.get(session)?.closeAt;
    const parsedClose=Number(value),final=close!==undefined&&utc(close)<=observed;
    if(!materialize)return;
    return {session,close:parsedClose,final,
      observedAt,sourceId,sourceVariant:variant,sha256:digest,currency:variant==='index'?'INDEX':'USD',qualification:'evaluation_only'};
  }
  for(const record of bundle.records){
    if(record.probe===true)continue;
    const isPair=record?.sourceId.startsWith(BRK_PAIR_SOURCE_ID);
    if(!record||!SYMBOL.test(record.symbol)||!Array.isArray(record.rows)||typeof record.sourceId!=='string'||record.vendorTicker!==record.symbol.slice(4)||!['split_adjusted','raw'].includes(record.basis)
      ||(!isPair&&!record.sourceId.startsWith(`kibot_guest_evaluation_${record.basis}_`)))return error('forward_source_stock_contract_invalid');
    const p=record.request;
    if(!isPair&&(!p||p.action!=='history'||typeof p.interval!=='string'||p.interval.toLowerCase()!=='daily'||p.symbol!==record.vendorTicker
      ||p.splitadjusted!==(record.basis==='split_adjusted'?'1':'0')||p.unadjusted!==(record.basis==='raw'?'1':'0')
      ||Object.keys(p).some(key=>!['action','symbol','interval','startdate','enddate','splitadjusted','unadjusted','type'].includes(key))
      ||(p.type!==undefined&&p.type!=='stocks')))return error('forward_source_stock_contract_invalid');
    if(record.sourceUrl&&!isPair){const endpoint=stockEndpoint(record.sourceUrl);if(endpoint.search)return error('forward_source_url_invalid');}
    const key=`${record.symbol}:${record.basis}`;if(seen.has(key))return error('forward_source_duplicate_variant');seen.add(key);
    if(record.rawCsv!==undefined){
      if(sha(record.rawCsv)!==record.sha256)return error('forward_source_hash_mismatch');
      const parsed=parseForwardStockCsv(record.rawCsv,bundle.dateWindow.start,bundle.dateWindow.end);
      if(JSON.stringify(parsed)!==JSON.stringify(record.rows))return error('forward_source_rows_mismatch');
    }
    let last='';for(const row of record.rows){
      if(row.session<=last)return error('forward_source_duplicate_or_unordered_rows');last=row.session;
      // Validate full shape even when a trusted archive supplies parsed rows without inline CSV.
      if([row.open,row.high,row.low,row.close].some(v=>typeof v!=='string'||!positive(v))||typeof row.volume!=='string'||!/^\d+$/.test(row.volume)
        ||Number(row.low)>Math.min(Number(row.open),Number(row.close))||Number(row.high)<Math.max(Number(row.open),Number(row.close)))return error('forward_source_observation_invalid');
      const price=checkedPrice(row.session,row.close,record.observedAt,record.sourceId,record.sha256,record.basis==='raw'?'raw':'split_only',materializeStockData);
      if(!price)continue;
      let member=members!.get(record.symbol);if(!member){member={symbol:record.symbol,splitBars:[]};members!.set(record.symbol,member);}
      if(record.basis==='split_adjusted')member.splitBars.push(price);
      else {
        if(row.session===asOfSession){const {close,...quote}=price;member.rawQuote={...quote,price:close};}
        opens!.push({symbol:record.symbol,session:row.session,open:Number(row.open),observedAt:record.observedAt,sha256:record.sha256});
      }
    }
  }
  let sp500Bars:ForwardPriceBar[]=[];
  if(bundle.market){
    const market=bundle.market;
    if((market.series!==undefined&&market.series!=='SP500')||(market.basis!==undefined&&market.basis!=='index'))return error('forward_source_index_contract_invalid');
    if(market.sourceId===KIS_SP500_SOURCE_ID){
      if(market.sourceUrl!==KIS_SP500_SOURCE_URL||!market.rawJson||market.rawCsv!==undefined
        ||market.sourceUse!=='evaluation_only'||market.liveEligible!==false)return error('forward_source_index_contract_invalid');
      const checked=validateKisIndexEnvelope(market.rawJson,{start:bundle.dateWindow.start,end:asOfSession,now:bundle.observedAt,calendar});
      if(checked.sha256!==market.sha256||checked.observedAt!==market.observedAt)return error('forward_source_hash_mismatch');
      if(JSON.stringify(checked.rows)!==JSON.stringify(market.rows))return error('forward_source_rows_mismatch');
    }else{
      indexEndpoint(market.sourceUrl);
      if(market.rawJson!==undefined)return error('forward_source_index_contract_invalid');
    }
    if(market.rawCsv!==undefined){
      if(sha(market.rawCsv)!==market.sha256)return error('forward_source_hash_mismatch');
      const parsed=parseForwardIndexCsv(market.rawCsv,bundle.dateWindow.start,bundle.dateWindow.end);
      if(JSON.stringify(parsed.rows)!==JSON.stringify(market.rows))return error('forward_source_rows_mismatch');
    }
    let last='';sp500Bars=market.rows.map(row=>{
      if(row.session<=last)return error('forward_source_duplicate_or_unordered_rows');last=row.session;
      return checkedPrice(row.session,row.close,market.observedAt,market.sourceId,market.sha256,'index')!;
    });
  }
  return {data:{asOfSession,calendar,members:members?[...members.values()].sort((a,b)=>order(a.symbol,b.symbol)):[],sp500Bars},
    opens:opens?opens.sort((a,b)=>order(a.session,b.session)||order(a.symbol,b.symbol)):[]};
}

/** Readiness includes the entire canonical index history, not merely yesterday's row. */
export function hasRequiredForwardIndexHistory(bundle:ForwardSourceBundle,calendar:readonly ForwardCalendarSession[]):boolean {
 try{
  const bars=mapForwardSources({...bundle,records:[]},calendar).data.sp500Bars;
  if(bars.some(bar=>!bar.final))return false;
  const days=calendar.filter(day=>day.session<=bundle.asOfSession),prior=days.at(-2)?.session;
  const latest=bars.filter(bar=>bar.final&&bar.session<=bundle.asOfSession).at(-1)?.session;
  if(!latest||!prior||latest<prior)return false;
  const required=days.filter(day=>day.session<=latest).slice(-253);
  return required.length===253&&required.every(day=>bars.some(bar=>bar.session===day.session&&bar.final));
 }catch{return false;}
}
/** Validate the exact bundle consumed, not a prior readiness query's latest record. */
export function assertForwardSourceReadiness(bundle:ForwardSourceBundle,calendar:readonly ForwardCalendarSession[],symbols:readonly string[],basisSessions:readonly string[]=[],knownAt=bundle.observedAt):void {
 validateForwardBrkPair(bundle,calendar,symbols.includes(BRK_PAIR_SYMBOL),knownAt);
 const indexBars=validateForwardSources(bundle,calendar,knownAt);
 if(!hasRequiredForwardIndexHistory(bundle,calendar))throw Error('forward_source_index_history_incomplete');
 const indexEnd=indexBars.at(-1)?.session;
 const required=requiredForwardSourceSessions(calendar,bundle.asOfSession,basisSessions,indexEnd);
 if(missingForwardSourceSymbols(bundle,symbols,required).length)throw Error('forward_source_stock_history_incomplete');
}
/** 253 joint price observations plus the current stock mark (254 if index lags). */
export function requiredForwardSourceSessions(calendar:readonly ForwardCalendarSession[],asOf:string,basisSessions:readonly string[]=[],indexEnd?:string):string[] {
 const completed=calendar.filter(day=>day.session<=asOf);
 const end=indexEnd??completed.at(-2)?.session??asOf;
 return [...new Set([...completed.filter(day=>day.session<=end).slice(-253).map(day=>day.session),asOf,...basisSessions])];
}
/** Retry either missing variant; a successful raw response cannot mask a lost split response. */
export function missingForwardSourceSymbols(bundle:ForwardSourceBundle,symbols:readonly string[],requiredSessions:readonly string[]=[bundle.asOfSession]):string[] {
 return symbols.filter(symbol=>(['raw','split_adjusted'] as const).some(basis=>
  !bundle.records.some(r=>!r.probe&&r.symbol===symbol&&r.basis===basis&&r.rows.at(-1)?.session===bundle.asOfSession
    &&requiredSessions.every(session=>r.rows.some(row=>row.session===session)))));
}
/** Replace retried variants by identity without making duplicate members. Failed attempts remain evidence. */
export function mergeForwardSources(bundle:ForwardSourceBundle,extra:ForwardSourceBundle,symbols:readonly string[]):ForwardSourceBundle {
 if(bundle.asOfSession!==extra.asOfSession)throw Error('forward_source_merge_session_mismatch');
 const records=new Map(bundle.records.map(r=>[r.symbol+'|'+r.basis,r]));
 for(const row of extra.records){
  if(row.probe)continue;
  const key=row.symbol+'|'+row.basis,old=records.get(key);
  // A retry may repair one basis while returning a stale/shorter other basis.
  // Preserve whole originals: never splice rows from different adjustment vintages.
  const oldLast=old?.rows.at(-1)?.session??'',newLast=row.rows.at(-1)?.session??'';
  if(!old||((newLast>oldLast||(newLast===oldLast&&row.observedAt>=old.observedAt))
    &&old.rows.every(previous=>row.rows.some(next=>next.session===previous.session))))records.set(key,row);
 }
 const oldLast=bundle.market?.rows.at(-1)?.session??'',newLast=extra.market?.rows.at(-1)?.session??'';
 const market=extra.market&&newLast>=oldLast&&(!bundle.market||
  ((newLast>oldLast||extra.market.observedAt>=bundle.market.observedAt
    ||bundle.market.rows.every(previous=>extra.market!.rows.some(next=>next.session===previous.session&&canonicalIndexDecimal(next.close)===canonicalIndexDecimal(previous.close))))
   &&bundle.market.rows.every(previous=>extra.market!.rows.some(next=>next.session===previous.session))))?extra.market:bundle.market;
 const merged={...bundle,records:[...records.values()],market,failures:[...bundle.failures,...extra.failures],
  observedAt:extra.observedAt>bundle.observedAt?extra.observedAt:bundle.observedAt};
 return {...merged,complete:missingForwardSourceSymbols(merged,symbols).length===0&&!!market};
}

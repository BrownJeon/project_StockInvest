/** Evaluation-only public observations. No DB, account, order or credential-store access. */
import { createHash } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { performance } from 'node:perf_hooks';
import { normalizeForwardUtc, validForwardSessionDate } from './forward-calendar';
import type { ForwardCalendarSession, ForwardInputData, ForwardMemberData, ForwardPriceBar } from './forward-types';
import type { RawOpen } from './paper-ledger';

export interface ForwardCsvBar { session:string; open:string; high:string; low:string; close:string; volume:string }
export interface ForwardStockSource {
  symbol:string; vendorTicker:string; basis:'split_adjusted'|'raw'; sourceId:string;
  request:Record<string,string>; observedAt:string; sha256:string; rows:ForwardCsvBar[];
  rawCsv?:string; sourceUrl?:string; file?:string; bytes?:number; http?:number; probe?:boolean;
}
export interface ForwardIndexSource {
  sourceId:string; sourceUrl:string; observedAt:string; sha256:string;
  rows:{session:string;close:string}[]; basis?:'index'; series?:'SP500'; rawCsv?:string; missingSessions?:string[];
}
export interface ForwardSourceFailure {
  symbol?:string; basis?:'split_adjusted'|'raw'|'index'; errorCode:string; sourceId?:string;
}
export interface ForwardSourceBundle {
  schemaVersion:1; asOfSession:string; observedAt:string; dateWindow:{start:string;end:string};
  records:ForwardStockSource[]; market?:ForwardIndexSource; failures:ForwardSourceFailure[];
  complete:boolean; sourceUse:string; kind?:string;
}
export interface ForwardFetchOptions { timeoutMs:number; maxBytes:number }
export interface ForwardFetchResponse { status:number; text:string }
export interface ForwardSourceDependencies {
  fetchText?:(url:string,options:ForwardFetchOptions)=>Promise<ForwardFetchResponse>;
  now?:()=>Date; sleep?:(milliseconds:number)=>Promise<void>; monotonicMs?:()=>number;
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
export function fetchForwardPublicText(urlText:string,options:ForwardFetchOptions):Promise<ForwardFetchResponse> {
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
    const remaining=()=>FORWARD_COLLECTION_LIMITS.deadlineMs-(clock()-began);
    try{
      if(halted||requests>=FORWARD_COLLECTION_LIMITS.requests||remaining()<=0)return error('forward_source_deadline');
      if(lastStart!==null){const pause=Math.max(0,FORWARD_COLLECTION_LIMITS.requestSpacingMs-(clock()-lastStart));if(pause>=remaining())return error('forward_source_deadline');if(pause)await sleep(pause);}
      if(remaining()<=0)return error('forward_source_deadline');
      lastStart=clock();requests++;
      const response=await fetchText(url,{timeoutMs:Math.min(FORWARD_COLLECTION_LIMITS.timeoutMs,remaining()),maxBytes:FORWARD_COLLECTION_LIMITS.responseBytes});
      const bytes=Buffer.byteLength(response.text,'utf8');totalBytes+=bytes;
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
  bundle.observedAt=now().toISOString();bundle.complete=!halted&&bundle.records.length===symbols.length*2&&bundle.market!==undefined;
  return bundle;
}

/** Pure mapping. Source labels never promote an observation to live eligibility. */
export function mapForwardSources(
  bundle:ForwardSourceBundle,calendar:readonly ForwardCalendarSession[],
):{data:ForwardInputData;opens:RawOpen[]} {
  const asOfSession=bundle.asOfSession??bundle.dateWindow?.end;
  if(bundle.schemaVersion!==1||!validForwardSessionDate(asOfSession)||!Array.isArray(bundle.records)
    ||!validForwardSessionDate(bundle.dateWindow?.start)||!validForwardSessionDate(bundle.dateWindow?.end)
    ||bundle.dateWindow.start>bundle.dateWindow.end||bundle.dateWindow.end!==asOfSession)return error('forward_source_bundle_invalid');
  const sessions=new Map(calendar.map(s=>[s.session,s])),members=new Map<string,ForwardMemberData>(),seen=new Set<string>(),opens:RawOpen[]=[];
  function checkedPrice(session:string,value:string,observedAt:string,sourceId:string,digest:string,variant:'split_only'|'raw'|'index'):ForwardPriceBar {
    if(!validForwardSessionDate(session)||session>asOfSession||!positive(value)||!SHA.test(digest)||!sourceId.trim())return error('forward_source_observation_invalid');
    const observed=utc(observedAt),close=sessions.get(session)?.closeAt;
    return {session,close:Number(value),final:close!==undefined&&utc(close)<=observed,
      observedAt,sourceId,sourceVariant:variant,sha256:digest,currency:variant==='index'?'INDEX':'USD',qualification:'evaluation_only'};
  }
  for(const record of bundle.records){
    if(record.probe===true)continue;
    if(!record||!SYMBOL.test(record.symbol)||!Array.isArray(record.rows)||typeof record.sourceId!=='string'||record.vendorTicker!==record.symbol.slice(4)||!['split_adjusted','raw'].includes(record.basis)
      ||!record.sourceId.startsWith(`kibot_guest_evaluation_${record.basis}_`))return error('forward_source_stock_contract_invalid');
    const p=record.request;
    if(!p||p.action!=='history'||typeof p.interval!=='string'||p.interval.toLowerCase()!=='daily'||p.symbol!==record.vendorTicker
      ||p.splitadjusted!==(record.basis==='split_adjusted'?'1':'0')||p.unadjusted!==(record.basis==='raw'?'1':'0')
      ||Object.keys(p).some(key=>!['action','symbol','interval','startdate','enddate','splitadjusted','unadjusted','type'].includes(key))
      ||(p.type!==undefined&&p.type!=='stocks'))return error('forward_source_stock_contract_invalid');
    if(record.sourceUrl){const endpoint=stockEndpoint(record.sourceUrl);if(endpoint.search)return error('forward_source_url_invalid');}
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
      const price=checkedPrice(row.session,row.close,record.observedAt,record.sourceId,record.sha256,record.basis==='raw'?'raw':'split_only');
      let member=members.get(record.symbol);if(!member){member={symbol:record.symbol,splitBars:[]};members.set(record.symbol,member);}
      if(record.basis==='split_adjusted')member.splitBars=[...member.splitBars,price];
      else {
        if(row.session===asOfSession){const {close,...quote}=price;member.rawQuote={...quote,price:close};}
        opens.push({symbol:record.symbol,session:row.session,open:Number(row.open),observedAt:record.observedAt,sha256:record.sha256});
      }
    }
  }
  let sp500Bars:ForwardPriceBar[]=[];
  if(bundle.market){
    const market=bundle.market;indexEndpoint(market.sourceUrl);
    if((market.series!==undefined&&market.series!=='SP500')||(market.basis!==undefined&&market.basis!=='index'))return error('forward_source_index_contract_invalid');
    if(market.rawCsv!==undefined){
      if(sha(market.rawCsv)!==market.sha256)return error('forward_source_hash_mismatch');
      const parsed=parseForwardIndexCsv(market.rawCsv,bundle.dateWindow.start,bundle.dateWindow.end);
      if(JSON.stringify(parsed.rows)!==JSON.stringify(market.rows))return error('forward_source_rows_mismatch');
    }
    let last='';sp500Bars=market.rows.map(row=>{
      if(row.session<=last)return error('forward_source_duplicate_or_unordered_rows');last=row.session;
      return checkedPrice(row.session,row.close,market.observedAt,market.sourceId,market.sha256,'index');
    });
  }
  return {data:{asOfSession,calendar,members:[...members.values()].sort((a,b)=>order(a.symbol,b.symbol)),sp500Bars},
    opens:opens.sort((a,b)=>order(a.session,b.session)||order(a.symbol,b.symbol))};
}

/** Retry either missing variant; a successful raw response cannot mask a lost split response. */
export function missingForwardSourceSymbols(bundle:ForwardSourceBundle,symbols:readonly string[]):string[] {
 return symbols.filter(symbol=>(['raw','split_adjusted'] as const).some(basis=>
  !bundle.records.some(r=>r.symbol===symbol&&r.basis===basis&&r.rows.at(-1)?.session===bundle.asOfSession)));
}
/** Replace retried variants by identity without making duplicate members. Failed attempts remain evidence. */
export function mergeForwardSources(bundle:ForwardSourceBundle,extra:ForwardSourceBundle,symbols:readonly string[]):ForwardSourceBundle {
 if(bundle.asOfSession!==extra.asOfSession)throw Error('forward_source_merge_session_mismatch');
 const records=new Map(bundle.records.map(r=>[r.symbol+'|'+r.basis,r]));
 for(const row of extra.records)records.set(row.symbol+'|'+row.basis,row);
 const oldLast=bundle.market?.rows.at(-1)?.session??'',newLast=extra.market?.rows.at(-1)?.session??'';
 const market=extra.market&&newLast>=oldLast?extra.market:bundle.market;
 const merged={...bundle,records:[...records.values()],market,failures:[...bundle.failures,...extra.failures],
  observedAt:extra.observedAt>bundle.observedAt?extra.observedAt:bundle.observedAt};
 return {...merged,complete:missingForwardSourceSymbols(merged,symbols).length===0&&!!market};
}

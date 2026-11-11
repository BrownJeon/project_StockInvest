/** Optional evaluation-only BRK.B pair. Data GETs only; never refreshes KIS tokens. */
import {BRK_CA_URL,BRK_SEC_URL,brkCaRequest,brkNyDate,validateBrkCaPages,BRK_MATERIAL_REVIEW,brkMaterialReviewSha,BRK_EVENT_LIMITATION} from './forward-stock-events';
import { performance } from 'node:perf_hooks';
import { request } from 'node:https';
import { constants } from 'node:fs';
import { open,lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join,dirname } from 'node:path';
import {SecClient,readSecUserAgent} from '@/lib/data/us-edgar/sec-client';
import {kisFetch,kisBodyText} from '@/lib/exchanges/kis-http';
import { getCredential } from '@/lib/credentials';
import type { ArchiveQueryable } from '@/lib/analysis-data/types';
import type { ForwardCalendarSession } from './forward-types';
import type { ForwardStockSource } from './forward-sources';
import { ForwardCollectionBudget } from './forward-collection-budget';
import { BRK_FIELD_QUALIFICATION,BRK_PAIR_SOURCE_ID,BRK_PAIR_SYMBOL,BRK_ALPACA_URL,BRK_KIS_URL,BRK_MASTER_SHA,brkAlpacaRequest,stockEvidenceSha,validateBrkPairEnvelope,type BrkPairEnvelope,type BrkEvidencePage } from './forward-stock-contract';
const fail=(code:string):never=>{throw Error('forward_pair_'+code);};
const masterPath=()=>process.env.M40_BRK_KIS_MASTER_FILE||join(homedir(),'.stockinvest-market-data','NYSMST-20261101.COD');
export const brkPairConfigured=()=>Boolean(process.env.M40_BRK_ALPACA_KEY_FILE?.startsWith('/'));
export async function brkPairProfileReady():Promise<boolean>{try{if(!brkPairConfigured())return false;await readProtectedBrkKeyFile(process.env.M40_BRK_ALPACA_KEY_FILE!);return true;}catch{return false;}}
/** Trusted operator owns parent directories. No defense against an adversarial concurrent ancestor rename. */
export async function readProtectedBrkKeyFile(path:string):Promise<{key:string;secret:string}>{
 if(!path.startsWith('/'))return fail('profile_invalid');
 for(let p=dirname(path);;p=dirname(p)){const s=await lstat(p);if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o022)||![0,process.getuid?.()??-1].includes(s.uid))return fail('profile_invalid');if(p==='/')break;}
 const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=await f.stat();if(!s.isFile()||s.uid!==(process.getuid?.()??-1)||(s.mode&0o777)!==0o600||s.size>4096)return fail('profile_invalid');const bytes=await f.readFile();if(bytes.length>4096)return fail('profile_invalid');const values:Record<string,string>={};for(const line of bytes.toString('utf8').split(/\r?\n/)){if(!line.trim()||line.trim().startsWith('#'))continue;const m=/^(APCA_API_KEY_ID|APCA_API_SECRET_KEY)=([A-Za-z0-9_-]{8,256})$/.exec(line);if(!m||values[m[1]])return fail('profile_invalid');values[m[1]]=m[2];}if(Object.keys(values).length!==2)return fail('profile_invalid');return {key:values.APCA_API_KEY_ID,secret:values.APCA_API_SECRET_KEY};}finally{await f.close();}
}
export interface BrkPairDependencies {now?:()=>Date;monotonicMs?:()=>number;fetchPage?:(url:string,headers:Record<string,string>,budget:ForwardCollectionBudget,signal?:AbortSignal)=>Promise<{http:number;rawJson:string;retryAfterSeconds?:number}>;readKeys?:()=>Promise<{key:string;secret:string}>;readMaster?:()=>Promise<Buffer>;credential?:(key:string)=>Promise<string|null>}
/** Credentials may cross only their single explicitly approved provider boundary. */
export function assertBrkDataHeaders(url:string,headers:Record<string,string>):void {
 const u=new URL(url);let allowed:string[]=[];
 if([BRK_ALPACA_URL,BRK_CA_URL].includes(u.origin+u.pathname))allowed=['APCA-API-KEY-ID','APCA-API-SECRET-KEY'];
 else if(u.origin+u.pathname===BRK_KIS_URL){allowed=['authorization','appkey','appsecret','tr_id','custtype'];if(headers.tr_id!=='HHDFS76240000'||headers.custtype!=='P')return fail('headers_invalid');}
 else if(u.origin+u.pathname===BRK_SEC_URL){allowed=['User-Agent'];if(headers['User-Agent']!==readSecUserAgent())return fail('headers_invalid');}
 else return fail('endpoint_invalid');
 if(u.username||u.password||u.hash||Object.keys(headers).length!==allowed.length||allowed.some(key=>typeof headers[key]!=='string'||!headers[key]||/[\r\n]/.test(headers[key]))||Object.keys(headers).some(key=>!allowed.includes(key)))return fail('headers_invalid');
}
async function fetchData(url:string,headers:Record<string,string>,budget:ForwardCollectionBudget,signal?:AbortSignal):Promise<{http:number;rawJson:string;retryAfterSeconds?:number}>{
 assertBrkDataHeaders(url,headers);
 const u=new URL(url);if(![BRK_ALPACA_URL,BRK_KIS_URL,BRK_CA_URL,BRK_SEC_URL].some(base=>u.origin+u.pathname===base)||u.username||u.password)return fail('endpoint_invalid');
 if(signal?.aborted)return fail('deadline');
 const timeoutMs=await budget.reserve(20000),maxBytes=budget.responseLimit();
 if(u.origin+u.pathname===BRK_KIS_URL){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{const response=await kisFetch(u.href,{method:'GET',redirect:'error',signal:controller.signal,headers},{priority:'bulk',timeoutMs:Math.max(1,Math.floor(Math.min(10000,timeoutMs))),maxWaitMs:Math.max(1,Math.floor(Math.min(5000,timeoutMs))),rateLimitRetries:0,transientRetries:0,maxResponseBytes:maxBytes,bodyDeadlineMs:timeoutMs,label:'m40ForwardBrkPairRawProof'});
   const rawJson=kisBodyText(response)??await response.text();budget.consume(Buffer.byteLength(rawJson));if(response.status!==200)return fail('http_rejected');return {http:response.status,rawJson};
  }finally{clearTimeout(timer);controller.abort();}
 }

 return new Promise((resolve,reject)=>{let ended=false;const done=(error?:string,value?:{http:number;rawJson:string;retryAfterSeconds?:number})=>{if(ended)return;ended=true;clearTimeout(timer);if(error)reject(Error('forward_pair_'+error));else resolve(value!);};
 const req=request(u,{signal,method:'GET',rejectUnauthorized:true,headers:{...headers,'Accept':'application/json','Accept-Encoding':'identity','User-Agent':headers['User-Agent']??'StockInvest-Evaluation/0.4.0'}},res=>{let bytes=0;const chunks:Buffer[]=[];res.on('data',(chunk:Buffer)=>{bytes+=chunk.length;try{budget.consume(chunk.length);}catch{done('budget_exhausted');req.destroy();return;}if(bytes>maxBytes){done('body_limit');req.destroy();return;}chunks.push(chunk);});res.on('error',()=>done('transport_failed'));res.on('end',()=>{if(res.statusCode!==200){if(u.origin+u.pathname===BRK_SEC_URL){const retry=res.headers['retry-after'];const retryAfterSeconds=typeof retry==='string'&&/^\d{1,15}$/.test(retry)&&Number.isSafeInteger(Number(retry))?Number(retry):undefined;done(undefined,{http:res.statusCode??0,rawJson:'',retryAfterSeconds});return;}done('http_rejected');return;}if(res.headers['content-encoding']&&res.headers['content-encoding']!=='identity'){done('encoding_invalid');return;}done(undefined,{http:res.statusCode,rawJson:Buffer.concat(chunks).toString('utf8')});});});const timer=setTimeout(()=>{done('deadline');req.destroy();},timeoutMs);req.on('error',()=>done('transport_failed'));req.end();});
}
export async function collectBrkCoherentPair(options:{start:string;end:string;calendar:readonly ForwardCalendarSession[];kibotSplit:ForwardStockSource;budget:ForwardCollectionBudget;db:ArchiveQueryable},deps:BrkPairDependencies={}):Promise<ForwardStockSource[]>{
 if(typeof window!=='undefined'||String(process.env.KIS_MOCK??'true').toLowerCase()!=='false')return fail('environment_ineligible');
 const now=deps.now??(()=>new Date()),budget=options.budget,fetch=deps.fetchPage??fetchData;
 const monotonic=deps.monotonicMs??(()=>performance.now()),startMono=monotonic(),startWall=now().getTime();let lastMono=startMono,lastWall=startWall;
 const checkedClock=()=>{const mono=monotonic(),wall=now().getTime();if(!Number.isFinite(mono)||!Number.isFinite(wall)||mono<lastMono||wall<lastWall||Math.abs((wall-startWall)-(mono-startMono))>1000)return fail('clock_invalid');lastMono=mono;lastWall=wall;return new Date(wall).toISOString();};
 budget.remaining();const credentials=await (deps.readKeys??(()=>readProtectedBrkKeyFile(process.env.M40_BRK_ALPACA_KEY_FILE??'')))();budget.remaining();
 const f=deps.readMaster?null:await open(masterPath(),constants.O_RDONLY|constants.O_NOFOLLOW);let master:Buffer;
 try{if(f){const stat=await f.stat();if(!stat.isFile()||stat.size>512*1024)return fail('master_invalid');master=await f.readFile();}else master=await deps.readMaster!();}finally{if(f)await f.close();}
 if(stockEvidenceSha(master)!==BRK_MASTER_SHA)return fail('master_invalid');
 const envelope:BrkPairEnvelope={clockMeaning:'whole_evidence_ready_not_first_provider_receipt',fieldQualification:BRK_FIELD_QUALIFICATION,schemaVersion:1,sourceId:BRK_PAIR_SOURCE_ID,symbol:BRK_PAIR_SYMBOL,currency:'USD',sourceUse:'evaluation_only',liveEligible:false,dateWindow:{start:options.start,end:options.end},events:{queryDate:brkNyDate(now().toISOString()),alpaca:[],sec:null,reviewManifest:BRK_MATERIAL_REVIEW,reviewManifestSha256:brkMaterialReviewSha(),assessment:'no_conflicts_reported_asof',completeHistoryGuaranteed:false,limitation:BRK_EVENT_LIMITATION},observedAt:'',master:{sha256:BRK_MASTER_SHA,rawBase64:master.toString('base64')},alpaca:{raw:[],split:[]},kis:[],kibotSplit:options.kibotSplit};
 const secretValues=new Set([credentials.key,credentials.secret]),rejectedReceipts:{http:number;sha256:string;bodyOmitted:true}[]=[];
 const rejectSecretEcho=(rawJson:string,http:number)=>{if([...secretValues].some(value=>value.length>=8&&rawJson.includes(value))){rejectedReceipts.push({http,sha256:stockEvidenceSha(rawJson),bodyOmitted:true});return fail('response_credential_echo');}};
 try{
 const userAgent=readSecUserAgent();if(!userAgent)return fail('sec_user_agent_unconfigured');secretValues.add(userAgent);
 const page=async(base:string,params:Record<string,string>,headers:Record<string,string>,token?:string):Promise<BrkEvidencePage>=>{assertBrkDataHeaders(base,headers);checkedClock();budget.remaining();if(deps.fetchPage)await budget.reserve(20000);const u=new URL(base);u.search=new URLSearchParams(params).toString();const response=await fetch(u.href,headers,budget);if(deps.fetchPage)budget.consume(Buffer.byteLength(response.rawJson));budget.remaining();if(response.http!==200)return fail('http_rejected');rejectSecretEcho(response.rawJson,response.http);const observedAt=checkedClock();return {request:[BRK_ALPACA_URL,BRK_CA_URL].includes(base)?Object.fromEntries(Object.entries(params).filter(([key])=>key!=='page_token')):params,http:response.http,observedAt,rawJson:response.rawJson,sha256:stockEvidenceSha(response.rawJson),...([BRK_ALPACA_URL,BRK_CA_URL].includes(base)?{requestTokenSha256:token?stockEvidenceSha(token):null}:{})};};
 if(Date.parse(brkAlpacaRequest(options.start,options.end,'raw').end)+15*60000>now().getTime())return fail('historical_window_not_elapsed');
 for(const basis of ['raw','split'] as const){let token:string|undefined;const seen=new Set<string>();for(let n=0;n<3;n++){const p=await page(BRK_ALPACA_URL,brkAlpacaRequest(options.start,options.end,basis,token),{'APCA-API-KEY-ID':credentials.key,'APCA-API-SECRET-KEY':credentials.secret},token);envelope.alpaca[basis].push(p);const body=JSON.parse(p.rawJson);if(body.next_page_token===null)break;if(typeof body.next_page_token!=='string'||!body.next_page_token||seen.has(body.next_page_token))return fail('pagination_invalid');token=body.next_page_token;seen.add(token!);if(n===2)return fail('pagination_limit');}}
 // Existing cached authorization only: no getKisToken(), token issue/refresh or DB write path.
 const [rows]=await options.db.query<Record<string,unknown>[]>("SELECT value FROM system_config WHERE `key`='kis_access_token' LIMIT 1");
 const cached=typeof rows[0]?.value==='string'?JSON.parse(rows[0].value):rows[0]?.value;
 if(!cached||typeof cached.access_token!=='string'||!cached.access_token||typeof cached.expires_at!=='number'||cached.expires_at<=now().getTime()+budget.remaining())return fail('cached_authorization_unavailable');
 const credential=deps.credential??getCredential;const [appkey,appsecret]=await Promise.all([credential('KIS_APP_KEY'),credential('KIS_APP_SECRET')]);budget.remaining();if(!appkey||!appsecret)return fail('cached_authorization_unavailable');secretValues.add(cached.access_token);secretValues.add(appkey);secretValues.add(appsecret);
 let bymd=options.end.replaceAll('-','');
 for(let n=0;n<4;n++){const p=await page(BRK_KIS_URL,{AUTH:'',EXCD:'NYS',SYMB:'BRK/B',GUBN:'0',BYMD:bymd,MODP:'0'},{authorization:'Bearer '+cached.access_token,appkey,appsecret,tr_id:'HHDFS76240000',custtype:'P'});envelope.kis.push(p);const body=JSON.parse(p.rawJson);if(body.rt_cd!=='0'||body.output1?.rsym!=='DNYSBRK/B'||!Array.isArray(body.output2)||!body.output2.length)return fail('kis_identity_invalid');const first=body.output2.map((r:{xymd:string})=>r.xymd).sort()[0];if(typeof first!=='string'||!/^\d{8}$/.test(first)||first>=bymd)return fail('kis_pagination_invalid');if(first<=options.start.replaceAll('-',''))break;bymd=first;}
 let actionToken:string|undefined;const actionSeen=new Set<string>();
 for(let n=0;n<3;n++){
  const p=await page(BRK_CA_URL,brkCaRequest(envelope.events.queryDate,actionToken),{'APCA-API-KEY-ID':credentials.key,'APCA-API-SECRET-KEY':credentials.secret},actionToken);envelope.events.alpaca.push(p);
  const body=JSON.parse(p.rawJson);if(body.next_page_token===null)break;if(typeof body.next_page_token!=='string'||!body.next_page_token||actionSeen.has(body.next_page_token))return fail('event_pagination_invalid');actionToken=body.next_page_token;actionSeen.add(actionToken!);if(n===2)return fail('event_pagination_limit');
 }
 validateBrkCaPages(envelope.events.alpaca,envelope.events.queryDate,options.calendar.find(s=>s.session===options.end)?.closeAt??'',checkedClock());
 const client=new SecClient({userAgent,timeoutMs:Math.max(1,Math.floor(Math.min(20000,budget.remaining()))),fetchImpl:async(url,init)=>{
  if(url!==BRK_SEC_URL||init?.method!=='GET')return fail('endpoint_invalid');checkedClock();assertBrkDataHeaders(url,{'User-Agent':userAgent});
  if(deps.fetchPage)await budget.reserve(20000);
  const response=await fetch(url,{'User-Agent':userAgent},budget,init?.signal??undefined);if(deps.fetchPage)budget.consume(Buffer.byteLength(response.rawJson));budget.remaining();
  const observedAt=checkedClock();if(response.http===200)rejectSecretEcho(response.rawJson,response.http);if(response.http===200)envelope.events.sec={request:{},http:200,observedAt,rawJson:response.rawJson,sha256:stockEvidenceSha(response.rawJson)};
  return new Response(response.http===200?response.rawJson:null,{status:response.http,headers:response.retryAfterSeconds!==undefined?{'Retry-After':String(response.retryAfterSeconds)}:undefined});
 }});
 const sec=await client.getJson(BRK_SEC_URL);if(sec.status!==200||!envelope.events.sec||sec.sha256!==envelope.events.sec.sha256)return fail('sec_snapshot_unavailable');
 envelope.observedAt=[BRK_MATERIAL_REVIEW.reviewKnownAt,options.kibotSplit.observedAt,...envelope.alpaca.raw.map(p=>p.observedAt),...envelope.alpaca.split.map(p=>p.observedAt),...envelope.kis.map(p=>p.observedAt),...envelope.events.alpaca.map(p=>p.observedAt),envelope.events.sec.observedAt].sort().at(-1)!;
 const rawJson=JSON.stringify(envelope),checked=validateBrkPairEnvelope(rawJson,{start:options.start,end:options.end,now:now().toISOString(),calendar:options.calendar});
 return (['raw','split_adjusted'] as const).map(basis=>({symbol:BRK_PAIR_SYMBOL,vendorTicker:'BRK.B',basis,sourceId:BRK_PAIR_SOURCE_ID+'_'+basis,request:{provider:'alpaca_sip_brk_pair_v1'},sourceUrl:BRK_ALPACA_URL,observedAt:checked.observedAt,sha256:checked.sha256,rows:basis==='raw'?checked.raw:checked.split,rawJson,sourceUse:'evaluation_only',liveEligible:false,http:200}));
 }catch(error){const reason=error instanceof Error&&/^forward_(?:pair|source)_[a-z_]+$/.test(error.message)?error.message:'forward_pair_source_evidence_unavailable';throw new BrkPairEvidenceError(reason,JSON.stringify({...envelope,rejectedReceipts}));}
}

export class BrkPairEvidenceError extends Error{constructor(reason:string,readonly rawEvidence:string){super(reason);this.name='BrkPairEvidenceError';}}
/** Internal bounded transport test seam, not an application endpoint. */
export {fetchData as fetchBrkDataPage};

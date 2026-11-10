/** Pure evidence verification. KIS index observations are never assembled from FRED rows. */
import { createHash } from 'node:crypto';
import { assertForwardCalendar, normalizeForwardUtc, validForwardSessionDate } from './forward-calendar';
import type { ForwardCalendarSession } from './forward-types';

export const KIS_SP500_SOURCE_ID = 'kis_sp500_index_evaluation_v1';
export const KIS_SP500_SOURCE_URL = 'https://openapi.koreainvestment.com:9443/uapi/overseas-price/v1/quotations/inquire-daily-chartprice';
export const KIS_INDEX_LIMITS = Object.freeze({ requests:16, deadlineMs:90_000, pageDays:70, gapDays:7, responseBytes:512*1024, totalBytes:8*1024*1024 });
export interface FredIndexEvidence { sourceUrl:string; observedAt:string; rawCsv:string; sha256:string }
export interface KisIndexPage { request:Record<string,string>; http:number; observedAt:string; rawJson:string; sha256:string }
export interface KisIndexEnvelope {
  schemaVersion:1; sourceId:typeof KIS_SP500_SOURCE_ID; series:'SP500'; unit:'INDEX';
  sourceUse:'evaluation_only'; liveEligible:false; dateWindow:{start:string;end:string}; pages:KisIndexPage[]; fred:FredIndexEvidence;
}
export interface KisIndexValidationOptions { start:string; end:string; now:string; calendar:readonly ForwardCalendarSession[] }
export interface KisIndexRow { session:string; close:string }
export const indexEvidenceSha = (text:string):string => createHash('sha256').update(text,'utf8').digest('hex');
const fail = (code:string):never => { throw new Error(`forward_index_${code}`); };
function object(value:unknown):Record<string,unknown> {
  if (!value || typeof value!=='object' || Array.isArray(value)) return fail('contract_invalid');
  return value as Record<string,unknown>;
}
export function indexUtc(value:unknown):string { return normalizeForwardUtc(value) ?? fail('clock_invalid'); }
/** Only trailing fractional zeroes are normalized; no float conversion or rounding. */
export function canonicalIndexDecimal(value:unknown):string {
  if(typeof value!=='string' || value.length>40 || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)
    || !/[1-9]/.test(value)) return fail('price_invalid');
  return value.includes('.') ? value.replace(/0+$/,'').replace(/\.$/,'') : value;
}
export function indexRequiredSessions(options:KisIndexValidationOptions):ForwardCalendarSession[] {
  if(!validForwardSessionDate(options.start)||!validForwardSessionDate(options.end)||options.start>options.end) return fail('window_invalid');
  assertForwardCalendar(options.calendar);
  const now=indexUtc(options.now);
  const sessions=options.calendar.filter(s=>s.session>=options.start&&s.session<=options.end);
  if(sessions.length<253 || sessions[sessions.length-1].session!==options.end
    || sessions.some(s=>indexUtc(s.closeAt)>now)) return fail('calendar_incomplete');
  return sessions;
}
export function kisIndexRequest(start:string,end:string):Record<string,string> {
  if(!validForwardSessionDate(start)||!validForwardSessionDate(end)||start>end) return fail('request_invalid');
  return {FID_COND_MRKT_DIV_CODE:'N',FID_INPUT_ISCD:'SPX',FID_INPUT_DATE_1:start.replace(/-/g,''),
    FID_INPUT_DATE_2:end.replace(/-/g,''),FID_PERIOD_DIV_CODE:'D'};
}
/** Parse and validate each page before allowing any gap-fill request. */
export function parseKisIndexPage(page:KisIndexPage,options:KisIndexValidationOptions):KisIndexRow[] {
  object(page); const request=object(page.request);
  const from=request.FID_INPUT_DATE_1,to=request.FID_INPUT_DATE_2;
  if(typeof from!=='string'||typeof to!=='string'||!/^\d{8}$/.test(from)||!/^\d{8}$/.test(to)) return fail('request_invalid');
  const day=(s:string):string=>`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  const start=day(from),end=day(to),expected=kisIndexRequest(start,end);
  if(Object.keys(request).length!==Object.keys(expected).length || Object.entries(expected).some(([k,v])=>request[k]!==v)
    || start<options.start || end>options.end || Date.parse(`${end}T00:00:00Z`)-Date.parse(`${start}T00:00:00Z`)>=70*86400_000) return fail('request_invalid');
  const observed=indexUtc(page.observedAt);
  if(observed>indexUtc(options.now)) return fail('observation_future');
  if(page.http!==200 || typeof page.rawJson!=='string' || Buffer.byteLength(page.rawJson)>KIS_INDEX_LIMITS.responseBytes
    || indexEvidenceSha(page.rawJson)!==page.sha256) return fail('page_invalid');
  let parsed:unknown;try{parsed=JSON.parse(page.rawJson);}catch{return fail('json_invalid');}
  const payload=object(parsed),identity=object(payload.output1);
  if(payload.rt_cd!=='0'||identity.stck_shrn_iscd!=='SPX'||identity.hts_kor_isnm!=='S&P500'
    || !Array.isArray(payload.output2) || !payload.output2.length) return fail('identity_invalid');
  const calendar=new Map(options.calendar.map(s=>[s.session,s]));
  const seen=new Set<string>();
  return payload.output2.map(raw=>{
    const row=object(raw),date=row.stck_bsop_date;
    if(typeof date!=='string'||!/^\d{8}$/.test(date)) return fail('row_invalid');
    const session=day(date),close=row.ovrs_nmix_prpr;
    canonicalIndexDecimal(close);
    const canonical=calendar.get(session);
    if(!validForwardSessionDate(session)||session<start||session>end||seen.has(session)||!canonical
      ||indexUtc(canonical.closeAt)>observed) return fail('row_invalid');
    seen.add(session);return {session,close:close as string};
  });
}
export function mergeKisIndexPages(pages:readonly KisIndexPage[],options:KisIndexValidationOptions):KisIndexRow[] {
  if(!pages.length||pages.length>KIS_INDEX_LIMITS.requests) return fail('page_budget');
  const rows=new Map<string,KisIndexRow>();let bytes=0,last='';
  for(const page of pages){
    const observed=indexUtc(page.observedAt);
    if(last&&observed<last) return fail('clock_reversed');last=observed;
    bytes+=Buffer.byteLength(page.rawJson??'');if(bytes>KIS_INDEX_LIMITS.totalBytes)return fail('byte_budget');
    for(const row of parseKisIndexPage(page,options)){
      const previous=rows.get(row.session);
      if(previous&&canonicalIndexDecimal(previous.close)!==canonicalIndexDecimal(row.close))return fail('duplicate_conflict');
      if(!previous)rows.set(row.session,row);
    }
  }
  return [...rows.values()].sort((a,b)=>a.session.localeCompare(b.session));
}
function verifyFred(fred:FredIndexEvidence,options:KisIndexValidationOptions):Map<string,string> {
  object(fred);let url:URL;try{url=new URL(fred.sourceUrl);}catch{return fail('fred_invalid');}
  if(url.origin!=='https://fred.stlouisfed.org'||url.pathname!=='/graph/fredgraph.csv'||url.username||url.password||url.hash
    || url.searchParams.get('id')!=='SP500'||[...url.searchParams.keys()].some(k=>!['id','cosd','coed'].includes(k))
    || url.searchParams.getAll('id').length!==1 || url.searchParams.getAll('cosd').length>1 || url.searchParams.getAll('coed').length>1
    || (url.searchParams.has('cosd')&&!validForwardSessionDate(url.searchParams.get('cosd')))
    || (url.searchParams.has('coed')&&!validForwardSessionDate(url.searchParams.get('coed')))
    ||typeof fred.rawCsv!=='string'||Buffer.byteLength(fred.rawCsv)>KIS_INDEX_LIMITS.responseBytes
    ||indexEvidenceSha(fred.rawCsv)!==fred.sha256||indexUtc(fred.observedAt)>indexUtc(options.now))return fail('fred_invalid');
  const sourceStart=url.searchParams.get('cosd'),sourceEnd=url.searchParams.get('coed');
  if(sourceStart&&sourceEnd&&sourceStart>sourceEnd)return fail('fred_invalid');
  const lines=fred.rawCsv.replace(/^\uFEFF/,'').trim().split(/\r?\n/),rows=new Map<string,string>(),seen=new Set<string>();
  if(!['observation_date,SP500','DATE,SP500'].includes(lines.shift()??''))return fail('fred_invalid');
  const calendar=new Map(options.calendar.map(s=>[s.session,s]));
  for(const line of lines){
    const fields=line.split(','),session=fields[0],close=fields[1];
    if(fields.length!==2||!validForwardSessionDate(session)||(sourceStart&&session<sourceStart)||(sourceEnd&&session>sourceEnd)
      ||session>fred.observedAt.slice(0,10)||seen.has(session))return fail('fred_invalid');
    seen.add(session);if(close===''||close==='.')continue;
    const canonical=calendar.get(session);
    const value=canonicalIndexDecimal(close);
    if(canonical&&indexUtc(canonical.closeAt)>indexUtc(fred.observedAt))return fail('fred_invalid');
    if(session>=options.start&&session<=options.end){if(!canonical)return fail('fred_invalid');rows.set(session,value);}
  }
  return rows;
}
export function validateKisIndexEnvelope(rawJson:string,options:KisIndexValidationOptions):{
  rows:KisIndexRow[]; observedAt:string; sha256:string; overlapSessions:number;
} {
  if(typeof rawJson!=='string'||Buffer.byteLength(rawJson)>KIS_INDEX_LIMITS.totalBytes+2*KIS_INDEX_LIMITS.responseBytes)return fail('byte_budget');
  let parsed:unknown;try{parsed=JSON.parse(rawJson);}catch{return fail('json_invalid');}
  const envelope=object(parsed);
  if(envelope.schemaVersion!==1||envelope.sourceId!==KIS_SP500_SOURCE_ID||envelope.series!=='SP500'||envelope.unit!=='INDEX'
    ||envelope.sourceUse!=='evaluation_only'||envelope.liveEligible!==false||!Array.isArray(envelope.pages))return fail('contract_invalid');
  const window=object(envelope.dateWindow);
  if(!validForwardSessionDate(window.start)||!validForwardSessionDate(window.end)||window.start>window.end
    ||window.start<options.start||window.end>options.end
    ||Date.parse(`${window.end}T00:00:00Z`)-Date.parse(`${window.start}T00:00:00Z`)>430*86400_000)return fail('window_invalid');
  const sessions=indexRequiredSessions({...options,start:window.start});
  const ownOptions={...options,start:window.start,end:window.end};
  const pages=envelope.pages as KisIndexPage[],rows=mergeKisIndexPages(pages,ownOptions),available=new Set(rows.map(r=>r.session));
  const latest=rows[rows.length-1]?.session,through=sessions.filter(s=>s.session<=latest);
  if(through.length<253||latest<sessions[Math.max(0,sessions.length-2)].session
    ||through.some(s=>!available.has(s.session)))return fail('canonical_gap');
  const fred=verifyFred(envelope.fred as FredIndexEvidence,options);let overlapSessions=0;
  for(const row of rows){const reference=fred.get(row.session);if(reference!==undefined){
    if(canonicalIndexDecimal(row.close)!==reference)return fail('fred_mismatch');overlapSessions++;
  }}
  if(overlapSessions<200)return fail('fred_overlap_insufficient');
  return {rows,observedAt:pages[pages.length-1].observedAt,sha256:indexEvidenceSha(rawJson),overlapSessions};
}

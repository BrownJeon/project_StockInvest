/** Narrow BRK.B coherent pair. Whole originals are retained; no prices are inferred or rounded. */
import {validateBrkCaPages,validateBrkSecSnapshot,brkMaterialReviewSha,BRK_MATERIAL_REVIEW,BRK_EVENT_LIMITATION} from './forward-stock-events';
import { createHash } from 'node:crypto';
import { parseStockJson,stockNumber,stockDecimal } from './forward-stock-json';
import { normalizeForwardUtc,validForwardSessionDate } from './forward-calendar';
import type { ForwardCalendarSession } from './forward-types';
import type { ForwardCsvBar,ForwardStockSource } from './forward-sources';
export const BRK_FIELD_QUALIFICATION=Object.freeze({crossProvider:'open_close_only',highLowVolume:'source_shape_only_not_cross_provider_qualified',futureUseRequiresReview:true} as const);
export const BRK_PAIR_SYMBOL='NYS:BRK.B';
export const BRK_PAIR_SOURCE_ID='alpaca_sip_brkb_coherent_evaluation_v1';
export const BRK_ALPACA_URL='https://data.alpaca.markets/v2/stocks/bars';
export const BRK_KIS_URL='https://openapi.koreainvestment.com:9443/uapi/overseas-price/v1/quotations/dailyprice';
export const BRK_MASTER_SHA='634f61d3f065bba49d6107f40ecd2dc4ffca240d3ad5e2ab08c0bc6dbdff61e0';
export const stockEvidenceSha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export interface BrkEvidencePage {request:Record<string,string>;http:number;observedAt:string;rawJson:string;sha256:string;requestTokenSha256?:string|null}
export interface BrkPairEnvelope {clockMeaning:'whole_evidence_ready_not_first_provider_receipt';fieldQualification:typeof BRK_FIELD_QUALIFICATION;schemaVersion:1;sourceId:typeof BRK_PAIR_SOURCE_ID;symbol:typeof BRK_PAIR_SYMBOL;currency:'USD';sourceUse:'evaluation_only';liveEligible:false;dateWindow:{start:string;end:string};events:{queryDate:string;alpaca:BrkEvidencePage[];sec:BrkEvidencePage|null;reviewManifest:typeof BRK_MATERIAL_REVIEW;reviewManifestSha256:string;assessment:'no_conflicts_reported_asof';completeHistoryGuaranteed:false;limitation:typeof BRK_EVENT_LIMITATION};observedAt:string;master:{sha256:string;rawBase64:string};alpaca:{raw:BrkEvidencePage[];split:BrkEvidencePage[]};kis:BrkEvidencePage[];kibotSplit:ForwardStockSource}
// Reuse ICU formatter instances, never a date/offset result. The per-observation checks remain unchanged.
const NY_OFFSET_FORMAT=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',timeZoneName:'shortOffset'});
const NY_CLOCK_FORMAT=new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',hourCycle:'h23',hour:'2-digit',minute:'2-digit',second:'2-digit'});
const NY_DAY_FORMAT=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
const fail=():never=>{throw Error('forward_pair_contract_invalid');};
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))return fail();return v as Record<string,unknown>;};
const decimal=(v:string):string=>{if(typeof v!=='string'||!/^\d+(?:\.\d+)?$/.test(v))return fail();const d=stockDecimal(v);if(d==='0')return fail();return d;};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function date(value:string):string{if(!/^\d{8}$/.test(value))return fail();const d=value.slice(0,4)+'-'+value.slice(4,6)+'-'+value.slice(6);if(!validForwardSessionDate(d))return fail();return d;}
function csv(text:string):ForwardCsvBar[]{return text.trim().split(/\r?\n/).map(line=>{const p=line.split(',');const m=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(p[0]);if(p.length!==6||!m)return fail();const session=`${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;if(!validForwardSessionDate(session))return fail();p.slice(1,5).forEach(decimal);if(!/^\d+$/.test(p[5]))return fail();return {session,open:p[1],high:p[2],low:p[3],close:p[4],volume:p[5]};});}
export function brkAlpacaRequest(start:string,end:string,basis:'raw'|'split',token?:string):Record<string,string>{
 const offset=(day:string)=>NY_OFFSET_FORMAT.formatToParts(new Date(day+'T12:00:00Z')).find(p=>p.type==='timeZoneName')?.value==='GMT-4'?'-04:00':'-05:00';
 return {symbols:'BRK.B',timeframe:'1Day',feed:'sip',currency:'USD',adjustment:basis,asof:end,start:start+'T00:00:00'+offset(start),end:end+'T23:59:59'+offset(end),sort:'asc',limit:'1000',...(token?{page_token:token}:{})};
}
export function validateBrkPairEnvelope(rawJson:string,options:{start:string;end:string;now:string;calendar:readonly ForwardCalendarSession[]}):{raw:ForwardCsvBar[];split:ForwardCsvBar[];observedAt:string;sha256:string} {
 let e:BrkPairEnvelope;try{e=JSON.parse(rawJson);}catch{return fail();}
 if(e.clockMeaning!=='whole_evidence_ready_not_first_provider_receipt'||!same(e.fieldQualification,BRK_FIELD_QUALIFICATION)||e.schemaVersion!==1||e.sourceId!==BRK_PAIR_SOURCE_ID||e.symbol!==BRK_PAIR_SYMBOL||e.currency!=='USD'||e.sourceUse!=='evaluation_only'||e.liveEligible!==false||!e.dateWindow||!validForwardSessionDate(e.dateWindow.start)||e.dateWindow.end!==options.end||e.dateWindow.start<options.start||e.dateWindow.start>e.dateWindow.end||Date.parse(e.dateWindow.end+'T00:00:00Z')-Date.parse(e.dateWindow.start+'T00:00:00Z')>430*86400000)return fail();
 const now=normalizeForwardUtc(options.now),observed=normalizeForwardUtc(e.observedAt);if(!now||!observed||observed>now)return fail();
 if(e.master?.sha256!==BRK_MASTER_SHA||stockEvidenceSha(Buffer.from(e.master.rawBase64,'base64'))!==BRK_MASTER_SHA)return fail();
 const master=new TextDecoder('euc-kr',{fatal:true}).decode(Buffer.from(e.master.rawBase64,'base64'));
 const matches=master.split(/\r?\n/).filter(Boolean).map(l=>l.split('\t').map(v=>v.trim())).filter(c=>c[4]==='BRK/B');
 if(matches.length!==1||matches[0].length!==24||matches[0][2]!=='NYS'||matches[0][5]!=='NYSBRK/B'||matches[0][7]!=='BERKSHIRE HATHAWAY INC'||matches[0][8]!=='2'||matches[0][17]!=='N'||matches[0][22]!=='')return fail();
 const canonical=options.calendar.filter(s=>s.session>=e.dateWindow.start&&s.session<=options.end),closes=new Map(options.calendar.map(s=>[s.session,s.closeAt]));
 if(canonical.length<253||canonical.at(-1)?.session!==options.end)return fail();
 let latest=normalizeForwardUtc(BRK_MATERIAL_REVIEW.reviewKnownAt)!,previousPage='';if(latest>observed)return fail();
 const checked=(p:BrkEvidencePage)=>{const at=normalizeForwardUtc(p.observedAt);if(p.http!==200||!at||at<previousPage||at>observed||stockEvidenceSha(p.rawJson)!==p.sha256||Buffer.byteLength(p.rawJson)>512*1024)return fail();previousPage=at;if(at>latest)latest=at;return at;};
 const checkRows=(rows:ForwardCsvBar[],at:string)=>{let previous='';for(const r of rows){if(r.session<=previous||!closes.has(r.session)||closes.get(r.session)!>at)return fail();previous=r.session;for(const k of ['open','high','low','close'] as const)decimal(r[k]);if(!/^\d+$/.test(r.volume)||Number(r.low)>Math.min(Number(r.open),Number(r.close))||Number(r.high)<Math.max(Number(r.open),Number(r.close)))return fail();}return rows;};
 function alpaca(basis:'raw'|'split'):ForwardCsvBar[]{
  const pages=e.alpaca?.[basis];if(!Array.isArray(pages)||!pages.length||pages.length>3)return fail();let token:string|undefined;const seen=new Set<string>(),rows:ForwardCsvBar[]=[];
  pages.forEach((p,i)=>{const at=checked(p);if(!same(p.request,{...brkAlpacaRequest(e.dateWindow.start,e.dateWindow.end,basis),symbols:p.request.symbols==='AAPL,BRK.B'?'AAPL,BRK.B':'BRK.B'})||p.requestTokenSha256!==(token?stockEvidenceSha(token):null))return fail();
   const body=object(parseStockJson(p.rawJson)),bars=object(body.bars);if(Object.keys(body).some(k=>!['bars','next_page_token'].includes(k)))return fail();if(Object.keys(bars).some(k=>!p.request.symbols.split(',').includes(k))||!Array.isArray(bars['BRK.B']))return fail();
   for(const value of bars['BRK.B']){const b=object(value),t=b.t;if(typeof t!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.0+)?(?:Z|[+-]\d{2}:\d{2})$/.test(t)||!Number.isFinite(Date.parse(t)))return fail();
    const clock=NY_CLOCK_FORMAT.format(new Date(t));if(clock!=='00:00:00')return fail();
    const session=NY_DAY_FORMAT.format(new Date(t));
    const volume=stockNumber(b.v);if(!/^\d+$/.test(volume))return fail();rows.push({session,open:decimal(stockNumber(b.o)),high:decimal(stockNumber(b.h)),low:decimal(stockNumber(b.l)),close:decimal(stockNumber(b.c)),volume});
   }
   checkRows(rows,at);const next=body.next_page_token;if(next!==null&&(typeof next!=='string'||!next||next.length>4096||seen.has(next)))return fail();
   if((i===pages.length-1)!==(next===null))return fail();if(typeof next==='string'){seen.add(next);token=next;}
  });
  if(!same(rows.map(r=>r.session),canonical.map(s=>s.session)))return fail();return rows;
 }
 const raw=alpaca('raw'),split=alpaca('split');if(!same(raw,split))return fail(); // v1 intentionally stops at any corporate-action divergence.
 if(!Array.isArray(e.kis)||!e.kis.length||e.kis.length>4)return fail();const kis=new Map<string,ForwardCsvBar>();let bymd=options.end.replaceAll('-','');
 for(const p of e.kis){const at=checked(p);if(!same(p.request,{AUTH:'',EXCD:'NYS',SYMB:'BRK/B',GUBN:'0',BYMD:bymd,MODP:'0'}))return fail();const body=object(parseStockJson(p.rawJson));if(body.rt_cd!=='0'||object(body.output1).rsym!=='DNYSBRK/B'||!Array.isArray(body.output2)||!body.output2.length)return fail();
  let first='';for(const value of body.output2){const b=object(value);if(typeof b.xymd!=='string')return fail();const session=date(b.xymd);if(session>date(bymd))return fail();if(!first||session<first)first=session;
   const row={session,open:decimal(b.open as string),high:decimal(b.high as string),low:decimal(b.low as string),close:decimal(b.clos as string),volume:b.tvol as string};if(!/^\d+$/.test(row.volume))return fail();if(session>=e.dateWindow.start&&session<=options.end){checkRows([row],at);const old=kis.get(session);if(old&&!same(old,row))return fail();kis.set(session,row);}}
  if(!first||first.replaceAll('-','')>=bymd)return fail();bymd=first.replaceAll('-','');
 }
 if(kis.size!==canonical.length||!canonical.every(s=>kis.has(s.session)))return fail();
 /** Cross-provider admission covers consumed native OPEN/CLOSE only. Reference H/L/volume are not qualified for future indicators. */
 const overlap=raw.filter(r=>kis.has(r.session));if(overlap.length<200||overlap.some(r=>r.open!==kis.get(r.session)!.open||r.close!==kis.get(r.session)!.close))return fail();
 const ref=e.kibotSplit;if(!ref||ref.symbol!==BRK_PAIR_SYMBOL||ref.vendorTicker!=='BRK.B'||ref.basis!=='split_adjusted'||ref.sourceId!=='kibot_guest_evaluation_split_adjusted_v1'||ref.sourceUrl!=='https://api.kibot.com/'||ref.http!==200||!ref.rawCsv||stockEvidenceSha(ref.rawCsv)!==ref.sha256)return fail();
 const rp=ref.request;if(!rp||rp.action!=='history'||rp.symbol!=='BRK.B'||rp.interval!=='daily'||rp.splitadjusted!=='1'||rp.unadjusted!=='0'||Object.keys(rp).some(k=>!['action','symbol','interval','startdate','enddate','splitadjusted','unadjusted'].includes(k)))return fail();
 const refAt=normalizeForwardUtc(ref.observedAt);if(!refAt||refAt>observed)return fail();if(refAt>latest)latest=refAt;
 const reference=csv(ref.rawCsv);if(!same(reference,ref.rows))return fail();checkRows(reference,refAt);
 if(reference.some(r=>r.session>options.end))return fail();
 const common=reference.filter(r=>r.session>=e.dateWindow.start&&r.session<=options.end);if(common.length<200||common.some(r=>{const row=split.find(v=>v.session===r.session);return !row||row.close!==stockDecimal(r.close);}))return fail();
 if(!e.events||!Array.isArray(e.events.alpaca)||!e.events.sec||e.events.limitation!==BRK_EVENT_LIMITATION||e.events.reviewManifestSha256!==brkMaterialReviewSha()||!same(e.events.reviewManifest,BRK_MATERIAL_REVIEW)||e.events.assessment!=='no_conflicts_reported_asof'||e.events.completeHistoryGuaranteed!==false)return fail();
 for(const p of e.events.alpaca??[])checked(p);
 validateBrkCaPages(e.events.alpaca,e.events.queryDate,closes.get(options.end)??'',options.now);
 checked(e.events.sec);validateBrkSecSnapshot(e.events.sec,e.events.queryDate,closes.get(options.end)??'',options.now);
 if(latest!==observed)return fail();return {raw,split,observedAt:observed,sha256:stockEvidenceSha(rawJson)};
}

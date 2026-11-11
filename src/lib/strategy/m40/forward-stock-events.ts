/** Finite evaluation evidence, not a proof of absolute corporate-action absence. */
import {createHash} from 'node:crypto';
import {normalizeForwardUtc,validForwardSessionDate} from './forward-calendar';
import {parseStockJson} from './forward-stock-json';
import type {BrkEvidencePage} from './forward-stock-contract';
export const BRK_CA_URL='https://data.alpaca.markets/v1/corporate-actions';
export const BRK_SEC_URL='https://data.sec.gov/submissions/CIK0001067983.json';
export const BRK_EVENT_LIMITATION='Process-date provider query and contemporaneous official snapshot only; reporting delays/corrections remain possible; no absolute no-action guarantee. Empty actions have no BRK symbol echo: ticker-specific mapping/coverage is not verified; other-symbol positive controls prove endpoint function only.';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const fail=(code:string):never=>{throw Error('forward_pair_events_'+code);};
export const brkCaRequest=(queryDate:string,token?:string):Record<string,string>=>({symbols:'BRK.B',start:'2000-01-01',end:queryDate,data_quality:'all',region:'us',limit:'1000',sort:'asc',...(token?{page_token:token}:{})});
export const brkNyDate=(at:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
export function validateBrkCaPages(pages:readonly BrkEvidencePage[],queryDate:string,asOfClose:string,now:string):{observedAt:string;limitation:string}{
 if(!validForwardSessionDate(queryDate)||!Array.isArray(pages)||!pages.length||pages.length>3)return fail('query_invalid');
 const cutoff=normalizeForwardUtc(now),close=normalizeForwardUtc(asOfClose);if(!cutoff||!close||brkNyDate(cutoff)!==queryDate)return fail('clock_invalid');
 let token:string|undefined,previous='';const seen=new Set<string>();
 for(const [i,p]of pages.entries()){
  const at=normalizeForwardUtc(p.observedAt);if(p.http!==200||!at||at>cutoff||at<close||at<previous||brkNyDate(at)!==queryDate||hash(p.rawJson)!==p.sha256||Buffer.byteLength(p.rawJson)>512*1024||JSON.stringify(p.request)!==JSON.stringify(brkCaRequest(queryDate))||p.requestTokenSha256!==(token?hash(token):null))return fail('proof_invalid');
  previous=at;const body=parseStockJson(p.rawJson) as Record<string,unknown>;if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['corporate_actions','next_page_token'].includes(k)))return fail('shape_invalid');
  const actions=body.corporate_actions;if(!actions||typeof actions!=='object'||Array.isArray(actions))return fail('shape_invalid');
  for(const rows of Object.values(actions)){if(!Array.isArray(rows))return fail('shape_invalid');if(rows.length)return fail('known_or_unclassified_action_requires_reconciliation');}
  const next=body.next_page_token;if(next!==null&&(typeof next!=='string'||!next||next.length>4096||seen.has(next)))return fail('pagination_invalid');
  if((i===pages.length-1)!==(next===null))return fail('pagination_incomplete');if(typeof next==='string'){seen.add(next);token=next;}
 }
 return {observedAt:previous,limitation:BRK_EVENT_LIMITATION};
}
/** Explicit finite human review. Future unreviewed material accessions are not classified by keyword absence. */
export const BRK_MATERIAL_REVIEW=Object.freeze({
 version:'brkb_finite_material_review_20261111_v1',reviewKnownAt:'2026-11-11T08:39:50.252007Z',cik:'0001067983',
 artifacts:{material:'e2a72755c4afd3ab90878ffc3e895e71f68988c58491590e5d9a40553d7e29cf',targeted10Q:'fa5a6f3584a0f4656fb38a3d3fe8ef28df8cf29df23cba63f0e305640603a752'},
 materials:[
  {accession:'0001193125-26-452530',form:'8-K',primaryDocument:'brka-20261107.htm',items:'2.02,9.01',acceptedAt:'2026-11-09T11:10:14.000000Z',url:'https://www.sec.gov/Archives/edgar/data/1067983/000119312526452530/brka-20261107.htm',evidenceKind:'whole_original_with_scoped_material_review',rawBodySha256:'9e2977d1b0f6b16fd84761e7b431050785f4b9b7f134bfec9f64f5a565d1978b',exhibit:{url:'https://www.sec.gov/Archives/edgar/data/1067983/000119312526452530/brka-ex99_1.htm',rawBodySha256:'e53b04c5e8af702e033bfcf06c73ee3cf61a8a83e7b54fb76d065e8229eac076'},scope:'earnings_report_and_attached_release_no_announced_basis_change_identified_in_reviewed_contents'},
  {accession:'0001193125-26-452592',form:'424B5',primaryDocument:'d86634d424b5.htm',items:'',acceptedAt:'2026-11-09T11:40:01.000000Z',url:'https://www.sec.gov/Archives/edgar/data/1067983/000119312526452592/d86634d424b5.htm',evidenceKind:'whole_original_with_scoped_material_review',rawBodySha256:'47b7fb090c0ad3477e546830af8c2d056b35216a64c8b0e8358edfb307c49dca',scope:'preliminary_yen_senior_unsecured_notes_conditional_covenants_not_a_stock_action_announcement_in_reviewed_contents'},
  {accession:'0001193125-26-452412',form:'10-Q',primaryDocument:'brka-20260930.htm',items:'',acceptedAt:'2026-11-09T11:01:15.000000Z',url:'https://www.sec.gov/Archives/edgar/data/1067983/000119312526452412/brka-20260930.htm',evidenceKind:'official_web_parsed_targeted',rawBodySha256:null,scope:'cover_asof_20261028_and_note18_through_20260930_existing_A_to_B_1500_conversion_only_targeted_not_whole_original_review'},
 ],
 assessment:'no_conflicts_reported_asof',completeHistoryGuaranteed:false,limitation:BRK_EVENT_LIMITATION,
});
for(const material of BRK_MATERIAL_REVIEW.materials){if('exhibit' in material)Object.freeze(material.exhibit);Object.freeze(material);}
Object.freeze(BRK_MATERIAL_REVIEW.materials);Object.freeze(BRK_MATERIAL_REVIEW.artifacts);
export const brkMaterialReviewSha=()=>hash(JSON.stringify(BRK_MATERIAL_REVIEW));
export function validateBrkSecSnapshot(page:BrkEvidencePage,queryDate:string,asOfClose:string,now:string):{observedAt:string;reviewManifestSha256:string}{
 const at=normalizeForwardUtc(page.observedAt),cutoff=normalizeForwardUtc(now),close=normalizeForwardUtc(asOfClose);
 if(page.http!==200||!at||!cutoff||!close||at<close||at>cutoff||brkNyDate(at)!==queryDate||brkNyDate(cutoff)!==queryDate||Object.keys(page.request).length!==0||hash(page.rawJson)!==page.sha256||Buffer.byteLength(page.rawJson)>512*1024)return fail('sec_proof_invalid');
 const body=parseStockJson(page.rawJson) as Record<string,unknown>;if(!body||typeof body!=='object'||body.cik!=='0001067983'||body.name!=='BERKSHIRE HATHAWAY INC'||!Array.isArray(body.tickers)||!Array.isArray(body.exchanges)||body.tickers.length!==body.exchanges.length)return fail('sec_identity_invalid');
 const ticker=body.tickers.indexOf('BRK-B');if(ticker<0||body.exchanges[ticker]!=='NYSE')return fail('sec_identity_invalid');
 const filings=body.filings as {recent?:Record<string,unknown[]>},r=filings?.recent;if(!r||typeof r!=='object'||!Array.isArray(r.filingDate)||!r.filingDate.length||r.filingDate.length>2000||!Object.values(r).every(v=>Array.isArray(v)&&v.length===r.filingDate.length))return fail('sec_shape_invalid');
 for(const key of ['accessionNumber','filingDate','acceptanceDateTime','form','primaryDocument','items'])if(!Array.isArray(r[key]))return fail('sec_shape_invalid');
 const from=new Date(Date.parse(queryDate+'T00:00:00Z')-14*86400000).toISOString().slice(0,10);let oldest=queryDate;const seen=new Set<string>();
 for(let i=0;i<r.filingDate.length;i++){
  const date=r.filingDate[i],acceptance=normalizeForwardUtc(r.acceptanceDateTime[i] as string),accession=r.accessionNumber[i];
  if(typeof date!=='string'||!validForwardSessionDate(date)||date>queryDate||!acceptance||acceptance>at||typeof accession!=='string'||!/^\d{10}-\d{2}-\d{6}$/.test(accession)||seen.has(accession))return fail('sec_clock_or_identity_invalid');
  seen.add(accession);if(date<oldest)oldest=date;if(date<from)continue;
  if(r.form[i]==='4'&&r.items[i]===''&&typeof r.primaryDocument[i]==='string'&&r.primaryDocument[i])continue; // ownership metadata only; not a whole-body financial/basis review.
  const known=BRK_MATERIAL_REVIEW.materials.find(m=>m.accession===accession);
  if(!known||known.form!==r.form[i]||known.primaryDocument!==r.primaryDocument[i]||known.items!==r.items[i]||known.acceptedAt!==acceptance)return fail('unreviewed_material_filing');
 }
 if(oldest>from)return fail('sec_recent_coverage_incomplete');return {observedAt:at,reviewManifestSha256:brkMaterialReviewSha()};
}

/** The public research plane is readable by operating analytics, never a trading ledger. */
import { getPool } from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import type { ArchiveQueryable } from '@/lib/analysis-data/types';
const ID='t156-research-db-20261108';
const SEC_ACCEPTANCE_PROXY_SOURCES=['free_sec_original_20261107','sec_edgar_priority'] as const;
async function requirePublished(db: ArchiveQueryable,withVerification=false):Promise<string|null> {
 const [r]=await db.query<RowDataPacket[]>(withVerification
  ? 'SELECT id,metadata_json FROM t156_dataset WHERE id=? AND status=\'published\''
  : 'SELECT id FROM t156_dataset WHERE id=? AND status=\'published\'',[ID]);
 if(!r.length) throw new Error('t156_research_not_published');
 if(!withVerification) return null;
 try {
  const metadata=typeof r[0].metadata_json==='string'?JSON.parse(r[0].metadata_json):r[0].metadata_json;
  const verifiedAt=metadata?.verification?.verifiedAt;
  stockCutoffSql(verifiedAt);
  return verifiedAt as string;
 }catch{return null;}
}
export async function readResearchMarket(options:{throughSession:string;limit?:number},db:ArchiveQueryable=getPool()) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(options.throughSession)) throw new Error('invalid_session');
 const limit=options.limit??260;
 if(!Number.isInteger(limit)||limit<1||limit>10000) throw new Error('invalid_limit');
 await requirePublished(db);
 const [rows]=await db.query<RowDataPacket[]>(
  `SELECT m.series,DATE_FORMAT(m.trade_date,'%Y-%m-%d') AS session,m.close_value,
    DATE_FORMAT(s.closes_at_utc,'%Y-%m-%dT%H:%i:%sZ') AS session_close_utc
   FROM t156_research_market_close m JOIN t156_research_backfill_session s ON s.trade_date=m.trade_date
   WHERE m.trade_date<=? ORDER BY m.trade_date DESC,m.series LIMIT ?`,[options.throughSession,limit*3]);
 return {datasetId:ID,rows,qualification:'research_only',availability:'session_close_is_reconstructed_not_first_observed'};
}

export interface ResearchStockBarOptions {
 vendorTicker: string;
 /** Required: raw providers are never silently combined or substituted. */
 sourceId: string;
 cutoff: string;
 throughSession: string;
 limit?: number;
}
interface ResearchStockBarRow extends RowDataPacket {
 source_id: string;
 vendor_ticker: string;
 session: string;
 o: string;
 h: string;
 l: string;
 c: string;
 volume: string;
 is_unadjusted: number | string | boolean;
 identity_status: string;
 published_at: string|null;
 available_at: string;
 session_close_utc: string;
}

function realStockSession(value: string): boolean {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
 const milliseconds=Date.parse(`${value}T00:00:00Z`);
 return Number.isFinite(milliseconds)&&new Date(milliseconds).toISOString().slice(0,10)===value;
}
function stockCutoffSql(value: string): string {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?Z$/.test(value)
  ||!realStockSession(value.slice(0,10))||!Number.isFinite(Date.parse(value))) throw new Error('invalid_cutoff');
 // Preserve microseconds; Date.toISOString() would discard the last three digits.
 return value.slice(0,-1).replace('T',' ');
}
function normalizedStockUtc(value:string):string {
 stockCutoffSql(value);
 return `${value.slice(0,19)}.${value.slice(19,-1).replace(/^\./,'').padEnd(6,'0')}Z`;
}

/**
 * Lossless, source-specific prices for operating research views. Unknown source
 * publication uses only the actual archive-verification observation, never a
 * guessed historical market close. Historic identity never gains live eligibility.
 * Canonical sessions exclude nontrading/phantom dates before applying LIMIT.
 */
export async function readResearchStockBars(options:ResearchStockBarOptions,db:ArchiveQueryable=getPool()) {
 if(typeof options.sourceId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,49}$/.test(options.sourceId)) throw new Error('invalid_source');
 if(typeof options.vendorTicker!=='string'||!/^[A-Za-z0-9^][A-Za-z0-9.^=_/\-]{0,23}$/.test(options.vendorTicker)) throw new Error('invalid_symbol');
 if(!realStockSession(options.throughSession)) throw new Error('invalid_session');
 const cutoff=stockCutoffSql(options.cutoff),limit=options.limit??260;
 if(!Number.isInteger(limit)||limit<1||limit>10000) throw new Error('invalid_limit');
 const archiveVerifiedAt=await requirePublished(db,true);
 const archiveVerifiedSql=archiveVerifiedAt===null?null:stockCutoffSql(archiveVerifiedAt);
 const [rows]=await db.query<ResearchStockBarRow[]>(
  `SELECT b.source_id,b.vendor_ticker,DATE_FORMAT(b.trade_date,'%Y-%m-%d') AS session,
    CAST(b.o AS CHAR) AS o,CAST(b.h AS CHAR) AS h,CAST(b.l AS CHAR) AS l,CAST(b.c AS CHAR) AS c,
    CAST(b.volume AS CHAR) AS volume,b.is_unadjusted,b.identity_status,
    DATE_FORMAT(b.published_at_utc,'%Y-%m-%dT%H:%i:%s.%fZ') AS published_at,
    DATE_FORMAT(COALESCE(b.published_at_utc,CAST(? AS DATETIME(6))),'%Y-%m-%dT%H:%i:%s.%fZ') AS available_at,
    DATE_FORMAT(s.closes_at_utc,'%Y-%m-%dT%H:%i:%s.%fZ') AS session_close_utc
   FROM t156_research_backfill_stock_bar b
   JOIN t156_research_backfill_session s ON s.trade_date=b.trade_date
   WHERE b.source_id=? AND b.vendor_ticker=?
    AND COALESCE(b.published_at_utc,CAST(? AS DATETIME(6)))<=CAST(? AS DATETIME(6))
    AND s.closes_at_utc IS NOT NULL AND s.closes_at_utc<=?
    AND b.trade_date<=? ORDER BY b.trade_date DESC LIMIT ?`,
  [archiveVerifiedSql,options.sourceId,options.vendorTicker,archiveVerifiedSql,cutoff,cutoff,options.throughSession,limit]);
 return {datasetId:ID,sourceId:options.sourceId,vendorTicker:options.vendorTicker,
  rows:rows.filter(row=>{
   try {stockCutoffSql(row.available_at);if(row.published_at!==null)stockCutoffSql(row.published_at);return true;}catch{return false;}
  }).map(row=>({...row,price_basis:row.is_unadjusted===1||row.is_unadjusted===true||row.is_unadjusted==='1'?'raw':'unknown_adjusted',
   availability_basis:row.published_at===null?'verified_archive_observation':'source_time',archive_verified_at:archiveVerifiedAt})),
  qualification:'research_only' as const,liveEligible:false as const,
  availability:'source_time_or_verified_archive_observation; first_observed_unknown' as const,
  archive_verified_at:archiveVerifiedAt,firstObservedAt:null,currency:null};
}

export async function readResearchDocuments(options:{cutoff:string;days?:number;limit?:number},db:ArchiveQueryable=getPool()) {
 const cutoff=stockCutoffSql(options.cutoff);
 const days=options.days??14,limit=options.limit??100;
 if(!Number.isInteger(days)||days<1||days>14||!Number.isInteger(limit)||limit<1||limit>500) throw new Error('invalid_limit');
 await requirePublished(db);
 // Only these SEC originals have a verified acceptance clock contract. This
 // proxy is not evidence of the time of actual public dissemination.
 const publication=`COALESCE(published_at_utc,CASE WHEN source_id IN ('${SEC_ACCEPTANCE_PROXY_SOURCES.join("','")}') THEN accepted_at_utc ELSE NULL END)`;
 const [rows]=await db.query<RowDataPacket[]>(
  `SELECT source_id,document_id,document_type,publisher,title,source_url,body_format,body_sha256,raw_bytes,
    DATE_FORMAT(published_at_utc,'%Y-%m-%dT%H:%i:%s.%fZ') AS published_at,
    DATE_FORMAT(${publication},'%Y-%m-%dT%H:%i:%s.%fZ') AS effective_publication_at,
    CASE WHEN published_at_utc IS NOT NULL THEN 'source_publication' ELSE 'sec_acceptance_proxy' END AS publication_basis,
    DATE_FORMAT(accepted_at_utc,'%Y-%m-%dT%H:%i:%s.%fZ') AS accepted_at,
    DATE_FORMAT(observed_at_utc,'%Y-%m-%dT%H:%i:%s.%fZ') AS observed_at,
    body_gzip IS NOT NULL AS has_original,publication_precision
   FROM t156_research_backfill_document
   WHERE ${publication} IS NOT NULL AND ${publication}<=? AND ${publication}>=DATE_SUB(?,INTERVAL ? DAY)
    AND observed_at_utc IS NOT NULL AND observed_at_utc<=?
    AND (accepted_at_utc IS NULL OR accepted_at_utc<=?)
   ORDER BY effective_publication_at DESC,source_id,document_id LIMIT ?`,[cutoff,cutoff,days,cutoff,cutoff,limit]);
 return {datasetId:ID,rows,qualification:'source_publication_or_allowlisted_sec_acceptance_proxy; real_dissemination_may_be_unknown; known_observation_required'};
}

/** Original bytes stay in the archive. Optional model context is bounded and labelled. */
export async function readResearchEvidence(cutoff:string,db:ArchiveQueryable=getPool()) {
 const {gunzipSync}=await import('node:zlib');
 const documents=await readResearchDocuments({cutoff,days:14,limit:6},db);
 const evidence:import('./advisory').M40Evidence[]=[];
 for(const row of documents.rows){
  const [bodies]=await db.query<RowDataPacket[]>(
   `SELECT body_gzip FROM t156_research_backfill_document WHERE source_id=? AND document_id=?`,[row.source_id,row.document_id]);
  let content=`[Metadata only; document body unavailable] ${String(row.title??'')}`;
  const blob=bodies[0]?.body_gzip;
  if(Buffer.isBuffer(blob)) {
   try {
    const text=gunzipSync(blob,{maxOutputLength:2*1024*1024}).toString('utf8');
    content=`[Archived source; format=${String(row.body_format)}; ${text.length>9800?'partial excerpt, remainder omitted':'stored text; original coverage follows body_format; original extent unverified'}] ${text.slice(0,9800)}`;
   }catch{content=`[Metadata only; archived body exceeds context budget or is invalid] ${String(row.title??'')}`;}
  }
  if(row.publication_basis==='sec_acceptance_proxy') {
   content='[SEC acceptance-time proxy; real dissemination time unknown. Original publication timestamp unavailable; '
    +'this proxy does not establish full public availability. First observation uses the recorded observed_at.] '+content;
  }
  const publishedAt=String(row.effective_publication_at??row.published_at),observedAt=String(row.observed_at);
  const clocks=[publishedAt,observedAt,...(row.accepted_at?[String(row.accepted_at)]:[])];
  const availableAt=clocks.reduce((latest,value)=>normalizedStockUtc(value)>normalizedStockUtc(latest)?value:latest);
  evidence.push({id:`${String(row.source_id)}:${String(row.document_id)}`,
   kind:/sec/i.test(String(row.source_id))||/securities|SEC/.test(String(row.publisher))?'sec':'news',
   publishedAt,observedAt,availableAt,sourceUrl:String(row.source_url),content:content.slice(0,12000)});
 }
 return evidence;
}

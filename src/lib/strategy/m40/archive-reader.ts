/** The public research plane is readable by operating analytics, never a trading ledger. */
import { getPool } from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import type { ArchiveQueryable } from '@/lib/analysis-data/types';
const ID='t156-research-db-20261108';
async function requirePublished(db: ArchiveQueryable) {
 const [r]=await db.query<RowDataPacket[]>('SELECT id FROM t156_dataset WHERE id=? AND status=\'published\'',[ID]);
 if(!r.length) throw new Error('t156_research_not_published');
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
export async function readResearchDocuments(options:{cutoff:string;days?:number;limit?:number},db:ArchiveQueryable=getPool()) {
 if(!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(options.cutoff)||!Number.isFinite(Date.parse(options.cutoff))) throw new Error('invalid_cutoff');
 const days=options.days??14,limit=options.limit??100;
 if(!Number.isInteger(days)||days<1||days>14||!Number.isInteger(limit)||limit<1||limit>500) throw new Error('invalid_limit');
 await requirePublished(db);
 const cutoff=new Date(options.cutoff).toISOString().slice(0,23).replace('T',' ');
 const [rows]=await db.query<RowDataPacket[]>(
  `SELECT source_id,document_id,document_type,publisher,title,source_url,body_format,body_sha256,raw_bytes,
    DATE_FORMAT(published_at_utc,'%Y-%m-%dT%H:%i:%s.%fZ') AS published_at,
    DATE_FORMAT(accepted_at_utc,'%Y-%m-%dT%H:%i:%s.%fZ') AS accepted_at,
    DATE_FORMAT(observed_at_utc,'%Y-%m-%dT%H:%i:%s.%fZ') AS observed_at,
    body_gzip IS NOT NULL AS has_original,publication_precision
   FROM t156_research_backfill_document
   WHERE published_at_utc IS NOT NULL AND published_at_utc<=? AND published_at_utc>=DATE_SUB(?,INTERVAL ? DAY)
    AND observed_at_utc IS NOT NULL AND observed_at_utc<=?
    AND (accepted_at_utc IS NULL OR accepted_at_utc<=?)
   ORDER BY published_at_utc DESC,source_id,document_id LIMIT ?`,[cutoff,cutoff,days,cutoff,cutoff,limit]);
 return {datasetId:ID,rows,qualification:'known_publication_and_observation_only; missing_or_later_observation_excluded'};
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
    content=`[Archived source; format=${String(row.body_format)}; ${text.length>9800?'partial excerpt, remainder omitted':'complete stored text'}] ${text.slice(0,9800)}`;
   }catch{content=`[Metadata only; archived body exceeds context budget or is invalid] ${String(row.title??'')}`;}
  }
  const publishedAt=String(row.published_at),observedAt=String(row.observed_at);
  const availableAt=new Date(Math.max(Date.parse(publishedAt),Date.parse(observedAt),row.accepted_at?Date.parse(String(row.accepted_at)):0)).toISOString();
  evidence.push({id:`${String(row.source_id)}:${String(row.document_id)}`,
   kind:/sec/i.test(String(row.source_id))||/securities|SEC/.test(String(row.publisher))?'sec':'news',
   publishedAt,observedAt,availableAt,sourceUrl:String(row.source_url),content:content.slice(0,12000)});
 }
 return evidence;
}

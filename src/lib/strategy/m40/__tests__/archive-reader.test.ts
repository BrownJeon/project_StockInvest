import { gzipSync } from 'node:zlib';
import { readResearchEvidence, readResearchStockBars, type ResearchStockBarOptions } from '../archive-reader';
import type { ArchiveQueryable } from '@/lib/analysis-data/types';

jest.mock('@/lib/db', () => ({ getPool: jest.fn(() => { throw new Error('unexpected_real_database'); }) }));

const SOURCE='kibot_free_regular_raw_20261107';
const LEGACY='kibot_guest_raw';
type Stock = { source_id:string;vendor_ticker:string;session:string;o:string;h:string;l:string;c:string;
 volume:string;is_unadjusted:number;identity_status:string;published_at:string|null };
const comparable=(value:string):string=>{
 const normalized=value.replace(' ','T').replace(/Z$/,'');
 return normalized.slice(0,19)+'.'+(normalized.slice(20)||'').padEnd(6,'0');
};
class ResearchDb implements ArchiveQueryable {
 published=true;
 stocks:Stock[]=[];
 sessions=new Map<string,string|null>([
  ['2019-04-17',null],['2019-04-18','2019-04-18T20:00:00.000000Z'],
  ['2019-04-22','2019-04-22T20:00:00.000000Z'],['2019-04-23','2019-04-23T20:00:00.000000Z'],
 ]);
 calls:{sql:string;values:unknown[]}[]=[];
 async query<T=unknown>(sql:string,values:unknown[]=[]):Promise<[T,unknown]>{
  this.calls.push({sql,values});
  let result:unknown;
  if(sql.startsWith('SELECT id FROM t156_dataset')) result=this.published?[{id:'t156-research-db-20261108'}]:[];
  else if(sql.includes('FROM t156_research_backfill_stock_bar b')) {
   const [source,ticker,publishedCutoff,sessionCutoff,through,limit]=values;
   result=this.stocks.filter(stock=>stock.source_id===source&&stock.vendor_ticker===ticker
    &&stock.published_at!==null&&comparable(stock.published_at)<=comparable(String(publishedCutoff))
    &&this.sessions.get(stock.session)!=null&&comparable(this.sessions.get(stock.session)!)<=comparable(String(sessionCutoff))
    &&stock.session<=String(through))
    .sort((a,b)=>b.session.localeCompare(a.session)).slice(0,Number(limit))
    .map(stock=>({...stock,session_close_utc:this.sessions.get(stock.session)}));
  } else throw new Error('unexpected_reader_query');
  return [result as T,undefined];
 }
}
function stock(overrides:Partial<Stock>={}):Stock {
 return {source_id:SOURCE,vendor_ticker:'AAPL',session:'2019-04-22',o:'150.12345678',h:'153.12345678',l:'149.12345678',c:'152.12345678',
  volume:'9007199254740993',is_unadjusted:1,identity_status:'unknown_historical_identity',published_at:'2019-04-22T20:00:00.000000Z',...overrides};
}
const options:ResearchStockBarOptions={sourceId:SOURCE,vendorTicker:'AAPL',cutoff:'2019-04-22T20:05:00Z',throughSession:'2019-04-22'};

describe('published research stock prices for operating analytics',()=>{
 test('reads one explicit source, preserving decimal strings, unknown identity and reconstruction labels',async()=>{
  const db=new ResearchDb();db.stocks=[stock(),stock({source_id:LEGACY,c:'999.00000000'})];
  const result=await readResearchStockBars(options,db);
  expect(result).toMatchObject({datasetId:'t156-research-db-20261108',sourceId:SOURCE,vendorTicker:'AAPL',
   qualification:'research_only',liveEligible:false,availability:'publication_reconstructed; first_observed_unknown',firstObservedAt:null,currency:null});
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({source_id:SOURCE,o:'150.12345678',c:'152.12345678',volume:'9007199254740993',
   identity_status:'unknown_historical_identity',price_basis:'raw',published_at:'2019-04-22T20:00:00.000000Z',session_close_utc:'2019-04-22T20:00:00.000000Z'});
 });

 test('does not fall back to a different raw source when the requested source is empty',async()=>{
  const db=new ResearchDb();db.stocks=[stock({source_id:LEGACY})];
  expect((await readResearchStockBars(options,db)).rows).toEqual([]);
 });

 test('rejects unpublished archives before querying source data',async()=>{
  const db=new ResearchDb();db.published=false;db.stocks=[stock()];
  await expect(readResearchStockBars(options,db)).rejects.toThrow('t156_research_not_published');
  expect(db.calls).toHaveLength(1);
 });

 test('canonical sessions exclude Good Friday phantom rows, missing closes and unknown publication',async()=>{
  const db=new ResearchDb();db.stocks=[stock(),
   stock({session:'2019-04-19',published_at:'2019-04-19T20:00:00.000000Z'}),
   stock({session:'2019-04-17',published_at:'2019-04-17T20:00:00.000000Z'}),
   stock({session:'2019-04-18',published_at:null})];
  const result=await readResearchStockBars(options,db);
  expect(result.rows.map(row=>row.session)).toEqual(['2019-04-22']);
  const sql=db.calls[1].sql;
  expect(sql).toContain('JOIN t156_research_backfill_session s ON s.trade_date=b.trade_date');
  expect(sql).toContain('b.published_at_utc IS NOT NULL');
  expect(sql).toContain('s.closes_at_utc IS NOT NULL');
 });

 test('both publication and session close must be known at the exact cutoff',async()=>{
  const db=new ResearchDb();db.stocks=[stock({published_at:'2019-04-22T20:00:00.000001Z'}),
   stock({session:'2019-04-23',published_at:'2019-04-18T20:00:00.000000Z'}),
   stock({session:'2019-04-18',published_at:'2019-04-18T20:00:00.000000Z'})];
  const result=await readResearchStockBars({...options,cutoff:'2019-04-22T20:00:00.000000Z',throughSession:'2019-04-23'},db);
  expect(result.rows.map(row=>row.session)).toEqual(['2019-04-18']);
 });

 test('a current session before its close is excluded even when a publication timestamp exists',async()=>{
  const db=new ResearchDb();db.stocks=[stock({published_at:'2019-04-22T19:59:59.000000Z'})];
  expect((await readResearchStockBars({...options,cutoff:'2019-04-22T19:59:59Z'},db)).rows).toEqual([]);
 });

 test('throughSession and row limit apply to the descending canonical series',async()=>{
  const db=new ResearchDb();db.stocks=[stock(),stock({session:'2019-04-18',published_at:'2019-04-18T20:00:00.000000Z'})];
  const limited=await readResearchStockBars({...options,limit:1},db);
  expect(limited.rows.map(row=>row.session)).toEqual(['2019-04-22']);
  const earlier=await readResearchStockBars({...options,throughSession:'2019-04-18'},db);
  expect(earlier.rows.map(row=>row.session)).toEqual(['2019-04-18']);
 });

 test('adjustment flags cannot imply split-only adjusted prices',async()=>{
  const db=new ResearchDb();db.stocks=[stock({is_unadjusted:0})];
  const result=await readResearchStockBars(options,db);
  expect(result.rows[0].price_basis).toBe('unknown_adjusted');
  expect(result.rows[0].is_unadjusted).toBe(0);
  expect(JSON.stringify(result)).not.toContain('split_adjusted');
 });

 test('all source, ticker, cutoff, session and limit values are bound, preserving microseconds',async()=>{
  const db=new ResearchDb();
  await readResearchStockBars({...options,cutoff:'2019-04-22T20:05:00.123456Z',limit:10000},db);
  expect(db.calls[1].values).toEqual([SOURCE,'AAPL','2019-04-22 20:05:00.123456','2019-04-22 20:05:00.123456','2019-04-22',10000]);
  expect(db.calls[1].sql).not.toContain(SOURCE);
  expect(db.calls[1].sql).not.toContain('AAPL');
  expect(db.calls[1].sql).toContain('CAST(b.c AS CHAR)');
  expect(db.calls[1].sql).toContain('CAST(b.volume AS CHAR)');
  expect(db.calls.every(call=>/^SELECT\b/.test(call.sql))).toBe(true);
  expect(db.calls.every(call=>!/\b(daily_bars|closed_trade|orders|signals|position_state|system_config|trade_logs)\b/.test(call.sql))).toBe(true);
 });

 test('default limit is 260',async()=>{
  const db=new ResearchDb();await readResearchStockBars(options,db);
  expect(db.calls[1].values.at(-1)).toBe(260);
 });

 test.each([0,10001,1.1])('rejects invalid limit %s before database access',async limit=>{
  const db=new ResearchDb();await expect(readResearchStockBars({...options,limit},db)).rejects.toThrow('invalid_limit');
  expect(db.calls).toHaveLength(0);
 });

 test.each(['2019-02-29','2019-04-31','2019-04-22;DELETE'])('rejects invalid session %s',async throughSession=>{
  const db=new ResearchDb();await expect(readResearchStockBars({...options,throughSession},db)).rejects.toThrow('invalid_session');
  expect(db.calls).toHaveLength(0);
 });

 test.each(['2019-02-29T20:00:00Z','2019-04-22T24:00:00Z','2019-04-22T20:00:00','2019-04-22T20:00:00+00:00'])('rejects invalid or ambiguous UTC cutoff %s',async cutoff=>{
  const db=new ResearchDb();await expect(readResearchStockBars({...options,cutoff},db)).rejects.toThrow('invalid_cutoff');
  expect(db.calls).toHaveLength(0);
 });

 test.each(['','x'.repeat(51),"source' OR 1=1",undefined])('requires a valid explicit source %s',async sourceId=>{
  const db=new ResearchDb();await expect(readResearchStockBars({...options,sourceId:sourceId as string},db)).rejects.toThrow('invalid_source');
  expect(db.calls).toHaveLength(0);
 });

 test.each(['','x'.repeat(25),'AAPL;DROP TABLE',undefined])('rejects invalid vendor ticker %s',async vendorTicker=>{
  const db=new ResearchDb();await expect(readResearchStockBars({...options,vendorTicker:vendorTicker as string},db)).rejects.toThrow('invalid_symbol');
  expect(db.calls).toHaveLength(0);
 });
});

describe('archived model context coverage labels',()=>{
 test.each([[false,'short stored text'],[true,'x'.repeat(10_000)]] as const)(
  'labels stored context separately from source coverage (excerpt=%s)',async(excerpt,text)=>{
   const db:ArchiveQueryable={async query<T>(sql:string):Promise<[T,unknown]>{
    let rows:unknown;
    if(sql.startsWith('SELECT id FROM t156_dataset')) rows=[{id:'t156-research-db-20261108'}];
    else if(sql.includes('SELECT body_gzip')) rows=[{body_gzip:gzipSync(text)}];
    else if(sql.includes('FROM t156_research_backfill_document')) rows=[{
     source_id:'sec_fixture',document_id:'doc-1',published_at:'2019-04-22T20:00:00Z',observed_at:'2019-04-22T20:01:00Z',
     accepted_at:null,source_url:'https://www.sec.gov/example',publisher:'SEC',body_format:'partial_source_text',title:'Document title',
    }];
    else throw new Error('unexpected_evidence_query');
    return [rows as T,undefined];
   }};
   const evidence=await readResearchEvidence(options.cutoff,db);
   expect(evidence).toHaveLength(1);
   expect(evidence[0].content).toContain('format=partial_source_text');
   expect(evidence[0].content).not.toContain('complete stored text');
   expect(evidence[0].content).toContain(excerpt?'partial excerpt, remainder omitted':'stored text; original coverage follows body_format; original extent unverified');
   expect(evidence[0].content.length).toBeLessThanOrEqual(12000);
  });
});

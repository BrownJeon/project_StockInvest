import { gzipSync } from 'node:zlib';
import { readResearchDocuments, readResearchEvidence, readResearchMarket, readResearchStockBars, type ResearchStockBarOptions } from '../archive-reader';
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
 metadata:unknown=null;
 stocks:Stock[]=[];
 sessions=new Map<string,string|null>([
  ['2019-04-17',null],['2019-04-18','2019-04-18T20:00:00.000000Z'],
  ['2019-04-22','2019-04-22T20:00:00.000000Z'],['2019-04-23','2019-04-23T20:00:00.000000Z'],
 ]);
 calls:{sql:string;values:unknown[]}[]=[];
 async query<T=unknown>(sql:string,values:unknown[]=[]):Promise<[T,unknown]>{
  this.calls.push({sql,values});
  let result:unknown;
  if(sql.startsWith('SELECT id')&&sql.includes('FROM t156_dataset')) result=this.published?[{id:'t156-research-db-20261108',metadata_json:this.metadata}]:[];
  else if(sql.includes('FROM t156_research_backfill_stock_bar b')) {
   const [verifiedValue,source,ticker,verifiedPredicate,availableCutoff,sessionCutoff,through,limit]=values;
   expect(verifiedValue).toBe(verifiedPredicate);
   const verified=verifiedValue===null?null:String(verifiedValue).replace(' ','T')+'Z';
   result=this.stocks.filter(stock=>stock.source_id===source&&stock.vendor_ticker===ticker
    &&(stock.published_at??verified)!==null&&comparable((stock.published_at??verified)!)<=comparable(String(availableCutoff))
    &&this.sessions.get(stock.session)!=null&&comparable(this.sessions.get(stock.session)!)<=comparable(String(sessionCutoff))
    &&stock.session<=String(through))
    .sort((a,b)=>b.session.localeCompare(a.session)).slice(0,Number(limit))
    .map(stock=>({...stock,available_at:comparable((stock.published_at??verified)! )+'Z',session_close_utc:this.sessions.get(stock.session)}));
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
   qualification:'research_only',liveEligible:false,availability:'source_time_or_verified_archive_observation; first_observed_unknown',firstObservedAt:null,currency:null});
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({source_id:SOURCE,o:'150.12345678',c:'152.12345678',volume:'9007199254740993',
   identity_status:'unknown_historical_identity',price_basis:'raw',published_at:'2019-04-22T20:00:00.000000Z',
   available_at:'2019-04-22T20:00:00.000000Z',availability_basis:'source_time',archive_verified_at:null,session_close_utc:'2019-04-22T20:00:00.000000Z'});
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
  expect(sql).toContain('COALESCE(b.published_at_utc,CAST(? AS DATETIME(6)))');
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
  expect(db.calls[1].values).toEqual([null,SOURCE,'AAPL',null,'2019-04-22 20:05:00.123456','2019-04-22 20:05:00.123456','2019-04-22',10000]);
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

 test('unknown source publication becomes observable only at the real archive-verification instant',async()=>{
  const db=new ResearchDb();
  db.metadata=JSON.stringify({verification:{verifiedAt:'2026-11-08T01:00:00.123Z'}});
  db.stocks=[stock({published_at:null})];
  const before=await readResearchStockBars({...options,cutoff:'2026-11-08T01:00:00.122999Z'},db);
  expect(before.rows).toEqual([]);
  const after=await readResearchStockBars({...options,cutoff:'2026-11-08T01:00:00.123000Z'},db);
  expect(after.rows).toHaveLength(1);
  expect(after.rows[0]).toMatchObject({published_at:null,available_at:'2026-11-08T01:00:00.123000Z',
   availability_basis:'verified_archive_observation',archive_verified_at:'2026-11-08T01:00:00.123Z'});
  expect(after).toMatchObject({archive_verified_at:'2026-11-08T01:00:00.123Z',firstObservedAt:null,liveEligible:false,qualification:'research_only',currency:null});
  expect(db.stocks[0].published_at).toBeNull();
  expect(db.calls.every(call=>/^SELECT\b/.test(call.sql))).toBe(true);
  expect(db.calls.at(-1)!.values.slice(0,4)).toEqual(['2026-11-08 01:00:00.123',SOURCE,'AAPL','2026-11-08 01:00:00.123']);
 });

 test('known publication remains the source availability even before a later archive verification',async()=>{
  const db=new ResearchDb();db.metadata={verification:{verifiedAt:'2026-11-08T01:00:00.123Z'}};db.stocks=[stock()];
  const result=await readResearchStockBars(options,db);
  expect(result.rows[0]).toMatchObject({published_at:'2019-04-22T20:00:00.000000Z',available_at:'2019-04-22T20:00:00.000000Z',
   availability_basis:'source_time',archive_verified_at:'2026-11-08T01:00:00.123Z'});
 });

 test('a known future source publication cannot fall back to an earlier archive observation',async()=>{
  const db=new ResearchDb();db.metadata={verification:{verifiedAt:'2019-04-22T20:00:00.000Z'}};
  db.stocks=[stock({published_at:'2019-04-23T20:00:00.000000Z'})];
  expect((await readResearchStockBars(options,db)).rows).toEqual([]);
 });

 test('an archive-observed row still requires the canonical session to have closed',async()=>{
  const db=new ResearchDb();db.metadata={verification:{verifiedAt:'2019-04-23T19:00:00.000Z'}};
  db.stocks=[stock({session:'2019-04-23',published_at:null})];
  expect((await readResearchStockBars({...options,throughSession:'2019-04-23',cutoff:'2019-04-23T19:59:59Z'},db)).rows).toEqual([]);
 });

 test.each([null,'not JSON',{}, {verification:{}},{verification:{verifiedAt:'2026-11-08'}},
  {verification:{verifiedAt:'2026-02-30T01:00:00Z'}},{verification:{verifiedAt:'2026-11-08T01:00:00+00:00'}}])(
  'invalid/missing verification metadata never invents unknown source publication (%j)',async metadata=>{
   const db=new ResearchDb();db.metadata=metadata;
   db.stocks=[stock({published_at:null}),stock({session:'2019-04-18',published_at:'2019-04-18T20:00:00.000000Z'})];
   const result=await readResearchStockBars(options,db);
   expect(result.rows.map(row=>row.session)).toEqual(['2019-04-18']);
   expect(result.archive_verified_at).toBeNull();
  });

 test('invalid nonnull source publication is excluded rather than overwritten with an archive clock',async()=>{
  const db=new ResearchDb();db.metadata={verification:{verifiedAt:'2019-04-22T20:00:00.000Z'}};
  db.stocks=[stock({published_at:'0000-00-00T00:00:00.000000Z'})];
  expect((await readResearchStockBars(options,db)).rows).toEqual([]);
 });

 test('market readers keep their original publication guard without requesting verification metadata',async()=>{
  const calls:string[]=[];
  const db:ArchiveQueryable={async query<T>(sql:string):Promise<[T,unknown]>{
   calls.push(sql);return [(sql.startsWith('SELECT id FROM t156_dataset')?[{id:'t156-research-db-20261108'}]:[]) as T,undefined];
  }};
  await readResearchMarket({throughSession:'2019-04-22'},db);
  expect(calls[0]).toBe("SELECT id FROM t156_dataset WHERE id=? AND status='published'");
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

type DocumentRow={source_id:string;document_id:string;published_at:string|null;accepted_at:string|null;observed_at:string|null;
 source_url:string;publisher:string;body_format:string;title:string};
function document(overrides:Partial<DocumentRow>={}):DocumentRow {
 return {source_id:'free_sec_original_20261107',document_id:'0000320193-26-000001',published_at:null,
  accepted_at:'2026-11-07T20:00:00.000000Z',observed_at:'2026-11-07T20:02:00.000000Z',
  source_url:'https://www.sec.gov/Archives/document.htm',publisher:'SEC',body_format:'sec_primary_html_original',title:'Filed report',...overrides};
}
class DocumentDb implements ArchiveQueryable {
 calls:{sql:string;values:unknown[]}[]=[];
 constructor(public documents:DocumentRow[]){}
 async query<T=unknown>(sql:string,values:unknown[]=[]):Promise<[T,unknown]>{
  this.calls.push({sql,values});let rows:unknown;
  if(sql.startsWith('SELECT id FROM t156_dataset')) rows=[{id:'t156-research-db-20261108'}];
  else if(sql.startsWith('SELECT body_gzip')) rows=[{body_gzip:gzipSync('Stored SEC document text')}];
  else if(sql.includes('FROM t156_research_backfill_document')) {
   const [cutoff,,days,,,limit]=values;
   const end=comparable(String(cutoff));
   const start=new Date(Date.parse(end.slice(0,19)+'Z')-Number(days)*86_400_000).toISOString().slice(0,19)+end.slice(19);
   rows=this.documents.map(row=>({...row,effective_publication_at:row.published_at??(
    ['free_sec_original_20261107','sec_edgar_priority'].includes(row.source_id)?row.accepted_at:null),
    publication_basis:row.published_at===null?'sec_acceptance_proxy':'source_publication'}))
    .filter(row=>row.effective_publication_at!==null&&comparable(row.effective_publication_at)>=start&&comparable(row.effective_publication_at)<=end
     &&row.observed_at!==null&&comparable(row.observed_at)<=end&&(row.accepted_at===null||comparable(row.accepted_at)<=end))
    .sort((a,b)=>comparable(b.effective_publication_at!).localeCompare(comparable(a.effective_publication_at!))||a.source_id.localeCompare(b.source_id)||a.document_id.localeCompare(b.document_id))
    .slice(0,Number(limit));
  }else throw new Error('unexpected_document_query');
  return [rows as T,undefined];
 }
}

describe('explicit SEC acceptance proxy for archived originals',()=>{
 const cutoff='2026-11-08T00:00:00Z';
 test('only the two approved SEC sources use acceptance while raw publication remains null',async()=>{
  const db=new DocumentDb([document(),document({source_id:'sec_edgar_priority',document_id:'second'}),
   document({source_id:'sec_edgar_priority_extra',document_id:'not-allowlisted'}),document({source_id:'other_sec_source',document_id:'unknown'})]);
  const result=await readResearchDocuments({cutoff},db);
  expect(result.rows).toHaveLength(2);
  expect(result.rows.every(row=>row.published_at===null&&row.publication_basis==='sec_acceptance_proxy'
   &&row.effective_publication_at==='2026-11-07T20:00:00.000000Z')).toBe(true);
  expect(db.documents.every(row=>row.published_at===null)).toBe(true);
  const sql=db.calls[1].sql;
  expect(sql).toContain("source_id IN ('free_sec_original_20261107','sec_edgar_priority')");
  expect(sql).toContain('ELSE NULL END');
  expect(sql).not.toContain('LIKE');
 });

 test('known source publication is preserved and does not use the acceptance proxy',async()=>{
  const db=new DocumentDb([document({source_id:'other_news_source',published_at:'2026-11-07T20:01:00.000000Z',accepted_at:null})]);
  const result=await readResearchDocuments({cutoff},db);
  expect(result.rows[0]).toMatchObject({published_at:'2026-11-07T20:01:00.000000Z',effective_publication_at:'2026-11-07T20:01:00.000000Z',publication_basis:'source_publication'});
 });

 test('future or stale known publication cannot fall back to a recent SEC acceptance',async()=>{
  const db=new DocumentDb([document({published_at:'2026-11-09T00:00:00.000000Z'}),
   document({document_id:'old-publication',published_at:'2020-01-02T00:00:00.000000Z'})]);
  expect((await readResearchDocuments({cutoff},db)).rows).toEqual([]);
 });

 test('future acceptance, future observation and unknown observation remain excluded',async()=>{
  const db=new DocumentDb([document({accepted_at:'2026-11-09T00:00:00.000000Z'}),
   document({document_id:'future-observed',observed_at:'2026-11-09T00:00:00.000000Z'}),
   document({document_id:'unknown-observed',observed_at:null}),
   document({document_id:'known-pub-future-acceptance',published_at:'2026-11-07T20:00:00.000000Z',accepted_at:'2026-11-09T00:00:00.000000Z'})]);
  expect((await readResearchDocuments({cutoff},db)).rows).toEqual([]);
  expect(db.calls[1].sql).toContain('observed_at_utc IS NOT NULL AND observed_at_utc<=?');
  expect(db.calls[1].sql).toContain('accepted_at_utc IS NULL OR accepted_at_utc<=?');
 });

 test('the effective clock uses an inclusive fourteen-day window without losing microseconds',async()=>{
  const edge='2026-10-25T00:00:00.123456Z';
  const db=new DocumentDb([document({accepted_at:edge,observed_at:'2026-10-25T00:01:00.000000Z'}),
   document({document_id:'one-microsecond-old',accepted_at:'2026-10-25T00:00:00.123455Z',observed_at:'2026-10-25T00:01:00.000000Z'})]);
  const result=await readResearchDocuments({cutoff:'2026-11-08T00:00:00.123456Z'},db);
  expect(result.rows).toHaveLength(1);expect(result.rows[0].effective_publication_at).toBe(edge);
  expect(db.calls[1].values).toEqual(['2026-11-08 00:00:00.123456','2026-11-08 00:00:00.123456',14,'2026-11-08 00:00:00.123456','2026-11-08 00:00:00.123456',100]);
 });

 test('model evidence names the acceptance proxy and preserves the actual observation clock',async()=>{
  const db=new DocumentDb([document()]);
  const evidence=await readResearchEvidence(cutoff,db);
  expect(evidence).toHaveLength(1);
  expect(evidence[0]).toMatchObject({kind:'sec',publishedAt:'2026-11-07T20:00:00.000000Z',observedAt:'2026-11-07T20:02:00.000000Z',availableAt:'2026-11-07T20:02:00.000000Z'});
  expect(evidence[0].content).toContain('SEC acceptance-time proxy; real dissemination time unknown');
  expect(evidence[0].content).toContain('does not establish full public availability');
  expect(evidence[0].content).toContain('First observation uses the recorded observed_at');
  expect(evidence[0].content.length).toBeLessThanOrEqual(12000);
 });

 test.each([
  ['2026-11-07T20:02:00.123455Z','2026-11-07T20:02:00.123456Z','2026-11-07T20:02:00.123456Z'],
  ['2026-11-07T20:02:00.123456Z','2026-11-07T20:02:00.123455Z','2026-11-07T20:02:00.123456Z'],
  ['2026-11-07T20:02:00.123Z','2026-11-07T20:02:00.123001Z','2026-11-07T20:02:00.123001Z'],
 ])('preserves the exact maximum source clock (accepted=%s, observed=%s)',async(acceptedAt,observedAt,availableAt)=>{
  const publishedAt='2026-11-07T20:00:00.000000Z';
  const db=new DocumentDb([document({published_at:publishedAt,accepted_at:acceptedAt,observed_at:observedAt})]);
  const evidence=await readResearchEvidence(cutoff,db);
  expect(evidence).toHaveLength(1);
  expect(evidence[0]).toMatchObject({publishedAt,observedAt,availableAt});
  expect(db.documents[0]).toMatchObject({published_at:publishedAt,accepted_at:acceptedAt,observed_at:observedAt});
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

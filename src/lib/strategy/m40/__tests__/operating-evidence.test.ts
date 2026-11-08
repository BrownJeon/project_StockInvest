import { readOperatingM40Evidence } from '../operating-evidence';
import { validateEvidence } from '../advisory';
import type { ArchiveQueryable } from '@/lib/analysis-data/types';

jest.mock('@/lib/db', () => ({ getPool: jest.fn(() => { throw new Error('unexpected_real_database'); }) }));

type Row=Record<string,any>;
const cutoff='2026-11-08T00:00:00Z';
function news():Row {
 return {record_type:'operating_corporate_item',record_key:'v1:ci_raw_item:original-version',available_at:'2026-11-07T20:02:00.000000Z',
  dataset_status:'published',dataset_kind:'operating_incremental_capture',payload_json:{
   schemaVersion:1,sourceTable:'ci_raw_item',sourceClockZone:'Asia/Seoul',versionSha256:'a'.repeat(64),liveEligible:false,
   availableAt:'2026-11-07T20:02:00.000000Z',bodyCoverage:'metadata_only_no_article_body',
   clocksUtc:{published_at:'2026-11-07T20:00:00.000000Z',first_seen_at:'2026-11-07T20:01:00.000000Z',last_seen_at:'2026-11-07T20:02:00.000000Z'},
   sourceRow:{raw_id:'12345678901234567890',source_kind:'rss',source_key:'b'.repeat(64),version:'1',content_sha256:'c'.repeat(64),
    availability:'captured',published_at:'2026-11-08 05:00:00.000000',first_seen_at:'2026-11-08 05:01:00.000000',last_seen_at:'2026-11-08 05:02:00.000000',
    url:'https://news.example/article',guid:'source-guid',feed_host:'news.example',publisher:null,title:'Published company update',
    snippet:null,payload_ref:'private://DO_NOT_EGRESS',parser_version:'PRIVATE_PARSER',run_id:'PRIVATE_RUN'},
   sourceVersionJson:'PRIVATE_SOURCE_ROW_SERIALIZATION',
  }};
}
function filing():Row {
 return {record_type:'operating_sec_filing',record_key:'v1:us_filings:sec-version',available_at:'2026-11-07T19:02:00.000000Z',
  dataset_status:'published',dataset_kind:'operating_incremental_capture',payload_json:{
   schemaVersion:1,sourceTable:'us_filings',sourceClockZone:'Asia/Seoul',versionSha256:'d'.repeat(64),liveEligible:false,
   availableAt:'2026-11-07T19:02:00.000000Z',bodyCoverage:'metadata_only_no_document_body',
   clocksUtc:{accepted_at:'2026-11-07T19:00:00.000000Z',created_at:'2026-11-07T19:01:00.000000Z',updated_at:'2026-11-07T19:02:00.000000Z'},
   sourceRow:{accession:'0000320193-26-000001',cik:'320193',form:'8-K',items:'2.02',report_date:'2026-11-07',filed:'2026-11-07',
    accepted_at:'2026-11-08 04:00:00.000000',created_at:'2026-11-08 04:01:00.000000',updated_at:'2026-11-08 04:02:00.000000',
    primary_doc_url:'https://www.sec.gov/Archives/example.htm',is_earnings_release:'1',unknown_private_field:'PRIVATE_INTERNAL'},
   sourceVersionJson:'PRIVATE_SEC_ROW_SERIALIZATION',
  }};
}
/** Controlled records intentionally include invalid rows, testing independent reader gates. */
class EvidenceDb implements ArchiveQueryable {
 calls:{sql:string;values:unknown[]}[]=[];
 constructor(public records:Row[]){}
 async query<T=unknown>(sql:string,values:unknown[]=[]):Promise<[T,unknown]>{
  this.calls.push({sql,values});return [this.records as T,undefined];
 }
}
function mutate(row:Row,change:(payload:Row)=>void):Row {change(row.payload_json);return row;}

describe('captured operating evidence reused by M40 shadow analysis',()=>{
 test('reads actual SEC/news capture shapes, preserving distinct clocks and metadata-only labels',async()=>{
  const db=new EvidenceDb([filing(),news()]);
  const evidence=await readOperatingM40Evidence(cutoff,db);
  expect(evidence.map(item=>item.kind)).toEqual(['news','sec']);
  expect(evidence[0]).toMatchObject({publishedAt:'2026-11-07T20:00:00.000000Z',observedAt:'2026-11-07T20:01:00.000000Z',availableAt:'2026-11-07T20:02:00.000000Z'});
  expect(evidence[0].content).toContain('news metadata only; article body unavailable');
  expect(evidence[0].content).toContain('First observed UTC: 2026-11-07T20:01:00.000000Z');
  expect(evidence[1].content).toContain('SEC metadata only; filing body unavailable');
  expect(evidence[1].content).toContain('Form: 8-K');
  expect(evidence[1].content).toContain('Accession: 0000320193-26-000001');
  expect(evidence[1].content).toContain('CIK: 320193');
  expect(evidence[1].content).toContain('Items: 2.02');
  expect(evidence[1].content).toContain('CIK-to-symbol mapping unavailable');
  expect(evidence.every(item=>!('symbol' in item))).toBe(true);
  expect(validateEvidence(evidence,cutoff)).toBeNull();
 });

 test('public context omits the sourceRow object, internal references, parser/run values and private fields',async()=>{
  const evidence=await readOperatingM40Evidence(cutoff,new EvidenceDb([news(),filing()]));
  const serialized=JSON.stringify(evidence);
  for(const secret of ['sourceRow','payload_ref','PRIVATE_PARSER','PRIVATE_RUN','DO_NOT_EGRESS','PRIVATE_INTERNAL','PRIVATE_SOURCE_ROW_SERIALIZATION'])
   expect(serialized).not.toContain(secret);
  expect(evidence.every(item=>item.content.includes('Material-event classification is not asserted'))).toBe(true);
 });

 test('a newly observed 2020 publication remains archived but is not recent model evidence',async()=>{
  const old=mutate(news(),payload=>{
   payload.clocksUtc.published_at='2020-01-02T00:00:00.000000Z';payload.sourceRow.published_at='2020-01-02 09:00:00.000000';
  });
  expect(await readOperatingM40Evidence(cutoff,new EvidenceDb([old,filing()]))).toHaveLength(1);
  expect((await readOperatingM40Evidence(cutoff,new EvidenceDb([old])))).toEqual([]);
 });

 test.each(['published','first-seen','updated','row-availability','payload-availability'])('excludes unknown %s clocks without assigning invented dates',async missing=>{
  const row=news();
  if(missing==='published'){row.payload_json.clocksUtc.published_at=null;row.payload_json.sourceRow.published_at=null;}
  if(missing==='first-seen'){row.payload_json.clocksUtc.first_seen_at=null;row.payload_json.sourceRow.first_seen_at=null;}
  if(missing==='updated'){row.payload_json.clocksUtc.last_seen_at=null;row.payload_json.sourceRow.last_seen_at=null;}
  if(missing==='row-availability')row.available_at=null;
  if(missing==='payload-availability')row.payload_json.availableAt=null;
  const evidence=await readOperatingM40Evidence(cutoff,new EvidenceDb([row,filing()]));
  expect(evidence.map(item=>item.kind)).toEqual(['sec']);
 });

 test('original missing first-seen cannot be repaired by an unproven derived UTC clock',async()=>{
  const row=mutate(news(),payload=>{payload.sourceRow.first_seen_at=null;});
  expect(await readOperatingM40Evidence(cutoff,new EvidenceDb([row]))).toEqual([]);
 });

 test('future source clocks and versions are excluded relative to the frozen analysis cutoff',async()=>{
  const future=mutate(news(),payload=>{
   payload.clocksUtc.last_seen_at='2026-11-08T00:00:00.000001Z';payload.sourceRow.last_seen_at='2026-11-08 09:00:00.000001';
   payload.availableAt='2026-11-08T00:00:00.000001Z';
  });future.available_at='2026-11-08T00:00:00.000001Z';
  const inconsistent=mutate(news(),payload=>{
   payload.clocksUtc.published_at='2026-11-08T00:01:00.000000Z';payload.sourceRow.published_at='2026-11-08 09:01:00.000000';
  });
  const evidence=await readOperatingM40Evidence(cutoff,new EvidenceDb([future,inconsistent,filing()]));
  expect(evidence.map(item=>item.kind)).toEqual(['sec']);
 });

 test('uses the inclusive fourteen-day publication boundary with exact microsecond cutoff',async()=>{
  const edge=mutate(news(),payload=>{
   payload.clocksUtc.published_at='2026-10-25T00:00:00.123456Z';payload.sourceRow.published_at='2026-10-25 09:00:00.123456';
  });
  const older=mutate(news(),payload=>{
   payload.clocksUtc.published_at='2026-10-25T00:00:00.123455Z';payload.sourceRow.published_at='2026-10-25 09:00:00.123455';
   payload.sourceRow.url='https://news.example/too-old';
  });
  const evidence=await readOperatingM40Evidence('2026-11-08T00:00:00.123456Z',new EvidenceDb([older,edge]));
  expect(evidence).toHaveLength(1);
  expect(evidence[0].publishedAt).toBe('2026-10-25T00:00:00.123456Z');
 });

 test('deduplicates URLs to the newest eligible version while keeping IDs stable on replay',async()=>{
  const old=mutate(news(),payload=>{
   payload.sourceRow.url='https://news.example/article#old';payload.sourceRow.title='Old title';payload.versionSha256='e'.repeat(64);
   payload.clocksUtc.last_seen_at='2026-11-07T20:01:00.000000Z';payload.sourceRow.last_seen_at='2026-11-08 05:01:00.000000';
   payload.availableAt='2026-11-07T20:01:00.000000Z';
  });old.available_at='2026-11-07T20:01:00.000000Z';
  const latest=mutate(news(),payload=>{payload.sourceRow.url='https://news.example/article#latest';payload.sourceRow.title='Latest title';});
  const first=await readOperatingM40Evidence(cutoff,new EvidenceDb([old,latest]));
  const replay=await readOperatingM40Evidence(cutoff,new EvidenceDb([latest,old]));
  expect(first).toEqual(replay);
  expect(first).toHaveLength(1);
  expect(first[0].sourceUrl).toBe('https://news.example/article');
  expect(first[0].content).toContain('Latest title');
  expect(first[0].content).not.toContain('Old title');
  expect(first[0].id).toMatch(/^operating:item:[0-9a-f]{64}$/);
  const prior=await readOperatingM40Evidence(cutoff,new EvidenceDb([old]));
  expect(prior[0].id).not.toBe(first[0].id);
 });

 test.each(['https://user:secret@example.com/story','javascript:alert(1)','not a URL','https://news.example/has space'])('rejects unsafe source URL %s independently',async sourceUrl=>{
  const invalid=mutate(news(),payload=>{payload.sourceRow.url=sourceUrl;});
  const evidence=await readOperatingM40Evidence(cutoff,new EvidenceDb([invalid,filing()]));
  expect(evidence.map(item=>item.kind)).toEqual(['sec']);
  expect(JSON.stringify(evidence)).not.toContain('secret');
 });

 test('malformed JSON, staged/wrong datasets, unknown source kinds and reconstructed observations do not remove valid peers',async()=>{
  const malformed={...news(),payload_json:'not-json'};
  const staged={...news(),dataset_status:'staged'};
  const wrong={...news(),dataset_kind:'simulation_result'};
  const reconstructed=mutate(news(),payload=>{payload.sourceRow.availability='reconstructed';});
  const unknown=mutate(news(),payload=>{payload.sourceRow.source_kind='kis_snapshot';});
  const wrongSchema=mutate(news(),payload=>{payload.schemaVersion=2;});
  const wrongZone=mutate(news(),payload=>{payload.sourceClockZone='UTC';});
  const evidence=await readOperatingM40Evidence(cutoff,new EvidenceDb([malformed,staged,wrong,reconstructed,unknown,wrongSchema,wrongZone,filing()]));
  expect(evidence.map(item=>item.kind)).toEqual(['sec']);
 });

 test('at most six public excerpts fit each 12k and total 64k character budgets',async()=>{
  const records=Array.from({length:8},(_,index)=>mutate(news(),payload=>{
   payload.sourceRow.raw_id=String(100+index);payload.sourceRow.url=`https://news.example/item-${index}`;
   payload.sourceRow.snippet='s'.repeat(30_000);
  }));
  const evidence=await readOperatingM40Evidence(cutoff,new EvidenceDb(records));
  expect(evidence).toHaveLength(6);
  expect(evidence.every(item=>item.content.length<=12000)).toBe(true);
  expect(evidence.reduce((sum,item)=>sum+item.content.length,0)).toBeLessThanOrEqual(64000);
  expect(evidence.every(item=>item.content.includes('stored snippet only; full article body unavailable'))).toBe(true);
  expect(evidence.at(-1)!.content).toContain('Context excerpt truncated; remainder omitted');
  expect(validateEvidence(evidence,cutoff)).toBeNull();
 });

 test('queries only published generic archive tables and binds exact analysis cutoff and publication window',async()=>{
  const db=new EvidenceDb([]);await readOperatingM40Evidence('2026-11-08T00:00:00.123456Z',db);
  expect(db.calls).toHaveLength(1);
  const query=db.calls[0];
  expect(query.values).toEqual(['2026-11-08 00:00:00.123456','2026-10-25T00:00:00.123456Z','2026-11-08T00:00:00.123456Z',256]);
  expect(query.sql).toContain("d.status='published'");
  expect(query.sql).toContain("d.kind='operating_incremental_capture'");
  expect(query.sql).toContain('r.available_at IS NOT NULL AND r.available_at<=?');
  expect(query.sql).toContain('$.clocksUtc.accepted_at');expect(query.sql).toContain('$.clocksUtc.published_at');
  expect(query.sql).not.toContain(cutoff);
  expect(query.sql).toMatch(/^SELECT\b/);
  expect(query.sql).not.toMatch(/\b(FROM|JOIN)\s+(daily_bars|us_filings|ci_raw_item|orders|signals|system_config|closed_trade)\b/i);
 });

 test.each(['2026-02-30T00:00:00Z','2026-11-08T24:00:00Z','2026-11-08T00:00:00','2026-11-08T00:00:00+00:00'])('rejects invalid/ambiguous cutoff %s before querying',async invalid=>{
  const db=new EvidenceDb([]);await expect(readOperatingM40Evidence(invalid,db)).rejects.toThrow('invalid_cutoff');
  expect(db.calls).toHaveLength(0);
 });
});

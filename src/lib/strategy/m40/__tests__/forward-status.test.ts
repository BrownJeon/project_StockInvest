import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { readBlob } from '@/lib/analysis-data/store';
import { loadPaperAccount,requirePaperDryRun } from '../forward-store';
import { readM40ForwardStatus, preserveArchivedIndex, refreshMissingIndex } from '../forward-runtime';
import { forecastFixture } from './forecast-fixture';
import { collectForwardSources } from '../forward-sources';
jest.mock('@/lib/db',()=>({getPool:jest.fn()}));
jest.mock('@/lib/analysis-data/store',()=>({readBlob:jest.fn()}));
jest.mock('../forward-store',()=>({loadPaperAccount:jest.fn(),requirePaperDryRun:jest.fn()}));
const now=new Date('2026-11-10T12:00:00Z');
async function fixture(mode='forward',stale=false,calendarCount=254){
 const fullCalendar=forecastFixture(1,true).calendar.filter(day=>day.session<='2026-11-09').slice(-calendarCount);
 const stockText=fullCalendar.filter(day=>!stale||day.session!=='2026-11-09').map(day=>`${day.session.slice(5,7)}/${day.session.slice(8,10)}/${day.session.slice(0,4)},100,100,100,100,100`).join('\n');
 const indexText='DATE,SP500\n'+fullCalendar.filter(day=>day.session<'2026-11-09').map(day=>`${day.session},6000`).join('\n');
 const bundle=await collectForwardSources(['NAS:AAPL'],'2026-11-09',{
  now:()=>now,monotonicMs:()=>0,sleep:async()=>{},fetchText:async url=>({status:200,text:url.includes('kibot')?stockText:indexText})});
 const bytes=Buffer.from(JSON.stringify(bundle)),hash=createHash('sha256').update(bytes).digest('hex');
 jest.mocked(readBlob).mockResolvedValue(gzipSync(bytes));
 jest.mocked(loadPaperAccount).mockResolvedValue({status:'active',policy:{referenceSymbols:['NAS:AAPL']},book:{holdings:[]}} as never);
 const query=jest.fn(async(sql:string)=>{
  if(sql.includes('research_backfill_session'))return [fullCalendar.map(day=>({session:day.session,closeAt:day.closeAt}))];
  if(sql.includes('SELECT mode'))return [[{mode}]];
  if(sql.includes('busy'))return [[{busy:0}]];
  return [[{payload_json:{blobSha256:'synthetic',uncompressedSha256:hash},availableAt:now.toISOString()}]];
 });return {query};
}
beforeEach(()=>jest.resetAllMocks());
test('canonical forward completion and paired current sources produce private readiness only',async()=>{
 const db=await fixture(),r=await readM40ForwardStatus(db as never,now);
 expect(r).toEqual({status:'completed',session:'2026-11-09',completed:true,sourceReady:true,beforeNextOpen:true,executionScope:'paper_only'});
 expect(db.query.mock.calls.every(([sql])=>sql.trim().startsWith('SELECT'))).toBe(true);
 expect(JSON.stringify(r)).not.toMatch(/holdings|cash|policy|quantity/);
});
test('blocked cycle or stale source is never treated as complete/ready',async()=>{
 const db=await fixture('blocked',true);expect(await readM40ForwardStatus(db as never,now)).toMatchObject({status:'blocked',completed:false,sourceReady:false});
});
test('dry-run rejection occurs before any status queries',async()=>{
 const db=await fixture();jest.mocked(requirePaperDryRun).mockRejectedValue(Error('m40_forward_requires_dry_run'));
 await expect(readM40ForwardStatus(db as never,now)).rejects.toThrow('m40_forward_requires_dry_run');expect(db.query).not.toHaveBeenCalled();
});

test('completed cycle cannot authorize a forecast after the next regular open',async()=>{
 const db=await fixture();expect(await readM40ForwardStatus(db as never,new Date('2026-11-10T14:30:00Z'))).toMatchObject({completed:true,beforeNextOpen:false});
});
test('unverified/corrupt source bytes fail closed',async()=>{
 const db=await fixture();jest.mocked(readBlob).mockResolvedValue(gzipSync(Buffer.from('{}')));
 await expect(readM40ForwardStatus(db as never,now)).rejects.toThrow('paper_source_readback_failed');
});


test('archived index recovery preserves original CSV/hash/clock and expands only source window',async()=>{
 const calendar=[
  {session:'2026-11-05',openAt:'2026-11-05T14:30:00Z',closeAt:'2026-11-05T21:00:00Z',source:'synthetic'},
  {session:'2026-11-06',openAt:'2026-11-06T14:30:00Z',closeAt:'2026-11-06T21:00:00Z',source:'synthetic'},
  {session:'2026-11-09',openAt:'2026-11-09T14:30:00Z',closeAt:'2026-11-09T21:00:00Z',source:'synthetic'},
 ];
 const donor=await collectForwardSources(['NAS:AAPL'],'2026-11-06',{
  now:()=>new Date('2026-11-08T00:00:00Z'),monotonicMs:()=>0,sleep:async()=>{},fetchText:async url=>({status:200,text:url.includes('kibot')?'11/05/2026,100,100,100,100,100\n11/06/2026,100,100,100,100,100\n':'DATE,SP500\n2026-11-05,6000\n2026-11-06,6001\n'})});
 const target={...donor,asOfSession:'2026-11-09',dateWindow:{start:'2026-11-05',end:'2026-11-09'},market:undefined};
 const bytes=Buffer.from(JSON.stringify(donor)),hash=createHash('sha256').update(bytes).digest('hex');
 jest.mocked(readBlob).mockResolvedValue(gzipSync(bytes));
 const db={query:jest.fn(async(_sql:string,_params:unknown[])=>[[{payload_json:{blobSha256:'synthetic',uncompressedSha256:hash}}]])};
 const restored=await preserveArchivedIndex(target,'2026-11-06',calendar,now.toISOString(),db as never);
 expect(restored.market).toEqual(donor.market);expect(restored.records).toEqual(target.records);
 expect(target.market).toBeUndefined();expect(db.query.mock.calls[0][0]).toContain('LIMIT 8');
 const blocked=await preserveArchivedIndex(target,'2026-11-09',calendar,now.toISOString(),db as never);
 expect(blocked.market).toEqual(donor.market); // retain old proof, without fabricating a current observation
 expect(blocked.market?.rows.some(row=>row.session==='2026-11-09')).toBe(false);
});


test('FRED refresh preserves whole long original on a short prior-containing response and transport failure',async()=>{
 const bundle=await collectForwardSources(['NAS:AAPL'],'2026-11-09',{
  now:()=>new Date('2026-11-08T00:00:00Z'),monotonicMs:()=>0,sleep:async()=>{},fetchText:async url=>({status:200,text:url.includes('kibot')?'11/05/2026,100,100,100,100,100\n':'DATE,SP500\n2026-11-05,6000\n'})});
 const short=await refreshMissingIndex(bundle,'2026-11-06',async()=>({status:200,text:'DATE,SP500\n2026-11-06,6001\n'}));
 expect(short.market).toEqual(bundle.market);
 const failed=await refreshMissingIndex(bundle,'2026-11-06',async()=>{throw Error('synthetic_transport_failure');});
 expect(failed.market).toEqual(bundle.market);expect(failed.failures.at(-1)?.errorCode).toBe('forward_index_refresh_unavailable');
 const full=await refreshMissingIndex(bundle,'2026-11-06',async()=>({status:200,text:'DATE,SP500\n2026-11-05,6000\n2026-11-06,6001\n'}));
 expect(full.market?.rows).toHaveLength(2);expect(full.market?.rows.at(-1)?.session).toBe('2026-11-06');
 expect(bundle.market?.rows).toHaveLength(1);
});

test('a short archived donor containing the missing prior session cannot replace a longer original',async()=>{
 const calendar=[{session:'2026-11-05',openAt:'2026-11-05T14:30:00Z',closeAt:'2026-11-05T21:00:00Z',source:'synthetic'},
 {session:'2026-11-06',openAt:'2026-11-06T14:30:00Z',closeAt:'2026-11-06T21:00:00Z',source:'synthetic'},
 {session:'2026-11-09',openAt:'2026-11-09T14:30:00Z',closeAt:'2026-11-09T21:00:00Z',source:'synthetic'}];
 const make=(day:string)=>collectForwardSources(['NAS:AAPL'],'2026-11-09',{now:()=>now,monotonicMs:()=>0,sleep:async()=>{},
  fetchText:async url=>({status:200,text:url.includes('kibot')?'11/05/2026,100,100,100,100,100\n':`DATE,SP500\n${day},6000\n`})});
 const current=await make('2026-11-05'),donor=await make('2026-11-06'),bytes=Buffer.from(JSON.stringify(donor));
 jest.mocked(readBlob).mockResolvedValue(gzipSync(bytes));
 const db={query:jest.fn(async()=>[[{payload_json:{blobSha256:'synthetic',uncompressedSha256:createHash('sha256').update(bytes).digest('hex')}}]])};
 const result=await preserveArchivedIndex(current,'2026-11-06',calendar,now.toISOString(),db as never);
 expect(result.market).toEqual(current.market);expect(result.market?.rows.some(row=>row.session==='2026-11-06')).toBe(false);
});

test('a truncated canonical calendar cannot claim 253-session source readiness',async()=>{
 const db=await fixture('forward',false,252);expect(await readM40ForwardStatus(db as never,now)).toMatchObject({completed:true,sourceReady:false});
});

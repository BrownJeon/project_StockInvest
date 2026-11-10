import { createHash } from 'node:crypto';
import {
  collectForwardSources, requiredForwardSourceSessions, missingForwardSourceSymbols,mergeForwardSources,fetchForwardPublicText, FORWARD_COLLECTION_LIMITS, mapForwardSources,
  parseForwardIndexCsv, parseForwardStockCsv, type ForwardSourceBundle, type ForwardSourceDependencies,
} from '../forward-sources';
import type { ForwardCalendarSession } from '../forward-types';

const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const stock='11/05/2026,100.1234,102,99,101.4321,9007199254740993\n11/06/2026,101,104,100,103,12000\n';
const index='observation_date,SP500\n2026-11-05,6000.12\n2026-11-06,\n';
const at='2026-11-08T03:57:45.629Z';
const calendar:ForwardCalendarSession[]=[
  {session:'2026-11-05',openAt:'2026-11-05T14:30:00Z',closeAt:'2026-11-05T21:00:00Z',source:'nyse_official_2026_2027'},
  {session:'2026-11-06',openAt:'2026-11-06T14:30:00Z',closeAt:'2026-11-06T21:00:00Z',source:'nyse_official_2026_2027'},
];
function harness(handler?:(url:URL,count:number)=>{status:number;text:string}):{
 deps:ForwardSourceDependencies;calls:{url:URL;elapsed:number}[];advance:(ms:number)=>void;
}{
 let elapsed=0;const calls:{url:URL;elapsed:number}[]=[];
 const deps:ForwardSourceDependencies={now:()=>new Date(Date.parse(at)+elapsed),monotonicMs:()=>elapsed,
  sleep:async ms=>{elapsed+=ms;},fetchText:async url=>{
   const parsed=new URL(url);calls.push({url:parsed,elapsed});
   return handler?.(parsed,calls.length)??{status:200,text:parsed.hostname==='api.kibot.com'?stock:index};
  }};
 return {deps,calls,advance:ms=>{elapsed+=ms;}};
}
async function sample():Promise<ForwardSourceBundle>{return collectForwardSources(['NAS:AAPL'],'2026-11-06',harness().deps);}

describe('bounded public evaluation source collection',()=>{
 test('keeps explicit raw/split requests, complete CSV text, per-response receipt times and SHA without credential URLs',async()=>{
  const h=harness();const b=await collectForwardSources(['NAS:AAPL'],'2026-11-06',h.deps);
  expect(b.complete).toBe(true);expect(b.records).toHaveLength(2);expect(h.calls).toHaveLength(3);
  expect(h.calls.map(c=>c.elapsed)).toEqual([0,1000,2000]);
  expect(b.records.map(r=>[r.basis,r.request.splitadjusted,r.request.unadjusted])).toEqual([['split_adjusted','1','0'],['raw','0','1']]);
  expect(b.records[0]).toMatchObject({rawCsv:stock,sha256:hash(stock),observedAt:at,sourceUrl:'https://api.kibot.com/'});
  expect(b.records[0].rows[0]).toMatchObject({close:'101.4321',volume:'9007199254740993'});
  expect(b.records[1].observedAt).toBe('2026-11-08T03:57:46.629Z');
  expect(b.market).toMatchObject({series:'SP500',basis:'index',rawCsv:index,missingSessions:['2026-11-06']});
  expect(b.market?.rows).toEqual([{session:'2026-11-05',close:'6000.12'}]);
  expect(b.sourceUse).toContain('evaluation_only');expect(JSON.stringify(b)).not.toMatch(/password=|"password"|user=guest/);
 });
 test.each(['402','429'])('HTTP 200 provider %s stops immediately and is not a price bar',async code=>{
  const h=harness(()=>({status:200,text:code+' Evaluation account unavailable'}));
  const b=await collectForwardSources(['NAS:AAPL','NAS:MSFT'],'2026-11-06',h.deps);
  expect(h.calls).toHaveLength(1);expect(b.complete).toBe(false);expect(b.records).toEqual([]);
  expect(b.failures).toEqual([{symbol:'NAS:AAPL',basis:'split_adjusted',errorCode:'forward_source_provider_'+code}]);
 });
 test('three consecutive malformed responses stop the collection without leaking exception or response text',async()=>{
  const h=harness(()=>({status:200,text:'<html>private-token-do-not-store</html>'}));
  const b=await collectForwardSources(['NAS:AAPL','NAS:MSFT'],'2026-11-06',h.deps);
  expect(h.calls).toHaveLength(3);expect(b.failures.map(x=>x.errorCode)).toEqual(Array(3).fill('forward_source_csv_invalid'));
  expect(JSON.stringify(b)).not.toContain('private-token');expect(b.complete).toBe(false);
 });
 test('a valid response resets the consecutive failure counter',async()=>{
  const h=harness((url,count)=>({status:200,text:count%2===1&&url.hostname==='api.kibot.com'?'404 Not Found':url.hostname==='api.kibot.com'?stock:index}));
  const b=await collectForwardSources(['NAS:AAPL','NAS:MSFT','NAS:NVDA'],'2026-11-06',h.deps);
  expect(h.calls).toHaveLength(7);expect(b.records).toHaveLength(3);expect(b.market).toBeDefined();expect(b.complete).toBe(false);
 });
 test('transport exception text is reduced to a fixed safe error code',async()=>{
  const h=harness();h.deps.fetchText=async()=>{throw new Error('secret credential in exception');};
  const b=await collectForwardSources(['NAS:AAPL'],'2026-11-06',h.deps);
  expect(b.failures.every(x=>x.errorCode==='forward_source_transport_failed')).toBe(true);
  expect(JSON.stringify(b)).not.toContain('secret');expect(b.complete).toBe(false);
 });
 test('overall deadline bounds collection even when an injected source consumes time',async()=>{
  const h=harness();h.deps.fetchText=async()=>{h.advance(FORWARD_COLLECTION_LIMITS.deadlineMs);return {status:200,text:stock};};
  const b=await collectForwardSources(['NAS:AAPL'],'2026-11-06',h.deps);
  expect(b.records).toHaveLength(1);expect(b.failures.at(-1)?.errorCode).toBe('forward_source_deadline');expect(b.complete).toBe(false);
 });
 test('response byte limit halts without retaining oversized CSV',async()=>{
  const h=harness(()=>({status:200,text:'x'.repeat(FORWARD_COLLECTION_LIMITS.responseBytes+1)}));
  const b=await collectForwardSources(['NAS:AAPL'],'2026-11-06',h.deps);
  expect(h.calls).toHaveLength(1);expect(b.records).toEqual([]);expect(b.failures[0].errorCode).toBe('forward_source_response_budget');
 });
 test('total response budget is independent of the per-response bound',async()=>{
  const price='1'.repeat(39),volume='9'.repeat(40),day0=Date.parse('2025-09-04T00:00:00Z');
  const text=Array.from({length:429},(_,i)=>{
   const day=new Date(day0+i*86400000).toISOString().slice(0,10);return `${day.slice(5,7)}/${day.slice(8,10)}/${day.slice(0,4)},${price},${price},${price},${price},${volume}`;
  }).join('\n');
  expect(Buffer.byteLength(text)).toBeLessThan(FORWARD_COLLECTION_LIMITS.responseBytes);
  const h=harness(()=>({status:200,text}));const symbols=Array.from({length:150},(_,i)=>`NAS:S${i}`);
  const b=await collectForwardSources(symbols,'2026-11-06',h.deps);
  expect(b.failures.at(-1)?.errorCode).toBe('forward_source_response_budget');expect(h.calls.length).toBeLessThan(301);expect(b.complete).toBe(false);
 });
 test.each([[],['NAS:AAPL','NAS:AAPL'],['NYS:BAD/../../'],Array(151).fill('NAS:AAPL')].map(symbols=>[symbols]))('invalid symbol sets never invoke the network (%j)',async symbols=>{
  const h=harness();await expect(collectForwardSources(symbols,'2026-11-06',h.deps)).rejects.toThrow('forward_source_request_invalid');expect(h.calls).toHaveLength(0);
 });
 test('invalid calendar date never invokes the network',async()=>{
  const h=harness();await expect(collectForwardSources(['NAS:AAPL'],'2026-02-30',h.deps)).rejects.toThrow('forward_source_request_invalid');expect(h.calls).toHaveLength(0);
 });
 test('transport rejects nonallowlisted URLs before opening a socket',()=>{
  expect(()=>fetchForwardPublicText('https://evil.test/?id=SP500',{timeoutMs:1,maxBytes:5})).toThrow('forward_source_url_invalid');
  expect(()=>fetchForwardPublicText('https://api.kibot.com.evil.test/',{timeoutMs:1,maxBytes:5})).toThrow('forward_source_url_invalid');
 });
});

describe('source CSV validation',()=>{
 test.each([
  '02/30/2026,1,2,1,2,1','11/06/2026,0,2,1,2,1','11/06/2026,1,0,1,2,1',
  '11/06/2026,1,2,1,2,1.1','11/06/2026,1,2,1,2,-1','11/06/2026,1,2,1,2,1,extra',
  '11/06/2026,1e2,200,1,100,1', '11/07/2026,1,2,1,2,1',
  '11/06/2026,1,2,1,2,1\n11/06/2026,1,2,1,2,1',
 ])('rejects invalid price/date/volume or duplicate/out-of-window bars',text=>{
  expect(()=>parseForwardStockCsv(text,'2026-01-01','2026-11-06')).toThrow('forward_source_csv_invalid');
 });
 test('index holes stay holes and SPY is not accepted as an index column',()=>{
  expect(parseForwardIndexCsv('DATE,SP500\n2026-11-05,.\n2026-11-06,6000','2026-11-01','2026-11-06')).toEqual({rows:[{session:'2026-11-06',close:'6000'}],missingSessions:['2026-11-05']});
  expect(()=>parseForwardIndexCsv('DATE,SPY\n2026-11-06,600','2026-11-01','2026-11-06')).toThrow('forward_source_csv_invalid');
 });
});

describe('pure evaluation bundle mapping',()=>{
 test('maps split-only, raw quote/open and actual SP500 with unchanged receipt clocks; no live promotion',async()=>{
  const b=await sample();const {data,opens}=mapForwardSources(b,calendar);
  expect(data.members[0].splitBars[0]).toMatchObject({sourceVariant:'split_only',currency:'USD',qualification:'evaluation_only',observedAt:at,final:true});
  expect(data.members[0].rawQuote).toMatchObject({session:'2026-11-06',price:103,sourceVariant:'raw',currency:'USD',observedAt:'2026-11-08T03:57:46.629Z'});
  expect(data.sp500Bars).toHaveLength(1);expect(data.sp500Bars[0]).toMatchObject({session:'2026-11-05',sourceVariant:'index',currency:'INDEX'});
  expect(opens.map(x=>[x.session,x.open])).toEqual([['2026-11-05',100.1234],['2026-11-06',101]]);
  expect(JSON.stringify(data)).not.toContain('liveEligible');expect(b.records[0].rows[0].volume).toBe('9007199254740993');
 });
 test('a failed/missing market source stays an empty index series, not an ETF/default level',async()=>{
  const b=await sample();delete b.market;const mapped=mapForwardSources(b,calendar);expect(mapped.data.sp500Bars).toEqual([]);
 });
 test('source received before the close remains nonfinal',async()=>{
  const b=await sample();b.records[0].observedAt='2026-11-06T20:59:59.999999Z';
  expect(mapForwardSources(b,calendar).data.members[0].splitBars.at(-1)?.final).toBe(false);
 });
 test('a dividend/default adjusted request cannot be relabelled split-only',async()=>{
  const b=await sample();b.records[0].request.splitadjusted='0';
  expect(()=>mapForwardSources(b,calendar)).toThrow('forward_source_stock_contract_invalid');
 });
 test('generic adjusted or unrelated source rows are not accepted',async()=>{
  const b=await sample();b.records[0].sourceId='kis_generic_adjusted';
  expect(()=>mapForwardSources(b,calendar)).toThrow('forward_source_stock_contract_invalid');
 });
 test('duplicate variants cannot replace the valid source with a later record',async()=>{
  const b=await sample();b.records.push({...b.records[0]});expect(()=>mapForwardSources(b,calendar)).toThrow('forward_source_duplicate_variant');
 });
 test('stored CSV/hash/parsed rows must agree',async()=>{
  const b=await sample();b.records[0].rows[0].close='101.0';expect(()=>mapForwardSources(b,calendar)).toThrow('forward_source_rows_mismatch');
  const c=await sample();c.records[0].sha256='0'.repeat(64);expect(()=>mapForwardSources(c,calendar)).toThrow('forward_source_hash_mismatch');
 });
 test('existing external bundle supports original SHA and clocks without inline raw text',async()=>{
  const b=await sample();for(const r of b.records)delete r.rawCsv;delete b.market?.rawCsv;
  expect(mapForwardSources(b,calendar).data.members).toHaveLength(1);expect(b.records[0].observedAt).toBe(at);
 });
 test('known noncanonical session is explicitly nonfinal, not silently declared a trading day',async()=>{
  const b=await sample();const {data}=mapForwardSources(b,calendar.slice(1));expect(data.members[0].splitBars[0].final).toBe(false);
 });
 test('probe records never replace normal window data',async()=>{
  const b=await sample();b.records.push({...b.records[0],probe:true,rows:[]});expect(mapForwardSources(b,calendar).data.members[0].splitBars).toHaveLength(2);
 });
 test('untrusted hosts and secret-bearing source URLs are rejected',async()=>{
  const b=await sample();b.records[0].sourceUrl='https://user:pass@api.kibot.com/';
  expect(()=>mapForwardSources(b,calendar)).toThrow('forward_source_url_invalid');
  const c=await sample();c.market!.sourceUrl='https://evil.test/graph/fredgraph.csv?id=SP500';
  expect(()=>mapForwardSources(c,calendar)).toThrow('forward_source_url_invalid');
 });
 test('future source rows are rejected rather than trimmed into an apparently valid snapshot',async()=>{
  const b=await sample();delete b.records[0].rawCsv;b.records[0].rows[1].session='2026-11-09';
  expect(()=>mapForwardSources(b,calendar)).toThrow('forward_source_observation_invalid');
 });
});


test('a raw-only cached response retries split data and merges without duplicate variants',async()=>{
 const full=await sample(),partial={...full,records:full.records.filter(r=>r.basis==='raw'),complete:false};
 expect(missingForwardSourceSymbols(partial,['NAS:AAPL'])).toEqual(['NAS:AAPL']);
 const merged=mergeForwardSources(partial,full,['NAS:AAPL']);
 expect(merged.records).toHaveLength(2);expect(missingForwardSourceSymbols(merged,['NAS:AAPL'])).toEqual([]);
 expect(mapForwardSources(merged,calendar).data.members).toHaveLength(1);
 expect(mergeForwardSources(merged,full,['NAS:AAPL']).records).toHaveLength(2);
});

test('HTTP success with stale paired prices is incomplete and retriable',async()=>{
 const b=await collectForwardSources(['NAS:AAPL'],'2026-11-09',harness().deps);
 expect(b.records).toHaveLength(2);expect(b.complete).toBe(false);
 expect(missingForwardSourceSymbols(b,['NAS:AAPL'])).toEqual(['NAS:AAPL']);
});
test('a stale or shorter retry cannot erase a fresh paired original',async()=>{
 const b=await sample(),stale=JSON.parse(JSON.stringify(b)) as ForwardSourceBundle;
 stale.observedAt='2026-11-09T00:00:00Z';
 stale.records=stale.records.map(r=>({...r,observedAt:stale.observedAt,rows:r.rows.slice(0,1)}));
 const merged=mergeForwardSources(b,stale,['NAS:AAPL']);
 expect(merged.records).toEqual(b.records);expect(merged.complete).toBe(true);
 const short=JSON.parse(JSON.stringify(b)) as ForwardSourceBundle;
 short.records=short.records.map(r=>({...r,observedAt:stale.observedAt,rows:r.rows.slice(1)}));
 expect(mergeForwardSources(b,short,['NAS:AAPL']).records).toEqual(b.records);
});
test('canonical history gaps request another whole raw/split pair without inventing rows',async()=>{
 const b=await sample();b.records[0].rows=b.records[0].rows.slice(1);
 expect(missingForwardSourceSymbols(b,['NAS:AAPL'])).toEqual([]);
 expect(missingForwardSourceSymbols(b,['NAS:AAPL'],['2026-11-05','2026-11-06'])).toEqual(['NAS:AAPL']);
});


test('one-session index lag retries the oldest of 254 required stock sessions',async()=>{
 const days=Array.from({length:254},(_,i)=>new Date(Date.parse('2025-01-01T00:00:00Z')+i*86400_000).toISOString().slice(0,10));
 const calendar=days.map(session=>({session,openAt:session+'T14:30:00Z',closeAt:session+'T21:00:00Z',source:'historical_canonical'}));
 const b=await sample();b.asOfSession=days.at(-1)!;
 b.records=b.records.map(record=>({...record,rows:days.slice(1).map(session=>({session,open:'1',high:'1',low:'1',close:'1',volume:'1'}))}));
 expect(missingForwardSourceSymbols(b,['NAS:AAPL'])).toEqual([]);
 const required=requiredForwardSourceSessions(calendar,b.asOfSession);
 expect(required).toHaveLength(254);expect(missingForwardSourceSymbols(b,['NAS:AAPL'],required)).toEqual(['NAS:AAPL']);
 expect(requiredForwardSourceSessions(calendar,b.asOfSession,[],b.asOfSession)).toHaveLength(253);
});

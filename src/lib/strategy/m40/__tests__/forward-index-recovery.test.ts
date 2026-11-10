import {gzipSync} from 'node:zlib';
import {readBlob} from '@/lib/analysis-data/store';
import {indexFixture} from './forward-index-fixtures';
import {indexEvidenceSha} from '../forward-index-contract';
import {hasRequiredForwardIndexHistory,type ForwardSourceBundle} from '../forward-sources';
import {preserveArchivedIndex,refreshMissingIndex} from '../forward-runtime';
jest.mock('@/lib/db',()=>({getPool:jest.fn()}));
jest.mock('@/lib/analysis-data/store',()=>({readBlob:jest.fn()}));
function fixture(kind:'short'|'gap'){
 const f=indexFixture(),csv=(rows:typeof f.rows)=>'DATE,SP500\n'+rows.map(row=>`${row.session},${row.close}`).join('\n');
 const all=csv(f.rows),partial=kind==='short'?f.rows.slice(-252):f.rows.filter(row=>row.session!==f.rows.at(-100)!.session);
 const bundle:ForwardSourceBundle={schemaVersion:1,asOfSession:f.end,observedAt:'2025-03-04T00:00:00Z',dateWindow:{start:f.start,end:f.end},records:[],failures:[],complete:false,sourceUse:'evaluation_only',market:{...f.envelope.fred,rawCsv:csv(partial),sha256:indexEvidenceSha(csv(partial)),rows:partial,sourceId:'fred_sp500_forward',observedAt:'2025-03-04T00:00:00Z'}};
 const donor={...bundle,observedAt:f.now,market:{...bundle.market!,rows:f.rows,rawCsv:all,sha256:indexEvidenceSha(all),observedAt:f.now}};
 return {f,bundle,donor,all};
}
test.each(['short','gap'] as const)('a prior-containing %s cache triggers full fresh index recovery',async kind=>{
 const {f,bundle,all}=fixture(kind),prior=f.rows.at(-2)!.session;
 expect(bundle.market!.rows.some(row=>row.session===prior)).toBe(true);
 expect(hasRequiredForwardIndexHistory(bundle,f.calendar)).toBe(false);
 const fetch=jest.fn(async()=>({status:200,text:all}));
 const recovered=await refreshMissingIndex(bundle,prior,fetch,f.calendar);
 expect(fetch).toHaveBeenCalledTimes(1);expect(hasRequiredForwardIndexHistory(recovered,f.calendar)).toBe(true);
});
test.each(['short','gap'] as const)('archived whole %s recovery preserves old receipt when overlap prices are identical',async kind=>{
 const {f,bundle,donor}=fixture(kind),bytes=Buffer.from(JSON.stringify(donor));
 jest.mocked(readBlob).mockResolvedValue(gzipSync(bytes));
 const db={query:jest.fn(async()=>[[{payload_json:{blobSha256:'synthetic',uncompressedSha256:indexEvidenceSha(bytes.toString())}}]])};
 const recovered=await preserveArchivedIndex(bundle,f.rows.at(-2)!.session,f.calendar,bundle.observedAt,db as never);
 expect(db.query).toHaveBeenCalledTimes(1);expect(hasRequiredForwardIndexHistory(recovered,f.calendar)).toBe(true);
 expect(recovered.market).toEqual(donor.market);expect(recovered.market!.observedAt).toBe(f.now);
});

test('a nonfinal current index row cannot hide behind 253 valid prior rows and skip recovery',async()=>{
 const {f,donor,all}=fixture('gap');
 const bundle={...donor,market:{...donor.market!,observedAt:f.end+'T20:59:59Z'}};
 expect(hasRequiredForwardIndexHistory(bundle,f.calendar)).toBe(false);
 const fetch=jest.fn(async()=>({status:200,text:all}));
 const recovered=await refreshMissingIndex(bundle,f.rows.at(-2)!.session,fetch,f.calendar);
 expect(fetch).toHaveBeenCalledTimes(1);expect(hasRequiredForwardIndexHistory(recovered,f.calendar)).toBe(true);
});

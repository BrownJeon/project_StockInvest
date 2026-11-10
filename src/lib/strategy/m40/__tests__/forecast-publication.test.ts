/** Entirely synthetic engine-to-publication integration. No live DB or account material. */
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import type {ArchiveQueryable} from '@/lib/analysis-data/types';
import {readBlob} from '@/lib/analysis-data/store';
import {forecastFixture} from './forecast-fixture';
import {prepareForecastInput} from '../forecast-input';
import {runForecastEngine} from '../forecast-engine';
import {assertForecastResult,publishForecast,forecastHash,FORECAST_PRNG_ASSUMPTION} from '../forecast-store';
jest.mock('@/lib/db',()=>({getPool:jest.fn(()=>{throw Error('unexpected_live_database');})}));
jest.mock('@/lib/analysis-data/store',()=>({...jest.requireActual('@/lib/analysis-data/store'),readBlob:jest.fn()}));

test('actual successful engine output passes the publication contract and atomically persists four horizons',async()=>{
 const args=forecastFixture(1,true),prepared=prepareForecastInput(args);if(prepared.status!=='qualified')throw Error(prepared.issues.join(','));
 const input=prepared.input,output=await runForecastEngine(input,{seed:'synthetic-publication',pathCount:2000,blockLength:10,budgetMs:120000});
 expect(output.status).toBe('completed');expect(output.assumptions).toEqual([...input.assumptions,FORECAST_PRNG_ASSUMPTION]);
 const bytes=Buffer.from(JSON.stringify(args.bundle)),compressed=gzipSync(bytes),sha=(v:Buffer)=>createHash('sha256').update(v).digest('hex');
 const pointer={blobSha256:sha(compressed),compression:'gzip',uncompressedSha256:sha(bytes),bytes:bytes.length};
 const lease={id:'synthetic-job',token:'synthetic-token',issuedAt:input.issuedAt,sourceProof:{pointerSha256:forecastHash(pointer),blobSha256:pointer.blobSha256,uncompressedSha256:pointer.uncompressedSha256,baselineSplitBasis:{}}};
 expect(()=>assertForecastResult(lease,input,output)).not.toThrow();
 expect(()=>assertForecastResult(lease,input,{...output,assumptions:[...output.assumptions,'unapproved_assumption']})).toThrow('forecast_result_incomplete');
 jest.mocked(readBlob).mockResolvedValue(compressed);
 let publicationClocks=[args.issuedAt];
 const query=jest.fn(async(sql:string,p:unknown[]=[])=>{
  if(sql.includes('publicationNow'))return [[{publicationNow:publicationClocks.length>1?publicationClocks.shift():publicationClocks[0]}],[]];
  if(sql.includes('FROM system_config'))return [[{value:'true'}],[]];
  if(sql.includes('FROM t156_forecast_job'))return [[{status:'running',lease_token:lease.token,valid:1}],[]];
  if(sql.includes('FROM t156_paper_account'))return [[{revision:args.accountRevision,status:'active',policy_json:args.policy,state_json:args.book}],[]];
  if(sql.includes('FROM t156_forecast_run'))return [[],[]];
  if(sql.includes('FROM t156_record')){expect(p).toContain(pointer.uncompressedSha256);return [[{payload_json:pointer,availableAt:args.sourceAvailableAt}],[]];}
  if(sql.startsWith('SELECT intent_json'))return [[],[]];
  return [{affectedRows:1},[]];
 });
 const c={query,beginTransaction:jest.fn(),commit:jest.fn(),rollback:jest.fn(),release:jest.fn()},db={query,getConnection:async()=>c} as ArchiveQueryable;
 const id=await publishForecast(lease,input,output,db);expect(id).toMatch(/^[a-f0-9]{64}$/);expect(c.commit).toHaveBeenCalledTimes(1);expect(c.rollback).not.toHaveBeenCalled();
 expect(query.mock.calls.filter(([sql])=>sql.startsWith('INSERT INTO t156_forecast_run'))).toHaveLength(1);
 expect(query.mock.calls.filter(([sql])=>sql.startsWith('INSERT INTO t156_forecast_horizon'))).toHaveLength(4);
 expect(query.mock.calls.filter(([sql])=>sql.startsWith('INSERT INTO t156_forecast_evaluation'))).toHaveLength(4);
 expect(query.mock.calls.find(([sql])=>sql.startsWith('INSERT INTO t156_forecast_run'))?.[0]).toContain('UTC_TIMESTAMP(6)');
 const nextOpen=input.calendar.find(day=>day.session>input.baseline.session)!.openAt;
 for(const clocks of [[nextOpen],[args.issuedAt,nextOpen]]){
  publicationClocks=[...clocks];c.commit.mockClear();c.rollback.mockClear();query.mockClear();
  await expect(publishForecast(lease,input,output,db)).rejects.toThrow('forecast_publication_deadline_elapsed');
  expect(c.commit).not.toHaveBeenCalled();expect(c.rollback).toHaveBeenCalledTimes(1);
 }

},30000);

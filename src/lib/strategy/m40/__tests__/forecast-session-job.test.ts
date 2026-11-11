import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readBlob } from '@/lib/analysis-data/store';
import { runM40Forecast,forecastDailyJobId } from '../forecast-runtime';
import { readM40ForwardStatus } from '../forward-runtime';
import { loadPaperAccount,loadPendingPaperIntents } from '../forward-store';
import { acquireForecastJob,failForecastJob,publishForecast } from '../forecast-store';
import { prepareForecastInput } from '../forecast-input';
import { runForecastEngine } from '../forecast-engine';
jest.mock('@/lib/db',()=>({getPool:jest.fn()}));
jest.mock('@/lib/analysis-data/store',()=>({...jest.requireActual('@/lib/analysis-data/store'),readBlob:jest.fn()}));
jest.mock('../forward-runtime',()=>({readM40ForwardStatus:jest.fn(),loadForwardCalendar:jest.fn(async()=>[])}));
jest.mock('../forward-store',()=>({loadPaperAccount:jest.fn(),requirePaperDryRun:jest.fn(),loadPendingPaperIntents:jest.fn()}));
jest.mock('../forecast-store',()=>({...jest.requireActual('../forecast-store'),acquireForecastJob:jest.fn(),failForecastJob:jest.fn(),publishForecast:jest.fn()}));
jest.mock('../forward-sources',()=>({...jest.requireActual('../forward-sources'),assertForwardSourceReadiness:jest.fn()}));
jest.mock('../forecast-input',()=>({prepareForecastInput:jest.fn()}));
jest.mock('../forecast-engine',()=>({runForecastEngine:jest.fn()}));
jest.mock('../forecast-manifest',()=>({forecastCodeManifest:jest.fn(()=>({modelCodeSha256:'synthetic'}))}));
const session='2026-11-09',accountId='synthetic-account';
function fixture({published=false,running=false,legacyBusy=false,revision=2,dataset='source-a'}={}){
 const bytes=Buffer.from(JSON.stringify({asOfSession:session,records:[]})),hash=createHash('sha256').update(bytes).digest('hex');
 jest.mocked(readBlob).mockResolvedValue(gzipSync(bytes));
 jest.mocked(readM40ForwardStatus).mockResolvedValue({status:'completed',session,completed:true,sourceReady:true,beforeNextOpen:true,executionScope:'paper_only'});
 jest.mocked(loadPaperAccount).mockResolvedValue({id:accountId,status:'active',revision,book:{holdings:[],splitBasis:{}},policy:{referenceSymbols:[]}} as never);
 jest.mocked(loadPendingPaperIntents).mockResolvedValue([]);
 jest.mocked(prepareForecastInput).mockReturnValue({status:'blocked',issues:['synthetic_missing_input']});
 jest.mocked(acquireForecastJob).mockResolvedValue(running?null:{id:'synthetic',token:'synthetic',issuedAt:'2026-11-10T12:00:00Z'});
 return {query:jest.fn(async(sql:string)=>{
  if(sql.includes('SELECT id FROM t156_forecast_run'))return [published?[{id:'legacy-immutable-run'}]:[]];
  if(sql.includes("AND status='running'"))return [legacyBusy?[{id:'old-input-hash-job'}]:[]];
  if(sql.includes('latestSourceSha'))return [[{latestSourceSha:hash}]];
  if(sql.includes('FROM t156_paper_cycle'))return [[{id:'actual-analysis-cycle',sourceBundleSha256:hash}]];
  if(sql.includes('SELECT status,lease_until'))return [[{status:'running',busy:1}]];
  return [[{dataset_id:dataset,payload_json:{blobSha256:'synthetic',uncompressedSha256:hash},availableAt:'2026-11-10T11:00:00Z'}]];
 })};
}
beforeEach(()=>jest.resetAllMocks());
test('stable session ID excludes changing dataset, account revision and model manifest',async()=>{
 await runM40Forecast(fixture({revision:2,dataset:'source-a'}) as never);
 const first=jest.mocked(acquireForecastJob).mock.calls[0][0];
 await runM40Forecast(fixture({revision:3,dataset:'source-b'}) as never);
 expect(jest.mocked(acquireForecastJob).mock.calls[1][0]).toBe(first);
 expect(first).toBe(forecastDailyJobId(accountId,session,'t156-forecast-v1'));
 expect(forecastDailyJobId(accountId,'2026-11-10','t156-forecast-v1')).not.toBe(first);
 expect(failForecastJob).toHaveBeenCalledTimes(2);
});
test('a legacy published original prevents a new job without mutating the original',async()=>{
 const db=fixture({published:true});expect(await runM40Forecast(db as never)).toEqual({status:'already_published',runId:'legacy-immutable-run',executionScope:'forecast_only'});
 expect(acquireForecastJob).not.toHaveBeenCalled();expect(readBlob).not.toHaveBeenCalled();
 expect(db.query.mock.calls.every(([sql])=>sql.startsWith('SELECT'))).toBe(true);
});
test('a busy stable job is running, never already published or completed',async()=>{
 const db=fixture({running:true});expect(await runM40Forecast(db as never)).toEqual({status:'running',completed:false,executionScope:'forecast_only'});
 expect(prepareForecastInput).not.toHaveBeenCalled();expect(failForecastJob).not.toHaveBeenCalled();
});

test('an unexpired legacy input-hash worker blocks a new stable-session lease',async()=>{
 const db=fixture({legacyBusy:true});expect(await runM40Forecast(db as never)).toEqual({status:'running',completed:false,executionScope:'forecast_only'});
 expect(acquireForecastJob).not.toHaveBeenCalled();expect(readBlob).not.toHaveBeenCalled();
});
test('actual forward source hash pins the archive query instead of selecting a later different bundle',async()=>{const db=fixture({dataset:'pinned-analysis-A'});await runM40Forecast(db as never);const query=db.query.mock.calls.find(([s])=>s.includes('FROM t156_record'));expect(query?.[0]).toContain('d.content_sha256=?');expect((query as unknown as [string,string[]])[1][0]).toMatch(/^[a-f0-9]{64}$/);});
import {evaluateM40Forecasts} from '../forecast-runtime';
test('paused paper account skips the evaluation scan before any evidence/append query',async()=>{jest.mocked(loadPaperAccount).mockResolvedValue({status:'paused'} as never);const db={query:jest.fn()};await expect(evaluateM40Forecasts(db as never)).resolves.toEqual({evaluated:0});expect(db.query).not.toHaveBeenCalled();});

test('a pre-lease source error never acquires or fails a lease',async()=>{
 const db=fixture();jest.mocked(readBlob).mockRejectedValue(Error('source_read_failed'));
 await expect(runM40Forecast(db as never)).rejects.toThrow('source_read_failed');
 expect(acquireForecastJob).not.toHaveBeenCalled();expect(failForecastJob).not.toHaveBeenCalled();expect(runForecastEngine).not.toHaveBeenCalled();
});
test('a post-lease preparation exception records the failed lease exactly once',async()=>{
 const db=fixture();jest.mocked(prepareForecastInput).mockImplementation(()=>{throw Error('synthetic_prepare_throw');});
 await expect(runM40Forecast(db as never)).rejects.toThrow('synthetic_prepare_throw');
 expect(failForecastJob).toHaveBeenCalledTimes(1);expect(jest.mocked(failForecastJob).mock.calls[0][1]).toBe('forecast_run_failed');expect(runForecastEngine).not.toHaveBeenCalled();
});
test('a newly published session after lease acquisition stops before preparation or engine',async()=>{
 const db=fixture(),query=db.query.getMockImplementation()!;let publishedChecks=0;
 db.query.mockImplementation(async(sql:string)=>sql.includes('SELECT id FROM t156_forecast_run')?[++publishedChecks===1?[]:[{id:'concurrent-original'}]]:query(sql));
 await expect(runM40Forecast(db as never)).resolves.toEqual({status:'already_published',runId:'concurrent-original',executionScope:'forecast_only'});
 expect(failForecastJob).toHaveBeenCalledTimes(1);expect(jest.mocked(failForecastJob).mock.calls[0][1]).toBe('forecast_session_already_published');expect(prepareForecastInput).not.toHaveBeenCalled();expect(runForecastEngine).not.toHaveBeenCalled();
});
test('prepared-only engine handoff preserves failed-engine lease handling',async()=>{
 const db=fixture(),input={baseline:{accountId,session},calendar:[]} as never;
 jest.mocked(prepareForecastInput).mockReturnValue({status:'qualified',input});
 jest.mocked(runForecastEngine).mockResolvedValue({status:'failed',issues:['synthetic_engine_failed']} as never);
 await expect(runM40Forecast(db as never)).resolves.toMatchObject({status:'failed',issues:['synthetic_engine_failed']});
 expect(jest.mocked(runForecastEngine).mock.calls[0]).toEqual([input,{seed:'t156-forecast-v1',pathCount:2000,blockLength:10,budgetMs:120000}]);
 expect(jest.mocked(failForecastJob).mock.calls[0][1]).toBe('forecast_engine_failed');expect(failForecastJob).toHaveBeenCalledTimes(1);expect(publishForecast).not.toHaveBeenCalled();
});

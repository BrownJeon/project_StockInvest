import {readForecastView} from '../forecast-view';
import type {ArchiveQueryable} from '@/lib/analysis-data/types';
const old='a'.repeat(64),fresh='b'.repeat(64);
const result={status:'completed',issuedAt:'2026-11-08T00:00:00Z',modelVersion:'synthetic',sourceDatasetId:'source',sourceAvailableAt:'2026-11-07T23:00:00Z',baseline:{kind:'forecast_only_marked_snapshot',accountId:'synthetic',accountRevision:1,session:'2026-11-06',equityUsd:1000,bookSha256:'book',sourceAccountStateSha256:'original',epochSession:'2026-11-09',epochProvisional:true},sampleCounts:{historicalReturns:297,historicalStart:'2025-09-02',historicalEnd:'2026-11-05',blockLength:10,possibleBlockStarts:288,nonoverlappingBlocks:29},bridge:{kind:'none',session:null,intercept:0,slope:0,predictor:0,residualSha256:'residual',fitStart:null,fitEnd:null,sampleCount:0},assumptions:[],horizons:['week','month','quarter','year'].map(horizon=>({horizon,calendarTarget:'2027-11-06',targetSession:'2027-11-05',sessions:250,netPct:{mean:1,p10:-1,p50:1,p90:2},netUsd:{mean:10,p10:-10,p50:10,p90:20},lossCount:400,pathCount:2000,lossProbability:.2,monteCarloSe:.008,historicalNonoverlappingWindows:1}))};
function db(missing=false,data=result){const query=jest.fn(async(sql:string,p:unknown[]=[])=>{
 if(sql.includes('GROUP BY e.status'))return [[{status:'completed',n:2,meanBrier:.25,intervalCoverage:.5},{status:'pending',n:1,meanBrier:null,intervalCoverage:null}],[]];
 if(sql.includes('SELECT COUNT(*) n FROM t156_forecast_run'))return [[{n:11}],[]];
 if(sql.includes('SELECT COUNT(*) n FROM t156_forecast_evaluation'))return [[{n:3}],[]];
 if(sql.includes('SELECT r.id,r.result_sha256,r.result_json')){if(sql.includes('AND r.id=?'))return [missing?[]:[{id:p.at(-1),result_sha256:'hash',result_json:data}],[]];return [[{id:fresh,result_sha256:'hash',result_json:data}],[]];}
 return [[],[]];});return {query} as ArchiveQueryable;}
test('selected original is independent of page and later publications at every horizon',async()=>{
 for(const horizon of ['week','month','quarter','year']){const v=await readForecastView(db(),horizon,'2026-11-08 12:00:00',2,1,false,old);expect(v.selectedId).toBe(old);expect(v.selectedRecord?.result.horizon).toBe(horizon);expect(v.recordPage?.page).toBe(2);expect(v.recordPage?.totalCount).toBe(11);expect(v.records[0].id).toBe(fresh);}
});
test('missing selected original cannot fall back to newly published records',async()=>{const v=await readForecastView(db(true),'week','2026-11-08 12:00:00',1,1,false,old);expect(v.selectedId).toBe(old);expect(v.selectionStatus).toBe('missing');expect(v.selectedRecord).toBeNull();expect(v.baseline).toBeNull();});
test('comparison summary covers all latest evaluations independently of current ten-row page',async()=>{const v=await readForecastView(db(),'week','2026-11-08 12:00:00');expect(v.comparison).toEqual([]);expect(v.comparisonSummary).toEqual({total:3,completed:2,pending:1,unconfirmed:0,incomparable:0,meanBrier:.25,intervalCoverage:.5});});

test('nested allowlists exclude private books and residuals even from malformed stored output',async()=>{
 const dirty=structuredClone(result) as typeof result&Record<string,any>;dirty.book={private:'private-book'};(dirty.baseline as Record<string,unknown>).book={private:'private-baseline-book'};(dirty.bridge as Record<string,unknown>).residuals=['private-residual'];(dirty.horizons[0] as Record<string,unknown>).input=['private-input'];
 const serialized=JSON.stringify(await readForecastView(db(false,dirty),'week','2026-11-08 12:00:00'));for(const text of ['private-book','private-baseline-book','private-residual','private-input'])expect(serialized).not.toContain(text);
});

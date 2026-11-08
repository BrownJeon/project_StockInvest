import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { paperPerformance,paperViewLimits,readPaperView,PaperViewError,readPaperSourceSummary,projectPaperSignal,projectPaperWarnings } from '../paper-view';
import type { ArchiveQueryable } from '@/lib/analysis-data/types';
const point=(session:string,mode:string,equityUsd:number)=>({session,mode,payload_json:{equityUsd,returnSinceClone:999,drawdown:-999}});
describe('owner paper viewer',()=>{
 test('bounded signals reject invalid input',()=>{expect(paperViewLimits(null)).toBe(20);expect(paperViewLimits('100')).toBe(100);for(const raw of ['0','101','1.2','NaN',''])expect(()=>paperViewLimits(raw)).toThrow();});
 test('forward zero/one/two points and rehearsal exclusion',()=>{
 expect(paperPerformance([],false).status).toBe('not_started');
 expect(paperPerformance([point('2026-01-01','rehearsal',1)],false).points).toEqual([]);
 expect(paperPerformance([point('2026-01-01','forward',100)],false).returnPct).toBeNull();
 const p=paperPerformance([point('2026-01-01','rehearsal',1),point('2026-01-01','forward',100),point('2026-01-02','forward',90)],false);
 expect(p.points).toHaveLength(2);expect(p.returnPct).toBeCloseTo(-10);expect(p.maxDrawdownPct).toBeCloseTo(-10);expect(p.cagrPct).toBeNull();
 });
 test('truncated or invalid points cannot imply complete performance',()=>{
 expect(paperPerformance([point('a','forward',100),point('b','forward',90)],true).maxDrawdownPct).toBeNull();
 expect(paperPerformance([point('a','forward',0),point('b','forward',90)],false).returnPct).toBeNull();
 });
 test('other users stop before account data reads and transaction closes',async()=>{
 const query=jest.fn(async(sql:string)=>[[],[]]);const rollback=jest.fn(),release=jest.fn();
 const c={query,beginTransaction:jest.fn(),commit:jest.fn(),rollback,release,destroy:jest.fn()};
 const db={query:jest.fn(),getConnection:async()=>c} as unknown as ArchiveQueryable;
 await expect(readPaperView(42,20,db)).rejects.toMatchObject({status:403});
 expect(query.mock.calls.map(c=>c[0]).some(sql=>sql.includes('FROM t156_paper_account'))).toBe(false);expect(rollback).toHaveBeenCalled();expect(release).toHaveBeenCalled();
 });
 test('invalid caller cannot open a DB connection',async()=>{
 const getConnection=jest.fn();await expect(readPaperView(0,20,{getConnection} as unknown as ArchiveQueryable)).rejects.toBeInstanceOf(PaperViewError);expect(getConnection).not.toHaveBeenCalled();
 });
 test('blocked latest stays blocked, old usable is explicitly stale; projection excludes raw bodies',async()=>{
 const rows=[{id:'new',session:'2026-11-08',decisionAt:'2026-11-08T20:00:00Z',mode:'blocked',payload_json:{errorCode:'forward_source_missing',secret:'RAW_SECRET'}},{id:'old',session:'2026-11-08',decisionAt:'2026-11-08T19:00:00Z',mode:'rehearsal',payload_json:{sourceRunId:'m40-exact',equityUsd:100,eligibility:{perSymbol:[{symbol:'NAS:AAPL',eligible:true,inFrozenCohort:true,issues:[]}]}}}];
 const query=jest.fn(async(sql:string)=>{
 if(sql.includes('FROM t156_paper_viewer'))return [[{account_id:'t156-m40-paper-v1'}],[]];
 if(sql.includes('FROM t156_paper_account'))return [[{status:'active',revision:2,policy_json:{referenceSymbols:['NAS:AAPL']},initialEquityUsd:100}],[]];
 if(sql.includes('FROM t156_paper_cycle'))return [rows,[]];
 if(sql.includes('FROM t156_analysis_run'))return [[{plan_json:{candidates:[{symbol:'NAS:AAPL',status:'ranked',rank:1,momentum:0.2,selected:true,reason:'ranked'}],decisions:[{symbol:'NAS:AAPL',action:'hold',reason:'not_review_session',quantity:0}],raw:'RAW_SECRET'}}],[]];
 return [[],[]];
 });
 const c={query,beginTransaction:jest.fn(),commit:jest.fn(),rollback:jest.fn(),release:jest.fn(),destroy:jest.fn()};
 // Use the production constant rather than a guessed account ID.
 const {PAPER_ACCOUNT_ID}=await import('../paper-ledger');
 query.mockImplementationOnce(async()=>[[],[]]).mockImplementationOnce(async()=>[[],[]]).mockImplementationOnce(async()=>[[{account_id:PAPER_ACCOUNT_ID}],[]]);
 const result=await readPaperView(42,20,{getConnection:async()=>c} as unknown as ArchiveQueryable);
 expect(result.currentCycle?.mode).toBe('blocked');expect(result.lastUsableCycle?.stale).toBe(true);
 expect(result.lastUsableCycle?.candidates[0].selected).toBe(true);expect(result.lastUsableCycle?.decisions[0].action).toBe('hold');
 expect(result.performance.status).toBe('not_started');expect(JSON.stringify(result)).not.toContain('RAW_SECRET');
 expect(query.mock.calls.some(c=>c[0].includes('input_json')||c[0].includes('clone_json'))).toBe(false);
 });

 test('annualization requires 365 days, complete forward observations and a positive ratio',()=>{
 const full=paperPerformance([point('2025-01-01','forward',100),point('2026-01-01','forward',121)],false);
 expect(full.cagrPct).toBeCloseTo((Math.pow(1.21,365.25/365)-1)*100);
 expect(paperPerformance([point('2025-01-01','forward',100),point('2025-12-31','forward',121)],false).cagrPct).toBeNull();
 expect(paperPerformance([point('2025-01-01','forward',100),point('2026-01-01','forward',0)],false).cagrPct).toBeNull();
 expect(paperPerformance([point('2025-01-01','forward',100),point('2026-01-01','forward',121)],true).cagrPct).toBeNull();
 });
 test('missing or oversized provenance is optional unknown and does not read body',async()=>{
 const query=jest.fn(async()=>[[{byte_length:3*1024*1024,part_count:1}],[]]);
 const unknown=await readPaperSourceSummary('a'.repeat(64),{query} as unknown as ArchiveQueryable);
 expect(unknown).toEqual({sources:[],actualReceiptAt:null,provenanceStatus:'unknown'});expect(query).toHaveBeenCalledTimes(1);
 });
 test('rollback failure destroys connection instead of returning it to pool',async()=>{
 const c={query:jest.fn(async()=>[[],[]]),beginTransaction:jest.fn(),commit:jest.fn(),rollback:jest.fn(async()=>{throw Error('rollback_failed');}),release:jest.fn(),destroy:jest.fn()};
 await expect(readPaperView(42,20,{getConnection:async()=>c} as unknown as ArchiveQueryable)).rejects.toMatchObject({status:403});
 expect(c.destroy).toHaveBeenCalled();expect(c.release).not.toHaveBeenCalled();
 });

 test('verified compressed provenance returns only aggregate actual receipts',async()=>{
 const records=[{symbol:'NAS:AAPL',sourceId:'stooq_forward',kind:'raw_quote',sourceVariant:'raw',session:'2026-11-06',observedAt:'2026-11-07T01:00:00Z',availableAt:'2026-11-07T01:00:00Z',rawCsv:'SECRET'},{symbol:'NAS:MSFT',sourceId:'stooq_forward',kind:'raw_quote',sourceVariant:'raw',session:'2026-11-06',observedAt:'2026-11-07T02:00:00Z',availableAt:'2026-11-07T02:00:00Z'}];
 const bytes=gzipSync(Buffer.from(JSON.stringify(records))),hash=createHash('sha256').update(bytes).digest('hex');
 const query=jest.fn(async(sql:string)=>sql.includes('FROM t156_blob_part')?[[{part_no:0,part_sha256:hash,bytes}],[]]:[[{byte_length:bytes.length,part_count:1,encoding:'binary'}],[]]);
 const result=await readPaperSourceSummary(hash,{query} as unknown as ArchiveQueryable);
 expect(result.provenanceStatus).toBe('available');expect(result.actualReceiptAt).toBe('2026-11-07T02:00:00.000000Z');expect(result.sources[0]).toMatchObject({observations:2,symbolCount:2,publicationAt:null});expect(JSON.stringify(result)).not.toContain('SECRET');expect(JSON.stringify(result)).not.toContain('AAPL');
 });

 test('signal whitelist exposes explanation, exact intended opening, model costs and receipt only',()=>{
 const signal=projectPaperSignal({id:'m40p_example',session:'2026-11-06',symbol:'NAS:AAPL',side:'buy',status:'filled',quantity:2,reason:'momentum_selected',executeSession:'2026-11-09',createdAt:'2026-11-07T01:00:00.000000Z',mode:'forward',intent_json:{secret:'NO'},outcome_json:{reason:'modeled_next_open',quantity:2,priceUsd:100,feeUsd:0.5,settlementSession:'2026-11-10',observedAt:'2026-11-10T01:00:00Z',notionalUsd:200,secret:'NO'}});
 expect(signal).toMatchObject({reason:'momentum_selected',executeSession:'2026-11-09',mode:'forward',outcome:{priceUsd:100,feeUsd:0.5,settlementSession:'2026-11-10'}});expect(JSON.stringify(signal)).not.toContain('secret');expect(JSON.stringify(signal)).not.toContain('notionalUsd');
 });
 test('missing or invalid optional signal fields stay unknown, never invented zero',()=>{
 const signal=projectPaperSignal({symbol:'NAS:AAPL',executeSession:'2026-02-30',quantity:null,reason:'unsafe reason body',outcome_json:{quantity:-1,feeUsd:'0.5',settlementSession:'invalid',observedAt:'invalid'}});
 expect(signal).toMatchObject({quantity:null,reason:null,executeSession:null,createdAt:null,mode:'unknown',outcome:{quantity:null,feeUsd:null,settlementSession:null,observedAt:null}});
 });

 test('actual instants require a valid UTC timestamp and normalize up to microseconds',()=>{
 for(const invalid of ['2026-02-30T00:00:00Z','2026-11-08','2026-11-08T01:02:03','2026-11-08T01:02:03+00:00','2026-11-08T24:00:00Z','2026-11-08T01:02:03.1234567Z']){
 const projected=projectPaperSignal({symbol:'NAS:AAPL',createdAt:invalid,outcome_json:{observedAt:invalid}});
 expect(projected?.createdAt).toBeNull();expect(projected?.outcome?.observedAt).toBeNull();
 }
 const projected=projectPaperSignal({symbol:'NAS:AAPL',createdAt:'2026-11-08T01:02:03.123456Z',outcome_json:{observedAt:'2026-11-08T01:02:03Z'}});
 expect(projected?.createdAt).toBe('2026-11-08T01:02:03.123456Z');expect(projected?.outcome?.observedAt).toBe('2026-11-08T01:02:03.000000Z');
 });

 test('plan warning projection keeps known causes for this run roster only and strips private fields',()=>{
 const result=projectPaperWarnings([{symbol:'NAS:AAPL',code:'insufficient_settled_cash',message:'PRIVATE cash amount',privateKey:'PRIVATE'},{symbol:'NAS:UNRELATED',code:'account_slot_limit'},{symbol:'unprefixed',code:'account_slot_limit'},{symbol:'NAS:AAPL',code:'invented',message:'PRIVATE'},{code:'market_history_missing',message:'PRIVATE'}],new Set(['NAS:AAPL']));
 expect(result).toEqual([{symbol:'NAS:AAPL',code:'insufficient_settled_cash'},{code:'market_history_missing'}]);expect(JSON.stringify(result)).not.toContain('PRIVATE');
 });

});

import {readPaperView} from '../paper-view';
import {defaultPaperViewQuery} from '../paper-view-query';
import {PAPER_ACCOUNT_ID} from '../paper-ledger';
import type {ArchiveQueryable} from '@/lib/analysis-data/types';
const cycle=(n:number)=>({id:String(n).padStart(64,'0'),session:'2026-11-06',decisionAt:'2026-11-07T01:00:00.000000Z',recordedAt:'2026-11-07T01:02:00.000000Z',mode:'forward',payload_json:{equityUsd:100+n}});
function fixture(n=23,options:{pointCount?:number;futureCount?:number;rehearsalOnly?:boolean;earlyGap?:boolean;blockedWithRun?:boolean}={}){
 let revision=2,denied=false,forecastClockId='';const cutoff='2026-11-07T02:00:00.000000Z';
 const signals=Array.from({length:n},(_,i)=>({id:'m40p_'+String(i).padStart(64,'0'),session:'2026-11-06',createdAt:'2026-11-07T01:01:00Z',symbol:'NAS:AAPL',side:'buy',status:'filled',mode:'forward',outcome_json:{observedAt:'2026-11-08T00:00:00Z',priceUsd:123}}));
 const rows=options.rehearsalOnly?[]:options.earlyGap?[{...cycle(1),session:'2026-11-02'},{...cycle(2),session:'2026-11-03'}]:[cycle(1),cycle(2)];
 const latest=options.blockedWithRun?{...cycle(9),mode:'blocked',payload_json:{sourceRunId:'blocked-run'}}:options.rehearsalOnly?{...cycle(9),mode:'rehearsal'}:rows.at(-1);
 const query=jest.fn(async(sql:string,params:unknown[]=[])=>{
  if(sql.includes('FROM t156_forecast_run WHERE account_id=? ORDER BY created_at'))return [forecastClockId?[{id:forecastClockId,at:'2026-11-08T12:00:00.000000Z'}]:[],[]];
  if(sql.includes('FROM t156_paper_viewer'))return [denied?[]:[{account_id:PAPER_ACCOUNT_ID}],[]];
  if(sql.includes('FROM t156_paper_account'))return [[{status:'active',revision,updatedAt:cutoff,policy_json:{registeredAt:'2026-11-01T00:00:00Z'},initialEquityUsd:99999}],[]];
  if(sql.includes('MIN(session_date)'))return [[{firstSession:options.rehearsalOnly?null:options.earlyGap?'2026-11-02':'2026-11-06',lastSession:options.rehearsalOnly?null:options.earlyGap?'2026-11-03':'2026-11-06',savedFirstSession:'2026-11-02',savedLastSession:'2026-11-06'}],[]];
  if(sql.includes('COUNT(*) n')&&sql.includes('t156_paper_signal'))return [[{n}],[]];
  if(sql.includes('COUNT(*) n')&&sql.includes('session_date>?'))return [[{n:options.futureCount??0}],[]];
  if(sql.includes('COUNT(*) n')&&sql.includes('t156_paper_cycle'))return [[{n:options.pointCount??rows.length,observedSessions:options.rehearsalOnly?0:options.earlyGap?2:1}],[]];
  if(sql.includes('FROM t156_analysis_run'))return [[{policy_version:params[0]==='usable-run'?'usable-policy':'blocked-policy',plan_json:{}}],[]];
  if(sql.includes('FROM t156_paper_signal')){const offset=Number(params.at(-1));return [signals.slice(offset,offset+10),[]];}
  if(sql.includes('FROM t156_paper_cycle')){
   if(sql.includes("mode<>'blocked'"))return [[{...cycle(2),payload_json:{equityUsd:102,sourceRunId:'usable-run'}}],[]];
   if(sql.includes('ORDER BY decision_at'))return [latest?[latest]:[],[]];
   if(sql.includes('LIMIT 1'))return [rows.length?[sql.includes(' DESC')?rows.at(-1):rows[0]]:[],[]];
   return [rows,[]];
  }
  return [[],[]];
 });
 const c={query,commit:jest.fn(),rollback:jest.fn(),release:jest.fn(),destroy:jest.fn(),beginTransaction:jest.fn()};
 return {db:{getConnection:async()=>c} as unknown as ArchiveQueryable,c,query,revise:()=>revision++,deny:()=>denied=true,issueForecast:()=>forecastClockId='a'.repeat(64)};
}
describe('v6 read-only private paginated view',()=>{
 test.each([0,1,10,11,23])('ten-row SQL pages and exact count %i',async n=>{
  const f=fixture(n),v=await readPaperView(1,{...defaultPaperViewQuery(),signalPage:999},f.db);
  expect(v.signalPage.totalCount).toBe(n);expect(v.signalPage.page).toBe(Math.max(1,Math.ceil(n/10)));expect(v.signalPage.rows).toHaveLength(n===0?0:n%10||10);
  expect(v.signalPage.hasNext).toBe(false);expect(v.signals).toEqual(v.signalPage.rows);expect(v.forecasts).toMatchObject({capability:'preparing',records:[],comparison:[],baseline:null,targetEnd:null,expectedReturnPct:null});
  expect(v.account.cloneInvestmentUsd).toBe(99999);expect(v.observation.baseline?.point.equityUsd).toBe(101);
  expect(v.snapshot.asOf).toBe('2026-11-07T02:00:00.000000Z');expect(f.query.mock.calls[2][0]).toContain('t156_paper_viewer');
  expect(f.query.mock.calls.some(([sql])=>/INSERT|UPDATE|DELETE|FOR UPDATE/.test(sql))).toBe(false);expect(f.c.commit).toHaveBeenCalled();
  expect(v.signals.every(s=>s.outcome===null&&s.status==='unknown')).toBe(true);
 });
 test('horizon and page share binding; changed account revision or period fails 409',async()=>{
  const f=fixture(),first=await readPaperView(1,defaultPaperViewQuery(),f.db);
  const next=await readPaperView(1,{...defaultPaperViewQuery(),signalPage:2,horizon:'year',snapshot:first.snapshot.token},f.db);
  expect(next.snapshot.token).toBe(first.snapshot.token);expect(next.signalPage.page).toBe(2);expect(next.forecasts.horizon).toBe('year');
  await expect(readPaperView(1,{...defaultPaperViewQuery(),period:'week',anchorSession:'2026-11-02',snapshot:first.snapshot.token},f.db)).rejects.toMatchObject({status:409});
  f.revise();await expect(readPaperView(1,{...defaultPaperViewQuery(),snapshot:first.snapshot.token},f.db)).rejects.toMatchObject({status:409});
 });
 test('revoked viewers are rejected before all private reads/counts despite old snapshot',async()=>{
  const f=fixture(),first=await readPaperView(1,defaultPaperViewQuery(),f.db);f.query.mockClear();f.deny();
  await expect(readPaperView(1,{...defaultPaperViewQuery(),snapshot:first.snapshot.token},f.db)).rejects.toMatchObject({status:403});
  expect(f.query.mock.calls).toHaveLength(3);expect(f.query.mock.calls.some(([sql])=>sql.includes('t156_paper_account')||sql.includes('COUNT'))).toBe(false);expect(f.c.rollback).toHaveBeenCalled();
 });
 test('bounded aggregate cannot masquerade as complete, and omitted future records suppress metrics',async()=>{
  const capped=await readPaperView(1,defaultPaperViewQuery(),fixture(23,{pointCount:10001}).db);
  expect(capped.valuationPage.totalCount).toBe(10001);expect(capped.observation.truncated).toBe(true);expect(capped.observation.returnPct).toBeNull();expect(capped.observation.missingSessions).toBeNull();expect(capped.observation.lastObserved?.id).toBe(cycle(2).id);
  const future=await readPaperView(1,defaultPaperViewQuery(),fixture(23,{futureCount:1}).db);expect(future.observation.issues).toContain('future_records_excluded');expect(future.observation.returnPct).toBeNull();
 });
 test('period filters are SQL-bound identically across count/page/aggregate and stable ID sorting',async()=>{
  const f=fixture();await readPaperView(1,{...defaultPaperViewQuery(),period:'week',anchorSession:'2026-11-06'},f.db);
  const calls=f.query.mock.calls.filter(([sql])=>sql.includes('session_date>=?'));
  expect(calls.length).toBeGreaterThanOrEqual(5);
  for(const [,params]of calls){expect(params).toEqual(expect.arrayContaining(['2026-11-02','2026-11-08']));}
  expect(f.query.mock.calls.some(([sql])=>sql.includes('ORDER BY s.created_at DESC,s.id DESC LIMIT ? OFFSET ?'))).toBe(true);
 });
 test('snapshot-completed sessions after the last stored cycle remain missing',async()=>{
  const f=fixture(0,{earlyGap:true}),v=await readPaperView(1,defaultPaperViewQuery(),f.db);
  expect(v.history.lastSession).toBe('2026-11-03');expect(v.observation.asOfSession).toBe('2026-11-06');
  expect(v.observation.expectedSessions).toBe(5);expect(v.observation.missingSessions).toBe(3);
  expect(v.observation.status).toBe('unconfirmed');expect(v.observation.returnPct).toBeNull();
 });
 test('blocked current with its own run shows the selected usable cycle policy only',async()=>{
  const f=fixture(0,{blockedWithRun:true}),v=await readPaperView(1,defaultPaperViewQuery(),f.db);
  expect(v.currentCycle?.sourceRunId).toBe('blocked-run');expect(v.lastUsableCycle?.sourceRunId).toBe('usable-run');
  expect(v.policyRecord.runId).toBe('usable-run');expect(v.policyRecord.policyVersion).toBe('usable-policy');
  const policyReads=f.query.mock.calls.filter(([sql])=>sql.includes('SELECT policy_version'));
  expect(policyReads).toHaveLength(1);expect(policyReads[0][1][0]).toBe('usable-run');
 });
 test('rehearsal-only history has no forward bounds while saved-period options stay available',async()=>{
  const f=fixture(0,{rehearsalOnly:true}),v=await readPaperView(1,defaultPaperViewQuery(),f.db);
  expect(v.history.firstSession).toBeNull();expect(v.history.lastSession).toBeNull();
  expect(v.history.availablePeriods.weeks).toEqual(['2026-11-02']);expect(v.observation.totalPoints).toBe(0);expect(v.observation.returnPct).toBeNull();
  const historySql=f.query.mock.calls.find(([sql])=>sql.includes('savedFirstSession'))?.[0];
  expect(historySql).toContain("MIN(CASE WHEN mode='forward' THEN session_date END)");expect(historySql).toContain("MAX(CASE WHEN mode='forward' THEN session_date END)");
 });
 test('tampered token never authorizes arbitrary cutoff; invalid pages never connect',async()=>{
  const f=fixture();await expect(readPaperView(1,{...defaultPaperViewQuery(),snapshot:'fabricated'},f.db)).rejects.toMatchObject({status:409});
  f.query.mockClear();await expect(readPaperView(1,{...defaultPaperViewQuery(),signalPage:1.1},f.db)).rejects.toMatchObject({status:400});expect(f.query).not.toHaveBeenCalled();
 });
});

test('a new persisted forecast updates snapshot clock and invalidates the old page token',async()=>{
 const f=fixture(),first=await readPaperView(1,defaultPaperViewQuery(),f.db);f.issueForecast();
 await expect(readPaperView(1,{...defaultPaperViewQuery(),snapshot:first.snapshot.token},f.db)).rejects.toMatchObject({status:409});
 const updated=await readPaperView(1,defaultPaperViewQuery(),f.db);expect(updated.snapshot.asOf).toBe('2026-11-08T12:00:00.000000Z');expect(updated.snapshot.token).not.toBe(first.snapshot.token);
});

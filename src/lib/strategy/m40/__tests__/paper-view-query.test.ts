import {parsePaperViewQuery,paperPage} from '../paper-view-query';
import {paperAvailablePeriods,paperCompletedSession,paperObservation,paperPeriodRange} from '../paper-view-period';
import {readForwardCalendarRange} from '../forward-calendar';
import type {PaperValuationPoint} from '../paper-view-types';
const p=(session:string,equityUsd:number,observedAt=session+'T23:00:00Z'):PaperValuationPoint=>({id:session,session,equityUsd,observedAt});
const observation=(points:PaperValuationPoint[],extra:Partial<Parameters<typeof paperObservation>[0]>={})=>paperObservation({period:'all',anchor:null,asOfSession:points.at(-1)?.session??null,globalFirstForwardSession:extra.prior?.session??points[0]?.session??null,points,prior:null,totalPoints:points.length,truncated:false,...extra});
describe('v6 strict query and full-range observation',()=>{
 test('query defaults, exact ten rows, duplicate/unknown/injection/invalid calendar rejection',()=>{
  expect(parsePaperViewQuery(new URLSearchParams())).toMatchObject({period:'all',signalPage:1,valuationPage:1,horizon:'week',snapshot:null});
  expect(parsePaperViewQuery(new URLSearchParams('period=month&anchorSession=2026-02-28&signalPage=2&horizon=year'))).toMatchObject({period:'month',signalPage:2,horizon:'year'});
  for(const raw of ['period=x','period=week','period=month&anchorSession=2026-02-30','anchorSession=2026-01-01','signalPage=0','signalPage=1.5','signalPage=9999999','signalPage=1&signalPage=2','extra=1','limit=20','snapshot=%27%20OR%201=1'])expect(()=>parsePaperViewQuery(new URLSearchParams(raw))).toThrow();
 });
 test.each([0,1,10,11,23])('count %i clamps using complete count',n=>{const page=paperPage([],999,n);expect(page.page).toBe(Math.max(1,Math.ceil(n/10)));expect(page.totalCount).toBe(n);expect(page.hasNext).toBe(false);expect(page.pageSize).toBe(10);});
 test('US Monday weeks, month end, leap year, year-crossing and bounded period options',()=>{
  expect(paperPeriodRange('week','2027-01-01')).toEqual({start:'2026-12-28',end:'2027-01-03'});
  expect(paperPeriodRange('month','2028-02-29')).toEqual({start:'2028-02-01',end:'2028-02-29'});
  expect(paperPeriodRange('month','2026-02-28')).toEqual({start:'2026-02-01',end:'2026-02-28'});
  expect(paperAvailablePeriods('2026-12-31','2027-01-04')).toMatchObject({weeks:['2027-01-04','2026-12-28'],months:['2027-01-01','2026-12-01'],truncated:false});
  expect(paperAvailablePeriods('1900-01-01','2027-01-04').truncated).toBe(true);
 });
 test('official schedule includes half days and refuses unknown/invalid/oversized ranges',()=>{
  expect(readForwardCalendarRange('2026-11-26','2026-11-27')?.map(s=>s.session)).toEqual(['2026-11-27']);
  expect(readForwardCalendarRange('2026-11-27','2026-11-27')?.[0].closeAt).toBe('2026-11-27T18:00:00.000Z');
  for(const [from,to] of [['2025-12-31','2026-01-02'],['2026-02-30','2026-03-02'],['2027-01-02','2026-01-02'],['2026-01-01','2028-01-01']])expect(readForwardCalendarRange(from,to)).toBeNull();
  expect(paperCompletedSession('2026-11-09T15:00:00Z')).toBe('2026-11-06');
  expect(paperCompletedSession('2026-11-27T18:00:00Z')).toBe('2026-11-27');
  expect(paperCompletedSession('2028-01-01T23:00:00Z')).toBeNull();
 });
 test('all uses first forward, never clone, and full series MDD/net account P&L',()=>{
  const o=observation([p('2026-11-02',100),p('2026-11-03',80),p('2026-11-04',110)]);
  expect(o.status).toBe('observed');expect(o.returnPct).toBeCloseTo(10);expect(o.pnlUsd).toBe(10);expect(o.maxDrawdownPct).toBeCloseTo(-20);expect(o.baseline?.kind).toBe('first_forward');expect(o.cagrPct).toBeNull();
 });
 test('period requires immediately prior confirmed baseline, at least two points, complete canonical coverage',()=>{
  const points=[p('2026-11-02',100),p('2026-11-03',110)];
  const o=observation(points,{period:'week',anchor:'2026-11-03',prior:p('2026-10-30',90)});
  expect(o.status).toBe('observed');expect(o.partialPeriod).toBe(true);expect(o.returnPct).toBeCloseTo((110/90-1)*100);
  expect(observation(points,{period:'week',anchor:'2026-11-03'}).returnPct).toBeNull();
  expect(observation(points,{period:'week',anchor:'2026-11-03',prior:p('2026-10-29',90)}).issues).toContain('baseline_gap');
  expect(observation([points[0]],{period:'week',anchor:'2026-11-03',prior:p('2026-10-30',90)}).returnPct).toBeNull();
 });
 test('gap, zero/one point, invalid equity, unsupported calendar, truncation and future/unclosed records are unconfirmed',()=>{
  expect(observation([]).status).toBe('not_started');expect(observation([p('2026-11-02',100)]).returnPct).toBeNull();
  expect(observation([p('2026-11-02',100),p('2026-11-04',110)]).issues).toContain('missing_sessions');
  expect(observation([p('2026-11-02',0),p('2026-11-03',110)]).returnPct).toBeNull();
  expect(observation([p('2025-11-03',100),p('2025-11-04',110)]).calendarStatus).toBe('unknown');
  const cap=observation([p('2026-11-02',100),p('2026-11-03',110)],{truncated:true,totalPoints:10001,lastActual:p('2026-11-06',120),observedCount:10001});
  expect(cap.returnPct).toBeNull();expect(cap.lastObserved?.session).toBe('2026-11-06');expect(cap.missingSessions).toBeNull();
  for(const points of [[p('2026-11-02',100),p('2026-11-03',110)], [p('2026-11-02',100,'2026-11-02T15:00:00Z'),p('2026-11-03',110)]])expect(observation(points,{snapshotAsOf:'2026-11-03T16:00:00Z'}).issues).toContain('unconfirmed_observation_time');
  expect(observation([p('2026-11-26',100),p('2026-11-27',110)]).issues).toContain('noncanonical_observation');
 });
 test('a mid-month first forward record excludes pre-account days from expected coverage',()=>{
  const o=observation([p('2026-11-09',100),p('2026-11-10',110)],{period:'month',anchor:'2026-11-01',globalFirstForwardSession:'2026-11-09',asOfSession:'2026-11-10'});
  expect(o.expectedSessions).toBe(2);expect(o.observedSessions).toBe(2);expect(o.missingSessions).toBe(0);expect(o.partialPeriod).toBe(true);
  expect(o.issues).toContain('account_started_during_period');expect(o.issues).not.toContain('missing_sessions');expect(o.returnPct).toBeNull();
 });
 test('the month before account start has zero observation targets; unknown account start stays unknown',()=>{
  const before=observation([],{period:'month',anchor:'2026-10-01',globalFirstForwardSession:'2026-11-09',asOfSession:'2026-11-10'});
  expect(before.status).toBe('not_started');expect(before.expectedSessions).toBe(0);expect(before.observedSessions).toBe(0);expect(before.missingSessions).toBe(0);expect(before.returnPct).toBeNull();
  const unknown=observation([],{period:'month',anchor:'2026-10-01',globalFirstForwardSession:null,asOfSession:'2026-11-10'});
  expect(unknown.expectedSessions).toBeNull();expect(unknown.missingSessions).toBeNull();expect(unknown.issues).toContain('account_start_unknown');
 });
 test('an account that predates the month still detects a missing first session within that month',()=>{
  const o=observation([p('2026-11-03',100),p('2026-11-04',110)],{period:'month',anchor:'2026-11-01',globalFirstForwardSession:'2026-10-01',prior:p('2026-10-30',90),asOfSession:'2026-11-04'});
  expect(o.expectedSessions).toBe(3);expect(o.missingSessions).toBe(1);expect(o.issues).toContain('missing_sessions');expect(o.returnPct).toBeNull();
 });
 test('a later persisted cutoff exposes trailing unobserved completed sessions',()=>{
  const o=observation([p('2026-11-02',100),p('2026-11-03',110)],{asOfSession:'2026-11-06',snapshotAsOf:'2026-11-07T02:00:00Z'});
  expect(o.expectedSessions).toBe(5);expect(o.observedSessions).toBe(2);expect(o.missingSessions).toBe(3);expect(o.returnPct).toBeNull();
 });
 test('CAGR requires complete 365-day observations and actual endpoints',()=>{
  const calendar=readForwardCalendarRange('2026-01-02','2027-01-04')!;
  const points=calendar.map((s,i)=>p(s.session,100+i));
  const o=observation(points);expect(o.cagrPct).not.toBeNull();
  expect(observation(points.slice(0,-2)).cagrPct).toBeNull();
  expect(observation(points,{truncated:true}).cagrPct).toBeNull();
 });
});

test('forecast id is a bounded immutable selector and independent from observation period',()=>{
 const id='a'.repeat(64);expect(parsePaperViewQuery(new URLSearchParams('forecastId='+id+'&horizon=year'))).toMatchObject({forecastId:id,horizon:'year',period:'all'});
 for(const bad of ['','x','a'.repeat(65),"' OR 1=1"])expect(()=>parsePaperViewQuery(new URLSearchParams({forecastId:bad}))).toThrow('paper_forecast_id_invalid');
});

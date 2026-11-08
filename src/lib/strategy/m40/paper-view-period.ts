import {readForwardCalendarRange,validForwardSessionDate,normalizeForwardUtc} from './forward-calendar';
import type {PaperObservation,PaperValuationPoint,PaperViewPeriod} from './paper-view-types';
const dayMs=86_400_000;
const addDays=(day:string,n:number)=>new Date(Date.parse(`${day}T00:00:00Z`)+n*dayMs).toISOString().slice(0,10);
/** Latest exchange close at a persisted UTC cutoff; no machine-clock fallback. */
export function paperCompletedSession(asOf:string):string|null {
 if(!normalizeForwardUtc(asOf))return null;
 const day=asOf.slice(0,10),from=addDays(day,-14);
 const calendar=readForwardCalendarRange(from<'2026-01-01'?'2026-01-01':from,day);
 return calendar?.filter(s=>Date.parse(s.closeAt)<=Date.parse(asOf)).at(-1)?.session??null;
}
export function paperPeriodRange(period:PaperViewPeriod,anchor:string|null):{start:string|null;end:string|null} {
 if(period==='all')return {start:null,end:null};
 if(!validForwardSessionDate(anchor))throw Error('paper_anchor_invalid');
 if(period==='week'){const weekday=new Date(`${anchor}T00:00:00Z`).getUTCDay();const start=addDays(anchor,-((weekday+6)%7));return {start,end:addDays(start,6)};}
 const start=anchor.slice(0,7)+'-01',next=new Date(`${start}T00:00:00Z`);next.setUTCMonth(next.getUTCMonth()+1);return {start,end:addDays(next.toISOString().slice(0,10),-1)};
}
export function paperAvailablePeriods(first:string|null,last:string|null){
 const weeks:string[]=[],months:string[]=[];
 if(!validForwardSessionDate(first)||!validForwardSessionDate(last)||first>last)return {weeks,months,truncated:false};
 const firstWeek=paperPeriodRange('week',first).start!,firstMonth=first.slice(0,7)+'-01';
 let cursor=paperPeriodRange('week',last).start!;while(cursor>=firstWeek&&weeks.length<530){weeks.push(cursor);cursor=addDays(cursor,-7);}
 let month=last.slice(0,7)+'-01';while(month>=firstMonth&&months.length<120){months.push(month);const previous=new Date(`${month}T00:00:00Z`);previous.setUTCMonth(previous.getUTCMonth()-1);month=previous.toISOString().slice(0,10);}
 return {weeks,months,truncated:cursor>=firstWeek||month>=firstMonth};
}
/** A full-range calculation; page rows must never be supplied as a complete range. */
export function paperObservation(args:{period:PaperViewPeriod;anchor:string|null;asOfSession:string|null;globalFirstForwardSession:string|null;points:PaperValuationPoint[];prior:PaperValuationPoint|null;totalPoints:number;truncated:boolean;firstActual?:PaperValuationPoint|null;lastActual?:PaperValuationPoint|null;observedCount?:number;snapshotAsOf?:string;extraIssues?:string[]}):PaperObservation {
 const range=paperPeriodRange(args.period,args.anchor),points=args.points;
 const first=args.firstActual===undefined?points[0]??null:args.firstActual,last=args.lastActual===undefined?points.at(-1)??null:args.lastActual;
 const globalStart=validForwardSessionDate(args.globalFirstForwardSession)?args.globalFirstForwardSession:null;
 const start=range.start??globalStart??first?.session??null,end=range.end??args.asOfSession??last?.session??null;
 const effectiveEnd=end&&args.asOfSession?(end<args.asOfSession?end:args.asOfSession):end;
 // Sessions before the first recorded forward cycle are outside account observation coverage.
 const coverageStart=globalStart&&start?(start>globalStart?start:globalStart):null;
 const beforeAccountStart=!!(globalStart&&effectiveEnd&&effectiveEnd<globalStart);
 const accountStartedDuringPeriod=!!(range.start&&range.end&&globalStart&&range.start<globalStart&&globalStart<=range.end);
 const calendar=beforeAccountStart?[]:coverageStart&&effectiveEnd&&coverageStart<=effectiveEnd?readForwardCalendarRange(coverageStart,effectiveEnd):null;
 const observed=new Set(points.filter(p=>p.equityUsd!==null&&p.equityUsd>0).map(p=>p.session));
 const missing=calendar&&!args.truncated?calendar.filter(s=>!observed.has(s.session)).length:null;
 const baseline=args.period==='all'?(first?{kind:'first_forward' as const,point:first}:null):(args.prior?{kind:'prior_forward' as const,point:args.prior}:null);
 const issues:string[]=[...(args.extraIssues??[])];
 if(!globalStart)issues.push('account_start_unknown');
 if(beforeAccountStart)issues.push('before_account_start');
 if(accountStartedDuringPeriod)issues.push('account_started_during_period');
 if(args.truncated)issues.push('aggregate_truncated');
 if(!calendar)issues.push('calendar_unknown');
 if(args.snapshotAsOf&&points.some(p=>!p.observedAt||Date.parse(p.observedAt)>Date.parse(args.snapshotAsOf!)||!readForwardCalendarRange(p.session,p.session)?.some(s=>Date.parse(s.closeAt)<=Date.parse(args.snapshotAsOf!))||Date.parse(p.observedAt)<Date.parse(readForwardCalendarRange(p.session,p.session)?.[0]?.closeAt??'invalid')))issues.push('unconfirmed_observation_time');
 if(missing!==null&&missing>0)issues.push('missing_sessions');
 if(calendar&&points.some(p=>!calendar.some(c=>c.session===p.session)))issues.push('noncanonical_observation');
 if(!baseline||baseline.point.equityUsd===null||baseline.point.equityUsd<=0)issues.push('baseline_unknown');
 if(points.length<2)issues.push('insufficient_points');
 if(new Set(points.map(p=>p.session)).size!==points.length)issues.push('duplicate_sessions');
 if(points.some(p=>p.equityUsd===null||p.equityUsd<=0||!p.observedAt||!normalizeForwardUtc(p.observedAt)))issues.push('valuation_unknown');
 if(args.snapshotAsOf&&baseline){const b=baseline.point,cal=readForwardCalendarRange(b.session,b.session);if(!b.observedAt||!normalizeForwardUtc(b.observedAt)||Date.parse(b.observedAt)>Date.parse(args.snapshotAsOf)||!cal?.length||Date.parse(b.observedAt)<Date.parse(cal[0].closeAt))issues.push('baseline_time_unknown');}
 if(args.period!=='all'&&baseline&&start){
  const before=addDays(start,-14),previous=readForwardCalendarRange(before,addDays(start,-1))?.at(-1)?.session;
  if(!previous||baseline.point.session!==previous)issues.push('baseline_gap');
 }
 let returnPct:number|null=null,pnlUsd:number|null=null,maxDrawdownPct:number|null=null,cagrPct:number|null=null;
 if(!issues.length&&baseline&&last&&baseline.point.equityUsd!==null&&last.equityUsd!==null){
  const base=baseline.point.equityUsd,final=last.equityUsd;const ret=(final/base-1)*100,pnl=final-base;
  let peak=base,dd=0;for(const p of points){peak=Math.max(peak,p.equityUsd!);dd=Math.min(dd,p.equityUsd!/peak-1);}
  if(Number.isFinite(ret)&&Number.isFinite(pnl)&&Number.isFinite(dd)){returnPct=ret;pnlUsd=pnl;maxDrawdownPct=dd*100;}
  const days=(Date.parse(last.session)-Date.parse(baseline.point.session))/dayMs;
  if(days>=365){const cagr=(Math.pow(final/base,365.25/days)-1)*100;cagrPct=Number.isFinite(cagr)?cagr:null;}
 }
 return {period:args.period,startSession:start,endSession:end,asOfSession:args.asOfSession,baseline,firstObserved:first,lastObserved:last,totalPoints:args.totalPoints,
 expectedSessions:calendar?.length??null,observedSessions:args.observedCount??observed.size,missingSessions:missing,partialPeriod:accountStartedDuringPeriod||!!(range.end&&args.asOfSession&&range.end>args.asOfSession),truncated:args.truncated,
 calendarStatus:calendar?'known':'unknown',status:!args.totalPoints?'not_started':issues.length?'unconfirmed':'observed',returnPct,pnlUsd,maxDrawdownPct,cagrPct,issues,
 scope:'account_including_existing_holdings',signalAttribution:'not_supported'};
}

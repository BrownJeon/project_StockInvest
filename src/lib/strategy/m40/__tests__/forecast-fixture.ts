import { extendForwardCalendar } from '../forward-calendar';
import type { ForecastPrepareArgs } from '../forecast-types';
import type { ForwardCalendarSession } from '../forward-types';

/** Entirely synthetic figures, not production account data. */
export function forecastFixture(symbolCount=6,flat=false):ForecastPrepareArgs {
 const history:ForwardCalendarSession[]=[];
 for(let t=Date.parse('2025-01-02');t<=Date.parse('2025-12-31');t+=86400_000){
  const date=new Date(t);if(date.getUTCDay()===0||date.getUTCDay()===6)continue;
  const session=date.toISOString().slice(0,10);
  history.push({session,openAt:`${session}T14:30:00Z`,closeAt:`${session}T21:00:00Z`,source:'historical_canonical'});
 }
 const calendar=extendForwardCalendar(history,'2027-11-12'),asOf='2026-11-06';
 const sessions=calendar.filter(c=>c.session<=asOf);
 const symbols=Array.from({length:symbolCount},(_,i)=>`NAS:S${String(i).padStart(3,'0')}`);
 const observedAt='2026-11-08T01:00:00Z';
 return {accountId:'synthetic-test-account',accountRevision:1,issuedAt:'2026-11-08T02:00:00Z',
  sourceAvailableAt:observedAt,sourceDatasetId:'synthetic-test-dataset',calendar,
  policy:{policyId:'synthetic-policy',strategyId:'m40-paper-v1',registeredAt:observedAt,referenceSymbols:symbols,
   epochSession:null,frozenCohort:{symbols,excluded:[],asOfSession:asOf,frozenAt:observedAt}},
  book:{cashUsd:10000,receivables:[],holdings:[],initialEquityUsd:10000,peakEquityUsd:10000,lastForwardSession:null,splitBasis:{}},
  bundle:{schemaVersion:1,asOfSession:asOf,observedAt,dateWindow:{start:sessions[0].session,end:asOf},failures:[],complete:true,sourceUse:'evaluation_only',
   records:symbols.flatMap((symbol,s)=>['raw','split_adjusted'].map(basis=>({symbol,vendorTicker:symbol.slice(4),basis:basis as 'raw'|'split_adjusted',
    sourceId:`synthetic-${basis}`,request:{},observedAt,sha256:'a'.repeat(64),
    rows:sessions.map((c,d)=>{
     const close=flat?100:100*Math.exp(.0005*d+.025*Math.sin(d*.13+s*.2));
     const open=flat?100:close*Math.exp(.003*Math.cos(d*.41+s*.1));
     return {session:c.session,open:String(open),close:String(close),high:String(Math.max(open,close)),low:String(Math.min(open,close)),volume:'1000'};
    })}))),
   market:{sourceId:'synthetic-sp500',sourceUrl:'https://example.invalid/synthetic',observedAt,sha256:'b'.repeat(64),
    rows:sessions.map((c,d)=>({session:c.session,close:String(flat?100:100*Math.exp(.0004*d+.01*Math.sin(d*.13)))}))}}
 };
}

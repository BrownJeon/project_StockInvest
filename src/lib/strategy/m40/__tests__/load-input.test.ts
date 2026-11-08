jest.mock('@/lib/db',()=>({getPool:jest.fn(()=>{throw new Error('no real DB in tests');})}));
import { validateM40Snapshot,loadM40Input } from '../load-input';
import type { M40Input } from '../types';
const sessions:string[]=[];
for(let d=new Date('2025-01-02T00:00:00Z');sessions.length<250;d.setUTCDate(d.getUTCDate()+1))if(d.getUTCDay()&&d.getUTCDay()!==6)sessions.push(d.toISOString().slice(0,10));
const calendar=sessions.map(session=>({session,closeAt:session+'T21:00:00Z'}));
function fixture():M40Input{return {asOfSession:sessions[220],decisionTime:sessions[220]+'T21:30:00Z',sessions,rebalanceEpochSession:sessions[220],universeComplete:true,marketBars:calendar.slice(20,220).map(s=>({session:s.session,close:100,final:true,availableAt:s.closeAt,priceBasis:'index'})),members:[],holdings:[],account:{equityUsd:10000,settledCashUsd:10000}};}
test('exact calendar and fixed common epoch required; preclose final claim rejected',()=>{
 const f=fixture(); expect(()=>validateM40Snapshot(f,calendar,sessions[220],f.decisionTime,f.asOfSession)).not.toThrow();
 expect(()=>validateM40Snapshot(f,calendar,sessions[200],f.decisionTime,f.asOfSession)).toThrow('m40_input_invalid');
 f.marketBars=[{...f.marketBars[0],availableAt:f.marketBars[0].session+'T20:00:00Z'}];
 expect(()=>validateM40Snapshot(f,calendar,sessions[220],f.decisionTime,f.asOfSession)).toThrow('m40_input_invalid');
});
test('republishing old payload today never makes a fresh live snapshot',()=>{
 const f=fixture();expect(()=>validateM40Snapshot(f,calendar,sessions[220],sessions[230]+'T21:30:00Z',f.asOfSession)).toThrow('m40_input_stale');
 expect(()=>validateM40Snapshot(f,calendar,sessions[220],f.decisionTime,sessions[219])).toThrow('m40_input_invalid');
 f.sessions=sessions.filter((_,i)=>i!==205);
 expect(()=>validateM40Snapshot(f,calendar,sessions[220],f.decisionTime,f.asOfSession)).toThrow('m40_input_invalid');
});
test('unconfigured global epoch blocks before source read; no legacy fallback',async()=>{
 const old=process.env.T156_M40_EPOCH_SESSION;delete process.env.T156_M40_EPOCH_SESSION;const db={query:jest.fn()};
 try{await expect(loadM40Input({},db)).rejects.toThrow('m40_policy_not_configured');expect(db.query).not.toHaveBeenCalled();}finally{if(old!==undefined)process.env.T156_M40_EPOCH_SESSION=old;}
});

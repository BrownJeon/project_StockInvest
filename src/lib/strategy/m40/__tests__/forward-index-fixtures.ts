import { indexEvidenceSha, kisIndexRequest, KIS_SP500_SOURCE_ID, type KisIndexEnvelope, type KisIndexPage } from '../forward-index-contract';
import type { ForwardCalendarSession } from '../forward-types';
export function indexFixture(){
  const calendar:ForwardCalendarSession[]=[];
  for(let t=Date.parse('2024-01-02T00:00:00Z');t<=Date.parse('2025-02-28T00:00:00Z');t+=86400_000){
    const date=new Date(t),session=date.toISOString().slice(0,10);
    if([0,6].includes(date.getUTCDay()))continue;
    calendar.push({session,openAt:`${session}T14:30:00Z`,closeAt:`${session}T21:00:00Z`,source:'historical_canonical'});
  }
  const rows=calendar.map((s,i)=>({session:s.session,close:`${5000+i}.10`}));
  const start=calendar[0].session,end=calendar[calendar.length-1].session,now='2025-03-03T00:00:00.000Z';
  function raw(start:string,end:string,omit=new Set<string>()){
    return JSON.stringify({rt_cd:'0',output1:{stck_shrn_iscd:'SPX',hts_kor_isnm:'S&P500'},output2:
      rows.filter(r=>r.session>=start&&r.session<=end&&!omit.has(r.session)).reverse().map(r=>({stck_bsop_date:r.session.replace(/-/g,''),ovrs_nmix_prpr:r.close}))});
  }
  const pages:KisIndexPage[]=[];
  for(let from=start;from<=end;){
    const to=new Date(Math.min(Date.parse(`${from}T00:00:00Z`)+69*86400_000,Date.parse(`${end}T00:00:00Z`))).toISOString().slice(0,10);
    const rawJson=raw(from,to);pages.push({request:kisIndexRequest(from,to),http:200,observedAt:now,rawJson,sha256:indexEvidenceSha(rawJson)});
    from=new Date(Date.parse(`${to}T00:00:00Z`)+86400_000).toISOString().slice(0,10);
  }
  const rawCsv='observation_date,SP500\n'+rows.map(r=>`${r.session},${r.close}0`).join('\n');
  const fred={sourceUrl:`https://fred.stlouisfed.org/graph/fredgraph.csv?id=SP500&cosd=${start}&coed=${end}`,observedAt:now,rawCsv,sha256:indexEvidenceSha(rawCsv)};
  const envelope:KisIndexEnvelope={schemaVersion:1,sourceId:KIS_SP500_SOURCE_ID,series:'SP500',unit:'INDEX',sourceUse:'evaluation_only',liveEligible:false,dateWindow:{start,end},pages,fred};
  return {calendar,rows,start,end,now,raw,envelope,options:{calendar,start,end,now}};
}

import { canonicalIndexDecimal, indexEvidenceSha, validateKisIndexEnvelope, type KisIndexEnvelope } from '../forward-index-contract';
import { indexFixture } from './forward-index-fixtures';
const verify=(envelope:KisIndexEnvelope,options=indexFixture().options)=>validateKisIndexEnvelope(JSON.stringify(envelope),options);
function mutatePage(envelope:KisIndexEnvelope,edit:(payload:any)=>void){
  const page=envelope.pages[0],parsed=JSON.parse(page.rawJson);edit(parsed);page.rawJson=JSON.stringify(parsed);page.sha256=indexEvidenceSha(page.rawJson);
}
describe('KIS S&P500 independent evidence contract',()=>{
  it('derives every row from KIS and verifies >=200 exact FRED overlaps',()=>{
    const f=indexFixture(),checked=verify(f.envelope,f.options);
    expect(checked.rows).toEqual(f.rows);expect(checked.overlapSessions).toBe(f.rows.length);
    expect(checked.sha256).toBe(indexEvidenceSha(JSON.stringify(f.envelope)));expect(checked.observedAt).toBe(f.now);
  });
  it('normalizes trailing zeroes only, with no floating point rounding',()=>{
    expect(canonicalIndexDecimal('5000.1000')).toBe('5000.1');expect(canonicalIndexDecimal('5000')).toBe('5000');
    for(const value of ['0','0.000','01.2','1e3','-1','NaN','1.',' 1.2',1.2])expect(()=>canonicalIndexDecimal(value)).toThrow();
    const f=indexFixture();mutatePage(f.envelope,p=>{p.output2[0].ovrs_nmix_prpr='5049.100000000001';});
    expect(()=>verify(f.envelope,f.options)).toThrow('fred_mismatch');
  });
  it.each([
    (e:KisIndexEnvelope)=>{e.pages[0].sha256='0'.repeat(64);},
    (e:KisIndexEnvelope)=>{e.fred.sha256='0'.repeat(64);},
    (e:KisIndexEnvelope)=>{e.pages[0].http=503;},
    (e:KisIndexEnvelope)=>{e.pages[0].request.FID_INPUT_ISCD='.SPX';},
    (e:KisIndexEnvelope)=>{e.pages[0].request.unexpected='x';},
    (e:KisIndexEnvelope)=>{e.pages[0].observedAt='2099-01-01T00:00:00Z';},
    (e:KisIndexEnvelope)=>{e.fred.observedAt='2099-01-01T00:00:00Z';},
    (e:KisIndexEnvelope)=>{e.fred.sourceUrl='https://attacker.test/graph/fredgraph.csv?id=SP500';},
    (e:KisIndexEnvelope)=>{e.liveEligible=true as false;},
    (e:KisIndexEnvelope)=>{mutatePage(e,p=>{p.output1.stck_shrn_iscd='SPY';});},
    (e:KisIndexEnvelope)=>{mutatePage(e,p=>{p.output1.hts_kor_isnm='NASDAQ';});},
    (e:KisIndexEnvelope)=>{mutatePage(e,p=>{p.rt_cd='9';});},
    (e:KisIndexEnvelope)=>{mutatePage(e,p=>{p.output2[0].ovrs_nmix_prpr='';});},
    (e:KisIndexEnvelope)=>{mutatePage(e,p=>{p.output2[0].stck_bsop_date='20250301';});},
    (e:KisIndexEnvelope)=>{mutatePage(e,p=>{p.output2.push(p.output2[0]);});},
  ])('fails closed on altered provenance, identity, price, time or scope %#',(edit)=>{
    const f=indexFixture();edit(f.envelope);expect(()=>verify(f.envelope,f.options)).toThrow();
  });
  it('rejects a single interior missing session instead of inserting a FRED row',()=>{
    const f=indexFixture();mutatePage(f.envelope,p=>{p.output2.splice(3,1);});
    expect(()=>verify(f.envelope,f.options)).toThrow('canonical_gap');
  });
  it('rejects conflicts across pages, but permits matching repeated observations',()=>{
    const f=indexFixture(),copy=JSON.parse(JSON.stringify(f.envelope.pages[0]));f.envelope.pages.push(copy);
    expect(verify(f.envelope,f.options).rows).toEqual(f.rows);
    const payload=JSON.parse(copy.rawJson);payload.output2[0].ovrs_nmix_prpr='9999';copy.rawJson=JSON.stringify(payload);copy.sha256=indexEvidenceSha(copy.rawJson);
    expect(()=>verify(f.envelope,f.options)).toThrow('duplicate_conflict');
  });
  it('requires 200 common days and detects one exact decimal mismatch',()=>{
    const f=indexFixture();f.envelope.fred.rawCsv='DATE,SP500\n'+f.rows.slice(0,199).map(r=>`${r.session},${r.close}`).join('\n');
    f.envelope.fred.sha256=indexEvidenceSha(f.envelope.fred.rawCsv);expect(()=>verify(f.envelope,f.options)).toThrow('fred_overlap_insufficient');
    f.envelope.fred.rawCsv='DATE,SP500\n'+f.rows.map((r,i)=>`${r.session},${i===1?'5001.11':r.close}`).join('\n');
    f.envelope.fred.sha256=indexEvidenceSha(f.envelope.fred.rawCsv);expect(()=>verify(f.envelope,f.options)).toThrow('fred_mismatch');
  });
  it('preserves the existing one-session lag allowance, but rejects two sessions',()=>{
    const f=indexFixture(),last=f.rows[f.rows.length-1].session,prior=f.rows[f.rows.length-2].session;
    const page=f.envelope.pages[f.envelope.pages.length-1],payload=JSON.parse(page.rawJson);
    payload.output2=payload.output2.filter((r:any)=>r.stck_bsop_date!==last.replace(/-/g,''));
    page.rawJson=JSON.stringify(payload);page.sha256=indexEvidenceSha(page.rawJson);
    const checkedRows=verify(f.envelope,f.options).rows;expect(checkedRows[checkedRows.length-1]?.session).toBe(prior);
    payload.output2=payload.output2.filter((r:any)=>r.stck_bsop_date!==prior.replace(/-/g,''));
    page.rawJson=JSON.stringify(payload);page.sha256=indexEvidenceSha(page.rawJson);
    expect(()=>verify(f.envelope,f.options)).toThrow('canonical_gap');
  });
  it('uses an older FRED request window only as unchanged overlap proof',()=>{
    const f=indexFixture(),oldEnd=f.rows[f.rows.length-4].session;
    f.envelope.fred.sourceUrl=`https://fred.stlouisfed.org/graph/fredgraph.csv?id=SP500&cosd=${f.start}&coed=${oldEnd}`;
    f.envelope.fred.rawCsv='DATE,SP500\n'+f.rows.filter(r=>r.session<=oldEnd).map(r=>`${r.session},${r.close}`).join('\n');
    f.envelope.fred.sha256=indexEvidenceSha(f.envelope.fred.rawCsv);
    const result=verify(f.envelope,{...f.options,start:'2023-12-25'});
    expect(result.rows).toEqual(f.rows);expect(result.overlapSessions).toBe(f.rows.length-3);
  });
  it('rejects malformed envelopes and a noncanonical/incomplete window',()=>{
    const f=indexFixture();expect(()=>validateKisIndexEnvelope('{',f.options)).toThrow('json_invalid');
    expect(()=>verify(f.envelope,{...f.options,calendar:f.calendar.slice(-252)})).toThrow();
    f.envelope.pages[1].observedAt='2025-03-02T23:59:59Z';expect(()=>verify(f.envelope,f.options)).toThrow('clock_reversed');
  });
});

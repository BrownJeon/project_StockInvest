jest.mock('../archive-reader',()=>({readResearchEvidence:jest.fn()}));
jest.mock('../operating-evidence',()=>({readOperatingM40Evidence:jest.fn()}));
import { loadM40Evidence } from '../load-evidence';
import { readOperatingM40Evidence } from '../operating-evidence';
import { readResearchEvidence } from '../archive-reader';
import type { M40Evidence } from '../advisory';
const cutoff='2026-11-06T21:30:00Z';
const item=(id:string,at='2026-11-06T20:00:00Z'):M40Evidence=>({id,kind:'news',publishedAt:at,observedAt:at,availableAt:at,sourceUrl:'https://example.org/'+id,content:'[metadata only] public source'});
beforeEach(()=>{jest.mocked(readOperatingM40Evidence).mockReset().mockResolvedValue([]);jest.mocked(readResearchEvidence).mockReset().mockResolvedValue([]);});
test('one unavailable source never suppresses the surviving evidence or leaks its error',async()=>{
 jest.mocked(readOperatingM40Evidence).mockRejectedValue(new Error('private-host-password'));
 jest.mocked(readResearchEvidence).mockResolvedValue([item('a')]);
 const r=await loadM40Evidence(cutoff);expect(r.evidence).toHaveLength(1);expect(r.issues).toEqual(['operating_evidence_unavailable']);expect(JSON.stringify(r)).not.toContain('password');
});
test('a full optional outage returns an honest empty set for base-plan fallback',async()=>{
 jest.mocked(readOperatingM40Evidence).mockRejectedValue(new Error());jest.mocked(readResearchEvidence).mockRejectedValue(new Error());
 expect(await loadM40Evidence(cutoff)).toEqual({evidence:[],issues:['operating_evidence_unavailable','research_evidence_unavailable']});
});
test('as-of latest URL version wins while future and credentialed context is excluded',async()=>{
 const old=item('old','2026-11-05T20:00:00Z'),fresh={...item('fresh'),sourceUrl:old.sourceUrl};
 jest.mocked(readResearchEvidence).mockResolvedValue([old]);
 jest.mocked(readOperatingM40Evidence).mockResolvedValue([fresh,item('future','2026-11-07T00:00:00Z'),{...item('secret'),sourceUrl:'https://user:password@example.org/x'}]);
 const r=await loadM40Evidence(cutoff);expect(r.evidence.map(x=>x.id)).toEqual(['fresh']);expect(r.issues).toContain('evidence_rejected');
});
test('budget truncation is explicit and deterministic',async()=>{
 jest.mocked(readOperatingM40Evidence).mockResolvedValue(Array.from({length:8},(_,i)=>item('i'+i)));
 const r=await loadM40Evidence(cutoff);expect(r.evidence).toHaveLength(6);expect(r.issues).toEqual(['evidence_budget_limited']);
});

test('an explicit Korean offset queries the same frozen UTC instant',async()=>{
 jest.mocked(readOperatingM40Evidence).mockResolvedValue([item('a')]);
 const r=await loadM40Evidence('2026-11-07T06:30:00+09:00');
 expect(r.evidence).toHaveLength(1);expect(readOperatingM40Evidence).toHaveBeenCalledWith('2026-11-06T21:30:00.000Z');
});

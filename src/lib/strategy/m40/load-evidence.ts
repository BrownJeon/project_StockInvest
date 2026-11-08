import { readOperatingM40Evidence } from './operating-evidence';
import { readResearchEvidence } from './archive-reader';
import { validateEvidence,type M40Evidence } from './advisory';

export type M40EvidenceIssue='operating_evidence_unavailable'|'research_evidence_unavailable'|'evidence_rejected'|'evidence_budget_limited';
/** Optional sources fail independently; no error text or invented document is forwarded. */
export async function loadM40Evidence(cutoff:string):Promise<{evidence:M40Evidence[];issues:M40EvidenceIssue[]}>{
 if(!/(?:Z|[+-]\d{2}:\d{2})$/.test(cutoff)||!Number.isFinite(Date.parse(cutoff)))return {evidence:[],issues:['evidence_rejected']};
 // Query readers use UTC. Keep explicit Z microseconds; offset conversion is conservative to milliseconds.
 const queryCutoff=cutoff.endsWith('Z')?cutoff:new Date(cutoff).toISOString();
 const sources=await Promise.allSettled([readOperatingM40Evidence(queryCutoff),readResearchEvidence(queryCutoff)]);
 const issues=new Set<M40EvidenceIssue>();const all:M40Evidence[]=[];
 for(const [i,result]of sources.entries()){
  if(result.status==='fulfilled')all.push(...result.value);
  else issues.add(i===0?'operating_evidence_unavailable':'research_evidence_unavailable');
 }
 const evidence:M40Evidence[]=[];const urls=new Set<string>();let characters=0;
 for(const item of all.sort((a,b)=>Date.parse(b.availableAt)-Date.parse(a.availableAt)||a.id.localeCompare(b.id))){
  if(validateEvidence([item],cutoff)){issues.add('evidence_rejected');continue;}
  let key:string;try{const url=new URL(item.sourceUrl);if(url.username||url.password)throw Error();url.hash='';key=url.href;}catch{issues.add('evidence_rejected');continue;}
  if(urls.has(key))continue;
  if(evidence.length>=6||characters+item.content.length>64000){issues.add('evidence_budget_limited');continue;}
  urls.add(key);characters+=item.content.length;evidence.push(item);
 }
 return {evidence,issues:[...issues].sort()};
}

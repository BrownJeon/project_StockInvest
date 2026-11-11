/** Private sidecar receipts. Missing receipts prevent comparison, never paper trading. */
import { sameSourceRegime } from './forward-source-regime';
import type { ArchiveQueryable } from '@/lib/analysis-data/types';
import type { PaperCommit } from './forward-store';
import type { PaperBook,PaperIntent,PaperOutcome } from './paper-ledger';
import type { ForwardPolicy } from './forward-types';
import { forecastHash,forecastJson } from './forecast-store';
export const fixedForecastPolicy=(p:ForwardPolicy)=>({...p,epochSession:null,epochLockedAt:null});
export interface ContinuationReceipt {
 eventEvidenceNyDate?:string;sourceRegimeSha256?:string;accountId:string;revisionBefore:number;revisionAfter:number;cycleId:string;session:string;mode:string;
 before:PaperBook;after:PaperBook;policyBefore:ForwardPolicy;policyAfter:ForwardPolicy;
 beforeSha256:string;afterSha256:string;outcomesSha256:string;shareBasisVerified:boolean;
 fills:{intent:PaperIntent;outcome:PaperOutcome}[];equityUsd:number|null;shareBasisObservations?:Record<string,{session:string;close:number}[]>;
}
const totalCash=(b:PaperBook)=>b.cashUsd+b.receivables.reduce((s,r)=>s+r.usd,0);
/** Absolute USD ceiling: 1/1,000,000 dollar, or 1/10,000 cent. Never scale with trade size.
 * IEEE-754 summation/subtraction can leave sub-microdollar noise. If an unusually
 * large book cannot reconcile within this fixed ceiling, comparison is refused;
 * rounding uncertainty never authorizes a larger unexplained cashflow or fee.
 * Share-basis observations use the existing paper checkpoint's separate 0.0001
 * absolute price tolerance. Share quantities always require exact safe integers.
 */
export const FORECAST_USD_RECONCILIATION_TOLERANCE=0.000001;
const nearUsd=(a:number,b:number)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=FORECAST_USD_RECONCILIATION_TOLERANCE;
const nearBasis=(a:number,b:number)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=0.0001;
export function verifyContinuation(r:ContinuationReceipt):string[]{
 const issues:string[]=[];
 if(r.beforeSha256!==forecastHash(r.before)||r.afterSha256!==forecastHash(r.after)||r.outcomesSha256!==forecastHash(r.fills.map(f=>f.outcome)))issues.push('continuation_hash_mismatch');
 if(r.revisionAfter!==r.revisionBefore+1)issues.push('continuation_revision_gap');
 if(forecastHash(fixedForecastPolicy(r.policyBefore))!==forecastHash(fixedForecastPolicy(r.policyAfter)))issues.push('continuation_policy_changed');
 if(!r.shareBasisVerified)issues.push('continuation_share_basis_unverified');
 const qty=(b:PaperBook)=>{const m=new Map<string,number>();for(const h of b.holdings){if(!Number.isSafeInteger(h.quantity)||h.quantity<0)issues.push('continuation_quantity_invalid');const k=h.symbol+'|'+h.strategyId;m.set(k,(m.get(k)??0)+h.quantity);}return m;};
 const expected=qty(r.before),after=qty(r.after);let delta=0;
 for(const {intent:i,outcome:o}of r.fills){if(o.status!=='filled')continue;
 const n=o.notionalUsd,f=o.feeUsd,p=o.priceUsd;if(i.feePerSide!==.0025||i.fillModel!=='next_open_fixed_quantity_or_expire'||i.accountId!==r.accountId||i.executionScope!=='paper_only'||i.executeSession!==r.session||!['buy','sell'].includes(i.side)||o.id!==i.id||o.quantity!==i.quantity||!Number.isSafeInteger(o.quantity)||o.quantity<=0||n===undefined||!Number.isFinite(n)||n<=0||p===undefined||!Number.isFinite(p)||p<=0||!nearUsd(n,o.quantity*p)||f===undefined||f<0||!nearUsd(f,n*.0025)){issues.push('continuation_fee_or_fill_invalid');continue;}
 delta+=i.side==='buy'?-n-f:n-f;
 const strategies=new Set(r.before.holdings.filter(h=>h.symbol===i.symbol&&(!i.positionIds||i.positionIds.includes(h.positionId??''))).map(h=>h.strategyId));
 const strategy=i.side==='buy'?'m40-paper-v1':strategies.size===1?[...strategies][0]:null;
 if(!strategy){issues.push('continuation_attribution_unknown');continue;}
 const k=i.symbol+'|'+strategy;expected.set(k,(expected.get(k)??0)+(i.side==='buy'?o.quantity:-o.quantity));
 }
 if(!nearUsd(totalCash(r.after)-totalCash(r.before),delta))issues.push('continuation_cashflow_unreconciled');
 for(const k of new Set([...expected.keys(),...after.keys()]))if((expected.get(k)??0)!==(after.get(k)??0))issues.push('continuation_holdings_unreconciled');
 return [...new Set(issues)];
}
export async function saveContinuation(input:PaperCommit,db:ArchiveQueryable){
 const fills:ContinuationReceipt['fills']=[];
 for(const outcome of input.outcomes){const [rows]=await db.query<Record<string,unknown>[]>('SELECT intent_json FROM t156_paper_signal WHERE id=? AND account_id=?',[outcome.id,input.lease.account.id]);if(!rows.length)throw Error('forecast_continuation_intent_missing');fills.push({intent:typeof rows[0].intent_json==='string'?JSON.parse(rows[0].intent_json):rows[0].intent_json as PaperIntent,outcome});}
 const payload=input.cycle.payload as Record<string,unknown>;
 const r:ContinuationReceipt={...(typeof payload.eventEvidenceNyDate==='string'?{eventEvidenceNyDate:payload.eventEvidenceNyDate}:{}),...(typeof payload.sourceRegimeSha256==='string'?{sourceRegimeSha256:payload.sourceRegimeSha256}:{}),accountId:input.lease.account.id,revisionBefore:input.lease.account.revision,revisionAfter:input.lease.account.revision+1,cycleId:input.cycle.id,session:input.cycle.session,mode:input.cycle.mode,before:input.lease.account.book,after:input.book,policyBefore:input.lease.account.policy,policyAfter:input.policy,beforeSha256:forecastHash(input.lease.account.book),afterSha256:forecastHash(input.book),outcomesSha256:forecastHash(input.outcomes),shareBasisVerified:payload.shareBasisVerified===true,fills,shareBasisObservations:payload.shareBasisObservations as ContinuationReceipt['shareBasisObservations'],equityUsd:typeof payload.equityUsd==='number'?payload.equityUsd:null};
 await db.query('INSERT INTO t156_forecast_continuation(account_id,revision_after,cycle_id,before_sha256,after_sha256,receipt_sha256,receipt_json,created_at) VALUES(?,?,?,?,?,?,?,UTC_TIMESTAMP(6))',[r.accountId,r.revisionAfter,r.cycleId,r.beforeSha256,r.afterSha256,forecastHash(r),forecastJson(r)]);
}

export interface CanonicalContinuationCycle {sourceRegimeSha256?:string;id:string;session:string;mode:string;equityUsd:number|null}
export interface ContinuationChain {
 accountId:string;revision:number;sourceBookSha256:string;policy:ForwardPolicy;baselineSession:string;
 baselineSourceRegimeSha256?:string;baselineSplitBasis:Record<string,{session:string;close:number}>;
 expectedSessions:string[];targetSession:string;
 anchors:{receipt:ContinuationReceipt;sha256:string}[];canonical:CanonicalContinuationCycle[];
}
/** Bidirectional cycle coverage and every receipt predicate are required; no issue is ignored. */
export function inspectContinuationChain(args:ContinuationChain):{status:'valid'|'unconfirmed'|'incomparable';issues:string[];endpoint:ContinuationReceipt|null}{
 const missing:string[]=[],invalid:string[]=[];let revision=args.revision,hash=args.sourceBookSha256;
 const cycles=new Map(args.canonical.map(c=>[c.id,c]));const receipts=new Map<string,ContinuationReceipt>();
 for(const {receipt:r,sha256}of args.anchors){
  if(r.accountId!==args.accountId||forecastHash(r)!==sha256)invalid.push('continuation_identity_or_hash_mismatch');
  if(r.revisionBefore!==revision||r.beforeSha256!==hash)missing.push('continuation_anchor_gap');
  invalid.push(...verifyContinuation(r));
  if((args.baselineSourceRegimeSha256!==undefined||r.sourceRegimeSha256!==undefined)&&!sameSourceRegime(args.baselineSourceRegimeSha256,r.sourceRegimeSha256))invalid.push('continuation_source_regime_unreconciled');
  if(forecastHash(fixedForecastPolicy(r.policyBefore))!==forecastHash(fixedForecastPolicy(args.policy))||forecastHash(fixedForecastPolicy(r.policyAfter))!==forecastHash(fixedForecastPolicy(args.policy)))invalid.push('continuation_policy_changed');
  const c=cycles.get(r.cycleId);if(!c||c.session!==r.session||c.mode!==r.mode||c.equityUsd!==r.equityUsd)missing.push('continuation_canonical_receipt_mismatch');
  if((c?.sourceRegimeSha256!==undefined||r.sourceRegimeSha256!==undefined)&&!sameSourceRegime(c?.sourceRegimeSha256,r.sourceRegimeSha256))invalid.push('continuation_canonical_source_regime_mismatch');
  if(receipts.has(r.cycleId))invalid.push('continuation_duplicate_cycle');receipts.set(r.cycleId,r);
  revision=r.revisionAfter;hash=r.afterSha256;
 }
 if(args.canonical.length!==args.anchors.length||[...cycles.keys()].some(id=>!receipts.has(id)))missing.push('continuation_canonical_cycle_missing_anchor');
 if(revision!==args.revision+args.canonical.length)missing.push('continuation_terminal_revision_gap');
 const sessions=new Set(args.anchors.filter(a=>a.receipt.mode==='forward').map(a=>a.receipt.session));
 if(!args.expectedSessions.length||args.expectedSessions.some(s=>!sessions.has(s)))missing.push('continuation_canonical_session_gap');
 const first=args.anchors[0]?.receipt;
 for(const [symbol,basis]of Object.entries(args.baselineSplitBasis)){
  const observed=first?.shareBasisObservations?.[symbol]?.find(b=>b.session===basis.session);
  if(!observed)missing.push('continuation_baseline_share_basis_missing');
  else if(!nearBasis(observed.close,basis.close))invalid.push('continuation_baseline_share_basis_changed');
 }
 for(const {receipt:r}of args.anchors)for(const [symbol,basis]of Object.entries(r.before.splitBasis)){
  const observed=r.shareBasisObservations?.[symbol]?.find(b=>b.session===basis.session);
  if(!observed)missing.push('continuation_prior_share_basis_missing');
  else if(!nearBasis(observed.close,basis.close))invalid.push('continuation_prior_share_basis_changed');
 }
 const endpoint=args.anchors.map(a=>a.receipt).filter(r=>r.session===args.targetSession&&r.mode==='forward').at(-1)??null;
 if(!endpoint)missing.push('continuation_endpoint_missing');
 return {status:invalid.length?'incomparable':missing.length?'unconfirmed':'valid',issues:[...new Set([...invalid,...missing])],endpoint};
}

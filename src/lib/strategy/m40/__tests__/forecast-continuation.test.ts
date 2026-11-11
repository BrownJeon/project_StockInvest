import { verifyContinuation, type ContinuationReceipt } from '../forecast-continuation';
import { forecastHash } from '../forecast-store';
import type { PaperBook } from '../paper-ledger';
import type { ForwardPolicy } from '../forward-types';
jest.mock('@/lib/db',()=>({getPool:jest.fn()}));
const book:PaperBook={cashUsd:1000,receivables:[],holdings:[],initialEquityUsd:1000,peakEquityUsd:1000,lastForwardSession:null,splitBasis:{}};
const policy={epochSession:null,epochLockedAt:null} as unknown as ForwardPolicy;
function receipt():ContinuationReceipt{const before=structuredClone(book),after=structuredClone(book);return {accountId:'synthetic',revisionBefore:1,revisionAfter:2,cycleId:'cycle',session:'2026-11-09',mode:'forward',before,after,policyBefore:policy,policyAfter:policy,beforeSha256:forecastHash(before),afterSha256:forecastHash(after),outcomesSha256:forecastHash([]),shareBasisVerified:true,fills:[],equityUsd:1000};}
test('normal mark/settlement metadata changes preserve economic state',()=>{const r=receipt();r.after.peakEquityUsd=1010;r.afterSha256=forecastHash(r.after);expect(verifyContinuation(r)).toEqual([]);});
test('unexplained external cash cannot become forecast performance',()=>{const r=receipt();r.after.cashUsd+=5;r.afterSha256=forecastHash(r.after);expect(verifyContinuation(r)).toContain('continuation_cashflow_unreconciled');});
test('revision gaps and changed source book are explicit',()=>{const r=receipt();r.revisionAfter=3;r.before.cashUsd=3;expect(verifyContinuation(r)).toEqual(expect.arrayContaining(['continuation_revision_gap','continuation_hash_mismatch']));});
test('phase selection alone is not a policy-core mismatch',()=>{const r=receipt();r.policyAfter={...policy,epochSession:'2026-11-09',epochLockedAt:'2026-11-08T12:00:00Z'};expect(verifyContinuation(r)).toEqual([]);});

import {inspectContinuationChain,type ContinuationChain} from '../forecast-continuation';
function chain():ContinuationChain{const r=receipt();return {accountId:r.accountId,revision:1,sourceBookSha256:r.beforeSha256,policy:r.policyBefore,baselineSession:'2026-11-06',baselineSplitBasis:{},expectedSessions:[r.session],targetSession:r.session,anchors:[{receipt:r,sha256:forecastHash(r)}],canonical:[{id:r.cycleId,session:r.session,mode:r.mode,equityUsd:r.equityUsd}]};}
test('fully linked canonical chain permits comparison',()=>expect(inspectContinuationChain(chain()).status).toBe('valid'));
test('a receipt skipping a revision can never complete despite correct economic delta',()=>{const x=chain();x.anchors[0].receipt.revisionAfter=3;x.anchors[0].sha256=forecastHash(x.anchors[0].receipt);const checked=inspectContinuationChain(x);expect(checked.status).toBe('incomparable');expect(checked.issues).toContain('continuation_revision_gap');});
test('a later target-day canonical cycle without its sidecar cannot reuse previous equity',()=>{const x=chain();x.canonical.push({...x.canonical[0],id:'later-target-cycle',equityUsd:999});const checked=inspectContinuationChain(x);expect(checked.status).toBe('unconfirmed');expect(checked.issues).toEqual(expect.arrayContaining(['continuation_canonical_cycle_missing_anchor','continuation_terminal_revision_gap']));});
test('every unknown verification issue remains fail closed',()=>{const x=chain();x.anchors[0].receipt.shareBasisVerified=false;x.anchors[0].sha256=forecastHash(x.anchors[0].receipt);expect(inspectContinuationChain(x).status).toBe('incomparable');});
test('empty original account checkpoint cannot hide split correction after forecast baseline',()=>{const x=chain();x.baselineSplitBasis={'NAS:SYN':{session:'2026-11-06',close:100}};x.anchors[0].receipt.shareBasisObservations={'NAS:SYN':[{session:'2026-11-06',close:50}]};x.anchors[0].sha256=forecastHash(x.anchors[0].receipt);expect(inspectContinuationChain(x)).toMatchObject({status:'incomparable',issues:expect.arrayContaining(['continuation_baseline_share_basis_changed'])});});
test('missing baseline historical checkpoint remains unconfirmed',()=>{const x=chain();x.baselineSplitBasis={'NAS:SYN':{session:'2026-11-06',close:100}};expect(inspectContinuationChain(x)).toMatchObject({status:'unconfirmed',issues:expect.arrayContaining(['continuation_baseline_share_basis_missing'])});});

import {settlePaperSignals,type PaperIntent} from '../paper-ledger';
import {readForwardCalendarRange,nextPaperSettlementSession} from '../forward-calendar';
import {FORECAST_USD_RECONCILIATION_TOLERANCE} from '../forecast-continuation';
function settleReceipt(before:PaperBook,side:'buy'|'sell',quantity:number,price:number,session:string,nextSession:string,revision=1):ContinuationReceipt{
 const intent:PaperIntent={id:'synthetic-'+revision,accountId:'synthetic',cycleId:'cycle-'+revision,session,createdAt:new Date(Date.parse(session+'T13:00:00Z')-86400_000).toISOString(),symbol:'NAS:SYN',side,quantity,executeSession:session,executionScope:'paper_only',status:'awaiting_open',maxDebitUsd:side==='buy'?Number.MAX_SAFE_INTEGER:null,sourceRunId:'synthetic',inputSha256:'synthetic',reason:'synthetic',feePerSide:.0025,fillModel:'next_open_fixed_quantity_or_expire',...(side==='sell'?{positionIds:before.holdings.map(h=>h.positionId!)}:{})};
 const settled=settlePaperSignals({book:before,intents:[intent],opens:[{symbol:intent.symbol,session,open:price,observedAt:session+'T21:00:00Z',sha256:'synthetic'}],session,cutoff:session+'T23:00:00Z',openingAt:()=>session+'T14:30:00Z',settlementAfter:()=>nextSession});
 expect(settled.outcomes).toHaveLength(1);expect(settled.outcomes[0].status).toBe('filled');
 return {...receipt(),before:structuredClone(before),after:settled.book,revisionBefore:revision,revisionAfter:revision+1,cycleId:intent.cycleId,session,beforeSha256:forecastHash(before),afterSha256:forecastHash(settled.book),fills:[{intent,outcome:settled.outcomes[0]}],outcomesSha256:forecastHash(settled.outcomes)};
}
test.each([100,100000,1000000000])('absolute cashflow guard rejects $0.05 external credit on $%i actual modeled buy',notional=>{
 const r=settleReceipt({...structuredClone(book),cashUsd:notional*10},'buy',100,notional/100,'2026-11-09','2026-11-10');expect(verifyContinuation(r)).toEqual([]);
 r.after.cashUsd+=.05;r.afterSha256=forecastHash(r.after);expect(verifyContinuation(r)).toContain('continuation_cashflow_unreconciled');
});
test('100k trade fee drift cannot be hidden by adjusting cash consistently with the wrong fee',()=>{
 const r=settleReceipt({...structuredClone(book),cashUsd:1000000},'buy',100,1000,'2026-11-09','2026-11-10');
 r.fills[0].outcome.feeUsd!+=.05;r.after.cashUsd-=.05;r.afterSha256=forecastHash(r.after);r.outcomesSha256=forecastHash(r.fills.map(f=>f.outcome));expect(verifyContinuation(r)).toContain('continuation_fee_or_fill_invalid');
});
test('the USD allowance is absolute and below one cent; fractional shares remain forbidden',()=>{
 expect(FORECAST_USD_RECONCILIATION_TOLERANCE).toBe(0.000001);
 const r=settleReceipt({...structuredClone(book),cashUsd:1000000},'buy',100,1000,'2026-11-09','2026-11-10');
 r.after.cashUsd+=FORECAST_USD_RECONCILIATION_TOLERANCE/2;r.afterSha256=forecastHash(r.after);expect(verifyContinuation(r)).toEqual([]);
 r.after.holdings[0].quantity+=.0000001;r.afterSha256=forecastHash(r.after);expect(verifyContinuation(r)).toContain('continuation_quantity_invalid');
});
test('200 actual settle buy/sell paths with decimal prices and T+1 receivables reconcile within the fixed USD cap',()=>{
 const calendar=readForwardCalendarRange('2026-11-09','2027-11-08')!;let current={...structuredClone(book),cashUsd:1000000,initialEquityUsd:1000000,peakEquityUsd:1000000};
 for(let i=0;i<200;i++){const day=calendar[i].session,next=nextPaperSettlementSession(calendar,day),r=settleReceipt(current,i%2===0?'buy':'sell',997,100.3000007+(i%7)*.01234567,day,next,i+1);expect(verifyContinuation(r)).toEqual([]);current=r.after;}
 expect(current.receivables.length).toBeGreaterThan(0);
});
test('legacy forecast cannot complete across a newly recorded source convention',()=>{const x=chain();x.anchors[0].receipt.sourceRegimeSha256='a'.repeat(64);x.anchors[0].sha256=forecastHash(x.anchors[0].receipt);const r=inspectContinuationChain(x);expect(r.status).toBe('incomparable');expect(r.issues).toContain('continuation_source_regime_unreconciled');});
test('new forecast convention anchor permits only the same coherent endpoint convention',()=>{const x=chain();x.baselineSourceRegimeSha256='a'.repeat(64);x.anchors[0].receipt.sourceRegimeSha256=x.baselineSourceRegimeSha256;x.canonical[0].sourceRegimeSha256=x.baselineSourceRegimeSha256;x.anchors[0].sha256=forecastHash(x.anchors[0].receipt);expect(inspectContinuationChain(x).status).toBe('valid');x.anchors[0].receipt.sourceRegimeSha256='b'.repeat(64);x.anchors[0].sha256=forecastHash(x.anchors[0].receipt);expect(inspectContinuationChain(x).status).toBe('incomparable');});

import { cloneSnapshot,generatePaperSignals,markPaperBook,settlePaperSignals,assertPaperShareBasis,PAPER_STRATEGY_ID,type PaperBook,type PaperIntent } from '../paper-ledger';
import type { ForwardMemberData } from '../forward-types';
import type { M40Plan } from '../types';
const book=():PaperBook=>({cashUsd:1000,receivables:[],holdings:[{symbol:'NAS:TEST',quantity:2,strategyId:PAPER_STRATEGY_ID}],
 initialEquityUsd:1200,peakEquityUsd:1200,lastForwardSession:null,splitBasis:{}});
const intent=(side:'buy'|'sell',overrides:Partial<PaperIntent>={}):PaperIntent=>({id:'m40p_'+side,accountId:'test',cycleId:'cycle',session:'2026-11-09',
 createdAt:'2026-11-09T22:00:00Z',symbol:'NAS:TEST',side,quantity:2,executeSession:'2026-11-10',executionScope:'paper_only',
 status:'awaiting_open',maxDebitUsd:side==='buy'?210:null,sourceRunId:'run',inputSha256:'a'.repeat(64),reason:'test',feePerSide:.0025,
 fillModel:'next_open_fixed_quantity_or_expire',...overrides});
const settle=(b:PaperBook,intents:PaperIntent[],open=100)=>settlePaperSignals({book:b,intents,session:'2026-11-10',cutoff:'2026-11-10T22:00:00Z',
 opens:[{symbol:'NAS:TEST',session:'2026-11-10',open,observedAt:'2026-11-10T21:30:00Z',sha256:'b'.repeat(64)}],
 openingAt:()=> '2026-11-10T14:30:00Z',settlementAfter:()=> '2026-11-12'});

test('clones only US holdings and USD net deposit once, without adding unsettled-sale diagnostic',()=>{
 const positions=[{currency:'USD',qty:'100',price:'1400',src:'CTRP6504R',ustl_sll_amt_smtl:900000},
  {currency:'KRW',qty:500000},{currency:'005930',qty:10,price:200000},{currency:'NAS:TEST',qty:2,price:140000}];
 const original=JSON.stringify(positions);const clone=cloneSnapshot({id:1,at:'2026-11-08T02:00:00Z',positions},'2026-11-08T03:00:00Z');
 expect(clone.book.cashUsd).toBe(100);expect(clone.book.initialEquityUsd).toBe(300);
 expect(clone.book.holdings).toHaveLength(1);expect(clone.book.holdings[0].strategyId).toBe(PAPER_STRATEGY_ID);
 expect(JSON.stringify(positions)).toBe(original);
});
test.each([[],[{currency:'USD',qty:0,price:1400,src:'unknown'}],[{currency:'USD',qty:-1,price:1400,src:'CTRP6504R'}]].map(positions=>[positions]))(
 'unknown or invalid cash never becomes synthetic zero (%j)',positions=>expect(()=>cloneSnapshot({id:1,at:'2026-11-08T02:00:00Z',positions},'2026-11-08T03:00:00Z')).toThrow());
test('fractional copied shares are held for explicit reconciliation',()=>{
 expect(()=>cloneSnapshot({id:1,at:'2026-11-08T02:00:00Z',positions:[{currency:'USD',qty:1,price:1400,src:'CTRP6504R'},
  {currency:'NAS:TEST',qty:1.5,price:140000}]},'2026-11-08T03:00:00Z')).toThrow('paper_clone_position_invalid');
});
test('paper sales deduct 25bp and cannot finance same-open purchases before settlement',()=>{
 const b=book();b.cashUsd=0;const before=JSON.stringify(b);
 const r=settle(b,[intent('buy'),intent('sell')]);
 expect(r.outcomes.find(o=>o.id==='m40p_sell')).toMatchObject({status:'filled',feeUsd:.5,settlementSession:'2026-11-12'});
 expect(r.outcomes.find(o=>o.id==='m40p_buy')).toMatchObject({status:'expired',quantity:0});
 expect(r.book.receivables).toEqual([{usd:199.5,settlesOn:'2026-11-12'}]);expect(r.book.cashUsd).toBe(0);
 expect(JSON.stringify(b)).toBe(before);
});
test('opening gap expires the whole frozen quantity rather than resizing with future prices',()=>{
 const r=settle(book(),[intent('buy')],106);
 expect(r.outcomes[0]).toMatchObject({status:'expired',reason:'frozen_budget_or_settled_cash_exceeded',quantity:0});
 expect(r.book.cashUsd).toBe(1000);expect(r.book.holdings[0].quantity).toBe(2);
});
test('unfilled required exits and the five-symbol limit independently prevent a replacement buy',()=>{
 const b=book();
 expect(settle(b,[intent('buy',{requiresExitSymbols:['NAS:TEST']})]).outcomes[0].reason).toBe('required_paper_exit_unfilled');
 b.holdings=['A','B','C','D','E'].map(s=>({symbol:'NAS:'+s,quantity:1,strategyId:PAPER_STRATEGY_ID}));
 expect(settle(b,[intent('buy')]).outcomes[0].reason).toBe('paper_account_slot_limit');
});
test('confirmed membership exits survive a non-review session without adding general buys',()=>{
 const plan={strategyId:PAPER_STRATEGY_ID,status:'ready',isReviewSession:false,asOfSession:'2026-11-09',decisionTime:'2026-11-09T22:00:00Z',
  decisions:[{symbol:'NAS:TEST',strategyId:PAPER_STRATEGY_ID,action:'sell',quantity:2,reason:'confirmed_membership_end'}]} as M40Plan;
 const intents=generatePaperSignals({accountId:'test',cycleId:'cycle',plan,runId:'run',inputSha256:'a'.repeat(64),
  executeSession:'2026-11-10',createdAt:'2026-11-09T22:00:00Z',mode:'forward'});
 expect(intents).toHaveLength(1);expect(intents[0]).toMatchObject({side:'sell',reason:'confirmed_membership_end'});
});
test('lost or changed prior split evidence pauses the book and preserves its original checkpoint',()=>{
 const b=book();b.splitBasis={'NAS:TEST':{session:'2026-11-09',close:100}};const before=JSON.stringify(b);
 const member={symbol:'NAS:TEST',splitBars:[{session:'2026-11-10',close:101}]} as ForwardMemberData;
 expect(()=>assertPaperShareBasis(b,[member],'2026-11-10')).toThrow('paper_prior_basis_observation_missing');
 expect(JSON.stringify(b)).toBe(before);
 const changed={symbol:'NAS:TEST',splitBars:[{session:'2026-11-09',close:50},{session:'2026-11-10',close:51}]} as ForwardMemberData;
 expect(()=>assertPaperShareBasis(b,[changed],'2026-11-10')).toThrow('paper_corporate_action_reconciliation_required');
 expect(JSON.stringify(b)).toBe(before);
});
test('buy fee is debited and missing/late/future observations cannot fabricate execution',()=>{
 const r=settle(book(),[intent('buy')]);expect(r.book.cashUsd).toBe(799.5);expect(r.book.holdings[0].quantity).toBe(4);
 expect(settle(book(),[intent('buy',{createdAt:'2026-11-10T14:30:00Z'})]).outcomes[0].reason).toBe('intent_not_recorded_before_open');
 const future=settlePaperSignals({book:book(),intents:[intent('buy')],opens:[{symbol:'NAS:TEST',session:'2026-11-10',open:100,
  observedAt:'2026-11-11T01:00:00Z',sha256:'b'.repeat(64)}],session:'2026-11-10',cutoff:'2026-11-10T22:00:00Z',openingAt:()=> '2026-11-10T14:30:00Z',settlementAfter:()=> '2026-11-12'});
 expect(future.outcomes[0].reason).toBe('opening_observation_missing_or_ambiguous');
});
test('receivables mature on their declared settlement session, not on the stock-market holiday',()=>{
 const b=book();b.cashUsd=0;b.receivables=[{usd:199.5,settlesOn:'2026-11-12'}];
 expect(markPaperBook(b,new Map([['NAS:TEST',100]]),'2026-11-11').settledCashUsd).toBe(0);
 expect(markPaperBook(b,new Map([['NAS:TEST',100]]),'2026-11-12').settledCashUsd).toBe(199.5);
 expect(()=>markPaperBook(b,new Map(),'2026-11-12')).toThrow('paper_mark_price_unknown');
});
test('rehearsal intents are never executable and generated identity is deterministic',()=>{
 const plan={strategyId:PAPER_STRATEGY_ID,status:'ready',isReviewSession:true,asOfSession:'2026-11-09',decisionTime:'2026-11-09T22:00:00Z',
  decisions:[{symbol:'NAS:TEST',strategyId:PAPER_STRATEGY_ID,action:'buy',quantity:2,reason:'entry',entryBudgetUsd:210}]} as M40Plan;
 const args={accountId:'test',cycleId:'cycle',plan,runId:'run',inputSha256:'a'.repeat(64),executeSession:'2026-11-10',createdAt:'2026-11-09T22:00:00Z',mode:'rehearsal' as const};
 const a=generatePaperSignals(args);expect(a).toEqual(generatePaperSignals(args));expect(a[0].executionScope).toBe('paper_only');
 expect(settle(book(),a).outcomes).toEqual([]);
 expect(generatePaperSignals({...args,plan:{...plan,status:'data_unknown'}})).toEqual([]);
});

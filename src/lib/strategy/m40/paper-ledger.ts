/** Independent model book. It has no order, exchange or active-signal dependency. */
import { createHash } from 'node:crypto';
import type { M40Decision, M40Holding, M40Plan } from './types';
import { stableJson } from './advisory';
import type { ForwardMemberData } from './forward-types';

export const PAPER_STRATEGY_ID = 'm40-paper-v1';
export const PAPER_ACCOUNT_ID = 't156-m40-real-clone-v1';
export const PAPER_FEE = 0.0025;
export interface PaperBook {
  cashUsd: number;
  receivables: { usd: number; settlesOn: string }[];
  holdings: M40Holding[];
  initialEquityUsd: number;
  peakEquityUsd: number;
  lastForwardSession: string | null;
  /** Source snapshots for detecting unresolved share-count/adjustment changes. */
  splitBasis: Record<string, { session: string; close: number }>;
}
export interface PaperIntent {
  id: string; accountId: string; cycleId: string; session: string; createdAt: string;
  symbol: string; side: 'buy' | 'sell'; quantity: number; executeSession: string;
  executionScope: 'paper_only'; status: 'rehearsal' | 'awaiting_open';
  maxDebitUsd: number | null; sourceRunId: string; inputSha256: string;
  reason: string; feePerSide: number; fillModel: 'next_open_fixed_quantity_or_expire';
  positionIds?: readonly string[];
  requiresExitSymbols?: readonly string[];
}
export interface PaperOutcome {
  id: string; status: 'filled' | 'expired'; reason: string;
  quantity: number; priceUsd?: number; feeUsd?: number; notionalUsd?: number;
  observedAt: string; settlementSession?: string;
}
export interface RawOpen { symbol: string; session: string; open: number; observedAt: string; sha256: string }
const positive=(v:number)=>Number.isFinite(v)&&v>0;
const digest=(v:unknown)=>createHash('sha256').update(stableJson(v)).digest('hex');
function sourceNumber(v:unknown):number {
 if((typeof v!=='number'&&(typeof v!=='string'||!/^\d+(?:\.\d+)?$/.test(v)))||!Number.isFinite(Number(v)))throw Error('paper_clone_numeric_unknown');
 return Number(v);
}
/** Missing prior evidence is unknown; it must not erase the share-basis checkpoint. */
export function assertPaperShareBasis(book:PaperBook,members:readonly ForwardMemberData[],asOf:string) {
 for(const [symbol,prior]of Object.entries(book.splitBasis)){
  const current=members.find(m=>m.symbol===symbol)?.splitBars.find(b=>b.session===prior.session);
  if(!current)throw Error('paper_prior_basis_observation_missing');
  if(Math.abs(current.close-prior.close)>0.0001)throw Error('paper_corporate_action_reconciliation_required');
 }
 for(const holding of book.holdings)if(!members.find(m=>m.symbol===holding.symbol)?.splitBars.some(b=>b.session===asOf))
  throw Error('paper_current_basis_observation_missing');
}

/** Copies an existing US valuation once; no synthetic capital or KRW conversion after cloning. */
export function cloneSnapshot(snapshot:{id:number;at:string;positions:unknown},registeredAt:string) {
  let parsed:unknown=snapshot.positions;
  if(typeof parsed==='string')parsed=JSON.parse(parsed);
  if(!Array.isArray(parsed)||!Number.isFinite(Date.parse(snapshot.at))
    ||!Number.isFinite(Date.parse(registeredAt))||Date.parse(snapshot.at)>Date.parse(registeredAt)
    ||Date.parse(registeredAt)-Date.parse(snapshot.at)>96*3600_000)throw Error('paper_clone_snapshot_invalid');
  const positions=parsed as Record<string,unknown>[];
  const usdRows=positions.filter(p=>p.currency==='USD');
  if(usdRows.length!==1)throw Error('paper_clone_cash_unknown');
  const usd=usdRows[0],cash=sourceNumber(usd.qty),fx=sourceNumber(usd.price);
  if(usd.src!=='CTRP6504R'||!Number.isFinite(cash)||cash<0||!positive(fx))throw Error('paper_clone_cash_unknown');
  const holdings:M40Holding[]=[];let equity=cash;const seen=new Set<string>();
  for(const p of positions){
    if(typeof p.currency!=='string'||!/^(NAS|NYS|AMS):[A-Z][A-Z0-9.]*$/.test(p.currency))continue;
    const quantity=sourceNumber(p.qty),price=sourceNumber(p.price);
    if(!Number.isSafeInteger(quantity)||quantity<=0||!positive(price)||seen.has(p.currency))throw Error('paper_clone_position_invalid');
    seen.add(p.currency);equity+=quantity*price/fx;
    holdings.push({symbol:p.currency,quantity,strategyId:PAPER_STRATEGY_ID,positionId:`clone-${snapshot.id}-${p.currency}`});
  }
  if(!positive(equity))throw Error('paper_clone_equity_invalid');
  const source={snapshotId:snapshot.id,sourceAt:snapshot.at,registeredAt,positions:parsed,
    scope:'US holdings and USD net deposit only; KRW/domestic excluded; unsettled-sale diagnostic is not cash',
    holdingAttribution:'paper copy only; original ownership unchanged',cashSource:'CTRP6504R net deposit'};
  return {source,cloneSha256:digest(source),book:{cashUsd:cash,receivables:[],holdings,
    initialEquityUsd:equity,peakEquityUsd:equity,lastForwardSession:null,splitBasis:{}} as PaperBook};
}

export function markPaperBook(book:PaperBook,prices:ReadonlyMap<string,number>,session:string) {
  const cash=book.cashUsd+book.receivables.filter(r=>r.settlesOn<=session).reduce((s,r)=>s+r.usd,0);
  const receivables=book.receivables.filter(r=>r.settlesOn>session);
  let equity=cash+receivables.reduce((s,r)=>s+r.usd,0);
  for(const h of book.holdings){const p=prices.get(h.symbol);if(!p||!positive(p))throw Error('paper_mark_price_unknown');equity+=h.quantity*p;}
  return {book:{...book,cashUsd:cash,receivables,peakEquityUsd:Math.max(book.peakEquityUsd,equity)},
    equityUsd:equity,settledCashUsd:cash,drawdown:equity/Math.max(book.peakEquityUsd,equity)-1,
    returnSinceClone:equity/book.initialEquityUsd-1};
}

/** D0 quantities/budgets are frozen; future opening prices cannot resize or rerank them. */
export function generatePaperSignals(args:{accountId:string;cycleId:string;plan:M40Plan;runId:string;
  inputSha256:string;executeSession:string;createdAt:string;mode:'rehearsal'|'forward'}):PaperIntent[]{
  if(args.plan.strategyId!==PAPER_STRATEGY_ID||args.plan.status==='invalid_input')return [];
  if(args.executeSession<=args.plan.asOfSession||Date.parse(args.createdAt)<Date.parse(args.plan.decisionTime))throw Error('paper_signal_clock_invalid');
  return args.plan.decisions.filter((d):d is M40Decision&{action:'buy'|'sell'}=>
    ((args.plan.status==='ready'&&args.plan.isReviewSession)&&(d.action==='buy'||d.action==='sell'))
    ||(d.action==='sell'&&d.reason==='confirmed_membership_end')).map(d=>{
    if(!Number.isSafeInteger(d.quantity)||d.quantity<=0)throw Error('paper_signal_quantity_invalid');
    if(d.action==='buy'&&(!d.entryBudgetUsd||!positive(d.entryBudgetUsd)))throw Error('paper_signal_budget_unknown');
    return {id:'m40p_'+digest([args.accountId,args.plan.asOfSession,d.symbol,d.action]),accountId:args.accountId,
      cycleId:args.cycleId,session:args.plan.asOfSession,createdAt:args.createdAt,symbol:d.symbol,side:d.action,
      quantity:d.quantity,executeSession:args.executeSession,executionScope:'paper_only',
      status:args.mode==='forward'?'awaiting_open':'rehearsal',maxDebitUsd:d.action==='buy'?d.entryBudgetUsd??null:null,
      sourceRunId:args.runId,inputSha256:args.inputSha256,reason:d.reason,feePerSide:PAPER_FEE,
      fillModel:'next_open_fixed_quantity_or_expire',...(d.positionIds?{positionIds:d.positionIds}:{}),
      ...(d.requiresExitSymbols?{requiresExitSymbols:d.requiresExitSymbols}:{})};
  });
}

/** Opening-auction model evaluated only after the pre-recorded intent's next session. */
export function settlePaperSignals(args:{book:PaperBook;intents:PaperIntent[];opens:RawOpen[];
  session:string;cutoff:string;openingAt:(s:string)=>string;settlementAfter:(s:string)=>string}) {
  const book:PaperBook=JSON.parse(JSON.stringify(args.book));const outcomes:PaperOutcome[]=[];
  const ordered=[...args.intents].sort((a,b)=>a.executeSession.localeCompare(b.executeSession)
    ||(a.side==='sell'?0:1)-(b.side==='sell'?0:1)||a.id.localeCompare(b.id));
  for(const intent of ordered){
    if(intent.executionScope!=='paper_only'||intent.status!=='awaiting_open'||intent.executeSession>args.session)continue;
    const opening=args.openingAt(intent.executeSession);
    if(!Number.isFinite(Date.parse(opening))||Date.parse(opening)>Date.parse(args.cutoff))continue;
    book.cashUsd+=book.receivables.filter(r=>r.settlesOn<=intent.executeSession).reduce((s,r)=>s+r.usd,0);
    book.receivables=book.receivables.filter(r=>r.settlesOn>intent.executeSession);
    const expire=(reason:string)=>outcomes.push({id:intent.id,status:'expired',reason,quantity:0,observedAt:args.cutoff});
    if(Date.parse(intent.createdAt)>=Date.parse(opening)){expire('intent_not_recorded_before_open');continue;}
    const available=args.opens.filter(o=>o.symbol===intent.symbol&&o.session===intent.executeSession
      &&Date.parse(o.observedAt)<=Date.parse(args.cutoff)&&Date.parse(o.observedAt)>=Date.parse(opening));
    if(available.length!==1||!positive(available[0].open)){expire('opening_observation_missing_or_ambiguous');continue;}
    const open=available[0];const notional=intent.quantity*open.open,fee=notional*PAPER_FEE;
    if(intent.side==='buy'){
      if(intent.requiresExitSymbols?.some(symbol=>book.holdings.some(h=>h.symbol===symbol&&h.quantity>0))){expire('required_paper_exit_unfilled');continue;}
      const symbols=new Set(book.holdings.filter(h=>h.quantity>0).map(h=>h.symbol));
      if(!symbols.has(intent.symbol)&&symbols.size>=5){expire('paper_account_slot_limit');continue;}
      if(book.holdings.some(h=>h.symbol===intent.symbol&&h.strategyId!==PAPER_STRATEGY_ID)){expire('paper_other_strategy_ownership');continue;}
      if(intent.maxDebitUsd===null||notional+fee>intent.maxDebitUsd+1e-8||notional+fee>book.cashUsd+1e-8){expire('frozen_budget_or_settled_cash_exceeded');continue;}
      book.cashUsd-=notional+fee;
      const holding=book.holdings.find(h=>h.symbol===intent.symbol&&h.strategyId===PAPER_STRATEGY_ID);
      if(holding)holding.quantity+=intent.quantity;
      else book.holdings.push({symbol:intent.symbol,quantity:intent.quantity,strategyId:PAPER_STRATEGY_ID,positionId:intent.id});
    }else{
      const owned=book.holdings.filter(h=>h.symbol===intent.symbol&&h.strategyId===PAPER_STRATEGY_ID);
      if(owned.reduce((s,h)=>s+h.quantity,0)<intent.quantity){expire('paper_owned_quantity_insufficient');continue;}
      let remaining=intent.quantity;
      for(const holding of owned){const take=Math.min(remaining,holding.quantity);holding.quantity-=take;remaining-=take;}
      book.holdings=book.holdings.filter(h=>h.quantity>0);
      const settlesOn=args.settlementAfter(intent.executeSession);
      if(settlesOn<=intent.executeSession)throw Error('paper_settlement_calendar_invalid');
      book.receivables.push({usd:notional-fee,settlesOn});
    }
    outcomes.push({id:intent.id,status:'filled',reason:'modeled_open_not_broker_execution',quantity:intent.quantity,
      priceUsd:open.open,notionalUsd:notional,feeUsd:fee,observedAt:open.observedAt,
      ...(intent.side==='sell'?{settlementSession:book.receivables.at(-1)!.settlesOn}:{})});
  }
  return {book,outcomes};
}

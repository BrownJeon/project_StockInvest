/** Owner-only projection; never expose stored input, clone, or arbitrary JSON. */
export interface PaperViewCycle {
 id:string; session:string; decisionAt:string; mode:'rehearsal'|'forward'|'blocked'; sourceRunId:string|null; errorCode:string|null;
 collection:{referenceCount:number|null;qualifiedCount:number|null;cutoffAt:null;actualReceiptAt:string|null;provenanceStatus:'available'|'unknown';sources:{sourceId:string;kind:string;sourceVariant:string;observations:number;symbolCount:number;latestSession:string;firstReceiptAt:string;lastReceiptAt:string;lastAvailableAt:string;publicationAt:null}[];news:'unknown';disclosures:'unknown';issues:string[]};
 eligibility:{symbol:string;eligible:boolean;inFrozenCohort:boolean;issues:string[]}[];
 candidates:{symbol:string;status:string;momentum:number|null;rank:number|null;selected:boolean;reason:string}[];
 warnings:{symbol?:string;code:string}[];
 decisions:{symbol:string;action:string;reason:string;quantity:number|null}[];
 judgments:{stage:string;status:string;reason:string|null}[];
}
export interface PaperView {
 executionScope:'paper_only';liveTrading:false;
 account:{status:string;revision:number;registeredAt:string|null;cloneInvestmentUsd:number|null;currentEquityUsd:number|null};
 currentCycle:PaperViewCycle|null;lastUsableCycle:(PaperViewCycle&{stale:true})|null;
 signals:PaperViewSignal[];
 performance:{status:'not_started'|'insufficient_points'|'observed';points:{session:string;equityUsd:number}[];returnPct:number|null;maxDrawdownPct:number|null;cagrPct:number|null;realizedPnlUsd:null;unrealizedPnlUsd:null;truncated:boolean;gapLabel:string};
}

export interface PaperViewSignal {id:string;session:string;symbol:string;side:string;status:string;quantity:number|null;reason:string|null;executeSession:string|null;createdAt:string|null;mode:'rehearsal'|'forward'|'blocked'|'unknown';outcome:{reason:string|null;quantity:number|null;priceUsd:number|null;feeUsd:number|null;settlementSession:string|null;observedAt:string|null}|null}

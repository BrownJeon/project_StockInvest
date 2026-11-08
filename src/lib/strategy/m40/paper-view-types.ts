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
export interface PaperViewBase {
 executionScope:'paper_only';liveTrading:false;
 account:{status:string;revision:number;registeredAt:string|null;cloneInvestmentUsd:number|null;currentEquityUsd:number|null};
 currentCycle:PaperViewCycle|null;lastUsableCycle:(PaperViewCycle&{stale:true})|null;
 signals:PaperViewSignal[];
 performance:{status:'not_started'|'insufficient_points'|'observed';points:{session:string;equityUsd:number}[];returnPct:number|null;maxDrawdownPct:number|null;cagrPct:number|null;realizedPnlUsd:null;unrealizedPnlUsd:null;truncated:boolean;gapLabel:string};
}

export interface PaperViewSignal {id:string;session:string;symbol:string;side:string;status:string;quantity:number|null;reason:string|null;executeSession:string|null;createdAt:string|null;mode:'rehearsal'|'forward'|'blocked'|'unknown';outcome:{reason:string|null;quantity:number|null;priceUsd:number|null;feeUsd:number|null;settlementSession:string|null;observedAt:string|null}|null}

export type PaperViewPeriod = 'all'|'week'|'month';
export type PaperForecastHorizon = 'week'|'month'|'quarter'|'year';
export interface PaperViewQuery {period:PaperViewPeriod;anchorSession:string|null;signalPage:number;valuationPage:number;horizon:PaperForecastHorizon;snapshot:string|null;forecastPage?:number;comparisonPage?:number;forecastId?:string|null}
export interface PaperViewPage<T> {rows:T[];page:number;pageSize:10;totalCount:number;totalPages:number;hasNext:boolean;hasPrevious:boolean}
export interface PaperValuationPoint {id:string;session:string;observedAt:string|null;equityUsd:number|null}
export interface PaperObservation {
 period:PaperViewPeriod;startSession:string|null;endSession:string|null;asOfSession:string|null;
 baseline:{kind:'first_forward'|'prior_forward';point:PaperValuationPoint}|null;
 firstObserved:PaperValuationPoint|null;lastObserved:PaperValuationPoint|null;totalPoints:number;
 /** Expected sessions exclude dates before the first forward record; partial includes an account starting mid-period. */
 expectedSessions:number|null;observedSessions:number;missingSessions:number|null;partialPeriod:boolean;truncated:boolean;
 calendarStatus:'known'|'unknown';status:'not_started'|'unconfirmed'|'observed';
 returnPct:number|null;pnlUsd:number|null;maxDrawdownPct:number|null;cagrPct:number|null;issues:string[];
 scope:'account_including_existing_holdings';signalAttribution:'not_supported';
}
export interface PaperViewV6 {
 query:PaperViewQuery;
 snapshot:{token:string;asOf:string|null;accountRevision:number;cycleId:string|null};
 /** Bounds are forward-only; availablePeriods covers all saved cycle modes, including rehearsal. */
 history:{firstSession:string|null;lastSession:string|null;availablePeriods:{weeks:string[];months:string[]};periodsTruncated:boolean};
 signalPage:PaperViewPage<PaperViewSignal>;valuationPage:PaperViewPage<PaperValuationPoint>;observation:PaperObservation;
 forecasts:import('./forecast-view').ForecastView;
 policyRecord:{status:'available'|'unknown';runId:string|null;policyVersion:string|null;modelPolicyVersions:string[];promptVersion:null;agentTrading:'not_implemented'};
}

export interface PaperView extends PaperViewBase,PaperViewV6 {}

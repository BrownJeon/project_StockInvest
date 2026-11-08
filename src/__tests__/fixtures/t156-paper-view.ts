/** Synthetic UI fixture only. No operational account values or copied holdings. */
import type { PaperView,PaperViewCycle } from '@/lib/strategy/m40/paper-view-types';
export function syntheticPaperCycle():PaperViewCycle {return {
 id:'synthetic-cycle',session:'2026-11-06',decisionAt:'2026-11-07T01:00:00.000000Z',mode:'rehearsal',sourceRunId:'synthetic-run',errorCode:null,
 collection:{referenceCount:8,qualifiedCount:6,cutoffAt:null,actualReceiptAt:'2026-11-07T00:30:00.000000Z',provenanceStatus:'available',sources:[{sourceId:'synthetic_public_prices',kind:'raw_quote',sourceVariant:'raw',observations:8,symbolCount:8,latestSession:'2026-11-06',firstReceiptAt:'2026-11-07T00:00:00.000000Z',lastReceiptAt:'2026-11-07T00:30:00.000000Z',lastAvailableAt:'2026-11-07T00:30:00.000000Z',publicationAt:null}],news:'unknown',disclosures:'unknown',issues:[]},
 eligibility:[{symbol:'NAS:DEMOA',eligible:true,inFrozenCohort:true,issues:[]},{symbol:'NAS:DEMOB',eligible:false,inFrozenCohort:false,issues:['documented_initial_history_gap']}],
 warnings:[],
 candidates:[{symbol:'NAS:DEMOA',status:'ranked',momentum:.12,rank:1,selected:true,reason:'positive_126_session_momentum'},{symbol:'NAS:DEMOB',status:'ineligible',momentum:null,rank:null,selected:false,reason:'known_ineligible'}],decisions:[{symbol:'NAS:DEMOA',action:'hold',reason:'between_reviews',quantity:2}],
 judgments:['interpretation','observation','condition','priority'].map(stage=>({stage,status:'skipped',reason:'model_disabled_or_unversioned'}))
};}
export function syntheticPaperView():PaperView{return {executionScope:'paper_only',liveTrading:false,account:{status:'active',revision:2,registeredAt:'2026-11-07T00:00:00.000000Z',cloneInvestmentUsd:12000,currentEquityUsd:12096},currentCycle:syntheticPaperCycle(),lastUsableCycle:null,
 signals:[{id:'synthetic-signal',session:'2026-11-06',symbol:'NAS:DEMOA',side:'sell',status:'rehearsal',quantity:2,reason:'outside_top5',executeSession:'2026-11-09',createdAt:'2026-11-07T01:00:00.000000Z',mode:'rehearsal',outcome:null}],
 performance:{status:'not_started',points:[],returnPct:null,maxDrawdownPct:null,cagrPct:null,realizedPnlUsd:null,unrealizedPnlUsd:null,truncated:false,gapLabel:'observed_forward_points_only'}
};}

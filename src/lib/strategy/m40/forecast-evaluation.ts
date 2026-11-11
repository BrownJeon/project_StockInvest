/** Actual evidence must come from canonical paper cycles, never source forecast simulations. */
import { sameSourceRegime } from './forward-source-regime';
import type { ForecastEngineResult, ForecastHorizonResult } from './forecast-types';
import type { ForecastEvaluation } from './forecast-store';
export interface ForecastActualEvidence {
 sourceRegimeSha256?:string;asOfSession:string;accountId:string;policySha256:string;epochSession:string|null;
 baselineSha256:string|null;cashflowReconciled:boolean;shareBasisReconciled:boolean;
 feesReconciled:boolean;canonicalCoverage:boolean;endpointSession:string|null;equityUsd:number|null;
}
export function evaluateForecast(result:ForecastEngineResult,h:ForecastHorizonResult,actual:ForecastActualEvidence):ForecastEvaluation{
 const empty={actualPnlUsd:null,actualReturnPct:null};
 if(actual.asOfSession<h.targetSession)return {status:'pending',issues:['target_not_matured'],...empty};
 const mismatch:string[]=[];
 if((result.baseline.sourceRegimeSha256!==undefined||actual.sourceRegimeSha256!==undefined)&&!sameSourceRegime(result.baseline.sourceRegimeSha256,actual.sourceRegimeSha256))mismatch.push('source_regime_unreconciled');
 if(actual.accountId!==result.baseline.accountId)mismatch.push('account_changed');
 if(actual.policySha256!==result.policySha256)mismatch.push('policy_changed');
 if(actual.epochSession!==result.baseline.epochSession)mismatch.push('epoch_or_phase_changed');
 if(actual.baselineSha256!==result.baseline.bookSha256)mismatch.push('baseline_continuation_unanchored');
 if(!actual.cashflowReconciled)mismatch.push('cashflow_unreconciled');
 if(!actual.shareBasisReconciled)mismatch.push('share_basis_unreconciled');
 if(!actual.feesReconciled)mismatch.push('fees_unreconciled');
 if(mismatch.length)return {status:'incomparable',issues:mismatch,...empty};
 if(!actual.canonicalCoverage||actual.endpointSession!==h.targetSession||actual.equityUsd===null||!Number.isFinite(actual.equityUsd)||actual.equityUsd<=0)return {status:'unconfirmed',issues:['canonical_endpoint_or_coverage_missing'],...empty};
 const pnl=actual.equityUsd-result.baseline.equityUsd,pct=pnl/result.baseline.equityUsd*100;
 return {status:'completed',issues:[],actualPnlUsd:pnl,actualReturnPct:pct,errorPct:pct-h.netPct.mean,intervalHit:pct>=h.netPct.p10&&pct<=h.netPct.p90,brier:(h.lossProbability-(pnl<0?1:0))**2};
}

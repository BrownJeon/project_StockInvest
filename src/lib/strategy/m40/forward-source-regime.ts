/** Stable price-convention identity, separate from each day's immutable evidence hash. */
import { createHash } from 'node:crypto';
import type { ForwardSourceBundle } from './forward-sources';
export function forwardSourceRegime(bundle:ForwardSourceBundle):string {
 const records=bundle.records.filter(r=>!r.probe).map(r=>({symbol:r.symbol,basis:r.basis,providerContract:r.sourceId}));
 records.sort((a,b)=>(a.symbol+'|'+a.basis).localeCompare(b.symbol+'|'+b.basis,'en'));
 return createHash('sha256').update(JSON.stringify({version:1,stockPriceConventions:records})).digest('hex');
}
export function sameSourceRegime(baseline:string|undefined,actual:string|undefined):boolean {
 return typeof baseline==='string'&&/^[a-f0-9]{64}$/.test(baseline)&&baseline===actual;
}

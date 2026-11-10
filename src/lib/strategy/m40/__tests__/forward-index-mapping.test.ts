import { mapForwardSources,type ForwardSourceBundle } from '../forward-sources';
import { indexFixture } from './forward-index-fixtures';
import { validateKisIndexEnvelope,KIS_SP500_SOURCE_ID,KIS_SP500_SOURCE_URL,indexEvidenceSha } from '../forward-index-contract';
function fixture(){
 const f=indexFixture(),rawJson=JSON.stringify(f.envelope),checked=validateKisIndexEnvelope(rawJson,f.options);
 const bundle:ForwardSourceBundle={schemaVersion:1,asOfSession:f.end,observedAt:f.now,dateWindow:{start:f.start,end:f.end},records:[],failures:[],complete:false,sourceUse:'evaluation_only',
  market:{sourceId:KIS_SP500_SOURCE_ID,sourceUrl:KIS_SP500_SOURCE_URL,rawJson,...checked,basis:'index',series:'SP500',sourceUse:'evaluation_only',liveEligible:false}};
 return {f,bundle};
}
test('maps independently verified KIS SP500 index, with original envelope hash and receipt clocks',()=>{
 const {f,bundle}=fixture(),before=JSON.stringify(bundle);
 const result=mapForwardSources(bundle,f.calendar);
 expect(result.data.sp500Bars).toHaveLength(f.rows.length);
 expect(result.data.sp500Bars.at(-1)).toMatchObject({sourceVariant:'index',currency:'INDEX',qualification:'evaluation_only',sha256:bundle.market!.sha256,observedAt:f.now});
 expect(JSON.stringify(bundle)).toBe(before);
});
test('changing mapped rows, envelope identity, or live eligibility cannot bypass the source contract',()=>{
 const {f,bundle}=fixture();bundle.market!.rows[0].close='1';
 expect(()=>mapForwardSources(bundle,f.calendar)).toThrow('forward_source_rows_mismatch');
 const other=fixture();const envelope=JSON.parse(other.bundle.market!.rawJson!);envelope.pages[0].rawJson='{"rt_cd":"0","output1":{"stck_shrn_iscd":"SPY"}}';
 other.bundle.market!.rawJson=JSON.stringify(envelope);other.bundle.market!.sha256=indexEvidenceSha(other.bundle.market!.rawJson);
 expect(()=>mapForwardSources(other.bundle,other.f.calendar)).toThrow();
 const live=fixture();live.bundle.market!.liveEligible=true as never;
 expect(()=>mapForwardSources(live.bundle,live.f.calendar)).toThrow('forward_source_index_contract_invalid');
});

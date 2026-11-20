import {createHash} from 'node:crypto';
import {BRK_MASTER_SHA,BRK_PAIR_SOURCE_ID,BRK_PAIR_SYMBOL,brkAlpacaRequest,stockEvidenceSha,validateBrkPairEnvelope,type BrkPairEnvelope} from '../forward-stock-contract';
import {validateForwardBrkPair,mapForwardSources,validateForwardSources,type ForwardSourceBundle} from '../forward-sources';
import {brkFixture as fixture,installSyntheticMasterHash} from './forward-stock-fixtures';
installSyntheticMasterHash();
const check=(f:ReturnType<typeof fixture>)=>validateBrkPairEnvelope(JSON.stringify(f.envelope),f.options);
test('whole coherent pair validates exact consumed fields despite different reference volumes',()=>{const f=fixture(),r=check(f);expect(r.raw).toHaveLength(260);expect(r.split).toEqual(r.raw);});
for(const [name,change]of [
 ['wrong master',(e:BrkPairEnvelope)=>e.master.rawBase64=Buffer.from('wrong').toString('base64')],
 ['wrong symbol',(e:BrkPairEnvelope)=>(e as {symbol:string}).symbol='NAS:AAPL'],
 ['non USD',(e:BrkPairEnvelope)=>(e as {currency:string}).currency='KRW'],
 ['IEX',(e:BrkPairEnvelope)=>e.alpaca.raw[0].request.feed='iex'],
 ['dividend adjustment',(e:BrkPairEnvelope)=>e.alpaca.split[0].request.adjustment='all'],
 ['missing KIS proof',(e:BrkPairEnvelope)=>e.kis=[]],
 ['page token mismatch',(e:BrkPairEnvelope)=>e.alpaca.raw[0].requestTokenSha256='a'.repeat(64)],
 ['source hash change',(e:BrkPairEnvelope)=>e.alpaca.raw[0].sha256='b'.repeat(64)],
 ['future receipt',(e:BrkPairEnvelope)=>e.kis[0].observedAt='2030-01-01T00:00:00Z'],
]as const)test('rejects '+name,()=>{const f=fixture();change(f.envelope);expect(()=>check(f)).toThrow();});
test.each(['open','clos'])('KIS exact %s mismatch is rejected without tolerance',field=>{const f=fixture(),p=f.envelope.kis[0],body=JSON.parse(p.rawJson);body.output2[0][field]='100.00000000000001';p.rawJson=JSON.stringify(body);p.sha256=stockEvidenceSha(p.rawJson);expect(()=>check(f)).toThrow();});
test('future real split divergence requires reconciliation instead of factor guessing',()=>{const f=fixture(),p=f.envelope.alpaca.split[0],body=JSON.parse(p.rawJson);body.bars['BRK.B'][0].c=50;p.rawJson=JSON.stringify(body);p.sha256=stockEvidenceSha(p.rawJson);expect(()=>check(f)).toThrow();});
test('basis records must be paired and regenerated before either mapper or forecast use',()=>{const f=fixture(),r=check(f),rawJson=JSON.stringify(f.envelope);const records=(['raw','split_adjusted']as const).map(basis=>({symbol:BRK_PAIR_SYMBOL,vendorTicker:'BRK.B',basis,sourceId:BRK_PAIR_SOURCE_ID+'_'+basis,request:{provider:'alpaca_sip_brk_pair_v1'},sourceUrl:'https://data.alpaca.markets/v2/stocks/bars',rawJson,sha256:r.sha256,observedAt:r.observedAt,rows:r.raw,sourceUse:'evaluation_only' as const,liveEligible:false as const}));const bundle:ForwardSourceBundle={schemaVersion:1,asOfSession:f.options.end,observedAt:r.observedAt,dateWindow:{start:f.options.start,end:f.options.end},records,failures:[],complete:false,sourceUse:'evaluation_only'};expect(()=>validateForwardBrkPair(bundle,f.options.calendar,true)).not.toThrow();expect(mapForwardSources(bundle,f.options.calendar).data.members).toHaveLength(1);expect(()=>validateForwardBrkPair({...bundle,records:[records[0]]},f.options.calendar)).toThrow();records[1].rows=[...r.raw.slice(0,-1)];expect(()=>validateForwardBrkPair(bundle,f.options.calendar)).toThrow();});
test('nonmonotonic receipt sequence is invalid even if every timestamp is before final now',()=>{const f=fixture();f.envelope.alpaca.split[0].observedAt='2026-02-01T11:59:59.000Z';expect(()=>check(f)).toThrow();});
import {prepareForecastInput} from '../forecast-input';
import {forecastFixture} from './forecast-fixture';
test.each(['stock','index'])('ready A cannot authorize tampered actual B %s original',kind=>{const ready=forecastFixture(1,true);expect(prepareForecastInput(ready).status).toBe('qualified');const changed=structuredClone(ready);if(kind==='stock')changed.bundle.records[0].rawCsv='01/02/2025,1,1,1,1,1\n';else changed.bundle.market!.rawCsv='DATE,SP500\n2025-01-02,1\n';expect(prepareForecastInput(changed)).toMatchObject({status:'blocked',issues:['forward_source_hash_mismatch']});});
test.each(['stock','index'])('earlier ready status cannot admit actual B with valid BRK pair but corrupted %s original',kind=>{const f=fixture(),r=check(f),rawJson=JSON.stringify(f.envelope);const records=(['raw','split_adjusted']as const).map(basis=>({symbol:BRK_PAIR_SYMBOL,vendorTicker:'BRK.B',basis,sourceId:BRK_PAIR_SOURCE_ID+'_'+basis,request:{provider:'alpaca_sip_brk_pair_v1'},sourceUrl:'https://data.alpaca.markets/v2/stocks/bars',rawJson,sha256:r.sha256,observedAt:r.observedAt,rows:r.raw,sourceUse:'evaluation_only' as const,liveEligible:false as const}));const bundle:ForwardSourceBundle={schemaVersion:1,asOfSession:f.options.end,observedAt:r.observedAt,dateWindow:{start:f.options.start,end:f.options.end},records,failures:[],complete:true,sourceUse:'evaluation_only'};if(kind==='stock')bundle.records.push({symbol:'NAS:OTHER',vendorTicker:'OTHER',basis:'raw',sourceId:'kibot_guest_evaluation_raw_v1',request:{action:'history',symbol:'OTHER',interval:'daily',splitadjusted:'0',unadjusted:'1'},observedAt:r.observedAt,sha256:'a'.repeat(64),rows:r.raw,rawCsv:'01/02/2025,1,1,1,1,1\n'});else bundle.market={sourceId:'fred_sp500',sourceUrl:'https://fred.stlouisfed.org/graph/fredgraph.csv?id=SP500',observedAt:r.observedAt,sha256:'a'.repeat(64),rows:[],rawCsv:'DATE,SP500\n2025-01-02,1\n'};expect(()=>validateForwardBrkPair(bundle,f.options.calendar,true)).not.toThrow();expect(prepareForecastInput({accountId:'synthetic',accountRevision:1,sourceDatasetId:'actual-B',issuedAt:f.options.now,sourceAvailableAt:f.options.now,calendar:f.options.calendar,bundle} as never)).toMatchObject({status:'blocked',issues:['forward_source_hash_mismatch']});});
test('a later KIS page cannot carry an earlier receipt even with valid hashes and final clock',()=>{const f=fixture();f.envelope.kis[1].observedAt='2026-02-01T11:59:59.000Z';expect(()=>check(f)).toThrow();});
test('multi-page provider chain is regenerated with token hashes, never raw request token metadata',()=>{const f=fixture(),first=f.envelope.alpaca.raw[0],body=JSON.parse(first.rawJson),all=body.bars['BRK.B'],token='synthetic-page-token';const a=JSON.stringify({bars:{'BRK.B':all.slice(0,130)},next_page_token:token}),b=JSON.stringify({bars:{'BRK.B':all.slice(130)},next_page_token:null});f.envelope.alpaca.raw=[{...first,rawJson:a,sha256:stockEvidenceSha(a)},{...first,rawJson:b,sha256:stockEvidenceSha(b),requestTokenSha256:stockEvidenceSha(token)}];expect(check(f).raw).toHaveLength(260);expect(JSON.stringify(f.envelope.alpaca.raw.map(p=>p.request))).not.toContain(token);f.envelope.alpaca.raw[1].requestTokenSha256='f'.repeat(64);expect(()=>check(f)).toThrow();});
test('199 independent split-reference observations cannot qualify',()=>{const f=fixture(),ref=f.envelope.kibotSplit;ref.rows=ref.rows.slice(-199);ref.rawCsv=ref.rawCsv!.trim().split('\n').slice(-199).join('\n')+'\n';ref.sha256=stockEvidenceSha(ref.rawCsv);expect(()=>check(f)).toThrow();});
import {quarantineForwardBrkEvidence,mergeForwardSources} from '../forward-sources';
test('known event failure preserves originals as non-price evidence and no Kibot retry can revive the cached pair',()=>{const f=fixture(),before=JSON.stringify(f.envelope.kibotSplit),source:ForwardSourceBundle={schemaVersion:1,asOfSession:f.options.end,observedAt:f.options.now,dateWindow:f.envelope.dateWindow,records:[f.envelope.kibotSplit],failures:[],complete:false,sourceUse:'evaluation_only'};const raw='{"corporate_actions":{"forward_splits":[{"symbol":"BRK.B"}]},"next_page_token":null}',blocked=quarantineForwardBrkEvidence(source,f.envelope.kibotSplit,'forward_pair_events_known_or_unclassified_action_requires_reconciliation',raw,f.options.now);expect(blocked.records).toHaveLength(0);expect(blocked.nonPriceEvidence?.quarantine?.rawJson).toBe(raw);expect(blocked.nonPriceEvidence?.quarantine?.sha256).toBe(stockEvidenceSha(raw));expect(JSON.stringify(source.records[0])).toBe(before);expect(blocked.nonPriceEvidence?.brkContinuityReference).toEqual(source.records[0]);const retry=mergeForwardSources(blocked,source,['NYS:BRK.B']);expect(()=>mapForwardSources(retry,f.options.calendar,f.options.now)).toThrow('forward_pair_quarantined_evidence');});
test('unchanged price session cannot reuse previous NY-day event evidence through mapper or forecast preparation',()=>{const f=fixture(),r=check(f),rawJson=JSON.stringify(f.envelope),records=(['raw','split_adjusted']as const).map(basis=>({symbol:BRK_PAIR_SYMBOL,vendorTicker:'BRK.B',basis,sourceId:BRK_PAIR_SOURCE_ID+'_'+basis,request:{provider:'alpaca_sip_brk_pair_v1'},sourceUrl:'https://data.alpaca.markets/v2/stocks/bars',rawJson,sha256:r.sha256,observedAt:r.observedAt,rows:r.raw,sourceUse:'evaluation_only' as const,liveEligible:false as const}));const b:ForwardSourceBundle={schemaVersion:1,asOfSession:f.options.end,observedAt:r.observedAt,dateWindow:f.envelope.dateWindow,records,failures:[],complete:true,sourceUse:'evaluation_only'};expect(validateForwardSources(b,f.options.calendar,f.options.now)).toEqual(mapForwardSources(b,f.options.calendar,f.options.now).data.sp500Bars);expect(()=>validateForwardSources(b,f.options.calendar,'2026-11-21T06:00:00Z')).toThrow('clock_invalid');expect(()=>mapForwardSources(b,f.options.calendar,'2026-11-21T06:00:00Z')).toThrow('clock_invalid');expect(prepareForecastInput({accountId:'synthetic',accountRevision:1,sourceDatasetId:'same-price-session',sourceAvailableAt:r.observedAt,issuedAt:'2026-11-21T06:00:00Z',calendar:f.options.calendar,bundle:b} as never)).toMatchObject({status:'blocked',issues:['forward_pair_events_clock_invalid']});});
import {brkQuarantineRequiresReview} from '../forward-sources';
test('known-action/unreviewed-material quarantine cannot be silently cleared by an empty retry, while transport failure remains retryable',()=>{const f=fixture(),source:ForwardSourceBundle={schemaVersion:1,asOfSession:f.options.end,observedAt:f.options.now,dateWindow:f.envelope.dateWindow,records:[],failures:[],complete:false,sourceUse:'evaluation_only'};for(const reason of ['forward_pair_events_known_or_unclassified_action_requires_reconciliation','forward_pair_events_unreviewed_material_filing'])expect(brkQuarantineRequiresReview(quarantineForwardBrkEvidence(source,f.envelope.kibotSplit,reason,'{}',f.options.now))).toBe(true);expect(brkQuarantineRequiresReview(quarantineForwardBrkEvidence(source,f.envelope.kibotSplit,'forward_pair_transport_failed','{}',f.options.now))).toBe(false);});
test('a durable pending attempt remains blocking if completion/quarantine writes fail or the worker expires',()=>{const f=fixture(),source:ForwardSourceBundle={schemaVersion:1,asOfSession:f.options.end,observedAt:f.options.now,dateWindow:f.envelope.dateWindow,records:[f.envelope.kibotSplit],failures:[],complete:false,sourceUse:'evaluation_only'};const pending=quarantineForwardBrkEvidence(source,f.envelope.kibotSplit,'forward_pair_source_verification_pending','{"phase":"before_new_provider_requests","proofsIncomplete":true}',f.options.now);expect(brkQuarantineRequiresReview(pending)).toBe(true);expect(()=>mapForwardSources(pending,f.options.calendar)).toThrow('quarantined_evidence');expect(source.records).toHaveLength(1);});
test('repeated full-series validation uses a bounded number of ICU formatters, not one per bar',()=>{const f=fixture();const before=JSON.stringify(f.envelope);const formatter=jest.spyOn(Intl,'DateTimeFormat');try{for(let i=0;i<3;i++)expect(check(f).raw).toHaveLength(260);expect(formatter.mock.calls.length).toBeLessThanOrEqual(9);expect(JSON.stringify(f.envelope)).toBe(before);}finally{formatter.mockRestore();}});

/** Only a test master is hash-substituted; all provider originals still use real SHA-256. */
function useSyntheticMaster(f:ReturnType<typeof fixture>,bytes:Buffer){
 // Replace the fixture's existing spy before capturing the genuine implementation.
 jest.spyOn(require('node:crypto'),'createHash').mockRestore();
 const real=jest.requireActual<typeof import('node:crypto')>('node:crypto').createHash;
 jest.spyOn(require('node:crypto'),'createHash').mockImplementation((...args:Parameters<typeof createHash>)=>{
  const h=real(...args),update=h.update.bind(h);
  h.update=((data:unknown,...rest:unknown[])=>{if(Buffer.isBuffer(data)&&data.equals(bytes)){h.digest=(()=>BRK_MASTER_SHA) as typeof h.digest;return h;}return update(data as string,...rest as []);}) as typeof h.update;
  return h;
 });
 f.envelope.master.rawBase64=bytes.toString('base64');
}
const masterCases:[string,(row:string)=>Buffer,boolean][]=[
 ['CRLF and blank rows',row=>Buffer.from('\r\n\r\n'+row+'\r\n\r\n'),true],
 ['no final newline',row=>Buffer.from(row),true],
 ['unrelated short rows and symbols',row=>Buffer.from('BRK/B\nA\tB\tBRK/B\nA\tB\tC\tD\tOTHER\tBRK/B\n'+row+'\n'),true],
 ['trimmed fifth and checked fields',row=>Buffer.from(row.split('\t').map(v=>' '+v+' ').join('\t')+'\n'),true],
 ['EUC-KR ideographic whitespace',row=>{const cells=row.split('\t');return Buffer.concat([Buffer.from(cells.slice(0,4).join('\t')+'\t'),Buffer.from([0xa1,0xa1]),Buffer.from('BRK/B'),Buffer.from([0xa1,0xa1]),Buffer.from('\t'+cells.slice(5).join('\t'))]);},true],
 ['duplicate after unrelated rows',row=>Buffer.from(row+'\nOTHER\n'+row+'\n'),false],
 ['short matching row is still a duplicate',row=>Buffer.from(row+'\nA\tB\tC\tD\t BRK/B \n'),false],
 ['only a short matching row',()=>Buffer.from('A\tB\tC\tD\tBRK/B'),false],
 ['23-column matching row',row=>Buffer.from(row.split('\t').slice(0,23).join('\t')),false],
 ['25-column matching row',row=>Buffer.from(row+'\t'),false],
 ['lone CR does not split rows',row=>Buffer.from(row+'\r'+row),false],
];
test.each(masterCases)('master admission preserves %s semantics',(_name,make,accepted)=>{
 const f=fixture();
 // Preserve trailing empty columns: remove the fixture newline, not its tabs.
 const completeRow=Buffer.from(f.envelope.master.rawBase64,'base64').toString('ascii').replace(/\n$/,'');
 const bytes=make(completeRow);
 const legacyMatches=new TextDecoder('euc-kr',{fatal:true}).decode(bytes).split(/\r?\n/).filter(Boolean).map(line=>line.split('\t').map(v=>v.trim())).filter(c=>c[4]==='BRK/B');
 const legacyAccepted=legacyMatches.length===1&&legacyMatches[0].length===24&&legacyMatches[0][2]==='NYS'&&legacyMatches[0][5]==='NYSBRK/B'&&legacyMatches[0][7]==='BERKSHIRE HATHAWAY INC'&&legacyMatches[0][8]==='2'&&legacyMatches[0][17]==='N'&&legacyMatches[0][22]==='';
 expect(legacyAccepted).toBe(accepted);useSyntheticMaster(f,bytes);
 if(accepted)expect(check(f).raw).toHaveLength(260);else expect(()=>check(f)).toThrow('forward_pair_contract_invalid');
});
test('a matching test master hash cannot bypass fatal EUC-KR decoding',()=>{
 const f=fixture(),bytes=Buffer.from([0xa1]);useSyntheticMaster(f,bytes);
 expect(()=>check(f)).toThrow();
});
test('each validation decodes one master buffer and still verifies its pinned hash',()=>{
 const f=fixture(),encoded=f.envelope.master.rawBase64,before=JSON.stringify(f.envelope),from=jest.spyOn(Buffer,'from');
 try{expect(check(f).raw).toHaveLength(260);expect(from.mock.calls.filter(args=>args[0]===encoded&&args[1]==='base64')).toHaveLength(1);expect(JSON.stringify(f.envelope)).toBe(before);}finally{from.mockRestore();}
 f.envelope.master.sha256='0'.repeat(64);expect(()=>check(f)).toThrow('forward_pair_contract_invalid');
});

// ---- T-180: a list update invalidates envelopes sealed under the previous list; no compatibility path (Leader decision ④, C1 ①: deploy outside the window). ----
import {brkMaterialReviewV1,BRK_MATERIAL_REVIEW_V1_SHA} from './forward-stock-fixtures';
import {brkMaterialReviewSha} from '../forward-stock-events';
import type {ForwardCalendarSession} from '../forward-types';
test('T-180 an envelope sealed with the v1 review list is rejected under v2, directly and through the cached-bundle pair check',()=>{
 expect(BRK_MATERIAL_REVIEW_V1_SHA).not.toBe(brkMaterialReviewSha());
 const current=fixture(),ok=check(current),calendar=(f:ReturnType<typeof fixture>)=>f.options.calendar as readonly ForwardCalendarSession[];
 const pair=(f:ReturnType<typeof fixture>):ForwardSourceBundle=>{const rawJson=JSON.stringify(f.envelope);return {schemaVersion:1,asOfSession:f.options.end,observedAt:ok.observedAt,dateWindow:{start:f.options.start,end:f.options.end},records:(['raw','split_adjusted']as const).map(basis=>({symbol:BRK_PAIR_SYMBOL,vendorTicker:'BRK.B',basis,sourceId:BRK_PAIR_SOURCE_ID+'_'+basis,request:{provider:'alpaca_sip_brk_pair_v1'},sourceUrl:'https://data.alpaca.markets/v2/stocks/bars',rawJson,sha256:stockEvidenceSha(rawJson),observedAt:ok.observedAt,rows:basis==='raw'?ok.raw:ok.split,sourceUse:'evaluation_only' as const,liveEligible:false as const})),failures:[],complete:true,sourceUse:'evaluation_only'};};
 expect(()=>validateForwardBrkPair(pair(current),calendar(current),true)).not.toThrow();
 for(const [manifest,hash] of [[true,true],[true,false],[false,true]] as const){
  const f=fixture();if(manifest)f.envelope.events.reviewManifest=brkMaterialReviewV1() as never;if(hash)f.envelope.events.reviewManifestSha256=BRK_MATERIAL_REVIEW_V1_SHA;
  expect(()=>check(f)).toThrow('forward_pair_contract_invalid');expect(()=>validateForwardBrkPair(pair(f),calendar(f),true)).toThrow('forward_pair_contract_invalid');
 }
});

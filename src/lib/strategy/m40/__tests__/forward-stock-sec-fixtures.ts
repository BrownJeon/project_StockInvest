/**
 * T-178: Berkshire SEC submissions `filings.recent` metadata exactly as archived by the blocked 2026-11-18 (ET) paper cycle.
 * Source (read-only, 2026-11-20): t156_dataset `paper-src-5a0cd93935e4a91a092b826fa289aa35c5b88fc21cf2071a` → blob
 * e829de620db0480be6fc5edef0ea206b2359874ca89c74028b0ab9689a01eea4 → nonPriceEvidence.quarantine.rawJson → events.sec.rawJson.
 * Only the six fields the validator reads, only rows with filingDate >= 2026-10-20 (18 of 1016). The SEC original is not stored here.
 */
import {stockEvidenceSha,type BrkEvidencePage} from '../forward-stock-contract';
export interface BrkSecRow {accessionNumber:unknown;filingDate:unknown;acceptanceDateTime:unknown;form:unknown;primaryDocument:unknown;items:unknown}
export const BRK_SEC_IDENTITY=Object.freeze({cik:'0001067983',name:'BERKSHIRE HATHAWAY INC',tickers:['BRK-B','BRK-A'],exchanges:['NYSE','NYSE']});
/** Archived clock: query (NY) day, close of the processed session 2026-11-18, SEC receipt and quarantine time. Window starts 2026-11-05. */
export const BRK_SEC_REAL_CLOCK=Object.freeze({queryDate:'2026-11-19',asOfClose:'2026-11-18T21:00:00Z',observedAt:'2026-11-19T11:50:44.903Z',now:'2026-11-19T11:50:44.941Z',windowStart:'2026-11-05'});
const row=(accessionNumber:string,filingDate:string,acceptanceDateTime:string,form:string,primaryDocument:string,items:string):BrkSecRow=>Object.freeze({accessionNumber,filingDate,acceptanceDateTime,form,primaryDocument,items});
export const BRK_SEC_REAL_ROWS_20261119:readonly BrkSecRow[]=Object.freeze([
 row('0001193125-26-465884','2026-11-17','2026-11-18T00:23:48.000Z','SCHEDULE 13D/A','xslSCHEDULE_13D_X02/primary_doc.xml',''),
 row('0001193125-26-465872','2026-11-17','2026-11-18T00:18:44.000Z','4','xslF345X06/ownership.xml',''),
 row('0001193125-26-465047','2026-11-17','2026-11-17T16:32:44.000Z','424B5','d86634d424b5.htm',''),
 row('0001193125-26-464219','2026-11-16','2026-11-17T01:57:17.000Z','SCHEDULE 13G/A','xslSCHEDULE_13G_X02/primary_doc.xml',''),
 row('0001193125-26-464218','2026-11-16','2026-11-17T01:57:12.000Z','SCHEDULE 13G','xslSCHEDULE_13G_X02/primary_doc.xml',''),
 row('0001193125-26-464214','2026-11-16','2026-11-17T01:52:46.000Z','SCHEDULE 13G/A','xslSCHEDULE_13G_X02/primary_doc.xml',''),
 row('0001193125-26-464211','2026-11-16','2026-11-17T01:50:03.000Z','SCHEDULE 13G/A','xslSCHEDULE_13G_X02/primary_doc.xml',''),
 row('0001193125-26-464189','2026-11-16','2026-11-17T01:19:40.000Z','SCHEDULE 13G/A','xslSCHEDULE_13G_X02/primary_doc.xml',''),
 row('0001193125-26-464003','2026-11-16','2026-11-16T23:10:11.000Z','4','xslF345X06/ownership.xml',''),
 row('0001193125-26-463989','2026-11-16','2026-11-16T23:01:19.000Z','4','xslF345X06/ownership.xml',''),
 row('0001193125-26-463399','2026-11-16','2026-11-16T21:00:04.000Z','13F-HR','xslForm13F_X02/primary_doc.xml',''),
 row('0001193125-26-459815','2026-11-13','2026-11-13T16:57:39.000Z','FWP','d127427dfwp.htm',''),
 row('0001193125-26-452592','2026-11-09','2026-11-09T11:40:01.000Z','424B5','d86634d424b5.htm',''),
 row('0001193125-26-452530','2026-11-09','2026-11-09T11:10:14.000Z','8-K','brka-20261107.htm','2.02,9.01'),
 row('0001193125-26-452412','2026-11-09','2026-11-09T11:01:15.000Z','10-Q','brka-20260930.htm',''),
 row('0001193125-26-445930','2026-11-03','2026-11-04T02:30:04.000Z','4','xslF345X06/ownership.xml',''),
 row('0001193125-26-438090','2026-10-29','2026-10-29T21:21:38.000Z','4','xslF345X06/ownership.xml',''),
 row('0001728451-26-000005','2026-10-23','2026-10-23T20:38:16.000Z','4','xslF345X06/primary_doc.xml',''),
]);
/** Column-oriented SEC `submissions` page around the given rows (synthetic wrapper, real field layout). */
export function brkSecPage(rows:readonly BrkSecRow[],observedAt:string=BRK_SEC_REAL_CLOCK.observedAt):BrkEvidencePage{
 const keys=['accessionNumber','filingDate','acceptanceDateTime','form','primaryDocument','items'] as const;
 const rawJson=JSON.stringify({...BRK_SEC_IDENTITY,filings:{recent:Object.fromEntries(keys.map(k=>[k,rows.map(r=>r[k])]))}});
 return {request:{},http:200,observedAt,rawJson,sha256:stockEvidenceSha(rawJson)};
}

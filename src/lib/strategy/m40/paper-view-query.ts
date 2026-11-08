import {validForwardSessionDate} from './forward-calendar';
import type {PaperViewQuery,PaperViewPage} from './paper-view-types';
export const PAPER_VIEW_PAGE_SIZE=10 as const;
const page=(raw:string|null):number=>{if(raw===null)return 1;if(!/^[1-9]\d{0,5}$/.test(raw))throw Error('paper_page_invalid');return Number(raw);};
/** Strict query contract: a changed period starts a new snapshot at page one. */
export function parsePaperViewQuery(params:URLSearchParams):PaperViewQuery {
 const allowed=new Set(['period','anchorSession','signalPage','valuationPage','horizon','snapshot','limit','forecastPage','comparisonPage','forecastId']);
 for(const key of params.keys())if(!allowed.has(key)||params.getAll(key).length!==1)throw Error('paper_query_invalid');
 const period=params.get('period')??'all',horizon=params.get('horizon')??'week',anchorSession=params.get('anchorSession'),snapshot=params.get('snapshot');
 if(!['all','week','month'].includes(period)||!['week','month','quarter','year'].includes(horizon))throw Error('paper_query_invalid');
 if(period==='all'?anchorSession!==null:(!validForwardSessionDate(anchorSession)||anchorSession<'1900-01-01'||anchorSession>'2100-12-31'))throw Error('paper_anchor_invalid');
 if(snapshot!==null&&(!/^[A-Za-z0-9_-]{1,1200}$/.test(snapshot)))throw Error('paper_snapshot_invalid');
 const forecastId=params.get('forecastId');if(forecastId!==null&&!/^[a-f0-9]{64}$/.test(forecastId))throw Error('paper_forecast_id_invalid');
 const limit=params.get('limit');if(limit!==null&&limit!=='10')throw Error('paper_page_size_must_be_10');
 return {period:period as PaperViewQuery['period'],anchorSession,signalPage:page(params.get('signalPage')),valuationPage:page(params.get('valuationPage')),horizon:horizon as PaperViewQuery['horizon'],snapshot,forecastPage:page(params.get('forecastPage')),comparisonPage:page(params.get('comparisonPage')),forecastId};
}
export const defaultPaperViewQuery=():PaperViewQuery=>parsePaperViewQuery(new URLSearchParams());
export function paperPage<T>(rows:T[],requested:number,totalCount:number):PaperViewPage<T>{const totalPages=Math.max(1,Math.ceil(totalCount/10)),p=Math.min(requested,totalPages);return {rows,page:p,pageSize:PAPER_VIEW_PAGE_SIZE,totalCount,totalPages,hasNext:p<totalPages,hasPrevious:p>1};}

import * as ReactNS from 'react';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { M40PaperView,M40_POLL_OPTIONS,M40_PAPER_URL,type PaperArea,type PaperPerformanceView } from '@/app/analytics/M40PaperPanel';
import { applyOutcome,readEnvelope,type PollState } from '@/components/ops/useOpsPoll';
import type { PaperView } from '@/lib/strategy/m40/paper-view-types';
import { syntheticPaperView } from './fixtures/t156-paper-view';
import { paperJudgmentRows,paperReason } from '@/app/analytics/m40-paper-copy';
import { PAPER_INITIAL_QUERY,paperLocalPage,paperNextQuery,paperQueryUrl,paperTabIndex,isPaperViewV6,paperSafePoll,paperCalendarSpan,paperQueryAfterAuthError } from '@/app/analytics/m40-paper-ui';
import { resolveAnalyticsRoute,analyticsQuery,ANALYTICS_SEGMENTS,ANALYTICS_DETAILS } from '@/app/analytics/route-resolve';
(globalThis as unknown as { React:typeof ReactNS }).React=ReactNS;
const state=(data:PaperView):PollState<PaperView>=>({status:'ok',data,lastOkAt:1,error:null});
const render=(poll:PollState<PaperView>,initialArea:PaperArea='collection',initialPerformanceView:PaperPerformanceView='observed')=>renderToStaticMarkup(h(M40PaperView,{poll,onRefresh:()=>{},initialArea,initialPerformanceView}));
describe('T-156 approved v6 saved-data screen',()=>{
 test('detail name changes while route and existing three segments remain',()=>{
 expect(ANALYTICS_DETAILS.m40.title).toBe('모의분석');expect(resolveAnalyticsRoute('m40')).toEqual({kind:'detail',seg:'today',detail:'m40'});expect(analyticsQuery({seg:'today',detail:'m40'})).toBe('?tab=m40');expect(ANALYTICS_SEGMENTS.map(s=>s.id)).toEqual(['today','verify','data']);expect(resolveAnalyticsRoute('orders')).toEqual({kind:'redirect',href:'/recommend?tab=log&detail=orders'});
 });
 test.each(['collection','judgments','signals','performance'] as const)('only active %s panel renders; four accessible tabs remain',area=>{
 const html=render(state(syntheticPaperView()),area);
 expect((html.match(/role="tab"/g)||[]).length).toBe(4);expect((html.match(/role="tabpanel"/g)||[]).length).toBe(1);expect((html.match(/aria-selected="true"/g)||[]).length).toBe(1);expect(html).toContain(`aria-labelledby="m40-tab-${area}"`);
 for(const label of ['수집상태','종목판단','모의시그널','모의성과'])expect(html).toContain(label);
 expect(html).toContain('에이전트 참고 전용');expect(html).toContain('거래 반영 미구현');expect(html).not.toContain('승인하기');
 });
 test('judgments distinguish selection from trading and explicit recorded skip from unknown calls',()=>{
 const html=render(state(syntheticPaperView()),'judgments');expect(html).toContain('모의 유지');expect(html).toContain('판단 모델 꺼짐 또는 정책 버전 미등록 · 모델 미호출');expect(html).toContain('모델 호출 누락은 미확인');
 });
 test('signals retain rehearsal and outcome limitations with visible per-side cost',()=>{
 const html=render(state(syntheticPaperView()),'signals');expect(html).toContain('리허설 기록 · 미체결');expect(html).toContain('개별 시그널 손익 집계 연결 전');expect(html).toContain('매수 0.25% · 매도 0.25%');
 });
 test.each([401,403,503])('HTTP %s discards private policy, source, signal and account values in every panel',status=>{
 const prev=state(syntheticPaperView());const next=applyOutcome(prev,readEnvelope<PaperView>(status,{ok:false}),2,M40_POLL_OPTIONS.keepLastOnError);
 expect(next.data).toBeNull();
 for(const area of ['collection','judgments','signals','performance'] as const)for(const view of ['observed','forecast','comparison'] as const){
  const html=render({...next,data:prev.data},area,view);for(const privateValue of ['NAS:DEMOA','12,096','synthetic_public_prices','synthetic-run','저장된 예측 없음'])expect(html).not.toContain(privateValue);
  expect(html).toContain(status===403?'조회 권한이 없습니다':status===401?'로그인이 필요합니다':'조회하지 못했습니다');
 }
 });
 test('blocked current dates previous saved collection explicitly',()=>{
 const d=syntheticPaperView();d.lastUsableCycle={...d.currentCycle!,stale:true};d.currentCycle={...d.currentCycle!,id:'blocked',session:'2026-11-09',mode:'blocked',errorCode:'forward_cycle_failed',collection:{...d.currentCycle!.collection,sources:[]},candidates:[],decisions:[],judgments:[],eligibility:[]};
 const html=render(state(d));expect(html).toContain('최신 회차 처리 차단');expect(html).toContain('2026-11-09');expect(html).toContain('이전 저장분');expect(html).toContain('2026-11-06');expect(html).toContain('synthetic_public_prices');
 });
 test('saved local rows are filtered before paging; selection is not a buy',()=>{
 const c=syntheticPaperView().currentCycle;expect(paperJudgmentRows(c,'demoa','selected')[0].decision?.action).toBe('hold');expect(paperJudgmentRows(c,'','excluded').map(r=>r.symbol)).toEqual(['NAS:DEMOB']);expect(paperJudgmentRows(c,'absent')).toEqual([]);expect(paperReason('unregistered_new_reason')).toContain('설명 미등록');
 });
 test('loading and missing records do not invent balances or zero profits',()=>{
 expect(render({status:'loading',data:null,error:null,lastOkAt:null})).toContain('불러오는 중');const d=syntheticPaperView();d.currentCycle=null;d.account.cloneInvestmentUsd=null;d.account.currentEquityUsd=null;
 expect(render(state(d))).toContain('아직 저장된 분석 회차가 없습니다');const html=render(state(d),'performance');expect(html).toContain('선택기간 관측 없음 · 전진 시작 기록 미확인');expect(html).toContain('기준평가 없음');expect(html).not.toContain('USD 0');expect(html).not.toContain('0.00%');expect(M40_PAPER_URL).toBe('/api/research/t156/paper');
 });
 test('selected without buy shows recorded cash constraint',()=>{
 const d=syntheticPaperView();d.currentCycle!.decisions=[];d.currentCycle!.warnings=[{symbol:'NAS:DEMOA',code:'insufficient_settled_cash'}];
 const html=render(state(d),'judgments');expect(html).toContain('선정됐지만 저장된 매매 의도 없음');expect(html).toContain('결제된 모의현금·수수료 포함 예산으로 1주 매수 불가');expect(html).not.toContain('상세 제약 사유는 제공 자료에서 미확인');
 });
 test('forecast permits four horizons but has no fabricated dates, numbers, baseline or paths',()=>{
 const html=render(state(syntheticPaperView()),'performance','forecast');for(const label of ['향후 1주','향후 1개월','향후 3개월','향후 1년','저장된 예측 없음','미보정 연구 시나리오','확률과 예상손익 미확인'])expect(html).toContain(label);
 for(const fabricated of ['12,343','40%','P10','DEMO-F','USD 12,000','목표일 2026'])expect(html).not.toContain(fabricated);
 const comparison=render(state(syntheticPaperView()),'performance','comparison');expect(comparison).toContain('저장된 예측 사후비교 없음');expect(comparison).toContain('정확도 미확인');expect(comparison).not.toContain('0.00%');
 });
 test('a completed month with a mid-period account start is partial without claiming the month is ongoing',()=>{
 const d=syntheticPaperView();d.history={...d.history,firstSession:'2026-10-15',lastSession:'2026-11-06'};
 d.observation={...d.observation,period:'month',startSession:'2026-10-01',endSession:'2026-10-31',asOfSession:'2026-11-06',partialPeriod:true,status:'unconfirmed',issues:['account_started_during_period']};
 const html=render(state(d),'performance');expect(html).toContain('모의투자 시작 이후만 관측한 부분기간');expect(html).toContain('시작 전 세션은 관측 대상에서 제외');expect(html).toContain('시작 이후 세션만 관측 대상');expect(html).not.toContain('진행 중');expect(html).not.toContain('0.00%');
 });
 test('a period before the account start has no selected observations without claiming the account never started',()=>{
 const d=syntheticPaperView();d.history={...d.history,firstSession:'2026-10-15',lastSession:'2026-11-06'};
 d.observation={...d.observation,period:'month',startSession:'2026-09-01',endSession:'2026-09-30',asOfSession:'2026-11-06',expectedSessions:0,observedSessions:0,missingSessions:0,status:'not_started',issues:['before_account_start']};
 const html=render(state(d),'performance');expect(html).toContain('선택기간 관측 없음 · 모의투자 시작 전');expect(html).toContain('계좌 전진 관측 전체 2026-10-15–2026-11-06');expect(html).toContain('예상 0 / 관측 0 / 누락 0거래일');expect(html).not.toContain('전진 시작 기록 미확인');expect(html).not.toContain('진행 중');expect(html).not.toContain('0.00%');expect(paperReason('account_start_unknown')).toContain('예상·누락 거래일을 확정하지 않음');
 });
 test('a known forward history with no selected-range observations does not claim the global start is unknown',()=>{
 const d=syntheticPaperView();d.history={...d.history,firstSession:'2026-10-15',lastSession:'2026-11-06'};
 d.observation={...d.observation,period:'week',startSession:'2026-10-19',endSession:'2026-10-25',asOfSession:'2026-11-06',status:'not_started',issues:[]};
 const html=render(state(d),'performance');expect(html).toContain('선택기간 관측 없음');expect(html).not.toContain('전진 시작 기록 미확인');expect(html).not.toContain('선택기간 관측 없음 · 모의투자 시작 전');
 });
 test('current month shows its full calendar duration but elapsed days only through the confirmed as-of session',()=>{
 const d=syntheticPaperView();d.observation={...d.observation,period:'month',startSession:'2026-11-01',endSession:'2026-11-30',asOfSession:'2026-11-06',partialPeriod:true,issues:['account_started_during_period']};
 const html=render(state(d),'performance');expect(html).toContain('1개월 (달력 30일) · 기준일까지 경과 6일');expect(html).toContain('진행 중 부분기간');expect(html).toContain('평가 관측일·거래일 수와 다릅니다');expect(html).toContain('모의투자 시작 전 제외·시작 이후 관측 범위와도 구별');
 });
 test('paper scope does not claim the global live-trading switch is OFF',()=>{
 const html=render(state(syntheticPaperView()));expect(html).not.toContain('실거래 OFF');expect(html).toContain('이 화면은 전역 실거래 설정을 변경하지 않습니다');
 });
 test('successful envelopes with legacy, empty or malformed v6 DTOs fail closed without throwing',()=>{
 const valid=syntheticPaperView();expect(isPaperViewV6(valid)).toBe(true);
 const legacy={...valid} as Partial<PaperView>;delete legacy.snapshot;
 const invalid:unknown[]=[{},null,legacy,{...valid,signalPage:{rows:[]}},{...valid,policyRecord:{...valid.policyRecord,modelPolicyVersions:null}},{...valid,currentCycle:{...valid.currentCycle,collection:{sources:null}}}];
 for(const data of invalid){
  const raw=applyOutcome<unknown>({status:'loading',data:null,error:null,lastOkAt:null},readEnvelope<unknown>(200,{ok:true,data}),1,false);
  expect(raw.status).toBe('ok');const guarded=paperSafePoll(raw);expect(guarded).toEqual({status:'error',data:null,error:'bad_paper_view',lastOkAt:1});
  for(const area of ['collection','judgments','signals','performance'] as const){const html=render(raw as PollState<PaperView>,area);expect(html).toContain('조회하지 못했습니다');expect(html).toContain('다시 조회');expect(html).not.toContain('NAS:DEMOA');expect(html).not.toContain('synthetic_public_prices');}
 }
 });
 test('full-range observation metrics do not use the current evaluation page or clone investment',()=>{
 const d=syntheticPaperView();d.history={...d.history,firstSession:'2026-10-01',lastSession:'2026-11-06'};d.observation={...d.observation,firstObserved:{id:'synthetic-baseline',session:'2026-10-01',equityUsd:10000,observedAt:null},lastObserved:{id:'synthetic-last',session:'2026-11-06',equityUsd:10250,observedAt:null},status:'observed',returnPct:2.5,pnlUsd:250,maxDrawdownPct:-1,totalPoints:23,baseline:{kind:'first_forward',point:{id:'synthetic-baseline',session:'2026-10-01',equityUsd:10000,observedAt:null}},calendarStatus:'known',expectedSessions:23,observedSessions:23,missingSessions:0};d.valuationPage={...d.valuationPage,totalCount:23,totalPages:3,hasNext:true,rows:[{id:'synthetic-point',session:'2026-11-06',equityUsd:10250,observedAt:null}]};
 const html=render(state(d),'performance');expect(html).toContain('+2.50%');expect(html).toContain('USD 250');expect(html).toContain('전체 23점');expect(html).toContain('1–10 / 23개');expect(html).toContain('USD 10,000');expect(html).not.toContain('수익률 기준: 미확인 · 기준평가 없음');
 });
});
describe('T-156 query and page transitions',()=>{
 test.each([0,1,10,11,23])('local %s rows clamp independently at ten',count=>{
  const rows=Array.from({length:count},(_,i)=>i),first=paperLocalPage(rows,1),last=paperLocalPage(rows,999);expect(first.rows.length).toBe(Math.min(count,10));expect(first.totalCount).toBe(count);expect(last.page).toBe(Math.max(1,Math.ceil(count/10)));expect(last.rows.length).toBeLessThanOrEqual(10);expect(paperLocalPage(rows,0).page).toBe(1);
 });
 test('period change resets snapshot and both server pages; horizon/page preserve the snapshot and other page',()=>{
  const q={...PAPER_INITIAL_QUERY,signalPage:3,valuationPage:2};const period=paperNextQuery(q,{period:'week',anchorSession:'2026-11-02'},'saved-token');expect(period).toEqual({...q,period:'week',anchorSession:'2026-11-02',signalPage:1,valuationPage:1,snapshot:null});
  expect(paperNextQuery(q,{horizon:'year'},'saved-token')).toEqual({...q,horizon:'year',snapshot:'saved-token'});expect(paperNextQuery(q,{signalPage:2},'saved-token').valuationPage).toBe(2);
  expect(paperQueryUrl({...q,snapshot:'token with +/?'})).toContain('snapshot=token+with+%2B%2F%3F');expect(paperQueryUrl(q)).not.toContain('anchorSession');
 });
 test('calendar duration handles weeks, month lengths, leap days, completed/all ranges and future elapsed zero',()=>{
 expect(paperCalendarSpan('week','2026-11-02','2026-11-08','2026-11-06')).toEqual({label:'1주',totalDays:7,elapsedDays:5});
 expect(paperCalendarSpan('month','2024-02-01','2024-02-29','2024-02-29')).toEqual({label:'1개월',totalDays:29,elapsedDays:29});
 expect(paperCalendarSpan('month','2026-10-01','2026-10-31','2026-11-06')?.elapsedDays).toBe(31);
 expect(paperCalendarSpan('all','2026-10-15','2026-11-06','2026-11-06')).toEqual({label:'전체 관측범위',totalDays:23,elapsedDays:23});
 expect(paperCalendarSpan('week','2026-11-09','2026-11-15','2026-11-06')?.elapsedDays).toBe(0);
 for(const args of [[null,'2026-11-08','2026-11-06'],['2026-02-30','2026-03-08','2026-03-06'],['2026-11-08','2026-11-02','2026-11-06'],['2026-11-02','2026-11-08','bad-date']] as const)expect(paperCalendarSpan('week',args[0],args[1],args[2])).toBeNull();
 });
 test('roving tab keys wrap and Home/End target the edges without hijacking Tab',()=>{
 expect(paperTabIndex(0,'ArrowLeft',4)).toBe(3);expect(paperTabIndex(3,'ArrowRight',4)).toBe(0);expect(paperTabIndex(2,'Home',4)).toBe(0);expect(paperTabIndex(1,'End',4)).toBe(3);expect(paperTabIndex(1,'Tab',4)).toBeNull();
 });
});

function syntheticForecastView(){
 const d=syntheticPaperView();const distribution={mean:1,p10:-2,p50:.5,p90:4};
 const record={id:'synthetic-forecast',sha256:'hash',modelCodeSha256:'code',inputSha256:'input',issuedAt:'2026-11-08T12:00:00Z',sourceAvailableAt:'2026-11-08T10:00:00Z',sourceDatasetId:'synthetic-source',sourceSha256:'source',policySha256:'policy',modelVersion:'synthetic-model',seed:'synthetic-seed',baseline:{kind:'forecast_only_marked_snapshot' as const,accountId:'synthetic',accountRevision:1,session:'2026-11-06',equityUsd:1000,bookSha256:'book',sourceAccountStateSha256:'original',epochSession:'2026-11-09',epochProvisional:true},sampleCounts:{historicalReturns:297,historicalStart:'2025-09-02',historicalEnd:'2026-11-05',blockLength:10,possibleBlockStarts:288,nonoverlappingBlocks:29},bridge:{kind:'none' as const,session:null,intercept:0,slope:0,predictor:0,residualSha256:'residual',fitStart:null,fitEnd:null,sampleCount:0},assumptions:['synthetic assumption'],result:{horizon:'week' as const,calendarTarget:'2026-11-13',targetSession:'2026-11-13',sessions:5,netUsd:distribution,netPct:distribution,lossCount:400,pathCount:2000,lossProbability:.2,monteCarloSe:.008,historicalNonoverlappingWindows:59}};
 const page={rows:[record],page:1,pageSize:10 as const,totalCount:1,totalPages:1,hasNext:false,hasPrevious:false};
 d.forecasts={capability:'available',horizon:'week',selectedId:record.id,selectedRecord:record,selectionStatus:'selected',comparisonSummary:{total:0,completed:0,pending:0,unconfirmed:0,incomparable:0,meanBrier:null,intervalCoverage:null},records:[record],comparison:[],recordPage:page,comparisonPage:{...page,rows:[],totalCount:0},baseline:1000,targetEnd:'2026-11-13',expectedReturnPct:1,feePerSide:.0025};
 return d;
}
test('immutable forecast renders stored percent units and sample honesty without public input',()=>{
 const d=syntheticForecastView();const html=render(state(d),'performance','forecast');
 expect(html).toContain('synthetic-forecast');expect(html).toContain('400/2000');expect(html).toContain('297');expect(html).toContain('0.80');expect(html).toContain('예측 전용 임시 주기');expect(html).not.toContain('100.00%');
});

test('chosen immutable forecast id persists across horizon, period and page changes',()=>{
 const id='a'.repeat(64),q={...PAPER_INITIAL_QUERY,forecastId:id};
 for(const patch of [{horizon:'year' as const},{forecastPage:2},{period:'week' as const,anchorSession:'2026-11-09'}])expect(paperNextQuery(q,patch,'token').forecastId).toBe(id);
 expect(paperQueryUrl(q)).toContain('forecastId='+id);
});
test('missing selected forecast never silently renders another available original',()=>{
 const d=syntheticPaperView();d.forecasts={...d.forecasts,capability:'preparing',selectedId:'a'.repeat(64),selectedRecord:null,selectionStatus:'missing',recordPage:paperLocalPage([],1),comparisonPage:paperLocalPage([],1)};
 const html=render(state(d),'performance','forecast');expect(html).toContain('선택한 예측 원본 없음');expect(html).not.toContain('기대 순손익 $');
});

test.each(['baseline','samples','bridge','horizon','comparison','summary'] as const)('malformed forecast %s fails closed before any private SSR',kind=>{
 const d=syntheticForecastView(),raw=d as unknown as {forecasts:Record<string,any>};
 if(kind==='baseline')delete raw.forecasts.selectedRecord.baseline;
 if(kind==='samples')delete raw.forecasts.selectedRecord.sampleCounts.historicalStart;
 if(kind==='bridge')delete raw.forecasts.selectedRecord.bridge;
 if(kind==='horizon')delete raw.forecasts.selectedRecord.result.netUsd;
 if(kind==='comparison'){raw.forecasts.comparison=[{id:'x',runId:'private-run',status:'completed',issues:[],forecast:{}}];raw.forecasts.comparisonPage.rows=raw.forecasts.comparison;}
 if(kind==='summary')raw.forecasts.comparisonSummary.completed={bad:true};
 expect(isPaperViewV6(d)).toBe(false);for(const view of ['forecast','comparison'] as const){let html='';expect(()=>{html=render(state(d),'performance',view);}).not.toThrow();expect(html).toContain('조회하지 못했습니다');expect(html).not.toContain('synthetic-forecast');expect(html).not.toContain('private-run');}
});

test.each([401,403])('actual polling HTTP %i clears immutable selection and private snapshot',status=>{
 const previous=state(syntheticForecastView()),outcome=readEnvelope<PaperView>(status,{ok:false});
 const poll=paperSafePoll(applyOutcome(previous,outcome,2,false));expect(poll.status).toBe('error');expect(poll.data).toBeNull();
 const q=paperQueryAfterAuthError({...PAPER_INITIAL_QUERY,forecastId:'a'.repeat(64),snapshot:'private-snapshot'},poll.error);
 expect(q.forecastId).toBeNull();expect(q.snapshot).toBeNull();expect(paperQueryUrl(q)).not.toContain('forecastId');expect(paperQueryUrl(q)).not.toContain('private-snapshot');
 const html=render(poll,'performance','forecast');expect(html).not.toContain('synthetic-forecast');expect(html).not.toContain('synthetic-source');
});
test('explicit http_401 also clears selection while a network error retains the chosen original',()=>{
 const q={...PAPER_INITIAL_QUERY,forecastId:'a'.repeat(64)};expect(paperQueryAfterAuthError(q,'http_401').forecastId).toBeNull();expect(paperQueryAfterAuthError(q,'network')).toBe(q);
});

test('forecast range is explicitly central 80 percent, with unbounded outcomes and unsigned probability',()=>{
 const html=render(state(syntheticForecastView()),'performance','forecast');expect(html).toContain('중앙 80% 모형범위(P10–P90)');expect(html).toContain('범위 밖 손익도 가능하며 최저·최고 손익을 보장하지 않습니다.');expect(html).toContain('20.00%');expect(html).not.toContain('+20.00%');expect(html).toContain('+1.00%');
});
test('comparison preserves signed return and labels central range while coverage has no plus sign',()=>{
 const d=syntheticForecastView(),forecast=d.forecasts.selectedRecord!.result;
 const compared={id:'synthetic-eval',runId:'synthetic-forecast',horizon:'week',status:'completed',createdAt:'2026-11-16T12:00:00Z',forecast,issues:[],actualPnlUsd:20,actualReturnPct:2,errorPct:1,intervalHit:true,brier:.04};
 d.forecasts.comparison=[compared];d.forecasts.comparisonPage=paperLocalPage([compared],1);d.forecasts.comparisonSummary={total:1,completed:1,pending:0,unconfirmed:0,incomparable:0,meanBrier:.04,intervalCoverage:1};
 const html=render(state(d),'performance','comparison');expect(html).toContain('중앙 80% 모형범위(P10–P90)');expect(html).toContain('범위 밖 손익도 가능하며 최저·최고 손익을 보장하지 않습니다.');expect(html).toContain('100.00%');expect(html).not.toContain('+100.00%');expect(html).toContain('+2.00%');
});

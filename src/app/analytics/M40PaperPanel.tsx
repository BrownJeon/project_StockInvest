'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useOpsPoll, type PollState } from '@/components/ops/useOpsPoll';
import { Section, StatusChip } from '@/components/ops/ui';
import type { PaperView, PaperViewV6, PaperViewCycle, PaperViewQuery, PaperViewPage, PaperViewSignal, PaperForecastHorizon } from '@/lib/strategy/m40/paper-view-types';
import { PAPER_BLOCKED_CONSEQUENCE, paperAction, paperBlockedReason, paperJudgmentRows, paperMode, paperNumber, paperPct, paperReason, paperSignalStatus, paperTime, paperUsd } from './m40-paper-copy';
import { paperQueryAfterAuthError,PAPER_INITIAL_QUERY, paperHorizonLabel, paperLocalPage, paperNextQuery, paperQueryUrl, paperTabIndex, paperSafePoll, paperCalendarSpan } from './m40-paper-ui';
import css from './M40PaperPanel.module.css';

type ViewData=PaperView&PaperViewV6;
export const M40_PAPER_URL='/api/research/t156/paper';
export const M40_POLL_OPTIONS={intervalMs:60_000,keepLastOnError:false} as const;
const AREAS=[['collection','수집상태'],['judgments','종목판단'],['signals','모의시그널'],['performance','모의성과']] as const;
export type PaperArea=typeof AREAS[number][0];
export type PaperPerformanceView='observed'|'forecast'|'comparison';
const STAGES=[['interpretation','해석'],['observation','관찰'],['condition','조건'],['priority','우선순위']] as const;
const SOURCE_KIND:Record<string,string>={raw_quote:'원가격 시세',split_bar:'분할 조정 일봉',sp500_bar:'S&P 500 지수'};
const pctClass=(n:number|null)=>n==null?'':n>0?css.positive:n<0?css.negative:'';
/** T-178 D1-A — 긴 사유 코드를 밑줄 뒤에서만 줄바꿈. */
const codeBreaks=(code:string)=>code.split('_').flatMap((part,i,all)=>i<all.length-1?[`${part}_`,<wbr key={i}/>]:[part]);

/** Each URL owns a polling instance. A changed query cannot briefly render the old DTO. */
function PaperRequest({url,onPoll}:{url:string;onPoll:(url:string,poll:PollState<ViewData>,refresh:()=>void)=>void}){
 const poll=useOpsPoll<unknown>(url,M40_POLL_OPTIONS);
 const refreshRef=useRef(poll.refresh);refreshRef.current=poll.refresh;
 const retry=useCallback(()=>refreshRef.current(),[]);
 const {status,data,error,lastOkAt}=poll;
 useEffect(()=>{onPoll(url,paperSafePoll({status,data,error,lastOkAt}),retry);},[url,status,data,error,lastOkAt,retry,onPoll]);
 return null;
}
export function M40PaperPanel({stickyTop=0}:{stickyTop?:number}){
 const [query,setQuery]=useState<PaperViewQuery>(PAPER_INITIAL_QUERY);
 const [generation,setGeneration]=useState(0);
 const [response,setResponse]=useState<{url:string;poll:PollState<ViewData>}|null>(null);
 const token=useRef<string|null>(null),refresh=useRef<()=>void>(()=>{});
 const url=paperQueryUrl(query),requestKey=`${generation}:${url}`;
 const activeRequestKey=useRef(requestKey);activeRequestKey.current=requestKey;
 const receive=useCallback((key:string,poll:PollState<ViewData>,retry:()=>void)=>{
  if(key!==activeRequestKey.current)return;
  refresh.current=retry;
  if(poll.status==='ok'){token.current=poll.data?.snapshot.token??null;const selected=poll.data?.forecasts.selectedId;if(selected)setQuery(q=>q.forecastId?q:{...q,forecastId:selected});}
  if(poll.status==='error'){token.current=null;setQuery(q=>paperQueryAfterAuthError(q,poll.error));}
  setResponse({url:key,poll});
 },[]);
 const poll:PollState<ViewData>=response?.url===requestKey?response.poll:{status:'loading',data:null,error:null,lastOkAt:null};
 // Expiry is the sole automatic retry: start a new snapshot and both lists at page one.
 useEffect(()=>{if(poll.error==='http_409'){
  token.current=null;setResponse(null);setQuery(q=>({...q,snapshot:null,signalPage:1,valuationPage:1,forecastPage:1,comparisonPage:1}));setGeneration(n=>n+1);
 }},[poll.error]);
 const change=(patch:Partial<PaperViewQuery>)=>setQuery(q=>paperNextQuery(q,patch,token.current));
 const receiveCurrent=useCallback((_:string,p:PollState<ViewData>,r:()=>void)=>receive(requestKey,p,r),[receive,requestKey]);
 return <><PaperRequest key={requestKey} url={url} onPoll={receiveCurrent}/><M40PaperView poll={poll} query={query} onQuery={change} stickyTop={stickyTop} onRefresh={()=>refresh.current()}/></>;
}

export function M40PaperView({poll:incomingPoll,onRefresh,query=PAPER_INITIAL_QUERY,onQuery=()=>{},stickyTop=0,initialArea='collection',initialPerformanceView='observed'}:{poll:PollState<PaperView>;onRefresh:()=>void;query?:PaperViewQuery;onQuery?:(patch:Partial<PaperViewQuery>)=>void;stickyTop?:number;initialArea?:PaperArea;initialPerformanceView?:PaperPerformanceView}){
 const poll=paperSafePoll(incomingPoll);
 const [active,setActive]=useState<PaperArea>(initialArea),[performanceView,setPerformanceView]=useState<PaperPerformanceView>(initialPerformanceView);
 const [search,setSearch]=useState(''),[filter,setFilter]=useState('all'),[sourceSearch,setSourceSearch]=useState('');
 const [collectionPage,setCollectionPage]=useState(1),[judgmentPage,setJudgmentPage]=useState(1);
 const navRef=useRef<HTMLDivElement>(null),panelRef=useRef<HTMLDivElement>(null);
 const [navHeight,setNavHeight]=useState(52);
 const pendingPage=useRef<'previous'|'next'|null>(null);
 // Error or loading never renders private policy, balances, signals or forecasts.
 const d=poll.status==='ok'?poll.data as ViewData|null:null;
 const current=d?.currentCycle??null,previous=current?.mode==='blocked'?d?.lastUsableCycle??null:null,cycle=previous??current;
 const judgments=paperLocalPage(paperJudgmentRows(cycle,search,filter),judgmentPage);
 const sources=paperLocalPage((cycle?.collection.sources??[]).filter(s=>`${s.sourceId} ${SOURCE_KIND[s.kind]??s.kind}`.toLowerCase().includes(sourceSearch.trim().toLowerCase())),collectionPage);
 useEffect(()=>{
  const node=navRef.current;if(!node)return;
  const measure=()=>setNavHeight(node.getBoundingClientRect().height);
  measure();const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(measure);observer?.observe(node);
  window.addEventListener('resize',measure);return()=>{observer?.disconnect();window.removeEventListener('resize',measure);};
 },[]);
 useEffect(()=>{
  if(!d||!pendingPage.current)return;
  const target=panelRef.current?.querySelector<HTMLButtonElement>(`button[data-page="${pendingPage.current}"]:not(:disabled)`)
   ??panelRef.current?.querySelector<HTMLButtonElement>('button[data-page]:not(:disabled)')??panelRef.current;
  pendingPage.current=null;target?.focus({preventScroll:true});
  panelRef.current?.scrollIntoView({block:'start',behavior:'auto'});
 },[d,collectionPage,judgmentPage]);
 useEffect(()=>{if(poll.status==='error')pendingPage.current=null;},[poll.status]);
 const failure=poll.error==='unauthorized'?'로그인이 필요합니다':poll.error==='http_403'?'조회 권한이 없습니다':'조회하지 못했습니다';
 const unavailable=<div className={css.empty} role={poll.status==='error'?'alert':'status'} aria-busy={poll.status==='loading'}>{poll.status==='error'?<><b>{failure}</b><br/>저장된 비공개 자료는 표시하지 않습니다.<br/><button className={css.refresh} onClick={onRefresh}>다시 조회</button></>:<>불러오는 중…<br/>저장 자료만 조회합니다. 수집·분석을 실행하지 않습니다.</>}</div>;
 const cycleNote=previous?<p className={css.hint}><b>이전 저장분 · {previous.session} 세션 (ET)</b><br/>{paperMode(previous.mode)} · 저장 분석 기준 {paperTime(previous.decisionAt)}<br/>최신 회차가 차단돼 마지막으로 처리된 회차를 보여 줍니다. 세션은 미국 동부 거래일, 저장 분석 기준은 한국 시간 처리 시각이라 날짜가 하루 늦게 보일 수 있습니다.</p>:null;
 function selectTab(index:number,focus=false){pendingPage.current=null;const id=AREAS[index][0];setActive(id);if(focus)navRef.current?.querySelector<HTMLButtonElement>(`#m40-tab-${id}`)?.focus();}
 function tabKey(e:KeyboardEvent<HTMLButtonElement>,i:number){const next=paperTabIndex(i,e.key,AREAS.length);if(next!==null){e.preventDefault();selectTab(next,true);}}
 function pageChange(direction:'previous'|'next',page:number,setPage:(n:number)=>void){pendingPage.current=direction;setPage(page);}
 const style={'--m40-sticky-top':`${stickyTop}px`,'--m40-scroll-top':`${stickyTop+navHeight+12}px`} as CSSProperties;
 return <div className={css.body} style={style}>
  <p className={css.summary}><StatusChip kind="partial">모의 전용</StatusChip> <StatusChip kind={current?.mode==='blocked'?'blocked':'unknown'}>{paperMode(current?.mode)}</StatusChip><br/>실주문 없음 · 제한 후보군<br/>새로고침은 저장 자료만 다시 읽습니다.<br/>이 화면은 전역 실거래 설정을 변경하지 않습니다.</p>
  {current?.mode==='blocked'&&<div className={`${css.notice} ${css.blocked}`} role="status"><b>최신 회차 처리 차단 · {current.session} 세션 (ET)</b><br/>{paperBlockedReason(current.errorCode)}<br/>{PAPER_BLOCKED_CONSEQUENCE}<br/>처리 시도 {paperTime(current.decisionAt)}{!previous&&<><br/>표시할 이전 저장분도 없습니다.</>}{current.errorCode&&<><br/><span className={css.reasonCode}>사유 코드 {codeBreaks(current.errorCode)}</span></>}</div>}
  {d&&<Policy data={d} cycle={cycle}/>}
  <div className={css.nav} ref={navRef} role="tablist" aria-label="모의분석 상세 영역">{AREAS.map(([id,label],i)=><button type="button" role="tab" id={`m40-tab-${id}`} aria-selected={active===id} aria-controls={`m40-panel-${id}`} tabIndex={active===id?0:-1} key={id} onClick={()=>selectTab(i)} onKeyDown={e=>tabKey(e,i)}>{label}</button>)}</div>
  <div ref={panelRef} className={css.section} id={`m40-panel-${active}`} role="tabpanel" aria-labelledby={`m40-tab-${active}`} tabIndex={0} aria-busy={poll.status==='loading'}>
   <Section id={`m40-h-${active}`} title={AREAS.find(a=>a[0]===active)![1]}>
    {(active==='signals'||active==='performance'&&performanceView==='observed')&&<PeriodControls query={query} data={d} onQuery={patch=>{pendingPage.current=null;onQuery(patch);}}/>}
    {active==='performance'&&<div className={css.views} aria-label="모의성과 보기">{([['observed','관측된 성과'],['forecast','향후 예상성과'],['comparison','예측 사후비교']] as const).map(([id,label])=><button key={id} type="button" aria-pressed={performanceView===id} onClick={()=>{pendingPage.current=null;setPerformanceView(id);}}>{label}</button>)}</div>}
    {active==='performance'&&performanceView==='forecast'&&<div className={css.filters}><label>예상 기간 <select aria-label="향후 예상기간" value={query.horizon} onChange={e=>{pendingPage.current=null;onQuery({horizon:e.target.value as PaperForecastHorizon});}}>{(['week','month','quarter','year'] as const).map(h=><option key={h} value={h}>향후 {paperHorizonLabel(h)}</option>)}</select></label></div>}
    {!d?unavailable:active==='collection'?!cycle?<div className={css.empty}>아직 저장된 분석 회차가 없습니다. 수집 결과를 0으로 간주하지 않습니다.</div>:<>{cycleNote}<div className={css.filters}><label>출처 검색 <input aria-label="수집 출처 검색" value={sourceSearch} onChange={e=>{setSourceSearch(e.target.value);setCollectionPage(1);}}/></label></div><Collection cycle={cycle} rows={sources.rows}/><Pager label="수집 출처" page={sources} onPage={(n,dir)=>pageChange(dir,n,setCollectionPage)}/><button className={css.refresh} onClick={onRefresh}>저장자료 새로고침</button></>
    :active==='judgments'?!cycle?<div className={css.empty}>아직 종목 판단 기록이 없습니다.</div>:<>{cycleNote}<div className={css.filters}><label>종목 <input aria-label="모의 종목 코드" value={search} placeholder="NAS:AAPL" onChange={e=>{setSearch(e.target.value);setJudgmentPage(1);}}/></label><label>판단 <select value={filter} onChange={e=>{setFilter(e.target.value);setJudgmentPage(1);}}><option value="all">전체</option><option value="selected">선정</option><option value="excluded">미선정·제외</option></select></label></div>
     <p className={css.hint}>M40 기본 규칙 · 저장 판단 전체 {paperNumber(paperJudgmentRows(cycle).length)}종목 · 필터 결과 {judgments.totalCount}종목<br/>적격·순위·상위 선정과 실제 모의 매매 판단은 별개입니다.</p>
     {cycle.warnings.filter(w=>!w.symbol).map((w,i)=><p key={i} className={css.hint}>{paperReason(w.code)}</p>)}<details><summary>판단 에이전트 4단계 기록</summary>{STAGES.map(([id,label])=>{const j=cycle.judgments.find(r=>r.stage===id);return <p key={id} className={css.hint}>{label}: {j?`${j.status==='shadow'?'참고 판단 기록':j.status==='unknown'?'판단 미확인':j.status==='skipped'?'건너뜀':'저장 상태 '+j.status} · ${paperReason(j.reason)}`:'단계 기록 없음 · 호출 여부 미확인'}</p>;})}<p className={css.hint}>참고 판단은 M40 기본 매매를 변경하지 않습니다.</p></details>
     {!judgments.rows.length?<div className={css.empty}>조건에 맞는 종목 기록이 없습니다.</div>:judgments.rows.map(r=><Judgment key={r.symbol} row={r} cycle={cycle}/>)}<Pager label="종목 판단" page={judgments} onPage={(n,dir)=>pageChange(dir,n,setJudgmentPage)}/></>
    :active==='signals'?<><ObservationHeader data={d}/><p className={css.hint}>생성 기준 세션으로 필터한 모의 원장 전체 {d.signalPage.totalCount}개 · 아래는 현재 페이지입니다.<br/>리허설 기록은 미체결이며 전진 시그널과 구분합니다. 실제 주문·체결이 아닙니다.<br/>개별 시그널 손익 집계 연결 전 · 보유 추적 시작·종료·청산 완결은 미지원/미확인입니다.</p>{!d.signalPage.rows.length?<div className={css.empty}>선택기간 모의시그널 기록이 없습니다. 수익 0을 뜻하지 않습니다.</div>:d.signalPage.rows.map(s=><Signal key={s.id} signal={s}/>)}<Pager label="모의시그널" page={d.signalPage} onPage={(n,dir)=>pageChange(dir,n,p=>onQuery({signalPage:p}))}/><FeeNote/></>
    :performanceView==='forecast'?<Forecast horizon={query.horizon} forecasts={d.forecasts} onPage={p=>onQuery({forecastPage:p})} onSelect={forecastId=>onQuery({forecastId})}/>:performanceView==='comparison'?<Comparison forecasts={d.forecasts} onPage={p=>onQuery({comparisonPage:p})}/>
    :<><Performance data={d}/><Pager label="평가 관측점" page={d.valuationPage} onPage={(n,dir)=>pageChange(dir,n,p=>onQuery({valuationPage:p}))}/></>}
   </Section>
  </div>
 </div>;
}

function Pager({label,page,onPage}:{label:string;page:PaperViewPage<unknown>;onPage:(page:number,direction:'previous'|'next')=>void}){
 const start=page.totalCount?(page.page-1)*10+1:0,end=Math.min(page.page*10,page.totalCount);
 return <nav className={css.pager} aria-label={`${label} 페이지`}><button type="button" data-page="previous" disabled={!page.hasPrevious} onClick={()=>onPage(page.page-1,'previous')}>이전</button><span aria-live="polite">{start}–{end} / {page.totalCount}개<br/>{page.page} / {page.totalPages} 페이지</span><button type="button" data-page="next" disabled={!page.hasNext} onClick={()=>onPage(page.page+1,'next')}>다음</button></nav>;
}
function Policy({data:d,cycle}:{data:ViewData;cycle:PaperViewCycle|null}){
 return <div className={css.policy}><b>현재 연결: M40 기본 매매 · 에이전트 참고 전용</b><p>에이전트 판단의 거래 반영 미구현 · 모델 호출 누락은 미확인</p><details><summary>선택 회차의 저장 정책 상태</summary><p>정책 판본: {d.policyRecord.policyVersion??'미확인'}<br/>저장 모델 정책: {d.policyRecord.modelPolicyVersions.join(' · ')||'미확인'}<br/>프롬프트 판본: 미확인<br/>선택 회차: {cycle?.session??'미확인'} (ET)</p><p>계좌 개정 {d.snapshot.accountRevision}은 정책 판본을 뜻하지 않습니다. 저장 기록 없는 모델 호출을 미호출로 단정하지 않습니다.</p></details></div>;
}
function PeriodControls({query,data,onQuery}:{query:PaperViewQuery;data:ViewData|null;onQuery:(patch:Partial<PaperViewQuery>)=>void}){
 const options=query.period==='week'?data?.history.availablePeriods.weeks:query.period==='month'?data?.history.availablePeriods.months:[];
 const anchors=[...new Set([...(options??[]),...(query.anchorSession?[query.anchorSession]:[])])];
 return <div className={css.filters} aria-label="공통 관측기간"><label>관측기간 <select value={query.period} onChange={e=>{
  const period=e.target.value as PaperViewQuery['period'];
  const anchorSession=period==='all'?null:(period==='week'?data?.history.availablePeriods.weeks[0]:data?.history.availablePeriods.months[0])??null;
  onQuery({period,anchorSession});
 }}><option value="all">전체</option><option value="week" disabled={!data?.history.availablePeriods.weeks.length}>주간</option><option value="month" disabled={!data?.history.availablePeriods.months.length}>월간</option></select></label>{query.period!=='all'&&<label>{query.period==='week'?'주 시작':'월 시작'} <select aria-label="관측기간 기준 세션" value={query.anchorSession??''} onChange={e=>onQuery({anchorSession:e.target.value})}>{anchors.map(a=><option key={a} value={a}>{a} (ET)</option>)}</select></label>}</div>;
}
function ObservationHeader({data:d}:{data:ViewData}){
 const o=d.observation;
 const calendarInProgress=Boolean(o.endSession&&o.asOfSession&&o.endSession>o.asOfSession);
 const accountPartial=o.issues.includes('account_started_during_period');
 const calendar=paperCalendarSpan(o.period,o.startSession,o.endSession,o.asOfSession);
 const periodLabel=calendarInProgress?'진행 중 부분기간 · 기준일까지':accountPartial?'모의투자 시작 이후만 관측한 부분기간':o.partialPeriod?'부분기간':'선택기간';
 return <div className={css.intro}><b>{o.period==='all'?'전체':o.period==='week'?'주간':'월간'} 모의계좌 관측기간</b><p>{calendar?`${calendar.label} (달력 ${calendar.totalDays}일) · 기준일까지 경과 ${calendar.elapsedDays}일`:'기간 길이·경과일 미확인'}<br/>선택 달력기간의 경과이며 평가 관측일·거래일 수와 다릅니다. 모의투자 시작 전 제외·시작 이후 관측 범위와도 구별합니다.</p><p>선택 {o.startSession??'미확인'}–{o.endSession??'미확인'} (ET)<br/>계좌 전진 관측 전체 {d.history.firstSession??'미확인'}–{d.history.lastSession??'미확인'} (ET)<br/>기준 세션 {o.asOfSession??'미확인'} (ET) · 조회 기록 {paperTime(d.snapshot.asOf)}</p><p>{periodLabel} · 예상 {paperNumber(o.expectedSessions)} / 관측 {paperNumber(o.observedSessions)} / 누락 {paperNumber(o.missingSessions)}거래일<br/>거래소 달력 {o.calendarStatus==='known'?'확인':'미확인'} · {o.truncated?'이력 잘림':'이력 잘림 없음'}{d.history.periodsTruncated?' · 선택기간 목록 일부 조회':''}</p>{accountPartial&&<p>모의투자 시작 전 세션은 관측 대상에서 제외합니다. 시작 기준평가가 없으면 기간 수익률은 미확인입니다.</p>}</div>;
}
function Collection({cycle,rows}:{cycle:PaperViewCycle;rows:PaperViewCycle['collection']['sources']}){
 const c=cycle.collection;
 return <><div className={css.source}><b>참조 {paperNumber(c.referenceCount)} · 평가 적격 {paperNumber(c.qualifiedCount)}</b><p>가격 세션 {cycle.session} (ET)</p><p>마지막 저장 분석 기준 {paperTime(cycle.decisionAt)} · 수집 완료 시각과 별개</p><p>실제 수신 집계 {paperTime(c.actualReceiptAt)} · 원문 공개 시각 미확인</p><p>공시 수집 미확인 · 뉴스 수집 미확인</p><p>저장 출처 집계 전체 {c.sources.length}개 · 필터 결과 목록은 최대 10개씩 표시</p></div>{rows.length?rows.map(s=><div className={css.source} key={`${s.sourceId}-${s.kind}-${s.sourceVariant}`}><b>{SOURCE_KIND[s.kind]??'출처 종류 미확인'} · {s.sourceId}</b><p>{paperNumber(s.symbolCount)}종목 · {paperNumber(s.observations)}관측 · 최신 {s.latestSession} 세션 (ET)</p><details><summary>출처 수신·가용 시각</summary><p>최초 수신 {paperTime(s.firstReceiptAt)}<br/>최종 수신 {paperTime(s.lastReceiptAt)}<br/>최종 가용 {paperTime(s.lastAvailableAt)}<br/>원문 공개 시각 미확인</p></details></div>):<p className={css.hint}>조건에 맞는 검증된 출처 집계 없음. 수집 성공으로 간주하지 않습니다.</p>}{c.issues.map((issue,i)=><p key={i} className={css.hint}>{paperReason(issue)}</p>)}<p className={css.hint}>M40은 제한된 후보군의 모의분석입니다. 전체 시장 분석·실매매 적격 판정이 아닙니다.</p></>;
}
function Judgment({row:r,cycle}:{row:ReturnType<typeof paperJudgmentRows>[number];cycle:PaperViewCycle}){
 return <article className={css.judgment}><div className={css.head}><b>{r.symbol}</b><StatusChip kind={r.candidate?.selected?'partial':'unknown'}>{r.candidate?.selected?'선정':'미선정·제외'}</StatusChip></div><p>모멘텀 {r.candidate?.momentum==null?'산출 불가':paperPct(r.candidate.momentum*100)} · 순위 {r.candidate?.rank==null?'대상 아님':paperNumber(r.candidate.rank)}</p><p><b>매매 판단: {r.candidate?.selected&&!r.decision?'선정됐지만 저장된 매매 의도 없음':paperAction(r.decision?.action)}</b></p><p>{paperReason(r.decision?.reason??r.candidate?.reason)}</p>{r.warnings.map((w,i)=><p key={i}>{paperReason(w.code)}</p>)}{r.candidate?.selected&&!r.decision&&!r.warnings.length&&<p>가용 모의현금·보유·교체일 등의 상세 제약 사유는 제공 자료에서 미확인입니다.</p>}<details><summary>판단 상세 보기</summary><p>평가 적격: {r.eligibility?r.eligibility.eligible?'적격':'조건 미충족':'미확인'} · 고정 후보군: {r.eligibility?r.eligibility.inFrozenCohort?'포함':'미포함':'미확인'}</p><p>후보 판단: {paperReason(r.candidate?.reason)}</p>{r.eligibility?.issues.map((issue,i)=><p key={i}>{paperReason(issue)}</p>)}<p>의도 수량: {r.decision?.quantity==null?'미확인':`${paperNumber(r.decision.quantity)}주`} · {paperMode(cycle.mode)}</p></details></article>;
}
function Signal({signal:s}:{signal:PaperViewSignal}){
 return <article className={css.judgment}><div className={css.head}><b>{s.symbol}</b><span className={s.side==='buy'?css.positive:css.negative}>{paperAction(s.side)}</span></div><p>{paperMode(s.mode)} · {paperSignalStatus(s.status)}</p><p>{paperReason(s.reason)}</p><p>의도 {s.quantity==null?'수량 미확인':`${paperNumber(s.quantity)}주`} · 예정 개장 {s.executeSession??'미확인'} 세션 (ET)</p><details><summary>모의 기록 상세</summary><p>생성 기준 세션 {s.session} (ET) · 실제 기록 {paperTime(s.createdAt)}</p>{s.outcome?<><p>{paperReason(s.outcome.reason)} · 모형 수량 {paperNumber(s.outcome.quantity)}주</p><p>모형 가격 {paperUsd(s.outcome.priceUsd)} · 모형 수수료 {paperUsd(s.outcome.feeUsd)}</p><p>결제 세션 {s.outcome.settlementSession??'미확인'} · 관측 {paperTime(s.outcome.observedAt)}</p><p>이 관측만으로 포지션 청산·실현손익·추적 완결을 확인할 수 없습니다.</p></>:<p>모형 체결 결과 없음 · 실제 체결로 간주하지 않습니다.</p>}</details></article>;
}
function FeeNote(){return <p className={css.hint}>모형 비용: 매수 0.25% · 매도 0.25% (각 편도 거래대금). 예측구간 신규 매수·매도 비용이며 과거 보유 매수비용을 다시 차감하지 않습니다. 실제 체결·수익을 보장하지 않습니다.</p>;}
const paperProbabilityPct=(value:number)=>Number.isFinite(value)?`${value.toFixed(2)}%`:'미확인';
function Forecast({horizon,forecasts:f,onPage,onSelect}:{horizon:PaperForecastHorizon;forecasts:PaperView['forecasts'];onPage:(p:number)=>void;onSelect:(id:string)=>void}){
 const selected=f.selectedRecord??(f.selectionStatus===undefined?f.records[0]??null:null);const choices=f.selectedRecord&&!f.records.some(r=>r.id===f.selectedRecord!.id)?[f.selectedRecord,...f.records]:f.records;
 return <><div className={css.intro}><b>향후 {paperHorizonLabel(horizon)} 예상성과</b><p>미보정 연구 시나리오 · 실제 수익 보장 없음 · 에이전트는 참고 전용</p></div>{choices.length>0&&<div className={css.filters}><label>예측 원본 <select aria-label="예측 원본" value={f.selectedId??selected?.id??''} onChange={e=>onSelect(e.target.value)}>{f.selectionStatus==='missing'&&<option value={f.selectedId??''}>선택 원본을 찾을 수 없음</option>}{choices.map(r=><option key={r.id} value={r.id}>{paperTime(r.issuedAt)} · {r.id.slice(0,12)}</option>)}</select></label></div>}{!selected?<div className={css.empty}>{f.selectionStatus==='missing'?'선택한 예측 원본 없음 · 다른 원본으로 자동 대체하지 않습니다':'저장된 예측 없음'} · {f.capability==='unavailable'?'예측 원장 준비 상태 미확인':f.workerStatus==='failed'?'예측 계산 실패 · 부분 경로는 발행하지 않음':'예측 발행 준비 중'} · 확률과 예상손익 미확인</div>:[selected].map(r=><article className={css.judgment} key={r.id}><b>{paperHorizonLabel(horizon)} · 목표 {r.result.targetSession} (ET)</b><p>기대 순손익 {paperUsd(r.result.netUsd.mean)} · {paperPct(r.result.netPct.mean)}<br/>중앙값 {paperUsd(r.result.netUsd.p50)} · {paperPct(r.result.netPct.p50)}<br/>중앙 80% 모형범위(P10–P90) {paperUsd(r.result.netUsd.p10)}–{paperUsd(r.result.netUsd.p90)} · {paperPct(r.result.netPct.p10)}–{paperPct(r.result.netPct.p90)}</p><p>범위 밖 손익도 가능하며 최저·최고 손익을 보장하지 않습니다.</p><p>모형 손실확률 {paperProbabilityPct(r.result.lossProbability*100)} ({r.result.lossCount}/{r.result.pathCount}경로) · MCSE {(r.result.monteCarloSe*100).toFixed(2)}%p<br/>MCSE는 모형·보정 불확실성과 별개입니다.</p><p>원본 역사 수익률 {r.sampleCounts.historicalReturns}개 ({r.sampleCounts.historicalStart}–{r.sampleCounts.historicalEnd}) · 해당 기간 비중첩 역사창 {r.result.historicalNonoverlappingWindows}개 · 실증 예측 표본이 아닙니다.</p><p>최근 공통가격 이력만 사용 · 장기 폭락 구간 전체를 포함하지 않음 · {paperNumber(r.result.pathCount)}경로는 같은 수의 독립 검증 표본이 아닙니다.</p>{r.bridge.kind!=='none'&&<p>지수 누락 구간은 비관측 추정입니다.</p>}{r.baseline.epochProvisional&&<p>예측 전용 임시 주기 · 실제 계좌 주기 일치 확인 전 사후비교 불가</p>}<details><summary>예측 원본·가정 보기</summary><p>발행 {paperTime(r.issuedAt)} · 가격 기준 {r.baseline.session} (ET)<br/>예측 전용 현재 보유 평가 기준 {paperUsd(r.baseline.equityUsd)}<br/>달력 목표 {r.result.calendarTarget} · 평가 예정 {r.result.targetSession} · {r.result.sessions}거래일<br/>자료 가용 {paperTime(r.sourceAvailableAt)}</p><p>예측 ID {r.id}<br/>자료 {r.sourceDatasetId} · {r.sourceSha256}<br/>정책 {r.policySha256}<br/>모형 {r.modelVersion} · seed {r.seed}<br/>모형 코드 {r.modelCodeSha256??'미확인'} · 입력 {r.inputSha256}<br/>블록 {r.sampleCounts.blockLength}일 · 가능 시작점 {r.sampleCounts.possibleBlockStarts}</p>{r.assumptions.map((x,i)=><p key={i}>{x}</p>)}</details></article>)}{f.recordPage&&<Pager label="예측 원본" page={f.recordPage} onPage={n=>onPage(n)}/>}<FeeNote/></>;
}
function Comparison({forecasts:f,onPage}:{forecasts:PaperView['forecasts'];onPage:(p:number)=>void}){
 return <>{!f.comparison.length?<div className={css.empty}>저장된 예측 사후비교 없음 · 정확도 미확인</div>:f.comparison.map(r=><article className={css.judgment} key={r.id}><b>{r.status==='completed'?'완료':r.status==='pending'?'목표일 대기':r.status==='incomparable'?'조건 변경 · 비교 불가':'가격·구간 부족 · 미확인'}</b><p>원본 {r.runId} · {paperHorizonLabel(r.horizon as PaperForecastHorizon)} · 평가 예정 {r.forecast.targetSession}<br/>원본 평균 {paperUsd(r.forecast.netUsd.mean)} · {paperPct(r.forecast.netPct.mean)}<br/>원본 중앙 80% 모형범위(P10–P90) {paperPct(r.forecast.netPct.p10)}–{paperPct(r.forecast.netPct.p90)} · 손실경로 {r.forecast.lossCount}/{r.forecast.pathCount}</p><p>범위 밖 손익도 가능하며 최저·최고 손익을 보장하지 않습니다.</p>{r.status==='completed'?<p>관측 순손익 {paperUsd(r.actualPnlUsd)} · {paperPct(r.actualReturnPct)}<br/>평균 예측 오차 {paperPct(r.errorPct)} · P10–P90 포함 {r.intervalHit?'예':'아니오'} · Brier {r.brier?.toFixed(4)}</p>:<p>실제 손익·오차·구간 적중·Brier 미확인</p>}{r.issues.map((x,i)=><p key={i}>{x}</p>)}</article>)}<p className={css.hint}>{f.comparisonSummary?<>전체 {f.comparisonSummary.total}건 · 완료 {f.comparisonSummary.completed} · 대기 {f.comparisonSummary.pending} · 관측 부족 {f.comparisonSummary.unconfirmed} · 조건 변경 {f.comparisonSummary.incomparable}<br/>{f.comparisonSummary.completed>0?<>완료 원본 전체 평균 Brier {f.comparisonSummary.meanBrier?.toFixed(4)??'미확인'} · P10–P90 포함률 {f.comparisonSummary.intervalCoverage===null?'미확인':paperProbabilityPct(f.comparisonSummary.intervalCoverage*100)}</>:'완료 0건 · Brier/구간 포함률 미확인'}<br/>{f.comparisonSummary.completed<30?'완료 표본 부족 · ':''}비중첩 실증 표본·모형 확률 보정 검증 미확인</>:'완료 표본·Brier/구간 포함률 미확인'}</p>{f.comparisonPage&&<Pager label="예측 사후비교" page={f.comparisonPage} onPage={n=>onPage(n)}/>}<FeeNote/></>;
}

function Performance({data:d}:{data:ViewData}){
 const o=d.observation;
 return <><ObservationHeader data={d}/><div className={css.intro}><b>선택기간 모의계좌성과 · 기존 보유 포함</b><p>{o.status==='observed'?(o.partialPeriod?'부분기간 관측 성과':'관측 성과'):o.status==='not_started'?(o.issues.includes('before_account_start')?'선택기간 관측 없음 · 모의투자 시작 전':d.history.firstSession?'선택기간 관측 없음':'선택기간 관측 없음 · 전진 시작 기록 미확인'):'성과 미확인'}</p><p>실제 평가관측 {o.firstObserved?.session??'미확인'}–{o.lastObserved?.session??'미확인'} (ET) · 전체 {o.totalPoints}점</p><p>수익률 기준: {o.baseline?`${o.baseline.point.session} (ET) · ${paperUsd(o.baseline.point.equityUsd)} · ${o.baseline.kind==='first_forward'?'최초 전진 평가':'직전 확인 평가'}`:'미확인 · 기준평가 없음'}<br/>마지막 평가: {o.lastObserved?`${o.lastObserved.session} (ET) · ${paperUsd(o.lastObserved.equityUsd)}`:'미확인'}</p></div>
  <div className={css.metrics}>{[['기간 수익률',paperPct(o.returnPct),o.returnPct],['기간 평가손익',paperUsd(o.pnlUsd),o.pnlUsd],['같은 기간 최대 낙폭',paperPct(o.maxDrawdownPct),o.maxDrawdownPct],['연환산 수익률 (CAGR)',paperPct(o.cagrPct),o.cagrPct]].map(([label,value,n])=><div key={String(label)} className={css.metric}><span>{label}</span><strong className={pctClass(n as number|null)}>{value}</strong></div>)}</div>
  <p className={css.hint}>요약은 전체 선택기간 집계이며 아래 평가점 페이지와 무관합니다. 0~1점·기준평가 없음·과거 공백·잘림이면 성과는 미확인입니다. CAGR은 365일 이상 완전 이력만 계산합니다. 거래소 달력·관측 완결 미확인은 완전한 기간으로 보지 않습니다.</p>{o.issues.map((issue,i)=><p key={i} className={css.hint}>{paperReason(issue)}</p>)}
  <details><summary>시작 투자금과 성과 계산 기준</summary><p>원래 시작 투자금 {paperUsd(d.account.cloneInvestmentUsd)} · 계좌 등록 {paperTime(d.account.registeredAt)}<br/>최신 저장 회차 평가액 {paperUsd(d.account.currentEquityUsd)}</p><p>시작 투자금·등록일·리허설 평가액은 최초 전진 기준평가를 대신하지 않습니다. 리허설을 전진성과에 합치지 않습니다. 기존 보유를 포함한 계좌성과이며 선택기간 생성 시그널만의 손익이 아닙니다. 실현·미실현 손익 분리와 개별 시그널 손익 귀속은 미지원입니다.</p></details><FeeNote/>
  {!d.valuationPage.rows.length?<div className={css.empty}>선택기간 평가 관측점 없음 · 수익 0을 뜻하지 않습니다.</div>:d.valuationPage.rows.map(p=><article className={css.judgment} key={p.id}><b>{p.session} 세션 (ET)</b><p>모의 평가액 {paperUsd(p.equityUsd)} · 실제 저장 {paperTime(p.observedAt)}</p></article>)}
 </>;
}

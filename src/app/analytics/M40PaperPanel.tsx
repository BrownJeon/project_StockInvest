'use client';

import { useState } from 'react';
import { useOpsPoll, type PollState } from '@/components/ops/useOpsPoll';
import { Section, StatusChip } from '@/components/ops/ui';
import type { PaperView, PaperViewCycle } from '@/lib/strategy/m40/paper-view-types';
import { paperAction, paperJudgmentRows, paperMode, paperNumber, paperPct, paperReason, paperSignalStatus, paperTime, paperUsd } from './m40-paper-copy';
import css from './M40PaperPanel.module.css';

export const M40_PAPER_URL='/api/research/t156/paper';
export const M40_POLL_OPTIONS={intervalMs:60_000,keepLastOnError:false} as const;
const AREAS=[['collection','수집 상태'],['judgments','종목 판단'],['signals','모의시그널'],['performance','모의성과']] as const;
const STAGES=[['interpretation','해석'],['observation','관찰'],['condition','조건'],['priority','우선순위']] as const;
const SOURCE_KIND:Record<string,string>={raw_quote:'원가격 시세',split_bar:'분할 조정 일봉',sp500_bar:'S&P 500 지수'};
const pctClass=(n:number|null)=>n==null?'':n>0?css.positive:n<0?css.negative:'';

/** Saved-data GET only. Errors discard the previous owner-only DTO. */
export function M40PaperPanel(){
 const poll=useOpsPoll<PaperView>(M40_PAPER_URL,M40_POLL_OPTIONS);
 return <M40PaperView poll={poll} onRefresh={poll.refresh}/>;
}

export function M40PaperView({poll,onRefresh}:{poll:PollState<PaperView>;onRefresh:()=>void}){
 const [query,setQuery]=useState('');const [filter,setFilter]=useState('all');
 // Do not display private values from a stale/error object even if a caller retained one.
 const d=poll.status==='ok'?poll.data:null;
 const current=d?.currentCycle??null;
 const previous=current?.mode==='blocked'?d?.lastUsableCycle??null:null;
 const cycle=current?.mode==='blocked'?previous:current;
 const rows=paperJudgmentRows(cycle,query,filter);
 const failure=poll.error==='unauthorized'?'로그인이 필요합니다':poll.error==='http_403'?'조회 권한이 없습니다':'조회하지 못했습니다';
 const unavailable=()=> <div className={css.empty} role={poll.status==='error'?'alert':'status'} aria-busy={poll.status==='loading'}>{poll.status==='error'?<><b>{failure}</b><br/>접근이 허용된 계정에서 다시 확인해 주세요. 저장된 비공개 자료는 표시하지 않습니다.<br/><button className={css.refresh} onClick={onRefresh}>다시 조회</button></>:<>불러오는 중…<br/>저장 자료를 조회하고 있습니다. 수집 또는 분석을 새로 실행하지 않습니다.</>}</div>;
 const cycleNote=previous?<p className={css.hint}><b>이전 저장분 · {previous.session} 세션</b><br/>{paperMode(previous.mode)} · 저장 분석 기준 {paperTime(previous.decisionAt)}. 최신 회차 결과가 아닙니다.</p>:null;
 return <div className={css.body}>
  <p className={css.summary}><StatusChip kind="partial">모의 전용</StatusChip> <StatusChip kind={current?.mode==='blocked'?'blocked':'unknown'}>{paperMode(current?.mode)}</StatusChip><br/>실주문 없음 · 제한 후보군 · 전진성과와 분리<br/>새로고침은 저장 자료만 다시 읽습니다.</p>
  {current?.mode==='blocked'&&<div className={`${css.notice} ${css.blocked}`} role="status"><b>최신 회차 처리 차단 · {current.session} 세션</b><br/>{paperReason(current.errorCode)}<br/>저장 분석 기준 {paperTime(current.decisionAt)}{!previous&&<><br/>표시할 이전 저장분도 없습니다.</>}</div>}
  <nav className={css.nav} aria-label="M40 상세 영역">{AREAS.map(([id,label])=><a key={id} href={`#m40-${id}`}>{label}</a>)}</nav>
  <div className={css.grid}>
   <div className={css.section} id="m40-collection"><Section id="m40-h-collection" title="수집 상태">
    {!d?unavailable():!cycle?<div className={css.empty}>아직 저장된 분석 회차가 없습니다. 수집 결과를 0으로 간주하지 않습니다.</div>:<>{cycleNote}<Collection cycle={cycle}/><button className={css.refresh} onClick={onRefresh}>새로고침</button></>}
   </Section></div>
   <div className={css.section} id="m40-judgments"><Section id="m40-h-judgments" title="종목 판단">
    {!d?unavailable():!cycle?<div className={css.empty}>아직 종목 판단 기록이 없습니다.</div>:<>{cycleNote}<div className={css.filters}><label>종목 <input aria-label="모의 종목 코드" value={query} placeholder="NAS:AAPL" onChange={e=>setQuery(e.target.value)}/></label><label>판단 <select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">전체</option><option value="selected">선정</option><option value="excluded">미선정·제외</option></select></label></div>
     <p className={css.hint}>M40 기본 규칙 · 판단 대상 {paperNumber(paperJudgmentRows(cycle).length)}종목<br/>참조 후보군과 추가 모의 보유 종목은 다를 수 있습니다. 적격·순위·상위 선정과 실제 모의 매매 판단은 별개입니다.</p>
     {cycle.warnings.filter(w=>!w.symbol).map((w,i)=><p key={`g${i}`} className={css.hint}>{paperReason(w.code)}</p>)}<details><summary>판단 에이전트 4단계 기록</summary>{STAGES.map(([id,label])=>{const j=cycle.judgments.find(r=>r.stage===id);return <p key={id} className={css.hint}>{label}: {j?`${j.status==='shadow'?'참고 판단 기록':j.status==='unknown'?'판단 미확인':j.status==='skipped'?'건너뜀':'저장 상태 '+j.status} · ${paperReason(j.reason)}`:'단계 기록 없음 · 호출 여부 미확인'}</p>;})}<p className={css.hint}>참고 판단은 M40 기본 매매를 변경하지 않습니다.</p></details>
     {rows.length===0?<div className={css.empty}>조건에 맞는 종목 기록이 없습니다.</div>:rows.map(r=><article key={r.symbol} className={css.judgment}><div className={css.head}><b>{r.symbol}</b><StatusChip kind={r.candidate?.selected?'partial':'unknown'}>{r.candidate?.selected?'선정':'미선정·제외'}</StatusChip></div><p>모멘텀 {r.candidate?.momentum==null?'산출 불가':paperPct(r.candidate.momentum*100)} · 순위 {r.candidate?.rank==null?'대상 아님':paperNumber(r.candidate.rank)}</p><p><b>매매 판단: {r.candidate?.selected&&!r.decision?'선정됐지만 저장된 매매 의도 없음':paperAction(r.decision?.action)}</b></p><p>{paperReason(r.decision?.reason??r.candidate?.reason)}</p>{r.warnings.map((w,i)=><p key={`w${i}`}>{paperReason(w.code)}</p>)}{r.candidate?.selected&&!r.decision&&!r.warnings.length&&<p>가용 모의현금·보유·교체일 등의 상세 제약 사유는 제공 자료에서 미확인입니다.</p>}<details><summary>판단 상세 보기</summary><p>평가 적격: {r.eligibility?r.eligibility.eligible?'적격':'조건 미충족':'미확인'} · 고정 후보군: {r.eligibility?r.eligibility.inFrozenCohort?'포함':'미포함':'미확인'}</p><p>후보 판단: {paperReason(r.candidate?.reason)}</p>{r.eligibility?.issues.map((issue,i)=><p key={i}>{paperReason(issue)}</p>)}<p>의도 수량: {r.decision?.quantity==null?'미확인':`${paperNumber(r.decision.quantity)}주`} · {paperMode(cycle.mode)}</p></details></article>)}
    </>}
   </Section></div>
   <div className={css.section} id="m40-signals"><Section id="m40-h-signals" title="모의시그널">
    {!d?unavailable():<><p className={css.hint}>전용 모의 원장의 최근 {d.signals.length}개 기록입니다. 리허설 기록은 미체결이며 전진 시그널과 구분합니다. 실제 주문·체결이 아닙니다.</p>{!d.signals.length?<div className={css.empty}>아직 모의시그널 기록이 없습니다.</div>:d.signals.map(s=><article className={css.judgment} key={s.id}><div className={css.head}><b>{s.symbol}</b><span className={s.side==='buy'?css.positive:css.negative}>{paperAction(s.side)}</span></div><p>{paperMode(s.mode)} · {paperSignalStatus(s.status)}</p><p>{paperReason(s.reason)}</p><p>의도 {s.quantity==null?'수량 미확인':`${paperNumber(s.quantity)}주`} · 예정 개장 {s.executeSession??'미확인'} 세션 (ET)</p><details><summary>모의 기록 상세</summary><p>기준 세션 {s.session} · 실제 기록 {paperTime(s.createdAt)}</p>{s.outcome?<><p>{paperReason(s.outcome.reason)} · 모형 수량 {paperNumber(s.outcome.quantity)}주</p><p>모형 가격 {paperUsd(s.outcome.priceUsd)} · 모형 수수료 {paperUsd(s.outcome.feeUsd)}</p><p>결제 세션 {s.outcome.settlementSession??'미확인'} · 관측 {paperTime(s.outcome.observedAt)}</p></>:<p>모형 체결 결과 없음 · 실제 체결로 간주하지 않습니다.</p>}</details></article>)}<p className={css.hint}>모형 비용: 매수 0.25% + 매도 0.25% (편도). 다음 개장 고정 수량 평가 모형이며 실제 경매 체결·수익을 보장하지 않습니다.</p></>}
   </Section></div>
   <div className={css.section} id="m40-performance"><Section id="m40-h-performance" title="모의성과">
    {!d?unavailable():<Performance data={d}/>}
   </Section></div>
  </div>
 </div>;
}

function Collection({cycle}:{cycle:PaperViewCycle}){
 const c=cycle.collection;
 return <><div className={css.source}><b>참조 {paperNumber(c.referenceCount)} · 평가 적격 {paperNumber(c.qualifiedCount)}</b><p>가격 세션 {cycle.session} (ET)</p><p>마지막 저장 분석 기준 {paperTime(cycle.decisionAt)} · 수집 완료 시각과 별개</p><p>실제 수신 집계 {paperTime(c.actualReceiptAt)} · 원문 공개 시각 미확인</p><p>공시 수집 미확인 · 뉴스 수집 미확인</p></div>{c.sources.length?c.sources.map(s=><div className={css.source} key={`${s.sourceId}-${s.kind}-${s.sourceVariant}`}><b>{SOURCE_KIND[s.kind]??'출처 종류 미확인'} · {s.sourceId}</b><p>{paperNumber(s.symbolCount)}종목 · {paperNumber(s.observations)}관측 · 최신 {s.latestSession} 세션 (ET)</p><details><summary>출처 수신·가용 시각</summary><p>최초 수신 {paperTime(s.firstReceiptAt)}<br/>최종 수신 {paperTime(s.lastReceiptAt)}<br/>최종 가용 {paperTime(s.lastAvailableAt)}<br/>원문 공개 시각 미확인</p></details></div>):<p className={css.hint}>검증된 출처 집계 미확인. 수집 성공으로 간주하지 않습니다.</p>}{c.issues.map((issue,i)=><p key={i} className={css.hint}>{paperReason(issue)}</p>)}<p className={css.hint}>M40은 제한된 후보군의 모의분석입니다. 전체 시장 분석·실매매 적격 판정이 아닙니다.</p></>;
}
function Performance({data:d}:{data:PaperView}){
 const p=d.performance;const rehearsal=d.currentCycle?.mode==='rehearsal';
 return <><p className={css.hint}><b>{p.status==='not_started'?'전진 모의투자 · 아직 시작 기록 없음':p.status==='insufficient_points'?'전진 모의투자 · 성과 관측점 부족':'전진 모의투자 · 관측 성과'}</b><br/>전진 관측 {p.points.length}점 · 최초 전진 평가액 기준. 리허설을 전진성과에 합치지 않습니다.</p><div className={css.metrics}>{[['수익률',p.returnPct],['연환산 수익률 (CAGR)',p.cagrPct],['관측 최대 낙폭 (MDD)',p.maxDrawdownPct]].map(([label,value])=><div key={String(label)} className={css.metric}><span>{label}</span><strong className={pctClass(value as number|null)}>{paperPct(value as number|null)}</strong></div>)}<div className={css.metric}><span>실현·미실현 손익</span><strong>분리 계산 미지원</strong></div></div><p className={css.hint}>0~1점이면 수익률·MDD는 아직 없습니다. CAGR은 365일 이상 완전한 관측 이력이 필요합니다. 최대 낙폭은 저장 관측점 기준이며 미관측 세션은 미확인입니다.{p.truncated&&' 이력이 잘려 전체 성과 지표를 계산하지 않았습니다.'}</p><details><summary>{rehearsal?'초기 리허설 결과 보기 · 성과 검증 아님':'모의 자산 기준 보기'}</summary><p className={css.hint}>시작 모의자산 {paperUsd(d.account.cloneInvestmentUsd)}<br/>최신 저장 회차 평가액 {paperUsd(d.account.currentEquityUsd)}<br/>{rehearsal?'초기 데이터 흐름 점검 값입니다. 전진성과·실제 수익이 아닙니다.':'최신 회차 값이며 최초 전진 기준 수익과 다를 수 있습니다.'}</p></details><p className={css.hint}>실계좌를 변경하지 않습니다. 표시 금액은 접근이 허용된 본인의 독립 모의계좌입니다.</p></>;
}

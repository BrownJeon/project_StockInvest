import * as ReactNS from 'react';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { M40PaperView,M40_POLL_OPTIONS,M40_PAPER_URL } from '@/app/analytics/M40PaperPanel';
import { applyOutcome,readEnvelope,type PollState } from '@/components/ops/useOpsPoll';
import type { PaperView } from '@/lib/strategy/m40/paper-view-types';
import { syntheticPaperView } from './fixtures/t156-paper-view';
import { paperJudgmentRows,paperReason } from '@/app/analytics/m40-paper-copy';
import { resolveAnalyticsRoute,analyticsQuery,ANALYTICS_SEGMENTS } from '@/app/analytics/route-resolve';
(globalThis as unknown as { React:typeof ReactNS }).React=ReactNS;
const state=(data:PaperView):PollState<PaperView>=>({status:'ok',data,lastOkAt:1,error:null});
const render=(poll:PollState<PaperView>)=>renderToStaticMarkup(h(M40PaperView,{poll,onRefresh:()=>{}}));
describe('T-156 approved M40 saved-data screen',()=>{
 test('new detail stays in today and existing three segments remain',()=>{
 expect(resolveAnalyticsRoute('m40')).toEqual({kind:'detail',seg:'today',detail:'m40'});expect(analyticsQuery({seg:'today',detail:'m40'})).toBe('?tab=m40');expect(ANALYTICS_SEGMENTS.map(s=>s.id)).toEqual(['today','verify','data']);expect(resolveAnalyticsRoute('orders')).toEqual({kind:'redirect',href:'/recommend?tab=log&detail=orders'});
 });
 test('all four areas distinguish selection from trading and rehearsal from forward performance',()=>{
 const html=render(state(syntheticPaperView()));
 for(const label of ['수집 상태','종목 판단','모의시그널','모의성과','선정'])expect(html).toContain(label);
 expect(html).toContain('모의 유지');expect(html).toContain('리허설 기록 · 미체결');expect(html).toContain('아직 시작 기록 없음');expect(html).toContain('판단 모델 꺼짐 또는 정책 버전 미등록 · 모델 미호출');expect(html).toContain('공시 수집 미확인 · 뉴스 수집 미확인');expect(html).not.toContain('0.00%');expect(html).not.toContain('승인하기');
 });
 test.each([401,403,503])('HTTP %s clears owner DTO and stale data cannot render',status=>{
 const prev=state(syntheticPaperView());const next=applyOutcome(prev,readEnvelope<PaperView>(status,{ok:false}),2,M40_POLL_OPTIONS.keepLastOnError);
 expect(next.data).toBeNull();const html=render({...next,data:prev.data});expect(html).not.toContain('NAS:DEMOA');expect(html).not.toContain('12,096');expect(html).toContain(status===403?'조회 권한이 없습니다':status===401?'로그인이 필요합니다':'조회하지 못했습니다');
 });
 test('blocked current remains explicit while previous saved source and judgments are dated',()=>{
 const d=syntheticPaperView();d.lastUsableCycle={...d.currentCycle!,stale:true};d.currentCycle={...d.currentCycle!,id:'blocked',session:'2026-11-09',mode:'blocked',errorCode:'forward_cycle_failed',collection:{...d.currentCycle!.collection,sources:[]},candidates:[],decisions:[],judgments:[],eligibility:[]};
 const html=render(state(d));expect(html).toContain('최신 회차 처리 차단');expect(html).toContain('2026-11-09');expect(html).toContain('이전 저장분');expect(html).toContain('2026-11-06');expect(html).toContain('synthetic_public_prices');
 });
 test('filters search only local saved rows and do not equate selected with buys',()=>{
 const c=syntheticPaperView().currentCycle;expect(paperJudgmentRows(c,'demoa','selected')[0].decision?.action).toBe('hold');expect(paperJudgmentRows(c,'','excluded').map(r=>r.symbol)).toEqual(['NAS:DEMOB']);expect(paperJudgmentRows(c,'absent')).toEqual([]);expect(paperReason('unregistered_new_reason')).toContain('설명 미등록');
 });
 test('loading and empty records never manufacture balances or successful results',()=>{
 expect(render({status:'loading',data:null,error:null,lastOkAt:null})).toContain('불러오는 중');const d=syntheticPaperView();d.currentCycle=null;d.signals=[];d.account.cloneInvestmentUsd=null;d.account.currentEquityUsd=null;const html=render(state(d));expect(html).toContain('아직 저장된 분석 회차가 없습니다');expect(html).toContain('아직 모의시그널 기록이 없습니다');expect(html).not.toContain('USD 0');expect(M40_PAPER_URL).toBe('/api/research/t156/paper');
 });
 test('selected without a buy shows its saved cash constraint without inventing an order',()=>{
 const d=syntheticPaperView();d.currentCycle!.decisions=[];d.currentCycle!.warnings=[{symbol:'NAS:DEMOA',code:'insufficient_settled_cash'}];
 const html=render(state(d));expect(html).toContain('선정됐지만 저장된 매매 의도 없음');expect(html).toContain('결제된 모의현금·수수료 포함 예산으로 1주 매수 불가');expect(html).not.toContain('상세 제약 사유는 제공 자료에서 미확인');
 });

});

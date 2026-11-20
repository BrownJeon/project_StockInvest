/** T-178 — approved demo v1 (mockups/T-178-m40-blocked-reason-copy-v1.html, D1-A · D2-B) copy for the blocked-cycle banner.
 * Expected strings below were generated from the designer guide (task file `## Designer` 10:48), not from the implementation. */
import * as ReactNS from 'react';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { M40PaperView,type PaperArea,type PaperPerformanceView } from '@/app/analytics/M40PaperPanel';
import type { PollState } from '@/components/ops/useOpsPoll';
import type { PaperView } from '@/lib/strategy/m40/paper-view-types';
import { syntheticPaperView } from './fixtures/t156-paper-view';
import { paperBlockedReason,paperReason,paperTime,PAPER_BLOCKED_FAMILIES,PAPER_BLOCKED_CONSEQUENCE } from '@/app/analytics/m40-paper-copy';
(globalThis as unknown as { React:typeof ReactNS }).React=ReactNS;
const state=(data:PaperView):PollState<PaperView>=>({status:'ok',data,lastOkAt:1,error:null});
const render=(d:PaperView,area:PaperArea='collection',view:PaperPerformanceView='observed')=>renderToStaticMarkup(h(M40PaperView,{poll:state(d),onRefresh:()=>{},initialArea:area,initialPerformanceView:view})).replace(/<wbr\/>/g,'');
const BLOCKED_AT='2026-11-10T11:50:00.000000Z';
/** Latest cycle blocked on 2026-11-09 (ET); the synthetic 2026-11-06 cycle stays as the previous saved one unless `withPrevious` is false. */
function blocked(errorCode:string|null,withPrevious=true):PaperView{const d=syntheticPaperView();d.lastUsableCycle=withPrevious?{...d.currentCycle!,stale:true}:null;d.currentCycle={...d.currentCycle!,id:'blocked',session:'2026-11-09',decisionAt:BLOCKED_AT,mode:'blocked',errorCode,collection:{...d.currentCycle!.collection,sources:[]},candidates:[],decisions:[],judgments:[],eligibility:[]};return d;}
const REASON:Record<string,string>={"forward_cycle_failed": "분류되지 않은 이유로 회차 처리가 멈춤 · 다음 회차에 다시 시도 · 반복되면 확인 필요", "forward_pair_events_unreviewed_material_filing": "버크셔(BRK.B) 최근 14일 SEC 공시 중 아직 검토하지 않은 공시가 있어, 분할 같은 가격 기준 변화가 없는지 확인하지 못함 · 그 공시가 14일을 지나거나 검토를 마친 목록이 배포된 뒤의 다음 세션부터 풀림 · 이미 차단된 세션은 복구되지 않음", "forward_pair_prior_conflict_requires_review": "같은 세션의 앞선 처리에서 BRK.B 근거가 「검토 필요」로 격리돼 이 세션은 다시 처리하지 않음 · 다음 세션에 새로 확인(원인이 남아 있으면 다시 차단)", "forward_pair_events_known_or_unclassified_action_requires_reconciliation": "Alpaca 기업행동 조회에 BRK.B 항목(분할·배당 등)이 있어 가격 기준과 대조해야 함 · 조회 기간이 길어 저절로 사라지지 않으며, 대조를 마칠 때까지 계속 차단", "forward_pair_events_sec_recent_coverage_incomplete": "받은 SEC 공시 목록이 최근 14일을 다 덮지 못해 버크셔 최근 공시 전체를 확인하지 못함 · 다음 회차에 다시 시도 · 반복되면 확인 필요", "forward_pair_kis_identity_invalid": "KIS의 BRK.B 일봉 응답이 오류·빈 값이거나 종목 식별이 맞지 않아 가격 대조를 하지 못함 · 다음 회차에 다시 시도 · 지금 할 일 없음", "forward_pair_cached_authorization_unavailable": "저장된 KIS 접속 토큰이 없거나 곧 만료돼 BRK.B 가격 대조를 하지 못함 · 다른 작업이 토큰을 갱신하면 다음 회차에 다시 시도 · 지금 할 일 없음", "forward_pair_sec_snapshot_unavailable": "SEC 공시 목록을 받지 못해 버크셔 최근 공시를 확인하지 못함 · 다음 회차에 다시 시도 · 지금 할 일 없음", "forward_pair_source_evidence_unavailable": "BRK.B 가격 근거를 확인하던 중 분류되지 않은 오류로 멈춤 · 다음 회차에 다시 시도 · 반복되면 확인 필요", "forward_pair_profile_required": "BRK.B 근거 조회용 접속 설정을 읽지 못함 · 운영 설정을 고칠 때까지 계속 차단", "paper_current_basis_observation_missing": "모의 보유 종목 중 이번 세션 분할 조정 종가가 없는 종목이 있어 보유 수량 기준을 갱신하지 못함 · 그 가격이 수집되면 다음 회차에 다시 시도 · 지금 할 일 없음", "paper_corporate_action_reconciliation_required": "모의 보유 종목의 과거 분할 조정 종가가 저장된 기준과 달라짐(분할·정정 가능성) · 수량을 추정으로 바꾸지 않고, 확인할 때까지 계속 차단", "paper_source_event_evidence_stale": "BRK.B 사건 확인 자료의 미국 날짜가 저장 시점과 달라짐(확인 뒤 날짜가 바뀜) · 다음 세션에 새로 확인 · 지금 할 일 없음", "paper_publication_deadline_elapsed": "다음 개장 시각이 지나 이 세션 결과를 저장할 수 없음 · 이 세션은 누락으로 남고 다음 세션은 따로 처리 · 지금 할 일 없음", "paper_lease_or_revision_conflict": "처리 중 다른 실행이 모의계좌를 바꿨거나 처리 권한 시간이 끝남 · 다음 회차에 다시 시도 · 지금 할 일 없음", "m40_forward_requires_dry_run": "서버 공용 실거래여부가 꺼져 있음(주문 차단)을 확인하지 못해 모의 처리를 멈춤 · 실거래로 전환한 상태라면 의도된 멈춤이며, 이 화면 때문에 설정을 바꿀 필요 없음", "forward_completed_session_unknown": "거래일 달력으로 처리할 세션을 정하지 못함 · 달력 자료를 고칠 때까지 계속될 수 있음"};
const FAMILY:Record<string,string>={"forward_pair_events_sec_": "받은 SEC 공시 목록의 시각·형식·회사 식별이 기대와 달라 근거로 쓰지 못함 · 다음 회차에 다시 시도 · 반복되면 확인 필요", "forward_pair_events_": "BRK.B 기업행동 조회 응답의 시각·형식·페이지가 기대와 달라 근거로 쓰지 못함 · 다음 회차에 다시 시도 · 반복되면 확인 필요", "paper_publication_": "결과 저장 기한·시계를 확인하지 못해 이 세션 결과를 저장하지 않음 · 다음 세션은 따로 처리", "forward_calendar_": "거래일 달력으로 처리할 세션을 정하지 못함 · 달력 자료를 고칠 때까지 계속될 수 있음", "paper_settlement_": "모의 시그널 생성이나 결제일 계산에 필요한 입력 조건이 맞지 않음 · 확인할 때까지 계속될 수 있음", "forward_source_": "후보 종목 일봉 원천을 받지 못했거나, 받은 원문의 형식·해시가 맞지 않음 · 다음 회차에 다시 시도 · 반복되면 확인 필요", "forward_index_": "시장 지수(S&P 500) 이력을 받거나 검증하지 못함 · 다음 회차에 다시 시도 · 지금 할 일 없음", "forward_pair_": "BRK.B 원가격·분할 조정 가격의 원천 확인(수신·시각·형식·설정)을 마치지 못함 · 대부분 다음 회차에 다시 시도 · 반복되면 확인 필요", "paper_source_": "수집 원문을 보관하거나 다시 읽어 검증하지 못함 · 다음 회차에 다시 시도 · 반복되면 확인 필요", "paper_signal_": "모의 시그널 생성이나 결제일 계산에 필요한 입력 조건이 맞지 않음 · 확인할 때까지 계속될 수 있음", "m40_forward_": "모의 전용 안전 조건을 만족하지 않아 처리를 멈춤 · 운영 확인이 필요할 수 있음", "paper_": "모의계좌 상태·고정 정책·초기 기준이 저장값과 맞지 않음 · 확인할 때까지 계속될 수 있음"};
const MISSING_SESSIONS="선택기간 거래일 중 모의 평가가 없는 날이 있음(처리 차단 등) · 그래서 기간 수익률·평가손익·최대 낙폭을 계산하지 않음";
const CONSEQUENCE='차단된 세션은 모의 시그널·평가액이 없어 모의성과의 누락 거래일이 되고, 누락이 있는 기간은 수익률을 계산하지 않습니다. 실주문과 무관합니다.';
const UNREVIEWED='forward_pair_events_unreviewed_material_filing';

describe('T-178 blocked banner (approved demo v1)',()=>{
 test('1 blocked + previous + unreviewed filing: ET session, approved reason, shared consequence, attempt time, reason code',()=>{
  const html=render(blocked(UNREVIEWED));
  for(const s of ['최신 회차 처리 차단 · 2026-11-09 세션 (ET)',REASON[UNREVIEWED],CONSEQUENCE,`처리 시도 ${paperTime(BLOCKED_AT)}`,`사유 코드 ${UNREVIEWED}`])expect(html).toContain(s);
  for(const s of [`저장 분석 기준 ${paperTime(BLOCKED_AT)}`,'사유 설명 미등록'])expect(html).not.toContain(s);
  expect(PAPER_BLOCKED_CONSEQUENCE).toBe(CONSEQUENCE);
 });
 test.each(['collection','judgments'] as const)('2 previous saved note in %s: ET, why it is shown and the one-day display gap',area=>{
  const html=render(blocked(UNREVIEWED),area);
  for(const s of ['이전 저장분 · 2026-11-06 세션 (ET)','최신 회차가 차단돼 마지막으로 처리된 회차를 보여 줍니다.','날짜가 하루 늦게 보일 수 있습니다.'])expect(html).toContain(s);
  expect(html).not.toContain('최신 회차 결과가 아닙니다');
 });
 test('3 family copy is banner-only: it never leaks into the shared paperReason fallback',()=>{
  const html=render(blocked('forward_source_timeout'));expect(html).toContain(FAMILY.forward_source_);expect(html).toContain('사유 코드 forward_source_timeout');
  expect(paperReason('forward_source_timeout')).toBe('사유 설명 미등록 (forward_source_timeout)');
 });
 test('4 a code outside every family stays unregistered and still shows its code',()=>{const html=render(blocked('zzz_unknown'));expect(html).toContain('사유 설명 미등록 (zzz_unknown)');expect(html).toContain('사유 코드 zzz_unknown');});
 test('5 without a previous saved cycle the note precedes the reason code; a null code draws no code line',()=>{
  const html=render(blocked(UNREVIEWED,false)),note=html.indexOf('표시할 이전 저장분도 없습니다.'),code=html.indexOf('사유 코드');expect(note).toBeGreaterThan(-1);expect(code).toBeGreaterThan(note);
  const none=render(blocked(null));expect(none).toContain('사유 기록 없음');expect(none).not.toContain('사유 코드');
 });
 test.each(['collection','judgments','signals','performance'] as const)('6 a non-blocked latest cycle shows none of the blocked-only lines (%s)',area=>{
  const html=render(syntheticPaperView(),area);for(const s of ['사유 코드','처리 시도',CONSEQUENCE,'최신 회차 처리 차단'])expect(html).not.toContain(s);
 });
});

describe('T-178 paperBlockedReason',()=>{
 test.each(Object.entries(REASON))('7 exact approved copy for %s',(code,text)=>expect(paperBlockedReason(code)).toBe(text));
 test.each([['forward_pair_events_sec_x','forward_pair_events_sec_'],['forward_pair_events_x','forward_pair_events_'],['forward_pair_x','forward_pair_'],['paper_publication_x','paper_publication_'],['paper_settlement_x','paper_settlement_'],['paper_x','paper_'],['forward_calendar_x','forward_calendar_'],['forward_index_x','forward_index_'],['paper_source_x','paper_source_'],['paper_signal_x','paper_signal_'],['m40_forward_x','m40_forward_']])('7 family fallback %s → %s',(code,prefix)=>expect(paperBlockedReason(code)).toBe(FAMILY[prefix]));
 test('7 exact match wins over its family; empty codes have no reason',()=>{expect(paperBlockedReason('paper_publication_deadline_elapsed')).toBe(REASON.paper_publication_deadline_elapsed);expect(paperBlockedReason('paper_publication_deadline_elapsed')).not.toBe(FAMILY.paper_publication_);for(const c of [null,undefined,''])expect(paperBlockedReason(c)).toBe('사유 기록 없음');});
 test('8 longest prefix first: no later prefix extends an earlier one; the families are the approved twelve',()=>{
  const p=PAPER_BLOCKED_FAMILIES.map(([prefix])=>prefix);for(let i=0;i<p.length;i++)for(let j=i+1;j<p.length;j++)expect(p[j].startsWith(p[i])).toBe(false);
  expect(Object.fromEntries(PAPER_BLOCKED_FAMILIES.map(([a,b])=>[a,b]))).toEqual(FAMILY);
 });
});

describe('T-178 D2-B missing_sessions',()=>{
 test('9 performance tab explains missing sessions instead of an unregistered code',()=>{
  const d=syntheticPaperView();d.observation={...d.observation,issues:['missing_sessions']};const html=render(d,'performance');
  expect(html).toContain(MISSING_SESSIONS);expect(html).not.toContain('사유 설명 미등록 (missing_sessions)');
 });
});

import type { PaperViewCycle } from '@/lib/strategy/m40/paper-view-types';
const REASONS:Record<string,string>={
 account_start_unknown:'전진 모의투자 시작 세션 미확인 · 예상·누락 거래일을 확정하지 않음',before_account_start:'선택기간은 전진 모의투자 시작 전 · 시작 전 세션은 관측 대상에서 제외',account_started_during_period:'선택기간 도중 전진 모의투자 시작 · 시작 이후 세션만 관측 대상',
 symbol_owned_by_other_strategy:'다른 전략 귀속 모의 보유분 보존 · 신규 매수 안 함',account_slot_limit:'모의계좌 최대 5종목 한도로 신규 매수 안 함',insufficient_settled_cash:'결제된 모의현금·수수료 포함 예산으로 1주 매수 불가',entry_quote_unknown:'신규 진입 수량 산정용 현재 원가격 미확인',symbol_history_missing:'필요한 127개 분할 조정 종가 부족',market_history_missing:'시장 지수 200거래일 이력 부족',universe_incomplete:'후보군 완전성 미확인',invalid_account_input:'모의계좌 입력 조건 미충족',invalid_session_input:'세션·판단 기준 시각 조건 미충족',invalid_price_observation:'가격 관측 조건 미충족',invalid_raw_quote:'원가격 시세 조건 미충족',membership_unknown:'구성 종목 여부 미확인',holding_membership_missing:'모의 보유 종목의 구성 근거 미확인',
 data_unknown:'필요한 자료 미확인',known_ineligible:'평가 조건 미충족',confirmed_membership_end:'구성 종목 이탈 확인',verified_listing_after_lookback:'상장 이력이 필요 기간보다 짧음',positive_126_session_momentum:'126거래일 모멘텀 양수',momentum_not_positive:'모멘텀이 양수가 아님',scheduled_top5_entry:'교체일 상위 5종목 신규 진입',market_gate_failed:'시장 추세 조건 미충족',outside_top5:'상위 5종목 밖',data_unknown_hold:'자료 미확인으로 모의 보유 유지',between_reviews:'정기 교체일 사이 · 모의 보유 유지',selected_retained_without_reweighting:'선정 종목 유지 · 비중 재조정 없음',
 model_disabled_or_unversioned:'판단 모델 꺼짐 또는 정책 버전 미등록 · 모델 미호출',no_intervention_condition:'개입 조건 없음 · 모델 미호출',no_eligible_evidence:'사용 가능한 근거 없음',documented_initial_history_gap:'초기 수집에서 필요한 이력 부족 확인',insufficient_history:'필요한 기간의 일봉 부족',next_open_deadline_elapsed:'다음 개장 처리 기한 경과',forward_cycle_failed:'회차 처리 실패',modeled_next_open:'다음 개장 가격의 모형 체결',
};
export const paperReason=(code:string|null|undefined)=>code?REASONS[code]??`사유 설명 미등록 (${code})`:'사유 기록 없음';
export const paperMode=(mode:string|undefined)=>mode==='forward'?'전진 모의투자':mode==='rehearsal'?'초기 리허설':mode==='blocked'?'처리 차단':'모드 미확인';
export const paperNumber=(n:number|null|undefined,digits=0)=>n!=null&&Number.isFinite(n)?n.toLocaleString('ko-KR',{maximumFractionDigits:digits}):'미확인';
export const paperPct=(n:number|null|undefined)=>n!=null&&Number.isFinite(n)?`${n>0?'+':''}${n.toFixed(2)}%`:'아직 없음';
export const paperUsd=(n:number|null|undefined)=>n!=null&&Number.isFinite(n)?`USD ${paperNumber(n,2)}`:'미확인';
export function paperTime(at:string|null|undefined):string {if(!at||!Number.isFinite(Date.parse(at)))return '미확인';return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(at))+' KST';}
export function paperJudgmentRows(cycle:PaperViewCycle|null,query='',filter='all'){
 if(!cycle)return [];
 const symbols=[...new Set([...cycle.eligibility.map(r=>r.symbol),...cycle.candidates.map(r=>r.symbol),...cycle.decisions.map(r=>r.symbol)])];
 return symbols.map(symbol=>({symbol,eligibility:cycle.eligibility.find(r=>r.symbol===symbol),candidate:cycle.candidates.find(r=>r.symbol===symbol),decision:cycle.decisions.find(r=>r.symbol===symbol),warnings:cycle.warnings.filter(r=>r.symbol===symbol)}))
 .filter(r=>r.symbol.toLowerCase().includes(query.trim().toLowerCase())&&(filter==='all'||(filter==='selected'?r.candidate?.selected===true:r.candidate?.selected!==true)));
}
export const paperAction=(action:string|undefined)=>action==='buy'?'모의 매수':action==='sell'?'모의 매도':action==='hold'?'모의 유지':'매매 판단 기록 없음';
export const paperSignalStatus=(status:string)=>({rehearsal:'리허설 기록 · 미체결',awaiting_open:'다음 개장 모형 평가 대기',filled:'모형 체결',expired:'만료 · 미체결',blocked:'차단 · 미체결'}[status]??'상태 미확인');

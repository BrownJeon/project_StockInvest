import type { PaperViewCycle } from '@/lib/strategy/m40/paper-view-types';
const REASONS:Record<string,string>={
 account_start_unknown:'전진 모의투자 시작 세션 미확인 · 예상·누락 거래일을 확정하지 않음',before_account_start:'선택기간은 전진 모의투자 시작 전 · 시작 전 세션은 관측 대상에서 제외',account_started_during_period:'선택기간 도중 전진 모의투자 시작 · 시작 이후 세션만 관측 대상',
 symbol_owned_by_other_strategy:'다른 전략 귀속 모의 보유분 보존 · 신규 매수 안 함',account_slot_limit:'모의계좌 최대 5종목 한도로 신규 매수 안 함',insufficient_settled_cash:'결제된 모의현금·수수료 포함 예산으로 1주 매수 불가',entry_quote_unknown:'신규 진입 수량 산정용 현재 원가격 미확인',symbol_history_missing:'필요한 127개 분할 조정 종가 부족',market_history_missing:'시장 지수 200거래일 이력 부족',universe_incomplete:'후보군 완전성 미확인',invalid_account_input:'모의계좌 입력 조건 미충족',invalid_session_input:'세션·판단 기준 시각 조건 미충족',invalid_price_observation:'가격 관측 조건 미충족',invalid_raw_quote:'원가격 시세 조건 미충족',membership_unknown:'구성 종목 여부 미확인',holding_membership_missing:'모의 보유 종목의 구성 근거 미확인',
 data_unknown:'필요한 자료 미확인',known_ineligible:'평가 조건 미충족',confirmed_membership_end:'구성 종목 이탈 확인',verified_listing_after_lookback:'상장 이력이 필요 기간보다 짧음',positive_126_session_momentum:'126거래일 모멘텀 양수',momentum_not_positive:'모멘텀이 양수가 아님',scheduled_top5_entry:'교체일 상위 5종목 신규 진입',market_gate_failed:'시장 추세 조건 미충족',outside_top5:'상위 5종목 밖',data_unknown_hold:'자료 미확인으로 모의 보유 유지',between_reviews:'정기 교체일 사이 · 모의 보유 유지',selected_retained_without_reweighting:'선정 종목 유지 · 비중 재조정 없음',
 model_disabled_or_unversioned:'판단 모델 꺼짐 또는 정책 버전 미등록 · 모델 미호출',no_intervention_condition:'개입 조건 없음 · 모델 미호출',no_eligible_evidence:'사용 가능한 근거 없음',documented_initial_history_gap:'초기 수집에서 필요한 이력 부족 확인',insufficient_history:'필요한 기간의 일봉 부족',next_open_deadline_elapsed:'다음 개장 처리 기한 경과',modeled_next_open:'다음 개장 가격의 모형 체결',
 // T-178 v1 — 차단 사유(정확 일치). forward_cycle_failed 는 교체.
 forward_cycle_failed:'분류되지 않은 이유로 회차 처리가 멈춤 · 다음 회차에 다시 시도 · 반복되면 확인 필요',
 forward_pair_events_unreviewed_material_filing:'버크셔(BRK.B) 최근 14일 SEC 공시 중 아직 검토하지 않은 공시가 있어, 분할 같은 가격 기준 변화가 없는지 확인하지 못함 · 그 공시가 14일을 지나거나 검토를 마친 목록이 배포된 뒤의 다음 세션부터 풀림 · 이미 차단된 세션은 복구되지 않음',
 forward_pair_prior_conflict_requires_review:'같은 세션의 앞선 처리에서 BRK.B 근거가 「검토 필요」로 격리돼 이 세션은 다시 처리하지 않음 · 다음 세션에 새로 확인(원인이 남아 있으면 다시 차단)',
 forward_pair_events_known_or_unclassified_action_requires_reconciliation:'Alpaca 기업행동 조회에 BRK.B 항목(분할·배당 등)이 있어 가격 기준과 대조해야 함 · 조회 기간이 길어 저절로 사라지지 않으며, 대조를 마칠 때까지 계속 차단',
 forward_pair_events_sec_recent_coverage_incomplete:'받은 SEC 공시 목록이 최근 14일을 다 덮지 못해 버크셔 최근 공시 전체를 확인하지 못함 · 다음 회차에 다시 시도 · 반복되면 확인 필요',
 forward_pair_kis_identity_invalid:'KIS의 BRK.B 일봉 응답이 오류·빈 값이거나 종목 식별이 맞지 않아 가격 대조를 하지 못함 · 다음 회차에 다시 시도 · 지금 할 일 없음',
 forward_pair_cached_authorization_unavailable:'저장된 KIS 접속 토큰이 없거나 곧 만료돼 BRK.B 가격 대조를 하지 못함 · 다른 작업이 토큰을 갱신하면 다음 회차에 다시 시도 · 지금 할 일 없음',
 forward_pair_sec_snapshot_unavailable:'SEC 공시 목록을 받지 못해 버크셔 최근 공시를 확인하지 못함 · 다음 회차에 다시 시도 · 지금 할 일 없음',
 forward_pair_source_evidence_unavailable:'BRK.B 가격 근거를 확인하던 중 분류되지 않은 오류로 멈춤 · 다음 회차에 다시 시도 · 반복되면 확인 필요',
 forward_pair_profile_required:'BRK.B 근거 조회용 접속 설정을 읽지 못함 · 운영 설정을 고칠 때까지 계속 차단',
 paper_current_basis_observation_missing:'모의 보유 종목 중 이번 세션 분할 조정 종가가 없는 종목이 있어 보유 수량 기준을 갱신하지 못함 · 그 가격이 수집되면 다음 회차에 다시 시도 · 지금 할 일 없음',
 paper_corporate_action_reconciliation_required:'모의 보유 종목의 과거 분할 조정 종가가 저장된 기준과 달라짐(분할·정정 가능성) · 수량을 추정으로 바꾸지 않고, 확인할 때까지 계속 차단',
 paper_source_event_evidence_stale:'BRK.B 사건 확인 자료의 미국 날짜가 저장 시점과 달라짐(확인 뒤 날짜가 바뀜) · 다음 세션에 새로 확인 · 지금 할 일 없음',
 paper_publication_deadline_elapsed:'다음 개장 시각이 지나 이 세션 결과를 저장할 수 없음 · 이 세션은 누락으로 남고 다음 세션은 따로 처리 · 지금 할 일 없음',
 paper_lease_or_revision_conflict:'처리 중 다른 실행이 모의계좌를 바꿨거나 처리 권한 시간이 끝남 · 다음 회차에 다시 시도 · 지금 할 일 없음',
 m40_forward_requires_dry_run:'서버 공용 실거래여부가 꺼져 있음(주문 차단)을 확인하지 못해 모의 처리를 멈춤 · 실거래로 전환한 상태라면 의도된 멈춤이며, 이 화면 때문에 설정을 바꿀 필요 없음',
 forward_completed_session_unknown:'거래일 달력으로 처리할 세션을 정하지 못함 · 달력 자료를 고칠 때까지 계속될 수 있음',
 // D2-B — 모의성과 탭 관측 이유 줄(차단 사유 아님, paperReason 으로 그려짐)
 missing_sessions:'선택기간 거래일 중 모의 평가가 없는 날이 있음(처리 차단 등) · 그래서 기간 수익률·평가손익·최대 낙폭을 계산하지 않음',
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
/** T-178 — 차단 배너(errorCode) 전용 계열 기본 문구. 공용 paperReason 폴백에는 쓰지 않는다. 긴 접두 먼저. */
export const PAPER_BLOCKED_FAMILIES:ReadonlyArray<readonly [prefix:string,text:string]>=[
 ['forward_pair_events_sec_','받은 SEC 공시 목록의 시각·형식·회사 식별이 기대와 달라 근거로 쓰지 못함 · 다음 회차에 다시 시도 · 반복되면 확인 필요'],
 ['forward_pair_events_','BRK.B 기업행동 조회 응답의 시각·형식·페이지가 기대와 달라 근거로 쓰지 못함 · 다음 회차에 다시 시도 · 반복되면 확인 필요'],
 ['paper_publication_','결과 저장 기한·시계를 확인하지 못해 이 세션 결과를 저장하지 않음 · 다음 세션은 따로 처리'],
 ['forward_calendar_','거래일 달력으로 처리할 세션을 정하지 못함 · 달력 자료를 고칠 때까지 계속될 수 있음'],
 ['paper_settlement_','모의 시그널 생성이나 결제일 계산에 필요한 입력 조건이 맞지 않음 · 확인할 때까지 계속될 수 있음'],
 ['forward_source_','후보 종목 일봉 원천을 받지 못했거나, 받은 원문의 형식·해시가 맞지 않음 · 다음 회차에 다시 시도 · 반복되면 확인 필요'],
 ['forward_index_','시장 지수(S&P 500) 이력을 받거나 검증하지 못함 · 다음 회차에 다시 시도 · 지금 할 일 없음'],
 ['forward_pair_','BRK.B 원가격·분할 조정 가격의 원천 확인(수신·시각·형식·설정)을 마치지 못함 · 대부분 다음 회차에 다시 시도 · 반복되면 확인 필요'],
 ['paper_source_','수집 원문을 보관하거나 다시 읽어 검증하지 못함 · 다음 회차에 다시 시도 · 반복되면 확인 필요'],
 ['paper_signal_','모의 시그널 생성이나 결제일 계산에 필요한 입력 조건이 맞지 않음 · 확인할 때까지 계속될 수 있음'],
 ['m40_forward_','모의 전용 안전 조건을 만족하지 않아 처리를 멈춤 · 운영 확인이 필요할 수 있음'],
 ['paper_','모의계좌 상태·고정 정책·초기 기준이 저장값과 맞지 않음 · 확인할 때까지 계속될 수 있음'],
];
/** 차단 배너 사유: 정확 일치 → 계열 기본 문구 → 미등록. 코드는 배너가 따로 한 줄로 그린다(D1-A). */
export const paperBlockedReason=(code:string|null|undefined):string=>{
 if(!code)return '사유 기록 없음';
 const exact=REASONS[code];if(exact)return exact;
 const family=PAPER_BLOCKED_FAMILIES.find(([prefix])=>code.startsWith(prefix));
 return family?family[1]:`사유 설명 미등록 (${code})`;
};
/** 모든 차단 회차에 공통인 결과(forward-runtime.ts:309 · paper-view-period.ts:39·48·60). */
export const PAPER_BLOCKED_CONSEQUENCE='차단된 세션은 모의 시그널·평가액이 없어 모의성과의 누락 거래일이 되고, 누락이 있는 기간은 수익률을 계산하지 않습니다. 실주문과 무관합니다.';

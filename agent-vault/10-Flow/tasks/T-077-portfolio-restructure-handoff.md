---
project: StockInvest
status: done
created: 2026-10-24
updated: 2026-10-24
base_ref: 330314e545b5dbfa1c9523ea68f134cc91bb2042
risk_level: R0
tags:
  - type/task
  - domain/restructure
  - domain/strategy
  - domain/safety
related_tasks:
  - T-064-profit-engine-design
  - T-067-profitability-audit
  - T-071-ledger-fill-recovery
  - T-072-validation-gate
  - T-074-cash-flow-ledger
  - T-076-emergency-cancel-partial-fills
---

# T-077 — 운용 인터뷰 기반 개편안과 Claude 인수인계

## 목표

- 사용자 요청: "그럼 이제 클로드에서 작업 진행할 수 있도록 개편안을 작성해줘".
- 수익 경로: 실제 순손익을 측정할 기반과 검증된 분석을 공유 예산·보유 관리·주문 집행에 연결하는 실행 가능한 개편안을 남긴다.
- 산출물은 `docs/design/2026-10-24-portfolio-restructure-plan.md`와 `agent-vault/10-Flow/handoffs/2026-10-24-claude-restructure-handoff.md`다.
- 이번 범위는 문서 작성·읽기 전용 코드 대조·문서 검토다. 구현·운영 DB/설정 변경·주문/취소·알림 발송·커밋/push·배포는 포함하지 않는다.

## 관련 과거 이력 요약

- 요구사항 정본: [[2026-10-23-project-direction-interview]]. 사용자 확정 요구 13개와 10-24 후속 결정을 통합한다. 새로운 점수식·수치까지 사용자 승인으로 확대하지 않는다.
- 기존 설계 [[T-064-profit-engine-design]]와 감사 [[T-067-profitability-audit]]를 대조한다. 최신 인터뷰와 충돌하는 운영 정책은 대체 관계를 명시한다.
- [[T-071-ledger-fill-recovery]]·[[T-072-validation-gate]]·[[T-074-cash-flow-ledger]]·[[T-076-emergency-cancel-partial-fills]]의 기존 구현을 재사용할 수 있는지 확인한다. 과거 감사 지적을 현재 미수정 결함으로 단정하지 않는다.
- [[open-work-inventory-2026-10-24]]는 다른 세션의 정리 자료다. 계좌·운영 수치와 테스트 결과는 원본 시점 한정이며 이번에 실측한 사실로 취급하지 않는다.
- 시작 시점에 소스·역할 설정·문서의 선행 미커밋 변경이 다수 있다. 덮어쓰기·정리·일괄 커밋을 하지 않는다.

## 역할별 지시사항

- Leader: 요구사항 추적표, 정책 대조, 대상 구조, 단계별 작업·검증·롤백, 결정 목록, Claude 시작 지시문 작성. 본문/인수인계/상태 문서만 소유한다.
- Judge: 프로젝트 judge 역할의 도구로 문서 작업 intake와 설계 인수인계 C1 판정 실행. 계좌·잔고·보유·사용자 대화·소스·운영 로그를 외부 요약에 넣지 않는다. 판정 JSON은 변형하지 않는다. 도구 실패/규칙 fallback을 그대로 보고한다. 애플리케이션 파일을 변경하지 않는다.
- 코드 대조 담당: 요청한 좁은 범위의 소스와 task 이력만 읽어 현재 있는 것/없는 것/재확인할 것을 정리한다. 파일 수정·DB/API·테스트/스크립트 실행은 하지 않는다.
- 독립 문서 검토: 작성 완료된 개편안이 인터뷰 요구를 보존하는지와 예산·만료·매수/매도·검증 관문에 모순이 없는지 검토한다. 구현 감사나 실매매 전략 검증 완료로 판정하지 않는다.
- 모든 담당은 공유 저장소에서 다른 작업이 진행 중임을 전제로 하고 다른 사람의 편집을 되돌리지 않는다.

## 진행 기록

- 2026-10-24: 문서 인수인계 작업 접수. HEAD와 dirty 상태를 읽기 전용으로 확인했다. 실제 잔고·설정·운영 건강 상태는 조회하지 않았다.
- 2026-10-24: 기존 모듈과 T-064/T-068/T-070~T-076을 읽기 전용으로 대조해 개편안·인수인계 작성. 문서 검토 3개 보완을 반영했다. 정책 U01~U16·단계 A0~A7·미정 값 C01~C10으로 추적한다.
- 2026-10-24: 독립 문서 재검토 완료, 링크/형식 검사 및 재개 문서 연결. 완료 범위는 문서 산출물이며 실제 구현/운영은 후속이다.

## 판단 기록 (judge)

- [2026-10-24 19:16] intake engine=jev → task_type=docs / risk=R0 / developer_model=sonnet / next=ask_user / demo=none/null / actions=clarify_requirements,assign_developer / blocking_gate=requirements | overrides=없음 | fallback=- | tokens=1427
- 결과 JSON: `docs/design/judge-result-T-077-intake.json`. C1 결과는 아래 기록을 따른다. Codex 내부에서 재귀 Codex 호출은 하지 않으며 필요 시 `override: codex_unavailable_in_codex`를 기록한다.
- [2026-10-24 19:18] Leader 입력 충족 확인: 인터뷰 기록·본 task 목표/산출물로 문서 작성 요구 충족, 운영 수치는 미확정 표시. 기존 intake JSON과 판정은 보존하며 명료화된 기능 요약으로 intake 1회 추가 실행.
- [2026-10-24 19:19] intake/clarified engine=jev → task_type=docs / risk=R0 / developer_model=sonnet / next=ask_user / demo=none/null / actions=clarify_requirements,assign_developer / blocking_gate=requirements | overrides=없음 | fallback=- | tokens=1447. 결과 JSON: `docs/design/judge-result-T-077-intake-clarified.json`.
- [2026-10-24 19:37] Leader: 관련 인터뷰·산출물 경로로 문서 입력 충족 확인, 미정 운영 수치는 확정하지 않은 채 문서 산출물 작성만 진행. 기존 needs_info/next 결과 JSON은 보존한다.
- [2026-10-24 19:38] codex_gate/C1 engine=jev → codex_required=false / mode=null / focus=null / budget_rule=CX-limit-unknown-hold / codex_switch=on | overrides=CX-r0-skip | fallback=- | tokens=910. 결과 JSON: `docs/design/judge-result-T-077-C1.json`. remaining_limit_pct=null이며 재귀 Codex 호출은 수행하지 않았다.

## 접수 입력 충족 확인 (Leader)

- Judge intake 2회는 모두 `needs_info=true / next=ask_user`였으며 원문 JSON을 보존했다. 사용자가 이미 제공한 인터뷰와 문서 요청에 대상·범위·산출물·독자가 있고, 미정 운영 수치를 이번에 확정하지 않는다는 범위를 확인해 **문서 작성만** 계속했다. 같은 내용을 다시 질문하지 않았으며 미정 값은 개편안 C01~C10으로 분리했다. 도구 출력값을 수정하거나 운영 권한을 추가한 것은 아니다.
- 이번 R0는 문서 변경 범위의 판정이다. 미래 자금·주문·보유 관리 구현의 위험 등급이나 Reviewer 승인을 뜻하지 않는다. 구현 task별 Judge·독립 Reviewer·QA를 별도 수행해야 한다.

## 문서 검토

- 2026-10-24 독립 문서 재검토: **문서 적합 — 1차 지적 3건의 보완 확인, 추가 지적 없음**. 검토 범위는 본 task·인터뷰 기록·`docs/design/2026-10-24-portfolio-restructure-plan.md`와 `agent-vault/10-Flow/handoffs/2026-10-24-claude-restructure-handoff.md`이며, 코드 감사·수익성 검증·운영 상태 확인·안전 코드 커밋 승인으로 사용하지 않는다.
- 사용자 결정 보존 확인: 월5% 사건만으로 신규·추가매수 전면 중지하지 않음, 기존 보유의 점수 우선순위 축소, 현재 시장별 자금 구획 유지, 두 시장 합산10종목과 신규 슬롯 예약, 3개월 이후 직접 연장 승인, 미응답 보유·재알림이 본문에 반영돼 있다. 제안 수치와 미정 값, T-071/T-072 재사용, 단계별 검증·운영 승인 경계도 구분돼 있다.
- 지적1 보완 확인 — 개편안 §8.3·§9.2·§12.1에 집중도 축소·월 손실 대응·일반/수동 매도의 공통 수량 선점, 기존 선점/CAS 재사용, 부분체결·결과 불명 정산과 동시 매도 과약정 방지 수용기준이 추가됐다.
- 지적2 보완 확인 — 개편안 §8.1~8.3·§12.1에 현금 조회 시각·스냅샷 ID/버전·주문 반영 근거의 귀속, 송신 직전 재확인과 외부 수동 주문·입출금 변화 시 보류/축소·대사 계약이 추가됐다. 브로커와 DB의 완전한 원자성을 보장하지 않는 한계도 명시됐다.
- 지적3 보완 확인 — 개편안 §7.1·§8.3·§12.1·C04에 신호 유효기간과 3개월 보유기간의 분리, 가설 버전·중요 새 정보 재평가/무효화·송신 직전 검증과 오래된 매수 조건 시험이 추가됐다. 구체 TTL은 검증할 제안 값으로 남아 있다.
- 인수인계 확인 — §3 확정 정책·§4 A0 착수·§5 재사용/주의점·§6 권한 경계·§7 시작 지시문이 본문과 일치한다. 운영·검증 미완료를 문서 인수인계 완료로 확대하지 않으며, 최신 사용자 결정을 과거 정책으로 되돌리지 않는다.

## 최종 요약

### [T-077] Claude에서 이어갈 StockInvest 개편안 작성

- **상태**: 완료 — 개편안·인수인계 문서 범위.
- **무엇이 바뀌었나**: [개편안](../../../docs/design/2026-10-24-portfolio-restructure-plan.md)과 [Claude 인수인계·시작 지시문](../handoffs/2026-10-24-claude-restructure-handoff.md)을 작성했다. 확정 정책·기존 설계 대체 관계·재사용 위치·단계별 작업/수용 기준·미정 값·승인 경계를 구분하고 재개 문서를 연결했다.
- **배포**: 미배포 — 문서 작업이며 커밋/push·운영 변경 없음. 같은 배포에 실린 다른 작업: 없음.
- **AI가 검증한 것**: 지정 코드/기존 task의 정적 대조, 독립 문서 검토와 보완 3건 재검토, Markdown 4개/로컬 링크 13개/정책16개/단계8개/결정목록10개/판정 JSON 3개/상태문서3개 검사 이상 없음, 변경한 추적 상태 문서의 `git diff --check` 통과. 실제 계좌·운영·실행 코드·수익성은 검증하지 않았으며 앱 테스트/빌드는 이번 범위에서 실행하지 않았다.
- **사용자가 확인할 것**: 지금 Claude에서 인수인계 문서 §7의 시작 지시문을 사용한다. Claude가 본 개편안을 읽고 A0 대조 보고서부터 시작하며 이미 확정한 운용 정책을 반복 질문하지 않으면 정상이다.
- **사용자가 결정할 것**: 이번 문서 전달에 추가 결정 없음. 미정 운용 수치는 Claude가 C01~C10의 근거 있는 안을 준비한 뒤 실제 적용 전에 검토한다.
- **남은 일**: Claude의 A0 최신 현황/계좌·정책 대조와 A1~A7 구현·검증·승인된 단계적 운영. T-077의 문서 완료와 구분한다.
- **이슈·위험**: 기존 타 세션 미커밋 변경을 보존했다. 이번 인수인계도 미커밋 파일이므로 향후 reset/clean/배포 작업 전에 보존해야 한다. 문서 검토는 안전 코드 승인·운영 활성화 허가가 아니다.

---
task_id: T-112
title: 실행·판단 기록 기반 — `job_run_log`(실행·상태 기록)와 기준 판단(baseline) 기록 — 문서 단계: DDL 초안·J1 호환 확인
status: planned
priority: high
project: StockInvest
created: 2026-10-30
updated: 2026-10-30
base_ref: origin/main 9d087a4
risk_level: R2
roles_involved: [leader, judge, developer, reviewer, qa]
related_tasks: [T-108-automation-menu-home-overhaul, T-104-cron-jobs-market-grouping, T-114-corporate-intelligence-second-design, T-116-news-first-seen-capture, T-109-research-context-for-analysis]
tags:
  - type/task
  - domain/data
  - domain/cron
  - domain/analysis
aliases:
  - 기록기반
  - job_run_log
waiting: [DDL 초안 검토, 사용자 DDL 적용 승인(건별 직렬), T-104 1단계 순서 결정(DP1 ~11-05)]
demo_gate:
  required: false
  level: "none"
  status: "not_required"
  version: 0
  repo_path: ""
  artifact_url: ""
  content_sha256: ""
  decided_by: "judge"
  rule_id: ""
  approved_by: ""
  approved_at: ""
  approval_quote: ""
  waived_by: ""
  waived_at: ""
  waiver_quote: ""
  active: false
---

# T-112 실행·판단 기록 기반 (문서 단계)

## 목표·배경 (Leader)
**한 문장**: 지금은 남지 않는 두 가지를 DB 에 남기는 기반의 **설계 초안(DDL 문서)**을 만든다 — ① 크론 잡의 실행·상태(`job_run_log`) ② 장마감 분석의 후보와 AI 판단(기준 판단 baseline).

**왜**: 날짜 파일은 성공을 뜻하지 않고(10-26 edgar-sync 사례), 장마감 분석은 후보 목록과 AI 의 BUY/SKIP 을 저장하지 않으며 카드(`signals`)만 남는다([2차 설계서](../../../docs/design/2026-10-28-corporate-intelligence-second-design.md) §9.5·「기준 판단 기록이 없다」). 11-23 킬스위치 판단에 쓰기로 한 증거(후보 사후 성과 · 정상 가동률 · 후보·제외 사유 추이)와 홈 "가동률"이 이 기록 없이는 소급되지 않는다. 4주 관찰 시계가 이미 돌고 있어 기록 시작이 늦을수록 증거 기간이 줄어든다.

## 사용자 지시·승인 (원문 보존)
- 2026-10-28 17:09 결정 ②: **기록 먼저 분리** — 새 기록 기반을 UI 개편보다 먼저(별도 task, DDL 은 그때 승인). 공동 인계서 J1(`job_run_log` 한 테이블)·J4(`judgment_role ∈ {baseline, shadow}`) 채택.
- 2026-10-30 "문서 단계 시작" — 질문은 "문서 단계(지표 계약·기록 DDL 초안)를 지금 시작할까요?". **허용**: 설계 문서·DDL **초안**(문서 안 코드블록) 작성, 코드 읽기, 일회용 서버 밖 시험 설계. **불허**: DDL 적용·`scripts/migrations/` 에 SQL 파일 추가·운영 DB 쓰기·코드 변경·배포·push·운영 DB 조회(U6 병합 승인 절차 전까지 SELECT 도 실행 안 함).
- 통합 계획 §5: "지금 해도 되는 것(문서·데모만) — T-112(기록) DDL 초안과 G-J1 호환 확인". DDL 적용은 **사용자 건별 직렬 승인**(T-112 → 단계 1a 첫 DDL 순).

## 이 단계의 산출물
1. `docs/design/2026-10-30-t112-record-ddl-draft.md` — Developer. `job_run_log`(2차 설계서 §9.5 확정안 기준) + 기준 판단 기록 테이블(설계서 §7 단계 3 필수 필드 대조) DDL 초안, G-J1 호환 표(T-104 판정 · T-108 가동률 · T-114 §9.5/§7 단계 3), 기록 지점(러너 `call()` 사후 후크 · `post-market-*`)과 실패 시 영향 0 원칙, 증가량·인덱스·보존, 적용·시험 절차(일회용 MariaDB), 열린 질문.
2. T-108 지표 계약 초안(`docs/design/2026-10-30-t108-metrics-contract-draft.md`, Analyst)이 이 기록의 필드를 소비한다 — 두 문서는 서로 읽고 이견은 아래 「호환 확인 기록」에 적는다.

## 호환 확인 기록 (G-J1)
(미작성 — 두 초안이 나온 뒤 Leader 가 대조)

## 보호할 것
- 코드·DDL 적용·운영 DB·알림·배포 변경 없음. `src/app/api/cron/**`·`scripts/cron-runner.sh`·`src/lib/strategy/post-market-*` 는 훅 `SAFETY_PATHS` — 구현 단계에서 Reviewer 판정 줄 필수.
- 기록 실패가 수집·분석·주문을 막지 않는다(T-106 `news-health.ts` 의 "절대 던지지 않는다" 원칙과 같다).
- 공동 인계서 §10 관찰 기준선 대장: 기록 추가는 판단 불변(기록 전용) — 구현 때 배포 시각만 남긴다.

## 판단 기록 (judge)
- [2026-10-30 11:48] intake engine=rules → task_type=null · risk=R2 · developer_model=opus · next=demo_first · demo=delta/designer(DM-kw-risky-cta) · actions=prepare_demo,request_demo_approval,assign_developer | overrides=R2-kw-payment,MD-judge-failed-opus,DM-kw-risky-cta | fallback=budget_window_closed | tokens=0
- [2026-10-30 11:50] [재실행 — Leader 요청, 입력 요약 정정] intake engine=rules → task_type=null · risk=R1 · developer_model=opus · next=assign · demo=none/- · actions=assign_developer | overrides=MD-judge-failed-opus | fallback=budget_window_closed | tokens=0
- [11:50] Leader: 첫 intake 의 demo=delta/R2 는 입력 요약 속 "주문"·"추가"(비-UI 문맥)에 걸린 키워드 오탐이다 — 이 task 는 사용자 화면을 만들지 않는다. 입력 요약을 사실 그대로 다시 써 재실행(Leader 요청, 두 줄 모두 보존; `waive` 아님) → demo=none·risk=R1·next=assign. `check.mjs init` 으로 `demo_gate` = not_required 기록. **risk 는 R2 로 유지**(재실행 입력에서 빠진 "DDL 적용은 사용자 건별 승인"·크론 러너/장마감 분석 모듈 수정이 구현 단계에 있고, `src/app/api/cron/**`·`scripts/cron-runner.sh`·`src/lib/strategy/post-market-*` 는 훅 SAFETY_PATHS). developer_model opus 는 복잡도 판정이 아니라 예산 구간 만료 대체 규칙(`MD-judge-failed-opus`).

## Developer

## Reviewer

## QA

## 배포 기록

## 진행 기록
- [2026-10-30 11:45] 접수(Leader). 번호 T-112 는 `ls` 로 비어 있음을 재확인했고 공동 인계서 §11 에 선점 줄을 남겼다. 문서 단계만 — DDL 초안(Developer)·T-108 지표 계약 초안(Analyst) 병렬 시작.

## 최종 요약
(미작성)

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 해당없음 | - | - | judge: none | 10-30 11:50 |

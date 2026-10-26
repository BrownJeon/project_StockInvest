---
task_id: T-096
title: 전략 검증 줄기 P2(합격 기준 사전 등록)+P3(일봉 백테스트) — 설계·사전 등록 초안 먼저, 결과 실행은 기준 확정 뒤
status: doing
priority: high
project: StockInvest
created: 2026-10-26
updated: 2026-10-26
base_ref: 53b97d9
risk_level: R1
roles_involved: [leader, judge, analyst, developer, reviewer, qa]
related_tasks: [T-070-daily-bars-phase0, T-064-profit-engine-design, T-072-validation-gate, T-095-postmortem-script-p1]
tags:
  - type/task
  - domain/profit-engine
  - domain/validation
aliases:
  - 전략검증P2P3
  - 사전등록
waiting: [P2 합격 기준 사용자 확정(초안 완성 뒤), P1(T-095) 완료]
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

# T-096 전략 검증 줄기 — P2 사전 등록 + P3 일봉 백테스트

## 사용자 결정 (2026-10-26 오후, 발화 그대로)

- "P2: 어떤 사용자 등록이 필요해?" → **질문**이다. Leader 해석: "사전 등록"을 "사용자 등록"으로 읽으신 것 같다. P2 = **합격 기준을 결과를 보기 *전에* 파일로 고정(사전 등록)** 하는 것이지 계정·사용자 등록이 아니다. 사용자가 할 일은 초안의 기준(몇 개의 숫자·규칙)을 읽고 확정하는 것뿐이다 — 채팅 답변과 초안 문서 맨 위 요약에 쉬운 말로 적는다.
- "P3: 승인할테니 백테스트 진행해줘" → **P3 착수 승인.** 단 Leader 판단으로 **순서를 지킨다**: ① 백테스트 **엔진 설계·구현은 지금 시작**한다 ② **결과를 보는 실행(전략 합격/불합격을 가르는 실행)은 P2 합격 기준이 사용자 확정을 받은 뒤**에 한다. 근거: 기준을 결과 본 뒤에 정하면 같은 데이터로 사후 합리화·과적합이 된다 — T-064 §6.5 "사전 등록: 실행 전에 전략별 가설·파라미터 그리드·합격 기준을 파일로 고정"과 T-064 §5.5 "(생존편향 규칙) 반영 전에는 합격 기준(D4)을 확정하지 않는다"가 이미 요구한다. 사용자가 이 순서에 반대하면(예: 기준 확정 전에 탐색 실행) 위험(과적합·확증 편향)을 명시하고 지시대로 한다.

## 범위

- **P2(문서)**: [[T-064-profit-engine-design]] §6.5·§6.6(합격 기준 D4·벤치마크 상대 조건·생존편향 할인)과 [[T-070-daily-bars-phase0]] Analyst 검토(§2 rsi-oversold 평가 규칙·§4 P2)를 합쳐 **합격 기준 사전 등록 문서**를 만든다: 지표·기준선·표본 조건·파라미터 상한·결정일·실패 시 규칙. 비전문가가 읽는 5줄 요약 + 사용자가 확정할 항목 표(권고값 포함)를 맨 위에.
- **P3(구현)**: T-064 Phase 2 — 코드 스크리너 + 3년·93종목 일봉 백테스트(§6.1 백테스트=라이브 동일 코드, §6.2 구성, §6.3 체결 모델, §6.4 비용, §6.5 과적합 통제). 후보 전략 전부(일봉 아날로그 포함), 비용 후·기준선 대비. 소유: `src/lib/profit-engine/`(신규, 기존 `src/lib/research/` 와 분리) 등 — Analyst 설계 뒤 확정.
- 이 task 의 1단계는 **Analyst 설계**(사전 등록 초안 + P3 구현 명세 + 규모·토큰 추정). 구현(Developer)은 그 명세를 사용자가 본 뒤.

## 하지 않는 것

기준 확정 전 합격/불합격을 가르는 백테스트 실행, 전략 활성/비활성·승급(`validation_status` 변경) 결정, DB 쓰기·DDL·KIS 호출·앱 API 호출·주문·알림·스위치 변경, push·배포. 읽기 전용 DB 조회(SELECT)만.

## 허용 권한

읽기 전용 DB 조회와 로컬 작업 트리 문서 편집. Analyst 는 `docs/design/` 아래 새 문서만 쓴다.

## 판단 기록 (judge)

## 관련 과거 이력 요약

- [[T-070-daily-bars-phase0]]: `daily_bars` 70,965행·93종목, 사후검증 v1, Analyst 검토(10-24) P1~P5.
- [[T-072-validation-gate]]: 전략 16개 전부 `unvalidated` → 신규 매수 차단. 승급 조건이 P2 와 같은 자리.
- [[T-095-postmortem-script-p1]]: P1(사후검증 도구 보강) 진행 중 — 지표 정의(환율 무관 진입·같은 날 유니버스 초과수익)를 P2 가 같게 쓴다.
- 사용한 교훈 ID: 없음.

## 진행 기록

- 2026-10-26 15:53: Leader 착수. Analyst 설계 투입(사전 등록 초안 + P3 구현 명세).

## Analyst

## Developer

## Reviewer

## QA

## 배포 기록

## Codex 검토

## 최종 요약

(완료 시 Leader 가 작성)

## 데모 검토 (demo gate)

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 해당없음 | - | - | judge: none | - |

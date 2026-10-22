---
task_id: T-073
title: 대시보드 개편 — 오늘의 투자 방향(매수 우호/관망) 표시 + 불필요한 정보 정리
status: todo
priority: high
roles_involved: [leader, analyst, designer, developer, reviewer, qa, deployer, judge]
related_tasks: [T-072, T-070, T-066, T-064, T-049]
tags:
  - type/task
  - domain/dashboard
  - domain/strategy
aliases:
  - 오늘의방향
  - 대시보드개편
created: 2026-10-23
updated: 2026-10-23
base_ref: 1163fe2d9a74e42d516d3f4340220498e9cdcfa9
risk_level: R1
developer_model: opus
waiting: [T-072 완료, 착수 지시]
demo_gate:
  required: true
  level: "full"
  status: "drafting"
  version: 0
  repo_path: ""
  artifact_url: ""
  content_sha256: ""
  decided_by: "judge"
  rule_id: "DM-kw-full"
  approved_by: ""
  approved_at: ""
  approval_quote: ""
  waived_by: ""
  waived_at: ""
  waiver_quote: ""
  active: false
---

# T-073 — 대시보드 개편: 오늘의 투자 방향 + 정보 정리

> **수익 경로 연결(제1원칙)**: 자동매매가 되더라도 사용자가 오늘이 매수 구간인지 관망 구간인지 판단할 근거를 한 화면에서 본다. 단 방향 표시 자체가 예측이므로 **검증되지 않은 채 "매수"를 띄우면 오늘 확인한 문제(근거 없는 시그널)를 화면으로 옮기는 것**이다. 그래서 설계 제약을 아래에 못 박는다.

## 사용자 요구 (2026-10-23, 원문 요지)
- 자동 거래가 되더라도 사용자는 **오늘이 매수 타이밍인지 관망 타이밍인지** 알고 싶다 → 대시보드에 표기.
- 현재 대시보드는 불필요한 정보가 많아 **개선이 필요**하다.
- **순서**: [[T-072-validation-gate]] 등 제안한 작업을 한 뒤 이 개선을 진행한다.

## 선행 조건·순서
1. [[T-072-validation-gate]] 완료(또는 사용자가 순서를 해제).
2. T-070 `daily_bars` 적용 — 필수는 아니지만 있으면 방향 지표를 과거 구간에 적용해 시험할 수 있다(analyst 가 필수 여부 판단).
3. 단계: Leader → **Analyst**(방향 정의·입력·미검증 표기 규칙, 읽기 전용 자문 — 계획서에 반영한 뒤 사용자 승인 요청) → **Designer 데모 v1**(현재 화면 인벤토리·삭제 후보·방향 카드) → **사용자 승인**(승인 전 화면 코드 금지) → Developer → Reviewer → QA → Deployer.
4. 데모 게이트 `full`(담당 designer) — judge 규칙 엔진 `DM-kw-full`. 합성값만 사용(실제 계좌·종목 금지).

## 현재 대시보드 구성 (코드 기준 인벤토리 — Designer 가 실제 화면으로 재확인)
`src/components/dashboard/Dashboard.tsx`(1,227줄) 안: 자동매매 상태 카드(`AutoTradingStatusCard`) · 활성 전략(`ActiveStrategiesSection`) · 보유 종목(`HoldingRow`) · 관심 종목(`WatchRow`) · 장 상태 배지(`MarketBadge`) · '내일' 탭(시나리오 카드) · KPI 박스 · 캔들 차트. 별도 컴포넌트: `MyDecisionSection`(내 결정) · `RecentExecutionsSection`(최근 체결) · `EvalFunnelCard`(평가 깔때기).
**무엇이 '불필요'인지는 Leader 가 정하지 않는다** — 데모에서 삭제·접기 후보를 제시하고 사용자가 고른다.

## 방향 표시 설계 제약 (Leader 초안 — analyst 가 확정, 사용자 승인)
1. **숫자 확률(예: "62%") 표기 금지.** 라벨(예: 매수 우호 / 관망 / 위험 회피) + **근거 항목 체크리스트**로 보인다. 이유: 보정 안 된 점수는 가짜 확률이다(감사 F05: LLM 자기평가 60 ≠ 실측 승률 60%).
2. **검증 상태 배지 필수**(미검증 / 백테스트 / 모의검증). 검증 전에는 기본값이 '관망'이고, '매수 우호'는 '참고용·미검증' 표기 없이는 띄우지 않는다.
3. 입력은 **이미 있는 데이터 우선**: 거시 레짐 게이트 결과 · `market_state` 분류 · 오늘 평가 종목 중 룰 발화 비율(`eval_funnel`) · 보유 종목의 손절가 대비 위치(T-066) · 현금/USD 예수금 · 장 상태. 신규 수집은 최소화.
4. **과거 적용 가능성**: 같은 정의를 `daily_bars` 과거 구간에 적용해 "라벨별 이후 N일 수익 분포"를 보여 줄 수 있어야 라벨의 의미가 검증된다. 이게 안 되면 라벨은 '설명용'일 뿐 판단 근거가 아니라고 화면에 쓴다.
5. 국내·미국을 분리 표시(미국 주력·시간대 다름) — 권고, 사용자 결정.

## 사용자 결정 필요
- 불필요 정보의 기준(데모에서 선택).
- 방향 표기에 숫자 확률을 원하는지(권고: 아니오 — 위 1번 이유).
- 국내·미국 방향을 분리 표시할지(권고: 분리).

## 판단 기록 (judge)
- 2026-10-23 intake(규칙 엔진 `dev-rules@0.5.0`, 외부 전송 없음): 1차 요약("개편·카드 추가")은 `demo none` 으로 나와 **부정확**했다(규칙 엔진 키워드 한계). 화면 구조 재설계라는 실제 성격으로 재접수 → **risk R1, developer opus, demo full(`DM-kw-full`, owner designer), next=demo_first**.

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 작성중 | - | - | judge: full (DM-kw-full) | 10-23 00:05 |

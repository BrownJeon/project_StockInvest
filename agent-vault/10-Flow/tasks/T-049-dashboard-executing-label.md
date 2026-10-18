---
task_id: T-049
title: 대시보드 "주문 실행됨" 표시 문구 정정 — 주문 번호 없는 executing 을 "처리 중/확인 필요"로 (T-043 감사 R-7, T-046 에서 분리)
status: todo
priority: normal
roles_involved: [leader, designer, developer, reviewer, qa]
related_tasks: [T-043, T-046, T-042]
tags:
  - type/task
  - domain/ui
aliases:
  - MyDecisionTab 문구
created: 2026-10-18
updated: 2026-10-18
---

# T-049 — "주문 실행됨" 표시 문구 정정 (화면 작업 · 데모 검토 게이트 대상)

## 배경

T-043 독립 감사(R-7, low)가 지적했다: 대시보드 `MyDecisionTab` 이 **주문 번호 없는 `executing`** 시그널을 "주문 실행됨"으로 보여 준다. 이 성질은 T-042 의 결과 불명 잠금부터 있었고, T-043 의 주문 전 선점(`executing`)으로 "주문 직전/진행 중/멈춤" 상태가 더 자주 생길 수 있다. T-046 으로 카드가 실제로 실행되기 시작하면 오해가 커진다 — "실행됨"인데 실제로는 주문이 안 나갔거나 결과를 모르는 경우.

## 범위(초안)

- `executing` 이고 `consumed_order_id` 가 있으면 "주문 접수됨"(주문 번호 표시), **없으면 "처리 중/확인 필요"** 로 구분. (T-046 C 의 자동 경보와 같은 조건 — `status='executing' AND consumed_order_id IS NULL`)
- 화면 변경이므로 **designer 데모 → 사용자 승인 → 구현**(데모 검토 게이트).

## 결정

- 2026-10-18 사용자가 T-046 에서 **분리해 별도 작업**으로 진행하라고 지시("4. 분리해서 작업해줘"). T-046 과 무관하게 진행 가능, 우선순위는 T-046 배포 이후 카드가 실제로 실행되기 전.

## Leader 기록

- [10-18] 등록. 코드 변경 없음.

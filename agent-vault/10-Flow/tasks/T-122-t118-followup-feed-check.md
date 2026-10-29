---
task_id: T-122
title: T-118 후속 — 피드 겹침 검사(feeds) 정확도 보완 (L-1·L-2·L-3)
status: planned
priority: low
project: StockInvest
created: 2026-10-29
updated: 2026-10-29
base_ref: (T-118 커밋 이후)
risk_level: R2
roles_involved: [leader, developer, reviewer, qa, codex]
related_tasks: [T-118-overseas-peek-expansion, T-116-ci-raw-capture]
tags:
  - type/task
  - domain/data
  - domain/cron
aliases:
  - T118후속
waiting: []
---

# T-122 T-118 후속 — 피드 겹침 검사 정확도 보완

## 배경 (Leader)
T-118 Reviewer(독립 감사, 2026-10-29)가 낸 Low 3건을 이번 T-118 커밋에서 고치지 않고 후속으로 분리했다. 셋 다 관측 전용 상태 필드(`ci_capture_status:<market>` 의 `feeds`)의 정확도 문제이며 주문·시그널·알림·T-106 경로와 무관하다. 이미 검토가 끝난 코드를 고치면 시험·Reviewer·Codex 를 다시 돌려야 해 배포가 밀린다는 이유로 분리했다.

## 항목
| ID | 내용 | 위치 | 권고 |
|---|---|---|---|
| L-1 | `MAX(published_at)` 가 미래 날짜·오래된 고정 기사에 취약 — gap 을 놓칠 수 있다(거짓 '이어짐') | `feed-check.ts` 조회 SQL | SQL 에 `published_at <= now + 1일` 상한 |
| L-2 | 응답이 ok 인데 `items: []` 이면 직전 `feeds` 승계가 안 되고 `{}` 로 초기화되어 **연속 gap 수가 끊긴다**(fetch_failed·no_items 는 승계됨) | `raw-capture.ts` 470행 부근 | 빈 결과면 `feeds` 를 넘기지 않아 승계 |
| L-3 | 피드 상한 8 초과분이 로그 없이 누락 | `status.ts` `nextFeeds` | 누락 시 경고 로그 한 줄. 현재 해외 4개·국내 1개라 영향 없음 |

## 착수 조건
T-118 이 배포되고 1주 관측(2026-11-05 전후)한 뒤, 관측에서 `feeds` 의 오판이 실제로 보이면 착수. 보이지 않으면 우선순위 낮음 유지. (운영 관측 때 Yahoo 피드의 09·17시 gap 표시는 사양 결과이지 오경보가 아니다.)

## 최종 요약
(미작성)

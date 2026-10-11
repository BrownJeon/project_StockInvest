---
task_id: T-043
title: entry-watcher 주문 전 조건부 선점 — 틱이 겹쳐도 같은 시그널에 실주문이 두 번 나가지 않게 (T-042 외부 검토 파생)
status: todo
priority: high
roles_involved: [leader, developer, reviewer, qa]
related_tasks: [T-042, T-037, T-025]
tags:
  - type/task
  - domain/safety
  - domain/signals
aliases:
  - entry-watcher 선점
  - entry-watcher preorder claim
created: 2026-10-12
updated: 2026-10-12
---

# T-043 — entry-watcher 주문 전 조건부 선점

## 왜 (사실)

T-042 의 Codex 외부 검토(C2, 2026-10-12)가 지적했고 Leader·Reviewer 가 각각 코드로 확인했다.

- `src/app/api/cron/entry-watcher/route.ts`: `SELECT … status='approved_pending_entry'` → `submitOrder` → **그 뒤** `UPDATE signals SET status='executing' … WHERE id=?`. 주문 전 조건부 선점이 없고, 주문 뒤 UPDATE 의 WHERE 에도 상태 조건이 없다.
- `submitOrder` 의 `client_order_id` 는 호출마다 `co-<randomUUID>` 이고 entry-watcher 는 고정 키를 넘기지 않아 DB 수준 멱등성이 없다.
- Reviewer 하니스 재현: 같은 프로세스에서 두 틱이 겹치면 같은 시그널에 `submitOrder` 가 2회 불린다(`submitOrderCalls:2`).
- **T-042 이전부터 있던 구조**다(HEAD 도 동일). T-042 는 악화시키지 않았다(결과 불명 1분 재제출 차단을 추가했고, 구간 없는 룰 시그널이 `approved_pending_entry` 로 가던 막다른 길을 없앴다).

## 노출 크기 (2026-10-12 읽기 전용 실측)

- 정상 운영에서는 틱이 겹치지 않는다: 호출자는 `scripts/cron-runner.sh` 하나이고 단일 루프에서 curl 동기 호출 + `sleep 60`.
- 겹치는 조건: ① `stockinvest-cron` 중복 기동(`ecosystem.config.js` 주석·`docs/deploy-order.md` §2 가 이미 최대 위험으로 다룸) ② 수동 curl ③ 배포 중 새 cron-runner 첫 틱과 옛 릴리스의 진행 중 요청 ④ 배포 중 주문 송신 뒤 기록 전 프로세스 종료. ③④ 는 구간 안에서 대기 중인 하이브리드 시그널의 주문 진행 수 초와 겹쳐야 한다.
- 상한: 중복 주문도 1회·일 한도 검사를 각각 통과해야 하므로 하루 한도.
- 과거 흔적 없음: 접수·체결된 자동 주문 전체 19건(마지막 05-26), 같은 종목·방향 3분 이내 쌍 0건.
- 웹 하이브리드 승인은 05-23 부터 켜져 있어 이 노출은 스위치와 무관하게 오늘도 같은 크기로 존재한다. 다만 T-042 의 `telegram_approval_enabled` 를 켜면 구간 카드 승인이 쉬워져 `approved_pending_entry` 가 늘 수 있으므로 **T-042 스위치를 켜기 전 또는 같은 주에 넣는다.**

## 설계 요지 (Reviewer 5라운드 제안 + Codex 권고)

1. `UPDATE signals SET status='executing' WHERE id=? AND status='approved_pending_entry' AND (expires_at IS NULL OR expires_at > NOW())` 의 `affectedRows=1` 인 틱만 `submitOrder` 를 부른다. 0 이면 건너뛴다(다른 틱이 가져갔거나 만료).
2. 확정 거부와 송신 전 예외만 `approved_pending_entry` 로 복귀한다(다음 틱 재시도). 결과 불명·성공은 `executing` 을 유지한다 — 성공 후 `consumed_order_id` 기록은 `WHERE id=? AND status='executing'`.
3. 맞물리는 것: 분할 진입 게이트(`blocked_by_prior_split`), T-042 의 R3-1 프로세스 로컬 집합(`orderSentButUnrecorded`; 선점이 생기면 대부분 불필요해지는지 판단), 만료 처리, 복귀 UPDATE 실패 시의 알림.
4. 선점 위치는 모든 건너뛰기 경로(수량 0, 분할 대기, 구간 미도달 등) **뒤, `submitOrder` 직전**이어야 한다 — 앞에 두면 건너뛴 시그널이 `executing` 에 갇힌다.

## 시험 (필수)

- 동시 두 틱 → `submitOrder` 1회.
- 선점 뒤 프로세스 사망 → 시그널은 `executing` 으로 남고 재제출 없음(T-042 §6.1 절차로 복구).
- 확정 거부 → 복귀 → 다음 틱 재시도.
- 분할 진입 게이트, R3-1 집합과의 관계, 만료 경계.

## 함께 처리할 Low (T-042 F2, 같은 안전 경로 변경에 묶을 것)

폴러(`telegram-poller.ts`)·승인 처리기(`telegram-approval.ts`)를 바꾸므로 따로 하면 재감사가 두 번 필요하다.

- offset 저장을 단조 증가로: `IF(CAST(VALUES(value) AS UNSIGNED) > CAST(value AS UNSIGNED), VALUES(value), value)`.
- 업데이트 처리 전에 `stillHoldsLock` 재확인, 상실이면 그 배치를 폐기하고 offset 을 저장하지 않는다(`pollOnce` 에 확인 의존성 필요).
- 전이에 져서 "이미 처리됨"이 된 경우 결과 본문을 덮어쓰지 않고 토스트 + 버튼 제거만.

## 절차

judge intake(R2 예상) → developer → reviewer → (judge C2 → Codex) → qa → 커밋·push(=배포). 변경 파일이 SAFETY_PATHS(`src/app/api/cron/`, `src/lib/signals/` 등)라 Reviewer 판정 없이는 커밋 훅이 막는다. 화면 변경 없음(데모 게이트 비대상).

## 출처

[[T-042-telegram-approval-buttons]] Reviewer 5라운드 · Codex run `.claude/state/codex-review/runs/20261011T181501Z-T-042-C2/`.

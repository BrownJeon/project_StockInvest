---
task_id: T-047
title: 텔레그램 폴러·승인 처리기 Low 하드닝 3건 — 락 상실 뒤 처리 폐기·오프셋 단조 증가·패배 시 본문 덮어쓰기 금지 (T-042 Codex C2 medium → Reviewer low)
status: todo
priority: normal
roles_involved: [leader, developer, reviewer, qa]
related_tasks: [T-042, T-043]
tags:
  - type/task
  - domain/safety
  - domain/notify
aliases:
  - 폴러 하드닝
  - poller hardening
created: 2026-10-18
updated: 2026-10-18
---

# T-047 — 폴러·승인 처리기 하드닝 (텔레그램 스위치를 켜기 **전에**)

## 배경

T-042 의 Codex C2 검토가 지적한 medium(폴러가 롱폴링 도중 락을 잃은 뒤에도 콜백을 처리하고 오프셋을 되돌릴 수 있음)을 Reviewer 가 재현(가짜 `LoopIO`)한 뒤 **Low** 로 분류했다. 돈 위험은 없다 — 시그널 전이가 원자적이라 한 쪽만 이기고 진 쪽은 "이미 처리된" 경로로 간다. 실제 영향은 `answerCallbackQuery` 중복 거절(텔레그램이 두 번째를 거부)·감사 행 중복·**진 쪽이 결과 메시지를 "이미 처리된 시그널입니다"로 덮어 주문 번호가 가려질 수 있음**.

원래 T-043 에 묶기로 했으나 T-043 이 **실주문 경로**라 감사 대상을 entry-watcher 한 곳으로 좁히려고 분리했다(2026-10-18, Leader 결정). 폴러는 스위치(`telegram_poller_enabled`)가 꺼져 있어 지금 동작하지 않는다 → **스위치를 켜기 전에** 끝내면 된다.

## 범위

1. 오프셋 저장을 단조 증가로: `IF(CAST(VALUES(value) AS UNSIGNED) > CAST(value AS UNSIGNED), VALUES(value), value)` (`system_config.telegram_poll_offset`).
2. `getUpdates` 반환 직후와 각 업데이트 처리·오프셋 저장 전에 `stillHoldsLock` 재확인 — 상실이면 그 배치를 폐기하고 오프셋을 저장하지 않는다(`pollOnce` 에 확인 의존성 추가).
3. 전이에 져서 "이미 처리됨"이 된 경우 결과 본문을 덮어쓰지 않고 토스트 + 버튼 제거만(`telegram-approval.ts`).

대상 파일(전부 안전 경로): `src/lib/signals/telegram-poller.ts` · `src/lib/signals/telegram-approval.ts` · 각 테스트.

## 선행·순서

- T-043 후, 텔레그램 스위치를 켜기 전. 재현 하니스: T-042 5라운드 Reviewer 의 `r42-f2.test.ts`(세션 scratchpad) 참고 — 락을 잃은 소비자가 오프셋을 110→103 으로 되돌리는 시나리오.

## Leader 기록

- [10-18] T-043 에서 분리해 등록. 코드 변경 없음.

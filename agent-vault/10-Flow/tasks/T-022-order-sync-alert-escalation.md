---
id: T-022
title: order-sync 판단보류 알림 에스컬레이션 + 대시보드
status: done
created: 2026-08-12
updated: 2026-08-12
owner: leader
tags:
  - type/task
  - domain/notify
  - domain/order-sync
aliases:
  - 알림 정책 재설계
  - order-sync:stale 무한반복
related_tasks:
  - "[[T-018-order-sync-fail-closed]]"
  - "[[T-019-partial-fill-false-filled]]"
  - "[[T-020-fractional-order-quantity-sizing]]"
---

# T-022 — order-sync 판단보류 알림 에스컬레이션 + 대시보드

## 1. 배경

board.md의 "[신규, T-018 MED-4 파생] 구조적으로 해결 불가능한 hold 에 30분마다 critical 경보가
영원히 반복된다" 항목. `order-sync:stale` 알림이 level-triggered라 구조적으로 해결 불가능한
판단보류 건에 대해 30분마다 영원히 반복 — 사람이 알림을 무시하도록 훈련시키는 실패 모드.

## 2. 설계·계획 문서 (전문은 여기 참조, 이 파일은 요약만)

- 설계: [`docs/superpowers/specs/2026-08-12-order-sync-alert-escalation-design.md`](../../../docs/superpowers/specs/2026-08-12-order-sync-alert-escalation-design.md)
- 구현 계획: [`docs/superpowers/plans/2026-08-12-order-sync-alert-escalation-plan.md`](../../../docs/superpowers/plans/2026-08-12-order-sync-alert-escalation-plan.md)

## 3. 핵심 결정

- **범위를 `order-sync:stale` 하나로 좁힘** — `throttle.ts` 공유 코드(킬스위치·낙폭경보 등
  12개 호출처)는 무변경. T-018이 우려했던 폭발반경을 피함.
- **설계 중 발견한 오류를 스스로 정정**: 원래 `unreconciledSince`(인메모리) 전체를 DB로
  옮기려 했으나, 코드 주석이 이 인메모리 설계가 **의도적**(재시작 시 리셋이 맞다는 판단,
  `notify/throttle.ts`와 같은 철학)이었음을 확인 → `unreconciledSince`는 무변경, "30분 알림이
  처음 발화된 시점"만 새 테이블(`order_sync_stale_tracking`)에 가볍게 영속화하는 방식으로
  설계 수정.
- `STRUCTURAL_MS`(구조적 전환 기준) = 2시간, 전환 알림 수준 = critical 유지 — 둘 다 사용자
  확정.

## 4. 구현 (subagent-driven-development, 격리 클론 `~/.node-local/stockinvest-sdd`)

Task 1~4를 각각 별도 서브에이전트로 구현 → 개별 리뷰(Sonnet) → 전체 브랜치 최종 리뷰(Opus) →
발견된 Important 4건 fix round → 재검토 PASS 순으로 진행. 상세 이력은 격리 클론의
`.superpowers/sdd/2026-08-12-order-sync-alert-escalation-plan/progress.md`에 있었으나, 클론
자체는 병합 완료 후 정리 대상이라 **git 커밋 로그가 최종 기록**이다 (squash 병합 전 5개
세부 커밋은 클론에만 존재했고, main에는 1개 커밋으로 합쳐짐).

**최종 리뷰가 잡아낸 것 — 이 기능 자체가 없애려던 "침묵"을 스스로 재현할 뻔한 결함 2건**:
1. 에스컬레이션 추적용 DB 호출이 실패하면 `reportUnreconciled` 전체가 죽어서, 무관한
   부분체결 알림까지 조용히 같이 죽는 구조였음 → fail-open(DB 실패 시 구정책으로 계속 반복)
   으로 수정.
2. 구조적 알림의 스로틀 키를 모든 주문이 공유해서, 같은 24시간 안에 두 번째 주문이 2시간을
   넘기면 **잠기기만 하고 알림은 아예 안 가는** 결함(설계 의도 "주문당 1회"가 "전체 1회"가
   되어버림) → 키를 주문별로 분리.

그 외 STRUCTURAL_MS/STALE_MS 역전 방지 가드, 재시작 내구성(핵심 설계 주장)을 검증하는
회귀 테스트, 삭제된 주석 복원도 같은 fix round에서 처리.

또한 Task 2 리뷰에서 발견된 "판단보류 0건이 되는 라운드에 `clearResolved`가 호출 안 돼
유령 추적 행이 남는" 결함을 Task 3에서 함께 수정(대시보드가 그 데이터를 사용자에게 보여주기
직전이라 시급도가 높았음).

## 5. 배포

병합 커밋 `5880185`(main), 문서 커밋 `8c4231a`(agent-vault 갱신, T-021/T-016 상태 정정 포함).
`2026-08-12 04:14~04:15 UTC` webhook-deploy exit=0, pm2 재기동 정상, 배포 후 헬스체크
`safetyStatus:"green"` 확인. 96 suites / 1461 tests 전부 통과, typecheck 0에러.
주문·자금 경로(`submitOrder`/`kis.createOrder`) 무접촉 — 최종 리뷰가 diff 전체에서
grep으로 직접 확인.

## 6. 남은 것 (Low, 후속 과제로 이월 — board.md Backlog 참조)

- 최종 리뷰 fix round 자체가 만든 좁은 엣지케이스: `markEscalated`가 루프 중간에 실패하면
  같은 주문에 구조적+반복 알림이 둘 다 갈 수 있음(과다 알림 방향이라 심각하지 않음)
- 대시보드 배지가 마운트 시 1회만 fetch(폴링 없음) — "계속 추적한다"는 알림 문구와 완전히
  일치하려면 후속으로 폴링 추가 검토
- 30분~2시간 구간 배지 문구가 분 단위가 아니라 시간 단위로 반올림돼 "최장 0시간"으로 보일 수
  있음(표시만의 문제)
- **브라우저 QA 미완료** — `npm run build`/dev 서버 금지 제약상 배지 실제 렌더(0건 숨김,
  구조적 건 빨강 표시 등)는 사용자가 직접 확인 필요

## 7. 최종 요약 (사용자용)

"주문 상태를 확인 못 하는 문제가 며칠씩 계속되면 30분마다 영원히 경보가 울려서 결국 사람이
경보를 무시하게 되는" 문제를 고쳤습니다. 이제 2시간이 지나면 "이제 구조적인 문제다"라는
알림을 딱 한 번만 보내고 반복을 멈추며, 그 대신 화면(SafetyBar) 배지로 몇 건이 걸려있는지
계속 볼 수 있게 했습니다. 문제가 실제로 풀리면 다음에 같은 일이 생겼을 때 처음부터 다시
정상적으로 알립니다.

설계 단계에서 제가 처음 세운 계획에 실수가 있었는데(기존 코드의 의도를 잘못 읽음),
실제 코드를 다시 확인하고 스스로 바로잡았습니다. 구현 후 최종 감사에서 이 기능 자체가
"조용히 알림이 안 가는" 문제를 두 가지 새로 만들 뻔한 것도 잡아내 배포 전에 고쳤습니다.
전체 검증(96 suites/1461 tests, typecheck 0에러) 통과 후 병합·배포까지 완료했고,
헬스체크로 정상 서비스 중임을 확인했습니다. 주문·자금 관련 코드는 전혀 건드리지 않았습니다.

---
task_id: T-050
title: 사용자 시나리오 확정(custom/confirm)의 expires_at 이 UTC 문자열로 저장돼 24시간이 아니라 약 15시간 만에 만료된다 (T-046 감사 R-3, 범위 밖이라 분리)
status: todo
priority: normal
roles_involved: [leader, developer, reviewer, qa]
related_tasks: [T-046, T-045]
tags:
  - type/task
  - domain/signals
  - domain/safety
aliases:
  - custom confirm 만료 시각
  - custom signal expiry timezone
created: 2026-10-18
updated: 2026-10-18
---

# T-050 — `signals/custom/confirm` 의 만료 시각 UTC/KST 어긋남

## 배경

T-046 독립 감사(Reviewer, R-3 MINOR)가 발견하고 Leader 가 코드로 재확인했다(2026-10-18).

`src/app/api/signals/custom/confirm/route.ts:134-135`:

```ts
const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
  .toISOString().replace('T', ' ').slice(0, 19);
```

`now + 24h` 라는 **올바른 시점**을 UTC 벽시계 문자열로 만들어 KST `DATETIME` 컬럼(`signals.expires_at`, DB 서버·앱 풀 모두 KST)에 넣는다. DB 는 이 값을 KST 로 읽으므로 실제 만료는 `now + 24h − 9h = now + 15h` 이다. T-046 의 카드 시각 버그와 **같은 원인**이다.

## 영향

- 방향이 **조기 만료**라 자금 위험은 아니다(늦게 만료돼 낡은 가격으로 주문이 나가는 쪽이 아님). 사용자가 24시간으로 기대한 시나리오가 15시간 뒤 사라지는 기능 결함.
- 이 파일은 안전 경로(`src/app/api/signals/` 등 커밋 훅 대상)라 수정에는 독립 감사가 필요하다 → T-046 에 섞지 않고 분리했다.
- 같은 패턴이 다른 곳에 있는지는 2026-10-18 `grep`(`toISOString()` + `valid_from|expires|deadline`)으로 post-market 엔진 외에는 이 한 곳만 확인했다(`post-market-engine.ts:247` 의 `nextDay` 는 날짜 부분만 쓰고 00:00Z = 그 거래일이라 정상).

## 작업 범위 (제안)

1. 위 한 곳을 KST 벽시계로 저장(`toKstDatetime` 같은 공용 헬퍼로 모을지 판단 — 현재 `post-market-engine.ts`·`entry-claim.ts` 에 각각 있음. 세 번째 사용처가 생기므로 `src/lib/` 공용 유틸 승격을 검토).
2. 기존 `scenario_source='user'` 행은 만료가 지난 것이 대부분이라 데이터 보정은 불필요할 가능성이 높다 — 착수 때 `expires_at` 이 미래인 `user` 행이 있는지 읽기 전용으로 확인.
3. 시험: 24시간 만료가 실제 KST 로 24시간 뒤인지(서버 TZ 가 UTC/KST 어느 쪽이든).

## 우선순위 판단

사용자 시나리오 기능을 실제로 쓰는 빈도(`scenario_source='user'` 행이 전체 9행뿐 — T-048 실측 2026-10-18)가 낮아 급하지 않다. T-046 배포 후 여유가 있을 때.

## Leader 기록

- [10-18] T-046 Reviewer 가 발견(R-3) → Leader 가 코드 확인 후 분리. 코드·DB 변경 없음.

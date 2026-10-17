---
task_id: T-046
title: post-market 시나리오 카드의 valid_from·expires_at 이 UTC 문자열로 저장돼 9시간 어긋난다 — 카드가 개장 전에 만료되어 한 번도 실행되지 못했다
status: todo
priority: high
roles_involved: [leader, developer, reviewer, qa]
related_tasks: [T-045, T-043, T-042, T-038]
tags:
  - type/task
  - domain/signals
  - domain/strategy
  - domain/safety
aliases:
  - 시나리오 카드 시간대 오류
  - post-market timezone bug
created: 2026-10-17
updated: 2026-10-18
---

# T-046 — post-market 카드 시간대 오류 (T-045 독립 감사 R-2, Leader 재검증)

## 사실 (2026-10-17 읽기 전용 실측 — 감사 보고를 Leader 가 DB·코드로 재확인)

- DB 서버 시간대 = **KST**(`@@system_time_zone`=KST, `NOW()`=23:35 ↔ `UTC_TIMESTAMP()`=14:35). 앱 풀도 `timezone: '+09:00'`(`src/lib/db.ts:47`).
- `src/lib/strategy/post-market-engine.ts` 는 `validFromDate.toISOString()`(**UTC**) 문자열을 `DATETIME`(KST 해석) 컬럼에 그대로 넣는다. 의도: 다음 거래일 09:00 KST 에 유효, 15:30 KST 에 만료. 실제 저장: `valid_from = 해당일 00:00:00`, `expires_at = 해당일 06:30:00`(KST 로 읽힘).
- post-market 카드 **46장 전부** `00:00:00 / 06:30:00`. 상태: expired 38 · pending 4 · approved 2(주문 없음) · superseded 2. **주문과 연결된 카드(`consumed_order_id`) 0장.**
- 만료 판정 두 곳이 모두 `expires_at` 을 본다: `signal-expiry`(30분마다, `expires_at < NOW()`) · `entry-watcher`(`new Date(row.expires_at) < now` 이면 즉시 `expired`, 이 감시자는 **장이 열려 있을 때만** 돈다). 09:00 에 처음 도는 순간 카드는 이미 06:30 에 만료된 것으로 보인다.
- 결과: 카드는 **대상 거래일 06:30 KST 전까지만 승인할 수 있고, 승인해도 장중에 실행될 수 없다.** 메모리의 "90일간 주문 접수 0건"과 부합한다. [확실: 데이터와 비교 코드 / 주문 경로를 실제로 끝까지 태워 본 것은 아님]

## 왜 T-045 에서 고치지 않았나

- 범위가 다르다. 이 수정은 카드를 **실제로 실행 가능하게 만든다** — 실주문이 처음으로 나가기 시작하는 변경이라 사용자 결정이 필요하다.
- 같은 이유로 **T-043(entry-watcher 주문 전 선점 없음)이 먼저** 들어가야 한다. 지금까지 중복 카드가 무해했던 이유 중 하나가 카드가 실행되지 못해서였다. 이 수정을 하는 순간 T-045 의 중복 방지와 T-043 의 선점이 실제 방어선이 된다.

## 제안 순서

1. **T-043** — entry-watcher 주문 전 조건부 선점(+ 폴러 Low 하드닝)
2. **T-046(이 task)** — 시간대 수정 + 기존 카드 정리
3. **T-042 스위치**(`telegram_poller_enabled` → 자가 점검 → `telegram_approval_enabled`) — 버튼으로 쉽게 승인하게 되는 시점이라 앞의 둘이 끝난 뒤가 안전하다

## 수정 방향 (초안, 구현 전 설계 확정 필요)

- 엔진이 `valid_from`/`expires_at` 을 **KST 문자열**로 만든다: 09:00 / 15:30 KST (`Date` 에 +9h 한 뒤 포맷). `holding_deadline`·프롬프트의 `nextDay` 는 날짜 부분이 같아 영향 없음을 확인할 것.
- **T-045 의 중복 키 호환**: 지금 `NOT EXISTS` 는 `valid_from = ?` 정확 일치라, 배포 당일 기존 카드(`00:00:00`)와 새 카드(`09:00:00`)가 서로를 못 막는다 → `DATE(valid_from) = DATE(?)` 로 바꾸거나 배포 당일 수동 정리. T-045 의 테스트가 `expires_at '…06:30:00'` 을 정답으로 고정하고 있어 함께 고쳐야 한다.
- 기존 `pending`/`approved` 카드(2026-10-19 용 등)는 새 시각 체계와 섞이지 않게 정리 방침 결정.
- 시험: KST 문자열 생성(주말 경계·월요일), 만료 판정(06:30 에 살아 있고 15:30 에 만료), 실제 DB 에서 `signal-expiry`/`entry-watcher` 비교가 09:00~15:30 에 카드를 유효로 보는지(롤백 트랜잭션).

## 선행 조건 (T-045 Codex C2 + Reviewer 분류, 2026-10-17)

1. **유니크 인덱스(또는 직렬화)가 먼저 또는 같이** 나가야 한다 — 카드가 실행 가능해지는 순간 중복 카드는 이중 매수 후보다. T-045 의 `NOT EXISTS` 는 운영 격리수준(REPEATABLE READ)에 기대는 방어일 뿐 구조적 유일성이 아니다(READ COMMITTED 면 300/300 중복, Reviewer 실험). 마이그레이션은 **사용자 승인 사항**이다.
2. **마이그레이션 사전 조건**: 운영 `signals` 에 이미 같은 (symbol, side, valid_from, scenario_source) 중복 그룹이 있다 — 005380·055550 @2026-10-19 각 2행(그중 19099·19100 은 `superseded`), 347700 @08-17 3행, 005380 @07-20 3행. 유니크 인덱스를 만들기 전에 이력 정리 방식과 승인이 필요하다. 다른 신호는 `valid_from` 이 NULL 이라 영향 없음(NULL 허용 의미 기준, 확인 필요).
3. **키 설계**: T-046 이 `valid_from` 값 형식(`00:00:00` → `09:00:00`)을 바꾸면 `NOT EXISTS` 비교 키도 같이 바꿔야 한다 — 값이 다르면 배포 전후 실행이 서로를 못 알아봐 중복이 생긴다. 키를 **날짜 단위**(`DATE(valid_from)`)로 잡는 설계를 포함한다(유니크 인덱스도 같은 기준).
4. **코드 → 마이그레이션 순서**: 코드가 `ER_DUP_ENTRY` 를 duplicate 로 처리하도록 먼저 나가는 것은 인덱스가 없을 때 무해하므로, 배포 순서는 코드 → 마이그레이션이 안전하다.
5. **대안(승인이 안 날 때)**: 프로세스 내 실행 중 표식(`try/finally`, 두 번째 요청은 즉시 `skipped`). `stockinvest` 는 pm2 cluster 인스턴스 1개라 현실적인 겹침을 덮지만 구조적 보증은 아니다. `GET_LOCK` 은 연결 단위 잠금이라 풀 연결에 잠금이 남는 위험이 있어 권하지 않는다(T-042 폴러에서 겪음).

6. **T-043 독립 감사 R-1 (medium) — 오래된 무번호 `executing` 자동 경보**: T-043 으로 위험의 방향이 "이중 주문"에서 "주문 누락 + 무음"으로 바뀌었다. 선점(`executing`) 뒤 프로세스가 죽거나 복귀가 0행이면 `executing` + `consumed_order_id` NULL 로 남고 알림이 없다. **T-046 으로 카드가 실행 가능해지기 전에** 틱에서 `SELECT … WHERE status='executing' AND consumed_order_id IS NULL AND updated_at < NOW() - INTERVAL 10 MINUTE` 를 돌려 경보(스로틀)하게 한다. 같은 SQL 이 `docs/telegram-approval.md` §7 에 수록돼 있어 그때까지는 수동 점검이다. 즉시 주문 경로(`approveSignal`)가 결과 불명으로 잠근 행도 같은 조건에 걸리는지 함께 확인할 것.
7. **표시 문구(T-043 감사 R-7, low)**: 대시보드 `MyDecisionTab` 이 주문 번호 없는 `executing` 을 "주문 실행됨"으로 보여 준다(T-042 의 결과 불명 잠금부터의 성질). 카드가 실제로 실행되기 시작하면 오해가 커지므로 문구를 "처리 중/확인 필요"로 바꾸는 화면 작업이 필요하다(화면 변경이라 데모 게이트 대상).

## 열린 질문 (사용자)

- 카드가 실제로 실행 가능해져도 괜찮은가 — 카드당 `amount_krw` 10만 원 고정, 현금 8만 원이면 수량 0(`quantity_below_min`)일 가능성이 크다. 한도(1회 약 137만, 일 약 229만)는 안전장치가 적용한다.
- 위 제안 순서(T-043 → T-046 → 버튼 스위치)로 가도 되는가.

## Leader 기록

- [10-17] T-045 독립 감사(Reviewer)가 발견(R-2) → Leader 가 DB·코드로 재확인. 코드 변경 없음. 사용자 결정 대기.

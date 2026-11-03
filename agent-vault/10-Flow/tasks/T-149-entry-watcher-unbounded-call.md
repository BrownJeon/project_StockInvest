---
task_id: T-149
title: entry-watcher 무제한 동기 호출 — 인수 전제 3개가 모두 틀렸음을 실측으로 확인
status: hold
waiting: 사용자 범위 결정 — 조사 결과 당초 설계 과제(겹침 방지 설계)가 불필요해졌다. 아래 「권고」의 세 선택지 중 하나를 고른다
priority: low
project: StockInvest
created: 2026-11-03
updated: 2026-11-03
base_ref: origin/main 17a4257 (T-147, 릴리스 20261103-202418-17a4257f 배포 완료)
risk_level: R1
roles_involved: [leader]
related_tasks:
  - T-147-cron-tick-starvation
  - T-148-strategy-eval-serial-fanout
  - T-112-run-judgment-record-foundation
tags:
  - type/task
  - domain/safety
  - domain/ops
aliases:
  - entry-watcher 상한
  - 호스트 동결 오탐 재시작
  - T-149
---

## 발단 (인수받은 과제)

T-147 작업 중 워치독(HOME-SERVER 순찰, 하트비트 300초 임계)이 `stockinvest-cron` 을 재시작한
이력 4건을 분해했고, 그중 **2026-10-08 15:55** 1건은 「주문을 집행하는 `entry-watcher` 가 약 14분간
응답하지 않았다」로 분류됐다(QA 조사, 가능성 높음). 러너의 다른 느린 잡들은 하나씩 `*_CURL_MAX_TIME`
상한을 받았는데 정작 주문을 내는 `entry-watcher` 에는 상한이 없으므로, **「상한을 붙이면 서버 쪽 처리가
계속 돌아 다음 틱과 주문이 겹친다」는 제약 아래 겹침 방지 설계**를 하라는 과제로 인계됐다.

인계 브리핑이 설계의 전제로 제시한 것:

1. 2026-10-08 15:55 재시작의 원인은 `entry-watcher` 약 14분 무응답이다 (가능성 높음).
2. `src/lib/safety/order-sync.ts:1226-1227` 이 `FOR UPDATE`·`GET_LOCK()` 을 명시적으로 기각했고
   일일 누적 주문 한도(`DAILY_ORDER_MAX_KRW`)가 check-then-act 이므로, **지금 주문 경로를 직렬화하는
   유일한 장치가 러너의 무제한 동기 호출**이다 — 상한을 붙이는 것 자체가 그 장치를 무력화한다.
3. 따라서 라우트 쪽 단일비행(single-flight) 가드나 자체 데드라인이 상한보다 **선행**해야 한다.

브리핑은 「추정을 전제로 설계하지 말고 로그로 먼저 재확인하라」고 명시했다. 재확인 결과
**세 전제가 모두 틀렸다.** 코드 변경은 하지 않았다.

## 실측 ① 2026-10-08 사건은 entry-watcher 가 아니다 — 호스트 동결이다 [확실]

### 러너 로그만 보면 entry-watcher 가 범인처럼 보인다

`/home/brownjeon/apps/stockinvest/shared/logs/cron-out.log-20261101`:

```
15:40:28  entry-watcher OK / holding-checker OK          ← 틱 N
          (15분 27초 공백 — 아무 로그 없음)
15:55:55  entry-watcher OK / holding-checker OK / strategy-eval / signal-followup / signal-expiry / trade-report
15:55:57  [cron-runner] started  → entry-watcher OK      ← 워치독이 재시작시킨 새 러너
```

하트비트는 틱 **머리**에서만 쓰였고(T-147 의 틱 끝 갱신은 당시 없었다) `entry-watcher` 가 그 직후
첫 호출이다. 그래서 「틱 N+1 이 15:41:28 에 하트비트를 쓰고 entry-watcher curl 이 14분 27초 매달렸다」로
읽힌다. 러너 로그 하나만 보면 이 해석이 정확히 맞다.

### 그런데 완전히 무관한 프로세스들이 **같은 창에서 같이 멈췄다**

| 출처 | 직전 | 공백 | 복귀 |
|---|---|---|---|
| `~/.local/log/autostart-recover.log` (워치독 자신, crontab */5) | 15:40:02 점검 종료 | 15:45·15:50 점검이 **시작 로그조차 없음** | 15:55:55 (15:45·15:50 분이 이때 "이미 실행 중 — 건너뜀" ×2) |
| TheKaiwa `speech-gateway-out.log` (무관 프로젝트) | 15:40:02 health 200 | 15:45·15:50 health 없음 | 15:55:57 health 200 |
| VoiceVault `whisper-out.log` (무관 프로젝트) | 15:40:02 health 200 | 15:45·15:50 health 없음 | 15:55:56 health 200 |
| StockInvest `pm2-out.log-20261101` (웹앱) | — | 15:38~15:54 아무 줄 없음 | 15:55:55 `[cron/strategy-eval] skipped — all_markets_closed` |
| TheKaiwa `speech-worker-out.log` | — | — | 15:55:54 `claim failed status=0 reason=timeout` (깨어난 순간) |

`entry-watcher` 가 **워치독 crontab 과 다른 두 프로젝트의 파이썬 서비스를 멈출 수는 없다.**
호스트 전체가 약 15분 25초 얼어붙었다.

### 재부팅이 아니다 — 켜진 상태로 얼었다

```
last -x reboot  →  Aug 25 09:54 부팅이 Oct 29 07:13 까지 연속
```

10-08 에는 재부팅·종료가 없다. 워치독 로그 전체 기간에서 400초 초과 공백은 4건뿐이고,
그중 3건(08-22, 08-25, 10-28→29)은 전부 `last` 에 대응하는 **재부팅**이다.
**10-08 15:40→15:55 만 재부팅 없는 동결**이다. T-037(NFS 마운트 경합)과 같은 고장 계열로 보인다
`[가능성 높음]` — 러너가 하트비트를 일부러 로컬 디스크에 두는 이유가 바로 T-037 이다.

### 정확한 사건 재구성

```
15:40:28  틱 N 끝 → sleep 60
15:41:28  틱 N+1 시작 → 하트비트 기록(15:41:28) → entry-watcher curl 발행
          ← 이 순간 호스트 동결 (약 14분 27초)
15:55:55  동결 해제 → curl 완료(HTTP 200) → 나머지 잡 즉시 실행
15:55:56  워치독이 하트비트(15:41:28, 868초 경과) 읽음 → pm2 restart
```

호스트 동결이 **마침 entry-watcher curl 이 떠 있을 때** 일어났다. 14분이라는 벽시계 시간은 실제이지만
원인은 라우트도 러너도 아니다.

### 🔴 그래서 상한을 붙여도 이 재시작은 막지 못한다

동결 중에는 curl 프로세스도 같이 잠들어 있으므로 `--max-time` 타이머도 함께 멈춘다. 복귀 시점에
경과가 상한을 넘은 것을 보고 curl 이 중단되었을 뿐이고, **하트비트는 여전히 15:41:28 이라 워치독은
똑같이 재시작한다.** 달라지는 것은 로그 한 줄이 `entry-watcher OK` → `entry-watcher HTTP=000` 으로
바뀌는 것뿐이다. 인수 완료 기준의 「2026-10-08 유형의 워치독 재시작이 재발하지 않음」은
**entry-watcher 를 어떻게 고쳐도 달성할 수 없다.**

## 실측 ② 15:41 에는 라우트가 즉시 반환했어야 한다 [확실]

`src/app/api/cron/entry-watcher/route.ts:203-211` 은 인증 직후 `isDomesticOpen()`·`isOverseasOpen()` 을
보고 둘 다 닫혀 있으면 `market_closed` 로 끝낸다. `src/lib/strategy/market-hours.ts:69-88`:

- 15:41 KST → `minutes` 941 ≥ 930(15:30) → **`isHoliday` 호출 전에** false (74행)
- 15:41 KST = 02:41 ET → `minutes` 161 < 570(09:30) → **`isHoliday` 호출 전에** false (85행)

DB·네트워크 접근이 하나도 없다. 즉 그 호출은 마이크로초 안에 끝나야 했고, 실제로 웹앱 로그가
15:55:55 에 `skipped — all_markets_closed` 를 찍었다(동결 해제 직후 즉시 처리). 라우트 안에서
매달릴 코드 경로 자체가 없었다.

## 실측 ③ 주문 경로 겹침은 이미 DB 로 막혀 있다 — 인수 전제 2가 틀렸다 [확실]

브리핑이 인용한 `order-sync.ts:1226-1227` 의 `FOR UPDATE`·`GET_LOCK()` 기각은
**`recordSettledFill`(브로커 체결 내역을 `executions` 에 적는 사후 정산 경로)** 에 대한 판단이다.
주문을 **내는** 경로의 판단이 아니다. 주문 경로에는 이미 두 겹의 DB 장치가 있다.

### ⓐ 시그널당 이중 주문 — 조건부 UPDATE 선점 (T-043)

`src/lib/signals/entry-claim.ts:31-38`:

```sql
UPDATE signals SET status='executing', updated_at=NOW()
  WHERE id=? AND status='approved_pending_entry' AND (expires_at IS NULL OR expires_at > NOW())
```

`affectedRows === 1` 인 쪽만 `submitOrder` 를 부른다. entry-watcher 가 동시에 둘 돌아도
**같은 시그널에 주문이 두 번 나갈 수 없다** — 진 쪽은 `claim_lost`. 러너의 직렬화와 무관하게 성립한다.

### ⓑ 일일 누적 한도 — check-then-act 가 아니라 **예약 후 검사** (T-081 WP-B)

`src/lib/safety/dry-run.ts` 의 순서가 결정적이다:

- 2단계(160행): `INSERT INTO orders … status='pending'` ← **한도 검사보다 먼저** 행을 만든다(예약)
- 6단계(216행): `checkDailyMax(reqWithKrw, effDailyMax, orderId)`
- `src/lib/safety/order-limits.ts:245-253`: 오늘 매수 합산에서 `NOT (status='pending' AND id=?)` 로
  **자기 행만** 뺀다 → **다른 주문의 `pending` 은 합산된다**

dry-run.ts 주석이 직접 그렇게 적어 뒀다: *"다른 주문의 `pending`(송신 중)은 합산 → 동시 매수 경합 차단"*.
두 호출이 동시에 와도 각자 자기 행을 먼저 박고 서로의 행을 보므로 한도를 함께 넘지 못한다.

### 잔여 — 안전장치가 아닌 것

현금 사전 점검(T-051 `judgeEntryCash`)은 동시 실행 시 같은 잔고를 두 번 보고 둘 다 통과할 수 있다.
다만 이것은 브로커 거부를 줄이려는 **사전 점검**이고, 권위 있는 상한(1회·일일)은 위처럼 DB 로 예약된다.
프로세스 로컬 스로틀(현금 부족 알림·`sendAlertThrottled`)도 중복 알림이 가능하지만 주문은 아니다.

**결론: 상한을 붙이는 것이 「주문 경로를 직렬화하는 유일한 장치를 무력화한다」는 전제는 성립하지 않는다.**
단일비행 가드를 상한보다 선행시킬 이유가 없다.

## 실측 ④ entry-watcher 는 느린 잡이 아니다 [확실]

`job_run_log`(T-112 runner_rollup, `counts_json.maxMs` = 그 시간대 내 **최장 1회 호출**):

| 잡 | 기록 호출 수 | 최악 1회 | 상한 |
|---|---|---|---|
| `strategy-eval` | 1,136 | **347,800 ms (348초)** | 없음 |
| `stop-alert` | 5,436 | 13,178 ms | 20초 (T-068) |
| `signal-followup` | 423 | 11,839 ms | 없음 |
| `trade-report` | 1,135 | 3,459 ms | 없음 |
| `holding-checker` | 5,436 | 1,017 ms | 없음 |
| **`entry-watcher`** | **5,436** | **799 ms** | 없음 |
| `signal-expiry` | 241 | 25 ms | 없음 |

기간 2026-10-30 21:05 ~ 2026-11-03 20:04. **entry-watcher 호출 5,436건 중 최악이 0.8초다.**
상한 없는 잡 중 실제로 무제한 꼬리를 보이는 것은 `strategy-eval` 이고, 그것은 **T-148 이 이미
`status: doing` 으로 작업 중**이다(근본 원인 `src/lib/strategy/engine.ts:1455` 직렬 평가 루프).

## 워치독 재시작 4건 — 최종 분류

| 일시 | 호스트 동결? | 원인 | 담당 |
|---|---|---|---|
| 2026-09-29 03:55 | ✕ (health 체크 정상) | **미해명** — 03:49:11 이후 틱이 로그를 하나도 남기지 않고 03:55:02 에 재시작됨. 하트비트가 03:49:11 이었어야 300초를 넘으므로 03:50:11 틱이 하트비트 기록 전에 멈췄다는 뜻이다 | 미배정 |
| **2026-10-08 15:55** | **○ 15분 25초** | **호스트 동결 — 오탐 재시작.** entry-watcher 무죄 | 이 task |
| 2026-10-30 22:55 | ✕ | `strategy-eval` 270초 (22:04 롤업 maxMs 270,069) | T-148 |
| 2026-11-03 10:00 | ✕ | `strategy-eval` (09:00 롤업 maxMs 347,800) | T-148 |

## 권고 — 세 선택지 (사용자 결정)

### A. 이 task 를 조사 결과만 남기고 닫는다 (권고)

근거: ① 10-08 사건은 호스트 동결이고 entry-watcher 를 어떻게 고쳐도 그 유형의 재시작은 막지 못한다
② 주문 겹침은 T-043·T-081 WP-B 로 이미 DB 에서 막혀 있다 ③ entry-watcher 는 5,436건 최악 0.8초다
④ 실제 무제한 꼬리인 `strategy-eval` 은 T-148 이 작업 중이다.

러너의 시험 하네스 10개가 「기존 줄 변경 0·추가만」을 기준 ref 와 대조해 단정하므로, 러너를 건드리면
약 80분 직렬 시험 + Reviewer 독립감사 + 운영 배포가 따라온다. 관측 사례 0건인 위험에 그 비용을
쓰는 동안 실측 348초인 쪽은 그대로다.

### B. `ENTRY_WATCHER_CURL_MAX_TIME` 한 줄만 추가한다

겹침 보호가 이미 DB 에 있으므로 **단일비행 가드 없이 상한만 붙여도 안전하다**(실측 ③).
다른 잡들과 일관성이 생기고, 호스트 동결이 아닌 진짜 라우트 지연이 미래에 생기면 틱이 끊긴다.
남는 비용은 위의 시험·감사·배포다. 10-08 재발 방지 효과는 **없다**(실측 ①).

### C. 진짜 남은 문제를 다룬다 — 호스트 동결 오탐 재시작

워치독이 호스트 동결 뒤 `stockinvest-cron` 을 재시작한 것은 **오탐**이고, 그 재시작이
**이번 유일한 실제 겹침**을 만들었다(옛 러너 15:55:55 · 새 러너 15:55:57 — entry-watcher 2초 차이
두 번 호출. 당시 장 마감이라 주문 0건이라 무해했다). 하트비트 나이는 「프로세스가 죽었다」와
「호스트가 얼었다」를 구분하지 못한다. 구분 방법(예: 하트비트와 함께 호스트 단조시계·다른 서비스
생존 신호를 같이 보기)은 **HOME-SERVER 워치독 쪽 변경**이라 이 저장소 밖이고, 임계 조정도
CLAUDE.md 가 사용자 결정으로 못 박았다.

2026-09-29 미해명 건도 여기에 묶인다.

## 수행하지 않은 것

- 코드 변경 0건. 커밋 0건. 배포 0건.
- 러너 시험 하네스 미실행(변경이 없어서).
- dev 서버 미기동, `/api/cron/*` 실호출 0건, 운영 DB 읽기 전용만 사용.

## Leader 최종 요약

인수받은 과제는 「주문 집행 잡 `entry-watcher` 가 무제한으로 매달릴 수 있으니, 단순히 curl 상한을
붙이면 주문이 겹치므로 겹침 방지 설계를 하라」였다. 로그·코드·DB 를 직접 확인한 결과
**설계 자체가 필요 없다**는 결론이다.

1. **2026-10-08 의 14분은 entry-watcher 가 아니었다.** 호스트가 15분 25초 얼어붙었고, 그때 마침
   entry-watcher 의 curl 이 떠 있었다. 워치독 crontab·TheKaiwa·VoiceVault 가 같은 창에서 같이 멈춘 것이
   근거다(재부팅은 없었다). 상한을 붙여도 그 재시작은 똑같이 일어난다 — 동결 중에는 curl 타이머도 멈춘다.
2. **주문 겹침은 이미 DB 로 막혀 있다.** 시그널당 이중 주문은 T-043 의 조건부 UPDATE 선점이,
   일일 누적 한도는 T-081 WP-B 의 「pending 행 먼저 박고 남의 pending 을 합산」이 막는다.
   브리핑이 인용한 `GET_LOCK` 기각 주석은 주문 경로가 아니라 체결 내역 정산 경로의 판단이었다.
3. **entry-watcher 는 느리지 않다.** 5,436 호출 최악 0.8초. 상한 없는 잡 중 실제 꼬리가 긴 것은
   `strategy-eval`(최악 348초)이고 **T-148 이 이미 작업 중**이다.

그래서 권고는 **A(조사 결과만 남기고 닫기)** 다. 실제로 남은 문제는 다른 데 있다 — 워치독이
호스트 동결을 프로세스 사망으로 오인해 재시작하고, 그 재시작이 이번 사건의 **유일한 실제 겹침**
(entry-watcher 2초 차이 두 번 호출)을 만들었다. 이는 HOME-SERVER 워치독 쪽 변경이라 이 저장소 밖이다.

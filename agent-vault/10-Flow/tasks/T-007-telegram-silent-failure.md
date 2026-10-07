---
task-id: T-007
project: StockInvest
created: 2026-08-06
status: done
tags:
  - type/task
  - domain/observability
  - domain/notify
aliases:
  - 텔레그램 조용한 실패
related_tasks:
  - "[[T-004-phase1-visual-verification]]"
  - "[[T-006-phase2-implementation]]"
---

# T-007 · 알림 전송 실패가 보이지 않는 문제 수정

## 배경

[[T-004-phase1-visual-verification]] 작업 중 발견해 backlog(Medium-High)로 올려둔 건. `sendTelegramAlert()`가 `Promise<void>`라 **호출부가 성공/실패를 구분할 수 없다.**

**실제 유실 사례**: 2026-08-04 08:03 정기 리포트가 `ETIMEDOUT`(IPv4 타임아웃 + IPv6 도달불가)로 전송 실패했는데, 라우트는 **`sent:true`를 응답하고 `report_trade_last_sent_at`까지 같은 초에 갱신**했다. 아무 흔적도 남지 않았다. 누적 텔레그램 오류 약 126건. 실패는 간헐적이고 재시도하면 대개 성공한다.

**요구**: 실패를 보이게 만들고 거짓 성공 보고를 없앤다. **재시도 로직 신설은 범위 밖.**

## 착수 시점 실측 (Leader)

- `src/lib/notify/telegram.ts:48` — `sendTelegramAlert(...): Promise<void>`
- `src/app/api/cron/trade-report/route.ts:117` — `await sendTelegramAlert(...).catch(e => console.error(...))` → 실패를 삼키고 `sent:true` 응답 + `last_sent_at` 갱신
- **같은 결함의 두 번째 인스턴스**: `src/lib/notify/index.ts:38-39` — `sendAlert()`가 `.catch(() => {})`로 실패를 완전 폐기. **이 경로가 kill-switch·DRY_RUN 등 안전 치명 알림을 나른다** → 리포트 유실보다 심각. Leader가 범위에 포함시킴.

## 제약

- NFS 워킹트리에서 `npm run build`/`install`/`ci` 금지 — 운영 배포 경로. 검증은 `typecheck` + `test`만
- pm2 재시작 금지 / git 상태 변경 금지 / 운영 DB SELECT only
- **테스트 중 실제 텔레그램 발송 금지** (`force=1` 호출 금지)
- 안전장치·인증 무변경
- 커밋·push는 검증 완료 후 사용자 승인 필요

## Developer 결과 (2026-08-06)

`npm run typecheck` clean, `npm test` **49 suites / 558 tests** (기준선 46/523 → +3 suites, +35 tests). 기준선이 신규 파일 제외 시 정확히 재현됨도 확인.

### 설계 — `sent` 의미와 `last_sent_at` 규칙

**`sent` = "최소 한 채널로 사용자에게 실제 도달했는가".** 채널별 결과를 항상 노출(`delivered` / `failed` / `unconfigured` / `partial` / `lastSentAtAdvanced` / `rangeCapped`).

**`last_sent_at`은 "재시도 가치가 있는 실패"일 때만 보류** (`delivered===0 && failed>=1`):

| 상황 | 처리 | 근거 |
|---|---|---|
| 하나라도 전달됨(부분 성공 포함) | **갱신** | 🔴 **Leader 지침 수정 지점** — 아래 참조 |
| 전 채널 실패(시도함) | **보류** → 다음 5분 tick이 자연 재시도 | 재시도 기계 없이 재시도 확보 |
| 전 채널 미설정(`skipped`) | **갱신** + `sent:false` | 토큰 부재는 재시도로 안 고쳐짐 → 영구 5분 루프 방지 |
| `force=1` | 갱신 안 함(기존 유지) | |

### 🔴 developer가 Leader 지침의 결함을 잡아냄

내 지침은 "전달 실패 시 `last_sent_at`을 갱신하지 말라"였다. developer가 **`channel:'both'` 부분 성공에서 이 규칙이 스팸을 만든다**는 것을 발견했다 — 텔레그램만 장애일 때 슬랙으로는 **장애 내내 5분마다 중복 발송**된다. 내가 "스팸 버스트가 없는지 확인하라"고 요구한 바로 그 실패 모드를, 내 지침 자체가 만들고 있었다.

→ **"하나라도 전달되면 갱신"이 무료 재시도를 안전하게 만드는 조건**이다. 전용 테스트로 고정됨.

### 검증된 것 (추론이 아니라 실측·테스트)

1. **스팸 버스트 없음** — 실패한 tick은 아무것도 발송하지 않으므로 누적이 없다. 운영 실제 설정(`mode:'fixed'`, anchor 08:00, `channel:'telegram'`, interval 180 — 운영 `system_config`에서 SELECT로 읽음)으로 검증: stale `last`면 `shouldFireAtAnchorList`가 5분마다 true를 반환해 재시도되고, 성공 후에는 `anchor_not_due`로 멈춘다. 전용 테스트 존재.
2. **비대해지는 리포트 없음** — `formatReportMessage`의 가변 길이 구간 전수 추적: `sellPnl`(25h 고정), `buyWatchlist`(LIMIT 15), `holdings`(보유 수), 병목·이상(LIMIT 3/5). 창 길이에 비례하는 건 churn 한 줄뿐이고 거래 유니버스(~25종목)로 상한. **4096자 한계로 밀려가지 않음** — 이게 중요한 이유: 한계를 넘으면 일시적 실패가 **영구 HTTP 400**으로 바뀌어 영원히 재시도한다.
3. **실제 문제 1건 발견·수정** — **영구 실패**(토큰 폐기 등 매번 401/400)면 `rangeStart = last`가 무한정 과거로 밀려 `getEvalFunnelSummary`가 5분마다 수개월치를 집계하게 된다. `MAX_RANGE_LOOKBACK_MS = 14일` 상한 추가(+`console.warn`, 응답에 `rangeCapped`). 14일은 한국 최장 연휴+주말(~10일)을 여유 있게 덮어 정상 운영에선 발동하지 않는 값 — 양방향 테스트.
4. **잔여 비용(수용)**: 장애 중 매 tick `getPortfolioTotalKRW(true)`가 KIS를 재조회. `strategy-eval`이 이미 같은 5분 주기로 도는 부하라 새로운 부하 클래스는 아님.

### `notify/index.ts` — 안전 치명 알림

`sendAlert`는 시그니처·fire-and-forget 계약 그대로(`void`, I/O 전 즉시 반환 — 테스트됨). 로직은 `dispatchAlert()`로 이동해 채널별 결과를 집계·로깅. `.catch(() => {})` 제거.

critical 알림이 **아무 채널에도 도달하지 못한 경우** 고정 grep 토큰으로 기록:
```
[notify] 🚨 CRITICAL_ALERT_UNDELIVERED — title="..." channel=both failed=[slack,telegram] ...
```
→ `pm2 logs stockinvest --err | grep CRITICAL_ALERT_UNDELIVERED`

의도적으로 실패 로깅 제외: 비-critical 레벨의 미설정 채널(운영은 `notify_channel='telegram'`인데 코드 기본값이 `'both'`라, 미설정 슬랙을 오류로 찍으면 로그가 묻힌다).

### 🔒 부수 보안 조치 — 토큰 리댁션

에러 문자열이 **이제 HTTP JSON 응답으로 흘러나간다.** 텔레그램 API URL에는 **봇 토큰이 박혀 있으므로**, 에러 메시지에 URL이 섞이면 토큰이 응답으로 유출될 수 있다. developer가 `redactSecrets`를 추가해 모든 에러 경로를 통과시켰다. **reviewer 최우선 검증 대상.**

### 범위 밖으로 플래그된 것

- (a) dead-man's switch 부재 — 영구 실패가 로그엔 남지만 N회 연속 실패 후 에스컬레이션은 없음(신규 영속 상태 필요)
- (b) `notify_channel` 캐시 무효화 훅 부재 — 채널 변경이 최대 30초 지연
- (c) 재시도 tick이 전송 성공 여부를 알기 전에 KIS 재조회(`forceFresh`) — `EGW00201` 레이트리밋과 함께 관찰 필요
- (d) 메시지 길이 가드 부재 — 창 길이로는 도달 불가함을 확인했으나 유니버스가 커지면 절단 없음
- (e) 테스트 파일이 여전히 typecheck 제외 — 기존 backlog

## Reviewer 결과 (2026-08-06)

**판정: CONDITIONAL_PASS** (Critical 0 / High 0 / Medium 1 / Low 2). `git -c core.fileMode=false diff` + 전체 파일 정독, `npm run typecheck`(clean) + `npm test`(**49 suites/558 tests** 재확인, 기준선과 일치) 직접 재실행.

### 🔒 비밀값 유출 감사 (Priority 1) — 살아있는 유출 경로 없음

실제 발신 경로는 전부 `redactSecrets` 를 거친다: HTTP 비2xx 바디 스니펫, fetch reject 메시지, `cause.code`, `cause.errors`(AggregateError 개별 항목까지 telegram.ts는 map 처리). 전용 테스트(`send-result.test.ts`)가 "URL에 박힌 토큰"·"웹훅 URL 포함 에러" 케이스를 봇 토큰·웹훅 URL 리터럴 그대로 넣어 검증하며 실제로 통과함을 재실행 확인.

**[MEDIUM] 유일한 미적용 지점 — 계약위반 방어 catch가 redactSecrets를 안 거친다.**
- `src/app/api/cron/trade-report/route.ts:65-71` (`trySend`)와 `src/lib/notify/index.ts:49-58` (`attempt`) 는 "sendTelegramAlert/sendSlackAlert가 계약을 어기고 던질 경우"를 방어하는 catch인데, 여기서 `notifyFailed(e.message)` 를 **redactSecrets 없이** 그대로 만든다. `trySend` 쪽은 이 값이 `failed[].error`로 **HTTP JSON 응답에 직접 노출**된다(Priority 1이 정확히 우려한 지점).
- 현재는 도달 불가능한 dead code에 가깝다: `getCredential()`(`src/lib/credentials.ts:33-41`)은 내부 DB 조회를 자체 try/catch로 흡수해 항상 문자열을 반환하므로 던지지 않고, `sendTelegramAlert`/`sendSlackAlert` 내부 fetch 관련 throw는 모두 자체 try/catch가 이미 잡는다. 즉 오늘 시점엔 이 두 catch가 실행될 조건이 없다.
- 하지만 두 함수 앞단(현재는 `getCredential` 호출뿐)에 예외 가능 코드가 조금이라도 추가되는 순간, 무방비 유출 경로가 된다. 테스트도 이 분기를 `'boom'`처럼 비밀값이 없는 메시지로만 커버해 리댁션 누락을 못 잡는다(`dispatch-alert.test.ts` "예외를 던져도" 케이스, `route.test.ts` "500이 아니라 sent=false" 케이스 둘 다).
- 권고(수정은 안 함, 감사만): `trySend`/`attempt` catch에서도 `redactSecrets(msg)`를 secrets 인자 없이라도 호출 — 정규식 기반 `bot\d+:...`/`hooks.slack.com/services/...` 패턴 리댁션은 토큰 값 없이도 동작하므로 방어선을 통일할 수 있다.

**[LOW] slack.ts 는 telegram.ts 와 달리 `cause.errors`(AggregateError 하위 배열)를 안 훑는다.** `causeCodeOf(e)` 로 `cause.code`/`cause.message`만 본다(`src/lib/notify/slack.ts:79`). 보안 유출은 아님(단순 누락이라 로그에 안 남을 뿐) — 원인은 2026-08-04 사고가 텔레그램(IPv6 unreachable) 특이 케이스였던 탓에 slack.ts는 대칭 처리가 안 된 것으로 보임. 슬랙 장애 시 진단 정보가 텔레그램보다 부실해질 수 있음.

### `sendAlert()` 논블로킹 — PASS

코드상 `dispatchAlert`의 첫 `await`(`getChannel()`) 전에 I/O 없음, `sendAlert`는 `void dispatchAlert(...).catch(...)`로 즉시 반환(async 함수 호출도 동기 프리픽스만 실행 후 반환하므로 호출부를 막지 않음). 안전 경로(`kill-switch.ts:25,117` / `dry-run.ts:255` / `db.ts:93` 동적 import) 전부 `await` 없이 fire-and-forget 유지 확인. `dispatch-alert.test.ts`의 "void 를 반환하며 호출부를 블록하지 않는다" 테스트로도 확인.

### `last_sent_at` 상태기계 — PASS (예외 1건, 아래)

{slack,telegram} × {delivered,failed,skipped} 전 조합을 수기 대조: "하나라도 delivered면 advance / delivered=0∧failed≥1이면 hold / 전부 skipped면 advance" 규칙이 실도달 가능한 모든 조합에서 스팸도 고착도 만들지 않는다. `force=1`은 항상 미갱신 확인. Leader 원지침의 결함(부분 성공 시 슬랙 스팸)을 developer가 잡아낸 교정이 정확함을 재확인.

**[LOW] `report_trade_channel` 이 유효하지 않은 문자열로 저장된 상태(예: `'slack'|'telegram'|'both'|'none'` 밖의 값)로 cron이 돌면 `attempts=[]`가 되어 `sent=false`·`advanced=true`(즉 `last_sent_at` 갱신)로 조용히 지나가고, 에러 로그 가드(`attempts.length > 0 && !sent`)도 `attempts.length===0`이라 안 걸려 흔적이 전혀 안 남는다.** 원인: 현재 상태기계가 "0회 시도"를 "unconfigured 전원"과 동일하게(`retryable = delivered.length===0 && failed.length>0` → false) 취급. UI `<select>`(`SettingsPage.tsx:595`)는 4개 값으로 제한되어 정상 경로로는 도달 불가하지만, `PATCH /api/settings/safety`(`route.ts:117-140`, `reportChannel` → `report_trade_channel`)는 값을 검증 없이 그대로 저장한다(이 diff 범위 밖의 기존 결함). 이 상태가 되려면 이미 유효하지 않은 config가 선행돼야 하므로 이번 수정이 만든 신규 취약점은 아니고, 두 결함이 겹쳤을 때만 재현되는 latent 조합.

### 14일 `rangeStart` cap — PASS

산수 확인: `MAX_RANGE_LOOKBACK_MS = 14*24*3600_000`, `lookbackFloor = now - cap`, `rangeCapped = rawRangeStart < lookbackFloor`. 테스트로 40일 방치 시 14.00일로 정확히 절단, 10일 정상 공백(최장 한국 연휴 상당)은 미절단 확인. 최장 실제 공백(~10일) < 14일 여유 확보 — 정상 운영 중 발동 불가 확인.

### `sent` 시맨틱스 — PASS

`sent = delivered.length > 0` 로 정의돼 있어 `sent:true`가 `delivered.length===0`인 채로 반환될 수 있는 코드 경로 자체가 존재하지 않음(구조적으로 불가능). `partial = sent && failed.length > 0` 도 문서화된 의도(skip은 partial에 안 셈)와 일치.

### 호출부 — 안 깨짐, 단 회람 지시 수치 정정

`sendAlert` 정적 import 9개 파일 + `db.ts` 동적 `import('@/lib/notify')` 1개 = **실측 10개 파일에서 13회 호출**(회람 지시엔 "17곳/12파일"로 적혀 있었으나 `grep -rn "sendAlert" src` 실측 결과와 다름 — 주석 텍스트 매칭 오염 제외 후 재계산). 전부 시그니처 동일(`(level,title,body): void`), `await`/`.then`/`.catch` 체이닝 없이 순수 statement 호출 유지. `db.ts:93`의 동적 import 경로(순환참조 회피용)도 `m.sendAlert(...)` 형태 그대로 유지되어 정상 동작. `git status src/lib/safety/` 클린 확인(safety 레이어 무변경).

- 2026-08-06 [14:30] reviewer 완료 — CONDITIONAL_PASS(Critical 0/High 0/Medium 1/Low 2). 비밀값 유출: 실사용 경로는 안전, 계약위반 방어 catch 2곳(route.ts trySend / notify/index.ts attempt)만 redactSecrets 미적용(현재 dead code, 방어선 통일 권고). last_sent_at·14일 cap·sendAlert 논블로킹 전부 PASS.

## 진행 로그

- 2026-08-06 [14:10] Leader: task 생성. 착수 실측에서 **같은 결함의 두 번째 인스턴스**(`notify/index.ts`의 안전 치명 알림 경로)를 발견해 범위에 포함.
- 2026-08-06 [14:40] developer 완료. Leader 지침의 결함(부분 성공 시 슬랙 스팸)을 발견·교정. 영구 실패 시 창 무한 확대 문제 발견·상한 추가. 토큰 리댁션 추가. 49 suites/558 tests.
- 2026-08-06 [14:30] reviewer 완료 → CONDITIONAL_PASS(Medium 1/Low 2). 상세는 위 "Reviewer 결과" 참고.

## Leader 판정 — reviewer 지적 3건 (2026-08-06)

reviewer **CONDITIONAL_PASS** (Critical 0 / High 0 / Medium 1 / Low 2). 살아있는 비밀값 유출 경로 없음, `sendAlert()` 논블로킹 확인, `last_sent_at` 상태기계·14일 cap 전 조합 검증 통과. developer가 내 지침을 뒤집은 판단(부분 성공 시 갱신)도 재확인됨.

**3건 전부 지금 수정 지시.**

### MEDIUM — "지금은 도달 불가"를 수정 회피 사유로 받지 않는다

`trySend`(route.ts:65-71)·`attempt`(notify/index.ts:49-58)의 계약위반 방어 catch가 `notifyFailed(e.message)`를 **리댁션 없이** 만든다. route.ts 쪽은 그 값이 **HTTP JSON 응답의 `failed[].error`로 직행**한다 — 이번 작업이 보호하려는 바로 그 표면이다.

developer와 reviewer 둘 다 "오늘은 도달 불가"로 추적했다. 맞다. 그런데 **그건 오늘 코드의 성질이지 보장이 아니다.** 리댁션 스킴 전체가 응답 표면에 대한 defense-in-depth인데, "지금 아무것도 안 던지니까" 한 경로만 무방비로 두는 것이 바로 다음 사고가 쓰여지는 방식이다.

게다가 **테스트가 이 분기를 `'boom'`(비밀값 없는 문자열)으로만 덮고 있어**, 리댁션 누락이 회귀해도 조용히 통과한다. → **비밀값이 담긴 메시지를 던지는 테스트 추가**까지 지시.

이는 Phase 2에서 내가 ENUM 가드에 적용했던 원칙과 동일하다: **가드 자신의 실패 경로가 무방비면 그 가드는 스스로를 무력화한다.**

### LOW 1 — Slack 진단 대칭성

`slack.ts:79`가 `cause.errors`(AggregateError 하위)를 안 훑어 텔레그램보다 진단이 부실하다. 유출은 아니지만 **이번 작업의 목적 자체가 "실패를 보이게 하는 것"** 이므로 대칭을 맞추는 것이 옳다.

### LOW 2 — 0회 시도 상태가 흔적 없이 통과 (근본 원인까지 수정)

`report_trade_channel`이 유효 4값 밖이면 `attempts=[]` → 상태기계가 이를 "전원 미설정"과 동일 취급 → `sent=false`인데 **`last_sent_at`은 갱신**되고, 에러 로그 가드(`attempts.length > 0 && !sent`)도 안 걸려 **흔적이 전혀 안 남는다.** 이 task가 없애려는 실패 모드가 **다른 문으로 재현**되는 셈.

→ ① `attempts.length === 0` 방어 분기 추가(요란하게 로깅, 조용한 갱신 금지) ② **근본 원인**: `PATCH /api/settings/safety`(route.ts:117-140)가 `reportChannel`을 **검증 없이** 저장한다(UI `<select>`는 4값 제한이나 API는 무방비) → 검증 추가. **의도적 범위 확장** — 뒤에서 막는 것보다 문을 닫는 게 낫고 변경이 작다.

### 📌 내 브리핑 오류 정정

내가 reviewer에게 "`sendAlert` 호출부 17곳/12파일"이라고 전달했으나 reviewer 실측은 **13곳/10파일**이다. developer 보고서의 숫자를 **검증 없이 그대로 전달**한 내 잘못이다. 숫자는 인용 전에 확인할 것.

## Developer 2차 결과 — reviewer 지적 3건 반영 (2026-08-06)

- [15:30] **MEDIUM**: `trade-report/route.ts` `trySend()` · `notify/index.ts` `attempt()` 두 catch를 `redactSecrets()` 통과시킴. 인자 없이 호출해 정규식 패턴(`bot<숫자>:<토큰>`, `hooks.slack.com/services/...`)만 적용 — 이 지점에선 비밀값 원문을 모르기 때문. **회귀를 잡지 못한 원인이던 커버리지 공백도 메움**: 기존 테스트는 전부 `'boom'`(비밀값 없음)이라 유출이 조용히 통과했다. 토큰/웹훅 URL이 든 예외를 각 catch로 던지고 응답 JSON 전체·로그 전체를 `not.toContain(TOKEN)`으로 검사하는 테스트 추가
- [15:30] **LOW 1**: `slack.ts`가 `cause.errors`(AggregateError 하위 원인)를 훑도록 telegram.ts와 동일 구조로 맞춤. 듀얼스택 실패 시 IPv4/IPv6 원인이 모두 남는다
- [15:30] **LOW 2 ①**: `isReportChannel()` 타입가드를 `readConfig()` 직후 게이트로 배치 — 손상된 값이면 **작업 시작 전에** 잘라내고(KIS·DB 낭비 방지) `ok:false, skipped:'channel_invalid'` + 에러 로그. `last_sent_at` 미갱신이라 설정을 고치면 다음 tick이 그동안 구간까지 포함해 발송한다(이력 무손실)
- [15:30] **LOW 2 ①-b**: 전송 블록의 `attempts.length === 0` 방어 분기도 유지 — 게이트 통과 후엔 도달 불가지만 도달했다면 게이트와 분기 조건이 어긋났다는 뜻이므로 요란하게 로깅하고 **갱신하지 않는다**(보수적 실패 = 구간 이력 보존)
- [15:30] **LOW 2 ②(근본원인)**: `PATCH /api/settings/safety`에 `PATCH_ENUMS` 검증 추가(`reportChannel` 4값 / `reportMode` 2값). **검증 전량 선행 후 저장** — 중간 거절 시 앞 필드만 반영된 부분 상태가 남기 때문. 위반 시 400 + 아무것도 쓰지 않음. UI `<select>`가 정확히 이 4값/2값이라 정상 저장 경로에 영향 없음(실측 확인)
- [15:30] 검증: `npm run typecheck` 클린 · **50 suites / 585 tests 전부 통과**(1차 49/558 → +1 suite, +27 tests). build·pm2·git·DB쓰기·텔레그램 발송 전부 없음
- [15:30] 📌 `sendAlert` 호출부 실측 재확인: **13곳 / 10파일** (reviewer 측정이 정확). 1차 보고의 17곳/12파일은 정의부·import·테스트 mock을 포함한 raw grep이었고, `portfolio-snapshot/route.ts:110`은 주석이라 호출이 아니다. 내 보고 오류가 Leader 브리핑까지 전파된 것 — 수치는 인용 전 필터링해서 셀 것

## Leader 판정 — 2차 수정 + `handleSave` 범위 결정 (2026-08-06)

### 2차 수정 3건 전부 수용

`typecheck` clean, **50 suites / 585 tests**(49/558 → +1 suite, +27 tests).

- **MEDIUM**: `redactSecrets()`가 두 계약위반 catch에 적용됨. 테스트가 **응답 본문 전체·로그 출력 전체**를 대상으로 `not.toContain(TOKEN)`을 검사하도록 강화 — 필드 하나만 보는 게 아니라서 **다른 필드로 새는 회귀도 잡힌다.** 기존 테스트가 `'boom'`(비밀값 없음)만 써서 회귀가 조용히 통과하던 공백이 메워짐.
- **LOW 1**: `slack.ts`가 `telegram.ts`와 동일하게 `cause.errors` 순회. 듀얼스택 실패 시 IPv4·IPv6 원인이 모두 보존됨.
- **LOW 2**: `isReportChannel()` 타입가드가 `readConfig()` 직후 실행 → **손상값이 KIS/DB 작업 이전에 차단**된다(아무도 안 받을 리포트를 만든 뒤가 아니라). `PATCH /api/settings/safety`에 `reportChannel`·`reportMode` 검증 추가, **전체 검증 후 일괄 쓰기**(중간 실패로 일부 필드만 반영되는 2차 손상 방지).

### `attempts.length === 0` backstop을 "갱신 안 함"으로 둔 근거 (developer, 수용)

게이트가 생긴 이상 이 분기는 **도달 불가여야 정상**이다. 따라서 "전 채널 미설정 시 갱신"을 정당화했던 비용 논리(무의미한 5분 루프 회피)가 **여기엔 적용되지 않는다** — 저울에 올릴 반대편이 없다. 남는 것은 "게이트와 분기 조건이 어긋난 상태"이고, 그럴 때 보수적 실패는 **이력을 보존하는 쪽**이다: 갱신하지 않으면 설정을 고쳤을 때 그 공백 구간이 리포트에 담기지만, 갱신하면 그 창은 **모든 미래 리포트에서 영구 삭제**된다.

### 🔴 `handleSave` — 범위 확장 결정 (Leader)

developer가 수정하지 않고 플래그만 한 건: `SettingsPage.tsx`의 `handleSave`가 `Promise.all` 안에서 `await fetch(...)`만 하고 **`res.ok`를 검사하지 않는다**(코드 실측 확인, 180~198행). 네트워크 오류만 catch하므로 **400 응답이 "저장됨" 성공 경로로 간다.**

**수정하기로 결정.** 근거:

1. **T-007의 존재 이유가 "거짓 성공 보고 제거"다.** `sent:true`(실제로는 실패)를 고치는 바로 그 커밋에서 `저장됨`(실제로는 거부)을 내보내면 **자기모순**이다. 같은 결함 클래스가 한 층 위에서 반복된다.
2. **우리가 만든 문제다.** 이전엔 4xx를 반환하는 경로가 없어 `res.ok` 미검사가 무해했다. 이번 검증 추가가 이 잠재 버그를 **실제 도달 가능하게 만들었다.** 우리가 열었으니 우리가 닫는다.

추가 지시: 같은 형태(`res.ok` 미검사)가 다른 저장 핸들러에도 있으면 **목록만 보고**하고 임의 수정 금지 — 범위는 내가 정한다.

### developer의 다른 두 판단

- **`reportMode` 동반 검증 추가 — 수용.** 같은 enum 쓰기 문, 한 줄, 그리고 **내가 찾기 전에 스스로 신고**했다.
- **안전 키(`dryRun`/`killSwitch`/`orderMaxPct`) 검증 확장 거부 — 옳다. 했다면 반려했을 것이다.** 라이브 안전 경로에 검증을 넣는 것은 그 경로의 동작을 바꾸는 일이고, 인접 작업의 관성이 아니라 **자기 근거를 갖춘 별도 리뷰**가 필요하다. 후보로만 등록.

### 📌 내 아티팩트 정리

T-007 ledger 말미의 stray `</content>`는 **내 write 아티팩트**였다. 제거하고 `agent-vault/` 전체를 스캔해 잔여 없음 확인.

## Developer 3차 결과 — `handleSave` false-success 차단 (2026-08-06)

- [15:50] **핵심 정정**: 이 결함은 "내 검증 때문에 잠재→현재화된 것"이 아니라 **원래부터 살아있던 오표시**였다. `/api/settings/strategies` PATCH는 이미 `backtestIntervalM` 범위 위반(1–10080)과 `id required`를 **400으로 거절**하고 있었고, `handleSave`는 그 400을 성공으로 취급해 **"저장됨 ✓"** 를 띄우고 `isDirty`까지 내렸다. 즉 T-007의 "실패를 성공으로 보고" 결함이 UI 층에 이미 존재했다
- [15:50] `patchSetting()` 헬퍼 추가 — `res.ok` **와** 본문 `ok:false`를 모두 검사하고(형제 설정 섹션들의 판정 방식과 동일) 서버가 준 `error` 문구를 그대로 실어 반환. **던지지 않고 반환**하므로 `Promise.all`이 첫 실패에서 끊기지 않고 전 요청 결과를 모아 판단한다
- [15:50] 실패 시 `saveState='error'` + `isDirty` **유지** → 버튼이 "다시 시도"로 남아 재시도 가능. 성공 경로에서만 `isDirty=false`
- [15:50] 거부(rejected)와 네트워크 오류(network)를 구분해 노출. 여러 건 실패 시 **거부 사유를 우선** 표시(사용자가 고칠 수 있는 정보) + `(외 N건 실패)`
- [15:50] 표시 위치는 토스트가 아니라 **sticky 저장 바**를 선택 — 거부는 사용자가 값을 고쳐야 풀리는데 토스트는 자동 소멸한다. 재시도 버튼 바로 옆이라 동선도 짧다. `role="alert"`, `minWidth:0`+`wordBreak` 로 412px에서 긴 사유도 줄바꿈 수용
- [15:50] 테스트: RTL·jsdom 미설치 + `npm install` 금지 환경이라 컴포넌트 대신 판정 로직을 직접 검증(`patchSetting`은 DOM을 안 쓰는 순수 fetch 함수). 9 케이스 — 200/비JSON본문/400+사유/strategies 기존 400/사유없는 5xx/200+ok:false/네트워크/Promise.all 비중단
- [15:50] 검증: typecheck 클린 · **51 suites / 594 tests**(2차 50/585 → +1 suite, +9 tests). build·pm2·git·DB쓰기·텔레그램 발송 없음

### 같은 형태(res.ok 미검사)로 남아있는 변경 핸들러 — **발견만, 수정 안 함**

| # | 위치 | 요청 | 증상 |
|---|---|---|---|
| 1 | `SettingsPage.tsx` `autoSave` | PATCH `/api/settings/safety` `{dryRun}`/`{killSwitch}` | **가장 위험**. DRY_RUN·KILL_SWITCH 토글이 낙관적으로 먼저 켜지고, 저장 실패해도 UI는 서버가 수락하지 않은 상태를 계속 보여준다. 내 `PATCH_ENUMS`와 무관(두 키 모두 검증 대상 아님) — 순수 기존 결함 |
| 2 | `SettingsPage.tsx` `toggleHybridMode` | PATCH `/api/settings/hybrid` | 동일 형태. 상태를 먼저 바꾸고 실패를 삼킴 |
| 3 | `components/OrderDetail.tsx:69` | DELETE `/api/orders/:id` | 주문 취소 실패해도 `onCancelDone()`+`onClose()` 무조건 실행 → 취소된 것처럼 보임 |
| 4 | `components/ScenarioDetail.tsx:308` | POST `/api/signals/:id/reject` | 거절 실패해도 무조건 `router.push` |
| 5 | `components/SafetyBar.tsx:55` | POST `/api/safety/cancel-all` | `res.ok`/`data.ok` 미검사. 에러 본문이면 `{cancelled:0, failed:0}`으로 읽혀 **전량취소가 정상 완료된 것처럼** 표시 |

**이미 올바른 것(조치 불요)**: `NotifyChannelSection.save`/`saveProjectTag`, `ExchangeAccountSection.save`, `LlmProviderSection.save`, `ScenarioDetail.handleConfirm` — 전부 본문 `ok`를 검사하고 `error`를 토스트로 노출한다.
**코드베이스 관례**: 형제 핸들러들은 `res.ok`가 아니라 **본문 `ok`** 를 본다. `patchSetting`은 둘 다 보므로 상위호환.

### 범위 밖 후보 (Leader 판단 대기)

- `PATCH /api/settings/safety` 의 안전 키(`dryRun`/`killSwitch`/`orderMaxPct`/`dailyOrderMaxPct`) 값 검증 — 살아있는 안전 경로의 동작을 바꾸므로 별도 리뷰 필요. 인접 작업의 관성으로 끼워넣지 않았다

## 🔴 Leader 정정 + 범위 결정 — 안전 제어의 거짓 성공 (2026-08-06)

### 내 인과 규명이 틀렸다 (developer 정정, 수용)

나는 "`handleSave`의 `res.ok` 미검사는 잠재 버그였고 **우리의 400 검증 추가가 그것을 실제화**시켰다"고 판단했다. **틀렸다.**

`/api/settings/strategies` PATCH는 **이미 400을 반환하고 있었고**(`backtestIntervalM must be 1–10080`, `id required`), `handleSave`는 저장할 때마다 모든 전략의 `backtestIntervalM`을 보낸다. 즉 **거부된 전략 저장이 그동안 계속 "저장됨 ✓"으로 표시되고 `isDirty`까지 초기화**돼 왔다.

→ 우리 변경은 **이미 살아있던 결함에 두 번째 진입로를 추가**했을 뿐이다. 결론(고친다)은 같지만 근거가 달라지고, **더 강해진다** — 가정된 위험이 아니라 실재하던 손실이다.

### 전수 조사 결과 — `res.ok` 미검사 5곳

| # | 위치 | 요청 | 증상 | 처리 |
|---|---|---|---|---|
| 1 | `SettingsPage.tsx` `autoSave` | PATCH safety `{dryRun}`/`{killSwitch}` | **킬스위치·DRY_RUN 토글이 낙관적 UI**라 실패해도 사용자는 적용된 줄 안다 | **이번 범위** |
| 5 | `SafetyBar.tsx:55` | POST `/api/safety/cancel-all` | `res.ok`·`body.ok` 둘 다 미검사 → 에러 응답이 **"비상 전체취소 완료"로 렌더** | **이번 범위** |
| 2 | `SettingsPage.tsx` `toggleHybridMode` | PATCH hybrid | 동일 패턴 | 백로그 |
| 3 | `OrderDetail.tsx:69` | DELETE `/api/orders/:id` | 주문취소 실패해도 완료 콜백·닫기 | 백로그 |
| 4 | `ScenarioDetail.tsx:308` | POST `/api/signals/:id/reject` | 거절 실패해도 navigate | 백로그 |

### #1·#5를 이번 범위에 넣은 근거

이 둘은 "같은 결함의 반복"이 아니라 **실자금 시스템의 비상 제어에서 발생하는 T-007 결함 클래스**다:

- **#1**: 사용자가 킬스위치를 켰는데 PATCH가 실패하면, 토글은 낙관적으로 켜진 상태로 남고 **서버는 수락한 적이 없다.** 사용자는 매매가 멈춘 줄 알고 자리를 뜬다 — **정확히 멈추려는 순간에 의도치 않은 실매매로 가는 직행로**다.
- **#5**: 실패한 비상 전체취소가 완료로 렌더된다. `{cancelled:0, failed:0}`이 "취소할 게 없었다"로 읽히는데 실제 의미는 "요청이 실패했다" — **정반대인 두 상태가 동일하게 보인다.**

`handleSave`를 범위에 넣을 때 쓴 논리가 여기 **더 강하게** 적용된다: "리포트가 배달을 거짓 보고한 것"을 고치면서 "**킬스위치가 작동을 거짓 보고하는 것**"을 남겨두는 것은 변호 불가능하다.

**추가 요구**: #1은 낙관적 UI이므로 **실패 시 컨트롤을 서버 실제 상태로 되돌려야** 한다 — 사용자가 원했던 상태를 그대로 표시한 채 옆에 에러만 띄우면 위험은 그대로다. #5는 **"취소 실패"와 "취소할 것 없음"을 구별**해야 한다.

### ⚠️ 사용자 보고 필수

#1·#5는 **이번 작업이 만든 것이 아니라 지금 운영에 살아있는 결함**이다. 사용자에게 반드시 고지한다.

## Developer 4차 결과 — 안전 컨트롤 false-success 차단 #1·#5 (2026-08-06)

- [16:10] **공통 헬퍼 `src/lib/http.ts` 신설** — `requestJson()` 이 `res.ok` **와** 본문 `ok:false` 를 모두 검사하고 실패를 `{kind:'rejected'|'network', message}` 로 **반환**(던지지 않음). `patchSetting` 이 이걸 위임하도록 바꿔 판정 로직이 한 곳만 남게 했다. Leader가 예고한 코드베이스 전수 sweep의 착지점이 된다
- [16:10] **#1 `autoSave`(DRY_RUN·KILL_SWITCH)** — 실패 시 알림만으로 끝내지 않고 **컨트롤을 서버 실제 상태로 되돌린다**. 1순위 GET 재조회(`cache:'no-store'`), 2순위 직전 값 복원. 재조회를 1순위로 둔 이유: 네트워크 오류는 **요청이 서버에 닿아 이미 적용됐을 수도 있어**, 직전 값으로 되돌리는 것이 오히려 거짓이 될 수 있다. 재조회 성공/실패를 문구로도 구분해 알린다
- [16:10] **#5 `SafetyBar` 비상 청산** — `emState` 에 `'failed'` 추가. 요청 실패 시 `emResult` 를 **null 로 비워** 완료 요약이 절대 렌더되지 않게 하고, 빨간 `role="alert"` 배너 + "다시 시도" 버튼을 남긴다(자동 소멸 없음). 성공 응답은 `classifyCancelAll()` 로 3분류: `nothing_to_cancel`(취소할 주문 없음 — ✓ 안 붙임) / `partial`(⚠ N건 취소·M건 실패) / `success`(✓ 취소 완료). **"요청 실패"·"취소할 주문 없음"·"전부 취소함" 세 정반대 상태가 한 문구로 뭉개지던 것을 분리**
- [16:10] 순수 함수 2개(`revertSafetyState`, `classifyCancelAll`)로 결정 지점을 뽑아 RTL 없이 검증 가능하게 만듦
- [16:10] 테스트 +20: `lib/__tests__/http.test.ts`(11 — 2xx/비JSON/4xx/5xx+HTML에러페이지/200+ok:false/네트워크/Promise.all 비중단), `components/__tests__/safety-bar-outcome.test.ts`(5 — "취소할 주문 없음"과 "전부 실패"가 절대 같은 분류가 아님 포함), `patch-setting.test.ts` +5(`revertSafetyState`)
- [16:10] 검증: typecheck 클린 · **53 suites / 614 tests**(3차 51/594 → +2 suites, +20). build·pm2·git·DB쓰기·텔레그램 발송 없음. API 계약·`src/lib/safety/*` 미변경
- [16:10] **#2·#3·#4 는 지시대로 손대지 않았다** (`toggleHybridMode` / `OrderDetail` 취소 / `ScenarioDetail` 거절) — 후속 sweep 태스크 대상. `requestJson` 이 그 sweep의 공용 도구가 된다

## Reviewer 결과 — 라운드 2~4 감사 (2026-08-06)

**판정: CONDITIONAL_PASS** (Critical 0 / High 0 / Medium 2 / Low 1). `git -c core.fileMode=false diff` + 신규 파일 전체 정독, `npm run typecheck`(clean) + `npm test`(**53 suites/614 tests** 재확인, 기준선과 일치) 직접 재실행. 운영 DB SELECT 1회(`report_trade_channel`/`report_trade_mode` 값 확인) 외 쓰기·텔레그램·cancel-all 트리거 없음.

### Priority 1 — #1 KILL_SWITCH/DRY_RUN 되돌림 — 헤드라인: UI가 서버에 없는 상태를 보여줄 수 있는가? **아니오.**

재조회 우선 전략의 인과는 타당하고 구현도 정확하다: GET 은 `dynamic='force-dynamic'` + 클라이언트 `cache:'no-store'` 이중 방어로 캐시 오염 경로 없음. dryRun/killSwitch 는 PATCH 에 값 검증이 없어 결과는 `{ok:true}` 아니면 DB 예외발 500(비JSON) 뿐인데, `requestJson` 이 둘 다 정확히 `rejected` 로 분류함을 재확인. 토글 checked·ON/OFF 라벨·설명 문구 세 가지 전부 동일한 `safety` state 파생값이라 `setSafety` 1회로 원자적으로 함께 바뀐다 — 부분 되돌림이 구조적으로 불가능. 두 메시지("서버 실제 상태로 되돌렸습니다" vs "확인 못해 직전 값으로 되돌렸습니다, 새로고침 권장")도 명확히 구분됨. 동시 토글 레이스는 `setSafety(current => ...)` 함수형 업데이트 + `previous` 가 해당 필드만 담은 Partial 이라 서로의 낙관적 값을 덮지 않음을 수기 트레이스로 확인. "PATCH 성공+응답 유실" 케이스도 DB write 가 응답 전송 전 commit 되므로 뒤이은 재조회가 항상 사후 상태를 읽어 안전.

**[MEDIUM] 재조회 성공 시 `revertSafetyState`(`SettingsPage.tsx:73-79`)가 `serverSafety` 를 통째로 반환해, 되돌리는 필드 외에 같은 화면에서 편집 중이던 다른 안전설정(주문한도%·변동성가드 임계값·화이트리스트 등 `SafetyData` 나머지 10개 필드)까지 조용히 서버 값으로 덮어쓴다.** `patch-setting.test.ts:114-117`가 이 전체 교체를 의도된 동작으로 명시 단언하고 있어 알고 한 설계이지만, 부작용(다른 미저장 편집의 무경고 유실)은 논의된 적이 없다. 재현: ① 주문한도% 입력 중(미저장) ② DRY_RUN/KILL_SWITCH 토글 ③ 그 PATCH만 실패 ④ 재조회 성공 → 입력 중이던 값이 경고 없이 서버 값으로 되돌아간다. 이 앱의 주 타깃(모바일 셀룰러)에서 "토글 PATCH만 실패, 직후 재조회는 성공"은 드물지 않은 순간 장애 패턴. 표시값 자체는 서버 진실과 일치하므로 헤드라인 질문에는 해당하지 않으나, 별개의 무경고 데이터유실 결함.

### Priority 2 — #5 cancel-all 분류 — **네 결과가 증명 가능하게 상호배타적이다.**

`classifyCancelAll()`은 (cancelled,failed) 순수함수로 `nothing_to_cancel`/`partial`/`success` 3분류, `emState='failed'`가 요청 실패를 완전히 분리된 상태로 관리 — 5개 전용 테스트로 상호배타성 확인. 요청 실패 시 `setEmResult(null)`이 완료 요약 렌더 자체를 원천 차단함을 렌더 조건(`emState==='done' && emResult`)으로 확인. 과거 결함 재현 경로(`res.json()`이 HTML 500 페이지에서 throw → catch가 idle로 리셋)는 `/api/safety/cancel-all` route.ts:14의 무방비 SELECT가 그대로라 지금도 유발 가능하지만, `requestJson`이 JSON 파싱 실패를 캐치해 `!res.ok`만으로 `rejected`를 반환하므로 정확히 `failed` 상태로 착지함을 확인 — 예전처럼 idle로 새지 않는다.

### Priority 3 — `requestJson()` 견고성

명시된 6가지(비2xx+JSON / 비2xx+HTML / 2xx+ok:false / 비JSON 2xx / 네트워크 거부 / never throws) 중 5가지는 정확. **[MEDIUM] `src/lib/http.ts:44-45`** — `2xx + {ok:false}` 인데 `error` 필드가 없거나 빈 문자열이면 **성공으로 오분류된다**:
```
const reason = parsed?.ok === false ? (parsed.error ?? '') : '';
if (!res.ok || reason) { ... }   // reason==='' 면 이 분기를 스킵 → 성공 처리
```
실패 판정을 `parsed?.ok===false` 가 아니라 파생 문자열 `reason` 의 truthy 여부로 하고 있어, ok:false 와 "메시지 없음"이 겹치면 실패가 사라진다. 오늘 연결된 4개 엔드포인트(safety GET/PATCH, strategies PATCH, cancel-all)는 ok:false 에 항상 error 를 동반하거나 비2xx status 를 쓰므로 현재 도달 불가다. 그러나 이 코드베이스에 이미 동일 모양의 실제 응답이 존재한다 — `trade-report/route.ts:117`의 `{ok:false, skipped:'channel_invalid', channel:...}`(status 기본값 200, error 필드 없음). 이 라우트는 아직 `requestJson`을 안 쓰지만 이 헬퍼가 "후속 sweep 의 공용 도구"로 명시 예고돼 있어(Developer 4차 결과) 재사용 시 조용히 재발할 수 있다. 이 태스크가 이미 "오늘 도달 불가는 보장이 아니다"(MEDIUM 리댁션 건)를 원칙으로 세웠으므로 같은 기준 적용. 테스트도 이 조합(ok:false + error 없음 + 2xx)은 커버 안 함 — `http.test.ts:76-81`·`patch-setting.test.ts:79-84` 둘 다 error 필드를 항상 채워 던진다. `patchSetting`이 `requestJson`에 위임하며 기존 동작은 안 바뀜을 재확인 — 9케이스 전부 그대로 통과.

### 리댁션·API계약·safety 레이어 — 무회귀 확인

`redactSecrets`가 두 계약위반 catch(trade-report `trySend`, notify/index `attempt`) 모두 통과함을 재확인, 라운드1 이후 신규 회귀 없음 — 신규 테스트가 **실제 봇 토큰·웹훅 URL 리터럴**을 예외에 담아 응답 JSON·로그 전체를 `not.toContain`으로 검사(필드 하나만이 아니라서 다른 필드로 새는 회귀도 잡힘). `slack.ts`가 `cause.errors`를 telegram.ts와 동일하게 순회하도록 대칭 확보, 전용 AggregateError 테스트 통과. `git status src/lib/safety/` 완전 클린. API 계약 변경은 `PATCH /api/settings/safety`의 `reportChannel`(4값)·`reportMode`(2값) 검증(전량 선행 후 일괄 저장, 부분반영 없음)뿐이고 `isReportChannel` 게이트는 KIS/DB 작업 이전에 위치함을 라인 단위로 확인. 운영 DB 직접 SELECT로 `report_trade_channel="telegram"`, `report_trade_mode="fixed"` 둘 다 유효값임을 확인 — 라운드1 LOW2("손상값이 이미 있으면 향후 모든 저장이 막힌다")가 현재 운영에는 없음.

### `/api/safety/cancel-all` 무방비 DB 쿼리 — UI 완화로 충분한가

`route.ts:14` 최상위 SELECT에 여전히 try/catch 없음(변경 없음, developer 신고와 일치). **UI 쪽은 충분** — 이 라우트가 던지는 어떤 실패든 `requestJson`이 `rejected`로 흡수해 `emState='failed'`로 착지, 거짓 완료 표시로 새는 경로 없음. **[LOW] 라우트 자체 잔여 결함(백로그 제안, 수정 안 함)**: ① 최상위 SELECT 실패가 구조화된 `{ok:false,error}`가 아니라 Next 기본 에러 페이지로 나가 서버측 관측성이 약함. ② 더 실질적: 루프 내부(43-44행) try/catch 범위가 `kis.cancelOrder()`+뒤따르는 `UPDATE orders`/`INSERT trade_logs` 두 쿼리까지 함께 감싸, **거래소 취소는 성공했는데 DB 쓰기만 실패하면 그 주문이 `cancel_failed`로 잘못 기록**된다(실제론 취소됨). 자금 관련 정합성 문제이나 이번 diff 밖(무변경)이고 방향이 반대(거짓 실패, 거짓 성공 아님)라 심각도 낮음.

### 호출부 실측

`requestJson`/`patchSetting` 직접 호출: **`SettingsPage.tsx` 3곳**(`patchSetting` 정의부 내부 1 + `autoSave` 재조회 `requestJson` 1 + `handleSave`의 `patchSetting` 2, `strategies.map` 포함) + **`SafetyBar.tsx` 1곳**(`handleEmergency`) — grep 결과와 직접 대조, 이 두 파일 밖 사용 없음. developer의 "#2·3·4는 손대지 않았다" 진술과 일치(`toggleHybridMode`/`OrderDetail`/`ScenarioDetail`은 여전히 옛 `fetch().catch()` 패턴).

- 2026-08-06 [16:30] reviewer 완료 — 라운드2~4 CONDITIONAL_PASS(Critical0/High0/Medium2/Low1). #1 되돌림: 헤드라인(서버에 없는 상태 표시) 안전, 단 재조회 성공 시 무관한 미저장 편집을 조용히 덮어씀(MEDIUM). #5 cancel-all 4분류 상호배타 확인. `requestJson` 2xx+ok:false+메시지없음 오분류 버그 발견(MEDIUM, 현재 도달 불가지만 동일 응답 모양이 trade-report에 이미 존재). 리댁션·safety레이어·API계약 무회귀. cancel-all 무방비 DB쿼리 확인, UI완화는 충분하나 라우트 자체 잔여결함 2건 LOW 백로그 제안.

## Leader 판정 — reviewer 2차 감사 Medium 2건 (2026-08-06)

reviewer **CONDITIONAL_PASS** (Critical 0 / High 0 / Medium 2 / Low 1). 53 suites/614 독립 재현.

### 🟢 헤드라인 검증 통과

- **#1 킬스위치**: "UI가 서버가 갖지 않은 상태를 보일 수 있는가?" → **없다.** 이중 캐시 방어(`dynamic='force-dynamic'` + `cache:'no-store'`), DB 커밋이 PATCH 응답보다 먼저라 재조회는 항상 쓰기 이후 진실을 관측, 체크상태·ON/OFF 라벨·설명문이 **단일 `setSafety` 호출**에서 파생돼 부분 되돌림이 구조적으로 불가능. 동시 토글 경합도 `previous`가 영향받은 키만 담아 서로 덮어쓰지 않음.
- **#5 비상취소**: 4가지 결과가 **증명 가능하게 비충돌**. 요청 실패는 별도 `emState='failed'` 분기이고 `emResult`를 null로 지워 완료 요약 렌더 조건에 도달 자체가 불가. 원래 버그의 정확한 경로(HTML 500 → `res.json()` throw → 구 catch가 idle 리셋)가 이제 `failed`로 착지함을 확인.

### Medium 2건 — 둘 다 수정 지시

**M1. `revertSafetyState`가 무관한 미저장 편집을 파괴** (`SettingsPage.tsx:73-79`)
재조회 성공 시 **서버 객체 전체**를 반환해 같은 폼의 다른 진행 중 편집(주문한도 %·변동성가드 임계·차단심볼 등 10개 필드)을 덮어쓴다. 거짓 UI는 아니지만(표시값=서버 진실) **경고 없는 데이터 손실 경로**이고, 모바일 우선 앱에서 평범한 네트워크 끊김으로 재현된다. **round 4가 만든 문제.** → 영향받은 키만 적용하도록 수정. 미저장 로컬 변경이 있는 필드는 **사용자 값이 표시돼야 옳다** — 그게 "미저장 편집"의 의미다.

**M2. `requestJson`이 `error` 없는 `{ok:false}`를 성공으로 오분류** (`http.ts:44-45`)
실패 분기가 `parsed?.ok === false`가 아니라 **파생된 reason 문자열의 truthiness**에 걸려 있다. 오늘의 4개 호출부에선 도달 불가하나 **이 헬퍼는 후속 sweep의 표준 착지점으로 승격시킨 것**이라 잠재 오분류가 격리되지 않고 **전파된다.** 게다가 일치하는 응답 형태가 **이미 코드베이스에 존재**한다 — `trade-report/route.ts:117`의 `{ok:false, skipped:'channel_invalid', ...}`(status 200, `error` 필드 없음). **round 2에서 우리가 쓴 코드가 이미 덫을 놓은 상태.** → `parsed?.ok === false`로 직접 분기 + `error` 부재 시 reason 합성.

### Low — 백로그 이관 (라우트 미수정)

`/api/safety/cancel-all` 2건. 특히 reviewer가 찾은 **per-order try/catch가 거래소 취소와 DB 쓰기를 함께 감싸는 문제** — 거래소 취소 성공 후 DB 쓰기 실패 시 `cancel_failed`로 기록되어 **실제 취소된 주문이 미취소로 남는다.** T-007과 방향이 반대인 거짓 실패이고 pre-existing이라 별도 task.

## Developer 5차 결과 — reviewer Medium 2건 반영 (2026-08-06)

- [15:05] **MEDIUM 1 `revertSafetyState` 데이터 손실**: 재조회 성공 시 서버 객체를 통째로 반환해 같은 폼의 다른 미저장 편집(주문 한도·vol guard·차단 종목 등 10여 필드)을 경고 없이 덮었다. **되돌림 범위를 `Object.keys(previous)`(이번 토글이 건드린 키)로 한정**하도록 수정 — 토글한 키는 서버 실제 값, 나머지는 사용자 편집값 유지. `current`가 null일 때만(보존할 편집분 없음) 서버 객체를 그대로 채택
- [15:05] 사용자 문구도 새 동작에 맞게 정밀화: "화면은 서버의 실제 상태로 되돌렸습니다" → "**KILL_SWITCH 은 서버의 실제 상태로 되돌렸습니다 (다른 미저장 편집은 그대로 둡니다)**"
- [15:05] **MEDIUM 2 `requestJson` 오분류**: 파생 문자열 `reason`의 truthiness로 분기해 **`error` 없는 `{ok:false}`가 성공으로 샜다**. `parsed?.ok === false`로 직접 분기하고 `error` 부재 시 사유를 합성하도록 수정. 지적대로 이 형태는 이미 우리 코드에 있다 — 2차에서 만든 `trade-report/route.ts`의 `{ok:false, skipped:'channel_invalid'}`(200). 이 헬퍼는 후속 sweep의 착지점이라 잠복 결함이 그대로 전파될 자리였다
- [15:05] 테스트 +6: 미저장 편집 생존 / 서버 객체 전체 덮어쓰기 금지 / current=null+서버값 / 2xx+`{ok:false}`+error없음(trade-report 실제 형태) / 4xx+`{ok:false}`+error없음 / `ok:true`+error키 존재
- [15:05] **테스트가 실제로 결함을 잡는지 역검증** — 두 수정을 각각 일시 되돌려 새 테스트가 실패하는 것을 확인(`revertSafetyState` 2건 ✕, `requestJson` 1건 ✕) 후 원복. 3차의 `'boom'` 교훈(비밀값 없는 입력이라 회귀가 조용히 통과) 반복 방지. 임시 코드 잔존 없음을 grep으로 확인
- [15:05] 검증: typecheck 클린 · **53 suites / 620 tests**(4차 53/614 → +6). build·pm2·git·DB쓰기·텔레그램 발송 없음. cancel-all·안전 토글을 운영 앱에 실행하지 않았다
- [15:05] Low(`cancel-all` try/catch 부재 + 거래소 취소 성공 후 DB 쓰기 실패 시 `cancel_failed` 오기록)는 지시대로 **미착수** — 별도 태스크

## Reviewer 결과 — 라운드 5 (M1·M2 델타 감사) (2026-08-06)

**판정: PASS** (Critical 0 / High 0 / Medium 0 / Low 0). 이번 라운드는 라운드2~4 CONDITIONAL_PASS의 Medium 2건(M1 데이터손실, M2 오분류) 수정만 감사 범위로 한정. `git -c core.fileMode=false diff` + `git status` + 파일별 mtime 대조로 이번 라운드가 실제로 건드린 파일을 확정(`SettingsPage.tsx`/`http.ts`/`http.test.ts`만 15:05~15:08 수정, 나머지 6개 변경 파일은 14:34 이전 — 라운드1~4 산출물 그대로) + `npm run typecheck`(clean) + `npm test`(**53 suites/620 tests 전부 통과**, 클레임과 정확히 일치) 직접 재실행. 운영 DB 접근·텔레그램 발송·cancel-all 트리거 없음.

### M1 — `revertSafetyState` 부분 되돌림: 완전성·정확성 확인

두 호출부(`autoSave({dryRun:!v},{dryRun:prev},'DRY_RUN')` / `...({killSwitch:v},{killSwitch:prev},'KILL_SWITCH')`) 모두 `previous`가 **정확히 토글한 키 하나만** 담아 전달됨을 코드로 확인 — 비어있거나·stale하거나·여분 키를 담는 경로 없음. `current===null` 분기(`SettingsPage.tsx:86`)는 `update()`가 `prev ? {...prev,...delta} : prev`로 `safety===null`일 때 편집을 아예 반영하지 않으므로(no-op) "보존할 편집분 없음" 전제가 실제로 성립하고, `safety`가 최초 로드 성공 이후 non-null→null로 재전이하는 경로가 없음(모든 `setSafety` 호출부 대조)도 확인. 토글 checked·ON/OFF 라벨·설명문 셋 다 동일한 `safety` state에서 파생돼 단일 `setSafety(current => revertSafetyState(...))` 호출로 원자적으로 바뀜 — 라운드4 "부분 되돌림 불가능" 보장 무회귀.

**메시지 정확성 — 코드와 대조해 일치 확인.** `"${label} 은 서버의 실제 상태로 되돌렸습니다 (다른 미저장 편집은 그대로 둡니다)"` 문구는, `restored`가 `Object.keys(previous)`(=토글한 필드 하나)만 채우고 `{...current, ...restored}`로 나머지 `current`(사용자 편집이 반영된 최신 상태)를 보존하는 실제 구현과 정확히 일치한다. 과장·거짓 표현 없음.

### M2 — `requestJson` 분류 로직: 직접 분기 확인

`bodyRejected = parsed?.ok === false`(`http.ts:49`)로 판정하고, `reason`은 그 이후 메시지 조립에만 관여하도록 분리됨(`http.ts:51-54`) — 판정과 메시지 합성이 같은 변수에 엮이지 않는다. `ok:true`+stray `error` 키: `bodyRejected`가 항상 false로 고정돼 여전히 성공. 합성 reason이 실제 서버 메시지를 가리는 경로 없음(`parsed?.error`가 있으면 그대로 쓰고, 없을 때만 합성 문구로 대체). `patchSetting`은 여전히 `requestJson`에 그대로 위임 — 기존 9개 케이스 전부 그대로 통과, 회귀 없음.

### 부정 검증(negative verification) 독립 재도출 — 개발자 클레임과 정확히 일치

지시대로 추론이 아니라 직접 재도출했다. 라운드2~4 리뷰가 문서화한 옛 버그(재조회 성공 시 `serverSafety` 전체 반환 / `reason` truthy 여부로 분기)를 코드로 재구성해 신규 테스트 21건(`revertSafetyState` 8 + `requestJson` 13) 전부 수동 트레이스:

- `revertSafetyState` 8케이스 중 옛 버그 하에서 실패하는 것은 정확히 2개 — "서버 재조회 성공 시에도 토글하지 않은 필드의 미저장 편집은 살아남는다"(옛 코드는 서버 객체 전체를 반환해 `orderMaxPct`/`dailyOrderMaxPct`가 6/10으로 덮여 99/77 기대와 불일치) / "서버 객체를 그대로 반환하지 않는다"(`.not.toBe(server)`가 옛 코드에선 정확히 `server` 참조를 그대로 반환해 실패). 나머지 6케이스는 옛 코드·새 코드가 우연히 같은 결과라 구분력이 없을 뿐(되돌림 로직이 바뀌지 않은 경로) — 정상.
- `requestJson` 13케이스 중 옛 버그 하에서 실패하는 것은 정확히 1개 — "2xx+ok:false+error 없음도 거부"(trade-report의 실제 형태 `{ok:false,skipped:'channel_invalid'}`). 옛 코드는 `reason=''`이고 `res.ok===true`라 `!res.ok||reason` 전체가 falsy → 성공으로 새어 `r.ok` 기대값(false)과 불일치.

**"M1 2건 / M2 1건" 클레임을 독립적으로 재확인함.** `TEMP-BUG-CHECK` 등 임시 계측 토큰은 `SettingsPage.tsx`/`http.ts`/두 신규 테스트 파일 및 전체 저장소(`console.log` 포함 광범위 grep)에서 검색해 잔존 없음 확인 — 남아있는 `console.log`는 전부 이번 델타와 무관한 기존 cron·전략 엔진 로깅.

### 델타 밖 — 아무것도 안 움직였음 확인

`/api/safety/cancel-all/route.ts`는 `git status`에 전혀 나타나지 않고 mtime이 4월 22일(이번 태스크 시작 전)로 완전히 무변경 — Low는 지시대로 미착수 유지. `git status src/lib/safety/` 클린. `SafetyBar.tsx`/`notify/*`/`trade-report/route.ts`/`settings/safety/route.ts` mtime 전부 14:34 이전(라운드1~4 산출물)으로 이번 라운드에서 미변경 확인. API 계약 변경 없음(`http.ts`·`SettingsPage.tsx`는 클라이언트 전용 모듈, 서버 라우트 시그니처 무변경).

- 2026-08-06 [15:13] reviewer 완료 — 라운드5(M1·M2 델타) **PASS**(Critical0/High0/Medium0/Low0). M1: 되돌림 범위 완전·정확, 메시지 클레임이 구현과 일치(과장 없음), 라운드4 원자적 되돌림 보장 무회귀. M2: 판정이 `parsed?.ok===false` 직접 분기로 전환됨을 확인, `patchSetting` 무회귀. 부정검증(M1 2건/M2 1건) 옛 버그 재구성으로 독립 재도출해 개발자 클레임과 정확히 일치 확인. 임시계측 잔존 없음. 델타 밖 파일 전부 mtime으로 무변경 확인(cancel-all route 포함, 4월 22일자 그대로).

## Leader 최종 판정 (2026-08-06)

reviewer 라운드 5 델타 재감사 **PASS** (Critical 0 / High 0 / Medium 0 / Low 0). typecheck clean, **53 suites / 620 tests** 독립 재현.

### 부정 검증(negative verification) — 이번 작업의 방법론적 성과

developer가 두 결함을 **임시로 되살려** 새 테스트가 실제로 잡는지 확인(revertSafetyState 2건 실패, requestJson 1건 실패)한 뒤 원복하고 잔재를 grep으로 확인했다. reviewer는 이를 **독립적으로 재유도**해 실패 건수(2/1)가 정확히 일치함을 확인했다.

이는 라운드 3에서 드러난 교훈의 직접 적용이다 — 당시 기존 테스트가 `'boom'`(비밀값 없는 문자열)만 던져서 **리댁션 누락이 회귀해도 조용히 통과**했다. **버그를 상대로 실패할 수 없는 테스트는 무가치하다.** 이 프로젝트의 표준 관행으로 승격할 만하다.

### M2의 아이러니 — 기록해둘 가치가 있다

함정이 됐던 `{ok:false}` without `error` 응답 형태는 **라운드 2에서 developer 자신이 추가한** `trade-report`의 `channel_invalid` 가드였다. 즉 **자기가 만든 실패 신호를, 자기가 만든 공유 헬퍼가 놓칠 뻔했다.** "도달 불가하니 괜찮다"는 논리가 왜 위험한지에 대한 구체적 사례.

## 최종 요약

**알림·설정 경로의 "거짓 성공 보고"를 제거했다. 커밋·배포는 사용자 승인 대기.**

### 시작점

`sendTelegramAlert()`가 `Promise<void>`라 호출부가 성공/실패를 구분할 수 없었다. 2026-08-04 08:03 정기 리포트가 `ETIMEDOUT`으로 실제 유실됐는데 라우트는 `sent:true`를 응답하고 `report_trade_last_sent_at`까지 갱신했다 — **아무 흔적도 남지 않았다.**

### 고친 것 (범위가 계속 확장된 이유는 같은 결함이 계속 나왔기 때문)

| 층위 | 문제 | 결과 |
|---|---|---|
| 알림 전송 | 성공/실패 구분 불가 | `NotifyResult` 반환. `sent`는 "최소 한 채널로 실제 도달"을 의미 |
| 안전 치명 알림 | `sendAlert`가 `.catch(()=>{})`로 실패 폐기 — **킬스위치·DRY_RUN 알림 경로** | fire-and-forget 유지하되 실패 로깅. 아무 채널에도 도달 못 한 critical은 `CRITICAL_ALERT_UNDELIVERED` 고정 토큰 |
| 리포트 스케줄 | 실패해도 `last_sent_at` 갱신 → 창 영구 소실 | 전달 0건일 때만 보류(무료 재시도). 부분 성공은 갱신(슬랙 5분 스팸 방지) |
| 설정 저장 | `handleSave`가 `res.ok` 미검사 → **거부된 저장이 "저장됨 ✓"** | `patchSetting`이 `res.ok`+body `ok` 둘 다 검사, 실패 시 dirty 유지 + 재시도 |
| **킬스위치 토글** | 낙관적 UI, 실패 시 **서버가 수락 안 한 상태를 켜진 것으로 표시** | 서버 재조회 우선 복원. 재조회도 실패하면 "확인 못 했다"를 명시 구분 |
| **비상 전체취소** | 실패가 **완료로 렌더** (`{cancelled:0,failed:0}`) | 4상태 분리, 실패 시 완료 요약 렌더 불가 |
| 보안 | 에러 문자열이 HTTP 응답으로 유출 — **텔레그램 URL에 봇 토큰 내장** | `redactSecrets` 전 경로 적용, 응답·로그 **전체**를 검사하는 테스트 |

### 도중 발견한 사실 (원래 계획에 없던 것)

- **`handleSave` 결함은 이미 살아있었다** — `/api/settings/strategies`가 이미 400을 반환하고 `handleSave`가 매 저장마다 `backtestIntervalM`을 보내므로, **거부된 전략 저장이 그동안 계속 "저장됨 ✓"으로 표시되고 dirty까지 초기화**돼 왔다. Leader가 "우리 변경이 실제화시켰다"고 판단했던 것은 **오판**이었고 developer가 정정했다.
- **`res.ok` 미검사 5곳** 전수 발견. 그중 2곳(킬스위치 토글·비상 전체취소)이 **실자금 비상 제어**라 범위에 포함, 3곳은 후속 sweep으로 이관.

### 검증

developer 5라운드 · reviewer 3회 감사(라운드1 PASS → 라운드2~4 CONDITIONAL_PASS → 라운드5 PASS). 테스트 **46 suites/523 → 53 suites/620** (+7 suites, +97 tests). 안전 레이어·API 계약 무변경.

### 🔴 사용자 결정 대기

**커밋·배포 승인.** 현재 미커밋. 배포 시 `git clean -fdx`가 미추적 파일을 지우므로 `agent-vault/` 문서 동반 커밋 필수.

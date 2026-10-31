---
task_id: T-136
title: KIS 토큰 만료 분기가 어댑터마다 손으로 복제돼 드리프트한 문제 — 단일 출처 헬퍼 + 재읽기 우선으로 통일
status: in-progress
priority: medium
project: StockInvest
created: 2026-10-31
updated: 2026-10-31
base_ref: origin/main 90f858f (로컬 main 8f2d71a)
risk_level: R2
roles_involved: [leader, reviewer, qa]
related_tasks: [T-133-ticker-business-failure-retry, T-132-kis-gateway-transient-retry, T-017-kis-http-gateway]
tags:
  - type/task
  - domain/safety
  - domain/exchange
aliases:
  - 토큰분기단일출처
---

## 발단

사용자 지시 「지금 이어서」 — [[T-133-ticker-business-failure-retry]] 후속 후보 ⑧.

T-133 QA 가 두 가지를 짚었다. ① 어댑터들이 `body.includes('EGW00123')` 를 **손으로** 적어, 게이트웨이(`isTransientKisFailure`)는 `EGW00121` 도 토큰 오류로 보고 재시도를 건너뛰는데 호출부는 재발급도 하지 않는 **사각지대**가 생긴다. ② 그 분기들이 **재발급 먼저**(`invalidateKisToken()` 즉시) 모양이라, T-133 감사 M-2 가 실증한 결함을 그대로 갖고 있다 — 다른 프로세스가 이미 회전시켜 둔 **멀쩡한 토큰을 지우고** 재발급을 요청해 `EGW00133`(앱키당 1분 1회)에 걸리면 `issueAndStore` 가 **60초를 기다리고**, 그 사이 같은 프로세스의 모든 `getKisToken()` 이 막힌다 — **`createOrder` 도 그 경로다.**

## 🔴 범위 정정 — 3곳이 아니라 7곳이다

T-133 보고에서 「사본 3곳(`getBalances`·`getUsdCash`·`kis-ledger-query.ts:143`)」이라고 적었는데 **실측은 7곳**이다. 사용자에게 이 정정을 먼저 알린다.

| # | 위치 | 함수 | `transientRetries` | 현행 모양 |
|---|---|---|---|---|
| 1 | `kis-domestic.ts:285` | `getBalances` | 2 | 재발급 먼저 · `EGW00123` only |
| 2 | `kis-domestic.ts:671` | `getCompletedOrders` | — | 재발급 먼저 · `EGW00123` only |
| 3 | `kis-overseas.ts:467` | `getUsdCash` | 2 | 재발급 먼저 · `EGW00123` only |
| 4 | `kis-overseas.ts:608` | `getPriceDetail` | — | 재발급 먼저 · `EGW00123` only |
| 5 | `kis-overseas.ts:650` | `fetchBalancesForExchange` | 2 | 재발급 먼저 · `EGW00123` only |
| 6 | `kis-overseas.ts:1022` | `getCompletedOrders` | — | 재발급 먼저 · `EGW00123` only |
| 7 | `kis-ledger-query.ts:281` | `ledgerPage` | — | 재발급 먼저 · 자체 정규식 `TOKEN_EXPIRED_RE` |
| (8) | `kis-domestic.ts:86` | `getTicker` | 2 | **T-133 이 고친 것** — 재읽기 우선 · `isKisTokenError` |

### 안전 확인 (먼저 한 것)

- **`createOrder`·`cancelOrder` 4곳(국내·해외)에는 토큰 분기가 아예 없다** — 실측(`grep` + 함수 범위 확인). 이 task 는 주문 송신 경로를 건드리지 않는다.
- 7곳 **전부 읽기 전용 조회**다(잔고·예수금·체결·시세상세·원장). 멱등하므로 1회 재시도가 안전하다.
- `kis-auth.ts:3` 이 `./kis-http` 의 `kisFetch` 를 import 한다 → **`kis-http` 에 헬퍼를 두면 순환 import** 다. 별도 모듈로 뺀다.

## 변경 (WP)

- **WP1** 새 모듈 `src/lib/exchanges/kis-token-retry.ts` — `shouldRetryAfterTokenError(body, usedAuth, label)` 하나.
  `isKisTokenError(body)` 가 아니면 `false`. 토큰 오류면 **먼저 `getKisToken()` 으로 DB 를 다시 읽고**, 값이 이번 요청 헤더(`usedAuth`)와 **다르면 재발급 없이** `true`(다른 프로세스가 회전시켰다), **같을 때만** `invalidateKisToken()` 후 `true`.
- **WP2** 7곳을 이 헬퍼 호출로 교체. 각 사이트는 이미 루프 **안에서** `headers` 를 만들므로 `headers.Authorization` 을 그대로 넘긴다(추가 DB 읽기 없음 — T-133 L-7 과 같은 이유).
- **WP3** `kis-domestic.getTicker`(T-133)도 같은 헬퍼로 바꿔 **8번째 사본이 되지 않게** 한다.
- **WP4** `kis-ledger-query.ts` 의 `TOKEN_EXPIRED_RE` 제거. 그 사이트는 `invalidateKisToken()` 예외를 `stop('auth_error')` 로 바꾸므로 **헬퍼 호출을 같은 try/catch 로 감싼다**(행동 보존).
- **WP5** 시험 — 헬퍼 단위(회전·동일·토큰 아님·`getKisToken` throw) + 사본이 다시 생기지 않게 하는 **정적 울타리**(손으로 쓴 `EGW00123`·`만료된 token` 비교가 교환 계층에 0건) + 사이트별 종단 1건씩.

## 하지 않는 것

- 주문 송신 경로(`createOrder`·`cancelOrder`)는 토큰 분기가 없으므로 **추가하지 않는다.** 주문은 멱등하지 않아 재시도 설계 자체가 다른 판단이다.
- `kis-auth.ts` 의 `issueAndStore` 내부 `EGW00133` 대기 로직은 손대지 않는다(이 task 는 그 대기에 **들어가지 않게** 하는 쪽).
- 교환 계층 밖의 `EGW00123` 언급(`settings/credentials/test/route.ts`·`dry-run.ts:317`·`daily-bars-kis.ts:32`·`kis-verify.ts`)은 **용도가 다르다**(UI 힌트·오류 분류·일봉 수집 전용 집합) — 범위 밖.
- `transientRetries` 를 새로 켜지 않는다. 4·6·7 은 지금도 없고 이 task 는 토큰 분기만 다룬다.

## 중복 점검 (다른 세션)

다른 세션은 T-134(`src/lib/strategy/engine.ts` 청산 엔진 상태 적재 격리)·T-135(기록기 풀 보유·러너 tmp)를 작업 중이고 **코드는 아직 미커밋**이다. 범위에 `src/lib/exchanges/` 는 없다 — T-132·T-133 때와 같은 판정. 그 세션 파일과 `.codex/`·`public/mockups` 는 손대지 않는다.

## 후속 후보 (이 task 범위 밖)

1. 해외 `getTicker` 토큰 분기 — 종전에도 없었다(T-133 후속 ①). 이 task 로 헬퍼가 생기면 한 줄이 된다.
2. 울타리 재귀 스캔 — `src/lib/exchanges/*.ts` 최상위만 본다(T-133 후속 ⑦).
3. `fallbackFor` 나이 상한 (T-132 후속에서 이월).
4. 잔고·예수금의 숫자형 `rt_cd` 정규화 (T-133 후속 ④).
8. **토큰 발급 호출에 `timeoutMs` 가 없다** — `kisFetch` 기본값은 무제한이라, 발급이 매달리면 **합류한 호출도 함께 매달린다**(4차 감사 Info). 합류를 넣었으므로 이 영향 범위가 넓어졌다.
7. **L-4 — 죽은 토큰 두 세대가 겹칠 때 읽기 1건 실패**(위 「위험 수용」). 헬퍼의 전제(「DB 값이 다르면 살아 있다」)를 바꿔야 하고, KIS 에 토큰 생존을 묻는 수단이 필요하다.
6. **원장 조회의 `auth_error` 종단 시험** — `getKisToken` 이 reject 할 때 `ledgerPage` 가 `stop('auth_error')` 로 가는지 보는 시험이 없다(3차 감사 Info, 비차단). 헬퍼 단위 시험이 throw 전파를, 원장 코드가 try/catch 를 갖고 있지만 그 둘을 잇는 종단은 미고정.
5. **프로세스 사이의 중복 발급** — 라운드 3 에서 **한 프로세스 안의** 단일 비행은 넣었다(감사 M-1). 남은 것은 ① 웹·크론처럼 **다른 프로세스**가 같은 순간에 발급하는 경우 ② 재발급 구간에 끼어드는 주문 경로의 `getKisToken()`. 둘 다 HEAD 에도 있던 것이고, 완전한 해결은 `kis-auth.issueAndStore` 의 발급 단일화(또는 DB 잠금)다. 관측 신호(감사자 보강): `token expired, re-issuing` 반복 + `[kis-auth] issued new token` 이 1분에 2회 이상 + `KIS token error: 403 … EGW00133` 예외.

## 진행 기록

- [19:20][leader] 사용자 「지금 이어서」. 실측으로 **범위 정정**(3곳 → 7곳). `createOrder`·`cancelOrder` 에 토큰 분기가 없는 것과, `kis-auth → kis-http` 방향 때문에 헬퍼를 `kis-http` 에 두면 순환이 되는 것을 먼저 확인했다.

## 구현 (메인 세션이 직접 — developer 역할 겸함)

> T-133 과 같은 이유로 메인 세션이 구현하고 **감사·QA 는 서브에이전트로 독립 수행**한다(커밋 훅이 요구하는 판정은 구현자가 쓸 수 없다).

- [19:30] **WP1 신규 `src/lib/exchanges/kis-token-retry.ts`** — `shouldRetryAfterTokenError(body, usedAuth, label)`. 토큰 오류가 아니면 `false`(이때 **DB 를 읽지 않는다** — 흔한 실패마다 SELECT 를 더하지 않으려고). 토큰 오류면 `getKisToken()` 으로 DB 재읽기 → 값이 `usedAuth` 와 다르면 **재발급 없이** `true`, 같을 때만 `invalidateKisToken()` 후 `true`.
- [19:38] **WP1 수정 — 판정을 다시 한 단계 더 뺐다(`kis-token-codes.ts`).** 처음에는 `kis-http.isKisTokenError` 를 import 했는데, 그 순간 **기존 시험 2개가 깨졌다**(`kis-overseas-price-detail`·`kis-overseas-usd-cash` 가 `../kis-http` 를 모킹하는데 공장에 그 함수가 없어 `is not a function`). T-133 감사가 Info 로 "모의 공장에 넣어라" 라고 했던 바로 그 취약점이 **실제 고장으로 나타난 것**이다. 시험 공장을 고치는 대신 **의존성 없는 잎 모듈**로 판정을 빼서 원인을 없앴다 — `kis-http` 도 `kis-token-retry` 도 이 잎을 쓰고, `kis-http` 를 모킹해도 판정은 살아 있다. 깨졌던 시험 2개는 **한 줄도 고치지 않고** 통과한다.
- [19:34] **WP2·WP3 — 호출 지점 8곳 전부 교체.** `kis-domestic`(getTicker·getBalances·getCompletedOrders) · `kis-overseas`(usdCash·priceDetail·getBalances·getCompletedOrders) · `kis-ledger-query`(ledgerPage). 각 사이트는 이미 루프 **안에서** `headers` 를 만들므로 `headers.Authorization` 을 그대로 넘긴다 — 추가 DB 읽기 0(T-133 L-7 과 같은 이유). `invalidateKisToken` import 는 세 어댑터에서 **불필요해져 제거**했다.
- [19:36] **WP4 — `kis-ledger-query` 의 `TOKEN_EXPIRED_RE` 제거.** 그 사이트는 재발급 예외를 `stop('auth_error')` 로 바꾸므로 **헬퍼 호출을 같은 try/catch 로 감쌌다**(행동 보존). 호출 예산 검사(`out.kisCalls >= maxCalls`) 위치도 그대로다.
- [19:37] 낡은 주석 4곳 정정 — 「토큰 만료(EGW00123)만」 → 토큰 계열(`EGW00121` 포함)·재발급은 DB 토큰이 같을 때만.
- [19:40] **WP5 시험 2파일 신규**
  - `kis-token-retry.test.ts`(17건) — 헬퍼 동작 9건(회전·동일·`EGW00121`·한글 문구·토큰 아님 4종에서 **DB 미조회**·`usedAuth` undefined·`getKisToken` throw 전파·로그에 토큰 값 없음 2건) + **사본 재발 방지 정적 울타리** 3건(파서로 문자열·정규식 리터럴을 본다 — 예전 사본이 정규식이었다) + **구조 울타리** 2건(헬퍼 호출 8곳이 전부 `headers.Authorization`/`usedAuth` 를 넘기고 어댑터 3파일에 모두 있다).
  - `kis-token-sites.test.ts`(8건) — 실제 `kisFetch` 로 배선 확인. 국내 잔고·해외 보유·해외 예수금 각각 `EGW00121` 복구 + **회전 시 재발급 0회**(M-2 회귀 가드) + 재시도가 **새 토큰으로** 나가는지(`authOf`), 토큰 오류 2회면 던지기, 토큰 아닌 지속 500 은 재발급 0회·예산 3회.
- [19:42] **변이 검증 5종 전부 탐지**(서버 사본, 끝나고 삭제) — M1 잎 패턴에서 `EGW00121` 제거(5건 실패) · M2 비교 뒤집어 항상 재발급(5건) · M3 재읽기 제거(5건) · M4 어댑터에 손수 사본 되살림(2건 — 울타리가 잡는다) · M5 2번째 인자를 상수로(1건 — 구조 울타리가 잡는다).
- [19:44] 검증 — 서버 `npm run typecheck` **exit 0** · `npx jest src/lib/exchanges` **27스위트 668건 전부 통과**(T-133 의 643 + 신규 25).

### 검토자가 먼저 볼 지점 (스스로 아는 약한 곳)

1. **종단 시험이 8곳 중 3곳만 덮는다** — 국내·해외 잔고와 예수금(안전장치 입력에 직결되는 것들)만 실제 `kisFetch` 로 돌렸다. `getCompletedOrders` 2곳·`getPriceDetail`·`ledgerPage` 는 **구조 울타리 + 타입 검사 + 헬퍼 단위 시험**으로만 덮인다. 특히 `ledgerPage` 는 try/catch 로 감싸 **예외를 `stop('auth_error')` 로 바꾸는 경로**가 바뀌었는데 그 경로의 시험이 없다.
2. **`usedAuth` 가 `Bearer ` 접두 형식에 의존한다**(T-133 과 같은 결합). 헬퍼 안에서 `` `Bearer ${fresh}` `` 로 만들어 비교하므로, `kisHeaders` 가 형식을 바꾸면 **항상 "회전됐다"** 로 읽혀 재발급을 영원히 건너뛴다. T-133 감사는 이 방향을 fail-closed 로 판정했는데, 이제 **8곳이 같은 가정을 공유**한다 — 판단이 달라지는지 봐 달라.
3. **`ledgerPage` 의 호출 예산**: 헬퍼가 DB 를 한 번 더 읽지만 `out.kisCalls` 는 KIS 호출만 센다. 종전과 같은지 확인해 달라.
4. **잎 모듈 분리가 과한지** — 모듈 2개(`kis-token-codes`·`kis-token-retry`)가 늘었다. `kis-http` 안에 두면 순환이 되고 모킹 취약점이 생기는 것을 실제로 겪었지만, 더 나은 배치가 있으면 말해 달라.
5. **`getPriceDetail`·`getCompletedOrders` 는 `transientRetries` 가 없다** — 토큰 분기만 고쳤다. 그쪽에 일시 재시도를 켤지는 이 task 범위 밖으로 뒀는데, 그 판단이 맞는지.

## Reviewer

- [20:04] 범위·방법 — 변경 4파일 diff 전부와 신규 4파일을 서버에서 직접 읽었다. 코드는 한 줄도 고치지 않았다(실험은 전부 서버 스크래치 사본: src 를 복사해 저장소와 `diff -rq` 로 동일함을 확인한 뒤 사용, 끝나고 삭제). 내가 쓴 파일은 이 task 파일 하나뿐이다. `[확실]` = 이번 세션에서 직접 읽거나 실행해 확인한 것.
- [20:05] 재현 대조 — `[확실]` typecheck exit 0(출력 0줄, 스크래치 사본=저장소 src) · `src/lib/exchanges` 27스위트 668건 통과(내 변이·수정 시험의 기준선으로 매번 확인). 광역(`exchanges safety app/api strategy signals`)은 스크래치 사본에서 185스위트 통과·7스위트 실패였는데 전부 사본에 `scripts/`·`.env`·DB 가 없어서 생긴 환경 실패였고, 그 7개를 실제 저장소에서 다시 돌리면 6 통과·1 skipped·실패 0 이다. 총 스위트 수는 구현자 보고(187)와 내 집계(194)가 jest 패턴 해석 때문에 다르다 — 숫자를 맞추지는 못했고 「실패 0」만 확인했다.
- [20:06] **H-1 (High) `src/lib/exchanges/kis-ledger-query.ts:287-291` — 「행동 보존」 주장이 틀렸다.** 다른 7곳은 `attempt === 0 && await 헬퍼(...)`·`!tokenRetried && await 헬퍼(...)` 로 재시도 가능 여부를 먼저 보고 헬퍼를 부르는데, 원장 사이트만 `retryToken = await 헬퍼(...)` 를 무조건 먼저 평가하고 그다음에 `if (!tokenRetried && retryToken)` 을 본다. 종전은 `if (!tokenRetried && TOKEN_EXPIRED_RE.test(body))` 라 두 번째 토큰 오류에서는 부작용이 없었다. 지금은 두 번째 토큰 오류(재발급 뒤 재시도도 토큰 오류)에서 헬퍼가 다시 돌아, DB 토큰이 방금 쓴 것과 같으므로 `invalidateKisToken()` 을 한 번 더 부른 뒤에야 `stop('http_500')` 으로 간다. 실측 `[확실]`: 모킹 인증으로 「항상 만료」 시나리오의 재발급 호출 수가 HEAD 1회 → 현재 2회. 실제 `kis-auth` + 가짜 DB + 가짜 KIS(1분 1회 제한 모사)로 그 두 번째 호출을 돌리면 DB 토큰이 지워지고 발급이 `EGW00133` 을 맞아 대기에 들어가며, 그 사이 곁다리 `getKisToken()`(주문 경로가 쓰는 그 함수)이 대기를 두 번 겪고 총 `tokenP` 6회·`EGW00133` 3회가 났다 — T-133 M-2 가 막으려던 상처를 이 task 가 원장 경로에 새로 만든다. 발동 조건은 「재발급 뒤에도 토큰 오류」(키 불일치·모의/실전 혼선 같은 지속 조건)라 드물지만 경쟁이 필요 없는 결정적 경로다. 더 나쁜 점: 연산 순서를 뒤집는 변이(`await 헬퍼 && attempt === 0`)를 다른 두 사이트(priceDetail·국내 잔고)에 넣어도 668건이 전부 통과한다 — 이 계열 결함을 어떤 시험·울타리도 못 잡는다. 수정안(스크래치에서 확인 `[확실]` — 재발급 1회로 HEAD 와 같아지고 668건 통과): `let retryToken = false; if (!tokenRetried) { try { retryToken = await shouldRetryAfterTokenError(...); } catch { return stop('auth_error'); } } if (retryToken) { tokenRetried = true; ...; continue; }`.
- [20:07] **M-1 (Medium) `src/lib/exchanges/kis-token-retry.ts:57` + `kis-auth.ts:38-60` — 재읽기용 `getKisToken()` 이 순수한 읽기가 아니다.** DB 행이 없거나 만료 1시간 전이면 `issueAndStore()` 로 떨어지고(`kis-auth.ts:60`) 그 경로는 `invalidateKisToken` 의 `refreshInFlight` 단일화(`kis-auth.ts:115-129`)를 거치지 않는다. 헬퍼 머리 주석의 「호출마다 DB 를 본다」는 이 점을 말하지 않는다. 같은 프로세스에서 요청 2건 이상이 동시에 토큰 오류를 받으면(국내 잔고·해외 보유·예수금·시세 fan-out) 먼저 도착한 호출이 DB 행을 지우고 발급을 기다리는 동안 다음 호출의 재읽기가 「행 없음」을 보고 독립적으로 발급을 또 하게 되어, `EGW00133` → 60초 대기 → 재발급(앞 토큰 무효화)이 겹친다. 모델 실측 `[가능성 높음 — KIS 의 1분 1회 제한과 「발급하면 이전 토큰 무효화」는 저장소 자신의 주석에 근거한 가정이며 실 KIS 로는 시험하지 않았다]`: 실제 `kis-auth` + 가짜 DB(0~3ms 지연) + 가짜 KIS(발급 25ms, 1분 1회)에서 4건이 동시에 만료를 보면, 종전(`invalidateKisToken` 먼저, 단일화) 방식은 120번 중 120번이 발급 1회·대기 0 인 반면 신규 헬퍼는 도착 간격 8ms 에서 104/120 번이 60초 대기를 겪고 18/120 번은 호출 하나가 `KIS token error: 403 … EGW00133` 로 던졌다(도착 간격 60ms 에서는 종전도 81/120 이 대기 — 늦게 온 호출이 새 토큰을 지우는 M-2 — 신규는 111/120). 즉 「나중에 온 호출이 멀쩡한 토큰을 지운다」는 M-2 는 막았지만 「동시에 온 호출끼리」는 종전보다 나빠졌다. 이 모양은 T-133 의 국내 `getTicker` 에 이미 운영 중이고 이 task 가 같은 모양을 7곳(잔고·예수금 포함)으로 넓힌다. 운영 로그 5주간 `token expired` 0건이라 발생 확률은 낮다 → Medium. 수정 후보(둘 다 스크래치에서 같은 시험으로 확인 `[확실]`): ① `kis-auth.ts` 에서 발급 자체를 모듈 단위 단일 비행으로 묶기 — `getKisToken` 의 낙하와 `invalidateKisToken` 이 같은 in-flight Promise 를 공유 → 120/120 번 발급 1회·대기 0·던짐 0(도착 간격 60ms 에서도 120/120 — 종전 M-2 의 대기까지 함께 사라진다). ② `getKisToken()` 맨 위에 `if (refreshInFlight) return refreshInFlight;` 한 줄 → 대기 104→29/120, 던짐 18→0 으로 줄지만 완전하지 않다. ①을 권한다. 어느 쪽이든 `kis-auth.ts` 가 이 task 범위(8파일) 밖이라 **범위 확대는 Leader 결정**이다 — 안 고치면 위험 수용을 task 에 명시해 달라.
- [20:08] L-1 (Low) `src/lib/exchanges/kis-http.ts:215-221` — JSDoc 이 닫히지 않았다. 새 문단(「(T-136) 판정은 …」)이 `*/` 없이 끝나고 바로 다음 `/**`(레이트리밋 설명)가 시작돼 두 주석이 하나로 합쳐져 `isTransientKisFailure` 의 문서가 된다. 컴파일은 통과한다(typecheck exit 0 확인 — 주석 안의 `/**` 는 중첩되지 않고 다음 `*/` 에서 끝난다). 동작 영향 없음, 문서·IDE 툴팁만 오염. `*/` 한 줄 추가.
- [20:09] L-2 (Low) 사본 재발 방지 울타리(`__tests__/kis-token-retry.test.ts` 두 번째 describe) 우회 — 서버 사본에서 변이로 확인 `[확실]`. 직접 리터럴 되살림(`body.includes('EGW00123')`)은 잡는다(대조군). 살아남은 것: FA1 정규식 문자 클래스 `/EGW0012[13]/` · FA2 소문자 비교 `'egw00123'` · FA3 문자열 이어붙이기 `'EGW00' + '123'` · FA4 표현식 있는 템플릿 `` `EGW00${'123'}` `` (파서가 리터럴 하나에서 전체 코드 문자열을 못 본다) · FA8 하위 디렉터리 파일(비재귀 스캔 — T-133 후속 ⑦ 로 알려진 것) · FA9 `.tsx` 파일. 더 중요한 것은 FA5: 코드 문자열 없이 `res.status === 401` 같은 조건에서 `invalidateKisToken` 을 직접 부르는 **재발급 먼저 분기**를 새로 만들면 울타리와 668건이 모두 통과한다. 탐지 패턴을 막는 것보다 위험한 동작을 막는 쪽이 단단하다: `src/lib/exchanges/*.ts` 에서 `invalidateKisToken` 식별자 참조를 `kis-auth.ts`·`kis-token-retry.ts` 밖에서 금지(import 선언 포함, 파서로) — FA5 류를 한꺼번에 막는다. 두 번째 울타리(호출 인자 고정)는 인자 이름 텍스트만 보므로 `const usedAuth = '상수'` 세탁은 울타리를 통과하지만 기존 priceDetail 시험이 잡았다(FA6 caught). 이 울타리는 호출이 `attempt === 0 &&`/`!tokenRetried &&` 의 오른쪽인지는 보지 않는다(H-1 계열) — 파서로 「모든 `shouldRetryAfterTokenError` 호출의 조상에 `attempt === 0` 또는 `!tokenRetried` 가드가 있다」를 더하면 H-1 같은 것을 구조로 잡는다. Low 로 둔 이유: 현재 코드의 결함이 아니라 미래 재발 방지의 질이기 때문이다.
- [20:10] I-1 (Info) 낡은 것들 — ① `__tests__/kis-balances-business-failure.test.ts:39`·`kis-ticker-business-failure.test.ts:29` 의 `kis-http` 모의 공장 `isKisTokenError: jest.fn(() => false)` 는 이제 아무도 읽지 않는 죽은 키이고 바로 위 주석(「어댑터가 모듈 수준에서 import 하므로 공장에도 있어야 한다」)은 거짓이 됐다. 지금은 잎 모듈의 진짜 정규식이 돈다(시험 본문이 토큰 코드를 쓰지 않아 통과). ② `kis-token-retry.test.ts:155` 테스트 이름 「(kis-http.ts 만 예외)」 — 예외 파일은 `kis-token-codes.ts` 로 바뀌었고 `kis-http.ts` 는 더 이상 예외가 아니다. ③ `kis-domestic.ts:61` 주석 「`getBalances` 처럼 곧바로 `invalidateKisToken()` 을 부르면」 — `getBalances` 는 이제 그렇게 하지 않는다. ④ `kis-token-retry.ts` 머리 주석의 「`getKisToken()` 은 호출마다 DB 를 본다」는 M-1 때문에 불완전하다. 전부 동작 영향 없음.
- [20:11] 중점 1 (동작 동일성, 사이트별 대조) — 국내 `getTicker`: 동일(`!tokenRetried &&` 가드 먼저, 로그 문구 동일, `tokenRetried = true` 위치만 헬퍼 반환 뒤로 이동 — 헬퍼가 던지면 함수가 끝나므로 차이 없음). 국내 `getBalances`·`getCompletedOrders`, 해외 `getUsdCash`·`getPriceDetail`·보유(NAS 단일 조회)·`getCompletedOrders`: 모두 `attempt === 0 &&` 가드가 먼저라 재시도 상한 1 유지, `attempt++` 위치 동일, `transientRetries: 2`·`kisBodyText` 사용·`UsdCashUnavailableError`/`PriceDetailUnavailableError`/일반 `Error` 를 던지는 자리 동일, 해외 `getCompletedOrders` 의 `attempt` 는 페이지별이고 `trCont` 는 헬퍼가 건드리지 않는다. 의도된 변화(동의): `EGW00121` 도 재시도 / 회전됐으면 재발급 생략 / 토큰 오류일 때만 SELECT 1회 추가. 헬퍼가 던지는 예외(`getKisToken`·`invalidateKisToken` 실패)는 usdCash·priceDetail 에서 타입 있는 `…UnavailableError` 가 아니라 원래 `Error` 로 나가는데, 종전 `invalidateKisToken()` 이 던질 때와 같다(변화 없음). 호출 예산 `out.kisCalls`: 헬퍼의 DB 읽기·재발급은 세지 않으며 종전도 재발급을 세지 않았다 — 동일. 어긋난 곳은 원장 사이트 하나(H-1)다.
- [20:12] 중점 2 (원장 사이트 try/catch 확장) — 확장 자체는 받아들일 만하다: `getKisToken()` 이 던질 때 `auth_error` 로 가는 것은, 같은 함수에서 나오는 `ledgerHeaders` 실패를 `kis-ledger-query.ts:259-262` 가 이미 `auth_error` 로 보는 것과 같은 분류다. 문제는 try/catch 가 아니라 헬퍼가 가드보다 앞에 온 순서다(H-1). 「헬퍼가 던지면 `auth_error`」 경로를 직접 확인하는 시험은 없다 — 수정할 때 `getKisToken` 이 reject 되는 시험 1건(결과 `failed`·`auth_error`)을 더하길 권한다.
- [20:13] 중점 3 (순환 import·배치) — `[확실]` TypeScript API 로 `kis-token-retry`·`kis-token-codes`·`kis-http`·`kis-auth` 에서 닿는 27개 모듈의 import 그래프를 만들어 강연결요소를 계산했다. `kis-auth → kis-http → kis-token-codes`, `kis-token-retry → kis-auth + kis-token-codes`, `kis-token-codes` 는 import 0개. 이 네 모듈은 어떤 순환에도 속하지 않는다(그래프에 있는 큰 순환 하나는 `db.ts`·`credentials.ts`·`notify/*`·`kis-throttle.ts` 등을 묶는 기존 것으로 이번 변경과 무관). 배치에 동의한다 — 대안(헬퍼를 `kis-auth.ts` 안에 두면 모듈이 하나 줄고 M-1 의 단일 비행도 쉬워진다)은 `../kis-auth` 를 통째로 모킹하는 시험이 헬퍼까지 잃는, 구현자가 겪은 것과 같은 취약점을 만들어 득보다 실이 크다. 단 M-1 의 수정은 어느 배치에서든 `kis-auth.ts` 쪽이다.
- [20:14] 중점 4 (`Bearer ` 결합) — 판단 유지: fail-closed 가 맞다(형식이 어긋나면 항상 「회전됐다」로 읽혀 재발급을 건너뛸 뿐 토큰을 지우지 않는다). 결합 범위만 정정한다: 8곳이 공유하는 것은 `headers.Authorization` 을 통째로 넘기는 규약이고, 접두를 실제로 만드는 곳은 `kisHeaders` 2개·`ledgerHeaders` 1개 + 헬퍼 1개다. 이 방향의 실제 비용은 「재발급을 영원히 안 한다」는 가용성 손실인데, 세 header 빌더 모두 `Bearer`→`Token` 으로 바꾸는 변이를 넣어 보니 전부 기존 시험이 잡았다(국내 7건·해외 6건·원장 1건 실패 `[확실]`). 따라서 `bearer(token)` 공용 함수는 필수가 아니다(Info).
- [20:15] 중점 5 (종단 시험 공백) — **부분 반대.** 「8곳 중 5곳은 구조 울타리뿐」이라는 기술은 과소평가다: 8곳 모두 기존 시험에 「토큰 만료 → 1회 재발급 후 재시도」가 있다(국내 시세 `kis-ticker-transient-recovery`·국내 잔고 `kis-balances-transient-recovery:92`·국내 체결 `kis-domestic-completed-orders:147`·해외 체결 `kis-order-query-failures:133`·예수금 `kis-overseas-usd-cash:177`·현재가상세 `kis-overseas-price-detail:144`·원장 `kis-ledger-adapters:267`). 변이 FA6(priceDetail 2번째 인자를 상수로 세탁)을 기존 시험이 잡은 것이 증거다. 진짜 공백은 사이트 수가 아니라 단언의 종류다 — 「토큰 오류 두 번」 시험 중 어느 것도 `invalidateKisToken` 호출 횟수를 단언하지 않아 H-1 이 668건을 통과했다(`kis-ledger-adapters.test.ts:274-279` 의 두 번째 구간은 재발급 횟수를 세지 않는다). 통과를 막는 것은 원장 사이트 하나(H-1)이고, 그 수정과 함께 원장 두 번째 만료 시험에 `expect(invalidateKisToken).toHaveBeenCalledTimes(1)` 을 더하면 된다. 다른 「두 번」 시험(`kis-token-sites.test.ts:92`·`kis-overseas-usd-cash.test.ts:186`·`kis-domestic-completed-orders.test.ts:161`·`kis-order-query-failures.test.ts:141`)에도 같은 단언을 더하길 권하지만 필수는 아니다.
- [20:16] 중점 6 (울타리 직접 깨기) — 근거는 L-2 와 H-1 참조. 구현자의 변이 5종(M1~M5)은 재실행하지 않았다. 내 변이 결과 요약 `[확실]`: 사본 재발 방지 — 직접 리터럴 되살림 caught / 문자 클래스·소문자·이어붙이기·표현식 템플릿·하위 디렉터리·`.tsx` 6종 survived. 호출 인자 울타리 — 상수 세탁 caught(기존 시험이 잡음). 가드 순서 뒤집기(priceDetail·국내 잔고) survived(668건 통과). 코드 문자열 없는 재발급 먼저 분기 survived. T-133 에서 세 번 뚫린 계열(주석 파싱)은 이 울타리가 AST 라 해당하지 않는다.
- [20:17] 중점 7 (주문 경로 무영향) — `[확실]` 독립 확인. 헬퍼 호출 지점은 `kis-domestic.ts` 86·276·660, `kis-overseas.ts` 469·609·650·1021, `kis-ledger-query.ts` 289 뿐이고, `createOrder`(국내 346·해외 731)·`cancelOrder`(국내 402·해외 805) 본문 구간에는 토큰 분기 호출이 없다. `git diff --stat -- src/lib/safety/ src/app/api/orders/` 는 0줄. `kis-http` 의 변경은 import 한 줄·주석·`isTransientKisFailure` 안의 판정 호출 교체뿐이고 정규식(`/EGW00121|EGW00123|만료된 token/`)은 종전과 글자 그대로 같다 — `kisFetch` 동작 불변. 다만 M-1·H-1 이 실제로 일어나면 주문 경로가 쓰는 `getKisToken()` 이 대기에 걸릴 수 있다는 간접 영향은 있다(위 시험이 보여 준 것).
- [20:18] 중점 8 (성능) — 건강한 경로는 증가 없음 `[확실]`: diff 는 전부 `!res.ok` 분기 안이고 `kisHeaders`·`ledgerHeaders` 는 한 줄도 바뀌지 않았다. 토큰 오류가 아닐 때 헬퍼는 정규식 한 번만 돌고 DB 를 읽지 않는다(시험 4종으로 고정; 원장 사이트는 모든 비정상 응답에서 헬퍼를 부르지만 같은 이유로 비용이 없다). 토큰 오류일 때만 `getKisToken()` 1회(자격 증명 60초 캐시 + `system_config` 기본키 SELECT 1건)가 늘고, 회전된 경우에는 종전보다 오히려 DELETE+발급이 줄어든다.
- [20:19] 중점 9 (로그 민감값) — `[확실]` 헬퍼의 `console.warn` 2종은 label 만 싣고 토큰·본문을 싣지 않는다(시험 2건이 단언). label 출처는 전부 코드 상수다: `` `kis-overseas getBalances(${excd})` `` 의 `excd` 는 모듈 비공개 함수 `fetchBalancesForExchange` 가 받는 `OverseasExchange` 리터럴 타입이고 호출은 `kis-overseas.ts:697` 의 `'NAS'` 하나뿐 · `` `kis-ledger ${spec.trId}` `` 의 `trId` 는 `ledgerTrId('TTTC0081R', 'VTTC0081R')` 류 상수다. 사용자 입력이 label 에 들어갈 길은 없다.
- [20:20] 「먼저 볼 지점」 5개에 대한 동의/반대 — ① 종단 시험 공백: 부분 반대(중점 5 — 공백은 사이트 수가 아니라 「두 번 오류의 재발급 횟수」 단언이고, 그것이 원장 사이트의 실제 결함을 숨겼다. `ledgerPage` 가 필수라는 점은 동의). ② `Bearer ` 결합: 동의, fail-closed 유지(중점 4). ③ 원장 호출 예산: `out.kisCalls` 가 종전과 같다는 점에 동의 — 다만 같은 위치에서 더 큰 결함(H-1)을 찾았다. ④ 잎 모듈 분리: 동의(중점 3). ⑤ `getPriceDetail`·`getCompletedOrders` 의 `transientRetries` 미도입: 동의 — 호출 횟수·백오프 예산이 바뀌는 별개 결정이라 이 task 의 「토큰 분기 단일 출처」와 섞으면 감사 범위가 흐려진다. 참고로 같은 읽기 전용인 `getActiveOrders`(국내 524·해외, 주문 동기화 입력)·캔들·`marketCapRanking` 에는 토큰 분기가 아예 없다(종전부터) — 후속 후보로 남길 만하다(Info, 이번 diff 밖).
- [20:21] 개발자에게 — 수정 요청 요약. 필수: H-1(원장 가드 순서, 수정안 위) + 원장 두 번째 만료 시험에 재발급 횟수 단언. 선택이지만 권장: L-1 `*/` 한 줄, I-1 낡은 모의 키·주석·테스트 이름 정리, 울타리에 `invalidateKisToken` 식별자 금지와 「헬퍼 호출은 재시도 가드 오른쪽」 구조 검사. Leader 결정: M-1(`kis-auth.ts` 단일 비행)을 이 task 에 넣을지, 별도 task 로 두고 위험을 수용할지. 수정 뒤에는 이 감사의 H-1 변이(`await 헬퍼 && attempt === 0`)를 다시 넣어 새 단언이 잡는지 확인한다. 수정이 있으면 이 감사부터 다시 돈다.
- [20:22] 판정 근거 — 직접 결함은 High 1·Medium 1·Low 2·Info 1 이고 Critical 은 없다. 공식 기준(Critical 0 + High 1 이하)만 보면 pass 구간이지만, 이 task 의 최우선 의도가 「사이트별 행동 보존」이고 구현 기록이 「행동 보존」을 명시했는데 원장 사이트에서 그 주장이 시험으로 반증됐다(재발급 1 → 2회, 곁다리 `getKisToken` 이 대기에 걸리는 상처를 새로 만든다). 고치는 비용은 몇 줄이고 덜 고친 채 나가는 비용은 비대칭이라 pass 로 적지 않는다. 스크래치 사본·임시 시험은 모두 삭제했고 저장소에는 이 task 파일 외에 아무것도 쓰지 않았다.
- [20:23] **1차 판정: fail (scope: src/lib/exchanges/kis-domestic.ts, src/lib/exchanges/kis-overseas.ts, src/lib/exchanges/kis-http.ts, src/lib/exchanges/kis-ledger-query.ts, src/lib/exchanges/kis-token-codes.ts, src/lib/exchanges/kis-token-retry.ts, src/lib/exchanges/__tests__/kis-token-retry.test.ts, src/lib/exchanges/__tests__/kis-token-sites.test.ts)** (라운드 2 에서 이 절 마지막 줄의 판정으로 대체됐다)
- [20:31] ── 라운드 2 ── 범위·방법 — 라운드 2 에서 바뀐 부분(원장 가드, `kis-http.ts` JSDoc, 모의 키 삭제 2곳, 횟수 단언 2건)의 diff 와 신규 `kis-ledger-token-retry.test.ts`·새 울타리 describe 를 직접 읽었다. 변이·수정 시험은 전부 서버 스크래치 사본(src 를 복사해 저장소와 `diff -rq` 로 동일함을 확인한 뒤 사용, 끝나고 삭제)에서 했고 코드는 한 줄도 고치지 않았다. 위 1차 판정은 소문자로 바꿔 두었다(이 절의 마지막 판정 줄이 유효하다).
- [20:32] **커밋 scope 는 9파일이 아니라 12파일이다.** 변경 어댑터 4 + 신규 모듈 2(`kis-token-codes.ts`·`kis-token-retry.ts`) + 신규 시험 3(`kis-token-retry`·`kis-token-sites`·`kis-ledger-token-retry`) + **기존 시험 중 이번에 수정된 3**(`kis-balances-business-failure`·`kis-ticker-business-failure`·`kis-ticker-transient-recovery`). 훅의 안전 경로가 `^src/lib/exchanges/` 라 기존 시험 3개도 scope 에 없으면 커밋이 막힌다. 이 3개의 diff(모의 키 삭제 2곳·재발급 횟수 단언 1건)도 읽었으므로 아래 판정 줄에 12파일을 모두 적었다.
- [20:33] 재현 대조 `[확실]` — typecheck exit 0(출력 0줄) · 실제 저장소 `src/lib/exchanges` **28스위트 675건 통과** · 광역(`exchanges safety app/api strategy signals`, 실제 저장소) 192스위트 통과·3 skipped·실패 0(5352건 통과·106 skipped). 스위트 총수는 내 집계(195)와 구현자 보고(188)가 jest 패턴 해석 때문에 다르다 — 「실패 0」만 대조됐다. 스크래치 사본에서 `src/lib/exchanges` 를 돌렸을 때 `kis-usage-isolation.test.ts` 1건이 한 번 실패했으나 같은 파일을 사본·저장소에서 단독 2회씩 돌리면 17건 통과, 저장소 전체 재실행도 통과라 재현되지 않는다. 이 시험은 `kis-auth` 를 통째로 모킹하고 기록 패키지·임시 디렉터리를 쓰며 토큰 헬퍼 경로와 무관하고, T-133 감사도 같은 시험의 1회 불안정을 적어 둔 바 있다 `[가능성 높음]` 이번 변경 탓이 아니다(Info).
- [20:34] **H-1 닫힘** `[확실]` — `kis-ledger-query.ts:291-302` 가드가 헬퍼 앞에 있고, `tokenRetried` 가 참이면 헬퍼를 부르지 않으며, 헬퍼가 던지면 `stop('auth_error')`·재시도 전 `call_budget` 검사 위치가 종전과 같다(1차 감사의 수정안과 동작 동일). 새 시험 5건의 핵심 단언이 복구 여부가 아니라 `invalidateKisToken` 호출 횟수이고(1회 복구·만료 2회에도 1회·`EGW00121`·회전 시 0회·토큰 아닌 500 은 0회·호출 1회) 재시도가 `Bearer reissued` 로 나가는지도 본다. 변이로 가드를 헬퍼 뒤로 되돌리면(`{ … }` 블록 + `!tokenRetried && retryToken`) 전체 시험이 1건 실패한다 — 구현자 보고와 일치.
- [20:35] **L-3 (Low) 순서 뒤집기 계열은 8곳 중 3곳만 시험이 잡는다** `[확실]` — 요청대로 8곳 전부에 `await 헬퍼(...) && 가드` 변이를 넣어 전체 `src/lib/exchanges`(675건)를 돌렸다. **잡힘 3**: 국내 `getTicker`·국내 `getBalances`·원장(가드 되돌림). **살아남음 5**: 국내 `getCompletedOrders`(`kis-domestic.ts:660`)·해외 `getUsdCash`(`kis-overseas.ts:469`)·`getPriceDetail`(:609)·해외 보유(:650)·해외 `getCompletedOrders`(:1021). 즉 라운드 1 의 「전부 통과」에서 3곳은 막혔지만 계열 전체가 막힌 것은 아니다. **통과를 막을 수준은 아니다**: 살아남은 5곳의 현재 코드는 전부 `attempt === 0 &&` 가 앞이라는 것을 줄 단위로 읽어 확인했다 — 결함이 지금 코드에 있는 것이 아니라 미래 편집의 회귀망에 구멍이 있는 것이다. 수정은 값싸다: ① 파서 울타리 한 건 — 모든 `shouldRetryAfterTokenError` 호출이 `attempt === 0 &&`·`!tokenRetried &&` 의 오른쪽 피연산자이거나 `if (!tokenRetried)` 블록 안임을 검사(8곳을 한 번에 덮는다) 또는 ② 남은 「두 번」 시험(`kis-overseas-usd-cash.test.ts:186`·`kis-domestic-completed-orders.test.ts:161`·`kis-order-query-failures.test.ts:141`)에 횟수 단언을 더하고 현재가상세·해외 보유에는 「두 번」 시험을 신설. ①을 권한다.
- [20:36] **L-2 (Low) 우회 6종 재실행 + 새 식별자 울타리 깨기** `[확실]` — 문자열 울타리: 직접 리터럴 되살림은 잡히고 문자 클래스·소문자·이어붙이기·표현식 템플릿·하위 디렉터리·`.tsx` 6종은 여전히 통과한다(예상대로 — 파서가 리터럴 하나에서 전체 코드를 못 보는 구조). 그러나 이 6종은 **판정을 흉내 낼 뿐 위험한 동작이 아니다.** 위험한 동작(재발급)은 식별자 울타리가 막는다: 401 분기 + 이름 있는 import(코드 문자열 없음)·동적 import 구조분해·별칭 import·다른 파일의 재수출 4종 **전부 잡힌다**(기존 priceDetail 시험도 상수 세탁 변이를 계속 잡는다). 식별자 울타리가 못 잡는 것: ① 문자열 리터럴 요소 접근 `ns['invalidateKisToken']()` ② 하위 디렉터리 ③ `.tsx` ④ **`src/lib/exchanges/` 밖**(예: `src/lib/profit-engine/…`) ⑤ 식별자 없이 토큰 행을 SQL 로 직접 `DELETE`. **통과를 막을 수준은 아니다**: 실제로 일어났던 재발(기존 어댑터 최상위 파일에 옛 사본을 다시 붙임)은 잡고, `src/lib/exchanges/` 에는 `__tests__` 말고 하위 디렉터리가 없으며(`find` 로 확인), 남은 ①⑤는 의도적 우회다. 다만 ④는 현실적이다 — 이미 `getKisToken`·`kisFetch` 를 직접 쓰는 코드가 교환 계층 밖에 있다(`profit-engine/daily-bars-kis.ts`·`app/api/ticker/all`·`app/api/symbols/lookup`·`app/api/symbols/search`·`app/api/settings/credentials/test`). 가장 값싼 보강은 후속 후보 2 를 이 울타리에 맞춰 넓히는 것: 스캔을 `src/` 전체 재귀(`.ts`·`.tsx`, 시험 제외)로 하고 허용 파일 2개만 예외로 둔다.
- [20:37] L-1 닫힘 `[확실]`(JSDoc 의 `*/` 복구 확인, typecheck exit 0). I-1 ①②는 닫힘(죽은 모의 키 2곳 삭제·시험 이름 정정). **I-1 ③④는 그대로다**: `kis-domestic.ts:61` 「`getBalances` 처럼 곧바로 `invalidateKisToken()` 을 부르면」은 남아 있고(고쳐진 것은 :56 의 `EGW00123` 문구뿐 — 요청 메시지는 「:61 정정」이라 적었으나 61 줄은 안 바뀌었다), `kis-token-retry.ts:19`·`kis-domestic.ts:65` 의 「호출마다 DB 를 본다」도 `getKisToken()` 이 행이 없으면 발급한다는 점을 말하지 않는다. 동작 영향 없음(Info). ④는 M-1 의 수용 문서와 모순되지 않게 고치길 권한다. 새 시험에서 빠진 것 하나(비차단): `getKisToken` 이 reject 될 때 원장 결과가 `failed`·`auth_error` 인지 보는 시험(1차 중점 2 에서 권고).
- [20:38] **M-1 위험 수용에 대한 판단 — 수용 자체는 막지 않지만 근거 둘이 틀렸고, 범위 안 수정이 있다.** ① 수용 근거 1(「완전한 수정은 `kis-auth` 에 있고 8파일 밖」)은 **틀렸다.** 같은 시나리오(동시 토큰 오류)를 `kis-token-retry.ts` 안에서 닫을 수 있다 — 모듈 수준 `Map<string, Promise<boolean>>` 을 `usedAuth`(죽은 토큰) 로 키 잡아, 같은 토큰으로 동시에 실패한 호출이 판단 하나(재읽기 1회·재발급 최대 1회)를 공유하고 `finally` 에서 지운다. 스크래치에서 같은 모델(4건 동시, 가짜 DB·가짜 KIS)로 확인 `[확실]`: 도착 간격 8ms·60ms 모두 120/120 번 발급 1회·60초 대기 0·던짐 0(60ms 에서 종전 HEAD 방식이 81/120 번 대기하던 것까지 사라진다), 기존 675건 전부 통과. 약 15줄이고 파일은 이미 커밋 대상이다. 남는 것은 HEAD 에도 있던 둘뿐이다: 서로 다른 프로세스(웹·크론)의 동시 발급, 그리고 재발급 구간에 끼어드는 곁다리 `getKisToken()`(주문 경로) — 이것이 후속 후보 5 의 진짜 범위다. ② 수용 근거 4 의 「트리거(DB 행 없음)는 더 드물다」는 틀렸다: 행이 없는 상태는 독립 사건이 아니라 **먼저 도착한 호출 자신의 `DELETE` 가 만든다.** 트리거는 「DB 가 모르는 토큰 사망」×「동시 요청 2건 이상」이고 앞 조건이 일어나면 뒤 조건은 거의 항상 성립한다(내 모델: 도착 간격 8ms 에서 104/120) — 확률은 토큰 사망 자체와 같은 크기(5주간 0건)다. ③ 「이미 운영 중」은 `getTicker` 한 곳의 사실이다. 나머지 7곳(잔고·예수금 포함)은 HEAD 에서 이 시나리오를 발급 1회로 끝냈고, 이 task 가 그것을 나쁘게(대신 「회전된 토큰 삭제」 M-2 는 좋게) 바꾸는 교환을 한다 — 수용 문서에 이 교환을 있는 그대로 한 줄 적길 권한다. ④ 관측 신호 보강: `token expired, re-issuing` 반복만으로는 부족하다. 이 실패 모드의 신호는 `[kis-auth] issued new token`(`kis-auth.ts:85`)이 1분 안에 2회 이상, 그리고 `KIS token error: 403 … EGW00133` 예외다 `[가능성 높음]` — 11-03 관측에서 둘을 같이 grep 하길 권한다. 결론: **「지금 넣어야 한다」에 가깝다**(비용 15줄·시험 1건, 이득은 7곳에서 HEAD 보다 나빠지는 한 경우를 제거) — 그러나 심각도는 그대로 Medium·확률은 낮아 이 판정의 필수 조건으로 두지는 않는다. 넣으면 코드가 바뀌므로 이 감사를 한 번 더 거쳐야 한다(빠르게 확인하겠다).
- [20:39] 새로 확인한 점 요약 — 열린 것: M-1(Medium, Leader 수용·위 정정 필요) · L-2 잔여·L-3(Low, 비차단 보강) · I-1 ③④·`kis-usage-isolation` 1회 불안정(Info). 닫힌 것: H-1·L-1·I-1 ①②. 주문 경로 무영향은 재확인: `git diff --stat -- src/lib/safety/ src/app/api/orders/` 0줄, 라운드 2 변경은 원장 가드·주석·시험뿐이다. 스크래치 사본과 임시 시험은 전부 삭제했고 저장소에는 이 task 파일 외에 쓴 것이 없다.
- [20:40] 판정 근거 — 라운드 1 의 결함(H-1)은 정확히 고쳐졌고 그 계열을 잡는 시험이 생겼다(8곳 중 3곳 직접 + 구조적 보강은 L-3). 새 Critical·High 는 없다. 그러나 열린 Medium(M-1)의 수용 근거가 사실과 달라서(범위 안 수정이 존재한다) 깨끗한 pass 로 적지 않고 조건부로 적는다. 조건: Leader 가 위 M-1 정정 사실을 보고 ① 헬퍼 단일 비행을 넣거나(넣으면 이 감사 재확인) ② 정정된 근거로 수용을 다시 기록한다. 이 판정이 막지 않는 비차단 권고: L-3 구조 울타리·L-2 `src/` 재귀 확장·I-1 ③④·`getKisToken` reject 시험.
- [20:41] **2차 판정: conditional_pass (scope: src/lib/exchanges/kis-domestic.ts, src/lib/exchanges/kis-overseas.ts, src/lib/exchanges/kis-http.ts, src/lib/exchanges/kis-ledger-query.ts, src/lib/exchanges/kis-token-codes.ts, src/lib/exchanges/kis-token-retry.ts, src/lib/exchanges/__tests__/kis-token-retry.test.ts, src/lib/exchanges/__tests__/kis-token-sites.test.ts, src/lib/exchanges/__tests__/kis-ledger-token-retry.test.ts, src/lib/exchanges/__tests__/kis-balances-business-failure.test.ts, src/lib/exchanges/__tests__/kis-ticker-business-failure.test.ts, src/lib/exchanges/__tests__/kis-ticker-transient-recovery.test.ts)** (라운드 3 에서 이 절 마지막 줄의 판정으로 대체됐다)
- [21:20] ── 라운드 3 ── 범위·방법 — 이번에 바뀐 것(`kis-token-retry.ts` 의 단일 비행 + 시험 5건, 가드 순서 울타리, 식별자 울타리의 `src/` 재귀 확장, 주석 정정)의 코드와 시험을 직접 읽었다. 변이·하네스는 전부 서버 스크래치 사본(src 를 복사해 저장소와 `diff -rq` 로 동일함을 확인한 뒤 사용, 끝나고 삭제)에서 돌렸고 코드는 한 줄도 고치지 않았다. 위 2차 판정은 소문자로 내렸다(이 절의 마지막 판정 줄이 유효하다).
- [21:21] **커밋 scope 는 13파일이 아니라 12파일이다** `[확실]` — `git status` 기준 수정 7(어댑터 4 + 기존 시험 3) + 신규 5(모듈 2 + 시험 3)이다. 요청 메시지가 「라운드 3 에서 원장 시험 1개가 더 늘었다」고 했지만 `kis-ledger-token-retry.test.ts` 는 라운드 2 의 내 12파일 목록에 이미 들어 있었고, 라운드 3 에서 새로 생긴 파일은 없다(`src/lib/profit-engine/` 쪽도 변경 0). 13번째 파일을 staged 에 올렸다면 알려 달라 — 판정 줄 밖의 안전 파일은 훅이 막는다.
- [21:22] 재현 대조 `[확실]` — typecheck exit 0(출력 0줄) · `isolation.test.ts` + `src/lib/exchanges` **29스위트 740건 통과**(구현자 보고와 일치). **필터 없는 전체 jest(실제 저장소): 361스위트 통과·6 skipped·실패 0, 10386건 통과·230 skipped.** 광역 패턴 질문에 답한다: 내가 쓴 패턴은 처음 받은 작업 메시지의 `exchanges safety app/api strategy signals` 그대로였고, 이 패턴에도 `profit-engine` 은 없다 — 그래서 라운드 2 에서 내가 보고한 「광역 192스위트 통과」도 그 경로를 보지 않은 통과였다(내 보고의 허점이기도 하다). 이제는 패턴을 쓰지 않고 전체를 돌린 수치가 기준이다(총 367스위트 = 361 + 6 skipped). 195 대 188 의 차이는 끝내 설명하지 못했으나 전체 실행으로 의미가 없어졌다.
- [21:23] **M-1 닫힘 — 내 하네스로 재확인** `[확실]` — 실제 `kis-auth` + 가짜 DB(0~3ms 지연) + 가짜 KIS(발급 25ms, 1분 1회 제한)에서 4건이 동시에 만료를 보는 시나리오를 실제 헬퍼로 120번씩 돌렸다: **도착 간격 8ms·60ms 모두 120/120 번 발급 1회·60초 대기 0·던짐 0** (60ms 에서 종전 HEAD 방식은 77/120 번 대기). 코드도 읽었다: 호출이 `inFlight` 조회 → 판단 생성 → `set` 까지 `await` 없이 같은 틱 안에 끝나므로 동시 호출이 판단을 둘 만들 수 없고, 판단 Promise 는 `.finally` 로 키를 지우며, 거절도 공유하는 호출 전부에 전달된다. 헬퍼 변이 6종 전부 잡힌다: 공유 제거·키 미삭제·상수 키(토큰이 달라도 공유)·`set` 직후 삭제·성공에서만 삭제(거절 시 키 잔존)·토큰 오류 검사 제거(비토큰 본문이 판단을 만듦) — 각 1~5건 실패. 한계는 구현자가 적은 그대로다(한 프로세스 안, 다른 프로세스 동시 발급과 재발급 구간에 끼는 주문 경로 `getKisToken()` 은 남음 — HEAD 에도 있던 것이고 후속 후보 5 에 정확히 적혀 있다). 후속 5 의 관측 신호(`issued new token` 1분 2회 이상·`EGW00133` 예외)도 반영돼 있다.
- [21:24] **L-3 닫힘** `[확실]` — 라운드 2 에서 5곳이 살아남았던 순서 뒤집기 변이를 8곳 전부(`await 헬퍼 && 가드`; 원장은 가드 되돌림) 다시 넣었다: **8/8 이 새 파서 울타리에서 즉시 실패**(국내 `getCompletedOrders`·해외 `getUsdCash`·`getPriceDetail`·해외 보유·해외 `getCompletedOrders` 포함, 각 1건 실패). 울타리 자체도 읽어 보았다: 호출이 `attempt === 0`·`!tokenRetried` 가 왼쪽인 `&&` 의 오른쪽이거나 같은 조건의 `if` 의 then 가지 안에 있는지 조상을 따라 올라가 확인하고, 괄호가 낀 가드·`||`·가드 변수화처럼 모양이 다르면 **통과시키지 않는 쪽(보수적)** 으로 실패한다 — 헬퍼 호출을 하나 더 늘려도 개수 단언(8)이 막는다.
- [21:25] **L-2 잔여 — 판단 변경 없음(비차단)** `[확실]` — 식별자 울타리를 `src/` 전체 재귀로 넓힌 것을 확인했다. 허용은 basename 이 아니라 전체 경로 2개(`src/lib/exchanges/kis-auth.ts`·`kis-token-retry.ts`)이고, 변이 5종이 전부 잡힌다: 하위 디렉터리·`src/app` 아래 `.tsx`·`src/app/api/…/route.ts`·`src/lib/profit-engine/…`·**허용 파일명과 같은 이름을 다른 디렉터리에 둔 경우**(`src/lib/zz/kis-auth.ts`). 살아남는 것은 라운드 2 에 적은 의도적 우회 둘(문자열 요소 접근·SQL 직접 삭제)과 `__tests__` 디렉터리 안(설계상 제외)뿐이다.
- [21:26] **T-119 격리 시험 건 — 구현자의 처리에 동의한다.** 주석에 profit-engine 모듈 파일명을 적어 격리 시험이 1건 깨졌고, 허용 목록을 넓히는 대신 주석을 고친 판단이 맞다(허용 목록 확대는 격리 울타리를 약하게 만드는 쪽이다). 전체 실행에서 `isolation.test.ts` 는 통과한다. 이 건은 반쯤 고친 것이 아니다 — 원인(주석)을 제거했고 재발 경고를 그 자리에 남겼다.
- [21:27] 남은 사소한 것(Info, 동작 영향 없음) — ① `kis-domestic.ts:66` 의 「(이 함수는 호출마다 DB 를 본다)」는 그대로다. 라운드 3 에서 고쳐진 것은 `kis-token-retry.ts` 쪽 문장이고, 같은 말이 `getTicker` 문서에 한 번 더 있다(라운드 2 에서 내가 두 곳을 적었다). `getKisToken()` 이 행이 없으면 발급한다는 점과 어긋나는 한 줄이다. ② 라운드 1 에서 권한 「`getKisToken` 이 reject 될 때 원장 결과가 `failed`·`auth_error` 인지 보는 시험」은 추가되지 않았다(비차단 권고 유지). ③ `kis-usage-isolation.test.ts` 1회 불안정은 이번 전체 실행에서 나타나지 않았다.
- [21:28] 판정 근거 — 라운드 2 의 열린 항목 M-1·L-3·L-2·I-1 은 모두 코드로 닫혔고 내 독립 실험(하네스 120/120, 변이 6+8+5종 전부 탐지)으로 확인했다. 새 Critical·High·Medium 은 없다. 구현자의 결정 번복은 사실에 근거했고 결과도 사실과 맞다. 틀린 것 한 건: scope 개수(13 → 실제 12)뿐이며 코드가 아니라 집계다. 주문 경로 무영향은 재확인: `git diff --stat -- src/lib/safety/ src/app/api/orders/` 0줄, 헬퍼 호출 지점은 읽기 전용 조회 8곳뿐이다. 스크래치 사본·하네스는 전부 삭제했고 저장소에는 이 task 파일 외에 쓴 것이 없다.
- [21:29] **3차 판정: pass (scope: src/lib/exchanges/kis-domestic.ts, src/lib/exchanges/kis-overseas.ts, src/lib/exchanges/kis-http.ts, src/lib/exchanges/kis-ledger-query.ts, src/lib/exchanges/kis-token-codes.ts, src/lib/exchanges/kis-token-retry.ts, src/lib/exchanges/__tests__/kis-token-retry.test.ts, src/lib/exchanges/__tests__/kis-token-sites.test.ts, src/lib/exchanges/__tests__/kis-ledger-token-retry.test.ts, src/lib/exchanges/__tests__/kis-balances-business-failure.test.ts, src/lib/exchanges/__tests__/kis-ticker-business-failure.test.ts, src/lib/exchanges/__tests__/kis-ticker-transient-recovery.test.ts)** (라운드 4 에서 이 절 마지막 줄의 판정으로 대체됐다)
- [22:05] ── 라운드 4 ── 범위·방법, 그리고 **내 3차 판정의 허점** — 3차 pass 때 내가 쓴 「남은 것은 HEAD 에도 있던 둘뿐」은 서로 다른 죽은 토큰 두 개가 겹치는 경우에 틀렸다. 내 하네스는 죽은 토큰을 하나(T0)만 썼고, 단위 시험 「토큰이 다르면 공유하지 않는다」를 받아들이면서 **두 번째 판단의 `getKisToken()` 이 「행 없음」을 만나면 무엇을 하는가**를 묻지 않았다. QA 의 정정이 맞다. 이번에는 판단 키가 둘로 갈리는 시나리오와, 실제 KIS 처럼 「어느 토큰이 살아 있는가」를 추적하는 모델로 다시 돌렸다. 실험은 전부 서버 스크래치 사본(src 를 복사해 저장소와 `diff -rq` 로 동일함을 확인한 뒤 사용, 끝나고 삭제)에서 했고 코드는 한 줄도 고치지 않았다. 위 3차 판정은 소문자로 내렸다(이 절의 마지막 판정 줄이 유효하다).
- [22:06] scope 14파일 확인 `[확실]` — `git status` 기준 수정 8(`kis-auth.ts`·어댑터 4·기존 시험 3) + 신규 6(모듈 2·시험 4). 교환 계층 밖 변경은 `public/mockups` 삭제와 task 파일뿐(둘 다 안전 경로 아님). `kis-auth.ts` 의 diff 는 **주석과 `if (refreshInFlight) return refreshInFlight;` 한 줄이 전부**다. `git diff --stat -- src/lib/safety/ src/app/api/orders/` 0줄, `createOrder`·`cancelOrder` 본문 변경 0. 합류는 캐시 조회가 「행 없음/만료 임박」을 본 뒤의 **폴백에서만** 일어나므로, 유효한 행이 있는 평상 경로(주문 포함)는 이전과 동일하게 실행된다.
- [22:07] **F-1 닫힘** `[확실]` — 하네스 v2(실제 `kis-auth`·실제 헬퍼, 가짜 DB 0~3ms 지연·가짜 KIS 발급 25ms·「1분 1회」·**발급할 때마다 이전 토큰이 죽는 것까지 모사**)를 시나리오당 100번 돌렸다. QA 시나리오(죽은 T0 네 건 + 10ms 뒤 Tstale 한 건): HEAD 의 `kis-auth` + 현재 헬퍼는 **100/100 번 발급 3회·60초 대기**(QA 재현 확인 — QA 는 2회, 내 모델은 3회로 나온다), 현재 코드는 **100/100 번 발급 1회·대기 0·던짐 0·재시도 성공 500/500**. 종전(HEAD 방식)도 1회·대기 0 이므로 HEAD 와 동일해졌다. 기본 시나리오(T0 네 건)는 양쪽 모두 1회.
- [22:08] **질문 1 ① (합류한 발급이 실패할 때)** `[확실]` — 실험 P: 발급이 일시 500 으로 한 번 실패하는 순간 `invalidateKisToken()` 진행 중에 `getKisToken()` 이 들어오면, **HEAD 는 독립 발급이 성공(tokenP 2회, B 성공), 현재는 같은 거절을 받는다(tokenP 1회, B 거절)**. 종전에는 되던 것이 이 경우에는 안 되는 것이 맞다. 그러나 받아들일 만하다고 판단한다: ⓐ 거절은 fail-closed 이고 `refreshInFlight` 는 settle 과 함께 비워지므로 **다음 `getKisToken()` 이 다시 발급해 복구**한다 ⓑ HEAD 가 이긴 경우는 「첫 발급이 빠르게 실패하고 독립 발급은 성공하는」 좁은 틈뿐이고, 첫 발급이 성공하는 흔한 경우(아래 ②)에는 HEAD 의 독립 발급이 `EGW00133` 을 맞아 오히려 나쁘다 ⓒ 발급 실패 자체가 KIS 장애 구간의 사건이라 그때는 독립 발급도 대부분 실패한다 `[가능성 높음]` ⓓ 주문 경로에서 일어나면 주문이 실패할 뿐 잘못된 주문이 나가지는 않는다(지연). 이것은 `invalidateKisToken()` 호출자들이 원래 가진 성질과 같다.
- [22:09] **질문 1 ② (긴 `EGW00133` 대기에 묶일 때)** `[확실]` — 실험 W(다른 프로세스가 방금 발급해 향후 60초간 발급이 거부되는 상태에서 `invalidateKisToken()` + 10ms 뒤 `getKisToken()`): **HEAD 는 A 가 +60초에 T1, B 가 +120초에 T2 를 받고 발급 5회·`EGW00133` 3회이며, B 의 발급이 A 의 T1 을 죽여 A 가 죽은 토큰을 들고 있게 된다. 현재는 A·B 모두 +60초에 같은 T1(살아 있음), 발급 2회·`EGW00133` 1회.** 즉 독립 발급으로 「빠져나갈」 호출은 없었고, 합류가 대기를 줄이면서(120→60초) 앞 호출의 토큰까지 지키는 **순이익**이다. 내 판단을 확신 수준으로 말하면 `[가능성 높음]` — 가짜 KIS 이고 「발급하면 이전 토큰 무효화」는 저장소 주석 근거의 가정이다.
- [22:10] 합류가 만들 수 있는 다른 실패 모드 점검 — **교착/자기 합류 없음** `[확실]`: `refreshInFlight` 의 비동기 본문은 DB `DELETE`·`getCredential`·`issueAndStore` 만 부르고 `getKisToken` 을 부르지 않으며, `kisFetch` 안에도 `getKisToken` 호출이 없다. **스로틀 기아 없음** `[확실]`: 실제 `kisFetch`·실제 스로틀·실제 `kis-auth` 에 전역 `fetch` 만 가짜로 두고, 대기열에 `bulk` 호출 60건을 쌓은 채 `invalidateKisToken()` 1건 + `getKisToken()` 25건을 던졌더니 발급 1회·26건이 같은 토큰을 받고 **+226ms 에 끝났다**(밀린 `bulk` 60건은 +11초). 토큰 발급은 `critical` 레인이고 호출부는 헤더를 만든 뒤에야 슬롯을 잡으므로 슬롯을 쥔 채 토큰을 기다리는 순환이 없다. **남는 것 하나(Info)**: 토큰 발급 호출(`kis-auth.ts` 의 `kisFetch(tokenP…)`)에는 `timeoutMs` 가 없고 `kisFetch` 기본값은 무제한이다. 발급 요청이 매달리면(Node 기본 한도까지 `[추측]`) 합류한 호출도 함께 매달린다 — 종전에는 `invalidateKisToken` 호출자만 그랬고 `getKisToken` 폴백 호출은 자기 요청으로 빠져나갈 수 있었다. 확률이 낮고 어차피 같은 엔드포인트라 후속 후보(발급 호출에 `timeoutMs`)로 충분하다.
- [22:11] **질문 2 (시험 정직성)** — 방식은 받아들일 만하다. 알려진 공백을 숨기지 않고 고정했고 설명이 분명하며 `toBeGreaterThan(1)` 은 시간 경쟁에 취약하지 않다(첫 호출 5ms 뒤 나머지가 들어가는 구성, 합류 줄 제거 변이 시 첫 시험 1건 실패·둘째 통과를 확인). 더 나은 형태는 `test.failing`(jest 29 지원)으로 **원하는 동작(`toBe(1)`)을 적어 두고 지금은 실패를 기대**하게 하는 것이다 — 후속 5 가 끝나면 「예상 밖 통과」로 알려 주고 단언 자체가 틀린 방향(중복 발급이 정상)으로 읽히지 않는다. 비차단. 이 공백에 대한 정황 하나: T-133 감사 기록이 인용한 운영 로그의 **2026-10-30 16:00:03·16:01:03·16:02:03 의 60초 간격 재발급**은 정확히 이 공백(자연 만료 회전 때 `getKisToken` 끼리 중복 발급 → `EGW00133` → 60초 → 재발급 연쇄)의 흔적일 수 있다 `[추측]` — 그렇다면 후속 5 는 「5주간 토큰 만료 0건」이 말해 주는 것보다 우선순위가 높다.
- [22:12] **질문 3 (실패 전파 미시험)** — 통과를 막지는 않지만 **시험이 가능하다**는 점을 바로잡는다. 가짜 KIS 가 발급에 `EGW00133` 이 아니라 **HTTP 500 을 한 번** 돌려주면 `issueAndStore` 는 60초 대기 없이 즉시 던진다(대기는 `EGW00133` 분기에만 있다). 내 실험 P 가 그 방식이다 — 첫 시험과 같은 모킹에서 `kisFetch` 가 500 을 돌려주게 하고 `invalidateKisToken()` + 10ms 뒤 `getKisToken()` 을 던져, 둘 다 거절(tokenP 1회)되는지와 그 다음 `getKisToken()` 이 다시 발급해 복구하는지를 단언하면 약 10줄·가짜 타이머 불필요다. 막지 않는 이유: 전파는 「같은 Promise 를 돌려준다」는 한 줄의 성질이고 첫 시험이 그 Promise 공유를 고정하며, 실험 P 로 내가 동작을 확인했다. 그래도 가장 위험한 파일이므로 추가를 권한다.
- [22:13] **L-4 (Low, 비차단) 서로 다른 죽은 토큰 두 개 — 먼저 도착한 쪽이 낡은 토큰이면 그 호출의 재시도가 죽은 DB 토큰으로 나간다** `[확실]` — 하네스 v2 시나리오 S2(Tstale 이 0ms, T0 네 건이 1~8ms): HEAD 방식은 500/500 재시도 성공인데, 헬퍼는 **100번 중 75번(HEAD 의 `kis-auth`)·83번(현재) 에서 Tstale 호출 한 건의 재시도가 실패**한다. 원인: Tstale 호출의 판단이 DB 를 읽으면 T0(≠Tstale)라 「회전됐다」로 읽고 재발급 없이 true 를 주는데, 그 순간 DB 의 T0 도 이미 죽어 있어(T0 쪽 판단이 아직 지우기 전) 재시도가 죽은 T0 로 나가 두 번째 토큰 오류가 된다(어댑터는 1회만 재시도하므로 던진다). 이것은 `kis-auth.ts` 변경과 무관한 **헬퍼 설계의 한계**(「DB 값이 다르면 살아 있다고 믿는다」, 라운드 1 부터 있음)다. 전제가 F-1 과 같다 — 같은 순간 서로 다른 죽은 토큰 두 세대가 비행 중이어야 한다 — 이고 결과는 읽기 호출 1건의 fail-closed 실패(다음 틱 복구)라 F-1(60초 대기)보다 가볍다. 도착 순서가 반대(S1)면 합류로 해결된다. 막지 않는 이유: 두 세대가 겹치려면 DB 에 쓰지 않는 발급자(다른 앱이 같은 앱키로 발급)가 필요하고, 고치려면 KIS 에 토큰 생존을 물어야 해서 이 task 의 설계 밖이다. 다만 「7곳을 고치며 한 경우를 HEAD 보다 나쁘게 두지 않는다」는 이 task 의 원칙과 어긋나는 경우이므로, **수용을 task 에 명시해 달라**(후속 후보에 한 줄).
- [22:14] 재현 대조 `[확실]` — typecheck exit 0(출력 0줄) · **필터 없는 전체 jest(실제 저장소) 362스위트 통과·6 skipped·실패 0, 10388건 통과·230 skipped**(구현자 보고와 일치) · 변이 J1(합류 줄 삭제) → 새 시험 첫 건 실패(`tokenPCalls` 2)·둘째 통과 / 변이 J2(합류를 `getKisToken` 맨 위로 옮김) → `src/lib/exchanges` 29스위트 683건 전부 통과(두 위치가 시험으로 구분되지 않는다는 뜻 — 동작은 같으니 Info). 헬퍼 쪽 변이(단일 비행 6종·가드 순서 8종·식별자 울타리)는 3차 이후 코드가 바뀌지 않았다(헬퍼·울타리 diff 0, 3b 는 `kis-domestic.ts` 머리 주석만 고침을 읽어 확인).
- [22:15] 확인하지 못한 것 — 실 KIS 에서의 「1분 1회」「발급 시 이전 토큰 무효화」(가짜 KIS 로만 확인, 모델 근거), `tokenP` 실지연이 25ms 보다 길 때의 경쟁 창(길수록 합류 이득이 커진다 `[추측]`), 다른 프로세스(웹·크론)의 동시 발급(후속 5), 실제 Next 번들에서 모듈 인스턴스가 라우트마다 갈라질 가능성(갈라지면 `refreshInFlight` 합류는 같은 인스턴스 안에서만 효과 — 종전 `invalidateKisToken` 합류와 같은 한계).
- [22:16] 판정 근거 — `kis-auth.ts` 의 변경은 폴백 경로 한 줄이고, 실험으로 확인한 결과는 F-1 의 완전한 해소(HEAD 와 동일), 긴 대기 구간의 순이익(120→60초, 앞 호출 토큰 보호), 교착·기아 없음이다. HEAD 보다 나빠지는 곳은 발급이 일시 실패하는 좁은 틈(합류 호출도 함께 거절 → 다음 호출이 복구)과 매달린 발급 요청 하나뿐이고 둘 다 fail-closed 이며 `invalidateKisToken` 호출자가 원래 가진 성질이다. 주문 경로에 새 우회·새 대기는 없다(행이 있으면 이전과 동일, 행이 없을 때는 대기가 줄어든다). 이번 라운드에 내가 찾은 새 결함은 Low 1(L-4)과 Info 몇 건뿐이고 L-4 는 이번 변경이 만든 것이 아니다. 비차단 권고: ① 합류 실패 전파 시험(500 한 번, 약 10줄) ② 둘째 시험을 `test.failing` 으로 ③ L-4 수용 명시 ④ 발급 호출에 `timeoutMs`(후속). 스크래치 사본·하네스는 모두 삭제했고 저장소에는 이 task 파일 외에 쓴 것이 없다.
- [22:17] **4차 판정: pass (scope: src/lib/exchanges/kis-auth.ts, src/lib/exchanges/kis-domestic.ts, src/lib/exchanges/kis-overseas.ts, src/lib/exchanges/kis-http.ts, src/lib/exchanges/kis-ledger-query.ts, src/lib/exchanges/kis-token-codes.ts, src/lib/exchanges/kis-token-retry.ts, src/lib/exchanges/__tests__/kis-token-retry.test.ts, src/lib/exchanges/__tests__/kis-token-sites.test.ts, src/lib/exchanges/__tests__/kis-ledger-token-retry.test.ts, src/lib/exchanges/__tests__/kis-auth-issue-single-flight.test.ts, src/lib/exchanges/__tests__/kis-balances-business-failure.test.ts, src/lib/exchanges/__tests__/kis-ticker-business-failure.test.ts, src/lib/exchanges/__tests__/kis-ticker-transient-recovery.test.ts)** (라운드 5 에서 이 절 마지막 줄의 판정으로 대체됐다)
- [23:10] ── 라운드 5 ── 범위·방법, 그리고 4차 판단의 정정 — 4차에서 내가 「합류 실패는 fail-closed 라 받아들일 만하다」고 쓴 것은 **「즉시 실패」를 전제**했고, 실제는 QA 가 짚은 대로 「멈춘 뒤 실패」였다. 내가 발급 호출에 `timeoutMs` 가 없다는 것을 Info 로만 남긴 것이 틀린 등급이었다(합류는 한 호출의 매달림을 모든 호출의 매달림으로 넓힌다). 이번에는 바뀐 `kis-auth.ts`(34줄 추가·1줄 삭제)와 시험을 읽고, **실제 `kisFetch`·`kis-auth` 에 전역 `fetch` 만 가짜**로 둔 하네스와 운영 api-usage 로그(7일, KIS 163,474건)로 확인했다. 실험은 전부 서버 스크래치 사본(src 를 복사해 저장소와 `diff -rq` 로 동일함을 확인한 뒤 사용, 끝나고 삭제)에서 했고 코드는 한 줄도 고치지 않았다. 위 4차 판정은 소문자로 내렸다(이 절의 마지막 판정 줄이 유효하다).
- [23:11] scope 14파일 변동 없음 `[확실]` — `git status` 기준 수정 8 + 신규 6, 교환 계층 밖 변경은 이 task 와 무관한 파일뿐(`public/mockups` 삭제·다른 task 파일·`.codex*`). `git diff --stat -- src/lib/safety/ src/app/api/orders/` 0줄. `kis-auth.ts` 의 이번 diff 는 상수 하나(`TOKEN_ISSUE_TIMEOUT_MS = 10_000`)·발급 호출 옵션에 `timeoutMs` 하나·주석이고, 합류 줄과 나머지 동작은 4차와 같다.
- [23:12] **질문 1 ① (10초가 실 KIS 발급 지연을 끊을 만큼 짧은가) — 아니다, 충분히 넉넉하다** `[확실 — 운영 로그]`: 7일 동안 `token-p` 129건의 지연은 최소 11 / p50 13 / p90 149 / p99 175 / **최대 204ms** 이고 1초를 넘은 것이 0건이다(그중 403 거절 111건도 11~19ms). 같은 기간 KIS 전체 163,474건은 p99 626ms·p99.9 1,192ms·최대 10,248ms 인데, 1초 초과 405건 중 **5초 초과 3건은 모두 같은 순간(10-31 00:04:18Z)의 `timeout` 이고 10,248ms 는 Node 연결 타임아웃 값**이다(요청 세 건이 동시에 연결을 못 잡은 사건 — 즉 F-A 가 겨냥한 「응답 없는 엔드포인트」는 실제로 일어난다). 발급이 10초를 넘겨 끊길 확률은 관측상 0 이고, 끊겨 `EGW00133` 1분 대기로 이어지는 경로는 사실상 열리지 않는다.
- [23:13] **질문 1 ② (최악 시간이 종전보다 나은가) — 낫다. 구현자의 상한 문구는 과대 추정이다** `[확실 — 코드]`: `issueAndStore` 는 `kisFetch` 가 **던진** 예외(타임아웃의 `AbortError`)를 잡지 않으므로 타임아웃은 재시도 없이 즉시 호출자에게 전파된다. 반복되는 것은 `EGW00133` **응답**뿐이라 최악은 「(응답 시간 + 60초) × 3」 이고, 매달림은 어느 회차에서든 ≤10초로 끝난다. 「3회 × (10초 + 대기)」(210초)는 안전한 상한이지만 실제 최악은 약 180초 + 마지막 회차 ≤10초다. 종전은 회차마다 **무계**(약 5분)였다.
- [23:14] **질문 1 ③ (타이머는 언제 시작·끝나는가) — 확인했고, 여기서 구멍이 하나 나온다** `[확실 — `kis-http.ts` 340~372행]`: 순서는 `acquireKisSlot`(대기열, 자체 상한 30초) → `setTimeout(abort)` → `fetch` → **`finally` 에서 `clearTimeout`** → 그 뒤 `await res.text()`. 즉 타이머는 **스로틀 대기를 포함하지 않고**(좋다 — 「토큰 획득 뒤」의 토큰은 KIS 접근토큰이 아니라 유량 슬롯이다. 발급 호출이 접근토큰 없이 나가는 것과 충돌하지 않는다), 헤더가 도착하면 풀린다. **본문 읽기에는 상한이 없다.**
- [23:15] **질문 2 (F-A 가 닫혔는가) — 보고된 재현은 닫혔다, 본문 정지 변형은 안 닫혔다** `[확실]` — 하네스 H1(발급 요청이 헤더조차 못 받음; A=`invalidateKisToken`, B=`getKisToken`@+10ms, C=`getKisToken`@+5초, D=`getKisToken`@+11초·서버 복구): **현재 코드는 A·B·C 가 모두 정확히 +10.0초에 `AbortError` 로 거절**되고(C 는 5초에 합류했는데도 첫 요청 시작 기준 10초에 함께 풀린다) D 는 +11.0초에 새 발급으로 성공한다(fetch 2회). 같은 시나리오를 4차 코드(`timeoutMs` 제거)로 돌리면 **20초 뒤에도 정지**(재현). 그러나 H2(헤더는 오고 본문이 멈춤): A·B 가 **+13초에도 정지** — `timeoutMs` 가 본문 읽기를 못 끊는다. 이 경우 상한은 Node 내장 본문 타임아웃(기본 약 5분 `[추측 — 이 서버 Node 의 값은 미실측]`)뿐이다. → **L-5 (Low)**.
- [23:16] **L-5 (Low, 비차단) `kis-auth.ts` 발급 호출의 `timeoutMs` 는 헤더 도착까지만 유계다** — 본문이 멈추면 합류한 모든 호출이 약 5분 `[추측]` 정지하고, 이것은 4차에서 F-A 가 설명한 것과 **같은 기전**(한 호출의 정지를 합류가 전체로 넓힘)이다. 막지 않는 이유: ⓐ 운영 163,474건에서 본문 단계 정지로 볼 만한 호출이 **0건**(성공한 가장 느린 호출 4.0초, 10초 넘은 3건은 전부 연결 타임아웃) ⓑ 발급 응답은 100바이트대 JSON 이라 헤더와 본문이 한 번에 오는 것이 보통이다 `[가능성 높음]` ⓒ 닫으려면 **이미 세 번 손댄 가장 위험한 파일에 네 번째 수정**(예: `kisFetch(...)` 전체를 `Promise.race` 로 마감 — 끊긴 요청은 버려지고 KIS 쪽 발급 여부는 모른다)이 필요해, 이 시점에서는 「고치려다 다른 곳을 나쁘게」 위험이 관측 확률보다 크다고 판단한다. 대신 **상수 주석의 「상한이 있다」를 「헤더 도착까지」로 정확히 고치고**(지금 주석·시험 설명은 본문 단계를 말하지 않는다), 이 구멍을 후속 5 에 적어 달라. 이 부분은 Leader 의 「조금이라도 걸리면 fail」 기준보다 내가 관대한 지점이므로 그렇게 보면 알려 달라.
- [23:17] **질문 3 (「유계임」 단언이 적절한가) — 값을 박는 것보다 낫지만 아래쪽이 비어 있다** `[확실]` — 변이: 호출에서 `timeoutMs` 제거·상수 300_000·상수 0·옵션을 `fetch` 초기값(2번째 인자)으로 이동 → **4종 모두 실패**. 그러나 **상수 1(ms)은 통과한다** — 1ms 면 모든 발급이 즉시 끊겨 토큰을 영영 못 받는데(전면 중단) 시험이 모른다. 단언에 하한을 더하길 권한다: 관측값(발급 최대 204ms·KIS 전체 p99.9 1.2초·성공한 가장 느린 호출 4.0초)이면 `>= 3_000` 이 정당하고 값 조정의 자유는 그대로 남는다(`3_000 <= t <= 30_000`). 비차단이지만 한 줄이고 가장 위험한 파일의 시험이다.
- [23:18] **질문 4 (L-4 의 `test.failing` 사절) — 사절은 받아들이되 근거 문장은 정정한다** — 「수단이 없다」는 과하다: 내 하네스처럼 **어느 토큰이 살아 있는지 추적하는 가짜 KIS** 를 쓰면 원하는 결과(「낡은 세대로 실패한 호출의 재시도가 성공한다」)를 메커니즘과 무관하게 단언할 수 있다. 그래도 사절이 맞는 이유는 다르다: ⓐ 그 단언을 통과시킬 알려진 설계가 없어(통과시키려면 KIS 에 토큰 생존을 묻거나 「rotated」 판정 뒤 재시도를 한 번 더 허용해 호출 예산·가드 계약을 바꿔야 한다) `test.failing` 이 영구 소음이 되고 ⓑ 결과가 확률적이다(66~83/100 — 도착 지터 고정 없이는 「예상 밖 통과」가 섞여 흔들린다). 대안은 `test.todo('L-4: 낡은 세대 호출의 복구')` 한 줄로 후속 7 을 표시하는 것이다. 비차단. (M-2 와 같은 단언이라는 구현자 설명은 「메커니즘 단언」에 한해 맞다.)
- [23:19] **질문 5 (합류 위치 변이 생존) — 동의한다** — 위치 차이는 「유효한 행 + 진행 중인 재발급」 상태에서만 나타나는데, 그 창은 `invalidateKisToken` 이 호출된 뒤 `DELETE` 가 실행되기 전의 수 ms 이고 그 사이 위치에 따라 달라지는 것은 「죽은 토큰을 한 번 더 받아 쓰고 토큰 오류 → 회전 경로로 복구」 대 「새 토큰을 기다림」 뿐이라 이득이 작다. 시험으로 고정할 값이 없다.
- [23:20] **「고치려다 다른 곳을 나쁘게」 패턴 점검** — `timeoutMs` 변경이 새로 만들 수 있는 문제를 찾아 봤고 **새로 나쁜 곳은 못 찾았다** `[확실 — 코드·실험]`: ⓐ 타임아웃은 재시도 없이 즉시 던지고 합류한 호출이 같은 시각에 함께 풀린다 ⓑ 주문 경로: `submitOrder` 는 `sendReached` 를 `realSubmit` 호출 직전에 세우므로 `createOrder` 안의 토큰 발급 예외(타임아웃 포함)는 이미 `outcomeUnknown: true` 로 분류된다 — 중복 주문을 막는 보수적 방향이고 HEAD 의 다른 토큰 예외와 같은 분류이며, 5분 정지가 10초 거절로 바뀐다 ⓒ 스로틀: 타이머가 슬롯 획득 뒤에 시작해 대기열 지연을 먹지 않고, 발급은 `critical` 레인이라 대기열이 쌓여도 선다(4차 실험) ⓓ `issueAndStore` 호출자는 `getKisToken` 폴백과 `invalidateKisToken` 둘뿐이고 자격증명 시험 라우트는 발급이 10초를 넘기는 비정상일 때만 영향 ⓔ 시험은 순서에 의존하지 않는다(`--randomize` 시드 5개 모두 4건 통과). 다만 4번째 수정 가능성(L-5)과 하한 없는 단언은 위에 적었다.
- [23:21] 재현 대조 `[확실]` — typecheck exit 0(출력 0줄) · 필터 없는 전체 jest(실제 저장소) **362스위트 통과·6 skipped·실패 0, 10390건 통과·230 skipped**(구현자 보고와 일치) · 새 시험 변이: 호출에서 제거·300_000·0·옵션 위치 오류 4종 caught / **1ms 생존**(위 질문 3). 낡은 문장 둘(Info): 시험 파일의 「(남은 미시험) … 실패 전파는 … 미검증으로 남긴다」는 바로 위 전파 시험이 생기면서 거짓이 됐고, 상수 주석의 「재시도 3회 × (10초 + 대기)」는 위 질문 1 ② 의 과대 추정이다.
- [23:22] **이 task 밖이지만 일정이 걸린 발견 — 후속 5 는 「5주간 0건」이 아니라 「매일 노출·실제 사건 1회」다** `[확실 — 로그]` — api-usage 의 `token-p` 기록: 2026-10-30 07:00:03Z~07:02:10Z(KST 16:00:03~16:02:10)에 **118건 중 403 거절 111건** — 약 38건씩 **정확히 60초 간격 세 번(07:00:03·07:01:03·07:02:03), 건당 약 200ms 간격**으로 몰렸고 성공은 7건(5+1+1)이다. `[가능성 높음]` 해석: 약 38개 호출이 같은 순간 `getKisToken()` 의 **공유 안 된 발급 경로**로 내려가(일일 갱신 시점) 각자 `EGW00133` → 60초 → 재시도를 세 번 겪었고, 약 30개는 세 번 다 거절당해 **약 2분 동안 토큰이 없었다**(같은 초에 `post-market-analysis` 크론이 시작). 이것은 T-136 이 닫지 않는 경로이고(이번 변경은 이 경로를 낫게도 나쁘게도 하지 않는다), 다른 날은 같은 초 2~3건으로 그쳐 조용히 지나갔다. 일일 갱신 시각이 매일 약 1시간씩 앞당겨지고 있다(06:02Z 가 10-31 의 마지막): 추세가 유지되면 **다음 갱신은 일요일 오후, 그다음은 월요일(11-02) 13시 전후 KRX 장중**이다 `[추측 — 주말 호출이 얼마나 있는지에 따라 달라진다]`. **task 기록의 「11-02(월)」은 달력상 화요일이다**(10-30 금·10-31 토·11-02 월·11-03 화) — 관측 시점을 하루 당겨 잡아야 한다. 권고: 후속 5(`getKisToken` 발급의 단일 비행; 라운드 1 에 내가 스크래치에서 발급 자체를 모듈 단위 단일 비행으로 묶어 같은 하네스로 120/120 발급 1회를 확인한 형태)를 월요일 장중 전에 처리할 가치가 있다. 이 task 의 판정 조건은 아니다.
- [23:23] 판정 근거 — F-A(보고된 재현: 응답 없는 발급)는 실험으로 닫혔고(합류 호출 포함 10.0초 상한, 4차 코드는 20초 넘게 정지), 10초는 실 KIS 지연(발급 최대 204ms)보다 50배 크며, `timeoutMs` 변경이 새로 만드는 나쁜 곳은 찾지 못했다. 남은 것은 L-5(본문 정지, 관측 0건·네 번째 수정의 위험이 더 큼)와 시험 하한 부재(1ms 생존)로 모두 Low 이고, 둘 다 아래 비차단 권고로 처리할 수 있다. 비차단 권고: ① 단언 하한 `3_000 <= t` ② 상수 주석을 「헤더 도착까지 유계」로 정정하고 L-5 를 후속 5 에 기재 ③ 낡은 문장 둘 정정 ④ L-4 는 `test.todo` 표시 ⑤ **월요일 장중 전에 후속 5 처리 여부를 Leader 가 결정** ⑥ 관측 일정 「11-02(월)」→ 11-02(월) 정정. 스크래치 사본·하네스는 모두 삭제했고 저장소에는 이 task 파일 외에 쓴 것이 없다.
- [23:24] **최종 판정: PASS (scope: src/lib/exchanges/kis-auth.ts, src/lib/exchanges/kis-domestic.ts, src/lib/exchanges/kis-overseas.ts, src/lib/exchanges/kis-http.ts, src/lib/exchanges/kis-ledger-query.ts, src/lib/exchanges/kis-token-codes.ts, src/lib/exchanges/kis-token-retry.ts, src/lib/exchanges/__tests__/kis-token-retry.test.ts, src/lib/exchanges/__tests__/kis-token-sites.test.ts, src/lib/exchanges/__tests__/kis-ledger-token-retry.test.ts, src/lib/exchanges/__tests__/kis-auth-issue-single-flight.test.ts, src/lib/exchanges/__tests__/kis-balances-business-failure.test.ts, src/lib/exchanges/__tests__/kis-ticker-business-failure.test.ts, src/lib/exchanges/__tests__/kis-ticker-transient-recovery.test.ts)**

## 구현 라운드 2 — 1차 감사 FAIL 반영 (메인 세션)

판정은 **FAIL**(High 1 · Medium 1 · Low 2 · Info 1). H-1 은 **내가 만든 결함**이고, 이 task 가 없애려던 증상을 원장 경로에 새로 만든 것이었다.

- [20:10] **H-1 (High) — 원장 사이트의 가드를 헬퍼 앞으로 옮겼다.** 다른 7곳은 `attempt === 0 &&`·`!tokenRetried &&` 를 **먼저** 보는데, 원장만 헬퍼를 무조건 평가한 뒤 `!tokenRetried` 를 봤다. 그래서 재발급 뒤 또 토큰 오류가 나면 `invalidateKisToken()` 이 **두 번** 불렸고(감사자 실측: HEAD 1회 → 신규 2회), 두 번째가 `EGW00133` 에 걸리면 `issueAndStore` 가 60초 대기에 들어가 같은 프로세스의 `getKisToken()`(주문 경로 포함)이 막힌다 — **M-2 를 원장 경로에 새로 만든 셈이다.**
  - 감사자 지적의 핵심은 수정보다 **왜 숨었는가**다: 기존 「두 번 오류」 시험들이 `invalidateKisToken` **호출 횟수를 세지 않아** 668건 전부 통과 상태로 숨어 있었다. 연산 순서를 뒤집는 변이를 다른 사이트에 넣어도 전부 통과했다.
  - 그래서 **원장 전용 시험 파일을 새로 만들었다**(`kis-ledger-token-retry.test.ts`, 5건, 실제 `kisFetch`). 핵심 단언은 "복구했는가" 가 아니라 **재발급 호출 횟수**다 — 만료 1회 복구(재발급 1·새 토큰으로 재시도) / **만료 2회에도 재발급 1회**(H-1 가드) / `EGW00121` 도 분기 / 회전 시 재발급 0 / 토큰 아닌 500 은 재발급 0·호출 1회(원장은 `transientRetries` 없음).
  - 기존 「두 번 오류」 시험 2건(국내 잔고·국내 시세)에도 `expect(invalidateKisToken).toHaveBeenCalledTimes(1)` 를 추가했다.
  - 변이 검증: 가드를 헬퍼 뒤로 되돌리면 원장 시험이 정확히 그 줄에서 실패한다(1 failed / 4 passed).
- [20:16] **L-2 (Low) — 울타리를 "문자열" 에서 "동작" 으로 바꿨다.** 감사자가 문자열 울타리를 6가지로 통과시켰고(문자 클래스 `/EGW0012[13]/`·소문자·이어붙이기·표현식 템플릿·하위 디렉터리·`.tsx`), 결정적으로 **코드 문자열 없이 `res.status === 401` 에서 `invalidateKisToken()` 을 직접 부르는 분기**가 울타리와 668건을 모두 통과했다. 판정을 어떻게 쓰든 **위험한 동작은 재발급 한 가지**라는 감사자 권고를 받아들여, `invalidateKisToken` **식별자를 `kis-auth.ts`·`kis-token-retry.ts` 밖에서 금지**하는 울타리를 추가했다(문자열 울타리는 보완으로 남긴다).
  - 변이 검증: 401 분기 심기(코드 문자열 없음)·문자 클래스 정규식 + 직접 재발급, **둘 다 잡힌다**(각 1건 실패). 문자열 울타리만으로는 둘 다 통과했다.
- [20:18] **L-1 (Low)** — `kis-http.ts` 의 새 JSDoc 문단에 `*/` 가 빠져 다음 주석과 합쳐져 있었다. 복구했다.
- [20:19] **I-1 (Info)** — 죽은 모의 키 `isKisTokenError: jest.fn(() => false)` 2곳 삭제(잎 모듈로 빼면서 불필요해졌다. 그 주석도 거짓이 됐다) · 울타리 시험 이름의 「kis-http.ts 만 예외」 → 「단일 출처 잎 모듈만 예외」 · `kis-domestic.ts` 주석의 「토큰 만료(`EGW00123`)」 → 토큰 계열(`EGW00121` 포함).
- [20:22] 재검증 — 서버 `npm run typecheck` **exit 0** · `npx jest src/lib/exchanges` **28스위트 675건 전부 통과**. 변이 사본 삭제.

### 🔴 M-1 (Medium) — 이 task 에 넣지 않는다 (Leader 결정 · 위험 수용)

감사자가 Leader 결정으로 남긴 항목이다. `getKisToken()` 은 **순수한 읽기가 아니다** — DB 행이 없으면 `invalidateKisToken` 의 단일화(`refreshInFlight`)를 거치지 않고 **독립적으로 발급**한다. 감사자 모델(요청 4건이 동시에 토큰 오류, 도착 간격 8ms)에서 종전은 120/120 발급 1회였는데 신규 헬퍼는 **104/120 에서 60초 대기**, 18/120 에서 호출 하나가 던졌다.

**넣지 않는 이유:**
1. 완전한 수정은 `kis-auth.issueAndStore` 의 **발급 자체를 단일 비행으로 묶는 것**이고, 그 파일은 이 task 의 8파일 밖이다. 토큰 발급의 동시성 설계를 바꾸는 일은 **그 자체로 감사 초점**이 되어야 한다.
2. 감사자가 제시한 한 줄 부분 수정(`getKisToken()` 맨 위 `if (refreshInFlight) return refreshInFlight;`)은 대기를 29/120 로만 줄이고 **완전하지 않다** — 어중간한 수정을 넣으면 "고쳤다" 는 착각이 남는다.
3. 전제(KIS 1분 1회 제한·발급 시 이전 토큰 무효화)가 **저장소 주석 근거의 모델**이고 실제 KIS 로 시험된 것이 아니다.
4. 같은 모양이 T-133 의 국내 `getTicker` 로 **이미 운영 중**이고, 운영 로그 5주간 토큰 만료는 **0건**이다. 트리거(DB 행 없음)는 더 드물다.

**수용하는 위험**: DB 토큰 행이 없는 상태에서 여러 조회가 동시에 토큰 오류를 받으면, 발급이 중복돼 `EGW00133` 60초 대기에 들어갈 수 있다. 그 동안 같은 프로세스의 `getKisToken()`(주문 경로 포함)이 막힌다. **후속 후보 5** 로 올리고, 11-02(월) 관측에서 `token expired, re-issuing` 이 분 단위로 반복되면 그때 즉시 착수한다.

### 라운드 2 재확인 요청 범위

원장 가드 순서 + 전용 시험 5건 · `invalidateKisToken` 식별자 울타리 + 허용 파일 시험 · 기존 「두 번 오류」 2건의 횟수 단언 · `kis-http.ts` JSDoc 닫기 · 죽은 모의 키·낡은 주석 3곳.

## 구현 라운드 3 — 2차 감사 CONDITIONAL_PASS 반영 · M-1 결정 **번복** (메인 세션)

2차 판정은 **CONDITIONAL_PASS**. H-1 은 닫혔고, 감사자가 **내 M-1 위험 수용 근거 두 개를 사실로 반박**했다. 그 반박이 맞아서 결정을 뒤집고 M-1 을 이 task 에 넣었다.

- [20:50] **M-1 결정 번복 — 넣는다.** 내가 "완전한 수정은 8파일 밖(`kis-auth.issueAndStore`)" 이라고 했는데 **틀렸다.** 감사자가 같은 시나리오를 `kis-token-retry.ts` **안에서** 닫는 방법을 제시하고 실측까지 했다 — 죽은 토큰(`usedAuth`)을 키로 한 모듈 수준 단일 비행. 도착 간격 8ms·60ms 모두 **120/120 발급 1회·60초 대기 0·던짐 0**, 종전(HEAD)이 60ms 에서 81/120 대기하던 것도 사라진다. **이미 커밋 대상인 파일에서 15줄로 되는 일**이었다.
  - 두 번째 반박도 맞다 — 내가 "트리거(DB 행 없음)는 더 드물다" 고 했는데, 그 상태는 독립 사건이 아니라 **먼저 도착한 호출 자신의 `DELETE` 가 만든다.** 토큰 사망이 일어나면 동시 요청 2건 이상은 거의 항상 성립한다.
  - 그리고 감사자 지적대로 "이미 운영 중" 은 `getTicker` **한 곳**의 사실이다. 나머지 7곳은 HEAD 에서 이 시나리오를 발급 1회로 끝냈다. **이 task 는 M-2(회전된 토큰 삭제)를 좋게 하고 그 경우를 나쁘게 하는 교환을 하고 있었다** — 단일 비행을 넣으면 교환이 아니라 둘 다 개선이 된다.
  - 구현: `inFlight: Map<string, Promise<boolean>>` 를 `usedAuth` 로 키잉. 같은 죽은 토큰으로 동시에 실패한 호출은 **판단 하나를 함께 기다린다**. 끝나면 `.finally()` 로 키를 지우므로 다음 사망에는 새로 판단한다. 판단이 던지면 공유한 호출 전부가 던지고 키는 남지 않는다. 시험 전용 `__resetTokenRetryForTest()` 를 뒀다.
  - **한 프로세스 안의 단일화**다. 웹·크론처럼 **다른 프로세스 사이의 중복 발급**과 재발급 구간에 끼어드는 주문 경로의 `getKisToken()` 은 그대로 남는다 — 그것이 후속 후보 5 의 **진짜 범위**다(감사자 정정). 후속 후보 5 를 그 범위로 다시 적었다.
  - 시험 5건: 동시 4건 → 재읽기 1·재발급 1 / 토큰이 다르면 공유 안 함 / 끝나면 키 삭제 / **던지면 전부 던지고 키 안 남음** / 토큰 오류가 아니면 판단을 만들지도 않음.
- [20:56] **L-3 (Low) — 가드 순서를 구조로 고정했다.** 감사자가 순서 뒤집기 변이를 8곳에 넣어 보니 **5곳은 시험이 못 잡았다**(국내·해외 `getCompletedOrders`·`getUsdCash`·`getPriceDetail`·해외 보유). 지금 코드는 맞지만 **미래 편집을 막는 그물에 구멍**이다. 파서 울타리 하나로 8곳을 덮었다 — 모든 헬퍼 호출이 `attempt === 0 &&`·`!tokenRetried &&` 의 오른쪽이거나 `if (!tokenRetried)` 안에 있어야 한다.
  - 변이 검증: 해외 `usdCash`(라운드 1 에서 살아남은 5곳 중 하나)의 가드를 헬퍼 뒤로 옮기면 **이제 잡힌다**(1건 실패).
- [20:58] **식별자 울타리를 `src/` 전체 재귀로 넓혔다.** 감사자가 통과시킨 우회 중 "교환 계층 밖" 이 현실적이라고 지적했다(`profit-engine/daily-bars-kis.ts`·`app/api/` 여러 곳이 이미 `getKisToken`·`kisFetch` 를 직접 쓴다). `__tests__` 는 제외(모의 공장이 그 이름을 쓰는 것이 정상).
  - 변이 검증: `src/app/api/ticker/route.ts` 에 `invalidateKisToken` import 를 심으면 잡힌다.
  - **여전히 못 잡는 것**(감사자 목록, 통과를 막지 않음): 문자열 요소 접근 `ns['invalidateKisToken']()` · 토큰 행을 SQL 로 직접 삭제. 전자는 파서로도 식별자가 아니고, 후자는 DB 계층 문제다.
- [20:59] **I-1 잔여 2건** — `kis-domestic.ts` 의 「`getBalances` 처럼 곧바로 `invalidateKisToken()` 을 부르면」(이제 `getBalances` 도 헬퍼를 쓴다) · `kis-token-retry.ts` 의 「호출마다 DB 를 본다」(행이 **없으면 스스로 발급한다**는 것이 §동시성의 전제라 그 문장을 고쳐 적었다).
- [21:00] 재검증 — 서버 `npm run typecheck` **exit 0** · `npx jest src/lib/exchanges` **28스위트 681건 전부 통과**. 변이 4종 전부 탐지(단일 비행 제거·키 미삭제·가드 순서 뒤집기·교환 계층 밖 재발급). 사본 삭제.
- [21:01] **scope 정정 받아들임** — 감사자가 9파일이 아니라 **12파일**이라고 정정했다(이번에 수정한 기존 시험 3개 `kis-balances-business-failure`·`kis-ticker-business-failure`·`kis-ticker-transient-recovery` 가 `^src/lib/exchanges/` 에 걸린다). 라운드 3 에서 원장 시험 1개가 더 늘어 **13파일**이다 — 판정 줄 `scope` 에 전부 들어가야 커밋이 통과한다.

### 라운드 3 재확인 요청 범위

`kis-token-retry.ts` 단일 비행(+시험 5건) · 가드 순서 울타리 · 식별자 울타리 재귀 확장 · 주석 2곳 · scope 13파일.
- [21:10] **광역 검증에서 내 시험 주석 1건이 T-119 격리 시험을 깼다.** 이번 광역 실행에 `src/lib/profit-engine` 을 **처음 넣었더니** `isolation.test.ts` 가 1건 실패했다 — 매매 경로(이 파일도 검사 대상)에서 profit-engine 모듈 **파일명**을 찾으면 실패하는 규칙인데, 내가 식별자 울타리 주석에 그 파일명을 적었다. 주석을 "일봉 수집 모듈" 로 바꾸고, **적지 말라는 경고**를 그 자리에 남겼다. 허용 목록에 추가하지 **않았다** — 주석 한 줄 때문에 격리 울타리를 넓히는 것은 맞지 않다.
  - **교훈**: 내 광역 검증 패턴(`exchanges safety app/api strategy signals`)에 `profit-engine` 이 빠져 있었다. T-133·T-136 라운드 1~2 의 "광역 통과" 는 그 경로를 **보지 않은 통과**였다. 앞으로 이 프로젝트의 광역은 `profit-engine` 을 포함한다.
- [21:12] 재검증 — 서버 `npm run typecheck` **exit 0** · `npx jest src/lib/profit-engine/__tests__/isolation.test.ts src/lib/exchanges` **29스위트 740건 전부 통과**.

## 구현 라운드 3b — 3차 감사 PASS 뒤 Info 반영 (메인 세션)

3차 판정은 **PASS**. 감사자가 실제 `kis-auth` 하네스로 **8ms·60ms 모두 120/120 발급 1회·대기 0·던짐 0** 을 재현했고(종전 방식은 60ms 에서 77/120 대기), 순서 뒤집기 변이를 8곳 전부에 넣어 **8/8 탐지**, 식별자 울타리 확장 변이 5종도 전부 탐지했다. 필터 없는 **전체 jest 361스위트 10386건 통과·실패 0**.

- [21:30] **Info 1건 반영** — `kis-domestic.ts` 머리글의 「(이 함수는 호출마다 DB 를 본다)」가 남아 있었다(`getKisToken()` 은 행이 없으면 **스스로 발급한다**). 그 문단을 **헬퍼 머리글을 가리키는 쪽으로 다시 썼다** — 같은 설명을 두 곳에 두면 또 어긋난다. 어댑터 주석에는 「**가드를 헬퍼보다 앞에 둔다**」는 이 파일이 지켜야 할 규칙만 남겼다.
- [21:31] **scope 정정 받아들임 — 13파일이 아니라 12파일이다.** 내가 라운드 3 에서 "원장 시험이 더 늘었다" 고 했는데 그 파일은 **라운드 2 의 12파일에 이미 있었다**. 수정 7(어댑터 4 + 기존 시험 3) + 신규 5(모듈 2 + 시험 3) = 12. 감사자 판정 줄의 scope 가 정본이다.
- [21:32] **감사자도 같은 허점이 있었다는 기록** — 감사자가 라운드 2 에 보고한 「광역 192스위트 통과」도 내가 넘긴 패턴(`profit-engine` 없음)을 그대로 쓴 것이라 **같은 경로를 보지 않은 통과**였다고 스스로 밝혔다. 3차에서 필터 없는 전체 실행으로 바꿨다. 교훈을 둘로 적는다: ① 이 프로젝트의 광역은 `profit-engine` 을 포함한다 ② **감사자에게 넘기는 검증 명령도 감사 대상**이다 — 내가 준 패턴이 그대로 쓰여 두 라운드의 광역 결과가 같이 좁았다.
- [21:33] **비차단으로 남긴 것**(감사자 Info) — 원장에서 `getKisToken` 이 reject 할 때 `failed`/`auth_error` 로 가는지 보는 시험이 없다. 헬퍼 단위 시험이 throw 전파를 고정하고 원장은 그 예외를 try/catch 로 받지만, **원장 쪽 종단 시험은 없다.** 후속 후보 6 으로 올린다.

## QA

- [21:12] 범위·방법 — 서버(`home_ubuntu`)에서 실행했다. 변이·프로브·하네스는 전부 `~/.node-local/qa-t136/work`(src 사본, 저장소와 `diff -rq` 로 동일 확인)에서만 돌렸고, 저장소는 읽기만 했다. 코드·커밋·push 없음. 끝난 뒤 scratch 를 삭제했다.
- [21:12] 재현 조건 — 서버 HEAD `e34b297` + 작업트리 12파일(수정 7·신규 5), jest 29.7.0. 하네스·프로브만 가짜 DB·자격증명·KIS HTTP 를 쓰고 60초 대기는 가상 시계로 건너뛰며 대기 횟수를 센다(실 KIS 아님). 모든 실행은 `flock /tmp/stockinvest-heavy-tests.lock` 아래.
- [21:13] 실행 결과 (직접 실행) — ① `npm run typecheck` exit 0(출력은 npm 배너뿐). ② 전체 `npx jest`(필터 없음) 1회: Test Suites 361 passed · 6 skipped(총 367), Tests 10386 passed · 230 skipped · 실패 0 — 감사자 3차 수치와 일치. ③ `isolation.test.ts` + `src/lib/exchanges` 2회: 29 스위트 · 740건 통과 ×2. ④ 울타리 변이 가드 순서 뒤집기 8곳(O1–O8) 전부 실패, 거짓 통과 후보 `||`(F1)·변수 호이스트(F2)도 실패 — O8 은 행동 시험 「두 번 오류 재발급 1회」도 함께 실패. ⑤ 저장소 단위 시험(`kis-token-retry.test.ts`)이 단일 비행 변이 5종(키 미삭제·성공에서만 삭제·상수 키·set 앞 await·재읽기 제거)을 전부 잡음. ⑥ EGW00121 엄격 프로브(응답에서 코드와 한글 문구를 모두 바꿈, 기존 EGW00123 시험 7파일 190건): T-136 190/190 통과, HEAD 대조군 11건 실패 — 프로브가 구별력 있음. ⑦ 식별자 울타리 우회 프로브 4종: 양성 대조 1건은 잡힘, 3종은 통과(F-2).
- [21:14] 안전 확인 `[확실]` — `git diff --stat -- src/lib/safety src/app/api/orders` 0줄. 헬퍼 호출 8곳은 domestic 85·275·659, overseas 469·609·650·1021, ledger 294 이고 `createOrder`(domestic 345·overseas 731)·`cancelOrder`(401·805) 구간에는 0곳. `transientRetries` 5곳(domestic 77·272, overseas 101·466·647)은 `method` 를 넘기지 않아 GET 이며 가드는 `kis-http.ts:333-337`, 시험 `kis-http.test.ts:311`("GET 조회에만")이 전체 실행에서 통과. `invalidateKisToken` 식별자는 `src/` 전체(시험 제외)에서 `kis-auth.ts`·`kis-token-retry.ts` 두 곳뿐. 발급 엔드포인트 `oauth2/tokenP` 사용처 중 `kis-verify.ts`·`owner-kis-migration.ts` 는 검증 전용이며 공유 캐시를 쓰지 않는다. 헬퍼 `console.warn` 2종은 label 과 고정 문구만 싣는다. label 출처: 어댑터 상수, `excd` 는 `fetchBalancesForExchange('NAS', …)` 한 곳, ledger `spec.trId` 는 상수. 토큰·계좌·금액은 없다. 커밋 scope 12개 = 실제 변경 12파일(차이 0). 판정 줄 146 은 `## Reviewer` 섹션(104–147) 안이고, 헤딩 중 `reviewer` 를 담은 것은 104행 하나뿐이다.
- [21:15] 단일 비행 하네스 결과 — 실제 `kis-auth`·`kis-token-retry` 사용, 시나리오당 15회. 열은 「발급 횟수 / 60초 대기 횟수 / 실패 호출」.

| 시나리오 | 종전(HEAD) 모양 | T-136 | 비고 |
|---|---|---|---|
| 4건 동시 (0ms) | 1 / 0 / 0 | 1 / 0 / 0 | 동일 |
| 4건 8ms 간격 | 1 / 0 / 0 | 1 / 0 / 0 | 동일 |
| 4건 60ms 간격 | 4 / 45 / 0 | 1 / 0 / 0 | 종전의 연쇄 무효화 해소 |
| 50건 동시 | 1 / 0 / 0 | 1 / 0 / 0 | 동일 |
| 50건 8ms 간격 | 11–14 / 198 / 49 | 1 / 0 / 0 | 종전 49건 실패 해소 |
| 혼합 토큰 (F-1) | 1 / 0 / 0 | **2 / 15 / 0** | **회귀** — 아래 F-1 |
| 회전된 토큰 (M-2 경우) | 1 / 0 / 0 | 0 / 0 / 0 | 종전은 멀쩡한 토큰을 지움, T-136 은 안 지움 |
| 발급 1회 실패 뒤 복구 | 복구 | 복구 | 2차 웨이브 2건 성공 |

변이의 하네스 반응: mA(키 미삭제)·mB(성공에서만 삭제) → 복구 시나리오에서 60/60 실패(영구 실패). mC(상수 키) → 혼합 시나리오에서 F-1 이 사라짐(15/15 깨끗). mD(set 앞 await) → 하네스 미탐지(타이머 단위 도착이라 같은 틱 경쟁을 만들지 못함) — 저장소 단위 시험 「동시 4건」이 잡는다. mE(재읽기 제거) → 회전 시나리오 발급 1회(M-2 재현).

- [21:16] **F-1 [Medium] 혼합 토큰에서 종전 대비 회귀 (15/15 재현).**
  - 위치: `src/lib/exchanges/kis-token-retry.ts:77-78`(판단을 죽은 토큰 값으로 공유) · `:86` `getKisToken()` 이 DB 행 없음을 보면 `kis-auth.ts:60` `issueAndStore` 로 **직접** 발급한다 — `invalidateKisToken` 의 `refreshInFlight`(`kis-auth.ts:115-129`)를 거치지 않는다.
  - 발생 상황: 죽은 토큰 T0 로 4건이 동시에 실패해 재발급 판단이 진행 중이고(DB 행이 DELETE 된 구간), 그 사이 DB 값과 다른 죽은 토큰 Tstale 로 실패한 호출이 10ms 뒤 도착.
  - 기대(종전 기준): 재발급 1회·대기 0. Tstale 호출은 진행 중인 재발급에 합류한다.
  - 실제: Tstale 호출이 자기 판단으로 직접 발급 → KIS `EGW00133` → 60초 대기 → 두 번째 발급 → 먼저 받은 N1 이 무효화. 15회 모두 발급 2회·대기 1회. 실패 호출은 0건(재시도 시점이 우연히 앞섬).
  - 영향(추론, 미시험): 읽기 호출 1건이 60초 늦어지고, 추가 회전으로 그 시점 N1 을 들고 있던 주문은 토큰 오류로 떨어질 수 있다(fail-safe — 중복 주문 없음). 행이 다시 채워진 뒤라 다른 호출을 막지는 않는 것으로 보인다.
  - **감사 정정**: 3차 감사 M-1 의 「남은 것은 HEAD 에도 있던 둘뿐」은 이 경우에 틀렸다. 이 경우는 T-136 판단 경로가 새로 만든 직접 발급이고, 종전에는 같은 호출이 진행 중인 재발급에 합류했다.
  - 재현: 죽은 토큰 T0 · KIS 는 TNEW 로 회전 · 4건 동시(0ms) · 1건 Bearer Tstale(10ms). 기대 발급 1, 실제 2.
  - 수정 후보(QA 는 설계를 고르지 않는다): (a) 판단 키를 죽은 토큰이 아니라 「판단 진행 여부」로 — 하네스에서 이 경우는 사라진다(상수 키 변이 15/15 깨끗). 단 시험 「토큰이 다르면 공유하지 않는다」를 바꿔야 하고, 드물게 재발급을 건너뛸 수 있다(추론, 미시험). (b) `getKisToken` 재읽기가 행 없음을 보면 `refreshInFlight` 에 합류 — `kis-auth.ts` 변경이라 12파일 범위 밖, Leader 결정. (c) 위험 수용을 명시 기록하고 관측 신호를 건다.
- [21:17] F-2 [Low, 비차단] 식별자 울타리가 못 보는 우회 3종 — 프로브로 실측 통과. ① 문자열 요소 접근 `ns['invalidateKisToken']()` ② SQL `DELETE FROM system_config WHERE key='kis_access_token'` ③ `/oauth2/tokenP` 직접 호출. 울타리는 AST 식별자만 본다. 현재 소스에는 해당 사례가 없다. 권고: `kis_access_token` 문자열과 `oauth2/tokenP` 를 `kis-auth.ts` 밖에서 금지(단 `users.ts:369` 의 `kis_access_token` 컬럼은 별개 저장소라 허용 목록이 필요).
- [21:17] Info (비차단) — ① 종전 코드에도 있던 토큰 앞부분 로그: `kis-auth.ts:85` 발급마다 8자, `kis-overseas.ts:643` 은 `KIS_OVERSEAS_DEBUG=1` 일 때 12자. 본 diff 밖, 후속 정리 후보. ② `ledgerPage` 의 `getKisToken` reject → `auth_error` 종단 시험 0건(감사 Info 와 같음).
- [21:18] 확인하지 못한 것 — 실 KIS 에서의 「1분 1회」「발급 시 이전 토큰 무효화」(코드 주석 근거, 가짜 KIS 로만 확인). 웹·크론 등 다른 프로세스의 동시 발급(후속 5). `tokenP` 실지연(가짜 25ms — 실지연이 길면 F-1 의 창이 넓어진다, 추론). 전체 jest 는 1회만(집중 시험은 2회). `kis-usage-isolation.test.ts` 의 1회 불안정은 이번 실행에서 재현되지 않았다. 운영 로그 확인은 배포 후에만 가능하다.
- [21:18] 배포 후 확인 (deployer 에게 전달) — 대상은 pm2 `stockinvest`(웹)와 `stockinvest-cron` 둘 다다(둘 다 KIS 를 호출한다). 명령: `pm2 logs stockinvest --lines 3000 --nostream | grep -E 'issued new token|EGW00133|re-issuing|rotated elsewhere'`, cron 앱도 같은 형식. 정상 기준: `issued new token` 이 1분에 2회 이상 없음 · `KIS token error: 403 … EGW00133` 0건 · `token expired, re-issuing` 은 실제 토큰 만료 때만 드묾 · `token rotated elsewhere` 는 다른 프로세스 회전이 있을 때만. 시점: 배포 직후 30분과 1시간. 앱 개수: `pm2 jlist` 에서 `stockinvest-cron` 이 정확히 1개인지(중복 기동 시 주문·집계가 두 번 돈다). 화면: 국내·해외 잔고 화면을 한 번씩 열어 오류가 없는지(정확한 경로는 deployer 확인).
- [21:19] 커밋 주의 (QA 가 본 것) — 12파일만 스테이징한다. `D public/mockups`·`.codex/` 는 다른 세션 것이다. 커밋은 서버 worktree 에서 한다: 이 Mac 의 `core.hooksPath` 는 `/home/brownjeon/.local/share/stockinvest-git-hooks/361294826755`(서버 경로)이고 Mac 에는 그 파일이 없어(`ls` 실패) `commit-msg` 가 돌지 않는다. CLAUDE.md 「Mac 세션에서는 이 훅이 돌지 않는다」와 같은 상태다.
- [21:19] 1차 QA 판정(2회차로 대체됨): fail — 재현된 결함 F-1(Medium, 혼합 토큰에서 종전 대비 회귀, 15/15 재현). Critical 0건, F-2 는 비차단 Low. 수정 후 Reviewer 부터 재순환하거나, Leader 가 F-1 을 위험 수용으로 명시 기록하면 그 근거로 PASS 를 발행할 수 있다(QA 단독 결정 아님). 나머지 검증 항목(typecheck·전체 jest·집중 2회·가드 순서 8/8·EGW00121 엄격 프로브 190/190·주문 경로 무영향)은 통과.

### 2회차 QA (구현 라운드 4 · 4차 감사 PASS 뒤) — 독립 실행

- [22:05] 범위·방법 — 서버 `home_ubuntu` 의 저장소 실제 파일에서 실행했다. 실행 도중 HEAD 가 `8bef2ee` → `3669090`(docs 전용, `git diff 8bef2ee HEAD -- src` 0줄)로 움직였고 14파일은 그대로다. 변이·하네스·사본은 전부 `~/.node-local/qa-t136-r2/work`(src 를 복사해 저장소와 `diff -rq` 동일 확인)에서만 돌렸다. 저장소에 쓴 것 없음 · 커밋·push 없음. 이 세션이 쓴 파일은 이 task 파일과 20-Log 한 줄이다.
- [22:05] 재현 조건 — Node v24.22.2 · jest 29.7.0 · 가짜 DB(`system_config` 한 행) · 가짜 자격증명 · 가짜 KIS(발급 응답 25ms, 발급 간격 300ms 창, 새 발급이 이전 토큰을 무효화) · 스로틀 무력화(토큰 로직만 분리). 시간 축소: scratch 사본의 `kis-auth` 두 벌(현재·HEAD)에서 `setTimeout(r, 60_000)` → `300` 만 바꿨고, 결과는 횟수와 「60초 등가 배수」로 적었다. F-1·L-4 는 100회, 기본·회전·주문 경로·실패 전파는 30회, 매달림은 3회. 하네스: `~/.node-local/qa-t136-r2/work/src/__qa_r2__/t136-r2.test.ts` · 로그: `~/.node-local/qa-t136-r2/logs/`.
- [22:06] 직접 실행 결과
  - typecheck (서버) exit 0 · 출력 0줄.
  - 토큰 관련 스위트 31개 × 2회: 두 번 다 31/31 suites · 920/920 tests 통과.
  - 전체 jest (필터 없음): Test Suites 362 passed · 6 skipped (368) · Tests 10389 passed · 230 skipped · 실패 0. 구현자 수치와 일치.
  - 커밋 훅 사전 점검 (훅의 판정 함수 4개를 `scripts/git-hooks/commit-msg` 에서 발췌해 실행, 스테이징 없음): 헤딩 중 reviewer 를 담은 것은 `## Reviewer`(106행) 하나. 섹션 안 `최종 판정` 줄은 161행 하나 → PASS, scope 14항목. 워킹트리의 14파일(수정 8 · 신규 6)은 전부 scope 와 일치하고 모두 `^src/lib/exchanges/` 에 걸린다.
  - **Mac 에서는 이 훅이 돌지 않는다**: `core.hooksPath` 가 서버 경로(`/home/brownjeon/.local/share/stockinvest-git-hooks/361294826755`)이고 Mac 에 그 파일이 없다. 커밋은 서버에서 해야 훅이 돈다.
- [22:10] **F-1 — 닫힘 확인** [확실] (100회씩 · 발급 = 성공 응답 · 60초 대기 = EGW00133 거절 1회)

  | 모드 | 발급(성공) | 60초 대기 | 호출 실패 |
  |---|---|---|---|
  | HEAD (HEAD `kis-auth` + 재발급 먼저) | 1 (100/100) | 0 | 0 |
  | HEAD `kis-auth` + 현재 헬퍼 (합류 줄 없음) | 2 (100/100) | 1 (100/100) | 0 |
  | T-136 현재 | 1 (100/100) | 0 | 0 |

  합류 없는 조합의 「발급 요청 3회」는 성공 2 + 거절 1 이다. 1차 「2회·대기 1」과 감사 「3회·60초 대기」는 같은 현상을 다르게 센 것이다.
- [22:10] **L-4 실측** (S2: Tstale 0ms 먼저, T0 네 건 1~8ms, 100회) — HEAD 실패 0/100 · 현재 최소 1건 실패 66/100(발급 1회, 대기 0). 감사 측정 83/100·75/100과 방향은 같고 크기는 다르다(난수 차이로 보임 [추측]). 기전 일치: Tstale 의 판단이 DB 를 읽고 「회전됐다」로 보고 죽은 T0 로 재시도 → 두 번째 토큰 오류.
- [22:11] 나머지 시나리오 (`kis-auth` 현재 vs HEAD)
  - 회전된 토큰 (DB = 살아 있는 T1, 요청 = 죽은 T0, 30회): HEAD 재발급 1회(살아 있는 토큰을 지움) · 현재 재발급 0회 · 실패 0. M-2 는 닫힘.
  - 기본 (T0 네 건 0~8ms, 30회): 모두 발급 1회 · 대기 0 · 실패 0.
  - 주문 경로 대기 (발급 창 안에서 A 가 무효화, 주문 경로와 같은 `getKisToken()` 인 B 가 10ms 뒤 호출, 30회): HEAD B 평균 682ms(60초 등가 2.27배 · 발급 2 · 대기 3) · 현재 B 평균 347ms(1.16배 · 발급 1 · 대기 1). A 는 30/30 성공. 합류의 순이익 실측.
  - 합류한 발급이 실패 (첫 발급만 500, 30회): HEAD A 실패 · B 성공 30/30 · 현재 A 실패 · **B 실패 30/30**. 다음 호출은 두 모드 모두 30/30 복구. 새 손실이다 — 주문 경로가 한 번 실패한다. 돈 위험은 없다.
  - **발급 요청 하나가 매달림** (첫 발급 1000ms 지연, 3회): HEAD B 28–30ms · 현재 B 1021–1027ms. 합류 호출은 매달림이 풀릴 때까지 기다린다. 실제 상한은 **Node 내장 fetch 의 헤더 타임아웃**이다 — 응답 없는 서버에 fetch 하니 300,754ms 뒤 `UND_ERR_HEADERS_TIMEOUT` 으로 실패했다(`logs/undici_check.log`, 실측). 즉 최대 약 5분 동안 모든 `getKisToken()` 호출(주문 경로 포함)이 멈춘다. 4차 감사가 이를 「fail-closed」라고 적은 것은 틀렸다 — 「즉시 실패」가 아니라 「멈춘 뒤 실패」다.

#### 결함

- **F-A [Medium · 새로 생김 · 통과를 막는다]** `src/lib/exchanges/kis-auth.ts:72`(합류 줄) × `kis-auth.ts:91-95`(발급 호출, `timeoutMs` 없음) — 위 「매달림」 재현. 영향: 가용성(지연 최대 약 5분), 잘못된 주문·돈 위험 없음. 발생 조건: 토큰 엔드포인트의 요청 하나가 응답하지 않고 다른 요청은 응답하는 상태. HEAD 에는 없던 모양이다 — HEAD 의 `getKisToken` 발급 호출은 자기 요청으로 빠져나갈 수 있었다. 수정 후보(설계는 Developer·Reviewer 몫): 발급 호출에 상한(`timeoutMs`)을 넣는다. 트레이드오프 [추측]: 시간 초과로 끊은 요청이 KIS 에서는 이미 발급됐을 수 있고, 그러면 다음 발급이 1분 제한에 걸린다. 수치와 함께 적어야 한다.
- **F-B [Low · 설계상 수용 · 실측 확인]** 합류한 발급이 실패하면 합류 호출 전부가 실패(30/30). 4차 감사 판단과 같다. 위험 수용 기록에 이 실측 수치를 넣는다.
- **F-2 [Low · 재확인 · 변동 없음]** `(ns as any)['invalidateKisToken']` 우회는 식별자 울타리를 통과한다(M5b exit 0). 비차단.
- **Info · 합류 위치** 합류 줄을 `getKisToken()` 맨 위로 옮긴 변이(M2)는 **684건 전부 통과**한다. 시험이 위치를 구분하지 못한다 [확실]. 동작 차이는 코드 읽기로만 도출했다 [가능성 높음 · 미실측]: 재발급이 진행 중일 때 다른 프로세스가 **유효한 행**을 써 두면, 현재 위치는 행을 즉시 돌려주고 맨 위 위치는 우리 재발급이 끝날 때까지(EGW00133 이면 60초) 기다린다. 현재 위치가 낫다. 위치를 고정하는 시험 1건을 권한다.
- **Info · 순서 울타리 분포** 가드 순서를 8곳에서 뒤집은 변이(M4)는 울타리 1건과 국내 잔고 행동 시험 1건이 잡는다. 나머지 사이트는 울타리 한 건에 기댄다. 울타리가 바뀌면 그 회귀를 잡을 시험이 없다.

#### 변이 검증 (scratch 사본 · 적용 여부를 diff 로 확인한 뒤 실행)

| 변이 | 결과 | 잡은 시험 |
|---|---|---|
| M1 합류 줄 삭제 | 잡힘 (16 중 1 실패) | 「재발급 진행 중 getKisToken → 발급 1회」 |
| M2 합류 줄을 `getKisToken` 맨 위로 | 생존 (684/684) | 없음 — 위 Info |
| M3 단일 비행 키 상수화 | 잡힘 (단위 시험 1건) | 「토큰이 다르면 공유하지 않는다」 — 정리본 재실행은 하지 않았다 |
| M4 가드 순서 뒤집기 (overseas 4 + domestic 2, 정리본) | 잡힘 (2 실패) | 울타리 「8곳 전부 가드 뒤」 + 국내 잔고 「토큰 오류 두 번 → 재발급 1회」(invalidate 2회 관측) |
| M5 어댑터에 `invalidateKisToken` import 추가 (정리본) | 잡힘 (1 실패) | 울타리 「두 파일에서만 부른다」 — 같은 파일 기준선 25/25 통과 대조 |
| M5b `ns['invalidateKisToken']` 우회 (F-2, 정리본) | 생존 (기대대로) | — |
| M6a `test.failing` → `test` | 실패: `Expected: 1` / `Received: 4` | 기대한 단언에서 실패 — 다른 오류로 통과하는 경우는 없었다 |
| M6b getKisToken 수준 단일 비행 구현 | `test.failing` 이 통과로 바뀌어 실패로 보고됨 | 공백이 닫히면 시험이 알려 준다 — 정직성 OK |
| M7 원장 가드를 헬퍼 뒤로(H-1 재도입) | 잡힘 (44 중 1 실패) | 「토큰 만료가 두 번이어도 재발급은 1회다」 |

M3 은 1차 실행(E2)에서 확인했다. 그 실행은 하네스 파일 오염으로 울타리 1건도 함께 실패했다. 울타리 실패는 원인이 아니고, 단위 시험 실패가 실제 검출이다. 정리본(E3)에는 M3 을 넣지 않았다.

#### 운영 로그 실측 (읽기만 · `/home/brownjeon/apps/stockinvest/shared/logs/pm2-out.log` · 웹 앱 `instances: 1`)

- 「issued new token」 성공 기록은 대체로 하루 1건이다(간격 약 23–24시간, 시각은 날마다 조금씩 이동).
- **같은 초에 2건 이상: 11일 중 8일.** 10-21 20:50:12 · 10-22 20:15:18 · 10-24 20:03:17 · 10-25 19:06:16 · 10-27 18:27:00 · 10-29 16:44:05 는 각 2건, 10-31 15:02:07 은 3건이다. 두 발급이 둘 다 KIS 에서 성공했다는 뜻이다.
- **10-30 16:00:03 — 같은 초에 5건**, 이어서 16:01:03 · 16:02:03 에 1건씩. 같은 초에 `[cron/post-market-analysis] start market=domestic` 로그가 있다. 60초 간격 두 건은 EGW00133 60초 대기 뒤 성공의 모양과 맞는다 [추측 — EGW00133 거절 자체는 로그에 따로 남지 않는다].
- 「token expired, re-issuing」·「token rotated elsewhere」 줄은 0건이다. 다만 HEAD 의 일부 사이트(해외 현재가·예수금·해외 보유 등)는 재발급 경고를 찍지 않으므로, 0건이 「토큰 무효화 없음」을 뜻하지는 않는다 [확실 — 코드 확인].
- 해석: ① 같은 초 2건 이상은 **T-136 이 닫지 않는 경로**다. `refreshInFlight` 가 없는 `getKisToken` 끼리의 동시 호출은 합류하지 않는다(test.failing 이 같은 현상을 고정한다). 만료 1시간 전 갱신 순간 여러 호출이 동시에 캐시 미스를 보면 이 모양이 된다 [확실 — 코드·시험]. ② 10-30 의 5건은 원인을 로그로 구별할 수 없다. 무효화 발이면 T-136 합류가 막고, DB 조회 실패 발(풀 포화 시 `catch` → 신규 발급)이면 막지 못한다 [추측].
- 결론: 「토큰 만료 0건」은 맞지만 「동시 발급은 드물다」는 틀렸다. 같은 초 2건은 11일 중 8일이다. 그러므로 **배포 후 확인 기준을 「같은 초 2건 없음」으로 두면 매일 실패한다**(아래 배포 후 확인 항목 참고).

#### L-4 위험 수용에 대한 QA 판단

- **동의한다 — 조건부.** 실측 66/100 에서 읽기 1건 실패는 재시도 없이 다음 호출에서 복구되고(돈 위험 없음), 대가로 F-1 의 중복 발급 정지와 M-2 의 살아 있는 토큰 삭제가 사라진다. 교환의 방향은 맞다. 차단 사유는 아니다.
- 조건 1 — task 문구 정정: 「60초 토큰 정지(주문 경로까지 막힘)를 없앤다」는 **중복 발급으로 인한 정지**에 한정한다. S_W 실측에서 다른 프로세스가 방금 발급한 직후에는 대기 1회가 남는다(347ms ≈ 1.16배). 그 정지는 후속 5 의 범위다.
- 조건 2 — 수용 근거의 수치를 실측으로 바꾼다: 현재 66/100 · HEAD 0/100.
- 조건 3 — L-4 를 후속 7 에서 시험으로 고정한다(test.failing 으로 원하는 동작을 적는다). 나중에 고쳐지면 알려 주도록.
- F-A 는 같은 근거로 수용할 수 없다. 돈 위험은 없지만 악화 범위가 「모든 토큰 호출, 최대 약 5분」이고 수정 비용은 한 줄이다. 수용하려면 Leader 가 위험 수용을 명시 기록해야 한다. QA 가 단독으로 수용하지 않는다.

#### 판정

- 결함 집계: Critical 0 · High 0 · **Medium 1 (F-A)** · Low 2 (F-B, F-2 재확인) · Info 3 (합류 위치, 순서 울타리 분포, 운영 로그 해석).
- 1차 F-1 은 닫혔다(100/100, HEAD 와 같음). 주문 경로 무영향: `git diff --stat -- src/lib/safety src/app/api/orders` 0줄, `createOrder`·`cancelOrder` 본문에는 헬퍼·재발급 호출이 없고 `kisHeaders()`(토큰 획득)만 있다 [확실].
- 새 Medium 이 실측으로 확인됐고 4차 감사의 「fail-closed」 판단이 틀렸다. 1차 판정과 같은 기준으로 **통과하지 않는다.**
- 통과 경로(택일): (a) Developer 가 발급 호출에 상한을 넣고 Reviewer 부터 재순환 → QA 재실행 · (b) Leader 가 F-A 를 위험 수용으로 명시 기록 → 그 근거로 QA 재판정.

#### 확인하지 못한 것 (NOT_VERIFIED)

- 실 KIS 의 「앱키당 1분 1회」와 「새 발급이 이전 토큰을 무효화」 — 가짜 KIS 로만 확인. 근거는 저장소 주석이다.
- 실 KIS 의 응답 지연과 매달림의 실제 빈도. 가짜 발급 지연은 25ms 로 가정했다.
- 다른 프로세스의 동시 발급 — 크론 앱(`stockinvest-cron`)과 같은 앱키를 쓰는 다른 사용처(TradingInvest 등)의 발급은 측정하지 않았다.
- undici 본문(body) 타임아웃 — 헤더 타임아웃 300,754ms 만 실측했다.
- `timeoutMs` 를 넣었을 때의 효과와 부작용 — 권고만 하고 미실측.
- 10-30 5건의 원인 — 로그로 구별 불가.
- 실 Next 번들에서 모듈 인스턴스가 라우트마다 갈라지는지 — 갈라지면 `refreshInFlight` 합류는 같은 인스턴스 안에서만 작동한다.
- 합류 위치 J2 의 실제 동작 차이 — 코드 읽기로만 도출했다.
- 화면 검증 — 화면 파일 변경 없음, 해당 없음.
- 토큰 앞 8자 로그(`kis-auth.ts:85`) — 운영 로그의 값은 전부 `eyJ0eXAi`(JWT 헤더의 base64 접두로 토큰마다 같다)라 토큰 엔트로피 노출은 없다 [확실 — 관찰값]. 본 diff 밖(HEAD 부터 있던 것)이라 정리 후보로만 남긴다.

#### 배포 후 확인 항목 (FAIL 이므로 지금은 인계하지 않는다 — F-A 해소 후 재판정 때 사용)

- 대상 앱: `stockinvest`(웹 — 크론 잡 로그도 이 파일에 찍힌다) · `stockinvest-cron`(같은 앱키로 발급할 수 있다). 로그: `/home/brownjeon/apps/stockinvest/shared/logs/pm2-out.log`·`cron-out.log`(ecosystem.config.js 의 `LOG_DIR`). 3669090 에서 로그 회전이 설정됐으니 파일명이 그대로인지 먼저 본다.
- 명령(읽기 전용): `L=/home/brownjeon/apps/stockinvest/shared/logs; grep -a "issued new token" $L/pm2-out.log | cut -c1-19 | uniq -c | tail -20` · `grep -a "rotated elsewhere\|re-issuing" $L/pm2-out.log | tail` · `pm2 jlist` 에서 `stockinvest-cron` 이 정확히 1개인지.
- 시점: 배포 직후 30분·1시간, 그리고 다음 일일 갱신 시각 전후.
- 판정 기준: 「같은 초 2건」은 **실패 기준이 아니다** — 일일 갱신 때의 동시 발급은 이 변경이 막지 않는다(11일 중 8일 실측). 실패 기준은 ① 1분 안에 발급 3건 이상 ② 60초 간격 발급이 연속 2회 이상(EGW00133 대기 연쇄 의심) ③ 주문 쪽에서 토큰 대기가 60초 단위로 찍힘.
- 화면·엔드포인트: 잔고 `GET /api/balances`, 포트폴리오 `GET /api/portfolio`(해외 예수금·보유 경로 포함) — 배포 후 한 번씩 열어 오류가 없는지 본다. 화면 경로는 deployer 가 `docs/screens.md` 로 확인한다.

#### 산출물·프로세스 정리

- 로컬 스크린샷 0개(화면 검증 없음). 서버 scratch `~/.node-local/qa-t136-r2` 는 저장소 밖이라 하네스·로그를 보존했다.
- 잘못된 경로(`lib/…`)로 만든 변이 배치 1회를 발견했다. PID 1845973 등을 cmdline·cwd 확인 후 SIGTERM 으로 정리했다(pkill 미사용, 저장소 무영향). 결과는 정리본(E2·E3)으로 다시 돌렸다.

- [22:20] **QA 판정: FAIL** — Medium 1건(F-A: 발급 요청이 매달리면 합류한 토큰 호출이 최대 약 5분 정지). F-1 은 닫혔다(100/100). typecheck exit 0 · 전체 jest 362/10389 · 토큰 스위트 2회 920/920 통과. 결함 0건이 아니므로 통과 선언하지 않는다.

### 3회차 QA (구현 라운드 5b · 5차 감사 뒤) — 독립 실행

- [22:52] 범위·방법 — 서버 `home_ubuntu` 저장소에서 실행. HEAD 는 `287b637`(다른 세션의 docs 전용 커밋 1개, `src` 변경 0)이고 14파일은 2회차 그대로다. 저장소에는 쓰지 않았고 커밋·push 없음. 하네스·변이 사본은 `~/.node-local/qa-t136-r3/work` 에서만 돌렸다(src 사본은 저장소와 `cmp` 동일 확인). 이 세션이 쓴 것은 이 task 파일과 20-Log 한 줄뿐이다.
- [22:52] 재현 조건 — 2회차 하네스는 재사용하지 않았다(가짜 `fetch` 는 abort 를 흉내 내지 않아 F-A 를 증명할 수 없다). 새 하네스 `t136-r3.test.ts` 는 **tokenP 요청만 127.0.0.1 의 로컬 서버로 보내** undici 의 실제 abort·본문 읽기 경로를 탄다. 가짜는 자격증명·`system_config` 1행 DB·스로틀(무력화)뿐이다. 시간 축소는 EGW00133 대기 60초→1초 한 곳(`kis-auth-scaled` 사본)이고 나머지는 실제 시간이다. 하네스 사본은 `~/.node-local/qa-t136-r3/harness/` 에 남긴다.
- [22:52] 직접 실행 결과
  - `npm run typecheck` **exit 0**.
  - 전체 `jest`(필터 없음) 1회: Test Suites 362 passed · 6 skipped(총 368), Tests 10390 passed · 230 skipped · 실패 0 · exit 0. 구현자 수치와 같다.
  - 토큰 관련 스위트 41개(`kisFetch|getKisToken|kis-auth|kis-token` 을 쓰는 시험 35개와 `src/lib/exchanges` 전체) 2회: 두 번 다 41/41 · 1074/1074 통과.
- [22:52] **F-A 재현 (실제 네트워크 · 하네스 8건)**

  | 시험 | 조건 | 관찰 | 판단 |
  |---|---|---|---|
  | T1 | 발급 응답 없음 + 합류 호출 | 발급 요청 1회 · 두 호출 모두 AbortError 10.0초 / 9.9초 | **F-A 헤더 단계 닫힘** |
  | T2a | 응답 14초 (현재 코드) | 두 호출 모두 10.0초에 끊김 | 상한이 실제로 걸린다 |
  | T2b | 응답 14초 (`timeoutMs` 제거 변이) | 두 호출 모두 14.0초까지 대기 | 상한이 없으면 F-A 재현 |
  | T3 | 헤더 즉시 · **본문 13초 정지** | 두 호출 모두 13.0초 대기 후 성공 | **L-5 재현** (상한 없음) |
  | T4 | EGW00133 3회 즉시 응답 (축소 1초×3) | 발급 3회 · 3.0초 | 환산 60초×3 = 180초 |
  | T5 | EGW00133 응답이 9.9초 뒤 | 발급 3회 · 32.7초 | 환산 3×(9.9+60) = **209.7초** |
  | T6 | EGW00133 응답이 10.5초 뒤 | 발급 1회 · 10.0초 AbortError, 재시도 없음 | 감사자 주장 맞음 |
  | T7 | 정상 응답 3초 | 토큰 수신 3.0초 | 양성 대조 |

- [22:52] 시험 변이 — 단일 비행 시험 파일을 import 만 바꿔 돌렸다.
  - `TOKEN_ISSUE_TIMEOUT_MS = 1` → 실패 `Expected >= 3000 · Received 1` (하한이 잡는다).
  - `= 300_000` → 실패 `Expected <= 30000 · Received 300000` (상한이 잡는다).
  - `timeoutMs` 제거 → 실패 `Expected "number" · Received "undefined"`.
  - 실제 코드는 4/4 통과.
- [22:52] **F-3 [Low · 문서 결함 · 이번 FAIL 사유] 「최악 약 180초」가 틀렸고, 같은 파일에 정정되지 않은 옛 문장이 남아 있다.**
  - 위치: `src/lib/exchanges/kis-auth.ts:47` 「재시도 3회 × (10초 + `EGW00133` 대기)가 상한이다」 — 5b 권고 3 에서 고쳤다고 적은 문장인데 **고쳐지지 않았다**(`sed -n 47p` 로 확인). `kis-auth.ts:116-118` 「최악은 약 180초」는 정정된 쪽이지만 그 수치도 틀렸다.
  - 실측(T4·T5): EGW00133 응답이 10초 직전에 오면 3회의 합은 3×(9.9+60) = **약 210초**다. 180초는 응답이 즉시 올 때만 맞다. 계산에 없는 항목은 스로틀 대기(회당 최대 30초, `DEFAULT_MAX_QUEUE_WAIT_MS`)와 본문 읽기다. 스로틀 `critical` 레인은 분리돼 있어 평소 짧다(코드 읽기, 미측정).
  - 동작 영향은 없다. 그러나 이 수치는 사용자 보고와 task 5b 에 그대로 들어간다.
  - 정정 문장(설계가 아니라 문장만): 「EGW00133 대기 3회는 180초이고, 응답이 10초 직전에 오면 최대 약 210초다. 스로틀 대기와 본문 읽기는 이 계산에 없다.」 — `kis-auth.ts` 두 곳 + 이 task 5b 한 곳.
- [22:52] **L-5 판단 (감사자 H2, 본문 단계 정지) — 차단 사유로 보지 않는다 [가능성 높음].**
  - 재현 T3: 합류 호출도 본문 정지만큼 기다린다. 감사자의 관찰이 맞다.
  - 운영 근거(api-usage `ms` 는 `res.text()` 뒤에 기록되므로 본문 읽기 시간을 포함한다): KIS 호출 163,597건 중 **성공 호출의 최대 지연 4,023ms**. 본문 단계가 4초를 넘게 멈춘 기록은 0건이다.
  - F-A 와 다르게 볼 근거: ① 고치려면 `kisFetch` 의 타이머 구조(`finally` 에서 끄는 자리)를 바꿔야 한다. 이 함수는 KIS 호출 16곳이 공유하므로 `kis-auth.ts` 한 줄과 범위가 다르다. ② HEAD 에도 `invalidateKisToken` 의 합류가 있었고, 본문 정지는 그 합류자를 HEAD 에서도 막을 수 있었다. T-136 은 합류자를 `getKisToken` 쪽으로 넓혔을 뿐이다. ③ 상한 기준으로 쓸 undici `bodyTimeout` 기본값은 미실측이다(문서 기준으로 300초로 알려져 있다 [추측]).
  - 조건: (a) 「F-A 해소」 문구를 「**헤더 단계** 상한 — 본문 단계는 상한 없음(T3 13초 실측)」으로 한정한다. (b) Leader 가 위험 수용을 명시 기록한다. (c) 후속 후보 5 에 본문 정지 시험을 넣는다.
- [22:52] **timeoutMs 10초 독립 확인 (운영 7일, 읽기 전용, `/home/brownjeon/apps/stockinvest/shared/logs/api-usage-*.jsonl`)**
  - KIS 전 호출 163,597건: p50 16ms · p99 626ms · p99.9 1,192ms · 성공 최대 4,023ms.
  - `token-p` 129건: 최대 204ms · 1초 초과 0 · 5초 초과 0. 이 중 111건은 10-30 사건의 403 이고 11–19ms 에 즉시 거절됐다. 성공 18건은 전부 빠르다.
  - 10초를 넘긴 호출은 `timeout` 3건뿐(10,247–10,248ms, 같은 1초 안, 10-31 09:04 KST). 연결 단계 정지 1회가 동시 3건을 쳤다. 그 3건이 발급이었다면 10초 상한이 같은 시점에 끊었을 것이다 [추측 — 연결 단계인지 헤더 단계인지 로그로 구별 불가].
  - 판단: 관측 7일 동안 정상 응답이 10초에 끊길 기록은 없다(성공 최대 4.0초). 이것은 우리 측 기록이며 KIS 측 지표가 아니다. 외삽은 [추측].
- [22:52] **회귀·울타리 (직접 확인)**
  - `git diff -- src/lib/safety src/app/api/orders` **0줄**, 미추적 0.
  - `shouldRetryAfterTokenError(` 호출 8곳: domestic 85·275·659, ledger 294, overseas 469·609·650·1021. `createOrder`(domestic 345–400 · overseas 731–798)와 `cancelOrder`(domestic 401–420 · overseas 805–824) 구간에는 0곳이다.
  - `transientRetries` 5곳(domestic 77·272, overseas 101·466·647)은 모두 GET 옵션이다. 가드(`kis-http.ts`)를 거친 시험은 full jest 에서 통과했다.
  - `invalidateKisToken` 식별자(시험 제외): `kis-auth.ts`·`kis-token-retry.ts` 만. `kis-ledger-query.ts` 의 2건(285·288행)은 주석 문구다. 울타리 시험 통과.
  - 로그 민감값: 새 문구(`[label] token rotated elsewhere`·`token expired, re-issuing`)는 고정 문구와 label 만 싣는다. 토큰 8자 접두(`kis-auth.ts:129`)와 `body.slice(0, 200)`(`kis-auth.ts:145`)는 HEAD 부터 있던 것이고 이 diff 밖이다.
- [22:52] **커밋 훅 사전 점검 (커밋하지 않음)**
  - `scripts/git-hooks/commit-msg` 의 `SAFETY_PATHS` 에 `'^src/lib/exchanges/'` 가 있다(582행). 14파일 전부가 안전 경로다.
  - 14파일(수정 8·미추적 6)과 판정 scope(176행) 14항목이 **정확히 일치**한다.
  - 제목에 reviewer 를 담은 헤딩은 106행 하나다. 그 섹션 안 마지막 판정 줄은 176행(23:24)이다.
  - 주의 1: 5b 는 감사 판정과 같은 시각대(23:20–23:24)에 적혔고 「5b 재확인 요청」이 있으나 감사자 재확인 기록은 없다. F-3 정정 뒤에는 재확인 기록이 필요하다.
  - 주의 2: Mac 에서는 훅이 돌지 않는다(`core.hooksPath` 가 서버 경로). 커밋은 서버에서 한다.
- [22:52] **날짜 정정 점검** — 2026 달력으로 `MM-DD(요일)` 151건을 대조했다. T-132·T-133·T-136·board·ACTIVE·20-Log 에서 요일 불일치는 **0건**이다. 「11-03(월)」은 T-136 459·461행의 정정 설명에만 남아 있다. 그 밖의 불일치 11건은 T-045·T-062·T-115·ADP-006 에 있고 이 task 밖이다(2025 날짜 혼용으로 보인다 [추측]).
- [22:52] **10-30 사건은 T-136 이 닫지 않는다 (운영 로그 실측, 원인 경로는 코드 확인)**
  - 10-30 16:00:03–16:02:10 KST: `token-p` 118건 중 403(EGW00133) 111건, 분당 38·37·36건. 각 11–19ms 에 즉시 거절됐다. 같은 초에 `issued new token` 5건이 찍혔다.
  - 경로: 일일 갱신 때 DB 행이 있어도 만료 1시간 전부터 `getKisToken` 이 직접 `issueAndStore` 로 간다(`kis-auth.ts:72·92`). 이 경로는 `refreshInFlight` 를 세우지 않으므로 **합류가 없다**. T-136 의 합류는 `invalidateKisToken` 이 세운 것에만 붙는다 [확실 — 코드].
  - 발급 시각(KST): 10-29 16:44:05 → 10-30 16:00:03 → 10-31 15:02:07. 간격은 약 23시간이다. 「매일 앞당겨진다」는 추세가 아니라 **만료 1시간 전에 재발급하는 주기**(24h−1h)에서 나온다 [가능성 높음].
  - 따라서 다음 갱신은 일요일 14시대(일요일 호출이 있을 때), 그다음은 **월요일 13시 전후**로 계산된다. 월요일 13시는 KRX 장중이다 [추측 — 첫 호출이 임계를 넘는 시각에 따라 수십 분 달라진다]. T-136 배포는 이 위험을 줄이지 않는다.
  - 줄이려면 직접 발급 경로도 `refreshInFlight` 로 감싸야 한다. 이것이 후속 후보 5 의 핵심이고, 처리 시점은 사용자 결정 사항이다. 이 QA 는 판단하지 않는다.
- [22:52] **배포 후 확인 — 최종본 (전부 읽기 전용, 서버 `home_ubuntu`)**

  ```
  L=/home/brownjeon/apps/stockinvest/shared/logs
  # 1) 발급 분포 — 같은 분 건수 (3 이상이면 실패 신호)
  grep -a "issued new token" $L/pm2-out.log $L/cron-out.log | cut -c1-16 | uniq -c | tail -20
  # 2) EGW00133 거절 — 배포 직전 값과 비교
  grep -a -c "EGW00133" $L/pm2-out.log $L/cron-out.log
  # 3) 신규 문구 — 재발급·회전 (T-136 헬퍼가 찍는다)
  grep -a "token expired, re-issuing\|token rotated elsewhere" $L/pm2-out.log $L/cron-out.log | tail -20
  # 4) 앱 개수 — stockinvest-cron 이 정확히 1개 (현재 1개 online 확인)
  pm2 jlist | python3 -c 'import json,sys; print([a["name"] for a in json.load(sys.stdin) if a["name"].startswith("stockinvest")])'
  # 5) token-p 403 분당 분포 — api-usage 의 ts 는 UTC
  grep '"op":"token-p"' $L/api-usage-<날짜>.jsonl | grep '"ok":false' | cut -c12-16 | uniq -c
  ```

  - 시점: 배포 직후 30분과 1시간, 그리고 **11-02(월) 13시대 KRX 장중**(예상 갱신 시각).
  - 실패 신호: ① 같은 분에 발급 3건 이상 ② 60초 간격의 EGW00133 연쇄 ③ 주문 API 응답이 60초 단위로 늘어남. ③ 은 토큰 대기가 api-usage 기록 전에 일어나 직접 측정이 안 된다. 주문 기록 시각 간격으로 간접 확인한다.
  - 주의: ① 은 10-30 사건 때도 찍힌다. 11-02 창에서 나오면 T-136 과 무관한 기존 사건일 수 있으니 직전 주기 값과 비교해 판단한다.
  - 화면·엔드포인트: `GET /api/balances`·`GET /api/portfolio` 경로는 `src/app/api/` 에 있다. 배포 후 국내·해외 잔고 화면을 한 번씩 열어 오류가 없는지 본다. 화면 경로는 deployer 가 `docs/screens.md` 로 확인한다.
- [22:52] 확인하지 못한 것 (NOT_VERIFIED)
  - 실 KIS 의 「1분 1회」와 「발급 시 이전 토큰 무효화」 — 가짜 KIS 로만 확인했다. 근거는 저장소 주석이다.
  - 실 KIS 의 지연 분포 — 관측은 우리 측 api-usage 기록뿐이다.
  - undici `bodyTimeout` 기본값(본문 정지의 실제 상한) — 미실측.
  - 스로틀 대기(회당 최대 30초)가 최악 계산에 들어갈 때의 실제 값 — 미측정, 코드 읽기만.
  - 10-30 사건의 원인 확정 — 로그로는 무효화 발과 행 부재 발을 구별할 수 없다. 직접 경로 발급이라는 점은 코드로 확인했다.
  - 웹·크론 두 프로세스의 동시 발급 — 관측 없음(후속 5).
  - F-2(식별자 울타리 우회 3종) — 이번 라운드에는 재실행하지 않았다. 2회차 결과 그대로 두고 비차단으로 유지한다.
  - 화면 검증 — 화면 파일 변경 없음, 해당 없음.
- [22:52] 산출물 정리 — 저장소 밖 scratch 의 `work`(src 사본)는 삭제하고, 하네스·변이 파일과 로그는 `~/.node-local/qa-t136-r3/` 에 남긴다. 저장소 안에 생긴 파일은 없다(git status 는 2회차와 같다).
- [22:52] 결함 집계 — Critical 0 · High 0 · Medium 0(F-A 헤더 단계 닫힘) · **Low 1(F-3, 문서)** · 위험 수용 대상 1(L-5, 차단 아님 — Leader 가 명시 기록) · 운영 위험 1(10-30 류 직접 경로 발급, T-136 범위 밖 — 사용자 결정).
- [22:52] **QA 판정: FAIL** — 결함은 주석·문장 수준이라 코드 동작은 바뀌지 않는다. F-3 정정과 L-5 위험 수용 기록, 그리고 5b 재확인 기록이 갖춰지면 다음 판정 대상이다. 정본 절차는 Reviewer 재확인 뒤 QA 재실행이다. 재실행 범위를 typecheck·단일 비행 시험·문구 grep 으로 줄일지는 Leader 판단이다.

## 구현 라운드 4 — QA FAIL(F-1) 반영 · 범위를 `kis-auth.ts` 로 넓힘 (메인 세션)

QA 판정은 **FAIL**(Medium 1 · Critical 0). F-1 은 **내가 만든 회귀**이고, 감사 3차의 「남은 것은 HEAD 에도 있던 둘뿐」이라는 문장도 이 경우에는 틀렸다(QA 정정).

- [21:50] **F-1 (Medium) — 혼합 토큰에서 HEAD 대비 회귀.** DB 토큰 T0 이 죽어 4건이 동시에 판단을 공유하는 중에, **다른 죽은 토큰** Tstale 로 실패한 호출이 10ms 뒤 도착하면 키가 달라 **두 번째 판단**이 생기고, 그 판단의 `getKisToken()` 이 "행 없음"(첫 판단의 `invalidateKisToken()` 이 방금 지웠다)을 보고 **직접 발급**한다 → 발급 2회·`EGW00133` 60초 대기 1회. HEAD 는 같은 조건에서 발급 1회·대기 0. QA 가 **15/15 재현**.
- [21:54] **뿌리를 고쳤다 — `kis-auth.ts` 의 `getKisToken()` 이 진행 중인 재발급에 합류한다.** QA 가 준 선택지 셋 중 (b) 를 택했다.
  - (a) 판단 키를 "진행 여부" 로 바꾸기: 이 경우는 사라지지만 **회전된 토큰으로 실패한 호출이 남의 판단 결과를 받아** 재발급을 건너뛸 수 있다(그 호출은 그대로 실패한다). 증상 하나를 다른 증상으로 바꾸는 것이라 택하지 않았다.
  - (c) 위험 수용: **택하지 않는다.** 2차 감사에서 같은 이유(범위 밖)로 미뤘다가 틀린 것으로 확인됐다. 7곳을 고치면서 한 경우를 HEAD 보다 나쁘게 두는 것은 교환이 아니라 후퇴다.
  - (b) 뿌리: `invalidateKisToken()` 은 예전부터 `refreshInFlight` 에 합류했는데 **`getKisToken()` 의 발급 경로만 빠져 있었다**(`kis-auth.ts:44-60`). 행이 없는 흔한 이유가 *방금 누가 지웠기 때문*이라, 토큰이 죽은 순간 두 경로는 거의 항상 겹친다. 한 줄(`if (refreshInFlight) return refreshInFlight;`)로 합류시켰다.
  - **범위가 `kis-auth.ts` 로 넓어졌다** — 토큰 발급은 **주문 경로를 포함한 모든 KIS 호출이 지나는 곳**이라 이 파일 변경은 이번 작업에서 가장 위험도가 높다. 감사·QA 에 그렇게 명시해 재확인을 요청한다. (`^src/lib/exchanges/` 라 커밋 훅 감시에는 이미 들어 있었다.)
  - 시험 신규 `__tests__/kis-auth-issue-single-flight.test.ts` 2건 — ① 재발급 진행 중 `getKisToken()` 이 들어오면 **발급 1회**(F-1 가드, 변이로 확인: 합류 줄을 지우면 실패) ② **알려진 공백을 사실대로 고정** — `getKisToken()` 끼리의 동시 호출은 아직 중복 발급한다(첫 호출이 `refreshInFlight` 를 세우지 않는다). 후속 5 를 하면 이 단언이 실패하고, 그때 `toBe(1)` 로 바꾸면 된다.
- [21:56] **시험하지 않은 것을 적어 둔다** — 합류한 발급이 **실패**할 때의 전파. 처음 시험으로 넣었다가 `issueAndStore` 의 `EGW00133` 60초 대기를 실제로 기다려 30초 타임아웃으로 깨졌다. 가짜 타이머가 필요해 미검증으로 남기고, 시험 파일에 그 이유를 적었다.
- [21:57] **QA 가 비차단으로 남긴 것** — F-2(식별자 울타리 미탐 3종: 문자열 요소 접근·SQL 직접 DELETE·`tokenP` 직접 호출. 현재 소스에 사례 0) · `kis-auth.ts:85`·`kis-overseas.ts:643` 의 토큰 **앞 8~12자** 로그(HEAD 부터 있던 것, 이번 diff 밖) · 원장 `auth_error` 종단 시험 없음(후속 6).

### 라운드 4 재확인 요청 범위

`kis-auth.ts` 한 줄(가장 위험도 높음 — 주문 경로가 지난다) · 신규 시험 2건 · scope 에 `kis-auth.ts`·새 시험 파일 추가.

## 구현 라운드 4b — 4차 감사 PASS 뒤 비차단 권고 반영 (메인 세션)

4차 판정은 **PASS**. 감사자가 **자기 3차 PASS 의 한계도 정정했다** — 그때 하네스가 죽은 토큰을 **하나만** 썼기 때문에 F-1 을 못 봤고, 단위 시험 「토큰이 다르면 공유하지 않는다」를 받아들이면서 **두 번째 판단이 "행 없음" 을 만나면 무엇을 하는지는 묻지 않았다**고 적었다.

F-1 닫힘 확인(감사자, 100회씩): HEAD `kis-auth` + 현재 헬퍼는 **100/100 발급 3회·60초 대기**(QA 재현이 맞다), 현재 코드는 **100/100 발급 1회·대기 0·던짐 0·재시도 성공 500/500**.

- [22:20] **권고 1 반영 — 합류 실패 전파 시험을 넣었다.** 감사자가 「시험이 가능하다」고 바로잡았다: `EGW00133` 대신 **HTTP 500** 을 쓰면 `issueAndStore` 가 60초 대기 없이 즉시 던진다. 가장 위험한 파일이라 권고대로 추가했다 — 합류한 두 호출이 **함께 거절**되고, `refreshInFlight` 가 비워진 뒤 **다음 호출이 복구**하는 것까지 고정한다.
- [22:22] **권고 2 반영 — 둘째 시험을 `test.failing` 으로 바꿨다.** 현재 동작(`toBeGreaterThan(1)`)에 맞춰 두면 **나쁜 동작을 "정상" 으로 못 박는** 셈이라는 지적이 맞다. 원하는 동작(`toBe(1)`)을 적고 지금은 실패를 기대한다 — 후속 5 를 하면 "예상과 달리 통과했다" 로 깨져서 **고쳐진 순간을 자동으로 알려 준다.**
- [22:24] **질문 1 에 대한 감사자 판단을 기록한다** — 내가 확신이 약하다고 적은 두 지점의 답이다.
  - ① 합류한 발급이 실패할 때: **받아들일 만하다.** 거절은 fail-closed 이고 `refreshInFlight` 가 비워지면 다음 호출이 복구한다. HEAD 가 이기는 경우는 **첫 발급만 빠르게 실패하는 좁은 틈**뿐이다.
  - ② 긴 `EGW00133` 대기에 함께 묶이는지: **순이익이다.** HEAD 는 A 가 +60초에 T1, B 가 +120초에 T2 를 받아 발급 5회·`EGW00133` 3회이고 **B 의 발급이 A 의 T1 을 죽인다.** 현재는 둘 다 +60초에 같은 T1 을 받고 살아 있다(발급 2회·`EGW00133` 1회). 독립 발급으로 빠져나갈 호출은 **없었다.**
  - 교착·기아 없음: 대기열에 bulk 60건을 쌓은 채 `invalidateKisToken()` 1건 + `getKisToken()` 25건 → 발급 1회, 26건이 같은 토큰을 +226ms 에 받고 밀린 bulk 는 +11초에 끝났다.

### 🔴 L-4 (Low) — 위험 수용 명시 (감사자 요청)

서로 다른 죽은 토큰 **두 세대**가 겹치고 **낡은 쪽이 먼저 도착**하면, 그 호출의 재시도가 죽은 DB 토큰으로 나가 **읽기 호출 1건이 실패**한다. 측정(2회차 QA 실측을 정본으로 쓴다): **66/100** 에서 읽기 1건 실패, **HEAD 는 0/100**. (감사자 4차의 75·83 은 하네스가 달라 수치가 다르다.)

- 원인은 이번 `kis-auth` 변경이 아니라 **헬퍼 설계의 전제**다 — 「DB 값이 다르면 그 토큰은 살아 있다고 믿는다」. **라운드 1 부터 있었다.**
- 고치려면 KIS 에 토큰 생존을 물어야 하고(그런 API 를 쓰지 않는다), 그것은 이 task 설계 밖이다.
- **수용한다**: 읽기 호출 1건의 fail-closed 실패이고(돈이 위험해지지 않는다, **다음 호출에서 복구된다**) F-1 의 토큰 정지보다 가볍다. 내가 세운 「한 경우도 HEAD 보다 나쁘게 두지 않는다」 원칙에는 **어긋난다** — 숨기지 않고 여기 적는다.
- **교환의 정확한 문구**(2회차 QA 조건 1 — 내가 처음 쓴 「60초 정지를 없앤다」는 과장이었다): 읽기 1건의 실패를 받고, **중복 발급으로 생기던** 토큰 정지와 M-2(살아 있는 토큰 삭제)를 없앤다. **다른 프로세스가 방금 발급한 직후의 대기 1회는 남는다**(QA 실측 347ms). 주문 경로 대기는 HEAD 2.27배 → 현재 1.16배(QA 실측).
- **`test.failing` 으로 고정하지 않았다**(2회차 QA 조건 3 에 대한 답). 원하는 동작이 「낡은 세대로 실패한 호출도 복구한다」인데, 그걸 판단하려면 **DB 토큰이 살아 있는지를 알아야** 하고 우리에게 그 수단이 없다. 지금 쓸 수 있는 단언은 「`usedAuth` 가 DB 와 다르면 재발급한다」뿐이고 그것은 **M-2 그 자체**다 — 원하지 않는 동작을 "목표" 로 적는 시험이 된다. 후속 7 은 수단이 생길 때 착수하고 그때 시험을 쓴다.
- 후속 후보 7 로 올린다.

### 감사자가 남긴 추측 — 11-03 관측에서 확인할 것

T-133 감사 기록이 인용한 **2026-10-30 16:00:03·16:01:03·16:02:03 의 60초 간격 재발급**이 후속 5(발급 자체의 단일화) 공백의 흔적일 수 있다[추측]. 사실이면 **후속 5 의 우선순위가 「토큰 만료 0건」이 말해 주는 것보다 높다.** 11-03 관측에서 `[kis-auth] issued new token` 의 **간격**을 함께 본다.

## 구현 라운드 5 — 2차 QA FAIL(F-A) 반영 (메인 세션)

2차 QA 판정은 **FAIL**(Medium 1 · Critical 0). F-A 는 **내가 라운드 4 에서 넣은 합류 한 줄이 만든 것**이고, 4차 감사의 「fail-closed」 판단도 QA 가 정정했다 — **즉시 실패가 아니라 "멈춘 뒤 실패"** 다.

- [22:50] **F-A (Medium) — 발급 호출에 상한이 없어 합류가 "무계 정지" 가 됐다.** `kisFetch` 기본값이 무제한이라, 응답 없는 서버에 걸리면 undici 헤더 타임아웃까지 **약 5분**을 매달린다(QA 실측 **300,754ms** → `UND_ERR_HEADERS_TIMEOUT`). 첫 발급을 1000ms 매달리게 하면 합류 호출이 HEAD 28~30ms → 현재 **1021~1027ms**. 그 동안 `getKisToken()` 을 쓰는 **모든** 경로가 멈추는데 **`createOrder` 도 그 경로다.**
  - **내 합류가 영향 범위를 넓혔다**(종전에는 독립 발급으로 빠져나갔다). 그래서 상한이 **필수**가 됐다.
  - 수정: `issueAndStore` 의 `kisFetch` 에 `timeoutMs: TOKEN_ISSUE_TIMEOUT_MS`(**10초**). 값 근거를 상수 주석에 적었다 — 너무 짧으면 느린 응답을 끊어 `EGW00133` 1분 대기를 부르고, 목적은 **유계로 만드는 것**이다. 시세가 쓰는 5초보다 넉넉하되 무계 5분과는 두 자릿수 차이.
  - **트레이드오프를 명시한다**[추측]: 끊긴 요청이 KIS 쪽에서는 이미 발급됐을 수 있고, 그러면 다음 시도가 `EGW00133` 에 걸린다. 그건 `issueAndStore` 가 이미 다루는 경우이고 최악이 유계다(3회 × (10초 + 대기)). **"무계 5분 정지" 보다 낫다고 판단했다.** 실 KIS 의 발급 지연 분포와 `timeoutMs` 의 실제 부작용은 **미검증**이다.
  - 시험: 발급 호출의 옵션에 `priority: 'critical'`·`label: 'tokenP'`·**유계 `timeoutMs`**(0 < t ≤ 30초)가 실린다. 구현 값을 그대로 박지 않고 **유계임**을 단언한다 — 값 조정은 자유롭게, 무계로 되돌리는 것만 막는다.
  - 도중에 내 시험 하나가 틀렸다 — `restoreAllMocks()` 는 **공장 모의의 구현을 되돌리지 않아서**, 실패 시험이 덮어쓴 `kisFetch` 가 다음 시험까지 남았다. `beforeEach` 에서 기본 동작을 되돌리게 고쳤다.
- [22:56] **운영 로그 실측(2회차 QA, 읽기 전용)을 받아 적는다** — `pm2-out.log` 에서 **같은 초에 발급 2건 이상이 11일 중 8일** 있었고 **10-30 16:00:03 에는 5건**이었다. 같은 초 2건은 두 발급이 모두 KIS 에서 성공했다는 뜻이고, **T-136 은 무효화 발 합류만 막는다** — 캐시 미스·갱신 발 동시 발급은 그대로 남는다(후속 5). 10-30 5건의 원인은 로그로 구별할 수 없다[추측].
  - 그래서 **배포 후 기준을 바꿨다**: 「같은 초 2건 없음」으로 두면 **매일 실패한다.** 실패 기준은 ① 1분 안 발급 **3건 이상** ② 60초 간격 연쇄 ③ 주문 측 토큰 대기 지연.
- [22:58] **F-B (Low, 설계상 수용)** — 합류한 발급이 실패하면 합류 호출 전부 실패(QA 30/30, HEAD 30/30 성공). 다음 호출이 복구한다. 라운드 4b 시험이 이 동작을 고정한다.
- [22:58] **Info(미해결)** — 합류 줄을 `getKisToken` 맨 위로 옮기는 변이가 **생존한다**(684건 통과). 시험이 위치를 구분하지 못한다. QA 판단은 「코드 읽기상 현재 위치가 낫다 — 외부 프로세스가 유효한 행을 써 둔 경우 맨 위 위치는 불필요하게 재발급을 기다린다」[가능성 높음·미실측]. 위치를 고정하는 시험은 넣지 않았다 — 그 차이를 드러내려면 "유효한 행 + 진행 중인 재발급" 상태를 만들어야 하고, 그건 후속 5 범위의 하네스다.
- [23:00] 재검증 — 서버 `npm run typecheck` **exit 0** · `npx jest src/lib/exchanges/__tests__/kis-auth-issue-single-flight.test.ts` **4건 통과**.

### 라운드 5 재확인 요청 범위

`kis-auth.ts` 의 `TOKEN_ISSUE_TIMEOUT_MS` + 발급 호출 `timeoutMs` · 시험 1건 추가 · `beforeEach` 모의 복원 · L-4 문구·수치 정정.

## 구현 라운드 5b — 5차 감사 PASS 뒤 권고 반영 + 🔴 날짜·일정 정정 (메인 세션)

5차 판정은 **PASS**. 감사자가 **자기 4차 판단도 정정했다** — 「합류 실패는 fail-closed」는 "즉시 실패" 를 전제했는데 실제는 "멈춘 뒤 실패" 였고, `timeoutMs` 부재를 Info 로만 둔 것이 **틀린 등급**이었다고 적었다.

- [23:20] **권고 1 — 단언에 하한을 더했다.** 상한만 두면 `1` 같은 값이 통과하는데 그러면 **모든 발급이 즉시 끊겨 전면 중단**이다(시험이 모른다). 운영 실측 근거로 `3_000 ≤ t ≤ 30_000` 으로 묶었다 — `token-p` 129건 최대 지연 204ms·1초 초과 0건, KIS 전체 163,474건 p99.9 = 1.2초, 성공한 가장 느린 호출 4.0초.
- [23:22] **권고 2·L-5 — 상수 주석을 「응답 헤더 도착까지」로 정정했다.** `kisFetch` 는 `finally` 에서 타이머를 지운 뒤 `res.text()` 를 하므로 **본문 읽기에는 상한이 없다.** 헤더는 왔는데 본문이 멈추면 합류한 호출이 다시 길게 묶인다(감사자 하네스 H2: +13초에도 정지). **막지 않았다** — 운영 163,474건에 본문 단계 정지로 볼 호출 0건이고, 이 파일을 **네 번째로** 고치는 위험이 그 확률보다 크다고 판단했다. 후속 후보 5 에 적는다. 감사자가 「이 지점은 '조금이라도 걸리면 fail' 기준보다 내가 관대한 곳」이라고 스스로 밝혔다 — 그 판단을 받아들인다.
- [23:23] **권고 3 — 낡은 문장 둘 정정.** 시험 파일의 「실패 전파 미검증으로 남긴다」(바로 위에 전파 시험을 넣은 뒤로 거짓) · 상수 주석의 최악 시간 「3회 × (10초+대기)」 → **약 180초**(감사자 실측: 타임아웃은 `AbortError` 로 즉시 던져 재시도를 돌지 않으므로 반복되는 것은 `EGW00133` 응답뿐이다. 내 추정이 과대였다). 종전은 **회차마다 약 5분**.
- [23:24] **권고 4 — L-4 는 `test.todo` 로 표시한다**(감사자가 내 사절 근거도 정정했다: 「수단이 없다」는 과하고, 토큰 생존을 추적하는 가짜 KIS 를 쓰면 단언은 가능하다. 사절이 맞는 이유는 ① 통과시킬 알려진 설계가 없어 `test.failing` 이 **영구 소음**이 된다 ② 결과가 확률적(66~83/100)이라 흔들린다). 후속 7 에 그 근거를 적었다.

### 🔴 날짜 정정 — 「11-03(월)」은 **화요일**이다

감사자가 잡았다. 2026-10-31 은 **토요일**이므로 다음 개장은 **11-02(월)**이고 11-03 은 화요일이다. 내가 T-132·T-133·T-136 기록과 사용자 보고에 반복해서 「11-03(월)」로 적었다 — **관측 시점을 하루 늦게 안내한 셈이다.** 전부 `11-02(월)` 로 고쳤다(T-132 3곳·T-133 4곳·T-136 3곳·board 1곳·ACTIVE 3곳·20-Log 1곳 = **15곳**).

### 🔴 후속 5 는 「5주간 0건」이 아니다 — 실제 사건이 있었고 월요일 장중에 걸릴 수 있다

감사자가 `api-usage` 의 `token-p` 를 읽어 찾았다. **이 task 의 판정 조건은 아니지만 일정이 걸린 발견**이다.

- **2026-10-30 07:00:03~07:02:10Z(KST 16:00:03~16:02:10)**: `token-p` 118건 중 **403 거절 111건**. 약 38건씩 **정확히 60초 간격으로 세 번** 몰리고 성공은 7건뿐이다. 약 38개 호출이 같은 순간 **공유되지 않은 발급 경로**로 내려갔고, 약 30개는 세 번 다 거절당해 **약 2분간 토큰이 없었다**[가능성 높음].
- **T-136 은 이 경로를 낫게도 나쁘게도 하지 않는다** — 무효화 발 합류만 막고, 캐시 미스·갱신 발 동시 발급은 그대로다(후속 5).
- **일일 갱신 시각이 매일 약 1시간씩 앞당겨지고 있다**(10-31 은 06:02Z). 추세가 유지되면 **11-02(월) 13시 전후, KRX 장중**에 갱신이 올 수 있다[추측 — 주말 호출량에 따라 달라진다].
- 감사자가 라운드 1 스크래치에서 **발급 자체를 모듈 단위 단일 비행으로 묶어 같은 하네스로 120/120 발급 1회**를 확인한 형태가 있다고 했다. **월요일 장중 전에 처리할지는 사용자 결정 사항**으로 올린다.

### 라운드 5b 재확인 요청 범위

단언 하한 · 상수 주석 2곳 · 시험 주석 1곳 · (코드 동작 변경 없음 — 값·주석·단언 범위만).

## 구현 라운드 5c — 3차 QA FAIL(F-3, 문서) 반영 · L-5 위험 수용 (메인 세션)

3차 QA 판정은 **FAIL**이고 **코드 동작 결함은 0건**이다. 사유는 내 주석·기록의 수치 오류 하나다(F-3, Low·문서). QA 가 「결함이 있으면 FAIL」 기준을 그대로 적용했다.

- [23:40] **F-3 정정.** `kis-auth.ts` 두 곳이 서로 충돌하고 있었다 — 47행에 「재시도 3회 × (10초 + 대기)가 상한」이 **라운드 5b 에서 고쳤다고 적었는데 그대로 남아 있었고**, 116행에는 「최악은 약 180초」가 있었다. QA 실측으로 정정: `EGW00133` 응답이 곧바로 오면 **180초**, 상한 직전(약 10초)에 오면 **약 210초**, 그리고 **스로틀 대기(회당 최대 30초)와 본문 읽기는 어느 계산에도 들어 있지 않다.** 내가 적은 두 수치가 **둘 다** 정확하지 않았다 — 그 사실을 주석에 남겼다.
  - 교훈: 같은 사실을 **두 곳에** 적어 두면 한쪽만 고치게 된다. 5b 에서 「고쳤다」고 기록했는데 실제로는 한 곳만 고쳤고, 그 기록 때문에 나는 끝난 줄 알았다. 최악 시간 설명은 이제 `issueAndStore` 주석 **한 곳**에만 두고 상수 주석은 그쪽을 가리킨다.
- [23:42] **🔴 L-5 위험 수용**(3차 QA 조건 b). F-A 는 **헤더 단계에서만** 닫혔다 — 헤더가 즉시 오고 **본문이 멈추면** 합류한 호출이 다시 길게 묶인다(QA 실측: 본문 13초 정지 시 두 호출 모두 **13.0초 대기 후 성공**). 조건 a 대로 주석의 「F-A 해소」 문구를 「**헤더 도착까지만**」으로 한정했다.
  - **수용 근거**: 운영 7일 KIS 호출 **163,597건 중 성공 최대 지연 4,023ms** — 본문이 4초 넘게 멈춘 기록이 **0건**이다. 고치려면 `kisFetch` 의 타이머 구조를 바꿔야 하고 **그 함수는 KIS 호출 16곳이 공유한다**. 이번 task 에서 `kis-auth.ts` 를 세 번 고치며 매번 새 결함을 만든 전례를 보면, **지금 네 번째로 손대는 위험이 관측 확률보다 크다.**
  - 조건 c(후속 5 에 본문 정지 시험)는 [[T-138-token-issue-single-flight]] 후속 후보 2 에 적었다.
  - 감사자도 「이 지점은 '조금이라도 걸리면 fail' 기준보다 내가 관대한 곳」이라고 스스로 밝혔고, QA 도 차단 사유가 아니라고 판단했다. **셋이 같은 결론이지만 근거는 관측 확률이다 — 본문 정지가 실제로 나면 이 판단이 틀린 것이다.**
- [23:44] **QA 가 내 추세 설명을 정정했다** — 발급 시각이 매일 앞당겨지는 것은 **추세가 아니라 `24h − 1h` 주기**다(발급 간격 약 23시간: 토큰 수명 24시간, 만료 1시간 전 갱신). 10-29 16:44 → 10-30 16:00 → 10-31 15:02(KST). 결론은 같다 — **다음은 일요일 14시대, 그다음은 11-02(월) 13시 전후로 KRX 장중**이고, T-136 배포는 이 위험을 **줄이지 않는다**. [[T-138-token-issue-single-flight]] 가 그것을 다룬다.
- [23:45] **날짜 점검 결과**(QA, 2026 달력 대조 151건) — T-132·T-133·T-136·board·ACTIVE·20-Log 에 요일 불일치 **0건**(정정 완료). 남은 「11-03(월)」은 T-136 의 **정정 설명 문장** 안에만 있다. 범위 밖 불일치 11건은 T-045·T-062·T-115·ADP-006 에 있다 → 별 건으로 넘긴다.
- [23:46] 재검증 — 서버 `npm run typecheck` **exit 0** · `npx jest src/lib/exchanges` **29스위트 685건 통과**. **이번 변경은 주석뿐이다**(동작 변경 0) — 그래서 감사 라운드 6 을 돌리지 않았다. 감사자 5차 PASS 의 `scope` 가 이 파일을 포함하고, 주석은 동작을 바꾸지 않으며, 11-02(월) 장중 위험 때문에 T-137 을 시작해야 한다는 판단이다. **이 결정을 여기 적어 감사 가능하게 둔다.**

## 배포 기록

- [2026-10-31 23:59] **배포 완료.** 사용자 지시 「지금 배포」. 서버 체크아웃에서 `git push origin main`(`3669090..18896a8`, 커밋 **4개**). 코드가 든 커밋은 **T-136 `a064722`·T-138 `18896a8` 둘**이고 나머지 2개(`287b637`·`0b8b013`)는 다른 세션의 문서다. webhook blue/green 23:58:54 시작 → 00:00:45 완료(`exit=0`).
- 결과: `RELEASE_RESULT {"status":"ok","release":"20261031-235854-18896a8b","sha":"18896a8bc9788f0cab98b2cba9860d6b3d0414dd","previous":"…/releases/20261031-215102-36690909","migrated":false}`. 마이그레이션·DDL·스위치 변경 없음. 롤백 대상 `20261031-215102-36690909`.
- 배포 후 확인(00:01, 읽기 전용): ① `current` → 새 릴리스 ② pm2 `stockinvest`·`stockinvest-cron` 둘 다 online·restarts 0·`pm_cwd` 새 릴리스 ③ `cron-runner.sh` **1개**(00:00:26 틱 OK) ④ `/api/health` 200 · `ok:true`·`db:true`·`schemaFatal:false`·`safetyStatus:"green"`·`dryRun:true`·`killSwitch:false` ⑤ `system_config` 안전 키 **6개 값·`updated_at` 전부 배포 전 그대로** ⑥ 배포본에 `kis-token-codes.ts`·`kis-token-retry.ts` 존재, `kis-auth.ts` 에 `issueOnce`/`issueInFlight` 8곳·`TOKEN_ISSUE_TIMEOUT_MS` 2곳, `.next/server/chunks` 2개에 새 메시지 컴파일.
- 관찰(이상 아님) — `news-peek-overseas-00` 이 00:00:26 에 `degraded capture=failed` 1건. **10-31 00:00:40 에도 같은 것이 있었다** → 자정 틱의 기존 패턴이고 이 배포와 무관하다. 재실행(00:00:30)은 OK.
- **🔴 실효 확인은 아직이다** — 다음 토큰 갱신이 **2026-11-01 14:02 KST(05:02Z)** 로 배포 시점에서 약 14시간 뒤다. 배포 직후 토큰 로그가 0건인 것은 **"정상"이 아니라 "아직 그 창이 오지 않았다"** 는 뜻이다.
  - 배포 **직전**(10-31 15:02:07)에 `[kis-auth] issued new token` 이 **같은 초에 3줄** 찍혀 있다 — T-138 이 고치려는 바로 그 동시 발급이고, 문제가 재현 중이라는 증거다.
  - **11-01 14:02 KST 가 휴장일 리허설 창이다**: `api-usage-2026-11-01.jsonl` 의 `token-p` 가 **1건(많아야 2건)·403 0건**이면 단일 비행 실증. **같은 초 2건 이상 + 403** 이면 비행이 안 걸린 것(Next 번들 간 `kis-auth` 모듈 인스턴스 분리 가능성 — 감사·QA 가 **미검증**으로 남긴 유일한 핵심 가정이다).


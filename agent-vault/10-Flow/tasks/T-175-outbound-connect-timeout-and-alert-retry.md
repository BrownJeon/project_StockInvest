---
task_id: T-175
title: 외부 접속 0.25초 끊김(Happy Eyeballs) 해소 + 공시 알림 전송 실패 재시도 + 장중 평가 실패 원인 기록
status: review
waiting: [push_approval]
priority: high
project: StockInvest
created: 2026-11-18
updated: 2026-11-18
base_ref: 959871dea94ab826326b19fa623de524a7c45cf3
risk_level: R2
roles_involved: [leader, judge, developer, reviewer, qa, deployer]
related_tasks: [T-119-holdings-premarket-check, T-160-home-anomaly-diagnostics, T-007-telegram-silent-failure]
tags:
  - type/task
  - domain/notify
  - domain/cron
  - domain/infra
aliases:
  - 외부접속 0.25초 끊김
  - 텔레그램 ETIMEDOUT
execution_context:
  schema_version: 1
  origin_tool: claude
  current_tool: claude
  current_procedure: claude_standard
  current_scope: 원인 조사·설계부터 구현·감사·QA·서버 worktree 커밋까지. push(=운영 배포)는 사용자 승인 후
  last_event_id: E1
---

# T-175 외부 접속 0.25초 끊김 해소 + 공시 알림 재시도 + 장중 평가 실패 원인 기록

작업 worktree: 서버 `~/.node-local/stockinvest-t175` (detached, base `959871d` = origin/main = 운영 릴리스 `20261115-222335-959871de`). 커밋은 이 worktree 에서 한다(`commit-msg` 훅).

## 목표·배경 (Leader)

2026-11-18 앱 홈 「데이터 이상·분석 실패」에 두 건이 떴다(사용자 발견).

1. **22:01 보유 종목 개장 전 공시 확인 실패** — `job_run_log` `holdings-premarket` `failed` HTTP 503. SEC 수집은 정상(보유 5·확인 4·새 공시 1 = `NAS:NVDA` 8-K `0001045810-26-000088`)이었으나 텔레그램 전송이 `fetch failed (ETIMEDOUT / connect ETIMEDOUT 149.154.166.110:443 / connect ENETUNREACH 2001:67c:4e8:f004::9:443)` 로 실패 → `alerted=0 alert_undelivered=1`. 공시는 `ci_raw_item` 에 「수집됨」으로 기록돼 다음 실행에서 fresh 가 아니고, 창은 24시간이라 **알림이 영구 유실**됐다 [가능성 높음].
2. **12:11 장중 전략 평가 실패** — `strategy-eval` HTTP 500 `{"ok":false,"error":"fetch failed"}` 2초 만에 종료. `runAll()` 안의 외부 호출 하나가 던진 예외가 라우트 catch 까지 올라왔다. 라우트는 `e.message` 만 찍어 **어느 호스트인지 기록이 없다**. 다음 회차(12:19)부터 정상, 9회 중 1회 실패.

### 근본 원인 (Leader 조사, 2026-11-18 22:5x 서버 실측)

- 운영 웹은 `/usr/bin/node` v24.22.2, `NODE_OPTIONS=--dns-result-order=ipv4first`(ecosystem.config.js:37). Node 20+ 는 `autoSelectFamily`(Happy Eyeballs)가 기본 켜짐이고 **주소당 시도 시간 기본 250ms**(`net.getDefaultAutoSelectFamilyAttemptTimeout()` = 250 실측).
- 서버는 **IPv6 기본 경로가 없다**(`ip -6 route show default` 0줄). 그런데 `api.telegram.org` 는 A(149.154.166.110)·AAAA 둘 다 돌려준다.
- 서버 → 텔레그램 TCP 연결 시간 실측 **0.227~0.265초**(curl `time_connect` 15회). 즉 250ms 경계에 걸쳐 있다.
- 결과: ipv4first 라 IPv4 를 먼저 시도 → 연결이 250ms 를 넘기면 Node 가 끊고 IPv6 로 넘어감 → `ENETUNREACH` → 둘 다 실패. 오류 문구 `ETIMEDOUT 149.154.166.110 / ENETUNREACH 2001:…` 와 정확히 같은 모양이다.
- **재현**: 같은 node 로 `fetch('https://api.telegram.org/')` 를 반복 — 기본값(250ms) 90회 중 **3회 ETIMEDOUT**, `--network-family-autoselection-attempt-timeout=1000` 90회 중 **0회**. (프로브 `~/.node-local/t175-he-probe.mjs`, 토큰 없이 루트 경로만 호출)
- `src/lib/notify/telegram.ts:10-19` 주석은 「IPv4 실패 시 IPv6 로 폴백한다」고 적었는데, 이 호스트에서는 그 폴백이 **IPv4 를 250ms 에 끊는 원인**이다. ecosystem.config.js:36 주석도 같은 오해.
- 텔레그램 `getUpdates` 실패가 11-16 9회·11-17 11회·11-18 15회로 하루 종일 흩어져 있다 — 같은 원인으로 본다 [가능성 높음]. 12:11 장중 평가의 실패 호스트는 기록이 없어 **미확정**이다(같은 기전일 가능성 [추측] — 2초 만에 끝난 모양과 맞는다).
- 이 기전은 텔레그램만이 아니라 **AAAA 레코드가 있고 연결이 250ms 넘게 걸리는 모든 외부 호스트**에 적용된다(KIS·SEC·BLS·frankfurter 등 개별 확인은 안 함).

## 사용자 지시·승인 (원문 보존)

- 2026-11-18 22:4x 「그전에 앱에서 분석 실패건이 식별되었는데, 22:01에 '보유 종목 개잘 전 공시 확인', 12:11에 '장중 전략 평가'로 나오는데 상황 부터 먼저 확인해줘」
- 2026-11-18 22:5x 「재발 방지 착수」 (Leader 가 제시한 질문 「두 건의 재발 방지 작업을 task로 시작할까요?」 에 대한 답)
- push(운영 배포)는 이 승인 범위가 아니다 — 별도 승인.

## 설계 (Leader — Developer 구현 사양)

화면 변경 없음(데모 대상 아님 — judge 판정으로 확정). DDL 없음. 버전: 웹 `package.json` 0.14.0 → **0.15.0**(마이너). 앱(APK) 무관.

### WP-1 근본 해소 — 주소당 연결 시도 시간 상향 (웹 프로세스 전역)
- 웹 프로세스 시작 시 `net.setDefaultAutoSelectFamilyAttemptTimeout(<값>)` 으로 250ms 를 올린다. 권장 위치는 `src/instrumentation.ts` 의 nodejs 런타임 분기(이미 SAFETY_PATHS). 값은 Developer 가 근거와 함께 정한다(Leader 제안 2000ms — IPv4 가 진짜 죽었을 때 IPv6 로 넘어가는 지연은 이 값만큼 늘지만, 이 호스트는 IPv6 가 원래 안 된다).
- **반드시 실측**: (a) Next 의 instrumentation 이 모든 라우트의 fetch(undici) 이전에 실행되고 undici 연결이 이 전역 기본값을 실제로 따르는지 — 서버에서 프로브로 `setDefault…` 를 코드로 부른 경우도 재현 시험(기본 3/90 → 0/N)이 같은지 확인. (b) 대안 `NODE_OPTIONS` 에 `--network-family-autoselection-attempt-timeout` 추가는 pm2 env 갱신이 배포 때 반영되는지(`~/.local/webhook-deploy/deploy-stockinvest.sh`·release.sh 의 pm2 기동 방식) 확인한 뒤에만 고른다. 두 경로를 동시에 쓰지 않는다(하나의 정본).
- `telegram.ts:10-19`·`ecosystem.config.js:36-37` 의 낡은 설명을 사실대로 고친다.
- cron 러너(`scripts/cron-runner.sh`)는 curl 이라 무관 — 바꾸지 않는다.

### WP-2 공시 알림 전송 실패가 조용히 유실되지 않게 (holdings-premarket)
- 현재: `sendOne` 1회(텔레그램 계층 자체 재시도 1회·500ms 포함) 실패 → `undelivered++` → 끝. 공시는 이미 기록돼 다시 fresh 가 되지 않는다.
- 요구: ① 같은 실행 안에서 **간격을 둔 재시도**(예: 2~3회, 총 대기는 기존 `SEND_STAGE_END_MS`·라우트 시간 예산 안) ② 그래도 못 보낸 공시는 **식별자(심볼·양식·접수번호·SEC URL)를 로그에 남겨** 사람이 복구할 수 있게 ③ 이미 전달된 알림을 두 번 보내지 않는다 ④ 상태 보고(`failed`·`alert_undelivered`)는 지금처럼 유지.
- 실행 간(다음 틱·다음 날) 영속 재전송은 이번 범위 밖 — 상태 저장소가 필요해 DDL·설계 결정이 필요하다. 필요하다고 판단되면 구현하지 말고 Leader 에게 근거와 함께 올린다.
- 다른 알림 경로(주문·청산 알림 등)의 재시도 정책은 바꾸지 않는다(WP-1 이 공통 원인을 덮는다).

### WP-3 장중 평가 실패 원인 기록 (strategy-eval)
- `src/app/api/cron/strategy-eval/route.ts` catch 에서 `e.message` 와 함께 원인 코드·주소(`e.cause.code`, `AggregateError` 의 각 `errors[].code`/`address`/`port`)를 로그에 남긴다. 비밀(토큰·키·쿼리스트링)이 섞이지 않게 한다 — 기존 `redactSecrets`·`causeCodeOf` 류가 있으면 재사용.
- 응답 본문 형식(`{ok:false,error}`)과 HTTP 500 은 바꾸지 않는다(러너·job_run_log 가 읽는다).
- 「어느 외부 호출이 runAll 전체를 멈추게 했나」 를 코드로 찾을 수 있으면 Developer 보고에 적는다(고치는 것은 범위 밖 — 후속 후보).

### 시험·검증 요구
- WP-1: 설정이 적용됐는지 확인하는 단위 시험(+ `src/__tests__/instrumentation-shape.test.ts` 정합) + **서버 실측 프로브 결과**(기본값 vs 적용값, 각 60회 이상).
- WP-2: 재시도 성공·전부 실패·첫 시도 성공 시 중복 없음·시간 예산 초과 경로 시험.
- WP-3: cause 가 있는 오류·AggregateError·일반 Error·비 Error throw 의 로그 시험, 비밀 마스킹.
- 전체 `tsc`·jest·`next build` — 무거운 시험은 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10 …`, Node `~/.node-local/v24.22.2/bin`. 기존 실패 묶음(T-171 B·C)과 새 실패를 이름으로 구분해 보고.

## Developer

- [22:55] 착수 — 실행 도구 claude(developer, Opus). 작업 위치 서버 worktree `~/.node-local/stockinvest-t175`(base `959871d`). 커밋·push·pm2·운영 DB 쓰기·`/api/cron/*` 호출 없음. 변경 전 기준 시험을 먼저 떴다(jest 전체 → `~/.node-local/t175-logs/jest-before.json`, 실패 이름 목록 `fail-before.txt`).
- [23:25] WP-1 바꾼 파일: `src/instrumentation.ts` — nodejs 양수 조건 블록 **맨 앞**에 독립 try/catch 로 `await import('node:net')` → `net.setDefaultAutoSelectFamilyAttemptTimeout(OUTBOUND_CONNECT_ATTEMPT_TIMEOUT_MS)`(상수 2000, 파일 안 1곳). 실패해도 서버 기동은 계속(기본 250 으로). 정본은 이 코드 하나 — `NODE_OPTIONS` 경로는 고르지 않았다(release.sh 가 `pm2 startOrReload --update-env` 라 그쪽도 배포로 반영은 되지만, 코드에 두면 dev·수동 기동에서도 같고 단위 시험으로 고정된다). 낡은 설명 정정: `src/lib/notify/telegram.ts:10-19`(「IPv4 실패 시 IPv6 폴백」이 이 서버에서는 실패 원인이었다는 사실로), `ecosystem.config.js:36-37`(ipv4first 는 순서만 정하고 시도 시간은 instrumentation 이 정한다 — 주석만, 값 불변). `scripts/cron-runner.sh` 미변경.
- [23:25] WP-1 값 2000 의 근거(서버 실측, `/usr/bin/node` v24.22.2 + `--dns-result-order=ipv4first`, 대상 `https://api.telegram.org/` 루트·토큰 없음): ① IPv4 TCP 연결 시간 200회(300ms 간격, TLS 없음) min 225·p50 244·p90 278·p99 3371·max 5379ms, 250ms 초과 71회(35.5%)·1초 초과 7회·2초 초과 2회·3초 초과 2회 → 2000 은 SYN 1회 재전송(약 1.25초)까지 덮는다. ② 3초를 넘는 드문 연결은 기다리기보다 빨리 실패시키고 텔레그램 계층 1회 재시도(0.5초)·WP-2 재시도가 새 연결을 여는 편이 공시 알림의 시도당 상한 5초와 맞는다. ③ 이 서버는 IPv6 경로가 없어 값을 올려 잃는 것이 없다.
- [23:25] WP-1 프로브 실측 — 코드로 설정한 경우(`~/.node-local/t175-he-probe4.mjs`, **매 요청 새 undici Agent = 새 TCP 연결**, 각 90회): 기본 250ms 1차 ok 62·실패 28(ETIMEDOUT 27·ECONNRESET 1) / 2차 ok 59·실패 31(ETIMEDOUT 27·ECONNRESET 4); 코드 설정 2000ms 1차 ok 89·실패 1(ECONNRESET 1, ETIMEDOUT 0) / 2차 ok 85·실패 5(ETIMEDOUT 3·ECONNRESET 2 — 그 회차 max 2003ms, 2초 넘는 연결); 참고 5000ms 1회 ok 88·ECONNRESET 2·ETIMEDOUT 0. 합계 ETIMEDOUT 기본 54/180(30%) → 2000 3/180(1.7%). ECONNRESET 은 두 값 모두 소수 발생 — 짧은 시간에 새 연결을 수백 번 연 영향일 수 있다 [추측], 이 설정과 무관.
- [23:25] WP-1 「코드로 부른 설정을 undici fetch 가 실제로 따르는가」 증명: 코드로 100ms·150ms 를 넣으면 90/90 전부 ETIMEDOUT(소요 p50 102·152ms) — 같은 프로세스의 fetch 연결이 그 값으로 끊긴다. 이미 만들어진 전역 Agent 도 따른다(기본값에서 전역 Agent 생성·keep-alive 만료 후 100ms 로 바꾸고 같은 Agent 로 요청 → ETIMEDOUT). 주의: 같은 연결을 재사용하는 프로브(`t175-he-probe2.mjs`, Leader 프로브와 같은 방식)는 기본값에서도 0/180 실패 — keep-alive 로 실제 새 연결이 거의 없어서다. 그래서 수치는 새 연결 프로브로 냈다. Next 쪽 순서: `next/dist/server/next-server.js` 15.5.22 의 `prepareImpl()` 이 `runInstrumentationHookIfAvailable()` 을 await 한 뒤 요청을 받는다(코드 확인), 빌드 결과 `.next/server/instrumentation.js` 에 `setDefaultAutoSelectFamilyAttemptTimeout(2e3)` 가 있고 edge 번들에는 없다.
- [23:25] WP-2 바꾼 파일: 새 `src/lib/notify/send-retry.ts`(`sendWithRetry` — 실제 전송 실패일 때만 간격 두고 재시도, 한 채널이라도 전달되면 성공, 채널 없음·미설정은 재시도 없음, **대기 상한 5초에 걸린 시도는 결과 미확정이라 겹쳐 보내지 않고 다음 간격 동안 그 결과를 기다림**(늦게 전달=성공·늦게 실패=곧바로 재시도·끝내 미확정=`unresolved` 로 중단), 새 시도는 `canStart(간격)` 이 허락할 때만), `src/app/api/cron/holdings-premarket/route.ts`(간격 `[2000, 5000]` = 최대 3회, 예산은 기존 「알림 단계 끝 55초」 그대로 — 새 시도·재시도 모두 그 전에만 시작, 끝내 못 보낸 공시마다 `HP_ALERT_UNDELIVERED reason=… symbols=… form=… accession=… url=…` 경고 1줄(요약 알림 실패면 새 공시 전부, 50줄 상한), 상태 보고 `failed`·`alert_undelivered=N`·응답 본문 형식 불변). 다른 알림 경로 미변경. 실행 간 영속 재전송은 구현하지 않음 — 이번 사고(첫 시도 실패)는 같은 실행 안 재시도로 덮인다고 본다 [가능성 높음]. 다만 22:01 처럼 그 실행 전체가 끊긴 네트워크 아래 있으면 3회 모두 실패할 수 있고 그때는 로그 식별자로 사람이 확인해야 한다 — 영속 재전송 필요 여부는 Leader 판단 사항.
- [23:25] WP-2 부수 변경: `src/lib/corp-intel/__tests__/isolation.test.ts` — holdings-premarket 라우트 import 허용 목록에 `@/lib/notify/send-retry` 1개 추가(T-175 주석) + 그 모듈이 `import type { AlertDispatch } from '@/lib/notify'` 외에 아무것도 가져오지 않고 동적 import·fetch 가 없음을 같은 시험에서 고정. 처음엔 헬퍼를 라우트 폴더에 뒀다가 이 경계 시험(라우트 import 목록·corp-intel 용어 언급 파일 목록) 3건을 새로 깨뜨려 `lib/notify` 로 옮기고 헬퍼 본문에서 해당 용어를 뺐다. **경계 시험의 허용 목록을 넓힌 것이므로 Reviewer 확인 필요.**
- [23:25] WP-3 바꾼 파일: `src/lib/notify/result.ts` 에 `describeErrorCause(e, ...secrets)` 추가(최상위 code·errors, cause 사슬 깊이 4·각 errors 6개+나머지 수, 순환 안전, Error 아닌 값은 `thrown=<typeof>`, `redactSecrets`+URL 쿼리스트링 통째 가림+제어문자 제거, 노드당 160자), `src/app/api/cron/strategy-eval/route.ts` catch 에서 `console.error('[cron/strategy-eval]', error, '| <원인>')`(원인 없으면 이전과 같은 두 인자). 응답 `{ok:false,error}`·500 불변. 기존 `causeCodeOf` 는 cause.code 만 봐 AggregateError 주소를 못 담아 새 함수로 했다.
- [23:25] WP-3 runAll 을 멈추게 한 호출 후보(고치지 않음 — 후속 후보): 운영 `shared/logs/api-usage-2026-11-18.jsonl` 에 12:11:09.977(KST) `kis domestic.market-cap-ranking` ok:false status 200 err other, **12:11:10.009 같은 op ok:false status 0 err network ms 38**, 그리고 `pm2-err.log` 12:11:10 `[cron/strategy-eval] fetch failed`. 코드 경로: `runMarket` → `refreshUniverse(market, force)`(engine.ts, try 없음) → `refreshUniverseImpl` → `fetchMarketCapRanking`(universe.ts:191, try 없음) → `fetchMarketCapPage` → `kisFetch`(kis-http.ts:443-445 가 fetch 예외를 기록 후 그대로 throw). 즉 유니버스 갱신 주기에 시총 랭킹 1건이 네트워크 오류면 장중 평가 전체가 500 이 된다 [가능성 높음]. 청산 평가(`getHeldAmounts`·`runExitEngine`)는 그보다 앞이라 그 회차에도 돌았다 [가능성 높음]. **이 실패는 WP-1 기전이 아닐 가능성이 높다**: KIS 호스트(`openapi.koreainvestment.com`)는 `getent ahosts` 상 IPv4 1개뿐(AAAA 없음)이라 Happy Eyeballs 경합이 없고, 실패가 38ms 만에 났다(250ms 시도 시간 초과가 아님) — 원인 코드는 기록이 없어 미확정, WP-3 로그로 다음부터 남는다. 11-18 KIS network 실패는 그 밖에 3건(get-ticker 1·get-minute-candles 2, 5~23ms).
- [23:25] 시험 — 새 시험 45건 전부 통과: `src/lib/notify/__tests__/send-retry.test.ts`(13 — 첫 시도 성공 1회·부분 전달·재시도 성공·3회 실패·throw·채널 없음·미확정 후 늦은 성공/늦은 실패/끝내 미확정·예산), `src/lib/notify/__tests__/describe-error-cause.test.ts`(15 — AggregateError·ENOTFOUND·실제 undici 연결 거부·cause 없는 Error·비 Error throw 4종·토큰/비밀 문자열/쿼리스트링 마스킹·제어문자·순환·깊이·errors 상한), `src/app/api/cron/__tests__/strategy-eval-error-log.test.ts`(5 — 응답 불변·로그 형식·마스킹·성공 경로), holdings-premarket `route.test.ts` +6(재시도 성공·첫 시도 성공 1회·3회 실패+식별자 로그·채널 없음·55초 예산(재시도·다음 공시 모두 미시작)·요약 실패 11건 식별자), `instrumentation-shape.test.ts` +6(블록 안 1회·상수 2000·NODE_OPTIONS 에 이중 설정 없음·워치독/폴러보다 먼저·실제 register() 실행 시 2000·edge 면 불변·워치독이 던져도 유지). isolation 허용 목록 갱신.
- [23:25] 전체 결과(서버, flock+nice): `tsc --noEmit` 종료 0. jest 전체 — 변경 전 27 suites·416 tests 실패 / 12230 통과 / 12932 → 변경 후 27 suites·416 tests 실패 / 12275 통과 / 12977. 실패 이름 목록(C 로캘 정렬) **변경 전후 완전히 같음**(새 실패 0, 사라진 실패 0) — 기존 묶음은 렌더 시험(home-render-t108 194·risk-policy-render 36 등)과 isolation(corp-intel 1·profit-engine 3)·fence 류. 목록: `~/.node-local/t175-logs/fail-before.txt`·`fail-after.txt`. `next build` 종료 0. 주의: worktree 의 `node_modules` 는 공유 NFS 트리로의 심볼릭 링크다(Leader 구성) — 운영 `npm ci` 결과와 같은지는 미확인.
- [23:25] 미검증: ① Next 프로덕션 서버를 실제로 띄워 라우트 안 fetch 가 2000 을 쓰는지는 실행하지 않았다(운영 DB·워치독·폴러가 함께 뜨는 앱이라) — 근거는 Next 코드 순서 + 빌드 산출물 + Node 단독 프로브. ② holdings-premarket 의 대기 상한(5초) 미확정 경로는 단위 시험(짧은 상한)으로만, 라우트 시험에서는 실제 5초를 쓰지 않았다. ③ 운영 배포 후 텔레그램 `getUpdates` 실패 빈도 변화는 배포 뒤 관찰 항목. ④ SEC·BLS·frankfurter 등 다른 외부 호스트의 AAAA·연결 시간은 개별 확인하지 않았다.
- [23:25] 버전 `package.json` 0.14.0 → 0.15.0(현재 값 확인 후), `package-lock.json` 루트 두 줄도 같이(직전 T-174 0.14.0 커밋과 같은 방식). 프로브 스크립트는 `~/.node-local/t175-he-probe2.mjs`·`t175-he-probe4.mjs`·`t175-tcp-dist.mjs`, 출력 `~/.node-local/t175-logs/probe2~5.log`(저장소 밖).
- [23:28] 커밋 훅 관련(`SAFETY_PATHS` 를 파일별로 대조): 대상 = `src/instrumentation.ts`·`src/__tests__/instrumentation-shape.test.ts`·`src/app/api/cron/holdings-premarket/route.ts`·`…/holdings-premarket/__tests__/route.test.ts`·`src/app/api/cron/strategy-eval/route.ts`·`src/app/api/cron/__tests__/strategy-eval-error-log.test.ts`·`src/lib/corp-intel/__tests__/isolation.test.ts`. 목록 밖 = `src/lib/notify/send-retry.ts`(+시험)·`src/lib/notify/result.ts`(+`describe-error-cause` 시험)·`src/lib/notify/telegram.ts`·`ecosystem.config.js`·`package.json`·`package-lock.json` — 감시 중인 라우트의 동작(재시도·로그 마스킹)을 정하는 코드가 목록 밖 `lib/notify` 에 있다는 점은 Reviewer·Leader 판단 사항.

## Reviewer

- [23:30] 실행 도구 claude(reviewer, Sonnet). 검토: 서버 worktree `git diff 959871d` + 새 파일. 직접 재실행 — 새 시험 4개 + 라우트 시험 2개 + 경계 시험 묶음 jest: 111 통과·1 실패, 그 1건은 `isolation.test.ts` 「corp-intel 언급 파일」(`analysis-data/capture-operating-data*`·`strategy/m40/operating-evidence*` 4개를 가리킴 — 이번 diff가 만지지 않은 파일) 이고 Developer의 변경 전 실패 목록(`fail-before.txt` 411행)에 이미 있다 → 이번 변경과 무관(사실). `tsc` 는 Developer 증빙(`tsc-after.log` tsc_exit=0)만 확인, 재실행 안 함.
- [23:30] info — 린트 미측정: 프로젝트에 ESLint 설정 파일이 없어 `next lint` 가 설정 선택 프롬프트에서 멈춘다(비대화형). 설정 파일은 만들지 않았다(git status 변화 없음). 변경 파일 린트 통과 여부는 미확인이며 이 task 의 결함이 아니라 기존 환경 상태다.
- [23:30] 의도 검증 WP-1(충족): `src/instrumentation.ts` 의 `net.setDefaultAutoSelectFamilyAttemptTimeout(2000)` 은 `NEXT_RUNTIME === nodejs` 양수 분기 맨 앞이라 edge 번들에 안 들어가고(Developer가 빌드 산출물로 확인, 형태 시험이 고정), 워치독·폴러 첫 fetch 보다 앞선다. 설정 실패는 try/catch 로 기동을 막지 않는다. 100·150ms 로 넣으면 90/90 ETIMEDOUT 이 나는 프로브는 undici 연결이 전역 기본값을 실제로 따른다는 적절한 반증 시험이다. 부작용: IPv4 가 진짜 죽은 AAAA 보유 호스트에서 IPv6 폴백이 2초 늦어질 뿐(이 서버는 IPv6 경로가 없다). KIS 는 IPv4 1개뿐(Developer `getent` 확인)이라 주문 경로에 영향 없음 — 단일 주소에서는 경합 자체가 없고 값을 올려 잃는 것도 없다. 확인 못 한 것: 프로덕션 Next 서버를 실제로 띄워 본 것은 아니다(Developer도 미검증으로 적음) — 배포 후 관찰 항목.
- [23:30] low — WP-1 값 2000 의 잔여 위험: 코드 설정 프로브 2차에서 ETIMEDOUT 이 3/90 남았다(2초 넘는 연결 — 그 회차 max 2003ms). 근본 해소가 아니라 30% → 1.7% 감소다. WP-2 재시도가 이 잔여를 받치는 구조이므로 설계 의도와 맞다. 「재발 방지」로 보고할 때 「0 으로 만든다」가 아니라 「약 1/18」로 적을 것.
- [23:30] 의도 검증 WP-2(충족): `src/lib/notify/send-retry.ts` 논리를 줄 단위로 따라갔다. 재시도는 `failed` 채널이 있거나 던질 때만(L102-L107), 한 채널이라도 전달되면 즉시 성공(L103), 미설정은 재시도 없음(L104). 대기 상한(5초)에 걸린 시도 위에 새 시도를 겹치지 않고 간격 동안 같은 `pending` 의 결과를 기다린다(L93-L99) — 타임아웃을 실패로 오인해 중복 발송하는 가장 흔한 결함을 피했다. 예산: 새 시도는 `canStart` 통과 시에만, 최악 종료 약 60초로 러너 curl 상한(90초) 안. `settle` 이 모든 거부를 삼키므로 늦게 끝나는 pending 이 unhandled rejection 이 되지 않는다. 동시성: 라우트가 순차 for-loop 이고 `sendOne` 호출이 직렬이라 같은 공시에 대한 겹침 없음.
- [23:30] low — 남는 중복 발송 경로(설계상 허용 범위로 판단, 사실로 기록): 텔레그램 요청이 서버에서 처리됐으나 응답만 유실되어 `fetch failed` 로 보이는 경우, 텔레그램 계층 자체 재시도(`telegram.ts` L105-L110, 500ms)와 새 상위 재시도가 같은 메시지를 다시 보낼 수 있다. at-least-once 이며 유실보다 중복이 낫다는 설계와 일치. 이전부터 있던 하위 계층 재시도에 상위 재시도가 곱해져 최대 시도가 2×3=6 회로 늘었다는 점만 알려 둔다.
- [23:30] info — 같은 라우트의 「연속 실패 알림」 전송(`holdings-premarket/route.ts` L262)은 여전히 재시도 없이 1회 `dispatchAlert` 다. 설계가 요구한 범위(공시 알림)는 아니므로 지적이 아니라 후속 후보로만 적는다.
- [23:30] info — 실행 간 영속 재전송 없음: 3회 모두 같은 네트워크 단절 아래에서 실패하면 공시는 여전히 영구 유실(식별자 로그로 사람이 복구). Developer가 이를 명시했고 설계도 범위 밖으로 정했으므로 결함 아님. 다만 로그가 pm2 로그 파일에만 남고 앱 홈 「데이터 이상」에는 `alert_undelivered=N` 만 보인다 — 사용자가 `HP_ALERT_UNDELIVERED` 를 grep 해야 한다는 안내를 배포 보고에 넣을 것.
- [23:30] 로그 노출 검토(WP-2): `lastError`(최대 300자)는 `dispatchAlert` 의 `failed[].error` 로, 텔레그램은 `redactSecrets(msg, token)`·cause errors 도 redact 후 조립(`telegram.ts` L100·L107·L113-L114), 슬랙·`index.ts` L60 도 redact. `HP_ALERT_UNDELIVERED` 줄은 심볼·양식·접수번호·SEC URL 뿐(공개 식별자, 제어문자 제거·길이 제한). 비밀값 경로 없음. 보유 심볼이 pm2 로그에 남는 점은 단일 사용자 앱·기존 알림 본문과 같은 수준이라 info.
- [23:30] 의도 검증 WP-3(충족): `describeErrorCause` 는 cause 사슬 4단·`errors` 6개·순환 방지(Set)를 갖고 비 Error 는 `thrown=<typeof>`. 마스킹: `redactSecrets`(텔레그램 `bot<id>:<token>`·슬랙 웹훅) + URL 쿼리 `?…` 통째 가림 + 제어문자 제거 + 160자 제한을 redact 이후 자르기 순서로 적용해 토큰이 잘려 노출되는 틈이 없다. KIS appkey/appsecret 은 undici 연결 오류의 cause 에 들어가지 않는 구조(헤더·본문은 오류 객체에 안 담김)이며 쿼리스트링 가림이 방어선이다. 응답 `NextResponse.json({ok:false,error},{status:500})` 와 `error` 변수(기존 e.message)는 불변 — diff 확인. 보정 여지: `describeErrorCause(e)` 호출이 호출부 비밀 문자열을 넘기지 않으므로 KIS 키를 아는 문자열로 가리지는 못한다(info — 현재 노출 경로 없음).
- [23:30] 경계 시험 `isolation.test.ts` 허용 목록 확대(정당, 약화 아님): 추가된 것은 `@/lib/notify/send-retry` 하나이고, 이미 허용된 `@/lib/notify` 의 알림 영역을 얇게 감싼 모듈이다. 같은 시험이 send-retry 의 import 가 `import type { AlertDispatch } from @/lib/notify` 하나뿐이고 동적 import·`require`·`fetch(` 가 없음을 고정해 오히려 이 라우트의 우회 표면을 줄였다. 라우트의 corp-intel·exchanges·safety 등 금지 prefix 검사는 그대로다. 헬퍼를 라우트 폴더에서 `lib/notify` 로 옮겨 다른 경계 시험 3건을 깨뜨리지 않은 판단도 적절하다.
- [23:30] SAFETY_PATHS 의견(목록 변경은 이번 범위 밖): `send-retry.ts` 는 알림 유실·중복을 정하는 코드이고 주문·자금 경로가 아니다 → 위험도 중간 이하. 더 신경 쓸 곳은 `result.ts` 다 — 이 파일의 `redactSecrets` 는 모든 알림·로그 경로의 비밀 마스킹을 맡는데 감시 밖이라, 이후 한 줄 수정이 독립 감사 없이 토큰 노출로 이어질 수 있다(현재 변경은 추가만이라 안전). 같은 디렉토리 `telegram-api.ts` 는 이미 감시 중이므로 일관성도 낮다. 권고: 후속 task 에서 `^src/lib/notify/result\.ts$`·`send-retry.ts`(+ 각 시험)를 후보로 올릴 것. 이번 diff 의 감시 대상(instrumentation·cron 라우트·시험)은 이 Reviewer 판정 scope 에 모두 넣었다.
- [23:30] 정정·정직성 확인: Developer 의 WP-3 「runAll 을 멈춘 호출 후보」(시총 랭킹 `kisFetch` 예외 무처리)는 [가능성 높음]으로 적혔고 나는 코드 경로를 재추적하지 않았다(범위 밖 후속 후보). 12:11 실패가 WP-1 기전이 아닐 가능성이 높다는 Developer 판단 — 즉 이번 변경이 그 증상을 고치지 않고 진단 로그만 추가한다는 점 — 은 Leader 보고에 분명히 해야 한다.
- [23:30] **최종 판정: PASS (scope: src/instrumentation.ts, src/lib/notify/send-retry.ts, src/lib/notify/result.ts, src/lib/notify/telegram.ts, src/app/api/cron/holdings-premarket/route.ts, src/app/api/cron/strategy-eval/route.ts, src/__tests__/instrumentation-shape.test.ts, src/app/api/cron/holdings-premarket/__tests__/route.test.ts, src/app/api/cron/__tests__/strategy-eval-error-log.test.ts, src/lib/corp-intel/__tests__/isolation.test.ts, src/lib/notify/__tests__/send-retry.test.ts, src/lib/notify/__tests__/describe-error-cause.test.ts)**

## Judge

- [23:0x] intake(jev-1.13.0, dev-rules@0.5.0) 2회 실행 — 공통: task_type `ops` · risk **R2**(규칙 덮어쓰기 `R2-deploy`, `ecosystem.config.js` 경로) · developer_model **opus** · demo **none**(ui_change none 0.99) · fallback 없음.
  - 1회차: complexity 1.52 · needs_info false(noul 0.58) · next `assign`.
  - 2회차: complexity 1.54 · needs_info true(noul 0.60) · next `ask_user` · blocking_gate `requirements`. 결과 파일(Mac scratch) `judge/judge-task-175-intake.out.json`.
  - **Leader 결정**: 1회차(`assign`) 채택. needs_info 는 임계 근처 흔들림이고, 요구 사항은 이 이력서 「설계」 절에 확정돼 있다(사용자 질문 필요 사항 없음). 데모 게이트 대상 아님(화면 변경 0).

- [23:1x] C1 codex_gate — `codex_required=false` · `budget_rule=CX-limit-unknown-r2` · switch `on` · design_uncertainty 1.03. ⚠ 한도 값을 얻지 못한 상태의 판정이다(`codex-review.sh limit` = null/`stale`, 관측 2026-09-27). Codex 검토는 **미실행**(판정상 불요) — 실패가 아니다. 결과 파일(Mac scratch) `judge/judge-task-175-c1.out.json`.

- [23:4x] C2 codex_gate — `codex_required=true` · `mode=adversarial-review` · `focus=concurrency` · `budget_rule=CX-limit-unknown-r2`(한도 null/`stale`). 결과 파일(Mac scratch) `judge/judge-task-175-c2.out.json`.
- [23:4x] **Codex C2 검토 incomplete — 실행 불가(작업은 계속 진행).** 서버 Codex CLI 0.157.1 + `~/.codex/config.toml` `model = "gpt-6.1-sol"` 을 계정이 거부한다(HTTP 400 `model_not_found`, 23:4x 코드 없이 한 줄 프롬프트로 재확인 — 11-15 T-170·T-173 과 같은 원인). 설정·CLI 갱신은 사용자 결정 대기 항목이라 건드리지 않았다. Codex 외부 반증은 **0건 수행** — focus(동시성)는 Reviewer 항목 2(5초 상한 시도 위 비중첩·unhandled rejection 없음)가 사람 쪽으로만 확인한 상태다.

## QA
- [23:38] 환경: 서버 worktree `~/.node-local/stockinvest-t175`(HEAD 959871d = origin/main, 미커밋 변경), node v24.22.2. Mac 공유 트리는 쓰지 않았다. 코드·커밋·push·pm2·운영 DB·`/api/cron/*` 호출 없음.
- [23:38] 1 대상 시험 6개 실행(`flock /tmp/stockinvest-heavy-tests.lock nice -n 10 node ./node_modules/jest/bin/jest.js <6 files>`, 로그 `~/.node-local/t175-logs/qa-targeted.log`): Suites 5/6 통과, Tests 111/112 통과. 실패 1건 = `src/lib/corp-intel/__tests__/isolation.test.ts` 의 「src → corp-intel 참조는 허용 목록뿐 › 🔴 corp-intel·ci_raw_item·ci_capture_ …」. 원인: `lib/analysis-data/capture-operating-data.ts`·`lib/strategy/m40/operating-evidence.ts`(및 각 시험)가 허용 목록 밖. base 959871d 를 임시 worktree 에서 같은 파일만 실행해 동일하게 실패(1 failed, 37 passed) 확인 → 기존 실패, T-175 회귀 아님. 임시 worktree 는 제거했다.
- [23:38] 2 전체 jest(`--json`, 로그 `~/.node-local/t175-logs/qa-full.log`, 종료 1): Suites 27 failed · 7 skipped · 443 passed (470/477), Tests 416 failed · 286 skipped · 12275 passed (12977). 실패 416건을 Developer 기준선 `~/.node-local/t175-logs/fail-before.txt`(416줄)와 「파일 :: 전체 이름」 단위로 대조: 신규 실패 0, 해소 0. assertion 없이 suite 만 실패한 경우 0. 기준선 자체를 base 에서 전체 재실행하지는 않았다(기준선은 Developer 산출물을 신뢰; base 재실행은 위 1번의 단건 시험뿐).
- [23:38] 2b `tsc --noEmit` 종료 코드 0 (`~/.node-local/t175-logs/qa-tsc.log`).
- [23:38] 3 WP-1 실측: 서버 node 로 매번 새 Agent(= 새 연결) 60회씩, 대상 `https://api.telegram.org/` 루트·토큰 없음, 스크립트 `~/.node-local/t175-he-probe4.mjs`. 기본 250ms: 1차 ok 43 / fail 17(ETIMEDOUT 17), 2차 ok 44 / fail 16(ETIMEDOUT 16). 2000ms: ok 60 / fail 0. 빌드: `.next/server/instrumentation.js` 에 `setDefaultAutoSelectFamilyAttemptTimeout(2e3)` 존재, `.next/server/edge-instrumentation.js` 의 register 는 빈 함수(설정 없음). `.map` 에 소스 문자열이 보이는 것은 소스맵이라 실행 코드가 아니다. build_exit=0(`build-after.log`, 빌드 23:24 > 소스 최종 수정 23:20 확인, 재빌드 안 함). 미검증: 실제 pm2 웹 프로세스에 2000 값이 기동 후 적용되는지는 배포 뒤에야 확인된다.
- [23:38] 4 안전장치 회귀: `git diff --name-only 959871d` 에 `src/lib/safety/`·`src/lib/exchanges/`·주문 라우트·`dry-run.ts`·`scripts/cron-runner.sh` 없음. 변경 파일은 10개(ecosystem 주석 · package 2 · instrumentation · notify 3 · cron 라우트 2 · 시험 3 + 신규 3). `ecosystem.config.js` 는 주석만 바뀌고 NODE_OPTIONS 줄은 불변. strategy-eval 실패 응답 `{ok:false,error}`+500 은 diff 에서 불변. holdings-premarket diff 는 5개 hunk 모두 알림·로그 구간이고 응답 구성 hunk 는 없다. 라우트 시험(9건 이상) 통과.
- [23:38] 5 엣지(시험 대응): ① 첫 시도 성공 1회 — send-retry 「첫 시도 성공」·route 「첫 시도 성공 → 1회만」. ② 2번째 성공 — send-retry 「첫 시도 실패 → 2초 뒤 재시도 성공」·route 「2초 뒤 재시도로 전달 → ok·alerted 1·미전달 로그 없음」. ③ 전부 실패 — send-retry 「3회(간격 2·5초) 후 failed」·route 「끝내 실패 → 3회 · 503 failed(alert_undelivered=1) · 식별자 로그」. ④ 5초 상한 뒤 늦게 성공 — send-retry 「상한 뒤 늦게 전달 → 성공, 다시 보내지 않는다」·「늦게 실패 → 그때 바로 재시도」·「다음 간격에도 없으면 unresolved, 1회만」. ⑤ 시간 예산 — send-retry 「첫 시도 전에 예산 없으면 0회」·「예산 넘는 경우 budget」·route 「55초를 넘기면 새 시도 안 함」. 빈 곳: ④ 는 라우트 수준 시험이 없고 단위 수준만 있다(지적, Low).
- [23:38] 5b 로그 비밀값: describe-error-cause 시험이 봇 토큰 패턴·호출부 비밀 문자열·URL 쿼리스트링·제어문자를 덮는다(80·89·96행). 발송 계층(telegram.ts) 오류는 redactSecrets 를 거친다. 지적(Low): send-retry.ts `settle()` 은 발송 함수가 **던진** 예외의 e.message 를 가공 없이 lastError 로 넘겨 holdings-premarket 로그(`last=`)에 찍는다. 현재 dispatchVia 가 채널 예외를 잡아 실패 목록으로 바꾸므로 던지는 경로는 getChannel(DB 조회) 쪽뿐이라 노출 가능성은 낮다. 시험이 이 경로를 덮지 않는다.
- [23:38] 6 버전: package.json 0.14.0 → 0.15.0, package-lock.json 은 루트 `version`·`packages[""].version` 두 줄만 변경(git diff 로 확인). 다른 의존성 변화 없음.
- [23:38] 미실행·미검증: Codex C2 미실행(서버 CLI 모델 거부 — Leader 보고 사항). 운영 pm2 적용 값·실제 텔레그램 발송·`/api/cron` 호출은 금지 범위라 미실행. 전체 기준선의 base 재실행은 미수행.
- [23:38] 정리: 임시 worktree `stockinvest-t175-qa-base` 와 node_modules 심볼릭 링크 제거(`git worktree list` 확인). 시험 로그 `~/.node-local/t175-logs/qa-*.log`·`qa-tsc.log` 는 남기고, 큰 JSON `qa-full.json` 은 삭제했다.
- [23:38] 판정 근거: 신규 실패 0, 안전장치 파일 회귀 0, 응답 형식 변경 0, 기존 실패 1건은 base 에도 존재. 실측 WP-1 은 0/60 대 16~17/60 으로 재현 가능. 지적 2건(Low)은 시험 보강 권고.
QA 판정: pass

## 배포 기록

## 실행 도구·절차 이력

| event | 시각 | 종류 | 도구 / 절차 | 범위 | 근거 |
|---|---|---|---|---|---|
| E1 | 2026-11-18 22:5x | start | claude / claude_standard | 조사·설계부터 구현·감사·QA·커밋까지(push 제외) | 사용자 「재발 방지 착수」 |

## 최종 요약

### [T-175] 외부 접속이 0.25초에 끊기던 문제 완화 + 공시 알림 재시도 + 장중 평가 실패 원인 기록

- **상태**: 구현·Reviewer PASS(critical·high·medium 0, low 2)·QA pass 완료, 서버 worktree 커밋. **운영 배포(push)는 사용자 승인 대기.**
- **무엇이 바뀌었나**
  - **WP-1 (텔레그램 등 외부 접속 끊김 완화)**: 운영 웹 프로세스가 외부 서버에 연결할 때 IPv4 연결을 기다리는 시간을 0.25초(Node 기본)에서 **2초**로 늘렸다(`src/instrumentation.ts`). 이 서버는 IPv6 경로가 없어서, 텔레그램처럼 연결에 0.23~0.27초가 걸리는 곳은 0.25초를 넘기면 끊고 IPv6로 갔다가 실패했다. 실측(새 연결 60회씩): 기본값 16~17회 실패 → 2초 0회. Developer 측정 180회 기준으로는 30% → 1.7% — **없앤 것이 아니라 크게 줄인 것이다.** 남는 실패는 아래 재시도가 받친다.
  - **WP-2 (보유 종목 개장 전 공시 알림)**: 전송에 실패하면 2초·5초 간격으로 최대 3회까지 다시 보낸다. 끝내 못 보내면 `HP_ALERT_UNDELIVERED` 로그 한 줄(종목·양식·접수번호·SEC 링크)을 남겨 사람이 확인할 수 있다. 같은 알림이 두 번 갈 수는 있다(텔레그램이 받았는데 응답만 끊긴 경우 — 유실보다 중복을 택했다).
  - **WP-3 (장중 전략 평가 실패)**: 실패 로그에 원인 코드·주소를 남긴다(토큰·쿼리스트링은 가림). 응답 형식·HTTP 500 은 그대로.
  - 낡은 주석 2곳(`telegram.ts`·`ecosystem.config.js` — 「IPv4 실패 시 IPv6 로 폴백하니 안전」)을 사실대로 고쳤다. 웹 버전 0.14.0 → **0.15.0**. 화면·DB·앱(APK) 변경 없음.
- **배포**: 미배포 — push 가 곧 운영 blue/green 배포라 사용자 승인 후. 같은 배포에 실릴 다른 작업: 없음(origin/main `959871d` 위에 이 커밋만).
- **실매매 영향**: 주문·청산·안전장치·거래소 코드와 cron 러너는 바뀌지 않았다(QA 가 diff 로 확인). KIS 는 IPv4 주소 하나뿐이라 WP-1 의 영향을 받지 않는다. 연결 대기 상향은 IPv4 가 정말 죽었을 때만 IPv6 전환을 최대 2초 늦춘다(이 서버는 IPv6 가 원래 안 된다).
- **AI 가 검증한 것**: 새 시험 45건 · 전체 jest 실패 416건이 변경 전과 이름까지 같음(새 실패 0) · `tsc` 0 · `next build` 0 · 빌드 산출물에서 설정이 nodejs 쪽에만 들어감 · 서버 node 로 실제 텔레그램 연결 실측.
  - 검증 못 한 것: 운영 pm2 웹 프로세스에서 실제로 2초가 적용되는지(배포 후 확인) · 배포 후 텔레그램 실패 빈도 감소 · 다른 외부 호스트(SEC 등)의 연결 시간 · **Codex C2 외부 검토(판정상 필요했으나 서버 Codex 모델 설정 거부로 실행 불가 — incomplete)** · lint(프로젝트에 ESLint 설정 없음).
- **👉 사용자가 확인할 것** (배포 후): 앱 홈 「데이터 이상·분석 실패」에 「보유 종목 개장 전 공시 확인 실패」가 다시 뜨는지. 뜨면 운영 로그에서 `HP_ALERT_UNDELIVERED` 줄로 놓친 공시를 찾을 수 있다. AI 는 배포 직후와 다음 날 텔레그램 실패 건수를 읽기 전용으로 확인한다.
- **👉 사용자가 결정할 것**
  1. **push(운영 배포) 승인** — 권고: 승인. 장외 시간 권장(평가·공시 확인 틱을 피해서).
  2. 서버 Codex 설정(모델 값 또는 CLI 0.157.1 갱신) — 이번 C2 도 이것 때문에 못 돌았다. 권고: CLI 갱신 먼저.
- **남은 일 (후속 후보, 이번 범위 밖)**
  - **12:11 장중 평가 실패의 진짜 원인**: KIS 「국내 시가총액 순위」 조회 1건이 0.038초 만에 네트워크 오류를 냈는데(운영 `api-usage` 기록), `refreshUniverse` 경로에 오류 처리가 없어 평가 한 회차 전체가 멈췄다(`src/lib/strategy/universe.ts:191` → `runMarket`). WP-1 로는 막히지 않는다 — 별 task 권고.
  - 실행 간 영속 재전송(다음 틱·다음 날 다시 보내기) — 상태 저장소(DDL) 필요.
  - 같은 라우트의 「연속 실패 알림」 전송은 아직 재시도 없음.
  - 커밋 훅 감시 목록에 `src/lib/notify/result.ts`(전 알림·로그의 비밀 가림)·`send-retry.ts` 추가 검토(Reviewer 의견).
  - 11-18 22:01 놓친 공시: `NAS:NVDA` 8-K https://www.sec.gov/Archives/edgar/data/1045810/000104581026000088/nvda-20261117.htm (다시 보내지지 않는다).
- **이슈·위험**: Low 2건(위 「잔여 실패 1.7%」·「중복 가능」). QA Low 2건 — `send-retry.ts` 가 발송 함수 예외 문구를 가공 없이 로그로 넘긴다(현재는 상위에서 이미 걸러져 노출 가능성 낮음, 시험 없음) · 5초 상한 뒤 늦게 성공하는 경우는 단위 시험만 있다.

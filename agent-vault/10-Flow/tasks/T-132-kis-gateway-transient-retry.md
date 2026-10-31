---
task_id: T-132
title: KIS 게이트웨이 일시 오류(EGW00300·OPSQ1002 SESSION FULL)에 잔고·예수금 조회가 1회 실패로 끝나는 문제 — 일시 실패 재시도 + 업무실패(rt_cd≠0) 명시 실패
status: ready-to-deploy
priority: high
project: StockInvest
created: 2026-10-31
updated: 2026-10-31
base_ref: origin/main ec6723c
risk_level: R2
roles_involved: [leader, developer, reviewer, qa]
related_tasks: [T-012-balances-partial-failure, T-017-kis-http-gateway, T-056-cash-separation]
tags:
  - type/task
  - domain/safety
  - domain/exchange
aliases:
  - 게이트웨이일시오류재시도
---

# T-132 KIS 게이트웨이 일시 오류 — 잔고·예수금 조회 재시도

사용자 보고(2026-10-31 10:30 텔레그램): `⚠️ 포트폴리오 스냅샷 건너뜀 — 잔고 부분 실패 / domestic(KIS getBalances: 500 … EGW00300 Gateway 라우팅 오류)`.

## 측정 (읽기 전용, 2026-10-31 10:45~10:50 KST)

근거는 운영 로그 전수(`/home/brownjeon/apps/stockinvest/shared/logs/`)와 `api-usage-*.jsonl`.

| 항목 | 실측 |
|---|---|
| 오늘 KIS 실패율 | **12.5%** (54/431) — 10-26·29 0.8%, 10-30 1.3%, 10-25(일) 0.0% |
| 오류 2종 | `EGW00300 Gateway 라우팅 오류`(HTTP 500) 09:25~10:43 · `OPSQ1002 SESSION FULL`(HTTP **200** + `rt_cd=9`) 09:23~10:49 |
| 과거 발생 | 두 코드 모두 로그 전체(2026-09-19~)에서 **오늘 이전 0건** |
| 오늘 배포 | 05:20(릴리스 `20261031-052042`) — 오류 시작은 4시간 뒤, 09:00~09:23 은 전부 정상 |
| 동시호출 상관 | 실패 시점 ±1초 동시호출 **2~3건**, 성공은 7~9건에 몰림 → 우리 유량·레이트리밋 문제 **아님** |
| 일시성 | `10:30:08 FAIL` / `10:30:09 OK` (같은 TR·URL, 1초 차). 실패 응답 지연 20~60ms = 게이트웨이 즉시 거절 |
| 영향 | 스냅샷 2회 건너뜀(09:29·10:30, `job_run_log.degraded_reason=skip:balances_incomplete`) · 그 틱 주문 한도 0(신규 매수 차단) · 오늘은 토요일(양 시장 휴장)이라 그 밖 영향 없음 |

**원인 판정 [확실]**: KIS 서버 측 일시 장애(게이트웨이 라우팅 + 세션 풀 포화). 우리 코드·배포·유량이 원인이 아니다.

## 우리 쪽 결함 (KIS 가 복구돼도 남는다)

1. **잔고·예수금 조회에 일시 5xx 재시도가 없다.** `getTicker` 는 500 을 2회 재시도하는데(`kis-domestic.ts:73`) `getBalances`·`getUsdCash` 는 1회 실패로 끝난다. 오늘 실패 직후 1~2분 내 다음 호출은 거의 전부 성공했고 10:30 은 1초 뒤 성공했다 — 짧은 재시도 하나로 대부분 흡수된다.
2. **HTTP 200 + `rt_cd≠'0'` 를 성공으로 취급한다.** `domestic.getBalances` 는 예수금(output2) 없는 잔고를, `overseas.fetchBalancesForExchange` 는 **빈 보유 목록**(`data.output1 ?? []`)을 정상 응답으로 돌려준다. 해외 쪽은 총액이 조용히 축소돼 T-012 가 막으려던 계열의 오염이다(4단 sanity guard `checkHoldingVanished` 가 마지막 방어선으로 막지만, 그 결과는 "거부=실명"이다). `getUsdCash` 는 파서가 이미 `rt_cd≠'0'` 를 거부한다(`parseUsdCashFromPresentBalance`).
   - 평시 영향 0: HTTP200 업무실패는 10-27·29 42건/일, 10-30 40건이 **전부 `domestic.market-cap-ranking`** 이고 잔고·예수금 계열은 0건이다(오늘만 17건).

## 변경 (WP)

- **WP1 `src/lib/exchanges/kis-http.ts`** — `kisFetch` 에 옵트인 옵션 `transientRetries`(기본 0 — T-017 doctrine 유지). 레이트리밋이 **아닌** 실패(HTTP≥500 또는 `rt_cd≠'0'`)만 백오프 후 재시도. 🔴 **읽기 전용 조회에만 쓴다** — 주문 송신에 켜면 중복 주문 위험.
- **WP2 `src/lib/exchanges/kis-domestic.ts`** — `getBalances` 에 `transientRetries: 2`, HTTP200+`rt_cd≠'0'` 명시 실패(본문 `msg_cd`·`msg1` 포함).
- **WP3 `src/lib/exchanges/kis-overseas.ts`** — `fetchBalancesForExchange`·`getUsdCash` 에 같은 처리.
- **WP4 시험** — `kis-http.test.ts`(옵션 동작·기본 0·레이트리밋과 예산 분리·주문 경로 미적용) · 어댑터 업무실패 던짐.

## 하지 않는 것

- 시세(`getTicker`)·`market-cap-ranking`·주문·원장 경로는 건드리지 않는다(아래 후속 후보).
- 알림 임계·스로틀, 스냅샷 건너뛰기 정책(T-012 결정), sanity guard 4단, cron 스케줄 변경 없음.
- `scripts/cron-runner.sh` 는 다른 세션 T-127·T-131 범위라 손대지 않는다.

## 중복 점검 (다른 세션)

`메뉴화면개편` 세션이 같은 저장소에서 T-126·T-127·T-128·T-130·T-131 을 진행 중. 그 범위는 `engine.ts`(청산)·`job-run-log`/`judgment-recorder`·설정 화면·`analysis-runs.ts`·`cron-runner.sh` 이고 **`src/lib/exchanges/` 는 포함되지 않는다**(T-131 후보 19개 항목 확인). 작업트리 미커밋 파일도 vault 문서·mockups·`.codex/` 뿐 — 겹침 없음.

## 후속 후보 (이 task 범위 밖)

- **`portfolio-total.ts` `fallbackFor` 의 직전 정상값에 나이 상한이 없다** — 기존 결함(주석에 R5 범위 밖으로 표시). 몇 시간 묵은 평가액이 주문 한도 계산에 쓰일 수 있다. Reviewer M-2 에서 드러났고 이 task 가 만든 문제는 아니다.
- `getTicker` 는 HTTP200+`rt_cd=9` 를 재시도하지 않고 "no output" 으로 던진다(조용한 오염은 아님). 같은 재시도를 줄지 여부.
- `domestic.market-cap-ranking` 의 업무실패 42건/일 — 정상인지 미확인(본문 미기록).
- 10-30 `403` 111건(KIS) 미조사.
- (Reviewer L-4) `scripts/cron-runner.sh` 시간 예산 주석에 "잔고 조회 실패 시 호출당 +2초(최대 4초)" 반영 — 그 파일은 다른 세션(T-127·T-131) 범위라 이번에 손대지 않았다. 필요하면 잔고 3곳에 `timeoutMs` 명시.
- (Reviewer I-1) 해외 `inquire-balance` 가 **보유 0건**에서 `rt_cd='0'` 을 주는지 실증이 없다(국내는 10-24~10-28 보유 0건에서 업무실패 0건으로 확인됨). 만약 `rt_cd≠0` 이면 해외 전량 청산 후 잔고가 영구 fail-closed 로 굳는다. 해외 전량 매도 직후 첫 틱에 `overseas.get-balances` 의 `err:other` 유무를 확인한다.

## 진행 기록

- [2026-10-31 10:50] 접수·측정 완료(메인 세션이 Leader 겸). 원인은 KIS 측, 우리 쪽 결함 2개 확정.

## Developer

- [10:52] 구현 완료(메인 세션이 Developer 겸 — 서브에이전트 미사용). 변경 4파일.
  - `src/lib/exchanges/kis-http.ts` — 헤더 문서에 「§일시 실패 재시도」 절, 옵션 `transientRetries`(기본 0), 판정 함수 `isTransientKisFailure(status, body)`(export — 시험용), 루프에 일시 실패 분기. 레이트리밋 회차(`attempt`)와 일시 회차(`transientAttempt`)를 **따로** 세고, 레이트리밋 응답은 일시 분기에 **닿지 않는다**(소진 시 그 분기 안에서 return). `kisAttempts` 는 실제 HTTP 시도 수(`tries`)를 센다 — 레이트리밋 전용 경로에서는 종전 값과 같다.
  - `src/lib/exchanges/kis-domestic.ts:233` — `getBalances` 에 `transientRetries: 2`. `res.json()` 직후 `rt_cd≠'0'` 이면 `msg_cd`·`msg1` 을 실어 throw.
  - `src/lib/exchanges/kis-overseas.ts:631·448` — `fetchBalancesForExchange` 에 같은 처리(여기는 `data.output1 ?? []` 가 업무 실패를 「보유 없음」으로 바꿔 놓던 자리), `getUsdCash` 는 재시도만(파서가 이미 `rt_cd≠'0'` 거부).
  - 시험 — `__tests__/kis-http.test.ts` 에 `transientRetries` 계약 9건(기본 0 회귀·중간 성공·SESSION FULL·소진·정상 무재시도·레이트리밋 예산 분리·403 EGW00133·음수) + `isTransientKisFailure` 표 6건. 새 파일 `__tests__/kis-balances-business-failure.test.ts` — 국내·해외 업무실패 던짐·정상 회귀·`rt_cd` 없는 응답 보존 + **정적 울타리**(`transientRetries` 는 읽기 라벨 3곳만, 주문·취소 경로 금지).
- [10:55] 실행 증빙(서버 `ssh home_ubuntu`, `flock /tmp/stockinvest-heavy-tests.lock`):
  - `npm run typecheck` → **통과**(exit 0).
  - `npm test` 교환 계층 11파일 → 처음 2건 실패. 원인은 **시험 하네스**였다 — `mockResolvedValue(res(...))` 로 Response 한 객체를 재사용해 2회차부터 본문이 `''` 가 되어 레이트리밋 판정이 풀렸다(구현 결함 아님, 운영에서는 호출마다 새 Response). 같은 파일의 기존 다회 호출 시험과 같은 `mockImplementation(async () => res(...))` 로 고침.
  - 재실행 `kis-http.test.ts` + `kis-balances-business-failure.test.ts` → **44/44 통과**(exit 0). 그 전 전체 교환 계층 실행에서 나머지 10파일 203건 통과.
- 미실행: `npm run lint`, 교환 계층 밖 전체 시험(Reviewer·QA 가 범위를 정해 재실행).

- [11:25] **Reviewer 지적 반영 (라운드 2)** — M-1·L-3·L-5·L-6 을 고쳤다. M-2 는 Leader 결정으로 수용(아래).
  - M-1 ① `kis-http.ts` — `kisFetch` 진입부에 **멱등성 런타임 울타리**: `transientRetries>0` 인데 `init.method` 가 GET 이 아니면 **요청을 보내기 전에** throw. 주문·취소는 POST 라 구조적으로 차단된다.
  - M-1 ② `__tests__/kis-order-priority.test.ts` — 주문·취소 4건에 `expect(optsOf(0).transientRetries ?? 0).toBe(0)` 추가(줄 스캔이 아니라 **실제 호출 옵션**이라 스프레드 우회에도 뚫리지 않는다). 헤더 문서에 계약 한 줄.
  - M-1 ③ `__tests__/kis-balances-business-failure.test.ts` — 정적 울타리를 **교환 계층 디렉터리 전체 스캔**(`kis-http.ts`·시험 제외)으로 넓히고, 항상 통과하던 빈 시험("주문·취소 경로에는 없다")을 "허용 라벨 3개가 각각 정확히 한 번"으로 바꿨다. 실패 시 파일:줄이 보이게 단언.
  - L-3 `kis-http.ts` — `TOKEN_ERROR_PATTERN`(`EGW00121|EGW00123|만료된 token`)을 일시 실패에서 제외. 토큰 만료는 재시도가 아니라 호출부의 재발급이 답이다.
  - L-5 신규 `__tests__/kis-balances-transient-recovery.test.ts` — `kisFetch` 를 모킹하지 않고 `global.fetch` 만 바꿔 **어댑터↔실제 kisFetch 연결**을 검증한다(국내·해외 각각: 500 뒤 복구 · SESSION FULL 2회 뒤 복구 · 계속 실패하면 던짐 · 토큰 만료는 재발급 경로로 간다).
  - L-6 `kis-http.ts` — 재시도 뒤 결과에 `일시 실패 재시도 성공|소진` 한 줄. 재시도가 구해 준 호출 수를 사후에 셀 수 있게.
  - L-4(cron-runner 시간 예산 주석)·I-1(해외 빈 보유 `rt_cd`)은 **반영하지 않았다** — 전자는 다른 세션(T-127·T-131) 범위 파일이고 후자는 운영 관찰 항목이다. 아래 후속 후보에 남긴다.
- [11:30] 라운드 2 증빙(서버, flock 직렬): `npm run typecheck` exit 0 · jest `src/lib/exchanges/__tests__/` + `portfolio-total-dedup` + `portfolio-partial-balances` → **25스위트 629건 전부 통과** exit 0.

- [11:45] **라운드 3 — 재감사 지적 반영.** N-1·I-2·I-3·L-5b·위생을 고쳤다(파일은 scope 안 그대로).
  - N-1 `kis-http.ts` — 재시도 요약 줄의 성공 판정을 `res.ok` 에서 `res.ok && !isTransientKisFailure(res.status, body)` 로. HTTP200 `SESSION FULL` 로 **소진**된 호출이 "성공" 으로 집계되던 오류. 시험 3건 추가(500 뒤 복구=성공 · SESSION FULL ×3=소진이며 "성공" 문구 없음 · 재시도 안 한 호출엔 요약 줄 없음).
  - I-2 `kis-http.ts` — `MAX_TRANSIENT_RETRIES = 5` 클램프. 호출부는 전부 2 지만 큰 값이 들어와 장애 중 한 호출이 수십 번 때리는 일을 구조로 막는다. 시험 1건(50 을 넘겨도 총 6회).
  - I-3 `kis-http.ts` — 헤더 문서의 "그 틱의 주문 한도가 0 이 됐다" 를 정정(예수금 실패 틱에서만 0, 보유 조회만 실패하면 직전 정상값으로 계산).
  - L-5b `__tests__/kis-balances-transient-recovery.test.ts` — `getUsdCash` 종단 시험 3건 추가(500 뒤 복구 · SESSION FULL 2회 뒤 복구 · 계속 실패 시 `UsdCashUnavailableError`). 실측 픽스처 `fixtures/ctrp6504r-closed-20261020.json` 을 쓰므로 환율 모킹을 기존 T-056 시험과 같은 1332.1 로 맞추고, 해외 보유 단가 단언을 `toBeCloseTo` 로 바꿨다(부동소수 등가 비교 회피).
  - 위생 — 이 파일의 소제목에서 "Reviewer" 낱말 제거(훅 `reviewer_body()` 가 그 낱말이 든 헤딩을 Reviewer 섹션으로 읽어, 폐기된 판정이 되살아날 수 있는 모양이었다).
  - 반영 안 함: "재시도 시작" 로그 줄 제거(선택 사항 — 진행 중 진단에 쓸 수 있어 남김).
- [11:48] 라운드 3 증빙(서버, flock 직렬): `npm run typecheck` exit 0 · jest `src/lib/exchanges/__tests__/` + `src/lib/safety/__tests__/` + `portfolio-partial-balances` → **62스위트 통과·1 skip, 1675건 통과·14 skip** exit 0.

- [11:55] **라운드 3b — 주석·픽스처 정정(동작 변경 0).** 재감사 Info 3건.
  - I-4 — 복구 시험의 환율 상수 주석이 **사실과 달랐다.** 내가 "픽스처 정합 검사(output3↔output2)가 환율에 걸린다" 고 적었지만 `getUsdCash` 는 환율을 부르지 않는다(감사가 환율 모킹 없이 같은 픽스처로 통과하는 것을 확인). 진짜 이유로 바꿔 적었다 — 단가 100×1400=140,000 은 **환율을 상수로 고정한 변이도 같은 값**이라 시험이 그걸 못 잡았다.
  - I-5 — 같은 이유로 해외 보유 단가 픽스처를 `'100'` → `'123.45'`(소수 곱)로. 정수 곱이면 반올림 변이를 못 잡는다.
  - I-3 잔여 — `kis-http.ts` 헤더 문서에 "직전 틱이 `unknown` 판정으로 그 값을 지우지 않았다면" 조건을 붙였다(`portfolio-total.ts:174` 가 `lastOk` 를 지운다).
  - 코드 동작은 바뀌지 않았다(주석 2곳 + 시험 픽스처 상수 1개).

### Leader 결정 — M-2 (정책 경계 이동) 수용

[확실] 변경 전에는 **같은 KIS 장애가 응답 모양에 따라 다르게 처리**됐다 — HTTP 500 은 `balances_failed` → 직전 정상값 폴백, HTTP 200+`rt_cd≠0` 은 예수금 행 누락 → `krw_cash_unknown` → 한도 0. 뒤쪽이 더 보수적이지만, 그것은 **설계가 아니라 사고**였다(업무 실패를 성공으로 통과시킨 결과로 우연히 보수적이 된 것). 두 모양을 같게 만드는 것이 맞다고 판단해 수용한다.

- 근거: 폴백은 국내 잔고 HTTP500 하루 18~23건으로 **이미 매일 쓰이는 기존 정책**이고(R5 로 범위 밖 표시), 한도는 평가액×pct 라 몇 시간 묵은 평가액의 오차는 작다. 반대로 `rt_cd≠0` 을 통과시키면 해외에서 **빈 보유 목록**이 정상으로 흘러 총액이 축소된다 — 이쪽이 자금에 더 가까운 위험이다.
- 남는 것: `fallbackFor` 의 **나이 상한 없음**은 이 task 가 만든 문제가 아니라 기존 결함이다. 후속 후보로 올린다(아래).
- 사용자가 더 보수적인 쪽(업무 실패 시 한도 0)을 원하면 되돌릴 수 있다 — 되돌림 지점은 `portfolio-total.ts` 의 `fallbackFor` 이고, 어댑터의 throw 는 유지해야 한다(스냅샷·엔진 쪽 효과가 거기서 온다).

### 측정 정정 (감사 M-2 부수 지적)

task 본문과 사용자 보고의 "그 틱 주문 한도 0(신규 매수 차단)"은 **HTTP 500 경로에서는 사실과 다르다**. 프로세스가 한 번이라도 정상 평가액을 받았으면 한도는 0 이 아니라 직전 값으로 계산된다. 한도 0 이 실제로 난 것은 오늘 `krw_cash_unknown`(국내 HTTP200 업무실패, 09:52·09:59·10:28·10:35)과 `usd_cash_unknown`(해외 예수금 실패, 09:42·09:54·09:55·09:59·10:21~) 경로다. 따라서 이 변경의 한도 측면 실효는 **`getUsdCash` 재시도**가 가장 크고, 나머지는 스냅샷 건너뛰기·경보 감소다.

## Reviewer

- [11:10] 독립 감사 시작(Reviewer, 메인 세션 구현본과 별개). 범위: `kis-http.ts`·`kis-domestic.ts`·`kis-overseas.ts` 미커밋 diff, 시험 2파일(`kis-http.test.ts` 추가분·`kis-balances-business-failure.test.ts` 신규), 그리고 호출부 — `kis.ts` Facade·`engine.ts`·`portfolio-total.ts`·`order-limits.ts`·`dry-run.ts`·`entry-cash-precheck.ts`·`/api/portfolio`·`/api/markets/status`·`/api/balances`·`cron/portfolio-snapshot`·`scripts/cron-runner.sh`(읽기만). 구현자 설명은 grep·api-usage 로그·DB 읽기 전용 조회로 대조했다. 코드는 한 줄도 고치지 않았다.
- [11:10] 증빙 재실행(서버 `ssh home_ubuntu`, flock 직렬): `npm run typecheck` exit 0 · jest `src/lib/exchanges/__tests__`+`src/lib/safety/__tests__`+`portfolio-partial-balances` 62스위트(61 통과·1 skip) 1654 통과·14 skip exit 0 · 추가로 `src/app/api`+`src/lib/signals`+`src/lib/strategy` 122스위트(120 통과·2 skip) 3502 통과·86 skip exit 0. lint 는 이 저장소에 ESLint 설정 파일이 없어(`.eslintrc*` 없음, package.json 에도 `eslintConfig` 없음) 실행 자체가 불가하다 — Developer 의 "lint 미실행"은 도구 부재다.
- [11:10] 확인1(중복 주문) [확실]: `transientRetries` 사용처는 `kis-domestic.ts:233`·`kis-overseas.ts:448`·`kis-overseas.ts:631` 3줄뿐이다(전체 `src`·`scripts` grep). 주문·취소 4곳(`kis-domestic.ts` createOrder/cancelOrder, `kis-overseas.ts` createOrder/cancelOrder)은 `{ priority: 'critical', label }` 만 넘기고 POST 라 기본값 0 이 그대로 적용된다. 원장(`kis-domestic-ledger.ts`·`kis-overseas-ledger.ts`)·시세·`order-sync` 의 미체결/체결 조회도 옵트인하지 않았다. 지금 실제로 중복 주문이 날 경로는 없다. 다만 "정적 울타리"는 우회 가능하다 → 발견 M-1.
- [11:10] 확인2(T-017 doctrine) [확실]: 루프를 줄 단위로 추적했다. 레이트리밋 응답은 `kis-http.ts:316` 분기에서 `attempt` 만 쓰고 소진 시 그 안에서 `return`, 아니면 `continue` 한다 — 일시 실패 분기(`:332`)에 닿지 못한다. `transientAttempt` 는 레이트리밋이 아닌 응답에서만 오른다. 두 예산은 합산되지 않아 한 호출의 최대 시도는 1+2+2=5회, 대기 합 ≤ 약 4.0초(400~599 + 1200~1399 가 각 2묶음)다. 기본값 0: 옵트인 3곳 외 모든 호출부는 `Math.max(0, undefined ?? 0)=0` → `0 < 0` 거짓 → 변경 전과 같은 `return replay` 다. `kisAttempts` 의 `attempt+1`→`tries` 변경은 레이트리밋 전용 경로에서 값이 같다(루프 1회=fetch 1회=tries 1). 사용 지점은 `kis-ledger-query.ts:273` 하나이고 원장은 옵트인하지 않아 영향 없음.
- [11:10] 확인3(`isTransientKisFailure` 범위) [확실]: 이 판정은 `kisFetch` 안 `transientRetries>0` 조건에서만 호출되고 옵트인 3곳 외 영향이 없다. `rt_cd` 없는 응답(tokenP)은 false, 403 EGW00133 은 상태 <500 이고 본문에 `rt_cd` 가 없어 false(시험으로 고정됨). 평시 업무실패 0건 주장은 api-usage 실측으로 확인했다: 10-25~10-30 balances 3종(`domestic.get-balances`·`overseas.get-balances`·`overseas.usd-cash`) 약 5,500호출에서 HTTP200 `err:other` 0건, 첫 발생은 10-31 00:23:07Z(=09:23 KST, 장애 시작과 일치). 국내 보유가 비었던 10-24~10-28 에도 국내 잔고는 `rt_cd=0` 이었다(포트폴리오 스냅샷 positions 에 6자리 종목이 없던 날 + 국내 잔고 호출 수백 건에 업무실패 0) — 빈 보유=`rt_cd≠0` 우려는 국내에서는 반증됐다. 해외 빈 보유는 최근 6주 모든 스냅샷에 해외 종목이 있어 실증이 없다(국내 선례로 `rt_cd=0` 일 가능성이 높으나 [추측]) → 정보 I-1.
- [11:10] 확인4(`rt_cd≠0` 던지기의 파급) [확실]: 새 예외는 Facade 의 시장별 `failed` 로만 들어가고, 소비자는 전부 "던지지 않거나 fail-closed" 로 이미 짜여 있다. (a) `engine.ts` `getHeldAmounts` — 예전에는 국내/해외 SESSION FULL 이 **빈·부분 맵 `known:true`** 로 통과해 `reconcilePositionState(market, [])` 가 트레일링 고점을 지울 수 있었다. 이제 `known:false` 로 멈춘다 = 개선. 실측으로 오늘 그 일이 실제로 나지는 않았다(해외 `position_state.first_seen_at` 전부 장애 이전, 10-31 03:16 이후 갱신 없음 = 장 마감). (b) `/api/balances` 는 예전엔 부분 잔고를 `holdings` 에 INSERT 했는데 이제 던져서 INSERT 하지 않는다 = 개선. (c) `/api/portfolio`·`/api/markets/status`·`portfolio-snapshot` 은 `BalancesIncompleteError` 를 기존 503/건너뛰기로 처리한다(스냅샷은 예전에도 KRW 행 없음으로 보류했다). (d) `entry-cash-precheck` 는 `domesticCashFromBalances` 가 `ok` 에 domestic 이 있을 때만 값을 읽어 실패 시장을 null 로 만든다. (e) `/api/settings/credentials/test` 는 예전엔 업무실패를 통과시켰고 이제 명시 오류다(개선). 더 넓게 멈추는 곳은 없다. 단 한 곳에서 **정책 경계가 이동**한다 → 발견 M-2.
- [11:10] 확인5(지연·예산): 재시도 대기는 유량 토큰을 쥐지 않고(`acquireKisSlot` 은 매 회 새로 받음) 잔고 3호출(국내·해외·USD)이 `Promise.all` 병렬이라 한 번의 `getBalancesDetailed` 실패 비용은 벽시계 +1.6~2.0초(레이트리밋 겹침 시 ≤ 약 4.0초)다. `entry-cash-precheck` 8초 상한 안에 든다. `/api/health` 는 `getEffectiveOrderMax` 4개로 콜드 캐시일 때 같은 경로를 타지만 deploy 헬스 타임아웃 30초(`scripts/deploy.sh` `M_HTIMEOUT`)라 영향 없다. 문제는 `cron-runner.sh` 08시 틱: 주석상 최악 290.2초로 남는 여유가 9.8초다(`:194-196`). 10-30 api-usage 로 분당 잔고 호출 횟수는 1회 424분·2회 81분·3회 11분·4회 2분(최대 4)이었다. 한 틱에서 순차 호출 4번이 모두 최악으로 실패하면 +6.4~8.0초(레이트리밋 겹침 시 최대 약 16초)가 되어 여유를 넘을 수 있다 — 단 08시 틱이 해외 분석 120초 상한까지 다 쓰고, KIS 가 그 틱에서 완전 장애이고, 호출이 4번 겹칠 때뿐이라 복합 최악이다 → 발견 L-4. 또 `getBalances` 계열 `kisFetch` 에는 `timeoutMs` 가 없다(변경 전부터). 느린 5xx 가 있다면 시도 수만큼 곱해지지만 KIS 5xx 1,144건 중 1초 넘는 것은 0건이라 이론상이다.
- [11:10] 확인6(`kisAttempts`·api-usage): 위 확인2 와 같이 기존 시험·사용 지점을 깨지 않는다(전 시험 통과). `api-usage` 는 시도마다 한 줄(실패 줄 + 성공 줄)이라 TheAdmin API 탭의 실패율은 "시도 단위"로 남고, 재시도가 구해 준 호출 수는 어디에도 집계되지 않는다 → 발견 L-6(관측성).
- [11:10] 확인7(로그): `console.warn` 은 재시도마다 1줄(stderr→`pm2-err.log`). 10-31 장애 구간(09~11시 KST 약 2시간)의 잔고 3종 실패가 44건이라 경고는 최대 약 90줄/2시간, KIS 완전 장애를 가정한 상한도 약 `2줄 × 1,860호출(10-30 실측) ≈ 3,700줄/일` 이고 기존 `console.error('[kis] … balances failed')` 가 이미 같은 빈도로 찍힌다. 과하지 않다. 판정: 문제 없음.
- [11:10] 발견 M-1 (MEDIUM) 중복 주문 울타리가 텍스트 스캔이라 우회·누락 여지가 있다. 근거 `kis-balances-business-failure.test.ts:99-123`: (1) 읽는 파일이 `kis-domestic.ts`·`kis-overseas.ts` 둘뿐이고 그 안에서도 `transientRetries` 라는 낱말이 든 **줄**만 본다 — `{ ...READ_OPTS }` 처럼 다른 파일에 정의한 옵션 객체를 주문 호출에 펼치면 줄에 낱말이 없어 통과한다. (2) 두 번째 시험 "주문·취소 경로에는 없다"는 첫 시험이 이미 허용 라벨 줄로만 걸러 낸 줄에서 `createOrder|cancelOrder` 를 찾으므로 **항상 통과하는 빈 시험**이다(허용 라벨에 그 낱말이 없음). 현재 노출은 0이지만, "재시도의 전제는 멱등성"이라는 절대 규칙을 구조로 지키는 장치가 아니다. 권고(둘 다 작다): ① `kisFetch` 에 런타임 가드 — `transientRetries>0` 인데 `init.method` 가 GET 이 아니면 던진다(주문·취소는 POST, 잔고 3곳은 GET 이라 영향 없음. 모든 KIS 트래픽이 지나는 길목이라 T-017 설계 원칙과도 맞다). ② 이미 어댑터 옵션을 검사하는 `kis-order-priority.test.ts` 의 주문 4건에 `expect(optsOf(0).transientRetries ?? 0).toBe(0)` 를 더한다(줄 스캔이 아니라 실제 호출 옵션 기준이라 펼침 우회에도 안 뚫린다).
- [11:10] 발견 M-2 (MEDIUM) HTTP200 `rt_cd≠0`(국내)이 주문 한도 산정에서 fail-closed 에서 "직전 정상값 폴백"으로 정책 경계를 넘는다. 근거: 변경 전 국내 SESSION FULL 은 `output2` 없음 → KRW 행 없음 → `portfolio-total.ts` 의 `krw_cash_unknown`(unknown) → `:174` 가 `lastOk.domestic` 을 지우고 `order-limits.ts` 가 한도 0 을 낸다(신규 매수 차단). 변경 후에는 어댑터가 던져 `balances_failed` 로 가고(`:166`) `fallbackFor`(`:154`)가 **나이 상한 없는** 직전 정상값을 두 시장 모두에 돌려준다(주석상 "R5, 이번 범위 밖"으로 둔 기존 동작). 실질 크기는 작다 — 이 폴백은 HTTP500(국내 잔고 하루 18~23건)이 이미 매일 타고 있고, 한도는 평가액×pct 라 몇 시간 묵은 값이면 큰 차이가 없다. 그러나 안전 구역의 정책이 코드 변경에 딸려 바뀌었고 task·시험 어디에도 선택으로 기록돼 있지 않다. 권고: (a) 의도된 수용이면 task 에 "HTTP200 업무실패도 balances_failed 폴백 대상"이라고 적고 `portfolio-total` 시험에 못 박는다, (b) 아니면 폴백에 나이 상한을 두는 별도 task 로 올린다. 이번 diff 를 막을 사유는 아니다. 부수 정정: task 본문 "그 틱 주문 한도 0(신규 매수 차단)"은 HTTP500 경로에서는 사실과 다르다 — 프로세스가 한 번이라도 정상값을 받았으면 한도는 0 이 아니라 직전 값이다. 한도 0 이 나는 것은 `usd_cash_unknown`·`krw_cash_unknown`·콜드 프로세스다. 그래서 `getUsdCash` 재시도가 한도 0 을 막는 실효가 가장 크고, 스냅샷 건너뛰기 경보 감소가 나머지 효과다.
- [11:10] 발견 L-3 (LOW) EGW00123(토큰 만료, **HTTP 500** — `kis-order-query-failures.test.ts:135`·`kis-domestic-completed-orders.test.ts:149` 가 그 모양)이 `isTransientKisFailure` 에 걸려 호출부의 1회 재발급보다 **먼저** 죽은 토큰으로 2번 더 재시도한다. 비용은 약 2초 지연 + 병렬 3호출 × 2 = 불필요한 KIS 호출 6건(다른 프로세스가 같은 앱키를 재발급했을 때 — `kis-auth.ts:35` 주석). 로그 전체에 EGW00123 은 0건이라 발생은 드물다. 권고: `isTransientKisFailure` 에서 `EGW00121|EGW00123|만료된 token` 본문을 false 로 두고 시험 한 줄.
- [11:10] 발견 L-4 (LOW) `cron-runner.sh` 시간 예산 주석(`:90-98`·`:194-196`)이 이 변경의 최대 +수 초를 반영하지 않는다(확인5). 복합 최악에서만 08시 틱 여유 9.8초를 넘을 수 있다. 그 파일은 T-127·T-131 범위라 이번에 손대지 않았다고 task 에 적혀 있으므로, 권고는 ① 해당 블록 주석에 "잔고 조회 실패 시 호출당 +2초(최대 4초)" 한 줄을 그 세션이 갱신, ② 필요하면 잔고 3곳에 `timeoutMs`(예: 10초)를 명시해 시도당 상한을 둔다. 차단 사유 아님.
- [11:10] 발견 L-5 (LOW) 시험 공백: (a) 어댑터→**실제** `kisFetch` 연결이 시험되지 않는다 — `kis-balances-business-failure.test.ts` 는 `kisFetch` 를 통째로 모킹하므로 "500 한 번 뒤 성공하면 `getBalances` 가 복구된다"·"`getUsdCash` 가 재시도한다"는 `transientRetries: 2` 가 실제로 먹는지를 줄 스캔(텍스트)으로만 확인한다. `global.fetch` 모킹 한 건이면 닫힌다. (b) `isTransientKisFailure` 표에 EGW00123 행이 없다(L-3 과 함께). (c) 어댑터는 `data.rt_cd != null && data.rt_cd !== '0'`(JSON 파싱)이고 재시도 판정은 정규식 `"rt_cd":"…"`(따옴표 문자열만)이라 숫자형 `rt_cd` 가 오면 둘이 갈리지만 KIS 는 문자열만 쓴다.
- [11:10] 발견 L-6 (LOW, 운영성) 재시도가 구한 호출이 로그에 남지 않는다(`console.warn` 은 재시도 시작 시점뿐, 성공 시 한 줄 없음). 12.5% 구간에서 재시도 효과를 사후에 못 센다. 권고: 재시도 후 성공 응답에서 `[kis-http] 일시 실패 재시도 성공 (label) n회차` 한 줄.
- [11:10] 정보 I-1 해외 `inquire-balance` 가 보유 0건 계정에서 `rt_cd='0'` 을 준다는 증거는 이 계정 이력에 없다(국내는 10-24~10-28 에 보유 0건이었는데 업무실패 0건으로 확인). 만약 KIS 가 해외 빈 보유에 `rt_cd≠0` 을 준다면 전량 청산 후 해외 잔고가 영구 실패(`BalancesIncompleteError`)로 굳는다 — 자금 손실이 아니라 fail-closed 방향의 정지다. 해외 전량 매도 직후 첫 틱에 QA/운영이 `domestic/overseas.get-balances` 의 `err:other` 유무를 확인해 두면 된다.
- [11:10] 요약: Critical 0 · High 0 · Medium 2 · Low 4 · Info 1. 안전장치 우회 경로 없음, 중복 주문 경로 없음, 레이트리밋 증폭 doctrine 유지, 기본값 0 이라 비옵트인 호출부 동작 불변, 새 예외가 더 넓게 멈추는 곳 없음(오히려 빈·부분 잔고 통과 경로 2곳이 닫힘). M-1(런타임 가드+행동 단언)과 L-3(EGW00123 제외)은 변경이 작고 효과가 분명하므로 커밋 전 반영을 권고하되 차단은 아니다. M-2 는 Leader 의 정책 결정 사항이다.
- [11:10] QA 에 넘길 high_risk_areas: `src/lib/exchanges/kis-http.ts:316-343`(레이트리밋/일시 분기 분리) · `kis-domestic.ts:233,253-258` · `kis-overseas.ts:448,631,650-655` · `src/lib/safety/portfolio-total.ts:154-178`(M-2 폴백 경계) · `src/lib/strategy/engine.ts` `getHeldAmounts`(known:false 경로) · `kis-balances-business-failure.test.ts:99-123`(M-1 울타리).
- [11:10] 라운드 1 결론(대체됨 — 아래 라운드 2 에서 갱신): pass. 당시 검토 범위는 kis-http.ts·kis-domestic.ts·kis-overseas.ts·kis-http.test.ts·kis-balances-business-failure.test.ts.
- [11:23] **라운드 2 재감사 시작** (Developer 의 `[11:25]` 반영 항목 + M-2 Leader 결정 검토). 범위: `kis-http.ts`(런타임 울타리·토큰 제외·L-6 로그)·`kis-domestic.ts`·`kis-overseas.ts` diff, 시험 4파일 — `kis-http.test.ts`·`kis-order-priority.test.ts`·`kis-balances-business-failure.test.ts`·신규 `kis-balances-transient-recovery.test.ts`. 코드는 한 줄도 고치지 않았다. 위 라운드 1 판정은 대체됐다(마지막 줄 하나만 유효).
- [11:23] 증빙 직접 재실행(서버, flock 직렬, 저장소 원본): `npm run typecheck` exit 0 · jest `src/lib/exchanges/__tests__`+`src/lib/safety/__tests__`+`src/app/api`+`src/lib/signals`+`src/lib/strategy` → 184스위트 중 181 통과·3 skip, 5156건 통과·100 skip, exit 0. 라운드 1 대비 늘어난 것은 새 시험 파일과 추가 단언뿐이고 실패 0이다.
- [11:23] **변이 검증**(가짜 시험이 아닌지 — 저장소 밖 스크래치 복사본 `/tmp/rev-t132-mut` 에서만, 끝나고 삭제. 기준선 4스위트 71건 통과). A) 국내 `getBalances` 에서 `transientRetries` 제거 → 복구 시험 3건 + 정적 울타리 2건 실패(5건). B) `kisFetch` 의 GET 전용 런타임 울타리 제거 → 울타리 시험 4건 실패. C) 토큰 오류 제외 제거 → `isTransientKisFailure` 표 2건 + 복구 시험의 토큰 만료 1건 실패. D) `createOrder` 에 `...JSON.parse('{"transient'+'Retries":2}')` 로 낱말을 숨겨 주입(정적 줄 스캔 우회 시도) → 정적 울타리는 **통과**했고 `kis-order-priority` 의 행동 단언("국내 매수 주문")이 잡았다. 즉 M-1 에서 지적한 우회가 실제로 가능했고, 이번 단언·런타임 울타리가 그것을 닫는다. 복원 후 71건 통과.
- [11:23] **M-1 닫힘** [확실]. ① 런타임 울타리(`kis-http.ts` 진입부): 슬롯 획득·fetch 전에 던지므로 주문이 나가지 않는 방향이고, `method` 는 대소문자 무시·미지정=GET 이다. `kisFetch(url: string, init)` 구조상 POST 는 `init.method` 로만 보낼 수 있고(GET+body 는 fetch 가 TypeError), 검사 대상이 호출 지점의 글자가 아니라 **실제 `opts.transientRetries` 값**이라 변수·스프레드·JSON.parse 로 넘겨도 우회되지 않는다. `NaN` 은 `Math.max(0,NaN)=NaN` 으로 울타리를 건너뛰지만 `transientAttempt < NaN` 이 거짓이라 재시도 자체가 0 이어서 안전하다. 남는 한계는 상한 없음 → I-2. ② 행동 단언 4건 — 변이 D 로 실효 확인. ③ 정적 울타리를 교환 계층 디렉터리 전체로 넓히고 빈 시험을 "각 라벨 정확히 한 번"으로 교체 — 변이 A 로 실효 확인. 한계: 비재귀 스캔이라 하위 디렉터리·`src/lib/exchanges/` 밖(`daily-bars-kis.ts`·라우트)은 못 보지만 런타임 울타리가 덮는다.
- [11:23] **L-3 닫힘** [확실]. 충돌 분석: 레이트리밋 분기(`kis-http.ts:316`)가 일시 분기보다 앞서 있어 토큰 제외와 겹치지 않는다. 토큰 재발급은 호출부 `body.includes('EGW00123'|'만료된 token')` 이 그대로 하고, `kisFetch` 가 첫 응답을 곧바로 돌려주므로 재발급 경로에 바로 닿는다(복구 시험이 fetch 2회·`invalidateKisToken` 1회로 고정, 변이 C 로 실효 확인). EGW00121 은 호출부 재발급 대상이 아니라 이제 즉시 던진다 — 예전 2번 더 때리던 호출이 사라질 뿐 복구 능력은 변함이 없다.
- [11:23] **L-5 대부분 닫힘 / 잔여 L-5b (LOW)**. 새 복구 시험은 `kisFetch` 를 모킹하지 않고 `global.fetch` 만 바꿔 실제 재시도 경로를 지난다 — 변이 A 에서 국내 3건이 실제로 실패했으므로 가짜가 아니다(대기가 실시간 sleep 이라 건당 약 1.6~2.0초, 파일 6.5초 — 기본 5초 제한 안이고 여유가 있다). 잔여: **`getUsdCash` 종단 시험이 여전히 없다.** M-2 측정 정정대로 한도 0 방지 실효가 가장 큰 곳인데 배선은 정적 줄 스캔만 지킨다(`transientRetries: 2` → `0` 으로 바뀌어도 라벨이 같아 울타리가 통과한다). 스크래치 프로브로 같은 픽스처(`fixtures/ctrp6504r-closed-20261020.json`)를 써 확인했다: 500 한 번 뒤 복구 · SESSION FULL 2회 뒤 복구 · SESSION FULL 계속이면 던짐(0 으로 퇴화 안 함) 3건 통과 — 현재 배선은 정상이다. 권고: 이 3건을 recovery 파일에 옮겨 담는다.
- [11:23] **L-6 — 새 결함 N-1 (LOW)**: 완전히 소진된 SESSION FULL(HTTP200 + `rt_cd≠0`) 이 `재시도 성공` 으로 찍힌다. 근거 `kis-http.ts` 요약 줄이 `res.ok ? '성공' : '소진'` 으로 HTTP 상태만 본다. 스크래치 프로브(`kisFetch` 직접, `transientRetries:2`): `500×3` → "소진"(맞음) · **`200+rt_cd9 ×3` → "재시도 성공 … 3회 시도, status=200"(틀림)** · `500→200 OK` → "성공"(맞음) · `500→403` → "소진"(재시도 한도를 다 쓰지 않았는데 소진이라 찍힘, 경미) · `500→레이트리밋×3` → 요약 없이 레이트리밋 소진 줄만. L-6 의 목적이 "구해 준 호출 수를 사후에 센다"인데 장애의 두 번째 모양(SESSION FULL)에서 정확히 오집계한다. 동작에는 영향이 없다(반환값·재시도·예외 불변). 권고: 성공 판정을 `res.ok && !isTransientKisFailure(res.status, body)` 로 바꾸고(`body` 는 루프 안에 있다) 소진은 "한도를 다 썼고 여전히 일시 실패"일 때만 찍는다, 시험 1건("200 SESSION FULL ×3 이면 '성공' 이 찍히지 않는다"). 수정 시 `kis-http.ts`·`kis-http.test.ts` 만 다시 보면 된다(둘 다 scope 에 있음).
- [11:23] L-6 로그 양: 구해 준 호출은 재시도 1줄 + 요약 1줄 = 2줄, 소진은 2 + 1 = 3줄이다. 10-31 장애 구간 실패 44건/2시간 기준 약 100~130줄, 완전 장애 상한은 `3줄 × 1,860호출(10-30 실측) ≈ 5,600줄/일`(라운드 1 추정 3,700 에서 상향)이라 과하지 않다. 요약 줄은 결과를 알려 주는 유일한 줄이라 필요하고, "재시도 시작" 줄 2개는 요약의 `n회 시도` 와 정보가 겹친다 — 더 줄이고 싶다면 시작 줄을 빼면 된다(선택). 기존 Facade `console.error('[kis] … balances failed')` 와는 위치·내용이 달라 중복이 아니다.
- [11:23] **M-2 — Leader 수용 결정을 검토했고 동의한다.** [확실] 같은 장애가 응답 모양에 따라 달리 처리되던 불일치를 없앤 것이고, 폴백은 HTTP500 으로 이미 매일 쓰이는 기존 정책이다. 라운드 1 서술을 정밀화한다: `portfolio-total.ts:174` 가 `unknown` 판정 때 `lastOk[m]` 을 **지우므로**, 직전에 `krw_cash_unknown`·`usd_cash_unknown` 이 있었다면 `balances_failed` 인데도 폴백 값이 없어 한도 0 이 난다(`pm2-err.log` 에 `평가액 모름(balances_failed` 8건 — 예: 10:37:06 국내, 원인은 해외 EGW00300; 같은 로그에 `krw_cash_unknown` 16·`usd_cash_unknown` 83건, 일자 미분리). 라운드 1 의 "한 번이라도 정상값을 받았으면 직전 값"은 단순화였다. T-132 는 `lastOk` 를 지우던 국내 `krw_cash_unknown` 경로를 없애고 `usd_cash_unknown` 빈도를 줄이므로 폴백 가용성은 오히려 늘고 한도 0 은 줄어든다 — 수용 근거가 하나 더 붙는다. 남은 `fallbackFor` 나이 상한 없음은 기존 결함으로 후속 후보에 있어 맞다.
- [11:23] 정보 I-2: `transientRetries` 에 상한이 없다 — `Infinity`·큰 값이 GET 에 켜지면 영구 실패 때 무한 재시도(약 1.3초 간격)다. 현재 호출부는 전부 2 라 노출은 없다. 권고(선택): `Math.min(…, 5)` 정도의 클램프. 정보 I-3: `kis-http.ts` 헤더 문서 첫 문단의 "그 틱의 주문 한도가 0 이 됐다(= 신규 매수 차단)"가 task 「측정 정정」과 어긋난다(코드 주석에 남은 오기) — 한 줄 정정 권고. 위생: Developer 절의 `### 측정 정정 (Reviewer M-2 부수 지적)` 소제목은 훅이 제목에 reviewer 가 든 헤딩을 전부 Reviewer 섹션으로 읽으므로 그 본문도 Reviewer 본문으로 취급된다 — 지금은 판정 줄이 없고 `## Reviewer` 가 뒤에 있어 무해하나, 소제목에서 그 낱말을 빼는 편이 안전하다. 이월: L-4(cron-runner 예산 주석)·I-1(해외 빈 보유 `rt_cd`)은 Developer 가 후속 후보로 남겼고 동의한다.
- [11:23] 요약(라운드 2): M-1·L-3 닫힘, L-5 국내·해외 닫힘(`getUsdCash` 종단 시험만 잔여), L-6 은 구현됐으나 새 결함 N-1(오집계 로그), M-2 수용 동의. Critical 0 · High 0 · Medium 0 · Low 3(N-1·L-5b·이월 L-4) · Info 3(I-1·I-2·I-3). 새 안전 결함 없음, 중복 주문 경로 없음, 레이트리밋 증폭 doctrine 유지. N-1 은 한 줄 수정이라 커밋 전 반영을 권고하되 차단은 아니다.
- [11:23] QA 에 넘길 high_risk_areas: `kis-http.ts` 진입부 GET 울타리와 `:316-370` 분기·요약 로그(N-1) · `kis-balances-transient-recovery.test.ts`(실시간 sleep 시험의 안정성) · `portfolio-total.ts:154-178`(M-2 폴백 경계) · `engine.ts` `getHeldAmounts` known:false 경로 · 해외 전량 매도 직후 첫 틱의 `overseas.get-balances` `err:other` 유무(I-1).
- [11:23] 라운드 2 결론(대체됨 — 아래 라운드 3 에서 갱신): pass. 당시 검토 범위는 같은 7개 파일.
- [11:36] **라운드 3 델타 재감사** — N-1·I-2·I-3·L-5b·위생 반영 검토. 범위: `kis-http.ts`(요약 줄 판정·클램프·헤더 문서)·`kis-http.test.ts`(요약 줄 4건)·`kis-balances-transient-recovery.test.ts`(`getUsdCash` 종단 3건·환율 모킹 변경), 나머지 5개 파일은 라운드 2 와 같아 배선(`transientRetries: 2` 3곳·`rt_cd` 던지기 2곳)만 재확인했다. 코드는 고치지 않았다. 위 라운드 2 판정은 대체됐다(마지막 줄 하나만 유효).
- [11:36] 증빙 직접 재실행(서버, flock 직렬, 저장소 원본): `npm run typecheck` exit 0 · jest `src/lib/exchanges/__tests__`+`src/lib/safety/__tests__`+`src/app/api`+`src/lib/signals`+`src/lib/strategy` → 184스위트 중 181 통과·3 skip, 5163건 통과·100 skip, exit 0(라운드 2 의 5156 에서 +7건 = 추가한 7건, 실패 0).
- [11:36] **변이 검증**(저장소 밖 스크래치 복사본, 끝나고 삭제, 기준선 4스위트 78건 통과). E) 요약 줄을 `recovered = res.ok` 로 되돌림 → "SESSION FULL 소진이 성공으로 찍힌다" 시험 1건 실패(N-1 시험이 실제로 잡는다). F) 반대 방향 과교정 `recovered = false` 고정 → "500 뒤 복구되면 성공으로 적는다" 1건 실패 = **정상 복구 집계를 깎는 변경도 잡힌다**. G) 클램프 제거 → "5 로 깎인다" 1건 실패(50회 재시도라 20초 제한에서 끊김, 31초). H1) 해외 단가 환율 곱 제거 → 해외 보유 복구 시험 실패. **H2) 단가를 환율 1400 고정으로 바꿈 → 실패**(옛 모킹값 1400 이었다면 이 변이는 `140,000` 이 같아 못 잡았을 것 — 모킹 변경이 오히려 탐지력을 높였다). H3) `Math.round(avgUsd*balFx)` → 통과(아래 I-5). I) `getUsdCash` 에서 `transientRetries` 제거 → 종단 3건 + 정적 울타리 2건 실패. I2) 라벨은 그대로 두고 `transientRetries: 0` → 종단 3건만 실패(정적 울타리는 통과하는 변이를 종단 시험이 잡는다). 복원 후 78건 통과.
- [11:36] **N-1 닫힘** [확실]. 판정식 `res.ok && !isTransientKisFailure(res.status, body)` 의 진리표를 따져 봤다: 500→200 정상 = 성공(정상 복구는 그대로 센다 — 변이 F 로 확인) · 200 SESSION FULL ×3 = 소진(변이 E 로 확인) · 500×3 = 소진 · 정상 응답에 `rt_cd` 없음(예: 키가 없는 TR) = 성공. 동작(반환값·재시도·예외)은 건드리지 않고 로그 문구만 바뀐다. 알려진 경미한 부정확 하나는 그대로다: 재시도 도중 비일시 실패(예: 500→403)로 끝나면 "소진"으로 찍힌다(한도를 다 쓰지 않았음). 집계 목적("구해 준 호출 수")에는 영향이 없어 무시해도 된다.
- [11:36] **I-2 닫힘** [확실]. `Math.min(Math.max(0, x ?? 0), 5)`: 미지정→0(기본 동작 불변)·2→2(기존 호출부 3곳 불변)·음수→0·`Infinity`→5. `NaN` 은 그대로 `NaN` 이라 GET 울타리(`> 0`)를 건너뛰지만 `transientAttempt < NaN` 이 거짓이어서 재시도가 0 이다(안전, 라운드 2 와 같음). 로그의 `n/m회차` 는 깎인 값을 쓴다. 기존 시험의 "소진 3회 시도"·"기본값 0"·"음수 0" 이 전부 통과한다.
- [11:36] **L-5b 닫힘** [확실]. `getUsdCash` 종단 3건은 `kisFetch` 를 모킹하지 않고 `global.fetch` 만 바꿔 실제 재시도 루프를 지난다 — 변이 I/I2 에서 실패했으므로 가짜가 아니다. 계속 실패 시 `UsdCashUnavailableError` 와 fetch 3회를 고정해 "0 으로 읽지 않는다"도 지킨다.
- [11:36] **환율 모킹 1400→1332.1** [확실, 약화 아님]. 이 파일에서 환율을 쓰는 곳은 해외 `getBalances` 의 단가 환산(`balFx`, `kis-overseas.ts:693`) 하나뿐이다. 국내 시험은 환율을 안 쓴다. `getUsdCash` 는 환율 함수를 부르지 않는다(환율 모킹 없이 같은 픽스처로 돌린 스크래치 프로브가 fetch 정확히 2회로 통과했다) — 즉 Developer 설명("정합 검사가 성립하는 환율")은 사실과 달라 **모킹 변경은 USD 시험에 필요하지 않았다**. 그래도 변경은 해롭지 않고 H2 가 보인 대로 유익하다. `toEqual(140_000)`→`toBeCloseTo(100*FX, 6)` 은 허용 오차가 절대 5e-7 이라 곱셈 누락·환율 상수 고정은 전부 잡는다(H1·H2). 시험 코드의 환율 주석은 정정 권고(I-4).
- [11:36] 정보 I-4: `kis-balances-transient-recovery.test.ts` 의 `FX` 주석("USD 예수금 픽스처의 정합 검사가 성립하는 환율")은 부정확하다 — 위 근거. 주석만 고치면 된다. 정보 I-5: `pchs_avg_pric:'100'`×1332.1 = 133,210 이 정수라 `Math.round`·`floor` 같은 반올림 변이(H3)는 안 잡힌다(옛 140,000 도 같았다). 소수 곱이 나오는 단가(예: `'123.45'`)로 바꾸면 닫힌다(선택). 또 `toEqual`→`toMatchObject` 로 이 시험은 반환 객체의 **추가 필드**를 더는 못 잡는다 — 다른 파일이 정확한 모양을 지키는지는 이번에 확인하지 않았다(미확인). 정보 I-3 잔여: `kis-http.ts` 헤더의 "보유 조회만 실패한 틱의 한도는 … 직전 정상값으로 계산된다"는 `portfolio-total.ts:174` 가 `unknown` 판정 때 `lastOk` 를 지우는 경우(직전 `*_cash_unknown`)에는 0 이 된다 — "직전에 unknown 판정으로 지워지지 않았다면" 한마디를 붙이면 정확하다. 시험 소요: `kis-http.test.ts` 8→16초·복구 파일 6.5→10.7초(실시간 sleep) — 기본 제한 안이고 흔들릴 여지는 작다(fake timer 는 선택).
- [11:36] 위생 확인: task 파일 소제목은 `### 측정 정정 (감사 M-2 부수 지적)` 로 바뀌어 훅이 읽는 Reviewer 섹션은 `## Reviewer` 하나뿐이다.
- [11:36] 요약(라운드 3): N-1·I-2·L-5b·위생 닫힘, I-3 은 문구 한 줄 잔여, 새 결함 없음(정보 I-4·I-5 두 건). 열린 항목: L-4(cron 예산 주석, 후속 후보로 이월 — 동의)·I-1(해외 빈 보유 `rt_cd`, 운영 관찰)·I-3 잔여·I-4·I-5. Critical 0 · High 0 · Medium 0 · Low 1(이월 L-4) · Info 4. 안전장치 우회·중복 주문 경로 없음, 레이트리밋 증폭 doctrine 유지, 클램프·로그 수정이 기본값 0 경로와 기존 호출부(2)를 바꾸지 않음. QA 로 넘긴다.
- [11:36] QA 에 넘길 high_risk_areas: `kis-http.ts` 진입부 GET 울타리·클램프와 `:340-400` 분기·요약 줄 · `kis-balances-transient-recovery.test.ts`(실시간 sleep) · `portfolio-total.ts:154-178`(M-2 폴백 경계) · `engine.ts` `getHeldAmounts` known:false 경로 · 해외 전량 매도 직후 첫 틱의 `overseas.get-balances` `err:other`(I-1).
- [11:36] 라운드 3 결론(대체됨 — 아래 라운드 3b 에서 갱신): pass. 당시 검토 범위는 같은 7개 파일.
- [11:40] **라운드 3b 최종 재확인** — 지정된 3개 diff 만 읽었다(전체 시험·변이 시험은 요청대로 생략, 코드 수정 없음). 위 라운드 3 판정은 대체됐다. 누적 diff 에서 주석·`//`·빈 줄을 제외한 실행 코드 줄을 다시 훑어 라운드 3 에서 본 것(배선 3곳·`rt_cd` 던지기 2곳·GET 울타리·클램프·토큰 제외·요약 판정·정상 복구/소진 분기) 밖의 새 실행 줄이 없음을 확인했다 = 동작 변경 0. (1) **I-4 닫힘**: `FX` 주석의 새 설명 — 환율은 이 파일에서 해외 보유 단가 환산 한 곳에만 쓰이고 `getUsdCash` 는 환율을 부르지 않는다 — 은 라운드 3 에서 내가 프로브로 확인한 사실과 일치하고, "기존 T-056 시험과 같은 실측값"도 `kis-overseas-usd-cash.test.ts:35` 의 `1332.1` 과 일치한다. 틀린 설명은 남지 않았다. (2) **I-5 닫힘**: `pchs_avg_pric:'123.45'` → 기대값 `123.45*FX` = 164,447.745 이고 어댑터가 계산하는 `Number('123.45')*FX` 와 배정밀도로 정확히 같은 값(`===` true)이다. 소수 곱이 되어 `Math.round` 변이는 차이 0.255, `floor` 는 0.745, 환율 1400 고정은 8,382.255 로 모두 허용 오차(5e-7)를 크게 넘어 이제 전부 잡힌다(산술 확인 — 변이 시험은 생략). (3) **I-3 잔여 닫힘**: 헤더에 "직전 틱이 `unknown` 판정으로 그 값을 지우지 않았다면(`portfolio-total.ts` 의 `lastOk` 삭제)"가 붙었고 줄 번호를 빼서 주석이 낡지 않는다. 사실과도 맞다. 아주 경미한 잔여: 프로세스가 막 시작해 직전 값 자체가 없는 경우(콜드 프로세스)도 한도 0 이 되는데 문장은 그 경우를 말하지 않는다 — 틀린 서술은 아니고 완전하지 않을 뿐이라 차단·재작업 사유가 아니다(원하면 "또는 프로세스 시작 직후" 한마디). 새 결함 없음. Critical 0 · High 0 · Medium 0 · Low 1(이월 L-4) · Info 2(I-1 운영 관찰·콜드 프로세스 문구). 라운드 3 의 pass 를 그대로 재확인한다.
- [11:40] **최종 판정: PASS (scope: src/lib/exchanges/kis-http.ts, src/lib/exchanges/kis-domestic.ts, src/lib/exchanges/kis-overseas.ts, src/lib/exchanges/__tests__/kis-http.test.ts, src/lib/exchanges/__tests__/kis-order-priority.test.ts, src/lib/exchanges/__tests__/kis-balances-business-failure.test.ts, src/lib/exchanges/__tests__/kis-balances-transient-recovery.test.ts)**

## QA

- [11:46] QA 실행 검증 — 실행 위치: 서버 저장소 /home/brownjeon/NFS/homes/brownjeon/project/StockInvest (HEAD 3b09bde, 미커밋 diff 그대로). 무거운 시험은 flock /tmp/stockinvest-heavy-tests.lock 아래 직렬 실행. 로그 원본은 서버 ~/.node-local/qa-t132/ 에 있다. 코드 수정·커밋·push·배포·DB 쓰기 없음.
- [11:47] 1 시험·타입(developer 제공 명령 그대로): npm run typecheck exit 0, 오류 0. npm test -- src/lib/exchanges/__tests__/ src/lib/safety/__tests__/ src/app/api/ src/lib/strategy/ src/lib/signals/ exit 0 — Test Suites 181 passed / 3 skipped / 184, Tests 5163 passed / 100 skipped / 5263, FAIL 0건.
- [11:47] 1 시험 재확인: T-132 시험 4파일(kis-http, kis-order-priority, kis-balances-business-failure, kis-balances-transient-recovery) 78/78 통과를 2회 실행했고 결과가 같았다(16.7초·16.3초). 실시간 sleep 파일은 합계 10.5~10.6초이고 건별 대기는 2초 안팎이라 기본 제한 5초 안이다.
- [11:48] 2 안전장치 우회: git diff --stat -- src/lib/safety/ src/app/api/orders/ 출력 0줄. DRY_RUN·KILL_SWITCH·주문 한도·submitOrder 경로 변경 0. 변경은 src/lib/exchanges/ 의 7개 파일에 한정, kis.ts Facade 도 미변경.
- [11:48] 3 중복 주문 정적 확인: grep -rn transientRetries src/ scripts/ 에서 켠 호출 지점은 kis-domestic.ts:233(getBalances), kis-overseas.ts:448(getUsdCash), kis-overseas.ts:631(fetchBalancesForExchange) 3곳뿐이다. 주문·취소·원장·시세·scripts 에는 0건.
- [11:49] 3 중복 주문 런타임 확인: kisFetch GET 가드(kis-http.ts:303-310, fetch 전에 throw)는 시험 'POST/post/PUT/DELETE 에 켜면 요청 전에 던진다' 4건으로 통과(fetch 미호출 단언). 주문·취소 4곳에 옵션 0 을 단언하는 kis-order-priority 시험도 통과.
- [11:50] 4 엣지(시험이 없는 항목은 저장소 밖 복사본에서 QA probe 로 실행 확인, 정식 시험 파일은 추가하지 않음 — 증거: 서버 ~/.node-local/qa-t132/evidence/probe-*.test.ts, out-kisfetch.txt, out-adapter.txt): 혼합 RL→GW→RL→GW→RL 은 호출 5회(=1+2+2), 소진 응답 반환, attempts 5 로 상한 준수. GW→RL→GW→RL→OK 는 5회째에 복구.
- [11:50] 4 엣지: 음수는 시험 있음(-3 → 1회). NaN 은 probe 로 확인 — GET 은 1회·500 그대로 반환(재시도 0), POST 는 던지지 않고 1회 호출. 가드를 건너뛰지만 재시도가 0 이라 중복 주문은 생기지 않는다. Infinity 는 시험 없음, 50 → 6회 시험과 같은 Math.min(…,5) 경로로 덮인다.
- [11:51] 4 엣지 — 빈 본문: 200 + 빈 본문 GET 은 1회 반환·재시도 없음(probe E). 어댑터 getBalances 는 SyntaxError(Unexpected end of JSON input) 로 던진다 — fail-closed. 빈 본문 전용 어댑터 시험은 없다.
- [11:51] 4 엣지 — 숫자형 rt_cd(KIS 문서상 문자열): 국내·해외 잔고에서 rt_cd 숫자 0 이면 정상 데이터가 '200 업무실패 rt_cd=0' 으로 던져진다(probe P1·P5). 숫자 rt_cd 9 는 일시 실패로 판정되지 않아 재시도 0회(probe D·P3). 원인은 RT_CD_PATTERN 이 따옴표 문자열만 매치하고 어댑터는 !== '0' 엄격 비교를 쓰는 것. 모두 fail-closed 방향이고, 실 KIS 가 숫자를 준 사례는 확인하지 못했다. 계약 밖 입력의 관찰로 기록하고 결함으로는 올리지 않는다.
- [11:52] 5 로그 민감값(코드 독해 기준): 신규 console.warn 3종(가드 throw 메시지 포함)은 코드 상수 label·method·status·회차·lane·tries 만 담는다. 금액·계좌·토큰·URL 질의문은 없다. 신규 업무실패 throw 2종은 KIS msg_cd·msg1(120자 절단)만 싣고, 기존 HTTP 실패 메시지(body.slice(0,300))와 같은 수준이다. 실행 로그 샘플은 캡처하지 않았다.
- [11:52] 6 커밋 훅 사전 점검(커밋하지 않음): Reviewer 섹션의 판정 줄은 1개(11:40, scope 에 변경 7개 파일 전부 포함). SAFETY_PATHS 의 ^src/lib/exchanges/ 한 줄이 변경 7개(신규 시험 2개 포함)를 모두 감시 대상으로 잡는다. task 파일(agent-vault/)·public/mockups·.codex/ 는 감시 밖이다.
- [11:53] 6 커밋 위치: Mac 의 core.hooksPath 는 /home/brownjeon/.local/share/stockinvest-git-hooks/361294826755 인데 Mac 에는 이 경로가 없어 훅이 무음으로 빠진다(CLAUDE.md 경고). 서버 셸에서 커밋해야 훅이 돈다. 서버 shim 이 scripts/git-hooks/commit-msg 로 연결됨을 확인했다. 커밋 메시지에 T-132 를 넣을 것.
- [11:53] 7 작업트리 위생: 커밋 대상 8개 = src/lib/exchanges/kis-http.ts, kis-domestic.ts, kis-overseas.ts, __tests__/kis-http.test.ts, __tests__/kis-order-priority.test.ts, __tests__/kis-balances-business-failure.test.ts(신규), __tests__/kis-balances-transient-recovery.test.ts(신규), agent-vault/10-Flow/tasks/T-132-kis-gateway-transient-retry.md. 다른 세션 소유라 제외: ' D public/mockups', '?? .codex/agents/codex.toml', '?? .codex/config.toml'. 서버에는 .codex/@eaDir/ 류 NAS 메타 폴더도 보인다. git add -A 금지.
- [11:54] 8 Reviewer 고위험 영역 대조: (a) kisFetch GET 가드·클램프·분기·요약 줄은 시험과 probe A·B·C 로 확인. (b) 실시간 sleep 시험은 2회 재실행 결과 동일. (c) portfolio-total.ts:154-178(M-2 폴백)은 파일 미변경이고 portfolio-total-dedup·portfolio-total-market-state·order-limits-market-state 시험 통과. 다만 HTTP200 업무실패가 balances_failed 로 가서 fallbackFor 를 타는 경로를 직접 고정한 시험은 없다. (d) engine.ts getHeldAmounts known:false 는 strategy/__tests__/engine-balances-unknown.test.ts 통과. (e) I-1 해외 빈 보유 rt_cd 는 NOT_VERIFIED — 2026-10-31 토요일 휴장이라 실측 불가.
- [11:54] 8 정책 경계 위험(Leader 인지용, QA 는 승인 여부를 판단하지 않음): 이전에는 HTTP200 SESSION FULL 이 krw_cash_unknown 으로 가서 한도 0 이었다. 이제 어댑터가 던져 balances_failed → fallbackFor 로 직전 정상 평가액을 쓴다(portfolio-total.ts:154-157 확인). 그 직전값에는 나이 상한이 없다(기존 결함, 후속 후보). 절대 상한 ORDER_MAX_KRW·DAILY_ORDER_MAX_KRW 가 최종 계산에서 여전히 걸리는지는 이번에 정독하지 않았다(미확인).
- [11:55] 9 화면·lint: UI 변경 없음 → 화면 검증 해당 없음. ESLint 설정 파일 없음(ls -a 에 eslint 없음, package.json 에 eslintConfig 없음) → lint 는 도구 부재로 미실행.
- [11:55] 결함 목록: 0건(Critical 0 · High 0 · Medium 0 · Low 0). 계약 밖 관찰 2건(숫자형 rt_cd, 위 4 엣지)은 developer 가 한 줄 정규화할지 선택한다. 권고: String(data.rt_cd) 정규화 또는 RT_CD_PATTERN 에 숫자 허용 + 시험 1건. 시험 공백 3건(혼합 시퀀스 상한 정식 시험, 어댑터 빈 본문 시험, NaN·Infinity 정식 시험)도 권고.
- [11:55] 인계: 커밋 후 deployer 인계 대상(결함 0건, 스키마 변경 없음 → migration_required false). 배포 후 post_deploy_checks 는 leader 최종 보고에 기재.
- [11:56] **QA 판정: PASS** — 근거: typecheck exit 0, 지정 시험 5163 passed·FAIL 0, T-132 78/78 2회 동일, 안전장치 파일 diff 0, 주문 경로 옵션 0, 민감값 로그 0. 미검증 1건(해외 빈 보유 rt_cd, 휴장일 — 운영 확인 필요).

## 최종 요약

### [T-132] 텔레그램 「포트폴리오 스냅샷 건너뜀 — 잔고 부분 실패」 원인과 수정

- **상태**: 커밋 완료 · **운영 미반영**(push 안 함). Reviewer PASS(라운드 3b) · QA PASS(결함 0건).
- **무엇이 바뀌었나**
  - 원인은 **KIS 서버 측 장애**다 — 2026-10-31 09:23 KST 부터 `EGW00300 Gateway 라우팅 오류`(HTTP 500)와 `OPSQ1002 SESSION FULL`(HTTP 200+`rt_cd=9`)이 산발 발생해 KIS 실패율이 0.8% → 12.5% 가 됐다. 두 코드 모두 로그 전체(09-19~)에서 오늘 이전 0건이고, 오늘 배포(05:20)보다 4시간 뒤에 시작됐으며, 동시호출이 적을 때 실패했다(유량 문제 아님). 11:26 까지 계속 발생.
  - 우리 쪽 결함 2개를 고쳤다 — ① 잔고·예수금 조회에 일시 5xx 재시도가 없어 KIS 깜박임 한 번에 스냅샷이 통째로 버려졌다(시세 조회는 500 을 2회 재시도하고 있었다). ② HTTP 200 + `rt_cd≠'0'` 를 성공으로 통과시켜, 해외 보유가 **빈 목록**으로 둔갑해 총액이 조용히 축소될 수 있었다.
  - 주문 경로 보호: 재시도 옵션은 기본 꺼짐 + **GET 이 아닌 요청에 켜지면 요청 전에 throw**(중복 주문 방지). 주문·취소 호출에 0 임을 행동 단언으로 고정.
- **배포**: 커밋 `4ddf222`(8파일 +789/−13, 2026-10-31 12:0x KST, 서버 셸에서 커밋 — Mac 은 `commit-msg` 훅이 무음으로 빠진다). **push 안 함.** `origin/main..HEAD` 에 이 커밋 포함 **8개**가 쌓여 있고 나머지 7개는 다른 세션(T-126·T-127·T-128·T-130·T-131·T-129)의 것이다 — **push 하면 8개가 함께 blue/green 배포된다.**
- **AI 가 검증한 것**: `npm run typecheck` exit 0 · jest `exchanges`·`safety`·`app/api`·`strategy`·`signals` 181스위트 5163건 통과·실패 0(QA 재실행) · `src/lib/safety/`·`src/app/api/orders/` diff 0줄 · 재시도 옵션 켜진 곳 3군데뿐 · GET 울타리 실제 동작 · 신규 로그에 금액·계좌·토큰 없음 · 커밋 훅 실제 통과.
- **AI 가 못 한 것**: 운영 반영 후 실제 KIS 장애 중 복구율(배포 전이라 불가) · 해외 전량 매도 직후 첫 틱의 `overseas.get-balances` 업무실패 유무(오늘 휴장) · lint(이 저장소에 ESLint 설정 없음) · Codex 외부 검토(사용자 전역 설정 모델 미지원 — T-131 19번) · `ORDER_MAX_KRW` 절대 상한이 최종 계산에 걸리는지(QA 미정독, 이번 변경 범위 밖).
- **👉 사용자가 확인할 것**: 배포 후 `pm2-err.log` 에 `[kis-http] 일시 실패 재시도 성공` 줄이 보이는지(= 재시도가 실제로 구해 준 호출). 다음 개장 장중(11-03 월)에 「스냅샷 건너뜀」 텔레그램이 줄었는지. 둘 다 **배포한 뒤부터** 의미가 있다.
- **👉 사용자가 결정할 것**: ① 지금 push(=8커밋 동시 배포)할지, 다른 세션의 배포 창에 맞출지. 권고 — KIS 장애가 진행 중이고 월요일 개장 전에 들어가는 편이 낫다. ② 더 보수적인 쪽(잔고 업무실패 시 주문 한도 0 유지)을 원하면 `portfolio-total.ts` `fallbackFor` 를 되돌리면 된다(어댑터 throw 는 유지해야 한다).
- **남은 일**: 후속 후보 6건(위 「후속 후보」 절) — 특히 `fallbackFor` 나이 상한, `getTicker` 의 HTTP200 업무실패, 숫자형 `rt_cd` 정규화(QA 관찰).
- **이슈·위험**: KIS 장애는 우리가 고칠 수 없다 — 재시도는 **깜박임**을 흡수하지만 장애가 길어지면 여전히 건너뛴다(설계상 "틀린 총액보다 없는 총액"). 재시도로 KIS 호출이 실패당 최대 2건 늘어난다. `cron-runner.sh` 08시 틱 시간 예산은 복합 최악에서만 빡빡해진다(Reviewer L-4, 다른 세션 범위).

---
task_id: T-051
title: 진입 감시 — 가용 현금이 모자라면 선점·주문 시도 없이 건너뛰고 시그널당 하루 한 번만 알린다 (매 분 거부 반복 방지)
status: in-progress
priority: normal
roles_involved: [leader, developer, reviewer, qa]
related_tasks: [T-043, T-046, T-049, T-042]
tags:
  - type/task
  - domain/safety
  - domain/signals
aliases:
  - 현금 사전 점검
  - entry cash precheck
created: 2026-10-19
updated: 2026-10-19
---

# T-051 — 진입 감시의 가용 현금 사전 점검

## 배경

T-046 으로 post-market 카드가 처음으로 주문 경로 끝까지 도달하게 됐다(2026-10-19 16:47 첫 운영 생성 확인). 카드 금액은 10만 원 고정·1주 단위인데 가용 현금은 약 8만 원(2026-10-18 스냅샷)이라, 1주 비용이 현금보다 큰 카드를 승인하면 **선점(T-043) → `submitOrder` → 거래소 거부 → 선점 복귀**가 진입 구간에 있는 동안 **매 분 반복**된다(Reviewer 추정 카드당 하루 최대 약 390회, `orders`/`trade_logs` 행과 KIS 호출 1회씩). 과거에도 자동 주문 거부 1,716건이 쌓인 이력이 있다(마지막 8/12).

돈이 나가는 위험은 아니고 소음·API 호출 낭비 문제다. 사용자는 카드를 승인하지 않는 방법으로 피할 수 있다.

## 사용자 결정 (2026-10-19)

- 대기 항목 목록에 대해 "권고대로 진행해주고 내가 결정해야할 사항 정리해주면 검토해서 알려줄께" — 권고는 **이번 주 안에 진행(서두르지 않음, 오늘 밤 강행하지 않음)**. 배포는 장외에.

## 사양 (Leader)

1. `entry-watcher` 가 **매수** 시그널을 선점하기 **전에** 가용 현금과 이번 주문의 예상 비용(수량 × 가격 + 여유)을 비교한다. 현금이 모자라면 선점·`submitOrder` 를 하지 않고 이번 틱은 건너뛴다(시그널은 `approved_pending_entry` 로 남아 계속 감시되고 만료는 기존대로).
2. **점검은 주문을 더 막기만 한다.** 기존 안전장치(`submitOrder` 의 한도·킬스위치·DRY_RUN 등)의 판정을 바꾸거나 우회하지 않는다. 점검이 "충분"이라고 해도 기존 경로를 그대로 탄다.
3. **잔고를 못 가져오면 기존 동작을 따른다**(이 점검은 편의 기능이지 안전 관문이 아니다 — 잔고 조회 실패로 정상 주문을 막지 않는다). 오류는 로그.
4. **알림은 시그널 하나당 하루 한 번.** 건너뛸 때마다 알리지 않는다. 알림 본문에 시그널 번호·종목·필요 금액·가용 현금·"현금이 채워지면 자동으로 다시 시도됩니다". 알림 중복 방지는 프로세스 로컬 스로틀(`sendAlertThrottled`, 키에 시그널 ID)을 쓰되 재시작 시 초기화되는 한계를 문서에 기록.
5. **건너뛴 사실을 감사 기록(`trade_logs`)에 남길지**는 Developer 가 기존 패턴(예: `sizing_below_min_qty` 가 매 분 1행 쌓이는 문제)을 읽고 판단 — **매 분 1행씩 쌓는 방식은 피한다**(이 task 의 목적이 소음 제거). 로그(console)로만 남기거나 시그널당 하루 1행으로 제한.
6. 매도 시그널은 현금 점검 대상이 아니다. 해외 종목은 통화가 달라 이번 범위에서 **국내(KRW)만** 적용하고 해외는 기존 동작 유지(Developer 가 환율·USD 잔고 경로를 읽고 안전하게 포함할 수 있다고 판단하면 보고 후 포함 가능).
7. 분할 진입(여러 회차)·부분 체결·수량 0(`sizing_below_min_qty`) 같은 기존 분기와의 상호작용을 깨지 않는다.

## 범위 밖

카드 구성(T-053)·청산 정책·텔레그램 스위치·UI 문구.

## Codex C2 (외부 읽기 전용 검토, 2026-10-19)

- judge C2: `codex_required=true` · `adversarial-review` · focus `error_handling` · 규칙 `CX-limit-unknown-r2` · 스위치 on. 인계서 `scratchpad/handoff-T-051-c2.md`, 실행 73초, 스냅샷에서 파일 변경 0. 선점 이후 불변식과 멈춘 `executing` 경보에는 이번 변경으로 인한 직접적인 훼손이 없다고 확인.
- **결함 2건 — 둘 다 Leader 가 `entry-cash-precheck.ts` 코드로 사실 확인, 라운드 3 에서 수정:**
  1. **[high] 8초 상한이 틱당이 아니라 시그널당이었다.** 멈춘 조회(`inFlight`)는 끝날 때까지 공유되는데 뒤따르는 시그널마다 `withTimeout(inFlight, 8초)` 로 새 타이머를 만들어 진입 구간 국내 매수 N개 → N×8초(20개면 ~160초, 1분 cron 틱 겹침). Reviewer R2-1 이 같은 지점을 독립 확인. **수정:** `inFlight = { promise, startedAt }` 공유 마감 — 합류 호출은 `8초 − 경과` 만 기다리고 0 이하면 즉시 판단불가(기존 경로). 시험: 멈춘 조회 + 4개 순차 호출의 총 경과가 정확히 8,000ms·KIS 조회 1건.
  2. **[medium] 비정상 `free` 가 확정적 현금 0원이 됐다.** `Number('')`=0·`Number(null)`=0 이 `isFinite && >= 0` 를 통과 → 정상 주문을 막고 0 이 30초 캐시. **수정:** `parseCashAmount` — 변환 전 원시 타입 검증(숫자는 유한한 0 이상, 문자열은 trim 후 `^\d+(\.\d+)?$`), 그 밖은 판단불가. 진짜 0(`0`, `'0'`)은 현금 0 유지.
- judge C3: `codex_required=false`(`codex_calls_used=1`, 지적이 독립 Reviewer 의 R2-1 과 일치·수정이 같은 파일 안) → Codex 재호출 생략, Reviewer 3라운드 재검증으로 갈음.

## Reviewer

- [18:26] 범위·방법: 대상 4개 파일의 SHA-256 앞 12자리가 Leader 표와 일치(`dcc524981134`·`d9701eff2fe1`·`65ec3ee512ab`·`14de38dea4fa`, 작업 트리와 격리 사본 모두) [확실]. 작업 트리 소스는 수정하지 않았고, 실행·변이는 격리 사본 `scratchpad/t051repo` 에서만 한 뒤 원복해 해시를 다시 대조했다. 작업 트리에 섞인 타 세션 미커밋 변경(`kis-http.ts` 호출 기록, `fx.ts`, `service.ts` 주석 1줄 등)은 감사 대상이 아니며 T-051 동작을 바꾸는 의미 변경이 없음을 diff 로 확인했다. 기준 HEAD 는 지금 `b427719`(T-054 테스트 커밋)이고 `route.ts` 의 HEAD 해시는 `d48a266e1a10` 그대로다.
- [18:26] 직접 실행(격리 사본): entry-watcher 5개 스위트 91/91 · `npx tsc --noEmit` exit 0 · 전체 `npx jest` 148 스위트 3,188 테스트 통과 [확실]. 기존 테스트 4개(`claim`·`sizing`·`unknown-outcome`·`fakeSignalsDb`)는 HEAD 와 diff 없음 [확실]. 그 목에는 `getBalancesDetailed` 가 없어 `TypeError` 가 `readDomesticAvailableCashKRW` 의 try/catch 에 잡혀 null(판단불가)로 가고, 이것이 기존 경로 회귀망으로 실제로 작동한다.
- [18:26] 확인 1(T-043 불변식): `git diff HEAD -- route.ts` 를 줄 단위로 읽었다 [확실]. 변경은 import·상수, outcome 유니온 1항목, `reportCashShortOnce` 신규 함수, `orderReq` 생성 뒤·선점 앞의 점검 블록(`route.ts:392-413`), 응답 요약 로그 1항목뿐이다. 삭제 2줄은 `'claim_lost';` 의 구문 변경과 요약 로그 끝의 `,`→`+` 이다. `claimEntrySignal`·`submitOrder` 호출 인자·`giveBackEntryClaim`·결과 불명 잠금·후처리 분기는 바이트 단위로 불변이다. 선점 전 새 코드에 던질 수 있는 호출이 없다: 현금 읽기는 모든 예외를 null 로 바꾸고(`entry-cash-precheck.ts:97-106`), 판정·수량 추정은 순수 함수이며, 알림·기록은 전체가 try/catch 다(`route.ts:133-163`). 건너뛸 때 시그널 상태를 건드리지 않고 `continue` 하므로 만료 처리(루프 맨 앞)는 다음 틱에 그대로 돈다.
- [18:26] 확인 2("더 막기만"): `sufficient`·`unknown` 이면 새 코드가 하는 일은 `console.warn`(unknown 일 때) 뿐이라 이후 호출 순서·인자가 기존과 같다 [확실]. `insufficient` 조건은 `cash >= required` 의 부정이라 같으면 충분이고 1원 부족이면 부족이다(`entry-cash-precheck.ts:69`). 비용 식은 사이징이 정한 수량(없으면 어댑터와 같은 `floor(금액/가격)`)과 추격이 반영된 `orderReq.price` 를 쓰며, 어댑터의 수량 파생(`kis-domestic.ts:269`)과 일치한다. 추격 0.3% 를 켠 임시 통합 테스트로 필요액이 98,592원(추격 무시면 98,297원)임을 확인했다 [확실]. 어댑터는 호가단위로 **반올림**(`kis-domestic.ts:257-258`)해 최대 반 틱(밴드 하단에서 약 0.125%)이 오를 수 있고 수수료 약 0.015% 가 붙는데, 여유 0.2% 가 이를 덮는다. 즉 추정은 실비용 이상이고 차이는 최대 약 0.2% 라서 정상 주문을 막는 구간은 그 폭(10만 원 카드 기준 약 200원)뿐이다. 현금 개념(`prvs_rcdl_excc_amt` = D+2 반영 예수금)이 틀려도 통과 쪽 오차는 거래소 거부로 귀결되는 기존 동작이다.
- [18:26] 확인 3(비용·장애 격리): 점검은 국내 매수 + 시장 개장 + 구간 안 + 분할 게이트 통과 + 수량 0 아님 뒤에만 불리므로(`route.ts:307-396`) 평소 틱엔 0회다 [확실]. 틱 간격은 `sleep 60`+처리 시간(`cron-runner.sh:194`)이라 30초 TTL 캐시는 사실상 같은 틱 안의 시그널끼리만 공유한다 → "입금 직후 최대 30초 막힘"은 실제로는 0 에 가깝다 [확실]. 실패한 프라미스는 캐시에 남지 않는다: IIFE 가 던지지 않고 null 을 캐시하며 `.finally` 가 `inFlight` 를 비운다(해제 누락 변이 R7 은 사망). 같은 틱에서 앞 시그널이 쓸 현금을 빼지 않아 뒤 시그널은 옛 값으로 판정되지만 그 방향은 통과다(현금 100,000원·카드 2개 임시 테스트에서 둘 다 `submitOrder` 까지 감) → 기존 동작과 같다. 현금 읽기 한 번은 `getBalancesDetailed()` 라 국내 1 + 해외·환율 포함 KIS 호출 약 3~5건이다(R-2).
- [18:26] 확인 4(알림·감사): 키 `entry-watcher:cash-insufficient:<signalId>`, TTL 24시간(`route.ts:34`), `trade_logs`(`entry_cash_insufficient`, 23자 ≤ `varchar(32)` 실측) 1행은 `sendAlertThrottled` 가 true 일 때만 쌓인다 [확실]. 알림·기록 실패는 삼켜 틱을 멈추지 않고(INSERT 만 실패하는 임시 테스트로 확인), 본문에는 시그널 번호·종목명(`getSymbolLabel` 이 이스케이프, 실패 시 `escapeAlertText`)·금액·현금뿐이라 자격증명·계좌번호가 없다. 재시작 시 스로틀 초기화 한계는 코드 주석(`route.ts:33`)과 Developer 기록에 있다.
- [18:26] 확인 5(범위): 매도·해외 매수는 점검하지 않고 잔고 조회도 하지 않는다 — 테스트 (e)가 고정하고 변이 M7·M7b 가 죽는다 [확실]. `cash_insufficient` 를 소비하는 코드는 `route.ts` 응답 요약 로그 한 곳뿐이다(`grep` 전수). 현재 운영 설정은 `safety_dry_run=false`·`safety_kill_switch=false`(읽기 전용 SELECT)라 DRY_RUN 영향은 이론적이다. DRY_RUN 에서는 현금이 모자란 시그널의 모의 주문 행이 생기지 않아 관찰 기록이 준다(INFO).
- [18:26] 확인 6(변이): Developer 의 17종을 `mutate_t051.py` 로 재현해 17/17 사망을 확인했다 [확실]. 직접 만든 17종(`scratchpad/mutate_r051_reviewer.py`)은 10종 사망(KRW 행 없음을 현금 0 으로·분할 게이트를 점검 뒤로·`inFlight` 해제 누락·여유 음수/5%·ceil→floor·부족인데 계속 진행·locked 합산·알림 스로틀 무력화·판단불가를 건너뜀으로), 7종 생존(R-1 의 R3·R4·R4b·R5·R6 비등가 5종, R13 비등가 1종, R14 등가 1종).
- [18:26] R-1 [MINOR][확실] 테스트 회귀망 공백 — 구현은 맞는데 아래 변이가 살아남는다. ① 추격 반영(R4·R4b): 모든 라우트 테스트가 `limitChasePct: 0`(`cash-precheck.test.ts:25`)이라 판정 가격을 `basePrice`·`currentPrice` 로 바꿔도 통과한다. 사양 2 가 명시한 항목이다. ② 알림 TTL 24시간(R3): `60 * 1000` 으로 바꿔도 통과(시간 모사 없음). ③ INSERT 만 실패하는 경우(R6): 테스트 `:128-135` 는 `sendAlert` 가 먼저 던져 INSERT 에 도달하지 않으므로 `db.failOn` 이 실제로는 쓰이지 않는다. ④ 시그널에 명시 수량이 있는 매수(R5): 모든 픽스처가 `quantity: null` 이고 국내 매수 시그널 중 수량 명시는 6건(전체 12,605건 중, 읽기 전용 집계)이다. 임시 통합 테스트로 네 경우 모두 현재 구현이 올바름을 확인했다. 권고(비차단): 각 1건씩 테스트 추가.
- [18:26] R-2 [MINOR][확실(코드)·가능성 높음(영향)] 현금 읽기가 `getBalancesDetailed()`(`kis.ts:77-97`)라 국내가 필요한데도 해외 잔고·환율(`kis-overseas.ts:262-278`, 잔고가 0 이면 폴백 호출 1건 추가)을 `Promise.all` 로 같이 기다린다. 해외·환율이 느리면 국내 매수의 선점 전 구간이 그만큼 늘고, 통신 구간 `timeoutMs` 가 지정돼 있지 않아(`kis-http.ts` 기본 무제한, 유량 대기만 30초 상한) 최악엔 cron-runner 직렬 루프가 오래 붙잡힌다. 알려진 `--max-time` 부재 백로그와 같은 부류이며 기존 `getTicker`·`submitOrder` 한도 산정도 같은 노출이 있어 새 종류의 위험은 아니다. 다만 해외 장애가 국내 진입에 끼어드는 결합은 새로 생겼다. 안전 방향은 아니다(막기만 한다는 성질은 유지). 권고: 국내 어댑터 잔고만 읽거나(`post-market-engine.ts:14` 가 어댑터를 직접 import 하는 선례가 있다), 점검에 8~10초 `Promise.race` 상한을 두고 초과 시 null 로 처리.
- [18:26] R-3 [INFO][확실] 점검이 모르는 현금: 같은 틱에서 앞 시그널이 쓸 금액, 접수됐으나 미체결인 매수가 묶은 금액. 둘 다 통과 방향으로만 틀리고 그 경우 기존대로 거래소 거부 + 선점 복귀가 반복된다. 이 task 의 목적(매 분 거부 반복 제거)은 그 경우엔 달성되지 않지만 사양 3·Developer 의 남은 위험 ⓐⓒ 와 일치하며 기존보다 나빠지지 않는다.
- [18:26] R-4 [INFO][가능성 높음] 현금 매수 전용 가정(확인 7) — 계좌 이력으로 본 근거: `orders` 의 매수 165건은 전부 blocked(83)·rejected(82)이고 접수·체결은 0건이다 [확실]. rejected 중 12건(2026-08-12 15:13~15:29, 096770 지정가 1주 122,308.5원)은 전부 KIS 응답 "주문가능금액을 초과 했습니다"(`blocked_by=insufficient_balance`)인데, 같은 날 스냅샷의 KRW free 는 78,218원이고 보유 주식은 약 1,800만 원이었다 [확실]. 즉 현금 78k < 주문 122k 인 주문을 증거금·미수·대용(보유 주식)으로 받아주지 않았다 → 이 계좌는 현금 한도로 동작한다고 본다. 단 그 종목의 증거금률이 100% 였을 가능성은 배제하지 못한다 [추측]. 스냅샷 KRW 값은 같은 `kis-domestic.getBalances` 의 free 이므로 점검 현금과 같은 개념이고, 120일치 스냅샷 2,618건에 현금 0 이상치는 없다(읽기 전용 집계). 반대 방향(비용 ≤ 현금인데 거부)의 이력은 없으나, 이 DB 에는 API 매수 접수 이력 자체가 0건이라 "비용 ≤ 현금이면 접수됨"은 이 계좌에서 실측된 적이 없다. 점검은 통과 방향이라 기존 경로 그대로지만, 배포 후 현금이 충분한 첫 카드의 접수 여부를 QA 가 확인하길 권한다.
- [18:26] R-5 [NIT] ① `getSymbolLabel` 의 `stock_meta` 조회가 스로틀 판정 전에 건너뛴 틱마다 실행된다(`route.ts:138`, 시그널당 분당 쿼리 1건 — 무시 가능). ② 알림 문구 "시그널당 하루 한 번만"은 재시작·배포 시 재알림이 가능하다는 사실과 어긋난다(코드 주석·이력서에는 기록). ③ 파일 상단 흐름 주석(`route.ts:1-14`)에 새 단계가 없다. ④ 변이 R14(국내 ok 검사 제거) 생존은 등가 — 실제 `getBalancesDetailed` 는 국내 실패 시 KRW 행이 없어 `!krw` 가 같은 결과를 낸다. ⑤ 변이 R13(실패 null 이 만료되지 않음) 생존 — 실패 뒤 회복 테스트가 없다(영향은 점검 비활성 = 기존 동작).
- [18:26] QA 에 넘기는 high_risk_areas: `route.ts:392-413`(선점 앞 블록, 선점·`submitOrder` 가 불리지 않는지), `entry-cash-precheck.ts:76-82`(국내 실패·KRW 행 없음이 현금 0 으로 읽히지 않는지)·`:94-108`(캐시·동시 호출), `route.ts:133-163`(알림·기록 1회성). 배포 후 장중 확인: `CASH_INSUFFICIENT`·`cash_insufficient=` 로그, 시그널당 `entry_cash_insufficient` 행이 재시작 횟수+1 이하인지, 현금 부족 시그널에 새 `orders` 행이 생기지 않는지, 현금이 충분한 카드는 평소처럼 선점·접수되는지.
- [18:27] 1라운드 결론: pass (이전 해시 `dcc524981134`·`d9701eff2fe1`·`65ec3ee512ab`·`14de38dea4fa` 기준). 이 줄은 판정 줄이 아니며 아래 2라운드 재감사로 갱신됐다.
- [18:41] 2라운드 재감사(Leader 결정으로 Developer 가 R-1·R-2·NIT 반영). 해시 대조: `route.ts` `190b588641c3`·`entry-cash-precheck.ts` `ebb50fba8d71`·`entry-cash-precheck.test.ts` `3525963f36eb`·`cash-precheck.test.ts` `c91c446997eb` — 작업 트리와 격리 사본 모두 4/4 일치 [확실]. 작업 트리 소스는 수정하지 않았고 변이·임시 테스트는 격리 사본에서만 한 뒤 원복해 해시를 다시 대조했다. 격리 사본 실행: 5개 스위트 100/100 · `tsc --noEmit` exit 0 · 전체 148 스위트 3,197 테스트 통과 [확실].
- [18:41] route.ts 불변 범위 재확인 [확실]: `git diff HEAD` 의 hunk 6개 중 점검 블록 hunk 는 1라운드와 같은 +23줄이고, 선점 이후 코드는 요약 로그 hunk 밖에 변경이 없다. 이번 라운드의 route.ts 변경은 상단 흐름 주석 4-1단계와 알림 문구 한 줄뿐이다. 두 문구 모두 사실과 맞다: 4-1단계는 "조회 실패·8초 초과"에서 기존 경로로 간다고 적었고 코드가 그렇게 동작하며, 알림 문구 "시그널당 하루 한 번 보냅니다(재시작 시 다시 알릴 수 있음)"는 24시간 스로틀과 프로세스 로컬 한계에 일치한다. `getSymbolLabel` 조회 순서는 `notify/` 수정 금지 때문에 한계로 남겼고 수용한다(NIT 유지).
- [18:41] 8초 상한 설계 공격 결과(`entry-cash-precheck.ts:98-146`, 임시 테스트 7건): ① unhandled rejection 없음 [확실] — `inFlight` 프라미스도 `limit` 프라미스도 reject 하지 않는다(조회 예외는 IIFE 안에서 삼키고 상한 초과 뒤 늦게 reject 해도 조용히 처리됨, 늦은 reject 를 흘려 보낸 임시 테스트에서 `unhandledRejection` 0건). ② 타이머 누수 없음 [확실] — 성공·실패·상한 초과 세 경우 모두 종료 후 남은 타이머 0(가짜 시계 `getTimerCount`). ③ 경계 [확실] — 7,999ms 에 도착한 값은 호출자에게 쓰이고 캐시되며, 8,000ms 이후 도착한 값은 호출자에게 null·미캐시다. 마감 타이머(`late`)가 호출자의 상한 타이머보다 먼저 만들어져 같은 시각이면 먼저 발화하므로 "값은 캐시됐는데 호출자는 null 을 받는" 경합은 구조상 없다. 반대로 마감 직후·호출자 타이머 직전의 1ms 안에 끝난 값은 호출자가 받지만 캐시되지 않을 수 있다(무해). ④ 해외·환율 지연이 지속될 때 [확실]: 느린(20초) 조회는 매 틱 null·미캐시이고 다음 틱엔 새 조회를 시작하며, 영구 무응답이면 걸린 요청 위에 새 요청을 쌓지 않고 틱마다 8초 기다린 뒤 null 이다 → 점검이 사실상 꺼져 기존 경로(현금 부족이면 종전처럼 매 분 거래소 거부)로 돌아가는 의도된 열화이며 "막기만 한다"는 성질은 유지된다.
- [18:41] R2-1 [MINOR][확실(임시 테스트 실측)] 8초 상한이 시그널이 아니라 **호출마다** 적용되고 상한을 넘긴 null 은 캐시되지 않아, 조회가 응답하지 않는 틱에서 진입 구간의 국내 매수 시그널이 N개면 선점 전 대기가 N × 8초로 누적된다(3개 → 24초, KIS 요청은 1건만 나감). 주문이 나가는 안전 성질은 그대로지만 cron 직렬 루프의 해당 틱이 그만큼 늘고 뒤쪽 시그널의 선점이 늦어진다. 해외·환율이 계속 느린 동안 반복된다. 권고(비차단): 상한을 넘긴 호출이 나오면 같은 TTL(30초) 동안 null 을 짧게 캐시하거나, 이미 `late` 인 진행 중 조회에는 기다리지 않고 바로 null 을 돌려준다. Developer 남은 위험 ⓖ 는 "틱마다 최대 8초"로 적었는데 실제 상한은 틱당이 아니라 시그널당이다.
- [18:41] 새 테스트 4군데 변이 재현 [확실]: R-1 변이 6종(알림 TTL 60초·48시간, 추격 무시, 판정 가격 currentPrice, 명시 수량 무시, INSERT 실패만 전파)은 이전 테스트로는 생존했던 것이 새 테스트로 모두 사망(각 1건 실패)했다. 상한 관련 변이(상한 제거·늦은 결과 캐시·상한 80초·마감 표시 안 함·상한 초과를 현금 0 으로·`inFlight` 해제 누락·상한 0ms)도 모두 사망했다. 생존 4종: 타이머 미정리 2종(호출자 쪽·마감 쪽 — 동작은 같고 누수와, 호출자 쪽은 성공 뒤 8초 지나 "초과" 경고 로그가 거짓으로 찍히는 차이뿐이며 제 임시 `getTimerCount` 테스트는 둘 다 잡음), `inFlight` 해제 가드 제거(운영 경로에서 등가 — `inFlight` 가 비어야만 새 조회가 시작된다), 실패 null 을 캐시하지 않는 변이(KIS 장애 중 시그널마다 재조회, 영향은 호출 수뿐). 모두 NIT 이며 타이머 개수 단언 1줄 추가를 권고한다.
- [18:41] 이월: R-3(같은 틱·미체결 매수가 묶은 현금 미반영 — 통과 방향)·R-4(현금 매수 전용 가정의 계좌 이력 근거, 접수 이력 0건)는 INFO 로 변동 없고 비차단이다. QA high_risk_areas 에 `entry-cash-precheck.ts:98-146`(상한·late 캐시)을 추가한다.
- [18:41] 2라운드 결론: pass (해시 `190b588641c3`·`ebb50fba8d71`·`3525963f36eb`·`c91c446997eb` 기준). 이 줄은 판정 줄이 아니며 아래 3라운드 재감사로 갱신됐다.
- [18:53] 3라운드 재감사(Codex C2 지적 2건 반영: 공유 마감, 현금 원시 타입 검증). 해시 대조: `entry-cash-precheck.ts` `3eefe69cbffd`·`entry-cash-precheck.test.ts` `03a97a9d042d`·`cash-precheck.test.ts` `4882aaff99e2`·`route.ts` `190b588641c3`(2라운드와 동일) — 작업 트리와 격리 사본 4/4 일치 [확실]. 작업 트리 소스는 수정하지 않았고 변이·임시 테스트는 격리 사본에서만 한 뒤 원복·삭제하고 해시를 다시 대조했다. 격리 사본 실행: 5개 스위트 134/134 · `tsc --noEmit` exit 0 · 전체 148 스위트 3,255 테스트 통과, 기존 테스트 4개는 HEAD 와 diff 없음 [확실]. `route.ts` 는 `git diff HEAD` 가 2라운드와 같은 +74/−2이고 점검 블록·선점 이후 코드 불변이다 [확실].
- [18:53] 공유 마감 공격(`entry-cash-precheck.ts:131-154`, 가짜 타이머 임시 테스트) [확실]: ① 멈춘 조회에 시그널 4개가 순차로 붙으면 총 경과가 정확히 8,000ms(7,999ms 엔 미완료)이고 KIS 조회는 1건, 종료 후 남은 타이머 0. ② 3초 시점 합류는 남은 5,000ms 만 기다리고 8,000ms 정각 합류는 0ms 에 null. ③ `inFlight` 는 성공·실패·늦은 도착 모두 끝나면 시작 시각째 정리되고 다음 호출은 새 조회를 시작한다(조회 4건 확인). ④ 응답이 끝내 없는 경우: 처음 8초 뒤부터 이후 모든 틱(60초 간격 5회 확인)이 0ms 에 null 이고 새 요청을 쌓지 않으며 타이머·메모리는 상수다 → 점검이 꺼져 기존 경로로 돌아가는 의도된 열화이고 null 은 `unknown` 이라 주문을 더 막지 않는다. 해소는 걸린 KIS 요청이 스스로 끝나는 시점에 달려 있다(통신 구간 `timeoutMs` 미지정이라 Node 기본 타임아웃에 의존 [추측: 약 300초]). 느리지만 끝나는 조회는 늦은 값을 캐시하지 않아, 끝난 뒤 도착한 시그널이 새 조회와 새 8초를 쓸 수 있다 — 틱당 대기는 8초의 작은 배수로 묶이며 N 배로 늘지 않는다 [가능성 높음].
- [18:53] R3-1 [NIT][확실(임시 테스트 실측)] 시계 기준: 남은 시간은 벽시계(`Date.now`)로 계산하고 타이머는 단조 시간이라, 조회가 걸린 동안 벽시계가 **뒤로** 점프(NTP step)하면 합류 호출의 `remaining` 이 점프 크기만큼 커져 조회가 끝날 때까지 최대 그만큼 기다린다(1시간 뒤로 점프 시 10초 뒤에도 미완료를 확인). 앞으로 점프하면 즉시 null 로 안전하다. 드문 조건이라 비차단이며 `Math.min(timeoutMs, …)` 로 한 줄 상한을 두길 권한다. 같은 이유로 캐시 TTL 비교(`now() - cache.at`)도 벽시계에 의존한다(1라운드부터).
- [18:53] `parseCashAmount` 공격(임시 테스트 표 34행) [확실]: `'+5'`·`'5.'`·`'.5'`·`'٣'`(비ASCII 숫자)·`'５'`(전각)·`'0x10'`·`'1e3'`·`'1_000'`·`'1,000'`·빈/공백 문자열·`null`·`undefined`·boolean·`NaN`·`Infinity`·음수·`'-0'`·`BigInt`·`String`/`Number` 객체·배열·`{}` 는 모두 null(판단불가)이다. 진짜 0(`0`·`'0'`·`-0`)은 현금 0으로 구분된다. 앞뒤 공백·탭·개행은 걷고 유효하면 받는다. 300자리 숫자 문자열은 유한한 `1e300` 이라 `sufficient`(통과 방향)로 가며, 더 길어 `Infinity` 가 되면 `judgeEntryCash` 가 `unknown` 으로 떨어뜨리는 이중 방어가 있다.
- [18:53] R3-2 [MINOR][확실(코드 읽기)] Codex MEDIUM ② 의 **원인 지점은 이 4개 파일 밖에 있다.** `kis-domestic.ts:225` 는 `Number(summary.prvs_rcdl_excc_amt ?? total)` 로 KIS 필드가 빈 문자열 `""` 이면 어댑터에서 이미 0 으로 바꿔 `free: 0` 을 만든다(`??` 는 `""` 를 건너뛰지 않는다). `parseCashAmount` 는 그 **이후**의 `free` 값만 검증하므로 `free: null`·`''` 같은 값은 막지만, 정작 KIS 가 빈 필드를 주는 경우는 `free: 0` 으로 정상 도착해 여전히 확정적 현금 0원(insufficient)이 된다. 실제로 KIS 가 `""` 를 주는지는 이 계좌에서 확인하지 못했다 [추측: 평소 `"0"` 을 줌; 120일치 스냅샷 2,618건에 현금 0 은 없음]. 그 경우의 피해는 정상 주문이 막히고 "가용 현금 0원" 알림 1회뿐이며 안전장치는 유지된다. 어댑터 수정은 포트폴리오 표시·총액에도 닿고 `src/lib/exchanges/` 안전 경로라 이 task 범위 밖이다 → 별도 task 로 분리하길 권한다(어댑터에서 같은 원시 타입 검증, 또는 `free===0` 이면서 `dnca_tot_amt` 도 0 일 때만 0 으로 인정).
- [18:53] 변이 재현 [확실]: 3라운드 대상 변이 25종 중 24종 사망 — 공유 마감 제거·남은 시간 ≤0 즉시 null 제거·`<0` 경계·합류 계산에 현재 시각 사용·시작 시각 0 기록·정리 누락·정규식 앵커(둘 다/시작/끝)·빈 문자열 허용·null→0·`'1e3'` 허용·문자열/숫자 0 을 판단불가로·boolean 허용·`Number(krw.free)` 복원·trim 제거·음수 허용·마감/race 타이머 미정리·첫 호출 상한 제거·늦은 결과 캐시·상한 초과를 현금 0 으로·합류 즉시 null 대신 0 — 이 24종이 모두 사망했다. 1·2라운드의 알림 TTL·추격 무시·INSERT 전파·점검 제거·판단불가를 부족으로 변이 5종도 사망을 다시 확인했다. 생존 1종은 정리 가드(`inFlight?.promise === p`) 제거로 운영 경로에서 등가다(`inFlight` 가 비어야만 새 조회가 시작되고 다른 해제 경로는 테스트용 초기화뿐이다).
- [18:53] 이월: R-3·R-4(INFO)와 R2-1(시그널당 8초 누적)은 R2-1 이 해소(총 8,000ms 실측)됐고 나머지는 변동 없이 비차단이다. QA high_risk_areas 에 `entry-cash-precheck.ts:80-95`(원시 타입 검증)·`:131-154`(공유 마감)를 추가한다.
- [18:53] **최종 판정: PASS (scope: src/app/api/cron/entry-watcher/route.ts, src/lib/signals/entry-cash-precheck.ts, src/lib/signals/__tests__/entry-cash-precheck.test.ts, src/app/api/cron/entry-watcher/__tests__/cash-precheck.test.ts)**

## Leader 기록

- [10-19] 등록. judge 접수: `local_fix` · 복잡도 1.41 · 위험 R2 · developer opus · 데모 불필요 · 다음 `assign`.
- [10-19 19:5x] Developer 구현 → Reviewer 1차 PASS → 라운드 2(8초 상한·테스트 공백 4건) → Reviewer 2차 PASS → judge C2 → Codex(high 1·medium 1) → 라운드 3 수정 → judge C3 → Reviewer 3차 **PASS**(변이 25종 중 24 사망·1 등가; `parseCashAmount` 34행 입력 표 전부 안전한 쪽; 공유 마감 총 8,000ms). 해시 `route.ts` `190b588641c3` · `entry-cash-precheck.ts` `3eefe69cbffd` · 단위 테스트 `03a97a9d042d` · 라우트 테스트 `4882aaff99e2`.
- [10-19] **이월(비차단):** R3-1 NIT — 남은 시간을 벽시계(`Date.now`)로 재는데 타이머는 단조 시간이라 조회 중 벽시계가 뒤로 점프하면 합류 호출이 점프 크기만큼 더 기다림(`Math.min(timeoutMs, …)` 한 줄 상한 권고). **R3-2 MINOR(이 task 밖, 별도 task 후보):** 어댑터 `kis-domestic.ts:225` 의 `Number(summary.prvs_rcdl_excc_amt ?? total)` 가 KIS 가 빈 문자열을 주면 이미 `0` 으로 바꿔 `free: 0` 이 되고 `parseCashAmount` 는 그 이후 값만 검증 → 이 경로의 0 은 막지 못함(정상 주문 차단 + "가용 현금 0원" 알림 1회). KIS 가 실제로 `""` 를 주는지는 미확인 [추측: 평소엔 `"0"`; 120일치 스냅샷 2,618건에 현금 0 없음]. 어댑터는 포트폴리오 표시·총액에도 쓰이는 안전 경로라 분리 권고. 알려진 한계: KIS 요청이 끝내 응답하지 않으면 재시작 전까지 현금 점검이 꺼짐(기존 경로로 열화, 주문을 더 막지 않음).
- [10-19] 배포 후 확인(QA 인계): ① `pm2 logs stockinvest-cron` 의 `CASH_INSUFFICIENT`·`cash_insufficient=` ② 현금이 충분한 첫 카드 승인 시 접수 여부 — 이 계좌에서 "비용 ≤ 현금이면 접수됨"은 실측된 적 없음(과거 매수 165건 전부 blocked/rejected).

## Developer

- [18:11] 상태 DONE(미커밋). 기준 HEAD `22aa440`. 작업 트리의 대상 파일(`route.ts`)은 HEAD 와 같았다(타 세션 변경 없음 확인). 격리 사본 `scratchpad/t051repo` 에서 검증.
- [18:11] 변경 파일 (SHA-256 앞 12자리, 작업 트리 = 격리 사본 일치):

  | 파일 | 구분 | SHA-256 |
  |---|---|---|
  | `src/app/api/cron/entry-watcher/route.ts` | 수정 (+72/−2, HEAD `d48a266e1a10`) | `dcc524981134` |
  | `src/lib/signals/entry-cash-precheck.ts` | 신규 | `d9701eff2fe1` |
  | `src/lib/signals/__tests__/entry-cash-precheck.test.ts` | 신규 (19건) | `65ec3ee512ab` |
  | `src/app/api/cron/entry-watcher/__tests__/cash-precheck.test.ts` | 신규 (24건) | `14de38dea4fa` |

  기존 테스트(`claim`·`sizing`·`unknown-outcome`·`fakeSignalsDb`)는 **수정하지 않았다** — 그 파일들의 `kis` 목에는 `getBalancesDetailed` 가 없어 점검이 "판단불가 → 기존 경로"로 가고, 그 자체가 사양 3의 회귀망이 된다(실 KIS 호출 없음).
- [18:11] 현금 출처 근거: ① `src/lib/exchanges/kis.ts:77` `getBalancesDetailed()` — 시장별 성공/실패 보존(`kis.ts:111` `getBalances()` 는 해외만 실패해도 던짐) ② 국내 KRW `free` = `kis-domestic.ts:222-228` `prvs_rcdl_excc_amt`(D+2 결제 반영 예수금) ③ 이미 틱 안에서 얻는 값은 없다: `submitOrder` 한도 산정이 `portfolio-total.ts:49` 로 잔고를 읽지만 **총액만** 캐시(`:24` 60초)하고 현금은 노출하지 않으며 `src/lib/safety/` 는 수정 금지 ④ `approval-context.ts:49-72` 의 `portfolio_snapshots` 는 60분 주기(`scripts/cron-runner.sh:116`)·3시간까지 허용(`:38`)이라 입금 후 최대 1시간 정상 주문을 막을 수 있어 배제. → 선택: `getBalancesDetailed()` 의 국내 부분만 쓰고 30초 TTL + 동시 호출 합치기(`entry-cash-precheck.ts` `readDomesticAvailableCashKRW`). 호출 시점은 **국내 매수 + 구간 안 + 수량 ≥ 1 + 분할 게이트 통과** 뒤뿐이라 평소 틱에는 0회.
- [18:11] 호출 비용 [가능성 높음]: 조회 1회 = 국내 잔고 1 + 해외 잔고 1(+환율, USD 0 이면 폴백 1). 현금 부족이 지속되는 틱에서는 기존의 `createOrder` 1회 + `submitOrder` 한도 산정 잔고·보유종목 시세 조회를 대체하므로 순감. 현금이 충분한 경우는 주문 직전 1회 추가(주문 후 시그널이 executing 이 되므로 1회성).
- [18:11] 예상 비용 = `effectiveEntryQuantity`(사이징이 정한 수량, 시장가는 `kis-domestic.ts:269` 와 같은 `floor(금액/가격)`) × `orderReq.price`(추격 반영 지정가, 수정 후 `route.ts:347-352`) × (1 + 0.2%), 원 단위 올림. 여유 0.2% = 호가 반올림 최대 반 틱 ≈0.125%(`kis-domestic.ts:304` `roundToTick`) + 매수 수수료 ≈0.015%. 판정: 현금 ≥ 비용 → sufficient(같으면 sufficient), 미만 → insufficient, 현금/수량/가격 비정상 → unknown(기존 경로).
- [18:11] 위치: `route.ts:396-413` — 사이징·`quantity === 0`(`sizing_below_min_qty`) 분기·분할 게이트 **뒤**, T-043 선점 **앞**. 선점 이후 코드는 한 줄도 바꾸지 않았다. 건너뛰면 `outcome: 'cash_insufficient'` + `continue`(시그널 상태 불변 → 다음 틱 재감시, 만료는 기존 분기).
- [18:11] 기록 방식(사양 5): `recordBelowMinQty`(`service.ts:275-301`)는 호출마다 `trade_logs` 1행이라 진입 구간에 머무는 동안 매 분 1행 쌓인다(확인). 이 task 는 **console 경고 매 틱 + 알림·`trade_logs`(`entry_cash_insufficient`) 1행은 `sendAlertThrottled` 가 실제로 보낸 경우에만**(키 `entry-watcher:cash-insufficient:<signalId>`, TTL 24시간, `route.ts:133-163`). 프로세스 로컬 스로틀이라 **재시작하면 초기화**되어 재시작 직후 한 번 더 알림·1행이 생길 수 있다(배포·재부팅 횟수만큼, 상한 있음). 알림·기록 실패는 잡아서 로그만 — 선점 전 코드라 던지면 틱 전체가 멈춘다. 종목명은 `getSymbolLabel`(내부 이스케이프), 실패 시 `escapeAlertText(symbol)`.
- [18:11] 수정 전 실패 확인: 단위 테스트는 모듈 없음으로 스위트 실패(`scratchpad/t051-red-unit.txt`), 라우트 통합 테스트는 원래 `route.ts` 로 **24건 중 10건 실패**(새 동작 10건: 부족 시 미선점·알림·감사 1행·현금 0·경계·알림 실패 내성·조회 공유·하루 1회·시그널별 키·입금 후 재개), 14건 통과(기존 동작 회귀망 — 충분·킬스위치 거부·판단불가 6종·매도·해외·수량 0·구간 밖·분할 대기) (`scratchpad/t051-red-route.txt`). 구현 후 entry-watcher 5개 스위트 91/91 통과.
- [18:11] 변이 시험 17종 전부 죽음(`scratchpad/t051-mutation.txt`, 격리 사본에서만 실행 후 원복·91/91 재확인): 점검 제거(10 실패) · `>=`→`>`(3) · 부등호 반대(16) · 여유 0(5) · 판단불가를 부족으로(36) · 국내 조회 실패를 현금 0 으로(4) · 조회 예외를 현금 0 으로(31) · 음수 현금 유효 처리(1) · 알림 키에서 시그널 ID 제거(1) · **점검을 선점 뒤로 이동**(4) · 매도도 점검(2) · 해외도 점검(1) · 감사 기록 스로틀 무시(1) · 알림 실패 미처리(1) · 캐시 TTL 0(1) · 건너뛴 뒤 `continue` 누락(6) · 시장가 수량 floor→ceil(1).
- [18:11] 격리 사본 전체 검증: `npx tsc --noEmit` exit 0(오류 0) · `npx jest --silent` **148 스위트 / 3,188 테스트 전부 통과**(`scratchpad/t051-tsc.txt`, `t051-jest.txt`). eslint 는 저장소에 설정 파일이 없어 실행하지 못했다.
- [18:11] 안전장치 self-check: DRY_RUN·KILL_SWITCH·ORDER_MAX·DAILY_MAX·심볼 차단은 전부 `submitOrder` 안에 그대로 있고 이 점검은 그 **앞에서 더 막기만** 한다(충분·모름이면 기존 경로 — 테스트 (b) 킬스위치 거부 유지 확인). 주문 결과의 `orders` 기록 경로 불변. 새 KIS 호출은 잔고 **조회**(읽기)뿐이며 주문 송신 경로를 새로 만들지 않았다.
- [18:11] 사양과 다른 점·판단: ① 해외 매수는 제외(사양 6 기본값). `sizeOrderQuantity` 주석(`service.ts:198-199`)대로 해외 가격 단위(USD/KRW) 가정이 흔들려 비용 추정을 안전하게 할 수 없다고 판단 ② DRY_RUN 에서도 점검이 돈다 — 현금이 모자라면 모의 주문도 생기지 않는다(막는 방향이라 사양 2 에 부합, 다만 DRY_RUN 관찰 방식이 바뀜) ③ 알림 본문에 만료 시각은 넣지 않았다(T-046/T-052 시간대 정리 중이라 오표기 위험).
- [18:11] 남은 위험: ⓐ 미체결 매수 주문이 묶은 현금은 `prvs_rcdl_excc_amt` 에서 빠지지 않는다 → 그 경우 "충분"으로 보고 기존처럼 거래소 거부(매 분 반복은 남음) ⓑ **미수(증거금) 매수가 켜진 계좌라면** 거래소가 받아 줄 주문을 이 점검이 막는다 — 현금 매수 전용 계좌 전제 [추측: 계좌 설정 미확인] ⓒ 같은 틱에서 앞 시그널이 현금을 쓴 뒤 뒤 시그널은 캐시된 옛 현금으로 판정(막는 쪽으로는 틀리지 않음, 거래소 거부로 감) ⓓ 시장가 매수는 거래소가 상한가 기준으로 증거금을 잡아 실제 필요액이 추정보다 크다(이 경우도 "충분"→기존 경로) ⓔ 현금 경계 ±0.2% 구간(10만 원 카드 기준 약 200원)에서는 거래소가 받아 줄 수도 있는 주문을 막을 수 있다 ⓕ 프로세스 재시작 시 알림 스로틀 초기화(위 기록 방식 참고).
- [18:11] Reviewer 인계: 실행 검증은 `cd scratchpad/t051repo && npx jest src/app/api/cron/entry-watcher src/lib/signals/__tests__/entry-cash-precheck.test.ts` (91/91) · 변이 재현 `python3 scratchpad/mutate_t051.py scratchpad/t051repo`. dev 서버 curl 검증은 장중·실계좌 잔고가 필요해 준비하지 않았다(운영 확인은 배포 후 장중 `pm2 logs stockinvest-cron` 의 `CASH_INSUFFICIENT`·`cash_insufficient=` 요약으로).
- [18:35] 2라운드(Reviewer R-1·R-2·NIT 반영, Leader 결정). 상태 DONE(미커밋). 선점 이후 코드·`src/lib/safety/`·`src/lib/exchanges/`·기존 테스트 3종·`fakeSignalsDb` 는 손대지 않았다. R-3·R-4 는 범위 밖.

  | 파일 | Reviewer 가 본 해시 → 새 해시 | 바뀐 줄(변경 전 → 변경 후) |
  |---|---|---|
  | `src/app/api/cron/entry-watcher/route.ts` | `dcc524981134` → `190b588641c3` | 상단 흐름 주석 1단계 추가(→ 9-10) · 알림 문구 1줄(143 → 145). 그 밖 바이트 동일 |
  | `src/lib/signals/entry-cash-precheck.ts` | `d9701eff2fe1` → `ebb50fba8d71` | `CASH_READ_TIMEOUT_MS` 추가(→ 84-90) · 캐시·읽기 함수 재작성(91-107 → 98-146) |
  | `src/lib/signals/__tests__/entry-cash-precheck.test.ts` | `65ec3ee512ab` → `3525963f36eb` | import 1줄(→ 15) · `afterEach` 복원(→ 114) · 시간 상한 테스트 4건(→ 133-167) |
  | `src/app/api/cron/entry-watcher/__tests__/cash-precheck.test.ts` | `14de38dea4fa` → `c91c446997eb` | `getStyleConfig` import(→ 35) · 추격률 초기화(→ 64) · (h)(i)(j)(k) 5건(→ 245-322) |

- [18:35] R-2 시간 상한 설계: `readDomesticAvailableCashKRW(now, timeoutMs = CASH_READ_TIMEOUT_MS = 8_000)`. 호출마다 `Promise.race` 로 자기 상한까지만 기다리고, 넘으면 null(판단불가) → 라우트는 기존 경로. 타이머는 `finally` 에서 항상 정리. **늦은 결과 처리**: 조회를 시작할 때 같은 상한의 마감 타이머가 `late=true` 를 표시하고, 조회가 끝났을 때 `late` 면 **성공·실패 결과 모두 캐시하지 않는다** — 이미 판단불가로 넘어간 뒤 도착한 값이 이후 틱의 "방금 읽은 값"이 되지 않는다. 처음엔 경과 시간 비교로 짰는데 경계(정확히 상한 근처)에서 늦은 값이 캐시되는 것을 테스트가 잡아 타이머 표시로 바꿨다. 상한을 넘긴 조회도 끝날 때까지 `inFlight` 로 공유한다(걸린 KIS 요청 위에 새 요청을 쌓지 않으려고). 그동안 들어온 공유자도 각자 8초까지만 기다린다. KIS 요청 자체는 취소하지 못한다(어댑터에 취소 수단이 없고 `exchanges/` 는 수정 금지) — 기다리지 않을 뿐이다. 국내 어댑터만 직접 읽는 방식은 `exchanges/` 수정 금지·지시에 따라 하지 않았다.
- [18:35] R-1 테스트 추가(`cash-precheck.test.ts`): (h-1) 추격 0.3% 일 때 필요액 98,592원, 현금 98,500원이면 부족·98,592원이면 주문(송신 가격 ≈6,559.62) · (h-2) 명시 수량 5주이면 5 × 6,540 × 1.002 = 32,766원으로 계산(현금 40,000원은 주문, 32,765원은 부족) · (i) `Date.now` 고정으로 23시간 59분 뒤엔 알림·`trade_logs` 1건 그대로, 24시간 1분 뒤 2건 · (j) `sendAlert` 는 정상이고 `trade_logs` INSERT 만 던질 때 다음 시그널(매도)까지 처리되고 건너뛰기 유지 · (k) 조회가 응답하지 않으면 7,999ms 시점엔 대기, 8,000ms 에 기존 경로(선점·`submitOrder`) — 가짜 타이머. 단위 테스트(`entry-cash-precheck.test.ts`): 상한 기본값 8초 · 상한 초과 시 null · 늦은 결과를 캐시하지 않음 · 상한 안 결과는 캐시.
- [18:35] 수정 전 실패 / 변이 생존→사망: R-1 변이 6종을 **Reviewer 가 본 테스트 버전**(`scratchpad/t051pre/`)과 새 테스트로 각각 돌렸다(`scratchpad/mutate_t051_r1.py`, 결과 `t051-r1-mutation-final.txt`): R3 TTL 60초 · R3b TTL 48시간 · R4 추격 무시(basePrice) · R4b 판정 가격 currentPrice · R5 명시 수량 무시 · R6 INSERT 실패만 전파 — **6종 모두 옛 테스트 생존(91/91) → 새 테스트 사망(1 실패)**. R-2 는 테스트를 먼저 써서 옛 모듈로 3건 실패(상수 없음·상한 초과 시 5초 jest 타임아웃 2건, `t051-r2-red.txt`) 확인 후 구현.
- [18:35] 최종 변이 22종 전부 사망(`t051-r2-mutation.txt`): 기존 M1~M12 17종 + T1 상한 제거 · T2 늦은 결과도 캐시(첫 실행은 미사용 변수로 컴파일 실패라 `if (!late || true)` 로 다시 돌려 테스트 실패로 사망 확인) · T3 상한 80초 · T4 마감 표시 안 함 · T5 상한 초과를 현금 0 으로. 원복 후 100/100.
- [18:35] 격리 사본 전체 검증: `npx tsc --noEmit` exit 0 · `npx jest --silent` **148 스위트 / 3,197 테스트 전부 통과**(`t051-r2-tsc.txt`·`t051-r2-jest.txt`). entry-watcher 5개 스위트 + 단위 테스트 100/100, 3회 연속 실행에서 흔들림 없음.
- [18:35] NIT: ③ 상단 흐름 주석에 4-1단계(현금 사전 점검) 추가 ② 알림 문구를 "시그널당 하루 한 번 보냅니다(재시작 시 다시 알릴 수 있음)"로 바꿈 ① `getSymbolLabel` 을 스로틀 판정 뒤로 옮기는 것은 **하지 않았다** — `sendAlertThrottled` 가 제목을 받아 판정과 발송을 한 번에 하고, "보낼지"만 묻는 함수가 없다(`notify/` 는 수정 금지). 한계: 건너뛴 틱마다 `stock_meta` SELECT 1건(시그널당 분당 1건)이 남는다.
- [18:35] 남은 위험 추가: ⓖ 해외·환율 조회가 계속 응답하지 않으면 국내 매수 점검은 틱마다 최대 8초 늦어지고 판단불가 → 기존 경로(현금 부족이면 종전처럼 매 분 거래소 거부)가 된다. 걸린 KIS 요청은 취소되지 않고 끝날 때까지 남는다(새 요청은 쌓지 않음).
- [18:47] 3라운드(Codex C2 HIGH·MEDIUM + Reviewer R2-1 + 타이머 NIT 반영). 상태 DONE(미커밋). 격리 사본은 최신 HEAD `d2d6dd3` 로 새로 만들었다(`git archive HEAD`, 옛 사본은 `scratchpad/t051repo_r2` 로 옮김). `route.ts` 는 이번 라운드에 바뀌지 않았다(선점 이후 코드 포함 불변, HEAD 의 `route.ts` 는 여전히 `d48a266e1a10`). `safety/`·`exchanges/`·`notify/`·T-052 파일 미수정.

  | 파일 | 2라운드 해시 → 새 해시 | 바뀐 줄(변경 전 → 변경 후) |
  |---|---|---|
  | `src/app/api/cron/entry-watcher/route.ts` | `190b588641c3` → `190b588641c3` | 변경 없음 |
  | `src/lib/signals/entry-cash-precheck.ts` | `ebb50fba8d71` → `3eefe69cbffd` | free 검증(80-81 → 80-95 `parseCashAmount`) · `inFlight` 상태에 시작 시각(92 → 106-107) · 설명 주석(102 → 117-122) · 읽기 함수 본문(111-128 → 131-154) |
  | `src/lib/signals/__tests__/entry-cash-precheck.test.ts` | `3525963f36eb` → `03a97a9d042d` | 끝에 추가만(→ 181-301): free 검증 24건 · 공유 마감 6건 |
  | `src/app/api/cron/entry-watcher/__tests__/cash-precheck.test.ts` | `c91c446997eb` → `4882aaff99e2` | 추가만(→ 324-355): (k) 3개 시그널 1건 · (l) 비정상 free 3건 |

- [18:47] 공유 마감 설계(HIGH): `inFlight = { promise, startedAt }`. 조회를 시작한 호출은 상한 전체(8초)를 기다린다. 진행 중 조회에 합류한 호출은 `remaining = timeoutMs − (now() − startedAt)` 만 기다리고, `remaining <= 0` 이면 기다리지 않고 바로 null(판단불가 → 기존 경로)이다. → 멈춘 조회 하나에 시그널이 몇 개 붙어도 그 조회에 쓰는 총 대기는 상한 한 번이다. 조회가 끝나면(성공·실패·늦은 도착) `finally` 가 `inFlight`(시작 시각 포함)를 비우고, 다음 호출은 새 조회를 시작해 상한 전체를 다시 쓴다. 늦은 결과를 캐시하지 않는 보장(마감 타이머 `late`)은 그대로다. `resetEntryCashCache` 는 `inFlight` 째로 비우므로 시작 시각도 함께 초기화된다. 2라운드 기록 ⓖ 의 "틱마다 최대 8초"는 2라운드 코드에선 사실이 아니었다(시그널마다 8초 — R2-1). 이번 수정으로 **조회 하나당 최대 8초**가 됐다.
- [18:47] 비정상 free(MEDIUM): `domesticCashFromBalances` 가 변환 **전에** 원시 타입을 본다(`parseCashAmount`). 숫자는 유한한 비음수만 받는다. 문자열은 `trim` 뒤 `^\d+(\.\d+)?$` 일 때만 받는다. 그 밖(`null`·`undefined`·빈/공백 문자열·boolean·객체·배열·`'12abc'`·`'1e3'`·`'0x10'`·`'-1'`·`'1,000'`·NaN·±Infinity·음수)은 null 이다. 진짜 0(`0`·`'0'`)은 유효한 현금 0원으로 남아 insufficient 가 된다.
- [18:47] 새 테스트: 단위 — free 무효 입력 17종 → null, 유효 7종(0·'0'·숫자·문자열·공백 문자열·소수) · 공유 마감(가짜 타이머): 멈춘 조회 + 순차 4호출의 총 경과 정확히 8,000ms(첫 호출 7,999ms 미완 → 8,000ms null, 뒤 3개는 시간 흐름 없이 null, KIS 조회 1회) · 7,000ms 에 합류한 호출은 1,000ms 만 기다림 · 늦게 끝난 조회 정리 뒤 새 조회는 다시 8,000ms 전체 · 실패 조회도 정리(TTL 뒤 새 조회 8,000ms) · reset 이 진행 중 조회·시작 시각을 비움 · 🔴 타이머 개수 0(성공·실패·상한 초과 뒤 각각 `jest.getTimerCount() === 0`). 라우트 — 같은 틱 국내 매수 3개 + 멈춘 잔고 → 8,000ms 진행만으로 틱 응답이 끝나고 3개 모두 `submitOrder`(잔고 조회 1회) · `free: ''`·`null` → 두 시그널 모두 `submitOrder`(같은 틱 0원 캐시에 막히지 않음)·알림 없음 · `'0'` 은 건너뜀.
- [18:47] 수정 전 실패: 단위 53건 중 10건 실패(free 무효 8종, 공유 마감 2건 — `t051-r3-red-unit.txt`), 라우트 33건 중 3건 실패(3개 시그널, free ''·null — `t051-r3-red-route.txt`).
- [18:47] 변이 생존→사망(`t051-r3-mutation.txt`, 2라운드 테스트 `scratchpad/t051pre3/` 와 새 테스트로 각각 실행): S1 공유 마감 제거(호출마다 새 상한) · S2 `remaining<=0` 즉시 null 제거 · S4 빈 문자열 허용 · S5 null 을 0 으로 · S6 `'1e3'` 허용 · S7b 문자열 `'0'` 을 null 로 · S8 boolean 허용 · S9 옛 `Number(krw.free)` 복원 · T6 race 타이머 미정리 · T7 마감 타이머 미정리 — **10종 옛 테스트 생존 → 새 테스트 사망**. S3 `inFlight`·시작 시각 미정리, S7 숫자 0 을 null 로 처리하는 변이는 옛 테스트로도 이미 사망. 기존 22종(M1~M12·T1~T5)과 R-1 6종(옛→새 생존→사망)을 최종 코드에서 다시 돌려 전부 사망(`t051-r3-mutation-all.txt`). 원복 후 134/134.
- [18:47] 격리 사본(HEAD `d2d6dd3`) 전체 검증: `npx tsc --noEmit` exit 0 · `npx jest --silent` **148 스위트 / 3,255 테스트 전부 통과**(`t051-r3-tsc.txt`·`t051-r3-jest.txt`). 관련 테스트 134/134, 3회 연속 흔들림 없음.
- [18:47] 남은 위험 추가: ⓗ KIS 요청이 끝내 응답하지 않으면(`kis-http` 통신 타임아웃 없음) 그 조회는 프로세스가 살아 있는 동안 `inFlight` 로 남는다. 이후 모든 틱의 점검은 기다리지 않고 판단불가 → 기존 경로가 된다. 막는 방향으로는 틀리지 않고 새 요청도 쌓이지 않지만, 재시작 전까지 점검이 꺼진 셈이다 ⓘ 어댑터(`kis-domestic.ts:225-226`)가 `prvs_rcdl_excc_amt` 의 빈 문자열을 `Number('')`=0 으로 바꿔 **숫자 0** 으로 넘기는 경우는 이 모듈에서 구분할 수 없다(`exchanges/` 수정 금지). 그 경우 현금 0원으로 보고 건너뛴다 [추측: 실제 응답에서 빈 값이 오는지는 미확인].

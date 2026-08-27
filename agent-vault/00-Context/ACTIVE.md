---
project: StockInvest
updated: 2026-08-27
tags:
  - type/context
---
# 현재 상태

## 🔴 2026-08-27 — 운영 중단 발견: `stockinvest-cron`이 죽은 채 pm2는 "online"으로 표기

[[T-036-news-fetch-observability]] 조사 중 부수 발견. **자동매매가 2026-08-24 23:38 이후
2일 11시간 멈춰 있었다.**

- `pm2 jlist` → `stockinvest-cron`: `status=online` 이지만 **`pid=None`**, `ps`에 `cron-runner.sh` 없음.
- 마지막 cron 로그: `~/.node-local/stockinvest/logs/cron-out.log` `2026-08-24 23:38:28`.
- 멈춘 것: `entry-watcher`(**진입 도달 시 자동 주문 실행**)·`holding-checker`·`strategy-eval`·
  `signal-followup`·`signal-expiry`·`portfolio-snapshot`·`trade-report` **전부**.
- 같은 유령 상태: `n8n`, **`webhook-deploy`** ← 08-19·08-23 두 차례 관측된 "webhook 미발화"의 원인.
- 앱 본체(`stockinvest`, pid 7705 next-server)는 **정상** — `/api/health` 200, 3003 리스닝.
- **기동은 자금이 걸린 자동주문을 되살리는 행위라 에이전트 판단으로 실행하지 않았다 — 사용자 승인 필요.**
- 워크스페이스 메모리의 기존 gotcha(`pm2 "online"≠실제 응답`, 2026-08-22 HOME-SERVER)와 **동일 실패모드 재발**.
  pm2 유령이 3개 프로세스에 걸쳐 있으므로 **근본 대응은 HOME-SERVER(인프라) 소관**이다.
- **2026-08-27 완결**: 사용자가 직접 재기동 완료(10:51:23, pid 1193580).
  [[T-037-cron-outage-impact-and-watchdog]]가 후속 조사·재발방지를 마쳤다 — **실매매 피해 0건**
  확인(만료 시그널 뒤늦은 오발주는 구조적으로 불가능함을 코드로 확인). **원인은 2단**: ①08-24
  23:39 호스트 급사(원인 불명, OOM 아님) ②08-25 09:54 재부팅 시 pm2가 NFS 마운트보다 11초 먼저
  떠 fork 모드 `stockinvest-cron`이 `spawn ENOENT`로 영구 유령화 — **08-22부터 재부팅마다 반복돼
  온 구조적 결함**이고 `check-and-recover.sh`가 이를 놓치고 "전체 정상"으로 오판정했다(원인은
  이미 그 스크립트 헤더 주석에 적혀 있었음 — 대응이 우회책이었을 뿐). **재발방지 워치독**
  (`scripts/cron-runner.sh` 하트비트 + `src/instrumentation.ts`/`src/lib/ops/cron-watchdog.ts`,
  자금경로 완전 격리) 구현·Reviewer PASS·QA 검증통과까지 완료, **배포는 사용자 승인 대기**(빌드+
  cron 먼저 재기동→앱 재기동 순서 필요). HOME-SERVER 소관 근본원인(pm2 서비스 유닛 순서 —
  `RequiresMountsFor` 필요, 등록부 스키마 확장, 상시 순찰 전환) 3건은 diff 제안만 하고 별도
  세션 인계 권고. `scripts/.nfs*` 잔여파일 2개(08-19 생성, 이번 건과 무관) 정리 여부도 사용자
  판단 필요. 상세는 task 파일 "최종 요약" 참조.

## 🔨 2026-08-27 — [[T-036-news-fetch-observability]] 진행 중: news-fetch 107일 무성 실패

[[T-031-news-fetch-m4-500]](done으로 승계 종료) 후속. **마지막 성공 2026-05-13, 이후 107일간
매일 실패했고 아무도 몰랐다** — 실측 누적 실패 12,060건 / 성공 2건.

- **근본원인(home-m4-api 소유)**: Redis에 `kbcoll:<name>` 메타가 없고 Qdrant에는 컬렉션이 있는
  불일치 상태에서 `create_collection`이 Qdrant **409**를 받는데, 이는 `ValueError`가 아니라
  `UnexpectedResponse`라 미포착 → 500. 배포본 트레이스백 줄번호가 NFS 사본과 일치함을 대조 확인.
  **409만 삼켜서는 안 고쳐진다** — `upsert_items`가 메타를 다시 조회해 502가 된다. Redis 메타를
  Qdrant 실체로부터 복구(reconcile)하는 것이 옳은 수정. → 직접 고치지 않고 제안서를 main 경유 인계.
- **현재 우연히 잠복 중**: 오늘 09:24경 M4 Redis가 재시작되며 RDB(04-26 메타)를 재적재해 200이
  나온다. uvicorn은 08-19 이후 재시작 없음 — **코드는 안 바뀌었다. 회복이지 수정이 아니다.**
- **실피해**: 뉴스 KB가 `ingested_at` 기준 **2026-05-12에 얼어붙어 있었다**(`news.kr_market` 70건 중
  67건이 05-12). `src/lib/rag/retrieval.ts`가 이걸 전략 분석 RAG 입력으로 먹인다.
- **StockInvest 쪽 수정(이 팀 범위)**: 실패 알림 부재 + 재시도 폭주(하루 120건) → cron 라우트화 +
  `sendAlertThrottled` 알림 + 날짜파일 무조건 기록. Developer 진행 중.
- 🟠 **별건**: StockInvest의 `AI_API_KEY`가 M4에서 **401 `invalid or disabled api key`**.
  `src/lib/rag/m4-kb.ts`의 검색·upsert가 전부 이 키를 쓰므로 **RAG 검색 자체가 실패**하고
  `retrieval.ts`는 빈 컨텍스트로 조용히 진행한다. M4에서 키 재발급 필요(사용자 액션).

## ✅ 2026-08-23 — [[T-034-chart-based-price-targets]] 배포 완료 (아래 08-18 절부터는 이 사이 갱신되지 않아 낡아 있었음)

이 절과 08-18 절 사이(08-19~08-21)에 T-032 후속 4건([[T-032-research-rally-cycle]]) +
[[T-033-research-recommendation-trade-report]](리서치분석 매수/매도 추천 + 거래리포트 개선) +
T-034가 전부 구현·검증·배포됐다. ACTIVE.md가 그 기간 갱신되지 않았던 것이지, 실제 프로젝트가
멈춰 있었던 게 아니다 — 상세는 [[RESUME]] 최신 절과 각 task 파일 참조.

**T-034**: 목표가 산출을 진입가·과거평균 의존에서 차트 지표(볼린저밴드/60일 고저·ATR14 도달가능성
게이트) 기반으로 재설계. 진입가 의존 완전 제거(회귀 테스트 고정), 통화(KRW/USD) 혼용 구조적 차단,
기한 표시/판정 불일치 해소. Developer→Reviewer PASS(0건)→QA PASS(0건)→Leader 실데이터 대조 완료.
122 suites/2147 tests. 사용자 승인 → 커밋 `eac1e83` → **webhook-deploy 미발화(2회째 관측, 백로그)**
→ 수동 배포 완료, 헬스체크 green, 안전장치(`dryRun:false`/`killSwitch:false`/`engine.enabled:true`)
무영향.

**미해결로 남긴 것**: webhook-deploy 미발화 원인 조사(백로그), [[T-031-news-fetch-m4-500]]은
home-m4-api 프로젝트로 핸드오프 필요(이 저장소 범위 밖), TradingInvest `.env` 구IP 확인 권고(그
프로젝트 팀 소관).

## ✅ 2026-08-18 (추가) — [[T-030-fundamentals-refresh-stale-state]] 완료: 즐겨찾기 재무갱신 "데이터없음" 미반영 버그 수정

사용자 신고("재무갱신 호출 시 데이터없음으로 처리되지 않는다")를 Leader가 코드 추적으로 원인
확정 → Developer 2라운드 → Reviewer PASS → QA PASS로 완결. 캐시 DELETE 후 AI 재분석이 실패하면
화면 재동기화를 안 하던 결함(목록·상세 두 화면 동일 패턴)을 고쳤다. 상세화면은 처음 구현된
"실패 시 AI 재호출" 방식을 Leader 판단으로 제거하고 "재호출 없이 표시만 정확히 전환"으로
조정했다. 107 suites/1888 tests, 실매매 코드 무변경. **git commit은 사용자 승인 대기.**

## ✅ 2026-08-18 — T-025~T-029 전부 커밋 완료 (아래 08-16 절의 "커밋 대기 중"은 낡은 서술, 무효)

`git status` 클린, 최근 커밋 5개: `cc6dd03`(T-025 훅)·`7b9de61`(T-026 UI)·`c2533aa`(T-027)·
`cec5423`(T-028)·`0481d55`(T-029). T-025 이후 다른 세션들이 이어서 작업했고, **T-025의
commit-msg 훅이 실제 프로덕션에서 동작 확인됨** — T-029 커밋 시도 중 Reviewer 판정 형식 결함으로
실제 차단(exit=1)됐고 Reviewer가 직접 정정 후 통과, 훅이 의도대로 작동한 첫 실사례.

- [[T-026-order-history-symbol-grouping]]: 거래이력·최근주문 UI를 날짜→종목 2단 그룹핑으로 개선.
  페이지네이션이 그룹핑보다 먼저 적용되던 정확성 버그도 같이 수정(순서 반전). 100 suites/1517
  tests. 갤럭시 S25+ 실기기 헤더 줄바꿈 여부 → ✅ 2026-08-18 사용자 확인 완료(정상, 한 줄 유지).
- [[T-027-nonnumber-quantity-guard]]: `POST /api/orders`의 비-number quantity/price 가드. 조사 중
  더 심각한 결함 발견 — price가 NaN이면 주문 한도 검사가 전부 무력화(관계연산에서 NaN은 항상
  false)돼 **금액 무제한 주문**이 가능했음. 해외 어댑터의 대칭 구멍(Infinity)도 같이 닫음.
  102 suites/1660 tests.
- [[T-028-signals-api-numeric-guard]]: `POST /api/signals`에 같은 클래스의 수치 가드. 공용 모듈
  `src/lib/safety/numeric-fields.ts` 신설로 orders·signals 두 경로가 규칙 공유. 103 suites/1717 tests.
- [[T-029-custom-confirm-numeric-guard]]: `POST /api/signals/custom/confirm` — **사람 승인 없이
  즉시 진입감시로 전환되는 유일한 경로**라 우선순위 격상. 문자열 `+` 연산이 NaN이 아니라 "그럴듯한
  틀린 값"을 만들어(`'100'+'200'`→`'100200'`) 아래 단계 가드를 전부 통과하던 결함. 106 suites/1877
  tests. 잔여 LOW(`splits` 상한 없음, 자해성 DoS뿐)만 백로그.

**남은 것**: board.md Backlog의 QA 형식 준수 이슈(4회 중
3회 미준수 후 4회째 준수 — 지시문에 "표 없으면 무효" 명시가 효과 있었음, 기계적 강제는 미도입),
T-025 잔여 Medium/Low 6건(비차단).

## ✅ 2026-08-16 — [[T-025-commit-reviewer-safeguard]] 완료: Reviewer 감사 없이 커밋되는 것을 막는 git 훅 신설

2026-08-13 절차 위반(T-023·T-024가 Reviewer 감사 없이 커밋·배포됨)의 재발 방지책. 안전 관련 코드를
건드리는 커밋은 task ID + 그 task의 Reviewer 승인 기록(검토 범위 명시 포함)이 없으면 `commit-msg`
git 훅이 기계적으로 차단한다. NFS noexec로 훅이 무음 비활성되는 함정을 로컬 shim으로 우회.

같은 리포를 동시에 감사하던 여러 병렬 세션(다른 인터랙티브 세션들)이 CRITICAL 1건("무관한 과거
승인 task를 인용하면 다른 안전코드가 무검토로 통과")과 HIGH 다수(인증 미들웨어·세션관리 미보호,
scope 문자열 접두어 오매칭)를 연쇄로 찾아내 전부 수정 완료. 최종 Reviewer PASS(Critical 0·High
0)·QA PASS, 47개 시나리오+실 커밋 E2E 통과. 실매매 코드는 전 과정 무변경. **git commit/push는
사용자 승인 대기 중** — 아직 안 함. 잔여 Medium/Low 6건은 board.md Backlog 참조.

**동시 세션 관련 참고**: 이 작업 중 워크스페이스에 이 프로젝트를 동시에 다루는 인터랙티브 세션이
최소 1개 더 있었다(다른 세션이 board.md에 [[T-026-order-history-symbol-grouping]]을 등록하고,
T-025 Reviewer 감사에도 독립적으로 참여함). 파일 동시수정으로 인한 충돌은 append-only 관행 덕분에
데이터 손실 없이 넘어갔으나, 다음에 이 프로젝트를 다룰 때 다른 세션이 동시에 열려 있는지 먼저
확인하는 습관이 필요하다.

## ✅ 2026-08-13 — Reviewer 감사 없이 이미 배포된 것을 발견 → 사후 감사 완주 → 배포 권고

아래 08-11 절이 "커밋 배포 대기"라고 적어 둔 [[T-023-getactiveorders-pagination]]과 (당시 task
파일도 없던) `POST /api/orders` 수량 방어 건이, 실제로는 이 문서가 갱신되지 않은 사이에
**Reviewer 감사 단계 없이 이미 커밋·push·webhook-deploy 배포까지 끝나 있었다**(`f2c6f95`
2026-08-12 17:54 · `9456be5` 2026-08-13 09:48, 둘 다 webhook-deploy exit=0 확인, pm2 `stockinvest`
당시 후자 커밋으로 기동 중이었음). Leader 가 사용자의 "이어서 작업" 지시로 재개하며 `git log`/
`git status`/webhook-deploy 로그 실측 중 발견.

**사후 감사 완주 결과(같은 날 완료)**: 두 건 모두 자금 손실로 이어지는 Critical/High 결함 없음.
T-023 은 Reviewer 1차 감사가 HIGH 1건(페이지 상한 도달 시 불완전한 목록을 성공으로 위장 반환 —
order-sync fail-closed 우회 가능성, 현재 계좌 규모에선 사실상 도달 불가하나 구조적 결함)을 발견
→ Developer 즉시 수정(`break`→`throw` + 다운스트림 검증 테스트 2건 추가) → Reviewer 라운드2
PASS → QA PASS. T-024 는 Reviewer 1차 PASS(Medium 2건 — 비-number quantity 가 시장가/가격없는
지정가 한정으로 무의미한 라이브 API 호출까지 도달하나 자금손실 아니고 호출 프론트엔드 자체가
없어 실노출 0에 가까움 — 배포 비차단 판단, board.md 백로그 이관) → QA PASS. **최종 회귀테스트
99 suites / 1478 tests 전부 통과, typecheck 0에러.** git commit/push 는 사용자(상위 세션)가
직접 처리 예정. 상세는 [[RESUME]] 최신 절, 각 task 파일 "최종 요약" 섹션, board.md Done 참조.

## ✅ 2026-08-11 상태 (아래는 그대로 보존 — 위 절이 최신) — 실거래 무장 상태 + 주문경로 결함 2건 수정(승인 대기)

**실계좌 실거래 중이다.** `safety_dry_run=false` · `safety_kill_switch=false` · `engine_enabled=true` · `autopilot_mode=assist` · `safety_order_max_pct=6` · `safety_daily_order_max_pct=10`(과거 0 → 개방). `.env` 의 `DRY_RUN=true` 는 **죽은 설정**이다(DB `system_config` 가 우선). 아래 문서 중 "DRY_RUN 이라 안전하다"는 취지의 옛 서술은 전부 무효다.

### 오늘 배포됨

- [[T-017-kis-rate-limit-throttle]] (`bbe074b`) · [[T-018-order-sync-fail-closed]] (`3d4197e`) — 같은 push 로 배포. pm2 기동 `04:39:08 UTC`, 헬스체크 그린.
- [[T-019-partial-fill-false-filled]] · [[T-020-fractional-order-quantity-sizing]] (`d67dceb`) — 사용자 승인 후 커밋·푸시·배포 완료(2026-08-11 08:33:37 UTC). pm2 재기동(restarts 341), 헬스체크 그린(`dryRun:false` `killSwitch:false` `engine.enabled:true` `safetyStatus:green`).
  - T-019: 부분체결이 `filled` 로 오기록되어 손익 장부가 틀어지던 문제. `executions` 에 실제 체결 수량 기록 시작(역사상 0행이던 표에 처음으로)
  - T-020: 소수점 주문 수량이 전송 직전 절삭돼 조용히 축소집행되던 문제. 사이징 시점 정수화 + 0주 스킵의 관측 가능한 흔적
  - 둘 다 developer(Opus) → reviewer(Sonnet, 2라운드 **PASS**) → QA(**검증 통과**) 순환 완료. 93 suites / 1411 tests, typecheck exit 0.

### 🔴 미커밋 작업물 — 승인 대기: [[T-021-recommend-detail-client-crash]]

사용자 신고 "추천 목록에서 시그널 클릭 시 **Application error: a client-side exception has occurred**".
**구현·독립감사(PASS)·QA 2라운드 전부 완료, 커밋 안 함.** HEAD 는 여전히 `8d68a0c`.

- **원인**: 소비자 타입이 DB JSON 을 신뢰해 required 로 선언 → `ScenarioDetail.tsx:418` `sc.risk_factors.length` 무가드. **post-market 엔진이 `risk_factors`·`why_now`·`context`·`ev` 를 채우지 않고 INSERT** 하는데 **타입이 거짓말을 해서 컴파일러가 못 잡았다.**
- **만성 문제**: 06월 중순~08-11 거의 매일 발생. 과거 것들은 `expired` 라 클릭이 안 됐을 뿐이고, 신고 시점 pending 노출은 1건(17211).
- **수정**: `scenario-view-model.ts` 신설(소비자 타입 `StoredScenario` 전 필드 옵셔널 + 표시 판정 순수 함수). 타입을 정직하게 만드니 **컴파일러가 같은 클래스 15곳을 스스로 찾아 전부 방어**(`TradingBoard.tsx` 는 진단에 없던 4번째 파일). `NaN%` EV 거짓 수치 제거. **`src/app/error.tsx` 신설** — 이 앱에 렌더 예외 경계가 하나도 없었다.
- **`post-market-engine.ts` 무변경(의도적)** — 근거 없는 값을 지어내지 않는다. 특히 `ev` 를 LLM confidence 에서 유도하는 건 "거짓 데이터" 문제의 재발.
- 94 suites / **1444 tests** · typecheck 0에러 · reviewer PASS(Critical 0/High 0) · **주문·자금·안전장치 파일 전부 무변경(순수 UI)**.
- 파생 백로그 2건(트레일링 표시/실동작 불일치 + 기준값 3곳 분산, `ScenarioAnalysis` 생산자 타입 신뢰) → board.md Backlog.

> 🔴 `deploy-stockinvest.sh` 의 `git clean -fdx` 가 **미추적 파일을 삭제**한다. 신규 파일 3개(`src/app/error.tsx`, `src/components/scenario-view-model.ts`, `src/components/__tests__/scenario-view-model.test.ts`)와 이 task 파일이 여기 해당한다 — **다른 이유로 push 가 먼저 일어나면 증발한다.**

### 배포 후 관측 권고 (신규)

- `sizing_below_min_qty` 발생 건수 — 상시 스킵되면 주문금액 정책(현재 포트폴리오 6%) 조정 신호
- 매도/청산 스킵 알림 — 뜨면 실제 포지션 미청산 상태이니 확인 필요
- `ORDER_SYNC_EXEC_DUPLICATE` 경보 — 1건이라도 관측되면 즉시 에스컬레이션([[T-019-partial-fill-false-filled]] 백로그 참조)

### 현재 노출도 (후속 판단 기준선, 2026-08-11 실측)

`executions` 0행 · 역대 `partially_filled` 0건 · order-sync 대상 0건 · 06월 이후 해외 주문 0건 · 08월 시그널은 전부 `expired`/`ai_skipped` 로 주문 도달 0건.
→ 두 결함 모두 **아직 발화한 적 없다.** 다만 킬스위치 해제 · T-017 의 레이트리밋 제거 · 일일한도 개방으로 **억제 요인이 전부 풀렸다** — "현재 0건"은 안전의 근거가 아니라 시한의 근거다.

---

## 지금 상태 (이하 2026-08-06 기준 — 재구성 맥락)

**프로젝트 재구성 진행 중** (사용자 요청: "시그널도 안 나오고 수익도 없어 사용 중단 → 다시 쓸 수 있게 재구성").

원인 분석 완료 — 코드 수준에서 확정:
- 매수 시그널 1건이 사용자에게 도달하려면 직렬 게이트 ~10개 통과 필요, 그중 3개가 확률 ~0
  1. `ANALYST_ENABLED=false`가 engine.ts:843에서 엔진 자체를 차단 (router.ts:92의 라우팅 플래그와 이중 의미 — 공식 가이드 1단계 설정이 곧 시그널 0)
  2. market-state 게이트(RSI<35 선점)와 유일 매수 룰 rsi-oversold-v1(RSI<35 발화)의 **구간 배타** — 활성 창과 발화 창의 교집합이 공집합
  3. ai-filter.ts:422가 LLM_PROVIDER 무시하고 `claude` CLI 직접 spawn → 실패 시 비보유 종목 전량 ai_failed
- 수익 부재는 구조적: DRY_RUN=true + `executions` INSERT 코드 전무 → 페이퍼 손익조차 측정 불가
- 안전장치는 거꾸로 fail-open (한도 미설정 시 Infinity, Kill Switch drawdown dead code, 71라우트 중 61개 무인증)

전체 진단·설계는 플랜 파일 참조: `C:\Users\admin\.claude\plans\majestic-imagining-raccoon.md`

## 재구성 전략

**최소 동작 루프 우선(strangler)** — 검증된 자산(KIS 어댑터, submitOrder 단일 관문, UI 셸, 알림, post-market 시나리오 카드) 보존 + 파손된 시그널 파이프라인만 단순·관측 가능하게 재구축. 매 Phase가 사용자가 눈으로 확인할 결과물을 낸다.

Phase 0(안전 기반) → 1(관측: 깔때기) → 2(시그널 복구: 게이트 9→4, 스위치 의미 분리, 장중 AI 제거) → 3(페이퍼 손익 실측) → 4(백테스트 검증 루프) → 5(DRY_RUN 해제 준비)

## 사용자 확정 결정 (2026-08-02)

1. 해외주식 **보류** (코드 보존·비활성, 국내 루프 완성 후 재개)
2. 장중 AI **제거** — 장중은 결정론적 룰만, AI는 post-market 시나리오 생성(밤 배치)에만
3. 부가기능: **RAG 되먹임 유지 + 투자일지 유지** / AI 채팅(/ai)·LoRA export 비활성·삭제
4. 크리덴셜: DB 평문 유지 + 인증(PIN/PSK)으로 접근 봉쇄

## 다음 할 일

**2026-08-06: [[T-006-phase2-implementation]] Phase 2 배포 완료(`c064e83`).** market-state 데드락 해소를 실데이터로 확인. 남은 건 관측.

1. **Step 5 관측** — 2026-08-07부터 3영업일, §6 사후 기준 4개 확인
2. 🔴 `weekly-trend-follow-v1` 발화 불가(1d 210봉 필요 vs KIS 100봉 반환) 대응
3. 🔴 auto 모드 활성화 전 승인 3건 (현재 `autopilot_mode=assist`)
4. Step 5 진입 시 DRY_RUN/KILL_SWITCH 관측 모드 결정

## Phase 0 최종 상태 (developer 완료분)

- 한도 fail-safe 전환(미설정·조회실패 → 0 = 거부), safety 기본값 seed(회당 5%/일일 10%)
- PIN 인증 미들웨어(Edge HMAC 세션) + /login + 전역 지수 백오프 로그인 잠금
- Kill Switch drawdown을 portfolio-snapshot cron에 배선
- `parseBoolFlag` 3분기(unset/parsed/unparsable) — 해석 불가 시 안전 방향 + critical 알림
- next 14.2.15 → **14.2.35** (CVE-2025-29927 인가우회 + CVE-2025-55184 DoS). lock의 deprecated 필드 소멸로 검증
- undici 제거(초기 커밋부터 미설치 = 동작한 적 없음), /api/health 금액 비노출, CI에 npm test 게이트
- 테스트 39 suites / 398건 통과, build·tsc 통과 (Phase 0 시점 기준)

## 열린 결정

- ~~배포 파이프라인이 이미 red였음~~ → **정정(2026-08-02 pm2 실측)**: `stockinvest`는 **online, next 14.2.15, uptime 4h**로 정상 가동 중이고 cron도 5분마다 정상 동작(`strategy-eval skipped — all_markets_closed`, 장 마감 시간이라 정상). 배포는 red가 아니었다. 단 `undici` 미선언으로 `npm run build`가 실패하는 것은 사실이므로, **마지막 성공 배포 이후 CI가 계속 실패해 왔을 가능성**은 남아 있다(운영 프로세스는 그 이전 빌드로 계속 서빙).
- **미해결 이상징후 3건 (리눅스에서 확인 필요)**:
  1. `.next/`가 SMB 마운트(Z:)에서는 `trace` 파일 하나(Apr 22)뿐인데 앱은 정상 서빙 중. `ecosystem.config.js`는 `cwd: __dirname` + distDir 오버라이드 없음 → 같은 `.next`를 읽어야 정상. **실행 중 프로세스가 열린 파일 핸들로 버티고 있고 실제 `.next`는 삭제된 상태일 가능성** → 그렇다면 다음 pm2 restart 때 기동 실패한다.
  2. **restart 315회** (tradinginvest도 171회). 반복 재시작 원인 불명.
  3. `AI_API_BASE`(192.168.219.163:8001 = 맥미니 M4 AI 게이트웨이) **연결 실패**가 err.log에 기록됨 → RAG 검색·hybrid stage1 무력화. analyst가 찾은 `claude exit 143` 실패와는 별개 장애.
- **운영 코드에는 H1 핫픽스가 아직 없다** — 워킹트리에만 있으므로 시그널은 여전히 0건. 배포해야 소생한다.
- 워킹트리에 커밋되지 않은 변경 다수(원래 30여 개) — Phase 별 검증 완료 후 커밋 전략 결정 필요. **push = Gitea Actions 자동 배포**이므로 신중.

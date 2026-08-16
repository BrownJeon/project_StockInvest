---
project: StockInvest
updated: 2026-08-16
tags:
  - type/context
---
# 현재 상태

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

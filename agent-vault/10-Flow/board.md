---
tags:
  - type/board
---
# 칸반 보드

> 재개 진입점: [[RESUME]] · 진단·설계 전문: [[2026-08-02-restructure-plan]]

## Backlog

- 🔴 **[신규, 안전계층 영향] KIS 레이트리밋으로 `price=0` 스냅샷이 저장돼 안전장치 기준값을 오염시킨다**
  **증상**: KIS `EGW00201`(초당 거래건수 초과) 발생 시 잔고 조회가 **부분 성공**한다 — 일부 종목이 `price=0, value_krw=0` 으로 들어오고, 총액이 실제의 **약 26%** 로 붕괴한 채 `portfolio_snapshots` 에 INSERT 된다.
  **실측(2026-08-09)**: 30일 585건 중 **3건 오염**, 전부 `4,828,256원`(실제 `18,375,740원`). 3건 모두 **T-011 배포 직후**(15:45·16:01·16:05) — 마이그레이션의 라이브 `tokenP` 호출이 캐시 토큰을 무효화하면서 레이트리밋 버스트를 유발했다. 이 값이 현재 **30일 최소값**이다.
  **sanity 가드가 일부만 막는다**: `15:47:10` 한 건은 `ratio=0.19x` 로 거부했으나 나머지 3건은 저장됐다. 가드가 **24h 중앙값** 기준이라, 오염된 행이 들어갈수록 중앙값이 내려가 **가드가 스스로 약해지는 되먹임**이 있다.
  **🔴 안전계층 영향 (핵심)**: `portfolio_snapshots.total_krw` 는 단순 표시값이 아니다 —
  · `kill-switch.ts:75-87` 24h drawdown 기준선 · `volatility-guard.ts:86/94/142` · 주문한도(`order_max_pct` 는 포트폴리오 총액의 %)
  두 방향 모두 위험하다: 오염행이 **현재값**이면 `-74%` 로 보여 **Kill Switch 오발동**(전 매매 정지), 오염행이 **기준선**이면 실제 폭락을 **놓친다**.
  **수정 방향(설계 필요)**: ① 부분 실패한 잔고 조회는 스냅샷을 아예 쓰지 않는다(종목 중 `price=0` 이 하나라도 있으면 INSERT 거부) ② sanity 가드를 중앙값 되먹임에 면역이 되게(직전 정상값 대비, 또는 오염행 제외 중앙값) ③ 기존 오염 3행 정리 여부 판단
  경위: [[T-011-owner-account-migration]] 배포 검증 중 Leader 발견. 화요일 Phase 2 관측 완료 시 함께 논의.

- **[신규, 함정 제거] `.env` 의 KIS 자격증명이 낡은 채 남아 있음** — 엔진은 `system_config.cred_*` 를 쓰고 `.env` 값은 무시된다(2026-08-09 해시 대조로 4개 전부 불일치 확인). 읽는 코드가 없어 무해하나 **다음 사람이 원천으로 착각할 함정**이다. 삭제하거나 "사용되지 않음 — `system_config.cred_*` 참조" 주석 추가. 상세: [[credential-source-of-truth]]

- **[신규, 보안 — 심각도 조건부] `login/route.ts` 의 `maskEmail` 미이스케이프 알림 인젝션**
  로그인 잠금 경보(`sendAlert('warning', …)`)에 `maskEmail(email)` 을 이스케이프 없이 넣는다. `isValidEmail` 은 **공백만** 막고 `<` `>` `|` `:` `/` 는 전부 통과시킨다.
  **심각도는 알림 채널 설정에 따라 달라진다** (2026-08-09 Leader 실측):
  | 조건 | 심각도 | 결과 |
  |---|---|---|
  | **Slack OFF (현재 상태)** | **LOW** | 텔레그램이 깨진 HTML로 400 → **경보 자체가 유실**. 공격자가 자기 브루트포스 경보를 침묵시킴 |
  | Slack ON | **MEDIUM** | `ab@<https://evil.com\|ClickHere>` 가 `isValidEmail` 통과 → **클릭형 피싱 링크**가 관리자 경보에 렌더. `<!channel>` 대량 멘션도 가능 |
  **현재 실측**: `notify_channel = "telegram"`, `SLACK_WEBHOOK_URL` 미설정 → **오늘은 LOW**.
  ⚠️ **Slack 을 켜는 순간 MEDIUM 으로 승격된다.** Slack 활성화를 검토하는 사람이 이 티켓을 먼저 처리해야 한다 — 그때는 이 조건을 아무도 기억하지 못할 것이기 때문이다.
  **수정**: `escapeAlertText()`(T-010 신설, 테스트 완비) 를 call site 에 적용 — 1줄 + import. 인증 경로라 별도 리뷰 필요.
  경위: developer 가 T-010 범위 밖으로 올바르게 플래그 → 사용자가 별도 task 분리 결정 → reviewer 가 LOW 판정했으나 그 근거("공백 필요해서 링크 불가")가 **Slack 문법에는 거짓**임을 developer 가 실측으로 정정. 상세: [[T-010-signup-request-email]]
- **[신규, 인프라] StockInvest가 독립 체크아웃에서 빌드 불가** — `package.json`의 `file:../shared/auth-oauth`가 **같은 NFS 트리 안에서만** 해석된다. 배포 스크립트가 같은 트리에서 `git reset --hard`를 하기 때문에 현재는 동작하지만, 리포를 **별도 위치에 클론하면 `npm ci`가 실패**한다. 리포가 더 이상 자기완결적이지 않음 (2026-08-08 developer 발견)
- **[신규, 인프라] `shared/` 디렉토리가 버전 관리되지 않음** — `shared/auth-oauth`가 어떤 git 저장소에도 속하지 않는데 StockInvest·TheRoute·bjj-trainning 세 프로젝트가 **같은 NFS 실체를 심볼릭 링크**로 공유한다. 여기를 고치면 배포·리뷰·롤백 없이 세 프로젝트에 즉시(다음 재시작 시) 반영된다. git 저장소 편입 또는 최소 백업·변경이력 절차 필요. 상세: [[T-009-oauth-login]]

- **[신규, 주문상태 무결성] `/api/safety/cancel-all` 라우트 2건** ([[T-007-telegram-silent-failure]] reviewer 발견, 라우트 자체는 미수정)
  1. 최상위 SELECT에 try/catch 부재(`route.ts:14`) → DB 실패 시 구조화된 `{ok:false,error}`가 아니라 **Next의 HTML 500 페이지**가 반환된다. T-007이 UI 쪽은 막았으나 서버측 관측성은 여전히 약함
  2. **더 실질적**: per-order try/catch(22~44행)가 `kis.cancelOrder()`와 뒤따르는 `UPDATE orders`/`INSERT trade_logs`를 **함께** 감싼다 → 거래소 취소는 성공했는데 DB 쓰기가 던지면 그 주문이 `cancel_failed`로 기록된다. **실제로는 취소된 주문이 미취소로 남는 상태 불일치.** T-007과 방향이 반대(거짓 실패)이고 pre-existing이라 별도 task 필요

- **[신규, 후속 정리] `res.ok` 미검사 핸들러 일괄 점검** — [[T-007-telegram-silent-failure]] 전수 조사에서 5곳 발견. #1(킬스위치/DRY_RUN 토글)·#5(비상 전체취소)는 T-007에서 처리. 남은 3곳: `toggleHybridMode`(PATCH hybrid) · `OrderDetail.tsx:69`(주문취소 실패해도 완료 콜백) · `ScenarioDetail.tsx:308`(거절 실패해도 navigate). 코드베이스 관례는 `res.ok`가 아니라 **body의 `ok`** 검사이며, T-007의 `patchSetting()`이 둘 다 검사하는 상위집합이므로 이를 표준으로 통일할 것
- **[신규, 보류 — 별도 리뷰 필요] 안전 키 검증 부재** — `PATCH /api/settings/safety`가 `dryRun`/`killSwitch`/`orderMaxPct`/`dailyOrderMaxPct`를 **검증 없이** 저장한다. T-007에서 `reportChannel`/`reportMode`만 검증 추가함. 라이브 안전 경로의 동작을 바꾸는 변경이라 인접 작업에 태우지 않고 **자기 근거를 갖춘 별도 리뷰** 필요

- **[신규, 정책] `agent-vault/`가 `.gitignore`에 없어 커밋해야만 살아남는 구조** — `deploy-stockinvest.sh`의 `git clean -fdx`가 미추적 파일을 삭제한다. 커밋 대상으로 계속 둘지 별도 백업 경로를 둘지 정책 결정 필요 (2026-08-05 leader 발견)
- **[신규, Medium] 배포 스크립트가 라이브 디렉토리에서 in-place 빌드 + `instances=1`** — `npm ci`/`build` 구간(수십초~수분) 동안 구 워커가 트래픽을 받으며, 형제 워커가 없어 크래시 시 자동재시작 루프 가능. 헬스체크는 있으나 **자동 롤백 없음**. 장기 대책: 별도 디렉토리 빌드 후 원자적 스왑 (2026-08-05 reviewer 발견)

- Phase 3 — 페이퍼 트레이딩·성과 실측 (executions simulated 기록, 룰별 승률·EV 대시보드, 비용 모델 config화)
- Phase 4 — 백테스트 검증 루프 (야간 cron, validation_status, 실주문 전제조건 코드화)
- Phase 5 — DRY_RUN 해제 준비 (KIS 체결내역 폴링 → executions real, 해제 체크리스트)
- 문서 SSOT 재작성 (제품 사양 1페이지 + 전략 사양) — stale 문서 정리(기획서_V0.1, phases/*, trading-strategy.md 코인 전략)
- AI 채팅(/ai)·LoRA export 제거 — 사용자 결정에 따른 정리
- `AUTH_SESSION_SECRET` 분리 — 현재 AUTH_PIN이 로그인 PIN과 쿠키 HMAC 서명 키를 겸함
- 이상징후 조사: pm2 재시작 315회 원인 / AI 게이트웨이(192.168.219.163:8001) 다운
- `oversold-bounce-daily-v1` strategy_id 드리프트 수정 — post-market-engine.ts가 `oversold-bounce-v1`을 씀, `strategies.id`와 불일치 (2026-08-03 reviewer 발견, pre-existing, 낮은 우선순위)
- ~~**[Critical급] 실배포 파이프라인에 테스트 게이트 없음**~~ → ✅ **해소 확인(2026-08-05)**. 현 `deploy-stockinvest.sh`에 `set -eo pipefail` + `npm test -- --ci` + `--update-env` + 헬스체크 전부 존재(mtime 08-03 13:06). 남은 미비점은 자동 롤백 부재뿐. 상세: [[T-005-next15-upgrade]]
- **[신규, 보안] git origin URL에 Gitea 액세스 토큰 평문 노출** — `.git/config`의 origin URL이 `http://brownjeon:<token>@192.168.219.154:3000/...` 형태다. `.git/config`를 읽을 수 있는 누구나 리포 쓰기 권한(=운영 배포 권한)을 얻는다. 토큰 회전 + credential helper 전환 필요. 상세: [[T-005-next15-upgrade]] §보안 메모
- ~~**[Medium-High] 텔레그램 조용한 실패**~~ → ✅ **[[T-007-telegram-silent-failure]]에서 해결(2026-08-06), 커밋 승인 대기** — `sendTelegramAlert`가 void 반환이라 전송이 실패해도 라우트는 `sent:true`를 응답하고 `report_trade_last_sent_at`까지 갱신한다. 2026-08-04 08:03 정기 리포트가 실제로 `ETIMEDOUT`(IPv4 timeout + IPv6 ENETUNREACH)으로 **유실됐는데 아무 흔적이 남지 않았다**. 배달 확인 후 last_sent_at 갱신, 또는 연속 실패 시 dead-man's switch 경보. 상세: [[T-004-phase1-visual-verification]]
- **[신규, 안전 관련, 사용자 결정 필요] exit 청산 시그널이 승인 없이 만료** — 2026-08-04 exit 매도 시그널 2건이 `signals.status='expired'`. 방어용 청산이 pending→만료를 반복하면 **손절·트레일링이 사실상 무력화**된다. exit 시그널 자동제출 정책은 실자금 리스크 정책이라 사용자 판단 필요. 상세: [[T-004-phase1-visual-verification]]
- **[신규, Phase 2 이월] exit 트랙 `final` 행 미기록** — exit-engine은 `final` 행을 쓰지 않아 깔때기 축에 잡히지 않는다. exit 전용 미니 깔때기(stage 21~29)와 함께 [[T-003-phase2-pipeline-redesign]]에서 처리. 상세: [[T-004-phase1-visual-verification]]
- **[신규, Low] `final` 행 심볼당 1행 → 동일 런 내 동일 심볼 복수 시그널 시 과소집계** — 헤더의 `strategySignals`(이벤트 카운트)와 6단계 바의 `전략시그널`(final 행 카운트)이 eval 트랙 내에서도 미세하게 어긋날 수 있다. `eval-funnel-query.ts:112` 주석이 이미 인지 중인 pre-existing 특성이고 "0 vs 2"급 불일치는 아님. (reviewer2 발견, 2026-08-05)
- **[신규, Low] `trade-report/route.ts`의 `title` 미변환** — `mrkdwnToTelegramHtml()`를 거치지 않는다. 현재는 고정 안전 문자열이라 무해하나 동적 문자열이 섞이면 무경고 400 실패
- **[신규, Low] `/favicon.ico`·`manifest.json`·`apple-touch-icon.png` 404** — `public/`에 파일 부재, 콘솔 에러 상시 1건 (pre-existing)
- ~~**[High, 사용자 결정 필요] next@14.2.35에 잔존 CVE 21건**~~ → **2026-08-04 사용자 승인, [[T-005-next15-upgrade]]로 착수됨**

## Todo

- **Step 5 관측** — 2026-08-07부터 3영업일 eval_funnel 집계로 [[T-003-phase2-pipeline-redesign]] §6 사후 기준 4개(소생·감쇠분산·중복스팸·런성능) 확인. 통과 시 실거래 해제 논의
- **[신규, 배포 후 발견] `weekly-trend-follow-v1` 구조적 발화 불가** — 1d 210봉 요구 vs KIS 100봉 반환. FIND_IN_SET 제거로 비로소 드러남. 실질 장중 활성 4종. ①KIS 봉수 확대 ②룰 재설계 ③기본 비활성 복귀 중 택일 필요

- **장중 실측 마무리** — `final` 행 stage가 실제로 정상 기록되는지(풀평가 런 발생 후) 확인. `strategy_unregistered` 수정은 이미 라이브 확인됨(10:02 KST)
- **`safety_daily_order_max_pct=0` 확인 필요** — 사용자에게 의도한 일일 한도(%) 확인 후 설정. 0인 한 국내 신규 매수 시그널은 절대 생기지 않음(코드 정상 동작, 설정 문제)
- [[T-003-phase2-pipeline-redesign]] 구현 — Phase 1 관측 데이터 3영업일 확보 후(배포일 2026-08-03 기준 재기산)

## Doing


## Review

- [[T-007-telegram-silent-failure]] — **구현·검증 완료, 커밋·배포 승인 대기(2026-08-06)**. 알림 전송 결과 반환, 안전 치명 알림 실패 로깅, `last_sent_at` 조건부 갱신, 설정 저장/킬스위치 토글/비상취소의 거짓 성공 제거, 토큰 리댁션. developer 5라운드 · reviewer 3회 감사 최종 PASS. 46/523 → **53 suites/620 tests**

## Done

- [[T-014-favorites-ai-refresh-failure]] — **인프라 장애 조치 완료(2026-08-09, 코드 변경 없음)**. 즐겨찾기 "재무 갱신" AI 분석실패 신고 → 원인은 StockInvest 코드가 아니라 맥미니 M4 AI 게이트웨이(`192.168.219.163:8001`, home-m4-api 프로젝트 소유)가 **최소 3주간 다운**돼 있던 것(`fetch failed`). GUI 로그인 세션 없어 LaunchAgent 자동재시작 불가 상태였음. SSH로 수동 기동 후 실제 호출 경로로 복구 검증 완료. **임시조치** — 영구 수정(자동로그인/LaunchDaemon 전환, sudo 필요)은 사용자 확인 대기
- [[T-013-telegram-stock-name]] — **완료·배포됨(2026-08-09, `3f1513c`)**. 텔레그램 시그널 알림 5종(승인요청·자동제출·시나리오등록·보유기간초과·진입실행) 종목코드→한글 종목명 표기. `getSymbolLabel` 헬퍼 신설(stock_meta 캐시만 조회, 라이브 폴백 없음, DB실패시 코드 폴백). 안전장치 무변경. developer→reviewer(PASS)→QA(통과) 전부 완료, 74 suites/1032 tests(신규 8건 포함) 통과. 배포 exit=0, 헬스체크 정상. 같은 워킹트리의 T-011/T-012 미완성 변경은 stash로 보호 후 배포, 배포 완료 후 복원
- [[T-008-multiuser-auth-step1]] — **완료·배포됨(2026-08-08, `cb64fcd`)**. PIN 인증 → 이메일 회원가입·로그인 전환(멀티테넌트 5단계 중 Step 1). `users`/`user_settings` 신설, 세션 `AUTH_SESSION_SECRET` 분리, login-gate 이메일별 전환, scrypt+AES-256-GCM(신규 의존성 0). 사용자 결정으로 가입 시 KIS 미수집 → **`SIGNUP_INVITE_CODE` 신설**(인터넷 공개 앱이라 필수). reviewer 보안감사+재검증+QA 전부 PASS, 53/620 → **59 suites/703**. 배포 후 DDL·middleware·거부경로 실측 확인
- [[T-007-telegram-silent-failure]] — **완료·배포됨(2026-08-06, `5f51763`)**. 알림 전송 결과 반환, 안전 치명 알림 실패 로깅, 설정저장·킬스위치토글·비상취소의 거짓 성공 제거, 토큰 리댁션

- [[T-006-phase2-implementation]] — **Phase 2 구현·검증·배포 전부 완료(2026-08-06, `c064e83`)**. market-state 게이트→라벨 강등으로 데드락 해소(실데이터 확인), 장중 AI 제거, 게이트 4단계 재편, 쿨다운 통합, 1h 단일축, 활성룰 14→8종. **독립 감사 4회 + QA 전부 PASS**, 40/413 → 46/523 tests. 도중 HIGH 1건(하이브리드 토글=무표시 auto 진입문) 발견·수정. 무중단 배포(재시작 1회, 에러 증가 0)

- [[T-005-next15-upgrade]] — **완료·배포됨(2026-08-05 11:08 KST, 커밋 `12bd061`)**. next 14.2.35 → **15.5.22**, **GHSA 21건 → 0건**. 격리 클론 전건 검증 후 무중단 배포(webhook exit=0, 재시작 1회, 에러 증가 0바이트). **44시간 지속되던 메모리/디스크 next 버전 불일치 해소.** react 18.3.1 유지, cron 재시작 불필요 확인

- [[T-004-phase1-visual-verification]] — **전항 완료(2026-08-05)**. 깔때기 카드·trade-report 실제 렌더 육안 확인 완료(화면 숫자 ↔ DB 실측 100% 일치, 텔레그램 실배달 확인). 결함 3건 발견·수정(0건 막대 오표시 / 텔레그램 별표 노출 / 시그널 건수 자기모순 → 깔때기 = 평가 트랙 전용으로 정의 확정). developer→reviewer(2회)→QA 순환 전부 PASS, 40 suites/413 tests. **2026-08-05 배포 완료(`12bd061`) + 실기동 재검증 통과** — 카드 라이브 렌더 정상, 텔레그램 볼드 배달 확인

- 원인 분석·재구성 설계 — 2026-08-02. 탐색 3종 + Fable 종합설계 + 운영 DB 실측. **제1사인 = signals.status ENUM에 `pending_approval` 부재(STRICT 모드 하드 에러 → 런 전체 중단)**
- [[T-001-phase0-safety-foundation]] — **전항 완료(2026-08-03 3차 재검증 PASS)**. 한도 fail-safe(Infinity→거부), PIN 인증 미들웨어, Kill Switch drawdown 배선, parseBoolFlag 3분기, next 14.2.15→14.2.35(CVE-2025-29927 인가우회 + CVE-2025-55184 DoS — 운영 라이브 curl로 우회 불가 재확인), undici 제거. 테스트 398건 통과. 배포 완료·운영 QA(무인증 401·cron 시크릿·로그인 흐름) 전부 통과. 재검증 중 인프라 신규 발견 2건은 별도 backlog로 분리(위 참조)
- [[T-003-phase2-pipeline-redesign]] analyst 사양 — 게이트 50→26 재편표, RSI 실측 재도출(35→38, n=7290), 비용 0.178% 실측(현행 0.43%는 2.4× 과대), 기본 활성 5종 선별, 정량 검증 기준 8종
- [[T-002-phase1-eval-funnel]] — **전항 완료·배포 완료(2026-08-03)**. H1~H4 핫픽스 반영·검증, final.stage 버그 수정, stage 8/9/10 계측 공백 및 createSignal 무보호 호출(안전 이슈) 발견·수정, 대시보드 깔때기 카드, trade-report 요약, 독립 reviewer 감사 통과. 커밋 b0ad876, webhook-deploy 자동배포(10:00 KST) + cron 수동 재기동 완료. `strategy_unregistered` 수정 라이브 확인됨

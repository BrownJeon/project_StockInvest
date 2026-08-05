---
project: StockInvest
updated: 2026-08-05
tags:
  - type/context
aliases:
  - 이어서 작업
  - RESUME
---

# ▶ 이어서 작업 — 재개 진입점

> 사용자가 **"이어서 작업해줘"** 라고 하면 이 파일부터 읽고, 아래 "다음 할 일"의 1번부터 진행한다.
> 다른 PC에서 재개할 수 있으므로 **모든 맥락은 이 vault 안에 있다** (세션 메모리·플랜 파일에 의존하지 말 것).

## ✅ 2026-08-05 배포 완료 — 운영 안정화됨

**직전까지 있던 "메모리 next14 / 디스크 next15" 불일치는 해소됐다.** 커밋 `12bd061`을 11:08 KST에 배포해 next **15.5.22**로 전환 완료(pm2 version 컬럼 확인). 이제 재시작해도 안전하다.

- 배포 결과: webhook-deploy `exit=0`(~30초), pm2 재시작 **1회만**(317→318), **에러 로그 증가 0바이트**, health 200 무중단
- **next 관련 GHSA 취약점 21건 → 0건**
- [[T-004-phase1-visual-verification]] 렌더 수정 3건도 함께 배포·실환경 검증 완료
- `stockinvest-cron`은 재시작 불필요했고 실제로 무중단 유지됨(uptime 2D)

## 한 줄 요약

시그널이 안 나오고 수익도 없어 방치된 자동매매 앱을 재구성 중이다. **진짜 원인은 DB 스키마 불일치(제1사인)였고 그 수정은 이미 코드에 들어갔다.** Phase 0(안전 기반)·Phase 1(관측+핫픽스) 모두 **구현·독립 reviewer 검증·운영 배포까지 전부 완료됐다.** 남은 것은 사용자 결정 대기 항목 2건과 Phase 2 착수.

## ⚠️ 배포 메커니즘 정정 (2026-08-03, 중요)

**"push가 곧 배포"는 맞지만 경로가 기존 문서와 다르다.** `.gitea/workflows/deploy.yml`(Gitea Actions)은 **러너가 등록되어 있지 않아(`actions/runners` API가 `total_count:0` 반환) 완전히 죽어있다** — 기록된 실행도 전부 2026-04-26 이전, 전부 실패/취소. 실제 배포는 pm2 프로세스 **`webhook-deploy`**(Gitea 웹훅 HMAC 서명 검증 → 프로젝트별 `deploy-*.sh` 실행)가 담당한다. StockInvest용 스크립트: `/home/brownjeon/.local/webhook-deploy/deploy-stockinvest.sh` — `git reset --hard origin/main` → `git clean -fdx -e .env -e node_modules -e .next` → `npm ci` → `npm run build` → `pm2 reload stockinvest`. 로그: `pm2 logs webhook-deploy`.

**중요한 함의 2가지**:
1. **`stockinvest-cron`은 이 웹훅이 재시작하지 않는다** — 배포 후 항상 `pm2 restart stockinvest-cron --update-env` 수동 실행 필요(기존 경고 그대로 유효).
2. **`git clean -fdx`가 미커밋 변경을 전부 삭제한다** — 이 리포에 미커밋 변경을 오래 남겨두지 말 것. push 시점에 워킹트리가 지저분하면 그대로 증발한다.

## 현재 상태 (2026-08-03 기준)

| 항목 | 상태 |
|---|---|
| 원인 분석 | ✅ 완료 — [[2026-08-02-restructure-plan]] |
| 재구성 설계 | ✅ 완료 (Phase 0~5) — [[2026-08-02-restructure-plan]] |
| Phase 0 안전 기반 | ✅ **구현·3차 reviewer 재검증(PASS)·운영 라이브 QA 전부 완료** — [[T-001-phase0-safety-foundation]] |
| Phase 1 관측+핫픽스 | ✅ **구현·독립 reviewer 감사·배포 전부 완료** (커밋 b0ad876, 2026-08-03 10:00 KST) — [[T-002-phase1-eval-funnel]] |
| Phase 2 파이프라인 수술 | ⬜ analyst 사양 완료, 구현 대기 — [[T-003-phase2-pipeline-redesign]] |
| 운영 서버 | ✅ next 14.2.35로 정상 가동. 오늘자 코드 전부 실데이터로 확인됨 |

## 🔴 사용자 결정 필요 — **1건** (3건 중 2건은 2026-08-05에 해소)

1. **`safety_daily_order_max_pct = 0`** — 명시적으로 0으로 설정되어 있어 Phase 0 fail-safe에 따라 국내 신규 매수가 전면 차단 중이다(매도·청산은 무관). 코드는 정상 동작 중 — 의도한 값(예: 10)을 알려주면 설정 반영. **임의로 채워 넣지 않았다.**
2. ~~**실배포 파이프라인에 테스트 게이트 없음**~~ → ✅ **해소됨 (2026-08-05 실측)**. 현재 `deploy-stockinvest.sh`에는 `set -eo pipefail` + `npm test -- --ci` 게이트 + `pm2 reload --update-env` + 헬스체크가 **전부 들어 있다**(파일 mtime 2026-08-03 13:06 — Phase 0 감사 이후 누군가 추가). 남은 미비점은 **자동 롤백 부재**뿐(헬스체크 실패 시 로그만 남기고 종료). 상세: [[T-005-next15-upgrade]] §Leader 검증 ③
3. ~~**next@14.2.35에 잔존 CVE 21건**~~ → ✅ **사용자 승인·검증 완료 (2026-08-05)**. next 15.5.22로 업그레이드해 **next 관련 GHSA 21건 → 0건**. 격리 클론에서 빌드·테스트·실기동까지 전부 통과, reviewer 최종 감사 PASS. **커밋·push만 남음(사용자 승인 대기).** 상세: [[T-005-next15-upgrade]]

## 다음 할 일

### 1. Phase 2 착수 — [[T-003-phase2-pipeline-redesign]]

관측 3영업일 조건: 2026-08-03(월) 배포 기준 08-04(화)·08-05(수) 확보, **08-06(목) 종료 시 충족.** 게이트 50→26 재편, 스위치 의미 분리, 장중 AI 제거, 룰 파라미터 재도출(RSI 35→38 등).

### 2. 🔴 남은 사용자 결정 1건 — `safety_daily_order_max_pct = 0`

명시적으로 0이라 Phase 0 fail-safe에 따라 **국내 신규 매수가 전면 차단 중**이다(매도·청산은 무관). 코드는 정상 동작 — 의도한 값(예: 10)을 알려주면 반영. **임의로 채우지 않았다.**

### 3. 텔레그램 조용한 실패 (Medium-High, 백로그)

`sendTelegramAlert`가 void 반환이라 전송 실패해도 라우트는 `sent:true` 응답 + `report_trade_last_sent_at` 갱신. **간헐적 ETIMEDOUT이 실재한다** — 08-04 08:03 / 08-04 15:23 / 08-05 11:16 확인(누적 126건). 08-04 08:03 정기 리포트는 실제로 유실됐다. 재시도하면 대개 성공하므로 네트워크 간헐 장애로 보이나, **실패가 사용자에게 안 보이는 것**이 문제. 배달 확인 후 last_sent_at 갱신 또는 dead-man's switch 검토.

### (낮은 우선순위) `oversold-bounce-daily-v1` strategy_id 드리프트

`post-market-engine.ts`가 `oversold-bounce-v1`을 쓰는데 `strategies.id`는 `oversold-bounce-daily-v1`이라 조인 기반 통계에서 영구 누락(pre-existing).

## 반드시 지킬 제약

- **git commit/push 금지** — push가 곧 운영 배포다(webhook-deploy, 위 참조). 커밋은 사용자 승인 후.
- **커밋은 리눅스 호스트에서** — Windows SMB 마운트 작업 시 파일 권한 비트가 다수 파일에서 바뀐 것으로 잡힌다. `git -c core.fileMode=false status`로 실변경만 확인.
- **`npm install`을 Windows에서 실행 금지** — node_modules가 리눅스 바이너리 트리라 SWC 바이너리 교체로 운영이 깨진다. 패키지 변경 시 `npm install --package-lock-only --save-exact`로 lock만 갱신.
- **로컬 검증 빌드 주의** — 이 경로(NFS) 자체가 운영 배포 경로다. **검증은 `npm run typecheck` + `npm test`만 사용, `npm run build`는 실행하지 않는다**(pm2가 서빙 중인 `.next`를 덮어씀). 실제 배포는 webhook-deploy가 별도로 `npm run build`를 수행하므로 문제없다.
- **DB는 운영 MariaDB** — 파괴적 SQL 금지. 스키마 변경은 `src/lib/db.ts` 코드로만(부팅 시 idempotent). 조회는 SELECT만.
- Windows에서 git dubious ownership 에러: `git -c safe.directory='%(prefix)///brownjeon_nas/homes/brownjeon/project/StockInvest' <cmd>` 일회성 지정(글로벌 config 변경 금지).
- **배포 후 `stockinvest-cron` 재시작은 _조건부_** — 2026-08-05 정정. `scripts/cron-runner.sh`는 next를 전혀 require하지 않는 순수 bash+curl 루프라 **next 버전 변경만으로는 재시작 불필요**. 단 `.env`나 `cron-runner.sh` **자체가 바뀐 배포**에서는 여전히 필요(시작 시 `CRON_SECRET`을 1회만 읽고, 실행 중 스크립트 교체 시 bash 오작동 가능). 상세: [[T-005-next15-upgrade]] §Leader 검증 ①

## 미해결 이상징후 (확인 필요)

1. **재시작 317회** — `stockinvest` 누적 재시작(tradinginvest 171회). 원인 불명. `pm2 logs stockinvest --err --lines 60 --nostream`으로 확인.
2. **AI 게이트웨이 다운** — `.env`의 `AI_API_BASE`(192.168.219.163:8001, 맥미니 M4) 연결 실패가 err.log에 기록됨. `curl -sS -m 5 http://192.168.219.163:8001/health`로 확인.
3. **KIS API 초당 거래건수 초과 에러** (`EGW00201`/`EGW00215`) — 2026-08-03 09:31/09:47 err.log에서 확인, domestic balances 조회 실패. 원인·빈도 미조사(오늘 세션 범위 밖).

## 오늘(2026-08-03) 세션 요약

Phase 1 잔여 구현 전항 완료 + 세션 중 신규 결함 2건 수정(stage 8/9/10 계측 공백, `createSignal` 무보호 호출 — 안전 관련) + 독립 reviewer 감사 → 커밋(b0ad876)·배포·cron 재기동. 이어서 Phase 0 3차 reviewer 재검증 수행(PASS) + 운영 라이브 QA(CVE-2025-29927 우회 시도 등) 전부 통과. 재검증 중 인프라 신규 발견 2건(테스트 게이트 부재, next CVE 21건)을 사용자 결정 대기 항목으로 분리. 상세: [[T-002-phase1-eval-funnel]], [[T-001-phase0-safety-foundation]].

## 개선 메모 (Phase 2에서)

- `AUTH_PIN`이 로그인 PIN과 세션 쿠키 HMAC 서명 키를 **겸하고 있다.** `AUTH_SESSION_SECRET`을 분리할 것.
- 로그인 rate-limit이 프로세스 전역 싱글턴 — `stockinvest`가 지금은 `instances:1`이라 문제없지만, 향후 cluster instances를 늘리면 워커별로 카운터가 분리돼 브루트포스 방어가 워커 수만큼 약해진다. 스케일 변경 시 재검토.

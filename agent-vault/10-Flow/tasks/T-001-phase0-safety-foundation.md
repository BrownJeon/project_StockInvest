---
task-id: T-001
project: StockInvest
created: 2026-08-02
status: doing
tags:
  - type/task
  - domain/safety
aliases:
  - Phase 0 안전 기반·위생
---

# T-001 · Phase 0 — 안전 기반·위생

## 배경

재구성 플랜(C:\Users\admin\.claude\plans\majestic-imagining-raccoon.md) Phase 0. 근본 원인 진단에서 확인된 **fail-open 안전장치**와 **무인증 API**는 재구성 작업 중에도 위험하므로 최우선 수술한다.

- 주문 한도가 DB 키(`safety_order_max_pct`/`safety_daily_order_max_pct`) 미설정 시 **Infinity**(src/lib/safety/order-limits.ts:99→104,107,117,120). 잔고 조회 실패 시에도 Infinity.
- 71개 API 라우트 중 61개 무인증. `PATCH /api/settings/safety`로 DRY_RUN 원격 해제 가능. `0.0.0.0` 바인딩.
- Kill Switch drawdown 자동 발동(src/lib/safety/kill-switch.ts:31-87 `checkAndTriggerDrawdownKillSwitch`)은 호출처 없는 dead code.
- `/api/cron/rs-update`만 cron 인증(checkCronAuth) 누락.
- CI(.gitea/workflows/deploy.yml)가 `npm test`를 게이트하지 않음. package.json dev/start 포트 3002 vs ecosystem 3003 불일치.

## 작업 범위 (스펙)

### A. 주문 한도 fail-safe 전환 — `src/lib/safety/order-limits.ts`
- `getEffectiveOrderMax` / `getEffectiveDailyMax`: pct 미설정(≤0) 또는 포트폴리오 평가액 조회 실패(total≤0) 시 **Infinity → 0 반환** (0 = 매수 전면 거부).
- `src/lib/db.ts`의 system_config seed에 안전 기본값 추가(**INSERT IGNORE — 기존 값 절대 덮어쓰지 않음**): `safety_order_max_pct` = 5, `safety_daily_order_max_pct` = 10 (기존 value 저장 포맷 = JSON 문자열 규약 준수).
- **호출처 전수 추적 필수**: `getEffectiveOrderMax` 사용처(engine.ts:898-904의 defaultAmountKRW Infinity 처리, /api/analyst/run, /api/health의 fmtLimit 등)가 0을 받았을 때의 동작을 안전하게 정의(0이면 매수 후보 산정 스킵 + 사유 로그). Infinity 분기 코드는 제거.

### B. 인증 최소선 — `src/middleware.ts` 신설
- 예외(무인증 통과): `/api/health`, `/login`, `/api/auth/login`, `/_next/*`, 정적 자산.
- `/api/cron/*`: `x-cron-secret` 헤더 == `CRON_SECRET` 검증 (edge에서 비교). 기존 라우트 내부 checkCronAuth는 유지(이중 방어). `/api/cron/rs-update/route.ts`에 누락된 checkCronAuth 추가.
- 그 외 전부: HMAC 서명 세션 쿠키 검증(Web Crypto, secret = `AUTH_PIN`). 실패 시 API는 401 JSON, 페이지는 `/login` 리다이렉트.
- `/login` 페이지(모바일 우선, PIN 입력) + `POST /api/auth/login`(PIN 대조 → 쿠키 30일, 간단 시도 제한). 서명/검증 함수는 별도 모듈로 분리해 단위 테스트 가능하게.
- `AUTH_PIN` 미설정 시: 보호 라우트 503 + "AUTH_PIN 설정 필요" 안내(fail-closed). health/login은 제외.

### C. Kill Switch drawdown 배선
- `/api/cron/portfolio-snapshot/route.ts`에서 스냅샷 저장 후 `checkAndTriggerDrawdownKillSwitch()` 호출. 발동 시 기존 알림 경로(sendAlert)로 통지되는지 확인.

### D. `/api/health` 확장
- safety 상태 블록 추가: dryRun / killSwitch / orderMaxPct·dailyMaxPct 실효값 / limitsConfigured / authConfigured / cronSecretConfigured + 종합 `safetyStatus: green|red`. CI가 무인증 접근하므로 크리덴셜 값 자체는 노출 금지.

### E. CI 게이트 — `.gitea/workflows/deploy.yml`
- `npm ci` 후 `npm test`를 build 전에 추가. 실패 시 배포 중단.

### F. 포트 통일 — `package.json` dev/start를 3003으로.

### G. `.gitattributes` 신설 (`* text=auto`, `*.sh text eol=lf`). 기존 워킹트리 30+ modified 파일의 일괄 renormalize는 **하지 않는다**(커밋 단계에서 별도 처리).

### H. `.env.example` 갱신
- 실효 한도 변수 `ORDER_MAX_PCT`/`DAILY_ORDER_MAX_PCT`(DB 우선, env는 참고) 및 `AUTH_PIN` 문서화. 사문 변수(ORDER_MAX_KRW 계열)에는 deprecated 주석. 전면 정리는 Phase 2 문서 단계로 미룸.

### 테스트 (필수)
- order-limits fail-safe: 키 미설정 → 0, 잔고 실패 → 0, 정상 → total×pct% (기존 `src/lib/safety/__tests__/` 패턴 준수).
- 세션 토큰 서명/검증 모듈 단위 테스트.
- kill-switch 배선: portfolio-snapshot 라우트가 check 함수를 호출하는지 mock 테스트.

## 제약 (전 역할 공통)

- **git commit/push 금지** — push는 Gitea Actions 자동 배포를 트리거한다. 변경은 워킹트리에만.
- `npm run build`(타입체크) + `npm test` 전체 통과 필수.
- DB는 NAS 운영 DB — 파괴적 SQL 금지. 스키마·seed 변경은 `src/lib/db.ts` 코드로만.
- safety 레이어 우회 코드 금지. submitOrder() 단일 관문 유지.
- 환경: Windows / PowerShell. 경로 Z:\project\StockInvest.

## 수용 기준

1. DB 한도 키 삭제 상황을 mock한 테스트에서 매수 주문 거부.
2. 미인증 curl → API 401 (health 제외), cron은 x-cron-secret으로만 통과.
3. portfolio-snapshot 실행 경로에 drawdown check 포함.
4. `npm test` + `npm run build` 통과.
5. /api/health에 safety green/red 표시.

## 진행 로그

- 2026-08-02 Leader: task 생성, 스펙 확정. → developer 착수 대기.
- [20:18] Developer: 스펙 A~H 구현 완료 — 한도 fail-safe(Infinity→0) + 호출처 4곳(dry-run/engine/analyst-run/health) 0 처리, Edge Runtime HMAC 세션 미들웨어·/login·/api/auth/{login,logout} 신설, rs-update checkCronAuth+POST 추가, portfolio-snapshot에 drawdown killswitch 배선, /api/health safety green/red, CI에 npm test 게이트, 포트 3003 통일, .gitattributes·.env.example 갱신. 신규 테스트 3종(order-limits-failsafe/session/portfolio-snapshot-killswitch) 통과. **선행 결함 발견**: `undici`가 package.json 미선언(telegram.ts import) → HEAD 상태에서 `npm run build` 실패, `.next/` 비어 있음(배포 파이프라인 red 추정). npm test는 pre-existing 3 suites 실패(portfolio-stability/trade-report/service) — Leader 판단 필요.
- [21:05] Developer: Leader 지시 B1~B3 + rev-phase0 지적 C1·C2·Medium 2건 처리 완료. **C1** next 14.2.15→14.2.25 정확 고정(CVE-2025-29927 미들웨어 우회 패치), `npm install --package-lock-only`로 NAS 공유 node_modules 무변경·lock diff 15개 항목(next 계열 13 + 무해한 nested 2)만 확인. **B1** undici 의존 제거(초기 커밋부터 미설치 = 한 번도 동작한 적 없음, IPv4 강제는 ecosystem.config.js NODE_OPTIONS가 이미 담당) → 빌드 복구. **C2** 로그인 시도 제한을 x-forwarded-for IP 키 → 전역 지수 백오프(5회 free, 이후 1m→2m→…→1h, 잠금 중 PIN 대조 생략, sendAlert 통지)로 교체. **Medium** health에서 한도 금액·pct 제거(포트폴리오 총액 역산 차단), isDryRun/isKillSwitch를 parseBoolFlag 공용 파서로 교체(`1`/`"ON"` fail-open 제거). **B2** 실패 3종 모두 "테스트가 낡음"으로 판별해 갱신(+회귀 방어 케이스 추가). **B3** `* text=auto` 제거. 최종: `npm run build` exit 0, `npm test` 39 suites/381 tests 전부 통과, tsc 에러 0.
- [21:40] Developer: Leader 교정 + rev-phase0 2차 지적 반영. **next 14.2.25 → 14.2.35** (14.2.25가 레지스트리 deprecated = CVE-2025-55184 DoS, App Router hang → pm2 autorestart가 못 잡아 안전장치 cron 조용히 정지). lock의 `deprecated` 필드 소멸을 완료 조건으로 직접 확인했고, next@14.2.35 optionalDependencies의 SWC 핀(14.2.33)이 lock 엔트리와 일치해 `npm ci` 정합도 검증. lock diff 13건 전부 next 계열, react/react-dom 18.3.1 불변. **parseBoolFlag 3분기 재설계**(unset/parsed/unparsable): 미설정과 "값은 있는데 해석 불가"를 구분 — isDryRun 해석불가 → ON+console.error, isKillSwitchActive 미설정 → false·해석불가 → **true + critical 알림**(안전장치 fail-safe 원칙 정렬). (key,raw) 조합당 1회 보고로 스팸 억제. 최종: `npm test` 39 suites/**398 tests** 전부 통과, `npm run build` exit 0, tsc 0.
- [21:10] Reviewer: **판정 FAIL**. Critical 1건 — `package.json`/lockfile이 `next@14.2.15`로 고정돼 있는데 이 버전은 CVE-2025-29927(Next.js 미들웨어 인가 우회, `x-middleware-subrequest` 헤더 스푸핑으로 middleware.ts 자체를 통째로 스킵 — 패치는 14.2.25+)에 취약. 방금 구축한 Spec B 전역 인증 게이트(middleware.ts)가 코드상으로는 정확해도 프레임워크 레벨에서 완전 우회 가능해 "무인증 API 봉쇄"라는 Phase 0 핵심 목적이 무력화됨 — 즉시 중단 필요, Leader·Developer 에스컬레이션 대상(next 14.2.25+ 업그레이드 선행 필요). High 1건 — `/api/auth/login`의 IP 레이트리밋이 클라이언트 제어 가능한 `x-forwarded-for` 헤더를 신뢰 가능한 프록시 검증 없이 그대로 사용해 헤더 스푸핑으로 무제한 PIN 브루트포스 가능(리버스 프록시 확인 안 됨, PM2 direct 0.0.0.0 바인딩). 그 외 Medium 2건(health가 실효 한도액 노출로 포트폴리오 총액 역산 가능 — spec 의도 범위 내 트레이드오프이나 Leader 확인 필요 / `isDryRun()`이 `true`·`'true'` 리터럴만 인정해 비표준 truthy 값이 PATCH로 들어오면 조용히 실거래로 fail-open 될 latent 위험, 이 task 범위는 아니나 dry-run.ts가 수정 대상 파일이라 발견). Spec A/B(코드 자체)/C/D/E/F/H는 의도 충족 확인, G는 `* text=auto` 없이 축소 적용(의도적·문서화됨, Leader 승인 필요). Sell/exit 경로는 한도 fail-safe 영향 없음 확인(정상). 상세는 다음 메시지로 Developer/Leader 직접 전달 예정.
- [21:40] Reviewer: **재검증 — 판정 여전히 FAIL, 그러나 대부분 해소**. dev-phase0 조치 4건 전부 코드·`git diff`·테스트로 직접 재확인(신뢰 안 하고 재검증): ①Critical(CVE-2025-29927) — package.json/lock 모두 `next@14.2.25`로 정확히 고정 확인(lock diff 15개 항목, next 계열 13 + `@swc/helpers` optional peer 제거 + `brace-expansion` nested 패치만 — 주장과 100% 일치). node_modules 실측은 여전히 14.2.15(Windows/Linux 공유 마운트라 로컬 install 금지 — 타당한 설명, `npm ci`는 lock 기준이라 배포 시 14.2.25 설치됨). ②High(rate limit 스푸핑) — `login-gate.ts` 전역 지수 백오프로 교체 확인, `x-forwarded-for` 참조 완전히 사라짐, 잠금 중 PIN 대조 생략도 `route.ts`에서 확인. ③Medium(health 역산) — 금액·pct 완전 제거, boolean만 노출 확인. ④Medium(isDryRun fail-open) — `flags.ts`/`parseBoolFlag` 신설 확인, `isKillSwitchActive`까지 대칭 수정(단 해석불가 시 kill switch는 false 유지 — 발동 방향 fail-safe 원칙과는 반대 판단이라 Leader 재검토 권장, blocking은 아님). 부수 조치(undici 제거, 실패 테스트 3종)는 `git diff HEAD`로 확인한 결과 **소스는 전부 무변경, 테스트만 갱신** — production 로직 변경 리스크 없음(telegram.ts만 undici 제거로 실질 변경).
  **재검증 중 신규 Critical 발견(dev-phase0가 못 잡음)**: 고정된 `next@14.2.25` 자체가 npm 레지스트리에 `"deprecated": "...security-update-2025-12-11"`로 표시됨(lock diff에 그대로 포함되어 있어 발견) — WebFetch로 원문 확인 결과 **CVE-2025-55184(DoS, High)**: App Router 엔드포인트 아무 곳에나 조작된 요청 1건으로 Node 프로세스가 무한루프에 빠져 전체 요청 처리가 멈춤(14.x 라인 수정판은 14.2.35). 이 앱은 100% App Router이고 ecosystem.config.js에 헬스체크 기반 재시작이 없어(`autorestart`는 크래시에만 반응) 행(hang) 상태에서 kill-switch drawdown 체크·exit-engine cron이 조용히 전부 정지할 수 있음 — 실매매 안전장치 자체가 무력화되는 자금손실 직결 리스크로 판단해 Critical로 분류. (CVE-2025-55183 소스코드 노출은 이 앱이 Server Actions 미사용이라 해당 없음. React2Shell RCE(CVE-2025-66478)는 14.x stable 비영향 확인.) **조치는 `next` 버전을 14.2.25 → 14.2.35 로 한 단계 더 올리는 것뿐**(같은 14.2.x 라인, breaking change 없음). dev-phase0에게 재수정 요청 + main 에스컬레이션 완료.

## 최종 요약

(작업 완료 후 Leader 작성)

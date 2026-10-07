---
task-id: T-005
project: StockInvest
created: 2026-08-05
status: done
tags:
  - type/task
  - domain/infra
  - domain/security
aliases:
  - Next 15 업그레이드
  - next15-upgrade
related_tasks:
  - "[[T-001-phase0-safety-foundation]]"
  - "[[T-004-phase1-visual-verification]]"
---

# T-005 · Next.js 14.2.35 → 15.5.x 메이저 업그레이드 (보안)

## 목표

**사용자 명시 승인 완료 (2026-08-05)**: "보안이슈로 인해 업그레이드가 불가피하다, 업그레이드 작업을 진행해달라."

[[T-001-phase0-safety-foundation]] 3차 재검증에서 분리했던 "사용자 결정 필요 3건" 중 **3번(next@14.2.35 잔존 CVE 21건)** 을 해소한다. 해당 CVE들(request smuggling·cache poisoning 등)은 14.2.x 라인에 백포트되지 않고 **15.5.16+ / 16.x 에만 수정**이 존재한다.

## 관련 과거 이력 요약

- [[T-001-phase0-safety-foundation]]: Phase 0에서 next 14.2.15 → 14.2.35 로 올려 CVE-2025-29927(인가 우회)·CVE-2025-55184(DoS) 2건을 막았다. 운영 라이브 curl로 우회 불가까지 재확인 완료. 그러나 `npm audit` 상 **21건이 잔존**하며 14.2.x로는 해결 불가라 사용자 결정 대기로 분리했었다 → **이번에 승인됨.**
- [[T-004-phase1-visual-verification]]: 2026-08-04 세션 착수 시 Leader가 **워킹트리에 미커밋 next 15.5.22 부분 업그레이드가 이미 존재함**을 발견해 범위 밖으로 격리했다. 그 task의 제약 절에 실측 상태표가 있다 — 이번 T-005는 그 상태를 이어받는다.
- [[T-004-phase1-visual-verification]]의 수정분(깔때기 카드·telegram HTML·시그널 정본, 총 7파일)도 **같은 더티 트리에 미커밋**으로 함께 있다. T-005 검증 시 분리하지 말고 **최종 상태를 통째로** 검증한다(어차피 같은 커밋으로 나갈 운명).

## 착수 시점 실측 상태 (Leader, 2026-08-05 09:10 KST)

| 대상 | 상태 |
|---|---|
| `origin/main` = local HEAD | `b0ad876` (next 14.2.35). 워킹트리만 더러움, **ahead 0** |
| `package.json` (워킹트리) | `next: 15.5.22`, `eslint-config-next: 15.5.22` |
| `node_modules/next` | **15.5.22 (이미 설치됨)** |
| `node_modules/react` · `react-dom` | **18.3.1 ← 그대로** ⚠️ |
| `package.json` react·react-dom | **18.3.1 ← 그대로** ⚠️ |
| `.next/BUILD_ID` | 2026-08-03 10:00 = **next 14.2.35로 빌드된 산출물** |
| 실행 중 pm2 `stockinvest` | next **14.2.35**로 기동, uptime 32h+ |
| 미커밋 diff | 26파일 +780/−623 (api 라우트 async params 마이그레이션 다수 + `next.config.js` `outputFileTracingRoot`) |
| node / npm | v20.20.2 / 10.8.2 (next 15 최소요건 Node 18.18+ 충족) |

### ⚠️ 이 상태에서 즉시 도출되는 위험

1. **`pm2 restart stockinvest` = 기동 실패 유력** — next 15 런타임이 next 14 `.next` 산출물을 읽게 된다. 지금 이 앱이 살아있는 건 **32시간 전 메모리에 로드된 next 14 코드로 버티고 있기 때문**이다. 재시작 순간 되돌릴 수 없다.
2. **App Router + React 18 조합 의심** — Next 15는 App Router에서 **React 19를 요구**한다(Pages Router는 18 유지 가능). 이 프로젝트는 전면 App Router인데 react가 18.3.1로 남아 있다 → 기존 부분 업그레이드는 **미완성**일 가능성이 높다. 반드시 실증할 것.
3. **가설: pm2 재시작 317회 누적**과 이 어긋난 상태가 관련 있을 수 있다 (사용자 지적). 업그레이드 완료 후 원인 규명 참고자료로 삼는다.

## ⚠️ 확정된 운영 위험 — 재시작 전에도 상시 위험 (2026-08-05 09:12 실측)

`node_modules/next`가 **2026-08-03 13:10**에 15.5.22로 교체됐는데, pm2 `stockinvest`는 그보다 **3시간 앞선 10:00**에 next 14로 기동됐다. 즉 **메모리엔 next 14 / 디스크엔 next 15**인 상태가 44시간째 지속 중이다.

실증: 실행 중 프로세스의 에러 스택트레이스가 `next/dist/esm/server/future/route-modules/app-route/module.js`를 가리키는데, **`server/future/` 디렉토리는 디스크의 next 15.5.22에 존재하지 않는다**(15에서 제거됨). 메모리에 14가 로드돼 있다는 직접 증거다.

함의:
- **재시작 시 기동 실패**뿐 아니라, 아직 로드되지 않은 next 내부 모듈을 **lazy require 하는 순간 즉시 크래시**할 수 있다 → 재시작을 안 해도 위험하다.
- pm2 `autorestart: true` + `max_memory_restart: 512M`(현재 183MB) + **누적 재시작 317회** → 계획에 없던 자동 재시작이 언제든 발생 가능하고, 그 순간 복구 불능 상태가 된다.
- **이 업그레이드를 완료해 재빌드·배포하는 것이 이 위험을 해소하는 정규 경로다.** 롤백(next 14로 되돌리기)도 유효한 대안이나, 사용자가 보안 업그레이드를 승인했으므로 전진 해소를 택한다.

## 격리 전략 (Leader 확정)

**이 디렉토리에서 `npm run build`를 실행하지 않는다.** NFS 경로가 곧 운영 배포 경로이고 pm2가 이 `.next`를 서빙 중이며 실거래(`DRY_RUN=false`)가 돌고 있다.

- **격리 위치: 로컬 디스크** `/home/brownjeon/.node-local/stockinvest-upgrade/` (ext4, 여유 658G). NFS를 쓰지 않는 이유는 격리 + 속도 둘 다.
- **클론 소스: 로컬 경로에서 직접** `git clone /home/brownjeon/NFS/.../StockInvest <isolated>` — 원격 URL에 **평문 토큰이 박혀 있어** 굳이 네트워크를 타지 않는다(아래 보안 메모 참조).
- **① 먼저 베이스라인 빌드**: 클론 상태(=`b0ad876`, next 14)에서 `npm ci` + `npm run build` 성공을 확인한다. 격리 하네스 자체가 건전함을 먼저 증명해야 이후 실패가 "업그레이드 탓"임을 말할 수 있다.
- **② 그다음 업그레이드 검증**: 워킹트리의 전체 미커밋 변경(next15 + T-004)을 격리본에 반영하고 `npm install`(react 19 동반 상향 시) + `npm run build` + `npm test` + `npm run typecheck`.
- **③ 확정된 코드 변경만** NFS 워킹트리로 되돌려 반영한다. `node_modules`·`.next`는 **절대 복사하지 않는다.**
- 격리본 `.env`는 **더미 크리덴셜 + `KILL_SWITCH=true` + `DRY_RUN=true`** 로 만든다. 빌드가 실제 운영 DB·KIS API를 건드릴 여지를 원천 차단한다. 진짜 값이 없으면 빌드가 실패하는 경우에만 최소 범위로 예외를 두고, 그 사실을 보고한다.

## 🔒 보안 메모 (부수 발견, 이번 범위 밖)

`git remote -v`의 origin URL에 **Gitea 액세스 토큰이 평문으로 박혀 있다**(`http://brownjeon:<token>@192.168.219.154:3000/...`). `.git/config`를 읽을 수 있는 누구나 리포 쓰기 권한을 얻는다. 토큰 회전 + credential helper 전환을 백로그로 올린다. **값은 어디에도 출력하지 말 것.**

## 제약 (위반 시 운영 파손)

- **NFS 워킹트리에서 `npm run build` 금지.** 빌드는 격리본에서만.
- **NFS 워킹트리에서 `npm install`/`npm ci` 금지** — 최종 확정 시 Leader 승인 하에만. (이미 node_modules가 15.5.22로 어긋나 있으니 더 흔들지 말 것)
- **pm2 restart/reload 금지** (`stockinvest`·`stockinvest-cron` 둘 다). 위 위험 1번 참조. 재시작이 필요하다고 판단되면 **중단하고 Leader에게 보고.**
- **git commit / push / stash / checkout / clean / reset 금지.** push = 운영 배포. 전체 검증 통과 후에도 **사용자 별도 승인 없이는 커밋 금지.**
- **운영 DB는 SELECT만.**
- **안전장치(`src/lib/safety/*`, DRY_RUN·KILL_SWITCH·주문 한도) 우회·완화 금지.** 업그레이드가 안전장치 동작을 바꾸면 그것이 최우선 결함이다.
- 시크릿(`AUTH_PIN`·`CRON_SECRET`·`TELEGRAM_BOT_TOKEN`·`DB_PWD`·KIS 키·git 토큰) 출력 금지.

## 역할별 지시사항

### developer (Opus)

1. **breaking change 조사 선행** — 추측 말고 실제 코드를 grep으로 확인 후 범위를 잡는다:
   - async request APIs: `cookies()` / `headers()` / `draftMode()` / `params` / `searchParams` — Next 15에서 전부 Promise. **`src/middleware.ts`(Edge)와 `src/lib/auth/session.ts` 인증 경로가 여기 걸리면 최우선**(인증이 깨지면 [[T-001-phase0-safety-foundation]]가 막은 무인증 노출이 되살아난다).
   - caching 기본값 변경: `fetch` 기본 `no-store` 화, Route Handler `GET` 기본 비캐시, Client Router Cache `staleTime:0`. **시세·잔고 조회가 캐시되면 실매매 오판**으로 직결되니 정밀 확인.
   - **React 19 필요 여부 실증** — App Router에서 next 15가 react 18.3.1을 허용하는지 npm/공식 문서로 확인하고, 필요하면 react·react-dom·@types/react·@types/react-dom 동반 상향. React 19 자체 breaking(ref as prop, function component `defaultProps` 제거, `propTypes` 제거 등) 영향도 grep으로 확인.
   - `next/font`, `next lint`, `NextRequest.ip`, `unstable_cache` 등 제거·변경 API 사용 여부.
   - 목표 버전 확정: 15.5.22가 15.x 최신·안전한지 npm으로 확인(더 높은 패치가 있으면 그쪽). 16.x는 이번 범위 밖.
2. **기존 미커밋 diff 감사** — 이어받을지 재작성할지 판단하고 근거를 남긴다. 특히 async params 마이그레이션이 **전수 적용됐는지**(누락된 동적 라우트가 있으면 런타임 500), 그리고 T-004 변경과 충돌이 없는지.
3. **격리 검증** — 위 "격리 전략" ①②③ 순서 그대로. 베이스라인 빌드 성공을 먼저 보고할 것.
4. **`npm audit`으로 CVE 해소를 실증** — 업그레이드 전/후 건수를 비교해 "21건이 실제로 몇 건이 됐는지" 숫자로 제시한다. 이게 이번 task의 존재 이유다.
5. 산출물: 변경 파일 목록, 격리 빌드 로그 요약, audit 전후 비교, 남은 위험.

### reviewer (Sonnet)

1. **인증·안전장치 회귀 감사 최우선** — async API 변경이 `middleware.ts`의 인증 판정을 무력화하지 않는가. Edge 런타임 제약(`node:crypto` 금지 등)이 next 15에서 달라졌는가. `/api/cron/*` 시크릿 검증, 세션 HMAC 검증이 그대로 동작하는가.
2. **캐싱 기본값 변경이 매매 판단 데이터에 미치는 영향** — 시세·잔고·시그널 조회가 의도치 않게 캐시되면 오주문으로 이어진다. Route Handler·fetch 호출부를 훑어 판정.
3. async params 마이그레이션 **누락 라우트 전수 확인**(하나라도 빠지면 런타임 500).
4. 업그레이드가 [[T-004-phase1-visual-verification]] 변경과 충돌하지 않는지.
5. 판정: PASS 또는 결함 목록 → developer 직접 반려·재검증.

### qa (Haiku)

reviewer PASS 이후, **실매매 안전장치 전담 검증**:
1. `DRY_RUN` / `KILL_SWITCH` / `ORDER_MAX_KRW` / `DAILY_ORDER_MAX_KRW` / `ALLOWED_SYMBOLS` 각각이 업그레이드 후에도 차단 동작하는지 (테스트·코드 경로 확인).
2. 무인증 접근이 401/redirect 되는지, cron 시크릿 없는 호출이 거부되는지.
3. `npm test` 전체 통과(기준선 40 suites / 410 tests 대비 회귀 0).
4. 격리본 빌드 산출물이 정상 기동하는지(격리 포트로 기동해 확인 — **운영 포트 3003 사용 금지**).
5. 결함 발견 시 developer 통보 → **Reviewer부터 전체 재순환.**

## 수용 기준

1. 격리 환경에서 `npm ci` + `npm run build` + `npm test` + `npm run typecheck` 전부 통과.
2. `npm audit` 고위험 CVE가 실제로 해소됐음이 전후 숫자로 입증.
3. 인증·안전장치 회귀 0 (reviewer + qa 이중 확인).
4. NFS 워킹트리에서 build/install 미실행, pm2 미재시작, 커밋 미수행.
5. 사용자에게 배포 절차(커밋·push → webhook-deploy → **`stockinvest-cron` 수동 재시작**)를 안내만 하고 실행하지 않음.

## 진행 로그

- 2026-08-05 Leader: 사용자 승인 수령 → task 생성. 격리 전략(로컬 ext4 클론, 베이스라인 우선) 확정. 착수 시 실측에서 **react 18.3.1 잔존**(App Router + Next 15 조합 의심)과 **origin URL 평문 토큰** 발견.

### developer — 2026-08-05 (phase ① 베이스라인 + breaking change 조사)

- [09:11] 격리본 생성: `git clone <로컬경로> /home/brownjeon/.node-local/stockinvest-upgrade` (원격 URL 미사용). HEAD=`b0ad876`, next 14.2.35 = 베이스라인. `.env`는 전량 더미 + `DRY_RUN=true` + `KILL_SWITCH=true` + DB/LLM 호스트를 **RFC5737 TEST-NET-1(192.0.2.x)** 비라우팅 대역으로 지정 → 운영 DB·KIS 도달 불가. **예외 없이 전부 더미로 빌드 성공.**
- [09:12] **phase ① 베이스라인 PASS**: `npm ci` exit 0(591 pkgs) → `npm run build` exit 0(74 API 라우트 + 14 정적 페이지, 경고 0) → `npm test` 40 suites / 410 tests 전부 통과 → `npm run typecheck` exit 0. **격리 하네스 건전성 입증 완료** — 이후 실패는 업그레이드 탓으로 귀속 가능.
- [09:13] **audit 베이스라인(next 14.2.35)**: 패키지 기준 critical 0 / high 8 / moderate 1 / low 1 = **10건**. 단, 브리핑의 "21건"은 **`next` 패키지 하나에 걸린 GHSA 권고 21건**을 뜻하며 실제로 정확히 21건 확인. npm audit은 이를 high 1건으로 롤업한다(수치 불일치 해소).
- [09:13] **🔑 React 19 필요 여부 — 결론: 불필요.** 근거 3중: ① `npm view next@15.5.22 peerDependencies` → `react: "^18.2.0 || ^19.0.0"` (18 허용). ② next 15.5.22가 **React `19.2.0-canary-0bdb9206-20250818`을 `next/dist/compiled/react`로 자체 번들**한다. ③ `next/dist/build/create-compiler-aliases.js`의 `createVendoredReactAliases()`가 webpack alias로 `react$`·`react-dom$`을 그 번들본으로 **강제 치환**한다 → App Router 런타임은 설치된 react 18.3.1을 **애초에 사용하지 않는다**(Pages Router만 사용자 react를 쓰는데 본 repo는 `src/pages` 부재 = 순수 App Router). 따라서 react 18.3.1 잔존은 **미완성이 아니라 무해**하며, 오히려 @types/react 18과 정합적이다.
- [09:13] React 19 자체 breaking 영향면 **전무**: `defaultProps`·`propTypes`·`forwardRef`·string ref·legacy context(`contextTypes`)·`ReactDOM.render`·`useFormState`·`element.ref` **전부 grep 0건**. jest도 `testEnvironment: node` + `*.test.ts`만이라 컴포넌트 테스트 없음 → React 층 회귀 위험 없음.
- [09:14] **async request API — 위험 없음**: `cookies()`/`headers()`/`draftMode()`(`next/headers`) **사용처 0건**. `src/middleware.ts`는 `req.cookies.get()`·`req.headers.get()` 즉 **NextRequest 인스턴스 메서드**를 쓰는데 이것은 Next 15에서도 **동기 유지**(async화된 것은 `next/headers`의 전역 함수뿐). `src/lib/auth/session.ts`는 Web Crypto(`crypto.subtle`)·`btoa`/`atob`·TextEncoder만 사용 → Edge 제약 변경 없음. **[[T-001-phase0-safety-foundation]]가 막은 무인증 노출이 되살아날 경로 없음.**
- [09:14] **async params 마이그레이션 — 전수 완료 확인**: 동적 세그먼트 파일 **18개 전부**가 미커밋 diff에 포함. 자동 감사 결과 18/18 모두 `params: Promise<...>` 타입 + `await params` 접근이고 **동기 `params.<prop>` 접근 0건**. 핸들러 수 대비 1:1 정합(총 27개 핸들러 = 27개 Promise params, 불일치 0). catch-all(`[...x]`)·`generateMetadata`·`generateStaticParams` 부재 → **누락 라우트 없음 = 런타임 500 위험 없음.**
- [09:14] **캐싱 기본값 변경 — 실질 영향 없음(실증)**: 베이스라인 next 14 빌드 산출물에서 **`/api/*` 74개 전부가 이미 `ƒ (Dynamic)`, 정적 캐시 0개**. 즉 "Next 15에서 GET Route Handler 기본 비캐시화"는 본 repo에 **no-op**. 시세·잔고·시그널 라우트는 `export const dynamic = 'force-dynamic'`이 이미 붙어 있어 Next 14에서도 fetch가 no-store였고 Next 15 기본값(no-store)과 동일 → **캐시로 인한 매매 오판 경로 없음**. 반대 방향(캐시 소멸로 KIS 호출 급증 → `EGW00201` rate limit)도 **호출량 변화 0**이라 해당 없음.
- [09:14] Client Router Cache `staleTime:0` 영향도 무시 가능: 동적 페이지(`/`, `/ai`, `/favorites/[symbol]`, `/recommend/[id]`)가 전부 **서버 데이터 페칭 없는 얇은 Client Component 셸**이라 재네비게이션이 DB·KIS를 건드리지 않는다.
- [09:14] 제거·변경 API 사용 여부: `next/font`·`@next/font` 0건, `NextRequest.ip`·`req.geo` 0건, `unstable_cache`·`unstable_noStore` 0건, `next.config.js`에 `experimental` 플래그 0건. 미커밋 diff의 `outputFileTracingRoot`는 Next 15에서 `experimental.` → **top-level로 승격된 올바른 15 문법**. `package.json`의 `next lint`는 15에서 deprecated(경고만, 동작함) / 16에서 제거 → 이번 범위에선 비차단.
- [09:15] **목표 버전 확정: 15.5.22 유지가 정답.** `npm view next dist-tags` → 15.x 라인의 최신은 `backport: 15.5.22`(latest=16.3.0은 범위 밖). `next` GHSA 21건의 패치 하한이 최대 **`<15.5.21`** 이므로 **15.5.22가 21건 전부를 해소**한다. 여유 1패치.
- [09:15] **업그레이드 후 잔존 예상**: `postcss` high는 남는다 — next@15.5.22가 `postcss 8.4.31`을 고정하는데 권고 범위가 `<=8.5.22`(next@16.3.0은 8.5.23으로 해소). 다만 해당 권고는 **빌드타임 `sourceMappingURL` 경유 파일읽기**라 서드파티 CSS가 없는 본 repo에선 실효 위험 낮음. `adm-zip`(high)·`@anthropic-ai/sdk`(moderate)·`@babel/core`(low)는 **next와 무관한 독립 이슈**로 이번 업그레이드가 건드리지 않는다. `eslint-config-next` 계열 high(glob 경유)는 15.5.22의 `@next/eslint-plugin-next`가 `fast-glob`만 쓰므로 **해소 예상**.
- [09:15] **미커밋 diff 판정: 재작성 불필요, 그대로 이어받을 것.** async params 전수 정합 + next.config 15 문법 정확 + `package-lock.json`도 next/eslint-config-next 15.5.22로 **일관 갱신되어 있어 phase ② `npm ci`가 성립**. react 18.3.1 유지는 위 vendored React 근거로 의도적으로 정당하다.
- [09:15] 준수 확인: NFS 경로에서 build/install **미실행**, pm2 **미재시작**, git commit/push/stash/checkout **미수행**, DB **미접속**(격리본은 비라우팅 IP), 시크릿 **미출력**. 격리본 경로 `/home/brownjeon/.node-local/stockinvest-upgrade`. **phase ②(업그레이드 diff 반영 검증)는 Leader 지시 대기.**

### developer — 2026-08-05 (phase ② 업그레이드 diff 반영·검증)

- [09:20] **diff 이관**: `git -c core.fileMode=false diff -- . ':(exclude)agent-vault'` 로 패치 생성(2286줄) → 격리본에 `git apply`. 파일모드 노이즈 **0줄**(`old mode`/`new mode` 미발생), agent-vault 문서 제외. **28파일 = next15 설정 3(`next.config.js`·`package.json`·`package-lock.json`) + 동적세그먼트 18 + [[T-004-phase1-visual-verification]] 7파일**. T-004 7파일 전량 포함 확인(`eval-funnel-query.ts`·`eval-funnel-labels.ts`·`EvalFunnelCard.tsx`·`trade-report.ts`·`trade-report.test.ts`·`telegram.ts`·`cron/trade-report/route.ts`). 이관 후 28파일 **md5 전량 일치**(NFS ↔ 격리본, mismatch 0)로 바이트 동일성 입증. 미추적 `docs/superpowers/`(설계 스펙 .md 1개)는 빌드 무관이라 제외.
- [09:21] **격리본 검증 전부 PASS**: `npm ci` exit 0(575 pkgs, next **15.5.22** 설치·react/react-dom **18.3.1 유지**) → `npm run build` exit 0(**경고 0**, `✓ Compiled successfully in 6.6s`) → `npm test` exit 0(**40 suites / 413 tests**) → `npm run typecheck` exit 0.
- [09:21] **라우트 수 기준선 대조 — 완전 동일**: 운영 중 next 14 산출물(`.next/app-path-routes-manifest.json`, 8/3 10:00 빌드)과 격리본 next 15 산출물을 **집합 비교** → 양쪽 다 **87개(= API 74 + 페이지 13)**, 차집합 **0**(`IDENTICAL_ROUTE_SET: true`). API 74개 전부 `ƒ (Dynamic)`·정적 0개로 Next 14와 동일 → 캐싱 기본값 변경 no-op 재확인. ⚠️ 기준선 메모의 "14 페이지"는 실측상 **13**이 정확(페이지 12 + 자동 생성 `/_not-found`) — 라우트 누락이 아니라 최초 집계 오차. **회귀 0.**
- [09:21] 테스트 413건은 기준선 410건 대비 **+3**이며 전부 T-004의 `trade-report.test.ts` 추가분(단독 실행 시 20/20 PASS). **회귀 0, 증가만.**
- [09:22] **🎯 `npm audit` 전후 — next 권고 21건 전량 해소.** 방법론을 맞추기 위해 HEAD 락파일로 `--package-lock-only` 재측정해 대조:
  | 구분 | critical | high | moderate | low | 계 | **`next` 자체 권고** |
  |---|---|---|---|---|---|---|
  | before (14.2.35) | 0 | 8 | 1 | 1 | 10 | **21건** |
  | after (15.5.22) | 0 | **6** | 1 | 1 | **8** | **0건** ✅ |
  `next`가 여전히 high로 표시되나 `via`가 `["postcss","sharp"]` 문자열뿐 = **자체 권고 0건, 전이 의존성 롤업**. 소멸 패키지: `eslint-config-next`·`@next/eslint-plugin-next`·`glob`(예측대로 해소). **이번 task의 존재 이유 = 달성.**
- [09:22] 잔존 8건은 전부 **빌드타임 또는 next 무관 독립 이슈**: `postcss`(예측대로 잔존, sourceMappingURL 경유 — 서드파티 CSS 없어 실효 위험 낮음)·`brace-expansion`/`js-yaml`(빌드·린트 체인 DoS)·`adm-zip`·`@anthropic-ai/sdk`·`@babel/core`. **신규 유입 1건 = `sharp@0.34.5`**(next 15의 optional dep, 베이스라인 락엔 부재). 다만 `next/image` **실사용 0건**(유일한 매치는 `middleware.ts`의 matcher 제외 문자열) → **런타임 도달 불가**. 이 3건 모두 next 16으로만 해소되며 이번 범위 밖.
- [09:25] **스모크 테스트 — 격리 포트 3099(127.0.0.1 바인딩), 운영 3003 미사용.** `next start`로 기동 → **`▲ Next.js 15.5.22 / ✓ Ready in 174ms`** 정상 부팅(`npm start`는 `-p 3003` 하드코딩이라 미사용, 바이너리 직접 호출). ⚠️ 참고: `next start` 종료 시 부모만 죽고 자식 `next-server`가 소켓을 계속 점유 → 자식 PID 직접 TERM 필요(정리 완료, 3099 해제 확인).
- [09:25] **인증 미들웨어 메이저 업그레이드 생존 확인 (핵심)**: `/api/health` **200**(`ok:true`, db:false — 비라우팅 IP라 정상) · 보호 API `/api/settings/safety` 무쿠키 **401** `{"error":"unauthorized","detail":"session missing"}` · 보호 페이지 `/settings` **307 → `/login?next=%2Fsettings`** · `/api/cron/*` 시크릿 없음 **401**·오답 **401**·정답 시 미들웨어 **통과**(405 = GET 핸들러 부재) · PIN 오답 **401** `invalid_pin` · PIN 정답 **200 + `si_session` 쿠키 발급**. **[[T-001-phase0-safety-foundation]]가 막은 무인증 노출 재발 없음.**
- [09:25] **async params 런타임 실증**: 세션 쿠키로 동적 라우트 직접 타격 → `/api/orders/1`·`/api/signals/1`·`/api/fundamentals/005930`·`/api/journals/1` 전부 **핸들러 진입 후 DB 계층에서만 실패**(`connect ETIMEDOUT`), 동적 페이지 `/favorites/005930`·`/recommend/1` **200**. 서버 로그에 Next 15 **동기 dynamic API 위반 경고 0건**(`should be awaited`/`sync-dynamic-apis` 매치 0), React·타입 런타임 에러 **0건**. → `await params` 마이그레이션이 **런타임에서도 정상 동작**함을 실증(정적 감사에 이은 이중 확인).
- [09:26] 부수 확인: DB 도달 불가 상황에서 `[order-limits]`가 **한도 0으로 fail-closed**(신규 매수 차단)로 떨어짐 — 안전장치의 fail-closed 성질이 업그레이드 후에도 보존됨.
- [09:26] **수정 사항 0건** — 이관된 diff가 그대로 전부 통과했으므로 **NFS 워킹트리에 되돌릴 변경 없음**(NFS 코드 무수정). phase ① 판정("재작성 불필요, 그대로 이어받을 것")이 실행 검증으로 확정됨.
- [09:28] 준수 재확인: NFS 경로에서 build/install/ci **미실행**(읽기 전용 `git diff`·`status`·`md5sum`·매니페스트 조회만) · pm2 **미조작** · **포트 3003 미사용**(3099만, 운영 3003 리스너 정상 유지 확인) · git commit/push/stash/checkout/clean/reset **미수행**(HEAD `b0ad876` 불변, stash 0) · 운영 DB **미접속** · react/react-dom **18.3.1 유지** · 안전장치 **미수정** · 시크릿 **미출력**. NFS `.next/BUILD_ID` mtime 8/3 10:00 **불변**. **수용 기준 1·2·4 충족 → reviewer 인계 가능.**


## Phase ① 결과 — 베이스라인 + 브레이킹체인지 조사 (2026-08-05, developer/scout)

### 격리 하네스 건전성 = PASS

`/home/brownjeon/.node-local/stockinvest-upgrade` (로컬 ext4, `b0ad876` = next 14.2.35 클론)에서:

| 검증 | 결과 |
|---|---|
| `npm ci` | exit 0 |
| `npm run build` | exit 0 — **74 라우트 + 14 페이지, 경고 0** |
| `npm test` | **40 suites / 410 tests** — 기존 문서화 베이스라인과 정확히 일치 |
| `npm run typecheck` | exit 0 |

격리본 `.env`는 **RFC5737 TEST-NET-1 non-routable IP** + `DRY_RUN=true` + `KILL_SWITCH=true` → 운영 DB·KIS API에 **구조적으로 도달 불가**. 실측 확인됨.

### `npm audit` 베이스라인 (next 14.2.35)

**critical 0 / high 8 / moderate 1 / low 1** (패키지 단위) — `next` 패키지 하나에 걸린 **GHSA 21건**과 정합 확인.

### React 19 — **불필요**로 결론 (중요)

착수 시 Leader가 제기한 "App Router + Next 15면 React 19 필요" 의심은 **기각**됐다:
- next 15.5.22는 App Router에서 **자체 vendored React(19.2.0-canary)를 webpack alias로 강제 사용**한다. 설치된 `react`는 **Pages Router 전용**인데 이 프로젝트엔 `src/pages`가 **없다**.
- React 19 breaking-change 패턴(`defaultProps` on function component / `propTypes` / `forwardRef` / 문자열 ref / legacy context) 코드베이스 내 **0건**.
- → **react·react-dom 18.3.1 유지.** 올리면 불필요한 타입 리스크만 추가된다.

### 브레이킹체인지 대응 — 기존 미커밋 diff 안에 **이미 완료됨**

재작업 불필요, 검증만 통과시키면 된다:
- **async `params`**: 동적 세그먼트 파일 **18/18 전부** 마이그레이션 완료. 핸들러 27개 ↔ Promise params 27개 **1:1 정합** (누락 라우트 0 = 런타임 500 위험 없음).
- `next.config.js`의 `outputFileTracingRoot`가 **Next 15 top-level 형식**으로 올바르게 사용됨(15에서 `experimental` 밖으로 승격된 API).
- `package-lock.json`도 15.5.22로 **일관되게** 갱신됨.
- `next/font` · `cookies()` · `headers()` · `unstable_cache` 등 문제 소지 API는 **코드베이스에 아예 없음**.

### Auth · caching 리스크 — **없음**

- `middleware.ts`는 `NextRequest` **인스턴스 메서드만** 사용 → Next 15에서도 동기 그대로. [[T-001-phase0-safety-foundation]]가 막은 무인증 노출이 되살아날 경로 없음.
- **74개 API 라우트 전부가 이미 `force-dynamic`** → Next 15의 "Route Handler 기본 캐시 안 함" 변경이 이 프로젝트엔 **no-op**. 시세·잔고 오캐시 위험 없고, KIS 호출량 변화도 없어 **레이트리밋(EGW00215) 악화 없음**.

### 확정 타겟: **15.5.22 유지, 기존 diff 이어서 완성**

21개 GHSA의 패치 하한선 최고값이 `<15.5.21` → **15.5.22면 전부 해소**.

업그레이드 후에도 남는 것(이번 범위 밖 판단):
- `postcss` high — next 16.3.0에서만 해소. **실사용 CSS 파이프라인 없어 저위험**.
- `adm-zip` · `anthropic-sdk` · `babel-core` — next와 무관한 별개 의존성.

### 제약 준수 확인

NFS 경로에서 build/install/ci 없음 · pm2 재시작 없음 · git 상태 변경 없음 · DB 접근 없음(non-routable) · 시크릿 미노출 · 업그레이드 diff 미적용(phase ② 대기).

> ⚠️ 재확인된 경고: NFS 워킹트리의 `next.config.js`가 **이미 Next 15 형식**이라, 업그레이드 완료 전에 재시작이 발생하면 복구 불가다. 위 "확정된 운영 위험" 절과 동일 결론.

## 진행 로그 (이어서)

- 2026-08-05 [09:19] Leader: T-004 round-2 코드 NFS에서 검증 — `npm run typecheck` exit 0, `npm test` **40 suites / 413 tests** 통과(기준선 410 → exit 트랙 분해 테스트 3건 추가). T-004와 T-005는 **같은 커밋으로 함께 나갈 운명**이므로 phase ②에서 통합 검증하기로 결정.
- 2026-08-05 [09:20] Leader: phase ②(diff 완성·격리 빌드·audit 후측정·스모크테스트) developer 배정, T-004 round-2 delta reviewer 재감사 병렬 배정.

## Phase ② 결과 — 격리 클론 통합 검증 (2026-08-05, developer)

### diff 이식

NFS 워킹트리의 미커밋 변경 **28파일**(config 3 + 동적세그먼트 18 + [[T-004-phase1-visual-verification]] 7)을 patch로 격리 클론에 이식. **NFS↔클론 md5 비교 mismatch 0(바이트 동일)**. `node_modules`·`.next` 미포함.

### 클론 빌드 — 전부 그린

| 검증 | 결과 |
|---|---|
| `npm ci` | next **15.5.22** 설치, react **18.3.1 유지** |
| `npm run build` | 통과, **경고 0** |
| `npm test` | **40 suites / 413 tests 전부 통과** (T-004 신규 3건 포함, 회귀 0) |
| `npm run typecheck` | 통과 |

### 라우트 카운트 — 기존 표기 오류 정정

phase ①의 "74 라우트 + 14 페이지" 표기는 **오류**였다. 실제는 **API 74 + 페이지 13**(page.tsx 12 + 자동생성 `/_not-found`) = **87**.

Next14 프로덕션 매니페스트 ↔ Next15 클론 매니페스트를 **집합 비교해 대칭차 0** → **라우트 회귀 없음 확정**. API 74개 전부 여전히 `Dynamic`(= 캐싱 기본값 변경 no-op 재확인).

### `npm audit` — 이번 task의 존재 이유, 달성 확인

**next 관련 GHSA 21건 → 0건. 전부 해소.**

남은 8건은 전부 next와 무관하거나 도달 불가:
- `postcss` — next 16.3.0에서만 해소. 실사용 CSS 파이프라인 없어 **저위험**
- `sharp` — 신규 유입이나 `next/image` 미사용이라 **런타임 도달 불가**
- `brace-expansion` · `js-yaml` · `adm-zip` · `anthropic-sdk` · `babel-core` — next와 무관한 별개 의존성

### 격리 포트 3099 실기동 스모크 테스트 — 통과

- `/api/health` **200** — next 15로 실제 부팅 성공
- **인증 미들웨어 정상**: 미인증 401 / 307 리다이렉트 / PIN 로그인 흐름 — [[T-001-phase0-safety-foundation]]가 막은 무인증 노출 **되살아나지 않음**
- `/api/cron/*` 시크릿 검증 정상
- **동적 라우트 async params가 런타임에서 실제 작동** 확인 — `should be awaited` 위반 **0건**(DB 레이어에서만 실패, 이는 non-routable `.env` 때문으로 의도된 결과)
- **DB 불능 시 주문 한도 0으로 fail-closed** 되는 Phase 0 안전 로직 그대로 생존 확인
- 클린 셧다운, 3099 포트 해제 확인

### NFS 코드 수정 0건

클론에서 **첫 시도에 전부 통과**해 diff를 고칠 필요가 없었다. phase ①의 "기존 미커밋 diff를 재작업 말고 그대로 완성하라"는 판단이 **실행으로 재확인**됨.

### 제약 준수 확인

NFS 경로 build/install/ci 없음 · pm2 무조치(포트 3003 프로덕션 리스너 계속 생존 확인) · **git 상태 불변(HEAD 여전히 `b0ad876`)** · DB 접근 없음 · react 18.3.1 유지 · safety 레이어 무변경 · 시크릿 미노출.

## 진행 로그 (이어서)

- 2026-08-05 [10:20] Leader: phase ② 전항 그린 수령. 최종 통합 감사(T-004 + Next15 합본) reviewer 배정.

## Reviewer 결과 — 최종 통합 감사 (2026-08-05, reviewer)

### 판정: **PASS** (28파일 diff에 Critical/High 결함 0건)

`git -c core.fileMode=false diff -- . ':(exclude)agent-vault'` 로 28파일(config 3 + 동적세그먼트 18 + T-004 7) 전량을 직접 감사. developer의 phase①·② 주장을 **전부 독립 재검증**했고 전건 일치 확인. 코드 diff 자체는 결함 없음. 다만 **diff 밖의 배포 경로**에서 MEDIUM 리스크 1건, 정보성 항목 2건을 발견해 아래 별도 보고.

### 1) 배포 경로 분석 — 가장 중요한 발견

`/home/brownjeon/.local/webhook-deploy/deploy-stockinvest.sh` 실측(read-only): `git fetch/reset --hard/clean -fdx -e .env -e node_modules -e .next` → `rm -rf .next/types` → `npm ci` → `npm test -- --ci` → `npm run build` → `pm2 reload stockinvest --update-env` → health curl.

- **pm2 실측(`pm2 jlist`, read-only)**: `stockinvest` = `cluster_mode` 이지만 **instances=1**. sibling worker가 없다.
- **`npm ci`가 next 15.5.22를 보장하는가 → 예.** `npm ci`는 항상 `node_modules`를 지우고 lockfile과 정확히 일치시키므로, 현재 NFS의 얽힌 상태(메모리14/디스크15)와 무관하게 결정론적으로 15.5.22가 설치된다.
- **⚠️ MEDIUM-HIGH: 빌드가 "라이브 서빙 중인 바로 그 디렉토리"에서 in-place로 일어난다.** `npm ci`가 `node_modules/next`를 갈아끼우고 `npm run build`가 `.next`를 next15 산출물로 덮어쓰는 동안, **아직 살아있는 구 워커(next14가 메모리에 로드된 상태)** 가 포트 3003에서 계속 트래픽을 받는다. 이 리포지토리는 이미 이 정확한 패턴(메모리14/디스크15 → `server/future/` lazy require 시 크래시 가능)을 44시간째 실증하고 있다(위 "확정된 운영 위험" 절 참조) — 배포 스크립트는 이 위험을 **회피하지 않고 ci+test+build 구간 내내 능동적으로 재현·연장**시킨다. instances=1이라 이 구간에 구 워커가 크래시하면 **받아줄 형제 워커가 없다** → `autorestart:true`가 재기동한 워커도 build가 끝나기 전까지는 next15 코드 + 아직 next14 모양인/쓰다만 `.next`의 불일치로 재크래시를 반복할 수 있다(누적 재시작 317회에 추가될 수 있음). 빌드가 끝나 `.next`가 next15로 완전히 갱신되는 순간부터는 재기동 워커가 정상 부팅한다.
  - 완화 요인: 격리 클론 검증이 이미 코드 자체의 정확성은 높은 신뢰도로 입증함. `rm -rf .next/types`가 이미 존재 — `tsconfig.json`의 `include`에 `.next/types/**/*.ts`가 걸려있어 async `params` 시그니처 변경으로 인한 stale 타입 충돌을 이미 선제 차단하고 있음(우연이 아니라 이미 올바르게 배치된 안전장치).
  - **추가 갭**: health check(`curl .../api/health`) 실패 시 스크립트는 로그만 덤프하고 `exit 1`할 뿐, `pm2 reload`는 **이미 완료된 뒤**라 자동 롤백이 없다.
  - **권고(수정은 하지 않음, 보고만)**: 이번 1회성 메이저 업그레이드 배포는 webhook 자동배포 대신 트래픽이 적은 시간대에 수동으로 지켜보며 진행하거나, 배포 직전 일시적으로 `instances`를 2로 올려 무형제 구간을 없애는 방안을 leader/사용자가 검토할 것. 장기적으로는 `.next`를 별도 디렉토리에 빌드 후 원자적 스왑하는 방식이 이 클래스의 리스크를 근본적으로 없앤다(이번 범위 밖 제안).

### 2) `stockinvest-cron` 수동 재시작 필요성 — 재검토 권고 (정보성)

수용 기준 5번의 "`stockinvest-cron` 수동 재시작 안내"를 검증하러 `scripts/cron-runner.sh`(pm2 fork_mode)를 직접 읽음: 이 스크립트는 Next.js/Node 모듈을 **전혀 require하지 않는** 순수 bash `while true` 루프로, `http://localhost:3003/api/cron/*`를 `curl`로 호출하고 HTTP status code만 본다. 이번 diff 28파일 중 `cron-runner.sh` 자신은 없고, 스크립트가 프로세스 시작 시 1회만 읽는 `.env` 값(`CRON_SECRET`/`M4_ADMIN_TOKEN`/`AI_API_BASE`)도 이번 변경에 포함되지 않는다. → **next 버전과 무관하게 재시작 불필요**로 보인다. 사용자 안내 문구에서 이 단계를 필수로 강조하기 전에 leader가 재확인 권고.

### 3) `npm audit` 잔존 사유 — grep/npm view로 독립 재확인 (정보성 정정 1건)

- 격리 클론(`/home/brownjeon/.node-local/stockinvest-upgrade`)에서 `npm audit --json` 재실행 → **8건(critical 0/high 6/moderate 1/low 1)**, phase②와 완전 일치. `next` 항목의 `via`가 `['postcss','sharp']` 뿐 → next 자체 GHSA 0건 재확인.
- `npm view next dist-tags` → `backport: "15.5.22"` 확인 — 15.x 라인 최신 패치 맞음(`latest`는 16.3.0, 범위 밖 확인).
- `next/image` 실사용 grep → 0건(유일한 매치는 `middleware.ts`의 matcher 문자열) → sharp 도달 불가 판단 correct.
- **정정 1건(LOW)**: postcss 관련 기존 서술("서드파티 CSS 없음"/"CSS 파이프라인 없음")은 **부정확**. `src/app/layout.tsx:3`에 `import './globals.css'`가 있어 Next 내장 postcss-loader가 매 빌드마다 실제로 동작한다(postcss.config 유무와 무관하게 Next가 항상 태움). 다만 결론(저위험)은 여전히 유효 — postcss GHSA들(XSS via `</style>`, `sourceMappingURL` 경유 임의 파일 읽기)은 전부 **공격자가 제어하는 CSS 입력**을 전제로 하는데, 이 저장소의 유일한 CSS는 정적·개발자 작성 `globals.css` 하나뿐이라 실제 도달 경로가 없다. 결론은 맞되 근거 문구는 정정 필요.

### 4) 독립 재검증 — 전건 일치, 신규 결함 없음

- **middleware.ts / session.ts (diff 밖, 무변경 확인)**: `NextRequest` 인스턴스 메서드(`req.cookies.get`/`req.headers.get`/`req.nextUrl`)만 사용 — Next 15에서도 동기 그대로. `next/headers`(전역 `cookies()`/`headers()`/`draftMode()`) import는 코드베이스 전체에서 **0건**(grep 재확인). `verifySession`은 Web Crypto만 사용, Edge 제약 영향 없음. `/api/cron/*` 시크릿 체크(`x-cron-secret`, fail-closed) 무변경.
- **async `params` 전수 확인 — 독립 재현**: diff 목록이 아니라 `find src/app -type d -name "[*]"`로 **처음부터 다시** 열거 → 동일하게 12개 동적세그먼트 디렉토리 · 18개 파일 · 27개 핸들러/페이지. 전건 `params: Promise<{...}>` + `await params` 확인, 동기 접근 0건. `searchParams`/`generateMetadata`/`generateStaticParams`/`next/headers`를 `src/app` 전체에서 광역 grep — 이 18파일 밖에 마이그레이션 대상이 될 만한 다른 async API 사용처 **없음**(존재하는 `searchParams` 전부 `req.nextUrl.searchParams` 형태의 동기 요청 인스턴스 프로퍼티라 무관).
- **next.config.js**: `outputFileTracingRoot: __dirname` top-level 형식 정확. 전후 모두 `experimental` 블록 자체가 없어 stale 키 문제 해당 없음.
- **package.json/package-lock.json**: next·eslint-config-next 15.5.22 일치, react/react-dom 18.3.1 유지(peerDependency `^18.2.0` 범위 내), `@types/react` 18.3.3과 정합, lockfileVersion 3. drift 없음.
- **T-004 ↔ Next15 상호작용**: `EvalFunnelCard.tsx`는 순수 `'use client'` + `useState`/`useEffect`, legacy React 패턴 없음. `cron/trade-report/route.ts`는 이미 `force-dynamic` + `req.nextUrl.searchParams`(동기)만 사용, safety 레이어는 `getPortfolioTotalKRW()` 읽기 전용 호출뿐. 양방향 상호작용 리스크 없음.

### Reviewer 요약 (JSON)

```json
{
  "reviewId": "REV-T005-FINAL",
  "status": "PASS",
  "issues": [
    { "issue": "배포 스크립트가 라이브 cluster(1) 워커가 서빙 중인 디렉토리에서 in-place로 npm ci/build 수행 — 메이저 버전 경계에서 무형제 크래시 구간 발생 가능", "severity": "MEDIUM", "component": "/home/brownjeon/.local/webhook-deploy/deploy-stockinvest.sh (diff 밖)", "risk": "배포 자체가 일시적 장애가 될 수 있음(자금 손실 직결은 아님)", "recommendation": "저트래픽 시간대 수동 진행 또는 배포 전 임시 instances=2 검토(수정 없이 보고만)" },
    { "issue": "stockinvest-cron 수동 재시작 필요성 근거 불명확 — cron-runner.sh는 next 버전과 완전 무관한 순수 curl 루프", "severity": "LOW", "component": "scripts/cron-runner.sh", "risk": "불필요한 운영 단계로 사용자 혼선 가능", "recommendation": "수용기준 5번 문구 재확인 권고" },
    { "issue": "postcss 잔존 audit 항목의 'CSS 파이프라인 없음' 서술이 부정확(globals.css가 실제 처리됨)", "severity": "LOW", "component": "src/app/layout.tsx:3", "risk": "문서 정확도 문제, 결론(저위험) 자체는 유효", "recommendation": "근거를 '정적·비신뢰 입력 없음'으로 정정" }
  ],
  "summary": { "critical": 0, "high": 0, "medium": 1, "low": 2 },
  "high_risk_areas": ["deploy-stockinvest.sh 실행 구간(빌드~pm2 reload 완료까지)"]
}
```

**QA 인계 가능.** 위 3건은 코드 diff 결함이 아니라 배포 운영 절차에 대한 권고이므로 QA의 실행 검증(DRY_RUN/KILL_SWITCH/한도/무인증 차단/npm test)을 막지 않는다.

## 🔴 배포 전제조건 — 미커밋 파일 소실 위험 (Leader 발견, 2026-08-05)

`deploy-stockinvest.sh`의 `git clean -fdx -e .env -e node_modules -e .next`는 **추적되지 않는(untracked) 파일을 전부 삭제**한다. `.gitignore`에 `agent-vault/`가 **없으므로**, 아래 파일들은 커밋하지 않으면 **다음 배포 순간 영구 소실**된다:

| 미추적 파일 | 성격 |
|---|---|
| `agent-vault/10-Flow/tasks/T-004-phase1-visual-verification.md` | 이번 세션 task 이력서 |
| `agent-vault/10-Flow/tasks/T-005-next15-upgrade.md` | **이 파일 자신** |
| `agent-vault/20-Log/2026-08-04.md` | 타임라인 로그 |
| `agent-vault/20-Log/2026-08-05.md` | 타임라인 로그 |
| `docs/superpowers/specs/2026-08-04-multi-user-kis-accounts-design.md` | ⚠️ **이번 작업과 무관** — 다중 사용자 KIS 계좌 설계 문서(2026-08-04). 누가 언제 썼는지 이번 세션에서 확인 안 됨. **사용자 확인 필요** |

→ **커밋 시 `agent-vault/` 문서 8건을 반드시 함께 포함**할 것. 코드만 커밋하고 push하면 이번 세션의 이력이 전부 사라진다.

→ `docs/superpowers/specs/...`는 이번 작업 산출물이 아니므로 **임의로 커밋하지 않았다.** 사용자에게 보존 의사를 확인해야 한다(방치하면 배포 시 삭제됨).

→ 근본 대책(백로그): `agent-vault/`를 커밋 대상으로 계속 둘지, 아니면 `.gitignore`에 넣고 별도 백업 경로를 둘지 정책 결정 필요. 현재는 "커밋해야 살아남는" 구조다.

## 커밋 대상 파일 실측 (2026-08-05, HEAD `b0ad876`, ahead 0)

- **소스·설정 28건 (수정)**: `next.config.js` · `package.json` · `package-lock.json` / 동적 세그먼트 라우트 18건 / [[T-004-phase1-visual-verification]] 7건
- **agent-vault 문서 8건** (수정 4 + 신규 4)
- **미추적 1건**: `docs/superpowers/specs/2026-08-04-multi-user-kis-accounts-design.md` — 범위 밖, 사용자 확인 대상

## Leader 검증 — reviewer 발견 3건 직접 재확인 (2026-08-05 09:40)

reviewer가 올린 3건 중 2건이 **기존 문서의 오래된 전제를 뒤집는** 내용이라 Leader가 직접 원본을 읽어 확인했다. 전부 사실로 확인됨.

### ① `stockinvest-cron` 수동 재시작 — 이번 배포엔 **불필요** (확인됨)

`scripts/cron-runner.sh` 전문을 읽었다. **순수 bash + curl 루프**다 — `localhost:3003`의 `/api/cron/*`를 주기 호출하고 HTTP status만 본다. Next.js/Node 모듈을 **일절 require하지 않는다**(`node` 문자열은 `~/.node-local/` 경로명일 뿐, JSON 파싱에 python3 사용). 따라서 **next 버전과 무관**하다.

게다가 이번 diff에 `scripts/` **변경이 없다**(실측 확인). → **이번 배포에서 cron 수동 재시작은 기술적으로 불필요.** (해도 무해하다.)

단, 기존 경고가 무의미했던 것은 아니다 — `.env`나 `cron-runner.sh` **자체가 바뀌는 배포**에서는 여전히 재시작이 필요하다(스크립트 시작 시 `.env`에서 `CRON_SECRET`을 1회만 읽고, 실행 중 스크립트 파일이 교체되면 bash가 오작동할 수 있다). **조건부 요건으로 정정**한다.

### ② `postcss` 저위험 근거 — 서술 정정 (확인됨)

"CSS 파이프라인 없음"은 **틀렸다.** `src/app/layout.tsx:3`에 `import './globals.css'`가 있어 Next 내장 postcss가 **매 빌드마다 실제로 동작**한다. 결론(저위험)은 유지되지만 근거는 **"공격자가 제어하는 CSS 입력 경로가 없다"** 로 정정한다. (빌드타임 전용, 신뢰된 자체 CSS만 처리)

### ③ 🟢 **`deploy-stockinvest.sh`에 테스트 게이트가 이미 있다 — 사용자 결정 대기 3건 중 2번이 해소됨**

[[T-001-phase0-safety-foundation]]와 [[RESUME]]가 "실배포 파이프라인에 `npm test` 호출이 없다"를 **Critical급 사용자 결정 대기**로 올려뒀는데, **현재 스크립트에는 있다.** 실측 전문:

```
set -eo pipefail                                    # ← 실패 시 즉시 중단
git fetch origin && git reset --hard origin/main
git clean -fdx -e .env -e node_modules -e .next
rm -rf .next/types
npm ci --no-audit --no-fund
npm test -- --ci                                    # ← ✅ 테스트 게이트 존재
npm run build
pm2 reload stockinvest --update-env                 # ← --update-env 이미 있음
sleep 5
curl -fsS http://127.0.0.1:3003/api/health || (pm2 logs stockinvest --lines 30 --nostream; exit 1)   # ← 헬스체크 존재
```

파일 mtime **2026-08-03 13:06** — Phase 0 감사(그날 오전) **이후**에 누군가 수정했다. `node_modules`가 15.5.22로 교체된 13:10과 **4분 차이**라 같은 작업 세션으로 보인다.

→ **[[RESUME]]의 "사용자 결정 필요 3건" 중 2번은 이미 해결됨.** 다만 자동 롤백은 여전히 없다(헬스체크 실패 시 로그만 남기고 종료).

### ④ 배포 경로 위험 (reviewer MEDIUM) — Leader 판단

`pm2 jlist` 실측 `stockinvest` = **cluster_mode, instances=1**. 배포 스크립트는 **라이브 서빙 중인 바로 그 디렉토리**에서 `npm ci`(node_modules 교체) → `npm test` → `npm run build`(.next 덮어쓰기)를 in-place로 수행하고, 그 수십 초~수 분 동안 **구 워커(next14 메모리)가 계속 트래픽을 받는다.** 이 저장소가 44시간째 실증 중인 "메모리/디스크 불일치 → lazy require 크래시" 패턴을 배포가 **능동적으로 재현·연장**하는 셈이고, instances=1이라 받아줄 형제 워커가 없다.

**Leader 판단**: 이 위험은 배포를 막을 사유는 아니다 — **배포하지 않으면 위험이 영구히 지속**되고, 배포는 그것을 끝낸다. 다만 **타이밍이 중요**하다.

→ **국내장 개장 시간(09:00~15:30 KST)을 피해 15:30 이후에 배포할 것.** 현재 2026-08-05 09:40 KST = **장중이므로 지금 배포 금지.**

## 최종 요약

**보안 업그레이드 검증 완료. 결함 0건. 배포는 사용자 승인 + 장 마감 후 진행하면 된다.**

사용자가 승인한 "next.js CVE 때문에 업그레이드 불가피" 건을 처리했다. 목표였던 **next 취약점 21건이 전부 0건**이 됐다(next 14.2.35 → 15.5.22).

작업 방식은 **운영 경로를 일절 건드리지 않는 것**을 원칙으로 했다. 이 디렉토리 자체가 운영 배포 경로이고 pm2가 여기 `.next`를 실시간 서빙 중이라, 로컬 디스크에 별도 클론을 만들어 거기서 `npm ci` · 빌드 · 테스트 · 실제 부팅(격리 포트 3099)까지 전부 검증했다. 클론의 `.env`는 도달 불가능한 IP로 채워 운영 DB·증권사 API에 절대 닿지 않게 했다.

검증 결과:
- 빌드·테스트·타입체크 **전부 통과** (40 suites / 413 tests, 경고 0)
- **라우트 87개 전부 그대로** — Next14와 Next15 매니페스트를 집합 비교해 차이 0
- **인증·안전장치 전부 생존** — 미인증 차단, cron 시크릿, DB 불능 시 주문한도 0 fail-closed까지 실기동으로 확인
- 코드 **수정이 단 한 줄도 필요 없었다** (기존에 있던 미커밋 업그레이드 작업분이 이미 완성된 상태였음)

작업 중 **오래된 문서 전제 2개가 틀렸음**을 발견해 정정했다: ① 배포 후 cron 수동 재시작은 이번 건엔 불필요(cron은 next와 무관한 순수 curl 루프), ② **배포 파이프라인에 테스트 게이트가 없다는 것은 이미 옛말** — 08-03에 누군가 추가해 뒀다. 그래서 **사용자 결정 대기 3건 중 2번은 이미 해결된 상태**다.

⚠️ **배포 시 주의 2가지**: (1) 배포 스크립트가 라이브 디렉토리에서 in-place로 빌드하는데 워커가 1개뿐이라, 배포 중 수 분간 짧은 장애 가능성이 있다 → **장 마감(15:30 KST) 이후에 할 것.** (2) `git clean -fdx`가 미추적 파일을 지우므로 **agent-vault 문서를 코드와 같이 커밋**해야 이번 기록이 살아남는다.

## ✅ 배포 완료 기록 (2026-08-05 11:08~11:20 KST)

**사용자가 리스크(장중 배포, cluster instances=1) 고지받은 상태에서 즉시 배포를 명시 선택.** 장중(11:08 KST)에 진행.

| 항목 | 결과 |
|---|---|
| 커밋 | `12bd061` — 소스·설정 28 + agent-vault 8 + 설계문서 1 = **37파일** |
| push | `b0ad876..12bd061 main -> main` (11:08:52) |
| webhook-deploy | `started 11:08:59 → finished exit=0` (약 30초) |
| pm2 재시작 | 317 → **318회 1회만** (정상 reload). 재시작 루프 **없음** |
| **에러 로그 증가** | **0바이트** — 배포 전 구간에서 신규 에러 전무 |
| health | `200` 지속 |
| `.next/BUILD_ID` | 2026-08-05 11:09:25 **신규 빌드** |

### 🟢 핵심 성과 — 메모리/디스크 불일치 해소

`pm2 list`의 `stockinvest` version이 **14.2.35 → 15.5.22**로 전환됨. 44시간 지속되던 "메모리 next14 / 디스크 next15" 불일치가 **완전 해소**됐다. 이제 재시작해도 안전하다.

`react` 18.3.1 유지 확인. `stockinvest-cron`은 예상대로 **재시작 불필요**(uptime 2D 유지, 무중단).

### 배포 중 실측된 것

- reviewer가 MEDIUM으로 경고한 "in-place 빌드 + instances=1 구간 장애"는 **실제로는 발생하지 않았다.** 배포 전체가 ~30초로 짧았고(`npm ci`가 캐시 히트, `npm test` 1초대) health 200이 끊기지 않았다. 위험 자체는 실재하나 이번엔 현실화되지 않음 — 백로그 항목은 유지한다.

## 최종 상태

**T-005 완료.** next 15.5.22 운영 반영, GHSA 21건 해소, 무중단 배포.

---

## 📌 2026-08-05 세션 종료 요약 (T-004 + T-005 통합)

이번 세션은 **"깔때기 카드·텔레그램이 실제로 잘 나오는지 눈으로 확인"** 이라는 작은 요청으로 시작해, **Next.js 메이저 보안 업그레이드 배포**까지 끝내고 마무리됐다.

### 한 일

1. **[[T-004-phase1-visual-verification]] 렌더 검증** — 운영 앱을 브라우저로 직접 열어 확인했고, 화면 숫자가 DB 실측과 100% 일치함을 확인했다. 그 과정에서 결함 3건(0건 막대 오표시 / 텔레그램 별표 노출 / 시그널 건수 자기모순)을 찾아 전부 고쳤다.
2. **[[T-005-next15-upgrade]] 보안 업그레이드** — 사용자 승인 후 next 14.2.35 → 15.5.22. **취약점 21건 → 0건.** 운영 경로를 건드리지 않으려고 로컬 디스크에 격리 클론을 만들어 거기서 빌드·테스트·실기동까지 전부 검증한 뒤 배포했다.
3. **무중단 배포 완료** — 커밋 `12bd061`, 재시작 1회, 에러 증가 0바이트, health 무중단. 배포 후 실기동으로 렌더 3건 재검증까지 마쳤다.

### 이번 세션에서 밝혀진 중요한 사실

- **운영이 44시간째 위험한 상태였다** — `node_modules`는 next 15인데 실행 프로세스는 next 14로 떠 있었다(08-03 13:10에 node_modules만 교체됨). 재시작하는 순간 복구 불능이 될 수 있었고, `autorestart:true` + 누적 재시작 317회라 언제든 터질 수 있었다. **이번 배포로 해소됐다.**
- **오래된 문서 전제 2개가 틀렸다** — ① 배포 파이프라인에 테스트 게이트가 **이미 있었다**(08-03 추가됨). ② 배포 후 cron 수동 재시작은 **조건부**였다(cron은 next와 무관한 순수 curl 루프). → **사용자 결정 대기 3건이 1건으로 줄었다.**
- **신규 매수가 막히는 원인이 2개다** — 알려진 `safety_daily_order_max_pct=0` 외에, **KIS 초당 거래건수 초과(EGW00215)로 잔고 조회가 실패하면 fail-safe가 주문 한도를 0으로 만들어 매수를 차단**한다. 즉 한도 값만 설정해도 KIS 레이트리밋이 남아 있는 한 매수는 간헐적으로 계속 막힌다. **두 문제는 함께 다뤄야 한다.**

### 남은 것

1. 🔴 **사용자 결정 1건** — `safety_daily_order_max_pct` 의도 값 (위 KIS 레이트리밋과 묶어서 판단할 것)
2. [[T-003-phase2-pipeline-redesign]] — 관측 3영업일이 2026-08-06(목) 종료 시 충족
3. 텔레그램 조용한 실패(Medium-High) — 간헐 ETIMEDOUT이 실재하고 실패가 사용자에게 안 보인다
4. 배포 스크립트 in-place 빌드 + instances=1 (Medium) — 이번엔 무사했으나 구조적 위험은 남아 있다

> 이 문서 커밋은 **문서 전용 2차 배포**를 트리거한다(작업이력이 다음 배포의 `git clean -fdx`로 사라지는 것을 막기 위한 의도된 선택 — 사용자 승인).

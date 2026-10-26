# StockInvest 모바일 앱(Android) 전환 — 작업절차서

> **상태: 🟢 v3 — M1 = task [[T-084-mobile-app-m1-shell]] **배포·APK 공개 완료(2026-10-25 20:53 KST, 릴리스 `20261025-205329-b4353994`, v1.0.0) · 사용자 실기기 확인 완료(2026-10-26)**. 이어서 [[T-088-app-google-login]] 로 **1.0.1(앱 Google 로그인)** 이 공개되고 사용자가 실기기에서 검증했다(2026-10-26). M2~M4 는 별도 task. 잠복 결함 2건(`gradlew` git 모드·옛 빌드 캐시)은 T-088 에서 수정 완료.**
> 작성 2026-10-22, 개정 2026-10-25 · 본체 task **T-084**(원안의 T-067 은 3일 사이 다른 작업[수익성 감사]이 사용해 변경 — T-083 까지 사용 중이었음) · 후속 3개 번호는 착수 시 빈 번호 확인 후 부여 · 작성 주체: 메인 세션(Leader 역할 겸임)
> 선례: 일본어교육(TheKaiwa) · 공통 정본: [`../../docs/app-conversion-guide.md`](../../docs/app-conversion-guide.md)
> 확신 표기: **[확실]** 이번 조사에서 파일·명령으로 직접 확인 · **[가능성 높음]** 강한 추론 · **[추측]** 확인 못 함

---

## 0. 한눈에 보기

**하려는 것**: 갤럭시 S25+ 에서 홈 화면 아이콘으로 여는 Android 앱. 방식은 TheKaiwa 와 같은 **Capacitor 셸 + `server.url`(운영 URL 로드)** — 앱은 껍데기, 화면·API·매매 로직은 서버에 그대로 있다.

**사용자 결정(2026-10-22)**: 로그인은 이메일·비밀번호 / 앱 파일은 **루트**(TheKaiwa 방식) / **텔레그램 앱 열기·앱 잠금·푸시 알림까지 모두** / APK 전달은 **다운로드 페이지+업데이트 띠**(TheKaiwa 방식).

**추가 결정(2026-10-25)**: 서명 키는 사용자가 만들지 않음(Leader 가 생성) · 앱 이름 **주식캐기** · **DB 관련 승인**(AppRelease 테이블) · "기존 일본어교육 방식과 동일하게". 해석한 부분: appId `com.miraclepenguin.stockinvest`, 서명 키는 **전용 키스토어**(Kaiwa 는 공유 디버그 키 — D-5), AppRelease 는 **테이블**(D-12). 틀리면 정정 요청.

**착수 시 바뀐 것(2026-10-25 재확인)**
- 이 프로젝트가 3일 사이 S00~S09 통합 실행 절차(T-078)와 T-079~T-083 으로 크게 움직였고 **여러 세션이 같은 `main` 에 커밋·배포한다.** 그래서 앱 코드는 **격리 worktree**(`~/.node-local/stockinvest-app`, 브랜치 `mobile-app-t084`)에서 작업하고, 통합은 Reviewer·QA 통과 뒤 rebase → fast-forward 로 한다. (이 절차서 파일도 다른 세션 문서 커밋 `7f92b7e` 에 휩쓸려 들어간 전례가 있다.)
- `SAFETY_PATHS` 가 38개로 늘었다(T-075): **`scripts/migrations/`·`src/lib/db.ts`·`src/app/api/strategies/` 추가.** → AppRelease SQL 도 Reviewer 판정이 필요하다.
- 통합 실행 절차서에 앱 작업을 막는 제약은 없다(grep 확인).

**이 결정이 만든 변화 — 불편한 사실부터**
1. **[확실]** 범위가 "껍데기 앱"에서 "기능 4개짜리 프로젝트"로 커졌다. 한 번에 만들지 않고 **마일스톤 4개**(§0-1)로 나눈다. 각 마일스톤마다 APK 재빌드·`versionCode` 증가·사용자 재설치가 따른다.
2. **[확실]** 안전 경로(`SAFETY_PATHS`, Reviewer 판정 필수)를 **건드린다.** M1 에서 `src/middleware.ts`(다운로드 경로 공개)와 `scripts/migrations/`(AppRelease 테이블), M2 에서 같은 `middleware.ts`(`assetlinks.json` 공개), M4 에서 `src/lib/signals/approval-notify.ts` 와 `src/lib/credentials.ts` 주변(승인 요청 푸시·FCM 비밀키). 앞선 "안전 경로 0건" 권고는 범위 확대로 무효가 됐다.
3. **[확실]** 푸시(FCM)는 **데이터 외부 전송이 있는 외부 서비스 도입**이다. 워크스페이스 규칙상 `/신규도입` 검토와 사용자 결정을 거쳐야 하고, Firebase 프로젝트·서비스 계정 키는 **사용자만 만들 수 있다.**
4. **[가능성 높음]** 텔레그램 링크로 앱 열기는 **안 될 수도 있다.** 텔레그램 인앱 브라우저가 Android App Links 를 가로챌 수 있다. 만들기 전에 실기기 시험(M2-0)으로 먼저 확인한다(T-091 은 §7 M2 참고 — 시험 APK 로 대체).
5. 루트 배치(결정)는 `tsconfig.json` 이 `**/*.ts` 를 포함해 `capacitor.config.ts` 가 웹 빌드·타입체크에 걸리는 문제를 만든다. 질문에서 이 영향을 밝혔고 사용자가 루트를 택했으므로 **완화책(§6)을 넣어 진행**한다.

### 0-1. 마일스톤

| M | 내용 | 선행 조건 | 사용자만 할 수 있는 일 | 상대 규모 |
|---|---|---|---|---|
| **M1** | 셸 APK + 쿠키·키보드·시스템 바 대응 + 로그인 화면 앱 분기 + 아이콘·연결 실패 화면 + **다운로드 페이지·업데이트 띠** | **D-5(서명 키)·D-6(appId·이름) 확정 필수** | 결정 답변, 실기기 확인, (DB 변경 시) 마이그레이션 승인 | 큼 |
| **M2** | 텔레그램 "앱에서 자세히" 링크 → 앱 열기(Android App Links) | M1 배포·서명 키 지문 확정 | 실기기에서 텔레그램 링크 시험 | 작음~중(시험 결과에 좌우) |
| **M3** | 앱 잠금(생체/기기 PIN) | M1 | 잠금 정책 결정, 실기기 확인 | 중 |
| **M4** | 푸시 알림(FCM) | M1, `/신규도입` 검토·승인, **Firebase 프로젝트·`google-services.json`·서비스 계정 키 준비**, DB 마이그레이션 승인 | Firebase 콘솔 작업, 알림 범위 결정 | 큼 |

권고 순서 **M1 → M2 → M3 → M4**. 서명 키·appId 는 M1 첫 APK 전에 확정해야 한다 — App Links 지문(M2)과 덮어쓰기 설치가 이 값에 묶여 있어 나중에 바꾸면 앱을 지우고 다시 깔아야 한다.

---

## 1. 목적 · 범위 · 비목표

| 구분 | 내용 |
|---|---|
| 목적 | 홈 화면 아이콘 앱. 로그인 유지, 키보드·시스템 바 겹침 없음, 외부 링크는 시스템 브라우저. 거기에 텔레그램 링크→앱, 앱 잠금, 푸시 |
| 범위 | M1~M4 (§0-1) |
| 비목표 | 플레이스토어 등록, iOS, 오프라인 동작, 앱 전용 신규 매매 화면, **알림에서 직접 승인/거절하는 동작**(푸시는 열기만, 승인은 기존 승인 화면·텔레그램 버튼에서), 텔레그램 채널 제거, 매매·안전장치 로직 변경 |

---

## 2. 현황 실측 (StockInvest)

| 항목 | 사실 | 근거 |
|---|---|---|
| 앱 흔적 | `android/`·`mobile/`·`capacitor.config.*`·`ios/` **없음**. `public/` 에는 `mockups` 뿐 — 앱 아이콘·`manifest.json` 없음 | `ls` 실측 |
| 프레임워크 | **Next 15.5.27** + React 18.3.1. ⚠ `CLAUDE.md` 는 "Next.js 14" 라 **문서가 낡았다**(착수 시 정정) | `package.json` |
| 운영 | `https://stock.미라클펭귄.com`, 포트 3003, pm2 `stockinvest`+`stockinvest-cron`, **push=Gitea webhook→blue/green 배포** | `docs/deploy-order.md:230,434`, `CLAUDE.md` |
| 인증 관문 | `src/middleware.ts`(Edge) — HMAC 쿠키 `si_session`, **HttpOnly·SameSite=Lax·30일**, `Secure` 는 `x-forwarded-proto` 로 판정. 공개 경로는 `PUBLIC_EXACT`(정확 일치)+`PUBLIC_PREFIX`(`/_next/`·`/__nextjs`·`/static/`)뿐 | `middleware.ts`, `session.ts:16,19`, `session-cookie.ts:13-18` |
| 로그인 | 이메일·비밀번호 + Google/GitHub 버튼(`OAuthButtons`, 서버가 주는 목록만 표시) | `login/page.tsx`, `OAuthButtons.tsx` |
| 화면 | 모바일 우선 412px, `--safe-top/--safe-bottom`·`overscroll-behavior` 이미 있음, 하단 5탭, `target=_blank`·`window.open` **0건**, `localStorage` 는 AI 채팅만 | `globals.css:16-34`, grep |
| 알림 구조 | 발송 분배층 `src/lib/notify/index.ts` — 채널 `none\|telegram\|slack\|both`(`system_config.notify_channel`), 설정 API `api/settings/notify-channel`. **승인 요청은 분배층을 거치지 않고** `signals/approval-notify.ts` 가 `sendTelegramMessage` 로 버튼 메시지를 직접 보낸다. "앱에서 자세히" 링크는 `system_config.app_public_url` | `notify/index.ts:11,94-134`, `approval-notify.ts:17-20`, `docs/telegram-approval.md:25` |
| DB 변경 | `scripts/migrations/*.sql` 을 **사람이 적용**, `--with-migrate` 는 사용자 승인 사항. `system_config`(key/value) 테이블은 이미 있음 | `deploy-order.md:150,210` |
| 타입체크 범위 | `tsconfig.json` `include: ["**/*.ts","**/*.tsx"]`, `exclude` 는 `node_modules`·테스트뿐 | `tsconfig.json` |
| 커밋 훅 | `SAFETY_PATHS` 에 `src/middleware.ts`·`src/lib/auth/*`·`src/lib/auth/oauth/`·`src/lib/signals/`·`src/lib/credentials.ts`·`src/lib/notify/telegram-api.ts`·`src/app/api/cron/`·`src/app/api/signals/` 등. 걸리면 task 의 Reviewer `최종 판정` 줄과 scope 필요. **2026-10-25 재확인: 38개 — T-075 로 `src/lib/db.ts`·`src/app/api/strategies/`·`scripts/migrations/` 추가** | `scripts/git-hooks/commit-msg` |
| 빌드 환경(우분투) | Android SDK `~/.node-local/android-sdk`(build-tools 34·35), JDK 21, `~/.android/debug.keystore`, 키 백업 폴더 존재. 기존 APK 보관 `NFS/homes/brownjeon/apk/`(VoiceVault 2개) | `ls` 실측 |
| 작업 트리 | `main` 이 `origin/main` 보다 2커밋 앞섬 + **타 세션 미커밋 변경 다수** | `git status` |

---

## 3. 선행 사례(TheKaiwa) — 재사용 / 제외

`capacitor.config.ts`·`MainActivity.java`·`build-apk.sh`·`AndroidManifest.xml`·`build.gradle` 서명 주석은 직접 읽어 확인했다. 그 밖(AppRelease, `/app/download`, `proxy.ts` 매처, 이력·교훈)은 조사 에이전트 보고 기준이다.

**재사용**

| 항목 | 내용 | 근거 |
|---|---|---|
| 로드 방식 | `server.url` = 퓨니코드 운영 URL, `androidScheme:'https'`, `cleartext:false`, `errorPath:'index.html'`, `allowNavigation` 비움 | `capacitor.config.ts:38-46` |
| 안드로이드 설정 | `adjustMarginsForEdgeToEdge:'auto'`, `webContentsDebuggingEnabled:false`, `allowMixedContent:false`, `loggingBehavior:'none'` | 같은 파일 `:37,52-54` |
| `MainActivity` | `onPause` 쿠키 flush, 키보드 인셋 보정(`fitAboveKeyboard`), `DownloadListener` | `MainActivity.java:153-157,135-151,75` |
| 앱 내장 플러그인 패턴 | `registerPlugin(...)` 를 `super.onCreate` 전에 호출 — M3(앱 잠금)을 이 방식으로 | `MainActivity.java:71` |
| Manifest | `allowBackup=false`, `singleTask`, `adjustResize`, `usesCleartextTraffic=false` | manifest |
| 빌드 스크립트 틀 | 로컬 작업 디렉터리 rsync, JDK 21, 출력은 **로그 파일로만**(파이프 금지), `aapt2` debuggable 검사, `apksigner` 검증, 동일 이름 다른 내용 덮어쓰기 거부 | `build-apk.sh:15-19,150-166,190-193` |
| 다운로드·업데이트(보고) | 앱 라우트가 등록된 sha256 과 같은 파일만 스트리밍(nginx `alias` 는 `/home/brownjeon`(750) 권한으로 403), 앱 상단 업데이트 띠가 Custom Tab 으로 `latest.apk` 열기, `versionCode` 정수 비교·`minSupported` 강제 | 에이전트 보고 |
| 실기기 5항목 | 쿠키 유지·키보드·edge-to-edge·링크·(OAuth 왕복). **코드만 보고 완료 주장 금지** | `app-conversion-guide.md §4` |

**제외**: 온디바이스 STT(`sherpa-stt`·AAR·모델)·`RECORD_AUDIO`·글 공유 받기·앱 이름/스킴/쿠키명·Prisma `AppRelease`·Next 16 `proxy.ts`·**Google OAuth 딥링크+PKCE(로그인은 이메일·비밀번호로 결정되어 불필요)**.

---

## 4. 변경 인벤토리

### 4-1. M1

| 구분 | 파일 | 내용 | SAFETY |
|---|---|---|---|
| 신규 | `capacitor.config.ts`, `android/**`(소스만 커밋) | appId·appName·server.url, 생성물+`MainActivity`·Manifest·리소스 | — |
| 신규 | `public/app-shell/index.html` | 서버 연결 실패 화면 1장 | — |
| 신규 | 아이콘·스플래시, (선택) `public/manifest.json` | designer | — |
| 신규 | `scripts/build-apk.sh` | Kaiwa 판에서 sherpa 제거, 서명 키 연동 | — |
| 신규 | 앱 감지 모듈(예: `src/lib/native/bridge.ts`) | `window.Capacitor` 전역만 참조 — `@capacitor/*` 를 웹 번들에 import 하지 않는다 | — |
| 신규 | `src/app/app/download/[file]/route.ts`, `src/app/api/app/version/route.ts`, `AppUpdateBanner` 컴포넌트, `/app/download` 안내 페이지 | 다운로드·업데이트 | **다운로드 라우트 공개를 위해 아래 middleware 수정 동반** |
| 수정 | `src/middleware.ts` | `PUBLIC_PREFIX` 에 `/app/download/` **한 곳만** 추가(+테스트) | ✅ **SAFETY** (Reviewer 판정·R2) |
| 수정 | `src/components/auth/OAuthButtons.tsx` 또는 `login/page.tsx` | 앱에서 Google/GitHub 버튼 숨김(화면 표시만) | — |
| 수정 | `package.json`·`package-lock.json` | `@capacitor/{core,cli,android,app,browser,splash-screen,status-bar}` 정확 버전 고정 | — |
| 수정 | `tsconfig.json` | `exclude` 에 `android` 추가 | — |
| 수정 | `.gitignore`, `CLAUDE.md`(앱 절·Next 버전 정정), `docs/deploy-order.md`(APK 절), `.claude/agents/deployer.md`(APK 절차) | 문서·역할 | — |
| 신규 | `scripts/migrations/T-084-app-release.sql` — `app_release` 테이블(`version_code`·`version_name`·`apk_file`·`sha256`·`size_bytes`·`min_supported`·`notes`·`cert_sha256`) | **D-12 확정: 테이블**(사용자 DB 승인) | ✅ **SAFETY**(`scripts/migrations/`, T-075 로 추가) — Reviewer 판정 필요 |

### 4-2. M2 / M3 / M4

| M | 추가 변경 | SAFETY |
|---|---|---|
| **M2** | `AndroidManifest` intent-filter(`autoVerify`, https, 퓨니코드 호스트), `/.well-known/assetlinks.json`(패키지명+서명 인증서 SHA-256 지문) 공개 서빙, 앱이 링크 URL 을 받아 WebView 를 해당 경로로 이동(`window.Capacitor.Plugins.App` 의 `appUrlOpen`) | `src/middleware.ts`(`PUBLIC_EXACT` 에 assetlinks 경로) ✅ — T-091 에서 이 방식을 택했다(nginx 불변, §7 M2 "진행 상태·결정") |
| **M3** | 앱 내장 Capacitor 플러그인(Kotlin/Java, `androidx.biometric` `BiometricPrompt`, 생체 실패 시 기기 PIN 허용 여부는 D-11), 잠금 시 WebView 를 네이티브로 가림, 설정 화면의 잠금 on/off·시간 항목 | 웹 설정 화면 변경은 SAFETY 아님 |
| **M4** | `@capacitor/push-notifications`, `google-services.json`+Gradle 플러그인(`com.google.gms.google-services`), Android 13+ `POST_NOTIFICATIONS` 권한, 토큰 등록 API+**토큰 테이블(마이그레이션=사용자 승인)**, 서버 FCM 발송기(HTTP v1, 서비스 계정 키는 `.env`/`credentialRef` 방식), 알림 분배층에 `push` 채널 추가, `notify-channel` 설정 API·`NotifyChannelSection` 확장 | `signals/approval-notify.ts`(승인 요청을 푸시로도 보낼 때) ✅ · `src/lib/credentials.ts`(키 취급 시) ✅ · `notify/index.ts` 는 SAFETY 아님 |

### 4-3. 건드리지 않는 것 (회귀 검증 대상)

`src/lib/safety/`·`exchanges/`·`strategy/`, 주문·cron API, `src/instrumentation.ts`, `scripts/cron-runner.sh`, `ecosystem.config.js`, 배포 스크립트·nginx(M2 에서 nginx 방식을 택하면 예외), 텔레그램 승인 로직(`telegram-approval.ts`·`telegram-poller.ts`).

---

## 5. 결정 사항

| ID | 결정 | 상태 | 내용 |
|---|---|---|---|
| D-1 | 범위 | ✅ 확대 | 푸시·앱 잠금·텔레그램 앱 열기까지 모두(마일스톤 M1~M4) |
| D-2 | 저장소 배치 | ✅ **루트** (권고는 `mobile/` 이었음) | 완화책: ① 정확 버전 고정 ② `tsconfig.json exclude: android` ③ **push 전에 격리 클론에서 `npm ci && npm run typecheck && npm run build` 통과 확인** ④ 웹 코드에서 `@capacitor/*` import 금지 ⑤ 릴리스의 `npm ci` 영향은 `release.sh` 확인(미조사) |
| D-3 | 로그인 | ✅ 이메일·비밀번호 | 앱에서 OAuth 버튼 숨김. 서버 인증 로직은 불변 |
| D-4 | APK 전달 | ✅ 다운로드 페이지+업데이트 띠 | 상세는 D-12·D-13 |
| D-5 | 서명 키 | ✅ **2026-10-25 생성 완료(Leader)** — 전용 키스토어, 인증서 SHA-256 `6F:A5:AD:6F:65:43:F2:2E:5F:42:21:AA:10:14:0E:77:A4:BD:41:78:05:04:A4:DE:10:49:45:50:61:51:0F:08`(M2 App Links 지문). 사용자는 만들 필요 없음. 위치 `~/.android/`(권한 600), 백업 `NFS/homes/brownjeon/backup/android-signing/stockinvest/` | (원 권고 기록) 권고: **StockInvest 전용 키스토어**. 근거: Kaiwa 는 디버그 키스토어를 의도적으로 재사용했고 비밀번호 `android` 가 SDK 공개 기본값이라 보호가 파일 접근에만 의존한다고 `build.gradle` 주석이 적는다. 학습 앱에는 합리적이나 실매매 앱은 파일 유출 시 같은 서명의 위조 업데이트가 가능 **[가능성 높음]**. 키는 저장소 밖+백업 폴더, **분실 시 덮어쓰기 불가** |
| D-6 | appId·이름 | ✅ 이름 **"주식캐기"**(사용자 2026-10-25) · appId `com.miraclepenguin.stockinvest`(Leader 제안대로, 사용자 이의 없음 — **첫 APK 설치 후에는 변경 불가**) | 아이콘은 designer 시안 3종 중 사용자 선택 |
| D-7 | minSdk·ABI | 🟡 기본값 | `arm64-v8a` 전용, minSdk 26(Kaiwa 와 통일) |
| D-9 | push(배포) 시점 | 🟡 기본값 | 장외 창, push 직전 `date` 확인, 장중은 사용자 명시 지시일 때만 |
| D-10 | 푸시 범위 (M4) | ⏳ M4 전 | 어떤 이벤트(승인 요청·체결·킬스위치·일일 리포트·cron 이상)를 보낼지, 본문에 종목·금액을 넣을지(권고: 잠금화면 비공개+본문 최소). 알림 탭 → 앱 열기만, **알림에서 승인/거절 금지** |
| D-11 | 앱 잠금 정책 (M3) | ⏳ M3 전 | 잠금 시점(콜드 스타트+백그라운드 N초), 생체 실패 시 기기 PIN 허용, 백그라운드 전환 시 최근 앱 화면 가림(`FLAG_SECURE` 를 `onPause` 에서 켜고 `onResume` 에서 끄면 사용 중 스크린샷은 가능) |
| D-12 | AppRelease 저장소 | ✅ **테이블** `app_release`(사용자 "DB 관련 승인" 2026-10-25, Kaiwa 와 동일) | 가산 전용 DDL(`scripts/migrations/T-084-app-release.sql`, SAFETY 경로 → Reviewer 판정). 적용은 Reviewer·QA 통과 뒤 Leader 가 장외에, 코드 배포보다 먼저. 앱은 읽기만, INSERT 는 deployer(`build-apk.sh --publish` 가 SQL 출력) |
| D-13 | 다운로드 보호 수준 | ✅ Kaiwa 방식(사용자 "동일하게") | 공개 경로 `/app/download/`, **등록된 행의 파일 이름·sha256 과 일치하는 `.apk` 만** 스트리밍, 경로 이탈 차단, 요청 제한. APK 보관은 저장소 밖 `/home/brownjeon/apps/stockinvest/shared/app-releases/`(릴리스 prune 과 무관). APK 에 비밀이 없음을 빌드 때 검사 |
| D-14 | FCM 도입 (M4) | ⏳ M4 전 | `/신규도입` 절차: 외부 서비스·데이터 외부 전송(기기 토큰+알림 본문)·신규 비밀키 → 시범 전 보안 검토·사용자 결정 |

**네이티브에 기대는 화면·기능은 웹 배포 전에 앱 버전 게이트를 둔다(T-091, 2026-10-26).** 웹은 push 즉시 바뀌고 APK 는 사용자가 설치할 때 바뀐다 — T-088 때 웹이 먼저 나가 옛 앱 1.0.0 에도 Google 버튼이 보였지만 딥링크 수신 설정이 없어 무응답이었다. 필요 최소 build 는 `src/lib/app-release/feature-gate.ts` 의 `APP_FEATURE_MIN_BUILD` 한 곳에서 관리하고(첫 항목 `googleLogin: 2`), 화면은 `appMeetsFeature()` 로 판단한다 — 앱이 아니거나 build 를 못 읽으면 막지 않는다(업데이트 강제 없음), 판단은 화면 표시용이다(서버 권한 판단에 쓰지 않는다). 네이티브 기능에 기대는 새 화면은 그 표에 한 줄을 더해 옛 앱에서는 그 기능 대신 업데이트 안내가 보이게 한다. **순서: APK 공개(`app_release` INSERT) → 그다음 `APP_FEATURE_MIN_BUILD` 값을 올리는 웹 배포.** 거꾸로 하면 안내 띠의 [업데이트]가 아직 옛 APK 를 내려주는 막다른 길이 생긴다(실행 순서는 [`deploy-order.md`](./deploy-order.md) 「앱(APK) 배포」 — 기능 코드 push 와 표 값 상향 push 를 나눈다). M2 App Link 는 표에 넣지 않았다(아래 §7 M2 "진행 상태·결정").

---

## 6. 영향도 분석

| 영역 | 영향 | 심각도 | 대응 |
|---|---|---|---|
| 주문·안전장치·cron·KIS | 서버 매매 경로 불변. 단 M4 가 `approval-notify.ts` 를 건드리면 **승인 요청 발송 경로**가 바뀐다 | M1~M3 없음 / **M4 높음** | M4 는 R2·Reviewer 필수·Codex 권고. 푸시는 텔레그램을 대체하지 않고 **추가**, 푸시 실패가 텔레그램 발송을 막지 않게 격리 |
| 웹 빌드·배포 | 루트 배치로 `package.json`·lockfile 변경, `capacitor.config.ts` 가 `tsconfig` 범위 | 중 | D-2 완화책. 릴리스에 `android/` 가 실리는 크기·`npm ci` 영향은 **미확인**(`release.sh` 미조사) |
| push=배포 | 앱 파일만 push 해도 웹이 재배포 | 중 | 장외 창, 배포 후 §9-D 확인, 앱 전용 변경은 웹 코드를 최소화 |
| 인증 관문 | M1·M2 가 `middleware.ts` 공개 경로를 넓힘 | **높음(작은 diff, 큰 의미)** | 추가 경로를 **정확히 1개씩**, 테스트로 "그 외 경로는 여전히 401/리다이렉트"를 고정, Reviewer 가 우회 경로 점검 |
| 공개 APK | 누구나 받을 수 있는 경로 | 중 | D-13. 파일 이름 고정, 확장자·sha256 검사, 비밀 포함 검사. nginx 요청 제한 검토 |
| 세션 쿠키 | `onPause` flush 없으면 재실행마다 로그인 | 중 | `MainActivity` 에 포함, 실기기 확인 |
| 폰 분실 | 세션 30일 보관 | 중 | `allowBackup=false`, 디버깅 끔, **M3 앱 잠금** |
| 서명 키 | 분실=업데이트 불가, 유출=위조 | 중 | D-5, 백업·접근 권한 절차 |
| 텔레그램 링크(M2) | 텔레그램 인앱 브라우저가 앱 링크를 가로챌 수 있음 **[추측]** | 중 | M2-0 시험 먼저(T-091 은 §7 M2 참고 — 시험 APK 로 대체). 불가 판정이면 M2 를 접고 보고(대안 없음 — 인라인 버튼은 https·tg 스킴만) |
| 푸시(M4) | 기기 토큰·알림 본문이 Google FCM 으로 전송, 서비스 계정 키 신규 비밀, 토큰 테이블 마이그레이션, 알림 권한(Android 13+) | **높음** | D-14, `credentialRef`/`.env` 방식, 본문 최소화, 마이그레이션 승인, 토큰 만료·삭제 처리 |
| 화면 | 연결 실패 화면·잠금 화면·설정 항목(잠금·푸시)·업데이트 띠 = 새 사용자 화면 | 중 | judge 가 데모 수준 판정 → 데모 승인 후 구현(데모 검토 게이트) |
| 작업 트리 | 타 세션 미커밋 변경 다수 | 중 | 내 파일만 **명시 경로로 `git add`**, `git add -A` 금지 |

**보안 점검 항목(Reviewer)**: ① release 서명·`debuggable=false` ② Manifest: `allowBackup=false`·`usesCleartextTraffic=false`·권한 최소(`INTERNET`, M4 에서 `POST_NOTIFICATIONS`)·export 된 컴포넌트 최소 ③ `allowNavigation` 비움·원격 디버깅 끔·로그 끔 ④ APK 에 비밀값 없음 ⑤ 앱 분기는 화면 표시만 — 서버 검사를 클라이언트 분기에 맡기지 않음 ⑥ 공개 경로가 의도한 것뿐 ⑦ (M3) 잠금 중 WebView 로 향하는 브리지 호출·화면 노출 없음 ⑧ (M4) 푸시 본문·토큰·키가 로그·DB 평문·APK 에 남지 않음.

---

## 7. 단계별 작업 절차

순환은 **Developer → Reviewer → QA**, QA 결함은 Reviewer 부터 재순환. 마일스톤마다 이 순환을 한 번씩 돈다.

### Phase 0 — 승인·접수 (Leader, 구현 없음)
| # | 작업 | 산출물 |
|---|---|---|
| 0-1 | ✅ 문서 승인·결정(2026-10-22 4건 + 2026-10-25 D-5·D-6·D-12·D-13) | 승인·결정 기록은 task T-084 "사용자 결정" 표 |
| 0-2 | `/이슈기록 관련 앱 안드로이드 배포 인증 쿠키` 재조회 | 이번 조사는 **승인된 교훈 0건** |
| 0-3 | T-067 task 이력서(`base_ref`, 과거 이력: Kaiwa task-003f·003h·021, 가이드 §1~§4). `board.md` 는 타 세션 미커밋이 있어 편집 전 확인 | `agent-vault/10-Flow/tasks/T-067-*.md` |
| 0-4 | judge intake — 복잡도·`developer_model`·데모 수준·Codex 필요(M1 은 `middleware.ts` 때문에 R2 취급) | judge 결과, `demo_gate` 초기화 |
| 0-5 | 착수 전 점검: 우분투 SDK/JDK, `release.sh` 가 저장소 파일을 싣는 방식, 타 세션 미커밋 파일 목록 | 점검 메모 |

### M1 — 셸 + 다운로드·업데이트 (T-067)
| # | 작업 | 담당 / 비고 |
|---|---|---|
| 1-1 | `package.json` 의존성 추가(정확 버전), `tsconfig.json exclude: android`, 격리 클론에서 `npm ci && typecheck && build` | Developer — D-2 완화책 ③ |
| 1-2 | `capacitor.config.ts` — §3 재사용 표대로, appId·이름·URL 교체 | Developer. 이 파일 변경=네이티브 변경 |
| 1-3 | `cap add android`(로컬 미러에서) → `MainActivity`(쿠키 flush·IME 보정·DownloadListener), Manifest | 공유 받기·마이크·딥링크는 **넣지 않음**(딥링크는 M2) |
| 1-4 | 연결 실패 화면·아이콘·스플래시 | Designer. 데모 필요 여부는 judge 판정 |
| 1-5 | `build-apk.sh`(전용 키스토어 연동), `.gitignore` | `aapt2`·`apksigner` 검사 통과 |
| 1-6 | 앱 감지 모듈 + 로그인 화면 앱 분기 + 단위 테스트(앱/웹 두 분기) | Developer |
| 1-7 | AppRelease 저장(D-12), `GET /api/app/version`(로그인 필요), `/app/download/[file]`(공개·sha256 일치만), 업데이트 띠, 안내 페이지 | Developer / Designer(띠·안내 화면) |
| 1-8 | `middleware.ts` `PUBLIC_PREFIX` 에 `/app/download/` 추가 + "그 외 경로 불변" 테스트 | **SAFETY**. Reviewer 판정 필요 |
| 1-9 | 문서: `CLAUDE.md` 앱 절·Next 버전 정정, `deploy-order.md` APK 절, `deployer.md` APK 절차(Kaiwa `deployer.md` 참고) | Leader/Developer |
| 1-10 | Reviewer(§6 보안 항목+SAFETY 확인+웹 회귀) → judge C2(→Codex) → QA(**지시 시나리오 vs 실행 목록 표 필수**) | |
| 1-11 | 배포: 내 파일만 명시 `git add` → 커밋(훅) → 장외 push → blue/green → §9-D. 이후 `build-apk.sh` → 배포본 공개 → AppRelease 기록 | Deployer. 푸시·APK 공개는 사용자 승인 |
| 1-12 | 사용자 폰 설치·**실기기 체크(§9-C)** | 통과 전 "완료" 보고 금지 |

### M2 — 텔레그램 링크로 앱 열기
| # | 작업 | 비고 |
|---|---|---|
| 2-0 | **시험(스파이크)**: 텔레그램 승인 점검 메시지(`telegram-approval-selftest`)의 링크 버튼을 앱 설치 상태에서 눌러 앱이 열리는지 확인 | 사용자 실기기. **버튼 호출은 사용자 승인**. 안 열리면 여기서 중단·보고 |
| 2-1 | 서명 인증서 SHA-256 지문 확정(D-5), `assetlinks.json` 서빙(middleware 또는 nginx), Manifest `autoVerify` intent-filter(링크 경로 범위 최소화) | SAFETY(middleware 택 시) |
| 2-2 | 앱이 링크 URL 을 받아 WebView 를 해당 경로로 이동 | 웹은 `window.Capacitor.Plugins.App` 만 사용 |
| 2-3 | 순환·APK 재빌드(`versionCode`↑)·실기기 확인 | 주의: 검증된 App Links 는 크롬에서도 이 도메인 링크를 앱으로 연다 |

**진행 상태·결정(T-091, 2026-10-26)** — 정본 task [[T-091-app-version-gate-and-m2]]. 구현·APK 시험 빌드 단계이고 **아직 배포·공개 전**이다(1.1.0 은 공개되지 않았다).
- **2-0 은 따로 하지 않았다**: 지금 공개된 APK(1.0.0·1.0.1)에는 https 링크 수신 설정이 없어 시험 자체가 2-1 의 Manifest·`assetlinks.json` 이 든 APK 를 요구한다 — 사용자 승인(2026-10-26 "지금 정의되어있는 작업들 모두 진행")에 따라 시험 APK 1.1.0(versionCode 3)으로 바로 확인한다. 텔레그램 앱이 링크를 가로채는지는 여전히 실기기에서만 알 수 있다.
- **범위 = 사이트 루트 한 경로**: Manifest intent-filter 하나(`autoVerify="true"`, `https`, 호스트 `stock.xn--lh0b87pnudm10a4vd.com`, `android:path="/"` 정확 일치). 그 밖의 https 링크(OAuth 콜백·APK 내려받기 등)는 지금처럼 브라우저가 연다. 텔레그램 버튼이 가리킬 곳은 루트 하나면 충분하다(승인 요청 화면 개별 경로가 필요해지면 범위를 다시 정한다).
- **`app_public_url` 권고값 = `https://stock.xn--lh0b87pnudm10a4vd.com/`**(끝 슬래시·퓨니코드·소문자). `android:path="/"` 는 슬래시 없는 `https://호스트` 에는 맞지 않는다 — 안드로이드 `Uri.getPath()` 가 빈 문자열을 주고 `PatternMatcher` 는 리터럴을 그대로 비교한다(AOSP 소스 확인). 안드로이드의 호스트 비교는 대소문자를 구분하고 한글 도메인을 퓨니코드로 바꾸지 않는다(공식 `<data>` 문서). 이 값은 DB 설정이라 코드 배포와 별개로 Leader 가 넣는다(텔레그램 메시지 코드는 바꾸지 않았다 — `approval-message.ts` 는 값을 그대로 버튼 주소로 쓴다).
- **`assetlinks.json` 서빙 = 정적 파일 + 미들웨어 정확 일치**: `public/.well-known/assetlinks.json`(패키지 이름 + 서명 인증서 SHA-256, 공개 정보 — 값은 `build-apk.sh` `EXPECTED_CERT_SHA256` 과 같고 시험 `appLink-t091.test.ts` 가 대조) · `src/middleware.ts` `PUBLIC_EXACT` 에 `/.well-known/assetlinks.json` 1줄(SAFETY — 그 외 `/.well-known/*`·하위 경로·대소문자 변형은 보호 유지, `middleware-public-paths.test.ts` ⑥·⑦). nginx 는 바꾸지 않는다. Next 15 는 `public/` 의 점 폴더도 서빙한다 — 정적 서빙의 `send` 는 마지막 경로 조각이 점으로 시작할 때만 숨기고(`assetlinks.json` 은 해당 없음) 공개 폴더 목록에 거름 조건이 없다(`node_modules/next` 15.5.27 소스 확인, 운영 응답 확인은 배포 후).
- **앱 처리 = 로그인 딥링크와 분리**: `src/lib/native/appLink.ts`(`resolveAppLinkTarget`·`onAppLink`) + 레이아웃에 한 번 둔 `src/components/app/AppLinkNavigator.tsx`(그리는 것 없음). https·지금 문서와 같은 호스트·`sanitizeAppNextPath` 를 바뀌지 않고 통과하는 같은 출처 경로일 때만 `location.assign` 으로 이동하고, 이미 그 화면이거나 로그인·가입 흐름 화면이면 이동하지 않는다. 콜드 스타트 주소(`getLaunchUrl`)는 앱 프로세스당 한 번만 본다. 로그인 콜백(`stockinvest://auth/callback`)은 `onAuthDeepLink`(구독자 하나)가 그대로 맡고 이 모듈은 커스텀 스킴을 무시한다.
- **`APP_FEATURE_MIN_BUILD` 에 `appLinks` 는 넣지 않는다** — 링크에 기대는 새 화면이 없다(옛 앱에서는 링크가 브라우저로 열릴 뿐).
- **순서: 웹 배포(assetlinks 공개) → APK 공개.** 안드로이드는 설치 때 assetlinks 를 받아 검증하므로 거꾸로면 검증이 실패한다 — [`deploy-order.md`](./deploy-order.md) 「앱(APK) 배포」.
- **알려진 영향**: 검증된 App Link 는 크롬 등에서도 루트 주소(`https://stock…com/`)를 앱으로 연다 — 루트 한 경로라 영향이 작다. `build-apk.sh` 의 Manifest 검사는 "딥링크 정확히 둘(로그인 콜백 + https 루트 `autoVerify`)"로 바뀌었다.

### M3 — 앱 잠금
| # | 작업 | 비고 |
|---|---|---|
| 3-0 | D-11 결정 + 설정 화면 데모(designer) → 승인 | 데모 게이트 |
| 3-1 | 앱 내장 플러그인(`BiometricPrompt`), 잠금 오버레이(네이티브가 WebView 를 가림), `FLAG_SECURE` 처리 | Developer. 네이티브 변경 |
| 3-2 | 설정 화면 항목(잠금 on/off·시간) — 웹 | |
| 3-3 | 순환·APK 재빌드·실기기 확인(잠금 중 우회 불가, 생체 미등록 기기, 실패 반복) | |

### M4 — 푸시 알림
| # | 작업 | 비고 |
|---|---|---|
| 4-0 | **`/신규도입` FCM 검토**(보안·외부 전송 게이트) + D-10 결정 + 사용자가 Firebase 프로젝트·`google-services.json`·서비스 계정 키 준비 | 사용자 작업 포함. 승인 전 설치·호출 금지 |
| 4-1 | 토큰 테이블 SQL 작성 → **사용자 승인 후** 적용 | `--with-migrate` 자체 판단 금지 |
| 4-2 | 서버: 토큰 등록 API, FCM 발송기, 분배층 `push` 채널, 설정 화면 확장, (승인 요청 푸시 시) `approval-notify.ts` 에 격리된 추가 호출 | **R2·SAFETY**. 푸시 실패가 텔레그램 발송을 막지 않음 |
| 4-3 | 앱: 플러그인·권한(Android 13+)·알림 탭 → 앱 열기(M2 링크 재사용) | 네이티브 변경 |
| 4-4 | Reviewer(승인 경로 격리·키 취급)→ judge C2 → Codex(권고) → QA → 실기기(권한 거부, 앱 종료 상태 수신, 중복·누락) | 실주문 시간대 배포 금지 |

---

## 8. 팀 역할 배정

| 역할 | 맡을 일 | 비고 |
|---|---|---|
| Leader | Phase 0, 결정 정리, task 이력서, 마일스톤별 최종 보고 | 보고 양식 `../../docs/user-report-format.md` |
| judge | intake(복잡도·데모 수준·developer 모델), C1·C2 | M1·M4 는 R2 취급 |
| Designer | 연결 실패·아이콘·스플래시·업데이트 띠·다운로드 안내·(M3) 잠금·설정 | 디자인 스킬은 designer 전담 |
| Developer | 구현 | 모델은 judge 판정(R2 면 Opus) |
| Reviewer | 독립 감사 | SAFETY 파일 커밋 전 `최종 판정`+scope |
| QA | 검증 | 시나리오 표 필수(board 의 QA 축소 이력 대응) |
| Deployer | 웹 배포 + APK 빌드·공개·AppRelease 기록 | **[확실]** StockInvest `deployer.md` 에 APK 언급 0건 — 착수 시 Kaiwa `deployer.md`(3·28·36·43·67행) 참고해 추가 |
| 사용자 | 결정, 실기기 확인, DB 마이그레이션·FCM 도입·배포 승인, Firebase 콘솔 작업 | |

---

## 9. 검증 체크리스트

**A. 빌드**: `build-apk.sh` 종료 코드 0 · debuggable 없음 · `apksigner` 서명 확인 · `versionCode`/`versionName` · APK 안에 비밀값 없음.

**B. 웹 회귀**: `npm run typecheck` 0 오류 · `npm test` 통과 수 이전과 동일 · `npm run build` 성공 · **격리 클론 `npm ci` 로 재현** · `git diff --name-only` 의 SAFETY 파일이 task 의 Reviewer scope 안.

**C. 실기기(사용자, 갤럭시 S25+)**
- [ ] 로그인 후 **앱 완전 종료→재실행** 시 로그인 유지
- [ ] 상·하단이 상태바/내비게이션 바와 겹치지 않음 (하단 5탭 포함)
- [ ] 주문 수량 입력·AI 채팅 입력창이 키보드에 가려지지 않음
- [ ] 차트 터치/스크롤이 페이지 스크롤과 충돌하지 않음(lightweight-charts)
- [ ] 로그인 화면에 Google/GitHub 버튼이 보이지 않음
- [ ] 앱 안 링크가 외부 브라우저로 튕기지 않음 / 외부 링크는 시스템 브라우저
- [ ] 뒤로가기: 화면 이동은 이전 화면, 최상위에서는 앱 종료
- [ ] 로그아웃·세션 만료 시 로그인으로 이동
- [ ] 비행기 모드에서 연결 실패 화면, 복구 후 정상 로드
- [ ] 업데이트 띠: 낮은 `versionCode` 앱에서 띠가 보이고 `latest.apk` 다운로드→설치 (Chrome "유해할 수 있는 파일" 확인에서 멈춘 듯 보일 수 있음 — Kaiwa 실측)
- [ ] (M2) 텔레그램 링크 버튼 → 앱 열림, 해당 화면으로 이동
- [ ] (M3) 잠금: 콜드 스타트·백그라운드 복귀·최근 앱 화면 가림·생체 실패 시 동작
- [ ] (M4) 알림 권한 허용/거부, 앱 종료 상태 수신, 탭 → 앱 열기, 잠금화면 본문 노출 수준

**D. 배포 후(Deployer)**: `webhook-deploy` 로그 `START sha=…`→`END exit=0` 쌍(pm2 `online` 만으로 판단 금지) · `/api/health` 200 · `pm2 list | grep stockinvest-cron` **1행** · 인증 없는 요청 401 · **공개 경로 점검**: `/app/download/` 외 보호 경로가 여전히 401/로그인 리다이렉트 · 안전장치 스위치 값 불변.

---

## 10. 롤백

| 대상 | 방법 |
|---|---|
| 웹 변경 | `scripts/deploy.sh StockInvest --rollback` (코드만, DB 변경 없음) |
| 공개 경로 | 롤백 시 `/app/download/` 공개도 함께 사라짐 — 정상 |
| 앱 | 이전 APK 재설치. **더 낮은 `versionCode` 는 덮어쓰기 불가** → 이전 소스를 더 높은 `versionCode` 로 다시 빌드하거나 삭제 후 재설치. AppRelease 롤백=최신 값을 이전 값으로 되돌림 |
| 푸시(M4) | `notify_channel` 에서 `push` 제거로 즉시 중단, 토큰 테이블은 유지 |
| 전체 철회 | 앱 삭제 + 앱 관련 파일·의존성 제거 커밋 |

---

## 11. 위험 · 미확인

- **[확실]** 서명 키 분실=업데이트 불가. 백업 폴더 `NFS/homes/brownjeon/backup/android-signing/` 는 있으나 StockInvest 전용 키 보관 절차는 새로 정해야 한다.
- **[추측]** 텔레그램 인앱 브라우저가 App Links 를 가로채는지(M2) — 시험 전에는 알 수 없다.
- **[추측]** FCM 도입이 `/신규도입` 에서 보류·조건부로 나올 수 있다 — M4 일정은 그 결과에 달렸다.
- **미확인**: `release.sh` 가 저장소 파일을 릴리스에 싣는 방식과 `npm ci` 옵션, lightweight-charts 의 WebView 터치 동작, WebView 에서 Next 15 클라이언트 라우팅의 뒤로가기, `assetlinks.json` 을 Next `public/.well-known/` 으로 서빙할 때의 **운영 응답**(소스로는 서빙됨을 확인 — T-091, 운영 `curl` 은 배포 후), 인터넷 노출된 공개 APK 경로에 nginx 요청 제한이 필요한지.
- **문서 불일치**: Kaiwa `deployer.md:118` 의 APK 산출물 경로는 낡았다. `app-conversion-guide.md §5` 는 TheKaiwa 를 "계획"으로 적었지만 이미 완료. StockInvest `CLAUDE.md` 는 Next 14 로 적었으나 실제 15.5.27.
- **교훈(Kaiwa 이력)**: 처음 debug 빌드 배포 계획이 Codex 지적 후 release 빌드로 바뀜 · 키보드는 웹만으로 해결 안 되고 네이티브 인셋 보정 필요 · 딥링크는 가로채기 대비 필요 · nginx `alias` 는 403 이라 앱 라우트로 대체 · `--publish` 에서 `.env` 줄 끝 한글 주석이 경로에 섞임.

---

## 12. 참고 경로

| 구분 | 경로 |
|---|---|
| 공통 정본 | `../../docs/app-conversion-guide.md` |
| 선행 사례 | `../../TheKaiwa/capacitor.config.ts` · `android/app/src/main/java/com/miraclepenguin/kaiwa/MainActivity.java` · `scripts/build-apk.sh` · `android/app/src/main/AndroidManifest.xml` · `.claude/agents/deployer.md` |
| 선행 사례 이력 | `../../TheKaiwa/agent-vault/10-Flow/tasks/` 의 `task-003f`(셸·APK) · `task-003h`(브랜딩) · `task-021`(키보드) |
| 서식 참고 | `../../bjj-trainning/agent-vault/30-Knowledge/runbooks/app-icon-and-apk-procedure.md` · `android-apk-build.md` |
| StockInvest | `src/middleware.ts` · `src/lib/auth/session*.ts` · `src/app/login/page.tsx` · `src/components/auth/OAuthButtons.tsx` · `src/lib/notify/index.ts` · `src/lib/signals/approval-notify.ts` · `docs/deploy-order.md` · `docs/telegram-approval.md` · `scripts/git-hooks/commit-msg` |

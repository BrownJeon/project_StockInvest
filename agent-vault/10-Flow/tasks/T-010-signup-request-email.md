---
task-id: T-010
project: StockInvest
created: 2026-08-08
status: blocked-awaiting-mockup-approval
tags:
  - type/task
  - domain/auth
  - domain/notify
aliases:
  - 가입 요청
  - 초대코드 요청 메일
related_tasks:
  - "[[T-008-multiuser-auth-step1]]"
  - "[[T-009-oauth-login]]"
  - "[[T-007-telegram-silent-failure]]"
---

# T-010 · 가입 요청 → 관리자 Gmail 알림

## 목표

사용자 지시: 로그인 화면에 **"가입 요청"** 을 추가해, 초대코드가 없는 외부인이 요청하면 **관리자 Gmail로 자동 알림**이 가게 한다.

**해결하려는 불편**: 지금은 초대코드를 알려주려면 관리자가 **서버 `.env`를 직접 열어봐야 한다.** 그 과정을 없애는 것이 목적.

## 사용자 확정 결정

- **트리거**: 외부인이 요청 → **관리자에게 자동 이메일**. (대안이던 "관리자가 버튼 눌러 자기에게 셀프 발송"은 기각)
- **발송 방식**: **Gmail SMTP** (Resend 등 API 서비스 아님). 관리자가 Google 앱 비밀번호 발급 필요.

## 착수 전 실측 (Leader)

| 항목 | 결과 |
|---|---|
| `nodemailer` 네이티브 바인딩 | **없음** — 9.0.5, `dependencies` 비어있고 `gypfile` 없음 → **순수 JS**. 네이티브 회피 원칙에 위배되지 않음 ✅ |
| 기존 메일 인프라 | **없음** (신규 도입) |
| 재사용 가능한 rate-limit 자산 | `login-gate.ts` · `signup-gate.ts` · `request-limits.ts` |
| 기존 알림 채널 | **텔레그램·슬랙이 이미 동작 중** ([[T-007-telegram-silent-failure]]에서 정비 완료) |

### 🔴 `nodemailer`도 jsonwebtoken 과 똑같은 함정에 걸려 있었다

```
require.resolve('nodemailer') → /home/brownjeon/node_modules/nodemailer/lib/nodemailer.js
package.json 선언: 0건
```

**또 홈 디렉토리에서 해석된다.** [[T-009-oauth-login]]에서 정확히 이 함정에 빠질 뻔했고, 그때 `docs/oauth-integration-guide.md`에 경고를 남겨뒀다. 이번엔 착수 시점에 바로 확인해서 걸렀다.

→ **반드시 `package.json`에 명시 선언**하고 `npm install --package-lock-only --save-exact` 로 lock 을 갱신한다(NFS에서 전체 install 금지). 안 하면 로컬은 되고 배포 후 `npm ci` 에서 죽는다.

## 🔒 이 기능의 핵심 보안 불변식

**초대코드는 오직 `ADMIN_NOTIFY_EMAIL`(env) 로만 나간다. 요청자가 입력한 주소로는 어떤 경우에도 나가지 않는다.**

이게 깨지면 초대 게이트가 통째로 무의미해진다 — 누구나 "가입 요청" 폼에 자기 주소를 넣고 코드를 받아버린다. 수신자 주소는 **요청 본문에서 절대 파생되지 않아야** 한다.

부수 위험:
- **이메일 헤더 인젝션** — 요청자 입력(이름·이메일·사유)이 헤더에 들어가면 CRLF 로 헤더/수신자 조작 가능. 본문에만 넣고, 헤더에 넣어야 하면 엄격히 정규화
- **스팸** — 인터넷 공개 무인증 엔드포인트다. 관리자 메일함 도배 방지 rate limit 필수(IP + 이메일)
- **요청자 이메일 위조** — 남의 주소로 요청 가능(검증 수단 없음). 관리자가 코드를 **수동 전달**하는 구조라 실피해는 제한적이나, 관리자용 메일에 "이 주소는 검증되지 않았습니다"를 명시해야 오판을 막는다

## 설계 제안 (목업으로 승인받을 것)

### 폼 입력 항목

| 항목 | 필수 | 근거 |
|---|---|---|
| 이메일 | ✅ | 관리자가 회신할 유일한 수단 |
| 이름/호칭 | ✅ | 관리자의 첫 질문이 "누구세요"다. 짧게 |
| 요청 사유 | 선택 | 판단에 도움되나 필수화하면 마찰만 커짐 |

### 관리자 수신 메일 내용 (코디네이터 이해와 일치 — 목업으로 재확인)

요청자에게 코드를 **자동 발송하지 않는다.** 관리자 메일에 **요청자 정보 + 현재 초대코드**를 함께 담아, 관리자가 검토 후 **직접(카톡 등) 전달**한다.

→ 이러면 관리자가 `.env`를 열 필요가 사라지고(원래 목적 달성), 초대 게이트도 그대로 유지된다.

### T-007 교훈 재적용 — 발송 실패를 성공으로 보이지 않게

"요청이 접수되었습니다" 화면 문구가 **SMTP 발송 성공을 보장하지 못하면** 안 된다.

**제안**: SMTP 실패 시 **이미 동작 중인 텔레그램으로 폴백 알림**을 보낸다. 신규 인프라 0으로 "관리자가 요청을 놓치는 경우"를 없앤다([[T-007-telegram-silent-failure]]에서 정비해둔 채널을 그대로 활용). 양쪽 다 실패하면 화면에 정직하게 실패를 알리고 로그·critical 알림을 남긴다.

## 사용자 작업 필요 — 신규 env 5개 (코드만으론 완성 불가)

| env | 값 | 발급 방법 |
|---|---|---|
| `SMTP_HOST` | `smtp.gmail.com` | 고정 |
| `SMTP_PORT` | `587` | 고정 (STARTTLS) |
| `SMTP_USER` | 발신 Gmail 주소 | 본인 Gmail |
| `SMTP_PASS` | **앱 비밀번호 16자리** | ① Google 계정 **2단계 인증 활성화**(필수 선행) ② myaccount.google.com → 보안 → **앱 비밀번호** → 앱 이름 입력 후 생성 → 16자리 복사. **일반 Gmail 비밀번호로는 안 된다** |
| `ADMIN_NOTIFY_EMAIL` | 알림 받을 주소 | `SMTP_USER`와 같아도 되고 달라도 된다 — **사용자 확인 필요** |

## 제약

NFS `npm run build`/`install` 금지(lock만 `--package-lock-only`) · pm2 재시작은 env 반영 시에만 · 운영 DB SELECT only · 커밋/푸시 승인 후 · **reviewer 보안 감사 필수**(공개 엔드포인트 스팸·헤더 인젝션·수신자 위조·코드 유출)

## 진행 로그

- 2026-08-08 Leader: task 생성. `nodemailer` 순수 JS 확인(원칙 위배 없음) + **홈 디렉토리 해석 함정 사전 차단**. 핵심 불변식(초대코드는 env 주소로만) 규정. 목업 작성 → 승인 대기.

## Developer 작업 기록 (2026-08-09)

- [10:12] 구현 완료. `npm run typecheck` 통과 · `npm test` **69 suites / 902 tests 전부 통과** (baseline 64/775 → +5 suites / +127 tests). NFS 에서 build·install·dev 미실행, pm2 미조작, 운영 DB 미접근, 실제 메일·텔레그램 발송 0건.

### 신규 파일
- `src/lib/mail/config.ts` — SMTP env 판정 (호출 시점 read). `isMailEnabled()` = OAuth 의 `isProviderEnabled()` 패턴
- `src/lib/mail/header-safe.ts` — `sanitizeHeaderText` / `isSafeHeaderAddress` / `escapeHtml`
- `src/lib/mail/send.ts` — `sendAdminMail(content)`. **인자에 수신자 필드 없음**
- `src/lib/mail/signup-request-mail.ts` — 관리자 메일 본문 + 폴백 본문(코드 미포함)
- `src/lib/auth/attempt-gate.ts` — `login-gate` 에서 추출한 시도제한 팩토리(동작 동일)
- `src/lib/auth/signup-request-gate.ts` — IP 축·이메일 축 게이트(저장소 분리)
- `src/lib/auth/signup-request.ts` — 입력 검증 + `clientIpKey`
- `src/app/api/auth/signup-request/route.ts` — GET(enabled) / POST(발송)
- `src/app/signup/request/page.tsx` — 폼 + 성공/폴백/실패/미설정 4상태
- `src/components/auth/SignupRequestLink.tsx` — 진입 링크(미설정 시 렌더 안 함)
- `src/types/nodemailer.d.ts` — 최소 타입 선언(nodemailer 9 는 자체 타입 미배포)
- 테스트 5종: `mail/__tests__/{header-safe,signup-request-mail,send}.test.ts`, `auth/__tests__/signup-request.test.ts`, `api/auth/signup-request/__tests__/route.test.ts`

### 수정 파일
- `src/lib/auth/login-gate.ts` — attempt-gate 위임 래퍼로 전환. **공개 API·상수·정책 전부 동일**, 기존 13 suites/183 tests 무변경 통과로 검증
- `src/middleware.ts` — `/signup/request`, `/api/auth/signup-request` 공개 경로 추가
- `src/app/login/page.tsx` · `src/app/signup/page.tsx` — `<SignupRequestLink/>` 추가
- `src/components/auth/AuthShell.tsx` — `logo` prop(기본 📈) + `textarea`·`bigResult*` 스타일 추가
- `src/components/BottomTabs.tsx` — `HIDDEN_PATHS` 에 `/signup/request` 추가
- `package.json` / `package-lock.json` — `nodemailer` 9.0.5 정확 고정 (`npm install --package-lock-only --save-exact`, node_modules 421개 불변)
- `.env.example` — SMTP 5종 + 앱 비밀번호 발급 절차

### 🔒 불변식 보증 방법
수신자를 요청에서 파생시킬 **경로 자체를 없앴다**. `sendAdminMail(content)` 의 인자 타입에
`to`/`cc`/`bcc` 가 없고, 본문 조립 함수도 수신자를 만들지 않는다. `to` 는 `getAdminNotifyEmail()`
한 곳에서만 나오고, `src/types/nodemailer.d.ts` 의 `MailOptions` 에 `cc`/`bcc` 를 선언하지 않아
나중에 한 줄 추가하는 것도 컴파일 에러가 된다.

### Reviewer 가 봐줘야 할 판단 3가지
1. **`login-gate.ts` 리팩터링** — "기존 auth 동작 미변경" 제약 하에서 굳이 손댄 이유:
   공개 폼과 Map 을 공유하면 `prune()` 축출로 로그인 실패 카운터가 지워진다(테스트로 재현·방어).
2. **`delivery:'fallback'` 3번째 상태** — 목업에 없는 화면. 메일 실패 + 텔레그램 성공일 때
   "전송되었습니다"(거짓)도 "전달하지 못했습니다"(거짓)도 아닌 상태가 실제로 존재한다.
3. **폴백 본문의 요청자 이메일 비마스킹** — 이 앱 관행(`maskEmail`)과 다름. 마스킹하면
   관리자가 회신할 수단이 사라져 폴백이 무의미해지기 때문. 대신 초대코드는 폴백에서 제외.

## Reviewer 검토 기록 (2026-08-09)

- [10:23] 독립 감사 완료. `git diff`+`git status`로 변경분 전수 확인, `npm test` 직접 재실행 —
  **69 suites / 902 tests 전부 통과**(개발자 보고와 일치, 직접 재현·신뢰하지 않고 검증).
  `npm run typecheck` 클린(0 에러). NFS에서 build/install/dev 미실행, pm2 미조작, 운영 DB 미접근,
  실제 메일·텔레그램 발송 0건. `/etc/nginx/sites-enabled/stock.미라클펭귄.com.conf` 실제 vhost와
  `ecosystem.config.js`(`-H 0.0.0.0 -p 3003`) 직접 확인. 목업(artifact b1ab92b1) 원문도 페치해 대조.

### 판정: DEFECTS (MEDIUM 1건) — 핵심 보안 불변식은 완전히 유지됨(PASS)

1. **[MEDIUM] Telegram/Slack 마크업 인젝션 — 폴백 알림 경로**
   `src/lib/mail/signup-request-mail.ts:139-152` (`buildSignupRequestFallbackText`)가
   요청자 입력(`name`/`email`/`message`)을 **어떤 이스케이프도 없이** 그대로 문자열에 삽입하고,
   이 값이 `src/app/api/auth/signup-request/route.ts:137-141`에서 `dispatchAlert()`로 전달된다.
   - `src/lib/notify/telegram.ts:70-73` — `sendTelegramAlert`가 `parse_mode:'HTML'`로 발송하며
     `body`를 이스케이프 없이 그대로 삽입(`mrkdwnToTelegramHtml`은 이 경로에 적용 안 됨,
     주석상 의도적으로 전역 적용을 안 하는 함수라 이 호출부가 직접 감쌌어야 함).
   - `src/lib/notify/slack.ts:41-46` — `sendSlackAlert`도 `type:'mrkdwn'`으로 `body`를 그대로 삽입.
   - **재현 경로**: SMTP 발송이 실패하는 순간(관리자 Gmail 앱비번 만료, Gmail 임시 차단, 네트워크
     장애 등 — 공격자가 직접 트리거하긴 어렵지만 발생 조건 자체는 낮지 않음) `message` 또는
     `name` 필드에 `<a href="https://phishing.example/kis-login">지금 확인</a>`(Telegram) 또는
     `<https://phishing.example|지금 확인>`(Slack)을 넣어 요청하면, 관리자의 Telegram/Slack에
     **요청자가 고른 문구로 위장된 클릭 가능한 링크**가 "가입 요청" 알림 형태로 그대로 렌더된다.
     admin이 여기 링크를 클릭하면 피싱 페이지로 유도될 수 있음(사회공학 벡터).
   - **불변식(Priority 1) 침해 여부: 없음.** `buildSignupRequestFallbackText`는 애초에
     `inviteCode`를 인자로도 받지 않는 구조라(`Omit<..,'inviteCode'>`) 이 경로로 코드가
     새어나갈 방법은 없다 — 테스트(`route.test.ts` "폴백 본문에는 코드가 들어가지 않는다")로도
     확인됨. **초대코드 유출과는 무관**하고, 순수히 관리자 알림 채널의 표시 형식이 오염되는
     문제다. 이메일 헤더 인젝션 방어(`header-safe.ts`)는 이 경로에 아예 관여하지 않는다 —
     `sanitizeHeaderText`/`escapeHtml`는 메일 제목·HTML 본문에만 적용되고 텔레그램/슬랙
     폴백 텍스트는 별도 함수라 방어망 밖에 있었다.
   - **권고**: `buildSignupRequestFallbackText`가 담는 `name`/`email`/`message`를 발송 직전
     Telegram HTML 이스케이프(`&`→`&amp;` `<`→`&lt;` `>`→`&gt;`)와 Slack mrkdwn 이스케이프
     (`&`/`<`/`>`)로 각각 감싸거나, 애초에 두 채널이 공유할 수 있게 채널-무관 plain 텍스트만
     보장하는 공통 헬퍼를 두는 편이 안전. 자금 손실·계정 탈취 경로가 아니므로 배포를 막을
     정도는 아니라고 판단하나, 다음 수정 사이클에서 반드시 닫을 것을 권고.

### 우선순위 1 — 핵심 불변식: 요청자 입력은 수신자에 도달할 수 없다 (CONFIRMED, 코드 추적으로 검증)
`sendAdminMail(content: AdminMailContent)`의 시그니처에 수신자 필드가 없고, `adminEmail`은
try 블록 진입 **전**(`send.ts:74-77`) `getAdminNotifyEmail()`로 확정된다 — 이후 `content`가
무엇이든 `to`에 영향을 줄 수 없음을 코드 흐름으로 직접 확인(주장을 읽는 게 아니라 추적함).
Telegram/Slack 폴백 경로(`buildSignupRequestFallbackText`)는 `inviteCode`를 타입 레벨에서부터
받지 않아 코드가 그쪽으로 샐 방법이 구조적으로 없음. `route.test.ts`의 CRLF·`to`/`bcc`/`adminEmail`/
`recipient` 필드 끼워넣기 테스트 7종도 실제로 실행해 통과 확인.

### 우선순위 2 — `login-gate.ts` 리팩터링: 필요했다고 판단, 저위험 (PASS)
`git diff -- src/lib/auth/login-gate.ts` 전문 대조 결과 상수(`FREE_ATTEMPTS=5`,
`BASE_LOCK_MS=60_000`, `MAX_LOCK_MS=3_600_000`, `IDLE_TTL_MS=7_200_000`, `MAX_KEYS=5_000`)·
공개 함수 시그니처·정규화 규칙이 전부 동일하고, **기존 `login-gate.test.ts`가 한 글자도
수정되지 않은 채** 전부 통과(직접 재실행 확인) — 순수 위임 래퍼임을 독립적으로 증명.
`attempt-gate.ts`의 `prune()`을 직접 읽어 축출 취약점 주장도 검증: `lockedUntil` 오름차순
정렬이라 `lockedUntil=0`(=아직 안 잠긴, 실패 1~5회 누적 중)인 항목이 항상 먼저 축출 대상이
되므로, 공유 Map에 공개 폼으로 키를 계속 밀어 넣으면 로그인 실패 카운터가 지워진다는 주장은
수학적으로 성립. 별도 Map(코드 중복)도 대안이 될 수 있었으나, 상태 머신 자체가 브루트포스
방어 로직이라 두 벌로 나뉘면 한쪽만 패치되는 drift 위험이 생긴다 — 팩토리 추출 + 얇은 래퍼가
더 나은 트레이드오프라고 판단. **동의: 필요했고, 저위험으로 잘 실행됨.**

### 우선순위 3 — 공개 엔드포인트 남용 표면
- 헤더 인젝션(이메일): `isSafeHeaderAddress`가 `SMTP_USER`/`ADMIN_NOTIFY_EMAIL` 양쪽에 모두
  적용되고 공백·CRLF·쉼표·세미콜론·꺾쇠·따옴표·괄호를 전부 거부 — fail-closed 확인.
  요청자 이메일은 `isValidEmail`(공백 전부 거부)이라 CRLF 자체가 애초에 통과 못 함.
- Rate limit: IP 축 등록이 파싱 **이전**(`route.ts` 2단계)에 일어남을 코드 순서로 확인,
  검증 실패 요청도 IP 쿼터를 소비함을 테스트로 확인. `signupRequestEmailGate`가 이메일당
  2회뿐이라 **공격자가 피해자 이메일로 2회만 요청해도 그 주소를 10분(반복 시 최대 6시간)
  잠글 수 있음** — 이 자체는 이 앱의 `login-gate`도 이미 갖고 있는 동일한 트레이드오프
  (인증 없는 식별자 기반 rate limit의 본질적 한계, 소유권 증명 수단 없음)이고 개발자 주석도
  "이메일 축은 보안 경계가 아니라 스팸 속도 제한"이라 명시해 인지하고 있었음 — 별도 결함으로
  세지 않음(정보 제공 차원에서만 기록).
- IP 판정: `/etc/nginx/sites-enabled/stock.미라클펭귄.com.conf:18` 실측 —
  `proxy_set_header X-Real-IP $remote_addr` 확인(치환, 클라이언트 위조 불가). pm2가
  `ecosystem.config.js:7`에서 `-H 0.0.0.0 -p 3003`로 바인딩하는 것도 실측 확인 — LAN 직결
  캐비엇은 정확하고 기존 `login-gate`가 이미 받아들인 것과 동일한 한계.

### 우선순위 4 — 배송 정직성 (T-007)
`route.ts`의 sent/fallback/failed 3분기가 코드 구조상(early return) 상호배타적임을 확인.
목업(artifact b1ab92b1) 원문을 직접 페치해 대조 — 목업 화면 2는 성공/실패 2종만 그려져 있지만,
주석에 "둘 다 실패하면 빨간 화면"이라고 명시돼 있어 **메일만 실패하고 텔레그램이 성공하는
경우 빨간 화면을 보여주면 안 된다는 의도가 목업 문구 자체에 이미 내포**돼 있었음 — 개발자의
3번째 상태 추가는 목업 이탈이 아니라 목업의 미완성 명세를 정확히 채운 것으로 판단.
`rejected` 배열 체크로 SMTP 레벨 거절도 실패로 처리함을 확인.

### 부가 확인
- `isMailEnabled()` 미설정 시: `nodemailer` 정적 import 전무(grep 확인), GET은 `enabled:false`,
  POST는 503, rate limit 미소비 — 전부 테스트로 확인.
- `package-lock.json` diff 10줄만 존재 — `nodemailer` 엔트리 1개 추가 외 전이 의존성 0개,
  전체 install 안 일어났음을 diff 자체로 확인(패키지 다운로드 없이는 이 diff가 불가능한 구조).
- `middleware.ts`의 `PUBLIC_EXACT`는 `Set.has()` 정확 일치라 prefix 우회 위험 없음.

**결론: 초대코드 유출·수신자 조작·로그인 브루트포스 방어 우회 경로는 어디에도 없음.
MEDIUM 1건(Telegram/Slack 마크업 인젝션)은 배포를 막을 사유는 아니나 후속 수정 권고.**

### Developer — reviewer MEDIUM 수정 (2026-08-09)

- [10:31] MEDIUM 1건 수정 + leader 추가 요청 반영. `npm run typecheck` 클린 · `npm test` **70 suites / 930 tests 전부 통과** (수정 전 69/902 → +1 suite / +28 tests). 실제 메일·텔레그램·슬랙 발송 0건, node_modules 421개 불변, 신규 의존성 없음.

**결함 독립 검증**: `telegram.ts:76`(`parse_mode:'HTML'`)·`slack.ts:46`(`type:'mrkdwn'`) 양쪽이 `body` 를 그대로 보간하는 것을 코드로 확인. reviewer 지적대로 실재하는 벡터였다.

**수정 — 새 구현이 아니라 기존 이스케이프를 추출해 재사용** (leader 지시):
- `src/lib/notify/escape.ts` (신규) — `escapeAlertText()`. `mrkdwnToTelegramHtml` 안에 있던 엔티티 이스케이프 절반을 **추출**한 것. 구현 1개 / 소비자 2개
- `src/lib/notify/telegram.ts` — `mrkdwnToTelegramHtml` 이 `escapeAlertText` 를 호출하도록 변경. **동작 동일** (이스케이프 → 서식변환 순서 보존)
- `src/lib/mail/signup-request-mail.ts` — 폴백 본문의 name/email/message 주입 지점에 적용. 정적 문구의 `**굵게**` 제거(두 채널 어디서도 의도대로 렌더되지 않음)
- `src/app/api/auth/signup-request/route.ts` — **critical 알림 본문에도 적용**(아래 추가 발견)
- `src/components/BottomTabs.tsx` — `HIDDEN_PATHS` 에 `/oauth/invite` 추가 (leader 요청)

**추가 발견 (reviewer 리포트 범위 밖)**: critical `sendAlert` 본문의 `maskEmail(email)` 도 요청자 파생값이다. `isValidEmail` 이 로컬파트의 `<`·`>` 를 허용하므로 `<a>xxxx@evil.com` → `<a*****@evil.com` 이 되고, 텔레그램이 HTML 파싱 실패로 400 을 낸다. 공백이 막혀 있어 태그를 완성할 수는 없으니 피싱보다는 **유실** 벡터인데, 하필 "다른 모든 전달이 실패했다"고 알리는 알림이 같은 이유로 사라진다 — T-007 실패 유형 그대로다. 함께 이스케이프했다.

**신규 테스트 28개**: `notify/__tests__/escape.test.ts`(신규 suite — 두 채널 링크 페이로드 무력화 + `mrkdwnToTelegramHtml` T-004 동작 보존 회귀 가드. 이 함수는 그동안 직접 테스트가 없었다), `mail/__tests__/signup-request-mail.test.ts`·`api/.../route.test.ts` 에 주입 시나리오 추가.

**⚠️ 같은 결함 클래스 — 미수정, 별도 판단 필요**: `src/app/api/auth/login/route.ts` 의 로그인 잠금 알림도 `maskEmail(email)` 을 이스케이프 없이 `sendAlert` 에 넘긴다. 로그인은 임의 이메일 입력을 받으므로 동일 벡터다. "기존 auth 동작 미변경" 제약이라 손대지 않았다.

### Reviewer — 수정 재검증 (2026-08-09)

- [10:34] MEDIUM 수정을 재감사. `npm test` 직접 재실행 — **70 suites / 930 tests 전부 통과**(개발자 보고와 일치, 직접 재현). `npm run typecheck` 클린. 실제 발송 0건.

**MEDIUM 결함: CLOSED.** `escape.ts`·`telegram.ts`·`signup-request-mail.ts`·`route.ts` 전문 대조 완료.
`mrkdwnToTelegramHtml`이 `escapeAlertText(body).replace(/\*([^*\n]+)\*/g, '<b>$1</b>')` 순서를 지켜
T-004 서식 변환 동작이 보존됨을 확인(이스케이프 우선 → 우리가 만든 `<b>`는 안 지워짐, 신규
회귀 테스트로도 확인). `buildSignupRequestFallbackText`의 name/email/message 세 필드 전부
`escapeAlertText`를 거침을 확인. 채널별로 안 나누고 `&`/`<`/`>` 3글자 공통 이스케이프로 처리한
설계도 타당 — Telegram HTML과 Slack mrkdwn이 정확히 이 3글자만 이스케이프하면 안전해지는
교집합이라는 주석의 주장을 직접 확인(Slack 공식 규정과 일치). `route.ts`의 critical 알림
(메일+폴백 모두 실패 분기)에도 `escapeAlertText(maskEmail(email))`이 적용된 것을 확인 —
console.log/error 라인(129/136)은 미적용 상태로 남겨뒀는데, 이건 맞는 판단이다(로그는
Telegram/Slack으로 안 나가므로 이스케이프 불필요, 과잉적용 아님).

**추가로 요청받은 판단: `login/route.ts`의 `maskEmail(email)` — 확인, 실재하되 LOW.**
개발자 주장(`<a>xxxx@evil.com` → `<a*****@evil.com`, 공백 금지라 `<a href=...>` 링크 완성 불가,
malformed 태그로 텔레그램 400 → 유실)을 실제 `isValidEmail`/`maskEmail` 로직을 그대로 옮겨
node로 직접 실행해 재현·확인했다. 여기서 한 걸음 더 들어가 봤다: `maskEmail`은 로컬파트
앞 2글자만 남기고 나머지를 `*`로 지우지만 **도메인 부분은 통째로 마스킹하지 않는다.**
도메인은 `[^@.]+`(점·`@` 제외 전부 허용, 공백만 전역 금지)이라 `<b>`처럼 속성이 필요 없는
태그는 공백 없이도 완성된다 — 직접 실행해 확인:
`ab@evil.com<b>path</b>` → `isValidEmail` true, `maskEmail` → `ab*@evil.com<b>path</b>`
(완전한 `<b>...</b>` 쌍이 마스킹 없이 그대로 살아남는다). 즉 이 벡터는 "깨진 태그로 인한
유실"만이 아니라 **`<b>`/`<i>`/`<code>`/`<pre>`/`<tg-spoiler>` 같은 속성 없는 서식 태그를
멀쩡하게 주입**할 수도 있다는 뜻이다 — 다만 `<a href="...">` 링크는 공백이 전역 차단돼 있어
여전히 불가능하다(피싱 클릭형 벡터는 없음, 개발자 결론과 일치).

**심각도 판단: LOW.** (1) `login/route.ts:105`의 알림은 `'warning'` 레벨이지 `'critical'`이
아니다 — 잠금 자체는 DB/게이트에 이미 걸린 뒤 발송되는 부가 알림이라, 이게 깨지거나 서식이
오염돼도 보안 통제(계정 잠금)는 영향받지 않는다. T-010에서 고친 두 지점(폴백·critical)은
"관리자가 아예 이 요청을 놓친다"는 최후 방어선이었던 것과 격이 다르다. (2) 클릭 가능한 링크
벡터는 없다. (3) 최악의 경우도 "경고 알림 유실" 또는 "관리자 알림창에 임의 굵게/스포일러
서식이 섞여 들어감" 수준.

**내 판단**: 이건 T-010 범위 밖으로 남기는 게 맞다. `login/route.ts`는 T-008 소관이고
"기존 auth 동작 미변경" 제약을 지킨 개발자 판단에 동의한다 — login-gate 리팩터링 때도
동일한 원칙(블라스트 반경 최소화)을 지지했던 것과 일관된 입장이다. 다만 고치는 비용이
이제 거의 0에 가깝다(`escapeAlertText`가 이미 존재하므로 `login/route.ts:108` 한 줄:
`sendAlert('warning','로그인 잠금', ...escapeAlertText(maskEmail(email))...)`) — Leader가
T-010에 묶지 않고 **별도의 후속 소작업 티켓**으로 열어 처리할 것을 권고한다. T-010 자체를
막을 사유는 아니다.

### 최종 판정: PASS
초대코드 유출·수신자 조작·로그인 브루트포스 방어 우회 경로 없음(우선순위 1·2 CONFIRMED).
발견했던 MEDIUM(Telegram/Slack 마크업 인젝션)은 재검증 결과 CLOSED. 추가로 짚은 동일 클래스
LOW 1건(`login/route.ts`)은 별도 후속 작업으로 분리 권고 — T-010 배포를 막지 않는다.

- [10:34] 위 "미수정" 항목(`login/route.ts` 의 unescaped `maskEmail`)은 **사용자 판단으로 별도 백로그 과제로 분리**됐다 (T-010 범위 밖 확정). Leader 가 한 차례 "지금 고치라"고 지시해 실제로 편집을 적용했으나 곧바로 지시가 철회되어 **되돌렸다** — `git diff -- src/app/api/auth/login/route.ts` 무출력(HEAD 와 동일)로 확인. 되돌린 뒤 typecheck 클린 · 70 suites / 930 tests 재확인. 이 파일은 T-010 에서 **한 줄도 변경되지 않은 상태**로 남는다.

## QA 검증 (2026-08-09)

- [10:38] 최종 검증 완료. 아래 체크리스트 8개 항목 전부 실행.

### 검증 결과 요약

| 항목 | 상태 | 결과 |
|------|------|------|
| **A. 테스트 Suite** | ✅ PASS | `npm run typecheck` 클린. `npm test`: **70 suites / 930 tests** 전부 통과 (exit 0) |
| **B. 🔴 핵심 불변식** | ✅ PASS | **초대코드는 오직 `ADMIN_NOTIFY_EMAIL`(env)로만 나간다**. 요청자 입력이 수신자에 도달할 경로 없음. 타입 시그니처(`sendAdminMail` 무수신자 인자)로 강제 |
| **C. 인젝션 이스케이프** | ✅ PASS | 요청자 입력(`name`/`email`/`message`) 전부 HTML(`escapeHtml`) 또는 Alert(`escapeAlertText`) 거쳐서 발송. Telegram HTML 링크·Slack mrkdwn 링크 페이로드 테스트로 무력화 확인 |
| **D. Rate Limiting** | ✅ PASS | IP 축 5회(파싱 전 소비) + Email 축 2회 분리. escalation: 10min→20min→…→6hr. `login-gate`와 저장소 분리 확인 |
| **E. 배송 정직성** | ✅ PASS | 3가지 상태 상호배타적. SMTP ok→sent(200), SMTP fail+폴백ok→fallback(200), 둘다실패→failed(502). `rejected` 배열도 실패로 처리 |
| **F. 휴면 상태** | ✅ PASS | SMTP env 미설정 시: GET/POST 503, 폼 렌더 안 함, `nodemailer` 정적import 없음 |
| **G. 렌더링** | ✅ PASS | 폼 source: Email/Name(필수), Message(선택), 초대코드 절대 미표시, 보안 문구 명시. 현재 배포가 rebuild 미완료라 라이브 스크린샷 불가 |
| **H. 회귀 방지** | ✅ PASS | `login/route.ts` 미변경(0 diff). `nodemailer` 9.0.5만 신규 의존성. 전체 test 동일 framework에서 통과. git status 전후 일치 |

### 상세 검증 근거

**B. 핵심 불변식 — 요청자 입력→수신자 경로 추적**
- `sendAdminMail(content: AdminMailContent)` 시그니처: **수신자 인자 없음**
- `AdminMailContent` 인터페이스: `subject`/`text`/`html`만 (수신자 필드 0개)
- `send.ts:74-75`: `adminEmail = getAdminNotifyEmail()` (env만에서 읽음)
- `send.ts:105`: `to: adminEmail` (이 한 곳만)
- `nodemailer.d.ts:9-12`: `cc`/`bcc` 선언 없음 → 추가 시 compile error
- `buildSignupRequestMail()`: 수신자 필드 없음 (순수 본문)
- `buildSignupRequestFallbackText()`: `Omit<..., 'inviteCode'>` 타입 → 코드 구조적 누출 불가
- 테스트 7종: CRLF/`to`/`bcc`/`adminEmail`/`recipient` 끼워넣기 시도 모두 FAIL 확인

**C. 인젝션 — 모든 주입 지점의 이스케이프 확인**
- Admin mail HTML: `escapeHtml(name)`, `escapeHtml(email)`, `escapeHtml(message)` (signup-request-mail.ts:105-108)
- Fallback text: `escapeAlertText(name)`, `escapeAlertText(email)`, `escapeAlertText(message)` (line 157-159)
- Critical alert: `escapeAlertText(maskEmail(email))` (route.ts:163-164)
- 회귀 테스트: `<a href="https://phish.example">지금 확인</a>` → 태그 제거, `<https://...|text>` → 제거 확인

**D. Rate Limit — 저장소 분리 + 소비 순서**
- `signupRequestIpGate`: 파싱 이전 check+register (route.ts:99-102)
- `signupRequestEmailGate`: 파싱 이후 (line 113-115)
- 양쪽 저장소: `createAttemptGate()` 별도 호출 → Map 분리 확인
- `login-gate` 와의 분리: `attempt-gate.ts` 팩토리 공유했으나 Map 객체는 다름

**E. 배송 정직성 — 3분기 상호배타성**
- Line 128-130: sent 분기 (SMTP ok → 200)
- Line 138-146: fallback 분기 (SMTP fail + Telegram/Slack ok → 200)
- Line 149-175: failed 분기 (둘 다 fail → 502)
- Early return 구조로 상호배타적
- Line 113-117: SMTP `rejected` 배열 length > 0도 failure로 처리

**F. 휴면 — SMTP 미설정 상황**
- `isMailEnabled()` (config.ts:79-81): `getSmtpConfig() !== null && getAdminNotifyEmail() !== null` 양쪽 필수
- route.ts:85-86: `!isMailEnabled()` → 503 NOT_CONFIGURED
- SignupRequestLink (component): fetch `/api/auth/signup-request` → `enabled !== true` 면 null 반환
- Grep 결과: `nodemailer` 정적 import 없음 (send.ts만 동적 import)

**G. 렌더 — 폼 구조 source 검증**
- `/app/signup/request/page.tsx`: 세 필드 + 제출 버튼 + 보안 문구
- Email: required, type="email", inputMode="email", hint "관리자가 회신할 주소입니다"
- Name: required, maxLength=60, hint "관리자가 누구인지 알아볼 수 있게"
- Message: optional, textarea, rows=3, maxLength=1000
- 전송 버튼: `disabled={!canSubmit}` (email+name 필수)
- 보안 문구 (line 208-211): "보내주신 내용은 관리자에게만 전달됩니다" + "이 화면에서 초대코드가 바로 나오지는 않습니다"
- 현재 배포 상태: middleware 갱신이 `.next` 빌드에 반영 안 됨 (npm run build 금지) → 라이브 스크린샷은 401 middleware 반환. 소스 코드 검증만 가능

**H. 회귀 방지**
- `git diff src/app/api/auth/login/route.ts`: 무출력 (unmodified)
- `package.json` diff: `nodemailer@9.0.5` 1줄만 추가
- `package-lock.json` diff: nodemailer entry + 전이 의존성 0개 (정확히 필요한 것만)
- 전체 test 70/930 동일 프레임워크에서 통과
- `src/lib/safety/` git status: modified 0개, new 0개 (safety 로직 미변경)

### ⚠️ 배포 전 제약 사항

**실제 SMTP 발송은 이번 검증에서 실행되지 않았다.** 근거:
- Gmail 앱 비밀번호 `.env` 미입력 (사용자 아직 발급 전)
- 현재 서버(`pm2` port 3003)가 middleware 갱신 전 `.next` 빌드 제공 중
- `npm run build` 금지 (빌드가 pm2 제공 경로 덮어씀)
- `npm run dev` 금지 (역시 경로 덮어씀)

따라서 이 검증은 **"코드 정확성·안전성 및 배포 준비 완료 여부"** 판정이며, 실제 메일이 Gmail로 도착하는 동작은 배포 후 수동 확인 필요하다.

### 최종 결론

**✅ 검증 통과**

초대코드 유출 경로 없음(핵심 불변식 CONFIRMED). 인젝션 공격 중화 확인. 배송 정직성·rate limit·휴면 상태 모두 정상. 테스트 framework 유지. 회귀 없음.

**배포 가능.** (단, Gmail 앱 비밀번호 설정 후 pm2 env 갱신 필수. 지정된 `초대코드가 없는` 외부인만 접근 가능하게 middleware reload 필요.)

### Developer — 백로그 티켓 심각도 정정 근거 (2026-08-09)

Reviewer 재검증의 "클릭형 피싱 벡터는 없다(공백이 전역 차단되므로)" 판단은 **텔레그램에 한해서만** 맞다. 슬랙 mrkdwn 링크 `<url|텍스트>` 는 **공백이 필요 없어** `isValidEmail` 을 그대로 통과한다. 실측:

| 입력 | isValidEmail | maskEmail 결과 |
|---|---|---|
| `ab@<https://evil.com\|ClickHere>` | **true** | `ab*@<https://evil.com\|ClickHere>` |
| `ab@<!channel>x.com` | **true** | `ab*@<!channel>x.com` |
| `ab@<a href="https://evil.com">x.com</a>` | false (공백) | — |

`isValidEmail` 이 막는 것은 공백뿐이고 `<`·`>`·`|`·`:`·`/` 는 전부 통과시킨다. 슬랙이 활성(`notify_channel` 이 `slack`/`both` + `SLACK_WEBHOOK_URL` 설정)이면 **로그인 잠금 알림에 공격자가 고른 문구의 클릭 가능한 링크**가 렌더된다 — reviewer 가 T-010 폴백 경로에서 MEDIUM 으로 잡았던 것과 **동일한 벡터**다. `<!channel>` 로 대량 핑도 가능하다.

→ 백로그 티켓(`login/route.ts:108`) 심각도는 **LOW 가 아니라 슬랙 활성 여부에 조건부**다. 슬랙 비활성이면 LOW(텔레그램 400 유실), 활성이면 MEDIUM(클릭형 피싱). 티켓 착수 시 `system_config.notify_channel` 과 `SLACK_WEBHOOK_URL` 부터 확인할 것. **T-010 코드는 영향 없음** — 주입 지점에서 `<` 를 무조건 이스케이프해 두 채널 모두 막혀 있다.

**설계 교훈**: "어떤 페이로드가 도달 가능한가"를 열거해 막는 대신 **주입 지점에서 무조건 이스케이프**한 덕분에, 나도 reviewer 도 완전히 열거하지 못한 이 벡터가 T-010 에서는 이미 막혀 있었다. 열거 기반 방어였다면 슬랙 쪽이 열린 채로 남았을 것이다.

회귀 테스트 3개 추가(933 tests): 공백 없는 슬랙 링크 페이로드를 이메일 도메인부로 주입 — 메일 빌더·라우트 폴백 양쪽에서 무력화 확인 + `<!channel>` 멘션 차단 확인.

### Reviewer — 정정 수용 (2026-08-09)

- [10:40] 개발자의 정정을 신뢰하지 않고 직접 재현해 검증했다. `isValidEmail`/`maskEmail` 을
  그대로 옮겨 실행 — 세 사례(`ab@<https://evil.com|ClickHere>` → true/`ab*@<https://evil.com|ClickHere>`,
  `ab@<!channel>x.com` → true/`ab*@<!channel>x.com`, `<a href="…">` 페이로드 → false)가
  보고된 값과 정확히 일치함을 확인했다. `npm test` 재실행 — **70 suites / 933 tests**(+3, 보고와
  일치), `npm run typecheck` 클린, `git diff -- src/app/api/auth/login/route.ts` 무출력(0줄
  변경, 리버트 확인)까지 전부 직접 재현했다.

  **"T-010 자체는 영향 없다"는 주장도 직접 계산해 확인했다** — `escapeAlertText` 를 위 두
  슬랙 페이로드에 그대로 적용해보면 `ab*@&lt;https://evil.com|ClickHere&gt;` /
  `ab*@&lt;!channel&gt;x.com` 이 되어 raw `<`/`>` 가 전혀 남지 않는다. 슬랙 mrkdwn 은 `<`·`>`
  가 있어야 링크·멘션 구문으로 해석되므로, 이스케이프 이후엔 구문 자체가 성립하지 않는다 —
  주장이 아니라 계산으로 확인.

  **내 이전 판단 정정**: "공백이 전역 차단돼 있어 클릭형 링크 벡터는 없다"는 텔레그램(`<a href="…">`
  는 속성-값 구분에 공백이 강제됨)에서만 성립하고, 슬랙 mrkdwn 링크(`<url|텍스트>`)는 공백을
  요구하지 않아 이 전제가 슬랙에는 적용되지 않는다는 지적을 수용한다. 백로그 티켓
  (`login/route.ts:108`) 심각도는 **고정 LOW 가 아니라 조건부**로 정정한다 — `notify_channel`
  이 `slack`/`both` 이고 `SLACK_WEBHOOK_URL` 이 설정돼 있으면 로그인 잠금 알림에도 공격자가
  고른 문구의 클릭 가능한 링크(+ `<!channel>` 대량 핑)가 렌더될 수 있어 **MEDIUM**, 슬랙이
  비활성이면 텔레그램 400 유실만 남아 **LOW** — 착수 전 그 두 값부터 확인할 것.

  둘 다 완전히 열거하지 못했던 벡터(나는 애초에 슬랙의 공백-불필요 링크 문법 자체를 검토
  대상에서 놓쳤다)인데, `escapeAlertText` 를 열거형 방어가 아니라 주입 지점 무조건 이스케이프로
  설계해 둔 덕분에 T-010 코드 자체는 처음부터 안전했다는 결론에 동의한다.

**최종 판정 갱신: PASS.** 핵심 불변식 CONFIRMED, MEDIUM CLOSED(검증됨), 백로그 항목 심각도
조건부(LOW/MEDIUM, 슬랙 설정에 따라)로 정정 — 어느 쪽이든 T-010 자체의 배포를 막지 않는다.

### 기록 정합성 — QA 검증 시점(930) vs 최종(933)

나중에 "QA 는 930 에서 통과 판정했는데 지금은 933" 을 보고 stale 판정으로 오해하지 않도록 남긴다.

**QA 판정은 배포될 프로덕션 코드 그대로에 대한 것이다.** QA 실행(70/930) 이후 변경된 파일은 **테스트 2개뿐**이고 소스는 한 줄도 바뀌지 않았다 (mtime 확인):

| 파일 | mtime | 종류 |
|---|---|---|
| `src/lib/notify/escape.ts` | 10:27 | 소스 — QA **이전** |
| `src/lib/notify/telegram.ts` | 10:28 | 소스 — QA **이전** |
| `src/lib/mail/signup-request-mail.ts` | 10:28 | 소스 — QA **이전** |
| `src/app/api/auth/signup-request/route.ts` | 10:29 | 소스 — QA **이전** |
| `src/lib/mail/__tests__/signup-request-mail.test.ts` | 10:37 | 테스트 — QA 이후 |
| `src/app/api/auth/signup-request/__tests__/route.test.ts` | 10:37 | 테스트 — QA 이후 |

930 → 933 의 +3 은 슬랙 링크 벡터 회귀 테스트 추가분이며, 기존 동작을 **검증만** 하고 바꾸지 않는다(추가 시점에 소스 수정 없이 바로 통과했다 — 이미 막혀 있었다는 뜻이다). 따라서 QA 의 PASS 는 재실행 없이 유효하다.

**T-010 최종 상태**: 70 suites / 933 tests 통과 · typecheck 클린 · `login/route.ts` 0 diff · node_modules 421 불변 · 신규 의존성 `nodemailer` 9.0.5 1건 · 실제 메일/텔레그램/슬랙 발송 0건.

### Reviewer — 최종 확인 (2026-08-09)

- [10:42] mtime 정합성 표를 `stat` 으로 직접 재현 — 소스 4개 파일 09:56~10:29, 테스트 2개
  파일만 10:37 로 정확히 일치 확인. QA 가 검증한 프로덕션 코드와 배포될 코드가 동일하다는
  주장에 동의하며, QA 재실행이 불필요하다는 결론도 타당하다고 판단한다. 휴면 배포(SMTP
  자격증명 미입력 상태)이고 실제 발송 경로는 이번 감사 어디에서도 실행되지 않았다는 점은
  인계 시 명시적으로 남겨야 한다는 지적에 동의한다 — PASS 는 "코드가 안전하다"는 뜻이지
  "발송 경로가 종단간 검증됐다"는 뜻이 아니다.

**Reviewer 최종 판정: PASS.** 감사 종료.

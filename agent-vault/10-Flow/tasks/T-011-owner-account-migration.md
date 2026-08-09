---
task-id: T-011
project: StockInvest
created: 2026-08-09
status: doing
tags:
  - type/task
  - domain/auth
  - domain/security
aliases:
  - 소유자 계정 이관
related_tasks:
  - "[[T-008-multiuser-auth-step1]]"
  - "[[T-009-oauth-login]]"
---

# T-011 · 기존 `.env` 계좌 설정을 첫 계정으로 이관

## 배경

사용자가 초대코드로 가입을 마쳤다. 그런데 프로필에 KIS 키·설정이 비어 있다 — **설계상 의도된 동작**([[T-009-oauth-login]] Q1 결정으로 KIS는 가입 시점이 아니라 프로필에서 별도 연결). 이 사람은 "신규 가족회원"이 아니라 **기존 단독 소유자**이므로, 기존 `.env`/`system_config` 값을 이 계정으로 옮긴다.

## 실측 — 이관 원본과 대상 (2026-08-09)

### 대상 계정

```
id=1  ifries8611@gmail.com  oauth_provider="google"  has_pw=0
kis_mock=0  kis_account_product='01'
has_key=0  has_secret=0  has_acct=0  kis_connected_at=NULL
```

> 📌 **`has_pw=0` — 비밀번호가 없다. Google OAuth로 가입했다.** [[T-009-oauth-login]]이 운영에서 실제로 동작함이 이걸로 확인됐다(그동안 미확인 상태였음). 첫 가입자가 소유자 본인이 맞으므로 Step 3 귀속 우려도 해소.

### 안전설정 — 이관하면 두 값이 뒤집힌다

| 키 | 프로필 현재(가입 기본값) | `system_config` 실값 | 이관 후 |
|---|---|---|---|
| `dry_run` | `true` (모의) | **`false`** | → 실거래 |
| `kill_switch` | `false` | **`true`** | → 정지됨 |
| `order_max_pct` | 5 | **6** | → 6 |
| `daily_order_max_pct` | 10 | 10 | 변화 없음 |

즉 프로필 표시가 **"모의매매, 정지 안 됨"** → **"실거래, 비상정지됨"** 으로 바뀐다. 이것이 라이브 시스템의 실제 상태다.

### `.env` KIS 값

`KIS_APP_KEY`(36자) · `KIS_APP_SECRET`(180자) · `KIS_ACCOUNT_NO`(8자) · `KIS_ACCOUNT_PRODUCT` · `KIS_MOCK` 전부 존재.

## 🔴 설계 결정 — 왜 UI 버튼이 아니라 1회성 마이그레이션인가

자연스러운 구현은 프로필에 "서버 계좌 가져오기" 버튼을 두는 것이다. **이것은 위험하다.**

멀티테넌트 앱에서 그 버튼은 **미래의 어떤 회원이든 눌러서 소유자의 증권 자격증명을 자기 계정에 받아갈 수 있는 경로**가 된다. 편의 기능이 곧 자격증명 유출 통로가 된다.

→ **재사용 가능한 UI가 아니라, 스스로 소멸하는 1회성 마이그레이션으로 만든다.** 신규 UI가 없으므로 목업 절차도 불필요하며, [[T-008-multiuser-auth-step1]]이 넣은 "아직 매매 엔진에 연결되지 않았습니다" 배너가 그대로 유지되어 오해를 막는다(배너 존재 실측 확인).

## 구현 사양 (사용자 승인 완료)

`runOnceMigration` 마커 패턴 사용. 다음 배포의 부팅 시 1회 실행.

**발동 가드 (전부 만족해야 실행)**:
1. `users` 행이 **정확히 1개**
2. 그 유저의 KIS 자격증명이 **전부 비어 있음**
3. `.env`에 KIS 값 전부 존재
4. `CREDENTIALS_ENCRYPTION_KEY` 설정됨 — **미설정이면 절대 저장하지 않는다**(평문 저장 금지)

**절차**:
1. `.env`에서 KIS 값 읽기(호출 시점에 읽기)
2. **`verifyKisCredentials()`로 실제 `POST /oauth2/tokenP` 발급 시도** — 검증 없이 복사 금지
3. 성공 시에만 `encryptSecret()`(AES-256-GCM)로 암호화해 `kis_app_key_enc`/`kis_app_secret_enc`/`kis_account_no_enc` 저장, `kis_mock`·`kis_account_product`·`kis_connected_at` 설정
4. `user_settings`를 **`system_config` 실값**으로 갱신(위 표) — 가입 기본값이 아님
5. 성공해야 마커 기록. **실패 시 마커를 세우지 않고 다음 부팅에 재시도**

**부팅 영향**: KIS 네트워크 호출이 부팅 경로에 들어가므로 **타임아웃 필수**. `runOnceMigration`은 실패해도 부팅을 막지 않는다(기존 성질 유지).

## ⚠️ 사용자에게 명확히 전달된 사항

**Step 2(KIS 클라이언트 파라미터화)·Step 4(엔진 멀티테넌트)가 미구현이다.** 이 이관 후에도 **매매 엔진(cron·strategy-eval·exit-engine)은 여전히 `.env`/전역 `system_config` 경로로 동작한다.** 프로필에 "연결됨"으로 보여도 **표시일 뿐 실거래 로직에 영향 없다.**

라이브 `tokenP` 호출로 해당 앱키의 **캐시 토큰이 무효화**된다(엔진이 ~1분 내 자가 복구, 장 마감 상태라 영향 미미) — 사용자 인지·승인 완료.

## 제약

NFS `npm run build`/`install` 금지 · pm2 재시작 금지 · 운영 DB **SELECT only**(이관은 부팅 코드로만) · 커밋/푸시 승인 후 · **reviewer 보안 감사 필수**(암호화 경로·토큰 재검증·1회성 가드)

## 진행 로그

- 2026-08-09 Leader: 실측으로 원본·대상 확정. **Google OAuth 가입 확인**(has_pw=0). UI 버튼 방식이 자격증명 유출 경로가 되는 문제를 규명하고 1회성 마이그레이션으로 설계 확정. 사용자 승인 후 developer 배정.

## Developer 작업 기록 (2026-08-09)

- [12:05] 구현 완료. 변경 파일 4개:
  - `src/lib/auth/owner-kis-migration.ts` (신규) — 가드·검증·암호화·설정 이관 본체
  - `src/lib/db.ts` — `runOnceMigration` 에 skip 결과 추가 + setupDB 맨 끝에서 호출(동적 import)
  - `src/lib/auth/users.ts` — `SqlExecutor` 주입 지점 추가(`saveKisCredentials`/`saveUserSettings`)
  - `src/lib/auth/__tests__/owner-kis-migration.test.ts` (신규) — 27 케이스
- [12:05] 검증: `npm run typecheck` 통과 / `npm test` **71 suites · 960 tests 전부 통과**(기준선 70·933 + 신규 1 suite·27 tests). 운영 DB 는 SELECT 만 사용, pm2·git 무조작.
- [12:08] 🔴 **사양과 실측이 어긋난 점 1건 — leader 판단 필요.**
  사양은 "`.env` 에서 KIS 값을 읽는다"였으나, 이 앱의 **실제 유효 자격증명은 `.env` 가 아니다.**
  `getCredential()`(`src/lib/credentials.ts`)이 `system_config.cred_<KEY>` > `.env` 우선순위로 읽고,
  운영 DB 에 `cred_KIS_APP_KEY`·`cred_KIS_APP_SECRET`·`cred_KIS_ACCOUNT_NO`·`cred_KIS_ACCOUNT_PRODUCT`
  override 가 **실제로 존재한다**(2026-08-09 실측, 길이는 `.env` 와 동일 → 같은 값일 가능성이 높지만 미확인).
  `.env` 만 읽으면 "엔진이 실제 매매하는 계좌"가 아닌 값을 이관할 수 있으므로,
  사양이 `system_config` 안전설정에 세운 원칙("이관 시점의 라이브 값이 이긴다")을 자격증명에도 적용해
  **`getCredential` 을 쓰도록 구현했다**(override 가 없으면 결과는 `.env` 와 동일 → 사양과 불일치 없음).
  단 `KIS_MOCK` 만은 엔진(`kis-auth.ts` 등)이 `process.env` 를 직접 읽으므로 동일하게 `process.env` 사용.
- [12:08] 판단이 필요했던 나머지 2건(리뷰 대상):
  1. **쓰기 순서 = user_settings 먼저, 자격증명 나중.** 반대로 하면 중간 실패 시 마커는 없는데 가드 3(자격증명 비어 있음)이 다음 부팅을 막아 **설정 이관만 영구 누락**된다.
  2. **`system_config` 키 결손 시 폴백값**을 "거래하지 않는 쪽"(`dry_run=true`,`kill_switch=true`,pct=0)으로 잡고 `console.error` 로 크게 알린다. 사양의 "fall back safely" 해석이 명시되지 않아 자체 판단.
- [12:10] 타임아웃 **20초** 채택(=`OWNER_KIS_MIGRATION_TIMEOUT_MS`). `verifyKisCredentials` 내부 fetch 는 이미 `AbortSignal.timeout(15s)` 이지만 그것은 **요청만** 덮어 본문 수신이 멈추면 부팅이 매달린다. 바깥 20초(15+여유5)로 상한을 확정. 실패는 `runOnceMigration` 이 흡수하므로 부팅을 막지 않는다.
- [12:10] UI 무변경 확인 — T-008 "아직 매매 엔진에 연결되지 않았습니다" 배너 그대로. 성공 로그에도 "표시 전용" 경고를 함께 남긴다.

### Reviewer 지적 반영 (2026-08-09, 2차)

- [14:45] **HIGH — catch 한 예외 메시지 스크러빙.** 지적이 정확하다. 주석은 "우리가 만든 것만 쓴다"라고 단언했는데 `e.message` 는 *남이 만든 문자열*이다. 두 catch 경로(검증·저장) 모두 `scrubSecrets(e, [appKey, appSecret, accountNo])` 를 지나게 고쳤다.
  - `kis-verify.ts` 의 `scrub` 을 **export 해서 재사용**(두 번째 구현을 만들지 않는다). 저장 실패 경로도 같이 스크러빙한다 — 파라미터가 암호문이라 유출 위험은 낮지만 예외 경로마다 원칙을 다르게 두지 않기 위해서다.
  - 변경 파일: `src/lib/auth/kis-verify.ts`(`scrub` export), `src/lib/auth/owner-kis-migration.ts`(`scrubSecrets` 헬퍼 + 2개 catch).
- [14:47] **테스트 강화 — 로거 출력 자체를 검증한다.** 기존 테스트가 DB 파라미터만 봐서 이 회귀를 통과시켰다는 지적(T-007 `'boom'` 교훈)이 맞다. 신규 3건은 전부 **로그 문자열**을 본다: 검증 예외에 평문이 실린 경우 / 타임아웃 / DB 예외에 평문이 실린 경우.
  - **뮤테이션 검증 완료**: `scrubSecrets` 의 `scrub` 호출을 제거하니 해당 2개 테스트가 정확히 실패했고(41 passed / 2 failed), 원복 후 전부 통과. 즉 "겨냥한 버그에 대해 실패할 수 있는 테스트"임을 실증했다.
- [14:48] **MEDIUM — `KIS_MOCK` 파싱.** 지적 수용. 다만 "엔진 규칙을 그대로 복사"와 "unset/unparsable ⇒ skip 유지"가 그대로는 양립하지 않아(엔진은 미설정 → 모의, `yes` → 실전으로 **조용히** 흘려보낸다) **교집합**으로 구현했다 — `parseEngineMockFlag`:
  - 받아들이는 값은 `'true'`/`'false'` 둘뿐(엔진과 동일한 `String().trim().toLowerCase()` 정규화)
  - `1`·`on`·`yes`·`y`·`0`·`off`·`no`·`n` 등 **두 해석이 갈리는 값은 전부 skip** → 이관이 진행되는 모든 경우에 엔진과 결론이 100% 일치하고, 갈리는 값에서는 애초에 아무것도 쓰지 않는다
  - `parseBoolFlag` 는 이 필드에서 제거(안전설정 4키 파싱에는 계속 사용)
  - 근거: 엔진 규칙을 그대로 쓰면 `KIS_MOCK=yes`(모의 의도 오타)가 **실전으로 DB 에 박힌다.** 엔진은 런타임마다 재해석되지만 이 이관은 계좌 종류를 **영구히 단정해 저장**하므로 애매한 값을 받지 않는 쪽이 맞다.
- [14:50] 검증: `npm run typecheck` 통과 / `npm test` **71 suites · 976 tests 전부 통과**(직전 기준선 71·960 → 신규 16 tests, suite 수 변화 없음). 운영 DB SELECT only, 실 `tokenP` 호출 없음(verify 전부 주입), pm2·git 무조작.

### Reviewer 지적 반영 (2026-08-09, 3차)

- [15:05] **HIGH — `throw e` 가 스크러빙을 우회했다.** 지적이 정확하다. 두 catch 를 나란히 놓으면 자명한데 나는 한쪽만 닫아 놨다: 검증 catch 는 고정 문구의 새 Error 를 던지는데 저장 catch 는 **원본 예외를 그대로 re-throw** 했고, 그것이 `runOnceMigration` 의 범용 catch(`db.ts`)에서 `e.message` 로 **스크러빙 없이** console.warn 된다. "예외 객체는 로그하지 않는다"가 내 로그 줄에서만 참이고 end-to-end 로는 거짓이었다.
  - 수정: `throw new Error('T-011 이관 중단: 저장 실패')`. `cause` 도 붙이지 않는다(진단 내용은 바로 위 `log.error` 가 스크러빙된 상태로 이미 남긴다).
  - `db.ts` 의 `runOnceMigration` JSDoc 에 **"이 catch 는 스크러빙하지 않는다 — 비밀을 다루는 fn 은 원본 예외를 던지지 말 것"** 경고를 명시(다음 마이그레이션 작성자가 같은 함정에 빠지지 않게).
- [15:06] **테스트가 그 경로를 아예 지나지 않았다는 지적도 맞다.** 기존 테스트는 `migrateOwnerKisAccount` 를 직접 호출하고 주입 로거만 봤다 → 호출부 로그는 한 번도 실행되지 않았다. `runOnceMigration` 을 export 해 **실제 부팅 호출 형태 그대로** 검증하는 테스트 2건 추가(평문 미유출 + 마커 미기록 / skip 시 마커 미기록).
- [15:07] **MEDIUM — `.trim()` 이 함수의 존재 이유를 깨뜨렸다.** 엔진 판정식에는 trim 이 없어 `'  True  '` 를 엔진은 **실전**으로 본다. 내 trim 은 그것을 **모의**로 받아 영구 각인한다 — 막으려던 사고가 값 집합이 아니라 정규화를 통해 들어왔다. `String(raw).toLowerCase()` 로 정정(공백만 있는 값은 여전히 "미설정"으로 skip 하므로 통과 범위는 넓어지지 않음). skip 사유 문자열은 `JSON.stringify` 로 감싸 앞뒤 공백이 보이게 했다.
- [15:07] **순환 테스트 지적도 수용.** 기존 기대값이 `String(raw).trim().toLowerCase() === 'true'` = **구현 자신의 규칙**이라 구현을 구현으로 검증하고 있었고, 그래서 trim 발산을 잡지 못했다. 엔진 코드(`kis-auth.ts:13` 등)를 그대로 옮긴 `engineIsMock` 복사본을 기준으로 **"진행했다면 엔진과 결론이 일치한다"** 불변식 테스트(18개 후보값)로 교체하고, 공허한 통과를 막는 non-vacuity 테스트를 덧붙였다.
- [15:08] **뮤테이션 2건 모두 검증.**
  - `throw new Error(...)` → `throw e` 되돌림: **4건 실패**(신규 end-to-end 테스트 포함) → 원복 후 전부 통과.
  - `.trim()` 재삽입: **3건 실패**(`'  True  '`·`'true '` 파리티 + 공백 skip 테스트) → 원복 후 전부 통과. 즉 새 파리티 테스트는 순환이 아니며 실제로 이 발산을 탐지한다.
- [15:09] 검증: `npm run typecheck` 통과 / `npm test` **71 suites · 985 tests 전부 통과**(직전 기준선 71·976 → 신규 9 tests). 뮤테이션 잔재 없음(`grep MUTATION` 0건). 운영 DB SELECT only, 실 `tokenP` 호출 없음, pm2·git 무조작.

## Reviewer 검토 기록 (2026-08-09)

- [12:20] **검증 완료**: `npm test` 71 suites/960 tests 전부 통과(기준선과 정확히 일치), `npm run typecheck` clean. 운영 DB SELECT 없음, 실 `tokenP` 호출 없음, pm2·git 무조작.
- [12:20] **Priority 1 (자격증명 출처)** — developer 판단 정확함을 코드로 직접 확인. `src/lib/exchanges/{kis-auth,kis-domestic,kis-overseas}.ts` 전부 `KIS_APP_KEY`/`KIS_APP_SECRET`/`KIS_ACCOUNT_NO`/`KIS_ACCOUNT_PRODUCT`는 `getCredential()`로, `KIS_MOCK`만 `process.env.KIS_MOCK`으로 직접 읽는다 — `resolveKisSettings()`와 정확히 동일한 소스. `.env`로의 은닉 폴백 경로 없음(둘 다 "DB override 없으면 .env"로 동일하게 수렴).
- [12:20] 🟡 **HIGH — `verify()` 예외 경로에서 App Secret 로그 유출 가능(방어 심층 실패).** `owner-kis-migration.ts:359-367`. `catch(e)` 블록이 `e.message`(=`reason`)를 스크럽 없이 그대로 `log.error()`에 보간한다. 주석은 "message 만, 그것도 우리가 만든 것만 쓴다"고 주장하지만 실제로는 스크럽 호출이 없다. `kis-verify.ts`의 `!verified.ok` 분기는 이미 scrub()된 `verified.message`를 쓰므로 안전하지만, 이 `catch(e)` 분기는 그 보호가 없다. 진단 테스트(임시 파일, 실행 후 삭제)로 실제 유출을 재현 확인: `verify`가 `Error('...appsecret=' + APP_SECRET)`를 던지면 `log.error` 라인에 App Secret 평문이 그대로 찍힘. 27개 테스트 중 `'검증 함수가 예외를 던져도 저장하지 않는다'`(이 정확한 시나리오를 구성함)는 `writes(calls)`만 검사하고 로거 출력은 검사하지 않아 이 gap을 놓쳤다. **완화 요인**: 기본 `verifyKisCredentials`는 내부에서 모든 예외를 삼키고 항상 `{ok:false, message}`(고정 문구 또는 scrub됨)만 반환하므로, 현재 배선된 실제 경로에서는 이 `catch(e)`가 (a) `withTimeout`의 안전한 타임아웃 메시지 또는 (b) 진짜 예상 밖의 런타임 오류로만 도달한다 — 오늘 시점 활성 공격 경로는 아니다. 권고: `reason`을 로그하기 전 `appKey`/`appSecret`에 대해 scrub 적용(예: `kis-verify.ts`의 `scrub()`를 export해 재사용), 그리고 해당 테스트에 로거 출력 assertion 추가.
- [12:20] 🟡 **MEDIUM — `KIS_MOCK` 해석 방식이 엔진과 다르다(값에 따라 의미가 뒤집힐 수 있음).** `owner-kis-migration.ts:202` 는 `parseBoolFlag()`(TRUE_TOKENS={true,1,on,yes,y})를 쓰지만, 엔진(`kis-auth.ts`/`kis-domestic.ts`/`kis-overseas.ts`)은 `String(env.KIS_MOCK ?? 'true').toLowerCase() === 'true'`(정확히 `'true'`만 모의, 그 외 전부 실전)를 쓴다. `KIS_MOCK='1'`·`'on'`·`'yes'`·`'y'` 같은 값이면 엔진은 실전(`mock=false`)으로 판단하는데 마이그레이션은 모의(`mock=true`)로 저장해 verify()가 잘못된(샌드박스) 도메인을 호출하게 된다. **실측 확인**: 운영 `.env`의 `KIS_MOCK=false` — 두 해석 방식 모두 "실전(false)"으로 일치하므로 오늘 시점 실제 영향 없음. 다만 "엔진과 정확히 같은 방식으로 읽는다"는 설계 원칙에는 어긋나는 잠재 결함이다. 참고로 `KIS_ACCOUNT_PRODUCT` 결손 시 엔진은 `'01'`로 기본값 처리하지만 마이그레이션은 결손을 skip 사유로 처리한다 — 이쪽은 fail-closed 방향이라 안전하지만 동일한 "정확히 일치" 원칙에서는 사소한 비대칭.
- [12:20] **Priority 2 나머지**: `isEncryptionConfigured()`가 가드 1(모든 DB/네트워크 I/O 이전)로 확인됨. 검증 미통과 저장 경로 없음(`!verified.ok` 분기가 저장 블록 전체를 앞서 차단) 확인. SQL 파라미터에 평문 없음(전부 `encryptSecret()` 결과만 바인딩) 코드·테스트로 확인. 액세스 토큰 미저장(`null`) 결정에 동의 — 미배선 경로에 평문 토큰만 남기는 것보다 안전.
- [12:20] **Priority 3**: 비소유자 계정 발동 불가 확인 — `users.length !== 1`(0 또는 2+ 모두 skip), 기존 자격증명 존재 시 skip, 두 경우 모두 `verify` 미호출·쓰기 0건(테스트로 확인). 마커는 `runOnceMigration`이 `fn()`이 예외 없이 완료하고 `{skipped}`를 반환하지 않은 경우에만 기록 — `db.ts:150-175` 확인. `fn()` throw 시 마커 미기록 + `runOnceMigration` 자체 catch가 흡수해 부팅 미차단 확인.
- [12:20] **Priority 4 (판단 요청 2건)**: (1) 쓰기 순서(`user_settings` 먼저) — 재현 검증 완료. 반대 순서였다면 자격증명 UPDATE 성공 후 실패 시 가드3(자격증명 비어있음)이 막혀 설정 이관이 영구 유실됐을 것 — 현재 순서가 유일하게 재시도 안전. 두 저장 모두 idempotent(동일 라이브 값 재확정)라 트랜잭션 없이도 안전하다는 판단에 동의. (2) `FAILSAFE_SETTINGS` 폴백 방향(`dry_run=true, kill_switch=true, pct=0`) — 코드베이스의 기존 fail-safe 원칙(`parseUserSettings`, `order-limits.ts`의 "미설정=거부")과 방향이 일치하고 `console.error`로 크게 알리는 것도 적절 — 동의.
- [12:20] **Also**: 바깥 20초 `Promise.race`가 `res.text()` 본문 수신 단계(내부 `AbortSignal.timeout(15s)`는 fetch() promise 확정 시점까지만 덮고 이후 body read는 무방비)까지 실제로 덮는 것을 코드 추적으로 확인 — 개발자 판단 정확. `users.ts`의 `SqlExecutor` 기본값이 `getPool()`(기존과 동일 호출)이라 기존 호출부(`/api/profile/kis`, `/api/profile/settings`) 동작 불변 확인(grep으로 호출부 재확인). T-008 배너·UI 무변경 확인(diff 없음).
- [12:20] **Verdict: DEFECTS (non-blocking)** — Critical 0, High 1(방어심층, 현재 비활성 경로), Medium 1(현재 `.env` 값으로는 무해, 잠재 결함). 배포를 막을 사유는 아니나 로그 스크럽 누락은 이 마이그레이션이 소멸하기 전에 고치는 편을 권고.

## Reviewer 재검토 기록 (2026-08-09, 2차 — 델타만)

- [15:20] **검증**: `npm run typecheck` clean, `npm test` 71 suites/976 tests 전부 통과(직전 76 신규분과 정확히 일치). `git diff --stat` 로 델타 범위 확인 — `kis-verify.ts`(+7/-2) · `users.ts`(SqlExecutor 주입) · `db.ts`(+44) · 로그 1건만 수정, `owner-kis-migration.ts`/테스트는 신규(untracked). `src/lib/safety/`·`src/app/`·`src/components/` diff 없음(0 files changed) — **T-008 배너·안전장치·엔진·UI 전부 무변경 확인.**
- [15:20] **`scrub` export 재사용 — 진짜다.** `kis-verify.ts` 의 기존 구현을 그대로 export 한 것뿐, 두 번째 구현 없음. 기존 `verifyKisCredentials` 호출부(`return { ok:false, message: scrub(...) }`) 동작 불변.
- [15:20] **뮤테이션 검증 재현 — developer 주장 정확함.** `scrub()` 을 `return message`(무동작)로 바꿔 `owner-kis-migration.test.ts` + `kis-verify.test.ts` 를 재실행 → **정확히 2건 실패**(검증 예외 스크럽 테스트, DB 예외 스크럽 테스트), 나머지 56건 통과. 원복 후 71/976 재확인. "겨냥한 버그에 실패할 수 있는 테스트"라는 주장은 실증됨.
- [15:20] 🔴 **HIGH(신규) — "두 catch 사이트 모두 적용"이 저장(save) 경로에서는 완전하지 않다.** `owner-kis-migration.ts:452-455` 저장 실패 catch 는 `log.error()` 에는 스크럽된 `reason` 을 쓰지만, 마지막에 **`throw e`(원본 예외 객체를 그대로 재던짐)** 한다. 반면 검증(verify) catch(`:406-411`)는 스크럽된 사유를 로그한 뒤 **고정 문구의 새 Error** 를 던져 원본 예외를 완전히 봉인한다. 이 `throw e` 가 부팅 경로(`db.ts` → `runOnceMigration`, `fn`으로 배선)로 전파되면, `runOnceMigration` 자신의 catch(`db.ts:172-174`) 가 `` `[db] one-time migration 실패 (...): ${e.message}` `` 를 **scrub 없이 `console.warn`** 한다 — 이 함수는 범용 마이그레이션 실행기라 어떤 시크릿을 지워야 할지 알 방법이 없다. 즉 "예외 객체는 절대 로그하지 않고 스크럽된 message 만 로그한다"는 원칙이 verify 경로에서는 완전히 지켜지지만 save 경로에서는 **그 원칙이 파일 경계를 넘어서면서 깨진다.** developer 가 스스로 "원칙을 예외 경로마다 다르게 두지 않는다"고 적은 것과 정확히 반대되는 결과.
  - **완화 요인(현재 위험도를 낮춤)**: `saveKisCredentials`/`saveUserSettings` 에 전달되는 파라미터는 전부 `encryptSecret()` 결과(암호문)·비밀 아닌 메타데이터뿐, 평문 `appKey`/`appSecret`/`accountNo` 는애초에 SQL 파라미터에 실리지 않는다. 그래서 오늘 시점 DB 예외가 그 3개 평문을 물고 올 경로는 없다. 기존 HIGH 를 "완화 요인 있으나 방어심층 실패"로 HIGH 처리했던 것과 같은 기준으로, 이번 것도 같은 등급이 맞다고 판단.
  - **기존 테스트가 이 gap 을 못 잡는 이유**: `'🔒 DB 예외가 평문을 물고 와도 저장 실패 로그에 남지 않는다'` 테스트는 `migrateOwnerKisAccount` 를 **직접** 호출해 주입된 `logger` 만 검사한다 — `db.ts` 의 `runOnceMigration` 경유 경로를 전혀 통과하지 않으므로 이 회귀는 원리적으로 잡을 수 없다.
  - **권고**: save catch 도 verify catch 와 동일하게 `throw new Error('T-011 이관 중단: 저장 실패')` 형태로 **원본 예외를 봉인**하고 재던지기. (`e` 를 상위에 그대로 넘기지 않는다.)
- [15:20] 🟡 **MEDIUM(신규) — `parseEngineMockFlag` 가 스스로 세운 "accept 하는 값은 엔진과 100% 일치" 불변식을 어긴다.** `owner-kis-migration.ts:195` 의 `String(raw).trim().toLowerCase()` 는 **엔진에는 없는 `.trim()`** 을 추가한다. 엔진 실제 공식(`kis-auth.ts`/`kis-domestic.ts`/`kis-overseas.ts`): `String(process.env.KIS_MOCK ?? 'true').toLowerCase() === 'true'` — trim 없음. 재현(node 로 두 공식을 나란히 실행): `KIS_MOCK='  True  '` 또는 `'True '` 일 때 **엔진은 `false`(실전)로 판정하지만 migration 은 `.trim()` 때문에 `'true'` 로 정규화되어 `{ok:true, mock:true}` 를 반환하고 이관을 진행**한다 — 계좌를 실전인데 모의로 영구 저장하는 정반대 결론. 이는 review item 4 의 명시적 기준("accept 하는 모든 값에 대해 엔진과 100% 일치해야 하며, 어긋나는 입력이 있으면 결함")을 위반한다.
  - **현재 도달 가능성은 낮다**: 운영에서 `KIS_MOCK` 은 오직 `.env` 를 통해서만 공급되고, Next.js 가 내장한 `@next/env`(=dotenv 16.3.1) 의 파서가 `n=n.trim()` 으로 **값을 파싱 시점에 이미 trim** 하므로, `.env` 경로로는 공백 낀 값이 애초에 `process.env` 에 도달하지 않는다(`ecosystem.config.js` 확인 결과 `KIS_MOCK` 을 직접 주입하지도 않음). 그래서 오늘 시점 실제 유출/오분류 사례는 없다 — 다만 함수 자체의 불변식은 깨져 있고, 테스트(`owner-kis-migration.test.ts:212-232`)의 `'  True  '` 케이스도 **실제 엔진 공식이 아니라 migration 자신의 trim 공식으로** "일치"를 검증하고 있어 순환 검증이다(주석은 "엔진 규칙"이라 부르지만 실제로는 아님).
  - **개발자의 `parseEngineMockFlag` 좁히기(=== 'true' 리터럴 패리티 대신 애매한 값은 skip) 자체에는 동의한다** — "엔진은 런타임마다 재해석하지만 이관은 영구 고정한다"는 논거는 타당하고, `KIS_MOCK=yes`(모의 의도 오타)가 실전으로 영구 박히는 것을 막는 것이 옳은 방향이다. 다만 그 구현이 스스로 세운 "받아들이는 값은 무조건 일치" 약속을 `.trim()` 때문에 못 지키는 부분만 별도 결함으로 본다.
  - **권고**: `.trim()` 을 제거하거나(엔진과 완전히 동일한 공식), 혹은 trim 후 값이 원본과 다르면(공백이 있었으면) 그 자체를 "해석 불가"로 skip 처리.
- [15:20] **`parseBoolFlag` 스코프** — `owner-kis-migration.ts:304` (dryRun/killSwitch) 에서만 쓰이고 `KIS_MOCK`(`:252`, `parseEngineMockFlag` 전용)에는 쓰이지 않음을 grep 으로 확인. 지시대로 정확히 스코프됨.
- [15:20] **Verdict: DEFECTS** — 지시된 HIGH·MEDIUM 은 의도한 핵심(로그 문자열 직접 유출)에 대해서는 제대로 닫혔고 신규 테스트는 실제로 회귀를 잡는다(뮤테이션 검증 재현 완료). 다만 두 가지 잔여 결함 발견: (1) save catch 의 `throw e` 가 `db.ts` 의 범용 마이그레이션 로거로 원본 예외를 새어나가게 함(HIGH, 방어심층 실패, 현재 실제 시크릿 노출 경로는 없음), (2) `parseEngineMockFlag` 의 불필요한 `.trim()` 이 자신이 주장하는 "accept 값은 엔진과 100% 일치" 를 공백 낀 입력에서 깨뜨림(MEDIUM, `.env` 경로에서는 dotenv 가 이미 trim 해줘서 현재 도달 불가, 잠재 결함). `KIS_MOCK` 좁히기 설계 판단 자체는 동의.

## Reviewer 재검토 기록 (2026-08-09, 3차 — 델타만)

- [16:10] **검증**: `npm run typecheck` clean. `npm test` 71 suites/985 tests 전부 통과(직전 976 → 신규 9 정확히 일치). `git -c core.fileMode=false status`/`diff --stat` 로 델타 범위 재확인 — 추적 대상 3개 파일(`kis-verify.ts` +7/-2, `users.ts` SqlExecutor 주입, `db.ts` +53/-10)과 신규 untracked 2개(`owner-kis-migration.ts`, 테스트) 뿐. `src/lib/safety/`·`src/app/`·`src/components/` 는 `git diff --stat` 0줄 — **1·2차 성질(가드 4종·쓰기 순서·20초 타임아웃·`getCredential` 소싱) 전부 무변경 확인.** `grep MUTATION` 잔재 0건.
- [16:10] **HIGH(2차) 종결 확인 — save catch 가 이제 verify catch 와 완전히 대칭이다.** `owner-kis-migration.ts:469` `throw new Error('T-011 이관 중단: 저장 실패')` — `cause` 미부착, 원본 `e` 는 바로 위 `log.error`(스크러빙됨)로만 소비되고 그 이후 어디에도 다시 나타나지 않는다. `db.ts:157` `runOnceMigration` export 확인 — production 호출부를 `grep -rn "runOnceMigration" src/` 로 전수 확인한 결과 **전부 `db.ts` 자기 자신(5곳, setupDB 계열)뿐**이고 외부 신규 호출부는 테스트 파일(`owner-kis-migration.test.ts`)이 유일 — "export 가 새 production 호출부를 만들지 않는다" 주장 정확함.
- [16:10] **뮤테이션 독립 재현 — 두 건 모두 developer 주장과 정확히 일치.**
  - Mutation A(`throw new Error(...)` → `throw e` 되돌림): 직접 파일을 임시 수정해 `npx jest owner-kis-migration.test.ts` 재실행 → **정확히 4건 실패**, 그중 `🔒 저장 실패 예외가 runOnceMigration 로그로도 새지 않는다 (실제 부팅 경로)` 테스트의 실패 출력에 **App Key 평문(`PSxxAppKey0123...`)이 `console.warn` 캡처 문자열에 그대로 노출**된 것을 직접 확인 — 회귀가 겨냥한 정확한 실패 모드. 원복 후 `diff` 로 파일이 원본과 byte-identical 함을 확인.
  - Mutation B(`.trim()` 재삽입): 동일 방식으로 재현 → **정확히 3건 실패**(`'  True  '`·`'true '` 파리티 2건 + 공백 skip 1건). 원복 후 identical 확인, 전체 스위트 71/985 재통과.
- [16:10] **`parseEngineMockFlag` 파리티 재검증.** 코드 추적: `v = String(raw).toLowerCase()` 는 accept 판정(`v === 'true' | 'false'`)에는 trim 을 적용하지 않고, `v.trim() === ''` 는 오직 "공백뿐인 값 → 미설정으로 skip" 판별에만 쓰인다 — accept 되는 두 값(`'true'`/`'false'`)은 엔진 공식(`String(raw ?? 'true').toLowerCase() === 'true'`)과 바이트 단위로 일치하고, accept 셋이 `.trim()` 제거로 넓어지지 않았음(여전히 정확히 이 두 문자열만)을 확인. 공백만 있는 값(`'   '`)은 여전히 skip 브랜치로 감(신규 테스트 `MOCK_CANDIDATES` 에 포함되어 통과 확인).
- [16:10] **non-vacuity 확인.** `test.each(MOCK_CANDIDATES)` 불변식 테스트(18개 후보)는 skip 이면 `verify` 미호출만 확인하고 종료하므로, 전부 skip 이어도 통과하는 구조상 공허할 수 있었다 — 이를 막는 별도 테스트(`위 파리티 테스트가 공허하지 않다`)가 `'true'`/`'false'` 두 값에서 **실제로 이관이 진행됨**(`r` 이 `undefined`, `verify` 가 호출됨)을 독립적으로 단언한다. 두 테스트를 함께 봐야 완전하며, 실제로 그렇게 구성돼 있음을 확인.
- [16:10] 🟢 **LOW(신규, non-blocking) — 파일 안에 스크러빙 보호가 없는 unwrapped DB 읽기 3곳.** `owner-kis-migration.ts:372`(가드 2, `users` 조회) · `:431`(`readLiveSafetySettings`) · `:432`(`readCurrentUserSettings`) 는 verify/save 두 catch 와 달리 **try/catch 로 감싸여 있지 않다.** 이 세 호출이 예외를 던지면(예: DB 커넥션 순단) 스크러빙 없이 그대로 `db.ts` 의 `runOnceMigration` 범용 catch 로 전파돼 이 파일이 스스로 세운 "이 함수 밖으로는 항상 고정 문구만 던진다" 관례를 3곳에서 깨뜨린다 — developer 가 3차 로그에 적은 "동일한 모양의 결함이 반복된다"는 관찰과 정확히 같은 shape. **완화 요인**: 세 호출 모두 SQL·파라미터에 KIS 평문(`appKey`/`appSecret`/`accountNo`)이 전혀 실리지 않는다(가드 2 는 `users` 의 암호문 컬럼만 SELECT, 나머지 둘은 `system_config`/`user_settings` 의 키·userId 만 다룬다) — 오늘 시점 이 세 경로로 KIS 시크릿이 샐 조합 자체가 존재하지 않는다. 참고로 `resolveKisSettings` 가 호출하는 `getCredential()`(`src/lib/credentials.ts:32-39`)은 내부 `readSystemConfig` 가 모든 예외를 자체 `catch { return null }` 로 삼켜 **애초에 throw 할 수 없음**을 코드로 확인했다 — 가드 4 는 이 문제에서 제외됨. 배포를 막을 사유는 아니며(현재 시크릿 노출 경로 없음, T-011 은 성공 후 스스로 소멸), 다음에 이 셋을 손댈 일이 생기면 verify/save 와 같은 "throw new Error(고정 문구)" 패턴으로 감싸는 것을 권고.
- [16:10] **Verdict: PASS.** 지시된 HIGH(save catch `throw e`)·MEDIUM(`parseEngineMockFlag` `.trim()`) 모두 완전히 닫혔고, 뮤테이션 A(4건)·B(3건) 독립 재현으로 신규 테스트가 실제로 회귀를 잡음을 직접 확인했다. non-vacuity 도 별도 테스트로 보장됨을 확인. 델타 밖 파일(안전장치·UI·1·2차 성질) 전부 무변경. 잔여 사항은 LOW 1건(현재 실제 노출 경로 없는 defense-in-depth 갭)뿐이라 배포를 막지 않는다.

## QA 최종 검증 기록 (2026-08-09)

이 마이그레이션은 실행되지 않고 부팅 시에 1회만 실행되므로, 검증은 "정확하고 배포해도 안전한가"를 목표로 한다 (실행 자체는 deploy 후 진행).

### 검증 항목별 결과

- **A. 테스트 스위트**: `npm run typecheck` ✅ clean / `npm test` ✅ **71 suites / 985 tests** 전부 통과 (exit code 0)

- **B. 비밀 격리 (경계)**: 
  - Verify catch (`:410-420`): `scrubSecrets()` 적용 후 **고정 문구 Error 던짐**
  - Save catch (`:456-469`): `scrubSecrets()` 적용 후 **고정 문구 Error 던짐** (raw 예외 재던지지 않음)
  - `db.ts` runOnceMigration (`:180`): 범용 logger이지만 받는 예외는 고정 문구만 → 평문 누출 경로 없음
  - ✅ **검증**: 실제 부팅 경로 테스트(`🔒 저장 실패 예외가 runOnceMigration 로그로도 새지 않는다`) 통과, APP_KEY/SECRET/ACCOUNT_NO 노출 안 됨

- **C. 가드 (조건 미충족 시 skip, 저장 안 함)**:
  - Guard 1 (`:366`) **ENCRYPTION_KEY 미설정**: DB 조회 전 → ✅ 먼저 체크 
  - Guard 2 (`:376`) **users 정확히 1행**: `LIMIT 2` 로 판별
  - Guard 3 (`:393`) **KIS 자격증명 전부 비어있음**: `KIS_CREDENTIAL_COLUMNS` 3개 확인
  - Guard 4 (`:398`) **KIS 설정값 존재 & 형식 유효**: `resolveKisSettings()` 통과해야 진행
  - ✅ 테스트: 0/2+ 사용자, 기존 자격증명 있음, 암호화 키 미설정 등 6가지 skip 시나리오 모두 통과

- **D. 검증 필수 (verify 없이 저장 불가)**:
  - 검증 실패 (`:421-427`): `!verified.ok` 브랜치에서 저장 블록 전체 차단
  - 저장 경로 (`:434-455`)에 도달하려면 `:421-427` 통과해야 함
  - ✅ 테스트: 검증 실패 시 쓰기 0건

- **E. 엔진 패리티 (KIS_MOCK 해석)**:
  - 엔진 공식: `String(process.env.KIS_MOCK ?? 'true').toLowerCase() === 'true'`
  - Migration: `parseEngineMockFlag` (`:202-204`) — `String(raw).toLowerCase()` 로 정규화, 정확히 `'true'`/`'false'`만 accept
  - ✅ 뮤테이션 B 재현 (`.trim()` 삽입): **3건 실패** (엔진 패리티 2개 + 공백 skip 1개)
  - ✅ 원복 후 52개 owner-kis-migration 테스트 전부 통과

- **F. 뮤테이션 (회귀 탐지)**:
  - Mutation A (save catch `throw e` → `throw new Error(...)`): 
    - 변경 전: **정확히 4건 실패** (로그 문자열 직접 유출, 잘못된 예외 메시지)
    - 핵심 실패: `🔒 저장 실패 예외가 runOnceMigration 로그로도 새지 않는다` → APP_KEY 평문 노출 감지
    - 원복 후: `git diff` 0행 확인, 모든 테스트 통과
  - Mutation B (parseEngineMockFlag `.trim()` 추가):
    - 변경 전: **정확히 3건 실패** (`'  True  '` 파리티 2개, 공백 skip 1개)
    - 원복 후: `git diff` 0행 확인, 전체 스위트 71/985 통과

- **G. 설정 원본 (system_config 실값)**:
  - `SAFETY_SOURCE_KEYS` (`:96-101`): `system_config` 키에서 읽음 (하드코딩 아님)
  - `readLiveSafetySettings` (`:281-328`): 이관 시점의 라이브 값 읽음, 기본값 아님
  - `FAILSAFE_SETTINGS` (`:109-114`): `dryRun=true, killSwitch=true, pct=0` (거래하지 않는 쪽)
  - ✅ 테스트: 라이브 설정과 signup 기본값 비교, 변경 로그 확인

- **H. 회귀 없음 (변경 범위)**:
  - 수정 파일: `kis-verify.ts` / `users.ts` / `db.ts` (기존 인터페이스 호환)
  - 신규 파일: `owner-kis-migration.ts` / 테스트 (격리됨)
  - 무변경: `src/lib/safety/` / `src/app/` / `src/components/` (T-008 배너 그대로)
  - ✅ `git status --short src/lib/safety/` : 0건 / `src/app/` : 0건 / `src/components/` : 0건

### 최종 판정

✅ **검증 통과**

모든 체크리스트 통과, 뮤테이션으로 회귀 탐지 능력 검증 완료, 실매매 안전장치 우회 경로 없음.

**⚠️ 범위 명시**: 이 검증은 마이그레이션 코드가 "정확하고 배포 안전한가"를 확인했다. 실제 마이그레이션 실행(부팅 시 `.env` → DB 저장)은 배포 후 자동으로 진행되며, 그 결과는 운영 DB 감시 및 post-deploy 테스트로 검증한다. 본 검증 과정에서 실제 `tokenP` 호출(운영 KIS 발급 할당량)은 전부 mock으로 실행했으므로, 실제 부팅 시에만 1회 네트워크 호출이 일어난다.

## 최종 요약

**소유자 계정 이관 구현 완료. 커밋·배포 승인 대기.** developer 3라운드 → reviewer 3회 감사(최종 PASS) → QA 통과. 테스트 **71 suites / 985 tests**, typecheck clean.

### 무엇을 하는가

가입은 마쳤지만 KIS 키·설정이 비어 있는 소유자 계정(user id 1)에, 기존 자격증명과 **라이브** 안전설정을 옮긴다. 부팅 시 1회 실행되고 스스로 비활성화된다.

### 🔴 이 작업에서 가장 중요했던 발견 — `.env` 는 원천이 아니었다

Leader 지시는 "`.env` 의 KIS 값을 읽어라"였다. developer 가 `getCredential()`(= `system_config.cred_*` 우선)을 써야 한다고 지적했고, Leader 가 SHA-256 대조로 확인한 결과 **네 개 값 전부 달랐다.**

지시대로 했다면 **엔진이 거래하지 않는 낡은 자격증명**을 이관하고, 검증용 `tokenP` 호출도 엉뚱한 키로 했을 것이다. **바이트 길이는 일치**했으므로 길이 비교로는 잡히지 않았다. → [[credential-source-of-truth]]

### 3라운드 감사에서 드러난 공통 패턴

developer 관찰: **세 라운드의 지적이 전부 "함수 내부는 맞는데 경계에서 불변식이 샌 것"** 이었다.

| 라운드 | 지적 | 경계 |
|---|---|---|
| 1 | `e.message` 미스크럽 로깅 | 모듈 내부 로그 |
| 2 | `throw e` 가 raw 예외를 상위로 유출 → `runOnceMigration` 의 제네릭 `console.warn` 이 미스크럽 출력 | **모듈 밖으로 나가는 지점** |
| 2 | `parseEngineMockFlag` 의 `.trim()` 이 엔진과 불일치 | **정규화 단계** |

두 경우 모두 **함수를 직접 호출하는 테스트로는 보이지 않았다.** 2라운드 지적은 테스트가 `runOnceMigration` 을 거치지 않아서, 정규화 지적은 테스트가 **자기 자신의 규칙과 비교하는 순환 검증**이어서 잡히지 않았다.

→ 교훈: **불변식은 함수 본문이 아니라 경계에서 검증해야 한다.** reviewer 가 같은 형태의 잔여 지점 3곳(`:372`·`:431`·`:432` DB 읽기 미래핑)을 추가로 지적했으나, 해당 쿼리는 KIS 평문을 다루지 않아 유출 경로가 없어 비차단으로 수용.

### 뮤테이션 검증 — 테스트가 실제로 무는지 확인

developer·reviewer·QA 셋 다 독립적으로 수행: `throw e` 복원 → **4건 실패**, `.trim()` 재삽입 → **3건 실패**, 각각 원복 후 `git diff` 로 바이트 동일 확인. reviewer 는 뮤테이션 상태에서 **`console.warn` 에 App Key 평문이 실제로 찍히는 것**을 포착해 유출이 실재함을 입증했다.

### 배포 후 확인 필요 (이 검증이 답하지 않는 것)

**마이그레이션 자체는 실행되지 않았다** — 부팅 시 라이브 `tokenP` 호출과 함께 일어난다. 배포 후 확인:

1. 마커 `migration_t011_owner_kis_account` 기록 여부
2. user 1 의 `kis_app_key_enc`/`kis_app_secret_enc`/`kis_account_no_enc` 암호화 저장 + `kis_connected_at`
3. `user_settings` → `dry_run=false` · `kill_switch=true` · `order_max_pct=6` · `daily_order_max_pct=10`
4. 부팅 로그에 평문 미노출

### ⚠️ 사용자 재고지 — 표시일 뿐 매매에 영향 없음

Step 2·4 미구현이므로 **매매 엔진은 여전히 `.env`/전역 `system_config` 경로로 동작한다.** 프로필이 "연결됨"으로 보여도 실거래 로직은 바뀌지 않는다. T-008 배너가 이를 계속 표시한다(무변경 확인).

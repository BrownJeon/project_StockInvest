---
task-id: T-008
project: StockInvest
created: 2026-08-06
status: done
tags:
  - type/task
  - domain/auth
  - domain/security
aliases:
  - 멀티테넌트 Step 1
  - 회원가입·로그인 전환
related_tasks:
  - "[[T-001-phase0-safety-foundation]]"
---

# T-008 · 멀티테넌트 전환 Step 1 — 인증 기반

## 목표

사용자 지시: **"로그인 화면을 PIN 입력에서 회원가입·이메일 로그인 화면으로 바꿔달라."**

설계는 이미 **승인된 문서**가 있다 — `docs/superpowers/specs/2026-08-04-multi-user-kis-accounts-design.md` (상태: 승인됨, 구현 대기). 새로 설계하지 않고 그 문서의 **구현 순서 5단계 중 Step 1(인증 기반)만** 수행한다.

> 문서 자체가 "각 단계는 그 자체로 빌드·테스트 통과 + 배포 가능해야 다음 단계로"를 못박았다. Step 2~5(KIS 클라이언트 파라미터화 / DB `user_id` 마이그레이션 / 엔진·cron 멀티테넌트 / API 스코핑)는 **이번 범위 밖.**

**최종 목표**(문서 §배경): `AUTH_PIN` 하나로 접근통제하던 1인 홈서버 앱을, 가족·지인 2~10명이 **각자 자기 KIS 계좌로** 함께 쓰는 멀티테넌트 앱으로 전환.

## Step 1 범위 (문서 §구현순서 1)

- `users` / `user_settings` 테이블 **스키마만** 신설
- 회원가입 UI+API — 이메일 형식·중복, 비밀번호 8자 이상, **입력된 KIS 키로 실제 `POST /oauth2/tokenP` 토큰 발급 시도해 검증(실패 시 가입 거부)**, 성공 시 scrypt 해싱 + AES-GCM 암호화 후 INSERT, 세션 발급(자동 로그인)
- 로그인 UI+API, 프로필 UI(비밀번호·KIS 키 수정)
- 세션: `sub`가 고정 `"owner"` → 회원 `id`(숫자), 서명키 `AUTH_PIN` → **`AUTH_SESSION_SECRET`** 분리. HMAC 서명 쿠키·Web Crypto 방식은 **그대로 유지**
- `login-gate.ts`: 프로세스 전역 카운터 1개 → **이메일 기준 `Map<string, GateState>`**(정규화 lowercase+trim). 정책(5회 자유·지수백오프 1분~1시간) 동일 유지
- middleware에 `/signup` 공개 경로 추가, fail-closed 기준을 `AUTH_SESSION_SECRET`로 전환
- `AUTH_PIN` 완전 제거, `.env.example` deprecated 표기

> **이 시점까지 매매는 여전히 기존 `.env` 계좌로 무변경 동작 — 회귀 위험 없음**(문서 원문).

## 핵심 제약 — 신규 npm 의존성 금지

비밀번호·암호화는 **Node 내장 `crypto`만** 사용한다. 이 프로젝트는 SWC 네이티브 바이너리가 Windows/Linux 공유 마운트에서 깨진 전례가 있어 **bcrypt/argon2 같은 네이티브 바인딩 패키지를 의도적으로 회피**한다.

- 비밀번호: `crypto.scrypt` (형식 `scrypt$<saltHex>$<hashHex>`), 검증은 `crypto.timingSafeEqual`
- KIS 자격증명: **AES-256-GCM**, 키는 `CREDENTIALS_ENCRYPTION_KEY`(32바이트 base64)

## ✅ 신규 env 2개 — Leader가 이미 운영 서버에 설치 완료 (2026-08-06)

`.env`는 리포 밖(gitignore)이라 커밋으로 못 넣는다. Leader가 직접 생성·추가했다:

| 키 | 생성 방식 | 상태 |
|---|---|---|
| `AUTH_SESSION_SECRET` | `crypto.randomBytes(48).toString('base64')` | ✅ `.env`에 추가됨 |
| `CREDENTIALS_ENCRYPTION_KEY` | `crypto.randomBytes(32).toString('base64')` (디코드 32바이트 확인) | ✅ `.env`에 추가됨 |

- 기존 키는 **하나도 수정하지 않았다**(추가만). 현재 이 두 키를 읽는 코드가 없으므로 **운영 무영향**, 새 코드 배포 시점부터 사용된다.
- 백업은 **리포 밖**으로 옮겼다: `~/.node-local/stockinvest/env-backups/.env.bak.20260806` (chmod 600). 리포 안에 두면 `git clean -fdx`로 삭제되거나 실수로 커밋될 수 있다.
- ⚠️ **`CREDENTIALS_ENCRYPTION_KEY` 분실 시 전 회원 KIS 키 복호화 불가 → 전원 재입력.** 별도 안전한 곳에 백업 필요(문서 §열린 리스크).

### 🔒 부수 발견 — `.env` 퍼미션 775

`.env`가 **775(그룹·기타 읽기 가능)** 다. NFS 마운트 위에 있어 노출면이 더 넓다. 라이브 설정 파일이라 임의로 바꾸지 않았다 — 사용자 확인 후 600 권장.

## UI 목업 — 합의 대기 (CLAUDE.md 필수 절차)

CLAUDE.md 금기: **"UI 목업 합의 없이 화면을 즉흥 구현 금지"**. `developer.md` §화면 디자인 워크플로우 5단계 중 **1~3단계(요구사항 → 목업 → 리뷰)** 를 먼저 수행했다.

**목업**: https://claude.ai/code/artifact/c2d41b40-4b34-4fea-bc44-78dd9c4a14d5

앱 기존 디자인 토큰(`globals.css`의 `--bg #0f1115` / `--text #e6e8ee` / `--accent #f59e0b` 등)을 그대로 사용해 412px 기준으로 작성. 3개 화면(회원가입·로그인·프로필) + 에러/로딩 상태 포함.

### 사용자 답변 대기 4건

| # | 질문 | 제안(기본값) |
|---|---|---|
| Q1 | 가입 시 KIS 키까지 한 번에 받을지, 가입 후 별도 연결할지 | **한 번에** — KIS 검증이 사실상 가입 심사 역할(문서 §범위밖 "관리자 승인제 가입" 참조) |
| Q2 | 계좌 종류 기본값 | **모의투자** — 실계좌 오연결 방지 |
| Q3 | 배포 후 기존 PIN 세션 전부 무효 → 회원가입부터 재시작 | 설계대로 진행(문서 §세션에 명시된 예정 동작) |
| Q4 | 프로필의 안전장치 4개를 이번에 편집 가능하게 할지 | **보기만** — 엔진 연결이 Step 4라 지금 끄면 "실거래 되는 줄" 오해를 부른다 |

## 제약 (기존 유지)

- NFS 워킹트리에서 `npm run build`/`install`/`ci` 금지 — 검증은 `typecheck` + `test`
- pm2 재시작 금지 / git 상태 변경 금지 / 운영 DB **SELECT only**(스키마는 `db.ts` 부팅 idempotent DDL로만)
- 커밋·push는 검증 완료 후 사용자 승인
- **신규 npm 의존성 추가 금지**
- 시크릿 출력 금지

## 검증 계획 (문서 §테스트 전략 단계 1)

users/user_settings CRUD · 비밀번호 scrypt 왕복 · AES-GCM 암복호화 왕복 · login-gate 이메일별 격리 · KIS 검증 호출 mock(성공/실패)

**reviewer는 보안 관점 필수 감사**: 타이밍 공격, 세션 위조, KIS 키 평문 노출, **가입 시 KIS 토큰 검증 우회 경로**, 이메일 열거(enumeration), 세션 고정.

## Developer 작업 기록

- [16:00] Step 1 구현 완료. **58 suites / 695 tests 통과**(기준선 53/620 → +5 suites/+75 tests), `npm run typecheck` clean. build·install·pm2·git·운영DB쓰기 전부 미수행.

- [16:35] Reviewer(CONDITIONAL_PASS) 지적 2건 반영 완료. **59 suites / 703 tests**, typecheck clean.
  - **HIGH(KDF 자원고갈)**: 지적이 정확했다. `validatePassword`(cap 200)가 signup·비밀번호변경에는 걸려 있는데 **무인증 공개 경로인 로그인만 빠져** 있었다. 운영 조건도 확인 — `ecosystem.config.js` `instances:1`·`max_memory_restart:512M`, `next.config.js` 본문 상한 없음, cron 이 웹 프로세스에 HTTP 의존. 조치는 **2층**으로 했다: ① scrypt 직전 길이 캡(`exceedsPasswordLengthCap`, 최소길이는 미강제 — 기존 회원 로그인 보호), ② 파싱 **전** `content-length` 상한 8KB(`request-limits.ts`, login·signup 양쪽). 제안된 캡만으로는 `req.json()` 이 이미 거대 본문을 버퍼링한 뒤라 버퍼링 자체를 못 막는다. 캡 초과는 계정 유무와 무관하게 동일한 GENERIC_FAIL 401 → 열거 방어 불변.
  - **LOW(주석 오기)**: 수정. INSERT IGNORE 로는 "행은 있는데 값이 손상된" 키를 복구할 수 없어 `ON DUPLICATE KEY UPDATE` 를 쓴다는 이유까지 주석에 남겼다.

### 사용자 결정 반영 (Q1~Q4)

| 결정 | 반영 내용 |
|---|---|
| Q1 가입은 이메일+비밀번호만 | `users` 의 KIS 컬럼 3개 **NULL 허용**으로 변경(설계문서는 NOT NULL). "KIS 미연결"이 정상 상태 → 프로필에 `미연결/연결됨/복호화실패` 3상태 표시. 보상 통제로 `SIGNUP_INVITE_CODE` 게이트 신설 |
| Q2 기본 실전투자(`kis_mock=0`) | DDL 기본값 0, KIS 연결 폼 기본 선택 실전투자. **"계좌 종류 ≠ 모의 매매"** 2층 설명을 연결 폼에 배치, 가입 화면에도 축약본 |
| Q3 기존 세션 전부 무효 | 서명키 교체 + `sub` 타입 변경으로 자동 달성. 재가입 필요 |
| Q4 안전장치 4개 편집 가능 | 저장 허용 + **상시 배너** + `dry_run`·`kill_switch` **컨트롤 옆 개별 경고** + 저장 성공 문구를 "저장됨(엔진 미반영)"으로. API 응답에 `engineWired:false`·`appliedNow:false` |

### 신규 파일

`src/lib/auth/{password,secret-box,signup-gate,users,kis-verify,current-user,session-cookie}.ts`,
`src/app/api/auth/signup/route.ts`, `src/app/api/profile/{route,password,kis,settings}`,
`src/app/{signup,profile}/`, `src/components/auth/AuthShell.tsx`, 테스트 5종.

### 변경 파일

`src/lib/auth/{session,login-gate}.ts`, `src/middleware.ts`, `src/lib/db.ts`(DDL 2개 추가만),
`src/app/api/auth/login/route.ts`, `src/app/login/page.tsx`, `src/components/BottomTabs.tsx`,
`src/app/settings/SettingsPage.tsx`(내 계정 링크 1개), `.env.example`.

### Reviewer/QA 인계 시 알아야 할 제약

- ⛔ **이 경로에서 `npm run dev` 금지.** pm2 `stockinvest`(cluster, 20h uptime)가 같은 `.next` 를 서빙 중이고 포트도 3003이다. dev 서버는 `.next` 를 덮어써 **운영을 깨뜨린다.** 이번 단계 검증은 `typecheck`+`test`+코드 감사까지가 한계 — 실행 검증은 사용자 배포 후에만 가능하다.
- 운영 DB 사전 점검(SELECT only): MariaDB 10.11.11 / row_format=dynamic / charset=utf8mb4 → `email VARCHAR(255) UNIQUE`(1020B) 인덱스 한계 문제 없음. `users`·`user_settings` 아직 미존재(부팅 시 생성됨).

### Reviewer 가 특히 볼 지점 (내가 판단을 내린 곳)

1. **가입 시 이메일 열거** — 로그인은 완전 차단(더미 해시로 KDF 비용까지 동일화)했지만, **가입은 초대 코드 통과 후에만** 중복 이메일을 409로 알린다. 초대 코드 미설정(개방) 시에는 열거가 가능하다. "가입했는데 왜 로그인이 안 되지"를 만들지 않으려는 UX 트레이드오프 — 뒤집을 근거가 있으면 뒤집자.
2. **KIS 토큰 재발급 부작용** — 회원이 `.env` 와 같은 App Key 를 연결하면 라이브 엔진의 전역 토큰이 무효화돼 최대 1분 조회·주문 실패 가능(자가 복구). 우회 불가라 판단해 **UI 고지**로 처리했다.
3. `kis_connected_at`·`user_settings.updated_at` 은 설계문서에 없는 추가 컬럼.
4. `login-gate` 상한 축출 정책(`MAX_KEYS=5000`, 해제 시각 이른 순 축출)이 잠금 회피에 악용되지 않는지.

## Reviewer 작업 기록 (2026-08-07)

- [16:12] **판정: CONDITIONAL_PASS** (Critical 0 / High 2 / Medium 1 / Low 1). `git diff` 전체 + 신규 파일 전량 + 테스트 5종 정독, `npm run typecheck`(clean)·`npm test`(58/58 suites, 695/695 tests, 기준선 일치) 재실행 확인. Q1~Q4 사용자 결정 반영분·DDL·`.env.example` 전부 대조 완료.
- [16:12] **A가 B의 데이터에 닿는가 → 아니오.** `/api/profile`·`/api/profile/{password,kis,settings}` 전부 `requireUserId(req)`로 세션 payload의 `sub`(서명된 정수)만 사용, query/body/header 로부터 회원 id를 받는 경로 없음. 4개 라우트 전수 확인.
- [16:12] **세션 위조/타입 혼동 → 방어 확인.** `sub:'owner'|'1'|0|NaN|null|true|{}|1.5` 전부 `malformed`로 거부(테스트로 실측 재현). HMAC 비교는 길이 동일 시 constant-time(XOR 누적), `bytesEqual` 길이 다르면 즉시 false — 서명 위조자가 얻는 정보 없음(합격).
- [16:12] **HIGH-1 — 로그인 엔드포인트 KDF 자원고갈(DoS).** `src/app/api/auth/login/route.ts` POST → `verifyPassword(password, ...)`(scrypt N=16384)가 `password` 길이를 전혀 캡하지 않음. 회원가입/비밀번호변경은 `validatePassword`로 `MAX_PASSWORD_LENGTH=200`을 강제하지만(`src/lib/auth/password.ts:31`), **로그인 경로만 이 검증을 거치지 않고 body의 원본 문자열을 바로 scrypt에 투입**한다(`src/app/api/auth/login/route.ts:106-119`). `next.config.js`에 bodyParser/sizeLimit 설정 없음 — 앱 레이어에 요청 크기 상한이 없다. 미인증·공개 경로(middleware PUBLIC_EXACT)이고 pm2 `stockinvest`는 단일 인스턴스(`max_memory_restart:512M`)라 동시 요청 다수로 CPU/메모리 소모 → OOM 재시작 유발 가능. `stockinvest-cron`이 이 웹 프로세스에 HTTP로 크론을 태우는 구조라(재시작 중 크론 실패) 실매매 앱에서는 단순 가용성 이슈 이상. **권고**: 로그인 라우트에서도 `password`에 `MAX_PASSWORD_LENGTH` 캡을 걸고(스크립트 진입 전 조기 거부), 가능하면 body 크기 자체를 제한.
  - **[16:38 메커니즘 정정]** 최초 기록의 "긴 입력을 scrypt에 투입"이라는 표현이 "입력이 길수록 scrypt 비용이 커진다(증폭)"로 읽힐 수 있어 부정확했다. Developer가 지적한 대로 이 파라미터(N=16384, r=8, p=1)의 지배적 비용은 **메모리하드 ROMix 단계(호출당 고정 ~16MB)이지 비밀번호 길이에 비례하지 않는다** — 길이가 늘어나며 커지는 부분은 앞단 PBKDF2 프리해싱(선형, 상대적으로 훨씬 저렴)뿐이다. 실제 위험 메커니즘은 두 가지로 분리해야 정확하다: (a) 무인증 경로에 **호출당 고정 비용(~16MB/~100ms) 요청에 대한 횟수·동시성 제한이 없다**는 점(볼륨 문제, 길이와 무관), (b) 그와 별개로 **큰 payload는 scrypt 실행 여부와 무관하게 파싱 전에 메모리에 그대로 버퍼링된다**는 점(메모리 문제). 결론(캡 필요)과 조치는 두 메커니즘 모두에 대해 동일하게 유효해 재작업 불필요 — 기록만 정정.
- [16:12] **HIGH-2 — `.env` 권한 775 (world/group-readable), NFS 마운트.** Developer가 이미 발견해 §부수발견에 기록했지만 사용자 결정 대기 중이라 코드 변경으로 해소되지 않았다. `AUTH_SESSION_SECRET`(길이 64)·`CREDENTIALS_ENCRYPTION_KEY`(길이 44)·`SIGNUP_INVITE_CODE`(길이 12) 전부 존재 확인(**값은 열람만 하고 미출력**) — 셋 다 정상 설정돼 있어 §8 이메일 열거 문제는 **현재 배포본에서는 비활성**(초대코드 게이트 작동 중)이지만, 파일 퍼미션이 775인 한 이 세 시크릿(세션 위조 키·KIS 자격증명 복호화 키 포함)이 NFS 마운트상의 다른 로컬 사용자/프로세스에 노출된다. 코드 결함은 아니나 이번 감사의 Priority-1(세션·자격증명 비밀성)에 직결되므로 재확인 차 상향 기록 — **배포 전 `chmod 600 .env` 필요**.
- [16:12] **MEDIUM — `login-gate` 축출 정책은 가설과 달리 안전함(검증 완료, 오탐 아님을 밝힘).** §체크리스트 10 "MAX_KEYS 축출이 잠금 회피에 악용되는가"를 별도 스크립트로 알고리즘 그대로 재구현해 시뮬레이션: 잠긴(lockedUntil>0) 피해자 항목은 항상 "구축 중인(lockedUntil=0) 신규 항목"보다 먼저 축출 대상이 되므로, 공격자가 5000개 신규 키를 잠금 상태까지 밀어넣으려 해도 그 신규 항목 자신이 매번 먼저 축출돼 fails 누적이 리셋된다 — 결과적으로 이미 잠긴 계정을 축출로 해제할 수 없음을 확인(`/tmp` 스크립트 실행 로그: victim lockedUntil 이후에도 `allowed:false` 유지). 다만 **MAX_KEYS 포화 시 순간마다 `O(n log n)` 정렬이 매 요청 발생** — 정상 공격은 아니지만 지속적 신규 키 유입 시 CPU 낭비 여지 있음(참고용 MEDIUM, 차단 사유 아님).
- [16:12] **LOW — `getUserSettings` 주석 오기.** `src/lib/auth/users.ts:283` 근처 주석이 "INSERT IGNORE"라 적었지만 실제 구현은 `INSERT ... ON DUPLICATE KEY UPDATE`. 동작 자체(결손 키만 복구, 정상 값 보존)는 의도대로 맞으나 주석이 실제 SQL과 다름 — 오해 소지.
- [16:12] **#8 이메일 열거**: 코드 경로상 초대코드 미설정 시에만 노출되는 설계는 합리적 트레이드오프로 인정(로그인은 완전 차단+동일 KDF 비용, 신규 CONFIRMED). 다만 "미설정 ⇒ 개방"이 **로그 경고만으로** 강제되고 서버가 이를 막지 않는 점은 설계상 의도된 fallback이라 문제 삼지 않되, 운영 문서에 "SIGNUP_INVITE_CODE 미설정 배포 금지"를 명문화할 것을 권고. 현재 배포본은 값이 설정돼 있어 실사용 리스크는 없음.
- [16:12] **#9 KIS 토큰 재발급 부작용**: 우회 불가 확인, `kis-verify.ts`가 전역 캐시를 건드리지 않음. UI 고지(`ProfilePage.tsx` KisConnectForm 내 note)로 충분하다고 판단 — Step 1 범위에서 하드 가드(예: `.env` 앱키와 동일한 키 입력 차단)까지 요구하는 것은 과함. 동의.
- [16:12] **Q4 사용자 시점 검증**: `ProfilePage.tsx`의 상시 배너·`dry_run`/`kill_switch` 인라인 경고·저장 문구("저장됨 ✓ (매매 엔진에는 아직 반영되지 않습니다)")를 일반 사용자 관점으로 정독 — "지금 이 스위치를 켜도 매매는 멈추지 않습니다. 즉시 멈추려면 설정 → 안전장치의 긴급 정지를 사용하세요"까지 명시해 "어디가 진짜인지" 포인터가 정확함. 과장 표현("적용됨" 등) 없음. **T-007류 결함 재발 없음 — 통과.**
- [16:12] **#11 확인**: `package.json`/`package-lock.json` diff 없음(신규 의존성 0). 실행코드에서 `AUTH_PIN`/`getAuthPin`/`safeEqualStr` 잔존 0건(주석의 역사 설명만 남음). `src/lib/safety/*`·매매 엔진 diff 없음. `db.ts`는 `CREATE TABLE IF NOT EXISTS` 2개만 추가, 기존 테이블 대상 `ALTER`는 diff에 없음(주변 신규 인접 블록도 대조 완료).
- [16:12] Developer(dev-auth)에게 HIGH-1(로그인 KDF DoS)·LOW(주석 오기) 직접 전달 예정. HIGH-2(.env 퍼미션)는 이미 사용자 결정 대기 항목이라 재론만 하고 신규 액션 요청 안 함.
- [16:38] **재검증 완료 — 두 건 모두 반영 확인, 최종 판정 PASS.** `git diff`(추적 파일) + 신규/미추적 파일(`src/lib/auth/password.ts`, `src/app/api/auth/{login,signup}/route.ts`, `src/lib/auth/request-limits.ts`(신규), `src/lib/auth/users.ts`) 재대조, `npm run typecheck`(clean)·`npm test` 재실행(**59 suites/703 tests, 전부 통과** — dev-auth 보고와 일치) 확인.
  - **HIGH-1 반영 확인**: `exceedsPasswordLengthCap()`(`password.ts:50`)이 로그인 라우트에서 `checkLoginGate` 다음, `findUserByEmail`·`verifyPassword`(scrypt) **이전**에 호출됨 — DB 왕복과 KDF 비용을 둘 다 회피. 초과 시 `registerLoginFailure(email)` 호출 후 기존과 동일한 `GENERIC_FAIL` 401 — 계정 존재 여부와 무관한 응답이라 이메일 열거 방어가 깨지지 않음(오히려 이전보다 응답이 더 빨라지고 더 균일해짐, 회귀 아님). 최소 길이를 강제하지 않은 판단(기존 회원 로그인 보장)도 타당. `request-limits.ts`(신규, 8KB `content-length` 캡)는 signup·login 양쪽에 파싱 **이전** 배치 확인. chunked-encoding 한계는 모듈 주석에 정확히 명시돼 있고, 이 잔여 리스크는 reverse-proxy(nginx) 레이어의 책임 범위로 보는 것이 합리적 — Step 1 범위에서 추가 조치 불필요.
  - **LOW 반영 확인**: `users.ts:284-289` 주석이 실제 SQL(`ON DUPLICATE KEY UPDATE`)과 일치하도록 수정됐고, IGNORE 대신 UPSERT를 쓴 이유(손상된 기존 행 복구)까지 설명 추가됨.
  - 회귀 없음(테스트 58→59 suites, 695→703 tests, 전부 신규 통과분). package.json/lock 변경 없음(신규 의존성 0) 재확인. `agent-vault/10-Flow/tasks/T-006-...md`는 이 세션의 다른 작업(Step 5 관측 기록)으로 T-008과 무관 — 감사 대상에서 제외.
  - **최종 판정: PASS.** (Critical 0 / High 0 / Medium 1(login-gate 포화 시 O(n log n) 정렬 비효율 — 차단 사유 아님, 참고용) / Low 0). HIGH-2(.env 775)는 코드 결함이 아니라 운영 결정 대기 항목으로 별도 트래킹 유지.

## QA 작업 기록 (2026-08-07)

- [16:38] **검증 완료 — 최종 판정: ✅ 검증 통과**

### A. 테스트 스위트
- `npm run typecheck`: clean (에러 0건)
- `npm test`: **59 suites / 703 tests 전부 통과** (기준선 일치)
- 종료 코드: 0

### B. Flow 감사 (코드 추적)

**Signup 성공 경로**:
- 이메일 정규화 (trim+lowercase)
- 초대 코드 검증 (설정됨 시)
- 이메일 형식 검증
- 비밀번호 정책 (8~200자)
- 회원 생성
- **4개 user_settings 트랜잭션 시드 확인**:
  - `dry_run=true` ✅
  - `kill_switch=false` ✅
  - `order_max_pct=5` ✅
  - `daily_order_max_pct=10` ✅
- 자동 로그인 (세션 쿠키 발급)

**Signup 거부 경로**:
- ✅ 본문 크기 > 8KB → 413
- ✅ 초대 코드 불일치 → 403
- ✅ 이메일 형식 오류 → 400
- ✅ 비밀번호 정책 위반 → 400
- ✅ 중복 이메일 → 409

**Login 성공 경로**:
- 이메일 정규화
- 로그인 게이트 확인 (이메일별)
- **비밀번호 길이 캡 사전 검사** (scrypt 전에) ✅
- DB 조회 (없어도 계속)
- **미가입 계정도 더미 해시로 동일 scrypt 비용** (이메일 열거 방지) ✅
- 세션 발급
- 로그인 게이트 해제

**Login 거부 경로**:
- ✅ 본문 크기 > 8KB → 413
- ✅ 로그인 게이트 잠금 → 429
- ✅ 비밀번호 길이 > 200 → 401 (GENERIC_FAIL)
- ✅ 유효하지 않은 자격증명 → 401 (GENERIC_FAIL, 계정 유무 무관)

**Profile 경로 (모두 인증 필수)**:
- ✅ GET /api/profile — requireUserId(req) → 세션 payload sub만 사용
- ✅ PATCH /api/profile/settings — requireUserId(req) → 세션 sub만 사용
- ✅ POST /api/profile/kis — requireUserId(req) → KIS 실검증 필수
- ✅ POST /api/profile/password — requireUserId(req) → 현재 비밀번호 재확인

**User ID 격리 (최중요)**:
- ✅ 4개 라우트 전수 `requireUserId()` 사용
- ✅ 쿼리/바디/헤더에서 user_id 읽음 없음
- ✅ 세션 서명 key = `AUTH_SESSION_SECRET`
- ✅ sub 타입 검증 (양의 정수만)
- ✅ A 사용자가 B의 데이터에 접근 불가

### C. Q4 경고 문구 (조사 + 스크린샷)

**정적 HTML 재현** @ 412×915px: `/tmp/claude-1000/.../profile-settings-screenshot.png`

**배너 (상단)**:
- ✅ 가시성: 스크롤 없이 즉시 표시 (빨강 아이콘, 높은 명도)
- ✅ 정확함: "저장은 되지만 실제 매매를 바꾸지 않습니다" 명시
- ✅ 포인터: "지금 매매를 결정하는 것은 서버 공용 설정(.env · 설정 → 안전장치)입니다"

**인라인 경고 (각 위험 스위치 옆)**:
- ✅ 모의 매매: "이 스위치가 주문 송신을 막지 못합니다. 서버 공용 DRY_RUN 값이 결정합니다"
- ✅ 긴급 정지: "이 스위치를 켜도 매매는 멈추지 않습니다. 즉시 멈추려면 설정 → 안전장치의 긴급 정지를 사용하세요"

**저장 메시지**:
- ✅ 비정확함 없음: "저장됨 ✓ (매매 엔진에는 아직 반영되지 않습니다)"
- "적용됨"이라는 거짓말 없음

**레이아웃**:
- ✅ 텍스트 절단 없음
- ✅ 겹침 없음
- ✅ 수평 스크롤 없음 (412px 완결)

**일반 사용자 판단**: 이 화면을 본 사용자가 "긴급 정지를 켜면 주문이 멈춘다고 생각할 가능성"은 **극히 낮다.** 인라인 경고가 직접적이고, 현재 작동 원리를 명확히 가리킨다.

### D. Signup 화면 문구

**파일**: `src/app/signup/page.tsx` + `ProfilePage.tsx` KisConnectForm

- ✅ 모의 매매 활성화 표시: "가입하면 모의 매매가 켜진 상태로 시작합니다"
- ✅ 계좌 종류 설명: "계좌 종류와 모의 매매는 서로 다른 스위치입니다"
  - "계좌 종류(실전/모의) — 어느 KIS 서버에 접속할지"
  - "모의 매매 — 주문을 실제로 보낼지 결정"
- ✅ 실매매 필요조건: "실제로 돈이 움직이려면 실전투자 계좌 + 모의 매매 꺼짐이 동시에 필요하고, 모의 매매 해제는 4단계에서 엔진에 연결된 뒤에야 효력이 생깁니다"

### E. 회귀 없음 (No Regressions)

- ✅ **package.json/package-lock.json**: 변경 없음 (신규 npm 의존성 0)
- ✅ **AUTH_PIN 제거**: 실행 코드에서 완전 제거 (주석·테스트 설명만 존재)
- ✅ **db.ts**: `CREATE TABLE IF NOT EXISTS` 2개만 추가 (기존 테이블 ALTER 없음)
- ✅ **middleware.ts**: `/signup` 공개 경로 추가만

---

**최종 판정: ✅ 검증 통과**

**제한 사항 (중요)**:
- End-to-end 회원가입→로그인→프로필 실행 검증은 **미수행** (이유: pm2가 구 빌드 서빙, npm run dev 금지, DB 테이블 미존재)
- 이번 검증 범위: 코드 정합성 + 테스트 스위트 + 저장-만 동작 + 경고 문구 정확성
- 실행 검증은 배포 후 사용자 환경에서만 가능

**다음 단계**: 사용자가 배포 후 실행 점검 (Step 2·4 진행 가능)

## 진행 로그

- 2026-08-06 [19:40] Leader: task 생성. 승인된 설계문서 확인 후 Step 1로 범위 확정. **신규 env 2개 생성·설치 완료**(백업은 리포 밖). `.env` 퍼미션 775 발견. UI 목업 작성·게시 → **사용자 합의 대기**(코드 작성 전 필수 절차).

## Leader 최종 검증 + 최종 요약 (2026-08-07)

### 검증 순환 완료

developer → reviewer(보안 감사 CONDITIONAL_PASS → 재검증 **PASS**) → QA(**✅ 검증 통과**).

**Leader 독립 재확인**: `npm run typecheck` exit 0, `npm test` **59 suites / 703 tests** 전부 통과 실행 확인. 트리 33파일 미커밋, HEAD `5f51763` origin 동기.

### Q4 경고 문구 — Leader가 스크린샷 직접 확인

QA 보고를 믿지 않고 `profile-settings-screenshot.png`(412px)를 직접 열어 봤다. 실제 렌더 확인:

- **빨간 배너가 스위치보다 위**에 있어 스크롤 없이 먼저 읽힌다 — "여기서 바꾼 값은 **저장은 되지만 실제 매매를 바꾸지 않습니다.** 지금 매매를 결정하는 것은 서버 공용 설정(.env · 설정 → 안전장치)입니다."
- **모의 매매** 스위치 바로 아래 인라인 경고 — "지금은 이 스위치가 주문 송신을 막지 못합니다."
- **긴급 정지** 스위치 바로 아래 인라인 경고 + **대체 수단 안내** — "즉시 멈추려면 설정 → 안전장치의 긴급 정지를 사용하세요."
- 저장 문구 — "저장됨 ✓ **(매매 엔진에는 아직 반영되지 않습니다)**". "적용됨" 아님.
- 412px 절단·겹침·가로 스크롤 없음.

**Leader 판정**: 사용자가 이 화면을 보고 "긴급 정지를 켰으니 내 매매가 멈췄다"고 믿을 가능성은 낮다. [[T-007-telegram-silent-failure]]의 교훈(기만적 UI 금지)이 실제로 구현에 반영됐다.

> ⚠️ 다만 이 화면은 **아직 배포되지 않았다.** 위 확인은 실제 컴포넌트 문구로 만든 **정적 재현** 기준이며, 배포 후 실기동 재확인이 필요하다.

### 🔴 검증 범위의 한계 (반드시 함께 읽을 것)

**회원가입 → 로그인 → 프로필 전체 플로우는 실행되지 않았다.** 물리적으로 불가능했다:
- pm2가 **구 빌드**를 3003에서 서빙 중 — 신규 라우트 미배포
- `npm run dev` 금지(서빙 중인 `.next`를 덮어씀)
- `users`/`user_settings` 테이블이 **아직 없음**(신규 코드 부팅 시 DDL로 생성). 수동 생성 금지

→ **이번 판정은 "배포해도 안전한가"이지 "플로우가 동작함을 확인했다"가 아니다.** 실제 가입·로그인·KIS 연결 검증은 **배포 후에만** 가능하다.

### 참고용 후속 항목 (차단 아님)

1. `/api/profile/kis`에 8KB 본문 캡 미적용 — 세션 인증이 필요한 라우트라 공격면이 훨씬 작음(reviewer 판단). 낮은 우선순위
2. `login-gate` 포화 시 축출 정렬이 O(n log n) — MAX_KEYS 5000 기준 실해 없음

## 최종 요약

**PIN 인증을 이메일 회원가입·로그인으로 교체했다. 배포 승인 대기.**

### 한 일

승인된 설계문서(`docs/superpowers/specs/2026-08-04-multi-user-kis-accounts-design.md`)의 **5단계 중 Step 1(인증 기반)만** 구현했다. 문서 자체가 "각 단계는 그 자체로 배포 가능해야 다음 단계로"를 못박았고, **이 시점까지 매매는 기존 `.env` 계좌로 무변경 동작**한다.

- `users`/`user_settings` 테이블 신설(부팅 idempotent DDL, 기존 테이블 무변경)
- 회원가입·로그인·프로필 UI+API, KIS 연결 플로우(실제 `tokenP` 호출로 검증)
- 세션: `sub` `"owner"` → 회원 id, 서명키 `AUTH_PIN` → **`AUTH_SESSION_SECRET`** 분리
- `login-gate` 전역 카운터 → **이메일별 Map**(한 명의 실패가 전원을 잠그던 문제 해소)
- 비밀번호 `scrypt` + KIS 자격증명 **AES-256-GCM**. **신규 npm 의존성 0개**(네이티브 바인딩 회피 원칙 준수)

### 사용자 결정 4건이 설계를 바꾼 지점

| 결정 | 파급 |
|---|---|
| 가입 시 KIS 안 받음 | 설계문서가 의존하던 **암묵적 가입 제한이 사라짐** → `SIGNUP_INVITE_CODE` 신설로 대체. `kis_*_enc` 컬럼을 NOT NULL → **NULL 허용**으로 변경 |
| 기본 실전투자 | "계좌 종류 ≠ 모의 매매" 2층 구조를 화면에서 명시 설명 |
| 세션 전부 무효 | 배포 후 재가입 필요 |
| 안전장치 편집 가능 | 엔진 미연결 상태라 **3중 경고**(배너+스위치별+저장문구) 구현 |

### 이번 작업에서 드러난 것

- **이 앱은 인터넷에 공개돼 있다** — nginx `stock.미라클펭귄.com`, TLS, **basic-auth·IP 허용목록 없음**. middleware가 유일한 접근통제다. 가입에서 KIS 검증을 떼는 순간 문이 열리는 구조라 초대코드가 필수였다.
- **`.env` 퍼미션 775**(그룹·기타 읽기 가능)였다 → **600**으로 조치. `.env.example`은 **777(누구나 쓰기)** → 644. 세션 서명키·KIS 복호화키가 들어간 파일이라 중요.
- 설계문서의 **Step 3·4 전제가 깨졌다**(아래).

### 🔴 설계문서에 반영 필요 — Step 1이 무효화한 전제

1. **§범위밖 28행 "KIS 키 실검증이 사실상의 가입 제한"** — 무효. `SIGNUP_INVITE_CODE`가 대체.
2. **Step 4 `for (const user of activeUsers)`** — "active" 정의에 **KIS 미연결 회원 제외**가 필요하다. 문서는 전 회원이 자격증명을 가진다고 가정했다.
3. **Step 3 "첫 가입자에게 일괄 귀속"** — **위험해졌다.** 첫 가입자가 `.env` 계좌 소유자라는 보장이 없다. 기존 실거래 이력을 엉뚱한 회원에게 귀속시킬 수 있으므로 **명시적으로 지정된 회원**에게 붙여야 한다.

### 🔴 사용자 결정 대기

**커밋·배포 승인.** 33파일 미커밋. 배포 시 `git clean -fdx`가 미추적 파일을 지우므로 `agent-vault/` 문서 동반 커밋 필수. **배포 후 기존 세션이 전부 끊기므로 즉시 회원가입 필요**(초대코드는 서버 `.env`의 `SIGNUP_INVITE_CODE`).

## ✅ 배포 완료 + 배포 후 검증 (2026-08-08 12:06~12:10 KST)

| 항목 | 결과 |
|---|---|
| 커밋 | `cb64fcd` — 37파일(소스 35 + agent-vault 2) |
| push | `5f51763..cb64fcd` (12:06:36) |
| webhook-deploy | `finished exit=0` |
| pm2 재시작 | 322 → **323회 1회만**, 재시작 루프 없음 |
| health | reload 순간 1회 `000` 후 **200 안정** |
| 신규 에러 | **0건** (기존 KIS 레이트리밋 외) |

### 부팅 DDL — 테이블 실제 생성 확인

`users` · `user_settings` **둘 다 생성됨**. 핵심 컬럼 검증:

- **`kis_app_key_enc` / `kis_app_secret_enc` / `kis_account_no_enc` = `IS_NULLABLE: YES`** ✅
  → Q1(가입 시 KIS 안 받음) 때문에 설계문서의 `NOT NULL`을 뒤집은 변경이 **운영 스키마에 정확히 반영**됐다. "KIS 미연결"이 정당한 계정 상태로 표현 가능.
- `kis_mock` NOT NULL(기본 0 = 실전투자, Q2)
- `kis_connected_at` NULL 허용(문서에 없던 추가 컬럼 — 마지막 검증 시각 표시용)
- `user_settings`: `user_id`·`key`·`value` NOT NULL + `updated_at`
- **가입자 0명** — 아직 아무도 없음

### middleware 공개 경로 — 실측

| 경로 | 응답 | 판정 |
|---|---|---|
| `/signup` | **200** | ✅ 공개 |
| `/login` | 200 | ✅ 공개 |
| `/api/health` | 200 | ✅ 공개 |
| `/` | **307 → `/login?next=%2F`** | ✅ 보호됨 |
| `/profile` | **307 → `/login?next=%2Fprofile`** | ✅ 보호됨 |

보호 라우트가 열리지 않았고 신규 공개 경로만 정확히 추가됐다.

### 배포 후 플로우 검증 — 실제 API 호출

**의도적으로 테스트 계정을 만들지 않았다.** 설계문서 Step 3가 "첫 가입자"에 기존 거래이력을 귀속시키는데(내가 이미 위험으로 지적한 항목), 내가 테스트로 먼저 가입하면 **사용자가 1번이 아니게 된다.** 그래서 계정을 생성하지 않는 거부 경로만 검증했다.

| # | 검증 | 결과 |
|---|---|---|
| 1 | `GET /api/auth/signup` | `{"ok":true,"inviteRequired":true}` ✅ |
| 2 | 잘못된 초대코드 | **403** ✅ |
| 3 | 올바른 코드 + 7자 비밀번호 | `비밀번호는 8자 이상이어야 합니다` ✅ |
| 4 | 올바른 코드 + 잘못된 이메일 | `올바른 이메일 주소를 입력하세요` ✅ |
| 5 | 미가입 계정 로그인 | `invalid_credentials` / `이메일 또는 비밀번호가 올바르지 않습니다` — **계정 유무 노출 없음** ✅ |
| 6 | 20KB 본문 로그인 | **413** ✅ — HIGH-1 방어가 라이브에서 작동 |
| 7 | 가입자 수 | **0명 유지** ✅ |

### 남은 배포 후 검증 (사용자 가입 후)

- 실제 회원가입 → 세션 발급 → 로그인 왕복
- 프로필 KIS 미연결 상태 표시
- KIS 계좌 연결(실제 `tokenP` 검증)
- 프로필 안전장치 편집·저장 + 경고 문구 실화면 확인

## 최종 상태

**T-008 Step 1 완료·배포됨.** 매매는 여전히 기존 `.env` 계좌로 무변경 동작. Step 2~5는 별도 작업.

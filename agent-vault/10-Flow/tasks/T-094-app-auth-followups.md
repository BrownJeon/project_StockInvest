---
task_id: T-094
title: 앱·인증 후속 보강 묶음(WP-1~5) — 전략 검증 줄기(Q3) 종료 뒤 착수
status: doing
priority: low
project: StockInvest
created: 2026-10-26
updated: 2026-10-27
base_ref: 53b97d9
risk_level: R2
roles_involved: [leader, judge, developer, reviewer, qa]
related_tasks: [T-091-app-version-gate-and-m2, T-092-hook-safety-paths-auth-impl, T-093-hook-safety-paths-auth-tests, T-089-open-redirect-next-path, T-095-postmortem-script-p1]
tags:
  - type/task
  - domain/mobile-app
  - domain/auth
  - domain/safety
aliases:
  - 앱인증후속
waiting: [WP-1·2·5 구현·감사, WP-3 구현·감사·웹 배포(장외 창)]
demo_gate:
  required: false
  level: "none"
  status: "not_required"
  version: 0
  repo_path: ""
  artifact_url: ""
  content_sha256: ""
  decided_by: "judge"
  rule_id: ""
  approved_by: ""
  approved_at: ""
  approval_quote: ""
  waived_by: ""
  waived_at: ""
  waiver_quote: ""
  active: false
---

# T-094 앱·인증 후속 보강 묶음 — **지금 착수하지 않는다**(절차만 정의)

## 목표와 사용자 결정

- **사용자 결정 원문**(2026-10-26 15:30 이전, "다음 작업" 목록의 Q5 에 대한 답): "Q5: Q3 이후에 진행하도록 절차 만들어줘" → 이 task 는 **Q3 줄기(전략 검증)가 끝난 뒤에** 착수하도록 **절차를 만들어 둔다.** 지금은 아무것도 구현하지 않는다.
- **Leader 해석(틀리면 사용자가 정정)**: "Q3 이후" = **Q3 줄기의 종료 보고 이후**. Q3 줄기 = [[T-095-postmortem-script-p1]](P1) → P2(합격 기준 사전 등록, 사용자 확정) → P3(백테스트 — 착수는 사용자 승인) 이며, 종료 보고 = P3 결과 보고 **또는** 사용자가 P3 를 하지 않기로 한 결정. P3 는 오래 걸릴 수 있어(수 주) 이 task 가 그만큼 밀린다는 점을 알고 있다 — 더 일찍 착수하길 원하면 "P1 완료 직후" 같은 다른 기준을 사용자가 지정하면 된다(아래 §착수 절차 G0).
- **왜 보류가 맞나(Leader 근거, [가능성 높음])**: 이 묶음의 5건은 모두 **제품 결함이 아니라 방어 보강·문서 정리**다. 수익 경로(시그널→집행)와 직접 연결되지 않고(제1원칙), 앱 1.1.0 은 사용자 실기기 확인까지 끝났다(2026-10-26 14:50).

## 묶음 구성 (T-091·T-093 에서 나온 후속 후보 — 새 요구를 만들지 않는다)

| WP | 무엇 | 왜 | 파일(예상) | 안전 경로 | 배포 | 예상 규모 |
|---|---|---|---|---|---|---|
| WP-1 | `login-screen-t088.test.ts` 조이기 — 로그인 후 이동 관문이 **T-089 이전 원문**(`startsWith('/') && !startsWith('//')`)으로 되돌려져도 통과하는 시험의 느슨함 제거(수정형만 통과) | T-093 으로 이 시험이 훅 감시에 들어왔는데 원문 회귀를 못 잡는다(T-093 한계). 열린 리다이렉트(T-089) 회귀 방어선 | `src/components/auth/__tests__/login-screen-t088.test.ts` | **감시 대상**(T-093) → Reviewer 판정 scope 필수 | 시험만 — 배포 불필요 | 작음 |
| WP-2 | `mail/header-safe.ts`(+ `mail/__tests__/header-safe.test.ts`) 를 훅 `SAFETY_PATHS` 에 추가 | 요청 유래 메일 제목·주소의 CR/LF 정화 — 약화되면 Bcc 삽입으로 초대코드 유출 가능(T-092 후보 ①, 중~약) | `scripts/git-hooks/commit-msg`·`scripts/test-git-hooks.sh`·CLAUDE.md 한 문장 | 훅 자신이 안전 경로 | 훅은 커밋 즉시 활성, push 불필요 | 작음(T-093 과 같은 방식) |
| WP-3 | 앱 `getAppVersion()` 조회 시간 제한 — `App.getInfo()` 가 끝내 응답하지 않으면 로그인 화면의 Google 자리·구분선이 영구히 비는 문제(이메일 로그인은 됨) → 시간이 지나면 "버전 모름"(= 막지 않음)으로 처리 | T-091 한계 ①(Reviewer·QA 낮음 평가) | `src/lib/native/bridge.ts`(+ `OAuthButtons.tsx` 사용처 확인)·시험 | 아니오(UI 상태 전이만, 새 화면 없음) — 데모 불필요 [가능성 높음, judge 가 확정] | **웹 배포 필요**(push=배포, APK 불필요) | 작음 |
| WP-4 | `scripts/build-apk.sh` Manifest 검사 보강 — 딥링크 intent-filter 의 **부모 activity 이름이 MainActivity 인지**, 병합 Manifest 의 `exported=true`·`launchMode=singleTask` 확인 | T-091 Codex C2 low | `scripts/build-apk.sh`·`src/lib/native/__tests__/manifest-deeplink-t088.test.ts` | 아니오 | 스크립트·시험만 — 다음 APK 빌드부터 적용(APK 재빌드 불필요) | 작음 |
| WP-5 | 문서·시험 보강: Reviewer N1(`app-version-gate-t091.test.ts` 소스 가드에 이미 있는 `code()` 한 줄 적용 — effect 줄 주석 처리 우회 변이 3종 검출), N2(`deploy-order.md` 의 L3 순서 문장 "① 기능 코드 배포 → ② APK 공개 → ③ 표 값 상향 push" 분리) | T-091 비차단 후속 | `src/components/auth/__tests__/app-version-gate-t091.test.ts`·`docs/deploy-order.md` | 아니오 | 시험·문서만 | 매우 작음 |

> WP-3 만 웹 배포를 부른다. 나머지는 훅·스크립트·시험·문서라 **다음 push 에 동승**(문서·스크립트만을 위한 배포는 하지 않는다 — 프로젝트 기존 원칙).
> 새 후보가 생기면 이 표에 한 줄을 더하되, 착수 전에 사용자에게 알린다. 이 묶음 밖(예: 새 앱 기능·M3 앱 잠금·M4 푸시)은 별도 task.

## 착수 절차 (이 순서로만 시작한다)

**G0 — 착수 조건(둘 다 충족해야 시작)**
1. Q3 줄기 종료 보고가 사용자에게 나갔다(T-095 최종 요약 + P2 사전 등록 확정 기록 + P3 결과 보고 또는 "P3 중단" 사용자 결정). 또는 사용자가 다른 기준을 말로 지정했다.
2. 사용자가 **"T-094 착수"**(또는 WP 를 지정해 "WP-n 착수")라고 말했다. 이 문서의 존재·AI 판단만으로 착수하지 않는다.
- **예외(핫픽스)**: 앱 결함 신고(링크가 앱을 안 연다·로그인이 막힌다 등)가 들어오면 이 절차와 무관하게 **단건 task** 로 즉시 처리한다(이 묶음에 합치지 않는다).

**G1 — 착수 전 점검(Leader, 읽기 전용, 10분 안)**
1. 상태 재확인: `git status`·`git log origin/main..HEAD`(타 세션 미커밋 변경 목록 기록 — 건드리지 않는다), 훅 sha(`scripts/git-hooks/commit-msg`)와 설치 shim 이 메인 트리 훅을 실행하는지, `app_release` 최신 행(현재 1.1.0·versionCode 3), 킬스위치·최근 3시간 주문 수·`/api/health`.
2. `/이슈기록 관련 앱·인증 안전` 으로 승인된 교훈(최대 5개)을 조회해 task "관련 과거 이력 요약"에 넣고 ID 를 적는다. 교훈 전체를 읽지 않는다.
3. 이 표의 5개 WP 중 **그 사이 낡아진 것**(이미 다른 task 가 처리·코드가 바뀜)을 코드로 대조해 걸러낸다. 걸러낸 것은 표에 취소선 + 사유.
4. 사용자에게 **WP 별 go/no-go**(권고 포함)를 한 표로 묻는다(WP-3 은 웹 배포가 따르므로 배포 시점 선택 포함: 장외 창 15:40~22:20 KST 권고, 사전 조건 킬스위치 ON·3시간 주문 0건·health 200).

**G2 — 순서와 묶음 규칙**
- 권고 순서: **WP-1 → WP-2**(시험을 먼저 조여야 훅 감시가 의미 있다) → WP-5 → WP-4 → **WP-3**(웹 배포를 부르는 것은 마지막). WP 마다 **별도 커밋**(되돌리기 단위) — 한 번에 합치지 않는다.
- 안전 경로(WP-1·WP-2 와 WP-4 의 시험): **격리 worktree** 에서 작업, **Reviewer 판정 줄**(`## Reviewer` 마지막 `최종 판정: PASS (scope: …)`, 실제 검토한 파일 전부) 없이는 커밋하지 않는다(훅이 막는다). 판정 설명문에는 "최종 판정" 구절·대문자 PASS/FAIL 을 쓰지 않는다(훅 인식 규칙).
- WP-2 는 T-093 방식 그대로: 정확 일치 항목 + 근거 주석(**근거 주석의 사실 오류가 매번 Reviewer 에게 걸렸다 — 각 파일이 실제로 무엇을 고정하는지 코드로 확인**)·`test-git-hooks.sh` 로직 단계 시험(전체 스크립트 금지 — `# [E2E]` 앞까지 자른 사본)·일회용 저장소 실 커밋 QA.

**G3 — 역할·판정**
- 각 WP: judge 접수(`demo_pref` 없이 — WP-3 이 화면 상태를 바꾸는지 judge 가 판정, 새 화면·구조 변경이면 데모 게이트) → Developer(judge 가 모델 지정) → Reviewer(Sonnet, 독립 감사) → judge C2(Codex 필요 시) → QA(격리 사본) → Leader 커밋.
- 화면 표시가 바뀌는 WP-3 은 데모 불필요 판정이 나와도, 상태 전이 표(응답 있음·없음·시간 초과)를 task 에 적고 사용자에게 알린다.

**G4 — 배포·기록**
- push·배포 시점은 사용자 승인. 배포 직전·직후 점검은 T-091 `## 배포 기록` 과 같은 항목(킬스위치 ON·3시간 주문 0건·pm2 새 릴리스·cron 1행·health 200·`system_config` 키 불변·주문 id 불변 — 비교 파일은 `kis_access_token`·`cred_%` 키를 **제외**하고 값은 출력하지 않는다).
- APK 가 필요한 변경은 이 묶음에 없다. 만약 WP 가 `android/**`·`capacitor.config.ts`·`public/app-shell/index.html`·Manifest 를 건드리게 되면 즉시 중단하고 `docs/mobile-app-procedure.md` 의 네이티브 변경 절차(versionCode 증가·재설치 고지)를 따르는 별도 task 로 분리한다.
- 완료 보고는 `docs/user-report-format.md` §3 블록(WP 마다 1블록), 상태·`waiting` 갱신, board·ACTIVE·RESUME·`20-Log` 갱신.

**G5 — 종료 조건**
- 사용자가 보류를 해제한 WP 가 모두 `done` 이거나 `취소` 사유가 기록되면 이 task 를 닫는다. 일부 WP 만 사용자가 승인하면 나머지는 이 문서에 남겨 둔다(`status: doing`·`waiting` 에 남은 WP).

## 하지 않는 것

지금(Q3 줄기 중) 이 task 의 어떤 WP 도 구현·커밋·배포하지 않는다. 앱 새 기능·M3·M4 는 범위 밖. 훅 판정 로직 변경 금지(WP-2 는 목록 항목 추가뿐).

## 허용 권한

현재 없음(문서 정의만). 착수 후 권한은 G1 에서 사용자에게 WP 별로 받는다.

## 판단 기록 (judge)

- [2026-10-27 20:2x] intake **WP-1·2·5 묶음(A)**: engine=rules → risk=R2(`R2-auth,R2-payment,R2-kw-auth`) / developer_model=opus(`MD-judge-failed-opus`) / next=assign / demo=none | fallback=budget_window_closed | 입력 `scratchpad/judge-T-094A-intake.json`.
- [20:2x] intake **WP-3(B)** 1차(요약에 "새 화면이나 구조 변경은 없고" 포함): risk=R2 / opus / **demo=full**(`DM-kw-full`) / next=demo_first. 2차(중립 표현 "요소 추가와 레이아웃 변경은 없고 기존 상태 사이의 전이 조건만 바뀐다"): risk=R2 / opus / **demo=delta**(`DM-kw-delta`) / next=demo_first. 두 번 다 데모 판정이 **키워드 매칭**이다(부정형 문장에도 반응 — T-099 intake 와 같은 패턴).
- **Leader override(WP-3 데모)**: 코드로 확인했다 — 변경은 `src/lib/native/bridge.ts` `getAppVersion()` 에 제한 시간(초과 시 null)을 두는 것이고 `OAuthButtons.tsx` 는 이미 "버전 모름 = 지금 그대로(막지 않음)" 를 정의하고 있다(T-091 사용자 승인 데모 `mockups/T-091-app-version-gate-v1.html` 대안 B). 도달하는 상태가 **승인된 데모에 이미 있는 상태**이고 새 요소·레이아웃·구조 변경이 없으므로 데모 게이트 대상이 아니라고 판단한다. 대신 상태 전이 표(응답 있음·없음·시간 초과)를 아래 진행 기록에 적고 최종 보고에서 사용자에게 알린다. 데모 게이트는 현재 warn 단계(훅). 틀렸다면 WP-3 만 되돌린다(WP 별 별도 커밋).

## 관련 과거 이력 요약

- [[T-091-app-version-gate-and-m2]]: 비차단 후속(N1·N2·`getInfo` 시간 제한·Codex low). 사용자 실기기 확인 완료(10-26 14:50).
- [[T-093-hook-safety-paths-auth-tests]]: login-screen 시험 한계·header-safe 다음 후보 1순위·정확 일치라 새 인증 시험 파일은 자동 감시되지 않음.
- [[T-092-hook-safety-paths-auth-impl]]: header-safe 후보 의견(중~약, nodemailer 9.0.5 가 제목 CRLF 를 자체 치환).
- [[T-089-open-redirect-next-path]]: 이동 경로 관문(WP-1 이 지키려는 것).
- 사용한 교훈 ID: 없음(착수 때 G1-2 로 조회).

## 진행 기록

- 2026-10-26 15:3x: Leader 작성(절차 정의만). 착수 조건 G0 미충족 — `status: todo`.
- 2026-10-27 20:2x: **G0 충족 판단 + 착수.** ① Q3 줄기 종료: [[T-096-strategy-validation-p2-p3]] 를 같은 날 종결(S1 합격 0, S2·S4 미시험 결정). ② 사용자 "T-094 착수" 에 해당하는 위임 — 같은 날 사용자 발화 그대로 "여기서부터는 내 승인없이 너가 판단해서 권고안으로 기존에 계획되어있던 작업 끝까지 진행하고 작업내역만 정리해서 알려줘. 더이상 승인으로 물어보지말고 진행해" (**Leader 해석**: 이 task 는 사용자가 절차를 만들어 두라고 한 '기존에 계획된 작업'이라 위임 범위에 든다. 틀렸다면 사용자가 알려 주면 WP 별로 되돌린다 — 모든 WP 가 별도 커밋이라 되돌리기 쉽다.) G1 사용자 go/no-go 표는 위임에 따라 Leader 권고를 그대로 결정으로 한다.
- **WP 결정(Leader 권고 = 결정)**: WP-1 **go** · WP-2 **go** · WP-5 **go** · WP-3 **go**(웹 배포는 장외 창에서, 킬스위치 ON·3시간 주문 0건·health 200 확인 후) · WP-4 **보류(취소 사유 기록)** — `build-apk.sh` Manifest 검사 보강은 다음 APK 빌드 때만 실행되는 경로라 지금 바꿔도 검증할 방법이 없고(APK 재빌드 금지·네이티브 변경 없음) 얻는 것이 없다. 다음 APK 빌드가 필요해질 때 함께 처리. 이 판단은 WP-4 를 표에서 지우지 않고 남긴다.
- **WP-3 상태 전이 표**(현재 코드 기준, 구현 후 같은 표로 대조): `getAppVersion()` 결과 — ① 응답 있음 → 그대로 비교(낮으면 비활성 버튼·띠, 아니면 정상 버튼) ② 앱이 아님·플러그인 없음·형식 오류 → null = 버전 모름 → 정상 버튼(지금 그대로) ③ `App.getInfo()` 가 끝내 응답하지 않음 → **지금: 영구 대기(Google 자리 비어 있음)** → **변경 후: 제한 시간 뒤 null = 버전 모름 → 정상 버튼**. ③ 만 바뀐다.
- 격리 worktree: WP-1·2·5 = `~/.node-local/stockinvest-t094a`(브랜치 `t094a`), WP-3 = `~/.node-local/stockinvest-t094b`(브랜치 `t094b`), 둘 다 base `f7e4444`, node_modules 는 `~/.node-local/stockinvest-p3s1/node_modules` 링크.

## Developer

- [2026-10-27 20:3x] **WP-3 (Developer B, Opus, worktree `t094b`, 미커밋)** — `src/lib/native/bridge.ts`(+29/−2): `APP_INFO_TIMEOUT_MS = 3_000` 상수(근거 주석)·`getInfo()` 를 먼저 호출(동기 예외는 타이머 생성 전에 catch)·`Promise.race([pending, timedOut])`·모듈 전용 `unique symbol` 로 시간 초과 표시(정상 `null`/`undefined` 응답과 구분)·`finally` 에서 `clearTimeout`·앱 아님/플러그인 없음은 타이머 없이 null. `src/lib/native/__tests__/bridge.test.ts`(+128): 가짜 타이머 시험 8개(응답 없음→null·제한 안 정상 응답·거부·시간 초과 뒤 늦은 응답 무시·타이머 정리·앱 아님·동기 예외·늦은 거부의 unhandledRejection 없음). 변이 증명 A(제한 제거: ①④ 실패)·B(늦은 거부 미처리: ③④ 실패)·C(clearTimeout 제거: ②③⑤ 실패) — 원본 sha256 복원 확인. 검증: bridge 37/37, 영역 jest 17묶음 493 통과, tsc 0, 전체 jest 7,800 통과·실패 0. 호출부(`useAppUpdate.ts`·`OAuthButtons.tsx`·`AppSection.tsx`)는 읽기만 — 수정 0. 상태 전이 표 대조: ③(무응답)만 바뀜. 보고서: scratchpad `t094/dev-B-report.md`.
- [20:3x] **한계(Developer 의견, Reviewer 확인)**: `appUpdateStore.detect()` 는 페이지 프로세스당 1회라 3초 뒤 null 이 들어가면 그 뒤 늦게 오는 정상 값은 버려진다 — 앱을 다시 열 때까지 유지. 개선안(앞으로 돌아올 때 1회 재읽기)은 버튼이 열림→닫힘으로 바뀌는 깜빡임이 있어 별도 WP + 데모 판단 필요.
- [20:5x] **WP-1·2·5 (Developer A, Opus, worktree `t094a`, 미커밋)** — 6파일, 런타임 코드 0줄. **WP-1** `login-screen-t088.test.ts`(+43/−10): "원문 또는 수정형" 단언(`ORIGINAL_*`)을 지우고 시험 4개(수정형 두 줄이 정확히 한 번씩·`startsWith(` 없음 / 관문 import 출처 `@/lib/safe-next-path` 하나·화면 안 재정의 없음 / `next` 읽는 곳 2곳 모두 바로 다음 문장에서 관문·이동은 `window.location.replace(dest)` 한 곳 / 화면이 쓰는 `sanitizeInternalPath` 에 T-089 우회 입력 16개 → 모두 null)로 교체. 변이: 원문 복귀 계열 실패 3 / base 시험은 통과(생존). **WP-2** `scripts/git-hooks/commit-msg`(+47/−0): `SAFETY_PATHS` 정확 일치 2줄(`^src/lib/mail/header-safe\.ts$`·`^src/lib/mail/__tests__/header-safe\.test\.ts$`) + `T-094 추가` 근거 주석(base 코드 대조)·옛 '후보/미포함' 문구 4곳에 정정 줄·`login-screen` 한계 서술 정정 4줄; 판정 로직 변경 0. `scripts/test-git-hooks.sh`(+176/−14): `[T-094]` 절(fixture T-960~962, 로직 22 + 일회용 저장소 실 커밋 7), header-safe 를 '이웃'으로 기대하던 기존 4곳(`t092-n2`·`t092-g9`·`t093-n3`·`t093-g8`)에서 두 파일을 뺌. `CLAUDE.md`: 인증 감시 문단에 한 문장. **WP-5** `app-version-gate-t091.test.ts`(+42/−11): 기존 `code()` 를 effect 관련 검사 3곳에 적용, `assemblyProblems(src)` 로 묶고 주석 우회 변이 4종 검출 시험 1개 추가. `docs/deploy-order.md`(+11/−1): L3 순서 문장 분리(번호 목록 1·2·3, 아래 순서 표 ①~⑥ 과 다르다는 안내, "이 표"→"`APP_FEATURE_MIN_BUILD` 표"). 검증: 훅 로직 단계 342/0→**371/0**, `git ls-files` 1,212개 전수 대조 432→434(새로 걸리는 파일 정확히 2개), 훅 변이 13종 전부 사망, 일회용 저장소 실 커밋 확인, 단독 jest(login 76·gate 53·mail 69)·tsc 0·전체 jest 7,796 통과. **사고 1건(정리 완료)**: 편집 스크립트를 셸 heredoc 으로 넘기다 안쪽 `EOF` 에서 끊겨 worktree 에 fixture 2개(`T-960-hooktest-…`·`T-961-hooktest-…`)가 생겼다가 즉시 삭제 — `git status` 로 6파일만 남은 것 확인. 보고서: scratchpad `t094/dev-A-report.md`.

## Reviewer

- [20:39] **WP-3 Reviewer(Sonnet, 독립 감사)** — 의도 통과 `[확실]`: null 이 `useAppUpdate.ts` `detect()` → `OAuthButtons.tsx` `deriveGoogleSlot` → `googleLoginGate(true,true,null)` → `feature-gate.ts` `appMeetsBuild`(null=true) → slot `button` 으로 흐르는 것을 직접 추적, 기존 시험 `app-version-gate-t091.test.ts:118` 이 같은 경로를 고정. 코드 결함 없음(이른 return·finally·동기 예외·늦은 거부·비 Promise 반환값·symbol 혼입·SSR 모두 확인). 변이 A/B/C 재현 + 추가 변이 6종 중 4 사망·2 생존(둘 다 동치). 실행: bridge 37/37, 영역 jest 12묶음 409(설정 포함 17묶음 493), tsc 0.
- [20:39] 회귀 판단 `[확실]`: 앱 build<2(공개본 중 1.0.0뿐)이고 `getInfo` 가 3초 넘게 늦지만 결국 응답하면 그 세션에서 옛 앱도 게이트를 지나 Google 버튼을 본다(늦은 정상 값 폐기). **서버에 build 검사는 없고(게이트는 화면 표시 전용 — CLAUDE.md 금기), 옛 앱에서 눌러도 1.0.0 에는 딥링크 수신 설정이 없어 코드는 만료·세션 미발급·PKCE verifier 는 WebView 에만 있어 가로채도 교환 불가** → 막다른 길(UX)일 뿐 자금·인증 우회 위험 없음. 끝내 무응답이면 좋아지고, 늦지만 응답하면 오히려 나빠진다(Developer 의 "나아짐" 일반화는 정정). 실제 노출 면적은 0 에 가깝다(사용자 폰 1.1.0).
- [20:39] findings: F-1 low(보고 정확성 — 위 한계를 사용자 보고에 그대로) · F-2 low(설계 선택: 공용 저장소 대신 `OAuthButtons` 단독 타임아웃이 영향이 작다는 T-091 Reviewer 제안이 있었음 — 후속 WP 후보 "null 이면 복귀 시 1회 재읽기", 데모 판단 필요) · F-3 low(시험 제목 ③-2 과다 서술·④ `await p1` 무의미 단언·같은 틱/통합 시험 부재 — 비차단) · F-4 medium(절차 기록 — `check.mjs` BLOCKED 는 이력표 상태 칸 형식 때문, Leader 가 20:4x 에 고쳐 `DEMO_GATE_PASSED` 확인).
- [20:39] 조건: ① F-4 해소(완료) ② 사용자 보고에 F-1 한계를 정확히 쓴다(최종 보고에 반영).
- [20:39] **최종 판정: CONDITIONAL_PASS (scope: src/lib/native/bridge.ts, src/lib/native/__tests__/bridge.test.ts)**
- [21:17] **WP-1·2·5 Reviewer(Sonnet, 독립 감사)** — 치명 0·높음 0·중간 0·낮음 4·정보 1. **A.WP-2(훅)** `[확실]`: 판정 로직 불변(비주석 추가 줄 정확히 2줄·삭제 0·`bash -n` 통과), 옛·새 `SAFETY_PATHS` 를 `git ls-files` 1,212개에 직접 적용해 432→434 독립 재현(추가는 header-safe 두 파일뿐, 제거 0), 근거 주석의 줄 번호·함수 동작·시험 단언 17개·NUL 67행을 base 소스와 하나씩 대조해 모두 일치, 로직 단계 371/0 재현(옛 라벨 제거 0·신규 29), 기존 4개 기대 변경은 header-safe 만 뺀 정당한 대체(약화 아님), 훅 변이 17종 전부 사망, `CLAUDE.md` 한 문장 일치. **B.WP-1** `[확실]`: 삭제된 단언은 `ORIGINAL_*` 와 두 `expect` 뿐, T-089 이전 원문 복귀 계열 변이 전부 사망, `sanitizeInternalPath` 약화 변이는 이 시험 또는 `safe-next-path.test.ts` 가 잡음(중복 방어). **C.WP-5** `[확실]`: 실제 `OAuthButtons.tsx` effect 주석 처리 변이를 새 시험이 잡고 base 시험은 52/52 통과(구멍 실재), `deploy-order.md` 의미 불변(원문의 '위'→'아래 순서 표' 는 방향 오류 정정). **D.커밋 순서** `[확실]`: WP-1→WP-2→WP-5 별도 커밋 성립(일회용 clone 에서 실제 커밋 3회 통과) — 훅은 직전 커밋의 판정을 보지 않고 매 커밋마다 이 task 문서 `## Reviewer` 의 마지막 판정 줄 scope 가 그 커밋의 staged 안전 파일을 덮는지만 본다.
- [21:17] findings(전부 낮음·비차단): L1 훅 주석이 ③ `escapeHtml` 호출 삭제에는 감시 중인 보완책이 없음을 말하지 않음 → **Leader 반영**(주석 2줄 수정, 비주석 변경 없음 재확인) · L2 `test-git-hooks.sh` 975·982·1168·1295행 fixture 설명이 header-safe 를 아직 이웃으로 서술(기록용 문자열, 영향 없음 — 미반영) · L3 로그인 페이지에 관문과 무관한 `startsWith(` 한 곳만 넣어도 시험이 실패(의도된 마찰, 훅 주석 448행이 예고) · L4 `app-version-gate-t091.test.ts` 의 나머지 원문 `toContain` 은 주석 우회 가능(N1 명시 범위 밖, 후속 후보).
- [21:17] 실무 주의(Reviewer): 훅은 커밋하는 worktree 의 `agent-vault/10-Flow/tasks/` 를 읽는다 → 메인 트리에서 커밋하므로 문제없음. 마지막 판정 줄 뒤에 다른 판정 줄·'최종'+'판정' 구절이 든 줄을 추가하지 말 것. WP-2 만 따로 cherry-pick 하면 훅 주석의 'WP-1 정정' 문장이 거짓이 된다.
- [21:17] **최종 판정: PASS (scope: src/components/auth/__tests__/login-screen-t088.test.ts, scripts/git-hooks/commit-msg, scripts/test-git-hooks.sh, src/components/auth/__tests__/app-version-gate-t091.test.ts, docs/deploy-order.md, CLAUDE.md)**

## QA

- [20:49] **WP-3 QA(Sonnet, 직접 실행, 깨끗한 사본 `f7e4444`+patch)** — **QA 결과: PASS (결함 0)**. tsc 0 · `src/lib/native` 180/180(bridge 37/37, 신규 8) · 영역 33묶음 1088 통과 · **전체 jest 292묶음 7,800 통과·실패 0**. 실시간 타이머(가짜 타이머 없이): 무응답 3004.6ms 뒤 null · 즉시 응답 0.6ms · 2.9초 응답 값 그대로 · 3.3초 늦은 응답/거부는 null·unhandledRejection 0 · 동기 예외 1.0ms null · `--detectOpenHandles` 경고 0. **수정 전(base) 사본에서 영구 대기 재현**(6000ms 시점에도 pending, 원시 await 는 5초 시험 시간 초과) — 수정 전 결함이 실제로 있었고 수정으로 사라졌다는 증거. 바뀐 것은 전이 표 ③(무응답)뿐(나머지 경로는 패치 전후 동일). 못 한 것: 실기기·실제 Capacitor WebView 무응답 재현(재현 수단 없음)·화면 시각 확인(새 요소 없다는 override 에 따름)·웹 배포 후 운영 스모크(배포 단계).
- [21:2x] **WP-1·2·5 QA(Sonnet, 직접 실행, 깨끗한 사본 `f7e4444`+patch)** — **QA 결과: PASS (결함 0)**. `SAFETY_PATHS` 73→75 항목(추가 정확히 2줄·삭제 0), `git ls-files` 전수 432→434(새로 걸리는 파일 정확히 header-safe 2개), 훅 로직 단계(`# [E2E]` 앞 사본) **371/0**(base 342/0, 차이 29건 전부 새 `t094-*`), **일회용 저장소 실 커밋 11건 통과**: header-safe.ts·시험을 task ID 없이 커밋 → 차단·HEAD 불변 / 이웃 `signup-request-mail.ts` → 통과 / 판정 scope 가 header-safe 를 포함 → 통과 / scope 미포함·판정 불합격·task 문서 없음 → 차단 / 옛 훅은 둘 다 통과(감시 밖이었음). 실제 task 문서를 복사한 격리 clone 에서 WP-1→WP-2→WP-5 커밋 3개가 순서대로 통과. 단독 jest login 76·gate 53·mail 69·safe-next-path 87(합 285/285), tsc 0(시험 파일은 보조 tsconfig 로 별도 0), **전체 jest 296묶음 중 292 통과·4 건너뜀, 7,796 통과·149 건너뜀(전부 `*-disposable-mariadb`)·실패 0**. WP-1 회귀 방어: 원문 복귀 변이 시 새 시험 3개 실패(원복 후 76/76), **옛 시험은 같은 변이에서 73/73 통과 = 구멍 실재**; WP-5: effect 주석 처리 변이 시 새 시험 1개 실패, 옛 시험 52/52 통과. `deploy-order.md` 의미 불변(순서·조건 동일, '위'→'아래 순서 표' 방향 정정·'이 표'→'`APP_FEATURE_MIN_BUILD` 표'·번호 안내 1줄). 못 한 것: 설치된 shim 경유 `[E2E]`(실제 저장소 index 커밋)·DB 의존 시험 149건(skip)·main 에서 실제 커밋할 때의 결과(격리 clone 만).

## 배포 기록

## Codex 검토

### [2026-10-27 21:0x] C2 review focus=none — WP-3 — done (지적 0건)
- judge 판정: 2026-10-27 `codex_required: true`(`CX-r2-post-review`, Codex 스위치 on) / 이 task 호출 1회 — 입력 `scratchpad/judge-T-094B-c2.json`.
- 대상: repo=`/home/brownjeon/.node-local/stockinvest-t094b`(WP-3 미커밋 사본) base=f7e4444(arg) snapshot=e940921, 실행 41초·exit 0. `node_modules` 링크는 스냅샷에서 제거한 뒤 실행, `.gitignore` 대상(계좌 수치가 든 T-100 보고서)은 `git add -A` 에 포함되지 않음.
- 지적 0건. Codex 요약: `Promise.race`/`finally` 조합의 타이머 누수·처리되지 않은 지연 거부·시간 초과 symbol 오해석 없음, 시간 초과 null 은 `currentLoaded=true` 버전 미상 상태로 Google 로그인 fail-open·업데이트 UI unknown 이며 문서화된 기존 정책과 일치, 3000ms 는 네트워크 없는 로컬 플러그인 호출이라는 근거가 있고 오발화 근거 없음.
- 검토하지 못한 범위: 실제 Android WebView 에서 `App.getInfo()` 무응답/3초 초과 응답의 실기기 동작, 읽기 전용 제약으로 인한 시험 스위트 재실행.
- 원본: `.claude/state/codex-review/runs/20261027T120157Z-T-094-C2/raw.txt`

### [2026-10-27 21:19] C2 review focus=none — WP-1·2·5 — done (지적 0건)
- judge 판정: `codex_required: true`(`CX-r2-post-review`, Codex 스위치 on) / 이 task 호출 2회째(WP-3 1회 + 이번 1회, 상한 4) — 입력 `scratchpad/judge-T-094A-c2.json`.
- 대상: repo=`/home/brownjeon/.node-local/stockinvest-t094a`(WP-1·2·5 미커밋 사본, `node_modules` 링크 제거 후 실행) base=f7e4444(arg) snapshot=a765ea0, 실행 55초·exit 0. 스냅샷에 L1 주석 수정(Reviewer 지적 반영, 비주석 변경 없음) 포함.
- 지적 0건. Codex 요약: `SAFETY_PATHS` 비주석 실행 변경은 정확 일치 항목 두 줄뿐이며 대상·이웃 경계가 올바르고 훅 판정 로직 변경 없음. T-094 훅 시험과 기존 기대 조정, 로그인 `next` 관문 시험, 앱 버전 게이트 주석 우회 방어, 배포 문서 분리, 근거 주석의 base 코드 호출 위치를 대조했으나 보고할 결함 없음.
- 검토하지 못한 범위: `scripts/test-git-hooks.sh` 실행(파일·임시 index·일회용 저장소 커밋 수반), jest·tsc 재실행, 실제 `commit-msg` 훅 E2E 커밋 — QA 가 별도로 실행한다.
- 원본: `.claude/state/codex-review/runs/20261027T121920Z-T-094-C2/raw.txt`

## 최종 요약

(완료 시 Leader 가 작성)

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 해당없음 | - | - | judge intake WP-3 = delta(키워드 DM-kw-delta) → **Leader override 해당없음**(도달 상태가 T-091 승인 데모 대안 B 에 이미 있음·새 요소/레이아웃 없음, 근거는 '판단 기록'). 사용자 위임 아래 결정 — 틀렸다면 WP-3 만 되돌림 | 2026-10-27 20:4x |
